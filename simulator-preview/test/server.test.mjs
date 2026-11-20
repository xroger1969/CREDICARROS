import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createPreviewServer } from '../server.mjs';
import { QuoteError } from '../lib/credibom.mjs';

async function withServer(client, run) {
  const server = createPreviewServer({ client });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('HTTP endpoints use the agreed quote/config envelope and do not expose internal errors', async () => {
  let received;
  await withServer({
    getConfig: async () => ({ products: { used: { minAmount: 5000, amountStep: 500 } } }),
    simulate: async input => { received = input; return { amount: input.amount, payment: 271.08 }; },
  }, async base => {
    const config = await fetch(`${base}/api/config`);
    assert.equal(config.status, 200);
    assert.equal((await config.json()).products.used.amountStep, 500);
    const result = await fetch(`${base}/api/simulate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: 20000, months: 120, vehicleType: 'used' }) });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).quote.payment, 271.08);
    assert.equal(received.months, 120);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(`${base}/api/simulate`)).status, 405);
  });
  await withServer({ getConfig: async () => { throw new Error('secret upstream details'); } }, async base => {
    const response = await fetch(`${base}/api/config`);
    assert.equal(response.status, 500);
    assert.equal((await response.json()).error.code, 'INTERNAL_ERROR');
  });
});

test('source limit errors are returned intact and local endpoints reject cross-origin access', async () => {
  await withServer({ simulate: async () => { throw new QuoteError('SOURCE_LIMITS', 'Prazo não disponível.', 422, { maxMonths: 96 }); } }, async base => {
    const response = await fetch(`${base}/api/simulate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.limits.maxMonths, 96);
    const external = await fetch(`${base}/api/config`, { headers: { Origin: 'https://example.invalid' } });
    assert.equal(external.status, 403);
    const malformed = await fetch(`${base}/api/simulate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    assert.equal(malformed.status, 400);
  });
});
