extends SceneTree

# The 100-turn soak of the Frontier game (V05-06, criterion `soak`), run for real: the persistent GameServices node
# (consumers/civ-lite/services/game_services.gd) in a laboratory scene, a FabricApplication with the bundle of
# tests/frontier-soak-fixture.jsx and a FabricSurface over the pointer spike's world. A scripted player (in that bundle, a fixed rule over
# the snapshot it receives) plays 100 complete turns, one intent at a time through the typed services; the probe waits for each turn's
# job, lets the game rest and takes a reading, and once a turn opens and closes a heavy panel with real clicks.
#
# The scene is the laboratory's, as tests/frontier-services-probe.gd builds it: the game node, a child `Application` that emits
# `runtime_available` while it enters the tree (the stand-in of sdk/addon/application_node.gd) and the Surface, here in a CanvasLayer
# after the world (the order a2 needs, docs/research/world-input.md). The layer keeps processing while the tree is paused
# (PROCESS_MODE_ALWAYS): the FabricApplication always does (native/fabric_application.cpp:111) but the Surface hears the pointer in
# `_input`, which a paused node does not, so it is the scene's owner who decides that the HUD stays alive when the game is paused.
#
# Readings. Every intent that changes what is selected is followed by a light reading once the application has been quiet (the engine's
# nodes, the host's native views, the registry's subscriptions, the HUD's state). Every turn ends with one full reading at rest, after
# REST_FRAMES idle frames, taken with the shared sampler (tests/performance-sampler.gd, the reading GF-30's soak takes): the engine's
# counts, the resident memory and Hermes' heap after a forced collection. The probe judges what holds at any pace of the machine,
# exactly (nodes and orphans, native views by context, the job, the pause, the claim, the errors, the hashes) and the heap by the
# GF-30 rule over the median of the halves. Durations are recorded and never judged. The independent oracle
# (tests/frontier-soak-oracle.mjs) recomputes all of it from the raw report.
#
#   --strategy=unmount|hide   how the heavy panel is closed
#   --sabotage                a retained sabotage runs this probe: a failed check is the rejection, not an error
const Sampler := preload("res://tests/performance-sampler.gd")
const Driver := preload("res://tests/world-input-driver.gd")
const GameServices := preload("res://consumers/civ-lite/services/game_services.gd")
# The laboratory keeps the SDK sources behind .gdignore, so the probe hands the facade to the node by path.
const FabricAPI := preload("res://sdk/addon/godot_fabric.gd")
const WorldScene := preload("res://examples/world-input/world.tscn")

const BUNDLE := "res://build/frontier-soak-probe.js"
const REPORT := "res://build/frontier-soak-report.json"
const SIZE := Vector2i(800, 600)
# The experiment, as tests/frontier-soak-cases.mjs states it (the oracle checks that the probe ran these).
const TURNS := 100
const WARMUP_TURNS := 2
const PAUSE_TURN := 50
const PAUSE_FRAMES := 60
const RSS_GROWTH_LIMIT_KB := 48 * 1024
# The limits of the GF-30 harness (tests/performance-cases.mjs) and the baseline's frames (tests/frontier-baseline-cases.mjs).
const HEAP_GROWTH_LIMIT_BYTES := 2048
const REST_FRAMES := 30
const STABLE_FRAMES := 6
const PANEL_TOGGLE := {"left": 20.0, "top": 36.0, "width": 120.0, "height": 28.0}
const PAUSE_TOGGLE := {"left": 160.0, "top": 36.0, "width": 120.0, "height": 28.0}
const CLAIM_POINT := Vector2(230.0, 300.0)
# Bounds on a wait for a state, never a measure.
const MAX_STEPS := 24
const FRAME_LIMIT := 600
const JOB_SNAPSHOTS := 7
# How long Hermes' tracker may take to report a promise rejected with no handler (2000 ms for an Error, as the `promise` library does; see the fixture's
# control), and a little more.
const TRACKER_DELAY_MS := 2300

# Stands in for sdk/addon/application_node.gd: the FabricApplication is built while this node enters the tree, and the signal tells the game
# node, which connected to it from its own _enter_tree, to register before anything mounts.
class ApplicationStandIn extends Node:
  signal runtime_available(runtime: Node)
  var bundle_path := ""

  func _enter_tree() -> void:
    var runtime: Node = ClassDB.instantiate("FabricApplication")
    runtime.name = "Runtime"
    runtime.set("bundle_path", bundle_path)
    add_child(runtime)
    runtime_available.emit(runtime)

# What the node published, on the Godot side and with the frame it was published in; `rows` is only ever appended to.
class Recorder extends RefCounted:
  var rows: Array = []

  func on_snapshot(snapshot: Dictionary) -> void:
    rows.append({"kind": "snapshot", "frame": Engine.get_process_frames(), "turn": snapshot.turn, "phase": snapshot.phase, "last_job": snapshot.last_job})

  func on_turn_ended(summary: Dictionary) -> void:
    rows.append({"kind": "turn_ended", "frame": Engine.get_process_frames(), "turn": summary.turn, "job": summary.job})

var strategy := "unmount"
var sabotage := false
var checks: Array = []
var stages: Dictionary = {}
var scene: Node
var world: Node2D
var services: Node
var application: Node
var surface: Control
var hud: CanvasLayer
var sampler: Sampler
var driver: Driver
var recorder: Recorder

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

