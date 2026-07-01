const STOCK_URL = process.env.STOCK_URL || 'https://spremium.standvirtual.com/inventory';

const BAD_TITLE_PATTERNS = /[{}`;]|height\s*:|width\s*:|object-fit|cursor\s*:|\.ooa-|css|style|function|var\(|url\(|svg|path\b/i;
const CAR_WORDS = /(tesla|renault|fiat|nissan|mercedes|bmw|volkswagen|vw|audi|peugeot|citroen|opel|hyundai|kia|toyota|volvo|smart|mini|dacia|seat|cupra|ford|model|zoe|500e|leaf|id\.?3|id\.?4|eqc|eqa|ioniq|kona|twingo|megane|golf|polo|classe|long range|standard|plus|limited|icon)/i;

function clean(value = '') {
  return String(value)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalise(value = '') {
  return clean(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function absoluteUrl(href) {
  try {
    return new URL(href, STOCK_URL).toString();
  } catch {
    return '';
  }
}

function looksLikeCarUrl(url) {
  return /standvirtual\.com|spremium\.standvirtual\.com/i.test(url) && /(carros|inventory|anuncio|auto|id[0-9a-z])/i.test(url);
}

function isBadTitle(title) {
  const t = clean(title);
  if (!t || t.length < 3) return true;
  if (BAD_TITLE_PATTERNS.test(t)) return true;
  if (t.length > 120 && !CAR_WORDS.test(t)) return true;
  if ((t.match(/[{};]/g) || []).length > 0) return true;
  return false;
}

function titleFromUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    let candidate = parts[parts.length - 1] || '';
    if (/^id[0-9a-z]+$/i.test(candidate) && parts.length > 1) candidate = parts[parts.length - 2];
    candidate = decodeURIComponent(candidate)
      .replace(/\.html?$/i, '')
      .replace(/^anuncio[-_]?/i, '')
      .replace(/^carros[-_]?/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\bID[0-9a-z]+\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!candidate || isBadTitle(candidate)) return '';
    return clean(candidate).slice(0, 120);
  } catch {
    return '';
  }
}

function safeTitle(rawTitle, url) {
  const title = clean(rawTitle).slice(0, 180);
  if (!isBadTitle(title) && CAR_WORDS.test(title)) return title;
  const fromUrl = titleFromUrl(url);
  if (fromUrl) return fromUrl;
  if (!isBadTitle(title)) return title.slice(0, 100);
  return '';
}

function scoreItem(item, terms) {
  const hay = normalise(`${item.title} ${item.url}`);
  let score = 0;
  for (const term of terms) {
    if (!term) continue;
    if (hay.includes(term)) score += term.length >= 4 ? 3 : 1;
  }
  if (CAR_WORDS.test(item.title)) score += 2;
  return score;
}

function unique(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = item.url || normalise(item.title);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function extractAnchors(html) {
  const items = [];
  const regex = /<a\b([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(html))) {
    const attrs = `${match[1]} ${match[3]}`;
    const href = match[2];
    const titleFromAttr = (attrs.match(/title=["']([^"']+)["']/i) || [])[1] || '';
    const aria = (attrs.match(/aria-label=["']([^"']+)["']/i) || [])[1] || '';
    const url = absoluteUrl(href);
    if (!url || !looksLikeCarUrl(url)) continue;
    const title = safeTitle(titleFromAttr || aria || match[4], url);
    if (!title) continue;
    items.push({ title, url });
  }
  return items;
}

function extractJsonHints(html) {
  const items = [];
  const urlRegex = /https?:\\?\/\\?\/[^"'\\]+standvirtual[^"'\\]+/gi;
  const urls = html.match(urlRegex) || [];
  for (const raw of urls.slice(0, 500)) {
    const url = raw.replace(/\\\//g, '/').replace(/\\u002F/g, '/');
    if (!looksLikeCarUrl(url)) continue;
    const title = titleFromUrl(url);
    if (!title) continue;
    items.push({ title, url });
  }
  return items;
}

function extractVehicleTextHints(html) {
  const items = [];
  const text = clean(html);
  const re = new RegExp(`\\b(${CAR_WORDS.source})\\b.{0,80}`, 'gi');
  const matches = text.match(re) || [];
  for (const m of matches.slice(0, 80)) {
    const title = clean(m).replace(BAD_TITLE_PATTERNS, '').slice(0, 100);
    if (isBadTitle(title) || !CAR_WORDS.test(title)) continue;
    items.push({ title, url: STOCK_URL });
  }
  return items;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Use GET.' });
    return;
  }

  const q = String(req.query.q || '').trim().slice(0, 80);
  if (!q) {
    res.status(400).json({ error: 'Pesquisa vazia.' });
    return;
  }

  try {
    const response = await fetch(STOCK_URL, {
      headers: {
        'user-agent': 'Mozilla/5.0 assistente-carlos-stock-search',
        'accept': 'text/html,application/xhtml+xml'
      }
    });

    if (!response.ok) {
      res.status(200).json({ query: q, results: [], warning: 'Não consegui ler o stock neste momento.' });
      return;
    }

    const html = await response.text();
    const terms = normalise(q).split(' ').filter((x) => x.length >= 2);
    const all = unique([...extractAnchors(html), ...extractJsonHints(html), ...extractVehicleTextHints(html)]);
    const results = all
      .map((item) => ({ ...item, title: safeTitle(item.title, item.url) || item.title, score: scoreItem(item, terms) }))
      .filter((item) => item.title && !isBadTitle(item.title) && item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map(({ title, url }) => ({ title, url }));

    res.status(200).json({ query: q, source: STOCK_URL, results });
  } catch (err) {
    res.status(200).json({ query: q, results: [], warning: 'Pesquisa indisponível neste momento.' });
  }
}
