extends Node

# The turn of the Frontier game, measured on the game as a consumer has it (V05-06, criterion `turno`): the provisioned civ-lite project, its
# main scene as the template ships it (the GameServices node, the World, the HUD's Surface), with this probe added to the root by
# frontier-turn-runner.gd. Nothing of the template or of its HUD is changed: the probe drives the real scene with real pointer events through
# the viewport, on the device of the validation (consumers/civ-lite/hud_validation.gd does the same), and reads what the HUD mounted.
#
# A round is a tour of 19 clicks over a new game (prepared through the services, not measured): a tile of the map, the buttons of the actions
# panel, the Close of the city screen, the End turn of the bar four times and the answers to the three events of the queue. It visits all seven
# contexts of the game, and every transition is one click. The city screen and the event dialog are blocking Modals (consumers/civ-lite/ui/hud/overlay.tsx):
# their Controls are children of the Modal's own Window, which `hud.find_child` does not reach, so the probe finds what the HUD mounted and where to click in the
# Surface's snapshot, as consumers/civ-lite/hud_probe.gd does, and no click on the map or on the bar is made while one is open (the Modal would take it). For each click the probe records the frames and the time from the injection to the moment the HUD shows the panels of the context the
# click leads to, the intent the click made and whether the map heard it. After REST_FRAMES idle frames it takes a reading at rest with the shared
# sampler (tests/performance-sampler.gd, the GF-30 reading): the engine's counts, the host's native views, the resident memory and Hermes' heap
# after a forced collection. The End turn clicks also record every frame of the turn: the phase, the interval between frames, the snapshots and
# `turn_ended` published in it, and the host's pump and its JS, mount and layout phases around the turn.
#
# This is the headless lane. It judges only what holds at any pace of the machine, exactly: the panels of each context, the intent of each click,
# the native views of each context, the nodes and orphans, one phase of the turn per frame, `turn_ended` once, the errors and the heap at rest. What depends on the pace
# is recorded and never judged: the frames a click takes (judged only against a ceiling on a stall), the durations, the host's phases and the resident memory.
# Headless nothing paces the loop and nothing is drawn (docs/research/frame-clock.md), so the durations are the cost of the CPU work on an unpaced
# loop and not a frame time: the frame time is the windowed lane's (--lane=windowed, scripts/frontier-turn-graphics.mjs).
#
#   --lane=headless|windowed|captures   what the run does (the default is headless)
#   --run=<n>                           the number of the run, for the windowed lane
#   --rounds=<n>                        steady rounds, for a quick look (the oracle refuses any other number than the cases')
#   --sabotage                          a retained sabotage runs this probe: a failed check is the rejection, not an error
const Sampler := preload("performance-sampler.gd")
# The template's own validation, in the provisioned project: the table of contexts to panels, the panels, the device the Surface hears, the size of the viewport and the map's
# geometry are written there and nowhere else, and the probe reads them from it.
const HudValidation := preload("res://hud_validation.gd")

const REPORT := "res://frontier-turn-report.json"
const CAPTURES := "res://frontier-turn-captures"
# The experiment, as tests/frontier-turn-cases.mjs states it (the oracle checks that the probe ran these).
const DEVICE := HudValidation.DEVICE
const SIZE := HudValidation.SIZE
const MAP_ORIGIN := HudValidation.MAP_ORIGIN
const MAP_TILE := HudValidation.MAP_TILE
const WARMUP_ROUNDS := 2
const ROUNDS := 30
const REST_FRAMES := 30
const STABLE_FRAMES := 6
const IDLE_FRAMES := 600
const CLICK_FRAME_LIMIT := 10
const TURN_FRAME_LIMIT := 40
# The frames the click waits after the panels show before it reads anything, so that the read is not inside the frames it measures.
const TRAILING_FRAMES := 2
# Bounds on a wait for a state, never a measure.
const WAIT_FRAMES := 300
const FRAME_LIMIT := 600
# The limits of the GF-30 harness (tests/performance-cases.mjs) and of the soak's rule for the resident memory (tests/frontier-soak-cases.mjs).
const HEAP_GROWTH_LIMIT_BYTES := 2048
const RSS_GROWTH_LIMIT_KB := 48 * 1024
# How long Hermes' tracker may take to report a promise rejected with no handler (2000 ms for an Error), and a little more.
const TRACKER_DELAY_MS := 2300
const VSYNC_NAMES := ["disabled", "enabled", "adaptive", "mailbox"]
const PANELS := HudValidation.PANELS
const TABLE := HudValidation.TABLE
const MARKERS := {"stack": "hud-actions-select_unit-2", "settler": "hud-actions-found_city-1", "warrior": "hud-actions-fortify-2"}
const PHASES := ["ai_plan", "ai_move", "production", "growth", "research", "refresh", "idle"]
const STEPS := [
  {"id": "map-stack", "kind": "map", "tile": [6, 8], "from": "none", "to": "stack", "intent": "select_tile"},
  {"id": "select-warrior", "kind": "action", "target": "hud-actions-select_unit-2", "from": "stack", "to": "warrior", "intent": "select_unit"},
  {"id": "clear-selection", "kind": "action", "target": "hud-actions-clear_selection", "from": "warrior", "to": "none", "intent": "clear_selection"},
  {"id": "map-stack-again", "kind": "map", "tile": [6, 8], "from": "none", "to": "stack", "intent": "select_tile"},
  {"id": "select-settler", "kind": "action", "target": "hud-actions-select_unit-1", "from": "stack", "to": "settler", "intent": "select_unit"},
  {"id": "map-tile", "kind": "map", "tile": [9, 8], "from": "settler", "to": "tile", "intent": "select_tile"},
  {"id": "map-stack-third", "kind": "map", "tile": [6, 8], "from": "tile", "to": "stack", "intent": "select_tile"},
  {"id": "select-settler-again", "kind": "action", "target": "hud-actions-select_unit-1", "from": "stack", "to": "settler", "intent": "select_unit"},
  {"id": "found-city", "kind": "action", "target": "hud-actions-found_city-1", "from": "settler", "to": "city", "intent": "found_city"},
  {"id": "close-city", "kind": "overlay", "target": "hud-city-close", "from": "city", "to": "none", "intent": "clear_selection"},
  {"id": "map-city", "kind": "map", "tile": [6, 8], "from": "none", "to": "city", "intent": "select_tile"},
  {"id": "close-city-again", "kind": "overlay", "target": "hud-city-close", "from": "city", "to": "none", "intent": "clear_selection"},
  {"id": "end-turn-1", "kind": "turn", "target": "hud-bar-end-turn", "from": "none", "to": "none", "intent": "end_turn"},
  {"id": "end-turn-2", "kind": "turn", "target": "hud-bar-end-turn", "from": "none", "to": "none", "intent": "end_turn"},
  {"id": "end-turn-3", "kind": "turn", "target": "hud-bar-end-turn", "from": "none", "to": "none", "intent": "end_turn"},
  {"id": "end-turn-4", "kind": "turn", "target": "hud-bar-end-turn", "from": "none", "to": "dialog", "intent": "end_turn", "head": "welcome"},
  {"id": "answer-event-1", "kind": "dialog", "target": "hud-dialog-choice-welcome", "from": "dialog", "to": "dialog", "intent": "resolve_event", "head": "buy_grain"},
  {"id": "answer-event-2", "kind": "dialog", "target": "hud-dialog-choice-buy_grain", "from": "dialog", "to": "dialog", "intent": "resolve_event", "head": "host"},
  {"id": "answer-event-3", "kind": "dialog", "target": "hud-dialog-choice-host", "from": "dialog", "to": "none", "intent": "resolve_event"},
]
# The unhandled errors of the JavaScript side, which the host does not see: a global handler, where the runtime has one, and Hermes' tracker of
# promises rejected with no handler. The control is one rejection that nobody handles, so that "no rejection" can be told from "cannot see one".
const JS_PROBE := """
(function () {
  const faults = {global: 0, rejections: 0, last: "", handlers: {errorUtils: false, rejectionTracker: false}, control: {rejections: 0, armed: false}};
  const describe = error => String(error && error.message !== undefined ? error.message : error).split("\\n")[0];
  if (typeof globalThis.ErrorUtils === "object" && globalThis.ErrorUtils !== null && typeof globalThis.ErrorUtils.setGlobalHandler === "function") {
    globalThis.ErrorUtils.setGlobalHandler(error => { faults.global += 1; faults.last = describe(error); });
    faults.handlers.errorUtils = true;
  }
  if (typeof HermesInternal === "object" && HermesInternal !== null && typeof HermesInternal.enablePromiseRejectionTracker === "function") {
    HermesInternal.enablePromiseRejectionTracker({
      allRejections: true,
      onUnhandled: (_id, error) => {
        if (faults.control.armed) { faults.control.rejections += 1; return; }
        faults.rejections += 1;
        faults.last = describe(error);
      },
    });
    faults.handlers.rejectionTracker = true;
  }
  globalThis.FrontierTurnProbe = {
    engine() {
      const properties = typeof HermesInternal === "object" && HermesInternal !== null && typeof HermesInternal.getRuntimeProperties === "function"
        ? HermesInternal.getRuntimeProperties() : null;
      return {properties, hasHermesInternal: properties !== null};
    },
    faults() { return {global: faults.global, rejections: faults.rejections, last: faults.last, handlers: faults.handlers}; },
    control() { faults.control.armed = true; Promise.reject(new TypeError("frontier-turn control: an unhandled rejection")); },
    controlSeen() { return {rejections: faults.control.rejections, handlers: faults.handlers}; },
  };
  return "installed";
})()
"""