func settle(count: int = 8) -> void:
  for index in range(count):
    await process_frame

# Waits until the condition holds, at most `limit_ms` of wall time: a bound on a hang, not a measure.
func wait_for(condition: Callable, limit_ms: int = 5000) -> bool:
  var started := Time.get_ticks_msec()
  while Time.get_ticks_msec() - started < limit_ms and not condition.call():
    await process_frame
  return condition.call()

# ------------------------------------------------------------------------------------------------ JavaScript
func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(" + expression + ")"))

func counts() -> Dictionary:
  var value: Variant = js("FrontierSoakProbe.counts()")
  return value if value is Dictionary else {}

func latest() -> Dictionary:
  var value: Variant = js("FrontierSoakProbe.latest()")
  return value if value is Dictionary else {}

func ui_state() -> Dictionary:
  var value: Variant = js("FrontierSoakProbe.ui()")
  return value if value is Dictionary else {}

func bundle_ready() -> bool:
  return str(application.call("evaluate", "typeof globalThis.FrontierSoakProbe")).contains("object")

# ----------------------------------------------------------------------------------------------- the scene
func build_scene() -> void:
  scene = Node.new()
  scene.name = "FrontierSoak"
  world = WorldScene.instantiate()
  world.name = "World"
  scene.add_child(world)
  services = GameServices.new()
  services.name = "GameServices"
  services.fabric_api = FabricAPI
  var stand_in := ApplicationStandIn.new()
  stand_in.name = "Application"
  stand_in.bundle_path = BUNDLE
  services.add_child(stand_in)
  scene.add_child(services)
  recorder = Recorder.new()
  services.snapshot_changed.connect(recorder.on_snapshot)
  services.turn_ended.connect(recorder.on_turn_ended)
  # The HUD's layer is after the world in the tree (a2) and keeps processing when the tree is paused.
  hud = CanvasLayer.new()
  hud.name = "Hud"
  hud.process_mode = Node.PROCESS_MODE_ALWAYS
  surface = ClassDB.instantiate("FabricSurface")
  surface.name = "Surface"
  surface.position = Vector2(0, 0)
  surface.size = Vector2(SIZE)
  surface.set("application_path", NodePath("../../GameServices/Application/Runtime"))
  surface.set("component_name", "FrontierSoakHud")
  surface.set("initial_props", {"strategy": strategy})
  hud.add_child(surface)
  scene.add_child(hud)
  root.add_child(scene)
  application = services.get_node("Application/Runtime")

func mount() -> bool:
  sampler = Sampler.new(self, application, "FrontierSoakProbe")
  driver = Driver.new(world, application, [surface])
  var reached: bool = await driver.wait_for(func() -> bool: return bundle_ready() and int(surface.call("get_surface_id")) != 0 \
    and not driver.node_by("soak-panel-toggle").is_empty() and not latest().is_empty())
  var frames: int = await quiet()
  return reached and frames > 0

# ------------------------------------------------------------------------------------------------ readings
# What the application does not do when it is at rest: the counters, the pending work and the timers.
static func stable_key(state: Dictionary) -> String:
  var found: Variant = Sampler.dig(state, ["performance", "counters"])
  var counters: Dictionary = found if found is Dictionary else {}
  return JSON.stringify([counters.get("commits"), counters.get("creates"), counters.get("deletes"), counters.get("updates"), state.get("pendingWork"),
    state.get("pendingTimers"), state.get("pendingAnimationFrames")])

# Frames until the application has done nothing for STABLE_FRAMES frames, or -1.
func quiet() -> int:
  var last := ""
  var stable := 0
  for frame in range(FRAME_LIMIT):
    await process_frame
    var key := stable_key(sampler.app_state())
    stable = stable + 1 if key == last else 0
    last = key
    if stable >= STABLE_FRAMES:
      return frame + 1
  return -1

static func counter_of(state: Dictionary, name: String) -> float:
  return Sampler.number(Sampler.dig(state, ["performance", "counters", name]))

# What the registry of the game services holds: it is what a connection that is never removed would grow.
static func registry_of(state: Dictionary) -> Dictionary:
  var value: Variant = state.get("gameServices", {})
  var registry: Dictionary = value if value is Dictionary else {}
  var errors: Variant = registry.get("errors", [])
  return {"subscriptions": int(Sampler.number(registry.get("subscriptions"))), "bindings": int(Sampler.number(registry.get("bindings"))),
    "errors": errors.size() if errors is Array else -1, "pendingHostTasks": int(Sampler.number(registry.get("pendingHostTasks"))),
    "pendingEvents": int(Sampler.number(registry.get("pendingEvents")))}

