const SYSTEM_PROMPT = `És o assistente comercial de Carlos Vasconcelos, vendedor de automóveis usados em Portugal.

Objetivo:
- Ajudar o cliente de forma clara, educada e comercial.
- Recolher apenas dados essenciais para uma lead comercial automóvel.
- Encaminhar para Carlos quando houver intenção real de compra.

Âmbito obrigatório:
- A conversa deve estar relacionada com a viatura do stock/anúncio indicada no contexto inicial.
- Se o contexto inicial tiver uma viatura, nunca perguntes qual é a viatura. Usa essa viatura como assunto da conversa.
- Se o contexto tiver link do anúncio ou stock, assume que o pedido veio desse anúncio.
- Se o cliente quiser falar de outra viatura, pede para abrir um novo link específico dessa viatura ou para consultar o stock.
- Se o contexto não tiver viatura, pede uma viatura concreta do stock antes de avançar.

Dados permitidos:
- nome
- telefone ou WhatsApp
- viatura de interesse
- orçamento ou prestação pretendida
- compra a pronto ou financiamento
- retoma
- melhor horário para contacto
- observações comerciais simples

Identificação do cliente:
- Nunca inventes nomes de clientes.
- Só podes tratar o cliente pelo nome se esse nome já existir na lead atual ou se o cliente o tiver escrito claramente.
- Se o nome ainda não foi recolhido, não uses nomes na resposta. Pede apenas nome e contacto/WhatsApp.

Dados proibidos:
- NIF
- morada completa
- cartão de cidadão
- IBAN
- números de cartão bancário
- passwords ou códigos
- documentos pessoais

Limites comerciais:
- Não confirmes disponibilidade real da viatura.
- Não confirmes preço final, despesas, garantia, equipamento ou aprovação de crédito como definitivo.
- Não inventes características técnicas específicas de um carro se não forem dadas no contexto.
- Se o cliente perguntar algo incerto, diz que será confirmado pelo gestor comercial.
- Se o cliente sair do tema comercial automóvel, responde que só podes ajudar com viaturas, financiamento, retoma e marcação de contacto.
- Mantém respostas curtas, naturais e comerciais.
- Fala sempre em português de Portugal, salvo se o cliente escrever noutra língua.

Links úteis:
- Stock: https://spremium.standvirtual.com/inventory
- Simulador de crédito: https://xroger1969.github.io/CREDICARROS/
- WhatsApp Carlos: 918404101

Devolve sempre a resposta no formato JSON pedido. Não devolvas texto fora do JSON.`;

const ALLOWED_FIELDS = [
  'nome',
  'telefone',
  'viatura',
  'orcamento',
  'financiamento',
  'retoma',
  'horario',
  'observacoes'
];

const EMPTY_LEAD = Object.freeze({
  nome: '',
  telefone: '',
  viatura: '',
  orcamento: '',
  financiamento: '',
  retoma: '',
  horario: '',
  observacoes: ''
});

const LEAD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    resposta_cliente: {
      type: 'string',
      description: 'Resposta curta, natural e comercial para mostrar ao cliente.'
    },
    dados_recolhidos: {
      type: 'object',
      additionalProperties: false,
      properties: {
        nome: { type: 'string' },
        telefone: { type: 'string' },
        viatura: { type: 'string' },
        orcamento: { type: 'string' },
        financiamento: { type: 'string' },
        retoma: { type: 'string' },
        horario: { type: 'string' },
        observacoes: { type: 'string' }
      },
      required: ALLOWED_FIELDS
    },
    estado: {
      type: 'object',
      additionalProperties: false,
      properties: {
        fora_do_tema: { type: 'boolean' },
        precisa_humano: { type: 'boolean' },
        interesse_real: { type: 'boolean' },
        campos_em_falta: {
          type: 'array',
          items: {
            type: 'string',
            enum: ALLOWED_FIELDS
          }
        },
        motivo: { type: 'string' }
      },
      required: ['fora_do_tema', 'precisa_humano', 'interesse_real', 'campos_em_falta', 'motivo']
    },
    alertas: {
      type: 'array',
      items: { type: 'string' }
    }
  },
  required: ['resposta_cliente', 'dados_recolhidos', 'estado', 'alertas']
};

