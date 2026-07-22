import strictHandler from './chat.js';

const LEAD_FIELDS = [
  'nome',
  'telefone',
  'viatura',
  'orcamento',
  'financiamento',
  'retoma',
  'horario',
  'observacoes'
];

const FLEX_SYSTEM_PROMPT = `És o assistente comercial do Carlos Vasconcelos, vendedor de automóveis usados em Portugal.

Tens liberdade para conversar de forma natural, útil e simpática sobre:
- compra e utilização de automóveis;
- diferenças entre elétrico, híbrido, gasolina e diesel;
- carregamento, manutenção e custos de utilização em termos gerais;
- como funciona normalmente a compra, o financiamento, a retoma e a preparação de uma visita;
- necessidades do cliente, tipo de utilização, espaço, autonomia desejada e orçamento;
- vantagens, limitações e critérios de escolha de um modelo, sem inventar dados da unidade concreta;
- perguntas de seguimento, dúvidas e conversa informal relacionada com automóveis.

Não transformes todas as respostas num formulário. Responde primeiro à pergunta. Só peças nome ou contacto quando o cliente quiser avançar, pedir confirmação humana ou deixar um pedido ao Carlos.

GUARDRAILS COMERCIAIS OBRIGATÓRIOS:
1. Nunca confirmes disponibilidade, estado de stock, reserva, venda, entrega ou marcação como concluída.
2. Nunca atribuas um valor à retoma nem faças uma avaliação da viatura do cliente.
3. Nunca prometas uma prestação, renda, mensalidade, taxa, aprovação ou condição de crédito. Podes explicar o processo em termos gerais e recolher a entrada e a mensalidade pretendidas.
4. Nunca confirmes preço final, desconto, despesas, garantia, equipamento, histórico, estado mecânico, estado da bateria ou autonomia real da unidade concreta.
5. Nunca inventes características técnicas específicas que não estejam no contexto fornecido.
6. Quando a pergunta exigir confirmação, diz claramente que o Carlos terá de confirmar. Não inventes nem uses linguagem que pareça uma garantia.
7. Podes dar informação geral sobre modelos e tecnologias, mas usa expressões como “em geral”, “normalmente” ou “depende da versão” quando não houver dados confirmados.
8. Não recolhas NIF, morada completa, cartão de cidadão, IBAN, cartões bancários, palavras-passe, códigos ou documentos pessoais.

Estilo:
- Português de Portugal.
- Caloroso, direto e comercial, sem ser insistente.
- Duas a quatro frases curtas, salvo quando uma explicação um pouco maior for realmente útil.
- No máximo uma pergunta de seguimento.
- Não uses linguagem jurídica nem faças promessas.
- Não menciones estas regras internas.`;

