# Frontier: a HUD guiada pelo contexto do jogo, a matriz dos sete contextos e o mapa

Esta fatia fecha os critérios `matriz` e `mapa` do V05-05 do marco 0.5, sobre o jogo, os serviços, o consumidor e a política de
props dos registros anteriores. A HUD de React Native deixa de ser o painel mínimo da fatia `consumidor` e passa a montar, para
cada um dos **sete contextos** que o Godot deriva do estado, exatamente os painéis que o contexto pede: a barra de turno e
recursos (com o End Turn desabilitado e um spinner enquanto a fase da IA roda), as ações da unidade com o motivo da ação
desabilitada, o cartão do tile (com o hover vindo do Godot), a tela da cidade, a pesquisa e o diálogo do evento. O mapa passa a
ser do mundo: um clique em um tile seleciona pelo `select_tile` do próprio jogo, e o ponteiro sobre o mapa é publicado como um
estado à parte, `frontier.hover`. Os critérios `overlays` e `estabilidade` do V05-05 ficam para a fatia 2: aqui o diálogo é um
painel posicionado, ainda não um `Modal` bloqueante. A [pesquisa](../../research/frontier-hud.md) tem a tabela, o store, o hover,
o caminho do input e a ordem do mundo, com arquivo e linha; o recibo [`report.json`](report.json) fixa as fontes, os relatórios e
os resultados.

