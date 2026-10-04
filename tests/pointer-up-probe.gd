extends "res://tests/pointer-query-fault-probe.gd"

# Reuse actual input, settling and original context/payload helpers. Never run
# the inherited fault matrix, inject query errors, or manually dispatch Down.
func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(PointerUpProbe." + expression + ")"))

func mount(name: String, position: Vector2) -> void:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = name
  surface.position = position
  surface.size = Vector2(300, 160)
  surface.set("application_path", NodePath("../PointerUpApplication"))
  surface.set("component_name", "PointerQueryFaultProbe")
  surface.set("initial_props", {"name": name, "probePointerUp": true})
  surface.set_meta("validation_input_device", DEVICE)
  surfaces[name] = surface
  root.add_child(surface)

func clean_contact(name: String, prefix: String, remaining: int = 0) -> void:
  var owner := native(surfaces[name])
  var app := native(application)
  check(owner.pointer.activePointers == 0 and owner.pointer.activeTouches == 0 and app.pointerProcessor.active == remaining and app.pointerProcessor.pendingCapture == 0 and app.pointerProcessor.activeCapture == 0 and app.pointerProcessor.hover == remaining and app.pointerRouting.contacts == remaining and app.pointerRouting.active == remaining and app.pointerRouting.stored == remaining,
    prefix + "/Physical adapter processor capture hover and routes clean independently of imperative delivery")

func touch_only(name: String, prefix: String, label: String, type: String) -> Dictionary:
  var value := state()
  var selected := normal_rows(value, label)
  check(selected.size() == 1 and selected[0].name == name and trusted_rows({"events": selected}) and exact_raw(value, type, label),
    prefix + "/Actual original " + label + " and both Raw channels preserve exact native context payload and timestamp")
  check(context_clean(value), prefix + "/Dispatch restores default priority global event and every original transient field")
  return value

func physical_down(name: String, index: int, prefix: String, remaining: int = 0) -> void:
  js("arm(%s,%s)" % [JSON.stringify(name), JSON.stringify(prefix + "/down")])
  var before := native(surfaces[name])
  await inject(name, index)
  var value := touch_only(name, prefix + "/down", "touchstart", "topTouchStart")
  var after := native(surfaces[name])
  var app := native(application)
  check(value.events.map(func(row: Dictionary) -> String: return row.label) == ["touchstart"] and value.raw.size() == 2 and rows_for(value, "topPointerDown").is_empty() and rows_for(value, "topPointerUp").is_empty(),
    prefix + "/Down has no JSX or imperative pointerdown helper and emits only the original TouchStart")
  check(value.panels[name].starts == value.baselineStarts + 1 and value.panels[name].ups == value.baselineUps and after.commits == before.commits + 1,
    prefix + "/TouchStart commits exactly one functional React update without counting an Up")
  check(not value.query.rows.is_empty() and value.query.rows.all(func(row: Dictionary) -> bool: return row.action == "delegate" and row.resultKind == "boolean" and not row.result and (row.offset == 34 or row.offset == 35)),
    prefix + "/Original SDK Down Maps are actually consulted and none qualifies the Up-only registry")
  check(after.pointer.pointerDowns == before.pointer.pointerDowns + 1 and after.pointer.starts == before.pointer.starts + 1 and after.pointer.activePointers == 1 and after.pointer.activeTouches == 1 and app.pointerProcessor.active == remaining + 1 and app.pointerRouting.active == remaining + 1 and app.pointerRouting.contacts == remaining + 1,
    prefix + "/Physical Down remains legitimately held across adapter processor and routes")
  stages[prefix + "/down"] = {"react": value, "before": before, "after": after, "application": app}

func manual_up(prefix: String, capture_only: bool) -> void:
  js("arm('A',%s)" % JSON.stringify(prefix + "/manual"))
  var result: Dictionary = js("publicControl('A')")
  var value := state()
  var label := "pointerup-capture" if capture_only else "pointerup-bubble"
  check(result.returned and result.cleaned and not result.trusted and result.targetMatches and value.events.size() == 1 and value.events[0].label == label and value.events[0].type == "pointerup" and value.events[0].phase == 2 and not value.events[0].trusted and value.events[0].currentMatches and value.events[0].thisMatches and value.events[0].targetMatches and value.raw.is_empty() and value.query.rows.is_empty() and value.panels.A.ups == value.baselineUps and context_clean(value),
    prefix + "/Original public untrusted pointerup independently proves the sole listener is installed without native Raw or React increment")
  stages[prefix + "/manual"] = {"result": result, "react": value}

