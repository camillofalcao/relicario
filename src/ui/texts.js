// Textos impressos e do arquivo eletrônico.
/* global __RELICARIO_URL__ */
import { MODE_SIMPLE } from '../core/format.js';

export const HOSTED_URL = typeof __RELICARIO_URL__ === 'string' ? __RELICARIO_URL__ : '';

export const WARNING_ONLINE =
  'O Relicário funciona sem internet. Se ele pedir login, e-mail, pagamento ou para enviar algo, pare: não é o Relicário verdadeiro.';
export const WARNING_PASSWORD = 'Guarde a senha longe desta folha.';

function where() {
  return HOSTED_URL
    ? `o arquivo relicario.html (pendrive ou cópia guardada) ou o endereço ${HOSTED_URL}`
    : 'o arquivo relicario.html (pendrive ou cópia guardada)';
}

// Instruções em linguagem simples. Devolve { intro, steps }.
export function instructions({ mode, x, label }) {
  if (mode === MODE_SIMPLE) {
    return {
      intro:
        `Esta folha guarda um texto protegido por criptografia (conjunto ${label}). ` +
        'Para ler, você precisa desta folha e da senha, que fica guardada em outro lugar.',
      steps: [
        `Abra ${where()} num celular ou computador.`,
        'Ative o modo avião (sem internet) e toque em “Abrir um Relicário”.',
        'Use a câmera para ler os códigos desta folha, em qualquer ordem. Não é preciso ler todos.',
        'Digite a senha.',
        'Sem código legível? Digite as linhas da “Versão em texto”.',
      ],
    };
  }
  return {
    intro:
      `Esta é a PARTE ${x} DE 3 do conjunto ${label}. Ela sozinha não revela nada. ` +
      'Para ler, são necessárias 2 partes quaisquer deste conjunto (de guardiões diferentes) e a senha de cada uma.',
    steps: [
      `Abra ${where()} num celular ou computador.`,
      'Ative o modo avião (sem internet) e toque em “Abrir um Relicário”.',
      'Leia com a câmera o código grande “PARTE-CHAVE” desta folha e o de outra parte.',
      'Leia os códigos do conteúdo (iguais em todas as partes), em qualquer ordem.',
      'Cada guardião digita a senha da sua parte.',
    ],
  };
}

export const SPEC_TITLE = 'Relicário v1 — como decifrar sem o programa (para programadores)';

export const SPEC_LINES = [
  'Inteiros multibyte em big-endian. Cada QR contém texto Base45 (RFC 9285) de um quadro.',
  'Quadro: "RL" (2) | versão = 1 (1) | tipo (1) | conjunto (5) | campos | CRC-32 IEEE de todos os bytes anteriores (4).',
  'Tipo 1, bloco de conteúdo (402 bytes): x (1) | k (1) | n (1) | L (2) | dados (384).',
  'Reed-Solomon por avaliação em GF(2^8), polinômio 0x11B: em cada posição de byte, os blocos x = 0..k−1 são os valores ' +
    'de um polinômio de grau < k em x; os blocos x = k..n−1 são o mesmo polinômio em x. Com quaisquer k blocos, interpole ' +
    '(Lagrange) os valores em x = 0..k−1, concatene e pegue os L primeiros bytes: é o objeto de conteúdo.',
  'Tipo 2, parte-chave (72 bytes): x (1) | limiar (1) | total (1) | kdf = 1 (1) | m em KiB (4) | t (1) | p (1) | sal (16) | ' +
    'mascarado (32) | check (1). Simples: x = 0, limiar 1, total 1. Dividido: x ∈ {1,2,3}, limiar 2, total 3.',
  'Objeto de conteúdo: versão = 1 (1) | modo (1: simples, 2: 2-de-3) | conjunto (5) | nonce (12) | AES-256-GCM do bloco ' +
    'interno (texto cifrado + tag de 16 bytes), com AAD = os 19 primeiros bytes.',
  'Senha: normalizar Unicode para NFC, trocar cada sequência de espaços em branco por um espaço, remover os das pontas, codificar em UTF-8.',
  'Argon2id v1.3 (0x13) com senha, sal, memória m KiB, t passadas, p faixas, saída de 33 bytes = pad (32) | c (1). ' +
    'Se c ≠ check, a senha está errada. segredo = mascarado XOR pad.',
  'Simples: chave = segredo. 2-de-3 (Shamir em GF(2^8), 0x11B), byte a byte com duas partes (xi, yi), (xj, yj): ' +
    'chave = (yi·xj ⊕ yj·xi) / (xi ⊕ xj).',
  'Bloco interno decifrado: L (4) | DEFLATE bruto (RFC 1951) de L bytes | zeros. Descomprimir → texto em UTF-8.',
  'Versão em texto: linhas "NNN  dados  CC", dados em Base32 Crockford (alfabeto 0-9 A-Z sem I L O U) de até 20 bytes; ' +
    'CC = 10 bits baixos do CRC-32 de (seção | NNN em 2 bytes | bytes da linha), em 2 caracteres Base32 Crockford. ' +
    'Seção 1 = objeto de conteúdo; seção 2 = quadro da parte-chave.',
  'Especificação completa e vetores de teste: repositório "relicario" (arquivo ESPECIFICACAO.md).',
];
