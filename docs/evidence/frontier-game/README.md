# Frontier: as regras e o cenário do jogo do 0.5, em GDScript

> **Registro fixado.** As contagens abaixo são as da execução sobre `4b86a7b`: 629 checks por execução e quatro sabotagens, com
> 6, 1, 13 e 3 falhas. A suíte atual tem **634 checks** e **seis sabotagens** (as quatro, com as mesmas falhas, mais `ai-ignores-block`
> e `ai-city`, com 5 e 4 falhas) porque a revisão do PR #70 corrigiu a facção depois de o registro ser fixado: o Warrior da IA
> agora espera no lugar quando há uma unidade do jogador **ou a cidade do jogador** no próximo tile da rota (antes só a unidade
> bloqueava, e o Warrior que a cidade concluía no mesmo turno nascia em cima da IA). O probe ganhou três turnos montados para esse
> caso (`city-on-route`, `city-on-route-next-turn` e `unit-on-route`), que o roteiro não alcança, e o oráculo os julga e passou a
> exigir que nenhum tile tenha unidades dos dois lados nem a facção na cidade. Os hashes dourado e de trilha e o roteiro (73
> passos) não mudaram, e por isso as duas sabotagens novas não perdem o hash dourado: só os turnos montados as rejeitam. O recibo e
> os links continuam descrevendo `4b86a7b`.

Esta fatia é o pacote P3 do marco 0.5 (V05-03, critério `replay`), ligada ao GF-28. O jogo de referência **Frontier**,
um jogo de estratégia por turnos no estilo de interação do Civilization 2, tem agora as suas regras e o seu cenário
em GDScript puro, com o Godot como autoridade: um mapa 24x16 de semente fixa, o Settler e o Warrior com movimento por
pontos, uma cidade com fila de produção, a pesquisa em lista, um evento bloqueante e uma facção roteirizada, tudo só com
inteiros, com um PRNG próprio (PCG32), serialização canônica e hash SHA-256. Os sete contextos da HUD saem do estado e
da seleção por uma função pura, e o snapshot que a HUD vai projetar é imutável e só tem inteiros e strings. Não há C++,
React nem exemplo visual: a fatia não toca `native/`, `src/` nem `sdk/`. A [pesquisa](../../research/frontier-game.md)
tem o modelo de estado e os DTOs campo a campo, as intenções, os motivos de recusa e as decisões; o
[recibo](execution.json) fixa fontes, hashes, contagens e resultados.

