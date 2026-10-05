extends SceneTree

const DEVICE := 1001
const POINT := Vector2(75, 55)
var application: Node
var surfaces: Dictionary = {}
var checks: Array = []
var stages: Dictionary = {}
var expected_original_failures: Array = []
var expected_errors: Array = []
var allow_original_negative := false
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
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(QueryFaultProbe." + expression + ")"))

func state() -> Dictionary:
  var value: Variant = js("snapshot()")
  return value if value is Dictionary else {}

func mount(name: String, position: Vector2) -> void:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = name
  surface.position = position
  surface.size = Vector2(300, 160)
  surface.set("application_path", NodePath("../PointerQueryFaultApplication"))
  surface.set("component_name", "PointerQueryFaultProbe")
  surface.set("initial_props", {"name": name})
  surface.set_meta("validation_input_device", DEVICE)
  surfaces[name] = surface
  root.add_child(surface)

func inject(name: String, index: int, phase: String = "start") -> void:
  var event := InputEventScreenTouch.new()
  event.device = DEVICE
  event.index = index
  event.position = surfaces[name].position + POINT
  event.pressed = phase == "start"
  event.canceled = phase == "cancel"
  Input.parse_input_event(event)
  await settle()

func rows_for(value: Dictionary, type: String) -> Array:
  return value.raw.filter(func(row: Dictionary) -> bool: return row.type == type)

func normal_rows(value: Dictionary, label: String) -> Array:
  return value.events.filter(func(row: Dictionary) -> bool: return row.label == label)

func exact_raw(value: Dictionary, type: String, label: String) -> bool:
  var raw := rows_for(value, type)
  var events := normal_rows(value, label)
  return raw.size() == 2 and events.size() == 1 and raw[0].channel == "typed" and raw[1].channel == "star" and raw[0].payloadId == raw[1].payloadId and raw[1].sequence < events[0].sequence and events[0].payloadId == raw[0].payloadId and events[0].nativeTarget == raw[0].target and events[0].timeStamp == events[0].nativeTimeStamp and events[0].timeStamp == raw[0].timeStamp

func context_clean(value: Dictionary) -> bool:
  return value.globalEventRestored and value.currentPriority == value.defaultPriority and value.cleanup.size() == value.events.size() and value.cleanup.all(func(row: Dictionary) -> bool: return row.currentTargetNull and row.phase == 0 and row.pathEmpty and row.originalEvent)

func trusted_rows(value: Dictionary) -> bool:
  return value.events.all(func(row: Dictionary) -> bool: return row.trusted and row.originalSynthetic and row.originalEvent and row.currentMatches and row.thisMatches and row.targetMatches and row.globalEventMatches and row.phase == 2)

func verify_healthy_down(name: String, prefix: String, capture: bool, active_before: int) -> Dictionary:
  var value := state()
  var down_label := "pointerdown-capture" if capture else "pointerdown-bubble"
  check(value.events.map(func(row: Dictionary) -> String: return row.label) == [down_label, "touchstart"] and trusted_rows(value), prefix + "/Exact trusted original pointerdown then touchstart order and identities")
  check(value.raw.size() == 4 and exact_raw(value, "topPointerDown", down_label) and exact_raw(value, "topTouchStart", "touchstart"), prefix + "/Both real Raw topics retain payload identity timestamps and one delivery per channel")
  check(value.panels[name].starts == value.baselineStarts + 1 and context_clean(value), prefix + "/Healthy touch callback commits functional React state and restores dispatch context")
  check(not value.query.rows.is_empty() and value.query.rows.all(func(row: Dictionary) -> bool: return row.action == "delegate" and row.resultKind == "boolean") and value.query.rows.any(func(row: Dictionary) -> bool: return row.offset == (35 if capture else 34) and row.result), prefix + "/Healthy native interest uses the installed original SDK boolean query")
  check(native(surfaces[name]).pointer.activePointers == 1 and native(surfaces[name]).pointer.activeTouches == 1 and native(application).pointerProcessor.active == active_before + 1 and native(application).pointerRouting.active == active_before + 1,
    prefix + "/Actual physical contact is registered consistently in adapter processor and routes")
  check(value.query.installations == 1 and value.query.restoredInstaller, prefix + "/One real SDK installation remains active without replacing its installer")
  return value

