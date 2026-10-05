extends SceneTree

const DEVICE := 1001
var checks: Array = []
var stages: Dictionary = {}
var surfaces: Dictionary = {}
var app: Node
var integration_mode := ""
var deliberate_errors: Array = []
var captures: Array = []
var stop_during_leaf_removal := 0

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

func settle() -> void:
  for index in range(8):
    await process_frame

func capture(label: String) -> void:
  if not "--capture" in OS.get_cmdline_user_args():
    return
  await RenderingServer.frame_post_draw
  var image := root.get_texture().get_image()
  var points := {"only": Vector2i(60, 50), "mixed": Vector2i(185, 55), "pointerOnly": Vector2i(60, 135),
    "first": Vector2i(175, 165), "second": Vector2i(255, 165), "retired": Vector2i(60, 210), "counter": Vector2i(150, 229)}
  var colors := {"only": Color("38bdf8"), "mixed": Color("a78bfa"), "pointerOnly": Color("f59e0b"),
    "first": Color("34d399"), "second": Color("2dd4bf"), "retired": Color("fb7185"), "counter": Color("f8fafc")}
  var pixels: Array = []
  for name: String in ["A", "B"]:
    for id: String in points:
      var point: Vector2i = points[id] + (Vector2i(400, 0) if name == "B" else Vector2i.ZERO)
      var actual := image.get_pixelv(point)
      pixels.append({"name": name, "id": id, "x": point.x, "y": point.y, "actual": actual.to_html(), "expected": colors[id].to_html()})
      check(actual.is_equal_approx(colors[id]), label + "/Native pixel renders JSX target " + name + "/" + id)
  var path := "res://build/event-dispatch-integrated-" + label + ".png"
  check(image.save_png(path) == OK, label + "/Actual Godot frame capture saved")
  captures.append({"stage": label, "width": image.get_width(), "height": image.get_height(), "path": path, "pixels": pixels})

func native(owner: Node) -> Dictionary:
  var value: Variant = JSON.parse_string(owner.call("snapshot"))
  return value if value is Dictionary else {}

func js(expression: String) -> Variant:
  return JSON.parse_string(app.call("evaluate", "JSON.stringify(NativeEventIntegratedProbe." + expression + ")"))

func snapshot() -> Dictionary:
  var value: Variant = js("snapshot()")
  return value if value is Dictionary else {}

func arm(name: String, id: String, options: Dictionary = {}) -> Dictionary:
  return js("arm(%s,%s,%s)" % [JSON.stringify(name), JSON.stringify(id), JSON.stringify(options)])

func inject(phase: String, name: String, id: String, identifier: int = 0) -> void:
  var points := {"only": Vector2(60, 50), "mixed": Vector2(185, 55), "pointerOnly": Vector2(60, 135),
    "first": Vector2(175, 165), "second": Vector2(255, 165), "retired": Vector2(60, 210)}
  var point: Vector2 = points[id] + (Vector2(400, 0) if name == "B" else Vector2.ZERO)
  var event: InputEvent
  if phase == "move":
    var drag := InputEventScreenDrag.new()
    drag.position = point
    drag.index = identifier
    event = drag
  else:
    var touch := InputEventScreenTouch.new()
    touch.position = point
    touch.index = identifier
    touch.pressed = phase == "start"
    touch.canceled = phase == "cancel"
    event = touch
  event.device = DEVICE
  Input.parse_input_event(event)
  await settle()

func event_order(state: Dictionary) -> Array:
  return state.events.map(func(row: Dictionary) -> String: return row.id + "/" + row.source + "/" + ("capture" if row.capture else "bubble"))

