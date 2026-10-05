# View hover: interesse nativo para `pointerover/out/enter/leave` imperativos

Esta fatia faz listeners imperativos de hover (`pointerover`, `pointerout`,
`pointerenter`, `pointerleave`) de Views originais do RN qualificarem os eventos de
hover nativos, com mouse e toque, sem helper JSX. A cena é a mesma de duas roots numa aplicação Hermes
dos probes de View; o bundle isolado habilita as duas flags originais do
EventTarget e o dispatcher experimental, e os defaults públicos continuam off. O
[recibo](report.json) fixa fontes, hashes e resultados.

| Lane executada | Checks | Observação |
| --- | ---: | --- |
| Host anterior `ab0b783d`, bundle atual do SDK | 105/137 | Exatamente 32 falhas normativas; nenhuma consulta de hover entra no SDK; a fase de faults não roda |
| Host corrigido, headless | 158/158 | 137 checks da aplicação saudável e 21 da aplicação de faults de hover |

O host anterior é o da [fatia de Move](../pointer-move/README.md). As duas lanes
executam o mesmo bundle, com as mesmas fontes de teste e SDK e os mesmos pins do RN.
Os dois produtores nativos são evidenciados pelos registros de build, que diferem só
no hash do host, nesses dois produtores e na árvore gerada do overlay.

```sh
npm run test:pointers:hover
```

## A correção

No RN 0.87.1, o `PointerEventsProcessor` acompanha o hover por ponteiro e, a cada
mudança de alvo, aplica dois filtros por ViewProps:

- **`out`/`over`:** vão para o alvo anterior/atual quando algum nó do caminho
  declara `PointerOut(Capture)` ou `PointerOver(Capture)`.
- **`leave`/`enter`:** vão para cada nó que sai/entra quando o próprio nó declara
  `PointerLeave`/`PointerEnter`, ou quando ele ou um ancestral que também sai/entra
  declara a variante capture. A saída vai do alvo para a raiz; a entrada, da raiz
  para o alvo.

Listeners imperativos não marcam esses bits. Esta fatia acrescenta a consulta aos
Maps originais nos mesmos pontos, sem trocar o algoritmo:

1. o [overlay do EventTarget](../../../sdk/toolchain/rn-pointer-interest-overlay.mjs)
   exporta consultas para `pointerenter`, `pointerleave`, `pointerover` e
   `pointerout`;
2. o [plugin do SDK](../../../sdk/toolchain/platform-plugin.mjs) mapeia os offsets
   originais `PointerEnter=0`, `PointerEnterCapture=23`, `PointerLeave=2`,
   `PointerLeaveCapture=24`, `PointerOver=26`, `PointerOverCapture=28`,
   `PointerOut=27` e `PointerOutCapture=29`. Na raiz, `pointerenter`/`pointerleave`
   não borbulham: o bubble do Document nunca qualifica esses dois, só o capture
   dele e o próprio documentElement;
3. o [callback nativo](../../../native/application_runtime.cpp) aceita esses offsets.
   Lookups de hover, como os de Move, rodam fora do início e fim de um gesto, então
   usam a mesma política de diagnóstico limitada: cada causa distinta é retida uma
   vez, até 16 por aplicação, e as repetições são contadas;
4. o [overlay gerado](../../../scripts/rn-pointer-overlay.mjs) adiciona a consulta de
   caminho aos testes de `out`/`over` e uma consulta por nó (própria e capture) aos
   laços de `leave`/`enter`, sempre como OR depois da checagem original por ViewProps.

Click e as notificações de captura continuam só por ViewProps.

## O que foi verificado

Um mouse sem botão vai da área vazia da superfície até o alvo azul de A, anda
dentro dele e volta à área vazia. Neste host a área vazia não tem alvo de hit,
então o caminho inteiro entra e sai em cada transição. Para cada colocação de
listener:

