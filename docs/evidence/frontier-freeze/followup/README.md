# Frontier: o acompanhamento do congelado na `main`: CI hospedada e Pages do #112

Esta pasta guarda só os **recibos hospedados** do acompanhamento do congelamento (#112, que o PR levou para a `main` como `b23009d`): a causa confirmada da faixa do turno e a faixa corrigida, medida depois do congelamento. O registro do congelamento e as medições estão no [registro pai](../README.md), na seção [Depois do congelamento](../README.md#depois-do-congelamento-a-faixa-corrigida-do-turno). Uma pasta guarda um só par de recibos, e a pasta pai já guarda o do #107; por isso o par do #112 fica aqui, escrito pelo mesmo gerador canônico, `scripts/hosted-receipts.mjs`, a partir da API do GitHub, dos logs e dos artefatos baixados, e conferido sem rede pelo `--check` do mesmo script.

## CI hospedada e Pages

**O run.** O push da `main` em `b23009d` (o squash do #112; run [38029448318](https://github.com/journey-studios/godot-fabric/actions/runs/38029448318) do workflow Contracts, iniciado às 06:00:42 UTC) passou na primeira tentativa, sem reexecução, nos três jobs que um push roda desde o #88: `contracts` (3 min 13 s), `reference-android` (6 min 5 s) e `reference-ios` (6 min 13 s). Os outros cinco (`native-cold-start`, `native-suites-frontier`, `native-suites-input`, `native-suites-runtime` e `parity-comparison`) aparecem como **skipped**; o [recibo](hosted-ci.json) os registra assim e só os aceita porque a linha da fatia não tem passo nativo nem artefato. Os três jobs que rodaram usaram `b23009d`, e a árvore do head do PR é a árvore do squash.

**O passo da guarda.** "Milestone exit guards (X9 and X10)" passou num push e imprimiu `MILESTONE_GUARDS_CHECK_PASSED: against c4cab408af06 (--base c4cab408af06d2042921a723323970c7f088d5de); X9 clean, X10 clean`. A base é o pai do squash.

**Os testes.** `npm run test:contracts` passou com 7, 43 e 492 testes de Node, todos em `pass`, e 13 de Python. O recibo confere, pelo nome e no log do job `contracts`, os 21 testes de nível superior de `tests/frontier-freeze.test.mjs`: 21 de 21. `check:static` e `check:publication` também passaram (1.989 arquivos).

**O Pages.** O push de `b23009d` rodou também o workflow do Pages (run [38029448288](https://github.com/journey-studios/godot-fabric/actions/runs/38029448288), 06:00:42 a 06:01:30 UTC, `build` e `deploy` em success, 43 testes do painel). O [recibo](publication.json) registra o deployment 6976898132 em success e o artefato `github-pages` (id 11661621016, SHA-256 `4b0966c9…`, igual ao digest da API e ao do log de upload). O `migration.json` de dentro tem os mesmos bytes do `dashboard/migration.json` do squash, e a entrada de atividade da fatia, `milestone-0-5-v05-06-congelado-followup-3fb9487`, está nele. Um push seguinte da `main` substitui o deployment, então o site público não foi comparado.

**O que continua só local:** a faixa janelada do turno, as capturas e as medições do congelado nunca rodam na CI hospedada; o recibo prova o código e os testes do congelado, não as medições.

```sh
node scripts/hosted-receipts.mjs --write --slice frontier-freeze/followup --work-dir <diretório fora do repositório>
node scripts/hosted-receipts.mjs --check
```
