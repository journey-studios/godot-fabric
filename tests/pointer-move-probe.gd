extends "res://tests/pointer-query-fault-probe.gd"

# Reuse actual input, settling and original context/payload helpers. Never run
# the inherited fault matrix, inject query errors, or manually dispatch Down.
const OFFSETS := [Vector2(12, 4), Vector2(24, 9)]
# Mouse samples stay inside A's View, which spans 20..150 x 20..100 in its root.
const HOVER := Vector2(40, 10)
const PAIR := [Vector2(30, -10), Vector2(50, 15)]
const TARGET_ORIGIN := Vector2(20, 20)

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(PointerMoveProbe." + expression + ")"))

func mount(name: String, position: Vector2) -> void:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = name
  surface.position = position
  surface.size = Vector2(300, 160)
  surface.set("application_path", NodePath("../PointerMoveApplication"))
  surface.set("component_name", "PointerQueryFaultProbe")
  surface.set("initial_props", {"name": name, "probePointerMove": true})
  surface.set_meta("validation_input_device", DEVICE)
  surfaces[name] = surface
  root.add_child(surface)

func drag(name: String, index: int, offset: Vector2) -> void:
  var event := InputEventScreenDrag.new()
  event.device = DEVICE
  event.index = index
  event.position = surfaces[name].position + POINT + offset
  event.pressure = 1.0
  Input.parse_input_event(event)
  await settle()

# A button-less mouse motion. Callers settle explicitly, so two samples can be
# enqueued before one RN event flush.
func hover(name: String, offset: Vector2) -> void:
  var event := InputEventMouseMotion.new()
  event.device = DEVICE
  event.position = surfaces[name].position + POINT + offset
  Input.parse_input_event(event)

func labels_of(value: Dictionary) -> Array:
  return value.events.map(func(row: Dictionary) -> String: return row.label)

func tag_of(value: Dictionary, where: String) -> Variant:
  return value.targetTag if where == "only" else value.panels.A.parentTag

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

func physical_down(name: String, index: int, prefix: String) -> void:
  js("arm(%s,%s)" % [JSON.stringify(name), JSON.stringify(prefix + "/down")])
  var before := native(surfaces[name])
  await inject(name, index)
  var value := touch_only(name, prefix + "/down", "touchstart", "topTouchStart")
  var after := native(surfaces[name])
  check(labels_of(value) == ["touchstart"] and value.raw.size() == 2 and rows_for(value, "topPointerDown").is_empty() and value.panels[name].starts == value.baselineStarts + 1 and value.panels[name].moves == value.baselineMoves and after.commits == before.commits + 1,
    prefix + "/Down emits only the original TouchStart and commits one functional update without counting a move")
  check(value.query.rows.all(func(row: Dictionary) -> bool: return row.action == "delegate" and row.resultKind == "boolean" and not row.result and (row.offset == 34 or row.offset == 35)) and after.pointer.activePointers == 1 and after.pointer.activeTouches == 1,
    prefix + "/Down consults only empty Down Maps and leaves one physical contact held")
  stages[prefix + "/down"] = {"react": value, "before": before, "after": after, "application": native(application)}

# A listener on the hit target runs at phase 2 whichever phase it registered;
# on the parent, capture runs at phase 1 and bubble at phase 3.
func phase_for(where: String, capture_only: bool) -> int:
  return 2 if where == "only" else 1 if capture_only else 3

func delivered_move(row: Dictionary, name: String, phase: int, current_tag: Variant) -> bool:
  return row.type == "pointermove" and row.name == name and row.trusted and row.originalSynthetic and row.originalEvent and row.currentMatches and row.targetMatches and row.globalEventMatches and row.phase == phase and row.currentTag == current_tag and row.pointerId > 0

func manual_move(name: String, prefix: String, label: String, phase: int, current_tag: Variant) -> void:
  js("arm(%s,%s)" % [JSON.stringify(name), JSON.stringify(prefix + "/manual")])
  var result: Dictionary = js("publicControl(%s)" % JSON.stringify(name))
  var value := state()
  check(result.returned and result.cleaned and not result.trusted and result.targetMatches and labels_of(value) == [label] and value.events[0].type == "pointermove" and value.events[0].phase == phase and not value.events[0].trusted and value.events[0].currentMatches and value.events[0].targetMatches and value.events[0].currentTag == current_tag and value.raw.is_empty() and value.query.rows.is_empty() and value.panels[name].moves == value.baselineMoves and context_clean(value),
    prefix + "/Original public untrusted pointermove independently proves the sole listener is installed without native Raw or React increment")
  stages[prefix + "/manual"] = {"result": result, "react": value}

