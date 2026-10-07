extends Node

# The public Appearance example under real mouse input. The system theme is
# supplied the way Godot's DisplayServer delivers it: the application's
# validation meta holds the scheme the operating system would report, and the
# one Callable registered with DisplayServer is called when it changes. Each
# state is read from the native tree (the colors the host applied), from the
# application's Appearance module and from what React observed, and with
# --capture the renderer's frame is saved and its page color sampled.
const DEVICE := 1001
const SYSTEM_META := "validation_system_color_scheme"
const SEAM := "validation_system_theme_callback"
const LIGHT := "e2e8f0ff"
const DARK := "0f172aff"
const BUTTONS := ["appearance-light", "appearance-dark", "appearance-system"]
var checks: Array = []
var stages: Dictionary = {}
var pages: Dictionary = {}
var capturing := false
@onready var application: Node = $Application
@onready var surface: Control = $Surface

# The first system scheme must be set before the application reads it, which is when the first
# root renders: _enter_tree runs before any child's _ready. Without it an interactive run follows
# the real operating system.
func _enter_tree() -> void:
  if OS.get_cmdline_user_args().has("--validate"):
    get_node("Application").set_meta(SYSTEM_META, "light")

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
  var value: Variant = js("globalThis.AppearanceExample.state()")
  return value if value is Dictionary else {}

func native_state() -> Dictionary:
  var value: Variant = JSON.parse_string(application.call("snapshot"))
  return value if value is Dictionary else {}

# The application's Appearance module: its scheme, override, system reading and counters.
func module() -> Dictionary:
  var value: Variant = native_state().get("systemAppearance", {})
  return value if value is Dictionary else {}

func node_of(id: String) -> Dictionary:
  var value: Variant = JSON.parse_string(surface.call("snapshot"))
  var nodes: Variant = value.get("nodes", []) if value is Dictionary else []
  for entry: Dictionary in nodes:
    if entry.get("testID") == id:
      return entry
  return {}

func page() -> String:
  var appearance: Variant = node_of("appearance-root").get("appearance")
  return str(appearance.get("background")) if appearance is Dictionary else ""

func text(id: String) -> String:
  return str(node_of(id).get("nativeText", ""))

func control(id: String) -> Control:
  return surface.find_child(id, true, false) as Control

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

func click(id: String) -> void:
  var point := at(id)
  await mouse("down", point)
  await frames(3)
  await mouse("up", point)
  await frames(6)

# The system theme changes for every application, then the Callable DisplayServer holds runs
# without arguments, and whoever it reaches reads the system again.
func system_theme(scheme: String) -> void:
  application.set_meta(SYSTEM_META, scheme)
  var callback: Callable = application.call(SEAM)
  verify(callback.is_valid(), "The Appearance module registered the system theme Callable DisplayServer would call: " + scheme)
  callback.call()
  await frames(6)

# The readback rectangle of a Control, in the physical pixels of the saved frame.
func region(node: Control) -> Rect2i:
  var physical := get_window().get_final_transform() * node.get_global_rect()
  return Rect2i(Vector2i(physical.position.round()), Vector2i(physical.size.round()))

func close(a: Color, b: Color) -> bool:
  return absf(a.r - b.r) < 6.0 / 255.0 and absf(a.g - b.g) < 6.0 / 255.0 and absf(a.b - b.b) < 6.0 / 255.0

# The page color is sampled in the renderer's frame, a few pixels inside the root's own rectangle,
# where only the page paints.
func capture(stage: String, expected: String) -> void:
  if not capturing:
    return
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  verify(image.save_png("res://build/appearance-%s.png" % stage) == OK, "Renderer capture saved: " + stage)
  var area := region(control("appearance-root"))
  var frame := Rect2i(Vector2i.ZERO, image.get_size())
  var inside := area.has_area() and frame.encloses(area)
  var sampled := image.get_pixelv(area.position + Vector2i(4, 4)) if inside else Color()
  pages[stage] = sampled.to_html(false)
  verify(inside and close(sampled, Color.html("#" + expected)), "The renderer painted the page in the scheme's color: " + stage)

func _ready() -> void:
  if not OS.get_cmdline_user_args().has("--validate"):
    return
  capturing = OS.get_cmdline_user_args().has("--capture")
  surface.set_meta("validation_input_device", DEVICE)
  await run()

