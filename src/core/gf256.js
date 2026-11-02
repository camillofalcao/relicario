// Aritmética em GF(2^8) com polinômio redutor 0x11B e gerador 0x03.

const EXP = new Uint8Array(510);
const LOG = new Uint8Array(256);

{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x ^= ((x << 1) ^ ((x >> 7) * 0x1b)) & 0xff; // x *= 3
  }
  for (let i = 255; i < 510; i++) EXP[i] = EXP[i - 255];
}

export function mul(a, b) {
  return a && b ? EXP[LOG[a] + LOG[b]] : 0;
}

export function div(a, b) {
  if (b === 0) throw new Error('GF(256): divisão por zero');
  return a ? EXP[LOG[a] + 255 - LOG[b]] : 0;
}

// Coeficientes de Lagrange: valor em `x` do polinômio que passa por (xs[i], ys[i])
// é a soma de coef[i] * ys[i].
export function lagrangeCoefficients(xs, x) {
  return xs.map((xi, i) => {
    let num = 1;
    let den = 1;
    for (let j = 0; j < xs.length; j++) {
      if (j === i) continue;
      num = mul(num, x ^ xs[j]);
      den = mul(den, xi ^ xs[j]);
    }
    return div(num, den);
  });
}
