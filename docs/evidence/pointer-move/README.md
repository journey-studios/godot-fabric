# View pointermove: interesse nativo para listeners imperativos originais

Esta fatia faz listeners imperativos `pointermove` de uma View original do RN
qualificarem a emissão nativa de moves reais, sem helper JSX. A cena é a mesma de
duas roots numa aplicação Hermes dos probes de View; o bundle isolado habilita as
duas flags originais do EventTarget e o dispatcher experimental, e os defaults
públicos continuam off. O [recibo](report.json) fixa fontes, hashes e resultados.

| Lane executada | Checks | Observação |
| --- | ---: | --- |
| Host anterior `d8553d9`, bundle atual do SDK | 90/135 | Exatamente 45 falhas normativas; nenhuma consulta de Move entra no SDK, TouchMove e limpeza saudáveis; a fase de faults não roda |
| Host corrigido, headless | 219/219 | 135 checks da aplicação saudável e 84 da aplicação de faults de Move |
| Host corrigido, viewport macOS | 243/243 | Os mesmos 219 checks, 20 pixels reais, dois contadores e dois saves/dimensões |

As três lanes executam o mesmo bundle (`2a76a0e3…`), com as mesmas 15 fontes
produtoras de teste e SDK e os mesmos 19 pins originais do RN. Os outros dois
produtores, `native/application_runtime.cpp` e `scripts/rn-pointer-overlay.mjs`,
são compilados no host, então o pin deles no bundle não diz nada sobre o host
anterior. A prova causal desses dois é o diff dos registros de build nativo: os
dois hosts diferem em 5 das 6.708 entradas, que são o hash do host, esses dois
produtores e a árvore gerada `react-native-pointer-overlay` (manifesto e um
arquivo).

```sh
npm run test:pointers:move
node tests/pointer-move-native.test.mjs --capture
```

## A correção

No RN 0.87.1, o `PointerEventsProcessor` só emite `topPointerMove` quando algum
nó do caminho do alvo até a raiz declara `PointerMove` ou `PointerMoveCapture` nos
ViewProps (`shouldEmitPointerEvent`). Um listener imperativo não marca esses bits,
então o move era filtrado antes do dispatcher JS. O Godot já estendia essa checagem
para Down e Up, consultando os Maps originais do EventTarget; esta fatia acrescenta
Move nos mesmos quatro pontos:

1. o [overlay do EventTarget](../../../sdk/toolchain/rn-pointer-interest-overlay.mjs)
   exporta `hasPointerMoveListenerForGodot`, que lê só registros `pointermove`
   não removidos, sem invocar listeners;
2. o [plugin do SDK](../../../sdk/toolchain/platform-plugin.mjs) mapeia os offsets
   originais `PointerMove=1` (bubble) e `PointerMoveCapture=25` (capture), que não
   são adjacentes, então a tabela explícita é necessária;
3. o [callback nativo](../../../native/application_runtime.cpp) aceita esses dois
   offsets, com a mesma resolução de ref, validação booleana e fronteira de
   diagnóstico de Down/Up;
4. o [overlay gerado](../../../scripts/rn-pointer-overlay.mjs) do
   `PointerEventsProcessor` consulta `{PointerMove, PointerMoveCapture}` para
   `topPointerMove` quando os ViewProps não qualificam. A consulta entra como OR
   depois da checagem original, então moves já qualificados por prop JSX não
   chegam ao JS por esse caminho.

O rastreamento de hover, o click e as notificações de captura continuam só por
ViewProps:
os testes unitários confirmam que os offsets 0, 2, 23, 24 e 26 a 33 retornam
`false` sem resolver o candidato.

## O que foi verificado

Duas amostras de `InputEventScreenDrag` por caso de toque, cada uma assentada
antes da próxima:

| Caso | Listener | Consultas por amostra | Callback |
| --- | --- | --- | --- |
| bubble | `pointermove` na View alvo | `alvo 1=true` | fase 2 |
| capture-only | `pointermove` com capture na View alvo | `alvo 1=false, 25=true` | fase 2 |
| ancestor-bubble | `pointermove` na View pai | `alvo 1/25=false`, `pai 1=true` | fase 3, `currentTarget` = pai |
| ancestor-capture | `pointermove` com capture na View pai | `alvo 1/25=false`, `pai 1=false, 25=true` | fase 1, `currentTarget` = pai |
| B sem listeners | nenhum | B, pai, container do AppRegistry e handle da raiz, cada um `1` e `25`, todos `false`, nessa ordem | nenhum |

**Instalação e Down.** Antes de qualquer input, um `dispatchEvent` público entrega
um callback untrusted na fase esperada, sem Raw nem incremento, o que prova o
listener instalado independentemente do nativo. O Down real não tem listener:
consulta 34/35 `false`, emite só o TouchStart original e mantém o contato.

