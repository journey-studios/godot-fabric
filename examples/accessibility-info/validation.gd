extends Node

# The public AccessibilityInfo example. Each of the four native buttons on the right stands in for the operating system:
# one press cycles a setting through system (the DisplayServer's own reading), off, on and unknown by changing the
# application's validation_accessibility_settings meta, which replaces only the keys it names. A run that starts without
# --validate sets nothing, so it follows the real settings of the machine (macOS reports them; the headless engine and the
# mobile servers report that they do not know). The validation presses the buttons, clicks React's own "Ask again" button
# with real mouse input, and reads each state from the native tree, from the application's AccessibilityInfo counters and
# from what React observed. It waits for the polls the host counts, never for time.
const DEVICE := 1001
const META := "validation_accessibility_settings"
const KEYS := {"ScreenReaderButton": "screen_reader", "MotionButton": "reduce_animation",
  "TransparencyButton": "reduce_transparency", "ContrastButton": "increase_contrast"}
# system, unknown, off, on
const CYCLE := [null, -1, 0, 1]
var checks: Array = []
var stages: Dictionary = {}
var standin := {}
var capturing := false
@onready var application: Node = $Application
@onready var surface: Control = $Surface
@onready var legend: Label = $StandIn

# The first stand-in values must be set before the application's module reads them, which is when the first root renders:
# _enter_tree runs before any child's _ready.
func _enter_tree() -> void:
  if OS.get_cmdline_user_args().has("--validate"):
    # Every key is named, so the run reads the same on a machine whose own settings are on, and on the headless engine.
    standin = {"screen_reader": 0, "reduce_animation": 0, "reduce_transparency": 0, "increase_contrast": -1}
    get_node("Application").set_meta(META, standin.duplicate())

func apply_standin() -> void:
  if standin.is_empty():
    if application.has_meta(META):
      application.remove_meta(META)
  else:
    application.set_meta(META, standin.duplicate())
  var lines: Array = []
  for name: String in KEYS:
    var key: String = KEYS[name]
    lines.append("%s: %s" % [key.replace("_", " "), shown(standin[key]) if standin.has(key) else "system"])
  legend.text = "Stand-in for the platform\n" + "\n".join(lines)

func shown(value: int) -> String:
  return "unknown" if value == -1 else ("on" if value == 1 else "off")

# The stand-in for one setting: null leaves it to the DisplayServer.
func set_standin(key: String, value: Variant) -> void:
  if value == null:
    standin.erase(key)
  else:
    standin[key] = value
  apply_standin()

# One press: the next state of the cycle for this setting.
func cycle(key: String) -> void:
  set_standin(key, CYCLE[(CYCLE.find(standin.get(key, null)) + 1) % CYCLE.size()])

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
  var value: Variant = js("globalThis.AccessibilityInfoExample.state()")
  return value if value is Dictionary else {}

func native_state() -> Dictionary:
  var value: Variant = JSON.parse_string(application.call("snapshot"))
  return value if value is Dictionary else {}

# The application's AccessibilityInfo counters.
func module() -> Dictionary:
  var value: Variant = native_state().get("accessibilityInfo", {})
  return value if value is Dictionary else {}

func polls() -> int:
  return int(module().get("polls", -1))

# The host counts a poll for each frame it delivers once the module exists; the validation waits for that count.
func after_polls(count: int) -> void:
  var target := polls() + count
  await wait_for(func() -> bool: return polls() >= target)
  await frames(6)

func node_of(id: String) -> Dictionary:
  var value: Variant = JSON.parse_string(surface.call("snapshot"))
  var nodes: Variant = value.get("nodes", []) if value is Dictionary else []
  for entry: Dictionary in nodes:
    if entry.get("testID") == id:
      return entry
  return {}

func text(id: String) -> String:
  return str(node_of(id).get("nativeText", ""))

func values() -> Dictionary:
  var result := {}
  for id in ["screen-reader", "reduce-motion", "reduce-transparency", "increase-contrast", "bold-text", "grayscale", "invert-colors", "cross-fade"]:
    result[id] = text("a11y-value-" + id)
  return result

func control(id: String) -> Control:
  return surface.find_child(id, true, false) as Control

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

func click(id: String) -> void:
  var point := control(id).get_global_rect().get_center()
  await mouse("down", point)
  await frames(3)
  await mouse("up", point)
  await frames(6)

func press(button: String) -> void:
  get_node(button).pressed.emit()
  await after_polls(3)

func capture(stage: String) -> void:
  if not capturing:
    return
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  verify(image.save_png("res://build/accessibility-info-%s.png" % stage) == OK, "Renderer capture saved: " + stage)

func _ready() -> void:
  for name: String in KEYS:
    get_node(name).pressed.connect(cycle.bind(KEYS[name]))
  apply_standin()
  if not OS.get_cmdline_user_args().has("--validate"):
    return
  capturing = OS.get_cmdline_user_args().has("--capture")
  surface.set_meta("validation_input_device", DEVICE)
  await run()