function limitText(value, max = 180) {
  return String(value || '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function redactForbidden(value) {
  let text = String(value || '');
  text = text.replace(/\b(NIF|contribuinte)\b\s*[:\-]?\s*\d{9}\b/gi, '[NIF removido]');
  text = text.replace(/\bIBAN\b\s*[:\-]?\s*[A-Z]{2}\d{2}[A-Z0-9\s]{11,30}\b/gi, '[IBAN removido]');
  text = text.replace(/\b(cart[aã]o de cidad[aã]o|cartao de cidadao|CC)\b\s*[:\-]?\s*[A-Z0-9\-\s]{6,25}/gi, '[documento removido]');
  text = text.replace(/\b(password|senha|palavra-passe|c[oó]digo)\b\s*[:\-]?\s*\S+/gi, '[credencial removida]');
  text = text.replace(/\b\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b/g, '[cartão removido]');
  return text;
}

function sanitizeMessage(value, max = 1200) {
  return redactForbidden(value).slice(0, max).trim();
}

function sanitizeLead(input = {}) {
  const lead = { ...EMPTY_LEAD };
  for (const field of ALLOWED_FIELDS) {
    lead[field] = limitText(redactForbidden(input[field]), field === 'observacoes' ? 280 : 160);
  }
  return lead;
}

function mergeLead(current, extracted) {
  const base = sanitizeLead(current);
  const next = sanitizeLead(extracted);
  for (const field of ALLOWED_FIELDS) {
    if (next[field]) base[field] = next[field];
  }
  return base;
}

function normalizeText(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameAppearsInMessage(name, message) {
  const n = normalizeText(name);
  const m = normalizeText(message);
  return Boolean(n && m.includes(n));
}

function removeUnconfirmedName(reply, previousLead) {
  if (previousLead?.nome) return reply;
  return String(reply || '').replace(/^(Obrigado|Obrigada|Perfeito|Perfeita|Certo|Claro|Combinado),\s+[^.!?]{2,40}\.\s*/i, '$1. ');
}

function extractText(data) {
  if (typeof data.output_text === 'string') return data.output_text;
  const chunks = [];
  for (const item of data.output || []) {
    for (const part of item.content || []) {
      if (part.type === 'output_text' && part.text) chunks.push(part.text);
      if (part.type === 'text' && part.text) chunks.push(part.text);
    }
  }
  return chunks.join('\n').trim();
}

function parseModelJson(data) {
  const text = extractText(data);
  if (!text) throw new Error('Resposta vazia da IA.');
  try {
    return JSON.parse(text);
  } catch (err) {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw err;
  }
}

function isHardOffTopic(message) {
  const text = message.toLowerCase();
  const commercialHints = /(carro|viatura|autom[oó]vel|stand|financiamento|retoma|garantia|test[- ]?drive|visita|pre[cç]o|km|quil[oó]metros|el[eé]trico|h[ií]brido|tesla|renault|fiat|mercedes|bmw|nissan|volkswagen)/i;
  if (commercialHints.test(text)) return false;
  const offTopic = /(pol[ií]tica|religião|religioso|bíblia|sa[uú]de|m[eé]dico|receita|cozinha|password|hack|pirataria|crypto|aposta|jogo online)/i;
  return offTopic.test(text);
}

function safeCommercialReply(reason = '') {
  return {
    reply: 'Consigo ajudar apenas com informação comercial sobre viaturas, financiamento, retoma e marcação de contacto. Para outros assuntos, o ideal será falar diretamente com o gestor comercial.',
    lead: { ...EMPTY_LEAD },
    estado: {
      fora_do_tema: true,
      precisa_humano: true,
      interesse_real: false,
      campos_em_falta: ['nome', 'telefone', 'viatura'],
      motivo: reason || 'fora_do_tema'
    },
    alertas: ['Pergunta fora do âmbito comercial do bot.']
  };
}

function extractPhone(value) {
  const match = String(value || '').match(/(?:\+?351\s*)?9\d{2}[\s.\-]*\d{3}[\s.\-]*\d{3}/);
  return match ? match[0].replace(/\D/g, '').replace(/^351/, '') : '';
}

function extractNameWithContact(value, currentLead, phone) {
  if (currentLead?.nome) return currentLead.nome;
  if (!phone && !currentLead?.telefone) return '';
  const withoutPhone = String(value || '')
    .replace(/(?:\+?351\s*)?9\d{2}[\s.\-]*\d{3}[\s.\-]*\d{3}/, ' ')
    .replace(/^(sou|chamo-me|o meu nome [ée]|nome)\s*[:,-]?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!/^[\p{L}][\p{L}' -]{1,79}$/u.test(withoutPhone)) return '';
  if (withoutPhone.split(/\s+/).length > 5) return '';
  return limitText(withoutPhone, 80);
}

function unavailableFallback(body = {}, reason = 'assistente_temporariamente_indisponivel') {
  const message = sanitizeMessage(body.message || '', 1200);
  const vehicle = limitText(body.contexto?.viatura || body.lead?.viatura || '', 180);
  const lead = mergeLead({ viatura: vehicle }, body.lead || {});
  const phone = extractPhone(message);
  const name = extractNameWithContact(message, lead, phone);
  if (phone) lead.telefone = phone;
  if (name) lead.nome = name;

  const normalized = normalizeText(message);
  const looksLikeQuestion = /\?|\b(qual|como|quanto|quando|onde|porque|estado|informacao|saber)\b/i.test(normalized);
  if (message && looksLikeQuestion) {
    const note = `Pergunta do cliente: ${limitText(message, 220)}`;
    lead.observacoes = limitText([lead.observacoes, note].filter(Boolean).join('; '), 280);
  }

  const missing = [];
  if (!lead.nome) missing.push('nome');
  if (!lead.telefone) missing.push('telefone');
  let reply;
  if (lead.nome && lead.telefone) {
    reply = `Obrigado, ${lead.nome}. A sua pergunta ficou registada para o Carlos confirmar e responder-lhe diretamente.`;
  } else if (lead.telefone) {
    reply = 'Obrigado. Indique por favor o seu nome para o Carlos poder responder à sua pergunta.';
  } else if (lead.nome) {
    reply = `Obrigado, ${lead.nome}. Indique por favor o seu contacto/WhatsApp para o Carlos poder responder.`;
  } else if (/\b(bateria|autonomia|degradacao|saude da bateria)\b/i.test(normalized)) {
    reply = 'O estado da bateria desta viatura precisa de ser confirmado através do diagnóstico ou relatório disponível. Indique o seu nome e contacto/WhatsApp para o Carlos verificar e responder-lhe.';
  } else {
    reply = 'Não consigo confirmar essa informação automaticamente neste momento, mas a sua pergunta ficou registada. Indique o seu nome e contacto/WhatsApp para o Carlos responder diretamente.';
  }

  return {
    reply,
    lead,
    estado: {
      fora_do_tema: false,
      precisa_humano: true,
      interesse_real: true,
      campos_em_falta: missing,
      motivo: reason
    },
    alertas: ['Resposta de segurança usada porque o serviço de IA não respondeu.']
  };
}

function replyHasRiskyConfirmation(reply) {
  const text = reply.toLowerCase();
  const saysHumanWillConfirm = /(confirmar|confirmado pelo gestor|carece|validar|verificar)/i.test(text);
  if (saysHumanWillConfirm) return false;
  return /(est[aá]|continua|temos)\s+dispon[ií]vel|financiamento\s+(aprovado|garantido)|cr[eé]dito\s+(aprovado|garantido)|pre[cç]o\s+final\s+(é|fica)|garantia\s+(confirmada|inclu[ií]da)|equipamento\s+confirmado/i.test(text);
}

function validateModelPayload(raw, previousLead, message = '') {
  const lead = mergeLead(previousLead, raw?.dados_recolhidos || {});
  if (!previousLead?.nome && lead.nome && !nameAppearsInMessage(lead.nome, message)) {
    lead.nome = '';
  }
  let reply = limitText(raw?.resposta_cliente, 520);
  reply = removeUnconfirmedName(reply, previousLead);
  const estado = {
    fora_do_tema: Boolean(raw?.estado?.fora_do_tema),
    precisa_humano: Boolean(raw?.estado?.precisa_humano),
    interesse_real: Boolean(raw?.estado?.interesse_real),
    campos_em_falta: Array.isArray(raw?.estado?.campos_em_falta)
      ? raw.estado.campos_em_falta.filter((f) => ALLOWED_FIELDS.includes(f)).slice(0, 8)
      : [],
    motivo: limitText(raw?.estado?.motivo, 160)
  };
  const alertas = Array.isArray(raw?.alertas)
    ? raw.alertas.map((a) => limitText(a, 140)).filter(Boolean).slice(0, 6)
    : [];

  if (!reply) reply = 'Obrigado. Pode indicar o seu nome, contacto e melhor horário para o Carlos dar seguimento a esta viatura?';

  if (estado.fora_do_tema) {
    reply = 'Consigo ajudar apenas com informação comercial sobre a viatura deste anúncio, financiamento, retoma e marcação de contacto. Para outro assunto, o ideal será falar diretamente com o gestor comercial.';
    estado.precisa_humano = true;
    alertas.push('Resposta limitada por assunto fora do âmbito comercial.');
  }

  if (replyHasRiskyConfirmation(reply)) {
    reply = 'Essa informação deve ser confirmada pelo gestor comercial. Posso recolher os seus dados principais — nome, contacto, financiamento, retoma e melhor horário — para o Carlos dar seguimento a esta viatura.';
    estado.precisa_humano = true;
    alertas.push('Resposta substituída por segurança comercial.');
  }

  return { reply, lead, estado, alertas };
}

class AssistantRequestError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'AssistantRequestError';
    this.status = status;
  }
}

/**
 * Núcleo comercial partilhado pelo chat escrito e pela conversa de voz.
 * Mantém num único ponto as mesmas regras, validações e recolha da lead.
 */
export async function runAssistant(body = {}, options = {}) {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    throw new AssistantRequestError('Falta configurar OPENAI_API_KEY na Vercel.', 500);
  }

  const message = sanitizeMessage(body.message || '', 1200);
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
  const contexto = {
    origem: limitText(body.contexto?.origem || 'standvirtual', 60),
    viatura: limitText(body.contexto?.viatura || '', 180),
    link_anuncio: limitText(body.contexto?.link_anuncio || '', 500)
  };
  const currentLead = mergeLead({ viatura: contexto.viatura }, body.lead || {});

  if (!message.trim()) {
    throw new AssistantRequestError('Mensagem vazia.', 400);
  }

  if (!contexto.viatura && !currentLead.viatura) {
    return {
      reply: 'Para garantir um atendimento correto, este assistente deve ser usado com o link de uma viatura concreta do stock. Indique a viatura do anúncio ou peça ao gestor o link correto.',
      lead: currentLead,
      estado: {
        fora_do_tema: false,
        precisa_humano: true,
        interesse_real: false,
        campos_em_falta: ['viatura'],
        motivo: 'viatura_em_falta_no_contexto'
      },
      alertas: ['Link aberto sem viatura associada.']
    };
  }

  if (isHardOffTopic(message)) {
    const blocked = safeCommercialReply('fora_do_tema_detetado_no_servidor');
    blocked.lead = currentLead;
    return blocked;
  }

  const safeHistory = history.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: sanitizeMessage(m.content || '', 900)
  }));

  const input = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...(contexto.origem === 'voz-elevenlabs' ? [{
      role: 'system',
      content: 'Esta é uma conversa por voz. Fala de forma calorosa e descontraída, trata o cliente por tu, usa uma ou duas frases curtas de cada vez e faz apenas uma pergunta por resposta. Evita listas, endereços web e linguagem demasiado formal.'
    }] : []),
    { role: 'user', content: `Contexto inicial do anúncio: ${JSON.stringify(contexto).slice(0, 1200)}` },
    { role: 'user', content: `Lead atual permitida: ${JSON.stringify(currentLead).slice(0, 900)}` },
    ...safeHistory,
    { role: 'user', content: message }
  ];

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-5.5',
      input,
      max_output_tokens: 520,
      text: {
        format: {
          type: 'json_schema',
          name: 'lead_response',
          strict: true,
          schema: LEAD_SCHEMA
        }
      }
    }),
    signal: options.signal
  });

  const data = await response.json();
  if (!response.ok) {
    throw new AssistantRequestError(data.error?.message || 'Erro na OpenAI API.', response.status);
  }

  const parsed = parseModelJson(data);
  return validateModelPayload(parsed, currentLead, message);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST.' });
    return;
  }

  try {
    const safe = await runAssistant(req.body || {});
    res.status(200).json(safe);
  } catch (err) {
    const status = err instanceof AssistantRequestError ? err.status : 500;
    if (status === 401 || status === 403 || status === 408 || status === 429 || status >= 500) {
      console.error('Serviço de IA indisponível.', { status });
      res.status(200).json(unavailableFallback(req.body || {}));
      return;
    }
    res.status(status).json({ error: 'Não foi possível processar a mensagem.' });
  }
}
