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
# and not under res://.godot_fabric/. That the provisioned node does the same in a consumer project is criterion `consumidor`.
#
# The probe only reports. The roteiro's own session (a second FrontierGame in this process, never touched by the services)
# is the reference every step is compared with; the golden hash is fixed in tests/frontier-services-native.test.mjs; and
# tests/frontier-services-oracle.mjs judges the raw report, with the schemas derived from the TypeScript types.
#
#   --sabotage   a retained sabotage runs this probe: a failed check is the rejection, not an error
const Rules := preload("res://consumers/civ-lite/game/rules.gd")
const Game := preload("res://consumers/civ-lite/game/game.gd")
const Canon := preload("res://consumers/civ-lite/game/canon.gd")
const Replay := preload("res://consumers/civ-lite/game/replay.gd")
const GameServices := preload("res://consumers/civ-lite/services/game_services.gd")

const BUNDLE := "res://build/frontier-services-probe.js"
const REPORT := "res://build/frontier-services-report.json"
# The surface is unmounted after this many accepted end_turns, one step is played with no surface, and it is remounted.
const UNMOUNT_AFTER_TURNS := 3
const NEW_GAMES := 3
# What the registry must hold: the state, the signal and one method per intent.
const BINDINGS := 13

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

var checks: Array = []
var sabotage := false
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
    return {"snapshots": -1, "turnEnded": -1, "results": -1, "settled": -1, "panelSnapshots": -1, "stepsReceived": -1,
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
  var stand_in := ApplicationStandIn.new()
  stand_in.name = "Application"
  stand_in.bundle_path = BUNDLE
  services.add_child(stand_in)
  mount_surface_node()
  # The game node's _enter_tree connects to the stand-in's signal; the stand-in emits it from its own _enter_tree.
  root.add_child(services)
  application = services.get_node("Application/Runtime")

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

# ---- one step of the roteiro ----
# Plays the step in the reference session and, through the services, in the node's; and keeps what each side did.
func play(index: int, step: Dictionary, keep := true) -> Dictionary:
  var name := step_name(index, step)
  var before := counts()
  var node_callbacks := callbacks_total()
  var expected: Dictionary = Replay.run_step(shadow, step, false)
  if keep:
    run_js("FrontierServicesProbe.step(%d)" % index)
  else:
    # A step that is not in the roteiro the bundle holds: the same call, with the arguments sent along.
    run_js("FrontierServicesProbe.call(%s, %s, %s)" % [JSON.stringify(name), JSON.stringify("frontier." + step.intent), JSON.stringify(step.args)])
  var settled := await wait_for(func() -> bool: return int(counts().settled) >= int(before.results) + 1)
  check(settled, name + " settles")
  if expected.ok == 1:
    await wait_for(func() -> bool: return int(counts().snapshots) >= int(before.snapshots) + 1)
  # Everything an accepted intent publishes has arrived by now; what a refused one must not publish would have too.
  await settle(8)
  var after := counts()
  var seen: Dictionary = js("FrontierServicesProbe.since(%d, %d)" % [int(before.snapshots), int(before.turnEnded)])
  var latest: Dictionary = js("FrontierServicesProbe.latest()")
  var result: Dictionary = seen.result if seen.result != null else {}
  var snapshots_emitted := int(after.snapshots) - int(before.snapshots)
  var turn_ended_emitted := int(after.turnEnded) - int(before.turnEnded)
  var godot_snapshot: Dictionary = services.game.snapshot()
  var shadow_snapshot: Dictionary = shadow.snapshot()
  var js_text := canon(latest.value)
  var godot_text := canon(godot_snapshot)
  var shadow_text: String = services.game.serialize()
  var accepted_turn: bool = step.intent == "end_turn" and expected.ok == 1

  check(result.get("state") == "resolved" and result.get("method") == "frontier." + step.intent and result.get("response") == "completion",
    name + " is answered by a completed call of frontier." + step.intent)
  var answer: Dictionary = result.get("value", {}) if result.get("value") is Dictionary else {}
  check(sorted_keys(answer) == ["code", "ok", "text"] and answer.get("ok") == expected.ok and answer.get("code") == expected.code and answer.get("text") == expected.text,
    name + " answers the uniform {ok, code, text} the game gave the roteiro's own session")
  check(answer.get("code") == step.code, name + " answers " + step.code)
  check(snapshots_emitted == (1 if expected.ok == 1 else 0), name + " publishes the snapshot once if accepted and never if refused")
  check(turn_ended_emitted == (1 if accepted_turn else 0), name + " ends a turn exactly when an end_turn is accepted")
  var ended: Variant = seen.turnEnded[0].value if turn_ended_emitted == 1 else null
  if accepted_turn:
    check(ended is Dictionary and ended == {"turn": expected.turn, "phases": expected.phases}, name + " turn_ended carries the turn and phases the game reported")
    check(seen.turnEnded.size() == 1 and seen.snapshots.size() == 1 and int(seen.turnEnded[0].seq) < int(seen.snapshots[0].seq),
      name + " turn_ended comes before the snapshot of the turn that begins")
  check(js_text != "" and js_text == godot_text, name + " the snapshot JavaScript holds is the node's, field for field")
  check(godot_text == canon(shadow_snapshot), name + " the node's snapshot is the roteiro's own session's")
  check(shadow_text != "" and shadow_text == shadow.serialize() and services.game.state_hash() == shadow.state_hash(),
    name + " the node's state is the roteiro's own session's, byte for byte")
  check(services.game.context() == step.context, name + " leaves the context " + step.context)
  check(callbacks_total() == node_callbacks + 1, name + " ran the node's callback exactly once")
  var actions_tried := try_actions(latest.value.actions)
  check(actions_tried.all(action_sent_back), name + " every action of the snapshot, sent back as frontier.<id>(args) on a copy of the reference game, is accepted exactly when enabled")
  var size := measure(latest.value)
  var record := {"index": index, "label": step.label, "intent": step.intent, "args": step.args, "expectedCode": step.code, "context": step.context,
    "result": result, "snapshotsEmitted": snapshots_emitted, "turnEndedEmitted": turn_ended_emitted, "turnEnded": ended,
    "turnEndedSeq": int(seen.turnEnded[0].seq) if turn_ended_emitted == 1 else null,
    "snapshotSeq": int(seen.snapshots[0].seq) if seen.snapshots.size() >= 1 else null, "jsSnapshot": js_text, "godotSnapshot": godot_text,
    "revision": int(latest.revision), "generation": latest.generation, "serialization": shadow_text, "hash": services.game.state_hash(),
    "shadowHash": shadow.state_hash(), "actionsTried": actions_tried,
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
    var record := await play(index, step)
    if step.intent == "end_turn" and record.result.get("value", {}).get("ok") == 1:
      accepted_turns += 1
    if accepted_turns == UNMOUNT_AFTER_TURNS and unmounted_at == -1:
      unmounted_at = index
      persistence = await unmount_surface()
    elif unmounted_at != -1 and index == unmounted_at + 1:
      persistence = await remount_surface(persistence, index)
  return persistence

# What persists is what the node and the application own: the bindings, the state and the epoch. The surface is only a view.
func snapshot_of_persistence() -> Dictionary:
  var latest: Dictionary = js("FrontierServicesProbe.latest()")
  return {"bindings": int(registry().get("bindings", -1)), "generation": latest.generation, "epoch": services.epoch, "hash": services.game.state_hash(),
    "turn": int(services.game.state.turn), "sameNode": services.get_instance_id() == node_id, "sameGame": services.game.get_instance_id() == game_id,
    "registered": services.registered.size(), "snapshots": int(counts().snapshots)}

func unmount_surface() -> Dictionary:
  var before := snapshot_of_persistence()
  var mounts_before: Dictionary = counts().panel
  surface.call("unmount")
  await settle(8)
  var gone: Dictionary = counts().panel
  var native_state := native()
  check(not gone.connected and int(gone.cleanups) == int(mounts_before.cleanups) + 1 and int(native_state.rootCount) == 0,
    "persistence: unmounting the surface removes the panel's connection and the root")
  var unmounted := snapshot_of_persistence()
  check(unmounted == before, "persistence: unmounting leaves the bindings, the generation, the epoch and the state as they were")
  return {"before": before, "unmounted": unmounted, "unmountedAtTurn": before.turn}

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
  check(moved.hash != persistence.before.hash, "persistence: a step played with no surface at all changed the game, and the node answered it")
  persistence["moved"] = moved
  persistence["remounted"] = after
  persistence["firstPanelSnapshot"] = canon(first[0].value) if first.size() == 1 else ""
  persistence["firstPanelGeneration"] = first[0].generation if first.size() == 1 else ""
  persistence["playedUnmountedStep"] = index
  persistence["panel"] = panel_after
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
    check(answer == {"ok": 1, "code": "ok", "text": ""}, "epoch: new_game %d is accepted with the uniform result" % number)
    check(record.epoch == last_epoch + 1 and record.nodeEpoch == record.epoch, "epoch: new_game %d raises the epoch to %d" % [number, last_epoch + 1])
    check(record.snapshotsEmitted == 1 and record.turnEndedEmitted == 0 and record.callbacksDelta == 1, "epoch: new_game %d publishes one snapshot and no turn_ended" % number)
    check(record.hash == initial_hash and record.turn == 1 and record.context == "none", "epoch: new_game %d returns the scenario's initial state" % number)
    check(record.jsSnapshot == record.godotSnapshot, "epoch: new_game %d: the snapshot JavaScript holds is the node's" % number)
    last_epoch = record.epoch
    records.append(record)
  return records

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
    "registration: the node registered the state, the signal and the 11 methods while the application entered the tree")
  await wait_for(func() -> bool: return int(counts().snapshots) >= 1 or not counts().application.errors.is_empty(), 6000)
  await settle(8)
  var started := counts()
  var first: Variant = js("FrontierServicesProbe.latest()")
  var connected := check(int(started.application.snapshotReady) == 1 and int(started.application.signalReady) == 1 and started.application.errors.is_empty(),
    "registration: the bundle's first connections, made as it evaluated, were ready: no E_SERVICE_MISSING, no other error")
  var initial_ok := check(int(started.snapshots) == 1 and first is Dictionary and canon(first.value) == canon(services.game.snapshot()) and int(first.value.epoch) == 1,
    "registration: the first connection received the initial snapshot of epoch 1")
  check(int(started.stepsReceived) == Replay.STEPS.size(), "registration: the roteiro reached the JavaScript side as a prop, from replay.gd")
  check(int(registry().get("bindings", -1)) == BINDINGS and registry().get("stopped") == false, "registration: the registry holds the 13 bindings")
  check(native().errors.is_empty(), "registration: the application reports no error")
  var registration := {"application": started.application, "snapshots": started.snapshots, "inTime": registered_in_time}
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

  var final_native := native()
  check(final_native.errors.is_empty() and int(registry().get("bindings", -1)) == BINDINGS, "shutdown: no application error and the 13 bindings are still there")
  var report := {"scenario": "frontier-services", "reactNative": "0.87.1", "godot": Engine.get_version_info().string, "displayServer": DisplayServer.get_name(),
    "checks": checks, "sabotage": sabotage, "allPassed": checks.all(func(row: Dictionary) -> bool: return row.passed),
    "registered": registered_before_mount, "registration": registration, "bindings": BINDINGS, "steps": steps_report, "roteiroSteps": Replay.STEPS.size(),
    "finalHash": final_hash, "finalSerialization": final_serialization, "initialHash": initial_hash,
    "persistence": persistence, "violations": violations, "epochs": epochs, "liveStep": live_record,
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
  if failures.is_empty():
    print("FRONTIER_SERVICES_PASSED: " + str(checks.size()))
    print("FRONTIER_SERVICES_HASH: " + str(report.finalHash))
  elif sabotage:
    print("FRONTIER_SERVICES_SABOTAGE_REJECTED: " + str(failures.size()))
  else:
    print("FRONTIER_SERVICES_FAILED")
  quit(0 if failures.is_empty() or sabotage else 1)

func _initialize() -> void:
  sabotage = OS.get_cmdline_user_args().has("--sabotage")
  call_deferred("run_probe")
