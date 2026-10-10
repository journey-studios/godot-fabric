extends SceneTree

# GF-18: a game scene leaves the tree while its RN Modal is open. Each teardown
# runs while Godot is removing children (SceneTree.quit, a scene change or the
# scene owner freed), so retiring the Modal Window must not mutate its busy
# owner Window. The native test asserts the log has no ERROR line.

const SCENARIOS := ["quit", "change-scene", "free-owner"]

var scenario := ""
var checks: Array = []
var observed := {}

func check(condition: bool, id: String) -> void:
  checks.append({"id": id, "passed": condition})
  if not condition: push_error("FABRIC_CHECK_FAILED: " + id)

func settle(frames: int = 12) -> void:
  for frame in range(frames): await process_frame

func native(target: Object) -> Dictionary:
  if target == null or not is_instance_valid(target): return {}
  var value: Variant = JSON.parse_string(target.call("snapshot"))
  return value if value is Dictionary else {}

func react(application: Object) -> Dictionary:
  if application == null or not is_instance_valid(application): return {}
  var value: Variant = JSON.parse_string(application.call("evaluate",
    "JSON.stringify(ModalLifecycleProbe.snapshot())"))
  return value if value is Dictionary else {}

func modal_window_of(surface: Object) -> Dictionary:
  for node: Dictionary in native(surface).get("nodes", []):
    if node.get("testID") == "lifecycle-modal": return node.get("modalWindow", {})
  return {}

func owned_windows() -> Array:
  var windows: Array = []
  for child in root.get_children():
    if child is Window: windows.append(child.get_instance_id())
  return windows

func requested_scenario() -> String:
  for argument in OS.get_cmdline_user_args():
    if argument.begins_with("--scenario="): return argument.trim_prefix("--scenario=")
  return ""

func write_report(stage: String) -> void:
  var output := FileAccess.open("res://build/modal-teardown-%s-report.json" % scenario, FileAccess.WRITE)
  output.store_string(JSON.stringify({"scenario": "modal-teardown-" + scenario, "stage": stage,
    "checks": checks, "observed": observed}, "  ") + "\n")
  output.close()

func run_probe() -> void:
  scenario = requested_scenario()
  if not SCENARIOS.has(scenario):
    push_error("FABRIC_CHECK_FAILED: unknown scenario " + scenario)
    quit(2)
    return
  root.size = Vector2i(420, 320)
  var scene := Node.new()
  scene.name = "TeardownScene"
  var application: Node = ClassDB.instantiate("FabricApplication")
  application.name = "TeardownApplication"
  application.set("bundle_path", "res://build/modal-teardown-probe.js")
  scene.add_child(application)
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = "TeardownSurface"
  surface.size = Vector2(240, 180)
  surface.set("application_path", NodePath("../TeardownApplication"))
  surface.set("component_name", "ModalLifecycleProbe")
  scene.add_child(surface)
  root.add_child(scene)
  current_scene = scene
  await settle(20)

  var window := modal_window_of(surface)
  var window_id := int(window.get("id", 0))
  observed.open = {"window": window, "react": react(application), "rootWindows": owned_windows()}
  check(window_id != 0 and bool(window.get("visible")) and bool(window.get("exclusive")) and
    bool(window.get("embedded")) and int(window.get("parentId", 0)) == root.get_instance_id(),
    "open/the RN Modal is an exclusive embedded Window under the scene's owner Window")
  check(int(observed.open.react.get("shows", 0)) == 1 and native(application).get("errors", [1]).is_empty(),
    "open/the Modal was shown once without runtime errors")

  # The application retires every root from its own _exit_tree; record what it
  # reports at that moment, while its owner Window is still removing children.
  application.tree_exited.connect(func() -> void:
    var stopped := native(application)
    observed.applicationExited = {"stopped": stopped.get("stopped"), "rootCount": stopped.get("rootCount"),
      "errors": stopped.get("errors"), "modalWindowAlive": is_instance_valid(instance_from_id(window_id))}
    print("MODAL_TEARDOWN_APPLICATION_EXITED=" + JSON.stringify(observed.applicationExited)))

  if scenario == "quit":
    write_report("before-quit")
    print("MODAL_TEARDOWN_QUIT_WITH_OPEN_MODAL=" + str(window_id))
    quit(0 if checks.all(func(row: Dictionary) -> bool: return row.passed) else 1)
    return

  if scenario == "change-scene":
    var next := Node.new()
    next.name = "NextScene"
    check(change_scene_to_node(next) == OK, "teardown/the scene change is accepted")
  else:
    scene.queue_free()
  await settle(12)

  var exited: Dictionary = observed.get("applicationExited", {})
  check(not exited.is_empty() and bool(exited.get("stopped")) and int(exited.get("rootCount", -1)) == 0 and
    exited.get("errors", [1]).is_empty(), "teardown/the application stopped from _exit_tree without runtime errors")
  check(not is_instance_valid(instance_from_id(window_id)) and not owned_windows().has(window_id),
    "teardown/the retired Modal Window is freed after the owner finishes removing children")
  check(not is_instance_valid(scene), "teardown/the old scene, its application and its surface are freed")
  observed.after = {"rootWindows": owned_windows(), "currentScene": str(current_scene.name) if current_scene else ""}
  write_report("after-teardown")
  var passed := checks.all(func(row: Dictionary) -> bool: return row.passed)
  print("MODAL_TEARDOWN_%s=%s" % [scenario.to_upper().replace("-", "_"), "PASSED" if passed else "FAILED"])
  quit(0 if passed else 1)

func _initialize() -> void: call_deferred("run_probe")
