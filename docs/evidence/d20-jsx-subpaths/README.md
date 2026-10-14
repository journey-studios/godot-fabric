# GF-03, fatia B do `contract` (D20): identidade dos runtimes JSX, subpaths de `exports` e arquivos concorrentes

O V2-D20 (`docs/ARCHITECTURE_V2_DECISIONS.md`, "### V2-D20") pede fixtures que provem resolução e identidade única de React, com
ordem de condições invertida, import/require, arquivos concorrentes e React duplicado, e pede proteger `react/jsx-runtime`, o
dev runtime e os subpaths pertinentes. Antes desta fatia estavam provados a ordem de chaves e o target exato de `exports`/`imports`
contra o Metro 0.87.1, import/require e o React duplicado só para o `react` nu. Esta fatia acrescenta:

- a identidade do `react/jsx-runtime` para o app e para uma lib pré-compilada;
- a recusa do runtime JSX de desenvolvimento, que o build de produção aceitava em silêncio e que quebrava ao renderizar;
- os subpaths e os padrões de `exports`, e os arquivos concorrentes de um pacote sem `exports`, contra o Metro 0.87.1, com as
  diferenças fixadas pelo nome.

Ela muda uma regra do SDK (a recusa do dev runtime, em `sdk/toolchain/project-resolution.mjs`) e nada mais da produção. O D20 continua
**Pendente** em `docs/ARCHITECTURE_V2*.md`, porque as escolhas de política abaixo são do usuário, e o `contract` do GF-03 continua aberto.

## O que o D20 pede e o que a fatia prova

| Pedido do D20 | Estado | Prova |
| --- | --- | --- |
| Ordem de condições invertida | provado | `exports`/`imports` exatos (já existia) e, agora, subpaths exatos e padrões com as chaves invertidas (`default` primeiro), em `import` e `require` |
| import/require | provado | todas as linhas rodam nos dois modos; as de arquivos fora de `exports` não dependem do modo |
| Arquivos concorrentes | parcialmente provado | pacote sem `exports`: 15 casos que concordam com o Metro e 3 diferenças fixadas (A, B e C abaixo), mais a ordem completa dos arquivos do pacote e do projeto |
| React duplicado | parcialmente provado | `react` nu (já existia) e `react/jsx-runtime` (agora). Os outros `react/*` (por exemplo `react/compiler-runtime`) passam pela mesma regra do SDK, mas não têm fixture |
| Proteger `react/jsx-runtime` | provado | um só módulo, o do SDK, para o app e para a lib, com um `jsx-runtime.js` falso aninhado que nunca entra no bundle |
| Proteger o dev runtime | provado | `react/jsx-dev-runtime` é recusado com `E_PROJECT_JSX_DEV_RUNTIME` para o app, para uma lib e para o `jsx: "react-jsxdev"` |
| Subpaths pertinentes | parcialmente provado | os subpaths de `react` são do SDK; os de pacotes instalados estão na tabela abaixo |
| Nome e conjunto das condições do host | pendente | decisão do usuário (`godot` x `godot-fabric`, `react-native` implícita) |
| Resolução fora de `exports` além de `main` | pendente | as diferenças A, B e C |
| Qual lado vale em cada diferença com o Metro | pendente | decisão do usuário |
| Workspaces | pendente | dependem do D19 |
| Política de peers | pendente | decisão do usuário |

## O bug do dev runtime

O build do consumidor (`sdk/toolchain/build.mjs`) usa `define: { "process.env.NODE_ENV": '"production"', __DEV__: "false" }`.
O `project-config.mjs` aceita `jsx: "react-jsxdev"`, e com `NODE_ENV=production` o `react/jsx-dev-runtime` carrega
`cjs/react-jsx-dev-runtime.production.js`, que exporta `jsxDEV = void 0`. O teste `the premise holds` executa esse arquivo do React
19.2.3 e prova que `jsxDEV` existe como chave e vale `undefined`.

Reproduzido antes da correção, com fixtures equivalentes às dos testes novos (o `bundle` e o projeto temporário de
`tests/project-fixtures.mjs`): os dois casos **compilam** e quebram ao executar o bundle.

