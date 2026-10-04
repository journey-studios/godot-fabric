extends SceneTree

const DEVICE := 1001
var checks: Array = []
var stages: Dictionary = {}
var surfaces: Dictionary = {}
var application: Node
var interest_mode := ""
var capture := false
var captures: Array = []

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
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(PointerInterestProbe." + expression + ")"))

func state() -> Dictionary:
  var value: Variant = js("snapshot()")
  return value if value is Dictionary else {}

func mount(name: String, position: Vector2) -> void:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = name
  surface.position = position
  surface.size = Vector2(360, 260)
  surface.set("application_path", NodePath("../PointerInterestApplication"))
  surface.set("component_name", "PointerInterestProbe")
  surface.set("initial_props", {"name": name})
  surface.set_meta("validation_input_device", DEVICE)
  surfaces[name] = surface
  root.add_child(surface)

func point(name: String, target: String) -> Vector2:
  var capability: Dictionary = js("capability(%s)" % JSON.stringify(name))
  var value: Array = capability.points[target]
  return surfaces[name].position + Vector2(value[0], value[1])

func inject(name: String, target: String, phase: String = "start") -> void:
  var event := InputEventScreenTouch.new()
  event.device = DEVICE
  event.index = 0
  event.position = point(name, target)
  event.pressed = phase == "start"
  event.canceled = phase == "cancel"
  Input.parse_input_event(event)
  await settle()

func verify_down(name: String, label: String, expected: Array) -> Dictionary:
  var value := state()
  check(value.events.map(func(row: Dictionary) -> String: return row.label) == expected,
    label + "/Exact original EventTarget callback order and count")
  if not expected.is_empty():
    check(value.events.all(func(row: Dictionary) -> bool: return row.name == name and row.trusted and row.originalSynthetic and row.currentMatches and row.thisMatches and row.targetMatches and row.globalEventMatches and row.type == "pointerdown"),
      label + "/Every native callback uses trusted original events and exact public identities")
    check(value.events.all(func(row: Dictionary) -> bool: return row.phase == (1 if row.label == "flat-capture" else 3 if row.label in ["flat-bubble", "document-only"] else 2)),
      label + "/Capture and bubble preserve exact ancestor or target event phases")
    check(value.raw.size() == 2 and value.raw[0].channel == "typed" and value.raw[1].channel == "star" and value.raw[0].payloadId == value.raw[1].payloadId and value.events.all(func(row: Dictionary) -> bool: return row.payloadId == value.raw[0].payloadId and row.nativeTarget == value.raw[0].target and row.pointerId == value.raw[0].pointerId and row.timeStamp == row.nativeTimeStamp and row.timeStamp == value.raw[0].timeStamp),
      label + "/Raw typed and star channels deliver once before callbacks with the identical native payload and timestamp")
    check(value.raw.size() == 2 and value.events.size() == expected.size() and value.raw[1].sequence < value.events[0].sequence and value.cleanup.size() == expected.size() and value.cleanup.all(func(row: Dictionary) -> bool: return row.currentTargetNull and row.phase == 0 and row.pathEmpty and row.originalEvent),
      label + "/Native dispatch completes original cleanup after one Raw delivery")
  else:
    check(value.raw.is_empty() and value.cleanup.is_empty(), label + "/Filtered pointerdown produces neither Raw down nor synthetic callbacks")
  check(value.globalEventRestored and value.currentPriority == value.defaultPriority and native(application).errors.is_empty(),
    label + "/Native input restores default priority and global event without host errors")
  return value

func verify_release(name: String, before: Dictionary, phase: String, label: String) -> void:
  var after := native(surfaces[name])
  check(after.pointer.activeTouches == 0 and after.pointer.activePointers == 0 and after.pointerProcessor.active == 0 and native(application).pointerRouting.contacts == 0 and native(application).pointerRouting.stored == 0,
    label + "/Terminal input clears native contacts routes and original pointer processor state")
  check((after.pointer.pointerCancels == before.pointer.pointerCancels + 1) if phase == "cancel" else (after.pointer.pointerUps == before.pointer.pointerUps + 1),
    label + "/Original native processor records exactly one real cancel or up")

