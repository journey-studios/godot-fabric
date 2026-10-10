# A React Native HUD over a Godot world: who gets the pointer

Status: executed isolated macOS validation against pinned RN 0.87.1 and official Godot
4.7.2, headless, plus a local windowed lane on the native renderer (the full-screen Surface
layout only), for the first two of three slices of the pointer spike (the 0.5 Frontier milestone's
V05-02, go/no-go no. 1). Slice 1 set the minimal policy (a1: the Surface lets the pointer through to the
world and the Views are the only Controls that stop it) and measured six gaps it leaves open. Slice 2, variant
a2, closes them with one rule: **the pointer reaches exactly one side, and what the hit test of React Native finds
at its point is the HUD's.** The probe drives a React Native HUD drawn over a Godot world in two topologies,
the overlays and the gaps in the full-screen one only. The host with a1 only fails exactly the 19 checks that need
a2, the host before a1 fails 41 (the 31 of slice 1 and 10 of a2), and five retained sabotages are rejected by the probe and by
an independent oracle. The [slice-1 evidence record](../evidence/world-input/README.md) pins that execution and has its
captures; the [slice-2 record](../evidence/world-input-a2/README.md) pins this one (implementation `0486727` on the red `9727ceb`) with its
captures, and the hosted CI run of both is pending. Real hardware pointers, a real touch screen and
mobile exports are not certified; see "Not certified". Slice 3 is the written decision on those numbers, with
nothing run again: **GO for the desktop (macOS)**, with the `iphone` criterion open; see
[Decision (slice 3)](#decision-slice-3).

## The question

A game's map is Godot's, and its HUD is React Native's, in one window. A click on the HUD's
empty area must reach the map exactly once. A click on a `Pressable` must press it once and
never reach the map. With an overlay open (a `View` in the React tree, or a `Modal`), no click
reaches the map. If that cannot be had without rewriting the pointer pipeline, the Frontier
milestone's "React Native HUD over a Godot game" premise is in doubt. The spike has a
time-box of three slices:

1. **This one:** the minimal policy (a1) and a probe that measures it, including what it
   leaves open.
2. **Variant (a2):** the rule that closes the gaps below, in `FabricSurface::_unhandled_input` and one new public method
   of `ApplicationRuntime` (`claims`). It waited for PR #58 (the ScrollView and pointer adapter work), and adds a stage
   instead of rewriting the existing ones, so it touches none of the hunks #58 changed. Delivered in this note.
3. **The decision:** go or no-go on the numbers of the two, made in [Decision (slice 3)](#decision-slice-3). It runs nothing.

## What Godot does with a pointer event

Godot 4.7.2 delivers an event to a `Viewport` in this order, and the comment at the first
call says it is not an accident: **`_input` of every node, then the GUI, then
`_unhandled_input`** (`scene/main/viewport.cpp`, `Viewport::push_input`, the comment at 3537 and the
GUI at 3542; `_push_unhandled_input_internal`, 3620-3633). `set_input_as_handled()` at any stage stops
the later ones.

The GUI hands a pointer event to the `Control` under it and up its ancestors
(`Viewport::_gui_call_input`, from 1740). A `Control` with `MOUSE_FILTER_STOP` marks the event
handled when it is a mouse, `ScreenDrag` or `ScreenTouch` event (1764-1766). A `MOUSE_FILTER_IGNORE`
`Control` is not offered the event (1757) and is skipped by the search for the Control under the point
(`_gui_find_control_at_pos`, 1871-1873). One exception is written in the STOP condition: a **wheel tick passes a STOP `Control`** when its `force_pass_scroll_events`
is true, and that is the default (`mouse_force_pass_scroll_events`, measured `true` on a `Control`
and on a `FabricSurface`). So a wheel reaches the map through a STOP Surface and through the HUD's
Views alike, unless something uses it.

Two more facts the probe relies on:

- `Viewport.gui_get_hovered_control()` is the `Control` the pointer is over
  (`viewport.cpp:3800`). A `Control` that is IGNORE is never it, so over the map it is `null`, and
  a game may use that to decide whether the pointer is on the map (to change the cursor, to show
  a tile's tooltip).
- `Input.parse_input_event` queues events when `use_accumulated_input` is on, and
  `Input.flush_buffered_events()` delivers all of them at once (`core/input/input.cpp`, 1549 and 1568).
  A burst of 100 clicks followed by one flush is therefore delivered on the spot and every count
  is exact without waiting for frames.

## What the host does

- `FabricSurface` implements `_input` (`native/fabric_surface.cpp`, `_input`): it hands the event
  to `ApplicationRuntime::input` and calls `set_input_as_handled()` only when the runtime
  returns true: for a wheel a `ScrollView` takes, and when a responder of React Native asked to block the
  native event (`blocks_native`). React Native therefore sees every pointer through `_input`, **whatever
  the Surface's `mouse_filter` is**: the filter only decides what the GUI does with the event afterwards. It also
  implements `_unhandled_input` (a2, below), which keeps from the world what the hit test of React Native owns.
- The Views React Native mounts are the Controls the GUI finds. `apply_pointer_filters`
  (`native/application_runtime.cpp`, `apply_pointer_filters`) gives a View `MOUSE_FILTER_IGNORE` when it is a
  scroll container, a text or paragraph, or has `pointerEvents` `none` or `box-none` (or sits under a
  `none` or `box-only` ancestor), and `MOUSE_FILTER_STOP` otherwise. The application's root
  is `pointerEvents="box-none"` (`src/render-application.jsx:20`), so the empty area of a root has no
  Control of its own.
- On a Pressable the Surface does not mark the event handled in `_input`. What keeps it from the map is the
  STOP Control of the View under it, in the GUI (a1), and, where no Control stops it, the Surface's claim in
  `_unhandled_input` (a2).
- The pointer adapter ignores events with device -1, the mouse Godot emulates from a touch and the
  touch it emulates from a mouse (`native/pointer_adapter.cpp:48-50`): RN sees a touch once, as
  `ScreenTouch`.

RN's own platforms behave the same way, which is the model this follows: iOS's `hitTest:withEvent:`
returns `nil` for a `box-none` view that no child takes (`RCTViewComponentView.mm:772-787`) and
Android's `TouchTargetHelper` does the same with `PointerEvents.BOX_NONE` (`TouchTargetHelper.kt:327-402`),
so what no view takes goes on to whatever is under the HUD.

## Before the policy: the red

A `FabricSurface` is a `Control`, and its `mouse_filter` was the default, STOP. The GUI therefore
found the Surface under every point of the HUD that no View covers and swallowed the event. The
probe, run on the host built from `main` before the policy (preserved with its SHA-256 beside the
report), measured with N = 100: the empty area, 0 of 100 left presses and releases, 0 of 100 right,
0 of 100 taps, no tile selected, and `gui_get_hovered_control()` the Surface; a Pressable pressed
100 times with 0 in the world; an overlay's positive control (the same click with the overlay closed)
0 of 100. The failing test is the slice's first commit, made before the policy.

The wheel was not in the red: with the Surface at STOP the wheel reaches the world 100 of 100,
because of `force_pass_scroll_events`. Its checks hold on both hosts and are plain checks, not
normative ones.

## The policy (a1)

`FabricSurface` takes **`MOUSE_FILTER_IGNORE` by default, set in its constructor**
(`native/fabric_surface.cpp`), in the pattern of `GodotAccessibleView::GodotAccessibleView()`
(`native/accessible_view.cpp:92-97`). The STOP comes only from the Views of the application. A
`.tscn` may still set the property on a Surface that should take the pointer (a full-screen scrim
that blocks the map, for example); the probe's sabotage restores STOP exactly that way.

What the policy needs from the project, and what the probe measured it with:

- The world is a `Node2D` **before** the HUD's `CanvasLayer` in the scene tree, as in
  [examples/world-input/scene.tscn](../../examples/world-input/scene.tscn), and hears events in
  `_unhandled_input`. The order of the opposite arrangement is not measured.
- The HUD's root View is `pointerEvents="box-none"`, as every application's root is.
- The Surface is anchored to the viewport in the `.tscn` (full rectangle, or the panel's own
  rectangle); a Surface with a `component_name` does not set its own anchors.

## The touch stream the world listens to

A tap that reaches an unhandled world arrives as two events: the `InputEventScreenTouch` and the
`InputEventMouseButton` that Godot emulates from it (device -1,
`input_devices/pointing/emulate_mouse_from_touch`, on by default; `core/input/input.cpp:908-926`). The
probe measured both, 100 of each press and release for 100 taps, on the empty area, and **neither**
on a Pressable or a plain panel: the STOP Control blocks the touch and its emulated mouse alike.

The world in this slice listens to the **mouse stream**, and counts but does not act on
`ScreenTouch`. One code path then serves a mouse and a finger, and a tap selects its tile once
(`examples/world-input/world.gd`). A game that needs multi-touch, a pinch to zoom the map, listens to
`InputEventScreenTouch` and `InputEventScreenDrag` and skips the mouse events whose `device` is
`InputEvent.DEVICE_ID_EMULATION`. It must keep `emulate_mouse_from_touch` as it is for the first
choice, because a project that turns it off leaves the mouse listener deaf to touch.

## Topologies

Both topologies are measured with the same independent oracle
([tests/world-input-oracle.mjs](../../tests/world-input-oracle.mjs)), which re-derives from the
geometry of the HUD and the rules above what the world and the HUD's handlers must have heard in
every burst, and compares it with the report. The counts below are the
[probe](../../tests/world-input-probe.gd)'s, with the policy applied, in an 800x600 root with the
Camera2D at (384, 256), zoom 2. A "burst" is N repetitions delivered by one flush; "world" is what
`_unhandled_input` heard; the HUD's handlers count in a global of the
[fixture](../../tests/world-input-fixture.jsx), not in the host's pointer counters, because the HUD
receives events aimed at its root in the empty area.

**(a) one full-screen Surface, N = 100:**

| Burst | World hears | HUD handlers hear |
| --- | --- | --- |
| empty area, left click | 100 press, 100 release; tile (16, 11) selected 100 times | 0 |
| empty area, right click | 100 press, 100 release of button 2; no tile | 0 |
| empty area, wheel | 100 press, 100 release of the wheel button | 0 |
| empty area, tap | 100 `ScreenTouch` and 100 emulated left (each press and release); tile (16, 11) | 0 |
| empty area, other two points | tiles (15, 7) and (12, 11), one click each | 0 |
| Pressable, left click | 0 | `onPress` 100, bar's `pointerdown` 100 |
| Pressable, tap | 0 mouse (emulated), 0 `ScreenTouch` | `onPress` 100 |
| bar with a handler | 0 | handler 100 |
| plain panel, no handler (click, tap) | 0 | 0 |
| ScrollView's Pressable | 0 | `onPress` 100 |
| alternating Pressable and empty area | 100 press, 100 release (the empty-area clicks) | `onPress` 100 |

The tile is the one the camera gives: `floor(((x - 400) / 2 + 384) / 32)` and the same for y, computed
by the oracle apart from Godot's transforms. `gui_get_hovered_control()` is `null` over the map and the
Pressable's own Control over the HUD.

**Overlays**, in the same topology, 100 per cell, at an empty point: 100 of 100 when the overlay is
closed, 0 of 100 when it is open, 100 of 100 again when it is closed again; the overlay's own
Pressable is pressed 100 times with 0 in the world. The tree overlay (a full-screen `View`) holds for
the left click, the right click and the tap under a1, and for the wheel too under a2 (the Surface claims it: L6). The **`Modal`**,
a host window that is exclusive, holds for the four inputs, wheel included, on every host. The numbers in this section
are slice 1's, taken with a1; the a2 host gives the same ones.

**(b) two Surfaces, one per panel (left half and right half), N = 20:** the empty area of each
panel gives the world 20 of 20 for the left click, the right click, the wheel and the tap, with 0 to the
HUD, and the tile of each panel is the camera's ((8, 9) and (15, 9)); each panel's Pressable is pressed 20
times by click and by tap with 0 in the world, the bar's handler hears 20 and the world 0; alternating the
left panel's Pressable and the right panel's empty area gives 20 and 20; and the hover is `null` over the
map and a HUD control over each panel's Pressable. Two Surfaces behave as one.

## The gaps of a1

The Surface no longer swallows the pointer, so under a1 the **only** blockers are the Views' own Controls. Where
a React Native control reacts to a pointer that no Control stops, **both** sides heard it. Slice 1's probe recorded
these as informative rows, never as checks (N = 20 then; slice 2 measures them at N = 100, below):

| Case | World hears | RN hears |
| --- | --- | --- |
| L1: a Pressable's `hitSlop`, in the slop around the button | press and release | `onPress` |
| L2: a `Text` with `onPress` (Text is IGNORE) | press and release | `onPress` |
| L3: a gap of a ScrollView in a `box-none` wrapper (the container is IGNORE, the content is `box-none`) | press and release | the wrapper's `pointerdown` |
| L4: the wheel over a HUD region without a ScrollView | press and release | no handler (RN has none for a wheel) |
| L5: the wheel over a ScrollView | the release only (the ScrollView takes the press) | scrolls |
| L6: the wheel over a tree overlay | press and release | no handler |

The click cases are one cause: the hit test that decides which View owns a point for React Native
(`ApplicationRuntime`'s `hit_test`, which honors `pointerEvents`, `hitSlop` with its clamp to the parent, clipping and
visibility) is not the GUI's search for a Control, and the Control that stands for a View can be smaller than what RN hits (a slop) or
absent (IGNORE). The wheel is separate: the GUI passes it through any STOP Control (`force_pass_scroll_events`),
so a wheel over the HUD's panels or an overlay reaches the world whatever the policy is.

## The rule (a2)

At the unhandled stage, after the GUI, **the Surface marks a pointer event as handled when React Native's hit
test finds a View of that Surface at the event's point** (a tag other than 0). The events it covers are the
`InputEventMouseButton`, wheel and wheel release included, the `InputEventScreenTouch`, and the mouse Godot emulates from a
touch (device -1, which React Native ignores and the world hears). The empty area stays the world's, because the root is
`pointerEvents="box-none"` and its hit test gives 0. `InputEventMouseMotion` and `InputEventScreenDrag` are outside the rule
and stay as they were: see "What a2 leaves open".

- **Where:** `FabricSurface::_unhandled_input` (`native/fabric_surface.cpp`) calls the new public
  `ApplicationRuntime::claims(surface_id, event)` (`native/application_runtime.{h,cpp}`) and calls
  `set_input_as_handled()` when it returns true. `claims` does not route anything to JavaScript. It applies the guards of `input()` (a root that
  is stopping or stopped, a `validation_input_device` that is not the event's, a non-finite point, a suppressed mouse route), runs
  `physical_hit_test` for that Surface at the event's point, and answers whether the tag is not 0. `hit_test`,
  `apply_pointer_filters`, `input()` and `wheel()` are unchanged: a2 adds a stage and rewrites no existing one.
- **The Controls of the GUI are untouched.** The rule runs after the GUI, so a `Button`, `LineEdit` or `Switch` that React
  Native mounts, which live on `_gui_input`, were offered the event first and, being STOP Controls, marked it handled themselves.
  A claim that ran before the GUI would take their clicks away (the `before-gui` sabotage does exactly that, and the probe's
  Switch proves it).
- **`_unhandled_input` enables itself.** The GDExtension override is detected as the existing `_input` is, and
  `Node::NOTIFICATION_READY` turns the processing on (`scene/main/node.cpp:264-266`, `GDVIRTUAL_IS_OVERRIDDEN(_unhandled_input)`
  calls `set_process_unhandled_input(true)`); the constructor adds nothing. The probe confirms it: with the host that has the
  override the six gaps close, and the `unhandled-off` sabotage (`set_process_unhandled_input(false)` on the Surfaces) brings them back.

### Why the hit test and not the handler

React Native on a phone decides who keeps a touch by geometry, `pointerEvents` and `hitSlop`, **never by whether a
handler exists**. iOS: `pointInside:withEvent:` takes the `hitSlop` as edge insets
(`RCTViewComponentView.mm:114-124`, set from the prop at 362-368) and `hitTest:withEvent:` answers by `pointerEvents` (772-785).
Android: `TouchTargetHelper.isTouchPointInView` honors `ReactHitSlopView.hitSlopRect` (`TouchTargetHelper.kt:252-270`) and
`findTouchTargetViewWithPointerEvents` handles `AUTO`, `NONE`, `BOX_ONLY` and `BOX_NONE` (327-402). A `Text` is a touch target whether or not it has an
`onPress` (it is a `ReactCompoundView`). A rule that kept the pointer from the world only where a handler is registered would give the world the
click on a plain panel, on a `Text` without `onPress` and on a View a game uses as a scrim, and would let a handler registered later change who
hears an earlier click. The hit test gives the answer the phone gives: what RN hits is RN's, the rest is the world's.

## Where the claim runs: the order of the unhandled stage

The Surface can claim first only if Godot calls its `_unhandled_input` **before** the world's. It does, by tree order, and the
probe checks it on the live scene. From the Godot 4.7.2 source (tag `4.7.2-stable`):

- `Viewport::push_input` (`scene/main/viewport.cpp:3489-3553`) runs `_input`, then the GUI, then the unhandled stage
  (the comment at 3537 says the order is not an accident), each only `if (!is_input_handled())`
  (3535, 3540, 3548). `_push_unhandled_input_internal` (3620-3634) calls the `_vp_unhandled_input` group at 3631-3633.
- `SceneTree::_call_input_pause` (`scene/main/scene_tree.cpp:1430-1502`) walks that group **in reverse tree order**:
  `for (int i = gr_node_count - 1; i >= 0; i--)` at 1461, so the node last in the tree is called first. It stops as soon as the
  viewport reports the event handled (1462-1464); `CALL_INPUT_TYPE_UNHANDLED_INPUT` is the case at 1495-1497.
- The group is ordered by `_update_group_order` (340-355, `Node::Comparator`, tree order, `scene/main/node.h:136`).
- A node enters the group when it overrides `_unhandled_input` (`scene/main/node.cpp:264-266` on ready; 177-179 and 1300-1311 for the group).

So a `CanvasLayer` HUD **after** the world in the scene tree, as in [scene.tscn](../../examples/world-input/scene.tscn), has its Surface called
first and can keep the event from the world. The order is not guaranteed for the opposite arrangement (a HUD before the world), which is
not measured and not supported by a2.

The probe asserts it rather than trusting the source: a witness node
([tests/world-input-order-witness.gd](../../tests/world-input-order-witness.gd)) stands in the HUD's `CanvasLayer`, where the Surface stands, and records
how many events the world had heard each time it heard a mouse button event. The oracle derives that the world had not heard that event yet:
the witness's list equals the indices of the button events in the world's list (`heard [1, 2]`, `worldIndices [1, 2]` in both topologies). The wheel is
the event used because every host lets it through to the unhandled stage, so the check holds on all of them.

## The gaps closed (a1 to a2)

The slice's probe turns the six gaps into normative checks (the world hears 0; React Native hears n where a handler exists), at N = 100
in the full-screen topology (N = 20 in the two-panel one). Counts of the **host with a1 only** (the control, `build/world-input-a1-host/`) and
of the host with a2, which are the same on the React Native side:

| Gap | Aimed at | World, a1 | World, a2 | RN hears |
| --- | --- | --- | --- | --- |
| L1 hit slop | click, tap, emulated mouse | 100 press + 100 release; 100 touch + 100 emulated; 100 emulated | 0, 0, 0 | `slopPress` 100, 100, none |
| L2 `Text` `onPress` | click, tap, emulated mouse | the same shapes | 0, 0, 0 | `textPress` 100, 100, none |
| L3 ScrollView gap | click, tap, emulated mouse | the same shapes | 0, 0, 0 | `wrapDown` 100, 100, none |
| L4 wheel over the HUD | a bar, a plain panel, a Pressable, the slop, a `Text`, a ScrollView gap | 100 press + 100 release (the gap: release only, a ScrollView takes the press) | 0 | nothing |
| L5 wheel over a ScrollView | its content | 100 release (the press is taken) | 0 | scrolls |
| L6 wheel over the tree overlay, open | the overlay | 100 press + 100 release | 0 | nothing |
| the bar of each panel in the two-panel topology | wheel, N = 20 | 20 press + 20 release | 0 | nothing |

The emulated mouse is also aimed on its own (a left press and release with device -1, without a touch): React Native never hears it and a2 claims it
in the places above. The `Switch` the fixture adds (a native Control of the GUI) is toggled 100 times by 100 clicks and by 100 taps with 0 in the world on
every host: the GUI had it first.

The oracle derives these values from the geometry of the HUD (the slop zone `[480,80,100,80]` of a 60x40 Pressable with `hitSlop` 20 at (500,100), the `Text`
`[500,200,80,30]`, the wrapper `[400,300,300,150]`, the `Switch`) and the rule above: every region the HUD paints is React Native's whatever the input, its
handlers hear a click or a tap and never a wheel tick or the emulated mouse, only the empty area is the world's. A synthetic report of the a2 behavior is accepted, and
one with a leaked press, a lost `Text` tap or a wrong witness order is rejected, each with its own message.

## What a2 leaves open

- **Motion and drag.** `InputEventMouseMotion` and `InputEventScreenDrag` are outside the rule. Over a View whose Control stops the pointer (the bar) the GUI keeps both
  from the world (0 and 0 at N = 20); over a place the GUI lets through (the hit slop) the world still hears the motion (20) and the drag that starts
  there: the touch and its emulated mouse are claimed (0), the 20 drags and the 20 emulated motions reach the world, with `slopPress` 20 for RN. A world that acts on
  drags (a pan of the map) would see a drag with no press. Recorded as informative rows, never checks.
- **Hover.** A game that reads `gui_get_hovered_control()` or the pointer motion still sees the map under a hit slop or a `Text`: the GUI has no Control there.
- **A release away from its press.** The claim follows the point of each event. A press on a View and a release over the empty area, with no Control holding the
  focus, gives the world a release it never saw the press of. A STOP Control keeps that pair together through the GUI; the gaps do not have one.
- **A HUD before the world in the tree**, a HUD of several layers, another `Camera2D`, several windows: not measured.
- **Hardware**, a real touch screen, multi-touch and mobile exports: see "Not certified".

## Decision (slice 3)

**GO** for the premise "a React Native HUD over a Godot world, in one window", on the desktop (macOS arm64, official
Godot 4.7.2, RN 0.87.1), with the policy of a1 plus the rule of a2. On the numbers below the pointer reaches exactly one
side by the rule of a phone: a click on the HUD's empty area reaches the map once, a click on a `Pressable` presses it once
and never reaches the map, and with an overlay or a `Modal` open nothing does. It took no rewrite of the pointer pipeline:
a constructor default (a1), one public method (`ApplicationRuntime::claims`) and one override
(`FabricSurface::_unhandled_input`) (a2), with `hit_test`, `apply_pointer_filters`, `input()` and `wheel()` unchanged.

The decision runs nothing and adds no evidence: it reads the [slice-1][e1-probe] and [slice-2][e2-probe] records, pinned to
the commits that merged them, and their receipts ([1][e1-receipt], [2][e2-receipt]). Every number is local evidence on macOS arm64
with synthetic events; the hosted CI run of both slices is still pending. The GO covers the arrangement that was measured (a
`CanvasLayer` after the world, a `Camera2D` at zoom 2, one full-screen Surface or one per panel); the arrangements in "Not
certified" are outside it. The time-box of three slices was kept. The roadmap's go/no-go paragraph returns the
game-driven-hud decision to the user when V05-02 fails; the desktop proof did not fail, so nothing returns on that account.
**The `iphone` criterion stays open** and this GO says nothing about a phone.

### Criteria against the numbers

| Criterion | Number | Evidence |
| --- | --- | --- |
| The empty area reaches the world once | One full-screen Surface, N = 100: left click 100 press and 100 release with tile (16, 11) selected 100 times; right click 100 and 100 of button 2; wheel 100 and 100; tap 100 `ScreenTouch` and 100 emulated mouse; two more points one click each; the HUD's handlers 0. Two Surfaces, N = 20: 20 of 20 per panel for the four inputs, 0 to the HUD | [slice 1][e1-probe], [slice 2][e2-probe] (91 of 91 on the a2 host) |
| A `Pressable` acts once and never reaches the world | 100 clicks: `onPress` 100, the bar's `pointerdown` 100, world 0. 100 taps: `onPress` 100, world 0 (no mouse, no `ScreenTouch`). A bar with a handler 100 and 0; a plain panel 0 and 0; the ScrollView's `Pressable` 100 and 0; a `Pressable` alternating with the empty area: `onPress` 100 and, in the world, 100 press and 100 release (the empty-area clicks) | [slice 1][e1-probe] |
| Nothing passes with an overlay or a `Modal` open | Full-screen Surface, 100 per cell at an empty point: closed 100 of 100, open 0 of 100, closed again 100 of 100; the overlay's own `Pressable` pressed 100 times with 0 in the world. The tree overlay holds for the left click, the right click, the tap and, with a2, the wheel (L6: 100 press and 100 release before, 0 after); the `Modal` holds for the four inputs on every host. The overlays are measured in the full-screen topology only | [slice 1][e1-probe], [slice 2][e2-lacunas] |
| The six gaps of a1 are closed by a2 | L1 hit slop, L2 `Text` `onPress`, L3 ScrollView gap, by click, tap and emulated mouse, N = 100: with a1 the world heard 100 press and 100 release for the click, 100 touch and 100 emulated for the tap and 100 emulated for the emulated mouse; with a2 it hears 0 of each, while RN hears `slopPress`, `textPress`, `wrapDown` 100 times for the click and the tap (never the emulated mouse). Wheel over the HUD (L4), a ScrollView (L5) and the open tree overlay (L6): 100 press and 100 release before (the release only over a ScrollView), 0 after; 20 of 20 before and 0 after on the bar of each panel. Windowed lane: 700 rounds over the gap places select no tile and the frame is byte for byte the untouched one | [slice 2][e2-lacunas], [windowed lane][e2-janela] |
| Godot's native GUI Controls are intact | A `Switch` is toggled 100 times by 100 clicks and 100 times by 100 taps with 0 in the world, on every host. The `before-gui` sabotage, a claim made ahead of the GUI, fails exactly those two checks | [slice 2][e2-lacunas], [sabotages][e2-sab] |
| The order of the unhandled stage matches Godot 4.7.2 | Tag `4.7.2-stable`: `viewport.cpp` 3489-3553 and 3620-3634, `scene_tree.cpp` 1430-1502 (the loop at 1461 walks the group in reverse tree order), `node.cpp` 264-266. On the live scene a witness in the HUD's layer heard `[1, 2]`, equal to the world's `[1, 2]`, in both topologies: the Surface is called before the world | [slice 2][e2-ordem] |
| The controls with the preceding hosts | Host with a1 only (`28cc9f14`): 72 of 91, fails exactly the 19 checks of a2, and the oracle rejects it. Host before a1 (`8bb87738`, rebuilt): 50 of 91, fails 41 (the 31 of slice 1 and 10 wheel checks). Slice 1's original host (`79f68b1d`): 35 of 66, fails the 31. Host a2 (`cc8aa3c5`): 91 of 91 | [slice 2][e2-controles], [slice 1][e1-falhas] |
| The sabotages | Slice 1: `surface-stop` (31 fail) and `views-ignore` (21). Slice 2: `surface-stop` (31), `views-ignore` (5: the `Switch` and the hover, since the claim now hides the Views from the world), `unhandled-off` (19, the gaps return), `claim-all` (35, the empty area stops reaching the world) and `before-gui` (2). Each is rejected on named checks and by the independent oracle, and the sources and hosts come back byte for byte | [slice 1][e1-sab], [slice 2][e2-sab] |
| A real macOS window | Native renderer `gl_compatibility`, N = 100: 18 of 18 checks in slice 1 and 32 of 32 in slice 2, with captures. Slice 2's frames ran unpaced (the display was asleep): its counts stand and it claims no frame time | [slice 1][e1-grafica], [slice 2][e2-janela] |

### What does not block the GO

- **Motion, hover and drag over the HUD.** They are outside the rule on purpose ("What a2 leaves open"): a View whose
  Control stops the pointer keeps motion and drag from the world (0 of 20), and over a hit slop the world still hears 20 of 20
  motions and the 20 drags and 20 emulated motions of a drag that starts there (its touch and emulated mouse are claimed). The
  premise (the empty area once, a `Pressable` once, overlays closed) does not need them, and the roadmap freezes the tail of
  pointer work (new `pointer-*`, EventTarget, Document or hover slices) for the 0.5. Owner: the world, in Godot; what the map
  does with hover is outside this spike.
- **A release away from its press.** The claim follows the point of each event, so a press on a View and a release over the empty
  area, with no Control holding the focus, gives the world a release it never saw the press of. Owner: the author of a world
  that pairs the two. The evidence records the case and measures no count for it.
- **A HUD before the world in the tree.** It is not supported and not measured: the Surface is called first when the HUD's
  layer comes after the world, and the opposite order is not guaranteed. This is a rule of the scene (below), not a gap in the policy. Owner: whoever composes the scene.
- **A windowed lane without a pace.** Slice 2's lane ran with the display asleep. The counts are exact on bursts delivered by one
  flush and do not depend on the pace, and the lane claims neither frame time nor presentation. Frame time belongs to the
  frame-budget item (V05-06 in the roadmap table), not to this decision.

### What stays open and depends on the user

The `iphone` criterion of V05-02 (package P7, which feeds the device gate V05-09): the same proof with a real touch on an iPhone,
including dragging the map with one finger while another finger is on a HUD button. Nothing here runs on a phone. The events are
synthetic, delivered through `Input.parse_input_event`, with no hardware pointer, no touch screen, no second finger and no mobile
export, and the world listens to the mouse stream (see "The touch stream the world listens to"). It needs the user's device. The roadmap
already says what a phone no-go does: it closes the 0.5 as macOS-complete and hands mobile back to GF-35, without moving any 1.0
number. This GO does not pre-empt it.

### Rules for a scene

What the Surface does is stated once, in the `mouse_filter` row of the Surface table in
[docs/API.md](../API.md#shared-application-and-root-authoring), and is not repeated here. These are the rules a scene keeps for it to hold:

- The HUD's `CanvasLayer` comes after the world in the scene tree, as in [scene.tscn](../../examples/world-input/scene.tscn). Godot calls
  `_unhandled_input` in reverse tree order, so the Surface is called before the world when its layer comes after it ("Where the claim
  runs"); the opposite arrangement is not measured and not supported.
- The root is `pointerEvents="box-none"` (the application's root already is: `src/render-application.jsx:20`), and so is every
  container that covers the map, the HUD component's outermost View included. React Native's hit test gives a View it hits its whole
  rectangle, whatever its handlers, and the tree overlay, a full-screen View, is exactly that case: it closes the map.
- The world listens in `_unhandled_input`. `_input` runs before the GUI and before the claim, so a world listening there hears the HUD's
  clicks too.
- The Controls of Godot's GUI that React Native mounts (`Button`, `LineEdit`, `Switch`) keep working: they take their events in the GUI,
  ahead of the claim, and need no scene rule.

The Surface is also anchored to the viewport in the `.tscn`, and the world listens to the mouse stream: see "What the policy needs
from the project" and "The touch stream the world listens to".

[e1-probe]: https://github.com/journey-studios/godot-fabric/blob/7ef63ed64a8994846dc29e1a4fff52134ded8469/docs/evidence/world-input/README.md#o-que-o-probe-prova
[e1-receipt]: https://github.com/journey-studios/godot-fabric/blob/7ef63ed64a8994846dc29e1a4fff52134ded8469/docs/evidence/world-input/execution.json
[e1-falhas]: https://github.com/journey-studios/godot-fabric/blob/7ef63ed64a8994846dc29e1a4fff52134ded8469/docs/evidence/world-input/README.md#as-31-falhas-normativas-do-host-anterior
[e1-sab]: https://github.com/journey-studios/godot-fabric/blob/7ef63ed64a8994846dc29e1a4fff52134ded8469/docs/evidence/world-input/README.md#sabotagens-retidas
[e1-grafica]: https://github.com/journey-studios/godot-fabric/blob/7ef63ed64a8994846dc29e1a4fff52134ded8469/docs/evidence/world-input/README.md#faixa-gr%C3%A1fica
[e2-probe]: https://github.com/journey-studios/godot-fabric/blob/2a3f4b0df7ff2267a0ab5a8e7b43aa8de40c4a0f/docs/evidence/world-input-a2/README.md#o-que-o-probe-prova
[e2-receipt]: https://github.com/journey-studios/godot-fabric/blob/2a3f4b0df7ff2267a0ab5a8e7b43aa8de40c4a0f/docs/evidence/world-input-a2/execution.json
[e2-lacunas]: https://github.com/journey-studios/godot-fabric/blob/2a3f4b0df7ff2267a0ab5a8e7b43aa8de40c4a0f/docs/evidence/world-input-a2/README.md#as-lacunas-da-a1-para-a-a2
[e2-ordem]: https://github.com/journey-studios/godot-fabric/blob/2a3f4b0df7ff2267a0ab5a8e7b43aa8de40c4a0f/docs/evidence/world-input-a2/README.md#a-ordem-do-unhandled
[e2-controles]: https://github.com/journey-studios/godot-fabric/blob/2a3f4b0df7ff2267a0ab5a8e7b43aa8de40c4a0f/docs/evidence/world-input-a2/README.md#controles
[e2-sab]: https://github.com/journey-studios/godot-fabric/blob/2a3f4b0df7ff2267a0ab5a8e7b43aa8de40c4a0f/docs/evidence/world-input-a2/README.md#sabotagens-retidas
[e2-janela]: https://github.com/journey-studios/godot-fabric/blob/2a3f4b0df7ff2267a0ab5a8e7b43aa8de40c4a0f/docs/evidence/world-input-a2/README.md#faixa-janelada

## Controls and sabotages

Every control runs the same bundle, probe and oracle; the scene-level ones change nothing in the host, and the two source ones rebuild it
(`node scripts/world-input-sabotage.mjs`). The script deletes each variant's result file before running it and counts a missing file as not rejected;
the sources and the host come back byte for byte (SHA-256 checked, and the host rebuilt from the restored sources compared with the genuine one).

- **The host with a1 only** (`build/world-input-a1-host/`, SHA-256 `28cc9f14d34b0ec1b7e5038f52551a1175ed20010cf4ceceedbef246c0479fc6`, kept outside Git) is main at `c8de44b`.
  It fails **exactly the 19 normative checks of a2** (91 in all): the nine clicks, taps and emulated mouse of L1-L3, the seven wheel bursts of L4 and L5, the wheel over the open tree
  overlay (L6) and the wheel over the bar of each panel. The oracle rejects its report.
- **The host before a1** (`build/world-input-previous-host/`, SHA-256 `8bb877385c7c1b73c282ddca2f7bbb12331b5baa271021bb2865465ebc195076`, kept outside Git) fails **41**:
  the 31 of slice 1 (the Surface's default filter, the empty area, the camera, the alternating run, the hover, the overlay positive controls, the same for the two panels) and 10 of a2, the wheel
  checks, which its STOP Surface cannot hide. The nine clicks, taps and emulated mouse of L1-L3 hold there, because the STOP Surface hides them from the world. **This host was rebuilt for
  slice 2**: the original (`79f68b1d141146e04d1904d6d54c38f1a7ffc3929a5db15dea0bf47a5f7bef73`, from main `41fbe22`) was kept in a worktree that no longer exists, so the control is
  main `c8de44b` with only the constructor's `set_mouse_filter(MOUSE_FILTER_IGNORE)` removed, which is the same difference the original had. Its 31 are the 31 of slice 1.
- **`surface-stop`** (the scene gives every Surface STOP): 31 checks fail, the oracle rejects the report on the Surface's filter.
- **`views-ignore`** (the scene gives every Control of the Views IGNORE): 5 fail. Before a2 it let a Pressable, a bar and a panel through to the world (21 checks); with the claim the hit test still finds
  them, so the world no longer hears them, and what the sabotage still breaks is what lives on the GUI: the `Switch` never toggles (click and tap) and the hover is lost (three checks).
- **`unhandled-off`** (the scene keeps the Surfaces from receiving `_unhandled_input`): the gaps are back, 19 checks fail, the same set as the host with a1 only.
- **`claim-all`** (`fabric_surface.cpp` claims every event in the unhandled stage, with or without a View): the empty area no longer reaches the world, 35 checks fail.
- **`before-gui`** (`fabric_surface.cpp` also claims in `_input`, before the GUI): the `Switch` never gets a click or a tap, the two checks that prove it fail, and the oracle rejects the report.

## Not certified

- Hardware pointers, a real touch screen, multi-touch (a second finger), real drags and keyboard or gamepad focus.
  The events are synthetic, delivered through `Input.parse_input_event`.
- Godot's mobile exports and any platform other than macOS arm64; renderers other than the
  Compatibility one the windowed lane ran on.
- A `CanvasLayer` before the world in the tree, a HUD of several layers, a `Camera2D` other than zoom 2 at
  (384, 256), several windows.
- Pointer motion, hover and drag (the open cases above).
- Real frame pacing: the headless probe counts exactly, so it says nothing about latency. The windowed lane reads V-Sync back and
  classifies its frames as paced or unpaced; with the display asleep they run unpaced, and the lane says so instead of calling them presented.

## How to run

```sh
npm run test:world-input                  # the headless probe and the oracle (the CI step)
node scripts/world-input-sabotage.mjs     # the five sabotages and the a1 and previous-host controls (local, rebuilds the host twice)
node scripts/world-input-graphics.mjs     # the windowed lane and its captures (local)
```

The sabotage script needs the two preserved hosts under `build/` (`world-input-a1-host/` and `world-input-previous-host/`).

The windowed lane runs the scene of topology (a), the full-screen Surface, on the native renderer with a real display server (macOS, with the
Compatibility renderer); topology (b) is not run in a window. It repeats the counts of topology (a) with N = 100 and the six gaps of a2
(a click, a tap and the emulated mouse in the slop, on the `Text` and in the ScrollView gap, and the wheel over the HUD, a ScrollView and the open tree overlay),
checks that the frame shows the HUD over the map, that the tile the empty-area clicks selected is painted and that 100 rounds over every gap
place select no tile, reads the V-Sync mode and the refresh rate back from the display server and times 90 idle frames. When the idle median
is far below the refresh period (or V-Sync is not on) the frames are recorded as `unpaced`: the counts are exact on bursts and do not
depend on it, and the lane does not present those frames as presented. It saves five captures under `build/world-input-graphics/`: the map with the HUD, the selected tile, the map after
the gap rounds (no tile highlighted), and the two overlays open.