func callback_contract(state: Dictionary, label: String, is_original_event: bool) -> void:
  check(state.globalEventRestored and state.currentPriority == state.defaultPriority and state.callbackDepth == 0,
    label + "/Global event callback depth and native priority restore")
  check(state.raw.all(func(row: Dictionary) -> bool: return row.currentPriority == row.defaultPriority) and state.events.all(func(row: Dictionary) -> bool: return row.currentPriority == row.defaultPriority),
    label + "/Actual Raw and listener callback priorities are recorded as original native default")
  check(state.cleanup.all(func(row: Dictionary) -> bool: return row.currentTargetNull and row.nativePayloadRetained == is_original_event),
    label + "/Callback cleanup preserves original payloads or clears pooled legacy payloads")
  if is_original_event:
    check(state.events.all(func(row: Dictionary) -> bool: return row.originalSynthetic and row.trusted and row.currentTargetMatches and row.thisMatches and row.targetIsOriginalRef and row.globalEventMatches and row.preservesNativeTimeStamp),
      label + "/Original trusted EventTarget callbacks preserve refs receiver global event and timestamp")
    check(state.cleanup.all(func(row: Dictionary) -> bool: return row.originalEvent and row.cleaned),
      label + "/Original event phase and composed path clean after dispatch")
  check(state.raw.filter(func(row: Dictionary) -> bool: return row.type == "topTouchStart").size() == 2,
    label + "/Native touch start emits one typed and one star Raw row")
  var starts: Array = state.raw.filter(func(row: Dictionary) -> bool: return row.type == "topTouchStart")
  check(starts.size() == 2 and starts[0].payloadId == starts[1].payloadId and starts[0].channel == "typed" and starts[1].channel == "star",
    label + "/Raw channels share exact payload identity and precede callback delivery")
  if not state.events.is_empty():
    check(starts.size() == 2 and starts[1].sequence < state.events[0].sequence and state.events.all(func(row: Dictionary) -> bool: return row.payloadId == starts[0].payloadId),
      label + "/Callbacks receive the same Raw native payload after both channels")

func mixed_case(name: String, id: String, options: Dictionary = {}) -> void:
  var before := arm(name, id, options)
  await inject("start", name, "mixed")
  var state := snapshot()
  stages[name + "/" + id] = {"react": state, "native": native(surfaces[name])}
  var integrated := integration_mode == "integrated"
  var expected: Array = ["mixedParent/jsx/capture", "mixed/jsx/capture", "mixed/jsx/bubble", "mixedParent/jsx/bubble"]
  if integrated:
    expected = ["mixedParent/jsx/capture", "mixedParent/imperative/capture", "mixedFlat/imperative/capture", "mixed/jsx/capture", "mixed/imperative/capture",
      "mixed/jsx/bubble", "mixed/imperative/bubble", "mixedFlat/imperative/bubble", "mixedParent/jsx/bubble", "mixedParent/imperative/bubble"]
  if options.get("stopPropagation", false):
    expected.resize(7 if integrated else 3)
  check(event_order(state) == expected, name + "/" + id + "/Exact exclusive JSX and imperative capture bubble order")
  callback_contract(state, name + "/" + id, integrated)
  var updates := 2 if integrated else 1
  check(state.updates.size() == updates and state.panels[name].count == before.baselineCount + updates and state.panels[name].committedCount == before.baselineCount + updates,
    name + "/" + id + "/Both functional updates survive the native renderer batch")
  check(state.commits.size() == 1 and state.commits[0].callbackDepth == 0 and state.commits[0].sequence > state.events.back().exitSequence and state.events.all(func(row: Dictionary) -> bool: return row.committedCountAtEntry == before.baselineCount and row.committedCountAtExit == before.baselineCount),
    name + "/" + id + "/Exactly one React layout effect commits after every callback exits")
  var counter: Array = native(surfaces[name]).nodes.filter(func(row: Dictionary) -> bool: return row.testID == name + "-counter")
  check(counter.size() == 1 and counter[0].width == 20 + (before.baselineCount + updates) * 10,
    name + "/" + id + "/Native Control geometry reflects the committed React count")
  if options.get("preventDefault", false):
    check(state.events.filter(func(row: Dictionary) -> bool: return row.id == "mixed" and not row.capture).all(func(row: Dictionary) -> bool: return row.defaultPreventedAtExit),
      name + "/" + id + "/Cancellation is visible in the actual target callbacks")
  if name == "A" and id == "mixed":
    await capture("updated")
  await inject("end", name, "mixed")
  check(native(surfaces[name]).pointer.activeTouches == 0, name + "/" + id + "/Physical end retires the contact")

