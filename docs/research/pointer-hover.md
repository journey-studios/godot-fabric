# Letting original View hover listeners qualify native emission

Status: executed isolated macOS validation against pinned RN 0.87.1 and official
Godot 4.7.2. The [evidence](../evidence/pointer-hover/README.md) owns the 158
headless checks (137 healthy and 21 in a hover-fault application) and the
32-failure native control. Public EventTarget flags remain disabled. Hosted run
37352693788 repeated the 158 headless checks with identical IDs and bundle
([receipt](../evidence/pointer-hover/hosted-ci.json)).

## RN's hover algorithm filters before JS

`PointerEventsProcessor::handleIncomingPointerEventOnNode` keeps one
`PointerHoverTracker` per pointer. When the hover target changes, it applies
four ViewProps filters in this order:

1. `pointerout` to the previous target, if any node of the previous path declares
   `PointerOut` or `PointerOutCapture`;
2. `pointerleave` to each leaving node whose own `PointerLeave` is set, or whose
   `PointerLeaveCapture` (its own or a leaving ancestor's) is set, emitted from
   the target towards the root;
3. `pointerover` to the new target, if any node of the new path declares
   `PointerOver` or `PointerOverCapture`;
4. `pointerenter` to each entering node under the same rule, emitted from the
   root towards the target.

All four dispatch at Discrete priority. JSX props set those bits; imperative
listeners on original refs set none, so a View whose hover listeners were
imperative never received hover events, although a public `dispatchEvent` proved
them installed. The preceding host reproduces it with 32 normative failures and
no hover lookup at all.

The tracker runs for every pointer event, not only for mouse motion:
`interceptPointerEvent` calls it before emitting each Down, Move and Up, and once
more with a null target after any Cancel or an Up whose pointer
`shouldLeaveWhenReleased`. A touch therefore enters its path in the Down and leaves
it right after the Up emission.

## Extend the filters, keep the algorithm

The overlay ORs the original-Map query after each ViewProps check:
- `out`/`over`: the shared path query over the previous/current target, which
  stops at the first qualifying node;
- `leave`/`enter`: one query per node for its capture offset and its own offset,
  so RN's `hasParent…CaptureListener` propagation and short-circuits are unchanged.

The SDK maps the exact offsets (enter 0/23, leave 2/24, over 26/28, out 27/29).
At the root, `pointerenter` and `pointerleave` never bubble, so the Document's
bubble listener cannot qualify them; its capture listener and the documentElement's
own listener can. `pointerover`/`pointerout` bubble to the Document like the other
categories. Hover lookups run on hover changes rather than once per gesture, so
they share Move's bounded diagnostic policy.

A query reads only nodes with an existing public instance. RN creates those
lazily, when an event path or a ref first needs them, so a never-dispatched
ancestor is skipped without being created: it cannot hold a listener yet.

## Hover lookups in the older probes

Every touch Down/Up/Cancel and every mouse move now consults hover Maps, so the
Down, Up, Move, fault and Document probes keep the rows of the category they
certify in `query.rows` and the hover rows in `query.hoverRows`. None of their
fixtures registers a hover listener, so a final check requires every hover lookup
there to be a healthy false delegate. The Down resolver fault, a getter on the
target's `canonical.publicInstance`, would otherwise be consumed by the earlier
over lookup: it now lets the target's four hover reads through (26, 28, 23 and 0,
counted in an identical healthy gesture) and still fails the Down lookup's own
read.

## Why the probe is discriminating

The [driver](../../tests/pointer-hover-probe.gd) moves a button-less mouse between
the empty surface area, A's target and back, with the four hover types registered
on the target or its parent, bubble or capture. The
[runner](../../tests/pointer-hover-native.test.mjs) re-derives every expected
callback and lookup from RN's rules:
- Callbacks must match exactly in order, phase, target, currentTarget and Discrete
  priority, with one typed/star Raw pair per dispatched event.
- The full lookup sequence must match, short-circuits included.
- Moving inside the target must produce no hover.
- Manual dispatches must follow the original bubbling rules.
- A touch with target listeners receives over and enter in the Down, before
  TouchStart and with `buttons` 1, and out and leave right after the Up emission,
  before TouchEnd and with `buttons` 0; its own Down lookups follow the hover entry
  and its Up lookups precede the exit.
- B, with no listener, reads false everywhere.

The Raw check compares against the expected dispatches, so an undelivered event
cannot pass it vacuously.

## Next bounded acceptance

- **Empty-area targets.** In this host the empty surface area has no hit target,
  while RN resolves it to the root view (`TouchTargetHelper` on Android,
  `RCTRootComponentView` hit testing on iOS). RN 0.87.1 creates the root family
  without an event dispatcher and its EventTarget without an instance handle, so
  no root-targeted event reaches JS: Document listeners receive nothing over empty
  areas in either. The observable difference is the hover path. This host drops
  the root from it on every transition into an empty area, while RN's C++ processor
  keeps it, so a Document capture `pointerenter`/`pointerleave` listener here sees
  enter/leave for every node of the path, which RN does not emit while the pointer
  stays within the root. This predates hover and belongs to the Document hover
  certification. (An earlier version of this note claimed that RN delivers
  Down/Up/Move and hover to Document listeners over empty areas; it does not.)
- **Document hover.** Document/documentElement hover listeners now qualify through
  the root rule, certified only by the plugin unit tests.
- **Remaining scope.** Pen hover, touch with other listener placements, pointer
  capture while hovering, root retirement with an active hover, responders,
  hardware, exported mobile input and performance remain open.

The [example](../../examples/pointer-hover/README.md) shows the ordinary ref syntax
within the isolated opt-in configuration.
