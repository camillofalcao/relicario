// Monta as folhas impressas e o arquivo .txt de cada guardião.
import * as base45 from '../core/base45.js';
import { MODE_SIMPLE, SECTION_CONTENT, SECTION_KEY, QRS_PER_SHEET, sheetCount, toTextLines, setIdLabel, parseFrame } from '../core/format.js';
import { h, append } from './dom.js';
import { qrSvg } from './qr.js';
import { instructions, SPEC_TITLE, SPEC_LINES, WARNING_ONLINE, WARNING_PASSWORD, HOSTED_URL } from './texts.js';

const CONTENT_MODULE_MM = 0.6;
const KEY_MODULE_MM = 0.8;
// 36 linhas de 10,5 pt cabem com ~12 mm de folga em A4 e Carta (ver e2e: folha cheia).
const TEXT_LINES_PER_SHEET = 36;

// Impresso por padrão até a faixa de 2 KB (objeto de 2083 bytes = 105 linhas, 3 folhas).
export function defaultIncludeText(created) {
  return created.stats.bucket <= 2048;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Um pacote por guardião (ou um só, no modo simples).
export function buildPackets(created, { names = [], includeText, includeSpec = true, date }) {
  const label = setIdLabel(created.setId);
  const blockTexts = created.blockFrames.map(base45.encode);
  const k = parseFrame(created.blockFrames[0]).k;
  return created.keyParts.map((keyFrame, i) => {
    const x = parseFrame(keyFrame).x;
    const partTitle = created.mode === MODE_SIMPLE ? 'Folha única' : `Parte ${x} de 3`;
    const name = (names[i] || '').trim();
    const meta = [partTitle, `Conjunto ${label}`, date, name && `Guardião: ${name}`].filter(Boolean).join(' · ');
    const instr = instructions({ mode: created.mode, x, label });
    const keyLines = toTextLines(keyFrame, SECTION_KEY);
    const contentLines = toTextLines(created.contentObject, SECTION_CONTENT);

    // Distribuição por igual: a paridade foi calculada para cobrir a perda da folha mais cheia.
    const perSheet = Math.ceil(blockTexts.length / sheetCount(blockTexts.length));
    const qrPages = chunk(blockTexts.map((t, j) => ({ t, j })), Math.min(perSheet, QRS_PER_SHEET));
    const textPages = includeText
      ? chunk(['# PARTE-CHAVE', ...keyLines, '', '# CONTEÚDO CIFRADO', ...contentLines], TEXT_LINES_PER_SHEET)
      : [];
    const total = qrPages.length + textPages.length + (includeSpec ? 1 : 0);
    let page = 0;
    const head = () =>
      h('header', { class: 'sh-head' },
        h('span', { class: 'sh-brand' }, 'RELICÁRIO'),
        h('span', { class: 'sh-meta' }, `${meta} · folha ${++page} de ${total}`),
      );
    const foot = () => h('footer', { class: 'sh-foot' }, `${WARNING_PASSWORD} ${WARNING_ONLINE}`);

    const sheets = qrPages.map((items, p) => {
      const sheet = h('section', { class: 'sheet' }, head());
      if (p === 0) {
        const key = qrSvg(base45.encode(keyFrame), KEY_MODULE_MM);
        append(sheet,
          h('div', { class: 'sh-top' },
            h('figure', { class: 'sh-key' }, h('div', { html: key.svg }), h('figcaption', null, `PARTE-CHAVE ${created.mode === MODE_SIMPLE ? '' : x}`)),
            h('div', { class: 'sh-instr' },
              h('p', null, instr.intro),
              h('ol', null, instr.steps.map((s) => h('li', null, s))),
              h('p', { class: 'sh-small' }, `Conteúdo: ${blockTexts.length} códigos; bastam ${k} quaisquer.`),
            ),
          ),
        );
      } else {
        append(sheet, h('p', { class: 'sh-cont' }, `Continuação do conteúdo cifrado. ${instr.intro}`));
      }
      append(sheet,
        h('div', { class: 'sh-grid' },
          items.map(({ t, j }) =>
            h('figure', { class: 'sh-qr' },
              h('div', { html: qrSvg(t, CONTENT_MODULE_MM).svg }),
              h('figcaption', null, `Conteúdo ${j + 1} de ${blockTexts.length}`),
            ),
          ),
        ),
        foot(),
      );
      return sheet;
    });

    for (const lines of textPages) {
      sheets.push(
        h('section', { class: 'sheet' },
          head(),
          h('h2', { class: 'sh-h2' }, 'Versão em texto (se nenhum código puder ser lido)'),
          h('p', { class: 'sh-small' }, 'Digite as linhas no Relicário, opção “Digitar texto”. Os 2 últimos caracteres de cada linha conferem erros de digitação. Não há letras I, L, O nem U.'),
          h('pre', { class: 'sh-text' }, lines.join('\n')),
          foot(),
        ),
      );
    }

    if (includeSpec) {
      sheets.push(
        h('section', { class: 'sheet' },
          head(),
          h('h2', { class: 'sh-h2' }, SPEC_TITLE),
          h('ol', { class: 'sh-spec' }, SPEC_LINES.map((l) => h('li', null, l))),
          foot(),
        ),
      );
    }

    const txt = [
      'RELICÁRIO — cópia eletrônica',
      meta,
      '',
      instr.intro,
      ...instr.steps.map((s, n) => `${n + 1}. ${s}`),
      'Também é possível abrir este arquivo diretamente no Relicário (opção “Arquivo .txt”).',
      '',
      WARNING_PASSWORD,
      WARNING_ONLINE,
      HOSTED_URL ? `Endereço: ${HOSTED_URL}` : '',
      '',
      `# PARTE-CHAVE${created.mode === MODE_SIMPLE ? '' : ` ${x}`}`,
      ...keyLines,
      '',
      '# CONTEÚDO CIFRADO',
      ...contentLines,
      '',
      `# ${SPEC_TITLE}`,
      ...SPEC_LINES.map((l, n) => `${n + 1}. ${l}`),
      '',
    ].join('\n');

    const suffix = created.mode === MODE_SIMPLE ? '' : `-parte${x}`;
    return { x, title: partTitle, name, sheets, txt, filename: `relicario-${label}${suffix}.txt` };
  });
}
