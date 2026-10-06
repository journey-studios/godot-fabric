extends Node

const DEVICE := 1001
const COLORS := {"A/origin": "#0284c7", "A/capture": "#0f766e", "B/capture": "#a855f7", "A/flat": "#eab308"}
const TYPES := ["Down", "Move", "Up", "Cancel", "Over", "Out", "Enter", "Leave", "GotPointerCapture", "LostPointerCapture"]
var checks: Array = []
var stages: Dictionary = {}
var samples: Array = []
var injections: Array = []
var pixels: Array = []
var initial_ids: Dictionary = {}
var embeddings := {"A": {"position": Vector2(30, 30), "scale": Vector2.ONE},
  "B": {"position": Vector2(620, 50), "scale": Vector2.ONE}}
var phases := {"A": "initial", "B": "initial"}
var density := 1.0
var original_window: Dictionary = {}
@onready var application: Node = $Application
@onready var surfaces: Dictionary = {"A": $A, "B": $B}

func verify(condition: bool, id: String, name: String) -> bool:
  checks.append({"id": id, "name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + id + " " + name)
  return condition

func frames(count: int = 5) -> void:
  for index in range(count):
    await get_tree().process_frame

func settle() -> void:
  await frames()
  await get_tree().create_timer(0.02).timeout
  await frames(2)

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(" + expression + ")"))

func stats() -> Dictionary:
  var value: Variant = js("GodotPointerGeometry.snapshot()")
  return value if value is Dictionary else {}

func native(node: Node) -> Dictionary:
  var value: Variant = JSON.parse_string(node.call("snapshot"))
  return value if value is Dictionary else {}

func control(name: String, id: String) -> Control:
  return surfaces[name].find_child(name + "-" + id, true, false) as Control

func node_state(name: String, id: String) -> Dictionary:
  for entry: Dictionary in native(surfaces[name]).get("nodes", []):
    if entry.get("testID", "") == name + "-" + id:
      return entry
  return {}

func read(name: String, id: String) -> Dictionary:
  var value: Variant = js("GodotPointerGeometry.read(%s,%s,%s)" % [JSON.stringify(name), JSON.stringify(id), JSON.stringify(id + "-parent")])
  return value if value is Dictionary else {}

func clear() -> void:
  application.call("evaluate", "GodotPointerGeometry.clear()")

func action(name: String, operation: String, id: String, pointer_id: int = -1) -> bool:
  return js("GodotPointerGeometry.action(%s,%s,%s,%d)" % [JSON.stringify(name), JSON.stringify(operation), JSON.stringify(id), pointer_id]) == true

func query(name: String, id: String, pointer_id: int) -> bool:
  return js("GodotPointerGeometry.query(%s,%s,%d)" % [JSON.stringify(name), JSON.stringify(id), pointer_id]) == true

func events(types: Array = []) -> Array:
  return stats().get("events", []).filter(func(entry: Dictionary) -> bool: return types.is_empty() or entry.get("type") in types)

func trace() -> Array:
  return events(["GotPointerCapture", "LostPointerCapture", "Move", "Up", "Cancel"]).map(
    func(entry: Dictionary) -> String: return str(entry.name) + "/" + str(entry.id) + "/" + str(entry.type))

func last_event(name: String, id: String, type: String) -> Dictionary:
  var found := {}
  for entry: Dictionary in events([type]):
    if entry.get("name") == name and entry.get("id") == id:
      found = entry
  return found

func close_values(actual: Array, expected: Array, tolerance: float = 0.05) -> bool:
  if actual.size() != expected.size():
    return false
  for index in range(actual.size()):
    var value: Variant = actual[index]
    if typeof(value) not in [TYPE_INT, TYPE_FLOAT] or is_nan(float(value)) or is_inf(float(value)) or absf(float(value) - float(expected[index])) > tolerance:
      return false
  return true

func vector_values(value: Vector2) -> Array:
  return [value.x, value.y]

func affine_values(value: Transform2D) -> Array:
  return [value.x.x, value.x.y, value.y.x, value.y.y, value.origin.x, value.origin.y]

func rect_values(value: Dictionary) -> Array:
  return [value.get("x", -999), value.get("y", -999), value.get("width", -1), value.get("height", -1)]

func rect_array(value: Rect2) -> Array:
  return [value.position.x, value.position.y, value.size.x, value.size.y]

func translated(value: Vector2) -> Transform2D:
  return Transform2D(0.0, value)

func scaled(value: Vector2) -> Transform2D:
  return Transform2D(Vector2(value.x, 0), Vector2(0, value.y), Vector2.ZERO)

func rotated(degrees: float) -> Transform2D:
  return Transform2D(deg_to_rad(degrees), Vector2.ZERO)

func around(value: Transform2D, origin: Vector2) -> Transform2D:
  return translated(origin) * value * translated(-origin)

func transformed_rect(rect: Rect2, value: Transform2D) -> Rect2:
  var result := Rect2(value * rect.position, Vector2.ZERO)
  for point: Vector2 in [Vector2(rect.end.x, rect.position.y), rect.end, Vector2(rect.position.x, rect.end.y)]:
    result = result.expand(value * point)
  return result

func corners(value: Transform2D, size: Vector2) -> Array:
  return [Vector2.ZERO, Vector2(size.x, 0), size, Vector2(0, size.y)].map(
    func(point: Vector2) -> Array: return vector_values(value * point))

func embedding(name: String) -> Transform2D:
  return translated(embeddings[name].position) * scaled(embeddings[name].scale)

# Analytical goldens from App.jsx and the declared Godot root embeddings.
# Neither mounted Controls, public measures nor host inverse helpers supply
# input points or expected offsets. RN AABBs are retained as a separate oracle.
func spec(name: String, id: String, phase: String) -> Dictionary:
  var size := Vector2(120, 90)
  var position := Vector2(20, 25)
  var parent := translated(Vector2(275, 160)) * scaled(Vector2(1.15, 1)) * rotated(-10)
  var own := translated(position) * rotated(30)
  if id == "origin":
    size = Vector2(100, 80)
    parent = translated(Vector2(25, 140)) * rotated(-12)
    own = translated(position) * rotated(18)
  elif id == "flat":
    size = Vector2(210, 120)
    position = Vector2(20, 20)
    parent = translated(Vector2(25, 435)) * scaled(Vector2(1.2, 1)) * rotated(-8)
    own = translated(position)
  elif name == "A" and phase == "updated":
    own = translated(position) * translated(Vector2(0, 135)) * scaled(Vector2(0.8, 1)) * rotated(-25)
  elif name == "B":
    position = Vector2(30, 35)
    parent = translated(Vector2(120, 165)) * rotated(12) * scaled(Vector2(0.9, 1.1))
    var transform := Transform2D(Vector2(1, 0), Vector2(tan(deg_to_rad(15)), 1), Vector2.ZERO) * rotated(-20)
    if phase == "updated":
      transform = Transform2D(Vector2(-1, 0), Vector2(0.25, 1), Vector2(5, -8))
    own = translated(position) * around(transform, Vector2(30, 67.5))
  var child_bounds := transformed_rect(Rect2(Vector2.ZERO, size), own)
  return {"size": size, "layout": [position.x, position.y, size.x, size.y], "page": parent * own,
    "rnBounds": transformed_rect(child_bounds, parent), "parent": parent, "own": own}

func point(name: String, id: String, local: Vector2 = Vector2(55, 45), phase: String = "") -> Vector2:
  return embedding(name) * spec(name, id, phases[name] if phase.is_empty() else phase).page * local

func screen_point(logical: Vector2) -> Vector2:
  # All stages declare an identity canvas and density one or two. Window
  # position is an OS observation; density is an independent declared golden.
  return (Vector2(get_window().position) + logical * density) / density

func geometry(name: String, id: String, stage: String) -> void:
  var expected := spec(name, id, phases[name])
  var value := read(name, id)
  var tag := int(value.get("tag", -1))
  var expected_global: Transform2D = embedding(name) * expected.page
  var prefix := stage + "/" + name + "/" + id
  var concrete := control(name, id)
  if id != "flat":
    verify(concrete != null and close_values(affine_values(concrete.get_global_transform_with_canvas()), affine_values(expected_global)),
      prefix + "/affine", "Six native affine coefficients follow the independent declarations")
    var actual_corners: Array = corners(concrete.get_global_transform_with_canvas(), concrete.size) if concrete != null else []
    var expected_corners := corners(expected_global, expected.size)
    verify(actual_corners.size() == 4 and range(4).all(func(index: int) -> bool: return close_values(actual_corners[index], expected_corners[index])),
      prefix + "/corners", "Four painted corners and Control size follow declared target geometry")
    var state := node_state(name, id)
    verify(tag == int(state.get("tag", -2)) and state.get("id", -1) == initial_ids.get(name + "/" + id, -2),
      prefix + "/identity", "React ref, Fabric tag and native Control survive transform and embedding changes")
    var layouts: Array = stats().get("layouts", {}).get(name + "/" + id, [])
    verify(layouts.size() == 1 and close_values(rect_values(layouts[0]), expected.layout),
      prefix + "/layout", "Transform and embedding changes do not create a new Yoga layout event")
  else:
    var concrete_tag: bool = native(surfaces[name]).get("nodes", []).any(func(entry: Dictionary) -> bool: return int(entry.get("tag", -2)) == tag)
    var painted := control("A", "flat-paint")
    verify(value.get("connected", false) and not concrete_tag and painted != null and painted.get_parent() == control("A", "flat-parent"),
      prefix + "/flattened", "Capture ref is a connected logical View with no native Control")
    verify(tag == initial_ids.get("A/flat", -2), prefix + "/identity", "Flattened logical capture keeps its Fabric identity")
  var expected_measure: Array = [expected.layout[0], expected.layout[1], expected.rnBounds.size.x,
    expected.rnBounds.size.y, expected.rnBounds.position.x, expected.rnBounds.position.y]
  verify(close_values(value.get("measure", []), expected_measure), prefix + "/measure",
    "Original measure retains Yoga origin and ancestor-by-ancestor RN AABB policy")
  var expected_window := transformed_rect(expected.rnBounds, embedding(name))
  verify(close_values(value.get("window", []), rect_array(expected_window)) and close_values(rect_values(value.get("rect", {})), rect_array(expected_window)),
    prefix + "/window", "Original window/DOM measurements follow the independently projected RN AABB")
  verify(close_values(value.get("relative", []), expected.layout) and not value.get("relativeFailed", false),
    prefix + "/relative", "measureLayout retains logical parent coordinates instead of capture offsets")
  if not stages.has(stage): stages[stage] = {}
  stages[stage][name + "/" + id] = {"expectedAffine": affine_values(expected_global), "expectedMeasure": expected_measure,
    "expectedWindow": rect_array(expected_window), "public": value,
    "nativeAffine": affine_values(concrete.get_global_transform_with_canvas()) if concrete != null else null}

func all_geometry(stage: String, include_b: bool = true) -> void:
  for id: String in ["origin", "capture", "flat"]:
    geometry("A", id, stage)
  if include_b: geometry("B", "capture", stage)

func event_coordinates(entry: Dictionary, logical: Vector2, origin: String, expected_phases: Dictionary, stage: String, index: int) -> void:
  var name: String = entry.get("name", "")
  var id: String = entry.get("id", "")
  var type: String = entry.get("type", "")
  var value: Dictionary = entry.get("native", {})
  var expected := spec(name, id, expected_phases[name])
  var client: Vector2 = embedding(origin).affine_inverse() * logical
  var local: Vector2 = (embedding(name) * expected.page).affine_inverse() * logical
  var screen := screen_point(logical)
  var baseline: Vector2 = client - expected.rnBounds.position
  var prefix := stage + "/event-" + str(index) + "/" + name + "/" + id + "/" + type
  verify(close_values([value.get("clientX"), value.get("clientY")], vector_values(client)) and
    value.get("clientX") == value.get("x") and value.get("clientY") == value.get("y") and
    value.get("clientX") == value.get("pageX") and value.get("clientY") == value.get("pageY"),
    prefix + "/client", "Capture preserves client/page aliases in the physical origin root")
  verify(close_values([value.get("screenX"), value.get("screenY")], vector_values(screen)), prefix + "/screen",
    "The native sample retains current density-normalized window coordinates")
  verify(close_values([value.get("offsetX"), value.get("offsetY")], vector_values(local)), prefix + "/offset",
    "Each actual dispatched target receives its independent inverse-affine local offset")
  verify(int(value.get("target", -1)) == int(read(name, id).get("tag", -2)) and int(value.get("pointerId", -1)) > 0 and
    value.get("pointerType") in ["mouse", "touch"] and value.get("isPrimary") is bool and float(value.get("timeStamp", 0)) > 0,
    prefix + "/identity", "Public event target, pointer identity/type and timestamp stay valid")
  samples.append({"stage": stage, "name": name, "id": id, "type": type, "native": value,
    "originRoot": origin, "declaredPhase": expected_phases[name], "viewportPoint": vector_values(logical),
    "expectedClient": vector_values(client), "expectedScreen": vector_values(screen), "expectedOffset": vector_values(local),
    "upstreamAABBSubtraction": vector_values(baseline), "upstreamDiffers": local.distance_to(baseline) > 1.0,
    "expectedTargetAffine": affine_values(embedding(name) * expected.page), "density": density})

func check_sample(before: int, logical: Vector2, origin: String, expected_phases: Dictionary, stage: String) -> Array:
  var incoming: Array = events().slice(before)
  verify(not incoming.is_empty(), stage + "/events", "Real native input reaches public JSX pointer handlers")
  for index in range(incoming.size()):
    event_coordinates(incoming[index], logical, origin, expected_phases, stage, index)
  return incoming

func make_input(kind: String, phase: String, supplied: Vector2, contact_index: int) -> InputEvent:
  var event: InputEvent
  if kind == "mouse":
    if phase == "move":
      var motion := InputEventMouseMotion.new()
      motion.position = supplied
      motion.button_mask = MOUSE_BUTTON_MASK_LEFT
      event = motion
    else:
      var button := InputEventMouseButton.new()
      button.position = supplied
      button.button_index = MOUSE_BUTTON_LEFT
      button.pressed = phase == "down"
      button.canceled = phase == "cancel"
      button.button_mask = MOUSE_BUTTON_MASK_LEFT if button.pressed else 0
      event = button
  elif phase == "move":
    var drag := InputEventScreenDrag.new()
    drag.index = contact_index
    drag.position = supplied
    drag.pressure = 1.0
    event = drag
  else:
    var touch := InputEventScreenTouch.new()
    touch.index = contact_index
    touch.position = supplied
    touch.pressed = phase == "down"
    touch.canceled = phase == "cancel"
    event = touch
  event.device = DEVICE
  return event

func inject(kind: String, phase: String, logical: Vector2, stage: String, contact_index: int = 0, origin: String = "A", raw_window: bool = false) -> Array:
  var before: int = events().size()
  var declared_phases := phases.duplicate()
  var supplied := logical * density if raw_window else logical
  var event := make_input(kind, phase, supplied, contact_index)
  injections.append({"stage": stage, "kind": kind, "phase": phase, "index": contact_index,
    "viewportPoint": vector_values(logical), "suppliedPoint": vector_values(supplied), "rawWindow": raw_window, "density": density})
  if raw_window: get_viewport().push_input(event, false)
  else: Input.parse_input_event(event)
  await settle()
  return check_sample(before, logical, origin, declared_phases, stage)

func registry(active: int, pending: int, captured: int, stage: String) -> void:
  var state := native(application)
  var pointer: Dictionary = state.get("pointerProcessor", {})
  verify(not pointer.is_empty() and int(pointer.get("active", -1)) == active and
    int(pointer.get("pendingCapture", -1)) == pending and int(pointer.get("activeCapture", -1)) == captured,
    stage + "/registry", "Original active/pending/active-capture registries retain their exact owners")

func set_embedding(name: String, position: Vector2, scale_value: Vector2) -> void:
  embeddings[name] = {"position": position, "scale": scale_value}
  surfaces[name].position = position
  surfaces[name].scale = scale_value

func assert_baseline_differs(entry: Dictionary, origin: String, logical: Vector2, stage: String) -> void:
  var target := spec(entry.get("name", "A"), entry.get("id", "capture"), phases[entry.get("name", "A")])
  var client: Vector2 = embedding(origin).affine_inverse() * logical
  var local: Vector2 = (embedding(entry.get("name", "A")) * target.page).affine_inverse() * logical
  verify(local.distance_to(client - target.rnBounds.position) > 1.0, stage + "/upstream-counterfactual",
    "This declared sample causally distinguishes the corrected local point from original RN AABB subtraction")

func touch_origin(stage: String, logical: Vector2, type: String, contact_index: int) -> void:
  var matching: Array = stats().get("touches", []).filter(func(entry: Dictionary) -> bool: return entry.get("type") == type)
  var entry: Dictionary = matching.back() if not matching.is_empty() else {}
  var value: Dictionary = entry.get("native", {})
  var expected_page: Vector2 = embedding("A").affine_inverse() * logical
  var expected_local: Vector2 = (embedding("A") * spec("A", "origin", phases.A).page).affine_inverse() * logical
  verify(entry.get("name") == "A" and entry.get("id") == "origin" and int(value.get("identifier", -1)) == contact_index + 1 and
    int(value.get("target", -1)) == int(read("A", "origin").get("tag", -2)), stage + "/touch-owner",
    "Separate original TouchEvent transport retains the physical origin and identifier")
  verify(close_values([value.get("pageX"), value.get("pageY")], vector_values(expected_page)) and
    close_values([value.get("locationX"), value.get("locationY")], vector_values(expected_local)) and
    close_values([value.get("screenX"), value.get("screenY")], vector_values(screen_point(logical))),
    stage + "/touch-coordinates", "Pointer capture does not retarget legacy TouchEvent origin geometry")

func finite_fields(value: Dictionary, fields: Array) -> bool:
  for field: String in fields:
    var number: Variant = value.get(field)
    if typeof(number) not in [TYPE_INT, TYPE_FLOAT] or is_nan(float(number)) or is_inf(float(number)):
      return false
  return true

func exact_fields(actual: Dictionary, previous: Dictionary, fields: Array) -> bool:
  if not finite_fields(actual, fields) or not finite_fields(previous, fields):
    return false
  for field: String in fields:
    if actual[field] != previous[field]:
      return false
  return true

func raw_boundary_input(phase: String, logical: Vector2, contact_index: int, stage: String) -> void:
  var event := make_input("touch", phase, logical * density, contact_index)
  injections.append({"stage": stage, "kind": "touch", "phase": phase, "index": contact_index,
    "viewportPoint": vector_values(logical), "suppliedPoint": vector_values(logical * density), "rawWindow": true,
    "density": density, "acceptance": "Explicit last-valid cancellation or no-resurrection boundary"})
  get_viewport().push_input(event, false)
  await settle()

func singular_source_acceptance() -> void:
  clear()
  await inject("touch", "down", point("A", "origin"), "singular-source-down", 30, "A", true)
  var canceled_id := int(last_event("A", "origin", "Down").get("native", {}).get("pointerId", -1))
  action("A", "capture", "capture", canceled_id)
  clear()
  var last_valid_point := point("A", "capture", Vector2(65, 45))
  await inject("touch", "move", last_valid_point, "singular-source-last-valid", 30, "A", true)
  var previous_pointer: Dictionary = last_event("A", "capture", "Move").get("native", {})
  var original_moves: Array = stats().get("touches", []).filter(func(entry: Dictionary) -> bool: return entry.get("type") == "Move" and entry.get("name") == "A")
  var previous_touch: Dictionary = original_moves.back().get("native", {}) if not original_moves.is_empty() else {}
  verify(trace() == ["A/capture/GotPointerCapture", "A/capture/Move"] and query("A", "capture", canceled_id),
    "singular-source-last-valid/owner", "A valid same-target move establishes active capture and terminal geometry history")
  clear()
  action("B", "arm", "capture")
  await inject("touch", "down", point("B", "capture"), "singular-survivor-down", 31, "B", true)
  var survivor_id := int(last_event("B", "capture", "Down").get("native", {}).get("pointerId", -1))
  clear()
  var survivor_point := point("B", "capture", Vector2(65, 50))
  await inject("touch", "move", survivor_point, "singular-survivor-active", 31, "B", true)
  verify(canceled_id > 0 and survivor_id > 0 and canceled_id != survivor_id and query("A", "capture", canceled_id) and query("B", "capture", survivor_id),
    "singular-survivor-active/ids", "Independent physical A/B contacts have distinct live captured identities")
  registry(2, 2, 2, "singular-survivor-active")
  var survivor_pointer: Dictionary = last_event("B", "capture", "Move").get("native", {})

  var original_offset := {}
  for property: String in ["enabled", "position", "position_ratio", "scale", "rotation", "pivot", "pivot_ratio", "visual_only"]:
    original_offset[property] = surfaces.A.get("offset_transform_" + property)
  var previous_offset_scale: Vector2 = surfaces.A.call("get_offset_transform_scale")
  var pointer_before: Dictionary = native(surfaces.A).get("pointer", {})
  clear()
  surfaces.A.call("set_offset_transform_enabled", true)
  surfaces.A.call("set_offset_transform_visual_only", false)
  surfaces.A.call("set_offset_transform_scale", Vector2(0, 1))
  verify(surfaces.A.call("get_offset_transform_scale") == Vector2(0, 1) and
    surfaces.A.get_global_transform_with_canvas().determinant() == 0 and control("A", "capture").get_global_transform_with_canvas().determinant() == 0,
    "singular-source/actual-embedding", "Public offset scale creates a genuinely singular source and capture-target embedding")
  var invalid_point := last_valid_point + Vector2(12, 9)
  await raw_boundary_input("move", invalid_point, 30, "singular-source-invalid-move")
  verify(trace() == ["A/capture/Cancel", "A/capture/LostPointerCapture"],
    "singular-source/cancel-order", "A singular source cancels once before original implicit lost capture")
  var cancel_events := events(["Cancel", "LostPointerCapture"])
  var pointer_coordinates := ["clientX", "clientY", "x", "y", "pageX", "pageY", "screenX", "screenY", "offsetX", "offsetY"]
  verify(cancel_events.size() == 2 and cancel_events.all(func(entry: Dictionary) -> bool:
    var value: Dictionary = entry.get("native", {})
    return (entry.get("name") == "A" and entry.get("id") == "capture" and
      int(value.get("pointerId", -1)) == canceled_id and value.get("target") == previous_pointer.get("target") and
      exact_fields(value, previous_pointer, pointer_coordinates))),
    "singular-source/exact-terminal-coordinates", "Cancel and Lost keep every finite coordinate exactly from the same-target last valid move")
  verify(events().all(func(entry: Dictionary) -> bool: return finite_fields(entry.get("native", {}),
    pointer_coordinates + ["pointerId", "target", "button", "buttons", "pressure", "timeStamp"])),
    "singular-source/finite-events", "Singular cancellation exposes no NaN or infinity through public pointer events")
  var cancellations: Array = stats().get("touches", []).filter(func(entry: Dictionary) -> bool: return entry.get("type") == "Cancel")
  var canceled_touch: Dictionary = cancellations[0] if cancellations.size() == 1 else {}
  var touch_coordinates := ["pageX", "pageY", "screenX", "screenY", "locationX", "locationY", "target", "identifier"]
  # The application's other active touch, B's survivor (Godot index 31 is
  # identifier 32), stays listed where it rests.
  var listed: Array = canceled_touch.get("touches", [])
  var survivor: Dictionary = listed[0] if listed.size() == 1 else {}
  verify(cancellations.size() == 1 and canceled_touch.get("name") == "A" and canceled_touch.get("id") == "origin" and
    exact_fields(canceled_touch.get("native", {}), previous_touch, touch_coordinates) and
    int(survivor.get("identifier", -1)) == 32 and int(survivor.get("target", -1)) == int(read("B", "capture").get("tag", -2)) and
    absf(float(survivor.get("pageX", NAN)) - float(survivor_pointer.get("pageX", NAN))) < 0.001 and
    absf(float(survivor.get("pageY", NAN)) - float(survivor_pointer.get("pageY", NAN))) < 0.001 and
    canceled_touch.get("changedTouches", []).size() == 1 and
    exact_fields(canceled_touch.get("changedTouches", [{}])[0], previous_touch, touch_coordinates),
    "singular-source/original-touch-cancel", "Separate original TouchCancel preserves last valid origin coordinates, retires only its changed contact and still lists B's survivor")
  var canceled_state := native(surfaces.A)
  var canceled_pointer: Dictionary = canceled_state.get("pointer", {})
  verify(int(canceled_pointer.get("activeTouches", -1)) == 0 and int(canceled_pointer.get("activePointers", -1)) == 0 and
    int(canceled_pointer.get("responder", -1)) == 0 and not canceled_pointer.get("blockNative", true) and
    canceled_pointer.get("cancels", -1) == pointer_before.get("cancels", -2) + 1 and
    canceled_pointer.get("moves", -1) == pointer_before.get("moves", -2) and not query("A", "capture", canceled_id),
    "singular-source/retired-authority", "Invalid move releases the original contact/capture once and never counts as a valid move")
  verify(query("B", "capture", survivor_id) and native(surfaces.B).get("pointer", {}).get("activeTouches", -1) == 1,
    "singular-source/survivor-live", "The independently captured B-origin contact survives A's singular cancellation")
  registry(1, 1, 1, "singular-source-canceled")
  stages["singular-source-canceled"] = {"lastValidPointer": previous_pointer, "lastValidTouch": previous_touch,
    "invalidInputPoint": vector_values(invalid_point), "cancellationEvents": events(), "touchCancellation": canceled_touch,
    "sourceRoot": canceled_state, "survivorRoot": native(surfaces.B), "originalOffsetScale": vector_values(previous_offset_scale)}

  for property: String in original_offset:
    surfaces.A.call("set_offset_transform_" + property, original_offset[property])
  verify(surfaces.A.call("get_offset_transform_scale") == previous_offset_scale and surfaces.A.get_global_transform_with_canvas().determinant() != 0,
    "singular-source/restored-embedding", "Restoring the original offset properties makes the source invertible again")
  clear()
  await raw_boundary_input("up", invalid_point, 30, "singular-source-late-up")
  verify(events().is_empty() and stats().get("touches", []).is_empty() and not query("A", "capture", canceled_id) and
    native(surfaces.A).get("pointer", {}).get("activeTouches", -1) == 0,
    "singular-source/no-resurrection", "Restoration and late physical up cannot resurrect the canceled pointer or touch")
  verify(query("B", "capture", survivor_id), "singular-source/late-up-survivor", "The canceled contact's late up cannot release B capture")
  clear()
  await inject("touch", "move", survivor_point + Vector2(4, -2), "singular-survivor-continues", 31, "B", true)
  verify(trace() == ["B/capture/Move"] and last_event("B", "capture", "Move").get("native", {}).get("pointerId") == survivor_id and query("B", "capture", survivor_id),
    "singular-survivor-continues/owner", "B still handles its same captured contact with valid current geometry")
  clear()
  await inject("touch", "up", survivor_point, "singular-survivor-up", 31, "B", true)
  verify(trace() == ["B/capture/Up", "B/capture/LostPointerCapture"], "singular-survivor-up/order", "Unaffected B contact releases normally after the source restores")
  registry(0, 0, 0, "singular-source-finished")

func hidden_event_coordinates(entry: Dictionary, logical: Vector2, pointer_id: int, stage: String, index: int) -> void:
  var value: Dictionary = entry.get("native", {})
  var expected_client: Vector2 = embedding("A").affine_inverse() * logical
  var expected_screen := screen_point(logical)
  var prefix := stage + "/hidden-event-" + str(index) + "/" + str(entry.get("type", ""))
  verify(entry.get("name") == "B" and entry.get("id") == "capture" and entry.get("hidden") == true and
    int(value.get("target", -1)) == int(read("B", "capture").get("tag", -2)) and int(value.get("pointerId", -1)) == pointer_id,
    prefix + "/connected-identity", "A connected display:none capture target keeps its original pointer and public tag")
  verify(close_values([value.get("clientX"), value.get("clientY")], vector_values(expected_client)) and
    value.get("clientX") == value.get("x") and value.get("clientY") == value.get("y") and
    value.get("clientX") == value.get("pageX") and value.get("clientY") == value.get("pageY") and
    close_values([value.get("screenX"), value.get("screenY")], vector_values(expected_screen)),
    prefix + "/native-sample", "Hidden-target dispatch preserves origin-root client/page and current native screen coordinates")
  # Pinned original EmptyLayoutMetrics has origin {0,0}, size {-1,-1}.
  # A hidden node has no painted inverse. Preserve that original numerical
  # retarget contract explicitly instead of inventing geometry or dropping it.
  verify(finite_fields(value, ["offsetX", "offsetY", "clientX", "clientY", "screenX", "screenY", "timeStamp"]) and
    value.get("offsetX") == value.get("clientX") and value.get("offsetY") == value.get("clientY"),
    prefix + "/original-empty-layout-offset", "Hidden capture retains original offset = client minus EmptyLayoutMetrics origin zero")
  samples.append({"stage": stage, "name": "B", "id": "capture", "type": entry.get("type"), "native": value,
    "originRoot": "A", "viewportPoint": vector_values(logical), "expectedClient": vector_values(expected_client),
    "expectedScreen": vector_values(expected_screen), "expectedOffset": vector_values(expected_client),
    "offsetContract": "Original RN EmptyLayoutMetrics origin zero; no painted target inverse", "density": density})

func hidden_input(phase: String, logical: Vector2, pointer_id: int, stage: String) -> void:
  var before: int = events().size()
  var event := make_input("touch", phase, logical * density, 32)
  injections.append({"stage": stage, "kind": "touch", "phase": phase, "index": 32,
    "viewportPoint": vector_values(logical), "suppliedPoint": vector_values(logical * density), "rawWindow": true,
    "density": density, "acceptance": "Connected hidden capture preserves original RN empty-layout numerical payload"})
  get_viewport().push_input(event, false)
  await settle()
  var incoming: Array = events().slice(before)
  verify(not incoming.is_empty(), stage + "/events", "Real native input still reaches a connected hidden capture target")
  for index in range(incoming.size()):
    var entry: Dictionary = incoming[index]
    if entry.get("name") == "B" and entry.get("id") == "capture":
      hidden_event_coordinates(entry, logical, pointer_id, stage, index)
    else:
      # No inverse expectation is relaxed for any visible target or ancestor.
      event_coordinates(entry, logical, "A", phases.duplicate(), stage, index)

func hidden_capture_acceptance() -> void:
  clear()
  await inject("touch", "down", point("A", "origin"), "hidden-capture-origin", 32, "A", true)
  var hidden_id := int(last_event("A", "origin", "Down").get("native", {}).get("pointerId", -1))
  action("B", "capture", "capture", hidden_id)
  clear()
  var visible_point := point("B", "capture", Vector2(70, 45))
  await inject("touch", "move", visible_point, "hidden-capture-before-hide", 32, "A", true)
  verify(trace() == ["B/capture/GotPointerCapture", "B/capture/Move"] and query("B", "capture", hidden_id),
    "hidden-capture-before-hide/owner", "A visible cross-root target establishes original active capture before it hides")
  var visible_ref := read("B", "capture")
  clear()
  action("B", "hide", "capture")
  await settle()
  var hidden_ref := read("B", "capture")
  verify(stats().get("live", {}).get("B", {}).get("hiddenCapture") == true and hidden_ref.get("connected", false) and
    hidden_ref.get("tag") == visible_ref.get("tag") and query("B", "capture", hidden_id) and events().is_empty(),
    "hidden-capture/connected-owner", "React display:none keeps the connected capture ref, ID and ownership without synthetic loss")
  registry(1, 1, 1, "hidden-capture")
  var hidden_point := Vector2(610, 365)
  await hidden_input("move", hidden_point, hidden_id, "hidden-capture-move")
  verify(trace() == ["B/capture/Move"] and query("B", "capture", hidden_id),
    "hidden-capture-move/order", "No-hit movement delivers once to the connected hidden owner without changing capture")
  touch_origin("hidden-capture-move", hidden_point, "Move", 32)
  stages["hidden-capture-move"] = {"visibleRef": visible_ref, "hiddenRef": hidden_ref, "events": events(),
    "offsetContract": "Pinned RN EmptyLayoutMetrics.frame.origin == {0,0}; offset equals owner-root client"}
  clear()
  await hidden_input("up", hidden_point, hidden_id, "hidden-capture-up")
  verify(trace() == ["B/capture/Up", "B/capture/LostPointerCapture"] and not query("B", "capture", hidden_id),
    "hidden-capture-up/order", "Hidden-target up still precedes original implicit loss and releases capture")
  registry(0, 0, 0, "hidden-capture-ended")
  clear()
  action("B", "show", "capture")
  await settle()
  var restored_ref := read("B", "capture")
  verify(stats().get("live", {}).get("B", {}).get("hiddenCapture") == false and restored_ref.get("connected", false) and
    restored_ref.get("tag") == visible_ref.get("tag") and not query("B", "capture", hidden_id) and events().is_empty(),
    "hidden-capture/restored", "Showing the same React View restores rendering without reviving its ended pointer")

func capture_image(stage: String) -> void:
  if not OS.get_cmdline_user_args().has("--capture"):
    return
  print("POINTER_GEOMETRY_CAPTURE_BEGIN: " + stage)
  get_window().grab_focus()
  await settle()
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  for key: String in ["A/origin", "A/capture", "B/capture", "A/flat"]:
    var parts := key.split("/")
    var local := Vector2(85, 65) if parts[1] != "origin" else Vector2(85, 60)
    if parts[1] == "flat": local = Vector2(110, 80)
    var logical := point(parts[0], parts[1], local)
    var physical := Vector2i(floori(logical.x * density), floori(logical.y * density))
    var in_bounds := physical.x >= 0 and physical.y >= 0 and physical.x < image.get_width() and physical.y < image.get_height()
    var actual := image.get_pixelv(physical) if in_bounds else Color.TRANSPARENT
    var expected := Color(COLORS[key])
    var passed := in_bounds and maxf(absf(actual.r - expected.r), maxf(absf(actual.g - expected.g), absf(actual.b - expected.b))) <= 0.025 and actual.a > 0.99
    verify(passed, stage + "/pixel/" + key, "Declared transformed target paints its independently selected native pixel")
    pixels.append({"stage": stage, "target": key, "viewportPoint": vector_values(logical), "pixel": [physical.x, physical.y],
      "expected": COLORS[key], "actual": [actual.r, actual.g, actual.b, actual.a], "passed": passed, "density": density})
  if phases.A == "updated":
    var old_point := point("A", "capture", Vector2(85, 65), "initial")
    var pixel := Vector2i(floori(old_point.x * density), floori(old_point.y * density))
    var actual := image.get_pixelv(pixel)
    var expected := Color("#334155")
    var passed := maxf(absf(actual.r - expected.r), maxf(absf(actual.g - expected.g), absf(actual.b - expected.b))) <= 0.025 and actual.a > 0.99
    verify(passed, stage + "/pixel/old-capture-location", "React transform update removes the old capture-target paint")
    pixels.append({"stage": stage, "target": "A/capture-old-location", "pixel": [pixel.x, pixel.y],
      "expected": "#334155", "actual": [actual.r, actual.g, actual.b, actual.a], "passed": passed, "density": density})
  verify(image.save_png("res://build/pointer-geometry-" + stage + ".png") == OK, stage + "/screenshot", "Actual native Viewport capture is saved")
  print("POINTER_GEOMETRY_CAPTURE_END: " + stage)

func _ready() -> void:
  original_window = {"size": get_window().size, "contentSize": get_window().content_scale_size,
    "mode": get_window().content_scale_mode, "factor": get_window().content_scale_factor}
  get_window().content_scale_size = Vector2i.ZERO
  get_window().content_scale_mode = Window.CONTENT_SCALE_MODE_CANVAS_ITEMS
  get_window().content_scale_factor = density
  get_window().size = Vector2i(1240, 760)
  for surface: Control in surfaces.values():
    surface.set_meta("validation_input_device", DEVICE)
  if OS.get_cmdline_user_args().has("--validate"):
    call_deferred("run_checks")

func run_checks() -> void:
  var deadline := Time.get_ticks_msec() + 5000
  while Time.get_ticks_msec() < deadline and stats().get("mounts", {}).size() != 2:
    await frames(1)
  await settle()
  if not verify(stats().get("mounts", {}) == {"A": 1.0, "B": 1.0}, "initial/mounts", "Original AppRegistry mounts two shared capture geometry roots"):
    await finish()
    return
  verify(native(application).get("rootCount", -1) == 2 and native(application).get("bundleEvaluations", -1) == 1 and
    native(surfaces.A).get("runtimeId", -1) == native(surfaces.B).get("runtimeId", -2),
    "initial/shared-runtime", "Capture refs in separate roots share the same original Hermes/Fabric application")
  for pair: Array in [["A", "origin"], ["A", "capture"], ["B", "capture"]]:
    initial_ids[pair[0] + "/" + pair[1]] = node_state(pair[0], pair[1]).get("id", -1)
  initial_ids["A/flat"] = read("A", "flat").get("tag", -1)
  all_geometry("initial")
  await capture_image("initial")

  # All expectations remain unchanged when run against the preceding host.
  # That baseline should fail capture-local offsets, never be accepted by
  # swapping the correct inverse golden for upstream AABB subtraction.
  clear()
  action("A", "arm", "origin")
  await inject("mouse", "down", point("A", "origin"), "mouse-down")
  var pointer_id := int(last_event("A", "origin", "Down").get("native", {}).get("pointerId", -1))
  verify(pointer_id > 0 and query("A", "origin", pointer_id) and events(["GotPointerCapture"]).is_empty(),
    "mouse-down/pending", "Public down callback sees pending capture without a premature got event")
  registry(1, 1, 0, "mouse-down")
  clear()
  var sibling_point := point("A", "capture", Vector2(40, 35))
  await inject("mouse", "move", sibling_point, "capture-origin")
  verify(trace() == ["A/origin/GotPointerCapture", "A/origin/Move"], "capture-origin/order", "Original got precedes the captured move on a transformed owner")
  assert_baseline_differs(last_event("A", "origin", "Move"), "A", sibling_point, "capture-origin")
  registry(1, 1, 1, "capture-origin")

  clear()
  action("A", "capture", "capture", pointer_id)
  verify(query("A", "capture", pointer_id) and not query("A", "origin", pointer_id), "transfer-A/pending", "Public capture transfer changes pending owner immediately")
  await inject("mouse", "move", sibling_point, "transfer-A")
  verify(trace() == ["A/origin/LostPointerCapture", "A/capture/GotPointerCapture", "A/capture/Move"],
    "transfer-A/order", "Transfer preserves lost old, got new, then move ordering")
  assert_baseline_differs(last_event("A", "capture", "Move"), "A", sibling_point, "transfer-A")
  clear()
  action("A", "updateOnMove", "capture")
  await inject("mouse", "move", sibling_point + Vector2(7, -3), "update-callback-before-commit")
  verify(stats().get("live", {}).get("A", {}).get("phase") == "updated" and
    stats().get("actions", []).any(func(entry: Dictionary) -> bool: return entry.get("operation") == "updateInsideMove"),
    "update-callback/react", "A genuine captured JSX move callback commits its React transform update")
  phases.A = "updated"
  all_geometry("react-updated")
  clear()
  var changed_point := point("A", "capture", Vector2(70, 40))
  await inject("mouse", "move", changed_point, "updated-transform")
  verify(trace() == ["A/capture/Move"] and query("A", "capture", pointer_id), "updated-transform/owner", "Next real sample uses the committed new transform without losing capture")

  clear()
  action("B", "capture", "capture", pointer_id)
  verify(query("B", "capture", pointer_id) and not query("A", "capture", pointer_id), "transfer-B/pending", "Another root in the same application can become the pending owner")
  var other_point := point("B", "capture", Vector2(60, 50))
  await inject("mouse", "move", other_point, "transfer-B")
  verify(trace() == ["A/capture/LostPointerCapture", "B/capture/GotPointerCapture", "B/capture/Move"],
    "transfer-B/order", "Cross-root transfer retains original negotiation and one physical contact")
  verify(last_event("B", "capture", "Move").get("native", {}).get("pointerId") == pointer_id,
    "transfer-B/id", "Capture in another root does not allocate a new pointer identity")
  assert_baseline_differs(last_event("B", "capture", "Move"), "A", other_point, "transfer-B")
  clear()
  await inject("mouse", "move", Vector2(1210, 735), "outside-all-roots")
  verify(trace() == ["B/capture/Move"], "outside-all-roots/order", "No physical hit still produces exactly one captured move")

  set_embedding("A", Vector2(45, 25), Vector2(0.9, 0.85))
  set_embedding("B", Vector2(680, 55), Vector2(0.8, 1.0))
  await settle()
  all_geometry("godot-embedding")
  clear()
  var moved_point := point("B", "capture", Vector2(65, 50))
  await inject("mouse", "move", moved_point, "moved-root-capture")
  verify(trace() == ["B/capture/Move"] and query("B", "capture", pointer_id), "moved-root-capture/owner", "Capture uses both current embeddings while retaining its original physical root")
  action("B", "update", "capture")
  await settle()
  phases.B = "updated"
  all_geometry("mirrored-target")
  clear()
  await inject("mouse", "move", point("B", "capture", Vector2(80, 55)), "reflected-capture")
  verify(trace() == ["B/capture/Move"], "reflected-capture/order", "Reflected affine capture preserves original event delivery")
  await capture_image("updated")

  # Prepare the real raw-window sample before changing density. No JS call,
  # frame or settle occurs between the factor change and this input dispatch.
  set_embedding("A", Vector2(20, 15), Vector2(0.55, 0.5))
  set_embedding("B", Vector2(310, 20), Vector2(0.5, 0.5))
  await settle()
  clear()
  var immediate_point := point("B", "capture", Vector2(75, 40))
  var immediate_event := make_input("mouse", "move", immediate_point * 2, 0)
  var before_density: int = events().size()
  density = 2.0
  get_window().content_scale_factor = density
  get_viewport().push_input(immediate_event, false)
  injections.append({"stage": "density-immediate", "kind": "mouse", "phase": "move", "index": 0,
    "viewportPoint": vector_values(immediate_point), "suppliedPoint": vector_values(immediate_point * density), "rawWindow": true, "density": density})
  await settle()
  check_sample(before_density, immediate_point, "A", phases.duplicate(), "density-immediate")
  verify(trace() == ["B/capture/Move"] and query("B", "capture", pointer_id), "density-immediate/owner", "First raw-window sample after changing density preserves the same captured contact")
  var metrics: Variant = js("GodotPointerGeometry.metrics()")
  verify(metrics is Dictionary and metrics.get("pixelRatio") == 2 and metrics.get("dimensions", {}).get("scale") == 2,
    "density-immediate/metrics", "Original Dimensions and PixelRatio observe the declared density two")
  all_geometry("density-two")
  await capture_image("density")
  clear()
  var up_point := Vector2(610, 365)
  await inject("mouse", "up", up_point, "captured-up", 0, "A", true)
  verify(trace() == ["B/capture/Up", "B/capture/LostPointerCapture"] and not query("B", "capture", pointer_id),
    "captured-up/order", "Captured up precedes implicit lost and releases its original pending ownership")
  registry(0, 0, 0, "captured-up")

  clear()
  await inject("touch", "down", point("A", "origin"), "logical-down", 10, "A", true)
  var logical_id := int(last_event("A", "origin", "Down").get("native", {}).get("pointerId", -1))
  action("A", "capture", "flat", logical_id)
  verify(query("A", "flat", logical_id), "logical-capture/pending", "Original public flattened View ref can acquire pending capture")
  clear()
  var logical_point := point("A", "flat", Vector2(140, 95))
  await inject("touch", "move", logical_point, "logical-capture", 10, "A", true)
  verify(trace() == ["A/flat/GotPointerCapture", "A/flat/Move"], "logical-capture/order", "Original ancestor JSX handlers receive got and move on the flattened target")
  assert_baseline_differs(last_event("A", "flat", "Move"), "A", logical_point, "logical-capture")
  touch_origin("logical-capture", logical_point, "Move", 10)
  clear()
  await inject("touch", "cancel", logical_point, "logical-cancel", 10, "A", true)
  verify(trace() == ["A/flat/Cancel", "A/flat/LostPointerCapture"] and not query("A", "flat", logical_id),
    "logical-cancel/order", "Real cancel terminates the captured flattened logical View once")
  registry(0, 0, 0, "logical-cancel")

  await singular_source_acceptance()
  await hidden_capture_acceptance()

  # B owns capture for a contact physically originating in A. B retirement
  # must not destroy A's contact or the concurrent A-owned capture.
  clear()
  await inject("touch", "down", point("A", "origin"), "retirement-origin", 20, "A", true)
  var retiring_id := int(last_event("A", "origin", "Down").get("native", {}).get("pointerId", -1))
  action("B", "capture", "capture", retiring_id)
  clear()
  await inject("touch", "move", point("B", "capture"), "retirement-capture", 20, "A", true)
  application.call("evaluate", "GodotPointerGeometry.retain('B','capture','retired-B')")
  clear()
  action("A", "arm", "origin")
  await inject("touch", "down", point("A", "origin", Vector2(60, 35)), "concurrent-down", 21, "A", true)
  var survivor_id := int(last_event("A", "origin", "Down").get("native", {}).get("pointerId", -1))
  clear()
  await inject("touch", "move", point("A", "capture"), "concurrent-capture", 21, "A", true)
  verify(survivor_id != retiring_id and query("A", "origin", survivor_id) and query("B", "capture", retiring_id),
    "concurrent-capture/ids", "Concurrent contacts keep distinct IDs and capture owners across roots")
  registry(2, 2, 2, "concurrent-capture")
  clear()
  surfaces.B.call("unmount")
  await settle()
  verify(events().is_empty() and stats().get("cleanups", {}).get("B") == 1 and native(application).get("rootCount", -1) == 1,
    "retired-target/no-callback", "Capture-root retirement disconnects B without invoking stale handlers")
  var stale: Variant = js("GodotPointerGeometry.stale('retired-B',%d)" % retiring_id)
  verify(stale is Dictionary and not stale.get("connected", true) and not stale.get("before", true) and
    not stale.get("afterSet", true) and not stale.get("afterRelease", true),
    "retired-target/stale", "Retained retired capture ref cannot query or restore pointer authority")
  verify(query("A", "origin", survivor_id), "retired-target/survivor", "Another original active capture survives target-root retirement")
  registry(2, 1, 1, "retired-target")
  clear()
  var restored_origin := point("A", "origin", Vector2(50, 45))
  await inject("touch", "move", restored_origin, "origin-survives-retirement", 20, "A", true)
  verify(last_event("A", "origin", "Move").get("native", {}).get("pointerId") == retiring_id and events().all(func(entry: Dictionary) -> bool: return entry.get("name") == "A"),
    "origin-survives-retirement/id", "Original physical contact resumes live A geometry after its capture root retires")
  touch_origin("origin-survives-retirement", restored_origin, "Move", 20)
  clear()
  await inject("touch", "move", Vector2(610, 365), "concurrent-survivor-move", 21, "A", true)
  verify(trace() == ["A/origin/Move"] and query("A", "origin", survivor_id),
    "concurrent-survivor-move/owner", "Surviving captured contact still receives no-hit input with corrected geometry")
  clear()
  await inject("touch", "up", restored_origin, "retired-capture-contact-up", 20, "A", true)
  verify(query("A", "origin", survivor_id), "retired-capture-contact-up/survivor", "Ending the former B capture cannot release the concurrent owner")
  clear()
  await inject("touch", "cancel", Vector2(610, 365), "concurrent-survivor-cancel", 21, "A", true)
  verify(trace() == ["A/origin/Cancel", "A/origin/LostPointerCapture"], "concurrent-survivor-cancel/order", "Final surviving cancel preserves original termination ordering")
  registry(0, 0, 0, "all-contacts-ended")
  await finish()

func finish() -> void:
  var before := native(application)
  var react_before := stats()
  application.call("stop")
  await settle()
  var after := native(application)
  var roots := {}
  for name: String in ["A", "B"]:
    var state := native(surfaces[name])
    roots[name] = state
    verify(state.get("nativeTags", -1) == 0 and state.get("creates", -1) == state.get("deletes", -2) and state.get("nodes", ["missing"]).is_empty(),
      "stopped/" + name + "/controls", "Every concrete native tag and Control is released")
    var pointer: Dictionary = state.get("pointer", {})
    verify(["activeTouches", "responder", "activePointers", "hoverPointers"].all(func(key: String) -> bool: return int(pointer.get(key, -1)) == 0),
      "stopped/" + name + "/contacts", "No root contact, responder or pointer ownership survives shutdown")
  verify(after.get("stopped", false) and after.get("rootCount", -1) == 0 and after.get("errors", ["missing"]).is_empty(),
    "stopped/application", "Application shutdown has no hidden native error")
  verify(["pendingTimers", "pendingAnimationFrames", "pendingWork", "pendingRootRetirements"].all(func(key: String) -> bool: return int(after.get(key, -1)) == 0),
    "stopped/queues", "Timers, frames, queued work and retirement scopes are released")
  verify(["active", "pendingCapture", "activeCapture", "hover"].all(func(key: String) -> bool: return int(after.get("pointerProcessor", {}).get(key, -1)) == 0),
    "stopped/processor", "Original RN active/capture/hover registries are empty")
  verify(["contacts", "active", "hoverPointers", "stored", "suppressed"].all(func(key: String) -> bool: return int(after.get("pointerRouting", {}).get(key, -1)) == 0),
    "stopped/routing", "Application physical routing contains no retained or suppressed contact")
  var react_after := stats()
  verify(react_after.get("mounts", {}) == {"A": 1.0, "B": 1.0} and react_after.get("cleanups", {}) == {"A": 1.0, "B": 1.0},
    "stopped/react", "Both original React roots mount and clean their effects exactly once")
  get_window().content_scale_factor = original_window.factor
  get_window().content_scale_mode = original_window.mode
  get_window().content_scale_size = original_window.contentSize
  get_window().size = original_window.size
  var report := {"scenario": "pointer-geometry", "godot": Engine.get_version_info().string, "react": "19.2.3", "reactNative": "0.87.1",
    "engine": "hermes", "renderer": "fabric", "displayServer": DisplayServer.get_name(), "inputTransport": "Input.parse_input_event + raw-window viewport input",
    "validationInputDevice": DEVICE, "oracle": "Declared JSX/root affines; owner-root client/page; inverse target-local offset; separate original RN AABB-subtraction counterfactual",
    "checks": checks, "stages": stages, "samples": samples, "injections": injections, "pixels": pixels,
    "initialInstances": initial_ids, "beforeStop": before, "afterStop": after, "rootsStopped": roots,
    "reactBeforeStop": react_before, "reactAfterStop": react_after}
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://build"))
  var output := FileAccess.open("res://build/report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_ERROR: Cannot write capture geometry report")
    get_tree().quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  print("FABRIC_VALIDATION_FAILED: pointer-geometry" if failed else "FABRIC_VALIDATION_PASSED: pointer-geometry " + str(checks.size()))
  get_tree().quit(1 if failed else 0)
