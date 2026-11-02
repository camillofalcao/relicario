// Assistente de criação: modo → texto → senhas → gerar/imprimir → teste de restauração.
import { MODE_SIMPLE, MODE_2OF3, CONTENT_HEADER_LEN, TAG_LEN, BLOCK_DATA_LEN, setIdLabel, parseFrame, parityCount, sheetCount } from '../core/format.js';
import { toHex } from '../core/bytes.js';
import { createRelicario, makeRandom, sizeInfo, MAX_COMPRESSED, normalizePassword } from '../core/crypto.js';
import { evaluatePassword, generatePassphrase, MIN_LENGTH, PASSPHRASE_WORDS } from '../core/password.js';
import { h, clear, append, SECRET_INPUT, debounce, nextFrame, download, formatDate, passwordField, resetApp } from './dom.js';
import { buildPackets, defaultIncludeText } from './sheets.js';
import { restoreView, sha256Hex } from './restore.js';

export function createView({ onExit }) {
  const state = { mode: null, text: '', passwords: [], confirms: [], names: [], entropy: '', created: null, tested: false };
  const root = h('div', { class: 'create' });
  const steps = ['Modo', 'Texto', 'Senhas', 'Imprimir', 'Teste'];

  function frame(stepIndex, title, ...body) {
    append(clear(root), [
      h('ol', { class: 'steps' }, steps.map((s, i) => h('li', { class: i === stepIndex ? 'cur' : i < stepIndex ? 'done' : '' }, s))),
      h('h2', null, title),
      body,
    ]);
    window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------ 1. modo
  function stepMode() {
    const card = (mode, title, text) =>
      h('button', { class: 'choice', onclick: () => { state.mode = mode; stepText(); } }, h('strong', null, title), h('span', null, text));
    frame(0, 'Como o segredo será guardado?',
      h('div', { class: 'choices' },
        card(MODE_SIMPLE, 'Senha única', 'Uma folha e uma senha. Quem tiver as duas lê o conteúdo.'),
        card(MODE_2OF3, '2 de 3 guardiões', 'Três folhas, cada uma com a senha de um guardião diferente. Quaisquer 2 folhas + as 2 senhas abrem; uma sozinha não revela nada. Protege contra roubo, perda e coerção de uma pessoa.'),
      ),
      h('button', { class: 'btn-link back', onclick: onExit }, '← Voltar'),
    );
  }

  // ------------------------------------------------------------ 2. texto
  function stepText() {
    const area = h('textarea', { class: 'secret', rows: 12, maxlength: 100000, ...SECRET_INPUT, value: state.text, placeholder: 'Digite ou cole o texto a proteger.' });
    const meter = h('div', { class: 'meter' }, h('div', { class: 'meter-fill' }));
    const info = h('p', { class: 'hint' });
    const next = h('button', { class: 'btn primary', onclick: () => { state.text = area.value; stepPasswords(); } }, 'Continuar');
    const update = () => {
      const si = sizeInfo(area.value);
      const pct = Math.min(100, (si.compressed / MAX_COMPRESSED) * 100);
      meter.firstChild.style.width = `${pct}%`;
      meter.classList.toggle('over', !si.fits);
      const qrs = si.fits ? qrCount(si.bucket) : 0;
      info.textContent = !area.value
        ? 'O texto é comprimido antes de ser cifrado. Limite: cerca de 8 KB comprimidos.'
        : si.fits
          ? `Ocupação: ${Math.round(pct)}% · ${qrs} códigos de conteúdo (${sheetCount(qrs)} folha(s) por guardião).`
          : 'Texto grande demais. Divida em mais de um Relicário.';
      next.disabled = !area.value.trim() || !si.fits;
    };
    area.addEventListener('input', debounce(update, 150));
    frame(1, 'O que você quer guardar?',
      area, meter, info,
      h('p', { class: 'hint' }, 'Dica: inclua no texto uma explicação para quem for ler no futuro (o que é, para que serve).'),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => { state.text = area.value; stepMode(); } }, '← Voltar'), next),
    );
    update();
  }

  // ------------------------------------------------------------ 3. senhas
  function stepPasswords() {
    const count = state.mode === MODE_SIMPLE ? 1 : 3;
    const cards = [];
    const next = h('button', { class: 'btn primary', onclick: () => { if (validateAll()) stepGenerate(); } }, 'Gerar Relicário');
    const others = (i) => state.passwords.filter((_, j) => j !== i);

    // A avaliação de força custa de 10 ms a 1,5 s (celular lento). Por isso o resultado
    // fica em cache e, enquanto se digita, só o cartão em uso é reavaliado; os demais
    // (que dependem das outras senhas) são reavaliados ao sair do campo e antes de gerar.
    const cache = new Map();
    const evaluate = (i) => {
      const pw = state.passwords[i] || '';
      if (!pw) return null;
      const key = [pw, ...others(i)].join('\u0000');
      if (!cache.has(key)) {
        if (cache.size > 50) cache.clear();
        cache.set(key, evaluatePassword(pw, others(i)));
      }
      return cache.get(key);
    };
    const validateCard = (i) => {
      const pw = state.passwords[i] || '';
      const ev = evaluate(i);
      const confirmOk = !!pw && normalizePassword(state.confirms[i] || '') === normalizePassword(pw);
      cards[i].render(ev, confirmOk);
      return !!ev?.ok && confirmOk;
    };
    const validateAll = () => {
      const ok = cards.map((_, i) => validateCard(i)).every(Boolean);
      next.disabled = !ok;
      return ok;
    };
    const validateLater = debounce(validateAll, 300);
    const validateOneLater = debounce((i) => validateCard(i), 300);
    const typing = (i) => {
      next.disabled = true;
      if (cards.length > 1) validateOneLater(i);
      else validateLater();
    };

    for (let i = 0; i < count; i++) {
      const pw = passwordField({
        label: 'Senha',
        value: state.passwords[i] || '',
        onInput: (v) => { state.passwords[i] = v; generated.classList.add('hidden'); typing(i); },
      });
      const confirm = passwordField({
        label: 'Confirmar senha (digite de novo)',
        value: state.confirms[i] || '',
        onInput: (v) => { state.confirms[i] = v; validateLater(); },
      });
      const name = h('input', { type: 'text', class: 'name', autocomplete: 'off', value: state.names[i] || '', placeholder: 'opcional' });
      const strength = h('div', { class: 'strength' });
      const generated = h('div', { class: 'generated hidden' });
      pw.input.addEventListener('change', validateLater);
      name.addEventListener('input', () => { state.names[i] = name.value; });
      const gen = () => {
        const phrase = generatePassphrase(others(i));
        pw.setValue(phrase);
        state.passwords[i] = phrase;
        confirm.setValue('');
        state.confirms[i] = '';
        append(clear(generated),
          h('p', null, 'Anote esta frase com cuidado (papel separado da folha impressa) e digite-a de novo no campo “Confirmar”:'),
          h('p', { class: 'phrase' }, phrase),
        );
        generated.classList.remove('hidden');
        validateLater();
      };
      const card = h('fieldset', { class: 'pw-card' },
        h('legend', null, count === 1 ? 'Senha' : `Guardião ${i + 1}`),
        count > 1 ? h('label', { class: 'field' }, h('span', null, 'Nome do guardião (opcional; vai impresso na folha dele, e quem achar a folha saberá quem procurar)'), name) : null,
        pw.el,
        h('button', { class: 'btn small', type: 'button', onclick: gen }, `Gerar frase de ${PASSPHRASE_WORDS} palavras (recomendado)`),
        generated,
        confirm.el,
        strength,
      );
      card.render = (ev, confirmOk) => {
        clear(strength);
        if (!ev) return;
        const level = Math.max(0, Math.min(1, ev.guessesLog10 / 30));
        const bar = h('div', { class: `meter ${ev.ok ? 'good' : 'bad'}` }, h('div', { class: 'meter-fill' }));
        bar.firstChild.style.width = `${Math.round(level * 100)}%`;
        append(strength,
          bar,
          ev.ok ? h('p', { class: 'ok' }, 'Senha forte o suficiente.') : null,
          ...ev.problems.map((p) => h('p', { class: 'warn' }, p)),
          !ev.ok && ev.warning ? h('p', { class: 'hint' }, ev.warning) : null,
          ev.nonAscii ? h('p', { class: 'hint' }, 'Contém acentos ou símbolos especiais: confira se é fácil digitá-los em qualquer teclado.') : null,
          ev.trimmed ? h('p', { class: 'hint' }, 'Espaços nas pontas e espaços repetidos são ignorados.') : null,
          state.confirms[i] && !confirmOk ? h('p', { class: 'warn' }, 'A confirmação não confere.') : null,
        );
      };
      cards.push(card);
    }

    const entropy = h('input', { type: 'text', class: 'name', ...SECRET_INPUT, value: state.entropy, placeholder: 'ex.: resultados de dados 3 6 1 4 2 5 …' });
    entropy.addEventListener('input', () => { state.entropy = entropy.value; });

    frame(2, count === 1 ? 'Escolha a senha' : 'Senhas dos 3 guardiões',
      h('p', { class: 'hint' },
        `Mínimo de ${MIN_LENGTH} caracteres e força alta. Senhas inventadas costumam ser mais fracas do que parecem; a frase gerada é a opção mais segura. `,
        count > 1 ? 'Cada guardião deve ter uma senha diferente e conhecer só a sua.' : 'Guarde a senha longe da folha impressa.'),
      cards,
      h('details', { class: 'extra' },
        h('summary', null, 'Opcional: acrescentar aleatoriedade sua'),
        h('p', { class: 'hint' }, 'O que você digitar aqui é misturado ao gerador do aparelho. Nunca enfraquece o resultado; protege caso o gerador do aparelho seja falho.'),
        entropy,
      ),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: stepText }, '← Voltar'), next),
    );
    next.disabled = true;
    validateAll();
  }

  // ------------------------------------------------------------ 4. gerar e imprimir
  async function stepGenerate() {
    const prog = h('p', { class: 'scan-log' }, 'Gerando…');
    frame(3, 'Gerando o Relicário', prog);
    await nextFrame();
    try {
      const random = await makeRandom(state.entropy);
      state.created = await createRelicario({
        text: state.text,
        mode: state.mode,
        passwords: state.passwords,
        random,
        onProgress: (d, t) => { prog.textContent = `Protegendo senha ${d} de ${t}…`; return nextFrame(); },
      });
      state.textHash = await sha256Hex(state.text);
      state.text = '';
      state.date = formatDate();
      state.includeText = defaultIncludeText(state.created);
      state.passwords = [];
      state.confirms = [];
      state.entropy = '';
      stepOutput();
    } catch (e) {
      console.error(e);
      prog.textContent = `Erro: ${e.message}`;
      prog.className = 'scan-log error';
    }
  }

  function stepOutput() {
    const c = state.created;
    const label = setIdLabel(c.setId);
    let packets = [];
    const preview = h('div', { class: 'preview' });
    const textOpt = h('input', { type: 'checkbox', checked: state.includeText, onchange: () => { state.includeText = textOpt.checked; rebuild(); } });
    const rebuild = () => {
      packets = buildPackets(c, { names: state.names, includeText: state.includeText, date: state.date });
      append(clear(preview), packets.map((p) => h('div', { class: 'packet' }, h('h3', null, p.title, p.name ? ` · ${p.name}` : ''), p.sheets)));
      append(clear(actions), packets.map((p, i) =>
        h('div', { class: 'packet-actions' },
          h('strong', null, p.title, p.name ? ` · ${p.name}` : ''),
          h('button', { class: 'btn', onclick: () => print([i]) }, 'Imprimir'),
          h('button', { class: 'btn', onclick: () => download(p.filename, p.txt) }, 'Baixar .txt'),
        ),
      ));
    };
    const print = (indices) => {
      const target = document.getElementById('print-root');
      append(clear(target), indices.flatMap((i) => packets[i].sheets.map((s) => s.cloneNode(true))));
      window.print();
    };
    const actions = h('div', { class: 'actions' });
    const k = parseFrame(c.blockFrames[0]).k;
    frame(3, 'Imprimir e salvar',
      h('div', { class: 'card' },
        h('p', null, h('strong', null, `Conjunto ${label}`), ` · ${c.mode === MODE_SIMPLE ? 'senha única' : '2 de 3 guardiões'} · ${c.blockFrames.length} códigos de conteúdo (bastam ${k})`),
        h('ul', { class: 'hint' },
          h('li', null, 'Prefira impressora a laser e papel de boa qualidade; guarde em plástico, longe de umidade e calor.'),
          c.mode === MODE_SIMPLE
            ? h('li', null, 'Imprima 2 cópias e guarde em lugares diferentes: se a única folha se perder, o conteúdo se perde.')
            : h('li', null, 'Entregue a cada guardião só a sua folha (e o seu .txt). Guarde as folhas em lugares diferentes.'),
          h('li', null, 'O arquivo .txt vale tanto quanto a folha: só a senha o protege. Não deixe vários .txt de partes diferentes no mesmo lugar (mesma nuvem, mesmo e-mail).'),
          h('li', null, 'Junto com cada folha, deixe uma cópia do arquivo relicario.html (pendrive).'),
          h('li', null, 'A impressora guarda uma cópia do trabalho; as folhas não contêm senhas.'),
        ),
        h('label', { class: 'check' }, textOpt, ' Incluir a versão em texto (para digitar se nenhum código puder ser lido)'),
        c.mode === MODE_SIMPLE ? null : h('button', { class: 'btn', onclick: () => print(packets.map((_, i) => i)) }, 'Imprimir as 3 partes'),
      ),
      actions,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: stepTest }, 'Continuar para o teste de restauração →')),
      h('h3', null, 'Pré-visualização'),
      preview,
    );
    rebuild();
  }

  // ------------------------------------------------------------ 5. teste
  function stepTest() {
    const banner = h('div', { class: 'banner warn' }, 'Backup ainda NÃO verificado. Leia a folha impressa (não a tela) e digite as senhas.');
    const view = restoreView({
      test: {
        setIdHex: toHex(state.created.setId),
        textHash: state.textHash,
        onSuccess: () => {
          state.tested = true;
          banner.className = 'banner ok';
          append(clear(banner),
            h('strong', null, 'Backup verificado.'),
            ' As folhas impressas e as senhas abrem o texto original. ',
            h('button', { class: 'btn', onclick: resetApp }, 'Concluir e limpar tudo'),
          );
        },
      },
    });
    frame(4, 'Teste de restauração',
      banner,
      h('p', { class: 'hint' }, state.created.mode === MODE_SIMPLE
        ? 'Leia com a câmera ou foto os códigos da folha impressa e digite a senha.'
        : 'Leia o conteúdo e as 3 partes-chave impressas e digite as 3 senhas. O teste confere que cada par de partes abre o texto.'),
      view,
      h('button', { class: 'btn-link back', onclick: () => { view.cleanup(); stepOutput(); } }, '← Voltar para imprimir'),
    );
  }

  stepMode();
  return root;
}

function qrCount(bucket) {
  const k = Math.ceil((CONTENT_HEADER_LEN + bucket + TAG_LEN) / BLOCK_DATA_LEN);
  return k + parityCount(k);
}
