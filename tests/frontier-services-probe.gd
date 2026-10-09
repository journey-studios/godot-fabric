extends SceneTree

# Frontier's services, run for real: the persistent GameServices node (consumers/civ-lite/services/game_services.gd) in the
# scene of a consumer, a FabricApplication with the bundle build/frontier-services-probe.js and a FabricSurface, in the
# official headless Godot on the root project. The bundle is a stand-in for the HUD (tests/frontier-services-fixture.jsx):
# it connects to the snapshot and to turn_ended through the public @godot-fabric/runtime and plays the 12-turn roteiro of
# the game (replay.gd, handed to it as a prop, never typed again) one call at a time, as the probe tells it to.
#
# The scene is the one consumers/minimal has: the game node, a child `Application` that emits `runtime_available` while it
# enters the tree, and the surface. The stand-in below does what sdk/addon/application_node.gd does (it builds the
# FabricApplication and emits the signal) without the Resource that node needs, because this probe's bundle lives in build/
# and not under res://.godot_fabric/. The provisioned node doing the same in a consumer project is criterion `consumidor`,
# which scripts/consumer-civ-lite-check.mjs runs (docs/research/frontier-consumer.md). The node names no path to the SDK:
# this probe injects the facade (`fabric_api`) as that consumer's main.tscn injects the addon's copy.
#
# The probe only reports. The roteiro's own session (a second FrontierGame in this process, never touched by the services)
# is the reference every step is compared with; the golden hash is fixed in tests/frontier-services-native.test.mjs; and
# tests/frontier-services-oracle.mjs judges the raw report, with the schemas derived from the TypeScript types.
#
# The end of a turn is a job (docs/research/frontier-services.md). The roteiro waits for each job to finish before its next
# step, and the report keeps, for every job, what JavaScript saw (a snapshot per phase, one turn_ended), the frame each
# snapshot was published in and what the registry held before and after the pump of that frame. The third job is run with
# the surface closed in the frame after it was accepted. After the epochs, a job lane runs jobs of its own: one that is sent
# intents while it runs, and the registry's budgets under 150 more subscribers of the snapshot.
#
#   --sabotage    a retained sabotage runs this probe: a failed check is the rejection, not an error
#   --rule-lane   runs only the rule lane: the first intents of the game, read from the snapshot JavaScript receives. The test runs
#                 it twice, once on the genuine rules and once with one constant of rules.gd mutated, with the same bundle
const Rules := preload("res://consumers/civ-lite/game/rules.gd")
const Game := preload("res://consumers/civ-lite/game/game.gd")
const Canon := preload("res://consumers/civ-lite/game/canon.gd")
const Replay := preload("res://consumers/civ-lite/game/replay.gd")
const GameServices := preload("res://consumers/civ-lite/services/game_services.gd")
# The laboratory keeps the SDK sources behind .gdignore, so the probe reaches the facade by path and hands it to the node,
# as a provisioned consumer's main.tscn hands it the addon's copy.
const FabricAPI := preload("res://sdk/addon/godot_fabric.gd")

const BUNDLE := "res://build/frontier-services-probe.js"
const REPORT := "res://build/frontier-services-report.json"
# The surface is unmounted after this many accepted end_turns, one step is played with no surface, and it is remounted.
const UNMOUNT_AFTER_TURNS := 3
const NEW_GAMES := 3
# What the registry must hold: the state, the signal and one method per intent, plus open_menu, which the scene answers.
const BINDINGS := 14
# An accepted end_turn publishes the snapshot of the first phase, and each of the six phases publishes the next one: the last
# is the turn that begins, at rest.
const JOB_SNAPSHOTS := 7
# The registry's budgets for one pump (docs/GAME_SERVICES.md).
const TASK_BUDGET := 64
const EVENT_BUDGET := 128
# Snapshot subscribers more than the application's and the panel's: each publication then holds more than 128 events.
const STRESS_SUBSCRIBERS := 150
const END_TURN_STEP := {"label": "", "intent": "end_turn", "args": [], "code": "ok", "context": "none"}
# What a HUD may send while a job runs. Each one is refused with turn_in_progress and changes nothing.
const DURING_JOB := [
  {"label": "select_tile", "method": "select_tile", "args": [6, 8]},
  {"label": "select_unit", "method": "select_unit", "args": [1]},
  {"label": "clear_selection", "method": "clear_selection", "args": []},
  {"label": "move_unit", "method": "move_unit", "args": [1, 7, 8]},
  {"label": "found_city", "method": "found_city", "args": [1]},
  {"label": "fortify", "method": "fortify", "args": [2]},
  {"label": "set_production", "method": "set_production", "args": ["warrior", 0]},
  {"label": "set_research", "method": "set_research", "args": ["alphabet"]},
  {"label": "resolve_event", "method": "resolve_event", "args": ["welcome"]},
  {"label": "end_turn again", "method": "end_turn", "args": []},
]

# Stands in for sdk/addon/application_node.gd: the FabricApplication is built while this node enters the tree, and the
# signal tells the game node, which connected to it from its own _enter_tree, to register before anything mounts.
class ApplicationStandIn extends Node:
  signal runtime_available(runtime: Node)
  var bundle_path := ""

  func _enter_tree() -> void:
    var runtime: Node = ClassDB.instantiate("FabricApplication")
    runtime.name = "Runtime"
    runtime.set("bundle_path", bundle_path)
    add_child(runtime)
    runtime_available.emit(runtime)

# Reads the registry in the middle of every frame it records: after the application's _process scheduled the host phase and
# before that deferred call ran, which the engine does after every _process of the frame. The probe reads it again at the start
# of the next frame, so a frame's pump is what lies between `before[frame]` and `after_start[frame + 1]`.
class Meter extends Node:
  var application: Node
  var recording := false
  var before := {}
  var after_start := {}

  func begin() -> void:
    before = {}
    after_start = {}
    recording = true

  func sample() -> Dictionary:
    var native: Dictionary = JSON.parse_string(application.call("snapshot"))
    var value: Variant = native.get("gameServices", {})
    var registry: Dictionary = value if value is Dictionary else {}
    return {"pendingHostTasks": int(registry.get("pendingHostTasks", -1)), "pendingEvents": int(registry.get("pendingEvents", -1)),
      "hostTasksRun": int(registry.get("hostTasksRun", -1)), "eventsSent": int(registry.get("eventsSent", -1))}

  func note_frame_start() -> void:
    if recording:
      after_start[Engine.get_process_frames()] = sample()

  func _process(_delta: float) -> void:
    if recording:
      before[Engine.get_process_frames()] = sample()

