# Relógio de quadros do host: callbacks de quadro e animação nativa no ritmo de uma tela

Esta fatia faz o host executar os callbacks do `requestAnimationFrame` e os quadros do
Native Animated do RN no ritmo de um display link, e não a cada quadro do loop do Godot.
As plataformas do RN os rodam a partir de um display link (`CADisplayLink` no iOS,
`Choreographer` no Android), que não dispara duas vezes dentro de um período de
atualização e, depois de uma parada, dispara uma vez e atrasado, sem repor os quadros
perdidos. O loop do Godot não tem essa garantia: headless ele roda um quadro a cada 6,9 ms;
sem V-Sync e sem limite, centenas por segundo; e depois de um quadro longo entrega um
quadro de recuperação logo atrás dele, o padrão de um runner hospedado com um vizinho
ocupado (uma parada de dezenas de milissegundos e quadros a 0,4 ms de distância). Os
drivers do RN pressupõem a cadência de uma tela: o decay termina no primeiro passo menor
que 0,1, então quadros quase duplicados o encerram cedo e mudam onde ele pousa. O host
anterior rodava os dois em todo quadro do Godot: o mesmo decay pousava em 13,5 de 50 no
lane `fast`, em 45,6 nas rajadas e em 48,5 headless, onde um ritmo de 60 Hz pousa em 49,4,
e a CI hospedada mostrou quadros quase duplicados dando um degrau contra uma rampa.

Agora o [`FrameClock`](../../../native/frame_clock.h) é o único lugar em que a cadência é
decidida. O runtime o consulta uma vez por quadro do Godot, com o instante do quadro, a
taxa de atualização da tela da janela, o modo de apresentação da janela e se algo consome
quadros (callbacks pendentes, ou um backend do Native Animated com uma animação a rodar).
Só um *tick* executa os callbacks e o quadro de animação; timers, input, a fase do host e a
fila de trabalho seguem a cada quadro do Godot. O host liga o próprio
`requestAnimationFrame` (depois de o `TimerManager` do RN instalar o dele) e o tick passa o
seu timestamp único a todos os callbacks do tick e ao quadro do backend; o rAF do
`TimerManager` do RN 0.87.1 lê `performance.now()` a cada callback, e passar o timestamp
compartilhado do quadro, como os navegadores, é uma partida deliberada. Numa janela que pode
desenhar, apresentada com V-Sync numa tela real (`Presentation`), todo quadro com consumidor
é tick, por mais perto que esteja do anterior; num loop que nada pacia (`Time`: headless,
V-Sync desligado ou mailbox, ou uma janela que não pode desenhar, como a minimizada, em que
o loop principal do Godot soma uma espera por quadro mesmo com V-Sync), com `T = 1000 / R`
ms, o quadro em `t` é tick se nenhum tick serviu um consumidor ainda, ou se `t` está a pelo
menos `T / 2` do quadro anterior do Godot, ou a pelo menos `T` do tick anterior. Oito ritmos
de loop, rodando um decay nativo do RN, um laço de callbacks e um
intervalo de zero lado a lado, são comparados com um oráculo independente que refaz cada
decisão do relógio a partir dos instantes de quadro que o host informa e o pouso do decay
a partir dos timestamps entregues. O [recibo](report.json) fixa fontes, hashes e
resultados.

A tabela é a execução do commit `e67f82c`; depois da revisão da CI e do PR a detecção ganhou a
janela que não pode desenhar e os checks deixaram de supor o que a máquina entrega (nota
abaixo e seção Depois da revisão).

| Lane executada | Checks | Observação |
| --- | ---: | --- |
| Host anterior `cc89e2d4` (main `b274a0c`) | 13/42 | Exatamente as 29 falhas de cadência: sem relógio, o snapshot não tem contadores, os callbacks e os quadros do backend chegam a 0,4 ms um do outro depois de uma parada, o decay pousa em 13,5 no lane `fast`, 45,6 nas rajadas e 48,5 headless; passam os 13 checks que valem em qualquer host |
| Host atual `6745423f`, headless | 42/42 | Oito ritmos de loop (limitado a 60 fps, headless, sem limite, rajadas de um runner hospedado, tela de 144 Hz, o mesmo loop numa tela que não informa taxa, e os quadros encadeados de uma janela com V-Sync apresentados e cronometrados), os casos de callbacks e de relógio, e a parada |
| Sabotagem `always` (retida), host `bc4a2048` | 21/42 | 21 falhas nesta execução, todas de cadência: o relógio faz tick em todo quadro com consumidor, qualquer que seja o ritmo; o oráculo rejeita o relatório |
| Sabotagem `idle` (retida), host `6525a0b9` | 37/42 | 5 falhas nesta execução, 4 de cadência e 1 de base: o relógio decide sem perguntar se algo consome quadros e conta ticks de quadros ociosos; o oráculo rejeita o relatório |
| Sabotagem `presentation` (retida), host `bd88d09a` | 41/42 | 1 falha: o relógio aplica a regra de tempo a uma janela apresentada com V-Sync; o oráculo rejeita o relatório |
| Teste de unidade do relógio (C++) | 14 testes | Instantes de quadro sintéticos pelo mesmo `FrameClock`, com limites em frações binárias exatas e 24 ritmos pseudoaleatórios com semente fixa |
| Suítes existentes | contagens inalteradas | As 35 suítes nativas do `native-cold-start` e o `test:examples` têm as mesmas contagens do registro dos transforms singulares; o `test:frame-clock` é novo |

