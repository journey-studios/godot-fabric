# Toques compartilhados entre as raízes de uma aplicação

Esta fatia faz cada TouchEvent listar os toques ativos de todas as raízes da
aplicação, porque todas compartilham um runtime Hermes e, portanto, o único
responder JS do RN. Antes, cada raiz listava só os próprios toques: com a raiz A
pressionada, um toque que terminava na raiz B parecia o último toque do gesto de
A, o RN liberava o responder de A e o `Pressable` de A pressionava com o toque de
B. O defeito atingia todo consumidor do responder: `Pressable`, `PanResponder` e
os touchables. O [recibo](report.json) fixa fontes, hashes e resultados; a
[pesquisa](../../research/shared-touches.md) traz as regras do RN e a escolha.

| Lane | Checks | Responder do RN |
| --- | ---: | --- |
| desabilitada / só imperativo | 23 cada | `ResponderEventPlugin` do plugin legado |
| só interno / habilitado | 23 cada | `ReactNativeResponder` do dispatch nativo |

São **92 checks headless**.

```sh
npm run test:responders:shared-touches
```

## O que o RN faz

O RN tem um responder JS por runtime, e os dois responders leem a lista
`touches` de cada evento: um fim libera o responder quando nenhum toque listado
está dentro dele (`noResponderTouches` do plugin legado) ou quando não resta
toque nenhum (`ReactNativeResponder`); um cancel sempre termina. Um toque em
outra raiz não reivindica, porque não há ancestral comum. Numa superfície única
as duas plataformas listam todos os toques. Com várias superfícies, cada uma
mantém a própria lista (`_activeTouches` e `_identifierPool` por
`RCTSurfaceTouchHandler` no iOS; um `JSTouchDispatcher` por root view no
Android), então o RN tem o mesmo problema quando duas superfícies são tocadas
juntas, e o iOS ainda pode repetir identificadores entre elas.

## A mudança

O adapter de ponteiro de cada raiz acrescenta aos `touches` de cada TouchEvent os
toques ativos das outras raízes da aplicação, como uma superfície única faria.
`changedTouches` e `targetTouches` continuam os do alvo do toque, e cada toque
continua indo para a própria raiz. Os identificadores já eram da aplicação
(índice `i` do Godot vira `i + 1`, o mouse é 0). É um desvio deliberado das
listas por superfície das plataformas do RN, a favor da semântica para a qual o
responder único e o histórico de toques do RN foram escritos. Eventos de
ponteiro não mudam.

Uma consequência vem do próprio RN: quando o toque do responder termina enquanto
o de outra raiz continua, o plugin legado libera na hora, mas o
`ReactNativeResponder` (flags de dispatch nativo) só libera quando não resta
toque, e o press sai no fim do outro toque, com o payload dele. É o que uma
superfície única do RN faz com dois dedos; as flags públicas padrão usam o
plugin legado.

## O que foi verificado

Duas raízes de uma aplicação, cada uma com um `Pressable` original, pressionadas
por toques reais do Godot e pelo mouse. Em cada lane o runner confere os
callbacks com o toque que causou cada um e cada TouchStart, TouchEnd e
TouchCancel bruto com `changedTouches`, `touches` e `targetTouches`:

- **Sobreposições.** A pressionado e B tocado e solto, a ordem inversa e o mouse
  em A com um toque em B: a raiz pressionada primeiro pressiona uma vez com o
  próprio toque, o toque da outra raiz não reivindica, não libera nem pressiona,
  e cada evento lista os dois toques enquanto existem.
- **Toque próprio primeiro.** A pressionado, B tocado, A solta e depois B: nas
  lanes legadas A pressiona no próprio fim; nas de dispatch nativo, no fim de B.
- **Sequência.** Presses separados em A e depois em B pressionam uma vez cada.
- **Cancel.** O cancel do toque de B termina o responder de A (`pressOut`, sem
  `press`), como qualquer cancel numa superfície.

