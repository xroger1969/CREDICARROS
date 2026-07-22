import {extractPhone,formatLeadName} from './lead-parser.js';

const FIELDS=['nome','telefone','viatura','orcamento','financiamento','retoma','horario','observacoes'];
function redact(value=''){
  return String(value).replace(/\b(NIF|contribuinte)\b\s*[:\-]?\s*\d{9}\b/gi,'[NIF removido]').replace(/\bIBAN\b\s*[:\-]?\s*[A-Z]{2}\d{2}[A-Z0-9\s]{11,30}\b/gi,'[IBAN removido]').replace(/\b(cart[aã]o de cidad[aã]o|CC)\b\s*[:\-]?\s*[A-Z0-9\-\s]{6,25}/gi,'[documento removido]').replace(/\b(password|senha|palavra-passe|c[oó]digo)\b\s*[:\-]?\s*\S+/gi,'[credencial removida]').replace(/\b\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b/g,'[cartão removido]');
}
function clean(value,max=400){return redact(value).replace(/[<>]/g,'').replace(/\s+/g,' ').trim().slice(0,max)}
function sanitizeLead(input={}){const lead={};for(const field of FIELDS)lead[field]=clean(input[field],field==='observacoes'?600:300);if(lead.nome)lead.nome=formatLeadName(lead.nome);if(lead.telefone)lead.telefone=extractPhone(lead.telefone)||clean(lead.telefone,30);return lead}
function textSummary(lead,vehicle,reference){return [`Pedido Credicarros ${reference}`,`Viatura: ${lead.viatura||vehicle?.title||'Não indicada'}`,`Cliente: ${lead.nome||'Não indicado'}`,`Contacto: ${lead.telefone||'Não indicado'}`,lead.orcamento?`Financiamento: ${lead.orcamento}`:'',lead.retoma?`Retoma: ${lead.retoma}`:'',lead.horario?`Visita: ${lead.horario}`:'',lead.observacoes?`Observações: ${lead.observacoes}`:'',vehicle?.url?`Anúncio: ${clean(vehicle.url,500)}`:''].filter(Boolean).join('\n')}
async function deliverWebhook(payload){const url=String(process.env.LEAD_WEBHOOK_URL||'').trim();if(!url)return false;const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});return response.ok}
async function deliverEmail(payload){const apiKey=String(process.env.RESEND_API_KEY||'').trim(),to=String(process.env.LEAD_EMAIL_TO||'').trim();if(!apiKey||!to)return false;const from=String(process.env.LEAD_EMAIL_FROM||'Credicarros <onboarding@resend.dev>').trim();const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${apiKey}`},body:JSON.stringify({from,to:[to],subject:`Novo pedido Credicarros ${payload.reference}`,text:payload.summary})});return response.ok}
export default async function handler(req,res){
  if(req.method!=='POST'){res.status(405).json({error:'Use POST.'});return}
  const lead=sanitizeLead(req.body?.lead||{}),vehicle={title:clean(req.body?.vehicle?.title,220),url:clean(req.body?.vehicle?.url,500)};const reference=`CR-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;const payload={reference,lead,vehicle,source:clean(req.body?.source,80),sessionId:clean(req.body?.sessionId,100),createdAt:new Date().toISOString()};payload.summary=textSummary(lead,vehicle,reference);
  let delivered=false,channel='local';
  try{if(await deliverWebhook(payload)){delivered=true;channel='webhook'}else if(await deliverEmail(payload)){delivered=true;channel='email'}}catch(error){console.error('Falha no encaminhamento da lead.',{reference,message:error?.message})}
  console.log(JSON.stringify({type:'credicarros_lead',reference,delivered,channel,vehicle:lead.viatura||vehicle.title,hasName:Boolean(lead.nome),hasPhone:Boolean(lead.telefone),createdAt:payload.createdAt}));
  res.status(200).json({reference,delivered,channel});
}
