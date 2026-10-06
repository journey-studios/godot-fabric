# Animated e TouchableOpacity sobre o NativeAnimated C++ do RN, avançado pelos quadros do Godot

Esta fatia exporta o `Animated`, o `Easing`, o `useAnimatedValue`, o
`useAnimatedValueXY` e o `TouchableOpacity` originais do RN pelo import público
`react-native`. O driver JS roda sobre `requestAnimationFrame`; com
`useNativeDriver`, o `AnimatedModule` C++ e o `AnimationBackend` compartilhado do
próprio RN animam a View, e o tick de quadros do Godot é o relógio deles: cada
quadro entrega um timestamp ao backend, que atualiza o Control sem commit do React.
Duas roots de uma aplicação Hermes animam ao mesmo tempo, e um oráculo
independente refaz cada amostra a partir dos timestamps entregues. O
[recibo](report.json) fixa fontes, hashes, capturas e resultados.

| Lane executada | Checks | Observação |
| --- | ---: | --- |
| Host anterior `e5671b06` (main `1607044`) | 16/75 | Exatamente as 59 falhas normativas: sem o módulo, toda `Animated.View` falha na montagem com `Native animated module is not available`; os drivers JS passam |
| Sabotagem `frames`, host `a0bcd090` | 43/75 | Exatamente 32 falhas: o backend recebe os timestamps em segundos e anima mil vezes mais devagar que o relógio do host; o oráculo rejeita o relatório já nas primeiras amostras |
| Sabotagem `persistence`, host `fd3783fe` | 73/75 | Exatamente 2 falhas: sem a atualização das referências do JS, o React volta às props anteriores à animação; o oráculo rejeita o relatório |
| Host atual `e90888f8`, headless | 75/75 | Duas roots, os dois drivers, timing, spring, decay, composição, interpolação, `useAnimatedValueXY`, `stopAnimation`, listener, re-render, desmontagem e `TouchableOpacity` por mouse e toque |

As lanes executam o mesmo bundle, com as mesmas fontes de teste e SDK; só os
produtores nativos diferem. O host anterior foi compilado com `npm run setup` a
partir da main `1607044` (o merge do Appearance), antes de a árvore receber o trabalho
desta fatia. As fontes nativas e de SDK de `1607044` são idênticas às de `fb42709`, a
base da execução, que só mudou documentos: `git diff --name-only` entre as duas lista
apenas `README.md`, `ROADMAP.md`, `dashboard/`, `docs/evidence/` e `docs/research/`. O
log do `setup` ficou fora do repositório e o registro de build desse host não é
mantido nele; o que o prova é o comportamento (sem `NativeAnimatedModule`, as 59
falhas normativas) e a ausência dos símbolos do gerenciador de nós, dos drivers, do
registro e do hook de commit do Animated C++, que o recibo conta nos binários. As duas
sabotagens são retidas: `node
scripts/native-animated-sabotage.mjs` troca uma linha de cada vez, recompila,
roda o probe e o oráculo, restaura as fontes byte a byte (hash conferido),
recompila o host genuíno e registra tudo em um recibo local.

```sh
npm run test:animated
```

Com o host anterior instalado em `addons/`, o mesmo runner confere o controle com
`node tests/native-animated-native.test.mjs --allow-original-negative`; os hosts
sabotados rodam com `--sabotage` e `--sabotage=persistence`, e o launcher abre o
[exemplo](../../../examples/animated/README.md) com `npm run example -- animated`.

## O que o RN faz

