// Gera dist/relicario.html: um único arquivo, sem nenhuma dependência externa.
// Uso: node build.mjs   (variável opcional RELICARIO_URL = endereço impresso nas folhas)
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { localModules } from './scripts/esbuild-local.mjs';

const url = process.env.RELICARIO_URL || '';
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;

const out = await build({
  entryPoints: ['src/ui/app.js'],
  bundle: true,
  format: 'iife',
  target: ['es2020', 'safari15'],
  minify: true,
  legalComments: 'inline',
  write: false,
  loader: { '.wasm': 'binary' },
  plugins: [localModules],
  define: { __RELICARIO_URL__: JSON.stringify(url) },
});
// Impede que o conteúdo do script feche a tag <script> antes da hora.
const script = out.outputFiles[0].text.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
const style = readFileSync('src/styles.css', 'utf8');

const b64 = (s) => createHash('sha256').update(s, 'utf8').digest('base64');
const csp = [
  "default-src 'none'",
  `script-src 'sha256-${b64(script)}' 'wasm-unsafe-eval'`,
  `style-src 'sha256-${b64(style)}'`,
  'img-src data: blob:',
  'media-src blob: mediastream:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

const html = readFileSync('src/index.html', 'utf8')
  .replace('{{CSP}}', () => csp)
  .replace('{{BUILD}}', () => version)
  .replace('{{STYLE}}', () => style)
  .replace('{{SCRIPT}}', () => script);

mkdirSync('dist', { recursive: true });
writeFileSync('dist/relicario.html', html);
const hash = createHash('sha256').update(html).digest('hex');
writeFileSync('dist/relicario.html.sha256', `${hash}  relicario.html\n`);
console.log(`dist/relicario.html  ${(html.length / 1024 / 1024).toFixed(2)} MB  sha256 ${hash}`);
