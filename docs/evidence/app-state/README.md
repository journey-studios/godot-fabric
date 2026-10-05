# AppState do ciclo de vida da aplicação Godot

Esta fatia troca o `AppState` fixo do SDK pelo módulo original do RN, lido pelo
import público `react-native` e alimentado pelas notificações de ciclo de vida que
o Godot entrega ao `FabricApplication`. Duas roots de uma aplicação Hermes
compartilham um único estado. O [recibo](report.json) fixa fontes, hashes e
resultados.

| Lane executada | Checks | Observação |
| --- | ---: | --- |
| Host anterior `e626a31d` (main `72155bc`) | 13/75 | Exatamente as 62 falhas normativas: a primeira leitura de `AppState` falha com `'AppState' could not be found` |
| Host com foco acima da pausa (sabotagem retida) | 70/75 | 5 falhas, onde foco e pausa interagem; o oráculo independente rejeita o relatório |
| Host corrigido, headless | 75/75 | Notificações reais do Godot, duas roots e o módulo original do RN |

As lanes executam o mesmo bundle, com as mesmas fontes de teste e SDK; só os
produtores nativos diferem, e os registros de build mostram que o host anterior
foi compilado exatamente das 55 entradas nativas de `72155bc`.

```sh
npm run test:app-state
```

Com o host anterior instalado em `addons/`, o mesmo runner confere o controle com
`node tests/app-state-native.test.mjs --allow-original-negative`.

## O que o RN faz

O `AppState.js` original lê `initialAppState` das constantes do módulo nativo,
assina o próprio listener de `appStateDidChange` que mantém `currentState` e
reconcilia uma vez por `getCurrentAppState`, que responde de forma assíncrona.
`change`, `memoryWarning` e `focus`/`blur` viram os eventos de dispositivo
`appStateDidChange`, `memoryWarning` e `appStateFocusChange`. O `index.js` do RN
expõe `AppState` por um getter preguiçoso: importar `react-native` não o constrói.

As plataformas divergem. O `RCTAppState` do iOS tem três estados: `inactive` em
`WillResignActive`, `background` ao entrar em segundo plano e `active` ao voltar,
e só envia um estado novo; não envia foco. O `AppStateModule` do Android tem dois
estados, `active` em `onHostResume` e `background` em `onHostPause`, e envia
`appStateFocusChange` quando o foco da janela muda. Em `onHostDestroy` ele não
muda o estado nem envia nada.

## O que este host fazia

O SDK exportava um objeto fixo: `currentState` era sempre `active`, só `change`
podia ser assinado e nada nativo o alimentava. Na saída, `disposeEnvironment()`
definia `inactive` e chamava os listeners, uma transição que nenhuma plataforma do
RN emite no teardown.

## O que o Godot entrega

As camadas de plataforma chamam `MainLoop.notification()` no main loop em
execução, e o `SceneTree` propaga a notificação para todos os nós. No desktop só
existe foco da aplicação (macOS `applicationDidResignActive`/`DidBecomeActive`,
Windows `WM_ACTIVATEAPP`, X11). No iOS, `WillResignActive` envia FOCUS_OUT,
entrar em segundo plano envia PAUSED, e voltar envia FOCUS_IN e depois RESUMED.
No Android, `onPause` envia FOCUS_OUT e depois PAUSED, e `onResume` envia FOCUS_IN
e, no frame seguinte, RESUMED. O aviso de memória só existe no iOS.

## A correção

1. Um [`AppLifecycle`](../../../native/app_lifecycle.h) por `FabricApplication`
   guarda foco e pausa. O [`FabricApplication`](../../../native/fabric_application.cpp)
   o alimenta com FOCUS_IN/OUT, PAUSED/RESUMED e o aviso de memória, inclusive
   antes de o runtime existir.
2. O [registro de TurboModules](../../../native/turbo_module_registry.cpp)
   expõe `AppState` pelo `NativeAppStateCxxSpec` gerado pelo RN e envia os
   eventos pelo `TurboModule::emitDeviceEvent` original. Cada runtime tem um
   módulo, compartilhado por todas as roots.
3. O estado é `background` com a aplicação pausada, `inactive` sem foco e
   `active` nos outros casos. No iOS isso reproduz a sequência do `RCTAppState`;
   no desktop, perder o foco para outra aplicação é `inactive`, o estado que o
   iOS dá a uma aplicação em primeiro plano que não recebe eventos. Só um estado
   novo é enviado. Cada mudança real de foco também envia `focus`/`blur`, como o
   Android, depois do evento de estado.
4. Parar a aplicação descarta o módulo sem enviar evento, como o Android em
   `onHostDestroy`. O `disposeEnvironment()` não inventa mais `inactive`: remove
   os listeners de AppState, como destruir a VM faria.
