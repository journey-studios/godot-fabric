extends SceneTree

# RN synthesizes click when a primary pointer releases its main button. The
# target is the deepest view shared by the Down and Up hit paths (Android's
# JSPointerDispatcher); iOS and the W3C model add the primary/main-button
# filter. A shared root alone never clicks. RN's native scroll views take over
# a contact begun inside them: JS receives its pointercancel and nothing more
# for it, so a scroll never clicks. Inputs are actual Godot events.
const DEVICE := 1001
const AWAY := Vector2(320, 60)
const QUIET_RELEASE_SECONDS := 0.35 # Longer than ScrollMotion's 250 ms velocity sample window.
const POINTS := {"L1": Vector2(45, 40), "L2": Vector2(115, 40), "G": Vector2(80, 70), "S": Vector2(185, 45),
  "X": Vector2(260, 45), "P": Vector2(40, 110), "I0": Vector2(145, 110), "EMPTY": Vector2(260, 150)}
# Root-relative origins of every possible click target; nothing is transformed.
const ORIGINS := {"L1": Vector2(20, 20), "L2": Vector2(90, 20), "G": Vector2(10, 10), "S": Vector2(160, 10),
  "C": Vector2.ZERO, "W": Vector2.ZERO, "X": Vector2(230, 10), "P": Vector2(10, 90), "I0": Vector2(80, 90)}
# Host component parents up to W, the platform's mounted AppRegistry View. CT
# is the scroll view's content container.
const PARENT := {"L1": "G", "L2": "G", "G": "C", "S": "C", "P": "C", "I0": "CT", "CT": "SV", "SV": "C", "C": "W", "X": "W", "W": ""}
# Views with a JSX onClick; C also has onClickCapture. P's onClick is
# Pressability's own, which ignores pointer clicks and is not observed.
const JSX := ["L1", "L2", "G", "S", "X", "C", "I0"]
var application: Node
var surfaces: Dictionary = {}
var checks: Array = []
var stages: Dictionary = {}
var flag_mode := "enabled"
var interest_mode := "current"
var imperative := true
var native_dispatch := true
var allow_original_negative := false
var expected_original_failures: Array = []
var mask := 0

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
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(PointerClickProbe." + expression + ")"))

func state() -> Dictionary:
  var value: Variant = js("snapshot()")
  return value if value is Dictionary else {}

func mount(name: String, position: Vector2) -> void:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = name
  surface.position = position
  surface.size = Vector2(300, 200)
  surface.set("application_path", NodePath("../PointerClickApplication"))
  surface.set("component_name", "PointerClickProbe")
  surface.set("initial_props", {"name": name})
  surface.set_meta("validation_input_device", DEVICE)
  surfaces[name] = surface
  root.add_child(surface)

# A point is a POINTS key, a root-relative Vector2, [surface, key] on another
# root, or AWAY between the two roots.
func at(name: String, point: Variant) -> Vector2:
  if point is String and point == "AWAY":
    return AWAY
  if point is Array:
    return surfaces[point[0]].position + POINTS[point[1]]
  return surfaces[name].position + (point if point is Vector2 else POINTS[point])

func mouse_move(name: String, point: Variant) -> void:
  var event := InputEventMouseMotion.new()
  event.device = DEVICE
  event.position = at(name, point)
  event.button_mask = mask
  Input.parse_input_event(event)
  await settle()

func mouse_button(name: String, point: Variant, button: MouseButton, pressed: bool, canceled := false) -> void:
  var bit := 1 << (int(button) - 1)
  mask = 0 if canceled else (mask | bit) if pressed else (mask & ~bit)
  var event := InputEventMouseButton.new()
  event.device = DEVICE
  event.position = at(name, point)
  event.button_index = button
  event.pressed = pressed
  event.canceled = canceled
  event.button_mask = mask
  Input.parse_input_event(event)
  await settle()

