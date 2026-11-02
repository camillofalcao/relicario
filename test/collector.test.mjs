import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as base45 from '../src/core/base45.js';
import { fromHex } from '../src/core/bytes.js';
import {
  toTextLines, SECTION_CONTENT, SECTION_KEY, MODE_SIMPLE, MODE_2OF3, KDF_LIMITS, MAX_CANDIDATES, MAX_CONTENTS,
  MAX_RS_WORK, CONTENT_SIZES, FormatError, parseFrame, encodeKeyPart, encodeContentBlocks,
} from '../src/core/format.js';
import { Collector } from '../src/core/collector.js';
import { unlockParts, openRelicario, decryptWithSecrets, LimitError } from '../src/core/crypto.js';
import { crc32 } from '../src/core/crc32.js';
import { runSelfTest } from '../src/core/selftest.js';
import { VECTORS } from '../src/core/vectors.js';

test('autoteste com os vetores v1', async () => {
  assert.equal(VECTORS.length, 2);
  await runSelfTest();
});

test('coletor: QRs fora de ordem, repetidos, estranhos e texto de reserva', () => {
  const v = VECTORS[1];
  const c = new Collector();
  assert.equal(c.addQrText('HELLO WORLD').status, 'invalido');
  const order = [...v.blockFrames.keys()].reverse();
  let ready = false;
  for (const i of order) {
    const r = c.addQrText(v.blockFrames[i]);
    assert.equal(r.status, 'novo');
    ready = c.summary()[0].contentReady;
    if (ready) break;
  }
  assert.ok(ready);
  assert.equal(c.addQrText(v.blockFrames[order[0]]).status, 'repetido');
  const keyText = toTextLines(fromHex(v.keyParts[2]), SECTION_KEY).join('\n');
  const { results, errors } = c.addText(`PARTE-CHAVE 3\n${keyText}`);
  assert.deepEqual(errors, []);
  assert.equal(results[0].kind, 'parte');
  c.addQrText(base45.encode(fromHex(v.keyParts[0])));
  const [s] = c.summary();
  assert.equal(s.mode, MODE_2OF3);
  assert.deepEqual(s.parts, [1, 3]);
  assert.ok(s.contentReady);
  assert.deepEqual(s.object, fromHex(v.contentObject));
  assert.equal(s.blocks.size >= 1, true);
});

test('coletor: conteúdo por texto, digitado em vários envios e fora de ordem', () => {
  const v = VECTORS[0];
  const c = new Collector();
  const lines = toTextLines(fromHex(v.contentObject), SECTION_CONTENT);
  const half = Math.floor(lines.length / 2);
  let r = c.addText(lines.slice(half).join('\n'));
  assert.deepEqual(r.errors, []);
  assert.equal(c.summary().length, 0);
  assert.equal(c.textStatus().missing.length, half);
  assert.ok(c.textStatus().ended);
  r = c.addText(lines.slice(0, half).join('\n'));
  assert.deepEqual(r.errors, []);
  assert.equal(r.results[0].kind, 'conteudo');
  assert.ok(c.summary()[0].contentReady);
  assert.ok(c.summary()[0].fromText);
  assert.equal(c.textStatus(), null);
});

