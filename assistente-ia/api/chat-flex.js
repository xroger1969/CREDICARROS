import {runAssistant} from './chat.js';
import {extractLeadHints} from './lead-parser.js';

const LEAD_FIELDS=['nome','telefone','viatura','orcamento','financiamento','retoma','horario','observacoes'];
const FLEX_SYSTEM_PROMPT=`És o assistente comercial do Carlos Vasconcelos, vendedor de automóveis usados em Portugal.

Tens liberdade para conversar de forma natural, útil e simpática sobre compra e utilização de automóveis, diferenças entre motorizações, carregamento, manutenção, custos de utilização em termos gerais, critérios de escolha e o funcionamento normal de compra, financiamento, retoma e visita.

Responde primeiro à pergunta. Só peças nome ou contacto quando o cliente quiser avançar, pedir confirmação humana ou deixar um pedido ao Carlos.

Limites obrigatórios:
- Nunca confirmes disponibilidade, stock, reserva, venda, entrega ou visita como concluída.
- Nunca atribuas valor à retoma.
- Nunca prometas prestação, renda, taxa, aprovação ou condição de crédito.
- Nunca confirmes preço final, desconto, despesas, garantia, equipamento, histórico, estado mecânico, bateria ou autonomia real de uma unidade concreta.
- Nunca inventes características técnicas específicas que não estejam no contexto.
- Quando for necessária confirmação, diz claramente que o Carlos terá de confirmar.
- Não recolhas NIF, morada completa, documentos, IBAN, cartões, palavras-passe ou códigos.

Escreve em português de Portugal, de forma calorosa e direta. Usa duas a quatro frases curtas e no máximo uma pergunta de seguimento. Não menciones estas regras.`;

