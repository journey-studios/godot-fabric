# Appearance e useColorScheme do tema do sistema no Godot

Esta fatia troca o tema manual do SDK pelos módulos originais `Appearance` e
`useColorScheme` do RN, lidos pelo import público `react-native` e alimentados
pelo tema do sistema do `DisplayServer` do Godot e pelo override de
`setColorScheme`. Duas roots de uma aplicação Hermes renderizam o mesmo esquema,
e duas aplicações abertas ao mesmo tempo recebem cada mudança de tema por um
único callback compartilhado. O [recibo](report.json) fixa fontes, hashes e
resultados.

| Lane executada | Checks | Observação |
| --- | ---: | --- |
| Host anterior `e23bcbab` (main `54ede87`) | 23/79 | Exatamente as 56 falhas normativas: sem o módulo, o `Appearance` do RN lê `null` e nada é emitido |
| Host antes do callback compartilhado `69ab42c0` | 70/79 | Exatamente os 9 checks do callback compartilhado: com um callback por aplicação, a segunda desloca a primeira, que não recebe mais nenhuma mudança; o oráculo independente rejeita o relatório |
| Host corrigido `d2f3becc`, headless | 79/79 | Duas roots com `useColorScheme`, override, `unspecified`, uma segunda aplicação com sistema escuro e duas aplicações observando ao mesmo tempo |

As lanes executam o mesmo bundle, com as mesmas fontes de teste e SDK; só os
produtores nativos diferem. Os registros de build mostram que o host anterior foi
compilado exatamente das 60 entradas nativas da main `54ede87`, e o host antes do
callback compartilhado das 61 do merge `4f5b765`. A sabotagem retida, um host que
emite a cada callback, é da execução original, com 67 checks: falhou 17 e o
oráculo rejeitou o relatório.

```sh
npm run test:appearance
```

Com o host anterior instalado em `addons/`, o mesmo runner confere o controle com
`node tests/appearance-native.test.mjs --allow-original-negative`; com o host
antes do callback compartilhado, com `--allow-prefix-negative`.

## O que o RN faz

O `Appearance.js` original é preguiçoso: a primeira chamada busca o módulo nativo
com `TurboModuleRegistry.get`, que aceita ausência (sem módulo, `getColorScheme()`
devolve `null`). Ele passa o módulo ao `NativeEventEmitter` em todas as
plataformas, assina um único listener de `appearanceChanged` que guarda
`{colorScheme}` e reemite para os próprios listeners, e guarda a primeira leitura
nativa. `setColorScheme()` chama o nativo e atualiza o cache na hora, mas não
avisa ninguém: só o evento nativo avisa. `useColorScheme` é um
`useSyncExternalStore` sobre esse módulo.

As plataformas concordam no contrato. O `RCTAppearance` do iOS guarda o esquema
da janela ao ser criado, aplica o override em `overrideUserInterfaceStyle` (com
`auto`, `unspecified` ou qualquer valor desconhecido seguindo o sistema) e só
envia o evento quando o esquema recalculado muda. O `AppearanceModule` do Android
lê a configuração a cada chamada, usa `setDefaultNightMode` (ignorando valores
desconhecidos) e só envia quando o esquema difere do último enviado. As duas
reportam `light` quando o estilo do sistema não é escuro.

## O que este host fazia

O SDK tinha um tema manual: `getColorScheme()` começava em `light`,
`setColorScheme()` só aceitava `light` ou `dark` e chamava os listeners na hora, e
nada lia o sistema. `useColorScheme` lançava erro, então o `ChartKitProvider` do
chart-kit, que sempre o chama, não renderizava.

## O que o Godot entrega

O `DisplayServer` expõe `is_dark_mode_supported()`, `is_dark_mode()` e um único
callback de tema do sistema para o processo inteiro
(`set_system_theme_change_callback` substitui o Callable anterior), chamado sem
argumentos: no macOS em `AppleInterfaceThemeChangedNotification`, no Windows em
todo `WM_SETTINGCHANGE`/`WM_SYSCOLORCHANGE`, no portal do Linux, no iOS e no
Android (adiado). O `DisplayServer` headless não suporta tema e ignora o
callback. No motor, só o `EditorNode` registra esse callback, e só no processo
do editor.

