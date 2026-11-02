// Ciclo de vida da câmera (auditoria 3, F7): nenhuma falha ou cancelamento pode deixar
// a câmera ligada. Navegador simulado: getUserMedia, vídeo e canvas falsos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startCamera } from '../src/ui/camera.js';

function fakeBrowser({ play = async () => {}, getContext = () => ({ drawImage() {}, getImageData() {} }), delay = null } = {}) {
  const tracks = [{ stopped: 0, stop() { this.stopped++; } }, { stopped: 0, stop() { this.stopped++; } }];
  const stream = { getTracks: () => tracks };
  let release;
  const gate = delay ? new Promise((r) => { release = r; }) : null;
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => { if (gate) await gate; return stream; } } },
  });
  globalThis.document = { createElement: () => ({ getContext }) };
  const video = { readyState: 0, setAttribute() {}, play };
  return {
    video,
    stream,
    release: () => release?.(),
    stoppedAll: () => tracks.every((t) => t.stopped === 1),
    restore() {
      if (saved) Object.defineProperty(globalThis, 'navigator', saved);
      else delete globalThis.navigator;
      delete globalThis.document;
    },
  };
}

const scan = async () => [];

test('câmera: play() rejeitado encerra todas as tracks', async () => {
  const b = fakeBrowser({ play: async () => { throw new Error('play falhou'); } });
  try {
    await assert.rejects(startCamera(b.video, () => {}, { scan }), /play falhou/);
    assert.ok(b.stoppedAll());
    assert.equal(b.video.srcObject, null);
  } finally {
    b.restore();
  }
});

test('câmera: falha ao criar o canvas encerra todas as tracks', async () => {
  const b = fakeBrowser({ getContext: () => null });
  try {
    await assert.rejects(startCamera(b.video, () => {}, { scan }), /Canvas/);
    assert.ok(b.stoppedAll());
    assert.equal(b.video.srcObject, null);
  } finally {
    b.restore();
  }
});

test('câmera: cancelada enquanto a permissão é pedida não fica ligada', async () => {
  const b = fakeBrowser({ delay: true });
  try {
    const ctrl = new AbortController();
    const p = startCamera(b.video, () => {}, { scan, signal: ctrl.signal });
    ctrl.abort();
    b.release();
    await assert.rejects(p, { name: 'AbortError' });
    assert.ok(b.stoppedAll());
    assert.equal(b.video.srcObject ?? null, null);
  } finally {
    b.restore();
  }
});

test('câmera: parar é idempotente, e o abort também para', async () => {
  const b = fakeBrowser();
  try {
    const stop = await startCamera(b.video, () => {}, { scan });
    assert.equal(b.video.srcObject, b.stream);
    stop();
    stop();
    assert.ok(b.stoppedAll());
    assert.equal(b.video.srcObject, null);
    const c = fakeBrowser();
    const ctrl = new AbortController();
    await startCamera(c.video, () => {}, { scan, signal: ctrl.signal });
    ctrl.abort();
    assert.ok(c.stoppedAll());
    c.restore();
  } finally {
    b.restore();
  }
});
