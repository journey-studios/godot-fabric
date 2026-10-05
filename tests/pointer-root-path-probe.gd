extends "res://tests/pointer-hover-probe.gd"

# RN resolves an empty point inside a root view to the root itself (Android's
# TouchTargetHelper, the root component view's hitTest on iOS). The root then
# stays in the processor's hover path, although RN never delivers an event
# targeted at it: its family has no event dispatcher. Only a point outside the
# root leaves the whole path. A button-less mouse and a touch move between
# A's target, A's empty area and a point outside every surface.
# AWAY (from the hover probe) lies outside every surface.
const EMPTY := Vector2(250, 60)
# The preceding host dispatches Document capture enter/leave to the root and
# crashes there, so its control runs the View case and the Document case apart.
var run_view := true
var run_document := true

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(PointerRootPathProbe." + expression + ")"))

func mount(name: String, position: Vector2) -> void:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = name
  surface.position = position
  surface.size = Vector2(300, 160)
  surface.set("application_path", NodePath("../PointerRootPathApplication"))
  surface.set("component_name", "PointerQueryFaultProbe")
  surface.set("initial_props", {"name": name, "probePointerMove": true, "probePointerHover": true})
  surface.set_meta("validation_input_device", DEVICE)
  surfaces[name] = surface
  root.add_child(surface)

# D is the target's original Document: it has no tag, and only Document
# listeners report it as their currentTarget.
func tags(name: String, value: Dictionary) -> Dictionary:
  var map := super.tags(name, value)
  map["D"] = null
  return map

func observed_path_events(rows: Array) -> Array:
  return rows.map(func(row: Dictionary) -> Array: return [row.label, row.phase, row.targetTag, null if row.currentIsDocument else row.currentTag])

func touch_at(name: String, point: Vector2, pressed: bool) -> void:
  var event := InputEventScreenTouch.new()
  event.device = DEVICE
  event.index = 0
  event.position = surfaces[name].position + point
  event.pressed = pressed
  Input.parse_input_event(event)
  await settle()

func drag_to(name: String, point: Vector2) -> void:
  var event := InputEventScreenDrag.new()
  event.device = DEVICE
  event.index = 0
  event.position = surfaces[name].position + point
  Input.parse_input_event(event)
  await settle()

# One actual native input. normative lists the checks the preceding host fails:
# "delivery", "raw", "query" and/or "hover". touch is the original touch
# callback that follows the hover callbacks, if any.
func path_step(name: String, prefix: String, input: Callable, events: Array, rows: Array, move_nodes: Array,
    hovered: int, normative: Array, touch: String = "") -> void:
  # Printed before the input so a crashing host shows the step it died in.
  print("POINTER_ROOT_PATH_STEP: " + prefix)
  js("arm(%s,%s)" % [JSON.stringify(name), JSON.stringify(prefix)])
  var before := native(surfaces[name])
  await input.call()
  var value := state()
  var after := native(surfaces[name])
  var app := native(application)
  var checks_by_kind := {
    "delivery": prefix + "/Native hover delivers exactly the qualified original callbacks in RN order phase and target",
    "raw": prefix + "/Hover Raw appears once per channel and dispatched event, never for the root",
    "query": prefix + "/Native hover consults the root and path Maps exactly as RN's root-resolved path requires",
    "hover": prefix + "/The processor holds the hover path RN resolves for this point",
  }
  for kind: String in normative:
    expected_original_failures.append(checks_by_kind[kind])
  var hover_events: Array = value.events.filter(func(row: Dictionary) -> bool: return row.label != touch)
  var labels: Array = events.map(func(event: Array) -> String: return event[0])
  if not touch.is_empty():
    labels.append(touch)
  var pointer_type := "touch" if not touch.is_empty() or prefix.contains("/touch") else "mouse"
  check(labels_of(value) == labels and observed_path_events(hover_events) == expected_events(name, value, events) and hover_events.all(func(row: Dictionary) -> bool:
    return row.trusted and row.originalEvent and row.originalSynthetic and row.currentMatches and row.globalEventMatches and row.type == hover_type(row.label) and row.pointerType == pointer_type and row.currentPriority == value.discretePriority),
    checks_by_kind.delivery)
  # Every dispatched hover event has its own typed/star pair in callback order;
  # a root-targeted dispatch would add a pair without any callback.
  var hover_raw: Array = value.raw.filter(func(row: Dictionary) -> bool: return row.type in RAW_TYPES.values())
  var pairs: bool = hover_raw.size() == 2 * events.size() and hover_events.size() == events.size()
  for index in range(hover_events.size()):
    if not pairs:
      break
    var typed: Dictionary = hover_raw[2 * index]
    var star: Dictionary = hover_raw[2 * index + 1]
    var row: Dictionary = hover_events[index]
    pairs = typed.channel == "typed" and star.channel == "star" and typed.payloadId == star.payloadId and row.payloadId == typed.payloadId and typed.type == RAW_TYPES[hover_type(row.label)] and star.sequence < row.sequence
  check(pairs, checks_by_kind.raw)
  check(hover_rows(value) == expected_hover_rows(name, value, rows) and healthy_hover_lookups(value), checks_by_kind.query)
  # Move lookups walk a hit view's path; a root target never qualifies itself.
  var moves: Array = value.query.rows.filter(func(row: Dictionary) -> bool: return int(row.offset) == 1 or int(row.offset) == 25).map(func(row: Dictionary) -> Array: return [row.targetTag, int(row.offset), row.result, row.rootHandle])
  check(moves == expected_move_rows(name, value, move_nodes) and rows_for(value, "topPointerMove").is_empty() and context_clean(value),
    prefix + "/Move lookups read only a hit view's path and no move is delivered")
  check(int(app.pointerProcessor.hover) == hovered, checks_by_kind.hover)
  stages[prefix] = {"react": value, "before": before, "after": after, "application": app}

