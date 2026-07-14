import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

const apiKey = process.env.ELEVENLABS_API_KEY;
const existingEngineId = process.env.ELEVENLABS_SPEECH_ENGINE_ID;
const wsUrl = process.env.PUBLIC_WS_URL || 'wss://credicarros.vercel.app/api/voice-ws';
const voiceId = process.env.ELEVENLABS_VOICE_ID;

if (!apiKey) {
  throw new Error('Defina ELEVENLABS_API_KEY antes de executar este comando.');
}

if (!wsUrl.startsWith('wss://')) {
  throw new Error('PUBLIC_WS_URL tem de começar por wss://');
}

const elevenlabs = new ElevenLabsClient({ apiKey });
const configuration = {
  name: 'AutoValorPT — Assistente do Carlos',
  speechEngine: { wsUrl },
  language: 'pt',
  overrides: { firstMessage: true },
  conversation: { maxDurationSeconds: 240 },
  privacy: {
    recordVoice: false,
    retentionDays: 1,
    deleteAudio: true,
    deleteTranscriptAndPii: true
  },
  ...(voiceId ? { tts: { voiceId } } : {})
};

const engine = existingEngineId
  ? await elevenlabs.speechEngine.update(existingEngineId, configuration)
  : await elevenlabs.speechEngine.create(configuration);

console.log(`ELEVENLABS_SPEECH_ENGINE_ID=${engine.engineId}`);
console.log(`WebSocket=${wsUrl}`);
