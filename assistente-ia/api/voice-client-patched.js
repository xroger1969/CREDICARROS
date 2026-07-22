import { readFileSync } from 'node:fs';

const ORIGINAL_VOICE_CLIENT = readFileSync(new URL('../voice-client.js', import.meta.url), 'utf8');

const FORBIDDEN_NAME_WORDS = new Set([
  'entrada', 'prestacao', 'prestação', 'mensalidade', 'renda', 'financiamento', 'credito', 'crédito',
  'retoma', 'avaliacao', 'avaliação', 'valor', 'euros', 'euro', 'zero', 'stock', 'disponibilidade',
  'disponivel', 'disponível', 'reserva', 'visita', 'garantia', 'equipamento', 'bateria', 'autonomia',
  'telefone', 'telemovel', 'telemóvel', 'whatsapp', 'contacto', 'numero', 'número', 'km', 'kms',
  'quilometros', 'quilómetros', 'gasolina', 'diesel', 'eletrico', 'elétrico', 'hibrido', 'híbrido',
  'renault', 'clio', 'megane', 'mégane', 'tesla', 'dacia', 'fiat', 'nissan', 'bmw', 'mercedes',
  'volkswagen', 'hyundai', 'kia', 'peugeot', 'citroen', 'citroën', 'ford', 'toyota', 'audi', 'volvo',
  'seat', 'skoda', 'škoda', 'opel', 'mazda', 'honda', 'lexus', 'jeep', 'porsche', 'mg', 'aiways',
  'quero', 'pretendo', 'preciso', 'pode', 'podem', 'ligar', 'ligue', 'contactar', 'amanha', 'amanhã',
  'hoje', 'tarde', 'manha', 'manhã', 'noite', 'obrigado', 'obrigada', 'sim', 'nao', 'não'
]);

function normalizeWord(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function formatLeadName(value = '') {
  const particles = new Set(['da', 'das', 'de', 'do', 'dos', 'e']);
  return String(value)
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word, index) => {
      const lower = word.toLocaleLowerCase('pt-PT');
      if (index > 0 && particles.has(lower)) return lower;
      return lower.charAt(0).toLocaleUpperCase('pt-PT') + lower.slice(1);
    })
    .join(' ');
}

export function cleanLeadNameCandidate(value = '') {
  const candidate = String(value)
    .trim()
    .replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, '')
    .replace(/^(?:o|a)\s+/i, '')
    .replace(/\s+/g, ' ');

  if (!candidate || candidate.length > 80 || /\d|@|https?:/i.test(candidate)) return '';

  const words = candidate.split(' ');
  if (words.length > 5 || !words.every((word) => /^[A-Za-zÀ-ÿ'’\-]+$/u.test(word))) return '';

  const meaningfulWords = words.filter((word) => !['da', 'das', 'de', 'do', 'dos', 'e'].includes(normalizeWord(word)));
  if (!meaningfulWords.length) return '';
  if (meaningfulWords.some((word) => FORBIDDEN_NAME_WORDS.has(normalizeWord(word)))) return '';

  return formatLeadName(candidate);
}

function findLeadPhone(text = '') {
  return String(text).match(/(?:\+?351\s*)?9\d{1,2}(?:[\s.\-]*\d){6}/);
}

export function extractExplicitLeadName(value = '') {
  const text = String(value);
  const labelledPatterns = [
    /(?:^|[\n,;.!?]\s*|\s+)(?:(?:o\s+)?meu\s+nome|nome|cliente)\s*(?:é|e|:)\s*([^\n,;.!?]+?)(?=\s+(?:e\s+)?(?:o\s+)?(?:meu\s+)?(?:n[uú]mero|telefone|telem[oó]vel|contacto|whatsapp)\b|[\n,;.!?]|$)/iu,
    /(?:^|[\n,;.!?]\s*|\s+)(?:o\s+)?meu\s+contacto\s*(?:é|e|:)\s*([^\n,;.!?]+?)(?=\s+(?:e\s+)?(?:o\s+)?(?:meu\s+)?(?:n[uú]mero|telefone|telem[oó]vel|whatsapp)\b|[\n,;.!?]|$)/iu,
    /(?:^|[\n,;.!?]\s*|\s+)chamo[-\s]me\s+([^\n,;.!?]+?)(?=\s+(?:e\s+)?(?:o\s+)?(?:meu\s+)?(?:n[uú]mero|telefone|telem[oó]vel|contacto|whatsapp)\b|[\n,;.!?]|$)/iu
  ];

  for (const pattern of labelledPatterns) {
    const candidate = cleanLeadNameCandidate(text.match(pattern)?.[1]);
    if (candidate) return candidate;
  }

  const phone = findLeadPhone(text);
  if (!phone) return '';
  const beforePhone = text.slice(0, phone.index).trim();

  const segments = beforePhone
    .split(/[\n,;|]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  for (let index = segments.length - 1; index >= Math.max(0, segments.length - 2); index -= 1) {
    const candidate = cleanLeadNameCandidate(
      segments[index].replace(/^(?:(?:o\s+)?meu\s+)?(?:nome|contacto)\s*(?:é|e|:)?\s*/i, '')
    );
    if (candidate) return candidate;
  }

  const words = beforePhone.match(/[A-Za-zÀ-ÿ'’\-]+/gu) || [];
  const maxWords = Math.min(5, words.length);
  for (let size = maxWords; size >= 1; size -= 1) {
    const candidate = cleanLeadNameCandidate(words.slice(-size).join(' '));
    if (candidate) return candidate;
  }

  return '';
}

const BROWSER_PATCH = `\n;(() => {\n  const forbidden = new Set(${JSON.stringify([...FORBIDDEN_NAME_WORDS])});\n  const normalizeWord = ${normalizeWord.toString()};\n  const formatLeadName = ${formatLeadName.toString()};\n  const cleanLeadNameCandidate = ${cleanLeadNameCandidate.toString().replace('FORBIDDEN_NAME_WORDS', 'forbidden')};\n  const findLeadPhone = ${findLeadPhone.toString()};\n  const extractExplicitLeadName = ${extractExplicitLeadName.toString()};\n  const install = () => { window.explicitName = extractExplicitLeadName; };\n  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });\n  else setTimeout(install, 0);\n})();\n`;

export default function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).end('Use GET.');
    return;
  }

  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.status(200).end(req.method === 'HEAD' ? '' : ORIGINAL_VOICE_CLIENT + BROWSER_PATCH);
}
