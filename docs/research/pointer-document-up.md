# Original Document and documentElement pointerup interest

Status: eight isolated headless configurations executed on official Godot 4.7.2,
macOS arm64 and pinned RN 0.87.1. The [evidence](../evidence/pointer-document-up/README.md)
owns 1,371 headless checks, 243 actual macOS viewport checks and 20 native pixels.
The final Down regression passes 2,723 checks, contracts 255 Node/13 Python and
static analysis passes. Native/SDK production bytes are unchanged from the
preceding View Up implementation; its SDK proof stays separate. This slice has
its own hosted gate with CI pending. Public EventTarget defaults remain disabled.

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

## Boundaries still open

This healthy matrix does not execute Up query/resolver faults, reentrant lifecycle,
once/abort, listener mutation during delivery, retained or retired refs, root
replacement/remount, captured/no-hit/null-target Up, got/lost capture, coalescing
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
