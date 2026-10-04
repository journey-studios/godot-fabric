extends Node

var checks: Array = []
var stages: Dictionary = {}
var pixels: Array = []
var initial_ids: Dictionary = {}
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

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(" + expression + ")"))

func stats() -> Dictionary:
  var value: Variant = js("GodotView.stats()")
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

func control(id: String) -> Control:
  return surface.find_child(id, true, false) as Control

func at(id: String, offset: Vector2) -> Vector2:
  return control(id).get_global_transform_with_canvas() * offset

func read(id: String, parent_id: String = "") -> Dictionary:
  var value: Variant = js("GodotView.read(%s,%s)" % [JSON.stringify(id), JSON.stringify(parent_id)])
  return value if value is Dictionary else {}

func close_values(actual: Array, expected: Array) -> bool:
  if actual.size() != expected.size():
    return false
  for index in range(actual.size()):
    if absf(float(actual[index]) - float(expected[index])) > 0.01:
      return false
  return true

func rect_values(rect: Dictionary) -> Array:
  return [rect.get("x", -1), rect.get("y", -1), rect.get("width", -1), rect.get("height", -1)]

func geometry(id: String, parent_id: String, expected_relative: Array, expected_size: Vector2) -> Dictionary:
  var value := read(id, parent_id)
  var actual := control(id).get_global_rect()
  var window: Array = value.get("window", [])
  var measure: Array = value.get("measure", [])
  var valid: bool = value.get("connected", false) and int(value.get("tag", -1)) == int(native_node(id).get("tag", -2)) and \
    close_values(window, [actual.position.x, actual.position.y, actual.size.x, actual.size.y]) and \
    close_values(rect_values(value.get("rect", {})), window) and measure.size() == 6
  if measure.size() == 6:
    valid = valid and close_values([measure[2], measure[3]], [expected_size.x, expected_size.y])
  if not parent_id.is_empty():
    valid = valid and close_values(value.get("relative", []), expected_relative) and not value.get("relativeFailed", false)
  return {"valid": valid, "public": value, "native": native_node(id),
    "godotWindowRect": [actual.position.x, actual.position.y, actual.size.x, actual.size.y]}

func action(name: String, arguments: Array = []) -> void:
  var serialized: Array[String] = []
  for value in arguments:
    serialized.append(JSON.stringify(value))
  application.call("evaluate", "GodotView.action(%s%s)" % [JSON.stringify(name),
    "" if serialized.is_empty() else "," + ",".join(serialized)])
  await frames()

func mouse(pressed: bool, point: Vector2) -> void:
  if pressed:
    var motion := InputEventMouseMotion.new()
    motion.device = 1001
    motion.position = point
    get_viewport().push_input(motion, true)
  var event := InputEventMouseButton.new()
  event.device = 1001
  event.position = point
  event.button_index = MOUSE_BUTTON_LEFT
  event.pressed = pressed
  get_viewport().push_input(event, true)
  await frames(2)

func touch(pressed: bool, point: Vector2) -> void:
  var event := InputEventScreenTouch.new()
  event.device = 1001
  event.index = 0
  event.position = point
  event.pressed = pressed
  get_viewport().push_input(event, true)
  await frames(2)

func press(point: Vector2, expected: String, kind: String, stage: String) -> void:
  await action("clear")
  if kind == "mouse":
    await mouse(true, point)
    if stage == "siblings-raised":
      var moves_before: int = int(root_state().get("pointer", {}).get("moves", -1))
      var foreign := InputEventMouseMotion.new()
      foreign.device = 0
      foreign.position = Vector2.ZERO
      get_viewport().push_input(foreign, true)
      await frames(2)
      var filtered: Dictionary = root_state().get("pointer", {})
      verify(int(surface.get_meta("validation_input_device", -1)) == 1001 and \
        int(filtered.get("moves", -2)) == moves_before and int(filtered.get("activeTouches", -1)) == 1,
        "A foreign device cannot move or release the injected active pointer")
    await mouse(false, point)
  else:
    await touch(true, point)
    await touch(false, point)
  await get_tree().create_timer(0.15).timeout
  await frames(2)
  var events: Array = stats().get("events", [])
  var pointer: Dictionary = root_state().get("pointer", {})
  var delivered: bool = events.is_empty() if expected.is_empty() else events.size() == 1 and \
    events[0].get("id", "") == expected and int(events[0].get("target", -1)) == int(native_node(expected).get("tag", -2))
  verify(delivered and pointer.get("activeTouches", -1) == 0 and pointer.get("responder", -1) == 0,
    "%s hit target and released responder: %s" % [kind, stage])
  if not stages.has(stage):
    stages[stage] = {}
  stages[stage][kind] = {"point": [point.x, point.y], "expected": expected, "events": events, "pointer": pointer}

