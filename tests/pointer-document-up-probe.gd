extends SceneTree

const DEVICE := 1001
const LEAF_POINT := Vector2(75, 55)
const SENTINEL_POINT := Vector2(260, 55)
var application: Node
var surfaces: Dictionary = {}
var checks: Array = []
var stages: Dictionary = {}
var captures: Array = []
var flag_mode := "enabled"
var interest_mode := "current"
var capture := false
var imperative := true
var native_dispatch := true

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
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(PointerDocumentUpProbe." + expression + ")"))

func state() -> Dictionary:
  var value: Variant = js("snapshot()")
  return value if value is Dictionary else {}

func mount(name: String, position: Vector2) -> void:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = name
  surface.position = position
  surface.size = Vector2(360, 220)
  surface.set("application_path", NodePath("../PointerDocumentUpApplication"))
  surface.set("component_name", "PointerDocumentProbe")
  surface.set("initial_props", {"name": name, "noRef": name == "B", "eventType": "pointerup"})
  surface.set_meta("validation_input_device", DEVICE)
  surfaces[name] = surface
  root.add_child(surface)

func tag_for(value: Dictionary, test_id: String) -> int:
  for node: Dictionary in value.nodes:
    if node.get("testID") == test_id:
      return int(node.tag)
  return 0

func bind(name: String) -> void:
  var value := native(surfaces[name])
  var leaf_tag := tag_for(value, name + "-leaf")
  var sentinel_tag := tag_for(value, name + "-sentinel")
  check(leaf_tag > 0 and sentinel_tag > 0 and leaf_tag != sentinel_tag, "bind/" + name + "/surface-" + str(value.surfaceId) + "/Two actual materialized Controls have distinct native tags")
  stages["capability" + name] = js("bindRoot(%s,%d,%d,%d)" % [JSON.stringify(name), int(value.surfaceId), leaf_tag, sentinel_tag])

func inject(name: String, index: int, phase: String = "start", target: String = "leaf") -> void:
  var event := InputEventScreenTouch.new()
  event.device = DEVICE
  event.index = index
  event.position = surfaces[name].position + (SENTINEL_POINT if target == "sentinel" else LEAF_POINT)
  event.pressed = phase == "start"
  event.canceled = phase == "cancel"
  Input.parse_input_event(event)
  await settle()

func labels(value: Dictionary) -> Array:
  return value.events.map(func(row: Dictionary) -> String: return row.label)

func pointer_rows(value: Dictionary) -> Array:
  return value.events.filter(func(row: Dictionary) -> bool: return row.label != "TouchEnd" and row.label != "TouchCancel")

func raw_rows(value: Dictionary, type: String) -> Array:
  return value.raw.filter(func(row: Dictionary) -> bool: return row.type == type)

func installed() -> bool:
  return interest_mode == "current" and native_dispatch

func context_clean(value: Dictionary) -> bool:
  var up_count := pointer_rows(value).size()
  var has_touch_end: bool = value.events.any(func(row: Dictionary) -> bool: return row.label == "TouchEnd")
  var identity: Dictionary = value.upEventIdentity
  return identity.callbackCount == up_count and identity.sameObject == (true if up_count > 0 else null) and identity.touchEndDistinct == (native_dispatch if up_count > 0 and has_touch_end else null) and value.globalEventRestored and value.currentPriority == value.defaultPriority and value.cleanup.size() == value.events.size() and value.cleanup.all(func(row: Dictionary) -> bool:
    return row.currentTargetNull and (not native_dispatch or (row.originalEvent and row.phase == 0 and row.pathEmpty)))

func exact_raw(value: Dictionary, type: String, events: Array) -> bool:
  var raw := raw_rows(value, type)
  if raw.size() != 2 or events.is_empty() or raw[0].channel != "typed" or raw[1].channel != "star" or raw[0].payloadId != raw[1].payloadId:
    return false
  return events.all(func(row: Dictionary) -> bool:
    return row.payloadId == raw[0].payloadId and row.nativeTarget == raw[0].target and row.nativeTimeStamp == raw[0].timeStamp and row.timeStamp == raw[0].timeStamp and row.sequence > raw[1].sequence)