# What the node published, on the Godot side and with the frame it was published in. The signals' handlers are connected
# once; `rows` is only ever appended to.
class Recorder extends RefCounted:
  var rows: Array = []

  func on_snapshot(snapshot: Dictionary) -> void:
    rows.append({"kind": "snapshot", "frame": Engine.get_process_frames(), "turn": snapshot.turn, "phase": snapshot.phase, "last_job": snapshot.last_job})

  func on_turn_ended(summary: Dictionary) -> void:
    rows.append({"kind": "turn_ended", "frame": Engine.get_process_frames(), "turn": summary.turn, "job": summary.job})

var checks: Array = []
var sabotage := false
var rule_lane_only := false
var meter: Meter
var recorder: Recorder
# How many end_turns the reference session accepted: the id the next acceptance must carry.
var expected_jobs := 0
var services: Node
var application: Node
var surface: Control
var shadow: RefCounted
var steps_report: Array = []
# The identity of the node and of its first session, to show later that the very same ones answer.
var node_id := 0
var game_id := 0

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

func settle(count := 6) -> void:
  for index in range(count):
    await process_frame

func wait_for(condition: Callable, limit_ms: int = 4000) -> bool:
  var started := Time.get_ticks_msec()
  while Time.get_ticks_msec() - started < limit_ms and not condition.call():
    await process_frame
  return condition.call()

# ---- JavaScript and the registry ----
# JSON.parse_string answers every number as a float. The game's data is integers, so a whole float goes back to an int
# before it is compared with a snapshot or serialized by the canonical encoder, which refuses floats.
func intify(value: Variant) -> Variant:
  if typeof(value) == TYPE_FLOAT and value == floorf(value):
    return int(value)
  if typeof(value) == TYPE_DICTIONARY:
    var converted := {}
    for key: Variant in value:
      converted[key] = intify(value[key])
    return converted
  if typeof(value) == TYPE_ARRAY:
    var items := []
    for item: Variant in value:
      items.append(intify(item))
    return items
  return value

func js(expression: String) -> Variant:
  return intify(JSON.parse_string(application.call("evaluate", "JSON.stringify(" + expression + ")")))

func run_js(expression: String) -> void:
  application.call("evaluate", expression)

func native() -> Dictionary:
  return JSON.parse_string(application.call("snapshot"))

func registry() -> Dictionary:
  var value: Variant = native().get("gameServices", {})
  return value if value is Dictionary else {}

# The bundle's counters. Before the bundle has evaluated there is no fixture to ask, and the answer says so.
func counts() -> Dictionary:
  if not bundle_ready():
    return {"snapshots": -1, "turnEnded": -1, "results": -1, "settled": -1, "panelSnapshots": -1, "stepsReceived": -1, "attempts": -1,
      "attemptsSettled": -1, "arrivals": -1,
      "panel": {"mounts": -1, "cleanups": -1, "connected": false, "readyCount": -1, "error": null},
      "application": {"snapshotReady": -1, "signalReady": -1, "errors": []}}
  return js("FrontierServicesProbe.counts()")

func bundle_ready() -> bool:
  return native().get("runtimeInitialized", false) == true and str(application.call("evaluate", "typeof globalThis.FrontierServicesProbe")).contains("object")

func sorted_keys(value: Dictionary) -> Array:
  var keys := value.keys()
  keys.sort()
  return keys

# The canonical text of a snapshot, from either side: sorted keys, integers and strings only, "" if anything else.
func canon(value: Variant) -> String:
  return Canon.encode(intify(value))

# How many values a DTO has, as the transport counts them (every scalar and every container is one), and how deep it goes.
func measure(value: Variant, depth := 0) -> Dictionary:
  var nodes := 1
  var deepest := depth
  if typeof(value) == TYPE_DICTIONARY:
    for key: Variant in value:
      var inner := measure(value[key], depth + 1)
      nodes += int(inner.nodes)
      deepest = maxi(deepest, int(inner.depth))
  elif typeof(value) == TYPE_ARRAY:
    for item: Variant in value:
      var inner := measure(item, depth + 1)
      nodes += int(inner.nodes)
      deepest = maxi(deepest, int(inner.depth))
  return {"nodes": nodes, "depth": deepest}

func callbacks_total() -> int:
  var total := 0
  for method: String in services.callbacks:
    total += int(services.callbacks[method])
  return total

# The HUD's contract: an action is a call. Each action of the snapshot JavaScript holds is sent back as frontier.<id> with the
# arguments it carries and nothing else, on a copy of the reference session, never on the live one, so the roteiro's states
# stay as they are. It must name a registered method that takes that many arguments, be accepted exactly when it is enabled,
# and be refused with its reason otherwise.
func try_actions(actions: Array) -> Array:
  var tried := []
  for action: Dictionary in actions:
    var arity := -1
    for entry: Dictionary in services.registered:
      if entry.name == "frontier." + action.id and entry.kind == "method":
        arity = entry.args.size()
    # A call the method cannot take is not made: GDScript would raise its own error, and the check below reports it.
    var result := {"ok": -1, "code": "not_called"}
    if arity == action.args.size():
      result = shadow.duplicate_game().callv(action.id, action.args)
    tried.append({"id": action.id, "args": action.args, "enabled": action.enabled, "reason": action.reason, "arity": arity,
      "ok": result.ok, "code": result.code})
  return tried

func action_sent_back(entry: Dictionary) -> bool:
  return entry.arity == entry.args.size() and entry.ok == entry.enabled and (entry.ok == 1 or entry.code == entry.reason)

func step_name(index: int, step: Dictionary) -> String:
  return "step %02d %s%s" % [index, step.intent, JSON.stringify(step.args)]

# ---- the scene ----
func build_scene() -> void:
  services = GameServices.new()
  services.name = "GameServices"
  services.fabric_api = FabricAPI
  var stand_in := ApplicationStandIn.new()
  stand_in.name = "Application"
  stand_in.bundle_path = BUNDLE
  services.add_child(stand_in)
  mount_surface_node()
  # The meter goes last: its _process runs after the application's, which is what schedules the pump of the frame.
  meter = Meter.new()
  meter.name = "Meter"
  services.add_child(meter)
  recorder = Recorder.new()
  services.snapshot_changed.connect(recorder.on_snapshot)
  services.turn_ended.connect(recorder.on_turn_ended)
  process_frame.connect(meter.note_frame_start)
  # The game node's _enter_tree connects to the stand-in's signal; the stand-in emits it from its own _enter_tree.
  root.add_child(services)
  application = services.get_node("Application/Runtime")
  meter.application = application

func mount_surface_node() -> void:
  surface = ClassDB.instantiate("FabricSurface")
  surface.name = "Surface"
  surface.position = Vector2(0, 0)
  surface.size = Vector2(140, 60)
  surface.set("application_path", NodePath("../Application/Runtime"))
  surface.set("component_name", "FrontierServicesProbe")
  # The roteiro goes to the JavaScript side as a prop, from replay.gd itself.
  surface.set("initial_props", {"steps": Replay.STEPS.duplicate(true)})
  services.add_child(surface)

