extends Node

# The public Animated example under real mouse input. The box moves with RN's
# native driver, so each state is read from the actual Godot Control the
# backend updated, and with --capture the renderer's frame is saved too.
const DEVICE := 1001
const TRAVEL := 220.0
var checks: Array = []
var stages: Dictionary = {}
var images: Dictionary = {}
var capturing := false
var track: Control
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
  var value: Variant = js("globalThis.AnimatedExample.state()")
  return value if value is Dictionary else {}

func native_state() -> Dictionary:
  var value: Variant = JSON.parse_string(application.call("snapshot"))
  return value if value is Dictionary else {}

func animated() -> Dictionary:
  var value: Variant = native_state().get("nativeAnimated", {})
  return value if value is Dictionary else {}

func control(id: String) -> Control:
  return surface.find_child(id, true, false) as Control

# The angle the Control draws at: a rotation is split between the Control's own
# transform and its offset transform, whose sum is RN's angle.
func angle(node: Control) -> float:
  var offset: float = float(node.get("offset_transform_rotation")) if node.get("offset_transform_enabled") == true else 0.0
  return node.rotation + offset

func snap(stage: String) -> Dictionary:
  var box := control("animated-box")
  var value := {"opacity": box.modulate.a, "x": box.position.x, "rotation": angle(box)}
  stages[stage] = {"box": value, "animated": animated(), "example": example()}
  return value

# Fabric hoists the box next to its parent View under the surface root, so the
# box's Control parent is the whole root. The track is the smallest other Control
# that holds the box at rest.
func track_of(box: Control) -> Control:
  var found: Control = null
  for candidate in surface.find_children("*", "Control", true, false):
    var node := candidate as Control
    if node != box and node.get_global_rect().encloses(box.get_global_rect()):
      if found == null or node.size.x * node.size.y < found.size.x * found.size.y:
        found = node
  return found

# The box's bounds as drawn, including its rotation.
func bounds(node: Control) -> Rect2:
  return node.get_global_transform() * Rect2(Vector2.ZERO, node.size)

# The readback rectangle of a Control, in the physical pixels of the saved frame.
func region(node: Control) -> Rect2i:
  var physical := get_window().get_final_transform() * node.get_global_rect()
  return Rect2i(Vector2i(physical.position.round()), Vector2i(physical.size.round()))

func digest(image: Image, area: Rect2i) -> String:
  var context := HashingContext.new()
  context.start(HashingContext.HASH_SHA256)
  context.update(image.get_region(area).get_data())
  return context.finish().hex_encode()

# The whole frame also changes for unrelated reasons (a dimmed button, the status
# text), so each stage is hashed per region: the track the box moves in and the
# Run button. The full frame is still saved as the capture.
func capture(stage: String) -> void:
  if not capturing:
    return
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  verify(image.save_png("res://build/animated-%s.png" % stage) == OK, "Renderer capture saved: " + stage)
  var track_area := region(track)
  var run_area := region(control("animated-run"))
  var frame := Rect2i(Vector2i.ZERO, image.get_size())
  var inside := track_area.has_area() and run_area.has_area() and frame.encloses(track_area) and frame.encloses(run_area)
  verify(inside, "The track and the Run button lie inside the captured frame: " + stage)
  images[stage] = {"track": digest(image, track_area) if inside else "", "run": digest(image, run_area) if inside else ""}

func at(id: String) -> Vector2:
  return control(id).get_global_rect().get_center()

func mouse(phase: String, point: Vector2) -> void:
  if phase == "down":
    var motion := InputEventMouseMotion.new()
    motion.device = DEVICE
    motion.position = point
    Input.parse_input_event(motion)
  var button := InputEventMouseButton.new()
  button.device = DEVICE
  button.position = point
  button.button_index = MOUSE_BUTTON_LEFT
  button.pressed = phase == "down"
  button.button_mask = MOUSE_BUTTON_MASK_LEFT if phase == "down" else 0
  Input.parse_input_event(button)
  await frames(2)

func _ready() -> void:
  if not OS.get_cmdline_user_args().has("--validate"):
    return
  capturing = OS.get_cmdline_user_args().has("--capture")
  surface.set_meta("validation_input_device", DEVICE)
  await run()

