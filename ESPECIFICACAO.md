# Relicário — Especificação v1 (rascunho)

**Relicário** é uma ferramenta em HTML único (HTML + CSS + JS, sem dependências externas) para cifrar
**texto** e armazená-lo em meio eletrônico e em papel (sequência de QR Codes).

Prioridades: 1) segurança · 2) resiliência/durabilidade · 3) facilidade de uso.

---

## 1. Modelo de ameaça

| Ameaça | Defesa | Limite honesto |
|---|---|---|
| Roubo físico do papel | Papel = "algo que se tem"; sem a senha ("algo que se sabe") nada se revela. | Senha fraca + papel roubado = ataque offline ilimitado. Daí Argon2id + política forte. |
| Roubo de 1 página no 2-de-3 | Shamir: uma parte isolada não revela nada (teoria da informação). | — |
| Coerção | 3 guardiões, cada um com 1 página e 1 senha **distinta**; ninguém abre sozinho. | Coagir 2 guardiões abre. Criptografia não resolve coerção de quem sabe tudo. |
| Computador comprometido | Criação em aparelho limpo/offline com cópia local verificada; CSP bloqueia rede; texto decifrado oculto até toque. | Se o aparelho onde se digita/vê o texto estiver comprometido, o texto vaza. |
| Site hospedado adulterado | Sem domínio próprio (nada expira para ser comprado por terceiros); GitHub Pages da conta pessoal `camillofalcao`, com 2FA e sucessor indicado no GitHub; um caminho por versão de formato (`/v1/`), que nunca sai do ar; repositório público; build reprodutível e hash de cada publicação registrado; cópia em pendrive com cada guardião; alerta impresso contra pedidos online. | Leigos não verificam hash; mitigação é a cópia local. O endereço pertence a quem for dono do nome de usuário: se a conta for **renomeada** (o nome antigo fica livre na hora e o Pages não redireciona) ou **apagada**, outro pode registrar o nome e publicar em `/v1/` uma cópia idêntica que envia em silêncio o que for lido e digitado — o alerta impresso não cobre isso. Conta pessoal é ponto único de falha (sem outros administradores). Regras: nunca renomear nem apagar a conta; sucessor instruído a não apagá-la; planejamento sucessório diz "use o pendrive, não o site". |
| Perda/dano do papel | QRs de paridade (Reed-Solomon entre QRs), conteúdo replicado nas 3 páginas, fallback em texto. | — |
| Ferramenta extinta | Especificação impressa no verso de cada página; vetores de teste publicados. | — |

Fora do escopo: conteúdo de fachada/negação plausível; modo "apenas papel" (parte sem senha).

---

## 2. Modos

### 2.1 Modo simples (1-de-1)
- 1 senha, 1 página (o usuário pode imprimir quantas cópias quiser).
- Página = conteúdo cifrado + parte-chave `x=0`.

### 2.2 Modo 2-de-3
- 3 senhas **distintas** (a ferramenta rejeita senhas repetidas), uma por guardião.
- Página *i* = conteúdo cifrado (idêntico nas 3) + parte-chave `x=i`.
- Abrir exige **2 páginas quaisquer + as 2 senhas correspondentes**.

---

## 3. Primitivas

| Função | Escolha |
|---|---|
| Aleatoriedade | `crypto.getRandomValues` |
| Cifra do conteúdo | AES-256-GCM (Web Crypto), nonce 96 bits aleatório, tag 128 bits |
| KDF | Argon2id v1.3 (0x13); padrão `m = 65536 KiB`, `t = 3`, `p = 1`, `outlen = 33` |
| Divisão de segredo | Shamir 2-de-3 em GF(2⁸), polinômio 0x11B |
| Compressão | DEFLATE bruto (RFC 1951) |
| Código de apagamento | Reed-Solomon sistemático por avaliação em GF(2⁸), 0x11B |
| Integridade de quadro | CRC-32 (IEEE 802.3) |
| Codificação QR | Base45 (RFC 9285), modo alfanumérico, ECC nível M |
| Fallback textual | Base32 Crockford, linhas de 20 bytes com checksum |

Todos os inteiros multibyte são **big-endian**.

---

## 4. Senhas

### 4.1 Normalização (antes do KDF)
1. Normalizar para **NFC**.
2. Substituir toda sequência de espaços em branco por um único U+0020 e remover os das
   pontas. "Espaço em branco" é exatamente o conjunto `\s` do JavaScript (ECMAScript
   WhiteSpace + LineTerminator, que inclui U+FEFF). Um espaço a mais digitado entre as
   palavras, portanto, não tranca o conteúdo.