func trusted_rows(events: Array, value: Dictionary, name: String) -> bool:
  return not events.is_empty() and events.all(func(row: Dictionary) -> bool:
    return row.name == name and row.trusted and row.originalEvent and row.originalSynthetic and row.targetOriginalElement and row.ownerDocumentMatches and row.currentMatches and row.targetMatches and row.thisMatches and row.globalEventMatches and row.nativeTarget == value.targetTag and row.currentPriority == value.discretePriority)

func same_slot(rows: Array) -> bool:
  return rows.all(func(row: Dictionary) -> bool:
    return row.expectedHandle and row.before.handleExists and row.after.handleExists and row.before.canonicalPresent and row.after.canonicalPresent and row.before.publicInstanceNull == row.after.publicInstanceNull and row.before.refAssigned == row.after.refAssigned)

func inspect_query(value: Dictionary, name: String, offsets: Array, expected: Array, prefix: String) -> void:
  var root_rows: Array = value.query.rows.filter(func(row: Dictionary) -> bool: return row.isRootHandle)
  if not installed():
    check(value.query.rows.is_empty(), prefix + "/Original or D-disabled SDK installs no native query")
    return
  var own: Array = root_rows.filter(func(row: Dictionary) -> bool: return row.name == name)
  check(not own.is_empty() and own.size() == offsets.size() and own.map(func(row: Dictionary) -> int: return int(row.offset)) == offsets and own.map(func(row: Dictionary) -> bool: return row.result) == expected,
    prefix + "/Actual root offsets have exact nonempty membership and results")
  # View ancestors may read both phase Maps before the root's bubble Map
  # returns true. Root short-circuiting does not suppress those earlier reads.
  var category := [34, 35] if offsets[0] == 34 else [36, 37]
  var components: Array = value.query.rows.filter(func(row: Dictionary) -> bool: return not row.isRootHandle)
  var owner: Dictionary = native(surfaces[name])
  var owner_tags: Array = owner.nodes.map(func(node: Dictionary) -> int: return int(node.tag))
  var component_pairs := components.size() % 2 == 0 and own.all(func(row: Dictionary) -> bool: return int(row.candidateTag) == int(owner.surfaceId)) and components.all(func(row: Dictionary) -> bool: return int(row.candidateTag) in owner_tags)
  if category[0] == 36:
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

func clean_contact(name: String, prefix: String, remaining: int = 0) -> void:
  var owner := native(surfaces[name])
  var app := native(application)
  check(owner.pointer.activePointers == 0 and owner.pointer.activeTouches == 0 and app.pointerProcessor.active == remaining and app.pointerProcessor.pendingCapture == 0 and app.pointerProcessor.activeCapture == 0 and app.pointerProcessor.hover == remaining and app.pointerRouting.active == remaining and app.pointerRouting.contacts == remaining and app.pointerRouting.stored == remaining,
    prefix + "/Terminal clears physical adapter processor capture hover and route ownership independently of Up delivery")

func physical_down(name: String, index: int, prefix: String, remaining: int = 0, target: String = "leaf") -> void:
  js("arm(%s,%s,%s)" % [JSON.stringify(name), JSON.stringify(prefix + "/down"), JSON.stringify(target)])
  var before := native(surfaces[name])
  await inject(name, index, "start", target)
  var value := state()
  var after := native(surfaces[name])
  var app := native(application)
  check(value.events.is_empty() and value.raw.is_empty() and value.panels[name].count == value.baselineCount and after.commits == before.commits and context_clean(value),
    prefix + "/Real Down has no pointerdown helper Raw pointer delivery or Up React update")
  # A JSX Up sentinel has no Down prop; all selected Down Maps are empty.
  inspect_query(value, name, [34, 35], [false, false], prefix + "/down")
  check(after.pointer.pointerDowns == before.pointer.pointerDowns + 1 and after.pointer.starts == before.pointer.starts + 1 and after.pointer.activePointers == 1 and after.pointer.activeTouches == 1 and app.pointerProcessor.active == remaining + 1 and app.pointerRouting.contacts == remaining + 1,
    prefix + "/Exactly one physical Down remains legitimately held until a real terminal")
  stages[prefix + "/down"] = {"react": value, "before": before, "after": after, "application": app}

