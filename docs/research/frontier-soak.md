# The Frontier soak: 100 turns in three processes, a paused game and a panel that is unmounted or hidden

Status: implemented and executed locally on macOS arm64 (Apple M3 Pro, the headless display server) against pinned RN 0.87.1, Hermes 250829098.0.17 and official Godot 4.7.2, for the
`soak` criterion of V05-06 in the 0.5 Frontier milestone. It plays the Frontier game for 100 turns in three Godot processes through the typed services, and decides between unmounting
a heavy panel and keeping it hidden, from the numbers. The `turno` and `congelado` criteria of V05-06 are open (see [What is left](#what-is-left)), and so are hosted CI and the Pages
publication. The slice changes no C++ and no HUD of the game: the decision is a recommendation for V05-05, written here and not applied. The [evidence record](../evidence/frontier-soak/README.md) pins the execution, the numbers
and the sabotages at commit `dd67671`.

## The question

The criterion (`dashboard/migration.json`, V05-06, `soak`): "Soak de 100 turnos em 3 execuções: hash final idêntico, nós e RSS estáveis, 0 erros JS não tratados; pausa do jogo mantém a UI
viva; decisão escrita entre montar e desmontar ou manter oculto, com base nos números". The baseline ([frontier-baseline.md](frontier-baseline.md)) measured one panel swap; the services
([frontier-services.md](frontier-services.md)) made the end of a turn an accepted job. This slice runs the whole game for as long as a session lasts, and asks four things of it that a single
swap cannot show: that it is the same game every time, that nothing grows, that the HUD survives the game being paused, and what it costs to keep a big panel around when it is closed.

## Sources

- [performance.md](performance.md) (GF-30) and [frontier-baseline.md](frontier-baseline.md): the harness this extends. `tests/performance-sampler.gd` takes the reading (the engine's counts, the resident
  memory and Hermes' heap after a forced collection) and is preloaded, not copied; the heap at rest is judged by `heapAtRest` of `tests/frontier-baseline-oracle.mjs` (the median of the last half of the
  steady rounds against the first, over `HEAP_STEADY_GROWTH_LIMIT_BYTES` = 2,048 bytes, `tests/performance-cases.mjs:22`), imported and not rewritten; `REST_FRAMES` (30) and the warm-up (2) are the baseline's.
  The baseline's finding that `display: none` mounts no native node on this host and `opacity: 0` keeps the nodes is what makes the hidden strategy `opacity` and `pointerEvents`.
- [frontier-services.md](frontier-services.md), `consumers/civ-lite/services/game_services.gd` and `consumers/civ-lite/ui/frontier-types.ts`: the node, the typed calls and snapshot, and the job. The node
  advances the job in its own `_process` (`game_services.gd:175`), so it follows the game's clock and stops while the tree is paused (said there; measured here). [frontier-game.md](frontier-game.md): the
  intents, the refusals, the seven contexts and the canonical serialization and its SHA-256.
- `native/fabric_application.cpp:111` (`set_process_mode(PROCESS_MODE_ALWAYS); set_process(true)`) and `:255` (`_process` pumps the runtime): the application processes whatever the tree's pause, as
  [app-state.md](app-state.md) says (line 104: `SceneTree.paused` is not the application's lifecycle). `native/fabric_surface.cpp:155` and `:163`: the Surface hears the pointer in `_input` and claims it in
  `_unhandled_input` ([world-input.md](world-input.md), a2); a Surface under a layer that pauses with the tree hears no pointer (measured below, by the `pause-kills-ui` sabotage).
- `native/game_service_registry.cpp:714`: the registry's snapshot reports `subscriptions`, the exact count a connection that is never removed would raise. `native/application_runtime.cpp:852`: an error the host
  catches is kept in the application's `errors` and pushed as `FABRIC_ERROR`.
- `docs/GAME_SERVICES.md` (the accepted job that survives its screen), `tests/frontier-services-probe.gd` (the laboratory scene of a consumer: the game node, the stand-in of the addon's application node and a
  Surface) and `tests/frontier-baseline-probe.gd` (the readings at rest, the checks and their oracle), the patterns this follows.

## The scene

The probe (`tests/frontier-soak-probe.gd`) builds the scene in code, as the services probe does: a `FrontierSoak` node with the pointer spike's world (`examples/world-input/world.tscn`, unchanged), the
`GameServices` node with its `fabric_api` injected and a child `Application` that emits `runtime_available` while it enters the tree (the stand-in of `sdk/addon/application_node.gd`, which creates the
`FabricApplication` with the bundle of `tests/frontier-soak-fixture.jsx`), and a `CanvasLayer` after the world with one full-screen `FabricSurface` (800 x 600, `mouse_filter` IGNORE, topology (a) of the
pointer spike). The world is there for the a2 measurement below, not for the game: the game is the node's. The layer is `PROCESS_MODE_ALWAYS`, which the pause needs (below).

## The player and the HUD

A scripted player in the fixture plays the game through the services, one intent at a time, deciding from the snapshot it holds. Its rule is fixed and uses nothing the game does not show (no `Math.random`,
no `Date`):

1. If an event blocks the game, resolve it with its first choice, and again for as long as the dialog stays open: since the queue of three events of 2026-10-09 the game raises three together when turn 5 begins, so turn 5 opens with three answers (wanderers with `welcome`, traders with `buy_grain`, the scholar with `host`).
2. Turn 1 only, with no city: select the start tile (6, 8), which stacks the Settler and the Warrior (the one fact of the map the snapshot does not show until a tile is selected), select the action "Select Settler"
   and found the city, which the snapshot offers as enabled.
3. Every turn, each step once and in order: set the research to the first enabled technology of the snapshot's list if it is empty; set the production to a building if one is enabled, else to a Warrior while fewer than
   6 units stand on the city tile, if the queue is empty; select the city tile; select the first unfortified unit on it and fortify it; select the empty tile west of the city; clear the selection; end the turn.
4. It waits for each call to settle and for the snapshot it published to arrive before it decides again, and for the turn's job to finish (`last_job`) before the next turn.

Every call is one the snapshot offers as enabled, so the game accepts all of them: 429 decisions in a run, 429 accepted (201 `select_tile`, 100 `clear_selection`, 100 `end_turn`, 8 `set_production`, 7 `select_unit`,
6 `fortify`, 3 `set_research`, one `found_city` and three `resolve_event`; 427 and one `resolve_event` before the queue of three events). The cap of 6 units keeps the game's own state bounded: the last production decision is at turn 13 (three buildings and five Warriors in all), the army
is at its 6 units from turn 13 and the last `fortify` is at turn 14, so from turn 14 the player does the same four things every turn (select the city, select the tile, clear, end the turn) and the state moves only by the turn,
the scripted faction's walk and the log (capped at 32). That is deliberate: a heap that grows because the game does would be a verdict on the army and not on the runtime, and the heap rule is exact. The game has no ending, so it
cannot end before turn 100 and no rule was invented to stop it.

The HUD (`SoakHud`) is a function of the snapshot and two switches: a bar with the turn and the three stocks; a button that opens and closes the heavy panel; a button that toggles a marker (one native node, which the pause lane
clicks); one button for each action of the snapshot, and the event's dialog when there is one. The heavy panel is the baseline's research panel (a root, a header and 49 chips of two nodes: **100 native nodes**), its body memoized,
so closing it changes the panel root's props and re-renders nothing below. Its native nodes at rest follow from the state: 14 fixed, 2 for each action, 7 for the dialog (a View, two Texts and a Pressable with a Text for each of its
two choices), 1 for the marker and, for the panel, 100 while it is mounted. The oracle derives every count from that formula and not from the probe.

| Context at rest | Native views | Why |
| --- | ---: | --- |
| `none` | 16 | the 14 fixed and the one action (`end_turn`) |
| `tile` | 18 | plus `clear_selection` |
| `city` | 18 | the same two actions |
| `warrior` | 20 | `fortify`, `clear_selection`, `end_turn` |
| `settler`, `stack` | 22 | four actions: `found_city`, `fortify`, `clear_selection`, `end_turn` for the first; two `select_unit`, `clear_selection`, `end_turn` for the second |
| `dialog` | 23 | the 16 of `none` plus the dialog's 7 |

(All with the panel unmounted and the marker off; hiding keeps the panel's 100 on top of each.) The player visits the seven contexts of the game: `dialog` is the context of the rest at the end of turn 4, because the events are
raised when turn 5 begins.

## What is judged, and the rules

The probe takes a light reading after every intent that changes what is selected, once the application has been quiet for 6 frames (the engine's nodes, Godot's node monitor, the orphans, the host's native views,
the registry's subscriptions and errors, the HUD's state): 529 a run. It takes one full reading at rest per turn, after `REST_FRAMES` (30) idle frames: the same plus the resident memory and Hermes' heap after a forced
collection, 100 a run. The checks hold at any pace of the machine; the probe has 34 and the independent oracle (`tests/frontier-soak-oracle.mjs`) recomputes them from the raw report.

| Criterion | Rule | Where it comes from |
| --- | --- | --- |
| Same game | the SHA-256 of the canonical serialization at the end of every turn, the final hash and the hash of the trail (the SHA-256 of the 100 turn hashes, one per line) are identical in the three executions; the oracle recomputes each turn's hash from its serialization and reads the state (turn, phase, one city, at most 6 units, the event resolved from turn 5) from it | the criterion: "hash final idêntico" |
| Godot nodes and orphans | at every reading the SceneTree's nodes and Godot's node monitor are the host's native views plus a constant (9), in one root, with no orphan beyond the base's (0) | exact, as the baseline |
| Native views | at every reading, and at every rest, they are the HUD's formula of the state (above): **equal every time the same context comes back** | exact |
| Hermes heap at rest | `heapAtRest` (imported): the median of the last 49 of the 98 steady turns less the median of the first 49 is at most 2,048 bytes, after a forced collection; the first 2 turns are the warm-up | the GF-30 limit |
| Resident memory | the median of the last half of the steady turns less the median of the first is at most **48 MiB (49,152 KB)**; recorded every turn | a coarse guard, see below |
| Unhandled errors | the application's and the registry's `errors` are 0 at every reading; JavaScript's tracker of unhandled rejections saw 0; no `FABRIC_ERROR` in the log | exact |
| Subscriptions | the registry holds 2 subscriptions (the application's) and 15 bindings at every reading (14 when the soak was pinned at `dd67671`; the pointer's state `frontier.hover` of V05-05 slice 1, #82, made it 15, and nothing else of the soak moved) | exact |
| The job | every turn's job published seven snapshots in seven consecutive frames and one `turn_ended` between the sixth and the seventh; the ids rise by one | exact |

The pinned run, in the three executions (the strategy the panel is closed with, the seconds each took, the hash of the game after turn 100 and the heap and resident memory at rest as the medians of the first and last half of the steady turns):

| Execution | Strategy | Seconds | Final hash | Heap, first / last half (bytes) | Resident memory, first / last half (KB) |
| ---: | --- | ---: | --- | ---: | ---: |
| 1 | unmount | 67.0 | `a35c55f2def40a3bc6e78ac762ff47aaf27459a4fd0fdc7095dc5107c88de598` | 2,117,320 / 2,117,320 | 204,384 / 107,856 |
| 2 | hide | 66.6 | the same | 2,443,832 / 2,443,832 | 186,160 / 170,400 |
| 3 | unmount | 66.9 | the same | 2,117,320 / 2,117,320 | 194,384 / 156,864 |

The trail hash (the SHA-256 of the 100 turn hashes, one per line) is `fe9d4f367b796b2743118aa37755c92541e88d5a7155ed0ac0d24eefd0b16e0f` in all three, and so is the hash of every turn. The game ends at turn 101 with the one city
(size 3, the three buildings), six units of the player and the scripted faction's Warrior, 333 events logged.

**The resident memory** moves by tens of MB and falls as well as rises (GF-30 saw 90 to 188 MB across its soaks), so it cannot be an exact limit. Within one execution of the pinned run the resident memory of the steady turns spans a band
of 136, 34 and 89 MB (104 to 240, 162 to 195 and 152 to 241 MB), and the medians of the two halves differ by **-96.5, -15.8 and -37.5 MB**: it fell in all three, as it did in the development runs where the OS compressed the process as it went.
Over the four runs of this code that were made, with 12 executions in all, the half-to-half difference went from -96.5 to **+10.1 MB** (the other runs: +10.1, -1.4 and +1.2; -0.6, +5.4 and -2.4; -84.3, +2.3 and -12.7), and the band within a run from 34 to 137 MB. The
rule asks of the last half only that it be at most **48 MiB** above the first; it judges a trend and not a level, and it is a coarse guard: **the heap rule is the leak detector**, and the resident memory is there to catch what the
heap cannot see (native memory that grows while the JavaScript heap does not). The limit was first 16 MiB; the largest rise seen locally was +10.1 MB, which a hosted runner's noise could pass, and a check must not depend on a
runner's noise, so it was raised to 48 MiB. A sustained leak of about 1 MiB a turn over the 49 turns that lie between the two medians (about 49 MiB) still fails; a finer leak does not, and belongs to the heap rule (which judges the JavaScript
heap, not native memory, so a native leak under 1 MiB a turn is not seen by either). The measure includes the probe's own bookkeeping (Godot's static memory grew from 27.2 to 36.8 MB in the run, the readings the probe keeps, recorded and
not judged). A rise of exactly the limit passes, one KB more fails, a rise of 30 MiB passes and a synthetic ramp of 1 MiB a turn fails, all tested on synthetic series.

**The heap** was flat to the byte once the game stopped changing: 2,117,320 bytes at rest from turn 14 to turn 100 in the unmounting executions and 2,443,832 in the hiding one (growth 0 between the medians of the halves).
Two things were learned to get there. First, the heap at rest has a **step the first time the marker is clicked** (1,744 bytes with unmounting and 2,360 with hiding, in development runs of a first version that did not warm it
up, not retained; the retained runs have none): the first press of a button and the first mount of the marker run code for the first time, and code that Hermes compiles lazily and keeps in the heap is the suspect (the cause was
not isolated; the warm-up removed the step).
With the pause in the middle of the soak, that step fell between the two halves and failed the rule on a run that leaked nothing, so the probe clicks the
marker twice in the second turn (a warm-up turn), as the baseline warms its swaps up, and the pause lane's clicks at turn 50 add nothing (the heap at turn 50's rest dips 7,896 bytes below the floor and is back at the floor
the turn after). Second, the dialog turn's rest holds the dialog in the JavaScript tree (+34,208 bytes at turn 4 only); it is one turn in the first half and the median does not see it.

## The pause

At turn 50 the probe sets `paused = true` **in the frame it sends the end of the turn**. The call is a task of the registry, which the `FabricApplication` runs because it always processes
(`native/fabric_application.cpp:111`), so the job is accepted (job 50, answered on acceptance, the snapshot `ai_plan` published) and the node that advances it, a pausable child of the root, does not run. Held for 60 frames:

- **the phase does not advance.** The game is at `ai_plan`, job 50 is still the job in progress, no snapshot but the acceptance's is published and no `turn_ended` arrives. The application pumped 60 times in the 60 frames.
- **the UI answers.** The probe injects a click on the marker's button through the pointer spike's injection; it reaches the handler (the fixture's click counter goes from 2 to 3), React changes its state and the marker is a
  native node in the Surface's snapshot; a second click removes it (counter 4). The HUD works as far as the game is paused.
- **the job finishes after the game resumes.** Seven snapshots and one `turn_ended`, turn 51, `last_job` 50; the first snapshot is 78 frames before the second (the 60 paused frames and the lane's clicks).

**What keeps the UI alive is the application and the scene's owner together.** The `FabricApplication` processes with the tree paused, so React's state, the commits and the mounts go on. The pointer does not: the Surface hears it in
`_input`, and a node whose process mode is the default is paused with the tree. The probe's `CanvasLayer` is `PROCESS_MODE_ALWAYS`; the retained sabotage `pause-kills-ui` makes it pausable and the click never reaches the handler
(below). `consumers/civ-lite/main.tscn`'s `HUDLayer` does not set a process mode, so a game that pauses with `get_tree().paused` must mark the HUD's layer `PROCESS_MODE_ALWAYS` or its HUD will not hear a click. That is a finding
for V05-05, who owns that scene; this slice does not touch it.

## Mounting or hiding a panel

The same 100-node panel opens and closes once a turn, by a real click on its button, in the city context, in two ways: **A (unmount)** renders it only while it is open; **B (hide)** keeps it mounted and, closed, gives its root
`opacity: 0` and `pointerEvents="none"`. (`display: "none"` mounts no node on this host, so it would be A under another name; the `leaky-hide` sabotage is exactly that.) Three executions, A, B, A; every number
is the median over the 98 steady turns of an execution, and over the two of A. The CPU is the time of the click's injection and flush, where the host handles the pointer event, React renders and commits and the host
mounts (as in the baseline), on an unpaced headless loop: **the CPU cost of the work and not a frame time**, on a Mac with other agents' suites running. The durations move by tens of percent from one run to the next, so the table is the
pinned run ([evidence](../evidence/frontier-soak/README.md)) and only the differences that held in every run are conclusions. The four runs of this code that were made:

| Run | A open, p50 / p95 | A close, p50 | B open, p50 / p95 | B close, p50 |
| --- | ---: | ---: | ---: | ---: |
| earlier 1 | 9.4 / 18.1 ms | 2.7 ms | 7.0 / 10.2 ms | 7.3 ms |
| earlier 2 | 12.4 / 20.2 ms | 3.8 ms | 7.9 / 10.6 ms | 7.4 ms |
| earlier 3 | 16.7 / 20.7 ms | 5.1 ms | 9.2 / 10.8 ms | 8.8 ms |
| **pinned** | **14.2 / 18.8 ms** | **5.2 ms** | **9.0 / 11.3 ms** | **8.9 ms** |

| | A: unmount | B: hide |
| --- | ---: | ---: |
| Native views, panel closed (city context) | 18 | 118 |
| Native views, panel open | 118 | 118 |
| Open: host nodes created / deleted / updated | 100 / 0 / 1 | 0 / 0 / 101 |
| Close: host nodes created / deleted / updated | 0 / 100 / 1 | 0 / 0 / 101 |
| Open, CPU of the click, p50 / p95 / max | 14.2 / 18.8 / 27.4 ms | 9.0 / 11.3 / 12.1 ms |
| Close, CPU of the click, p50 / p95 / max | 5.2 / 6.4 / 7.3 ms | 8.9 / 11.5 / 12.0 ms |
| Open and close, p50 added | 19.4 ms | 17.9 ms |
| Live heap at rest, panel closed | 2,117,320 bytes | 2,443,832 bytes (**+326,512**) |
| Resident memory at rest, median of the steady turns (a noise band of 34 to 137 MB in a run) | 156 and 157 MB | 172 MB |
| The world hears a click where the closed panel stands | 100 of 100 turns | 100 of 100 turns |
| The world hears a click where the open panel stands | 0 of 100 | 0 of 100 |

**The effect on a2.** An open panel claims the map, as a2 says (the Surface marks the event handled when React Native's hit test finds a View there): the world hears no press where the panel stands in 100 of 100 turns.
A closed panel does not, in either strategy: with `pointerEvents="none"` on its root the hit test finds nothing, and the world hears the click in 100 of 100 turns. (Whether an `opacity: 0` panel **without**
`pointerEvents="none"` claims the map is not measured here.)

**What the numbers say.**

- **No consistent CPU advantage for either strategy was observed; the whole-cycle comparison is inconclusive.** Hiding saves 5.2 ms at the median on the open (the mount of 100 nodes is gone) and pays 3.7 ms more on the close; opening and
  closing once costs 17.9 ms hidden against 19.4 ms unmounted in the pinned run, and 14.3 against 12.1, 15.2 against 16.2 and 18.0 against 21.8 in the earlier ones: the sum is inside the run-to-run noise of a shared machine and the sign of the
  difference changed between runs, so the data neither show that hiding is cheaper nor that it is not. The host updates all 101 nodes of the panel each time it is toggled (the counters above; the cause is not investigated here), so the cost
  of a toggle follows the panel's size, as the mount's does.
- What was stable in all four runs, on the CPU side, is two asymmetries. Hiding has a **shorter tail on the open**, the click that the player waits for: the p95 of opening is 11.3 ms against 18.8 in the pinned run (10.2 against 18.1, 10.6 against
  20.2 and 10.8 against 20.7 before); mounting 100 nodes has a tail (the maximum was 27.4 ms in A and 12.1 in B in the pinned run) and updating a mounted panel has much less of one. And hiding has a **close about twice as costly**: 8.9 ms against 5.2
  at the median in the pinned run, 1.7 to 2.7 times in the four.
- What it costs is **memory that never goes back**: 100 native nodes, 326,512 bytes of live heap (the panel's fibers; the JavaScript tree stays) and the same again for every panel kept hidden, for as long as the screen lives.
- The soak's open of this panel (p50 14.2 ms, p95 18.8 in the pinned run) is longer than the baseline's for the same 100 nodes (p50 9.2, p95 12.4) at the median in three of the four runs and in the tail in all four, with a bigger HUD around it and on a
  loaded Mac: the baseline's proposed bound for it (16 ms at p95) would not hold here. That is an observation for the freeze, not a result of this slice.

**Decision (a recommendation for the HUD of V05-05, which this slice does not change): unmount by default and hide a panel only when all three hold.** The default rests on what was stable in every run and does not depend on the inconclusive CPU
sum: a hidden panel keeps its 100 native views and 326,512 bytes of live heap for as long as the screen lives, and an unmounted one keeps none. What hiding offers in return (the shorter open tail) is what the three conditions weigh against that
cost, together with its close that is about twice as costly.

1. **Size.** The panel is on the order of 100 native nodes or more. A 50-node panel mounts in 5.1 to 6.2 ms at the median (baseline), and there is no tail worth 50 permanent nodes.
2. **Frequency and latency.** It is opened often and on the click that the player is waiting for, so that the p95 of its open matters more than the memory and than the slower close (which can wait for a frame). A panel opened once or
   twice a session is unmounted.
3. **Budget.** At most one or two panels are kept hidden at a time: each holds its nodes and about 330 KB of heap for the life of the screen (six hidden panels of 100 nodes would be 600 nodes and about 2 MB). The hidden panel must have
   `pointerEvents="none"` on its root or it claims the map, and its body must not depend on whether it is shown (the fixture memoizes it); a first version without the memo re-rendered the 100 chips on every toggle, which in a development run
   (not retained) put 7.9 ms of JavaScript in a 12.3 ms open.

For the 0.5 HUD that means the six panels (50 to 100 nodes) are unmounted when closed; if the freeze finds the 100-node research panel's open over its budget at p95, that one panel is the candidate to hide. The numbers here
are one machine, one panel shape and a headless loop; the iPhone and the presented frame time are open and may move the line (a device with less memory weighs the nodes and the heap more).

## The retained sabotages

`node scripts/frontier-soak-sabotage.mjs` breaks one source at a time through `scripts/sabotage-sources.mjs` (restored byte for byte, proven by hash, whatever ends the run), runs the suite on it
(`tests/frontier-soak-native.test.mjs --sabotage=<name>`) and requires the probe's checks and the oracle to reject it, the oracle for the reason the variant was written for. The file of each variant's verdict is deleted before it runs and a
missing file counts as not rejected. A last run of the genuine source follows.

| Variant | What it breaks | Probe | Oracle |
| --- | --- | --- | --- |
| `listener-leak` | the fixture connects to `frontier.snapshot` again at the end of every turn and never removes the connection | 2 checks: the registry holds the same number of subscriptions at every reading, and the heap at rest | "The live heap at rest rose 335128 bytes from the median of the first half (49 rounds)": the connections add up (and the registry's subscriptions grow by one every turn) |
| `nondeterministic-player` | the player skips the production decision of a turn at random (`Math.random`), two processes | none: each game is legal, and the probe sees one | "Execution 2: the final hash is the first's" |
| `pause-kills-ui` | the probe's HUD layer is pausable instead of `PROCESS_MODE_ALWAYS` | 2 checks: the HUD's layer is `PROCESS_MODE_ALWAYS`, and the HUD answers while the game is paused | "The HUD answered while the game was paused: each click reached its handler once": the click never reaches the handler and the marker never mounts |
| `leaky-hide` | the hidden strategy hides with `display: "none"` instead of `opacity: 0` | 2 checks: opening a hidden panel creates and deletes no node, and closing it keeps its nodes | "base: the HUD holds the native views its state gives (context none, 1 actions, panel closed)": the "hidden" panel holds none |

The oracle is also tried on a recorded report changed in 25 ways that it must reject for the reason each is written for (a node, an orphan or a native view that drifts, a hidden panel counted as unmounted, a heap that grows by 3,000
bytes, by 2,049 and by 200 bytes a turn, a resident memory that grows by the limit plus 4 MiB, by the limit plus 1 KB and by 1 MiB a turn, a refused intent, an unhandled rejection, a handler that sees nothing, a subscription that is never removed, a job that finishes twice, a phase that
advances in the pause, a UI that does not answer, a marker that never shows, a pause too short, no warm-up, a closed panel that claims the map, an open panel that does not, a forged hash, an aborted soak, a hidden panel that
deletes nodes), in three ways that fork two executions, and in one that makes the hidden panel hold no more nodes than the unmounted one; and must accept five that are not a leak (a single transient of 2,056 bytes in the last
reading, a rise of exactly the 2,048-byte limit, a resident memory that falls by 30 MiB, one that rises by 30 MiB and one that rises by exactly 48 MiB).

## What is left

- **`turno`** (V05-06): the latency of a click to its panel, the frame time in a turn with the sliced AI, and the heap, resident memory and native nodes per transition **on the game's consumer** are not measured here. This slice
  runs the turn's job and a panel's click, not the playable HUD.
- **`congelado`** (V05-06): the freeze of the thresholds. The soak records but does not propose a bound; the open of the 100-node panel (p95 18.8 ms in the pinned run, 18.1 to 20.7 in the three before) is an input to it.
- V05-05's HUD takes the decision above and the finding about the process mode of its layer; this slice changes neither `consumers/civ-lite/ui/` nor its scene.

## Limitations and open

- One machine (an Apple M3 Pro), the headless display server and the `opengl3` driver named; the Mac was loaded by other agents' suites, so the durations are not a best case. The durations are the CPU cost of work on a loop nothing
  paces and are not frame times; the presented frame time is the baseline's windowed lane, still pending. Only the exact counts are asked of a hosted runner.
- Synthetic events through `Input.parse_input_event`; no hardware pointer, no touch screen, no iPhone, no mobile export. The pause is `SceneTree.paused`, not the application's lifecycle (the background of a phone).
- The HUD is a fixture, not the Frontier HUD (V05-05 is open): one heavy panel of one shape (100 nodes of `View` and `Text`), no images, scroll views, text inputs or animations. The player is one fixed rule over a game that
  stops changing after turn 14: it exercises the turn's job, the services and a changing snapshot for 100 turns, not an economy that keeps growing, and not the 64-task and 128-event budgets (the services' stress case does).
- Hermes' tracker of unhandled rejections reports from a timer and not at the rejection (a first version of the control waited 6 frames and saw nothing), so the soak reads the count after waiting 2.3 s and its control is a
  `TypeError`, reported sooner than an `Error`. This runtime has no `ErrorUtils`: an exception the host catches lands in the application's `errors`, which every reading checks, and nothing else is watching for one
  thrown where the host cannot see it. The control proves the tracker can see a rejection; it does not prove there is no other kind of failure.
- Why the host updates all 101 nodes of a hidden panel when its root's `opacity` and `pointerEvents` change, and whether a cheaper way to hide one exists (one prop at a time, another structure), is open: the soak measured the
  strategy it was given (both props, which the map needs) and not its alternatives, and a cheaper hide would move the decision above.
- The resident-memory rule is a coarse trend (48 MiB over a band of 34 to 137 MB) and blind to a slow leak, native included, under about 1 MiB a turn; it is what a hosted runner's noise allows, not a claim that the process does not grow.
- Hosted CI is pending: the suite is in the native job of `contracts.yml` and takes about 3.5 minutes locally (about 67 seconds an execution).
- The compatibility documents (`docs/compatibility/react-native-0.87.1.json`, `BASELINE.md`), `docs/API.md`, `docs/NATIVE_MODULES.md` and `docs/PARITY.md` do not apply: the slice adds no RN name, public API or native module.
- The previous-host control does not apply: nothing in C++ changed. The four retained sabotages are the control.

## Reproducing

```sh
npm run test:frontier-soak                       # three executions of 100 turns (about 3.5 minutes), the oracle, the report-level negatives, the decision's table
node scripts/frontier-soak-sabotage.mjs          # the four retained sabotages and a last genuine run, sources restored byte for byte; run nothing else meanwhile
```

The first command bundles the HUD (`build/frontier-soak-probe.js`) and runs the probe in three Godot processes (`--strategy=unmount`, `hide`, `unmount`); it leaves the raw reports in
`build/frontier-soak-current-<n>-report.json` and the comparison, with the decision's table, in `build/frontier-soak-comparison.json`.

## After the queue of three events (2026-10-09)

The game this lane plays changed after the record above: by the user's decision of 2026-10-09 the one event became a queue of three (`docs/research/frontier-game.md`, "Events"), raised together when turn 5 begins. The soak's
player, probe and fixture did not change (the fixture already answered the head of the dialog while it was open), but the **oracle** wrote the one event as a fact: one `resolve_event` in turn 5, once and in the routine's order, and
`state.event.resolved`, which no longer exists. On the merge of main into the branch of that change the lane failed there (`turn 5: resolve_event(buy_grain) is a step of the routine, once and in its order`), and
`tests/frontier-soak-oracle.mjs` now says what the contract is: turn 5 opens with exactly three `resolve_event` calls made in the dialog context, answering `wanderers` with `welcome`, `traders` with `buy_grain` and `scholar` with `host` (the
table is written again in the oracle, not read from the game); no other turn has one; the state that turn 5 begins from holds the three ids in the queue, and from turn 5 on the game records the three answers in that order with the
queue empty. Nothing was relaxed: every other check of the oracle is untouched, and two exact ones replace the weaker ones. The lane then passed, with the game at its new hashes (final `0b21c332…`, trail `4d6d3c4c…`; they were
`a35c55f2…` and `fe9d4f36…`), 429 decisions and 1,030 snapshots a run, and the lane's exact rules for nodes, heap and memory hold (the heap at rest is 2,117,992 bytes; it was 2,117,320). The record under `docs/evidence/frontier-soak/` keeps describing the run it was made from.
