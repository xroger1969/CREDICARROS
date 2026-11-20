import test from 'node:test';
import assert from 'node:assert/strict';
import { createCredibomClient, normalizeQuote, parsePublicPage, validateInput } from '../lib/credibom.mjs';

const page = `<input value="mock-anti-forgery-token-only-for-testing" name="__RequestVerificationToken">
data_produtogid:"11111111-1111-1111-1111-111111111111",description:"Usado",data_refid:"IDAUTO",status:"USADO",type:"CARRO",amount:{amount_min:"5000",amount_max:"75000",amount_step:"500"},deadline:{deadline_min:"24",deadline_max:"120",deadline_step:"6"}
data_produtogid:"22222222-2222-2222-2222-222222222222",description:"Novo (1º registo)",data_refid:"IDAUTO",status:"NOVO",type:"CARRO",amount:{amount_min:"7500",amount_max:"75000",amount_step:"500"},deadline:{deadline_min:"24",deadline_max:"120",deadline_step:"6"}`;

const example = () => ({ value: { commonOutput: { success: true }, simulacao: {
  mensalidade: 271.08, mtic: 32881.60, tan: 10.2, taeg: 11.614497,
  prazoMaximo: 120, prazoMinimo: 24, montanteMaximo: 75000, montanteMinimo: 5000,
  mensalidadeString: '271,08€', mticString: '32.881,60€', tanString: '10,20%', taegString: '11,61%',
} } });
const input = { amount: 20000, months: 120, vehicleType: 'used' };
const product = parsePublicPage(page).products.used;
const pageResponse = () => new Response(page, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': 'session=mock-cookie; Path=/; Secure; HttpOnly' } });
const jsonResponse = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });

function fakeSource(post = () => jsonResponse(example())) {
  const calls = [];
  return { calls, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return options.method === 'POST' ? post(url, options) : pageResponse();
  } };
}

test('only expected public configuration fields are parsed; no upstream JavaScript executes', () => {
  const parsed = parsePublicPage(page + '\nthrow new Error("must never execute");');
  assert.equal(parsed.products.used.minAmount, 5000);
  assert.equal(parsed.products.new.minAmount, 7500);
  assert.equal(parsed.products.used.amountStep, 500);
  assert.equal(parsed.products.used.monthStep, 6);
  assert.throws(() => parsePublicPage(page.replace('description:"Usado"', 'description:"Unexpected"')), { code: 'SOURCE_CHANGED' });
  assert.throws(() => parsePublicPage(page.replace('name="__RequestVerificationToken"', 'name="other"')), { code: 'SOURCE_CHANGED' });
});

test('invalid, extra customer data, unsupported increments and source limits fail before POST', async () => {
  const fake = fakeSource();
  const client = createCredibomClient(fake);
  for (const bad of [
    { ...input, amount: -1 }, { ...input, amount: Infinity }, { ...input, amount: NaN },
    { ...input, amount: 75001 }, { ...input, months: 121 }, { ...input, months: 12.5 },
    { ...input, amount: '20000' }, { ...input, vehicleType: 'any' }, { ...input, name: 'customer' },
  ]) await assert.rejects(client.simulate(bad), { code: 'INVALID_INPUT' });
  assert.equal(fake.calls.length, 0);
  await assert.rejects(client.simulate({ ...input, amount: 22990 }), { code: 'UNSUPPORTED_INCREMENT' });
  await assert.rejects(client.simulate({ ...input, months: 85 }), { code: 'UNSUPPORTED_INCREMENT' });
  await assert.rejects(client.simulate({ ...input, amount: 5000, vehicleType: 'new' }), { code: 'OUTSIDE_LIMITS' });
  assert.equal(fake.calls.filter(call => call.options.method === 'POST').length, 0);
  assert.doesNotThrow(() => validateInput(input, product));
});