func manual(name: String, prefix: String, element: bool, expected: Array) -> void:
  js("arm(%s,%s)" % [JSON.stringify(name), JSON.stringify(prefix + "/manual")])
  var result: Dictionary = js(("manualElement" if element else "manualDocument") + "(%s)" % JSON.stringify(name))
  var value := state()
  var supported := native_dispatch and (not element or imperative)
  check(result.available == supported and result.noPrototypeBorrow and labels(value) == expected,
    prefix + "/Original public manual Up proves listener installation or the exact method gate without prototype borrowing")
  if supported:
    check(result.returned and not result.trusted and result.targetMatches and result.cleaned and value.events.all(func(row: Dictionary) -> bool:
      return row.type == "pointerup" and not row.trusted and row.phase == 2 and row.targetMatches and row.currentMatches and row.thisMatches and row.originalEvent and not row.originalSynthetic),
      prefix + "/Manual original Up remains untrusted at target independently of native delivery")
  check(value.raw.is_empty() and value.query.rows.is_empty() and value.panels[name].count == value.baselineCount and context_clean(value),
    prefix + "/Manual Up has no Raw native query React increment or transient context leak")
  stages[prefix + "/manual"] = {"result": result, "react": value}

func finish_up(name: String, index: int, prefix: String, expected: Array, phases: Array, query_offsets: Array, query_results: Array, remaining: int = 0, target: String = "leaf", legacy: bool = false) -> void:
  js("arm(%s,%s,%s)" % [JSON.stringify(name), JSON.stringify(prefix + "/up"), JSON.stringify(target)])
  var before := native(surfaces[name])
  await inject(name, index, "end", target)
  var value := state()
  var after := native(surfaces[name])
  var events := pointer_rows(value)
  var raw := raw_rows(value, "topPointerUp")
  var touch: Array = value.events.filter(func(row: Dictionary) -> bool: return row.label == "TouchEnd")
  var expected_labels := expected.duplicate()
  expected_labels.append("TouchEnd")
  var expected_phases := phases.map(func(phase: Variant) -> Variant: return float(phase) if phase != null else null)
  check(labels(value) == expected_labels and events.map(func(row: Dictionary) -> Variant: return row.phase) == expected_phases,
    prefix + "/Actual native Up callbacks have exact flag-dependent propagation order and phases")
  check((events.is_empty() and raw.is_empty()) if expected.is_empty() else (exact_raw(value, "topPointerUp", events) and raw.size() == 2 and events.all(func(row: Dictionary) -> bool:
    return (legacy or row.type == "pointerup") and row.pointerId > 0 and row.pointerType == "touch" and row.buttons == 0 and row.pressure == 0 and row.currentMatches and row.targetMatches)),
    prefix + "/Up Raw typed and star occur once with the exact callback payload terminal fields and timestamps")
  if not expected.is_empty():
    check((events.size() == 1 and events[0].compiledLegacySynthetic and not events[0].originalEvent) if legacy else trusted_rows(events, value, name),
      prefix + "/Native Up uses original trusted identities and Discrete priority or the explicit legacy JSX control")
  check(touch.size() == 1 and exact_raw(value, "topTouchEnd", touch) and touch[0].name == name and touch[0].targetMatches and touch[0].currentMatches and touch[0].currentPriority == value.discretePriority and (trusted_rows(touch, value, name) if native_dispatch else (touch[0].compiledLegacySynthetic and not touch[0].originalEvent)) and (events.is_empty() or touch[0].sequence > events[-1].sequence),
    prefix + "/Original TouchEnd survives after Up with independent Raw identity and actual terminal ordering")
  check(value.raw.size() == (2 if expected.is_empty() else 4) and raw_rows(value, "topPointerDown").is_empty(),
    prefix + "/Terminal Raw membership excludes duplicate Up delivery and any Down event")
  check(value.panels[name].count == value.baselineCount + expected.size() and after.commits == before.commits + (0 if expected.is_empty() else 1),
    prefix + "/Every functional Up update batches into exactly one React commit while TouchEnd adds no state update")
  check(context_clean(value), prefix + "/Dispatch restores Default priority global event and all original transient event fields")
  if target == "leaf":
    inspect_query(value, name, query_offsets, query_results, prefix + "/up")
  else:
    check(value.query.rows.is_empty(), prefix + "/JSX sentinel qualifies original native props without invoking the interest query")
  check(after.pointer.pointerUps == before.pointer.pointerUps + 1 and after.pointer.ends == before.pointer.ends + 1,
    prefix + "/Exactly one native Up and TouchEnd sample completes the physical contact")
  clean_contact(name, prefix, remaining)
  stages[prefix + "/up"] = {"react": value, "before": before, "after": after, "application": native(application), "expected": expected, "phases": phases}

