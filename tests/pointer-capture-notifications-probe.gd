extends SceneTree

# RN's PointerEventsProcessor processes a pending capture at the pointer's next
# event: lostpointercapture to the previous owner, then gotpointercapture to the
# new one, both retargeted and Discrete, before that event's hover tracking and
# the event itself, which is retargeted to the capture target. Up and Cancel
# release it implicitly after their own dispatch (and after a non-hovering
# pointer's out/leave). Hover follows the capture target; click is synthesized
# from the physical Down and Up hit paths after that release. Inputs are actual
# Godot events over two roots of one application.
const DEVICE := 1001
const AWAY := Vector2(320, 60)
const POINTS := {"L1": Vector2(45, 40), "L1b": Vector2(46, 41), "L1c": Vector2(47, 42), "L2": Vector2(115, 40),
  "L2b": Vector2(116, 41), "G": Vector2(80, 70), "S": Vector2(185, 45), "EMPTY": Vector2(260, 150)}
# Root-relative origins of every possible target; nothing is transformed.
const ORIGINS := {"L1": Vector2(20, 20), "L2": Vector2(90, 20), "G": Vector2(10, 10), "S": Vector2(160, 10), "C": Vector2.ZERO,
  "X": Vector2(230, 10)}
# Up to the mounted AppRegistry View, which listens to nothing.
const PARENT := {"L1": "G", "L2": "G", "G": "C", "S": "C", "C": "", "X": ""}
# Views with JSX got/lost props; C and L1 also have the capture-phase props.
const NOTIFIED := ["L1", "L2", "S", "G", "C"]
const RAW := {"got": "topGotPointerCapture", "lost": "topLostPointerCapture", "down": "topPointerDown",
  "move": "topPointerMove", "up": "topPointerUp", "cancel": "topPointerCancel", "over": "topPointerOver",
  "out": "topPointerOut", "enter": "topPointerEnter", "leave": "topPointerLeave", "click": "topClick"}
const DOM := {"got": "gotpointercapture", "lost": "lostpointercapture", "down": "pointerdown", "move": "pointermove",
  "up": "pointerup", "cancel": "pointercancel", "over": "pointerover", "out": "pointerout", "enter": "pointerenter",
  "leave": "pointerleave", "click": "click"}
var application: Node
var surfaces: Dictionary = {}
var checks: Array = []
var stages: Dictionary = {}
var flag_mode := "enabled"
var interest_mode := "current"
var imperative := true
var native_dispatch := true
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
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(PointerCaptureNotificationsProbe." + expression + ")"))

func mount(name: String, position: Vector2) -> void:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = name
  surface.position = position
  surface.size = Vector2(300, 200)
  surface.set("application_path", NodePath("../PointerCaptureNotificationsApplication"))
  surface.set("component_name", "PointerCaptureNotificationsProbe")
  surface.set("initial_props", {"name": name})
  surface.set_meta("validation_input_device", DEVICE)
  surfaces[name] = surface
  root.add_child(surface)

# A point is a POINTS key on the case's root, [root, key] on another root, or
# AWAY between the two roots.
func at(name: String, point: Variant) -> Vector2:
  if point is String and point == "AWAY":
    return AWAY
  if point is Array:
    return surfaces[point[0]].position + POINTS[point[1]]
  return surfaces[name].position + POINTS[point]

func mouse_move(name: String, point: Variant) -> void:
  var event := InputEventMouseMotion.new()
  event.device = DEVICE
  event.position = at(name, point)
  event.button_mask = mask
  Input.parse_input_event(event)
  await settle()

