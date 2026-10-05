# Appearance e useColorScheme do tema do sistema no Godot

Esta fatia troca o tema manual do SDK pelos módulos originais `Appearance` e
`useColorScheme` do RN, lidos pelo import público `react-native` e alimentados
pelo tema do sistema do `DisplayServer` do Godot e pelo override de
`setColorScheme`. Duas roots de uma aplicação Hermes renderizam o mesmo esquema.
O [recibo](report.json) fixa fontes, hashes e resultados.

| Lane executada | Checks | Observação |
| --- | ---: | --- |
| Host anterior `60825a18` (main `2ec988e`) | 22/67 | Exatamente as 45 falhas normativas: sem o módulo, o `Appearance` do RN lê `null` e nada é emitido |
| Host que emite a cada callback (sabotagem retida) | 50/67 | 17 falhas, nos passos repetidos ou cobertos por override; o oráculo independente rejeita o relatório |
| Host corrigido, headless | 67/67 | Duas roots com `useColorScheme`, override, `unspecified` e uma segunda aplicação com sistema escuro |

As lanes executam o mesmo bundle, com as mesmas fontes de teste e SDK; só os
produtores nativos diferem, e o registro de build mostra que o host anterior foi
compilado exatamente das 56 entradas nativas da main.

```sh
npm run test:appearance
```

Com o host anterior instalado em `addons/`, o mesmo runner confere o controle com
`node tests/appearance-native.test.mjs --allow-original-negative`.

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
callback de tema do sistema, chamado sem argumentos: no macOS em
`AppleInterfaceThemeChangedNotification`, no Windows em todo
`WM_SETTINGCHANGE`/`WM_SYSCOLORCHANGE`, no portal do Linux, no iOS e no Android
(adiado). O `DisplayServer` headless não suporta tema e ignora o callback. No
motor, só o `EditorNode` registra esse callback, e só no processo do editor.

## A correção

1. Um [`SystemAppearance`](../../../native/system_appearance.h) por
   `FabricApplication` guarda o sistema, o override e o último esquema enviado.
   O [`FabricApplication`](../../../native/fabric_application.cpp) lê o
   `DisplayServer` e, quando o módulo começa a observar, registra o callback
   `_on_system_theme_changed` (nunca no editor).
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

O `DisplayServer` headless não tem tema, então o
[probe](../../../tests/appearance-probe.gd) fornece o esquema do sistema pela meta
`validation_system_color_scheme` da aplicação e chama
`Callable(application, "_on_system_theme_changed")`, o mesmo Callable que o módulo
registra no `DisplayServer`; dali em diante o caminho é o de produção. Duas roots
renderizam com `useColorScheme` e pintam a View com o esquema; cada root e uma
assinatura de biblioteca, feita na avaliação do bundle, escutam por
`Appearance.addChangeListener`:

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
  sistema depois do stop é contada e não chega a nenhum listener; um método
  retido falha com `E_MODULE_DISPOSED`; `disposeEnvironment()` zera a assinatura
  sem evento.

O [oráculo](../../../tests/appearance-oracle.mjs) refaz cada passo a partir das
ações do probe e das regras do RN: eventos, listeners, re-renders, cores nativas
das Views e contadores.

## Controles

O host anterior roda o mesmo bundle: as duas roots montam e param sem
diagnóstico, mas o `Appearance` do RN não encontra o módulo, lê `null`, as roots
pintam a cor de fallback e nada é emitido. Ele falha exatamente os 45 checks que
precisam do módulo e passa os 22 estruturais. Uma sabotagem retida, em que o
módulo envia `appearanceChanged` a cada callback e override, falha 17 checks, e o
oráculo rejeita o relatório. O cabeçalho foi restaurado byte a byte e o host
recompilado voltou ao hash executado.

## Regressões

No mesmo host passaram os três gates do job `contracts` (260 testes Node e 13
Python, análise estática e scan de publicação), o `test:recovery`, as 29 suítes
nativas — 22 exemplos com 2.250 checks (o NativeWind troca o tema por
`Appearance.setColorScheme` e reage ao evento original), Down 2.731 nas oito
lanes, query faults 187, resolver faults 66, Document Up 6.459, View Up 297, Move
220, Document Move 1.940, hover 158, caminho da raiz 82, hover em Document 1.530,
click 728, PanResponder 128, AppState 75, o próprio Appearance 67 e
`parity:godot` — e o lote do SDK nativo (affine, codegen, pack/verify, registro,
loader e runtime de adapters, consumidor independente e cold start).

O SDK muda para todo bundle que importa `react-native`, então os controles de
host anterior que fixam o bundle do SDK precisam ser refeitos com os bundles
novos. O controle do AppState foi refeito no host preservado dele (`e626a31d`):
continua falhando exatamente os 62 checks normativos, e a lane atual passa os 75
comparando com ele.

## Limites

O `DisplayServer` headless não tem tema do sistema: o valor do sistema vem da meta
de validação e a mudança chega pelo Callable registrado. Mudanças reais de tema em
cada sistema, um jogo que registre o próprio callback de tema no `DisplayServer`
(vale o último registro), cores de destaque, `PlatformColor`/`DynamicColorIOS`,
temas por janela, exports Android e iOS do Godot e configuração do dispositivo
seguem abertos no GF-21. A CI hospedada desta fatia está pendente. Só o
checkpoint de primeira fatia do GF-21 fecha, porque o AppState (#31) foi a
primeira fatia verificada dele; nenhum GF, outro checkpoint, peso ou denominador
fecha.

As 72 fontes de código e configuração executadas (16 produtoras do bundle, 57
entradas do build nativo e 6 de verificação, com sobreposição) correspondem à
implementação `a402a1f9f74ec6e4426f108ff93fe731afa3a4a0` por `git show`/SHA-256.
A execução partiu de `2ec988e` com uma árvore idêntica à da implementação; este
pin pós-commit não é uma nova corrida.

Na revisão, `removeListeners` passou a comparar a contagem antes de convertê-la
para `uint64_t` (um `double` acima do tipo não tem conversão definida) em
`15e8da4`. No host recompilado (`d33c78aa`) o Appearance repetiu os 67 checks e o
AppState passou de novo, com o controle do host anterior presente; o recibo
registra a corrida em `reviewReruns`.