var lane := "headless"
var run_index := 1
var steady_rounds := ROUNDS
var sabotage := false
var services: Node
var application: Node
var hud: Control
var sampler: Sampler
var checks: Array = []
var stages: Dictionary = {}
var finished := false
# What the node published since the run began: the snapshots, the end of each turn and the summary of the last.
var snapshots_seen := 0
var turn_ended_seen := 0
var turn_ended_last: Dictionary = {}
# The time of every frame the windowed lane drew.
var draw_stamps: Array = []

func check(condition: bool, label: String) -> bool:
  checks.append({"name": label, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + label)
  return condition

func settle(count: int) -> void:
  for index in range(count):
    await get_tree().process_frame

func wait_until(condition: Callable, limit: int = WAIT_FRAMES) -> bool:
  for index in range(limit):
    if condition.call():
      return true
    await get_tree().process_frame
  return condition.call()

func count_snapshot(_snapshot: Dictionary) -> void:
  snapshots_seen += 1

func count_turn_end(summary: Dictionary) -> void:
  turn_ended_seen += 1
  turn_ended_last = summary

# The runner hands the probe the instance of the main scene; the run starts when the frame is over.
func start(scene: Node) -> void:
  services = scene
  for argument: String in OS.get_cmdline_user_args():
    if argument.begins_with("--lane="):
      lane = argument.get_slice("=", 1)
    elif argument.begins_with("--run="):
      run_index = int(argument.get_slice("=", 1))
    elif argument.begins_with("--rounds="):
      steady_rounds = int(argument.get_slice("=", 1))
    elif argument == "--sabotage":
      sabotage = true
  call_deferred("run")

# ------------------------------------------------------------------------------------------------ JavaScript
func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(" + expression + ")"))

func hud_stats() -> Dictionary:
  var value: Variant = js("FrontierHud.stats()")
  var out := {}
  if value is Dictionary:
    for key: String in ["calls", "resultCount", "problemCount", "snapshots", "hoverCount", "subscriptions", "context", "screen"]:
      out[key] = value.get(key)
  return out

# ------------------------------------------------------------------------------------------------ what the HUD mounted
# What the HUD holds, by testID, as the host reports it in the Surface's snapshot: the Control of each and the text the host drew in it. A Modal's Controls are children
# of the Modal's own Window, which `hud.find_child` does not reach, so the Controls are resolved from the snapshot's instance ids (consumers/civ-lite/hud_probe.gd does the
# same). One read of the snapshot serves every question a frame asks.
func mounted() -> Dictionary:
  var out := {}
  for entry: Dictionary in Sampler.surface_state(hud).get("nodes", []):
    var test_id := str(entry.get("testID", ""))
    if test_id == "":
      continue
    var control := instance_from_id(int(entry.id)) as Control
    if control != null and control.is_inside_tree() and not control.is_queued_for_deletion():
      out[test_id] = {"control": control, "text": str(entry.get("nativeText", ""))}
  return out

func is_mounted(id: String) -> bool:
  return mounted().has(id)

func panels_in(seen: Dictionary) -> Array:
  return PANELS.filter(func(id: String) -> bool: return seen.has(id))

func panels_mounted() -> Array:
  return panels_in(mounted())

# The HUD shows a context: exactly its panels, and, for the contexts that mount the same panels, only its own marker.
func shows_in(seen: Dictionary, context: String) -> bool:
  var expected: Array = TABLE[context]
  for id: String in PANELS:
    if seen.has(id) != expected.has(id):
      return false
  for other: String in MARKERS.keys():
    if seen.has(MARKERS[other]) != (other == context):
      return false
  return true

func shows(context: String) -> bool:
  return shows_in(mounted(), context)

# The dialog of the queue as the HUD shows it: the choices it holds (the Pressables, by testID) and the position it says ("1 of 3"), empty when there is none.
func dialog_reading(seen: Dictionary) -> Dictionary:
  var choices: Array = seen.keys().filter(func(id: String) -> bool: return id.begins_with("hud-dialog-choice-") and not id.ends_with("-detail") and not id.ends_with("-label"))
  choices.sort()
  return {"choices": choices, "position": str(seen["hud-dialog-position"].text) if seen.has("hud-dialog-position") else ""}

# A step that opens an event shows the choices of that event and no other: the event the queue has at its head after the click.
func head_shown(step: Dictionary, seen: Dictionary) -> bool:
  if not step.has("head"):
    return true
  return dialog_reading(seen).choices.has("hud-dialog-choice-" + str(step.head))

func game_context() -> String:
  return str(services.game.snapshot().context)

func phase_now() -> String:
  return str(services.game.state.phase)

func world_node() -> Node:
  return services.get_node_or_null("World")

func heard_now() -> Dictionary:
  var node := world_node()
  return node.heard.duplicate() if node != null else {"buttons": 0, "motions": 0}

# ------------------------------------------------------------------------------------------------ the host, around a click
# What the application's snapshot says between two frames, without a collection of Hermes' heap and without the windows: the counters, the
# pending work and the time and samples the pump and its phases have accumulated.
func light_of(state: Dictionary) -> Dictionary:
  var perf: Dictionary = state.get("performance", {})
  var counters: Dictionary = perf.get("counters", {})
  var errors: Array = state.get("errors", [])
  var out := {"commits": Sampler.number(counters.get("commits")), "creates": Sampler.number(counters.get("creates")),
    "deletes": Sampler.number(counters.get("deletes")), "updates": Sampler.number(counters.get("updates")),
    "nativeViews": Sampler.number(counters.get("nativeViews")), "pendingWork": Sampler.number(state.get("pendingWork")),
    "pendingTimers": Sampler.number(state.get("pendingTimers")), "pendingAnimationFrames": Sampler.number(state.get("pendingAnimationFrames")),
    "errors": errors.size(), "pump": {"count": Sampler.number(Sampler.dig(perf, ["pump", "count"])),
      "totalMs": Sampler.number(Sampler.dig(perf, ["pump", "totalMs"]))}}
  for key: String in ["js", "mount", "layout"]:
    out[key] = {"count": Sampler.number(Sampler.dig(perf, ["phases", key, "count"])), "totalMs": Sampler.number(Sampler.dig(perf, ["phases", key, "totalMs"]))}
  return out

func light() -> Dictionary:
  return light_of(sampler.app_state())

# What the host did between two light readings.
static func host_delta(before: Dictionary, after: Dictionary) -> Dictionary:
  var out := {}
  for key: String in ["commits", "creates", "deletes", "updates"]:
    out[key] = Sampler.number(after.get(key)) - Sampler.number(before.get(key))
  for key: String in ["pump", "js", "mount", "layout"]:
    out[key + "Ms"] = Sampler.number(Sampler.dig(after, [key, "totalMs"])) - Sampler.number(Sampler.dig(before, [key, "totalMs"]))
    out[key + "Count"] = Sampler.number(Sampler.dig(after, [key, "count"])) - Sampler.number(Sampler.dig(before, [key, "count"]))
  return out

static func light_key(reading: Dictionary) -> String:
  return JSON.stringify([reading.commits, reading.creates, reading.deletes, reading.updates, reading.pendingWork, reading.pendingTimers,
    reading.pendingAnimationFrames])

# Frames until the application has done nothing for STABLE_FRAMES frames, or -1.
func quiet() -> int:
  var last := ""
  var stable := 0
  for frame in range(FRAME_LIMIT):
    await get_tree().process_frame
    var key := light_key(light())
    stable = stable + 1 if key == last else 0
    last = key
    if stable >= STABLE_FRAMES:
      return frame + 1
  return -1

# The samples of a series of the host's window since a count: the window holds the last 128, so a turn of a few frames is all in it.
static func window_tail(perf: Dictionary, path: Array, taken: int) -> Array:
  var window: Variant = Sampler.dig(perf, path + ["windowMs"])
  if not window is Array or taken <= 0:
    return []
  return window.slice(maxi(0, window.size() - taken))

# ------------------------------------------------------------------------------------------------ the pointer
func tile_centre(x: int, y: int) -> Vector2:
  return MAP_ORIGIN + Vector2(x, y) * MAP_TILE + Vector2(MAP_TILE, MAP_TILE) * 0.5

func point_of(step: Dictionary) -> Vector2:
  if step.kind == "map":
    return tile_centre(int(step.tile[0]), int(step.tile[1]))
  var seen := mounted()
  return seen[step.target].control.get_global_rect().get_center() if seen.has(step.target) else Vector2(-1, -1)

func move_to(point: Vector2) -> void:
  var motion := InputEventMouseMotion.new()
  motion.device = DEVICE
  motion.position = point
  motion.global_position = point
  get_viewport().push_input(motion, true)

# A click: the press and the release, delivered at once through the viewport on the device of the validation.
func click_at(point: Vector2) -> void:
  for down in [true, false]:
    var event := InputEventMouseButton.new()
    event.device = DEVICE
    event.position = point
    event.global_position = point
    event.button_index = MOUSE_BUTTON_LEFT
    event.pressed = down
    get_viewport().push_input(event, true)

# ------------------------------------------------------------------------------------------------ readings at rest
func row_of(state: Dictionary) -> Dictionary:
  var nodes: Array = state.get("nodes", [])
  return {"state": str(state.get("state", "")), "nativeTags": Sampler.number(state.get("nativeTags")), "creates": Sampler.number(state.get("creates")),
    "deletes": Sampler.number(state.get("deletes")), "commits": Sampler.number(state.get("commits")), "nodes": nodes.size()}

# The panels and markers that the Surface's snapshot lists, by testID: what the HUD holds, read apart from the tree of Controls.
func ids_of(state: Dictionary) -> Dictionary:
  var ids := {}
  for node: Dictionary in state.get("nodes", []):
    var test_id := str(node.get("testID", ""))
    if test_id != "":
      ids[test_id] = true
  return ids

# In the windowed lane the HUD is only counted, not weighed: the Surface's snapshot and what the game says.
func light_rest() -> Dictionary:
  var state := Sampler.surface_state(hud)
  var ids := ids_of(state)
  var snapshot: Dictionary = services.game.snapshot()
  return {"surface": row_of(state), "panels": PANELS.filter(func(id: String) -> bool: return ids.has(id)),
    "markers": MARKERS.keys().filter(func(context: String) -> bool: return ids.has(MARKERS[context])),
    "context": str(snapshot.context), "turn": int(snapshot.turn), "phase": str(snapshot.phase)}

# One reading at rest: that count, then the engine and the host after a forced collection of Hermes' heap, and what the HUD itself has counted (its calls, the ones the game rejected).
func rest_reading() -> Dictionary:
  var row := light_rest()
  row["reading"] = sampler.sample()
  row["hud"] = hud_stats()
  return row

func at_rest() -> Dictionary:
  if lane == "headless":
    await settle(REST_FRAMES)
    return rest_reading()
  var frames: int = await quiet()
  var row := light_rest()
  row["quietFrames"] = frames
  return row

# ------------------------------------------------------------------------------------------------ one click
func first_after(moment: int) -> int:
  for stamp: int in draw_stamps:
    if stamp > moment:
      return stamp
  return -1

# The End turn of a step is accepted at once and the game goes on, one phase per frame: the click is over when the job has finished, the game
# is at rest and the HUD shows the context the turn leaves it in (and no spinner).
func turn_over(step: Dictionary, calls_before: int, seen: Dictionary) -> bool:
  return (int(services.callbacks.get("end_turn", 0)) > calls_before and int(services.job) == 0 and phase_now() == "idle"
    and not seen.has("hud-turn-spinner") and shows_in(seen, step.to) and head_shown(step, seen))

func arrived_for(step: Dictionary, calls_before: int) -> bool:
  var seen := mounted()
  return turn_over(step, calls_before, seen) if step.kind == "turn" else shows_in(seen, step.to) and head_shown(step, seen)

# Every frame of a turn, from the click until the HUD shows the context the turn leaves the game in: the phase, the interval since the previous
# frame, the nodes of the tree and what was published in the frame. Nothing heavy is read in them.
func record_turn_frame(previous: int, snapshots_before: int, ended_before: int) -> Dictionary:
  var now := Time.get_ticks_usec()
  return {"phase": phase_now(), "job": int(services.job), "usec": now - previous, "nodes": get_tree().get_node_count(),
    "snapshots": snapshots_seen - snapshots_before, "turnEnded": turn_ended_seen - ended_before, "spinner": is_mounted("hud-turn-spinner"), "stamp": now}

func run_step(round_index: int, index: int) -> Dictionary:
  var step: Dictionary = STEPS[index]
  # The pointer comes to the target and the HUD catches up with it: the hover is published and rendered before the click, not inside it.
  move_to(point_of(step))
  var approach: int = await quiet()
  var point := point_of(step)
  var callbacks_before: Dictionary = services.callbacks.duplicate()
  var heard_before := heard_now()
  var hud_before := hud_stats()
  var light_before := light()
  var snapshots_before := snapshots_seen
  var ended_before := turn_ended_seen
  var calls_before := int(callbacks_before.get("end_turn", 0))
  var frame0 := Engine.get_process_frames()
  var started := Time.get_ticks_usec()
  click_at(point)
  var flushed := Time.get_ticks_usec()
  var limit := TURN_FRAME_LIMIT if step.kind == "turn" else CLICK_FRAME_LIMIT
  var stamps: Array = [started]
  var turn_frames: Array = []
  var arrived_frames := 0 if arrived_for(step, calls_before) else -1
  var arrived := flushed if arrived_frames == 0 else -1
  var host_window: Dictionary = {}
  var snapshots_previous := snapshots_before
  var ended_previous := ended_before
  for frame in range(limit):
    await get_tree().process_frame
    var now := Time.get_ticks_usec()
    stamps.append(now)
    if step.kind == "turn":
      turn_frames.append(record_turn_frame(int(stamps[stamps.size() - 2]), snapshots_previous, ended_previous))
      snapshots_previous = snapshots_seen
      ended_previous = turn_ended_seen
    if arrived_frames < 0 and arrived_for(step, calls_before):
      arrived_frames = Engine.get_process_frames() - frame0
      arrived = now
      if step.kind == "turn":
        host_window = sampler.app_state(false, true)
    if arrived_frames >= 0:
      break
  var seen_at_arrival := mounted()
  var shown := panels_in(seen_at_arrival)
  var dialog_at_arrival := dialog_reading(seen_at_arrival)
  var context_at_arrival := game_context() if arrived_frames >= 0 else ""
  await settle(TRAILING_FRAMES)
  var drawn := first_after(arrived) if arrived >= 0 else -1
  var heard_after := heard_now()
  var intervals: Array = []
  for position in range(1, stamps.size()):
    intervals.append(int(stamps[position]) - int(stamps[position - 1]))
  var callbacks_delta := {}
  for key: String in services.callbacks.keys():
    var change := int(services.callbacks[key]) - int(callbacks_before.get(key, 0))
    if change != 0:
      callbacks_delta[key] = change
  var record := {"round": round_index, "step": index, "id": step.id, "kind": step.kind, "from": step.from, "to": step.to, "intent": step.intent,
    "approachFrames": approach, "frames": arrived_frames, "flushUsec": flushed - started, "latencyUsec": arrived - started if arrived >= 0 else null,
    "drawUsec": drawn - started if drawn >= 0 else null, "frameUsec": intervals, "callbacks": callbacks_delta,
    "worldEvents": int(heard_after.buttons) - int(heard_before.buttons) + int(heard_after.motions) - int(heard_before.motions),
    "worldClicks": int(heard_after.buttons) - int(heard_before.buttons), "worldMotions": int(heard_after.motions) - int(heard_before.motions),
    "shown": shown, "dialog": dialog_at_arrival, "contextAtArrival": context_at_arrival, "turn": null}
  if step.kind == "turn":
    record["turn"] = turn_record(turn_frames, light_before, host_window, snapshots_before, ended_before)
  var rest: Dictionary = await at_rest()
  record["rest"] = rest
  if rest.has("hud"):
    record["hudCalls"] = int(rest.hud.calls) - int(hud_before.calls)
    record["hudProblems"] = int(rest.hud.problemCount)
  return record

# What the host did in the turn, from the light reading before the click and the windowed one at its end, and what the node published.
func turn_record(frames: Array, before: Dictionary, window_state: Dictionary, snapshots_before: int, ended_before: int) -> Dictionary:
  var perf: Dictionary = window_state.get("performance", {})
  var after := light_of(window_state)
  var delta := host_delta(before, after)
  return {"frames": frames, "host": delta, "pumpWindowMs": window_tail(perf, ["pump"], int(delta.pumpCount)),
    "phaseWindowMs": {"js": window_tail(perf, ["phases", "js"], int(delta.jsCount)), "mount": window_tail(perf, ["phases", "mount"], int(delta.mountCount)),
      "layout": window_tail(perf, ["phases", "layout"], int(delta.layoutCount))},
    "snapshots": snapshots_seen - snapshots_before, "turnEnded": turn_ended_seen - ended_before, "ended": turn_ended_last.duplicate(true),
    "job": int(services.next_job) - 1, "finishedJob": int(services.finished_jobs.get(int(services.next_job) - 1, 0))}

# ------------------------------------------------------------------------------------------------ a round and the run
# A round starts on a new game, prepared through the services (not a click and not measured), and rests there before the first click.
func run_round(round_index: int) -> Dictionary:
  services.new_game()
  var quieted: int = await quiet()
  var start: Dictionary = await at_rest()
  start["quietFrames"] = quieted
  var row := {"round": round_index, "start": start, "steps": []}
  if lane == "windowed" and round_index == WARMUP_ROUNDS:
    # The runtime is warm: the idle window, with the map and the HUD still and nothing read.
    var drawn_before := draw_stamps.size()
    var intervals: Array = await idle(IDLE_FRAMES)
    stages["idle"] = {"frames": IDLE_FRAMES, "intervalsUsec": intervals, "draws": draw_stamps.size() - drawn_before}
  for index in range(STEPS.size()):
    var record: Dictionary = await run_step(round_index, index)
    row.steps.append(record)
    if captured_context(record):
      await capture(record)
    if int(record.frames) < 0 or (record.has("rest") and record.rest.get("quietFrames", 1) == -1):
      stages["aborted"] = {"round": round_index, "step": index, "id": record.id}
      break
  return row

# The intervals between frames in which nothing happens: the map and the HUD are still.
func idle(frames: int) -> Array:
  var intervals: Array = []
  await get_tree().process_frame
  var previous := Time.get_ticks_usec()
  for index in range(frames):
    await get_tree().process_frame
    var now := Time.get_ticks_usec()
    intervals.append(now - previous)
    previous = now
  return intervals

# The frame as drawn, for the captures lane: the first time each context shows.
var captured: Dictionary = {}

func captured_context(record: Dictionary) -> bool:
  return lane == "captures" and not captured.has(record.to) and int(record.frames) >= 0

func look() -> Image:
  await get_tree().process_frame
  await RenderingServer.frame_post_draw
  return get_viewport().get_texture().get_image()

func capture(record: Dictionary) -> void:
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(CAPTURES))
  var image: Image = await look()
  var file := "context-%s.png" % record.to
  var saved := image.save_png(ProjectSettings.globalize_path(CAPTURES + "/" + file)) == OK
  captured[record.to] = {"file": "frontier-turn-captures/" + file, "step": record.id, "saved": saved, "size": [image.get_width(), image.get_height()]}

