extends Node

# The public PanResponder example under a real mouse drag. The box is pressed,
# dragged in steps and released; after each step its Control is read from the
# native tree and the gesture state from what React observed. With --capture the
# renderer's frame is saved and the pixels where the box was and where it went are hashed.
const DEVICE := 1001
const STEP := Vector2(40, 15)
var checks: Array = []
var stages: Dictionary = {}
var images: Dictionary = {}
var capturing := false
@onready var application: Node = $Application
@onready var surface: Control = $Surface

func verify(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

func frames(count: int = 1) -> void:
  for index in range(count):
    await get_tree().process_frame

func wait_for(condition: Callable, limit_ms: int = 6000) -> bool:
  var started := Time.get_ticks_msec()
  while Time.get_ticks_msec() - started < limit_ms and not condition.call():
    await frames()
  return condition.call()

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(" + expression + ")"))

func example() -> Dictionary:
  var value: Variant = js("globalThis.PanResponderExample.state()")
  return value if value is Dictionary else {}

func native_state() -> Dictionary:
  var value: Variant = JSON.parse_string(application.call("snapshot"))
  return value if value is Dictionary else {}

func node_of(id: String) -> Dictionary:
  var value: Variant = JSON.parse_string(surface.call("snapshot"))
  var nodes: Variant = value.get("nodes", []) if value is Dictionary else []
  for entry: Dictionary in nodes:
    if entry.get("testID") == id:
      return entry
  return {}

func text(id: String) -> String:
  return str(node_of(id).get("nativeText", ""))

func control(id: String) -> Control:
  return surface.find_child(id, true, false) as Control

func box_rect() -> Rect2:
  return control("pan-box").get_global_rect()

func pointer_clear() -> bool:
  var pointer: Dictionary = JSON.parse_string(surface.call("snapshot")).get("pointer", {})
  return int(pointer.get("responder", -1)) == 0 and int(pointer.get("activeTouches", -1)) == 0

# The readback rectangle of a rectangle, in the physical pixels of the saved frame.
func region(area: Rect2) -> Rect2i:
  var physical := get_window().get_final_transform() * area
  return Rect2i(Vector2i(physical.position.round()), Vector2i(physical.size.round()))

func digest(image: Image, area: Rect2i) -> String:
  var context := HashingContext.new()
  context.start(HashingContext.HASH_SHA256)
  context.update(image.get_region(area).get_data())
  return context.finish().hex_encode()

# The pixels of the two places the box visits are hashed apart from the readout text.
func capture(stage: String, spots: Dictionary) -> void:
  if not capturing:
    return
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  verify(image.save_png("res://build/pan-responder-%s.png" % stage) == OK, "Renderer capture saved: " + stage)
  var frame := Rect2i(Vector2i.ZERO, image.get_size())
  var pixels := {}
  var inside := true
  for name: String in spots:
    var area := region(spots[name])
    inside = inside and area.has_area() and frame.encloses(area)
    pixels[name] = digest(image, area) if area.has_area() and frame.encloses(area) else ""
  verify(inside, "Both places the box visits lie inside the captured frame: " + stage)
  images[stage] = pixels

func motion(point: Vector2, held: bool) -> void:
  var event := InputEventMouseMotion.new()
  event.device = DEVICE
  event.position = point
  event.button_mask = MOUSE_BUTTON_MASK_LEFT if held else 0
  Input.parse_input_event(event)

func button(point: Vector2, pressed: bool) -> void:
  var event := InputEventMouseButton.new()
  event.device = DEVICE
  event.position = point
  event.button_index = MOUSE_BUTTON_LEFT
  event.pressed = pressed
  event.button_mask = MOUSE_BUTTON_MASK_LEFT if pressed else 0
  Input.parse_input_event(event)

func press(point: Vector2) -> void:
  motion(point, false)
  await frames(2)
  button(point, true)
  await frames(4)

func drag_to(point: Vector2) -> void:
  motion(point, true)
  await frames(4)

func release(point: Vector2) -> void:
  button(point, false)
  await frames(6)

func _ready() -> void:
  if not OS.get_cmdline_user_args().has("--validate"):
    return
  capturing = OS.get_cmdline_user_args().has("--capture")
  surface.set_meta("validation_input_device", DEVICE)
  await run()

func run() -> void:
  var mounted := await wait_for(func() -> bool: return control("pan-box") != null and control("pan-track") != null)
  verify(mounted, "The public example mounts its track and its box")
  await frames(10)
  var home := box_rect()
  var start := example()
  stages.before = {"example": start, "box": node_of("pan-box"), "rect": [home.position.x, home.position.y, home.size.x, home.size.y]}
  verify((start.get("phase") == "idle" and start.get("events", []).is_empty() and start.get("gesture") == null
    and float(start.get("x", -1)) == 24.0 and float(start.get("y", -1)) == 24.0 and home.size == Vector2(104, 64)
    and text("pan-phase") == "idle" and text("pan-gesture") == "no gesture yet" and text("pan-position") == "x 24 · y 24"),
    "Before any touch the box rests at its first position, React holds no gesture and the readout says idle")
  var track := control("pan-track").get_global_rect()
  verify(track.encloses(home), "The box starts inside its track")
  var target := home.position + STEP * 4.0
  var landing := Rect2(target, home.size)
  await capture("before", {"home": home, "landing": landing})

  # Press on the box: RN grants the responder, and the box turns amber.
  var grab := home.get_center()
  await press(grab)
  var grabbed := example()
  stages.grabbed = {"example": grabbed, "box": node_of("pan-box")}
  verify((grabbed.get("phase") == "dragging" and grabbed.get("events", []) == ["grant", "start"] and text("pan-phase") == "dragging"
    and box_rect() == home),
    "Pressing the box grants the PanResponder (grant, then start) and the box has not moved")

  # Drag in four steps: the box follows by exactly the gesture's dx and dy.
  var followed := true
  var steps: Array = []
  for step in range(1, 5):
    await drag_to(grab + STEP * float(step))
    var state := example()
    var gesture: Dictionary = state.get("gesture", {})
    steps.append({"step": step, "gesture": gesture, "rect": box_rect().position})
    followed = (followed and float(gesture.get("dx", -1)) == STEP.x * step and float(gesture.get("dy", -1)) == STEP.y * step
      and int(gesture.get("numberActiveTouches", -1)) == 1 and box_rect().position.is_equal_approx(home.position + STEP * float(step))
      and float(state.get("x", -1)) == 24.0 + STEP.x * step and float(state.get("y", -1)) == 24.0 + STEP.y * step)
    if step == 2:
      await capture("dragging", {"home": home, "landing": landing})
  stages.dragged = {"steps": steps, "example": example()}
  verify(followed, "After each of four drag steps the box Control sits at its start plus the gesture's dx and dy, with one active touch")
  var mid: Dictionary = example().get("gesture", {})
  verify((float(mid.get("moveX", 0)) - float(mid.get("x0", 0)) == STEP.x * 4.0 and float(mid.get("moveY", 0)) - float(mid.get("y0", 0)) == STEP.y * 4.0
    and float(mid.get("vx", -1)) >= 0.0 and float(mid.get("vy", -1)) >= 0.0),
    "The gesture state is RN's: dx and dy are moveX and moveY minus the grant point, and the velocity follows the drag")

  # Let go: RN releases, the box turns teal again and stays where it was dropped.
  await release(grab + STEP * 4.0)
  var dropped := example()
  stages.released = {"example": dropped, "box": node_of("pan-box")}
  var events: Array = dropped.get("events", [])
  verify((dropped.get("phase") == "released" and events.slice(0, 2) == ["grant", "start"] and events.count("move") == 4
    and events.slice(events.size() - 2) == ["end", "release"] and box_rect().position.is_equal_approx(target)
    and text("pan-phase") == "released" and text("pan-position") == "x 184 · y 84" and text("pan-gesture") == "dx 160 · dy 60 · touches 0"),
    "Release reports end and then release after four moves, and the box stays where it was dropped")
  verify(pointer_clear(), "Release clears the native contact and the responder")
  await capture("after", {"home": home, "landing": landing})
  if capturing:
    var before: Dictionary = images.before
    var after: Dictionary = images.after
    verify(before.home != after.home and before.landing != after.landing,
      "The renderer drew the box where it was dropped and no longer where it started")

  # A second drag starts from where the box was left: dx and dy count from this grant, not the first.
  var second := box_rect().get_center()
  await press(second)
  await drag_to(second - STEP * 4.0)
  var again: Dictionary = example().get("gesture", {})
  stages.second = {"gesture": again, "rect": box_rect().position, "grab": second}
  verify((float(again.get("dx", 0)) == -STEP.x * 4.0 and float(again.get("dy", 0)) == -STEP.y * 4.0
    and float(again.get("x0", 0)) == second.x - surface.global_position.x and float(again.get("y0", 0)) == second.y - surface.global_position.y
    and box_rect().position.is_equal_approx(home.position)),
    "A second drag starts from the dropped box: its gesture counts from its own grant, in the root's coordinates, and brings the box home")
  await release(second - STEP * 4.0)
  var final_state := example()
  verify((final_state.get("phase") == "released" and final_state.get("events", []).count("grant") == 2
    and final_state.get("events", []).count("release") == 2 and pointer_clear() and native_state().get("errors", []).is_empty()),
    "The second release is reported, no contact is left and the run raised no host error")
  await finish()

func finish() -> void:
  application.call("stop")
  await frames(8)
  var stopped := native_state()
  verify(stopped.get("stopped", false) and stopped.get("rootCount", -1) == 0 and stopped.get("errors", []).is_empty(),
    "Stop releases the root without a host error")
  var report := {"scenario": "pan-responder", "godot": Engine.get_version_info().string, "react": "19.2.3", "reactNative": "0.87.1",
    "engine": "hermes", "renderer": "fabric", "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages,
    "images": images, "applicationStopped": stopped}
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://build"))
  var output := FileAccess.open("res://build/report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_ERROR: Cannot write the pan-responder report")
    get_tree().quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  print("FABRIC_VALIDATION_FAILED: pan-responder" if failed else "FABRIC_VALIDATION_PASSED: pan-responder " + str(checks.size()))
  get_tree().quit(1 if failed else 0)
