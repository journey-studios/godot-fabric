# Frontier: a estabilidade da HUD na `main`: CI hospedada e Pages do #100

Esta pasta guarda só os **recibos hospedados** da fatia 2b do V05-05 (critério `estabilidade`: cada overlay aberto e fechado 20 vezes, o foco restaurado, a varredura contra o manifesto e os ícones por `Image`), que o PR #100 levou para a `main` como `916387e`. A evidência local da fatia (as probes, os oráculos, o controle causal, as sabotagens e as capturas) está na seção "Fatia 2b" do [registro da HUD](../README.md). Uma pasta guarda um só par de recibos, e as pastas acima já guardam os da fatia 1 (o #82, em `civ-lite-ui`) e os da fatia 2a (o #93, em `overlays`); por isso o da fatia 2b fica aqui, escrito pelo mesmo gerador canônico, `scripts/hosted-receipts.mjs`, a partir da API do GitHub, dos logs e dos artefatos baixados, e conferido sem rede pelo `--check` do mesmo script.

## CI hospedada e Pages

**O run.** Desde o #88 um push da `main` não roda mais as suítes nativas, só os jobs de contrato e os de referência. Por isso o recibo vem do workflow Contracts **disparado à mão** sobre a `main` enquanto ela ainda estava em `916387e` (run [37995325873](https://github.com/journey-studios/godot-fabric/actions/runs/37995325873), evento `workflow_dispatch`, ramo `main`). O run passou nos **oito jobs** na primeira tentativa, todos com o checkout de `916387e`: `contracts` (3 min 6 s), `reference-android` (7 min 7 s), `reference-ios` (7 min 17 s), `native-cold-start` (7 min 16 s), `native-suites-frontier` (21 min 55 s), `native-suites-input` (21 min 59 s), `native-suites-runtime` (27 min 28 s) e `parity-comparison` (20 s). O PR #100 tinha 9 commits, e a árvore do head dele (`5f28de5`) é a árvore da `main`. O [recibo](hosted-ci.json) registra o run, o PR, os jobs e os artefatos.

**Os passos da fatia.** Os dois rodaram no job `native-suites-runtime`:

- `npm run test:civ-lite-ui` (passo 59, 1 min 44 s) passou o seu único teste (TAP 1 de 1) e imprime `CIVLITE_UI_LANE_PASSED: 144 + 26 + 41 probe checks; 27 + 20 + 38 oracle mutations and 23 of the scan; controls not run, not run and not run`: as três probes (a da HUD, com 144 checks; a de overlays, com 26; a de estabilidade, com 41), os três oráculos com 27, 20 e 38 mutações rejeitadas, a varredura de 23 casos, e os três controles marcados como `not run`.
- `npm run test:consumer:civ-lite` (passo 58, 1 min 6 s) imprime `CONSUMER_CHECK_PASSED: civ-lite: 20 build/ownership checks; 165 native checks; 10 cycles`.

O job `contracts` passou `npm run test:contracts` (7, 43 e 466 testes de Node, 13 de Python e `PARITY_INVENTORY_PASSED: 8113 contracts, 97 public values`), `check:static` e `check:publication`. O recibo registra também a comparação de paridade com as referências, `PARITY_COMPARISON_PASSED: 13 subset cases, ios + android`.

**Os artefatos.** `civ-lite-ui` (id 11647827716, 79.755 bytes, SHA-256 `1eac436f…`) tem 10 arquivos, e os logs dele imprimem `CONSUMER_EDITOR_BUILD_PASSED`, `CIVLITE_UI_PASSED`, `CIVLITE_OVERLAYS_PASSED` e `CIVLITE_STABILITY_PASSED`. `independent-civ-lite-consumer` (id 11647503173, 274.560 bytes, SHA-256 `16b2f6f0…`) tem 10 arquivos, e os logs imprimem `CONSUMER_EDITOR_BUILD_PASSED` e `CIVLITE_VALIDATION_PASSED`. Cada zip é igual ao digest da API e ao do log de upload, e o recibo fixa o SHA-256 de cada arquivo. O gerador não reexecuta os oráculos sobre os relatórios baixados (`headless.json`, `overlays.json`, `stability.json` e `stability-series.json`): o recibo fixa os bytes e os marcadores que a lane imprimiu.

**O Pages.** O push de `916387e` rodou o workflow do Pages (run [37995302878](https://github.com/journey-studios/godot-fabric/actions/runs/37995302878), de 21:45:02 a 21:45:45Z, `build` e `deploy` em success, 43 testes do painel, 43 passando e 0 falhando). O [recibo](publication.json) registra o deployment 6971658371 em success, o artefato `github-pages` que ele usou (id 11646802590, SHA-256 `0850d8bd…`, 15 arquivos), e que o `migration.json` de dentro tem os mesmos bytes do `dashboard/migration.json` do squash (SHA-256 `ac68ef9b…`), com o critério `estabilidade` fechado e a entrada de atividade da fatia, `milestone-0-5-v05-05-estabilidade-4ffdb6e`. Um push seguinte da `main` substitui o deployment, então o site público não foi comparado.

**O que continua só local:** as capturas, a execução janelada, os controles causais (que o CI marca como `not run`) e as sabotagens da fatia 2b.

```sh
node scripts/hosted-receipts.mjs --write --slice civ-lite-ui/stability --work-dir <diretório fora do repositório>
node scripts/hosted-receipts.mjs --check
```