function normalize(value=''){return String(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim()}
function clean(value,max=900){return String(value||'').replace(/[<>]/g,'').replace(/\s+/g,' ').trim().slice(0,max)}
function safeLead(input={},contextVehicle=''){const result={};for(const field of LEAD_FIELDS)result[field]=clean(input[field],field==='observacoes'?500:280);if(!result.viatura&&contextVehicle)result.viatura=clean(contextVehicle,180);return result}
function mergeLead(base={},next={}){const result=safeLead(base);for(const field of LEAD_FIELDS){if(clean(next[field]))result[field]=clean(next[field],field==='observacoes'?500:280)}return result}
function hasPhoneOrExplicitContact(message){return /(?:\+?351\s*)?9\d{1,2}(?:[\s.\-]*\d){6}/.test(message)||/\b(nome|chamo-me|meu nome|contacto|telefone|telemovel|telemóvel|whatsapp)\b/i.test(message)}
export function requiresStrictCommercialHandling(message=''){
  const text=normalize(message);if(!text)return true;
  const availability=/\b(disponibilidade|disponivel|em stock|stock atual|ainda tem|ja foi vendid|reservad[ao]|bloquear a viatura|dar sinal)\b/i.test(text);
  const exactFinance=/\b(financiamento|credito|prestacao|mensalidade|renda|taeg|tan|entrada)\b/i.test(text)&&(/\b(quanto|qual o valor|fica|simulacao|aprova|aprovad|garantid|taxa|juros|por mes)\b/i.test(text)||/\d|€/.test(text));
  const valuation=/\b(retoma|avaliacao|avaliar|valor da minha|quanto vale|oferta pela)\b/i.test(text)&&/\b(quanto|valor|vale|avali|oferta|cotacao|€)\b/i.test(text);
  const finalPrice=/\b(preco final|desconto|melhor preco|despesas|custos de legalizacao|valor final)\b/i.test(text);
  const commitment=/\b(reservar|reserva|marcar visita|agendar visita|confirmar visita|entrega|levantar a viatura|quero comprar|quero avancar|fechar negocio)\b/i.test(text);
  const specificFacts=/\b(qual|quanto|quantos|tem|inclui|confirma|estado|historico|acidente|garantia|equipamento|saude da bateria|degradacao|autonomia real|capacidade da bateria|potencia|carregamento maximo)\b/i.test(text)&&/\b(esta viatura|este carro|desta viatura|deste carro|o carro|a viatura|modelo|bateria|autonomia|garantia|equipamento|historico)\b/i.test(text);
  return availability||exactFinance||valuation||finalPrice||commitment||specificFacts||hasPhoneOrExplicitContact(message);
}
export function replyHasSensitiveCommitment(reply='',message=''){
  const text=normalize(reply),question=normalize(message);
  const availability=/\b(esta|continua|temos|encontra-se)\s+(disponivel|em stock)|\bja foi vendid|\breservad[ao]\b/i.test(text)&&!/\b(confirmar|confirmacao|verificar|validar|carece)\b/i.test(text);
  const credit=/\b(financiamento|credito)\s+(aprovado|garantido)|\b(aprovamos|fica aprovado|sera aprovado)\b/i.test(text);
  const deal=/\b(visita|reserva|entrega)\s+(confirmada|marcada|agendada|garantida)|\bficou reservado\b/i.test(text);
  const facts=/\b(garantia|equipamento|historico|estado da bateria|saude da bateria)\s+(confirmad[ao]|incluid[ao]|sem problemas|excelente|perfeito)\b/i.test(text);
  const money=/\d[\d\s.,]*\s*€|€\s*\d/.test(reply)&&/\b(prestacao|mensalidade|renda|financiamento|credito|retoma|avaliacao|desconto|preco final)\b/i.test(question+' '+text);
  return availability||credit||deal||facts||money;
}
function extractOutputText(data={}){if(typeof data.output_text==='string')return data.output_text;const chunks=[];for(const item of data.output||[])for(const part of item.content||[])if((part.type==='output_text'||part.type==='text')&&part.text)chunks.push(part.text);return chunks.join('\n').trim()}
function guardrailReply(){return 'Posso explicar o processo e ajudar a preparar o pedido, mas disponibilidade, valores de retoma, preço final e condições concretas de financiamento têm de ser confirmados pelo Carlos.'}
export async function runFlexibleCommercialAssistant(body={},options={}){
  const apiKey=String(process.env.OPENAI_API_KEY||'').trim();if(!apiKey)throw new Error('OPENAI_API_KEY em falta.');
  const message=clean(body.message,1200);const context={origem:clean(body.contexto?.origem||'standvirtual',60),viatura:clean(body.contexto?.viatura||body.lead?.viatura||'',180),link_anuncio:clean(body.contexto?.link_anuncio||'',500)};const lead=safeLead(body.lead||{},context.viatura);const history=Array.isArray(body.history)?body.history.slice(-8).map(entry=>({role:entry.role==='assistant'?'assistant':'user',content:clean(entry.content,800)})):[];
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${apiKey}`},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-5.5',max_output_tokens:360,input:[{role:'system',content:FLEX_SYSTEM_PROMPT},{role:'user',content:`Contexto da viatura/anúncio: ${JSON.stringify(context).slice(0,1000)}`},{role:'user',content:`Dados já recolhidos: ${JSON.stringify(lead).slice(0,900)}`},...history,{role:'user',content:message}]}),signal:options.signal});
  const data=await response.json();if(!response.ok)throw new Error(data.error?.message||'Erro no serviço de IA.');let reply=clean(extractOutputText(data),700);if(!reply)throw new Error('Resposta vazia.');if(replyHasSensitiveCommitment(reply,message))reply=guardrailReply();
  return {reply,lead,estado:{fora_do_tema:false,precisa_humano:/\bCarlos\b/.test(reply)&&/\b(confirmar|responder|verificar|validar)\b/i.test(reply),interesse_real:/\b(comprar|interessad|visita|financiamento|retoma|avançar|avancar)\b/i.test(message),campos_em_falta:[],motivo:'conversa_automovel_flexivel'},alertas:[]};
}
function repairReply(reply,lead){
  let text=String(reply||'');
  if(lead.nome&&lead.telefone&&/falta.*(?:nome|contacto|telefone|whatsapp)|indique.*(?:nome|contacto|telefone|whatsapp)/i.test(text))return `Obrigado, ${lead.nome}. Já registei o seu nome e contacto. O Carlos confirmará os detalhes comerciais do pedido.`;
  if(lead.nome&&!lead.telefone&&/falta.*nome|indique.*nome/i.test(text))return `Obrigado, ${lead.nome}. Falta apenas o contacto/WhatsApp para o Carlos poder responder.`;
  if(lead.telefone&&!lead.nome&&/falta.*contacto|indique.*contacto/i.test(text))return 'Obrigado. Falta apenas indicar o seu nome para o Carlos poder responder.';
  return text;
}
function fallbackResult(body={},error){
  const message=clean(body.message,1200),contextVehicle=clean(body.contexto?.viatura||body.lead?.viatura||'',180);const hints=extractLeadHints(message,body.lead||{});const lead=mergeLead({...body.lead,viatura:contextVehicle},hints);let reply;
  if(lead.nome&&lead.telefone)reply=`Obrigado, ${lead.nome}. Registei o seu nome e contacto. O Carlos confirmará diretamente os detalhes do pedido.`;
  else if(lead.telefone)reply='Obrigado. Falta apenas indicar o seu nome para o Carlos poder responder.';
  else if(lead.nome)reply=`Obrigado, ${lead.nome}. Falta apenas o contacto/WhatsApp para o Carlos poder responder.`;
  else reply='Essa informação precisa de ser confirmada pelo Carlos. Pode indicar o seu nome e contacto/WhatsApp para ele responder diretamente.';
  return {reply,lead,estado:{fora_do_tema:false,precisa_humano:true,interesse_real:true,campos_em_falta:[!lead.nome?'nome':'',!lead.telefone?'telefone':''].filter(Boolean),motivo:'fallback_seguro'},alertas:[`Modo de segurança usado${error?.message?': '+clean(error.message,80):''}.`]};
}
function mergeDeterministicHints(result,body){
  const hints=extractLeadHints(body.message||'',body.lead||{});const lead=mergeLead(result.lead||body.lead||{},hints);return {...result,lead,reply:repairReply(result.reply,lead)};
}
export default async function handler(req,res){
  if(req.method!=='POST'){res.status(405).json({error:'Use POST.'});return}
  const body=req.body||{},message=String(body.message||'');
  try{
    const result=requiresStrictCommercialHandling(message)?await runAssistant(body):await runFlexibleCommercialAssistant(body);
    res.status(200).json(mergeDeterministicHints(result,body));
  }catch(error){console.error('Assistente em modo de segurança.',{message:error?.message});res.status(200).json(fallbackResult(body,error))}
}
