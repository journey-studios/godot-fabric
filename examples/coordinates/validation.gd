extends Node

var checks: Array = []
var stages: Dictionary = {}
var pixels: Array = []
var initial_ids: Dictionary = {}
var original_size: Vector2i
var original_content_size: Vector2i
var original_mode: int
var original_factor: float
@onready var application: Node = $Application
@onready var surface_a: Control = $A
@onready var surface_b: Control = $B

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
  var value: Variant = js("GodotCoordinates.stats()")
  return value if value is Dictionary else {}

func metrics() -> Dictionary:
  var value: Variant = js("GodotCoordinates.metrics()")
  return value if value is Dictionary else {}

func native_state() -> Dictionary:
  var value: Variant = JSON.parse_string(application.call("snapshot"))
  return value if value is Dictionary else {}

func surface(name: String) -> Control:
  return surface_a if name == "A" else surface_b

func root_state(name: String) -> Dictionary:
  var value: Variant = JSON.parse_string(surface(name).call("snapshot"))
  return value if value is Dictionary else {}

func native_node(name: String, id: String) -> Dictionary:
  for entry in root_state(name).get("nodes", []):
    if entry.get("testID", "") == name + "-" + id:
      return entry
  return {}

func control(name: String, id: String = "target") -> Control:
  return surface(name).find_child(name + "-" + id, true, false) as Control

func read(name: String, id: String = "target", parent: String = "frame") -> Dictionary:
  var value: Variant = js("GodotCoordinates.read(%s,%s,%s)" % [JSON.stringify(name), JSON.stringify(id), JSON.stringify(parent)])
  return value if value is Dictionary else {}

func events(name: String) -> Array:
  return stats().get("roots", {}).get(name, {}).get("events", [])

func react_state(name: String) -> Dictionary:
  return stats().get("roots", {}).get(name, {}).get("state", {})

func close_values(actual: Array, expected: Array) -> bool:
  if actual.size() != expected.size():
    return false
  for index in range(actual.size()):
    if absf(float(actual[index]) - float(expected[index])) > 0.02:
      return false
  return true

func rect_values(rect: Dictionary) -> Array:
  return [rect.get("x", -1), rect.get("y", -1), rect.get("width", -1), rect.get("height", -1)]

func bounds(node: Control, projection: Transform2D = Transform2D.IDENTITY) -> Array:
  var transform := projection * node.get_global_transform_with_canvas()
  var points: Array[Vector2] = [Vector2.ZERO, Vector2(node.size.x, 0), Vector2(0, node.size.y), node.size]
  var result := Rect2(transform * points[0], Vector2.ZERO)
  for index in range(1, points.size()):
    result = result.expand(transform * points[index])
  return [result.position.x, result.position.y, result.size.x, result.size.y]

func geometry(name: String, stage: String) -> void:
  var value := read(name)
  var node := control(name)
  var root_bounds := bounds(node, surface(name).get_global_transform_with_canvas().affine_inverse())
  var frame_bounds := bounds(node, control(name, "frame").get_global_transform_with_canvas().affine_inverse())
  var window_bounds := bounds(node)
  var measurement: Array = value.get("measure", [])
  var connected: bool = value.get("connected", false) and int(value.get("tag", -1)) == int(native_node(name, "target").get("tag", -2))
  verify(connected and native_node(name, "target").get("id", -1) == initial_ids.get(name, -2),
    "Original public ref and native identity survive embedding changes: " + stage + " " + name)
  var root_geometry: bool = measurement.size() == 6
  if measurement.size() == 6:
    root_geometry = close_values([measurement[4], measurement[5], measurement[2], measurement[3]], root_bounds) and \
      close_values([measurement[0], measurement[1]], [35.0, 50.0])
  verify(root_geometry, "measure preserves unscaled RN root/layout points: " + stage + " " + name)
  verify(close_values(value.get("relative", []), frame_bounds) and close_values(frame_bounds, [35.0, 50.0, 180.0, 90.0]) and \
    not value.get("relativeFailed", false), "measureLayout follows the logical frame independently of window embedding: " + stage + " " + name)
  verify(close_values(value.get("window", []), window_bounds) and close_values(rect_values(value.get("rect", {})), window_bounds) and \
    not close_values([root_bounds[0], root_bounds[1]], [window_bounds[0], window_bounds[1]]),
    "Window measures and DOMRect match all four Godot corners and differ from root position: " + stage + " " + name)
  if not stages.has(stage):
    stages[stage] = {}
  stages[stage][name] = {"public": value, "godotRootRect": root_bounds, "godotFrameRect": frame_bounds,
    "godotWindowRect": window_bounds, "surfacePosition": [surface(name).position.x, surface(name).position.y],
    "surfaceScale": [surface(name).scale.x, surface(name).scale.y], "metrics": metrics()}