No JS, `Animated.js` carrega o `AnimatedExports`, que espalha o
`AnimatedImplementation` (valores, `timing`/`spring`/`decay`,
`sequence`/`parallel`/`stagger`/`loop`/`delay`, interpolação e `event`) e acrescenta
os wrappers `View`, `Text`, `Image`, `ScrollView`, `FlatList` e `SectionList`. Cada
animação usa um de dois drivers. O driver JS (`useNativeDriver: false`) avança em
`requestAnimationFrame` com deltas de `Date.now()`: o timing avalia a easing no
tempo decorrido, o spring avalia a solução analítica do oscilador amortecido com no
máximo 64 ms por passo e o decay termina no primeiro passo menor que 0,1; a
`Animated.View` aplica cada valor com `setNativeProps` e agenda um commit do React
48 ms depois do último. O driver nativo (`useNativeDriver: true`) enfileira
operações de nós (`createAnimatedNode`, `connectAnimatedNodes`, `startAnimatingNode`,
`connectAnimatedNodeToView` e, com o backend compartilhado,
`connectAnimatedNodeToShadowNodeFamily`) e as envia ao TurboModule
`NativeAnimatedModule`. Com `cxxNativeAnimatedEnabled` o helper sinaliza cada lote
(`startOperationBatch`/`finishOperationBatch`) e agenda o flush com `setImmediate`.
Sem módulo, `assertNativeAnimatedModule` lança `Native animated module is not
available`, e o efeito do hook de props alcança isso em qualquer `Animated.View`:
por isso o `TouchableOpacity` original não montava.

No C++, o `AnimatedModule` entrega as operações ao `NativeAnimatedNodesManager`,
dono do grafo de nós e dos drivers: o `FrameAnimationDriver` (a tabela de quadros que
o JS amostra da easing a cada 1000/60 ms, interpolada linearmente entre os
quadros), o `SpringAnimationDriver` (a mesma solução analítica em `float`, com no
máximo quatro quadros de tempo por passo e testes de repouso e de overshoot) e o
`DecayAnimationDriver`. Quando a primeira animação começa, o gerenciador registra um
callback no `AnimationBackend`, cujo `AnimationChoreographer` recebe `resume()`; ao
terminar a última, recebe `pause()`. Cada `onAnimationFrame(timestamp)` roda os
callbacks e recebe `AnimationMutations`, que o backend grava no
`AnimatedPropsRegistry` e aplica de duas formas: props sem efeito de layout chegam à
plataforma por `UIManager::synchronouslyUpdateViewOnUIThread` e nunca fazem commit;
uma mutação com layout faz `commitUpdates`, um commit real da árvore sombra. Ao fim
da animação o backend pede um commit `AnimationEndSync` vazio na thread JS, e o
`AnimationBackendCommitHook` reaplica as props do registro em todo commit do React e
`AnimationEndSync`, por `cloneMultiple` com `runtimeShadowNodeReference = true`; o
`UIManager::completeSurface` limpa o registro depois de um commit bem-sucedido do
React.

As plataformas concordam. `DefaultTurboModules.cpp` serve o `AnimatedModule` com
`cxxNativeAnimatedEnabled` e `useSharedAnimatedBackend` ligados (no Android o laço de
render do módulo é interno em qualquer caso). No iOS, o `RCTScheduler.mm` dá ao
backend um `RCTAnimationChoreographer` sobre `CADisplayLink`, e o
`RCTMountingManager` implementa `synchronouslyUpdateViewOnUIThread` clonando as
props montadas com as animadas pelo descritor do componente, aplicando-as à view e
avisando quando ela não existe mais; no Android, o `AndroidAnimationChoreographer`
guarda `resume()`/`pause()` e o callback de quadro só chama o backend enquanto está
ativo, e o `FabricUIManagerBinding.cpp` atualiza a view do mesmo modo. As duas
plataformas ignoram `schedulerDidUpdateShadowTree`, que só o caminho legado do
Animated usava. Os dois flags são `false` nos padrões do 0.87.1; os canais OSS do RN
ligam o `cxxNativeAnimatedEnabled` no canary e o `useSharedAnimatedBackend` no
experimental.

Na thread JS, o executor de runtime do `ReactInstance` chama
`ShadowNode::setUseRuntimeShadowNodeReferenceUpdateOnThread(true)` antes de cada
callback JS e nunca desfaz (`ReactInstance.cpp`, linha 101): nessa thread, o nó
clonado com `fragment.runtimeShadowNodeReference` passa a ser o que as referências
do JS seguram (`ShadowNode.cpp`, linhas 364-370). O hook de commit do backend e o
`setNativeProps` dependem disso: o próximo commit do React clona o nó que o JS
segura, então o JS precisa segurar o clone com as props animadas.

## O que este host fazia