3. Codificar em **UTF-8**.

Maiúsculas/minúsculas são significativas. A interface avisa sobre acentos.

### 4.2 Política
- Comprimento mínimo: **16** caracteres (após normalização).
- Força estimada (zxcvbn-ts com dicionário pt-BR): **≥ 10²⁰ tentativas** (~66 bits) na
  estimativa **conservadora** = menor valor entre (a) zxcvbn normal, (b) zxcvbn sem
  separadores (espaço, `-`, `_`, `.`, `,`, `;`, `:`) e (c) produto das estimativas de cada
  trecho reconhecido. O zxcvbn sozinho superestima frases (cada espaço conta como caractere
  aleatório): "o rato roeu a roupa do rei de roma" passava; agora é rejeitada.
  Consequência: senha aleatória digitada à mão precisa de ≥ 20 caracteres.
- No 2-de-3, cada senha precisa cumprir a política **sozinha** (se um guardião for
  coagido, só a outra senha protege).
- No 2-de-3, as outras senhas do conjunto **e cada palavra delas** entram como dicionário
  do usuário, e uma senha que compartilha **2 ou mais palavras** (de 3+ letras) com outra é
  recusada. Sem isso, reordenar as palavras de outra senha parecia forte, e coagir um
  guardião entregaria a senha do outro por força bruta barata.
- Gerador sugerido: **7 palavras** da lista **BIP39 em português** (2048 palavras, sem
  acentos, 4 primeiras letras únicas, curadoria já feita): **77 bits**, separadas por
  espaço, minúsculas, sem palavra repetida. As poucas frases (~1 em 1.500) que ficam abaixo
  do limite da estimativa conservadora são sorteadas de novo (custo < 0,01 bit).

### 4.3 Derivação
```
out[33] = Argon2id(senha_normalizada, salt[16], m, t, p, outlen = 33)
pad     = out[0..31]
check   = out[32]
```
`salt` é aleatório e único por parte-chave.

**Checksum curto:** `check` detecta ~99,6 % dos erros de digitação. Custo: cada senha
perde 8 bits contra ataque offline (16 bits no par). Aceito conscientemente.

---

## 5. Cifragem do conteúdo

1. `texto` → UTF-8 (sem normalização do conteúdo) → DEFLATE bruto → `comp` (L bytes).
2. Interno = `u32 L ‖ comp ‖ zeros`, preenchido até o menor `B ∈ {256, 512, 1024, 2048,
   4096, 8192}` com `B ≥ 4 + L`. Se `4 + L > 8192` → erro "texto grande demais".
   (O tamanho em faixas evita revelar o tamanho exato do segredo.)
3. `DEK` = 32 bytes aleatórios; `nonce` = 12 bytes aleatórios.
4. Objeto de conteúdo:

| Offset | Tam. | Campo |
|---|---|---|
| 0 | 1 | versão = `0x01` |
| 1 | 1 | modo: `0x01` simples, `0x02` 2-de-3 |
| 2 | 5 | `set_id` (aleatório) |
| 7 | 12 | `nonce` |
| 19 | B+16 | `AES-256-GCM(DEK, nonce, interno, AAD = bytes 0..18)` |

`set_id` é exibido como 8 caracteres Crockford Base32: `XXXX-XXXX`.

---

## 6. Partes-chave

### 6.1 Modo simples
`segredo_0 = DEK`

### 6.2 Modo 2-de-3 (Shamir, limiar 2)
Para cada byte `j` da DEK (0..31):
```
a_j  = byte aleatório uniforme em [0, 255]   (zero INCLUÍDO — excluir enviesa)
y_i[j] = DEK[j] ⊕ (a_j · i)     para i = 1, 2, 3   (· = multiplicação em GF(2⁸))
```
Reconstrução a partir de (xi, yi), (xk, yk):
```
DEK[j] = (yi[j]·xk ⊕ yk[j]·xi) / (xi ⊕ xk)
```

### 6.3 Máscara (sem autenticação individual, por projeto)
```
mascarado = segredo_i ⊕ pad_i
```
Sem tag por parte: ninguém confirma uma senha isoladamente além do `check` de 8 bits;
a confirmação final vem da tag GCM do conteúdo, que exige o **par** correto.

---

## 7. Quadros (o que vai dentro de cada QR)