# A light reading, taken between two frames once the application was quiet: the engine's nodes and orphans, the host's native views, the
# registry and the HUD's state. Nothing heavy: no collection of Hermes' heap and no resident memory.
func light(label: String) -> Dictionary:
  var state := sampler.app_state()
  var seen := latest()
  var ui := ui_state()
  var errors: Array = state.get("errors", [])
  return {"label": label, "frame": Engine.get_process_frames(), "nodes": tree_nodes(), "nodeMonitor": Sampler.number(Performance.get_monitor(Performance.OBJECT_NODE_COUNT)),
    "orphans": Sampler.number(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT)), "native": counter_of(state, "nativeViews"),
    "rootCount": Sampler.number(state.get("rootCount")), "errors": errors.size(), "registry": registry_of(state),
    "turn": seen.get("turn"), "phase": seen.get("phase"), "context": seen.get("context"), "actions": seen.get("actions"), "dialog": seen.get("dialog"),
    "choices": seen.get("choices"), "panelOpen": ui.get("panelOpen"), "pulse": ui.get("pulse"), "strategy": ui.get("strategy"), "mounts": ui.get("mounts"),
    "unmounts": ui.get("unmounts")}

func tree_nodes() -> int:
  return get_node_count()

# The counters the host keeps and the time its phases have accumulated, to take the difference across a click.
func host_counters() -> Dictionary:
  var state := sampler.app_state()
  var out := {"commits": counter_of(state, "commits"), "creates": counter_of(state, "creates"), "deletes": counter_of(state, "deletes"),
    "updates": counter_of(state, "updates")}
  for name: String in ["js", "mount", "layout"]:
    out[name] = Sampler.number(Sampler.dig(state, ["performance", "phases", name, "totalMs"]))
  out["pump"] = Sampler.number(Sampler.dig(state, ["performance", "pump", "totalMs"]))
  out["pumpCount"] = Sampler.number(Sampler.dig(state, ["performance", "pump", "count"]))
  return out

static func host_delta(before: Dictionary, after: Dictionary) -> Dictionary:
  var out := {}
  for name: String in ["commits", "creates", "deletes", "updates", "js", "mount", "layout", "pump", "pumpCount"]:
    out[name] = Sampler.number(after.get(name)) - Sampler.number(before.get(name))
  return out

# -------------------------------------------------------------------------------------------------- clicks
static func center_of(button: Dictionary) -> Vector2:
  return Vector2(button.left + button.width / 2.0, button.top + button.height / 2.0)

# A real click at a point, the pointer spike's own injection (tests/world-input-driver.gd): a motion, a press and a release through
# Input.parse_input_event, delivered at once by Input.flush_buffered_events. The time is the injection and the flush, which is where the
# host handles the pointer event, React renders and commits and the host mounts, as in the baseline (docs/research/frontier-baseline.md).
func click(at: Vector2) -> Dictionary:
  await process_frame
  var before := host_counters()
  var started := Time.get_ticks_usec()
  driver.inject(Driver.part("soak", "left", at))
  Input.flush_buffered_events()
  var flushed := Time.get_ticks_usec()
  var frames: int = await quiet()
  return {"flushUsec": flushed - started, "quietFrames": frames, "host": host_delta(before, host_counters())}

# A click on the map where the heavy panel stands, and what the world heard of it: the claim of the panel, which a2 makes by the hit test of
# React Native. An open panel keeps the press from the world; a closed one, however it was closed, must not.
func claim_probe() -> Dictionary:
  world.reset()
  driver.inject(Driver.part("claim", "left", CLAIM_POINT))
  Input.flush_buffered_events()
  await settle(2)
  return {"presses": world.count("InputEventMouseButton", true, MOUSE_BUTTON_LEFT), "releases": world.count("InputEventMouseButton", false, MOUSE_BUTTON_LEFT),
    "events": world.received.size()}

# The marker's button is clicked twice, as the pause lane will click it, in a warm-up turn: the code the first press and the first mount of the
# marker run is compiled lazily and stays in Hermes' heap, so a first use in the middle of the steady turns would be a step in the heap at
# rest and not a leak. Nothing is paused here.
func warm_marker() -> Dictionary:
  var first := await click(center_of(PAUSE_TOGGLE))
  var shown: bool = await driver.wait_for(func() -> bool: return not driver.node_by("soak-pause-marker").is_empty(), 90)
  var second := await click(center_of(PAUSE_TOGGLE))
  var gone: bool = await driver.wait_for(func() -> bool: return driver.node_by("soak-pause-marker").is_empty(), 90)
  return {"markerShown": shown, "markerGone": gone, "clicks": int(counts().clicks.pause), "first": first, "second": second}

# The turn opens the heavy panel and closes it again, with a light reading and a claim probe in each state.
func panel_cycle() -> Dictionary:
  var closed_claim := await claim_probe()
  var opened := await click(center_of(PANEL_TOGGLE))
  var open_reading := light("panel open")
  var open_claim := await claim_probe()
  var closed := await click(center_of(PANEL_TOGGLE))
  var closed_reading := light("panel closed")
  var shut_claim := await claim_probe()
  return {"before": {"claim": closed_claim}, "open": {"click": opened, "reading": open_reading, "claim": open_claim},
    "closed": {"click": closed, "reading": closed_reading, "claim": shut_claim}}

# ------------------------------------------------------------------------------------------------- the pause
func pump_count() -> float:
  return Sampler.number(Sampler.dig(sampler.app_state(), ["performance", "pump", "count"]))

