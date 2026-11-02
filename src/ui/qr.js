import qrcode from 'qrcode-generator';

const QUIET = 4;
const cache = new Map();

// QR em SVG com tamanho físico exato: cada módulo mede `moduleMm` milímetros.
// Em cache: a pré-visualização e cada reimpressão reutilizam o mesmo desenho.
export function qrSvg(text, moduleMm, ecc = 'M') {
  const key = `${moduleMm}|${ecc}|${text}`;
  if (!cache.has(key)) cache.set(key, render(text, moduleMm, ecc));
  return cache.get(key);
}

function render(text, moduleMm, ecc) {
  const qr = qrcode(0, ecc);
  qr.addData(text, 'Alphanumeric');
  qr.make();
  const n = qr.getModuleCount();
  const size = n + 2 * QUIET;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue;
      let run = 1;
      while (c + run < n && qr.isDark(r, c + run)) run++;
      d += `M${c + QUIET} ${r + QUIET}h${run}v1h-${run}z`;
      c += run - 1;
    }
  }
  const mm = (size * moduleMm).toFixed(2);
  return {
    version: (n - 17) / 4,
    sizeMm: size * moduleMm,
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${mm}mm" height="${mm}mm" ` +
      `shape-rendering="crispEdges" role="img"><rect width="${size}" height="${size}" fill="#fff"/>` +
      `<path d="${d}" fill="#000"/></svg>`,
  };
}
