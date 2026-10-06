# ActivityIndicator: o módulo original do RN sobre um spinner do Godot

Esta fatia entrega o `ActivityIndicator` público. Antes ele era um placeholder
que lançava erro ao renderizar; agora o facade renderiza o `ActivityIndicator.js`
original do RN 0.87.1, que no Godot segue o caminho não Android: uma View
dimensionada em volta do componente `RCTActivityIndicatorView` gerado pelo
Codegen. O host registra o `ActivityIndicatorViewComponentDescriptor` gerado, o
mesmo que o iOS registra, e desenha o spinner num Control do Godot cuja fase
avança com o tempo real dos frames enquanto `animating`. O [recibo](report.json)
fixa fontes, hashes e resultados.

| Lane executada | Checks | Observação |
| --- | ---: | --- |
| Host anterior `1d26dec2`, mesmo bundle | 4/6 | Exatamente as 2 falhas normativas de montagem: o mount rejeita `ActivityIndicatorView` |
| Sabotagem retida: o spinner nunca recebe trabalho por frame | 24/33 | 9 falhas, e o oráculo independente rejeita o relatório |
| Host atual, headless | 33/33 | Frames reais do SceneTree em duas roots de uma aplicação Hermes |

```sh
npm run test:activity-indicator
```

## O que o RN faz

O `Libraries/Components/ActivityIndicator/ActivityIndicator.js` usa o
`ProgressBarAndroid` no Android e, em qualquer outra plataforma, o componente
Codegen `ActivityIndicatorView` de
`src/private/components/activityindicator/specs/ActivityIndicatorViewNativeComponent.js`
(`paperComponentName: 'RCTActivityIndicatorView'`): props `hidesWhenStopped` e
`animating` (ambas `true` por padrão), `color` e `size` (`'small' | 'large'`,
padrão `'small'`), sem eventos nem comandos. Com `Platform.OS === "godot"` o
módulo original segue esse caminho. Ele envolve o componente nativo numa View
com `alignItems`/`justifyContent: 'center'` e o estilo do chamador, e passa ao
nativo o resto das props, o `ref` e o `testID`.

Os padrões do JS são `animating = true`, `hidesWhenStopped = true`,
`size = 'small'` e `color = Platform.OS === 'ios' ? '#999999' : null`. O `size`
vira o frame nativo: `'small'` dá 20×20 com `size: 'small'`, `'large'` dá 36×36
com `size: 'large'`, e um número dá um quadrado desse lado sem a prop `size`, de
modo que vale o padrão nativo (`small`).

O spec não é `interfaceOnly`, então o `FBReactNativeSpec` gerado no pacote traz o
componente inteiro: `ActivityIndicatorViewProps`, o
`ActivityIndicatorViewShadowNode` sem medida (o nome vem do `ShadowNodes.cpp`) e o
`ActivityIndicatorViewComponentDescriptor`. O
`RCTActivityIndicatorViewComponentView.mm` registra esse descritor gerado, cria o
`UIActivityIndicatorView` a partir das props padrão (anima e esconde quando
parado) e, no `updateProps`, inicia ou para a animação quando `animating` muda e
aplica `color`, `hidesWhenStopped` e `size` (estilo medium ou large do UIKit). O
`ProgressBarContainerView.kt` do Android sempre esconde a barra parada e usa a
cor de destaque do sistema quando `color` é nulo, então o iOS é a referência para
`hidesWhenStopped`.

## O que este host fazia

O facade exportava `ActivityIndicator` como `unavailable("ActivityIndicator")`,
que lançava erro ao renderizar. O host anterior não tinha o descritor
`ActivityIndicatorView`: com o bundle atual, a interop legada do Fabric resolve o
nome e o mount rejeita o nó com `Unsupported GodotControl kind:
ActivityIndicatorView`, seguido de `map::at` para os Controls que faltam.

## A implementação

1. O [facade](../../../src/react-native-platform.jsx) renderiza o
   `ActivityIndicator.js` original depois das verificações usuais da plataforma
   (sem Controls inline em Text, só estilos suportados). A transformação RN do
   SDK roda o plugin do Codegen, então a ViewConfig `RCTActivityIndicatorView` é
   a gerada.
2. O [CMake](../../../native/CMakeLists.txt) passa a compilar também o
   `ShadowNodes.cpp` gerado, e o [runtime](../../../native/application_runtime.cpp)
   registra o `ActivityIndicatorViewComponentDescriptor` gerado. O
   `ActivityIndicator.js` dimensiona o frame, então nada é medido no nativo.