O import público não exportava `Animated`, `Easing` nem os hooks, e o
`TouchableOpacity` era um placeholder que lançava porque a `Animated.View` dele
precisa do módulo nativo. Os dois métodos do delegate do UIManager no runtime
falhavam alto (`setNativeProps is not implemented` e `Animated adapter is not
implemented`), os flags do RN ficavam nos padrões, não existia
`NativeAnimatedModule` e nada ligava a referência de runtime da thread, porque este
host não usa o `ReactInstance`.

## O que o Godot entrega

O Godot chama o `_process` da aplicação uma vez por quadro renderizado, na thread
principal, que também é a thread JS deste host; o tempo vem de um relógio monotônico
em milissegundos. O `DisplayServer` headless roda sem vsync a cerca de 6,8 ms
por quadro nas execuções do recibo, então uma animação de 300 ms ocupa cerca de 45
quadros, e não 18. Os drivers do RN só precisam de um timestamp por quadro, e o Godot
não tem um callback de quadro com timestamp de vsync: o tick que o host já lê para
`requestAnimationFrame` é esse timestamp.

## A implementação

1. **Flags.** [`register.cpp`](../../../native/register.cpp) sobrescreve os flags do RN
   uma única vez, na inicialização da extensão e antes de qualquer runtime lê-los, com
   os padrões do RN mais `cxxNativeAnimatedEnabled` e `useSharedAnimatedBackend`, a
   configuração que os canais OSS do RN ligam; se um flag já tinha sido lido, a
   extensão emite um `FABRIC_ERROR` em vez de seguir com metade da configuração.
2. **Um backend por aplicação.** O [`NativeAnimated`](../../../native/native_animated.cpp)
   cria o `AnimationBackend` do RN sobre o `UIManager` da aplicação antes de qualquer
   JS, como o scheduler do RN faz com `useSharedAnimatedBackend`, e o
   [registro de TurboModules](../../../native/turbo_module_registry.cpp) só serve o
   `AnimatedModule` do RN quando os dois flags estão ligados e o backend está
   anexado. As roots de uma aplicação o compartilham.
3. **O choreographer é o tick.** `resume()` e `pause()` só registram que o backend
   tem animações; o [runtime](../../../native/application_runtime.cpp) chama
   `frame(timestamp)` uma vez por quadro do Godot, depois dos callbacks de quadro
   (`requestAnimationFrame`) e do esgotamento das microtasks, e nunca depois do stop.
   Um lote que o JS descarrega nesse tick chega, portanto, ao próximo quadro do
   backend no máximo um quadro depois, o que o probe mede. O `now()` do
   choreographer, que carimba as atualizações empurradas entre quadros, lê o mesmo
   relógio dos timestamps de quadro, porque o `HighResTimeStamp` padrão do RN é outro
   relógio em algumas plataformas.
4. **Atualizações diretas.** O `uiManagerShouldSynchronouslyUpdateViewOnUIThread` do
   delegate clona as props montadas com as animadas pelo descritor do componente e
   as aplica ao Control, como o `RCTMountingManager` faz no iOS: sem commit e sem
   JS. A view que sumiu, está sendo aposentada ou pertence a uma root em parada é
   descartada e contada (`staleDirectUpdates`), como as camadas de montagem do RN a
   descartam. O `uiManagerDidUpdateShadowTree` não faz nada, como nas duas
   plataformas.
5. **Referências do JS.** O runtime liga a referência de runtime da thread uma vez
   por aplicação, onde cria o runtime (a thread JS deste host é a principal do
   Godot), como o `ReactInstance` faz com a dele; é a única linha nova na criação do
   runtime. Sem ela, o primeiro commit do React depois de uma animação clona os nós
   que o React criou antes da animação e desfaz as props animadas: é o que mostram o
   check `persistence` e o de duas roots da sabotagem `persistence`. Duas outras
   formas foram tentadas e descartadas: alternar a referência só em volta do hook de
   commit do backend falhou, porque os clones feitos fora dessa janela (clones de
   layout, `setNativeProps`) perdem a referência fraca que liga o nó ao wrapper do
   JS e os clones seguintes do hook não conseguem redirecioná-lo; e o flag
   experimental `updateRuntimeShadowNodeReferencesOnCommit`, desligado nos padrões
   do 0.87.1 e nos canais OSS do RN, fazia a persistência passar mas não é o que o
   runtime publicado do RN faz. A referência de thread também faz o JS segurar o
   clone que o `setNativeProps` commita, o que mudou um contrato existente (veja
   Contratos atualizados).
