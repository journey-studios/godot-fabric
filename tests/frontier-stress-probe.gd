extends SceneTree

# The comparison's stress mode through the node and the registry, run for real (docs/research/frontier-stress.md): the persistent GameServices node
# (consumers/civ-lite/services/game_services.gd) with a FabricApplication that has no bundle, so no JavaScript, in the official headless Godot on the root
# project. It plays the three intents of the mode and checks what the node answers and publishes, what the registry accepts of it (the snapshot's
# schema has one optional field, `stress`, which the registry's validator now allows) and what its counters say; and it checks the validator itself,
# with states of its own that must accept the optional field absent and present and refuse a wrong type, a field the declaration does not name, a
# missing required field and an optional that is not an object's field.
#
#   --sabotage    a retained sabotage runs this probe: a failed check is the rejection, not an error
const Rules := preload("res://consumers/civ-lite/game/rules.gd")
const Canon := preload("res://consumers/civ-lite/game/canon.gd")
const Snapshot := preload("res://consumers/civ-lite/game/snapshot.gd")
const GameServices := preload("res://consumers/civ-lite/services/game_services.gd")
const FabricAPI := preload("res://sdk/addon/godot_fabric.gd")
const REPORT := "res://build/frontier-stress-report.json"
const STEPS := 20

# Stands in for sdk/addon/application_node.gd (see tests/frontier-services-probe.gd): the FabricApplication is built while this node enters the tree.
class ApplicationStandIn extends Node:
  signal runtime_available(runtime: Node)

  func _enter_tree() -> void:
    var runtime: Node = ClassDB.instantiate("FabricApplication")
    runtime.name = "Runtime"
    add_child(runtime)
    runtime_available.emit(runtime)

# A state of the validator's own: a value to publish and the signal that says it changed.
class Source extends Node:
  signal changed(value: Dictionary)
  var value := {}

  func read() -> Dictionary:
    return value

  func publish(next: Dictionary) -> void:
    value = next
    changed.emit(next)

var checks: Array = []
var sabotage := false
var report := {}
var services: Node
var application: Node


func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition and not sabotage:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition


func frames(count: int) -> void:
  for _index in range(count):
    await process_frame


func registry() -> Dictionary:
  var native: Dictionary = JSON.parse_string(application.call("snapshot"))
  var value: Variant = native.get("gameServices", {})
  return value if value is Dictionary else {}


func errors() -> Array:
  return registry().get("errors", [])


func _initialize() -> void:
  sabotage = OS.get_cmdline_user_args().has("--sabotage")
  call_deferred("run")


func run() -> void:
  services = GameServices.new()
  services.name = "GameServices"
  services.fabric_api = FabricAPI
  var stand_in := ApplicationStandIn.new()
  stand_in.name = "Application"
  services.add_child(stand_in)
  root.add_child(services)
  application = stand_in.get_node("Runtime")
  await frames(4)
  report["bindings"] = int(registry().get("bindings", -1))
  check(report.bindings == 18 and errors().is_empty(), "The node registered the two states, the signal and 15 methods (the three of the stress mode among them) and the registry took the snapshot's schema, its optional field included")
  await run_mode()
  await run_validator()
  finish()


