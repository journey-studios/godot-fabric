# Frontier's context-driven HUD (V05-05, criteria `matriz`, `mapa`, `overlays` and `estabilidade`)

The first slice of milestone 0.5's fifth item puts the HUD in the hands of the game's context. Godot already derives one of
seven contexts from the state (`consumers/civ-lite/game/context.gd:17-31`) and publishes it in the snapshot; this slice makes the
React Native HUD mount exactly the panels that context calls for, shows the turn and the resources in a bar that is always
there, and makes the map the World's: a click on a tile selects it in GDScript, and the pointer over the map is published as a
state of its own so that the tile card can show it. The record of the runs, the receipt and the captures are
[docs/evidence/civ-lite-ui/](../evidence/civ-lite-ui/README.md). A second slice (2a, below) makes the city screen and the event dialog
blocking `Modal` overlays and turns the game's event into a queue of three that the HUD works through, and a third (2b, at the end) opens and
closes each overlay twenty times, scans the HUD against the 0.5 manifest and draws its icons with `Image`: it closes `estabilidade`, the last criterion.

The criteria this slice covers, from `milestones[0]`, item V05-05:

- `matriz`: a store at module scope and a switch of context; the matrix of testIDs passes for the seven contexts, with no extra
  panel.
- `mapa`: the turn and resources bar (End turn disabled, with a spinner, during the AI's phase), the unit's actions with the
  reason a disabled one gives, and the tile card (the hover comes from Godot).

`overlays` (blocking overlays, the event queue of three, remount order) is slice 2a, below. `estabilidade` (20 open/close cycles, focus, a
capture for each context in the final form, the API scan, icons) is slice 2b, at the end. Slice 1 rendered the city, research and dialog panels
in their contexts so that the matrix is complete, with the dialog as a positioned panel; slice 2a turns the city screen and the dialog
into `Modal` overlays.

## The context to panels table

The table is the one `docs/research/frontier-game.md` ("The seven contexts") left to the HUD slice to confirm. It is confirmed
without change, with the bar in every row:

| context | panels (testIDs) |
| --- | --- |
| `none` | `hud-bar` |
| `tile` | `hud-bar`, `hud-tile` |
| `settler`, `warrior` | `hud-bar`, `hud-actions`, `hud-tile` |
| `stack` | `hud-bar`, `hud-actions` (one `select_unit` per unit), `hud-tile` |
| `city` | `hud-bar`, `hud-city`, `hud-research` |
| `dialog` | `hud-bar`, `hud-dialog` |

- `consumers/civ-lite/ui/hud/hud.tsx:33-48` (`panelsOf`) is the whole decision: a `switch` over the snapshot's `context`, and
  `hud.tsx:55-77` (`GameScreen`) mounts what it answers. The bar is mounted unconditionally (`hud.tsx:66`).
- A panel never looks at whether its data exists. `snapshot.city` and `snapshot.research` carry data in every context once the city
  exists (`consumers/civ-lite/game/snapshot.gd:31-35`), so a gate on `city.present` would show the city screen in the `none` and
  `tile` contexts of every turn after the second. The sabotage `city-by-data` does exactly that and is rejected.
- Which panel exists is the game's, not React's: the replay's covering steps drive the seven contexts through the services
  (`consumers/civ-lite/game/replay.gd`, steps 2, 3, 9, 18, 32, 33 and 45) and the HUD follows the context each leaves.
- Every panel is a positioned box (`hud/kit.tsx`, `Panel`), and the HUD's root and the column that stacks the right-hand panels
  are `pointerEvents="box-none"` (`hud.tsx:63`, and `:68` for the overlay's column): no spacer or layout View claims the map area. The map is
  (24, 24)-(600, 408); the tile card sits under it, the column starts at x=616 and the bar is at the bottom. Since slice 2a the city
  screen with the research list, and the dialog, sit inside a `Modal`'s window (see "The overlays" below); the table and the testIDs are unchanged.

Child testIDs belong to their panel by name (`hud-actions-fortify-2`, `hud-city-item-warrior`, `hud-dialog-choice-welcome`, …);
the one exception is the bar's spinner, `hud-turn-spinner`. The actions panel renders exactly `snapshot.actions` in the game's
order, each with its `enabled` flag and, for a disabled one, its `reason_text` (`hud/actions.tsx`), **except `end_turn`**: the
snapshot lists End turn among the actions, and the HUD puts it on the bar (`hud/bar.tsx:14-35`), enabled exactly when the game's
`end_turn` action is, with the game's reason beside it when it is not. This split is on record in the evidence.

### The name `available_actions`

The criterion says the list shown is identical to `unit.available_actions`. That field does not exist: the DTO's field is
`snapshot.actions` (`consumers/civ-lite/game/snapshot.gd:73-93`, `docs/research/frontier-game.md`, the snapshot). The oracle compares
the rendered list with `snapshot.actions` minus `end_turn`.

## The bar and the turn in progress

`hud/bar.tsx:14-35`: the turn and epoch, the phase the game is at, the three resources as `stock (+rate)`, End turn, and Menu and
New game. Since the end of a turn became a job (`docs/research/frontier-services.md`, "The turn is a job") the snapshot carries
a `phase` that is `idle`, or the phase the turn being processed is at; every intent is refused with `turn_in_progress` while it is
not `idle`. The bar maps that to three things and decides none of them:

- End turn's `disabled` is `!enabled` of the snapshot's `end_turn` action (`bar.tsx:15-16`), not a second rule on the phase;
- the reason under it is that action's `reason_text` (`bar.tsx:30`);
- the `ActivityIndicator` (`testID="hud-turn-spinner"`) is mounted exactly while `phase !== "idle"` (`bar.tsx:29`).

The sabotage `end-turn-by-phase` replaces the first with a rule of the HUD's own (`phase === "idle"`) and is rejected in the `dialog`
context, where the game disables End turn with `event_pending` while the phase is idle.

## The store

`consumers/civ-lite/ui/store.ts` is the only module that talks to the game, and the template a copy of this HUD starts from.

- **One store at module scope.** The view is `{snapshot, hover, answer}` (`store.ts:28-34`); panels read it through
  `useFrontier()`, which is `useSyncExternalStore(subscribe, read)` (`store.ts:93-95`). All the components of a render see the same
  snapshot, so a commit never shows a panel of one context with the actions of another.
- **The connections follow the readers.** The first reader connects to `frontier.snapshot` and to `frontier.hover`
  (`store.ts:62-65`); the last one to stop reading removes both and the view goes back to "not connected"
  (`store.ts:67-86`). The menu screen reads nothing, so it holds no connection, and New game connects again. This is the leak
  guard the consumer lane already measures (`consumers/civ-lite/validation.gd`): 2 subscriptions on the game screen, 0 in the
  menu, and a new epoch is just the next snapshot on the same connection.
- **The screen is a second, tiny store** (`store.ts:97-120`, `useScreen()`) that connects to nothing: the menu is not part of
  the game's snapshot, and `Hud` (`hud.tsx:87-89`) chooses between `GameScreen` and `MenuScreen` with it, so the root holds no
  subscription of the game's.
- **Intents.** `send(...call: FrontierCall)` is typed over `callFrontier` (`store.ts:142`): the method's name and the arguments it
  declares, or it does not compile. `sendAction(action)` (`store.ts:150-168`) maps an action of the snapshot to its typed call by
  its id; an id it does not know is a problem the validation counts, never a guess. The snapshot's own comment says a caller needs
  no knowledge of which intent takes what, and that is the one place the HUD gives a little of it up for static types.
- **No effect, ref or listener in the HUD.** No panel holds a `useEffect`, a ref used as an event target or an `addEventListener`,
  and none imports the runtime. The lane scans the sources for it (`tests/civ-lite-ui-native.test.mjs`).
- **Telemetry is not the store's.** What the validation reads (`FrontierHud.stats()` and `FrontierHud.send`) is
  `consumers/civ-lite/ui/telemetry.ts`, which the store tells what it received and sent through six narrow calls
  (`observe.snapshot`, `.hover`, `.call`, `.result`, `.problem`, `.screen`: `telemetry.ts:31-72`) and which installs the global
  (`telemetry.ts:84-90`, `store.ts:187-190`). A copy of the HUD can delete it with one import.

## The hover service

The pointer is not part of the game. Godot hears it, over the map, so it is Godot that publishes it, as a state of its own:

- `frontier.hover` is registered next to the snapshot (`consumers/civ-lite/services/game_services.gd:116-117`). Its schema is the
  snapshot's `TILE_CARD` (`consumers/civ-lite/services/schema.gd:23`, `:47` `HOVER := TILE_CARD`), so the card of the tile under the
  pointer is the same DTO as the card of the selected tile, with `present` 0 while the pointer is over no tile. The TypeScript
  mirror is `FRONTIER_HOVER` and `FrontierStates["frontier.hover"]` (`consumers/civ-lite/ui/frontier-types.ts:233`, `:248-256`), and
  the parity test compares the two in both directions (two mutations of its own).
- The card is built by the same function the snapshot uses for the selected tile, now public: `Snapshot.tile_card(state, x, y)`
  (`consumers/civ-lite/game/snapshot.gd:101-109`, `_tile` calls it with the selection) and `FrontierGame.tile_card`
  (`consumers/civ-lite/game/game.gd:121`).
- **The snapshot is untouched.** Its schema, its emission (once per accepted intent and per phase) and the golden and trace hashes
  are what they were; the hover has an emission rule of its own: `hover_changed` fires when the hovered tile changes
  (`game_services.gd:139-145`), and again, only when the card changed, when the World hears a snapshot (`refresh_hover`,
  `:150-156`; a unit moved onto the hovered tile). A new game, the menu and a reload clear it (`:160-165`, called at `:269` and `:312`).
- The registry holds 15 bindings now: two states, one signal and 12 methods. The 12 methods did not change.
- The tile card shows the hovered tile while the pointer is over the map and the selected tile otherwise
  (`consumers/civ-lite/ui/hud/tile.tsx`). The tile panel is mounted by the context, so the pointer over the map changes the card of
  the contexts that have one (`tile`, `settler`, `warrior`, `stack`) and nothing in `none`, `city` and `dialog`.
- Pressable hover stays refused (`onHoverIn` and `onHoverOut`, `docs/compatibility/scope-0.5.json`) and there is no right click:
  the hover is not an RN event at all.

## The input of the map

The map is the Godot side of the screen, so the pointer on it is Godot's too. This follows the policy of the pointer spike
(`docs/research/world-input.md`, "The rule (a2)" and "Where the claim runs"): `FabricSurface` is `MOUSE_FILTER_IGNORE`, the HUD's root
is `box-none`, and the Surface claims, in its own `_unhandled_input`, what React Native's hit test finds under the event. The World
hears what is left.

- `consumers/civ-lite/world/world.gd:76-88` (`_unhandled_input`): a left press on a tile of the map calls
  `services.select_tile(x, y)`, Godot to Godot, the game's own intent through the `GameServices` node that also serves the registered
  method (the rules stay in GDScript and the HUD only sees the snapshot that follows); a mouse motion calls `services.set_hover`
  with the tile under the pointer, and a position off the map is none. The World listens to the mouse stream: a touch reaches it as
  the mouse Godot emulates from it, so one code path serves a mouse and a finger (`world-input.md`, "The touch stream the world
  listens to"). The tile comes from `make_input_local` (`world.gd:104-106`), whatever the canvas transform.
- The motion over a panel never reaches `_unhandled_input`: the panel's Control stops it in the GUI. So a pointer that leaves the
  map for a panel is noticed in `_process` (`world.gd:93-95`, `gui_get_hovered_control() != null` clears the hover), and one that
  leaves the window in `_notification` (`world.gd:98-100`, `NOTIFICATION_WM_MOUSE_EXIT`).
- The World also draws the hovered tile with a lighter outline (`world.gd:130`), and counts the mouse buttons and motions it hears
  (`world.gd:43`, `heard`) so that a probe can prove a click on a panel did not reach it.
- A click on a panel does not reach the World because of two different things: a click or a motion on a `Pressable` or any View is
  stopped by the panel's own Control in the GUI, before the unhandled stage, whatever the order of the tree; what the GUI lets
  through (a tick of the wheel over a panel, a hit slop) is claimed by the Surface, **only if** the Surface is called before the
  World.

### The order of the World

Godot calls `_unhandled_input` in reverse tree order (`world-input.md`, "Where the claim runs": the node last in the tree is called
first), so the HUD's `CanvasLayer` has to come after the World in the tree for the Surface to claim before the World hears. The scene
has it so (`consumers/civ-lite/main.tscn`: `World` before `HUDLayer`), but `GameServices` drops the World for the menu and brings a
new one for New game, and `add_child` put the new one **last**, behind the HUD. The World now returns before the first
`CanvasLayer` (`game_services.gd:296-305`). The probe proves it with a tick of the wheel over a panel before and after a trip through
the menu (the World hears 0 events, and `worldIndex < layerIndex`); the sabotage `world-behind-hud` removes the move and is rejected.

## The lane

`npm run test:civ-lite-ui` (`tests/civ-lite-ui-native.test.mjs`) provisions the template through the SDK into a fresh project, builds
it in the editor with no Node of its own, and runs `-- --validate-hud` (`consumers/civ-lite/hud_validation.gd`) headless. The probe
writes raw observations (the HUD's tree as the host reports it: testID, text, place, whether a Control stops the pointer, whether a
Pressable is disabled) and `tests/civ-lite-ui-oracle.mjs` judges them again on its own, from the table above, the format of what each
panel says and the geometry of the map, never from the probe's verdicts.

- **Matrix** (`run_matrix`, `hud_validation.gd:56`): the replay's steps 0 to 45 through the services on a fresh game. The exact set
  of visible panel testIDs equals the table at each, no testID outside the six panels is mounted, the actions panel equals
  `snapshot.actions` minus `end_turn` (id, label, enabled, reason, order), the bar and the cards say what the snapshot says, and no
  Control that stops the pointer covers a tile, except a Modal's window, which must cover the whole map in the city and dialog
  contexts and in no other step (the overlay's content must be inside the Modal's window).
- **The turn** (`run_phase`, `hud_validation.gd:121`): End turn pressed on the HUD, every frame of the job observed (the spinner and the disabled
  button must agree with the phase, and only phases the game published may show), then a second job held at its first phase, where
  the spinner spins, End turn is disabled with the game's reason and a press on it asks the game nothing. It waits by state; no count
  that depends on the runner's pace is asserted (the invariant is per snapshot).
- **Real input** (`run_input`, `hud_validation.gd:206`): events pushed through the viewport with the Surface's validation device: a click selects the
  tile the geometry gives; the pointer over a tile publishes the hover and the card shows it; over a panel or off the map it clears;
  a click and a tick of the wheel on a panel do not reach the World; an enabled action is performed by a real press and a disabled one
  is not, with its reason shown; and all of it again after the menu.
- **Controls.** The HUD of `5e1f6a1`, taken from git, on the same scene fails actions, content, input, map, panels and phase (map since
  slice 2a). Twelve retained sabotages (`scripts/civ-lite-ui-sabotage.mjs`; eight from slice 1 and four from 2a) are rejected by the probe
  and by the oracle for the reason each was broken. The oracle also rejects 27 mutated copies of the genuine report (23 in slice 1).

### What the lane found

- **The old HUD's spacer never swallowed a click.** `consumers/civ-lite/ui/index.tsx` at `5e1f6a1` had a `View` 624 px wide with no
  testID and nothing that paints. Fabric flattens a View like that: it is never mounted as a Control and claims nothing, so the map
  click selected in the control run. The control fails because there is no bar, panel or card, not because of the spacer. The
  sabotage `spacer` uses a spacer with a `testID`, which is not flattened, and is rejected.
- **A headless run has a 64×64 window**, whatever `window/size` says, so the HUD, which is laid out for 1080×600, came out wrong. The
  probe sets `get_tree().root.size` (`hud_probe.gd:302`), as the pointer probes of the laboratory do.
- **A STOP Control keeps a click from the World whatever the order of the tree**; only what the GUI lets through depends on it (see
  above), which is why the probe uses the wheel.

## Imports

(Slice 2b adds `Image`, and the scan below: it reads this list against the manifest on every run.) The HUD imports `AppRegistry` (member `registerComponent`), `View`, `Text`, `Pressable` and `ActivityIndicator` from
`react-native`, `useSyncExternalStore` from `react`, and `GodotFabric.connect` and `GodotFabric.call` (in `store.ts` only) from
`@godot-fabric/runtime`. The props are `testID`, `style`, `pointerEvents="box-none"`, `key`, `disabled`, `onPress`, and `size` and
`color` of the `ActivityIndicator`; no `onHoverIn`, no right click and no `ScrollView`. Since slice 2a it also imports `Modal`
(`ui/hud/overlay.tsx` only), with `testID`, `visible`, `transparent`, `animationType="none"`, `presentationStyle="overFullScreen"` and
`onRequestClose`: the manifest supports the first four and the last, and accepts exactly those two values for the two it otherwise refuses
(`animationType` takes `none`; `presentationStyle` takes `overFullScreen` and `fullScreen`). The 0.5 scope manifest decided every name but
`AppRegistry` until slice 2b, which added it (supported, with the members `registerComponent` and `getAppKeys`: it is the HUD's entry point) and
made the lane read the HUD against the manifest, so that a name the manifest does not decide fails the lane (see "The scan against the manifest").

## Not in this slice

- (Slice 2b did the rest of `estabilidade`: 20 open/close cycles without a leak, focus restoration, a capture for each context in its final
  form, the API scan and the icons by `Image`; see the last section.)
- The hover was exercised with synthetic events through the viewport (and in a headed run, which saves the captures); no physical
  mouse. iOS and typed text are out of scope. The event queue is the one change to a game rule: it is slice 2a's (below).
- Hosted CI runs the lane headless only; the captures are a local, headed run.

## Slice 2a: the queue of three events and the blocking overlays (criterion `overlays`)

### The queue is the game's

By the user's decision of 2026-10-09 the queue of three events is real in the game, not a list kept by the HUD
(`docs/research/frontier-game.md`, "Events" and "The replay", has the rules, the table and the new hashes). The HUD reads it from the
snapshot and decides nothing about it:

- The snapshot's `dialog` is the head of the queue (`consumers/civ-lite/game/snapshot.gd`, the dialog builder), with the choices of **that**
  event, and `index` and `count` (1-based: the events answered plus this one, and those plus the ones waiting), so the dialog says "1 of 3",
  "2 of 3" and "3 of 3" with the game's own numbers (`ui/hud/dialog.tsx`, `hud-dialog-position`). The mirror is `Dialog.index` and `Dialog.count` in
  `ui/frontier-types.ts` and `index` and `count` in the schema (`services/schema.gd`), one of the pairs the parity test compares.
- The context is `dialog` for as long as the queue is not empty. Every intent but `resolve_event` is `event_pending`; a choice that belongs to
  another event is `unknown_choice`; an answer with the queue empty is `no_event`.
- **Each event is a subtree of its own.** `hud.tsx` mounts `<Dialog key={snapshot.dialog.id} ...>`: when the head changes the previous
  dialog is unmounted and a new one mounted, so no state of one event leaks into the next. The probe reads the dialog's Control instance
  before and after each answer and requires a new one every time; the sabotage `dialog-unkeyed` drops the key and is rejected.
- The position is never computed in the HUD: the sabotage `position-in-js` replaces `dialog.index` with a guess from the event's id and is
  rejected in the second round.

### The overlays

`ui/hud/overlay.tsx` is the one component that opens a `Modal`. The city screen with the research list (`hud-city-overlay`, context `city`)
and the event dialog (`hud-dialog-overlay`, context `dialog`) are its two uses (`hud.tsx`); the bar, the actions and the tile card stay as
positioned boxes in the tree, and the root stays `box-none`.

- **The Modal is a window of its own.** The host opens a `Modal` as an embedded, exclusive Window child of the root, so while it is on top the
  pointer under it does not reach the World and nothing below it hears the mouse (`docs/research/world-input.md`: with a `Modal` open, nothing
  reaches the map, 0 of 100 open and 100 of 100 closed). The overlay's backdrop is a full-window `View` with `rgba(2, 6, 23, 0.62)`: the game stays visible, dimmed, behind it. The dialog is
  centred; the city screen sits in the right-hand column, where the panels were.
- **Escape.** `onRequestClose` is what the host calls on Escape. On the city screen it is the game's `clear_selection`, the same call as its Close
  button; on the dialog it does nothing, because the event has to be answered. The probe closes the city by pressing Close and answers the dialog by
  pressing its choices; no key is sent, so Escape is in the code and the source scan only.
- **What is measured.** With each overlay open, 100 left clicks, 100 right clicks and 100 wheel ticks on the map (one motion, a press and a release
  each, on 100 different tiles, pushed before a frame passes) reach the World **0 times**: its own `heard` counters, the game's `select_tile` calls
  and the selection do not move. With the overlay closed, **100 of 100** of each reach it, and each left click selects. (`overlay_validation.gd`,
  `burst`, `reached`, `silent`, `judge_blocking`.) A `Pressable` inside the overlay works: a press on the Warrior item of the city screen queues it, and
  the three events are answered by real presses.
- **Remount.** With event 2 at the head the Surface is unmounted (the HUD leaves the tree) and mounted again. The game keeps the queue, and the
  first frame of the new HUD already shows "2 of 3" inside a Modal: no frame shows another event. The queue then goes on to the third
  event and to the end by real presses.
- **A new session** (`New game` with events waiting) has no queue, no dialog and no Modal until its own turn 5, when it raises its own three.
- **The bar is under the Modal.** With an overlay open the bar's Menu and New game cannot be pressed (the Modal covers the window), so the probe
  goes to the menu through the services.

### Reading a Modal's nodes: the host snapshot

A Modal's Controls are children of the Modal's own Window, not of the Surface's subtree, so `hud.find_child(testID)` does not reach them. The
probe base (`consumers/civ-lite/hud_probe.gd`, `observe` and `control_of`) reads the HUD from the host's snapshot instead: `hud.call("snapshot")` is
a JSON tree of nodes by `testID`, each with an `id`, resolved with `instance_from_id` to the Control, from which the probe takes the rect, whether it stops
the pointer, whether a Pressable is disabled (the accessibility `descriptor.disabled`) and whether `control.get_window() != get_tree().root`, that is,
whether it is inside a Modal's window. Everything the matrix and the overlay probe say about panels comes from that one function, which is why the
base moved out of `hud_validation.gd` into `hud_probe.gd`, shared by both probes.

### The lane of slice 2a

`npm run test:civ-lite-ui` now runs two probes in the same project, `-- --validate-hud` (144 checks) and `-- --validate-overlays`
(`consumers/civ-lite/overlay_validation.gd`, 26 checks: the queue, the remount, the blocking and the new session), each judged by its own independent
oracle (`tests/civ-lite-ui-oracle.mjs`, `tests/civ-lite-overlay-oracle.mjs`) from the report's raw observations, never from the probe's verdicts. The oracle
of overlays rejects 20 mutated copies of its report.

- **Two causal controls.** The HUD of `5e1f6a1` on the new game (the check of slice 1, which now also fails `map`), and the game, services and HUD of
  `622102e` (one event, panels in the tree, no Modal) on the overlay probe, which fails exactly `blocking`, `newgame`, `queue` and `remount`.
- **Twelve sabotages** of the HUD, four of them new (`queue-out-of-order`, `position-in-js`, `city-in-tree`, `dialog-unkeyed`), and a new one of the
  game (`events-out-of-order`) in `scripts/civ-lite-game-sabotage.mjs`.
- The probe ends with a `new_game`, so no overlay is open when the application quits: quitting with a Modal's window mounted logs an engine error
  (`remove_child` on a root that is already being freed), which is the host's and is tracked separately.
- **A check's name is its identity, and no name carries a count that depends on the pace.** The digest of the report's check names is what a hosted
  run is compared by, so the counts of what was observed (the frames of a job or of a remount, the snapshots, the hover cards) are in the report's data
  (`phase.published`, `phase.free.samples`, `hoverPublished`, `remount.remounted.samples`) and never in a name. Four names carried one until `8ba2a35` fixed them
  (the overlay control gave 93 frames where the run gave 5), and the lane now refuses it: `assertNamesDoNotDependOnPace` rejects a name with a count of frames,
  snapshots, cards, samples or time, and `assertSameNamesAsHeadless` requires the headed run to have the headless run's names, in order. The names that embed the
  value observed (the panels a step showed, the list of heads) differ only when the check fails, which is the diagnosis.

### The turn lane after the overlays

The turn lane of V05-06 (`npm run test:frontier-turn`, `tests/frontier-turn-*`; its record is `docs/research/frontier-turn.md`) clicks the provisioned game's HUD, so it was written against the HUD of slice 1: panels in the tree and one
event. The tables of measurements in `frontier-turn.md` are those of that tour (PR #86: 16 clicks), and whoever runs the lane again re-records them. What changed in the lane, and why:

- **A 19-click tour, with nothing clicked under a Modal.** A Modal takes the pointer from everything under it (0 of 100 clicks reach the map), so the tour closes the city screen with its own Close (`close-city` and `close-city-again`, one `clear_selection` each) before it goes
  on: `map-tile-again` (a click on the map with the city shown) is gone, `map-city` goes from `none`, and the first End turn is pressed from `none`. The oracle judges this against the contract and not against the probe: no `map` or `turn` step starts in a context that holds a Modal,
  and each time the city opens the next step is its Close.
- **The three answers of the queue.** The End turn of the fourth turn opens the first event, and `answer-event-1` to `-3` click the first choice of each head (`welcome`, `buy_grain`, `host`). Each arrival must show the position the game gives ("1 of 3" to "3 of 3") and that event's two
  choices and no other, against the table of events the oracle writes again; the last answer leaves no dialog.
- **The Controls are found in the Surface's snapshot.** A Modal's Controls are children of the Modal's own Window, which `hud.find_child` does not reach: the probe resolves the snapshot's testIDs to Controls by instance id (as `hud_probe.gd` does), one read a frame, for what is mounted and
  for where to click.
- **A Window for each Modal in the node counts.** The SceneTree holds the host's native views plus the constant of the base, and one `Window` for each Modal the context holds open (`MODAL_CONTEXTS`: the `city` and `dialog` contexts have 1 more node than their native views say, measured 1 in every
  round; `native/modal_presentation.cpp` holds one window for each `ModalPresentation`).
- **The calls, counted by intent.** Over a run the game is asked for each intent once for every click of that intent, in every round (`select_tile` 5 a round, `select_unit` 3, `clear_selection` 3, `found_city` 1, `end_turn` 4, `resolve_event` 3, plus the `new_game` of the round).
- **No Modal is open when the application quits**, which would log the host's engine error: the last click closes the dialog, and the probe closes any that a cut-short run left, with a new game, after it takes its counts.

The rules that compare a context with itself, the frames of the turn and the heap and resident-memory bounds are unchanged. On the new tour every click shows its panels in 2 frames and every End turn in 8, and the contexts hold 14 (`none`), 18 (`tile`), 24 (`warrior`), 26 (`stack`), 27 (`settler`), 28 (`dialog`) and 47 (`city`)
native views.

## Slice 2b: stability, the scan and the icons (criterion `estabilidade`)

The last criterion of V05-05 reads: open and close each screen 20 times without leaking nodes or listeners, focus restored and 0 of 100 clicks reach the
world under an overlay; captures of the macOS build per context; a scan with no forbidden API; icons by `Image`, or by glyphs if the `Image` is not enough.
The record is [docs/evidence/civ-lite-ui/](../evidence/civ-lite-ui/README.md) ("Fatia 2b"). Slice 2b has no C++: everything below is measured on the host
of slice 2a.

### The third probe: `-- --validate-stability`

`consumers/civ-lite/stability_validation.gd` (with `stability_judge.gd`, the checks the probe makes of itself, split off to stay under 600 lines; both
extend `hud_probe.gd`, which also took the helpers of the overlay probe that the new one reuses) runs, in one project, after the other two:

- **The city screen, 20 cycles of two rounds.** A real click on the city's tile (7, 8) opens it, a real press on its Close closes it; a second real click
  opens it and Escape closes it through `onRequestClose`, which is the game's `clear_selection` (one call each, in every round). That is 40 openings.
- **The event dialog, 20 cycles.** `new_game`, the replay's intents through the services up to turn 5 (the end of turn that raises the three events),
  then the three events answered by real presses: 60 answers. The Modal is mounted once and stays until the third answer, so the cycle is measured at four
  rests (the dialog open, after each of the three answers) and each has the first cycle's numbers as its baseline. Escape on the open dialog reaches the Modal's
  Window (a `window_input` connection counts it) and changes nothing: the same event, no call, the same state hash, the Modal still open.
- **Icons.** The Images each of four contexts mounts (`none`, `stack`, `settler`, `city`): see below.

**A measure is of a screen at rest, and rest is a state.** `come_to_rest` waits, with a limit of frames that is only the ceiling of the wait, for the state a
screen is judged in, in two readings running with the same signature: no pending work, timers, animation frames, host tasks or events; no pointer
contact active or suppressed; no tag retiring; as many presented Modals and `Window`s as the screen has; no orphan node; the host's views, tags and nodes
the same count; and **every Image settled** (loaded and drawn, or failed with its error). The last condition is the one that the first review of the slice
found missing: a screen whose Modal had just opened was declared at rest while the decode of its five icons, on a worker, had not finished, and the lane
failed on a slower run (`"status": "loading"`, `"loads": 0`). Nothing in a measure is waited for by a count of frames any more: the padding frames of the
first version were replaced by the quiescence of the signature. After the wait the probe reads the host with the Hermes heap collected first
(`validation_collect_garbage_on_status`, set on the application only around that read).

**What is compared.** After every close (and while open) the probe records the SceneTree's nodes, orphans and `Window`s, the host's native views and tags and
the nodes of its snapshot, the pointer routes (`pointerRouting.stored`, `suppressed`, `contacts`, `active`, `hoverPointers`) and the pointer processor, the
registry's bindings, subscriptions and pending tasks and events, the HUD's store subscriptions, the connections of `snapshot_changed` and of `hover_changed`,
and the pending work. Each of them equals the first cycle's value of its series, exactly, and the independent oracle (`tests/civ-lite-stability-oracle.mjs`)
also states what a screen at rest holds without looking at cycle 1 (15 bindings, the HUD's two subscriptions, no orphan, no pending work, no route of
the pointer active or suppressed, the Windows the game had before), so that a leak that began before the baseline is not the baseline. After a close the HUD
is what it was before the open (nodes, views, Windows), and what the round created it deleted (`creates` minus `deletes` is the same on both sides).

**Two findings about what the host counts.**

- `modalRuntimeMembers` is not the number of open Modals. It counts the runtimes that are members of the modal stack
  (`native/modal_window_stack.h`, `runtime_count`), which is 1 for as long as the application runs, with a Modal open or not. A Modal that is open is a
  node of kind `modal` with a `modalWindow` in the host's snapshot and a `Window` in the SceneTree; the probe counts those and checks that the members stay at 1.
- The engine's object count (`OBJECT_COUNT`) is not exact from cycle to cycle: it has a jitter of one object, and the 300 input events a burst pushes
  stay alive for about a hundred frames after it. It is therefore not in the exact comparison; the probe waits (by state) for the count to return to its value
  before the burst, and the oracle judges it on the rests after a close by the same rule as the heap with a limit of one object.

**The heap.** The rule is the one of the performance baseline (`tests/frontier-baseline-heap.test.mjs`, reused through `heapAtRest`): leave out the first two
rounds, and the median of the last half of the steady ones may not be more than 2,048 bytes above the median of the first half. It is judged on the 20 rests after
a Close, the 20 after an Escape and the 20 after the third answer. The HUD's own telemetry (`FrontierHud.stats`) keeps the last 64 results, so it grows
until it holds 64; the probe fills it before the first measure (70 calls, then two that the game accepts so that the bar does not show a stale refusal), and the
oracle requires the 64 entries, because otherwise the heap would rise by the telemetry's growth, which is bounded and is not a leak.

**Focus, as this host can measure it.** React Native's focus is out of scope (the 0.5 manifest says no View takes keyboard focus), and nothing in the host
restores a Control's focus when a Modal closes (`native/modal_window_stack.cpp` only `grab_focus`es the top exclusive Window when it opens). "Focus restored"
therefore means:

1. the root viewport's `gui_get_focus_owner()` after every close is the value it had before the open (null in every cycle);
2. while an overlay is open, exactly one Modal `Window` is exclusive and visible (the top of the stack, and the only one), the root viewport has no focus
   owner, and no node of the snapshot outside that Window reports `focused`;
3. Escape on the city screen closes it, Escape on the dialog does nothing.

Whether the root Window itself has the operating system's focus, and whether the Modal's Window has it, are recorded but not judged: they depend on the user's
desktop during a headed run.

**0 of 100 under the overlay, again.** In the first and in the last cycle of each screen, with the overlay open, 100 left clicks, 100 right clicks and 100 wheel
ticks pushed at the map reach the World 0 times and select nothing (`hud_probe.gd` `bursts`, now shared with the overlay probe).

### The scan against the manifest

`tests/civ-lite-hud-scan.mjs` parses the HUD (`index.tsx` and `hud/*`) with the TypeScript compiler API and reads `docs/compatibility/scope-0.5.json`, never a copy:

- every name imported from `react-native` must be one of the manifest's `names`, and a name that its `outOfScope` prose or `notInTheManifest` leaves out
  (`TextInput`, `Keyboard`, `FlatList`, ...) is refused with the sentence that says so; a default or namespace import, a re-export, a `require` and a dynamic
  import are refused because they hide which names are used; a type-only import is erased by the build and is not a name;
- every prop of a JSX element of one of those components must be one the manifest supports for it; a refused prop passes only with a value its `accepts`
  lists (`animationType="none"`), an ignored prop is refused because it changes nothing here, and a prop that RN does not declare for the component
  (`onContextMenu`, `onAuxClick`) is refused as unknown; a spread cannot be checked and is refused; `children` of an `Image` is refused;
- every member read of a name that has a `subset.members` list (`AppRegistry.registerComponent`) must be in it, and the name is read only that way: members
  destructured from it (`const { getAppKeys } = AppRegistry`) are checked against the list too (a rest element or a computed member is refused), and any loose use
  of the bound name (an alias, an argument, a return, an export, a shorthand property) is refused, because it would hide which member is read afterwards;
- any subpath of `react-native` (`react-native/Libraries/...`) is refused, however it is reached: a static import, a re-export, an import type, a `require` or a dynamic
  import.

The lane runs it on every provisioned project and proves it can fail with 13 changes of a copy of the sources (a `FlatList`, a `TextInput`, a `Keyboard`
import; a name the manifest does not decide; a namespace import; a `require`; `onHoverIn`, `onContextMenu` and `onMouseEnter`; `animationType="slide"`;
children of an `Image`; a spread; `AppRegistry.runApplication`; a static import, a re-export, a `require` and a dynamic import of a subpath of `react-native`; `AppRegistry`
destructured into a member outside the subset or with a rest element, aliased, and passed as an argument: 21 changes in all) and two that it must let through (a type-only import
and a member of the subset destructured): 23 cases. The hand-written patterns of the lane
(hooks, listeners, talking to the game) stay: the manifest lists none of those. `AppRegistry` was added to the manifest with the subset it has
(`src/app-registry.js`).

### Icons by `Image`

Six 32x32 PNGs, original art drawn from shapes by `scripts/civ-lite-icons.mjs` (settler, warrior, city, food, production, science), live in
`consumers/civ-lite/ui/icons/`; the generator writes the PNGs with stored (uncompressed) zlib blocks, so the bytes depend on nothing but its source, and the lane
requires the committed files to be what it draws. `ui/hud/icons.ts` imports each as an asset (`ui/assets.d.ts` declares `*.png`, as the libraries consumer does;
the asset plugin registers the file and copies it beside the bundle) and `Icon` in `ui/hud/kit.tsx` draws it with an `Image`. They are in the bar (the three
resources), the actions (the unit of a `select_unit` or a `fortify`, the city for `found_city`), the tile card (each unit and the city) and the city screen (its
title and each production item), which is **inside the Modal's Window**: an `Image` there loads and draws like any other (`image.counters.errors == 0`,
`status: "loaded"`, `drawn` a dictionary, `loads == 1`), in every one of the 40 openings. No glyph was needed. The oracle derives which icons each context must mount
and which asset each is from the game's own snapshot, not from the HUD. Icon testIDs end in `-icon` and are left out of the lists of actions in both the probe and the
oracle.

### The lane of slice 2b

`npm run test:civ-lite-ui` adds the third probe (41 checks; 49 in the headed run, which adds seven captures and the comparison of the last cycle's pictures with
the first's), the oracle with 38 mutated reports rejected, and the 23 cases of the scan (21 changes found, 2 let through). The causal control is `e108e9d` (the HUD and the game of slice 2a, with
the manifest of that commit): its scan finds `AppRegistry` and nothing else, and its probe fails exactly the three checks about icons, because it has none; it leaks
nothing. Five sabotages join the twelve, all rejected with the sources restored byte for byte: `close-leaks-connection` (the store opens a connection on every
`clear_selection` and keeps it: leak and heap), `modal-stays-mounted` (the city's Modal gated on the city existing: a Window that stays and blocks the map),
`focus-grabbed` (a Control of the World takes the focus when an overlay opens: focus), `icon-missing` (an asset that is not there: the Image fails with its error,
not by timeout) and `import-outside-manifest` (a `TextInput` import: only the scan sees it).

The captures of the headed run: the bar, the actions and the city screen with their icons, and the city screen and the dialog in the first and the last cycle. The
city screen's two are the same bytes. The dialog's differ only in the first row of the bar, because that game's epoch is 6 in the first cycle and 25 in the last,
and the digits move what is to their right; the probe compares the two pictures in the engine, pixel by pixel, with that row masked, and finds none different.

### The turn lane after the icons

The icons add native views to every context (three in the bar, then those of the actions, the tile card and the city screen), so the native-view counts that
`docs/research/frontier-turn.md` records for the 19-click tour are not the ones of the current HUD. Read from the report of the turn lane on `0a0deca`: `none` 14 → 17,
`tile` 18 → 21, `warrior` 24 → 30, `stack` 26 → 33, `settler` 27 → 34, `dialog` 28 → 31 and `city` 47 → 55 (the eight of the city are the three of the bar and the five icons inside the
Modal). The lane judges a context against itself and passes, and whoever runs it again re-records the tables.

### Limits

- Local macOS arm64; the hosted run of this slice exists only after it is on main. Hosted CI runs the lane headless, without controls (a shallow clone), captures or sabotages.
- The heap's noise on a hosted runner was not observed; the rule is the baseline's, which tolerates the band seen there. The engine's object count has a limit of one.
- Escape was pressed as a key event through the viewport (the way `tests/modal-host-probe.gd` does), not by a physical keyboard.
- Focus is what the host can say (above); React Native focus does not exist in the 0.5.
- The icons are drawn for this app: they say nothing about image formats the host refuses (GIF) or about network images, which are out of the 0.5.