| Caso | Resultado antes |
| --- | --- |
| tsconfig com `jsx: "react-jsxdev"` e um `<div>` no entry | o build termina e o bundle lança `TypeError: (0 , import_jsx_dev_runtime.jsxDEV) is not a function` |
| lib instalada pré-compilada que faz `var r = require("react/jsx-dev-runtime")` e chama `r.jsxDEV(...)` ao carregar | o build termina e o bundle lança `TypeError: r.jsxDEV is not a function` |

É um aceite silencioso, o contrário do que o GF-03 e o GF-04 pedem. A correção é uma regra só, no `onResolve` do plugin do
projeto (`sdk/toolchain/project-resolution.mjs`), logo depois de deixar passar os importadores de dentro do SDK:

```js
if (args.path === devJsxRuntime) {
  fail("E_PROJECT_JSX_DEV_RUNTIME", `${devJsxRuntime} does not work in this build: it is production-only (NODE_ENV=production leaves jsxDEV undefined). `
    + `Use "jsx": "react-jsx" in tsconfig.json; a library that imports ${devJsxRuntime} was compiled in development mode`);
}
```

Depois da correção, nos dois casos o build falha com `E_PROJECT_JSX_DEV_RUNTIME: react/jsx-dev-runtime does not work in this build: it is
production-only (NODE_ENV=production leaves jsxDEV undefined). Use "jsx": "react-jsx" in tsconfig.json; a library that imports
react/jsx-dev-runtime was compiled in development mode`.

- **Por que na resolução e num lugar só.** O esbuild resolve pelos plugins o import que o `jsx: "react-jsxdev"` injeta, então a mesma
  regra cobre o tsconfig, o app e uma lib. `project-config.mjs` não ganhou checagem: o teste `jsx react-jsxdev passes the config and is
  refused by the resolution at the build` prova que o `prepare` aceita `react-jsxdev` e que quem recusa é o build.
- **Por que no plugin do projeto e não no do SDK.** A resolução que leva `react/*` ao SDK (`platform-plugin.mjs`) também serve o
  laboratório e os importadores internos do SDK, que não são código do projeto. O plugin do projeto é onde o SDK já classifica o que
  vem do app e das libs instaladas; os importadores de dentro do SDK saem antes da regra.
- **O que não muda.** Nenhum consumidor, exemplo, fixture ou teste do repositório usa `react-jsxdev` ou importa
  `react/jsx-dev-runtime` (conferido por `grep`); os `tsconfig` do repositório usam `react-jsx`.

## A identidade do `react/jsx-runtime`

`tests/react-jsx-identity.test.mjs` monta um projeto com `jsx: "react-jsx"`, um componente TSX do app e uma lib instalada
pré-compilada em CommonJS (`require("react/jsx-runtime")`, como o Babel a emite). A lib traz um `node_modules/react/jsx-runtime.js`
falso aninhado, que lança ao ser avaliado. Ao executar o bundle:

- `jsx`, `jsxs` e `Fragment` que o app e a lib usam são os mesmos objetos (`===`), e `Fragment` é `Symbol.for("react.fragment")`;
- o único `jsx-runtime.js` em `metafile.inputs` é o do SDK, com o `cjs/react-jsx-runtime.production.js`; o falso não aparece;
- o elemento renderiza: o teste expande os componentes até restarem elementos de host e fragmentos (`$$typeof` de React 19) e compara a
  árvore;
- sem os plugins do SDK o esbuild escolheria o falso (verificado à parte: `Nested jsx-runtime spoof was evaluated`), então o teste
  tem poder de falhar.

Os outros casos do arquivo: o runtime de produção continua compilando e renderizando num app sem lib; o app que importa
`react/jsx-dev-runtime` por nome é recusado, e a lib compilada em modo de desenvolvimento também.

## Subpaths e padrões de `exports`: o que concorda com o Metro 0.87.1

`tests/package-conditions.test.mjs`, contra o `metro-resolver` real (o mesmo oráculo das fatias anteriores), em `import` e `require`,
com as condições `[]` e `["godot"]`. Cada linha confere o arquivo do Metro, o arquivo do bundle do SDK e que mais nada do pacote entra
no bundle.