func responder_case(id: String, actions: Array) -> void:
  var before := arm("A", id, {"updateCount": false})
  var states: Array = []
  for index in range(actions.size()):
    var action: Array = actions[index]
    await inject(action[0], "A", action[1], action[2])
    var pointer: Dictionary = native(surfaces.A).pointer
    states.append({"react": snapshot(), "pointer": pointer})
    check(pointer.responder == (0 if index == actions.size() - 1 else before.tags.responder), id + "/Native responder owner at step " + str(index))
  var state := snapshot()
  var expected: Array = ["should-set", "grant", "start", "move", "end", "release"]
  if id == "inside-two":
    expected = ["should-set", "grant", "start", "start", "end", "end", "release"]
  if id == "cancel":
    expected = ["should-set", "grant", "start", "end", "terminate"]
  check(state.responders.map(func(row: Dictionary) -> String: return row.handler) == expected, id + "/Exact original negotiation and responder lifecycle")
  check(state.responderCleanup.all(func(row: Dictionary) -> bool: return row.currentTargetNull), id + "/Responder callbacks clear currentTarget")
  if integration_mode == "integrated":
    check(state.responders.all(func(row: Dictionary) -> bool: return row.originalResponder and not row.trusted and row.phase == 0), id + "/Original responder events preserve untrusted NONE contract")
  check(native(surfaces.A).pointer.activeTouches == 0 and native(surfaces.A).pointer.responder == 0 and native(surfaces.B).pointer.responder == 0,
    id + "/Native physical contacts and both root owners clear")
  stages[id] = states

func fault_case(id: String, target: String, faults: Array, expected_message: String) -> void:
  arm("A", id, {"updateCount": false})
  js("configureFaults(%s)" % JSON.stringify(faults))
  var error_count: int = native(app).errors.size()
  await inject("start", "A", target)
  var after_error := snapshot()
  var host := native(app)
  stages[id] = {"react": after_error, "native": host}
  check(host.errors.size() == error_count + 1 and str(host.errors.back()).contains(expected_message),
    id + "/Actual native error authority reports the expected deliberate error once")
  deliberate_errors.append(expected_message)
  var expected_attempts := 1 if id == "combined-fault" and integration_mode == "original" else faults.size()
  check(after_error.faultAttempts.size() == expected_attempts and after_error.configuredFaults[0].remaining == 0 and (faults.size() == 1 or after_error.configuredFaults[1].remaining == (1 if integration_mode == "original" else 0)),
    id + "/Exclusive route preserves its original responder and normal exception ordering")
  check(after_error.globalEventRestored and after_error.callbackDepth == 0 and after_error.currentPriority == after_error.defaultPriority,
    id + "/Native priority global event and callback depth restore after throwing listener")
  check(after_error.raw.filter(func(row: Dictionary) -> bool: return row.type == "topTouchStart").size() == 2,
    id + "/Throwing dispatch emits each original Raw channel once")
  if target == "mixed":
    check(event_order(after_error) == (["mixedParent/jsx/capture", "mixedParent/imperative/capture", "mixedFlat/imperative/capture", "mixed/jsx/capture", "mixed/imperative/capture", "mixed/jsx/bubble", "mixed/imperative/bubble", "mixedFlat/imperative/bubble", "mixedParent/jsx/bubble", "mixedParent/imperative/bubble"] if integration_mode == "integrated" else ["mixedParent/jsx/capture", "mixed/jsx/capture", "mixed/jsx/bubble", "mixedParent/jsx/bubble"]),
      id + "/Remaining listeners complete once without invoking a second renderer route")
  js("clearFault()")
  await inject("end", "A", target)
  arm("A", id + "-recovery", {"updateCount": false})
  await inject("start", "A", "mixed")
  var recovered := snapshot()
  check(native(app).errors.size() == error_count + 1 and recovered.events.size() == (10 if integration_mode == "integrated" else 4),
    id + "/Following real native gesture recovers without stale responder or listener error")
  stages[id + "-recovery"] = {"react": recovered, "native": native(app)}
  await inject("end", "A", "mixed")

