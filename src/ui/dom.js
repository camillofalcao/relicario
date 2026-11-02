export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

export function append(el, ...children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

// Atributos para campos sensíveis: nada de corretor, sugestão ou envio à nuvem.
export const SECRET_INPUT = { autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' };

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
}

export function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// Recomeça do zero. Antes de navegar, esvazia os campos de senha: navegadores inferem
// "envio" quando a página navega depois de uma senha digitada e oferecem salvá-la.
export function resetApp() {
  for (const el of document.querySelectorAll('input, textarea')) el.value = '';
  document.getElementById('main')?.replaceChildren();
  location.reload();
}

export function formatDate(d = new Date()) {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Campo de senha. Fica sempre `type=password` (teclados de celular não aprendem o que
// é digitado nele); “mostrar” exibe o valor num texto ao lado, sem trocar o tipo.
// Não usa <form>, para não acionar o “salvar senha” de navegadores e gerenciadores.
export function passwordField({ label, value = '', onInput, onEnter }) {
  const input = h('input', { type: 'password', class: 'pw', ...SECRET_INPUT, 'aria-label': label, value });
  const shown = h('div', { class: 'pw-shown hidden', 'aria-live': 'off' });
  // O valor só vai para o DOM como texto enquanto “mostrar” estiver ativo.
  const sync = () => { shown.textContent = shown.classList.contains('hidden') ? '' : input.value; };
  input.addEventListener('input', () => { sync(); onInput?.(input.value); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') onEnter?.(); });
  const toggle = h('button', { class: 'btn-link', type: 'button', onclick: () => {
    const hidden = shown.classList.toggle('hidden');
    toggle.textContent = hidden ? 'mostrar' : 'ocultar';
    sync();
  } }, 'mostrar');
  const el = h('label', { class: 'field' }, h('span', null, label), h('div', { class: 'pw-row' }, input, toggle), shown);
  return { el, input, setValue: (v) => { input.value = v; sync(); } };
}