# The game is paused in the frame the end of the turn is sent: the call is a task of the registry, which the FabricApplication (always
# processing) runs, so the job is accepted, and the node that advances it (a pausable child of the root) does not run. Held for
# PAUSE_FRAMES, the job must not move while the HUD still answers: a click on the marker's button reaches the handler, React changes its
# state and the marker is a native node of the Surface; a second click takes it away. Then the game is resumed and the job finishes.
func pause_lane(job: int, rows_before: int) -> Dictionary:
  var pumps_before := pump_count()
  var frames_before := Engine.get_process_frames()
  var state_before := {"phase": str(services.game.state.phase), "job": int(services.job), "turn": int(services.game.state.turn)}
  var counts_before := counts()
  var ui_before := ui_state()
  var marker_before := not driver.node_by("soak-pause-marker").is_empty()
  await settle(PAUSE_FRAMES)
  var during := {"paused": paused, "phase": str(services.game.state.phase), "job": int(services.job), "turn": int(services.game.state.turn),
    "rows": recorder.rows.size() - rows_before, "frames": Engine.get_process_frames() - frames_before, "pumps": pump_count() - pumps_before,
    "turnEnded": int(counts().turnEnded) - int(counts_before.turnEnded)}
  var before_click := counts()
  var first := await click(center_of(PAUSE_TOGGLE))
  var shown: bool = await driver.wait_for(func() -> bool: return not driver.node_by("soak-pause-marker").is_empty(), 90)
  var after_first := counts()
  var ui_first := ui_state()
  var second := await click(center_of(PAUSE_TOGGLE))
  var gone: bool = await driver.wait_for(func() -> bool: return driver.node_by("soak-pause-marker").is_empty(), 90)
  var after_second := counts()
  var still := {"phase": str(services.game.state.phase), "job": int(services.job), "rows": recorder.rows.size() - rows_before}
  paused = false
  var finished: bool = await wait_for(func() -> bool: return int(services.job) == 0 and int(counts().turnEnded) >= int(counts_before.turnEnded) + 1)
  var rows: Array = recorder.rows.slice(rows_before)
  return {"job": job, "before": state_before, "markerBefore": marker_before, "during": during, "ui": {"clicksBefore": int(before_click.clicks.pause),
    "clicksAfterFirst": int(after_first.clicks.pause), "clicksAfterSecond": int(after_second.clicks.pause), "markerShown": shown, "pulseAfterFirst": ui_first.get("pulse"),
    "markerGone": gone, "firstClick": first, "secondClick": second}, "still": still, "uiBefore": ui_before, "finished": finished, "rows": rows,
    "pauseFrames": PAUSE_FRAMES}

# ------------------------------------------------------------------------------------------------- one turn
# Plays one turn: steps of the player until it ends the turn, a light reading after each step that changes what is selected, the panel
# cycle the first time the city is selected, then the job, the rest and the hash. Returns the turn's row; `aborted` is set when the turn
# could not be played.
func play_turn(index: int) -> Dictionary:
  var turn_started := Time.get_ticks_usec()
  var start := latest()
  var row := {"index": index, "turn": int(start.get("turn", -1)), "decisions": [], "contexts": [], "panel": {}, "warm": {}, "job": {}, "pause": {}, "rest": {},
    "aborted": ""}
  var panel_done := false
  var turn_ended_before := int(counts().turnEnded)
  for step_index in range(MAX_STEPS):
    var before := counts()
    # The rows the node has published so far: the job of an end_turn this step sends starts after them (the call runs in the registry's pump,
    # never inside this evaluation).
    var mark := recorder.rows.size()
    var decision: Variant = js("FrontierSoakProbe.step()")
    if not decision is Dictionary or int(decision.get("n", 0)) == 0:
      row.aborted = "the player had nothing to decide at step %d" % step_index
      return row
    var ends_turn: bool = decision.id == "end_turn"
    # The pause: in the frame the end of the turn is sent (see pause_lane).
    var pausing: bool = ends_turn and int(row.turn) == PAUSE_TURN
    if pausing:
      paused = true
    var done: bool = await wait_for(func() -> bool: return int(counts().stepsDone) >= int(before.stepsDone) + 1)
    var outbox: Array = js("FrontierSoakProbe.drain()")
    row.decisions.append_array(outbox)
    if not done or outbox.is_empty():
      row.aborted = "step %d (%s) did not settle" % [step_index, str(decision.id)]
      paused = false
      return row
    var entry: Dictionary = outbox.back()
    if ends_turn:
      if entry.ok != 1:
        row.aborted = "end_turn was refused: %s" % str(entry.code)
        paused = false
        return row
      var job_id := int(entry.job)
      if pausing:
        row.pause = await pause_lane(job_id, mark)
      var finished: bool = await wait_for(func() -> bool: return int(services.job) == 0 and int(counts().turnEnded) >= turn_ended_before + 1 \
        and latest().get("phase") == "idle" and int(latest().get("lastJob", -1)) == job_id)
      if not finished:
        row.aborted = "the job %d did not finish" % job_id
        return row
      row.job = {"id": job_id, "rows": recorder.rows.slice(mark)}
      break
    if int(entry.ok) != 1:
      continue
    # An intent changed what is selected (or the research, the production, the event): the application is quiet, then a light reading.
    await quiet()
    var reading := light(str(entry.id))
    row.contexts.append(reading)
    if not panel_done and entry.id == "select_tile" and reading.context == "city":
      panel_done = true
      row.panel = await panel_cycle()
      if index == WARMUP_TURNS - 1:
        row.warm = await warm_marker()
  if row.job.is_empty() and row.aborted == "":
    row.aborted = "the turn did not end within %d steps" % MAX_STEPS
    return row
  # The game rests: REST_FRAMES idle frames, then the full reading and the state's hash.
  await settle(REST_FRAMES)
  var state := sampler.app_state()
  row.rest = {"reading": sampler.sample(), "registry": registry_of(state), "latest": latest(), "ui": ui_state()}
  row.hash = services.game.state_hash()
  row.serialization = services.game.serialize()
  row.turnMs = (Time.get_ticks_usec() - turn_started) / 1000.0
  return row

