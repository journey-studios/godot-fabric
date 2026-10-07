extends Node

# The public Switch example under real mouse input. Each state is read from the
# native Switch the host drew (its value, colors and thumb) and from what React
# observed, and with --capture the renderer's frame is saved too.
const DEVICE := 1001
const IDS := ["switch-sound", "switch-vibration", "switch-beta", "switch-managed"]
const OFF_TRACK := "e9e9eaff"
const ON_TRACK := "34c759ff"
const WHITE := "ffffffff"
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
  var value: Variant = js("globalThis.SwitchExample.state()")
  return value if value is Dictionary else {}

func native_state() -> Dictionary:
  var value: Variant = JSON.parse_string(application.call("snapshot"))
  return value if value is Dictionary else {}

func surface_state() -> Dictionary:
  var value: Variant = JSON.parse_string(surface.call("snapshot"))
  return value if value is Dictionary else {}

func node_of(id: String) -> Dictionary:
  var nodes: Variant = surface_state().get("nodes", [])
  for entry: Dictionary in nodes:
    if entry.get("testID") == id:
      return entry
  return {}

func switch_of(id: String) -> Dictionary:
  var value: Variant = node_of(id).get("switch", {})
  return value if value is Dictionary else {}

func control(id: String) -> Control:
  return surface.find_child(id, true, false) as Control

func at(id: String) -> Vector2:
  return control(id).get_global_rect().get_center()

# A color's alpha as the hex string carries it: 0x80 is 128 of 255, a hair over half.
func alpha(hex: String) -> float:
  return Color.html("#" + hex).a

func half(hex: String) -> bool:
  return absf(alpha(hex) - 0.5) < 0.01

# The readback rectangle of a Control, in the physical pixels of the saved frame.
func region(node: Control) -> Rect2i:
  var physical := get_window().get_final_transform() * node.get_global_rect()
  return Rect2i(Vector2i(physical.position.round()), Vector2i(physical.size.round()))

func digest(image: Image, area: Rect2i) -> String:
  var context := HashingContext.new()
  context.start(HashingContext.HASH_SHA256)
  context.update(image.get_region(area).get_data())
  return context.finish().hex_encode()

# The whole frame also changes for unrelated reasons (the status text), so each
# stage hashes the pixels of every switch on its own. The full frame is still
# saved as the capture.
func capture(stage: String) -> void:
  if not capturing:
    return
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  verify(image.save_png("res://build/switch-%s.png" % stage) == OK, "Renderer capture saved: " + stage)
  var frame := Rect2i(Vector2i.ZERO, image.get_size())
  var pixels := {}
  var inside := true
  for id: String in IDS:
    var area := region(control(id))
    inside = inside and area.has_area() and frame.encloses(area)
    pixels[id] = digest(image, area) if area.has_area() and frame.encloses(area) else ""
  verify(inside, "All four switches lie inside the captured frame: " + stage)
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

# A full click: the press is held for a few frames, as a hand holds it.
func click(id: String) -> void:
  var point := at(id)
  await mouse("down", point)
  await frames(3)
  await mouse("up", point)
  await frames(6)

func _ready() -> void:
  if not OS.get_cmdline_user_args().has("--validate"):
    return
  capturing = OS.get_cmdline_user_args().has("--capture")
  surface.set_meta("validation_input_device", DEVICE)
  await run()