| Linha | Concorda |
| --- | --- |
| subpath exato (`./feature`) com `godot`, `import`, `require` e `default` | sim |
| o mesmo com as chaves invertidas (`default` primeiro): vale `default` | sim |
| o mesmo com condições aninhadas (`import: { godot, default }`) | sim |
| padrão `./features/*` simples (`./lib/*.js`) | sim |
| padrão com condições (`godot`, `import`, `require`, `default`) | sim |
| padrão com as chaves invertidas | sim |
| padrão com condições aninhadas | sim |
| subpath exato mais específico que o padrão | sim |
| array cujo primeiro item é uma string válida (subpath e padrão) | sim |
| array cujo primeiro item é um objeto de condição que o host satisfaz | sim, com `["godot"]` |
| subpath que o `null` do padrão exclui | os dois rejeitam |
| subpath que o mapa de `exports` não declara | os dois rejeitam |
| array cujo primeiro item é um arquivo ausente | os dois rejeitam: nenhum pula o arquivo ausente |

Nada fora do mapa é alcançável nos dois lados, e nenhum cai para o `main`.

## Arquivos concorrentes fora de `exports`: o que concorda

Pacote instalado **sem** `exports`, com `main` e subpaths, importado por subpath e, onde indicado, por import relativo escrito dentro
do pacote (15 casos). O Metro roda com a plataforma `godot` e `preferNativePlatform`; o bundle do SDK com `.godot`, `.native` e liso.

| Caso | Arquivo escolhido pelos dois |
| --- | --- |
| `x.godot.js`, `x.native.js` e `x.js` | `x.godot.js` |
| `x.native.js` e `x.js` | `x.native.js` |
| `x.js` sozinho | `x.js` |
| `x.godot.js` e `x.js` | `x.godot.js` |
| extensão explícita (`conditional/x.js`) com `x.godot.js` ao lado | `x.js`, o arquivo exato |
| `x.json` e `x.godot.js` | `x.godot.js` |
| `x.godot.jsx` e `x.js` | `x.js` |
| `x.godot.json` e `x.js` | `x.js` |
| subpath aninhado, índice de diretório, `main` de `package.json` de diretório | a variante `godot` |
| `main` sem extensão (`./lib/entry`) | `lib/entry.godot.js` |
| `main` com extensão (`./lib/entry.js`) | `lib/entry.js`, o arquivo exato |
| `./x` relativo dentro do pacote (com `godot`+`native`+liso, e com `native`+liso) | `x.godot.js` e `x.native.js` |

Os arquivos que não são o escolhido não entram no bundle. A ordem **dos arquivos do próprio projeto**, fora de `node_modules`, também
é a do Metro, com uma lacuna (B). O teste `the project's own sources resolve in Metro's order` remove o vencedor e resolve de novo até
nada resolver, e confere a ordem inteira: `x.godot.ts`, `x.native.ts`, `x.ts`, `x.godot.tsx`, `x.native.tsx`, `x.tsx`, `x.godot.js`,
`x.native.js`, `x.js`, `x.godot.jsx`, `x.native.jsx`, `x.jsx`, `x.json`. O Metro tem além disso `x.godot.json` e `x.native.json`
antes de `x.json`.

## As diferenças fixadas

Seis diferenças entre o SDK e o Metro 0.87.1 estão fixadas por teste, cada uma com o nome `declared incompatibility`. As duas primeiras
já existiam (`tests/package-conditions.test.mjs`); as quatro últimas são desta fatia. Nenhuma muda a produção.

| # | Diferença | Metro 0.87.1 | SDK (esbuild 0.25.12) | Classificação |
| --- | --- | --- | --- | --- |
| 1 | alvo exato ausente em `exports` | cai para o `main` (com aviso) | falha | escolha do usuário (já registrada) |
| 2 | alvo externo em `#imports` | rejeita | resolve a dependência declarada | escolha do usuário (já registrada) |
| 3 | array de fallback em `exports` | falha | tenta cada item, como o Node | escolha do usuário |
| A | TypeScript x JavaScript dentro de `node_modules` | tenta TypeScript primeiro | tenta JavaScript primeiro | escolha do usuário |
| B | JSON com sufixo de plataforma | resolve `x.godot.json` e `x.native.json` | não resolve | lacuna provável do SDK, candidata a correção sem escolha de política |
| C | `main` apontando para arquivo ausente | `InvalidPackageError` | cai para o `index.*` da raiz, como o Node | escolha do usuário |