| Caso | Ao entrar | Ao sair |
| --- | --- | --- |
| alvo, bubble | over (fase 2), enter (fase 2) | out (2), leave (2) |
| alvo, capture | over (2), enter (2) | out (2), leave (2) |
| pai, bubble | over borbulhando no pai (3), enter do próprio pai (2) | out no pai (3), leave do próprio pai (2) |
| pai, capture | over capturado (1), enter do pai (2), enter do alvo capturado no pai (1) | out (1), leave do alvo (1), leave do pai (2) |

- **Ordem e callbacks.** A ordem é a do RN: `out` antes de `leave` e `over` antes de
  `enter`. Os callbacks são trusted, com `pointerType` mouse e `buttons=0`, na
  prioridade Discrete que o RN usa para hover. Cada evento despachado tem o seu par
  Raw typed/star com o payload do callback.
- **Consultas.** O check exige a sequência inteira de lookups: o caminho de
  `out`/`over` (para no primeiro nó qualificado) e, nos laços de `leave`/`enter`, o
  capture e depois o próprio offset de cada nó, com o curto-circuito exato do RN
  quando um ancestral capture já qualifica.
- **Mover-se dentro do alvo** não gera hover; o mesmo movimento só lê pares de Move
  `false`.
- **Controles manuais.** Um `dispatchEvent` público em cada tipo prova a instalação
  e as regras originais de propagação: `over`/`out` borbulham até o pai, e
  `enter`/`leave` não (um listener bubble no pai não recebe).
- **Toque.** Um toque é um ponteiro direto, sem hover próprio: o RN entra no caminho
  dele no Down, antes da emissão do Down, e sai depois da emissão do Up, porque o
  toque solto deixa o dispositivo. Com os listeners bubble no alvo, o Down entrega
  `over` e `enter` (fase 2, `pointerType` touch, `buttons=1`) antes do TouchStart, e
  o Up entrega `out` e `leave` (`buttons=0`) antes do TouchEnd, com as mesmas
  consultas de hover do mouse. Os lookups de Down vêm depois da entrada e os de Up
  antes da saída, todos `false`, e o processador mantém o caminho de hover só
  enquanto o toque está pressionado.
- **B, sem listeners,** lê todos os nós com instância pública, sempre `false`, e
  nada roda. O container do AppRegistry de B nunca despachou evento, então o RN
  ainda não criou a instância pública dele. A consulta pula esse nó sem criá-lo, e
  o check confirma que o nó nativo existe.

## Falhas na consulta de hover

Uma segunda aplicação arma um throw repetido no lookup de `over` do alvo de A
(offset 26). Em cada entrada, o lookup falho é rejeitado sozinho: o resto do
caminho é lido e dá `false`, nenhum `over` é despachado, e o `enter` qualifica
pelos próprios lookups. A primeira falha deixa um `E_POINTER_LISTENER_QUERY`; a
repetição só é contada em `pointerListenerQuerySuppressed`. Depois disso o fault
acaba, e a entrada seguinte entrega `over` e `enter` normalmente. A aplicação para
com exatamente esse diagnóstico e uma falha contada.

## Lookups de hover nos probes anteriores

O rastreador de hover do RN roda antes de cada emissão de Down e Move e, para um
toque, de novo depois do Up ou do Cancel. Com esta fatia, esses gestos consultam os
Maps de hover em todos os probes de ponteiro. Os probes de Down, Up, Move, faults e
Document passam a guardar essas linhas em `query.hoverRows`, separadas das da
categoria que cada check certifica. Nenhum desses fixtures registra listener de
hover, então um check final em cada probe exige que todo lookup de hover observado
seja um delegate saudável `false`.

O fault do resolver no Down (um getter em `canonical.publicInstance` do alvo) seria
consumido pelo lookup de `over`, que agora vem antes. Ele passa a deixar passar as
quatro leituras de hover do alvo (26, 28, 23 e 0, contadas num gesto saudável
idêntico) e continua falhando a leitura do próprio lookup de Down. O oráculo
independente exige essas quatro leituras no host novo e nenhuma no anterior.