func sibling_while_held() -> void:
  var prefix := "sibling-no-listeners"
  await physical_down("B", 1, prefix, 1)
  js("arm('B',%s)" % JSON.stringify(prefix + "/up"))
  var before := native(surfaces.B)
  await inject("B", 1, "end")
  var value := touch_only("B", prefix + "/up", "touchend", "topTouchEnd")
  var after := native(surfaces.B)
  check(value.events.map(func(row: Dictionary) -> String: return row.label) == ["touchend"] and value.raw.size() == 2 and rows_for(value, "topPointerUp").is_empty() and value.panels.B.ups == value.baselineUps and after.commits == before.commits and value.query.rows.all(func(row: Dictionary) -> bool: return row.action == "delegate" and row.resultKind == "boolean" and not row.result and (row.offset == 36 or row.offset == 37)),
    prefix + "/B Up remains inert for pointer listeners while original TouchEnd and held A survive")
  check(after.pointer.pointerUps == before.pointer.pointerUps + 1 and after.pointer.ends == before.pointer.ends + 1 and native(surfaces.A).pointer.activePointers == 1,
    prefix + "/Actual B terminal is sampled once without ending A")
  clean_contact("B", prefix, 1)
  stages[prefix + "/up"] = {"react": value, "before": before, "after": after, "application": native(application)}

func up_case(id: String, capture_only: bool, with_sibling: bool) -> void:
  var prefix := "case/" + id
  var registration: Dictionary = js("configure('A',%s)" % ("true" if capture_only else "false"))
  var capability: Dictionary = js("capability('A')")
  check(registration.type == "pointerup" and registration.capture == capture_only and registration.targetTag == capability.targetTag,
    prefix + "/Exactly the requested original Up phase is registered on the actual View ref")
  stages[prefix + "/registration"] = registration
  manual_up(prefix, capture_only)
  await physical_down("A", 0, prefix)
  if with_sibling:
    await sibling_while_held()
  js("arm('A',%s)" % JSON.stringify(prefix + "/up"))
  var before := native(surfaces.A)
  await inject("A", 0, "end")
  var value := touch_only("A", prefix + "/up", "touchend", "topTouchEnd")
  var after := native(surfaces.A)
  var label := "pointerup-capture" if capture_only else "pointerup-bubble"
  var callbacks := normal_rows(value, label)
  var callback_check := prefix + "/Physical Up delivers exactly one trusted original imperative callback before TouchEnd"
  var raw_check := prefix + "/Physical Up delivers typed and star Raw exactly once with the same actual callback payload"
  var react_check := prefix + "/Physical Up commits exactly one functional React increment and native counter width"
  var query_check := prefix + "/Physical Up uses actual original SDK offsets and the sole registered phase Map"
  expected_original_failures.append_array([callback_check, raw_check, react_check, query_check])
  check(value.events.map(func(row: Dictionary) -> String: return row.label) == [label, "touchend"] and callbacks.size() == 1 and callbacks[0].name == "A" and callbacks[0].type == "pointerup" and trusted_rows({"events": callbacks}) and callbacks[0].pointerId > 0 and callbacks[0].currentPriority == value.discretePriority and callbacks[0].buttons == 0 and callbacks[0].pressure == 0 and callbacks[0].pointerType == "touch", callback_check)
  var raw_up := rows_for(value, "topPointerUp")
  check(value.raw.size() == 4 and exact_raw(value, "topPointerUp", label) and raw_up.all(func(row: Dictionary) -> bool: return row.pointerId == callbacks[0].pointerId and row.buttons == 0 and row.pressure == 0 and row.pointerType == "touch"), raw_check)
  var counter := surfaces.A.find_child("A-up-counter", true, false) as Control
  check(value.panels.A.ups == value.baselineUps + 1 and value.panels.A.starts == value.baselineStarts and after.commits == before.commits + 1 and counter is Control and is_equal_approx(counter.size.x, 20.0 + value.panels.A.ups * 4.0), react_check)
  var own: Array = value.query.rows.filter(func(row: Dictionary) -> bool: return row.targetTag == value.targetTag)
  var exact_query: bool = own.size() == (2 if capture_only else 1) and own[0].offset == 36 and own[0].action == "delegate" and own[0].resultKind == "boolean" and own[0].result == (false if capture_only else true)
  if capture_only:
    exact_query = exact_query and own[1].offset == 37 and own[1].action == "delegate" and own[1].resultKind == "boolean" and own[1].result and own[0].sequence < own[1].sequence
  check(exact_query and value.query.rows.size() == own.size(), query_check)
  check(after.pointer.pointerUps == before.pointer.pointerUps + 1 and after.pointer.ends == before.pointer.ends + 1 and context_clean(value),
    prefix + "/Actual terminal samples and cleanup remain correct independently of filtered imperative Up")
  clean_contact("A", prefix)
  stages[prefix + "/up"] = {"react": value, "before": before, "after": after, "application": native(application),
    "observedFilteredUp": callbacks.is_empty() and raw_up.is_empty(), "observedSDKEntryCount": value.query.rows.size(),
    "nativeCounterWidth": counter.size.x if counter is Control else null}