func cross_root_case() -> void:
  var cap := arm("A", "native-application-wide", {"updateCount": false})
  var steps: Array = []
  var actions: Array = [["start", "A", "first", 7], ["start", "B", "only", 8], ["end", "A", "first", 7], ["move", "B", "only", 8], ["end", "B", "only", 8]]
  # Every TouchEvent lists the application's touches, as one RN surface would.
  # When A's own touch ends, the legacy plugin releases A (B's listed touch is
  # outside it); ReactNativeResponder releases only when no touch remains, as
  # the explicit global oracle below shows.
  var held := 2 if integration_mode == "original" else 4
  for index in range(actions.size()):
    var action: Array = actions[index]
    await inject(action[0], action[1], action[2], action[3])
    var a := native(surfaces.A)
    var b := native(surfaces.B)
    steps.append({"react": snapshot(), "A": a.pointer, "B": b.pointer})
    check(a.pointer.responder == (cap.tags.responder if index < held else 0) and b.pointer.responder == 0,
      "Native application-wide contacts keep RN's responder owner at step " + str(index))
  stages.nativeApplicationWide = steps
  check(steps[2].A.activeTouches == 0 and steps[2].B.activeTouches == 1 and steps[2].react.raw.back().touches == 1,
    "Native payload still lists B's contact when A's ends while B remains physically active")
  var contacts: Array = [[{"name": "A", "id": "first", "identifier": 7}], [{"name": "A", "id": "first", "identifier": 7}, {"name": "B", "id": "only", "identifier": 8}],
    [{"name": "B", "id": "only", "identifier": 8}], [{"name": "B", "id": "only", "identifier": 8}], []]
  arm("A", "manual-root-local", {"updateCount": false})
  var local_steps: Array = []
  for index in range(actions.size()):
    var action: Array = actions[index]
    var local: Array = contacts[index].filter(func(row: Dictionary) -> bool: return row.name == action[1])
    var result: Variant = js("manualGlobalStep(%s,%s,%s,%d,%s)" % [JSON.stringify(action[1]), JSON.stringify(action[2]), JSON.stringify(action[0]), action[3], JSON.stringify(local)])
    local_steps.append({"result": result, "react": snapshot(), "A": native(surfaces.A).pointer})
    check(result.dispatchCount == 1 and result.error == null and native(surfaces.A).pointer.responder == (cap.tags.responder if index < 2 else 0),
      "Manual root-local oracle releases A at its own end, as per-surface touch lists would, at step " + str(index))
  stages.manualRootLocal = local_steps
  arm("A", "manual-global", {"updateCount": false})
  var manual_steps: Array = []
  for index in range(actions.size()):
    var action: Array = actions[index]
    var result: Variant = js("manualGlobalStep(%s,%s,%s,%d,%s)" % [JSON.stringify(action[1]), JSON.stringify(action[2]), JSON.stringify(action[0]), action[3], JSON.stringify(contacts[index])])
    manual_steps.append({"result": result, "react": snapshot(), "A": native(surfaces.A).pointer, "B": native(surfaces.B).pointer})
    check(result.dispatchCount == 1 and result.error == null and native(surfaces.A).pointer.responder == (cap.tags.responder if index < 4 else 0),
      "Explicit manual global contact oracle retains owner until final declared contact at step " + str(index))
  stages.manualGlobal = manual_steps
  check(manual_steps[2].result.payload.touches.size() == 1 and manual_steps[2].A.activeTouches == 0 and manual_steps[2].B.activeTouches == 0,
    "Manual global oracle is recorded separately from actual physical contact transport")

func leaf_stop_signal() -> void:
  stop_during_leaf_removal += 1
  surfaces.C.call("unmount")

