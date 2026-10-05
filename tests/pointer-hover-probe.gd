extends "res://tests/pointer-move-probe.gd"

# Imperative View hover listeners on the actual two-root scene. A button-less
# mouse moves between the empty surface area (no hit target in this host), A's
# target and back. Reuses the Move probe's mount, row and capture helpers.
const NO_HIT := Vector2(250, 60)
const IN := Vector2(75, 55)
const IN_AGAIN := Vector2(95, 65)
# The fault application runs only on the corrected host; its checks are never
# part of the preceding-host control.
var in_fault_phase := false

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(PointerHoverProbe." + expression + ")"))

func mount(name: String, position: Vector2) -> void:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = name
  surface.position = position
  surface.size = Vector2(300, 160)
  surface.set("application_path", NodePath("../PointerHoverApplication"))
  surface.set("component_name", "PointerQueryFaultProbe")
  surface.set("initial_props", {"name": name, "probePointerMove": true, "probePointerHover": true})
  surface.set_meta("validation_input_device", DEVICE)
  surfaces[name] = surface
  root.add_child(surface)

func mouse_to(name: String, point: Vector2) -> void:
  var event := InputEventMouseMotion.new()
  event.device = DEVICE
  event.position = surfaces[name].position + point
  Input.parse_input_event(event)
  await settle()

# Symbolic path tags: T target, P its parent, C the AppRegistry container, R
# the owning root handle (no public tag).
func tags(name: String, value: Dictionary) -> Dictionary:
  return {"T": value.panels[name].tag, "P": value.panels[name].parentTag, "C": container_tag(name), "R": null}

# state() moves every hover lookup to query.hoverRows (see HOVER_OFFSETS).
func hover_rows(value: Dictionary) -> Array:
  return value.query.hoverRows.map(func(row: Dictionary) -> Array: return [row.targetTag, int(row.offset), row.result, row.rootHandle])

func healthy_hover_lookups(value: Dictionary) -> bool:
  return value.query.hoverRows.all(func(row: Dictionary) -> bool: return row.action == "delegate" and not row.matched and row.resultKind == "boolean")

func expected_hover_rows(name: String, value: Dictionary, rows: Array) -> Array:
  var map := tags(name, value)
  return rows.map(func(row: Array) -> Array: return [map[row[0]], row[1], row[2], row[0] == "R"])

# Expected callbacks are [label, phase, targetKey, currentKey].
func expected_events(name: String, value: Dictionary, events: Array) -> Array:
  var map := tags(name, value)
  return events.map(func(event: Array) -> Array: return [event[0], float(event[1]), map[event[2]], map[event[3]]])

func observed_events(value: Dictionary) -> Array:
  return value.events.map(func(row: Dictionary) -> Array: return [row.label, row.phase, row.targetTag, row.currentTag])

func hover_type(label: String) -> String:
  return label.split("-")[0]

const RAW_TYPES := {"pointerover": "topPointerOver", "pointerenter": "topPointerEnter", "pointerout": "topPointerOut", "pointerleave": "topPointerLeave"}

# The Move walk on a hit reads each node that has a public instance, 1 then 25.
func expected_move_rows(name: String, value: Dictionary, nodes: Array) -> Array:
  var map := tags(name, value)
  var rows: Array = []
  for node: String in nodes:
    rows.append_array([[map[node], 1, false, node == "R"], [map[node], 25, false, node == "R"]])
  return rows

