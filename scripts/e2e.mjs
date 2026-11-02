// Teste de ponta a ponta no Chrome: cria, "imprime" em PDF, rasteriza, degrada,
// lê pela interface (Fotos) e abre/testa com as senhas.
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = process.env.E2E_OUT || resolve('e2e-out');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const FILE = `file://${resolve('dist/relicario.html')}`;
const problems = [];

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });

async function newPage() {
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 1000 });
  page.on('console', (m) => { if (['error', 'warn'].includes(m.type())) problems.push(`console.${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('request', (r) => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) problems.push(`REDE: ${r.url()}`); });
  await page.goto(FILE);
  await page.waitForFunction(() => /OK|FALHOU/.test(document.getElementById('selftest').textContent), { timeout: 60000 });
  const st = await page.$eval('#selftest', (e) => e.textContent);
  if (!st.includes('OK')) throw new Error(`autoteste: ${st}`);
  await page.evaluate(() => { window.print = () => {}; });
  return page;
}

async function clickText(page, text, sel = 'button') {
  await page.waitForFunction((s, t) => [...document.querySelectorAll(s)].some((b) => b.textContent.includes(t) && !b.disabled), { timeout: 60000 }, sel, text);
  await page.evaluate((s, t) => [...document.querySelectorAll(s)].find((b) => b.textContent.includes(t) && !b.disabled).click(), sel, text);
}

async function waitText(page, text, timeout = 120000) {
  try {
    await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
  } catch (e) {
    await page.screenshot({ path: `${OUT}/falha.png`, fullPage: true });
    console.log('Esperava:', text, '\n', await page.$eval('main', (m) => m.innerText.slice(0, 1500)), problems);
    throw e;
  }
}

async function create(page, mode, text) {
  await clickText(page, 'Guardar um segredo');
  await clickText(page, mode === 1 ? 'Senha única' : '2 de 3 guardiões');
  await page.type('textarea.secret', text);
  await clickText(page, 'Continuar');
  await page.waitForSelector("fieldset.pw-card", { timeout: 10000 }).catch(async () => { await page.screenshot({ path: `${OUT}/debug.png` }); console.log(problems); });
  const n = mode === 1 ? 1 : 3;
  const phrases = [];
  for (let i = 0; i < n; i++) {
    const cards = await page.$$('fieldset.pw-card');
    const gen = await cards[i].$('button.btn.small');
    await gen.click();
    const phrase = await cards[i].$eval('.phrase', (e) => e.textContent);
    phrases.push(phrase);
    const inputs = await cards[i].$$('input.pw');
    await inputs[1].type(phrase);
    if (n > 1) await (await cards[i].$('input.name')).type(`Guardião ${i + 1}`);
  }
  await clickText(page, 'Gerar Relicário');
  await waitText(page, 'Imprimir e salvar');
  return phrases;
}

async function printPdf(page, label, buttonIndex) {
  await page.evaluate((i) => [...document.querySelectorAll('.packet-actions button')].filter((b) => b.textContent === 'Imprimir')[i].click(), buttonIndex);
  for (const format of ['A4', 'Letter']) {
    const pdf = `${OUT}/${label}-${format}.pdf`;
    await page.pdf({ path: pdf, format, margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' } });
    const pages = execFileSync('pdfinfo', [pdf]).toString().match(/Pages:\s+(\d+)/)[1];
    console.log(`${label} ${format}: ${pages} página(s)`);
  }
  const sheets = await page.$$eval('#print-root .sheet', (s) => s.map((x) => x.scrollHeight > x.clientHeight + 1));
  if (sheets.some(Boolean)) problems.push(`${label}: conteúdo transborda a folha`);
  execFileSync('pdftoppm', ['-r', '300', '-gray', '-png', `${OUT}/${label}-A4.pdf`, `${OUT}/${label}`]);
  return readdirSync(OUT).filter((f) => f.startsWith(`${label}-`) && f.endsWith('.png')).map((f) => `${OUT}/${f}`).sort();
}

function degrade(pngs, scale) {
  return pngs.map((p) => {
    const out = p.replace('.png', `-foto${scale}.jpg`);
    execFileSync('python3', ['-I', 'scripts/degrade.py', p, out, String(scale)]);
    return out;
  });
}

async function uploadPhotos(page, files) {
  const input = await page.$('input[type=file][accept="image/*"]');
  await input.uploadFile(...files);
}

// ---------------------------------------------------------------- simples + teste obrigatório
{
  const page = await newPage();
  const secret = 'Seed: abandon ability able about above absent absorb abstract absurd abuse access accident\nCofre: 1234-ação ✓';
  const [phrase] = await create(page, 1, secret);
  const pngs = await printPdf(page, 'simples', 0);
  await clickText(page, 'teste de restauração');
  await uploadPhotos(page, degrade(pngs, 0.5)); // ~150 dpi + desfoque/ruído
  await waitText(page, 'Conteúdo: completo');
  await page.type('.pw-form input.pw', `  ${phrase} `);
  await clickText(page, 'Testar');
  await waitText(page, 'Backup verificado');
  console.log('simples: teste de restauração OK (foto degradada a ~150 dpi)');
  await page.screenshot({ path: `${OUT}/simples-teste.png`, fullPage: true });
  await page.close();
}

// ---------------------------------------------------------------- 2 de 3, texto grande
{
  const page = await newPage();
  const secret = Array.from({ length: 120 }, (_, i) => `linha ${i}: ${Math.random().toString(36).slice(2)} ${Math.random().toString(36).slice(2)}`).join('\n');
  const phrases = await create(page, 2, secret);
  // Com a versão em texto ligada (B=4096: 207 linhas, 6 folhas de texto cheias), imprime a
  // parte 2 e redigita o PDF: nenhuma linha pode se perder no papel.
  await page.evaluate(() => { const cb = document.querySelector('label.check input'); if (!cb.checked) cb.click(); });
  const p2 = await printPdf(page, 'parte2-texto', 1);
  const typedText = execFileSync('pdftotext', ['-layout', `${OUT}/parte2-texto-A4.pdf`, '-']).toString();
  const { Collector } = await import('../src/core/collector.js');
  const col = new Collector();
  const fed = col.addText(typedText);
  const sum = col.summary()[0];
  if (fed.errors.length || !sum?.contentReady || !sum.parts.includes(2)) {
    problems.push(`texto impresso redigitado: erros=${JSON.stringify(fed.errors.slice(0, 3))} conteúdo=${sum?.contentReady} partes=${sum?.parts}`);
  } else console.log(`2 de 3: ${p2.length} folhas da parte 2 (com texto) redigitadas a partir do PDF: conteúdo e parte-chave completos`);
  await page.evaluate(() => document.querySelector('label.check input').click());
  const p1 = await printPdf(page, 'parte1', 0);
  const p3 = await printPdf(page, 'parte3', 2);
  await page.screenshot({ path: `${OUT}/2de3-saida.png`, fullPage: true });

  // Abertura normal com as partes 1 e 3, em outra aba (como um herdeiro).
  const open = await newPage();
  await clickText(open, 'Abrir um Relicário');
  // Da parte 1, só a primeira folha (parte-chave + parte do conteúdo). Da parte 3, as
  // folhas 1 e 3: a folha 2 do conteúdo está "perdida" nas duas partes.
  if (p3.length !== 4) problems.push(`2de3: esperava 3 folhas de QR + especificação, veio ${p3.length}`);
  await uploadPhotos(open, degrade([p1[0], p3[0], p3[2]], 0.5));
  await waitText(open, 'Conteúdo: completo');
  await waitText(open, 'Partes-chave lidas: 1, 3');
  const inputs = await open.$$('.pw-form input.pw');
  await inputs[0].type(phrases[0]);
  await inputs[1].type('senha errada qualquer coisa');
  await clickText(open, 'Abrir');
  await waitText(open, 'Senha incorreta na(s) parte(s) 3');
  await inputs[1].evaluate((e) => { e.value = ''; e.dispatchEvent(new Event('input')); });
  await inputs[1].type(phrases[2]);
  await clickText(open, 'Abrir');
  await waitText(open, 'Aberto com sucesso');
  const got = await open.$eval('textarea.secret', (e) => e.value);
  if (got !== secret) problems.push('2de3: texto aberto difere do original');
  else console.log('2 de 3: aberto com partes 1 e 3, sem a folha 2 do conteúdo, a partir de fotos degradadas; senha errada identificada');
  await open.screenshot({ path: `${OUT}/2de3-aberto.png`, fullPage: true });
  await open.close();
  await page.close();
}

await browser.close();
if (problems.length) {
  console.log('PROBLEMAS:\n' + problems.join('\n'));
  process.exit(1);
}
console.log('E2E OK');