func clear(name: String) -> void:
  application.call("evaluate", "GodotCoordinates.clear(%s)" % JSON.stringify(name))
  await frames(2)

func label(name: String, value: String) -> void:
  application.call("evaluate", "GodotCoordinates.embedding(%s,%s)" % [JSON.stringify(name), JSON.stringify(value)])
  await frames()

func inject(kind: String, phase: String, point: Vector2, window_pixels: bool) -> void:
  var supplied_point := get_window().get_final_transform() * point if window_pixels else point
  if kind == "mouse":
    if phase != "end":
      var motion := InputEventMouseMotion.new()
      motion.device = 1001
      motion.position = supplied_point
      motion.button_mask = MOUSE_BUTTON_MASK_LEFT if phase == "move" else 0
      get_viewport().push_input(motion, not window_pixels)
    if phase != "move":
      var button := InputEventMouseButton.new()
      button.device = 1001
      button.position = supplied_point
      button.button_index = MOUSE_BUTTON_LEFT
      button.pressed = phase == "start"
      get_viewport().push_input(button, not window_pixels)
  elif phase == "move":
    var drag := InputEventScreenDrag.new()
    drag.device = 1001
    drag.index = 2
    drag.position = supplied_point
    get_viewport().push_input(drag, not window_pixels)
  else:
    var touch := InputEventScreenTouch.new()
    touch.device = 1001
    touch.index = 2
    touch.position = supplied_point
    touch.pressed = phase == "start"
    get_viewport().push_input(touch, not window_pixels)
  await frames(4)

func contact_matches(event: Dictionary, expected_page: Vector2, expected_local: Vector2, expected_screen: Vector2, tag: int, identifier: int) -> bool:
  return int(event.get("target", -1)) == tag and int(event.get("identifier", -1)) == identifier and \
    close_values([event.get("pageX", -999), event.get("pageY", -999)], [expected_page.x, expected_page.y]) and \
    close_values([event.get("locationX", -999), event.get("locationY", -999)], [expected_local.x, expected_local.y]) and \
    close_values([event.get("screenX", -999), event.get("screenY", -999)], [expected_screen.x, expected_screen.y]) and float(event.get("timestamp", 0)) > 0