func mouse_button(name: String, point: Variant, pressed: bool, canceled := false) -> void:
  mask = 0 if canceled else (mask | 1) if pressed else (mask & ~1)
  var event := InputEventMouseButton.new()
  event.device = DEVICE
  event.position = at(name, point)
  event.button_index = MOUSE_BUTTON_LEFT
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
    "left": await mouse_button(name, action[1], action[2])
    "cancel-left": await mouse_button(name, action[1], false, true)
    "touch": await touch(name, action[1], action[2], action[3])
    "touch-cancel": await touch(name, action[1], action[2], false, true)
    "drag": await drag(name, action[1], action[2])
    "schedule":
      js("schedule(%s,%s,%s)" % [JSON.stringify(name), JSON.stringify(action[1]), JSON.stringify(action[2])])
    "remove":
      js("remove(%s,%s)" % [JSON.stringify(name), JSON.stringify(action[1])])
      await settle()
    "restore":
      js("restore(%s)" % JSON.stringify(name))
      await settle()

# The sample's point relative to the case's root, as RN's clientX/clientY.
func client(name: String, point: Variant) -> Vector2:
  return at(name, point) - surfaces[name].position

# Each step is [action, expected events, [pending, active] capture counts after
# it]. An event is "type@node" or "type@node#finger"; mouse events share one
# pointer unless marked "+", a pointer created after a cancel. Each action is
# [handler, method, node, the only candidate reporting capture right after it].
func cases() -> Array:
  return [
    {"id": "mouse/capture-self", "downs": ["L1"], "steps": [
      [["move", "L1"], ["over@L1", "enter@L1", "move@L1"], [0, 0]],
      [["left", "L1", true], ["down@L1"], [1, 0]],
      [["move", "L2"], ["got@L1", "move@L1"], [1, 1]],
      [["move", "G"], ["move@L1"], [1, 1]],
      [["move", "EMPTY"], ["move@L1"], [1, 1]],
      [["move", "AWAY"], ["move@L1"], [1, 1]],
      [["move", ["B", "L1"]], ["move@L1"], [1, 1]],
      [["move", "L2"], ["move@L1"], [1, 1]],
      [["left", "L2", false], ["up@L1", "lost@L1", "click@G"], [0, 0]],
      [["move", "L2b"], ["out@L1", "leave@L1", "over@L2", "enter@L2", "move@L2"], [0, 0]]],
      "actions": [["down", "capture", "L1", "L1"]]},
    {"id": "mouse/capture-up", "downs": ["L1"], "steps": [
      [["move", "L1"], ["over@L1", "enter@L1", "move@L1"], [0, 0]],
      [["left", "L1", true], ["down@L1"], [1, 0]],
      [["left", "L1", false], ["got@L1", "up@L1", "lost@L1", "click@L1"], [0, 0]]],
      "actions": [["down", "capture", "L1", "L1"]]},
    {"id": "mouse/transfer", "downs": ["L1"], "steps": [
      [["move", "L1"], ["over@L1", "enter@L1", "move@L1"], [0, 0]],
      [["left", "L1", true], ["down@L1"], [1, 0]],
      [["schedule", "capture", "L2"], [], [1, 0]],
      [["move", "L2"], ["got@L1", "move@L1"], [1, 1]],
      [["move", "G"], ["lost@L1", "got@L2", "out@L1", "leave@L1", "over@L2", "enter@L2", "move@L2"], [1, 1]],
      [["move", "L1"], ["move@L2"], [1, 1]],
      [["left", "L1", false], ["up@L2", "lost@L2", "click@L1"], [0, 0]],
      [["move", "L1b"], ["out@L2", "leave@L2", "over@L1", "enter@L1", "move@L1"], [0, 0]]],
      "actions": [["down", "capture", "L1", "L1"], ["move", "capture", "L2", "L2"]]},
    {"id": "mouse/release", "downs": ["L1"], "steps": [
      [["move", "L1"], ["over@L1", "enter@L1", "move@L1"], [0, 0]],
      [["left", "L1", true], ["down@L1"], [1, 0]],
      [["schedule", "release", "L1"], [], [1, 0]],
      [["move", "L2"], ["got@L1", "move@L1"], [0, 1]],
      [["move", "L2b"], ["lost@L1", "out@L1", "leave@L1", "over@L2", "enter@L2", "move@L2"], [0, 0]],
      [["left", "L2b", false], ["up@L2", "click@G"], [0, 0]]],
      "actions": [["down", "capture", "L1", "L1"], ["move", "release", "L1", ""]]},
    {"id": "mouse/cancel", "downs": ["L1"], "steps": [
      [["move", "L1"], ["over@L1", "enter@L1", "move@L1"], [0, 0]],
      [["left", "L1", true], ["down@L1"], [1, 0]],
      [["move", "L2"], ["got@L1", "move@L1"], [1, 1]],
      [["cancel-left", "L2"], ["cancel@L1", "out@L1", "leave@L1", "lost@L1"], [0, 0]],
      [["move", "L2b"], ["over@L2+", "enter@L2+", "move@L2+"], [0, 0]]],
      "actions": [["down", "capture", "L1", "L1"]]},
    # Removing the capture target clears it without any lostpointercapture.
    {"id": "mouse/remove-target", "downs": ["L2"], "steps": [
      [["move", "L1"], ["over@L1", "enter@L1", "move@L1"], [0, 0]],
      [["left", "L1", true], ["down@L1"], [1, 0]],
      [["move", "L1b"], ["got@L2", "out@L1", "leave@L1", "over@L2", "enter@L2", "move@L2"], [1, 1]],
      [["remove", "L2"], [], [0, 0]],
      [["move", "L1c"], ["over@L1", "enter@L1", "move@L1"], [0, 0]],
      [["left", "L1c", false], ["up@L1", "click@L1"], [0, 0]],
      [["restore"], [], [0, 0]]],
      "actions": [["down", "capture", "L2", "L2"]]},
    # Removing the view that captured its own contact cancels that contact (the
    # host's lifetime rule for a removed hit view): the cancel targets the
    # removed view, so no listener sees a cancel or a lost, and the held button
    # stays inert until released. The mouse then hovers as a new pointer.
    {"id": "mouse/remove-captured-origin", "downs": ["L2"], "steps": [
      [["move", "L2"], ["over@L2", "enter@L2", "move@L2"], [0, 0]],
      [["left", "L2", true], ["down@L2"], [1, 0]],
      [["move", "L2b"], ["got@L2", "move@L2"], [1, 1]],
      [["remove", "L2"], [], [0, 0]],
      [["move", "L1"], [], [0, 0]],
      [["left", "L1", false], [], [0, 0]],
      [["move", "L1b"], ["over@L1+", "enter@L1+", "move@L1+"], [0, 0]],
      [["restore"], [], [0, 0]]],
      "actions": [["down", "capture", "L2", "L2"]]},
    # A capture held by a third view never moves the click off the hit paths.
    {"id": "mouse/capture-elsewhere", "downs": ["S"], "steps": [
      [["move", "L1"], ["over@L1", "enter@L1", "move@L1"], [0, 0]],
      [["left", "L1", true], ["down@L1"], [1, 0]],
      [["left", "L1", false], ["got@S", "out@L1", "leave@L1", "up@S", "lost@S", "click@L1"], [0, 0]],
      [["move", "L1b"], ["over@L1", "enter@L1", "move@L1"], [0, 0]]],
      "actions": [["down", "capture", "S", "S"]]},
    # RN emits got/lost without consulting listeners, but the retargeted Move and
    # Up are gated by the capture target's own path, which listens to nothing.
    {"id": "mouse/listener-free-target", "downs": ["X"], "steps": [
      [["move", "L1"], ["over@L1", "enter@L1", "move@L1"], [0, 0]],
      [["left", "L1", true], ["down@L1"], [1, 0]],
      [["move", "L2"], ["got@X", "out@L1", "leave@L1"], [1, 1]],
      [["move", "G"], [], [1, 1]],
      [["left", "L2", false], ["lost@X", "click@G"], [0, 0]],
      [["move", "L2b"], ["over@L2", "enter@L2", "move@L2"], [0, 0]]],
      "actions": [["down", "capture", "X", "X"]]},
    # Without pressed buttons RN ignores setPointerCapture.
    {"id": "mouse/no-buttons", "downs": [], "steps": [
      [["schedule", "capture", "L1"], [], [0, 0]],
      [["move", "L1"], ["over@L1", "enter@L1", "move@L1"], [0, 0]],
      [["move", "L2"], ["out@L1", "leave@L1", "over@L2", "enter@L2", "move@L2"], [0, 0]]],
      "actions": [["move", "capture", "L1", ""]]},
    {"id": "touch/capture-self", "downs": ["L1"], "steps": [
      [["touch", "L1", 0, true], ["over@L1", "enter@L1", "down@L1"], [1, 0]],
      [["drag", "L2", 0], ["got@L1", "move@L1"], [1, 1]],
      [["drag", "AWAY", 0], ["move@L1"], [1, 1]],
      [["drag", "L2b", 0], ["move@L1"], [1, 1]],
      [["touch", "L2b", 0, false], ["up@L1", "out@L1", "leave@L1", "lost@L1", "click@G"], [0, 0]]],
      "actions": [["down", "capture", "L1", "L1"]]},
    # RN has no implicit touch capture: hover and targets follow the finger.
    {"id": "touch/no-capture", "downs": ["-"], "steps": [
      [["touch", "L1", 0, true], ["over@L1", "enter@L1", "down@L1"], [0, 0]],
      [["drag", "L2", 0], ["out@L1", "leave@L1", "over@L2", "enter@L2", "move@L2"], [0, 0]],
      [["touch", "L2", 0, false], ["up@L2", "out@L2", "leave@L2", "click@G"], [0, 0]]],
      "actions": [["down", "check", "", ""]]},
    {"id": "touch/cancel", "downs": ["L1"], "steps": [
      [["touch", "L1", 0, true], ["over@L1", "enter@L1", "down@L1"], [1, 0]],
      [["drag", "L2", 0], ["got@L1", "move@L1"], [1, 1]],
      [["touch-cancel", "L2", 0], ["cancel@L1", "out@L1", "leave@L1", "lost@L1"], [0, 0]]],
      "actions": [["down", "capture", "L1", "L1"]]},
    # Each finger's capture is processed by its own next event and released by
    # its own Up; only the primary finger clicks.
    {"id": "touch/two-fingers", "downs": ["L1", "L2"], "steps": [
      [["touch", "L1", 0, true], ["over@L1#0", "enter@L1#0", "down@L1#0"], [1, 0]],
      [["touch", "L2", 1, true], ["over@L2#1", "enter@L2#1", "down@L2#1"], [2, 0]],
      [["drag", "L2b", 0], ["got@L1#0", "move@L1#0"], [2, 1]],
      [["drag", "L1b", 1], ["got@L2#1", "move@L2#1"], [2, 2]],
      [["touch", "L1b", 1, false], ["up@L2#1", "out@L2#1", "leave@L2#1", "lost@L2#1"], [1, 1]],
      [["touch", "L2b", 0, false], ["up@L1#0", "out@L1#0", "leave@L1#0", "lost@L1#0", "click@G#0"], [0, 0]]],
      "actions": [["down", "capture", "L1", "L1"], ["down", "capture", "L2", "L2"]]},
    {"id": "B/mouse/capture-self", "panel": "B", "downs": ["L1"], "steps": [
      [["move", "L1"], ["over@L1", "enter@L1", "move@L1"], [0, 0]],
      [["left", "L1", true], ["down@L1"], [1, 0]],
      [["move", "L2"], ["got@L1", "move@L1"], [1, 1]],
      [["left", "L2", false], ["up@L1", "lost@L1", "click@G"], [0, 0]]],
      "actions": [["down", "capture", "L1", "L1"]]},
  ]

