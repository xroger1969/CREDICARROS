import {
  ensureSpeechEngine,
  publicVoiceWsUrl
} from '../lib/voice-engine.js';

const apiKey = process.env.ELEVENLABS_API_KEY;

if (!apiKey) {
  throw new Error('Defina ELEVENLABS_API_KEY antes de executar este comando.');
}

const engineId = await ensureSpeechEngine();

console.log(`ELEVENLABS_SPEECH_ENGINE_ID=${engineId}`);
console.log(`WebSocket=${publicVoiceWsUrl()}`);
