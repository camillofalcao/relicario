// Tela de abertura. Em modo de teste, confere o resultado com o texto original e
// exige todas as partes (e todos os pares, no 2-de-3).
import { Collector } from '../core/collector.js';
import { MODE_SIMPLE } from '../core/format.js';
import { toHex, utf8, wipe } from '../core/bytes.js';
import { unlockParts, decryptWithSecrets, openRelicario, PasswordError, DecryptError, LimitError } from '../core/crypto.js';
import { h, append, clear, SECRET_INPUT, nextFrame, passwordField, resetApp } from './dom.js';
import { cameraAvailable, startCamera, scanFile } from './scanner.js';

export async function sha256Hex(text) {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(text))));
}

// `test`: { setIdHex, textHash, onSuccess } ou nulo.
export function restoreView({ test = null, onExit }) {
  let collector = new Collector();
  const passwords = new Map();
  let stopCamera = null;
  let starting = null; // AbortController da abertura em andamento
  let busy = false;

  const log = h('p', { class: 'scan-log', 'aria-live': 'polite' }, test ? 'Leia a folha impressa.' : 'Escolha como ler o Relicário.');
  const video = h('video', { class: 'camera', playsinline: true, muted: true });
  const cameraBox = h('div', { class: 'camera-box hidden' }, video, h('button', { class: 'btn', onclick: () => stopCam() }, 'Parar câmera'));
  const status = h('div', { class: 'status' });
  const pwBox = h('div', { class: 'pw-box' });
  const result = h('div', { class: 'result' });
  const typed = h('textarea', { class: 'typed', rows: 8, maxlength: 200000, placeholder: '001  XXXX XXXX …  CC', ...SECRET_INPUT });
  const typeBox = h('div', { class: 'type-box hidden' },
    h('p', { class: 'hint' }, 'Digite ou cole as linhas da “Versão em texto”, com o número no início e os 2 caracteres de conferência no fim. Pode enviar uma folha (ou parte dela) de cada vez, em qualquer ordem: o que já foi lido fica guardado.'),
    typed,
    h('button', { class: 'btn', onclick: () => { if (feedText(typed.value)) typed.value = ''; } }, 'Ler texto'),
  );

  const photoInput = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'hidden', onchange: () => readPhotos(photoInput) });
  const MAX_TXT_BYTES = 2 * 1024 * 1024;
  const txtInput = h('input', { type: 'file', accept: '.txt,text/plain', multiple: true, class: 'hidden', onchange: () => readTxt(txtInput) });

  function say(msg, kind = '') {
    log.textContent = msg;
    log.className = `scan-log ${kind}`;
  }

  function describe(r) {
    if (r.status === 'invalido') return r.message;
    const what = r.kind === 'parte' ? `Parte-chave ${r.x || ''}`.trim() : r.kind === 'bloco' ? `Código de conteúdo ${r.x + 1}` : 'Conteúdo (texto)';
    const o = r.kind === 'parte' ? 'a' : 'o';
    return `${what} ${r.status === 'novo' ? `lid${o}` : `já tinha sido lid${o}`}.`;
  }

  function onScan(text) {
    const r = collector.addQrText(text);
    if (r.status === 'novo') navigator.vibrate?.(40);
    if (r.status !== 'repetido' || log.textContent.startsWith('Leia')) say(describe(r), r.status === 'invalido' ? 'warn' : 'ok');
    render();
  }

  async function startCam() {
    if (stopCamera || starting) return;
    // “Parar câmera” ou sair da tela enquanto a permissão é pedida cancela a abertura.
    const ctrl = new AbortController();
    starting = ctrl;
    try {
      cameraBox.classList.remove('hidden');
      stopCamera = await startCamera(video, onScan, ctrl.signal);
      say('Aponte a câmera para um código de cada vez, bem iluminado e sem reflexo.');
    } catch (e) {
      cameraBox.classList.add('hidden');
      if (!ctrl.signal.aborted) say(`Não foi possível usar a câmera (${e.name || e.message}). Use “Fotos” ou “Arquivo .txt”.`, 'warn');
    } finally {
      if (starting === ctrl) starting = null;
    }
  }

  // Descarta tudo o que foi lido (útil quando códigos estranhos ou repetidos foram
  // misturados aos verdadeiros). As senhas digitadas também são apagadas.
  function restart() {
    if (busy) return;
    collector = new Collector();
    passwords.clear();
    typed.value = '';
    delete pwBox.dataset.sig;
    clear(result);
    render();
    say('Leitura recomeçada: nada do que foi lido antes foi guardado.');
  }

  function stopCam() {
    starting?.abort();
    starting = null;
    stopCamera?.();
    stopCamera = null;
    cameraBox.classList.add('hidden');
  }

  async function readPhotos(input) {
    const files = [...input.files];
    input.value = '';
    let found = 0;
    for (const [i, f] of files.entries()) {
      say(`Procurando códigos na foto ${i + 1} de ${files.length}…`);
      try {
        const texts = await scanFile(f);
        found += texts.length;
        for (const t of texts) collector.addQrText(t);
      } catch (e) {
        console.error(e);
      }
      render();
    }
    say(found ? `${found} código(s) encontrado(s) em ${files.length} foto(s).` : 'Nenhum código encontrado. Tente uma foto mais próxima, nítida e sem reflexo.', found ? 'ok' : 'warn');
  }

  async function readTxt(input) {
    const files = [...input.files];
    input.value = '';
    for (const f of files) {
      if (f.size > MAX_TXT_BYTES) {
        say(`${f.name}: arquivo grande demais para ser um Relicário.`, 'warn');
        continue;
      }
      feedText(await f.text());
    }
  }

  // Devolve true se tudo foi lido sem erro (só então o campo digitado é limpo).
  function feedText(text) {
    const before = collector.textStatus()?.count ?? 0;
    const { results, errors } = collector.addText(text);
    const msgs = results.map(describe);
    const ts = collector.textStatus();
    if (ts && ts.count > before) msgs.push(`${ts.count - before} linha(s) do conteúdo guardada(s).`);
    if (errors.length) say([...msgs, ...errors, 'Corrija as linhas indicadas e envie de novo (as certas já foram guardadas).'].join(' '), 'warn');
    else if (msgs.length) say(msgs.join(' '), 'ok');
    else say('Nenhuma linha do Relicário encontrada nesse texto.', 'warn');
    render();
    return errors.length === 0 && (msgs.length > 0 || !text.trim());
  }

  function textProgress() {
    const ts = collector.textStatus();
    if (!ts) return null;
    const parts = [`Versão em texto: ${ts.count} linha(s) do conteúdo digitada(s) até a ${String(ts.max).padStart(3, '0')}.`];
    if (ts.missing.length) parts.push(`Faltam: ${ts.missing.slice(0, 12).join(', ')}${ts.missing.length > 12 ? '…' : ''}.`);
    if (!ts.ended) parts.push('A última linha do conteúdo é a mais curta; continue até ela.');
    return h('p', null, parts.join(' '));
  }

  function render() {
    const sets = collector.summary();
    const s = sets[0];
    clear(status);
    if (!s) {
      append(status, textProgress());
      return renderPasswords(null);
    }
    const modeText = s.mode === MODE_SIMPLE ? 'senha única' : s.mode ? '2 de 3 partes' : 'modo ainda desconhecido';
    const content = s.contentReady
      ? h('li', { class: 'ok' }, 'Conteúdo: completo ✓')
      : h('li', null, s.k === 1
        ? `Conteúdo: ${s.blocks.size} de 1 código necessário lido (há ${s.n} na folha; qualquer um serve).`
        : `Conteúdo: ${s.blocks.size} de ${s.k} códigos necessários lidos (há ${s.n} na folha; quaisquer ${s.k} servem).`);
    const partsText = !s.parts.length
      ? 'Parte-chave: nenhuma lida ainda.'
      : s.mode === MODE_SIMPLE
        ? 'Parte-chave: lida ✓'
        : `Partes-chave lidas: ${s.parts.join(', ')} (necessárias: ${test ? 'as 3, no teste' : '2'}).`;
    append(status,
      h('h3', null, `Conjunto ${s.label}`, h('span', { class: 'muted' }, ` · ${modeText}`)),
      h('ul', null, content, h('li', { class: s.parts.length >= (test && s.mode !== MODE_SIMPLE ? 3 : s.need) ? 'ok' : '' }, partsText)),
      s.contentReady ? null : textProgress(),
      s.ignoredParts ? h('p', { class: 'warn' }, 'Uma parte-chave lida não combina com as demais e foi ignorada.') : null,
      s.conflictingParts ? h('p', { class: 'warn' }, 'Foram lidas duas partes-chave diferentes com o mesmo número (leitura errada ou código alterado). As duas serão testadas com a senha.') : null,
      s.conflictingContent ? h('p', { class: 'warn' }, 'Foram lidas versões diferentes do conteúdo deste conjunto (leitura errada ou código alterado). Todas serão testadas com a senha.') : null,
      s.overflow ? h('p', { class: 'warn' }, 'Foram lidos códigos estranhos demais (leitura errada ou código alterado), e parte deles foi ignorada. Se a abertura falhar, use “Recomeçar leitura” e leia só o papel ou arquivo original.') : null,
      s.suspect ? h('p', { class: 'warn' }, 'Um dos códigos de conteúdo lidos não combina com os demais (leitura errada ou código alterado). Leia mais códigos, de outra folha ou cópia, para a paridade decidir.') : null,
      sets.length > 1 ? h('p', { class: 'warn' }, `Também foram lidos códigos de outro(s) conjunto(s): ${sets.slice(1).map((o) => o.label).join(', ')}. Eles serão ignorados.`) : null,
      test && s.id !== test.setIdHex ? h('p', { class: 'warn' }, 'Este não é o conjunto que você acabou de criar.') : null,
    );
    renderPasswords(s);
  }

  function renderPasswords(s) {
    if (!s || !s.parts.length) {
      clear(pwBox);
      return;
    }
    // Redesenha só se o conjunto de partes mudou, para não apagar o que foi digitado.
    const sig = `${s.id}:${s.parts.join(',')}:${s.contentReady}`;
    if (pwBox.dataset.sig === sig) return;
    pwBox.dataset.sig = sig;
    clear(pwBox);
    const required = test && s.mode !== MODE_SIMPLE ? 3 : s.need;
    // Abre pelo id: o conteúdo e os candidatos podem mudar sem mudar a assinatura
    // (paridade que substitui um bloco forjado, outra parte com o mesmo número).
    const btn = h('button', { class: 'btn primary', type: 'button', disabled: !s.contentReady || s.parts.length < required, onclick: () => open(s.id) }, test ? 'Testar' : 'Abrir');
    const fields = s.parts.map((x) => passwordField({
      label: x ? `Senha da parte ${x}` : 'Senha',
      value: passwords.get(`${s.id}:${x}`) || '',
      onInput: (v) => passwords.set(`${s.id}:${x}`, v),
      onEnter: () => { if (!btn.disabled) open(s.id); },
    }).el);
    append(pwBox,
      h('div', { class: 'pw-form' },
        fields,
        s.mode !== MODE_SIMPLE && !test ? h('p', { class: 'hint' }, 'Preencha a senha de pelo menos 2 partes.') : null,
        !s.contentReady ? h('p', { class: 'hint' }, 'Termine de ler os códigos do conteúdo para poder abrir.') : null,
        btn,
      ),
    );
  }

  async function open(id) {
    if (busy) return;
    const s = collector.summary().find((o) => o.id === id);
    if (!s?.contentReady) return;
    const entries = s.parts
      .map((x) => ({ parts: s.keyParts.get(x), password: passwords.get(`${s.id}:${x}`) || '' }))
      .filter((e) => e.password.trim());
    const required = test && s.mode !== MODE_SIMPLE ? 3 : s.need;
    if (entries.length < required) {
      say(required === 1 ? 'Digite a senha.' : `Digite a senha de ${required === 3 ? 'todas as 3' : 'pelo menos 2'} partes.`, 'warn');
      return;
    }
    busy = true;
    stopCam();
    clear(result);
    try {
      const progress = (done, total) => {
        say(`Conferindo senhas: ${done} de ${total}… (cada etapa leva alguns segundos)`);
        return nextFrame();
      };
      if (test) await runTest(s, entries, progress);
      else showText(await openRelicario(s.objects, entries.slice(0, s.need), progress));
    } catch (e) {
      if (e instanceof PasswordError) {
        say(e.wrongParts[0] === 0 ? 'Senha incorreta. Confira maiúsculas, acentos e espaços.' : `Senha incorreta na(s) parte(s) ${e.wrongParts.join(', ')}. Confira maiúsculas, acentos e espaços.`, 'error');
      } else if (e instanceof LimitError) {
        say(e.message, 'error');
      } else if (e instanceof DecryptError) {
        say(`${e.message} Confira se cada senha está no campo da sua parte.${s.fromText ? ' Como o conteúdo foi digitado, também é possível (raro) que uma linha tenha erro que a conferência não pegou: revise as linhas.' : ''}`, 'error');
      } else {
        console.error(e);
        say(`Erro: ${e.message}`, 'error');
      }
    } finally {
      busy = false;
    }
  }

  async function runTest(s, entries, progress) {
    if (s.id !== test.setIdHex) throw new Error('Este não é o conjunto que você acabou de criar.');
    const secrets = await unlockParts(s.objects, entries, progress);
    try {
      const pairs = s.mode === MODE_SIMPLE ? [[0]] : [[1, 2], [1, 3], [2, 3]];
      for (const pair of pairs) {
        const text = await decryptWithSecrets(s.objects, new Map(pair.map((x) => [x, secrets.get(x)])));
        if ((await sha256Hex(text)) !== test.textHash) throw new Error('O texto recuperado é diferente do original.');
      }
    } finally {
      wipe(...[...secrets.values()].flat());
    }
    say(s.mode === MODE_SIMPLE ? 'Teste concluído: folha e senha abrem o texto original.' : 'Teste concluído: cada par de partes abre o texto original.', 'ok');
    test.onSuccess();
  }

  // Copiar exige confirmação: o histórico da área de transferência (Windows, teclados de
  // celular) pode guardar o texto e até sincronizá-lo com a nuvem.
  function copyButton(text) {
    let armed = false;
    const btn = h('button', { class: 'btn', onclick: async () => {
      if (!armed) {
        armed = true;
        btn.textContent = 'Confirmar cópia';
        say('Atenção: o histórico da área de transferência pode guardar o texto (e sincronizá-lo com a nuvem). Toque de novo para copiar.', 'warn');
        return;
      }
      await navigator.clipboard.writeText(text);
      armed = false;
      btn.textContent = 'Copiar';
      say('Copiado. Limpe a área de transferência e o histórico dela depois de usar.', 'ok');
    } }, 'Copiar');
    return btn;
  }

  function showText(text) {
    say('Aberto com sucesso.', 'ok');
    const area = h('textarea', { class: 'secret blurred', readonly: true, rows: Math.min(20, text.split('\n').length + 2), ...SECRET_INPUT, value: text });
    const toggle = h('button', { class: 'btn', onclick: () => { area.classList.toggle('blurred'); toggle.textContent = area.classList.contains('blurred') ? 'Mostrar texto' : 'Ocultar texto'; } }, 'Mostrar texto');
    append(clear(result),
      h('h3', null, 'Conteúdo'),
      h('p', { class: 'hint' }, 'O texto está oculto para proteger de quem olha por cima do ombro.'),
      area,
      h('div', { class: 'row' },
        toggle,
        copyButton(text),
        h('button', { class: 'btn', onclick: resetApp }, 'Fechar e limpar tudo'),
      ),
    );
  }

  const view = h('div', { class: 'restore' },
    h('div', { class: 'sources' },
      cameraAvailable() ? h('button', { class: 'btn primary', onclick: startCam }, 'Câmera') : null,
      h('button', { class: 'btn', onclick: () => photoInput.click() }, 'Fotos'),
      test ? null : h('button', { class: 'btn', onclick: () => txtInput.click() }, 'Arquivo .txt'),
      h('button', { class: 'btn', onclick: () => typeBox.classList.toggle('hidden') }, 'Digitar texto'),
      h('button', { class: 'btn', onclick: restart }, 'Recomeçar leitura'),
      photoInput,
      txtInput,
    ),
    cameraBox,
    typeBox,
    log,
    status,
    pwBox,
    result,
    onExit ? h('button', { class: 'btn-link back', onclick: () => { stopCam(); onExit(); } }, '← Voltar') : null,
  );
  view.cleanup = stopCam;
  return view;
}
