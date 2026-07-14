import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import {
  buildSpeechEngineConfiguration,
  DEFAULT_PORTUGUESE_VOICE_ID,
  DEFAULT_TTS_MODEL
} from './speech-engine-config.mjs';

const apiKey = process.env.ELEVENLABS_API_KEY;
const existingEngineId = process.env.ELEVENLABS_SPEECH_ENGINE_ID;
const wsUrl = process.env.PUBLIC_WS_URL || 'wss://credicarros.vercel.app/api/voice-ws';
const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_PORTUGUESE_VOICE_ID;
const ttsModel = process.env.ELEVENLABS_TTS_MODEL || DEFAULT_TTS_MODEL;

if (!apiKey) {
  throw new Error('Defina ELEVENLABS_API_KEY antes de executar este comando.');
}

const elevenlabs = new ElevenLabsClient({ apiKey });
const configuration = buildSpeechEngineConfiguration({ wsUrl, voiceId, ttsModel });

const engine = existingEngineId
  ? await elevenlabs.speechEngine.update(existingEngineId, configuration)
  : await elevenlabs.speechEngine.create(configuration);

console.log(`ELEVENLABS_SPEECH_ENGINE_ID=${engine.engineId}`);
console.log(`WebSocket=${wsUrl}`);
console.log(`Voz portuguesa=${voiceId}`);
console.log(`Modelo TTS=${ttsModel}`);
