(() => {
  const sdk = window.ElevenLabsClient;
  const label = voiceToggle.querySelector('.voice-label');
  const status = voiceToggle.querySelector('.voice-status');
  const privacy = document.getElementById('voicePrivacy');
  let conversation = null;
  let connecting = false;
  let configured = false;
  let errorShown = false;

  function setButton(state, main, detail) {
    voiceToggle.classList.remove('ready', 'connecting', 'on', 'speaking');
    if (state) voiceToggle.classList.add(state);
    voiceToggle.setAttribute('aria-pressed', state === 'on' || state === 'speaking' ? 'true' : 'false');
    label.textContent = main;
    status.textContent = detail;
  }

  function showError(message) {
    if (!errorShown) {
      add(message, 'bot');
      errorShown = true;
    }
  }

  function firstMessage() {
    const vehicle = String(lead.viatura || '')
      .replace(/[<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);
    return `Olá! Sou o assistente do Carlos. Estou aqui para ajudar com a viatura: ${vehicle}. Diga-me o que precisa.`;
  }

  async function getConversationToken() {
    const response = await fetch('/api/voice-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.token) {
      throw new Error(data.error || 'Não foi possível iniciar a conversa de voz.');
    }
    return data.token;
  }

  async function startConversation() {
    if (connecting || conversation) return;
    if (!configured || !sdk?.Conversation) {
      showError('A conversa de voz ainda não está disponível. Pode continuar a usar o chat escrito normalmente.');
      return;
    }
    if (!filled(lead.viatura)) {
      add('Escolha primeiro uma viatura. Depois toque em “Falar com o assistente”.', 'bot');
      chat.scrollTop = chat.scrollHeight;
      return;
    }

    connecting = true;
    errorShown = false;
    voiceToggle.disabled = true;
    setButton('connecting', 'A ligar…', 'Autorize o microfone se for solicitado');

    try {
      const permission = await navigator.mediaDevices.getUserMedia({ audio: true });
      permission.getTracks().forEach((track) => track.stop());
      const conversationToken = await getConversationToken();

      conversation = await sdk.Conversation.startSession({
        conversationToken,
        connectionType: 'webrtc',
        overrides: {
          agent: { firstMessage: firstMessage() }
        },
        onConnect: () => {
          connecting = false;
          voiceToggle.disabled = false;
          setButton('on', 'Terminar conversa', 'A ouvir… fale naturalmente');
        },
        onMessage: ({ message, role, event_id: eventId }) => {
          recordVoiceMessage(role, message, eventId);
        },
        onModeChange: ({ mode }) => {
          if (!conversation) return;
          if (mode === 'speaking') {
            setButton('speaking', 'Terminar conversa', 'O assistente está a responder…');
          } else {
            setButton('on', 'Terminar conversa', 'A ouvir… fale naturalmente');
          }
        },
        onDisconnect: () => {
          conversation = null;
          connecting = false;
          voiceToggle.disabled = false;
          setButton('ready', 'Falar novamente', 'Conversa terminada');
          updateSend();
        },
        onError: () => {
          showError('A conversa de voz foi interrompida. Pode tentar novamente ou continuar por escrito.');
        }
      });
    } catch (error) {
      conversation = null;
      connecting = false;
      voiceToggle.disabled = false;
      setButton('ready', 'Tentar novamente', 'Não foi possível ligar o microfone');
      const denied = error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError';
      showError(denied
        ? 'Para conversar por voz, permita o acesso ao microfone nas definições do navegador.'
        : 'Não foi possível iniciar a voz. O chat escrito continua disponível.');
    }
  }

  async function stopConversation() {
    if (!conversation) return;
    const current = conversation;
    conversation = null;
    voiceToggle.disabled = true;
    setButton('connecting', 'A terminar…', 'A guardar o resumo da conversa');
    try {
      await current.endSession();
    } finally {
      connecting = false;
      voiceToggle.disabled = false;
      setButton('ready', 'Falar novamente', 'Pode enviar o resumo ao Carlos');
      updateSend();
    }
  }

  voiceToggle.addEventListener('click', () => {
    if (conversation) stopConversation();
    else startConversation();
  });

  window.addEventListener('pagehide', () => {
    if (conversation) conversation.endSession().catch(() => {});
  });

  fetch('/api/voice-token', { cache: 'no-store' })
    .then((response) => response.json())
    .then((data) => {
      configured = Boolean(data.configured && sdk?.Conversation);
      voiceToggle.disabled = !configured;
      privacy.classList.toggle('hidden', !configured);
      if (configured) {
        setButton('ready', 'Falar com o assistente', 'Conversa natural com voz ElevenLabs');
      } else {
        setButton('', 'Voz em preparação', 'O chat escrito continua disponível');
      }
    })
    .catch(() => {
      voiceToggle.disabled = true;
      setButton('', 'Voz indisponível', 'O chat escrito continua disponível');
    });
})();