func expectation(kind: String) -> Array:
  if not installed():
    return []
  if kind == "all":
    return ["DocC", "RootC", "RootB", "DocB"] if imperative else ["DocC", "DocB"]
  if kind == "element":
    return ["RootC", "RootB"] if imperative else []
  if kind == "doc-capture-only":
    return ["DocC"]
  if kind == "element-capture-only":
    return ["RootC"] if imperative else []
  return ["DocC", "DocB"]

func case_for(kind: String) -> void:
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
  var offsets := [36, 37] if capture_only or not qualifies else [36]
  var results := [false, qualifies] if offsets.size() == 2 else [true]
  await finish_up("A", 0, prefix, expected, phases, offsets, results)

func isolation() -> void:
  js("configure('A','none')")
  stages["isolation/B-configuration"] = js("configure('B','doc')")
  await physical_down("B", 1, "isolation/B-held")
  await physical_down("A", 0, "isolation/A-negative", 1)
  var before_b := native(surfaces.B)
  var count_b: Variant = state().panels.B.count
  await finish_up("A", 0, "isolation/A-negative", [], [], [36, 37], [false, false], 1)
  var after_b := native(surfaces.B)
  check(before_b.pointer == after_b.pointer and before_b.commits == after_b.commits and state().panels.B.count == count_b and after_b.pointer.activePointers == 1 and after_b.pointer.activeTouches == 1,
    "isolation/A-negative/Other original Document listeners cannot qualify A or alter held B metrics state and physical ownership")
  stages["isolation/B-unchanged"] = {"before": before_b, "after": after_b, "beforeCount": count_b, "afterCount": state().panels.B.count}
  var expected := expectation("doc")
  await finish_up("B", 1, "isolation/B-positive", expected, [1, 3] if not expected.is_empty() else [], [36] if installed() else [36, 37], [true] if installed() else [false, false])

func removal() -> void:
  js("configure('A','doc')")
  await physical_down("A", 0, "removal/positive")
  var expected := expectation("doc")
  await finish_up("A", 0, "removal/positive", expected, [1, 3] if not expected.is_empty() else [], [36] if installed() else [36, 37], [true] if installed() else [false, false])
  stages["removal/removed"] = js("removeFinal('A')")
  await physical_down("A", 0, "removal/negative")
  await finish_up("A", 0, "removal/negative", [], [], [36, 37], [false, false])