func pointer_step(name: String, stage: String, kind: String, phase: String, local_point: Vector2, window_pixels: bool = false) -> void:
  var node := control(name)
  var point := node.get_global_transform_with_canvas() * local_point
  var expected_page := surface(name).get_global_transform_with_canvas().affine_inverse() * point
  var expected_local := node.get_global_transform_with_canvas().affine_inverse() * point
  var density: float = float(metrics().get("window", {}).get("scale", -1))
  var expected_screen := (Vector2(get_window().position) + get_window().get_final_transform() * point) / density
  var value := read(name)
  var measurement: Array = value.get("measure", [])
  var page_from_measure := Vector2(-999, -999)
  if measurement.size() == 6:
    page_from_measure = Vector2(float(measurement[4]), float(measurement[5])) + local_point
  var previous: int = events(name).size()
  await inject(kind, phase, point, window_pixels)
  await settle()
  var observed: Array = events(name).slice(previous)
  var expected_type: String = {"start": "TouchStart", "move": "TouchMove", "end": "TouchEnd"}[phase]
  var touches: Array = observed.filter(func(entry: Dictionary) -> bool: return entry.get("type", "") == expected_type)
  var tag: int = int(native_node(name, "target").get("tag", -1))
  var identifier: int = 0 if kind == "mouse" else 3
  var valid: bool = touches.size() == 1 and close_values([expected_page.x, expected_page.y], [page_from_measure.x, page_from_measure.y])
  if touches.size() == 1:
    valid = valid and touches[0].get("rootName", "") == name and contact_matches(touches[0], expected_page, expected_local, expected_screen, tag, identifier)
  verify(valid, "Real %s %s carries root page, target local and density-normalized screen points: %s %s" % [kind, phase, stage, name])
  var arrays_valid: bool = touches.size() == 1
  if touches.size() == 1:
    var changed: Array = touches[0].get("changedTouches", [])
    var active: Array = touches[0].get("touches", [])
    arrays_valid = changed.size() == 1 and active.size() == (0 if phase == "end" else 1)
    if changed.size() == 1:
      arrays_valid = arrays_valid and contact_matches(changed[0], expected_page, expected_local, expected_screen, tag, identifier)
    if phase != "end" and active.size() == 1:
      arrays_valid = arrays_valid and contact_matches(active[0], expected_page, expected_local, expected_screen, tag, identifier)
  verify(arrays_valid, "Original contact arrays retain identity and the same coordinate spaces: %s %s %s %s" % [stage, name, kind, phase])
  var pointer: Dictionary = root_state(name).get("pointer", {})
  verify(pointer.get("activeTouches", -1) == (0 if phase == "end" else 1) and \
    int(pointer.get("responder", -1)) == (0 if phase == "end" else tag),
    "Responder and contact lifetime follow genuine %s %s: %s %s" % [kind, phase, stage, name])
  if not stages.has(stage):
    stages[stage] = {}
  if not stages[stage].has("samples"):
    stages[stage]["samples"] = []
  stages[stage]["samples"].append({"rootName": name, "kind": kind, "phase": phase,
    "transport": "window-pixels" if window_pixels else "viewport-local", "inputViewportPoint": [point.x, point.y],
    "inputSuppliedPoint": [(get_window().get_final_transform() * point).x, (get_window().get_final_transform() * point).y] if window_pixels else [point.x, point.y],
    "expectedPage": [expected_page.x, expected_page.y], "expectedLocal": [expected_local.x, expected_local.y],
    "expectedScreen": [expected_screen.x, expected_screen.y], "pageFromPublicMeasure": [page_from_measure.x, page_from_measure.y],
    "publicGeometry": value, "events": observed, "pointer": pointer, "reactState": react_state(name), "metrics": metrics()})

func press_sequence(name: String) -> Array:
  return events(name).filter(func(entry: Dictionary) -> bool: return entry.get("type", "") in ["PressIn", "PressOut", "Press"]).map(func(entry: Dictionary) -> String: return entry.type)

func retention(name: String, stage: String, kind: String, window_pixels: bool = false) -> void:
  await clear(name)
  var before: int = int(react_state(name).get("presses", -1))
  await pointer_step(name, stage, kind, "start", Vector2(130, 75), window_pixels)
  verify(react_state(name).get("held", false) and press_sequence(name) == ["PressIn"], "Start activates the original pressed render state: " + stage + " " + kind)
  await pointer_step(name, stage, kind, "move", Vector2(140, 75), window_pixels)
  verify(react_state(name).get("held", false) and press_sequence(name) == ["PressIn"], "Moving inside the root-space retention region keeps Pressability active: " + stage + " " + kind)
  await pointer_step(name, stage, kind, "move", Vector2(270, 75), window_pixels)
  verify(not react_state(name).get("held", true) and press_sequence(name) == ["PressIn", "PressOut"], "Moving beyond retention deactivates without losing the responder: " + stage + " " + kind)
  await pointer_step(name, stage, kind, "move", Vector2(140, 75), window_pixels)
  verify(react_state(name).get("held", false) and press_sequence(name) == ["PressIn", "PressOut", "PressIn"], "Returning inside retention reactivates through original Pressability: " + stage + " " + kind)
  await pointer_step(name, stage, kind, "end", Vector2(140, 75), window_pixels)
  verify(press_sequence(name) == ["PressIn", "PressOut", "PressIn", "PressOut", "Press"] and \
    react_state(name).get("presses", -1) == before + 1 and not react_state(name).get("held", true),
    "Returning and releasing completes exactly one public press: " + stage + " " + kind)

func tap_other(stage: String, window_pixels: bool = false) -> void:
  await clear("B")
  var a_before := react_state("A").duplicate(true)
  var before: int = int(react_state("B").get("presses", -1))
  await pointer_step("B", stage, "touch", "start", Vector2(130, 75), window_pixels)
  await pointer_step("B", stage, "touch", "move", Vector2(140, 75), window_pixels)
  await pointer_step("B", stage, "touch", "end", Vector2(140, 75), window_pixels)
  verify(press_sequence("B") == ["PressIn", "PressOut", "Press"] and react_state("B").get("presses", -1) == before + 1 and \
    react_state("A") == a_before and int(root_state("A").get("pointer", {}).get("activeTouches", -1)) == 0,
    "The second root receives only its own callback and state after an embedding change: " + stage)