# Expected lookups are [where, offset, result] with where "only" or "parent".
func observed_rows(value: Dictionary) -> Array:
  return value.query.rows.map(func(row: Dictionary) -> Array: return [row.targetTag, int(row.offset), row.result, row.rootHandle])

func expected_rows(value: Dictionary, rows: Array) -> Array:
  return rows.map(func(row: Array) -> Array: return [tag_of(value, row[0]), row[1], row[2], false])

func healthy_lookups(value: Dictionary) -> bool:
  return value.query.rows.all(func(row: Dictionary) -> bool: return row.action == "delegate" and not row.matched and row.resultKind == "boolean")

# One real drag sample. Delivery, the pointer Raw pair, the React move counter
# and the move-offset lookups depend on native Move interest; TouchMove and the
# native counters do not.
func move_sample(name: String, index: int, prefix: String, offset: Vector2, label: String, rows: Array, phase: int, where: String) -> void:
  js("arm(%s,%s)" % [JSON.stringify(name), JSON.stringify(prefix)])
  var before := native(surfaces[name])
  await drag(name, index, offset)
  var value := state()
  var after := native(surfaces[name])
  var callbacks: Array = normal_rows(value, label)
  var delivery_check := prefix + "/Native move delivers exactly the qualified original pointermove callback"
  var raw_check := prefix + "/Pointer move Raw appears once per channel with the exact callback payload"
  var react_check := prefix + "/Each delivered move commits one functional React increment"
  var query_check := prefix + "/Native move consults the original pointermove Maps at the exact pinned offsets"
  expected_original_failures.append_array([delivery_check, raw_check, react_check, query_check])
  check(labels_of(value) == [label] and callbacks.size() == 1 and delivered_move(callbacks[0], name, phase, tag_of(value, where)) and callbacks[0].pointerType == "touch" and callbacks[0].buttons == 1 and callbacks[0].currentPriority == (value.continuousPriority if value.priorityMappingFixed else value.defaultPriority),
    delivery_check)
  check(exact_raw(value, "topPointerMove", label), raw_check)
  check(value.panels[name].moves == value.baselineMoves + 1 and after.commits == before.commits + 1 and value.panels[name].starts == value.baselineStarts,
    react_check)
  check(observed_rows(value) == expected_rows(value, rows) and healthy_lookups(value), query_check)
  var touch_raw := rows_for(value, "topTouchMove")
  check(touch_raw.size() == 2 and touch_raw[0].channel == "typed" and touch_raw[1].channel == "star" and touch_raw[0].payloadId == touch_raw[1].payloadId and context_clean(value),
    prefix + "/Original TouchMove Raw survives once per channel independently of pointer interest")
  check(after.pointer.pointerMoves == before.pointer.pointerMoves + 1 and after.pointer.moves == before.pointer.moves + 1 and after.pointer.activePointers == 1 and after.pointer.activeTouches == 1,
    prefix + "/Exactly one actual native pointer and touch move is sampled while the contact stays held")
  stages[prefix] = {"react": value, "before": before, "after": after, "application": native(application)}

func release(name: String, index: int, prefix: String) -> void:
  js("arm(%s,%s)" % [JSON.stringify(name), JSON.stringify(prefix + "/up")])
  var before := native(surfaces[name])
  await inject(name, index, "end")
  var value := touch_only(name, prefix + "/up", "touchend", "topTouchEnd")
  var after := native(surfaces[name])
  check(labels_of(value) == ["touchend"] and rows_for(value, "topPointerUp").is_empty() and rows_for(value, "topPointerMove").is_empty() and value.panels[name].moves == value.baselineMoves and value.query.rows.all(func(row: Dictionary) -> bool: return row.action == "delegate" and not row.result and (row.offset == 36 or row.offset == 37)),
    prefix + "/up/Release consults only empty Up Maps and never retries or delivers a move")
  check(after.pointer.pointerUps == before.pointer.pointerUps + 1 and after.pointer.ends == before.pointer.ends + 1,
    prefix + "/up/Exactly one actual Up and TouchEnd complete the contact")
  clean_contact(name, prefix + "/up")
  stages[prefix + "/up"] = {"react": value, "before": before, "after": after, "application": native(application)}