**Cada move de toque.** O callback é `pointermove` trusted, `pointerType` touch,
`buttons=1` e `pointerId` positivo, na fase e no `currentTarget` da tabela. O par
Raw typed/star de `topPointerMove` aparece uma vez por canal com o payload,
timestamp e pointerId do callback, e o TouchMove original também chega uma vez por
canal. Cada move faz um incremento funcional e um commit nativo. As consultas
seguem a ordem exata da tabela; no caso de B, o check agora exige a cadeia
inteira, com o handle da raiz marcado como tal, e não só o par da própria View.

**Mouse.** Três casos sem botão e sem contato ativo, na View alvo com listener
bubble. Um hover simples entrega um callback `pointerType` mouse, `buttons=0`, com
o ponto local exato da amostra. Duas amostras no mesmo frame com o acúmulo de input
do Godot ligado (o padrão) chegam ao host como um único movimento e entregam um
callback no último ponto. Com o acúmulo desligado, as duas amostras são despachadas
em ordem, cada uma com seu ponto e seu commit.

**Prioridade e enfileiramento.** Como o `TouchEventEmitter::onPointerMove` do RN, o
host enfileira moves que acertam uma View com `dispatchUniqueEvent`, de categoria
Continuous. Com `fixMappingOfEventPrioritiesBetweenFabricAndReact` desligado, como
no pin, o `EventQueueProcessor` mapeia Continuous para Default. Nos casos de mouse
não há ContinuousStart pendente, então um move `Unspecified` comum rodaria em
Discrete: o Default observado distingue a categoria. Já o coalescing de moves
únicos do RN não é alcançável neste host. `ApplicationRuntime::input` faz o flush
da fila síncronamente depois de cada evento de entrada, então nunca há um move
pendente para substituir. A fusão por frame vem do acúmulo do Godot.

**Release, Cancel e stop.** O release consulta só 36/37 `false`, não reentrega
move e limpa contato, processador, captura, hover e rotas. O Cancel real de A, com
listener de Move registrado, não invoca o listener. Esse check não discrimina o
interesse de Move, porque o RN emite todo Cancel independentemente de listeners; ele
guarda a limpeza. O stop termina sem diagnósticos, com roots, Controls, contatos e
hover balanceados e contadores finais A=12/B=0.

## Falhas na consulta de Move

Lookups de Down e Up rodam uma vez por gesto e reportam toda falha, como as fatias
de faults certificaram. Lookups de Move rodam a cada amostra, hover incluído, e
reportar cada falha encheria a lista de erros sem limite. O host agora retém cada
causa distinta de falha de Move uma única vez como `E_POINTER_LISTENER_QUERY`, até
16 causas distintas por aplicação. Repetições e causas além desse limite são só
contadas em `pointerListenerQuerySuppressed`. O lookup que falhou continua
retornando `false`, então o resto do caminho decide a entrega.

Uma segunda aplicação, iniciada depois do stop da saudável, exercita isso com
faults injetados no próprio lookup de Move da View A:

| Caso | Fault | Amostras | Diagnósticos | Contadas | Entrega |
| --- | --- | --- | --- | --- | --- |
| repeat-throw1 | throw no lookup bubble (1), listener bubble | 3 com fault, 1 de recuperação | 1 | 2 | só na recuperação |
| repeat-nonboolean25 | resultado não booleano no lookup capture (25), listener capture-only | 2 com fault, 1 de recuperação | 1 | 1 | só na recuperação |
| distinct-cap | 15 causas distintas seguidas no lookup bubble | 15 | 14 | 1 | nenhuma |

Em cada amostra com fault, o lookup falho é rejeitado sozinho: o outro lookup da
View, o pai, o container do AppRegistry e o handle da raiz são consultados e
retornam `false`, e o TouchMove original segue. Depois do terceiro caso a aplicação
tem 16 causas retidas, então a décima quinta causa distinta só é contada. Um move de
B continua saudável no fim, e o stop retém exatamente os 16 diagnósticos, na
ordem, com 4 falhas contadas. O log do engine traz uma linha
`FABRIC_ERROR` por diagnóstico retido e nenhuma outra.

## Controle com o host anterior

O host da `main` antes da correção foi preservado e roda o mesmo bundle com
`--allow-original-negative`, sem a fase de faults, que depende de lookups de Move.
Ele falha exatamente as 45 checagens normativas
esperadas: as quatro de cada uma das oito amostras de toque, a cadeia de consultas
de B e as quatro de cada caso de mouse. Nenhuma linha de consulta de Move chega ao
SDK, não há `topPointerMove`, e contadores e commits ficam parados. TouchMove, Down,
Up, Cancel e limpeza passam. Qualquer falha a mais ou a menos invalidaria o controle.

O bootstrap e o fixture compartilhados mudaram, então os controles de View Up,
query-fault e resolver-fault foram refeitos com os bundles novos nos seus hosts
preservados; eles reproduzem 8, 12 e 3 falhas normativas.

## Quadros nativos

![Duas roots nativas antes de qualquer move](initial.png)

