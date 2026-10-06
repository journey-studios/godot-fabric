# Listas virtualizadas no ScrollView do SDK

Esta fatia troca os placeholders `FlatList` e `VirtualizedList` do SDK pelos
módulos originais do RN 0.87.1 — `FlatList`, `SectionList`, `VirtualizedList` e
`VirtualizedSectionList` —, lidos pelo import público `react-native` e
renderizados sobre o ScrollView do SDK. O janelamento é dirigido por input real
do Godot (roda do mouse e arrasto de toque) em duas roots de uma aplicação
Hermes. O [recibo](report.json) fixa fontes, hashes e resultados.

| Lane executada | Checks | Observação |
| --- | ---: | --- |
| Host anterior `1ba66860` (main `8f80fed`) | 41/44 | Exatamente as 3 falhas normativas: a lista invertida não segue o dedo e cinco passos da roda enviam cinco eventos de scroll |
| SDK anterior `8f80fed` | 5/16 | As 11 falhas normativas: `FlatList` e `VirtualizedList` lançam como placeholders, `SectionList` não é exportado e o ScrollView rejeita `scrollEventThrottle` |
| ScrollView do SDK sem `onLayout` (sabotagem retida) | 41/44 | 3 falhas na primeira janela e na visibilidade; o oráculo independente rejeita o relatório |
| Host e SDK corrigidos, headless | 44/44 | Roda e arrasto reais, duas roots e os módulos originais do RN |

O host anterior e a sabotagem executam o mesmo fixture; o host anterior roda
exatamente o mesmo bundle do SDK, e só os produtores nativos diferem.

```sh
npm run test:lists
```

Com o host anterior instalado em `addons/`, o mesmo runner confere o controle com
`node tests/virtualized-list-native.test.mjs --allow-original-negative`. O SDK
anterior e a sabotagem não exigem troca de host:
`node tests/virtualized-list-native.test.mjs --lane preceding-sdk` e
`--lane sabotage`.

## O que o RN faz

O `index.js` do RN expõe as quatro listas por getters preguiçosos. Os módulos de
`Libraries/Lists` reexportam `@react-native/virtualized-lists`, publicado como
fonte Flow, cujo `VirtualizedList` importa do `react-native` o `ScrollView`, o
`StyleSheet`, o `RefreshControl` e outros, e importa `ReactNativeFeatureFlags`
por um caminho profundo que os exports do pacote do RN não expõem.

O `VirtualizedList` espalha todas as props no ScrollView, adiciona os próprios
handlers (`onScroll`, `onLayout`, `onContentSizeChange`, `onScrollBeginDrag`/
`EndDrag`, `onMomentumScrollBegin`/`End`), passa `scrollEventThrottle` 0,0001 e
chama `scrollTo` pelo ref. A janela é o ponto fixo de
`computeWindowedRenderLimits`: `windowSize - 1` viewports de overscan com fator
de avanço 0,5, preenchidos em lotes, mais as células de `initialNumToRender`. A
visibilidade é a do `ViewabilityHelper`, `onEndReached` dispara uma vez por
comprimento de conteúdo e, sem `getItemLayout`, um índice além da maior célula
medida chama `onScrollToIndexFailed` com a média medida.

O payload do `ScrollViewEventEmitter` é o `ScrollEvent` do RN
(`ScrollEvent.cpp`): `contentOffset`, `contentInset`, `contentSize`,
`layoutMeasurement`, `zoomScale` e `timestamp` em milissegundos, com `target` e
`timeStamp` acrescentados pelo `UIManagerBinding.cpp`; o `ScrollEndDragEvent`
acrescenta `targetContentOffset` e `velocity`. A [pesquisa](../../research/virtualized-list.md)
compara item por item o contrato que a lista exige do ScrollView com este host.

## O que este host fazia

O facade exportava `FlatList` e `VirtualizedList` como placeholders que lançam
e não exportava `SectionList` nem `VirtualizedSectionList`. O ScrollView do SDK
rejeitava toda prop que não conhecia, inclusive as que o `VirtualizedList`
sempre passa (`data`, `renderItem`, `scrollEventThrottle`,
`stickyHeaderIndices`...), o ref não tinha os métodos que o `ScrollView` do RN
acrescenta à instância nativa, e o host nunca aplicava `scrollEventThrottle`. O
arrasto usava deltas em coordenadas de página: num ScrollView invertido
(`scaleY: -1`), o conteúdo andava contra o dedo.

## A correção

1. O [facade](../../../src/react-native-platform.jsx) exporta as quatro listas
   por [getters CommonJS](../../../src/lists.js), preguiçosos como no `index.js`
   do RN; `StyleSheet.compose` é o do RN e `RefreshControl` passa a existir como
   placeholder indisponível, porque o `VirtualizedList` o importa.