func provenance() -> Dictionary:
  var value := sampler.provenance()
  var mode := DisplayServer.window_get_vsync_mode()
  value.merge({"vsyncMode": mode, "vsyncModeName": VSYNC_NAMES[mode] if mode >= 0 and mode < VSYNC_NAMES.size() else "unknown",
    "refreshRate": DisplayServer.screen_get_refresh_rate(), "maxFps": Engine.max_fps, "adapter": RenderingServer.get_video_adapter_name(),
    "screenSize": [DisplayServer.screen_get_size().x, DisplayServer.screen_get_size().y], "screenScale": DisplayServer.screen_get_scale(),
    "windowSize": [DisplayServer.window_get_size().x, DisplayServer.window_get_size().y]})
  return value

func config() -> Dictionary:
  return {"lane": lane, "steps": STEPS, "warmupRounds": WARMUP_ROUNDS, "rounds": steady_rounds, "restFrames": REST_FRAMES, "stableFrames": STABLE_FRAMES,
    "idleFrames": IDLE_FRAMES, "clickFrameLimit": CLICK_FRAME_LIMIT, "turnFrameLimit": TURN_FRAME_LIMIT, "device": DEVICE, "viewport": [SIZE.x, SIZE.y],
    "map": {"origin": [MAP_ORIGIN.x, MAP_ORIGIN.y], "tile": MAP_TILE}, "table": TABLE, "markers": MARKERS, "phases": PHASES, "panels": PANELS,
    "heapGrowthLimitBytes": HEAP_GROWTH_LIMIT_BYTES, "rssGrowthLimitKb": RSS_GROWTH_LIMIT_KB}