Tudo aqui foi executado **a partir do commit de implementação
[`4b86a7b`](https://github.com/journey-studios/godot-fabric/commit/4b86a7bd0c9f4880a2241369e944380a4ef7b32c)**
(`4b86a7bd0c9f4880a2241369e944380a4ef7b32c`, árvore `eee5aaba393797dcddcc521699ea24d0c3b4a264`, sobre a main `41fbe22`,
o PR #68), que traz a implementação (`b14ea13`) e a rodada de revisão (`4b86a7b`: a intenção `clear_selection`, que leva a
HUD de volta ao contexto `none` e entrou no roteiro e no oráculo). A árvore estava limpa e igual à do commit, sem arquivo
novo fora dos diretórios ignorados (`git status --porcelain` vazio antes do primeiro comando e depois do último), quando
cada comando abaixo rodou; os arquivos desta evidência foram acrescentados depois e não são entradas. Ambiente: macOS
arm64 (26.6.2), Godot oficial **4.7.2** (`ed1daf0bf`) e Node **v22.23.3**, em modo headless. React Native, React e Hermes
não participam desta fatia.

| Lane executada | Checks | Observação |
| --- | ---: | --- |
| Jogo atual, 3 rodadas de `npm run test:civ-lite-game`, cada uma com o probe em 3 processos | 629/629 em cada uma das 9 execuções | Os 9 relatórios têm os mesmos 338.700 bytes e o mesmo SHA-256 (`24cf4c1b…`), com a serialização canônica depois de cada um dos 73 passos; o hash dourado e o hash de trilha são os fixados no teste, e o oráculo independente aceita |
| Sabotagem `prng`: a saída do PRNG vem de `randi()` | 623/629 | 6 falhas em cada execução: PCG32 deixa de dar as saídas publicadas, a mesma semente deixa de dar o mesmo fluxo, a contagem de saídas, o `epoch` fora do hash, e jogar de novo e jogar fatiado deixam de chegar ao mesmo estado. Os 3 hashes finais divergem entre processos (`3f7c58d9…`, `9987680d…`, `a7d603f6…`); o oráculo rejeita com `the game's PRNG must produce PCG32's published reference outputs` e a varredura acha `prng.gd:34` |
| Sabotagem `canon`: o serializador não ordena as chaves | 628/629 | 1 falha: `canon: keys are sorted and nothing else is spaced`. O hash final vira `a9795430…` nas 3 execuções; o oráculo rejeita com `the initial state must be the canonical serialization (sorted keys, integers and ASCII only)` |
| Sabotagem `rule`: a floresta custa 1 ponto de movimento em vez de 2 | 614/627 | 13 falhas, a primeira no `found_city` que o roteiro espera recusado com `no_moves_left`, porque o Settler fica com um ponto que não podia ter. O hash final vira `73a60430…`; o oráculo rejeita com `step 4 move_unit(1, 7, 8) must leave the state the rules compute from the state before it` |
| Sabotagem `economy`: o centro da cidade rende 2 de produção em vez de 1 | 626/629 | 3 falhas (os passos do Granary que dependem do turno em que a produção fecha). O hash final vira `559d73d4…`; o oráculo rejeita com `step 31 end_turn() must leave the state the rules compute from the state before it`, o primeiro fim de turno em que a cidade produziu |
| Controle com host anterior | N/A | A fatia não tem código nativo: não há binário anterior a comparar, e o SDK anterior também não discrimina, porque nada sai de `src/` |

```sh
npm run test:civ-lite-game          # 3 processos, hash dourado, hash de trilha, oráculo
node scripts/civ-lite-game-sabotage.mjs   # as 4 sabotagens e, no fim, o jogo restaurado no teste normal
```

Os dois comandos rodam o Godot oficial sobre o projeto raiz
(`--path . --headless --script res://tests/civ-lite-game-probe.gd`), que carrega
`res://consumers/civ-lite/game/*.gd`. Cada sabotagem edita um fonte do jogo por
[`scripts/sabotage-sources.mjs`](https://github.com/journey-studios/godot-fabric/blob/4b86a7bd0c9f4880a2241369e944380a4ef7b32c/scripts/sabotage-sources.mjs)
e o restaura byte a byte, qualquer que seja o fim da execução; o script termina com o jogo restaurado no teste normal, que
passa. A rodada completa do script levou 8,7 s e cada `npm run test:civ-lite-game`, entre 1,9 s e 2,2 s.

## O que foi verificado

Os valores abaixo estão no [recibo](execution.json); os fontes estão fixados no commit de implementação.

### O replay

O [roteiro](https://github.com/journey-studios/godot-fabric/blob/4b86a7bd0c9f4880a2241369e944380a4ef7b32c/consumers/civ-lite/game/replay.gd)
joga 12 turnos e 73 intenções (43 aceitas e 30 recusadas de propósito), cada uma com o código e o contexto que deve
produzir, e termina no turno 13. O gerador sorteia 385 vezes (384 do mapa e 1 do presente dos andarilhos). O estado
depois do 12º `end_turn` tem o **hash dourado**, idêntico nas 9 execuções:

```
275b7c6182605a784d8be3565d4df38a5bb130aaa6c0ea7640abe4c521427d29
```

A rodada de revisão acrescentou `clear_selection` e quatro passos que a usam (dois aceitos, um `nothing_selected` e um
`event_pending`) **sem mudar o hash dourado**: a intenção só muda a seleção e não emite evento, e todo `end_turn` já a
zera, então o estado em que o 12º turno termina é o mesmo. O estado depois de cada um desses passos mudou, e por isso o
teste fixa também o **hash de trilha**, o SHA-256 dos hashes de estado de todos os passos, um por linha:

```
fba99004fa12e253b9a6fe7f8bbee0cbd6e468a67308d25d0c40236f48c68cb8
```

O probe jogou o roteiro de três maneiras e comparou: a primeira examinada passo a passo, uma segunda no mesmo processo e
uma terceira com cada `end_turn` fatiado em `begin_end_turn` mais um `advance_phase` por vez. As três chegaram ao mesmo
estado em todos os passos.

### Os sete contextos

O teste procura, no relatório, o passo do roteiro rotulado para cada contexto e exige que o contexto observado seja
aquele; o oráculo deriva o contexto de novo a partir da serialização de cada passo.

| Contexto | Passo | Intenção | Resultado |
| --- | ---: | --- | --- |
| `none` | 33 | `clear_selection()` | aceita, depois do tile vazio do turno 3 |
| `stack` | 2 | `select_tile(6, 8)` | aceita, o Settler e o Warrior no tile inicial |
| `settler` | 3 | `select_unit(1)` | aceita |
| `warrior` | 9 | `select_unit(2)` | aceita |
| `city` | 18 | `found_city(1)` | aceita, a nova cidade fica selecionada |
| `tile` | 32 | `select_tile(9, 8)` | aceita, uma planície vazia |
| `dialog` | 45 | `select_tile(7, 8)` | recusada com `event_pending` enquanto o evento está aberto |

Os oito snapshots do relatório (um por contexto e o final) têm exatamente os campos e os tipos documentados na pesquisa,
só inteiros e strings, e as ações de cada contexto são as documentadas (`none`: `end_turn`; `tile` e `city`:
`clear_selection` e `end_turn`; `settler`: `found_city`, `fortify`, `clear_selection`, `end_turn`; `warrior`: `fortify`,
`clear_selection`, `end_turn`; `stack`: um `select_unit` por unidade, `clear_selection`, `end_turn`; `dialog`: só
`end_turn`, desabilitado com `event_pending`, e a tela da cidade toda desabilitada pelo mesmo motivo). Em cada passo, toda
ação, item e tecnologia habilitados no snapshot são intenções aceitas numa cópia do jogo, e toda desabilitada é recusada com
o `reason` do snapshot.

### As recusas

Uma recusa devolve `ok: 0`, o código e o texto, e **não muda o estado**: o probe compara a serialização antes e depois e o
oráculo exige o mesmo. O roteiro recusa com 24 códigos:

| Código | Vezes | Código | Vezes |
| --- | ---: | --- | ---: |
| `tech_required` | 4 | `event_pending` | 3 |
| `unknown_unit` | 2 | `nothing_selected` | 1 |
| `out_of_bounds` | 1 | `no_moves_left` | 1 |
| `not_adjacent` | 1 | `cannot_fortify` | 1 |
| `not_a_settler` | 1 | `impassable_terrain` | 1 |
| `not_your_unit` | 1 | `already_fortified` | 1 |
| `no_city` | 1 | `unknown_item` | 1 |
| `bad_slot` | 1 | `research_out_of_order` | 1 |
| `already_researching` | 1 | `unknown_tech` | 1 |
| `not_enough_moves` | 1 | `unknown_choice` | 1 |
| `no_event` | 1 | `tech_known` | 1 |
| `already_queued` | 1 | `already_built` | 1 |

Outros quatro códigos o cenário não alcança (tem um Settler só, uma facção que nunca anda ao lado do jogador e uma fila
que nunca enche); o probe monta um estado para cada um e exige a mesma recusa sem mudança: `city_exists`,
`too_close_to_edge`, `tile_occupied` e `queue_full`. `turn_in_progress` e `no_turn_job` saem de fatiar um turno à mão.
São os 30 códigos documentados.

### O oráculo

[`tests/civ-lite-game-oracle.mjs`](https://github.com/journey-studios/godot-fabric/blob/4b86a7bd0c9f4880a2241369e944380a4ef7b32c/tests/civ-lite-game-oracle.mjs)
julga as observações brutas e não lê nenhum veredito do probe. Prova que cada serialização é canônica (chaves
ordenadas, só inteiros e strings ASCII) e recalcula o SHA-256 dela. Reimplementa o PCG32 em `BigInt`: confere as saídas
publicadas e que o estado do gerador é o que o PCG32 alcança depois dos sorteios que o jogo contou, e regenera o mapa
a partir da semente. Reescreve as regras em Node: justifica cada recusa pelo estado anterior e exige que cada intenção
aceita deixe exatamente o estado que ele calcula, refazendo o fim de cada turno fase a fase (rota da facção, produção,
crescimento, pesquisa, o refresh e a contagem de tarefas e de eventos por fase, no máximo 64 e 128). Confere também os
invariantes de mapa, unidades, cidade única, recursos não negativos, movimento dentro dos pontos, pesquisa em ordem, evento
resolvido uma vez, turno monotônico e log.

## Regressões

Rodadas no mesmo commit, depois dos comandos acima; todas com saída 0.

| Comando | Resultado | Tempo |
| --- | --- | ---: |
| `npm run type-check` | sem diagnósticos | 0,6 s |
| `npm run check:static` | `✓ No issues found` | 0,5 s |
| `npm run check:publication` | `passed: true`, 1512 arquivos, nenhuma falha | 0,7 s |
| `npm run test:contracts` | inventário de paridade 8113 contratos e 97 valores públicos; subtestes 7/7 (paridade), 43/43 (dashboard) e 303/303; Python 13 testes `OK` | 78,9 s |
| `npm run test:examples` | os 35 exemplos, todos com `acceptance checks passed (headless)` | 217,0 s |

## Recibo de fonte

Os 18 arquivos que rodaram (os 11 scripts do jogo, o probe, o teste e o oráculo, o script de sabotagem e os dois
auxiliares que ele carrega, e o `package.json`) têm o SHA-256 do conteúdo igual ao do blob de `4b86a7b`, comparado byte a
byte com `git show`. O recibo lista cada SHA-256 e cada blob. **O recibo de fonte não certifica o build hospedado**: ele
prova o GDScript, o teste e o oráculo que rodaram nesta máquina, e o `fabric_godot.dylib` que o projeto raiz carrega ao
abrir foi construído aqui a partir dos fontes nativos da main (`486b3bf6…`) e nenhum check o exercita.

> **CI hospedada e Pages pendentes.** O passo `npm run test:civ-lite-game` e o artefato `native-civ-lite-game` do workflow
> `contracts.yml` ainda não rodaram na CI hospedada, e nada foi publicado no Pages. Tudo o que esta página registra é
> evidência local, em macOS arm64. Este registro cobre o critério `replay` do V05-03; os critérios `servicos`, `consumidor` e
> `autoridade`, os demais itens do 0.5 e todo número da 1.0 seguem como estavam.

## Limites e abertos

- O hash dourado fixa onde o replay termina e o hash de trilha, como ele chegou lá. Os dois mudam com qualquer regra, com o
  mapa ou com o roteiro, e então o valor novo é revisado, não aceito.
- Os números (custos, rendimentos, limiares) servem para que 12 turnos exercitem todas as regras; o jogo não está balanceado.
- Não há serviço, sinal, HUD, espelho em TypeScript, exportação nem dispositivo: o snapshot é um contrato escrito e
  conferido em GDScript, ainda não consumido por ninguém. Os argumentos das intenções são tipados e um tipo errado é erro de
  quem chama, não uma recusa; os serviços precisam converter o que o React manda.
- O tempo não é medido: as fases reportam tarefas e eventos, e a medição do orçamento de quadro é um pacote posterior.
- Um `project.godot` em `consumers/civ-lite/` esconderia o jogo do projeto raiz, como acontece com `consumers/minimal`; o
  teste teria de mudar junto. Os scripts usam `preload` relativo e funcionam também como `res://game/`.
- O controle com host anterior não se aplica, e não há captura: o jogo jogável com HUD é do V05-05 e do V05-08.
