# Tentativas sem relatório: CI hospedada e Pages do #129

Esta pasta guarda só os **recibos hospedados** da fatia que o PR #129 levou para a `main` como `1ef98a4`: a campanha comparativa passa a guardar as tentativas que travaram ou expiraram sem escrever relatório, em vez de as deixar fora dos dados. O que a fatia muda, e por quê, está na seção ["A tentativa sem relatório (2026-10-10)"](../README.md#a-tentativa-sem-relatório-2026-10-10) do registro da análise, fixada no commit `8817938`.

## CI hospedada e Pages

**O run.** O push da `main` em `1ef98a4` (o squash do #129; run [38063973873](https://github.com/journey-studios/godot-fabric/actions/runs/38063973873) do workflow Contracts, iniciado às 15:31:40 UTC) passou na primeira tentativa, sem reexecução. Os três jobs que um push roda desde o #88 passaram, com checkout em `1ef98a4`: `contracts` (3 min 21 s), `reference-android` (4 min 59 s) e `reference-ios` (6 min 22 s). Os cinco jobs nativos (`native-cold-start`, `native-suites-frontier`, `native-suites-input`, `native-suites-runtime` e `parity-comparison`) aparecem como **skipped**; o [recibo](hosted-ci.json) os registra assim e só os aceita porque a fatia não tem passo nativo nem artefato.

**O passo da guarda.** "Milestone exit guards (X9 and X10)" passou e imprimiu `MILESTONE_GUARDS_CHECK_PASSED: against 19fbb7b755b5 (--base 19fbb7b755b56516d66a69706b54e780b309a3e8); X9 clean, X10 clean`. A base é o pai do squash.

**Os testes.** `npm run test:contracts` rodou com 7, 43 e 590 testes de Node. Os blocos de 7 e 43 passaram todos. No bloco de 590, 589 passaram e 1 saiu como skipped pela allowlist do check (`ALLOWED_SKIPS`): "native macOS arm64 export and copied-app rejection controls", o teste de export macOS de #75, que pula com "MACOS_EXPORT_TEMPLATE is unset" porque só roda com o template de Release arm64 revisado, que o job `contracts` não tem antes de `test:contracts`. O recibo registra esse skip em `skippedTests`, com a descrição e o motivo, e o check aceita só esse caso. O recibo confere, pelo nome e no log do job `contracts`, os testes de nível superior dos quatro arquivos que a fatia mudou: `tests/frontier-comparison-analysis.test.mjs` (20 de 20), `tests/frontier-comparison-validity.test.mjs` (11 de 11), `tests/frontier-comparison-campaign.test.mjs` (20 de 20) e `tests/frontier-comparison-campaign-state.test.mjs` (7 de 7). Os 23 testes de Python passaram.

**O Pages.** O push de `1ef98a4` rodou também o workflow do Pages (run [38063973837](https://github.com/journey-studios/godot-fabric/actions/runs/38063973837), de 15:31:40 a 15:32:53 UTC, `build` e `deploy` em success, 43 testes do painel). O [recibo](publication.json) registra o deployment 6982973140 em success e o artefato `github-pages` que ele usou (id 11674270618, SHA-256 `a61c0c4d…`, igual ao digest da API e ao do log de upload). O `migration.json` de dentro tem os mesmos bytes do commitado, e a entrada de atividade da fatia, `milestone-0-5-v05-10-unreported-8817938`, está nele. Um push seguinte da `main` substitui o deployment, então o site público não foi comparado.

**O que continua só local:** a fatia não mede nenhum braço. Os recibos provam o código e os testes da análise e da campanha, não uma execução comparativa.

O `--work-dir` abaixo é um exemplo: qualquer diretório fora do repositório serve.

```sh
node scripts/hosted-receipts.mjs --write --slice frontier-comparison-analysis/unreported --work-dir <diretório fora do repositório>
node scripts/hosted-receipts.mjs --check
```