func run() -> void:
  # The addon's node creates the native Runtime when it is ready, a frame after the scene is in the tree.
  await wait_until(func() -> bool:
    application = services.get_node_or_null("Application/Runtime")
    hud = services.get_node_or_null("HUDLayer/HUD")
    return application != null and hud != null)
  if application == null or hud == null:
    push_error("FABRIC_ERROR: the scene has no running application or HUD")
    get_tree().quit(1)
    return
  # The Surface hears the events of the validation device (and the real pointer no more): the clicks are the probe's.
  hud.set_meta("validation_input_device", DEVICE)
  var windowed := lane != "headless"
  if windowed:
    DisplayServer.window_set_size(SIZE)
    RenderingServer.frame_post_draw.connect(note_draw)
  # A headless window is 64x64 and the HUD is laid out for the game's 1080x600 (hud_validation.gd does the same).
  get_tree().root.size = SIZE
  await settle(2)
  services.snapshot_changed.connect(count_snapshot)
  services.turn_ended.connect(count_turn_end)
  var mounted: bool = await wait_until(func() -> bool: return int(hud.call("get_surface_id")) != 0 and is_mounted("hud-bar") and is_mounted("hud-bar-end-turn"))
  application.call("evaluate", JS_PROBE)
  sampler = Sampler.new(get_tree(), application, "FrontierTurnProbe")
  var settled: int = await quiet()
  stages["config"] = config()
  stages["scene"] = {"mounted": mounted and settled > 0, "device": DEVICE, "viewport": [get_viewport().size.x, get_viewport().size.y],
    "mouseFilter": hud.mouse_filter}
  stages["provenance"] = provenance()
  stages["base"] = {"reading": sampler.sample(true), "surface": row_of(Sampler.surface_state(hud)), "baseNodes": get_tree().get_node_count(),
    "hud": hud_stats(), "context": game_context(), "panels": panels_mounted()}
  stages["aborted"] = null
  var rounds: Array = []
  stages["rounds"] = rounds
  var total := 1 if lane == "captures" else WARMUP_ROUNDS + steady_rounds
  for round_index in range(total):
    var row: Dictionary = await run_round(round_index)
    rounds.append(row)
    if stages["aborted"] != null:
      break
  if windowed:
    RenderingServer.frame_post_draw.disconnect(note_draw)
  stages["frames"] = {"processed": Engine.get_process_frames(), "drawn": draw_stamps.size()}
  # The tracker reports a rejection from a timer, not at the rejection: wait for it, then read the count.
  await wait_ms(TRACKER_DELAY_MS)
  stages["final"] = sampler.sample(true)
  stages["hudFinal"] = hud_stats()
  stages["faults"] = js("FrontierTurnProbe.faults()")
  application.call("evaluate", "FrontierTurnProbe.control()")
  var waited := Time.get_ticks_msec()
  while Time.get_ticks_msec() - waited < TRACKER_DELAY_MS and int(js("FrontierTurnProbe.controlSeen()").rejections) < 1:
    await get_tree().process_frame
  stages["control"] = js("FrontierTurnProbe.controlSeen()")
  stages["captures"] = captured
  stages["published"] = {"snapshots": snapshots_seen, "turnEnded": turn_ended_seen, "callbacks": services.callbacks.duplicate()}
  await close_overlays()
  finish()

