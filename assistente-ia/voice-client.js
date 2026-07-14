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
  let enabled = false;
  let configured = false;
  let playing = false;
  let queue = [];

  function setButton(state, main, detail, symbol) {
    voiceToggle.classList.remove('ready', 'loading', 'on', 'speaking');
    if (state) voiceToggle.classList.add(state);
    voiceToggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    icon.textContent = symbol;
    label.textContent = main;
    status.textContent = detail;
  }

  function cleanForSpeech(value) {
    return String(value || '')
      .replace(/https?:\/\/\S+/gi, 'link do anúncio')
      .replace(/[✅💳🔄📅🚗🚙👋🎙️🔊🔇]/gu, '')
      .replace(/\b(\d+)\/(\d+)\s*[—-]\s*/g, 'Passo $1 de $2. ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 900);
  }

  function stopPlayback() {
    requestController?.abort();
    requestController = null;
    if (source) {
      try { source.stop(); } catch {}
      source.disconnect();
      source = null;
    }
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
    if (playing || !enabled || !configured || !queue.length) return;
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
      } catch (error) {
        if (error?.name !== 'AbortError' && enabled) {
          failed = true;
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

  window.queueAssistantSpeech = (value) => {
    if (!enabled || !configured) return;
    const text = cleanForSpeech(value);
    if (!text || /^A analisar/i.test(text)) return;
    queue.push(text);
    void playQueue();
  };

  function latestAssistantMessage() {
    const latest = document.querySelector('.msg.bot.latest');
    return latest?.textContent || '';
  }

  voiceToggle.addEventListener('click', async () => {
    if (!configured) return;

    if (enabled) {
      enabled = false;
      queue = [];
      stopPlayback();
      setButton('ready', 'Voz desligada', 'Toque para ouvir as respostas', '🔇');
      return;
    }

    try {
      if (!AudioContextClass) throw new Error('Áudio não suportado.');
      if (!audioContext) audioContext = new AudioContextClass();
      await audioContext.resume();
      enabled = true;
      setButton('on', 'Voz ligada', 'As respostas serão lidas pela ElevenLabs', '🔊');
      window.queueAssistantSpeech(latestAssistantMessage());
    } catch {
      enabled = false;
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
      privacy.classList.toggle('hidden', !configured);
      if (configured) {
        setButton('ready', 'Voz desligada', 'Toque para ouvir as respostas', '🔇');
      } else {
        setButton('', 'Voz em preparação', 'O chat escrito continua disponível', '🔇');
      }
    })
    .catch(() => {
      voiceToggle.disabled = true;
      setButton('', 'Voz indisponível', 'O chat escrito continua disponível', '🔇');
    });
})();