func paint(stage: String, samples: Array, capture_name: String = "") -> void:
  if not OS.get_cmdline_user_args().has("--capture"):
    return
  await frames(2)
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  for sample in samples:
    var point: Vector2 = sample.point
    var position := Vector2i(floori(point.x), floori(point.y))
    var in_bounds := position.x >= 0 and position.y >= 0 and position.x < image.get_width() and position.y < image.get_height()
    var actual := image.get_pixelv(position) if in_bounds else Color.TRANSPARENT
    var expected := Color(sample.color)
    var matched := in_bounds and maxf(absf(actual.r - expected.r), maxf(absf(actual.g - expected.g), absf(actual.b - expected.b))) <= 0.02 and actual.a > 0.99
    verify(matched, "Rendered pixel matches %s: %s" % [sample.id, stage])
    pixels.append({"stage": stage, "id": sample.id, "point": [position.x, position.y],
      "expected": sample.color, "actual": [actual.r, actual.g, actual.b, actual.a], "passed": matched})
  if not capture_name.is_empty():
    verify(image.save_png("res://build/view-" + capture_name + ".png") == OK, "Renderer capture saved: " + capture_name)

func sibling_stage(stage: String, expected: String, color: String) -> void:
  var point := at("siblings-arena", Vector2(85, 80))
  await press(point, expected, "mouse", stage)
  await press(point, expected, "touch", stage)
  var measured := geometry(expected, "siblings-arena", [20, 15, 130, 80], Vector2(130, 80))
  verify(measured.valid, "Sibling public measures retain the full layout rectangle: " + stage)
  stages[stage]["geometry"] = measured
  stages[stage]["state"] = stats().get("state", {})
  await paint(stage, [{"id": expected, "point": point, "color": color}], "updated" if stage == "siblings-high" else "")

func nested_stage(stage: String, expected: String, color: String) -> void:
  var point := at("nested-arena", Vector2(100, 75))
  await press(point, expected, "mouse", stage)
  await press(point, expected, "touch", stage)
  var measured := geometry("nested-child", "nested-parent", [20, 15, 110, 70], Vector2(110, 70))
  verify(measured.valid and native_node("nested-child").get("id", -1) == initial_ids.get("nested-child", -2),
    "Flatten/context transition preserves the child's full geometry and native instance: " + stage)
  stages[stage]["geometry"] = measured
  stages[stage]["state"] = stats().get("state", {})
  await paint(stage, [{"id": expected, "point": point, "color": color}])

func clip_stage(stage: String, clipped: bool) -> void:
  var outside := at("clip-parent", Vector2(100, 55))
  var inside := at("clip-parent", Vector2(70, 55))
  for kind in ["mouse", "touch"]:
    await press(outside, "" if clipped else "clip-child", kind, stage + "-outside")
    await press(inside, "clip-child", kind, stage + "-inside")
  var measured := geometry("clip-child", "clip-parent", [60, 20, 60, 40], Vector2(60, 40))
  verify(measured.valid and native_node("clip-child").get("id", -1) == initial_ids.get("clip-child", -2),
    "Overflow only clips drawing/input; public child measures and identity stay whole: " + stage)
  stages[stage] = {"geometry": measured, "state": stats().get("state", {})}
  await paint(stage, [{"id": "outside", "point": outside, "color": "#16233b" if clipped else "#22c55e"},
    {"id": "inside", "point": inside, "color": "#22c55e"}], "visible" if stage == "clip-visible" else "")

