# Keeping the root in the hover path without targeting it

Status: executed isolated macOS validation against pinned RN 0.87.1 and official
Godot 4.7.2. The [evidence](../evidence/pointer-root-path/README.md) owns the
82 headless checks and the two-part control on the View hover host: its View
case fails exactly 9 normative checks, and its Document case crashes. Public
EventTarget flags remain disabled.

## What RN does with an empty point

RN resolves a point that hits no view inside a root view to the root itself:
`TouchTargetHelper` on Android starts at the root's id and its pointer-event
search returns the root (`pointerEvents` AUTO, SELF), and on iOS the root
component view's `hitTest` returns itself. In the pinned C++ processor, the root
is therefore the hover target, so it stays in the hover path while the pointer
is anywhere inside the root. Only a point outside the root leaves the whole path.

No event targeted at a root reaches JS. `ShadowTree` creates the root family
with a null event dispatcher and without an instance handle, so the root's
EventTarget is never enabled and has nothing to resolve. RN never qualifies the
root as a target anyway: `RootProps` declares no pointer listener.

## What this host did

The Godot host passed a null target for an empty point, so the root left the
hover path on every transition between a view and the empty area of the same
surface. With imperative listeners this was observable in two ways:

- A Document capture `pointerenter`/`pointerleave` listener qualifies the root's
  capture lookup. Leaving and re-entering the root propagated leave and enter to
  every node of the path on each such transition, where RN emits nothing while
  the pointer stays inside the root.
- The View hover slice let the root qualify its own enter/leave through the
  root query. The processor then dispatched enter/leave to the root, and RN's
  `UIManagerBinding::dispatchEventToJS` dereferenced the root EventTarget's
  missing instance handle: the process crashed (SIGSEGV) as soon as a pointer
  entered a surface with such a Document listener. Public flags are off, so only
  the opt-in configuration was exposed.

## The fix

- **Root target inside the root.** The pointer adapter reports whether an empty
  point lies inside the root view. The Godot payload carries that flag, and the
  binding resolves such a JS-less sample to the surface's current root node
  before the processor intercepts it, so the processor sees RN's target.
- **The root is never a target.** The overlay's path query returns false for a
  root target, the enter/leave loops never emit to a root and never read a
  root's own enter/leave Map, and the binding drops any dispatch to a root before
  touching its EventTarget. A root's capture lookups still propagate enter/leave
  to the descendants that enter or leave with it, exactly as RN applies an
  entering/leaving ancestor's capture listener.

Surface selection does not change: an empty-area press or a first hover sample
still reaches no surface, so the game below receives it. RN would target the
root there, but nothing would reach JS, so only the hover path differs: the root
enters it once a sample is routed to the surface, through a view hit or because
the surface still owns the mouse's route.

## Why the probe is discriminating

The [driver](../../tests/pointer-root-path-probe.gd) moves a mouse and a touch
between A's target, A's empty area and a point outside every surface. The
[runner](../../tests/pointer-root-path-native.test.mjs) re-derives every step
from RN's rules:

- **Target listeners.** Moving into the empty area leaves only the views (out and
  leave on the target, no root lookup) and the processor keeps one hover path;
  only a point outside the root leaves the root, which reads its capture Map
  alone. The root also enters and leaves by itself around its empty area.
- **Document capture listeners.** Entering from outside delivers enter for the
  container, parent and target at phase 1, leaving to the outside delivers leave
  for target, parent and container, and moving between the target and the
  empty area delivers nothing. No Raw event is ever dispatched to the root.
- **Touch.** A drag into the empty area keeps the root, and the release leaves
  only the root without any callback.

The preceding host runs the same bundle in two parts. Its View case fails
exactly the 9 normative lookup and hover-path checks. Its Document case crashes
in the first step with the binding frame above, before any check runs.

## Remaining scope

Document hover across the flag matrix and documentElement listeners, surface
selection for empty-area input, pen hover, pointer capture while hovering,
responders, hardware, mobile exports and performance remain open.