6. **O SDK.** A [fachada](../../../src/react-native-platform.jsx) exporta o `Animated`,
   o `Easing`, o `useAnimatedValue` e o `useAnimatedValueXY` do RN e o
   `TouchableOpacity` embrulhado como o `TouchableHighlight` (nenhum Control dentro
   de Text do Godot e estilos validados na View dele). O
   [`animated-exports.js`](../../../src/animated-exports.js) é a variante do Godot do
   `AnimatedExports`: a `View` é a `AnimatedView` do próprio RN, e os wrappers sobre
   componentes que a plataforma renderiza de outro modo ou ainda não renderiza
   (`Text`, `Image`, `ScrollView`, `FlatList`, `SectionList`) lançam onde
   renderizam, com o motivo, em vez de animar outro componente. O
   [`platform-color-value-types.js`](../../../src/platform-color-value-types.js) é o
   único arquivo de plataforma de que o `AnimatedColor` do RN precisa: `PlatformColor`
   lança e nenhum valor é cor de plataforma; o bundler só o resolve para esse
   importador, então nenhum outro módulo muda. A `Animated.View` compartilha o
   contrato de host da View, mas não rejeita estilos de View que o Godot não tem.
7. **Parada.** Parar a aplicação para o choreographer, e nenhum quadro é entregue
   depois; o snapshot então omite `nowMs`, para que uma aplicação parada reporte o
   mesmo estado a cada pergunta (o exemplo `services` compara dois snapshots).

## O que foi verificado

O [fixture](../../../tests/native-animated-fixture.jsx) executa o experimento de
[cases.mjs](../../../tests/native-animated-cases.mjs) pelo import público em duas roots
de uma aplicação, com os dois drivers, e registra em ordem tudo o que o JS observa,
cada entrada carimbada com `Date.now()`. O
[probe](../../../tests/native-animated-probe.gd) lê, a cada quadro do Godot e antes do
próximo tick da aplicação, o timestamp que o host entregou ao backend, os contadores
do backend e a opacidade, a posição e o ângulo dos Controls reais: o que aquele
quadro aplicou. Os toques e cliques no `TouchableOpacity` são eventos de entrada
reais do Godot. A amostragem no início do quadro vê o estado aplicado pelo tick
anterior: os quadros observados são os que o host entregou, não os que o probe
supõe.

- **Montagem e API.** As duas roots montam cada `Animated.View` e o
  `TouchableOpacity` sem erro de render; `Animated.Text`, `Image`, `ScrollView`,
  `FlatList` e `SectionList` falham onde renderizam, cada um com o motivo (nas duas
  roots); o backend está anexado e parado, sem quadro entregue, antes da primeira
  animação; o import público exporta `Animated`, `Easing`, `useAnimatedValue(XY)` e
  `TouchableOpacity`.
- **Drivers JS (valem nos dois hosts).** Timing, spring e decay sobre um valor sem
  view terminam com `finished: true` e valores que o oráculo reproduz a partir de
  `Date.now()`; `sequence`, `parallel`, `stagger` e `loop` terminam as animações na
  ordem e a si mesmos por último; `stop()` termina com `finished: false` e
  `stopAnimation` lê o último valor; uma nova animação sobre o mesmo valor termina a
  antiga com `finished: false` e continua de onde ela parou. O driver JS numa
  `Animated.View` leva o Control ao valor final sem nunca acordar o backend.
- **Drivers nativos.** Timing (`inOut(ease)`), spring, decay, uma view de
  `createAnimatedComponent` e um `useAnimatedValueXY` rodam no backend do RN: o
  pedido chega ao próximo quadro do backend, um quadro do Godot depois da chamada; o
  callback de fim traz o resultado do próprio RN (`finished`, `value`, `offset`); o
  Control muda em muitos quadros sem nenhum evento de valor por quadro no JS; o
  choreographer recebe um `resume` e um `pause` e no máximo um quadro por quadro do
  Godot; cada quadro aplica no máximo uma atualização direta e nenhuma é descartada;
  o relógio do backend é o do host; o Control termina na saída final da animação.
