// Gera src/core/vectors.js. Só deve ser rodado quando o formato mudar de versão;
// os vetores publicados para v1 nunca devem mudar.
import { writeFileSync } from 'node:fs';
import { toHex } from '../src/core/bytes.js';
import * as base45 from '../src/core/base45.js';
import { createRelicario } from '../src/core/crypto.js';
import { deterministicRandom } from '../src/core/selftest.js';

const defs = [
  {
    name: 'v1-simples',
    seed: 'relicario v1 vetor simples',
    mode: 1,
    kdf: { m: 256, t: 2, p: 1 },
    passwords: ['cedilha vuvuzela sucata trama prezar molinete jardim'],
    text: 'Vetor de teste do Relicário v1.\nAcentuação: ação, coração, pão. Símbolos: € ✓ 日本.\n',
  },
  {
    name: 'v1-2de3',
    seed: 'relicario v1 vetor 2 de 3',
    mode: 2,
    kdf: { m: 256, t: 2, p: 1 },
    passwords: [
      'jazida cimento feijoada humorado irreal honrado ereto',
      'acetona sozinho esfolar perna quarto trindade prancha',
      'sufixo batata acanhar sapato embargo besouro pistola',
    ],
    text: 'Segredo compartilhado por três guardiões.\n'.repeat(40),
  },
];

const out = [];
for (const d of defs) {
  const r = await createRelicario({ ...d, random: deterministicRandom(d.seed) });
  out.push({
    ...d,
    contentObject: toHex(r.contentObject),
    keyParts: r.keyParts.map(toHex),
    blockFrames: r.blockFrames.map(base45.encode),
  });
}
writeFileSync(
  new URL('../src/core/vectors.js', import.meta.url),
  `// Gerado por scripts/gen-vectors.mjs. Vetores de teste do formato v1: não editar.\nexport const VECTORS = ${JSON.stringify(out, null, 2)};\n`,
);
console.log('vetores:', out.map((v) => `${v.name} (${v.blockFrames.length} QRs)`).join(', '));