# What the node and the application own: the bindings, the generation they were registered under, the epoch, and that the node
# and its game are the ones from the start. Closing a screen leaves all of these as they were; the state moves with the job.
func owned(persisted: Dictionary) -> Dictionary:
  return {"bindings": persisted.bindings, "generation": persisted.generation, "epoch": persisted.epoch, "sameNode": persisted.sameNode,
    "sameGame": persisted.sameGame, "registered": persisted.registered}

# For each snapshot the node published, the frame it was published in and the registry before and after the pump of that frame.
func pump_rows(rows: Array) -> Array:
  var table := []
  for row: Dictionary in rows:
    if row.kind != "snapshot":
      continue
    var frame := int(row.frame)
    table.append({"frame": frame, "phase": row.phase, "before": meter.before.get(frame, {}), "after": meter.after_start.get(frame + 1, {})})
  return table

# The job the step accepted has finished: the node holds none, and JavaScript has its turn_ended. The snapshots that come with
# it are counted after the settling below, so that a node that publishes fewer is judged by the count and not by a wait.
func job_over(before: Dictionary) -> bool:
  return services.job == 0 and int(counts().turnEnded) >= int(before.turnEnded) + 1

# A call made while a job runs was refused by the game's own rule, with the code and the text of the game, and started no job.
func refused_in_progress(entry: Dictionary) -> bool:
  var value: Dictionary = entry.value if entry.value is Dictionary else {}
  var response := "acceptance" if entry.method == "frontier.end_turn" else "completion"
  return (entry.state == "resolved" and entry.response == response
    and value == {"ok": 0, "code": "turn_in_progress", "text": Rules.reason_text("turn_in_progress"), "job": 0})

# One pump is enough for the frame: it left nothing pending, ran at most 64 tasks and sent at most 128 events.
func pump_fits(entry: Dictionary) -> bool:
  if entry.before.is_empty() or entry.after.is_empty():
    return false
  return (int(entry.after.pendingHostTasks) == 0 and int(entry.after.pendingEvents) == 0
    and int(entry.after.hostTasksRun) - int(entry.before.hostTasksRun) <= TASK_BUDGET
    and int(entry.after.eventsSent) - int(entry.before.eventsSent) <= EVENT_BUDGET
    and int(entry.before.pendingEvents) <= EVENT_BUDGET)