func run_case(kind: String, target: String, expected_current: Array, expected_manual: Array) -> void:
  var prefix := "case/" + kind
  js("configure('A',%s)" % JSON.stringify(kind))
  js("arm('A',%s,%s)" % [JSON.stringify(prefix + "/manual"), JSON.stringify(target)])
  var manual: Dictionary = js("poke('A',%s,%s)" % [JSON.stringify(target), JSON.stringify("pointerup" if kind == "wrong-type" else "pointerdown")])
  var positive := state()
  check(manual.returned and manual.cleaned and not manual.trusted and manual.targetMatches and positive.events.map(func(row: Dictionary) -> String: return row.label) == expected_manual and positive.events.all(func(row: Dictionary) -> bool: return not row.trusted and row.currentMatches and row.thisMatches and row.targetMatches) and positive.raw.is_empty(),
    prefix + "/Same actual original listener passes its independent public dispatch control")
  stages[prefix + "/manual"] = {"result": manual, "react": positive}
  var configuration: Dictionary = js("configure('A',%s)" % JSON.stringify(kind))
  stages[prefix + "/configuration"] = configuration
  if kind == "abort-after" or kind == "remove-final":
    var changed: Dictionary = js("abortRegistered('A')" if kind == "abort-after" else "removeFinal('A')")
    check(interest_mode == "original" or changed.before.bubble and not changed.after.bubble and not changed.after.capture,
      prefix + "/Current original Map changes from registered to absent before native hit testing")
    if kind == "abort-after":
      check(changed.aborted, prefix + "/Actual original AbortSignal reaches its aborted state")
    stages[prefix + "/mutation"] = changed
  if kind == "capture" or kind == "both":
    check(interest_mode == "original" or configuration.queries.capture and configuration.queries.bubble == (kind == "both"),
      prefix + "/Current query distinguishes native capture offset35 from bubble offset34")
  if kind == "document":
    check(interest_mode == "original" or configuration.documentQueries.bubble and not configuration.queries.bubble and not configuration.queries.capture,
      prefix + "/Document-only listener is real while every View on the hit path has no interest")
  js("arm('A',%s,%s)" % [JSON.stringify(prefix + "/native"), JSON.stringify(target)])
  var before := native(surfaces.A)
  await inject("A", target)
  var expected := expected_current if interest_mode == "current" or kind == "mixed" else []
  var down := verify_down("A", prefix, expected)
  check(native(surfaces.A).pointer.pointerDowns == before.pointer.pointerDowns + 1 and native(surfaces.A).pointer.activePointers == 1 and native(application).pointerRouting.active == 1,
    prefix + "/Actual native pointer input is ingested even when interest filters delivery")
  if interest_mode == "current" and kind in ["once", "duplicate", "remove-peer"]:
    var row: Dictionary = down.events[0]
    check(not row.queryBefore.bubble if kind == "once" else row.queryBefore.bubble,
      prefix + "/Original Map is queried during the actual callback at the correct once or dedupe boundary")
    if kind == "remove-peer":
      check(not row.queryAfter.bubble and not row.queryAfter.capture, prefix + "/Removing the snapshotted peer leaves no active native interest before callback returns")
  stages[prefix + "/native"] = {"react": down, "before": before, "after": native(surfaces.A)}
  var terminal_before := native(surfaces.A)
  await inject("A", target, "end")
  verify_release("A", terminal_before, "end", prefix)
  check(state().events.size() == down.events.size(), prefix + "/Real up does not duplicate the pointerdown callback")
  if kind in ["once", "remove-peer"]:
    js("arm('A',%s,%s)" % [JSON.stringify(prefix + "/next"), JSON.stringify(target)])
    await inject("A", target)
    stages[prefix + "/next"] = verify_down("A", prefix + "/next", [])
    var next_before := native(surfaces.A)
    await inject("A", target, "end")
    verify_release("A", next_before, "end", prefix + "/next")

