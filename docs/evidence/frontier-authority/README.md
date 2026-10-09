# Frontier: a autoridade do turno, o fim de turno como job aceito, entregue uma vez

Esta fatia fecha o critério `autoridade` do V05-03 (marco 0.5, GF-25), sobre os serviços tipados
([registro](../frontier-services/README.md)) e o consumidor provisionado ([registro](../frontier-consumer/README.md)). O critério,
com as palavras do painel: "turn.end aceito sobrevive ao fechamento da tela e job.finished chega 1x; uma regra mutada no Godot
muda a HUD sem alterar JS; rajadas de fim de turno medidas contra 64 tarefas e 128 eventos por fase". No repositório:

| Palavra do critério | Nome no código |
| --- | --- |
| `turn.end` | `frontier.end_turn`, método registrado com `{"response": "acceptance"}` |
| `job.finished` | `frontier.turn_ended`, sinal com `{turn, phases, job}`, uma vez por job |

O `end_turn` deixa de ser uma chamada síncrona: o jogo aceita o turno e devolve `{ok: 1, code: "ok", text: "", job: <id>}`; o nó
persistente
[`GameServices`](https://github.com/journey-studios/godot-fabric/blob/d0c7096f02543912224e5fc49ffb0168e2d7e0be/consumers/civ-lite/services/game_services.gd)
dirige o job com o seu próprio `_process`, **uma fase por frame**, publica o snapshot depois de cada fase e, depois da última, emite
`turn_ended` uma única vez, seguido do snapshot do turno que começa, cujo `last_job` é o id. O resultado de todos os métodos
passou a ser `{ok, code, text, job}`. A fatia não tem C++, não toca `native/`, `src/` nem `sdk/`, e não tem HUD jogável (é do
V05-05). A [pesquisa](../../research/frontier-services.md) tem o contrato e as decisões; o [recibo](execution.json) fixa fontes,
hashes, contagens e resultados.

Tudo aqui foi executado **a partir do commit de implementação
[`d0c7096`](https://github.com/journey-studios/godot-fabric/commit/d0c7096f02543912224e5fc49ffb0168e2d7e0be)**
(`d0c7096f02543912224e5fc49ffb0168e2d7e0be`, árvore `6c4915876b1d2f61618f050f2d6b10260bc72833`), sobre a main `c8de44b`
(`c8de44b3caa12a82009e55a059e2ce3da68f9485`, o PR #76, que provisionou o consumidor civ-lite). A árvore estava limpa e igual à do
commit, sem arquivo novo fora dos diretórios ignorados (`git status --porcelain` vazio antes do primeiro comando e depois do
último), quando cada comando abaixo rodou; os arquivos desta evidência foram acrescentados depois e não são entradas. Ambiente:
macOS arm64 (26.6.2), Godot oficial **4.7.2** (`ed1daf0bf`), React Native **0.87.1** com o Hermes da aplicação, Node **v22.23.3**
e npm 10.9.9, em modo headless.

| Lane executada | Resultado | Observação |
| --- | --- | --- |
| Serviços atuais, `npm run test:frontier-services`, o probe em 2 processos | 1058/1058 checks em cada execução | As duas execuções observam exatamente o mesmo (SHA-256 da projeção observada: `718ed168…`): estado, snapshot, eventos, revisões e resultado de cada um dos 73 passos. O hash final é o dourado do P3 e os hashes dos passos dão o de trilha; o oráculo independente aceita |
| Lane de regra, no mesmo comando, o probe em modo `--rule-lane` | 11/11 checks genuíno, 11/11 mutado | Mesmo bundle e mesmo host nas duas; só o `rules.gd` difere |
| Paridade e oráculos, os 10 subtestes seguintes do mesmo comando | 10/10 (`# tests 11`, `# pass 11`) | 14 registros iguais nos dois lados; 18 mutações em cada lado; 21 variantes de relatório que o oráculo do job rejeita; 6 variantes da lane de regra |
| 11 sabotagens dos serviços, `node scripts/frontier-services-sabotage.mjs` | 2, 2, 9, 4, 35, 7, 13, 41, 329, 33 e 79 falhas | Todas rejeitadas pelo probe e pelo oráculo; o fonte volta byte a byte e o nó restaurado passa no teste normal (`controlStatus: 0`) |
| Consumidor, `npm run test:consumer:civ-lite` | 20 checks de build e posse, **165 checks nativos**, 10 ciclos | Cada ciclo tem dois jobs (o da HUD e o do menu no mesmo frame) |
| 5 sabotagens do consumidor, `node scripts/consumer-civ-lite-sabotage.mjs` | 39, 19, 21, 3 e 10 falhas | Todas rejeitadas; fontes restauradas byte a byte; o template restaurado passa no check normal (`controlStatus: 0`) |
| Jogo do P3, `npm run test:civ-lite-game` | 1/1, 3 execuções byte a byte iguais | O hash dourado e o de trilha são os mesmos de antes |
| Controle com host anterior | N/A | A fatia não tem código nativo: não há binário anterior a comparar |

```sh
node scripts/frontier-services-sabotage.mjs   # as 11 sabotagens e, no fim, o nó restaurado no teste normal
npm run test:frontier-services                # o probe em 2 processos + o oráculo + a lane de regra, depois a paridade
node scripts/consumer-civ-lite-sabotage.mjs   # as 5 sabotagens do consumidor e, no fim, o template restaurado
npm run test:consumer:civ-lite                # provisiona, constrói no editor, roda os 10 ciclos, constrói offline
npm run test:civ-lite-game                    # o jogo do P3 continua com o mesmo hash dourado e o mesmo hash de trilha
```

Os comandos rodaram nesta ordem, um de cada vez, sem nada mais rodando na árvore. O Godot oficial roda sobre o projeto raiz
(`--path . --headless --script res://tests/frontier-services-probe.gd`) com o bundle
`build/frontier-services-probe.js` (SHA-256 `5df60146…`), e o consumidor roda provisionado numa pasta fora do checkout, com
`PATH=/usr/bin:/bin` (sem Node global), com o bundle da HUD (SHA-256 `b72044c0…`). Cada sabotagem edita um fonte por
[`scripts/sabotage-sources.mjs`](https://github.com/journey-studios/godot-fabric/blob/d0c7096f02543912224e5fc49ffb0168e2d7e0be/scripts/sabotage-sources.mjs)
e o restaura byte a byte, qualquer que seja o fim da execução; antes de cada variante o arquivo de resultado é apagado, e um
arquivo ausente conta como não rejeitado. Tempos: sabotagens dos serviços 254,1 s; `test:frontier-services` 27,8 s; sabotagens do
consumidor 205,7 s; `test:consumer:civ-lite` 32,3 s; `test:civ-lite-game` 2,0 s.

## O que foi verificado

Os valores estão no [recibo](execution.json); os fontes estão fixados no commit de implementação.

### O job, frame a frame

O probe espera cada job terminar antes do passo seguinte do roteiro, e guarda, para cada um: os snapshots que o JavaScript
recebeu (fase, turno, `last_job`), o frame em que o nó publicou cada um (um `Meter` lê o registro no meio do frame, depois do
`_process` da aplicação, que agenda o pump, e antes de a chamada diferida do pump rodar) e o que o registro tinha no início do
frame seguinte, já depois do pump. O job 1 do roteiro, com a superfície montada (dois assinantes do snapshot, o da aplicação e o do
painel, e um do `turn_ended`); `F0` é o frame em que a chamada foi aceita:

| Frame | O snapshot publicado mostra | Tarefas rodadas | Eventos enviados | Pendente depois do pump |
| --- | --- | ---: | ---: | --- |
| F0 | `ai_plan` (aceito), turno 1 | 1 (a chamada `end_turn`) | 2 | 0 tarefas, 0 eventos |
| F1 | `ai_move` (rodou `ai_plan`) | 0 | 2 | 0, 0 |
| F2 | `production` (rodou `ai_move`) | 0 | 2 | 0, 0 |
| F3 | `growth` (rodou `production`) | 0 | 2 | 0, 0 |
| F4 | `research` (rodou `growth`) | 0 | 2 | 0, 0 |
| F5 | `refresh` (rodou `research`) | 0 | 2 | 0, 0 |
| F6 | `idle`, turno 2, `last_job` 1 (rodou `refresh`; `turn_ended` antes do snapshot) | 0 | 3 (`turn_ended` e dois snapshots) | 0, 0 |

São sete snapshots em sete frames consecutivos e um `turn_ended`, entre o sexto e o sétimo, em todos os 15 jobs do probe. Os
snapshots mostram o turno antigo e o `last_job` antigo até o job terminar, e só no sétimo o turno que começa e `last_job` = o job.
O sétimo é publicado no mesmo frame do `turn_ended`, depois dele.

### Os cenários

| Cenário | Aceite | Fases | `turn_ended` do job | `last_job` ao fim | Onde está |
| --- | --- | --- | --- | --- | --- |
| Tela montada (jobs 1, 2 e 4 a 12 do roteiro) | `{ok: 1, job: N}`, resposta `acceptance` | 7 snapshots em 7 frames consecutivos | 1x | N | `scenarios.mounted` |
| Surface desmontado no frame seguinte ao aceite, antes da 1ª fase (job 3, passo 34) | o mesmo | o mesmo; a aplicação tinha `rootCount` 0 nas 4 amostras tiradas enquanto o job rodava | 1x na assinatura em escopo de módulo, e ainda 1x depois do remount | 3: o primeiro snapshot do painel remontado é `idle`, turno 4, `last_job` 3 | `scenarios.unmountedAfterAcceptance` |
| 10 chamadas durante o job (job 13, mandadas com o turno em `ai_move`) | o mesmo | o mesmo; as 10 rodaram no mesmo pump do frame F2 (10 tarefas, 2 eventos) | 1x | 13 | `scenarios.calls_during_job` |
| Consumidor: End turn e Menu no mesmo frame (jobs 2, 4, …, 20) | o mesmo | termina com o menu aberto, o World fora da árvore e a HUD sem conexão | `finished_jobs[N]` = 1 | o contador de concluídos sobe exatamente 1 em cada ciclo | `scenarios.consumerEndTurnAndMenuInTheSameFrame` |
| Consumidor: End turn pela HUD (jobs 1, 3, …, 19) | o mesmo | a HUD viu `ai_plan`, `ai_move`, `production`, `growth`, `research`, `refresh` e `idle` mudarem, nessa ordem | 1x | = o id da aceitação | `consumer.series[].phasesSeen` |

No job 3 o probe fecha a superfície no começo do frame seguinte ao aceite, o que detecta pelo nó (`job != 0`) e não pelo JavaScript,
de modo que nenhuma fase tinha rodado (`phaseAtUnmount: "ai_plan"`, `finishedAtUnmount: 0`). Os 14 vínculos, a geração `"1"`, o nó e o
jogo são os mesmos depois do remount; o painel montou 2 vezes e limpou 1. O estado do nó depois do job é, byte a byte, o da sessão
de referência que os serviços nunca tocam. Neste job os eventos por frame caem de 2 para 1 (F1 a F5) e para 2 (F6), porque o painel
deixou de assinar.

As 10 chamadas do job 13 foram: `select_tile(6, 8)`, `select_unit(1)`, `clear_selection()`, `move_unit(1, 7, 8)`, `found_city(1)`,
`fortify(2)`, `set_production("warrior", 0)`, `set_research("alphabet")`, `resolve_event("welcome")` e um segundo `end_turn()`.
Todas voltaram `{ok: 0, code: "turn_in_progress", text: "The turn is being processed.", job: 0}` (o `end_turn` repetido, ainda na
resposta `acceptance`), nenhuma publicou snapshot (o job publicou exatamente os 7 seus) nem mudou o estado (o hash final é o da
referência), e o nó rodou o callback de cada uma uma vez.

### Entregue uma vez

| O quê | Valor |
| --- | --- |
| Jobs aceitos no probe | 15: 12 do roteiro, 1 com chamadas durante o job, 2 dos casos de estresse |
| `turn_ended` recebido pela assinatura em escopo de módulo da aplicação | jobs 1 a 15, cada um 1x, em ordem; o `turn` de cada um é o que começa (2 a 13 no roteiro) |
| `finished_jobs` do nó | `{1: 1, 2: 1, …, 15: 1}`; `next_job` 16; nenhum job em andamento |
| `last_job` antes de o job terminar | o do job anterior (0, 1, 2, … nos jobs 1, 2, 3, …) nos seis primeiros snapshots |
| `last_job` ao fim | o id do job, em cada um dos 12 do roteiro: 1, 2, …, 12 |
| `end_turn` recusado no roteiro (passo 47, `event_pending`) | `{ok: 0, job: 0}`, resposta `acceptance`, nenhum job, nenhum snapshot |
| Hash do estado depois de cada passo | o do roteiro de referência; o final é o dourado do P3 |

O roteiro tem 73 passos, **43 aceitos e 30 recusados**: 115 snapshots publicados (31 intenções aceitas que não são `end_turn`, uma
cada, e 84 dos 12 jobs) e 12 `turn_ended`. O hash final do estado, calculado no GDScript e recalculado pelo oráculo, é o **hash
dourado** do P3, e os hashes dos 73 passos dão o **hash de trilha**:

```
275b7c6182605a784d8be3565d4df38a5bb130aaa6c0ea7640abe4c521427d29   dourado
fba99004fa12e253b9a6fe7f8bbee0cbd6e468a67308d25d0c40236f48c68cb8   trilha
```

O `npm run test:civ-lite-game`, que continua usando o `end_turn` síncrono do jogo, deixa os mesmos dois hashes em 3 execuções
byte a byte iguais.

### Uma regra mutada no Godot muda a HUD, sem mudar o JavaScript

A lane de regra roda o probe duas vezes com o mesmo bundle: uma com o `rules.gd` genuíno e outra com uma constante dele mutada por
`guardSources` e restaurada byte a byte (o bundle é refeito a partir das regras restauradas e dá o mesmo SHA-256). Não é uma
sabotagem: é uma lane do teste normal. A mutação troca os pontos de movimento do Settler, `"moves": 2` por `"moves": 0`.

| Proveniência | Genuíno | Mutado |
| --- | --- | --- |
| `rules.gd` SHA-256 | `bd96e80ed0e3ce9b985158fece61fe93b6a32af50ad68f0f94fa07783eb42040` | `5b593b141e0f5ad932578a19400869a97b6c54970b9af404460344640dcbe0fd` |
| Bundle SHA-256 | `5df6014653829e791cf348b454128f21fa0b34b501b33d280ba82de14a2be468` | **o mesmo**: o bundle não contém `.gd` |
| Host nativo SHA-256 | `9b1cc1b73d99649a10624d8eaf9beb407e8b51cdf321cced7fc3a758954f020c` | **o mesmo** |
| Node | v22.23.3 | v22.23.3 |
| Pontos de movimento do Settler | 2 | 0 |

O oráculo deriva do snapshot genuíno e da constante o que deve mudar, e exige que o que mudou no snapshot que o JavaScript recebeu
seja exatamente isso:

| Observação | O que difere |
| --- | --- |
| inicial | nada: o snapshot não mostra unidade, embora o hash do estado seja outro (`c36aad5b…` contra `4126fff9…`) |
| depois de `select_tile(6, 8)` | `tile.units[0].max_moves` 2 para 0 e `tile.units[0].moves` 2 para 0, e mais nada |
| depois de `select_unit(1)` | os mesmos dois campos e `actions[0]` (`found_city`): `enabled` 1 para 0, `reason` `""` para `"no_moves_left"` e `reason_text` `""` para `"The unit has no movement points left."` |
| `move_unit(1, 7, 8)` | genuíno `{ok: 1, code: "ok"}`; mutado `{ok: 0, code: "no_moves_left"}`, e a recusa não muda o snapshot nem o estado (o hash é o do passo anterior, `dd56dc77…`) |

O estado mudou porque o Godot mudou, e não o JavaScript. O hash do estado difere nas quatro observações.

### Rajadas medidas contra 64 tarefas e 128 eventos por fase

O orçamento de um pump do registro é de 64 tarefas e 128 eventos (`taskBudget`, `eventBudget`). Os números do registro
(`hostTasksRun`, `eventsSent`, `pendingHostTasks`, `pendingEvents`) são lidos antes e depois do pump de cada frame de cada job, e
**não** se confundem com os contadores do próprio jogo em `turn_ended.phases` (o que uma fase fez ao estado). Com os assinantes
reais do probe (a aplicação, o painel quando montado e o `turn_ended`), nos 13 jobs medidos (12 do roteiro e o das 10 chamadas):

| Frame | Fase que rodou | Registro: máx. tarefas no pump | Registro: máx. eventos enviados | Pendente depois | Jogo: máx. tarefas da fase | Jogo: máx. eventos da fase |
| --- | --- | ---: | ---: | --- | ---: | ---: |
| F0 | (aceite) | 1 | 2 | 0, 0 | | |
| F1 | `ai_plan` | 0 | 2 | 0, 0 | 1 | 1 |
| F2 | `ai_move` | 10 (as 10 chamadas do job 13) | 2 | 0, 0 | 1 | 1 |
| F3 | `production` | 0 | 2 | 0, 0 | 5 | 1 |
| F4 | `growth` | 0 | 2 | 0, 0 | 4 | 1 |
| F5 | `research` | 0 | 2 | 0, 0 | 5 | 1 |
| F6 | `refresh` | 0 | 3 | 0, 0 | 5 | 2 |

Cada fase cabe num pump: no máximo 10 tarefas (contra 64) e 3 eventos (contra 128), e `pendingHostTasks` e `pendingEvents` voltam a
0 depois de todos os frames. A lista da coluna "Pendente depois" é "tarefas, eventos".

**O caso de estresse.** 150 assinantes extras de `frontier.snapshot`, em escopo de módulo no bundle (com o da aplicação e o do
painel, cada publicação do snapshot tem 152 eventos, mais que 128; a última carrega também o `turn_ended`, 153). Os pumps são
contados como pumps, nunca como tempo:

| Caso | Publicações | Eventos cada | Pumps | Enviado em cada pump | Perda | Ordem |
| --- | ---: | ---: | --- | --- | --- | --- |
| Uma fase por vez (job 14): `advance_job` chamado pelo probe com o `_process` desligado, cada publicação drenada antes da seguinte | 7 | 152 (153 na última) | 2 cada, ⌈152/128⌉ (⌈153/128⌉ na última) | 128 e 24 (128 e 25 na última) | nenhuma: cada um dos 150 recebeu exatamente 1 snapshot por publicação, 7 depois do valor inicial | FIFO, publicação a publicação e assinante a assinante (1050 chegadas) |
| O driver do nó, uma fase por frame, mais rápido que o pump (job 15) | 7 | 152 (153 na última) | 9 no total, ⌈1065/128⌉ | 128 oito vezes, depois 41 | nenhuma: mais 7 por assinante (14 no total depois do valor inicial) | FIFO (1050 chegadas) |

No segundo caso o job não espera o registro (uma fase por frame, sempre), e a fila no início de cada frame é
`152, 176, 200, 224, 248, 272, 297, 169, 41, 0`: o orçamento limita cada pump e a fila drena por inteiro. Nem as fases nem o job
foram retidos pelo registro, e 1065 é 7 snapshots a 152 assinantes mais o `turn_ended`.

### As sabotagens dos serviços

`node scripts/frontier-services-sabotage.mjs` quebra um fonte do GDScript, roda o teste nativo com `--sabotage=<nome>` e exige que o
probe, o oráculo e a paridade rejeitem a variante pela razão por que foi quebrada.

| Sabotagem | Quebra | Falhas no probe | Oráculo e paridade |
| --- | --- | ---: | --- |
| `schema-drift` | `schema.gd` perde o `reason_text` de uma ação | 2 | o registro recusa a primeira conexão (`E_SERVICE_SCHEMA`); a paridade acusa `frontier.snapshot.actions[].reason_text: declared in TypeScript, missing from Godot's schema`; o oráculo, em `registration:` |
| `late-register` | o registro vai para o `_ready`, depois de a superfície montar | 2 | as duas conexões do bundle recebem `E_SERVICE_MISSING`; o oráculo, em `registration:`; os schemas continuam os dos tipos |
| `silent-intent` | `found_city` é aceita e não publica snapshot | 9 | `step 18 found_city(1): an accepted intent publishes exactly one snapshot` |
| `frozen-epoch` | `new_game` não sobe o epoch | 4 | `new_game 1: the epoch rises strictly` |
| `emit-on-refusal` | uma intenção recusada publica um snapshot | 35 | `step 0 clear_selection(): a refused intent publishes nothing` |
| `action-args-drift` | a ação `found_city` do `snapshot.gd` leva `[]` em vez de `[unit_id]` | 7 | `step 3 select_unit(1): the action found_city carries as many arguments as its method (1)` |
| `turn-ended-order` | `turn_ended` sai depois do snapshot do turno que começa | 13 | `step 16 end_turn(): turn_ended comes after the snapshot of the last phase and before the snapshot of the turn that begins` |
| `double-finish` | `turn_ended` sai duas vezes no fim do job | 41 | `step 16 end_turn(): turn_ended is emitted exactly once per accepted end_turn, and by nothing else` |
| `job-dies-with-screen` | o driver para quando a aplicação não tem raiz: o job é abandonado e nunca termina | 329 | `step 34 end_turn(): an accepted end_turn publishes exactly the seven snapshots of its job`; o primeiro check do probe é o de persistência do job 3 |
| `sync-end-turn` | `end_turn` volta a rodar todas as fases dentro do callback | 33 | `step 16 end_turn(): the node ran one phase a frame: its seven snapshots were published in seven consecutive frames`; as chamadas feitas depois do aceite não foram recusadas com `turn_in_progress` |
| `stale-snapshot` | o snapshot da fase `growth` não é publicado | 79 | `step 16 end_turn(): an accepted end_turn publishes exactly the seven snapshots of its job` |

### As sabotagens do consumidor

`node scripts/consumer-civ-lite-sabotage.mjs` provisiona o template quebrado, constrói no editor e roda a validação com
`--sabotage`; ela precisa rejeitar o projeto pela razão por que foi quebrado.

| Sabotagem | Quebra | Falhas | O que a série e os checks mostraram |
| --- | --- | ---: | --- |
| `hud-leak` | o efeito da HUD não remove mais a conexão | 39 | assinaturas do registro e da HUD: 2 no ciclo 1 e 11 no décimo; o primeiro check que falha é o do job com o menu (que também exige a HUD sem conexão no menu), depois o do menu |
| `orphan` | `remove_child` sem `queue_free` ao largar o World | 19 | órfãos: 2 no ciclo 1 e 20 no décimo, com os nós da árvore parados em 21; o primeiro check que falha é o dos Worlds que não foram liberados |
| `epoch-reset` | `reload_world` zera o epoch antes do novo jogo | 21 | o epoch termina o décimo ciclo em 2; o primeiro check que falha é o do ciclo que subiu 1 e não 3 |
| `no-facade` | o `main.tscn` não injeta mais a fachada | 3 | o log tem `FABRIC_ERROR: GameServices has no fabric_api`; o nó não registrou vínculo nenhum; os 3 checks de pré-voo falham e nenhum ciclo roda |
| `job-dies-with-menu` | o driver do job para quando o World é largado: o job é abandonado e nunca termina | 10 | uma falha por ciclo, a do job apertado no mesmo frame do menu (aceito, nunca concluído); o job da HUD, com o World na árvore, termina e nada mais falha |

### Os dez ciclos

Os dez ciclos do consumidor (novo jogo, três intenções pela HUD com o fim de turno como job que a HUD vê até o fim, recarregar o
cenário, End turn e Menu no mesmo frame, novo jogo no menu) não vazam: nós 21, órfãos 0, 14 vínculos, 1 assinatura, 2 conexões de
`snapshot_changed` e 1 conexão da HUD depois de cada ciclo, nada pendente, e o epoch de Godot e o da HUD sobem de 4 a 31, de 3 em 3.
Os jobs de cada ciclo `k` são `2k - 1` (a HUD) e `2k` (com o menu): 1 e 2 no ciclo 1, 19 e 20 no décimo.

## Regressões

Rodadas na mesma árvore, depois dos comandos acima; todas com saída 0.

| Comando | Resultado | Tempo |
| --- | --- | ---: |
| `npm run type-check` | sem diagnósticos, com os tipos novos de `job` e `last_job` | 0,5 s |
| `npm run check:static` | `✓ No issues found` | 0,4 s |
| `npm run check:publication` | `passed: true`, 1766 arquivos, nenhuma falha (contados no commit, antes de esta evidência ser acrescentada) | 0,6 s |

## Recibo de fonte

Os 34 arquivos que rodaram (os scripts do jogo e dos serviços, os tipos e a HUD, a `validation.gd`, o fixture, o probe, o teste
nativo, o oráculo, o teste de paridade, o teste de tipos, os scripts de bundle, de check e de sabotagem, o workflow e o
`package.json`) têm o SHA-256 do conteúdo igual ao do blob de `d0c7096`, comparado byte a byte com `git show`. O recibo lista cada
SHA-256 e cada blob. **O recibo de fonte não certifica o build hospedado**: ele prova o GDScript, o TypeScript, o JavaScript, o teste e
o oráculo que rodaram nesta máquina, e o `fabric_godot.dylib` que o projeto raiz e o consumidor carregam foi construído aqui a partir dos
fontes nativos da main (`9b1cc1b7…`); esta fatia não o altera nem o compara.

> **CI hospedada e Pages pendentes.** Os passos `npm run test:frontier-services` e `npm run test:consumer:civ-lite` e os artefatos
> `native-frontier-services` e `independent-civ-lite-consumer` do workflow `contracts.yml` ainda não rodaram na CI hospedada para
> este commit, e nada foi publicado no Pages. Tudo o que esta página registra é evidência local, em macOS arm64. Este registro cobre
> o critério `autoridade` do V05-03; os demais itens do 0.5 e todo número da 1.0 seguem como estavam.

## Limites e abertos

- Só headless, sem HUD jogável (é do V05-05): não há captura, e nenhuma é alegada.
- Os apertos de botão do consumidor são **sintéticos**: eventos de mouse empurrados no viewport pela `validation.gd`, e o End turn e o
  Menu "no mesmo frame" entram os dois antes de um frame passar; não é uma pessoa numa janela.
- As 10 chamadas durante o job e os 150 assinantes extras são fixtures do probe. O estresse mede os orçamentos do registro; não é uma
  política para backlog, e uma HUD com tantos assinantes precisaria de uma.
- `finished_jobs` é limitado aos últimos 256 jobs; o probe (15) e os dez ciclos (20) ficam muito abaixo disso.
- `new_game` abandona um job em andamento: nada o conclui e nenhum `turn_ended` sai para ele. Não há método de cancelamento, e um job
  não sobrevive a uma nova aplicação (D22 e D23 seguem pendentes).
- O job segue o relógio do jogo: pára enquanto a árvore está pausada.
- A lane de regra muda uma constante (os pontos de movimento do Settler, de 2 para 0) e compara o que o JavaScript recebeu; não muda
  outras regras.
- Os contadores de tarefas e eventos de `turn_ended.phases` são do jogo; os do registro são outra contagem, e as duas estão
  registradas separadas.
- O controle com host anterior não se aplica: não há C++.
- A CI hospedada e a publicação no Pages estão pendentes.
