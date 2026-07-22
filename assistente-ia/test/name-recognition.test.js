import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractExplicitLeadName,
  cleanLeadNameCandidate,
  formatLeadName
} from '../api/voice-client-patched.js';

test('reconhece o nome em minúsculas no exemplo real', () => {
  assert.equal(
    extractExplicitLeadName('320 euros entrada, renault clio 2019 gasolina, fernando 92344455'),
    'Fernando'
  );
});

test('reconhece nomes completos em vários formatos', () => {
  assert.equal(extractExplicitLeadName('Carlos Vasconcelos 923 444 555'), 'Carlos Vasconcelos');
  assert.equal(extractExplicitLeadName('o meu nome é carlos vasconcelos e o telefone é 923444555'), 'Carlos Vasconcelos');
  assert.equal(extractExplicitLeadName('chamo-me maria do carmo, whatsapp 923444555'), 'Maria do Carmo');
});

test('não confunde dados comerciais ou a viatura com um nome', () => {
  assert.equal(extractExplicitLeadName('entrada zero gasolina 923444555'), '');
  assert.equal(extractExplicitLeadName('renault clio 2019 923444555'), '');
  assert.equal(cleanLeadNameCandidate('gasolina'), '');
});

test('normaliza a capitalização do nome', () => {
  assert.equal(formatLeadName('fernando'), 'Fernando');
  assert.equal(formatLeadName('maria do carmo'), 'Maria do Carmo');
});
