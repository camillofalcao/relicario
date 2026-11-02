import { runSelfTest } from '../core/selftest.js';
import { h, append, clear } from './dom.js';
import { createView } from './create.js';
import { restoreView } from './restore.js';
import { WARNING_ONLINE } from './texts.js';

const main = document.getElementById('main');
const badge = document.getElementById('selftest');
let ready = false;
let failed = false;

function home() {
  append(clear(main),
    h('section', { class: 'hero' },
      h('p', { class: 'lead' }, 'Guarde um texto secreto em papel e em arquivo, protegido por senha. Tudo acontece neste aparelho; nada é enviado.'),
    ),
    h('div', { class: 'choices' },
      h('button', { class: 'choice', disabled: !ready, onclick: () => append(clear(main), createView({ onExit: home })) },
        h('strong', null, 'Guardar um segredo'), h('span', null, 'Cifrar um texto e gerar as folhas para imprimir.')),
      h('button', { class: 'choice', disabled: !ready, onclick: () => append(clear(main), h('h2', null, 'Abrir um Relicário'), restoreView({ onExit: home })) },
        h('strong', null, 'Abrir um Relicário'), h('span', null, 'Ler as folhas (ou o arquivo .txt) e digitar a(s) senha(s).')),
    ),
    failed ? h('p', { class: 'banner error' }, 'O autoteste falhou neste navegador. Não use o Relicário aqui: tente outro navegador ou aparelho.') : null,
    framed ? h('p', { class: 'banner error' }, 'O Relicário foi aberto dentro de outra página. Abra o arquivo ou o endereço diretamente.') : null,
    h('details', { class: 'tips' },
      h('summary', null, 'Antes de começar: segurança'),
      h('ul', null,
        h('li', null, 'Use um aparelho em que você confia, atualizado e sem programas estranhos. De preferência, ative o modo avião.'),
        h('li', null, 'Para criar, prefira a cópia do arquivo relicario.html conferida (hash publicado), e não um site.'),
        h('li', null, 'Use janela anônima ou um navegador sem extensões: extensões conseguem ler a página.'),
        h('li', null, WARNING_ONLINE),
      ),
    ),
  );
}

// Dentro de um frame de outro site, alguém poderia sobrepor a página para enganar
// cliques. O Relicário só funciona aberto diretamente.
const framed = window.top !== window.self;

home();
// Deixa a página aparecer antes do autoteste (ele leva um instante).
setTimeout(async () => {
  if (framed) {
    badge.textContent = 'Aberto dentro de outra página: recusado';
    badge.className = 'badge error';
    return;
  }
  try {
    await runSelfTest();
    ready = true;
    badge.textContent = 'Autoteste OK';
    badge.className = 'badge ok';
  } catch (e) {
    console.error(e);
    failed = true;
    badge.textContent = 'Autoteste FALHOU';
    badge.className = 'badge error';
  }
  if (main.querySelector('.hero')) home();
}, 50);