# One real mouse transition. Delivery, hover Raw and hover lookups depend on
# native hover interest; the native sample and Move lookups do not.
func transition(name: String, prefix: String, point: Vector2, events: Array, rows: Array, move_nodes: Array, samples: int = 1) -> void:
  js("arm(%s,%s)" % [JSON.stringify(name), JSON.stringify(prefix)])
  var before := native(surfaces[name])
  await mouse_to(name, point)
  var value := state()
  var after := native(surfaces[name])
  var delivery_check := prefix + "/Native hover delivers exactly the qualified original callbacks in RN order phase and target"
  var raw_check := prefix + "/Hover Raw appears once per channel and dispatched event with each callback's payload"
  var query_check := prefix + "/Native hover consults the original hover Maps at the exact pinned offsets and nodes"
  if not events.is_empty() and not in_fault_phase:
    expected_original_failures.append_array([delivery_check, raw_check])
  if not rows.is_empty() and not in_fault_phase:
    expected_original_failures.append(query_check)
  var exact: bool = observed_events(value) == expected_events(name, value, events) and value.events.all(func(row: Dictionary) -> bool:
    return row.trusted and row.originalEvent and row.originalSynthetic and row.currentMatches and row.globalEventMatches and row.type == hover_type(row.label) and row.pointerType == "mouse" and row.buttons == 0 and row.currentPriority == value.discretePriority)
  check(exact, delivery_check)
  # Each dispatched hover event has its own typed/star pair, in callback order.
  var hover_raw: Array = value.raw.filter(func(row: Dictionary) -> bool: return row.type in ["topPointerOver", "topPointerEnter", "topPointerOut", "topPointerLeave"])
  # Compared with the expected dispatches, so an undelivered event cannot pass.
  var pairs: bool = hover_raw.size() == 2 * events.size() and value.events.size() == events.size()
  for index in range(value.events.size()):
    if not pairs:
      break
    var typed: Dictionary = hover_raw[2 * index]
    var star: Dictionary = hover_raw[2 * index + 1]
    var row: Dictionary = value.events[index]
    pairs = typed.channel == "typed" and star.channel == "star" and typed.payloadId == star.payloadId and row.payloadId == typed.payloadId and typed.type == RAW_TYPES[hover_type(row.label)] and star.sequence < row.sequence and row.timeStamp == typed.timeStamp
  check(pairs if not events.is_empty() else hover_raw.is_empty(), raw_check)
  check(hover_rows(value) == expected_hover_rows(name, value, rows) and healthy_lookups(value) and healthy_hover_lookups(value), query_check)
  var moves: Array = value.query.rows.filter(func(row: Dictionary) -> bool: return int(row.offset) == 1 or int(row.offset) == 25).map(func(row: Dictionary) -> Array: return [row.targetTag, int(row.offset), row.result, row.rootHandle])
  check(moves == expected_move_rows(name, value, move_nodes) and rows_for(value, "topPointerMove").is_empty() and context_clean(value) and after.commits == before.commits,
    prefix + "/The same sample reads only false Move pairs on a hit and changes no React state")
  # The first sample into a surface away from any hit creates no native pointer.
  check(after.pointer.pointerMoves == before.pointer.pointerMoves + samples and after.pointer.activePointers == 0 and after.pointer.activeTouches == 0,
    prefix + "/Each counted button-less native sample holds no contact")
  stages[prefix] = {"react": value, "before": before, "after": after, "application": native(application)}

# Manual original dispatch at the target: over/out bubble, enter/leave do not.
func manual_hover(name: String, prefix: String, expected: Dictionary) -> void:
  var results := {}
  for type: String in ["pointerover", "pointerenter", "pointerout", "pointerleave"]:
    js("arm(%s,%s)" % [JSON.stringify(name), JSON.stringify(prefix + "/manual/" + type)])
    var result: Dictionary = js("publicControl(%s,%s)" % [JSON.stringify(name), JSON.stringify(type)])
    var value := state()
    var want: Array = expected[type]
    check(result.returned and result.cleaned and not result.trusted and result.targetMatches and observed_events(value) == expected_events(name, value, want) and value.events.all(func(row: Dictionary) -> bool: return not row.trusted and row.type == type) and value.raw.is_empty() and value.query.rows.is_empty() and value.query.hoverRows.is_empty() and context_clean(value),
      prefix + "/manual/" + type + "/Original public untrusted " + type + " follows its own bubbling rule without native Raw or lookups")
    results[type] = {"result": result, "react": value}
  stages[prefix + "/manual"] = results

func hover_case(id: String, capture_only: bool, where: String, manual: Dictionary, enter: Array, enter_rows: Array, leave: Array, leave_rows: Array, first: bool = false) -> void:
  var prefix := "case/" + id
  var registration: Dictionary = js("configure('A',%s,%s)" % ["true" if capture_only else "false", JSON.stringify(where)])
  check(registration.capture == capture_only and registration.type == ["pointerover", "pointerenter", "pointerout", "pointerleave"] and (where == "only" or registration.listenerTag == state().panels.A.parentTag),
    prefix + "/Exactly the requested original hover listeners are registered on the actual View ref")
  stages[prefix + "/registration"] = registration
  manual_hover("A", prefix, manual)
  await transition("A", prefix + "/start", NO_HIT, [], [], [], 0 if first else 1)
  await transition("A", prefix + "/enter", IN, enter, enter_rows, ["T", "P", "C", "R"])
  await transition("A", prefix + "/inside", IN_AGAIN, [], [], ["T", "P", "C", "R"])
  await transition("A", prefix + "/leave", NO_HIT, leave, leave_rows, [])

