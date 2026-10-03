extends SceneTree

const FabricAPI = preload("res://sdk/addon/godot_fabric.gd")

class Source extends Node:
  signal changed(value: int)
  var victim: WeakRef
  var calls := 0
  var returned := false
  var destroyed_synchronously := false

  func read() -> int:
    return 10

  func destroy() -> int:
    calls += 1
    var target: Node = victim.get_ref()
    target.free()
    destroyed_synchronously = victim.get_ref() == null
    returned = true
    return 77

var checks: Array = []
var observations: Dictionary = {}

func check(condition: bool, name: String) -> void:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)

func frames(count: int = 8) -> void:
  for index in range(count):
    await process_frame

func snapshot(node: Node) -> Dictionary:
  var result: Variant = JSON.parse_string(node.call("snapshot"))
  return result if result is Dictionary else {}

func create_application(name: String) -> Node:
  var node: Node = ClassDB.instantiate("FabricApplication")
  node.name = name
  node.set_meta("scenario", "service-boundaries")
  root.add_child(node)
  return node

func create_surface(name: String, application_name: String) -> Control:
  var node: Control = ClassDB.instantiate("FabricSurface")
  node.name = name
  node.set("application_path", NodePath("../" + application_name))
  node.set("component_name", "ServicesLifetimeFixture")
  node.size = Vector2(320, 200)
  root.add_child(node)
  return node

func _initialize() -> void:
  call_deferred("run_probe")

func run_probe() -> void:
  var source := Source.new()
  root.add_child(source)
  var stopped := create_application("StoppedBeforeMount")
  var token: Object = FabricAPI.for_application(stopped).bind_state("early.state", source.read, source.changed, "integer")
  check(token != null and snapshot(stopped).gameServices.bindings == 1,
    "Service registration exists before any Hermes or Fabric root is initialized")
  check(not snapshot(stopped).runtimeInitialized and not snapshot(stopped).stopped,
    "An unmounted application reports its pre-runtime lifecycle")
  stopped.call("stop")
  var first_stop := snapshot(stopped)
  stopped.call("stop")
  token.remove()
  check(snapshot(stopped) == first_stop and first_stop.stopped and not first_stop.runtimeInitialized,
    "Repeated pre-mount stop and token removal preserve terminal state")
  check(first_stop.gameServices.stopped and first_stop.gameServices.bindings == 0 and source.changed.get_connections().is_empty(),
    "Pre-mount shutdown disconnects the real Godot binding")
  # _ready attempts exactly one mount. Its expected visible failure must never
  # evaluate the bundle or construct a runtime behind a stopped application.
  var rejected := create_surface("RejectedRoot", "StoppedBeforeMount")
  await frames(2)
  var after_rejection := snapshot(stopped)
  observations.stopBeforeMount = after_rejection
  check(rejected.call("get_surface_id") == 0 and after_rejection.rootCount == 0 and after_rejection.bundleEvaluations == 0 and not after_rejection.runtimeInitialized,
    "A stopped owner rejects root activation before constructing Hermes")
  check(after_rejection.errors.size() == 1 and after_rejection.errors[0].begins_with("E_RUNTIME_STOPPED:"),
    "Rejected activation retains its precise visible error in pre-runtime diagnostics")
  stopped.call("stop")
  check(snapshot(stopped) == after_rejection, "Stop remains idempotent after rejected activation")
  rejected.queue_free()
  stopped.queue_free()
  await frames(2)

  var victim := create_application("DestroyableApplication")
  source.victim = weakref(victim)
  var victim_id := victim.get_instance_id()
  var destroy_token: Object = FabricAPI.for_application(victim).register_method("lifetime.destroy", source.destroy, [], "integer")
  var surface := create_surface("SurvivingSurface", "DestroyableApplication")
  await frames()
  var before := snapshot(surface)
  observations.beforeFree = before
  check(destroy_token != null and before.nativeTags > 0 and before.nodes.any(func(entry: Dictionary) -> bool: return entry.get("testID", "") == "lifetime-text"),
    "A fresh application activates a real upstream Fabric tree after the terminal-owner case")
  victim.call("evaluate", "ServiceBoundaryFixture.destroyApplication()")
  check(source.calls == 0 and snapshot(victim).gameServices.pendingHostTasks == 1,
    "The destructive game call queues without executing on the evaluate stack")
  await frames()
  check(source.calls == 1 and source.returned and source.destroyed_synchronously and not is_instance_id_valid(victim_id),
    "A real GDScript callback synchronously frees its application and returns to the independent deferred host phase")
  var retired := snapshot(surface)
  observations.afterFree = retired
  check(is_instance_valid(surface) and surface.call("get_surface_id") == 0 and retired.stopped and retired.rootCount == 0,
    "A surviving surface keeps finalized diagnostics after its application is destroyed")
  check(retired.nativeTags == 0 and retired.nodes.is_empty() and retired.creates == retired.deletes,
    "Synchronous application destruction releases its actual native Controls and tags")
  check(retired.pendingWork == 0 and retired.pendingTimers == 0 and retired.pendingAnimationFrames == 0 and not retired.hostPhasePending,
    "Synchronous destruction leaves no scheduler resources or deferred host authority")
  check(retired.gameServices.stopped and retired.gameServices.hostTasksCanceled == 1 and retired.gameServices.bindings == 0 and retired.gameServices.pendingHostTasks == 0,
    "The executing game operation is cancelled and its bindings are revoked during owner destruction")
  check(retired.errors.is_empty(), "Destruction has no unexpected Fabric or runtime diagnostics")
  destroy_token.remove()
  surface.queue_free()
  source.queue_free()
  await frames(2)
  var output := FileAccess.open("res://build/services-lifetime-report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_CHECK_FAILED: Cannot publish service lifetime report")
    quit(1)
    return
  output.store_string(JSON.stringify({"scenario": "service-lifetime", "engine": "hermes", "renderer": "fabric",
    "godot": Engine.get_version_info().string, "displayServer": DisplayServer.get_name(), "checks": checks, "observations": observations}, "  ") + "\n")
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  print("SERVICES_LIFETIME_FAILED" if failed else "SERVICES_LIFETIME_PASSED: " + str(checks.size()))
  quit(1 if failed else 0)