func touch(name: String, point: Variant, index: int, pressed: bool, canceled := false) -> void:
  var event := InputEventScreenTouch.new()
  event.device = DEVICE
  event.index = index
  event.position = at(name, point)
  event.pressed = pressed
  event.canceled = canceled
  Input.parse_input_event(event)
  await settle()

func drag(name: String, point: Variant, index: int) -> void:
  var event := InputEventScreenDrag.new()
  event.device = DEVICE
  event.index = index
  event.position = at(name, point)
  Input.parse_input_event(event)
  await settle()

func perform(name: String, action: Array) -> void:
  match action[0]:
    "move": await mouse_move(name, action[1])
    "left": await mouse_button(name, action[1], MOUSE_BUTTON_LEFT, action[2])
    "right": await mouse_button(name, action[1], MOUSE_BUTTON_RIGHT, action[2])
    "middle": await mouse_button(name, action[1], MOUSE_BUTTON_MIDDLE, action[2])
    "cancel-left": await mouse_button(name, action[1], MOUSE_BUTTON_LEFT, false, true)
    "touch": await touch(name, action[1], action[2], action[3])
    "touch-cancel": await touch(name, action[1], action[2], false, true)
    "drag": await drag(name, action[1], action[2])
    "hold-stationary":
      var deadline := Time.get_ticks_msec() + int(float(action[1]) * 1000.0)
      while Time.get_ticks_msec() < deadline:
        await process_frame
    "remove-left":
      js("removeLeft(%s)" % JSON.stringify(name))
      await settle()

func node_with(value: Dictionary, test_id: String) -> Dictionary:
  for node: Dictionary in value.nodes:
    if node.get("testID") == test_id:
      return node
  return {}

# RN's propagation for one click per lane: Document listeners need D, the
# documentElement and View listeners I and D. Capture runs from the Document
# down (phase 1), the target at phase 2 (its capture pass first), bubbling up
# at phase 3; a node's JSX prop runs before its added listeners. A compiled
# legacy JSX handler (no D) carries no phase.
func expected_events(name: String, target: String, map: Dictionary) -> Array:
  var path: Array = []
  var node := target
  while not node.is_empty():
    path.append(node)
    node = PARENT[node]
  var phase := func(key: String, captured: bool) -> Variant:
    if not native_dispatch:
      return null
    return 2 if key == target else 1 if captured else 3
  var rows: Array = []
  if native_dispatch:
    rows.append(["DocC", 1, "Doc"])
  if imperative and native_dispatch:
    rows.append(["RootC", 1, "Root"])
  if "C" in path:
    rows.append(["C-capture", phase.call("C", true), "C"])
  for key: String in path:
    if key in JSX:
      rows.append([key, phase.call(key, false), key])
    if key == "G" and imperative and native_dispatch:
      rows.append(["GB", phase.call("G", false), "G"])
  if imperative and native_dispatch:
    rows.append(["RootB", 3, "Root"])
  if native_dispatch:
    rows.append(["DocB", 3, "Doc"])
  return rows.map(func(row: Array) -> Array:
    return [name, row[0], row[1], int(map[target]), row[2] if row[2] in ["Doc", "Root"] else int(map[row[2]])])

func observed_events(value: Dictionary) -> Array:
  return value.events.map(func(row: Dictionary) -> Array:
    var current: Variant = "Doc" if row.currentIsDocument else "Root" if row.currentIsElement else (int(row.currentTag) if row.currentTag != null else null)
    return [row.name, row.label, int(row.phase) if row.phase != null else null, int(row.targetTag) if row.targetTag != null else null, current])

func typed(value: Dictionary, type: String) -> Array:
  return value.raw.filter(func(row: Dictionary) -> bool: return row.channel == "typed" and row.type == type)