# ---- one step of the roteiro ----
# Plays the step in the reference session and, through the services, in the node's; and keeps what each side did. An accepted
# end_turn is a job: the step ends when the job has, and the report keeps its progress, its frames and its pumps. `options`:
#   unmount   close the surface in the frame after the job was accepted, before its first phase, and let it run with no screen
#   during    calls to send while the job runs, each of which must be refused with turn_in_progress
func play(index: int, step: Dictionary, keep := true, options := {}) -> Dictionary:
  var name := step_name(index, step)
  var before := counts()
  var rows_from := recorder.rows.size()
  var node_callbacks := callbacks_total()
  var expected: Dictionary = Replay.run_step(shadow, step, false)
  var is_end_turn: bool = step.intent == "end_turn"
  var accepted_turn: bool = is_end_turn and expected.ok == 1
  var expected_job := 0
  if accepted_turn:
    expected_jobs += 1
    expected_job = expected_jobs
    # The reference session's owner is this probe: the job it accepted is finished, and its id is the last one.
    shadow.last_job = expected_job
  var turn_before := int(services.game.state.turn)
  var last_job_before := int(services.game.last_job)
  meter.begin()
  if keep:
    run_js("FrontierServicesProbe.step(%d)" % index)
  else:
    # A step that is not in the roteiro the bundle holds: the same call, with the arguments sent along.
    run_js("FrontierServicesProbe.call(%s, %s, %s)" % [JSON.stringify(name), JSON.stringify("frontier." + step.intent), JSON.stringify(step.args)])
  var unmount := {}
  if accepted_turn and options.get("unmount", false):
    await wait_for(func() -> bool: return services.job != 0)
    unmount = await unmount_during_job()
  var settled := await wait_for(func() -> bool: return int(counts().settled) >= int(before.results) + 1)
  check(settled, name + " settles")
  var during: Array = options.get("during", [])
  var attempts_made: Array = []
  var phase_at_attempts := ""
  if accepted_turn and not during.is_empty():
    phase_at_attempts = str(services.game.state.phase)
    for entry: Dictionary in during:
      run_js("FrontierServicesProbe.during(%s, %s, %s)" % [JSON.stringify(entry.label), JSON.stringify("frontier." + entry.method), JSON.stringify(entry.args)])
    await wait_for(func() -> bool: return int(counts().attemptsSettled) >= int(before.attempts) + during.size())
    var every_attempt: Array = js("FrontierServicesProbe.attempts()")
    attempts_made = every_attempt.slice(int(before.attempts))
    check(phase_at_attempts != "idle", name + " the calls made while the job runs were sent with the turn in progress (phase " + phase_at_attempts + ")")
  if accepted_turn:
    await wait_for(job_over.bind(before))
  elif expected.ok == 1:
    await wait_for(func() -> bool: return int(counts().snapshots) >= int(before.snapshots) + 1)
  # Everything an accepted intent publishes has arrived by now; what a refused one must not publish would have too.
  await settle(8)
  meter.recording = false
  var after := counts()
  var seen: Dictionary = js("FrontierServicesProbe.since(%d, %d)" % [int(before.snapshots), int(before.turnEnded)])
  var latest: Dictionary = js("FrontierServicesProbe.latest()")
  var result: Dictionary = seen.result if seen.result != null else {}
  var snapshots_emitted := int(after.snapshots) - int(before.snapshots)
  var turn_ended_emitted := int(after.turnEnded) - int(before.turnEnded)
  var expected_snapshots := JOB_SNAPSHOTS if accepted_turn else (1 if expected.ok == 1 else 0)
  var godot_snapshot: Dictionary = services.game.snapshot()
  var shadow_snapshot: Dictionary = shadow.snapshot()
  var js_text := canon(latest.value)
  var godot_text := canon(godot_snapshot)
  var shadow_text: String = services.game.serialize()
  var response := "acceptance" if is_end_turn else "completion"

  check(result.get("state") == "resolved" and result.get("method") == "frontier." + step.intent and result.get("response") == response,
    name + " is answered by a " + ("job accepted" if is_end_turn else "completed call") + " of frontier." + step.intent)
  var answer: Dictionary = result.get("value", {}) if result.get("value") is Dictionary else {}
  check(sorted_keys(answer) == ["code", "job", "ok", "text"] and answer.get("ok") == expected.ok and answer.get("code") == expected.code
    and answer.get("text") == expected.text and answer.get("job") == expected_job,
    name + " answers the uniform {ok, code, text, job} the game gave the roteiro's own session, with the job it started")
  check(answer.get("code") == step.code, name + " answers " + step.code)
  check(snapshots_emitted == expected_snapshots, name + (" publishes the seven snapshots of its job if accepted and none if refused" if is_end_turn
    else " publishes the snapshot once if accepted and never if refused"))
  check(turn_ended_emitted == (1 if accepted_turn else 0), name + " ends a turn exactly when an end_turn is accepted")
  var ended: Variant = seen.turnEnded[0].value if turn_ended_emitted == 1 else null
  var job_record := {}
  if accepted_turn:
    check(ended is Dictionary and ended == {"turn": expected.turn, "phases": expected.phases, "job": expected_job},
      name + " turn_ended carries the turn, phases and job the game reported")
    check(seen.turnEnded.size() == 1 and seen.snapshots.size() == JOB_SNAPSHOTS
      and int(seen.snapshots[JOB_SNAPSHOTS - 2].seq) < int(seen.turnEnded[0].seq) and int(seen.turnEnded[0].seq) < int(seen.snapshots[JOB_SNAPSHOTS - 1].seq),
      name + " turn_ended comes before the snapshot of the turn that begins, and after that of the last phase")
    var progress: Array = js("FrontierServicesProbe.progressLog(%d)" % int(before.snapshots))
    var phases_seen: Array = progress.map(func(entry: Dictionary) -> String: return entry.phase)
    var phases_expected: Array = Rules.PHASES.duplicate()
    phases_expected.append("idle")
    check(phases_seen == phases_expected, name + " JavaScript saw the turn go through every phase and arrive at rest")
    var last_jobs_seen: Array = progress.map(func(entry: Dictionary) -> int: return int(entry.last_job))
    var turns_seen: Array = progress.map(func(entry: Dictionary) -> int: return int(entry.turn))
    check(last_jobs_seen == [last_job_before, last_job_before, last_job_before, last_job_before, last_job_before, last_job_before, expected_job]
      and turns_seen == [turn_before, turn_before, turn_before, turn_before, turn_before, turn_before, turn_before + 1],
      name + " the snapshots show the old turn and the old last_job until the job finishes, then the turn that begins and last_job = the job")
    var rows: Array = recorder.rows.slice(rows_from)
    var snapshot_rows: Array = rows.filter(func(row: Dictionary) -> bool: return row.kind == "snapshot")
    var consecutive := snapshot_rows.size() == JOB_SNAPSHOTS
    for position in range(1, snapshot_rows.size()):
      consecutive = consecutive and int(snapshot_rows[position].frame) == int(snapshot_rows[position - 1].frame) + 1
    check(consecutive, name + " the node ran one phase a frame: its seven snapshots were published in seven consecutive frames")
    var table := pump_rows(rows)
    check(table.size() == JOB_SNAPSHOTS and table.all(pump_fits), name + " every frame of the job fit in one pump: nothing pending after it, at most 64 tasks and 128 events")
    check(int(services.finished_jobs.get(expected_job, 0)) == 1 and services.job == 0, name + " the game finished job " + str(expected_job) + " exactly once")
    job_record = {"id": expected_job, "rows": rows, "pumps": table, "progress": progress, "finishedCount": int(services.finished_jobs.get(expected_job, 0)),
      "attempts": attempts_made, "phaseAtAttempts": phase_at_attempts, "unmount": unmount}
    if not during.is_empty():
      check(attempts_made.size() == during.size() and attempts_made.all(refused_in_progress),
        name + " every call made while the job ran was refused with turn_in_progress and started no job")
  check(js_text != "" and js_text == godot_text, name + " the snapshot JavaScript holds is the node's, field for field")
  check(godot_text == canon(shadow_snapshot), name + " the node's snapshot is the roteiro's own session's")
  check(shadow_text != "" and shadow_text == shadow.serialize() and services.game.state_hash() == shadow.state_hash(),
    name + " the node's state is the roteiro's own session's, byte for byte")
  check(services.game.context() == step.context, name + " leaves the context " + step.context)
  check(callbacks_total() == node_callbacks + 1 + attempts_made.size(), name + " ran the node's callback exactly once, and one for each call made while the job ran")
  var actions_tried := try_actions(latest.value.actions)
  check(actions_tried.all(action_sent_back), name + " every action of the snapshot, sent back as frontier.<id>(args) on a copy of the reference game, is accepted exactly when enabled")
  var size := measure(latest.value)
  var record := {"index": index, "label": step.label, "intent": step.intent, "args": step.args, "expectedCode": step.code, "context": step.context,
    "result": result, "snapshotsEmitted": snapshots_emitted, "turnEndedEmitted": turn_ended_emitted, "turnEnded": ended,
    "turnEndedSeq": int(seen.turnEnded[0].seq) if turn_ended_emitted == 1 else null,
    "snapshotSeq": int(seen.snapshots[0].seq) if seen.snapshots.size() >= 1 else null, "jsSnapshot": js_text, "godotSnapshot": godot_text,
    "revision": int(latest.revision), "generation": latest.generation, "serialization": shadow_text, "hash": services.game.state_hash(),
    "shadowHash": shadow.state_hash(), "actionsTried": actions_tried, "job": job_record,
    "turn": int(services.game.state.turn), "nodes": size.nodes, "depth": size.depth}
  if keep:
    steps_report.append(record)
  return record

# ---- the roteiro, then the epochs ----
func run_roteiro() -> Dictionary:
  var persistence := {}
  var accepted_turns := 0
  var unmounted_at := -1
  for index in Replay.STEPS.size():
    var step: Dictionary = Replay.STEPS[index]
    # The surface is closed during the job of the third accepted end_turn, in the frame after the game accepted it.
    var closes_screen: bool = step.intent == "end_turn" and step.code == "ok" and accepted_turns == UNMOUNT_AFTER_TURNS - 1
    var record := await play(index, step, true, {"unmount": true} if closes_screen else {})
    if step.intent == "end_turn" and record.result.get("value", {}).get("ok") == 1:
      accepted_turns += 1
    if closes_screen:
      unmounted_at = index
      persistence = record.job.unmount
    elif unmounted_at != -1 and index == unmounted_at + 1:
      persistence = await remount_surface(persistence, index)
  return persistence

# What persists is what the node and the application own: the bindings, the state and the epoch. The surface is only a view.
func snapshot_of_persistence() -> Dictionary:
  var latest: Dictionary = js("FrontierServicesProbe.latest()")
  return {"bindings": int(registry().get("bindings", -1)), "generation": latest.generation, "epoch": services.epoch, "hash": services.game.state_hash(),
    "turn": int(services.game.state.turn), "sameNode": services.get_instance_id() == node_id, "sameGame": services.game.get_instance_id() == game_id,
    "registered": services.registered.size(), "snapshots": int(counts().snapshots)}

