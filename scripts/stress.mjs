// Mede a leitura de uma folha de conteúdo (9 QRs) em resoluções cada vez piores.
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto(`file://${resolve('dist/relicario.html')}`);
await page.waitForFunction(() => document.getElementById('selftest').textContent.includes('OK'), { timeout: 60000 });
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Abrir um')).click());
for (const scale of [0.5, 0.4, 0.33, 0.27]) {
  const out = resolve(`e2e-out/stress-${scale}.jpg`);
  execFileSync('python3', ['-I', 'scripts/degrade.py', resolve('e2e-out/parte3-1.png'), out, String(scale)]);
  await page.reload();
  await page.waitForFunction(() => document.getElementById('selftest').textContent.includes('OK'), { timeout: 60000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Abrir um')).click());
  await (await page.$('input[type=file][accept="image/*"]')).uploadFile(out);
  await page.waitForFunction(() => /encontrado|Nenhum código/.test(document.querySelector('.scan-log').textContent), { timeout: 120000 });
  console.log(`~${Math.round(300 * scale)} dpi:`, await page.$eval('.scan-log', (e) => e.textContent));
}
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.reload();
await page.waitForFunction(() => document.getElementById('selftest').textContent.includes('OK'), { timeout: 60000 });
await page.screenshot({ path: 'e2e-out/celular-inicio.png' });
await browser.close();
