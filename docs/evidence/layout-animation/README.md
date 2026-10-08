# LayoutAnimation do RN sobre o LayoutAnimationDriver original, no relógio de quadros

Esta fatia do GF-19 (Animated e layout animation) faz o `LayoutAnimation` ORIGINAL do RN 0.87.1, lido
pelo import público `react-native`, rodar sobre o `LayoutAnimationDriver` C++ original do próprio RN. Até aqui
o host compilava o binding de `configureNextLayoutAnimation`, mas nunca instalou um delegate de animação no
`UIManager`: a chamada era um no-op silencioso, e só o timer de JS que o `LayoutAnimation.js` arma contra o fim
nativo (`duration + 17` ms) terminava um `configureNext`, com o commit montado de uma vez. Agora o host compila
`react/renderer/animations` (as três fontes, sem subclasse e sem cópia), instala o driver como o `Scheduler` do
RN instala, entrega a cada superfície um delegate de override que encaminha ao driver e registra cada transação
que ele serve, e usa o relógio de quadros do host como o display link do driver: um quadro só é tick enquanto há
uma animação em voo, e o tick roda o `UIManager::animationTick()` com o timestamp do quadro. O relógio que o RN lê
é o tempo de quadro do pump em milissegundos inteiros. Updates animam o layout (x, y, largura e altura), creates
entram com opacidade ou escala crescente, deletes saem com opacidade ou escala decrescente, com as curvas linear,
easeInEaseOut e spring; o driver chama `onAnimationDidEnd` (o timer do RN segue como reserva e o RN chama o
callback uma vez) e `onAnimationDidFail` para uma config que ele não consegue interpretar. O
`UIManager.configureNextLayoutAnimation` legado delega ao Fabric e o `setLayoutAnimationEnabledExperimental` é um
no-op, como no `BridgelessUIManager`. O [recibo](execution.json) fixa fontes, hashes, capturas e resultados.