func run_mode() -> void:
  var game: RefCounted = services.game
  var hash_start: String = game.state_hash()
  var published: Array = []
  var recorder := func(snapshot: Dictionary) -> void: published.append(snapshot)
  services.snapshot_changed.connect(recorder)
  var before_text := Canon.encode(services.get_snapshot())
  var emitted_start := int(services.notifications_emitted())

  # Off: a step and an end are refused, and nothing is published.
  var off_step: Dictionary = services.stress_step()
  var off_end: Dictionary = services.stress_end()
  report["off"] = {"step": off_step, "end": off_end, "published": published.size()}
  check(int(off_step.ok) == 0 and off_step.code == "stress_off" and off_step.text == Rules.reason_text("stress_off") and int(off_end.ok) == 0 and off_end.code == "stress_off"
    and published.is_empty(), "With the mode off, a step and an end are refused with stress_off and publish nothing")

  # A turn runs: begin is refused with the game's own code and text.
  var accepted: Dictionary = services.end_turn()
  var during: Dictionary = services.stress_begin()
  while int(services.job) != 0:
    await process_frame
  report["during"] = {"accepted": accepted.code, "refused": during, "carried": published.any(func(snapshot: Dictionary) -> bool: return snapshot.has("stress"))}
  check(accepted.code == "ok" and int(during.ok) == 0 and during.code == "turn_in_progress" and during.text == Rules.reason_text("turn_in_progress") and not report.during.carried,
    "Begin while a turn runs is refused with turn_in_progress, and no snapshot of the turn carries the mode")
  await frames(2)
  published.clear()
  before_text = Canon.encode(services.get_snapshot())
  var state_before: String = game.state_hash()
  var log_before: int = game.state.log.size()
  var emitted_before := int(services.notifications_emitted())
  var revisions_before: Dictionary = application.call("service_delivery", "frontier.snapshot")

  # On.
  var begun: Dictionary = services.stress_begin()
  var carried: Dictionary = services.get_snapshot()
  var stress: Dictionary = carried.get("stress", {})
  report["begun"] = {"result": begun, "published": published.size(), "log": stress.get("log", []).size(), "production": stress.get("production", []).size(),
    "first": stress.get("log", [""])[0], "frozen": Snapshot.is_frozen(carried)}
  check(int(begun.ok) == 1 and published.size() == 1 and published[0].has("stress") and stress.log.size() == 200 and stress.production.size() == 100 and Snapshot.is_frozen(carried),
    "Begin publishes one snapshot that carries a log of 200 lines and a production list of 100 items, frozen like the rest of it")
  var again: Dictionary = services.stress_begin()
  report["again"] = again
  check(int(again.ok) == 0 and again.code == "stress_on" and again.text == Rules.reason_text("stress_on") and published.size() == 1, "A second begin is refused with stress_on and publishes nothing")

  # Twenty steps.
  var results: Array = []
  var last_lines: Array = []
  for _index in range(STEPS):
    results.append(services.stress_step())
    await process_frame
  var after: Dictionary = services.get_snapshot().stress
  report["steps"] = {"results": results, "published": published.size(), "lines": after.log.size(), "first": after.log[0], "last": after.log[after.log.size() - 1],
    "progress": after.production.map(func(item: Dictionary) -> int: return int(item.progress))}
  check(results.all(func(result: Dictionary) -> bool: return int(result.ok) == 1) and published.size() == 1 + STEPS and after.log.size() == 200
    and after.log[0].begins_with("00021") and after.log[199].begins_with("00220") and after.production.size() == 100,
    "Twenty steps publish twenty snapshots, keep the log at 200 lines (the oldest twenty dropped) and the list at 100 items")
  check(after.production.all(func(item: Dictionary) -> bool: return int(item.progress) == (1 if int(item.id) < STEPS else 0)), "A step changes one item: the first twenty have one more of progress, the rest none")
  check(published[1].stress.log[0].begins_with("00002") and published[STEPS].stress.log[0].begins_with("00021") and carried.stress.log[0].begins_with("00001"),
    "A snapshot already published never changes: each carries its own copy of the lists")

  # Outside the game's state.
  var hash_during: String = game.state_hash()
  report["state"] = {"before": state_before, "during": hash_during, "start": hash_start, "log": [log_before, game.state.log.size()]}
  check(hash_during == state_before and game.state.log.size() == log_before and game.state.log.size() <= Rules.LOG_MAX,
    "The mode is outside the game: its state hash and its own log (at most 32 lines) did not move")

  # Off again.
  var ended: Dictionary = services.stress_end()
  var after_text := Canon.encode(services.get_snapshot())
  report["ended"] = {"result": ended, "identical": before_text == after_text, "published": published.size(), "carries": services.get_snapshot().has("stress"), "length": [before_text.length(), after_text.length()]}
  check(int(ended.ok) == 1 and not services.get_snapshot().has("stress") and before_text == after_text and published.size() == 2 + STEPS and not published[published.size() - 1].has("stress"),
    "End publishes a snapshot with no stress, and the snapshot is byte for byte the one before the mode began")
  await frames(3)

  # The counters: every publication counted, and the registry's own revisions agree.
  var emitted := int(services.notifications_emitted()) - emitted_before
  var revisions_after: Dictionary = application.call("service_delivery", "frontier.snapshot")
  report["counters"] = {"emitted": emitted, "published": published.size(), "revisionsBefore": revisions_before, "revisionsAfter": revisions_after, "errors": errors()}
  check(emitted == published.size() and int(revisions_after.emitted) - int(revisions_before.emitted) == published.size() and bool(revisions_after.bound) and int(revisions_after.sent) == 0,
    "The node counts every publication, the registry's revision of the snapshot grew by as many, and with no subscriber nothing was handed to JavaScript")
  check(errors().is_empty(), "The registry took every snapshot of the mode, with the field and without it")
  check(int(application.call("service_delivery", "nothing.here").bound) == 0 and int(application.call("service_delivery", "nothing.here").emitted) == 0, "The counters of a name that is not registered are zero")

  # A new game leaves the mode.
  services.stress_begin()
  services.new_game()
  report["newGame"] = {"carries": services.get_snapshot().has("stress"), "step": services.stress_step()}
  check(not report.newGame.carries and report.newGame.step.code == "stress_off", "A new game leaves the mode")
  services.snapshot_changed.disconnect(recorder)


