# GF-03, fatia C do `contract`: `ReactNativeVersion`, o único nome de raiz ausente que é do GF-03

Dos 24 nomes de raiz `1_0` que a fachada ainda não exportava no fim da [fatia A](../gf-03-root-names/README.md), só um é do GF-03
pelo mapa de contratos (`contract-map-0.87.1.json`, regra `api-gf03-root-names`): **`ReactNativeVersion`**. Os outros 23 são de
outros GFs (GF-23, GF-25, GF-29 e outros) e continuam ausentes. Esta fatia exporta o `ReactNativeVersion` como o original do RN,
dá a ele o tipo do RN, usa o nome no consumidor tipado e o tira da lista dos ausentes. Ela também tira a cópia escrita à mão da
versão que o `Platform` tinha.

Ela não muda o host, o SDK, o código nativo, o mapa, o catálogo de fixtures nem o manifesto 0.5, e não fecha checkpoint nenhum: o
`contract` do GF-03 continua aberto (falta o D20).

## O que mudou

| Arquivo | Mudança |
| --- | --- |
| `src/react-native-platform.jsx` | `export { default as ReactNativeVersion } from "react-native/Libraries/Core/ReactNativeVersion";`, a reexportação por caminho profundo que a fachada já faz com `Easing`, `PanResponder` e outros. Sem wrapper |
| `src/platform.js` | importa a mesma classe e monta `constants.reactNativeVersion` com o `major`, o `minor` e o `patch` dela. Os literais `0, 87, 1` somem |
| `types/react-native.ts` | `export declare const ReactNativeVersion: typeof RN.ReactNativeVersion;` |
| `tests/types/consumer.tsx` | importa o nome e o usa: `getVersionString()` como `string`, `major` como `number`, `prerelease` como `string \| null`, a comparação com o `minor` do `Platform`, e um `@ts-expect-error` que mostra o tipo agindo (`ReactNativeVersion.major` não cabe em `string`) |
| `tests/root-names.test.mjs` | `ReactNativeVersion` sai de `MISSING` (24 → 23) |
| `tests/react-native-version.test.mjs` | novo, no `npm run test:contracts`: a prova de execução |
| `docs/API.md`, `docs/compatibility/BASELINE.md` | a frase do `ReactNativeVersion` e a contagem nova (58 exportados, 3 placeholders, 36 ausentes) |

## A fonte única da versão

O RN 0.87.1 escreve a versão num só lugar, `node_modules/react-native/Libraries/Core/ReactNativeVersion.js`, gerado pelo script de
release do RN: uma classe com as estáticas `major`, `minor`, `patch`, `prerelease` e `getVersionString()`. Até esta fatia o
`Platform` repetia `{ major: 0, minor: 87, patch: 1 }` à mão. Agora a fachada e o `Platform` leem a mesma classe, e uma troca de
versão do `react-native` muda os dois juntos, sem editar o `src/platform.js`.

O formato do objeto do `Platform` **não muda**: `major`, `minor` e `patch`, sem `prerelease`. É o formato que o manifesto 0.5
(`docs/compatibility/scope-0.5.json`) fixa e que `tests/scope-0.5.test.mjs` confere, e ambos passam sem edição. Os
`Platform.ios.js` e `Platform.android.js` do RN declaram `reactNativeVersion` também com `prerelease: ?string`; acrescentá-lo ao
`Platform.constants` daqui é uma mudança do contrato 0.5, fora desta fatia, e fica como leitura registrada neste registro.

## A prova de execução e o tipo

`tests/react-native-version.test.mjs` empacota com esbuild, com o `platformPlugin` do SDK como os outros testes de JS fazem, e roda
o pacote num `vm`:

- o `ReactNativeVersion` que a fachada exporta é **o mesmo objeto** que `react-native/Libraries/Core/ReactNativeVersion` no mesmo
  pacote (`assert.equal`), então não há wrapper nem cópia;
- `getVersionString()` é igual à versão que o `package.json` do `react-native` instalado declara, lida do pacote, sem a versão
  escrita no teste, e `major`, `minor` e `patch` são os dela;
