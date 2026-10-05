extends SceneTree

const FabricAPI = preload("res://sdk/addon/godot_fabric.gd")

class Source extends Node:
  signal unicode_changed(value: Dictionary)
  signal nodes_changed(value: Array)
  signal depth_changed(value)
  signal lifecycle_changed(value: int)
  var unicode_key := "é😀"
  var unicode_value := "ç🚀"
  var nodes_value: Array = []
  var depth_value: Variant
  var lifecycle_value := 3
  var marker := 1
  var calls := {"unicode": 0, "nodes": 0, "depth": 0, "generation": 0}
  var received_unicode: Dictionary = {}

  func _init() -> void:
    nodes_value.resize(9999)
    depth_value = nested(32)

  func nested(count: int) -> Variant:
    var value: Variant = null
    for index in range(count):
      value = [value]
    return value

  func read_unicode() -> Dictionary:
    return {unicode_key: unicode_value}

  func read_nodes() -> Array:
    return nodes_value

  func read_depth() -> Variant:
    return depth_value

  func read_lifecycle() -> int:
    return lifecycle_value

  func echo_unicode(value: Dictionary) -> Dictionary:
    calls.unicode += 1
    received_unicode = value.duplicate(true)
    return value

  func echo_nodes(value: Array) -> Array:
    calls.nodes += 1
    return value

  func echo_depth(value: Variant) -> Variant:
    calls.depth += 1
    return value

  func generation() -> int:
    calls.generation += 1
    return marker

var checks: Array = []
var application: Node
var surface: Control
var source: Source
var replacement: Source
var temporary: Source
var bindings: Dictionary = {}
var before_stop: Dictionary = {}

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

func frames(count: int = 8) -> void:
  for index in range(count):
    await process_frame

func status(node: Node) -> Dictionary:
  var value: Variant = JSON.parse_string(node.call("snapshot"))
  return value if value is Dictionary else {}

func stats() -> Dictionary:
  var value: Variant = JSON.parse_string(application.call("evaluate", "JSON.stringify(ServiceBoundaryFixture.stats())"))
  return value if value is Dictionary else {}

func wait_for(expression: String) -> bool:
  var deadline := Time.get_ticks_msec() + 5000
  while Time.get_ticks_msec() < deadline:
    if application.call("evaluate", "Boolean(" + expression + ")") == "true":
      await frames(2)
      return true
    await frames(1)
  return false

func schema_depth(count: int) -> Variant:
  var schema: Variant = "null"
  for index in range(count):
    schema = {"array": schema}
  return schema

func unicode_codes(value: String) -> Array:
  var result: Array = []
  for index in range(value.length()):
    result.append(value.unicode_at(index))
  return result

func codes_equal(actual: Array, expected: Array) -> bool:
  if actual.size() != expected.size():
    return false
  for index in range(actual.size()):
    if not typeof(actual[index]) in [TYPE_FLOAT, TYPE_INT] or actual[index] != float(expected[index]):
      return false
  return true

func unicode_summary_equal(summary: Dictionary, expected_value: Array) -> bool:
  var keys: Array = summary.get("keys", [])
  return summary.get("keyPresent", false) and keys.size() == 1 and keys[0] is Array and codes_equal(keys[0], [233, 128512]) and codes_equal(summary.get("valueCodes", []), expected_value)

func _initialize() -> void:
  call_deferred("run_probe")

