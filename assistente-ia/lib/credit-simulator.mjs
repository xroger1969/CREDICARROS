// Reads only the public, anonymous simulator. This is not a supported bank API.
// No application, customer data, credit decision or authenticated account is used.
export const SOURCE = Object.freeze({
  name: 'Banco Credibom',
  url: 'https://www.credibom.pt/credito/automovel',
  channel: 'public',
});
const ENDPOINT = 'https://www.credibom.pt/umbraco/Api/Simulador/CallSimulacaoS';
const USER_AGENT = 'CREDICARROS-compatibility-check/0.1';
const MAX_AMOUNT = 75000;
const MAX_MONTHS = 120;

export class QuoteError extends Error {
  constructor(code, message, status = 502, limits, retryAfterSeconds) {
    super(message);
    this.name = 'QuoteError';
    this.code = code;
    this.status = status;
    if (limits) this.limits = limits;
    if (retryAfterSeconds) this.retryAfterSeconds = retryAfterSeconds;
  }
}

const unavailable = () => new QuoteError('SOURCE_UNAVAILABLE', 'Não foi possível confirmar os valores neste momento. Tente novamente dentro de instantes.');
const changed = () => new QuoteError('SOURCE_CHANGED', 'A fonte devolveu dados que não foi possível validar. Não foi apresentada uma estimativa.');

function decodeEntities(text) {
  return text.replace(/&#x([\da-f]+);|&#(\d+);|&(amp|quot|apos|lt|gt);/gi, (all, hex, decimal, named) => {
    if (hex || decimal) {
      const code = parseInt(hex || decimal, hex ? 16 : 10);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
    }
    return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' }[named.toLowerCase()];
  });
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match ? decodeEntities(match[2]) : null;
}

function publicNumber(block, key) {
  const value = block.match(new RegExp(`\\b${key}\\s*:\\s*"(\\d+)"`));
  if (!value) throw changed();
  return Number(value[1]);
}

// Parse the small, allowlisted configuration fields; never execute upstream JS.
export function parsePublicPage(html) {
  if (typeof html !== 'string' || html.length > 2_000_000) throw changed();
  const tokens = [...html.matchAll(/<input\b[^>]*>/gi)]
    .map(match => match[0])
    .filter(tag => attribute(tag, 'name') === '__RequestVerificationToken')
    .map(tag => attribute(tag, 'value'));
  const token = tokens.find(value => value && value.length >= 20 && value.length < 4096 && !/[\r\n]/.test(value));
  if (!token) throw changed();

  const positions = [...html.matchAll(/\bdata_produtogid\s*:\s*"([a-f\d-]{36})"/gi)];
  const products = {};
  for (let index = 0; index < positions.length; index++) {
    const match = positions[index];
    const end = Math.min(positions[index + 1]?.index ?? html.length, match.index + 2200);
    const block = html.slice(match.index, end);
    const description = block.match(/\bdescription\s*:\s*"([^"]+)"/)?.[1];
    const vehicleType = description === 'Usado' ? 'used' : description === 'Novo (1º registo)' ? 'new' : null;
    if (!vehicleType || !/\btype\s*:\s*"CARRO"/.test(block) || !/\bdata_refid\s*:\s*"IDAUTO"/.test(block)) continue;
    const amount = block.match(/\bamount\s*:\s*\{([^{}]+)\}/)?.[1];
    const deadline = block.match(/\bdeadline\s*:\s*\{([^{}]+)\}/)?.[1];
    if (!amount || !deadline) throw changed();
    const product = {
      productId: match[1],
      minAmount: publicNumber(amount, 'amount_min'),
      maxAmount: publicNumber(amount, 'amount_max'),
      amountStep: publicNumber(amount, 'amount_step'),
      minMonths: publicNumber(deadline, 'deadline_min'),
      maxMonths: publicNumber(deadline, 'deadline_max'),
      monthStep: publicNumber(deadline, 'deadline_step'),
    };
    if (product.minAmount <= 0 || product.maxAmount > MAX_AMOUNT || product.maxAmount < product.minAmount ||
        product.minMonths <= 0 || product.maxMonths > MAX_MONTHS || product.maxMonths < product.minMonths ||
        product.amountStep <= 0 || product.monthStep <= 0) throw changed();
    if (products[vehicleType] && JSON.stringify(products[vehicleType]) !== JSON.stringify(product)) throw changed();
    products[vehicleType] = product;
  }
  if (!products.used || !products.new) throw changed();
  return { token, products };
}

function publicLimits(product) {
  const { productId, ...limits } = product;
  return limits;
}