# A touch is a direct pointer without hover: RN enters its path in the Down,
# before the Down emission, and leaves it after the Up emission because a
# released touch leaves the device (shouldLeaveWhenReleased).
func touch_phase(prefix: String, phase: String, events: Array, rows: Array) -> void:
  var start := phase == "start"
  var touch := "touchstart" if start else "touchend"
  var category := [34, 35] if start else [36, 37]
  js("arm('A',%s)" % JSON.stringify(prefix))
  var before := native(surfaces.A)
  await inject("A", 0, phase)
  var value := state()
  var after := native(surfaces.A)
  var app := native(application)
  var delivery_check := prefix + "/Touch hover delivers exactly the qualified original callbacks before the touch event"
  var raw_check := prefix + "/Touch hover Raw appears once per channel and dispatched event with each callback's payload"
  var query_check := prefix + "/Touch hover consults the original hover Maps at the exact pinned offsets and nodes"
  expected_original_failures.append_array([delivery_check, raw_check, query_check])
  var labels: Array = events.map(func(event: Array) -> String: return event[0])
  labels.append(touch)
  var hover_events: Array = value.events.filter(func(row: Dictionary) -> bool: return row.label != touch)
  check(labels_of(value) == labels and hover_events.map(func(row: Dictionary) -> Array: return [row.label, row.phase, row.targetTag, row.currentTag]) == expected_events("A", value, events) and hover_events.all(func(row: Dictionary) -> bool:
    return row.trusted and row.originalEvent and row.originalSynthetic and row.currentMatches and row.globalEventMatches and row.type == hover_type(row.label) and row.pointerType == "touch" and row.buttons == (1 if start else 0) and row.currentPriority == value.discretePriority),
    delivery_check)
  var hover_raw: Array = value.raw.filter(func(row: Dictionary) -> bool: return row.type in RAW_TYPES.values())
  var pairs: bool = hover_raw.size() == 2 * events.size() and hover_events.size() == events.size()
  for index in range(hover_events.size()):
    if not pairs:
      break
    var typed: Dictionary = hover_raw[2 * index]
    var star: Dictionary = hover_raw[2 * index + 1]
    var row: Dictionary = hover_events[index]
    pairs = typed.channel == "typed" and star.channel == "star" and typed.payloadId == star.payloadId and row.payloadId == typed.payloadId and typed.type == RAW_TYPES[hover_type(row.label)] and star.sequence < row.sequence and row.timeStamp == typed.timeStamp
  check(pairs, raw_check)
  check(hover_rows(value) == expected_hover_rows("A", value, rows) and healthy_hover_lookups(value), query_check)
  # Hover callbacks carry the Down's pressed button and the Up's released state.
  # No Down/Up listener exists: the touch's own lookups stay false, after the
  # hover entry in the Down and before the hover exit in the Up.
  var own: Array = value.query.rows
  var ordered: bool = value.query.hoverRows.all(func(row: Dictionary) -> bool: return own.all(func(other: Dictionary) -> bool: return (row.sequence < other.sequence) == start))
  check(not own.is_empty() and own.all(func(row: Dictionary) -> bool: return int(row.offset) in category and row.action == "delegate" and row.resultKind == "boolean" and not row.result) and ordered,
    prefix + "/The touch's own " + ("Down" if start else "Up") + " lookups stay false " + ("after the hover entry" if start else "before the hover exit"))
  check(exact_raw(value, "topTouchStart" if start else "topTouchEnd", touch) and context_clean(value),
    prefix + "/The original " + touch + " keeps its own Raw pair after the hover callbacks")
  var held := 1 if start else 0
  # The idle mouse keeps its own routing entry, so only active routes count.
  check(after.pointer.activeTouches == held and after.pointer.activePointers == held and app.pointerProcessor.active == held and app.pointerProcessor.hover == held and app.pointerRouting.active == held,
    prefix + "/The touch holds one hover path while pressed and none after release")
  stages[prefix] = {"react": value, "before": before, "after": after, "application": app}

