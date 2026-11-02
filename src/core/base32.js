// Base32 Crockford, sem preenchimento. Na leitura, aceita minúsculas e as
// confusões previstas por Crockford (O→0, I/L→1).

export const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const INDEX = new Map([...ALPHABET].map((c, i) => [c, i]));
for (const [alias, real] of [['O', '0'], ['I', '1'], ['L', '1']]) INDEX.set(alias, INDEX.get(real));

export function encode(bytes) {
  let out = '';
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(acc >> bits) & 31];
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(acc << (5 - bits)) & 31];
  return out;
}

export function decode(str) {
  const clean = str.toUpperCase().replace(/[\s-]/g, '');
  const n = Math.floor((clean.length * 5) / 8);
  // Comprimentos que nenhum número de bytes produz indicam caractere faltando/sobrando.
  if (Math.ceil((n * 8) / 5) !== clean.length) throw new Error('Base32: tamanho inválido');
  const out = new Uint8Array(n);
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (const c of clean) {
    const v = INDEX.get(c);
    if (v === undefined) throw new Error(`Base32: caractere inválido "${c}"`);
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
    acc &= (1 << bits) - 1;
  }
  if (acc !== 0) throw new Error('Base32: bits finais não nulos');
  return out;
}