func run() -> void:
  var mounted := await wait_for(func() -> bool: return (control("animated-box") != null and control("animated-run") != null
    and control("animated-back") != null))
  verify(mounted, "The public example mounts its Animated.View box and two TouchableOpacity buttons")
  await frames(10)
  var box := control("animated-box")
  track = track_of(box)
  verify(track != null, "The box rests inside a track Control, the smallest Control that holds it")
  var rest := snap("before")
  var state := animated()
  verify((is_equal_approx(rest.opacity, 1.0) and is_equal_approx(angle(box), 0.0) and state.get("enabled") == true
    and int(state.get("frames", -1)) == 0 and state.get("active") == false),
    "Before the animation the box rests at opacity 1, no rotation, and RN's backend is attached and idle")
  await capture("before")

  # A real press on Run: TouchableOpacity dims through RN's native driver, then
  # release starts the box's own native animation.
  var run_button := control("animated-run")
  await mouse("down", at("animated-run"))
  # The native driver's frames come at the frame clock's ticks, so wait for what it does.
  await wait_for(func() -> bool: return is_equal_approx(run_button.modulate.a, 0.4))
  var pressed := snap("pressed")
  verify(is_equal_approx(run_button.modulate.a, 0.4) and is_equal_approx(box.modulate.a, 1.0) and int(animated().get("directUpdates", 0)) > 0,
    "A mouse press dims the TouchableOpacity to its activeOpacity through the native driver")
  await capture("pressed")
  await mouse("up", at("animated-run"))
  var started := await wait_for(func() -> bool: return box.modulate.a < 0.7)
  var mid := snap("mid-animation")
  verify((started and mid.opacity > 0.35 and mid.opacity < 0.7 and mid.x > rest.x + 20.0 and mid.x < rest.x + TRAVEL
    and angle(box) > 0.0 and angle(box) < PI / 2.0 and animated().get("active") == true),
    "Mid-animation the Control is between the two ends of its opacity, translation and rotation")
  await capture("mid-animation")
  var finished := await wait_for(func() -> bool: return example().get("ends", []).size() == 1)
  await frames(8)
  var end := snap("end")
  var ended: Dictionary = example().get("ends", [{}])[0]
  verify((finished and ended.get("toValue") == 1.0 and ended.get("finished") == true and example().get("label") == "finished: true"),
    "RN reports the end once, finished: true, and the status text re-renders")
  verify((is_equal_approx(end.opacity, 0.35) and absf(end.x - (rest.x + TRAVEL)) < 0.001 and absf(angle(box) - PI / 2.0) < 1e-4
    and animated().get("active") == false and int(animated().get("staleDirectUpdates", -1)) == 0),
    "The box rests at the final opacity, translation and a quarter turn, and the backend idles")
  verify(example().get("renders") == 3,
    "React rendered three times, not once per frame: the animation never committed")
  verify(track != null and track.get_global_rect().encloses(bounds(box)),
    "The box ends inside the same track, so its pixels hold every stage of the travel")
  await capture("end")

  # Back: a full click returns the box over RN's own timing.
  await mouse("down", at("animated-back"))
  await frames(4)
  await mouse("up", at("animated-back"))
  var returned := await wait_for(func() -> bool: return example().get("ends", []).size() == 2)
  await frames(8)
  var back := snap("back")
  verify((returned and is_equal_approx(back.opacity, 1.0) and absf(back.x - rest.x) < 0.001 and is_equal_approx(angle(box), 0.0)
    and example().get("label") == "finished: true" and is_equal_approx(control("animated-back").modulate.a, 1.0)),
    "Back returns the box to rest and the pressed button to full opacity")
  verify(native_state().get("errors", []).is_empty() and not images.has("end") == not capturing,
    "The run raised no host error")
  if capturing:
    var rest_pixels: Dictionary = images.before
    var mid_pixels: Dictionary = images["mid-animation"]
    var end_pixels: Dictionary = images.end
    verify((rest_pixels.track != mid_pixels.track and mid_pixels.track != end_pixels.track and rest_pixels.track != end_pixels.track),
      "The track's pixels differ between rest, mid-animation and the end: the renderer drew the moving box")
    verify((not rest_pixels.track.is_empty() and images.pressed.track == rest_pixels.track and images.pressed.run != rest_pixels.run),
      "A press changes the Run button's pixels and leaves the track's as they were")
  await finish()

func finish() -> void:
  application.call("stop")
  await frames(8)
  var stopped := native_state()
  verify(stopped.get("stopped", false) and stopped.get("rootCount", -1) == 0 and stopped.get("errors", []).is_empty()
    and animated().get("active") == false, "Stop releases the root and the backend without a host error")
  var report := {"scenario": "animated", "godot": Engine.get_version_info().string, "react": "19.2.3", "reactNative": "0.87.1",
    "engine": "hermes", "renderer": "fabric", "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages,
    "images": images, "applicationStopped": stopped}
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://build"))
  var output := FileAccess.open("res://build/report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_ERROR: Cannot write the animated report")
    get_tree().quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  print("FABRIC_VALIDATION_FAILED: animated" if failed else "FABRIC_VALIDATION_PASSED: animated " + str(checks.size()))
  get_tree().quit(1 if failed else 0)