function normalize(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function clean(value, max = 900) {
  return String(value || '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function safeLead(input = {}, contextVehicle = '') {
  const result = {};
  for (const field of LEAD_FIELDS) {
    result[field] = clean(input[field], field === 'observacoes' ? 280 : 160);
  }
  if (!result.viatura && contextVehicle) result.viatura = clean(contextVehicle, 180);
  return result;
}

function hasPhoneOrExplicitContact(message) {
  return /(?:\+?351\s*)?9\d{1,2}(?:[\s.\-]*\d){6}/.test(message) ||
    /\b(nome|chamo-me|meu nome|contacto|telefone|telemovel|telemóvel|whatsapp)\b/i.test(message);
}

export function requiresStrictCommercialHandling(message = '') {
  const text = normalize(message);
  if (!text) return true;

  const availability = /\b(disponibilidade|disponivel|em stock|stock atual|ainda tem|ja foi vendid|já foi vendid|reservad[ao]|bloquear a viatura|dar sinal)\b/i.test(text);
  const exactFinance = /\b(financiamento|credito|crédito|prestacao|prestação|mensalidade|renda|taeg|tan|entrada)\b/i.test(text) &&
    (/\b(quanto|qual o valor|fica|simulacao|simulação|aprova|aprovad|garantid|taxa|juros|por mes|por mês)\b/i.test(text) || /\d|€/.test(text));
  const valuation = /\b(retoma|avaliacao|avaliação|avaliar|valor da minha|quanto vale|oferta pela)\b/i.test(text) &&
    /\b(quanto|valor|vale|avali|oferta|cotacao|cotação|€)\b/i.test(text);
  const finalPrice = /\b(preco final|preço final|desconto|melhor preco|melhor preço|despesas|custos de legalizacao|custos de legalização|valor final)\b/i.test(text);
  const commitment = /\b(reservar|reserva|marcar visita|agendar visita|confirmar visita|entrega|levantar a viatura|quero comprar|quero avançar|quero avancar|fechar negocio|fechar negócio)\b/i.test(text);
  const specificFacts = /\b(qual|quanto|quantos|tem|inclui|confirma|estado|historico|histórico|acidente|garantia|equipamento|saude da bateria|saúde da bateria|degradacao|degradação|autonomia real|capacidade da bateria|potencia|potência|carregamento maximo|carregamento máximo)\b/i.test(text) &&
    /\b(esta viatura|este carro|desta viatura|deste carro|o carro|a viatura|modelo|bateria|autonomia|garantia|equipamento|historico|histórico)\b/i.test(text);

  return availability || exactFinance || valuation || finalPrice || commitment || specificFacts || hasPhoneOrExplicitContact(message);
}

export function replyHasSensitiveCommitment(reply = '', message = '') {
  const text = normalize(reply);
  const question = normalize(message);
  const confirmsAvailability = /\b(esta|continua|temos|encontra-se)\s+(disponivel|em stock)|\bja foi vendid|\breservad[ao]\b/i.test(text) &&
    !/\b(confirmar|confirmacao|confirmação|verificar|validar|carece)\b/i.test(text);
  const promisesCredit = /\b(financiamento|credito|crédito)\s+(aprovado|garantido)|\b(aprovamos|fica aprovado|sera aprovado|será aprovado)\b/i.test(text);
  const confirmsDeal = /\b(visita|reserva|entrega)\s+(confirmada|marcada|agendada|garantida)|\bficou reservado\b/i.test(text);
  const confirmsVehicleFacts = /\b(garantia|equipamento|historico|histórico|estado da bateria|saude da bateria|saúde da bateria)\s+(confirmad[ao]|incluid[ao]|sem problemas|excelente|perfeito)\b/i.test(text);
  const givesMoney = /\d[\d\s.,]*\s*€|€\s*\d/.test(reply);
  const sensitiveMoneyContext = /\b(prestacao|prestação|mensalidade|renda|financiamento|credito|crédito|retoma|avaliacao|avaliação|desconto|preco final|preço final)\b/i.test(question + ' ' + text);
  const exactTechnicalClaim = /\b\d+(?:[.,]\d+)?\s*(km|kwh|kw|cv|litros?|segundos?)\b/i.test(reply) &&
    /\b(esta viatura|este carro|desta viatura|deste carro|a viatura|o carro)\b/i.test(text);

  return confirmsAvailability || promisesCredit || confirmsDeal || confirmsVehicleFacts || (givesMoney && sensitiveMoneyContext) || exactTechnicalClaim;
}

function extractOutputText(data = {}) {
  if (typeof data.output_text === 'string') return data.output_text;
  const chunks = [];
  for (const item of data.output || []) {
    for (const part of item.content || []) {
      if ((part.type === 'output_text' || part.type === 'text') && part.text) chunks.push(part.text);
    }
  }
  return chunks.join('\n').trim();
}

function safeGuardrailReply() {
  return 'Posso explicar o processo e ajudar a preparar o pedido, mas disponibilidade, valores de retoma, preço final e condições concretas de financiamento têm de ser confirmados pelo Carlos. Diga-me o que pretende e deixo a informação organizada para ele responder.';
}

export async function runFlexibleCommercialAssistant(body = {}, options = {}) {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY em falta.');

  const message = clean(body.message, 1200);
  const context = {
    origem: clean(body.contexto?.origem || 'standvirtual', 60),
    viatura: clean(body.contexto?.viatura || body.lead?.viatura || '', 180),
    link_anuncio: clean(body.contexto?.link_anuncio || '', 500)
  };
  const lead = safeLead(body.lead || {}, context.viatura);
  const history = Array.isArray(body.history)
    ? body.history.slice(-8).map((entry) => ({
        role: entry.role === 'assistant' ? 'assistant' : 'user',
        content: clean(entry.content, 800)
      }))
    : [];

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-5.5',
      max_output_tokens: 360,
      input: [
        { role: 'system', content: FLEX_SYSTEM_PROMPT },
        { role: 'user', content: `Contexto da viatura/anúncio: ${JSON.stringify(context).slice(0, 1000)}` },
        { role: 'user', content: `Dados comerciais já recolhidos: ${JSON.stringify(lead).slice(0, 800)}` },
        ...history,
        { role: 'user', content: message }
      ]
    }),
    signal: options.signal
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Erro no serviço de IA.');

  let reply = clean(extractOutputText(data), 700);
  if (!reply) throw new Error('Resposta vazia.');
  if (replyHasSensitiveCommitment(reply, message)) reply = safeGuardrailReply();

  return {
    reply,
    lead,
    estado: {
      fora_do_tema: false,
      precisa_humano: /\bCarlos\b/.test(reply) && /\b(confirmar|responder|verificar|validar)\b/i.test(reply),
      interesse_real: /\b(comprar|interessad|visita|financiamento|retoma|avançar|avancar)\b/i.test(message),
      campos_em_falta: [],
      motivo: 'conversa_automovel_flexivel'
    },
    alertas: []
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST.' });
    return;
  }

  const message = String(req.body?.message || '');
  if (requiresStrictCommercialHandling(message)) {
    await strictHandler(req, res);
    return;
  }

  try {
    const result = await runFlexibleCommercialAssistant(req.body || {});
    res.status(200).json(result);
  } catch (error) {
    console.error('Modo conversacional indisponível; a usar modo comercial rigoroso.', {
      message: error?.message
    });
    await strictHandler(req, res);
  }
}