# No Modal is open when the application quits: quitting with a Modal's window mounted logs an engine error (`remove_child` on a root that is already being freed), which
# is the host's and not what this probe measures. A run that ran to the end has none open (the last click closes the dialog); one that was cut short may, and a new game is
# what closes it. The published counts were taken before, so this is in no measurement.
func close_overlays() -> void:
  if not (panels_mounted().has("hud-city") or panels_mounted().has("hud-dialog")):
    return
  services.new_game()
  await wait_until(func() -> bool: return not (panels_mounted().has("hud-city") or panels_mounted().has("hud-dialog")))
  await settle(3)

func wait_ms(limit_ms: int) -> void:
  var started := Time.get_ticks_msec()
  while Time.get_ticks_msec() - started < limit_ms:
    await get_tree().process_frame

func note_draw() -> void:
  draw_stamps.append(Time.get_ticks_usec())

# ------------------------------------------------------------------------------------------------ what the checks read
func steady_of(rounds: Array) -> Array:
  return rounds.slice(WARMUP_ROUNDS)

func median_of(values: Array) -> float:
  var sorted: Array = values.duplicate()
  sorted.sort()
  return float(sorted[ceili(sorted.size() / 2.0) - 1])

# The records of a step across the rounds, in the order of the rounds.
func records_of(index: int) -> Array:
  var out: Array = []
  for row: Dictionary in stages.rounds:
    if row.steps.size() > index:
      out.append(row.steps[index])
  return out

