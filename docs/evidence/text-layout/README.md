# Text layout: `onTextLayout` e o baseline do Yoga a partir de um único parágrafo medido

Esta fatia faz o `Text` público reportar a geometria das linhas que o host mede e pinta.
O RN pede essas linhas à plataforma em dois lugares do `ParagraphShadowNode`
(`layout`, para o evento `onTextLayout`, e `baseline`, para o callback de baseline do
Yoga), os dois atrás de `TextLayoutManagerExtended::supportsLineMeasurement()`, que só
vale se o `TextLayoutManager` da plataforma tiver `measureLines`. O host usava o
`TextLayoutManager` portátil `cxx` do RN, que não tem: o evento nunca era emitido e uma
linha com `alignItems: 'baseline'` alinhava os topos, como se todo baseline fosse zero. Agora o
[`TextLayoutManager` de plataforma do Godot](https://github.com/journey-studios/godot-fabric/blob/8e3e43513a2324503450c7f08511b6225619b9c0/native/text_platform/react/renderer/textlayoutmanager/TextLayoutManager.h)
mantém a superfície pública do `cxx` e acrescenta o `measureLines` virtual, e o
[`ParagraphLayout`](https://github.com/journey-studios/godot-fabric/blob/8e3e43513a2324503450c7f08511b6225619b9c0/native/paragraph_layout.cpp)
o sobrescreve convertendo o mesmo `PreparedParagraph` que mede e pinta: não existe um segundo
algoritmo de quebra de linha. A
[pesquisa](https://github.com/journey-studios/godot-fabric/blob/8e3e43513a2324503450c7f08511b6225619b9c0/docs/research/text-layout.md)
registra as fontes do RN com linhas, o contrato dos campos e as decisões. O
[recibo](execution.json) fixa fontes, hashes e resultados, e o [recibo de capturas](captures.json)
os quadros.

Tudo aqui foi executado **a partir do commit de implementação
[`8e3e435`](https://github.com/journey-studios/godot-fabric/commit/8e3e43513a2324503450c7f08511b6225619b9c0)**
(`8e3e43513a2324503450c7f08511b6225619b9c0`), com a árvore limpa, em macOS arm64 com Godot
oficial **4.7.2**, React Native **0.87.1**, React **19.2.3**, Hermes **250829098.0.17** e Node
**v22.23.3**, headless e, para o exemplo, com o renderizador nativo.

| Lane executada | Checks | Observação |
| --- | ---: | --- |
| Host anterior `54808dfa`, mesmo bundle | 21/26 | Exatamente as 5 falhas normativas: o evento nunca chega e o Yoga alinha os topos |
| Sabotagem retida: todas as linhas, ignorando `numberOfLines` | 72/76 | 4 falhas; o oráculo rejeita: `limited: one line per visible line` |
| Sabotagem retida: ascender sem o deslocamento centralizado de `lineHeight` | 73/76 | 3 falhas; o oráculo rejeita: `mixed-sans baseline offset: -2 differs from the font tables' 9.5 by more than 1` |
| Sabotagem retida: sentinela U+200B no texto da última linha | 67/76 | 9 falhas; o oráculo rejeita: `wrap: the line texts tile the paragraph's text` |
| Host atual `35018602`, headless | 76/76 | Um aplicativo Hermes, valores confrontados com as tabelas dos TTFs lidas em Node |
| Exemplo `text-layout`, headless | 18/18 | Clique real do Godot que reduz a coluna |
| Exemplo `text-layout`, renderizador nativo | 32/32 | Inclui a tinta pintada contra as linhas reportadas; duas capturas |

```sh
npm run test:text-layout
node scripts/text-layout-sabotage.mjs                      # host anterior e as 3 sabotagens, com o fonte restaurado
node tests/text-layout-native.test.mjs --allow-original-negative   # o host anterior instalado em addons/
npm run example -- text-layout --headless
npm run example -- text-layout --capture
```

O host anterior é o `fabric_godot.dylib` que o build de `main` (`e88b5bb`) produziu antes
da fatia, preservado em `build/text-layout-previous-host/` e instalado em `addons/` pelo
`scripts/text-layout-sabotage.mjs` só durante o controle; o host genuíno volta depois e o
rebuild reproduz o mesmo binário.

## O que foi verificado

O [probe](https://github.com/journey-studios/godot-fabric/blob/8e3e43513a2324503450c7f08511b6225619b9c0/tests/text-layout-probe.gd)
monta o [fixture](https://github.com/journey-studios/godot-fabric/blob/8e3e43513a2324503450c7f08511b6225619b9c0/tests/text-layout-fixture.jsx)
numa aplicação Hermes e lê o que o JS recebeu ao lado dos snapshots do host para os mesmos
parágrafos. O teste julga entrega e ordem, nunca tempo: espera os eventos por condição e dá
quadros para um evento tardio aparecer. O
[oráculo](https://github.com/journey-studios/godot-fabric/blob/8e3e43513a2324503450c7f08511b6225619b9c0/tests/text-layout-oracle.mjs)
lê os TTFs em Node (sem Godot nem FreeType) e refaz cada relação a partir dos números do
relatório; ele rejeita um relatório mesmo com todos os checks do probe marcados como passados.

- **Primeiro evento.** O emissor só é habilitado quando o nó monta e grava o último resultado
  antes de despachar, então um primeiro despacho perdido seria perdido para sempre. Os 10
  parágrafos com `onTextLayout` receberam **exatamente 1 evento** cada, para o primeiro layout,
  e nenhum recebeu dois; um parágrafo sem a prop e um span aninhado com ela não receberam nada.
  Os eventos chegam ao JS na ordem em que o host os despachou.
- **Payload.** O evento tem `lines`, mais `target` e `timeStamp` que o RN acrescenta a todo
  evento; cada linha tem exatamente os 9 campos (`text`, `x`, `y`, `width`, `height`,
  `descender`, `capHeight`, `ascender`, `xHeight`), todos finitos, e o `text` nunca carrega a
  sentinela U+200B do host.
- **Medida e pintura concordam**, em 8 parágrafos (esquerda, centro e direita, uma quebra
  explícita, `numberOfLines`, JetBrains Mono e dois `lineHeight` explícitos): o número de linhas é
  o de linhas visíveis (com `numberOfLines`, exatamente o limite); sem truncamento os textos das
  linhas concatenam o texto do parágrafo; as alturas somam a altura do nó (±1); `y` é a soma das
  alturas acima; `x` segue o `textAlign` a partir da caixa e da largura da linha e é o do
  `lineMetrics` do host; o baseline pintado é `y + ascender`; um parágrafo composto reporta o
  texto aninhado como parte das linhas.
- **Tabelas dos TTFs.** `ascender`, `descender`, `height`, `capHeight` e `xHeight` de cada linha
  contra o oráculo, em NotoSans e JetBrains Mono e com `lineHeight` explícito (um texto de 14 px
  com `lineHeight` 28 põe o baseline 4 px abaixo do natural).
- **Dedupe do emissor.** Uma mudança só de cor, e uma largura que quebra as mesmas linhas,
  fazem o Yoga consultar o `measureLines` de novo (o contador sobe: 10 chamadas por commit, uma
  por parágrafo com a prop) e não emitem; uma largura, um texto ou um `numberOfLines` novos
  emitem uma vez; remover a prop para os eventos e o parágrafo deixa de ser consultado (9
  chamadas).
- **Baseline do Yoga.** Uma linha `alignItems: 'baseline'` de 14 px e 28 px, um par com
  `alignSelf: 'baseline'` e um NotoSans 14 contra um JetBrains Mono 12 com `lineHeight` 40: o
  segundo texto fica mais baixo pela diferença dos ascenders que as tabelas prevêem (15, 13 e
  9,5 px; medidos 15, 13 e 9, porque o Yoga assenta frames em pixels inteiros). A raiz não tem
  `onTextLayout`, então as 30 chamadas ao `measureLines` que ela causa são só do callback de
  baseline. No host anterior os três offsets são 0 e o contador não existe.
- **Negativos.** Um `onTextLayout` que não é função, um objeto, `onPress`, `selectable` e
  `adjustsFontSizeToFit` são rejeitados pelo wrapper antes de qualquer layout nativo, com os
  erros `Godot Text onTextLayout must be a function` e `Godot Text does not implement <prop>`; um
  `ErrorBoundary` recupera e o host não reporta nada. Um parágrafo com um Control inline (que
  contorna a checagem do facade) falha no host: `measure` e `measureLines` reportam
  `Inline Controls are not implemented in Godot Text`, o callback de baseline do Yoga (uma
  função C) não é atravessado por exceção, nenhum `onTextLayout` é emitido e a aplicação para com
  todos os Controls balanceados. Com o callback de baseline sozinho, 4 chamadas ao
  `measureLines` falham e sobrevivem; com o handler, 5.

76 checks no host atual: 4 de eventos, 8 de payload, 33 de concordância, 7 de dedupe, 4 de
baseline, 7 de negativos, 7 de falha, 5 de limpeza e 1 do relatório.

## Tolerância medida

A tolerância normativa é **±1 px** por medida. O host arredonda o tamanho da fonte para inteiro
(`paragraph_layout.cpp`), e o text server do Godot lê as métricas escaladas do FreeType, que
arredonda o ascender para cima e o descender para baixo, em pixels inteiros (`FT_Size_Metrics`).
Medi as duas formas contra as tabelas dos TTFs (`head.unitsPerEm`, `hhea.ascender`/`descender`
e o `yMax` do `glyf` de "T" e "x"):

| Medida | Escala crua das tabelas | Com o arredondamento documentado do FreeType |
| --- | ---: | ---: |
| `ascender` | 0,896 | 0,000 |
| `descender` | 0,726 | 0,000 |
| `height` (a soma dos dois) | **1,484** | 0,000 |
| `capHeight` | 0,576 | 0,576 (altura de tinta, sem modelo) |
| `xHeight` | 0,496 | 0,496 (altura de tinta, sem modelo) |
| offset de baseline entre dois textos | 0,5 | 0,5 (o Yoga assenta frames em pixels inteiros) |

A escala crua das tabelas **não** sustenta ±1 px para a altura natural da linha (1,484 px no
pior caso, NotoSans 18), e o erro se acumula em `y`, uma altura de linha por linha acima. O
oráculo modela o arredondamento do FreeType (`ascent = ceil(hhea.ascender · px / unitsPerEm)`, o
descent igual a partir do módulo, com `px` o tamanho arredondado), que tem fonte documentada e é
independente do host; contra esse modelo o desvio máximo é 0 em `ascender`, `descender` e
`height` e 0,576 no pior caso (`capHeight`), dentro de ±1. Nenhuma tolerância foi afrouxada. O
oráculo lê os contornos do peso 400 (a instância padrão das fontes variáveis) e todo parágrafo
cujos números o probe confronta com as tabelas tem peso 400.

## Controles

O host anterior roda o mesmo bundle (o mesmo SHA-256 do bundle, e os mesmos pinos das fontes
compartilhadas) e executa 26 checks: os de montagem, baseline, negativos, falha e limpeza; os que
dependem de eventos, de concordância e do dedupe não rodam sem eventos. Falha **exatamente os 5
checks normativos**: o de "evento entregue" e os 4 de baseline (os três offsets e o de que o callback
de baseline do Yoga chega ao `measureLines`). Nenhum evento chega, os offsets são 0 e o contador de
chamadas não existe. Os outros 21 passam, incluindo as rejeições do wrapper e o caso de falha nativa.
O oráculo rejeita o relatório dele.

As três sabotagens quebram `native/paragraph_layout.cpp` de propósito e o host é reconstruído a
partir de cada uma; o `scripts/sabotage-sources.mjs` restaura o fonte byte a byte (SHA-256
`6f0b2a67…` antes e depois) mesmo que um sinal interrompa a execução, e o host genuíno é
reconstruído com o mesmo binário (`35018602…`). O probe e o oráculo rejeitam cada uma:

| Sabotagem | Checks do probe que falham | Rejeição do oráculo |
| --- | ---: | --- |
| `all-lines`: `measureLines` ignora `numberOfLines` e reporta todas as linhas | 4 | `limited: one line per visible line` |
| `no-centering`: o ascender sem o deslocamento centralizado de `lineHeight` | 3 | `mixed-sans baseline offset: -2 differs from the font tables' 9.5 by more than 1` |
| `sentinel`: a sentinela U+200B fica no texto da última linha | 9 | `wrap: the line texts tile the paragraph's text` |

Os hosts (SHA-256 completos estão no [recibo](execution.json)): genuíno `35018602e91c4144…`,
anterior `54808dfa617cfdfd…`, restaurado `35018602e91c4144…` (igual ao genuíno) e os três
sabotados `8f45134e…`, `71a13953…` e `78ef2916…`. O recibo é de execução local: não certifica o
binário que outra máquina compilar.

Uma guarda estática, [`tests/text-platform-manager.test.mjs`](https://github.com/journey-studios/godot-fabric/blob/8e3e43513a2324503450c7f08511b6225619b9c0/tests/text-platform-manager.test.mjs),
compara o manager de plataforma com o `cxx` do RN pinado, descontadas as 4 adições documentadas,
e confere que a assinatura do `measureLines` ainda é a que o `TextLayoutManagerExtended.h` e o
`ParagraphShadowNode.cpp` pinados sondam e chamam: um upgrade do RN que a desviasse falharia no
`test:contracts`.

## Capturas

`npm run example -- text-layout --capture` salva dois quadros do renderizador nativo, de
900 × 680, enquanto a validação do exemplo clica de verdade no botão. O
[recibo de capturas](captures.json) registra caminho, SHA-256 e dimensões de cada quadro, e os
bytes se repetiram em duas execuções seguidas. O exemplo desenha o que o evento diz sobre cada
parágrafo: uma caixa translúcida em `x`, `y`, `width` e `height` de cada linha e uma régua laranja
no baseline, `y + ascender`.

![Quatro parágrafos com a caixa e o baseline de cada linha reportada, uma linha de três textos alinhados pelo baseline, HEH e xxx sobre a régua e o botão Narrow the column](text-layout-initial.png)

**Inicial.** O parágrafo quebrado tem três linhas; o centralizado começa onde a linha começa; o
limitado a `numberOfLines={2}` só tem as duas linhas visíveis; o de `lineHeight` 28 tem caixas
mais altas, com a régua dentro delas. À direita, os três textos de tamanhos e fontes diferentes
compartilham a régua do baseline; "HEH" e "xxx" assentam nela e têm a altura da caixa. O resumo diz
`wrap: 3 lines · ascender 18 · capHeight 12 · xHeight 9`.

![A coluna estreita: o parágrafo quebrado tem quatro linhas, as caixas e as réguas seguem as linhas novas e o botão agora diz Widen the column](text-layout-narrow.png)

**Depois do clique.** Com a coluna estreita os parágrafos quebram de novo e o RN entrega as linhas
novas: o quebrado passa a quatro linhas, o resumo diz `wrap: 4 lines`, e as caixas e as réguas
acompanham. "HEH", cujas linhas não mudaram, não recebeu evento novo.

A validação do exemplo, com o renderizador, confere sobre o quadro: toda linha reportada tem tinta
pintada; a caixa desenhada no frame do evento de cada linha contém a tinta dessa linha, nos dois
estados; a tinta de "HEH" termina no baseline `y + ascender` (±1 px) e tem a altura do
`capHeight` reportado; a de "xxx" tem a altura do `xHeight`. Não há oráculo independente de pixels
nem comparação com o iOS ou o Android.

## Regressões

Na árvore do commit de implementação, com o host `35018602`, passaram (exit 0 em todas):

- os gates estáticos: `test:contracts` completo (285 testes Node, entre eles os 4 da guarda do
  manager de plataforma, e 13 Python; o inventário de paridade com 8.113 contratos e 97 valores
  públicos, 7 testes de paridade e 8 do dashboard), `type-check`, `check:static` e
  `check:publication`;
- tipografia: `test:typography` (4/4) e o laboratório `typography`, com os mesmos 50 checks
  headless e 63 com o renderizador, sem regressão; e o `test:examples`, que roda os 31 exemplos
  headless, o novo entre eles (18 checks);
- as suítes nativas de runtime, aplicação compartilhada, módulos, listas, switch, activity
  indicator, touchables, PanResponder, appearance, charts, nativewind e animated, e o
  `parity:godot` (13 casos);
- o SDK nativo: `sdk:native:pack` e `sdk:native:verify` com os argumentos da CI, e os adapters
  contra o header de plataforma publicado (registry com 207 checks e 11 casos, loader com 89 checks
  e 21 casos), mais o teste do SDK com o fixture que passou a incluir o header.

Não foram reexecutadas aqui as suítes de ponteiro, relógio de quadros, rede e WebSocket, nem as
demais que não leem texto.

## Limites e divergências documentadas

A CI hospedada do passo novo (`native-text-layout`, em `contracts.yml`) está **pendente**: nenhuma
execução hospedada foi feita, e esta fatia não afirma CI verde. Os números acima são de execução
local em macOS arm64. Nenhum GF, checkpoint, peso ou denominador fecha.

Ficam abertos, e não estão neste recibo: o `Text.js` original no lugar do wrapper do repositório
(a fatia 2), press e seleção em spans (pipeline de ponteiro), carregamento e fallback de fontes,
bidi, emoji e clusters de grafemas (sem uma fonte empacotada determinística),
`textDecoration` e `fontStyle`, elipse head/middle, escala de fonte e `adjustsFontSizeToFit`, views
inline e uma medição de referência num simulador iOS ou emulador Android. Os pesos diferentes de 400
não são confrontados com as tabelas para `capHeight` e `xHeight`.

As plataformas do RN discordam ou deixam em aberto os casos abaixo; o host escolhe uma resposta e
nenhum check depende dela (ver a
[pesquisa](https://github.com/journey-studios/godot-fabric/blob/8e3e43513a2324503450c7f08511b6225619b9c0/docs/research/text-layout.md)):
o texto da última linha truncada (o do host é o da própria linha, sem reticências); o texto vazio (o
iOS mede um caractere substituto); a condição em que `lineHeight` centraliza o baseline (o host
sempre centraliza; o iOS só quando a linha não é menor que a fonte, salvo uma flag); as linhas além
de uma altura fixa do nó (o host usa só a largura); e o campo extra `baseline` do Android (não é
enviado). A exceção normativa é que, com `numberOfLines`, o número de linhas é o de linhas
visíveis.
