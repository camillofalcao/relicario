// Medições de desempenho no Chrome, sem e com CPU 6x mais lenta (aprox. celular de entrada).
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { localModules } from './esbuild-local.mjs';

mkdirSync('e2e-out', { recursive: true });
const js = (await build({ entryPoints: ['scripts/bench-entry.js'], bundle: true, format: 'iife', minify: true, write: false, loader: { '.wasm': 'binary' }, plugins: [localModules], define: { __RELICARIO_URL__: '""' } })).outputFiles[0].text;
writeFileSync('e2e-out/bench.html', `<!doctype html><meta charset=utf-8><body><canvas id=c></canvas><script>${js.replace(/<\/script/gi, '<\\/script')}</script>`);

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
for (const throttle of [1, 6]) {
  const page = await browser.newPage();
  await page.emulateCPUThrottling(throttle);
  const t0 = Date.now();
  await page.goto(`file://${resolve('v1/relicario.html')}`);
  await page.waitForFunction(() => document.getElementById('selftest').textContent.includes('OK'), { timeout: 120000 });
  const appLoad = Date.now() - t0;
  await page.goto(`file://${resolve('e2e-out/bench.html')}`);
  const r = await page.evaluate(async () => {
    const B = window.B;
    const time = async (f) => { const t = performance.now(); const v = await f(); return [performance.now() - t, v]; };
    const out = {};
    out.selftest = (await time(() => B.runSelfTest()))[0];
    const salt = crypto.getRandomValues(new Uint8Array(16));
    out.argon2_64MiB_t3 = (await time(() => B.derive('senha qualquer de teste', salt, B.DEFAULT_KDF)))[0];
    out.argon2_256MiB_t3 = (await time(() => B.derive('senha qualquer de teste', salt, { m: 262144, t: 3, p: 1 })))[0];
    out.zxcvbn_primeira = (await time(() => B.evaluatePassword('primeira avaliacao qualquer')))[0];
    out.zxcvbn_frase = (await time(() => B.evaluatePassword(B.generatePassphrase())))[0];
    out.zxcvbn_40chars = (await time(() => B.evaluatePassword('aB3$'.repeat(10))))[0];
    out.zxcvbn_200chars = (await time(() => B.evaluatePassword('palavra '.repeat(25))))[0];
    out.zxcvbn_com_outras = (await time(() => B.evaluatePassword(B.generatePassphrase(), [B.generatePassphrase(), B.generatePassphrase()])))[0];
    const random = await B.makeRandom('');
    const big = Array.from({ length: 6000 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.random() * 36 | 0]).join('');
    out.criar_2de3_8KB = (await time(() => B.createRelicario({ text: big, mode: 2, passwords: ['a'.repeat(20), 'b'.repeat(20), 'c'.repeat(20)], random })))[0];
    const [, rel] = await time(() => B.createRelicario({ text: big, mode: 1, passwords: ['a'.repeat(20)], random, kdf: { m: 256, t: 1, p: 1 } }));
    out.qrs = rel.blockFrames.length;
    out.svg_33qrs = (await time(() => rel.blockFrames.map((f) => B.qrSvg(B.base45.encode(f), 0.6))))[0];
    // Quadro de câmera 1920x1080 com 6 QRs e foto de 4000x5600 com 12 QRs.
    const draw = async (w, h, n, mod) => {
      const c = document.getElementById('c'); c.width = w; c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      const per = Math.floor(Math.sqrt(n * w / h)) || 1;
      for (let i = 0; i < n; i++) {
        const { svg } = B.qrSvg(B.base45.encode(rel.blockFrames[i % rel.blockFrames.length]), 1);
        const img = new Image(); img.src = 'data:image/svg+xml,' + encodeURIComponent(svg.replace(/width="[^"]+" height="[^"]+"/, `width="${89 * mod}" height="${89 * mod}"`));
        await img.decode();
        ctx.drawImage(img, (i % per) * (89 * mod + 20) + 10, Math.floor(i / per) * (89 * mod + 20) + 10);
      }
      return ctx.getImageData(0, 0, w, h);
    };
    const cam = await draw(1920, 1080, 6, 4);
    await B.scanImageData(cam);
    let found;
    [out.quadro_camera_1080p, found] = await time(() => B.scanImageData(cam)); out.quadro_camera_lidos = found.length;
    const vazio = new ImageData(1920, 1080);
    out.quadro_camera_sem_qr = (await time(() => B.scanImageData(vazio)))[0];
    const foto = await draw(4000, 5600, 12, 12);
    [out.foto_4000px, found] = await time(() => B.scanImageData(foto)); out.foto_lidos = found.length;
    out.heap_MB = performance.memory ? performance.memory.usedJSHeapSize / 1e6 : null;
    return out;
  });
  console.log(`\n=== CPU ${throttle}x ===\ncarregar app + autoteste: ${appLoad} ms`);
  for (const [k, v] of Object.entries(r)) console.log(`${k}: ${typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(0) + ' ms' : v}`);
  await page.close();
}
await browser.close();