test('source display strings, provenance, requested inputs and units are preserved', async () => {
  const fake = fakeSource();
  const client = createCredibomClient({ ...fake, now: () => Date.UTC(2026, 10, 20, 12) });
  const config = await client.getConfig();
  assert.equal(config.products.used.amountStep, 500);
  assert.equal(config.products.used.productId, undefined);
  const quote = await client.simulate(input);
  assert.deepEqual(quote.display, { payment: '271,08€', mtic: '32.881,60€', tan: '10,20%', taeg: '11,61%' });
  assert.equal(quote.tan, 10.2);
  assert.equal(quote.taeg, 11.614497);
  assert.equal(quote.source.name, 'Banco Credibom');
  assert.equal(quote.retrievedAt, '2026-11-20T12:00:00.000Z');
  assert.equal(quote.amount, input.amount);
  const post = fake.calls.find(call => call.options.method === 'POST');
  assert.deepEqual(JSON.parse(post.options.body), { produtoGID: product.productId, prazo: 120, montante: 20000 });
  assert.equal(post.options.headers.Cookie, 'session=mock-cookie');
  assert.equal(post.options.headers['XSRF-TOKEN'], 'mock-anti-forgery-token-only-for-testing');
  assert.equal(post.options.headers.Origin, undefined);
  assert.equal(post.options.redirect, 'error');
});

test('cache is bounded by exact product, amount and term; timestamp is never refreshed for a cached quote', async () => {
  let clock = Date.UTC(2026, 10, 20, 12);
  const fake = fakeSource();
  const client = createCredibomClient({ ...fake, now: () => clock, quoteTtlMs: 1000, maxCacheEntries: 2 });
  const first = await client.simulate(input);
  clock += 500;
  first.display.payment = 'mutated';
  const cached = await client.simulate(input);
  assert.equal(cached.display.payment, '271,08€');
  assert.equal(cached.retrievedAt, '2026-11-20T12:00:00.000Z');
  assert.equal(fake.calls.length, 2);
  await client.simulate({ ...input, amount: 15000 });
  await client.simulate({ ...input, vehicleType: 'new' });
  await client.simulate(input); // evicted when the third distinct key was added
  assert.equal(fake.calls.filter(call => call.options.method === 'POST').length, 4);
  clock += 1001;
  const fresh = await client.simulate(input);
  assert.equal(fake.calls.filter(call => call.options.method === 'POST').length, 5);
  assert.notEqual(fresh.retrievedAt, cached.retrievedAt);
});

test('concurrent identical quotes share one request; distinct quotes stay separate and are serialized', async () => {
  let active = 0;
  let maximum = 0;
  const fake = fakeSource(async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 3));
    active -= 1;
    return jsonResponse(example());
  });
  const client = createCredibomClient(fake);
  const results = await Promise.all([
    client.simulate(input), client.simulate(input), client.simulate({ ...input, months: 84 }),
  ]);
  assert.equal(fake.calls.filter(call => call.options.method === 'POST').length, 2);
  assert.equal(maximum, 1);
  assert.equal(results[0].months, 120);
  assert.equal(results[2].months, 84);
});

test('schema, formatting, out-of-range and clamped results never become a quote', () => {
  const variants = [
    data => { data.value.commonOutput.success = false; },
    data => { delete data.value.simulacao.mtic; },
    data => { data.value.simulacao.taeg = NaN; },
    data => { data.value.simulacao.mensalidadeString = '100,00€'; },
    data => { data.value.simulacao.tanString = '<b>10,20%</b>'; },
    data => { data.value.simulacao.montanteMaximo = 1000000; },
  ];
  for (const mutate of variants) {
    const data = example();
    mutate(data);
    assert.throws(() => normalizeQuote(data, input, product, '2026-11-20T12:00:00.000Z'), { code: 'SOURCE_CHANGED' });
  }
  const clamped = example();
  clamped.value.simulacao.prazoMaximo = 96;
  assert.throws(() => normalizeQuote(clamped, input, product, '2026-11-20T12:00:00.000Z'), { code: 'SOURCE_LIMITS' });
  // The official public UI sometimes truncates a percentage. Do not independently round it.
  const truncated = example();
  truncated.value.simulacao.taeg = 11.61999;
  assert.equal(normalizeQuote(truncated, input, product, '2026-11-20T12:00:00.000Z').display.taeg, '11,61%');
});

