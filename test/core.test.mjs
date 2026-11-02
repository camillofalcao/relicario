import { test } from 'node:test';
import assert from 'node:assert/strict';
import { argon2id as nobleArgon2id } from '@noble/hashes/argon2.js';
import { argon2id as wasmArgon2id } from 'hash-wasm';
import { mul, div } from '../src/core/gf256.js';
import { crc32 } from '../src/core/crc32.js';
import * as base45 from '../src/core/base45.js';
import * as base32 from '../src/core/base32.js';
import * as shamir from '../src/core/shamir.js';
import * as rs from '../src/core/rs.js';
import { utf8, toHex } from '../src/core/bytes.js';
import * as fmt from '../src/core/format.js';
import * as cr from '../src/core/crypto.js';

const rnd = (n) => crypto.getRandomValues(new Uint8Array(n));
const fastKdf = { m: 256, t: 1, p: 1 };
const random = async (n) => rnd(n);

test('GF(256): mul/div e vetor conhecido do AES', () => {
  assert.equal(mul(0x57, 0x83), 0xc1); // FIPS-197, seção 4.2
  for (let a = 1; a < 256; a++) for (const b of [1, 2, 3, 0x53, 0xff]) assert.equal(div(mul(a, b), b), a);
  assert.equal(mul(0x53, 0xca), 1); // inverso conhecido
});

test('CRC-32 vetor padrão', () => {
  assert.equal(crc32(utf8.encode('123456789')), 0xcbf43926);
});

test('Base45 vetores da RFC 9285', () => {
  assert.equal(base45.encode(utf8.encode('AB')), 'BB8');
  assert.equal(base45.encode(utf8.encode('Hello!!')), '%69 VD92EX0');
  assert.equal(base45.encode(utf8.encode('base-45')), 'UJCLQE7W581');
  assert.equal(new TextDecoder().decode(base45.decode('QED8WEX0')), 'ietf!');
  assert.throws(() => base45.decode('GGW')); // 65536+ fora do intervalo
  for (let len = 0; len < 50; len++) {
    const b = rnd(len);
    assert.deepEqual(base45.decode(base45.encode(b)), b);
  }
});

test('Base32 Crockford ida e volta, aliases e erros', () => {
  for (let len = 0; len < 45; len++) {
    const b = rnd(len);
    assert.deepEqual(base32.decode(base32.encode(b)), b);
  }
  assert.equal(base32.encode(Uint8Array.of(0, 0)), '0000');
  assert.deepEqual(base32.decode('oo-oo'), Uint8Array.of(0, 0));
  assert.throws(() => base32.decode('000')); // tamanho impossível
  assert.throws(() => base32.decode('U'));
});

test('Shamir 2-de-3: todos os pares reconstroem', () => {
  for (let i = 0; i < 50; i++) {
    const secret = rnd(32);
    const shares = shamir.split(secret, rnd(32));
    for (const [a, b] of [[0, 1], [0, 2], [1, 2], [2, 0]]) {
      assert.deepEqual(shamir.combine(shares[a], shares[b]), secret);
    }
  }
});

test('Shamir: uma parte sozinha é uniforme (coeficiente zero incluído)', () => {
  // Para segredo fixo, y1 = s ⊕ a percorre todos os 256 valores quando a percorre 0..255.
  const seen = new Set();
  for (let a = 0; a < 256; a++) seen.add(shamir.split(Uint8Array.of(0x42), Uint8Array.of(a))[0].y[0]);
  assert.equal(seen.size, 256);
});

test('Reed-Solomon: quaisquer k de n blocos recuperam os dados', () => {
  for (const k of [1, 2, 3, 6, 11, 22]) {
    const n = k + fmt.parityCount(k);
    const data = Array.from({ length: k }, () => rnd(16));
    const all = rs.encode(data, n);
    assert.deepEqual(all.slice(0, k), data); // sistemático
    for (let trial = 0; trial < 20; trial++) {
      const idx = [...all.keys()].sort(() => Math.random() - 0.5).slice(0, k);
      assert.deepEqual(rs.decode(new Map(idx.map((x) => [x, all[x]])), k), data);
    }
  }
});