test('coletor: bloco ou parte forjados com o mesmo conjunto não travam a leitura', { timeout: 60000 }, async () => {
  const v = VECTORS[1];
  const real = fromHex(v.keyParts[0]);
  // Bloco com parâmetros que nenhum gerador v1 emite (n = 9 para k = 1): recusado já
  // no parser (CRC recalculado).
  const odd = fromHex(base45ToHex(v.blockFrames[0]));
  odd[11] = 9; // n
  const c32 = crc32(odd.subarray(0, odd.length - 4));
  odd.set([c32 >>> 24, (c32 >>> 16) & 255, (c32 >>> 8) & 255, c32 & 255], odd.length - 4);
  assert.equal(new Collector().addFrame(odd).status, 'invalido');
  // Bloco forjado: mesmo conjunto, outros parâmetros válidos (outra faixa de tamanho).
  const other = new Uint8Array(CONTENT_SIZES[1]);
  other.set([1, MODE_2OF3, ...fromHex(v.contentObject).subarray(2, 7)]);
  const fake = encodeContentBlocks(other)[0];
  const c = new Collector();
  assert.equal(c.addFrame(fake).status, 'novo');
  for (const f of v.blockFrames) c.addQrText(f);
  assert.ok(c.summary()[0].contentReady);
  assert.ok(c.summary()[0].verified);
  // Bloco forjado com os mesmos parâmetros dos verdadeiros, lido primeiro: os
  // verdadeiros (k+1 = 2 blocos) desmentem e substituem a montagem envenenada.
  const poison = fromHex(base45ToHex(v.blockFrames[2]));
  poison[40] ^= 0xff; // ciphertext
  const pc = crc32(poison.subarray(0, poison.length - 4));
  poison.set([pc >>> 24, (pc >>> 16) & 255, (pc >>> 8) & 255, pc & 255], poison.length - 4);
  // Bloco cujo conteúdo diz ser de outro conjunto (byte 20 = set_id do cabeçalho
  // interno): não vira candidato, senão travaria a abertura com "outro conjunto".
  const alien = fromHex(base45ToHex(v.blockFrames[2]));
  alien[20] ^= 0xff;
  const ac = crc32(alien.subarray(0, alien.length - 4));
  alien.set([ac >>> 24, (ac >>> 16) & 255, (ac >>> 8) & 255, ac & 255], alien.length - 4);
  const a = new Collector();
  a.addFrame(alien);
  assert.equal(a.summary()[0].contentReady, false);
  assert.ok(a.summary()[0].suspect);
  const d = new Collector();
  d.addFrame(poison);
  assert.ok(d.summary()[0].contentReady); // k = 1: montou, mas sem confirmação
  assert.notDeepEqual(d.summary()[0].object, fromHex(v.contentObject));
  d.addQrText(v.blockFrames[0]);
  assert.ok(d.summary()[0].suspect);
  d.addQrText(v.blockFrames[1]);
  assert.ok(d.summary()[0].verified);
  assert.equal(d.summary()[0].suspect, false);
  assert.deepEqual(d.summary()[0].object, fromHex(v.contentObject));
  // Parte-chave forjada com outro modo: ignorada em favor do modo do conteúdo.
  const forged = real.slice();
  forged.set([0, 1, 1], 9);
  const c2 = crc32(forged.subarray(0, 68));
  forged.set([c2 >>> 24, (c2 >>> 16) & 255, (c2 >>> 8) & 255, c2 & 255], 68);
  c.addFrame(forged);
  c.addFrame(real);
  const [s] = c.summary();
  assert.equal(s.mode, MODE_2OF3);
  assert.deepEqual(s.parts, [1]);
  assert.equal(s.ignoredParts, 1);
  // Parte-chave forjada com o mesmo modo e índice, lida ANTES da verdadeira: as duas
  // ficam como candidatas e a senha escolhe a certa.
  const fakeSame = real.slice();
  fakeSame[40] ^= 0x5a;
  const c3 = crc32(fakeSame.subarray(0, 68));
  fakeSame.set([c3 >>> 24, (c3 >>> 16) & 255, (c3 >>> 8) & 255, c3 & 255], 68);
  const g = new Collector();
  assert.equal(g.addFrame(fakeSame).status, 'novo');
  assert.equal(g.addFrame(real).status, 'novo');
  assert.equal(g.addFrame(real).status, 'repetido');
  g.addFrame(fromHex(v.keyParts[1]));
  for (const f of v.blockFrames) g.addQrText(f);
  const [t] = g.summary();
  assert.ok(t.conflictingParts);
  assert.equal(t.keyParts.get(1).length, 2);
  const secrets = await unlockParts(t.object, [{ parts: t.keyParts.get(1), password: v.passwords[0] }]);
  assert.equal(secrets.get(1).length, 2); // as duas passam no check; o AES-GCM decide
  const text = await openRelicario(t.object, [
    { parts: t.keyParts.get(1), password: v.passwords[0] },
    { parts: t.keyParts.get(2), password: v.passwords[1] },
  ]);
  assert.equal(text, v.text);
  // Bloco forjado com o mesmo índice lido antes do verdadeiro: a paridade escolhe a alternativa.
  const e = new Collector();
  e.addFrame(poison); // x = 2 forjado
  e.addQrText(v.blockFrames[2]); // x = 2 verdadeiro (alternativa)
  e.addQrText(v.blockFrames[0]);
  const [u] = e.summary();
  assert.ok(u.verified);
  assert.deepEqual(u.object, fromHex(v.contentObject));
});

