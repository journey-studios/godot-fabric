extends "res://tests/pointer-document-up-probe.gd"

# Document and documentElement pointermove on the real two-root Document scene.
# Reuses the Up probe's mount, bind, Down and contact helpers; never runs its Up
# lifecycle, refs, mutation, reentry or fault controls.
const OFFSETS := [Vector2(12, 4), Vector2(24, 9)]
const HOVER := Vector2(20, 10)
const LEAF_ORIGIN := Vector2(20, 20)

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(PointerDocumentMoveProbe." + expression + ")"))

func mount(name: String, position: Vector2) -> void:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = name
  surface.position = position
  surface.size = Vector2(360, 220)
  surface.set("application_path", NodePath("../PointerDocumentMoveApplication"))
  surface.set("component_name", "PointerDocumentProbe")
  surface.set("initial_props", {"name": name, "noRef": name == "B", "eventType": "pointermove"})
  surface.set_meta("validation_input_device", DEVICE)
  surfaces[name] = surface
  root.add_child(surface)

func drag(name: String, index: int, offset: Vector2, target: String = "leaf") -> void:
  var event := InputEventScreenDrag.new()
  event.device = DEVICE
  event.index = index
  event.position = surfaces[name].position + (SENTINEL_POINT if target == "sentinel" else LEAF_POINT) + offset
  event.pressure = 1.0
  Input.parse_input_event(event)
  await settle()

# Original touch events observed beside a move are not pointer callbacks.
func pointer_rows(value: Dictionary) -> Array:
  return value.events.filter(func(row: Dictionary) -> bool: return not (row.label in ["TouchMove", "TouchEnd", "TouchCancel"]))

# Moves are unique Continuous events: Default under the pinned mapping.
func move_priority(value: Dictionary) -> Variant:
  return value.continuousPriority if value.priorityMappingFixed else value.defaultPriority

func context_clean(value: Dictionary) -> bool:
  var moves := pointer_rows(value).size()
  var has_touch: bool = value.events.any(func(row: Dictionary) -> bool: return row.label == "TouchMove")
  var identity: Dictionary = value.moveEventIdentity
  return identity.callbackCount == moves and identity.distinctObjects == (1 if moves > 0 else 0) and identity.touchMoveDistinct == (native_dispatch if moves > 0 and has_touch else null) and value.globalEventRestored and value.currentPriority == value.defaultPriority and value.cleanup.size() == value.events.size() and value.cleanup.all(func(row: Dictionary) -> bool:
    return row.currentTargetNull and (not native_dispatch or (row.originalEvent and row.phase == 0 and row.pathEmpty)))

func move_trusted(events: Array, value: Dictionary, name: String) -> bool:
  return not events.is_empty() and events.all(func(row: Dictionary) -> bool:
    return row.name == name and row.trusted and row.originalEvent and row.originalSynthetic and row.targetOriginalElement and row.ownerDocumentMatches and row.currentMatches and row.targetMatches and row.thisMatches and row.globalEventMatches and row.nativeTarget == value.targetTag and row.currentPriority == move_priority(value))