# The screen is closed in the frame after the node accepted the job, before the first phase ran, and the job goes on with no
# surface and no root: the node drives it, not the screen. The report keeps the frame it closed in, the roots the application held
# during the job and, once the job is over, what the node and the application own.
func unmount_during_job() -> Dictionary:
  var before := snapshot_of_persistence()
  var job_id := int(services.job)
  var phase_at_unmount := str(services.game.state.phase)
  var turn_at_unmount := int(services.game.state.turn)
  var finished_at_unmount := int(services.finished_jobs.get(job_id, 0))
  var mounts_before: Dictionary = counts().panel
  var unmount_frame := Engine.get_process_frames()
  surface.call("unmount")
  await settle(2)
  var root_counts: Array = []
  var frames_unmounted := 0
  while services.job != 0 and frames_unmounted < 60:
    root_counts.append(int(native().rootCount))
    await process_frame
    frames_unmounted += 1
  await settle(2)
  var gone: Dictionary = counts().panel
  var native_state := native()
  check(not gone.connected and int(gone.cleanups) == int(mounts_before.cleanups) + 1 and int(native_state.rootCount) == 0,
    "persistence: unmounting the surface removes the panel's connection and the root")
  check(phase_at_unmount != "idle" and finished_at_unmount == 0 and root_counts.size() >= 1 and root_counts.all(func(count: int) -> bool: return count == 0),
    "persistence: the surface was closed with the job accepted and not run (phase " + phase_at_unmount + "), and the job went on with rootCount 0")
  var unmounted := snapshot_of_persistence()
  check(owned(unmounted) == owned(before), "persistence: unmounting leaves the bindings, the generation, the epoch, the node and its game as they were")
  check(int(services.finished_jobs.get(job_id, 0)) == 1 and services.job == 0 and int(services.game.state.turn) == turn_at_unmount + 1,
    "persistence: the job finished with no surface, exactly once, and the game's turn advanced")
  return {"before": before, "unmounted": unmounted, "unmountedAtTurn": before.turn,
    "job": {"id": job_id, "phaseAtUnmount": phase_at_unmount, "turnAtUnmount": turn_at_unmount, "finishedAtUnmount": finished_at_unmount,
      "rootCounts": root_counts, "unmountFrame": unmount_frame, "turnAfterJob": int(services.game.state.turn),
      "finishedCount": int(services.finished_jobs.get(job_id, 0))}}

# Called after one more step has been played with no surface: the node answered it, so the state moved on without a view.
func remount_surface(persistence: Dictionary, index: int) -> Dictionary:
  var moved := snapshot_of_persistence()
  var panel_before: Dictionary = counts().panel
  var panel_snapshots_before := int(counts().panelSnapshots)
  surface.call("mount")
  await wait_for(func() -> bool: return int(counts().panel.readyCount) >= int(panel_before.readyCount) + 1)
  await settle(6)
  var panel_after: Dictionary = counts().panel
  var after := snapshot_of_persistence()
  var first: Array = js("FrontierServicesProbe.panelSince(%d)" % panel_snapshots_before)
  check(panel_after.connected and int(panel_after.mounts) == int(panel_before.mounts) + 1 and panel_after.error == null,
    "persistence: the remounted root reconnects")
  check(first.size() == 1 and canon(first[0].value) == canon(services.game.snapshot()),
    "persistence: the remounted root's first value is the current snapshot of the game")
  check(first.size() == 1 and first[0].generation == persistence.before.generation,
    "persistence: the remounted root connects to the same registration generation: nothing was registered again")
  check(after.bindings == persistence.before.bindings and after.registered == persistence.before.registered and after.epoch == persistence.before.epoch
    and after.sameNode and after.sameGame,
    "persistence: the node, its game, its bindings and its epoch are the ones from before the unmount")
  check(moved.hash != persistence.before.hash, "persistence: a job and a step played with no surface at all changed the game, and the node answered them")
  var job: Dictionary = persistence.job
  var panel_first: Dictionary = first[0].value if first.size() == 1 else {}
  check(panel_first.get("phase") == "idle" and int(panel_first.get("turn", 0)) == int(job.turnAtUnmount) + 1 and int(panel_first.get("last_job", -1)) == int(job.id),
    "persistence: the remounted root's first snapshot is at rest, in the turn the job advanced to, with last_job = the job that finished while it was closed")
  var ended_log: Array = js("FrontierServicesProbe.turnEndedLog()")
  var for_job: Array = ended_log.filter(func(entry: Dictionary) -> bool: return int(entry.job) == int(job.id))
  check(for_job.size() == 1 and int(services.finished_jobs.get(int(job.id), 0)) == 1,
    "persistence: the application's own turn_ended subscription received job " + str(job.id) + " exactly once, with the screen closed and after the remount, and the game finished it once")
  persistence["moved"] = moved
  persistence["remounted"] = after
  persistence["firstPanelSnapshot"] = canon(first[0].value) if first.size() == 1 else ""
  persistence["firstPanelGeneration"] = first[0].generation if first.size() == 1 else ""
  persistence["playedUnmountedStep"] = index
  persistence["panel"] = panel_after
  job["firstPanel"] = {"phase": panel_first.get("phase"), "turn": panel_first.get("turn"), "last_job": panel_first.get("last_job")}
  job["turnEndedForJob"] = for_job.size()
  job["finishedCount"] = int(services.finished_jobs.get(int(job.id), 0))
  return persistence

# ---- violations: a JS caller that breaks the schema ----
func violation(label: String, name: String, args: Array) -> Dictionary:
  var before := counts()
  var node_callbacks := callbacks_total()
  var hash_before: String = services.game.state_hash()
  run_js("FrontierServicesProbe.call(%s, %s, %s)" % [JSON.stringify(label), JSON.stringify(name), JSON.stringify(args)])
  await wait_for(func() -> bool: return int(counts().settled) >= int(before.results) + 1)
  await settle(6)
  var after := counts()
  var seen: Dictionary = js("FrontierServicesProbe.since(%d, %d)" % [int(before.snapshots), int(before.turnEnded)])
  var record := {"label": label, "name": name, "args": args, "result": seen.result,
    "callbacksDelta": callbacks_total() - node_callbacks, "snapshotsEmitted": int(after.snapshots) - int(before.snapshots),
    "turnEndedEmitted": int(after.turnEnded) - int(before.turnEnded), "hashUnchanged": services.game.state_hash() == hash_before}
  return record

