extends SceneTree

const DEVICE := 1001
var checks: Array = []
var applications: Dictionary = {}
var surfaces: Dictionary = {}
var stages: Dictionary = {}
var manual: Dictionary = {}
var legacy: Dictionary = {}
var native_states: Dictionary = {}
var renderer_tag_mode := ""

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

func js(mode: String, expression: String) -> Variant:
  return JSON.parse_string(applications[mode].call("evaluate", "JSON.stringify(NativeDispatchProbe." + expression + ")"))

func mount(mode: String) -> void:
  var app: Node = ClassDB.instantiate("FabricApplication")
  app.name = "Dispatch_" + mode
  app.set("bundle_path", "res://build/event-dispatch-" + mode + ".js")
  applications[mode] = app
  surfaces[mode] = {}
  root.add_child(app)
  for name: String in ["A", "B"]:
    var surface: Control = ClassDB.instantiate("FabricSurface")
    surface.name = mode + "_" + name
    surface.position = Vector2.ZERO if name == "A" else Vector2(400, 0)
    surface.size = Vector2(360, 250)
    surface.set("application_path", NodePath("../" + str(app.name)))
    surface.set("component_name", "NativeEventDispatchProbe")
    surface.set("initial_props", {"name": name})
    surface.set_meta("validation_input_device", DEVICE)
    surfaces[mode][name] = surface
    root.add_child(surface)

func inject(phase: String, who: String, identifier: int) -> void:
  var point := Vector2(250 if who == "other" else 110 if who == "second" else 50, 50)
  var event: InputEvent
  if phase == "move":
    var drag := InputEventScreenDrag.new()
    drag.position = point
    drag.index = identifier
    event = drag
  else:
    var touch := InputEventScreenTouch.new()
    touch.position = point
    touch.index = identifier
    touch.pressed = phase == "start"
    touch.canceled = phase == "cancel"
    event = touch
  event.device = DEVICE
  Input.parse_input_event(event)
  await settle()

func actions(id: String) -> Array:
  if id in ["inside-two", "outside-two"]:
    var who := "second" if id == "inside-two" else "other"
    return [["start", "first", 0], ["start", who, 1], ["end", "first", 0], ["end", who, 1]]
  if id == "cancel":
    return [["start", "first", 0], ["cancel", "first", 0]]
  if id in ["capture", "should-fault", "truthy-should", "recovery"]:
    return [["start", "first", 0], ["end", "first", 0]]
  return [["start", "first", 0], ["move", "first", 0], ["end", "first", 0]]

func expected_owner(id: String, index: int, count: int, capability: Dictionary, is_legacy: bool) -> int:
  if index == count - 1 or id == "should-fault" or (id == "truthy-should" and not is_legacy):
    return 0
  if is_legacy and id == "outside-two" and index == 2:
    return 0
  if id == "capture":
    return int(capability.parent)
  if id in ["transfer-accept", "transfer-reject", "undefined-termination"]:
    if index == 0 or id == "transfer-reject" or (id == "undefined-termination" and is_legacy):
      return int(capability.first)
    return int(capability.parent)
  return int(capability.branch)

