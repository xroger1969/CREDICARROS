const STOCK_URL = process.env.STOCK_URL || 'https://spremium.standvirtual.com/inventory';

function clean(value = '') {
  return String(value)
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
  return /standvirtual\.com|spremium\.standvirtual\.com/i.test(url) && /(carros|inventory|anuncio|auto)/i.test(url);
}

function scoreItem(item, terms) {
  const hay = normalise(`${item.title} ${item.url}`);
  let score = 0;
  for (const term of terms) {
    if (!term) continue;
    if (hay.includes(term)) score += term.length >= 4 ? 3 : 1;
  }
  return score;
}

function unique(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = normalise(item.title) + '|' + item.url;
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
    const title = clean(titleFromAttr || aria || match[4]);
    const url = absoluteUrl(href);
    if (!url || !looksLikeCarUrl(url)) continue;
    if (title.length < 3) continue;
    items.push({ title: title.slice(0, 180), url });
  }
  return items;
}

function extractJsonHints(html) {
  const items = [];
  const urlRegex = /https?:\\?\/\\?\/[^"'\\]+standvirtual[^"'\\]+/gi;
  const urls = html.match(urlRegex) || [];
  for (const raw of urls.slice(0, 300)) {
    const url = raw.replace(/\\\//g, '/').replace(/\\u002F/g, '/');
    if (!looksLikeCarUrl(url)) continue;
    const slug = decodeURIComponent(url.split('/').pop() || '').replace(/[-_]+/g, ' ');
    const title = clean(slug).slice(0, 180);
    if (title.length < 3) continue;
    items.push({ title, url });
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
    const all = unique([...extractAnchors(html), ...extractJsonHints(html)]);
    const results = all
      .map((item) => ({ ...item, score: scoreItem(item, terms) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map(({ title, url }) => ({ title, url }));

    res.status(200).json({ query: q, source: STOCK_URL, results });
  } catch (err) {
    res.status(200).json({ query: q, results: [], warning: 'Pesquisa indisponível neste momento.' });
  }
}
