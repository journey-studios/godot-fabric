extends Node

const DEVICE := 1001
const ORIGINS := {"A": Vector2(20, 30), "B": Vector2(420, 30), "C": Vector2(820, 30)}
const BOX_ORIGINS := {"left": Vector2(20, 125), "right": Vector2(200, 125), "press": Vector2(20, 320)}
const POINTER_FIELDS := ["pointerId", "pressure", "clientX", "clientY", "x", "y", "pageX", "pageY", "screenX", "screenY",
  "offsetX", "offsetY", "width", "height", "tiltX", "tiltY", "detail", "buttons", "tangentialPressure", "twist", "button", "target", "timeStamp"]

var checks: Array = []
var stages: Dictionary = {}
var injections: Array = []
var pixels: Array = []
var independent: Node
var surface_c: Control
var bindings: Array = []
var retire_requests: Array = []
var stop_requests: Array = []
@onready var application: Node = $Application
@onready var surfaces: Dictionary = {"A": $A, "B": $B}

func _enter_tree() -> void:
  # Typed services are registered before the first AppRegistry root starts.
  # Calls from JSX event handlers use the normal native work queue; these are
  # deliberately not described as synchronous JS callback reentrancy.
  var owner := get_node("Application")
  bindings.append(owner.call("register_method", "pointer.retire", request_retire, ["string"], "boolean", {}))
  bindings.append(owner.call("register_method", "pointer.stop", request_stop, ["string"], "boolean", {}))

func request_retire(name: String) -> bool:
  retire_requests.append(name)
  if surfaces.has(name):
    surfaces[name].call("unmount")
    return true
  return false

func request_stop(name: String) -> bool:
  stop_requests.append(name)
  application.call("stop")
  return true