func queued_terminal_root_retirement() -> void:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = "Integrated_C"
  surface.size = Vector2(360, 250)
  surface.set("application_path", NodePath("../IntegratedEvents"))
  surface.set("component_name", "NativeEventIntegratedProbe")
  surface.set("initial_props", {"name": "C"})
  surface.set_meta("validation_input_device", DEVICE)
  surfaces.C = surface
  root.add_child(surface)
  await settle()
  arm("C", "queued-terminal-root-retirement", {"updateCount": false})
  await inject("start", "C", "retired", 11)
  check(native(app).rootCount == 2 and native(app).pointerProcessor.active == 1 and native(surface).pointer.activeTouches == 1,
    "Queued terminal retirement has an actual native active pointer in C while B survives")
  var target := surface.find_child("C-retired", true, false)
  if check(target != null, "Queued terminal retirement uses a genuine mounted native Control signal"):
    target.tree_exiting.connect(leaf_stop_signal)
  js("removeRetired('C','C/retired')")
  await settle()
  stages.queuedTerminalRootRetirement = {"react": snapshot(), "surface": native(surface), "native": native(app), "signalCalls": stop_during_leaf_removal}
  check(stop_during_leaf_removal == 1 and native(app).rootCount == 1 and native(surface).stopped and native(surface).pointer.activeTouches == 0 and native(surface).pointer.responder == 0,
    "Genuine leaf exit unmounts C before the next terminal beat and preserves B")
  check(native(app).pointerProcessor.active == 0 and native(app).pointerProcessor.activeCapture == 0 and native(app).pointerProcessor.pendingCapture == 0 and native(app).pointerRouting.active == 0 and native(app).errors.size() == deliberate_errors.size(),
    "Root retirement before queued terminal delivery clears pointer authority without new native errors")
  check(native(surface).creates == native(surface).deletes and native(surface).nativeTags == 0 and snapshot().cleanups.get("C", 0) == 1,
    "Reentrant queued terminal retirement balances all C Controls and React cleanup")
  await inject("end", "C", "retired", 11)
  surface.queue_free()
  surfaces.erase("C")
  await settle()
  await mixed_case("B", "queued-retirement-survivor")

func _initialize() -> void:
  for argument: String in OS.get_cmdline_user_args():
    if argument.begins_with("--integration-mode="):
      integration_mode = argument.trim_prefix("--integration-mode=")
  call_deferred("run_probe")

