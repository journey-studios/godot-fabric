extends SceneTree

var checks: Array = []
var stages: Dictionary = {}
var surfaces: Dictionary = {}
var application: Node
var parent_mode := ""

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

func settle() -> void:
  for index in range(8):
    await process_frame

func native(owner: Node) -> Dictionary:
  var value: Variant = JSON.parse_string(owner.call("snapshot"))
  return value if value is Dictionary else {}

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(EventTargetAncestry." + expression + ")"))

func mount_surface(name: String, position: Vector2) -> void:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = name
  surface.position = position
  surface.size = Vector2(360, 250)
  surface.set("application_path", NodePath("../AncestryApplication"))
  surface.set("component_name", "EventTargetAncestryProbe")
  surface.set("initial_props", {"name": name})
  surfaces[name] = surface
  root.add_child(surface)

func node_id(surface: Node, id: String) -> int:
  for node: Dictionary in native(surface).get("nodes", []):
    if node.testID == id:
      return int(node.id)
  return 0

func _initialize() -> void:
  for argument: String in OS.get_cmdline_user_args():
    if argument.begins_with("--parent-mode="):
      parent_mode = argument.trim_prefix("--parent-mode=")
  call_deferred("run_probe")

func run_probe() -> void:
  if not check(parent_mode in ["original", "current"], "Explicit parent overlay mode is required"):
    quit(1)
    return
  root.size = Vector2i(820, 280)
  application = ClassDB.instantiate("FabricApplication")
  application.name = "AncestryApplication"
  application.set("bundle_path", "res://build/event-target-ancestry-enabled.js")
  root.add_child(application)
  mount_surface("A", Vector2.ZERO)
  mount_surface("B", Vector2(420, 0))
  await settle()
  stages.initialApplication = native(application)
  stages.initialA = native(surfaces.A)
  stages.initialB = native(surfaces.B)
  check(stages.initialA.runtimeId == stages.initialB.runtimeId and stages.initialA.surfaceId != stages.initialB.surfaceId and native(application).rootCount == 2,
    "Real native roots share one Hermes runtime with distinct surface identities")
  for name: String in ["A", "B"]:
    var capability: Variant = js("capability(%s)" % JSON.stringify(name))
    if check(capability is Dictionary, "Original native ref capability is available: " + name):
      stages["capability" + name] = capability
      check(capability.original and capability.flags.imperative and capability.flags.nativeDispatch and capability.nativeAncestry,
        "Opt-in original refs retain current logical NativeDOM ancestry: " + name)
      check(capability.documentConnected and capability.documentRootLinked and capability.documentHasNoParent,
        "Original document and documentElement link to the registered native root: " + name)
      check(not native(surfaces[name]).nodes.any(func(node: Dictionary) -> bool: return node.tag == capability.flatTag),
        "Ancestry includes a genuinely flattened logical View: " + name)
    stages["manual" + name] = js("manual(%s)" % JSON.stringify(name))
  stages.crossRootsInitial = js("crossRoots('A','B','initial')")
  stages.mutableGraph = js("mutableGraph(%s)" % JSON.stringify(parent_mode))

  stages.itemsPrime = js("retainPair('A','items-A')")
  check(js("removeItems('A')") == true, "React sibling removal is requested through actual component state")
  await settle()
  check(node_id(surfaces.A, "A-warm") == 0 and node_id(surfaces.A, "A-cold") == 0 and node_id(surfaces.A, "A-ancestor") != 0,
    "Executed React commit removes both items while retaining native ancestor")
  stages.itemsRemoved = js("inspectRetained('items-A',%s,'items')" % JSON.stringify(parent_mode))

  stages.ancestorPrime = js("retainPair('B','ancestor-B')")
  check(js("removeAncestor('B')") == true, "React ancestor removal is requested through actual component state")
  await settle()
  check(node_id(surfaces.B, "B-ancestor") == 0 and node_id(surfaces.B, "B-warm") == 0 and node_id(surfaces.B, "B-cold") == 0 and node_id(surfaces.B, "B-parent") != 0,
    "Executed React commit removes the entire ancestor subtree while root parent remains")
  stages.ancestorRemoved = js("inspectRetained('ancestor-B',%s,'ancestor')" % JSON.stringify(parent_mode))

  stages.reorderPrime = js("prepareReorder('B')")
  check(js("reorder('B')") == true, "React keyed sibling reorder is requested")
  await settle()
  stages.reordered = js("inspectReorder('B')")
  stages.rootPrime = js("retainPair('A','root-A',true)")
  var before_a := native(surfaces.A)
  var before_b := native(surfaces.B)
  var survivor_id := node_id(surfaces.B, "B-key-a")
  surfaces.A.call("unmount")
  await settle()
  stages.retiredA = native(surfaces.A)
  check(stages.retiredA.state == "unmounted" and stages.retiredA.nativeTags == 0 and stages.retiredA.creates == stages.retiredA.deletes and native(application).rootCount == 1,
    "One root retirement releases its actual native tree while the shared application remains live")
  check(not native(application).stopped and native(surfaces.B).surfaceId == before_b.surfaceId and node_id(surfaces.B, "B-key-a") == survivor_id and survivor_id != 0,
    "Surviving root preserves original surface and native Control identities")
  stages.rootRemoved = js("inspectRetained('root-A',%s,'root')" % JSON.stringify(parent_mode))
  check(surfaces.A.call("mount"), "Retired Godot surface remounts through the existing live application")
  await settle()
  stages.remountedA = native(surfaces.A)
  check(stages.remountedA.surfaceId != before_a.surfaceId and stages.remountedA.runtimeId == before_a.runtimeId and native(application).rootCount == 2,
    "Remount allocates a fresh native root generation without replacing Hermes")
  stages.remount = js("inspectRemount('A','root-A')")
  stages.oldRootAfterRemount = js("inspectRetained('root-A',%s,'root-after-remount')" % JSON.stringify(parent_mode))
  stages.crossRootsRemount = js("crossRoots('A','B','remount')")

  var state: Variant = js("snapshot()")
  if check(state is Dictionary, "Completed JS ancestry observations remain available in live Hermes"):
    stages.reactBeforeStop = state
    for entry: Dictionary in state.get("checks", []):
      check(entry.passed, entry.name)
    check(state.mounts.get("A", 0) == 2 and state.mounts.get("B", 0) == 1 and state.cleanups.get("A", 0) == 1 and state.cleanups.get("B", 0) == 0,
      "Real React effects distinguish root cleanup and fresh remount from sibling reorder")
    check(state.currentPriority == state.defaultPriority, "Public ancestry dispatch preserves original default event priority")
  check(native(application).errors.is_empty() and native(application).pointerRouting.contacts == 0 and native(application).pointerRouting.stored == 0,
    "Manual ref ancestry exercises no native input routes or unexpected runtime errors")
  application.call("stop")
  await settle()
  var after_stop := native(application)
  check(after_stop.stopped and after_stop.rootCount == 0 and after_stop.pendingWork == 0 and after_stop.pendingTimers == 0 and after_stop.pendingAnimationFrames == 0 and after_stop.pendingRootRetirements == 0 and after_stop.errors.is_empty(),
    "Application stop releases every root work item timer and retirement without errors")
  for name: String in ["A", "B"]:
    var status := native(surfaces[name])
    check(status.nativeTags == 0 and status.creates == status.deletes, "All native nodes retire after ancestry probe: " + name)
    surfaces[name].queue_free()
  application.queue_free()
  await settle()
  var report := {"scenario": "event-target-current-ancestry", "parentMode": parent_mode, "reactNative": "0.87.1",
    "godot": Engine.get_version_info().string, "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages,
    "afterStop": after_stop, "scope": {"manualDispatch": true, "parentCacheFixed": parent_mode == "current",
      "nativeEventTargetIntegrated": false, "publicDefaultEnabled": false, "nativeReactReparentPreservedIdentity": false,
      "mutableGraphUsesOriginalEventTarget": true}}
  var file := FileAccess.open("res://build/event-target-ancestry-report.json", FileAccess.WRITE)
  if not check(file != null, "Ancestry report can be saved"):
    quit(1)
    return
  file.store_string(JSON.stringify(report, "  ") + "\n")
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  print("EVENT_TARGET_ANCESTRY_FAILED" if failed else "EVENT_TARGET_ANCESTRY_PASSED: " + str(checks.size()))
  quit(1 if failed else 0)