- `Platform.constants.reactNativeVersion` tem `major`, `minor` e `patch` iguais aos mesmos, e as chaves são só essas três;
- a fonte é uma só: com um `ReactNativeVersion` de substituição (7.8.9) no lugar do arquivo do RN, a fachada exporta a
  substituição e o `Platform.constants` passa a trazer 7, 8 e 9. Uma cópia à mão no `src/platform.js` falha este caso.

**O que o teste não roda.** A fachada inteira só inicia sobre os bindings de Hermes e de Fabric do host nativo (`src/initialize.js`
recusa iniciar sem eles), então um teste de Node não a executa. O teste empacota a fachada pelo mesmo caminho de resolução do SDK
(`react-native` → `src/react-native-platform.jsx`), mas troca o conteúdo desse arquivo, no pacote, pelas suas próprias
instruções `export` dos nomes `ReactNativeVersion` e `Platform`, lidas do arquivo com o analisador do `typescript`. As
instruções são as da fachada: trocar o `export { default as ReactNativeVersion }` por um wrapper ou por outro membro do módulo
(`version`, por exemplo) quebra o primeiro caso. O que a fachada faz com o resto do arquivo não entra na prova, e a execução no
host Godot não foi feita: esta fatia é só de Node.

O tipo é `typeof RN.ReactNativeVersion`, o do RN: a classe com as estáticas. `npm run type-check` verifica o consumidor, e o
`@ts-expect-error` de lá falha se o tipo deixar de recusar `major` como `string`. A declaração é de valor (`typeof RN.X`), como a de
`PanResponder` e `PixelRatio`; ela não exporta o nome como tipo de instância, que a classe, só com estáticas, não usa.

## A contagem

| Medida | Antes (fatia A) | Agora |
| --- | --- | --- |
| `npm run parity:status`: exportados / placeholders / ausentes (97 valores) | 57 / 3 / 37 | **58 / 3 / 36** |
| nomes `1_0` ausentes (`MISSING` em `tests/root-names.test.mjs`) | 24 | **23** |
| nomes que o consumidor tipado importa e usa | 60 | **61** |

Os 36 ausentes são os 23 abaixo mais os 13 do `post_1_0` (todos do GF-40). Os 23 ausentes `1_0` são `Alert`, `BackHandler`,
`DevMenu`, `DevSettings`, `DeviceEventEmitter`, `DeviceInfo`, `EventEmitter`, `Keyboard`, `LogBox`, `NativeAppEventEmitter`,
`NativeComponentRegistry`, `Networking`, `PlatformColor`, `Settings`, `Share`, `Systrace`, `UTFSequence`, `processColor`,
`registerCallableModule`, `requireNativeComponent`, `unstable_batchedUpdates`, `useAnimatedColor` e `usePressability`. Nenhum teste
fixava 57/3/37: só a frase datada de `docs/compatibility/BASELINE.md` mudou.

## O que não muda

- O formato do `Platform.constants`: `major`, `minor` e `patch`, sem `prerelease`, e o manifesto 0.5 com os seus testes.
- Os 23 ausentes dos outros GFs: continuam sem implementação e sem tipo, e o censo continua fixando a lista.
- A certificação diferencial: o nome roda e tem tipo, mas os casos positivos e negativos contra o RN são o checkpoint `parity`, que
  continua aberto. O catálogo de fixtures (`fixture-catalog-0.87.1.json`) e o mapa de contratos não foram editados, e as linhas
  `ReactNativeVersion` do ledger pendente do GF-03 seguem pendentes.
- O D20 (resolução de módulos e identidade única de React): o `contract` do GF-03 continua aberto até ele.
- O painel: nenhum checkpoint muda.

## Como reproduzir

```sh
npm run type-check
node --test tests/root-names.test.mjs tests/react-native-version.test.mjs
node --test tests/scope-0.5.test.mjs
npm run parity:status
```

`parity:status` imprime `exported_unverified` 58, `explicit_placeholder` 3 e `missing` 36. Devolver os literais `0, 87, 1` ao
`src/platform.js` faz o último caso do teste novo falhar, e tirar o nome da fachada faz o censo e o type-check falharem.
