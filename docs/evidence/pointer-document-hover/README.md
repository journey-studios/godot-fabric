# Document hover em quatro flags originais

Esta fatia certifica listeners originais `pointerover`, `pointerout`,
`pointerenter` e `pointerleave` em Document e documentElement sobre o hover nativo
das fatias de [View](../pointer-hover/README.md) e do
[caminho da raiz](../pointer-root-path/README.md). Ela roda em oito lanes:
interesse original/current × flags desabilitadas, só imperativo, só interno e
habilitado. Só testes mudam; os bytes nativos e do SDK são os da `main`. O
[recibo](report.json) fixa fontes, hashes e resultados.

| Lane | Checks | Entrega nativa |
| --- | ---: | --- |
| original × quatro flags | 186 cada | Nenhuma: sem consulta instalada, só o sentinela JSX entrega por props |
| current × desabilitada / só imperativo | 186 cada | Nenhuma: sem dispatch nativo não há consulta nem métodos de Document |
| current × só interno | 203 | Listeners de Document; os do documentElement não existem sem a flag imperativa |
| current × habilitado | 211 | Listeners de Document e documentElement |

São **1.530 checks headless** no total.

```sh
npm run test:pointers:documents:hover
```

## O que foi verificado

Cada configuração registra os quatro tipos de hover: capture e bubble no
Document (`DocC`, `DocB`), capture e bubble no documentElement (`RootC`, `RootB`),
só os do Document, só os do documentElement, ou só um capture. Um mouse sem botão
vai de fora da superfície até a folha de A, para a área vazia de A, volta à folha e
sai de novo; um toque desce e sobe na folha.

- **Over/out.** Chegam à folha e propagam até a raiz: capture em fase 1 (Document,
  depois documentElement) e bubble em fase 3 (documentElement, depois Document).
  Ir e voltar da área vazia gera `out` e `over` na folha, porque o alvo muda.
- **Enter/leave.** Não borbulham, então só os listeners capture os veem, em fase 1.
  Ao entrar de fora, a raiz entra no caminho e o capture dela propaga `enter` para
  o container, o pai e a folha; ao sair para fora, `leave` para folha, pai e
  container. Entre a folha e a área vazia a raiz continua no caminho e nada é
  propagado. Os listeners bubble de enter/leave no Document e no documentElement
  nunca rodam: o RN nunca entrega um evento com alvo na raiz.
- **Consultas.** A raiz lê exatamente o caminho de over/out (bubble, e capture só
  quando o bubble não qualifica) e os Maps capture de enter/leave; as Views leem só
  Maps vazios, e nada é lido sem a consulta instalada.
- **Toque.** O Down entra no caminho como o mouse vindo de fora, e o Up sai dele.
- **Controles.** Um `dispatchEvent` manual de `pointerover` no Document ou no
  documentElement prova a instalação e o gate de métodos de cada lane (no
  documentElement, o Document é ancestral: capture em 1 e bubble em 3). O sentinela
  JSX com `onPointerEnter`/`onPointerLeave` entrega por props em todas as lanes, pelo
  handler legado compilado quando não há dispatch nativo. Os listeners de B ficam
  isolados do hover de A, e remover os listeners durante o hover para a entrega na
  mudança seguinte.

## Controle negativo retido

Um SDK sabotado faz a consulta da raiz ignorar o Document dono em todos os offsets
de hover, como se só os Maps do documentElement pudessem qualificar. Ele falha 34
checks do probe na lane só-interno e 22 na habilitada, e o oráculo independente do
runner, sem os gates de status do probe, rejeita os dois relatórios e aceita os
finais. O plugin foi restaurado byte a byte depois.

O bundler compartilhado (`scripts/event-target-bundle.mjs`) ganhou a entrada deste
probe e é fonte fixada de todos os controles de host anterior. Por isso os
controles de View Up, query-fault, resolver-fault, Move, hover e caminho da raiz
foram refeitos com os bundles novos nos seus hosts preservados: continuam com 8,
12, 3, 45, 32 e 9 falhas normativas, e o caso de Document do caminho da raiz
continua caindo no host do hover.

## Regressões

No mesmo host passaram os três gates do job `contracts` (260 testes Node e 13
Python, análise estática e scan de publicação), o `test:recovery` e as 25 suítes
nativas: 22 exemplos, Down 2.731 nas oito lanes, query faults 187, resolver faults
66, Document Up 6.459, View Up 297, Move 220, Document Move 1.940, hover 158,
caminho da raiz 82, o próprio hover em Document 1.530 e `parity:godot`. Os bytes
nativos e do SDK são os da `main`, então o lote de SDK não foi refeito.

## Limites

Sem captura de viewport nesta fatia. Faults na consulta da raiz em offsets de
hover, once/AbortSignal, refs e retirada, mutação e reentrância durante o hover em
Document seguem abertos, assim como hover com caneta, captura de ponteiro durante
hover, seleção de superfície para input na área vazia, responders, hardware,
exports mobile e performance.

A CI desta fatia ainda será executada. Nenhum GF, checkpoint, dependência, peso ou
denominador foi fechado.

As 22 fontes de código/configuração executadas (19 produtoras do bundle e
3 de verificação) correspondem à implementação `b880b9b3d0a60b5633f74d0b7e4719a3a0df62c0` por
`git show`/SHA-256. A execução partiu de 3264107 com as mudanças desta fatia ainda
locais. Este pin pós-commit não é uma nova corrida.