func run_probe() -> void:
  source = Source.new()
  source.name = "BoundarySource"
  root.add_child(source)
  application = ClassDB.instantiate("FabricApplication")
  application.name = "BoundaryApplication"
  application.set_meta("scenario", "service-boundaries")
  root.add_child(application)
  var api = FabricAPI.for_application(application)
  bindings.unicode = api.bind_state("boundary.unicode", source.read_unicode, source.unicode_changed,
    {"object": {source.unicode_key: "string"}})
  bindings.nodes = api.bind_state("boundary.nodes", source.read_nodes, source.nodes_changed, {"array": "null"})
  bindings.depth = api.bind_state("boundary.depth", source.read_depth, source.depth_changed, schema_depth(32))
  bindings.lifecycle = api.bind_state("boundary.lifecycle", source.read_lifecycle, source.lifecycle_changed, "integer")
  bindings.echoUnicode = api.register_method("boundary.echoUnicode", source.echo_unicode,
    [{"object": {source.unicode_key: "string"}}], {"object": {source.unicode_key: "string"}})
  bindings.echoNodes = api.register_method("boundary.echoNodes", source.echo_nodes, [{"array": "null"}], {"array": "null"})
  bindings.echoDepth = api.register_method("boundary.echoDepth", source.echo_depth, [schema_depth(31)], schema_depth(31))
  bindings.generation = api.register_method("boundary.generation", source.generation, [], "integer")
  check(bindings.size() == 8 and bindings.values().all(func(binding: Variant) -> bool: return binding != null),
    "All boundary schemas and bindings register before mounting Hermes")
  check(unicode_codes(source.unicode_key) == [233, 128512] and unicode_codes(source.unicode_value) == [231, 128640],
    "Godot fixture constructs accented Unicode scalars and valid emoji pairs in keys and values")
  surface = ClassDB.instantiate("FabricSurface")
  surface.name = "BoundaryRoot"
  surface.set("application_path", NodePath("../BoundaryApplication"))
  surface.set("component_name", "ServicesBoundaryFixture")
  surface.size = Vector2(320, 200)
  root.add_child(surface)
  application.call("evaluate", "ServiceBoundaryFixture.start()")
  if not check(await wait_for("Object.keys(ServiceBoundaryFixture.stats().states).length === 4 && Object.values(ServiceBoundaryFixture.stats().states).every(state => state.ready)"),
      "Real Hermes connects every boundary state through the coordinated native protocol"):
    finish()
    return
  var initial := stats()
  check(status(application).get("rootCount", 0) == 1 and surface.call("get_surface_id") > 0,
    "Original RN AppRegistry mounts the isolated Fabric root")
  check(unicode_summary_equal(initial.states.unicode.snapshots[0], [231, 128640]),
    "Initial Godot-to-Hermes DTO preserves accented and supplementary Unicode keys and values")
  check(initial.states.nodes.snapshots[0].length == 9999 and initial.states.nodes.snapshots[0].allNull,
    "Initial state accepts exactly 10000 nodes including its value-array root")
  check(initial.states.depth.snapshots[0].depth == 32,
    "Initial state accepts a real DTO value at depth32")
  check(status(application).gameServices.subscriptions == 4, "Four ready logical connections own four native subscription IDs")

  source.unicode_value = "ã🧭"
  source.unicode_changed.emit(source.read_unicode())
  source.nodes_changed.emit(source.nodes_value)
  source.depth_changed.emit(source.depth_value)
  check(await wait_for("['unicode','nodes','depth'].every(key => ServiceBoundaryFixture.stats().states[key].snapshots.length === 2)"),
    "Values accepted in initial state also arrive through real typed native events")
  var updated := stats()
  check(unicode_summary_equal(updated.states.unicode.snapshots[1], [227, 129517]),
    "A state event retains the changed supplementary Unicode value and original key")
  check(updated.states.nodes.snapshots[1].length == 9999 and updated.states.nodes.snapshots[1].allNull,
    "The event tuple does not spend a data node from the 10000-node payload budget")
  check(updated.states.depth.snapshots[1].depth == 32, "The event tuple does not add a depth to the state payload")
  for label in ["unicode", "nodes", "depth"]:
    check(updated.states[label].snapshots[0].revision == 0 and updated.states[label].snapshots[1].revision == 1 and
      updated.states[label].snapshots[0].generation == updated.states[label].snapshots[1].generation,
      "Initial and updated boundary values retain monotonic revisions in one generation: " + label)

  application.call("evaluate", "ServiceBoundaryFixture.validCalls()")
  check(await wait_for("Object.keys(ServiceBoundaryFixture.stats().results).length === 3"),
    "All boundary calls settle through the original native Promise bridge")
  var called := stats()
  check(unicode_summary_equal(called.results.unicode, [231, 128640]),
    "JS-to-Godot-to-JS roundtrip preserves accented and supplementary Unicode keys and values")
  check(source.received_unicode.has(source.unicode_key) and unicode_codes(source.received_unicode.get(source.unicode_key, "")) == [231, 128640],
    "The actual GDScript method receives the exact Unicode scalars without replacement")
  check(called.results.nodes.length == 9998 and called.results.nodes.allNull and source.calls.nodes == 1,
    "A 10000-node args DTO executes with address metadata counted independently")
  check(called.results.depth.depth == 31 and source.calls.depth == 1,
    "A call accepts depth32 including its outer args-array root")
  application.call("evaluate", "ServiceBoundaryFixture.invalidCalls()")
  check(await wait_for("Object.keys(ServiceBoundaryFixture.stats().rejected).length === 62"),
    "Facade and direct native reject every over-limit, inadmissible-string or invalid-shape DTO asynchronously")
  var invalid := stats()
  var rejection_codes_match := true
  for label in invalid.rejected:
    var expected := "E_SERVICE_DTO"
    if label in ["nodesFacade", "nodesNative", "depthFacade", "depthNative"]:
      expected = "E_SERVICE_DTO_LIMIT"
    elif label.begins_with("nul") or label.begins_with("highSurrogate") or label.begins_with("lowSurrogate"):
      expected = "E_SERVICE_DTO_STRING"
    rejection_codes_match = rejection_codes_match and invalid.rejected[label] == expected
  check(rejection_codes_match, "Each DTO failure reports its precise size-limit, string or structural contract")
  check(invalid.getterCalls == 0, "Both copiers reject invalid keys and accessors without executing getters")
  check(source.calls == {"unicode": 1, "nodes": 1, "depth": 1, "generation": 0},
    "Rejected boundary calls do not execute or mutate a Godot owner")
  check(invalid.diagnostics.is_empty() and status(application).get("errors", []).is_empty(),
    "Handled Promise failures do not disguise an unexpected runtime or event error")

  application.call("evaluate", "ServiceBoundaryFixture.validShapes()")
  check(await wait_for("Object.keys(ServiceBoundaryFixture.stats().results).length === 7"),
    "Valid plain and null-prototype Unicode objects and native dense arrays still complete")
  var valid_shapes := stats()
  for label in ["unicodeNative", "nullPrototypeFacade", "nullPrototypeNative"]:
    check(unicode_summary_equal(valid_shapes.results[label], [231, 128640]),
      "A legitimate object preserves its Unicode keys and values through both DTO boundaries: " + label)
  check(valid_shapes.results.arrayNative.length == 2 and valid_shapes.results.arrayNative.allNull,
    "A direct native call retains every element of a legitimate dense Array")
  check(source.calls == {"unicode": 4, "nodes": 2, "depth": 1, "generation": 0} and valid_shapes.getterCalls == 0,
    "Only the seven valid boundary calls execute their Godot methods; no rejected DTO invokes a getter or Callable")

  # Emit before the next process frame, then invalidate the binding. Its normal
  # delivery must be canceled, and only its explicit terminal diagnostic lands.
  source.lifecycle_value = 4
  source.lifecycle_changed.emit(4)
  bindings.lifecycle.remove()
  bindings.lifecycle.remove()
  check(await wait_for("ServiceBoundaryFixture.stats().diagnostics.length === 1"),
    "Removing a binding reaches the public lifecycle diagnostic exactly once")
  check(stats().states.oldGeneration.snapshots.size() == 1 and stats().diagnostics[0].code == "E_SERVICE_BINDING_REMOVED",
    "Queued data cannot cross removal of its binding generation")
  source.lifecycle_value = 9
  bindings.lifecycle = api.bind_state("boundary.lifecycle", source.read_lifecycle, source.lifecycle_changed, "integer")
  application.call("evaluate", "ServiceBoundaryFixture.rebind()")
  check(await wait_for("ServiceBoundaryFixture.stats().states.newGeneration.ready"),
    "A removed address can reconnect to a fresh binding generation")
  check(stats().states.newGeneration.snapshots[0].value == 9 and
    stats().states.newGeneration.snapshots[0].generation != initial.states.oldGeneration.snapshots[0].generation,
    "Rebinding restores current game data under a distinct generation")

  application.call("evaluate", "ServiceBoundaryFixture.queueGeneration()")
  bindings.generation.remove()
  replacement = Source.new()
  replacement.marker = 2
  root.add_child(replacement)
  bindings.generation = api.register_method("boundary.generation", replacement.generation, [], "integer")
  check(await wait_for("ServiceBoundaryFixture.stats().rejected.generation === 'E_SERVICE_GENERATION'"),
    "A queued call cannot invoke the replacement behind the same address")
  check(source.calls.generation == 0 and replacement.calls.generation == 0,
    "Neither the old nor replacement method executes the stale queued call")
  application.call("evaluate", "ServiceBoundaryFixture.newGenerationCall()")
  check(await wait_for("ServiceBoundaryFixture.stats().results.newGeneration && ServiceBoundaryFixture.stats().results.newGeneration.value === 2"),
    "A new call executes the current method generation")

  application.call("evaluate", "ServiceBoundaryFixture.burst()")
  for value in range(100, 240):
    source.lifecycle_value = value
    source.lifecycle_changed.emit(value)
  var queued := status(application)
  check(queued.gameServices.pendingHostTasks == 70 and queued.gameServices.taskBudget == 64,
    "The native fixture queues real host work beyond one 64-task frame budget")
  check(queued.gameServices.pendingEvents == 140 and queued.gameServices.eventBudget == 128,
    "The native fixture queues real signals beyond one 128-event frame budget")
  check(await wait_for("ServiceBoundaryFixture.stats().burst.length === 70 && ServiceBoundaryFixture.stats().states.newGeneration.snapshots.length === 141 && ServiceBoundaryFixture.stats().clocks.frame === 1 && ServiceBoundaryFixture.stats().clocks.timer === 1"),
    "Budgeted service backlog completes while original RN timer and frame callbacks stay live")
  var burst := stats()
  check(burst.burst.size() == 70 and burst.burst.all(func(entry: Dictionary) -> bool: return entry.value == 2),
    "Every queued operation reaches the current game method without silent dropping")
  var ordered_calls := true
  for index in range(burst.burst.size()):
    ordered_calls = ordered_calls and burst.burst[index].ordinal == index
  check(ordered_calls, "Native operations preserve accepted call order across multiple host budgets")
  var ordered_events: bool = burst.states.newGeneration.snapshots.size() == 141
  for index in range(1, burst.states.newGeneration.snapshots.size()):
    var observed: Dictionary = burst.states.newGeneration.snapshots[index]
    ordered_events = ordered_events and observed.value == 99 + index and observed.revision == index
  check(ordered_events, "Every scalar event retains its value and revision across multiple event budgets")
  check(status(application).gameServices.pendingHostTasks == 0 and status(application).gameServices.pendingEvents == 0,
    "Native budgets drain the complete backlog without retaining task or event queues")

  temporary = Source.new()
  temporary.lifecycle_value = 7
  root.add_child(temporary)
  bindings.owner = api.bind_state("boundary.owner", temporary.read_lifecycle, temporary.lifecycle_changed, "integer")
  application.call("evaluate", "ServiceBoundaryFixture.watchOwner()")
  check(await wait_for("ServiceBoundaryFixture.stats().states.owner.ready"), "An independently owned source connects before deletion")
  temporary.lifecycle_changed.emit(8)
  temporary.queue_free()
  check(await wait_for("ServiceBoundaryFixture.stats().diagnostics.length === 2"), "Queued source deletion invalidates its subscription")
  check(not is_instance_valid(temporary) and stats().states.owner.snapshots.size() == 1 and stats().diagnostics[1].code == "E_SERVICE_OWNER",
    "Freed Godot owners cannot deliver queued values or retain native callback authority")

  application.call("evaluate", "ServiceBoundaryFixture.dispose(); ServiceBoundaryFixture.dispose()")
  check(status(application).gameServices.subscriptions == 0, "Repeated public cleanup releases every native subscription ID")
  application.call("evaluate", "ServiceBoundaryFixture.queueStop()")
  before_stop = status(application)
  var calls_before_stop: int = replacement.calls.generation
  check(before_stop.gameServices.pendingHostTasks == 1, "Shutdown begins with a real accepted host operation pending")
  application.call("stop")
  check(stats().rejected.get("stopped", "") == "E_SERVICE_STOPPED" and replacement.calls.generation == calls_before_stop,
    "Shutdown rejects queued work without executing its game Callable")
  application.call("evaluate", "ServiceBoundaryFixture.afterStop()")
  var stopped := status(application)
  application.call("stop")
  check(status(application) == stopped, "Repeated stop preserves finalized native service state")
  check(stopped.get("rootCount", -1) == 0 and stopped.nativeModules.loaded == 0 and stopped.nativeModules.stopped,
    "Shutdown retires every original Fabric root and native module")
  check(stopped.gameServices.stopped and stopped.gameServices.bindings == 0 and stopped.gameServices.subscriptions == 0 and
    stopped.gameServices.pendingHostTasks == 0 and stopped.gameServices.pendingEvents == 0,
    "Shutdown releases native binding, subscription and queued-work authority")
  check(stopped.pendingWork == 0 and stopped.pendingTimers == 0 and stopped.pendingAnimationFrames == 0 and stopped.errors.is_empty(),
    "Shutdown drains real RN work without unexpected error accounting")
  check(source.unicode_changed.get_connections().is_empty() and source.nodes_changed.get_connections().is_empty() and
    source.depth_changed.get_connections().is_empty() and source.lifecycle_changed.get_connections().is_empty(),
    "All real Godot signal connections are released by shutdown")
  finish()

