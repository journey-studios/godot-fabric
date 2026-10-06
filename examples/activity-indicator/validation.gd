extends Node

# The public ActivityIndicator example under real mouse input. Each spinner is
# read from the native Godot control (its frame, color, phase and whether it is
# drawn) across actual SceneTree frames, and with --capture the renderer's frame
# is saved too.
const DEVICE := 1001
const FRAMES := 10
const IDS := ["spinner-small", "spinner-large", "spinner-sized", "spinner-violet", "spinner-hides", "spinner-keeps"]
const SIDES := {"spinner-small": 20.0, "spinner-large": 36.0, "spinner-sized": 48.0, "spinner-violet": 28.0, "spinner-hides": 36.0, "spinner-keeps": 36.0}
const COLORS := {"spinner-small": "999999ff", "spinner-large": "38bdf8ff", "spinner-sized": "f97316ff", "spinner-violet": "a78bfaff",
  "spinner-hides": "5eead4ff", "spinner-keeps": "facc15ff"}
const STEADY := ["spinner-small", "spinner-large", "spinner-sized", "spinner-violet"]
const CONTROLLED := ["spinner-hides", "spinner-keeps"]
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
  var value: Variant = js("globalThis.ActivityIndicatorExample.state()")
  return value if value is Dictionary else {}

func native_state() -> Dictionary:
  var value: Variant = JSON.parse_string(application.call("snapshot"))
  return value if value is Dictionary else {}

func nodes() -> Array:
  var value: Variant = JSON.parse_string(surface.call("snapshot"))
  var all: Variant = value.get("nodes", []) if value is Dictionary else []
  return all if all is Array else []

func node_of(id: String) -> Dictionary:
  for entry: Dictionary in nodes():
    if entry.get("testID") == id:
      return entry
  return {}

# One native snapshot of every spinner, keyed by testID.
func spinners() -> Dictionary:
  var found := {}
  for entry: Dictionary in nodes():
    if entry.get("kind") == "activity":
      found[entry.get("testID")] = entry
  return found

func control(id: String) -> Control:
  return surface.find_child(id, true, false) as Control

func at(id: String) -> Vector2:
  return control(id).get_global_rect().get_center()

# The readback rectangle of a Control, in the physical pixels of the saved frame.
func region(node: Control) -> Rect2i:
  var physical := get_window().get_final_transform() * node.get_global_rect()
  return Rect2i(Vector2i(physical.position.round()), Vector2i(physical.size.round()))

func digest(image: Image, area: Rect2i) -> String:
  var context := HashingContext.new()
  context.start(HashingContext.HASH_SHA256)
  context.update(image.get_region(area).get_data())
  return context.finish().hex_encode()

# The spinners turn between captures, so each stage hashes every spinner's own
# pixels; a hidden spinner must differ from the one that was drawn.
func capture(stage: String) -> void:
  if not capturing:
    return
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  verify(image.save_png("res://build/activity-indicator-%s.png" % stage) == OK, "Renderer capture saved: " + stage)
  var frame := Rect2i(Vector2i.ZERO, image.get_size())
  var pixels := {}
  var inside := true
  for id: String in IDS:
    var area := region(control(id))
    inside = inside and area.has_area() and frame.encloses(area)
    pixels[id] = digest(image, area) if area.has_area() and frame.encloses(area) else ""
  verify(inside, "Every spinner lies inside the captured frame: " + stage)
  images[stage] = pixels

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

# A full click. Pressability keeps a press visible for at least 130 ms, so the pressed style
# is released a little after the mouse is: wait for the Control to settle at full opacity.
func click(id: String) -> void:
  var point := at(id)
  await mouse("down", point)
  await frames(3)
  await mouse("up", point)
  await wait_for(func() -> bool: return is_equal_approx(control(id).modulate.a, 1.0))
  await frames(2)

# Native spinner state around FRAMES actual frames: [before, after].
func across() -> Array:
  var before := spinners()
  await frames(FRAMES)
  return [before, spinners()]

func advanced(pair: Array, id: String) -> bool:
  var before: Dictionary = pair[0][id].activity
  var after: Dictionary = pair[1][id].activity
  return (int(after.frames) - int(before.frames) == FRAMES and float(after.turns) > float(before.turns)
    and after.drawn.visible == true and after.processing == true)

func frozen(pair: Array, id: String) -> bool:
  var before: Dictionary = pair[0][id].activity
  var after: Dictionary = pair[1][id].activity
  return (int(after.frames) == int(before.frames) and float(after.turns) == float(before.turns) and after.processing == false)

func _ready() -> void:
  if not OS.get_cmdline_user_args().has("--validate"):
    return
  capturing = OS.get_cmdline_user_args().has("--capture")
  surface.set_meta("validation_input_device", DEVICE)
  await run()

