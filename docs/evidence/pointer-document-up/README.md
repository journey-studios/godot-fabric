# Document pointerup: four original flags and real native input

Executed headlessly on official Godot 4.7.2, macOS arm64 and pinned RN 0.87.1.
Each lane mounts two actual roots with distinct original Documents in one
Hermes application. The eight executions use the same corrected native host;
public EventTarget defaults remain disabled.

## Executed lane counts

`I` is `enableImperativeEvents`; `D` is
`enableNativeEventTargetEventDispatching`. Original interest installs no query;
current interest installs the SDK's original-Map query only when D is true.

| Interest | Flag mode | I | D | Passed/checks |
| --- | --- | --- | --- | ---: |
| original | disabled | false | false | 154/154 |
| original | imperative-only | true | false | 154/154 |
| original | internal-only | false | true | 157/157 |
| original | enabled | true | true | 159/159 |
| current | disabled | false | false | 154/154 |
| current | imperative-only | true | false | 154/154 |
| current | internal-only | false | true | 218/218 |
| current | enabled | true | true | 221/221 |

All 1,371 checks passed with unique check IDs within each lane and no recorded
application errors. Raw reports are retained as
`build/pointer-document-up-{original,current}-{disabled,imperative-only,internal-only,enabled}-report.json`.
Each includes its actual native host hash, bundle hash, 15 case producer pins and
22 original RN input pins. Bundles intentionally differ with the flag and interest
selection; this is not an identical-bundle previous-host causal comparison.
The runner independently checks the saved data, exact callbacks and diagnostics,
and preserves the public application bundle.

## Original methods and exact delivery

Document's add/remove/dispatch methods exist when D is true; View and
documentElement additionally require I. Original instances, owning Documents,
root getter identity and initially cold B's no-ref slot are checked in every
lane. Late override is rejected without changing the running flags.

In current/D-enabled lanes, native Document-only Up delivers `DocC, DocB`
at phases `1, 3`. With I enabled, isolated element Up delivers `RootC, RootB`
at phases `1, 3`; the combined case delivers `DocC, RootC, RootB, DocB`
at `1, 1, 3, 3`. Without I, the combined case has only the Document pair and
element-only remains inert. Independent Document/element capture-only cases
deliver their sole supported callback at phase 1. These are listener phases,
not pointer-capture ownership.

Positive root qualification is an actual `36=true` bubble lookup or, for
capture-only, `36=false` followed by `37=true`. Gated, removed or absent
listeners return false in both Up Maps. Earlier non-root ancestors can query
both phases before the root short-circuits. Their negative phase pairs, integer
category, order, root identity and unchanged ref slots are checked explicitly.
The root's short-circuit offsets are separate from the earlier component pairs.
Every component candidate belongs to the actual owning native Control snapshot;
every root candidate matches its actual surface ID. A leaf Up must begin with
its actual target's nonempty pair, preventing an empty or unrelated trace from
satisfying the interest assertion.

All qualified native callbacks have original trusted event/synthetic identities,
leaf target/ownerDocument, currentTarget/receiver/global event, Discrete priority
and zero release pressure/buttons. Up typed/star Raw occur once each with the
callbacks' exact native payload, timestamp and pointer ID. All functional callback
increments batch into one native React commit, including the four-callback case.
Original TouchEnd follows Up, has its own Raw pair and increments no state.
All Up phases observe the exact same Event object, independently of shared
payload identity. With original EventTarget dispatch, TouchEnd has a distinct
Event; without it, the compiled legacy JSX control reuses the upstream pooled
synthetic object between terminal callbacks in the unpersisted JSX control.
The matrix checks both observed behaviors; it does not generalize pooling to
all legacy events.
Transient context and Default priority restore after dispatch.

Original public manual dispatch independently proves registration: untrusted,
phase 2, target equal to the dispatched Document/element, no native Raw/query
or React increment. Original-interest lanes retain these positive controls while
blue-leaf native Up remains filtered. A distinct JSX sentinel works in all
lanes, through original trusted events with D or explicit compiled-legacy
synthetic events without D.

## No-ref, isolation, removal and cleanup

B starts without an assigned leaf ref and with publicInstance null. Its first
Down root lookups `34=false, 35=false` observe that slot unchanged immediately
before/after the real SDK query. A later positive B Up uses the publicInstance
already created by the original downstream dispatcher and preserves its slot.
The inspected SDK resolver reads the existing specialized root handle and
ownerDocument instead of a generic lazy ref helper. This is bounded source and
slot evidence; `lazyHelperCalled` is a fixture constant, not instrumentation.

While B holds a contact and Document listeners, A has no listeners. A's Up
records eight false own-path queries, only TouchEnd/Raw, no counter or commit,
and cannot change B's physical metrics, state or commits. B then receives its
own Document pair and ends normally. After final A listener removal, a new Up
has false root qualification and no Up callback/Raw/update; TouchEnd and
terminal cleanup stay healthy.

Actual Cancel has TouchCancel/Raw and both native cancel counters, no Up query,
callback or state increment. Stop leaves zero roots, contacts, processor
capture/hover, route ownership, pending work/timers/animation frames/retirements,
and no installed SDK query. Native Control creates/deletes balance for both
roots and recorded errors stay empty.

## Reproduce and native captures

```sh
npm run test:pointers:documents:up
node tests/pointer-document-up-native.test.mjs --interest=current --flag=enabled --capture
```

The [curated receipt](report.json) records all eight headless lanes and the
current/enabled graphical lane: **243/243 checks**, consisting of the same
221 core checks plus 20 native pixels and two counter/save assertions. The
Node runner also decodes the saved PNG bytes independently of the Godot report.

| Initial native frame | After the first Document-only Up |
| --- | --- |
| ![Native Up counters A0/B0](initial.png) | ![Document phases update A to2 while B remains0](updated.png) |

Both actual frames are 760×220. Blue is the physical target, green is the JSX
sentinel, yellow width follows Up callback count and purple follows revision.
The updated frame follows DocC and DocB: A=2, B=0 and exactly one React/native
commit. Later element/capture-only, isolation, removal, Cancel and stop cases
are verified in the reports, outside these two captured stages.

After the final shared-fixture change, the preceding Down eight-lane regression
passes **2,723 checks**. Contracts pass **255 Node and 13 Python tests** and
static analysis passes. Native and SDK production sources are unchanged from
[f7c2cf6](../pointer-up/report.json); its fresh SDK proof remains separate,
without claiming a new SDK runtime certification. This slice adds its own
eight-lane hosted gate and artifact; hosted Document Up is **pending**.

## Limits

This probe does not execute Up query/resolver faults, reentrant lifecycle,
once/abort, dispatch-time listener mutation, retained/retired refs, root
replacement/remount, captured/no-hit/null-target Up, got/lost capture,
coalescing or full responders. Down pointer delivery is filtered, so no public
Down/Up pointer-ID pair is certified. Development renderer, other priority
branches, hardware, Godot mobile exports, performance and full RN parity require
independent acceptance. Available helpers and preceding Down evidence do not
close these Up boundaries or a full GF item.

See the [research](../../research/pointer-document-up.md) and
[example](../../../examples/pointer-document-up/README.md).

View Up also passed again at62/62. The saved previous host still reproduces
54/62 with exactly eight failures on the same current SDK bundle; preceding
raw controls are preserved separately and current native files restored exactly.