# Native input precedes every manual check in these lifecycle controls. A
# manual once event would otherwise remove the listener before the first Up.
func once_control() -> void:
  var prefix := "lifecycle/once"
  stages[prefix + "/configuration"] = js("configure('A','doc-once')")
  var expected := ["DocB"] if installed() else []
  await capture_frame("pointer-document-up-once-before.png", 12, 2, true)
  await physical_down("A", 0, prefix + "/first")
  await finish_up("A", 0, prefix + "/first", expected, [3] if installed() else [], [36] if installed() else [36, 37], [true] if installed() else [false, false])
  await capture_frame("pointer-document-up-once-first.png", 13, 2, true)
  await physical_down("A", 0, prefix + "/second")
  await finish_up("A", 0, prefix + "/second", [], [], [36, 37], [false, false])
  await capture_frame("pointer-document-up-once-second.png", 13, 2, true)
  # Original SDK filtering never invoked once, so its real public listener is
  # still present. Current SDK native dispatch already consumed it exactly once.
  var manual_expected := ["DocB"] if native_dispatch and not installed() else []
  manual("A", prefix + "/after-native", false, manual_expected)
  manual("A", prefix + "/after-manual", false, [])

func pre_aborted_control() -> void:
  var prefix := "lifecycle/abort-pre"
  # The shared helper aborts the original controller before addEventListener;
  # its requested binding trace is not evidence of membership in the RN Map.
  stages[prefix + "/configuration"] = js("configure('A','doc-abort-pre')")
  stages[prefix + "/signal"] = js("signal('A')")
  check(stages[prefix + "/signal"] == {"available": native_dispatch, "originalSignal": true if native_dispatch else null, "aborted": true if native_dispatch else null},
    prefix + "/Actual original signal is already aborted before listener registration or absent under the original method gate")
  for pass_name: String in ["first", "second"]:
    await physical_down("A", 0, prefix + "/" + pass_name)
    await finish_up("A", 0, prefix + "/" + pass_name, [], [], [36, 37], [false, false])
  manual("A", prefix + "/after-native", false, [])

func post_up_abort_control() -> void:
  var prefix := "lifecycle/abort-after"
  stages[prefix + "/configuration"] = js("configure('A','doc-abort-after')")
  stages[prefix + "/signal-before"] = js("signal('A')")
  check(stages[prefix + "/signal-before"] == {"available": native_dispatch, "originalSignal": true if native_dispatch else null, "aborted": false if native_dispatch else null},
    prefix + "/Actual original signal starts un-aborted or is absent under the original method gate")
  var expected := ["DocB"] if installed() else []
  await physical_down("A", 0, prefix + "/first")
  await finish_up("A", 0, prefix + "/first", expected, [3] if installed() else [], [36] if installed() else [36, 37], [true] if installed() else [false, false])
  # This listener is not once. The independent manual positive also proves
  # original SDK installation after a filtered native first Up, without state.
  manual("A", prefix + "/before-abort", false, ["DocB"] if native_dispatch else [])
  var before := native(surfaces.A)
  var count_before: Variant = state().panels.A.count
  var result: Variant = js("abort('A')")
  var after := native(surfaces.A)
  check(result == {"available": native_dispatch, "originalSignal": true if native_dispatch else null, "aborted": true if native_dispatch else null} and before.commits == after.commits and before.pointer == after.pointer and state().panels.A.count == count_before and state().query.rows.is_empty() and context_clean(state()),
    prefix + "/Abort call changes no React state native ownership or interest query while original cleanup is checked by the next Up")
  stages[prefix + "/abort"] = {"result": result, "before": before, "after": after, "beforeCount": count_before, "afterCount": state().panels.A.count, "react": state()}
  await physical_down("A", 0, prefix + "/second")
  await finish_up("A", 0, prefix + "/second", [], [], [36, 37], [false, false])
  manual("A", prefix + "/after-abort", false, [])