## A correção

1. Um [`SystemAppearance`](../../../native/system_appearance.h) por
   `FabricApplication` guarda o sistema, o override e o último esquema enviado.
   Como o `DisplayServer` tem um só callback de tema por processo, um
   `SystemThemeOwner` compartilhado registra nele, uma única vez e nunca no
   editor, um Callable estático, e repassa cada mudança a toda aplicação cujo
   módulo observa. O módulo entra quando começa a observar e sai quando é
   liberado, no stop ou quando a aplicação é liberada: uma aplicação parada ou
   liberada não recebe mais nada, e as outras continuam recebendo. Os membros
   são IDs de instância resolvidos pelo `ObjectDB` a cada mudança, sem ponteiro
   pendurado, e a cópia do Callable que o
   [`FabricApplication`](../../../native/fabric_application.cpp) guarda é
   liberada quando o nível de cena da extensão termina, antes do motor.
2. O [registro de TurboModules](../../../native/turbo_module_registry.cpp)
   expõe `Appearance` pelo `NativeAppearanceCxxSpec` gerado pelo RN e envia
   `appearanceChanged {colorScheme}` pelo `TurboModule::emitDeviceEvent`
   original. Cada runtime tem um módulo, compartilhado por todas as roots.
3. O esquema efetivo é o override `light`/`dark` quando existe, senão o do
   sistema, que é `light` sem modo escuro (também no headless): o JS do RN só
   devolve `null` sem o módulo. O evento só sai quando o efetivo muda;
   `auto`/`unspecified` voltam a seguir o sistema; valores desconhecidos falham
   com `E_ARGUMENT`.
4. Parar a aplicação descarta o módulo sem evento. O `disposeEnvironment()` remove
   a assinatura de dispositivo do `Appearance`, e `environmentStats()` perde o
   campo `theme`.
5. O [SDK](../../../src/platform-environment.js) exporta o `Appearance` e o
   [`useColorScheme`](../../../src/react-native-platform.jsx) originais.

## O que foi verificado

O `DisplayServer` headless não tem tema e descarta o Callable, então o
[probe](../../../tests/appearance-probe.gd) fornece o esquema do sistema pela meta
`validation_system_color_scheme` de cada aplicação viva e chama, uma vez por
mudança, o Callable que o dono compartilhado registrou no `DisplayServer`, lido
pelo seam `validation_system_theme_callback`; dali em diante o caminho é o de
produção. Num host sem esse seam o probe imita o slot único do `DisplayServer`:
chama o `Callable(application, "_on_system_theme_changed")` da última aplicação
que registrou. Duas roots renderizam com `useColorScheme` e pintam a View com o
esquema; cada root e uma assinatura de biblioteca, feita na avaliação do bundle,
escutam por `Appearance.addChangeListener`:

- **Inicial.** Sem suporte a tema, o esquema começa em `light`, as duas roots
  renderizam `light` e nada é enviado; uma segunda aplicação com sistema escuro
  começa em `dark`.
- **Sistema.** Ir para escuro chega a todos os listeners uma vez e as duas roots
  re-renderizam; repetir não envia nada.
- **Override.** `light` vence o sistema escuro, uma mudança do sistema coberta
  pelo override não envia nada, `dark` volta a enviar, `unspecified` segue o
  sistema de novo, e `auto` ou um override igual ao sistema não enviam nada. Um
  override desconhecido falha com `E_ARGUMENT` e mantém o esquema.
- **Assinaturas.** Remover o listener de A duas vezes o silencia, mas o hook de A
  continua re-renderizando; desmontar A tira o hook e o listener, e B continua.