func negative_up_queries(rows: Array) -> bool:
  if rows.size() % 2 != 0:
    return false
  for index in range(0, rows.size(), 2):
    if rows[index].offset != 36 or rows[index + 1].offset != 37:
      return false
  return rows.all(func(row: Dictionary) -> bool: return row.action == "delegate" and not row.matched and row.resultKind == "boolean" and not row.result)

func verify_terminal(name: String, before: Dictionary, phase: String, prefix: String, active_after: int = 0) -> Dictionary:
  var value := state()
  var label := "touchcancel" if phase == "cancel" else "touchend"
  var type := "topTouchCancel" if phase == "cancel" else "topTouchEnd"
  check(value.events.map(func(row: Dictionary) -> String: return row.label) == [label] and trusted_rows(value) and context_clean(value), prefix + "/Terminal native touch uses the exact original callback and cleans transient fields")
  check(value.raw.size() == 2 and exact_raw(value, type, label), prefix + "/Terminal Raw topic retains its actual native payload identity and timestamp")
  check(value.query.rows.is_empty() if phase == "cancel" else negative_up_queries(value.query.rows), prefix + "/Up or Cancel never retries pointerdown interest or its consumed fault")
  var after := native(surfaces[name])
  var app := native(application)
  check(after.pointer.activePointers == 0 and after.pointer.activeTouches == 0 and app.pointerProcessor.active == active_after and app.pointerProcessor.pendingCapture == 0 and app.pointerProcessor.activeCapture == 0 and app.pointerProcessor.hover == active_after and app.pointerRouting.contacts == active_after and app.pointerRouting.active == active_after and app.pointerRouting.stored == active_after,
    prefix + "/Terminal cleanup preserves other contacts and clears this physical pointer across all owners")
  check((after.pointer.pointerCancels == before.pointer.pointerCancels + 1 and after.pointer.cancels == before.pointer.cancels + 1) if phase == "cancel" else (after.pointer.pointerUps == before.pointer.pointerUps + 1 and after.pointer.ends == before.pointer.ends + 1),
    prefix + "/Exactly one actual native terminal sample completes both pointer and touch paths")
  return value

func public_control(name: String, prefix: String, capture: bool) -> void:
  js("arm(%s,%s)" % [JSON.stringify(name), JSON.stringify(prefix + "/manual")])
  var result: Dictionary = js("publicControl(%s)" % JSON.stringify(name))
  var value := state()
  check(result.returned and result.cleaned and not result.trusted and result.targetMatches and value.events.size() == 1 and value.events[0].label == ("pointerdown-capture" if capture else "pointerdown-bubble") and not value.events[0].trusted and value.events[0].currentMatches and value.events[0].thisMatches and value.events[0].targetMatches and value.raw.is_empty() and value.query.rows.is_empty(),
    prefix + "/Actual original imperative listener passes an independent public dispatch control")
  stages[prefix + "/manual"] = {"result": result, "react": value}

func healthy_gesture(name: String, index: int, prefix: String, capture: bool = false, active_before: int = 0) -> void:
  js("configure(%s,%s)" % [JSON.stringify(name), "true" if capture else "false"])
  js("arm(%s,%s)" % [JSON.stringify(name), JSON.stringify(prefix + "/down")])
  var errors_before: Array = native(application).errors
  await inject(name, index)
  stages[prefix + "/down"] = verify_healthy_down(name, prefix, capture, active_before)
  js("arm(%s,%s)" % [JSON.stringify(name), JSON.stringify(prefix + "/end")])
  var before := native(surfaces[name])
  await inject(name, index, "end")
  stages[prefix + "/end"] = verify_terminal(name, before, "end", prefix, active_before)
  check(native(application).errors == errors_before, prefix + "/Healthy recovery adds no unexpected diagnostic")

