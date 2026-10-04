# Isolated imperative pointerdown interest

This example runs a paired native test for `pointerdown` listeners registered
on original React Native refs. It separates a live JS listener from the native
filter's decision to emit an event. The JSX lives in
[the pointer-interest fixture](../../tests/pointer-interest-fixture.jsx).
The [execution receipt](../../docs/evidence/pointer-interest/README.md) records
193 original / 230 current headless checks and 260 current macOS viewport checks,
including 28 pixel assertions and two actual 820×280 frames.

This is a standalone validation fixture outside the 22-example consumer catalog.
It is not a new catalog launcher or a requirement to use npm as the addon's front
door. Public imperative/native EventTarget flags remain off.

## Run the validation

From the repository root, after the existing native setup:

```sh
npm run test:pointers:interest
node tests/pointer-interest-native.test.mjs --capture
```

The runner compares `original` and `current` listener-interest
selections using the same JSX, original refs and native host. Both use the
original EventTarget dispatcher with original flags enabled before ref imports.
Only `current` requests
`platformPlugin(..., {nativeDispatchMode: "experimental", pointerInterestMode: "current"})`.
The default SDK helper remains empty; the current helper installs the query only
when both original imperative/native dispatch flags are enabled.

The native driver injects Godot ScreenTouch down/up/cancel through
`Input.parse_input_event` and the actual event queue. It does not inject
ScreenDrag. `--capture` keeps the original control headless and runs current
interest with the renderer; its additional 30 checks cover 28 pixels and two
image saves. The comparison uses one native host and identical authored/RN
inputs, with query-specific assertions only in current mode.

## Read the scene

![Original refs in the native pointerdown interest fixture](../../docs/evidence/pointer-interest/initial.png)

| Color | Case | Executed distinction |
| --- | --- | --- |
| Blue | Imperative-only View | No JSX pointer handler on its path. Manual original dispatch is positive; original native interest filters pointerdown while current delivers capture/bubble. The same View exercises once, removal, abort and listener mutation. |
| Teal | JSX plus imperative listeners | A real `onPointerDown` and an original ref listener share one native payload. Raw channels precede exact callback delivery through the existing batch; removing imperative interest leaves JSX working. |
| Purple | Child of a flattened View | Capture and bubble listeners on a logical View ancestor deliver in current mode. The ancestor has a live original ref/Fiber without native metrics or a materialized Godot Control. |
| Orange | View replaced by React | A keyed commit disconnects the old ref and creates a replacement. The retained listener still supports manual self-dispatch but cannot supply native interest to the replacement. |
| Yellow bar | React state | Trusted callbacks execute functional state updates. The renderer samples confirm the counter bar expands after the listener-case matrix. |

![Native pointerdown fixture after listener-driven React updates](../../docs/evidence/pointer-interest/updated.png)

These are generic Godot Viewport readbacks, not desktop screenshots. The updated
frame follows the listener-case matrix and precedes replacement/retirement;
the second root's counter remains at its initial state at that point.

The executed controls include no listener, a wrong event type, duplicate
registration, both phases, once, already-aborted and later-aborted signals, final
removal and a listener that removes its peer during dispatch. Separate roots,
stable refs after rerender and retained refs after replacement/teardown also have
independent native checks. No empty JSX helper makes the blue or purple cases pass.
Original and current controls preserve the same manual original-listener behavior.

Once removes its registration before its actual callback; removing a peer changes
the query during dispatch and suppresses that peer. Abort/final removal and the
next event observe the live original maps. App stop removes the installed query
and clears recorded roots/queues/timers/pointer routes; the probe does not call
the query after stop to test a false return.

## What the query changes

The shared toolchain appends a pure query to pinned original EventTarget source.
It reads the original capture/bubble maps for exact `pointerdown` registrations
and ignores removed entries. Original once, abort and removal semantics remain
in RN's listener implementation. No callback is wrapped, no parallel registry
is maintained and no declarative ViewProps listener is synthesized.

The source and relocation guards have also been executed separately: the default
helper bundles without a query/installer, the opt-in relocated helper imports
exact SDK RN modules, and project files/dependencies retain their ownership.
Native delivery has its own paired execution above; the packaging guards do not
substitute for it.

## Limits to retain in the receipt

The native interest scope is **View-path pointerdown capture and bubble**.
Document-only/documentElement-only interest remains a native gap even when their
original JS listener maps are live. The document-only case is a manual positive
with zero native callbacks and Raw pointerdown in both variants. Delivery through
a document after a View already qualifies cannot prove document-only interest;
documentElement-only acceptance remains pending. Move/up, hover and click require
their own implementation and acceptance. Arbitrary query callback faults and
cleanup are not certified by this fixture or the pure-query tests.

Injected desktop input does not certify physical hardware or Android/iOS. The
original source path selected by Godot is also not proof that every RN platform
has the same filter behavior. The full flag matrix, performance, public capability
enablement and complete event parity remain separate gates. See the
[query design and acceptance boundaries](../../docs/research/native-pointer-interest.md)
for the full scope.