# The optional field of the schema language, through real bindings on the real registry.
func run_validator() -> void:
  var api = FabricAPI.for_application(application)
  var schema := {"object": {"a": "integer", "b": {"optional": "string"}}}
  var accepted := Source.new()
  accepted.name = "Accepted"
  root.add_child(accepted)
  var binding = api.bind_state("validator.accepted", accepted.read, accepted.changed, schema)
  accepted.publish({"a": 1})
  accepted.publish({"a": 2, "b": "x"})
  await frames(2)
  var after_valid := errors().size()
  var cases := {
    "wrongType": {"a": 1, "b": 2},
    "unknownField": {"a": 1, "c": 2},
    "missingRequired": {"b": "x"},
  }
  var rejected := {}
  var sources: Array = []
  for label: String in cases:
    var source := Source.new()
    source.name = "Rejected" + label
    root.add_child(source)
    sources.append(source)
    var held = api.bind_state("validator." + label, source.read, source.changed, schema)
    var before := errors().size()
    source.publish(cases[label])
    await frames(2)
    rejected[label] = errors().size() == before + 1 and String(errors()[errors().size() - 1]).contains("exact declared schema")
    held = held
  # An optional that is not an object's field has no meaning, and the registry refuses the schema when it is registered: three FABRIC_ERROR lines, which
  # the test counts, and no binding made.
  var refusals := {}
  for label: String in ["root", "element", "argument"]:
    var before := int(registry().get("bindings", -1))
    var broken
    var source := Source.new()
    source.name = "Broken" + label
    root.add_child(source)
    sources.append(source)
    if label == "root":
      broken = api.bind_state("validator.broken.root", source.read, source.changed, {"optional": "integer"})
    elif label == "element":
      broken = api.bind_state("validator.broken.element", source.read, source.changed, {"array": {"optional": "integer"}})
    else:
      broken = api.register_method("validator.broken.argument", source.read, [{"optional": "integer"}], "integer")
    broken = broken
    # Each refusal is logged by the application (FABRIC_ERROR) and registers nothing.
    refusals[label] = int(registry().get("bindings", -1)) == before
  report["validator"] = {"accepted": binding != null, "errorsAfterValid": after_valid, "rejected": rejected, "refusals": refusals}
  check(binding != null and after_valid == 0, "The registry accepts a value with the optional field absent and with it present")
  check(rejected.values().all(func(ok: bool) -> bool: return ok), "The registry refuses an optional field of the wrong type, a field the declaration does not name and a missing required field: " + str(rejected))
  check(refusals.values().all(func(ok: bool) -> bool: return ok), "The registry refuses a schema whose optional is not an object's field: " + str(refusals))


func finish() -> void:
  report["checks"] = checks
  report["sabotage"] = sabotage
  var output := FileAccess.open(REPORT, FileAccess.WRITE)
  output.store_string(JSON.stringify(report, "  ") + "\n")
  output.close()
  var failures := checks.filter(func(entry: Dictionary) -> bool: return not entry.passed)
  if failures.is_empty():
    print("FRONTIER_STRESS_PASSED")
  elif sabotage:
    print("FRONTIER_STRESS_REJECTED: %d" % failures.size())
  else:
    print("FRONTIER_STRESS_FAILED")
  quit(0 if failures.is_empty() or sabotage else 1)