func run() -> void:
  var mounted := await wait_for(func() -> bool: return (control("appearance-root") != null and control("appearance-scheme") != null
    and BUTTONS.all(func(id: String) -> bool: return control(id) != null)))
  verify(mounted, "The public example mounts its screen, three rows and three buttons")
  await frames(10)
  var start := example()
  var start_module := module()
  stages.initial = {"example": start, "module": start_module, "page": page()}
  verify((start.get("scheme") == "light" and start.get("read") == "light" and start.get("choice") == "system" and start.get("heard", []).is_empty()
    and page() == LIGHT and text("appearance-scheme") == "light" and text("appearance-choice") == "the system"
    and text("appearance-heard") == "none yet"),
    "The first render follows the system: useColorScheme and getColorScheme read light, the page is light and no change has been heard")
  verify((start_module.get("scheme") == "light" and start_module.get("override") == "unspecified" and start_module.get("system", {}).get("supported") == true
    and start_module.get("system", {}).get("dark") == false and start_module.get("callbackRegistered") == true and int(start_module.get("observers", 0)) == 1
    and int(start_module.get("events", -1)) == 0),
    "The native module reads the system as light, holds no override and has emitted nothing")

  # setColorScheme('light') while the system is light changes nothing effective, so RN sends nothing.
  await click("appearance-light")
  var forced_light := example()
  stages.light = {"example": forced_light, "module": module(), "page": page()}
  verify((forced_light.get("scheme") == "light" and forced_light.get("heard", []).is_empty() and forced_light.get("choice") == "light"
    and module().get("override") == "light" and int(module().get("overrides", -1)) == 1 and int(module().get("events", -1)) == 0
    and page() == LIGHT and text("appearance-choice") == "setColorScheme(\"light\")"),
    "setColorScheme(\"light\") is an override that changes nothing effective: no change event, the page stays light")
  await capture("light", LIGHT)

  # setColorScheme('dark') overrides the light system: one change event, and the screen re-renders dark.
  await click("appearance-dark")
  var forced_dark := example()
  stages.dark = {"example": forced_dark, "module": module(), "page": page()}
  verify((forced_dark.get("scheme") == "dark" and forced_dark.get("read") == "dark" and forced_dark.get("heard", []) == ["dark"]
    and module().get("scheme") == "dark" and module().get("override") == "dark" and int(module().get("events", -1)) == 1
    and page() == DARK and text("appearance-scheme") == "dark" and text("appearance-heard") == "1 · last dark"),
    "setColorScheme(\"dark\") overrides the light system: one change event and the whole screen re-renders dark")
  await capture("dark", DARK)

  # Back to the system: it is light, so the effective scheme changes back and RN says so once.
  await click("appearance-system")
  var followed := example()
  stages.system = {"example": followed, "module": module(), "page": page()}
  verify((followed.get("scheme") == "light" and followed.get("heard", []) == ["dark", "light"] and module().get("override") == "unspecified"
    and int(module().get("events", -1)) == 2 and page() == LIGHT and text("appearance-choice") == "the system"),
    "unspecified follows the system again: the scheme returns to light with a second change event")

  # Now the operating system turns dark: DisplayServer calls the registered Callable.
  await system_theme("dark")
  var system_dark := example()
  stages["system-dark"] = {"example": system_dark, "module": module(), "page": page()}
  verify((system_dark.get("scheme") == "dark" and system_dark.get("heard", []) == ["dark", "light", "dark"]
    and module().get("system", {}).get("dark") == true and int(module().get("notifications", -1)) == 1
    and int(module().get("events", -1)) == 3 and page() == DARK and text("appearance-choice") == "the system"),
    "A system change reaches the app through the one Callable: the system is dark, a change event is heard and the screen is dark")
  await capture("system-dark", DARK)

  # An override wins over the system: later system changes are read but change nothing effective.
  await click("appearance-light")
  var light_over_dark := example()
  verify((light_over_dark.get("scheme") == "light" and light_over_dark.get("heard", []).size() == 4 and page() == LIGHT
    and module().get("system", {}).get("dark") == true),
    "setColorScheme(\"light\") wins over the dark system: the scheme is light with one more change event")
  await system_theme("light")
  await system_theme("dark")
  var settled := example()
  verify((settled.get("scheme") == "light" and settled.get("heard", []).size() == 4 and int(module().get("notifications", -1)) == 3
    and int(module().get("events", -1)) == 4 and int(module().get("overrides", -1)) == 4 and page() == LIGHT),
    "System changes under an override are read and change nothing: no event, the screen stays light")
  verify(int(settled.get("renders", 0)) < 20 and native_state().get("errors", []).is_empty(),
    "React re-rendered only for changes of its own state, and the run raised no host error")
  await finish()

func finish() -> void:
  application.call("stop")
  await frames(8)
  var stopped := native_state()
  verify(stopped.get("stopped", false) and stopped.get("rootCount", -1) == 0 and stopped.get("errors", []).is_empty(),
    "Stop releases the root and the Appearance module without a host error")
  var report := {"scenario": "appearance", "godot": Engine.get_version_info().string, "react": "19.2.3", "reactNative": "0.87.1",
    "engine": "hermes", "renderer": "fabric", "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages,
    "pages": pages, "applicationStopped": stopped}
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://build"))
  var output := FileAccess.open("res://build/report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_ERROR: Cannot write the appearance report")
    get_tree().quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  print("FABRIC_VALIDATION_FAILED: appearance" if failed else "FABRIC_VALIDATION_PASSED: appearance " + str(checks.size()))
  get_tree().quit(1 if failed else 0)
