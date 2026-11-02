// Utilitários de bytes. Inteiros multibyte são sempre big-endian.

export const utf8 = new TextEncoder();

export function decodeUtf8(bytes) {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export function concat(...parts) {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function u16(n) {
  return Uint8Array.of((n >>> 8) & 0xff, n & 0xff);
}

export function u32(n) {
  return Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}

export function readU16(b, off) {
  return (b[off] << 8) | b[off + 1];
}

export function readU32(b, off) {
  return ((b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3]) >>> 0;
}

export function xor(a, b) {
  if (a.length !== b.length) throw new Error('xor: tamanhos diferentes');
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

// Comparação sem saída antecipada.
export function equal(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export function toHex(b) {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function fromHex(s) {
  if (s.length % 2 || /[^0-9a-f]/i.test(s)) throw new Error('hex inválido');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}

export function wipe(...arrs) {
  for (const a of arrs) if (a) a.fill(0);
}