# where "only" registers on the hit target; "parent" on its original parent View,
# whose Move Maps are read after the target's empty pair.
func move_case(id: String, capture_only: bool, where: String = "only") -> void:
  var prefix := "case/" + id
  var registration: Dictionary = js("configure('A',%s,%s)" % ["true" if capture_only else "false", JSON.stringify(where)])
  var capability: Dictionary = js("capability('A')")
  var panel: Dictionary = state().panels.A
  check(registration.type == "pointermove" and registration.capture == capture_only and registration.targetTag == capability.targetTag and (where == "only" or (registration.listenerTag == panel.parentTag and registration.listenerTag != registration.targetTag)),
    prefix + "/Exactly the requested original Move phase is registered on the actual View ref")
  stages[prefix + "/registration"] = registration
  var label := "pointermove-capture" if capture_only else "pointermove-bubble"
  var phase := phase_for(where, capture_only)
  var current_tag: Variant = capability.targetTag if where == "only" else panel.parentTag
  manual_move("A", prefix, label, phase, current_tag)
  await physical_down("A", 0, prefix)
  var own := [["only", 1, false], ["only", 25, true]] if capture_only else [["only", 1, true]]
  if where == "parent":
    own = [["only", 1, false], ["only", 25, false]] + ([["parent", 1, false], ["parent", 25, true]] if capture_only else [["parent", 1, true]])
  for index in range(OFFSETS.size()):
    await move_sample("A", 0, prefix + "/move-" + str(index + 1), OFFSETS[index], label, own, phase, where)
  await release("A", 0, prefix)

# The exact lookup chain B's native path must produce: its own pair, then its
# parent, then the AppRegistry container, then the owning root handle.
func path_rows(name: String, value: Dictionary) -> Array:
  var container: Array = native(surfaces[name]).nodes.filter(func(node: Dictionary) -> bool: return node.testID == "")
  # JSON numbers stay floats so the rows compare with the observed lookups.
  var tags: Array = [value.targetTag, value.panels[name].parentTag, container[0].tag if container.size() == 1 else -1.0]
  var rows: Array = []
  for tag: Variant in tags:
    rows.append_array([[tag, 1, false, false], [tag, 25, false, false]])
  rows.append_array([[null, 1, false, true], [null, 25, false, true]])
  return rows

# B has no Move listener: its real drag stays a touch-only gesture, and the
# corrected host proves it by consulting false Move pairs along the path.
func sibling_without_listeners() -> void:
  var prefix := "sibling-no-listeners"
  await physical_down("B", 1, prefix)
  js("arm('B',%s)" % JSON.stringify(prefix + "/move"))
  var before := native(surfaces.B)
  await drag("B", 1, OFFSETS[0])
  var value := state()
  var after := native(surfaces.B)
  check(value.events.is_empty() and rows_for(value, "topPointerMove").is_empty() and value.panels.B.moves == value.baselineMoves and after.commits == before.commits and rows_for(value, "topTouchMove").size() == 2 and after.pointer.pointerMoves == before.pointer.pointerMoves + 1,
    prefix + "/move/B drag without Move listeners delivers no pointer move while TouchMove and the native sample survive")
  var query_check := prefix + "/move/B's own Move Maps are consulted false before its parent container and root in path order"
  expected_original_failures.append(query_check)
  var sequences: Array = value.query.rows.map(func(row: Dictionary) -> int: return int(row.sequence))
  var ordered := true
  for index in range(1, sequences.size()):
    ordered = ordered and sequences[index - 1] < sequences[index]
  check(observed_rows(value) == path_rows("B", value) and healthy_lookups(value) and ordered, query_check)
  stages[prefix + "/move"] = {"react": value, "before": before, "after": after, "application": native(application), "expectedRows": path_rows("B", value)}
  await release("B", 1, prefix)

