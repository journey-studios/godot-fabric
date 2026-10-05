# Caminho da raiz: a raiz fica no hover sem nunca ser alvo

Esta fatia faz um ponto vazio dentro de uma superfície resolver para a view raiz,
como no RN, e garante que a raiz nunca seja alvo de evento. Isso também elimina um
crash: no host anterior, um listener capture de `pointerenter`/`pointerleave` no
Document derrubava o processo (SIGSEGV) assim que o ponteiro entrava na superfície.
A cena é a de duas roots numa aplicação Hermes dos probes de View; o bundle isolado
habilita as duas flags originais do EventTarget e o dispatcher experimental, e os
defaults públicos continuam off. O [recibo](report.json) fixa fontes, hashes e
resultados.

| Lane executada | Checks | Observação |
| --- | ---: | --- |
| Host anterior `6fe21917`, só o caso de View | 36/45 | Exatamente 9 falhas normativas de lookups e caminho de hover |
| Host anterior `6fe21917`, só o caso de Document | — | O processo cai no primeiro passo (sinal 11 em `UIManagerBinding::dispatchEventToJS`), antes de qualquer check |
| Host corrigido, headless | 82/82 | Mouse e toque, listeners na View e capture no Document |

O host anterior é o da [fatia de hover](../pointer-hover/README.md). As lanes
executam o mesmo bundle, com as mesmas fontes de teste e SDK e os mesmos pins do
RN; os produtores nativos são evidenciados pelos registros de build.

```sh
npm run test:pointers:root-path
```

## O que o RN faz

O RN resolve um ponto vazio dentro da view raiz para a própria raiz: o
`TouchTargetHelper` do Android parte do id da raiz e a busca de pointer events
devolve a raiz, e no iOS o `hitTest` da `RCTRootComponentView` devolve ela mesma.
No processador C++ fixado, a raiz vira o alvo de hover e fica no caminho enquanto o
ponteiro estiver dentro dela; só um ponto fora da raiz sai do caminho inteiro.

Nenhum evento com alvo na raiz chega ao JS: o `ShadowTree` cria a família raiz com
dispatcher de eventos nulo e sem instance handle, então o `EventTarget` dela nunca
é habilitado. E o RN nunca qualifica a raiz como alvo, porque `RootProps` não
declara listener de ponteiro.

## O que este host fazia

O host passava alvo nulo para o ponto vazio, então a raiz saía do caminho de hover
a cada transição entre uma View e a área vazia da mesma superfície. Com listeners
imperativos isso aparecia de dois jeitos:

- Um listener capture de `pointerenter`/`pointerleave` no Document qualifica o
  lookup capture da raiz. Sair e voltar da raiz propagava `leave` e `enter` para
  cada nó do caminho a cada transição, quando o RN não emite nada com o ponteiro
  ainda dentro da raiz.
- A fatia de hover deixava a raiz qualificar o próprio `enter`/`leave` pela
  consulta da raiz. O processador despachava para a raiz, e o
  `dispatchEventToJS` do RN dereferenciava o instance handle ausente do
  `EventTarget` dela: o processo caía. Com as flags públicas desligadas, só a
  configuração opt-in ficava exposta.

## A correção

1. O [adaptador de ponteiro](../../../native/pointer_adapter.cpp) informa se um
   ponto vazio está dentro da view raiz, e o
   [payload do Godot](../../../native/pointer_event.h) leva essa marca.
2. O [runtime](../../../native/application_runtime.cpp) resolve uma amostra sem alvo
   JS para o nó raiz atual da superfície, pelo hook novo do binding no
   [overlay gerado](../../../scripts/rn-pointer-overlay.mjs), antes de o
   processador interceptá-la.
