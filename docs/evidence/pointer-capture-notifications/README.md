# Notificações de captura de ponteiro para listeners

Esta fatia certifica `gotpointercapture` e `lostpointercapture` entregues a
listeners originais de EventTarget — na View, no documentElement e no Document,
nas fases de captura e de bolha, ao lado das props JSX do mesmo nó — e o que
hover e click fazem enquanto um ponteiro está capturado. O host já segue o
`PointerEventsProcessor` do RN: nenhum código nativo ou do SDK muda; só entram o
fixture, o probe, o runner, o script npm e o passo de CI. O [recibo](report.json)
fixa fontes, hashes e resultados; a
[pesquisa](../../research/pointer-capture-notifications.md) traz as fontes do RN
e as escolhas onde RN e W3C divergem.

| Lane | Checks | Quem recebe got/lost |
| --- | ---: | --- |
| desabilitada / só imperativo (original e current) | 84 cada | Props JSX (`onGotPointerCapture`, `onLostPointerCapture` e as de captura), pelo handler legado |
| só interno (original e current) | 84 cada | Props JSX e listeners do Document, pelo dispatch nativo |
| habilitado (original e current) | 84 cada | Props JSX e listeners do Document, do documentElement e das Views |

São **672 checks headless** nas oito lanes (interesse original/current × flags
desabilitadas, só imperativo, só interno e habilitado). O interesse não muda
nenhuma notificação: o RN emite got/lost sem consultar listeners, então a lane
original entrega aos listeners adicionados o mesmo que a current. A mesma
entrada do Godot produz a mesma sequência nativa nas oito lanes.

```sh
npm run test:pointers:capture
```

## O que foi verificado

Mouse (botão esquerdo) e toques reais do Godot sobre duas raízes de uma
aplicação: um container box-none com props de contato, um grupo com duas
folhas, um vizinho e uma View de topo sem nenhum listener. A prop
`onPointerDown` do container chama `setPointerCapture` no ref original e a
`onPointerMove` executa, dentro do move entregue, a transferência ou a
liberação agendada pelo probe. São 15 casos por lane.

- **Ordem.** A captura pedida no Down fica pendente: `hasPointerCapture` já
  responde `true`, mas o got só sai no evento seguinte daquele ponteiro, antes
  do hover e do próprio evento. Num Up imediato a ordem é got, up, lost e click;
  num Cancel, cancel, out, leave e lost.
- **Retarget.** Enquanto capturado, moves sobre a folha vizinha, o grupo, um
  ponto vazio da raiz, fora da superfície e sobre a outra raiz vão para o dono
  da captura, com offset local a ele; a raiz B não recebe nada.
- **Propagação.** A captura desce do Document (fase 1) pelo documentElement e
  pela prop de captura do container; no alvo, a prop de captura roda antes do
  listener de captura adicionado e a prop de bolha antes do listener de bolha
  (fase 2); a bolha sobe pelo grupo (prop, depois listener), pelo container,
  pelo documentElement e pelo Document (fase 3). Got/lost borbulham e são
  canceláveis, como o dispatch nativo do RN os constrói, em prioridade Discrete.
  As lanes sem dispatch nativo entregam só as props JSX, sem fase.
- **Alvo sem listeners.** Capturando a View de topo, que não escuta nada, got e
  lost saem mesmo assim e chegam só aos listeners do Document e do
  documentElement; o move e o Up redirecionados a ela não são emitidos, porque o
  RN os filtra pelo caminho do novo alvo.
- **Transferência e liberação.** Passar a captura para a folha vizinha dentro de
  um move entrega, no evento seguinte, lost na antiga e got na nova, depois out
  e leave da antiga e over e enter da nova. `releasePointerCapture` zera a
  consulta na hora; o lost e o hover de volta à posição física vêm no evento
  seguinte.
- **Estado.** Dentro do got, `hasPointerCapture` já indica o dono; dentro do
  lost, indica o próximo dono de uma transferência ou ninguém. Os mapas nativos
  ficam pendente/ativo `[1, 0]` depois do Down e `[1, 1]` a partir do evento
  seguinte. `setPointerCapture` sem botão pressionado é ignorado.
- **Hover.** O hover segue o dono: sem over/out ao passar fisicamente por outras
  Views enquanto capturado. Depois do Up de um mouse o hover continua no antigo
  dono até o próximo move; um toque sai do dono logo após o Up (up, out, leave,
  lost). Sem `setPointerCapture`, um toque não é capturado implicitamente: o
  hover e os alvos acompanham o dedo.
- **Click.** O click continua vindo dos caminhos físicos do Down e do Up, depois
  do lost: soltar sobre a folha vizinha clica o grupo, e uma captura mantida por
  uma terceira View não muda o click da folha pressionada.
- **Remoção.** Remover o dono enquanto o ponteiro sobrevive limpa a captura sem
  lost para ninguém (nem para o Document); o move seguinte volta ao alvo físico
  com over e enter, e o ref removido fica desconectado e sem captura. Remover a
  View que capturou o próprio contato cancela esse contato, pela regra de
  ciclo de vida já existente: nenhum listener vê cancel ou lost, o botão mantido
  fica inerte até ser solto e o mouse volta como um novo ponteiro.
