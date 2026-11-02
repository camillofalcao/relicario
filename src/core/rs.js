// Código de apagamento Reed-Solomon sistemático por avaliação em GF(2^8).
// Os blocos de dados são os valores em x = 0..k-1 de um polinômio de grau < k
// (um por posição de byte); a paridade é o mesmo polinômio em x = k..n-1.
// Quaisquer k blocos, com seus índices, reconstroem os dados.
import { mul, lagrangeCoefficients } from './gf256.js';

function evaluate(xs, ys, targets) {
  const len = ys[0].length;
  return targets.map((x) => {
    const coef = lagrangeCoefficients(xs, x);
    const out = new Uint8Array(len);
    for (let i = 0; i < xs.length; i++) {
      const c = coef[i];
      if (!c) continue;
      const y = ys[i];
      for (let j = 0; j < len; j++) out[j] ^= mul(c, y[j]);
    }
    return out;
  });
}

export function encode(dataBlocks, n) {
  const k = dataBlocks.length;
  if (k < 1 || n <= k || n > 255) throw new Error('RS: parâmetros inválidos');
  const xs = dataBlocks.map((_, i) => i);
  const targets = [];
  for (let x = k; x < n; x++) targets.push(x);
  return [...dataBlocks, ...evaluate(xs, dataBlocks, targets)];
}

// `blocks`: Map de índice x → bloco. Devolve os k blocos de dados.
export function decode(blocks, k) {
  const xs = [...blocks.keys()].slice(0, k);
  if (xs.length < k) throw new Error('RS: blocos insuficientes');
  const targets = [];
  for (let x = 0; x < k; x++) targets.push(x);
  const known = targets.every((x) => blocks.has(x));
  if (known) return targets.map((x) => blocks.get(x));
  return evaluate(xs, xs.map((x) => blocks.get(x)), targets);
}

// Índices dos blocos que não combinam com o polinômio definido pelos k primeiros.
// Com mais de k blocos, a paridade serve também para detectar um bloco errado.
export function inconsistent(blocks, k) {
  const xs = [...blocks.keys()];
  const basis = xs.slice(0, k);
  const extra = xs.slice(k);
  if (!extra.length) return [];
  const predicted = evaluate(basis, basis.map((x) => blocks.get(x)), extra);
  return extra.filter((x, i) => {
    const real = blocks.get(x);
    const p = predicted[i];
    for (let j = 0; j < real.length; j++) if (real[j] !== p[j]) return true;
    return false;
  });
}