# The click copies its release sample: same pointer, page point, timestamp and
# primary state, button 0 with no buttons left, and an offset local to its own
# target. It follows that Up and precedes the contact's TouchEnd.
func release_matches(spec: Dictionary, value: Dictionary, click: Dictionary) -> bool:
  var ups: Array = typed(value, "topPointerUp").filter(func(row: Dictionary) -> bool:
    return row.pointerId == click.pointerId and int(row.sequence) < int(click.sequence))
  if ups.is_empty():
    return false
  var up: Dictionary = ups[-1]
  var ends: Array = typed(value, "topTouchEnd").filter(func(row: Dictionary) -> bool: return int(row.sequence) > int(up.sequence))
  var release: Vector2 = POINTS[spec.release] if spec.release is String else spec.release
  var offset: Vector2 = release - ORIGINS[spec.target]
  return (not ends.is_empty() and int(click.sequence) < int(ends[0].sequence) and click.pointerType == spec.pointer and
    is_equal_approx(float(click.clientX), float(up.clientX)) and is_equal_approx(float(click.clientY), float(up.clientY)) and
    is_equal_approx(float(click.clientX), release.x) and is_equal_approx(float(click.clientY), release.y) and
    float(click.timeStamp) == float(up.timeStamp) and int(click.button) == 0 and int(click.buttons) == 0 and click.isPrimary == true and
    is_equal_approx(float(click.offsetX), offset.x) and is_equal_approx(float(click.offsetY), offset.y))

func run_case(spec: Dictionary) -> void:
  var name: String = spec.get("panel", "A")
  var prefix: String = spec.id
  # Printed before the input so a crashing host shows the case it died in.
  print("POINTER_CLICK_STEP: " + prefix)
  js("arm(%s,%s)" % [JSON.stringify(name), JSON.stringify(prefix)])
  var before := native(surfaces[name])
  for action: Array in spec.actions:
    await perform(name, action)
  var value := state()
  var after := native(surfaces[name])
  var app := native(application)
  stages[prefix] = {"react": value, "before": before, "after": after, "application": app}
  var map: Dictionary = value.panels[name].tags
  var target: String = spec.get("target", "")
  var kinds := {
    "click": prefix + "/The release synthesizes exactly the expected click from its own sample",
    "delivery": prefix + "/Click callbacks follow RN's propagation for this lane",
    "takeover": prefix + "/A native scroll drag takes the contact over: one pointer and touch cancel, then native scrolling",
  }
  var clicks: Array = value.raw.filter(func(row: Dictionary) -> bool: return row.type == "topClick")
  var expected: Array = [] if target.is_empty() else expected_events(name, target, map)
  if not target.is_empty():
    expected_original_failures.append(kinds.click)
    if not expected.is_empty():
      expected_original_failures.append(kinds.delivery)
  var click_ok := clicks.is_empty()
  if not target.is_empty():
    click_ok = (clicks.size() == 2 and clicks[0].channel == "typed" and clicks[1].channel == "star" and
      clicks[0].payloadId == clicks[1].payloadId and int(clicks[0].target) == int(map[target]) and
      release_matches(spec, value, clicks[0]))
  check(click_ok, kinds.click)
  # Every callback shares the click's payload, which owns pointerType (so
  # Pressability ignores it), at Discrete priority, in this lane's event kind.
  var observed := observed_events(value)
  var event_payloads_valid: bool = value.events.all(func(row: Dictionary) -> bool:
    return (row.type == ("click" if native_dispatch else null) and row.trusted == native_dispatch and
      row.originalEvent == native_dispatch and row.compiledLegacySynthetic == (not native_dispatch) and row.ownPointerType and
      not clicks.is_empty() and row.payloadId == clicks[0].payloadId and int(row.currentPriority) == int(value.discretePriority)))
  var delivery_ok: bool = observed == expected and event_payloads_valid and value.globalEventRestored and int(value.currentPriority) == int(value.defaultPriority)
  check(delivery_ok, kinds.delivery)
  if spec.get("takeover", false):
    expected_original_failures.append(kinds.takeover)
    check(takeover_matches(spec, value, before, after, name), kinds.takeover)
  if spec.get("presses", -1) >= 0:
    check(value.presses.size() == spec.presses and (clicks.is_empty() or value.presses.all(func(sequence: Variant) -> bool:
        return int(sequence) > int(clicks[0].sequence))),
      prefix + "/Pressable presses once from the responder, after Pressability ignores the pointer click")
  check(int(after.pointer.activeTouches) == 0 and int(app.pointerProcessor.active) == 0 and int(app.pointerRouting.active) == 0 and
      int(after.pointer.get("takenPointers", 0)) == 0,
    prefix + "/The contact ends without a retained touch, pointer, route or takeover")

