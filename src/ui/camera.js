// Ciclo de vida da câmera, separado do leitor de QR (para poder ser testado sem WASM).
// Qualquer falha depois de obter o stream, ou um cancelamento pelo `signal`, encerra
// todas as tracks: a câmera nunca fica ligada sem a tela mostrar isso.

// (AbortSignal.throwIfAborted só existe a partir do Safari 15.4.)
function checkAborted(signal) {
  if (signal?.aborted) throw new DOMException('Leitura pela câmera cancelada.', 'AbortError');
}

// Lê continuamente da câmera até a função devolvida (ou `signal`) parar.
// `scan(imageData)` devolve os textos lidos num quadro; `onText` recebe cada um.
export async function startCamera(video, onText, { scan, signal } = {}) {
  checkAborted(signal);
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  });
  let running = true;
  const stop = () => {
    if (!running) return;
    running = false;
    signal?.removeEventListener('abort', stop);
    for (const t of stream.getTracks()) t.stop();
    if (video.srcObject === stream) video.srcObject = null;
  };
  try {
    // Parado enquanto a permissão era pedida: não liga a câmera.
    checkAborted(signal);
    signal?.addEventListener('abort', stop, { once: true });
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    video.muted = true;
    await video.play();
    checkAborted(signal);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas indisponível.');
    (async () => {
      while (running) {
        if (video.readyState >= 2 && video.videoWidth) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0);
          try {
            for (const t of await scan(ctx.getImageData(0, 0, canvas.width, canvas.height))) if (running) onText(t);
          } catch (e) {
            console.error(e);
          }
        }
        await new Promise((r) => setTimeout(r, 120));
      }
    })();
  } catch (e) {
    stop();
    throw e;
  }
  return stop;
}