func scenario(mode: String, id: String) -> void:
  var is_legacy := mode == "disabled"
  var transport := "native-compiled-legacy" if is_legacy else "manual-original"
  var capability: Variant = js(mode, "beginScenario('A',%s,%s)" % [JSON.stringify(id), JSON.stringify(transport)])
  if not check(capability is Dictionary, transport + "/" + id + "/Scenario arms in actual mounted Hermes"):
    return
  var before := native(surfaces[mode].A).pointer as Dictionary
  var observed: Array = []
  var sequence := actions(id)
  for index in range(sequence.size()):
    var action: Array = sequence[index]
    var result: Variant = null
    if is_legacy:
      await inject(action[0], action[1], action[2])
    else:
      result = js(mode, "manualStep('A',%s,%s,%d)" % [JSON.stringify(action[0]), JSON.stringify(action[1]), action[2]])
      check(result is Dictionary, transport + "/" + id + "/Manual dispatch result is available at step " + str(index))
    var pointer := native(surfaces[mode].A).pointer as Dictionary
    observed.append(pointer)
    check(pointer.responder == expected_owner(id, index, sequence.size(), capability, is_legacy),
      transport + "/" + id + "/Native responder owner matches lifecycle at step " + str(index))
    check(native(surfaces[mode].B).pointer.responder == 0,
      transport + "/" + id + "/Unrelated native root receives no responder grant at step " + str(index))
    if id == "outside-two" and index == 2 and not is_legacy and result is Dictionary:
      js(mode, "recordOutsideGap(%s,%d,%d)" % [JSON.stringify(result), pointer.responder, capability.branch])
  var after := native(surfaces[mode].A).pointer as Dictionary
  var expects_grant := id != "should-fault" and (id != "truthy-should" or is_legacy)
  check(after.responder == 0 and after.activeTouches == 0 and not after.blockNative,
    transport + "/" + id + "/Actual native owner and physical contacts are cleared")
  check(after.grants > before.grants and after.releases > before.releases if expects_grant else after.grants == before.grants and after.releases == before.releases,
    transport + "/" + id + "/Actual native grant and release counters support observed negotiation")
  var result: Variant = js(mode, "finishScenario('A',%s,%s)" % [JSON.stringify(id), JSON.stringify(transport)])
  check(result is Dictionary, transport + "/" + id + "/Completed semantic report survives actual dispatch")
  if is_legacy:
    legacy[id] = result
    native_states[id] = observed
  else:
    manual[id] = result
  stages[transport + "/" + id] = {"before": before, "steps": observed, "after": after}

func retire(mode: String) -> void:
  applications[mode].call("stop")
  await settle()
  var after := native(applications[mode])
  stages[mode + "AfterStop"] = after
  check(after.stopped and after.rootCount == 0 and after.pendingWork == 0 and after.pendingTimers == 0 and after.pendingAnimationFrames == 0 and after.pendingRootRetirements == 0 and after.errors.is_empty(),
    mode + "/Stop clears every native root work item timer and error authority")
  for name: String in ["A", "B"]:
    var state := native(surfaces[mode][name])
    check(state.nativeTags == 0 and state.creates == state.deletes and state.pointer.responder == 0 and state.pointer.activeTouches == 0,
      mode + "/Stop balances all actual native Controls and responders in root " + name)
    surfaces[mode][name].queue_free()
  applications[mode].queue_free()
  await settle()

func _initialize() -> void:
  for argument: String in OS.get_cmdline_user_args():
    if argument.begins_with("--renderer-tag-mode="):
      renderer_tag_mode = argument.trim_prefix("--renderer-tag-mode=")
  call_deferred("run_probe")

