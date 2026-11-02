// Criação e abertura de um Relicário (ver ESPECIFICACAO.md, seções 4 a 6).
import { argon2id } from 'hash-wasm';
import { deflateSync, inflateSync } from 'fflate';
import { utf8, decodeUtf8, concat, u32, readU32, xor, equal, wipe, toHex } from './bytes.js';
import * as shamir from './shamir.js';
import {
  FORMAT_VERSION, MODE_SIMPLE, MODE_2OF3, BUCKETS, SET_ID_LEN, NONCE_LEN, SALT_LEN, KEY_LEN,
  KDF_LIMITS, MAX_CANDIDATES, FormatError, buildContentHeader, parseContentObject, encodeContentBlocks, encodeKeyPart,
} from './format.js';

export const DEFAULT_KDF = Object.freeze({ m: 65536, t: 3, p: 1 });
export const MAX_COMPRESSED = BUCKETS[BUCKETS.length - 1] - 4;

const subtle = globalThis.crypto.subtle;

export class TooLargeError extends Error {}
export class PasswordError extends Error {
  constructor(wrongParts) {
    super('Senha incorreta.');
    this.wrongParts = wrongParts;
  }
}
export class DecryptError extends Error {}

// NFC; toda sequência de espaços em branco (o conjunto de \s do JavaScript, que inclui
// quebras de linha e U+FEFF) vira um único espaço; espaços das pontas são removidos.
// Assim, um espaço a mais digitado entre as palavras não tranca o conteúdo.
export function normalizePassword(pw) {
  return pw.normalize('NFC').replace(/\s+/g, ' ').trim();
}

export async function derive(password, salt, { m, t, p }) {
  const pwBytes = utf8.encode(normalizePassword(password));
  const out = await argon2id({
    password: pwBytes,
    salt,
    parallelism: p,
    iterations: t,
    memorySize: m,
    hashLength: KEY_LEN + 1,
    outputType: 'binary',
  });
  wipe(pwBytes);
  return { pad: out.subarray(0, KEY_LEN), check: out[KEY_LEN] };
}

export function systemRandom(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

// Mistura entropia do usuário à do sistema. A saída é sempre XOR com bytes novos
// do sistema, então nunca fica mais fraca que crypto.getRandomValues sozinho.
export async function makeRandom(userEntropy = '') {
  const seed = concat(systemRandom(32), new Uint8Array(await subtle.digest('SHA-256', utf8.encode(userEntropy))));
  const key = await subtle.importKey('raw', seed, 'HKDF', false, ['deriveBits']);
  wipe(seed);
  let counter = 0;
  return async (n) => {
    const info = utf8.encode(`relicario/rng/${counter++}`);
    const mix = new Uint8Array(
      await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info }, key, n * 8),
    );
    return xor(mix, systemRandom(n));
  };
}

export function compress(text) {
  return deflateSync(utf8.encode(text), { level: 9 });
}

export function sizeInfo(text) {
  const compressed = compress(text).length;
  const bucket = BUCKETS.find((b) => b >= compressed + 4) ?? null;
  return { compressed, bucket, fits: bucket !== null };
}