O azul é o alvo nativo. A barra laranja segue o contador React de moves: começa em
x=160 e tem 20 px mais 4 px por move entregue. A amarela segue o TouchStart. No
início, A=0 e B=0.

![A recebe dois moves; B continua em zero](updated.png)

Depois do caso bubble, A tem dois moves e B zero. Em cada root, o último pixel
laranja (x=179+4·moves) e o primeiro pixel de fundo logo depois (x=180+4·moves)
fixam a contagem exata. Cada quadro de 680×160 é uma leitura real do Viewport com
10 pixels fixos e contadores React conferidos; o oráculo decodifica o PNG salvo de
forma independente.

## Ajustes de base

O decodificador de PNG nativo, duplicado nos oráculos de View Up e Document Up,
virou [`tests/native-png.mjs`](../../../tests/native-png.mjs) e é usado também pelo
Move; ele entra na lista de fontes pinadas desses bundles. O fixture compartilhado
ganhou uma ref na View pai, um contador de moves opcional (`probePointerMove`), o
tipo `pointermove` e os Raw `topPointerMove`/`topTouchMove`; o observador da
consulta marca `rootHandle` e aceita faults nos offsets de Move, repetidos em até
quatro lookups. Os outros probes não passam a prop nem leem esses campos, e os
faults de Down/Up continuam de um lookup só.

## Regressões

No host corrigido passaram os três gates do job `contracts` da CI (contracts com
257 Node/13 Python, análise estática e varredura de publicação), o `test:recovery`
(que não roda na CI) e as 21 suítes do job nativo: os 22 exemplos, guards de
transform, runtime, aplicação, módulos, foco, processador, geometria, os quatro
probes de eventos, serviços, interesse de Down (233), Document Down (2.723 nas oito
lanes), query faults (186), resolver faults (65), Document Up (6.451), View Up
(296), o próprio Move (219) e o `parity:godot`. Como o binário mudou, também
passaram o teste afim, o codegen nativo, o pack/verify de um SDK nativo novo, o
registro de adapters, o loader (89 checks/21 casos), o runtime de adapters (13
execuções/213 checks), o consumidor (30 checks de build/ownership e 40 nativos) e o
cold start. Todas as execuções conferem o mesmo host `ab0b783d…` antes e depois.

## Limites

A prova cobre listeners `pointermove` em Views, com as duas flags habilitadas, em
toque e em mouse sem botão. Esta fatia também habilita comportamento que ela não
certifica:

- O caminho do root passa a responder aos offsets 1/25. Um listener `pointermove`
  em `document` ou `documentElement` agora qualifica qualquer move da superfície,
  mas Document/documentElement e a matriz de flags não foram testados aqui.
- Os eventos de hover (over/out/enter/leave) continuam filtrados por ViewProps.
- O limite de diagnósticos vale por aplicação e só para Move. Faults no resolver
  da ref (getter) durante lookups de Move passam pelo mesmo caminho, mas não
  foram exercitados, e Document/documentElement Move não tem faults aqui.
- Quando nenhum prop qualifica, cada move faz duas chamadas JSI por nó do caminho,
  e cada uma resolve o clone mais novo do nó. O custo é proporcional ao quadrado da
  profundidade por move e não foi medido.
- Moves sem View atingida, inclusive os capturados, entram na fila como eventos
  `Unspecified` não únicos e rodam em Discrete sem ContinuousStart pendente. Isso
  diverge do RN e é anterior a esta fatia.
- Captura de ponteiro, moves capturados ou sem hit, `pointerrawupdate`,
  responders/PanResponder, multi-toque, a prioridade com o mapeamento corrigido,
  hardware, exports mobile e performance seguem abertos.

A [CI hospedada](hosted-ci.json) desta fatia passou nos cinco jobs no run
37345287351, no head 4ca3f1f (checkout de merge 9cf35fd). O artefato
`native-pointer-move` repete os **219 checks headless** com IDs, bundle e estágios
idênticos aos locais, incluindo os 51 estágios `fault/*`; além de timestamps, da
versão patch do Node e do hash do host do runner, só os identificadores de
alocação do Godot da segunda aplicação diferem, aceitos apenas como renomeação
um-para-um (516). O log retém exatamente os 16 diagnósticos esperados, e as 77
entradas rastreadas batem com f9f9817 na árvore do checkout. A captura e os
controles de host anterior continuam locais. O [Pages](publication.json) (run
37349051758, push da `main` em d75ea51) implantou exatamente os dados commitados, e o
JSON público e a API local conferem com eles. Nenhum GF, checkpoint, dependência,
peso ou denominador foi fechado.

As 77 fontes de código/configuração executadas (17 produtoras do bundle, 55 entradas
do build nativo e 7 de verificação, com sobreposição) correspondem à implementação
`f9f9817e47e20ef7e4e6b44bfed764bb6cc087ad` por `git show`/SHA-256. O recibo preserva a base
a0ec86b e a árvore dirty da execução; este pin pós-commit não é uma nova corrida.
