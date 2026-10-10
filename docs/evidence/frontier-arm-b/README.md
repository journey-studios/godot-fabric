# Braço B do comparativo final: a HUD nativa do Godot passa a matriz de contexto (V05-10, critério `braco-b`)

Registro da entrega do braço B do V05-10: o mesmo jogo Frontier com uma HUD nativa do Godot escrita em GDScript (Controls, sinais, atualizando só o que mudou), com os
mesmos 6 painéis, 7 contextos e testIDs da HUD React Native do V05-05 (braço C), e a prova de que ela passa a regra de invalidação `parity` do
[protocolo](../../research/frontier-comparison-protocol.md): em cada um dos sete contextos os testIDs visíveis são os da tabela da matriz. Implementação em `d8bd678285efb13681e1a5d39fdec394069888b7`
(<https://github.com/journey-studios/godot-fabric/commit/d8bd678285efb13681e1a5d39fdec394069888b7>). O desenho e o que difere do braço C estão em [docs/research/frontier-arm-b.md](../../research/frontier-arm-b.md).

**Este registro não afirma nenhum resultado de medição.** Nenhuma execução comparativa rodou, a passada de otimização do braço B (no máximo 3,2 h, uma rodada) não foi
feita, e nada aqui diz que uma HUD é mais rápida, mais lenta ou mais barata que a outra. O esforço está registrado, não julgado. Fecham-se só o critério `braco-b` do V05-10
(sem tarefa, fase, sequência, checklist nem decisão tocados) e nenhuma tarefa do GF.

## O que foi executado

Localmente, macOS arm64, Godot 4.7.2 oficial, Node v22.23.3, no worktree do braço B a partir de `09ed8f7`. O host nativo foi reconstruído antes da primeira execução (o
preservado era anterior ao #104 e o `create-consumer` recusa um host que não bate com as fontes); a entrega não tem C++.

| Comando | Resultado |
| --- | --- |
| `node --test tests/civ-lite-ui-native.test.mjs` (as duas HUDs) | passou: HUD React Native 144 + 28 + 41 verificações, HUD nativa 144 + 28 |
| `node --test-name-pattern="native HUD" tests/civ-lite-ui-native.test.mjs --capture` | passou: mais as 8 capturas dos contextos e da fase da IA e as 4 dos overlays, em janela |
| `node scripts/civ-lite-ui-sabotage.mjs` | passou: as 20 variantes da lane (17 de antes e as 3 do braço B) rejeitadas pela sonda e pelo oráculo, as fontes restauradas byte a byte e a lane limpa passando depois (status 0) |
| `npm run test:consumer:civ-lite` | passou: 20 verificações de construção e posse, 165 nativas, 10 ciclos |
| `npm run test:civ-lite-game` | passou: o hash dourado do replay de 12 turnos não mudou |
| `npm run test:frontier-services` | passou: 11 testes |
| `npm run test:frontier-soak` | passou: 1 teste |
| `npm run test:frontier-turn` | passou: 1 teste |
| `npm run test:contracts` | passou: 490 testes de Node e 13 de Python, a validação do painel inclusive |
| `npm run type-check`, `npm run check:static`, `npm run check:publication` | passaram (0 achados; 2 028 arquivos varridos, sem falha) |
| `node scripts/milestone-guards.mjs --check --base origin/main` | passou: X9 e X10 limpos (contra 8f33064) |

## Paridade: os painéis de cada contexto

A mesma sonda (`hud_validation.gd`, sem uma linha alterada), na cena `res://main_native.tscn`, toca os passos 0 a 45 do replay pelos serviços e observa a HUD depois de cada um; os sete
passos de cobertura são os sete contextos. O oráculo independente (`tests/civ-lite-ui-oracle.mjs`, também sem alteração: a mesma tabela, os mesmos 46 passos, as mesmas regras)
julga o relatório cru e dá **0 achados**. Os testIDs de painel visíveis em cada passo de cobertura são exatamente os da tabela:

| Contexto | Passo | Painéis vistos na HUD nativa | Tabela |
| --- | ---: | --- | --- |
| `none` | 33 | `hud-bar` | `hud-bar` |
| `tile` | 32 | `hud-bar`, `hud-tile` | `hud-bar`, `hud-tile` |
| `settler` | 3 | `hud-bar`, `hud-actions`, `hud-tile` | `hud-bar`, `hud-actions`, `hud-tile` |
| `warrior` | 9 | `hud-bar`, `hud-actions`, `hud-tile` | `hud-bar`, `hud-actions`, `hud-tile` |
| `stack` | 2 | `hud-bar`, `hud-actions`, `hud-tile` | `hud-bar`, `hud-actions`, `hud-tile` |
| `city` | 18 | `hud-bar`, `hud-city`, `hud-research` | `hud-bar`, `hud-city`, `hud-research` |
| `dialog` | 45 | `hud-bar`, `hud-dialog` | `hud-bar`, `hud-dialog` |

Em todos os 46 passos a lista de ações é a do snapshot menos End turn (id, rótulo, habilitada, motivo, ordem), a barra diz o turno, a fase e os três recursos do snapshot, o End turn está
habilitado exatamente quando a ação `end_turn` do jogo diz, e nenhum Control da árvore que para o ponteiro cobre um ladrilho; o overlay cobre o mapa inteiro nos contextos `city` e
`dialog` e em nenhum outro. A fase do turno (13 quadros observados, todos os sete estados publicados, o spinner e o End turn certos em cada quadro, um segundo turno retido na fase
`ai_plan`) e a entrada real (clique, hover, painel, ação, menu e volta) também passam, nas 144 verificações da sonda.

## Como as sondas leem as duas HUDs

`hud_probe.gd` ganhou **um** ponto de leitura, o leitor (`hud_reader.gd`): `hud_reader_host.gd` é o código de antes (as linhas vêm do snapshot do host React Native) e `hud_reader_native.gd`
devolve as mesmas linhas dos Controls nativos, as do overlay inclusive. Cada Control é nomeado pelo seu testID, como o host nomeia os que monta; um Button do Godot guarda texto e ícone
como propriedades, e o leitor os relata como as linhas `<testID>-label` e `<testID>-icon` que a árvore do React Native tem como filhos. `modal` é "dentro do overlay". A cena diz qual
leitor vale (`Application/Runtime` é o do host); nenhuma sonda pergunta em que braço roda. O relatório traz `arm`.

A sonda de overlays (`overlay_validation.gd`) roda nos dois braços: a fila de três eventos, o bloqueio (100 cliques, 100 cliques com o botão direito e 100 giros da roda no mapa sob cada
overlay chegam 0 vezes ao mundo, e 100 de 100 com o overlay fechado), o Escape e o jogo novo. O que o braço B não pode dizer está listado no relatório e escrito no oráculo, que exige
que a lista seja exatamente a do braço: **não se aplica ao braço B** a lista de erros da aplicação depois do remonte (não há `Application`). O remonte do B tira a HUD da árvore e a
devolve, e o primeiro quadro já mostra o evento da cabeça da fila. O Escape, que antes só a sonda de estabilidade do braço C olhava, é agora uma etapa das duas: na tela da cidade é um
`clear_selection` e o overlay some, no diálogo nenhuma chamada chega ao jogo e a cabeça é a mesma (a sonda passou de 26 para 28 verificações nos dois braços). A sonda de estabilidade
é do host React Native e não roda no braço B.

## Contra-controle e sabotagens

**Contra-controle.** A mesma lane numa HUD nativa quebrada de propósito, cuja tabela ignora o contexto e monta as ações e o cartão do ladrilho nos sete, falha a matriz: categorias
`panels` (188 achados), `content` (72), `map` (14), `input` (2) e `phase` (2), 25 verificações da sonda, e os painéis vistos nos sete contextos são os mesmos três
(`hud-bar`, `hud-actions`, `hud-tile`). O oráculo rejeita 27 cópias mutadas do relatório genuíno do braço B (as da HUD React Native, agora sobre o relatório nativo) e 23 do relatório de
overlays, cada uma na categoria que quebra, e um relatório nativo que não lista o que não diz.

**Sabotagens retidas** (`scripts/civ-lite-ui-sabotage.mjs`, com a convenção de restaurar byte a byte; a receita é `build/civ-lite-ui-sabotage.json`). Cada uma é rejeitada pela sonda e pelo
oráculo pela regra que quebra:

| Sabotagem | O que quebra | Rejeitada por |
| --- | --- | --- |
| `native-city-shows-tile` | a tabela monta também o cartão do ladrilho no contexto `city` | a sonda (14 verificações, "a HUD mostrou ... para o contexto city") e o oráculo (`panels` e `remount`) |
| `native-overlay-not-blocking` | o overlay deixa de parar o ponteiro: ainda escurece o jogo, mas o mundo ouve os cliques, os cliques com o botão direito e a roda sob a tela da cidade e o diálogo | a sonda (5 verificações: o Modal cobre o mapa, 0 de 100 chegam ao mundo) e o oráculo (`map` e `blocking`) |
| `native-end-turn-by-phase` | o End turn é habilitado por uma regra da HUD (a fase é `idle`) e não pela ação `end_turn` do jogo | a sonda (2 verificações da barra, no contexto `dialog`) e o oráculo (`bar`) |

## Capturas

Janela do macOS, lane `--capture`, lidas uma a uma: os mesmos painéis e a mesma intenção de layout da HUD React Native, não o mesmo pixel (a fonte e a métrica de texto são as do Godot).

| Contexto | Captura |
| --- | --- |
| `none`: só a barra | ![none](none.png) |
| `tile`: barra e cartão do ladrilho selecionado | ![tile](tile.png) |
| `settler`: ações (Found city, Fortify recusada com o motivo), cartão | ![settler](settler.png) |
| `warrior`: ação Fortify, cartão | ![warrior](warrior.png) |
| `stack`: uma `select_unit` por unidade, cartão com os dois ícones | ![stack](stack.png) |
| `city`: tela da cidade e pesquisa em overlay sobre o mapa escurecido, barra desabilitada por baixo | ![city](city.png) |
| `dialog`: o evento "1 of 3" em overlay centralizado | ![dialog](dialog.png) |
| fase da IA: spinner, fase `ai_plan`, End turn desabilitado com o motivo do jogo | ![ai-phase](ai-phase.png) |

Os overlays da sonda de overlays: a tela da cidade com o Warrior na fila, e o diálogo em "1 of 3", em "2 of 3" depois do remonte e em "3 of 3".

| ![overlay-city](overlay-city.png) | ![overlay-dialog-1](overlay-dialog-1.png) |
| --- | --- |
| ![overlay-dialog-2-remounted](overlay-dialog-2-remounted.png) | ![overlay-dialog-3](overlay-dialog-3.png) |

## Extras pedidos depois da paridade (tempo à parte)

Dois pedidos do orquestrador, feitos depois de o braço B passar e que não são esforço do B:

- **A cena do braço A**, `consumers/civ-lite/main_bare.tscn`: a raiz `GameServices` e o `World` e nada mais (sem `HUDLayer`, `Application`, `FabricSurface` nem nó de validação).
  Sobe em headless e em janela com `--quit-after 60`, sai com 0 e não loga erro (a lane do braço B o confere); e uma execução avulsa tocou o replay inteiro pelos serviços na cena (77 passos,
  nenhum código diferente do roteiro, o hash dourado no fim, o `World` presente e nenhuma `CanvasLayer`). Nenhuma sonda roda nela.
- **O gancho para o executor do Agente 4**: a HUD nativa guarda o último snapshot que mostrou num só lugar (`_applied`, atribuído em `_show_game`) e o devolve por `applied_snapshot()`; o método
  do contrato do executor é trivial de acrescentar sobre ele, e o formato fica para quando o executor o der.

## Esforço

| | Braço B (HUD nativa) | Braço C (HUD React Native) |
| --- | ---: | ---: |
| Arquivos da HUD | 22 (12 `.gd`, 8 `.tscn`, `theme.tres`, `main_native.tscn`) | 13 (`ui/hud/*` 10, `ui/store.ts`, `ui/telemetry.ts`, `ui/index.tsx`) |
| Linhas da HUD | 1 310 (736 de `.gd`, 371 de `.tscn`, 179 do tema, 24 da cena) | 698 (663 sem `icons.ts`) |
| Leitor das sondas | `hud_reader.gd` 57 + `hud_reader_native.gd` 110 = 167 linhas novas; `hud_reader_host.gd` (74) é o código do braço C movido | |
| Sonda compartilhada | `hud_probe.gd` +32 −41, `overlay_validation.gd` +42 −8 (o Escape), `stability_validation.gd` −10 | |
| Jogo e HUD React Native | `services/game_services.gd` +5 −2 (uma busca que tolera a falta de `Application`) | sem alteração |
| Tempo ativo de subagente | **1,71 h** medidas pelo orquestrador sobre a transcrição, pela regra da emenda (a soma dos intervalos menores que 30 minutos entre eventos; nenhum intervalo passou de 10 minutos, então o corte não muda o número), de 05:18:39 a 07:01:02 UTC de 2026-10-10. O número inclui os dois extras pedidos no meio do trabalho (a cena `main_bare.tscn` do braço A e o `applied_snapshot()`), que o implementer estima em cerca de 0,2 h e que não se separam da transcrição; o braço B ficou portanto em no máximo 1,71 h do time-box de 12,8 h | 12,8 h (7,35 + 5,12 + 0,12 + 0,19, na emenda do protocolo) |

As linhas do B contam a cena e o tema, que no C vivem dentro do TSX; sem eles são 736 linhas de script contra 698 de TSX/TS. A medida do tempo é a do protocolo: a soma dos intervalos
de menos de 30 minutos entre os eventos com carimbo da transcrição, e o orquestrador a refaz da transcrição. Nenhuma conclusão de custo sai deste quadro: ele alimenta o critério.

## O que a lane achou

- **Uma cena sem `Application` não era silenciosa.** O `GameServices` ligava `$Application.runtime_available` em `_enter_tree`, e a cena nativa falhava com `Node not found: "Application"`
  e um erro de script, ao contrário do que a especificação supunha. A correção são quatro linhas (`get_node_or_null`, ligar só se houver); em toda cena com `Application` o nó faz o que fazia.
- **O ícone de um Button some com `expand_icon`.** Num Button do tamanho do texto o ícone colapsava; a constante `icon_max_width` do tema o desenha em 20 px.
- **O giro da roda atravessa um Control que para o ponteiro.** A primeira execução reprovou "um clique e um giro da roda num painel não chegam ao mundo": o GUI marca o clique como tratado,
  mas o giro segue para `_unhandled_input`. A raiz da HUD o reivindica enquanto `gui_get_hovered_control()` não é nulo, e por isso precisa vir depois do mundo na árvore, como a Surface do C.
- **Um leitor não pergunta a árvore ao nó que lê.** A primeira versão do leitor do host usava o `get_tree()` do próprio Control, nulo para um Control que o host desmonta; usa o da HUD.

## Limites

- Execução local em macOS arm64 (a lane headless e as capturas em janela); a CI hospedada e o Pages do commit de implementação ficam para os recibos depois do merge.
- A sonda de estabilidade (20 aberturas e fechamentos, vazamentos, foco, ícones) é do host React Native e não roda no braço B. O braço B não tem o equivalente medido de vazamento, foco e
  ícones; isto fica aberto para a passada de otimização e para as execuções.
- O hover e o clique foram exercitados com eventos sintéticos pela viewport (e em janela, nas capturas), sem mouse físico. iOS, texto digitado e IME, imagens de rede e outras
  plataformas estão fora.
- Nenhuma medição de tempo de quadro, memória, partida ou pacote do braço B: é a `execucao` e a `metricas`.

## Abertos

| Item | Dono |
| --- | --- |
| Passada de otimização do braço B (no máximo 3,2 h, uma rodada, preservando a paridade) | V05-10 |
| `execucao`, `metricas`, `mudanca` e `relatorio` | V05-10 |
| Recibos da CI hospedada e do Pages do commit de implementação | depois do merge |

## Pins

O commit de implementação é `d8bd678285efb13681e1a5d39fdec394069888b7`. O `report.json` guarda o SHA-256 de cada fonte que as lanes rodaram, dos relatórios e das capturas.