# Native scroll takeover cancels both child streams before BeginDrag. No child
# pointer or touch events follow; the native scroll owner continues the gesture.
func takeover_matches(spec: Dictionary, value: Dictionary, before: Dictionary, after: Dictionary, name: String) -> bool:
  var pointer_cancels := typed(value, "topPointerCancel")
  var touch_cancels := typed(value, "topTouchCancel")
  var pointer_stars: Array = value.raw.filter(func(row: Dictionary) -> bool: return row.channel == "star" and row.type == "topPointerCancel")
  var touch_stars: Array = value.raw.filter(func(row: Dictionary) -> bool: return row.channel == "star" and row.type == "topTouchCancel")
  if pointer_cancels.size() != 1 or pointer_stars.size() != 1 or touch_cancels.size() != 1 or touch_stars.size() != 1:
    return false
  var pointer_cancel: Dictionary = pointer_cancels[0]
  var touch_cancel: Dictionary = touch_cancels[0]
  var pointer_downs := typed(value, "topPointerDown")
  if pointer_downs.size() != 1 or pointer_cancel.pointerId != pointer_downs[0].pointerId:
    return false
  if pointer_stars[0].payloadId != pointer_cancel.payloadId or touch_stars[0].payloadId != touch_cancel.payloadId:
    return false
  var after_pointer := func(type: String) -> Array:
    return typed(value, type).filter(func(row: Dictionary) -> bool: return int(row.sequence) > int(pointer_cancel.sequence))
  var after_touch := func(type: String) -> Array:
    return typed(value, type).filter(func(row: Dictionary) -> bool: return int(row.sequence) > int(touch_cancel.sequence))
  var scroll_before: Dictionary = node_with(before, name + "-scroll").get("scroll", {})
  var scroll_after: Dictionary = node_with(after, name + "-scroll").get("scroll", {})
  var scroll_began_after_cancels: bool = (value.scrollBegins.size() == 1 and
    int(value.scrollBegins[0]) > int(pointer_cancel.sequence) and int(value.scrollBegins[0]) > int(touch_cancel.sequence) and
    int(value.scrollBegins[0]) > int(pointer_stars[0].sequence) and int(value.scrollBegins[0]) > int(touch_stars[0].sequence))
  return (typed(value, "topPointerDown").size() == 1 and typed(value, "topPointerUp").is_empty() and
    after_pointer.call("topPointerMove").filter(func(row: Dictionary) -> bool: return row.pointerId == pointer_cancel.pointerId).is_empty() and
    after_pointer.call("topPointerUp").is_empty() and after_pointer.call("topClick").is_empty() and
    after_touch.call("topTouchMove").is_empty() and after_touch.call("topTouchEnd").is_empty() and
    pointer_cancel.pointerType == spec.pointer and int(pointer_cancel.buttons) == 0 and
    float(scroll_before.get("y", -1)) == spec.startsAt and scroll_began_after_cancels and
    is_equal_approx(float(scroll_after.get("y", -1)), spec.scrolled) and
    int(scroll_after.get("begins", 0)) == int(scroll_before.get("begins", 0)) + 1 and
    int(scroll_after.get("ends", 0)) == int(scroll_before.get("ends", 0)) + 1 and
    int(scroll_after.get("momentumBegins", 0)) == int(scroll_before.get("momentumBegins", 0)) and
    int(scroll_after.get("momentumEnds", 0)) == int(scroll_before.get("momentumEnds", 0)) and
    int(scroll_after.get("motion", -1)) == 0 and not bool(scroll_after.get("dragging", true)) and
    int(after.pointer.get("pointerTakeovers", -1)) == int(before.pointer.get("pointerTakeovers", -1)) + 1)

