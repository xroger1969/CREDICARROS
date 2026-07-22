import test from 'node:test';
import assert from 'node:assert/strict';
import {extractLeadHints,extractName,extractPhone} from '../api/lead-parser.js';

test('extrai nome minúsculo e contacto no exemplo real',()=>{const result=extractLeadHints('320 euros entrada, renault clio 2019 gasolina, fernando 923444555');assert.equal(result.nome,'Fernando');assert.equal(result.telefone,'923444555')});
test('extrai nome completo com partículas',()=>assert.equal(extractName('chamo-me maria do carmo, whatsapp 923444555'),'Maria do Carmo'));
test('não confunde viatura com nome',()=>assert.equal(extractName('renault clio 2019 gasolina 923444555'),''));
test('normaliza telefone português',()=>assert.equal(extractPhone('+351 923 444 555'),'923444555'));