**3. Arrays de fallback.** O Metro lê só `value[0]` de um array no nível do subpath (`flattenLegacySubpathValues`, em
`metro-resolver/src/PackageExportsResolve.js`) e não entende um array dentro de um objeto de condição. O esbuild segue a semântica do
Node e tenta cada item até um alvo ser selecionado. Quatro formas, cada uma em `import` e `require`, divergem: o primeiro item é um objeto
de condição que nada satisfaz (`[{ unknown }, "./present.js"]`); o primeiro item é uma condição que o host não tem
(`[{ godot }, "./present.js"]` com `[]`); o mesmo num padrão (`./features/*`); e um array dentro de uma condição, mesmo com o primeiro
item válido (`{ import: ["./import.js", "./fallback.js"] }`). O Metro falha com `FailedToResolveNameError` e um aviso; o SDK resolve
`present.js`, `lib/alpha.js`, `import.js` e `require.js`. Quando o primeiro item é uma string válida os dois concordam.

**A. Ordem TypeScript e JavaScript em `node_modules`.** O Metro percorre `sourceExts` na ordem `ts`, `tsx`, `js`, `jsx`, `json` e, em
cada extensão, `.godot`, `.native` e liso. O esbuild 0.25.12, dentro de `node_modules`, tenta as extensões JavaScript antes das TypeScript,
apesar de `godotExtensions` listar as TypeScript primeiro (medido pelo teste de ordem completa: `x.godot.js`, `x.native.js`, `x.js`,
`x.godot.jsx`, `x.native.jsx`, `x.jsx`, `x.godot.ts`, ..., `x.tsx`, `x.json`). Só importa para um pacote que traz `.ts` e `.js` do mesmo
módulo: `x.native.ts` com `x.godot.js` dá `x.native.ts` no Metro e `x.godot.js` no SDK; `x.godot.js` com `x.ts` dá `x.ts` no Metro e
`x.godot.js` no SDK. Nos arquivos do projeto, fora de `node_modules`, a ordem é a do Metro.

**B. JSON com sufixo de plataforma.** O Metro tenta `.godot` e `.native` também na extensão `json` (`x.godot.json`, `x.native.json`).
`godotExtensions` (`sdk/toolchain/platform-resolution.mjs`) não tem `.godot.json` nem `.native.json`, então o SDK falha com `Could not
resolve` para um pacote ou um arquivo do projeto que traga só essa variante. É a mesma ordem das outras extensões, faltando duas
entradas na lista: por isso está classificada como lacuna provável e candidata a correção sem escolha de política. Não foi corrigida
nesta fatia, por decisão do líder.

**C. `main` ausente.** Com `main` apontando para um arquivo que não existe, o Metro lança `InvalidPackageError` mesmo havendo
`index.js` na raiz do pacote (ele só tenta o `main` como diretório). O esbuild cai para o `index.godot.js`, `index.native.js` ou
`index.js` da raiz, como o Node.

## O que continua pendente

- O nome e o conjunto das condições do host (`godot` x `godot-fabric`, a `react-native` implícita).
- A resolução fora de `exports` além de `main`, e qual lado vale nas seis diferenças acima (as 1, 2, 3, A e C são escolhas; a B é a
  única candidata a correção sem escolha de política).
- Workspaces, que dependem do D19.
- A política de peers.
- Fixtures para os outros subpaths de `react/*` (por exemplo `react/compiler-runtime`) e de `react-native/*`.

O D20 não fechou.

## O que não muda

- `src/`, `types/`, o host e o código nativo.
- `docs/ARCHITECTURE_V2*.md` e `docs/compatibility/*`.
- A resolução de produção, exceto a recusa do `react/jsx-dev-runtime`. Nenhuma das seis diferenças foi alterada.
- O `contract` do GF-03: continua aberto. Nenhum checkpoint muda.

## Como reproduzir

```sh
node --test tests/react-jsx-identity.test.mjs tests/package-conditions.test.mjs tests/project-resolution.test.mjs
npm run type-check
npm run test:contracts
```

O `package-conditions.test.mjs` imprime o nome de cada diferença (`declared incompatibility: ...`). Para ver o bug do dev runtime
como era, desligue a regra `E_PROJECT_JSX_DEV_RUNTIME` no `onResolve` de `sdk/toolchain/project-resolution.mjs`: os três testes de
recusa de `react-jsx-identity.test.mjs` falham (o do `react-jsxdev` com o `TypeError` da tabela acima; os de import por nome e da lib
com `Missing expected rejection`, porque o bundle é construído e executa sem erro enquanto ninguém chama `jsxDEV`). Foi o que se
verificou ao escrever o teste.