func parse(spec: String) -> Dictionary:
  var finger := ""
  var body := spec
  if body.ends_with("+"):
    finger = "+"
    body = body.trim_suffix("+")
  var mark := body.find("#")
  if mark >= 0:
    finger = body.substr(mark + 1)
    body = body.substr(0, mark)
  var parts := body.split("@")
  return {"kind": parts[0], "node": parts[1], "finger": finger}

func lineage(node: String) -> Array:
  var path: Array = []
  var current := node
  while not current.is_empty():
    path.append(current)
    current = PARENT[current]
  return path

# RN's propagation of one dispatched event in this lane. Got/lost bubble from
# their target: the Document's (D) and documentElement's (I and D) capture
# listeners, C's capture prop, the target's capture prop and added capture
# listener at phase 2, then its bubble prop before its added bubble listener,
# ancestors' props before their added listeners, then documentElement and
# Document. Hover reaches only the leaf's own prop; the contact and click
# props sit on C. A compiled legacy handler (no D) carries no phase.
func callbacks(kind: String, node: String) -> Array:
  var phase := func(key: String, captured: bool) -> Variant:
    if not native_dispatch:
      return null
    return 2 if key == node else 1 if captured else 3
  var rows: Array = []
  if kind in ["over", "out", "enter", "leave"]:
    return [[node, kind, phase.call(node, false)]]
  if kind in ["down", "move", "up", "cancel", "click"]:
    return [["C", kind, phase.call("C", false)]]
  var path := lineage(node)
  var added := imperative and native_dispatch
  if native_dispatch:
    rows.append(["DocC", kind, 1])
  if added:
    rows.append(["RootC", kind, 1])
  if "C" in path:
    rows.append(["C-capture", kind, phase.call("C", true)])
  if node == "L1":
    rows.append(["L1-capture", kind, phase.call("L1", true)])
    if added:
      rows.append(["L1C", kind, 2])
  for key: String in path:
    if key in NOTIFIED:
      rows.append([key, kind, phase.call(key, false)])
    if key == "L1" and added:
      rows.append(["L1B", kind, 2])
    if key == "G" and added:
      rows.append(["GB", kind, 3])
  if added:
    rows.append(["RootB", kind, 3])
  if native_dispatch:
    rows.append(["DocB", kind, 3])
  return rows

