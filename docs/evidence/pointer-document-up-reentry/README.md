# Document Up: dispatch reentrante a partir do Up nativo

Esta fatia valida o que acontece quando um listener `pointerup` de Document,
chamado por um Up nativo real, inicia outro dispatch antes de retornar. As oito
lanes headless passaram **5.097 checks**. Os 4.401 checks da
[fatia de mutação](../pointer-document-up-mutation/README.md) continuam
presentes, na mesma ordem, em cada lane; os novos estágios `reentry/*` somam 78
checks por lane sem D, 81 nas lanes original com D e 111 nas duas lanes current
com D. A captura current/enabled passou **946 checks**, com os mesmos **118
pixels** em nove frames reais de 760×220: eventos aninhados não mudam estado
React, então esta fatia não acrescenta frames. O [recibo](report.json) fixa
fontes, hashes e resultados por lane.

Não há alteração na implementação nativa, no SDK nem nos scripts de bundle.
As mudanças estão só nos testes: a fixture compartilhada ganhou os tipos `re-*`
e registra callbacks de um dispatch aninhado num canal próprio, e o
probe/oráculo Up ganhou os estágios abaixo. Down não usa esses tipos e seu
relatório não muda de forma. `I` é `enableImperativeEvents`; `D` é
`enableNativeEventTargetEventDispatching`. Os defaults públicos continuam off.

## Matriz headless

| Interesse | Flags | I | D | Passed/checks | Novos |
| --- | --- | --- | --- | ---: | ---: |
| original | disabled | false | false | 571/571 | 78 |
| original | imperative-only | true | false | 571/571 | 78 |
| original | internal-only | false | true | 588/588 | 81 |
| original | enabled | true | true | 590/590 | 81 |
| current | disabled | false | false | 571/571 | 78 |
| current | imperative-only | true | false | 571/571 | 78 |
| current | internal-only | false | true | 816/816 | 111 |
| current | enabled | true | true | 819/819 | 111 |

```sh
npm run test:pointers:documents:up
```

## Como a reentrância é observada

O listener só reentra quando o evento recebido é o Up nativo trusted, então o
evento aninhado, que é untrusted, não recursa, e a emissão manual de controle
continua plana. Os callbacks chamados durante o dispatch aninhado entram na
linha do tempo como `nested:<root>.<listener>`, e o retorno do dispatch como
`reenter:returned` ou `reenter:threw`. Depois que o dispatch aninhado volta, o
probe registra o estado do evento externo: trust, fase, `currentTarget`, target,
`composedPath()` e `globalThis.event`.

## O que foi verificado

Linhas do tempo nas lanes current com D. Nas outras lanes nenhum Up nativo chega
aos listeners de Document, então nenhuma reentrância acontece; as lanes original
com D mostram os listeners só pela emissão manual, e as lanes sem D apenas
confirmam que nada é registrado:

| Caso | Consulta do root | Linha do tempo |
| --- | --- | --- |
| nested-capture | `36=true` | `DocC, nested:A.DocC, nested:A.DocB1, nested:A.DocB2, reenter:returned, DocB1, DocB2` |
| nested-bubble | `36=true` | `DocC, DocB1, nested:A.DocC, nested:A.DocB1, nested:A.DocB2, reenter:returned, DocB2` |
| same-event | `36=true` | `DocB1, reenter:threw, DocB2` |
| cross-root, A | `36=true` | `DocB, nested:B.DocC, nested:B.DocB, reenter:returned` |
| cross-root, B | `36=true` em B | `DocC, DocB` |

**Dispatch aninhado.** Um callback do Up nativo, em capture (`DocC`) ou bubble
(`DocB1`), emite um `pointerup` novo no próprio Document. O dispatch aninhado
roda inteiro antes de retornar: os três listeners do Document são chamados em
fase 2, untrusted, com o evento aninhado como `globalThis.event`, todos com o
mesmo objeto, distinto do Up nativo, e ainda na prioridade Discrete do Up. Ao
retornar, o evento aninhado está limpo (`currentTarget` nulo, fase 0, caminho
vazio). O Up nativo continua trusted, na mesma fase, com o mesmo
`currentTarget`, target e caminho de cinco alvos, e volta a ser
`globalThis.event`; os listeners restantes rodam trusted. O dispatch aninhado não
gera consulta nativa, Raw, nem atualização React; o contador sobe só pelos
callbacks externos, num único commit.

**Mesmo evento.** Re-despachar o próprio Up nativo de dentro do callback lança
`The event is already being dispatched.` antes de qualquer mudança: o evento
continua trusted e `DocB2` roda em seguida.

**Outro root.** O callback de A emite um `pointerup` no Document de B, que tem
`DocC/DocB` instalados. Os dois rodam untrusted em fase 2, sem mudar contador,
commits nem contato de B; o gesto seguinte de B entrega `DocC, DocB`
normalmente.

Depois de cada Up, uma emissão manual untrusted no Document chama os mesmos
listeners sem reentrância nenhuma.

Como controle negativo, a fixture foi alterada temporariamente para deixar
`globalThis.event` apontando para o evento aninhado depois que o dispatch
aninhado retorna. Na lane current/enabled o probe falhou em exatamente três
checks, os dos três casos em que o dispatch aninhado retorna; `same-event`, em
que o evento aninhado é o próprio Up, não foi afetado. O oráculo de reentrância
do Node rodou direto sobre esse relatório, sem os gates de status do probe, e o
rejeitou; o mesmo oráculo aceita o relatório final. O relatório, o log e a saída
do oráculo ficam retidos, com hashes no [recibo](report.json), e a fixture foi
restaurada byte a byte antes das regressões.

## Capturas nativas verificadas

A execução current/enabled salva os mesmos nove frames da fatia de mutação.
Godot faz readback dos pixels; Node decodifica os PNGs de forma independente e
compara os 118 pixels com o relatório. Os 819 IDs headless desse modo são
preservados; os 127 checks adicionais cobrem pixels e contador/save.

## Limites

A prova cobre dispatch aninhado iniciado em callbacks capture/bubble de Document
entregues por Up nativo, sobre o próprio Document ou o Document de outro root, e
a rejeição de re-despachar o próprio Up. Não certifica dispatch aninhado em
documentElement ou View, dispatch aninhado que lança, chama
`preventDefault`/`stopPropagation`, erros de listener dentro dele, mais de um
nível de aninhamento nem atualizações React agendadas pelo evento aninhado. A
consulta de interesse é anterior ao dispatch; o dispatch aninhado não consulta o
nativo. Faults de query/resolver Up, Up capturado/sem hit/sem alvo,
pareamento Down/Up por pointerId, outras categorias de evento, mobile/exports,
hardware e performance continuam abertos.

Original/current são controles do modo de interesse do SDK sobre o mesmo
binário nativo, não comparações entre hosts nativos antigos e novos. A CI desta
fatia ainda será executada. Nenhum GF, checkpoint, dependência, peso ou
denominador foi fechado.

As 71 fontes de código/configuração executadas correspondem à implementação
`f0c00cefe67dd78c5be6b6e3fe5b82b3abcc1c24` por `git show`/SHA-256. O recibo preserva a
base dbd6324 e a árvore dirty da execução; este pin pós-commit não é uma nova corrida.
