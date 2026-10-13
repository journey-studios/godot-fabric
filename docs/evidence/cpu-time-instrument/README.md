# O instrumento de tempo de CPU do comparativo final: a verificação contra uma carga de duração conhecida

> **Registro fixado.** Os números, os fontes e os hashes abaixo são os da execução sobre o commit de implementação
> [`e38615d`](https://github.com/journey-studios/godot-fabric/commit/e38615da6ad7f9ca774e2ef8c46de33707c1b427) (árvore `825a3f4b`, sobre a main `7fb27e1`), e o recibo
> [`execution.json`](execution.json) os fixa. Os comandos rodaram nesta ordem e em sequência, com a árvore limpa (`git status` vazio antes do primeiro, depois das sabotagens e depois do último);
> os arquivos desta pasta e os documentos que apontam para eles foram escritos depois e não são entrada de nenhum comando. A [nota de pesquisa](../../research/cpu-time-instrument.md) e esta página dizem os mesmos números.
>
> **Correção posterior (2026-10-13).** A regra do probe e do oráculo que exigia que o termo de processo de um bloco de carga tivesse pelo menos 8 valores e não repetisse mais de 10 quadros seguidos foi **substituída** pela regra de inclusão (o termo de cada quadro contém o laço desse quadro), porque reprovava, de forma intermitente, o relógio genuíno de runners hospedados quietos. O que a tabela de sabotagens e o restante desta página dizem da "regra de variação" é o registro da execução fixada; a regra em vigor, os dados hospedados que a motivaram e as sabotagens rodadas de novo estão em [A regra do termo de processo, corrigida](#a-regra-do-termo-de-processo-corrigida-2026-10-13). O instrumento (`tests/cpu-time-instrument.gd`) não mudou.

Esta fatia é a **preparação do critério `execucao` do V05-10** do marco 0.5 Frontier: escolher, implementar e verificar, **antes de qualquer medição comparativa**, o instrumento que lê o tempo de CPU da thread principal por quadro de processo (o nome que o protocolo dá à grandeza) nos
três braços do comparativo (A sem HUD, B com o HUD nativo do Godot, C com o HUD React Native). O que ele mede é o **tempo decorrido monotônico entre ganchos do engine, na thread principal**, e não o relógio de CPU da thread no sistema operacional:
uma pausa de escalonamento dentro dos ganchos aumenta o total sem aumentar o uso de CPU da thread. O limiar `cpu-time-instrument` do [protocolo](../../research/frontier-comparison-protocol.md) pede uma leitura do lado do engine, o mesmo código nos três braços, que exclua a espera pelo display
e seja verificada dentro de 10% contra uma carga sintética de duração conhecida. A fatia entrega o instrumento ([`tests/cpu-time-instrument.gd`](../../../tests/cpu-time-instrument.gd)), a verificação (o probe, o oráculo independente, os testes e as sabotagens)
e a recomendação escrita do que congelar. **O limiar continua sem congelar** (`frozenValue: null`; o congelamento é um ato posterior, junto com os outros números), **o critério `execucao` do V05-10 continua aberto** e **nenhuma medição comparativa rodou**: nada aqui diz que o HUD React Native
é mais rápido ou mais lento que qualquer coisa. A fatia não muda C++ nem nenhum critério, peso ou denominador do 1.0.

Todo link de código abaixo está fixado no commit [`e38615d`](https://github.com/journey-studios/godot-fabric/commit/e38615da6ad7f9ca774e2ef8c46de33707c1b427). Cada fonte executada, listada em `sourcePins` do recibo (11 arquivos), tem o mesmo SHA-256 que o blob desse commit, conferido ao gerar o recibo.

| Lane executada | Resultado | Observação |
| --- | --- | --- |
| Suíte headless, 1 processo Godot, laboratório de um nó que queima um tempo conhecido | 10/10 checks do probe | 2.422 quadros; as quatro cargas (2, 5, 10 e 20 ms) lidas a **0,16% ou menos**; o oráculo independente aceita o relatório com 0 violações |
| Negativos do oráculo sobre o relatório gravado | 4 rejeitados, cada um **pela regra que o limita** | alvo 15% fora; intervalo no lugar do CPU; carga fora do quadro; amostra faltando |
| Teste de contrato em Node (`tests/cpu-time-instrument.test.mjs`, no `test:contracts`) | 18/18 | o oráculo sobre relatórios sintéticos: aceita os bons e recusa os mutados |
| Sabotagem `reads-interval` | rejeitada | 5 checks do probe; oráculo: a regra do CPU contra o intervalo |
| Sabotagem `load-outside-frame` | rejeitada | 5 checks do probe; oráculo: a regra dos 10% |
| Sabotagem `reads-monitor` | rejeitada | 6 checks do probe; oráculo: a regra do CPU e a de variação |
| Faixa janelada (uma execução, `caffeinate -d`), janela do macOS | **APRESENTADA, código de saída 0** | vsync `enabled`, 120 Hz; a janela desenhou 600 de 600 quadros ociosos; as quatro cargas lidas a **1,5% ou menos**; o pulso de render caiu no lag 6 |
| Host anterior | **N/A** | A fatia não muda C++ e o instrumento roda sem o host Fabric: não há host a comparar; o controle são as três sabotagens |

**Ambiente**: macOS 26.6.2 (25G83) arm64 num Apple M3 Pro (`Mac15,6`, 11 núcleos lógicos, 18 GB); Godot oficial 4.7.2 (`ed1daf0bf`) e Node v22.23.3. A suíte roda em modo headless (`opengl3` nomeado, sem display; o laço é paceado por um sono de 6,9 ms);
a faixa janelada, numa janela de 640 × 360 no `gl_compatibility` (adaptador "Apple M3 Pro", tela embutida "Color LCD", 1512 × 982 pontos, 3024 × 1964 pixels, 120 Hz), com o vsync lido da janela como `enabled` e o modelo de thread de render `1` (o padrão: o draw roda na thread principal).
A fatia não usa o host nativo nem React Native.

**Carga do sistema**. O Mac não estava ocioso: outros agentes rodavam trabalho ao mesmo tempo, na mesma máquina. O `vm.loadavg` (média de 1 minuto, primeira coluna) antes e depois de cada comando:

| Comando | `vm.loadavg` antes | depois | Duração |
| --- | --- | --- | ---: |
| `npm run test:cpu-time-instrument` | `{ 8.41 9.11 8.07 }` | `{ 9.91 9.44 8.22 }` | 21,2 s (o processo do probe: 20,1 s) |
| `node scripts/cpu-time-instrument-sabotage.mjs` | `{ 8.84 9.23 8.16 }` | `{ 6.30 8.37 7.93 }` | 82,0 s (quatro processos do probe de 20,1 s cada: três variantes e uma rodada genuína) |
| `caffeinate -d npm run bench:cpu-time-instrument-graphics` | `{ 6.02 8.24 7.89 }` (a faixa leu `{ 6.09 8.22 7.88 }`) | `{ 5.46 7.90 7.77 }` | 27,7 s |
| `node --test tests/cpu-time-instrument.test.mjs` | `{ 5.62 7.25 7.54 }` | `{ 5.62 7.25 7.54 }` | 0,25 s |

A média de 1 minuto ficou entre 5,5 e 9,9 em 11 núcleos lógicos, **acima do limite de 2,0 que o protocolo põe para uma execução comparativa**. Isto é uma autoverificação do instrumento e não uma campanha: as leituras estão registradas e nada é omitido.
O relógio do instrumento é o monotônico, e uma thread que o sistema desagendou entre dois carimbos conta esse tempo; as medianas absorvem isso (as cargas foram lidas a 0,16% ou menos headless, na máquina carregada), mas o piso ocioso e a cauda dependem do estado da máquina.

Os comandos, na ordem em que rodaram:

```sh
npm run test:cpu-time-instrument                                      # a suíte headless, 21 s, saiu com 0
node scripts/cpu-time-instrument-sabotage.mjs                         # as três sabotagens e uma rodada genuína, 82 s, saiu com 0
caffeinate -d npm run bench:cpu-time-instrument-graphics              # a faixa janelada, 28 s, saiu com 0: apresentada
node --test tests/cpu-time-instrument.test.mjs                        # o contrato em Node, 18/18
```

## O que o engine oferece (resumo)

Lido do tag `4.7.2-stable` (o commit `ed1daf0bf` do binário) e observado no binário; as linhas de fonte completas estão na [nota de pesquisa](../../research/cpu-time-instrument.md#what-the-engine-offers).

| Leitura | O que mede | Que quadro descreve | Espera pelo display |
| --- | --- | --- | --- |
| `Performance.get_monitor(TIME_PROCESS)` | o **máximo**, no último segundo, do tempo de antes de `MainLoop::process` a depois de `RenderingServer::draw` | **um valor por segundo** | **dentro**, com o vsync ligado (o draw termina no swap) |
| `Performance.get_monitor(TIME_PHYSICS_PROCESS)` | o máximo do tempo de uma iteração de física | um valor por segundo | fora |
| `viewport_get_measured_render_time_cpu` | os carimbos de CPU do render da viewport, em ms | um draw **6 draws antes** (medido) | fora: termina antes do blit e do swap |
| `RenderingServer.get_frame_setup_time_cpu` | os updates de cena e canvas antes do render | o draw recém-concluído | fora |
| `Time.get_ticks_usec` | o relógio monotônico em µs (`mach_absolute_time`): tempo decorrido, **não** a CPU da thread | o instante da chamada | depende de onde é chamado |

Por isso o instrumento **não** lê `TIME_PROCESS` por quadro, como a spec supunha: carimba o relógio nos ganchos do engine (`process_frame`, `frame_pre_draw`, `frame_post_draw`, `physics_frame`) e soma os termos que terminam antes do quadro ser apresentado.

## A fórmula do total

Por quadro de processo, em milissegundos:

```
physics_ms = physics_frame até o último _physics_process        (0 se a iteração não tem passo de física)
process_ms = process_frame até frame_pre_draw                   (quadro sem draw: até o último _process)
setup_ms   = get_frame_setup_time_cpu() do draw do quadro, lido em frame_post_draw          (0 sem draw)
render_ms  = viewport_get_measured_render_time_cpu() do draw do quadro, lido 6 draws depois (0 sem draw)
total_ms   = physics_ms + process_ms + setup_ms + render_ms
```

Os quatro termos excluem a espera do vsync **por construção**: nenhum atravessa o `end_frame` e o swap, que é onde o display bloqueia. Headless não há draw: `setup_ms` e `render_ms` são 0 e o total é `physics_ms + process_ms`.
**A regra dos 10%**: com `base` a mediana de `total_ms` nos quadros medidos de todos os blocos ociosos, para cada alvo T, `| mediana(total_ms nos quadros medidos do bloco de T) − base − T | ≤ 0,1 · T`. A verdade de campo é a duração do laço medida em cada quadro com `Time.get_ticks_usec`; a mediana tem de ser T a 1%.

## O alvo contra o lido

O laboratório queima T ms em cada quadro de um bloco de 200 quadros medidos (precedidos de 10 quadros de assentamento, registrados e não julgados), com um bloco ocioso de 200 depois de cada carga e um bloco ocioso inicial de 600. Lido = mediana do total do bloco menos a base; o erro é contra o alvo, e a verdade de campo (a mediana do laço medida com `ticks_usec`) foi o próprio alvo, ao microssegundo, nas oito séries.

| Alvo | Headless: lido | erro | Janela: lido | erro |
| ---: | ---: | ---: | ---: | ---: |
| 2 ms | 2,000 | 0,00% | 2,030 | +1,50% |
| 5 ms | 4,992 | −0,16% | 5,004 | +0,08% |
| 10 ms | 9,993 | −0,07% | 10,015 | +0,15% |
| 20 ms | 19,995 | −0,02% | 20,044 | +0,22% |

A rodada genuína que fecha o script de sabotagens é um segundo relatório headless, e leu 2,002, 5,000, 9,999 e 20,0085 ms (+0,10%, 0,00%, −0,01% e +0,04%).

**As bases ociosas** (mediana do total nos quadros medidos de todos os blocos ociosos, que é o piso do instrumento: o custo dos carimbos e, na janela, do render de uma cena vazia):

| Faixa | Base (mediana) | p95 | Intervalo ocioso de referência (`idleReference`) | Parte do intervalo |
| --- | ---: | ---: | ---: | ---: |
| Headless | 0,014 ms | 0,037 ms | 6,899 ms | 0,2% |
| Janela, 120 Hz | 0,082 ms | 0,125 ms | 8,336 ms (período de 8,333 ms) | 0,98% |

A referência ociosa é a mediana das meias-somas dos pares consecutivos dos 600 intervalos ociosos, importada de `tests/frontier-baseline-oracle.mjs`; a regra do CPU pede que o total ocioso seja no máximo 25% (mediana) e 50% (p95) dela.
A faixa janelada só vale se a janela desenhou 9 em 10 dos quadros ociosos (desenhou 600 de 600) e a referência ociosa for pelo menos metade do período de atualização lido (4,17 ms a 120 Hz); esta foi apresentada.

## Por que as alternativas não servem

Medianas dos quadros medidos de cada bloco, em milissegundos: o **intervalo** entre os inícios de dois quadros de processo, o **`TIME_PROCESS`** do engine e o **total** do instrumento.

| Bloco | Headless: intervalo | Headless: `TIME_PROCESS` | Headless: total | Janela: intervalo | Janela: `TIME_PROCESS` | Janela: total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| idle-0 | 6,872 | 0,288 | 0,018 | 9,378 | 15,325 | 0,083 |
| load-2 | 6,892 | 0,221 | 2,014 | 11,040 | 16,802 | 2,112 |
| idle-1 | 6,899 | 2,052 | 0,010 | 7,046 | 49,529 | 0,076 |
| load-5 | 6,899 | 0,570 | 5,006 | 5,896 | 14,647 | 5,086 |
| idle-2 | 6,832 | 5,950 | 0,015 | 5,918 | 13,992 | 0,081 |
| load-10 | 10,019 | 10,041 | 10,007 | 10,785 | 15,425 | 10,097 |
| idle-3 | 6,896 | 10,040 | 0,007 | 8,280 | 13,776 | 0,078 |
| load-20 | 20,026 | 20,075 | 20,009 | 20,864 | 21,018 | 20,126 |
| idle-4 | 6,891 | 20,020 | 0,009 | 4,998 | 28,185 | 0,092 |

O que a tabela mostra, e nada além: headless o **intervalo** não vê as cargas de 2 e 5 ms (o sono do laço as esconde: 6,89 ms ocioso e 6,89 e 6,90 nos blocos de carga); numa janela ele é o agrupamento do display e oscila de 5,0 a 9,4 ms nos blocos ociosos com o mesmo trabalho ocioso.
O **`TIME_PROCESS`** está um segundo atrás (um bloco de carga começa com o máximo do bloco anterior: 0,22 ms no `load-2` e 10,04 ms no `idle-3`) e numa janela vale 14 a 16 ms (e 28 e 50 em dois blocos) para um quadro **ocioso**, porque guarda o swap, onde o instrumento lê 0,08 ms.
O instrumento lê a carga.

## O pulso de render e o lag

Na janela, um item de canvas de 30.000 retângulos aparece por um quadro a cada 11, em draws conhecidos (22 pulsos julgados, depois de 2 de aquecimento). A leitura do render de um draw chega **6 draws depois**: o ganho da leitura no draw do pulso mais o lag, sobre as demais, por lag em draws (0 a 10), em ms:

| Lag | 0 | 1 | 2 | 3 | 4 | 5 | **6** | 7 | 8 | 9 | 10 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Ganho | 0,003 | −0,0035 | −0,0035 | −0,0045 | −0,0015 | −0,0015 | **1,069** | 0,0115 | −0,0015 | −0,0055 | −0,0045 |

O oráculo exige que o maior ganho esteja no lag 6, com pelo menos 0,3 ms, e que nenhum outro lag chegue a um quarto dele: é o que mostra que o termo responde a uma carga de render e que o alinhamento está certo. O 6 não é suposição: o código só diz que o renderer GLES3 guarda seus carimbos num ring de 3 quadros; o número é o que se mede, a cada rodada janelada.

## As sabotagens

`node scripts/cpu-time-instrument-sabotage.mjs`, sozinho, quebra um fonte de propósito, roda a suíte headless sobre ele (`--sabotage=<nome>`) e exige que as checagens do probe e o oráculo independente rejeitem o relatório. Os fontes voltaram byte a byte (SHA-256 igual antes e depois, no recibo) e o script terminou com uma rodada da fonte genuína, que passou.
O arquivo de veredito de cada variante é apagado antes de rodá-la e um arquivo ausente conta como não rejeitada.

| Variante | O que quebra | Probe | Primeira razão do oráculo |
| --- | --- | --- | --- |
| `reads-interval` | o termo de processo é o intervalo entre quadros | 5 checks (as quatro regras de acurácia e a do CPU) | a regra do CPU: "The idle total is a small part of the idle interval: the instrument reads CPU time and not the interval between frames (median 6.8905 ms and p95 9.2 ms against an idle interval reference of 6.9 ms)"; o monitor do engine também a acusa (19 de 19 janelas abaixo do instrumento) |
| `load-outside-frame` | a carga roda de um handler de `process_frame` ligado antes do instrumento, e termina antes do relógio dele começar | 5 checks (as quatro de acurácia e a de variação) | a regra dos 10%: "within 10% of the 2 ms load: it read -0.001 ms (-100.05%)"; o monitor do engine vê a carga e o instrumento não (5,58 ms acima, na mediana) |
| `reads-monitor` | o termo de processo é o `Performance.TIME_PROCESS` | 6 checks (as quatro de acurácia, a do CPU e a de variação) | a regra do CPU (a mediana ociosa foi 2,091 ms e o p95 21,405 ms contra 6,903 ms); a de variação (2 a 5 valores, até 127 quadros iguais seguidos) |

O oráculo nomeia, de cada variante, toda regra que ela quebra (6 a 11 violações); o recibo guarda o texto de todas. Os hashes dos fontes sabotados estão em `sabotages[].sourceSha256`.

## A regra do termo de processo, corrigida (2026-10-13)

### O que falhou

Desde o #97, o `npm run test:cpu-time-instrument` do job `native-suites-frontier` (sob demanda, `workflow_dispatch`) reprovava de vez em quando **um** check do probe, `cpu/The process term changes from frame to frame in the load blocks, as a clock does and a monitor refreshed once a second does not` (`tests/cpu-time-instrument-probe.gd`; a mesma regra no oráculo, `tests/cpu-time-instrument-oracle.mjs`): em cada bloco de carga o termo de processo tinha de tomar pelo menos 8 valores e não podia repetir mais de 10 quadros seguidos. A regra existia para recusar a sabotagem `reads-monitor` (o termo lido do `Performance.TIME_PROCESS`, que o engine atualiza uma vez por segundo). Duas execuções hospedadas reprovaram só esse check, e a nova tentativa, com o mesmo código, passou:

| Run (tentativa) | Job / artefato | Código | Bloco que reprovou | Valores distintos | Maior repetição | Valor mais comum |
| --- | --- | --- | --- | ---: | ---: | --- |
| [38403991586](https://github.com/journey-studios/godot-fabric/actions/runs/38403991586) (1), 13:50Z | job 115322659613 / artefato 11819951214 | `9ad524b` | 10 ms | 27 | **12** | 10,001 ms em 63 de 200 quadros (32%) |
| [38473856206](https://github.com/journey-studios/godot-fabric/actions/runs/38473856206) (1), 22:26Z | job 115564192080 / artefato 11856345204 | `9cdae80` | 10 ms | 23 | **12** | 10,001 ms em 118 de 200 quadros (59%) |

Nenhuma das duas mexia no instrumento, e nos dois relatórios as quatro cargas foram lidas dentro de 0,4% (+0,10%, −0,38%, −0,21% e −0,08% no primeiro; +0,05%, −0,36%, −0,21% e −0,10% no segundo). A nova tentativa do primeiro (14:23Z, job 115338275328) e a do segundo (23:01Z, job 115577319014) passaram. O [registro da entrada do Frontier](../../research/frontier-comparison-entry.md) já anotava a mesma reprovação numa execução manual do probe Release (18 valores, 12 quadros iguais) e a atribuiu à carga da máquina; os dados hospedados mostram que a regra reprova também num runner quieto.

### Por que um relógio genuíno repete o valor

Num bloco de carga o laço de `burn_for` sai no primeiro carimbo de `Time.get_ticks_usec` que alcança o início mais T, e o relógio anda em microssegundos: o laço mede **exatamente T µs** em 94,6% a 99,5% dos quadros dos 20 relatórios (`burnUsec`). O termo de processo é o laço mais o resto do passo (do carimbo de `process_frame` até o laço, e do laço até o carimbo que fecha o passo), que são poucos microssegundos, quantizados em 1 µs. Em bloco de runner quieto o resto é 1 µs em quase todo quadro (a mediana foi de 1 µs no bloco de 10 ms da run 38473856206, tentativa 1), então o termo é **um valor só**, 10,001 ms, por longas sequências. Contar valores e repetições mede o ruído e o ritmo do runner, e não a propriedade que a regra queria garantir; as 18 execuções que passaram tiveram, no pior bloco, 16 valores distintos e uma repetição de até 6 quadros, a 4 quadros do limite, e as duas que reprovaram, 12.

### A regra em vigor: inclusão

Em **todo** quadro de um bloco de carga (os de assentamento também, o laço roda neles), o termo de processo é, no mínimo, o laço que **esse quadro** rodou, como o relógio do engine o mediu: `round(processMs · 1000) ≥ burnUsec` (os carimbos são inteiros em µs). O laço roda entre o carimbo que abre o passo (`process_frame`) e o que o fecha (`frame_pre_draw` ou o último `_process`), então uma leitura desse passo o contém, ao microssegundo, em qualquer runner e em qualquer ritmo. Um monitor que o engine atualiza uma vez por segundo não o contém: todo bloco começa com o valor do segundo anterior, tomado antes de a carga existir, e os alvos crescem de bloco em bloco depois de um bloco ocioso.

A regra **não conta quadros**: compara cada quadro com a carga que ele mesmo rodou, tirada do relatório, e por isso não depende de ritmo, segmentação, ruído nem resolução do relógio. A repetição e o número de valores distintos seguem no relatório (`summary.processTermVariation` no probe e `variation` no veredito do oráculo), como observação e não como juízo. A regra dos 10%, a do CPU, a do monitor do engine e a aritmética não mudaram. Probe e oráculo aplicam a mesma regra, cada um do seu lado; o oráculo a expõe como `loadInclusion`.

### O que os relatórios hospedados mostram

Os 20 artefatos `native-cpu-time-instrument` que o GitHub ainda servia em 2026-10-13 (18 que passaram e os 2 que reprovaram), baixados cada um para um diretório novo e lidos como dado, sem executar nada deles. Para cada relatório: a regra retirada (a maior repetição e o menor número de valores distintos entre os quatro blocos), a regra nova (a menor margem entre o termo e o laço, em µs, entre os 840 quadros de carga) e a sabotagem `reads-monitor` refeita sobre o mesmo relatório (o termo trocado pela coluna `monitorMs`, que é o `TIME_PROCESS` lido no início de cada quadro): o menor número de quadros mais curtos que o próprio laço em um bloco.

| Run (tentativa) | Artefato criado (UTC) | Job | Maior repetição | Menos valores | Menor margem | Quadros curtos com o monitor (mínimo por bloco) |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| [37995325873](https://github.com/journey-studios/godot-fabric/actions/runs/37995325873) | 2026-10-09 22:14:42 | passou | 3 | 41 | 2 µs | 12 |
| [38018685996](https://github.com/journey-studios/godot-fabric/actions/runs/38018685996) | 2026-10-10 03:25:10 | passou | 3 | 40 | 1 µs | 15 |
| [38027051145](https://github.com/journey-studios/godot-fabric/actions/runs/38027051145) | 2026-10-10 05:49:04 | passou | 2 | 51 | 6 µs | 7 |
| [38034333213](https://github.com/journey-studios/godot-fabric/actions/runs/38034333213) | 2026-10-10 07:53:05 | passou | 5 | 32 | 0 µs | 12 |
| [38044068758](https://github.com/journey-studios/godot-fabric/actions/runs/38044068758) | 2026-10-10 10:44:05 | passou | 3 | 49 | 1 µs | 10 |
| [38053834754](https://github.com/journey-studios/godot-fabric/actions/runs/38053834754) | 2026-10-10 13:25:18 | passou | 6 | 16 | 1 µs | 17 |
| [38061098705](https://github.com/journey-studios/godot-fabric/actions/runs/38061098705) | 2026-10-10 15:18:39 | passou | 4 | 48 | 0 µs | 7 |
| [38063477166](https://github.com/journey-studios/godot-fabric/actions/runs/38063477166) | 2026-10-10 15:52:33 | passou | 3 | 48 | 2 µs | 1 |
| [38067347088](https://github.com/journey-studios/godot-fabric/actions/runs/38067347088) | 2026-10-10 16:52:40 | passou | 5 | 19 | 0 µs | 7 |
| [38068936447](https://github.com/journey-studios/godot-fabric/actions/runs/38068936447) | 2026-10-10 17:19:06 | passou | 3 | 52 | 6 µs | 7 |
| [38071954457](https://github.com/journey-studios/godot-fabric/actions/runs/38071954457) | 2026-10-10 18:02:09 | passou | 3 | 49 | 3 µs | 7 |
| [38074493966](https://github.com/journey-studios/godot-fabric/actions/runs/38074493966) | 2026-10-10 19:04:34 | passou | 4 | 31 | 1 µs | 1 |
| [38076585188](https://github.com/journey-studios/godot-fabric/actions/runs/38076585188) | 2026-10-10 19:08:33 | passou | 4 | 38 | 1 µs | 18 |
| [38082593709](https://github.com/journey-studios/godot-fabric/actions/runs/38082593709) | 2026-10-10 20:39:17 | passou | 3 | 55 | 1 µs | 35 |
| [38085526897](https://github.com/journey-studios/godot-fabric/actions/runs/38085526897) | 2026-10-10 21:23:52 | passou | 4 | 45 | 2 µs | 5 |
| [38403991586](https://github.com/journey-studios/godot-fabric/actions/runs/38403991586) (1) | 2026-10-13 13:50:50 | **reprovou** | **12** | 27 | 1 µs | 45 |
| [38403991586](https://github.com/journey-studios/godot-fabric/actions/runs/38403991586) (2) | 2026-10-13 14:23:25 | passou | 3 | 49 | 1 µs | 1 |
| [38459689769](https://github.com/journey-studios/godot-fabric/actions/runs/38459689769) | 2026-10-13 20:35:49 | passou | 4 | 37 | 2 µs | 5 |
| [38473856206](https://github.com/journey-studios/godot-fabric/actions/runs/38473856206) (1) | 2026-10-13 22:26:38 | **reprovou** | **12** | 23 | 0 µs | 36 |
| [38473856206](https://github.com/journey-studios/godot-fabric/actions/runs/38473856206) (2) | 2026-10-13 23:01:19 | passou | 4 | 37 | 0 µs | 4 |

- **A regra nova aceita os 20 relatórios**, os dois que a regra retirada recusou entre eles, inteiros: o oráculo completo (estrutura, aritmética, monitor do engine, as quatro cargas) não dá nenhuma violação em nenhum. Em nenhum dos 16.800 quadros de carga (20 relatórios × 4 blocos × 210 quadros) o termo ficou abaixo do laço; a margem mínima é **0 µs** (em 5 dos 20), por isso a regra é `≥` e não `>`.
- **A sabotagem do monitor é recusada nos quatro blocos de carga de cada um dos 20 relatórios.** O primeiro quadro de todo bloco (80 de 80) lê o monitor do segundo anterior, mais curto que o laço desse quadro, e nenhum ponto de atualização do monitor esconde isso, porque o valor que o primeiro quadro lê foi fixado antes de a carga começar. Entre 1 e 126 quadros por bloco ficam abaixo do laço.
- O probe e o oráculo usam a coluna do termo que o instrumento **reporta**, e não os carimbos: a sabotagem `reads-monitor` troca só o termo, e é ele que a regra julga (a aritmética do oráculo, que compara o termo com os carimbos, fica como segunda barreira).

### Os dados no repositório e o teste

Os relatórios brutos não estão no repositório (ver "Reproduzindo"). O que a regra lê deles, só as colunas necessárias dos quatro blocos de carga, está em [`tests/fixtures/cpu-time-instrument-hosted/load-blocks.json`](../../../tests/fixtures/cpu-time-instrument-hosted/load-blocks.json) (67 KB): por quadro o laço (`burnUsec`), o termo em µs acima do laço e o `monitorMs` em µs, e por relatório o run, a tentativa, o artefato, o commit e o SHA-256 do relatório original, para conferir uma nova baixada. O teste [`tests/cpu-time-instrument-hosted.test.mjs`](../../../tests/cpu-time-instrument-hosted.test.mjs) (no `test:contracts`) refaz a regra retirada sobre eles e confere que ela recusa exatamente os dois que a CI recusou; roda `loadInclusion` do oráculo e exige que aceite os 20 e recuse a leitura do monitor em todos os blocos de todos; e exige que uma série atualizada uma vez por segundo, em períodos de 37, 100 e 150 quadros e com a atualização caindo em qualquer quadro do bloco, seja recusada. `tests/cpu-time-instrument.test.mjs` ganhou o relatório sintético de um runner sem ruído (o termo é um valor só nos 200 quadros de cada bloco e o oráculo o aceita) e a recusa de um termo mais curto que o próprio laço mesmo dentro dos 10%.

### As sabotagens depois da correção

`node scripts/cpu-time-instrument-sabotage.mjs` rodou de novo sobre o probe e o oráculo novos (os fontes voltaram byte a byte; a rodada genuína no fim passou, código de saída 0). As três continuam recusadas pelo probe e pelo oráculo, e a de motivação desta regra, `reads-monitor`, é recusada **por esta regra** além das outras:

| Variante | Probe | Primeira razão do oráculo | Regra de inclusão |
| --- | --- | --- | --- |
| `reads-interval` | 6 checks (as quatro de acurácia, a do CPU e a de inclusão) | a regra do CPU (mediana 6,86 ms e p95 9,594 ms contra 6,911 ms) | recusa 1 quadro de 210 nos blocos de 10 e 20 ms (o intervalo foi menor que o laço) |
| `load-outside-frame` | 5 checks (as quatro de acurácia e a de inclusão) | a regra dos 10% (leu −0,014 ms, −100,7%) | recusa os 210 quadros dos quatro blocos: o laço rodou antes do carimbo que abre o passo |
| `reads-monitor` | 6 checks (as quatro de acurácia, a do CPU e a de inclusão) | a regra do CPU (mediana 5,03 ms e p95 20,028 ms contra 6,928 ms) | recusa 2, 135, 3 e 25 quadros de 210 nos blocos de 2, 5, 10 e 20 ms |

O oráculo nomeia 9, 9 e 11 violações, respectivamente. Um negativo a mais, sobre o relatório gravado (`reportLevelNegatives` do `build/cpu-time-instrument-comparison.json`), faz o primeiro quadro de cada bloco de carga ler o segundo anterior e deixa os outros como estão: só a regra de inclusão o acusa (a mediana, o total ocioso e a regra dos 10% não o veem). Localmente, em macOS arm64 com o Godot 4.7.2, o `npm run test:cpu-time-instrument` passou 8 vezes seguidas, fora a rodada genuína do script de sabotagens; nas 6 em que o relatório foi lido, a menor margem do termo sobre o laço ficou entre 0 e 3 µs por bloco e a maior repetição entre 2 e 5 quadros.

### O que isto não muda

O instrumento é o mesmo `.gd`; a regra dos 10% e a verdade de campo (o laço, a 1%) são as mesmas; o limiar `cpu-time-instrument` segue sem congelar; o critério `execucao` e o resto do V05-10 seguem abertos; nenhum checkpoint, peso ou denominador do 1.0 muda. A faixa janelada usa a mesma regra de inclusão (o termo de um quadro que desenha vai até `frame_pre_draw`, depois do último `_process`). Uma rodada local dela (`caffeinate -d npm run bench:cpu-time-instrument-graphics`, 120 Hz, vsync `enabled`) foi **apresentada** e passou: a menor margem foi de 3 a 5 µs por bloco, sem nenhum quadro mais curto que o laço; o resultado não entra nas tabelas fixadas acima.

## O que a fatia recomenda congelar

A recomendação completa está na [nota de pesquisa](../../research/cpu-time-instrument.md#what-cpu-time-instrument-should-freeze); o resumo: a quantidade (o total acima), a leitura (os carimbos e as duas APIs de render, **não** `TIME_PROCESS`), o alinhamento (6 draws, juntados por índice de draw), o erro observado
(até 0,16% headless e 1,5% numa janela apresentada, contra os 10%) e a autoverificação como portão (o `.gd` byte a byte o mesmo, e o probe e o oráculo de novo na máquina, no engine e no renderer da campanha). O congelamento é um ato posterior.

## Limites

- **Relógio monotônico, não a CPU da thread.** `Time.get_ticks_usec` é tempo decorrido; Godot não expõe o relógio de CPU da thread a scripts. Uma thread desagendada entre dois carimbos conta esse tempo. O que ficou de fora do total (o trabalho de `MainLoop::process` antes do sinal,
  o passo do servidor de física, blits, `end_frame` fora o swap, hooks de `frame()`, áudio e o atraso do quadro) é o mesmo nos três braços.
- **Carga alta de outros agentes.** A média de 1 minuto ficou entre 5,5 e 9,9 em 11 núcleos lógicos, acima do limite de 2,0 do protocolo para uma execução comparativa; os números são uma linha de base desta máquina **como ela estava**. O erro de 1,5% na carga de 2 ms da janela é, em boa parte, o piso ocioso (0,082 ms, 4% de 2 ms) somado ao ruído do termo de render.
- **O render só foi exercitado num laboratório**: um item de canvas de 30.000 retângulos, na Compatibility do macOS, uma tela e um modo de vsync (o padrão). Não leu o jogo Frontier nem HUD algum; o lag de 6 draws é propriedade do renderer, da plataforma e da versão do engine.
- **O limiar `cpu-time-instrument` não está congelado** (`frozenValue: null`); o critério `execucao`, o `protocolo` e o `braco-b` do V05-10 seguem abertos, e nenhuma medição comparativa rodou.
- **Os braços e o iPhone seguem abertos.** O instrumento ainda não está ligado em A, B nem C (o B nem existe); o iPhone depende do GO ou NO-GO do V05-09; a faixa `unlimited` (vsync desligado) e o modelo de thread de render separada não rodaram (o oráculo recusa o segundo).
- Quadros perdidos com o vsync ligado seguem abertos, como no protocolo.

## CI hospedada e Pages

O push da `main` em `c57f9f6` (o squash do #97; run [37977034583](https://github.com/journey-studios/godot-fabric/actions/runs/37977034583) do workflow Contracts) passou na primeira tentativa, sem reexecução, nos três jobs que um push roda desde o #88: `contracts` (cerca de 2 minutos), `reference-android` e `reference-ios`. Os outros cinco (`native-cold-start`, `native-suites-frontier`, `native-suites-input`, `native-suites-runtime` e `parity-comparison`) aparecem como **skipped**. O [recibo](hosted-ci.json) registra esses cinco como `skipped` e não como falha, e só os aceita porque a linha da fatia não tem passo nativo nem artefato.

**O passo nativo `npm run test:cpu-time-instrument` não rodou na CI hospedada.** Ele está no job `native-suites-frontier` do `contracts.yml`, que só roda sob demanda (`workflow_dispatch`); o push o pulou, e por isso não há artefato `native-cpu-time-instrument` nem passo nativo no recibo. **As faixas headless e janelada seguem como evidência local**, em macOS arm64: a janelada nunca roda na CI, e as sabotagens também não. O recibo de fonte (que fixa o SHA-256 de cada fonte executada) não certifica nenhum build nativo, porque a fatia não usa o host.

O que o run prova, conferido pelo `--check` do script e pelos logs:

- **O checkout.** Os três jobs que rodaram usaram `c57f9f6`. A árvore do head do PR (`f83a598`, 5 commits) é a mesma do squash (`4a60d03`).
- **O passo da guarda.** "Milestone exit guards (X9 and X10)" (passo 5 do job `contracts`) passou num push e imprimiu `MILESTONE_GUARDS_CHECK_PASSED: against 7fb27e12a473 (--base 7fb27e12…); X9 clean, X10 clean`. A base é o pai do squash.
- **Os testes.** `npm run test:contracts` (passo 6) passou com 7, 43 e 456 testes de Node e 13 de Python, `# fail 0`. O recibo confere, pelo nome e no log do job `contracts`, os 19 testes de nível superior de `tests/cpu-time-instrument.test.mjs`: 19 de 19. `check:static` e `check:publication` também passaram (1.914 arquivos).

O [Pages](publication.json) rodou sobre o mesmo squash (run [37977034484](https://github.com/journey-studios/godot-fabric/actions/runs/37977034484), `build` e `deploy` em success, 43 testes do painel). O deployment 6968692573 está em success, o artefato `github-pages` (id 11639751731, SHA-256 `8ca7720c…`, igual ao digest da API e ao do log de upload) tem 15 arquivos, e o `migration.json` de dentro tem os mesmos bytes do `dashboard/migration.json` do squash (SHA-256 `14511eeb…`) e a entrada de atividade `milestone-0-5-v05-10-cpu-instrument-dad0db1`. Um push seguinte da `main` substitui o deployment, então o site público não foi comparado.

O recibo hospedado confirma que os 19 testes de contrato do oráculo e do instrumento passam num runner. Nenhum critério fecha com ele: `execucao` segue aberto e o limiar `cpu-time-instrument` segue sem congelar.

## Reproduzindo

```sh
npm run test:cpu-time-instrument                                  # o probe headless, o oráculo e os negativos sobre o relatório gravado
node --test tests/cpu-time-instrument.test.mjs                    # o contrato em Node (parte do test:contracts)
node --test tests/cpu-time-instrument-hosted.test.mjs             # a regra de inclusão sobre os 20 relatórios hospedados extraídos (parte do test:contracts)
node scripts/cpu-time-instrument-sabotage.mjs                     # as três sabotagens, fontes restaurados byte a byte; não rode outra suíte enquanto isso
node tests/cpu-time-instrument-native.test.mjs --replay=build/cpu-time-instrument-current-report.json   # julga um relatório headless gravado só com o oráculo
caffeinate -d npm run bench:cpu-time-instrument-graphics          # só local, precisa de um display acordado; sai com 3 se a janela não for apresentada
node scripts/cpu-time-instrument-graphics.mjs --replay=<relatório janelado>   # julga um relatório janelado gravado, sem janela
```

Os relatórios brutos não estão no repositório (a pasta ignora `*-report.json` e os recibos são grandes); o SHA-256 de cada um está em `artifactHashes` do recibo. O recibo da faixa janelada guarda cada quadro da execução em `raw`, e qualquer outra regra pode ser aplicada aos mesmos dados.