3. O [`GodotActivityIndicator`](../../../native/activity_indicator_view.cpp) é um
   `Panel` desenhado à mão: o Panel pinta a aparência do host e por cima vai um
   spinner de oito raios sobre todo o frame do Yoga. Como no
   `RCTActivityIndicatorViewComponentView`, `animating` inicia e para o spinner.
   Só um spinner animando recebe a notificação de processo interno do Godot; a
   cada frame a fase avança pelo delta real a uma volta por segundo, e o raio mais
   claro anda um passo a cada oitavo de volta com os seguintes esmaecendo. Parado,
   o spinner mantém a fase: com `hidesWhenStopped` não é desenhado, sem ela é
   desenhado congelado. `color` recolore; sem cor, ele usa `#999999`, a cor que o
   RN passa no iOS, porque o `ActivityIndicator.js` passa `null` fora do iOS.
4. Os tipos do facade ganham `ActivityIndicator` e `ActivityIndicatorProps`, com
   checagem no consumidor TSX, e um teste de contrato fixa a ViewConfig gerada.

## Padrões e tamanhos

O UIKit mantém o spinner medium ou large no próprio tamanho dentro do frame, então
um tamanho numérico no iOS só aumenta o host. O Godot desenha no frame: isso
coincide com 20×20 e 36×36 nos tamanhos nomeados e escala um tamanho numérico,
como no Android. A cor nula, que no Android vira a cor de destaque do sistema,
vira no Godot o cinza que o RN usa no iOS.

## O que foi verificado

Duas roots de uma aplicação Hermes; cada medida de fase cobre dez frames reais
do SceneTree:

- **Padrões e tamanhos.** Animando, `hidesWhenStopped`, estilo small e o cinza do
  iOS sem cor; 20×20, 36×36 com estilo large e 48×48 com estilo small para um
  número; cada ref público resolve para a tag do seu spinner nativo.
- **Fase.** Animando, a fase e a contagem de processo interno avançam exatamente
  uma vez por frame e o último desenho usa a fase nova. Parado, as duas ficam
  congeladas e nenhum trabalho por frame roda, enquanto os outros spinners
  continuam; sem `hidesWhenStopped` o spinner congelado é desenhado; ao
  reanimar, ele continua da fase congelada.
- **Cor, remontagem e duas roots.** Cor nova e remoção da cor; um spinner
  remontado é uma instância nova com fase própria; os spinners de B mantêm
  estado e instâncias enquanto A muda.

## Controles

O host anterior foi preservado e roda o mesmo bundle: falha exatamente os 2
checks normativos de montagem (nenhum spinner nativo; erros do host), com
`Unsupported GodotControl kind: ActivityIndicatorView` e `map::at` no log, sem
crash, e o cleanup fica balanceado. A sabotagem retida tira o processo interno do
spinner: 9 checks falham (os de fase, o estado de processamento nos padrões e no
B, e a remontagem), e o oráculo independente rejeita o relatório no primeiro check
de fase. A fonte foi restaurada byte a byte e o rebuild reproduziu o host
`267763d9`.

## Regressões

No host atual passaram os três gates do job `contracts` (262 testes Node, um deles
o novo contrato da ViewConfig `RCTActivityIndicatorView` gerada, e 13 Python;
análise estática e scan de publicação), o `test:recovery` e as suítes nativas do
job `native-cold-start`: o Switch 108, o AppState 75, o click 728 nas oito lanes,
22 exemplos, transform guards, runtime, aplicação compartilhada, módulos,
comandos de foco, processador e geometria de ponteiro, EventTarget original,
ancestralidade, dispatch e dispatch integrado, serviços, interest 233, Down 2.731,
query faults 187, resolver faults 66, Document Up 6.459, View Up 297, Move 220,
Document Move 1.940, hover 158, caminho da raiz 82, Document hover 1.530 e
`parity:godot`. Também passaram o teste afim, o codegen nativo, o SDK nativo
(pack/verify), os adapters (registry, loader com 89 checks e 21 casos, runtime com
13 execuções e 213 checks), o consumidor (30 + 40) e o cold start.

A bateria rodou a partir da implementação sem nenhuma fonte executada alterada;
os documentos foram escritos depois dos gates que os leem, que rodaram de novo na
árvore final. As 74 fontes de código/configuração executadas (13 produtoras do
bundle e da suíte, 60 entradas do build nativo e 6 de verificação, com
sobreposição) correspondem à implementação
`a6523439b5146b6e5ad8f30fd8c0435af0c4a65a` por `git show`/SHA-256.

## Mescla com a main

A fatia foi feita sobre a branch do Switch. Depois que o Switch (#33) e os toques
compartilhados (#34) entraram, a `main` foi mesclada duas vezes, sem rebase
(`99deec8` e `f76c9a7`). O controle do host anterior foi refeito para o bundle novo
(as mesmas 2 falhas de montagem), e na árvore mesclada passaram de novo o
ActivityIndicator (33/33), o Switch, o PanResponder, os toques compartilhados, os
22 exemplos e os gates do `contracts`. O recibo registra isso em
`mergeReverification`.

## Limites

Acessibilidade, movimento reduzido, a velocidade e a geometria exatas do UIKit,
capturas de pixel, hardware, exports mobile e performance seguem abertos. Nenhum
GF, checkpoint, peso ou denominador fecha.
