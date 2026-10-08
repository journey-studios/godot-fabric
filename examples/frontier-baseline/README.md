# The Frontier HUD's performance baseline

The scene of the [world-input spike](../world-input/README.md) (a Godot map seen through a `Camera2D`, with a
React Native HUD over it in a `CanvasLayer`) with the one thing a Frontier HUD does all the time: a button of
the bar is clicked and the panel under it is replaced by another, a tree of 50, 75 or 100 native nodes. The
question this answers is what that swap costs on macOS, which is the baseline that the 0.5 milestone's V05-06
(`baseline`) records and that the later budget is proposed from. It is a measurement, not a budget.

## The scene

[scene.tscn](scene.tscn) instances the pointer spike's [world](../world-input/world.tscn) unchanged and adds one
`FabricSurface` anchored to the whole viewport (topology (a) of the spike) and a `FabricApplication` that runs the
bundle of [`tests/frontier-baseline-fixture.jsx`](../../tests/frontier-baseline-fixture.jsx). The HUD registers
`BaselineHud`:

| Part | What it is |
| --- | --- |
| root | a `View` with `pointerEvents="box-none"`: the empty area belongs to the map |
| bar | four `Pressable`s, one for each panel (`Units`, `City`, `Research`, `Close`), each with a `Text` label |
| region | one panel at a time, mounted by the state the `onPress` of a button sets |
| `units` | 50 native nodes: a root, a header `Text`, and 24 chips (a `View` holding a `Text`) |
| `city` | 75: the same with 36 chips and a production bar |
| `research` | 100: 49 chips |
| `empty` | 0: the base, whose 12 native nodes (the bar, its buttons and labels, the region) every swap comes back to |

The HUD uses only `View`, `Text` and `Pressable`, with the props the 0.5 scope policy
([`docs/compatibility/scope-0.5.json`](../../docs/compatibility/scope-0.5.json)) lets through: `style`, `testID`,
`pointerEvents` and `onPress`.

## Run

```sh
npm run test:frontier-baseline           # headless: the probe in two processes, the exact counts, the oracle
node scripts/frontier-baseline-sabotage.mjs   # the four retained sabotages (do not run another suite meanwhile)
node scripts/frontier-baseline-graphics.mjs   # local only: five runs in a real window, the frame times, the vsync read back, one capture per panel
```

The first command bundles the HUD (written to `build/frontier-baseline-probe.js`, which the scene loads) and runs the
headless Godot probe twice. To look at the scene yourself, run it once so that the bundle exists, and start it with the
extension list `npm run setup` prepared:

```sh
Godot --path . res://examples/frontier-baseline/scene.tscn
```

Click a button of the bar to swap the panel; click the map below to select a tile, which proves the click on the HUD
did not reach it.

## What it proves

[`tests/frontier-baseline-probe.gd`](../../tests/frontier-baseline-probe.gd) clicks the buttons through the pointer
spike's own injection ([`tests/world-input-driver.gd`](../../tests/world-input-driver.gd), preloaded and not copied),
along a tour that makes every ordered pair of panels once (12 swaps ending at the base), for 2 warm-up rounds and 30
steady ones. After every swap it reads the engine's counts and the host's `performance` section, with Hermes' heap
after a forced collection ([`tests/performance-sampler.gd`](../../tests/performance-sampler.gd), the reading GF-30's soak
takes too). It judges what holds at any pace of the machine, exactly: the nodes the SceneTree and the host hold
after a swap are the base's plus the new panel's, a swap creates the new panel's nodes and deletes the old one's, a
click swaps once and never reaches the world, a round ends at the base, and the live heap at rest does not grow past
the GF-30 limit. An [independent oracle](../../tests/frontier-baseline-oracle.mjs) recomputes them from the raw report
and the percentiles from the raw samples. What depends on the pace (the frames a click takes, the pump and its
phases, the heap and resident memory of a swap) is recorded and never judged. The frame time exists only in the
windowed lane: the headless loop is unpaced and draws nothing. See the
[research](../../docs/research/frontier-baseline.md) for the numbers and the proposed budget.