func cancel_control() -> void:
  js("configure('A','doc-capture-only')")
  await physical_down("A", 0, "cancel")
  js("arm('A','cancel/terminal')")
  var before := native(surfaces.A)
  await inject("A", 0, "cancel")
  var value := state()
  var after := native(surfaces.A)
  var touch: Array = value.events.filter(func(row: Dictionary) -> bool: return row.label == "TouchCancel")
  check(labels(value) == ["TouchCancel"] and raw_rows(value, "topPointerUp").is_empty() and exact_raw(value, "topTouchCancel", touch) and value.query.rows.is_empty() and value.panels.A.count == value.baselineCount and after.commits == before.commits and context_clean(value),
    "cancel/Real Cancel invokes only its original touch terminal and never borrows Up offsets callbacks or state updates")
  check(after.pointer.pointerCancels == before.pointer.pointerCancels + 1 and after.pointer.cancels == before.pointer.cancels + 1,
    "cancel/Exactly one native pointer and touch Cancel is counted")
  clean_contact("A", "cancel")
  stages["cancel/terminal"] = {"react": value, "before": before, "after": after, "application": native(application)}

func capture_frame(filename: String, expected_a: int, expected_b: int, lifecycle: bool = false) -> void:
  if not capture or DisplayServer.get_name() == "headless":
    return
  await RenderingServer.frame_post_draw
  var image := root.get_texture().get_image()
  var saved := image.save_png("res://build/" + filename)
  var pixels: Array = []
  for origin: Vector2i in [Vector2i.ZERO, Vector2i(400, 0)]:
    var expected_count := expected_a if origin == Vector2i.ZERO else expected_b
    var points := [Vector2i(5, 5), Vector2i(75, 55), Vector2i(260, 55), Vector2i(25, 175), Vector2i(45, 175)]
    var colors := ["0f172aff", "2563ebff", "0f766eff", "fde047ff", "fde047ff" if expected_count >= 2 else "0f172aff"]
    for index in range(points.size()):
      var point: Vector2i = origin + points[index]
      var actual := image.get_pixelv(point).to_html()
      check(actual == colors[index], "capture/" + filename + "/Actual native pixel " + str(point) + " matches the committed Up counter")
      pixels.append({"point": [point.x, point.y], "color": actual, "expected": colors[index]})
  if lifecycle:
    # The first once Up extends A from x88 to x92. The second Up preserves
    # that edge; B's independent two-update edge stays at x448 throughout.
    var points := [Vector2i(90, 175), Vector2i(94, 175), Vector2i(447, 175), Vector2i(449, 175)]
    var colors := ["fde047ff" if expected_a == 13 else "0f172aff", "0f172aff", "fde047ff", "0f172aff"]
    for index in range(points.size()):
      var actual := image.get_pixelv(points[index]).to_html()
      check(actual == colors[index], "capture/" + filename + "/Actual once edge pixel " + str(points[index]) + " matches native listener consumption")
      pixels.append({"point": [points[index].x, points[index].y], "color": actual, "expected": colors[index]})
  check(state().panels.A.count == expected_a and state().panels.B.count == expected_b and saved == OK and image.get_width() == 760 and image.get_height() == 220,
    "capture/" + filename + "/Saved native viewport and actual React counters describe the same Up stage")
  captures.append({"file": "build/" + filename, "width": image.get_width(), "height": image.get_height(), "pixels": pixels, "reactCounters": state().panels})

func _initialize() -> void:
  for argument: String in OS.get_cmdline_user_args():
    if argument.begins_with("--flag="):
      flag_mode = argument.trim_prefix("--flag=")
    elif argument.begins_with("--interest="):
      interest_mode = argument.trim_prefix("--interest=")
  capture = OS.get_cmdline_user_args().has("--capture")
  imperative = flag_mode == "enabled" or flag_mode == "imperative-only"
  native_dispatch = flag_mode == "enabled" or flag_mode == "internal-only"
  call_deferred("run_probe")