export async function createRelicario({ text, mode, passwords, random, kdf = DEFAULT_KDF, onProgress }) {
  const expected = mode === MODE_SIMPLE ? 1 : mode === MODE_2OF3 ? 3 : 0;
  if (!expected || passwords.length !== expected) throw new Error('Modo ou número de senhas inválido.');
  const normalized = passwords.map(normalizePassword);
  if (new Set(normalized).size !== normalized.length) throw new Error('As senhas precisam ser diferentes.');

  const comp = compress(text);
  const bucket = BUCKETS.find((b) => b >= comp.length + 4);
  if (!bucket) throw new TooLargeError('Texto grande demais.');
  const inner = new Uint8Array(bucket);
  inner.set(u32(comp.length));
  inner.set(comp, 4);

  const setId = await random(SET_ID_LEN);
  const nonce = await random(NONCE_LEN);
  const dek = await random(KEY_LEN);
  const header = buildContentHeader(mode, setId, nonce);
  const aes = await subtle.importKey('raw', dek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: header }, aes, inner));
  wipe(inner);
  const contentObject = concat(header, ct);

  const shares = mode === MODE_SIMPLE ? [{ x: 0, y: dek }] : shamir.split(dek, await random(KEY_LEN));
  const keyParts = [];
  for (let i = 0; i < shares.length; i++) {
    await onProgress?.(i + 1, shares.length);
    const salt = await random(SALT_LEN);
    const { pad, check } = await derive(passwords[i], salt, kdf);
    keyParts.push(
      encodeKeyPart({
        setId,
        x: shares[i].x,
        threshold: mode === MODE_SIMPLE ? 1 : 2,
        total: shares.length,
        ...kdf,
        salt,
        masked: xor(shares[i].y, pad),
        check,
      }),
    );
    wipe(pad);
  }
  wipe(dek, ...shares.map((s) => s.y));

  return {
    setId,
    mode,
    contentObject,
    blockFrames: encodeContentBlocks(contentObject),
    keyParts,
    stats: { plain: utf8.encode(text).length, compressed: comp.length, bucket },
  };
}

// Limites de trabalho numa abertura, conferidos antes de começar. Cada candidato extra
// vem de um QR (ou linha de arquivo) a mais, então na prática são poucos; os limites
// existem para que entrada adulterada não trave o aparelho.
// MAX_ATTEMPTS: tentativas do AES-GCM (conteúdos candidatos × combinações de partes).
// MAX_KDF_WORK: soma de m × t das derivações (4 derivações com os parâmetros máximos
// aceitos; as partes criadas por esta versão custam ~1/21 disso cada).
export const MAX_ATTEMPTS = 256;
export const MAX_KDF_WORK = 4 * KDF_LIMITS.mMax * KDF_LIMITS.tMax;

export class LimitError extends Error {}

const asList = (objects) => (Array.isArray(objects) ? objects : [objects]);
const kdfKey = (p) => `${toHex(p.salt)}:${p.kdf.m}:${p.kdf.t}:${p.kdf.p}`;

// Verifica partes-chave contra o conteúdo e deriva o segredo de cada uma.
// `contentObjects`: um conteúdo ou lista de candidatos (mesmo conjunto e modo).
// `entries`: lista de { part (de parseFrame) ou parts (candidatos para o mesmo x), password }.
// O check (1 byte) depende só da senha, do salt e do KDF, não da máscara: uma parte
// forjada com salt e KDF copiados passa nele. Por isso ele só filtra; todos os
// candidatos que passam são devolvidos e o AES-GCM decide (decryptWithSecrets).
// `onProgress(i, total)` é chamado antes de cada derivação (cada uma leva de 0,2 a
// alguns segundos); se devolver uma promessa, ela é aguardada (para a tela atualizar).
// Devolve Map x → lista de segredos candidatos (não vazia).
export async function unlockParts(contentObjects, entries, onProgress) {
  const co = parseContentObject(asList(contentObjects)[0]);
  // Planeja todas as derivações antes da primeira, para recusar entrada cara demais
  // sem pagar por ela. Candidatos com o mesmo salt e KDF são derivados uma vez só.
  let work = 0;
  const plan = entries.map(({ part, parts = [part], password }) => {
    if (parts.length > MAX_CANDIDATES) {
      throw new LimitError(`Foram lidas partes-chave diferentes demais com o número ${parts[0].x}. Recomece a leitura e leia só as verdadeiras.`);
    }
    const derivations = new Map();
    for (const p of parts) {
      if (!equal(p.setId, co.setId)) throw new FormatError('A parte-chave é de outro conjunto.');
      if (p.mode !== co.mode) throw new FormatError('A parte-chave não corresponde ao modo do conteúdo.');
      if (!derivations.has(kdfKey(p))) {
        derivations.set(kdfKey(p), p);
        work += p.kdf.m * p.kdf.t;
      }
    }
    return { parts, password, derivations };
  });
  if (work > MAX_KDF_WORK) {
    throw new LimitError('As partes-chave lidas pedem trabalho demais para conferir (parâmetros de derivação altos ou várias versões da mesma parte). Recomece a leitura e leia só as verdadeiras.');
  }
  const total = plan.reduce((n, e) => n + e.derivations.size, 0);
  const secrets = new Map();
  const wrong = [];
  let done = 0;
  try {
    for (const { parts, password, derivations } of plan) {
      const pads = new Map();
      try {
        for (const [key, p] of derivations) {
          await onProgress?.(++done, total);
          pads.set(key, await derive(password, p.salt, p.kdf));
        }
        const found = parts.filter((p) => pads.get(kdfKey(p)).check === p.check).map((p) => xor(p.masked, pads.get(kdfKey(p)).pad));
        if (found.length) secrets.set(parts[0].x, found);
        else wrong.push(parts[0].x);
      } finally {
        wipe(...[...pads.values()].map((d) => d.pad));
      }
    }
    if (wrong.length) throw new PasswordError(wrong);
  } catch (e) {
    wipe(...[...secrets.values()].flat());
    throw e;
  }
  return secrets;
}

