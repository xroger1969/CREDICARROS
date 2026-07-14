(() => {
  const voiceToggle = document.getElementById('voiceToggle');
  if (!voiceToggle) return;

  const icon = voiceToggle.querySelector('.voice-icon');
  const label = voiceToggle.querySelector('.voice-label');
  const status = voiceToggle.querySelector('.voice-status');
  const privacy = document.getElementById('voicePrivacy');
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  let audioContext = null;
  let source = null;
  let requestController = null;
  let enabled = true;
  let configured = false;
  let unlocked = false;
  let playing = false;
  let queue = [];
  window.assistantVoiceState = 'checking';

  function emitSpeechState(state, text = '') {
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
    icon.textContent = symbol;
    label.textContent = main;
    status.textContent = detail;
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
          setButton('on', 'Voz ligada', 'Não foi possível ler esta resposta', '🔊');
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
    if (!configured || !unlocked) queue = queue.slice(-3);
    void playQueue();
  };

  function latestAssistantMessage() {
    const latest = document.querySelector('.msg.bot.latest');
    return latest?.textContent || '';
  }

  const interactionEvents = ['pointerdown', 'touchend', 'click', 'keydown'];

  function stopWaitingForInteraction() {
    interactionEvents.forEach((eventName) => document.removeEventListener(eventName, unlockOnInteraction, true));
  }

  function primeAudioContext() {
    const silentBuffer = audioContext.createBuffer(1, 1, audioContext.sampleRate || 44100);
    const silentSource = audioContext.createBufferSource();
    silentSource.buffer = silentBuffer;
    silentSource.connect(audioContext.destination);
    silentSource.onended = () => silentSource.disconnect();
    silentSource.start(0);
  }

  async function unlockAudio() {
    if (!enabled) return false;
    if (!AudioContextClass) throw new Error('Áudio não suportado.');
    if (!audioContext) audioContext = new AudioContextClass();
    if (audioContext.state !== 'running') {
      primeAudioContext();
      await audioContext.resume();
    }
    unlocked = audioContext.state === 'running';
    if (!unlocked) return false;
    stopWaitingForInteraction();
    if (configured) {
      setButton('on', 'Voz ligada', 'As respostas serão lidas pela ElevenLabs', '🔊');
      void playQueue();
    }
    return true;
  }

  function unlockOnInteraction(event) {
    if (voiceToggle.contains(event.target)) return;
    void unlockAudio().catch(() => {});
  }

  interactionEvents.forEach((eventName) => document.addEventListener(eventName, unlockOnInteraction, true));

  voiceToggle.addEventListener('click', async () => {
    if (!configured) return;

    if (enabled) {
      enabled = false;
      queue = [];
      stopPlayback();
      setVoiceState('off');
      setButton('ready', 'Voz desligada', 'Toque para ouvir as respostas', '🔇');
      return;
    }

    try {
      enabled = true;
      if (!await unlockAudio()) throw new Error('Áudio bloqueado.');
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
    stopWaitingForInteraction();
    audioContext?.close().catch(() => {});
  });

  fetch('/api/tts', { cache: 'no-store' })
    .then((response) => response.json())
    .then((data) => {
      configured = Boolean(data.configured);
      voiceToggle.disabled = !configured;
      privacy.classList.toggle('hidden', !configured);
      if (configured) {
        setVoiceState('ready');
        setButton('on', 'Voz ligada', unlocked ? 'As respostas serão lidas pela ElevenLabs' : 'O som começa no primeiro toque', '🔊');
        void unlockAudio().catch(() => {});
      } else {
        enabled = false;
        queue = [];
        setVoiceState('unavailable');
        setButton('', 'Voz em preparação', 'O chat escrito continua disponível', '🔇');
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
