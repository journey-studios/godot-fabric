# Baselines de nós, heap e tempos do host: um soak de quatro cargas

Esta fatia, a primeira do GF-30, faz o host dizer o que conta e o que cronometra do próprio
trabalho: uma seção `performance` no snapshot da aplicação, com contadores exatos das views
nativas, o heap vivo do Hermes lido depois de uma coleta completa, e o tempo de cada `pump`
dividido em JS, mount e layout (este último é o que a telemetria do próprio RN cronometrou na
revisão). Um harness monta e desmonta quatro cargas (uma raiz mínima; `Button`, `TextInput` e
`Switch`; um gráfico do react-native-chart-kit; uma `FlatList` de 120 linhas) 20 vezes cada, e
confere o que vale em qualquer ritmo de máquina: depois de cada ciclo os nós da SceneTree, os
órfãos do Godot e as views nativas voltam ao baseline da própria execução, as invariantes dos
contadores e das fases valem em toda leitura, e o heap vivo em repouso não sobe mais de 2.048
bytes acima do primeiro ciclo estável. Tempos, memória residente e memória estática do Godot são
só registrados, com proveniência, e nunca entram em gate. A fatia mede e não orça: nenhum
orçamento por dispositivo é decidido aqui. O [recibo](execution.json) fixa fontes, hashes e
resultados; a [nota de pesquisa](../../research/performance.md) tem as fontes do RN e do Hermes
com linhas, o contrato dos campos e a justificativa do método.