// Chaves candidatas, uma de cada vez (sem montar a lista toda).
function* candidateKeys(mode, secrets) {
  if (mode === MODE_SIMPLE) {
    for (const y of secrets.get(0)) yield y.slice();
    return;
  }
  const [[xa, as], [xb, bs]] = [...secrets].filter(([, ys]) => ys.length);
  for (const ya of as) for (const yb of bs) yield shamir.combine({ x: xa, y: ya }, { x: xb, y: yb });
}

// `contentObjects`: um conteúdo ou lista de candidatos. `secrets`: Map x → lista de
// segredos candidatos (como devolve unlockParts); no 2-de-3, usa os dois primeiros x.
// Testa cada conteúdo com cada combinação até uma passar na autenticação.
export async function decryptWithSecrets(contentObjects, secrets) {
  const cos = asList(contentObjects).map(parseContentObject);
  const mode = cos[0].mode;
  if (cos.some((co) => co.mode !== mode || !equal(co.setId, cos[0].setId))) throw new FormatError('Conteúdos candidatos de conjuntos ou modos diferentes.');
  let combos;
  if (mode === MODE_SIMPLE) {
    if (!secrets.get(0)?.length) throw new Error('Falta a parte-chave.');
    combos = secrets.get(0).length;
  } else {
    const usable = [...secrets.values()].filter((ys) => ys.length);
    if (usable.length < 2) throw new Error('São necessárias 2 partes-chave.');
    combos = usable[0].length * usable[1].length;
  }
  if (cos.length * combos > MAX_ATTEMPTS) {
    throw new LimitError('Há combinações demais de códigos lidos com o mesmo número para testar. Recomece a leitura e leia só os verdadeiros.');
  }
  let inner = null;
  for (const co of cos) {
    for (const dek of candidateKeys(mode, secrets)) {
      const aes = await subtle.importKey('raw', dek, 'AES-GCM', false, ['decrypt']);
      wipe(dek);
      try {
        inner = new Uint8Array(
          await subtle.decrypt({ name: 'AES-GCM', iv: co.nonce, additionalData: co.header }, aes, co.ciphertext),
        );
        break;
      } catch {
        // Combinação errada (candidato forjado ou senha que passou no check por acaso).
      }
    }
    if (inner) break;
  }
  if (!inner) throw new DecryptError('As senhas não abrem este conteúdo, ou o conteúdo foi alterado.');
  const len = readU32(inner, 0);
  if (len > inner.length - 4) throw new FormatError('Conteúdo interno inválido.');
  const text = decodeUtf8(inflateSync(inner.subarray(4, 4 + len)));
  wipe(inner);
  return text;
}

export async function openRelicario(contentObjects, entries, onProgress) {
  const secrets = await unlockParts(contentObjects, entries, onProgress);
  try {
    return await decryptWithSecrets(contentObjects, secrets);
  } finally {
    wipe(...[...secrets.values()].flat());
  }
}

export { FORMAT_VERSION };
