// Formato binário do Relicário v1 (ver ESPECIFICACAO.md, seções 5, 7 e 8).
import { concat, u16, u32, readU16, readU32 } from './bytes.js';
import { crc32 } from './crc32.js';
import * as base32 from './base32.js';
import * as rs from './rs.js';

export const MAGIC = Uint8Array.of(0x52, 0x4c); // "RL"
export const FORMAT_VERSION = 1;
export const TYPE_BLOCK = 1;
export const TYPE_KEY = 2;
export const MODE_SIMPLE = 1;
export const MODE_2OF3 = 2;
export const KDF_ARGON2ID = 1;

export const SET_ID_LEN = 5;
export const NONCE_LEN = 12;
export const SALT_LEN = 16;
export const KEY_LEN = 32;
export const TAG_LEN = 16;
export const CONTENT_HEADER_LEN = 2 + SET_ID_LEN + NONCE_LEN; // 19
export const BUCKETS = [256, 512, 1024, 2048, 4096, 8192];
// Tamanhos possíveis do objeto de conteúdo (cabeçalho + faixa cifrada + tag).
export const CONTENT_SIZES = BUCKETS.map((b) => CONTENT_HEADER_LEN + b + TAG_LEN);

export const BLOCK_DATA_LEN = 384;
export const BLOCK_FRAME_LEN = 402;
export const KEY_FRAME_LEN = 72;
const FRAME_HEADER_LEN = 9;

// Limites de leitura dos parâmetros do KDF (evitam travar o aparelho com um papel forjado).
export const KDF_LIMITS = { mMax: 262144, tMax: 16, pMax: 8 };
// Limites do leitor contra QRs ou arquivos com candidatos demais (cada um custa trabalho).
export const MAX_CANDIDATES = 4; // partes-chave ou blocos diferentes com o mesmo índice
export const MAX_CONTENTS = 4; // conteúdos completos diferentes de um mesmo conjunto
// Trabalho total de reconstrução Reed-Solomon de um coletor (unidade = blocos × k ≈ 384
// multiplicações em GF(256); ver assembleContent). Valor definido pelas medições em
// test/collector.test.mjs: ler os 33 códigos do maior conteúdo custa uma fração disso.
export const MAX_RS_WORK = 4_000_000;

export class FormatError extends Error {}
// Orçamento de reconstrução esgotado (ver assembleContent).
export class BudgetError extends Error {}

function frameHeader(type, setId) {
  return concat(MAGIC, [FORMAT_VERSION, type], setId);
}

function sealFrame(body) {
  return concat(body, u32(crc32(body)));
}

// Códigos de conteúdo por folha impressa. Entra no cálculo da paridade: a paridade
// precisa cobrir a perda de uma folha inteira.
export const QRS_PER_SHEET = 9;

export function sheetCount(n) {
  return Math.ceil(n / QRS_PER_SHEET);
}

// Menor paridade p ≥ max(2, ⌈k/2⌉) tal que, com os n = k + p códigos distribuídos por
// igual entre as folhas, perder a folha mais cheia ainda deixa k códigos.
// O leitor exige exatamente este n (e um dos tamanhos de CONTENT_SIZES): parâmetros que
// nenhum gerador v1 emite só serviriam para inflar o trabalho de reconstrução.
export function parityCount(k) {
  for (let p = Math.max(2, Math.ceil(k / 2)); ; p++) {
    const n = k + p;
    const sheets = sheetCount(n);
    if (sheets === 1 || p >= Math.ceil(n / sheets)) return p;
  }
}

// ---------------------------------------------------------------- objeto de conteúdo

export function buildContentHeader(mode, setId, nonce) {
  return concat([FORMAT_VERSION, mode], setId, nonce);
}

export function parseContentObject(obj) {
  if (obj.length < CONTENT_HEADER_LEN + TAG_LEN) throw new FormatError('Conteúdo cifrado curto demais.');
  if (obj[0] !== FORMAT_VERSION) throw new FormatError(`Versão de formato não suportada: ${obj[0]}.`);
  const mode = obj[1];
  if (mode !== MODE_SIMPLE && mode !== MODE_2OF3) throw new FormatError(`Modo desconhecido: ${mode}.`);
  const ctLen = obj.length - CONTENT_HEADER_LEN;
  if (!BUCKETS.includes(ctLen - TAG_LEN)) throw new FormatError('Tamanho do conteúdo cifrado inválido.');
  return {
    mode,
    setId: obj.slice(2, 7),
    nonce: obj.slice(7, 19),
    header: obj.slice(0, CONTENT_HEADER_LEN),
    ciphertext: obj.slice(CONTENT_HEADER_LEN),
  };
}

