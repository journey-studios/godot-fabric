# Braço B do comparativo final: o passe de otimização na `main`: CI hospedada e Pages do #121

Esta pasta guarda só os **recibos hospedados** do passe de otimização único do braço B (V05-10), que o PR #121 levou para a `main` como `e7fcf1c`.
A medida do passe (o perfil sobre a `main`, a comparação final de 5 contra 5 nas quatro janelas, o que mudou e por quê, as tentativas postas de
lado e o tempo ativo de 2,18 h de 3,2 h) está na seção ["Passe de otimização"](../README.md#passe-de-otimização) do registro do braço B.

## CI hospedada e Pages

**O run.** Desde o #88 um push da `main` não roda as suítes nativas, então o recibo vem do workflow Contracts **disparado à mão** sobre a `main` em
`e7fcf1c`, o squash do #121 (run [38053834754](https://github.com/journey-studios/godot-fabric/actions/runs/38053834754), evento `workflow_dispatch`,
ramo `main`). O run passou nos **oito jobs**, todos com o checkout em `e7fcf1c`.

**O passo.** `npm run test:civ-lite-ui` rodou no job `native-suites-runtime` (passo 61) e passou os seus dois testes (TAP 2 de 2): as duas HUDs, a
nativa já com as listas reconciliadas no lugar, o pool de painéis e a reciclagem das linhas do painel de estresse, pela mesma matriz, pela
sonda de overlays e pelo estágio de estresse. O artefato `civ-lite-ui` (id 11671571176, SHA-256 `5d416768…`, 23 arquivos) traz os relatórios. O
job `contracts` passou `npm run test:contracts` (7, 43 e 535 testes de Node). O [recibo](hosted-ci.json) guarda os jobs, os passos, os digests e os
arquivos do artefato.

**O Pages.** O push de `e7fcf1c` rodou o workflow do Pages (run [38053830063](https://github.com/journey-studios/godot-fabric/actions/runs/38053830063),
`build` e `deploy` em success, 43 testes do painel passando). O [recibo](publication.json) registra o deployment 6981076304 em success, o artefato
`github-pages` que ele usou (id 11670372803, SHA-256 `c840b45d…`) e que o `migration.json` publicado é o commitado em `e7fcf1c`, com a entrada de
atividade do passe.

**O que continua só local:** as medidas do passe (o harness headless com o instrumento do #97), as sabotagens nativas e a medida do tempo ativo
sobre a transcrição.

O `--work-dir` abaixo é um exemplo: qualquer diretório fora do repositório serve.

```sh
node scripts/hosted-receipts.mjs --write --slice frontier-arm-b/optimization --work-dir "${TMPDIR:-/tmp}/godot-fabric-hosted-receipts"
node scripts/hosted-receipts.mjs --check
```
