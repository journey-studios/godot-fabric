# O custo de mudança: Irrigar nos braços B e C (V05-10, `mudanca`)

Registro do critério `mudanca` do V05-10. O mesmo pedido foi implementado nos dois braços do comparativo final:
- **B:** a HUD nativa do Godot;
- **C:** a HUD React Native.

Pelo protocolo, cada braço tem uma única implementação, e o registro conta arquivos, linhas, tempo e testes de cada uma. O experimento foi
[pré-registrado](../../research/frontier-change-cost.md) antes de qualquer linha de código, no #124 (`6c7e8ba`). A nota fixou:
- o pedido;
- a base comum, que nenhum braço paga;
- o que conta para cada braço;
- que o código fica fora da `main`.

**Esta é uma observação por braço: serve para descrever, não para uma afirmação estatística.**

## O pedido e a base

O pedido é **Irrigar**:
- **No jogo:** um Settler irriga a Planície em que está, quando ela tem Água num dos quatro vizinhos e ainda não foi irrigada. A ação gasta os movimentos que restam ao Settler, e a casa passa a render um alimento a mais.
- **Na HUD:** o painel de ações lista a ação com o ícone de irrigação, e o cartão do tile irrigado mostra o ícone e a palavra "Irrigated" na linha das unidades.

A base comum está na branch `exp/change-cost-base` (`2f52c6b`), a partir de `6c7e8ba`, e o [seu registro](base.md) detalha cada parte:
- a regra do jogo e o registro do serviço (19 vínculos);
- o ícone `irrigation.png`;
- um estágio novo na lane da HUD, compartilhada pelo leitor das sondas.

A base deixou a lane vermelha nos dois braços, e só pelo estágio novo:
- **no braço B,** 3 checks: o ícone da ação, o ícone do cartão e a linha das unidades;
- **no braço C,** os mesmos 3 e mais o do clique. O store da HUD React Native despacha as ações por um `switch` tipado e respondia "The HUD does not know the action irrigate", enquanto a HUD nativa despacha pelo nome do método.

O [patch da base](base.patch) tem 38 arquivos, +928/−85.

## As duas implementações

Cada braço foi implementado por um **subagente novo**, a partir da cabeça da base. Os dois receberam o mesmo texto do pedido e a mesma lane como critério, e nenhum viu a branch do outro. O B rodou primeiro e o C depois; a ordem foi fixada, não sorteada.

| Braço | Branch e commit | Arquivos | Linhas | Tempo ativo | Testes próprios |
| --- | --- | ---: | ---: | ---: | ---: |
| B (nativa) | `exp/change-cost-b` `387ff71` ([patch](arm-b.patch)) | 3 | 20 (+14/−6) | 2,9 min | 0 |
| C (React Native) | `exp/change-cost-c` `a43dc24` ([patch](arm-c.patch)) | 4 | 24 (+17/−7) | 5,7 min | 0 |

**O que cada braço mudou:**
- **B:** `native_hud/icons.gd` (o ícone na tabela), `native_hud/actions.gd` (o ícone da ação) e `native_hud/tile.gd` (o ícone e "Irrigated" no cartão).
- **C:** `ui/hud/icons.ts` (o import e a tabela), `ui/hud/actions.tsx` (o ícone da ação), `ui/hud/tile.tsx` (o ícone e "Irrigated") e `ui/store.ts` (um `case "irrigate"` no despacho das ações).

**A lane depois.** O orquestrador rodou de novo a lane de cada braço na branch dele, e as duas passaram:
- B: `CIVLITE_UI_NATIVE_PASSED: 161 + 28 probe checks on the native HUD; 49 + 23 oracle mutations`;
- C: `CIVLITE_UI_LANE_PASSED: 161 + 28 + 41 probe checks; 49 + 23 + 38 oracle mutations and 23 of the scan`.

O tempo ativo é o da regra da emenda de 2026-10-09: a soma dos intervalos menores que 30 minutos entre eventos consecutivos da transcrição de cada subagente, do primeiro evento à devolução. Foram medidos sobre as transcrições:
- **B:** de 14:06:33 a 14:09:27 UTC.
- **C:** de 14:10:06 a 14:15:51 UTC.

## A regra de uma observação

Pela regra do protocolo (`decisionRule.singleObservation`), a categoria de cada medida sai da diferença C − B contra 10% do valor de B, e o eixo só recebe uma categoria quando as quatro medidas concordam:

| Medida | B | C | C − B | Margem | Categoria |
| --- | ---: | ---: | ---: | ---: | --- |
| Arquivos | 3 | 4 | +1 | 0,3 | custo |
| Linhas | 20 | 24 | +4 | 2,0 | custo |
| Tempo (h) | 0,048 | 0,096 | +0,048 | 0,0048 | custo |
| Testes | 0 | 0 | 0 | 0 | neutro |

**O eixo é inconclusivo:** três medidas dizem custo para o C, e a de testes diz neutro.

## O que limita a leitura

- **A ordem.** Foi fixa (B antes de C), e com uma observação por braço ela não é balanceada.
- **O tempo inclui a lane, e a lane pesa diferente em cada branch.** O arquivo da lane roda os dois braços. Em cada branch, o braço que continua vermelho é o outro, e ele falha num ponto diferente: a lane levou cerca de 114 s na branch do B e 276 s na do C. Sem a lane, os dois braços levaram cerca de 1,0 e 1,1 minuto. A maior parte da diferença de tempo é a lane, não o trabalho.
- **O pedido é pequeno e chega pronto do lado do jogo.** A base já trazia a regra, o ícone e a expectativa da lane, então cada braço fez só a parte da HUD. Um pedido pequeno diz pouco sobre pedidos grandes.
- **Uma diferença de estrutura é real e apareceu.** A HUD nativa despacha uma ação pelo nome do método. O store da HUD React Native despacha por um `switch` tipado, que dá segurança de tipo a cada ação e cobra uma linha por ação nova. Daí o arquivo a mais do C.
- **Uma divergência que a lane não cobre.** Num tile irrigado e sem unidades, o braço B mostra só "Irrigated" na linha das unidades, e o braço C mostra
  "No units · Irrigated". O pedido diz "a palavra 'Irrigated' na linha das unidades" e não fixa o caso sem unidades, e o estágio da lane só passa por um tile
  com unidades, então as duas leituras passam. Os patches ficam como foram entregues, porque são o registro do experimento; a diferença fica registrada
  aqui, e o achado é do pedido (uma especificação que deixou um caso aberto), não de um braço.

## Fora da `main`

As três branches (`exp/change-cost-base`, `exp/change-cost-b` e `exp/change-cost-c`) ficam no remoto e não entram na `main`. A campanha da `execucao` mede o jogo da `main`: o replay de 77 intents com o seu hash dourado e os limiares congelados pelo V05-06. A base, além de trazer a ação nova, muda o hash dourado e o de trace (o estado ganha a lista `irrigated`). Entram na `main` só este registro, os patches e o [`report.json`](report.json).