// ---------------------------------------------------------------- quadros (QR)

export function encodeContentBlocks(contentObject) {
  const setId = contentObject.subarray(2, 7);
  const len = contentObject.length;
  const k = Math.ceil(len / BLOCK_DATA_LEN);
  const n = k + parityCount(k);
  const data = [];
  for (let i = 0; i < k; i++) {
    const block = new Uint8Array(BLOCK_DATA_LEN);
    block.set(contentObject.subarray(i * BLOCK_DATA_LEN, (i + 1) * BLOCK_DATA_LEN));
    data.push(block);
  }
  return rs.encode(data, n).map((d, x) =>
    sealFrame(concat(frameHeader(TYPE_BLOCK, setId), [x, k, n], u16(len), d)),
  );
}

export function encodeKeyPart({ setId, x, threshold, total, m, t, p, salt, masked, check }) {
  return sealFrame(
    concat(frameHeader(TYPE_KEY, setId), [x, threshold, total, KDF_ARGON2ID], u32(m), [t, p], salt, masked, [check]),
  );
}

export function parseFrame(bytes) {
  if (bytes.length < FRAME_HEADER_LEN + 4 || bytes[0] !== MAGIC[0] || bytes[1] !== MAGIC[1]) {
    throw new FormatError('Este QR não é do Relicário.');
  }
  if (bytes[2] !== FORMAT_VERSION) {
    throw new FormatError(`Versão de formato ${bytes[2]} não suportada por esta versão do Relicário.`);
  }
  const type = bytes[3];
  const expected = type === TYPE_BLOCK ? BLOCK_FRAME_LEN : type === TYPE_KEY ? KEY_FRAME_LEN : 0;
  if (!expected) throw new FormatError(`Tipo de quadro desconhecido: ${type}.`);
  if (bytes.length !== expected) throw new FormatError('Tamanho de quadro inválido.');
  if (crc32(bytes.subarray(0, expected - 4)) !== readU32(bytes, expected - 4)) {
    throw new FormatError('Quadro corrompido (CRC não confere).');
  }
  const setId = bytes.slice(4, 9);

  if (type === TYPE_BLOCK) {
    const [x, k, n] = bytes.subarray(9, 12);
    const len = readU16(bytes, 12);
    const ok = CONTENT_SIZES.includes(len) && k === Math.ceil(len / BLOCK_DATA_LEN) && n === k + parityCount(k) && x < n;
    if (!ok) throw new FormatError('Bloco com parâmetros inválidos.');
    return { type, setId, x, k, n, len, data: bytes.slice(14, 14 + BLOCK_DATA_LEN) };
  }

  const [x, threshold, total, kdf] = bytes.subarray(9, 13);
  const m = readU32(bytes, 13);
  const [t, p] = bytes.subarray(17, 19);
  const simple = x === 0 && threshold === 1 && total === 1;
  const shared = x >= 1 && x <= 3 && threshold === 2 && total === 3;
  if (!simple && !shared) throw new FormatError('Parte-chave com parâmetros inválidos.');
  if (kdf !== KDF_ARGON2ID) throw new FormatError(`Derivação de chave desconhecida: ${kdf}.`);
  if (p < 1 || p > KDF_LIMITS.pMax || t < 1 || t > KDF_LIMITS.tMax || m < 8 * p || m > KDF_LIMITS.mMax) {
    throw new FormatError('Parâmetros de derivação de chave fora dos limites.');
  }
  return {
    type,
    setId,
    x,
    threshold,
    total,
    mode: simple ? MODE_SIMPLE : MODE_2OF3,
    kdf: { m, t, p },
    salt: bytes.slice(19, 35),
    masked: bytes.slice(35, 67),
    check: bytes[67],
  };
}

