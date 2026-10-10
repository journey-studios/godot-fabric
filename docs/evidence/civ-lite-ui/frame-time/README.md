# Recibos brutos da correção do tempo de quadro (regressão do #100)

Esta pasta guarda os números crus da seção "Correção do tempo de quadro (regressão do #100)" do [registro da HUD](../README.md). Nenhum deles é entrada de uma lane: são a saída dos comandos descritos lá (os JSON do diagnóstico foram condensados dos relatórios completos, que ficam em `build/` e não são commitados; os recibos janelados foram só reserializados compactos, sem mudar um dado).

| Arquivo | O que guarda | Como foi gerado |
| --- | --- | --- |
| [`diagnostic.json`](diagnostic.json) | Os contadores do host por passo (selecionar um tile e três fins de turno, HUD do #100 e HUD de `fb51c07`) e a medida das leituras do snapshot dentro dos quadros do turno (a sonda remendada para cronometrar `mounted()`), no headless e no janelado. | Instrumentos descartáveis, removidos antes da entrega: uma sonda headless que lia os contadores do host entre os passos, e um remendo temporário de `tests/frontier-turn-probe.gd`. O que ficou como verificação é a regra `observation`. |
| [`headless-ramp.json`](headless-ramp.json) | A lane headless de 32 rodadas, rodada a rodada: o que uma leitura do snapshot pesava no início da rodada, os registros do log do carregador de imagens e a soma dos 7 quadros de um turno com a sonda de `0b9fbbf`, com a sabotagem `observed-in-frames` e com a correção. | `npm run test:frontier-turn` (a sonda corrigida), a mesma lane na sabotagem retida e a lane de `0b9fbbf` (a sonda anterior). |
| [`sabotage.json`](sabotage.json) | O recibo de `node scripts/frontier-turn-sabotage.mjs`: as cinco sabotagens da lane do turno (a nova, `observed-in-frames`, e as quatro de antes), o veredito de cada uma, o SHA-256 da sonda genuína e restaurada (iguais) e o da árvore do template antes e depois (iguais). | `node scripts/frontier-turn-sabotage.mjs` |
| [`windowed-main.json`](windowed-main.json), [`windowed-fix.json`](windowed-fix.json), [`windowed-previous-hud-fixed-probe.json`](windowed-previous-hud-fixed-probe.json), [`windowed-previous-hud-old-probe.json`](windowed-previous-hud-old-probe.json) | Os quatro recibos da lane janelada do turno (`build/frontier-turn-graphics.json`), um por braço do A/B: cada intervalo cru de cada execução, as tentativas, a máquina, a carga e a proveniência, mais, nos dois braços da lane corrigida, `observation` (as leituras do snapshot nos quadros cronometrados, 0 em todas as execuções, e o que uma leitura pesava no início de cada rodada). | `caffeinate -d node scripts/frontier-turn-graphics.mjs`, um braço depois do outro: o `main` e a HUD anterior com a sonda de `0b9fbbf` trocaram `tests/frontier-turn-probe.gd`, `tests/frontier-turn-oracle.mjs` e `scripts/frontier-turn-graphics.mjs` pelos de `0b9fbbf` e a HUD anterior trocou `consumers/civ-lite/ui` pelo de `fb51c07`, tudo restaurado byte a byte depois de cada braço. |
| [`windowed-summary.json`](windowed-summary.json) | As contas do A/B sobre os recibos acima, sem lê-las de novo: a soma dos 7 quadros, o p50 e o p95 de cada fase, as duas janelas do congelado (`ai-phase` e `event-burst`) execução a execução e entre execuções, calculadas pelo código do próprio congelado (`scripts/frontier-freeze-receipts.mjs` de `561251d`), a referência ociosa e a carga de cada execução. | Um script descartável sobre os recibos, que importa as funções do congelado (copiadas sem mudança de `561251d`); as definições estão no campo `how`. |

## CI hospedada e Pages

**O run.** Desde o #88 um push da `main` não roda as suítes nativas, então o recibo vem do workflow Contracts **disparado à mão** sobre a `main`
em `09ed8f7`, o squash do #108 (run [38027051145](https://github.com/journey-studios/godot-fabric/actions/runs/38027051145), evento
`workflow_dispatch`, ramo `main`). O run passou nos **oito jobs**, todos com o checkout em `09ed8f7`.

**O passo da correção.** `npm run test:frontier-turn` rodou no job `native-suites-frontier` (passo 16, 9 min 23 s) e passou o seu único teste (TAP
1 de 1), com a sonda corrigida e a regra `observation` do oráculo. O artefato `native-frontier-turn` (id 11661032282, 243.969 bytes, SHA-256
`340f3f8b…`, 6 arquivos) traz o log da lane, que imprime `FRONTIER_TURN_PASSED: 27`. O job `contracts` passou `npm run test:contracts` (7, 43 e
490 testes de Node), com os 18 testes de `tests/frontier-turn-graphics.test.mjs`, o verificador da lane janelada, entre eles. O
[recibo](hosted-ci.json) guarda os jobs, os passos, os digests e os arquivos do artefato.

**O Pages.** O push de `09ed8f7` rodou o workflow do Pages (run [38027038484](https://github.com/journey-studios/godot-fabric/actions/runs/38027038484),
`build` e `deploy` em success, 43 testes do painel passando). O [recibo](publication.json) registra o deployment 6976521584 em success, o artefato
`github-pages` que ele usou (id 11660571756, SHA-256 `1eb34f0f…`) e que o `migration.json` publicado é o commitado em `09ed8f7`, com a entrada de
atividade da correção.

**O que continua só local:** a lane janelada (o A/B dos quatro braços), o diagnóstico com a sonda remendada e a rampa headless.

```sh
node scripts/hosted-receipts.mjs --write --slice civ-lite-ui/frame-time --work-dir <diretório fora do repositório>
node scripts/hosted-receipts.mjs --check
```
