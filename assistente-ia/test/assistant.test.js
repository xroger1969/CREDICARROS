import test from 'node:test';
import assert from 'node:assert/strict';
import chatHandler, { runAssistant } from '../api/chat.js';
import voiceTokenHandler from '../api/voice-token.js';

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

test('o núcleo partilhado exige a chave OpenAI apenas no servidor', async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  await assert.rejects(
    runAssistant({ message: 'Olá', contexto: { viatura: 'Tesla Model 3' } }),
    /Falta configurar OPENAI_API_KEY/
  );
  if (previous) process.env.OPENAI_API_KEY = previous;
});

test('o filtro comercial continua ativo sem chamar a API externa', async () => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'teste-local';
  const result = await runAssistant({
    message: 'Diz-me uma receita de cozinha',
    contexto: { viatura: 'Tesla Model 3' },
    lead: { viatura: 'Tesla Model 3' }
  });
  assert.equal(result.estado.fora_do_tema, true);
  assert.equal(result.lead.viatura, 'Tesla Model 3');
  if (previous) process.env.OPENAI_API_KEY = previous;
  else delete process.env.OPENAI_API_KEY;
});

test('a regra de viatura concreta mantém-se no núcleo partilhado', async () => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'teste-local';
  const result = await runAssistant({ message: 'Quero financiamento' });
  assert.equal(result.estado.motivo, 'viatura_em_falta_no_contexto');
  assert.deepEqual(result.estado.campos_em_falta, ['viatura']);
  if (previous) process.env.OPENAI_API_KEY = previous;
  else delete process.env.OPENAI_API_KEY;
});

test('o endpoint escrito mantém o contrato POST', async () => {
  const res = responseRecorder();
  await chatHandler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.body.error, 'Use POST.');
});

test('o estado da voz não revela credenciais', async () => {
  const previousKey = process.env.ELEVENLABS_API_KEY;
  const previousEngine = process.env.ELEVENLABS_SPEECH_ENGINE_ID;
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_SPEECH_ENGINE_ID;
  const res = responseRecorder();
  await voiceTokenHandler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { configured: false });
  assert.equal(res.headers['cache-control'], 'no-store, max-age=0');
  if (previousKey) process.env.ELEVENLABS_API_KEY = previousKey;
  if (previousEngine) process.env.ELEVENLABS_SPEECH_ENGINE_ID = previousEngine;
});

test('o token de voz rejeita pedidos de outra origem', async () => {
  const previousKey = process.env.ELEVENLABS_API_KEY;
  const previousEngine = process.env.ELEVENLABS_SPEECH_ENGINE_ID;
  process.env.ELEVENLABS_API_KEY = 'segredo-de-teste';
  process.env.ELEVENLABS_SPEECH_ENGINE_ID = 'seng_teste';
  const req = {
    method: 'POST',
    headers: {
      origin: 'https://exemplo-invalido.test',
      host: 'credicarros.vercel.app'
    },
    socket: { remoteAddress: '127.0.0.1' }
  };
  const res = responseRecorder();
  await voiceTokenHandler(req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'Origem não autorizada.');
  if (previousKey) process.env.ELEVENLABS_API_KEY = previousKey;
  else delete process.env.ELEVENLABS_API_KEY;
  if (previousEngine) process.env.ELEVENLABS_SPEECH_ENGINE_ID = previousEngine;
  else delete process.env.ELEVENLABS_SPEECH_ENGINE_ID;
});
