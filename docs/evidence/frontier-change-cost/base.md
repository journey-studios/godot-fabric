# A base comum do custo de mudança (V05-10, `mudanca`)

Registro da base do experimento pré-registrado em [frontier-change-cost.md](../../research/frontier-change-cost.md): tudo o que é igual para os dois braços
e que nenhum deles paga. Foi escrito na branch `exp/change-cost-base`, criada a partir de `6c7e8ba` (a `main` com o pré-registro, #124), que nunca entra na
`main`. Entram na `main` só este registro, os patches e as contagens, em `docs/evidence/frontier-change-cost/`.

A base termina com a lane da HUD **vermelha nos dois braços**, e só pelo que o pedido acrescenta. Nada da implementação de nenhum braço existe nela:
nenhuma linha mudou em `consumers/civ-lite/native_hud/`, em `consumers/civ-lite/ui/hud/`, em `ui/store.ts` ou em `ui/telemetry.ts`.

## Os commits da base

| Commit | Assunto |
| --- | --- |
| `f5c834d` | `feat(frontier): Draw the irrigation icon` |
| `9ebca52` | `feat(frontier): Add the Irrigate rule to the game` |
| `0677dd9` | `test(frontier): Add the Irrigate stage to the HUD lane` |
| o da cabeça da branch | este registro (`docs(frontier): Record the base of the change-cost experiment`); a base que os braços recebem é a cabeça, `git rev-parse exp/change-cost-base` |

`git diff --stat 6c7e8ba..0677dd9` mostra 37 arquivos, 765 linhas acrescentadas e 85 removidas. A contagem dos braços é `git diff --name-only base..braço` contra a cabeça da
branch, então nada do que está aqui é cobrado a nenhum deles.

## A regra do jogo: Irrigar

O texto do pré-registro é o da regra: uma Settler pode irrigar a Planície em que está quando a Planície tem Água em um dos quatro vizinhos e ainda não está
irrigada; irrigar gasta todos os movimentos que restam à Settler, e a casa rende um alimento a mais pelo resto do jogo.

**Intenção.** `irrigate(unit_id)` em `game/intents.gd` (`check_irrigate` e `apply_irrigate`), em `game/game.gd` e registrada em `GameServices` como `frontier.irrigate`
com um argumento inteiro: 19 vínculos onde havia 18 (dois estados, um sinal e 16 métodos). Os vizinhos são o norte, o leste, o sul e o oeste; as diagonais não
contam, e um lado fora do mapa não é Água.

**Verificações, na ordem em que rodam.** A ordem faz uma Settler que acaba de irrigar ouvir que a casa já está irrigada, e não que está sem movimentos.

| Ordem | Código | Texto | Origem |
| --- | --- | --- | --- |
| 1 | `turn_in_progress` | The turn is being processed. | existente |
| 2 | `event_pending` | A decision is waiting. Resolve the event first. | existente |
| 3 | `unknown_unit` | No such unit. | existente |
| 4 | `not_your_unit` | That unit belongs to another faction. | existente |
| 5 | `not_a_settler` | Only a Settler can do that. | existente; o texto dizia "found a city" e passou a servir às duas intenções |
| 6 | `not_a_plain` | Only a Plain can be irrigated. | novo |
| 7 | `no_water_nearby` | Irrigation needs Water on one of the tile's four sides. | novo |
| 8 | `already_irrigated` | This tile is already irrigated. | novo |
| 9 | `no_moves_left` | The unit has no movement points left. | existente |

**Estado e hash.** O estado ganhou `irrigated`: as casas irrigadas como índices do mapa (`y * 24 + x`), em ordem crescente, um conjunto que não guarda a ordem em que as casas
foram irrigadas. Está em todo estado, vazio em todos os estados do roteiro, e faz parte do hash.

**Rendimento.** `Economy.tile_yield` soma `Rules.IRRIGATION_FOOD` (1) à casa irrigada. Por isso o `food` do cartão da casa, a classificação dos vizinhos da cidade e as taxas da
cidade usam o bônus: uma Planície irrigada ao lado da cidade (3 de alimento, 1 de produção) passa à frente de todos os vizinhos e a cidade a trabalha.

**Snapshot.**

- A ordem das ações no contexto `settler` é `found_city`, `irrigate`, `fortify`, `clear_selection`, `end_turn`; `irrigate` tem `args: [unit_id]`, `enabled` e `reason_text` do jogo.
  Nos outros contextos a lista não mudou.
- Os cartões de casa (o `tile` do snapshot e o `frontier.hover`) ganharam `irrigated` (0 ou 1), e o `food` deles já inclui o bônus.
- `services/schema.gd` e o espelho de tipos `ui/frontier-types.ts` mudaram juntos (o campo, a constante `FRONTIER_IRRIGATE` e o método). O espelho é o contrato dos serviços,
  não trabalho de HUD, e é o único arquivo de `ui/` que a base tocou.

**Hashes.** O hash dourado e o da trilha do roteiro se moveram uma vez, e só pelo campo novo:

| | Antes | Depois |
| --- | --- | --- |
| Hash dourado | `cb7ab974f47f18c37ae96bda57ffd1b87f8c3733e251a386040dc17ccb540e8d` | `0949b36d7438ce57c86f3952c9cfa47bb8ef6874edc762b5caf8d8ba4fbddbf1` |
| Hash da trilha | `ed43495ec48d896c0eb0c4f9a7b97471be86f37082218d16a8411d0f3766275e` | `a36c0f32707e9a8439bf276548d907d6bcc0821351a6014ab46ab617bf6b31ba` |

Tirando `"irrigated":[],` de cada uma das 77 serializações, os hashes antigos voltam. Estão fixados em `tests/civ-lite-game-native.test.mjs` e
`tests/frontier-services-native.test.mjs`. A campanha de execução mede o jogo como está na `main`, com os hashes antigos; esta base não o altera.

**Testes do jogo.** Provam a regra, os códigos, o rendimento e o registro:

- `tests/civ-lite-game-probe.gd` joga nove cenários construídos para a regra (a casa inicial, a Floresta e a Colina, a Settler sem movimentos, a Água nos quatro lados e só numa
  diagonal, o rendimento da cidade com e sem irrigação, uma casa que a cidade não trabalha, uma cidade fundada sobre a casa irrigada) e confere cada ação contra a sua intenção;
  `tests/civ-lite-game-oracle.mjs` julga cada passo com a regra escrita de novo em Node e confere os invariantes do estado (casas irrigadas em ordem, cada uma uma Planície com Água ao lado).
- `scripts/civ-lite-game-sabotage.mjs` retém quatro sabotagens (`irrigation-diagonal`, `irrigation-keeps-moves`, `irrigation-unsorted`, `irrigation-no-yield`), rejeitadas pela sonda e pelo oráculo.
- A lane dos serviços (`frontier-services-oracle.mjs`, `-parity.test.mjs`, `-probe.gd`) conta 19 vínculos e 16 métodos, conhece os três códigos novos, exige `irrigate` entre as ações que
  voltam como chamadas, e a paridade com o TypeScript cobre o campo `irrigated` e o método `frontier.irrigate`. Os outros pins de 18 vínculos (`validation.gd`,
  `consumer-civ-lite-check.mjs`, o oráculo de estabilidade, as sondas de estresse e de soak) passaram a 19.

## O ícone

`irrigation` é o sétimo desenho de `scripts/civ-lite-icons.mjs`: uma gota de água sobre um canteiro com um broto de cada lado, 32x32, original. O PNG em
`consumers/civ-lite/ui/icons/irrigation.png` é o que o gerador escreve, byte a byte, e a lane exige os sete arquivos. A base não o liga a nenhuma HUD: a tabela de ícones da B
(`native_hud/icons.gd`) e a da C (`ui/hud/icons.ts`) continuam com seis, e listá-lo é trabalho dos braços.

## A expectativa da lane, igual nos dois braços

O estágio `irrigation` de `consumers/civ-lite/hud_validation.gd` roda nas duas HUDs pela costura do leitor (`hud_probe.gd`) e é julgado de novo por `tests/civ-lite-ui-oracle.mjs`.

**A rota até uma Planície irrigável.** A Settler do jogador (unidade 1) começa na casa (6, 8), uma Planície com Água em (5, 8). Chegar lá é selecionar a unidade
pelos serviços (`services.select_unit(1)`), depois de um jogo novo e com o ponteiro fora do mapa; é determinística, igual em toda execução e nos dois braços.

**O que o estágio espera.**

| Item | testID | Esperado |
| --- | --- | --- |
| O botão | `hud-actions-irrigate-1` | listado, habilitado, com o rótulo "Irrigate" do jogo e sem motivo |
| O ícone da ação | `hud-actions-irrigate-1-icon` | uma imagem de `irrigation.png`, visível e com área |
| O clique | o do botão, por um clique real pelo viewport | uma chamada ao jogo, enviada pela HUD, e a casa irrigada |
| O efeito no jogo | | a casa em `irrigated`, a Settler com 0 movimentos, a casa com um alimento a mais |
| A ação depois | `hud-actions-irrigate-1` e `-reason` | desabilitada, com o motivo `already_irrigated` do jogo ao lado |
| A marca no cartão | `hud-tile-irrigated` | uma imagem de `irrigation.png`, visível e com área, só na casa irrigada |
| A linha de unidades | `hud-tile-units` | contém "Irrigated" e continua listando as unidades |
| O alimento | `hud-tile-yields` | `Food 3 · …`, o do jogo, com o bônus |

A marca do cartão se chama `hud-tile-irrigated`, como no pré-registro, e não leva o sufixo `-icon` que os outros ícones do cartão (`hud-tile-city-icon`, `hud-tile-unit-<id>-icon`) levam.
Os ícones das ações seguem a convenção (`hud-actions-<chave>-icon`).

**O que a costura ganhou.** As linhas que os leitores devolvem ganharam `asset`, o nome do arquivo que uma imagem desenha (`irrigation.png`): o leitor do host o tira da fonte da imagem,
o do braço nativo do recurso da textura. Assim a lane confere que é o ícone novo, e não qualquer ícone. Se a HUD não enviar a intenção, a sonda a envia pelos serviços para
que o cartão da casa irrigada ainda seja observado, e o clique fica registrado como falho.

**O oráculo** julga o estágio só pelas observações cruas e rejeita onze cópias mutadas do relatório (`tests/civ-lite-ui-native.test.mjs`, categoria `irrigation`). O oráculo de estabilidade,
que só a C roda, passou a esperar os mesmos ícones no contexto `settler` e a marca numa casa irrigada. A conta de checks da sonda da HUD passou de 152 a 161 (nove do estágio).
A matriz de contextos continua passando nos dois braços: as ações esperadas saem do snapshot, que agora lista `irrigate` no contexto `settler`.

## O que falha em cada braço, como estão

`node --test tests/civ-lite-ui-native.test.mjs` falha nos dois testes, no primeiro `assert` (os checks da sonda). Os demais checks da sonda e todos os julgamentos do oráculo, fora o do estágio, passam.

| Check do estágio | B (nativa) | C (React Native) |
| --- | --- | --- |
| `Irrigate: a Settler on a Plain with Water beside it is offered Irrigate in the actions panel, enabled, with the game's label` | passa | passa |
| `Irrigate: the action shows the irrigation icon, drawn` | **falha** | **falha** |
| `Irrigate: a real press on the enabled action irrigated the tile, with one call to the game` | passa | **falha** |
| `Irrigate: the game irrigated the tile, spent all of the Settler's moves and gave the tile one more food` | passa | passa |
| `Irrigate: once the tile is irrigated the action is disabled, with the game's reason beside it` | passa | passa |
| `Irrigate: the tile card's food is the game's, the irrigation's included` | passa | passa |
| `Irrigate: before it is irrigated the tile card shows no irrigation icon and its units line does not say Irrigated` | passa | passa |
| `Irrigate: the card of the irrigated tile shows the irrigation icon, drawn` | **falha** | **falha** |
| `Irrigate: the units line of the irrigated tile says Irrigated and still lists its units` | **falha** | **falha** |

O botão já aparece nas duas, porque as duas listam as ações do snapshot de forma genérica. O clique falha só na C: a loja (`ui/store.ts`) traduz cada id de ação
numa chamada tipada, e um id que não conhece é um problema contado e nenhuma chamada sai; a B despacha pelo nome do método, e a chamada já funciona. O que é pedido de cada braço
é, então, fazer a mesma lane passar; nesse sentido a diferença de custo do clique é uma medida do experimento, não da base.

## O que as HUDs precisam respeitar e que o pedido não diz

- A lane lê o código-fonte da C com expressões regulares (`tests/civ-lite-ui-native.test.mjs`): `hud/actions.tsx` precisa continuar com `icon={iconOf(action, units)}`, `hud/tile.tsx` com
  `<Icon key={unit.id} id={`hud-tile-unit-${unit.id}-icon`}`, `hud/bar.tsx` e `hud/city.tsx` com as formas que já têm, e `hud/kit.tsx` com o `Image` do `Icon`. Os importadores também passam pelo
  manifesto 0.5: só os nomes e as propriedades que ele decide.
- O texto do cartão não mudou onde não há irrigação: os checks da matriz comparam a linha de unidades e a de rendimentos com o texto exato do snapshot.
- As sabotagens retidas da HUD (`scripts/civ-lite-ui-sabotage.mjs`) não foram alteradas e seguem rejeitadas pela lane como estão; os braços não precisam tocá-las.

## Verificação da base

| Comando | Resultado |
| --- | --- |
| `npm run test:civ-lite-game` e `node scripts/civ-lite-game-sabotage.mjs` | passam (12 sabotagens rejeitadas, controle restaurado) |
| `npm run test:frontier-services` | 11 testes passam |
| `npm run test:consumer:civ-lite` | passa (20 checks de construção, 165 checks nativos, 10 ciclos) |
| `npm run test:frontier-stress` e `npm run test:frontier-soak` | passam (19 vínculos) |
| `npm run test:contracts`, `npm run type-check` e `npm run check:static` | passam |
| `node scripts/civ-lite-ui-sabotage.mjs actions-reversed icon-missing native-end-turn-by-phase` | as três rejeitadas, controle restaurado |
| `node --test tests/civ-lite-ui-native.test.mjs` | falha nos dois braços só no estágio `irrigation`, como na tabela acima |

Para mostrar que a lane é satisfazível, uma alteração descartável de cada HUD (feita fora de qualquer commit e revertida antes dele) a fez passar por inteiro: 161 + 28 + 41 checks
de sonda, as 49 + 23 + 38 mutações do oráculo e os controles na C, e 161 + 28 checks e as 49 + 23 mutações na B. Essas alterações não fazem parte de nenhuma branch.

## Limites

- `scripts/frontier-services-sabotage.mjs` já não roda na `main` (`6c7e8ba`): a âncora da sabotagem `late-register` procura o `_enter_tree` anterior à cena nativa e não existe mais. A base não o
  corrige, e as lanes de serviços e de paridade que ela afeta passam.
- A base mede o pedido numa só observação por braço, como o pré-registro diz; a ordem (B antes de C) segue a nota.