func touch_hover_case() -> void:
  var prefix := "touch/target-bubble"
  var registration: Dictionary = js("configure('A',false,'only')")
  check(registration.capture == false and registration.type == ["pointerover", "pointerenter", "pointerout", "pointerleave"],
    prefix + "/Exactly the requested original hover listeners are registered on the actual View ref")
  stages[prefix + "/registration"] = registration
  await touch_phase(prefix + "/down", "start", [["pointerover-bubble", 2, "T", "T"], ["pointerenter-bubble", 2, "T", "T"]],
    [["T", 26, true], ["R", 23, false], ["R", 0, false], ["C", 23, false], ["C", 0, false], ["P", 23, false], ["P", 0, false], ["T", 23, false], ["T", 0, true]])
  await touch_phase(prefix + "/up", "end", [["pointerout-bubble", 2, "T", "T"], ["pointerleave-bubble", 2, "T", "T"]],
    [["T", 27, true], ["R", 24, false], ["R", 2, false], ["C", 24, false], ["C", 2, false], ["P", 24, false], ["P", 2, false], ["T", 24, false], ["T", 2, true]])

var fault_errors_hover: Array = []

# The Over lookup on A's target throws, so the remaining path is read and no
# over is dispatched; enter qualifies through its own lookups.
func transition_fault(name: String, prefix: String, rows: Array) -> void:
  js("arm(%s,%s)" % [JSON.stringify(name), JSON.stringify(prefix)])
  var before := native(surfaces[name])
  await mouse_to(name, IN)
  var value := state()
  var observed: Array = value.query.hoverRows.map(func(row: Dictionary) -> Array: return [row.targetTag, int(row.offset), row.action, row.result])
  var expected: Array = expected_hover_rows(name, value, rows).map(func(row: Array) -> Array: return [row[0], row[1], "delegate", row[2]])
  expected[0] = [expected[0][0], 26, "throw", null]
  check(observed == expected and observed_events(value) == expected_events(name, value, [["pointerenter-bubble", 2, "T", "T"]]),
    prefix + "/The failed Over lookup is rejected alone and enter still qualifies on its own lookups")
  stages[prefix] = {"react": value, "before": before, "after": native(surfaces[name])}

# A second application: a repeated throwing Over lookup is reported once and
# counted afterwards, like the Move lookups.
func hover_fault_controls() -> void:
  in_fault_phase = true
  application = ClassDB.instantiate("FabricApplication")
  application.name = "PointerHoverApplication"
  application.set("bundle_path", "res://build/pointer-hover-enabled.js")
  root.add_child(application)
  mount("A", Vector2.ZERO)
  mount("B", Vector2(340, 0))
  await settle()
  check(native(application).errors.is_empty() and int(native(application).pointerListenerQuerySuppressed) == 0,
    "fault/mount/A second application starts without diagnostics")
  js("configure('A',false,'only')")
  # One untrusted dispatch materializes the path's public instances, as the
  # healthy application's manual controls did.
  js("arm('A','fault/materialize')")
  stages["fault/materialize"] = js("publicControl('A','pointerover')")
  stages["fault/over26/fault"] = js("fault('A',26,'throw','over26',2)")
  var faulted := [["T", 26, false], ["T", 28, false], ["P", 26, false], ["P", 28, false], ["C", 26, false], ["C", 28, false], ["R", 26, false], ["R", 28, false],
    ["R", 23, false], ["R", 0, false], ["C", 23, false], ["C", 0, false], ["P", 23, false], ["P", 0, false], ["T", 23, false], ["T", 0, true]]
  var leave_rows := [["T", 27, true], ["R", 24, false], ["R", 2, false], ["C", 24, false], ["C", 2, false], ["P", 24, false], ["P", 2, false], ["T", 24, false], ["T", 2, true]]
  var leave_events := [["pointerout-bubble", 2, "T", "T"], ["pointerleave-bubble", 2, "T", "T"]]
  for round in range(2):
    var prefix := "fault/over26/round-" + str(round + 1)
    var errors_before: int = native(application).errors.size()
    var suppressed_before: int = int(native(application).pointerListenerQuerySuppressed)
    await transition_fault("A", prefix + "/enter", faulted)
    var app := native(application)
    var retained: bool = app.errors.size() == errors_before + (1 if round == 0 else 0) and int(app.pointerListenerQuerySuppressed) == suppressed_before + (0 if round == 0 else 1)
    if round == 0:
      retained = retained and str(app.errors[-1]).contains("GF pointer query deliberate fault: over26")
      fault_errors_hover.append("GF pointer query deliberate fault: over26")
    check(retained, prefix + "/A repeated Over lookup failure is retained once and then only counted")
    await transition("A", prefix + "/leave", NO_HIT, leave_events, leave_rows, [])
  await transition("A", "fault/over26/recovery/enter", IN, [["pointerover-bubble", 2, "T", "T"], ["pointerenter-bubble", 2, "T", "T"]],
    [["T", 26, true], ["R", 23, false], ["R", 0, false], ["C", 23, false], ["C", 0, false], ["P", 23, false], ["P", 0, false], ["T", 23, false], ["T", 0, true]], ["T", "P", "C", "R"])
  application.call("stop")
  await settle()
  var stopped := native(application)
  stages["fault/stopped"] = stopped
  check(stopped.stopped and stopped.rootCount == 0 and stopped.errors.size() == 1 and str(stopped.errors[0]).contains("over26") and int(stopped.pointerListenerQuerySuppressed) == 1 and stopped.pointerProcessor.hover == 0,
    "fault/stop/The fault application retains one diagnostic and counts the repeat")
  for name: String in ["A", "B"]:
    surfaces[name].queue_free()
  application.queue_free()
  await settle()