func mouse_input(name: String, point: Vector2) -> Callable:
  return func() -> void: await mouse_to(name, point)

func touch_input(name: String, point: Vector2, pressed: bool) -> Callable:
  return func() -> void: await touch_at(name, point, pressed)

func drag_input(name: String, point: Vector2) -> Callable:
  return func() -> void: await drag_to(name, point)

const TARGET_ENTER := [["pointerover-bubble", 2, "T", "T"], ["pointerenter-bubble", 2, "T", "T"]]
const TARGET_LEAVE := [["pointerout-bubble", 2, "T", "T"], ["pointerleave-bubble", 2, "T", "T"]]
const OVER_PATH := [["T", 26, false], ["T", 28, false], ["P", 26, false], ["P", 28, false], ["C", 26, false], ["C", 28, false], ["R", 26, false], ["R", 28, false]]
const OUT_PATH := [["T", 27, false], ["T", 29, false], ["P", 27, false], ["P", 29, false], ["C", 27, false], ["C", 29, false], ["R", 27, false], ["R", 29, false]]
const DOC_ENTER := [["pointerenter-capture", 1, "C", "D"], ["pointerenter-capture", 1, "P", "D"], ["pointerenter-capture", 1, "T", "D"]]
const DOC_LEAVE := [["pointerleave-capture", 1, "T", "D"], ["pointerleave-capture", 1, "P", "D"], ["pointerleave-capture", 1, "C", "D"]]

func view_case() -> void:
  var prefix := "view-bubble"
  var registration: Dictionary = js("configure('A',false,'only')")
  check(registration.capture == false and registration.type == ["pointerover", "pointerenter", "pointerout", "pointerleave"],
    prefix + "/Exactly the requested original hover listeners are registered on the actual View ref")
  stages[prefix + "/registration"] = registration
  # The first sample, away from every surface, creates no route.
  await path_step("A", prefix + "/start", mouse_input("A", AWAY), [], [], [], 0, [])
  # Entering from outside the root enters the whole path: the root reads only
  # its capture Map, since a root's own listener can never receive an event.
  await path_step("A", prefix + "/enter", mouse_input("A", IN), TARGET_ENTER,
    [["T", 26, true], ["R", 23, false], ["C", 23, false], ["C", 0, false], ["P", 23, false], ["P", 0, false], ["T", 23, false], ["T", 0, true]],
    ["T", "P", "C", "R"], 1, ["query"])
  # The empty area inside A resolves to A's root: only the views leave.
  await path_step("A", prefix + "/empty", mouse_input("A", EMPTY), TARGET_LEAVE,
    [["T", 27, true], ["C", 24, false], ["C", 2, false], ["P", 24, false], ["P", 2, false], ["T", 24, false], ["T", 2, true]],
    [], 1, ["query", "hover"])
  await path_step("A", prefix + "/back", mouse_input("A", IN), TARGET_ENTER,
    [["T", 26, true], ["C", 23, false], ["C", 0, false], ["P", 23, false], ["P", 0, false], ["T", 23, false], ["T", 0, true]],
    ["T", "P", "C", "R"], 1, ["query"])
  # Only a point outside the root leaves the root too.
  await path_step("A", prefix + "/exit", mouse_input("A", AWAY), TARGET_LEAVE,
    [["T", 27, true], ["R", 24, false], ["C", 24, false], ["C", 2, false], ["P", 24, false], ["P", 2, false], ["T", 24, false], ["T", 2, true]],
    [], 0, ["query"])
  # The root alone enters and leaves around its empty area.
  await path_step("A", prefix + "/empty-in", mouse_input("A", EMPTY), [], [["R", 23, false]], [], 1, ["query", "hover"])
  await path_step("A", prefix + "/empty-out", mouse_input("A", AWAY), [], [["R", 24, false]], [], 0, ["query"])