# RN's PointerEventsProcessor emits every Cancel regardless of listeners, so this
# control cannot discriminate Move interest; it guards cleanup and the listener.
func cancel_control() -> void:
  var prefix := "cancel-is-not-move"
  js("configure('A',false)")
  await physical_down("A", 0, prefix)
  js("arm('A',%s)" % JSON.stringify(prefix + "/cancel"))
  var before := native(surfaces.A)
  await inject("A", 0, "cancel")
  var value := touch_only("A", prefix, "touchcancel", "topTouchCancel")
  var after := native(surfaces.A)
  check(labels_of(value) == ["touchcancel"] and value.raw.size() == 2 and rows_for(value, "topPointerMove").is_empty() and value.query.rows.is_empty() and value.panels.A.moves == value.baselineMoves and after.commits == before.commits,
    prefix + "/Actual Cancel is emitted without interest lookups and never invokes the registered Move listener")
  check(after.pointer.pointerCancels == before.pointer.pointerCancels + 1 and after.pointer.cancels == before.pointer.cancels + 1,
    prefix + "/One actual Cancel completes pointer and touch")
  clean_contact("A", prefix)
  stages[prefix + "/cancel"] = {"react": value, "before": before, "after": after, "application": native(application)}

# Mouse motion without buttons and without any held contact. A unique move is
# Continuous, so the pinned mapping gives Default; a plain Unspecified move with
# no ContinuousStart outstanding would run at Discrete. The host flushes RN's
# event queue synchronously after every input event, so RN's unique-move
# coalescing never finds a pending move: Godot's input accumulation (on by
# default) merges samples within a frame, and without it each sample dispatches.
func mouse_cases() -> void:
  var accumulated := Input.use_accumulated_input
  js("configure('A',false)")
  var label := "pointermove-bubble"
  for id: String in ["hover", "accumulated", "unaccumulated"]:
    var prefix := "mouse/" + id
    Input.use_accumulated_input = id != "unaccumulated"
    js("arm('A',%s)" % JSON.stringify(prefix))
    var before := native(surfaces.A)
    var samples: Array = [HOVER] if id == "hover" else PAIR
    for offset: Vector2 in samples:
      hover("A", offset)
    await settle()
    var value := state()
    var after := native(surfaces.A)
    var callbacks: Array = normal_rows(value, label)
    var delivered: Array = samples.slice(-1) if id != "unaccumulated" else samples
    var points: Array = delivered.map(func(offset: Vector2) -> Array: return [POINT.x + offset.x - TARGET_ORIGIN.x, POINT.y + offset.y - TARGET_ORIGIN.y])
    var delivery_check := prefix + "/Native mouse moves deliver trusted pointermove callbacks at the dispatched samples with the unique Continuous priority"
    var raw_check := prefix + "/Pointer move Raw appears once per channel with the exact callback payload"
    var react_check := prefix + "/Each delivered move commits one functional React increment"
    var query_check := prefix + "/Native move consults the original pointermove Maps at the exact pinned offsets"
    expected_original_failures.append_array([delivery_check, raw_check, react_check, query_check])
    var exact: bool = labels_of(value) == delivered.map(func(_offset: Vector2) -> String: return label) and callbacks.size() == delivered.size() and value.defaultPriority != value.discretePriority and before.pointer.activePointers == 0
    for index in range(callbacks.size()):
      var row: Dictionary = callbacks[index]
      exact = exact and delivered_move(row, "A", 2, value.targetTag) and row.pointerType == "mouse" and row.buttons == 0 and [row.offsetX, row.offsetY] == points[index] and row.currentPriority == (value.continuousPriority if value.priorityMappingFixed else value.defaultPriority) and (index == 0 or callbacks[index - 1].sequence < row.sequence)
    check(exact, delivery_check)
    var raw := rows_for(value, "topPointerMove")
    var raw_exact: bool = raw.size() == 2 * callbacks.size() and rows_for(value, "topTouchMove").is_empty() and not callbacks.is_empty()
    for index in range(callbacks.size()):
      raw_exact = raw_exact and raw[2 * index].channel == "typed" and raw[2 * index + 1].channel == "star" and raw[2 * index].payloadId == raw[2 * index + 1].payloadId and callbacks[index].payloadId == raw[2 * index].payloadId and raw[2 * index + 1].sequence < callbacks[index].sequence and callbacks[index].timeStamp == raw[2 * index].timeStamp
    check(raw_exact, raw_check)
    check(value.panels.A.moves == value.baselineMoves + delivered.size() and after.commits == before.commits + delivered.size(), react_check)
    check(observed_rows(value) == expected_rows(value, delivered.map(func(_offset: Vector2) -> Array: return ["only", 1, true])) and healthy_lookups(value), query_check)
    check(after.pointer.pointerMoves == before.pointer.pointerMoves + delivered.size() and after.pointer.activePointers == 0 and after.pointer.activeTouches == 0 and after.pointer.moves == before.pointer.moves and context_clean(value),
      prefix + "/Each dispatched mouse sample reaches the native adapter as hover without a contact or touch move")
    stages[prefix] = {"react": value, "before": before, "after": after, "application": native(application), "accumulated": Input.use_accumulated_input,
      "samples": samples.map(func(offset: Vector2) -> Array: return [offset.x, offset.y]), "points": points}
  Input.use_accumulated_input = accumulated

