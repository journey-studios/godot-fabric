# Document Up: mutação de listeners durante o dispatch nativo

Esta fatia valida o que acontece quando um listener `pointerup` de Document,
chamado por um Up nativo real, altera os Maps originais do RN durante o próprio
dispatch. As oito lanes headless passaram **4.401 checks**. Os 2.709 checks da
[fatia refs/remount](../pointer-document-up-refs/README.md) continuam presentes,
na mesma ordem, em cada lane; os novos estágios `mutation/*` somam 190 checks por
lane sem D, 196 nas lanes original com D e 270 nas duas lanes current com D. A
captura current/enabled passou **835 checks**, com **118 pixels** em nove frames
reais de 760×220. O [recibo](report.json) fixa fontes, hashes e resultados por lane.

Não há alteração na implementação nativa, no SDK nem nos scripts de bundle.
As mudanças estão só nos testes: a fixture compartilhada ganhou os tipos
`mut-*`, e o probe/oráculo Up ganhou os estágios abaixo. Down não usa esses
tipos e seu relatório não muda de forma. `I` é `enableImperativeEvents`; `D` é
`enableNativeEventTargetEventDispatching`. Os defaults públicos continuam off.

## Matriz headless

| Interesse | Flags | I | D | Passed/checks | Novos |
| --- | --- | --- | --- | ---: | ---: |
| original | disabled | false | false | 493/493 | 190 |
| original | imperative-only | true | false | 493/493 | 190 |
| original | internal-only | false | true | 507/507 | 196 |
| original | enabled | true | true | 509/509 | 196 |
| current | disabled | false | false | 493/493 | 190 |
| current | imperative-only | true | false | 493/493 | 190 |
| current | internal-only | false | true | 705/705 | 270 |
| current | enabled | true | true | 708/708 | 270 |

```sh
npm run test:pointers:documents:up
```

## Como a mutação é observada

Cada mutação roda dentro de um callback realmente entregue e grava sua posição
na mesma sequência dos callbacks. A linha do tempo abaixo usa `ação:alvo` para
a mutação entre os callbacks ao redor. O probe também confere que a mutação viu
o evento corrente (`currentTarget` e `globalThis.event`) e a fase do callback
que a executou. A consulta de interesse do root acontece antes do dispatch, então
reflete os Maps antes das mutações do mesmo gesto.

O dispatcher original tira um snapshot do Map de cada alvo/fase quando chega
nele. Remover ou abortar um registro ainda não chamado o marca `removed`; um
listener adicionado ao Map que está sendo percorrido só roda no próximo evento;
um listener adicionado a um alvo ou fase posterior roda no mesmo dispatch.

## O que foi verificado

Linhas do tempo nas lanes current com D. Nas outras lanes nenhum Up nativo chega
aos listeners de Document, então nenhuma mutação roda durante um Up nativo; as
lanes original com D executam as mutações só pela emissão manual descrita abaixo,
e as lanes sem D apenas confirmam que nada é registrado nem executado:

| Caso | Gesto | Consulta do root | Linha do tempo |
| --- | --- | --- | --- |
| remove-later | 1º | `36=true` | `DocC, remove:DocB` |
| remove-later | 2º | `36=false, 37=true` | `DocC, remove:DocB` |
| remove-sibling | 1º e 2º | `36=true` | `DocB1, remove:DocB2` |
| add-same | 1º | `36=true` | `DocB1, add:DocB2` |
| add-same | 2º | `36=true` | `DocB1, add:DocB2, DocB2` |
| add-later | 1º | `36=false, 37=true` | `DocC, add:RootB, add:DocB, RootB, DocB` |
| add-later | 2º | `36=true` | `DocC, add:RootB, add:DocB, RootB, DocB` |
| abort-sibling | 1º e 2º | `36=true` | `DocB1, abort:DocB2` |
| cross-root, A | 1º | `36=true` | `DocB, add:XDoc` |
| cross-root, B | 1º | `36=true` em B | `XDoc` |

Sem I, `add-later` não tem `RootB`: `DocC, add:DocB, DocB`.

**Remoção.** `DocC` (capture) remove `DocB` antes da fase bubble: o primeiro Up
foi qualificado por `DocB`, mas só `DocC` roda, e o segundo gesto já consulta
`36=false, 37=true`. Em `remove-sibling`, `DocB1` remove `DocB2` do mesmo Map
bubble que está sendo percorrido; `DocB2` estava no snapshot e é pulado pela
marca `removed`.

