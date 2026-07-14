import test from 'node:test';
import assert from 'node:assert/strict';
import chatHandler, { runAssistant } from '../api/chat.js';
import ttsHandler, {
  cleanSpeechText,
  DEFAULT_TTS_MODEL,
  DEFAULT_TTS_VOICE_ID
} from '../api/tts.js';

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
    },
    end(payload) {
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

test('o estado da leitura de voz não revela credenciais', async () => {
  const previous = process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  const res = responseRecorder();
  await ttsHandler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { configured: false });
  assert.equal(res.headers['cache-control'], 'no-store, max-age=0');
  if (previous) process.env.ELEVENLABS_API_KEY = previous;
});

test('a leitura de voz rejeita pedidos de outra origem', async () => {
  const previous = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = 'segredo-de-teste';
  const res = responseRecorder();
  await ttsHandler({
    method: 'POST',
    headers: {
      origin: 'https://exemplo-invalido.test',
      host: 'credicarros.vercel.app'
    },
    socket: { remoteAddress: '127.0.0.2' },
    body: { text: 'Olá' }
  }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'Origem não autorizada.');
  if (previous) process.env.ELEVENLABS_API_KEY = previous;
  else delete process.env.ELEVENLABS_API_KEY;
});

test('o texto enviado para voz é limitado e não lê endereços web', () => {
  assert.equal(
    cleanSpeechText('Veja https://example.test/carro agora'),
    'Veja link do anúncio agora'
  );
  assert.equal(cleanSpeechText('x'.repeat(1000)).length, 900);
});

test('as respostas usam a voz portuguesa e o modelo natural da ElevenLabs', async () => {
  const previousKey = process.env.ELEVENLABS_API_KEY;
  const previousVoice = process.env.ELEVENLABS_VOICE_ID;
  const previousModel = process.env.ELEVENLABS_TTS_MODEL;
  const previousFetch = globalThis.fetch;
  process.env.ELEVENLABS_API_KEY = 'segredo-de-teste';
  delete process.env.ELEVENLABS_VOICE_ID;
  delete process.env.ELEVENLABS_TTS_MODEL;
  let outbound;
  globalThis.fetch = async (url, options) => {
    outbound = { url, options };
    return {
      ok: true,
      status: 200,
      async arrayBuffer() {
        return Uint8Array.from([73, 68, 51]).buffer;
      }
    };
  };

  try {
    const res = responseRecorder();
    await ttsHandler({
      method: 'POST',
      headers: {
        origin: 'https://credicarros.vercel.app',
        host: 'credicarros.vercel.app'
      },
      socket: { remoteAddress: '127.0.0.3' },
      body: { text: 'Olá, como posso ajudar?' }
    }, res);

    const payload = JSON.parse(outbound.options.body);
    assert.match(outbound.url, new RegExp(DEFAULT_TTS_VOICE_ID));
    assert.equal(payload.model_id, DEFAULT_TTS_MODEL);
    assert.equal(payload.text, 'Olá, como posso ajudar?');
    assert.equal(payload.voice_settings.speed, 0.98);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'audio/mpeg');
    assert.ok(Buffer.isBuffer(res.body));
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey) process.env.ELEVENLABS_API_KEY = previousKey;
    else delete process.env.ELEVENLABS_API_KEY;
    if (previousVoice) process.env.ELEVENLABS_VOICE_ID = previousVoice;
    else delete process.env.ELEVENLABS_VOICE_ID;
    if (previousModel) process.env.ELEVENLABS_TTS_MODEL = previousModel;
    else delete process.env.ELEVENLABS_TTS_MODEL;
  }
});
