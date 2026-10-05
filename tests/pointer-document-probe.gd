extends SceneTree

const DEVICE := 1001
const LEAF_POINT := Vector2(75, 55)
const SENTINEL_POINT := Vector2(260, 55)
var application: Node
var surfaces: Dictionary = {}
var checks: Array = []
var stages: Dictionary = {}
var captures: Array = []
var expected_errors: Array = []
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
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(PointerDocumentProbe." + expression + ")"))

func state() -> Dictionary:
  var value: Variant = js("snapshot()")
  return split_hover_rows(value) if value is Dictionary else {}

# RN's hover tracker runs before each Down/Move emission and after a touch's Up
# or Cancel, so hover lookups (enter 0/23, leave 2/24, over 26/28, out 27/29)
# interleave with the category each check certifies. state() keeps that
# category in query.rows and moves hover lookups to query.hoverRows.
const HOVER_OFFSETS := [0, 2, 23, 24, 26, 27, 28, 29]
var unhealthy_hover_lookups: Dictionary = {}

func split_hover_rows(value: Dictionary) -> Dictionary:
  var query: Variant = value.get("query")
  if not query is Dictionary or not query.has("rows"):
    return value
  var rows: Array = query.rows
  query.rows = rows.filter(func(row: Dictionary) -> bool: return not int(row.offset) in HOVER_OFFSETS)
  query.hoverRows = rows.filter(func(row: Dictionary) -> bool: return int(row.offset) in HOVER_OFFSETS)
  for row: Dictionary in query.hoverRows:
    if row.action != "delegate" or row.resultKind != "boolean" or row.result:
      unhealthy_hover_lookups[int(row.sequence)] = row
  return value

# No Document fixture registers a hover listener, so every hover lookup a lane
# observed must be a healthy false delegate to the original SDK query.
func check_hover_lookups() -> void:
  stages.hoverLookups = {"unhealthy": unhealthy_hover_lookups.values()}
  check(unhealthy_hover_lookups.is_empty(), "hover/Gestures without hover listeners read hover Maps only as healthy false lookups")

func mount(name: String, position: Vector2) -> void:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = name
  surface.position = position
  surface.size = Vector2(360, 220)
  surface.set("application_path", NodePath("../PointerDocumentApplication"))
  surface.set("component_name", "PointerDocumentProbe")
  surface.set("initial_props", {"name": name, "noRef": name == "B"})
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

func down_raw(value: Dictionary) -> Array:
  return value.raw.filter(func(row: Dictionary) -> bool: return row.type == "topPointerDown")

func cleanup_valid(value: Dictionary) -> bool:
  if not value.globalEventRestored or value.currentPriority != value.defaultPriority or value.cleanup.size() != value.events.size():
    return false
  return value.cleanup.all(func(row: Dictionary) -> bool:
    return row.currentTargetNull and (not native_dispatch or (row.originalEvent and row.phase == 0 and row.pathEmpty)))

func exact_raw(value: Dictionary, type: String, expected_events: int) -> bool:
  var raw: Array = value.raw.filter(func(row: Dictionary) -> bool: return row.type == type)
  var events: Array = value.events.filter(func(row: Dictionary) -> bool: return (row.label == "TouchStart") if type == "topTouchStart" else (row.label != "TouchStart"))
  if raw.size() != 2 or events.size() != expected_events or expected_events == 0:
    return false
  if raw[0].channel != "typed" or raw[1].channel != "star" or raw[0].payloadId != raw[1].payloadId:
    return false
  return events.all(func(row: Dictionary) -> bool:
    return row.payloadId == raw[0].payloadId and row.nativeTarget == raw[0].target and row.timeStamp == raw[0].timeStamp and row.timeStamp == row.nativeTimeStamp and row.sequence > raw[1].sequence)