Os fontes da fatia estão fixados no **commit de implementação
[`38d3182`](https://github.com/journey-studios/godot-fabric/commit/38d3182ec3ea1e81387910ed22ef732d38199c0d)**
(`38d3182ec3ea1e81387910ed22ef732d38199c0d`, árvore `3ad4d3b1a4d564610506857f97bc3fb4eab72d88`, sobre a main `5e1f6a1`, o PR #79,
que fez do fim do turno um job). Todos os comandos abaixo rodaram nessa árvore: o `git status --porcelain` antes do primeiro
comando listava só um arquivo novo de documentação (`docs/research/frontier-hud.md`), e depois do último, só os documentos
desta fatia; nenhum arquivo executado mudou, e cada SHA-256 do recibo bate com `git show 38d3182:<caminho>`. Os arquivos desta
evidência foram escritos depois e não são entrada de nenhuma lane. Ambiente: macOS arm64 (26.6.2), Godot oficial **4.7.2**
(`ed1daf0bf`), React Native **0.87.1** e React 19.2.3 com o Hermes da aplicação, Node **v22.23.3**, em modo headless e, para as
capturas, **janelado** na tela local. A fatia **não tem C++**: o host nativo é o do commit anterior
(`addons/fabric_godot.dylib`, SHA-256 `258d1821…084da`), o que o recibo registra.

## As capturas

Oito capturas reais do renderizador, uma por contexto e uma durante a fase da IA, salvas pela corrida janelada
(`node tests/civ-lite-ui-native.test.mjs --capture`); cada uma foi lida antes de entrar aqui, e o SHA-256 de cada PNG está no
recibo. Os contextos são os dos passos do replay que os cobrem (a coluna da direita é o passo).

| Contexto (passo) | Captura | O que mostra |
| --- | --- | --- |
| `none` (33) | ![none](none.png) | Só a barra: turno 3, fase `idle`, os três recursos com a taxa, End turn habilitado. A seleção foi limpa e nenhum outro painel existe. |
| `tile` (32) | ![tile](tile.png) | A barra e o cartão do tile (9, 8), uma planície vazia, selecionado (contorno branco no mapa). Sem painel de ações: não há unidade. |
| `settler` (3) | ![settler](settler.png) | Barra, ações e cartão. "Found city" habilitada, "Fortify" cinza com o motivo do jogo ("Settlers cannot fortify.") e "Clear selection"; o cartão lista as duas unidades do tile (6, 8). |
| `warrior` (9) | ![warrior](warrior.png) | Barra, ações e cartão do tile (6, 8), agora só com o Warrior. "Fortify" e "Clear selection". |
| `stack` (2) | ![stack](stack.png) | Barra, ações com um `select_unit` por unidade ("Select Settler", "Select Warrior") e "Clear selection", e o cartão do tile com as duas unidades. |
| `city` (18) | ![city](city.png) | Barra, a tela da cidade (Aurora, tamanho 1/3, produção, fila vazia, os quatro itens com o motivo de cada um bloqueado) e a pesquisa (Alphabet disponível; as outras com "Technologies are researched in list order."). |
| `dialog` (45) | ![dialog](dialog.png) | Barra e o diálogo "Wanderers at the gate" com as duas escolhas e o detalhe de cada. End turn cinza, com "A decision is waiting. Resolve the event first." ao lado. |
| fase da IA | ![ai-phase](ai-phase.png) | A barra no meio do turno: a fase `ai_plan`, o spinner girando, End turn cinza com "The turn is being processed." A coluna da direita e o cartão não existem: o contexto é `none`. |

## A tabela contexto → painéis

A tabela de `docs/research/frontier-game.md` ("The seven contexts"), que a fatia anterior deixou para a HUD confirmar, foi
confirmada sem mudança e é a que a HUD implementa ([`hud.tsx:29-44`](https://github.com/journey-studios/godot-fabric/blob/38d3182ec3ea1e81387910ed22ef732d38199c0d/consumers/civ-lite/ui/hud/hud.tsx#L29-L44)):

| Contexto | Painéis (testIDs) |
| --- | --- |
| `none` | `hud-bar` |
| `tile` | `hud-bar`, `hud-tile` |
| `settler`, `warrior` | `hud-bar`, `hud-actions`, `hud-tile` |
| `stack` | `hud-bar`, `hud-actions` (um `select_unit` por unidade), `hud-tile` |
| `city` | `hud-bar`, `hud-city`, `hud-research` |
| `dialog` | `hud-bar`, `hud-dialog` |

Só o contexto decide: nenhum painel olha se a cidade ou o diálogo têm dados, porque o snapshot carrega `city` e `research` em
todos os contextos depois que a cidade existe. Cada painel é uma caixa posicionada, e a raiz e a coluna da direita são
`pointerEvents="box-none"`: nenhum spacer nem View de layout reivindica a área do mapa.

## O que mudou

- **Um store no escopo do módulo** ([`ui/store.ts`](https://github.com/journey-studios/godot-fabric/blob/38d3182ec3ea1e81387910ed22ef732d38199c0d/consumers/civ-lite/ui/store.ts)):
  o único módulo que fala com o jogo. A HUD lê pelo `useFrontier()`, que é `useSyncExternalStore`; as conexões a `frontier.snapshot` e
  a `frontier.hover` seguem os leitores (o primeiro conecta, o último solta, e o menu, que não lê nada, segura zero conexões),
  e as intenções saem por `send(...)`, tipado sobre `callFrontier`, e por `sendAction(ação)`. Nenhum painel assina, chama um
  serviço, ou tem efeito, ref de evento ou `addEventListener`: a lane varre os fontes e confere.
- **A telemetria da validação é um módulo à parte** ([`ui/telemetry.ts`](https://github.com/journey-studios/godot-fabric/blob/38d3182ec3ea1e81387910ed22ef732d38199c0d/consumers/civ-lite/ui/telemetry.ts)):
  o store só diz a ela o que recebeu e enviou, e ela instala o `FrontierHud` que a validação lê. Uma cópia da HUD a apaga com um import.
- **A barra** ([`bar.tsx`](https://github.com/journey-studios/godot-fabric/blob/38d3182ec3ea1e81387910ed22ef732d38199c0d/consumers/civ-lite/ui/hud/bar.tsx)):
  turno, fase, recursos `estoque (+taxa)`, End turn, spinner e Menu/New game. End turn é a ação `end_turn` do snapshot: está
  desabilitado exatamente quando o jogo diz, com o `reason_text` do jogo ao lado, e não por uma segunda regra da HUD na fase. O
  spinner (`hud-turn-spinner`) existe exatamente enquanto `phase != "idle"`.
- **O serviço `frontier.hover`**: um segundo estado, registrado ao lado do snapshot, com o mesmo DTO do cartão do tile
  selecionado (`present` 0 quando o ponteiro não está sobre um tile). O snapshot, a regra de emissão dele e os hashes golden e
  trace não mudaram. O registro passa de 14 para **15 bindings** (dois estados, um sinal, os mesmos 12 métodos); a paridade
  Godot/TypeScript segue verde nos dois sentidos, com duas mutações novas.
- **O input do mapa é do Godot** ([`world.gd`](https://github.com/journey-studios/godot-fabric/blob/38d3182ec3ea1e81387910ed22ef732d38199c0d/consumers/civ-lite/world/world.gd)):
  o mundo ouve em `_unhandled_input`, como a política do P1 prevê, um clique esquerdo em um tile chama `select_tile` pelo nó
  `GameServices` (Godot para Godot, as regras ficam em GDScript) e o movimento do mouse publica o hover. O hover sai quando o
  ponteiro vai para um painel ou para fora da janela. Sem hover de `Pressable` (`onHoverIn` segue recusado) e sem clique direito.
- **A ordem do mundo na árvore**: o `GameServices` agora devolve o mundo antes do `CanvasLayer` da HUD quando o traz de volta
  depois do menu (ver os achados).

## O que foi executado

| Lane | Resultado | Tempo |
| --- | --- | ---: |
| `node tests/civ-lite-ui-native.test.mjs --control --capture` (a lane `test:civ-lite-ui`, com o controle e as capturas) | **143 checks** da probe headless (151 na corrida janelada), oráculo com 0 achados, 23 mutações do oráculo rejeitadas, controle falha em 5 categorias | 95 s |
| `node scripts/civ-lite-ui-sabotage.mjs` | **8 de 8** sabotagens rejeitadas pela probe e pelo oráculo; fontes restauradas byte a byte; a lane restaurada passa | 348 s |
| `npm run test:consumer:civ-lite` | 20 checks de build e posse, **165 nativos**, dez ciclos (as mesmas medidas, com 15 bindings e as duas conexões da HUD) | 30 s |
| `node scripts/consumer-civ-lite-sabotage.mjs` | **5 de 5** rejeitadas (39, 19, 21, 3 e 10 falhas); restaurada; o template restaurado passa | 198 s |
| `npm run test:frontier-services` | **11/11** (a probe com o oráculo e a paridade, agora com 15 registros) | 28 s |
| `npm run test:civ-lite-game` | passou, os mesmos hashes golden e trace | 1 s |

Os gates que leem documentos (`check:publication`, `check:static`, `test:dashboard`, `test:contracts`) rodaram depois, na árvore
que tem estes registros; o recibo guarda o resultado. As onze sabotagens dos serviços rodaram na revisão da fatia, sobre os
mesmos `game_services.gd` e `schema.gd`, e não foram repetidas neste lote.

```sh
npm run test:civ-lite-ui                                      # a lane, headless, com o controle quando o commit existe no checkout
node tests/civ-lite-ui-native.test.mjs --control --capture    # o controle é obrigatório; mais as oito capturas, janeladas
node scripts/civ-lite-ui-sabotage.mjs                         # as oito sabotagens e, no fim, a lane restaurada
npm run test:consumer:civ-lite                                # o consumidor provisionado, sob a nova HUD
node scripts/consumer-civ-lite-sabotage.mjs
npm run test:frontier-services                                # os 15 bindings e a paridade do hover
```

## Como a lane julga

A fatia provisiona o template `consumers/civ-lite/` pelo addon em um projeto fora do checkout, constrói no editor sem Node próprio e
roda, no Godot oficial, a probe [`hud_validation.gd`](https://github.com/journey-studios/godot-fabric/blob/38d3182ec3ea1e81387910ed22ef732d38199c0d/consumers/civ-lite/hud_validation.gd)
(`-- --validate-hud`), que escreve **observações cruas** (a árvore da HUD como o host a reporta: testID, texto, posição, se o Control
bloqueia o ponteiro, se o Pressable está desabilitado). O [oráculo](https://github.com/journey-studios/godot-fabric/blob/38d3182ec3ea1e81387910ed22ef732d38199c0d/tests/civ-lite-ui-oracle.mjs)
foi escrito à parte e julga essas observações de novo, a partir da tabela acima, do formato do que cada painel diz e da geometria
do mapa, sem ler os veredictos da probe.

- **Matriz.** Os passos 0 a 45 do replay (46 passos) passam pelos serviços em um jogo novo; os sete passos que cobrem os contextos
  são o 2 (`stack`), 3 (`settler`), 9 (`warrior`), 18 (`city`), 32 (`tile`), 33 (`none`) e 45 (`dialog`). Em cada passo: o conjunto
  exato de testIDs de painel visíveis é o da tabela, nenhum testID fora dos seis painéis, da raiz e do spinner está montado, a lista
  do painel de ações é a de `snapshot.actions` menos `end_turn` (id, rótulo, habilitada, motivo e ordem), a barra e os cartões dizem o
  que o snapshot diz, e nenhum Control que bloqueia o ponteiro cobre um tile do mapa.
- **A fase da IA.** Um End Turn real na HUD roda o job e **cada quadro** é observado: o spinner e o botão desabilitado têm de
  concordar com a fase, e só fases que o jogo publicou podem aparecer (15 quadros observados e 7 snapshots publicados na
  corrida; a invariante é por snapshot, e nenhuma contagem depende do ritmo do runner). Depois um segundo job é **segurado** na
  primeira fase (o `_process` do nó desligado antes do clique): o spinner gira, End turn está desabilitado com o motivo do jogo
  e um toque nele não faz nenhuma chamada. Liberado, o turno acaba, o spinner some e End turn volta.
- **Input real.** Eventos empurrados pelo viewport com o dispositivo de validação da Surface: um clique em (6, 8) e em (9, 8)
  seleciona o tile que a geometria dá; o ponteiro sobre (12, 4) publica o hover e o cartão o mostra, sem mover a seleção; sobre a
  barra e fora do mapa o hover some; um clique e um giro da roda sobre um painel não chegam ao mundo; um toque real em "Select
  Warrior" e em "Fortify" executa a ação; um toque no "Fortify" desabilitado não faz chamada e a HUD mostra o motivo ("The unit is
  already fortified."); e tudo de novo depois do menu e de um New game.

## O controle causal

Para provar que a lane mede a HUD e não o acaso, a **mesma lane** roda sobre a HUD de `5e1f6a1`: o `ui/index.tsx` anterior, tirado
do git (`git show 5e1f6a1:consumers/civ-lite/ui/index.tsx`, SHA-256 `d477f51c…9a09346`, conferido), na mesma cena e com o mesmo host.
Ele **falha em cinco categorias do oráculo**: `panels` (578 achados), `phase` (374), `content` (86), `actions` (25) e `input` (16),
e 135 checks da probe. Nos sete passos de cobertura ele não mostra nenhum painel dos seis; o End turn e o spinner da fase da
IA não existem; o hover chega ao Godot mas nenhum cartão o mostra. O controle depende do commit `5e1f6a1` estar no checkout: um clone
raso (a CI hospedada) o pula e diz isso, e `--control` torna a ausência um erro.

## As sabotagens

Oito sabotagens retidas quebram um fonte do template de propósito, rodam a lane contra ele e exigem que a probe **e** o oráculo a
rejeitem, pela razão por que foi quebrada ([`scripts/civ-lite-ui-sabotage.mjs`](https://github.com/journey-studios/godot-fabric/blob/38d3182ec3ea1e81387910ed22ef732d38199c0d/scripts/civ-lite-ui-sabotage.mjs)):

| Sabotagem | O que quebra | Checks da probe que falham | Categorias do oráculo |
| --- | --- | ---: | --- |
| `city-by-data` | a tela da cidade é gateada por `city.present` e não pelo contexto | 17 | `panels` |
| `actions-reversed` | o painel de ações lista as ações na ordem oposta | 26 | `actions`, `panels` |
| `spinner-always` | o spinner não é amarrado à fase: gira em repouso | 49 | `bar`, `phase` |
| `end-turn-by-phase` | End turn habilitado por uma regra da HUD (`phase === "idle"`), não pela ação `end_turn` | 2 | `bar` |
| `spacer` | um spacer de altura cheia, com testID, cobre o mapa | 12 | `input`, `map`, `panels` |
| `hover-unpublished` | o mundo deixa de dizer ao nó qual tile está sob o ponteiro | 2 | `input` |
| `world-behind-hud` | o mundo volta depois do menu atrás da camada da HUD | 2 | `input` |
| `disabled-ignored` | o botão deixa de passar o `enabled` do jogo ao Pressable | 18 | `actions`, `bar`, `content`, `input`, `panels`, `phase` |

O oráculo também rejeita, em memória, 23 cópias do relatório genuíno com uma coisa quebrada cada (um painel a menos, um a mais, um
testID sem dono, ações em outra ordem, uma ação desabilitada mostrada habilitada, um motivo que não é o do jogo, o spinner em
repouso, o End turn habilitado contra o jogo, um recurso errado, um Control sobre o mapa, o cartão de outro tile, uma escolha do
diálogo que não é a do jogo, um quadro do job incoerente, o toque no End turn desabilitado que chega ao jogo, nenhuma fase da IA
publicada, um clique que seleciona outro tile, um hover que não é o do ponteiro, um clique ou um giro da roda que chega ao
mundo, o mesmo cartão de hover duas vezes, um motivo que a barra esqueceu, um toque desabilitado que chega ao jogo e o mundo atrás
da camada da HUD), cada uma na categoria que quebra. As cinco sabotagens do consumidor seguem rejeitadas, com a `hud-leak` agora
sobre o `disconnect()` do store.

## O que a lane achou

- **O spacer da HUD anterior nunca engoliu um clique.** O `View` de 624 px do `ui/index.tsx` de `5e1f6a1`, sem testID e sem nada
  que pinte, é **achatado pelo Fabric**: nunca vira um Control e não reivindica nada. No controle, o clique real em (6, 8) seleciona
  o tile. O controle falha porque não há barra, painéis nem cartão, não por causa do spacer. A sabotagem `spacer` usa um spacer com
  testID, que não é achatado, e é rejeitada.
- **O mundo voltava depois da HUD.** O `GameServices` derruba o mundo no menu e traz um novo no New game, e o `add_child` o
  punha **por último**, atrás da `HUDLayer`. O Godot chama `_unhandled_input` na ordem inversa da árvore, então o mundo ouvia antes da
  Surface poder reivindicar. Um clique em um painel continua não chegando ao mundo (o Control do painel o bloqueia na GUI antes do
  estágio sem tratamento, qualquer que seja a ordem), mas **a roda do mouse sobre um painel** passa pela GUI e dependia da ordem.
  Hoje o mundo volta antes do primeiro `CanvasLayer`, e a probe prova com um giro da roda sobre cada painel, antes e depois do menu.
- **Uma janela headless tem 64×64**, o que quer que `window/size` diga, e a HUD, desenhada para 1080×600, saía errada. A probe ajusta
  o tamanho da janela raiz, como as probes de ponteiro do laboratório.
- **O nome do critério não existe.** O critério diz que a lista exibida é idêntica a `unit.available_actions`; o campo do DTO é
  `snapshot.actions`. O oráculo compara com `snapshot.actions` menos `end_turn`.
- **`end_turn` fica na barra.** O snapshot o lista entre as ações, e a HUD o põe na barra, com a mesma regra: habilitado quando a
  ação diz, com o motivo dela quando não.

## Imports de React Native

A HUD importa de `react-native`: `AppRegistry` (o membro `registerComponent`), `View`, `Text`, `Pressable` e `ActivityIndicator`;
de `react`, `useSyncExternalStore`; e de `@godot-fabric/runtime`, `GodotFabric.connect` e `GodotFabric.call` (só no `store.ts`).
As props usadas são `testID`, `style`, `pointerEvents="box-none"`, `key`, `disabled`, `onPress` e, no `ActivityIndicator`, `size`
e `color`. Nenhum `onHoverIn`, clique direito, `ScrollView` ou `Modal`. O manifesto do escopo do 0.5 decide todos esses nomes
menos o `AppRegistry`, que não é um dos doze: a cobertura dele no manifesto vem pelo PR do P9, que mexe nessa seção.

## Limites

- **O diálogo ainda não é um `Modal`.** Ele aparece no seu contexto como painel posicionado; o bloqueio, a fila de três eventos, a
  ordem da remontagem e o resto de `overlays` são da fatia 2.
- **O hover foi exercitado com eventos sintéticos** empurrados pelo viewport (dispositivo 1001, o de validação da Surface), nos
  dois modos, e na corrida janelada que salva as capturas; não com um mouse físico, e não com toque.
- **A CI hospedada roda só o headless.** O passo `npm run test:civ-lite-ui` do `native-cold-start` não salva capturas; elas são uma
  corrida local, janelada. O **run hospedado e a publicação no Pages estão pendentes**.
- **O controle precisa do commit `5e1f6a1` no checkout**, e um clone raso o pula.
- **Só macOS arm64.** Nada foi comparado com um iPhone, e digitação, hover público no `Pressable` e clique direito seguem fora do 0.5.
- Nenhum checkpoint, peso ou denominador do 1.0 se move; o dashboard não é editado por este registro.

## Em aberto: a fatia 2 do V05-05

- Os overlays como `Modal`s bloqueantes: o diálogo, a fila de três eventos e a ordem da remontagem.
- A estabilidade: vinte aberturas e fechamentos sem vazar, a restauração do foco, 0 de 100 cliques sob um overlay aberto, as capturas
  por contexto na forma final, o escaneamento da API e os ícones por `Image`.
- A cobertura do `AppRegistry` no manifesto do 0.5, pelo PR do P9.