func capture_frame(filename: String) -> void:
  if capture and DisplayServer.get_name() != "headless":
    await RenderingServer.frame_post_draw
    var image := root.get_texture().get_image()
    var saved := image.save_png("res://build/" + filename)
    var pixels: Array = []
    for origin: Vector2i in [Vector2i.ZERO, Vector2i(420, 0)]:
      var sample_index := 0
      var counter_extended := origin == Vector2i.ZERO and filename.ends_with("-after.png") and interest_mode == "current"
      var expected_colors := ["0f172aff", "2563ebff", "0f766eff", "7c3aedff", "d97706ff", "fde047ff", "fde047ff" if counter_extended else "0f172aff"]
      for local: Vector2i in [Vector2i(5, 5), Vector2i(75, 55), Vector2i(260, 55), Vector2i(70, 155), Vector2i(260, 155), Vector2i(25, 230), Vector2i(60, 230)]:
        var sample := origin + local
        var actual := image.get_pixelv(sample).to_html()
        var expected: String = expected_colors[sample_index]
        check(actual == expected, "Actual native pixel matches target geometry and committed state: " + filename + "/" + str(sample))
        pixels.append({"point": [sample.x, sample.y], "color": actual, "expected": expected})
        sample_index += 1
    check(saved == OK and image.get_width() == 820 and image.get_height() == 280,
      "Actual rendered frame is saved at the scenario dimensions: " + filename)
    captures.append({"file": "build/" + filename, "width": image.get_width(), "height": image.get_height(), "pixels": pixels})

func _initialize() -> void:
  for argument: String in OS.get_cmdline_user_args():
    if argument.begins_with("--interest-mode="):
      interest_mode = argument.trim_prefix("--interest-mode=")
    if argument == "--capture":
      capture = true
  call_deferred("run_probe")

