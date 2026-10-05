extends "res://tests/pointer-document-up-probe.gd"

# Document and documentElement hover listeners on the real two-root Document
# scene, across the original/current interest modes and four flag lanes. Reuses
# the Up probe's mount, bind and contact helpers; never runs its Up lifecycle,
# refs, mutation, reentry or fault controls. A mouse and a touch move between
# A's leaf, A's empty area and a point outside every surface; an empty point
# inside a root resolves to the root, which stays in the hover path.
const EMPTY := Vector2(170, 150)
const AWAY := Vector2(380, 110)
const RAW_TYPES := {"pointerover": "topPointerOver", "pointerenter": "topPointerEnter", "pointerout": "topPointerOut", "pointerleave": "topPointerLeave"}

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(PointerDocumentHoverProbe." + expression + ")"))

func mount(name: String, position: Vector2) -> void:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = name
  surface.position = position
  surface.size = Vector2(360, 220)
  surface.set("application_path", NodePath("../PointerDocumentHoverApplication"))
  surface.set("component_name", "PointerDocumentProbe")
  surface.set("initial_props", {"name": name, "noRef": name == "B", "eventType": "pointerhover"})
  surface.set_meta("validation_input_device", DEVICE)
  surfaces[name] = surface
  root.add_child(surface)

func context_clean(value: Dictionary) -> bool:
  return value.hoverEventIdentity.callbackCount == value.events.size() and value.globalEventRestored and value.currentPriority == value.defaultPriority and value.cleanup.size() == value.events.size() and value.cleanup.all(func(row: Dictionary) -> bool:
    return row.currentTargetNull and (not native_dispatch or (row.originalEvent and row.phase == 0 and row.pathEmpty)))

func mouse_to(name: String, point: Vector2) -> void:
  var event := InputEventMouseMotion.new()
  event.device = DEVICE
  event.position = surfaces[name].position + point
  Input.parse_input_event(event)
  await settle()

func touch_at(name: String, point: Vector2, pressed: bool) -> void:
  var event := InputEventScreenTouch.new()
  event.device = DEVICE
  event.index = 0
  event.position = surfaces[name].position + point
  event.pressed = pressed
  Input.parse_input_event(event)
  await settle()

# Listeners actually registered for a configuration: Document methods need D,
# documentElement methods need I and D.
func registered(kind: String) -> Array:
  var labels_by_kind := {"all": ["DocC", "RootC", "RootB", "DocB"], "doc": ["DocC", "DocB"], "element": ["RootC", "RootB"],
    "doc-capture-only": ["DocC"], "element-capture-only": ["RootC"], "none": []}
  return labels_by_kind[kind].filter(func(label: String) -> bool:
    return native_dispatch and (label.begins_with("Doc") or imperative))

# Callbacks for one dispatched event of type at node: capture runs top-down
# (Document, then documentElement) at phase 1, bubble bottom-up at phase 3.
# pointerenter/pointerleave never bubble.
func callbacks(listeners: Array, type: String, node: String) -> Array:
  var result: Array = []
  for label: String in ["DocC", "RootC"]:
    if label in listeners:
      result.append([type, label, 1, node])
  if type == "pointerover" or type == "pointerout":
    for label: String in ["RootB", "DocB"]:
      if label in listeners:
        result.append([type, label, 3, node])
  return result

func qualifying(listeners: Array) -> bool:
  return installed() and not listeners.is_empty()

func capturing(listeners: Array) -> bool:
  return installed() and ("DocC" in listeners or "RootC" in listeners)

func bubbling(listeners: Array) -> bool:
  return installed() and ("DocB" in listeners or "RootB" in listeners)

# The over/out path query ends at the root: bubble first, then capture unless
# the bubble lookup already qualified.
func root_path_rows(listeners: Array, bubble: int) -> Array:
  if not installed():
    return []
  var rows := [[bubble, bubbling(listeners)]]
  if not bubbling(listeners):
    rows.append([bubble + 2, capturing(listeners)])
  return rows

func entering_from_outside(listeners: Array) -> Dictionary:
  var events: Array = []
  if qualifying(listeners):
    events.append_array(callbacks(listeners, "pointerover", "L"))
  if capturing(listeners):
    for node: String in ["C", "P", "L"]:
      events.append_array(callbacks(listeners, "pointerenter", node))
  var rows := root_path_rows(listeners, 26)
  if installed():
    rows.append([23, capturing(listeners)])
  return {"events": events, "rows": rows}

