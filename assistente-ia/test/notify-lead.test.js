import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLeadNotification } from '../api/notify-lead.js';

test('cria alerta de visita sem expor o telefone', () => {
  const notification = buildLeadNotification([
    'Nova lead - Assistente IA',
    'Viatura/Pedido: Tesla Model 3',
    'Opções selecionadas: marcação de visita',
    'Horário/Visita: terça-feira às 10:00',
    'Cliente: Fernando Silva',
    'Contacto: 912345678'
  ].join('\n'));

  assert.equal(notification.heading, 'Novo pedido de visita 🚗');
  assert.match(notification.body, /Fernando Silva/);
  assert.match(notification.body, /Tesla Model 3/);
  assert.match(notification.body, /terça-feira às 10:00/);
  assert.doesNotMatch(notification.body, /912345678/);
  assert.equal(notification.data.kind, 'visit_request');
});

test('cria alerta geral para lead comercial', () => {
  const notification = buildLeadNotification([
    'Nova lead - Assistente IA',
    'Viatura/Pedido: Renault Megane E-Tech',
    'Opções selecionadas: financiamento',
    'Cliente: Marta',
    'Contacto: 919876543'
  ].join('\n'));

  assert.equal(notification.heading, 'Nova lead Credicarros 🚘');
  assert.equal(notification.data.kind, 'lead');
  assert.doesNotMatch(notification.body, /919876543/);
});

test('rejeita pedidos que não sejam leads completas do assistente', () => {
  assert.equal(buildLeadNotification('texto arbitrário'), null);
  assert.equal(buildLeadNotification('Nova lead - Assistente IA\nViatura/Pedido: Tesla'), null);
});