2. O [plugin de plataforma](../../../sdk/toolchain/platform-plugin.mjs) resolve
   `@react-native/virtualized-lists` a partir do próprio RN, só quando precisa,
   transforma o Flow como faz com o RN e deixa só esse pacote importar o módulo
   de feature flags; o código do projeto continua sujeito aos exports do RN.
3. O [ScrollView do SDK](../../../src/scroll-view.jsx) descarta as 43
   [props só de lista](../../../src/list-props.mjs) — as dos donos de lista que o
   inventário fixado não dá a `ScrollViewProps` —, aceita
   `scrollEventThrottle` e os eventos de momentum, ignora a dica de clipping e a
   flag da barra do Android, e lança para sticky headers, refresh,
   `maintainVisibleContentPosition` e indicadores visíveis. O ref ganha os
   métodos do `ScrollView` do RN como o `createRefForwarder` os acrescenta.
4. O [ScrollAdapter](../../../native/scroll_adapter.cpp) aplica a regra do
   Android (`ReactScrollViewHelper.emitScrollEvent`): descarta um evento de
   scroll enquanto `scrollEventThrottle` ≥ max(17 ms, tempo desde o último
   enviado).
5. O [runtime](../../../native/application_runtime.cpp) converte os pontos de
   `scrollDragStart`/`scrollDragTo` para as coordenadas locais do
   ScrollContainer, como os scroll views nativos do RN seguem o dedo; um
   ScrollView sem transformação recebe os mesmos deltas. O roteamento de
   ponteiro em `native/pointer_adapter.*` não muda.

## O que foi verificado

O [probe](../../../tests/virtualized-list-probe.gd) monta duas roots e as move
com input real do Godot: passos de roda um por frame, uma rajada de cinco passos
num frame e arrastos de toque. Snapshots nativos dão as células montadas e os
offsets; os Controls dão a posição de cada célula no conteúdo.

- **FlatList com `getItemLayout`** (120 linhas, header, footer, paginação). A
  primeira janela é `0..16`; seis passos de roda levam a 288 px, com seis
  eventos de scroll e o payload do RN, janela `0..24` e visíveis `6..11`.
  `scrollToIndex(60)` vai a 2440 px: a janela vira `0..9 ∪ 47..77`, as células
  ficam nos offsets do `getItemLayout` e os visíveis são `60..65`.
  `scrollToEnd` vai a 4640 px e `onEndReached` dispara uma vez com distância 0;
  a página acrescentada entra na janela `0..9 ∪ 102..132`, e o fim da lista
  maior dispara de novo em 5840 px. `scrollToOffset(0)` volta à janela
  `0..16`, desmonta o fim e devolve os visíveis `0..4`.
- **VirtualizedList horizontal medido** (60 itens de quatro larguras, fonte de
  dados numérica). Um arrasto de 180 px move a lista exatamente com o dedo, com
  um `onScrollBeginDrag` e um `onScrollEndDrag` (velocidade 0); as células
  medidas cobrem a viewport e a janela cresce. `scrollToIndex(4)` vai ao offset
  medido, 360 px, e `scrollToIndex(50)` chama `onScrollToIndexFailed` com a
  média das 14 células medidas (87,14 px) sem rolar.
- **FlatList vazio.** O `ListEmptyComponent` aparece depois do header.
- **SectionList medido** (12 seções de 6 itens, separadores). Um arrasto de
  150 px rola a lista; os tokens visíveis trazem a seção, inclusive o header
  (índice nulo). `scrollToLocation(1, 2)` vai à célula plana 10, em 278 px;
  `scrollToLocation(10, 2)` falha com o índice plano 82. Passos de roda levam a
  854 px: as células acima da janela desmontam, as iniciais ficam, e
  `scrollToLocation(0, 0)` as devolve com a janela exata `0..17`.
- **FlatList invertido medido.** O primeiro item fica no fundo; arrastar 60 px
  para baixo move o conteúdo 60 px com o dedo; um passo de roda rola nas
  coordenadas da própria lista.
- **`scrollEventThrottle` 150.** Cinco passos num frame enviam um evento (48 px);
  o offset nativo vai a 240 px e conta quatro descartes; um passo 200 ms depois
  envia o offset atual.
- **Ref e duas roots.** O ref do `FlatList` tem os métodos do `ScrollView` do RN
  sobre a instância nativa; input numa root nunca move as listas da outra;
  `scrollToEnd()` sem argumentos pede a animação padrão do RN e falha
  visivelmente; o stop desmonta as duas roots sem erros.

