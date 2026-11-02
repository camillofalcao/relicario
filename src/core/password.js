// Política de senhas (ESPECIFICACAO.md, seção 4.2) e gerador de frases-senha.
import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as common from '@zxcvbn-ts/language-common';
import * as ptBr from '@zxcvbn-ts/language-pt-br';
import { wordlist } from '@scure/bip39/wordlists/portuguese.js';
import { normalizePassword } from './crypto.js';

export const MIN_LENGTH = 16;
export const MIN_GUESSES_LOG10 = 20;
export const PASSPHRASE_WORDS = 7;

let factory;
function zxcvbn() {
  factory ??= new ZxcvbnFactory({
    translations: ptBr.translations,
    graphs: common.adjacencyGraphs,
    dictionary: { ...common.dictionary, ...ptBr.dictionary },
    useLevenshteinDistance: true,
  });
  return factory;
}

const SEPARATORS = /[\s\-_.,;:]+/;
const words = (pw) => pw.toLowerCase().split(SEPARATORS).filter((w) => w.length >= 3);

// O zxcvbn superestima frases: cada separador conta como caractere aleatório e a
// combinação de palavras ganha bônus. Ficamos com o menor de: a estimativa normal,
// a estimativa sem separadores e o simples produto das estimativas de cada trecho.
function conservativeLog10(norm, others, plain) {
  const stripped = norm.replace(new RegExp(SEPARATORS.source, 'g'), '');
  const res = zxcvbn().check(stripped, others);
  const perMatch = res.sequence.reduce((sum, m) => sum + Math.log10(m.guesses), 0);
  return Math.min(plain, res.guessesLog10, perMatch);
}

// `others`: as demais senhas do mesmo conjunto. Entram como dicionário, para que uma
// senha não seja variação fácil de outra (se um guardião for coagido, a outra
// senha precisa resistir sozinha).
export function evaluatePassword(password, others = []) {
  const norm = normalizePassword(password);
  const otherNorm = others.map(normalizePassword).filter(Boolean);
  const length = [...norm].length;
  // Cada palavra das outras senhas também entra como dicionário: reordenar ou
  // reaproveitar palavras de outra senha não pode parecer forte.
  const inputs = [...otherNorm, ...otherNorm.flatMap(words)];
  const res = zxcvbn().check(norm, inputs);
  const guessesLog10 = conservativeLog10(norm, inputs, res.guessesLog10);
  const own = new Set(words(norm));
  const shared = Math.max(0, ...otherNorm.map((o) => new Set(words(o).filter((w) => own.has(w))).size));
  const problems = [];
  if (length < MIN_LENGTH) problems.push(`Use pelo menos ${MIN_LENGTH} caracteres (agora: ${length}).`);
  if (otherNorm.includes(norm)) problems.push('Igual a outra senha deste conjunto.');
  else if (shared >= 2) problems.push('Repete palavras de outra senha deste conjunto. Se um guardião for coagido, a outra senha ficaria fácil de adivinhar.');
  else if (guessesLog10 < MIN_GUESSES_LOG10) problems.push('Previsível demais. Use uma frase de palavras aleatórias ou uma senha mais longa.');
  return {
    ok: problems.length === 0,
    guessesLog10,
    problems,
    warning: res.feedback.warning || '',
    suggestions: res.feedback.suggestions || [],
    nonAscii: /[^\x20-\x7e]/.test(norm),
    trimmed: norm !== password,
  };
}

// 7 palavras da lista BIP39 em português (2048 palavras, sem acentos,
// 4 primeiras letras únicas): 77 bits. Cerca de 1 frase em 1.500 cai abaixo do limite
// da estimativa conservadora (palavras muito comuns juntas); essas são sorteadas de
// novo, assim como as com palavra repetida (~1 em 200); custa menos de 0,01 bit.
// `others`: senhas dos outros guardiões, para a frase gerada já respeitar a regra de
// palavras compartilhadas.
export function generatePassphrase(others = [], count = PASSPHRASE_WORDS) {
  for (;;) {
    const r = crypto.getRandomValues(new Uint16Array(count));
    const list = Array.from(r, (v) => wordlist[v & 2047]);
    if (new Set(list).size !== list.length) continue; // sem palavra repetida
    const phrase = list.join(' ');
    if (count !== PASSPHRASE_WORDS || evaluatePassword(phrase, others).ok) return phrase;
  }
}

export { wordlist };