## Controle com o host anterior

O host da fatia de Move foi preservado e roda o mesmo bundle com
`--allow-original-negative`, sem a fase de faults. Ele falha exatamente as 32
checagens normativas: entrega, Raw e consultas de cada entrada e saída dos quatro
casos de mouse e das duas fases do toque, mais as consultas de B. Nenhum lookup de
hover chega ao SDK. Os controles manuais, os movimentos internos, os lookups do
próprio toque e a limpeza passam.

O fixture, o bootstrap e os probes compartilhados mudaram, então os controles de
View Up, query-fault, resolver-fault e Move foram refeitos com os bundles novos nos
seus hosts preservados e continuam com 8, 12, 3 e 45 falhas normativas.

## Regressões

No host corrigido passaram os três gates do job `contracts` (258 testes Node e 13
Python, análise estática e scan de publicação), o `test:recovery` (que não roda na
CI) e as 23 suítes nativas: 22 exemplos, Down 2.731 nas oito lanes, query faults
187, resolver faults 66, Document Up 6.459, View Up 297, Move 220, Document Move
1.940, o próprio hover 158 e `parity:godot`. Os totais dos probes anteriores
incluem o check final de lookups de hover, um por processo. Também passaram o
codegen nativo, o SDK nativo (pack/verify), os adapters (loader com 89 checks e 21
casos, runtime com 13 execuções e 213 checks), o consumidor (30 + 40) e o cold
start.

## Limites

A prova cobre listeners de hover em Views, com as duas flags habilitadas, com mouse
e toque.
Algumas partes ficam habilitadas sem certificação:
- Pelo caminho da raiz, listeners de hover em Document/documentElement agora
  qualificam (com a regra de não borbulhar para `enter`/`leave`), mas não foram
  testados nativamente; só os testes unitários do plugin cobrem essa regra.
- Neste host, a área vazia da superfície não tem alvo de hit, enquanto o RN resolve o
  alvo para a view raiz (o `TouchTargetHelper` no Android e o `hitTest` da
  `RCTRootComponentView` no iOS). No RN 0.87.1 a família raiz nasce sem dispatcher
  de eventos e com o `EventTarget` sem instance handle, então nenhum evento com alvo
  na raiz chega ao JS: listeners de Document não recebem toques, moves nem hover
  sobre a área vazia em nenhum dos dois. A diferença observável é o caminho de
  hover: aqui a raiz sai dele a cada transição para a área vazia, enquanto o
  processador C++ do RN a mantém. Com um listener capture de `pointerenter` ou
  `pointerleave` no Document, essa saída propaga `leave` (e a volta propaga `enter`)
  para cada nó do caminho, o que o RN não faz enquanto o ponteiro segue na raiz.
  Isso é anterior a esta fatia e entra na certificação de hover em Document.

  (Correção: a versão anterior deste item dizia que, no RN, listeners de Document
  receberiam eventos sobre a área vazia. Eles não recebem.)

Com toque, só a colocação no alvo (bubble) foi exercitada; as outras usam o mesmo
algoritmo e as mesmas consultas certificadas com mouse. Hover com caneta, captura de
ponteiro durante hover, retirada de root com hover ativo, responders, hardware,
exports mobile e performance seguem abertos.

A CI desta fatia ainda será executada. Nenhum GF, checkpoint, dependência, peso ou
denominador foi fechado.

As 76 fontes de código/configuração executadas (18 produtoras do bundle,
55 entradas do build nativo e 5 de verificação, com sobreposição)
correspondem à implementação `5560798bbf28c962735b5ec80791f707272d1ac2` por `git show`/SHA-256. A execução partiu de
f868160, o head da fatia de Document Move, com as mudanças desta fatia ainda locais;
o squash dela na `main` (a6af188) só difere em documentação e no dashboard. Este pin
pós-commit não é uma nova corrida.