Todo link de código abaixo está fixado no commit de implementação
[`ee8f5bd`](https://github.com/journey-studios/godot-fabric/commit/ee8f5bd55e60556bd3fb4408eed11734399ae378)
(árvore `daa2ec27`, filho de `2648ab0`, que trouxe a fatia sobre a main `c858263`), em cujo conteúdo, limpo e
sem arquivos novos, cada comando abaixo rodou.

| Lane executada | Checks | Observação |
| --- | ---: | --- |
| Host anterior `7efa0b06` (main `c858263`) | 38/121 | Exatamente as 83 falhas normativas: sem o driver, nenhum contador, nenhuma transação e nenhuma animação chega ao Control, e todo `configureNext` termina pelo timer de JS do RN, uma vez (`race: "fired"`); os 38 checks sobre o JS do RN e o layout confirmado valem nos dois hosts; o oráculo rejeita o relatório com `The driver is installed` |
| Sabotagem `seconds-clock`, host `3a728d5e` | 46/121 | 75 falhas: o driver lê o tempo de quadro em segundos, então o progresso não anda; o oráculo rejeita com `Transaction 1: RN reads the frame time in whole milliseconds` |
| Sabotagem `no-register-surface`, host `a006279a` | 34/121 | 87 falhas: nenhuma superfície entrega seu coordinator ao driver, que nunca sobrescreve uma transação, então o Control recebe o layout confirmado de uma vez; o oráculo rejeita com `native-end: the driver served the start, at least one frame between, and the end` |
| Sabotagem `no-consumer`, host `f50b11ce` | 35/121 | 86 falhas: a animação deixa de ser consumidora do relógio de quadros, nunca faz tick e para no primeiro quadro (a sonda espera a conclusão do driver com limite); o oráculo rejeita com a mesma frase |
| Sabotagem `drop-callback`, host `fc9e7aaf` | 115/121 | 6 falhas: o executor conta o callback de sucesso e o descarta, então só o timer do RN termina a chamada; o oráculo rejeita com `native-end: only the driver can have ended the call, and it cleared RN's timer` |
| Host atual `8db8bf3d`, headless | 121/121 | Um bundle, uma root, 18 etapas (cada caso, `mount`, `api`, `idle-start`, `idle-end` e `stop`), com o oráculo independente: 3 execuções seguidas (11,9 s, 11,5 s e 12,0 s) e uma sob carga de CPU (8 processos `yes`, load average de 7 a 12, 16,6 s) |
| Exemplo `layout-animation` | 12 headless, 12 com o renderer nativo, 23 com captura | Cliques reais nos dois botões React, cinco capturas |

As lanes executam o mesmo bundle (`2b86de17`), com as mesmas fontes de teste e SDK; só os produtores nativos
diferem. O host anterior foi compilado a partir da main `c858263`, antes de a árvore receber o trabalho desta
fatia, e o binário anterior fica em `build/layout-animation-previous-host/`, local e fora do repositório; o teste só
aceita o controle se o dylib em `addons/` for esse binário (compara o SHA-256). As quatro sabotagens são retidas:
`node scripts/layout-animation-sabotage.mjs` troca um trecho de `native/layout_animation.cpp` ou de
`native/application_runtime.cpp` de cada vez, recompila, roda o runner e o oráculo, restaura a fonte byte a byte
(hash conferido), recompila o host genuíno e registra tudo em um recibo local. O host genuíno e o restaurado têm o
mesmo SHA-256, `8db8bf3d…`.

**Ambiente**: macOS arm64 (26.6.2, Apple M3 Pro, 11 cores); Godot oficial 4.7.2 (`ed1daf0bf`), RN 0.87.1,
React 19.2.3, Hermes 250829098.0.17 e Node v22.23.3. A suíte roda em modo headless; o exemplo, em headless e com o
renderer nativo.

```sh
npm run test:layout-animation
```

Com o host anterior instalado em `addons/`, o mesmo runner confere o controle com
`node tests/layout-animation-native.test.mjs --previous-host`; os hosts sabotados rodam com
`--sabotage=seconds-clock`, `--sabotage=no-register-surface`, `--sabotage=no-consumer` e
`--sabotage=drop-callback`, e o launcher abre o
[exemplo](https://github.com/journey-studios/godot-fabric/blob/ee8f5bd55e60556bd3fb4408eed11734399ae378/examples/layout-animation/README.md)
com `npm run example -- layout-animation` (também `--headless`, `--check` e `--capture`).

> **CI hospedada e Pages pendentes.** O passo `npm run test:layout-animation` e o artefato
> `native-layout-animation` do workflow `contracts.yml` ainda não rodaram na CI hospedada, e nada foi publicado no
> Pages; os dois entram depois do merge. Tudo o que esta página registra é evidência local, em macOS arm64. O
> recibo de fonte (o recibo do bundle, que fixa o SHA-256 de cada fonte executada) **não certifica o build
> nativo** que um runner hospedado faz a partir delas. Esta fatia não completa o GF-19: reduced motion, várias
> roots, a interpolação de estado de Text e Image, segundo plano e retomada, carga de JS, os exports móveis e um
> orçamento por tick seguem abertos.

## O que o RN faz

`Libraries/LayoutAnimation/LayoutAnimation.js` é todo o lado JS. `configureNext(config, onAnimationDidEnd,
onAnimationDidFail)` embrulha o fim em um `onAnimationComplete` idempotente, arma `setTimeout(onAnimationComplete,
config.duration + 17)` contra o fim nativo e chama `nativeFabricUIManager.configureNextLayoutAnimation(config,
onAnimationComplete, onAnimationDidFail ?? function () {})`; o fim nativo limpa o timer, então o callback roda uma
vez, por quem chegar primeiro. O binding (`UIManagerBinding.cpp`) repassa a config e os dois callbacks ao
`UIManager`, que só age se houver um `animationDelegate_`, e é o `Scheduler` quem o instala: primeiro
`setComponentDescriptorRegistry`, depois `setAnimationDelegate(driver)`. Por superfície, o iOS
(`RCTScheduler.mm`) e o Android (`FabricUIManagerBinding.cpp`) entregam ao `MountingCoordinator` o driver como
`MountingOverrideDelegate`, para que ele receba as mutações de cada transação enquanto tem trabalho. O tick é o
`UIManager::animationTick()`, que reentra em `uiManagerDidFinishTransaction`; o iOS o liga e desliga com o
`LayoutAnimationStatusDelegate` (`onAnimationStarted` e `onAllAnimationsComplete`, nas passagens de 0 para N e de
N para 0 animações em voo). O `LayoutAnimationDriver` e o `LayoutAnimationKeyFrameManager` são C++ portátil:
interpretam a config (`conversions.h`), a armam em um campo do driver (global, não de uma superfície), a primeira
transação com mutações a consome e carimba o início com o relógio que o driver lê, e a partir daí cada transação
traz um `Update` por key frame, com o layout interpolado em `Float` e a opacidade e a transformação por
`ViewPropsInterpolation.h`, no fator da curva (`utils.cpp`). Creates e inserts rodam de uma vez e entram a partir de
opacidade 0 (ou escala 0); updates animam da vista antiga para a nova; deletes e seus removes continuam montados e
saem até opacidade 0 (ou escala 0) antes de acontecer. A [nota de pesquisa](../../research/layout-animation.md) tem
as fontes com as linhas.

## O que esta fatia faz

1. Um [`LayoutAnimation`](https://github.com/journey-studios/godot-fabric/blob/ee8f5bd55e60556bd3fb4408eed11734399ae378/native/layout_animation.cpp)
   por `FabricApplication` cria o `LayoutAnimationDriver` original com o `RuntimeExecutor` da aplicação embrulhado
   para contar o que o driver enfileira (`callbacksQueued`), um `LayoutAnimationStatusDelegate` que guarda a flag de
   animação em voo e os contadores `started` e `completed`, e o relógio abaixo; entrega a ele o registry de
   descritores e o instala no `UIManager`, na ordem do `Scheduler.cpp`. Os hunks no
   [`application_runtime.cpp`](https://github.com/journey-studios/godot-fabric/blob/ee8f5bd55e60556bd3fb4408eed11734399ae378/native/application_runtime.cpp)
   são de uma linha cada: `attach`, `register_surface` onde o `start_root` cria a `ShadowTree`, `clock` e `active()`
   onde o pump decide o consumidor do relógio de quadros, `tick` ao lado do quadro do Native Animated,
   `surface_stopped`, `stop` e `snapshot`.
2. As superfícies não recebem o driver, e sim um `RecordingDriver` do módulo: um `MountingOverrideDelegate` que
   encaminha `shouldOverridePullTransaction` e `pullTransaction` ao driver e registra a transação que ele devolve.
   Uma transação é registrada exatamente quando o driver a serviu, porque o coordinator só chama
   `pullTransaction` de um delegate que pediu para sobrescrever; nada é inferido de quantas vezes o driver lê o
   relógio. Os coordinators o seguram por `weak_ptr`: o `stop()` o solta, e o driver, que destrói os `jsi::Function`
   que segura antes do runtime Hermes.
3. O relógio do driver (`setClockNow`) é o `frame_time` do pump, o mesmo timestamp que o relógio de quadros entrega
   ao Animated, em milissegundos inteiros. O runtime o entrega a cada pump e não só nos ticks: um commit que anima,
   ou que interrompe uma animação, puxa entre dois ticks, e um relógio que só andasse nos ticks carimbaria o início
   no último tick. Nunca volta atrás, e não há seam de offset.
4. O driver é um consumidor do relógio de quadros enquanto há uma animação em voo, pela flag do
   `LayoutAnimationStatusDelegate` (como o iOS liga o observer do run loop), não pelo `shouldAnimateFrame()` do
   driver, que também é verdadeiro entre o `configureNext` e o commit e faria um tick sem nada a puxar. Ocioso, nem o
   relógio de quadros nem o driver andam.
5. `status().layoutAnimation` traz `enabled`, `active`, `stopped`, `started`, `completed`, `callbacksQueued`, `ticks`,
   `clockReads`, `frameMs` (o tempo de quadro entregue ao driver), `lastReadMs` (o que o RN leu), `pullsTotal`,
   `pullsDropped` e o anel `pulls` das últimas 64 transações servidas (`sequence`, `godotFrame`, `readMs`, `frameMs`,
   `callbacks`, `active` e as mutações por tipo). Um host sem o módulo não tem a chave.
6. [`src/react-native-platform.jsx`](https://github.com/journey-studios/godot-fabric/blob/ee8f5bd55e60556bd3fb4408eed11734399ae378/src/react-native-platform.jsx)
   exporta o `Libraries/LayoutAnimation/LayoutAnimation.js` original, e
   [`src/private-interface.js`](https://github.com/journey-studios/godot-fabric/blob/ee8f5bd55e60556bd3fb4408eed11734399ae378/src/private-interface.js)
   dá ao `UIManager` os dois métodos legados do `BridgelessUIManager`; os tipos estão em
   `types/react-native.ts` e `tests/types/consumer.tsx`. Qualquer outro método legado segue lançando.
7. O `stop()` desanexa o driver do `UIManager` e o destrói com os callbacks de JS que ele segura, enquanto o
   runtime Hermes está vivo; uma superfície desmontada encerra o interesse do host nos ticks quando nenhuma resta.

## O que foi verificado

O [fixture](https://github.com/journey-studios/godot-fabric/blob/ee8f5bd55e60556bd3fb4408eed11734399ae378/tests/layout-animation-fixture.jsx)
renderiza um palco de três views absolutas, a `box` que muda entre três poses, uma `child` que entra e uma `doomed`
que sai, e roda os casos de
[`tests/layout-animation-cases.mjs`](https://github.com/journey-studios/godot-fabric/blob/ee8f5bd55e60556bd3fb4408eed11734399ae378/tests/layout-animation-cases.mjs)
pelo import público, registrando em ordem cada callback e como o timer de JS do RN terminou cada chamada (armado,
limpo ou disparado). O
[probe](https://github.com/journey-studios/godot-fabric/blob/ee8f5bd55e60556bd3fb4408eed11734399ae378/tests/layout-animation-probe.gd)
lê, uma vez por frame do Godot e antes do próximo frame da aplicação, os contadores do driver, as transações que
ele serviu e a posição, o tamanho, a opacidade e a escala dos Controls reais, o que a última transação aplicou.
Nada nele pede um número de frames, metade de uma animação ou um tempo de parede: espera a conclusão do driver ou
um callback, com um limite que só transforma um travamento em um check reprovado.

Os 121 checks se dividem em 83 normativos, que dependem do driver, e 38 que valem nos dois hosts:

| # | Check da especificação | Onde |
| --- | --- | --- |
| 1 | `configureNext` mais um commit enfileira exatamente um callback de sucesso pelo executor do driver; o JS recebe um `onAnimationDidEnd`, depois da última transação, com o layout final montado e o driver ocioso | `native-end` (`duration` de topo 5000 e `update.duration` 300: o timer do RN não pode disparar antes, e o callback encontra o timer limpo), `mixed`, `interrupt` e os contadores de todo caso animado |
| 2 | Update: x, y, largura e altura de cada transação batem o oráculo em linear, easeInEaseOut e spring (com overshoot); o ponto final é igual a `fabric*`, `onLayout`, `measure` e `getBoundingClientRect` | `update-linear`, `update-ease`, `update-spring`, `legacy` |
| 3 | Create: a opacidade começa em 0, segue o fator e termina em 1; com `scaleXY` o Control começa colapsado (oculto), a escala segue o fator e termina em 1 | `create-opacity`, `create-scale` |
| 4 | Delete: a view continua montada com opacidade (ou escala) decrescente e a última transação a remove | `delete-opacity`, `delete-scale`, `mixed` |
| 5 | `onAnimationDidFail` para uma config que o driver rejeita: um callback de falha, nenhuma animação, os Controls pegam o layout em um passo; o timer do RN ainda termina a chamada | `fail` |
| 6 | O relógio de quadros só faz tick com uma animação em voo; ocioso não anda; o relógio do driver nunca volta | `idle-start`, `idle-end` e cada linha de cada execução |
| 7 | Um segundo `configureNext` com commit no meio da animação continua da vista na tela e termina exatamente no seu layout final | `interrupt` |
| 8 | `UIManager.setLayoutAnimationEnabledExperimental(true)` não lança e não muda nada; `UIManager.configureNextLayoutAnimation` anima como o `LayoutAnimation` | `flag`, `legacy` |

Além deles, `stop` confere que parar a aplicação com uma animação em voo encerra o driver (nenhum tick ou transação
depois, nenhum erro), `mount` e `module` conferem o driver instalado e ocioso antes de qualquer animação, e `api`
confere as exportações públicas e que os métodos legados desconhecidos ainda lançam o erro do RN.

O [oráculo](https://github.com/journey-studios/godot-fabric/blob/ee8f5bd55e60556bd3fb4408eed11734399ae378/tests/layout-animation-oracle.mjs)
é escrito a partir das fontes do RN e nunca lê um veredito do probe: do relógio que o RN leu para cada transação ele
refaz o fator da curva (`utils.cpp`), o layout, a opacidade e a escala de cada nó, as contagens de mutações de cada
transação (um `Update` por key frame, creates e inserts na primeira, removes, deletes e o update final, inclusive o
sintético dos creates, na última), os contadores e o estado do timer de JS do RN, e compara com o relatório. O teste
o alimenta com um relatório cujos checks foram todos marcados como passados, e é ele que rejeita o host anterior e as
sabotagens, sem confiar no probe. Como o relógio é o tempo de quadro do pump, os valores esperados não dependem do
ritmo do host: o relatório de uma execução sob carga é conferido contra as mesmas fórmulas. A maior distância ao
oráculo na execução que gerou o relatório do recibo (359 transações) é **1,8e-5 em posição, 4,2e-8 em opacidade e
4,5e-8 em escala**, contra tolerâncias de 5e-4 e 1e-5 (os Controls e a interpolação do RN guardam floats de precisão
simples).

## Transações observadas

O relógio é o que o RN leu, relativo ao início da animação; a coluna do fim é o que o Control mostrava depois da
transação. Os três casos vêm do relatório da execução sob carga (`rawReportSha256` no recibo).

**Update** (`update-linear`, 600 ms, `box.x` de 20 a 220)

| seq | frame do Godot | relógio - início (ms) | creates | inserts | updates | removes | deletes | `box.x` depois |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 19 | 102 | 0 | 0 | 0 | 1 | 0 | 0 | 20,0000 |
| 20 | 103 | 2 | 0 | 0 | 1 | 0 | 0 | 20,6667 |
| 21 | 104 | 12 | 0 | 0 | 1 | 0 | 0 | 24,0000 |
| 37 | 148 | 314 | 0 | 0 | 1 | 0 | 0 | 124,6667 |
| 53 | 188 | 591 | 0 | 0 | 1 | 0 | 0 | 217,0000 |
| 54 | 190 | 605 | 0 | 0 | 2 | 0 | 0 | 220,0000 |

**Create** (`create-opacity`, preset easeInEaseOut, 300 ms, opacidade de `child`)

| seq | frame do Godot | relógio - início (ms) | creates | inserts | updates | removes | deletes | opacidade depois |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 131 | 421 | 0 | 1 | 1 | 1 | 0 | 0 | 0,0000 |
| 132 | 422 | 3 | 0 | 0 | 1 | 0 | 0 | 0,0002 |
| 133 | 423 | 12 | 0 | 0 | 1 | 0 | 0 | 0,0039 |
| 140 | 444 | 156 | 0 | 0 | 1 | 0 | 0 | 0,5314 |
| 148 | 463 | 287 | 0 | 0 | 1 | 0 | 0 | 0,9954 |
| 149 | 466 | 306 | 0 | 0 | 2 | 0 | 0 | 1,0000 |

**Delete** (`delete-opacity`, preset linear, 500 ms, opacidade de `doomed`)

| seq | frame do Godot | relógio - início (ms) | creates | inserts | updates | removes | deletes | opacidade depois |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 187 | 583 | 0 | 0 | 0 | 1 | 0 | 0 | 1,0000 |
| 188 | 584 | 4 | 0 | 0 | 1 | 0 | 0 | 0,9920 |
| 189 | 585 | 12 | 0 | 0 | 1 | 0 | 0 | 0,9760 |
| 202 | 619 | 247 | 0 | 0 | 1 | 0 | 0 | 0,5060 |
| 216 | 653 | 481 | 0 | 0 | 1 | 0 | 0 | 0,0380 |
| 217 | 656 | 500 | 0 | 0 | 1 | 1 | 1 | removida |

A primeira transação é a do commit: aplica de uma vez os creates e inserts e o quadro de progresso 0 de cada key
frame, então a `box` ainda está no layout antigo, uma view criada está em opacidade 0 (ou colapsada) e uma deletada
está intacta, enquanto `onLayout`, `measure` e a árvore já mostram o layout final. Cada transação seguinte é um
tick, exatamente (`ticks == transações - 1` em uma execução de um commit só, e o relógio de quadros faz tick só
para o driver), e a última traz os removes, os deletes e o update final. O callback de sucesso roda no pump do tick
que completa a animação, depois dele.

## O host anterior e as sabotagens

O host anterior roda o mesmo bundle: o `module` e o `idle` falham, nenhum contador existe, e todo `configureNext`
(`update-*`, `create-*`, `delete-*`, `mixed`, `native-end`) termina pelo timer de JS do RN, uma vez, com o `race`
`"fired"`; um config inválido não chama o callback de falha, e o `interrupt` não tem animação para interromper.
Falha exatamente os 83 checks normativos, e o oráculo rejeita o relatório. As quatro sabotagens (o relógio em
segundos, nenhuma superfície registrada, o driver fora do consumidor do relógio de quadros, o callback de sucesso
descartado) são rejeitadas pelo probe, com 75, 87, 86 e 6 falhas, e pelo oráculo. A sabotagem do consumidor é
detectada por espera com limite, e a do callback só é vista pelos casos `separated`, cuja config deixa o timer do RN
muito atrás da animação.

## Custo por tick

Um tick é o `UIManager::animationTick()`, que roda o `uiManagerDidFinishTransaction` inteiro (o pull pelo driver, as
mutações e o `apply` de cada key frame vivo) uma vez por tick do relógio de quadros. Cronometrado com uma
instrumentação **temporária** do host (um cronômetro em volta de `animationTick()` e nada mais, aplicada e revertida
por um script local, não retida e fora de qualquer gate; os contadores do GF-30 não estão na base desta árvore), sobre
1, 10, 100 e 400 views absolutas de 6 pontos que se movem juntas por 1 s sob um `LayoutAnimation`, três execuções
cada, de 53 a 68 ticks, em um Apple M3 Pro, headless, host de release, no commit `ee8f5bd`:

| Views em movimento | Mediana por tick | p95 por tick | Pior tick |
| ---: | ---: | ---: | ---: |
| 1 | 121 a 135 us | 203 a 389 us | 0,32 a 0,48 ms |
| 10 | 288 a 313 us | 0,50 a 0,78 ms | 0,65 a 1,00 ms |
| 100 | 1,37 a 1,97 ms | 2,5 a 3,0 ms | 3,1 a 3,5 ms |
| 400 | 3,71 a 3,80 ms | 4,3 a 5,4 ms | 6,2 a 6,7 ms |

A máquina tinha outros processos pesados rodando (load average de cerca de 8), e a mesma medição feita antes, com a
máquina mais quieta, deu cerca de metade nas contagens pequenas (mediana de 59 a 62 us com 1 view): o número
depende do ambiente. Um tick de 60 Hz tem 16,7 ms. O custo cresce com o número de key frames vivos,
porque o host aplica cada view de cada transação e não pula uma cuja prop interpolada não mudou. Orçamentos são do
GF-30.

## Método → comportamento observado

Lido do relatório da execução (`execution.json`, `observedBehavior`), em headless:

| API | Observado |
| --- | --- |
| `LayoutAnimation.create(600, 'linear', 'opacity')` e `Presets.easeInEaseOut`, `linear`, `spring` | as configs que o RN monta, idênticas às do oráculo (`duration` 300, 500 e 700, e `springDamping` 0,4 no spring) |
| `configureNext(config, onEnd, onFail)` + commit de update | o driver serve a primeira transação (quadro de progresso 0) e uma por tick; um callback de sucesso; `onEnd` uma vez, com o timer limpo quando o driver ganha |
| `configureNext` com `duration` 5000 e `update.duration` 300 | `onEnd` quando a animação de 300 ms completa, com o timer de JS do RN `cleared`; o timer só dispararia aos 5017 ms |
| Create com `property: 'opacity'` | criada em opacidade 0, a opacidade segue o fator e termina em 1 |
| Create com `property: 'scaleXY'` | criada colapsada (Control oculto), a escala segue o fator e termina em 1 |
| Delete com `property: 'opacity'` ou `'scaleXY'` | continua montada com opacidade ou escala decrescente; a última transação traz o remove e o delete |
| Spring (`Presets.spring`) | passa do layout final em até um quarto da distância, entre 10% e 30% da duração, e termina nele |
| Config inválida (`update: {type: 'bogus'}`) | um `onAnimationDidFail`, nenhuma animação, três linhas de erro do glog que o teste confere, os Controls pegam o layout em um passo; o timer do RN termina a chamada |
| Segundo `configureNext` com commit no meio da animação | o primeiro callback é enfileirado na transação do segundo commit, a `box` continua da vista na tela, e termina exatamente no layout do segundo; `started` 1, `completed` 1, `callbacksQueued` 2 |
| `UIManager.setLayoutAnimationEnabledExperimental(true)` | não lança, retorna `undefined`, nada se move no driver |
| `UIManager.configureNextLayoutAnimation(config, onEnd, onFail)` | anima como o `LayoutAnimation`, sem timer de JS: só o driver chama `onEnd` |
| `UIManager.createView()` e outros métodos legados | seguem lançando `Legacy UIManager.createView is not supported` |
| Parar a aplicação com uma animação em voo | `stopped` verdadeiro, `active` falso, nenhum tick ou transação depois, nenhum erro |

## O exemplo

`npm run example -- layout-animation` abre um cartão com um palco de três tiles e dois botões `TouchableOpacity`.
**Spring row / column** chama `LayoutAnimation.configureNext(LayoutAnimation.Presets.spring)` e troca a
`flexDirection` do palco; **Ease in / out** chama `Presets.easeInEaseOut` e troca o primeiro tile por um quarto, que
entra enquanto o velho sai. A validação envia eventos reais de mouse nos botões e lê os Controls que o driver
atualizou, esperando a conclusão do driver, nunca tempo. Com `--capture` salva cinco quadros do renderer, no estado
em que cada etapa foi lida:

![Antes de qualquer animação](layout-animation-before.png)

**Antes**: os três tiles em linha, um tile e um espaço de distância, o status `idle` e os dois botões em opacidade
plena; o driver está instalado e ocioso (`started` 0, nenhuma transação), e o React renderizou uma vez.

![Durante o spring](layout-animation-spring-mid.png)

**Durante o spring**: o tile laranja não se moveu e os dois outros já saem da linha em direção à coluna (o segundo
cerca de 10 pontos à esquerda e abaixo do seu lugar de origem, o terceiro cerca de 20), o status é `spring: running` e o botão
Spring ainda volta da opacidade do toque. O quadro é pego no primeiro frame em que o terceiro tile passou de 8
pontos de distância e o driver está em voo, com 3 ticks, então é um instante cedo da animação, e o instante exato muda
de uma execução para outra (veja abaixo).

![Depois do spring](layout-animation-spring-end.png)

**Depois do spring**: os três tiles em coluna, exatamente onde o Yoga os colocou (84 pontos de passo), o status
`spring: finished`; o React renderizou três vezes (montagem, pedido e fim), não uma por quadro.

![Durante o ease in / out](layout-animation-ease-mid.png)

**Durante o ease in / out**: o tile laranja, que vai sair, está a cerca de 95% de opacidade e continua montado, os dois do
meio já subiram um pouco (o espaço entre o primeiro e o segundo caiu de 12 para 7 pontos), e o tile amarelo que
entra, na terceira posição, está a cerca de 5%, invisível a olho nu; o status é `easeInEaseOut: running` e o botão Ease ainda
volta da opacidade do toque. Também é um instante cedo: a validação lê o primeiro frame com as duas opacidades entre
5% e 95%.

![Depois do ease in / out](layout-animation-ease-end.png)

**Depois do ease in / out**: o tile laranja foi removido só no fim da animação, e os tiles ciano, roxo e amarelo
estão em coluna, o amarelo opaco; o status é `easeInEaseOut: finished`.

As cinco capturas têm 900 × 680 pixels e foram conferidas uma a uma. Em oito execuções seguidas, as três que mostram um
estado de repouso (antes, depois do spring e depois do ease) saíram idênticas byte a byte, com o mesmo SHA-256; as
duas de meio de animação saíram diferentes entre execuções (três variantes do spring e duas do ease), porque o
renderer desenha o frame seguinte à leitura, e o recibo fixa o SHA-256 das cinco usadas aqui. O exemplo passa 12 checks
em headless, 12 com o renderer nativo e 23 com as capturas.

Com o renderer nativo o relógio de quadros fez um tick por frame do Godot, algumas centenas por segundo nesta
máquina (de 428 a 644 transações em um spring de 700 ms nas execuções nativas deste recibo), e em headless um por
período de 60 Hz (cerca de 40): as animações são função do relógio, então o resultado visual e o fim são os mesmos.

## Regressões

No mesmo commit passaram `npm run test:animated`, `npm run test:frame-clock` e `npm run
test:touchables` (1 teste cada), `node --test tests/platform-seams.test.mjs` (17 testes), o `npm run type-check`, o `npm run
check:static`, o `npm run check:publication`, o `npm run test:contracts` (302 testes Node e 13 Python, com o `test:parity`, 7 testes, e o `test:dashboard`, 43,
dentro dele) e o `npm run test:examples` inteiro (36 exemplos, todos com os checks passando, o `layout-animation` com 12). `LayoutAnimation` entra nos tipos de
`types/react-native.ts`, verificados por `tests/types/consumer.tsx` (uma config sem `duration` e um tipo de animação
desconhecido são rejeitados, e `UIManager` ganha os dois métodos). O `test:performance` do GF-30 não existe nesta base.

## Decisões e divergências aceitas

- O driver é o original, sem subclasse e sem cópia; a lógica de animação não está no host.
- O relógio é o tempo de quadro do pump, entregue a cada pump (não só nos ticks) e truncado em milissegundos
  inteiros, sem seam de offset: o oráculo refaz tudo a partir dos relógios que o RN leu, que cada transação servida
  registra.
- A flag de animação em voo é a do `LayoutAnimationStatusDelegate`, como o iOS liga o observer; um `active()`
  derivado de `shouldAnimateFrame()` faria ticks vazios entre o `configureNext` e o commit.
- As superfícies recebem um delegate de override que encaminha ao driver e o registra (`RecordingDriver`), em
  vez de o driver direto e de um hook no hub: a transação é atribuída exatamente, sem depender de quantas vezes o RN
  lê o relógio.
- A lane é `--previous-host`; os campos do relatório mantêm a convenção do repositório (`expectedOriginalFailures`,
  `originalNegativeObserved`).
- O exemplo faz parte desta entrega por exigência do checklist de documentação, embora a especificação não o
  listasse entre as áreas; as edições compartilhadas são só linhas aditivas em `examples/entry.jsx`,
  `examples/catalog.json` e `examples/README.md`.
- `tests/layout-animation-cases.mjs`, os dados que o fixture e o oráculo compartilham, não está na lista de arquivos
  da especificação; segue o padrão do `native-animated-cases.mjs`.
- A entrada `LayoutAnimation` da auditoria de compatibilidade passou de `missing_public_export` para
  `environment_or_utility_subset`; o cabeçalho datado da auditoria não mudou.
- O custo por tick foi medido com instrumentação temporária, sem gate (os contadores do GF-30 não estão na base).

## Limites

- Reduced motion: `Platform.isDisableAnimations` é `undefined` na plataforma do Godot, então `configureNext` nunca
  pula; a configuração que o `AccessibilityInfo` lê não está ligada a ele.
- Uma root por vez: a animação que o `configureNext` arma é global, e o próximo commit de qualquer superfície a
  consome. Parar uma root com uma animação em voo só é coberto pelo commit vazio da desmontagem e pelo stop da aplicação.
- Segundo plano e retomada, comportamento sob carga de JS, os exports móveis e as execuções hospedadas macOS e iOS.
- `Text` e `Image` animam só o layout (o limite do próprio RN). `type: keyboard` cai em linear; easeIn e easeOut
  rodam as curvas do RN, mas não têm certificado; `delay` e `initialVelocity` são interpretados e não exercitados.
- Uma view deletada continua montada, e portanto atingível por entrada, durante toda a animação, como nas
  plataformas do RN; seu comportamento de ponteiro no Godot não está certificado.
- Os quadros de meio de animação das capturas são o primeiro frame que a validação aceita, cedo na animação, e não o
  meio dela; o instante exato muda entre execuções.
- O custo por tick não tem orçamento (GF-30) e foi medido uma vez, com a máquina carregada.
- Não há CI gráfica: a execução hospedada é headless. CI hospedada e Pages pendentes, como dito acima.