O [oráculo](../../../tests/virtualized-list-oracle.mjs) refaz tudo a partir dos
algoritmos do RN e do layout declarado no fixture: a janela e os visíveis exatos
de cada estágio com `getItemLayout`, a posição de cada célula (espaçadores
inclusive), os eventos de borda e suas distâncias, o payload de cada evento, os
offsets de `scrollToLocation`, a média de cada falha e, nas listas medidas, que a
viewport está preenchida e nenhuma célula fora do overscan continua montada.

## Controles

O host anterior roda o mesmo bundle: as cinco listas montam e janelam, mas o
arrasto da lista invertida fica em 0 (o conteúdo não segue o dedo) e a rajada
envia cinco eventos ao JS. Ele falha exatamente os 3 checks normativos. O SDK
anterior (`8f80fed`) empacota o mesmo fixture e falha os 11 checks que precisam
das listas; as roots montam e param. A sabotagem retida faz o ScrollView do SDK
descartar `onLayout`: as listas ficam em `initialNumToRender` sem itens visíveis
até o primeiro scroll, 3 checks falham e o oráculo rejeita o relatório mesmo com
esses checks marcados como aprovados. A sabotagem é aplicada numa cópia do SDK
em `build/`; o código executado não muda.

## Regressões

No host desta fatia (`ba161914`) passaram os três gates do job `contracts` (262
testes Node e 13 Python, análise estática e scan de publicação), o
`test:recovery`, as 29 suítes nativas — 22 exemplos com 2.250 checks (o exemplo
de scroll passou seus 62 checks com o arrasto em coordenadas locais), Down 2.731
nas oito lanes, query faults 187, resolver faults 66, Document Up 6.459, View Up
297, Move 220, Document Move 1.940, hover 158, caminho da raiz 82, hover em
Document 1.530, click 728 (que cobre o takeover do ScrollView), AppState 75, as
próprias listas 44, cold start e `parity:godot` — e o lote do SDK nativo (affine,
codegen, pack/verify, registro, loader e runtime de adapters e consumidor
independente).

O SDK muda para todo bundle que importa `react-native`: ele passa a incluir os
getters preguiçosos, os módulos originais das listas e o `StyleSheet` do RN. Os
controles de host anterior que fixam o bundle do SDK vivem nos hosts preservados
fora desta worktree e precisam ser refeitos com os bundles novos. Os getters
preguiçosos mantêm esses hosts utilizáveis: os bundles novos do click, que
contêm as listas sem lê-las, passaram os 728 checks das oito lanes no host
anterior `1ba66860`.

## Merge com a main

Durante a fatia a main avançou com o PanResponder (#32) e o Switch (#33). O merge
`33fc775` manteve os dois lados dos conflitos de lista (`.fallowrc.json`,
`package.json`, `tests/types/consumer.tsx`) e o host foi recompilado
(`3347b67d`). Na árvore mesclada passaram os gates (263 testes Node e 13 Python,
análise estática e scan de publicação), o `test:recovery` e as 31 suítes nativas,
agora com PanResponder 128 e Switch 108, e as quatro lanes da fatia se repetiram:
44/44, o host anterior com o bundle mesclado falha exatamente os 3 checks
normativos, o SDK anterior falha 11 e a sabotagem falha 3, rejeitada pelo
oráculo. O lote do SDK nativo rodou uma vez, na implementação.

## Limites

Scroll animado não existe: um comando sem `animated` salta onde o RN anima,
`animated: true` lança, e `scrollToEnd()` sem argumentos também. Eventos de
momentum nunca são enviados. Sticky headers, `RefreshControl`/`onRefresh`,
`maintainVisibleContentPosition` e indicadores lançam quando pedidos. A roda numa
lista invertida move o conteúdo no sentido oposto ao de uma lista comum, como
os scroll views nativos do Android. Listas aninhadas na mesma orientação
(`measureLayout`), `initialScrollIndex`, `numColumns`, RTL horizontal,
`onStartReached`, `viewAreaCoveragePercentThreshold`/`minimumViewTime`, a fixture
de 10.000 linhas com quadros e memória medidos, hardware e exports móveis seguem
abertos no GF-15, e o contrato completo do ScrollView no GF-14. A CI hospedada
desta fatia está pendente. Esta é a primeira fatia verificada do GF-15: só o
checkpoint `slice` dele fecha e o GF-15 passa a em andamento; nenhum outro
checkpoint, GF, peso ou denominador fecha.

As 73 fontes de código e configuração executadas (13 produtoras do bundle, 56
entradas do build nativo registradas pelo pack do SDK e 7 de verificação, com
sobreposição) correspondem à implementação
`3e9ec4974b473f1c3d0c8847031c7883a9612be3` por `git show`/SHA-256. A execução
partiu de `8f80fed` com uma árvore idêntica à da implementação; este pin
pós-commit não é uma nova corrida.
