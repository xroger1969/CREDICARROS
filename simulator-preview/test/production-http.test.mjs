import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createCreditHandlers, isAllowedOrigin } from '../../assistente-ia/lib/credit-http.mjs';
import { QuoteError } from '../../assistente-ia/lib/credit-simulator.mjs';

const valid = { amount: 20000, months: 120, vehicleType: 'used' };
function req({ method = 'POST', origin = 'https://xroger1969.github.io', body = valid, headers = {}, raw } = {}) {
  const request = Readable.from(raw === undefined ? [] : [raw]);
  request.method = method;
  request.headers = { 'content-type': 'application/json', origin, ...headers };
  request.socket = { remoteAddress: '127.0.0.1' };
  if (raw === undefined) request.body = body;
  return request;
}
function res() {
  return { headers: {}, statusCode: 200,
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    end(body) { this.body = body; },
  };
}
const json = response => JSON.parse(response.body);

test('production CORS permits only exact declared origins, no wildcard or credentials', async () => {
  let calls = 0;
  const handlers = createCreditHandlers({ production: true, client: { getConfig: async () => { calls++; return { products: {} }; } } });
  for (const origin of ['https://xroger1969.github.io', 'https://credicarros.vercel.app']) {
    const response = res();
    await handlers.config(req({ method: 'GET', origin }), response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['access-control-allow-origin'], origin);
    assert.equal(response.headers['access-control-allow-credentials'], undefined);
  }
  for (const origin of ['https://evil.invalid', 'https://xroger1969.github.io.evil.invalid', 'https://credicarros.vercel.app/', 'null', 'http://localhost:4173']) {
    const response = res();
    await handlers.config(req({ method: 'GET', origin }), response);
    assert.equal(response.statusCode, 403);
    assert.equal(response.headers['access-control-allow-origin'], undefined);
  }
  assert.equal(calls, 2);
  assert.equal(isAllowedOrigin('http://localhost:4173', false), true);
  assert.equal(isAllowedOrigin('http://127.0.0.1:4173', false), true);
  assert.equal(isAllowedOrigin('http://localhost:4173/path', false), false);
});

test('OPTIONS is empty 204 and does not call the source; methods and preflight headers are restricted', async () => {
  let called = false;
  const handlers = createCreditHandlers({ client: { simulate: async () => { called = true; } } });
  const preflight = res();
  await handlers.simulation(req({ method: 'OPTIONS', headers: { 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } }), preflight);
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.body, undefined);
  assert.equal(called, false);
  const method = res();
  await handlers.simulation(req({ method: 'GET' }), method);
  assert.equal(method.statusCode, 405);
  const headers = res();
  await handlers.simulation(req({ method: 'OPTIONS', headers: { 'access-control-request-headers': 'authorization' } }), headers);
  assert.equal(headers.statusCode, 400);
});

test('production POST accepts parsed or streamed JSON and rejects size, type, unknown personal fields and malformed inputs', async () => {
  let calls = 0;
  const handlers = createCreditHandlers({ client: { simulate: async input => { calls++; return { ...input, payment: 271.08 }; } } });
  for (const request of [req(), req({ body: JSON.stringify(valid) }), req({ raw: JSON.stringify(valid) })]) {
    const response = res();
    await handlers.simulation(request, response);
    assert.equal(response.statusCode, 200);
    assert.equal(json(response).quote.payment, 271.08);
  }
  const cases = [
    [req({ body: { ...valid, cliente_nome: 'Never forward personal data' } }), 400],
    [req({ body: { ...valid, amount: -1 } }), 400],
    [req({ body: '{' }), 400],
    [req({ headers: { 'content-type': 'text/plain' } }), 415],
    [req({ headers: { 'content-length': '99999' } }), 413],
    [req({ body: 'x'.repeat(2049) }), 413],
    [req({ raw: 'x'.repeat(2049) }), 413],
  ];
  for (const [request, expected] of cases) {
    const response = res();
    await handlers.simulation(request, response);
    assert.equal(response.statusCode, expected);
  }
  assert.equal(calls, 3);
});

test('source cooldown is exposed with Retry-After and error JSON; per-IP and instance limits stop work', async () => {
  const refused = createCreditHandlers({ client: { getConfig: async () => { throw new QuoteError('SOURCE_COOLDOWN', 'Aguarde.', 503, undefined, 90); } } });
  const response = res();
  await refused.config(req({ method: 'GET' }), response);
  assert.equal(response.statusCode, 503);
  assert.equal(response.headers['retry-after'], '90');
  assert.equal(json(response).error.retryAfterSeconds, 90);
  let calls = 0;
  let clock = 0;
  const limited = createCreditHandlers({ now: () => clock, perIpLimit: 1, instanceLimit: 2, client: { getConfig: async () => { calls++; return {}; } } });
  const first = res();
  await limited.config(req({ method: 'GET' }), first);
  assert.equal(first.statusCode, 200);
  const repeat = res();
  await limited.config(req({ method: 'GET' }), repeat);
  assert.equal(repeat.statusCode, 429);
  const other = res();
  await limited.config(req({ method: 'GET', headers: { 'x-forwarded-for': '192.0.2.1' } }), other);
  assert.equal(other.statusCode, 200);
  const global = res();
  await limited.config(req({ method: 'GET', headers: { 'x-forwarded-for': '192.0.2.2' } }), global);
  assert.equal(global.statusCode, 429);
  assert.equal(calls, 2);
  clock = 60_001;
  const recovered = res();
  await limited.config(req({ method: 'GET' }), recovered);
  assert.equal(recovered.statusCode, 200);
});
