const FORBIDDEN_NAME_WORDS=new Set([
  'entrada','prestacao','prestação','mensalidade','renda','financiamento','credito','crédito','retoma','avaliacao','avaliação','valor','euros','euro','zero','stock','disponibilidade','disponivel','disponível','reserva','visita','garantia','equipamento','bateria','autonomia','telefone','telemovel','telemóvel','whatsapp','contacto','numero','número','km','kms','quilometros','quilómetros','gasolina','diesel','eletrico','elétrico','hibrido','híbrido','quero','pretendo','preciso','ligar','ligue','contactar','amanha','amanhã','hoje','tarde','manha','manhã','noite','obrigado','obrigada','sim','nao','não',
  'renault','clio','megane','mégane','tesla','dacia','fiat','nissan','bmw','mercedes','volkswagen','hyundai','kia','peugeot','citroen','citroën','ford','toyota','audi','volvo','seat','skoda','škoda','opel','mazda','honda','lexus','jeep','porsche','mg','aiways','model','spring','leaf','zoe','golf','polo'
]);
const PARTICLES=new Set(['da','das','de','do','dos','e']);
function normalizeWord(value=''){return String(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')}
export function formatLeadName(value=''){return String(value).trim().replace(/\s+/g,' ').split(' ').map((word,index)=>{const lower=word.toLocaleLowerCase('pt-PT');return index>0&&PARTICLES.has(lower)?lower:lower.charAt(0).toLocaleUpperCase('pt-PT')+lower.slice(1)}).join(' ')}
export function extractPhone(value=''){const match=String(value||'').match(/(?:\+?351\s*)?9\d{1,2}(?:[\s.\-]*\d){6}/);return match?match[0].replace(/\D/g,'').replace(/^351/,''):''}
export function cleanNameCandidate(value=''){
  const candidate=String(value).trim().replace(/^[\s,;:.-]+|[\s,;:.-]+$/g,'').replace(/^(?:o|a)\s+/i,'').replace(/\s+/g,' ');
  if(!candidate||candidate.length>80||/\d|@|https?:/i.test(candidate))return '';
  const words=candidate.split(' ');if(words.length>5||!words.every(word=>/^[A-Za-zÀ-ÿ'’\-]+$/u.test(word)))return '';
  const meaningful=words.filter(word=>!PARTICLES.has(normalizeWord(word)));if(!meaningful.length||meaningful.some(word=>FORBIDDEN_NAME_WORDS.has(normalizeWord(word))))return '';
  return formatLeadName(candidate);
}
export function extractName(value='',currentLead={}){
  if(currentLead?.nome)return String(currentLead.nome).trim();
  const text=String(value||'');
  const patterns=[
    /(?:^|[\n,;.!?]\s*|\s+)(?:(?:o\s+)?meu\s+nome|nome|cliente)\s*(?:é|e|:)\s*([^\n,;.!?]+?)(?=\s+(?:e\s+)?(?:o\s+)?(?:meu\s+)?(?:n[uú]mero|telefone|telem[oó]vel|contacto|whatsapp)\b|[\n,;.!?]|$)/iu,
    /(?:^|[\n,;.!?]\s*|\s+)(?:o\s+)?meu\s+contacto\s*(?:é|e|:)\s*([^\n,;.!?]+?)(?=\s+(?:e\s+)?(?:o\s+)?(?:meu\s+)?(?:n[uú]mero|telefone|telem[oó]vel|whatsapp)\b|[\n,;.!?]|$)/iu,
    /(?:^|[\n,;.!?]\s*|\s+)chamo[-\s]me\s+([^\n,;.!?]+?)(?=\s+(?:e\s+)?(?:o\s+)?(?:meu\s+)?(?:n[uú]mero|telefone|telem[oó]vel|contacto|whatsapp)\b|[\n,;.!?]|$)/iu
  ];
  for(const pattern of patterns){const candidate=cleanNameCandidate(text.match(pattern)?.[1]);if(candidate)return candidate}
  const phoneMatch=text.match(/(?:\+?351\s*)?9\d{1,2}(?:[\s.\-]*\d){6}/);if(!phoneMatch)return '';
  const before=text.slice(0,phoneMatch.index).trim();
  const segments=before.split(/[\n,;|]+/).map(segment=>segment.trim()).filter(Boolean);
  for(let index=segments.length-1;index>=Math.max(0,segments.length-2);index-=1){const candidate=cleanNameCandidate(segments[index].replace(/^(?:(?:o\s+)?meu\s+)?(?:nome|contacto)\s*(?:é|e|:)?\s*/i,''));if(candidate)return candidate}
  const words=before.match(/[A-Za-zÀ-ÿ'’\-]+/gu)||[];
  for(let size=Math.min(5,words.length);size>=1;size-=1){const candidate=cleanNameCandidate(words.slice(-size).join(' '));if(candidate)return candidate}
  return '';
}
function findLabel(text,labelRegex){const match=String(text||'').match(new RegExp(`(?:^|[\\n;])\\s*(?:${labelRegex})\\s*[:=-]\\s*([^\\n;]{2,280})`,'i'));return match?match[1].trim():''}
export function extractLeadHints(message='',currentLead={}){
  const text=String(message||'');const phone=extractPhone(text);const name=extractName(text,currentLead);
  const hints={};if(phone)hints.telefone=phone;if(name)hints.nome=name;
  const finance=findLabel(text,'financiamento|entrada|prestação|prestacao');if(finance){hints.financiamento='Pretende financiamento';hints.orcamento=finance}
  const trade=findLabel(text,'retoma');if(trade)hints.retoma=trade;
  const visit=findLabel(text,'visita|horário|horario');if(visit)hints.horario=visit;
  return hints;
}