test('upstream refusals are not bypassed/retried and failed results are not cached', async () => {
  let refuse = true;
  let clock = 0;
  const fake = fakeSource(() => refuse ? new Response('Forbidden', { status: 403 }) : jsonResponse(example()));
  const client = createCredibomClient({ ...fake, now: () => clock });
  await assert.rejects(client.simulate(input), { code: 'SOURCE_REFUSED' });
  assert.equal(fake.calls.length, 2);
  refuse = false;
  await assert.rejects(client.simulate(input), { code: 'SOURCE_COOLDOWN', retryAfterSeconds: 60 });
  assert.equal(fake.calls.length, 2);
  clock = 60_000;
  const quote = await client.simulate(input);
  assert.equal(quote.payment, 271.08);
  assert.equal(fake.calls.length, 3);
});

test('429 Retry-After stops queued and future source requests for the whole cooldown', async () => {
  let clock = 0;
  let limited = true;
  const fake = fakeSource(() => limited
    ? new Response('Too many requests', { status: 429, headers: { 'Retry-After': '120' } })
    : jsonResponse(example()));
  const client = createCredibomClient({ ...fake, now: () => clock });
  const results = await Promise.allSettled([
    client.simulate(input),
    client.simulate({ ...input, months: 84 }),
    client.simulate({ ...input, amount: 15000 }),
  ]);
  assert.deepEqual(results.map(result => result.reason.code), ['SOURCE_REFUSED', 'SOURCE_COOLDOWN', 'SOURCE_COOLDOWN']);
  assert.equal(results[0].reason.retryAfterSeconds, 120);
  assert.equal(fake.calls.filter(call => call.options.method === 'POST').length, 1);
  clock = 119_000;
  await assert.rejects(client.getConfig(), { code: 'SOURCE_COOLDOWN', retryAfterSeconds: 1 });
  assert.equal(fake.calls.length, 2);
  clock = 120_000;
  limited = false;
  assert.equal((await client.simulate(input)).payment, 271.08);
  assert.equal(fake.calls.filter(call => call.options.method === 'POST').length, 2);
});

test('HTTP-date Retry-After is respected and refusals invalidate previously cached quotes', async () => {
  let clock = Date.UTC(2026, 10, 20, 12);
  let limited = false;
  const fake = fakeSource(() => limited
    ? new Response('Unavailable', { status: 403, headers: { 'Retry-After': 'Fri, 20 Nov 2026 12:03:00 GMT' } })
    : jsonResponse(example()));
  const client = createCredibomClient({ ...fake, now: () => clock, quoteTtlMs: 600_000 });
  await client.simulate(input);
  limited = true;
  await assert.rejects(client.simulate({ ...input, months: 84 }), { code: 'SOURCE_REFUSED', retryAfterSeconds: 180 });
  await assert.rejects(client.simulate(input), { code: 'SOURCE_COOLDOWN' });
  clock += 180_000;
  limited = false;
  const quote = await client.simulate(input);
  assert.equal(quote.retrievedAt, '2026-11-20T12:03:00.000Z');
  assert.equal(fake.calls.filter(call => call.options.method === 'POST').length, 3);
});

test('expired valid quote is not served when the source subsequently fails', async () => {
  let clock = 0;
  let failing = false;
  const fake = fakeSource(() => {
    if (failing) throw new Error('offline');
    return jsonResponse(example());
  });
  const client = createCredibomClient({ ...fake, now: () => clock, quoteTtlMs: 100 });
  await client.simulate(input);
  clock = 101;
  failing = true;
  await assert.rejects(client.simulate(input), { code: 'SOURCE_UNAVAILABLE' });
});

test('a slow source times out without any local-rate fallback', async () => {
  const client = createCredibomClient({ timeoutMs: 10, fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }) });
  await assert.rejects(client.simulate(input), { code: 'SOURCE_UNAVAILABLE' });
});