Todo link de código abaixo está fixado no commit de implementação
[`ad87234`](https://github.com/journey-studios/godot-fabric/commit/ad8723449abcab24fa5b38e41f3deac5c5a162fe)
(árvore `0b4523e7`). Cada fonte executada, listada em `sourcePins` do recibo, tem o mesmo SHA-256
que o blob desse commit: os documentos que o commit também traz não são entrada de nenhum comando.

| Lane executada | Checks | Observação |
| --- | ---: | --- |
| Host anterior `ad0ecf73` (main `585ca1b`) | 14/41 | Exatamente as 27 falhas normativas: sem a seção, o snapshot não diz o que o host conta, cronometra ou guarda no heap; passam os 14 checks que valem em qualquer host (a proveniência e, por carga, nós, órfãos e views que a própria superfície relata) |
| Sabotagem `leak` (retida), host `530ea5b9` | 37/41 | Exatamente 4 falhas, uma por carga: o host não libera os Controls das views de uma raiz aposentada, e só a contagem de órfãos do Godot vê; os contadores do host e a SceneTree continuam certos. O oráculo rejeita o relatório com `idle cycle 0: Godot counts no orphan beyond the baseline's` |
| Sabotagem `heap` (retida), host `ceb7c3c2` | 38/41 | Exatamente 3 falhas: a leitura do heap é feita uma vez e repetida, de modo que não segue o que o JS guarda nem a contagem de coletas sobe. O oráculo rejeita o relatório com `baseline: the heap counts live bytes and collections` |
| Sabotagem `phase` (retida), host `4ad58f48` | 39/41 | Exatamente 2 falhas: cada amostra de fase entra duas vezes. O oráculo rejeita o relatório com `baseline: phase js has at most one sample per pump (90 > 45)` |
| Host atual `866ab18d`, headless | 41/41 | Quatro cargas × 20 ciclos, a fonte de heap, três turnos de JS ocupado, o controle sem montagem e o oráculo independente sobre 254 leituras |
| Negativos no relatório gravado | 4 | Heap congelado, fase contada duas vezes, nó que sobra na SceneTree e heap que sobe 3.000 bytes: o probe falha exatamente os checks esperados e o oráculo rejeita cada um; 2.048 bytes exatos passam nos dois |
| Teste de unidade do acúmulo (C++) | 12 testes | Tempos sintéticos pelo mesmo `PerformanceMetrics`, com ranks exatos e 40 sequências pseudoaleatórias de fases, cobranças e pumps aninhados |
| Suítes existentes | contagens inalteradas | `test:contracts` (283 testes Node e 13 Python), `test:frame-clock`, `test:runtime`, `test:application` e `test:parity` passam; o `test:performance` é novo |

As lanes executam o mesmo bundle (`a7bccf24`) e as mesmas fontes de teste e de SDK; só os
produtores nativos diferem (`performanceNativeProducers`). O host anterior foi compilado a partir
da main `585ca1b`, antes de a árvore receber o trabalho desta fatia, e o binário anterior fica em
`build/performance-previous-host/`, local e fora do repositório. As três sabotagens são retidas:
[`scripts/performance-sabotage.mjs`](https://github.com/journey-studios/godot-fabric/blob/ad8723449abcab24fa5b38e41f3deac5c5a162fe/scripts/performance-sabotage.mjs)
troca um trecho de `native/application_runtime.cpp` (duas vezes) ou de
`native/performance_metrics.h` de cada vez, recompila, roda o runner e o oráculo, restaura a fonte
byte a byte (hash conferido), recompila o host genuíno e registra tudo em um recibo local. O host
genuíno e o restaurado têm o mesmo SHA-256, `866ab18d…`.

**Ambiente**: macOS 26.6.2 arm64, Apple M3 Pro (11 núcleos); Godot oficial 4.7.2 (`ed1daf0bf`),
RN 0.87.1, React 19.2.3, Hermes 250829098.0.17 (coletor Hades, concorrente) e Node v22.23.3. O
servidor de display é o `headless`; o motor ainda nomeia o driver `opengl3`, mas nada é desenhado.

> **Os tempos headless não representam um display.** O loop headless anda a cerca de 6,9 ms por
> quadro e nada o pacia ([relógio de quadros](../../research/frame-clock.md)); a CI hospedada é
> mais lenta e mais ruidosa que esta máquina. Por isso nenhuma duração, a memória residente ou a
> memória estática do Godot é verificada: as tabelas abaixo são o que o harness registra numa
> execução, que varia em dezenas de por cento de uma execução para outra e com a carga da máquina,
> e não um orçamento nem uma promessa.

```sh
npm run test:performance
.deps/build/performance_metrics_test
```

Com o host anterior instalado em `addons/`, o mesmo runner confere o controle com
`node tests/performance-native.test.mjs --allow-original-negative`; as sabotagens retidas rodam com
`node scripts/performance-sabotage.mjs` (que usa `--sabotage=leak`, `--sabotage=heap` e
`--sabotage=phase`), e um relatório gravado, de uma CI hospedada por exemplo, é julgado de novo,
no Godot e pelo oráculo, com `node tests/performance-native.test.mjs --replay=<relatório>`.

> **CI hospedada pendente.** O passo `npm run test:performance`, o passo
> `.deps/build/performance_metrics_test` e o artefato `native-performance` do workflow
> `contracts.yml` ainda não rodaram na CI hospedada. Tudo o que esta página registra é evidência
> local, em macOS arm64. Só o checkpoint `slice` da primeira fatia do GF-30 fecha com ela; nenhum
> GF completo, outro checkpoint, peso ou denominador fecha.

## O que o harness faz

Cada carga é uma raiz própria, montada por um `FabricSurface` e desmontada ao ser tirada da
árvore. O ciclo faz três leituras entre dois quadros do Godot, nunca dentro de um `pump`: antes do
mount, com a superfície assentada (estado `mounted` e contadores e filas do host sem se mexer por
seis quadros, uma espera por estado e não por tempo) e depois da aposentadoria da raiz e da
liberação da superfície. Cada leitura traz o que o motor conta (nós da SceneTree, monitores de nós,
órfãos e objetos, memória estática e o RSS do processo) e o que o host relata depois de uma coleta
completa do heap do Hermes. A coleta e as amostras brutas só vêm com as metas de validação
`validation_collect_garbage_on_status` e `validation_performance_samples`, que o probe liga ao
redor de cada leitura. Os 3 primeiros ciclos de cada carga são aquecimento.

Além dos soaks, a fonte de heap é perguntada (uma leitura, 100.000 objetos JS retidos, uma leitura,
a liberação, uma leitura), três turnos de JS ocupado por 30 ms dentro de um timer mostram a fase de
JS contando o que de fato rodou, e um controle toma as mesmas leituras de um ciclo sem montar nada.

Os 41 checks são 14 que valem em qualquer host e 27 que precisam da seção. O
[`probe`](https://github.com/journey-studios/godot-fabric/blob/ad8723449abcab24fa5b38e41f3deac5c5a162fe/tests/performance-probe.gd)
julga só o que vale em qualquer ritmo de máquina, as leituras que recebeu: ciclos que voltam ao
baseline, `creates - deletes` igual às views vivas, contadores e totais que só crescem, fases cuja
soma não passa do `pump` e que não têm mais amostras que ele, números finitos e não negativos, uma
fonte de heap que acompanha o JS (reter sobe, soltar desce, a contagem de coletas sobe a cada
leitura), um turno de JS ocupado contado na fase de JS, o limite do heap em repouso e, sem a meta,
um snapshot só com agregados. O
[oráculo](https://github.com/journey-studios/godot-fabric/blob/ad8723449abcab24fa5b38e41f3deac5c5a162fe/tests/performance-oracle.mjs)
recalcula tudo isso do relatório, sem ler os resultados do probe, e recalcula os percentis por
nearest rank a partir das amostras brutas do host (e, onde a série tem no máximo 128 amostras,
também a soma e o máximo). Os acúmulos, a janela e os percentis são
[`native/performance_metrics.h`](https://github.com/journey-studios/godot-fabric/blob/ad8723449abcab24fa5b38e41f3deac5c5a162fe/native/performance_metrics.h),
alimentados pelo `pump`, pelo callback de mounting e pelo início e a aposentadoria das superfícies em
[`native/application_runtime.cpp`](https://github.com/journey-studios/godot-fabric/blob/ad8723449abcab24fa5b38e41f3deac5c5a162fe/native/application_runtime.cpp).

## Baselines medidos

Uma execução, a que este recibo fixa: Apple M3 Pro, macOS arm64, headless, Godot 4.7.2, Hermes
250829098.0.17, 20 ciclos por carga (3 de aquecimento). As colunas de mount são a soma dos `pump`s do
começo do ciclo até a superfície assentada, as de unmount da superfície assentada até a liberada;
"p50 / p95" são os nearest ranks sobre os 20 ciclos, em milissegundos.

| Carga | Views nativas | Commits por ciclo | Heap vivo em repouso (bytes) | Heap com a raiz montada, sobre o repouso (bytes) |
| --- | ---: | ---: | ---: | ---: |
| idle | 2 | 1 | 1.790.616 | +21.840 |
| forms | 5 | 1 | 1.803.896 | +63.832 |
| chart | 71 | 1 | 1.820.872 | +263.520 |
| list | 124 | 1 | 1.933.112 | +1.448.784 |

| Carga | Mount: `pump` p50 / p95 | JS p50 | Mount p50 | Layout p50 | Unmount: `pump` p50 / p95 | `surfaces.retire` p50 / p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| idle | 0,52 / 1,08 | 0,35 | 0,09 | 0,01 | 0,20 / 0,27 | 0,59 / 0,80 |
| forms | 1,44 / 24,01 | 0,83 | 0,33 | 0,09 | 0,23 / 0,59 | 0,67 / 1,28 |
| chart | 6,65 / 31,79 | 3,18 | 3,23 | 0,06 | 0,40 / 0,52 | 0,91 / 1,23 |
| list | 18,12 / 49,94 | 12,01 | 4,05 | 1,43 | 1,69 / 2,19 | 2,57 / 4,03 |

As colunas de fase são a mediana de cada fase sobre os ciclos, então não somam a mediana do `pump`.
O `pump` do unmount contém também os pumps ociosos que o host roda entre a retirada da raiz e a
aposentadoria dela. O tempo de parede de cada mount fica de fora: é o número de quadros que o probe
esperou (seis estáveis, a cerca de 6,9 ms), que é o loop e não o mount. O primeiro render do React e
o commit do unmount rodam fora de um `pump`, então as fases de mount e layout só veem o que rodou
dentro de um; o custo da aposentadoria está em `surfaces.retire` e o do início de uma superfície
(`surfaces.start`, cerca de 0,06 ms por chamada) é só o da chamada, porque o primeiro render é
agendado e roda nos pumps seguintes.

Com nada montado e o bundle carregado, o heap vivo era de 1.790.472 bytes, a SceneTree tinha 2 nós
sem órfãos e os bytes externos do Hermes eram 0 (1.100 depois que uma carga rodou). Reter 100.000
objetos JS de duas propriedades subiu o heap coletado em 13.840.984 bytes (138 por objeto) e soltá-los
o devolveu a 40 bytes de onde estava; três turnos de JS ocupados por 30 ms foram contados 30,02 a
30,06 ms na fase de JS, dentro de 30,07 a 30,13 ms de pumps. A memória residente ficou entre 90 e
188 MB nos soaks (ela oscila dezenas de megabytes nos dois sentidos dentro de uma execução), e a
memória estática do Godot cresceu 62,9, 63,0, 65,7 e 66,6 KB por ciclo contra 60,5 KB no controle que
não monta nada: o crescimento do soak é o probe guardando as próprias leituras. Medido uma vez à mão,
com um script descartável que não faz parte do harness, uma árvore de 124 `Panel` e `Label` do Godot
puros adicionados e liberados 120 vezes, sem o Fabric, mostrou a mesma escada de degraus (cerca de
30 KB, 61 KB, 123 KB e 246 KB nos mesmos ciclos): é um contêiner do motor, não uma alocação por view
do host.

## O heap vivo no estado estável e o limite de 2.048 bytes

O heap vivo do Hermes em repouso (depois de uma coleta completa, nada montado) foi lido ao fim de cada
ciclo. Oito soaks guardados (sete de 20 ciclos e um de 100, ou seja, 216 ciclos estáveis por carga)
deram, depois dos 3 primeiros ciclos de cada carga:

| Carga | Aquecimento | Crescimento nos ciclos estáveis | Maior passo entre ciclos |
| --- | --- | ---: | ---: |
| idle | nenhum: 1.790.616 desde o primeiro ciclo | 0 | 0 |
| forms | nenhum: 1.803.896 desde o primeiro ciclo | 0 | 0 |
| chart | de 1.819.368 a 1.820.872 nos quatro primeiros ciclos (+1.504 bytes) | 0 | 0 |
| list | 1.933.112 ou 1.933.424 desde o primeiro ciclo | 0 em sete soaks, +312 em um (o de 100 ciclos) | 312 |

Dois outros soaks de 20 ciclos, feitos enquanto a fatia era desenvolvida e cujos relatórios não foram
guardados (um deles mostrou o mesmo degrau de 312 bytes na carga `list`), e um soak exploratório, não
entram na conta. O heap vivo em repouso é igual, ao byte, de um ciclo para o seguinte depois do
aquecimento, porque uma coleta completa roda antes de cada leitura e o mesmo código aloca os mesmos
objetos. A única exceção é um degrau único de 312 bytes na carga `list`, num ponto da execução que
varia: antes do primeiro ciclo da `list` em quatro soaks, dentro dos ciclos estáveis em um e em nenhum
nos outros três. Lido no meio de um ciclo, com a raiz montada, o heap se move em torno do seu ponto
fixo entre 128 bytes (idle, forms, chart) e 4.528 bytes (list) ao longo de um soak.

**O limite é um check normativo**: para cada carga, depois dos 3 primeiros ciclos, o heap vivo em
repouso ao fim de cada ciclo fica no máximo **2.048 bytes** acima do valor do primeiro ciclo estável
(`HEAP_STEADY_GROWTH_LIMIT_BYTES`, em [`tests/performance-cases.mjs`](https://github.com/journey-studios/godot-fabric/blob/ad8723449abcab24fa5b38e41f3deac5c5a162fe/tests/performance-cases.mjs);
o probe julga sobre as leituras e o oráculo de novo sobre as mesmas, e o limite é inclusivo). O pior
caso medido é 312 bytes, então 2.048 é 6,6 vezes isso e 0,1% do heap vivo, o que deixa folga para
degraus únicos de um runner hospedado e ainda reprova qualquer vazamento de 129 bytes ou mais por
ciclo dentro dos 17 ciclos estáveis (16 passos): um único objeto JS de duas propriedades retido por
ciclo (138 bytes) reprova depois de quinze ciclos estáveis, e uma raiz que não é liberada (21.840 bytes
na idle) reprova de imediato. As leituras com a raiz montada não são limitadas, porque se espalham mais
que isso em torno do ponto fixo. O número é uma medida deste host nesta máquina; outro Hermes, outra
carga ou outro runner pedem que seja medido de novo.

## O peso do snapshot

A seção publica só agregados (`count`, `rejected`, `totalMs`, `maxMs`, `p50Ms`, `p95Ms` e `p99Ms` por
série, mais os contadores e o heap). As amostras de que os percentis saem (`windowMs`, até 128 por
série) só aparecem quando a aplicação tem a meta `validation_performance_samples`, porque são a maior
parte do peso e todo `status()` de todo leitor pagaria por elas. Medido pelo probe depois dos soaks, com
todas as janelas cheias, no snapshot da aplicação (sem os nós de nenhuma superfície):

| | Snapshot da aplicação | Seção `performance` (reserializada pelo probe) |
| --- | ---: | ---: |
| Sem a meta (o padrão) | 5.997 bytes | 1.944 bytes |
| Com a meta | 18.398 bytes | 13.433 bytes |

Um check do probe confere que, sem a meta, a seção traz os agregados e nenhuma amostra e que, com ela,
traz as amostras também; o `test:frame-clock`, o `test:runtime` e o `test:application`, que leem o
`status()`, seguem passando.

## Hosts

| Host | SHA-256 | Fonte |
| --- | --- | --- |
| Anterior | `ad0ecf734aef28804acb1a5b2bc99a7b1b68629808a5641ade2e49d11c4f992e` | main `585ca1b` |
| Atual (genuíno e restaurado) | `866ab18dfa348c20967d525e7903b218420edd01c6ed650c6d3dd0f98522f6bd` | `ad87234` |
| Sabotagem `leak` | `530ea5b9ccf7f631ba8bca31306eafb21b62e375c99df79c9d66bdc8ea5716d6` | `ad87234` com `memdelete(it->second.control)` trocado por `(void)it->second.control` |
| Sabotagem `heap` | `ceb7c3c2d21e925666afb2cb9305b301898c7f6746e2c7fc6fed45657e707dfd` | `ad87234` com `static const auto info = …getHeapInfo(false)` |
| Sabotagem `phase` | `4ad58f482eeb70164a763ecfaa10400b089f6f85a78389ec4238a4d3a8c9af57` | `ad87234` com a amostra de fase somada duas vezes |

O recibo traz os SHA-256 completos dos hosts, o do binário do teste de unidade, os dos relatórios
brutos (ignorados pelo git) e os das fontes executadas.

## Limitações e abertos

- **Orçamentos por dispositivo-alvo ([V2-D28](../../ARCHITECTURE_V2_DECISIONS.md#v2-d28)).** Esta
  fatia mede num laptop, em headless, e não decide o que um dispositivo pode gastar; nenhuma
  otimização (cache, worker de JS, Rust) é aceita ou rejeitada por estes números.
- **Shaping de texto** (depois do GF-11, que traz a medida), **aceite de 10.000 linhas** (GF-15) e
  **tempo de quadro gráfico** não são medidos.
- **iOS e Android**, e qualquer outro alvo além de macOS arm64, não rodaram.
- **CI hospedada pendente.** Um runner hospedado pode mostrar outro aquecimento, outro degrau de 312
  bytes ou durações mais ruidosas; só os checks exatos lhe são pedidos.
- As fases de mount e layout só veem os commits que rodam dentro de um `pump`; o primeiro render e o
  commit do unmount rodam fora de um.
- Os percentis são sobre as últimas 128 amostras de cada série, não sobre a vida dela; o total e o
  máximo são sobre a vida inteira.
- A seção é um diagnóstico do snapshot da aplicação, como o `frameClock`: não há `performance.mark`,
  `measure` nem `memory` em JS, e o `react-native` não ganha nenhum nome.
- Um Control que o host deixa de liberar é visto só pelo monitor de órfãos do Godot, não pela contagem
  de nós da SceneTree; por isso os dois são conferidos.
- Esta fatia é a primeira do GF-30 e não o completa: só o checkpoint `slice` da primeira fatia do GF-30
  fecha com ela; nenhum GF completo, outro checkpoint, peso ou denominador fecha.
