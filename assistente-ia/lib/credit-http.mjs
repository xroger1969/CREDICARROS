import { createCredibomClient, QuoteError, validateInput } from './credit-simulator.mjs';

const ALLOWED_ORIGINS = new Set(['https://xroger1969.github.io', 'https://credicarros.vercel.app']);
const MAX_BODY_BYTES = 2048;
const WINDOW_MS = 60_000;

export function isAllowedOrigin(origin, production = process.env.NODE_ENV === 'production') {
  if (!origin) return true; // Direct/server-side HTTP is not governed by CORS.
  if (typeof origin !== 'string') return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  if (production) return false;
  try {
    const url = new URL(origin);
    return url.origin === origin && ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch { return false; }
}

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

async function bodyJson(req) {
  const contentType = req.headers['content-type'];
  if (typeof contentType !== 'string' || !/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new QuoteError('CONTENT_TYPE', 'Envie os dados no formato JSON.', 415);
  }
  const declaredSize = req.headers['content-length'];
  if (declaredSize !== undefined && (!/^\d+$/.test(String(declaredSize)) || Number(declaredSize) > MAX_BODY_BYTES)) {
    throw new QuoteError('BODY_TOO_LARGE', 'O pedido é demasiado grande.', 413);
  }
  let body = req.body;
  if (body === undefined) {
    const parts = [];
    let size = 0;
    for await (const chunk of req) {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += part.byteLength;
      if (size > MAX_BODY_BYTES) throw new QuoteError('BODY_TOO_LARGE', 'O pedido é demasiado grande.', 413);
      parts.push(part);
    }
    body = Buffer.concat(parts).toString('utf8');
  }
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') {
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new QuoteError('BODY_TOO_LARGE', 'O pedido é demasiado grande.', 413);
    try { body = JSON.parse(body); } catch { throw new QuoteError('INVALID_JSON', 'Os dados enviados não são válidos.', 400); }
  } else {
    let encoded;
    try { encoded = JSON.stringify(body); } catch { throw new QuoteError('INVALID_JSON', 'Os dados enviados não são válidos.', 400); }
    if (!encoded || Buffer.byteLength(encoded) > MAX_BODY_BYTES) throw new QuoteError('BODY_TOO_LARGE', 'O pedido é demasiado grande.', 413);
  }
  return body;
}

function requestAddress(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.socket?.remoteAddress || 'unknown').slice(0, 128);
}

// Limits and cooldowns are in-memory safeguards for one running instance.
// They are not authentication and do not claim a distributed/global quota.
export function createCreditHandlers({ client = createCredibomClient(), now = Date.now, production = process.env.NODE_ENV === 'production', perIpLimit = 30, instanceLimit = 120 } = {}) {
  const clients = new Map();
  let recent = [];

  function checkRate(req) {
    const time = now();
    recent = recent.filter(timestamp => time - timestamp < WINDOW_MS);
    for (const [key, value] of clients) {
      const live = value.filter(timestamp => time - timestamp < WINDOW_MS);
      if (live.length) clients.set(key, live);
      else clients.delete(key);
    }
    const address = requestAddress(req);
    const activity = clients.get(address) || [];
    if (recent.length >= instanceLimit || activity.length >= perIpLimit) {
      throw new QuoteError('RATE_LIMIT', 'Aguarde um minuto antes de realizar mais consultas.', 429, undefined, 60);
    }
    // Bound memory even if different addresses reach the same process.
    if (!clients.has(address) && clients.size >= 1000) {
      throw new QuoteError('RATE_LIMIT', 'Existem várias consultas em curso. Tente novamente dentro de instantes.', 429, undefined, 60);
    }
    activity.push(time);
    clients.set(address, activity);
    recent.push(time);
  }

  function handler(method, operation) {
    return async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Vary', 'Origin');
      try {
        const origin = req.headers.origin;
        if (!isAllowedOrigin(origin, production)) throw new QuoteError('ORIGIN_NOT_ALLOWED', 'Esta origem não tem acesso à consulta.', 403);
        if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', `${method}, OPTIONS`);
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Expose-Headers', 'Retry-After');
        if (req.method === 'OPTIONS') {
          const requestedMethod = req.headers['access-control-request-method'];
          if (requestedMethod && requestedMethod !== method) throw new QuoteError('METHOD_NOT_ALLOWED', 'Método não permitido.', 405);
          const requestedHeaders = String(req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
          if (requestedHeaders.some(value => value !== 'content-type')) throw new QuoteError('HEADERS_NOT_ALLOWED', 'Cabeçalhos não permitidos.', 400);
          res.statusCode = 204;
          return res.end();
        }
        if (req.method !== method) {
          res.setHeader('Allow', `${method}, OPTIONS`);
          throw new QuoteError('METHOD_NOT_ALLOWED', 'Método não permitido.', 405);
        }
        checkRate(req);
        return json(res, 200, await operation(req));
      } catch (error) {
        const failure = error instanceof QuoteError ? error : new QuoteError('INTERNAL_ERROR', 'Não foi possível concluir esta consulta.', 500);
        if (failure.retryAfterSeconds) res.setHeader('Retry-After', String(failure.retryAfterSeconds));
        return json(res, failure.status, { error: {
          code: failure.code,
          message: failure.message,
          ...(failure.limits ? { limits: failure.limits } : {}),
          ...(failure.retryAfterSeconds ? { retryAfterSeconds: failure.retryAfterSeconds } : {}),
        } });
      }
    };
  }

  return {
    config: handler('GET', async () => client.getConfig()),
    simulation: handler('POST', async req => {
      const input = await bodyJson(req);
      validateInput(input);
      return { quote: await client.simulate(input) };
    }),
  };
}

export const creditHandlers = createCreditHandlers();