func cancel_control() -> void:
  var prefix := "cancel-is-not-up"
  await physical_down("A", 0, prefix)
  js("arm('A',%s)" % JSON.stringify(prefix + "/cancel"))
  var before := native(surfaces.A)
  await inject("A", 0, "cancel")
  var value := touch_only("A", prefix, "touchcancel", "topTouchCancel")
  var after := native(surfaces.A)
  check(value.events.map(func(row: Dictionary) -> String: return row.label) == ["touchcancel"] and value.raw.size() == 2 and rows_for(value, "topPointerUp").is_empty() and value.query.rows.is_empty() and value.panels.A.ups == value.baselineUps and after.commits == before.commits,
    prefix + "/Actual Cancel never borrows Up offsets or invokes its registered Up capture listener")
  check(after.pointer.pointerCancels == before.pointer.pointerCancels + 1 and after.pointer.cancels == before.pointer.cancels + 1,
    prefix + "/One actual Cancel completes pointer and touch")
  clean_contact("A", prefix)
  stages[prefix + "/cancel"] = {"react": value, "before": before, "after": after, "application": native(application)}

func _initialize() -> void:
  allow_original_negative = OS.get_cmdline_user_args().has("--allow-original-negative")
  call_deferred("run_probe")

func run_probe() -> void:
  root.size = Vector2i(680, 160)
  application = ClassDB.instantiate("FabricApplication")
  application.name = "PointerUpApplication"
  application.set("bundle_path", "res://build/pointer-up-enabled.js")
  root.add_child(application)
  mount("A", Vector2.ZERO)
  mount("B", Vector2(340, 0))
  await settle()
  check(native(application).rootCount == 2 and native(application).pointerListenerQueryInstalled and native(surfaces.A).runtimeId == native(surfaces.B).runtimeId and native(surfaces.A).surfaceId != native(surfaces.B).surfaceId,
    "mount/Two actual roots share Hermes and the one installed original SDK query")
  for name: String in ["A", "B"]:
    var capability: Dictionary = js("capability(%s)" % JSON.stringify(name))
    stages["capability" + name] = capability
    check(capability.original and capability.connected and capability.flags.imperative and capability.flags.nativeDispatch and capability.methods == ["function", "function", "function"] and capability.query.installations == 1 and capability.query.restoredInstaller,
      "capability/" + name + "/Actual original refs and immutable enabled flags use the single real SDK installation")
  await up_case("bubble", false, true)
  await up_case("capture-only", true, false)
  await cancel_control()
  stages.beforeStop = {"application": native(application), "react": state()}
  check(stages.beforeStop.application.errors.is_empty() and stages.beforeStop.react.panels.A.starts == 3 and stages.beforeStop.react.panels.B.starts == 1,
    "cleanup/All real Down touch callbacks committed and no query or dispatch diagnostic was hidden")
  application.call("stop")
  await settle()
  var stopped := native(application)
  check(stopped.stopped and not stopped.pointerListenerQueryInstalled and stopped.rootCount == 0 and stopped.pendingWork == 0 and stopped.pendingTimers == 0 and stopped.pendingAnimationFrames == 0 and stopped.pendingRootRetirements == 0 and stopped.pointerProcessor.active == 0 and stopped.pointerProcessor.pendingCapture == 0 and stopped.pointerProcessor.activeCapture == 0 and stopped.pointerProcessor.hover == 0 and stopped.pointerRouting.contacts == 0 and stopped.pointerRouting.stored == 0 and stopped.errors.is_empty(),
    "cleanup/Stop balances roots query work timers routes capture and hover without diagnostics")
  for name: String in ["A", "B"]:
    var final_root := native(surfaces[name])
    check(final_root.nativeTags == 0 and final_root.creates == final_root.deletes and final_root.pointer.activePointers == 0 and final_root.pointer.activeTouches == 0,
      "cleanup/" + name + "/All real native Controls and contacts are balanced")
    stages["stoppedRoot" + name] = final_root
    surfaces[name].queue_free()
  application.queue_free()
  await settle()
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var observed := failures.duplicate()
  var expected := expected_original_failures.duplicate()
  observed.sort()
  expected.sort()
  var original_negative_observed := allow_original_negative and observed == expected and failures.size() == 8
  var report := {"scenario": "native-pointer-up-view-interest", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages, "afterStop": stopped,
    "expectedOriginalFailures": expected_original_failures, "allowOriginalNegative": allow_original_negative,
    "originalNegativeObserved": original_negative_observed, "allCurrentAssertionsPassed": failures.is_empty(),
    "scope": {"actualNativeInput": true, "originalFlagsEnabled": true, "experimentalNativeDispatch": true,
      "realSDKQueryWrappedOnlyForTest": true, "listenerRegistryMirrored": false, "pointerUpOnlyViewScope": true,
      "documentInterestCertified": false, "publicAPIAdded": false, "publicDefaultEnabled": false, "hardwareCertified": false}}
  var output := FileAccess.open("res://build/pointer-up-report.json", FileAccess.WRITE)
  if not check(output != null, "report/PointerUp report is saved with visible normative failures"):
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  print("POINTER_UP_ORIGINAL_NEGATIVE: " + str(failures.size()) if original_negative_observed else "POINTER_UP_PASSED: " + str(checks.size()) if failures.is_empty() else "POINTER_UP_FAILED")
  quit(0 if failures.is_empty() or original_negative_observed else 1)