As lanes de uma mesma implementação produzem os mesmos callbacks em todos os
casos, e as duas implementações só divergem no caso do toque próprio primeiro.

## Controles

O host anterior (a árvore da `main` com o PanResponder, sem esta mudança) roda o
mesmo bundle na lane habilitada e falha exatamente as **9** checagens
normativas: A pressiona com o toque de B, A pressiona no próprio fim onde o
`ReactNativeResponder` seguraria, e cada evento lista só os toques da própria
raiz.

## Contratos atualizados

Dois testes existentes fixavam as listas por raiz e agora declaram a lista da
aplicação: o probe do dispatch integrado espera que o TouchEnd do toque de A
ainda liste o contato de B e que o dono do responder siga a regra de cada
implementação (o oráculo global explícito dele já mostrava o
`ReactNativeResponder` segurando até o último contato), e o exemplo
pointer-geometry espera que um TouchCancel em A ainda liste o contato
sobrevivente de B. Na revisão, o escopo declarado no relatório do probe integrado
passou de `root-local` para `application-wide` (`a906ab6`), e as duas lanes dele
(181 e 206 checks) passaram de novo no mesmo host (`reviewReruns` no recibo).

## Regressões

No mesmo host passaram os três gates do job `contracts` (260 testes Node e 13
Python, análise estática e scan de publicação), o `test:recovery`, as suítes
nativas — 22 exemplos, Down 2.731, query faults 187, resolver faults 66, Document
Up 6.459, View Up 297, Move 220, Document Move 1.940, hover 158, caminho da raiz
82, hover em Document 1.530, click 728, PanResponder 128, AppState 75, os próprios
toques compartilhados e `parity:godot` — e o lote do SDK nativo (codegen,
pack/verify, registro, loader e runtime de adapters, consumidor independente e
cold start). O bundle do SDK mudou com a `main`
(AppState e PanResponder), então os sete controles de host anterior que o fixam
foram refeitos nos hosts preservados e continuam com 8, 12, 3, 45, 32, 9 e 31
falhas normativas. O controle do click caiu por SIGKILL na primeira tentativa,
com a máquina carregada pelas entregas paralelas; ele foi refeito depois e a
suíte do click foi repetida contra ele. O dispatch integrado e os exemplos
falharam na bateria pelos dois contratos acima, e passaram depois de
atualizados.

As 16 fontes de código/configuração executadas (11 produtoras do bundle e da
suíte, 5 de verificação) correspondem à implementação
`1b7dac5` por `git show`/SHA-256. A bateria partiu de `283065d`; as mudanças de
teste que viraram `412c703` e `1b7dac5` estavam locais, e os passos que leem esses
arquivos rodaram de novo com elas.

## Limites

Captura de ponteiro entre raízes, vários dispositivos de toque, hardware real e
exports mobile seguem abertos.

A [CI hospedada](hosted-ci.json) desta fatia é o push da `main` em 8b87d78 (run
37392899167), com os cinco jobs verdes na primeira tentativa e sem reexecução. O
artefato `native-shared-touches` repete os **92 checks headless** nas quatro lanes
com IDs idênticos aos fixados, callbacks idênticos (inclusive a divergência de
`touch/a-lifts-first` entre os dois responders) e os mesmos toques crus em todas as
lanes. Os bundles diferem dos fixados porque a `main` trouxe o Switch (#33) depois
da bateria (o PanResponder, #32, já estava na branch empilhada). Os 16 arquivos
rastreados batem com a árvore do checkout; 6 diferem de `1b7dac5` por commits da
`main` e pela revisão do probe integrado, como lista o recibo. O
[Pages](publication.json) (run 37392898967) implantou exatamente os dados commitados
de 8b87d78; o site público já foi substituído pelo deploy seguinte da `main`. Nenhum
GF, checkpoint, dependência, peso ou denominador fecha.