func all_records() -> Array:
  var out: Array = []
  for row: Dictionary in stages.rounds:
    out.append_array(row.steps)
  return out

# The reading at rest of every series: the start of the round and every step.
func rest_series() -> Dictionary:
  var out := {"start": stages.rounds.map(func(row: Dictionary) -> Dictionary: return row.start)}
  for index in range(STEPS.size()):
    out[STEPS[index].id] = records_of(index).map(func(record: Dictionary) -> Dictionary: return record.rest)
  return out

# ------------------------------------------------------------------------------------------------ the checks
func check_provenance() -> void:
  var p: Dictionary = stages.provenance
  check(str(p.get("godot", "")).begins_with("4.") and str(p.get("hermes", "")) != "" and str(p.get("architecture", "")) != ""
    and str(p.get("renderingDriver", "")) != "" and str(p.get("displayServer", "")) != "" and str(p.get("os", "")) != "",
    "provenance/The report names the versions of Godot and Hermes, the architecture, the operating system and the driver")

func check_scene() -> void:
  check(stages.scene.mounted and int(stages.base.surface.nativeTags) > 0 and stages.base.context == "none" and stages.base.panels == ["hud-bar"],
    "scene/The provisioned game mounts its HUD over the World, at rest in the none context with the bar only")

# What a click owes in both lanes: the HUD showed the panels of its context within the ceiling of frames and the run was not cut short, the game is in the context the click leads to (and,
# where the lane has no reading at rest to judge them by, the Surface holds that context's panels), and the click made exactly one call to the game, the intent of its step.
func check_arrivals(records: Array, panels_at_rest: bool) -> void:
  var total := (WARMUP_ROUNDS + steady_rounds) * STEPS.size()
  var arrived := records.size() == total and stages.aborted == null
  var context := records.size() == total
  var intent := records.size() == total
  for record: Dictionary in records:
    var limit := TURN_FRAME_LIMIT if record.kind == "turn" else CLICK_FRAME_LIMIT
    arrived = arrived and int(record.frames) >= 0 and int(record.frames) <= limit
    context = context and record.contextAtArrival == record.to and record.rest.context == record.to and (not panels_at_rest or record.rest.panels == TABLE[record.to])
    intent = intent and record.callbacks == {record.intent: 1}
  check(arrived, "click/Every click shows the panels of its context within a ceiling of frames, and the run was not cut short")
  check(context, "click/When the HUD shows the panels the game is in the context the click leads to")
  check(intent, "click/Every click makes exactly one call to the game, the intent of its step")