func capture(stage: String) -> void:
  if not OS.get_cmdline_user_args().has("--capture"):
    return
  await frames(2)
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  for name in ["A", "B"]:
    var logical_point := control(name).get_global_transform_with_canvas() * Vector2(150, 65)
    var physical_point := get_window().get_final_transform() * logical_point
    var point := Vector2i(floori(physical_point.x), floori(physical_point.y))
    var in_bounds: bool = point.x >= 0 and point.y >= 0 and point.x < image.get_width() and point.y < image.get_height()
    var actual := image.get_pixelv(point) if in_bounds else Color.TRANSPARENT
    var expected_hex: String = "#f59e0b" if react_state(name).get("held", false) else "#0284c7" if name == "A" else "#0f766e"
    var expected := Color(expected_hex)
    var matched: bool = in_bounds and maxf(absf(actual.r - expected.r), maxf(absf(actual.g - expected.g), absf(actual.b - expected.b))) <= 0.02 and actual.a > 0.99
    verify(matched, "Rendered target pixel agrees with original pressed state and embedding: " + stage + " " + name)
    pixels.append({"stage": stage, "rootName": name, "point": [point.x, point.y], "viewportPoint": [logical_point.x, logical_point.y],
      "expected": expected_hex, "actual": [actual.r, actual.g, actual.b, actual.a], "pressed": react_state(name).get("held", false), "passed": matched})
  verify(image.save_png("res://build/coordinate-" + stage + ".png") == OK,
    "Native renderer capture saved between gesture cases: " + stage)

func wait_ready(expression: String, name: String) -> bool:
  var deadline := Time.get_ticks_msec() + 5000
  while application.call("evaluate", expression) != "true" and Time.get_ticks_msec() < deadline and native_state().get("errors", []).is_empty():
    await frames(1)
  return verify(application.call("evaluate", expression) == "true", name)