var fault_errors: Array = []

func container_tag(name: String) -> Variant:
  var container: Array = native(surfaces[name]).nodes.filter(func(node: Dictionary) -> bool: return node.testID == "")
  return container[0].tag if container.size() == 1 else -1.0

# One drag sample in the fault application. own lists the target's lookups as
# [offset, action, result]; an undelivered sample then reads the parent, the
# AppRegistry container and the root, each 1 then 25 and false. A retained
# cause adds one diagnostic; otherwise the failure is only counted.
func move_fault_sample(name: String, index: int, prefix: String, offset: Vector2, own: Array, delivered: bool, retained_cause: String, suppressed_delta: int) -> void:
  var errors_before: Array = native(application).errors
  var suppressed_before: int = int(native(application).pointerListenerQuerySuppressed)
  js("arm(%s,%s)" % [JSON.stringify(name), JSON.stringify(prefix)])
  var before := native(surfaces[name])
  await drag(name, index, offset)
  var value := state()
  var after := native(surfaces[name])
  var app := native(application)
  var expected: Array = own.map(func(entry: Array) -> Array: return [value.targetTag, entry[0], entry[1], 1.0 if entry[1] == "nonboolean" else entry[2], false])
  if not delivered:
    for tag: Variant in [value.panels[name].parentTag, container_tag(name)]:
      expected.append_array([[tag, 1, "delegate", false, false], [tag, 25, "delegate", false, false]])
    expected.append_array([[null, 1, "delegate", false, true], [null, 25, "delegate", false, true]])
  var rows: Array = value.query.rows.map(func(row: Dictionary) -> Array: return [row.targetTag, int(row.offset), row.action, row.result, row.rootHandle])
  var moves := 1 if delivered else 0
  check(rows == expected and value.events.size() == moves and value.panels[name].moves == value.baselineMoves + moves and after.commits == before.commits + moves and rows_for(value, "topPointerMove").size() == 2 * moves and rows_for(value, "topTouchMove").size() == 2 and context_clean(value),
    prefix + "/A Move lookup fault rejects only its own lookup and the remaining path decides delivery")
  var errors_after: Array = app.errors
  var retained: bool = errors_after.size() == errors_before.size() + (0 if retained_cause.is_empty() else 1)
  if not retained_cause.is_empty():
    retained = retained and str(errors_after[-1]).begins_with("E_POINTER_LISTENER_QUERY: ") and str(errors_after[-1]).contains(retained_cause)
    fault_errors.append(retained_cause)
  check(retained and int(app.pointerListenerQuerySuppressed) == suppressed_before + suppressed_delta,
    prefix + "/Repeated Move failures retain one diagnostic per distinct cause and only count the rest")
  stages[prefix] = {"react": value, "before": before, "after": after, "errorsBefore": errors_before.size(), "errorsAfter": errors_after.size(),
    "suppressedBefore": suppressed_before, "suppressedAfter": int(app.pointerListenerQuerySuppressed)}

