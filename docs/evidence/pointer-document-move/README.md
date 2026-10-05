# Document pointermove: quatro flags originais e input nativo real

Esta fatia certifica listeners originais `pointermove` em Document e
documentElement sobre o suporte nativo de Move da
[fatia de View](../pointer-move/README.md). Cada lane monta duas roots reais com
Documents originais distintos numa aplicação Hermes e usa o mesmo host nativo
corrigido. Os defaults públicos do EventTarget continuam off. O
[recibo](report.json) fixa fontes, hashes e resultados.

## Lanes executadas

`I` é `enableImperativeEvents`; `D` é `enableNativeEventTargetEventDispatching`.
O interesse original não instala consulta; o atual instala a consulta do SDK aos
Maps originais só quando D é verdadeiro.

| Interesse | Flags | I | D | Checks | Entrega nativa nos listeners |
| --- | --- | --- | --- | ---: | --- |
| original | disabled | false | false | 220/220 | nenhuma |
| original | imperative-only | true | false | 220/220 | nenhuma |
| original | internal-only | false | true | 223/223 | nenhuma, sem consulta |
| original | enabled | true | true | 225/225 | nenhuma, sem consulta |
| current | disabled | false | false | 220/220 | nenhuma |
| current | imperative-only | true | false | 220/220 | nenhuma |
| current | internal-only | false | true | 300/300 | Document |
| current | enabled | true | true | 304/304 | Document e documentElement |

Os 1.932 checks passaram, com IDs únicos em cada lane e nenhum erro registrado.
A lane current/enabled também roda no viewport real do macOS: 330 checks, com 24
pixels em dois quadros.

```sh
npm run test:pointers:documents:move
node tests/pointer-document-move-native.test.mjs --interest=current --flag=enabled --capture
```

## O que foi verificado

A View alvo não tem listener de pointer. Em cada caso, duas amostras de
`InputEventScreenDrag` com o contato preso:

| Caso | Listeners | Callbacks por amostra (current/enabled) | Consulta da raiz |
| --- | --- | --- | --- |
| doc | Document capture e bubble | DocC (fase 1), DocB (fase 3) | `1=true` |
| all | Document e documentElement, capture e bubble | DocC, RootC (fase 1), RootB, DocB (fase 3) | `1=true` |
| element | documentElement capture e bubble | RootC (fase 1), RootB (fase 3) | `1=true` |
| doc-capture-only | Document capture | DocC (fase 1) | `1=false`, `25=true` |
| element-capture-only | documentElement capture | RootC (fase 1) | `1=false`, `25=true` |

Antes da raiz, a consulta lê o par `1`/`25` do alvo e de cada View ancestral da
superfície, todos `false`, começando pelo alvo físico. Sem I, documentElement não
tem métodos e só os casos de Document entregam. Sem D, nem Document nem
documentElement têm métodos. Sem a consulta (interesse original), nenhum listener
de Document qualifica o move.

**Cada amostra entregue.** Os callbacks são `pointermove` trusted, com o mesmo
Event em todos os listeners, `pointerType` touch e `buttons=1`. Rodam na prioridade
Default dos moves únicos Continuous. O par Raw typed/star de `topPointerMove`
aparece uma vez, com o payload e o timestamp dos callbacks. O TouchMove original
vem depois, como Event distinto. Cada amostra faz um commit, com um incremento por
callback.

**Controles.**
- Um `dispatchEvent` público no Document ou no documentElement prova a instalação
  com callbacks untrusted em fase 2, ou a ausência exata dos métodos.
- B, com listeners de Document, fica intacto enquanto A, sem listeners, faz um
  drag que consulta só `false`; depois B entrega os seus.
- Remover o listener entre duas amostras do mesmo contato para a entrega na
  amostra seguinte.
- O Cancel não consulta nada e não invoca os listeners.
- Um sentinel com `onPointerMove` em JSX qualifica pelos próprios props em toda
  lane, sem consulta (sintético legado sem D).
- Um movimento de mouse sem botão chega a DocC e DocB pela consulta da raiz, com
  `pointerType` mouse, `buttons=0` e o ponto local exato.