- **Controle e eventos.** `stopAnimation` lê exatamente o valor aplicado ao Control
  e o Control o mantém em todo quadro depois; `addListener` ouve exatamente os
  valores distintos que o backend aplicou, na ordem, mais o valor final uma vez (o
  fim da animação o sincroniza), e depois de `removeListener` o backend não envia
  mais eventos de valor.
- **Ciclo de vida.** Um re-render no meio e outro depois do fim não puxam o Control
  de volta; desmontar uma `Animated.View` no meio remove o Control, termina com
  `finished: false`, para o backend e não gera erro; uma atualização para uma view
  que já sumiu é descartada e contada sem erro, até o RN a desconectar (a corrida é
  produzida adiando o `setImmediate` do JS); duas roots animam ao mesmo tempo de um
  só backend, cada uma na sua curva, e desmontar uma no meio deixa a outra a
  caminho do fim; parar a aplicação no meio de uma animação não entrega mais
  quadros nem erro.
- **Persistência.** As caixas que terminaram ou pararam uma animação mantêm as props
  finais depois dos commits não relacionados do React que os casos seguintes fazem.
- **TouchableOpacity.** Por mouse e por toque, o press leva o botão à
  `activeOpacity` pelo driver nativo, o release o devolve ao repouso no timing de 250
  ms do RN, uma execução do backend por transição, e `onPress` dispara uma vez,
  depois de `onPressIn` e `onPressOut`.

O [oráculo](../../../tests/native-animated-oracle.mjs) é escrito a partir das
fórmulas e dos drivers C++ do RN, não dos veredictos do probe e sem o código de
animação do RN. Para o driver nativo, ele refaz os drivers de quadro, spring e decay
(a tabela de quadros, o índice `round(delta / 16,67)`, valores `float`, o clamp e o
teste de repouso do spring, a regra de parada do decay) sobre os timestamps que o
host de fato entregou, leva o resultado pela interpolação e pela transformação até o
Control (a rotação se divide entre a transformação do Control e a de offset) e exige
concordância até o arredondamento: na execução do recibo, no máximo 2,7e-15 na
opacidade, 1,9e-6 na posição (um passo de `float` naquela magnitude) e
1,7e-7 rad no ângulo, contra tolerâncias de 1e-6, 1e-4 e 1e-5. Para o driver JS, ele confere
cada entrada do listener com a curva que o RN calcula para o `Date.now()` em que
rodou, limitado só pelo que os carimbos garantem (um passo rodou depois que o
anterior foi carimbado e não depois do próprio carimbo), de modo que uma pausa entre
duas leituras alarga a janela exatamente pelo tamanho da pausa. Ele também deriva,
das amostras brutas, a persistência das props finais de cada caixa.

Na execução do recibo o oráculo aceita o relatório do host atual, e cada uma das 15
execuções nativas (timing, spring, decay, a view criada, XY, `stopAnimation`,
listener, re-render, desmontagem, corrida, as duas roots, o retorno e o
`TouchableOpacity` por mouse e por toque) concorda com ele dentro dessas
tolerâncias; o backend recebeu um quadro a cada 6,8 ms em média.

## Controles

O host anterior roda o mesmo bundle: as roots montam e param sem diagnóstico e os
drivers JS passam, mas nenhuma `Animated.View` monta: o RN lança `Native animated
module is not available` no efeito do hook de props, e o recibo do mount registra
os erros. Ele falha exatamente os 59 checks que precisam do módulo (montagem, backend
anexado, a `Animated.View` com driver JS, as animações nativas, `stopAnimation`,
listener, re-render, desmontagem, duas roots, persistência, o `TouchableOpacity` e a
parada) e passa os 16 restantes; o oráculo rejeita o relatório.

A sabotagem `frames` troca uma linha do choreographer, que passa a entregar ao
backend `timestamp_ms / 1000.0`, onde todo driver e o relógio do RN esperam
milissegundos: as animações rodam mil vezes mais devagar que o relógio do host.
Falham exatamente 32 checks e o oráculo rejeita o relatório já nas primeiras amostras
(`native-timing sample 1 (opacity)`).

