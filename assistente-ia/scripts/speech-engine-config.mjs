export const DEFAULT_PORTUGUESE_VOICE_ID = 'RROBrqjHiRb8zmRgGV11';
export const DEFAULT_TTS_MODEL = 'eleven_flash_v2_5';
export const SPEECH_ENGINE_NAME = 'AutoValorPT — Assistente do Carlos';
export const SPEECH_ENGINE_TAGS = ['autovalorpt', 'credicarros'];

const ENGLISH_ONLY_MODELS = new Set(['eleven_flash_v2', 'eleven_turbo_v2']);

export function buildSpeechEngineConfiguration({
  wsUrl,
  voiceId = DEFAULT_PORTUGUESE_VOICE_ID,
  ttsModel = DEFAULT_TTS_MODEL
} = {}) {
  if (!String(wsUrl || '').startsWith('wss://')) {
    throw new Error('PUBLIC_WS_URL tem de começar por wss://');
  }

  if (!String(voiceId || '').trim()) {
    throw new Error('ELEVENLABS_VOICE_ID não pode estar vazio.');
  }

  if (ENGLISH_ONLY_MODELS.has(ttsModel)) {
    throw new Error('O modelo de voz escolhido só suporta inglês. Use eleven_flash_v2_5.');
  }

  return {
    name: SPEECH_ENGINE_NAME,
    tags: SPEECH_ENGINE_TAGS,
    speechEngine: { wsUrl },
    language: 'pt',
    tts: {
      voiceId,
      modelId: ttsModel,
      stability: 0.42,
      speed: 0.97,
      similarityBoost: 0.78,
      textNormalisationType: 'elevenlabs'
    },
    overrides: { firstMessage: true },
    conversation: { maxDurationSeconds: 240 },
    privacy: {
      recordVoice: false,
      retentionDays: 1,
      deleteAudio: true,
      deleteTranscriptAndPii: true
    }
  };
}