func leaving_to_outside(listeners: Array) -> Dictionary:
  var events: Array = []
  if qualifying(listeners):
    events.append_array(callbacks(listeners, "pointerout", "L"))
  if capturing(listeners):
    for node: String in ["L", "P", "C"]:
      events.append_array(callbacks(listeners, "pointerleave", node))
  var rows := root_path_rows(listeners, 27)
  if installed():
    rows.append([24, capturing(listeners)])
  return {"events": events, "rows": rows}

# Inside the root, only out/over reach the root through the path query; the
# root stays entered, so its capture Maps propagate nothing.
func within_root(listeners: Array, type: String) -> Dictionary:
  return {"events": callbacks(listeners, type, "L") if qualifying(listeners) else [],
    "rows": root_path_rows(listeners, 26 if type == "pointerover" else 27)}

func node_tags(name: String, value: Dictionary) -> Dictionary:
  var owner := native(surfaces[name])
  # JSON numbers are floats, and GDScript compares arrays strictly by type.
  return {"L": value.panels[name].leafTag, "P": float(tag_for(owner, name + "-parent")), "C": float(container_tag(owner)), "S": float(tag_for(owner, name + "-sentinel"))}

func container_tag(owner: Dictionary) -> int:
  for node: Dictionary in owner.nodes:
    if node.get("testID") == "":
      return int(node.tag)
  return 0

# One actual native input. expected is [type, label, phase, node] per callback;
# root is [offset, result] per root lookup, in order.
func hover_step(name: String, prefix: String, input: Callable, expected: Dictionary, hovered: int, pointer_type: String = "mouse", legacy_jsx: bool = false) -> void:
  js("arm(%s,%s)" % [JSON.stringify(name), JSON.stringify(prefix)])
  var before := native(surfaces[name])
  await input.call()
  var value := state()
  var after := native(surfaces[name])
  var app := native(application)
  var tags := node_tags(name, value)
  # A compiled legacy JSX handler (no native dispatch) carries no event type.
  var want: Array = expected.events.map(func(row: Array) -> Array: return [null if legacy_jsx else row[0], row[1], float(row[2]) if row[2] != null else null, tags[row[3]]])
  check(value.events.map(func(row: Dictionary) -> Array: return [row.type, row.label, row.phase, row.targetTag]) == want,
    prefix + "/Native hover reaches exactly the qualified Document and documentElement listeners in DOM order and phase")
  if legacy_jsx:
    check(value.events.all(func(row: Dictionary) -> bool: return row.compiledLegacySynthetic and not row.originalEvent),
      prefix + "/Without native dispatch the JSX sentinel keeps its compiled legacy synthetic handler")
  elif not want.is_empty():
    check(value.events.all(func(row: Dictionary) -> bool:
      return row.trusted and row.originalEvent and row.currentMatches and row.thisMatches and row.globalEventMatches and row.pointerType == pointer_type and row.currentPriority == value.discretePriority),
      prefix + "/Native hover callbacks are trusted original events at Discrete priority")
  # One typed/star Raw pair per dispatched event, shared by its callbacks.
  var dispatched: Array = []
  for index in range(value.events.size()):
    var row: Dictionary = value.events[index]
    var type: Variant = expected.events[index][0] if index < expected.events.size() else row.type
    if dispatched.is_empty() or dispatched[-1].payloadId != row.payloadId:
      dispatched.append({"payloadId": row.payloadId, "type": type})
  var raw_ok: bool = value.raw.size() == 2 * dispatched.size()
  for index in range(dispatched.size()):
    if not raw_ok:
      break
    var typed: Dictionary = value.raw[2 * index]
    var star: Dictionary = value.raw[2 * index + 1]
    raw_ok = typed.channel == "typed" and star.channel == "star" and typed.payloadId == dispatched[index].payloadId and star.payloadId == typed.payloadId and typed.type == RAW_TYPES.get(dispatched[index].type, "") and star.type == typed.type
  check(raw_ok, prefix + "/Hover Raw appears once per channel for each dispatched event, never for the root")
  var root_rows: Array = value.query.hoverRows.filter(func(row: Dictionary) -> bool: return row.isRootHandle)
  check(root_rows.map(func(row: Dictionary) -> Array: return [int(row.offset), row.result]) == expected.rows and root_rows.all(func(row: Dictionary) -> bool: return row.name == name) and same_slot(root_rows),
    prefix + "/The root reads exactly the over/out path and capture enter/leave Maps RN's root-resolved path requires")
  check(value.query.hoverRows.all(func(row: Dictionary) -> bool:
    return row.action == "delegate" and not row.matched and row.resultKind == "boolean" and int(row.offset) in HOVER_OFFSETS and (row.isRootHandle or not row.result)) and (installed() or value.query.hoverRows.is_empty()),
    prefix + "/Views read only false hover Maps and nothing is read without the installed query")
  check(int(app.pointerProcessor.hover) == hovered and value.panels[name].count == value.baselineCount + value.events.size() and context_clean(value),
    prefix + "/The processor keeps the resolved hover path and each callback updates React once")
  stages[prefix] = {"react": value, "before": before, "after": after, "application": app}