# A second application keeps the healthy probe above diagnostic-free. Move
# lookups run on every sample, so a failing lookup must not report every time.
func move_fault_controls() -> void:
  application = ClassDB.instantiate("FabricApplication")
  application.name = "PointerMoveApplication"
  application.set("bundle_path", "res://build/pointer-move-enabled.js")
  root.add_child(application)
  mount("A", Vector2.ZERO)
  mount("B", Vector2(340, 0))
  await settle()
  var app := native(application)
  check(app.rootCount == 2 and app.pointerListenerQueryInstalled and app.errors.is_empty() and int(app.pointerListenerQuerySuppressed) == 0 and native(surfaces.A).runtimeId == native(surfaces.B).runtimeId,
    "fault/mount/A second application mounts two fresh roots and one SDK query without diagnostics")
  var cause := "GF pointer query deliberate fault: "
  # One throwing bubble lookup repeated over three samples, then recovery.
  js("configure('A',false)")
  stages["fault/repeat-throw1/fault"] = js("fault('A',1,'throw','move1',3)")
  await physical_down("A", 0, "fault/repeat-throw1")
  for index in range(3):
    await move_fault_sample("A", 0, "fault/repeat-throw1/move-" + str(index + 1), OFFSETS[index % 2], [[1, "throw", null], [25, "delegate", false]], false, cause + "move1" if index == 0 else "", 0 if index == 0 else 1)
  await move_fault_sample("A", 0, "fault/repeat-throw1/recovery", OFFSETS[1], [[1, "delegate", true]], true, "", 0)
  await release("A", 0, "fault/repeat-throw1")
  # A capture-only listener whose capture lookup returns a non-boolean twice.
  js("configure('A',true)")
  stages["fault/repeat-nonboolean25/fault"] = js("fault('A',25,'nonboolean','move25',2)")
  await physical_down("A", 0, "fault/repeat-nonboolean25")
  for index in range(2):
    await move_fault_sample("A", 0, "fault/repeat-nonboolean25/move-" + str(index + 1), OFFSETS[index], [[1, "delegate", false], [25, "nonboolean", null]], false, "Pointer listener query must return a boolean" if index == 0 else "", 0 if index == 0 else 1)
  await move_fault_sample("A", 0, "fault/repeat-nonboolean25/recovery", OFFSETS[0], [[1, "delegate", false], [25, "delegate", true]], true, "", 0)
  await release("A", 0, "fault/repeat-nonboolean25")
  # Distinct causes are retained until 16 distinct Move failures are held.
  js("configure('A',false)")
  await physical_down("A", 0, "fault/distinct-cap")
  for index in range(15):
    var label := "cap-%02d" % (index + 1)
    stages["fault/distinct-cap/" + label + "/fault"] = js("fault('A',1,'throw',%s,1)" % JSON.stringify(label))
    var kept := index < 14
    await move_fault_sample("A", 0, "fault/distinct-cap/" + label, OFFSETS[index % 2], [[1, "throw", null], [25, "delegate", false]], false, cause + label if kept else "", 0 if kept else 1)
  stages["fault/cleared"] = js("clearFault()")
  await release("A", 0, "fault/distinct-cap")
  js("configure('B',false)")
  await physical_down("B", 1, "fault/B-healthy")
  await move_fault_sample("B", 1, "fault/B-healthy/move", OFFSETS[0], [[1, "delegate", true]], true, "", 0)
  await release("B", 1, "fault/B-healthy")
  stages["fault/beforeStop"] = {"application": native(application), "react": state()}
  application.call("stop")
  await settle()
  var stopped := native(application)
  stages["fault/stopped"] = stopped
  var retained: bool = stopped.errors.size() == fault_errors.size() and fault_errors.size() == 16
  for index in range(mini(stopped.errors.size(), fault_errors.size())):
    retained = retained and str(stopped.errors[index]).contains(fault_errors[index])
  check(stopped.stopped and not stopped.pointerListenerQueryInstalled and stopped.rootCount == 0 and stopped.pendingWork == 0 and stopped.pointerProcessor.active == 0 and stopped.pointerRouting.contacts == 0 and stopped.pointerRouting.stored == 0 and retained and int(stopped.pointerListenerQuerySuppressed) == 4,
    "fault/stop/The second application retains one diagnostic per distinct Move failure up to the bound and counts four repeats")
  for name: String in ["A", "B"]:
    surfaces[name].queue_free()
  application.queue_free()
  await settle()

