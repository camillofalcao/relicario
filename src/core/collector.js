// Junta o que foi lido (QRs, texto digitado, arquivos), em qualquer ordem, por conjunto.
//
// Leituras inconsistentes não travam o conjunto: blocos são agrupados pelos seus
// parâmetros (k, n, L) e partes-chave pelo modo, e vale o grupo que se completa e
// concorda com o conteúdo. Um QR forjado com o mesmo número de conjunto, portanto,
// não impede a leitura dos verdadeiros (e o AES-GCM recusa qualquer mistura errada).
//
// A paridade só mostra que os blocos concordam entre si, não que são autênticos: quem
// tem o conteúdo cifrado pode alterá-lo e refazer a paridade sem saber a senha. Por isso
// todo conteúdo completo e consistente vira candidato (até MAX_CONTENTS) e a escolha
// final é do AES-GCM, na abertura. Candidatos por índice também são limitados
// (MAX_CANDIDATES), para que entrada adulterada não multiplique o trabalho.
import * as base45 from './base45.js';
import { toHex, concat, equal } from './bytes.js';
import {
  FormatError, BudgetError, TYPE_BLOCK, TYPE_KEY, KEY_FRAME_LEN, MODE_SIMPLE, MODE_2OF3, SECTION_KEY, LINE_BYTES,
  MAX_CANDIDATES, MAX_CONTENTS, MAX_RS_WORK,
  parseFrame, parseContentObject, assembleContent, parseTextLines, setIdLabel,
} from './format.js';

const pad3 = (n) => String(n).padStart(3, '0');
const KEY_LINES = Math.ceil(KEY_FRAME_LEN / LINE_BYTES); // 4
const RESTART = 'Se os verdadeiros ainda não foram lidos, use “Recomeçar leitura” e leia só os do papel ou arquivo original.';

export class Collector {
  constructor() {
    this.sets = new Map();
    // Linhas digitadas do conteúdo, acumuladas entre envios: número → bytes.
    this.textContent = new Map();
    // Orçamento de reconstrução (ver #assemble), comum a todos os conjuntos.
    this.rsBudget = { left: MAX_RS_WORK };
  }

  get rsWork() {
    return MAX_RS_WORK - this.rsBudget.left;
  }

