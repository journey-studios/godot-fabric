# A React Native HUD over a Godot map

A Godot world (a `Node2D` with a 24x16 map of 32-pixel tiles, seen through a `Camera2D` at zoom 2) with a
React Native HUD drawn over it in a `CanvasLayer`. The question this answers is who gets a pointer: a click on
the HUD's empty area must reach the map exactly once, a click on a `Pressable` must press it once and never
reach the map, and with an overlay open (a `View` in the React tree, or a `Modal`) no click reaches the map.

## Run

```sh
npm run test:world-input                # headless: the probe, with N = 100 per burst, and the oracle
node scripts/world-input-sabotage.mjs   # the two sabotages and the preceding host (needs the preserved host)
node scripts/world-input-graphics.mjs   # the same scene in a real window, with N = 100 and captures in build/world-input-graphics/
```

The first command bundles the HUD (`tests/world-input-fixture.jsx`, written to `build/world-input-probe.js`, which the
scenes load) and runs the headless Godot probe. To look at the scene yourself, run it once so that the bundle exists,
and start the scene with the extension list `npm run setup` prepared:

```sh
Godot --path . res://examples/world-input/scene.tscn
```

Click the map to highlight the tile under the pointer. The dark bar with its blue button, the brown panel and the green
ScrollView panel are React Native: a click there never selects a tile.

## The scenes

| Scene | Topology | HUD |
| --- | --- | --- |
| [scene.tscn](scene.tscn) | (a) one `FabricSurface` anchored to the whole viewport | `WorldInputHud`: a bar with a `Pressable`, a plain panel, a `ScrollView`, a hit-slop button, a `Text` with `onPress`, and an overlay and a `Modal` the probe opens |
| [panels.tscn](panels.tscn) | (b) two Surfaces, the left and the right half of the viewport | `WorldInputPanel`: a bar with a `Pressable` in each |

Both load [world.tscn](world.tscn), whose [script](world.gd) listens in `_unhandled_input`, counts what arrives
by class, device, button and press, and selects the tile under a left press through the camera. The HUD is a
`CanvasLayer` after the world in the tree, and the Surface does not take the pointer: `FabricSurface`'s
`mouse_filter` is `IGNORE` by default and only the Views React Native mounts stop it.

## What the validation proves

[`tests/world-input-probe.gd`](../../tests/world-input-probe.gd) delivers real `InputEvent`s through
`Input.parse_input_event`, 100 of each in one burst closed by `Input.flush_buffered_events()` (20 for the panels
and the open cases), so that every count is exact and none waits for frames; it waits only for a scene to mount and
an overlay to open or close. An [independent oracle](../../tests/world-input-oracle.mjs) re-derives each count
from the HUD's geometry and the rules. The 66 checks say:

- a click, a right click and a tap on the empty area reach the world 100 of 100 times, none reaches a HUD handler,
  the tile selected is the one the camera gives at three points, and `gui_get_hovered_control()` is `null`;
- a click and a tap on a `Pressable` press it 100 times and the world hears nothing (no mouse, no emulated mouse,
  no `ScreenTouch`), a bar with a handler hears it, and a plain panel swallows the pointer;
- the tree overlay and the `Modal` take the left click, the right click and the tap (and the `Modal` the wheel) while
  open, with 100 of 100 reaching the world before and after: the positive control;
- the same for two Surfaces, one per panel.

The world selects tiles on the **mouse stream**: a tap reaches an unhandled map as `InputEventScreenTouch` and as the
`InputEventMouseButton` Godot emulates from it, and the world acts on the second only. A game that needs multi-touch
listens to the first and skips the mouse events with `device == InputEvent.DEVICE_ID_EMULATION`.

The host that predates the policy fails exactly the 31 checks that need it, and two retained sabotages (the probe gives
the Surfaces STOP again, or gives every View IGNORE) are rejected by the probe and by the oracle.

## Limits

A hit slop, a `Text` with `onPress`, the gaps of a ScrollView and the mouse wheel over the HUD or over a tree overlay
still reach the map as well as React Native: they are measured and recorded, not judged, and left to the next slice.
Hardware pointers, a real touch screen, multi-touch and mobile exports are not certified. See the
[research](../../docs/research/world-input.md).