func verify(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

func frames(count: int = 6) -> void:
  for index in range(count):
    await get_tree().process_frame

func settle() -> void:
  await frames(5)
  await get_tree().create_timer(0.02).timeout
  await frames(2)

func owner(name: String) -> Node:
  return independent if name == "C" else application

func js(expression: String, name: String = "A") -> Variant:
  return JSON.parse_string(owner(name).call("evaluate", "JSON.stringify(" + expression + ")"))

func react(name: String = "A") -> Dictionary:
  var value: Variant = js("GodotPointers.snapshot()", name)
  return value if value is Dictionary else {}

func native(node: Node) -> Dictionary:
  var value: Variant = JSON.parse_string(node.call("snapshot"))
  return value if value is Dictionary else {}

func panel_ref(name: String, id: String) -> Dictionary:
  var value: Variant = react(name).get("live", {}).get(name, {}).get("refs", {}).get(id)
  return value if value is Dictionary else {}

func control(name: String, id: String) -> Control:
  return surfaces[name].find_child(name + "-" + id, true, false) as Control

func query(name: String, id: String, pointer_id: int) -> bool:
  return js("GodotPointers.query(%s,%s,%d)" % [JSON.stringify(name), JSON.stringify(id), pointer_id], name) == true

func action(name: String, operation: String, id: String = "left", pointer_id: int = -1, wait: bool = true) -> void:
  owner(name).call("evaluate", "GodotPointers.action(%s,%s,%s,%d)" % [JSON.stringify(name), JSON.stringify(operation), JSON.stringify(id), pointer_id])
  if wait:
    await settle()

func retain(name: String, id: String, key: String) -> void:
  owner(name).call("evaluate", "GodotPointers.retain(%s,%s,%s)" % [JSON.stringify(name), JSON.stringify(id), JSON.stringify(key)])

func clear(name: String = "A") -> void:
  owner(name).call("evaluate", "GodotPointers.clear()")

func events(name: String = "A", types: Array = []) -> Array:
  var result: Array = []
  for entry: Dictionary in react(name).get("events", []):
    if types.is_empty() or entry.get("type") in types:
      result.append(entry)
  return result

func trace(name: String = "A", types: Array = ["GotPointerCapture", "LostPointerCapture", "Move", "Up", "Cancel"]) -> Array:
  return events(name, types).map(func(entry: Dictionary) -> String: return str(entry.name) + "/" + str(entry.id) + "/" + str(entry.type))

func last_event(name: String, id: String, type: String) -> Dictionary:
  var found := {}
  for entry: Dictionary in events(name, [type]):
    if entry.get("name") == name and entry.get("id") == id:
      found = entry
  return found

func event_count(name: String, id: String, type: String) -> int:
  return events(name, [type]).filter(func(entry: Dictionary) -> bool: return entry.get("name") == name and entry.get("id") == id).size()

func point(name: String, id: String, local: Vector2 = Vector2(35, 55)) -> Vector2:
  # Input and expected coordinates derive from JSX declarations, never measured
  # Control rectangles or the host's own inverse implementation.
  return ORIGINS[name] + BOX_ORIGINS[id] + local

func screen_point(logical: Vector2) -> Vector2:
  var transform := get_window().get_final_transform()
  var density := (transform * get_window().get_global_canvas_transform().affine_inverse()).get_scale().x
  return (Vector2(get_window().position) + transform * logical) / density

func inject(kind: String, phase: String, logical: Vector2, index: int = 0, buttons: int = -1) -> void:
  var event: InputEvent
  if kind == "mouse":
    if phase in ["move", "hover"]:
      var motion := InputEventMouseMotion.new()
      motion.position = logical
      motion.button_mask = buttons if buttons >= 0 else (MOUSE_BUTTON_MASK_LEFT if phase == "move" else 0)
      event = motion
    else:
      var button := InputEventMouseButton.new()
      button.position = logical
      button.button_index = MOUSE_BUTTON_LEFT
      button.pressed = phase == "down"
      button.canceled = phase == "cancel"
      button.button_mask = MOUSE_BUTTON_MASK_LEFT if button.pressed else 0
      event = button
  elif phase == "move":
    var drag := InputEventScreenDrag.new()
    drag.index = index
    drag.position = logical
    drag.pressure = 1.0
    event = drag
  else:
    var touch := InputEventScreenTouch.new()
    touch.index = index
    touch.position = logical
    touch.pressed = phase == "down"
    touch.canceled = phase == "cancel"
    event = touch
  event.device = DEVICE
  injections.append({"kind": kind, "phase": phase, "index": index, "point": [logical.x, logical.y], "screen": [screen_point(logical).x, screen_point(logical).y]})
  Input.parse_input_event(event)
  await settle()

func coordinates(entry: Dictionary, name: String, id: String, logical: Vector2, kind: String, pressed: bool, stage: String) -> void:
  var value: Dictionary = entry.get("native", {})
  var client: Vector2 = logical - ORIGINS[name]
  var local: Vector2 = client - BOX_ORIGINS[id]
  var screen := screen_point(logical)
  var all_finite := not value.is_empty()
  for field: String in POINTER_FIELDS:
    var number: Variant = value.get(field)
    all_finite = all_finite and typeof(number) in [TYPE_INT, TYPE_FLOAT] and not is_nan(float(number)) and not is_inf(float(number))
  verify(all_finite, stage + ": Original PointerEvent serializes every numeric field finitely")
  verify(value.get("pointerType") == kind and value.get("isPrimary") is bool and
    value.get("ctrlKey") is bool and value.get("shiftKey") is bool and value.get("altKey") is bool and value.get("metaKey") is bool,
    stage + ": Native pointer type, primary and modifier fields retain their public types")
  verify(absf(float(value.get("clientX", -999)) - client.x) < 0.1 and absf(float(value.get("clientY", -999)) - client.y) < 0.1 and
    value.get("clientX") == value.get("x") and value.get("clientY") == value.get("y") and
    value.get("clientX") == value.get("pageX") and value.get("clientY") == value.get("pageY"),
    stage + ": Declared owner-root client coordinates and original x/page aliases agree")
  verify(absf(float(value.get("offsetX", -999)) - local.x) < 0.1 and absf(float(value.get("offsetY", -999)) - local.y) < 0.1 and
    absf(float(value.get("screenX", -999)) - screen.x) < 0.1 and absf(float(value.get("screenY", -999)) - screen.y) < 0.1,
    stage + ": Declared target-local and current window screen coordinates agree")
  verify(int(value.get("target", -1)) == int(panel_ref(name, id).get("tag", -2)) and
    int(value.get("buttons", -1)) == (1 if pressed else 0) and float(value.get("timeStamp", 0)) > 0,
    stage + ": Public event target, button state and timestamp describe the actual contact")

func mouse_buttons(pressed: bool, button_index: int, mask: int, logical: Vector2) -> void:
  var event := InputEventMouseButton.new()
  event.device = DEVICE
  event.position = logical
  event.button_index = button_index
  event.button_mask = mask
  event.pressed = pressed
  injections.append({"kind": "mouse", "phase": "down" if pressed else "up", "buttonIndex": button_index, "mask": mask, "point": [logical.x, logical.y]})
  Input.parse_input_event(event)
  await settle()

func registry(active: int, pending: int, active_capture: int, stage: String) -> void:
  var state := native(application)
  var processor: Dictionary = state.get("pointerProcessor", {})
  verify(not processor.is_empty() and int(processor.get("active", -1)) == active and
    int(processor.get("pendingCapture", -1)) == pending and int(processor.get("activeCapture", -1)) == active_capture,
    stage + ": Original RN active, pending-capture and active-capture registries match")
  stages[stage] = {"react": react(), "application": state, "roots": {"A": native(surfaces.A), "B": native(surfaces.B)}}

func stale(key: String, pointer_id: int, stage: String) -> void:
  var value: Variant = js("GodotPointers.stale(%s,%d)" % [JSON.stringify(key), pointer_id])
  var state: Dictionary = value if value is Dictionary else {}
  verify(not state.is_empty() and not state.get("connected", true) and not state.get("before", true) and
    not state.get("afterSet", true) and not state.get("afterRelease", true),
    stage + ": Retained disconnected public ref cannot query, set or restore capture")

func frames_oracle() -> void:
  for name: String in ["A", "B", "C"]:
    for id: String in ["left", "right", "press"]:
      var node := control(name, id)
      var expected: Vector2 = ORIGINS[name] + BOX_ORIGINS[id]
      var expected_size := Vector2(320, 60) if id == "press" else Vector2(140, 145)
      verify(node != null and node.get_global_transform_with_canvas().origin.distance_to(expected) < 0.1 and node.size.distance_to(expected_size) < 0.1,
        "Independent declared View/Pressable native frame " + name + "-" + id)

func capture_image(stage: String) -> void:
  if not OS.get_cmdline_user_args().has("--capture"):
    return
  print("POINTER_CAPTURE_BEGIN: " + stage)
  get_window().grab_focus()
  await settle()
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  for name: String in ["A", "B", "C"]:
    for id: String in ["left", "right"]:
      var logical := point(name, id, Vector2(110, 115))
      var physical: Vector2 = get_window().get_final_transform() * logical
      var pixel := Vector2i(floori(physical.x), floori(physical.y))
      var in_bounds := pixel.x >= 0 and pixel.y >= 0 and pixel.x < image.get_width() and pixel.y < image.get_height()
      var actual := image.get_pixelv(pixel) if in_bounds else Color.TRANSPARENT
      var expected_hex: String = "#0284c7" if id == "left" else "#0f766e"
      var expected := Color(expected_hex)
      var passed := in_bounds and maxf(absf(actual.r - expected.r), maxf(absf(actual.g - expected.g), absf(actual.b - expected.b))) <= 0.025 and actual.a > 0.99
      verify(passed, "Declared native View paints pointer sample: " + stage + " " + name + "-" + id)
      pixels.append({"stage": stage, "root": name, "box": id, "point": [pixel.x, pixel.y], "expected": expected_hex,
        "actual": [actual.r, actual.g, actual.b, actual.a], "passed": passed})
  verify(image.save_png("res://build/pointers-" + stage + ".png") == OK, "Native pointer screenshot saved: " + stage)
  print("POINTER_CAPTURE_END: " + stage)

func mount_independent() -> void:
  independent = ClassDB.instantiate("FabricApplication")
  independent.name = "IndependentApplication"
  independent.set("bundle_path", application.get("bundle_path"))
  independent.set_meta("scenario", "pointers")
  add_child(independent)
  surface_c = ClassDB.instantiate("FabricSurface") as Control
  surface_c.name = "C"
  surface_c.position = ORIGINS.C
  surface_c.size = Vector2(360, 500)
  surface_c.set("application_path", NodePath("../IndependentApplication"))
  surface_c.set("component_name", "PointerPanel")
  surface_c.set("initial_props", {"name": "C"})
  surface_c.set_meta("validation_input_device", DEVICE)
  surfaces.C = surface_c
  add_child(surface_c)

func _ready() -> void:
  get_window().size = Vector2i(1200, 590)
  for node: Control in surfaces.values():
    node.set_meta("validation_input_device", DEVICE)
  mount_independent()
  if OS.get_cmdline_user_args().has("--validate"):
    call_deferred("run_checks")

func run_checks() -> void:
  var deadline := Time.get_ticks_msec() + 5000
  while Time.get_ticks_msec() < deadline and (react().get("mounts", {}).size() != 2 or react("C").get("mounts", {}).size() != 1):
    await frames(1)
  await settle()
  if not verify(react().get("mounts", {}) == {"A": 1.0, "B": 1.0} and react("C").get("mounts", {}) == {"C": 1.0},
    "Original AppRegistry mounts two shared pointer roots and one independent runtime"):
    await finish()
    return
  verify(native(application).get("runtimeId") != native(independent).get("runtimeId") and
    native(application).get("bundleEvaluations") == 1 and native(independent).get("bundleEvaluations") == 1,
    "Pointer roots retain shared-versus-independent Hermes runtime identity")
  verify(bindings.size() == 2 and bindings.all(func(binding: Variant) -> bool: return binding != null), "Pointer lifecycle requests use registered typed Godot service methods")
  for name: String in ["A", "B", "C"]:
    for id: String in ["left", "right"]:
      verify(panel_ref(name, id).get("connected", false) and panel_ref(name, id).get("methods", false),
        "Public View ref exposes original connected capture methods " + name + "-" + id)
  frames_oracle()
  await capture_image("initial")

  # Hover is not an active buttons contact and cannot acquire capture.
  clear()
  await inject("mouse", "hover", point("A", "left"))
  var hover := last_event("A", "left", "Move")
  coordinates(hover, "A", "left", point("A", "left"), "mouse", false, "hover")
  var mouse_id := int(hover.get("native", {}).get("pointerId", -1))
  verify(mouse_id >= 0 and event_count("A", "left", "Move") == 1 and event_count("A", "left", "Over") == 1 and
    event_count("A", "left", "Enter") == 1, "One genuine mouse hover delivers original over/enter/move once")
  await action("A", "capture", "left", mouse_id)
  verify(not query("A", "left", mouse_id), "Buttons-free mouse hover cannot acquire pointer capture")
  await action("A", "capture", "left", 987654)
  await action("A", "release", "right", 987654)
  verify(not query("A", "left", 987654) and trace().count("A/left/GotPointerCapture") == 0,
    "Pinned RN inactive pointer IDs silently ignore capture and release")
  registry(0, 0, 0, "hover-no-capture")

  clear()
  await action("A", "arm")
  await inject("mouse", "down", point("A", "left"))
  var down := last_event("A", "left", "Down")
  coordinates(down, "A", "left", point("A", "left"), "mouse", true, "mouse-down")
  verify(int(down.get("native", {}).get("pointerId", -2)) == mouse_id and query("A", "left", mouse_id) and not query("A", "right", mouse_id) and
    event_count("A", "left", "GotPointerCapture") == 0, "Down callback sets pending capture immediately without premature got notification")
  registry(1, 1, 0, "pending-before-next-event")
  clear()
  await inject("mouse", "move", point("A", "right"))
  verify(trace() == ["A/left/GotPointerCapture", "A/left/Move"], "Next sibling move emits got before move on the captured original View")
  coordinates(last_event("A", "left", "Move"), "A", "left", point("A", "right"), "mouse", true, "captured-sibling")
  registry(1, 1, 1, "active-sibling-capture")
  clear()
  await action("A", "capture", "left", mouse_id)
  await action("A", "release", "right", mouse_id)
  verify(query("A", "left", mouse_id) and not query("A", "right", mouse_id) and events().is_empty(),
    "Repeated capture and wrong-owner release leave pending ownership and callbacks intact")
  await inject("mouse", "move", point("B", "right"))
  verify(trace() == ["A/left/Move"] and event_count("B", "right", "Move") == 0,
    "Captured owner receives movement beyond its surface across a shared sibling root once")
  coordinates(last_event("A", "left", "Move"), "A", "left", point("B", "right"), "mouse", true, "cross-root-drag")
  clear()
  var outside := Vector2(1190, 570)
  await inject("mouse", "move", outside)
  verify(trace() == ["A/left/Move"], "Active capture receives real movement outside every mounted root")
  coordinates(last_event("A", "left", "Move"), "A", "left", outside, "mouse", true, "outside-all-drag")

  clear()
  await action("A", "capture", "right", mouse_id)
  verify(not query("A", "left", mouse_id) and query("A", "right", mouse_id) and events().is_empty(), "Transfer updates pending queries before callbacks")
  await inject("mouse", "move", point("A", "left"))
  verify(trace() == ["A/left/LostPointerCapture", "A/right/GotPointerCapture", "A/right/Move"],
    "Capture transfer emits lost old then got new before retargeted move")
  clear()
  await action("A", "release", "right", mouse_id)
  verify(not query("A", "right", mouse_id) and events().is_empty(), "Explicit release clears the pending query before delayed lost notification")
  await inject("mouse", "move", point("A", "left"))
  verify(trace() == ["A/right/LostPointerCapture", "A/left/Move"], "Next event delivers lost and resumes the original physical hit target")
  await action("A", "capture", "left", mouse_id)
  await inject("mouse", "move", point("A", "right"))
  clear()
  await inject("mouse", "up", point("B", "right"))
  verify(trace() == ["A/left/Up", "A/left/LostPointerCapture"] and not query("A", "left", mouse_id),
    "Captured mouse up precedes implicit lost capture and cannot retain ownership")
  registry(0, 0, 0, "mouse-up-releases")
  await action("A", "capture", "left", mouse_id)
  verify(not query("A", "left", mouse_id), "An ended mouse contact cannot reacquire capture through a retained ID")
  await inject("mouse", "hover", outside)

  clear()
  await inject("mouse", "down", point("A", "press", Vector2(40, 25)))
  await inject("mouse", "cancel", point("A", "press", Vector2(40, 25)))
  var cancel_deadline := Time.get_ticks_msec() + 1000
  while event_count("A", "press", "PressOut") != 1 and Time.get_ticks_msec() < cancel_deadline:
    await frames(2)
  verify(event_count("A", "press", "TouchCancel") == 1 and event_count("A", "press", "TouchEnd") == 0 and
    event_count("A", "press", "PressOut") == 1 and event_count("A", "press", "Press") == 0,
    "Canceled native mouse contact terminates Touch/Pressability without activation")
  registry(0, 0, 0, "canceled-mouse-does-not-press")

  clear()
  await action("A", "arm")
  await mouse_buttons(true, MOUSE_BUTTON_LEFT, MOUSE_BUTTON_MASK_LEFT | MOUSE_BUTTON_MASK_RIGHT, point("A", "left"))
  var buttons_id := int(last_event("A", "left", "Down").get("native", {}).get("pointerId", -1))
  verify(int(last_event("A", "left", "Down").get("native", {}).get("buttons", -1)) == 3 and query("A", "left", buttons_id),
    "Authoritative multi-button native down keeps the original W3C buttons bitmask")
  await mouse_buttons(false, MOUSE_BUTTON_LEFT, MOUSE_BUTTON_MASK_RIGHT, point("B", "right"))
  verify(event_count("A", "left", "Up") == 0 and query("A", "left", buttons_id),
    "Releasing one of two held buttons preserves the original active contact and capture")
  clear()
  await inject("mouse", "move", point("B", "right"), 0, MOUSE_BUTTON_MASK_RIGHT)
  verify(trace() == ["A/left/Move"] and int(last_event("A", "left", "Move").get("native", {}).get("buttons", -1)) == 2 and
    query("A", "left", buttons_id), "Remaining native button retains one root owner while moving across sibling root")
  clear()
  await mouse_buttons(false, MOUSE_BUTTON_RIGHT, 0, point("B", "right"))
  verify(trace().count("A/left/Up") == 1 and trace().count("A/left/LostPointerCapture") == 1 and
    event_count("B", "right", "Move") == 0 and not query("A", "left", buttons_id),
    "Last physical button delivers one Up/lost and no duplicate sibling release sample")
  registry(0, 0, 0, "multi-button-last-release")

  # Existing Pressability/touch delivery remains a separate upstream path.
  clear()
  await inject("touch", "down", point("A", "press", Vector2(40, 25)), 10)
  await inject("touch", "up", point("A", "press", Vector2(40, 25)), 10)
  var press_deadline := Time.get_ticks_msec() + 1000
  while event_count("A", "press", "PressOut") != 1 and Time.get_ticks_msec() < press_deadline:
    await frames(2)
  verify(event_count("A", "press", "TouchStart") == 1 and event_count("A", "press", "TouchEnd") == 1 and
    event_count("A", "press", "PressIn") == 1 and event_count("A", "press", "PressOut") == 1 and event_count("A", "press", "Press") == 1 and
    react().get("live", {}).get("A", {}).get("state", {}).get("presses") == 1,
    "Real touch retains original Pressability negotiation and one completed activation")

  # Simultaneous root contacts have application-wide IDs; cancellation is
  # selective and never resets another root's processor/capture state.
  clear()
  await action("A", "arm")
  await inject("touch", "down", point("A", "left"), 20)
  var touch_a := int(last_event("A", "left", "Down").get("native", {}).get("pointerId", -1))
  await inject("touch", "move", point("A", "right"), 20)
  await action("B", "arm")
  await inject("touch", "down", point("B", "left"), 21)
  var touch_b := int(last_event("B", "left", "Down").get("native", {}).get("pointerId", -1))
  await inject("touch", "move", point("B", "right"), 21)
  verify(touch_a >= 0 and touch_b >= 0 and touch_a != touch_b and touch_a != mouse_id and touch_b != mouse_id and
    query("A", "left", touch_a) and query("B", "left", touch_b), "Concurrent contacts across shared roots retain distinct live IDs and captures")
  registry(2, 2, 2, "two-shared-captures")
  coordinates(last_event("B", "left", "Move"), "B", "left", point("B", "right"), "touch", true, "root-B-touch")
  clear()
  await inject("touch", "cancel", point("A", "right"), 20)
  verify(trace() == ["A/left/Cancel", "A/left/LostPointerCapture"] and not query("A", "left", touch_a) and query("B", "left", touch_b),
    "Cancel releases only its changed contact and preserves another root's capture")
  registry(1, 1, 1, "selective-contact-cancel")
  clear()
  await inject("touch", "move", point("B", "right"), 21)
  verify(trace() == ["B/left/Move"], "Surviving root continues receiving its original captured pointer after another contact cancels")
  await inject("touch", "up", point("B", "right"), 21)
  registry(0, 0, 0, "shared-touch-release")

  clear("C")
  await action("C", "arm")
  await inject("touch", "down", point("C", "left"), 30)
  var independent_id := int(last_event("C", "left", "Down").get("native", {}).get("pointerId", -1))
  await inject("touch", "move", point("C", "right"), 30)
  verify(independent_id >= 0 and query("C", "left", independent_id) and
    int(native(independent).get("pointerProcessor", {}).get("active", -1)) == 1 and
    int(native(application).get("pointerProcessor", {}).get("active", -1)) == 0,
    "An independent application owns its own pointer processor without acquiring contacts in the shared application")
  coordinates(last_event("C", "left", "Move"), "C", "left", point("C", "right"), "touch", true, "independent-touch")
  await inject("touch", "up", point("C", "right"), 30)
  verify(not query("C", "left", independent_id), "Independent capture also releases on real up")

  # Removal of a capture target whose physical origin survives strips only
  # capture. It must not invoke a lost handler on the disconnected target.
  clear()
  await inject("touch", "down", point("A", "left"), 40)
  var deletion_id := int(last_event("A", "left", "Down").get("native", {}).get("pointerId", -1))
  await action("A", "capture", "right", deletion_id)
  await inject("touch", "move", point("A", "left"), 40)
  retain("A", "right", "removed-active-target")
  var old_tag := int(panel_ref("A", "right").get("tag", -1))
  clear()
  await action("A", "remove", "right")
  stale("removed-active-target", deletion_id, "active target removal")
  registry(1, 0, 0, "capture-target-removed-origin-survives")
  await inject("touch", "move", point("A", "left"), 40)
  verify(trace() == ["A/left/Move"] and control("A", "right") == null, "Removed capture target cannot receive lost/move while the surviving physical origin remains usable")
  await inject("touch", "up", point("A", "left"), 40)
  await action("A", "restore", "right")
  verify(int(panel_ref("A", "right").get("tag", -1)) != old_tag, "Restored sibling receives a new native identity rather than the disconnected capture ref")

  # Pending and active origin deletion cancel only the removed-origin contact.
  for activation: bool in [false, true]:
    clear()
    await action("A", "arm")
    await inject("touch", "down", point("A", "left"), 50)
    var origin_id := int(last_event("A", "left", "Down").get("native", {}).get("pointerId", -1))
    if activation:
      await inject("touch", "move", point("A", "right"), 50)
    var key := "removed-active-origin" if activation else "removed-pending-origin"
    retain("A", "left", key)
    clear()
    await action("A", "remove", "left")
    stale(key, origin_id, key)
    registry(0, 0, 0, key)
    clear()
    await inject("touch", "move", point("A", "right"), 50)
    await inject("touch", "up", point("A", "right"), 50)
    verify(trace().is_empty(), key + ": Late native movement/up cannot resurrect a removed-origin contact")
    await action("A", "restore", "left")

  clear()
  await action("A", "arm")
  await inject("touch", "down", point("A", "left"), 60)
  var replacement_id := int(last_event("A", "left", "Down").get("native", {}).get("pointerId", -1))
  await inject("touch", "move", point("A", "right"), 60)
  retain("A", "left", "replaced")
  var replaced_tag := int(panel_ref("A", "left").get("tag", -1))
  await action("A", "replace", "left")
  stale("replaced", replacement_id, "keyed capture origin replacement")
  verify(panel_ref("A", "left").get("connected", false) and int(panel_ref("A", "left").get("tag", -1)) != replaced_tag,
    "Key replacement disconnects the captured old ref and commits a distinct live View")
  registry(0, 0, 0, "keyed-origin-replaced")
  await inject("touch", "up", point("A", "left"), 60)

  clear()
  await action("A", "arm")
  await action("A", "callback:Move:remove")
  await inject("touch", "down", point("A", "left"), 70)
  var callback_id := int(last_event("A", "left", "Down").get("native", {}).get("pointerId", -1))
  await inject("touch", "move", point("A", "right"), 70)
  stale("callback-removed", callback_id, "React pointer callback deletion")
  verify(control("A", "left") == null and react().get("actions", []).any(func(entry: Dictionary) -> bool: return entry.get("operation") == "callback:remove"),
    "A genuine captured move callback removes its own React View through setState")
  registry(0, 0, 0, "callback-origin-removed")
  await inject("touch", "up", point("A", "left"), 70)
  await action("A", "restore", "left")
  await action("A", "label", "Capture and deletion checks completed")
  await capture_image("updated")

  # Queue a typed Godot lifecycle request from the genuine JSX move callback.
  # The active B contact proves root retirement is selective.
  clear()
  await action("A", "arm")
  await inject("touch", "down", point("A", "left"), 80)
  var retiring_id := int(last_event("A", "left", "Down").get("native", {}).get("pointerId", -1))
  await inject("touch", "move", point("A", "right"), 80)
  retain("A", "left", "retired-root")
  await action("B", "arm")
  await inject("touch", "down", point("B", "left"), 81)
  var survivor_id := int(last_event("B", "left", "Down").get("native", {}).get("pointerId", -1))
  await inject("touch", "move", point("B", "right"), 81)
  await action("A", "callback:Move:retire")
  await inject("touch", "move", point("A", "right"), 80)
  verify(retire_requests == ["A"] and native(application).get("rootCount", -1) == 1 and react().get("cleanups", {}).get("A", 0) == 1,
    "Genuine pointer callback calls a typed queued Godot service to retire its own root once")
  stale("retired-root", retiring_id, "retired capture root")
  verify(query("B", "left", survivor_id), "Retiring one root preserves another root's existing active capture")
  registry(1, 1, 1, "root-retirement-preserves-survivor")
  clear()
  await inject("touch", "move", point("B", "right"), 81)
  verify(trace() == ["B/left/Move"], "Surviving root still handles the same captured contact after root retirement")
  await inject("touch", "up", point("A", "left"), 80)
  verify(query("B", "left", survivor_id), "Retired root's late up cannot release the surviving root's capture")
  await inject("touch", "up", point("B", "right"), 81)
  registry(0, 0, 0, "surviving-root-released")

  clear()
  await action("B", "arm")
  await inject("touch", "down", point("B", "left"), 90)
  var stopped_id := int(last_event("B", "left", "Down").get("native", {}).get("pointerId", -1))
  await inject("touch", "move", point("B", "right"), 90)
  retain("B", "left", "stopped-application")
  clear("C")
  await action("C", "arm")
  await inject("touch", "down", point("C", "left"), 92)
  var independent_survivor := int(last_event("C", "left", "Down").get("native", {}).get("pointerId", -1))
  await inject("touch", "move", point("C", "right"), 92)
  verify(independent_survivor >= 0 and query("C", "left", independent_survivor) and query("B", "left", stopped_id),
    "Two independent applications hold live captured contacts before one application stops")
  await action("B", "callback:Move:stop")
  await inject("touch", "move", point("B", "right"), 90)
  verify(stop_requests == ["B"] and native(application).get("stopped", false), "Genuine pointer callback queues typed Godot application stop")
  stale("stopped-application", stopped_id, "stopped pointer application")
  verify(query("C", "left", independent_survivor) and int(native(independent).get("pointerProcessor", {}).get("active", -1)) == 1,
    "Application stop preserves another application's already-active capture and original registry")
  clear("C")
  await inject("touch", "move", point("C", "right"), 92)
  verify(trace("C") == ["C/left/Move"], "Independent application continues its original captured contact after another application stops")
  await inject("touch", "up", point("C", "right"), 92)
  verify(not query("C", "left", independent_survivor), "Independent survivor releases through its own real up after another application stops")
  await inject("touch", "up", point("B", "left"), 90)
  clear("C")
  await inject("touch", "down", point("C", "press", Vector2(40, 25)), 91)
  await inject("touch", "up", point("C", "press", Vector2(40, 25)), 91)
  verify(event_count("C", "press", "Press") == 1 and not native(independent).get("stopped", true),
    "Independent application's original Pressability survives another application stop")
  await finish()

func finish() -> void:
  var before := {"shared": native(application), "independent": native(independent)}
  if not native(application).get("stopped", false):
    application.call("stop")
  independent.call("stop")
  await settle()
  var after := {"shared": native(application), "independent": native(independent)}
  var root_states := {}
  for name: String in ["A", "B", "C"]:
    var state := native(surfaces[name])
    root_states[name] = state
    verify(state.get("nativeTags", -1) == 0 and state.get("creates", -1) == state.get("deletes", -2) and state.get("nodes", ["missing"]).is_empty(),
      "Final pointer stop releases every native tag and Control in root " + name)
    var root_pointer: Dictionary = state.get("pointer", {})
    verify(int(root_pointer.get("activeTouches", -1)) == 0 and int(root_pointer.get("responder", -1)) == 0 and
      int(root_pointer.get("activePointers", -1)) == 0 and int(root_pointer.get("hoverPointers", -1)) == 0,
      "Final pointer stop clears contacts, responder and pointer ownership in root " + name)
  for name: String in ["shared", "independent"]:
    var state: Dictionary = after[name]
    var processor: Dictionary = state.get("pointerProcessor", {})
    verify(state.get("stopped", false) and state.get("rootCount", -1) == 0 and state.get("errors", ["missing"]).is_empty(),
      "Pointer application stops without hidden host errors: " + name)
    verify(state.get("pendingTimers", -1) == 0 and state.get("pendingAnimationFrames", -1) == 0 and
      state.get("pendingWork", -1) == 0 and state.get("pendingRootRetirements", -1) == 0,
      "Pointer stop releases queued work, timers and retirement scopes: " + name)
    verify(not processor.is_empty() and ["active", "pendingCapture", "activeCapture", "hover"].all(func(key: String) -> bool: return int(processor.get(key, -1)) == 0),
      "Final stop clears original active/capture/hover registries: " + name)
    var routing: Dictionary = state.get("pointerRouting", {})
    verify(not routing.is_empty() and ["contacts", "active", "hoverPointers", "stored", "suppressed"].all(func(key: String) -> bool: return int(routing.get(key, -1)) == 0),
      "Final stop clears application-wide physical contact routing: " + name)
  verify(react().get("errors", []).is_empty() and react("C").get("errors", []).is_empty(), "Typed pointer lifecycle callbacks leave no service rejection")
  var report := {"scenario": "pointers", "godot": Engine.get_version_info().string, "react": "19.2.3", "reactNative": "0.87.1",
    "engine": "hermes", "renderer": "fabric", "displayServer": DisplayServer.get_name(), "inputTransport": "Input.parse_input_event",
    "validationInputDevice": DEVICE, "checks": checks, "stages": stages, "pixels": pixels, "injections": injections,
    "retireRequests": retire_requests, "stopRequests": stop_requests, "beforeStop": before, "afterStop": after,
    "rootsStopped": root_states, "reactState": {"shared": react(), "independent": react("C")}}
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://build"))
  var output := FileAccess.open("res://build/report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_ERROR: Cannot write public pointer report")
    get_tree().quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  print("FABRIC_VALIDATION_FAILED: pointers" if failed else "FABRIC_VALIDATION_PASSED: pointers " + str(checks.size()))
  get_tree().quit(1 if failed else 0)