### 7.1 Cabeçalho comum
| Offset | Tam. | Campo |
|---|---|---|
| 0 | 2 | magic `"RL"` (`0x52 0x4C`) |
| 2 | 1 | versão do formato = `0x01` |
| 3 | 1 | tipo: `0x01` bloco de conteúdo, `0x02` parte-chave |
| 4 | 5 | `set_id` |

### 7.2 Bloco de conteúdo (tipo 0x01)
| Offset | Tam. | Campo |
|---|---|---|
| 9 | 1 | índice `x` (0..n−1) |
| 10 | 1 | `k` (blocos de dados) |
| 11 | 1 | `n` (total, dados + paridade) |
| 12 | 2 | tamanho do objeto de conteúdo |
| 14 | 384 | dados (último bloco de dados completado com zeros) |
| 398 | 4 | CRC-32 dos bytes 0..397 |

Total: 402 bytes → 603 caracteres Base45 → QR ≈ versão 16, ECC M.

**Paridade:** `k = ⌈tamanho / 384⌉`; o gerador usa a menor paridade `p ≥ max(2, ⌈k/2⌉)`
tal que, com `n = k + p` códigos distribuídos por igual em `⌈n/9⌉` folhas, **perder a folha
mais cheia ainda deixa k códigos**. O leitor exige exatamente esses valores: o tamanho é um
dos 6 da tabela, `k = ⌈tamanho/384⌉` e `n` é o desta regra (parâmetros que nenhum gerador
v1 emite só serviriam para inflar o trabalho de reconstrução). **Decisão de projeto
(26/10/2026):** a regra de paridade faz parte do formato v1. Mudá-la (por exemplo, uma
variante com mais paridade) exige nova versão de formato, para que cópias antigas do
leitor recusem o papel com “versão não suportada” em vez de falhar de forma obscura.

| Faixa B | k | n | Folhas (códigos por folha) |
|---|---|---|---|
| 256 | 1 | 3 | 1 |
| 512 | 2 | 4 | 1 |
| 1024 | 3 | 5 | 1 |
| 2048 | 6 | 9 | 1 |
| 4096 | 11 | 19 | 3 (7, 6, 6) |
| 8192 | 22 | 33 | 4 (9, 8, 8, 8) |

Com uma folha só, perdê-la é perder a cópia: no modo simples, imprimir 2 cópias.

**Verificação pela paridade (leitor):** com mais de k blocos lidos, os extras precisam
concordar com o polinômio dos k primeiros; se não concordam, há bloco forjado ou mal lido.
Com k+2 ou mais blocos o leitor localiza e descarta o intruso (tirando-o, os demais
concordam). Blocos de mesmo índice com dados diferentes ficam como alternativas e são
experimentados em camadas (a 1ª alternativa de cada índice, depois a 2ª…).
Partes-chave de mesmo índice com dados diferentes ficam todas como candidatas.

A paridade e o `check` **não autenticam**: quem tem o conteúdo cifrado pode alterá-lo e
refazer paridade e CRC; quem copia salt e KDF de uma parte faz uma parte falsa passar no
`check`. Por isso o leitor não congela a primeira montagem confirmada: todo conteúdo
completo e consistente (por QR ou digitado) vira candidato, o `check` só filtra as partes,
e a decisão final é do AES-GCM, que testa cada conteúdo com cada combinação de partes.
Limites contra entrada adulterada, conferidos antes do trabalho: até 4 candidatos por
índice (blocos ou partes-chave), até 4 conteúdos por conjunto, até 256 tentativas do
AES-GCM, um orçamento de derivação (soma de m·t) de 4 derivações com os parâmetros
máximos aceitos e um orçamento total de reconstrução Reed-Solomon por leitura (4 M
unidades de blocos × k; ler o maior conteúdo inteiro custa ~0,01 M). Passado um limite, o leitor recusa com mensagem e oferece “Recomeçar
leitura”. Assim, um QR acrescentado ao papel não
impede a leitura dos verdadeiros (quem pode acrescentar um QR também pode destruir o papel,
então isso é defesa contra erro e sabotagem discreta, não garantia contra vandalismo).

Para cada posição de byte `j`, os blocos de dados `i = 0..k−1` são os valores em `x = i`
de um polinômio de grau < k; os blocos de paridade `i = k..n−1` são esse polinômio
avaliado em `x = i`. **Quaisquer k dos n blocos reconstroem o objeto**, lidos em qualquer
ordem.

