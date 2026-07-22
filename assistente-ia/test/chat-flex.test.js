import test from 'node:test';
import assert from 'node:assert/strict';
import {
  requiresStrictCommercialHandling,
  replyHasSensitiveCommitment,
  runFlexibleCommercialAssistant
} from '../api/chat-flex.js';

test('permite explicar financiamento e retoma em termos gerais', () => {
  assert.equal(requiresStrictCommercialHandling('Como funciona normalmente o financiamento?'), false);
  assert.equal(requiresStrictCommercialHandling('Como funciona o processo de retoma?'), false);
  assert.equal(requiresStrictCommercialHandling('Um elétrico compensa para quem faz 100 km por dia?'), false);
});

test('mantém no modo rigoroso valores, aprovação, disponibilidade e avaliação', () => {
  assert.equal(requiresStrictCommercialHandling('Está disponível?'), true);
  assert.equal(requiresStrictCommercialHandling('Quanto fica a prestação com 2.000 € de entrada?'), true);
  assert.equal(requiresStrictCommercialHandling('O crédito fica aprovado?'), true);
  assert.equal(requiresStrictCommercialHandling('Quanto vale o meu Renault para retoma?'), true);
  assert.equal(requiresStrictCommercialHandling('Qual é a autonomia real desta viatura?'), true);
});

test('o validador bloqueia compromissos comerciais indevidos', () => {
  assert.equal(replyHasSensitiveCommitment('A viatura está disponível e pode reservar já.', 'Está disponível?'), true);
  assert.equal(replyHasSensitiveCommitment('A prestação fica em 250 € por mês.', 'Quanto fica o financiamento?'), true);
  assert.equal(replyHasSensitiveCommitment('A sua retoma vale 8.000 €.', 'Quanto vale a minha retoma?'), true);
  assert.equal(replyHasSensitiveCommitment('Em geral, um elétrico pode ser vantajoso para percursos diários regulares.', 'Um elétrico compensa?'), false);
});

test('o modo flexível responde à pergunta antes de pedir dados', async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'teste-local';
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        output_text: 'Em geral, carregar em casa é a solução mais cómoda e económica. Convém confirmar a potência disponível e escolher um carregador adequado à instalação.'
      };
    }
  });

  try {
    const result = await runFlexibleCommercialAssistant({
      message: 'Posso carregar um elétrico em casa?',
      contexto: { viatura: 'Tesla Model 3' },
      lead: { viatura: 'Tesla Model 3' }
    });

    assert.match(result.reply, /carregar em casa/i);
    assert.doesNotMatch(result.reply, /indique.*nome|contacto\/WhatsApp/i);
    assert.equal(result.estado.motivo, 'conversa_automovel_flexivel');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey) process.env.OPENAI_API_KEY = previousKey;
    else delete process.env.OPENAI_API_KEY;
  }
});
