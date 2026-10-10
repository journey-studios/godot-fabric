# A entrada do roteiro da execução comparativa (V05-10): o roteiro como main loop do projeto de medição

> **É UM ENSAIO DE ENTRADA. NENHUM NÚMERO DESTA PASTA É RESULTADO.** O roteiro rodou **uma vez em cada braço**, num build **Debug**, num display **headless**, pela entrada nova (o main loop do projeto de medição, sem `-s`), e uma vez em cada braço pela entrada antiga (`-s`), como controle.
> As contagens e os hashes das duas entradas são comparados; **os tempos não se comparam**. Nenhuma campanha rodou. As três execuções pela entrada nova foram **rejeitadas pela análise**, como um ensaio deve mostrar (`not-the-registered-build`, `not-presented` num display headless e `load` numa máquina que não está quieta), e o relatório sai com `status: stopped`.
> Nada aqui diz que o HUD React Native é mais rápido, mais lento ou igual ao nativo. Esta fatia entrega a **entrada** do critério `execucao` do V05-10 e **não fecha nenhum critério**; não move checkpoint, nota, peso nem denominador do 1.0. Não muda código de produto.

O protocolo roda o roteiro num processo novo por execução e a campanha tem de rodá-lo **igual no Debug e no Release**. Um template de export descarta o `-s`; por isso o roteiro entra como o **main loop** do projeto de medição, que um `.app` Release do mesmo projeto também aceita. A [nota de pesquisa](../../research/frontier-comparison-entry.md) traz as linhas da fonte do Godot 4.7.2-stable que dizem isso, onde o `override.cfg` é lido em cada caso, os hashes, a cena vazia e a sonda; esta página registra o ensaio. A [nota da execução](../../research/frontier-comparison-execution.md) e esta página dizem as mesmas coisas.

## O que mudou

- `scripts/frontier-comparison-run.mjs` escreve três arquivos na cópia provisionada do civ-lite: `comparison/frontier-comparison-entry.gd` (duas linhas: `class_name FrontierComparisonEntry` e `extends "frontier-comparison-scenario.gd"`), `comparison/frontier-comparison-empty.tscn` (a cena principal: um `Node` vazio) e `override.cfg` (`run/main_scene` e `run/main_loop_type`), e roda o `--import` do editor depois da cópia para a classe entrar no cache de classes globais. O `project.godot` do produto não é tocado.
- `launchScenario` roda `godot --path <cópia> --headless|--windowed -- --arm=… --lane=… --out=<caminho absoluto>`, sem `-s`; os argumentos depois do binário saem de uma função pura, `scenarioArguments`, que o lançador Release vai reaproveitar em `Contents/MacOS/<executável>`.
- O roteiro libera a cena vazia no `_initialize` (para `scene-nodes` contar a mesma árvore) e registra `provenance.mainLoop` no relatório. A mensagem de recusa do lançador Release diz que a entrada está definida e que falta o export do civ-lite nos três braços.
- O lançador Debug passa `timedOut` adiante (`error.code === "ETIMEDOUT"` do `spawnSync`).

## Registro fixado