# ------------------------------------------------------------------------------------------------ the run
func run_probe() -> void:
  root.size = SIZE
  await settle(2)
  build_scene()
  var mounted: bool = await mount()
  stages["config"] = {"strategy": strategy, "turns": TURNS, "warmupTurns": WARMUP_TURNS, "pauseTurn": PAUSE_TURN, "pauseFrames": PAUSE_FRAMES,
    "restFrames": REST_FRAMES, "stableFrames": STABLE_FRAMES, "heapGrowthLimitBytes": HEAP_GROWTH_LIMIT_BYTES, "rssGrowthLimitKb": RSS_GROWTH_LIMIT_KB,
    "panelToggle": PANEL_TOGGLE, "pauseToggle": PAUSE_TOGGLE, "claimPoint": [CLAIM_POINT.x, CLAIM_POINT.y], "viewport": [SIZE.x, SIZE.y]}
  stages["scene"] = {"mounted": mounted, "mouseFilter": surface.mouse_filter, "hudProcessMode": hud.process_mode, "worldFirst": world.get_index() < hud.get_index(),
    "alwaysMode": Node.PROCESS_MODE_ALWAYS}
  stages["provenance"] = sampler.provenance()
  stages["provenance"].merge({"vsyncMode": DisplayServer.window_get_vsync_mode(), "refreshRate": DisplayServer.screen_get_refresh_rate()})
  stages["base"] = {"reading": sampler.sample(true), "light": light("base"), "registry": registry_of(sampler.app_state()), "epoch": services.epoch,
    "hash": services.game.state_hash()}
  var turns: Array = []
  stages["turns"] = turns
  stages["aborted"] = null
  for index in range(TURNS):
    var row := await play_turn(index)
    turns.append(row)
    if index % 10 == 9 or row.aborted != "":
      print("FRONTIER_SOAK_PROGRESS: %d turns, %s ms the last" % [index + 1, str(row.get("turnMs", -1))])
    if row.aborted != "":
      stages["aborted"] = {"turn": index, "reason": row.aborted}
      break
  paused = false
  # The tracker reports a promise that nobody handles from a timer and not at the rejection (2000 ms for an Error, 100 for a TypeError or a
  # ReferenceError, after the `promise` library), so the count of the errors the soak did not mean is read after that long: one from the last turn
  # would still be on its way before.
  await wait_for(func() -> bool: return false, TRACKER_DELAY_MS)
  stages["final"] = sampler.sample(true)
  stages["finalLight"] = light("final")
  var total := counts()
  stages["faults"] = {"global": int(total.faults.global), "rejections": int(total.faults.rejections), "last": str(total.faults.last), "handlers": total.faults.handlers}
  stages["game"] = {"hash": services.game.state_hash(), "serialization": services.game.serialize(), "turn": int(services.game.state.turn), "epoch": services.epoch,
    "lastJob": int(services.game.last_job), "nextJob": int(services.next_job), "finishedJobs": services.finished_jobs.size(), "callbacks": services.callbacks.duplicate()}
  stages["calls"] = {"snapshots": int(total.snapshots), "turnEnded": int(total.turnEnded), "decisions": int(total.decisions), "clicks": total.clicks}
  # The control: one rejection that nobody handles, once the soak is over, so that "no unhandled rejection" can be told from "cannot see one".
  js("FrontierSoakProbe.control()")
  await wait_for(func() -> bool: return int(js("FrontierSoakProbe.controlSeen()").rejections) >= 1, TRACKER_DELAY_MS)
  stages["control"] = js("FrontierSoakProbe.controlSeen()")
  await finish_probe()

# -------------------------------------------------------------------------------------------- what the checks read
func rest_readings() -> Array:
  return stages.turns.map(func(row: Dictionary) -> Dictionary: return row.rest.reading)

func light_readings() -> Array:
  var out: Array = [stages.base.light]
  for row: Dictionary in stages.turns:
    out.append_array(row.contexts)
    if not row.panel.is_empty():
      out.append(row.panel.open.reading)
      out.append(row.panel.closed.reading)
  out.append(stages.finalLight)
  return out

# The median by nearest rank (the lower one of an even count), as the GF-30 oracle's percentiles are.
static func median_of(values: Array) -> float:
  var sorted: Array = values.duplicate()
  sorted.sort()
  return float(sorted[ceili(sorted.size() / 2.0) - 1])

# The state of the HUD that decides how many native views it holds: the context's actions, the dialog, the marker, the panel.
static func hud_key(reading: Dictionary) -> String:
  return JSON.stringify([reading.get("context"), reading.get("actions"), reading.get("dialog"), reading.get("choices"), reading.get("panelOpen"), reading.get("pulse")])