// `blocks`: Map de x → bloco analisado por parseFrame. Devolve { object, verified }.
// `verified` = pelo menos k+1 blocos concordam entre si (a paridade confirma os dados).
// Se um bloco destoa dos demais (forjado ou mal lido), ele é deixado de fora quando
// os outros bastam; se não dá para saber qual é o errado, lança FormatError.
// `budget` (opcional): { left } em unidades de blocos × k (cada unidade ≈ 384
// multiplicações em GF(256)); descontado antes de cada conferência da paridade, que
// é recusada com BudgetError se não couber.
export function assembleContent(blocks, budget = null) {
  const first = blocks.values().next().value;
  if (!first) throw new FormatError('Nenhum bloco de conteúdo.');
  const { k, n, len } = first;
  for (const b of blocks.values()) {
    if (b.k !== k || b.n !== n || b.len !== len) throw new FormatError('Blocos de conteúdo inconsistentes.');
  }
  if (blocks.size < k) throw new FormatError(`Faltam blocos: ${blocks.size} de ${k}.`);
  const data = new Map([...blocks].map(([x, b]) => [x, b.data]));
  const build = (subset) => concat(...rs.decode(subset, k)).slice(0, len);
  const consistent = (m) => {
    if (budget) {
      if (budget.left < m.size * k) throw new BudgetError('Orçamento de reconstrução esgotado.');
      budget.left -= m.size * k;
    }
    return !rs.inconsistent(m, k).length;
  };
  if (consistent(data)) return { object: build(data), verified: data.size > k };
  // Há bloco errado. Com k+2 ou mais blocos dá para localizá-lo: tirando o errado,
  // os restantes (≥ k+1) concordam; tirando um certo, continuam discordando.
  if (data.size >= k + 2) {
    for (const x of data.keys()) {
      const rest = new Map(data);
      rest.delete(x);
      if (consistent(rest)) return { object: build(rest), verified: true, dropped: x };
    }
  }
  throw new FormatError('Um dos códigos lidos não combina com os demais. Leia mais códigos (de outra folha ou cópia).');
}

// ---------------------------------------------------------------- texto de reserva

export const SECTION_CONTENT = 1;
export const SECTION_KEY = 2;
export const LINE_BYTES = 20;

function lineChecksum(section, lineNo, bytes) {
  const v = crc32(concat([section], u16(lineNo), bytes)) & 0x3ff;
  return base32.ALPHABET[v >> 5] + base32.ALPHABET[v & 31];
}

export function toTextLines(bytes, section) {
  const lines = [];
  for (let off = 0, no = 1; off < bytes.length; off += LINE_BYTES, no++) {
    const chunk = bytes.subarray(off, off + LINE_BYTES);
    const groups = base32.encode(chunk).match(/.{1,4}/g).join(' ');
    lines.push(`${String(no).padStart(3, '0')}  ${groups}  ${lineChecksum(section, no, chunk)}`);
  }
  return lines;
}

// Lê texto digitado ou colado, linha a linha. Cabeçalhos e prosa são ignorados. Cada
// linha se confere sozinha (o CC também identifica a seção), então folhas podem ser
// digitadas separadamente e em qualquer ordem. Devolve { lines: [{section, no, bytes}], errors }.
export function parseTextLines(text) {
  const lines = [];
  const errors = [];
  for (const raw of text.split(/\r?\n/)) {
    const tokens = raw.trim().split(/\s+/);
    if (tokens.length < 3 || !/^\d{1,3}$/.test(tokens[0])) continue;
    const no = Number(tokens[0]);
    const label = `Linha ${String(no).padStart(3, '0')}`;
    let bytes;
    try {
      bytes = base32.decode(tokens.slice(1, -1).join(''));
    } catch {
      errors.push(`${label}: faltam ou sobram caracteres, ou há caractere inválido.`);
      continue;
    }
    const cc = tokens[tokens.length - 1].toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1');
    const section = [SECTION_CONTENT, SECTION_KEY].find((s) => lineChecksum(s, no, bytes) === cc);
    if (no < 1 || !section || bytes.length === 0 || bytes.length > LINE_BYTES) {
      errors.push(`${label}: erro de digitação (a conferência não bate).`);
      continue;
    }
    lines.push({ section, no, bytes });
  }
  return { lines, errors };
}

export function setIdLabel(setId) {
  const s = base32.encode(setId);
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