### 7.3 Parte-chave (tipo 0x02)
| Offset | Tam. | Campo |
|---|---|---|
| 9 | 1 | `x` (0 = simples; 1..3 = parte Shamir) |
| 10 | 1 | limiar (1 ou 2) |
| 11 | 1 | total de partes (1 ou 3) |
| 12 | 1 | KDF: `0x01` = Argon2id v1.3 |
| 13 | 4 | `m` em KiB (leitor aceita 8·p ≤ m ≤ 262144, ou seja, até 256 MiB) |
| 17 | 1 | `t` (leitor aceita 1..16) |
| 18 | 1 | `p` (leitor aceita 1..8) |
| 19 | 16 | `salt` |
| 35 | 32 | `mascarado` |
| 67 | 1 | `check` |
| 68 | 4 | CRC-32 dos bytes 0..67 |

Total: 72 bytes → QR pequeno, impresso destacado.

---

## 8. Fallback textual

- Conteúdo: o **objeto de conteúdo** (seção 5) em Base32 Crockford.
- Parte-chave: o quadro (7.3) em Base32 Crockford.
- Linhas: `NNN  XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX  CC`
  (até 20 bytes por linha, só a última pode ser menor; `NNN` começa em 001;
  `CC` = 10 bits baixos de CRC-32(`seção (1) ‖ NNN como u16 ‖ bytes da linha`), em
  2 caracteres Base32 Crockford; seção 1 = objeto de conteúdo, 2 = quadro de parte-chave).
- Na leitura, cabeçalhos e prosa são ignorados. Cada linha se confere sozinha e a seção é
  descoberta pelo próprio `CC` (as duas seções nunca colidem: o CRC é linear e elas diferem
  num byte fixo). Linhas do conteúdo se acumulam entre envios, em qualquer ordem; o objeto
  termina na primeira linha com menos de 20 bytes (nenhum tamanho de objeto é múltiplo de 20).
  A parte-chave (4 linhas) é lida a partir de uma linha 001; a seção 2 só aceita um quadro
  de parte-chave (72 bytes, tipo 0x02): mais linhas ou outro quadro são recusados.
- Erro de digitação que passe pela conferência da linha (1 em 1024) aparece como falha do
  AES-GCM; a mensagem pede para revisar as linhas.
- Impresso por padrão até a faixa B = 2048 (105 linhas, 3 folhas de 36 linhas); acima disso,
  opcional. 36 linhas por folha deixam ~12 mm de folga; o e2e imprime folhas cheias em PDF e
  redigita o texto extraído, para garantir que nenhuma linha se perde no papel.

---

## 9. Página impressa

```
┌──────────────────────────────────────────────┐
│ RELICÁRIO · PARTE 2 de 3 · K7FQ-2M9X · data  │
│ Instruções em português simples + URL /v1/   │
│ + "use o arquivo do pendrive, se tiver"      │
├──────────────────────────────────────────────┤
│ [QR PARTE-CHAVE 2]  (precisa da SUA senha)   │
├──────────────────────────────────────────────┤
│ Conteúdo cifrado (igual nas 3 páginas):      │
│ [QR][QR][QR] / [QR][QR][QR] ...              │
├──────────────────────────────────────────────┤
│ Fallback em texto (se aplicável)             │
└──────────────────────────────────────────────┘
Verso: esta especificação resumida.
```
- Módulo QR ≥ 0,6 mm; zona de silêncio de 4 módulos; ~9 QRs de conteúdo por A4.
- Rodapé: "Guarde a senha **longe** desta página."
- Alerta: "O Relicário funciona **sem internet**. Se pedir login, e-mail, pagamento ou
  para enviar algo, **pare** — não é o Relicário verdadeiro."
- URL impressa: `https://camillofalcao.github.io/relicario/v1/` (sempre sem acento).

Estimativas de páginas por cópia:

| Texto típico | Faixa B | QRs de conteúdo | Páginas |
|---|---|---|---|
| seed / senhas / nota curta | 256–512 | 3–4 | 1 |
| ~2 KB comprimido | 2048 | 6 + 3 | 1–2 |
| máximo | 8192 | 22 + 11 | ~4 |

---

## 10. Fluxos

**Criar:** modo → texto → senha(s) (com medidor, gerador e campo de confirmação) →
entropia extra opcional → gerar → *salvar arquivo eletrônico e imprimir* → **teste
obrigatório de restauração** (ler o papel impresso + digitar senhas). No 2-de-3 o teste
exige as 3 partes e as 3 senhas e confere **os 3 pares**.

