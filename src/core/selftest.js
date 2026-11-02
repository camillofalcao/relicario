// Autoteste executado ao carregar: se algo no navegador estiver errado, o Relicário
// se recusa a operar em vez de produzir um papel que não abre.
import { utf8, concat, u32, toHex, fromHex } from './bytes.js';
import * as base45 from './base45.js';
import { parseFrame, encodeContentBlocks } from './format.js';
import { createRelicario, openRelicario } from './crypto.js';
import { VECTORS } from './vectors.js';

// Gerador determinístico, apenas para vetores de teste.
export function deterministicRandom(seed) {
  let counter = 0;
  return async (n) => {
    const out = [];
    let len = 0;
    while (len < n) {
      const block = new Uint8Array(await crypto.subtle.digest('SHA-256', concat(utf8.encode(seed), u32(counter++))));
      out.push(block);
      len += block.length;
    }
    return concat(...out).slice(0, n);
  };
}

export async function runSelfTest() {
  for (const v of VECTORS) {
    const created = await createRelicario({
      text: v.text,
      mode: v.mode,
      passwords: v.passwords,
      random: deterministicRandom(v.seed),
      kdf: v.kdf,
    });
    if (toHex(created.contentObject) !== v.contentObject) throw new Error(`${v.name}: cifragem diverge`);
    created.keyParts.forEach((p, i) => {
      if (toHex(p) !== v.keyParts[i]) throw new Error(`${v.name}: parte-chave ${i} diverge`);
    });
    const obj = fromHex(v.contentObject);
    const frames = encodeContentBlocks(obj).map(base45.encode);
    if (frames.join('|') !== v.blockFrames.join('|')) throw new Error(`${v.name}: blocos QR divergem`);
    const parts = v.keyParts.map((h) => parseFrame(fromHex(h)));
    const use = parts.length === 1 ? [0] : [0, 2];
    const text = await openRelicario(obj, use.map((i) => ({ part: parts[i], password: v.passwords[i] })));
    if (text !== v.text) throw new Error(`${v.name}: decifragem diverge`);
  }
}