func run_probe() -> void:
  if not check(interest_mode in ["original", "current"], "Explicit pointer-interest mode is required"):
    quit(1)
    return
  root.size = Vector2i(820, 280)
  application = ClassDB.instantiate("FabricApplication")
  application.name = "PointerInterestApplication"
  application.set("bundle_path", "res://build/pointer-interest-enabled.js")
  root.add_child(application)
  mount("A", Vector2.ZERO)
  mount("B", Vector2(420, 0))
  await settle()
  stages.initialApplication = native(application)
  check(native(application).pointerListenerQueryInstalled == (interest_mode == "current"), "Automatic SDK query installation follows only the selected pointer-interest mode")
  check(native(application).rootCount == 2 and native(surfaces.A).runtimeId == native(surfaces.B).runtimeId and native(surfaces.A).surfaceId != native(surfaces.B).surfaceId,
    "Two actual surfaces share Hermes with distinct native root identities")
  for name: String in ["A", "B"]:
    var capability: Dictionary = js("capability(%s)" % JSON.stringify(name))
    stages["capability" + name] = capability
    check(capability.mode == interest_mode and capability.flags.imperative and capability.flags.nativeDispatch and capability.original and capability.methods.all(func(value: String) -> bool: return value == "function"),
      "Both original flags select actual original EventTarget refs: " + name)
    check(capability.queries.available == (interest_mode == "current"), "Original control has no generated query export while current exposes actual Map observations: " + name)
    check(capability.logicalFlat and capability.flatNativeMetricsNull and capability.flatOriginalHandleLive and not native(surfaces[name]).nodes.any(func(node: Dictionary) -> bool: return node.tag == capability.tags.flat),
      "Flattened ancestor has a live logical Fiber and original ref without a native Control: " + name)
  await capture_frame("pointer-interest-" + interest_mode + "-before.png")
  var cases := [["bubble", "only", ["bubble"], ["bubble"]], ["capture", "only", ["capture"], ["capture"]],
    ["both", "only", ["capture", "bubble"], ["capture", "bubble"]], ["duplicate", "only", ["duplicate"], ["duplicate"]],
    ["once", "only", ["once"], ["once"]], ["none", "only", [], []], ["wrong-type", "only", [], ["wrong-type"]],
    ["abort-pre", "only", [], []], ["abort-after", "only", [], ["abort-after"]], ["remove-final", "only", [], ["remove-final"]],
    ["remove-peer", "only", ["remove-peer"], ["remove-peer"]], ["flat", "child", ["flat-capture", "flat-bubble"], ["flat-capture", "flat-bubble"]],
    ["mixed", "mixed", ["jsx", "mixed-imperative"], ["jsx", "mixed-imperative"]], ["document", "only", ["document-only"], ["document-only"]]]
  for entry: Array in cases:
    await run_case(entry[0], entry[1], entry[2], entry[3])
  await capture_frame("pointer-interest-" + interest_mode + "-after.png")

  js("removeImperative('A')")
  js("arm('A','mixed-after-removal','mixed')")
  await inject("A", "mixed")
  stages.mixedAfterRemoval = verify_down("A", "mixed-after-removal", ["jsx"])
  var mixed_before := native(surfaces.A)
  await inject("A", "mixed", "end")
  verify_release("A", mixed_before, "end", "mixed-after-removal")

  js("configure('A','bubble')")
  js("rerender('A')")
  await settle()
  stages.rerender = js("inspectLive('A')")
  check(stages.rerender.sameRef and stages.rerender.sameTag, "Actual React rerender preserves the listener-owning original ref and tag")
  js("arm('A','rerender')")
  await inject("A", "only")
  stages.rerenderNative = verify_down("A", "rerender", ["bubble"] if interest_mode == "current" else [])
  var cancel_before := native(surfaces.A)
  await inject("A", "only", "cancel")
  verify_release("A", cancel_before, "cancel", "rerender")

  stages.retainedReplacement = js("retain('A','replacement','replace')")
  js("replace('A')")
  await settle()
  stages.replaced = js("inspectRetained('replacement')")
  check(stages.replaced.parentNull and not stages.replaced.connected and stages.replaced.nativeLookupNull and stages.replaced.nativeMetricsNull and not stages.replaced.sameAsCurrent,
    "Actual keyed replacement retires the old original family and native Control")
  js("arm('A','retained-replacement-manual','replace')")
  var old_positive: Dictionary = js("pokeRetained('replacement')")
  stages.replacementManual = {"result": old_positive, "react": state()}
  check(old_positive.cleaned and not old_positive.trusted and state().events.size() == 1 and state().events[0].label == "retained-replacement" and state().events[0].targetMatches and state().raw.is_empty(),
    "Removed original ref keeps a functional self listener as the native retirement negative control")
  js("arm('A','replacement-native','replace')")
  var replacement_input_before := native(surfaces.A)
  await inject("A", "replace")
  stages.replacementNative = verify_down("A", "replacement-native", [])
  check(native(surfaces.A).pointer.pointerDowns == replacement_input_before.pointer.pointerDowns + 1 and native(surfaces.A).pointer.activePointers == 1 and native(application).pointerRouting.active == 1,
    "Keyed replacement negative consumes a real native hit without reviving its retained listener")
  var replace_before := native(surfaces.A)
  await inject("A", "replace", "end")
  verify_release("A", replace_before, "end", "replacement-native")

  js("configure('B','bubble')")
  js("arm('B','held-survivor')")
  await inject("B", "only")
  stages.heldSurvivor = verify_down("B", "held-survivor", ["bubble"] if interest_mode == "current" else [])
  check(native(surfaces.B).pointer.activePointers == 1 and native(application).pointerRouting.active == 1,
    "Surviving root has an actual held native contact before retiring A")
  js("retain('A','root','only')")
  var old_surface := native(surfaces.A)
  surfaces.A.call("unmount")
  await settle()
  stages.retiredRoot = js("inspectRetained('root')")
  check(native(application).rootCount == 1 and native(surfaces.A).nativeTags == 0 and native(surfaces.A).creates == native(surfaces.A).deletes and stages.retiredRoot.parentNull and not stages.retiredRoot.connected and stages.retiredRoot.nativeLookupNull,
    "Root retirement releases its real native tree while the retained original ref becomes disconnected")
  check(native(surfaces.B).pointer.activePointers == 1 and native(application).pointerRouting.active == 1 and native(application).pointerListenerQueryInstalled == (interest_mode == "current"),
    "Retiring A preserves B's held contact and the application-scoped query")
  js("arm('B','retained-root-manual')")
  var root_positive: Dictionary = js("pokeRetained('root')")
  stages.rootManual = {"result": root_positive, "react": state()}
  check(root_positive.cleaned and not root_positive.trusted and state().events.size() == 1 and state().events[0].label == "retained-root" and state().raw.is_empty(),
    "Retired root ref still self-dispatches positively while another native root survives")
  var held_before := native(surfaces.B)
  await inject("B", "only", "end")
  verify_release("B", held_before, "end", "retirement-held-survivor")
  js("arm('B','survivor')")
  await inject("B", "only")
  stages.survivor = verify_down("B", "survivor", ["bubble"] if interest_mode == "current" else [])
  var survivor_before := native(surfaces.B)
  await inject("B", "only", "end")
  verify_release("B", survivor_before, "end", "survivor")
  check(surfaces.A.call("mount"), "Same Godot surface remounts through the existing shared application")
  await settle()
  check(native(surfaces.A).surfaceId != old_surface.surfaceId and native(surfaces.A).runtimeId == old_surface.runtimeId and native(application).rootCount == 2,
    "Remount creates a fresh root generation without replacing Hermes")
  stages.afterRemount = js("inspectRetained('root')")
  check(not stages.afterRemount.sameAsCurrent and stages.afterRemount.nativeLookupNull, "Remount cannot resolve the retired root family as its replacement")
  js("arm('A','remount-native')")
  var remount_input_before := native(surfaces.A)
  await inject("A", "only")
  stages.remountNative = verify_down("A", "remount-native", [])
  check(native(surfaces.A).pointer.pointerDowns == remount_input_before.pointer.pointerDowns + 1 and native(surfaces.A).pointer.activePointers == 1 and native(application).pointerRouting.active == 1,
    "Remounted surface negative consumes a real native hit without reviving the previous root listener")
  var remount_before := native(surfaces.A)
  await inject("A", "only", "end")
  verify_release("A", remount_before, "end", "remount-native")
  js("arm('B','stop-held')")
  await inject("B", "only")
  stages.beforeStopReact = verify_down("B", "stop-held", ["bubble"] if interest_mode == "current" else [])
  stages.beforeStopApplication = native(application)
  check(stages.beforeStopReact.mounts.A == 2 and stages.beforeStopReact.mounts.B == 1 and stages.beforeStopReact.cleanups.A == 1 and stages.beforeStopReact.cleanups.get("B", 0) == 0,
    "Executed React lifecycle distinguishes retirement remount and the untouched surviving root")
  application.call("stop")
  await settle()
  var stopped := native(application)
  check(stopped.stopped and not stopped.pointerListenerQueryInstalled and stopped.rootCount == 0 and stopped.pendingWork == 0 and stopped.pendingTimers == 0 and stopped.pendingAnimationFrames == 0 and stopped.pendingRootRetirements == 0 and stopped.errors.is_empty() and stopped.pointerRouting.contacts == 0 and stopped.pointerRouting.stored == 0,
    "Stop removes the SDK query and every root contact timer work item without host errors")
  for name: String in ["A", "B"]:
    var final_root := native(surfaces[name])
    check(final_root.nativeTags == 0 and final_root.creates == final_root.deletes and final_root.pointer.activePointers == 0 and final_root.pointer.activeTouches == 0 and final_root.pointerProcessor.active == 0,
      "Stopped root balances native nodes and original pointer processor cleanup: " + name)
    surfaces[name].queue_free()
  application.queue_free()
  await settle()
  var report := {"scenario": "original-EventTarget-pointerdown-interest", "interestMode": interest_mode, "reactNative": "0.87.1",
    "godot": Engine.get_version_info().string, "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages, "afterStop": stopped, "captures": captures,
    "scope": {"actualNativeInput": true, "experimentalNativeDispatch": true, "originalFlagsEnabled": true, "interestType": "View-pointerdown",
      "documentInterestResolved": interest_mode == "current", "otherPointerTypesResolved": false, "listenerRegistryMirrored": false, "publicDefaultEnabled": false, "hardwareCertified": false}}
  var file := FileAccess.open("res://build/pointer-interest-report.json", FileAccess.WRITE)
  if not check(file != null, "Pointer-interest report can be saved"):
    quit(1)
    return
  file.store_string(JSON.stringify(report, "  ") + "\n")
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  print("POINTER_INTEREST_FAILED" if failed else "POINTER_INTEREST_PASSED: " + str(checks.size()))
  quit(1 if failed else 0)
