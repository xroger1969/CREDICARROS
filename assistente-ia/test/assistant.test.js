import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
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

test('uma chave OpenAI inválida nunca é mostrada ao cliente e a pergunta fica registada', async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  const previousError = console.error;
  process.env.OPENAI_API_KEY = 'sk-chave-invalida';
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    async json() {
      return { error: { message: 'Incorrect API key provided: sk-segredo' } };
    }
  });
  console.error = () => {};

  try {
    const first = responseRecorder();
    await chatHandler({
      method: 'POST',
      body: {
        message: 'Qual é o estado da bateria?',
        contexto: { viatura: 'BYD Atto 3 Ver Design' },
        lead: { viatura: 'BYD Atto 3 Ver Design' }
      }
    }, first);

    assert.equal(first.statusCode, 200);
    assert.match(first.body.reply, /estado da bateria.*confirmado/i);
    assert.match(first.body.lead.observacoes, /Qual é o estado da bateria/);
    assert.doesNotMatch(JSON.stringify(first.body), /Incorrect API key|sk-segredo/i);

    const second = responseRecorder();
    await chatHandler({
      method: 'POST',
      body: {
        message: 'Marta Rodrigues 939 809 409',
        contexto: { viatura: 'BYD Atto 3 Ver Design' },
        lead: first.body.lead
      }
    }, second);

    assert.equal(second.statusCode, 200);
    assert.equal(second.body.lead.nome, 'Marta Rodrigues');
    assert.equal(second.body.lead.telefone, '939809409');
    assert.match(second.body.reply, /pergunta ficou registada/i);
  } finally {
    globalThis.fetch = previousFetch;
    console.error = previousError;
    if (previousKey) process.env.OPENAI_API_KEY = previousKey;
    else delete process.env.OPENAI_API_KEY;
  }
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

function browserFlow() {
  function createElement(tag = 'div', text = '') {
    const classes = new Set();
    let content = String(text);
    let html = content;
    const el = {
      tagName: tag.toUpperCase(),
      dataset: {},
      attributes: {},
      children: [],
      parentNode: null,
      style: {},
      scrollTop: 0,
      disabled: false,
      value: '',
      href: '',
      classList: {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        contains: (name) => classes.has(name),
        toggle(name, force) {
          const active = force === undefined ? !classes.has(name) : Boolean(force);
          if (active) classes.add(name);
          else classes.delete(name);
          return active;
        }
      },
      appendChild(child) {
        if (child.parentNode) child.parentNode.children = child.parentNode.children.filter((item) => item !== child);
        child.parentNode = this;
        this.children.push(child);
        return child;
      },
      append(...children) {
        children.forEach((child) => this.appendChild(child));
      },
      remove() {
        if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((item) => item !== this);
      },
      setAttribute(name, value) {
        this.attributes[name] = String(value);
      },
      addEventListener() {},
      focus() {},
      click() {}
    };
    Object.defineProperties(el, {
      className: {
        get: () => [...classes].join(' '),
        set(value) {
          classes.clear();
          String(value || '').split(/\s+/).filter(Boolean).forEach((name) => classes.add(name));
        }
      },
      textContent: {
        get: () => content,
        set(value) {
          content = String(value ?? '');
          html = content;
        }
      },
      innerHTML: {
        get: () => html,
        set(value) {
          html = String(value ?? '');
          content = html.replace(/<[^>]*>/g, '');
        }
      },
      lastChild: {
        get: () => el.children.at(-1)
      },
      scrollHeight: {
        get: () => el.children.length * 50
      }
    });
    el.textContent = text;
    return el;
  }

  const chat = createElement('div');
  const form = createElement('form');
  const input = createElement('input');
  const sendLead = createElement('a');
  const quick = createElement('div');
  quick.className = 'quick hidden';
  const optionData = [
    ['disponibilidade', '✅ Disponibilidade'],
    ['financiamento', '💳 Financiamento'],
    ['retoma', '🔄 Retoma'],
    ['visita', '📅 Marcar visita']
  ];
  const buttons = optionData.map(([key, label]) => {
    const button = createElement('button', label);
    button.dataset.key = key;
    quick.appendChild(button);
    return button;
  });
  const ids = { chat, form, input, sendLead };
  const document = {
    body: createElement('body'),
    documentElement: { style: { setProperty() {} } },
    getElementById: (id) => ids[id],
    querySelector: (selector) => selector === '.quick' ? quick : null,
    querySelectorAll(selector) {
      if (selector === '.quick button') return buttons;
      if (selector === '.bot.latest') return chat.children.filter((item) => item.classList?.contains('bot') && item.classList.contains('latest'));
      return [];
    },
    createElement
  };
  const speech = [];
  const timers = new Map();
  let timerId = 0;
  const sandbox = {
    document,
    location: { search: '?viatura=Tesla%20Model%203' },
    URLSearchParams,
    console,
    fetch: async () => ({ json: async () => ({ results: [] }) }),
    requestAnimationFrame: (fn) => fn(),
    setTimeout(fn) {
      timerId += 1;
      timers.set(timerId, fn);
      return timerId;
    },
    clearTimeout(id) {
      timers.delete(id);
    }
  };
  sandbox.window = {
    innerHeight: 800,
    visualViewport: null,
    addEventListener() {},
    queueAssistantSpeech(text, options) {
      speech.push({ text, options });
    }
  };
  sandbox.runTimers = () => {
    const pending = [...timers.values()];
    timers.clear();
    pending.forEach((fn) => fn());
  };

  const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, sandbox);
  return { sandbox, buttons, speech };
}