func cases() -> Array:
  var down_up := func(point: Variant) -> Array: return [["move", point], ["left", point, true], ["left", point, false]]
  return [
    {"id": "mouse/same", "pointer": "mouse", "actions": down_up.call("L1"), "target": "L1", "release": "L1"},
    {"id": "mouse/siblings", "pointer": "mouse", "target": "G", "release": "L2",
      "actions": [["move", "L1"], ["left", "L1", true], ["move", "L2"], ["left", "L2", false]]},
    {"id": "mouse/leaf-to-group", "pointer": "mouse", "target": "G", "release": "G",
      "actions": [["move", "L1"], ["left", "L1", true], ["move", "G"], ["left", "G", false]]},
    {"id": "mouse/group-to-leaf", "pointer": "mouse", "target": "G", "release": "L1",
      "actions": [["move", "G"], ["left", "G", true], ["move", "L1"], ["left", "L1", false]]},
    # The box-none container is on both paths: RN clicks it.
    {"id": "mouse/cousin", "pointer": "mouse", "target": "C", "release": "S",
      "actions": [["move", "L1"], ["left", "L1", true], ["move", "S"], ["left", "S", false]]},
    # Godot mounts the AppRegistry View, so two top-level children share it.
    {"id": "mouse/top-level", "pointer": "mouse", "target": "W", "release": "X",
      "actions": [["move", "L1"], ["left", "L1", true], ["move", "X"], ["left", "X", false]]},
    {"id": "mouse/root-empty", "pointer": "mouse",
      "actions": [["move", "L1"], ["left", "L1", true], ["move", "EMPTY"], ["left", "EMPTY", false]]},
    {"id": "mouse/outside", "pointer": "mouse",
      "actions": [["move", "L1"], ["left", "L1", true], ["move", "AWAY"], ["left", "AWAY", false]]},
    {"id": "mouse/empty-down", "pointer": "mouse",
      "actions": [["move", "EMPTY"], ["left", "EMPTY", true], ["move", "L1"], ["left", "L1", false]]},
    {"id": "mouse/right", "pointer": "mouse", "actions": [["move", "L1"], ["right", "L1", true], ["right", "L1", false]]},
    {"id": "mouse/middle", "pointer": "mouse", "actions": [["middle", "L1", true], ["middle", "L1", false]]},
    # The Up releases the main button last: one click.
    {"id": "mouse/chord-left-last", "pointer": "mouse", "target": "L1", "release": "L1",
      "actions": [["left", "L1", true], ["right", "L1", true], ["right", "L1", false], ["left", "L1", false]]},
    # The Up releases the secondary button: iOS's filter, no click.
    {"id": "mouse/chord-right-last", "pointer": "mouse",
      "actions": [["right", "L1", true], ["left", "L1", true], ["left", "L1", false], ["right", "L1", false]]},
    {"id": "mouse/cancel", "pointer": "mouse", "actions": [["move", "L1"], ["left", "L1", true], ["cancel-left", "L1"]]},
    {"id": "touch/same", "pointer": "touch", "target": "L1", "release": "L1",
      "actions": [["touch", "L1", 0, true], ["touch", "L1", 0, false]]},
    {"id": "touch/drag", "pointer": "touch", "target": "G", "release": "L2",
      "actions": [["touch", "L1", 0, true], ["drag", "L2", 0], ["touch", "L2", 0, false]]},
    # The second finger is not primary; only the first one's release clicks.
    {"id": "touch/secondary", "pointer": "touch", "target": "L1", "release": "L1",
      "actions": [["touch", "L1", 0, true], ["touch", "L2", 1, true], ["touch", "L2", 1, false], ["touch", "L1", 0, false]]},
    {"id": "touch/cancel", "pointer": "touch", "actions": [["touch", "L1", 0, true], ["touch-cancel", "L1", 0]]},
    {"id": "touch/pressable", "pointer": "touch", "target": "P", "release": "P", "presses": 1,
      "actions": [["touch", "P", 0, true], ["touch", "P", 0, false]]},
    {"id": "touch/scroll-tap", "pointer": "touch", "target": "I0", "release": "I0",
      "actions": [["touch", "I0", 0, true], ["touch", "I0", 0, false]]},
    # Dragging up 55 points: the third sample passes the 8-point slop.
    {"id": "touch/scroll-takeover", "pointer": "touch", "takeover": true, "startsAt": 0.0, "scrolled": 55.0,
      "actions": [["touch", Vector2(145, 175), 0, true], ["drag", Vector2(145, 167), 0], ["drag", Vector2(145, 159), 0],
        ["drag", Vector2(145, 140), 0], ["drag", Vector2(145, 120), 0], ["hold-stationary", QUIET_RELEASE_SECONDS],
        ["touch", Vector2(145, 120), 0, false]]},
    # A mouse drag scrolls back down; its release ends the takeover.
    {"id": "mouse/scroll-takeover", "pointer": "mouse", "takeover": true, "startsAt": 55.0, "scrolled": 0.0,
      "actions": [["move", Vector2(145, 110)], ["left", Vector2(145, 110), true], ["move", Vector2(145, 118)],
        ["move", Vector2(145, 126)], ["move", Vector2(145, 150)], ["move", Vector2(145, 165)],
        ["hold-stationary", QUIET_RELEASE_SECONDS], ["left", Vector2(145, 165), false]]},
    {"id": "mouse/after-scroll", "pointer": "mouse", "actions": down_up.call("L1"), "target": "L1", "release": "L1"},
    # Pressed on A, released over B: A's release hits nothing of A's.
    {"id": "mouse/cross-root", "pointer": "mouse",
      "actions": [["move", "L1"], ["left", "L1", true], ["move", ["B", "L1"]], ["left", ["B", "L1"], false]]},
    {"id": "B/mouse/same", "panel": "B", "pointer": "mouse", "actions": down_up.call("L1"), "target": "L1", "release": "L1"},
    # Removing the pressed target cancels the contact before its release.
    {"id": "mouse/removed", "pointer": "mouse",
      "actions": [["move", "L1"], ["left", "L1", true], ["remove-left"], ["left", "L1", false]]},
  ]