func border_stage(state: String, expected_colors: Array, painter: String) -> void:
  await action("border", [state])
  var measured := geometry("border-box", "", [], Vector2(180, 100))
  var appearance: Dictionary = native_node("border-box").get("appearance", {})
  verify(measured.valid and native_node("border-box").get("id", -1) == initial_ids.get("border-box", -2) and \
    appearance.get("borderPainter", "") == painter and close_values(appearance.get("borderWidths", []), [0, 0, 0, 0] if state == "removed" else [8, 8, 8, 8]),
    "Border painter transition preserves the View and applies every edge width: " + state)
  var samples: Array = []
  var points := [Vector2(90, 4), Vector2(176, 50), Vector2(90, 96), Vector2(4, 50)]
  var names := ["top", "right", "bottom", "left"]
  for index in range(points.size()):
    samples.append({"id": names[index], "point": at("border-box", points[index]), "color": expected_colors[index]})
  stages["border-" + state] = {"geometry": measured, "appearance": appearance, "state": stats().get("state", {})}
  await paint("border-" + state, samples)

func _ready() -> void:
  if DisplayServer.get_name() == "headless":
    get_window().size = Vector2i(900, 680)
  if not OS.get_cmdline_user_args().has("--validate"):
    return
  surface.set_meta("validation_input_device", 1001)
  await frames(8)
  var deadline := Time.get_ticks_msec() + 5000
  while application.call("evaluate", "Boolean(globalThis.GodotView && GodotView.stats().mounts === 1)") != "true" and Time.get_ticks_msec() < deadline and native_state().get("errors", []).is_empty():
    await frames(1)
  if not verify(stats().get("mounts", 0) == 1, "AppRegistry mounts one ViewGeometry root"):
    await finish()
    return
  var ids := ["siblings-arena", "sibling-red", "sibling-blue", "nested-arena", "nested-parent", "nested-child", "nested-front",
    "static-front", "static-back", "clip-parent", "clip-child", "border-box", "border-child", "border-corner", "view-raise"]
  var present := true
  for id in ids:
    present = present and control(id) != null and not native_node(id).is_empty()
    initial_ids[id] = native_node(id).get("id", -1)
  if not verify(present, "Every geometry, input and border probe has a real native Control"):
    await finish()
    return
  verify(read("sibling-red").get("connected", false) and read("clip-child").get("connected", false), "Public refs connect to the mounted Fabric tree")
  verify(native_state().get("rootCount", -1) == 1 and native_state().get("bundleEvaluations", -1) == 1 and native_state().get("errors", []).is_empty(), "The fixture owns one root and one bundle evaluation without host errors")
  application.call("evaluate", "GodotView.retain('sibling-red')")
  await paint("initial", [], "initial")
  await sibling_stage("siblings-initial", "sibling-red", "#e05252")
  if OS.get_cmdline_user_args().has("--capture"):
    var button := control("view-raise")
    await mouse(true, button.get_global_rect().get_center())
    await mouse(false, button.get_global_rect().get_center())
    await frames()
    verify(stats().get("state", {}).get("z", {}).get("blue", -1) == 6,
      "A real GUI pointer click on public Button updates the same React layer state")
  await action("raise")
  await sibling_stage("siblings-raised", "sibling-blue", "#3b82f6")
  await action("equal")
  await sibling_stage("siblings-equal", "sibling-blue", "#3b82f6")
  await action("reorder")
  await sibling_stage("siblings-reordered", "sibling-red", "#e05252")
  await action("high")
  await sibling_stage("siblings-high", "sibling-red", "#e05252")
  verify(native_node("sibling-blue").get("id", -1) == initial_ids.get("sibling-blue", -2), "Keyed reordering and unclamped z values preserve the sibling instance")
  await action("remove")
  await sibling_stage("siblings-removed", "sibling-blue", "#3b82f6")
  var stale: Variant = js("GodotView.stale('sibling-red')")
  stages["stale-removed"] = stale if stale is Dictionary else {"value": stale}
  verify(stale is Dictionary and not stale.get("connected", true) and rect_values(stale.get("rect", {})) == [0.0, 0.0, 0.0, 0.0] and control("sibling-red") == null,
    "Removing a sibling invalidates its retained public ref and native Control")
  await nested_stage("nested-isolated", "nested-front", "#06b6d4")
  await action("context", [false])
  await nested_stage("nested-shared", "nested-child", "#a855f7")
  await action("context", [true])
  await nested_stage("nested-restored", "nested-front", "#06b6d4")
  var static_point := at("static-front", Vector2(60, 60))
  await press(static_point, "static-front", "mouse", "static")
  await press(static_point, "static-front", "touch", "static")
  var static_geometry := geometry("static-front", "static-arena", [40, 15, 130, 80], Vector2(130, 80))
  verify(static_geometry.valid, "Static zIndex has no stacking effect and Yoga keeps the overlapping layout")
  stages["static"]["geometry"] = static_geometry
  await paint("static", [{"id": "static-front", "point": static_point, "color": "#14b8a6"}])
  await clip_stage("clip-hidden", true)
  await action("overflow", ["visible"])
  await clip_stage("clip-visible", false)
  await action("overflow", ["scroll"])
  await clip_stage("clip-scroll", true)
  await action("overflow")
  await clip_stage("clip-removed", false)
  var border_geometry := geometry("border-box", "", [], Vector2(180, 100))
  verify(border_geometry.valid, "Public border View measures agree with its full native rectangle")
  stages["borders"] = {"geometry": border_geometry}
  var border_point := at("border-child", Vector2(75, 32))
  await press(border_point, "border-child", "mouse", "borders")
  await press(border_point, "border-child", "touch", "borders")
  await paint("borders", [{"id": "top", "point": at("border-box", Vector2(90, 4)), "color": "#ef4444"},
    {"id": "right", "point": at("border-box", Vector2(176, 50)), "color": "#22c55e"},
    {"id": "bottom", "point": at("border-box", Vector2(90, 96)), "color": "#3b82f6"},
    {"id": "left", "point": at("border-box", Vector2(4, 50)), "color": "#f59e0b"},
    {"id": "child", "point": border_point, "color": "#a855f7"}])
  var corner_geometry := geometry("border-corner", "", [], Vector2(60, 60))
  verify(corner_geometry.valid and close_values(native_node("border-corner").get("appearance", {}).get("borderWidths", []), [2, 10, 2, 10]),
    "The rounded corner probe retains independent asymmetric border widths")
  stages["border-corner"] = {"geometry": corner_geometry}
  await paint("border-corner", [{"id": "left-side-corner-join", "point": at("border-corner", Vector2(1, 13)), "color": "#ff0000"}])
  await border_stage("alpha", ["#ff8080", "#80ff80", "#8080ff", "#ffff80"], "multicolor")
  await border_stage("uniform", ["#ff8080", "#ff8080", "#ff8080", "#ff8080"], "flat")
  await border_stage("removed", ["#ffffff", "#ffffff", "#ffffff", "#ffffff"], "flat")
  await finish()