> Nota posterior (2026-10-06): depois da revisão do PR e da primeira CI hospedada, duas mudanças
> alteraram o que as seções abaixo descrevem. A primeira, o commit
> [`e6d42a4`](https://github.com/journey-studios/godot-fabric/commit/e6d42a4efa8cb224c7db82a24625341eeb21f9e8):
> o `detect_pacing` ganhou a entrada `can_draw` (`DisplayServer.window_can_draw`), e uma janela
> que não pode desenhar, como a minimizada, passa a `Time` com origem `undrawable`, porque o
> loop principal do Godot soma o `low_processor_usage_mode_sleep_usec` por quadro enquanto
> nenhuma janela desenha, mesmo com V-Sync, e essa espera, não a apresentação, pacia os quadros.
> A segunda, o commit
> [`8fc4627`](https://github.com/journey-studios/godot-fabric/commit/8fc46279d6126b87e4fc6cc1d982f75620dfc3b5):
> a CI hospedada reprovou o check `pipelined/The Godot loop alternates frames about 13 ms and 3 ms apart` e,
> por consequência, o `time-bimodal/...`, porque o runner macOS é lento e instável demais para
> produzir quadros de 3 ms; o probe e o oráculo deixaram de supor o que a máquina entrega. Os
> cinco checks que afirmavam o ritmo do loop (`<lane>/The Godot loop runs at the pace the lane
> names, so the lane exercises it` nos quatro lanes de `Time` e o `pipelined/...`) viraram
> observações (`observedPace` no relatório e linhas `FRAME_CLOCK_PACE` no log), o
> `time-bimodal/` e o `fallback-144/` passaram a afirmar a regra sobre os quadros que vieram
> (vazia quando nenhum veio), o probe aceita `--replay=<relatório>` e o conjunto é de 37
> checks, 29 de cadência e 8 de base. A tabela e os números abaixo seguem como executados no
> `e67f82c`; a seção [Depois da revisão](#depois-da-revisão) traz a verificação da árvore
> revista.

O host anterior é o `cc89e2d4`, o que o [registro dos transforms singulares](../singular-transforms/README.md)
executou, compilado do commit `ca9f195`; entre `ca9f195` e a base desta fatia (`b274a0c`)
mudaram só documentos, o painel, dois scripts de exemplo dos transforms, quatro scripts
dos transforms e os três arquivos de teste do Animated, então as fontes nativas e de SDK dele
são as da base. O host atual foi recompilado a partir das fontes do commit
[`e67f82c`](https://github.com/journey-studios/godot-fabric/commit/e67f82ca54a83c8cfbc7db6e97ae11a70871ea2d),
com as fontes nativas tocadas pelo commit forçadas a recompilar, e reproduz o hash
`6745423f`. As lanes executam o mesmo bundle; só os produtores nativos diferem.

```sh
npm run test:frame-clock
node tests/frame-clock-native.test.mjs --allow-original-negative
node scripts/frame-clock-sabotage.mjs
.deps/build/frame_clock_test
```

O primeiro roda o lane atual em headless, com o relatório e o log em `build/`, passa o
relatório pelo oráculo e confere, quando presentes, os controles locais (o host anterior e
as três sabotagens: o mesmo bundle, as mesmas fontes de teste e de SDK, só os produtores
nativos diferem). O segundo, com o host anterior instalado em `addons/`, confere o
controle: exige que falhem exatamente os 29 checks que o probe lista como de cadência. O
terceiro, as sabotagens retidas, reconstrói o host com cada uma das três quebras do
`FrameClock::frame`, roda o lane contra ele, restaura a fonte byte a byte (os hashes estão
no recibo) e reconstrói o host genuíno. O quarto é o teste de unidade em C++.

## O que o RN faz

O RN nunca roda quadros de animação a partir de um loop simples: cada plataforma pergunta
à tela.

- **`requestAnimationFrame` é um timer da plataforma.** O `TimerManager` C++ o cria como
  um timer de 0 ms, de um disparo só, cujo callback recebe `performance.now()`
  (`ReactCommon/react/runtime/TimerManager.cpp`, linhas 319-367; o comentário das linhas
  360-362 diz que equivale a `setTimeout(0)`) e entrega o timer à plataforma. No iOS o
  registro bridgeless chama `createTimerForNextFrame:` (`ObjCTimerRegistry.mm`, linhas
  48-61): o timer só é invocado no próximo quadro, por mais vencido que esteja, e uma
  duração abaixo de 18 ms roda em todo quadro (`React/CoreModules/RCTTiming.mm`, linhas
  375-389). O `RCTTiming` dispara os timers vencidos no `didUpdateFrame:` (linhas 242-317),
  que o `RCTDisplayLink` chama a partir de um `CADisplayLink`
  (`React/Base/RCTDisplayLink.m`, linhas 32 e 118-147), pausado enquanto nenhum observador
  tem timer pendente (linhas 149-163). No Android o `JavaTimerManager` posta um
  `Choreographer.FrameCallback` e dispara os timers vencidos no `doFrame(frameTimeNanos)`;
  o `createTimer` dele documenta o mesmo contrato (`JavaTimerManager.kt`, linhas 33-35,
  173-189 e 285-315).
- **O Native Animated tem um choreographer.** O `AnimationBackend` compartilhado pede ao
  choreographer um `resume()` quando o primeiro callback começa e um `pause()` quando o
  último sai (`ReactCommon/react/renderer/animationbackend/AnimationBackend.cpp`, linhas
  136-165), e o `onAnimationFrame(timestamp)` roda todos os callbacks uma vez (linhas
  119-134). O choreographer do iOS é um `CADisplayLink` criado no primeiro `resume()` e
  pausado pelo `pause()`, e entrega o `targetTimestamp` do link, o instante em que o quadro
  deve aparecer na tela (`React/Fabric/RCTScheduler.mm`, linhas 141-189). O do Android
  repassa o tempo de quadro do `Choreographer` do próprio callback
  (`FabricUIManagerBinding.cpp`, linhas 64-73).
- **O que um display link garante.** Nem as fontes do RN nem este repositório o
  implementam: é o contrato do `CADisplayLink` e do `Choreographer`. No máximo um callback
  por período de atualização e, depois de uma parada, um callback atrasado, porque as
  atualizações perdidas no meio são descartadas, nunca repostas. Os drivers do RN foram
  escritos para essa cadência. O driver de decay
  (`ReactCommon/react/renderer/animated/drivers/DecayAnimationDriver.cpp`, linhas 34-79)
  calcula `from + v / (1 - d) * (1 - e^(-(1 - d) t))` no tempo desde o primeiro quadro e
  termina no primeiro quadro cujo passo em relação ao valor anterior é menor que 0,1, sem
  escrever o valor desse quadro: o nó guarda o anterior. Onde ele pousa depende, portanto,
  da distância entre os quadros. Com velocidade 0,5 e desaceleração 0,99 a assíntota é 50:
  quadros a 1 ms terminam em 40,006, a 6,9 ms em 48,519, a meio período de 60 Hz (8,33 ms)
  em 48,824 e a um período inteiro em 49,445. O driver JS
  (`Libraries/Animated/animations/DecayAnimation.js`, linhas 94-113) lê `Date.now()` e
  aplica o valor antes de terminar, e o relógio não o altera.

## O que este host fazia

O `ApplicationRuntime::pump` tirava um snapshot dos callbacks de quadro pendentes e
chamava `NativeAnimated::frame` uma vez por quadro do Godot, qualquer que fosse o ritmo do
loop. Headless o loop roda um quadro a cada 6,9 ms; sem limite, na mesma máquina, milhares
no tempo de um decay; e depois de uma parada entrega os quadros de recuperação colados. No
host anterior, nesta máquina e headless, o mesmo decay pousa em 13,5 de 50 no lane `fast`
(a CPU roda centenas de quadros enquanto o decay dá passos de fração de milissegundo e
termina cedo), 45,6 nas rajadas e 48,5 com o loop padrão, onde um ritmo de 60 Hz pousa em
49,4. A CI hospedada mostrou o outro lado: quadros quase duplicados dando um degrau
contra a rampa de uma animação (a nota do commit
[`4d8312d`](https://github.com/journey-studios/godot-fabric/commit/4d8312d98766d8ca44b0020b24e6483e4f572f04)
no registro dos transforms singulares), que aquele commit contornou no oráculo de dois
lanes e esta fatia remove na origem.

## O que o Godot entrega

O Godot chama o `_process` da aplicação uma vez por quadro renderizado, na thread
principal, que também é a thread JS deste host. O que chega à tela depende da janela:

- **Headless** não tem tela nem display: `DisplayServer.screen_get_refresh_rate` devolve
  -1 (uma seam de validação informa um valor) e nada apresenta nem pacia os quadros.
- **Uma janela com V-Sync** (o padrão do projeto) bloqueia na tela quando apresenta, e a
  CPU corre à frente dela: o motor encadeia os quadros. Num Mac M3 Pro de 120 Hz, no
  renderizador Compatibility, os quadros vieram a 120 por segundo em média, em dois
  grupos, a cerca de 3 ms e 13 ms de distância (seção de medidas em tela real).
- **Sem V-Sync** o loop roda o mais rápido que a espera do motor permite: 2.400 quadros em
  1,45 s no mesmo Mac, cerca de 1.657 por segundo.
- `Engine.max_fps = 60` limita os dois: 60,0 quadros por segundo com V-Sync ligado e
  desligado.
- `DisplayServer.screen_get_refresh_rate(screen)` informa 120,0 aqui e custa 0,35 µs por
  chamada, então o host a lê a cada quadro e acompanha a janela entre telas.
- `window_set_vsync_mode` com `ADAPTIVE` ou `MAILBOX` volta como `ENABLED` neste
  renderizador, então nenhuma janela daqui roda nesses modos: o teste de unidade é o único
  lugar em que o mapeamento deles executa.

## A mudança

1. **O relógio.** O [`FrameClock::frame`](../../../native/frame_clock.h) recebe o instante
   do quadro, a taxa da tela, o `Pacing` e se há consumidor, e devolve se o quadro é tick.
   Sem consumidor nunca há tick, e então o modo decide:
   - **`Presentation`** (janela numa tela real que pode desenhar, V-Sync ligado ou
     adaptativo): todo quadro com consumidor é tick, por mais perto que esteja do anterior.
     O motor bloqueia na tela e apresenta cada quadro do processo como uma imagem; o tempo
     entre os quadros do Godot não diz nada aqui, porque a CPU corre à frente da tela e eles
     chegam encadeados (os de 3 ms de uma janela de 120 Hz incluídos).
   - **`Time`** (headless, V-Sync desligado ou mailbox, janela que não pode desenhar, ou
     desconhecido): com `T = 1000 / R` ms, sendo `R` a taxa que a tela da janela informa
     quando positiva e finita e 60 caso contrário (o fallback do próprio Godot e o
     intervalo de um quadro que o RN assume), o quadro em `t` é tick se, e somente se,
     nenhum tick serviu um consumidor ainda, ou `t − (quadro anterior do Godot) ≥ T / 2`,
     ou `t − (tick anterior) ≥ T`. Todo quadro do Godot, tick ou não, é o quadro anterior do
     seguinte; só um tick é o tick anterior. Uma janela que não pode desenhar (a minimizada,
     por exemplo) não é apresentada: o loop principal do Godot soma o
     `low_processor_usage_mode_sleep_usec` por quadro enquanto nenhuma janela desenha, com
     V-Sync ou sem, e essa espera, não a apresentação, pacia os quadros.

   `T / 2` é arredondar ao período de atualização mais próximo: a maior tolerância que
   nunca afina um loop já pacificado na taxa da tela com jitter abaixo de `T / 2`. No modo
   `Time`, e só nele: dois ticks nunca ficam mais próximos que `T / 2` (um tick é ele mesmo
   um quadro do Godot, então o tick anterior está no quadro anterior ou antes); um loop
   limitado à taxa da tela (`Engine.max_fps`) ou mais lento faz tick em todo quadro
   enquanto o jitter ficar abaixo de `T / 2`; um loop mais rápido que `T / 2` faz tick cerca
   de uma vez por `T`; uma parada dá um tick tardio e os quadros de recuperação atrás dele
   esperam; e depois de ocioso o primeiro quadro com consumidor faz tick na hora quando está
   vencido, isto é, quando nenhum tick serviu um consumidor ainda, quando começa a `T / 2`
   do quadro anterior ou quando passou um período desde o último tick; num loop mais rápido
   que `T / 2`, um pedido a menos de um período do último tick espera o período acabar,
   como um display link. O modo `Time` serve só a loops que nada pacia: aplicado a um loop
   apresentado, afinaria os quadros que chegam à tela, e `Presentation` não tem nenhuma
   dessas garantias (os ticks podem ficar tão próximos quanto os quadros do pipeline do
   motor).
2. **A detecção.** O `FrameClock::detect_pacing(headless, vsync_mode, can_draw)` devolve o
   modo e a origem: servidor headless dá `Time` com origem `headless` (e vem primeiro: as
   janelas dele também não desenham); uma janela que não pode desenhar dá `Time`
   (`undrawable`); V-Sync ligado ou adaptativo numa janela que pode desenhar dá
   `Presentation` (`vsync`); desligado ou mailbox dá `Time` (`unpaced`); sem
   `DisplayServer`, a aplicação fica em `Time` com a origem `unknown`. O
   [`FabricApplication`](../../../native/fabric_application.cpp) lê, por quadro, a taxa da
   tela da janela (`screen_get_refresh_rate`), o modo de V-Sync da janela
   (`window_get_vsync_mode`) e se ela pode desenhar (`window_can_draw`: o Godot 4.7.2
   expõe esse método por janela e não o `can_any_window_draw` que o loop principal
   consulta), então uma janela que muda de tela, de modo ou de estado vale a partir do
   quadro em que a mudança é lida. Duas metas da aplicação declaram o que o servidor
   headless não informa numa execução de validação: `validation_refresh_rate` (Hz) e
   `validation_frame_pacing` (`presentation` ou `time`, com origem `validation`).
3. **O runtime.** O [`pump`](../../../native/application_runtime.cpp) consulta o relógio
   uma vez por quadro, depois do esgotamento das microtasks: o consumidor é um callback
   de quadro pendente ou um backend do Native Animated ativo
   ([`NativeAnimated::active()`](../../../native/native_animated.cpp): ele pediu quadros e
   ainda não pediu pausa, e a aplicação não parou). Só um tick tira o snapshot dos
   callbacks de quadro e os executa, e chama o `NativeAnimated::frame`; o que um callback
   registra espera o próximo tick. O `requestAnimationFrame` é o do próprio host (ligado
   logo depois de o `TimerManager::attachGlobals` instalar o do RN, em
   `application_runtime.cpp`): não é um timer de 0 ms, e o tick passa o seu timestamp
   único, o mesmo, a todos os callbacks do tick e ao quadro do backend, enquanto o rAF do
   `TimerManager` do RN 0.87.1 amostra o `performance.now()` quando cada callback roda
   (`TimerManager.cpp`, linhas 343-357). É uma partida deliberada: os navegadores passam o
   timestamp compartilhado do quadro, e um display link entrega um tempo de quadro só.
   Timers, input, a fase do host e a fila de trabalho seguem a cada quadro, e nada roda
   depois do stop.
4. **O snapshot.** A aplicação informa `frameClock` com `periodMs`, `refreshRate`,
   `rateSource` (`display` ou `fallback`), `pacing`, `pacingSource`, `frames`, `ticks`,
   `skippedFrames` (os quadros em que um consumidor esperou sem tick), `lastFrameMs` e
   `lastTickMs`.
5. **O que não muda.** `setTimeout` e `setInterval` seguem a cada quadro do Godot (item
   aberto em Limites), e o `performance.now()` usa o mesmo relógio monotônico dos
   timestamps de tick.

## O que foi verificado

O [fixture](../../../tests/frame-clock-fixture.jsx) roda o decay nativo do RN (velocidade
0,5, desaceleração 0,99, pelo import público) numa caixa por execução, um laço de
`requestAnimationFrame` e um intervalo de zero lado a lado, e registra em ordem tudo o que
o JS observa. O [probe](../../../tests/frame-clock-probe.gd) conduz a aplicação por oito
ritmos e lê, a cada quadro do Godot, o snapshot do relógio, os contadores do backend e o
Control real da caixa. Os checks de cadência precisam do relógio (os contadores dele, as
decisões que a regra dá aos quadros que vieram, ou o pouso que ticks a meio período de
distância dão); os de base valem em qualquer host. Nenhum check supõe o que a máquina
entrega: a regra é afirmada sobre os quadros que vieram (um quadro a menos de meio período
do anterior e a menos de um período do último tick espera, onde algum veio, e a condição vale
vazia onde nenhum veio), o que cada lane entregou é uma observação, e o que um check conta
existe por construção (o lane roda até seguir 40 quadros e 8 ticks, as paradas do lane
`bursts` são esperas que o Pacer insere, e cada pedido do caso dos callbacks segue 40 quadros
ociosos). O [oráculo](../../../tests/frame-clock-oracle.mjs) foi escrito a partir do
contrato do relógio e do driver de decay do RN, não do probe nem do C++: recebe os instantes
de quadro que o host informa e recalcula, para cada quadro, se ele tinha de ser tick, o que
o JS e o backend receberam nele e onde o driver de decay pousa a partir dos quadros que
recebeu, em `float`, como o driver faz. Para quadros nunca mais próximos que `T / 2`, o
decay pousa numa janela cujo piso o oráculo deriva da regra do próprio driver,
`assíntota − 0,1 / (1 − e^(−(1 − d) passo))` com `passo = T / 2` (48,749 a 60 Hz), e cujo
teto é a assíntota, 50. O teste de unidade prova a regra nos padrões exatos (os quadros
encadeados de 13 e 3 ms, um quadro de recuperação a 0,4 ms de uma parada, um loop de 1.000
quadros por segundo, ritmos aleatórios).

Execução do `e67f82c`:

| Lane (ritmo do loop) | Quadros do Godot | Ticks | Esperaram | Pouso do decay |
| --- | ---: | ---: | ---: | ---: |
| `paced-60`: `Engine.max_fps = 60` | 55 | 45 (58,8/s) | 1 | 49,39 |
| `headless`: o loop padrão, 6,9 ms | 114 | 36 (49,8/s) | 69 | 49,43 |
| `fast`: sem limite | 2.734 | 41 (57,0/s) | 2.684 | 49,41 |
| `bursts`: parada de 57 ms a cada 5 quadros | 65 | 17 | 39 | 49,87 |
| `display-144`: loop de 144 fps, tela que informa 144 Hz | 113 | 104 (144,0/s) | 0 | 48,33 |
| `fallback-144`: o mesmo loop, tela que não informa taxa | 114 | 37 (50,4/s) | 68 | 49,53 |
| `presentation-bimodal`: quadros de 13 e 3 ms, apresentados | 75 | 66 (todo quadro) | 0 | 48,76 |
| `time-bimodal`: os mesmos quadros, cronometrados | 74 | 33 | 32 | 49,60 |

Os números de cada lane variam de execução para execução (o ritmo do loop não é
determinístico); o [recibo](report.json) guarda os desta execução, e os checks afirmam o
que vale em qualquer uma. O host anterior pousa o decay desses lanes em 49,37 (`paced-60`),
48,51 (`headless`), 13,49 (`fast`), 45,61 (`bursts`), 48,55, 48,45, 48,68 e 48,41. O pouso
do `display-144` é mais baixo porque o piso da janela dele, com meio período de 3,47 ms a
144 Hz, é 47,07, e o do `presentation-bimodal` fica abaixo dos lanes de `Time` porque um
tick de `Presentation` carrega o tempo de CPU do quadro (item aberto em Limites).

- **Os callbacks.** Um quadro que nada espera não é tick nem quadro esperado; um pedido
  depois de ocioso chega ao callback no quadro seguinte do Godot, com o timestamp do
  quadro; esse quadro é um tick que o relógio conta e o timestamp é o do relógio; um
  pedido cancelado antes do quadro nunca roda e não deixa tick nem quadro esperado; os
  callbacks registrados antes de um quadro rodam nele, em ordem, com um timestamp só; e um
  callback pedido de dentro de um callback roda num tick posterior, a pelo menos meio
  período do primeiro. Cada pedido segue 40 quadros ociosos, cerca de 0,28 s na execução do
  recibo (o loop headless dorme 6,9 ms por quadro), mais de dezesseis vezes o `T` de 16,7 ms,
  e o primeiro pedido é também o primeiro consumidor da execução, que nenhum tick serviu
  ainda: o quadro seguinte está vencido pela regra, quaisquer que sejam os quadros que a
  máquina entregue no caminho.
- **O relógio.** Uma tela que não informa taxa dá o período de 60 Hz e os contadores
  começam em zero; um servidor headless dá o modo `Time`, porque não apresenta nada; e a
  taxa da tela informada (144 Hz) define o período do relógio.
- **Os ritmos.** Em cada lane de `Time` (`paced-60`, `headless`, `fast` e `bursts`, e os de
  144 Hz e de V-Sync cronometrado abaixo): um callback de quadro roda exatamente nos quadros
  em que o relógio faz tick, cada um com o timestamp do tick, nunca a menos de meio período
  do anterior; os ticks nunca ficam mais próximos que meio período; o backend do Native
  Animated entrega no máximo um quadro por tick, nunca entre ticks, com o timestamp do tick;
  um intervalo de zero dispara uma vez em todo quadro do Godot, tick ou não (o que os timers
  fazem hoje); e o decay nativo termina e pousa dentro da janela. O lane `bursts` exige
  ainda que cada parada, que o Pacer insere por construção (57 ms a cada cinco quadros), dê
  um tick tardio e que o quadro de recuperação atrás dela, onde a máquina entregou um,
  espere. O mínimo de meio período entre ticks vale só no modo `Time`; em `Presentation`
  todo quadro com consumidor é tick.
- **O decay.** O pouso cai na mesma janela sob todo ritmo, rajadas de runner hospedado
  incluídas.
- **A tela.** Com taxa de 144 Hz informada, callbacks e quadros de animação rodam em ticks
  a pelo menos metade desse período; a mesma carga numa tela que não informa taxa cai para
  o período de 60 Hz: os ticks ficam a meio período dele e os quadros que vieram a menos de
  meio período do anterior, a menos de um período do último tick, esperam (a condição vale
  vazia onde a máquina não entregou nenhum).
- **A apresentação.** Em `Presentation` todo quadro do Godot com consumidor é tick, por mais
  perto que esteja do anterior (os de 3 ms, onde a máquina os entrega), e roda um callback e
  um quadro de animação; em `Time` os mesmos quadros são julgados pelo tempo: os que vieram a
  menos de meio período do anterior e a menos de um período do último tick esperam, e os
  ticks ficam a meio período de distância.
- **O que a máquina entregou.** Cada lane registra o que a máquina entregou (quadros, a
  mediana do intervalo, os quadros a menos de meio período do anterior, as paradas e os
  quadros de recuperação), em `observedPace` do relatório e em linhas `FRAME_CLOCK_PACE` do
  log: é uma observação, não um check. Num runner macOS hospedado os lanes `bimodal` tiveram
  mediana de 28 ms e um quadro (o apresentado) ou nenhum (o cronometrado) a menos de meio
  período do anterior, e o lane de 60 fps teve 14 paradas de 50 ms ou mais; os checks
  valeram do mesmo jeito, vazios onde nenhum quadro curto veio.
- **A parada.** Parar a aplicação com um laço pendente encerra os ticks e deixa um estado
  de relógio só.

## Controles

O host anterior (`cc89e2d4`) roda o mesmo bundle e falha exatamente os 29 checks de
cadência: sem relógio o snapshot não traz `frameClock`, todo quadro com consumidor é tick (o
quadro de recuperação de uma parada roda o callback e a animação a cerca de 0,4 ms do
anterior) e o decay pousa onde esses passos o levam (13,49 no lane `fast`, 45,61 nas
rajadas, 48,51 headless). Os 13 checks de base passam nos dois hosts. O oráculo rejeita o
relatório do host anterior mesmo com todos os checks do probe marcados como passados.

As três sabotagens são retidas e ficam em
[`scripts/frame-clock-sabotage.mjs`](../../../scripts/frame-clock-sabotage.mjs): cada uma
quebra uma decisão do `FrameClock::frame`, reconstrói o host, roda o probe e o oráculo,
restaura a fonte byte a byte (o hash do `native/frame_clock.h` restaurado é igual ao do
genuíno) e reconstrói o host genuíno, cujo hash volta a ser `6745423f`.

- **`always`** troca a decisão por `tick = consumer`: todo quadro com consumidor faz tick,
  qualquer que seja o ritmo, que é a cadência do host anterior agora informada por um
  relógio. Falhou 21 checks nesta execução (18 a 21 nas execuções locais seguintes, conforme
  os quadros curtos que a máquina entrega no lane `paced-60`), todos de cadência: nos lanes
  `paced-60`, `headless`, `fast` e `bursts` os callbacks, os ticks e os quadros do backend
  caem em quadros que a regra manda esperar, o decay termina cedo no `headless`, no `fast` e nas rajadas, e o lane
  `bursts` deixa de dar um tick tardio por parada com o quadro de recuperação esperando; o
  callback pedido de dentro de um callback roda a menos de meio período do primeiro; e
  nos lanes `display-144`, `fallback-144` e `time-bimodal` fazem tick os quadros que
  deviam esperar. Diferente do host anterior, ele tem os contadores, então só o que a
  própria cadência faz pode rejeitá-lo.
- **`idle`** troca por `tick = pacing == Presentation || due`: decide sem perguntar se algo
  consome quadros, então faz tick (e conta o tick) para quadros que nada espera. Falhou 5
  checks nesta execução (3 a 5 nas seguintes): o relógio que deve começar com zero ticks, o
  quadro ocioso que não é tick nem esperado, o tick que o relógio conta, o pedido cancelado
  que não deixa tick, e um check de base, o do pedido depois de ocioso, porque o tick contado
  para um quadro ocioso pode recusar o quadro que o pedido esperava (depende da fase dos
  quadros).
- **`presentation`** troca por `tick = consumer && due`: ignora que a janela é apresentada
  com V-Sync e aplica a regra de tempo a ela. Falha 1 check, o do lane `presentation-bimodal`
  (todo quadro apresentado com consumidor é tick), numa máquina que entrega quadros curtos:
  os quadros de 3 ms do V-Sync encadeado esperam, e as imagens que a tela mostra perdem a
  atualização de cada quadro descartado.

Quantos checks cada sabotagem falha depende dos quadros que a máquina entregou, então uma
sabotagem é cobrada por uma falha e pela rejeição do oráculo, não por uma contagem. O oráculo
rejeita o relatório de cada sabotagem, com todos os checks do probe marcados como passados;
a primeira recusa de cada um está no recibo. O recibo local das três quebras fica
em `build/frame-clock-sabotage.json` e não entra no Git; o corpo dele está no recibo desta
fatia.

Os controles e as sabotagens das duas fatias que dividem o host foram reconstruídos da
árvore commitada, para que os recibos locais descrevam o host desta: o Animated (o host
anterior a ele falha 59 dos 75 checks, a sabotagem `frames` 31 e a `persistence` 2) e os
transforms singulares (a sabotagem do ramo `collapsed` falha 2 checks). A fonte voltou
byte a byte e o host restaurado é o genuíno nos dois.

## Medidas em tela real

Estas medidas não fazem parte do recibo nem da suíte: um script descartável (fora do
repositório) rodou a aplicação, com o laço de `requestAnimationFrame` do probe, numa janela
de verdade num MacBook Pro M3 Pro de 120 Hz (renderizador Compatibility do Godot 4.7.2) e
leu o snapshot da aplicação a cada quadro do Godot. O [recibo](report.json) guarda cada
execução.

| V-Sync | `max_fps` | Quadros | Intervalo entre quadros (mín / mediana / p90 / máx, ms) | Modo (origem) | Ticks | Quadros que esperaram |
| --- | ---: | --- | --- | --- | --- | ---: |
| ligado | 0 | 720 em 6.000 ms (120,0/s) | 1,06 / 8,30 / 13,03 / 16,15 | `presentation` (`vsync`) | 720 (120,0/s) | 0 |
| ligado | 0 | 720 em 6.004 ms (119,9/s) | 1,24 / 8,32 / 13,25 / 18,31 | `presentation` (`vsync`) | 720 (119,9/s) | 0 |
| desligado | 0 | 2.400 em 1.449 ms (1.656,9/s) | 0,50 / 0,53 / 0,66 / 11,38 | `time` (`unpaced`) | 166 (114,6/s) | 2.234 |
| ligado | 60 | 360 em 5.999 ms (60,0/s) | 10,76 / 16,67 / 17,17 / 22,49 | `presentation` (`vsync`) | 360 (60,0/s) | 0 |
| desligado | 60 | 360 em 5.997 ms (60,0/s) | 8,78 / 16,65 / 17,30 / 24,07 | `time` (`unpaced`) | 360 (60,0/s) | 0 |

Em todas, `rateSource` foi `display` e a taxa 120,0 (período 8,333 ms). Com V-Sync ligado
os intervalos vêm em dois grupos (na primeira execução, 234 de até 6 ms e 440 entre 8 e 14
ms, de 720), a média é a taxa da tela e nenhum quadro esperou: uma regra sobre o tempo
entre quadros descartaria imagens que a tela mostra. Sem V-Sync o relógio faz tick a
114,6 por segundo, perto do teto de 120 (a regra exige `T` desde o último tick e os quadros
são discretos, a 0,53 ms). Com `Engine.max_fps = 60`, ligado ou desligado, todo quadro é
tick, a 60,0 por segundo. `window_set_vsync_mode` com `ADAPTIVE` ou `MAILBOX` leu de volta
`ENABLED` neste renderizador, e `screen_get_refresh_rate` custa 0,35 µs por chamada.

Depois da revisão, na árvore revista (host `f96d9dfc`), a janela minimizada, com V-Sync ligado
e o `low_processor_usage_mode_sleep_usec` em 30 ms para distingui-lo do V-Sync de 8 ms: o
Godot 4.7.2 não expõe o `can_any_window_draw`, e o `DisplayServer.window_can_draw` da janela
deu falso enquanto ela estava minimizada e verdadeiro visível e restaurada. Sem a aplicação, os
quadros vieram a 116 a 119 por segundo visível ou restaurada, qualquer que fosse a espera, e a
33,3 por segundo minimizada (mediana de 29,9 a 30,0 ms), e com a espera padrão de 6,9 ms a
janela minimizada rodou a 145 por segundo (três execuções): o V-Sync não pacia uma janela que
não desenha. Com a aplicação nessa janela, o snapshot leu `time` com origem `undrawable` em
todos os 60 quadros da janela minimizada (33,3 ticks por segundo, um por quadro, nenhum
esperou) e `presentation` com origem `vsync` em todos os 240 quadros depois da restauração
(119,1 ticks por segundo). Em outras execuções a janela também informou que não podia
desenhar sem estar minimizada, nos primeiros segundos ou no meio da execução (os quadros
foram pacificados pela espera do mesmo jeito, e a mesma aplicação leu `undrawable` em 237 dos
240 primeiros quadros de uma delas), e verdadeiro desde o primeiro quadro em outras: o que o
SO informa decide, e o host o segue quadro a quadro. Só a minimização foi forçada de
propósito; a oclusão por outras janelas não foi exercitada de forma controlada.

## Sob paradas externas

Também fora do recibo: um script descartável (fora do repositório) congelou e liberou
(`SIGSTOP` e `SIGCONT`) o processo do Godot que roda o probe, com durações aleatórias, de
modo que os quadros chegam como num runner hospedado, uma parada e depois quadros colados.
Na árvore commitada e com os controles presentes, o `test:frame-clock` e o `test:animated`
passaram em 6 de 6 execuções cada com paradas de 20 a 70 ms a cada 3 a 40 ms de execução, e
em 10 de 10 cada com paradas de 40 a 150 ms a cada 2 a 15 ms. A suíte não afirma nada
disso; o [recibo](report.json) guarda as séries.

## Depois da revisão

Duas mudanças, em dois commits, vieram depois do recibo acima (que segue como executado em
`e67f82c`, com o host `6745423f`): a revisão do PR pediu que a detecção tratasse a janela que
não pode desenhar
([`e6d42a4`](https://github.com/journey-studios/godot-fabric/commit/e6d42a4efa8cb224c7db82a24625341eeb21f9e8)),
e a primeira CI hospedada
([run 37521566298](https://github.com/journey-studios/godot-fabric/actions/runs/37521566298))
reprovou o `test:frame-clock`, de modo que os lanes passaram a julgar só os quadros entregues
([`8fc4627`](https://github.com/journey-studios/godot-fabric/commit/8fc46279d6126b87e4fc6cc1d982f75620dfc3b5)).
A verificação abaixo é da árvore revista (os dois commits e os documentos desta revisão), com o
host `f96d9dfc`.

**A janela que não pode desenhar** (commit `e6d42a4`: `native/frame_clock.h`,
`native/fabric_application.cpp`, `native/frame_clock_test.cpp`). O loop principal do Godot soma o
`low_processor_usage_mode_sleep_usec` a cada quadro enquanto nenhuma janela desenha, com
V-Sync ou sem, então numa janela minimizada o V-Sync não pacia nada e um `Presentation` faria
tick em todo quadro de um loop que a espera pacia. O `detect_pacing` ganhou a entrada
`can_draw` (`DisplayServer.window_can_draw`, o único dos dois métodos que o Godot 4.7.2 expõe
a script e a GDExtension; o `can_any_window_draw` que o loop consulta não existe na API) e
devolve `Time` com origem `undrawable` quando a janela não desenha, depois do headless e antes
da leitura do V-Sync. O teste de unidade ganhou o mapeamento (qualquer modo de V-Sync com
janela que não desenha dá `undrawable`, o headless vem primeiro, e a transição de uma janela
minimizada e restaurada vai de `Presentation` a `Time` e volta no quadro seguinte, com os
quadros de 13 e 3 ms), e duas mutações do mapeamento (sem a entrada, e com ela antes do
headless) são rejeitadas por ele. Numa janela de verdade a aplicação leu `time` com origem
`undrawable` em todos os quadros da janela minimizada e `presentation` com origem `vsync`
depois da restauração (seção Medidas em tela real).

**Checks que não supõem o que a máquina entrega** (commit `8fc4627`:
`tests/frame-clock-probe.gd`, `tests/frame-clock-oracle.mjs`,
`tests/frame-clock-native.test.mjs` e um comentário em `tests/native-animated-probe.gd`). O runner macOS
hospedado, reproduzido a partir do artefato `native-frame-clock` da run, não entregou os
quadros de 3 ms dos lanes encadeados (mediana de 28 ms, um quadro a menos de meio período do
anterior no apresentado e nenhum no cronometrado) e parou o processo de dezenas de
milissegundos a 200 ms o tempo todo (14 paradas de 50 ms ou mais só no lane de 60 fps, com
os quadros de recuperação atrás). Dos 42 checks, o
`pipelined/The Godot loop alternates frames about 13 ms and 3 ms apart, so the lanes exercise that timing`
e, por consequência, o
`time-bimodal/Under Time pacing the same frames are thinned: the 3 ms ones wait and ticks stay half a period apart`
falharam. A auditoria de cada lane do probe e do oráculo achou as premissas abaixo, e cada
uma virou uma garantia por construção, uma regra sobre os quadros entregues ou uma
observação:

| Premissa sobre o loop | Onde estava | Hoje |
| --- | --- | --- |
| O loop corre no ritmo que o lane nomeia | quatro checks de base (`paced-60`, `headless`, `fast`, `bursts`) no probe e `verifyPacing` no oráculo | observação (`observedPace`, linhas `FRAME_CLOCK_PACE`), não check |
| O loop entrega quadros de 13 e 3 ms | o check `pipelined/...` e o oráculo | observação |
| Os quadros de 3 ms esperam | `time-bimodal`: `waited_frames > 0` no probe e `waited > 0 && loopTicks < loopFrames` no oráculo | a regra sobre os quadros entregues: o quadro a menos de meio período do anterior e a menos de um período do último tick espera, e vale vazia onde nenhum veio |
| Um loop de 144 fps é afinado a no máximo um tick por 16,7 ms | `fallback-144`: limites de 0,7 e 1,2 no probe e no oráculo | a mesma regra sobre os quadros entregues, no período de 60 Hz |
| Um loop de centenas de quadros por segundo faz tick em menos de 25% dos quadros | oráculo (`fast`) | removida: o oráculo recalcula cada decisão, e a taxa de ticks é observação |
| As paradas têm quadros de recuperação atrás | `bursts`: 3 paradas e 3 recuperações no probe e no oráculo | as paradas são esperas que o Pacer insere (por construção, pelo menos 3); as recuperações são julgadas onde vieram |
| Callbacks, ticks, quadros do backend e disparos do intervalo em número mínimo (5, 5, 2, 20) | probe e oráculo | por construção: o lane roda até seguir 40 quadros e 8 ticks |
| Um pedido depois de ocioso chega no quadro seguinte | caso `callbacks` | por construção: 40 quadros ociosos (cerca de 0,28 s) e o primeiro pedido é o primeiro consumidor, que nenhum tick serviu |

O conjunto passou a ser de 37 checks, 29 de cadência e 8 de base (os 29 são os de antes,
três deles com o nome e a condição reescritos: `fallback-144/...` e `time-bimodal/...` com a
regra sobre os quadros entregues, e `presentation-bimodal/...` sem a promessa dos quadros de
3 ms no nome). O probe aceita `--replay=<relatório>`: avalia os mesmos checks sobre os lanes de um
relatório gravado, sem a aplicação, e o runner repete isso sobre o relatório da própria
execução e exige os mesmos veredictos (`node tests/frame-clock-native.test.mjs
--replay=<relatório>` roda o replay e o oráculo sobre um relatório de qualquer máquina).

**O replay do artefato da CI hospedada.** O artefato da run 37521566298 passa nos 36 checks
que o replay avalia (o 37º registra que o relatório foi salvo) e o oráculo o aceita nos oito
lanes; o probe de antes reprovava dois checks nele, e o oráculo de antes o rejeitava, com
`presentation-bimodal: the Godot loop ran at the pace the lane names`. O mesmo replay dá 36
checks sem falha sobre o relatório local do `e67f82c` e os mesmos 29 checks de cadência
reprovados sobre o do host anterior.

**Verificação da árvore revista.** Teste de unidade do relógio (14 testes) passa; o lane
atual do `test:frame-clock` passa com os controles presentes, sob carga (quatro execuções com
onze laços ocupados, um por núcleo), sob paradas externas de 20 a 70 ms (seis de seis) e sob
paradas de 40 a 150 ms (dez de dez); o host anterior falha exatamente os 29 checks de
cadência (os mesmos nomes de antes) e as sabotagens retidas, reconstruídas do host revisto,
falham pelo menos um check e são rejeitadas pelo oráculo (18 a 21, 3 a 5 e 1 checks nas três
execuções locais); os controles e as sabotagens do Animated (59, 31 e 2 falhas) e dos
transforms singulares (2) foram refeitos no host novo.

Os 48 passos do job `native-cold-start` depois da instalação do Godot e do `npm run setup`,
na ordem do workflow, mais o `test:examples` e o `test:recovery`, rodaram nesta árvore, com
diretórios novos para o SDK e os adaptadores (apagados depois), e passaram, cada suíte com a
contagem do [registro dos transforms singulares](../singular-transforms/README.md), exceto a
do relógio, que agora tem 37 checks. Um ajuste só de comentários veio depois da bateria (o
espaçamento de meio período dito do modo `Time` nos probes e no oráculo): os controles do
relógio e do Animated foram refeitos e os passos `animated` e `frame-clock` rodaram de novo e
passaram; as primeiras execuções deles, antes do ajuste, também tinham passado. Os gates do
job de contratos (264 testes de Node e 13 de Python, análise estática e varredura de
publicação) e o `test:recovery` passaram na árvore final. O recibo
(`report.json`) guarda os passos, os hashes dos logs e as contagens em `postReview` e, para
cada um dos sete arquivos de código e de teste que a revisão mudou, o commit que o tem
([`e6d42a4`](https://github.com/journey-studios/godot-fabric/commit/e6d42a4efa8cb224c7db82a24625341eeb21f9e8)
para os três de `native/`,
[`8fc4627`](https://github.com/journey-studios/godot-fabric/commit/8fc46279d6126b87e4fc6cc1d982f75620dfc3b5)
para os quatro de `tests/`) e o SHA-256, conferido contra `git show <commit>:<arquivo>`.

## Capturas

O relógio não tem saída visual: o que muda é quando os callbacks de quadro e a animação
nativa executam, e não o que aparece na tela. Por isso a fatia não tem exemplo nem
captura; a evidência é o probe headless, o oráculo, os controles e as medidas fora do
recibo acima.

## Regressões

Todos os passos do job `native-cold-start` depois da instalação do Godot e do
`npm run setup`, na ordem do workflow, mais o `test:examples` e o `test:recovery`, rodaram
na árvore commitada e passaram na primeira execução. Cada suíte mantém a contagem do
[registro dos transforms singulares](../singular-transforms/README.md):

- **Suítes nativas:** exemplos 2.262 checks em 23 exemplos (animated 12, transforms 309),
  guards de transformações 61 mais 25 de entrada, Down 2.731, Document Up 6.459, View Up
  297, Move 220, Document Move 1.940, hover 158, root path 82, Document hover 1.530, click
  728, notificações de captura 672, PanResponder 128, AppState 75, listas 44, Appearance
  79, Switch 108, toques compartilhados 92, touchables 93 (a lane `animated` com 7),
  ActivityIndicator 33, Animated 75, comandos de foco 112, módulos nativos 76, despacho de
  eventos 647 e as consultas e resolvers com falha 187 e 66.
- **Novas:** `test:frame-clock` com 42 checks (37 depois da revisão) e o teste de unidade com 14 testes.
- **SDK e adaptadores:** teste de fatores afins 57.703, codegen nativo com 6 unidades de
  tradução, SDK `pack` e `verify`, registro de adaptadores 207, loader 89, consumidor 30 de
  build/posse e 40 nativos, adaptadores em runtime, partida a frio com 2 importações novas e
  `parity:godot` com 13 casos. Os passos do SDK e dos adaptadores recusam um diretório de
  saída que já existe e rodaram em diretórios novos (`build/*-stageb`), apagados depois.
- **Controles e sabotagens:** o host anterior e as três sabotagens do relógio, as do
  Animated e a dos transforms singulares foram refeitos antes (seção Controles).

Cada passo tem o código de saída, a duração e o hash do log no recibo.

## Contratos atualizados

Testes de fatias anteriores contavam quadros do Godot para esperar um callback de quadro ou
uma animação; com o relógio, o ritmo é do host. O commit
[`e67f82c`](https://github.com/journey-studios/godot-fabric/commit/e67f82ca54a83c8cfbc7db6e97ae11a70871ea2d)
os trocou por esperas de ticks ou de condições, e os registros executados deles seguem
como história, com uma nota posterior em cada um:

- **Animated.** Os cinco checks de driver nativo `native-timing`, `native-spring`,
  `native-decay`, `native-created` e `native-xy` que afirmavam que o pedido chega ao
  próximo quadro do backend, um quadro do Godot depois da chamada, foram renomeados
  (`<n>/The request reaches the backend's next frame-clock tick: the first tick after the
  call delivers its first frame`). O oráculo passou a exigir que o primeiro quadro entregue
  seja o primeiro tick depois do pedido, no máximo um tick por quadro do Godot e o backend
  rodando só em tick; a permissão de latência das pernas do `TouchableOpacity` saiu. O
  escopo do relatório trocou `frameClockIsGodotsTick: true` por `false` e ganhou
  `frameClockIsDisplayPaced: true`. O `native-race` adia o esvaziamento da fila do RN por
  três ticks de `requestAnimationFrame` (eram 90 ms de `setTimeout`) e o `native-stop`
  espera dois quadros entregues (eram 120 ms). A suíte continua com 75 checks.
- **Touchables e exemplo `animated`.** A lane `animated` dos touchables espera a opacidade
  chegar a 0,5 com o backend ocioso, e a volta a 1 com duas retomadas, em vez de 12 e 60
  quadros do Godot (a suíte continua com 93 checks); o clique do exemplo `animated` espera
  o botão chegar a 0,4 em vez de seis quadros.
- **Runtime (`runtime_errors.gd`).** O check `A failed callback cannot prevent unrelated
  queued work` deixou de afirmar a ordem exata `["after-frame","timeout","after-timeout"]`:
  timers rodam a cada quadro do Godot e callbacks de quadro só em ticks, então quem roda
  primeiro é o ritmo do host. Afirma que os três callbacks rodaram e que os dois timers
  mantiveram a ordem; o nome do check e os outros cinco ficam.
- **Consumidor externo.** Os casos de reentrância de RAF e de timer da validação do
  consumidor esperam o sinal nativo ter pedido o stop ou a retirada (`frames_after`) e só
  então dão dez quadros ao desmonte, em vez de dez quadros do Godot desde o agendamento. Os
  nomes dos checks e as contagens não mudam.
- **CI.** O job `native-cold-start` ganhou o passo `test:frame-clock` e o artefato
  `native-frame-clock`, depois dos do Animated.
- **Documentos.** A [API](../../API.md), a [arquitetura](../../ARCHITECTURE.md), a decisão
  V2-D11 da [arquitetura 2.0](../../ARCHITECTURE_V2.md), o índice de evidências, o README,
  o ROADMAP e a pesquisa do Animated passam a descrever o relógio; os registros executados
  do Animated, do runtime, do desligamento por callbacks nativos e da retirada de roots
  ganharam uma nota posterior apontando para este.

## Limites

- **Timers.** No iOS e no Android todo timer mais curto que um quadro dispara no próximo
  quadro da tela, um callback por quadro (`RCTTiming.mm`, linha 387; `JavaTimerManager.kt`,
  linhas 285 em diante). Os timers deste host seguem a cada quadro do Godot: `setTimeout(fn,
  0)` e intervalos curtos não são quantizados em ticks, o que o check de base `A zero-delay
  interval fires once on every Godot frame, tick or not` registra. Uma cadeia de
  `setTimeout` de zero itera no ritmo do loop do Godot, centenas de vezes por segundo
  headless, onde o RN itera na taxa da tela. Aberto.
- **Timestamps de apresentação.** Um tick de `Presentation` carrega o tempo de CPU do
  quadro do Godot, então os passos entre ticks são tão irregulares quanto esses quadros (3 e
  13 ms no lane encadeado), e um decay, que termina no primeiro passo abaixo de 0,1, pousa
  abaixo do que pousaria numa cadência regular (48,76 nesta execução, 48,40 numa anterior,
  contra 49,4 a 49,9 nos lanes de `Time`). O display link do iOS entrega ao RN o
  `targetTimestamp`, que é regular, e o `frameTimeNanos` do Android é o instante do vsync;
  um timestamp regular de apresentação não está implementado. Aberto.
- **`ADAPTIVE` e `MAILBOX`.** O `detect_pacing` os mapeia (`ADAPTIVE` apresenta na cadência
  da tela como `ENABLED`; `MAILBOX` não espera por ela) e só o teste de unidade os cobre: o
  renderizador Compatibility deste Mac devolve os dois como `ENABLED`.
- **Telas reais.** Os lanes são headless e declaram a apresentação com V-Sync e a taxa pelas
  duas seams de validação, e a detecção `undrawable` é coberta pelo teste de unidade e por
  execuções com janela fora do recibo; as medidas em tela real são uma execução exploratória
  de cada na tela de 120 Hz de um Mac, fora do recibo. Taxas de atualização variáveis, telas externas,
  suspensão e retomada do SO, comportamento sob carga de JS, orçamentos de quadro (GF-30) e
  exports Android e iOS do Godot não são cobertos.
- **O timestamp do `requestAnimationFrame`.** O host liga o próprio `requestAnimationFrame`
  (`application_runtime.cpp`, logo depois de o `TimerManager` do RN instalar o dele) e o tick
  passa o seu timestamp único a todos os callbacks do tick e ao quadro do Native Animated. O
  rAF do `TimerManager` do RN 0.87.1 é um timer de 0 ms cujo wrapper lê `performance.now()`
  quando cada callback roda (`TimerManager.cpp`, linhas 343-357), então dois callbacks do
  mesmo quadro veem horas diferentes; os navegadores passam o timestamp compartilhado do
  quadro e um display link entrega um tempo de quadro só, e é isso que o host faz, de
  propósito. É uma partida registrada, não um item aberto.
- **Escopo.** Nenhum GF, checkpoint, peso ou denominador fecha: o GF-05 e o GF-19 não estão
  na primeira fatia, então o checkpoint de fatia de cada um, já fechado, não muda. A CI
  hospedada desta fatia está pendente.

Na execução, as 101 fontes de código e configuração executadas (26 do commit, 19 do bundle
do probe, 65 entradas do build nativo e 18 de verificação, com sobreposição) correspondem à
implementação `e67f82ca54a83c8cfbc7db6e97ae11a70871ea2d` por `git show`/SHA-256, e o recibo
registra as 19 fontes originais do RN que o bundle e as referências de plataforma usam. A
execução foi feita na própria árvore commitada (base `b274a0c`, árvore
`983960ea6b510ae660f8dd44af100353e1b145e0` idêntica à da implementação, sem alterações
locais de código), então este pin não é uma corrida nova. Depois da revisão, os sete arquivos
de código e de teste que mudaram (três em `native/` e quatro em `tests/`) estão fixados no
`postReview.pins` do recibo, cada um com o commit que o tem (`e6d42a4` ou `8fc4627`) e o
SHA-256 conferido por `git show <commit>:<arquivo>`; as demais fontes executadas seguem as do
`e67f82c`. Os relatórios brutos, os logs, os
hosts preservados e os recibos locais das sabotagens ficam em `build/` e não entram no Git.