func run_fault(id: String, offset: int, mode: String, terminal: String) -> void:
  var prefix := "case/" + id
  js("clearFault()")
  js("configure('A',%s)" % ("true" if offset == 35 else "false"))
  public_control("A", prefix, offset == 35)
  js("arm('A',%s)" % JSON.stringify(prefix + "/down"))
  stages[prefix + "/configuration"] = js("fault('A',%d,%s,%s)" % [offset, JSON.stringify(mode), JSON.stringify(id)])
  var before := native(surfaces.A)
  var errors_before: Array = native(application).errors
  await inject("A", 0)
  var value := state()
  var after := native(surfaces.A)
  var app := native(application)
  var expected := "GF pointer query deliberate fault: " + id if mode == "throw" else "Pointer listener query must return a boolean"
  expected_errors.append(expected)
  check(app.errors.size() == errors_before.size() + 1 and str(app.errors[-1]).contains(expected), prefix + "/Exactly one explicit native query diagnostic is reported")
  var attempts: Array = value.query.rows.filter(func(row: Dictionary) -> bool: return row.matched)
  check(attempts.size() == 1 and attempts[0].targetTag == value.targetTag and attempts[0].offset == offset and attempts[0].action == mode and value.query.fault.remaining == 0 and value.query.fault.label == id,
    prefix + "/The actual callback consumes its one matching public ref and native offset fault")
  if offset == 35:
    check(value.query.rows.any(func(row: Dictionary) -> bool: return row.targetTag == value.targetTag and row.offset == 34 and row.action == "delegate" and row.resultKind == "boolean" and not row.result and row.sequence < attempts[0].sequence),
      prefix + "/Capture fault is reached only after the actual bubble Map returned false")
  check(normal_rows(value, "pointerdown-bubble").is_empty() and normal_rows(value, "pointerdown-capture").is_empty() and rows_for(value, "topPointerDown").is_empty(),
    prefix + "/Failed interest query does not fabricate a pointerdown callback or Raw down")
  var touch_check := prefix + "/Same-batch TouchStart callback survives query failure"
  var raw_check := prefix + "/Same-batch Raw touchstart survives query failure"
  var state_check := prefix + "/Same-batch TouchStart commits functional React state"
  expected_original_failures.append_array([touch_check, raw_check, state_check])
  check(value.events.map(func(row: Dictionary) -> String: return row.label) == ["touchstart"] and trusted_rows(value), touch_check)
  check(value.raw.size() == 2 and exact_raw(value, "topTouchStart", "touchstart"), raw_check)
  check(value.panels.A.starts == value.baselineStarts + 1, state_check)
  check(context_clean(value), prefix + "/Query failure does not retain global event priority or transient synthetic fields")
  check(after.pointer.pointerDowns == before.pointer.pointerDowns + 1 and after.pointer.starts == before.pointer.starts + 1 and after.pointer.activePointers == 1 and after.pointer.activeTouches == 1 and app.pointerProcessor.active == 1 and app.pointerRouting.active == 1 and app.pointerRouting.contacts == 1,
    prefix + "/Held physical contact remains legitimately active after Down despite the query error")
  stages[prefix + "/down"] = {"react": value, "before": before, "after": after, "application": app}
  js("clearFault()")
  await healthy_gesture("B", 1, prefix + "/survivor-held", false, 1)
  if id == "throw34":
    await capture_frame("pointer-query-fault-updated.png", true)
  if terminal == "end" or terminal == "cancel":
    js("arm('A',%s)" % JSON.stringify(prefix + "/terminal"))
    var terminal_before := native(surfaces.A)
    await inject("A", 0, terminal)
    stages[prefix + "/terminal"] = verify_terminal("A", terminal_before, terminal, prefix + "/fault-contact")
    await healthy_gesture("A", 0, prefix + "/next-gesture")
  elif terminal == "retirement":
    var retired_before := native(surfaces.A)
    surfaces.A.call("unmount")
    await settle()
    var retired := native(surfaces.A)
    app = native(application)
    check(app.rootCount == 1 and app.pointerListenerQueryInstalled and app.pointerProcessor.active == 0 and app.pointerProcessor.pendingCapture == 0 and app.pointerProcessor.activeCapture == 0 and app.pointerProcessor.hover == 0 and app.pointerRouting.contacts == 0 and app.pointerRouting.stored == 0 and retired.nativeTags == 0 and retired.creates == retired.deletes and retired.pointer.activePointers == 0 and retired.pointer.activeTouches == 0 and retired.pointer.pointerCancels == retired_before.pointer.pointerCancels + 1,
      prefix + "/Retirement clears the fault contact and real root while retaining the shared SDK query")
    stages[prefix + "/retired"] = {"root": retired, "application": app, "react": state()}
    await healthy_gesture("B", 1, prefix + "/survivor-after-retirement")
    check(surfaces.A.call("mount"), prefix + "/Same surface remounts after fault retirement")
    await settle()
    check(native(surfaces.A).surfaceId != retired_before.surfaceId and native(application).rootCount == 2,
      prefix + "/Remount replaces the retired root generation")
    await healthy_gesture("A", 0, prefix + "/next-gesture")
  else:
    check(terminal == "stop", prefix + "/Only the declared final stop case remains physically held")
  check(native(application).errors.size() == errors_before.size() + 1, prefix + "/Terminal retirement and recovery never duplicate or hide the diagnostic")