5. O [SDK](../../../src/app-state.js) exporta o `AppState` original por um getter
   CommonJS, preservando a construção preguiçosa do `index.js` do RN.

## O que foi verificado

O [probe](../../../tests/app-state-probe.gd) chama `notification()` no próprio
main loop, a mesma chamada das camadas de plataforma, e o `SceneTree` propaga cada
notificação ao `FabricApplication` real. Duas roots e uma assinatura de
biblioteca, feita na avaliação do bundle, observam o `AppState` público:

- **Antes do bundle.** O foco sai antes de o runtime existir; `initialAppState`,
  `currentState` e `getCurrentAppState` começam em `inactive`, e o módulo
  original é a instância do RN.
- **Foco, pausa e memória.** Foco entra e sai, uma notificação repetida não envia
  nada, o aviso de memória chega aos três listeners, os pares móveis de segundo
  plano e retorno do Godot dão `inactive`, `background` e `active`, a pausa com
  foco vai direto a `background`, perder o foco pausado só envia `blur` e
  retomar sem foco dá `inactive`.
- **Pausa do jogo.** Com `SceneTree.paused`, o estado não muda e os eventos
  continuam chegando ao JS.
- **Assinaturas.** Remover uma assinatura duas vezes libera só aquele listener;
  desmontar a root A remove os dela, e a root B continua com o mesmo estado.
- **Stop.** Parar não envia evento e mantém o último estado; notificações depois
  do stop são contadas e não chegam a nenhum listener; um método retido falha com
  `E_MODULE_DISPOSED`; `disposeEnvironment()` zera os listeners sem evento.

O [oráculo](../../../tests/app-state-oracle.mjs) refaz cada passo a partir das
regras do RN e dos registros de assinatura do fixture: eventos, ordem por
listener, estado, consultas e contadores nativos.

## Controles

O host anterior roda o mesmo bundle: as duas roots montam e param sem
diagnóstico, mas a primeira leitura de `AppState` falha com `getEnforcing`. Ele
falha exatamente os 62 checks que precisam do ciclo de vida nativo e passa os 13
estruturais. Uma sabotagem retida, em que o foco vence a pausa no mapeamento,
falha 5 checks, nos passos em que foco e pausa interagem, e o oráculo rejeita o
relatório. O cabeçalho foi restaurado byte a byte e o host recompilado voltou ao
hash executado.

## Regressões

No mesmo host passaram os três gates do job `contracts` (260 testes Node e 13
Python, análise estática e scan de publicação), o `test:recovery`, as 27 suítes
nativas — 22 exemplos (o NativeWind e a tipografia liberam a assinatura do
css-interop no `AppState` original na saída), Down 2.731 nas oito lanes, query
faults 187, resolver faults 66, Document Up 6.459, View Up 297, Move 220,
Document Move 1.940, hover 158, caminho da raiz 82, hover em Document 1.530,
click 728, o próprio AppState 75 e `parity:godot` — e o lote do SDK nativo
(affine, codegen, pack/verify, registro, loader e runtime de adapters,
consumidor independente e cold start).

O SDK muda para todo bundle que importa `react-native`: ele passa a incluir o
getter preguiçoso e o `AppState.js` original. Os controles de host anterior que
fixam o bundle do SDK (View Up, query-fault, resolver-fault, Move, hover, caminho
da raiz, hover em Document e click) vivem nos hosts preservados fora desta
worktree e precisam ser refeitos com os bundles novos. O getter preguiçoso mantém
esses hosts utilizáveis: os bundles novos do click, que contêm o getter e o
módulo original sem lê-lo, passaram os 728 checks das oito lanes no host
anterior `e626a31d`, que não tem o módulo.

## Limites

Minimizar ou ocultar a janela (o Godot não envia notificação de ciclo de vida no
desktop), foco real do sistema em hardware, exports Android e iOS do Godot,
Appearance e `useColorScheme`, configuração do dispositivo e retomada com timers,
rede ou animações pendentes seguem abertos no GF-21. Num export Android o host
reporta um `inactive` transitório antes de `background`, e no iOS também envia
`focus`/`blur`. O css-interop do NativeWind só aplica mudanças de Appearance com
`AppState` em `active`: numa execução com janela e sem foco, uma troca manual de
tema espera o foco voltar, como no iOS. A CI hospedada desta fatia está
pendente. Nenhum GF, checkpoint, peso ou denominador fecha.

As 70 fontes de código e configuração executadas (16 produtoras do bundle, 56
entradas do build nativo e 5 de verificação, com sobreposição) correspondem à
implementação `708767945f1330211a69522144d6537d8d8b814c` por `git show`/SHA-256.
A execução partiu de `72155bc` com uma árvore idêntica à da implementação; este
pin pós-commit não é uma nova corrida.