# A Document capture enter/leave listener sees each descendant that enters or
# leaves together with the root, and nothing while the pointer stays inside it.
# The preceding host crashes in the first of these steps (it dispatches to the
# root), so none of their checks is a normative failure of its control.
func document_case() -> void:
  var prefix := "document-capture"
  var registration: Dictionary = js("configure('A',true,'document',['pointerenter','pointerleave'])")
  check(registration.capture == true and registration.type == ["pointerenter", "pointerleave"] and registration.listenerIsDocument,
    prefix + "/Exactly the requested original capture listeners are registered on the target's actual Document")
  stages[prefix + "/registration"] = registration
  await path_step("A", prefix + "/enter", mouse_input("A", IN), DOC_ENTER,
    OVER_PATH + [["R", 23, true], ["C", 23, false], ["P", 23, false], ["T", 23, false]], ["T", "P", "C", "R"], 1, [])
  await path_step("A", prefix + "/empty", mouse_input("A", EMPTY), [],
    OUT_PATH + [["C", 24, false], ["C", 2, false], ["P", 24, false], ["P", 2, false], ["T", 24, false], ["T", 2, false]],
    [], 1, [])
  await path_step("A", prefix + "/back", mouse_input("A", IN), [],
    OVER_PATH + [["C", 23, false], ["C", 0, false], ["P", 23, false], ["P", 0, false], ["T", 23, false], ["T", 0, false]],
    ["T", "P", "C", "R"], 1, [])
  await path_step("A", prefix + "/exit", mouse_input("A", AWAY), DOC_LEAVE,
    OUT_PATH + [["R", 24, true], ["C", 24, false], ["P", 24, false], ["T", 24, false]], [], 0, [])

# A touch has no hover of its own: it enters in the Down. Dragging into the
# empty area keeps the root, and the release then leaves only the root.
func touch_case() -> void:
  var prefix := "document-capture/touch"
  await path_step("A", prefix + "/down", touch_input("A", IN, true), DOC_ENTER,
    OVER_PATH + [["R", 23, true], ["C", 23, false], ["P", 23, false], ["T", 23, false]], [], 1, [], "touchstart")
  await path_step("A", prefix + "/drag-empty", drag_input("A", EMPTY), [],
    OUT_PATH + [["C", 24, false], ["C", 2, false], ["P", 24, false], ["P", 2, false], ["T", 24, false], ["T", 2, false]],
    [], 1, [])
  await path_step("A", prefix + "/up-empty", touch_input("A", EMPTY, false), [], [["R", 24, true]], [], 0, [], "touchend")
  var app := native(application)
  check(int(native(surfaces.A).pointer.activeTouches) == 0 and int(app.pointerProcessor.active) == 0 and int(app.pointerRouting.active) == 0,
    prefix + "/The released touch leaves no contact, active pointer or route")

func _initialize() -> void:
  var args := OS.get_cmdline_user_args()
  allow_original_negative = args.has("--allow-original-negative")
  run_view = not args.has("--document-only")
  run_document = not args.has("--view-only")
  call_deferred("run_probe")