func verify_down(name: String, prefix: String, expected: Array, phases: Array, before: Dictionary, legacy: bool = false) -> Dictionary:
  var value := state()
  var after := native(surfaces[name])
  var app := native(application)
  check(labels(value) == expected, prefix + "/Exact callback order is observed rather than inferred from listeners")
  # JSON numbers arrive as floats. Normalize the expected numeric representation
  # without rounding the observed value, so a fractional/wrong phase still fails.
  var expected_phases := phases.map(func(phase: Variant) -> Variant: return float(phase) if phase != null else null)
  check(value.events.size() == phases.size() and value.events.map(func(row: Dictionary) -> Variant: return row.phase) == expected_phases,
    prefix + "/Every observed event has the declared propagation phase")
  check(value.events.all(func(row: Dictionary) -> bool: return row.name == name and row.targetMatches and row.currentMatches and row.nativeTarget == value.targetTag),
    prefix + "/Actual source root target tag and currentTarget remain isolated")
  if not legacy:
    check(value.events.all(func(row: Dictionary) -> bool: return row.trusted and row.originalEvent and row.originalSynthetic and row.thisMatches and row.globalEventMatches and row.targetOriginalElement and row.ownerDocumentMatches),
      prefix + "/Delivered callbacks use trusted original RN event element and Document identities")
  else:
    check(value.events.size() == 1 and value.events[0].compiledLegacySynthetic and not value.events[0].originalEvent,
      prefix + "/Disabled native dispatch uses the compiled legacy JSX sentinel honestly")
  check((down_raw(value).is_empty() if expected.is_empty() else exact_raw(value, "topPointerDown", expected.size())),
    prefix + "/Native pointerdown Raw typed and star have exact membership payload identity and timestamps")
  check(value.panels[name].count == value.baselineCount + expected.size(), prefix + "/Functional React counter commits every real delivered callback once")
  check(after.commits == before.commits + (0 if expected.is_empty() else 1),
    prefix + "/Original renderer batches all functional callback updates into exactly one commit")
  check(cleanup_valid(value), prefix + "/Dispatch restores event priority global event and every transient currentTarget")
  check(after.pointer.pointerDowns == before.pointer.pointerDowns + 1 and after.pointer.starts == before.pointer.starts + 1 and after.pointer.activePointers == 1 and after.pointer.activeTouches == 1 and app.pointerProcessor.active == 1 and app.pointerRouting.active == 1 and app.pointerRouting.contacts == 1,
    prefix + "/One actual native Down legitimately owns one physical contact in both processors")
  stages[prefix + "/down"] = {"react": value, "before": before, "after": after, "application": app}
  return value

func negative_up_queries(rows: Array) -> bool:
  if rows.size() % 2 != 0:
    return false
  for index in range(0, rows.size(), 2):
    if rows[index].offset != 36 or rows[index + 1].offset != 37:
      return false
  return rows.all(func(row: Dictionary) -> bool: return row.action == "delegate" and not row.matched and row.resultKind == "boolean" and not row.result)

func verify_terminal(name: String, prefix: String, before: Dictionary, phase: String) -> void:
  var after := native(surfaces[name])
  var app := native(application)
  var value := state()
  var queries_valid: bool = value.query.rows.is_empty() if phase == "cancel" or not app.pointerListenerQueryInstalled else negative_up_queries(value.query.rows)
  check(value.events.is_empty() and value.raw.is_empty() and queries_valid and cleanup_valid(value),
    prefix + "/Terminal does not fabricate a down callback Raw down or interest query")
  check(after.pointer.activePointers == 0 and after.pointer.activeTouches == 0 and app.pointerProcessor.active == 0 and app.pointerProcessor.pendingCapture == 0 and app.pointerProcessor.activeCapture == 0 and app.pointerProcessor.hover == 0 and app.pointerRouting.contacts == 0 and app.pointerRouting.active == 0 and app.pointerRouting.stored == 0,
    prefix + "/Up or Cancel clears all adapter processor and route contact ownership")
  check((after.pointer.pointerCancels == before.pointer.pointerCancels + 1 and after.pointer.cancels == before.pointer.cancels + 1) if phase == "cancel" else (after.pointer.pointerUps == before.pointer.pointerUps + 1 and after.pointer.ends == before.pointer.ends + 1),
    prefix + "/Exactly one native terminal sample is counted on pointer and touch paths")
  stages[prefix + "/terminal"] = {"react": value, "root": after, "application": app, "phase": phase}

func gesture(name: String, index: int, prefix: String, expected: Array, phases: Array, phase: String = "end", target: String = "leaf", legacy: bool = false) -> Dictionary:
  js("arm(%s,%s,%s)" % [JSON.stringify(name), JSON.stringify(prefix + "/down"), JSON.stringify(target)])
  var before := native(surfaces[name])
  var errors_before: Array = native(application).errors
  await inject(name, index, "start", target)
  var value := verify_down(name, prefix, expected, phases, before, legacy)
  js("arm(%s,%s,%s)" % [JSON.stringify(name), JSON.stringify(prefix + "/terminal"), JSON.stringify(target)])
  var terminal_before := native(surfaces[name])
  await inject(name, index, phase, target)
  verify_terminal(name, prefix, terminal_before, phase)
  check(native(application).errors == errors_before, prefix + "/Healthy gesture adds no diagnostic")
  return value

