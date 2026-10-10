# O congelamento do orçamento de desempenho (V05-06) e dos limiares do protocolo (V05-10): um ato, em 2026-10-10

> **Registro fixado.** Os números, as entradas e os hashes abaixo são os do commit de implementação
> [`a6210dc`](https://github.com/journey-studios/godot-fabric/commit/a6210dc2c09ca63155511f36898f72fc56385798), de 2026-10-10, e os arquivos [`inputs.json`](inputs.json) e [`freeze.json`](freeze.json) desta pasta os fixam.
> Os recibos brutos do baseline (commitado) e os do turno e da corroboração (fora do repositório, citados por SHA-256) são a única entrada; este README, o índice das evidências e o que aponta para eles foram escritos depois e não são entrada de nenhum comando.
> A [nota de pesquisa](../../research/frontier-freeze.md) e esta página dizem os mesmos números.

Este é o **ato único** que o marco 0.5 Frontier reservou para depois do baseline janelado: congelar o **orçamento de desempenho do V05-06** (critério `congelado`) e os **cinco limiares do protocolo do comparativo final** (V05-10, critério `protocolo`), na mesma data e **antes de qualquer execução comparativa**.
Os valores saem de uma regra escrita antes (a mediana das cinco execuções mais três vezes o intervalo interquartil, para cima a 0,5 ms), aplicada às **execuções janeladas apresentadas de 2026-10-09 sobre o commit `1bc3a3c`**, por decisão do usuário; três execuções posteriores na `main` corroboram e **não viram limiar**.
O resultado é recalculável por qualquer um a partir de entradas commitadas e é verificado por um teste. **O critério `congelado` do V05-06 e o critério `protocolo` do V05-10 fecham com este ato**; o registro no painel vem depois deste commit de evidência.
**A saída X6 (orçamento de desempenho pré-registrado e cumprido) continua aberta**: "cumprido" depende dos braços do comparativo e do tempo de CPU por quadro, não do tempo de quadro da faixa do turno ([Depois do congelamento](#depois-do-congelamento-a-faixa-corrigida-do-turno)). Nenhuma medição comparativa rodou, e nada aqui diz que o HUD React Native é mais rápido ou mais lento que qualquer coisa.
A fatia não muda código de produto: a API pública, o PARITY e a compatibilidade ficam como estavam, e nenhum peso, nota ou denominador do 1.0 se move.

Todo link de código abaixo está fixado no commit [`a6210dc`](https://github.com/journey-studios/godot-fabric/commit/a6210dc2c09ca63155511f36898f72fc56385798): o [script da regra e do `--check`](https://github.com/journey-studios/godot-fabric/blob/a6210dc2c09ca63155511f36898f72fc56385798/scripts/frontier-freeze.mjs), o [da extração dos recibos](https://github.com/journey-studios/godot-fabric/blob/a6210dc2c09ca63155511f36898f72fc56385798/scripts/frontier-freeze-receipts.mjs) e o [teste](https://github.com/journey-studios/godot-fabric/blob/a6210dc2c09ca63155511f36898f72fc56385798/tests/frontier-freeze.test.mjs).

| Verificação | Resultado | Observação |
| --- | --- | --- |
| `node scripts/frontier-freeze.mjs --from-receipts` sobre os 5 recibos brutos | **5 de 5 aceitos** | o SHA-256 de cada um é o registrado; `verifyGraphicsReceipt` e `graphicsRunValidity` os aceitam; o `summary` do baseline é igual a `summarizeGraphicsRuns` sobre os intervalos brutos; as estatísticas por fase do turno, recalculadas dos intervalos brutos, são as do recibo |
| `node scripts/frontier-freeze.mjs --check` | **passou** | `FRONTIER_FREEZE_CHECK_PASSED: 5 thresholds, 16 budget rows, 20 derivations, frozen on 2026-10-10`: refaz o `freeze.json` do `inputs.json` e exige que o protocolo carregue os valores, na mesma data |
| Teste de contrato em Node (`tests/frontier-freeze.test.mjs`, no `test:contracts`) | 20/20 | a regra contra as linhas da tabela do `1bc3a3c`, os valores recalculados por fórmula própria, as mutações acusadas |
| Teste do protocolo (`tests/frontier-comparison-protocol.test.mjs`) | 18/18 | o **pin `PINS[2]` não se move**: o congelamento preenche só `frozenValue` e `frozenAt` |
| `npm run test:contracts` | saiu com 0 | 488 testes de Node e 13 de Python, sem falhas |
| Host anterior | **N/A** | a fatia não muda C++ nem código de produto |

As contagens de testes são as do commit fixado `a6210dc`; o commit de evidência que o segue acrescenta ao teste de contrato as checagens deste registro.

**Ambiente** (o das execuções que entram): Apple M3 Pro (`Mac15,6`, 11 núcleos lógicos, 18 GB), macOS 26.6.2 (25G83) arm64, tela embutida `Color LCD` (1512 × 982 pontos, 120 Hz, escala 2), Godot oficial 4.7.2, `gl_compatibility` sobre `opengl3`, vsync lido como `enabled`. O baseline usou uma janela de 800 × 600 e o turno uma de 1080 × 600.

## As entradas

**Decisão do usuário, 2026-10-09:** congelar pelas execuções de `1bc3a3c`. As da noite de 2026-10-09 sobre `916387e` (UTC de 2026-10-10, 01:24 a 01:52) entram como corroboração.

O `1bc3a3c` é a branch do #99 antes do squash `ffeeb5c`: diante do squash, o probe, o script e `window-presence.gd` diferem só em comentários, e o consumidor `civ-lite` é o de antes do #100. As duas faixas janeladas foram medidas nesse commit, uma depois da outra, na mesma máquina, no estado de carga mais baixo das execuções disponíveis,
com o usuário ausente, 5 de 5 vagas aceitas na primeira tentativa de cada faixa e 0 quadro que o motor não pudesse desenhar. A corroboração rodou na `main` em `916387e`, sem nenhuma suíte, build ou export de outro agente (um amostrador conferiu a cada 15 s), com o usuário ausente; o A/B reverteu só `consumers/civ-lite` para `fb51c07` (a `main` antes do #100), com `git restore`, e o restaurou depois.
Os dois hosts são dois builds Release do mesmo código nativo, que não muda entre `1bc3a3c` e `916387e`.

| Papel | SHA-256 do recibo bruto | Commit | Bundle | Host | Média de 1 minuto em torno das execuções |
| --- | --- | --- | --- | --- | --- |
| o baseline, **congela** | `36b32e0d6d1418af122260aa453bdd77bd9619811181731a88855a1e526e13b7` (437.679 bytes; commitado byte a byte em [`windowed-presented-raw.json`](../frontier-baseline/windowed-presented-raw.json)) | `1bc3a3c` | `7895d359…` | `212d0f6e…` | 5,26 a 6,16 |
| o turno, **congela** | `8dd6ec9cf4776a8026c3056c337da9a9bb7c811b6b529f05c1ecee3ca111e90f` (1.539.885 bytes; fora do repositório) | `1bc3a3c` | `fce50a0a…` | `212d0f6e…` | 5,35 a 7,55 |
| corroboração: o baseline de novo | `9959a269a61b615d5ccfff3864f262732f2fd28bcbf240f01987c29e3027e9f4` (439.244 bytes; fora do repositório) | `916387e` | `7895d359…` | `497e4f95…` | 8,34 a 13,55 |
| corroboração: o turno, HUD do #100 (a atual) | `4708f22b7dc62544a1e22b1c7e1e4f96cc7895216ae7b68c9f4ff62a4da370ca` (1.548.415 bytes; fora do repositório) | `916387e` | `54b8af7d…` | `497e4f95…` | 6,56 a 10,53 |
| corroboração, A/B: o turno, HUD de antes do #100 | `244f6ffd37eef631df4587abc8eb5542af3d89524a130e7a7771cd7ef0c13545` (1.538.986 bytes; fora do repositório) | `916387e` | `fce50a0a…` | `497e4f95…` | 5,75 a 8,60 |

A média de 1 minuto é lida de `sysctl vm.loadavg` antes e depois de cada execução; as leituras de cada execução estão em `receipts.<papel>.load` do [`inputs.json`](inputs.json), e as da faixa inteira (antes e depois das cinco vagas) em `laneLoad`: o baseline congelado, `{ 5.41 5.71 7.07 }` e `{ 6.79 6.05 6.87 }`; o turno, `{ 5.70 5.85 6.78 }` e `{ 5.77 6.18 6.44 }`.

**Só o recibo do baseline está no repositório**, byte a byte (o `frontier-baseline-graphics.json` que a faixa gravou, 437.679 bytes), no [registro do baseline](../frontier-baseline/README.md#faixa-janelada-apresentada-2026-10-09). Os outros quatro ficam fora, como os do turno sempre ficaram, e são citados aqui só pelo SHA-256; o que a regra lê deles está no [`inputs.json`](inputs.json).
**Cada hash foi conferido antes do uso.** O `inputs.json` guarda, por execução aceita, o p50, o p95 e o p99 do quadro da troca sobre todas as trocas e por tamanho (0, 50, 75 e 100 nós criados), o p50 e o p95 da injeção e do flush, o p99 do quadro ocioso e as contagens de quadros de 100 ms ou mais; e, para o turno, **os intervalos brutos, em µs,**
das duas janelas de cada uma das 120 voltas estáveis. O bloco `corroboration` tem o mesmo extrato dos três recibos de corroboração, para que o `--check` recalcule também os números deles.

## A regra

Para uma estatística, o valor dela em cada uma das cinco execuções, em **microssegundos inteiros** a partir dos intervalos brutos, em ordem; a mediana é o terceiro valor, Q1 o segundo e Q3 o quarto (os quartis de cinco por posto mais próximo, os de `tests/performance-oracle.mjs`);
o limite é **a mediana mais três vezes o IQR** (Q3 menos Q1), **arredondado para cima a 0,5 ms**. Uma contagem de quadros de 100 ms ou mais segue a mesma regra e não se arredonda. É uma função só, `budgetOf(valoresPorExecução)`, em [`scripts/frontier-freeze.mjs`](https://github.com/journey-studios/godot-fabric/blob/a6210dc2c09ca63155511f36898f72fc56385798/scripts/frontier-freeze.mjs).
A regra é a do protocolo e a da proposta do baseline; o teste a aplica a linhas da tabela de derivação do `1bc3a3c` como fixtures (13,632 / 13,690 / 13,714 / 13,721 / 13,794 ms dão **14,0**; o p99 com 50 nós dá **27,5**; as contagens zero dão **0**) e recalcula os três limiares numéricos com uma fórmula própria.

## Os valores congelados

Os cinco limiares do protocolo, em 2026-10-10 (`frozenValue` e `frozenAt` de cada entrada de `thresholds`; nada mais do JSON mudou e o pin não se moveu):

| Limiar | Valor congelado |
| --- | --- |
| `cpu-time-instrument` | um objeto com `quantity`, `reading`, `alignment`, `observedError`, `gate` e `evidence` (abaixo) |
| `budget-p95-ai-phase` | **15,5 ms** |
| `budget-p95-event-burst` | **15,5 ms** |
| `budget-p95-context-switches` | **16,0 ms** |
| `budget-p95-stress` | **N/A**: o V05-06 não mediu um log de 200 linhas nem uma lista de produção de 100 itens, então a janela é julgada só pela regra relativa |

A conta dos três números e das demais linhas derivadas (em ms; as cinco execuções em ordem crescente, os quartis de cinco e a regra). Os limites em **negrito** são congelados; os outros foram derivados só para serem lidos (uma referência, ou o p99 de um tamanho):

| Estatística (ms) | As cinco execuções, em ordem | Q1 | Mediana | Q3 | IQR | Mediana + 3 IQR | Para cima a 0,5 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Quadro da troca p50, 0 nós criados | 3,565 / 3,653 / 3,662 / 3,667 / 3,731 | 3,653 | 3,662 | 3,667 | 0,014 | 3,704 | **4,0** |
| Quadro da troca p95, 0 nós criados | 13,632 / 13,690 / 13,714 / 13,721 / 13,794 | 13,690 | 13,714 | 13,721 | 0,031 | 13,807 | **14,0** |
| Quadro da troca p99, 0 nós criados | 13,897 / 14,251 / 14,284 / 14,983 / 15,141 | 14,251 | 14,284 | 14,983 | 0,732 | 16,480 | 16,5 |
| Quadro da troca p50, 50 nós criados | 8,414 / 8,436 / 8,448 / 8,494 / 8,588 | 8,436 | 8,448 | 8,494 | 0,058 | 8,622 | **9,0** |
| Quadro da troca p95, 50 nós criados | 10,688 / 10,713 / 11,052 / 11,116 / 11,843 | 10,713 | 11,052 | 11,116 | 0,403 | 12,261 | **12,5** |
| Quadro da troca p99, 50 nós criados | 12,201 / 13,282 / 15,565 / 17,241 / 20,135 | 13,282 | 15,565 | 17,241 | 3,959 | 27,442 | 27,5 |
| Quadro da troca p50, 75 nós criados | 10,926 / 11,053 / 11,171 / 11,197 / 11,534 | 11,053 | 11,171 | 11,197 | 0,144 | 11,603 | **12,0** |
| Quadro da troca p95, 75 nós criados | 13,426 / 13,533 / 14,080 / 15,409 / 15,420 | 13,533 | 14,080 | 15,409 | 1,876 | 19,708 | **20,0** |
| Quadro da troca p99, 75 nós criados | 18,780 / 18,960 / 19,278 / 22,366 / 24,621 | 18,960 | 19,278 | 22,366 | 3,406 | 29,496 | 29,5 |
| Quadro da troca p50, 100 nós criados | 13,130 / 13,144 / 13,144 / 13,255 / 13,541 | 13,144 | 13,144 | 13,255 | 0,111 | 13,477 | **13,5** |
| Quadro da troca p95, 100 nós criados | 14,730 / 16,568 / 16,577 / 16,699 / 19,442 | 16,568 | 16,577 | 16,699 | 0,131 | 16,970 | **17,0** |
| Quadro da troca p99, 100 nós criados | 16,615 / 20,404 / 24,607 / 25,918 / 60,024 | 20,404 | 24,607 | 25,918 | 5,514 | 41,149 | 41,5 |
| Quadro ocioso p99 | 14,854 / 15,169 / 15,213 / 15,509 / 15,604 | 15,169 | 15,213 | 15,509 | 0,340 | 16,233 | **16,5** |
| Quadros de troca de 100 ms ou mais, por execução | 0 / 0 / 0 / 0 / 0 | 0 | 0 | 0 | 0 | 0 | **0** |
| Intervalos ociosos de 100 ms ou mais, por execução | 0 / 0 / 0 / 0 / 0 | 0 | 0 | 0 | 0 | 0 | **0** |
| Quadro da troca p50, todas as trocas (referência) | 10,410 / 10,502 / 10,596 / 10,625 / 10,673 | 10,502 | 10,596 | 10,625 | 0,123 | 10,965 | 11,0 |
| Quadro da troca p95, todas as trocas (limiar `budget-p95-context-switches`) | 14,217 / 14,497 / 14,835 / 14,875 / 15,928 | 14,497 | 14,835 | 14,875 | 0,378 | 15,969 | **16,0** |
| Quadro da troca p99, todas as trocas (referência) | 15,447 / 17,339 / 18,175 / 18,978 / 19,836 | 17,339 | 18,175 | 18,978 | 1,639 | 23,092 | 23,5 |
| p95 da fase da IA (limiar `budget-p95-ai-phase`) | 13,784 / 14,539 / 14,642 / 14,799 / 14,928 | 14,539 | 14,642 | 14,799 | 0,260 | 15,422 | **15,5** |
| p95 do fim do turno (limiar `budget-p95-event-burst`) | 14,677 / 14,715 / 14,847 / 14,868 / 14,952 | 14,715 | 14,847 | 14,868 | 0,153 | 15,306 | **15,5** |

Na ordem das execuções (1 a 5): o p95 da fase da IA foi 14,642 / 14,539 / 14,799 / 14,928 / 13,784 ms; o do fim do turno, 14,677 / 14,847 / 14,868 / 14,952 / 14,715 ms; o do quadro da troca sobre todas as trocas, 14,835 / 14,497 / 15,928 / 14,217 / 14,875 ms.

**O instrumento** (`cpu-time-instrument`) congela os cinco pontos de ["What `cpu-time-instrument` should freeze"](../../research/cpu-time-instrument.md#what-cpu-time-instrument-should-freeze), condensados sem mudar o sentido: a quantidade (`total_ms = physics_ms + process_ms + setup_ms + render_ms` por quadro de processo, o tempo decorrido monotônico entre ganchos do engine na thread principal, e não o relógio de CPU da thread), a leitura (`Time.get_ticks_usec` nos ganchos, nunca `Performance.TIME_PROCESS`),
o alinhamento do termo de render (6 draws depois), o erro observado contra uma carga de duração conhecida (até 0,16% headless e 1,5% numa janela apresentada, contra os 10%) e o portão (o `.gd` byte a byte o mesmo, e o probe e o oráculo de novo na máquina, no engine e no renderer da campanha). O campo `evidence` nomeia a pesquisa, o [registro do instrumento](../cpu-time-instrument/README.md) e o commit que ele fixa, `e38615da6ad7f9ca774e2ef8c46de33707c1b427`.

**O orçamento do V05-06**, linha por linha. As células de cada linha (a métrica, a linha de base e a regra) estão na [tabela da nota do baseline](../../research/frontier-baseline.md#the-budget-frozen-on-2026-10-10); aqui estão o id, a decisão, o limite e a origem (`sources` do `freeze.json`):

| Linha | Decisão | Limite congelado | Origem |
| --- | --- | --- | --- |
| `native-nodes-after-swap` | mantida | como na tabela da nota | `headless-77` |
| `nodes-created-and-deleted` | mantida | como na tabela da nota | `headless-77` |
| `one-click-one-swap` | mantida | como na tabela da nota | `headless-77` |
| `heap-at-rest` | mantida | como na tabela da nota | `headless-77` |
| `frames-click-to-panel` | mantida | como na tabela da nota | `headless-77` |
| `cpu-time-of-the-swap` | mantida | como na tabela da nota | `headless-77` |
| `heap-of-a-mounted-panel` | mantida | como na tabela da nota | `headless-77` |
| `swap-frame-p50-by-nodes` | recalculada | 4,0 / 9,0 / 12,0 / 13,5 ms | `baseline-1bc3a3c` |
| `swap-frame-p95-by-nodes` | recalculada | 14,0 / 12,5 / 20,0 / 17,0 ms | `baseline-1bc3a3c` |
| `swap-frame-p95-all` | recalculada | 16,0 ms | `baseline-1bc3a3c` |
| `idle-frame-p99` | recalculada | 16,5 ms | `baseline-1bc3a3c` |
| `frames-of-100-ms-or-more` | recalculada | 0 / 0 | `baseline-1bc3a3c` |
| `ai-phase-p95` | adicionada | 15,5 ms | `turn-1bc3a3c` |
| `event-burst-p95` | adicionada | 15,5 ms | `turn-1bc3a3c` |
| `resident-and-static-memory` | mantida | como na tabela da nota | `headless-77` |
| `swap-frame-p99-by-nodes` | **removida** | nenhum (a proposta tinha 16,5 / 27,5 / 29,5 / 41,5 ms) | `baseline-1bc3a3c` |

## As decisões

1. **A linha `context-switches` é o p95 sobre todas as trocas.** O `budget-p95-context-switches` é, por execução do baseline, o `swapFrameMs.p95` do `summary`: as 360 trocas estáveis percorrem os painéis de 0, 50, 75 e 100 nós como as 50 trocas da janela percorrem os sete contextos. Os valores por tamanho ficam ao lado, no registro, e não viram limiar.
2. **A `ai-phase` são os seis primeiros quadros `busy`.** Por execução do turno, o p95 (posto mais próximo) dos 720 quadros da janela `ai-phase` do protocolo (6 por volta × 120 voltas estáveis): do quadro que aceita o turno ao último antes do quadro que entrega o `turn_ended`. As duas rodadas de aquecimento ficam de fora, como o oráculo as deixa. O primeiro intervalo de uma volta começa na injeção, uns milissegundos depois da fronteira do quadro, e por isso é mais curto; ele entra na janela.
3. **O fim do turno tem 2 quadros por volta.** O `event-burst` é o p95 do sétimo quadro `busy` (o que entrega o `turn_ended`) mais os quadros `after` até a HUD mostrar, que são **um em todas as voltas**: 2 por volta, 240 por execução. A janela do protocolo tem pelo menos 5 quadros a partir do `turn_ended` e o turno grava só estes; os seguintes não foram medidos, e o limite é o desses dois quadros. Nada foi inventado para os que faltam.
4. **O `stress` é N/A.** Nenhuma execução do V05-06 mediu um log de 200 linhas nem uma lista de produção de 100 itens: o roteiro do turno mantém o estado do jogo pequeno ([limitações da nota do turno](../../research/frontier-turn.md#limitations-and-open)), o jogo do soak deixa de mudar depois do turno 14 ([limitações da nota do soak](../../research/frontier-soak.md#limitations-and-open)), e o caso de estresse dos serviços mede os orçamentos de 64 tarefas e 128 eventos. A janela é julgada só pela regra relativa (C contra B).
5. **O p99 por tamanho saiu.** O p99 de 90 trocas é o máximo delas (posto mais próximo 90; o teste confere nos intervalos brutos), então um único quadro por execução fixa o limite e é a estatística mais ruidosa (IQR de 0,7 a 5,5 ms entre execuções, contra 0,03 a 1,9 ms do p95). A cauda fica coberta pela contagem de quadros de 100 ms ou mais, que fica em 0. A derivação das linhas removidas continua na tabela, marcada como não congelada.
6. **O instrumento** congela a recomendação do próprio registro dele, condensada, com o commit fixado de lá.
7. **Uma data só.** O `frozenAt` é o mesmo nos cinco limiares, a data local do commit que os preenche.
8. **Nada mais do protocolo muda.** O `status`, o `baseline.windowed` e o primeiro item de `open` continuam com o texto da pré-registração, porque o pin os cobre (o teste guarda `0b0644716fb5e4bf85ef7556347e56fa5ea12d3be3f19a0576498370ddc618b6` para as duas emendas); a [nota do protocolo](../../research/frontier-comparison-protocol.md#the-freeze) explica. O congelamento não é uma emenda.
9. **A corroboração não move nenhum limiar.** Os limites congelados são os de `1bc3a3c`, por decisão do usuário; as outras execuções são observações.
10. **Uma deduplicação pequena:** `quartiles` passou a ser exportado por `tests/performance-oracle.mjs` e o oráculo do baseline o importa em vez de manter uma cópia privada (nenhum comportamento muda). A cópia de `tests/frontier-turn-oracle.mjs` fica, porque o arquivo é de outra entrega em andamento; é pendência.

## Quatro observações que não mudam nenhuma regra

Nenhuma muda o protocolo, e nenhuma afrouxa um limite.

**(a) O orçamento absoluto compara duas quantidades diferentes.** O `decisionRule.absoluteBudget` compara o p95 do *tempo de CPU* por quadro de um braço com um limite derivado do *tempo de quadro* de uma janela apresentada, que inclui a espera pelo display. O limite é largo para o tempo de CPU por construção: o tempo de quadro de uma janela a 120 Hz é feito dos aglomerados do vsync
(a janela ociosa do baseline já tem intervalos de 13 a 15 ms sem que nada aconteça), enquanto o tempo de CPU dos mesmos quadros ociosos, lido pelo instrumento, foi de 0,08 ms ([registro do instrumento](../cpu-time-instrument/README.md)). Um orçamento de cerca de dois períodos raramente será excedido por um tempo de CPU; **quem decide é a regra relativa (C contra B)**, e o orçamento absoluto é relatado ao lado da categoria e nunca a muda.

**(b) As execuções do congelamento rodaram muito acima do limite de carga das execuções comparativas.** As execuções comparativas exigem média de carga de 1 minuto de no máximo 2,0 (`runs.load.limit1MinuteAverage`). O baseline do congelamento rodou a 5,26 a 6,16 em torno das suas execuções e o turno a 5,35 a 7,55; a corroboração rodou a 8,34 a 13,55 (o baseline), 6,56 a 10,53 (o turno) e 5,75 a 8,60 (o A/B).
O amostrador da corroboração leu a média de 1 minuto entre 5,06 e 13,17 e a de 5 minutos entre 6,97 e 10,09, sem suíte de agente rodando: o piso ocioso desta máquina, com os aplicativos de desktop abertos, nunca esteve perto de 2. O critério `execucao` vai precisar de uma máquina dentro do limite, e uma execução que não o cumpra é refeita pela regra do próprio protocolo.

**(c) Com a HUD do #100 a faixa do turno passa dos limites congelados.** O turno com a HUD de antes do #100, medido em `916387e` (o A/B: a mesma máquina, a mesma noite, a mesma `main`, só `consumers/civ-lite` muda), reproduz `1bc3a3c`; com a HUD do #100 cada quadro do turno depois do primeiro mediu uns 6 ms a mais (cerca de 14 ms na mediana, contra cerca de 7,5):

| Turno (janelado, cinco execuções cada) | `1bc3a3c`, congelado | `main`, HUD de antes do #100 | `main`, HUD do #100 |
| --- | --- | --- | --- |
| Os sete quadros do job somados, p50 (mediana entre as execuções) | 54,234 ms | 54,911 ms | 94,688 ms |
| p95 da fase da IA em cada execução | 13,784 a 14,928 ms | 14,506 a 14,787 ms | 16,561 a 17,123 ms |
| Mediana dos p95 da fase da IA, contra os 15,5 ms congelados | 14,642 ms, cumprido | 14,602 ms, cumprido | 16,787 ms, excedido |
| Mediana dos p95 do fim do turno, contra os 15,5 ms congelados | 14,847 ms, cumprido | 14,784 ms, cumprido | 17,192 ms, excedido |
| Os limites que a regra daria (fase da IA, fim do turno) | 15,5, 15,5 ms | 15,5, 15,0 ms | 18,5, 18,5 ms |
| p50 de cada um dos sete quadros (mediana entre as execuções) | 3,497 / 6,290 / 7,370 / 7,661 / 7,588 / 7,076 / 7,241 ms | 4,201 / 7,791 / 7,369 / 7,368 / 7,631 / 7,617 / 7,273 ms | 7,420 / 14,390 / 14,393 / 14,195 / 14,044 / 14,102 / 14,026 ms |

O registro diz só o que o A/B mostra: com a HUD do #100 cada quadro depois do primeiro levou cerca de 14 ms na mediana, mais que um período de 8,33 ms, e **o turno na `main` em `916387e` passava dos limites congelados do turno**. **A causa foi confirmada e corrigida no [#108](https://github.com/journey-studios/godot-fabric/pull/108) (commit `09ed8f7`): era a sonda da faixa do turno (a leitura que ela faz do snapshot da Surface), não a HUD nem o host.** A sonda do turno lia o `snapshot()` da Surface duas vezes em cada quadro cronometrado. Esse snapshot é o status inteiro da aplicação, e dentro dele vai o log do carregador de imagens (um registro por `Image` montada, até 256), que os ícones do #100 encheram: uma leitura passou de cerca de 26 KB e 2,6 ms para 105 a 145 KB e cerca de 7 ms, e cada quadro do turno passou do período de 8,33 ms. A parte do jogo no quadro não mudou, e o host não faz trabalho de imagem por snapshot (zero cargas, decodificações ou eventos de carga por snapshot). A sonda corrigida lê os Controles nos quadros cronometrados e o snapshot completo só em repouso e uma vez na chegada; a regra `observation` do oráculo exige zero leituras do snapshot em todo intervalo cronometrado.

As execuções de 2026-10-09 sobre `916387e` tinham esse custo da observação: a sonda lia o snapshot dentro dos quadros medidos. O A/B do Agente 5 sobre a HUD de antes do #100 (os `consumers/civ-lite` de `fb51c07`, idênticos aos de `1bc3a3c`) mostra que as leituras da sonda antiga moveram as janelas em menos de 1 ms: o p95 da fase da IA foi 14,66 ms com a sonda antiga e 14,44 ms com a corrigida, e o do fim do turno, 14,84 e 14,38 ms. [O registro da HUD](../civ-lite-ui/README.md#correção-do-tempo-de-quadro-regressão-do-100) tem esses números, atribuídos ao Agente 5.
**O limite não foi afrouxado.** Se a observação também pesava em `1bc3a3c`, o limite congelado inclui esse custo e fica mais largo, não mais apertado: isto é uma limitação dos números congelados, que o A/B mede em menos de 1 ms. Os 15,5 ms congelados sobre `1bc3a3c` continuam valendo, e os limites congelados não mudam. O "cumprido" da saída X6 depende dos braços e do tempo de CPU por quadro, não desse custo.

**(d) O baseline é sensível à carga.** O mesmo bundle do baseline rodou na noite de 2026-10-09 com carga maior e foi cerca de 25% mais lento, e é por isso que valem as execuções de carga mais baixa:

| Baseline (janelado, cinco execuções cada) | `1bc3a3c`, congelado (carga 5,26 a 6,16) | corroboração (carga 8,34 a 13,55) |
| --- | --- | --- |
| Injeção e flush, p50 em cada execução | 6,824 a 7,305 ms | 8,343 a 9,035 ms |
| p95 do quadro da troca sobre todas as trocas, em cada execução | 14,217 a 15,928 ms | 18,776 a 20,377 ms |
| p50 do quadro da troca por nós criados 0 / 50 / 75 / 100 (mediana das execuções) | 3,662 / 8,448 / 11,171 / 13,144 ms | 4,954 / 11,529 / 14,115 / 16,758 ms |
| p95 do quadro da troca por nós criados 0 / 50 / 75 / 100 (mediana das execuções) | 13,714 / 11,052 / 14,080 / 16,577 ms | 13,484 / 13,233 / 16,778 / 20,915 ms |
| O limite que a regra daria para o p95 sobre todas as trocas | 16,0 ms | 22,0 ms |

A carga de sistema mais alta é a causa provável (o `fseventsd`, o Spotlight e o `CacheDelete` estavam ocupados); não foi isolada. O turno de antes do #100, medido na mesma noite (a 5,75 a 8,60), quase não mudou diante do congelado (os sete quadros do job somam 54,911 ms no p50, contra 54,234 ms).
O p99 ocioso fica em 15,329 ms (congelado: 15,213 ms) e um quadro de 100 ms ou mais (de troca ou ocioso) aparece na última execução (nenhum nas congeladas).

## Depois do congelamento: a faixa corrigida do turno

Depois do congelamento, o [#108](https://github.com/journey-studios/godot-fabric/pull/108) (commit [`09ed8f7`](https://github.com/journey-studios/godot-fabric/commit/09ed8f76ade66e6631811060f7b3719902a65105)) corrigiu a sonda da faixa do turno (observação (c)). O principal rodou a faixa janelada do turno de novo, na `main` em `09ed8f76ade66e6631811060f7b3719902a65105`, com a HUD do #100 e a sonda corrigida. O host foi recompilado para esse commit (SHA-256 começa por `131a250e`; o SHA-256 de um dylib depende do caminho do build, então difere do `258d1821…` do registro do Agente 5, que é um build separado, em outra worktree, do mesmo código nativo), e o bundle é `c4b4051a…`.

É **corroboração**, não limiar: não move nenhum valor, nenhum limite e nenhum recibo congelado, e os limites continuam os de `1bc3a3c`. A saída X6 ("cumprido") **continua aberta**, porque depende dos braços do comparativo e do tempo de CPU por quadro, não do tempo de quadro da faixa do turno.

- **Resultado:** apresentada; 5 de 5 vagas aceitas na primeira tentativa, com vsync a 120 Hz.
- **Recibo bruto:** fora do repositório, SHA-256 `c98243c2f7e47dc42be4f931e44a7720999a861a96628d1e3c92894783cb878f`.
- **Janelas,** calculadas com as funções do congelado (`extractTurnRun` de `scripts/frontier-freeze-receipts.mjs` e `nearestRank` de `tests/performance-oracle.mjs`):

| Janela | p95 por vaga (ms) | Mediana (ms) | Limite congelado (ms) |
| --- | --- | ---: | ---: |
| `ai-phase` | 13,624 / 13,607 / 13,575 / 13,726 / 13,652 | 13,624 | 15,5 (cumprido) |
| `event-burst` | 13,541 / 13,519 / 13,565 / 13,547 / 13,498 | 13,541 | 15,5 (cumprido) |

- A soma dos sete quadros do job tem p50 de 52,973 a 53,905 ms por vaga (54,2 ms em `1bc3a3c`).
- A regra daria limites de 14,0 e 14,0 ms, mas isso é só referência: nada é recongelado.

**Carga e contaminação.** A média de carga de 1 minuto ficou entre 6,75 e 14,35 em volta das vagas (`{ 11,30 13,42 13,51 }` antes da primeira e `{ 14,35 11,07 11,70 }` depois da última). O Agente 5 informou trabalho nativo de outro agente (um build do editor e execuções headless curtas) de cerca de 05:24 a 05:40 UTC, isto é, durante toda a faixa; o amostrador só o viu em parte, nas vagas 4 e 5. A contenção só pode aumentar o tempo de quadro, então os p95 medidos (13,6 e 13,5 ms) são um limite superior, e a conclusão de que a faixa corrigida cumpre os 15,5 ms fica de pé, com folga. O usuário estava ausente.

**Como reproduzir.** Rode `caffeinate -d node scripts/frontier-turn-graphics.mjs` e aplique `extractTurnRun` e `nearestRank` ao `raw` do recibo.

## Limites

- **Uma máquina, um display, um modo de vsync** (o padrão, lido da janela): Apple M3 Pro, macOS, Compatibility renderer, 120 Hz. Nenhum número vale para outro hardware, e nenhum FPS sem limite é afirmado.
- **A carga estava muito acima de 2,0** nas execuções que congelam (observação (b)), com outros agentes na máquina e o usuário ausente: os números são pessimistas, e o usuário trabalhando no Mac não está neles. A corroboração mostra que o baseline é sensível à carga (observação (d)).
- **O fim do turno foi medido em 2 quadros**, e a janela do protocolo tem pelo menos 5: o limite do `event-burst` é o desses dois quadros.
- **A faixa do turno com a HUD do #100 passou dos limites congelados do turno em `916387e`**; a causa foi confirmada e corrigida no #108 (observação (c) e [Depois do congelamento](#depois-do-congelamento-a-faixa-corrigida-do-turno)), e o "cumprido" da saída X6 depende dos braços e do tempo de CPU por quadro.
- **A janela `stress` não tem orçamento absoluto.** O cenário que enche um log de 200 linhas e uma lista de 100 itens será medido pela primeira vez no comparativo.
- **O orçamento absoluto compara o tempo de CPU com um limite de tempo de quadro** (observação (a)); a regra relativa decide.
- **O recibo bruto do turno não tem os campos que o `verifyTurnRecord` lê** (`job`, `spinner`, os totais do host). O turno foi validado pelo `verifyGraphicsReceipt` e pelo `graphicsRunValidity`, que a própria faixa usa, por uma checagem da forma do turno nos dados brutos e pelo recálculo das estatísticas por fase e da soma dos sete quadros, que bateram com o `turnFrames` do recibo ao microssegundo.
- **Quatro dos cinco recibos ficam fora do repositório.** Quem não os tem confere o `inputs.json` pelo `--check`, que recalcula tudo do extrato, e a procedência pelo SHA-256 da tabela acima; refazer o extrato exige os recibos.
- **Mudar um limite congelado é uma decisão própria**, com registro, e não uma edição destes arquivos.
- **Braço B, `execucao` e iPhone seguem abertos:** a regra relativa precisa do braço B (a janela de 16,0 h já está fixada), o `execucao` precisa do instrumento ligado nos três braços, dos scripts e de uma máquina dentro do limite de carga, e o iPhone é NO-GO (V05-09, 2026-10-09), então o comparativo cobre só o macOS.
- A cópia privada de `quartiles` em `tests/frontier-turn-oracle.mjs` fica até a entrega dona do arquivo importar a exportada.

## CI hospedada e Pages

O push da `main` em `561251d` (o squash do #107; run [38025095171](https://github.com/journey-studios/godot-fabric/actions/runs/38025095171) do workflow Contracts) passou na primeira tentativa, sem reexecução, nos três jobs que um push roda desde o #88: `contracts` (3 min 8 s), `reference-android` (6 min 16 s) e `reference-ios` (7 min 23 s). Os outros cinco (`native-cold-start`, `native-suites-frontier`, `native-suites-input`, `native-suites-runtime` e `parity-comparison`) aparecem como **skipped**. O [recibo](hosted-ci.json) registra esses cinco como `skipped` e não como falha, e só os aceita porque a linha da fatia não tem passo nativo nem artefato.

A fatia não tem passo nativo: o congelamento é um contrato em Node, e o recibo não certifica nenhum build nativo.

O que o run prova, conferido pelo `--check` do script e pelos logs:

- **O checkout.** Os três jobs que rodaram usaram `561251d`. A árvore do head do PR (`e888adb`) é a mesma árvore do squash.
- **O passo da guarda.** "Milestone exit guards (X9 and X10)" (passo 5 do job `contracts`) passou num push e imprimiu `MILESTONE_GUARDS_CHECK_PASSED: against 2b2972607f9f (--base 2b2972607f9f5372530d151cedf4a1c0ceee5034); X9 clean, X10 clean`. A base é o pai do squash.
- **Os testes.** `npm run test:contracts` (passo 6) passou com 489 testes de Node, `# fail 0`, e `PARITY_INVENTORY_PASSED: 8113 contracts, 97 public values`. O recibo confere, pelo nome e no log do job `contracts`, os 21 testes de nível superior de `tests/frontier-freeze.test.mjs`: 21 de 21. O TAP escreve `\#` nos nomes com `#`, e o gerador desfaz esse escape antes de comparar, porque um nome deste arquivo tem `#100`.
- **Os checks.** `check:static` e `check:publication` também passaram (1.978 arquivos).

O [Pages](publication.json) rodou sobre o mesmo squash (run [38025095215](https://github.com/journey-studios/godot-fabric/actions/runs/38025095215), `build` e `deploy` em success, 43 testes do painel). O deployment 6976226964 está em success, o artefato `github-pages` (id 11659958434, SHA-256 `62e7446a…`, igual ao digest da API e ao do log de upload) tem 15 arquivos, e o `migration.json` de dentro tem os mesmos bytes do `dashboard/migration.json` do squash (SHA-256 `0b15733b…`) e a entrada de atividade `milestone-0-5-v05-06-congelado-e1803a9`. Um push seguinte da `main` substitui o deployment, então o site público não foi comparado.

O `--check` roda na CI pelo teste `tests/frontier-freeze.test.mjs`, que faz parte do `test:contracts`; a extração `--from-receipts` só roda localmente, porque os recibos brutos ficam fora do repositório.

Os recibos hospedados do acompanhamento do congelado (#112, `b23009d`) ficam na subpasta [`followup/`](followup/README.md), com o seu próprio run de Contracts e de Pages.

## Reproduzindo

```sh
node scripts/frontier-freeze.mjs --check                                   # refaz cada valor do freeze.json a partir do inputs.json e exige que o protocolo os carregue, na mesma data
node --test tests/frontier-freeze.test.mjs tests/frontier-comparison-protocol.test.mjs   # o contrato em Node (parte do test:contracts)
# com os cinco recibos brutos (o do baseline está no repositório; os outros ficam fora dele e são conferidos pelo SHA-256 da tabela das entradas):
node scripts/frontier-freeze.mjs --from-receipts docs/evidence/frontier-baseline/windowed-presented-raw.json <recibo do turno, SHA-256 8dd6ec9c…> \
  --corroborate baseline-main=<recibo, SHA-256 9959a269…> \
  --corroborate turn-main=<recibo, SHA-256 4708f22b…> \
  --corroborate turn-main-pre-100-hud=<recibo, SHA-256 244f6ffd…> --date 2026-10-10
```

O `--from-receipts` confere o SHA-256 de cada recibo contra o registrado e para com um erro se algum não bater; o oráculo recusar um recibo também o para. Ele reescreve o `inputs.json` e o `freeze.json`, e o resultado é byte a byte o desta pasta. Os arquivos são escritos pelo mesmo serializador que o teste exige.
