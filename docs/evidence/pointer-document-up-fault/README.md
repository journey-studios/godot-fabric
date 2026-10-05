# Document Up: faults na consulta de interesse do root

Esta fatia valida o que acontece quando a consulta de interesse de um Up nativo
falha no root real. Um fault único, de throw ou de retorno não booleano, é
armado no handle do documentElement nos offsets do Up: 36 para bubble e 37 para
capture. As oito lanes headless passaram **6.451 checks**. Os 5.097 checks da
[fatia de reentrância](../pointer-document-up-reentry/README.md) continuam
presentes, na mesma ordem, em cada lane; os novos estágios `fault/*` somam 153
checks nas lanes sem consulta instalada e 218 nas duas lanes current com D. A
captura current/enabled passou **1.179 checks**, com **132 pixels** em dez
frames reais de 760×220. O [recibo](report.json) fixa fontes, hashes e
resultados por lane.

Não há alteração na implementação nativa, no SDK nem nos scripts de bundle: o
callback nativo de interesse já rejeita só o lookup que falhou, também nos
offsets do Up. As mudanças estão só nos testes. O bootstrap compartilhado passou
a aceitar faults nos offsets 36/37 (Down continua usando só 34/35), a fixture Up
expõe `faultRoot`/`clearFault`, e o probe/oráculo Up ganhou os estágios abaixo.
`I` é `enableImperativeEvents`; `D` é `enableNativeEventTargetEventDispatching`.
Os defaults públicos continuam off.

## Matriz headless

| Interesse | Flags | I | D | Passed/checks | Novos |
| --- | --- | --- | --- | ---: | ---: |
| original | disabled | false | false | 724/724 | 153 |
| original | imperative-only | true | false | 724/724 | 153 |
| original | internal-only | false | true | 741/741 | 153 |
| original | enabled | true | true | 743/743 | 153 |
| current | disabled | false | false | 724/724 | 153 |
| current | imperative-only | true | false | 724/724 | 153 |
| current | internal-only | false | true | 1034/1034 | 218 |
| current | enabled | true | true | 1037/1037 | 218 |

```sh
npm run test:pointers:documents:up
```

## Uma segunda aplicação para os faults

A matriz saudável afirma que não há diagnósticos, até o stop da aplicação. Para
não mudar o significado desses checks já certificados, os faults rodam numa
segunda `FabricApplication`, criada depois que a primeira parou e liberou seus
roots. Ela monta A e B de novo, com Documents novos, e começa sem diagnósticos.
Os checks dessa fase levam o prefixo `fault/`. No fim, a segunda aplicação para
e retém exatamente os diagnósticos dos faults consumidos. O oráculo do Node
confere que o log tem só essas linhas `ERROR: FABRIC_ERROR:`, na mesma ordem, e
nenhum outro erro.

## O que foi verificado

Cada caso arma um fault único no documentElement de A, faz um gesto real e
depois um gesto saudável de recuperação, com os mesmos listeners. Consultas do
root nas lanes current com D, em ordem de chamada:

| Caso | Listeners | Consultas do root | Up entregue | Diagnóstico |
| --- | --- | --- | --- | --- |
| throw36 | `DocC, DocB` | `36=throw`, `37=true` | `DocC, DocB` | 1 |
| throw37 | `DocC` | `36=false`, `37=throw` | nenhum | 1 |
| nonboolean36 | `DocB` | `36=1`, `37=false` | nenhum | 1 |
| nonboolean37 | `DocC` | `36=false`, `37=1` | nenhum | 1 |
| armed37 | `DocC, DocB` | `36=true` | `DocC, DocB` | 0 |

**Só o lookup que falhou é rejeitado.** Em `throw36`, o fault no bubble vira
`false`, mas o lookup de capture (`37=true`) ainda qualifica o Up, e o dispatch
original entrega `DocC` e `DocB` nas duas fases, num único commit. Nos casos sem
outro lookup que qualifique, o Up não é entregue: não há callback `pointerup`,
Raw de Up nem atualização React, mas o `TouchEnd` original chega com seu par Raw
e o contato é limpo (adaptador, processador e roteamento). Os componentes do
caminho continuam respondendo `false` aos seus lookups saudáveis antes do root.

**Diagnóstico.** Cada fault consumido deixa exatamente um
`E_POINTER_LISTENER_QUERY` com a causa: a mensagem do throw, ou "Pointer
listener query must return a boolean" para o retorno não booleano. O gesto de
recuperação, já sem fault, consulta o root normalmente, entrega os listeners e
não acrescenta nem apaga diagnóstico.

**Fault não consumido.** Em `armed37`, o lookup de bubble qualifica primeiro, o
lookup de capture nem é feito, e o fault continua armado (`remaining=1`) sem
diagnóstico, até ser limpo.

Depois dos cinco casos, um gesto saudável em B entrega `DocC, DocB`. Nas lanes
sem consulta instalada, nenhum fault é consumido e nenhum diagnóstico aparece.

Como controle negativo, o bootstrap foi alterado temporariamente para que um
fault em modo throw retornasse `true` em vez de lançar, como se um lookup com
falha qualificasse o Up. Na lane current/enabled o probe falhou em nove checks:
os de `throw36` e `throw37` e o de diagnósticos retidos no stop. Os casos
`nonboolean` e `armed37` não foram afetados. O oráculo de faults do Node rodou
direto sobre esse relatório, sem os gates de status do probe, e o rejeitou; o
mesmo oráculo aceita o relatório final. O relatório, o log e a saída do oráculo
ficam retidos, com hashes no [recibo](report.json), e o bootstrap foi
restaurado byte a byte antes das regressões.

## Capturas nativas verificadas

A execução current/enabled salva os nove frames anteriores e um novo, na
segunda aplicação, depois de `throw36` e da sua recuperação. Godot faz readback
dos pixels; Node decodifica os PNGs de forma independente e compara os 132
pixels com o relatório. Os 1.037 IDs headless desse modo são preservados; os 142
checks adicionais cobrem pixels e contador/save.

| Depois do Up com fault no bubble e da recuperação |
| --- |
| ![A4/B0](throw36.png) |

A barra de A termina em x56: o Up com fault e o de recuperação entregaram
`DocC` e `DocB` cada um. B ainda não teve gesto nessa aplicação, e sua barra
termina em x440.

## Limites

A prova cobre faults únicos de throw e não booleano no handle real do
documentElement, nos offsets 36/37 do Up, numa segunda aplicação. Não certifica
faults na consulta de componentes (View) no Up, faults de getter no resolver de
refs, faults de stateNode/canonical, faults repetidos ou durante retirada/stop,
nem todas as combinações de fases. Up capturado/sem hit/sem alvo, pareamento
Down/Up por pointerId, outras categorias de evento, mobile/exports, hardware e
performance continuam abertos.

Original/current são controles do modo de interesse do SDK sobre o mesmo
binário nativo, não comparações entre hosts nativos antigos e novos. A CI desta
fatia ainda será executada. Nenhum GF, checkpoint, dependência, peso ou
denominador foi fechado.