O ensaio rodou no commit [`afe52f2`](https://github.com/journey-studios/godot-fabric/commit/afe52f2234126113441dfeff5b1b3af099c72952) (o commit da entrada, `da7eff5`, com a `main` mesclada), com a **árvore de trabalho limpa** no instante em que a cópia foi provisionada (`comparison.json`, `tree`). O hash do pacote guarda o commit e se a árvore está suja (o `manifest.json` do `pack-addon`), então **o valor dele é o desta execução**; o do roteiro e o do binário não dependem do commit.

| Hash | Valor | Observação |
| --- | --- | --- |
| binário (o executável do motor) | `c7cccbf8fb143e34e02fd6521e09be2c2b974f0d5db080b19071c9c570718ccf` | o mesmo do último ensaio por `-s` |
| pacote (a cópia provisionada, sem `.godot`, `comparison/` e `override.cfg`) | `314dac74969bbeffe84b0bc35374fba08f46473fb2922a8e2d439a3d10df449e` | muda com o commit e com a árvore; o do ensaio antigo (`e0fe8389…`) é de outro commit |
| roteiro (os arquivos do cenário e de apoio, **mais** o invólucro, a cena e o `override.cfg`) | `40b56bf258435e3bbcd2277181e9696e9a053d45054fff3612e3252aae6d9768` | o do ensaio antigo (`ec178942…`) não tinha os três arquivos da entrada |
| protocolo | `2319c9b6fbe39262c932c439a5642525818ea4d3e0c66f278f8039d491526f93` | o mesmo do ensaio antigo |

SHA-256 do **texto** de cada arquivo que o executor escreve na cópia (são constantes de `scripts/frontier-comparison-run.mjs`, `MEASUREMENT_FILES`, e entram, por caminho, no hash do roteiro):

| Arquivo na cópia | Bytes | SHA-256 |
| --- | ---: | --- |
| `comparison/frontier-comparison-entry.gd` (o invólucro) | 77 | `db3a43b4899cfb7aff3151dabadf20a1b022ba84684449c9972a549b4b2abc06` |
| `comparison/frontier-comparison-empty.tscn` (a cena vazia) | 71 | `89caa232be3c3deebc55224b526538cad3d692f9828ba1ad47573400f354e204` |
| `override.cfg` (a configuração de medição) | 143 | `53405dd2d4a2fef3bebf622ae3d39316b74fd384bafaa5552f304e30734ba560` |

## A comparação: as mesmas contagens pela entrada nova, pelo `-s` e no último ensaio por `-s`

Os três braços, headless, faixa apresentada, na **mesma cópia**: pela entrada nova, e pelo `-s` com o `override.cfg` removido (o controle: o arquivo do cenário, do jeito antigo). A terceira coluna é o último ensaio por `-s` guardado em [`../frontier-comparison-execution/headless/summary.json`](../frontier-comparison-execution/headless/summary.json) (pinado em `7e2e5b1`), que **não registrou `scene-nodes`**: esse valor só existe nas duas primeiras. `comparison.json` tem as três lado a lado, por braço.

| | A | B | C |
| --- | --- | --- | --- |
| `scene-nodes`, main loop / `-s` | 4 / 4 | 31 / 31 | 30 / 30 |
| hash dourado do replay (77 passos), os três | `cb7ab974f47f18c3…` | `cb7ab974f47f18c3…` | `cb7ab974f47f18c3…` |
| hash final do soak (100 turnos, 429 decisões, 0 recusas), os três | `0b21c332c1f86fb4…` | `0b21c332c1f86fb4…` | `0b21c332c1f86fb4…` |
| ocorrências de `ai-phase`, `event-burst`, `context-switches`, `stress` (medidas) | 100, 100, 74, 32 (98, 98, 50, 30) | idem | idem |
| quadros dessas quatro janelas | 500, 500, 222, 736 | idem | idem |
| checagens de paridade (todas casam) | nenhuma: A não tem HUD | 93 | 93 |
| notificações emitidas / consumidas, main loop e `-s` | 2256 / não há consumidor | 2306 / 2306 | 2307 / 2307 |
| quadros de repouso, trocas de contexto, rodadas do estresse, cliques da latência | 600, 74, 32, 0 | 600, 74, 32, 30 | 600, 74, 32, 30 |

As colunas do arquivo dizem o mesmo por braço (`entryEqualsControl: true` e `entryEqualsRecorded: true` nos três): as contagens do traço por tipo, o `scene-nodes`, a paridade e os contadores do main loop são iguais às do controle; os hashes do replay e do soak, as ocorrências, os quadros por janela, a paridade, os quadros de repouso e os cliques da latência são iguais aos do último ensaio por `-s`. Sem anomalia e sem aborto em nenhuma das seis execuções, e `provenance.mainLoop` é `FrontierComparisonEntry` pela entrada nova e vazio pelo `-s`.

**A cena vazia está na árvore e a remoção importa.** O roteiro, na cópia, sem a chamada que a libera, no braço A, leu `scene-nodes` = **5**, não 4. Foi visto uma vez, na árvore da Fase 1 (antes da mescla com a `main`), e não está num arquivo desta pasta.

## O que há nesta pasta

Os arquivos **commitados** são os que a máquina escreveu, copiados sem editar (menos `comparison.json`, que reúne os resumos das duas entradas e o do ensaio antigo). Nenhum tem caminho local: conferido nas cópias, e a varredura da publicação confere de novo.

| Arquivo | Bytes | O que é |
| --- | ---: | --- |
| [`comparison.json`](comparison.json) | 16.778 | o commit e o estado da árvore, os quatro hashes, os hashes por arquivo do roteiro e, por braço, as contagens pela entrada nova, pelo `-s` e do ensaio antigo, com a igualdade de cada par |
| [`summary.json`](summary.json) | 33.351 | o resumo do ensaio pela entrada nova (`summaryOf`): a marca, o commit, os hashes, e por execução os quadros, o vsync, o tempo até a HUD interativa, os hashes do jogo, a paridade, as janelas, os custos das leituras, os ganchos, as anomalias, as rejeições e os erros |
| [`rehearsal.json`](rehearsal.json) | 1.019 | a marca: `rehearsal: true`, `notAResult`, o SHA-256 da campanha, a faixa, os braços, a taxa de atualização assumida (60 Hz, o display headless lê −1) e a procedência dos custos de leitura |
| [`template-probe.txt`](template-probe.txt) | 2.003 | a sonda no template Release oficial: o método, os dois hashes e as linhas que ela imprimiu |

**Não commitados** (o relatório bruto de cada execução tem de 274 a 297 KB): só os SHA-256 deles, que se conferem contra os arquivos regerados. O `campaign.json` foi montado em memória e não foi escrito; só o SHA-256 dele está em `rehearsal.json` (`campaignSha256`, `6be6dd2a753ac75df50fc98a8ae963cc09c6b76a0e8651dedee3b0f0b5cbb01d`).

| Execução | Bytes | SHA-256 do relatório bruto |
| --- | ---: | --- |
| A, main loop | 273.971 | `619837b7e46128e348049cd6c6c362e5c33d032ae0369483b5d237979b115749` |
| B, main loop | 292.001 | `d3063f242d3ad0c70164a492aeed4607f842842eb64e4cae24a2d0352b29e71e` |
| C, main loop | 297.413 | `73f274172f1c2db760ad92d53dd8785d0813adad909cdd38ad387258f998094e` |
| A, `-s` | 274.267 | `f83dbdd3c0e174de447195f774e4dc6140967bead1892c10bf75b41ced774491` |
| B, `-s` | 291.993 | `05ff72dc8e35a7529a2c28e5a9b05e9e6e539daedfd02fb210933516c458ef5d` |
| C, `-s` | 297.208 | `cf1f21a628fde99cd8b6334d7fcb7bfaafe72bcb1f2a857345f11e93ca2a45aa` |

## A sonda no template Release oficial

Uma sonda de rascunho, rodada uma vez e **não guardada** (o binário e o `.app` foram apagados depois, por falta de disco; [`template-probe.txt`](template-probe.txt) tem o método, os hashes e as linhas impressas): um pack exportado de um projeto de prova, num `Probe.app` sem assinatura feito do `godot_macos_release.universal` dos templates pinados, rodado de outro diretório. Sem `override.cfg`, a cena principal roda; com `-s res://probe_loop.gd`, a cena principal roda do mesmo jeito (o `-s` é descartado); com `Contents/MacOS/override.cfg` que nomeia `run/main_loop_type="ProbeLoop"`, a classe do pack roda como main loop, com a cena principal já como `current_scene` no `_initialize`, e os argumentos de usuário chegam. É o caminho Release da entrada, visto num template; **não** é o export do civ-lite.

## Verificações

| Verificação | Resultado | Observação |
| --- | --- | --- |
| `node --test` em `frontier-comparison-run`, `-campaign`, `-campaign-state`, `-campaign-guards`, `-analysis` e `-protocol` (na árvore da mescla) | 97 testes, verdes | os 22 do `frontier-comparison-run.test.mjs` incluem os argumentos sem `-s`, os textos, os hashes, a recusa do Release e o `timedOut` |
| `npm run test:frontier-comparison-run` (na árvore da Fase 1, antes da mescla com a `main`) | 18 testes nativos, verdes, 780 s | o jogador, o ensaio nos três braços pela entrada nova, a asserção de que o processo não recebeu `-s`, o controle `-s` do braço A e o ensaio curto da campanha |

Nenhum arquivo do código da entrada (o executor, o lançador, o cenário e seus testes) mudou entre a árvore da Fase 1 e a da mescla; a mescla trouxe a tentativa sem relatório (#129) e o export macOS (#75), e a comparação desta página foi regerada na árvore da mescla.

## O que este registro não mostra

- Não há export do civ-lite como `.app` Release nos três braços; o lançador Release continua recusando, agora dizendo que a entrada está definida e o que falta ([a nota](../../research/frontier-comparison-execution.md#what-is-missing-for-the-campaign)).
- O tamanho do pacote nos braços A e B (o plugin de export sempre embarca os frameworks do React Native) e o autoteste do instrumento num template Release (a sonda dele roda com `-s` no binário do editor) são itens abertos.
- Onde o export põe o `override.cfg` (no pack, ou em `Contents/MacOS/`) e o que isso faz com a assinatura do bundle não foi tentado.
- Os recibos hospedados desta entrega (CI e Pages) provam o código e os testes da entrada, não uma execução comparativa; a seção [CI hospedada e Pages](#ci-hospedada-e-pages) traz os runs.

## CI hospedada e Pages

**O run.** O push da `main` em `81eaa0a` (o squash do #133; run [38067297038](https://github.com/journey-studios/godot-fabric/actions/runs/38067297038) do workflow Contracts, iniciado às 16:20:59 UTC) passou na primeira tentativa, sem reexecução, nos três jobs que um push roda desde o #88: `contracts` (2 min 5 s), `reference-android` (5 min 53 s) e `reference-ios` (7 min 15 s), todos com checkout em `81eaa0a`. Os cinco jobs nativos (`native-cold-start`, `native-suites-frontier`, `native-suites-input`, `native-suites-runtime` e `parity-comparison`) aparecem como **skipped**; o [recibo](hosted-ci.json) os registra assim e só os aceita porque a fatia não tem passo nativo nem artefato.

**O passo da guarda.** "Milestone exit guards (X9 and X10)" passou e imprimiu `MILESTONE_GUARDS_CHECK_PASSED: against 1810003a7603 (--base 1810003a7603a556b7101cbcfa09f4fa4830c64e); X9 clean, X10 clean`. A base é o pai do squash.

**Os testes.** `npm run test:contracts` rodou com 7, 43 e 629 testes de Node: os blocos de 7 e 43 passaram todos; no de 629, 628 passaram e 1 saiu como skipped pela allowlist do check (`ALLOWED_SKIPS`): "native macOS arm64 export and copied-app rejection controls", o teste de export macOS do #75, com o motivo "MACOS_EXPORT_TEMPLATE is unset; native export requires the reviewed Godot arm64 Release template". O recibo confere, pelo nome e no log do job `contracts`, os 22 testes de `tests/frontier-comparison-run.test.mjs` (22 de 22). Os 23 testes de Python passaram. `check:static` e `check:publication` também passaram (2.341 arquivos).

**O Pages.** O push de `81eaa0a` rodou também o workflow do Pages (run [38067297023](https://github.com/journey-studios/godot-fabric/actions/runs/38067297023), de 16:20:59 a 16:21:43 UTC, `build` e `deploy` em success, 43 testes do painel). O [recibo](publication.json) registra o deployment 6983550528 em success e o artefato `github-pages` que ele usou (id 11675575615, SHA-256 `f0b330af…`, igual ao digest da API e ao do log de upload). O `migration.json` de dentro tem os mesmos bytes do commitado, e a entrada de atividade da fatia, `milestone-0-5-v05-10-entry-bb30d75`, está nele. Um push seguinte da `main` substitui o deployment, então o site público não foi comparado.

O `--work-dir` abaixo é um exemplo: qualquer diretório fora do repositório serve.

```sh
node scripts/hosted-receipts.mjs --write --slice frontier-comparison-entry --work-dir <diretório fora do repositório>
node scripts/hosted-receipts.mjs --check
```