func _ready() -> void:
  original_size = get_window().size
  original_content_size = get_window().content_scale_size
  original_mode = get_window().content_scale_mode
  original_factor = get_window().content_scale_factor
  if DisplayServer.get_name() == "headless":
    get_window().size = Vector2i(900, 680)
  if not OS.get_cmdline_user_args().has("--validate"):
    return
  surface_a.set_meta("validation_input_device", 1001)
  surface_b.set_meta("validation_input_device", 1001)
  await frames(8)
  if not await wait_ready("Boolean(globalThis.GodotCoordinates && GodotCoordinates.stats().mounts.A === 1 && GodotCoordinates.stats().mounts.B === 1)", "AppRegistry mounts two public coordinate roots"):
    await finish()
    return
  var present := true
  for name in ["A", "B"]:
    for id in ["root", "frame", "target"]:
      present = present and control(name, id) != null and not native_node(name, id).is_empty()
    initial_ids[name] = native_node(name, "target").get("id", -1)
    application.call("evaluate", "GodotCoordinates.retain(%s)" % JSON.stringify(name))
  if not verify(present, "Each root commits real native geometry and input Controls"):
    await finish()
    return
  verify(native_state().get("rootCount", -1) == 2 and native_state().get("bundleEvaluations", -1) == 1 and \
    root_state("A").get("surfaceId", -1) != root_state("B").get("surfaceId", -1) and \
    root_state("A").get("runtimeId", -1) == root_state("B").get("runtimeId", -2),
    "Distinct roots share one Hermes application and one bundle evaluation")
  geometry("A", "initial")
  geometry("B", "initial")
  await capture("initial")
  await retention("A", "offset", "mouse")
  await retention("A", "offset", "touch")
  await tap_other("offset-B")
  await clear("A")
  var before: int = int(react_state("A").get("presses", -1))
  await pointer_step("A", "release-outside", "mouse", "start", Vector2(130, 75))
  await pointer_step("A", "release-outside", "mouse", "move", Vector2(270, 75))
  await pointer_step("A", "release-outside", "mouse", "end", Vector2(270, 75))
  verify(react_state("A").get("presses", -1) == before and press_sequence("A") == ["PressIn", "PressOut"],
    "Releasing outside retention never fires a public press")
  await clear("A")
  before = int(react_state("A").get("presses", -1))
  await pointer_step("A", "move-surface-active", "touch", "start", Vector2(130, 75))
  surface_a.position += Vector2(70, 35)
  await label("A", "Godot surface moved during a held touch")
  geometry("A", "moved")
  geometry("B", "moved")
  await pointer_step("A", "move-surface-active", "touch", "move", Vector2(140, 75))
  verify(react_state("A").get("held", false) and press_sequence("A") == ["PressIn"],
    "A real move after moving the Godot surface keeps the unchanged RN retention region active")
  await pointer_step("A", "move-surface-active", "touch", "end", Vector2(140, 75))
  verify(react_state("A").get("presses", -1) == before + 1 and press_sequence("A") == ["PressIn", "PressOut", "Press"],
    "Repositioning a held surface preserves one original Pressability press")
  await tap_other("moved-B")
  surface_a.scale = Vector2(0.8, 1.2)
  await label("A", "Godot embedding scale: 0.8 × 1.2")
  geometry("A", "scaled")
  geometry("B", "scaled")
  await retention("A", "scaled", "mouse")
  await retention("A", "scaled", "touch")
  await tap_other("scaled-B")
  await clear("A")
  before = int(react_state("A").get("presses", -1))
  await pointer_step("A", "scaled-capture-held", "touch", "start", Vector2(130, 75))
  await capture("scaled")
  await pointer_step("A", "scaled-capture-held", "touch", "end", Vector2(130, 75))
  verify(react_state("A").get("presses", -1) == before + 1 and press_sequence("A") == ["PressIn", "PressOut", "Press"],
    "The dedicated scaled capture records pressed state and releases exactly one press")
  get_window().size = Vector2i(1280, 960)
  get_window().content_scale_size = Vector2i.ZERO
  get_window().content_scale_mode = Window.CONTENT_SCALE_MODE_CANVAS_ITEMS
  surface_a.position = Vector2(15, 20)
  surface_b.position = Vector2(310, 35)
  surface_a.size = Vector2(300, 430)
  surface_b.size = Vector2(300, 430)
  surface_a.scale = Vector2(0.8, 1.0)
  await frames()
  await clear("B")
  before = int(react_state("B").get("presses", -1))
  # The factor change and START are synchronous. In particular, do not evaluate
  # JS or pump a frame here: input must sample current Godot density itself.
  # B is the last scene child and receives this real input before A can pump
  # the shared application while missing its target.
  get_window().content_scale_factor = 2
  var immediate_node := control("B")
  var immediate_point := immediate_node.get_global_transform_with_canvas() * Vector2(130, 75)
  var immediate_page := surface_b.get_global_transform_with_canvas().affine_inverse() * immediate_point
  var content_transform := get_window().get_final_transform() * get_window().get_global_canvas_transform().affine_inverse()
  var immediate_density: float = content_transform.get_scale().x
  var immediate_raw := get_window().get_final_transform() * immediate_point
  var immediate_screen := (Vector2(get_window().position) + immediate_raw) / immediate_density
  var immediate_touch := InputEventScreenTouch.new()
  immediate_touch.device = 1001
  immediate_touch.index = 2
  immediate_touch.position = immediate_raw
  immediate_touch.pressed = true
  get_viewport().push_input(immediate_touch, false)
  await frames(4)
  await settle()
  var immediate_events: Array = events("B")
  var immediate_starts: Array = immediate_events.filter(func(entry: Dictionary) -> bool: return entry.get("type", "") == "TouchStart")
  var current_density_valid: bool = is_equal_approx(immediate_density, 2) and immediate_starts.size() == 1
  if immediate_starts.size() == 1:
    current_density_valid = current_density_valid and contact_matches(immediate_starts[0], immediate_page, Vector2(130, 75), immediate_screen,
      int(native_node("B", "target").get("tag", -1)), 3)
  verify(current_density_valid, "START immediately after a density change samples current Godot screen units before a frame refresh")
  verify(react_state("B").get("held", false) and press_sequence("B") == ["PressIn"] and \
    int(root_state("B").get("pointer", {}).get("activeTouches", -1)) == 1,
    "The first raw-window contact after changing density activates the same original Pressability target")
  stages["density-immediate"] = {"rootName": "B", "currentGodotDensity": immediate_density, "inputViewportPoint": [immediate_point.x, immediate_point.y],
    "inputSuppliedPoint": [immediate_raw.x, immediate_raw.y], "expectedPage": [immediate_page.x, immediate_page.y],
    "expectedLocal": [130.0, 75.0], "expectedScreen": [immediate_screen.x, immediate_screen.y], "events": immediate_events, "metricsAfterDispatch": metrics()}
  await pointer_step("B", "density-immediate", "touch", "end", Vector2(130, 75), true)
  verify(react_state("B").get("presses", -1) == before + 1 and press_sequence("B") == ["PressIn", "PressOut", "Press"],
    "The first density-change contact releases exactly one press without delayed coordinate repair")
  await label("A", "Density 2 px / point · Godot scale 0.8 × 1.0")
  await label("B", "Density 2 px / point · independent root")
  if not await wait_ready("GodotCoordinates.metrics().pixelRatio === 2 && GodotCoordinates.metrics().window.scale === 2", "Original Dimensions and PixelRatio expose content density two"):
    await finish()
    return
  verify(get_window().get_visible_rect().size.is_equal_approx(Vector2(get_window().size) / 2),
    "Godot logical content size agrees with two physical pixels per RN point")
  geometry("A", "density-two")
  geometry("B", "density-two")
  await retention("A", "density-two", "mouse", true)
  await retention("A", "density-two", "touch", true)
  await tap_other("density-two-B", true)
  await capture("density")
  await finish()

