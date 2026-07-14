const attempts = new Map();
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 30;

export const DEFAULT_TTS_VOICE_ID = 'RROBrqjHiRb8zmRgGV11';
export const DEFAULT_TTS_MODEL = 'eleven_multilingual_v2';

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

export function cleanSpeechText(value) {
  return String(value || '')
    .replace(/[<>]/g, '')
    .replace(/https?:\/\/\S+/gi, 'link do anúncio')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 900);
}

function requestBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body !== 'string') return {};
  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  noStore(res);
  const apiKey = String(process.env.ELEVENLABS_API_KEY || '').trim();

  if (req.method === 'GET') {
    res.status(200).json({ configured: Boolean(apiKey) });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST.' });
    return;
  }

  if (!apiKey) {
    res.status(503).json({ error: 'A voz ainda não está configurada.' });
    return;
  }

  if (!isSameOrigin(req)) {
    res.status(403).json({ error: 'Origem não autorizada.' });
    return;
  }

  if (isRateLimited(req)) {
    res.status(429).json({ error: 'Demasiados pedidos de voz. Aguarde um minuto.' });
    return;
  }

  const text = cleanSpeechText(requestBody(req).text);
  if (!text) {
    res.status(400).json({ error: 'Falta o texto da resposta.' });
    return;
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_TTS_VOICE_ID;
  const modelId = process.env.ELEVENLABS_TTS_MODEL || DEFAULT_TTS_MODEL;

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': apiKey
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          voice_settings: {
            stability: 0.38,
            similarity_boost: 0.8,
            style: 0.18,
            use_speaker_boost: true,
            speed: 0.98
          },
          apply_text_normalization: 'auto'
        }),
        signal: AbortSignal.timeout(25_000)
      }
    );

    if (!response.ok) {
      console.error('[tts] A ElevenLabs recusou o pedido:', response.status);
      res.status(502).json({ error: 'Não foi possível gerar a voz desta resposta.' });
      return;
    }

    const audio = Buffer.from(await response.arrayBuffer());
    res.statusCode = 200;
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', String(audio.length));
    res.end(audio);
  } catch (error) {
    console.error('[tts] Falha ao gerar áudio:', error?.message || 'erro desconhecido');
    res.status(502).json({ error: 'Não foi possível ligar ao serviço de voz.' });
  }
}