func mouse_input(name: String, point: Vector2) -> Callable:
  return func() -> void: await mouse_to(name, point)

func touch_input(name: String, point: Vector2, pressed: bool) -> Callable:
  return func() -> void: await touch_at(name, point, pressed)

func hover_manual(name: String, prefix: String, element: bool, listeners: Array) -> void:
  js("arm(%s,%s)" % [JSON.stringify(name), JSON.stringify(prefix + "/manual")])
  var result: Dictionary = js(("manualElement" if element else "manualDocument") + "(%s)" % JSON.stringify(name))
  var value := state()
  var supported := native_dispatch and (not element or imperative)
  # A bubbling pointerover dispatched at the Document reaches its own listeners
  # at phase 2. At the documentElement, the Document is its ancestor: capture
  # at phase 1, the element's own listeners at 2, the Document bubble at 3.
  var order := [["DocC", 1.0], ["RootC", 2.0], ["RootB", 2.0], ["DocB", 3.0]] if element else [["DocC", 2.0], ["DocB", 2.0]]
  var want: Array = order.filter(func(entry: Array) -> bool: return supported and entry[0] in listeners)
  check(result.available == supported and result.noPrototypeBorrow and value.events.map(func(row: Dictionary) -> Array: return [row.label, row.phase]) == want,
    prefix + "/Original public manual pointerover proves listener installation or the exact method gate")
  check(value.events.all(func(row: Dictionary) -> bool: return row.type == "pointerover" and not row.trusted and row.targetMatches and row.currentMatches) and value.raw.is_empty() and value.query.rows.is_empty() and value.query.hoverRows.is_empty() and context_clean(value),
    prefix + "/Manual pointerover stays untrusted at target without Raw or native lookups")
  stages[prefix + "/manual"] = {"result": result, "react": value}

func hover_case(kind: String) -> void:
  var prefix := "case/" + kind
  stages[prefix + "/configuration"] = js("configure('A',%s)" % JSON.stringify(kind))
  var listeners := registered(kind)
  check(stages[prefix + "/configuration"].installed == listeners, prefix + "/Exactly the flag-supported original hover listeners are registered")
  if kind != "element" and kind != "element-capture-only":
    hover_manual("A", prefix, false, listeners)
  if kind != "doc" and kind != "doc-capture-only":
    hover_manual("A", prefix + "/element", true, listeners)
  await hover_step("A", prefix + "/enter", mouse_input("A", LEAF_POINT), entering_from_outside(listeners), 1)
  await hover_step("A", prefix + "/empty", mouse_input("A", EMPTY), within_root(listeners, "pointerout"), 1)
  await hover_step("A", prefix + "/back", mouse_input("A", LEAF_POINT), within_root(listeners, "pointerover"), 1)
  await hover_step("A", prefix + "/exit", mouse_input("A", AWAY), leaving_to_outside(listeners), 0)

# A touch has no hover of its own: it enters in the Down and leaves after the Up.
func touch_case() -> void:
  js("configure('A','all')")
  var listeners := registered("all")
  await hover_step("A", "touch/down", touch_input("A", LEAF_POINT, true), entering_from_outside(listeners), 1, "touch")
  await hover_step("A", "touch/up", touch_input("A", LEAF_POINT, false), leaving_to_outside(listeners), 0, "touch")
  # The idle mouse keeps its own routing entry, so only active routes count.
  var owner := native(surfaces.A)
  var app := native(application)
  check(owner.pointer.activePointers == 0 and owner.pointer.activeTouches == 0 and app.pointerProcessor.active == 0 and app.pointerProcessor.activeCapture == 0 and app.pointerRouting.active == 0,
    "touch/up/The released touch leaves no contact, active pointer, capture or active route")

