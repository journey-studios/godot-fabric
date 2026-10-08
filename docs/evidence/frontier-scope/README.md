# Frontier: o escopo de props dos 12 nomes da HUD do 0.5

Esta fatia é o V05-04 do marco 0.5: os componentes, os tipos e as lacunas do SDK para os doze nomes de React Native
que o jogo **Frontier** usa. Em vez de caçar lacunas uma a uma, ela decide **todas** as props que o RN 0.87.1 declara
para os sete componentes entre esses nomes, num manifesto único, e faz o SDK cumprir a decisão do mesmo jeito em toda
montagem e em toda atualização: a prop é suportada, aceita e ignorada com um motivo, ou recusada com um erro que nomeia
a prop. Uma prop que a HUD usar amanhã deixa de ser um acaso: ou está no manifesto com a sua decisão, ou o teste de
deriva falha.

Esta fatia **não tem captura de tela**. Ela não produz saída visual: o que muda é o que o SDK aceita, ignora ou recusa, e
o que o host mostra depois (ou não mostra), lido na árvore de nós e nos Controls do Godot, não em pixels. Nenhum PNG
acompanha este registro, e nenhuma afirmação dele depende de um.

Tudo aqui foi executado **a partir do commit de implementação
[`e33817e`](https://github.com/journey-studios/godot-fabric/commit/e33817e643c65c521d50e589219ff33d8b268643)**
(`e33817e643c65c521d50e589219ff33d8b268643`, árvore `8d0321bd82f485b90155af18b2fb88d4d9b2eade`), que fecha duas
entregas: a primeira,
[`baff002`](https://github.com/journey-studios/godot-fabric/commit/baff0022f0d5352761e854d301f664083ac0f3bc), decide as
props de View, Text, Pressable, Image, Modal e ActivityIndicator; a segunda põe o ScrollView na mesma política, depois do
merge da main
([`6bbd63f`](https://github.com/journey-studios/godot-fabric/commit/6bbd63f4d9ff2cb2cbf67af5e07d538ceb694b5b), que trouxe
o ScrollView original do PR #58 e as regras do jogo do PR #70, a main `e1c7a39`). A árvore estava limpa e igual à do
commit quando cada comando rodou; os arquivos deste registro, o `docs/API.md`, o `docs/PARITY.md`, o `ROADMAP.md` e o
script `scripts/scope-scroll-crash.mjs` foram escritos depois e **não são entrada de nenhuma lane**. Ambiente: macOS
arm64 (26.6.2), Godot oficial **4.7.2** (`ed1daf0bf`), React Native **0.87.1**, Node **v22.23.3**, modo headless. O recibo
[`report.json`](report.json) fixa os SHA-256 das fontes, dos relatórios e do host, e as contagens abaixo.

## O que o manifesto decide

[`docs/compatibility/scope-0.5.json`](../../compatibility/scope-0.5.json) lista **12 nomes**, todos `supported` com um
subconjunto: `View`, `Text`, `Pressable`, `ScrollView`, `Image`, `Modal`, `ActivityIndicator`, `StyleSheet`, `Platform`,
`Dimensions`, `useWindowDimensions` e `AppState`. Cada nome traz a linha da auditoria de 2026-10-01 copiada sem edição
(o arquivo da auditoria não foi tocado) e um indicador `auditStale` onde a linha ficou para trás (Image, Modal,
ActivityIndicator e AppState). `FlatList` e `PixelRatio` ficam fora e dizem por quê; o que o 0.5 deixa de fora (teclado,
imagens de rede, inércia de rolagem, hover público no Pressable, as listas, os outros touchables, Android/Linux/Windows)
está em `outOfScope`. Um nome que não está em `names` nem em `outOfScope` não é usado pela HUD, e acrescentá-lo exige
mudar o manifesto.

Sete desses nomes são componentes, e o manifesto carrega a decisão de **cada uma das 880 props** que o RN declara para
eles: **433 suportadas, 325 ignoradas e 122 recusadas**. A lista das props vem das linhas de dono (`ViewProps`,
`TextProps`, …) de `docs/compatibility/contracts-0.87.1.json`, achatadas pelo verificador de tipos, e a seção
`components` do manifesto é **gerada** por `node scripts/scope-manifest.mjs --write` a partir do módulo da política;
`--check` e o teste da fatia falham se o JSON versionado se afastar do módulo.

| Componente | Props declaradas | Suportadas | Ignoradas | Recusadas |
| --- | ---: | ---: | ---: | ---: |
| View | 114 | 71 | 33 | 10 |
| Text | 72 | 42 | 17 | 13 |
| Pressable | 130 | 82 | 35 | 13 |
| Image | 139 | 86 | 42 | 11 |
| Modal | 129 | 9 | 111 | 9 |
| ActivityIndicator | 118 | 66 | 42 | 10 |
| ScrollView | 178 | 77 | 45 | 56 |
| **Total** | **880** | **433** | **325** | **122** |

O ScrollView ainda tem duas regras de lista (`onRefresh` recusa qualquer valor não nulo e `refreshing` aceita só
`false`): uma lista entrega as duas ao ScrollView, que o RN não declara. Elas são checadas e testadas, mas ficam fora
das 178 props e dos totais acima (por isso o plano nativo tem 58 props recusadas do ScrollView).

## A política

Um só módulo, [`src/prop-scope.mjs`](../../../src/prop-scope.mjs), guarda a tabela de regras de cada componente e **um
só verificador**, `checkProps(componente, props)`, que a fachada de cada componente chama **em toda renderização**, na
montagem e na atualização no lugar. Cada prop declarada é classificada **uma vez**:

- **`supported`**: tem comportamento neste host. `how: host` quando a configuração de view do RN a deixa chegar ao host,
  `how: js` quando a fachada ou o JS original do RN a consome; `via` guarda o nome efetivo.
- **`ignored`**: é aceita e não muda nada, com `basis` (`ios-drops`: o iOS descarta; `ios-noop`; `android-native`;
  `not-forwarded`: o componente original não a repassa; `overwritten`; `dependent`; `decision`: uma decisão anterior
  documentada) e uma fonte.
- **`refused`**: o iOS tem comportamento que o Godot não implementa. A fachada lança
  `Godot <Componente> does not implement <prop>` quando o valor **não é `null` nem `undefined`**, a não ser que o valor
  conste em `accepts`. `accepts` lista os valores que o host cumpre; o primeiro é o que deixa o host como está.

Sem `accepts`, a prop recusa qualquer valor não nulo (os `on*` e as props que o host não honra em nada). Cada regra sem
`accepts` que não é função diz isso no seu `reason`, e um teste confere a fonte do valor de cada entrada que tem
`accepts`. O texto do erro sai de um só ajudante, compartilhado por `checkProps` e por `refusalMessage`.

### A regra única das chaves não declaradas

Uma chave que o RN **não declara** para o componente **nunca é verificada**: a configuração de view do Fabric do RN
descarta todo nome que ela não lista, e o SDK faz o mesmo. Há **duas exceções**:

1. As props do wrapper antigo do Text, `text` e `fontSize` (`legacyProps`): não são props do `Text` do RN, e falham com
   uma dica (`pass the text as children`, `set it in style`), porque o código que as usa estava escrito para o wrapper.
2. O **Pressable**: ele renderiza o Control do host, que lista nomes que só o Control tem, então o próprio Pressable
   descarta as chaves não declaradas (`declaredProps`), mantendo `ref`.

### A regra do default e o desvio documentado do ScrollView

Uma prop recusada **aceita o valor que deixa o host como está**. Onde o iOS não faz nada com o valor, esse é o default do
RN (por exemplo `accessibilityRespondsToUserInteraction: true`, `ellipsizeMode: 'tail'` ou `animationType: 'none'`), e
`defaultSource` cita a linha do RN que o prova. Assim, o código que repassa o default do RN não quebra, e só a escolha de
um comportamento que o host não tem falha.

O **ScrollView desvia** disso, de forma documentada e mantida: as props de comportamento que o ScrollView original do #58
já recusava (`bounces`, `pagingEnabled`, `alwaysBounceVertical`, `snapToOffsets`, `stickyHeaderIndices`, …) aceitam o
**pedido neutro do host** (`false`, `[]`, `"none"`), e não o default do RN (`bounces` vale `true` no iOS, e o host não
quica). `accepts` lista o que o host honra. Esta fatia **não muda esse comportamento**: só o passou de uma lista própria
para a mesma tabela, com a mensagem uniforme `Godot ScrollView does not implement <prop>`.

## O que cada lane verifica

**Lane de JS** (`node --test tests/scope-0.5.test.mjs tests/scroll-view-contract.test.mjs`, 16 testes). Os 13 da
fatia: o manifesto decide exatamente doze nomes, cada um com a linha da auditoria como foi gravada e a sua evidência; cada
prop que o RN declara para os sete componentes é classificada **exatamente uma vez**; cada prop ignorada ou recusada tem
motivo, base e fontes que existem e dizem o que a citação afirma; as props suportadas concordam com as configurações de
view que o host recebe, nos dois sentidos; as decisões de Text e de Image nas tabelas são as que os documentos delas
publicam; o manifesto carrega as tabelas do módulo e mais nada; o verificador recusa pela tabela qualquer valor não nulo e
deixa o resto passar; o valor que o RN dá a cada prop recusada passa, com a fonte do default citada e lida; o Pressable
descarta as chaves não declaradas e mantém `ref`; toda fachada roda a verificação e só o módulo é dono das tabelas; o
wrapper do Modal mantém o que o Modal do RN expõe; os tipos e as tabelas concordam (abaixo); e `Platform`, `Dimensions`,
`useWindowDimensions` e `StyleSheet` têm os membros que o manifesto diz. Mais os 3 do contrato do ScrollView
(`tests/scroll-view-contract.test.mjs`, com a mensagem uniforme e os valores neutros que passam).

**Guarda de tipos** (dentro do teste "os tipos e as tabelas concordam"; `tests/scope-0.5-types.mjs`): gera
`build/scope-0.5-types/fixture.tsx` a partir das tabelas e o confere com `tsc-rs`: **433 casos positivos**, um por prop
suportada; **121 `@ts-expect-error`**, um por prop recusada que os tipos não declaram (as 122 recusadas e as 2 regras de
lista, menos as 3 `typed`); para as `typed`, 5 positivos de valor e 3 negativos. O teste ainda quebra a fixture de
propósito (uma prop recusada sem a diretiva, uma diretiva sobre uma prop suportada) e exige que o `tsc-rs` falhe.

**Lane nativa** (`npm run test:scope-0.5`, `tests/scope-0.5-native.test.mjs`): o host Godot real roda a fixture
`tests/scope-0.5-fixture.jsx`, que renderiza **um caso por vaga**, cada um na sua própria fronteira de erro, ao lado de uma
linha de base do mesmo componente sem a prop. Cada grupo é mostrado duas vezes: **montagem** (`remount`: todas as vagas
são substituídas, então montar é montar) e **atualização no lugar** (os mesmos elementos recebem a prop depois de
montados). A sonda espera por **estado**, nunca por contagem de quadros: o commit do React, o host quieto e as imagens
carregadas. Os grupos de cada componente:

- `refused`: cada prop recusada falha **na sua fronteira, com o erro da tabela, e não monta nada** (o host não vê a view).
- `ignored`: cada prop ignorada deixa o host **exatamente como a linha de base**.
- `default` e `allowed`: o primeiro valor de `accepts` deixa o host como a linha de base (`default`, 150 execuções); os
  outros valores só precisam ser aceitos (`allowed`, 4).
- `legacy` (só o Text): `text` e `fontSize` falham com a dica.
- `undeclared`: chaves que o RN não declara não mudam nada (no Pressable, são descartadas antes do host).
- `controls`: uma prop suportada de cada componente **muda o que o host mostra**, para que um instantâneo igual signifique
  alguma coisa.

Mais a montagem inicial e a limpeza (só a View raiz sobra, o `stop` libera todas as raízes, os Controls nativos
fecham a conta). No total são **181 checks**, todos passando, que julgam 248 execuções de props recusadas, 650 de
ignoradas, 150 de defaults, 4 de aceitas e 124 de chaves não declaradas (cada caso roda na montagem e na atualização).
O **oráculo** (`tests/scope-0.5-oracle.mjs`) foi escrito à parte e recomputa as expectativas **só** a partir do inventário
e do manifesto em JSON, sem importar o módulo da política.

## O controle causal sobre `e1c7a39`

Para provar que os checks medem a política e não o acaso, a **mesma fixture** roda sobre o SDK do commit anterior à
fatia: `git archive e1c7a39 src` extraído em `build/frontier-scope-previous/src`, **no mesmo host nativo** (SHA-256 do
host nos dois relatórios: `81dd6811…4565e`; sem o mesmo host a comparação não vale). A lane `--previous` roda 177 checks
e **22 falham**, exatamente os que o oráculo prevê, e nenhum outro:

| Grupo | Checks que falham | Por quê, sobre a main |
| --- | ---: | --- |
| `refused` de View, Text, Pressable, Image, ActivityIndicator, Modal e ScrollView (montagem e atualização) | 16 | A main aceita sem erro as props que a política recusa (ou o host as descarta em silêncio): a fronteira não falha. O ScrollView tem dois grupos (40 e 18 casos). |
| `default` do Text | 4 | A main recusa `dataDetectorType: 'none'`, `textBreakStrategy: 'highQuality'`, `lineBreakStrategyIOS: 'none'` e `android_hyphenationFrequency: 'none'` mesmo nos defaults; a política os aceita. |
| `undeclared` do Pressable | 2 | A main deixa chaves não declaradas chegarem ao Control do host e mudá-lo; a política as descarta. |

Todo o resto passa nos dois lados (as props ignoradas, as aceitas, as legadas, os controles), o que mostra que o controle
não falha por outro motivo. **Seis props do Modal ficam de fora do controle**: `animationType`, `presentationStyle`,
`statusBarTranslucent`, `navigationBarTranslucent`, `hardwareAccelerated` e `allowSwipeDismissal`. Na main, o próprio host
as recusa **por dentro da montagem** (`native/modal_presentation.cpp`), e a exceção pára a aplicação, de modo que o controle não
consegue conduzi-las; elas continuam no plano de todas as outras lanes. É por isso que o plano `previous` tem 177 checks
(os 181 menos os 4 dos grupos `Modal/refused/1` e `Modal/allowed/0`, que deixam de existir sem essas props).

## As seis sabotagens

`node scripts/scope-sabotage.mjs` (`guardSources`, de `scripts/sabotage-sources.mjs`) troca uma fonte por uma versão
quebrada, roda a lane de JS e a nativa, e **restaura a fonte byte a byte** (os SHA-256 antes e depois são iguais,
inclusive com o processo interrompido). Cada variante tem de ser rejeitada:

| Variante | O que quebra | Nativa | JS |
| --- | --- | :-: | :-: |
| `updates` | A View só verifica a prop na montagem (`useState(() => checkProps(...))`) | rejeita | não rejeita |
| `undeclared` | O Pressable deixa de descartar as chaves não declaradas | rejeita | rejeita |
| `modal` | O Modal deixa de chamar o verificador | rejeita | rejeita |
| `scroll` | O contrato do ScrollView deixa de chamar o verificador | rejeita (o host cai: ver o item aberto 2) | rejeita |
| `defaults` | O verificador deixa de aceitar o primeiro valor de `accepts` (o default) | rejeita | rejeita |
| `reason` | O manifesto perde o motivo de uma regra | rejeita | rejeita |

A `updates` só a lane nativa vê, porque só ela atualiza a mesma view no lugar; é o que a lane existe para provar. O recibo
(`format: godot-fabric.scope-sabotage/v1`, com as fontes, os `find`/`replace`, os SHA-256 e os resultados) está embutido
em [`report.json`](report.json).

## Comandos e resultados

Todos passaram, a partir do commit `e33817e`:

| Comando | Resultado |
| --- | --- |
| `node --test tests/scope-0.5.test.mjs tests/scroll-view-contract.test.mjs` | 16 de 16 |
| `npm run test:scope-0.5` | 1 teste, **181 checks**, todos passando |
| `node tests/scope-0.5-native.test.mjs --previous` | o controle: **22 de 177 checks falham**, os previstos |
| `node scripts/scope-sabotage.mjs` | 6 variantes rejeitadas pela lane nativa; 5 pela de JS; fontes restauradas |
| `npm run type-check`, `npm run check:static` | sem erro; sem achado do fallow |
| `npm run test:scroll-view`, `test:lists`, `test:modal` | 5 de 5; 1 de 1; 7 de 7 |
| `npm run test:examples` | 35 execuções de exemplo, 2.487 checks de aceitação, todos passando |
| `npm run test:consumer`, `test:consumer:libraries` | 30 + 40 checks; 16 + 46 checks |
| `test:touchables`, `test:accessibility`, `test:pointers:click`, `test:responders:pan` | 1 de 1 cada |
| `test:text-original`, `test:text-layout`, `test:text-style`, `test:images`, `test:activity-indicator`, `test:os-contracts` | 1 de 1 cada |
| `test:charts` | 4 de 4 |
| `npm run check:publication`, `check:static`, `test:dashboard`, `test:contracts` | rodados **depois** dos documentos, sobre a árvore que os contém: 1.678 arquivos sem falha; fallow sem achado; 43 de 43; 7 + 43 + 334 testes de Node e 13 de Python (`gates` em [`report.json`](report.json)) |

O que a execução da fatia consertou no caminho está no `report.json` (`firstPassFailures`).

## Divergências registradas

**Props que o próprio RN injeta numa View pública.** `TouchableWithoutFeedback` e `TouchableNativeFeedback` passam
`focusable` e `accessibilityValue` ao filho, e as células do `VirtualizedList` passam `onFocusCapture`. Se a política as
recusasse como o iOS recusaria o que o Godot não implementa, uma lista ou um touchable do próprio RN quebraria o
`test:touchables`, o `test:lists`, o `test:examples` e o `test:os-contracts`. Elas ficam **`ignored` por decisão**,
conforme `docs/research/accessibility.md` ("not mapped yet, dropped"): `accessibilityValue`, `accessibilityViewIsModal`,
`accessibilityLanguage`, `focusable`, `tabIndex`, `aria-value*`, o `aria-modal` do Pressable e `onFocus`, `onBlur`,
`onFocusCapture` e `onBlurCapture`. Nenhuma View deste host recebe o foco do teclado, então nada as emite.

**A mensagem do hover do Pressable mudou.** `onHoverIn` e `onHoverOut` falhavam com
`Godot Pressable hover events are not implemented yet`; agora falham com `Godot Pressable does not implement
onHoverIn/onHoverOut`, a mesma forma de toda recusa. O oráculo guarda o texto antigo (`mainOtherText`) para o controle.
O hover público no Pressable continua fora do 0.5.

**Os defaults de Text que a main recusava.** `dataDetectorType`, `textBreakStrategy`, `lineBreakStrategyIOS` e
`android_hyphenationFrequency` passam a **aceitar o default** (`'none'`, `'highQuality'`, `'none'`, `'none'`), como toda
prop recusada: é a regra do default em ação, e a lane `previous` a mede (4 checks).

**O que muda no ScrollView em relação ao #58.** Os valores que o `unsupportedProps` do #58 aceitava seguem aceitos (o
mesmo valor neutro, comparado com `Object.is`, de modo que as flags aceitam só `false`) e os que ele recusava seguem
recusados. Mudam as mensagens, que passam à forma uniforme (`Godot ScrollView does not implement <prop>`; o
`... refreshControl is not implemented` de `onRefresh` e `refreshing` passa a nomear a prop), e as props que o #58 deixava
passar mas que o iOS trata (`accessibilityIgnoresInvertColors`, `accessibilityShowsLargeContentViewer`,
`accessibilityLargeContentTitle`, `onAccessibilityAction`, `onAccessibilityEscape`, `onMagicTap` e as outras recusas de
View) agora são decididas pela mesma tabela e recusadas fora do default.

## Itens abertos

### 1. As 26 props do ScrollView que recusam até o default do RN (GF-14)

O ScrollView do #58 já recusava, por escolha própria, 26 props que o host não honra em nada; a tabela as mantém sem
`accepts`: elas recusam **todo valor que não seja `null` ou `undefined`**, inclusive o valor que o RN usa quando a prop
falta (`contentInsetAdjustmentBehavior` `'never'`, `decelerationRate` `'normal'`, `directionalLockEnabled` `false`,
`indicatorStyle` `'default'`, `keyboardShouldPersistTaps` `'never'`, `minimumZoomScale`, `maximumZoomScale` e `zoomScale`
`1.0`, `snapToAlignment` `'start'`, `snapToStart` e `snapToEnd` `true`, `scrollsChildToFocus` `true`). Mudar isso é uma
decisão do **GF-14** e **fica fora desta fatia**; a evidência só a registra, com a lista:

`contentInset`, `contentInsetAdjustmentBehavior`, `decelerationRate`, `directionalLockEnabled`, `endFillColor`,
`experimental_endDraggingSensitivityMultiplier`, `fadingEdgeLength`, `indicatorStyle`, `keyboardShouldPersistTaps`,
`maintainVisibleContentPosition`, `maximumZoomScale`, `minimumZoomScale`, `onKeyboardDidHide`, `onKeyboardDidShow`,
`onKeyboardWillHide`, `onKeyboardWillShow`, `onScrollToTop`, `refreshControl`, `scrollIndicatorInsets`, `scrollPerfTag`,
`scrollsChildToFocus`, `snapToAlignment`, `snapToEnd`, `snapToInterval`, `snapToStart` e `zoomScale`.

São 26: 21 props de valor e 5 funções (`onKeyboard*` e `onScrollToTop`, cujo default já é "não passar").

### 2. A queda do host na sabotagem `scroll`

Quando o contrato do ScrollView deixa de chamar o verificador, **o host cai** em vez de a lane ver um erro de JS. A
sabotagem continua rejeitada (a lane nativa trata uma execução sem relatório e com `Program crashed` no log como
rejeição), mas a causa ficou sem dono, e é registrada aqui. **Não foi consertada**, por decisão.

**O caso.** Componente `ScrollView`, prop **`maintainVisibleContentPosition`**, valor **`true`** (o valor que a sonda usa
para a prop recusada), **na montagem** (`remount=true`, a vaga nasce com a prop; é o 40º caso recusado da tabela e o
último que a sonda tocou). A atualização no lugar dessa prop não foi alcançada: a montagem cai antes. Os casos seguintes
da tabela (do 41º ao 58º: `maximumZoomScale` até `refreshing`) **não foram conduzidos** nesta execução, de modo que não
se sabe se outra prop do ScrollView cai do mesmo jeito com um valor de tipo errado.

**A cadeia.** O JS que chama o host é o commit do React na montagem de um host component, `createNode(...)` em
`node_modules/react-native/Libraries/Renderer/implementations/ReactFabric-prod.js:7104` (o `completeWork` de um
`HostComponent` novo, com o payload de atributos que a configuração de view do ScrollView deixa passar, já com
`maintainVisibleContentPosition: true`). O log não traz pilha de JS, porque o processo morre por sinal; a pilha nativa
mostra a entrada por esse `createNode` (o `UIManager::createNode`) e a queda: `BaseScrollViewProps::setProp` →
`getPropertyNames` do Hermes → `hermes::vm::getForInPropertyNames`, sinal 11. A conversão entre os dois está inlinada e não
aparece na pilha; pela leitura do fonte, a causa está no C++ do próprio RN:
`ReactCommon/react/renderer/components/scrollview/conversions.h:96-98` faz
`auto map = (std::unordered_map<std::string, RawValue>)value;` **sem checar o tipo**, e um valor que não é objeto vai
direto para a enumeração de propriedades do Hermes (o rótulo `parsePlatformColor` de um dos quadros da pilha é, ao que
parece, o símbolo mais próximo do código inlinado na simbolização, e não uma chamada de verdade). Um objeto válido, `{minIndexForVisible: 0}`, **não cai**.

**Por que só aparece na sabotagem.** Com a política ligada, `maintainVisibleContentPosition` está entre as 26 props que
recusam todo valor não nulo (item 1), então o valor `true` nunca chega ao C++. **Quem relaxar essa prop no GF-14 precisa
manter uma validação de tipo na fachada**, ou volta a derrubar o host.

**Reprodução** (uma vez, local; o script aplica a sabotagem `scroll`, corta a fixture ao ScrollView com uma vaga por
grupo, imprime o grupo antes de conduzi-lo, grava `build/scope-scroll-crash.log` e **restaura a fonte byte a byte**, o
que confere com o SHA-256 antes e depois):

```bash
node scripts/scope-scroll-crash.mjs                                  # todas as props recusadas, uma por vez, até o host cair
node scripts/scope-scroll-crash.mjs maintainVisibleContentPosition   # só essa prop, com o valor da tabela (true)
node scripts/scope-scroll-crash.mjs maintainVisibleContentPosition '{"minIndexForVisible":0}'   # objeto válido: não cai
```

Resultado da execução registrada, sobre `e33817e`: o primeiro comando conduz 158 passos de grupo e termina em
`TRACE show ScrollView/refused/39 case remount=true`, seguido de `handle_crash: Program crashed with signal 11` e da
pilha acima; o segundo cai no primeiro caso (`ScrollView/refused/0`); o terceiro percorre os 332 passos sem cair (o
processo sai com 1 só porque a sabotagem tirou a verificação que a sonda exige). Numa execução anterior, a prop sozinha
terminou em `SIGBUS` sem a linha do manipulador: o sinal varia, a prop e a montagem não.

### 3. Outros limites

- A lane de JS não rejeita a sabotagem `updates` (só a nativa a vê). É o desenho: a atualização no lugar é o que a lane
  nativa existe para provar.
- O controle `--previous` depende do host em que a main foi compilada; ele não vale se o host for outro (a comparação
  exige o mesmo SHA-256 e falha sem ele).
- O manifesto não edita a auditoria de 2026-10-01 (`docs/compatibility/react-native-0.87.1.json`): onde ela está
  atrasada, o manifesto diz `auditStale`, e o PARITY.md ganhou só uma linha de ponteiro, sem mexer em contagens.
- **Não há CI hospedado nem publicação no Pages** para este registro: ele é local, macOS arm64, headless. Nenhum
  hardware, nenhum iOS e nenhuma exportação foram exercitados. Nenhum checkpoint, peso ou denominador do 1.0 se move.
