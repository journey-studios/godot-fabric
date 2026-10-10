# O roteiro da execução comparativa final (V05-10), parte 1: o cenário, o jogador e o ensaio nos três braços

> **Registro fixado.** O cenário, o jogador, o orquestrador, o módulo da regra das janelas e os testes citados abaixo são os do commit
> [`7e2e5b1`](https://github.com/journey-studios/godot-fabric/commit/7e2e5b13b7a432f25f17fab2d01a6553a2b1327a), de 2026-10-10, e os três `summary.json` desta pasta registram esse commit. As outras entradas dos ensaios são o arquivo do protocolo
> (`docs/research/frontier-comparison-protocol.json`, intocado) e o jogo (`consumers/civ-lite`, intocado). Este README, os arquivos desta pasta, o índice das evidências e o link da nota foram escritos depois e não são entrada de nenhum comando.
> A [nota de pesquisa](../../research/frontier-comparison-execution.md) e esta página dizem as mesmas coisas.

> **É UM ENSAIO. NENHUM NÚMERO DESTA PASTA É RESULTADO.** O roteiro rodou **uma vez em cada braço, em cada ensaio**, num build **Debug**, numa máquina com média de carga de 1 minuto entre 4,87 e 6,83 (o limite do protocolo é 2,0), sem o autoteste do instrumento e sem o export Release do V05-07.
> Nenhuma campanha rodou. Todas as nove execuções foram **rejeitadas pela análise**, como um ensaio deve mostrar (`not-the-registered-build`, e `load`; no headless também `not-presented`), e o relatório da análise de cada ensaio sai com `status: stopped` e nenhuma estatística.
> Nada aqui diz que o HUD React Native é mais rápido, mais lento ou igual ao nativo, nem que um braço é mais lento que o outro. Esta fatia entrega a **primeira parte** do critério `execucao` do V05-10 e **não fecha nenhum critério**; não move checkpoint, nota, peso nem denominador do 1.0.
> Não muda código de produto: a API pública, o PARITY e a compatibilidade ficam como estavam.

O protocolo do comparativo final diz que "each execution is a fresh process that runs the script below once" (`runs.process`), em oito passos (`runs.script`), com quatro janelas ativas, uma semente, um replay, um soak de 100 turnos e um conjunto de leituras, iguais nos três braços.
Este é o trecho entre o protocolo e a [análise](../frontier-comparison-analysis/README.md): o **cenário** que joga uma execução num processo do Godot em qualquer braço (A sem HUD, B com o HUD nativo do Godot, C com o HUD React Native) e escreve o que a análise lê; o **jogador** em GDScript que joga o soak sem o React Native, para que o braço A possa jogá-lo; o **orquestrador** que roda um processo por braço e monta uma campanha no formato `godot-fabric.frontier-comparison-campaign/v1`; e o **ensaio** nos três braços, marcado como ensaio e fora de qualquer campanha.

Todo link de código abaixo está fixado no commit [`7e2e5b1`](https://github.com/journey-studios/godot-fabric/commit/7e2e5b13b7a432f25f17fab2d01a6553a2b1327a). Os arquivos:
[`tests/frontier-comparison-scenario.gd`](https://github.com/journey-studios/godot-fabric/blob/7e2e5b13b7a432f25f17fab2d01a6553a2b1327a/tests/frontier-comparison-scenario.gd) (o cenário),
[`-player.gd`](https://github.com/journey-studios/godot-fabric/blob/7e2e5b13b7a432f25f17fab2d01a6553a2b1327a/tests/frontier-comparison-player.gd) (o jogador),
[`-hud.gd`](https://github.com/journey-studios/godot-fabric/blob/7e2e5b13b7a432f25f17fab2d01a6553a2b1327a/tests/frontier-comparison-hud.gd) (o que o cenário sabe de um braço),
[`-cycle.gd`](https://github.com/journey-studios/godot-fabric/blob/7e2e5b13b7a432f25f17fab2d01a6553a2b1327a/tests/frontier-comparison-cycle.gd) (o ciclo dos contextos),
[`-readings.gd`](https://github.com/journey-studios/godot-fabric/blob/7e2e5b13b7a432f25f17fab2d01a6553a2b1327a/tests/frontier-comparison-readings.gd) (as leituras em repouso);
em [`scripts/`](https://github.com/journey-studios/godot-fabric/tree/7e2e5b13b7a432f25f17fab2d01a6553a2b1327a/scripts), `frontier-comparison-run-windows.mjs` (**a regra das janelas, a única**), `-run-campaign.mjs` (da saída do cenário ao objeto de execução da campanha) e `-run.mjs` (o orquestrador, só `--rehearsal`);
os testes são
[`tests/frontier-comparison-run.test.mjs`](https://github.com/journey-studios/godot-fabric/blob/7e2e5b13b7a432f25f17fab2d01a6553a2b1327a/tests/frontier-comparison-run.test.mjs) (só Node, dentro de `npm run test:contracts`),
[`tests/frontier-comparison-player.test.mjs`](https://github.com/journey-studios/godot-fabric/blob/7e2e5b13b7a432f25f17fab2d01a6553a2b1327a/tests/frontier-comparison-player.test.mjs) e
[`tests/frontier-comparison-run-native.test.mjs`](https://github.com/journey-studios/godot-fabric/blob/7e2e5b13b7a432f25f17fab2d01a6553a2b1327a/tests/frontier-comparison-run-native.test.mjs) (os dois nativos, em `npm run test:frontier-comparison-run`).
Nada de `consumers/civ-lite`, do JSON do protocolo nem dos scripts da análise é editado: o cenário e seus auxiliares são copiados para a cópia provisionada do consumidor, em `res://comparison/`, e os módulos da análise só são importados.

| Verificação (no commit fixado) | Resultado | Observação |
| --- | --- | --- |
| `node --test tests/frontier-comparison-run.test.mjs` | 54 testes, verdes | a regra das janelas sobre traços sintéticos, os números com que o cenário espera, os microssegundos, a campanha montada de execuções sintéticas, as constantes contra o protocolo |
| `npm run test:frontier-comparison-run` | 12 testes nativos, verdes, 491 s | o jogador contra o soak de JavaScript e um controle que decide diferente; o ensaio nos três braços; o jogo sem `stress_step()` e o HUD sem `stats()` |

Essas contagens são as da execução do líder da revisão no commit fixado. As verificações do repositório do commit de evidência que segue o fixado estão no [fim](#as-verificações-do-commit-de-evidência).

## O que há nesta pasta

Os arquivos **commitados** são os que a máquina escreveu, copiados sem editar. Nenhum tem caminho local: conferido nas cópias, e a varredura da publicação confere de novo.

| Arquivo | Bytes | O que é |
| --- | ---: | --- |
| [`headless/summary.json`](headless/summary.json) | 33.033 | as contagens, os tempos e os motivos de rejeição de cada execução do ensaio headless |
| [`headless/rehearsal.json`](headless/rehearsal.json) | 1.019 | a marca: `rehearsal: true`, `notAResult`, o SHA-256 da campanha, a faixa, os braços, a taxa de atualização assumida e a procedência dos custos de leitura |
| [`windowed-presented/summary.json`](windowed-presented/summary.json), [`rehearsal.json`](windowed-presented/rehearsal.json) | 32.678 e 809 | o mesmo, do ensaio janelado na faixa apresentada |
| [`windowed-unlimited/summary.json`](windowed-unlimited/summary.json), [`rehearsal.json`](windowed-unlimited/rehearsal.json) | 32.684 e 809 | o mesmo, do ensaio janelado na faixa sem limite |
| [`windowed-state.txt`](windowed-state.txt) | 220 | as médias de carga (1, 5 e 15 minutos) e o tempo ocioso lidos antes e depois de cada faixa janelada |
| [`windowed-sampler.txt`](windowed-sampler.txt) | 1.242 | 23 amostras da carga, a cada 15 s, durante o ensaio janelado, com a contagem de processos de outros agentes ativos |

O `summary.json` não traz quadros: traz a marca, o commit, os quatro hashes, os hashes dos arquivos do roteiro, as horas e os motivos, e, por execução, os segundos, o código de saída, os quadros, a leitura do vsync, o tempo até a HUD interativa, os hashes do jogo, a paridade, as janelas (ocorrências, medidas, quadros), os quadros de repouso, os cliques da latência, os custos das leituras, os ganchos que existiam, as anomalias, as rejeições e os erros.

**Não commitados** (a campanha de cada ensaio tem de 284 a 288 KB, e os relatórios brutos do cenário, de 274 a 395 KB, são a entrada da campanha): só os SHA-256 deles, que se conferem contra os arquivos regerados e contra o `campaignSha256` de cada `rehearsal.json`.

| Ensaio | Arquivo | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| headless | `campaign.json` | 284.309 | `385e658f675a741c411c1b2a1c5373415af4431f675a88f64e315c2a61f07b51` |
| headless | `report.json` (da análise) | 32.832 | `5e481a1cf45dd88527348a03c93f9845296dcc3cc1d93f91a3fd0aa811f81432` |
| headless | relatório bruto do cenário, A / B / C | 273.835 / 291.925 / 297.506 | `3fc49466f335603d47efefd61b9fb513a342993d52e570484afe1d909575ac56` / `6f6b6f52a7b0bc85177fb5adbaff79629fd8735855915d60f987e18d16994b4c` / `80975acc247ab5e01259133e3c2d3986d4c897a437086d6e44c973359e247fb7` |
| janelado, apresentada | `campaign.json` | 288.117 | `fe5ecde62b498ab905cf3a4055107c30b8f2491ca1b347f3b634f1eecb136bf5` |
| janelado, apresentada | `report.json` (da análise) | 30.990 | `26c876f1e2c70508a15c03df640be6abe28ba8841001aef94afc63af1db0a31d` |
| janelado, apresentada | relatório bruto do cenário, A / B / C | 366.661 / 390.751 / 395.369 | `14bfeb461277dbbe6aaa98a1a154e883629b2e3528a27040c554035f2fd7d92a` / `5a80efe40720d65c56ad157e65c6924c245e6ec6e87ab568dd2c14debb71f47e` / `436a4e96df4a3cb1acf066a2106bd2dbdaeac51148e76bb1fd97254f50787ec8` |
| janelado, sem limite | `campaign.json` | 284.039 | `9e31ad875ca8b6c4f9b839b3657eacca9c99dd6fe0e4633da859faf5ff4d3f69` |
| janelado, sem limite | `report.json` (da análise) | 30.988 | `e75f391837fb652100b7d7584b808e975ad99f521322a39620cc01d7b3f0d152` |
| janelado, sem limite | relatório bruto do cenário, A / B / C | 362.232 / 379.901 / 389.607 | `9cb290eeef9510e650b14b13db39d9f794184b9870c9813d9ab4e015692bc520` / `3b720a812cad9354195b80ea522b85eb9142ef2a3e5e670e14ccc02cf1862ec7` / `7f54d855d8ef09f7846a0b49b8f632be5aea4e9f25841f5688b5fc070fecbda5` |

Os três ensaios têm **os mesmos quatro hashes** no `summary.json`: o binário do motor (`c7cccbf8…`), a cópia provisionada como foi construída (`e0fe8389…`), os arquivos do roteiro (`ec178942…`) e o protocolo (`2319c9b6…`). Rodaram, portanto, o mesmo motor, a mesma cópia do jogo e o mesmo cenário.
O binário é o executável do motor e o pacote é a cópia provisionada, não um export: são os substitutos de um ensaio para os do build Release.

## O que o roteiro faz, passo a passo

O cenário instancia a cena do braço (A é `main_bare.tscn`, o jogo sem HUD; B é `main_native.tscn`, o HUD nativo do Godot; C é `main.tscn`, o HUD React Native), liga o instrumento de tempo de CPU (`tests/cpu-time-instrument.gd`, com o viewport da janela principal) e joga o roteiro. Um quadro é um quadro de processo; o instrumento lê todos, e um quadro só pertence a uma janela pelos números de quadro que o **traço** registra.

| Passo | O que o cenário faz | Regra do protocolo |
| --- | --- | --- |
| `boot` | Instancia a cena. Na faixa `unlimited`, pede `VSYNC_DISABLED` e lê de volta o modo. Em B e C mede o tempo até a HUD interativa: do começo do relógio do motor ao primeiro quadro em que os testIDs do contexto `none` existem e um clique de script em New game é aceito (a época do jogo sobe). Num ensaio janelado, só depois disso põe a janela na frente (`tests/window-presence.gd`: 12 quadros estáveis) e espera a HUD repousar. | `runs.script` `boot`; `time-to-interactive-hud`; `vsync` (o FPS só vale se o modo lido de volta é `DISABLED`; a taxa de atualização é lida, nunca assumida) |
| `idle` | 600 quadros sem nada injetado, com a HUD já em repouso. Grava o tempo de CPU e o intervalo de cada um e quantos o display desenhou. | `idleReference` |
| `replay` | Depois de um jogo novo, os 77 passos de `consumers/civ-lite/game/replay.gd` por `GameServices.callv`, esperando o trabalho de cada End Turn, e o hash do estado no fim. | `runs.script` `replay`: o hash dourado tem de bater; seus quadros ficam nos dados brutos e não pertencem a nenhuma janela. Os "73 intents" do protocolo viraram 77 com a emenda 3 ([#116](../../research/frontier-comparison-protocol.md#amendments)) |
| `soak` | Depois de um jogo novo, 100 turnos do jogador, cada turno uma sequência de intents que termina em End Turn. Janelas `ai-phase` e `event-burst`. | `runs.script` `soak`; 2 turnos de aquecimento e 98 medidos |
| `context-switches` | 24 + 50 intents que mudam o contexto do jogo, pelos sete contextos, num ciclo fixo (abaixo). | janela `context-switches` |
| `latency` | (B e C) 2 + 30 cliques reais em controles da HUD achados por testID na árvore viva, injetados como na linha de base do V05-06: `Driver.inject` de `tests/world-input-driver.gd` e `Input.flush_buffered_events()`, no centro do retângulo do Control. | `runs.script` `latency`; `click-to-panel`, em quadros |
| `stress` | 2 + 30 rodadas: `stress_begin()`, 20 `stress_step()` em quadros consecutivos, `stress_end()`. Os ganchos são os do #119; sem eles a janela é gravada como indisponível, com o motivo. | janela `stress` |
| `end` | Os 12 quadros de escoamento do instrumento depois da última janela; a memória residente, os nós da SceneTree e, em C, o heap do Hermes depois de uma coleta forçada e as views nativas; o processo sai com seu código. | `runs.script` `end`; o atraso de 6 desenhos do instrumento |

Entre duas intents que não são de uma janela o cenário espera **6 quadros de repouso** (`SETTLE_FRAMES`, o mesmo número da regra de aplicação quieta da faixa do turno) e, depois de um jogo novo ou de um *setup*, espera que o conjunto de Controls vivos fique igual pelo mesmo tempo. Esses quadros, as leituras e os *setups* não pertencem a nenhuma janela.
A latência clica no controle da pilha de duas unidades (Guerreiro e Colono, alternando) e depois em Clear selection, e o clique termina quando a HUD mostra os painéis do contexto de destino e só o marcador dele, lidos dos Controls e nunca do snapshot da Surface.

## As janelas e a regra única

Enquanto joga, o cenário grava um **traço** (`{frame, kind}`, com `frame = Engine.get_process_frames()`), em seis tipos (`end-turn-accepted`, `turn-ended`, `events-settled`, `context-switch`, `stress-begin`, `stress-step`), e no fim despeja as colunas do instrumento (`startUsec`, `totalMs`, `intervalMs`, `drawn`, `renderKnown` de todo quadro). **Ele não deriva janela nenhuma.** O orquestrador deriva as janelas do traço, junta cada uma às amostras pelo número do quadro e converte o tempo de CPU em microssegundos inteiros, com `Math.round(totalMs * 1000)`. **A regra das janelas é uma só e está em JavaScript** (`scripts/frontier-comparison-run-windows.mjs`); ela lê do protocolo, ao rodar, os números que o protocolo diz em frase e recusa um protocolo que deixe de dizê-los, e recusa um relatório em que uma ocorrência não terminou ou falta um quadro.

| Janela | Uma ocorrência é | Aquecimento + medidas | Quadros por ocorrência | Quadros contados nos nove ensaios |
| --- | --- | --- | --- | ---: |
| `ai-phase` | do quadro em que o End Turn é aceito ao último antes do que entrega `turn_ended` | 2 + 98 | 5 | 500 |
| `event-burst` | de `turn_ended` ao quadro anterior ao primeiro início de quadro em que os contadores do jogo e da HUD concordam, com no mínimo 5 quadros | 2 + 98 | 5 ou mais (**todas tiveram 5**) | 500 |
| `context-switches` | o quadro que recebe a intent que muda o contexto e os 2 seguintes | 24 + 50 | 3 | 222 (74 × 3) |
| `stress` | de `stress_begin()` ao segundo quadro depois do 20º `stress_step()` | 2 + 30 | 23 | 736 (32 × 23) |

Os quadros contados são iguais nas nove execuções (A, B e C no headless, na faixa apresentada e na ilimitada); o `event-burst` nunca passou do mínimo de 5 quadros, nem em C com o display de 120 Hz, e a regra de burst mais longo que o mínimo, que o ensaio janelado era o primeiro a poder mostrar, **não foi vista**.

**Por que a fase de IA tem cinco quadros aqui e seis na faixa do turno.** O protocolo a define de "the frame in which the End Turn intent is accepted" ao último antes do que entrega `turn_ended`, e as duas contagens a seguem. O cenário chama `end_turn()` de uma corrotina no começo do quadro, então a primeira fase roda nesse mesmo quadro: cinco quadros (fases 1 a 5, com `turn_ended` no quadro da sexta). Um clique real no HUD React Native é um evento de JavaScript tratado na bomba do host, que roda *depois* do `_process` de `GameServices`: a intent é aceita ali, a primeira fase roda no quadro seguinte, e o quadro que aceita é um quadro da janela sem fase: seis. Um clique real no HUD nativo trata o pressionamento dentro do `flush` do clique, no começo do quadro, e dá cinco, como a chamada direta. Medido nos braços B e C (a tabela completa, com os números dos quadros, está na [nota](../../research/frontier-comparison-execution.md#why-the-ai-phase-has-five-frames-here-and-six-in-the-turn-lane)). As intents do roteiro são entregues "at the game's intent boundary" nos três braços (`runs.fixed.input`), que é a chamada direta, então os três braços contam igual.

## O ciclo dos contextos

Os sete contextos (nenhum, tile, Colono, Guerreiro, pilha de duas unidades, cidade, diálogo) não cabem no estado de um jogo: o Colono só existe até `found_city`, a cidade só depois, e o diálogo só depois do fim do turno 4. O ciclo é feito de **rodadas**, uma rodada sendo um jogo, e segue a emenda 4 do protocolo ([#117](../../research/frontier-comparison-protocol.md#amendments)): uma ocorrência é o quadro que recebe a intent que muda o contexto, que é **uma intent de seleção para os seis primeiros contextos** e, para o diálogo, **o último `resolve_event`**, que o fecha. O que não é seleção e não é o fechamento do diálogo é *setup* e fica fora de toda janela: `found_city` é setup, e também as 4 End Turns que abrem o diálogo e os `resolve_event` anteriores.

**Uma rodada** é um jogo novo e 12 trocas:

| # | Intent | De | Para | *Setup* antes, fora de toda janela |
| ---: | --- | --- | --- | --- |
| 1 | `select_tile(6, 8)` | nenhum | pilha | |
| 2 | `select_unit(2)` | pilha | Guerreiro | |
| 3 | `clear_selection()` | Guerreiro | nenhum | |
| 4 | `select_tile(6, 8)` | nenhum | pilha | |
| 5 | `select_unit(1)` | pilha | Colono | |
| 6 | `select_tile(9, 8)` | Colono | tile | |
| 7 | `select_tile(6, 8)` | tile | pilha | |
| 8 | `select_unit(1)` | pilha | Colono | |
| 9 | `clear_selection()` | cidade | nenhum | `found_city(1)`: o Colono funda a cidade no tile inicial |
| 10 | `select_tile(6, 8)` | nenhum | cidade | |
| 11 | `clear_selection()` | cidade | nenhum | |
| 12 | `resolve_event("host")` | diálogo | nenhum | 4 End Turns (o jogo chega ao turno 5 com os três eventos na fila), `resolve_event("welcome")`, `resolve_event("buy_grain")` |

As **74 ocorrências** (24 de aquecimento e 50 medidas) são **6 rodadas inteiras de 12 e as 2 primeiras trocas de uma sétima**, cortadas onde a conta fecha: 7 jogos novos. As 24 de aquecimento são duas rodadas inteiras e as 50 medidas são as ocorrências 25 a 74, entre elas 4 fechamentos do diálogo. Entre duas ocorrências o cenário repousa 6 quadros e confere, em repouso, que o jogo está no contexto que o ciclo planeja e que a HUD (em B e C) mostra exatamente os painéis da linha da matriz para ele; confere também depois de cada *setup*. Os contextos alcançados nas 74: pilha 19, Guerreiro 7, nenhum 24 (6 deles o fechamento do diálogo), Colono 12, tile 6, cidade 6. Nos ensaios, B e C fizeram **93 conferências de paridade**, nos sete contextos, e todas bateram, nas duas faixas e no headless.

## A equivalência do jogador

`tests/frontier-comparison-player.gd` é o porte de `decide` de `tests/frontier-soak-fixture.jsx`: a mesma regra sobre o mesmo snapshot. Funda a cidade no tile inicial (6, 8); depois, a cada turno e uma vez cada, define a pesquisa e a produção se estão vazias, seleciona a cidade, seleciona e fortifica a primeira unidade não fortificada no tile, seleciona um tile vazio e limpa a seleção, e encerra o turno; um evento que bloqueia o jogo é respondido com a primeira escolha. Lê `GameServices.get_snapshot()` e responde a intent pelo nome e pelos argumentos que as ações do snapshot trazem; o cenário a envia por `GameServices.callv`, a fronteira do próprio jogo, de modo que as intents são as que o HUD React Native envia pelos serviços tipados. Não guarda relógio nem sorteia número.

**A equivalência** (`tests/frontier-comparison-player.test.mjs`): o soak do cenário no braço A, 100 turnos depois de um jogo novo com a semente do protocolo (4242), chega a

| | Valor |
| --- | --- |
| Hash final (`game.state_hash()` depois do turno 100) | `0b21c332c1f86fb41522cdbed0144f168831f6ab51bc427769a68a146aa6afd0` |
| Hash de trilha (o SHA-256 dos cem hashes de turno, um por linha) | `4d6d3c4c1078518f8971b76caef08a9b3ba6434c01fdc3658ce7787013d6371b` |
| Decisões | 429, nenhuma recusada |
| Jogo depois do soak | turno 101, os cem hashes de turno todos diferentes |

que são os números do soak de JavaScript **de hoje** (o [registro do civ-lite-ui](../civ-lite-ui/README.md), na seção dos três eventos do turno 5, e o seu [`report.json`](../civ-lite-ui/report.json), `afterTheChange`): o #93 acrescentou os três eventos do turno 5 e moveu o estado do jogo, e o `docs/research/frontier-soak.md` imprime os hashes de antes (`a35c55f2…` e `fe9d4f36…`), que ele mesmo marca como tais. Um **controle** no mesmo teste joga com uma guarnição de duas unidades em vez de seis (uma constante trocada na cópia): os hashes final e de trilha se movem e os hashes de turno se separam dos do jogador genuíno no turno 3. A equivalência é uma verificação que pode falhar, e diz onde.
**Nas nove execuções dos ensaios** o replay fechou em `cb7ab974f47f18c37ae96bda57ffd1b87f8c3733e251a386040dc17ccb540e8d` (77 passos, nenhum desvio de passo) e o soak em `0b21c332…` com a trilha `4d6d3c4c…` (100 turnos, 429 decisões, nenhuma recusa), nos três braços, no headless e nas duas faixas janeladas.

## O ensaio headless

Rodado pelo implementador, no commit fixado e com a árvore limpa, em 2026-10-10, com `--assume-refresh-hz 60`: um display headless lê a taxa de atualização `-1` e o formato exige uma taxa positiva (a análise recusa `refreshHz <= 0`), então o ensaio assume 60 Hz e **diz isso**, nos desvios da campanha e no `rehearsal.json` (`assumedRefreshHz`: lido −1, assumido 60, nos três braços). O build é Debug, o display é headless (não desenha e não ritma o laço) e a média de carga de 1 minuto foi de 5,93 a 5,22.

| | A | B | C |
| --- | ---: | ---: | ---: |
| Segundos | 51,8 | 56,7 | 75,4 |
| Quadros de processo | 7.449 | 8.042 | 8.168 |
| Carga de 1 minuto, antes → depois | 5,93 → 5,72 | 5,72 → 5,52 | 5,52 → 5,22 |
| Quadros de repouso (`idle`) | 600 | 600 | 600 |
| `ai-phase`, `event-burst` | 100 ocorrências (2 + 98), 500 quadros cada | o mesmo | o mesmo |
| `context-switches`, `stress` | 74 (24 + 50), 222 quadros; 32 rodadas (2 + 30), 736 quadros | o mesmo | o mesmo |
| Cliques da latência | não medida em A | 30 medidos (2 de aquecimento) | 30 medidos (2 de aquecimento) |
| Paridade | não medida em A | 93, sete contextos, todas batem | 93, sete contextos, todas batem |
| Notificações que o jogo emitiu e que a HUD consumiu, em repouso no fim | 2.256, sem consumidor | 2.306 e 2.306 | 2.307 e 2.307 |
| Erros (script, log do Godot, JavaScript), código de saída | 0, 0, 0, saída 0 | 0, 0, 0, saída 0 | 0, 0, 0, saída 0 |
| Rejeições da análise | `load:before`, `load:after`, `not-presented:intent-not-drawn`, `not-presented:idle-not-drawn`, `not-presented:not-paced`, `not-the-registered-build:build` | as mesmas | as mesmas |

Os ganchos do #119 existiam nos três braços (`stats()` em B e em C, `notifications_emitted()` e `stress_*` no jogo; A não tem HUD, logo não tem `stats()`), nenhuma janela ficou indisponível e a análise rodou a campanha inteira: `status: stopped` (o autoteste do instrumento não rodou), sem problema de formato e sem problema do orquestrador.

## O ensaio janelado, nas duas faixas

Rodado pelo líder da revisão, no commit fixado (o `summary.json` de cada faixa o registra), em 2026-10-10, de 10:59:32 a 11:05:18 UTC, com a janela do Godot 1080 × 600 num display de 3024 × 1964 com escala 2 (macOS, Apple M3 Pro, `opengl3`, `gl_compatibility`), **na faixa apresentada** (vsync `ENABLED`, lido de volta com 120 Hz) e **na faixa sem limite** (vsync pedido `DISABLED` e lido de volta `DISABLED`, 120 Hz). A faixa apresentada rodou de 10:59:32 a 11:03:50 (258 s) e a sem limite de 11:03:50 a 11:05:18 (88 s).
Os três braços foram **apresentados**: não há `not-presented` em nenhuma das seis execuções. O `drew.afterEveryMeasuredIntent` é verdadeiro e os 600 quadros de repouso foram desenhados em todas. Os quadros de processo são 12 a mais que no headless em cada braço (7.461, 8.054 e 8.180 contra 7.449, 8.042 e 8.168): são os 12 quadros estáveis que a janela espera para ficar na frente.

| | apresentada A | apresentada B | apresentada C | sem limite A | sem limite B | sem limite C |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Segundos | 65,0 | 69,5 | 90,0 | 7,7 | 9,7 | 40,1 |
| Vsync lido, taxa | `ENABLED`, 120 Hz | o mesmo | o mesmo | `DISABLED`, 120 Hz | o mesmo | o mesmo |
| Carga de 1 minuto, antes → depois | 5,60 → 4,91 | 4,91 → 5,36 | 5,36 → 5,87 | 5,08 → 4,99 | 4,99 → 5,46 | 5,46 → 6,00 |
| Janelas (ocorrências; quadros) | 100, 100, 74, 32; 500, 500, 222, 736 | as mesmas | as mesmas | as mesmas | as mesmas | as mesmas |
| Tempo até a HUD interativa (ms) | não medido em A | 853,9 | 830,2 | não medido em A | 674,3 | 907,9 |
| Paridade | não medida em A | 93, bate | 93, bate | não medida em A | 93, bate | 93, bate |
| Notificações emitidas e consumidas | 2.256 e nenhum consumidor | 2.306 e 2.306 | 2.307 e 2.307 | 2.256 | 2.306 e 2.306 | 2.307 e 2.307 |
| Heap do Hermes, views nativas | | | 2.330.840 bytes, 17 | | | 2.330.840 bytes, 17 |
| Erros, código de saída, anomalias | 0, saída 0, nenhuma | idem | idem | idem | idem | idem |
| Rejeições da análise | `load:before`, `load:after`, `not-the-registered-build:build` | as mesmas | as mesmas | as mesmas | as mesmas | as mesmas |

As **únicas rejeições** são a carga (antes e depois, em todas as seis) e o build Debug. Na faixa sem limite a faixa de FPS da análise está preenchida nas quatro janelas dos três braços; na apresentada e no headless não há `fps`, como o formato pede. **Os valores de FPS não estão neste registro** e, mesmo no relatório, não são resultado.
Para ver por que uma execução sozinha não diz nada: o tempo até a HUD interativa de B e de C **troca de ordem** entre os três ensaios (B 295 e C 404 no headless; B 854 e C 830 na faixa apresentada; B 674 e C 908 na sem limite), e o heap do Hermes mudou de 2.332.440 para 2.330.840 bytes.

**A carga.** Nenhuma execução passaria o limite de 2,0 do protocolo, antes nem depois (`runs.load.limit1MinuteAverage`). As médias de 1, 5 e 15 minutos, lidas pelo líder antes e depois de cada faixa (`windowed-state.txt`): antes da apresentada `{6,83 6,83 6,44}`; depois da apresentada e antes da sem limite `{5,87 6,05 6,15}`; depois da sem limite `{6,08 5,98 6,11}`.
**O amostrador** (`windowed-sampler.txt`) leu a carga a cada 15 s durante as duas faixas, 23 amostras: a média de 1 minuto ficou **entre 4,87 e 6,83 (mediana 5,59)**, 6,83 na primeira amostra, antes de a primeira execução começar. Em cada amostra o amostrador contou também os processos de outros agentes ativos: **6 amostras viram 0, 16 viram 1 e uma viu 2** (a das 11:04:04, no começo da faixa sem limite); o líder não identificou qual era o processo. A pausa dos outros agentes foi pedida no quadro antes do ensaio e, mesmo assim, em 17 das 23 amostras o amostrador viu ao menos um processo de outro agente ativo. A carga não se explica só por eles, já que estava em 6,83 com 0 processos ativos na primeira amostra.

**A ausência do usuário.** O líder leu o tempo ocioso da máquina antes de cada faixa (`idle=` do `windowed-state.txt`, em segundos): **60.645 s** antes da apresentada (cerca de 16 h 50 min) e **60.903 s** antes da sem limite. A diferença, 258 s, é exatamente a duração da faixa apresentada, 10:59:32 a 11:03:50: o relógio do tempo ocioso correu junto com o relógio de parede, então **nenhuma entrada chegou à máquina entre as duas leituras**, e as 16 h 50 min anteriores à primeira também foram sem entrada. Não há leitura depois da faixa sem limite, então o que se sabe dos 88 s dela é que a leitura anterior já dizia 60.903 s.

## Os custos de leitura

Cada leitura do cenário que não é o tempo de CPU de um quadro, o que custa e se cai num quadro medido (faixas de custo: as nove execuções dos três ensaios, em máquina não quieta; são custos das leituras e não de um braço):

| Leitura | Quando | Custo | Em quadro medido? |
| --- | --- | --- | --- |
| Memória residente (`ps -o rss=`) | em repouso, depois do boot, do idle, do replay, do soak, das trocas, da latência, do estresse e do fim | 4,9 a 45,2 ms (um processo é lançado) | não |
| Nós da SceneTree | no fim | 2 a 73 µs | não |
| Heap vivo do Hermes depois de coleta forçada, e views nativas (braço C) | no fim, depois do escoamento | 15,7 a 22,1 ms | não |
| Paridade (painéis visíveis contra a matriz de contextos) | em repouso, depois de cada troca, de cada *setup* e do boot | 9,0 a 13,5 µs (B e C) | não |
| Snapshot do jogador (`get_snapshot()`) | em repouso, antes de cada decisão | 48,8 a 85,5 µs | não |
| Entrada do traço | nos quadros de janela | 0,28 a 0,63 µs | **sim** |
| `notifications_emitted()` | a partir do 5º quadro do burst (em A, do 4º) | 0,11 a 0,19 µs | **sim** |
| `stats()` da HUD, B | idem | **0,86 µs** no registro; 0,65 a 1,0 µs nos ensaios | **sim** |
| `stats()` da HUD, C | idem | **4,5 µs** no registro; 4,3 a 4,8 µs nos ensaios | **sim** |

O custo de `stats()` no registro vem de [`docs/evidence/frontier-stress/costs.json`](../frontier-stress/costs.json): a mediana por leitura em 20.000 leituras, headless, com a máquina sob carga (`arms["b-new"].statsUs.median` e `arms["c-new"].statsUs.median`, com dois dígitos), e está na procedência de cada ensaio (`rehearsal.json`, `provenance.readCosts`). O `stats()` de C **não avalia JavaScript**: lê o nó `HudStats` de `main.tscn`, que lê os contadores nativos do registro (`FabricApplication.service_delivery`). **Dois caminhos que um quadro medido não pode tomar** estão registrados para que fique claro o que foi evitado: avaliar JavaScript (cerca de 100 µs por leitura) e ler o snapshot da Surface (cerca de 570 µs).
Os dois nós de validação de `main.tscn` e `main_native.tscn` (`hud_validation.gd` e `overlay_validation.gd`) custam cerca de **0,7 µs por quadro**, igual em B e C, e não pesam nos quadros medidos; não foram mexidos. A conta e a incerteza estão na [nota](../../research/frontier-comparison-execution.md#the-validation-nodes-of-maintscn).

## O que falta para a campanha

- **A parte 2 do critério `execucao`**: a sequência de 36 execuções em cada faixa (o quadrado latino), as tentativas (no máximo 3 por vaga) e a refeita pela carga, as duas faixas, o registro dos hashes antes da primeira execução, os dados brutos sob `docs/evidence/` e a leitura do vsync da faixa sem limite.
- **O V05-07, o export Release do civ-lite nos três braços** (A e B também): os hashes do binário e do pacote, o tamanho do export duas vezes. O cenário é um script de `SceneTree` que roda com `-s` a partir de um projeto; **como ele roda dentro de um `.app` exportado** (um template de export pode não aceitar `-s`, e o cenário talvez tenha de ser a cena principal do projeto exportado ou um autoload) **está em aberto** e é daquela fatia. A pergunta foi feita a quem a tem e continua **sem resposta** até este registro.
- **O autoteste do instrumento** na máquina da campanha e o hash dele registrado (`cpu-time-instrument` `gate`). Os ensaios não o rodaram (`instrument.selfCheckPassed` é falso, por isso `status: stopped`).
- **Uma janela quieta**: a média de carga de 1 minuto de 2,0 ou menos antes e depois de cada execução, com display apresentado e o usuário ausente. O ensaio janelado mediu de 4,87 a 6,83.
- O texto da decisão e o relatório são de `relatorio`, que este registro não toca.

## Os limites

- **Todo número aqui é de um ensaio**: Debug, uma execução por braço por ensaio, máquina não quieta, sem autoteste do instrumento, sem export. Mostram que o roteiro roda e o que ele conta, não como um braço se comporta. A análise rodou sobre cada ensaio e o rejeitou, como deve.
- **O headless não é uma faixa da campanha**: o display não desenha nem ritma o laço, a taxa de atualização foi assumida em 60 Hz, e a análise o rejeita como `not-presented`. Ele existe para provar que o roteiro roda e conta o que o protocolo manda, sem uma janela.
- **O ensaio janelado foi um por faixa**, sem repetição: os tempos de uma execução variam mais entre ensaios do que as diferenças que a campanha vai procurar (o tempo até a HUD interativa acima). Quem lê um número destes como medição de um braço está lendo errado.
- **Os 6 quadros de repouso entre intents são uma regra, não uma verificação de que a bomba do React Native terminou.** O ensaio janelado foi a primeira vez em que uma bomba ainda ocupada apareceria nos quadros depois de uma janela, e as anomalias vieram vazias e a paridade bateu em todas as conferências; isso não prova que a bomba estava ociosa.
- **A janela tem 1080 × 600 e o display 120 Hz**: é a janela do consumidor nesta máquina, não uma exigência do protocolo que este registro tenha conferido.
- Os braços A e B não têm host, então as leituras de C que o exigem (o heap, as views, os erros do host) existem só nele, como o protocolo diz.
- **Leituras do texto do protocolo** que o cenário teve de escolher estão listadas, uma a uma, na [nota](../../research/frontier-comparison-execution.md#readings-of-the-protocol-that-were-chosen); nenhuma muda um número do protocolo.

## Reproduzindo

Os caminhos de saída dos comandos abaixo são do usuário; o orquestrador não grava nenhum caminho local nos arquivos que escreve. Os tempos não se reproduzem byte a byte (são medições), e os SHA-256 acima são os dos arquivos que estes ensaios escreveram.

```sh
node --test tests/frontier-comparison-run.test.mjs                  # só Node; parte de npm run test:contracts
npm run test:frontier-comparison-run                                  # nativo, headless: o jogador e o ensaio nos três braços
node scripts/frontier-comparison-run.mjs --rehearsal --arms A,B,C --lane presented --assume-refresh-hz 60 --out <diretório>
node scripts/frontier-comparison-run.mjs --rehearsal --arms A,B,C --lane presented --windowed --out <diretório>   # janelado, apresentada
node scripts/frontier-comparison-run.mjs --rehearsal --arms A,B,C --lane unlimited --windowed --out <diretório>   # janelado, sem limite
node scripts/frontier-comparison-analysis.mjs --check-format <diretório>/campaign.json
```

Os dois últimos ensaios abrem uma janela do Godot na frente e exigem que o usuário esteja ausente e que nada mais rode na máquina; sem isso a carga volta a ser rejeitada.

## As verificações do commit de evidência

Rodadas na árvore que acrescenta esta pasta, o índice e a nota ao commit fixado `7e2e5b1` (a `main` não andou: `git fetch` não trouxe nada além do que o commit já contém).

| Verificação | Resultado | Observação |
| --- | --- | --- |
| `npm run check:publication` | passou | 2.090 arquivos, sem falhas (a varredura inclui esta pasta: nenhum caminho local) |
| `npm run check:static` | `No issues found` | |
| `npm run test:dashboard` | 43/43 | |
| `node scripts/agents.mjs check` | sem conflitos | só os avisos de arquivo compartilhado (`docs/evidence/README.md`, `package.json`), que o orquestrador funde em sequência |

## CI hospedada e Pages

**O run.** O push da `main` em `c3892ac` (o squash do #120; run [38050941623](https://github.com/journey-studios/godot-fabric/actions/runs/38050941623) do workflow Contracts, iniciado às 12:09:34 UTC) passou na primeira tentativa, sem reexecução, nos três jobs que um push roda: `contracts` (3 min 26 s), `reference-android` (6 min 35 s) e `reference-ios` (9 min 52 s). Os outros cinco (`native-cold-start`, `native-suites-frontier`, `native-suites-input`, `native-suites-runtime` e `parity-comparison`) aparecem como **skipped**; o [recibo](hosted-ci.json) os registra assim e só os aceita porque a linha da fatia não tem passo nativo nem artefato.

**O passo da guarda.** "Milestone exit guards (X9 and X10)" passou num push e imprimiu `MILESTONE_GUARDS_CHECK_PASSED: against 151427e5c788 (--base 151427e5c788ab5704ace25fd64d6c38958e4963); X9 clean, X10 clean`. A base é o pai do squash.

**Os testes.** `npm run test:contracts` passou com 7, 43 e 535 testes de Node, todos em `pass`, sem falha, e 13 de Python. O recibo confere, pelo nome e no log do job `contracts`, os 17 testes de nível superior de `tests/frontier-comparison-run.test.mjs` (17 de 17), o arquivo que o #120 criou.

**O Pages.** O push de `c3892ac` rodou também o workflow do Pages (run [38050941565](https://github.com/journey-studios/godot-fabric/actions/runs/38050941565), 12:09:34 a 12:10:09 UTC, `build` e `deploy` em success, 43 testes do painel). O [recibo](publication.json) registra o deployment 6980511769 em success e o artefato `github-pages` (id 11668844677, SHA-256 `3757e770…`, igual ao digest da API e ao do log de upload). O `migration.json` de dentro tem os mesmos bytes do `dashboard/migration.json` do squash, e a entrada de atividade da fatia, `milestone-0-5-v05-10-execution-1-f77d81d`, está nele. Um push seguinte da `main` substitui o deployment, então o site público não foi comparado.

**O que continua só local:** nenhuma medição de braço entra nesta fatia. Os recibos hospedados provam o código e os testes do runner, não um resultado; a execução comparativa de fato (a sequência de execuções em cada faixa) continua fora deste registro.

```sh
node scripts/hosted-receipts.mjs --write --slice frontier-comparison-execution --work-dir <diretório fora do repositório>
node scripts/hosted-receipts.mjs --check
```
