extends Node

const CASES := ["percent", "absolute-origin", "percent-origin", "scale-rotate", "rotate-scale", "mirror", "skew", "flatten", "gesture"]
const COLORS := {"percent": "#0284c7", "absolute-origin": "#0f766e", "percent-origin": "#a855f7",
  "scale-rotate": "#e05252", "rotate-scale": "#f59e0b", "mirror": "#14b8a6", "skew": "#06b6d4", "flatten": "#3b82f6", "gesture": "#22c55e"}
var checks: Array = []
var stages: Dictionary = {}
var pixels: Array = []
var initial_ids: Dictionary = {}
var prior_layout_counts: Dictionary = {}
@onready var application: Node = $Application
@onready var surface: Control = $Surface

func verify(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

func frames(count: int = 6) -> void:
  for index in range(count):
    await get_tree().process_frame

func settle() -> void:
  await get_tree().create_timer(0.15).timeout
  await frames(2)

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(" + expression + ")"))

func stats() -> Dictionary:
  var value: Variant = js("GodotTransforms.stats()")
  return value if value is Dictionary else {}

func native_state() -> Dictionary:
  var value: Variant = JSON.parse_string(application.call("snapshot"))
  return value if value is Dictionary else {}

func root_state() -> Dictionary:
  var value: Variant = JSON.parse_string(surface.call("snapshot"))
  return value if value is Dictionary else {}

func native_node(id: String) -> Dictionary:
  for entry in root_state().get("nodes", []):
    if entry.get("testID", "") == id:
      return entry
  return {}

func node_by_tag(tag: int) -> Dictionary:
  for entry in root_state().get("nodes", []):
    if int(entry.get("tag", -1)) == tag:
      return entry
  return {}

func control(id: String) -> Control:
  return surface.find_child(id, true, false) as Control

func read(id: String, parent: String = "root") -> Dictionary:
  var value: Variant = js("GodotTransforms.read(%s,%s)" % [JSON.stringify(id), JSON.stringify(parent)])
  return value if value is Dictionary else {}

func close_values(actual: Array, expected: Array, tolerance: float = 0.025) -> bool:
  if actual.size() != expected.size():
    return false
  for index in range(actual.size()):
    if absf(float(actual[index]) - float(expected[index])) > tolerance:
      return false
  return true

func rect_values(rect: Dictionary) -> Array:
  return [rect.get("x", -999), rect.get("y", -999), rect.get("width", -1), rect.get("height", -1)]

func affine_values(value: Transform2D) -> Array:
  return [value.x.x, value.x.y, value.y.x, value.y.y, value.origin.x, value.origin.y]

func corners(value: Transform2D, size: Vector2) -> Array:
  var result: Array = []
  for local: Vector2 in [Vector2.ZERO, Vector2(size.x, 0), size, Vector2(0, size.y)]:
    var point := value * local
    result.append([point.x, point.y])
  return result

func transformed_rect(rect: Rect2, value: Transform2D) -> Rect2:
  var result := Rect2(value * rect.position, Vector2.ZERO)
  for point: Vector2 in [Vector2(rect.end.x, rect.position.y), rect.end, Vector2(rect.position.x, rect.end.y)]:
    result = result.expand(value * point)
  return result

func translated(value: Vector2) -> Transform2D:
  return Transform2D(0.0, value)

func scaled(x: float, y: float) -> Transform2D:
  return Transform2D(Vector2(x, 0), Vector2(0, y), Vector2.ZERO)

func rotated(degrees: float) -> Transform2D:
  return Transform2D(deg_to_rad(degrees), Vector2.ZERO)

func around(value: Transform2D, origin: Vector2) -> Transform2D:
  return translated(origin) * value * translated(-origin)

func frame_origin(id: String) -> Vector2:
  var index: int = CASES.find("percent-origin" if id == "nested-child" else id)
  return Vector2(30 + (index % 3) * 282, 124 + floori(float(index) / 3) * 186)

# All goldens below are analytical values from the JSX declaration. No native
# measurement, upstream layout result or renderer transform supplies expectations.
func spec(id: String, phase: String) -> Dictionary:
  var size := Vector2(100, 60) if phase == "updated" and id in ["percent", "percent-origin"] else Vector2(80, 50)
  var position := Vector2(70, 35)
  var origin := size / 2
  var matrix := Transform2D.IDENTITY
  if phase != "reset":
    match id:
      "percent": matrix = translated(Vector2(size.x * 0.25, size.y * -0.20))
      "absolute-origin":
        origin = Vector2.ZERO
        matrix = rotated(25)
      "percent-origin":
        origin = Vector2(size.x * 0.25, size.y * 0.75)
        matrix = scaled(1.25, 1) * rotated(20)
      "scale-rotate": matrix = scaled(1.5, 1) * rotated(25)
      "rotate-scale": matrix = rotated(25) * scaled(1.5, 1)
      "mirror": matrix = Transform2D(Vector2(-1, 0), Vector2(0.25, 1), Vector2(12, -4))
      "skew":
        var sx := Transform2D(Vector2(1, 0), Vector2(tan(deg_to_rad(18)), 1), Vector2.ZERO)
        var sy := Transform2D(Vector2(1, tan(deg_to_rad(-12))), Vector2(0, 1), Vector2.ZERO)
        matrix = sx * sy
  if id == "flatten":
    size = Vector2(70, 40)
    position = Vector2(25, 20)
    var parent := translated(Vector2(45, 25))
    if phase == "updated": parent = parent * scaled(1.3, 1) * rotated(-20)
    return {"size": size, "layout": [25, 20, 70, 40], "parent": "flatten-wrapper", "local": parent * translated(position),
      "page": translated(frame_origin(id)) * parent * translated(position), "aabb": transformed_rect(Rect2(position, size), parent)}
  if id == "gesture":
    size = Vector2(60, 50)
    position = Vector2(20, 20)
    var parent_matrix := Transform2D.IDENTITY if phase == "reset" else rotated(30) if phase == "initial" else scaled(1.25, 1) * rotated(-20)
    var parent := translated(Vector2(75, 20)) * around(parent_matrix, Vector2(50, 45))
    return {"size": size, "layout": [20, 20, 60, 50], "parent": "gesture-parent", "local": parent * translated(position),
      "page": translated(frame_origin(id)) * parent * translated(position), "aabb": transformed_rect(Rect2(position, size), parent), "parentMatrix": parent}
  if id == "nested-child":
    size = Vector2(30, 20)
    position = Vector2(15, 12)
    var own := translated(position) * around(Transform2D.IDENTITY if phase == "reset" else rotated(-15), size / 2)
    var parent: Dictionary = spec("percent-origin", phase)
    # RN accumulates an AABB at each ancestor; this differs from the exact quad
    # of the multiplied matrices when both child and parent are transformed.
    var child_aabb := transformed_rect(Rect2(Vector2.ZERO, size), own)
    return {"size": size, "layout": [15, 12, 30, 20], "parent": "percent-origin", "local": parent.local * own,
      "page": parent.page * own, "aabb": transformed_rect(child_aabb, parent.local)}
  var local := translated(position) * around(matrix, origin)
  return {"size": size, "layout": [position.x, position.y, size.x, size.y], "parent": id + "-frame", "local": local,
    "page": translated(frame_origin(id)) * local, "aabb": transformed_rect(Rect2(Vector2.ZERO, size), local)}

func geometry(id: String, phase: String) -> void:
  var expected: Dictionary = spec(id, phase)
  var node := control(id)
  var public := read(id, expected.parent)
  var global: Transform2D = node.get_global_transform_with_canvas()
  verify(close_values(affine_values(global), affine_values(expected.page)), "Six native affine coefficients follow the independent JSX golden: " + phase + " " + id)
  var actual_corners := corners(global, expected.size)
  var expected_corners := corners(expected.page, expected.size)
  var correct_corners := true
  for index in range(4): correct_corners = correct_corners and close_values(actual_corners[index], expected_corners[index])
  verify(correct_corners and node.size.is_equal_approx(expected.size), "Four renderer corners and untransformed Control size agree: " + phase + " " + id)
  var expected_page: Rect2 = expected.aabb
  expected_page.position += frame_origin(id)
  var measure: Array = public.get("measure", [])
  var expected_measure: Array = [expected.layout[0], expected.layout[1], expected_page.size.x, expected_page.size.y, expected_page.position.x, expected_page.position.y]
  verify(close_values(measure, expected_measure), "Original measure combines Yoga origin with RN ancestor-by-ancestor transformed bounds: " + phase + " " + id)
  var expected_window: Array = [expected_page.position.x, expected_page.position.y, expected_page.size.x, expected_page.size.y]
  verify(close_values(public.get("window", []), expected_window) and close_values(rect_values(public.get("rect", {})), expected_window),
    "Original measureInWindow and DOMRect follow the RN AABB policy: " + phase + " " + id)
  verify(close_values(public.get("relative", []), expected.layout) and not public.get("relativeFailed", false),
    "Original measureLayout retains Yoga geometry independent of visual transforms: " + phase + " " + id)
  var layouts: Array = stats().get("layouts", {}).get(id, [])
  var expected_count: int = prior_layout_counts.get(id, 0) + (1 if phase == "initial" or id in ["percent", "percent-origin"] else 0)
  var last: Dictionary = layouts.back() if not layouts.is_empty() else {}
  verify(layouts.size() == expected_count and close_values(rect_values(last), expected.layout), "onLayout changes only when Yoga geometry changes: " + phase + " " + id)
  prior_layout_counts[id] = layouts.size()
  var identity: Variant = js("GodotTransforms.identity(%s)" % JSON.stringify(id))
  verify(identity is Dictionary and identity.get("same", false) and int(identity.get("currentTag", -1)) == int(identity.get("retainedTag", -2)) and \
    public.get("connected", false) and native_node(id).get("id", -1) == initial_ids.get(id, -2),
    "React refs, Fabric tag and concrete child identity survive every transform phase: " + phase + " " + id)
  stages[phase][id] = {"expectedAffine": affine_values(expected.page), "nativeAffine": affine_values(global), "expectedCorners": expected_corners,
    "nativeCorners": actual_corners, "expectedMeasure": expected_measure, "expectedMeasureLayout": expected.layout, "public": public, "layouts": layouts}
  if id == "nested-child" and phase != "reset":
    var exact_bounds := transformed_rect(Rect2(Vector2.ZERO, expected.size), expected.page)
    verify(not close_values([exact_bounds.position.x, exact_bounds.position.y, exact_bounds.size.x, exact_bounds.size.y], expected_window),
      "Nested transforms intentionally distinguish RN accumulated AABBs from the renderer exact quad: " + phase)
    stages[phase][id]["exactQuadAABB"] = [exact_bounds.position.x, exact_bounds.position.y, exact_bounds.size.x, exact_bounds.size.y]

func flattening(phase: String) -> void:
  var wrapper := read("flatten-wrapper", "flatten-frame")
  var wrapper_node := node_by_tag(int(wrapper.get("tag", -1)))
  var child := control("flatten")
  var unfolded: bool = phase == "updated"
  var parent_matches: bool = child.get_parent() != control("flatten-frame") if unfolded else child.get_parent() == control("flatten-frame")
  verify(wrapper.get("connected", false) and wrapper_node.is_empty() != unfolded and parent_matches,
    "Original Fabric flattens the anonymous wrapper, materializes its transform and flattens it again: " + phase)
  verify(close_values(wrapper.get("relative", []), [45, 25, 140, 85]) and stats().get("mounts", {}).get("flatten", -1) == 1 and \
    stats().get("cleanups", {}).get("flatten", 0) == 0 and stats().get("state", {}).get("flattenCount", -1) == 1,
    "Flattening preserves logical layout, one mounted child and its React state: " + phase)
  stages[phase]["flattening"] = {"wrapperPublic": wrapper, "wrapperConcrete": wrapper_node, "childPhysicalParent": child.get_parent().name,
    "childConcrete": native_node("flatten"), "state": stats().get("state", {})}

func action(name: String, arguments: Array = []) -> void:
  var serialized: Array[String] = []
  for value in arguments: serialized.append(JSON.stringify(value))
  application.call("evaluate", "GodotTransforms.action(%s%s)" % [JSON.stringify(name), "" if serialized.is_empty() else "," + ",".join(serialized)])
  await frames()

func inject(kind: String, phase: String, point: Vector2) -> void:
  if kind == "mouse":
    if phase != "end":
      var motion := InputEventMouseMotion.new()
      motion.device = 1001
      motion.position = point
      motion.button_mask = MOUSE_BUTTON_MASK_LEFT if phase == "move" else 0
      get_viewport().push_input(motion, true)
    if phase != "move":
      var button := InputEventMouseButton.new()
      button.device = 1001
      button.position = point
      button.button_index = MOUSE_BUTTON_LEFT
      button.pressed = phase == "start"
      get_viewport().push_input(button, true)
  elif phase == "move":
    var drag := InputEventScreenDrag.new()
    drag.device = 1001
    drag.index = 2
    drag.position = point
    get_viewport().push_input(drag, true)
  else:
    var touch := InputEventScreenTouch.new()
    touch.device = 1001
    touch.index = 2
    touch.position = point
    touch.pressed = phase == "start"
    get_viewport().push_input(touch, true)
  await frames(4)
  await settle()

func events() -> Array:
  return stats().get("events", [])

func sequence() -> Array:
  return events().filter(func(entry: Dictionary) -> bool: return entry.get("type", "") in ["PressIn", "PressOut", "Press"]).map(func(entry: Dictionary) -> String: return entry.type)

func contact_matches(event: Dictionary, point: Vector2, local: Vector2, kind: String) -> bool:
  var content := get_window().get_final_transform() * get_window().get_global_canvas_transform().affine_inverse()
  var screen := (Vector2(get_window().position) + get_window().get_final_transform() * point) / content.get_scale().x
  return int(event.get("target", -1)) == int(native_node("gesture").get("tag", -2)) and \
    int(event.get("identifier", -1)) == (0 if kind == "mouse" else 3) and \
    close_values([event.get("pageX", -999), event.get("pageY", -999)], [point.x, point.y]) and \
    close_values([event.get("locationX", -999), event.get("locationY", -999)], [local.x, local.y]) and \
    close_values([event.get("screenX", -999), event.get("screenY", -999)], [screen.x, screen.y]) and float(event.get("timestamp", 0)) > 0

func pointer_step(stage: String, kind: String, phase: String, local: Vector2, transform_phase: String) -> void:
  var point: Vector2 = spec("gesture", transform_phase).page * local
  var before: int = events().size()
  await inject(kind, phase, point)
  var observed: Array = events().slice(before)
  var type: String = {"start": "TouchStart", "move": "TouchMove", "end": "TouchEnd"}[phase]
  var touches: Array = observed.filter(func(entry: Dictionary) -> bool: return entry.get("type", "") == type)
  var valid: bool = touches.size() == 1
  var arrays_valid := valid
  if valid:
    valid = contact_matches(touches[0], point, local, kind)
    var changed: Array = touches[0].get("changedTouches", [])
    var active: Array = touches[0].get("touches", [])
    arrays_valid = changed.size() == 1 and active.size() == (0 if phase == "end" else 1)
    if changed.size() == 1: arrays_valid = arrays_valid and contact_matches(changed[0], point, local, kind)
    if phase != "end" and active.size() == 1: arrays_valid = arrays_valid and contact_matches(active[0], point, local, kind)
  verify(valid, "Genuine transformed-parent %s %s emits inverse target-local and unchanged root-page coordinates: %s" % [kind, phase, stage])
  verify(arrays_valid, "Original contact arrays retain the same target and affine coordinate spaces: %s %s %s" % [stage, kind, phase])
  var pointer: Dictionary = root_state().get("pointer", {})
  verify(pointer.get("activeTouches", -1) == (0 if phase == "end" else 1) and int(pointer.get("responder", -1)) ==
    (0 if phase == "end" else int(native_node("gesture").get("tag", -2))), "Original responder follows the transformed %s %s lifetime: %s" % [kind, phase, stage])
  stages[stage]["samples"].append({"kind": kind, "phase": phase, "expectedPage": [point.x, point.y], "expectedLocal": [local.x, local.y],
    "events": observed, "pointer": pointer, "reactState": stats().get("state", {})})

func gestures(phase: String, kind: String) -> void:
  var stage := "gesture-" + phase + "-" + kind
  stages[stage] = {"samples": []}
  await action("clear")
  var before: int = int(stats().get("state", {}).get("gesture", {}).get("presses", -1))
  await pointer_step(stage, kind, "start", Vector2(40, 35), phase)
  verify(sequence() == ["PressIn"] and stats().get("state", {}).get("gesture", {}).get("held", false), "Original Pressability activates a transformed-parent target: " + stage)
  await pointer_step(stage, kind, "move", Vector2(44, 35), phase)
  verify(sequence() == ["PressIn"] and stats().get("state", {}).get("gesture", {}).get("held", false), "Genuine MOVE preserves the original root-space retention region: " + stage)
  await pointer_step(stage, kind, "end", Vector2(44, 35), phase)
  verify(sequence() == ["PressIn", "PressOut", "Press"] and stats().get("state", {}).get("gesture", {}).get("presses", -1) == before + 1,
    "Original pressed rendering and callbacks complete exactly one press: " + stage)

func hit_slop(phase: String) -> void:
  await action("clear")
  var expected: Dictionary = spec("gesture", phase)
  var parent_local := Vector2(-3, 45)
  var parent_matrix: Transform2D = translated(frame_origin("gesture")) * expected.parentMatrix
  var point := parent_matrix * parent_local
  var parent_aabb := transformed_rect(Rect2(Vector2.ZERO, Vector2(100, 90)), parent_matrix)
  verify(parent_aabb.has_point(point) and not Rect2(Vector2.ZERO, Vector2(100, 90)).has_point(parent_local) and \
    Rect2(Vector2(-20, -20), Vector2(140, 130)).has_point(parent_local), "Hit-slop negative point is inside the parent AABB and expanded target but outside the exact parent quad: " + phase)
  var before: int = int(stats().get("state", {}).get("gesture", {}).get("presses", -1))
  await inject("touch", "start", point)
  var started: Dictionary = root_state().get("pointer", {})
  await inject("touch", "end", point)
  verify(events().is_empty() and started.get("activeTouches", -1) == 0 and started.get("responder", -1) == 0 and \
    stats().get("state", {}).get("gesture", {}).get("presses", -1) == before, "Rotated hitSlop is clamped against the exact parent space before accepting input: " + phase)
  stages["hit-slop-" + phase] = {"parentLocal": [parent_local.x, parent_local.y], "point": [point.x, point.y],
    "parentAABB": [parent_aabb.position.x, parent_aabb.position.y, parent_aabb.size.x, parent_aabb.size.y], "events": events(), "pointerAfterStart": started}

func paint(phase: String) -> void:
  if not OS.get_cmdline_user_args().has("--capture"):
    return
  await frames(2)
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  var samples: Array = []
  for id in CASES:
    var expected: Dictionary = spec(id, phase)
    var local: Vector2 = Vector2(55, 35) if id == "percent-origin" else expected.size * Vector2(0.6, 0.65)
    samples.append({"id": id + "-interior", "point": expected.page * local, "color": COLORS[id]})
  samples.append({"id": "nested-child-interior", "point": spec("nested-child", phase).page * Vector2(15, 10), "color": "#f8fafc"})
  # Initial percentage translation leaves this old layout interior uncovered.
  if phase == "initial":
    samples.append({"id": "old-percent-layout-interior", "point": frame_origin("percent") + Vector2(75, 70), "color": "#253752"})
    var parent: Dictionary = spec("gesture", phase)
    samples.append({"id": "rotated-parent-AABB-gap", "point": (translated(frame_origin("gesture")) * parent.parentMatrix) * Vector2(-3, 45), "color": "#253752"})
  if phase == "reset":
    samples.append({"id": "previous-percent-translated-interior", "point": frame_origin("percent") + Vector2(165, 32), "color": "#253752"})
  for sample: Dictionary in samples:
    var logical: Vector2 = sample.point
    var physical: Vector2 = get_window().get_final_transform() * logical
    var point := Vector2i(floori(physical.x), floori(physical.y))
    var in_bounds := point.x >= 0 and point.y >= 0 and point.x < image.get_width() and point.y < image.get_height()
    var actual := image.get_pixelv(point) if in_bounds else Color.TRANSPARENT
    var expected := Color(sample.color)
    var matched := in_bounds and maxf(absf(actual.r - expected.r), maxf(absf(actual.g - expected.g), absf(actual.b - expected.b))) <= 0.025 and actual.a > 0.99
    verify(matched, "Rendered pixel follows the analytical transform and real renderer: " + phase + " " + sample.id)
    pixels.append({"phase": phase, "id": sample.id, "point": [point.x, point.y], "expected": sample.color,
      "actual": [actual.r, actual.g, actual.b, actual.a], "passed": matched})
  verify(image.save_png("res://build/transform-" + phase + ".png") == OK, "Native transform capture saved: " + phase)

func phase_geometry(phase: String) -> void:
  stages[phase] = {}
  for id in CASES:
    geometry(id, phase)
  geometry("nested-child", phase)
  flattening(phase)
  if phase != "reset":
    verify(not close_values(affine_values(spec("scale-rotate", phase).local), affine_values(spec("rotate-scale", phase).local)),
      "Operation ordering has different analytical affine coefficients: " + phase)
    var shear: Transform2D = spec("scale-rotate", phase).local
    verify(absf(shear.x.dot(shear.y)) > 0.1, "Scale-before-rotation golden contains shear rather than only rotation and independent scale: " + phase)
  await paint(phase)

func _ready() -> void:
  if DisplayServer.get_name() == "headless":
    get_window().size = Vector2i(900, 680)
  if not OS.get_cmdline_user_args().has("--validate"):
    return
  surface.set_meta("validation_input_device", 1001)
  await frames(8)
  var deadline := Time.get_ticks_msec() + 5000
  while application.call("evaluate", "Boolean(globalThis.GodotTransforms && GodotTransforms.stats().mounts.gallery === 1)") != "true" and \
    Time.get_ticks_msec() < deadline and native_state().get("errors", []).is_empty():
    await frames(1)
  if not verify(application.call("evaluate", "Boolean(globalThis.GodotTransforms && GodotTransforms.stats().mounts.gallery === 1)") == "true",
    "AppRegistry mounts the original public RN transform gallery"):
    await finish()
    return
  var present := true
  for id in CASES + ["nested-child"]:
    present = present and control(id) != null and not native_node(id).is_empty()
    initial_ids[id] = native_node(id).get("id", -1)
    application.call("evaluate", "GodotTransforms.retain(%s)" % JSON.stringify(id))
  application.call("evaluate", "GodotTransforms.retain('flatten-wrapper')")
  if not verify(present, "Every transformed fixture target is a real native Control"):
    await finish()
    return
  await action("bump")
  await phase_geometry("initial")
  await gestures("initial", "mouse")
  await gestures("initial", "touch")
  await hit_slop("initial")
  await action("phase", ["updated"])
  await phase_geometry("updated")
  await gestures("updated", "mouse")
  await gestures("updated", "touch")
  await hit_slop("updated")
  await action("phase", ["reset"])
  await phase_geometry("reset")
  await gestures("reset", "touch")
  await action("phase", ["updated"])
  await action("clear")
  stages["remove-active"] = {"samples": []}
  await pointer_step("remove-active", "touch", "start", Vector2(40, 35), "updated")
  var before: int = int(stats().get("state", {}).get("gesture", {}).get("presses", -1))
  await action("remove")
  var removed := root_state()
  var stale: Variant = js("GodotTransforms.stale('gesture')")
  verify(control("gesture") == null and native_node("gesture").is_empty() and removed.get("pointer", {}).get("activeTouches", -1) == 0 and \
    removed.get("pointer", {}).get("responder", -1) == 0, "Removing the transformed target during a real contact retires its native Control and responder")
  verify(stale is Dictionary and not stale.get("connected", true) and close_values(rect_values(stale.get("rect", {})), [0, 0, 0, 0]) and \
    stats().get("cleanups", {}).get("gesture", -1) == 1 and stats().get("state", {}).get("gesture", {}).get("presses", -1) == before,
    "Removed original ref disconnects, React cleans once and removal never synthesizes a completed press")
  await inject("touch", "end", spec("gesture", "updated").page * Vector2(40, 35))
  verify(not sequence().has("Press") and root_state().get("pointer", {}).get("activeTouches", -1) == 0,
    "The physical release after removal cannot resurrect a stale transformed target")
  stages["remove-active"]["afterRemoval"] = removed
  stages["remove-active"]["retainedPublic"] = stale
  await finish()

func finish() -> void:
  var before_stop := root_state()
  application.call("stop")
  await frames(8)
  var stopped := native_state()
  var after_stop := root_state()
  var observed := stats()
  for id in ["gallery", "percent", "absolute-origin", "percent-origin", "scale-rotate", "rotate-scale", "mirror", "skew", "flatten", "gesture"]:
    verify(observed.get("mounts", {}).get(id, -1) == 1 and observed.get("cleanups", {}).get(id, -1) == 1,
      "All transform changes preserve one React mount and one shutdown cleanup: " + id)
  for id in ["flatten", "flatten-wrapper", "nested-child"]:
    var stale: Variant = js("GodotTransforms.stale(%s)" % JSON.stringify(id))
    verify(stale is Dictionary and not stale.get("connected", true) and close_values(rect_values(stale.get("rect", {})), [0, 0, 0, 0]),
      "Retained logical and concrete refs disconnect after transform shutdown: " + id)
  verify(after_stop.get("nativeTags", -1) == 0 and after_stop.get("creates", -1) == after_stop.get("deletes", -2) and \
    after_stop.get("pointer", {}).get("activeTouches", -1) == 0 and after_stop.get("pointer", {}).get("responder", -1) == 0,
    "Shutdown releases flattened and transformed native Controls, contacts and responders")
  verify(stopped.get("stopped", false) and stopped.get("rootCount", -1) == 0 and stopped.get("errors", []).is_empty() and \
    stopped.get("pendingTimers", -1) == 0 and stopped.get("pendingAnimationFrames", -1) == 0 and stopped.get("pendingWork", -1) == 0 and \
    stopped.get("pendingRootRetirements", -1) == 0, "Transform application shutdown has no host errors or pending scheduling resources")
  var report := {"scenario": "transforms", "godot": Engine.get_version_info().string, "react": "19.2.3", "reactNative": "0.87.1",
    "engine": "hermes", "renderer": "fabric", "displayServer": DisplayServer.get_name(), "validationInputDevice": surface.get_meta("validation_input_device", -1),
    "oracle": "Independent analytical 2D affine coefficients and exact corners; separate RN ancestor-AABB public measures and Yoga layout",
    "checks": checks, "stages": stages, "pixels": pixels, "initialInstances": initial_ids, "beforeStop": before_stop, "afterStop": after_stop,
    "applicationStopped": stopped, "reactState": observed}
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://build"))
  var output := FileAccess.open("res://build/report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_ERROR: Cannot write transform report")
    get_tree().quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  print("FABRIC_VALIDATION_FAILED: transforms" if failed else "FABRIC_VALIDATION_PASSED: transforms " + str(checks.size()))
  get_tree().quit(1 if failed else 0)