func run_probe() -> void:
  if not check(renderer_tag_mode in ["original", "current"], "Explicit renderer tag resolution mode is required"):
    quit(1)
    return
  root.size = Vector2i(800, 270)
  mount("enabled")
  await settle()
  check(native(applications.enabled).rootCount == 2 and native(surfaces.enabled.A).runtimeId == native(surfaces.enabled.B).runtimeId and native(surfaces.enabled.A).surfaceId != native(surfaces.enabled.B).surfaceId,
    "Manual original dispatcher runs over two actual roots in one Hermes runtime")
  for name: String in ["A", "B"]:
    var capability: Variant = js("enabled", "capability(%s)" % JSON.stringify(name))
    stages["capability" + name] = capability
    check(capability is Dictionary and capability.originalElement and capability.originalEventTarget and capability.flags.imperative and capability.flags.nativeDispatch and capability.logicalFlat and capability.secondIsInside and capability.otherIsOutside,
      "Original EventTarget native refs and independent subtree membership are live: " + name)
    check(not native(surfaces.enabled[name]).nodes.any(func(node: Dictionary) -> bool: return node.tag == capability.flatTag),
      "Normal trusted path includes an actually flattened logical View: " + name)
    stages["normal" + name] = js("enabled", "testNormal(%s)" % JSON.stringify(name))
    stages["fastJSX" + name] = js("enabled", "testJSXFastPath(%s)" % JSON.stringify(name))
    stages["imperativeOnly" + name] = js("enabled", "testImperativeOnly(%s)" % JSON.stringify(name))
  stages.nullTargets = js("enabled", "testNullTargets('A')")
  stages.crossRoots = js("enabled", "crossRoots()")
  for id: String in ["bubble", "capture", "cancel", "transfer-accept", "transfer-reject", "inside-two", "outside-two", "should-fault", "recovery", "grant-fault", "lifecycle-fault", "truthy-should", "undefined-termination"]:
    await scenario("enabled", id)
  stages.lookupA = js("enabled", "testNativeLookup('A')")
  stages.lookupB = js("enabled", "testNativeLookup('B')")
  check(js("enabled", "removeLookupNode('A')") == true, "Lookup invalidation requests a real React state update")
  await settle()
  stages.lookupRemoved = js("enabled", "inspectLookupRemoval('A')")
  check(not native(surfaces.enabled.A).nodes.any(func(node: Dictionary) -> bool: return node.testID == "A-other"),
    "Executed React commit removes the native lookup node before stale-tag assertions")
  var original: Variant = js("enabled", "snapshot()")
  if check(original is Dictionary, "All original dispatcher observations persist before application stop"):
    for entry: Dictionary in original.checks:
      check(entry.passed, entry.name)
    check(original.currentPriority == original.defaultPriority, "Explicit module dispatch restores the original native default priority")
  check(native(applications.enabled).errors.is_empty() and native(applications.enabled).pointerRouting.contacts == 0,
    "Caught manual exceptions leave no native runtime errors or physical input routes")
  await retire("enabled")

  mount("disabled")
  await settle()
  var capability: Variant = js("disabled", "capability('A')")
  check(capability is Dictionary and not capability.flags.imperative and not capability.flags.nativeDispatch and capability.methods == ["undefined", "undefined", "undefined"] and capability.logicalFlat,
    "Compiled legacy control mounts the same real topology with original flags off")
  for id: String in ["bubble", "cancel", "inside-two", "outside-two", "truthy-should", "undefined-termination"]:
    await scenario("disabled", id)
  stages.differential = js("disabled", "compareLegacy(%s,%s,%s)" % [JSON.stringify(manual), JSON.stringify(legacy), JSON.stringify(native_states)])
  var legacy_state: Variant = js("disabled", "snapshot()")
  if check(legacy_state is Dictionary, "Executed native legacy observations persist before application stop"):
    for entry: Dictionary in legacy_state.checks:
      check(entry.passed, entry.name)
  check(native(applications.disabled).errors.is_empty() and native(applications.disabled).pointerRouting.contacts == 0,
    "Actual legacy native input ends all physical routes without runtime faults")
  await retire("disabled")
  var report := {"scenario": "original-native-event-dispatch", "rendererTagMode": renderer_tag_mode, "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages, "original": original, "legacy": legacy_state,
    "manualScenarios": manual, "legacyScenarios": legacy, "legacyNativeStates": native_states,
    "scope": {"explicitOriginalDispatcher": true, "actualCompiledLegacyNativeInput": true,
      "nativeEventTargetIntegrated": false, "publicDefaultEnabled": false, "nativeInterestSolved": false,
      "originalResponderUnmodified": true, "parentOverlay": "current", "rendererTagOverlay": renderer_tag_mode,
      "legacyTouchTagResolutionFixed": renderer_tag_mode == "current", "hardwareCertified": false, "mobileCertified": false}}
  var file := FileAccess.open("res://build/event-dispatch-report.json", FileAccess.WRITE)
  if not check(file != null, "Original dispatcher report is writable"):
    quit(1)
    return
  file.store_string(JSON.stringify(report, "  ") + "\n")
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  print("NATIVE_EVENT_DISPATCH_FAILED" if failed else "NATIVE_EVENT_DISPATCH_PASSED: " + str(checks.size()))
  quit(1 if failed else 0)
