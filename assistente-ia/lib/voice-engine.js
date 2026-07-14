import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import {
  buildSpeechEngineConfiguration,
  DEFAULT_PORTUGUESE_VOICE_ID,
  DEFAULT_TTS_MODEL,
  SPEECH_ENGINE_NAME,
  SPEECH_ENGINE_TAGS
} from '../scripts/speech-engine-config.mjs';

let pendingEngine;

function engineIdOf(engine) {
  return String(engine?.engineId || engine?.speechEngineId || engine?.id || '').trim();
}

export function publicVoiceWsUrl(env = process.env) {
  const configuredUrl = String(env.PUBLIC_WS_URL || '').trim();
  if (configuredUrl) return configuredUrl;

  const productionHost = String(
    env.VERCEL_PROJECT_PRODUCTION_URL || 'credicarros.vercel.app'
  ).trim();

  try {
    const url = new URL(
      /^(?:https?|wss?):\/\//i.test(productionHost)
        ? productionHost
        : `https://${productionHost}`
    );
    url.protocol = 'wss:';
    url.pathname = '/api/voice-ws';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    throw new Error('Não foi possível determinar o endereço público da conversa de voz.');
  }
}

export function speechEngineConfiguration(env = process.env) {
  return buildSpeechEngineConfiguration({
    wsUrl: publicVoiceWsUrl(env),
    voiceId: env.ELEVENLABS_VOICE_ID || DEFAULT_PORTUGUESE_VOICE_ID,
    ttsModel: env.ELEVENLABS_TTS_MODEL || DEFAULT_TTS_MODEL
  });
}

export async function resolveSpeechEngine({
  client,
  configuredEngineId = '',
  configuration
}) {
  const requestedId = String(configuredEngineId || '').trim();

  if (requestedId) {
    const updated = await client.speechEngine.update(requestedId, configuration);
    return engineIdOf(updated) || requestedId;
  }

  const page = await client.speechEngine.list({
    pageSize: 100,
    search: SPEECH_ENGINE_NAME
  });
  const existing = (page?.speechEngines || []).find((engine) => (
    engine.name === SPEECH_ENGINE_NAME ||
    SPEECH_ENGINE_TAGS.every((tag) => engine.tags?.includes(tag))
  ));

  if (existing) {
    const existingId = engineIdOf(existing);
    const updated = await client.speechEngine.update(existingId, configuration);
    return engineIdOf(updated) || existingId;
  }

  const created = await client.speechEngine.create(configuration);
  const createdId = engineIdOf(created);
  if (!createdId) throw new Error('A ElevenLabs não devolveu o identificador do assistente.');
  return createdId;
}

export async function ensureSpeechEngine(env = process.env) {
  if (pendingEngine) return pendingEngine;

  pendingEngine = (async () => {
    const apiKey = String(env.ELEVENLABS_API_KEY || '').trim();
    if (!apiKey) throw new Error('Falta configurar ELEVENLABS_API_KEY.');

    const client = new ElevenLabsClient({ apiKey });
    return resolveSpeechEngine({
      client,
      configuredEngineId: env.ELEVENLABS_SPEECH_ENGINE_ID,
      configuration: speechEngineConfiguration(env)
    });
  })();

  try {
    return await pendingEngine;
  } catch (error) {
    pendingEngine = undefined;
    throw error;
  }
}

export function resetSpeechEngineCacheForTests() {
  pendingEngine = undefined;
}