**Adição.** Em `add-same`, `DocB2` entra no Map bubble durante o callback de
`DocB1` e só roda no gesto seguinte; a segunda adição da mesma função é o no-op
de duplicata do Map original, e o segundo Up incrementa o contador em dois num
único commit. Em `add-later`, a consulta nativa do primeiro gesto só encontra o
capture `DocC`, que adiciona `RootB` no documentElement e `DocB` no Document:
os dois rodam no mesmo dispatch, em fase 3. O Up nativo não é filtrado por fase.

**Abort.** `DocB1` aborta o AbortSignal original de `DocB2` dentro do callback;
`DocB2` é pulado no mesmo dispatch e nos seguintes. O sinal começa `false`,
termina `true` depois dos Ups nativos e continua `true` depois do manual.

**Outro root.** O callback de A adiciona `XDoc` ao Document de B. O gesto de A
não muda contador, commits nem contato de B (o probe confere os três; o oráculo
Node confere o contador); o gesto seguinte de B consulta `36=true` e entrega `XDoc`.

Depois dos gestos, uma emissão manual untrusted no Document aplica a mesma
semântica em fase 2. Nas lanes original com D, que não entregam Up nativo de
Document, é o manual que executa a primeira mutação: em `add-same` ele mostra só
`DocB1, add:DocB2`, e em `cross-root` B continua sem `XDoc`. No manual de
`add-later`, `RootB` não roda porque o documentElement não está no caminho de um
evento emitido no próprio Document. Sem D, os métodos não existem e nada é
registrado.

Como controle negativo, a remoção de `remove-sibling` foi trocada
temporariamente para a fase capture, deixando `DocB2` registrado. Na lane
current/enabled o probe falhou em exatamente oito checks, todos desse caso. O
oráculo `mutation()` do Node rodou direto sobre esse relatório, sem os gates de
status do probe, e o rejeitou pela linha do tempo (`DocB2` a mais); o mesmo
oráculo aceita o relatório final. O relatório, o log e a saída do oráculo
ficam retidos, com hashes no [recibo](report.json). A fixture foi restaurada sem
diferença em relação ao commit.

## Capturas nativas verificadas

A execução current/enabled salva os sete frames anteriores e dois novos, em
torno do primeiro Up de `add-later`. Godot faz readback dos pixels; Node
decodifica os PNGs de forma independente e compara os 118 pixels com o
relatório. Os 708 IDs headless desse modo são preservados; os 127 checks
adicionais cobrem pixels e contador/save.

| Antes do Up com consulta só de capture | Depois do mesmo Up |
| --- | --- |
| ![A9/B4](before.png) | ![A12/B4](added.png) |

| Estágio executado | Contador A | Contador B |
| --- | ---: | ---: |
| Antes do primeiro Up de `add-later` | 9 | 4 |
| Depois desse Up | 12 | 4 |

A barra de A termina em x76 e depois em x88: um único Up entregou três
callbacks (`DocC`, `RootB`, `DocB`), embora a consulta do root tenha visto só o
capture. A barra de B fica em x456 nos dois frames.

## Limites

A prova cobre mutações feitas dentro de callbacks capture/bubble de Document
entregues por Up nativo; o documentElement participa só como alvo de uma adição,
com I e D. Não certifica mutação de listeners de View/elemento, dispatch
reentrante (`dispatchEvent` dentro de um callback nativo), combinação com
`stopPropagation`/`stopImmediatePropagation`, erros de listener durante a
mutação nem reentrada de `once`. A consulta de interesse é anterior ao dispatch;
gestos com consulta negativa continuam sem entrega e não são cobertos aqui.
Faults de query/resolver Up, Up capturado/sem hit/sem alvo, pareamento
Down/Up por pointerId, outras categorias de evento, mobile/exports, hardware e
performance continuam abertos.

Original/current são controles do modo de interesse do SDK sobre o mesmo
binário nativo, não comparações entre hosts nativos antigos e novos. A CI desta
fatia ainda será executada; a [CI da fatia refs](../pointer-document-up-refs/hosted-ci.json)
continua válida para os seus 2.709 checks. Nenhum GF, checkpoint, dependência,
peso ou denominador foi fechado.

As 71 fontes de código/configuração executadas correspondem à implementação
`4342db0677731d1ba474ff4e32659b2828ab1831` por `git show`/SHA-256. O recibo preserva a
base de89fb2 e a árvore dirty da execução; este pin pós-commit não é uma nova corrida.
