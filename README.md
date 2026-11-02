# Relicário

O Relicário guarda um **texto secreto** — frase-semente de carteira de criptomoedas, senhas
mestras, códigos de recuperação, instruções para herdeiros — em **papel** e em **arquivo
`.txt`**, protegido por senha. O papel é uma sequência de QR Codes, com uma versão em texto
para digitar à mão se nenhum código puder ser lido.

É um único arquivo, `relicario.html`, que roda no navegador de um computador ou celular,
**sem internet**, e não envia nada a lugar nenhum.

Prioridades do projeto, nesta ordem: **segurança**, **durabilidade**, **facilidade de uso**.

---

## Sumário

1. [O que o Relicário faz](#1-o-que-o-relicário-faz)
2. [Os dois modos](#2-os-dois-modos)
3. [O que vai no papel e no arquivo](#3-o-que-vai-no-papel-e-no-arquivo)
4. [Antes de começar](#4-antes-de-começar)
5. [Guardar um segredo, passo a passo](#5-guardar-um-segredo-passo-a-passo)
6. [Abrir um Relicário](#6-abrir-um-relicário)
7. [Onde e como guardar](#7-onde-e-como-guardar)
8. [O que o Relicário não protege](#8-o-que-o-relicário-não-protege)
9. [Perguntas frequentes](#9-perguntas-frequentes)
10. [Para desenvolvedores](#10-para-desenvolvedores)

---

## 1. O que o Relicário faz

A proteção junta duas coisas: **algo que se tem** (a folha impressa ou o `.txt`) e **algo
que se sabe** (a senha). Quem acha a folha sem saber a senha não lê nada; quem sabe a senha
mas não tem a folha também não.

Ao criar:

1. o texto é comprimido e cifrado com AES-256-GCM, usando uma chave aleatória;
2. essa chave é protegida pela(s) senha(s) com Argon2id (64 MiB de memória), que torna cada
   tentativa de adivinhar a senha cara para um atacante;
3. o resultado vira QR Codes, com **códigos de paridade** extras: não é preciso ler todos,
   e uma folha manchada ou rasgada ainda pode ser lida;
4. o Relicário gera as folhas para imprimir e o arquivo `.txt` equivalente;
5. por fim, exige um **teste de restauração** a partir do papel impresso, para confirmar
   que o backup realmente abre antes de você confiar nele.

Ao abrir, ele lê os códigos (câmera, fotos, arquivo `.txt` ou texto digitado), pede a(s)
senha(s) e mostra o texto original, oculto até você tocar em "Mostrar texto".

Garantias de funcionamento:

- **Offline de verdade.** A página bloqueia qualquer acesso à rede (política CSP); o
  Relicário nunca pede login, e-mail, pagamento ou envio de dados. Se pedir, não é o
  verdadeiro.
- **Autoteste ao carregar.** Toda vez que é aberto, ele decifra vetores de teste embutidos.
  Se o navegador tiver alguma falha, aparece "Autoteste FALHOU" e o Relicário se recusa a
  operar. Só use quando o selo mostrar **"Autoteste OK"**.
- **Sobrevive ao próprio programa.** Cada folha traz impresso um resumo do formato, para
  que um programador consiga decifrar o conteúdo mesmo que o Relicário deixe de existir. A
  especificação completa está em [ESPECIFICACAO.md](ESPECIFICACAO.md).

---

## 2. Os dois modos

### Senha única

- **Uma folha** (conjunto de códigos) e **uma senha**.
- Quem tiver a folha e a senha lê o conteúdo.
- Indicado para uso pessoal: você guarda a folha num lugar e a senha em outro (ou na
  memória).
- Imprima **duas cópias** e guarde-as em lugares diferentes: se a única folha se perder, o
  conteúdo se perde.

### 2 de 3 guardiões

- **Três partes**, cada uma entregue a um guardião diferente, cada guardião com a **sua
  própria senha** (o Relicário não aceita senhas repetidas ou parecidas entre si).
- Para abrir são necessárias **quaisquer 2 partes + as 2 senhas correspondentes**.
- Uma parte sozinha, mesmo com a senha, não revela **nada** (Shamir).
- Protege contra:
  - **roubo** de uma folha;
  - **perda** de uma folha ou esquecimento de uma senha (as outras duas bastam);
  - **coerção** de uma pessoa: ninguém consegue abrir sozinho.
- Indicado para herança e para segredos que não devem depender de uma única pessoa.

Exemplo: você, seu cônjuge e um advogado ficam cada um com uma parte e uma senha. Se você
faltar, os outros dois juntos abrem; nenhum deles consegue abrir sem o outro.

---

## 3. O que vai no papel e no arquivo

Cada folha impressa contém:

- **cabeçalho** com o nome do conjunto (ex.: `K7FQ-2M9X`), a parte (no modo 2 de 3), a data
  e, opcionalmente, o nome do guardião;
- **instruções em português simples** para quem for abrir no futuro;
- **código PARTE-CHAVE** (QR destacado): é o que a senha destrava. No modo 2 de 3 cada
  folha tem a sua;
- **códigos do conteúdo**: o texto cifrado, idêntico nas três partes do modo 2 de 3. Há
  mais códigos do que o necessário (paridade); a folha diz quantos bastam;
- **versão em texto** (opcional, ligada por padrão para textos menores): linhas com número
  e conferência, para digitar à mão se nenhum QR puder ser lido;
- no verso, o **resumo técnico do formato**, para programadores;
- os avisos "Guarde a senha longe desta folha" e "O Relicário funciona sem internet".

**As folhas não contêm senhas.**

O **arquivo `.txt`** contém exatamente a versão em texto (conteúdo + parte-chave), em
formato legível. Ele vale tanto quanto a folha: só a senha o protege.

Tamanho: o limite é de cerca de **8 KB depois de comprimido** — algumas páginas de texto
comum. Tamanhos típicos:

| Texto | Códigos de conteúdo | Folhas por parte |
|---|---|---|
| frase-semente, poucas senhas, nota curta | 3–4 | 1 |
| ~2 KB comprimido | 9 | 1 (+ versão em texto) |
| máximo (~8 KB comprimido) | 33 | ~4 |

O tamanho cifrado é arredondado em faixas, para não revelar o tamanho exato do segredo.

---

## 4. Antes de começar

### Obter o Relicário

- **Online:** https://camillofalcao.github.io/relicario/v1/
- **Para baixar (pendrive):** https://camillofalcao.github.io/relicario/v1/relicario.html
  — ou o arquivo [`v1/relicario.html`](v1/relicario.html) deste repositório.

É o mesmo arquivo nos dois casos, autossuficiente: pode ser copiado para um pendrive,
aberto direto do disco ou do celular, sem instalar nada. **Para criar um Relicário e para
guardar com as folhas, prefira a cópia baixada e conferida**; o site é uma conveniência.

Para conferir que o arquivo não foi alterado, compare o hash SHA-256 com o publicado em
[`v1/SHA256SUMS`](v1/SHA256SUMS) e no [histórico de hashes](HASHES.md):

```
# Linux
sha256sum relicario.html

# macOS
shasum -a 256 relicario.html

# Windows (PowerShell)
Get-FileHash relicario.html -Algorithm SHA256
```

Uma cópia antiga, de outra publicação, é legítima se o hash dela constar no
[HASHES.md](HASHES.md).

### Preparar o aparelho

- Use um aparelho **em que você confia**, atualizado e sem programas estranhos. O texto é
  digitado e exibido nele: se ele estiver comprometido, o segredo vaza.
- Ative o **modo avião**.
- Use **janela anônima** ou um navegador **sem extensões**: extensões conseguem ler a
  página.
- Para **criar**, prefira a cópia conferida do `relicario.html`, e não um site.
- Abra o arquivo diretamente. Se ele for aberto dentro de outra página (frame), recusa-se a
  funcionar.

### Ter à mão

- impressora (de preferência a laser) e papel de boa qualidade;
- papel e caneta para anotar a(s) senha(s) geradas;
- no modo 2 de 3: os três guardiões presentes, ou um plano para entregar a cada um a sua
  senha de forma segura;
- pendrives para deixar uma cópia do `relicario.html` com cada folha (recomendado).

---

## 5. Guardar um segredo, passo a passo

Na tela inicial, espere o selo **"Autoteste OK"** e toque em **"Guardar um segredo"**. O
assistente tem cinco etapas.

### 5.1 Modo

Escolha **Senha única** ou **2 de 3 guardiões** (veja a [seção 2](#2-os-dois-modos)).

### 5.2 Texto

Digite ou cole o texto. A barra mostra a ocupação, quantos códigos serão gerados e quantas
folhas cada parte terá. Se passar do limite, divida o conteúdo em mais de um Relicário.

Dica: inclua no próprio texto uma explicação para quem for ler no futuro — o que é aquilo,
para que serve, o que fazer com ele.

### 5.3 Senhas

Para cada senha (uma no modo simples, três no modo 2 de 3):

- **Recomendado:** toque em **"Gerar frase de 7 palavras"**. O Relicário sorteia 7 palavras
  em português (lista BIP39), o equivalente a 77 bits de segurança. **Anote a frase à mão**,
  num papel separado da folha impressa, e digite-a de novo em "Confirmar".
- Se preferir criar a sua, ela precisa ter **pelo menos 16 caracteres** e passar no medidor
  de força, que é rigoroso de propósito: frases conhecidas, ditados e palavras em sequência
  óbvia são recusados. Uma senha aleatória digitada à mão precisa de uns 20 caracteres.
- Maiúsculas e minúsculas contam. Espaços nas pontas e espaços repetidos são ignorados. O
  medidor avisa se houver acentos ou símbolos difíceis de digitar em outro teclado.

No modo 2 de 3:

- cada senha precisa ser forte **sozinha** e diferente das outras (senhas que compartilham
  2 ou mais palavras são recusadas);
- cada guardião deve conhecer **só a sua** senha;
- você pode informar o **nome de cada guardião**. Ele é impresso na folha daquele guardião
  — útil para quem achar a folha saber a quem procurar, mas também revela quem a detém.

**Opcional — "acrescentar aleatoriedade sua":** você pode digitar, por exemplo, resultados
de dados. Isso é misturado ao gerador de números aleatórios do aparelho e nunca enfraquece
o resultado; só protege caso o gerador do aparelho seja falho.

Toque em **"Gerar Relicário"**. A proteção de cada senha leva de uma fração de segundo a
alguns segundos, conforme o aparelho. Depois disso, o texto e as senhas são apagados da
memória da página.

### 5.4 Imprimir e salvar

A tela mostra o nome do conjunto, a pré-visualização das folhas e, para cada parte:

- **Imprimir** — abre a impressão só daquela parte;
- **Baixar .txt** — salva o arquivo eletrônico daquela parte.

No modo 2 de 3 há também **"Imprimir as 3 partes"**. A caixa "Incluir a versão em texto"
liga ou desliga as linhas para digitação manual.

Cuidados:

- no modo simples, imprima **duas cópias**;
- no modo 2 de 3, entregue a cada guardião **só a sua folha e o seu `.txt`**;
- não deixe vários `.txt` de partes diferentes no mesmo lugar (mesma nuvem, mesmo e-mail):
  isso desfaz a separação entre guardiões;
- a impressora pode guardar uma cópia do trabalho. As folhas não contêm senhas, mas tenha
  isso em mente.

### 5.5 Teste de restauração (obrigatório)

Toque em **"Continuar para o teste de restauração"**. O aviso fica em
**"Backup ainda NÃO verificado"** até o teste passar.

- Leia os códigos **da folha impressa**, não da tela — o objetivo é provar que o papel
  funciona.
- Digite a(s) senha(s).
- No modo 2 de 3, leia **as 3 partes-chave** e digite **as 3 senhas**: o teste confere que
  **cada um dos 3 pares** abre o texto.

Quando aparecer **"Backup verificado"**, toque em **"Concluir e limpar tudo"**. Se o teste
falhar, volte, reimprima e teste de novo; não confie num Relicário não testado.

---

## 6. Abrir um Relicário

Abra o `relicario.html` (de preferência a cópia do pendrive), ative o modo avião, espere o
**"Autoteste OK"** e toque em **"Abrir um Relicário"**.

### 6.1 Ler os códigos

Escolha uma ou mais formas — elas podem ser combinadas e o que já foi lido fica guardado:

| Botão | Como usar |
|---|---|
| **Câmera** | Aponte para os QR Codes, um por vez ou vários juntos, em qualquer ordem. |
| **Fotos** | Escolha fotos das folhas (uma foto pode conter vários códigos). Útil quando a câmera ao vivo não funciona. |
| **Arquivo .txt** | Escolha o(s) arquivo(s) `.txt` salvos na criação. |
| **Digitar texto** | Digite ou cole as linhas da "Versão em texto", com o número no início e os 2 caracteres de conferência no fim. Pode enviar uma folha (ou parte dela) por vez, em qualquer ordem. |

O painel mostra o progresso, por exemplo:
"Conteúdo: 4 de 6 códigos necessários lidos (há 9 na folha; quaisquer 6 servem)".
**Não é preciso ler todos os códigos** — só a quantidade indicada, quaisquer que sejam.

Leia também a **PARTE-CHAVE**:

- modo simples: a da folha;
- modo 2 de 3: as de **2 partes quaisquer** (de guardiões diferentes).

Se algo der errado na leitura (código de outro conjunto, código danificado ou alterado),
o painel avisa. **"Recomeçar leitura"** descarta tudo o que foi lido.

### 6.2 Digitar a(s) senha(s)

Com o conteúdo completo e as partes-chave lidas, aparecem os campos de senha. No modo 2 de
3, cada guardião digita a senha da sua parte (basta preencher 2). Toque em **"Abrir"**.

Uma conferência curta acusa a maioria dos erros de digitação **por senha**, apontando qual
está errada.

### 6.3 Ver o texto

O texto aparece **oculto**, para proteger de quem olha por cima do ombro. Toque em
**"Mostrar texto"** para revelá-lo. Ao terminar, toque em **"Fechar e limpar tudo"**.

---

## 7. Onde e como guardar

- **Papel:** em saco plástico, longe de umidade, calor e luz direta. Impressão a laser dura
  mais que jato de tinta.
- **Senhas:** sempre **longe das folhas**. Quem tiver as duas coisas abre o conteúdo.
- **`relicario.html`:** deixe uma cópia em pendrive junto de cada folha. Daqui a anos,
  um site pode não estar mais no ar, mas o arquivo continua funcionando em qualquer
  navegador.
- **Modo 2 de 3:** guardiões em lugares diferentes, cada um com sua folha, seu `.txt`, seu
  pendrive e só a sua senha.
- **Planejamento sucessório:** diga a quem deve abrir no futuro que o Relicário existe,
  onde estão as folhas e como chegar às senhas.
- **Teste de tempos em tempos** (por exemplo, uma vez por ano) se as folhas continuam
  legíveis e as senhas lembradas.

---

## 8. O que o Relicário não protege

- **Senha fraca + folha roubada.** O atacante pode tentar senhas sem limite, no próprio
  computador. Por isso o medidor é rigoroso e o gerador de frases é recomendado.
- **Aparelho comprometido.** Se o computador ou celular onde você digita ou vê o texto tiver
  um programa espião, o texto vaza. Nenhuma criptografia resolve isso.
- **Coerção de quem sabe tudo.** No modo 2 de 3, coagir 2 guardiões abre o conteúdo.
- **Cópia falsa do Relicário.** Um `relicario.html` adulterado poderia roubar o segredo.
  Use a cópia conferida pelo hash; desconfie de qualquer versão que peça internet, login ou
  envio de dados. Uma página falsa também pode **não pedir nada** e enviar os dados em
  silêncio — por exemplo, se um dia o endereço impresso nas folhas passar para outro dono.
  Por isso a cópia do pendrive é a fonte principal, e o site, uma conveniência.
- **Negação plausível.** Não há conteúdo de fachada nem modo "só papel, sem senha".

O modelo de ameaça completo está na seção 1 da
[especificação](ESPECIFICACAO.md).

---

## 9. Perguntas frequentes

**Esqueci a senha. Tem como recuperar?**
Não. No modo simples, sem a senha o conteúdo está perdido. No modo 2 de 3, as outras duas
partes e senhas continuam abrindo.

**Perdi uma folha.**
No modo simples, use a segunda cópia. No modo 2 de 3, as outras duas partes bastam. Em
ambos os casos, considere criar um novo Relicário e destruir as folhas antigas.

**A folha está manchada ou rasgada.**
Leia os códigos que restarem; graças à paridade, nem todos são necessários. Se faltar, use
a versão em texto, outra cópia, o `.txt` ou, no modo 2 de 3, o conteúdo de outra parte
(ele é idêntico nas três).

**Posso usar no celular?**
Sim, para criar e para abrir. A leitura de QR usa uma biblioteca que funciona também no
iPhone. A câmera ao vivo ainda não foi testada em aparelhos reais; se ela falhar, use
**Fotos**.

**Preciso de internet?**
Não. Recomenda-se até ativar o modo avião.

**Posso mudar o texto depois?**
Não; crie um novo Relicário e destrua as folhas antigas.

---

## 10. Para desenvolvedores

### Comandos

```
npm install
npm test          # testes do núcleo (Node)
npm run build     # gera v1/index.html, v1/relicario.html e v1/SHA256SUMS
npm run e2e       # build + teste no Chrome: cria, imprime em PDF, fotografa, lê e abre
npm run bench     # medições de desempenho (CPU normal e 6x mais lenta)
```

O e2e usa o Chrome em `/usr/bin/google-chrome` e grava as saídas em `e2e-out/`.

O build embute nas folhas o endereço `https://camillofalcao.github.io/relicario/v1/`.
Quem hospeda outra cópia troca com `RELICARIO_URL=<endereço> npm run build`
(`RELICARIO_URL=` vazio gera folhas sem endereço). O build é reprodutível: rodá-lo a
partir de um commit publicado chega ao mesmo hash do [HASHES.md](HASHES.md).

### Publicação e versões

O GitHub Pages publica a branch `main` a partir da raiz; o que está em `v1/` é exatamente
o que vai ao ar (não há build no servidor).

- **Correção ou melhoria que continua lendo todo papel v1** (garantido pelos vetores do
  autoteste): `npm run e2e`, commit de `v1/`, nova linha no [HASHES.md](HASHES.md), versão
  em `package.json` e tag `v1.x.y`. Substitui o conteúdo de `v1/`.
- **Mudança no formato:** nova pasta `v2/`. **`v1/` nunca sai do ar**, para que papéis
  antigos continuem abrindo.

A conta `camillofalcao` **nunca deve ser renomeada nem apagada**: o endereço impresso nas
folhas depende dela (veja o modelo de ameaça na especificação).

### Estrutura

- `v1/` — o Relicário publicado (gerado pelo build; não editar à mão).
- `src/core/` — formato, criptografia, Shamir, Reed-Solomon, codificações, política de
  senhas, coletor de leituras e autoteste. Sem dependência de DOM.
- `src/ui/` — interface (criação, abertura, folhas impressas, câmera).
- `src/index.html`, `src/styles.css` — esqueleto e estilo; o `build.mjs` embute tudo num
  único HTML e calcula a CSP com os hashes do script e do estilo.
- `test/` — testes do núcleo, do coletor, da política de senhas e da câmera.
- `scripts/` — e2e, benchmarks, testes de estresse e geração de vetores.
- `scripts/gen-vectors.mjs` — gerou os vetores do formato v1. **Não regenere** sem mudar
  a versão do formato: papéis já impressos dependem deles.

### Documentação

- [ESPECIFICACAO.md](ESPECIFICACAO.md) — formato v1, primitivas, política de
  senhas, layout das folhas, modelo de ameaça e decisões de projeto.
- [HASHES.md](HASHES.md) — hash SHA-256 de cada publicação.
