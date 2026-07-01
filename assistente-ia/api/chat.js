const SYSTEM_PROMPT = `És o assistente comercial de Carlos Vasconcelos, vendedor de automóveis usados em Portugal.

Objetivo:
- Ajudar o cliente de forma clara, educada e comercial.
- Recolher informação útil para uma lead: nome, telefone, viatura de interesse, orçamento ou prestação, financiamento, retoma e melhor horário de contacto.
- Encaminhar para Carlos quando houver intenção real de compra.

Regras importantes:
- Não confirmes disponibilidade real da viatura.
- Não confirmes preço final, despesas, garantia, equipamento ou aprovação de crédito como definitivo.
- Quando o cliente perguntar algo incerto, responde que será confirmado pelo gestor comercial.
- Mantém respostas curtas, naturais e comerciais.
- Se o cliente mostrar interesse, pede os dados em falta.
- Fala sempre em português de Portugal, salvo se o cliente escrever noutra língua.
- Não inventes características técnicas específicas de um carro se não forem dadas no contexto.

Links úteis:
- Stock: https://spremium.standvirtual.com/inventory
- Simulador de crédito: https://xroger1969.github.io/CREDICARROS/
- WhatsApp Carlos: 918404101`;

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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST.' });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Falta configurar OPENAI_API_KEY na Vercel.' });
    return;
  }

  try {
    const body = req.body || {};
    const message = String(body.message || '').slice(0, 1200);
    const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
    const contexto = body.contexto || {};

    if (!message.trim()) {
      res.status(400).json({ error: 'Mensagem vazia.' });
      return;
    }

    const safeHistory = history.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').slice(0, 1000)
    }));

    const input = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Contexto inicial: ${JSON.stringify(contexto).slice(0, 1000)}` },
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
        max_output_tokens: 320
      })
    });

    const data = await response.json();
    if (!response.ok) {
      res.status(response.status).json({ error: data.error?.message || 'Erro na OpenAI API.' });
      return;
    }

    const reply = extractText(data) || 'Obrigado. Pode indicar o seu nome, contacto e a viatura que pretende?';
    res.status(200).json({ reply });
  } catch (err) {
    res.status(500).json({ error: 'Erro inesperado no assistente.' });
  }
}