**Entropia extra do usuário (opcional):** `semente = 32 bytes do sistema ‖ SHA-256(texto)`;
cada pedido de n bytes = `HKDF-SHA256(semente, info = "relicario/rng/<contador>")` XOR
n bytes novos de `crypto.getRandomValues`. Nunca fica mais fraco que o gerador do sistema.

**Abrir:** escanear QRs pela câmera (progresso "8 de 12, faltam nºs 3 e 9"; alternativa
por foto) → escanear 1 ou 2 partes-chave → digitar senha(s) (`check` acusa erro de
digitação por senha) → texto aparece oculto, revelado por toque.

**Arquivo eletrônico:** `.txt` contendo o fallback textual completo (legível, sem
formato binário proprietário).

---

## 11. Implementação

- **Um único `index.html`**, todas as bibliotecas inline com versão fixa; nada de CDN.
- CSP via `<meta>`: `default-src 'none'; script-src 'sha256-…' 'wasm-unsafe-eval';
  style-src 'sha256-…'; img-src data: blob:; media-src blob: mediastream:;
  connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'`
  (hashes calculados no build: só o script e o estilo originais executam).
- Campos: `spellcheck="false" autocomplete="off" autocapitalize="off" autocorrect="off"`.
- **Autoteste ao carregar:** decifrar vetores de teste embutidos; se falhar, a ferramenta
  se recusa a operar (pega navegador com implementação defeituosa).
- Hospedagem: **sem domínio próprio**. GitHub Pages do repositório público
  `camillofalcao/relicario` (conta pessoal; decisão de 02/11/2026, no lugar de uma
  organização), branch `main`, raiz. O build grava em `v1/` (`index.html` e
  `relicario.html`, o mesmo arquivo, e `SHA256SUMS`); o que está no repositório é o que vai
  ao ar, sem build no servidor. A conta nunca é renomeada nem apagada.
- **Versões (flexível).** `/v1/` = o leitor/gerador do **formato v1**. Pode ser substituído
  por correções e melhorias, desde que continue lendo todo papel v1 (vetores do autoteste e
  e2e); cada publicação recebe tag `v1.x.y` e uma linha em `HASHES.md` (versão, data,
  SHA-256, commit), para que cópias antigas possam ser conferidas. Mudança de formato vai
  para `/v2/`, e `/v1/` nunca sai do ar.
- Fonte principal para restauração: **cópia do HTML em pendrive com cada guardião**;
  o site é conveniência.
- Grafia: "Relicário" na interface e no papel; `relicario` (sem acento) em URLs, nomes
  de arquivo e identificadores.

Bibliotecas (versões fixas em `package.json`, embutidas no HTML pelo build):

| Função | Biblioteca |
|---|---|
| Argon2id | `hash-wasm` (WASM); conferido nos testes contra `@noble/hashes` e o vetor PHC |
| QR geração | `qrcode-generator` (modo alfanumérico, ECC M), SVG com módulo em mm |
| QR leitura | `zxing-wasm` (zxing-cpp; lê vários QRs por foto; funciona no iOS) |
| Força de senha | `@zxcvbn-ts/core` + `language-common` + `language-pt-br` |
| Lista de palavras | `@scure/bip39` (lista portuguesa) |
| DEFLATE | `fflate` |
| AES-GCM, SHA-256, HKDF | Web Crypto nativa |
| Shamir, RS, Base45, Base32, CRC-32 | código próprio (`src/core/`), com testes |

---

## 12. Pendências

1. Medir Argon2id (64 MiB, t=3) num celular de entrada real (no desktop: ~0,3 s/senha).
2. ~~Lista de palavras~~ — resolvido com a lista BIP39 em português.
3. ~~Vetores de teste~~ — `src/core/vectors.js` (gerados por `scripts/gen-vectors.mjs`;
   congelados para o formato v1) e conferidos pelo autoteste a cada carregamento.
4. Texto das instruções impressas, testado com uma pessoa leiga real.
5. ~~Organização no GitHub~~ — decidido: conta pessoal, `https://camillofalcao.github.io/relicario/v1/`
   (padrão do build). Falta: confirmar 2FA e indicar o sucessor da conta no GitHub.
6. Testar câmera ao vivo em Android e iPhone reais (os testes automáticos usam fotos).