export function validateInput(input, product) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !['amount', 'months', 'vehicleType'].includes(key)) ||
      !['used', 'new'].includes(input.vehicleType) ||
      !Number.isFinite(input.amount) || input.amount <= 0 || input.amount > MAX_AMOUNT ||
      !Number.isInteger(input.amount) ||
      !Number.isInteger(input.months) || input.months <= 0 || input.months > MAX_MONTHS) {
    throw new QuoteError('INVALID_INPUT', 'Indique um montante válido, um prazo em meses e o tipo de viatura.', 400);
  }
  if (!product) return;
  const limits = publicLimits(product);
  if (input.amount < product.minAmount || input.amount > product.maxAmount ||
      input.months < product.minMonths || input.months > product.maxMonths) {
    throw new QuoteError('OUTSIDE_LIMITS', `Para esta viatura, o montante deve estar entre ${product.minAmount} € e ${product.maxAmount} € e o prazo entre ${product.minMonths} e ${product.maxMonths} meses.`, 422, limits);
  }
  if (input.amount % product.amountStep !== 0 || input.months % product.monthStep !== 0) {
    throw new QuoteError('UNSUPPORTED_INCREMENT', `A simulação pública usa montantes em incrementos de ${product.amountStep} € e prazos em incrementos de ${product.monthStep} meses. O valor não foi arredondado.`, 422, limits);
  }
}

function displayNumber(value, suffix) {
  if (typeof value !== 'string' || value.length > 50 || !value.trim().endsWith(suffix)) throw changed();
  const numeric = value.trim().slice(0, -1).replace(/[\s\u00a0]/g, '');
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(numeric)) throw changed();
  return Number(numeric.replace(/\./g, '').replace(',', '.'));
}

export function normalizeQuote(payload, input, product, retrievedAt) {
  if (payload?.value?.commonOutput?.success !== true) throw changed();
  const result = payload.value.simulacao;
  if (!result || typeof result !== 'object') throw changed();
  for (const key of ['mensalidade', 'mtic', 'tan', 'taeg', 'prazoMaximo', 'prazoMinimo', 'montanteMaximo', 'montanteMinimo']) {
    if (typeof result[key] !== 'number' || !Number.isFinite(result[key]) || result[key] < 0) throw changed();
  }
  if (result.mensalidade <= 0 || result.mtic < input.amount || result.tan > 100 || result.taeg > 200) throw changed();
  const limits = {
    minAmount: result.montanteMinimo,
    maxAmount: result.montanteMaximo,
    amountStep: product.amountStep,
    minMonths: result.prazoMinimo,
    maxMonths: result.prazoMaximo,
    monthStep: product.monthStep,
  };
  if (limits.minAmount > limits.maxAmount || limits.maxAmount > MAX_AMOUNT || limits.maxMonths > MAX_MONTHS ||
      limits.minMonths > limits.maxMonths || limits.minAmount <= 0 || limits.minMonths <= 0) throw changed();
  if (input.amount < limits.minAmount || input.amount > limits.maxAmount || input.months < limits.minMonths || input.months > limits.maxMonths) {
    throw new QuoteError('SOURCE_LIMITS', 'A fonte não permite este montante e prazo em conjunto. Ajuste os dados aos limites indicados.', 422, limits);
  }
  const display = { payment: result.mensalidadeString, tan: result.tanString, taeg: result.taegString, mtic: result.mticString };
  const comparisons = [
    [display.payment, '€', result.mensalidade, 0.00501],
    [display.mtic, '€', result.mtic, 0.00501],
    [display.tan, '%', result.tan, 0.01001],
    // Preserve the source's representation, including its rounding convention.
    [display.taeg, '%', result.taeg, 0.01001],
  ];
  for (const [value, suffix, numeric, tolerance] of comparisons) {
    if (Math.abs(displayNumber(value, suffix) - numeric) > tolerance) throw changed();
  }
  return {
    amount: input.amount,
    months: input.months,
    vehicleType: input.vehicleType,
    payment: result.mensalidade,
    tan: result.tan,
    taeg: result.taeg,
    mtic: result.mtic,
    display,
    retrievedAt,
    source: { ...SOURCE },
    limits,
  };
}