# ---------------------------------------------------------------------------------------------------- the checks
func check_provenance() -> void:
  var p: Dictionary = stages.provenance
  check(str(p.get("godot", "")).begins_with("4.") and str(p.get("hermes", "")) != "" and str(p.get("architecture", "")) != ""
    and str(p.get("renderingDriver", "")) != "" and str(p.get("displayServer", "")) != "" and str(p.get("os", "")) != "",
    "provenance/The report names the versions of Godot and Hermes, the architecture, the operating system and the driver")

func check_scene() -> void:
  var scene_state: Dictionary = stages.scene
  check(scene_state.mounted and Sampler.number(scene_state.mouseFilter) == float(Control.MOUSE_FILTER_IGNORE) and scene_state.worldFirst,
    "scene/The HUD mounts in a Surface that takes no pointer (IGNORE), in a layer after the world")
  check(Sampler.number(scene_state.hudProcessMode) == Sampler.number(scene_state.alwaysMode),
    "scene/The HUD's layer keeps processing while the tree is paused (PROCESS_MODE_ALWAYS)")
  check(stages.base.registry.subscriptions >= 1 and stages.base.registry.bindings == 14 and Sampler.number(stages.base.epoch) == 1.0,
    "scene/The registry holds the 14 bindings of the game and the session is the first")

func check_turns() -> void:
  var turns: Array = stages.turns
  var played := turns.size() == TURNS and stages.aborted == null
  var advanced := played
  var accepted := played
  var next := 1
  for row: Dictionary in turns:
    played = played and row.aborted == "" and not row.job.is_empty()
    advanced = advanced and int(row.turn) == next and int(row.rest.latest.get("turn", -1)) == next + 1
    next += 1
    for decision: Dictionary in row.decisions:
      accepted = accepted and decision.state == "done" and int(decision.ok) == 1 and str(decision.code) == "ok"
  check(played, "soak/Every one of the %d turns was played to its end: the end of the turn accepted and the job finished" % TURNS)
  check(advanced, "soak/The turn counter advanced by exactly one at the end of every turn")
  check(accepted, "soak/Every intent of the player was accepted by the game (a refusal is a rule of the player that is wrong)")
  check(stages.game.turn == TURNS + 1 and stages.game.lastJob == TURNS, "soak/The game ends on turn %d with %d jobs finished" % [TURNS + 1, TURNS])

func check_jobs() -> void:
  var turns: Array = stages.turns
  var fits: bool = turns.size() == TURNS
  var once: bool = fits
  var ordered: bool = fits
  var expected_job := 1
  for row: Dictionary in stages.turns:
    var job: Dictionary = row.job
    if job.is_empty():
      fits = false
      continue
    var snapshots: Array = job.rows.filter(func(entry: Dictionary) -> bool: return entry.kind == "snapshot")
    var ended: Array = job.rows.filter(func(entry: Dictionary) -> bool: return entry.kind == "turn_ended")
    var consecutive := snapshots.size() == JOB_SNAPSHOTS
    for position in range(1, snapshots.size()):
      consecutive = consecutive and int(snapshots[position].frame) == int(snapshots[position - 1].frame) + 1
    if int(row.turn) != PAUSE_TURN:
      fits = fits and consecutive
    else:
      fits = fits and snapshots.size() == JOB_SNAPSHOTS
    once = once and ended.size() == 1 and int(ended[0].job) == int(job.id) and int(job.id) == expected_job
    ordered = ordered and job.rows.size() == JOB_SNAPSHOTS + 1 and job.rows[JOB_SNAPSHOTS - 1].kind == "turn_ended" and job.rows[JOB_SNAPSHOTS].kind == "snapshot"
    expected_job += 1
  check(fits, "job/Every turn's job published seven snapshots, one phase a frame (the paused turn's after the game resumed)")
  check(once and ordered, "job/Every job finished exactly once, with the next id, and turn_ended came before the snapshot of the turn that begins")

func check_nodes() -> void:
  var base: Dictionary = stages.base.light
  var offset := Sampler.number(base.nodes) - Sampler.number(base.native)
  var monitor_offset := Sampler.number(base.nodeMonitor) - Sampler.number(base.native)
  var constant := true
  var no_orphans := true
  var hud_mounted_once := true
  for reading: Dictionary in light_readings():
    constant = constant and Sampler.number(reading.nodes) - Sampler.number(reading.native) == offset \
      and Sampler.number(reading.nodeMonitor) - Sampler.number(reading.native) == monitor_offset and Sampler.number(reading.rootCount) == 1.0
    no_orphans = no_orphans and Sampler.number(reading.orphans) == Sampler.number(base.orphans)
    hud_mounted_once = hud_mounted_once and Sampler.number(reading.mounts) == 1.0 and Sampler.number(reading.unmounts) == 0.0
  for reading: Dictionary in rest_readings():
    constant = constant and Sampler.number(reading.godot.nodes) - counter_of({"performance": reading.performance}, "nativeViews") == offset \
      and Sampler.number(reading.godot.nodeMonitor) - counter_of({"performance": reading.performance}, "nativeViews") == monitor_offset
    no_orphans = no_orphans and Sampler.number(reading.godot.orphans) == Sampler.number(base.orphans)
  check(constant, "nodes/At every reading the SceneTree's nodes are the host's native views plus a constant, in one root")
  check(no_orphans, "nodes/At every reading Godot counts no orphan beyond the base's")
  check(hud_mounted_once, "nodes/The HUD mounted once and was never unmounted")
  # The same context, with the HUD in the same state, holds the same native views every time it comes back.
  var seen: Dictionary = {}
  var same := true
  for reading: Dictionary in light_readings():
    var key := hud_key(reading)
    if seen.has(key):
      same = same and seen[key] == Sampler.number(reading.native)
    else:
      seen[key] = Sampler.number(reading.native)
  check(same and seen.size() >= 7, "nodes/The same context, with the HUD in the same state, holds the same native views every time it comes back (%d states)" % seen.size())
  var rested: Dictionary = {}
  var rests_same := true
  for row: Dictionary in stages.turns:
    var key := hud_key(row.rest.latest.merged({"panelOpen": row.rest.ui.get("panelOpen"), "pulse": row.rest.ui.get("pulse")}))
    var views := counter_of({"performance": row.rest.reading.performance}, "nativeViews")
    if rested.has(key):
      rests_same = rests_same and rested[key] == views
    else:
      rested[key] = views
  check(rests_same and rested.size() >= 1, "nodes/Every turn rests with the same native views as every other turn that rests in the same context")