# Same membership rules as the Up probe, for the Down (34/35), Up (36/37) or
# Move (1/25) category. Up and Move read the physical target first.
func inspect_query(value: Dictionary, name: String, offsets: Array, expected: Array, prefix: String) -> void:
  var root_rows: Array = value.query.rows.filter(func(row: Dictionary) -> bool: return row.isRootHandle)
  if not installed():
    check(value.query.rows.is_empty(), prefix + "/Original or D-disabled SDK installs no native query")
    return
  var own: Array = root_rows.filter(func(row: Dictionary) -> bool: return row.name == name)
  check(not own.is_empty() and own.size() == offsets.size() and own.map(func(row: Dictionary) -> int: return int(row.offset)) == offsets and own.map(func(row: Dictionary) -> bool: return row.result) == expected,
    prefix + "/Actual root offsets have exact nonempty membership and results")
  var category := [34, 35] if offsets[0] == 34 else [36, 37] if offsets[0] == 36 else [1, 25]
  var components: Array = value.query.rows.filter(func(row: Dictionary) -> bool: return not row.isRootHandle)
  var owner: Dictionary = native(surfaces[name])
  var owner_tags: Array = owner.nodes.map(func(node: Dictionary) -> int: return int(node.tag))
  var component_pairs := components.size() % 2 == 0 and own.all(func(row: Dictionary) -> bool: return int(row.candidateTag) == int(owner.surfaceId)) and components.all(func(row: Dictionary) -> bool: return int(row.candidateTag) in owner_tags)
  if category[0] != 34:
    component_pairs = component_pairs and components.size() >= 2 and int(components[0].candidateTag) == int(value.targetTag)
  for index in range(0, components.size() - 1, 2):
    var first: Dictionary = components[index]
    var second: Dictionary = components[index + 1]
    component_pairs = component_pairs and first.offset == category[0] and second.offset == category[1] and first.candidateTag == second.candidateTag and int(first.candidateTag) > 0 and first.name == null and second.name == null and first.sequence < second.sequence and (own.is_empty() or second.sequence < own[0].sequence)
  check(own.size() == root_rows.size() and component_pairs and components.all(func(row: Dictionary) -> bool: return row.result == false) and value.query.rows.all(func(row: Dictionary) -> bool:
    return row.action == "delegate" and not row.matched and row.resultKind == "boolean" and row.offset == int(row.offset) and int(row.offset) in category),
    prefix + "/SDK query delegates only the selected native category and owning root")
  check(same_slot(own), prefix + "/Original root-handle queries preserve observed publicInstance and ref slots immediately before and after")
  if own.size() > 1:
    check(own[0].sequence < own[1].sequence, prefix + "/Bubble lookup precedes the actual capture-only lookup")

func manual(name: String, prefix: String, element: bool, expected: Array) -> void:
  js("arm(%s,%s)" % [JSON.stringify(name), JSON.stringify(prefix + "/manual")])
  var result: Dictionary = js(("manualElement" if element else "manualDocument") + "(%s)" % JSON.stringify(name))
  var value := state()
  var supported := native_dispatch and (not element or imperative)
  check(result.available == supported and result.noPrototypeBorrow and labels(value) == expected,
    prefix + "/Original public manual Move proves listener installation or the exact method gate without prototype borrowing")
  if supported:
    check(result.returned and not result.trusted and result.targetMatches and result.cleaned and value.events.all(func(row: Dictionary) -> bool:
      return row.type == "pointermove" and not row.trusted and row.phase == 2 and row.targetMatches and row.currentMatches and row.thisMatches and row.originalEvent and not row.originalSynthetic),
      prefix + "/Manual original Move remains untrusted at target independently of native delivery")
  check(value.raw.is_empty() and value.query.rows.is_empty() and value.panels[name].count == value.baselineCount and context_clean(value),
    prefix + "/Manual Move has no Raw native query React increment or transient context leak")
  stages[prefix + "/manual"] = {"result": result, "react": value}