O stop termina com roots, Controls, contatos e hover balanceados.

## Controle negativo

O ramo de raiz do SDK foi alterado temporariamente para ignorar o Document dono
nos offsets de Move, como se só os Maps do documentElement pudessem qualificar um
move. Nas lanes atuais com D, o probe falhou:
- **internal-only, 52 checks:** casos doc, all, doc-capture-only, isolamento,
  remoção e mouse;
- **enabled, 40 checks:** os mesmos, menos `all`. Os casos de documentElement
  continuam passando, porque o documentElement ainda qualifica e a propagação
  original entrega todos os listeners do caminho.

O oráculo do Node rodou direto sobre esses relatórios, sem os gates de status do
probe, e rejeitou os dois. O mesmo oráculo aceita os relatórios finais. Relatórios,
logs e a saída do oráculo ficam retidos, com hashes no [recibo](report.json), e o
plugin foi restaurado byte a byte antes das execuções finais.

## Quadros nativos

![Duas roots com contadores zerados](initial.png)

O azul é o alvo; o verde-azulado, o sentinel JSX. A barra amarela segue o contador
React de callbacks. Ela começa em x=20 e tem 20 px mais 4 px por callback.

![A recebe quatro callbacks de Document; B continua em zero](updated.png)

Depois do caso doc (duas amostras, DocC e DocB em cada), A tem 4 e B tem 0. Em cada
root, o último pixel amarelo (x=39+4·contagem) e o pixel de fundo seguinte fixam a
contagem exata. Cada quadro de 760×220 é uma leitura real do Viewport com 12
pixels fixos e contadores React conferidos; o oráculo decodifica o PNG salvo de
forma independente.

## Mudanças

Só testes mudaram:
- o fixture de Document ganhou o tipo `pointermove`, com TouchMove registrado no
  alvo, sentinel com `onPointerMove` e Raw de Move;
- um wrapper, um probe e um oráculo novos rodam a matriz;
- a CI ganha o passo `test:pointers:documents:move` com o artefato
  `native-pointer-document-move`.

Os probes de Down e Up não passam o tipo novo, e as saídas deles não mudam. Os
bytes nativos e do SDK são os da fatia de View.

## Regressões

Down passou 2.723 checks e Document Up 6.451, nas oito lanes cada. Contracts (257
Node/13 Python), análise estática e varredura de publicação também passaram.

## Limites

A prova cobre listeners `pointermove` em Document e documentElement com drags de
toque e um hover de mouse, nas oito lanes, no mesmo host. Não foram exercitados
para Move em Document:
- faults na consulta da raiz (o limite de diagnósticos de Move vale por
  construção);
- `once`/AbortSignal, refs e retirada de root;
- mutação e reentrância durante o dispatch.

Eventos de hover, captura de ponteiro, moves capturados ou sem hit, responders,
multi-toque, a prioridade com o mapeamento corrigido, hardware, exports mobile e
performance seguem abertos.

A [CI hospedada](hosted-ci.json) desta fatia passou nos cinco jobs no run
37351245158, no head 46876eb (checkout de merge 9515c0d). O artefato
`native-pointer-document-move` repete os **1.932 checks headless** das oito lanes,
com IDs, bundles e estágios idênticos aos locais; além de timestamps, da versão
patch do Node e do hash do host do runner, nada difere. Nenhuma lane tem linha de
erro, e as 20 entradas rastreadas batem com c2ad8f5 na árvore do checkout. A
captura e o controle negativo continuam locais. O [Pages](publication.json) (run
37352204907, push da `main` em a6af188) implantou exatamente os dados commitados, e o JSON
público e a API local conferem com eles. Nenhum GF, checkpoint, dependência, peso ou
denominador foi fechado.

As 20 fontes de código/configuração executadas (17 produtoras do bundle e
3 de verificação) correspondem à implementação
`c2ad8f547d368a4993f3b75a264d2fd191e8ecf9` por `git show`/SHA-256. A execução partiu do head
2d57c9b da fatia de View com as mudanças desta fatia ainda locais; o commit 4ca3f1f,
que entrou depois, só altera a prosa da evidência de View. Este pin pós-commit não
é uma nova corrida.