func check_heap_and_memory() -> void:
  var rests := rest_readings()
  var heaps: Array = rests.map(func(reading: Dictionary) -> float: return Sampler.heap_of(reading))
  var steady: Array = heaps.slice(WARMUP_TURNS)
  var half := floori(steady.size() / 2.0)
  check(heaps.size() == TURNS and half >= 1 and float(steady.min()) > 0.0
    and median_of(steady.slice(steady.size() - half)) - median_of(steady.slice(0, half)) <= HEAP_GROWTH_LIMIT_BYTES,
    "heap/The live heap at rest, by the median of the last half of the steady turns, is within %d bytes of the first half's" % HEAP_GROWTH_LIMIT_BYTES)
  var rss: Array = rests.map(func(reading: Dictionary) -> float: return Sampler.number(reading.godot.rssKb))
  var steady_rss: Array = rss.slice(WARMUP_TURNS)
  check(rss.size() == TURNS and half >= 1 and float(steady_rss.min()) > 0.0
    and median_of(steady_rss.slice(steady_rss.size() - half)) - median_of(steady_rss.slice(0, half)) <= RSS_GROWTH_LIMIT_KB,
    "memory/The resident memory, by the median of the last half of the steady turns, is within %d KB of the first half's" % RSS_GROWTH_LIMIT_KB)
  var collected := true
  for reading: Dictionary in rests:
    collected = collected and Sampler.dig(Sampler.perf_of(reading), ["hermes", "collectedBeforeReading"]) == true \
      and Sampler.dig(Sampler.perf_of(reading), ["hermes", "source"]) == "jsi::Instrumentation::getHeapInfo"
  check(collected, "heap/Every reading of Hermes' heap follows a forced collection, so that two readings are comparable")

func check_errors() -> void:
  var host := true
  var registry := true
  var subscriptions := true
  var base_subscriptions := int(stages.base.registry.subscriptions)
  for reading: Dictionary in light_readings():
    host = host and int(reading.errors) == 0
    registry = registry and int(reading.registry.errors) == 0
    subscriptions = subscriptions and int(reading.registry.subscriptions) == base_subscriptions
  for row: Dictionary in stages.turns:
    host = host and int(row.rest.reading.host.errors) == 0
    registry = registry and int(row.rest.registry.errors) == 0
    subscriptions = subscriptions and int(row.rest.registry.subscriptions) == base_subscriptions
  check(host and registry, "errors/The application and the registry of the services saw no error at any reading")
  check(int(stages.faults.global) == 0 and int(stages.faults.rejections) == 0 and (stages.faults.handlers.errorUtils == true or stages.faults.handlers.rejectionTracker == true),
    "errors/No error and no promise rejection went unhandled in JavaScript, and a handler was watching")
  check(int(stages.control.rejections) == 1, "errors/The handler sees an unhandled rejection when there is one (the control after the soak)")
  check(subscriptions, "services/The registry holds the same number of subscriptions at every reading (a connection that is never removed would grow it)")

func check_hashes() -> void:
  var turns: Array = stages.turns
  var hashed: bool = turns.size() == TURNS
  var seen: Dictionary = {}
  for row: Dictionary in turns:
    hashed = hashed and str(row.hash) == str(row.serialization).sha256_text() and str(row.hash).length() == 64
    seen[str(row.hash)] = true
  check(hashed and stages.game.hash == stages.turns.back().hash and stages.game.hash == str(stages.game.serialization).sha256_text(),
    "hash/Every turn's hash is the SHA-256 of the canonical serialization of the game, and the last is the final one")
  check(seen.size() == TURNS, "hash/No two turns left the game in the same state (the trail has %d distinct hashes)" % TURNS)