3. No overlay, a consulta de caminho devolve `false` para um alvo raiz, os laços
   de `enter`/`leave` nunca emitem para a raiz nem leem o Map próprio dela, e o
   binding descarta qualquer dispatch para uma raiz antes de tocar no `EventTarget`.
   Os lookups capture da raiz continuam propagando `enter`/`leave` para os
   descendentes que entram ou saem junto com ela, como o RN faz com um ancestral
   que entra ou sai.

A seleção de superfície não muda: um clique ou a primeira amostra de hover na área
vazia continuam sem superfície, e o jogo embaixo recebe o input. A raiz entra no
caminho quando uma amostra é roteada para a superfície, por hit numa View ou
porque a superfície ainda é dona da rota do mouse.

Também nesta fatia, as chamadas de validação de `inverse()` em
[`pointer_geometry.cpp`](../../../native/pointer_geometry.cpp), cujo resultado era
descartado, passam por um helper `require_invertible()` com as mesmas garantias e
diagnósticos; o build nativo não tem mais avisos de `nodiscard`.

## O que foi verificado

Um mouse sem botão e um toque andam entre o alvo de A, a área vazia de A e um ponto
fora de qualquer superfície:

- **Listeners na View (bubble).** Ir para a área vazia sai só das Views (`out` e
  `leave` no alvo, sem lookup da raiz) e o processador mantém um caminho de hover;
  só o ponto fora sai da raiz, que lê apenas o Map capture. A raiz também entra e
  sai sozinha em volta da área vazia.
- **Listeners capture no Document.** Entrar de fora entrega `enter` para o
  container, o pai e o alvo em fase 1; sair para fora entrega `leave` para alvo,
  pai e container; ir e voltar da área vazia não entrega nada. Nenhum Raw é
  despachado para a raiz.
- **Toque.** O Down entra no caminho; arrastar para a área vazia mantém a raiz, e
  soltar ali sai só da raiz, sem callback.
- Em todos os passos, a sequência inteira de lookups confere, com curto-circuitos,
  e os lookups de Move só leem o caminho de uma View atingida.

## Controle com o host anterior

O host da fatia de hover foi preservado e roda o mesmo bundle em duas partes. O
caso de View falha exatamente os 9 checks normativos: lookups com os Maps próprios
da raiz e a raiz saindo e entrando a cada transição, além do caminho de hover
vazio sobre a área vazia. O caso de Document cai no primeiro passo, com o frame do
`dispatchEventToJS` chamado pelo `handleIncomingPointerEventOnNode`, antes de
qualquer check.

O fixture e o probe de hover compartilhados mudaram (listeners no Document, casos
de hover saindo e entrando por um ponto fora da superfície e sem os lookups
próprios da raiz), então os controles de View Up, query-fault, resolver-fault,
Move e hover foram refeitos com os bundles novos nos seus hosts preservados e
continuam com 8, 12, 3, 45 e 32 falhas normativas.

## Regressões

No host corrigido passaram os três gates do job `contracts` (260 testes Node e 13
Python, análise estática e scan de publicação), o `test:recovery` (que não roda na
CI) e as 24 suítes nativas: 22 exemplos, Down 2.731 nas oito lanes, query faults
187, resolver faults 66, Document Up 6.459, View Up 297, Move 220, Document Move
1.940, hover 158, o próprio caminho da raiz 82 e `parity:godot`. Também passaram o
codegen nativo, o SDK nativo (pack/verify), os adapters (loader com 89 checks e 21
casos, runtime com 13 execuções e 213 checks), o consumidor (30 + 40) e o cold
start. O teste unitário do overlay trava as regras novas: a raiz fora da consulta
de caminho e das emissões de `enter`/`leave`, o lookup próprio dela nunca lido e o
binding resolvendo e descartando alvos raiz.

## Limites

Hover em Document na matriz de flags e listeners no documentElement, a seleção de
superfície para input na área vazia, hover com caneta, captura durante hover,
responders, hardware, exports mobile e performance seguem abertos.

A CI desta fatia ainda será executada. Nenhum GF, checkpoint, dependência, peso ou
denominador foi fechado.