test('as opções clicadas são acumuladas e as desmarcadas saem do resumo e da lead', () => {
  const { sandbox, buttons, speech } = browserFlow();

  buttons[0].onclick();
  buttons[1].onclick();
  buttons[2].onclick();

  assert.match(sandbox.summary(), /disponibilidade, financiamento e retoma/);
  assert.match(sandbox.leadText(), /Opções selecionadas: disponibilidade, financiamento e retoma/);
  assert.equal(buttons[1].attributes['aria-pressed'], 'true');
  sandbox.runTimers();
  assert.match(speech.at(-1).text, /disponibilidade, financiamento e retoma/);
  assert.equal(speech.at(-1).options.replace, true);

  buttons[1].onclick();

  assert.match(sandbox.summary(), /disponibilidade e retoma/);
  assert.doesNotMatch(sandbox.summary(), /financiamento/);
  assert.doesNotMatch(sandbox.leadText(), /financiamento/i);
  assert.equal(buttons[1].attributes['aria-pressed'], 'false');
});

test('os detalhes de várias opções ficam todos compilados e uma correção remove os respetivos dados', () => {
  const { sandbox, buttons } = browserFlow();

  buttons.forEach((button) => button.onclick());
  sandbox.processQuick('Quero confirmar a disponibilidade');
  sandbox.processQuick('Entrada de 5.000 euros e prestação de 300 euros');
  sandbox.processQuick('Renault Clio de 2018 com 80.000 km');
  sandbox.processQuick('Sexta-feira às 15 horas');

  const compiled = sandbox.leadText();
  assert.match(compiled, /Opções selecionadas: disponibilidade, financiamento, retoma e marcação de visita/);
  assert.match(compiled, /Entrada\/Prestação: .*5\.000 euros/);
  assert.match(compiled, /Retoma: Renault Clio de 2018/);
  assert.match(compiled, /Horário\/Visita: .*Sexta-feira às 15 horas/);
  assert.doesNotMatch(compiled, /test-drive/i);

  buttons[2].onclick();
  assert.doesNotMatch(sandbox.leadText(), /Renault Clio/);
  assert.doesNotMatch(sandbox.summary(), /retoma/);
});

test('a voz omite contagens técnicas do tipo passo 1 de 2', () => {
  const source = readFileSync(new URL('../voice-client.js', import.meta.url), 'utf8');
  const body = source.match(/function cleanForSpeech\(value\) \{([\s\S]*?)\n  \}/)?.[1];
  assert.ok(body, 'função de limpeza da voz encontrada');
  const cleanForSpeech = Function('value', body);

  assert.equal(cleanForSpeech('1/2 — Retoma: Qual é a viatura?'), 'Retoma: Qual é a viatura?');
  assert.equal(cleanForSpeech('Passo 1 de 2. Financiamento: qual é a entrada?'), 'Financiamento: qual é a entrada?');
});

test('o controlo da voz fica no topo e o assistente inicia com a voz ligada', () => {
  const html = readFileSync(new URL('../novo.html', import.meta.url), 'utf8');
  const voice = readFileSync(new URL('../voice-client.js', import.meta.url), 'utf8');

  assert.ok(html.indexOf('id="voiceToggle"') < html.indexOf('id="chat"'));
  assert.match(html, /id="voiceToggle"[^>]+aria-pressed="true"/);
  assert.match(voice, /let enabled = true;/);
  assert.match(voice, /O som começa no primeiro toque/);
});

test('a introdução é registada antes do arranque do assistente e fica disponível para leitura', () => {
  const html = readFileSync(new URL('../novo.html', import.meta.url), 'utf8');
  const voice = readFileSync(new URL('../voice-client.js', import.meta.url), 'utf8');

  assert.ok(html.indexOf('./voice-client.js') < html.indexOf('./app.js'));
  assert.match(voice, /queue\.push\(text\)/);
  assert.match(voice, /touchend/);
  assert.match(voice, /primeAudioContext/);
});