func check_pause() -> void:
  var pause: Dictionary = {}
  for row: Dictionary in stages.turns:
    if int(row.turn) == PAUSE_TURN:
      pause = row.pause
  var rows_ok := not pause.is_empty()
  check(rows_ok and pause.before.phase == "ai_plan" and pause.before.job == pause.job and pause.during.paused == true and pause.during.phase == pause.before.phase
    and pause.still.phase == pause.before.phase and pause.during.job == pause.job and pause.during.rows == 1 and pause.still.rows == 1 and pause.during.turnEnded == 0,
    "pause/The accepted job stays at its first phase while the tree is paused: no phase runs, no snapshot is published, no turn ends")
  check(rows_ok and pause.during.frames >= PAUSE_FRAMES and pause.during.pumps > 0.0,
    "pause/The application keeps pumping while the tree is paused (the FabricApplication always processes)")
  check(rows_ok and not pause.markerBefore and pause.ui.clicksAfterFirst == pause.ui.clicksBefore + 1 and pause.ui.markerShown == true and pause.ui.pulseAfterFirst == true
    and pause.ui.clicksAfterSecond == pause.ui.clicksBefore + 2 and pause.ui.markerGone == true,
    "pause/The HUD answers while the game is paused: a click reaches the handler, React changes its state and the native node appears and goes")
  check(rows_ok and pause.finished == true and pause.rows.size() == JOB_SNAPSHOTS + 1,
    "pause/After the game resumes the job finishes normally: seven snapshots and one turn_ended")

func check_claims() -> void:
  var shut_world := true
  var open_claimed := true
  var panels := 0
  for row: Dictionary in stages.turns:
    if row.panel.is_empty():
      continue
    panels += 1
    shut_world = shut_world and int(row.panel.before.claim.presses) == 1 and int(row.panel.closed.claim.presses) == 1
    open_claimed = open_claimed and int(row.panel.open.claim.presses) == 0
  check(panels == TURNS and shut_world, "claim/A closed panel, however it was closed, does not claim the map: the world hears the click where the panel stood")
  check(panels == TURNS and open_claimed, "claim/An open panel claims the map: the world hears no press where it stands")

func check_panel() -> void:
  var opens := true
  var closes := true
  var count := 0
  for row: Dictionary in stages.turns:
    if row.panel.is_empty():
      continue
    count += 1
    var open_views := Sampler.number(row.panel.open.reading.native)
    var closed_views := Sampler.number(row.panel.closed.reading.native)
    if strategy == "unmount":
      opens = opens and row.panel.open.click.host.creates == 100.0 and row.panel.open.click.host.deletes == 0.0
      closes = closes and row.panel.closed.click.host.deletes == 100.0 and row.panel.closed.click.host.creates == 0.0 and open_views - closed_views == 100.0
    else:
      opens = opens and row.panel.open.click.host.creates == 0.0 and row.panel.open.click.host.deletes == 0.0
      closes = closes and row.panel.closed.click.host.creates == 0.0 and row.panel.closed.click.host.deletes == 0.0 and open_views == closed_views
  check(count == TURNS and opens, "panel/Opening the panel %s" % ("creates its 100 native nodes" if strategy == "unmount" else "creates and deletes no native node"))
  check(count == TURNS and closes, "panel/Closing the panel %s" % ("deletes its 100 native nodes" if strategy == "unmount" else "keeps its nodes (it is invisible, not gone)"))

func check_windows() -> void:
  var final: Dictionary = stages.final
  var windowed := true
  for path: Array in Sampler.SERIES_PATHS:
    var series: Variant = Sampler.dig(Sampler.perf_of(final), path)
    windowed = windowed and series is Dictionary and series.has("windowMs")
  check(windowed, "windows/The final reading carries the samples that the host's percentiles come from")

func evaluate() -> void:
  check_provenance()
  check_scene()
  check_turns()
  check_jobs()
  check_nodes()
  check_heap_and_memory()
  check_errors()
  check_hashes()
  check_pause()
  check_claims()
  check_panel()
  check_windows()

func _initialize() -> void:
  sabotage = OS.get_cmdline_user_args().has("--sabotage")
  for argument: String in OS.get_cmdline_user_args():
    if argument.begins_with("--strategy="):
      strategy = argument.trim_prefix("--strategy=")
  call_deferred("run_probe")

func finish_probe() -> void:
  application.call("stop")
  scene.queue_free()
  await settle(2)
  evaluate()
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var sabotage_rejected := sabotage and not failures.is_empty()
  var report := {"scenario": "frontier-soak", "reactNative": "0.87.1", "godot": Engine.get_version_info().string, "displayServer": DisplayServer.get_name(),
    "strategy": strategy, "checks": checks, "stages": stages, "sabotage": sabotage, "allCurrentAssertionsPassed": failures.is_empty(),
    "scope": {"publicReactNativeImport": true, "headlessOnly": true, "timingsAreRecordedNotJudged": true, "residentMemoryJudgedLoosely": true,
      "turnAndFreezeOpen": true, "mobileExportsCertified": false}}
  var output := FileAccess.open(REPORT, FileAccess.WRITE)
  if not check(output != null, "report/The soak report is saved with any normative failure visible"):
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  output.close()
  if sabotage_rejected:
    print("FRONTIER_SOAK_SABOTAGE_REJECTED: " + str(failures.size()))
  else:
    print("FRONTIER_SOAK_PASSED: " + str(checks.size()) if failures.is_empty() else "FRONTIER_SOAK_FAILED")
  quit(0 if failures.is_empty() or sabotage_rejected else 1)
