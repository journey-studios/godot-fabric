# Frontier: os serviços tipados, o nó GameServices e o epoch

Esta fatia é o pacote P4 do marco 0.5 (V05-03, critério `servicos`), ligada ao GF-28. O jogo **Frontier** (P3, regras em
GDScript puro, [registro](../frontier-game/README.md)) ganha o nó persistente `GameServices`
([`game_services.gd`](https://github.com/journey-studios/godot-fabric/blob/75c4c0f2b5e68119a3af3da4d1f7f9a2190d5ffa/consumers/civ-lite/services/game_services.gd)):
ele é dono de uma sessão do jogo e de um `epoch` inteiro, registra no `Application.runtime_available`, antes de qualquer bundle
ou montagem, um estado (`frontier.snapshot`), um sinal (`frontier.turn_ended`) e onze métodos (um por intenção, mais
`new_game`), todos a partir de uma única fonte de schema em GDScript
([`schema.gd`](https://github.com/journey-studios/godot-fabric/blob/75c4c0f2b5e68119a3af3da4d1f7f9a2190d5ffa/consumers/civ-lite/services/schema.gd)),
e os tipos TypeScript escritos à mão
([`frontier-types.ts`](https://github.com/journey-studios/godot-fabric/blob/75c4c0f2b5e68119a3af3da4d1f7f9a2190d5ffa/consumers/civ-lite/ui/frontier-types.ts))
são comparados com o que o Godot registrou, nos dois sentidos. Um bundle que faz o papel da HUD joga o roteiro de 12 turnos
do P3 inteiro por esses serviços, no Hermes de uma `FabricApplication` de verdade, e termina no **hash dourado** do P3. A
fatia não tem C++, não toca `native/`, `src/` nem `sdk/`, e não tem HUD: o jogo jogável é do V05-05 e do V05-08. A
[pesquisa](../../research/frontier-services.md) tem o nó, os serviços, o epoch e as decisões; o [recibo](execution.json) fixa
fontes, hashes, contagens e resultados.

Tudo aqui foi executado **a partir do commit de implementação
[`75c4c0f`](https://github.com/journey-studios/godot-fabric/commit/75c4c0f2b5e68119a3af3da4d1f7f9a2190d5ffa)**
(`75c4c0f2b5e68119a3af3da4d1f7f9a2190d5ffa`, árvore `ecadc7f6fcca950017208d97824c99abe190d4a7`, sobre a main `e1c7a39`, o PR
#70, que trouxe as regras do P3). A árvore estava limpa e igual à do commit, sem arquivo novo fora dos diretórios ignorados
(`git status --porcelain` vazio antes do primeiro comando e depois do último), quando cada comando abaixo rodou; os arquivos
desta evidência foram acrescentados depois e não são entradas. Ambiente: macOS arm64 (26.6.2), Godot oficial **4.7.2**
(`ed1daf0bf`), React Native **0.87.1** com o Hermes da aplicação, e Node **v22.23.3**, em modo headless.

| Lane executada | Checks | Observação |
| --- | ---: | --- |
| Serviços atuais, `npm run test:frontier-services`, o probe em 2 processos | 965/965 em cada execução | As duas execuções observam exatamente o mesmo (SHA-256 da projeção observada: `d3fc8e38…`): estado, snapshot, eventos, revisões e resultado de cada um dos 73 passos, as épocas, as violações, a persistência e os limites. O hash final é o dourado do P3 e os hashes dos passos dão o hash de trilha do P3; o oráculo independente aceita |
| Paridade Godot e TypeScript, os 7 subtestes seguintes do mesmo comando | 7/7 | 13 registros iguais nos dois lados; 13 mutações em cada lado (26 rejeições) com o campo nomeado; 9 recusas do extrator mais o `number` solto; 3 casos de nome e tipo; 8 casos do validador; 5 casos do contrato "uma ação é uma chamada" |
| 7 sabotagens, `node scripts/frontier-services-sabotage.mjs` | 2, 2, 9, 4, 29, 7 e 12 falhas | Cada uma é rejeitada pelo probe e pelo oráculo, e a `schema-drift` também pela paridade; o fonte volta byte a byte e o nó restaurado passa no teste normal |
| Controle com host anterior | N/A | A fatia não tem código nativo: não há binário anterior a comparar, e o SDK anterior também não discrimina, porque nada sai de `src/` nem de `sdk/` |

```sh
node scripts/frontier-services-sabotage.mjs   # as 7 sabotagens e, no fim, o nó restaurado no teste normal
npm run test:frontier-services                # o probe em 2 processos + o oráculo, depois a paridade
npm run test:civ-lite-game                    # o jogo do P3 continua com o mesmo hash dourado e o mesmo hash de trilha
```

Os comandos rodam o Godot oficial sobre o projeto raiz
(`--path . --headless --script res://tests/frontier-services-probe.gd`), que monta a cena de um consumidor em código: o nó
`GameServices`, um filho `Application` e uma `FabricSurface`, com o bundle `build/frontier-services-probe.js` (esbuild mais o
preset Babel do RN, como os outros probes nativos) cuja entrada é [`frontier-services-fixture.jsx`](https://github.com/journey-studios/godot-fabric/blob/75c4c0f2b5e68119a3af3da4d1f7f9a2190d5ffa/tests/frontier-services-fixture.jsx).
Cada sabotagem edita um fonte por
[`scripts/sabotage-sources.mjs`](https://github.com/journey-studios/godot-fabric/blob/75c4c0f2b5e68119a3af3da4d1f7f9a2190d5ffa/scripts/sabotage-sources.mjs)
e o restaura byte a byte, qualquer que seja o fim da execução. A rodada das sabotagens levou 119,1 s, o
`test:frontier-services`, 21,7 s e o `test:civ-lite-game`, 3,3 s.

## O que foi verificado

Os valores abaixo estão no [recibo](execution.json); os fontes estão fixados no commit de implementação.

### Os 13 nomes registrados

Origem `default`, prefixo `frontier.`; os schemas exatos de cada um (o recibo traz o despejo que o probe fez do que o nó
registrou) vêm de [`schema.gd`](https://github.com/journey-studios/godot-fabric/blob/75c4c0f2b5e68119a3af3da4d1f7f9a2190d5ffa/consumers/civ-lite/services/schema.gd)
e são os dos tipos TypeScript:

| Nome | Tipo | Carrega |
| --- | --- | --- |
| `frontier.snapshot` | estado | o DTO do snapshot, schema exato (`version`, `epoch`, `turn`, `phase`, `context`, `selection`, `resources`, `actions`, `tile`, `city`, `research`, `dialog`); `actions[].args` é `{array: integer}` |
| `frontier.turn_ended` | sinal | um argumento, `{turn: integer, phases: [{name: string, tasks: integer, events: integer}]}` |
| `frontier.select_tile` | método | `(x: integer, y: integer)` |
| `frontier.select_unit` | método | `(unit_id: integer)` |
| `frontier.clear_selection` | método | `()` |
| `frontier.move_unit` | método | `(unit_id: integer, x: integer, y: integer)` |
| `frontier.found_city` | método | `(unit_id: integer)` |
| `frontier.fortify` | método | `(unit_id: integer)` |
| `frontier.set_production` | método | `(item_id: string, slot: integer)` |
| `frontier.set_research` | método | `(tech_id: string)` |
| `frontier.resolve_event` | método | `(choice_id: string)` |
| `frontier.end_turn` | método | `()` |
| `frontier.new_game` | método | `()` |

Todo método responde o mesmo objeto, `{ok: integer, code: string, text: string}`, com resposta `completion`. O resultado de
`end_turn` não leva `turn` nem `phases`: eles saem em `frontier.turn_ended`, antes do `snapshot_changed` do turno que começa.
O registro está pronto antes da montagem: as conexões do próprio bundle, feitas enquanto ele avalia, ficaram prontas sem
`E_SERVICE_MISSING`, a primeira recebeu o snapshot inicial de epoch 1 e o registro tinha os 13 vínculos.

### O roteiro pelos serviços

O [roteiro](https://github.com/journey-studios/godot-fabric/blob/75c4c0f2b5e68119a3af3da4d1f7f9a2190d5ffa/consumers/civ-lite/game/replay.gd)
do P3 chega ao bundle como propriedade do root, vindo de `replay.gd` (nunca redigitado), e o bundle o joga uma chamada por
vez. São 73 passos: **43 aceitos e 30 recusados**, **12 `turn_ended`** (um por `end_turn` aceito, com as seis fases na
ordem `ai_plan`, `ai_move`, `production`, `growth`, `research`, `refresh`, no máximo 5 tarefas e 2 eventos por fase) e 43
snapshots publicados, um por intenção aceita e nenhum por recusa. Em cada passo, o snapshot que o JavaScript guarda é, byte a
byte, o canônico do nó e o de uma segunda sessão do jogo, de referência, que os serviços nunca tocam; o estado do nó é o da
referência. O hash do estado depois do 12º `end_turn`, calculado no GDScript e recalculado pelo oráculo a partir da
serialização, é o **hash dourado** do P3, e os hashes dos 73 passos dão o **hash de trilha** do P3:

```
275b7c6182605a784d8be3565d4df38a5bb130aaa6c0ea7640abe4c521427d29   dourado
fba99004fa12e253b9a6fe7f8bbee0cbd6e468a67308d25d0c40236f48c68cb8   trilha
```

### Uma ação é uma chamada

`Action.args` é a lista dos argumentos posicionais da intenção, em inteiros (`[unit_id]` para `select_unit`, `found_city` e
`fortify`; `[]` para `clear_selection` e `end_turn`), de modo que a HUD transforma uma ação numa chamada sem saber nada sobre as
intenções: `frontier.<id>(args)`. Em cada um dos 73 passos, cada ação do snapshot que o JavaScript guarda foi mandada de volta
assim a uma **cópia** da sessão de referência (nunca à viva, para que os estados do roteiro não mudem): **146 ações**, 125
habilitadas e 21 desabilitadas (`end_turn` 73, `clear_selection` 39, `fortify` 23, `found_city` 7, `select_unit` 4). Todas
nomeiam um método registrado com a mesma aridade, e cada habilitada foi aceita e cada desabilitada, recusada com o `reason`
do snapshot. O oráculo confere os argumentos de cada ação contra o schema do método, derivado das tuplas TypeScript.

### O epoch

O epoch vive no nó: começa em 1 e sobe 1 a cada `new_game`. Entra no snapshot e não entra no estado nem no hash (o estado não
tem chave `epoch`, e o oráculo exige isso). Três `new_game` depois do roteiro, cada um publicando um snapshot, nenhum
`turn_ended`, e voltando ao estado inicial do cenário:

| Sessão | Começou com | `epoch` | Hash do estado |
| --- | --- | ---: | --- |
| 1 | o nó entrando na árvore | 1 | `c36aad5b117e662a962645923734e5a046f5808fff202cbc5a24e2c9ee871c2e` |
| 2 | `new_game` | 2 | o mesmo |
| 3 | `new_game` | 3 | o mesmo |
| 4 | `new_game` | 4 | o mesmo |

O hash inicial é também o que a primeira recusa do roteiro (`clear_selection` sem seleção) deixa, o que serve de testemunha
independente. Depois do último `new_game`, uma intenção (`select_tile`) é aceita já no epoch 4.

### As recusas

As 24 recusas que o roteiro exerce chegam ao JavaScript com `ok: 0`, o mesmo `code` e o mesmo `text` do jogo, sem emitir
nenhum snapshot e sem mudar o estado: `tech_required` 4; `event_pending` 3; `unknown_unit` 2; e uma vez cada `nothing_selected`,
`out_of_bounds`, `no_moves_left`, `not_adjacent`, `cannot_fortify`, `not_a_settler`, `impassable_terrain`, `not_your_unit`,
`already_fortified`, `no_city`, `unknown_item`, `bad_slot`, `research_out_of_order`, `already_researching`, `unknown_tech`,
`not_enough_moves`, `unknown_choice`, `no_event`, `tech_known`, `already_queued` e `already_built`. Os outros quatro códigos
(`city_exists`, `too_close_to_edge`, `tile_occupied` e `queue_full`) o cenário não alcança; o probe do P3 monta um estado para cada.

### As violações de schema

Um chamador JavaScript que quebra o schema de um método é rejeitado com `E_SERVICE_SCHEMA` **antes** de o GDScript rodar: um
contador no nó conta as execuções do callback e não se mexe; também não sai snapshot nem `turn_ended`, e o hash do estado não
muda. Dez casos, mais um controle:

| Caso | Chamada | Erro |
| --- | --- | --- |
| tipo errado | `select_tile("6", 8)` | `E_SERVICE_SCHEMA` |
| tipo errado, uma fração | `move_unit(1, 7.5, 8)` | `E_SERVICE_SCHEMA` |
| tipo errado, número no lugar de string | `set_research(7)` | `E_SERVICE_SCHEMA` |
| tipo errado, string no lugar de inteiro | `set_production("warrior", "0")` | `E_SERVICE_SCHEMA` |
| aridade, falta | `select_tile(6)` | `E_SERVICE_SCHEMA` |
| aridade, sobra | `select_unit(1, 2)` | `E_SERVICE_SCHEMA` |
| aridade, um argumento para um método sem nenhum | `end_turn(1)` | `E_SERVICE_SCHEMA` |
| aridade, nenhum para um método com um | `found_city()` | `E_SERVICE_SCHEMA` |
| campo a mais, objeto com campo extra no lugar de inteiro | `select_unit({unit_id: 1, extra: 2})` | `E_SERVICE_SCHEMA` |
| campo a mais, objeto no lugar de string | `resolve_event({choice_id: "welcome"})` | `E_SERVICE_SCHEMA` |
| controle: um serviço que nunca foi registrado | `frontier.nope()` | `E_SERVICE_MISSING` |

O controle mostra que a checagem de ausência pode falhar.

### A persistência

Depois do 3º `end_turn` aceito, o probe desmonta a `FabricSurface`: a conexão do painel é removida, o root some (`rootCount`
0) e o registro continua com os 13 vínculos, na mesma geração de registro (`"1"`), com o mesmo nó, o mesmo jogo, o mesmo epoch
(1) e o mesmo estado (turno 4, hash `778cfc3c…`). Mais um passo, `select_tile(7, 8)`, é jogado **sem superfície alguma** e o nó o
responde (o hash passa a `56cc3883…`). A superfície é montada de novo: o painel se reconecta, o primeiro valor que recebe é o
snapshot corrente, da mesma geração, e portanto nada foi registrado outra vez (o painel montou 2 vezes e limpou 1).

### Os limites do DTO

O maior snapshot do roteiro (no passo 43) tem **173 nós de valor e profundidade 4**; os limites do transporte são 10.000 e
32. Um estado, um sinal e onze métodos são os 13 vínculos.

### A paridade

[`frontier-services-parity.test.mjs`](https://github.com/journey-studios/godot-fabric/blob/75c4c0f2b5e68119a3af3da4d1f7f9a2190d5ffa/tests/frontier-services-parity.test.mjs)
lê `frontier-types.ts` com a API do compilador TypeScript, converte cada interface e cada mapa (`FrontierStates`,
`FrontierSignals`, `FrontierMethods`) à linguagem de schema do registro (o alias `Int` é `integer`; um `number` solto vira
`number`) e compara em profundidade com os schemas que o probe despejou do que o nó registrou: 13 registros, um campo a mais
ou a menos de qualquer lado, um tipo diferente, outro número de argumentos ou um nome só de um lado falham, e a mensagem diz
qual (`frontier.snapshot.actions[].reason_text: declared in TypeScript, missing from Godot's schema`). Os casos negativos
retidos: 13 mutações sintéticas aplicadas a cada lado (26 rejeições: campo removido, campo aninhado, campo acrescentado,
`integer` por `string`, array no lugar do elemento, o elemento de `args` trocado, `args` virando objeto, campo do payload do
sinal, argumento removido, acrescentado e trocado, campo do resultado removido e acrescentado), três casos de nome e tipo,
nove recusas do extrator (campo opcional, `any`, `unknown`, união, `extends`, alias genérico, argumento opcional, tipo não
declarado, alias `Int` que não é `number`) e o `number` solto, que a paridade acusa contra o `integer` do Godot. O teste
recusa um despejo velho (confere os fontes pinados no relatório com os da árvore). Os testes de tipo
[`tests/types/frontier-services.tsx`](https://github.com/journey-studios/godot-fabric/blob/75c4c0f2b5e68119a3af3da4d1f7f9a2190d5ffa/tests/types/frontier-services.tsx),
dentro do `npm run type-check`, têm os positivos (`connect<FrontierSnapshot>`, `subscribe<[FrontierTurnEnded]>`,
`callFrontier` com as tuplas certas, cada ação mandada de volta) e os negativos com `@ts-expect-error` (tipo de argumento
errado, aridade errada, método inexistente, campo que o snapshot não tem, `ok` tratado como booleano, `args` lido como
objeto).

### O oráculo

[`frontier-services-oracle.mjs`](https://github.com/journey-studios/godot-fabric/blob/75c4c0f2b5e68119a3af3da4d1f7f9a2190d5ffa/tests/frontier-services-oracle.mjs)
julga as observações brutas e não lê nenhum veredito do probe. Deriva o schema dos **tipos TypeScript**, não do GDScript, e
valida cada snapshot recebido contra ele, exatamente; exige o texto canônico, a concordância com a serialização do estado
(turno, fase, seleção, estoques, cidade), os códigos e textos da tabela de recusas, um snapshot por intenção aceita e nenhum
por recusa, revisões que só sobem com elas, um `turn_ended` por `end_turn` aceito e antes do snapshot do turno, os epochs
subindo de 1 em 1, o SHA-256 de cada serialização, o dourado e o de trilha, as violações que nunca chegam ao GDScript, a
persistência e os limites.

### As sabotagens

Cada sabotagem quebra um fonte do GDScript, roda o teste nativo com `--sabotage=<nome>` e precisa ser rejeitada pelo probe e
pelo oráculo, pela razão por que foi quebrada.

| Sabotagem | Quebra | Falhas no probe | Oráculo e paridade |
| --- | --- | ---: | --- |
| `schema-drift` | `schema.gd` perde o `reason_text` de uma ação | 2 | o registro recusa a primeira conexão (`E_SERVICE_SCHEMA`); a paridade acusa `frontier.snapshot.actions[].reason_text: declared in TypeScript, missing from Godot's schema`; o oráculo, em `registration: the bundle's own connections … were not ready` |
| `late-register` | o registro vai para o `_ready`, depois de a superfície montar | 2 | as duas conexões do bundle recebem `E_SERVICE_MISSING`; o oráculo, em `registration:`; os schemas em si continuam os dos tipos |
| `silent-intent` | `found_city` é aceita e não publica snapshot | 9 | `step 18 found_city(1): an accepted intent publishes exactly one snapshot` |
| `frozen-epoch` | `new_game` não sobe o epoch | 4 | `new_game 1: the epoch rises strictly` |
| `emit-on-refusal` | uma intenção recusada publica um snapshot | 29 | `step 0 clear_selection(): a refused intent publishes nothing` |
| `action-args-drift` | a ação `found_city` do `snapshot.gd` leva `[]` em vez de `[unit_id]` | 7 | `step 3 select_unit(1): the action found_city carries as many arguments as its method (1)` |
| `turn-ended-order` | `turn_ended` sai depois do snapshot | 12 | `step 16 end_turn(): turn_ended comes before the snapshot of the turn that begins` |

## Regressões

Rodadas no mesmo commit, depois dos comandos acima; todas com saída 0.

| Comando | Resultado | Tempo |
| --- | --- | ---: |
| `npm run type-check` | sem diagnósticos, com os testes de tipo novos | 0,8 s |
| `npm run check:static` | `✓ No issues found` | 0,3 s |
| `npm run check:publication` | `passed: true`, 1676 arquivos, nenhuma falha (contados no commit, antes de esta evidência ser acrescentada) | 0,8 s |
| `npm run test:civ-lite-game` | 1/1 subteste, o mesmo hash dourado e o mesmo hash de trilha | 3,3 s |

## Recibo de fonte

Os 34 arquivos que rodaram (os scripts do jogo e dos serviços, o fixture, o probe, o teste nativo, o oráculo, o teste de
paridade, o teste de tipos, os scripts de bundle e de sabotagem e seus auxiliares, o `package.json` e o `tsconfig.godot.json`)
têm o SHA-256 do conteúdo igual ao do blob de `75c4c0f`, comparado byte a byte com `git show`. O recibo lista cada SHA-256 e
cada blob. **O recibo de fonte não certifica o build hospedado**: ele prova o GDScript, o JavaScript, o teste e o oráculo que
rodaram nesta máquina, e o `fabric_godot.dylib` que o projeto raiz carrega ao abrir foi construído aqui a partir dos fontes
nativos da main (`1fd43a17…`); esta fatia não o altera nem o compara.

> **CI hospedada e Pages pendentes.** O passo `npm run test:frontier-services` e o artefato `native-frontier-services` do
> workflow `contracts.yml` ainda não rodaram na CI hospedada, e nada foi publicado no Pages. Tudo o que esta página registra é
> evidência local, em macOS arm64. Este registro cobre o critério `servicos` do V05-03; os critérios `consumidor` e
> `autoridade`, os demais itens do 0.5 e todo número da 1.0 seguem como estavam.

## Limites e abertos

- Só headless, sem HUD: nada aqui monta um painel, e por isso não há captura. A HUD jogável é do V05-05 e do V05-08.
- O probe monta a cena em código, com um **stand-in** do nó de aplicação que faz o que o `sdk/addon/application_node.gd`
  faz (constrói a `FabricApplication` e emite `runtime_available` da própria `_enter_tree`), e não com o nó provisionado: o
  bundle fica em `build/`, e o nó provisionado exige um bundle em `res://.godot_fabric/`. O provisionamento pelo addon, o
  editor e os dez ciclos são o critério `consumidor` e seguem abertos.
- O `game_services.gd` alcança a fachada por `preload("res://sdk/addon/godot_fabric.gd")`, o caminho do laboratório; um projeto
  provisionado precisa trocar essa linha pelo `GodotFabric` global.
- O critério `autoridade` segue aberto: um job que sobrevive ao fechamento da tela e rajadas contra os orçamentos de 64
  tarefas e 128 eventos por fase não foram medidos. O `end_turn` daqui é uma chamada síncrona de GDScript, e fatiá-lo por fase
  (`begin_end_turn` e `advance_phase`, que existem no jogo) não está ligado a um serviço.
- Os tipos TypeScript são escritos à mão e a paridade compara nomes e formas; não há gerador, e ela não confere que um tipo
  signifique o que o nome diz.
- O controle com host anterior não se aplica: não há C++.
- A CI hospedada e a publicação no Pages estão pendentes.
