# O instrumento de tempo de CPU do comparativo final: a verificação contra uma carga de duração conhecida

> **Registro fixado.** Os números, os fontes e os hashes abaixo são os da execução sobre o commit de implementação
> [`e38615d`](https://github.com/journey-studios/godot-fabric/commit/e38615da6ad7f9ca774e2ef8c46de33707c1b427) (árvore `825a3f4b`, sobre a main `7fb27e1`), e o recibo
> [`execution.json`](execution.json) os fixa. Os comandos rodaram nesta ordem e em sequência, com a árvore limpa (`git status` vazio antes do primeiro, depois das sabotagens e depois do último);
> os arquivos desta pasta e os documentos que apontam para eles foram escritos depois e não são entrada de nenhum comando. A [nota de pesquisa](../../research/cpu-time-instrument.md) e esta página dizem os mesmos números.

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

> **CI hospedada e Pages pendentes.** O passo `npm run test:cpu-time-instrument` e o artefato `native-cpu-time-instrument` do workflow `contracts.yml` (job `native-suites-frontier`, que só roda sob demanda, em `workflow_dispatch`) ainda não rodaram na CI hospedada, e nada foi publicado no Pages;
> os dois entram depois do merge. A faixa janelada e as sabotagens nunca rodam lá. Tudo o que esta página registra é evidência local, em macOS arm64. O recibo de fonte (que fixa o SHA-256 de cada fonte executada) não certifica nenhum build nativo, porque a fatia não usa o host.

## Reproduzindo

```sh
npm run test:cpu-time-instrument                                  # o probe headless, o oráculo e os negativos sobre o relatório gravado
node --test tests/cpu-time-instrument.test.mjs                    # o contrato em Node (parte do test:contracts)
node scripts/cpu-time-instrument-sabotage.mjs                     # as três sabotagens, fontes restaurados byte a byte; não rode outra suíte enquanto isso
node tests/cpu-time-instrument-native.test.mjs --replay=build/cpu-time-instrument-current-report.json   # julga um relatório headless gravado só com o oráculo
caffeinate -d npm run bench:cpu-time-instrument-graphics          # só local, precisa de um display acordado; sai com 3 se a janela não for apresentada
node scripts/cpu-time-instrument-graphics.mjs --replay=<relatório janelado>   # julga um relatório janelado gravado, sem janela
```

Os relatórios brutos não estão no repositório (a pasta ignora `*-report.json` e os recibos são grandes); o SHA-256 de cada um está em `artifactHashes` do recibo. O recibo da faixa janelada guarda cada quadro da execução em `raw`, e qualquer outra regra pode ser aplicada aos mesmos dados.
