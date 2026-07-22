(() => {
  const voiceToggle = document.getElementById('voiceToggle');
  if (!voiceToggle) return;

  const style = document.createElement('style');
  style.id = 'ui-refinement-large-options';
  style.textContent = `
    .msg{
      padding:16px 18px;
      font-size:18px;
      line-height:1.5;
    }
    .msg.bot.latest{
      background:#fff;
      border-color:#bdd1ef;
      box-shadow:0 7px 20px rgba(23,61,122,.10),0 0 0 3px rgba(11,99,246,.06);
    }
    .quick{
      grid-template-columns:1fr!important;
      gap:12px!important;
    }
    .chat>.quick{
      max-width:calc(100% - 36px);
      padding:0;
      background:transparent;
      border:0;
    }
    .quick button,.inline-actions button{
      width:100%;
      min-height:64px;
      padding:16px 18px;
      border-radius:19px;
      font-size:19px;
      line-height:1.2;
      text-align:left;
      box-shadow:0 7px 18px rgba(23,61,122,.09);
    }
    .quick .quick-continue{
      grid-column:auto;
      text-align:center;
    }
    .inline-actions{
      display:grid;
      grid-template-columns:1fr;
      gap:12px;
    }
    .inline-actions button{
      flex:none;
    }
    @media(max-width:560px){
      .msg{
        padding:14px 15px;
        font-size:17px;
      }
      .chat>.quick{
        max-width:calc(100% - 32px);
        margin-left:32px;
        padding:0;
      }
      .quick button,.inline-actions button{
        min-height:62px;
        padding:15px 16px;
        border-radius:18px;
        font-size:18px;
      }
    }
  `;
  document.head.appendChild(style);

  const icon = voiceToggle.querySelector('.voice-icon');
  const label = voiceToggle.querySelector('.voice-label');
  const status = voiceToggle.querySelector('.voice-status');
  const privacy = document.getElementById('voicePrivacy');
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  let audioContext = null;
  let source = null;
  let requestController = null;
  let enabled = false;
  let configured = false;
  let unlocked = false;
  let playing = false;
  let queue = [];
  window.assistantVoiceState = 'checking';
  window.lastAssistantSpeech = '';

  function emitSpeechState(state, text = '') {
    if (state === 'finished') window.lastAssistantSpeech = text;
    window.dispatchEvent(new CustomEvent('assistant-speech-state', { detail: { state, text } }));
  }

  function setVoiceState(state) {
    window.assistantVoiceState = state;
    emitSpeechState(state);
  }

  function setButton(state, main, detail, symbol) {
    voiceToggle.classList.remove('ready', 'loading', 'on', 'speaking');
    if (state) voiceToggle.classList.add(state);
    voiceToggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    voiceToggle.setAttribute('aria-label', main + '. ' + detail);
    voiceToggle.title = detail;
    if (icon) icon.textContent = symbol;
    if (label) label.textContent = main;
    if (status) status.textContent = detail;
  }

  function cleanForSpeech(value) {
    return String(value || '')
      .replace(/https?:\/\/\S+/gi, 'link do anúncio')
      .replace(/[✅💳🔄📅🚗🚙👋🎙️🔊🔇]/gu, '')
      .replace(/\b\d+\s*\/\s*\d+\s*[—-]\s*/g, '')
      .replace(/\bpasso\s+\d+\s+de\s+\d+[.:—-]?\s*/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 900);
  }

  function interruptPlayback() {
    requestController?.abort();
    requestController = null;
    if (source) {
      try { source.stop(); } catch {}
      source.disconnect();
      source = null;
    }
  }

  function stopPlayback() {
    interruptPlayback();
    playing = false;
  }

  async function playAudio(buffer) {
    if (!audioContext) throw new Error('Áudio não suportado neste navegador.');
    const decoded = await audioContext.decodeAudioData(buffer.slice(0));
    await new Promise((resolve, reject) => {
      source = audioContext.createBufferSource();
      source.buffer = decoded;
      source.connect(audioContext.destination);
      source.onended = resolve;
      try {
        source.start(0);
      } catch (error) {
        reject(error);
      }
    });
    source?.disconnect();
    source = null;
  }

  async function playQueue() {
    if (playing || !enabled || !configured || !unlocked || audioContext?.state !== 'running' || !queue.length) return;
    playing = true;
    let failed = false;

    while (enabled && queue.length) {
      const text = queue.shift();
      requestController = new AbortController();
      setButton('speaking', 'Voz ligada', 'O assistente está a falar…', '🔊');

      try {
        const response = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
          signal: requestController.signal
        });
        if (!response.ok) throw new Error('Não foi possível gerar a voz.');
        const buffer = await response.arrayBuffer();
        if (!enabled || requestController.signal.aborted) break;
        await playAudio(buffer);
        emitSpeechState('finished', text);
      } catch (error) {
        if (error?.name !== 'AbortError' && enabled) {
          failed = true;
          emitSpeechState('failed', text);
          queue = [];
          enabled = false;
          setVoiceState('off');
          setButton('ready', 'Ativar voz', 'Não foi possível ler esta resposta', '🔇');
        }
      } finally {
        requestController = null;
      }
    }

    playing = false;
    if (enabled && !failed) setButton('on', 'Voz ligada', 'As respostas serão lidas pela ElevenLabs', '🔊');
  }

  window.queueAssistantSpeech = (value, options = {}) => {
    if (!enabled) return;
    const text = cleanForSpeech(value);
    if (!text || /^A analisar/i.test(text)) return;
    if (options.replace) {
      queue = [];
      if (playing) interruptPlayback();
    }
    queue.push(text);
    void playQueue();
  };

  function latestAssistantMessage() {
    const latest = document.querySelector('.msg.bot.latest');
    return latest?.textContent || '';
  }

  async function unlockAudio() {
    if (!AudioContextClass) throw new Error('Áudio não suportado.');
    if (!audioContext) audioContext = new AudioContextClass();
    if (audioContext.state !== 'running') {
      const silentBuffer = audioContext.createBuffer(1, 1, audioContext.sampleRate || 44100);
      const silentSource = audioContext.createBufferSource();
      silentSource.buffer = silentBuffer;
      silentSource.connect(audioContext.destination);
      silentSource.onended = () => silentSource.disconnect();
      silentSource.start(0);
      await audioContext.resume();
    }
    unlocked = audioContext.state === 'running';
    return unlocked;
  }

  setButton('ready', 'Ativar voz', 'A voz é opcional. Toque para ouvir as respostas', '🔇');

  voiceToggle.addEventListener('click', async () => {
    if (!configured) return;

    if (enabled) {
      enabled = false;
      queue = [];
      stopPlayback();
      setVoiceState('off');
      setButton('ready', 'Ativar voz', 'A voz é opcional. Toque para ouvir as respostas', '🔇');
      return;
    }

    try {
      if (!await unlockAudio()) throw new Error('Áudio bloqueado.');
      enabled = true;
      setVoiceState('ready');
      setButton('on', 'Voz ligada', 'As respostas serão lidas pela ElevenLabs', '🔊');
      window.queueAssistantSpeech(latestAssistantMessage());
    } catch {
      enabled = false;
      setVoiceState('unavailable');
      setButton('', 'Voz indisponível', 'O chat escrito continua disponível', '🔇');
    }
  });

  window.addEventListener('pagehide', () => {
    enabled = false;
    queue = [];
    stopPlayback();
    audioContext?.close().catch(() => {});
  });

  fetch('/api/tts', { cache: 'no-store' })
    .then((response) => response.json())
    .then((data) => {
      configured = Boolean(data.configured);
      voiceToggle.disabled = !configured;
      privacy?.classList.toggle('hidden', !configured);
      if (configured) {
        setVoiceState('off');
        setButton('ready', 'Ativar voz', 'A voz é opcional. Toque para ouvir as respostas', '🔇');
      } else {
        enabled = false;
        queue = [];
        setVoiceState('unavailable');
        setButton('', 'Voz indisponível', 'O chat escrito continua disponível', '🔇');
      }
    })
    .catch(() => {
      enabled = false;
      queue = [];
      setVoiceState('unavailable');
      voiceToggle.disabled = true;
      setButton('', 'Voz indisponível', 'O chat escrito continua disponível', '🔇');
    });
})();