# One real drag sample while the contact stays held.
func move_sample(name: String, index: int, prefix: String, offset: Vector2, expected: Array, phases: Array, query_offsets: Array, query_results: Array, remaining: int = 0, target: String = "leaf", legacy: bool = false) -> void:
  js("arm(%s,%s,%s)" % [JSON.stringify(name), JSON.stringify(prefix), JSON.stringify(target)])
  var before := native(surfaces[name])
  await drag(name, index, offset, target)
  var value := state()
  var after := native(surfaces[name])
  var events := pointer_rows(value)
  var touch: Array = value.events.filter(func(row: Dictionary) -> bool: return row.label == "TouchMove")
  var expected_labels := expected.duplicate()
  expected_labels.append("TouchMove")
  var expected_phases := phases.map(func(phase: Variant) -> Variant: return float(phase) if phase != null else null)
  check(labels(value) == expected_labels and events.map(func(row: Dictionary) -> Variant: return row.phase) == expected_phases,
    prefix + "/Actual native Move callbacks have exact flag-dependent propagation order and phases")
  check((events.is_empty() and raw_rows(value, "topPointerMove").is_empty()) if expected.is_empty() else (exact_raw(value, "topPointerMove", events) and events.all(func(row: Dictionary) -> bool:
    return (legacy or row.type == "pointermove") and row.pointerId > 0 and row.pointerType == "touch" and row.buttons == 1 and row.currentMatches and row.targetMatches)),
    prefix + "/Move Raw typed and star occur once with the exact callback payload and sample fields")
  if not expected.is_empty():
    check((events.size() == 1 and events[0].compiledLegacySynthetic and not events[0].originalEvent and events[0].currentPriority == move_priority(value)) if legacy else move_trusted(events, value, name),
      prefix + "/Native Move uses original trusted identities and the unique Continuous priority or the explicit legacy JSX control")
  check(touch.size() == 1 and exact_raw(value, "topTouchMove", touch) and touch[0].name == name and touch[0].targetMatches and touch[0].currentMatches and touch[0].currentPriority == move_priority(value) and (move_trusted(touch, value, name) if native_dispatch else (touch[0].compiledLegacySynthetic and not touch[0].originalEvent)) and (events.is_empty() or touch[0].sequence > events[-1].sequence),
    prefix + "/Original TouchMove survives after Move with independent Raw identity and order")
  check(value.raw.size() == (2 if expected.is_empty() else 4) and raw_rows(value, "topPointerDown").is_empty() and raw_rows(value, "topPointerUp").is_empty(),
    prefix + "/Move Raw membership excludes duplicate delivery and any Down or Up event")
  check(value.panels[name].count == value.baselineCount + expected.size() and after.commits == before.commits + (0 if expected.is_empty() else 1),
    prefix + "/Every functional Move update batches into exactly one React commit while TouchMove adds no state update")
  check(context_clean(value), prefix + "/Dispatch restores Default priority global event and all original transient event fields")
  if target != "leaf":
    check(value.query.rows.is_empty(), prefix + "/JSX sentinel qualifies original native props without invoking the interest query")
  else:
    inspect_query(value, name, query_offsets, query_results, prefix + "/move")
  check(after.pointer.pointerMoves == before.pointer.pointerMoves + 1 and after.pointer.moves == before.pointer.moves + 1 and after.pointer.activePointers == 1 and after.pointer.activeTouches == 1,
    prefix + "/Exactly one native pointer and touch move sample keeps the physical contact held")
  stages[prefix] = {"react": value, "before": before, "after": after, "application": native(application), "expected": expected, "phases": phases}

func release(name: String, index: int, prefix: String, remaining: int = 0, target: String = "leaf") -> void:
  js("arm(%s,%s,%s)" % [JSON.stringify(name), JSON.stringify(prefix + "/up"), JSON.stringify(target)])
  var before := native(surfaces[name])
  await inject(name, index, "end", target)
  var value := state()
  var after := native(surfaces[name])
  check(value.events.is_empty() and value.raw.is_empty() and value.panels[name].count == value.baselineCount and after.commits == before.commits and context_clean(value),
    prefix + "/up/Release delivers no pointer callback and never retries a move")
  # Up has no listener here: installed SDKs read only false Up pairs.
  check(value.query.rows.is_empty() != installed() and value.query.rows.all(func(row: Dictionary) -> bool:
    return row.action == "delegate" and not row.matched and row.resultKind == "boolean" and row.result == false and (row.offset == 36 or row.offset == 37)),
    prefix + "/up/Release consults only empty Up Maps when the query is installed")
  check(after.pointer.pointerUps == before.pointer.pointerUps + 1 and after.pointer.ends == before.pointer.ends + 1,
    prefix + "/up/Exactly one native Up and TouchEnd complete the contact")
  clean_contact(name, prefix + "/up", remaining)
  stages[prefix + "/up"] = {"react": value, "before": before, "after": after, "application": native(application)}

func move_case(kind: String) -> void:
  var prefix := "case/" + kind
  stages[prefix + "/configuration"] = js("configure('A',%s)" % JSON.stringify(kind))
  var supported := native_dispatch and (not kind.begins_with("element") or imperative)
  var manual_labels := ["RootC", "RootB"] if kind == "element" else ["RootC"] if kind == "element-capture-only" else ["DocC"] if kind == "doc-capture-only" else ["DocC", "DocB"]
  manual("A", prefix, kind.begins_with("element"), manual_labels if supported else [])
  await physical_down("A", 0, prefix)
  var expected := expectation(kind)
  var phases := [1, 1, 3, 3] if expected.size() == 4 else [1, 3] if expected.size() == 2 else [1] if expected.size() == 1 else []
  var capture_only := kind.ends_with("capture-only")
  var qualifies := installed() and supported
  var offsets := [1, 25] if capture_only or not qualifies else [1]
  var results := [false, qualifies] if offsets.size() == 2 else [true]
  for index in range(OFFSETS.size()):
    await move_sample("A", 0, prefix + "/move-" + str(index + 1), OFFSETS[index], expected, phases, offsets, results)
  await release("A", 0, prefix)

