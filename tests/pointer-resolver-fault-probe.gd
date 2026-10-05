extends "res://tests/pointer-query-fault-probe.gd"

# Reuse the existing executed native input, Raw identity, event context and
# terminal helpers. The old scenario itself is never invoked by this probe.
func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(PointerResolverFaultProbe." + expression + ")"))

func mount(name: String, position: Vector2) -> void:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = name
  surface.position = position
  surface.size = Vector2(300, 160)
  surface.set("application_path", NodePath("../PointerResolverFaultApplication"))
  surface.set("component_name", "PointerQueryFaultProbe")
  surface.set("initial_props", {"name": name})
  surface.set_meta("validation_input_device", DEVICE)
  surfaces[name] = surface
  root.add_child(surface)

func capture_frame(filename: String, updated: bool) -> void:
  if not capture or DisplayServer.get_name() == "headless":
    return
  await RenderingServer.frame_post_draw
  var image := root.get_texture().get_image()
  var saved := image.save_png("res://build/" + filename)
  var pixels: Array = []
  for origin: Vector2i in [Vector2i.ZERO, Vector2i(340, 0)]:
    var extension_x := 47 if origin == Vector2i.ZERO else 43
    var points := [Vector2i(5, 5), Vector2i(75, 55), Vector2i(25, 127), Vector2i(extension_x, 127)]
    var colors := ["0f172aff", "2563ebff", "fde047ff", "fde047ff" if updated and origin == Vector2i.ZERO else "0f172aff"]
    for index in range(points.size()):
      var point: Vector2i = origin + points[index]
      var actual := image.get_pixelv(point).to_html()
      var expected_color: String = colors[index]
      check(actual == expected_color, "resolver-capture/" + filename + "/Actual native pixel " + str(point) + " matches committed React state")
      pixels.append({"point": [point.x, point.y], "color": actual, "expected": expected_color})
  var counters: Dictionary = state().panels
  var expected_a := 2 if updated else 0
  check(counters.A.starts == expected_a and counters.B.starts == 0,
    "resolver-capture/" + filename + "/Actual React counters are A" + str(expected_a) + " and B0 at the exact captured stage")
  check(saved == OK and image.get_width() == 680 and image.get_height() == 160,
    "resolver-capture/" + filename + "/Actual native viewport is saved at the scenario dimensions")
  captures.append({"file": "build/" + filename, "width": image.get_width(), "height": image.get_height(), "pixels": pixels,
    "reactCounters": counters, "expectedReactCounters": {"A": expected_a, "B": 0}})

func _initialize() -> void:
  allow_original_negative = OS.get_cmdline_user_args().has("--allow-original-negative")
  capture = OS.get_cmdline_user_args().has("--capture")
  call_deferred("run_probe")

