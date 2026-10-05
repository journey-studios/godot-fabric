# View Up: faults na consulta de interesse do componente

Esta fatia valida o que acontece quando a consulta de interesse de um Up nativo
falha na ref real de uma View. Um fault único, de throw ou de retorno não
booleano, é armado na View nos offsets do Up: 36 para bubble e 37 para capture.
O probe de View Up passou **240 checks**: os 62 checks da
[fatia de View Up](../pointer-up/README.md) continuam presentes, na mesma ordem,
e os novos estágios `fault/*` somam 178. A captura nativa passou **268 checks**,
com os mesmos 24 pixels em dois frames de 680×160. O [recibo](report.json) fixa
fontes, hashes e resultados.

Não há alteração na implementação nativa, no SDK nem nos scripts de bundle: o
callback nativo de interesse já rejeita só o lookup que falhou, também nos
componentes. As mudanças estão só nos testes. O bootstrap compartilhado de
faults passou a aceitar os offsets 36/37 (o Down continua usando 34/35), o
fixture compartilhado aceita registrar capture e bubble na mesma View, o fixture
Up expõe `fault`/`clearFault`, e o probe/oráculo de View Up ganharam os estágios
abaixo. Os defaults públicos continuam off.

```sh
node tests/pointer-up-native.test.mjs
```

## Uma segunda aplicação para os faults

A matriz saudável do View Up afirma que não há diagnósticos até o stop. Para não
mudar o significado desses checks, os faults rodam numa segunda
`FabricApplication`, criada depois que a primeira parou e liberou seus roots.
Os checks dessa fase levam o prefixo `fault/`. No fim, a segunda aplicação para e
retém exatamente os diagnósticos dos faults consumidos. O oráculo do Node
confere que o log tem só essas linhas `ERROR: FABRIC_ERROR:`, na mesma ordem,
além das falhas de check que o modo de controle espera.

O controle com o host nativo anterior (`--allow-original-negative`) nunca chega a
essa fase: ele continua reproduzindo só as oito falhas normativas da fatia de
View Up.

## O que foi verificado

Cada caso arma um fault único na View de A, faz um gesto real e depois um gesto
saudável de recuperação, com os mesmos listeners:

| Caso | Listeners na View | Consultas na View | Ancestrais e root | Up entregue | Diagnóstico |
| --- | --- | --- | --- | --- | --- |
| throw36 | bubble | `36=throw`, `37=false` | consultados, todos `false` | nenhum | 1 |
| throw36-both | capture e bubble | `36=throw`, `37=true` | não consultados | capture, bubble | 1 |
| throw37 | capture | `36=false`, `37=throw` | consultados, todos `false` | nenhum | 1 |
| nonboolean36 | bubble | `36=1`, `37=false` | consultados, todos `false` | nenhum | 1 |
| nonboolean37 | capture | `36=false`, `37=1` | consultados, todos `false` | nenhum | 1 |
| armed37 | bubble | `36=true` | não consultados | bubble | 0 |

**Só o lookup que falhou é rejeitado.** Em `throw36-both`, o fault no bubble vira
`false`, o lookup de capture da mesma View qualifica, e o dispatch original
entrega o listener de capture e o de bubble em fase 2, num único commit. Quando
a View não qualifica, o nativo segue para os ancestrais da superfície dona e para
o root, cada um consultado em 36 e depois 37, sempre `false`; o probe e o
oráculo conferem o pareamento, os tags da superfície e que o último par é o root.
Sem qualificação, não há callback `pointerup`, Raw de Up nem atualização React,
mas o `touchend` original chega com seu par Raw e o contato é limpo.

**Diagnóstico.** Cada fault consumido deixa exatamente um
`E_POINTER_LISTENER_QUERY` com a causa: a mensagem do throw, ou "Pointer
listener query must return a boolean" para o retorno não booleano. A recuperação,
já sem fault, qualifica na própria View e não acrescenta nem apaga diagnóstico.
Em `armed37`, o lookup de bubble qualifica primeiro, o de capture nem é feito, e
o fault continua armado sem diagnóstico. Depois dos seis casos, um Up saudável em
B entrega seu listener de bubble.

Como controle negativo, o bootstrap foi alterado temporariamente para que um
fault em modo throw retornasse `true` em vez de lançar, como se um lookup com
falha qualificasse o Up. O probe falhou em quinze checks, todos de `throw36`,
`throw36-both` e `throw37` e o de diagnósticos retidos no stop; os casos
`nonboolean` e `armed37` não foram afetados. O oráculo de faults do Node rodou
direto sobre esse relatório, sem os gates de status do probe, e o rejeitou; o
mesmo oráculo aceita o relatório final. O relatório, o log e a saída do oráculo
ficam retidos, com hashes no [recibo](report.json), e o bootstrap foi
restaurado byte a byte antes das regressões.

## Controles com os hosts nativos anteriores

O bootstrap e o fixture compartilhados entram nos bundles do View Up, do
query-fault e do resolver-fault, e os três testes comparam os bytes do bundle
atual com o controle feito no host nativo anterior. Os três controles foram
refeitos com os bundles novos, nos binários preservados, e reproduzem exatamente
as falhas normativas esperadas: 8 no View Up, 12 no query-fault e 3 no
resolver-fault. O host atual foi restaurado e conferido pelo hash antes das
execuções normais.

## Regressões

O query-fault passou 186 checks e o resolver-fault 65, como antes. O Document Up
passou 6.451 checks nas oito lanes e o Down 2.723. Contracts passaram 255 Node/13
Python, os 22 exemplos e a análise estática também.

## Limites

A prova cobre faults únicos de throw e não booleano na ref real de uma View, nos
offsets 36/37 do Up, numa segunda aplicação, só na lane de flags habilitadas do
probe de View Up. Não certifica faults de getter no resolver de refs no Up,
faults de stateNode/canonical, faults repetidos ou durante retirada/stop, outras
combinações de flags, nem caminhos com listeners de Document ou várias Views. Up
capturado/sem hit/sem alvo, pareamento Down/Up por pointerId, outras categorias
de evento, mobile/exports, hardware e performance continuam abertos.

A CI desta fatia ainda será executada. Nenhum GF, checkpoint, dependência, peso
ou denominador foi fechado.

As 81 fontes de código/configuração executadas correspondem à implementação
`f9a3b25601e746c527fd9172020d9240b25ee9be` por `git show`/SHA-256. O recibo preserva a
base 988af3c e a árvore dirty da execução; este pin pós-commit não é uma nova corrida.