func doc_move(name: String, index: int, prefix: String, offset: Vector2, remaining: int = 0) -> void:
  var expected := expectation("doc")
  await move_sample(name, index, prefix, offset, expected, [1, 3] if not expected.is_empty() else [], [1] if installed() else [1, 25], [true] if installed() else [false, false], remaining)

func isolation() -> void:
  js("configure('A','none')")
  stages["isolation/B-configuration"] = js("configure('B','doc')")
  await physical_down("B", 1, "isolation/B-held")
  await physical_down("A", 0, "isolation/A-negative", 1)
  var before_b := native(surfaces.B)
  var count_b: Variant = state().panels.B.count
  await move_sample("A", 0, "isolation/A-negative/move", OFFSETS[0], [], [], [1, 25], [false, false], 1)
  var after_b := native(surfaces.B)
  check(before_b.pointer == after_b.pointer and before_b.commits == after_b.commits and state().panels.B.count == count_b and after_b.pointer.activePointers == 1 and after_b.pointer.activeTouches == 1,
    "isolation/A-negative/Other original Document listeners cannot qualify A or alter held B metrics state and physical ownership")
  stages["isolation/B-unchanged"] = {"before": before_b, "after": after_b, "beforeCount": count_b, "afterCount": state().panels.B.count}
  await release("A", 0, "isolation/A-negative", 1)
  await doc_move("B", 1, "isolation/B-positive/move", OFFSETS[0])
  await release("B", 1, "isolation/B-positive")

# Removing the final listener between two samples of one held contact stops
# delivery at the next sample: the root query then reads only empty Maps.
func removal() -> void:
  js("configure('A','doc')")
  await physical_down("A", 0, "removal")
  await doc_move("A", 0, "removal/positive/move", OFFSETS[0])
  stages["removal/removed"] = js("removeFinal('A')")
  await move_sample("A", 0, "removal/negative/move", OFFSETS[1], [], [], [1, 25], [false, false])
  await release("A", 0, "removal")

# RN emits every Cancel regardless of listeners: this guards cleanup and the
# registered Document listeners, not Move interest.
func cancel_control() -> void:
  js("configure('A','doc')")
  await physical_down("A", 0, "cancel")
  js("arm('A','cancel/terminal')")
  var before := native(surfaces.A)
  await inject("A", 0, "cancel")
  var value := state()
  var after := native(surfaces.A)
  check(value.events.is_empty() and value.raw.is_empty() and value.query.rows.is_empty() and value.panels.A.count == value.baselineCount and after.commits == before.commits and context_clean(value),
    "cancel/Real Cancel is emitted without interest lookups and never invokes the Document Move listeners")
  check(after.pointer.pointerCancels == before.pointer.pointerCancels + 1 and after.pointer.cancels == before.pointer.cancels + 1,
    "cancel/Exactly one native pointer and touch Cancel is counted")
  clean_contact("A", "cancel")
  stages["cancel/terminal"] = {"react": value, "before": before, "after": after, "application": native(application)}