// Auditoria de 26/10/2026 (F1, F2, F3): partes-chave forjadas a partir dos campos
// públicos, com CRC recalculado, lidas antes ou depois das verdadeiras. Em todos os
// casos a abertura precisa dar o texto original.
test('coletor: partes forjadas não impedem a abertura, em qualquer ordem', { timeout: 120000 }, async () => {
  const seal = (frame) => {
    const c = crc32(frame.subarray(0, frame.length - 4));
    frame.set([c >>> 24, (c >>> 16) & 255, (c >>> 8) & 255, c & 255], frame.length - 4);
    return frame;
  };
  // Máscara alterada, salt/KDF/check preservados: passa no check com certeza (F1).
  const maskForged = (hex) => {
    const f = fromHex(hex);
    f[40] ^= 0x5a;
    return seal(f);
  };
  // KDF alterado (t = 2 → 3), resto igual: não pode ser tratada como repetida (F2).
  const kdfForged = (hex) => {
    const f = fromHex(hex);
    f[17] = 3;
    return seal(f);
  };
  const opens = async (v, frames, use) => {
    const c = new Collector();
    for (const f of frames) assert.equal(c.addFrame(f).status, 'novo');
    for (const f of v.blockFrames) c.addQrText(f);
    const [s] = c.summary();
    const entries = use.map((i) => ({ parts: s.keyParts.get(v.mode === 1 ? 0 : i + 1), password: v.passwords[i] }));
    assert.equal(await openRelicario(s.object, entries), v.text);
  };
  for (const forge of [maskForged, kdfForged]) {
    const [simple, shared] = VECTORS;
    const real = fromHex(simple.keyParts[0]);
    await opens(simple, [forge(simple.keyParts[0]), real], [0]);
    await opens(simple, [real, forge(simple.keyParts[0])], [0]);
    const [p1, p2] = shared.keyParts.map(fromHex);
    await opens(shared, [forge(shared.keyParts[0]), p1, p2], [0, 1]);
    await opens(shared, [p1, forge(shared.keyParts[0]), p2], [0, 1]);
    // Forjadas nas duas partes usadas: 4 combinações, só uma abre.
    await opens(shared, [forge(shared.keyParts[0]), forge(shared.keyParts[1]), p1, p2], [0, 1]);
  }
  // F3: bloco forjado completa o conteúdo provisoriamente; a paridade o substitui sem
  // mudar parts/contentReady. O estado buscado pelo id na hora de abrir é o reparado.
  const v = VECTORS[0];
  const poison = base45.decode(v.blockFrames[2]);
  poison[40] ^= 0xff;
  const c = new Collector();
  c.addFrame(seal(poison));
  c.addFrame(fromHex(v.keyParts[0]));
  const before = c.summary()[0];
  assert.ok(before.contentReady);
  for (const f of v.blockFrames) c.addQrText(f);
  const now = c.summary().find((o) => o.id === before.id);
  assert.deepEqual(now.parts, before.parts);
  assert.notDeepEqual(before.object, now.object);
  assert.equal(await openRelicario(now.object, [{ parts: now.keyParts.get(0), password: v.passwords[0] }]), v.text);
  await assert.rejects(openRelicario(before.object, [{ parts: before.keyParts.get(0), password: v.passwords[0] }]));
});