func capture_frame(filename: String, updated: bool) -> void:
  if capture and DisplayServer.get_name() != "headless":
    await RenderingServer.frame_post_draw
    var image := root.get_texture().get_image()
    var saved := image.save_png("res://build/" + filename)
    var pixels: Array = []
    for origin: Vector2i in [Vector2i.ZERO, Vector2i(340, 0)]:
      var extension_x := 50 if origin == Vector2i.ZERO else 43
      var points := [Vector2i(5, 5), Vector2i(75, 55), Vector2i(25, 127), Vector2i(extension_x, 127)]
      var colors := ["0f172aff", "2563ebff", "fde047ff", "fde047ff" if updated else "0f172aff"]
      for index in range(points.size()):
        var point: Vector2i = origin + points[index]
        var actual := image.get_pixelv(point).to_html()
        var expected: String = colors[index]
        check(actual == expected, "Actual query-fault frame matches committed native state: " + filename + "/" + str(point))
        pixels.append({"point": [point.x, point.y], "color": actual, "expected": expected})
    check(saved == OK and image.get_width() == 680 and image.get_height() == 160,
      "Query-fault native frame is saved at scenario dimensions: " + filename)
    captures.append({"file": "build/" + filename, "width": image.get_width(), "height": image.get_height(), "pixels": pixels,
      "reactCounters": state().panels})

func _initialize() -> void:
  allow_original_negative = OS.get_cmdline_user_args().has("--allow-original-negative")
  capture = OS.get_cmdline_user_args().has("--capture")
  call_deferred("run_probe")

