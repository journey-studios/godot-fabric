# GF-03, fatia A do `contract`: o tipo de todo nome de raiz que a fachada exporta

O aceite do GF-03 pede que "um app TSX independente importe todo nome de raiz no escopo" e que os contratos implementados
rodem e os inacabados falhem visivelmente. Até esta fatia, oito nomes que a fachada (`src/react-native-platform.jsx`) exporta
não tinham declaração em `types/react-native.ts`, e um `import { PixelRatio } from "react-native"` num TSX de consumidor não
compilava. Esta fatia dá tipo a esses oito nomes, faz o consumidor tipado importar e usar todos os nomes que a fachada exporta e
acrescenta um censo que mantém as duas coisas.

Ela não muda a fachada, o host, o SDK nem o código nativo, e não fecha checkpoint nenhum: o `contract` do GF-03 continua aberto.

> Os números deste registro são os do fim da fatia A. A [fatia C](../gf-03-react-native-version/README.md) exportou
> `ReactNativeVersion` depois dela: hoje são 58 exportados, 3 placeholders e 36 ausentes, 61 nomes no consumidor e 23 ausentes `1_0`.

## A contagem

Os nomes de raiz são as 97 linhas `value` do inventário de contratos do RN 0.87.1
(`docs/compatibility/contracts-0.87.1.json`). O mapa de contratos (`contract-map-0.87.1.json`) põe 84 delas no escopo `1_0` e 13
no `post_1_0` (todas do GF-40: `VirtualViewMode`, `experimental_LayoutConformance`, `unstable_DEFAULT_INITIAL_NUM_TO_RENDER`,
`unstable_NativeText`, `unstable_NativeView`, `unstable_TextAncestorContext`, `unstable_VirtualArray`, `unstable_VirtualColumn`,
`unstable_VirtualColumnGenerator`, `unstable_VirtualRow`, `unstable_VirtualView`, `unstable_createVirtualCollectionView` e
`unstable_getScrollParent`). A regra que classifica a fachada é a de `npm run parity:status`, a mesma que dá 57 exportados, 3
placeholders e 37 ausentes sobre as 97 linhas (`docs/compatibility/BASELINE.md`). Sobre as 84 do escopo `1_0` ela dá:

| Estado na fachada | Nomes | Tipo público |
| --- | --- | --- |
| exportado | 57 | sim, todos |
| placeholder que lança ao renderizar (`unavailable(...)`) | 3: `KeyboardAvoidingView` (GF-12), `RefreshControl` (GF-14) e `StatusBar` (GF-24) | sim, agora |
| ausente | 24 | não, de propósito |

Os 24 ausentes são `Alert`, `BackHandler`, `DevMenu`, `DevSettings`, `DeviceEventEmitter`, `DeviceInfo`, `EventEmitter`,
`Keyboard`, `LogBox`, `NativeAppEventEmitter`, `NativeComponentRegistry`, `Networking`, `PlatformColor`, `ReactNativeVersion`
(do próprio GF-03), `Settings`, `Share`, `Systrace`, `UTFSequence`, `processColor`, `registerCallableModule`,
`requireNativeComponent`, `unstable_batchedUpdates`, `useAnimatedColor` e `usePressability`. Os 37 de `parity:status` são
esses 24 mais os 13 do `post_1_0`.

## Os oito tipos novos

Todos em `types/react-native.ts`, no padrão do arquivo: o tipo do RN (`typeof RN.X`) onde a fachada entrega o contrato inteiro, e o
recorte (`Pick`, `Omit`, as props de um componente) onde ela implementa um subconjunto.

| Nome | Declaração | Por quê |
| --- | --- | --- |
| `TouchableWithoutFeedback` | `typeof RN.TouchableWithoutFeedback` | a fachada repassa todas as props ao original do RN |
| `TouchableHighlight` | componente de `Omit<RN.TouchableHighlightProps, "style"> & { style?: StyleProp<ViewStyle> }`, com a ref de `NativeInstance` | o `style` é o subconjunto de View do Godot, como o do `TouchableOpacity`: a fachada recusa outro estilo ao renderizar (`nativeStyle`). As outras props são as do RN |
| `PanResponder` | `typeof RN.PanResponder` | a fachada reexporta o original do RN |
| `PixelRatio` | `typeof RN.PixelRatio` | a fachada reexporta o original do RN |
| `I18nManager` | `Pick<typeof RN.I18nManager, "isRTL">` | a fachada tem só `{ isRTL: false }`; `getConstants`, `allowRTL`, `forceRTL`, `swapLeftAndRightInRTL` e `doLeftAndRightSwapInRTL` não existem e não são declarados |
| `KeyboardAvoidingView` | `React.ComponentType<RN.KeyboardAvoidingViewProps>` | placeholder do GF-12, sem as estáticas do RN |
| `RefreshControl` | `React.ComponentType<RN.RefreshControlProps>` | placeholder do GF-14, sem as estáticas do RN |
| `StatusBar` | `React.ComponentType<RN.StatusBarProps>` | placeholder do GF-24, sem as estáticas do RN |