- **Stop.** Parar não envia evento e mantém o último esquema; uma mudança do
  sistema depois do stop não chega à aplicação parada, que saiu do callback, nem a
  nenhum listener; um método retido falha com `E_MODULE_DISPOSED`;
  `disposeEnvironment()` zera a assinatura sem evento.
- **Duas aplicações.** Duas aplicações começam do tema do sistema sem evento,
  como membros de um único registro. Uma mudança chega uma vez aos listeners, às
  roots e aos módulos das duas. Parar a segunda a tira do callback: a primeira
  continua seguindo o sistema e a parada não recebe mais nada. Liberar a segunda
  não deixa callback pendurado, e liberar a primeira enquanto ainda observa a
  tira do callback, que segue registrado e não alcança ninguém.

O [oráculo](../../../tests/appearance-oracle.mjs) refaz cada passo a partir das
ações do probe e das regras do RN: eventos, listeners, re-renders, cores nativas
das Views e contadores, e também o registro compartilhado: um registro no
processo, os membros na ordem de entrada e cada mudança despachada uma vez e
entregue a cada aplicação que observa.

## Controles

O host anterior roda o mesmo bundle: as roots montam e param sem diagnóstico, mas
o `Appearance` do RN não encontra o módulo, lê `null`, as roots pintam a cor de
fallback e nada é emitido. Ele falha exatamente os 56 checks que precisam do
módulo e passa os 23 estruturais.

O host antes do callback compartilhado, compilado do merge `4f5b765`, em que cada
aplicação registrava o próprio callback, passa os 70 checks restantes e falha
exatamente os 9 do callback compartilhado. No relatório dele, a primeira
aplicação, deslocada pelo registro da segunda, não recebe nenhuma das mudanças (0
notificações) e fica no esquema velho; a segunda continua recebendo depois de
parada; e, liberada a segunda, ninguém mais recebe. O oráculo independente
rejeita o relatório.

Uma sabotagem retida da execução original, em que o módulo envia
`appearanceChanged` a cada callback e override, falhou 17 dos 67 checks de então,
e o oráculo rejeitou o relatório. O cabeçalho foi restaurado byte a byte e o host
recompilado voltou ao hash executado.

## Regressões

Na execução original, no mesmo host, passaram os três gates do job `contracts`
(260 testes Node e 13 Python, análise estática e scan de publicação), o
`test:recovery`, as 29 suítes nativas — 22 exemplos com 2.250 checks (o
NativeWind troca o tema por `Appearance.setColorScheme` e reage ao evento
original), Down 2.731 nas oito lanes, query faults 187, resolver faults 66,
Document Up 6.459, View Up 297, Move 220, Document Move 1.940, hover 158,
caminho da raiz 82, hover em Document 1.530, click 728, PanResponder 128,
AppState 75, o próprio Appearance 67 e `parity:godot` — e o lote do SDK nativo
(affine, codegen, pack/verify, registro, loader e runtime de adapters,
consumidor independente e cold start).

O SDK muda para todo bundle que importa `react-native`, então os controles de
host anterior que fixam o bundle do SDK precisam ser refeitos com os bundles
novos. O controle do AppState foi refeito no host preservado dele (`e626a31d`):
continua falhando exatamente os 62 checks normativos, e a lane atual passa os 75
comparando com ele.

## Limites