func finish() -> void:
  var before_stop := root_state()
  application.call("stop")
  await frames(8)
  var after_stop := root_state()
  var application_stopped := native_state()
  verify(stats().get("mounts", -1) == 1 and stats().get("cleanups", -1) == 1, "All View rerenders preserve the component and shutdown runs its effect cleanup once")
  verify(application_stopped.get("stopped", false) and application_stopped.get("rootCount", -1) == 0 and application_stopped.get("errors", []).is_empty() and \
    after_stop.get("nativeTags", -1) == 0 and after_stop.get("creates", -1) == after_stop.get("deletes", -2), "Shutdown retires every native Control without host errors")
  verify(application_stopped.get("pendingTimers", -1) == 0 and application_stopped.get("pendingAnimationFrames", -1) == 0 and \
    application_stopped.get("pendingWork", -1) == 0 and application_stopped.get("pendingRootRetirements", -1) == 0, "Shutdown leaves no pending responder, timer, frame or retirement work")
  var report := {"scenario": "view", "godot": Engine.get_version_info().string, "react": "19.2.3", "reactNative": "0.87.1",
    "engine": "hermes", "renderer": "fabric", "displayServer": DisplayServer.get_name(), "inputTransport": "viewport-pointer", "validationInputDevice": surface.get_meta("validation_input_device", -1),
    "checks": checks, "stages": stages, "pixels": pixels, "initialInstances": initial_ids,
    "beforeStop": before_stop, "afterStop": after_stop, "applicationStopped": application_stopped, "reactState": stats()}
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://build"))
  var output := FileAccess.open("res://build/report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_ERROR: Cannot write View geometry report")
    get_tree().quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  print("FABRIC_VALIDATION_FAILED: view" if failed else "FABRIC_VALIDATION_PASSED: view " + str(checks.size()))
  get_tree().quit(1 if failed else 0)
