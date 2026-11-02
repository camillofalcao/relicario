import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Resolve pacotes só a partir do node_modules deste projeto, com as condições de
// navegador. (Evita que o esbuild siga um .pnp.cjs do Yarn em diretórios acima.)
const CONDITIONS = ['browser', 'import', 'default'];
function pickExport(entry) {
  if (typeof entry === 'string') return entry;
  if (!entry || typeof entry !== 'object') return null;
  for (const c of CONDITIONS) if (c in entry) return pickExport(entry[c]);
  return null;
}
export const localModules = {
  name: 'local-node-modules',
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, ({ path }) => {
      const parts = path.split('/');
      const name = path.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
      const sub = path.slice(name.length);
      const dir = resolve('node_modules', name);
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      let file = null;
      if (pkg.exports) {
        const map = typeof pkg.exports === 'string' || !Object.keys(pkg.exports)[0].startsWith('.') ? { '.': pkg.exports } : pkg.exports;
        file = pickExport(map[`.${sub}`]);
      } else {
        file = sub ? `.${sub}` : pkg.module || pkg.main || 'index.js';
      }
      if (!file) throw new Error(`não resolvido: ${path}`);
      let full = join(dir, file);
      if (!existsSync(full) && existsSync(`${full}.js`)) full += '.js';
      return { path: full };
    });
  },
};