func _initialize() -> void:
  allow_original_negative = OS.get_cmdline_user_args().has("--allow-original-negative")
  call_deferred("run_probe")

func run_probe() -> void:
  root.size = Vector2i(680, 160)
  application = ClassDB.instantiate("FabricApplication")
  application.name = "PointerHoverApplication"
  application.set("bundle_path", "res://build/pointer-hover-enabled.js")
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
  # Listener on the target itself, bubble: everything at phase 2 on T.
  await hover_case("target-bubble", false, "only",
    {"pointerover": [["pointerover-bubble", 2, "T", "T"]], "pointerenter": [["pointerenter-bubble", 2, "T", "T"]],
      "pointerout": [["pointerout-bubble", 2, "T", "T"]], "pointerleave": [["pointerleave-bubble", 2, "T", "T"]]},
    [["pointerover-bubble", 2, "T", "T"], ["pointerenter-bubble", 2, "T", "T"]],
    [["T", 26, true], ["R", 23, false], ["R", 0, false], ["C", 23, false], ["C", 0, false], ["P", 23, false], ["P", 0, false], ["T", 23, false], ["T", 0, true]],
    [["pointerout-bubble", 2, "T", "T"], ["pointerleave-bubble", 2, "T", "T"]],
    [["T", 27, true], ["R", 24, false], ["R", 2, false], ["C", 24, false], ["C", 2, false], ["P", 24, false], ["P", 2, false], ["T", 24, false], ["T", 2, true]], true)
  # A capture listener on the target itself still runs at phase 2.
  await hover_case("target-capture", true, "only",
    {"pointerover": [["pointerover-capture", 2, "T", "T"]], "pointerenter": [["pointerenter-capture", 2, "T", "T"]],
      "pointerout": [["pointerout-capture", 2, "T", "T"]], "pointerleave": [["pointerleave-capture", 2, "T", "T"]]},
    [["pointerover-capture", 2, "T", "T"], ["pointerenter-capture", 2, "T", "T"]],
    [["T", 26, false], ["T", 28, true], ["R", 23, false], ["R", 0, false], ["C", 23, false], ["C", 0, false], ["P", 23, false], ["P", 0, false], ["T", 23, true]],
    [["pointerout-capture", 2, "T", "T"], ["pointerleave-capture", 2, "T", "T"]],
    [["T", 27, false], ["T", 29, true], ["R", 24, false], ["R", 2, false], ["C", 24, false], ["C", 2, false], ["P", 24, false], ["P", 2, false], ["T", 24, true]])
  # Bubble listeners on the parent: over/out bubble to it at phase 3, while
  # enter/leave reach it only as their own target at phase 2.
  await hover_case("parent-bubble", false, "parent",
    {"pointerover": [["pointerover-bubble", 3, "T", "P"]], "pointerenter": [], "pointerout": [["pointerout-bubble", 3, "T", "P"]], "pointerleave": []},
    [["pointerover-bubble", 3, "T", "P"], ["pointerenter-bubble", 2, "P", "P"]],
    [["T", 26, false], ["T", 28, false], ["P", 26, true], ["R", 23, false], ["R", 0, false], ["C", 23, false], ["C", 0, false], ["P", 23, false], ["P", 0, true], ["T", 23, false], ["T", 0, false]],
    [["pointerout-bubble", 3, "T", "P"], ["pointerleave-bubble", 2, "P", "P"]],
    [["T", 27, false], ["T", 29, false], ["P", 27, true], ["R", 24, false], ["R", 2, false], ["C", 24, false], ["C", 2, false], ["P", 24, false], ["P", 2, true], ["T", 24, false], ["T", 2, false]])
  # Capture listeners on the parent: RN emits enter/leave to the parent and,
  # through its capture listener, to the descendant, so capture runs twice.
  await hover_case("parent-capture", true, "parent",
    {"pointerover": [["pointerover-capture", 1, "T", "P"]], "pointerenter": [["pointerenter-capture", 1, "T", "P"]],
      "pointerout": [["pointerout-capture", 1, "T", "P"]], "pointerleave": [["pointerleave-capture", 1, "T", "P"]]},
    [["pointerover-capture", 1, "T", "P"], ["pointerenter-capture", 2, "P", "P"], ["pointerenter-capture", 1, "T", "P"]],
    [["T", 26, false], ["T", 28, false], ["P", 26, false], ["P", 28, true], ["R", 23, false], ["R", 0, false], ["C", 23, false], ["C", 0, false], ["P", 23, true], ["T", 23, false]],
    [["pointerout-capture", 1, "T", "P"], ["pointerleave-capture", 1, "T", "P"], ["pointerleave-capture", 2, "P", "P"]],
    [["T", 27, false], ["T", 29, false], ["P", 27, false], ["P", 29, true], ["R", 24, false], ["R", 2, false], ["C", 24, false], ["C", 2, false], ["P", 24, true], ["T", 24, false]])
  await touch_hover_case()
  # B has no hover listener and has never dispatched an event, so RN never
  # created its AppRegistry container's public instance. The query reads every
  # node that has one, all false, and skips the container without creating it.
  await transition("B", "sibling-no-listeners/start", NO_HIT, [], [], [], 0)
  await transition("B", "sibling-no-listeners/enter", IN, [],
    [["T", 26, false], ["T", 28, false], ["P", 26, false], ["P", 28, false], ["R", 26, false], ["R", 28, false],
      ["R", 23, false], ["R", 0, false], ["P", 23, false], ["P", 0, false], ["T", 23, false], ["T", 0, false]], ["T", "P", "R"])
  check(int(tags("B", state()).C) > 0, "sibling-no-listeners/B's AppRegistry container is a real native node that the query skipped")
  await transition("B", "sibling-no-listeners/leave", NO_HIT, [],
    [["T", 27, false], ["T", 29, false], ["P", 27, false], ["P", 29, false], ["R", 27, false], ["R", 29, false],
      ["R", 24, false], ["R", 2, false], ["P", 24, false], ["P", 2, false], ["T", 24, false], ["T", 2, false]], [])
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
  # The preceding host never consults hover Maps, so its fault phase is moot.
  if not allow_original_negative:
    await hover_fault_controls()
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var observed := failures.duplicate()
  var expected := expected_original_failures.duplicate()
  observed.sort()
  expected.sort()
  var original_negative_observed := allow_original_negative and observed == expected and not failures.is_empty()
  var report := {"scenario": "native-pointer-hover-view-interest", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages, "afterStop": stopped,
    "expectedOriginalFailures": expected_original_failures, "allowOriginalNegative": allow_original_negative,
    "originalNegativeObserved": original_negative_observed, "allCurrentAssertionsPassed": failures.is_empty(),
    "faultExpectedErrors": fault_errors_hover,
    "scope": {"actualNativeInput": true, "originalFlagsEnabled": true, "experimentalNativeDispatch": true,
      "realSDKQueryWrappedOnlyForTest": true, "listenerRegistryMirrored": false, "pointerHoverOnlyViewScope": true,
      "documentInterestCertified": false, "emptyAreaHasNoHitTarget": true, "publicAPIAdded": false, "publicDefaultEnabled": false, "hardwareCertified": false}}
  var output := FileAccess.open("res://build/pointer-hover-report.json", FileAccess.WRITE)
  if not check(output != null, "report/PointerHover report is saved with visible normative failures"):
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  print("POINTER_HOVER_ORIGINAL_NEGATIVE: " + str(failures.size()) if original_negative_observed else "POINTER_HOVER_PASSED: " + str(checks.size()) if failures.is_empty() else "POINTER_HOVER_FAILED")
  quit(0 if failures.is_empty() or original_negative_observed else 1)
