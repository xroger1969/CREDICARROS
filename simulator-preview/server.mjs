import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
import { createCredibomClient, QuoteError } from './lib/credibom.mjs';

const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new QuoteError('CONTENT_TYPE', 'Envie os dados no formato JSON.', 415);
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 2048) throw new QuoteError('BODY_TOO_LARGE', 'O pedido é demasiado grande.', 413);
  }
  try { return JSON.parse(body); } catch { throw new QuoteError('INVALID_JSON', 'Os dados enviados não são válidos.', 400); }
}

export function createPreviewServer({ client = createCredibomClient(), publicDir = PUBLIC_DIR } = {}) {
  const recent = new Map();
  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const host = req.headers.host;
      let url;
      try { url = new URL(req.url, `http://${host}`); } catch { throw new QuoteError('INVALID_REQUEST', 'Pedido inválido.', 400); }
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || (req.headers.origin && req.headers.origin !== url.origin)) {
        throw new QuoteError('LOCAL_ONLY', 'Este protótipo está disponível apenas no acesso local.', 403);
      }
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new QuoteError('LOCAL_ONLY', 'Pedido externo não permitido.', 403);
      if (url.pathname.startsWith('/api/')) {
        const key = req.socket.remoteAddress || 'local';
        const now = Date.now();
        const entries = (recent.get(key) || []).filter(time => now - time < 60_000);
        if (entries.length >= 40) {
          res.setHeader('Retry-After', '60');
          throw new QuoteError('RATE_LIMIT', 'Aguarde um minuto antes de realizar mais consultas.', 429);
        }
        entries.push(now);
        recent.set(key, entries);
        if (['/api/config', '/api/credit-config'].includes(url.pathname) && req.method === 'GET') return json(res, 200, await client.getConfig());
        if (['/api/simulate', '/api/credit-simulation'].includes(url.pathname) && req.method === 'POST') return json(res, 200, { quote: await client.simulate(await readJson(req)) });
        if (['/api/config', '/api/simulate', '/api/credit-config', '/api/credit-simulation'].includes(url.pathname)) throw new QuoteError('METHOD_NOT_ALLOWED', 'Método não permitido.', 405);
        throw new QuoteError('NOT_FOUND', 'Pedido não encontrado.', 404);
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw new QuoteError('METHOD_NOT_ALLOWED', 'Método não permitido.', 405);
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { throw new QuoteError('INVALID_REQUEST', 'Pedido inválido.', 400); }
      const path = resolve(publicDir, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!path.startsWith(resolve(publicDir) + '/') || !TYPES[extname(path)]) throw new QuoteError('NOT_FOUND', 'Página não encontrada.', 404);
      let data;
      try { data = await readFile(path); } catch { throw new QuoteError('NOT_FOUND', 'Página não encontrada.', 404); }
      res.writeHead(200, { 'Content-Type': TYPES[extname(path)], 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      const failure = error instanceof QuoteError ? error : new QuoteError('INTERNAL_ERROR', 'Não foi possível concluir esta consulta.', 500);
      if (failure.retryAfterSeconds) res.setHeader('Retry-After', String(failure.retryAfterSeconds));
      if (!res.headersSent) json(res, failure.status, { error: { code: failure.code, message: failure.message, ...(failure.limits ? { limits: failure.limits } : {}), ...(failure.retryAfterSeconds ? { retryAfterSeconds: failure.retryAfterSeconds } : {}) } });
      else res.end();
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.SIMULATOR_PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SIMULATOR_PORT inválido.');
  createPreviewServer().listen(port, '127.0.0.1', () => {
    console.log(`CREDICARROS — protótipo interno: http://127.0.0.1:${port}`);
  });
}