func run_case(spec: Dictionary) -> void:
  var name: String = spec.get("panel", "A")
  var prefix: String = spec.id
  # Printed before the input so a crashing host shows the case it died in.
  print("POINTER_CAPTURE_STEP: " + prefix)
  # Every case starts and ends with the mouse outside both roots.
  await mouse_move(name, "AWAY")
  var armed: Variant = js("arm(%s,%s,%s)" % [JSON.stringify(name), JSON.stringify(prefix), JSON.stringify(spec.downs)])
  var tags: Dictionary = armed.tags if armed is Dictionary else {}
  var steps: Array = []
  var expected: Array = []
  for step: Array in spec.steps:
    var before := int(js("snapshot()").raw.size())
    await perform(name, step[0])
    var app := native(application)
    var value: Dictionary = js("snapshot()")
    var point: Variant = null
    if step[0].size() > 1 and not step[0][0] in ["schedule", "remove"]:
      var sample := client(name, step[0][1])
      point = [sample.x, sample.y]
    steps.append({"action": step[0], "point": point,
      "raw": value.raw.slice(before).map(func(row: Dictionary) -> int: return int(row.sequence)),
      "capture": [int(app.pointerProcessor.pendingCapture), int(app.pointerProcessor.activeCapture)],
      "current": js("current(%s)" % JSON.stringify(name))})
    for event: String in step[1]:
      expected.append({"spec": parse(event), "step": steps.size() - 1})
  var value: Dictionary = js("snapshot()")
  await mouse_move(name, "AWAY")
  var after := native(surfaces[name])
  var app := native(application)
  stages[prefix] = {"react": value, "steps": steps, "tags": tags, "after": after, "application": app}
  var raw: Array = value.raw
  var kinds := {
    "sequence": prefix + "/RN's processor emits exactly the expected pointer, boundary, capture and click sequence",
    "payload": prefix + "/Each event carries its own sample, retargeted to its target with a local offset",
    "delivery": prefix + "/Listeners receive each event in RN's propagation order for this lane",
    "state": prefix + "/Capture is pending at once, active from the next sample and released by Up, Cancel or removal",
    "cleanup": prefix + "/The case ends without a retained pointer, capture, route or touch",
  }
  # The same Godot samples produce the same native sequence in every lane.
  var sequence_ok := raw.size() == expected.size()
  var pointers := {}
  if sequence_ok:
    for index in range(raw.size()):
      var row: Dictionary = raw[index]
      var want: Dictionary = expected[index].spec
      var step: Dictionary = steps[expected[index].step]
      var slot: String = want.finger
      if not pointers.has(slot):
        pointers[slot] = row.pointerId
      sequence_ok = (sequence_ok and row.type == RAW[want.kind] and int(row.target) == int(tags[want.node]) and
        row.pointerId == pointers[slot] and int(row.sequence) in step.raw)
    var ids := pointers.values()
    for index in range(ids.size()):
      sequence_ok = sequence_ok and ids.find(ids[index]) == index
  check(sequence_ok, kinds.sequence)
  # Every event but hover copies its sample's page point and pointer type, and
  # projects the offset onto its own (retargeted) target. Got/lost copy the
  # sample of the event that processed them: same pointer, buttons, primary
  # flag, page point and timestamp.
  var payload_ok := sequence_ok
  if payload_ok:
    for index in range(raw.size()):
      var row: Dictionary = raw[index]
      var want: Dictionary = expected[index].spec
      var step: Dictionary = steps[expected[index].step]
      var point := Vector2(float(step.point[0]), float(step.point[1]))
      var pointer_type := "touch" if spec.id.begins_with("touch/") else "mouse"
      payload_ok = (payload_ok and row.pointerType == pointer_type and is_equal_approx(float(row.clientX), point.x) and
        is_equal_approx(float(row.clientY), point.y))
      if not want.kind in ["over", "out", "enter", "leave"]:
        var offset: Vector2 = point - ORIGINS[want.node]
        payload_ok = payload_ok and is_equal_approx(float(row.offsetX), offset.x) and is_equal_approx(float(row.offsetY), offset.y)
      if want.kind in ["got", "lost"]:
        var same: Array = raw.filter(func(other: Dictionary) -> bool:
          return int(other.sequence) in step.raw and other.pointerId == row.pointerId and not other.type in [RAW.got, RAW.lost])
        payload_ok = payload_ok and not same.is_empty() and same.all(func(other: Dictionary) -> bool:
          return (float(other.timeStamp) == float(row.timeStamp) and int(other.buttons) == int(row.buttons) and
            int(other.button) == int(row.button) and other.isPrimary == row.isPrimary))
  check(payload_ok, kinds.payload)
  # One dispatch per raw event: its callbacks share its payload, follow RN's
  # propagation and run at Discrete priority for capture, hover and click.
  var observed: Array = value.events.map(func(row: Dictionary) -> Array:
    return [row.name, row.label, row.kind, int(row.phase) if row.phase != null else null])
  var wanted: Array = []
  var delivery_ok := sequence_ok
  if delivery_ok:
    for index in range(raw.size()):
      var row: Dictionary = raw[index]
      var want: Dictionary = expected[index].spec
      var next_sequence: int = int(raw[index + 1].sequence) if index + 1 < raw.size() else 1 << 30
      var expected_rows: Array = callbacks(want.kind, want.node).map(func(entry: Array) -> Array:
        return [name, entry[0], entry[1], entry[2]])
      wanted.append_array(expected_rows)
      var own: Array = value.events.filter(func(event: Dictionary) -> bool:
        return int(event.sequence) > int(row.sequence) and int(event.sequence) < next_sequence)
      # RN's native dispatch builds every event cancelable; only enter/leave
      # (skipBubbling) do not bubble.
      var bubbles: bool = not want.kind in ["enter", "leave"]
      delivery_ok = delivery_ok and own.size() == expected_rows.size() and own.all(func(event: Dictionary) -> bool:
        var discrete: bool = not want.kind in ["got", "lost", "over", "out", "enter", "leave", "click"] or int(event.currentPriority) == int(value.discretePriority)
        var current_ok: bool = (event.currentIsDocument if event.label.begins_with("Doc") else event.currentIsElement if event.label.begins_with("Root")
          else event.currentTag != null and int(event.currentTag) == int(tags[event.label.left(2) if event.label.begins_with("L") else event.label.left(1)]))
        return (event.payloadId == row.payloadId and int(event.targetTag) == int(row.target) and discrete and current_ok and
          event.type == (DOM[want.kind] if native_dispatch else null) and event.trusted == native_dispatch and
          event.originalEvent == native_dispatch and event.compiledLegacySynthetic == (not native_dispatch) and
          (not native_dispatch or (event.bubbles == bubbles and event.cancelable == true))))
  check(delivery_ok and observed == wanted and value.globalEventRestored and int(value.currentPriority) == int(value.defaultPriority),
    kinds.delivery)
  # hasPointerCapture reads the pending owner right after each call; between
  # samples the native registries hold [pending, active] owners.
  var actions_ok: bool = value.actions.size() == spec.actions.size()
  if actions_ok:
    for index in range(value.actions.size()):
      var row: Dictionary = value.actions[index]
      var want: Array = spec.actions[index]
      actions_ok = actions_ok and row.at == want[0] and row.action == want[1] and row.node == want[2]
      for key: String in row.has:
        actions_ok = actions_ok and row.has[key] == (key == want[3])
  var counts_ok := true
  for index in range(steps.size()):
    counts_ok = counts_ok and steps[index].capture == spec.steps[index][2]
  # Inside gotpointercapture the pending owner is already its target; inside
  # lostpointercapture it is the next owner of a transfer, or nobody.
  if sequence_ok:
    for index in range(raw.size()):
      var want: Dictionary = expected[index].spec
      if not want.kind in ["got", "lost"]:
        continue
      var owner: String = want.node if want.kind == "got" else ""
      for later: int in range(index + 1, raw.size()):
        var following: Dictionary = expected[later].spec
        if expected[later].step == expected[index].step and following.kind == "got" and following.finger == want.finger:
          owner = following.node if want.kind == "lost" else owner
          break
      var row: Dictionary = raw[index]
      var next_sequence: int = int(raw[index + 1].sequence) if index + 1 < raw.size() else 1 << 30
      for event: Dictionary in value.events:
        if int(event.sequence) > int(row.sequence) and int(event.sequence) < next_sequence:
          for key: String in event.has:
            actions_ok = actions_ok and event.has[key] == (key == owner)
  # A removed ref is disconnected and no longer reports capture.
  for step: Dictionary in steps:
    if step.action[0] == "remove":
      var removed: Dictionary = step.current
      actions_ok = (actions_ok and removed.has.L2 == null and removed.has.L1 == false and
        removed.retained.L2.connected == false and removed.retained.L2.has == false)
  var final_current: Dictionary = steps[-1].current
  if final_current.has != null:
    for key: String in final_current.has:
      actions_ok = actions_ok and final_current.has[key] != true
  check(actions_ok and counts_ok, kinds.state)
  check(int(after.pointer.activeTouches) == 0 and int(app.pointerProcessor.active) == 0 and
      int(app.pointerProcessor.pendingCapture) == 0 and int(app.pointerProcessor.activeCapture) == 0 and
      int(app.pointerRouting.active) == 0, kinds.cleanup)

