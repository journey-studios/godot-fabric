# O lançador Release da comparação (V05-10): os manifestos do export

> **É UMA VERIFICAÇÃO DO LANÇADOR. NENHUM NÚMERO DESTA PASTA É RESULTADO.** Nenhuma execução comparativa rodou aqui, e nenhum braço tem ainda um `.app` Release do civ-lite: o export do jogo nos três braços não existe.

O lançador Release da campanha roda, em cada braço, o `.app` que um export escreveu. Ele lê três manifestos (`frontier-comparison-export.json`, formato `godot-fabric.frontier-comparison-export/v1`) que dizem o executável, o pacote e os hashes de cada braço. `prepare()` valida os manifestos e recalcula o SHA-256 de cada executável e de cada pacote; recusa, dizendo todos os problemas, antes de iniciar qualquer processo. `launch()` roda `Contents/MacOS/<executável>` com os argumentos do cenário, um processo novo por execução, e confere os hashes de novo antes de cada uma.

A fatia foi verificada com um `.app` falso (`tests/frontier-comparison-release-fake-app.mjs`), não com um export real. A campanha ainda não começa por esse lançador: o autoteste do instrumento roda a sonda com `-s`, que um template Release descarta, então `runCampaign` recusa logo depois de `prepare()`, antes de criar o estado, a pasta de saída ou qualquer processo.

O registro é a seção "The launcher" da [nota da execução](../../research/frontier-comparison-execution.md#the-launcher), fixada em `29e379f`, o commit do lançador na PR #136.

## CI hospedada e Pages

**O run.** O push da `main` em `e4730cb` (o squash do #136; run [38072053021](https://github.com/journey-studios/godot-fabric/actions/runs/38072053021) do workflow Contracts, iniciado às 17:30:56 UTC) passou na primeira tentativa, sem reexecução, nos três jobs que um push roda desde o #88: `contracts` (3 min 24 s), `reference-android` (6 min 11 s) e `reference-ios` (5 min 57 s), todos com checkout em `e4730cb`. Os cinco jobs nativos aparecem como **skipped**; o [recibo](hosted-ci.json) os registra assim e só os aceita porque a fatia não tem passo nativo nem artefato.

**O passo da guarda.** "Milestone exit guards (X9 and X10)" passou e imprimiu `MILESTONE_GUARDS_CHECK_PASSED: against 2d2ba461543f (--base 2d2ba461543f5c0dc6876e412c382c0223c0faf1); X9 clean, X10 clean`. A base é o pai do squash.

**Os testes.** `npm run test:contracts` rodou com 7, 43 e 669 testes de Node: os blocos de 7 e 43 passaram todos; no de 669, 668 passaram e 1 saiu como skipped pela allowlist do check (`ALLOWED_SKIPS`): "native macOS arm64 export and copied-app rejection controls", o teste de export macOS do #75, com o motivo "MACOS_EXPORT_TEMPLATE is unset; native export requires the reviewed Godot arm64 Release template". O recibo confere, pelo nome e no log do job `contracts`, os testes de nível superior dos três arquivos da fatia: `tests/frontier-comparison-release.test.mjs` (13 de 13), `tests/frontier-comparison-campaign.test.mjs` (20 de 20) e `tests/frontier-comparison-run.test.mjs` (22 de 22). Os 23 testes de Python passaram. `check:static` e `check:publication` também passaram (2.356 arquivos).

**O Pages.** O push de `e4730cb` rodou também o workflow do Pages (run [38072053016](https://github.com/journey-studios/godot-fabric/actions/runs/38072053016), de 17:30:56 a 17:31:30 UTC, `build` e `deploy` em success, 43 testes do painel). O [recibo](publication.json) registra o deployment 6984357716 em success e o artefato `github-pages` que ele usou (id 11676913362, SHA-256 `cb5a10b1…`, igual ao digest da API e ao do log de upload). O `migration.json` de dentro tem os mesmos bytes do commitado, e a entrada de atividade desta fatia, `milestone-0-5-v05-10-release-launcher-29e379f`, está nele. Esse push publicou também a entrada do #138 (`milestone-0-5-v05-10-arm-projects-85d2c99`), que tinha entrado antes, em `2d2ba46`. Um push seguinte da `main` substitui o deployment, então o site público não foi comparado.

**O que continua só local:** os recibos provam o código e os testes do lançador, não uma execução comparativa, e não exercitam um export real.

O `--work-dir` abaixo é um exemplo: qualquer diretório fora do repositório serve.

```sh
node scripts/hosted-receipts.mjs --write --slice frontier-comparison-release-launcher --work-dir <diretório fora do repositório>
node scripts/hosted-receipts.mjs --check
```
