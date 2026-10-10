# Frontier's native HUD: arm B of the final comparison (V05-10, criterion `braco-b`)

Status: the native Godot HUD of arm B exists and passes the context matrix, which is the invalidation rule `parity` of
[the comparison's protocol](frontier-comparison-protocol.md) ("in B or C, the visible testIDs differ from the table of the context matrix in
any of the seven contexts → reject and redo; B is not ready until it passes"). It is a delivery of effort and a lane, **not a measurement**: no
comparative execution has run, the optimization pass (at most 3.2 h, one round) has not been done, and nothing here says that either HUD is
faster, slower or cheaper than the other. The record of the runs, the captures and the effort is
[docs/evidence/frontier-arm-b/](../evidence/frontier-arm-b/README.md).

The protocol defines arm B as "idiomatic GDScript (Controls, signals, updating only what changed) with the same 6 panels, 7 contexts and testIDs as
C; held to functional parity by the same context matrix", so that it is not a straw man. This note is that design, the seam that lets one set of
probes judge both HUDs, and where B departs from the React Native HUD of [V05-05](frontier-hud.md) (arm C).

## The scene

`consumers/civ-lite/main_native.tscn` mirrors `main.tscn` without the `Application` and without the `FabricSurface`: `GameServices` as the root, `World`,
`HUDLayer/HUD` (the native HUD) and the two validation nodes it runs (`HudValidation` and `OverlayValidation`). The World is ahead of the layer, as in
`main.tscn`, because the World listens in `_unhandled_input` and the node called last in the tree is called first.

`consumers/civ-lite/main_bare.tscn` is the same two nodes and nothing else (no `HUDLayer`, no `Application`, no `FabricSurface`, no validation node): the
scene of arm A, the cost control. It boots headless and headed with no error and plays the whole replay through the services (77 steps, every code as the
replay says, the golden hash at the end). The lane boots it; it is not an arm-B deliverable and no probe runs on it.

The game is the one arm C plays. The rules, the context (`game/context.gd`), the snapshot, the job of the turn and the World are shared and unchanged;
B reads the same snapshot dictionary that C receives as JSON.

**One change to `GameServices`, and why.** The node connected `$Application.runtime_available` in `_enter_tree`, so a scene with no `Application` child
raised `Node not found: "Application"` and a script error. The brief of this slice assumed that such a scene registers nothing and raises nothing, and the
first run showed that it did not. The fix is a lookup that tolerates the absence (`get_node_or_null`, connect only if there is one), four lines in
`services/game_services.gd`. It adds no signal and changes no method, and in a scene with an `Application` (every scene of arm C and of the
laboratory) it does what it did.

## The design

Files, all under `consumers/civ-lite/native_hud/`:

| File | What it is |
| --- | --- |
| `hud.tscn`, `hud.gd` | The root `Control` (full rectangle, `MOUSE_FILTER_IGNORE`) with the theme, and the one script that decides what is mounted |
| `bar`, `actions`, `tile`, `city`, `research`, `dialog` (`.tscn` and `.gd`) | The six panels, each a scene with the script that fills it |
| `overlay.gd` | The blocking layer of the city screen and of the dialog |
| `menu.tscn`, `menu.gd` | The menu screen |
| `spinner.gd` | The bar's activity indicator |
| `kit.gd`, `icons.gd` | What the panels share: building a Control and touching it only when it changed; the six icons |
| `theme.tres` | The colours, borders and type variations of `ui/hud/kit.tsx`, as a `Theme` |

**What the HUD has applied.** `_applied` is the snapshot the panels last showed, set in `_show_game` and nowhere else, and `applied_snapshot()` returns it: a runner that
needs to know whether the HUD has caught up with the game compares it with the node's snapshot, and the contract for that is the runner's to give.

**Signals in, signals out.** The HUD connects to `snapshot_changed` and `hover_changed` of `GameServices` when it enters the tree and disconnects when it
leaves. Each panel raises `intent(method, args)` and the HUD sends it with `callv` on the node, counts it, and shows the refusal in the bar
(`hud-bar-answer`), as C's store does. A pressed Button is `Button.pressed`, a disabled one is `Button.disabled`: the game's `enabled` and `reason_text` go
straight to them.

**Mounting by context.** `PANELS` in `hud.gd` is the table of `ui/hud/hud.tsx` word for word (`none`: bar; `tile`: bar, tile; `settler`, `warrior`,
`stack`: bar, actions, tile; `city`: bar, city, research; `dialog`: bar, dialog). A panel is instantiated when the context calls for it and taken out of the
tree with `remove_child` when it does not, so what the probes see in the tree is what the table says. A panel that left is kept, whole and out of the tree,
in a pool by name, and the next time the context calls for it mounting is an `add_child` and a `render` that touches only what changed (after the optimization
pass, see below); the dialog and the menu are not kept, because each event is a subtree of its own. The city screen with the research
list and the dialog live inside an overlay that exists exactly while one of its panels does. The dialog is made for the head of the queue (`event_id`) and
replaced when the head changes: each event is a subtree of its own, and "1 of 3" is the game's `index` and `count`.

**Updating only what changed.** A Label is set through `Kit.set_text`, which compares first; a Button's `disabled` and a Control's `visible` likewise. A list
(the actions, the city's queue and items, the research, the icons of the tile card) keeps the description it was built from and is touched only when
the new description differs from it, and then row by row (`Kit.sync_choices`, `Kit.sync_lines`): a row whose key is still listed is updated where it differs,
a new key makes a row, a key that went loses its row. The tile card is the only panel the hover touches: `hover_changed` renders it alone. The spinner is hidden at rest and
does not process while hidden.

**The overlay.** The city screen and the dialog are blocking, as C's `Modal`s are, and the choice is a full-screen `ColorRect` with
`mouse_filter = STOP` above the map (`overlay.gd`), with the panels inside it, in the same tree as the HUD.

- **Why this and not an exclusive `Window`.** Both stop the pointer, and C already measures the Window. A Control keeps the overlay in the one tree and
  the one viewport, so a `get_node` reaches its panels, Escape arrives through `_unhandled_key_input` like any shortcut, the dimmed backdrop is one
  `Control` with a colour, and nothing opens or closes a native Window per event. The Window is what the React Native host needs, because a `Modal` is a
  host component with a window of its own; it is not what a game that owns its scene reaches for. The cost is that blocking is the Control's: the
  GUI marks a click as handled when a STOP Control is under it, and the World, which listens after the GUI, never hears it.
- **The wheel is the one input the GUI does not mark as handled.** A tick of the wheel over a STOP Control reaches `_unhandled_input`, where the World
  would take it for the map's (the first run of the probe showed it, over a panel). The HUD root claims it: `_unhandled_input` marks any mouse button event
  as handled while `gui_get_hovered_control()` is not null, and it is called before the World's because its layer comes after the World in the tree. This
  is the Surface's rule in C ("it claims what React Native's hit test finds"), and it needs the same order.
- **Escape.** `overlay.gd` takes `ui_cancel` and raises `close_requested`. The HUD connects it to `clear_selection` for the city screen, the call of
  its Close button, and connects nothing for the dialog, because the event has to be answered; either way the overlay marks the key as handled.

**The map keeps the pointer everywhere else.** The root is `MOUSE_FILTER_IGNORE`, every layout container is too, and only the panels and the buttons
stop the pointer, so a click or a motion off the HUD reaches the World. The World's own rule (`gui_get_hovered_control() != null` clears the hover) then
does what it does under C's panels. The geometry is C's: the bar at the bottom, the tile card under the map, the actions in the right-hand column, the city
screen in the same column inside the overlay and the dialog centred.

**Icons.** The same six PNGs (`ui/icons/`), as `TextureRect`s in the bar, the tile card and the city's title, and as `Button.icon` in the actions and
the city's items, scaled by the theme's `icon_max_width` of 20.

## One probe, two readers

The HUD probes (`hud_probe.gd` and the three that extend it) read the HUD through a reader, the one seam between a probe and the HUD it looks at
(`hud_reader.gd`). A reader answers `observe()` (the rows: testID, kind, visible, text, rect, stops, disabled, animating, modal, instance, and apart every Control that
stops the pointer), `control_of(id)`, `stats()` (the intents the HUD sent), `prepare`, `unmount` and `mount`, `errors` and `not_applicable`.

- `hud_reader_host.gd` is today's code moved: the rows come from `hud.call("snapshot")` and the Control behind each from `instance_from_id`; `modal` is
  "in a Modal's Window".
- `hud_reader_native.gd` walks the Controls of the HUD. A Control is named by its testID (`hud-...`, `menu-...`), as the host names the ones it mounts, and
  is a row when it and everything above it is visible. `modal` is "inside an overlay" (a Control named `...-overlay`). A Godot Button holds its text and
  its icon as properties, where C's Pressable has them as children, so the reader reports them as the rows `<testID>-label` and `<testID>-icon`.
- The scene says which reader a probe gets: `Application/Runtime` is the host's, and without it the HUD is the native one. That is the one place the
  arm is chosen; no probe asks which arm it is running on, and `hud_validation.gd` is the same file for both. The report carries `arm`.

The oracle is the same for both. `tests/civ-lite-ui-oracle.mjs` is unchanged: the same table, the same 46 steps, the same rules, each mutation of a copy of the
report rejected in its category on the native report too. The overlay oracle knows the two arms and one list: what the native arm cannot say, which the probe
writes into the report and the oracle requires to be exactly the arm's.

- **Not applicable to arm B**: the application's error list after a remount (there is no `Application`). The registry's subscriptions and pending work, the
  Hermes heap, the native views and the pointer routes belong to the stability probe, which is the host's and is out of scope for B.
- **What the remount means on B.** C's remount unmounts the Surface and mounts it again; B's takes the HUD out of the tree and puts it back. The HUD
  disconnects when it leaves and, when it returns, renders the game as it is before its first frame; the probe requires that frame to show the event at the head.
- **One stage added to both arms.** The overlay probe had no Escape check (the stability probe has, on C only). It now presses Escape on the city screen and
  on the dialog and the oracle judges both arms by the same rule (`escape`): on the city screen one `clear_selection` and the overlay gone, on the dialog no
  call and the same head. The probe has 28 checks on both arms instead of 26, and `press_escape` moved from the stability probe to the shared base.

## Where B departs from C

- **No store, no telemetry module.** C has a store (`useSyncExternalStore` over two connections, 190 lines) because React renders from state and the
  registry hands it values. B holds the last snapshot and the last hover card in the HUD and renders them. The only count it keeps for the validation
  is `calls`, the intents it sent.
- **The panels are scenes, with the static structure in the `.tscn` and the lists in the script.** C builds its tree in the render function. The line
  counts in the evidence include both, and the theme (179 lines of the 1 310).
- **A Button is one Control.** Text and icon are properties of a Godot Button; C's Pressable has a Text and an Image as children. The reader reports the
  children C's tree has.
- **The refusal text, the menu and New game are the same** (`hud-bar-answer`, `hud-bar-menu`, `hud-bar-new-game`, `menu-new-game`).
- **Blocking is a Control, not a Window** (above), so B has no Modal host, no exclusive Window and no registry to release.
- **Fonts and text metrics are Godot's.** The same sizes and colours give a layout that agrees with C's to a pixel or two (see the captures), not an
  identical picture.

## What the lane found

- **A scene with no `Application` was not silent.** `GameServices` assumed the child (above).
- **A Button's icon needs a width.** `expand_icon` collapsed the icon to nothing in a Button the size of its text; the theme's `icon_max_width` draws it.
- **The wheel passes a STOP Control** (above): the probe's check that a tick of the wheel on a panel does not reach the World failed on the first run and
  is what led to the claim in the HUD root.
- **A reader must not ask the node it reads for the tree.** The host reader's first version used the Control's own `get_tree()`, which is null for a
  Control the host is unmounting; it uses the HUD's.

## The optimization pass

The protocol's single pass for arm B (one round: profile, the changes the profile justifies, one more measurement, stop; B alone, with Godot's own means, outside any comparative
execution) ran against `main` at 151427e with the four windows of the protocol played through the services the way the execution's script plays them. It found three costs and removed them: the
lists of the actions, the city and the research were destroyed and rebuilt whole when the game disabled every choice at the start of a turn (the frame that accepts End Turn with the city open cost 6.7 ms, 4.6 ms of it HUD
script), they are now brought to the new description row by row (`Kit.sync_choices`, `Kit.sync_lines`); a panel that left the tree was freed and made again, it now goes whole to a pool by name (the dialog and the menu are still
made each time, one subtree per event); and the stress panel asked each of its 300 rows whether it had changed and made a Label for every new line, it now compares the new lists with the last shown, leaves the 199 rows that stayed
and gives the row that left the key and text of the line that came. The p95 of `ai-phase` with the city open fell from 7.95 to 3.51 ms (−56%, per-run ranges 7.55 to 8.22 against 3.45 to 3.95), the stress window's mean frame from 2.79 to 2.26 ms (−19%) and its median
frame by 31% (the script of a step from 492 to 121 µs), the switch that opens the city from 9.1 to 5.6 ms. What did not move: the p95 of the stress window (3.50 to 3.41 ms, inside the spread between runs: the layout of 200 rows that all shift by one
line, and the frame that begins the mode, about 30 ms of entering the tree with 300 Labels, which is under 5% of the window's frames and so is not its p95), the p95 of the context switches (−7%, also inside the spread), `event-burst` and
`ai-phase` with no selection. The price: the four frames after the first of the city turn cost 0.1 to 0.3 ms more each (the median of that window rises from 0.40 to 0.77 ms, while its frames sum to a third less), unmounting costs a little more script, and
the pool keeps more objects alive (1 640 to 2 419 at the end of a run; none in the tree). The runner's `stats()` is untouched. The evidence, the raw numbers and the attempts that do not count (a first "after" taken on a scratch copy without
the icons imported; two series read as a slower process that were an artifact of a reference loop) are in [the evidence record](../evidence/frontier-arm-b/README.md#passe-de-otimização).

## Controls and sabotages

- **The causal control.** The same lane on a native HUD that ignores the context (its table mounts the actions and the tile card in all seven) fails the
  matrix: the panels and the map and the content and the input and the phase categories, and the probe's own checks for the contexts that mount other panels.
- **Retained sabotages**, in `scripts/civ-lite-ui-sabotage.mjs` with the same restore-byte-for-byte convention, each rejected by the probe and by the
  oracle for the rule it breaks:
  - `native-city-shows-tile`: the city context mounts the tile card too (panels).
  - `native-overlay-not-blocking`: the overlay no longer stops the pointer (map and blocking).
  - `native-end-turn-by-phase`: End turn is enabled by the HUD's own rule instead of the game's action (bar).

## Not in this slice

The optimization pass, the comparative executions and their metrics, the cost of change, the report, Release exports, arm A, the stability probe on B, typed text
and IME, network images and other platforms. The effort is recorded, not judged: it is a number for the `braco-b` criterion, and the report decides what
it means.