func finish() -> void:
  var javascript := stats()
  checks.append_array(javascript.get("checks", []))
  if not status(application).get("stopped", false):
    application.call("evaluate", "if(globalThis.ServiceBoundaryFixture) ServiceBoundaryFixture.dispose()")
    application.call("stop")
  var report := {"scenario": "service-boundaries", "engine": "hermes", "renderer": "fabric",
    "godot": Engine.get_version_info().string, "reactNative": "0.87.1", "displayServer": DisplayServer.get_name(),
    "checks": checks, "javascript": javascript, "beforeStop": before_stop, "afterStop": status(application),
    "limits": {"depth": 32, "nodes": 10000, "eventTuple": "protocol; arguments share a budget at depth0", "callArgs": "one integral DTO root"},
    "strings": {"testedRoundtrip": "Accented and supplementary Unicode scalars in keys and values",
      "rejection": "E_SERVICE_DTO_STRING for NUL and unpaired UTF16 surrogates",
      "parityGap": "GF-25/1.0: Full JavaScript/JSON string-domain parity remains unresolved; rejection prevents data loss"}}
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://build"))
  var output := FileAccess.open("res://build/services-boundaries-report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_CHECK_FAILED: Cannot publish native service boundaries report")
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  surface.queue_free()
  application.queue_free()
  source.queue_free()
  if is_instance_valid(replacement):
    replacement.queue_free()
  await frames(2)
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  print("SERVICES_BOUNDARIES_FAILED" if failed else "SERVICES_BOUNDARIES_PASSED: " + str(checks.size()))
  quit(1 if failed else 0)
