import { createHash } from 'node:crypto';

const DEFAULT_ONESIGNAL_APP_ID = 'e519f2ae-52a9-4012-9c63-d885493fae78';
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 5;
const recentByIp = new Map();

function clean(value = '', max = 500) {
  return String(value || '')
    .replace(/[<>]/g, '')
    .replace(/\r/g, '')
    .trim()
    .slice(0, max);
}

function field(text, label, max = 180) {
  const prefix = `${label}:`;
  const line = String(text || '')
    .split('\n')
    .find((entry) => entry.trim().toLowerCase().startsWith(prefix.toLowerCase()));
  return line ? clean(line.trim().slice(prefix.length), max) : '';
}

function clientIp(req) {
  return clean(String(req.headers['x-forwarded-for'] || '').split(',')[0], 80) || 'unknown';
}

function rateAllowed(ip) {
  const now = Date.now();
  const active = (recentByIp.get(ip) || []).filter((time) => now - time < RATE_WINDOW_MS);
  if (active.length >= RATE_LIMIT) {
    recentByIp.set(ip, active);
    return false;
  }
  active.push(now);
  recentByIp.set(ip, active);
  if (recentByIp.size > 500) {
    for (const [key, times] of recentByIp) {
      if (!times.some((time) => now - time < RATE_WINDOW_MS)) recentByIp.delete(key);
    }
  }
  return true;
}

function sameOrigin(req) {
  const origin = clean(req.headers.origin, 240);
  const host = clean(req.headers.host, 240).toLowerCase();
  if (!origin || !host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

function idempotencyKey(text) {
  const bucket = Math.floor(Date.now() / RATE_WINDOW_MS);
  const hex = createHash('sha256').update(`${bucket}:${text}`).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ['8', '9', 'a', 'b'][parseInt(hex[16], 16) % 4];
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function buildLeadNotification(rawText = '') {
  const text = clean(rawText, 2800);
  if (!text.startsWith('Nova lead - Assistente IA')) return null;

  const vehicle = field(text, 'Viatura/Pedido');
  const customer = field(text, 'Cliente', 80);
  const visit = field(text, 'Horário/Visita', 160);
  const selected = field(text, 'Opções selecionadas', 200);
  const hasContact = Boolean(field(text, 'Contacto', 40));

  if (!vehicle || !hasContact) return null;

  const isVisit = Boolean(visit) || /visita/i.test(selected);
  const heading = isVisit ? 'Novo pedido de visita 🚗' : 'Nova lead Credicarros 🚘';
  const parts = [customer || 'Novo cliente', vehicle];
  if (visit) parts.push(visit);

  return {
    heading,
    body: parts.join(' · ').slice(0, 260),
    data: {
      source: 'credicarros',
      kind: isVisit ? 'visit_request' : 'lead',
      vehicle: vehicle.slice(0, 180),
      visit: visit.slice(0, 160)
    }
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'use_post' });
    return;
  }

  if (!sameOrigin(req)) {
    res.status(403).json({ ok: false, error: 'invalid_origin' });
    return;
  }

  if (!rateAllowed(clientIp(req))) {
    res.status(429).json({ ok: false, error: 'rate_limited' });
    return;
  }

  const rawText = clean(req.body?.text, 2800);
  const notification = buildLeadNotification(rawText);
  if (!notification) {
    res.status(400).json({ ok: false, error: 'invalid_lead' });
    return;
  }

  const appId = clean(process.env.ONESIGNAL_APP_ID || DEFAULT_ONESIGNAL_APP_ID, 80);
  const apiKey = clean(process.env.ONESIGNAL_API_KEY || process.env.ONESIGNAL_REST_API_KEY, 500);
  if (!apiKey) {
    res.status(503).json({ ok: false, error: 'onesignal_not_configured' });
    return;
  }

  try {
    const response = await fetch('https://api.onesignal.com/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Key ${apiKey}`
      },
      body: JSON.stringify({
        app_id: appId,
        target_channel: 'push',
        included_segments: ['Active Subscriptions'],
        headings: { en: notification.heading },
        contents: { en: notification.body },
        data: notification.data,
        url: 'https://credicarros.vercel.app',
        name: notification.data.kind === 'visit_request' ? 'Credicarros - pedido de visita' : 'Credicarros - nova lead',
        idempotency_key: idempotencyKey(rawText)
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('OneSignal lead alert failed', { status: response.status, errors: data?.errors });
      res.status(502).json({ ok: false, error: 'onesignal_failed' });
      return;
    }

    res.status(200).json({ ok: true, notification_id: data?.id || null });
  } catch (error) {
    console.error('OneSignal lead alert unavailable', { message: error?.message });
    res.status(502).json({ ok: false, error: 'onesignal_unavailable' });
  }
}
