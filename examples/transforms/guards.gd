extends SceneTree

# Singular transforms are not rejections: scale: 0, scaleX: 0 and a rank-one matrix
# collapse their View (examples/transforms/singular.gd). What stays an error is
# what a Control cannot carry: 3D, a weight other than 1 and the native range.
const MODES := ["3d", "rotate-x", "w-not-one", "range-large", "range-small", "range-pivot"]
const EXPECTED := {
  "3d": "E_TRANSFORM_3D: perspective and 3D transforms are not implemented",
  # A rotation about x couples z into y (m[6], m[9]); a weight other than 1
  # would divide x and y. A uniform scale touches neither, so both stay rejected.
  "rotate-x": "E_TRANSFORM_3D: perspective and 3D transforms are not implemented",
  "w-not-one": "E_TRANSFORM_3D: expected a planar affine transform",
  "range-large": "E_TRANSFORM_RANGE: transform or inverse exceeds native coordinate precision",
  "range-small": "E_TRANSFORM_RANGE: transform or inverse exceeds native coordinate precision",
  "range-pivot": "E_TRANSFORM_RANGE: transform or inverse exceeds native coordinate precision",
}
var checks: Array = []
var cases: Array = []

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

func frames(count: int = 8) -> void:
  for index in range(count):
    await process_frame

func snapshot(node: Node) -> Dictionary:
  var value: Variant = JSON.parse_string(node.call("snapshot"))
  return value if value is Dictionary else {}

func rejection_matches(errors: Array, mode: String) -> bool:
  if errors.size() != 1 or not errors[0] is String:
    return false
  # Hermes wraps a thrown C++ HostFunction error and retains its real JS stack.
  # Compare the complete first line; never truncate the stored diagnostic.
  var message: String = errors[0]
  return message.get_slice("\n", 0) == "Exception in HostFunction: " + EXPECTED[mode]

func run_case(mode: String) -> void:
  var owner := Node.new()
  owner.name = "TransformGuardLifetime"
  root.add_child(owner)
  var app: Node = ClassDB.instantiate("FabricApplication")
  app.name = "Application"
  app.set_meta("scenario", "transforms")
  owner.add_child(app)
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = "Surface"
  surface.set("application_path", NodePath("../Application"))
  surface.set("component_name", "TransformGuardCase")
  surface.set("initial_props", {"mode": mode})
  surface.set_meta("validation_input_device", 1001)
  surface.size = Vector2(320, 240)
  owner.add_child(surface)
  var deadline := Time.get_ticks_msec() + 5000
  while Time.get_ticks_msec() < deadline and snapshot(app).get("errors", []).is_empty():
    await frames(1)
  var rejected := snapshot(app)
  var native_rejected := snapshot(surface)
  check(rejected.get("runtimeInitialized", false) and rejected.get("bundleEvaluations", -1) == 1 and rejected.get("runtimeId", 0) > 0,
    "Fresh Hermes application evaluates the real public RN guard bundle once: " + mode)
  check(Time.get_ticks_msec() < deadline and rejection_matches(rejected.get("errors", []), mode),
    "The actual public transform reaches its one precise native rejection: " + mode)
  await frames(12)
  check(rejection_matches(snapshot(app).get("errors", []), mode) and snapshot(app).get("errors", []) == rejected.get("errors", []),
    "Repeated pumps do not flood transform diagnostics: " + mode)
  # Populate real registries immediately before stop so cancellation is tested,
  # including runtimes whose mounting transaction was interrupted by rejection.
  app.call("evaluate", "globalThis.transformGuardTimer=setInterval(()=>{},10000); globalThis.transformGuardFrame=requestAnimationFrame(()=>{})")
  var before_stop := snapshot(app)
  check(before_stop.get("pendingTimers", 0) > 0 and before_stop.get("pendingAnimationFrames", 0) > 0,
    "Rejected mounting retains real timer and frame registrations for teardown: " + mode)
  app.call("stop")
  await frames()
  var stopped := snapshot(app)
  var native_stopped := snapshot(surface)
  check(stopped.get("stopped", false) and stopped.get("rootCount", -1) == 0 and stopped.get("pendingRootRetirements", -1) == 0,
    "Stopping the rejected application retires every root: " + mode)
  check(stopped.get("pendingTimers", -1) == 0 and stopped.get("pendingAnimationFrames", -1) == 0 and stopped.get("pendingWork", -1) == 0 and
    not stopped.get("hostPhasePending", true), "Stopping the rejected application drains scheduling and host authority: " + mode)
  check(native_stopped.get("nativeTags", -1) == 0 and native_stopped.get("nodes", ["missing"]).is_empty() and
    native_stopped.has("creates") and native_stopped.has("deletes") and native_stopped.get("creates", -1) == native_stopped.get("deletes", -2),
    "Partially mounted native Controls and tags are all released with balanced counters: " + mode)
  var modules: Dictionary = stopped.get("nativeModules", {})
  var services: Dictionary = stopped.get("gameServices", {})
  check(modules.get("stopped", false) and modules.get("loaded", -1) == 0 and services.get("stopped", false) and
    services.get("pendingHostTasks", -1) == 0, "Rejected transform teardown disposes native modules and game service work: " + mode)
  check(rejection_matches(stopped.get("errors", []), mode) and stopped.get("errors", []) == rejected.get("errors", []),
    "Shutdown adds no error beyond the original expected transform rejection: " + mode)
  app.call("stop")
  await frames(2)
  check(snapshot(app) == stopped and snapshot(surface).get("creates", -1) == native_stopped.get("creates", -2) and
    snapshot(surface).get("deletes", -1) == native_stopped.get("deletes", -2), "Repeated stop preserves finalized transform guard lifetime: " + mode)
  cases.append({"mode": mode, "expectedError": EXPECTED[mode], "expectedCode": EXPECTED[mode].split(":")[0],
    "expectedHostErrorLine": "Exception in HostFunction: " + EXPECTED[mode],
    "applicationInstanceId": app.get_instance_id(), "surfaceInstanceId": surface.get_instance_id(),
    "afterRejection": rejected, "nativeAfterRejection": native_rejected, "beforeStop": before_stop,
    "afterStop": stopped, "nativeAfterStop": native_stopped})
  owner.queue_free()
  await frames(2)

func _initialize() -> void:
  call_deferred("run_probe")

func run_probe() -> void:
  root.size = Vector2i(320, 240)
  for mode in MODES:
    await run_case(mode)
  var runtime_ids: Array = cases.map(func(entry: Dictionary) -> Variant: return entry.afterRejection.get("runtimeId", -1))
  var unique_ids: Dictionary = {}
  for id in runtime_ids: unique_ids[id] = true
  check(cases.size() == MODES.size() and unique_ids.size() == MODES.size(), "All six rejected public transforms run in independent Hermes application lifetimes")
  var failed: bool = cases.size() != MODES.size() or checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  var report := {"schemaVersion": 1, "scenario": "transforms-guards", "status": "failed" if failed else "passed", "failed": failed,
    "engine": "hermes", "renderer": "fabric", "godot": Engine.get_version_info().string, "reactNative": "0.87.1", "displayServer": DisplayServer.get_name(),
    "modes": MODES, "checks": checks, "cases": cases}
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://build"))
  var output := FileAccess.open("res://build/transforms-guards.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_CHECK_FAILED: Cannot publish transform guard report")
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  print("TRANSFORM_GUARDS_FAILED" if failed else "TRANSFORM_GUARDS_PASSED: " + str(checks.size()))
  quit(1 if failed else 0)
