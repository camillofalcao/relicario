// Base45 (RFC 9285).

export const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
const INDEX = new Map([...ALPHABET].map((c, i) => [c, i]));

export function encode(bytes) {
  let out = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    let n = bytes[i] * 256 + bytes[i + 1];
    const c = n % 45;
    n = (n - c) / 45;
    out += ALPHABET[c] + ALPHABET[n % 45] + ALPHABET[(n - (n % 45)) / 45];
  }
  if (bytes.length % 2) {
    const n = bytes[bytes.length - 1];
    out += ALPHABET[n % 45] + ALPHABET[(n - (n % 45)) / 45];
  }
  return out;
}

export function decode(str) {
  if (str.length % 3 === 1) throw new Error('Base45: tamanho inválido');
  const vals = [...str].map((c) => {
    const v = INDEX.get(c);
    if (v === undefined) throw new Error('Base45: caractere inválido');
    return v;
  });
  const out = new Uint8Array(Math.floor(str.length / 3) * 2 + (str.length % 3 === 2 ? 1 : 0));
  let o = 0;
  let i = 0;
  for (; i + 2 < vals.length; i += 3) {
    const n = vals[i] + vals[i + 1] * 45 + vals[i + 2] * 2025;
    if (n > 0xffff) throw new Error('Base45: valor fora do intervalo');
    out[o++] = n >> 8;
    out[o++] = n & 0xff;
  }
  if (i < vals.length) {
    const n = vals[i] + vals[i + 1] * 45;
    if (n > 0xff) throw new Error('Base45: valor fora do intervalo');
    out[o++] = n;
  }
  return out;
}