A sabotagem `persistence` troca a linha que liga a referência de runtime da thread
JS por `false`. Todo o resto de um host com o backend do RN continua certo: as
animações rodam em suas curvas. Falham exatamente o check de persistência e o da
caixa que anima de volta depois que outra root desmonta (`Unmounting one root
mid-animation...`), e o oráculo rejeita o relatório de duas formas, pela amostra
(`native-return sample 0 (opacity)`: a caixa já tinha voltado a 1 em vez de 0,2) e
pela derivação independente de persistência.

Em cada sabotagem o `scripts/native-animated-sabotage.mjs` confere que a âncora
aparece uma só vez, compila, roda o runner com a flag da variante, restaura a fonte
byte a byte, prova isso por hash e recompila o host genuíno, cujo hash volta ao
executado. O recibo local registra as fontes, os hosts e os resultados.

## Capturas

`npm run example -- animated --capture` salva quatro quadros do renderizador nativo
do exemplo, e a validação confere que cada leitura difere das outras:
[ocioso](animated-before.png), [press no Run](animated-pressed.png) (o botão
apagado em 0,4 pelo `TouchableOpacity`), [meio da animação](animated-mid-animation.png)
(caixa girada, deslocada e meio apagada, com o texto ainda em `running to the right`)
e [fim](animated-end.png) (`finished: true`). O recibo registra o SHA-256 e as
dimensões (900 × 680) de cada uma, e o [exemplo](../../../examples/animated/README.md)
as mostra com a explicação de cada estado. A de meio da animação muda de uma
execução para outra, porque o quadro capturado depende do tempo; as outras três têm
bytes estáveis.

## Regressões

Na execução, sobre a árvore commitada `d96383c` e no mesmo host, passaram os três
gates do job `contracts` (264 testes Node e 13 Python, análise estática e scan de
publicação), o `test:recovery`, as 35 suítes nativas — 23 exemplos com 2.260
checks (o `animated` com 10), Down 2.731 nas oito lanes, query faults 187, resolver
faults 66, Document Up 6.459, View Up 297, Move 220, Document Move
1.940, hover 158, caminho da raiz 82, hover em Document 1.530, click 728,
notificações de captura 672, PanResponder 128, AppState 75, listas 44, Appearance
79, Switch 108, toques compartilhados 92, touchables 93 (a lane `animated` com
7), ActivityIndicator 33 e o próprio Animated 75 — e o lote do SDK nativo (affine, codegen,
pack/verify, registro e loader de adapters, runtime de adapters, consumidor
independente, cold start e `parity:godot`). O controle de host anterior e as duas
sabotagens foram refeitos na mesma árvore, com a CI do job `native-cold-start` como
roteiro dos passos.

O controle `--preceding-sdk` local dos touchables já falhava na main `fb42709` (os
checks `sentinel` e `stop`, por mudanças posteriores no host e no SDK): reproduzi as
mesmas 21 falhas com os arquivos de teste e de SDK da main e o host anterior. Não é
regressão desta fatia, e a CI não o executa.

O SDK muda para todo bundle que importa `react-native`, porque a fachada passa a
exportar o `Animated` e o `TouchableOpacity` original. Os controles de host anterior
que fixam o bundle do SDK e ficam só em `build/` (AppState, Appearance, listas,
pointer up, query faults e resolver faults) não existiam neste checkout, e a CI não
os tem; quem os mantém localmente precisa refazê-los com os bundles novos.

## Contratos atualizados

Duas fatias anteriores fixavam comportamentos que esta fatia muda de propósito. Os
arquivos executados delas continuam como registros históricos do que foi observado
na época.

- **Touchables.** O `TouchableOpacity` deixa de ser um placeholder: o check
  `mount/opacity` do suite passa a ser o mesmo de todos os touchables (o host
  monta sem erro de render, em vez de lançar com o motivo do `NativeAnimatedModule`),
  e a mensagem do check `render-errors` deixa de citar o `TouchableOpacity`. A lane
  `animated`, que importava o `TouchableOpacity` original por dentro do pacote com
  seams só de teste (as listas do Animated e a cor de plataforma) para mostrar a
  falha no mount (6 checks de indisponibilidade), agora monta o `TouchableOpacity`
  público sem seam: 7 checks, com a opacidade indo de 1 a 0,5 e voltando pelo driver
  nativo. O bundle público passa a conter o `Animated` e o `TouchableOpacity`
  originais. O suite continua em 93 checks, o controle do SDK anterior continua
  falhando exatamente 19 e a sabotagem retida continua sendo rejeitada pelo oráculo.
  O [registro dos touchables](../touchables/README.md) descreve o estado daquela
  fatia, quando o `TouchableOpacity` ainda não montava.