// Auditoria 2 (F4): entrada com candidatos demais é recusada antes do trabalho caro.
test('limites: candidatos e derivações são conferidos antes de derivar', { timeout: 60000 }, async () => {
  const [simple, shared] = VECTORS;
  const real = fromHex(simple.keyParts[0]);
  const part = parseFrame(real);
  // Mesma parte com outro salt (check arbitrário: o custo seria pago antes de compará-lo).
  const variant = (pt, i, kdf = pt.kdf) => {
    const salt = pt.salt.slice();
    salt[0] ^= i & 255;
    salt[1] ^= i >> 8;
    return encodeKeyPart({ ...pt, ...kdf, salt });
  };
  // Coletor: a partir do limite, partes do mesmo número são recusadas, também por arquivo.
  const c = new Collector();
  for (let i = 0; i < MAX_CANDIDATES; i++) assert.equal(c.addFrame(i ? variant(part, i) : real).status, 'novo');
  const over = c.addFrame(variant(part, 99));
  assert.equal(over.status, 'invalido');
  assert.match(over.message, /Recomeçar leitura/);
  const lines = Array.from({ length: 300 }, (_, i) => toTextLines(variant(part, i + 1), SECTION_KEY)).flat();
  const t = new Collector();
  const { errors } = t.addText([...lines, ...toTextLines(fromHex(simple.contentObject), SECTION_CONTENT)].join('\n'));
  assert.equal(errors.length, 300 - MAX_CANDIDATES);
  assert.equal(t.summary()[0].keyParts.get(0).length, MAX_CANDIDATES);
  assert.ok(t.summary()[0].overflow);
  // unlockParts: candidatos demais ou KDF caro demais → LimitError sem nenhuma derivação.
  let calls = 0;
  const count = () => { calls++; };
  const many = Array.from({ length: MAX_CANDIDATES + 1 }, (_, i) => parseFrame(variant(part, i + 1)));
  await assert.rejects(unlockParts(fromHex(simple.contentObject), [{ parts: many, password: 'x' }], count), LimitError);
  const max = { m: KDF_LIMITS.mMax, t: KDF_LIMITS.tMax, p: 1 };
  const heavy = (hex) => {
    const pt = parseFrame(fromHex(hex));
    return [pt, ...[1, 2].map((i) => parseFrame(variant(pt, i, max)))];
  };
  await assert.rejects(unlockParts(fromHex(shared.contentObject), [
    { parts: heavy(shared.keyParts[0]), password: 'x' },
    { parts: heavy(shared.keyParts[1]), password: 'y' },
    { parts: heavy(shared.keyParts[2]), password: 'z' },
  ], count), LimitError);
  assert.equal(calls, 0);
  // Progresso por derivação: a verdadeira e uma variante barata contam 2 etapas.
  const totals = [];
  const parts = [part, parseFrame(variant(part, 7))];
  const text = await openRelicario(fromHex(simple.contentObject), [{ parts, password: simple.passwords[0] }], (i, n) => { totals.push(`${i}/${n}`); });
  assert.equal(text, simple.text);
  assert.deepEqual(totals, ['1/2', '2/2']);
  // Combinações acima do limite: recusadas antes da primeira tentativa.
  const lots = (x) => [x, Array.from({ length: 17 }, () => new Uint8Array(32))];
  await assert.rejects(decryptWithSecrets(fromHex(shared.contentObject), new Map([lots(1), lots(2)])), LimitError);
});

// Auditoria 2 (F5): a paridade não autentica. Blocos forjados e consistentes entre si,
// lidos primeiro, não podem impedir que os verdadeiros (QR ou texto) abram.
test('conteúdo forjado com paridade refeita não congela a leitura', { timeout: 60000 }, async () => {
  const v = VECTORS[0];
  const good = fromHex(v.contentObject);
  const key = fromHex(v.keyParts[0]);
  const bad = good.slice();
  bad[40] ^= 1;
  const forgedBlocks = encodeContentBlocks(bad).slice(0, 2);
  const opens = async (c) => {
    const [s] = c.summary();
    assert.equal(await openRelicario(s.objects, [{ parts: s.keyParts.get(0), password: v.passwords[0] }]), v.text);
    return s;
  };
  // Forjados primeiro, depois todos os QRs verdadeiros.
  const a = new Collector();
  for (const f of forgedBlocks) a.addFrame(f);
  a.addFrame(key);
  assert.ok(a.summary()[0].verified);
  for (const f of v.blockFrames) a.addQrText(f);
  const s = await opens(a);
  assert.ok(s.conflictingContent);
  // Verdadeiros primeiro, depois os forjados.
  const b = new Collector();
  b.addFrame(key);
  for (const f of v.blockFrames) b.addQrText(f);
  for (const f of forgedBlocks) b.addFrame(f);
  await opens(b);
  // Forjados por QR, verdadeiro só pelo texto: não é "repetido", vira candidato.
  const t = new Collector();
  for (const f of forgedBlocks) t.addFrame(f);
  t.addFrame(key);
  const r = t.addText(toTextLines(good, SECTION_CONTENT).join('\n'));
  assert.equal(r.results[0].status, 'novo');
  assert.equal(t.addText(toTextLines(good, SECTION_CONTENT).join('\n')).results[0].status, 'repetido');
  await opens(t);
  // Conteúdos diferentes demais: o excedente é recusado com mensagem clara.
  const m = new Collector();
  for (let i = 0; i <= MAX_CONTENTS; i++) {
    const o = good.slice();
    o[40] ^= i + 1;
    const { errors } = m.addText(toTextLines(o, SECTION_CONTENT).join('\n'));
    assert.equal(errors.length, i < MAX_CONTENTS ? 0 : 1);
  }
  assert.equal(m.summary()[0].objects.length, MAX_CONTENTS);
});