func doc_expected(all_ancestors: bool = false) -> Array:
  if interest_mode != "current" or not native_dispatch:
    return []
  return ["DocC", "RootC", "RootB", "DocB"] if all_ancestors and imperative else ["DocC", "DocB"]

func doc_phases(all_ancestors: bool = false) -> Array:
  return [1, 1, 3, 3] if doc_expected(all_ancestors).size() == 4 else [1, 3] if not doc_expected(all_ancestors).is_empty() else []

func public_control(name: String, prefix: String) -> void:
  js("configure(%s,'doc')" % JSON.stringify(name))
  js("arm(%s,%s)" % [JSON.stringify(name), JSON.stringify(prefix + "/manual")])
  var result: Dictionary = js("manualDocument(%s)" % JSON.stringify(name))
  var value := state()
  if native_dispatch:
    check(result.available and result.returned and not result.trusted and result.targetMatches and result.cleaned and result.noPrototypeBorrow,
      prefix + "/Public dispatch uses the real original Document method without prototype borrowing")
    check(labels(value) == ["DocC", "DocB"] and value.events.all(func(row: Dictionary) -> bool:
      return not row.trusted and row.phase == 2 and row.targetMatches and row.currentMatches and row.thisMatches and row.originalEvent and not row.originalSynthetic),
      prefix + "/Installed Document capture and bubble listeners pass the independent untrusted at-target positive")
  else:
    check(not result.available and result.noPrototypeBorrow and value.events.is_empty(),
      prefix + "/Document methods absent by flags are observed without borrowing gated prototypes")
  check(value.raw.is_empty() and value.query.rows.is_empty() and value.panels[name].count == value.baselineCount and cleanup_valid(value),
    prefix + "/Manual positive emits no native Raw query or React native counter update")
  stages[prefix + "/manual"] = {"result": result, "react": value}

func capture_frame(filename: String, updated: bool) -> void:
  if not capture or DisplayServer.get_name() == "headless":
    return
  await RenderingServer.frame_post_draw
  var image := root.get_texture().get_image()
  var saved := image.save_png("res://build/" + filename)
  var pixels: Array = []
  for origin: Vector2i in [Vector2i.ZERO, Vector2i(400, 0)]:
    var points := [Vector2i(5, 5), Vector2i(75, 55), Vector2i(260, 55), Vector2i(25, 175), Vector2i(45, 175)]
    var colors := ["0f172aff", "2563ebff", "0f766eff", "fde047ff", "fde047ff" if updated and origin == Vector2i.ZERO else "0f172aff"]
    for index in range(points.size()):
      var point: Vector2i = origin + points[index]
      var actual := image.get_pixelv(point).to_html()
      check(actual == colors[index], "capture/" + filename + "/Actual native pixel " + str(point) + " matches React committed state")
      pixels.append({"point": [point.x, point.y], "color": actual, "expected": colors[index]})
  check(saved == OK and image.get_width() == 760 and image.get_height() == 220,
    "capture/" + filename + "/Native viewport is saved at actual scenario dimensions")
  captures.append({"file": "build/" + filename, "width": image.get_width(), "height": image.get_height(), "pixels": pixels, "reactCounters": state().panels})

