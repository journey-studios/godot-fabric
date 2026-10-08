# APIs específicas de iOS e Android: a indisponibilidade do RN reproduzida no Godot

Esta fatia, a primeira do GF-24, faz o `react-native` público exportar `ToastAndroid`,
`PermissionsAndroid`, `DynamicColorIOS`, `ActionSheetIOS`, `ProgressBarAndroid`,
`DrawerLayoutAndroid`, `InputAccessoryView`, `PushNotificationIOS` e `TouchableNativeFeedback`
do RN 0.87.1, e cada um roda o ramo que o próprio RN toma numa plataforma que não é a sua
(`Platform.OS` é `"godot"`): um aviso, um valor resolvido, um erro lançado ou uma
`UnimplementedView`. Os módulos são os ORIGINAIS do RN, lidos por getters preguiçosos de
`src/os-specific.js` (o `ToastAndroid` e o `DrawerLayoutAndroid` pelos arquivos `...Fallback` que
o `.ios.js` do próprio RN exporta) e, para o `TouchableNativeFeedback`, por um wrapper da fachada
com a guarda de Control inline das outras touchables. O host não registra nenhum dos módulos
nativos que eles procuram: a ausência é o contrato. Esta fatia não tem código nativo. O
[recibo](execution.json) fixa fontes, hashes, contagens e resultados.

