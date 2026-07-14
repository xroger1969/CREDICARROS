import { createServer } from 'node:http';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { runAssistant } from './chat.js';

const FALLBACK_VEHICLE = 'Viatura selecionada no assistente';
const sessionState = new WeakMap();

function cleanText(value, max = 900) {
  return String(value || '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function emptyLead(vehicle = FALLBACK_VEHICLE) {
  return {
    nome: '',
    telefone: '',
    viatura: vehicle,
    orcamento: '',
    financiamento: '',
    retoma: '',
    horario: '',
    observacoes: ''
  };
}

function createState() {
  return {
    contexto: {
      origem: 'voz-elevenlabs',
      viatura: FALLBACK_VEHICLE,
      link_anuncio: ''
    },
    lead: emptyLead()
  };
}

function getState(session) {
  let state = sessionState.get(session);
  if (!state) {
    state = createState();
    sessionState.set(session, state);
  }
  return state;
}

function extractVehicle(transcript) {
  const markers = ['Estamos a falar da viatura:', 'Estou aqui para ajudar com a viatura:'];
  const greeting = transcript.find((item) => (
    item.role === 'agent' && markers.some((marker) => item.content.includes(marker))
  ));
  if (!greeting) return '';
  const marker = markers.find((candidate) => greeting.content.includes(candidate));
  const afterMarker = greeting.content.split(marker)[1] || '';
  return cleanText(afterMarker.split(/\.\s*(?:Diga-me|Como posso|Por onde)/i)[0], 180);
}

const server = createServer((_req, res) => {
  res.writeHead(426, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'Este endpoint requer uma ligação WebSocket.' }));
});

const apiKey = process.env.ELEVENLABS_API_KEY;
const engineId = process.env.ELEVENLABS_SPEECH_ENGINE_ID;

if (apiKey && engineId) {
  const elevenlabs = new ElevenLabsClient({ apiKey });
  elevenlabs.speechEngine.attach(engineId, server, '/api/voice-ws', {
    onInit(_conversationId, session) {
      sessionState.set(session, createState());
    },

    async onTranscript(transcript, signal, session) {
      const state = getState(session);
      const cleanTranscript = transcript
        .map((item) => ({
          role: item.role === 'agent' ? 'assistant' : 'user',
          content: cleanText(item.content)
        }))
        .filter((item) => item.content);
      const lastUserIndex = cleanTranscript.findLastIndex((item) => item.role === 'user');
      if (lastUserIndex < 0) return;

      const vehicle = extractVehicle(transcript);
      if (vehicle) {
        state.contexto.viatura = vehicle;
        state.lead.viatura = vehicle;
      }

      try {
        const result = await runAssistant({
          message: cleanTranscript[lastUserIndex].content,
          history: cleanTranscript.slice(Math.max(0, lastUserIndex - 8), lastUserIndex),
          contexto: state.contexto,
          lead: state.lead
        }, { signal });

        state.lead = result.lead;
        session.sendResponse(result.reply);
      } catch (error) {
        if (signal.aborted || error?.name === 'AbortError') return;
        console.error('[voice] Falha ao gerar resposta:', error?.message || 'erro desconhecido');
        session.sendResponse('Não consegui responder neste momento. Pode continuar por escrito ou enviar o pedido diretamente ao Carlos.');
      }
    },

    onError(error) {
      console.error('[voice] Erro na sessão ElevenLabs:', error?.message || 'erro desconhecido');
    }
  });
}

export default server;