func run_probe() -> void:
  root.size = Vector2i(680, 160)
  application = ClassDB.instantiate("FabricApplication")
  application.name = "PointerResolverFaultApplication"
  application.set("bundle_path", "res://build/pointer-resolver-fault-enabled.js")
  root.add_child(application)
  mount("A", Vector2.ZERO)
  mount("B", Vector2(340, 0))
  await settle()
  check(native(application).rootCount == 2 and native(application).pointerListenerQueryInstalled and native(surfaces.A).runtimeId == native(surfaces.B).runtimeId and native(surfaces.A).surfaceId != native(surfaces.B).surfaceId,
    "mount/Two real roots share one Hermes application and the unchanged installed SDK query")
  for name: String in ["A", "B"]:
    var capability: Dictionary = js("capability(%s)" % JSON.stringify(name))
    stages["capability" + name] = capability
    check(capability.original and capability.connected and capability.flags.imperative and capability.flags.nativeDispatch and capability.methods == ["function", "function", "function"] and capability.query.installations == 1 and capability.query.restoredInstaller,
      "capability/" + name + "/Actual original View ref uses the single real SDK installation")
  await capture_frame("pointer-resolver-fault-initial.png", false)
  js("configure('A',false)")
  public_control("A", "positive-before-getter", false)
  await healthy_gesture("A", 0, "positive-before-getter")
  check(not state().resolver.armed and state().resolver.attempts.is_empty(), "positive-before-getter/Healthy executed input precedes any descriptor mutation")

  var prefix := "case/canonical-publicInstance"
  js("configure('A',false)")
  public_control("A", prefix, false)
  js("arm('A',%s)" % JSON.stringify(prefix + "/down"))
  var configuration: Dictionary = js("armResolverFault('A')")
  stages[prefix + "/configuration"] = configuration
  check(configuration.actualFiber and configuration.actualCanonical and configuration.descriptorOwnData and configuration.descriptorConfigurable and configuration.originalRef and configuration.connected and configuration.valueTagMatches and configuration.remaining == 1,
    prefix + "/Getter is installed on the actual newest native-tag Fiber canonical and original own ref descriptor")
  var before := native(surfaces.A)
  var errors_before: Array = native(application).errors
  await inject("A", 0)
  var value := state()
  var after := native(surfaces.A)
  var app := native(application)
  var cause: String = configuration.cause
  expected_errors.append(cause)
  check(app.errors.size() == errors_before.size() + 1 and str(app.errors[-1]).contains(cause),
    prefix + "/Exactly one real native diagnostic preserves the deliberate resolver cause")
  var attempts: Array = value.resolver.attempts
  check(attempts.size() == 1 and attempts[0].ownerMatches and attempts[0].remaining == 0 and attempts[0].descriptorRestoredBeforeThrow and attempts[0].sdkEntriesBeforeThrow == 0 and value.resolver.remaining == 0,
    prefix + "/The one actual getter access restores its descriptor before throwing without entering SDK query")
  check(not value.resolver.armed and value.resolver.descriptorRestored and value.resolver.descriptor.kind == "data" and value.resolver.descriptor.valueMatches and value.resolver.descriptor.writableMatches and value.resolver.descriptor.enumerableMatches and value.resolver.descriptor.configurableMatches,
    prefix + "/Original data descriptor value and all flags are restored before subsequent work")
  check(value.query.rows.all(func(row: Dictionary) -> bool: return row.targetTag != value.targetTag or row.offset != 34),
    prefix + "/The failed A offset34 resolver never invokes its SDK callback")
  if allow_original_negative:
    check(value.query.rows.is_empty(), prefix + "/Resolver failure records the expected later SDK entry boundary")
  else:
    check(not value.query.rows.is_empty() and value.query.rows.all(func(row: Dictionary) -> bool: return row.action == "delegate" and row.resultKind == "boolean" and not row.result),
      prefix + "/Resolver failure records the expected later SDK entry boundary")
  check(normal_rows(value, "pointerdown-bubble").is_empty() and normal_rows(value, "pointerdown-capture").is_empty() and rows_for(value, "topPointerDown").is_empty(),
    prefix + "/Failed bubble resolver creates no pointerdown callback or Raw down")
  var callback_check := prefix + "/Same-batch TouchStart callback survives resolver failure"
  var raw_check := prefix + "/Same-batch Raw touchstart survives resolver failure"
  var react_check := prefix + "/Same-batch TouchStart commits functional React state"
  expected_original_failures.append_array([callback_check, raw_check, react_check])
  check(value.events.map(func(row: Dictionary) -> String: return row.label) == ["touchstart"] and trusted_rows(value), callback_check)
  check(value.raw.size() == 2 and exact_raw(value, "topTouchStart", "touchstart"), raw_check)
  check(value.panels.A.starts == value.baselineStarts + 1 and after.commits == before.commits + 1, react_check)
  check(context_clean(value), prefix + "/Resolver failure restores native priority and global and synthetic event context")
  check(after.pointer.pointerDowns == before.pointer.pointerDowns + 1 and after.pointer.starts == before.pointer.starts + 1 and after.pointer.activePointers == 1 and after.pointer.activeTouches == 1 and app.pointerProcessor.active == 1 and app.pointerRouting.active == 1 and app.pointerRouting.contacts == 1,
    prefix + "/Actual physical Down remains a legitimate held contact until its terminal sample")
  stages[prefix + "/down"] = {"react": value, "before": before, "after": after, "application": app}
  # One healthy A TouchStart plus the preserved fault-batch TouchStart makes A2;
  # B has not received any input and remains B0 at this native readback.
  await capture_frame("pointer-resolver-fault-updated.png", true)

  await healthy_gesture("B", 1, "survivor-while-held", false, 1)
  check(state().resolver.attempts.size() == 1 and state().resolver.descriptorRestored and native(surfaces.A).pointer.activePointers == 1,
    "survivor-while-held/Independent B Up preserves the restored descriptor and legitimate held A contact")
  js("arm('A',%s)" % JSON.stringify(prefix + "/terminal"))
  var terminal_before := native(surfaces.A)
  await inject("A", 0, "cancel")
  stages[prefix + "/terminal"] = verify_terminal("A", terminal_before, "cancel", prefix + "/fault-contact")
  await healthy_gesture("A", 0, "next-gesture")
  check(state().resolver.attempts.size() == 1 and state().resolver.descriptorRestored and state().resolver.remaining == 0,
    "next-gesture/Restored descriptor supports the next actual A gesture without another resolver fault")
  check(native(application).errors.size() == 1, "errors/Recovery and independent roots neither duplicate nor clear the one native diagnostic")
  stages.beforeStop = {"application": native(application), "react": state()}
  application.call("stop")
  await settle()
  var stopped := native(application)
  check(stopped.stopped and not stopped.pointerListenerQueryInstalled and stopped.rootCount == 0 and stopped.pendingWork == 0 and stopped.pendingTimers == 0 and stopped.pendingAnimationFrames == 0 and stopped.pendingRootRetirements == 0 and stopped.pointerProcessor.active == 0 and stopped.pointerProcessor.pendingCapture == 0 and stopped.pointerProcessor.activeCapture == 0 and stopped.pointerProcessor.hover == 0 and stopped.pointerRouting.contacts == 0 and stopped.pointerRouting.stored == 0 and stopped.errors.size() == 1,
    "stop/Application balances roots SDK query timers queue processor and routes while retaining the real diagnostic")
  for name: String in ["A", "B"]:
    var stopped_root := native(surfaces[name])
    check(stopped_root.nativeTags == 0 and stopped_root.creates == stopped_root.deletes and stopped_root.pointer.activePointers == 0 and stopped_root.pointer.activeTouches == 0,
      "stop/" + name + "/All native Controls and contact ownership are balanced")
    stages["stoppedRoot" + name] = stopped_root
    surfaces[name].queue_free()
  application.queue_free()
  await settle()
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var observed := failures.duplicate()
  var expected := expected_original_failures.duplicate()
  observed.sort()
  expected.sort()
  var original_negative_observed := allow_original_negative and observed == expected and failures.size() == 3
  var report := {"scenario": "native-pointer-public-instance-resolver-fault", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages, "afterStop": stopped,
    "captures": captures, "captureRequested": capture,
    "expectedErrors": expected_errors, "expectedOriginalFailures": expected_original_failures,
    "allowOriginalNegative": allow_original_negative, "originalNegativeObserved": original_negative_observed,
    "allCurrentAssertionsPassed": failures.is_empty(),
    "scope": {"actualNativeInput": true, "experimentalNativeDispatch": true, "originalFlagsEnabled": true,
      "realSDKQueryObserverReused": true, "actualViewSceneAndNativeHelpersReused": true,
      "oneOwnCanonicalPublicInstanceGetterFault": true, "descriptorRestoredBeforeThrow": true,
      "listenerRegistryMirrored": false, "faultingResolverNeverCallsSDK": true,
      "followingHealthyQueriesAreAllowed": true, "heldContactAfterDownIsLegitimate": true,
      "publicAPIAdded": false, "publicDefaultEnabled": false, "hardwareCertified": false}}
  var file := FileAccess.open("res://build/pointer-resolver-fault-report.json", FileAccess.WRITE)
  if file == null:
    push_error("Cannot save resolver-fault report")
    quit(1)
    return
  file.store_string(JSON.stringify(report, "  ") + "\n")
  print("POINTER_RESOLVER_FAULT_ORIGINAL_NEGATIVE: 3" if original_negative_observed else "POINTER_RESOLVER_FAULT_PASSED: " + str(checks.size()) if failures.is_empty() else "POINTER_RESOLVER_FAULT_FAILED: " + str(failures.size()))
  quit(0 if failures.is_empty() or original_negative_observed else 1)
