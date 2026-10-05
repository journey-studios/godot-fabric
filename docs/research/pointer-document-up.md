# Original Document and documentElement pointerup interest

Status: eight isolated headless configurations executed on official Godot 4.7.2,
macOS arm64 and pinned RN 0.87.1. The [evidence](../evidence/pointer-document-up/README.md)
owns 1,371 headless checks, 243 actual macOS viewport checks and 20 native pixels.
The final Down regression passes 2,723 checks, contracts 255 Node/13 Python and
static analysis passes. Native/SDK production bytes are unchanged from the
preceding View Up implementation; its SDK proof stays separate. This slice has
its own hosted gate: baseline 84270fb passed 1,371 checks and all five workflow jobs.
The later lifecycle slice below passed 2,143 hosted checks in run 37246479501
([receipt](../evidence/pointer-document-up-lifecycle/hosted-ci.json)).
Public EventTarget defaults remain disabled.

## The root-level contract

The [preceding View Up validation](pointer-up.md) established that an imperative
View listener can qualify real native Up emission. It did not establish that
Document or documentElement listeners qualify when no View/JSX pointer listener
exists along the target path. This probe exercises that root qualifier without
adding another event API or mirroring the listener registry.

Real Godot ScreenTouch Down/Up/Cancel passes through the native PointerAdapter,
original RN pointer processor and experimental original dispatcher. If normal
ViewProps do not qualify Up, the existing SDK query reads the original EventTarget
phase/type Maps. For an actual current root family, the native boundary passes
RN's specialized documentElement handle with the root discriminator. The SDK
reads its existing element and ownerDocument and tests their original Up Maps.
Component queries continue to inspect existing public refs.

The scene has two actual roots in one Hermes application. A has a public leaf
ref; B's leaf intentionally has no React ref. The blue leaves have no JSX Down
or Up helper. A separate green JSX Up sentinel is a positive transport control;
its prop cannot qualify a blue sibling.

## Preserve the original flag gates

`I` means `enableImperativeEvents`; `D` means
`enableNativeEventTargetEventDispatching`. Each configuration starts a separate
execution and sets its flags before original RN imports. A late override is
rejected in all eight lanes; the running flags remain unchanged.

| I | D | Document add/remove/dispatch methods | View and documentElement methods | Current SDK query installed |
| --- | --- | --- | --- | --- |
| false | false | Absent | Absent | No |
| true | false | Absent | Absent | No |
| false | true | Present | Absent | Yes |
| true | true | Present | Present | Yes |

The original Document/element instances and ownership relationships are checked
in every lane. Method absence is tested directly without borrowing a prototype.
In `interestMode=original`, no query is installed even when D is enabled. That
mode uses the same corrected native host with the query disabled; it is not a
previous-host native replay. Its positive manual dispatch controls demonstrate
that original listener installation alone does not qualify native Up emission.

## Native propagation and qualification

With current interest and D enabled, Document-only listeners deliver `DocC`
then `DocB` at phases 1 and 3, targeting the original leaf rather than Document.
With I also enabled, isolated element listeners deliver `RootC`, `RootB` at
phases 1 and 3. The combined configuration delivers
`DocC, RootC, RootB, DocB` at phases `1, 1, 3, 3`. With I disabled the combined
configuration delivers only the two Document callbacks.

Each category has an independent capture-only configuration. Document capture
works with D; element capture additionally requires I. Their sole callback is
phase 1. Capture here means listener phase; neither configuration requests
pointer-capture ownership.

The root's actual bubble lookup is `36=true` for registrations with bubble
interest. Capture-only observes `36=false` then `37=true`; absent/gated listeners
observe `36=false, 37=false`. Earlier component lookups legitimately test both
Up Maps and return false even when the later root bubble lookup succeeds.
The test checks full category membership, same-candidate phase pairs and their
ordering independently of the root's short-circuit result. JSON numeric offsets
are verified as exact integers before membership checks; converting them does
not discard a phase or relax a registration expectation.

All native Up callbacks are trusted original Event/LegacySyntheticEvent
instances with the expected target, ownerDocument, currentTarget, receiver,
Discrete priority and global event. Typed and star Raw each deliver once for
one native Up payload, even when four JS callbacks propagate. Actual payload,
timestamp and pointer ID agree; pressure and buttons are zero. Each callback
performs a functional increment. The two or four increments batch into one
native React commit. Original TouchEnd follows Up with its own exact Raw pair
and adds no state update. Default priority and transient fields restore.

Manual Document/element dispatch separately targets that original object at
phase 2, untrusted, with no native Raw, query entry or counter increment. The
independent JSX sentinel delivers in all eight lanes: original trusted events
when D is enabled, explicit compiled-legacy synthetic events when D is disabled.

