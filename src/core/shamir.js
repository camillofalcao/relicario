// Shamir 2-de-3 em GF(2^8), byte a byte: y = segredo ⊕ a·x, com x ∈ {1, 2, 3}.
import { mul, div } from './gf256.js';

// `coeffs` deve ser aleatório uniforme, do mesmo tamanho do segredo (zero incluído).
export function split(secret, coeffs) {
  if (coeffs.length !== secret.length) throw new Error('Shamir: coeficientes com tamanho errado');
  return [1, 2, 3].map((x) => ({ x, y: secret.map((s, j) => s ^ mul(coeffs[j], x)) }));
}

export function combine(a, b) {
  if (a.x === b.x || !a.x || !b.x) throw new Error('Shamir: partes inválidas');
  if (a.y.length !== b.y.length) throw new Error('Shamir: tamanhos diferentes');
  const den = a.x ^ b.x;
  return a.y.map((ya, j) => div(mul(ya, b.x) ^ mul(b.y[j], a.x), den));
}
