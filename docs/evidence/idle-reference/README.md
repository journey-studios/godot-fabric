# A referência ociosa da faixa janelada: o que a mediana oscilava, o que a meia-soma de pares fixa e a emenda do protocolo do V05-10

> **Registro fixado.** Os números, os fontes e os hashes abaixo são os do commit
> [`237b171`](https://github.com/journey-studios/godot-fabric/commit/237b171df846b7acf76da534730e47961a0a36e3) (árvore `e626f532`, SHA completo no recibo), que troca a mediana ociosa por uma referência que não oscila
> com os dois grupos de intervalos, na regra de ritmo da faixa janelada do V05-06 e na referência do desfecho secundário do protocolo do V05-10. O recibo [`comparison.json`](comparison.json) guarda as 24 tentativas
> analisadas, os hashes dos recibos de entrada e os SHA-256 dos sete arquivos que o commit muda. Os arquivos desta pasta e os documentos que apontam para ela foram escritos depois e não são entrada de nenhum comando.
>
> **A redação da emenda do protocolo foi corrigida duas vezes depois, na revisão do pull request e antes de chegar à main.** Em `237b171` a regra do JSON dizia que os `x[0..n-1]` da referência ociosa eram "os tempos de CPU" dos quadros ociosos nos dois usos, mas a cláusula de ritmo compara
> a referência com o período de atualização, e a faixa janelada grava e o oráculo calcula **os intervalos decorridos entre quadros de processo**. A regra agora diz que a referência é **da mesma grandeza dos quadros com que é comparada**: o tempo de CPU por quadro (o instrumento do desfecho primário) no desfecho
> secundário do comparativo, e os intervalos entre quadros de processo na cláusula de ritmo. É a mesma emenda, com um pin só: o de `237b171` era `6e58144ece9d1c291c818d8079f883c14bd232b7154b0274c93fa683548cb2b0`, a redação intermediária (só intervalos) teve `b43c5e9a0e560879c5c67a40c92a755175a74d9bc54f96938222d986e1b3319f` e o atual é `8833e54e54718694486f626644faa4eef4adef1915f80f973d9827aa44098efb`. Nenhum número desta página mudou:
> eles vêm do código e dos recibos, não dessa redação. Os `sourcePins` do [`comparison.json`](comparison.json) seguem sendo os blobs de `237b171`, e os três arquivos do protocolo (o JSON, a nota e o teste) foram corrigidos depois.
>
> **Os recibos brutos de 2026-10-09 não estão no repositório.** Só números derivados e hashes foram guardados. Os intervalos de 2026-10-08 já estão em
> [`../frontier-baseline/windowed-raw.json`](../frontier-baseline/windowed-raw.json).

Esta fatia não mede nada do jogo nem do HUD e **não fecha nenhum critério**: ela conserta uma regra de **validade** (a faixa janelada só mede o tempo de quadro se um display apresentou a janela) que tinha
um defeito achado nas execuções de 2026-10-09, e emenda, antes de qualquer medição comparativa, o protocolo pré-registrado do V05-10 que usava a mesma referência. Os critérios `baseline` (a parte janelada), `congelado`
e `execucao` seguem como estavam.

Todo link de código abaixo está fixado em `237b171`.

## O achado

Com o vsync ligado a 120 Hz, os 600 intervalos ociosos de uma janela **que o display apresenta** vêm em dois grupos que se alternam: cerca de 300 abaixo de 4,17 ms e cerca de 300 de 12 ms ou mais. Dois vizinhos somam cerca de
16,67 ms (dois períodos de 8,33 ms) e a média dá cerca de 8,33 ms ([`frame-clock.md`](../../research/frame-clock.md) já tinha visto os aglomerados). A **mediana** dos intervalos cai num grupo ou no outro por poucas amostras, e a regra de ritmo
da faixa janelada (compartilhada pelo baseline e pelo turno) julgava um run por ela: `paced` se a mediana fosse **pelo menos metade do período de refresh lido de volta** (4,167 ms a 120 Hz).

- **Uma tentativa apresentada do baseline foi recusada como `unpaced`.** A tentativa 8 do recibo A (run 3) teve mediana de **4,136 ms, 0,031 ms abaixo** dos 4,167 ms exigidos, com média de 8,333 ms, 300 intervalos abaixo de 4,167 ms e 300 de 12 ms
  ou mais, e 5.106 de 5.110 quadros desenhados. A janela estava apresentada; a regra a recusou pela posição da mediana.
- **As execuções aceitas do turno tiveram medianas de 4,421 a 13,177 ms**, uma variação de quase três vezes sobre uma janela que se comportou da mesma forma (a média foi de 8,339 a 8,631 ms).
- **O desfecho secundário do protocolo do V05-10 herdava o problema.** "Quadros acima de 2× a mediana ociosa" usa a mesma mediana como referência: no run 3 do turno, **242 dos 360 quadros de clique** ficaram acima de 2× a mediana
  (4,421 ms) só porque a mediana caiu no grupo baixo; pela referência nova, nenhum.

## A regra nova

A **referência ociosa** é a **mediana das meias-somas de pares consecutivos**: para os intervalos `x[0..n-1]`, `median((x[i] + x[i+1]) / 2)` para `i` de 0 a `n - 2`, pelo rank mais próximo
([`idleReference`](https://github.com/journey-studios/godot-fabric/blob/237b171df846b7acf76da534730e47961a0a36e3/tests/frontier-baseline-oracle.mjs), no oráculo do baseline). `paced` se a referência for **pelo menos metade do período lido de volta**: o
limiar não muda, só a estatística.

- **Com dois grupos alternados**, cada par tem um intervalo curto e um longo e a meia-soma é cerca de um período (8,33 ms), onde quer que a mediana caia.
- **Num laço que nada freia**, a meia-soma é cerca de 0,6 ms.
- **Por que a meia-soma de pares e não a média.** Nos dados as duas dão o mesmo veredito nas 24 tentativas (tabela abaixo): a diferença é a robustez. A média sobe com **um** tranco: o run 2 do turno tem um intervalo de 52,9 ms e média de 8,601 ms contra 8,331 ms da
  meia-soma, e um laço sem ritmo (0,53 ms por quadro) com um único travamento de 5 s teria média de 8,9 ms, acima do limiar, e passaria; um tranco muda só duas meias-somas e a mediana delas não se move. O teste sintético disso está em
  [`frontier-baseline-graphics.test.mjs`](https://github.com/journey-studios/godot-fabric/blob/237b171df846b7acf76da534730e47961a0a36e3/tests/frontier-baseline-graphics.test.mjs), e quando a referência é trocada pela mediana seis casos do teste quebram, e pela média quebra o do tranco.
- **O que o código guarda.** `graphicsRunValidity` devolve `idleReferenceMs` e `minimumIdleReferenceMs` e julga `paced` por elas. Mantém `idleMedianMs` (um registro, não mais o juiz) e `minimumIdleMedianMs` (com o mesmo valor do novo
  mínimo), porque os recibos e os testes existentes os leem. A recusa continua "unpaced: the display is not presenting", e o texto de recusa diz qual valor falhou (a referência, com a mediana ao lado). O resumo de um run conta os quadros
  acima de 2× a mediana (`aboveTwiceIdleMedian`, com o sentido de sempre) **e** acima de 2× a referência (`aboveTwiceIdleReference`), no run e nos agregados entre execuções.

## As 24 tentativas, com as três estatísticas

As tentativas dos três recibos de 2026-10-09 (21: aceitas e rejeitadas) e as três do recibo de 2026-10-08 que o registro do baseline guarda. "Run, tentativa" é o run (a posição de 1 a 5) e o número da tentativa dentro da execução. Limiar: 4,167 ms. A coluna
"Regra nova" é só uma **observação**: o que a regra nova teria dito de uma tentativa julgada antes dela. **Nenhum veredito nem recibo gravado muda.**

| Recibo | Run, tentativa | Gravado | Mediana (ms) | Média (ms) | Meia-soma de pares (ms) | Abaixo / acima de meio período | Maior (ms) | Ritmo: mediana, média, meia-soma | Regra nova |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Turno (09/10) | 1, 1 | `undrawn` | 4,475 | 8,329 | 8,331 | 298 / 302 | 15,4 | sim, sim, sim | igual |
| Turno (09/10) | 1, 2 | `undrawn` | 6,874 | 6,900 | 6,902 | 0 / 600 | 7,8 | sim, sim, sim | igual |
| Turno (09/10) | 1, 3 | `accepted` | 13,177 | 8,356 | 8,331 | 299 / 301 | 18,4 | sim, sim, sim | igual |
| Turno (09/10) | 2, 4 | `accepted` | 8,495 | 8,601 | 8,331 | 285 / 315 | 52,9 | sim, sim, sim | igual |
| Turno (09/10) | 3, 5 | `accepted` | 4,421 | 8,341 | 8,338 | 298 / 302 | 16,7 | sim, sim, sim | igual |
| Turno (09/10) | 4, 6 | `accepted` | 8,130 | 8,339 | 8,335 | 292 / 308 | 17,6 | sim, sim, sim | igual |
| Turno (09/10) | 5, 7 | `undrawn` | 4,777 | 8,338 | 8,332 | 297 / 303 | 21,3 | sim, sim, sim | igual |
| Turno (09/10) | 5, 8 | `accepted` | 12,678 | 8,631 | 8,342 | 289 / 311 | 17,0 | sim, sim, sim | igual |
| Baseline A (09/10) | 1, 1 | `undrawn` | 6,888 | 6,900 | 6,901 | 0 / 600 | 7,8 | sim, sim, sim | igual |
| Baseline A (09/10) | 1, 2 | `accepted` | 4,665 | 8,334 | 8,335 | 292 / 308 | 15,9 | sim, sim, sim | igual |
| Baseline A (09/10) | 2, 3 | `undrawn` | 4,643 | 8,336 | 8,332 | 294 / 306 | 15,4 | sim, sim, sim | igual |
| Baseline A (09/10) | 2, 4 | `undrawn` | 6,894 | 6,900 | 6,900 | 0 / 600 | 7,7 | sim, sim, sim | igual |
| Baseline A (09/10) | 2, 5 | `accepted` | 11,772 | 8,386 | 8,327 | 286 / 314 | 16,6 | sim, sim, sim | igual |
| Baseline A (09/10) | 3, 6 | `undrawn` | 6,700 | 8,334 | 8,334 | 298 / 302 | 17,0 | sim, sim, sim | igual |
| Baseline A (09/10) | 3, 7 | `undrawn` | 6,893 | 6,900 | 6,900 | 0 / 600 | 7,8 | sim, sim, sim | igual |
| Baseline A (09/10) | 3, 8 | `unpaced` | 4,136 (abaixo de 4,167) | 8,333 | 8,333 | 300 / 300 | 16,3 | **não**, sim, sim | **aceita** (era `unpaced`; 5.106 de 5.110 quadros desenhados) |
| Baseline B (09/10) | 1, 1 | `accepted` | 11,548 | 8,459 | 8,338 | 243 / 357 | 16,8 | sim, sim, sim | igual |
| Baseline B (09/10) | 2, 2 | `accepted` | 5,177 | 8,333 | 8,332 | 290 / 310 | 15,4 | sim, sim, sim | igual |
| Baseline B (09/10) | 3, 3 | `undrawn` | 6,516 | 8,352 | 8,332 | 259 / 341 | 20,4 | sim, sim, sim | igual |
| Baseline B (09/10) | 3, 4 | `undrawn` | 5,211 | 8,324 | 8,331 | 274 / 326 | 18,3 | sim, sim, sim | igual |
| Baseline B (09/10) | 3, 5 | `undrawn` | 6,882 | 6,901 | 6,897 | 0 / 600 | 8,1 | sim, sim, sim | igual |
| Baseline (08/10) | 1, 1 | `unpaced` | 0,704 (abaixo de 4,167) | 0,725 | 0,706 | 598 / 2 | 4,7 | **não**, **não**, **não** | igual |
| Baseline (08/10) | 1, 2 | `unpaced` | 0,708 (abaixo de 4,167) | 0,705 | 0,710 | 599 / 1 | 4,5 | **não**, **não**, **não** | igual |
| Baseline (08/10) | 1, 3 | `unpaced` | 0,704 (abaixo de 4,167) | 0,719 | 0,704 | 598 / 2 | 4,4 | **não**, **não**, **não** | igual |

O que a tabela diz, e nada além disso:

- **A mediana é a instável.** Nas 16 tentativas de 2026-10-09 com os dois grupos, vai de 4,136 a 13,177 ms, e uma fica abaixo do limiar. A média vai de 8,324 a 8,631 ms e a meia-soma de pares de **8,327 a 8,342 ms**. As outras cinco
  tentativas do dia, de cerca de 6,9 ms, são um laço uniforme com outro ritmo (0 intervalos abaixo de 4,167 ms): as três estatísticas as aceitam quanto ao ritmo, e foram rejeitadas por `undrawn`.
- **Só uma tentativa muda de veredito: a A8**, de `unpaced` para aceita quanto ao ritmo. Ela desenhou (5.106 de 5.110 quadros, 601 desenhos na janela ociosa), então a regra nova a teria aceitado. Todas as demais ficam como
  foram julgadas: as aceitas continuam aceitas, as `undrawn` continuam `undrawn`, e as três de 2026-10-08 (0,704 a 0,710 ms) continuam recusadas pelas três estatísticas.
- **A média e a meia-soma de pares dão o mesmo veredito nas 24.** Nenhuma tentativa mostra a meia-soma falhando onde a média acerta. Só a A8 alterna os grupos de forma estrita (599 de 599 pares mistos); nas outras 15 com dois
  grupos, de 485 a 596 dos 599 pares misturam um curto e um longo, e a meia-soma ficou entre 8,327 e 8,342 ms mesmo assim.

### O desfecho secundário, pela referência

Os quadros do primeiro quadro de um clique (360 por run, 12 cliques por rodada de 30 rodadas estáveis), no turno apresentado de 2026-10-09, contados acima de 2× a mediana ociosa (a contagem do recibo, reproduzida dos intervalos brutos) e acima de
2× a referência nova:

| Run (tentativa) | Mediana ociosa (ms) | Referência ociosa (ms) | Acima de 2× a mediana | Acima de 2× a referência | p95 do clique (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 (3) | 13,177 | 8,331 | 0 | 1 | 12,480 |
| 2 (4) | 8,495 | 8,331 | 0 | 0 | 12,984 |
| 3 (5) | 4,421 | 8,338 | **242** | **0** | 13,162 |
| 4 (6) | 8,130 | 8,335 | 0 | 0 | 13,483 |
| 5 (8) | 12,678 | 8,342 | 0 | 3 | 12,610 |

Pela mediana a contagem vai de 0 a 242 de 360 em runs de uma janela que se comportou da mesma forma, e pela referência vai de 0 a 3. A segunda contagem acompanha os cliques lentos (o maior intervalo de um clique do run 1 é de 26,3 ms e o do run 5 de 22,8 ms); a primeira
acompanha onde a mediana caiu. Isto é uma observação sobre o recibo de 2026-10-09, que **não é regenerado**: ele diz 0, 0, 242, 0, 0.

## Os recibos de entrada

Os recibos brutos de 2026-10-09 ficam fora do repositório (somente leitura, no ambiente de quem os produziu). A tabela foi calculada a partir deles, e o script que a gera reproduz, a cada tentativa, a mediana, a média e o veredito
de ritmo gravados no recibo, e a contagem de 242 do run 3 do turno, antes de escrever o `comparison.json`.

| Recibo | Bytes | SHA-256 | Estado |
| --- | ---: | --- | --- |
| Turno, apresentado (09/10) | 2.380.876 | `db86eb0816f036add015022ffab74187c8debab0dc218e2bc81e4dad723cdbb5` | `presented`: 5 de 5 execuções aceitas em 8 tentativas |
| Baseline A (09/10) | 735.913 | `bada551e3014ae950cb5c2ef80e8997752fdd730184099424ed2545d587b49e1` | `not presented: unpaced: the display is not presenting (slot 3, 3 attempts)`: 2 aceitas, 6 rejeitadas |
| Baseline B (09/10) | 453.863 | `c03a9f46cf35379eb6eabc3e86e8a0960f7d52d40745db23ae4b4fcdeb2f02c4` | `not presented: undrawn: the window did not draw throughout (slot 3, 3 attempts)`: 2 aceitas, 3 rejeitadas |
| Baseline (08/10), no repositório | 65.961 | `2673a645ba67d291f1f254860fcc6422cf1723c116f4bb166be6a1e4df4c99b0` | [`windowed-raw.json`](../frontier-baseline/windowed-raw.json): 3 tentativas `unpaced` |

`verifyGraphicsReceipt` aceita os três recibos de 2026-10-09 lidos de fora do repositório (execução da fatia, sobre `237b171`): o do turno com 5 execuções aceitas, e os dois do baseline, que terminaram como não apresentados, com as 2 aceitas de cada um.

## A emenda do protocolo do V05-10

O protocolo pré-registrado ([`frontier-comparison-protocol.json`](https://github.com/journey-studios/godot-fabric/blob/237b171df846b7acf76da534730e47961a0a36e3/docs/research/frontier-comparison-protocol.json), nota
[`frontier-comparison-protocol.md`](../../research/frontier-comparison-protocol.md#amendments)) usava a mediana ociosa no desfecho secundário "quadros acima de 2× a mediana ociosa" e na cláusula de ritmo da regra de invalidação `not-presented`. Pela emenda
de **2026-10-09** (`amendments[0]` do JSON), a referência ociosa é a mediana das meias-somas de pares consecutivos dos valores por quadro dos 600 quadros ociosos, **na mesma grandeza dos quadros com que é comparada**: o tempo de CPU por quadro no desfecho secundário (o rótulo segue em tempo de CPU) e os intervalos decorridos entre quadros de processo na cláusula de ritmo, o id do desfecho vira `frames-above-twice-idle-reference`, e cinco textos do JSON mudam (`idleReference.rule`, o desfecho, o passo `idle` do
script, a regra `not-presented` e `preRegistration.amendments`). **Nenhuma medição comparativa rodou antes** (`measurementsBefore: 0`), então nenhuma execução foi feita sob o texto antigo e nenhuma precisa ser refeita.

| Estado do protocolo | SHA-256 (forma canônica, sem `frozenValue` e `frozenAt`) |
| --- | --- |
| pré-registro (commit `82f5f43`, sem emendas) | `8dd7779dd9f21386cf2e272845339c9031ceebd16cf01aa7dbec3a9d6f00353c` |
| com a emenda de 2026-10-09, na redação final (a que chega à main) | `8833e54e54718694486f626644faa4eef4adef1915f80f973d9827aa44098efb` |
| a primeira redação, em `237b171` (os `x` eram "tempos de CPU" nos dois usos); nunca chegou à main | `6e58144ece9d1c291c818d8079f883c14bd232b7154b0274c93fa683548cb2b0` |
| a redação intermediária (os `x` eram os intervalos nos dois usos); nunca chegou à main | `b43c5e9a0e560879c5c67a40c92a755175a74d9bc54f96938222d986e1b3319f` |

O teste `tests/frontier-comparison-protocol.test.mjs` guarda um pin por número de emendas: mudar o protocolo sem uma entrada em `amendments`, ou uma entrada sem o pin, ou uma entrada com `measurementsBefore` diferente de 0 enquanto o critério `execucao` do V05-10 está
aberto, falha.

## Os fontes fixados

Os SHA-256 dos sete arquivos que o commit muda, iguais aos blobs de `237b171` (conferido ao gerar o recibo; `sourcePins` do [`comparison.json`](comparison.json)):

| Arquivo | SHA-256 |
| --- | --- |
| `tests/frontier-baseline-oracle.mjs` | `4ae75068865973db6cf560c59456f754a2973b23d560b45a08be9249074af915` |
| `tests/frontier-baseline-graphics.test.mjs` | `2b505c9433654900247f6acf56d3c2ad3fcc9c674d27aa89acd0879cd7568137` |
| `scripts/frontier-baseline-graphics.mjs` | `7060c97252c1290e740fbace6cb39f53020317df023c1268900f3fcc1a6ed7a9` |
| `tests/frontier-comparison-protocol.test.mjs` | `b12181b0ff4e6aac07babab9dda7d35da6615dc4c53a342c85b48fbf9247487c` |
| `docs/research/frontier-comparison-protocol.json` | `692ee0422b71f16aaf1006382bf2dbc32a3274aabcf3b7dc94765bc662b30f56` |
| `docs/research/frontier-comparison-protocol.md` | `f5f9a04dd866c32a22736a87a7373d5429f1ec03b5c1836f14b2ee60be8c1c6c` |
| `docs/research/frontier-baseline.md` | `a6c61298132c425fbd8235f90a27fa89503d1a1e6788389d2694991d80229410` |

Os testes que cobrem a regra rodam em Node, sem Godot e sem display: [`frontier-baseline-graphics.test.mjs`](https://github.com/journey-studios/godot-fabric/blob/237b171df846b7acf76da534730e47961a0a36e3/tests/frontier-baseline-graphics.test.mjs) (16 casos: o run de dois
grupos com a mediana no grupo baixo, que agora é `paced`; o laço sem ritmo e o laço com um único tranco de 5 s, que seguem `unpaced`; um run apresentado a 60 Hz; as duas contagens de quadros acima de 2×; um recibo escrito pela referência e um recibo antigo,
sem `idleReferenceMs`, que continua sendo julgado pela mediana) e [`frontier-comparison-protocol.test.mjs`](https://github.com/journey-studios/godot-fabric/blob/237b171df846b7acf76da534730e47961a0a36e3/tests/frontier-comparison-protocol.test.mjs) (17 casos).
Os dois fazem parte do `npm run test:contracts`.

## Limites

- **Os recibos antigos não são reclassificados.** Os recibos fixados (`116a72f`, `cb50b97` e os do baseline) foram julgados pela mediana e a evidência deles diz isso. Um recibo cujas tentativas não trazem `idleReferenceMs` é julgado pelo
  `verifyGraphicsReceipt` pela mediana, como sempre foi; um recibo escrito depois desta fatia é julgado pela referência. A regra nova vale **da próxima execução em diante**; a tabela acima é uma observação.
- **A regra nova ainda não rodou numa execução real da faixa janelada.** O que a sustenta são os testes sintéticos e esta reanálise de 24 tentativas de uma máquina (Apple M3 Pro, tela embutida de 120 Hz), de dois dias, com a janela do macOS no `gl_compatibility`.
  Em outro refresh (60 Hz) só o teste sintético a cobre.
- **O script do turno segue imprimindo a contagem pela mediana.** `scripts/frontier-turn-graphics.mjs` pertence à fatia 2a do P8 (V05-05), ainda aberta, e não foi tocado: ele imprime "above 2x idle median" e, numa recusa, "idle median", ainda
  verdadeiros porque os campos antigos foram mantidos. O resumo de um recibo novo do turno já traz `aboveTwiceIdleReference` (o oráculo é compartilhado); o script passa a imprimir a contagem pela referência num PR posterior, depois do merge do P8.
- **A nota do turno ainda descreve a regra antiga.** `docs/research/frontier-turn.md` (a leitura "Reading the idle median" e a lista do que foi medido, nas linhas 329 e 391) segue dizendo que a regra de validade pede que a mediana ociosa chegue a metade do
  período. É a verdade do que foi gravado em 2026-10-09; será ajustada depois do P8, junto do script. A explicação da referência está na [nota do baseline](../../research/frontier-baseline.md) e aqui.
- **A emenda do protocolo muda também a cláusula de ritmo da regra `not-presented`.** Além do desfecho secundário que a motivou, para que o protocolo não prescreva a mediana quando o código usa a referência. A referência do comparativo (o desfecho secundário) é sobre o **tempo de CPU por quadro**, a mesma grandeza dos quadros que ela mede, e a do ritmo (a faixa janelada e a cláusula `not-presented`) é sobre os **intervalos entre quadros de processo**, que é onde o vsync
  faz os dois grupos; a meia-soma de pares serve às duas porque é robusta aos grupos e a um tranco isolado e, numa série sem grupos, dá praticamente a mediana.
- **Nada aqui é um tempo de quadro.** Os intervalos são de quadros de processo (com o vsync ligado vêm em aglomerados), não imagens que o display mostrou, e não se lê nenhum "quadro perdido" deles. Nenhum orçamento nasce desta página.
- **Nenhuma medição comparativa rodou** (`execucao` aberto) e o `congelado` do V05-06 segue sendo um ato posterior e único.

## CI hospedada e Pages

O push da `main` em `9f55644` (o squash do #94, que carrega `237b171` e as correções da revisão; run
[37960884650](https://github.com/journey-studios/godot-fabric/actions/runs/37960884650) do workflow Contracts) passou na primeira
tentativa, sem reexecução, nos três jobs que um push roda desde o #88: `contracts` (3 min), `reference-android` (6 min) e
`reference-ios` (7 min). Os outros cinco jobs do run (`native-cold-start`, `native-suites-frontier`, `native-suites-input`,
`native-suites-runtime` e `parity-comparison`) aparecem como **skipped**: desde o #88 os jobs nativos só rodam num despacho do
workflow, e esta fatia não depende deles (não muda C++, e a faixa janelada nunca roda na CI). O [recibo](hosted-ci.json), escrito por
`scripts/hosted-receipts.mjs` a partir da API do GitHub e dos logs e conferido sem rede pelo `--check` do mesmo script, registra esses
cinco como `skipped` e não como falha, e só os aceita porque a linha da fatia não tem passo nativo nem artefato. Um job pulado não tem
log: o recibo não tem checkout nem comparação de paridade deles, e prova o que os três jobs que rodaram fazem:

- **O checkout.** Os três jobs usaram `9f55644`. A árvore do head do PR (`be34540`, 7 commits) **não** é a do squash, porque o #93 entrou
  na `main` depois que o head se bifurcou: as 66 diferenças de caminho são exatamente os 66 caminhos que a `main` mudou desde então, e o
  recibo as lista.
- **O passo da guarda.** "Milestone exit guards (X9 and X10)" (passo 5 do job `contracts`, menos de 1 s) passou num `push` e imprimiu
  `MILESTONE_GUARDS_CHECK_PASSED: against e108e9d31f43 (--base e108e9d31f43f24f0c049c3454a41efe417e797b); X9 clean, X10 clean`. A base é o
  pai do squash (o #93), que o recibo confere com a API, e o X9 se aplicou (o PR acrescenta `milestone-0-5-idle-reference-490ba8c`) e
  saiu limpo: esta fatia não mexe na 1.0.
- **Os testes.** `npm run test:contracts` (passo 6, 2 min) passou com 7, 43 e 435 testes de Node e 13 de Python, `# fail 0`. O recibo
  confere, pelo nome e no log do job `contracts`, os testes de nível superior de três arquivos: `tests/frontier-baseline-graphics.test.mjs`
  (16 de 16, a regra de ritmo pela referência), `tests/frontier-comparison-protocol.test.mjs` (17 de 17, o protocolo e a emenda) e
  `tests/frontier-baseline-heap.test.mjs` (10 de 10, que importa o oráculo do baseline que a fatia muda). Os 13 de
  `tests/frontier-turn-graphics.test.mjs`, que também cobrem a regra, rodaram no mesmo job e são do recibo do [#86](../frontier-turn/hosted-ci.json).
  `check:static` e `check:publication` também passaram.

O [Pages](publication.json) rodou sobre o mesmo squash (run
[37960884718](https://github.com/journey-studios/godot-fabric/actions/runs/37960884718), 16:41:08 a 16:41:47Z, `build` e `deploy` em
success, 43 testes do painel). O deployment 6966005640 está em success, o artefato `github-pages` (id 11631313885, SHA-256
`d6e1002e…`, igual ao digest da API e ao do log de upload) tem 15 arquivos, e o `migration.json` de dentro tem os mesmos bytes do
`dashboard/migration.json` do squash (SHA-256 `d996e162…`) e a entrada de atividade `milestone-0-5-idle-reference-490ba8c`. Um push
seguinte da `main` substitui o deployment, então o site público não foi comparado.

**Continua só local** a faixa janelada, e **continuam fora do repositório** os recibos brutos de 2026-10-09 de que a reanálise parte
(aqui só estão os números derivados e os hashes; os intervalos de 2026-10-08 já estavam no repositório). A regra nova segue sem ter
rodado numa execução real da faixa janelada, porque ela nunca roda na CI. O recibo hospedado confirma que os testes da regra e do
protocolo passam num runner, e nenhum critério fecha com ele.

## Reproduzindo

```sh
node --test tests/frontier-baseline-graphics.test.mjs tests/frontier-turn-graphics.test.mjs tests/frontier-comparison-protocol.test.mjs tests/frontier-baseline-heap.test.mjs   # 56 casos, sem Godot e sem display
npm run test:contracts                                                                                                                                           # a suíte em que estes testes rodam
caffeinate -d node scripts/frontier-baseline-graphics.mjs                                                                                                        # local, display aceso: julga o ritmo pela referência e imprime as duas contagens
```