# The JSX sentinel's own onPointerEnter/onPointerLeave props qualify in every
# lane without the interest query; no Document listener is registered.
func sentinel_case() -> void:
  js("configure('A','none')")
  var rows_in: Array = root_path_rows([], 26)
  var rows_out: Array = root_path_rows([], 27)
  if installed():
    rows_in.append([23, false])
    rows_out.append([24, false])
  await hover_step("A", "sentinel/enter", mouse_input("A", SENTINEL_POINT),
    {"events": [["pointerenter", "JSX", 2 if native_dispatch else null, "S"]], "rows": rows_in}, 1, "mouse", not native_dispatch)
  await hover_step("A", "sentinel/exit", mouse_input("A", AWAY),
    {"events": [["pointerleave", "JSX", 2 if native_dispatch else null, "S"]], "rows": rows_out}, 0, "mouse", not native_dispatch)

# B's Document listeners stay isolated from A's hover, and qualify B's own.
func isolation() -> void:
  js("configure('A','none')")
  stages["isolation/B-configuration"] = js("configure('B','doc')")
  var count_b: Variant = state().panels.B.count
  await hover_step("A", "isolation/A-negative/enter", mouse_input("A", LEAF_POINT), entering_from_outside([]), 1)
  check(state().panels.B.count == count_b, "isolation/A-negative/B's Document listeners never run for A's hover")
  await hover_step("A", "isolation/A-negative/exit", mouse_input("A", AWAY), leaving_to_outside([]), 0)
  var doc := registered("doc")
  await hover_step("B", "isolation/B-positive/enter", mouse_input("B", LEAF_POINT), entering_from_outside(doc), 1)
  await hover_step("B", "isolation/B-positive/exit", mouse_input("B", AWAY - Vector2(400, 0)), leaving_to_outside(doc), 0)

# Removing the final listeners while hovering stops delivery at the next change.
func removal() -> void:
  js("configure('A','doc')")
  await hover_step("A", "removal/enter", mouse_input("A", LEAF_POINT), entering_from_outside(registered("doc")), 1)
  stages["removal/removed"] = js("removeFinal('A')")
  await hover_step("A", "removal/exit", mouse_input("A", AWAY), leaving_to_outside([]), 0)

func run_probe() -> void:
  root.size = Vector2i(760, 220)
  application = ClassDB.instantiate("FabricApplication")
  application.name = "PointerDocumentHoverApplication"
  application.set("bundle_path", "res://build/pointer-document-hover-" + flag_mode + ".js")
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
  for kind: String in ["all", "doc", "element", "doc-capture-only", "element-capture-only"]:
    await hover_case(kind)
  await touch_case()
  await sentinel_case()
  await isolation()
  await removal()
  stages.lateOverride = js("rejectLateOverride()")
  check(stages.lateOverride is String and not stages.lateOverride.is_empty() and state().flags.imperative == imperative and state().flags.nativeDispatch == native_dispatch,
    "flags/Late override is rejected and cannot toggle the native responder or public method contract")
  stages.beforeStop = {"application": native(application), "react": state()}
  check(stages.beforeStop.application.errors.is_empty(), "errors/Healthy hover matrix has no hidden query dispatch or responder diagnostics")
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
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var report := {"scenario": "native-pointer-document-hover-four-flags", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "flagMode": flag_mode, "interestMode": interest_mode, "captureRequested": capture,
    "checks": checks, "failures": failures, "stages": stages, "captures": captures, "afterStop": stopped, "allAssertionsPassed": failures.is_empty(),
    "scope": {"actualNativeInput": true, "realOriginalDocuments": true, "experimentalNativeDispatch": true,
      "listenerRegistryMirrored": false, "manualDispatchIsOnlyInstallationControl": true, "rootStaysInHoverPathInsideRoot": true,
      "publicDefaultEnabled": false, "hardwareCertified": false, "hoverQueryFaultsCertified": false, "explicitCaptureCertified": false}}
  var output := FileAccess.open("res://build/pointer-document-hover-report.json", FileAccess.WRITE)
  if output == null:
    push_error("Cannot save Document hover probe report")
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  print("POINTER_DOCUMENT_HOVER_PASSED: " + str(checks.size()) if failures.is_empty() else "POINTER_DOCUMENT_HOVER_FAILED: " + str(failures.size()))
  quit(0 if failures.is_empty() else 1)