func check_clicks() -> void:
  var records := all_records()
  check_arrivals(records, false)
  var world := records.size() == (WARMUP_ROUNDS + steady_rounds) * STEPS.size()
  var hud_calls := world
  for record: Dictionary in records:
    world = world and int(record.worldClicks) == (2 if record.kind == "map" else 0)
    hud_calls = hud_calls and int(record.hudCalls) == (0 if record.kind == "map" else 1)
  check(world, "click/A click on the map reaches the World (its press and release) and a click on a panel or button does not")
  check(hud_calls, "click/A click on a panel or button is one call of the HUD, and a click on the map is none")

# The queue of three events, as the tour answers it: the End turn of the fourth turn opens the first, each answer leads to the next, and the last one closes the dialog. The
# events and their choices are the game's table (consumers/civ-lite/game/rules.gd); each arrival must show the choices of the event the step names and the position the game gives it.
const QUEUE := [{"position": "1 of 3", "choices": ["hud-dialog-choice-turn_away", "hud-dialog-choice-welcome"]},
  {"position": "2 of 3", "choices": ["hud-dialog-choice-buy_grain", "hud-dialog-choice-buy_tools"]},
  {"position": "3 of 3", "choices": ["hud-dialog-choice-host", "hud-dialog-choice-send_on"]}]
const QUEUE_HEADS := {"welcome": 0, "buy_grain": 1, "host": 2}
# A Modal is a Window of its own in the SceneTree (native/modal_presentation.cpp holds one for each), which no native view of the host stands for: the contexts that mount
# their panels in one hold that many Windows beyond the host's views and the constant of the base.
const MODAL_WINDOWS := {"city": 1, "dialog": 1}

func check_queue() -> void:
  var records := all_records()
  var shown := records.size() == (WARMUP_ROUNDS + steady_rounds) * STEPS.size()
  var closed := shown
  var answered := 0
  for record: Dictionary in records:
    var step: Dictionary = STEPS[int(record.step)]
    if step.has("head"):
      var event: Dictionary = QUEUE[int(QUEUE_HEADS[step.head])]
      shown = shown and record.dialog.position == event.position and record.dialog.choices == event.choices
    elif step.kind == "dialog":
      closed = closed and record.dialog.position == "" and record.dialog.choices == []
    if step.kind == "dialog":
      answered += 1
  check(shown, "queue/Every step that opens an event of the queue shows its position and its own two choices, in the order of the game's table")
  check(closed and answered == 3 * (WARMUP_ROUNDS + steady_rounds), "queue/The three answers of every round are real clicks on the dialog's choices, and the last one closes it")

# After REST_FRAMES idle frames the HUD holds the panels of its context and the same native views, nodes and orphans every time the step comes back.
func check_rests() -> void:
  var series := rest_series()
  var base: Dictionary = stages.base
  var panels := true
  var native := true
  var godot := true
  var orphans := true
  var constant := true
  var complete := series.size() == STEPS.size() + 1
  for key: String in series.keys():
    var rests: Array = series[key]
    complete = complete and rests.size() == WARMUP_ROUNDS + steady_rounds
    if rests.size() <= WARMUP_ROUNDS:
      continue
    var first: Dictionary = rests[WARMUP_ROUNDS]
    for entry: Dictionary in steady_of(rests):
      var counters: Dictionary = entry.reading.performance.counters
      var expected: Array = TABLE[entry.context]
      panels = panels and entry.panels == expected and entry.markers == ([entry.context] if MARKERS.has(entry.context) else [])
      native = native and Sampler.number(entry.surface.nativeTags) == Sampler.number(counters.nativeViews) \
        and Sampler.number(entry.surface.nativeTags) == Sampler.number(first.surface.nativeTags) and entry.surface.state == "mounted"
      godot = godot and Sampler.number(entry.reading.godot.nodes) == Sampler.number(first.reading.godot.nodes) \
        and Sampler.number(entry.reading.godot.nodeMonitor) == Sampler.number(first.reading.godot.nodeMonitor)
      orphans = orphans and Sampler.number(entry.reading.godot.orphans) == 0.0
      constant = constant and Sampler.number(entry.reading.godot.nodes) - Sampler.number(counters.nativeViews) \
        == Sampler.number(base.reading.godot.nodes) - Sampler.number(base.reading.performance.counters.nativeViews) + int(MODAL_WINDOWS.get(entry.context, 0))
  check(complete, "rest/Every series (the start of a round and each step) has a reading at rest in every round")
  check(panels, "rest/At rest the Surface holds the panels of the context the click led to, and the marker of no other")
  check(native, "rest/The native views of a step are the same in every steady round, in the Surface and in the host")
  check(godot, "rest/The SceneTree's nodes and Godot's node monitor come back to the step's count in every steady round")
  check(orphans, "rest/Godot counts no orphan node at rest")
  check(constant, "rest/The SceneTree holds the host's native views plus a constant, and a Window for each Modal the context holds open, at every rest")

