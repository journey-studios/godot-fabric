# Click na soltura e takeover do ScrollView

Esta fatia faz o host sintetizar `click` quando o ponteiro primário solta o
botão principal, como as plataformas do RN, e faz o arrasto de um ScrollView
assumir o contato que começou nele, como o scroll nativo do RN. Ela muda o host
nativo e o SDK e roda em oito lanes: interesse original/current × flags
desabilitadas, só imperativo, só interno e habilitado. O [recibo](report.json)
fixa fontes, hashes e resultados; a [pesquisa](../../research/pointer-click.md)
traz as fontes do RN e as escolhas onde Android e iOS divergem.

| Lane | Checks | Quem recebe o click |
| --- | ---: | --- |
| desabilitada / só imperativo (original e current) | 91 cada | Props JSX (`onClick`, `onClickCapture`), pelo handler legado |
| só interno (original e current) | 91 cada | Props JSX e listeners do Document, pelo dispatch nativo |
| habilitado (original e current) | 91 cada | Props JSX e listeners do Document, do documentElement e da View |

São **728 checks headless** no total. O interesse original ou current não muda
nenhum click: o RN despacha cada click sem consultar Maps de listener.

```sh
npm run test:pointers:click
```

## O que foi verificado

Mouse e toque reais do Godot pressionam e soltam sobre duas raízes: um grupo com
duas folhas, um vizinho, uma View de topo, um `Pressable` e um `ScrollView` do
SDK. Props de ponteiro inertes no container e na View de topo fazem o RN
despachar Down, Move, Up e Cancel de cada contato, para o Raw ordenar o click.

- **Alvo.** Mesma folha; duas folhas irmãs (clica o grupo); folha para o grupo e
  grupo para a folha (o grupo); dois primos sob o container box-none (o
  container); duas Views de topo (o View do AppRegistry, que o Godot monta). Não
  clicam: soltura num ponto vazio da raiz, fora da superfície ou sobre outra
  raiz, Down num ponto vazio, contato cancelado e alvo removido durante o
  pressionamento.
- **Filtros.** Botões direito e do meio nunca clicam; um acorde clica só quando
  o botão principal é o último solto; o segundo dedo não clica e o primeiro sim.
- **Payload e ordem.** O click copia ponteiro, ponto, timestamp e `isPrimary` do
  seu Up, sem botões, com offset local ao próprio alvo; vem depois do Up e antes
  do TouchEnd do contato, em prioridade Discrete, e o payload tem `pointerType`.
- **Propagação.** Listeners do Document precisam do dispatch nativo; os do
  documentElement e da View também dos eventos imperativos. A captura desce do
  Document (fase 1), o alvo roda em fase 2 e a bolha sobe em fase 3; em cada nó a
  prop JSX roda antes dos listeners adicionados. As lanes sem dispatch nativo
  entregam só props JSX.
- **Pressable.** Um tap pressiona uma vez, depois do click de ponteiro que o
  Pressability ignora.
- **Takeover.** Um arrasto de toque e um de mouse no ScrollView entregam um
  `pointercancel` depois do início do arrasto, nenhum move, Up ou click depois
  dele, e os toques continuam rolando o conteúdo; um clique seguinte funciona.
- **Isolamento.** A raiz B só recebe o próprio click.

## Host anterior

O host da `main` antes desta fatia roda o mesmo bundle na lane current ×
habilitado e falha exatamente as **31** checagens normativas: nenhum click nos
14 casos que clicam (alvo e entrega), nenhum takeover nos dois arrastos e os
contadores nativos. Nada mais muda.

## Controles negativos retidos

- **Host que clica o alvo do Up.** O adapter sabotado clica o alvo da soltura
  sempre que o Down tem caminho. Ele falha 10 checagens, nos cinco casos em que
  esse alvo e o ancestral comum diferem (irmãos, grupo para folha, primos, Views
  de topo e arrasto de toque). A fonte foi restaurada byte a byte e o host
  recompilado é idêntico ao executado.
- **SDK sem `topClick`.** Com o view config base sem `topClick` e sem
  `onClick`/`onClickCapture`, a lane desabilitada lança `Unsupported top level
  event type "topClick" dispatched` a cada click (35 falhas) e a habilitada perde
  todos os callbacks (18 falhas). O arquivo foi restaurado byte a byte.

O oráculo independente do runner, sem os gates de status do probe, rejeita os
três relatórios e aceita os finais.

## Regressões

No mesmo host passaram os três gates do job `contracts` (260 testes Node e 13
Python, análise estática e scan de publicação), o `test:recovery`, as 26 suítes
nativas — 22 exemplos, Down 2.731 nas oito lanes, query faults 187, resolver
faults 66, Document Up 6.459, View Up 297, Move 220, Document Move 1.940, hover
158, caminho da raiz 82, hover em Document 1.530, o próprio click 728 e
`parity:godot` — e o lote do SDK nativo (codegen, pack/verify, registro, loader
e runtime de adapters, consumidor independente e cold start).

A primeira rodada reprovou só as seis suítes que comparam o controle do host
anterior com o bundle atual do SDK, que esta fatia muda. Os controles de View
Up, query-fault, resolver-fault, Move, hover e caminho da raiz foram refeitos
nos hosts preservados com os bundles novos e continuam com 8, 12, 3, 45, 32 e 9
falhas normativas (o caso de Document do caminho da raiz segue caindo no host do
hover). A segunda rodada passou inteira; nela o `test:examples` foi repetido
depois que o editor do Godot de uma rodada interrompida liberou o projeto, e o
log do timeout ficou retido.

## Limites

Clicks com captura de ponteiro, `auxclick`, `contextmenu`, `dblclick`,
ativação por teclado e acessibilidade, caneta, takeover em scroll aninhado ou
horizontal, seleção de superfície para input na área vazia, responders,
hardware, exports mobile e performance seguem abertos.

A [CI hospedada](hosted-ci.json) desta fatia é o push da `main` em 72155bc (run
37375758262), com os cinco jobs verdes na primeira tentativa — inclusive o
`reference-ios`, que agora espera até cinco minutos pela listagem de simuladores, e
o job nativo, que levou 25,5 minutos dentro do novo limite de 45. O artefato
`native-pointer-click` repete os **728 checks headless** nas oito lanes com IDs,
bundles e estágios idênticos aos locais; além de timestamps, da versão patch do
Node, dos hashes do host e do bundle público do runner e de timers do Pressability
ainda pendentes conforme a velocidade da máquina, nada difere, e as 28 entradas
rastreadas batem com 8948a1c na árvore do checkout. O controle do host anterior e os
controles negativos continuam locais. O [Pages](publication.json) (run 37375758284,
push da `main` em 72155bc) implantou exatamente os dados commitados, e o JSON
público e a API local conferem com eles. Nenhum GF, checkpoint, dependência, peso ou
denominador foi fechado.

As 28 fontes de código/configuração executadas (23 produtoras do bundle e 5 de
verificação) correspondem à implementação
`8948a1c05ae8d99c780182bb7e94adec89d8c789` por `git show`/SHA-256. A execução
partiu de 15e1dda com as mudanças desta fatia ainda locais. Este pin pós-commit
não é uma nova corrida.