Os três placeholders são componentes com as props do RN (`React.ComponentType<RN.XProps>`), para que um app vindo do RN
compile. O contrato inacabado continua falhando visivelmente em execução, como já falhava: o componente lança
`Godot platform does not implement <nome>` ao renderizar. Um comentário no tipo diz que o nome é um placeholder e qual GF é o
dono. As estáticas do RN não são declaradas até o dono implementar o nome: o `StatusBar` do RN declara `setBarStyle`, `setHidden`,
`currentHeight` e as entradas de pilha, que o placeholder não tem, e chamá-las é erro de compilação, não um `TypeError` em
execução (o RN 0.87.1 não declara estática nenhuma no `KeyboardAvoidingView` nem no `RefreshControl`).

## O consumidor tipado

`tests/types/consumer.tsx`, que `npm run type-check` verifica com `tsconfig.godot.json`, passa a importar por nome os 60 nomes que a
fachada exporta (57 mais os 3 placeholders) e a usar cada um ao menos uma vez num contexto tipado. Antes importava 50; os 10 novos
são os 8 acima e `codegenNativeComponent` e `codegenNativeCommands`, que já tinham tipo e faltavam no consumidor. Os placeholders só
entram como elementos criados e nunca renderizados. Cada tipo novo tem um uso positivo e,
onde o contrato recusa algo, um `@ts-expect-error` (o estilo fora do subconjunto no `TouchableHighlight`, `forceRTL` no
`I18nManager`, `refreshing` ausente no `RefreshControl`). A atribuibilidade ao RN é provada como o consumidor já faz com o
`TextInput` e o `Button`: as props do `TouchableHighlight` e o `I18nManager` são atribuídos ao tipo do RN. Os
`@ts-expect-error` que já existiam ficam.

## O censo

`tests/root-names.test.mjs`, no `npm run test:contracts`:

- lê os nomes de raiz `1_0` do mapa de contratos (`resolveMap` de `scripts/parity-map.mjs`) e classifica a fachada com
  `classifyFacade`, a função que esta fatia extraiu de `scripts/parity-status.mjs` para `scripts/parity-facade.mjs`, sem duplicar a
  regra: `parity:status` e o censo contam com o mesmo código;
- lê os nomes que `types/react-native.ts` declara como valor (constantes, funções, classes e enums exportados) e os nomes que o
  consumidor importa de `react-native` e usa, os dois com o analisador do pacote `typescript`, o mesmo que `scripts/parity-status.mjs` e
  os outros testes do repositório já usam;
- falha quando um nome exportado ou placeholder não tem tipo, quando um tipo nomeia algo que a fachada não exporta, quando o
  consumidor não importa ou não usa um nome tipado, e quando a lista dos ausentes difere da lista fixada no teste (os 24 nomes).
  Implementar um dos 24 obriga a declarar o tipo, usá-lo no consumidor e tirá-lo da lista, e cada mensagem diz o que fazer.

O teste também prova que cada falha acontece, com entradas alteradas: um nome sem tipo (e um placeholder sem tipo), um tipo para um
nome ausente, um nome implementado ou perdido, e um nome que o consumidor larga ou só importa.

## O que não muda

- A fachada (`src/`) e o host: nenhum nome novo é exportado, e os 24 ausentes continuam sem implementação e sem tipo.
- A saída de `npm run parity:status`: a extração de `classifyFacade` mantém o relatório byte a byte (57 exportados, 3 placeholders,
  37 ausentes, `facadeSha256` igual).
- A certificação diferencial: um tipo diz que o nome compila, não que o comportamento é o do RN. Os casos positivos e negativos e a
  comparação com o RN são o checkpoint `parity`, que continua aberto, e os alvos são o `targets`.
- O `contract` do GF-03 continua aberto: faltam os 24 nomes e o D20 (resolução de módulos e identidade única de React).
- O mapa de contratos, o catálogo de fixtures e o painel: nenhum checkpoint muda.

## Como reproduzir

```sh
npm run type-check
node --test tests/root-names.test.mjs
npm run parity:status
```

`npm run type-check` falha se um dos oito tipos sumir ou mudar de forma, porque o consumidor os usa. O teste imprime a lista de
problemas, cada um com o que fazer. `parity:status` imprimia `exported_unverified` 57, `explicit_placeholder` 3 e `missing` 37, como antes (hoje 58, 3 e 36, pela fatia C).