func check_turns() -> void:
  var turns := all_records().filter(func(record: Dictionary) -> bool: return record.kind == "turn")
  var steady := turns.filter(func(record: Dictionary) -> bool: return int(record.round) >= WARMUP_ROUNDS)
  var counted := steady.size() == steady_rounds * 4 and turns.size() == (WARMUP_ROUNDS + steady_rounds) * 4
  var sequence := true
  var consecutive := true
  var ended := true
  var job := true
  for record: Dictionary in turns:
    var turn: Dictionary = record.turn
    var frames: Array = turn.frames
    var phases: Array = frames.map(func(frame: Dictionary) -> String: return frame.phase)
    # The frames before the game accepts the turn are at rest. From the acceptance, the next seven frames advance exactly one phase each (the
    # last one hands the game back at idle) and publish a snapshot each; the frames after that are the HUD catching up, at rest and quiet.
    var first_busy := phases.find_custom(func(phase: String) -> bool: return phase != "idle")
    var busy: Array = frames.slice(first_busy, first_busy + PHASES.size()) if first_busy >= 0 else []
    var quiet_after: Array = frames.slice(first_busy + PHASES.size()) if first_busy >= 0 else []
    var before_frames: Array = frames.slice(0, first_busy) if first_busy >= 0 else []
    sequence = sequence and busy.map(func(frame: Dictionary) -> String: return frame.phase) == PHASES \
      and quiet_after.all(func(frame: Dictionary) -> bool: return frame.phase == "idle" and int(frame.job) == 0) \
      and before_frames.all(func(frame: Dictionary) -> bool: return frame.phase == "idle")
    consecutive = consecutive and busy.size() == PHASES.size() and busy.all(func(frame: Dictionary) -> bool: return int(frame.snapshots) == 1) \
      and quiet_after.all(func(frame: Dictionary) -> bool: return int(frame.snapshots) == 0) \
      and before_frames.all(func(frame: Dictionary) -> bool: return int(frame.snapshots) == 0)
    ended = ended and int(turn.turnEnded) == 1 and int(turn.snapshots) == PHASES.size() and busy.size() == PHASES.size() \
      and int(busy[busy.size() - 1].turnEnded) == 1 and busy.slice(0, busy.size() - 1).all(func(frame: Dictionary) -> bool: return int(frame.turnEnded) == 0)
    job = job and int(turn.finishedJob) == 1 and turn.ended.has("phases") and turn.ended.phases.map(func(phase: Dictionary) -> String: return phase.name) == PHASES.slice(0, 6)
  check(counted, "turn/The probe pressed End turn four times in every round")
  check(sequence, "turn/The game advances one phase in each frame, in the order of the service, and ends at idle")
  check(consecutive, "turn/A snapshot is published in each of the seven frames of the turn")
  check(ended, "turn/The end of the turn is published exactly once, in the frame that finishes the last phase")
  check(job, "turn/The job finished once and the summary lists the six phases")

func check_heap() -> void:
  var collected := true
  var comparable := true
  var series := rest_series()
  var bounded := not series.is_empty()
  for key: String in series.keys():
    var rests: Array = series[key]
    var heaps: Array = rests.map(func(entry: Dictionary) -> float: return Sampler.heap_of(entry.reading))
    for entry: Dictionary in rests:
      var perf := Sampler.perf_of(entry.reading)
      collected = collected and Sampler.dig(perf, ["hermes", "collectedBeforeReading"]) == true
      comparable = comparable and Sampler.dig(perf, ["hermes", "source"]) == "jsi::Instrumentation::getHeapInfo" and Sampler.heap_of(entry.reading) > 0.0
    var steady: Array = heaps.slice(WARMUP_ROUNDS)
    var half := floori(steady.size() / 2.0)
    bounded = bounded and half >= 1 and median_of(steady.slice(steady.size() - half)) - median_of(steady.slice(0, half)) <= HEAP_GROWTH_LIMIT_BYTES
  check(collected and comparable, "heap/Every reading of Hermes' heap follows a forced collection, so that two readings are comparable")
  check(bounded, "heap/The live heap at rest, by the median of the last half of the steady rounds, is within %d bytes of the first half's, for every series" % HEAP_GROWTH_LIMIT_BYTES)

func check_errors() -> void:
  var hosts := true
  var problems := true
  for entry: Dictionary in rest_series().values().reduce(func(all: Array, each: Array) -> Array: return all + each, []):
    hosts = hosts and int(entry.reading.host.errors) == 0
    problems = problems and int(entry.hud.problemCount) == 0
  var faults: Dictionary = stages.faults
  check(hosts and int(stages.final.host.errors) == 0 and problems, "errors/The host and the HUD report no error at any reading")
  check(int(faults.global) == 0 and int(faults.rejections) == 0 and faults.handlers.rejectionTracker == true,
    "errors/No error and no promise rejection went unhandled in JavaScript, and a handler was watching")
  check(int(stages.control.rejections) == 1, "errors/The handler sees an unhandled rejection when there is one (the control after the run)")

func evaluate_headless() -> void:
  check_provenance()
  check_scene()
  check_clicks()
  check_queue()
  check_rests()
  check_turns()
  check_heap()
  check_errors()

func check_windowed() -> void:
  check_arrivals(all_records(), true)
  check(DisplayServer.get_name() != "headless", "display/The display server is not headless: " + DisplayServer.get_name())
  var info: Dictionary = stages.provenance
  check(int(info.vsyncMode) >= 0 and int(info.vsyncMode) < VSYNC_NAMES.size() and float(info.refreshRate) > 0.0,
    "vsync/The vsync mode and the refresh rate of the screen are read back from the window")
  check(stages.has("idle") and stages.idle.intervalsUsec.size() == IDLE_FRAMES, "idle/The idle window took its frames")

func finish() -> void:
  finished = true
  var captures_lane := lane == "captures"
  if lane == "headless":
    evaluate_headless()
  elif lane == "windowed":
    check_windowed()
  else:
    check(stages.aborted == null and stages.captures.size() == TABLE.size(), "captures/Every context of the game showed and was captured")
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var sabotage_rejected := sabotage and not failures.is_empty()
  var report := {"scenario": "frontier-turn" if lane == "headless" else ("frontier-turn-captures" if captures_lane else "frontier-turn-graphics"),
    "lane": lane, "run": run_index, "reactNative": "0.87.1", "godot": Engine.get_version_info().string, "displayServer": DisplayServer.get_name(),
    "checks": checks, "stages": stages, "sabotage": sabotage, "allCurrentAssertionsPassed": failures.is_empty(),
    "scope": {"consumerAsProvisioned": true, "timingsAreRecordedNotJudged": true, "residentMemoryIsLoose": true, "frameTimeIsTheWindowedLane": true,
      "budgetFrozen": false, "mobileExportsCertified": false}}
  var output := FileAccess.open(REPORT, FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_ERROR: cannot write the turn report")
    get_tree().quit(1)
    return
  output.store_string(JSON.stringify(report) + "\n")
  output.close()
  if sabotage_rejected:
    print("FRONTIER_TURN_SABOTAGE_REJECTED: " + str(failures.size()))
  elif failures.is_empty():
    print("FRONTIER_TURN_PASSED: " + str(checks.size()))
  else:
    print("FRONTIER_TURN_FAILED")
  get_tree().quit(0 if failures.is_empty() or sabotage_rejected else 1)