func run_violations() -> Array:
  var cases := [
    {"label": "wrong type", "name": "frontier.select_tile", "args": ["6", 8]},
    {"label": "wrong type, a fraction", "name": "frontier.move_unit", "args": [1, 7.5, 8]},
    {"label": "wrong type, a number for a string", "name": "frontier.set_research", "args": [7]},
    {"label": "wrong type, a string for an integer", "name": "frontier.set_production", "args": ["warrior", "0"]},
    {"label": "arity, too few", "name": "frontier.select_tile", "args": [6]},
    {"label": "arity, too many", "name": "frontier.select_unit", "args": [1, 2]},
    {"label": "arity, an argument for a method with none", "name": "frontier.end_turn", "args": [1]},
    {"label": "arity, none for a method with one", "name": "frontier.found_city", "args": []},
    {"label": "extra field, an object with an extra field for an integer", "name": "frontier.select_unit", "args": [{"unit_id": 1, "extra": 2}]},
    {"label": "extra field, an object for a string", "name": "frontier.resolve_event", "args": [{"choice_id": "welcome"}]},
  ]
  var records := []
  for entry: Dictionary in cases:
    var record := await violation(entry.label, entry.name, entry.args)
    var error: Dictionary = record.result.get("error", {}) if record.result.get("error") is Dictionary else {}
    check(record.result.get("state") == "rejected" and error.get("code") == "E_SERVICE_SCHEMA",
      "schema: " + entry.label + " (" + entry.name + ") rejects with E_SERVICE_SCHEMA")
    check(record.callbacksDelta == 0 and record.snapshotsEmitted == 0 and record.turnEndedEmitted == 0 and record.hashUnchanged,
      "schema: " + entry.label + " (" + entry.name + ") never ran GDScript, published nothing and changed nothing")
    records.append(record)
  # The control for the detector: a service that was never registered answers something else.
  var missing := await violation("a service that was never registered", "frontier.nope", [])
  var missing_error: Dictionary = missing.result.get("error", {}) if missing.result.get("error") is Dictionary else {}
  check(missing.result.get("state") == "rejected" and missing_error.get("code") == "E_SERVICE_MISSING",
    "schema: a service that was never registered rejects with E_SERVICE_MISSING, so the check for its absence can fail")
  records.append(missing)
  return records

# ---- epochs: a new game ----
func run_epochs(initial_hash: String) -> Array:
  var records := []
  var last_epoch := int(services.epoch)
  for number in range(1, NEW_GAMES + 1):
    var before := counts()
    var node_callbacks := callbacks_total()
    run_js("FrontierServicesProbe.call('new game %d', 'frontier.new_game', [])" % number)
    await wait_for(func() -> bool: return int(counts().snapshots) >= int(before.snapshots) + 1)
    await settle(8)
    var after := counts()
    var seen: Dictionary = js("FrontierServicesProbe.since(%d, %d)" % [int(before.snapshots), int(before.turnEnded)])
    var latest: Dictionary = js("FrontierServicesProbe.latest()")
    var value: Dictionary = latest.value
    var answer: Dictionary = seen.result.get("value", {}) if seen.result.get("value") is Dictionary else {}
    var record := {"number": number, "epoch": int(value.epoch), "nodeEpoch": int(services.epoch), "hash": services.game.state_hash(), "turn": int(value.turn),
      "snapshotsEmitted": int(after.snapshots) - int(before.snapshots), "turnEndedEmitted": int(after.turnEnded) - int(before.turnEnded),
      "result": answer, "jsSnapshot": canon(value), "godotSnapshot": canon(services.game.snapshot()), "context": value.context,
      "callbacksDelta": callbacks_total() - node_callbacks}
    check(answer == {"ok": 1, "code": "ok", "text": "", "job": 0}, "epoch: new_game %d is accepted with the uniform result, and starts no job" % number)
    check(record.epoch == last_epoch + 1 and record.nodeEpoch == record.epoch, "epoch: new_game %d raises the epoch to %d" % [number, last_epoch + 1])
    check(record.snapshotsEmitted == 1 and record.turnEndedEmitted == 0 and record.callbacksDelta == 1, "epoch: new_game %d publishes one snapshot and no turn_ended" % number)
    check(record.hash == initial_hash and record.turn == 1 and record.context == "none", "epoch: new_game %d returns the scenario's initial state" % number)
    check(record.jsSnapshot == record.godotSnapshot, "epoch: new_game %d: the snapshot JavaScript holds is the node's" % number)
    last_epoch = record.epoch
    records.append(record)
  return records

# ---- the job lane ----
# What became of a publication that holds more events than one pump sends. Right after the node published, nothing has been
# pumped: `generated` events wait, and the pump of every frame sends at most 128 of them, in the order they were queued. The
# pumps are counted as pumps (a frame that sent something), never as time.
func drain(label: String) -> Dictionary:
  var start := registry()
  var generated := int(start.get("pendingEvents", -1))
  var sent_from := int(start.get("eventsSent", -1))
  var tasks_from := int(start.get("hostTasksRun", -1))
  var last_sent := sent_from
  var pumps: Array = []
  var frames := 0
  while int(registry().get("pendingEvents", -1)) > 0 and frames < 30:
    await process_frame
    frames += 1
    var sent := int(registry().get("eventsSent", -1))
    if sent > last_sent:
      pumps.append(sent - last_sent)
    last_sent = sent
  var end := registry()
  return {"label": label, "generated": generated, "pumps": pumps, "frames": frames, "pendingAfter": int(end.get("pendingEvents", -1)),
    "pendingTasksAfter": int(end.get("pendingHostTasks", -1)), "tasksRun": int(end.get("hostTasksRun", -1)) - tasks_from,
    "eventsSent": int(end.get("eventsSent", -1)) - sent_from}

# A publication that held more than one pump's events drained in as many pumps as its events take, none above the budget.
func drain_fits(entry: Dictionary) -> bool:
  return (int(entry.generated) > EVENT_BUDGET and entry.pumps.size() == ceili(int(entry.generated) / float(EVENT_BUDGET))
    and int(entry.pendingAfter) == 0 and entry.pumps.all(within_budget))

func within_budget(sent: int) -> bool:
  return sent <= EVENT_BUDGET

# What the extra subscribers received after the given number of arrivals, against what the node published.
func delivery(arrivals_from: int) -> Dictionary:
  await settle(6)
  return js("FrontierServicesProbe.subscribersSince(%d)" % arrivals_from)

