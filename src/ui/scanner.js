// Leitura de QR com zxing-cpp (WASM embutido; nada é baixado da rede).
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import wasmBinary from '../../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm';
import { startCamera as runCamera } from './camera.js';

let prepared = false;
function prepare() {
  if (prepared) return;
  prepareZXingModule({
    overrides: {
      wasmBinary,
      locateFile: (path) => path,
    },
    fireImmediately: false,
  });
  prepared = true;
}

const OPTIONS = { formats: ['QRCode'], tryHarder: true, tryRotate: true, tryInvert: false, maxNumberOfSymbols: 64 };

export async function scanImageData(imageData) {
  prepare();
  const results = await readBarcodes(imageData, OPTIONS);
  return results.filter((r) => r.isValid && r.text).map((r) => r.text);
}

const MAX_SIDE = 4000;

export async function scanFile(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const texts = await scanImageData(ctx.getImageData(0, 0, w, h));
  canvas.width = canvas.height = 0;
  return texts;
}

export function cameraAvailable() {
  return !!navigator.mediaDevices?.getUserMedia;
}

// Câmera com leitura de QR; o ciclo de vida (e o encerramento em falhas) está em camera.js.
export function startCamera(video, onText, signal) {
  return runCamera(video, onText, { scan: scanImageData, signal });
}