# Button-less mouse motion with no contact held. It stays hovering until stop.
func mouse_control() -> void:
  js("configure('A','doc')")
  js("arm('A','mouse/hover')")
  var before := native(surfaces.A)
  var event := InputEventMouseMotion.new()
  event.device = DEVICE
  event.position = surfaces.A.position + LEAF_POINT + HOVER
  Input.parse_input_event(event)
  await settle()
  var value := state()
  var after := native(surfaces.A)
  var expected := expectation("doc")
  var events := pointer_rows(value)
  var local := LEAF_POINT + HOVER - LEAF_ORIGIN
  check(labels(value) == expected and events.map(func(row: Dictionary) -> Variant: return row.phase) == ([1.0, 3.0] if not expected.is_empty() else []) and before.pointer.activePointers == 0 and value.defaultPriority != value.discretePriority,
    "mouse/hover/Button-less mouse motion reaches Document listeners only through the installed root query")
  if not expected.is_empty():
    check(exact_raw(value, "topPointerMove", events) and move_trusted(events, value, "A") and events.all(func(row: Dictionary) -> bool: return row.pointerType == "mouse" and row.buttons == 0 and row.offsetX == local.x and row.offsetY == local.y),
      "mouse/hover/Mouse Move keeps its exact sample fields Raw identity and the unique Continuous priority")
  check(raw_rows(value, "topTouchMove").is_empty() and value.panels.A.count == value.baselineCount + expected.size() and after.commits == before.commits + (0 if expected.is_empty() else 1) and context_clean(value),
    "mouse/hover/Mouse hover adds no touch event and one batched commit")
  inspect_query(value, "A", [1] if installed() else [1, 25], [true] if installed() else [false, false], "mouse/hover/move")
  check(after.pointer.pointerMoves == before.pointer.pointerMoves + 1 and after.pointer.activePointers == 0 and after.pointer.activeTouches == 0,
    "mouse/hover/One native hover sample holds no contact")
  stages["mouse/hover"] = {"react": value, "before": before, "after": after, "application": native(application), "point": [local.x, local.y]}

# The yellow counter spans x20..39+4*count; its last pixel and the background
# pixel after it pin the exact count for each root.
func capture_frame(filename: String, expected_a: int, expected_b: int, _lifecycle: bool = false) -> void:
  if not capture or DisplayServer.get_name() == "headless":
    return
  await RenderingServer.frame_post_draw
  var image := root.get_texture().get_image()
  var saved := image.save_png("res://build/" + filename)
  var pixels: Array = []
  for origin: Vector2i in [Vector2i.ZERO, Vector2i(400, 0)]:
    var count := expected_a if origin == Vector2i.ZERO else expected_b
    var points := [Vector2i(5, 5), Vector2i(75, 55), Vector2i(260, 55), Vector2i(25, 175), Vector2i(39 + 4 * count, 175), Vector2i(40 + 4 * count, 175)]
    var colors := ["0f172aff", "2563ebff", "0f766eff", "fde047ff", "fde047ff", "0f172aff"]
    for index in range(points.size()):
      var point: Vector2i = origin + points[index]
      var actual := image.get_pixelv(point).to_html()
      check(actual == colors[index], "capture/" + filename + "/Actual native pixel " + str(point) + " matches the committed Move counter")
      pixels.append({"point": [point.x, point.y], "color": actual, "expected": colors[index]})
  check(state().panels.A.count == expected_a and state().panels.B.count == expected_b and saved == OK and image.get_width() == 760 and image.get_height() == 220,
    "capture/" + filename + "/Saved native viewport and actual React counters describe the same Move stage")
  captures.append({"file": "build/" + filename, "width": image.get_width(), "height": image.get_height(), "pixels": pixels, "reactCounters": state().panels})