func run_probe() -> void:
  if not check(integration_mode in ["original", "integrated"], "Explicit isolated renderer integration mode"):
    quit(1)
    return
  root.size = Vector2i(800, 270)
  app = ClassDB.instantiate("FabricApplication")
  app.name = "IntegratedEvents"
  app.set("bundle_path", "res://build/event-dispatch-integrated-enabled.js")
  root.add_child(app)
  for name: String in ["A", "B"]:
    var surface: Control = ClassDB.instantiate("FabricSurface")
    surface.name = "Integrated_" + name
    surface.position = Vector2.ZERO if name == "A" else Vector2(400, 0)
    surface.size = Vector2(360, 250)
    surface.set("application_path", NodePath("../IntegratedEvents"))
    surface.set("component_name", "NativeEventIntegratedProbe")
    surface.set("initial_props", {"name": name})
    surface.set_meta("validation_input_device", DEVICE)
    surfaces[name] = surface
    root.add_child(surface)
  await settle()
  check(native(app).rootCount == 2 and native(surfaces.A).runtimeId == native(surfaces.B).runtimeId and native(surfaces.A).surfaceId != native(surfaces.B).surfaceId,
    "Two real native surfaces share one actual Hermes runtime")
  await capture("initial")
  for name: String in ["A", "B"]:
    var cap: Dictionary = js("capability(%s)" % JSON.stringify(name))
    var lookup: Dictionary = js("lookupCapabilities(%s)" % JSON.stringify(name))
    stages["capability" + name] = cap
    stages["lookup" + name] = lookup
    check(cap.originalElement and cap.originalEventTarget and cap.originalGlobals and cap.flags.imperative and cap.flags.nativeDispatch and cap.listenerCount == 9,
      name + "/Real original refs constructors flags and nine imperative listeners")
    check(cap.logicalMixedFlat and cap.logicalResponderFlat and cap.internalContactsContained and cap.independentImperativePath,
      name + "/Logical flattened ancestry and independent no-JSX target paths")
    check(lookup.entries.size() == 12 and lookup.entries.all(func(row: Dictionary) -> bool: return row.connected and row.sameOriginalHandle) and lookup.invalidTagsNull,
      name + "/All twelve native tags resolve exact original handles and ten invalid values return null")
    check(not native(surfaces[name]).nodes.any(func(row: Dictionary) -> bool: return row.tag == cap.tags.mixedFlat or row.tag == cap.tags.responderFlat),
      name + "/Both logical ancestors are actually flattened native Views")
    arm(name, "manual-only")
    stages[name + "/manual-only"] = {"result": js("manual(%s)" % JSON.stringify(name)), "react": snapshot()}
    var manual_state: Dictionary = snapshot()
    check(event_order(manual_state) == ["only/imperative/bubble"] and manual_state.events[0].trusted and manual_state.events[0].currentTargetMatches and manual_state.raw.is_empty() and manual_state.manualErrors.is_empty(),
      name + "/Explicit manual original touch positive delivers exactly once without claiming native transport")
    arm(name, "manual-pointer")
    stages[name + "/manual-pointer"] = {"result": js("manual(%s,'pointerOnly','pointerdown')" % JSON.stringify(name)), "react": snapshot()}
    check(event_order(snapshot()) == ["pointerOnly/imperative/bubble"] and snapshot().events[0].trusted and snapshot().raw.is_empty(),
      name + "/Manual pointer positive proves the listener exists independently of native interest")
    arm(name, "native-only")
    await inject("start", name, "only")
    var only_state := snapshot()
    stages[name + "/native-only"] = {"react": only_state, "native": native(surfaces[name])}
    check(event_order(only_state) == (["only/imperative/bubble"] if integration_mode == "integrated" else []),
      name + "/Native imperative-only delivery follows exactly the selected renderer")
    callback_contract(only_state, name + "/native-only", integration_mode == "integrated")
    await inject("end", name, "only")
    arm(name, "pointer-interest-negative")
    await inject("start", name, "pointerOnly")
    stages[name + "/pointer-interest-negative"] = {"react": snapshot(), "native": native(surfaces[name])}
    check(snapshot().events.is_empty() and not snapshot().raw.any(func(row: Dictionary) -> bool: return row.type == "topPointerDown"),
      name + "/Native imperative pointer interest remains an explicit negative control")
    await inject("end", name, "pointerOnly")
    await mixed_case(name, "mixed")
    await mixed_case(name, "prevent-default", {"preventDefault": true})
    await mixed_case(name, "stop-propagation", {"stopPropagation": true})
  await responder_case("one-contact", [["start", "first", 0], ["move", "first", 0], ["end", "first", 0]])
  await responder_case("inside-two", [["start", "first", 0], ["start", "second", 1], ["end", "first", 0], ["end", "second", 1]])
  await responder_case("cancel", [["start", "first", 0], ["cancel", "first", 0]])
  await fault_case("jsx-fault", "mixed", [{"id": "mixed", "source": "jsx", "capture": false, "message": "GF integration JSX deliberate fault"}], "GF integration JSX deliberate fault")
  await fault_case("combined-fault", "first", [
    {"id": "responder", "source": "responder", "capture": false, "handler": "grant", "message": "GF integration responder deliberate fault"},
    {"id": "first", "source": "jsx", "capture": false, "message": "GF integration normal deliberate fault"}], "GF integration responder deliberate fault")
  await cross_root_case()
  arm("A", "retired-ref")
  await inject("start", "A", "retired", 9)
  stages.retiredNativeDown = {"react": snapshot(), "native": native(app), "surface": native(surfaces.A)}
  check(native(app).pointerProcessor.active == 1 and native(app).pointerRouting.active == 1 and native(surfaces.A).pointer.activeTouches == 1,
    "Native pointer processor route and adapter are genuinely active before leaf removal")
  stages.retainedBefore = js("removeRetired('A')")
  await settle()
  stages.retiredNativeCancel = {"react": snapshot(), "native": native(surfaces.A)}
  check(native(surfaces.A).pointer.activeTouches == 0 and snapshot().raw.any(func(row: Dictionary) -> bool: return row.type == "topTouchCancel"),
    "Removing a touched target cancels through its surviving ancestor and clears the physical contact")
  check(native(app).pointerProcessor.active == 0 and native(app).pointerProcessor.pendingCapture == 0 and native(app).pointerProcessor.activeCapture == 0 and native(app).pointerRouting.active == 0 and snapshot().raw.filter(func(row: Dictionary) -> bool: return row.type == "topTouchCancel").size() == 2,
    "Leaf retirement drains one TouchCancel per Raw channel and clears processor route and capture authority")
  var errors_before_late_up: int = native(app).errors.size()
  var raw_before_late_up: int = snapshot().raw.size()
  await inject("end", "A", "retired", 9)
  check(native(app).errors.size() == errors_before_late_up and snapshot().raw.size() == raw_before_late_up,
    "Late physical up after real target removal does not redispatch or dereference a retired ref")
  stages.retainedAfter = js("inspectRetained('A/retired')")
  check(stages.retainedBefore.connected and stages.retainedBefore.lookupLive and not stages.retainedAfter.connected and stages.retainedAfter.parentNull and stages.retainedAfter.nativeLookupNull,
    "Real React removal disconnects the retained ref and native tag lookup")
  check(stages.retainedAfter.cleaned and stages.retainedAfter.trace.size() == 1 and stages.retainedAfter.trace[0].label == "self" and not stages.retainedAfter.trace[0].trusted,
    "Removed ref manual dispatch remains self-only untrusted and clean")
  arm("A", "held-root-teardown", {"updateCount": false})
  await inject("start", "A", "first", 10)
  check(native(surfaces.A).pointer.responder != 0 and native(surfaces.A).pointer.activeTouches == 1,
    "Native responder is genuinely held before root teardown")
  surfaces.A.call("unmount")
  await settle()
  stages.rootTeardown = {"react": snapshot(), "A": native(surfaces.A), "B": native(surfaces.B), "application": native(app)}
  check(native(app).rootCount == 1 and native(surfaces.A).pointer.responder == 0 and native(surfaces.A).pointer.activeTouches == 0 and snapshot().cleanups.get("A", 0) == 1,
    "Teardown cancels held responder before React root cleanup while B survives")
  check(snapshot().responders.map(func(row: Dictionary) -> String: return row.handler) == ["should-set", "grant", "start", "end", "terminate"],
    "Held root teardown preserves exact original End and Terminate callbacks")
  await inject("end", "A", "first", 10)
  await mixed_case("B", "surviving-root-recovery")
  if not "--queue-only" in OS.get_cmdline_user_args():
    await queued_terminal_root_retirement()
  stages.beforeStop = native(app)
  app.call("stop")
  await settle()
  stages.afterStop = native(app)
  check(stages.afterStop.stopped and stages.afterStop.rootCount == 0 and stages.afterStop.pendingWork == 0 and stages.afterStop.pendingTimers == 0 and stages.afterStop.pendingAnimationFrames == 0 and stages.afterStop.pendingRootRetirements == 0 and stages.afterStop.errors.size() == deliberate_errors.size(),
    "Stop clears native roots work timers while preserving exact deliberate error authority")
  for name: String in ["A", "B"]:
    var after := native(surfaces[name])
    stages["stop" + name] = after
    check(after.nativeTags == 0 and after.creates == after.deletes and after.pointer.activeTouches == 0 and after.pointer.responder == 0,
      name + "/Stop balances real Controls contacts and responders")
    surfaces[name].queue_free()
  app.queue_free()
  await settle()
  var passed := checks.all(func(row: Dictionary) -> bool: return row.passed)
  var report := {"scenario": "native-event-target-renderer-integration", "integrationMode": integration_mode,
    "displayServer": DisplayServer.get_name(), "godot": Engine.get_version_info(), "checks": checks, "stages": stages, "deliberateErrors": deliberate_errors, "captures": captures,
    "scope": {"actualNativeInput": true, "testOnlyOriginalFlagsEnabled": true, "publicDefaultEnabled": false,
      "nativePointerInterestSolved": false, "responderGapsResolved": false, "hardwareCertified": false, "mobileCertified": false,
      "nativeTouchScope": "application-wide", "manualGlobalOracleIsNativeCertification": false, "nativeNullTargetExecuted": false,
      "queuedTerminalRootRetirementExecuted": not "--queue-only" in OS.get_cmdline_user_args()}}
  var file := FileAccess.open("res://build/event-dispatch-integrated-report.json", FileAccess.WRITE)
  file.store_string(JSON.stringify(report, "  ") + "\n")
  print("INTEGRATED_EVENT_DISPATCH_" + ("PASSED" if passed else "FAILED") + ": " + str(checks.size()))
  quit(0 if passed else 1)