func finish() -> void:
  get_window().content_scale_factor = original_factor
  get_window().content_scale_size = original_content_size
  get_window().content_scale_mode = original_mode
  get_window().size = original_size
  await frames()
  var before_stop := {"A": root_state("A"), "B": root_state("B"), "application": native_state()}
  application.call("stop")
  await frames(8)
  var stopped := native_state()
  var after_stop := {"A": root_state("A"), "B": root_state("B")}
  var cleanups: Dictionary = stats().get("cleanups", {})
  verify(cleanups.get("A", -1) == 1 and cleanups.get("B", -1) == 1 and stats().get("mounts", {}).get("A", -1) == 1 and \
    stats().get("mounts", {}).get("B", -1) == 1, "Embedding changes preserve both React components and shutdown cleans each effect once")
  for name in ["A", "B"]:
    var state: Dictionary = after_stop[name]
    verify(state.get("nativeTags", -1) == 0 and state.get("creates", -1) == state.get("deletes", -2) and \
      state.get("pointer", {}).get("activeTouches", -1) == 0 and state.get("pointer", {}).get("responder", -1) == 0,
      "Shutdown retires every Control, contact and responder in root " + name)
    var stale: Variant = js("GodotCoordinates.stale(%s)" % JSON.stringify(name))
    verify(stale is Dictionary and not stale.get("connected", true) and \
      close_values(rect_values(stale.get("rect", {})), [0.0, 0.0, 0.0, 0.0]), "Retained public ref becomes disconnected with empty window geometry in root " + name)
  verify(stopped.get("stopped", false) and stopped.get("rootCount", -1) == 0 and stopped.get("errors", []).is_empty(),
    "Application shutdown leaves no roots or host errors")
  verify(stopped.get("pendingTimers", -1) == 0 and stopped.get("pendingAnimationFrames", -1) == 0 and \
    stopped.get("pendingWork", -1) == 0 and stopped.get("pendingRootRetirements", -1) == 0,
    "Coordinate gestures leave no timer, frame, work or root retirement resources")
  var report := {"scenario": "coordinates", "godot": Engine.get_version_info().string, "react": "19.2.3", "reactNative": "0.87.1",
    "engine": "hermes", "renderer": "fabric", "displayServer": DisplayServer.get_name(), "inputTransport": "viewport-pointer + window-pixel localization",
    "validationInputDevice": {"A": surface_a.get_meta("validation_input_device", -1), "B": surface_b.get_meta("validation_input_device", -1)},
    "checks": checks, "stages": stages, "pixels": pixels, "initialInstances": initial_ids, "beforeStop": before_stop, "afterStop": after_stop,
    "applicationStopped": stopped, "reactState": stats(), "restoredWindow": {"size": [get_window().size.x, get_window().size.y],
      "contentSize": [get_window().content_scale_size.x, get_window().content_scale_size.y], "mode": get_window().content_scale_mode,
      "factor": get_window().content_scale_factor}}
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://build"))
  var output := FileAccess.open("res://build/report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_ERROR: Cannot write coordinate report")
    get_tree().quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  print("FABRIC_VALIDATION_FAILED: coordinates" if failed else "FABRIC_VALIDATION_PASSED: coordinates " + str(checks.size()))
  get_tree().quit(1 if failed else 0)