# The same publications with more subscribers than one pump can serve. First each phase on its own, driven by the node's own
# advance_job with its frame driver off, so that a phase drains before the next is published; then the node's driver on,
# one phase per frame, outrunning the pump. In both, every subscriber receives exactly one snapshot per publication, in order.
func run_stress() -> Dictionary:
  var subscriptions_base := int(registry().get("subscriptions", -1))
  var panel_connected: bool = counts().panel.connected
  run_js("FrontierServicesProbe.addSubscribers(%d)" % STRESS_SUBSCRIBERS)
  var all_ready := await wait_for(func() -> bool: return int(js("FrontierServicesProbe.subscribers()").ready) == STRESS_SUBSCRIBERS, 8000)
  await settle(6)
  var subscribers: Dictionary = js("FrontierServicesProbe.subscribers()")
  check(all_ready and subscribers.errors.is_empty() and int(registry().get("subscriptions", -1)) == subscriptions_base + STRESS_SUBSCRIBERS
    and int(registry().get("pendingEvents", -1)) == 0 and int(registry().get("pendingHostTasks", -1)) == 0,
    "stress: %d more module-scope subscribers of the snapshot connected, with nothing left pending" % STRESS_SUBSCRIBERS)
  var arrivals_from := int(counts().arrivals)
  var initial_revision := int(js("FrontierServicesProbe.latest()").revision)

  # One phase at a time.
  shadow.end_turn()
  expected_jobs += 1
  shadow.last_job = expected_jobs
  var isolated_job := expected_jobs
  var turn_before := int(services.game.state.turn)
  services.set_process(false)
  var accepted: Dictionary = services.end_turn()
  var drains: Array = [await drain("accepted")]
  for phase: String in Rules.PHASES:
    services.advance_job()
    drains.append(await drain(phase))
  services.set_process(true)
  var isolated := await delivery(arrivals_from)
  check(accepted.ok == 1 and accepted.job == isolated_job and services.job == 0 and int(services.finished_jobs.get(isolated_job, 0)) == 1
    and int(services.game.state.turn) == turn_before + 1 and services.game.state_hash() == shadow.state_hash(),
    "stress: the job driven a phase at a time finished once and left the reference session's state")
  check(drains.size() == JOB_SNAPSHOTS and drains.all(drain_fits),
    "stress: every publication held more than 128 events and drained in ceil(events / 128) pumps, nothing left pending")

  # The node's own driver, one phase per frame.
  var free_arrivals_from := int(counts().arrivals)
  shadow.end_turn()
  expected_jobs += 1
  shadow.last_job = expected_jobs
  var free_job := expected_jobs
  var free_registry := registry()
  var free_sent_from := int(free_registry.get("eventsSent", -1))
  var free_accepted: Dictionary = services.end_turn()
  var pending_series: Array = [int(registry().get("pendingEvents", -1))]
  var free_pumps: Array = []
  var last_sent := free_sent_from
  var frames := 0
  while (services.job != 0 or int(registry().get("pendingEvents", -1)) > 0) and frames < 60:
    await process_frame
    frames += 1
    var now := registry()
    var sent := int(now.get("eventsSent", -1))
    if sent > last_sent:
      free_pumps.append(sent - last_sent)
    last_sent = sent
    pending_series.append(int(now.get("pendingEvents", -1)))
  var free := await delivery(free_arrivals_from)
  var free_total := last_sent - free_sent_from
  check(free_accepted.ok == 1 and free_accepted.job == free_job and services.job == 0 and int(services.finished_jobs.get(free_job, 0)) == 1
    and services.game.state_hash() == shadow.state_hash(),
    "stress: the job driven by the node, a phase a frame, finished once and left the reference session's state")
  check(free_pumps.size() == ceili(free_total / float(EVENT_BUDGET)) and free_pumps.all(within_budget) and int(registry().get("pendingEvents", -1)) == 0,
    "stress: a job that outran the pump (a phase a frame) drained in ceil(events / 128) pumps and left nothing pending")

  run_js("FrontierServicesProbe.removeSubscribers()")
  await settle(6)
  check(int(registry().get("subscriptions", -1)) == subscriptions_base and int(registry().get("pendingEvents", -1)) == 0,
    "stress: removing the extra subscribers leaves the registry with the subscriptions it had")
  return {"subscribers": STRESS_SUBSCRIBERS, "panelConnected": panel_connected, "initialRevision": initial_revision, "subscriptionsBase": subscriptions_base,
    "isolated": {"job": isolated_job, "accepted": accepted, "drains": drains, "arrivals": isolated.arrivals, "received": isolated.received},
    "free": {"job": free_job, "accepted": free_accepted, "pumps": free_pumps, "pending": pending_series, "eventsSent": free_total,
      "arrivals": free.arrivals, "received": free.received}}

# A job that is sent every kind of call while it runs, and the budgets under many subscribers.
func run_job_lane() -> Dictionary:
  var burst := await play(Replay.STEPS.size() + 1, END_TURN_STEP, false, {"during": DURING_JOB})
  var stress := await run_stress()
  return {"burst": burst, "stress": stress}

# ---- the rule lane ----
# One intent through the services, read from the snapshot JavaScript received: the same on the genuine rules and on the
# mutated ones, so that the only difference is what Godot decided.
func lane_step(name: String, method: String, args: Array) -> Dictionary:
  var before := counts()
  run_js("FrontierServicesProbe.call(%s, %s, %s)" % [JSON.stringify(name), JSON.stringify(method), JSON.stringify(args)])
  await wait_for(func() -> bool: return int(counts().settled) >= int(before.results) + 1)
  var seen: Dictionary = js("FrontierServicesProbe.since(%d, %d)" % [int(before.snapshots), int(before.turnEnded)])
  var result: Dictionary = seen.result if seen.result != null else {}
  var answer: Dictionary = result.get("value", {}) if result.get("value") is Dictionary else {}
  if answer.get("ok") == 1:
    await wait_for(func() -> bool: return int(counts().snapshots) >= int(before.snapshots) + 1)
  await settle(6)
  var latest: Dictionary = js("FrontierServicesProbe.latest()")
  var js_text := canon(latest.value)
  check(js_text != "" and js_text == canon(services.game.snapshot()), "rule lane: " + name + ": the snapshot JavaScript holds is the node's")
  return {"name": name, "method": method, "args": args, "result": answer, "snapshot": js_text, "hash": services.game.state_hash()}

func run_rule_lane() -> Dictionary:
  var initial: Dictionary = js("FrontierServicesProbe.latest()")
  var rows := [{"name": "initial", "method": "", "args": [], "result": {}, "snapshot": canon(initial.value), "hash": services.game.state_hash()}]
  rows.append(await lane_step("select the stack", "frontier.select_tile", [6, 8]))
  rows.append(await lane_step("select the Settler", "frontier.select_unit", [1]))
  rows.append(await lane_step("move the Settler into the forest", "frontier.move_unit", [1, 7, 8]))
  return {"settlerMoves": Rules.UNITS.settler.moves, "rows": rows}