// Auditoria 3 (F6): reconstrução Reed-Solomon com custo limitado.
test('limites: quadro de conteúdo na seção de chave, parâmetros impossíveis e orçamento de RS', { timeout: 60000 }, () => {
  const v = VECTORS[0];
  // Quadro de conteúdo digitado como parte-chave (21 linhas da seção 2): recusado sem RS.
  const block = base45.decode(v.blockFrames[0]);
  const c = new Collector();
  const { errors } = c.addText(toTextLines(block, SECTION_KEY).join('\n'));
  assert.ok(errors.length >= 1);
  assert.equal(c.summary().length, 0);
  assert.equal(c.rsWork, 0);
  // Parte-chave de verdade continua passando pela seção de chave.
  assert.deepEqual(c.addText(toTextLines(fromHex(v.keyParts[0]), SECTION_KEY).join('\n')).errors, []);
  // Tamanho, k ou n fora do que o v1 gera: recusados no parser.
  const seal = (body) => {
    const x = crc32(body);
    return Uint8Array.from([...body, x >>> 24, (x >>> 16) & 255, (x >>> 8) & 255, x & 255]);
  };
  const frame = (x, k, n, len) => seal(Uint8Array.from([82, 76, 1, 1, 1, 2, 3, 4, 5, x, k, n, len >> 8, len & 255, ...new Uint8Array(384)]));
  for (const [k, n, len] of [[171, 173, 65535], [22, 255, 8227], [22, 33, 8000], [21, 33, 8227]]) {
    assert.throws(() => parseFrame(frame(0, k, n, len)), FormatError);
  }
  assert.equal(parseFrame(frame(0, 22, 33, 8227)).n, 33);
  // Vários conjuntos forjados completos e consistentes (o pior caso para a montagem):
  // o trabalho total fica no orçamento, e o excesso é avisado.
  const setId = fromHex(v.contentObject).subarray(2, 7);
  const forgedSet = (seed) => {
    const o = new Uint8Array(CONTENT_SIZES.at(-1));
    for (let i = 0; i < o.length; i++) o[i] = (i * 131 + seed * 977) & 255;
    o.set([1, MODE_SIMPLE, ...setId]);
    return { object: o, frames: encodeContentBlocks(o) };
  };
  const sets = [1, 2, 3, 4, 5].map(forgedSet);
  const m = new Collector();
  for (const { frames } of sets) for (const f of frames) m.addFrame(f);
  assert.ok(m.rsWork <= MAX_RS_WORK);
  assert.ok(m.summary()[0].overflow);
  // Um conjunto forjado inteiro antes do verdadeiro cabe no orçamento.
  const [fake, real] = sets;
  const one = new Collector();
  for (const f of [...fake.frames, ...real.frames]) one.addFrame(f);
  assert.ok(one.summary()[0].objects.some((o) => o.every((b, i) => b === real.object[i])));
  assert.equal(one.summary()[0].overflow, false);
});

function base45ToHex(t) {
  return [...base45.decode(t)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

test('coletor: linhas que conferem mas não formam um conteúdo válido dão erro explícito', () => {
  const v = VECTORS[0];
  const c = new Collector();
  const lines = toTextLines(fromHex(v.contentObject), SECTION_CONTENT);
  // 14 linhas certas + uma linha 015 curta que confere sozinha, mas fecha um objeto de
  // 287 bytes (tamanho impossível). Simula o erro de digitação que passa pela conferência.
  const short = toTextLines(new Uint8Array(14 * 20 + 7), SECTION_CONTENT)[14];
  const { results, errors } = c.addText([...lines.slice(0, 14), short].join('\n'));
  assert.equal(results.length, 0);
  assert.match(errors[0], /não formam um conteúdo válido/);
  // Depois de corrigir a linha 015, o conteúdo fecha.
  const fixed = c.addText(lines[14]);
  assert.match(fixed.errors[0], /digitada de novo com outro valor/);
  assert.equal(fixed.results[0].kind, 'conteudo');
  assert.ok(c.summary()[0].contentReady);
});