O `DisplayServer` headless não tem tema do sistema: o valor do sistema vem da
meta de validação e a mudança chega pelo Callable registrado, chamado pelo
probe. Mudanças reais de tema em cada sistema, um jogo que registre o próprio
callback de tema no `DisplayServer` (ele substitui o do Fabric para todas as
aplicações, ou é substituído por ele: vale o último registro), cores de
destaque, `PlatformColor`/`DynamicColorIOS`, temas por janela, exports Android e
iOS do Godot e configuração do dispositivo seguem abertos no GF-21. Só o checkpoint
de primeira fatia do GF-21 fecha, porque o AppState (#31) foi a primeira fatia
verificada dele; nenhum GF, outro checkpoint, peso ou denominador fecha.

Na execução original, as 72 fontes de código e configuração executadas (16
produtoras do bundle, 57 entradas do build nativo e 6 de verificação, com
sobreposição) correspondem à implementação
`a402a1f9f74ec6e4426f108ff93fe731afa3a4a0` por `git show`/SHA-256. A execução
partiu de `2ec988e` com uma árvore idêntica à da implementação; este pin
pós-commit não é uma nova corrida.

Na revisão, `removeListeners` passou a comparar a contagem antes de convertê-la
para `uint64_t` (um `double` acima do tipo não tem conversão definida) em
`15e8da4`. No host recompilado (`d33c78aa`) o Appearance repetiu os 67 checks e o
AppState passou de novo, com o controle do host anterior presente; o recibo
registra a corrida em `reviewReruns`.

Na revisão do CodeRabbit sobre duas aplicações, o callback de tema passou a ser
compartilhado em `b13bcddec7ea5aed48c9a1f0022e0577c110d572`. Antes, cada
`FabricApplication` registrava o próprio callback no slot único do
`DisplayServer`, a última substituía as anteriores e a aplicação deslocada ficava
com o esquema velho; o probe também montava um `Callable` novo e o chamava
direto, então uma regressão no registro ou no despacho passaria. A corrida partiu
do merge `4f5b765` (main `54ede87`), com árvore idêntica à de `b13bcdd`, no host
`d2f3becc`: o Appearance passou os 79 checks e o oráculo aceitou o relatório; o
host anterior falhou exatamente os 56 normativos, e o host antes da correção
exatamente os 9 do callback compartilhado. O controle do AppState,
refeito com o bundle novo no host preservado `e626a31d`, continua falhando
exatamente 62, e a lane atual passa os 75. No mesmo host passaram as 33 suítes
nativas — 22 exemplos com 2.250 checks, Down 2.731 nas oito lanes, query faults
187, resolver faults 66, Document Up 6.459, View Up 297, Move 220, Document Move
1.940, hover 158, caminho da raiz 82, hover em Document 1.530, click 728,
PanResponder 128, AppState 75, Switch 108, toques compartilhados 92,
touchables 93, ActivityIndicator 33, o próprio Appearance 79 e `parity:godot` —
e o lote do SDK nativo (affine, codegen, pack/verify, registro, loader e runtime
de adapters, consumidor independente e cold start). Depois da mescla da main
`d62bc27`, na árvore final, passaram as notificações de captura (672 checks nas
oito lanes), de novo o Appearance e o AppState, os gates do job `contracts` e o
`test:recovery`. As 76 fontes de código e configuração executadas (17 produtoras
do bundle, 61 entradas do build nativo e 6 de verificação, com sobreposição)
correspondem a `b13bcdd` por `git show`/SHA-256; o recibo registra a corrida em
`reviewReruns`.

A [CI hospedada](hosted-ci.json) desta fatia é o push da `main` em 1607044 (run
37408741652), com os cinco jobs verdes na primeira tentativa e sem reexecução. O
artefato `native-appearance` do job nativo repete os **79 checks headless** do
estado depois da revisão (a segunda entrada de `reviewReruns`), com IDs idênticos
aos fixados; o oráculo independente aceita de novo o relatório baixado, e os 56
checks que o host anterior falha, os 9 do host antes do callback compartilhado e 16
dos 17 da sabotagem original passam todos no run (o 17º, sobre o stop, não existe
mais com esse nome depois da revisão). O bundle da run difere do registrado porque a
`main` mudou arquivos que ele inclui: dos 72 arquivos rastreados, 22 diferem de
`a402a1f`, entre eles os que a revisão (`15e8da4` e `b13bcdd`) e os merges da `main`
mudaram, como lista o recibo. O [Pages](publication.json) (run 37408741641)
implantou exatamente os dados commitados de 1607044; o site público já foi
substituído pelo deploy seguinte da `main`. Esses recibos não fecham GF, checkpoint,
peso ou denominador.