func run_probe() -> void:
  root.size = Vector2i(480, 80)
  var initial_hash: String = Game.new().state_hash()
  shadow = Game.new(Rules.SEED, 1)
  check(DisplayServer.get_name() == "headless", "environment: the official Godot runs headless")
  build_scene()
  node_id = services.get_instance_id()
  game_id = services.game.get_instance_id()
  # Registration happened while the tree was entered, before anything mounted or evaluated.
  var registered_before_mount: Array = services.registered.duplicate(true)
  var registered_in_time := check(services.registered.size() == BINDINGS and services.bindings.size() == BINDINGS
    and services.bindings.all(func(binding: Variant) -> bool: return binding != null),
    "registration: the node registered the state, the signal and the 12 methods while the application entered the tree")
  await wait_for(func() -> bool: return int(counts().snapshots) >= 1 or not counts().application.errors.is_empty(), 6000)
  await settle(8)
  var started := counts()
  var first: Variant = js("FrontierServicesProbe.latest()")
  var connected := check(int(started.application.snapshotReady) == 1 and int(started.application.signalReady) == 1 and started.application.errors.is_empty(),
    "registration: the bundle's first connections, made as it evaluated, were ready: no E_SERVICE_MISSING, no other error")
  var initial_ok := check(int(started.snapshots) == 1 and first is Dictionary and canon(first.value) == canon(services.game.snapshot()) and int(first.value.epoch) == 1,
    "registration: the first connection received the initial snapshot of epoch 1")
  check(int(started.stepsReceived) == Replay.STEPS.size(), "registration: the roteiro reached the JavaScript side as a prop, from replay.gd")
  check(int(registry().get("bindings", -1)) == BINDINGS and registry().get("stopped") == false, "registration: the registry holds the 14 bindings")
  check(native().errors.is_empty(), "registration: the application reports no error")
  var registration := {"application": started.application, "snapshots": started.snapshots, "inTime": registered_in_time}
  if registered_in_time and connected and initial_ok and rule_lane_only:
    var lane := await run_rule_lane()
    check(native().errors.is_empty(), "rule lane: the application reports no error")
    finish({"scenario": "frontier-services-rule-lane", "reactNative": "0.87.1", "godot": Engine.get_version_info().string, "displayServer": DisplayServer.get_name(),
      "checks": checks, "sabotage": false, "allPassed": checks.all(func(row: Dictionary) -> bool: return row.passed), "registered": registered_before_mount,
      "registration": registration, "ruleLane": lane, "native": {"gameServices": registry(), "errors": native().errors}, "callbacks": services.callbacks})
    return
  if not (registered_in_time and connected and initial_ok):
    # Nothing can be observed through services that were not there when the bundle asked: report what is known.
    finish({"scenario": "frontier-services", "reactNative": "0.87.1", "godot": Engine.get_version_info().string, "displayServer": DisplayServer.get_name(),
      "checks": checks, "sabotage": sabotage, "allPassed": false, "registered": registered_before_mount, "registration": registration, "steps": [],
      "roteiroSteps": Replay.STEPS.size(), "native": {"gameServices": registry(), "errors": native().errors}, "callbacks": services.callbacks})
    return

  var persistence := await run_roteiro()
  var final_hash: String = services.game.state_hash()
  var final_serialization: String = services.game.serialize()
  var final_nodes := 0
  var final_depth := 0
  var largest := {"nodes": 0, "depth": 0, "step": -1}
  for record: Dictionary in steps_report:
    if int(record.nodes) > int(largest.nodes):
      largest = {"nodes": record.nodes, "depth": record.depth, "step": record.index}
    final_depth = maxi(final_depth, int(record.depth))
    final_nodes = maxi(final_nodes, int(record.nodes))
  check(final_nodes < 10000 and final_depth < 32, "limits: the largest snapshot of the roteiro is below 10,000 nodes and depth 32")
  var violations := await run_violations()
  var epochs := await run_epochs(initial_hash)
  # The new game is a live session: an intent after the last new_game is answered, in the last epoch. The reference session
  # starts over with it.
  shadow = Game.new(Rules.SEED, int(services.epoch))
  var live: Dictionary = Replay.STEPS[2]
  var live_record := await play(Replay.STEPS.size(), live, false)
  var live_snapshot: Dictionary = js("FrontierServicesProbe.latest()").value
  check(int(live_snapshot.epoch) == NEW_GAMES + 1 and live_record.result.get("value", {}).get("ok") == 1,
    "epoch: the game after the last new_game answers an intent in its own epoch")
  var job_lane := await run_job_lane()
  var finished_report := {}
  for job_id: int in services.finished_jobs:
    finished_report[str(job_id)] = services.finished_jobs[job_id]
  var turn_ended_log: Array = js("FrontierServicesProbe.turnEndedLog()")
  check(turn_ended_log.map(func(entry: Dictionary) -> int: return int(entry.job)) == range(1, expected_jobs + 1),
    "jobs: the application's own turn_ended subscription received jobs 1 to %d, each once, in order" % expected_jobs)
  check(services.finished_jobs.size() == expected_jobs and services.finished_jobs.values().all(func(count: int) -> bool: return count == 1) and services.job == 0
    and services.next_job == expected_jobs + 1, "jobs: the game finished each of its %d jobs exactly once, and none is left" % expected_jobs)

  var final_native := native()
  check(final_native.errors.is_empty() and int(registry().get("bindings", -1)) == BINDINGS, "shutdown: no application error and the 14 bindings are still there")
  var report := {"scenario": "frontier-services", "reactNative": "0.87.1", "godot": Engine.get_version_info().string, "displayServer": DisplayServer.get_name(),
    "checks": checks, "sabotage": sabotage, "allPassed": checks.all(func(row: Dictionary) -> bool: return row.passed),
    "registered": registered_before_mount, "registration": registration, "bindings": BINDINGS, "steps": steps_report, "roteiroSteps": Replay.STEPS.size(),
    "finalHash": final_hash, "finalSerialization": final_serialization, "initialHash": initial_hash,
    "persistence": persistence, "violations": violations, "epochs": epochs, "liveStep": live_record, "jobLane": job_lane,
    "jobs": {"expected": expected_jobs, "turnEndedLog": turn_ended_log, "finished": finished_report, "next": services.next_job, "running": services.job},
    "limits": {"maxNodes": final_nodes, "maxDepth": final_depth, "largest": largest, "nodeLimit": 10000, "depthLimit": 32},
    "native": {"gameServices": registry(), "errors": final_native.errors}, "callbacks": services.callbacks}
  finish(report)

func finish(report: Dictionary) -> void:
  services.queue_free()
  await settle(2)
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var output := FileAccess.open(REPORT, FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_ERROR: cannot write the frontier services report")
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  output.close()
  if failures.is_empty() and rule_lane_only:
    print("FRONTIER_SERVICES_RULE_LANE_PASSED: " + str(checks.size()))
  elif failures.is_empty():
    print("FRONTIER_SERVICES_PASSED: " + str(checks.size()))
    print("FRONTIER_SERVICES_HASH: " + str(report.finalHash))
  elif sabotage:
    print("FRONTIER_SERVICES_SABOTAGE_REJECTED: " + str(failures.size()))
  else:
    print("FRONTIER_SERVICES_FAILED")
  quit(0 if failures.is_empty() or sabotage else 1)

func _initialize() -> void:
  sabotage = OS.get_cmdline_user_args().has("--sabotage")
  rule_lane_only = OS.get_cmdline_user_args().has("--rule-lane")
  call_deferred("run_probe")