export function createCredibomClient({ fetchImpl = globalThis.fetch, now = Date.now, quoteTtlMs = 60_000, sessionTtlMs = 300_000, timeoutMs = 15_000, maxCacheEntries = 200, refusalCooldownMs = 60_000 } = {}) {
  let session = null;
  let sessionPromise = null;
  let queue = Promise.resolve();
  let queued = 0;
  let blockedUntil = 0;
  const cache = new Map();
  const inflight = new Map();

  function checkCooldown() {
    if (now() < blockedUntil) {
      throw new QuoteError('SOURCE_COOLDOWN', 'A fonte pediu uma pausa nas consultas. Tente novamente mais tarde.', 503, undefined, Math.ceil((blockedUntil - now()) / 1000));
    }
  }

  function startCooldown(retryAfter) {
    let duration = refusalCooldownMs;
    if (typeof retryAfter === 'string' && /^\d+$/.test(retryAfter.trim())) {
      duration = Math.max(duration, Number(retryAfter.trim()) * 1000);
    } else if (typeof retryAfter === 'string') {
      const date = Date.parse(retryAfter);
      if (Number.isFinite(date)) duration = Math.max(duration, date - now());
    }
    // Honor Retry-After for queued and future requests on this running instance.
    blockedUntil = Math.max(blockedUntil, now() + duration);
    cache.clear();
    return Math.ceil(duration / 1000);
  }

  async function request(url, options, maxSize) {
    checkCooldown();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { ...options, redirect: 'error', signal: controller.signal });
      if (!response.ok) {
        // A refusal is reported, not retried through another identity or route.
        if ([401, 403, 429].includes(response.status)) {
          const retryAfterSeconds = startCooldown(response.headers.get('retry-after'));
          throw new QuoteError('SOURCE_REFUSED', 'A fonte não está disponível para esta consulta. Não foi apresentada uma estimativa.', 503, undefined, retryAfterSeconds);
        }
        throw unavailable();
      }
      const contentType = response.headers.get('content-type') || '';
      if (Number(response.headers.get('content-length')) > maxSize) throw changed();
      let length = 0;
      const parts = [];
      if (response.body) {
        for await (const chunk of response.body) {
          length += chunk.byteLength;
          if (length > maxSize) { controller.abort(); throw changed(); }
          parts.push(Buffer.from(chunk));
        }
      }
      return { text: Buffer.concat(parts).toString('utf8'), headers: response.headers, contentType };
    } catch (error) {
      if (error instanceof QuoteError) throw error;
      throw unavailable();
    } finally {
      clearTimeout(timeout);
    }
  }

  async function getSession() {
    checkCooldown();
    if (session && now() - session.createdAt < sessionTtlMs) return session;
    if (!sessionPromise) {
      sessionPromise = (async () => {
        const response = await request(SOURCE.url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } }, 2_000_000);
        if (!response.contentType.includes('text/html')) throw changed();
        const parsed = parsePublicPage(response.text);
        const cookies = response.headers.getSetCookie().map(cookie => cookie.split(';')[0]).filter(cookie => /^[^\s=;,]+=[^\r\n;]*$/.test(cookie));
        if (!cookies.length) throw changed();
        session = { ...parsed, cookie: cookies.join('; '), createdAt: now() };
        return session;
      })().finally(() => { sessionPromise = null; });
    }
    return sessionPromise;
  }

  async function getConfig() {
    const current = await getSession();
    return {
      products: Object.fromEntries(Object.entries(current.products).map(([key, product]) => [key, publicLimits(product)])),
      source: { ...SOURCE },
      retrievedAt: new Date(current.createdAt).toISOString(),
      quoteTtlSeconds: Math.floor(quoteTtlMs / 1000),
    };
  }

  async function loadQuote(input) {
    const current = await getSession();
    const product = current.products[input.vehicleType];
    validateInput(input, product);
    const response = await request(ENDPOINT, {
      method: 'POST',
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', 'Content-Type': 'application/json', 'XSRF-TOKEN': current.token, Cookie: current.cookie },
      body: JSON.stringify({ produtoGID: product.productId, prazo: input.months, montante: input.amount }),
    }, 100_000);
    if (!response.contentType.includes('application/json')) throw changed();
    let payload;
    try { payload = JSON.parse(response.text); } catch { throw changed(); }
    return normalizeQuote(payload, input, product, new Date(now()).toISOString());
  }

  async function simulate(input) {
    validateInput(input);
    checkCooldown();
    const normalized = { amount: input.amount, months: input.months, vehicleType: input.vehicleType };
    const key = `${normalized.vehicleType}:${normalized.amount}:${normalized.months}`;
    const hit = cache.get(key);
    if (hit && now() - hit.cachedAt < quoteTtlMs) return structuredClone(hit.quote);
    cache.delete(key);
    if (inflight.has(key)) return structuredClone(await inflight.get(key));
    if (queued >= 20) throw new QuoteError('BUSY', 'Existem várias consultas em curso. Tente novamente dentro de instantes.', 429);
    queued += 1;
    // Serialize distinct requests to keep volume low; concurrent identical inputs share a request.
    const operation = queue.then(() => loadQuote(normalized));
    queue = operation.catch(() => {});
    const pending = operation.then(quote => {
      for (const [cachedKey, value] of cache) if (now() - value.cachedAt >= quoteTtlMs) cache.delete(cachedKey);
      while (cache.size >= maxCacheEntries) cache.delete(cache.keys().next().value);
      cache.set(key, { quote, cachedAt: now() });
      return quote;
    }).finally(() => { queued -= 1; inflight.delete(key); });
    inflight.set(key, pending);
    return structuredClone(await pending);
  }

  return { getConfig, simulate };
}
