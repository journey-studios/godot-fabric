# Relatório como documento: CI hospedada e Pages do #132

Esta pasta guarda só os **recibos hospedados** da fatia que o PR #132 levou para a `main` como `01118ad`: o relatório da comparação passa a sair como documento Markdown, lido do `report.json` pelo renderizador `scripts/frontier-comparison-report-markdown.mjs`. O que a fatia muda, e por quê, está na seção ["O relatório como documento (Markdown)"](https://github.com/journey-studios/godot-fabric/blob/e53a05f/docs/evidence/frontier-comparison-analysis/README.md#o-relatório-como-documento-markdown) do registro da análise, fixada no commit `e53a05f`.

## CI hospedada e Pages

**O run.** O push da `main` em `01118ad` (o squash do #132; run [38068135735](https://github.com/journey-studios/godot-fabric/actions/runs/38068135735) do workflow Contracts, iniciado às 16:33:18 UTC) passou na primeira tentativa, sem reexecução, nos três jobs que um push roda desde o #88: `contracts` (3 min 32 s), `reference-android` (6 min 24 s) e `reference-ios` (5 min 41 s), todos com checkout em `01118ad`. Os cinco jobs nativos aparecem como **skipped**; o [recibo](hosted-ci.json) os registra assim e só os aceita porque a fatia não tem passo nativo nem artefato.

**O passo da guarda.** "Milestone exit guards (X9 and X10)" passou e imprimiu `MILESTONE_GUARDS_CHECK_PASSED: against 81eaa0a17a12 (--base 81eaa0a17a126a561f0ec8bd50bacea5beefc012); X9 clean, X10 clean`. A base é o pai do squash.

**Os testes.** `npm run test:contracts` rodou com 7, 43 e 646 testes de Node: os blocos de 7 e 43 passaram todos; no de 646, 645 passaram e 1 saiu como skipped pela allowlist do check (`ALLOWED_SKIPS`): "native macOS arm64 export and copied-app rejection controls", com o motivo "MACOS_EXPORT_TEMPLATE is unset; native export requires the reviewed Godot arm64 Release template". O recibo confere, pelo nome e no log do job `contracts`, os 17 testes de `tests/frontier-comparison-report-markdown.test.mjs` (17 de 17). Os 23 testes de Python passaram. `check:static` e `check:publication` também passaram (2.344 arquivos).

**O Pages.** O push de `01118ad` rodou também o workflow do Pages (run [38068135660](https://github.com/journey-studios/godot-fabric/actions/runs/38068135660), de 16:33:18 a 16:33:53 UTC, `build` e `deploy` em success, 43 testes do painel). O [recibo](publication.json) registra o deployment 6983694127 em success e o artefato `github-pages` que ele usou (id 11676360524, SHA-256 `3c363845…`, igual ao digest da API e ao do log de upload). O `migration.json` de dentro tem os mesmos bytes do commitado, e a entrada de atividade da fatia, `milestone-0-5-v05-10-report-markdown-e53a05f`, está nele. Um push seguinte da `main` substitui o deployment, então o site público não foi comparado.

**O que continua só local:** os recibos provam o código e os testes do renderizador, não uma execução comparativa. O exemplo do documento é sintético, como o da análise.

O `--work-dir` abaixo é um exemplo: qualquer diretório fora do repositório serve.

```sh
node scripts/hosted-receipts.mjs --write --slice frontier-comparison-analysis/report-markdown --work-dir <diretório fora do repositório>
node scripts/hosted-receipts.mjs --check
```