## No-ref resolution, isolation and terminals

B starts with `canonical.publicInstance=null` and no assigned ref. During its
first real Down, the observed root `34/35` false lookups preserve that null slot
immediately before and after the delegated query. The observer forwards the real
SDK callback; it does not create a replacement listener registry. The SDK source
uses the specialized existing root handle rather than a generic lazy ref lookup.

The original downstream dispatcher may subsequently materialize the target.
At B's later Up, the observed publicInstance already exists and remains unchanged
across the positive root query. This is not a claim that a positive Up was
qualified while the leaf was still cold. The fixture's `lazyHelperCalled` field
is a declared constant, not an instrumented call counter; slot observations and
the inspected resolver source provide the bounded evidence.

B's Document listeners remain installed while B holds a contact and A has no
listeners. A's Up observes false qualification, produces only TouchEnd/Raw and
changes neither A's counter nor held B's physical metrics, state or commits.
B's subsequent Up then delivers its own Document callbacks and clears its contact.
After a positive A Document gesture, removing the final listeners changes its
next Up from a positive root query to two false lookups, no Up callback/Raw and
no React update. The physical TouchEnd and cleanup still occur.

A real Cancel invokes TouchCancel/Raw and increments both native cancel counters,
without an Up query, callback or state update. Stop clears the real roots, SDK
query, physical contacts, processor capture/hover registries, routes, work, timers,
animation frames and pending retirements. Native Control creates/deletes balance
for both roots and recorded application errors remain empty.

## Ciclo de vida: `once` e `AbortSignal` do RN

Uma fatia posterior amplia a matriz com três casos de listener bubble do
Document: `once`, sinal já abortado ao registrar e abort após o primeiro Up.
As oito execuções headless passam **2.143 checks**; a tabela da
[evidência de lifecycle](../evidence/pointer-document-up-lifecycle/README.md)
separa esses resultados do recibo anterior de 1.371 checks e suas imagens.
A implementação nativa e o SDK permanecem iguais à fatia anterior.

Com interesse current e D habilitado, o primeiro Up consome o listener
`{once: true}`: root `36=true`, um `DocB` trusted em fase 3, um par Raw e
um incremento funcional em um commit. O segundo gesto consulta
`36=false, 37=false`; Up não entrega callback/Raw nem incrementa o contador.
TouchEnd/Raw e a limpeza física continuam funcionando nos dois gestos.
A emissão manual posterior também encontra o listener consumido.

No controle `interestMode=original`, D permite registrar o listener, mas não
instala a consulta nativa. Dois gestos físicos permanecem filtrados e não
consomem `once`. A primeira emissão manual posterior chama `DocB` untrusted,
em fase 2, e o consome; a segunda fica vazia. Esse controle confirma instalação
e consumo original separadamente da qualificação de input nativo.

O caso pre-aborted observa a instância original de `AbortSignal` do RN com
`aborted=true`. A tentativa de registrar não produz entrega nos dois gestos nem
na emissão manual. O caso abort-after observa `aborted=false`, executa o
primeiro Up e um controle manual positivo; então o abort muda o sinal para
`true` sem alterar contador, commits, ownership físico ou consultas do SDK.
O segundo Up e a emissão manual posterior ficam vazios. Quando D está
desabilitado, os métodos do Document estão ausentes e a fixture não associa
um sinal ao registro. A classe AbortSignal não recebe um novo gate D.

A prova cobre esses três listeners bubble de Document, com prioridades,
identidades, Raw e terminais verificados pelo mesmo oráculo. Não certifica
`once`/abort em todas as fases, View/documentElement, abort dentro de uma entrega
ou gesto ativo, retired refs ou reentrância. A execução gráfica passou414checks
em cinco frames nativos, com62pixels conferidos por readback Godot e decode
Node independente. As três capturas novas mostram `once`: A12/B2 antes,
A13/B2 após o primeiro Up e A13/B2 após o segundo; veja o exemplo e os PNGs
da evidência. A CI baseline84270fb confirma1371checks, separada da nova fatia.

## Retained roots, retirement and remount

The [refs evidence](../evidence/pointer-document-up-refs/README.md) adds three
root-generation controls to every lane, for **2,709 headless checks**. A real
rerender keeps the original Document, documentElement, View ref and root getter,
and the next Up delivers the same listeners. Retiring A while A and B hold
contacts cancels A first: its leaf observes exactly one original TouchCancel with
its own Raw pair, and no `pointerup`, Raw Up, interest query or React update
reaches the retained OldDoc/OldRoot listeners. B keeps its contact and metrics,
then its Up qualifies normally. The replacement root has a new surface and a
connected fresh Document. A gesture with only retained listeners queries
`36=false, 37=false`; a manual dispatch on the retained Document still reaches
OldDoc, so inertness is not listener removal. The release for the index
cancelled by retirement is swallowed even with fresh listeners installed, and
the next complete gesture qualifies through the fresh Document only. No native
or SDK file changed; the graphical lane passes 535 checks with 90 pixels.
Hosted run 37310815360 repeated the 2,709 headless checks
([receipt](../evidence/pointer-document-up-refs/hosted-ci.json)).