func run_probe() -> void:
  root.size = Vector2i(760, 220)
  application = ClassDB.instantiate("FabricApplication")
  application.name = "PointerDocumentUpApplication"
  application.set("bundle_path", "res://build/pointer-document-up-" + flag_mode + ".js")
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
  check(stages.capabilityA.methods.view == (available if native_dispatch and imperative else absent) and stages.capabilityA.docOwnsRef and stages.capabilityB.methods.view == null and stages.capabilityB.noRef.publicInstanceNull and not stages.capabilityB.noRef.refAssigned,
    "capability/Real ref and initially cold no-ref leaves preserve ownership and original method availability")
  await capture_frame("pointer-document-up-initial.png", 0, 0)
  await case_for("doc")
  await capture_frame("pointer-document-up-updated.png", 2, 0)
  for kind: String in ["all", "element", "doc-capture-only", "element-capture-only"]:
    await case_for(kind)
  await isolation()
  await removal()
  await once_control()
  await pre_aborted_control()
  await post_up_abort_control()
  await cancel_control()
  # Independent JSX sentinel proves native Up transport in every flag lane. Its
  # sibling prop cannot qualify any preceding blue-leaf Up.
  js("resetAll()")
  await physical_down("A", 0, "sentinel", 0, "sentinel")
  await finish_up("A", 0, "sentinel", ["JSX"], [2] if native_dispatch else [null], [], [], 0, "sentinel", not native_dispatch)
  stages.lateOverride = js("rejectLateOverride()")
  check(stages.lateOverride is String and not stages.lateOverride.is_empty() and state().flags.imperative == imperative and state().flags.nativeDispatch == native_dispatch,
    "flags/Late override is rejected and cannot toggle the native responder or public method contract mid-gesture")
  stages.beforeStop = {"application": native(application), "react": state()}
  check(stages.beforeStop.application.errors.is_empty(), "errors/Healthy Up matrix has no hidden query dispatch or responder diagnostics")
  application.call("stop")
  await settle()
  var stopped := native(application)
  check(stopped.stopped and not stopped.pointerListenerQueryInstalled and stopped.rootCount == 0 and stopped.pendingWork == 0 and stopped.pendingTimers == 0 and stopped.pendingAnimationFrames == 0 and stopped.pendingRootRetirements == 0 and stopped.pointerProcessor.active == 0 and stopped.pointerProcessor.pendingCapture == 0 and stopped.pointerProcessor.activeCapture == 0 and stopped.pointerProcessor.hover == 0 and stopped.pointerRouting.contacts == 0 and stopped.pointerRouting.active == 0 and stopped.pointerRouting.stored == 0 and stopped.errors.is_empty(),
    "stop/Application clears every actual root query work timer processor capture hover and route without erasing diagnostics")
  for name: String in ["A", "B"]:
    var final_root := native(surfaces[name])
    check(final_root.nativeTags == 0 and final_root.creates == final_root.deletes and final_root.pointer.activePointers == 0 and final_root.pointer.activeTouches == 0,
      "stop/" + name + "/All actual native Controls and contacts balance")
    stages["stoppedRoot" + name] = final_root
    surfaces[name].queue_free()
  application.queue_free()
  await settle()
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var report := {"scenario": "native-pointer-document-up-four-flags", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "flagMode": flag_mode, "interestMode": interest_mode, "captureRequested": capture,
    "checks": checks, "failures": failures, "stages": stages, "captures": captures, "afterStop": stopped, "allAssertionsPassed": failures.is_empty(),
    "scope": {"actualNativeInput": true, "realOriginalDocuments": true, "experimentalNativeDispatch": true,
      "listenerRegistryMirrored": false, "manualDispatchIsOnlyInstallationControl": true,
      "publicDefaultEnabled": false, "hardwareCertified": false, "upQueryFaultsCertified": false, "explicitCaptureCertified": false}}
  var output := FileAccess.open("res://build/pointer-document-up-report.json", FileAccess.WRITE)
  if output == null:
    push_error("Cannot save Document Up probe report")
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  print("POINTER_DOCUMENT_UP_PASSED: " + str(checks.size()) if failures.is_empty() else "POINTER_DOCUMENT_UP_FAILED: " + str(failures.size()))
  quit(0 if failures.is_empty() else 1)