func root_fault() -> void:
  var prefix := "rootfault/throw34"
  js("resetAll()")
  js("prepareRootFault('A')")
  await settle()
  js("arm('A',%s,'leaf','rootfault')" % JSON.stringify(prefix + "/down"))
  stages[prefix + "/configuration"] = js("faultRoot('A',34,'throw')")
  var before := native(surfaces.A)
  var errors_before: Array = native(application).errors
  await inject("A", 0)
  var value := state()
  var app := native(application)
  var expected := "GF document query deliberate fault: root34"
  expected_errors.append(expected)
  var attempts: Array = value.query.rows.filter(func(row: Dictionary) -> bool: return row.matched)
  check(attempts.size() == 1 and attempts[0].isRootHandle and attempts[0].expectedHandle and attempts[0].name == "A" and attempts[0].offset == 34 and attempts[0].action == "throw" and value.query.fault.remaining == 0,
    prefix + "/Actual documentElement handle consumes exactly one configured root query fault")
  check(app.errors.size() == errors_before.size() + 1 and str(app.errors[-1]).contains(expected),
    prefix + "/Exactly one explicit diagnostic retains the root query fault cause")
  check(labels(value) == ["TouchStart"] and value.events.size() == 1 and value.events[0].trusted and value.events[0].originalEvent and value.events[0].phase == 2 and value.events[0].targetMatches and value.events[0].currentMatches and value.events[0].globalEventMatches,
    prefix + "/Same-batch original trusted TouchStart continues after failed root pointer interest")
  check(down_raw(value).is_empty() and exact_raw(value, "topTouchStart", 1) and value.raw.size() == 2,
    prefix + "/Failed root interest drops only pointerdown while original Raw touchstart retains payload identity")
  check(value.panels.A.count == value.baselineCount + 1 and cleanup_valid(value),
    prefix + "/Same-batch functional React update commits and dispatch context restores")
  check(native(surfaces.A).pointer.pointerDowns == before.pointer.pointerDowns + 1 and native(surfaces.A).pointer.activePointers == 1 and native(surfaces.A).pointer.activeTouches == 1 and app.pointerProcessor.active == 1 and app.pointerRouting.contacts == 1,
    prefix + "/Query diagnostic leaves the legitimate pressed physical contact available for terminal cleanup")
  stages[prefix + "/down"] = {"react": value, "before": before, "application": app}
  js("clearFault('A')")
  await settle()
  js("arm('A',%s)" % JSON.stringify(prefix + "/terminal"))
  var terminal_before := native(surfaces.A)
  await inject("A", 0, "cancel")
  verify_terminal("A", prefix, terminal_before, "cancel")
  js("configure('A','doc')")
  await gesture("A", 0, prefix + "/recovery", ["DocC", "DocB"], [1, 3])
  check(native(application).errors.size() == errors_before.size() + 1, prefix + "/Cancel and next healthy gesture neither hide nor duplicate the diagnostic")

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
  application.name = "PointerDocumentApplication"
  application.set("bundle_path", "res://build/pointer-document-" + flag_mode + ".js")
  root.add_child(application)
  mount("A", Vector2.ZERO)
  mount("B", Vector2(400, 0))
  await settle()
  bind("A")
  bind("B")
  var installed := interest_mode == "current" and native_dispatch
  check(native(application).rootCount == 2 and native(surfaces.A).runtimeId == native(surfaces.B).runtimeId and native(surfaces.A).surfaceId != native(surfaces.B).surfaceId,
    "mount/Two actual isolated roots share exactly one Hermes application")
  check(native(application).pointerListenerQueryInstalled == installed,
    "mount/SDK installs the pure query exactly when current mode and native-dispatch flag are enabled")
  var function_methods := ["function", "function", "function"]
  var absent_methods := ["undefined", "undefined", "undefined"]
  for name: String in ["A", "B"]:
    var capability: Dictionary = stages["capability" + name]
    check(capability.flags.imperative == imperative and capability.flags.nativeDispatch == native_dispatch and capability.mode == flag_mode and capability.interestMode == interest_mode,
      "capability/" + name + "/Each independent Hermes application uses the intended original flag matrix")
    check(capability.originalDoc and capability.originalElement and capability.docOwnsElement and capability.docConnected and capability.elementConnected and capability.originalRootGetterIdentity and capability.distinctOtherRoot,
      "capability/" + name + "/Actual original Document and documentElement are connected identity-owned and isolated")
    check(capability.methods.doc == (function_methods if native_dispatch else absent_methods) and capability.methods.element == (function_methods if imperative and native_dispatch else absent_methods),
      "capability/" + name + "/Document methods depend on D while documentElement methods require I and D")
    check(capability.docEventTarget == native_dispatch and capability.rootEventTarget == native_dispatch and capability.query.installations == (1 if installed else 0) and (not installed or capability.query.restoredInstaller),
      "capability/" + name + "/Original inheritance and the single SDK installation match the declared flags")
  check(stages.capabilityA.methods.view == (function_methods if imperative and native_dispatch else absent_methods) and stages.capabilityA.docOwnsRef,
    "capability/A/Real View ref methods follow both flags and its ownerDocument is the original root")
  check(stages.capabilityB.methods.view == null and stages.capabilityB.noRef.noRef and not stages.capabilityB.noRef.refAssigned and stages.capabilityB.noRef.handleExists and stages.capabilityB.noRef.canonicalPresent and stages.capabilityB.noRef.publicInstanceNull,
    "capability/B/No-ref leaf is real and initially has no public instance from first mount")
  await capture_frame("pointer-document-initial.png", false)

  js("resetAll()")
  stages["no-ref/before"] = js("noRefSnapshot('B')")
  var no_interest_down := await gesture("B", 1, "no-ref/no-interest", [], [])
  stages["no-ref/after"] = js("noRefSnapshot('B')")
  check(stages["no-ref/before"].publicInstanceNull and stages["no-ref/after"].handleExists and not stages["no-ref/after"].refAssigned and not stages["no-ref/after"].lazyHelperCalled,
    "no-ref/No-ref leaf is observed without lazy helper before and after real input regardless of later dispatcher materialization")
  if installed:
    var negative_roots: Array = no_interest_down.query.rows.filter(func(row: Dictionary) -> bool: return row.isRootHandle and row.name == "B" and row.resultKind == "boolean")
    check(not negative_roots.is_empty() and negative_roots.all(func(row: Dictionary) -> bool:
      return row.expectedHandle and not row.result and row.before.publicInstanceNull and row.after.publicInstanceNull and not row.before.refAssigned and not row.after.refAssigned),
      "no-ref/Actual false root queries preserve null canonical publicInstance during the query itself")
  else:
    check(no_interest_down.query.rows.is_empty(), "no-ref/Disabled or original SDK performs no root query during the negative sample")
  # TouchStart dispatch may legitimately create a public instance after the
  # query. A new root provides a separate cold positive query control.
  var cold_before := native(surfaces.B)
  surfaces.B.call("unmount")
  await settle()
  var cold_retired := native(surfaces.B)
  check(cold_retired.nativeTags == 0 and cold_retired.creates == cold_retired.deletes and native(application).rootCount == 1,
    "no-ref/Cold positive control retires the earlier native root with balanced Controls")
  check(surfaces.B.call("mount"), "no-ref/Same no-ref surface remounts for an independent cold positive query")
  await settle()
  bind("B")
  stages["no-ref/cold-positive"] = js("noRefSnapshot('B')")
  check(native(surfaces.B).surfaceId != cold_before.surfaceId and stages["no-ref/cold-positive"].publicInstanceNull and not stages["no-ref/cold-positive"].refAssigned,
    "no-ref/Positive control starts with a new original root and truly cold no-ref leaf")

  public_control("A", "document/A")
  js("configure('A','doc')")
  await gesture("A", 0, "document/A", doc_expected(), doc_phases())
  await capture_frame("pointer-document-updated.png", true)
  public_control("B", "document/B-no-ref")
  js("configure('B','doc')")
  var no_ref_down := await gesture("B", 1, "document/B-no-ref", doc_expected(), doc_phases(), "cancel")
  if installed:
    var positive_roots: Array = no_ref_down.query.rows.filter(func(row: Dictionary) -> bool: return row.isRootHandle and row.name == "B" and row.resultKind == "boolean" and row.result)
    check(not positive_roots.is_empty() and positive_roots.all(func(row: Dictionary) -> bool:
      return row.expectedHandle and row.before.handleExists and row.before.publicInstanceNull and row.after.publicInstanceNull and not row.before.refAssigned and not row.after.refAssigned and not row.before.lazyHelperCalled and not row.after.lazyHelperCalled),
      "no-ref/Positive real root query observes the original handle without creating the leaf before dispatcher delivery")
  else:
    check(no_ref_down.query.rows.is_empty(), "no-ref/Original or disabled SDK query performs no test-supplied native lookup")

  js("resetAll()")
  stages["element-only/configuration"] = js("configure('A','element')")
  js("arm('A','element-only/manual')")
  var manual_element: Dictionary = js("manualElement('A')")
  var manual_element_state := state()
  check((manual_element.available and manual_element.returned and not manual_element.trusted and manual_element.targetMatches and manual_element.cleaned and labels(manual_element_state) == ["RootC", "RootB"] and manual_element_state.events.all(func(row: Dictionary) -> bool: return row.phase == 2 and not row.trusted and row.targetMatches and row.thisMatches and row.currentMatches)) if imperative and native_dispatch else (not manual_element.available and manual_element_state.events.is_empty()),
    "element-only/Original documentElement method is an independent at-target manual positive only with both flags")
  check(manual_element.noPrototypeBorrow and manual_element_state.raw.is_empty() and manual_element_state.query.rows.is_empty() and cleanup_valid(manual_element_state),
    "element-only/Manual control neither borrows hidden methods nor creates native Raw or interest")
  stages["element-only/manual"] = {"result": manual_element, "react": manual_element_state}
  var element_down := await gesture("A", 0, "element-only", ["RootC", "RootB"] if installed and imperative else [], [1, 3] if installed and imperative else [])
  check(stages["element-only/configuration"].installed == (["RootC", "RootB"] if imperative and native_dispatch else []) and element_down.events.all(func(row: Dictionary) -> bool: return row.label == "RootC" or row.label == "RootB"),
    "element-only/Isolated root-element Map interest is proved without Document View or JSX helper listeners")

  # Offset 34 must not qualify these gestures: each original registry
  # contains exactly one capture listener and no bubble or JSX helper listener.
  for kind: String in ["doc-capture-only", "element-capture-only"]:
    js("resetAll()")
    var capture_label := "DocC" if kind == "doc-capture-only" else "RootC"
    var supported := native_dispatch and (kind == "doc-capture-only" or imperative)
    var delivered := installed and supported
    var configuration: Dictionary = js("configure('A',%s)" % JSON.stringify(kind))
    stages[kind + "/configuration"] = configuration
    check(configuration.installed == ([capture_label] if supported else []) and configuration.noPrototypeBorrow,
      kind + "/Exactly one original capture registration exists only under its declared public flags")
    js("arm('A',%s)" % JSON.stringify(kind + "/manual"))
    var manual_capture: Dictionary = js("manualDocument('A')" if kind == "doc-capture-only" else "manualElement('A')")
    var manual_capture_state := state()
    check((manual_capture.available and manual_capture.returned and not manual_capture.trusted and manual_capture.targetMatches and manual_capture.cleaned and labels(manual_capture_state) == [capture_label] and manual_capture_state.events.all(func(row: Dictionary) -> bool:
      return row.phase == 2 and not row.trusted and row.currentMatches and row.thisMatches and row.targetMatches and row.originalEvent and not row.originalSynthetic)) if supported else (not manual_capture.available and manual_capture_state.events.is_empty()),
      kind + "/Same isolated capture listener is a real untrusted at-target public dispatch positive")
    check(manual_capture.noPrototypeBorrow and manual_capture_state.raw.is_empty() and manual_capture_state.query.rows.is_empty() and manual_capture_state.panels.A.count == manual_capture_state.baselineCount and cleanup_valid(manual_capture_state),
      kind + "/Manual capture control emits no native Raw query React update or leaked context")
    stages[kind + "/manual"] = {"result": manual_capture, "react": manual_capture_state}
    var capture_down := await gesture("A", 0, kind, [capture_label] if delivered else [], [1] if delivered else [])
    var capture_roots: Array = capture_down.query.rows.filter(func(row: Dictionary) -> bool: return row.isRootHandle and row.name == "A")
    if installed:
      var bubble_queries: Array = capture_roots.filter(func(row: Dictionary) -> bool: return row.offset == 34)
      var capture_queries: Array = capture_roots.filter(func(row: Dictionary) -> bool: return row.offset == 35)
      check(not bubble_queries.is_empty() and not capture_queries.is_empty() and bubble_queries.all(func(row: Dictionary) -> bool: return row.resultKind == "boolean" and not row.result) and capture_queries.all(func(row: Dictionary) -> bool: return row.resultKind == "boolean" and row.result == delivered) and bubble_queries[0].sequence < capture_queries[0].sequence,
        kind + "/Actual isolated root query rejects bubble offset34 before evaluating capture offset35")
      check(not capture_roots.is_empty() and capture_roots.all(func(row: Dictionary) -> bool:
        return row.expectedHandle and row.action == "delegate" and row.before.handleExists and row.after.handleExists and row.before.canonicalPresent and row.after.canonicalPresent and row.before.publicInstanceNull == row.after.publicInstanceNull and row.before.refAssigned == row.after.refAssigned),
        kind + "/Real root handle queries preserve the observed canonical and ref state")
    else:
      check(capture_down.query.rows.is_empty(), kind + "/Original interest and disabled SDK flags do not install a test-supplied query")

  # Independently registering only B must never qualify an A sample,
  # including its Raw down. B's following positive proves the listener is live.
  js("resetAll()")
  stages["isolation/B-only/configuration"] = js("configure('B','doc')")
  var isolated_b_before := native(surfaces.B)
  var isolated_b_count: int = state().panels.B.count
  check(stages["isolation/B-only/configuration"].installed == (["DocC", "DocB"] if native_dispatch else []) and stages["isolation/B-only/configuration"].noPrototypeBorrow,
    "isolation/B-only/Only B owns the original Document registrations under the declared flags")
  var isolated_a_down := await gesture("A", 0, "isolation/A-none-B-doc", [], [])
  var isolated_b_after := native(surfaces.B)
  check(isolated_a_down.events.is_empty() and isolated_a_down.raw.is_empty() and isolated_a_down.panels.B.count == isolated_b_count and isolated_b_after.pointer.pointerDowns == isolated_b_before.pointer.pointerDowns and isolated_b_after.pointer.starts == isolated_b_before.pointer.starts and isolated_b_after.pointer.activePointers == 0 and isolated_b_after.pointer.activeTouches == 0,
    "isolation/A-none-B-doc/A sample cannot emit Raw or callbacks from B interest or mutate B state and native contact counts")
  stages["isolation/B-unchanged"] = {"counterBefore": isolated_b_count, "rootBefore": isolated_b_before, "rootAfter": isolated_b_after}
  var isolated_b_down := await gesture("B", 1, "isolation/B-only-positive", doc_expected(), doc_phases())
  check(isolated_b_down.panels.A.count == isolated_a_down.panels.A.count and isolated_b_down.events.all(func(row: Dictionary) -> bool: return row.name == "B"),
    "isolation/B-only-positive/Following live B delivery remains in B and leaves A counter unchanged")

  js("resetAll()")
  js("configure('A','all')")
  js("configure('B','all')")
  await gesture("A", 0, "ancestry/A", doc_expected(true), doc_phases(true))
  await gesture("B", 1, "ancestry/B", doc_expected(true), doc_phases(true))
  js("rerender('A')")
  await settle()
  var identity: Dictionary = js("inspectIdentity('A')")
  stages.identity = identity
  check(identity.docSame and identity.elementSame and identity.refSame and identity.getterSame and identity.revision == 1,
    "rerender/Actual Document documentElement and keyed View ref preserve identity across React commit")
  await gesture("A", 0, "rerender/listener-persists", doc_expected(true), doc_phases(true))

  js("resetAll()")
  js("configure('A','view')")
  await gesture("A", 0, "view-only", ["ViewB"] if installed and imperative else [], [2] if installed and imperative else [])
  check(stages["view-only/down"].react.events.all(func(row: Dictionary) -> bool: return row.label == "ViewB") and (imperative or stages.capabilityA.methods.view == absent_methods),
    "view-only/FT never bypasses the gated public View methods while TT retains existing View interest")

  for kind: String in ["doc-once", "doc-remove", "doc-abort-pre", "doc-abort-after"]:
    js("resetAll()")
    js("configure('A',%s)" % JSON.stringify(kind))
    if kind == "doc-remove":
      js("removeFinal('A')")
    elif kind == "doc-abort-after":
      js("abortRegistered('A')")
    await gesture("A", 0, "membership/" + kind, ["DocB"] if kind == "doc-once" and installed else [], [3] if kind == "doc-once" and installed else [], "cancel" if kind == "doc-abort-after" else "end")
    if kind == "doc-once":
      await gesture("A", 0, "membership/doc-once-consumed", [], [])

  js("resetAll()")
  await gesture("A", 0, "jsx-sentinel", ["JSX"], [2] if native_dispatch else [null], "end", "sentinel", not native_dispatch)
  if interest_mode == "current" and flag_mode == "enabled":
    await root_fault()

  js("resetAll()")
  var retained: Dictionary = js("retainRoot('A')")
  stages.retained = retained
  var retirement_before := native(surfaces.A)
  js("arm('A','retirement/held')")
  await inject("A", 0)
  var retire_expected: Array = ["OldRoot", "OldDoc"] if installed and imperative else ["OldDoc"] if installed else []
  verify_down("A", "retirement/held", retire_expected, [3, 3] if retire_expected.size() == 2 else [3] if retire_expected.size() == 1 else [], retirement_before)
  surfaces.A.call("unmount")
  await settle()
  var retired_root := native(surfaces.A)
  var retired_app := native(application)
  stages["retirement/native"] = {"root": retired_root, "application": retired_app}
  stages["retirement/identities"] = js("inspectRetained(%s)" % JSON.stringify(retained.key))
  check(retired_root.nativeTags == 0 and retired_root.creates == retired_root.deletes and retired_app.rootCount == 1 and retired_app.pointerProcessor.active == 0 and retired_app.pointerRouting.contacts == 0 and retired_root.pointer.activePointers == 0 and retired_root.pointer.activeTouches == 0 and retired_root.pointer.pointerCancels == retirement_before.pointer.pointerCancels + 1,
    "retirement/Actual held root retirement balances native nodes and cancels all contact owners")
  check(not stages["retirement/identities"].docConnected and not stages["retirement/identities"].elementConnected and stages["retirement/identities"].oldRootGetterNull,
    "retirement/Retained original Document and documentElement disconnect and leave the original root registry")
  js("configure('B','doc')")
  await gesture("B", 1, "retirement/sibling-survives", doc_expected(), doc_phases())
  check(surfaces.A.call("mount"), "remount/Same physical surface can mount a replacement original root")
  await settle()
  bind("A")
  var fresh: Dictionary = js("inspectRetained(%s)" % JSON.stringify(retained.key))
  stages["remount/identities"] = fresh
  check(fresh.currentDocFresh and fresh.currentElementFresh and native(surfaces.A).surfaceId != retained.surfaceId and native(application).rootCount == 2,
    "remount/New root generation does not reuse retained original Document identities")
  js("resetAll()")
  await gesture("A", 0, "remount/retained-listeners-inert", [], [])
  js("arm('A','remount/retained-manual')")
  var manual_old: Dictionary = js("manualRetained(%s)" % JSON.stringify(retained.key))
  var manual_old_state := state()
  check((manual_old.available and manual_old.returned and not manual_old.trusted and manual_old.targetMatches and manual_old.cleaned and labels(manual_old_state) == ["OldDoc"] and manual_old_state.events[0].phase == 2 and manual_old_state.events[0].targetMatches) if native_dispatch else (not manual_old.available and manual_old_state.events.is_empty()),
    "remount/Retained original Document listener remains a public manual positive but cannot receive replacement native input")
  check(manual_old_state.raw.is_empty() and manual_old_state.query.rows.is_empty() and cleanup_valid(manual_old_state),
    "remount/Retained manual listener does not create Raw native interest or dispatch context leaks")
  stages["remount/retained-manual"] = {"result": manual_old, "react": manual_old_state}
  js("configure('A','doc')")
  await gesture("A", 0, "remount/fresh-document", doc_expected(), doc_phases())

  var late_override: Variant = js("rejectLateOverride()")
  stages.lateOverride = late_override
  check(late_override is String and not late_override.is_empty(), "flags/Original RN rejects a late override after classes and root identities are constructed")
  var final_capability: Dictionary = js("capability('A')")
  check(final_capability.flags.imperative == imperative and final_capability.flags.nativeDispatch == native_dispatch and final_capability.methods.doc == (function_methods if native_dispatch else absent_methods) and final_capability.methods.element == (function_methods if imperative and native_dispatch else absent_methods),
    "flags/Late override rejection preserves the established public method matrix")
  stages.finalCapability = final_capability
  stages.beforeStop = {"application": native(application), "react": state()}
  check(stages.beforeStop.application.errors.size() == expected_errors.size(), "errors/Only the explicitly configured root query fault remains visible")
  application.call("stop")
  await settle()
  var stopped := native(application)
  check(stopped.stopped and not stopped.pointerListenerQueryInstalled and stopped.rootCount == 0 and stopped.pendingWork == 0 and stopped.pendingTimers == 0 and stopped.pendingAnimationFrames == 0 and stopped.pendingRootRetirements == 0 and stopped.pointerProcessor.active == 0 and stopped.pointerProcessor.pendingCapture == 0 and stopped.pointerProcessor.activeCapture == 0 and stopped.pointerProcessor.hover == 0 and stopped.pointerRouting.contacts == 0 and stopped.pointerRouting.stored == 0 and stopped.errors.size() == expected_errors.size(),
    "stop/Application clears roots SDK query timers processor queue and routes while retaining real diagnostics")
  for name: String in ["A", "B"]:
    var final_root := native(surfaces[name])
    check(final_root.nativeTags == 0 and final_root.creates == final_root.deletes and final_root.pointer.activePointers == 0 and final_root.pointer.activeTouches == 0,
      "stop/" + name + "/Every actual native Control and contact is balanced")
    stages["stoppedRoot" + name] = final_root
    surfaces[name].queue_free()
  application.queue_free()
  await settle()
  check_hover_lookups()
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var report := {"scenario": "native-pointer-document-interest-four-flags", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "flagMode": flag_mode, "interestMode": interest_mode,
    "checks": checks, "failures": failures, "stages": stages, "captures": captures, "afterStop": stopped,
    "expectedErrors": expected_errors, "allAssertionsPassed": failures.is_empty(),
    "scope": {"actualNativeInput": true, "experimentalNativeDispatch": true, "realOriginalDocuments": true,
      "rootQueryDiscriminatorObserved": true, "listenerRegistryMirrored": false, "lazyLeafLookupInQuery": false,
      "manualDispatchIsOnlyInstallationControl": true, "publicAPIAdded": false, "publicDefaultEnabled": false, "hardwareCertified": false}}
  var file := FileAccess.open("res://build/pointer-document-report.json", FileAccess.WRITE)
  if file == null:
    push_error("Cannot save document probe report")
    quit(1)
    return
  file.store_string(JSON.stringify(report, "  ") + "\n")
  print("POINTER_DOCUMENT_PASSED: " + str(checks.size()) if failures.is_empty() else "POINTER_DOCUMENT_FAILED: " + str(failures.size()))
  quit(0 if failures.is_empty() else 1)
