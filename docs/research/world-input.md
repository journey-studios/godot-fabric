# A React Native HUD over a Godot world: who gets the pointer

Status: executed isolated macOS validation against pinned RN 0.87.1 and official Godot
4.7.2, headless, plus a local windowed lane on the native renderer, for the first of three
slices of the pointer spike (the 0.5 Frontier milestone's V05-02, go/no-go no. 1). The probe
drives a React Native HUD drawn over a Godot world in two topologies; the host that predates
the policy fails exactly the 31 checks that need it; two retained sabotages are rejected by
the probe and by an independent oracle. The evidence record and the hosted CI run are
pending. Real hardware pointers, a real touch screen and mobile exports are not certified;
see "Not certified".

## The question

A game's map is Godot's, and its HUD is React Native's, in one window. A click on the HUD's
empty area must reach the map exactly once. A click on a `Pressable` must press it once and
never reach the map. With an overlay open (a `View` in the React tree, or a `Modal`), no click
reaches the map. If that cannot be had without rewriting the pointer pipeline, the Frontier
milestone's "React Native HUD over a Godot game" premise is in doubt. The spike has a
time-box of three slices:

1. **This one:** the minimal policy (a1) and a probe that measures it, including what it
   leaves open.
2. **The next:** variant (a2) for the open cases below, after PR #58 (the ScrollView and
   pointer adapter work) merges, because it touches the same hunks of
   `native/application_runtime.cpp`.
3. **The decision:** go or no-go on the numbers of the two.

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
  the Surface's `mouse_filter` is**: the filter only decides what the GUI does with the event afterwards.
- The Views React Native mounts are the Controls the GUI finds. `apply_pointer_filters`
  (`native/application_runtime.cpp:1685-1703`) gives a View `MOUSE_FILTER_IGNORE` when it is a
  scroll container, a text or paragraph, or has `pointerEvents` `none` or `box-none` (or sits under a
  `none` or `box-only` ancestor), and `MOUSE_FILTER_STOP` otherwise. The application's root
  is `pointerEvents="box-none"` (`src/render-application.jsx:20`), so the empty area of a root has no
  Control of its own.
- On a Pressable the Surface does not mark the event handled. What keeps it from the map is the
  STOP Control of the View under it, in the GUI.
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
the left click, the right click and the tap. The **`Modal`**, a host window that is exclusive, holds for
the four inputs, wheel included.

**(b) two Surfaces, one per panel (left half and right half), N = 20:** the empty area of each
panel gives the world 20 of 20 for the left click, the right click, the wheel and the tap, with 0 to the
HUD, and the tile of each panel is the camera's ((8, 9) and (15, 9)); each panel's Pressable is pressed 20
times by click and by tap with 0 in the world, the bar's handler hears 20 and the world 0; alternating the
left panel's Pressable and the right panel's empty area gives 20 and 20; and the hover is `null` over the
map and a HUD control over each panel's Pressable. Two Surfaces behave as one.

## What the minimal policy leaves open

The Surface no longer swallows the pointer, so the **only** blockers are the Views' own Controls. Where
a React Native control reacts to a pointer that no Control stops, **both** hear it. The probe records
these as informative rows, never as checks, with N = 20 and the policy applied:

| Case | World hears | RN hears |
| --- | --- | --- |
| a Pressable's `hitSlop`, in the slop around the button | 20 press, 20 release | `onPress` 20 |
| a `Text` with `onPress` (Text is IGNORE) | 20 press, 20 release | `onPress` 20 |
| a gap of a ScrollView in a `box-none` wrapper (the container is IGNORE, the content is `box-none`) | 20 press, 20 release | the wrapper's `pointerdown` 20 |
| the wheel over a HUD region without a ScrollView | 20 press, 20 release | no handler (RN has none for a wheel) |
| the wheel over a ScrollView | 20 release; **the press is taken** by the ScrollView | scrolls |
| the wheel over a tree overlay | 20 press, 20 release | no handler |

The click cases are one cause: the hit test that decides which View owns a point for React Native
(`ApplicationRuntime`'s `hit_test`, `native/application_runtime.cpp:1708`, which honors `pointerEvents` and
`hitSlop`) is not the GUI's search for a Control, and the Control that stands for a View can be smaller than
what RN hits (a slop) or absent (IGNORE). The wheel is separate: the GUI passes it through
any STOP Control (`force_pass_scroll_events`), so a wheel over the HUD's panels or an overlay reaches the
map whatever the policy is. Variant (a2) would close the click cases with an `_unhandled_input` in the
Surface that marks the event handled when that hit test finds a View, which needs a new
public method in `ApplicationRuntime` and the HUD's `CanvasLayer` to come after the world. That is the second
slice. The wheel needs a decision of its own: a HUD that must not let the wheel through sets
`mouse_force_pass_scroll_events` to false on the Views' Controls, or the Surface takes the wheel in `_input`.

## Controls and sabotages

The same bundle, probe and oracle run on each; none changes a source, so no host is rebuilt
(`node scripts/world-input-sabotage.mjs`).

- **The previous host** (`build/world-input-previous-host/`, SHA-256
  `79f68b1d141146e04d1904d6d54c38f1a7ffc3929a5db15dea0bf47a5f7bef73`, kept outside Git) fails exactly
  the 31 normative checks: the Surface's default filter, the empty area (left click, right click, tap),
  the camera, the alternating run, the hover, the overlay positive controls (tree and Modal, three
  inputs, before and after), and the same for the two panels of (b). Everything else, the Pressable,
  the bars, the panels, the overlays opened, the wheel, holds there. The oracle rejects its report.
- **`surface-stop`**: the probe forces `mouse_filter = STOP` on every Surface. The empty area falls to 0
  of 100 again; 31 checks fail and the oracle rejects the report on the Surface's filter.
- **`views-ignore`**: the probe gives every Control of the Views `MOUSE_FILTER_IGNORE`. A Pressable, a bar
  and a panel let the pointer through and the world hears what React Native also takes; 21 checks fail and
  the oracle rejects the report on the first Pressable burst.

## Not certified

- Hardware pointers, a real touch screen, multi-touch (a second finger), drags and keyboard or gamepad focus.
  The events are synthetic, delivered through `Input.parse_input_event`.
- Godot's mobile exports and any platform other than macOS arm64; renderers other than the
  Compatibility one the windowed lane ran on.
- A `CanvasLayer` before the world in the tree, a HUD of several layers, a `Camera2D` other than zoom 2 at
  (384, 256), several windows.
- The open cases above (variant a2) and a deliberate treatment of the wheel.
- Real frame pacing: the headless probe counts exactly, so it says nothing about latency.

## How to run

```sh
npm run test:world-input                  # the headless probe and the oracle (the CI step)
node scripts/world-input-sabotage.mjs     # the two sabotages and the previous-host control (local)
node scripts/world-input-graphics.mjs     # the windowed lane and its captures (local)
```

The windowed lane runs the same scene on the native renderer with a real display server (macOS, with the
Compatibility renderer), repeats the counts of topology (a) with N = 100, checks that the frame shows the HUD over the map
and saves four captures under `build/world-input-graphics/`: the map with the HUD, the selected tile and the
two overlays open.