- **Tree.** Um `setNativeProps({ nativeID })` seguido de um commit do React só com
  filhos agora mantém o ID imperativo: o commit clona o nó que o JS segura, que na
  thread JS do RN é o clone que o `setNativeProps` commitou, como no RN com
  `ReactInstance`. A observação antiga, de que esse commit restaurava o ID
  declarativo, descrevia este host sem a referência de runtime da thread e não o RN
  empacotado. O exemplo [tree](../../../examples/tree/App.jsx) renomeou o check para
  `Children-only commit keeps the imperative native ID, as RN's JS thread holds
  setNativeProps' clone` e manteve o estágio `declared` (props novas do React
  sobrescrevem o ID imperativo); continua com 89 checks. Os arquivos executados do
  [registro da árvore](../tree/README.md) (`checks.json`, `negative-control.json` e
  `provenance.json`) seguem como registro histórico e ainda trazem o nome e a
  afirmação antigos.
- **Documentos.** A [API](../../API.md), os [módulos nativos](../../NATIVE_MODULES.md),
  o [índice de evidências](../README.md), o README, o ROADMAP, a pesquisa e o
  exemplo dos touchables deixam de dizer que o `TouchableOpacity` está indisponível
  ou que o commit só com filhos restaura o ID; os READMEs de evidência dos
  touchables e da árvore só ganharam uma nota apontando para este registro.

## Limites

O suite afirma o driver nativo só com props sem layout (opacidade, translação e
rotação). Fora do recibo, em execuções exploratórias únicas sobre a árvore commitada, a
interpolação de `backgroundColor`, o `borderRadius`, `scaleX`/`scaleY`,
`sequence`/`delay`/`loop`/`parallel` sobre timings nativos e as props de layout
`width` (80 a 160) e `marginLeft` (0 a 60), que o RN admite com o backend
compartilhado e que o backend commita a cada quadro, rodaram sem erro e o Control
seguiu quadro a quadro. Um `transform: [{ scale }]` uniforme, animado ou estático, falha
com `E_TRANSFORM_3D`: o RN o monta como `scale3d(n, n, n)` e o guard de
transformações (`native/affine_transform.h`, contrato de uma fatia anterior) rejeita
matrizes cujo escalonamento em z não é 1; animar `scaleX` e `scaleY` funciona. Segue
aberto no GF-19: `LayoutAnimation` e transições de layout, `Animated.event` nativo no
ScrollView do SDK e os wrappers `Animated.ScrollView`, `FlatList` e `SectionList`,
`Animated.Text` e `Animated.Image`, animação de props de layout afirmada pelo suite,
interpolação de `PlatformColor`, `unstable_disableBatchingForNativeCreate`, movimento reduzido,
comportamento sob carga de JS e em background/retomada, orçamentos de quadro e heap
(GF-30), hardware e exports Android e iOS do Godot, o `scale` uniforme e o contrato,
a paridade e os alvos completos do item. A CI hospedada desta fatia está pendente.
Só o checkpoint de primeira fatia do GF-19 fecha, porque esta é a primeira fatia
verificada dele; nenhum GF, outro checkpoint, peso ou denominador fecha.

Na execução, as 89 fontes de código e configuração executadas (18 produtoras
do bundle, 63 entradas do build nativo e 15 de verificação, com sobreposição)
correspondem à implementação `d96383c46dde79fb9d242f89e68360d49a81663a` por
`git show`/SHA-256, e o recibo registra os 30 fontes originais do RN que o bundle e
as referências de plataforma usam. A execução foi feita na própria árvore commitada
(base `fb42709`, árvore `6ff2ba731630912f4b4e18505f4338ebe2d45c0e` idêntica à da implementação, sem alterações
locais), então este pin não é uma corrida nova. O recibo traz os hashes das quatro
capturas; o recibo local das sabotagens (formato v3) e os relatórios brutos ficam em
`build/` e não entram no Git.