Todo link de código abaixo está fixado no commit de implementação
[`4338d1c`](https://github.com/journey-studios/godot-fabric/commit/4338d1c5a2803a8c1b8feda633fc8be63565ac3d)
(árvore `709d7872`), em cujo conteúdo, limpo e sem arquivos novos, cada comando abaixo rodou.

| Lane executada | Checks | Observação |
| --- | ---: | --- |
| SDK anterior: o `src/` da main `6d02746`, bundle `513de636` | 7/37 | Exatamente as 30 falhas normativas: nenhum dos nove nomes é exportado, cada leitura é `undefined` e os casos falham ao renderizar; os 7 checks que valem em qualquer SDK passam. O oráculo rejeita o relatório com `A: only StatusBar and an inline TouchableNativeFeedback fail at render` |
| Sabotagem `platform-android`, bundle `211dbcd6` | 23/37 | Exatamente 14 falhas: `Platform.OS` é `"android"`, os módulos que precisam de módulo nativo lançam e o `TouchableNativeFeedback` entrega `nativeBackgroundAndroid` ao filho; o oráculo rejeita com `A: only StatusBar and an inline TouchableNativeFeedback fail at render` |
| Sabotagem `silent-shim`, bundle `dcdc7364` | 29/37 | Exatamente 8 falhas: o Toast fica mudo e o `PermissionsAndroid` concede; o oráculo rejeita com `ToastAndroid is RN's module` |
| Sabotagem `self-import`, bundle `22aac58c` | 32/37 | Exatamente 5 falhas: a fachada usa o caminho genérico do `ToastAndroid`, que importa a si mesmo e vale `undefined`; o oráculo rejeita com `ToastAndroid is exported` |
| SDK atual, bundle `2f82a8ca`, host `45087a00`, headless | 37/37 | Duas aplicações do mesmo bundle (dois runtimes Hermes) contra o registro de TurboModules real do host, com o oráculo independente: 46 operações, 16 avisos atribuídos e 44 permissões verificados |

As lanes usam o mesmo fixture, o mesmo probe e o mesmo oráculo; só o SDK muda. O SDK anterior
é o `src/` da main antes desta fatia, extraído do git (`git show 6d02746:<arquivo>`, fachada
`2ffd5130…` conferida na extração) para `build/os-contracts-previous-sdk/` e empacotado pelo
mesmo `bundleNativeProbe`. Como a fatia não tem código nativo, o binário do host é o mesmo em
todas as lanes e um "host anterior" não discriminaria; é por isso que o controle é o SDK. As três
sabotagens são retidas e em memória: `node scripts/os-contracts-sabotage.mjs` entrega ao esbuild
um texto alterado de um arquivo do SDK (um plugin antes do `platformPlugin`), roda o runner e o
oráculo, e o recibo local prova por hash que nenhum arquivo-fonte foi editado.

**Ambiente**: macOS arm64; Godot oficial 4.7.2 (`ed1daf0bf`), RN 0.87.1, React 19.2.3, Hermes
250829098.0.17 e Node v22.23.3. A suíte roda em modo headless; não há exemplo nem captura (a
saída visual desta fatia é mínima, e o que importa é o que o JS recebe, devolve e imprime).

```sh
npm run test:os-contracts
```

Os controles rodam com `node tests/os-contracts-native.test.mjs --allow-previous-sdk` e
`--sabotage=platform-android|silent-shim|self-import`; `node scripts/os-contracts-sabotage.mjs`
roda os quatro e, por último, a lane atual, que grava `build/os-contracts-comparison.json` com os
controles. Um relatório de controle fica velho quando um arquivo pinado muda: o script o refaz.

> **CI hospedada pendente.** O passo `npm run test:os-contracts` e o artefato
> `native-os-contracts` do workflow `contracts.yml` ainda não rodaram na CI hospedada. Tudo o
> que esta página registra é evidência local, em macOS arm64. Só o checkpoint `slice` da primeira
> fatia do GF-24 fecha com ela; nenhum GF completo, outro checkpoint, peso ou denominador fecha.

## O que o RN faz

Todos os números de linha e as fontes estão na
[nota de pesquisa](https://github.com/journey-studios/godot-fabric/blob/4338d1c5a2803a8c1b8feda633fc8be63565ac3d/docs/research/os-contracts.md).
O `index.js` do RN expõe cada API por um getter preguiçoso. Com `Platform.OS` diferente de
`ios` e `android`: o `ToastAndroid.js` genérico só importa a si mesmo (o módulo útil é o
`ToastAndroidFallback`, que o `.ios.js` exporta: constantes 0 e um `console.warn` por chamada);
o `PermissionsAndroid` avisa e resolve `false`, `'denied'` ou `{}`; `DynamicColorIOS` lança;
`ActionSheetIOS` valida os argumentos e lança `ActionSheetManager doesn't exist`;
`ProgressBarAndroid` é a `UnimplementedView`; `DrawerLayoutAndroid` é, de novo, o
`...Fallback` (uma `UnimplementedView` e oito métodos que lançam); `InputAccessoryView` avisa a
cada render e devolve `null`; `PushNotificationIOS` lança em quinze estáticos e mantém um emissor só
de JS para `addEventListener` e `removeEventListener`; `TouchableNativeFeedback` é Pressability
sem o drawable do Android; `StatusBar` exige `getEnforcing('StatusBarManager')` na importação e
quebra.

## O que esta fatia faz

1. [`src/os-specific.js`](https://github.com/journey-studios/godot-fabric/blob/4338d1c5a2803a8c1b8feda633fc8be63565ac3d/src/os-specific.js)
   é um módulo CommonJS com getters preguiçosos (o padrão de `src/device-services.js`: um export
   ESM não pode ser getter) que devolve os módulos originais e imprime, com as chaves e os textos do
   `index.js`, o aviso de uma vez de `ProgressBarAndroid`, `DrawerLayoutAndroid` e
   `PushNotificationIOS`. Importar o `react-native` não imprime nada.
2. A [fachada](https://github.com/journey-studios/godot-fabric/blob/4338d1c5a2803a8c1b8feda633fc8be63565ac3d/src/react-native-platform.jsx)
   reexporta os oito por `export { … } from "./os-specific"` e define o `TouchableNativeFeedback`
   como wrapper de função sobre a classe original: dentro de `Text` lança `Inline Controls are
   not implemented in Godot Text`, e os quatro estáticos (`SelectableBackground`,
   `SelectableBackgroundBorderless`, `Ripple`, `canUseNativeForeground`) são os do RN.
3. Os [tipos](https://github.com/journey-studios/godot-fabric/blob/4338d1c5a2803a8c1b8feda633fc8be63565ac3d/types/react-native.ts)
   derivam das declarações do RN (`typeof RN.X`; props do `TouchableNativeFeedback` por `Pick`),
   com casos positivos e `@ts-expect-error` no consumer.
4. `'denied'`, `false` e `{}` do `PermissionsAndroid` significam **indisponível** no Godot, não uma
   recusa do usuário: é a resposta do próprio RN fora do Android, reproduzida em vez de trocada
   por um erro. O `StatusBar` continua placeholder, e o host continua sem `StatusBarManager`.

## O que foi verificado

O [probe](https://github.com/journey-studios/godot-fabric/blob/4338d1c5a2803a8c1b8feda633fc8be63565ac3d/tests/os-contracts-probe.gd)
roda duas `FabricApplication` reais, cada uma com seu Hermes e o mesmo
[bundle](https://github.com/journey-studios/godot-fabric/blob/4338d1c5a2803a8c1b8feda633fc8be63565ac3d/tests/os-contracts-fixture.jsx),
que embrulha o `console.warn` antes de avaliar o `react-native` (ele continua repassando ao host):

- **A**: uma root com um caso por componente, cada um num error boundary (`ProgressBarAndroid`,
  uma cópia com `View` comum como controle, `DrawerLayoutAndroid`, `InputAccessoryView`,
  `StatusBar`, três `TouchableNativeFeedback` e um dentro de `Text`). Lê os dez exports, roda as 46
  chamadas que as fontes do RN implicam (inclusive os 15 estáticos do `PushNotificationIOS` e os 8
  métodos da instância montada do `DrawerLayoutAndroid`, achados nas próprias classes), pergunta ao
  registro do host pelos seis módulos, faz um clique real de mouse e um de toque no
  `TouchableNativeFeedback` e, depois do stop, roda de novo as partes síncronas.
- **B**: uma segunda aplicação repete leituras e chamadas e mostra que cada aviso de uma vez
  imprime de novo, uma vez, no seu runtime.

Os 37 checks são 30 normativos (precisam do SDK desta fatia) e 7 que valem em qualquer SDK: as
duas roots montam sem erro, importar não imprime, o `StatusBar` segue placeholder, o caminho
genérico do `ToastAndroid` é `undefined`, nenhuma chamada deixa diagnóstico, o host não registra
os seis módulos e o stop equilibra as views. O
[oráculo independente](https://github.com/journey-studios/godot-fabric/blob/4338d1c5a2803a8c1b8feda633fc8be63565ac3d/tests/os-contracts-oracle.mjs)
não lê `src/` nem copia nada: extrai dos fontes do RN pinado cada texto de aviso e de erro, as 44
permissões (a tabela congelada confere com a do tipo), `RESULTS`, as constantes do Toast, os
estáticos do `PushNotificationIOS`, os métodos do Drawer, os invariantes do `ActionSheetIOS` em
ordem, os avisos do `index.js`, os nomes dos módulos nos specs, o erro do `getEnforcing` e a ordem
do Pressability. Ele compara cada chamada gravada, a atribuição de TODO aviso (cada um pertence a
um read, a uma chamada ou ao mount), a árvore nativa, as respostas do host e o clique, e rejeita
as quatro lanes de controle mesmo com os checks do relatório marcados como passados. O teste Node
ainda confere que cada aviso que o JS viu virou uma linha `HERMES:` no log, a mesma quantidade
de vezes (25 linhas em 8 textos).

## Comportamento observado no Hermes do Godot

| API | Observado |
| --- | --- |
| `ToastAndroid` | É o `ToastAndroidFallback`. `SHORT`, `LONG`, `TOP`, `BOTTOM` e `CENTER` valem 0; `show`, `showWithGravity` e `showWithGravityAndOffset` devolvem `undefined` e avisam `ToastAndroid is not supported on this platform.` |
| `PermissionsAndroid` | 44 permissões e 3 resultados, ambos congelados. `check` avisa `"PermissionsAndroid" module works only for Android platform.` e resolve `false`; `request` (com ou sem rationale) resolve `'denied'`; `requestMultiple` resolve `{}`; `checkPermission` e `requestPermission` avisam a descontinuação, depois a plataforma, e resolvem `false` |
| `DynamicColorIOS` | Lança `DynamicColorIOS is not available on this platform.` |
| `ActionSheetIOS` | Os invariantes de argumento rodam antes (`Options must be a valid object`, `Must provide a valid callback`, `Must provide a valid failureCallback`, `Must provide a valid successCallback`); com argumentos válidos os três métodos lançam `ActionSheetManager doesn't exist` |
| `ProgressBarAndroid` | `UnimplementedView`: o aviso de uma vez sai no primeiro render, uma vez por runtime. Compõe o mesmo que uma `View` aninhada comum (o filho dentro do wrapper, sem view nativa extra) |
| `DrawerLayoutAndroid` | O `...Fallback`: só o filho principal monta (`renderNavigationView` nunca é chamado); os 8 métodos da instância lançam `DrawerLayoutAndroid is only available on Android` |
| `InputAccessoryView` | Avisa `<InputAccessoryView> is only supported on iOS.` a cada render e não monta o filho |
| `PushNotificationIOS` | 15 estáticos lançam `PushNotificationManager is not available.`; `addEventListener` e `removeEventListener` funcionam em JS para os 4 eventos e rejeitam qualquer outro; `checkPermissions` valida o callback primeiro |
| `TouchableNativeFeedback` | Clique real de mouse e de toque: `onPressIn` no contato e, na soltura, `onPressOut` e depois `onPress`; nenhum `nativeBackgroundAndroid` nem `nativeForegroundAndroid` chega ao filho (com `Ripple`, com `useForeground` e por padrão), e os handlers do Pressability chegam; o host não reporta erro |
| `StatusBar` | Placeholder: renderizar lança `Godot platform does not implement StatusBar` |
| Host | `TurboModuleRegistry.get` devolve `null` e `getEnforcing` lança o erro do RN para `ToastAndroid`, `PermissionsAndroid`, `ActionSheetManager`, `DialogManagerAndroid`, `PushNotificationManager` e `StatusBarManager` |

### Divergências da pesquisa em Node vm

A pesquisa que fixou a tabela rodou os módulos do RN no `vm` do Node, sem host. No Hermes do Godot
tudo se confirma, com sete diferenças ou refinamentos (a
[nota de pesquisa](https://github.com/journey-studios/godot-fabric/blob/4338d1c5a2803a8c1b8feda633fc8be63565ac3d/docs/research/os-contracts.md)
as detalha):

1. `PushNotificationIOS`: quinze estáticos lançam, mas `addEventListener` e `removeEventListener`
   não lançam para os eventos válidos (emissor só de JS, `Platform.OS !== 'ios' ? null`).
2. Ordem do clique: `onPressIn`, `onPressOut`, `onPress` (o Pressability desativa antes de chamar
   `onPress`), não `onPressIn`, `onPress`, `onPressOut`.
3. `ProgressBarAndroid` e `DrawerLayoutAndroid` "montam como View": a view da `UnimplementedView`
   é achatada pelo Fabric e não tem nó nativo (12 views por root); o probe prova a equivalência
   por comparação com um controle na mesma root.
4. O `InputAccessoryView` avisa uma vez por render, e a root renderiza mais de uma vez ao montar:
   dois avisos no mount.
5. Depois do stop as partes síncronas seguem funcionando, mas a Promise do `PermissionsAndroid`
   fica pendente, porque o runtime que parou não drena mais microtasks.
6. O RN clona o filho do `TouchableNativeFeedback` com o `testID` do próprio touchable.
7. Com `Platform.OS` forçado a `"android"` (a sabotagem), o host responde
   `Unsupported native command: setPressed` e `hotspotUpdate`: o ramo Android não pode ser tomado.

## Os recibos do `bundleNativeProbe` não mudaram

Esta fatia estendeu [`bundleNativeProbe`](https://github.com/journey-studios/godot-fabric/blob/4338d1c5a2803a8c1b8feda633fc8be63565ac3d/scripts/native-probe-bundle.mjs)
com dois parâmetros opcionais, `platformRoot` (padrão `src/`) e `plugins` (padrão `[]`, antes do
`platformPlugin`), para que as quatro lanes de controle usem o helper canônico. A prova de que o
comportamento padrão não mudou: os onze chamadores (accessibility, app-state, appearance,
device-services, frame-clock, images, modal-host, native-animated, networking, text-layout e
websocket) foram empacotados com o helper da main `c0f3702` e com o estendido, e os onze
recibos (hash do bundle, `inputs`, `assets`, `sources` sem o pin do próprio helper e os originais do RN)
saíram idênticos byte a byte (`cmp`; SHA-256 do conjunto `5c1d7d14…`). As suítes desses chamadores
também passam na árvore commitada (tabela no recibo).

## Limitações

- O caminho genérico de terceiros (`react-native/Libraries/Components/ToastAndroid/ToastAndroid`,
  `.../DrawerAndroid/DrawerLayoutAndroid`) continua `undefined` até o `platform-plugin` ganhar um
  alias para os `...Fallback`; o probe registra o fato para o Toast. Só o import da raiz é coberto.
- `'denied'` e `false` não distinguem uma recusa de uma ausência.
- `StatusBar` continua placeholder; Alert, Share, Settings e BackHandler são do GF-23.
- `ProgressBarAndroid` e `DrawerLayoutAndroid` não desenham nada próprio.
- Uma Promise devolvida por essas APIs fica pendente depois do stop.
- Nenhum comportamento de Android ou iOS é certificado, nem as implementações que as portas móveis
  trazem (GF-34 e GF-35), as props específicas de SO e a comparação por versão do SO.
- A suíte roda headless em macOS arm64. Windows e Linux têm o mesmo JavaScript, sem execução.
