# Frontier: os overlays e a fila de três eventos na `main`: CI hospedada e Pages do #93

Esta pasta guarda só os **recibos hospedados** da fatia 2a do V05-05 (critério `overlays`: a fila de três eventos do jogo e a tela da cidade e o
diálogo como `Modal`s bloqueantes), que o PR #93 levou para a `main` como `e108e9d`. A evidência local da fatia (as probes, os oráculos, os controles
causais, as sabotagens e as capturas) está no [registro da HUD](../README.md), na seção "Fatia 2a", e o recibo dela é o bloco `slice2a` do
[`report.json`](../report.json). Uma pasta guarda um só par de recibos, e a pasta pai já guarda o da fatia 1 (o #82); por isso o segundo par fica
aqui, escrito pelo mesmo gerador canônico, `scripts/hosted-receipts.mjs`, a partir da API do GitHub, dos logs e dos artefatos baixados, e conferido sem
rede pelo `--check` do mesmo script.

## CI hospedada e Pages

**O run.** Desde o #88 um push da `main` não roda mais as suítes nativas, só os jobs `contracts`, `reference-ios` e `reference-android`; o push de `e108e9d`
(run 37958764264) as pulou. O recibo vem, por isso, do workflow Contracts **disparado à mão** sobre a `main` enquanto ela ainda estava em `e108e9d` (run
[37958818671](https://github.com/journey-studios/godot-fabric/actions/runs/37958818671), evento `workflow_dispatch`, ramo `main`), que passou nos **oito jobs** na
primeira tentativa, sem reexecução, todos com o checkout de `e108e9d`: `contracts` (2 min 35 s), `reference-android` (6 min 29 s), `reference-ios` (8 min 9 s),
`native-cold-start` (6 min 52 s), `native-suites-frontier`, `native-suites-input` e `native-suites-runtime` (cerca de 22 a 23 min cada) e `parity-comparison` (27 s).
O PR #93 tinha 16 commits, e a árvore do head dele é a árvore do squash. O [recibo](hosted-ci.json) registra o run, o PR, os jobs e os artefatos.

**Os passos da fatia.** Os dois rodaram no job `native-suites-runtime`:

- `npm run test:civ-lite-ui` (passo 59, 41 s) passou o seu único teste (TAP 1 de 1) e imprime `CIVLITE_UI_LANE_PASSED: 144 + 26 probe checks; 27 + 20 oracle
  mutations; controls not run and not run`: as duas probes (a da HUD, com 144 checks, e a de overlays, com 26), os dois oráculos independentes com as 27 e as
  20 mutações rejeitadas, e os dois controles pulados, porque o clone da CI é raso e os commits `5e1f6a1` e `622102e` não estão nele (a lane diz isso).
- `npm run test:consumer:civ-lite` (passo 58, 49 s) imprime `CONSUMER_CHECK_PASSED: civ-lite: 20 build/ownership checks; 165 native checks; 10 cycles`.

O job `contracts` passou `npm run test:contracts` (7, 43 e 424 testes de Node e 13 de Python), `check:static` e `check:publication` (1.896 arquivos).

**Os artefatos.** `civ-lite-ui` (id 11632248250, 34.442 bytes, SHA-256 `d1ddfc1c…`) tem 7 arquivos, e os logs dele imprimem `CONSUMER_EDITOR_BUILD_PASSED`,
`CIVLITE_UI_PASSED` e `CIVLITE_OVERLAYS_PASSED`; `independent-civ-lite-consumer` (id 11632323830, 270.509 bytes, SHA-256 `e7a2b30a…`) tem 10 arquivos, e os logs
imprimem `CONSUMER_EDITOR_BUILD_PASSED` e `CIVLITE_VALIDATION_PASSED`. Cada zip é igual ao digest da API e ao do log de upload, e o recibo fixa o SHA-256 de cada
arquivo. Os dois relatórios hospedados foram baixados e julgados de novo, fora da CI, pelos oráculos independentes da lane: `headless.json` (SHA-256
`e9f922bf…`, 144 checks, 0 falhos, 0 achados do oráculo da HUD) e `overlays.json` (SHA-256 `665f46a4…`, 26 checks, 0 falhos, 0 achados do oráculo de overlays).
Eles não são, byte a byte, os relatórios locais da fatia: a execução local é janelada e com controles, e os relatórios trazem amostras que dependem do ritmo da
máquina; o que se compara é o veredito dos oráculos, que é o mesmo.

**O Pages.** O push de `e108e9d` rodou também o workflow do Pages (run [37958764277](https://github.com/journey-studios/godot-fabric/actions/runs/37958764277),
16:23:26 a 16:24:01Z, `build` e `deploy` em success, 43 testes do painel). O [recibo](publication.json) registra o deployment 6965648139 em success, o artefato
`github-pages` (id 11631065962, SHA-256 `6a07ac12…`, 15 arquivos) e que o `migration.json` de dentro tem os mesmos bytes do `dashboard/migration.json` do squash
(SHA-256 `32c5ba35…`) e a entrada de atividade da fatia, `milestone-0-5-v05-05-overlays-67c3f16`, com `overlays` fechado. Um push seguinte da `main` substitui o
deployment, então o site público não foi comparado.

**O que continua só local:** as capturas, a execução janelada, os dois controles causais (`5e1f6a1` e `622102e`) e as sabotagens da HUD e do jogo.

```sh
node scripts/hosted-receipts.mjs --write --slice civ-lite-ui/overlays --work-dir <diretório fora do repositório>
node scripts/hosted-receipts.mjs --check
```