func run_probe() -> void:
  root.size = Vector2i(680, 160)
  application = ClassDB.instantiate("FabricApplication")
  application.name = "PointerQueryFaultApplication"
  application.set("bundle_path", "res://build/pointer-query-fault-enabled.js")
  root.add_child(application)
  mount("A", Vector2.ZERO)
  mount("B", Vector2(340, 0))
  await settle()
  check(native(application).rootCount == 2 and native(application).pointerListenerQueryInstalled and native(surfaces.A).runtimeId == native(surfaces.B).runtimeId and native(surfaces.A).surfaceId != native(surfaces.B).surfaceId,
    "Two real roots share Hermes and one automatically installed SDK query")
  for name: String in ["A", "B"]:
    var capability: Dictionary = js("capability(%s)" % JSON.stringify(name))
    stages["capability" + name] = capability
    check(capability.original and capability.connected and capability.flags.imperative and capability.flags.nativeDispatch and capability.methods == ["function", "function", "function"] and capability.query.installations == 1 and capability.query.restoredInstaller,
      "Actual original public ref and flags use the single real SDK installation: " + name)
  await capture_frame("pointer-query-fault-initial.png", false)
  js("configure('A',false)")
  public_control("A", "positive-bubble", false)
  await healthy_gesture("A", 0, "positive-bubble")
  js("configure('A',true)")
  public_control("A", "positive-capture", true)
  await healthy_gesture("A", 0, "positive-capture", true)
  await run_fault("throw34", 34, "throw", "end")
  await run_fault("nonboolean34", 34, "nonboolean", "cancel")
  await run_fault("throw35", 35, "throw", "retirement")
  await run_fault("nonboolean35", 35, "nonboolean", "stop")
  stages.beforeStop = {"application": native(application), "react": state()}
  check(stages.beforeStop.application.errors.size() == 4 and stages.beforeStop.application.pointerProcessor.active == 1 and stages.beforeStop.application.pointerRouting.active == 1 and stages.beforeStop.react.query.installations == 1,
    "Final fault remains a legitimate held contact with exactly four retained diagnostics")
  application.call("stop")
  await settle()
  var stopped := native(application)
  check(stopped.stopped and not stopped.pointerListenerQueryInstalled and stopped.rootCount == 0 and stopped.pendingWork == 0 and stopped.pendingTimers == 0 and stopped.pendingAnimationFrames == 0 and stopped.pendingRootRetirements == 0 and stopped.pointerProcessor.active == 0 and stopped.pointerProcessor.pendingCapture == 0 and stopped.pointerProcessor.activeCapture == 0 and stopped.pointerProcessor.hover == 0 and stopped.pointerRouting.contacts == 0 and stopped.pointerRouting.stored == 0 and stopped.errors.size() == 4,
    "Stop clears the last fault contact roots query timers queue and processor without suppressing diagnostics")
  for name: String in ["A", "B"]:
    var final_root := native(surfaces[name])
    check(final_root.nativeTags == 0 and final_root.creates == final_root.deletes and final_root.pointer.activePointers == 0 and final_root.pointer.activeTouches == 0,
      "Stopped root balances all native Controls and contacts: " + name)
    stages["stoppedRoot" + name] = final_root
    surfaces[name].queue_free()
  application.queue_free()
  await settle()
  var failed_names: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var expected_names := expected_original_failures.duplicate()
  var observed_names := failed_names.duplicate()
  expected_names.sort()
  observed_names.sort()
  var original_negative_observed := allow_original_negative and observed_names == expected_names and not failed_names.is_empty()
  var report := {"scenario": "native-pointer-query-fault-batch-isolation", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages, "afterStop": stopped, "expectedErrors": expected_errors,
    "captures": captures,
    "expectedOriginalFailures": expected_original_failures, "allowOriginalNegative": allow_original_negative,
    "originalNegativeObserved": original_negative_observed, "allCurrentAssertionsPassed": failed_names.is_empty(),
    "scope": {"actualNativeInput": true, "experimentalNativeDispatch": true, "originalFlagsEnabled": true,
      "realSDKQueryWrappedOnlyForTest": true, "listenerRegistryMirrored": false, "publicAPIAdded": false,
      "heldContactAfterDownIsLegitimate": true, "publicDefaultEnabled": false, "hardwareCertified": false}}
  var file := FileAccess.open("res://build/pointer-query-fault-report.json", FileAccess.WRITE)
  if not check(file != null, "Pointer-query-fault report can be saved"):
    quit(1)
    return
  file.store_string(JSON.stringify(report, "  ") + "\n")
  print("POINTER_QUERY_FAULT_ORIGINAL_NEGATIVE: " + str(failed_names.size()) if original_negative_observed else "POINTER_QUERY_FAULT_PASSED: " + str(checks.size()) if failed_names.is_empty() else "POINTER_QUERY_FAULT_FAILED")
  quit(0 if failed_names.is_empty() or original_negative_observed else 1)