func run() -> void:
  var mounted := await wait_for(func() -> bool: return IDS.all(func(id: String) -> bool: return control(id) != null))
  verify(mounted, "The public example mounts its four Switch elements as native Godot Controls")
  await frames(10)
  var kinds := IDS.all(func(id: String) -> bool: return node_of(id).get("kind") == "switch")
  verify(kinds, "Each Switch is a native switch Control, not a View")
  var sound := switch_of("switch-sound")
  var vibration := switch_of("switch-vibration")
  var beta := switch_of("switch-beta")
  var managed := switch_of("switch-managed")
  stages.initial = {"sound": sound, "vibration": vibration, "beta": beta, "managed": managed, "example": example()}
  verify((sound.get("value") == false and vibration.get("value") == true and beta.get("value") == false and managed.get("value") == true),
    "The values start as declared: Sound off, Vibration on, Beta channel off and Managed on")
  verify((sound.get("disabled") == false and vibration.get("disabled") == false and beta.get("disabled") == true and managed.get("disabled") == true),
    "Only the Beta channel and Managed switches are disabled")
  var frames_match := IDS.all(func(id: String) -> bool:
    var entry := node_of(id)
    return (float(entry.get("fabricWidth", 0)) == 63.0 and float(entry.get("fabricHeight", 0)) == 28.0
      and float(entry.get("width", 0)) == 63.0 and float(entry.get("height", 0)) == 28.0))
  verify(frames_match, "Every switch has RN's 63 by 28 frame, in Yoga and on its Control")
  var drawn_sound: Dictionary = sound.get("drawn", {})
  var drawn_vibration: Dictionary = vibration.get("drawn", {})
  verify((drawn_sound.get("track") == OFF_TRACK and drawn_sound.get("thumb") == WHITE
    and drawn_vibration.get("track") == "16a34aff" and drawn_vibration.get("thumb") == "f8fafcff"),
    "Sound draws the default off track and Vibration draws its trackColor.true and thumbColor")
  var drawn_beta: Dictionary = beta.get("drawn", {})
  var drawn_managed: Dictionary = managed.get("drawn", {})
  verify((half(str(drawn_beta.get("track"))) and half(str(drawn_beta.get("thumb"))) and half(str(drawn_managed.get("track")))
    and half(str(drawn_managed.get("thumb"))) and is_equal_approx(alpha(str(drawn_sound.get("track"))), 1.0)
    and is_equal_approx(alpha(str(drawn_vibration.get("track"))), 1.0)),
    "A disabled switch is drawn at half opacity and an enabled one is not")
  verify((float(drawn_sound.get("thumbX", 0)) < 63.0 / 2.0 and float(drawn_vibration.get("thumbX", 0)) > 63.0 / 2.0),
    "The thumb sits at the leading end when off and at the trailing end when on")
  var state := example()
  verify((state.get("sound") == false and state.get("vibration") == true and state.get("changes", []).is_empty()
    and state.get("status") == "Nothing switched yet" and node_of("switch-status").get("nativeText") == "Nothing switched yet"),
    "React holds the declared values and has heard no change yet")
  await capture("initial")

  # A real click on Sound: RN receives the touch and one change, onValueChange
  # runs, React re-renders the status and the controlled value follows.
  await click("switch-sound")
  var sound_on := switch_of("switch-sound")
  var after := example()
  stages.sound = {"switch": sound_on, "example": after}
  verify((sound_on.get("value") == true and int(sound_on.get("toggles", 0)) == 1
    and sound_on.get("transitions", []).back().get("cause") == "input" and int(sound_on.get("commands", -1)) == 0),
    "A click toggles the native Sound switch once and the controlled value needs no setValue command")
  verify((after.get("sound") == true and after.get("changes", []) == [{"id": "Sound", "value": true}] and after.get("status") == "Sound is on"
    and node_of("switch-status").get("nativeText") == "Sound is on"),
    "onValueChange runs once with true and React re-renders the status, which the native text shows")
  var drawn_on: Dictionary = sound_on.get("drawn", {})
  verify((drawn_on.get("track") == ON_TRACK and float(drawn_on.get("thumbX", 0)) == 63.0 - 14.0 and sound_on.get("pressing") == "none"),
    "The switch is drawn on: the default on track and the thumb at the trailing end")
  verify((switch_of("switch-vibration").get("value") == true and int(switch_of("switch-vibration").get("toggles", -1)) == 0),
    "The other switches are untouched")

  # Disabled switches take the press but never toggle and never call back.
  var beta_before := switch_of("switch-beta")
  var managed_before := switch_of("switch-managed")
  await click("switch-beta")
  await click("switch-managed")
  var beta_after := switch_of("switch-beta")
  var managed_after := switch_of("switch-managed")
  verify((beta_after.get("value") == false and managed_after.get("value") == true and int(beta_after.get("toggles", -1)) == 0
    and int(managed_after.get("toggles", -1)) == 0 and beta_after.get("transitions") == beta_before.get("transitions")
    and managed_after.get("transitions") == managed_before.get("transitions") and beta_after.get("pressing") == "none"
    and managed_after.get("pressing") == "none"),
    "Clicks on the disabled switches neither press nor toggle them")
  verify(example().get("changes", []).size() == 1 and example().get("status") == "Sound is on",
    "No onValueChange runs for a disabled switch")

  # Vibration turns off with its own colors.
  await click("switch-vibration")
  var vibration_off := switch_of("switch-vibration")
  var drawn_off: Dictionary = vibration_off.get("drawn", {})
  var final_state := example()
  stages.vibration = {"switch": vibration_off, "example": final_state}
  verify((vibration_off.get("value") == false and int(vibration_off.get("toggles", 0)) == 1 and drawn_off.get("track") == "475569ff"
    and drawn_off.get("thumb") == "f8fafcff" and float(drawn_off.get("thumbX", 99)) == 14.0),
    "Vibration turns off and draws its trackColor.false with the thumb at the leading end")
  verify((final_state.get("vibration") == false and final_state.get("sound") == true and final_state.get("status") == "Vibration is off"
    and node_of("switch-status").get("nativeText") == "Vibration is off"
    and final_state.get("changes", []) == [{"id": "Sound", "value": true}, {"id": "Vibration", "value": false}]),
    "React heard exactly the two changes, in order, and holds both values")
  verify(final_state.get("renders") == 3,
    "React rendered three times, once for the mount and once per change, not once per frame")
  verify(native_state().get("errors", []).is_empty(), "The run raised no host error")
  await capture("toggled")
  if capturing:
    var first: Dictionary = images.initial
    var second: Dictionary = images.toggled
    verify((first["switch-sound"] != second["switch-sound"] and first["switch-vibration"] != second["switch-vibration"]
      and first["switch-beta"] == second["switch-beta"] and first["switch-managed"] == second["switch-managed"]),
      "The renderer drew the two switches that toggled differently and the two disabled ones identically")
  await finish()

func finish() -> void:
  application.call("stop")
  await frames(8)
  var stopped := native_state()
  verify(stopped.get("stopped", false) and stopped.get("rootCount", -1) == 0 and stopped.get("errors", []).is_empty(),
    "Stop releases the root without a host error")
  var report := {"scenario": "switch", "godot": Engine.get_version_info().string, "react": "19.2.3", "reactNative": "0.87.1",
    "engine": "hermes", "renderer": "fabric", "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages,
    "images": images, "applicationStopped": stopped}
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://build"))
  var output := FileAccess.open("res://build/report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_ERROR: Cannot write the switch report")
    get_tree().quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  print("FABRIC_VALIDATION_FAILED: switch" if failed else "FABRIC_VALIDATION_PASSED: switch " + str(checks.size()))
  get_tree().quit(1 if failed else 0)