func run_probe() -> void:
  root.size = Vector2i(760, 220)
  application = ClassDB.instantiate("FabricApplication")
  application.name = "PointerDocumentMoveApplication"
  application.set("bundle_path", "res://build/pointer-document-move-" + flag_mode + ".js")
  root.add_child(application)
  mount("A", Vector2.ZERO)
  mount("B", Vector2(400, 0))
  await settle()
  bind("A")
  bind("B")
  var initial_app := native(application)
  check(initial_app.rootCount == 2 and native(surfaces.A).runtimeId == native(surfaces.B).runtimeId and native(surfaces.A).surfaceId != native(surfaces.B).surfaceId,
    "mount/Two distinct real roots share one Hermes application without sharing Documents")
  check(initial_app.pointerListenerQueryInstalled == installed(), "mount/Original SDK or D-disabled mode installs no query while current D-enabled installs exactly one")
  var available := ["function", "function", "function"]
  var absent := ["undefined", "undefined", "undefined"]
  for name: String in ["A", "B"]:
    var capability: Dictionary = stages["capability" + name]
    check(capability.flags.imperative == imperative and capability.flags.nativeDispatch == native_dispatch and capability.mode == flag_mode and capability.interestMode == interest_mode,
      "capability/" + name + "/Immutable original flags match the independent lane")
    check(capability.originalDoc and capability.originalElement and capability.docOwnsElement and capability.docConnected and capability.elementConnected and capability.originalRootGetterIdentity and capability.distinctOtherRoot and capability.docEventTarget == native_dispatch and capability.rootEventTarget == native_dispatch,
      "capability/" + name + "/Original connected Document root identities ownership and inheritance are real")
    check(capability.methods.doc == (available if native_dispatch else absent) and capability.methods.element == (available if native_dispatch and imperative else absent) and capability.query.installations == (1 if installed() else 0) and (not installed() or capability.query.restoredInstaller),
      "capability/" + name + "/Document D-only and element I-and-D APIs preserve the original method matrix and sole SDK query")
  await capture_frame("pointer-document-move-initial.png", 0, 0)
  await move_case("doc")
  await capture_frame("pointer-document-move-updated.png", 4, 0)
  for kind: String in ["all", "element", "doc-capture-only", "element-capture-only"]:
    await move_case(kind)
  await isolation()
  await removal()
  await cancel_control()
  # An independent JSX sentinel proves native Move transport in every flag lane
  # through its own props, without the interest query.
  js("resetAll()")
  await physical_down("A", 0, "sentinel", 0, "sentinel")
  await move_sample("A", 0, "sentinel/move", OFFSETS[0], ["JSX"], [2] if native_dispatch else [null], [], [], 0, "sentinel", not native_dispatch)
  await release("A", 0, "sentinel", 0, "sentinel")
  await mouse_control()
  stages.lateOverride = js("rejectLateOverride()")
  check(stages.lateOverride is String and not stages.lateOverride.is_empty() and state().flags.imperative == imperative and state().flags.nativeDispatch == native_dispatch,
    "flags/Late override is rejected and cannot toggle the native responder or public method contract")
  stages.beforeStop = {"application": native(application), "react": state()}
  check(stages.beforeStop.application.errors.is_empty(), "errors/Healthy Move matrix has no hidden query dispatch or responder diagnostics")
  application.call("stop")
  await settle()
  var stopped := native(application)
  check(stopped.stopped and not stopped.pointerListenerQueryInstalled and stopped.rootCount == 0 and stopped.pendingWork == 0 and stopped.pendingTimers == 0 and stopped.pendingAnimationFrames == 0 and stopped.pendingRootRetirements == 0 and stopped.pointerProcessor.active == 0 and stopped.pointerProcessor.pendingCapture == 0 and stopped.pointerProcessor.activeCapture == 0 and stopped.pointerProcessor.hover == 0 and stopped.pointerRouting.contacts == 0 and stopped.pointerRouting.active == 0 and stopped.pointerRouting.stored == 0 and stopped.errors.is_empty(),
    "stop/Application clears every actual root query work timer processor capture hover and route")
  for name: String in ["A", "B"]:
    var final_root := native(surfaces[name])
    check(final_root.nativeTags == 0 and final_root.creates == final_root.deletes and final_root.pointer.activePointers == 0 and final_root.pointer.activeTouches == 0,
      "stop/" + name + "/All actual native Controls and contacts balance")
    stages["stoppedRoot" + name] = final_root
    surfaces[name].queue_free()
  application.queue_free()
  await settle()
  check_hover_lookups()
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var report := {"scenario": "native-pointer-document-move-four-flags", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "flagMode": flag_mode, "interestMode": interest_mode, "captureRequested": capture,
    "checks": checks, "failures": failures, "stages": stages, "captures": captures, "afterStop": stopped, "allAssertionsPassed": failures.is_empty(),
    "scope": {"actualNativeInput": true, "realOriginalDocuments": true, "experimentalNativeDispatch": true,
      "listenerRegistryMirrored": false, "manualDispatchIsOnlyInstallationControl": true, "mouseHoverMoveCertified": true,
      "publicDefaultEnabled": false, "hardwareCertified": false, "moveQueryFaultsCertified": false, "explicitCaptureCertified": false}}
  var output := FileAccess.open("res://build/pointer-document-move-report.json", FileAccess.WRITE)
  if output == null:
    push_error("Cannot save Document Move probe report")
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  print("POINTER_DOCUMENT_MOVE_PASSED: " + str(checks.size()) if failures.is_empty() else "POINTER_DOCUMENT_MOVE_FAILED: " + str(failures.size()))
  quit(0 if failures.is_empty() else 1)