- **Dois dedos.** Cada dedo tem a própria captura, processada pelo próprio
  evento e liberada pelo próprio Up; só o primário clica.

## Host anterior

Não se aplica: nenhum código nativo, do SDK ou do bundler compartilhado mudou. O
host preservado antes de qualquer mudança (`a1a7604e…`, compilado de `2ec988e`)
é byte a byte o host executado.

## Controles negativos retidos

- **SDK com got/lost sem bolha.** Com o view config base declarando
  `topGotPointerCapture`/`topLostPointerCapture` com `skipBubbling`, como enter e
  leave, os listeners de bolha acima do alvo deixam de rodar. O probe falha a
  entrega em 12 casos nas lanes legadas e 13 nas de dispatch nativo (o alvo sem
  listeners perde os do Document e do documentElement). O arquivo foi restaurado
  byte a byte.
- **Overlay com hover físico.** Um gerador do overlay que rastreia o hover pelo
  alvo físico em vez do redirecionado produz um host (`4e5c2d0a…`) que falha 33
  checks por lane: sequência, payload e entrega nos 11 casos em que o ponteiro
  sai da área do dono; passam só os quatro casos em que isso não acontece. O
  gerador foi restaurado byte a byte e o host recompilado é idêntico ao
  executado.

O oráculo independente do runner — um modelo do processador do RN e da regra de
click do Android, mais as regras de dispatch do DOM — roda sem os gates de
status do probe, rejeita os 16 relatórios sabotados e aceita os oito finais. Os
dois controles rodaram com o probe e o runner do commit de implementação.

## Regressões

Na árvore do commit de implementação passaram os três gates do job `contracts`
(260 testes Node e 13 Python, análise estática e scan de publicação), o
`test:recovery` e a própria suíte (67 s). As outras suítes nativas não foram
refeitas: só mudaram testes, CI e configuração, e o host é o mesmo.

## Onde RN e W3C divergem

O host segue o RN; o W3C fica documentado como diferença conhecida.

- **Click capturado.** O W3C dispara o click no alvo do pointerup capturado; o
  RN (Android e iOS) usa os caminhos físicos, depois de liberar a captura no Up.
- **Captura implícita de toque.** O W3C captura toques no pointerdown; o RN só
  captura quando o JS chama `setPointerCapture`.
- **Remoção do dono.** O W3C dispara `lostpointercapture` no Document; o RN
  0.87.1 não tem caminho até o Document e falha quando o dono removido ainda é
  retido, e o host limpa em silêncio, como o único ramo do RN que não falha.
- **Ordem no Up de toque.** O W3C libera logo após o pointerup (lost antes de
  out/leave); o RN emite up, out, leave e só então lost.
- **Hover após o Up do mouse.** O W3C envia os eventos de fronteira logo depois
  do lost; o RN espera o próximo evento do ponteiro.

## Mescla com a main

Depois da execução, a `main` recebeu o Switch (#33), os toques compartilhados
(#34), os touchables (#30) e o ActivityIndicator (#36). Ela foi mesclada na
branch em `803850c` e de novo em `0580af7` (`main` em `54ede87`), sem rebase,
para manter `6ad77b8` e `c23d928` alcançáveis; os conflitos eram só de anexo. O
host da árvore mesclada (`348be739…`) e o bundle do SDK mudaram; nele a suíte
passou de novo nas oito lanes (672 checks, 71 s), com os mesmos IDs, sequências,
coordenadas, entregas e estados de captura da corrida fixada, e o oráculo aceita
os oito relatórios. Também passaram o Switch (108), os toques compartilhados
(92), os touchables (93), o ActivityIndicator (33), `test:recovery` e os três
gates do job `contracts` (262 testes Node e 13 Python). O recibo registra essa
corrida em `mergeReverification`.

## Limites

Offsets de hover (projeção por alvo do host), captura sob transformações, caneta,
várias janelas, hardware e exports móveis do Godot ficam fora. Listeners
imperativos de hover durante a captura, captura por uma View de outra raiz,
liberação pelo dono errado e `stopPropagation`/`once`/`AbortSignal` nos listeners
de captura não foram exercitados separadamente.

A [CI hospedada](hosted-ci.json) desta fatia é o push da `main` em d62bc27 (run
37396999119), com os cinco jobs verdes na primeira tentativa e sem reexecução. O
artefato `native-pointer-capture-notifications` repete os **672 checks headless**
nas oito lanes com IDs idênticos aos fixados, as 15 sequências cruas e as listas
got/lost idênticas às fixadas em todas as lanes e bundles iguais aos da árvore
mesclada que a revisão registrou em `mergeReverification`. As 23 fontes rastreadas
batem com a árvore do checkout; 6 diferem de `6ad77b8` porque a `main` trouxe
commits depois da bateria (a fatia não muda código nativo nem do SDK). O
[Pages](publication.json) (run 37396999274) implantou exatamente os dados commitados
de d62bc27; o site público já foi substituído pelo deploy seguinte da `main`. Nenhum
GF, checkpoint, dependência, peso ou denominador foi fechado.

As 20 fontes de código/configuração do bundle e as 3 de verificação executadas
correspondem à implementação `6ad77b811cbb9cbd49ada1fd575deeb15301fda6` por
`git show`/SHA-256. A execução partiu do próprio commit, com a árvore limpa.