func run() -> void:
  var mounted := await wait_for(func() -> bool: return (control("a11y-root") != null and control("a11y-refresh") != null
    and values().values().all(func(value: String) -> bool: return value != "" and value != "…")))
  verify(mounted, "The public example mounts its screen: eight settings, the events row and the button")
  await frames(6)
  var start := example()
  var start_module := module()
  stages.initial = {"example": start, "module": start_module, "values": values()}
  verify(values() == {"screen-reader": "off", "reduce-motion": "off", "reduce-transparency": "off", "increase-contrast": "unknown",
    "bold-text": "unavailable", "grayscale": "unavailable", "invert-colors": "unavailable", "cross-fade": "unavailable"}
    and text("a11y-value-heard") == "none yet" and start.get("heard", []).is_empty(),
    "The first render shows what the platform reports: three settings off, one unknown, four unavailable, no event heard")
  verify(int(start_module.get("modules", {}).get("AccessibilityManager", -1)) == 1 and start_module.get("started") == true
    and int(start_module.get("events", {}).get("screenReaderChanged", -1)) == 0 and start.get("errors", []).is_empty(),
    "The application's AccessibilityManager module exists, took its baseline and has emitted nothing")
  await capture("initial")

  # The screen reader and reduce motion turn on, and increase contrast appears (it was unknown): three events, one each.
  await press("ScreenReaderButton")
  await press("MotionButton")
  await press("ContrastButton")
  var changed := example()
  var changed_module := module()
  stages.changed = {"example": changed, "module": changed_module, "values": values()}
  verify(changed.get("heard", []) == ["screenReaderChanged=true", "reduceMotionChanged=true", "darkerSystemColorsChanged=false"]
    and values()["screen-reader"] == "on" and values()["reduce-motion"] == "on" and values()["reduce-transparency"] == "off"
    and values()["increase-contrast"] == "off" and text("a11y-value-heard") == "3 · darkerSystemColorsChanged=false",
    "Three settings changed, three events were heard once each in order, and the rows show the new values")
  verify(int(changed_module.get("events", {}).get("screenReaderChanged", -1)) == 1 and int(changed_module.get("events", {}).get("reduceMotionChanged", -1)) == 1
    and int(changed_module.get("events", {}).get("darkerSystemColorsChanged", -1)) == 1
    and int(changed_module.get("events", {}).get("reduceTransparencyChanged", -1)) == 0
    and ["boldTextChanged", "grayscaleChanged", "invertColorsChanged", "announcementFinished"].all(
      func(name: String) -> bool: return int(changed_module.get("events", {}).get(name, -1)) == 0),
    "The host counted one event for each change, none for the unchanged setting, and none for the events Godot can never send")
  await capture("changed")

  # "Ask again" is React's own button, pressed with the mouse: the getters are asked again and answer the same.
  await click("a11y-refresh")
  var asked := example()
  verify(int(asked.get("refreshes", -1)) == 1 and values() == stages.changed.values and asked.get("heard", []).size() == 3
    and int(module().get("settings", {}).get("screenReader", {}).get("resolved", -1)) >= 2
    and int(module().get("unbacked", {}).get("boldText", -1)) >= 2,
    "Asking again answers from the last reading: the same values, no new event, and the unavailable settings reject again")

  # Reduce motion becomes unknown (set directly: one more press would hand the setting back to this machine's own reading):
  # no event, and asking again says unknown, never off.
  set_standin("reduce_animation", -1)
  await after_polls(3)
  var quiet := example()
  verify(quiet.get("heard", []).size() == 3 and int(module().get("events", {}).get("reduceMotionChanged", -1)) == 1,
    "A setting that becomes unknown emits nothing")
  await click("a11y-refresh")
  verify(values()["reduce-motion"] == "unknown" and values()["screen-reader"] == "on"
    and int(module().get("settings", {}).get("reduceMotion", {}).get("rejectedUnknown", -1)) >= 1,
    "Asking again about a setting the platform no longer reports says unknown, not off")
  verify(native_state().get("errors", []).is_empty() and example().get("errors", []).is_empty(), "The run raised no host error and no unexpected rejection")
  await finish()

func finish() -> void:
  application.call("stop")
  await frames(8)
  var stopped := native_state()
  verify(stopped.get("stopped", false) and stopped.get("rootCount", -1) == 0 and stopped.get("errors", []).is_empty()
    and stopped.get("accessibilityInfo", {}).get("stopped") == true,
    "Stop releases the root and the AccessibilityManager module without a host error")
  var report := {"scenario": "accessibility-info", "godot": Engine.get_version_info().string, "react": "19.2.3", "reactNative": "0.87.1",
    "engine": "hermes", "renderer": "fabric", "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages,
    "applicationStopped": stopped}
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://build"))
  var output := FileAccess.open("res://build/report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_ERROR: Cannot write the accessibility info report")
    get_tree().quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  print("FABRIC_VALIDATION_FAILED: accessibility-info" if failed else "FABRIC_VALIDATION_PASSED: accessibility-info " + str(checks.size()))
  get_tree().quit(1 if failed else 0)