func _initialize() -> void:
  var args := OS.get_cmdline_user_args()
  allow_original_negative = args.has("--allow-original-negative")
  for arg: String in args:
    if arg.begins_with("--flag="):
      flag_mode = arg.trim_prefix("--flag=")
    elif arg.begins_with("--interest="):
      interest_mode = arg.trim_prefix("--interest=")
  imperative = flag_mode in ["imperative-only", "enabled"]
  native_dispatch = flag_mode in ["internal-only", "enabled"]
  call_deferred("run_probe")

func run_probe() -> void:
  root.size = Vector2i(680, 200)
  application = ClassDB.instantiate("FabricApplication")
  application.name = "PointerClickApplication"
  application.set("bundle_path", "res://build/pointer-click-" + flag_mode + ".js")
  root.add_child(application)
  mount("A", Vector2.ZERO)
  mount("B", Vector2(340, 0))
  await settle()
  var installed := interest_mode == "current" and native_dispatch
  check(native(application).rootCount == 2 and native(application).pointerListenerQueryInstalled == installed,
    "mount/Two actual roots share Hermes; only the current interest with D installs the SDK query")
  var listeners: Array = []
  for label: String in ["DocC", "RootC", "GB", "RootB", "DocB"]:
    if (label.begins_with("Doc") and native_dispatch) or (imperative and native_dispatch):
      listeners.append(label)
  var methods := func(available: bool) -> Array: return ["function", "function", "function"] if available else ["undefined", "undefined", "undefined"]
  for name: String in ["A", "B"]:
    var capability: Dictionary = js("configure(%s,%d)" % [JSON.stringify(name), int(native(surfaces[name]).surfaceId)])
    stages["capability" + name] = capability
    check(capability.flags.imperative == imperative and capability.flags.nativeDispatch == native_dispatch and
        capability.methods.doc == methods.call(native_dispatch) and capability.methods.element == methods.call(imperative and native_dispatch) and
        capability.methods.view == methods.call(imperative and native_dispatch) and capability.installed == listeners and
        int(capability.query.installations) == (1 if installed else 0),
      "capability/" + name + "/The lane's flags expose exactly its original Document, documentElement and View methods")
  var clicks := {"A": 0, "B": 0}
  for spec: Dictionary in cases():
    await run_case(spec)
    if not spec.get("target", "").is_empty():
      clicks[spec.get("panel", "A")] += 1
  # RN dispatches every synthesized click without consulting listener Maps.
  var click_lookups: Array = []
  for key: String in stages:
    var stage: Variant = stages[key]
    if stage is Dictionary and stage.has("react"):
      for row: Dictionary in stage.react.query.rows:
        if int(row.offset) in [30, 31]:
          click_lookups.append([key, int(row.offset)])
  stages.clickLookups = click_lookups
  check(click_lookups.is_empty(), "query/No synthesized click reads a listener Map, in any lane")
  var final_a := native(surfaces.A)
  var final_b := native(surfaces.B)
  stages.counters = {"A": final_a.pointer, "B": final_b.pointer, "expectedClicks": clicks}
  expected_original_failures.append("native/Each root's adapter counts exactly its synthesized clicks and takeovers")
  check(int(final_a.pointer.get("pointerClicks", -1)) == clicks.A and int(final_b.pointer.get("pointerClicks", -1)) == clicks.B and
      int(final_a.pointer.get("pointerTakeovers", -1)) == 2 and int(final_b.pointer.get("pointerTakeovers", -1)) == 0,
    "native/Each root's adapter counts exactly its synthesized clicks and takeovers")
  stages.beforeStop = {"application": native(application), "react": state()}
  check(stages.beforeStop.application.errors.is_empty(), "cleanup/No dispatch, query or responder diagnostic was hidden")
  application.call("stop")
  await settle()
  var stopped := native(application)
  check(stopped.stopped and not stopped.pointerListenerQueryInstalled and stopped.rootCount == 0 and stopped.pendingWork == 0 and
      stopped.pointerProcessor.active == 0 and stopped.pointerProcessor.hover == 0 and stopped.pointerRouting.contacts == 0 and
      stopped.pointerRouting.stored == 0 and stopped.errors.is_empty(),
    "cleanup/Stop balances roots, query work, routes and hover without diagnostics")
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
  var report := {"scenario": "native-pointer-click", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "flagMode": flag_mode, "interestMode": interest_mode,
    "checks": checks, "failures": failures, "stages": stages, "afterStop": stopped,
    "expectedOriginalFailures": expected_original_failures, "allowOriginalNegative": allow_original_negative,
    "originalNegativeObserved": original_negative_observed, "allAssertionsPassed": failures.is_empty(),
    "scope": {"actualNativeInput": true, "originalHostComponents": true, "realSDKQueryObservedOnlyForTest": true,
      "listenerRegistryMirrored": false, "clickTargetIsDeepestSharedMountedView": true, "primaryMainButtonOnly": true,
      "sharedRootNeverClicks": true, "scrollTakeoverCancelsPointer": true, "captureRetargetingCertified": false,
      "auxclickOrContextMenu": false, "publicDefaultEnabled": false, "hardwareCertified": false}}
  var output := FileAccess.open("res://build/pointer-click-report.json", FileAccess.WRITE)
  if not check(output != null, "report/PointerClick report is saved with visible normative failures"):
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  print("POINTER_CLICK_ORIGINAL_NEGATIVE: " + str(failures.size()) if original_negative_observed else "POINTER_CLICK_PASSED: " + str(checks.size()) if failures.is_empty() else "POINTER_CLICK_FAILED")
  quit(0 if failures.is_empty() or original_negative_observed else 1)