test('Argon2id: hash-wasm confere com @noble/hashes (parâmetros reais)', async () => {
  const password = utf8.encode('correct horse battery staple ção');
  const salt = rnd(16);
  for (const p of [{ m: 256, t: 2, p: 1 }, cr.DEFAULT_KDF]) {
    const a = await wasmArgon2id({ password, salt, parallelism: p.p, iterations: p.t, memorySize: p.m, hashLength: 33, outputType: 'binary' });
    const b = nobleArgon2id(password, salt, { m: p.m, t: p.t, p: p.p, dkLen: 33 });
    assert.equal(toHex(a), toHex(b));
  }
});

test('Argon2id: vetor PHC conhecido', async () => {
  const h = await wasmArgon2id({ password: 'password', salt: 'somesalt', parallelism: 1, iterations: 2, memorySize: 65536, hashLength: 32, outputType: 'encoded' });
  assert.equal(h, '$argon2id$v=19$m=65536,t=2,p=1$c29tZXNhbHQ$CTFhFdXPJO1aFaMaO6Mm5c8y7cJHAph8ArZWb2GRPPc');
});

test('Quadros: tamanhos, CRC e paridade', () => {
  const obj = fmt.buildContentHeader(fmt.MODE_SIMPLE, rnd(5), rnd(12));
  const full = new Uint8Array(19 + 2048 + 16);
  full.set(obj);
  full.set(rnd(full.length - 19), 19);
  const frames = fmt.encodeContentBlocks(full);
  assert.equal(frames.length, 6 + 3);
  for (const f of frames) assert.equal(f.length, fmt.BLOCK_FRAME_LEN);
  assert.equal(base45.encode(frames[0]).length, 603);
  assert.ok(base45.encode(frames[0]).startsWith('8')); // nunca começa com espaço
  const parsed = frames.map(fmt.parseFrame);
  const subset = new Map([1, 3, 5, 6, 7, 8].map((x) => [x, parsed[x]]));
  assert.deepEqual(fmt.assembleContent(subset), { object: full, verified: false });
  const seven = new Map([1, 3, 5, 6, 7, 8, 0].map((x) => [x, parsed[x]]));
  assert.deepEqual(fmt.assembleContent(seven), { object: full, verified: true });
  // Bloco forjado com CRC válido: com k+1 blocos é detectado; com k+2, localizado e descartado.
  const forged = { ...parsed[2], data: parsed[2].data.slice() };
  forged.data[7] ^= 0x55;
  assert.throws(() => fmt.assembleContent(new Map([[2, forged], ...[1, 3, 5, 6, 7, 8].map((x) => [x, parsed[x]])])), /não combina/);
  const r = fmt.assembleContent(new Map([[2, forged], ...[1, 3, 5, 6, 7, 8, 0].map((x) => [x, parsed[x]])]));
  assert.deepEqual(r, { object: full, verified: true, dropped: 2 });
  const bad = frames[0].slice();
  bad[100] ^= 1;
  assert.throws(() => fmt.parseFrame(bad), /CRC/);
});

test('Texto de reserva: linhas se conferem sozinhas, seção e erro detectados', () => {
  // Dados fixos: com dados aleatórios, o erro de digitação passaria despercebido 1 vez em 1024.
  const a = Uint8Array.from({ length: 291 }, (_, i) => (i * 37 + 11) & 255);
  const b = Uint8Array.from({ length: 72 }, (_, i) => (i * 101 + 3) & 255);
  const text = [
    'RELICÁRIO — qualquer cabeçalho é ignorado',
    ...fmt.toTextLines(b, fmt.SECTION_KEY),
    '',
    ...fmt.toTextLines(a, fmt.SECTION_CONTENT).map((l) => l.toLowerCase()),
  ].join('\n');
  const { lines, errors } = fmt.parseTextLines(text);
  assert.deepEqual(errors, []);
  assert.deepEqual(lines.filter((l) => l.section === fmt.SECTION_KEY).map((l) => l.no), [1, 2, 3, 4]);
  const content = lines.filter((l) => l.section === fmt.SECTION_CONTENT);
  assert.equal(content.length, 15);
  assert.deepEqual(new Uint8Array(content.flatMap((l) => [...l.bytes])), a);

  const typo = fmt.toTextLines(a, fmt.SECTION_CONTENT);
  typo[4] = typo[4].replace(/  (\S)/, (_, c) => `  ${c === 'A' ? 'B' : 'A'}`);
  const res = fmt.parseTextLines(typo.join('\n'));
  assert.equal(res.lines.length, 14);
  assert.match(res.errors[0], /Linha 005/);
});

