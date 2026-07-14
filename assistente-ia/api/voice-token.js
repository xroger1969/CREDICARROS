import { ensureSpeechEngine } from '../lib/voice-engine.js';

const attempts = new Map();
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 5;

function noStore(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
}

function isSameOrigin(req) {
  const origin = req.headers.origin;
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const host = forwardedHost || req.headers.host;
  if (!origin || !host) return false;

  try {
    const url = new URL(origin);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    return url.host === host && (url.protocol === 'https:' || local);
  } catch {
    return false;
  }
}

function isRateLimited(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const key = forwarded || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const current = attempts.get(key);

  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }

  current.count += 1;
  return current.count > MAX_ATTEMPTS;
}

export default async function handler(req, res) {
  noStore(res);
  const apiKey = process.env.ELEVENLABS_API_KEY;

  if (req.method === 'GET') {
    if (!apiKey) {
      res.status(200).json({ configured: false });
      return;
    }

    try {
      await ensureSpeechEngine();
      res.status(200).json({ configured: true });
    } catch (error) {
      console.error('[voice] Configuração ElevenLabs indisponível:', error?.message || 'erro desconhecido');
      res.status(200).json({ configured: false });
    }
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST.' });
    return;
  }

  if (!apiKey) {
    res.status(503).json({ error: 'A conversa de voz ainda não está configurada.' });
    return;
  }

  if (!isSameOrigin(req)) {
    res.status(403).json({ error: 'Origem não autorizada.' });
    return;
  }

  if (isRateLimited(req)) {
    res.status(429).json({ error: 'Demasiadas tentativas. Aguarde um minuto e tente novamente.' });
    return;
  }

  try {
    const engineId = await ensureSpeechEngine();
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${encodeURIComponent(engineId)}`,
      {
        headers: { 'xi-api-key': apiKey },
        signal: AbortSignal.timeout(10_000)
      }
    );
    const data = await response.json();

    if (!response.ok || !data.token) {
      res.status(response.status || 502).json({ error: 'Não foi possível iniciar a conversa de voz.' });
      return;
    }

    res.status(200).json({ token: data.token });
  } catch {
    res.status(502).json({ error: 'Não foi possível ligar ao serviço de voz.' });
  }
}