func run_probe() -> void:
  root.size = Vector2i(680, 160)
  application = ClassDB.instantiate("FabricApplication")
  application.name = "PointerRootPathApplication"
  application.set("bundle_path", "res://build/pointer-root-path-enabled.js")
  root.add_child(application)
  mount("A", Vector2.ZERO)
  mount("B", Vector2(340, 0))
  await settle()
  check(native(application).rootCount == 2 and native(application).pointerListenerQueryInstalled,
    "mount/Two actual roots share Hermes and the one installed original SDK query")
  for name: String in ["A", "B"]:
    var capability: Dictionary = js("capability(%s)" % JSON.stringify(name))
    stages["capability" + name] = capability
    check(capability.original and capability.connected and capability.flags.imperative and capability.flags.nativeDispatch and capability.query.installations == 1,
      "capability/" + name + "/Actual original refs and enabled flags use the single real SDK installation")
  if run_view:
    await view_case()
  if run_document:
    await document_case()
    await touch_case()
  check_hover_lookups_on_root()
  stages.beforeStop = {"application": native(application), "react": state()}
  check(stages.beforeStop.application.errors.is_empty(), "cleanup/No query dispatch or responder diagnostic was hidden")
  application.call("stop")
  await settle()
  var stopped := native(application)
  check(stopped.stopped and not stopped.pointerListenerQueryInstalled and stopped.rootCount == 0 and stopped.pendingWork == 0 and stopped.pointerProcessor.active == 0 and stopped.pointerProcessor.hover == 0 and stopped.pointerRouting.contacts == 0 and stopped.pointerRouting.stored == 0 and stopped.errors.is_empty(),
    "cleanup/Stop balances roots query work routes and hover without diagnostics")
  for name: String in ["A", "B"]:
    var final_root := native(surfaces[name])
    check(final_root.nativeTags == 0 and final_root.creates == final_root.deletes, "cleanup/" + name + "/All real native Controls are balanced")
    stages["stoppedRoot" + name] = final_root
    surfaces[name].queue_free()
  application.queue_free()
  await settle()
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var observed := failures.duplicate()
  var expected := expected_original_failures.duplicate()
  observed.sort()
  expected.sort()
  var original_negative_observed := allow_original_negative and observed == expected and not failures.is_empty()
  var report := {"scenario": "native-pointer-root-path", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages, "afterStop": stopped,
    "expectedOriginalFailures": expected_original_failures, "allowOriginalNegative": allow_original_negative,
    "originalNegativeObserved": original_negative_observed, "allCurrentAssertionsPassed": failures.is_empty(),
    "cases": {"view": run_view, "document": run_document},
    "scope": {"actualNativeInput": true, "originalFlagsEnabled": true, "experimentalNativeDispatch": true,
      "realSDKQueryWrappedOnlyForTest": true, "listenerRegistryMirrored": false, "rootStaysInHoverPathInsideRoot": true,
      "rootNeverAnEventTarget": true, "documentCaptureHoverOnly": true, "documentHoverCertified": false,
      "surfaceSelectionUnchanged": true, "publicAPIAdded": false, "publicDefaultEnabled": false, "hardwareCertified": false}}
  var output := FileAccess.open("res://build/pointer-root-path-report.json", FileAccess.WRITE)
  if not check(output != null, "report/PointerRootPath report is saved with visible normative failures"):
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  print("POINTER_ROOT_PATH_ORIGINAL_NEGATIVE: " + str(failures.size()) if original_negative_observed else "POINTER_ROOT_PATH_PASSED: " + str(checks.size()) if failures.is_empty() else "POINTER_ROOT_PATH_FAILED")
  quit(0 if failures.is_empty() or original_negative_observed else 1)

# No root-targeted hover lookup reads a root's own enter/leave Map: only its
# capture Maps take part, as the propagation source for descendants.
func check_hover_lookups_on_root() -> void:
  var own_root: Array = []
  for key: String in stages:
    var stage: Variant = stages[key]
    if stage is Dictionary and stage.has("react") and stage.react is Dictionary and stage.react.has("query"):
      for row: Dictionary in stage.react.query.hoverRows:
        if row.rootHandle and int(row.offset) in [0, 2]:
          own_root.append([key, int(row.offset)])
  stages.rootOwnHoverLookups = own_root
  expected_original_failures.append("hover/A root's own enter and leave Maps are never read; only its capture Maps propagate")
  check(own_root.is_empty(), "hover/A root's own enter and leave Maps are never read; only its capture Maps propagate")