test('Paridade: perder qualquer folha inteira não perde o conteúdo', () => {
  for (const B of fmt.BUCKETS) {
    const len = fmt.CONTENT_HEADER_LEN + B + fmt.TAG_LEN;
    const k = Math.ceil(len / fmt.BLOCK_DATA_LEN);
    const n = k + fmt.parityCount(k);
    const sheets = fmt.sheetCount(n);
    if (sheets > 1) assert.ok(n - Math.ceil(n / sheets) >= k, `B=${B}`);
    assert.ok(Math.ceil(n / sheets) <= fmt.QRS_PER_SHEET);
  }
});

test('Normalização de senha: NFC, pontas e espaços repetidos', () => {
  assert.equal(cr.normalizePassword('  a\u0301gua   viva\t\n'), '\u00e1gua viva');
  assert.equal(cr.normalizePassword('\ufeffx  y'), 'x y');
});

test('Ponta a ponta: modo simples', async () => {
  const text = 'abandon ability able about above absent absorb abstract absurd abuse access accident\nÇãõ ✓';
  const r = await cr.createRelicario({ text, mode: fmt.MODE_SIMPLE, passwords: ['senha muito longa número um'], random, kdf: fastKdf });
  assert.equal(r.contentObject.length, 19 + 256 + 16);
  const part = fmt.parseFrame(r.keyParts[0]);
  const blocks = new Map(r.blockFrames.map(fmt.parseFrame).map((b) => [b.x, b]));
  blocks.delete(0);
  const { object: obj } = fmt.assembleContent(blocks);
  // Espaços e forma Unicode diferentes na senha ainda abrem (normalização NFC + trim).
  const pw = '  senha muito longa número um '.normalize('NFD');
  assert.equal(await cr.openRelicario(obj, [{ part, password: pw.replace('ú', 'ú') }]), text);
  await assert.rejects(cr.openRelicario(obj, [{ part, password: 'errada' }]), (e) => {
    // 1/256 de chance de o checksum curto não pegar; aí o GCM pega.
    return e instanceof cr.PasswordError || e instanceof cr.DecryptError;
  });
});

test('Ponta a ponta: 2-de-3, todos os pares, senhas trocadas e conjunto errado', async () => {
  const text = 'segredo '.repeat(300);
  const passwords = ['primeira senha do guardião', 'segunda senha do guardião', 'terceira senha do guardião'];
  const r = await cr.createRelicario({ text, mode: fmt.MODE_2OF3, passwords, random, kdf: fastKdf });
  const parts = r.keyParts.map(fmt.parseFrame);
  assert.deepEqual(parts.map((p) => p.x), [1, 2, 3]);
  for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) {
    const out = await cr.openRelicario(r.contentObject, [
      { part: parts[a], password: passwords[a] },
      { part: parts[b], password: passwords[b] },
    ]);
    assert.equal(out, text);
  }
  // Senha da parte 1 usada na parte 2: o checksum curto acusa (com prob. 255/256).
  await assert.rejects(
    cr.openRelicario(r.contentObject, [{ part: parts[0], password: passwords[1] }, { part: parts[1], password: passwords[0] }]),
    (e) => e instanceof cr.PasswordError || e instanceof cr.DecryptError,
  );
  const other = await cr.createRelicario({ text, mode: fmt.MODE_2OF3, passwords, random, kdf: fastKdf });
  await assert.rejects(
    cr.openRelicario(other.contentObject, [{ part: parts[0], password: passwords[0] }, { part: parts[1], password: passwords[1] }]),
    /outro conjunto/,
  );
  await assert.rejects(
    cr.createRelicario({ text, mode: fmt.MODE_2OF3, passwords: [passwords[0], ` ${passwords[0]}`, passwords[2]], random, kdf: fastKdf }),
    /diferentes/,
  );
});

test('Tamanho em faixas e limite', async () => {
  assert.equal(cr.sizeInfo('a').bucket, 256);
  const big = Array.from(rnd(12000), (b) => String.fromCharCode(33 + (b % 90))).join('');
  assert.equal(cr.sizeInfo(big).fits, false);
  await assert.rejects(cr.createRelicario({ text: big, mode: 1, passwords: ['x'.repeat(20)], random, kdf: fastKdf }), cr.TooLargeError);
});

test('makeRandom produz bytes distintos com e sem entropia do usuário', async () => {
  const r1 = await cr.makeRandom('dados 3 5 1 6');
  const r2 = await cr.makeRandom('');
  const a = await r1(32);
  const b = await r1(32);
  const c = await r2(32);
  assert.notDeepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.equal(a.length, 32);
});
