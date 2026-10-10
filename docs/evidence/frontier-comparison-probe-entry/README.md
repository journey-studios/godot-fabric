# O autoteste do instrumento pelo main loop de um projeto de sonda (V05-10)

> **É UMA VERIFICAÇÃO DA ENTRADA. NENHUM NÚMERO DESTA PASTA É RESULTADO.** O autoteste do instrumento rodou **uma vez por entrada**, num build **Debug**, num display **headless**, contra o **binário do editor** (Godot 4.7.2-stable), em macOS arm64.
> A entrada `release`, a do `.app` exportado, **rodou só contra um `.app` falso**, em Node: **nenhum projeto de sonda foi exportado**, nenhuma janela abriu e nenhuma campanha rodou.
> Os checks são comparados pelos nomes e pelos vereditos; **os tempos não se comparam**. Esta fatia entrega a **entrada** do autoteste para o critério `execucao` do V05-10 e **não fecha nenhum critério**; não move checkpoint, nota, peso nem denominador do 1.0.

O autoteste do instrumento (`tests/cpu-time-instrument-probe.gd` e o oráculo `tests/cpu-time-instrument-oracle.mjs`) é o portão de toda campanha, e o congelado (`cpu-time-instrument`, campo `gate`) pede que ele rode de novo no motor da campanha. Num template Release o `-s`/`--script` é descartado em silêncio e o `--path` aborta, então a sonda não pode ser chamada pela linha de comando. Ela é um `SceneTree`, e passa a entrar como o **main loop de um projeto de sonda pequeno**, igual ao do roteiro ([a nota da entrada](../../research/frontier-comparison-entry.md#the-instruments-self-check-through-the-main-loop)). Esta pasta registra a prova no Debug, headless. O `.app` exportado desse projeto, com o mesmo template dos três braços, vem na fatia dos conjuntos por braço.

## O que mudou

- [`scripts/frontier-comparison-probe-project.mjs`](https://github.com/journey-studios/godot-fabric/blob/c489a017eb0695de91e46dd83112cbf934a4ac63/scripts/frontier-comparison-probe-project.mjs): `prepareProbeProject(directory)` faz um diretório novo com o `project.godot` mínimo (`gl_compatibility`, o renderizador do civ-lite), a sonda e o instrumento copiados nos mesmos caminhos, o invólucro `class_name CpuTimeInstrumentProbeEntry`, a cena vazia e o `override.cfg`, e roda o `--import` do editor. Devolve os caminhos e os SHA-256 dos arquivos; o do instrumento tem de ser o do repositório.
- [`scripts/frontier-comparison-campaign-instrument.mjs`](https://github.com/journey-studios/godot-fabric/blob/c489a017eb0695de91e46dd83112cbf934a4ac63/scripts/frontier-comparison-campaign-instrument.mjs): `runSelfCheck` ganha `entry` (`script`, o padrão de antes; `main-loop`; `release`) e `selfCheckArguments`, a função pura dos argumentos. As três passam pelo mesmo julgamento: o oráculo, o log, `presented` na janela e o SHA-256 do instrumento.
- [`tests/cpu-time-instrument-probe.gd`](https://github.com/journey-studios/godot-fabric/blob/c489a017eb0695de91e46dd83112cbf934a4ac63/tests/cpu-time-instrument-probe.gd): a única mudança na sonda, `--report=<caminho absoluto>` grava nesse caminho (`--report=<nome>` continua gravando em `res://build/<nome>`). `tests/cpu-time-instrument.gd`, o instrumento congelado, não foi tocado.
- [`scripts/frontier-comparison-release.mjs`](https://github.com/journey-studios/godot-fabric/blob/c489a017eb0695de91e46dd83112cbf934a4ac63/scripts/frontier-comparison-release.mjs) e [`scripts/frontier-comparison-campaign-launchers.mjs`](https://github.com/journey-studios/godot-fabric/blob/c489a017eb0695de91e46dd83112cbf934a4ac63/scripts/frontier-comparison-campaign-launchers.mjs): o diretório dos exports pode ter `probe/frontier-comparison-export.json` (`arm: "probe"`). Com ele, `prepare()` confere os hashes do `.app` da sonda, o instrumento do repositório nos arquivos dela e que o `templateSha256` é o de cada um dos três braços, e o lançador Release expõe `selfCheck: { entry: "release", executable }` em vez de `"unsupported"`. Sem ele, a recusa é a de antes. A campanha ([`scripts/frontier-comparison-campaign.mjs`](https://github.com/journey-studios/godot-fabric/blob/c489a017eb0695de91e46dd83112cbf934a4ac63/scripts/frontier-comparison-campaign.mjs)) só passa o `selfCheck` do lançador ao `runSelfCheck` (uma linha de código).
- [`tests/frontier-comparison-probe-project.test.mjs`](https://github.com/journey-studios/godot-fabric/blob/c489a017eb0695de91e46dd83112cbf934a4ac63/tests/frontier-comparison-probe-project.test.mjs): 8 testes Node, o projeto de sonda, os argumentos e as três entradas contra uma sonda e um oráculo que o teste fornece. [`tests/frontier-comparison-release.test.mjs`](https://github.com/journey-studios/godot-fabric/blob/c489a017eb0695de91e46dd83112cbf934a4ac63/tests/frontier-comparison-release.test.mjs) e o [`.app` falso](https://github.com/journey-studios/godot-fabric/blob/c489a017eb0695de91e46dd83112cbf934a4ac63/tests/frontier-comparison-release-fake-app.mjs) ganham 5 testes: com a sonda a campanha roda o autoteste pela entrada `release` e segue; sem ela recusa; com outro template recusa e não inicia nada.
- [`tests/frontier-comparison-probe-native.test.mjs`](https://github.com/journey-studios/godot-fabric/blob/c489a017eb0695de91e46dd83112cbf934a4ac63/tests/frontier-comparison-probe-native.test.mjs): o teste nativo, headless, `npm run test:frontier-comparison-probe`. Prepara o projeto de sonda num temporário e o apaga ao terminar.

## Registro fixado

O código e os testes estão no commit [`c489a01`](https://github.com/journey-studios/godot-fabric/commit/c489a017eb0695de91e46dd83112cbf934a4ac63). A rodada nativa desta pasta foi refeita nessa árvore já commitada, com a árvore de trabalho limpa, no motor Godot 4.7.2-stable (`4.7.2-stable (official)`), Debug, headless, em macOS arm64 (macOS 26.6.2). O `summary.json` abaixo é o dessa rodada, copiado sem editar; os SHA-256 do projeto de sonda são os mesmos da rodada anterior à do commit.

## As duas entradas julgam os mesmos 10 checks

Os dois processos, headless: `main-loop` roda `Godot --path <projeto de sonda> --headless -- --report=<pasta do autoteste>/probe-report.json`, **sem `--script`**, com o relatório num caminho absoluto; `script` roda `Godot --path <raiz do repositório> --headless --script res://tests/cpu-time-instrument-probe.gd -- --report=cpu-time-instrument-campaign-report.json`, como o `npm run test:cpu-time-instrument` roda. O teste confere que os argumentos do `main-loop` não têm `--script` nem `-s` e que o relatório existe no caminho absoluto.

| Entrada | Autoteste | Saída do processo | Checks | Falhos | Oráculo | Violações |
| --- | --- | --- | ---: | --- | --- | --- |
| `main-loop` | passou | 0 | 10 | nenhum | julgou | nenhuma |
| `script` | passou | 0 | 10 | nenhum | julgou | nenhuma |

Os checks, pelos nomes do relatório. Os nomes e os vereditos são **os mesmos** nas duas entradas, na mesma ordem (o teste compara as listas de nomes e as de `passed`).

| # | Check | `main-loop` | `script` |
| ---: | --- | --- | --- |
| 1 | `schedule/Every scheduled frame of the run has a sample of the instrument` | passou | passou |
| 2 | `instrument/The samples are of consecutive process frames, in order, none twice` | passou | passou |
| 3 | `instrument/Every measured frame has all its terms: the render reading of each drawn frame had arrived` | passou | passou |
| 4 | `load/The busy loop of every load block ran its target, as Time.get_ticks_usec measured it (the field truth)` | passou | passou |
| 5 | `accuracy/The median total minus the idle median is within 10% of the 2 ms load` | passou | passou |
| 6 | `accuracy/The median total minus the idle median is within 10% of the 5 ms load` | passou | passou |
| 7 | `accuracy/The median total minus the idle median is within 10% of the 10 ms load` | passou | passou |
| 8 | `accuracy/The median total minus the idle median is within 10% of the 20 ms load` | passou | passou |
| 9 | `cpu/The idle total is a small part of the idle interval: the instrument reads CPU time and not the interval between frames` | passou | passou |
| 10 | `cpu/The process term changes from frame to frame in the load blocks, as a clock does and a monitor refreshed once a second does not` | passou | passou |

Os dois relatórios têm o mesmo motor e o mesmo display server (headless). O check do pulso de render (`render/…`) só existe numa janela e **não rodou aqui**. Nenhum tempo das duas rodadas foi comparado, e o `summary.json` não guarda nenhum.

## Os controles negativos

Com o projeto de sonda já provado, o teste o estraga de duas maneiras e roda o autoteste pela entrada `main-loop` com um **limite de 15 s** para o processo. Nos dois o motor não entra na sonda, **nenhum relatório é escrito** e o autoteste falha com as mesmas razões:

| Controle | O que o motor faz | `passed` | Razões do autoteste |
| --- | --- | --- | --- |
| o projeto de sonda **sem o `override.cfg`** | não há cena principal: imprime `Error: Can't run project: no main scene defined in the project.` e fica parado até o autoteste matar o processo | `false` | `the probe ended with signal SIGTERM`; `the probe wrote no report` |
| o `override.cfg` com `run/main_scene` (a cena vazia) e **sem `run/main_loop_type`** | roda a cena vazia, que não faz nada, até o autoteste matar o processo; o log não tem a linha do erro acima nem nenhuma `CPU_TIME_INSTRUMENT` | `false` | `the probe ended with signal SIGTERM`; `the probe wrote no report` |

**Uma leitura da spec.** A spec dizia que, sem o `override.cfg`, o projeto "roda a cena vazia". Isso não acontece: sem `override.cfg` o `project.godot` não nomeia cena principal, e o motor reclama e fica parado. Por isso o teste tem os dois controles; o segundo é o que roda a cena vazia de verdade, e mostra que é o `run/main_loop_type` que leva à sonda. A razão que a spec pedia, `the probe wrote no report`, está nos dois.

## Os SHA-256 do projeto de sonda

O projeto de sonda tem 84 KB com o cache do `--import`. Os hashes são dos arquivos como estão no projeto preparado. O instrumento é o do repositório, byte a byte (`4bdcda83…` é o `tests/cpu-time-instrument.gd` de `main`); o hash da sonda é o do arquivo deste commit e muda com ela. O do conjunto é o `scriptsOf` dos seis arquivos, o que o manifesto da sonda levará em `scriptSha256`.

| Arquivo no projeto | SHA-256 |
| --- | --- |
| `project.godot` | `f4254b28d44fcf5b1027ffd50cae8ebb012d9272e309435e1290ae2ac4daac1f` |
| `tests/cpu-time-instrument-probe.gd` | `c75adee594e3ef21c422b9a772732c56c15df9922f4477ed68d4bf903df31b0a` |
| `tests/cpu-time-instrument.gd` | `4bdcda83771c38221b3e9da47bdca2622ac4bda119d0b41809e83bceabf28c9d` |
| `tests/cpu-time-instrument-probe-entry.gd` | `08ed68565aa10f0fc17ddfe5a8d685747d4d098ebd59213ea9eee14e6ace8a33` |
| `tests/cpu-time-instrument-probe-empty.tscn` | `a0da99637da1296c67f0ec75e39c195c2ba894b735af04a80a76cec5bf18aac7` |
| `override.cfg` | `19be22c94492776bd6fb574d4001207c1cde0c841b69a78af3a847b3511cdb10` |
| o conjunto (`scriptsOf`) | `5909a07487620b063bde34c949a9886d3dd740e896fdd82629de2edaf1883a8d` |

## O que há nesta pasta

| Arquivo | Bytes | O que é |
| --- | ---: | --- |
| [`summary.json`](summary.json) | 4.001 | o resumo que o teste nativo escreve (`build/frontier-comparison-probe-entry/summary.json`), copiado sem editar: a nota, o motor, por entrada o veredito, os nomes dos 10 checks, os falhos e o oráculo, `sameChecks`, os SHA-256 do projeto de sonda e os dois controles com as razões |

Não commitados: o log e o relatório bruto de cada processo (o relatório tem cerca de 190 KB), que o teste regera numa pasta temporária e apaga ao terminar. O nome é `summary.json` de propósito: `docs/evidence/**/*-report.json` é ignorado pelo git, e `git check-ignore` confirma que este arquivo não é.

## Verificações

Rodadas na árvore que virou o commit `c489a01`. O `test:contracts` rodou antes de um último ajuste (um `export` a menos no `.app` falso, que o `check:static` apontou); os cinco arquivos Node da primeira linha foram rodados de novo depois dele.

| Verificação | Resultado | Observação |
| --- | --- | --- |
| `node --test tests/frontier-comparison-probe-project.test.mjs tests/frontier-comparison-release.test.mjs tests/frontier-comparison-campaign.test.mjs tests/frontier-comparison-campaign-guards.test.mjs tests/cpu-time-instrument.test.mjs` | 75 testes, verdes | 8 do projeto de sonda, 18 do Release (5 novos) |
| `npm run test:frontier-comparison-probe` (nativo, headless, Debug) | 1 teste, verde, cerca de 74 s | a duração é a do teste inteiro, com as duas entradas e os dois controles |
| `npm run test:cpu-time-instrument` (nativo, headless, Debug) | 1 teste, verde, cerca de 20 s | a sonda com a única mudança do caminho do relatório |
| `npm run test:contracts` | verde: 681 aprovados, 1 pulado | o pulado é o do export nativo sem `MACOS_EXPORT_TEMPLATE`, anterior a esta fatia; nenhum `.skip` novo |
| `npm run test:dashboard` | 43 testes, verdes | |
| `npm run type-check`, `npm run check:static`, `npm run check:publication` | verdes | |
| `node scripts/milestone-guards.mjs --check --base origin/main` | passou | |

Três mutações mostraram que os testes novos podem falhar: tirar a conferência do template no `prepare()` quebra os testes da recusa e o da campanha; tirar o `...launcher.selfCheck` da chamada do `runCheck` quebra o da campanha; e fazer a entrada `release` rodar com `--script` quebra os dos argumentos, do `.app` falso e da campanha. Os arquivos foram restaurados depois.

## O que este registro não mostra

- **A sonda como `.app` Release.** O projeto de sonda não foi exportado. A entrada `release` rodou **só contra um `.app` falso** em Node (um executável que lê `--report=` e escreve um relatório mínimo), com um oráculo injetado. Que um template oficial aceite `--headless` e `--report=<caminho absoluto>` como o binário do editor aceita, e onde o `override.cfg` entra no `.app` (o pacote ou `Contents/MacOS/`), ficam para a fatia que exporta a sonda com `frameworks: false`, `exportFiles` e o manifesto `probe/frontier-comparison-export.json`.
- **O autoteste numa janela.** Nada aqui abriu uma janela: o check do pulso de render e o `presented` só existem lá, e são da máquina da campanha.
- **Uma campanha.** Nenhuma rodou, e nenhum número desta pasta é medida de um braço.
- Os recibos hospedados (CI e Pages) desta entrega serão registrados depois da mescla.

## Reproduzindo

```sh
node --test tests/frontier-comparison-probe-project.test.mjs tests/frontier-comparison-release.test.mjs   # Node: o projeto, as três entradas, o manifesto da sonda
npm run test:frontier-comparison-probe                                                                      # nativo, headless: main-loop e script julgam os mesmos checks; os controles
npm run test:cpu-time-instrument                                                                            # nativo, headless: a sonda como antes
```