func run() -> void:
  var mounted := await wait_for(func() -> bool: return IDS.all(func(id: String) -> bool: return control(id) != null) and control("spinner-toggle") != null)
  verify(mounted, "The public example mounts its six ActivityIndicators and the toggle button")
  await frames(10)
  var found := spinners()
  verify(found.size() == IDS.size() and IDS.all(func(id: String) -> bool: return found.has(id)),
    "Each ActivityIndicator is a native spinner Control")
  var sizes_ok := IDS.all(func(id: String) -> bool:
    var entry: Dictionary = found[id]
    return (float(entry.fabricWidth) == SIDES[id] and float(entry.fabricHeight) == SIDES[id] and float(entry.width) == SIDES[id]
      and float(entry.height) == SIDES[id] and float(entry.activity.drawn.radius) == SIDES[id] / 2.0))
  verify(sizes_ok, "The frames are RN's: small 20, large 36 and the numeric sizes 48 and 28, each spinner filling its frame")
  verify((found["spinner-small"].activity.size == "small" and found["spinner-large"].activity.size == "large"
    and found["spinner-sized"].activity.size == "small" and found["spinner-hides"].activity.size == "large"),
    "size selects the native style; a numeric size only sizes the frame")
  var colors_ok := IDS.all(func(id: String) -> bool:
    var entry: Dictionary = found[id]
    return entry.activity.drawColor == COLORS[id] and entry.activity.drawn.color == COLORS[id])
  verify(colors_ok and found["spinner-small"].activity.color == null and found["spinner-large"].activity.color == "38bdf8ff",
    "Without a color the spinner draws RN's iOS gray; each color prop reaches its native spinner")
  var initial_state := example()
  verify((initial_state.get("animating") == true and node_of("spinner-status").get("nativeText") == "animating: true"
    and IDS.all(func(id: String) -> bool: return found[id].activity.animating == true and found[id].activity.hidesWhenStopped == (id != "spinner-keeps"))),
    "Every spinner starts animating, and only the last one opts out of hidesWhenStopped")
  var running := await across()
  stages.running = {"before": running[0], "after": running[1], "example": initial_state}
  verify(IDS.all(func(id: String) -> bool: return advanced(running, id)),
    "While animating, every phase advances once per actual frame and every spinner is drawn")
  await capture("running")

  # A real click stops the last two: the controlled spinner hides, the other keeps its frozen frame.
  await click("spinner-toggle")
  var stop_state := example()
  var stopped := spinners()
  verify((stop_state.get("animating") == false and stop_state.get("toggles") == 1 and node_of("spinner-status").get("nativeText") == "animating: false"
    and is_equal_approx(control("spinner-toggle").modulate.a, 1.0)),
    "A click on the button calls onPress once, React re-renders the status and the pressed style is released")
  var hides: Dictionary = stopped["spinner-hides"].activity
  var keeps: Dictionary = stopped["spinner-keeps"].activity
  verify((hides.animating == false and hides.spinnerVisible == false and hides.drawn.visible == false and int(hides.stops) == 1
    and keeps.animating == false and keeps.spinnerVisible == true and keeps.drawn.visible == true and int(keeps.stops) == 1),
    "animating={false} hides the default spinner and leaves the hidesWhenStopped={false} one drawn")
  var still := await across()
  stages.stopped = {"before": still[0], "after": still[1], "example": stop_state}
  verify(CONTROLLED.all(func(id: String) -> bool: return frozen(still, id)),
    "Stopped spinners do no per-frame work: their frame count and phase stay put")
  verify(STEADY.all(func(id: String) -> bool: return advanced(still, id)),
    "The four spinners that were not stopped keep advancing once per frame")
  await capture("stopped")

  # The next click restarts both from where they stopped.
  await click("spinner-toggle")
  var restart_state := example()
  var resumed := await across()
  stages.restarted = {"before": resumed[0], "after": resumed[1], "example": restart_state}
  verify((restart_state.get("animating") == true and restart_state.get("toggles") == 2
    and CONTROLLED.all(func(id: String) -> bool: return advanced(resumed, id) and int(resumed[1][id].activity.starts) == 2)),
    "A second click restarts the two spinners, the hidden one is drawn again and each counts two starts")
  verify(restart_state.get("renders") == 3 and native_state().get("errors", []).is_empty(),
    "React rendered three times, once per state change, and the run raised no host error")
  if capturing:
    var live: Dictionary = images.running
    var held: Dictionary = images.stopped
    verify(live["spinner-hides"] != held["spinner-hides"],
      "The renderer drew the stopped spinner differently: the hidden one left no pixels of a spinner")
  await finish()

func finish() -> void:
  application.call("stop")
  await frames(8)
  var finished := native_state()
  verify(finished.get("stopped", false) and finished.get("rootCount", -1) == 0 and finished.get("errors", []).is_empty(),
    "Stop releases the root and every spinner without a host error")
  var report := {"scenario": "activity-indicator", "godot": Engine.get_version_info().string, "react": "19.2.3", "reactNative": "0.87.1",
    "engine": "hermes", "renderer": "fabric", "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages,
    "images": images, "applicationStopped": finished}
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://build"))
  var output := FileAccess.open("res://build/report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_ERROR: Cannot write the activity-indicator report")
    get_tree().quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  print("FABRIC_VALIDATION_FAILED: activity-indicator" if failed else "FABRIC_VALIDATION_PASSED: activity-indicator " + str(checks.size()))
  get_tree().quit(1 if failed else 0)