## Listener mutation during native dispatch

The [mutation evidence](../evidence/pointer-document-up-mutation/README.md) runs
mutations from inside delivered native Up callbacks, for **4,401 headless
checks**. The original dispatcher snapshots each target/phase Map when it reaches
it, and native delivery preserves that: a capture listener removing the bubble
listener suppresses it in the same Up, and the next gesture queries
`36=false, 37=true`; removal or AbortSignal abort of a pending sibling in the Map
being iterated skips it through the `removed` mark; an add to that same Map waits
for the next gesture. A capture listener that adds documentElement and Document
bubble listeners gets both delivered in the same Up, although the pre-dispatch
root query saw only the capture Map: native delivery is not filtered by phase.
An add to another root's Document leaves that root unchanged until its own
gesture, which then qualifies. A deliberate wrong-phase removal fails eight probe
checks, and the independent oracle rejects that retained report on its own. The graphical lane passes 835 checks with 118
pixels; native/SDK bytes are unchanged. Hosted run 37319530371 repeated the 4,401
headless checks ([receipt](../evidence/pointer-document-up-mutation/hosted-ci.json)).

## Reentrant dispatch from native callbacks

The [reentry evidence](../evidence/pointer-document-up-reentry/README.md) starts a
nested dispatch from delivered native Up callbacks, for **5,097 headless
checks**. A capture or bubble Document listener that dispatches a new
`pointerup` on its own Document gets all three Document listeners called at
phase 2, untrusted, on one Event object distinct from the Up and still at
Discrete priority; the nested Event is clean when `dispatchEvent` returns. The
native Up keeps its trust, phase, currentTarget, target, five-target path and
global binding, and the remaining outer listeners run trusted. Re-dispatching
the native Up itself throws before changing it. A nested dispatch on another
root's Document reaches that root's listeners without native query, Raw, state,
commit or contact change. A retained control that leaks the nested Event into
`globalThis.event` fails three probe checks, and the oracle rejects it on its own.
Hosted run 37321794370 repeated the 5,097 headless checks
([receipt](../evidence/pointer-document-up-reentry/hosted-ci.json)).

## Root query faults at the Up offsets

The [fault evidence](../evidence/pointer-document-up-fault/README.md) arms one-shot
faults on the actual documentElement root handle at offsets 36/37, in a second
application started after the healthy one stops, for **6,451 headless checks**.
The native interest callback already rejects only the failed lookup: a bubble
throw still lets the capture lookup qualify and deliver `DocC, DocB` in one
commit; a throw or non-boolean result with no other qualifying lookup delivers
no Up, while the original TouchEnd, its Raw pair and contact cleanup survive.
Each consumed fault leaves one retained `E_POINTER_LISTENER_QUERY`; a capture
fault is not consumed when the bubble lookup qualifies first. Recovery gestures
are healthy. A retained control that turns a throw into a qualifying `true`
fails nine probe checks, and the oracle rejects it on its own.

## Boundaries still open

This healthy matrix does not execute component or resolver faults on Up, reentrant lifecycle,
nested dispatch on elements or with preventDefault/stopPropagation/errors,
View/element listener mutation, mutation combined with
stopPropagation, capture-phase or View listeners across root
retirement, application stop/restart or keyed remount of the whole tree,
captured/no-hit/null-target Up, got/lost capture, coalescing
or full responder negotiation. Down is deliberately filtered here, so no public
Down/Up pointer-ID pair is established. Development renderer, other event-priority
branches, hardware, Godot mobile exports, complete RN parity and performance
require separate acceptance. Available helper methods are not evidence that
these scenarios ran. See the [isolated example](../../examples/pointer-document-up/README.md).

The strengthened oracle also checks that all Up phases observe the same Event
object and every queried component tag belongs to the actual owning native
Control snapshot. With EventTarget dispatch, TouchEnd uses a distinct Event.
The unpersisted D-disabled JSX sentinel observes the original renderer pool
reusing the synthetic object between terminals; serialized callback payloads
remain distinct. This observed pooling is limited to that control.

View Up also passed again at62/62. The saved previous host still reproduces
54/62 with exactly eight failures on the same current SDK bundle; preceding
raw controls are preserved separately and current native files restored exactly.