  #set(setId) {
    const id = toHex(setId);
    if (!this.sets.has(id)) {
      this.sets.set(id, {
        id, setId, label: setIdLabel(setId),
        // contents: candidatos confirmados (pela paridade ou digitados inteiros);
        // provisional: montagem com só k blocos, sem confirmação (ou null).
        blockGroups: new Map(), contents: [], provisional: null, suspect: false, overflow: false, keyParts: new Map(),
      });
    }
    return this.sets.get(id);
  }

  // Devolve { status: 'novo' | 'repetido' | 'invalido', kind, set, x, message }.
  addQrText(text) {
    let bytes;
    try {
      bytes = base45.decode(text);
    } catch {
      return { status: 'invalido', message: 'Este QR não é do Relicário.' };
    }
    return this.addFrame(bytes);
  }

  addFrame(bytes) {
    let f;
    try {
      f = parseFrame(bytes);
    } catch (e) {
      if (e instanceof FormatError) return { status: 'invalido', message: e.message };
      throw e;
    }
    const s = this.#set(f.setId);
    if (f.type === TYPE_BLOCK) {
      const sig = `${f.k}/${f.n}/${f.len}`;
      if (!s.blockGroups.has(sig)) s.blockGroups.set(sig, { main: new Map(), alternatives: new Map() });
      const group = s.blockGroups.get(sig);
      const cur = group.main.get(f.x);
      if (cur) {
        if (equal(cur.data, f.data)) return { status: 'repetido', kind: 'bloco', set: s, x: f.x };
        // Mesmo índice, dados diferentes: um dos dois é forjado ou foi mal lido.
        // Fica como alternativa; a paridade decide na montagem.
        const alts = group.alternatives.get(f.x) ?? [];
        if (alts.some((a) => equal(a.data, f.data))) return { status: 'repetido', kind: 'bloco', set: s, x: f.x };
        if (alts.length + 1 >= MAX_CANDIDATES) {
          s.overflow = true;
          return { status: 'invalido', message: `Já foram lidos ${MAX_CANDIDATES} códigos de conteúdo diferentes com o número ${f.x + 1}; este foi ignorado. ${RESTART}` };
        }
        alts.push(f);
        group.alternatives.set(f.x, alts);
      } else {
        group.main.set(f.x, f);
      }
      // Cada bloco novo refaz a montagem, mesmo depois de a paridade já ter confirmado
      // um conteúdo: blocos forjados e consistentes lidos antes não podem congelá-lo.
      if (group.main.size >= f.k) this.#assemble(s, group);
      return { status: 'novo', kind: 'bloco', set: s, x: f.x };
    }
    const key = `${f.mode}:${f.x}`;
    const list = s.keyParts.get(key) ?? [];
    // Repetida só se todos os campos que entram na abertura forem iguais (incluindo o
    // KDF): uma cópia com KDF alterado, lida antes, não pode tomar o lugar da original.
    const same = (p) => equal(p.salt, f.salt) && equal(p.masked, f.masked) && p.check === f.check &&
      p.kdf.m === f.kdf.m && p.kdf.t === f.kdf.t && p.kdf.p === f.kdf.p;
    if (list.some(same)) {
      return { status: 'repetido', kind: 'parte', set: s, x: f.x };
    }
    if (list.length >= MAX_CANDIDATES) {
      s.overflow = true;
      return { status: 'invalido', message: `Já foram lidas ${MAX_CANDIDATES} partes-chave diferentes com o número ${f.x}; esta foi ignorada. ${RESTART}` };
    }
    // Candidatos por índice: uma parte forjada (mesmo conjunto e índice) não impede a
    // verdadeira; na abertura, cada candidato é testado pela senha e pelo AES-GCM.
    list.push(f);
    s.keyParts.set(key, list);
    return { status: 'novo', kind: 'parte', set: s, x: f.x };
  }

  // Monta com os blocos principais e com cada "camada" de alternativas (a 1ª de cada
  // índice, depois a 2ª…): blocos forjados lidos primeiro podem concordar entre si e
  // ocupar os principais, e os verdadeiros, lidos depois, formam uma camada. Dentro de
  // cada montagem, assembleContent ainda descarta um intruso. Cada montagem confirmada
  // pela paridade vira candidata. O trabalho sai de um orçamento do coletor inteiro.
  #assemble(s, group) {
    const attempts = [group.main];
    const depth = Math.max(0, ...[...group.alternatives.values()].map((a) => a.length));
    for (let i = 0; i < depth; i++) {
      const layer = new Map(group.main);
      for (const [x, alts] of group.alternatives) if (alts[i]) layer.set(x, alts[i]);
      attempts.push(layer);
    }
    let assembled = false;
    let exhausted = false;
    let provisional = null;
    for (const blocks of attempts) {
      try {
        const { object, verified } = assembleContent(blocks, this.rsBudget);
        if (verified) this.#addObject(s, object, false);
        else provisional ??= this.#candidate(s, object, false);
        assembled = true;
      } catch (e) {
        if (e instanceof BudgetError) {
          s.overflow = exhausted = true;
          break;
        }
        if (!(e instanceof FormatError)) throw e;
      }
    }
    if (provisional) s.provisional = provisional;
    if (!exhausted || assembled) s.suspect = !assembled;
  }

  // Lança FormatError se o objeto não for um conteúdo deste conjunto.
  #candidate(s, object, fromText) {
    const co = parseContentObject(object);
    if (!equal(co.setId, s.setId)) throw new FormatError('O conteúdo montado é de outro conjunto.');
    return { object, mode: co.mode, fromText, verified: !fromText };
  }

  // Devolve 'novo', 'repetido' ou 'cheio'. Só é repetido o conteúdo idêntico.
  #addObject(s, object, fromText) {
    const c = this.#candidate(s, object, fromText);
    if (s.contents.some((o) => equal(o.object, object))) return 'repetido';
    if (s.contents.length >= MAX_CONTENTS) {
      s.overflow = true;
      return 'cheio';
    }
    s.contents.push(c);
    return 'novo';
  }

  // Texto de reserva (digitado, colado ou arquivo .txt). Pode ser chamado várias vezes,
  // uma por folha: as linhas do conteúdo se acumulam. Devolve { results, errors }.
  addText(text) {
    const { lines, errors } = parseTextLines(text);
    const results = [];

    // Parte-chave: sempre cabe numa folha (4 linhas); lida em sequências que começam em 001.
    let run = null;
    const closeRun = () => {
      if (run) errors.push(`Parte-chave incompleta: depois da linha ${pad3(run[run.length - 1].no)} falta o resto.`);
      run = null;
    };
    for (const l of lines) {
      if (l.section !== SECTION_KEY) {
        const prev = this.textContent.get(l.no);
        if (prev && !equal(prev, l.bytes)) errors.push(`Linha ${pad3(l.no)} do conteúdo foi digitada de novo com outro valor; vale a última.`);
        this.textContent.set(l.no, l.bytes);
        continue;
      }
      if (l.no === 1) {
        closeRun();
        run = [l];
      } else if (run && l.no === run[run.length - 1].no + 1 && run.length < KEY_LINES) {
        run.push(l);
      } else if (run && l.no === run[run.length - 1].no + 1) {
        errors.push(`Parte-chave com linhas demais (a ${pad3(l.no)} já passa das ${KEY_LINES} linhas de uma parte-chave); revise as linhas.`);
        run = null;
        continue;
      } else {
        errors.push(`Linha ${pad3(l.no)} da parte-chave fora de ordem (cada parte-chave começa na linha 001).`);
        continue;
      }
      if (l.bytes.length < LINE_BYTES) {
        const bytes = concat(...run.map((r) => r.bytes));
        run = null;
        // A seção de parte-chave só aceita parte-chave (um bloco de conteúdo ali não vale).
        if (bytes.length !== KEY_FRAME_LEN || bytes[3] !== TYPE_KEY) {
          errors.push('Parte-chave digitada inválida (não é uma parte-chave); revise as 4 linhas.');
          continue;
        }
        const r = this.addFrame(bytes);
        if (r.status === 'invalido') errors.push(r.message.startsWith('Já foram') ? r.message : `Parte-chave digitada inválida (${r.message.replace(/^Este QR não é do Relicário\.$/, 'não é uma parte-chave')}); revise as 4 linhas.`);
        else results.push(r);
      }
    }
    closeRun();

    const r = this.#tryTextContent();
    if (r?.status === 'invalido') errors.push(r.message);
    else if (r) results.push(r);
    return { results, errors };
  }

  // Tenta montar o conteúdo a partir das linhas digitadas até agora.
  #tryTextContent() {
    const parts = [];
    for (let no = 1; this.textContent.has(no); no++) {
      const b = this.textContent.get(no);
      parts.push(b);
      if (b.length < LINE_BYTES) {
        const obj = concat(...parts);
        let co;
        try {
          co = parseContentObject(obj);
        } catch (e) {
          // Todas as linhas conferem, mas o conjunto delas não forma um conteúdo válido:
          // quase sempre uma linha curta digitada no lugar errado (1 erro em 1024 passa).
          return { status: 'invalido', message: `As ${parts.length} linhas digitadas do conteúdo não formam um conteúdo válido (${e.message}) Revise a linha ${pad3(no)} e as anteriores.` };
        }
        const s = this.#set(co.setId);
        this.textContent.clear();
        const status = this.#addObject(s, obj, true);
        if (status === 'cheio') return { status: 'invalido', message: `Já foram lidos ${MAX_CONTENTS} conteúdos diferentes deste conjunto; o digitado foi ignorado. ${RESTART}` };
        return { status, kind: 'conteudo', set: s };
      }
    }
    return null;
  }

  // Situação das linhas de conteúdo digitadas e ainda não completas.
  textStatus() {
    if (!this.textContent.size) return null;
    const max = Math.max(...this.textContent.keys());
    const missing = [];
    for (let no = 1; no < max; no++) if (!this.textContent.has(no)) missing.push(pad3(no));
    const ended = this.textContent.get(max).length < LINE_BYTES;
    return { count: this.textContent.size, max, missing, ended };
  }

  // Conjuntos ordenados do mais completo para o menos completo.
  // `objects`: conteúdos candidatos do modo escolhido (confirmados primeiro, na ordem
  // em que foram lidos; o provisório por último); `object` é o primeiro deles.
  summary() {
    return [...this.sets.values()]
      .map((s) => {
        const parts = [...s.keyParts.values()].flat();
        const all = [...s.contents];
        if (s.provisional && !all.some((c) => equal(c.object, s.provisional.object))) all.push(s.provisional);
        // Modo mais frequente nas partes (no empate, o da primeira lida).
        let keyMode = null;
        if (parts.length) {
          const simple = parts.filter((p) => p.mode === MODE_SIMPLE).length;
          const tie = simple * 2 === parts.length;
          keyMode = simple * 2 > parts.length || (tie && parts[0].mode === MODE_SIMPLE) ? MODE_SIMPLE : MODE_2OF3;
        }
        // O modo vem do conteúdo, se já lido (preferindo um candidato que combine com as
        // partes); senão, das partes.
        const mode = keyMode && all.some((c) => c.mode === keyMode) ? keyMode : all[0]?.mode ?? keyMode;
        const contents = all.filter((c) => c.mode === mode);
        // x → lista de candidatos (normalmente 1).
        const usable = new Map();
        for (const p of parts) {
          if (p.mode !== mode) continue;
          if (!usable.has(p.x)) usable.set(p.x, []);
          usable.get(p.x).push(p);
        }
        const groups = [...s.blockGroups.values()].map((g) => g.main).sort((a, b) => b.size - a.size);
        const best = groups[0];
        const first = best?.values().next().value;
        const missing = [];
        if (first && !contents.length) for (let x = 0; x < first.n; x++) if (!best.has(x)) missing.push(x + 1);
        return {
          ...s,
          mode,
          objects: contents.map((c) => c.object),
          object: contents[0]?.object ?? null,
          verified: contents.some((c) => c.verified),
          fromText: contents.some((c) => c.fromText),
          conflictingContent: contents.length > 1,
          keyParts: usable,
          blocks: best ?? new Map(),
          need: mode === MODE_SIMPLE ? 1 : 2,
          k: first?.k ?? null,
          n: first?.n ?? null,
          contentReady: contents.length > 0,
          missing,
          parts: [...usable.keys()].sort(),
          ignoredParts: parts.filter((p) => p.mode !== mode).length,
          conflictingParts: [...usable.values()].some((l) => l.length > 1),
          score: (contents.length ? 1000 : best?.size ?? 0) + usable.size * 10,
        };
      })
      .sort((a, b) => b.score - a.score);
  }
}
