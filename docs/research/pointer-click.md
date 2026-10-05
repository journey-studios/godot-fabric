# Synthesizing click and handing scroll drags to the scroll view

Status: executed isolated macOS validation against pinned RN 0.87.1 and official
Godot 4.7.2. The [evidence](../evidence/pointer-click/README.md) owns the
728 headless checks in eight lanes, the preceding-host control and two retained
negative controls. Public EventTarget flags remain disabled.

## What RN does on a release

Neither platform receives a click from the OS: each synthesizes `topClick` when
a pointer is released.

- **Android** (`JSPointerDispatcher`) keeps the Down's native hit path and, on
  the Up, dispatches `topClick` to the first view of the Up's hit path that the
  Down's path also contains: the deepest view both share, which is the web's
  nearest common inclusive ancestor. Its listener check always passes for click,
  and it does not look at the button or at `isPrimary`.
- **iOS** (`RCTSurfacePointerHandler`) emits `onClick` right after `onPointerUp`
  on the release's own view, when the pointer is primary, the released button is
  0 and that view lies on the Down view's path to the root.
- In both, the C++ `PointerEventsProcessor` passes `topClick` straight through:
  no hover tracking and no listener gate. `TouchEventEmitter::onClick` dispatches
  it as a Discrete event. A click whose shared view is the root reaches nothing,
  since the root's family has no event dispatcher.
- `BaseViewConfig` declares `topClick` with `onClick`/`onClickCapture` on both
  platforms. Pressability's `onClick` ignores any click whose payload owns
  `pointerType`, so a tap still presses once, through the responder.

## What RN does when a scroll view starts dragging

A native scroll view intercepts the contacts begun inside it. On Android,
`onInterceptTouchEvent` reports a native gesture and
`JSPointerDispatcher.onChildStartedNativeGesture` dispatches `pointercancel` to
the contact's current target, then ignores the rest of that gesture. On iOS the
scroll view's pan recognizer cancels the touches in the view, which reaches
`touchesCancelled`. Either way JS sees one cancel and no Up, so a scroll never
clicks.

## What this host did

- The host never emitted `topClick`: no `onClick` prop or click listener ran.
- The SDK's base view config did not declare `topClick`. With the public default
  flags, React's legacy plugin rejects an undeclared event type, so a host that
  emitted click would have thrown `Unsupported top level event type "topClick"
  dispatched` on every release. The SDK Pressable also dropped Pressability's
  `onClick` (input could not emit it), which let a caller's own `onClick` reach
  its View; RN's Pressable replaces it.
- The SDK ScrollView scrolls through the JS responder (`scrollDragStart`,
  `scrollDragTo`, `scrollDragEnd` commands). Its contacts kept emitting moves and
  an Up during the drag, so a click would have followed every scroll gesture.

## The change

- **Hit paths.** The adapter records the contact's mounted hit path at Down: the
  view and its mounted ancestors up to the root's child, through Godot Controls.
  Flattened views have no Control, exactly as they have no native view in RN.
- **Click.** At the Up, a primary pointer releasing button 0 clicks the first
  view of the Up's path that the Down's path contains. A contact whose paths
  share only the root, or with an empty Down or Up, does not click. The click
  copies the Up's sample (pointer, page point, timestamp, no buttons) and is
  dispatched Discrete through the target's emitter, right after the Up; the
  binding projects its offset onto the click target. It never resolves a missing
  target elsewhere and ends its contact like the Up for geometry.
- **Takeover.** When `scrollDragStart` starts a drag on a scroll view the JS
  responder owns, every pressed contact begun inside it receives one
  `pointercancel` at its current target and then emits no pointer event until it
  is released; its touches keep driving the JS responder that scrolls. A removed
  view no longer cancels such a contact through its old pointer target.
- **SDK.** The base view config declares `topClick` and `onClick`/
  `onClickCapture`, and Pressable keeps Pressability's `onClick`, as RN does.

## Choices where RN's platforms differ

- **Target.** Android's deepest shared view, which the web also uses. iOS clicks
  only when the release view lies on the Down view's path, so it drops a release
  on a sibling or on a descendant of the pressed view.
- **Filter.** iOS's primary pointer and main button, like the web's `click`.
  Android also clicks for secondary buttons and fingers.
- **Chords.** The button released at the Up decides, as on iOS: a chord whose
  last released button is not the main one never clicks. The web would click
  when the main button rises over the element.
- **Capture.** RN releases capture implicitly in the Up, before the click, so
  the processor never retargets a click to a capturing view. The host keeps that
  order; capture during a click is not separately certified.
- **Container.** Godot mounts the AppRegistry View that RN's release builds
  flatten. Two top-level children therefore share it, and a press on one
  released on the other clicks that container, which only a Document or
  documentElement listener can observe; RN drops that click at the root. Empty
  root points still never click.

## Why the probe is discriminating

The [driver](../../tests/pointer-click-probe.gd) presses and releases actual
Godot mouse buttons and touches over two roots of one application: a group with
two leaves, a sibling, a top-level view, an SDK Pressable and an SDK ScrollView.
Inert pointer props on the container and the top-level view make RN dispatch
each contact's Down, Move, Up and Cancel, so Raw orders them around the click.
The [runner](../../tests/pointer-click-native.test.mjs) states the scene and
RN's rules independently and checks, in every lane:

- **Targets.** Same leaf, two siblings, leaf to group and group to leaf, two
  cousins under the box-none container, two top-level views (the container),
  and no click for an empty root point, a release outside the surface, an empty
  Down, a release over another root, a canceled contact or a removed target.
- **Filters.** Right and middle buttons never click; a chord clicks only when
  the main button is released last; a second finger never clicks while the first
  one does.
- **Payload and order.** The click copies its Up's pointer, page point,
  timestamp and primary flag with no buttons, its offset is local to its own
  target, and it follows the Up and precedes the contact's TouchEnd.
- **Propagation.** Document listeners need native dispatch and documentElement
  and View listeners also imperative events; capture runs from the Document down
  and each node's JSX prop runs before its added listeners. Legacy lanes deliver
  JSX props only. No click reads a listener Map.
- **Pressable.** A tap presses once, after the ignored pointer click.
- **Takeover.** A touch drag and a mouse drag in the scroll view deliver one
  cancel after the begin-drag, no later move or Up and no click, while touches
  keep scrolling it; a later tap clicks normally.

The preceding host runs the same bundle and fails exactly the 31 normative
checks (no click in 14 cases, no takeover in 2, and the native counters). A host
that clicks the release target instead fails 10 checks in the five cases where
the two differ, and a base view config without `topClick` makes the legacy lane
throw on each click; the independent oracle rejects all three reports.
