# NativeWind e Chart Kit num consumer independente, construído só pelo SDK público

Esta fatia é a primeira verificada do GF-27. Um projeto Godot que não importa nada de `src/` nem de `examples/`, com
`package.json` e `package-lock.json` próprios, usa o NativeWind 4.2.7 (`className` em `View`, `Text`, `Image` e
`Pressable`, `active:`, modo escuro manual por `Appearance.setColorScheme`, estado retido) e o `LineChart` do
`react-native-chart-kit/v2` 7.0.4, e o construtor do SDK o compila, confere os tipos, empacota e roda no Godot. Antes,
os dois só rodavam pelo empacotador do laboratório (`scripts/bundle.mjs`); um consumer que importasse o NativeWind
falhava em quatro pontos do construtor ([pesquisa](../../research/library-consumer.md)). O [recibo](report.json) fixa
fontes, hashes e resultados, executados na árvore de
[`fc0f428`](https://github.com/journey-studios/godot-fabric/commit/fc0f4280c43e01d26d6fc9374e922fa449b88c5e), que era
limpa: o manifesto do SDK provisionado registra `sourceCommit` `fc0f428` e `sourceDirty: false`.

| Lane executada | Checks | Observação |
| --- | ---: | --- |
| JS, no job `contracts` (ubuntu): `node --test tests/library-consumer.test.mjs` | 13 testes | Instala o lock do consumer do registro, confere versões, constrói pelo SDK relocalizado e roda as recusas e a sabotagem retida; 64 s |
| Nativa headless: `npm run test:consumer:libraries` | 19 de build e instalação + 46 nativos | O mesmo consumer provisionado, instalado com o Node privado, construído pelo plugin do editor e executado em Godot headless |
| Nativa com o renderizador: `npm run test:consumer:libraries -- --capture` | 58 nativos | Os 46 mais 12 da captura (repouso, arquivo salvo e pixel da cor da classe, em 4 quadros) |
| Consumer minimal: `npm run test:consumer -- --capture` | 30 de build + 40 nativos (+3 com o renderizador) | Continua passando com o harness compartilhado e o construtor novo |
| Controle no SDK de `9c5d0eb` (main antes da fatia) | 2 recusas | O consumer reduzido (só importa `nativewind`) falha em `react-native-safe-area-context`; o completo, em `E_ADAPTER_SELECTION` |
| Sabotagem retida: sem a regra de peer opcional | 1 recusa | Falha exatamente no `react-native-safe-area-context`, e o bundle anterior fica intacto |
| Laboratório: `npm run test:examples` (35 exemplos; `chart` 34, `nativewind` 49 e `typography` 50 checks headless), `npm run test:typography` | todos | `build/app.js`, `nativewind-compiled.json` e `nativewind-compiled.js` têm os mesmos SHA-256 de antes da fatia |

```sh
npm run test:consumer:libraries -- --capture --control-ref 9c5d0eb
node --test tests/library-consumer.test.mjs
```

> Nota posterior (2026-10-08): esta página, as contagens e o [recibo](report.json) descrevem a execução em
> [`fc0f428`](https://github.com/journey-studios/godot-fabric/commit/fc0f4280c43e01d26d6fc9374e922fa449b88c5e). Depois
> dos merges da `main` (#67 e #68) e da revisão do PR #69, o commit
> [`91c545d`](https://github.com/journey-studios/godot-fabric/commit/91c545d765e570809c7fbf3211ce9988574ff9d4) acolheu uma
> observação do CodeRabbit (CWE-22) sobre o `godotFabric.tailwind.content` e mudou 4 arquivos
> (`sdk/toolchain/tailwind-plugin.mjs`, `tests/library-consumer.test.mjs`, `sdk/README.md` e
> `consumers/libraries/README.md`). A validação separava cada glob em segmentos, então `{..,ui}/**/*.tsx` passava e
> expandia para fora do projeto, e um link simbólico dentro do projeto podia levar o Tailwind a ler arquivos de fora.
> Agora o SDK expande os globs ele mesmo, com o fast-glob do Tailwind, no projeto (chaves continuam permitidas, como em
> `./ui/**/*.{ts,tsx}`); recusa `..`, caminho absoluto e `~` em qualquer alternativa, inclusive dentro de chaves; falha
> com `E_PROJECT_TAILWIND` nomeando o link simbólico, de arquivo ou de diretório, cujo caminho real sai do projeto; e
> entrega ao Tailwind o texto dos arquivos achados, não os globs, de modo que nada fora do projeto é lido. O bloco `styles`
> do `build-report.json` ganhou `contentFiles` (4). A lane JS passou de 13 para 15 testes, e a lane nativa repetiu os
> mesmos 19 + 46 e 58 checks, com os mesmos nomes. O bundle (`10ec3baa…`; o `7bd32171…` do corpo mudou porque o #67
> alterou `src/base-view-config.js` e `src/react-native-platform.jsx`), os estilos compilados (`212765e0…`) e as quatro
> capturas não mudaram com a correção: o mesmo código construído com o plugin anterior dá o mesmo bundle. O `postReview`
> do recibo guarda os SHA-256 dos 4 arquivos nos dois lados, as lanes reexecutadas, a causa e o que mudou.

## O que o consumer instala

O lock é do próprio projeto (`consumers/libraries/package-lock.json`, SHA-256 `3aea116d…`, 112 pacotes instalados,
`npm ci --ignore-scripts` com o Node privado do SDK e `legacy-peer-deps` no `.npmrc`). A suíte confere, pacote a
pacote, que a versão instalada é a que o lock registra, e que `react`, `react-native`, `react-native-reanimated` e
`react-native-safe-area-context` não estão em `node_modules`: o SDK é dono dos dois primeiros e põe um facade nos
outros dois.

| Pacote | Instalado = lock | O SDK compila com |
| --- | --- | --- |
| `nativewind` | 4.2.7 | 4.2.7 |
| `react-native-css-interop` | 0.2.7 | 0.2.7 |
| `tailwindcss` | 3.4.17 | 3.4.17 |
| `react-native-chart-kit` | 7.0.4 | n/a |
| `react-native-svg` | 15.15.5 | n/a (nenhum arquivo dele entra no bundle; o facade `src/svg.jsx` o substitui) |

O nativewind e o css-interop instalados precisam ser exatamente os do SDK, porque o SDK compila os estilos e o
runtime do projeto os lê (`E_PROJECT_NATIVEWIND_VERSION`). O bundle tem SHA-256 `7bd32171…` e 1 423 822 bytes; o mesmo
bundle saiu das duas execuções com captura, do build offline e da recuperação. O `build-report.json` registra o passo de
estilo: entrada `global.css`, 55 regras compiladas (`212765e0…`), rem 14, pipeline nativo (`NATIVEWIND_OS=godot`).

## O que o construtor passou a fazer

- **Peer opcional.** Um peer que um pacote declara só em `peerDependenciesMeta` com `optional: true` conta como
  declarado. O css-interop faz isso com `react-native-safe-area-context`; sem instalá-lo, o import vira o facade do SDK,
  que falha onde o peer é usado.
- **CSS do Tailwind.** Um import de CSS do projeto com as diretivas `@tailwind` é compilado pelo Tailwind, pelo preset do
  NativeWind e pelo compilador do css-interop do próprio SDK, e vira um módulo que registra os estilos no único runtime
  de interop do bundle. Qualquer outro CSS (`@import`, CSS simples, CSS de pacote) falha com `E_PROJECT_CSS`, e o esbuild
  continua recusando qualquer outra saída de asset ou CSS. O laboratório e o SDK usam uma só implementação
  (`sdk/toolchain/nativewind-compile.mjs`).
- **Tailwind declarativo.** O projeto declara `godotFabric.tailwind` no `package.json` (`content`, `darkMode`, `theme`);
  o SDK monta a configuração em processo com `nativewind/preset` e nunca executa um `tailwind.config.*`, que falha com
  `E_PROJECT_TAILWIND_CONFIG` nomeando o campo.
- **`doctor.native.js`.** O único arquivo do css-interop com JSX num `.js` é carregado pelo carregador JSX do esbuild
  por uma regra explícita e estreita (pacote `react-native-css-interop` na versão do SDK); JSX em outro `.js` continua
  recusado.
- **Tipos de `className`.** `className` é erro de tipo até o projeto listar `addons/godot_fabric/types/nativewind.ts` no
  `include` do tsconfig; então existe em `View`, `Text`, `Image` e `Pressable`, e em nenhum outro componente. O SDK passou
  `ViewProps`, `TextProps` e `ImageProps` a interfaces, e declarou `Pressable` e `useWindowDimensions`.

## O que a suíte executa

**Lane JS.** O teste instala o lock, confere as versões e constrói o consumer pelo SDK relocalizado (sem Node global, com
`PATH` vazio). Confere os inputs do bundle (só `ui/`, `global.css`, pacotes instalados e fontes do próprio SDK; nenhum
`examples/`, nenhum `src/` do projeto, nenhum `runtime/web` do css-interop, nenhum arquivo do react-native-svg
upstream, o `sdk/src/svg.jsx` presente), o bloco `styles` do `build-report.json`, que os estilos compilados registram uma
vez e respondem a cada classe do consumer (`dark:` vira regra de media query, `active:` marca `active`), que o mesmo
input dá o mesmo bundle, e as recusas:

| Recusa | Diagnóstico |
| --- | --- |
| Sem a regra de peer opcional (sabotagem retida) | `E_PROJECT_DEPENDENCY: react-native-safe-area-context: undeclared import in react-native-css-interop dependencies` |
| `tailwind.config.js` no projeto | `E_PROJECT_TAILWIND_CONFIG`, citando `godotFabric.tailwind` |
| CSS simples, ou `@import` na entrada do Tailwind | `E_PROJECT_CSS` |
| Declaração ausente, com campo `plugins`, ou com glob que sai do projeto | `E_PROJECT_TAILWIND` |
| css-interop 0.2.6 instalado | `E_PROJECT_NATIVEWIND_VERSION` |
| `className` sem o opt-in, e em `TextInput`, `Switch`, `ActivityIndicator` e `Button` mesmo com ele | `TypeScript failed`, citando `className` |

Cada recusa mantém os bytes do bundle anterior, e o consumer volta a construir o mesmo bundle depois delas.

**Lane nativa.** O harness (`scripts/consumer-libraries-check.mjs`) provisiona o template, confere que o Node global não
existe no ambiente, instala o lock com o Node privado, constrói pelo plugin do editor (o lock não muda), roda o consumer
e reconstrói com a rede negada pelo `sandbox-exec` (mesmo bundle). A cena (`validation.gd`) usa eventos reais de ponteiro
e espera estados, nunca um número de quadros: nó, cor, contador do React, com prazo de 10 s e um watchdog de 120 s.
Os 46 checks nativos cobrem:

- **`className`** em cores, espaçamento (`p-4`, `gap-3`, rem 14), bordas e raio do `StyleBoxFlat`, tipografia
  (`text-2xl font-semibold` chega como tamanho 21, peso 600 e altura de linha 28) e a `Image` (49 por 49, recorte
  arredondado de raio 7, asset do `require` copiado ao lado do bundle);
- **`active:`** no `Pressable`: a cor muda durante o toque, antes do `onPress`, e volta ao soltar;
- **estado retido**: trocar a `className` e trocar o tema mantêm o contador, o estado do subtree e o mesmo Control nativo
  (mesmo `id`); desmontar e remontar o subtree restaura os estilos escuros em Controls novos, com estado novo;
- **modo escuro manual**: `Appearance.setColorScheme('light' | 'dark')` com variantes `dark:`; a cena fixa `light`
  antes de afirmar, porque o host headed alimenta `Appearance` com o tema do sistema operacional;
- **Chart Kit v2**: uma superfície SVG nativa com pixels pintados, texto nativo dos eixos, camadas ordenadas, o
  gradiente da área, o caminho da linha e oito marcadores; uma atualização de estado muda a geometria que o Godot pinta e
  reaproveita a superfície;
- **falha explícita**: `animate-spin` falha no facade do Reanimated, o React captura e a árvore se recupera;
- **limpeza**: desmontar remove todos os Controls, cada efeito do React limpa uma vez, e o fim não deixa tags, raízes,
  timers nem quadros de animação.

Os 12 checks a mais do renderizador esperam todo `Pressable` voltar ao repouso (o Pressability segura um toque solto pelo
tempo mínimo), salvam o PNG e amostram o pixel do cartão contra a cor da classe compilada.

## Controle causal

O mesmo consumer, na SDK de `9c5d0eb`, foi rejeitado nos dois pontos que a fatia conserta:

- o consumer reduzido (um `ui/index.tsx` que só importa `nativewind`, sem CSS nem declaração) falha com
  `E_PROJECT_DEPENDENCY: react-native-safe-area-context: undeclared import in react-native-css-interop dependencies`;
- o consumer completo falha antes, com `E_ADAPTER_SELECTION: godotFabric requires exactly an adapters array`: aquele SDK
  não conhece o campo `tailwind`.

Na SDK nova, o reduzido constrói (o import raiz carrega o `doctor.native.js` pela regra estreita, sem CSS), e o completo
roda. Os dois logs ficam em `build/consumer-libraries/`.

## Gates

Na árvore da implementação mais estes documentos, ainda sem commit, passam `npm run type-check`, `npm run test:contracts`
(7, 43 e 319 testes Node e 13 do Python, com o `library-consumer.test.mjs`, o `project-resolution.test.mjs` e o bundle do
laboratório), `npm run check:static` (sem achados), `npm run check:publication` (1 498 arquivos) e `npm run test:dashboard`
(43 testes). O `adapter-runtime-check`, que provisiona um consumer pelo construtor com adapters selecionados, passa (35
checks headless) sobre um SDK nativo reempacotado do `.deps/build`.

Uma execução com o renderizador do consumer minimal (`local-alias-graphical`) estourou os 180 s na primeira vez que
`npm run test:consumer -- --capture` rodou nesta máquina sob carga; a reexecução passou os 30 e os 40 checks. A causa não
foi encontrada, e a lane dos libraries não estourou em nenhuma execução.

## Capturas

Quatro leituras reais do renderizador nativo do consumer, de 1120 por 680. Não há garantia de estabilidade byte a byte
entre execuções: antes de a cena esperar o repouso dos Pressables, duas execuções deram SHA-256 diferentes para o mesmo
quadro, e as duas seguintes coincidiram. O [recibo](report.json) fixa o SHA-256 dos arquivos desta execução.

![Tema claro: cartão `bg-indigo-600`, Count 0, gráfico claro](libraries-light.png)

O primeiro quadro, com o tema claro fixado: raiz `bg-slate-100`, cartão `bg-indigo-600 border-indigo-300 rounded-xl` com a
`Image` de cantos arredondados, botões `bg-slate-700` e o gráfico no painel branco.

![Duas contagens e uma troca de classe: cartão em `bg-brand-600`](libraries-accent.png)

Depois de dois cliques e de um clique no subtree, a troca de `className` pinta o cartão com a cor `brand` que o projeto
declara em `godotFabric.tailwind`; `Count: 2` e `Local: 1` seguem os mesmos.

![Tema escuro: raiz slate-900, painéis slate-800, gráfico escuro](libraries-dark.png)

`Appearance.setColorScheme('dark')`: a raiz vai a `bg-slate-900`, o subtree e o painel do gráfico a `dark:bg-slate-800`, o
título a `dark:text-white` e o gráfico ao tema escuro; o cartão voltou às classes iniciais e os contadores seguem.

![Subtree remontado e dados atualizados: Local 0 e gráfico novo](libraries-chart.png)

Depois de desmontar e remontar o subtree (`Local: 0`, estilos escuros restaurados em Controls novos) e de atualizar os
dados (o ponto D4 sobe a 100, e a linha e a área mudam), com a mesma superfície SVG.

## O que fica suportado, e o que não

Suportado e executado: `className` em `View`, `Text`, `Image` e `Pressable` (cores, espaçamento, bordas, raio,
tipografia que o host aceita, `active:`), o modo escuro manual com `dark:`, estado e Controls retidos numa troca de
classe, numa troca de tema e numa remontagem de subtree, e o `LineChart` do Chart Kit v2 pelo adaptador SVG, com a
configuração do Tailwind declarativa e o rem 14 do NativeWind. As versões exatas estão na tabela acima.

Abertos para o GF-27 (a fatia não os fecha, e nenhum checkpoint além do da primeira fatia muda):

- `className` em `TextInput` (GF-12), em `Switch`, nas listas e nos demais componentes;
- seguir o tema do sistema (só o override manual é certificado), `fontScale`, `rem` e `PixelRatio`, e `darkMode: "class"`;
- a expansão do adaptador SVG (transform, opacidade de grupo, peso 700 e 800 de fonte, Polygon, Polyline, a API v1 raiz)
  e qualquer mudança em `native/svg_node.*`;
- os outros gráficos do Chart Kit e o contrato escrito dos gráficos;
- as portas de Reanimated, Gesture Handler, safe-area e screens (P2);
- outras plataformas além de macOS arm64, e a CI hospedada desta fatia (pendente);
- a divisão entre o preset web do laboratório e o preset nativo do SDK: o laboratório compila com a variante web do
  preset do NativeWind (o CLI herdava um ambiente sem `NATIVEWIND_OS`), e o SDK, com a nativa; unificar mudaria a
  evidência do laboratório;
- as strings de versão duplicadas entre os manifestos e a documentação.

O [guia do SDK](../../../sdk/README.md#libraries-nativewind-and-chart-kit) descreve o contrato; o
[consumer](../../../consumers/libraries/README.md) é o template executado.