# The orange Move bar starts at x160 and spans 20px plus 4px per delivered move,
# so its last orange and first background pixels pin the exact count.
func capture_frame(filename: String, updated: bool) -> void:
  if not capture or DisplayServer.get_name() == "headless":
    return
  await RenderingServer.frame_post_draw
  var image := root.get_texture().get_image()
  var saved := image.save_png("res://build/" + filename)
  var pixels: Array = []
  for origin: Vector2i in [Vector2i.ZERO, Vector2i(340, 0)]:
    var moves := 2 if updated and origin == Vector2i.ZERO else 0
    var points := [Vector2i(5, 5), Vector2i(75, 55), Vector2i(165, 125), Vector2i(179 + 4 * moves, 125), Vector2i(180 + 4 * moves, 125)]
    var colors := ["0f172aff", "2563ebff", "f97316ff", "f97316ff", "0f172aff"]
    for index in range(points.size()):
      var point: Vector2i = origin + points[index]
      var actual := image.get_pixelv(point).to_html()
      check(actual == colors[index], "move-capture/" + filename + "/Actual native pixel " + str(point) + " matches the committed Move counter")
      pixels.append({"point": [point.x, point.y], "color": actual, "expected": colors[index]})
  var counters: Dictionary = state().panels
  var expected_moves := 2 if updated else 0
  check(counters.A.moves == expected_moves and counters.B.moves == 0,
    "move-capture/" + filename + "/Actual React Move counters match the exact native captured stage")
  check(saved == OK and image.get_width() == 680 and image.get_height() == 160,
    "move-capture/" + filename + "/Actual native viewport is saved at the scenario dimensions")
  captures.append({"file": "build/" + filename, "width": image.get_width(), "height": image.get_height(), "pixels": pixels,
    "reactCounters": counters, "expectedReactCounters": {"A": {"moves": expected_moves}, "B": {"moves": 0}}})

func _initialize() -> void:
  allow_original_negative = OS.get_cmdline_user_args().has("--allow-original-negative")
  capture = OS.get_cmdline_user_args().has("--capture")
  call_deferred("run_probe")

func run_probe() -> void:
  root.size = Vector2i(680, 160)
  application = ClassDB.instantiate("FabricApplication")
  application.name = "PointerMoveApplication"
  application.set("bundle_path", "res://build/pointer-move-enabled.js")
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
  await capture_frame("pointer-move-initial.png", false)
  await move_case("bubble", false)
  await capture_frame("pointer-move-updated.png", true)
  await move_case("capture-only", true)
  await move_case("ancestor-bubble", false, "parent")
  await move_case("ancestor-capture", true, "parent")
  await sibling_without_listeners()
  await cancel_control()
  await mouse_cases()
  stages.beforeStop = {"application": native(application), "react": state()}
  check(stages.beforeStop.application.errors.is_empty(), "cleanup/No query dispatch or responder diagnostic was hidden")
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
  # The preceding host never consults Move Maps, so its fault phase is moot.
  if not allow_original_negative:
    await move_fault_controls()
  check_hover_lookups()
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var observed := failures.duplicate()
  var expected := expected_original_failures.duplicate()
  observed.sort()
  expected.sort()
  var original_negative_observed := allow_original_negative and observed == expected and not failures.is_empty()
  var report := {"scenario": "native-pointer-move-view-interest", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "captureRequested": capture, "captures": captures,
    "checks": checks, "stages": stages, "afterStop": stopped,
    "expectedOriginalFailures": expected_original_failures, "allowOriginalNegative": allow_original_negative,
    "faultExpectedErrors": fault_errors,
    "originalNegativeObserved": original_negative_observed, "allCurrentAssertionsPassed": failures.is_empty(),
    "scope": {"actualNativeInput": true, "originalFlagsEnabled": true, "experimentalNativeDispatch": true,
      "realSDKQueryWrappedOnlyForTest": true, "listenerRegistryMirrored": false, "pointerMoveOnlyViewScope": true,
      "ancestorPropagationCertified": true, "mouseHoverMoveCertified": true, "rnQueueCoalescingReachable": false,
      "documentInterestCertified": false, "hoverEventsCertified": false, "moveQueryFaultsCertified": not allow_original_negative,
      "publicAPIAdded": false, "publicDefaultEnabled": false, "hardwareCertified": false}}
  var output := FileAccess.open("res://build/pointer-move-report.json", FileAccess.WRITE)
  if not check(output != null, "report/PointerMove report is saved with visible normative failures"):
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  print("POINTER_MOVE_ORIGINAL_NEGATIVE: " + str(failures.size()) if original_negative_observed else "POINTER_MOVE_PASSED: " + str(checks.size()) if failures.is_empty() else "POINTER_MOVE_FAILED")
  quit(0 if failures.is_empty() or original_negative_observed else 1)