func _initialize() -> void:
  var args := OS.get_cmdline_user_args()
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
  application.name = "PointerCaptureNotificationsApplication"
  application.set("bundle_path", "res://build/pointer-capture-notifications-" + flag_mode + ".js")
  root.add_child(application)
  mount("A", Vector2.ZERO)
  mount("B", Vector2(340, 0))
  await settle()
  var installed := interest_mode == "current" and native_dispatch
  check(native(application).rootCount == 2 and native(application).pointerListenerQueryInstalled == installed,
    "mount/Two actual roots share Hermes; only the current interest with D installs the SDK query")
  var listeners: Array = []
  for label: String in ["DocC", "RootC", "L1C", "L1B", "GB", "RootB", "DocB"]:
    if (label.begins_with("Doc") and native_dispatch) or (imperative and native_dispatch):
      listeners.append(label)
  var methods := func(available: bool) -> Array: return ["function", "function", "function"] if available else ["undefined", "undefined", "undefined"]
  for name: String in ["A", "B"]:
    var capability: Dictionary = js("configure(%s,%d)" % [JSON.stringify(name), int(native(surfaces[name]).surfaceId)])
    stages["capability" + name] = capability
    check(capability.flags.imperative == imperative and capability.flags.nativeDispatch == native_dispatch and
        capability.methods.doc == methods.call(native_dispatch) and capability.methods.element == methods.call(imperative and native_dispatch) and
        capability.methods.view == methods.call(imperative and native_dispatch) and capability.installed == listeners and
        capability.captureMethods == ["function", "function", "function"] and int(capability.query.installations) == (1 if installed else 0),
      "capability/" + name + "/The lane exposes the original capture methods and exactly its Document, documentElement and View listeners")
  for spec: Dictionary in cases():
    await run_case(spec)
  # RN emits got/lost without consulting any listener; neither reads a Map.
  var capture_lookups: Array = []
  for key: String in stages:
    var stage: Variant = stages[key]
    if stage is Dictionary and stage.has("react"):
      for row: Dictionary in stage.react.query.rows:
        if int(row.offset) in [32, 33]:
          capture_lookups.append([key, int(row.offset)])
  stages.captureLookups = capture_lookups
  check(capture_lookups.is_empty(), "query/No capture notification reads a listener Map, in any lane")
  stages.beforeStop = {"application": native(application), "react": js("snapshot()")}
  check(stages.beforeStop.application.errors.is_empty(), "cleanup/No dispatch, query or capture diagnostic was hidden")
  application.call("stop")
  await settle()
  var stopped := native(application)
  check(stopped.stopped and not stopped.pointerListenerQueryInstalled and stopped.rootCount == 0 and stopped.pendingWork == 0 and
      stopped.pointerProcessor.active == 0 and stopped.pointerProcessor.pendingCapture == 0 and
      stopped.pointerProcessor.activeCapture == 0 and stopped.pointerProcessor.hover == 0 and
      stopped.pointerRouting.contacts == 0 and stopped.pointerRouting.stored == 0 and stopped.errors.is_empty(),
    "cleanup/Stop balances roots, query work, routes, captures and hover without diagnostics")
  for name: String in ["A", "B"]:
    var final_root := native(surfaces[name])
    check(final_root.nativeTags == 0 and final_root.creates == final_root.deletes, "cleanup/" + name + "/All real native Controls are balanced")
    stages["stoppedRoot" + name] = final_root
    surfaces[name].queue_free()
  application.queue_free()
  await settle()
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var report := {"scenario": "native-pointer-capture-notifications", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "flagMode": flag_mode, "interestMode": interest_mode,
    "checks": checks, "failures": failures, "stages": stages, "afterStop": stopped, "allAssertionsPassed": failures.is_empty(),
    "scope": {"actualNativeInput": true, "originalHostComponents": true, "originalCaptureMethods": true,
      "realSDKQueryObservedOnlyForTest": true, "listenerRegistryMirrored": false, "hoverFollowsCaptureTarget": true,
      "clickFromPhysicalHitPaths": true, "lostOnTargetRemoval": false, "hoverOffsetsCertified": false,
      "transformedCaptureCertified": false, "publicDefaultEnabled": false, "hardwareCertified": false}}
  var output := FileAccess.open("res://build/pointer-capture-notifications-report.json", FileAccess.WRITE)
  if not check(output != null, "report/PointerCaptureNotifications report is saved with visible failures"):
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  print("POINTER_CAPTURE_NOTIFICATIONS_PASSED: " + str(checks.size()) if failures.is_empty() else "POINTER_CAPTURE_NOTIFICATIONS_FAILED")
  quit(0 if failures.is_empty() else 1)
