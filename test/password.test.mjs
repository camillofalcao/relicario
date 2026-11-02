import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePassword, generatePassphrase, wordlist } from '../src/core/password.js';

test('lista BIP39 em português: 2048 palavras ASCII, prefixos de 4 letras únicos', () => {
  assert.equal(wordlist.length, 2048);
  assert.ok(wordlist.every((w) => /^[a-z]+$/.test(w)));
  assert.equal(new Set(wordlist.map((w) => w.slice(0, 4))).size, 2048);
});

test('frases geradas sempre passam', () => {
  for (let i = 0; i < 300; i++) assert.ok(evaluatePassword(generatePassphrase()).ok);
});

test('senhas fracas, famosas ou naturais são rejeitadas', () => {
  for (const p of [
    'Senha@2024Senha@2024',
    'correct horse battery staple',
    'o rato roeu a roupa do rei de roma',
    'minha casa amarela fica perto do rio',
    'Tr0ub4dor&3-Tr0ub4dor&3',
    'curta',
  ]) assert.equal(evaluatePassword(p).ok, false, p);
});

test('variação de outra senha do conjunto é rejeitada', () => {
  const a = generatePassphrase();
  assert.equal(evaluatePassword(`${a} 2`, [a]).ok, false);
  assert.equal(evaluatePassword(` ${a}`, [a]).ok, false);
  assert.ok(evaluatePassword(generatePassphrase(), [a]).ok);
});

test('senhas de guardiões não podem reaproveitar palavras umas das outras', () => {
  const a = 'jazida cimento feijoada humorado irreal honrado ereto';
  const reordenada = 'ereto honrado irreal humorado feijoada cimento jazida';
  const parcial = 'ereto honrado irreal humorado feijoada vuvuzela sucata';
  assert.equal(evaluatePassword(reordenada, [a]).ok, false);
  assert.equal(evaluatePassword(parcial, [a]).ok, false);
});

test('frase gerada não repete palavras', () => {
  for (let i = 0; i < 300; i++) {
    const w = generatePassphrase().split(' ');
    assert.equal(new Set(w).size, w.length);
  }
});
