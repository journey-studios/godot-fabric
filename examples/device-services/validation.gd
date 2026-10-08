extends Node

# The public device services example under real mouse input. Every platform
# backend is replaced by a stand-in that records what it was asked, through the
# application's validation_device_services meta: Copy and Paste use an in-memory
# pasteboard, Open URL asks a stand-in that never opens a browser, and Vibrate
# only logs. The Deep link button is a native Godot Button, because a deep link
# is something the platform delivers to the application (FabricApplication.deliver_url),
# not something a React screen can ask for. Each state is read from the native
# tree (the labels the host drew), from what React observed and from the host's
# own counters, and with --capture the renderer's frame is saved too.
const DEVICE := 1001
const SAMPLE := "Godot Fabric · clipboard sample 🚀"
const LINK := "https://example.com/godot-fabric?from=open-url"
const DEEP_LINK := "godotfabric://example/deep-link?from=button"
const OUTSIDE := "changed outside the example"
const ERR_UNAVAILABLE := 2
const BUTTONS := ["ds-copy", "ds-paste", "ds-open", "ds-vibrate"]
var backend := {"log": [], "pasteboard": "pasteboard before the example", "available": true, "open_code": 0}
var checks: Array = []
var stages: Dictionary = {}
var capturing := false
var deliveries := 0
var shown_calls := -1
@onready var application: Node = $Application
@onready var surface: Control = $Surface
@onready var deep_link: Button = $DeepLink
@onready var backend_label: Label = $Backend

# The stand-ins must be in place before the application reads its backend, which is
# when the first root renders: _enter_tree runs before any child's _ready. They are
# installed for interactive runs too, so that nothing here ever opens a real URL,
# reads the real pasteboard or vibrates.
func _enter_tree() -> void:
  get_node("Application").set_meta("validation_device_services", {
    "open_url": backend_open, "clipboard_available": backend_available, "clipboard_get": backend_get,
    "clipboard_set": backend_set, "vibrate": backend_vibrate, "cancel_vibration": backend_cancel})

func backend_open(url: String) -> int:
  backend.log.append(["open", url])
  return backend.open_code

func backend_available() -> bool:
  return backend.available

func backend_get() -> String:
  backend.log.append(["get"])
  return backend.pasteboard

func backend_set(text: String) -> void:
  backend.log.append(["set", text])
  backend.pasteboard = text

func backend_vibrate(milliseconds: float) -> void:
  backend.log.append(["vibrate", int(milliseconds)])

func backend_cancel() -> void:
  backend.log.append(["cancel"])

func verify(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

func frames(count: int = 1) -> void:
  for index in range(count):
    await get_tree().process_frame

func wait_for(condition: Callable, limit_ms: int = 15000) -> bool:
  var started := Time.get_ticks_msec()
  while Time.get_ticks_msec() - started < limit_ms and not condition.call():
    await frames()
  return condition.call()

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(" + expression + ")"))

func example() -> Dictionary:
  var value: Variant = js("globalThis.DeviceServicesExample.state()")
  return value if value is Dictionary else {}

func native_state() -> Dictionary:
  var value: Variant = JSON.parse_string(application.call("snapshot"))
  return value if value is Dictionary else {}

func services() -> Dictionary:
  var value: Variant = native_state().get("deviceServices", {})
  return value if value is Dictionary else {}

func section(group: String) -> Dictionary:
  var value: Variant = services().get(group, {})
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

# A full click: the press is held for a few frames, as a hand holds it.
func click_at(point: Vector2) -> void:
  await mouse("down", point)
  await frames(3)
  await mouse("up", point)
  await frames(6)

func click(id: String) -> void:
  await click_at(at(id))

# The surface consumes every mouse event of this run, as it must for the React buttons: it handles
# the release of a click that began outside it, so a native button beside it would never see one.
# The surface is disabled for the click on the native button, which is then a real click: Godot's
# button presses only for a mouse it saw enter, so the pointer arrives before the press.
func click_native(button: Button) -> void:
  var point := button.get_global_rect().get_center()
  var mode := surface.process_mode
  surface.process_mode = Node.PROCESS_MODE_DISABLED
  var motion := InputEventMouseMotion.new()
  motion.device = DEVICE
  motion.position = point
  Input.parse_input_event(motion)
  await frames(2)
  await click_at(point)
  surface.process_mode = mode

func capture(stage: String) -> void:
  if not capturing:
    return
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  verify(image.save_png("res://build/device-services-%s.png" % stage) == OK, "Renderer capture saved: " + stage)

# A rejected promise reports its message; a setString that throws adds the host function's prefix.
func unavailable_reported() -> bool:
  return (text("ds-pasted").begins_with("Paste failed: ") and text("ds-pasted").contains("E_CLIPBOARD_UNAVAILABLE")
    and text("ds-clipboard").begins_with("Copy failed: ") and text("ds-clipboard").contains("E_CLIPBOARD_UNAVAILABLE"))

func _deliver_deep_link() -> void:
  deliveries += 1
  application.call("deliver_url", "%s&n=%d" % [DEEP_LINK, deliveries])

func _process(_delta: float) -> void:
  # The stand-in backend's log, beside the React screen.
  if shown_calls != backend.log.size():
    shown_calls = backend.log.size()
    var lines: Array[String] = []
    for entry: Array in backend.log.slice(maxi(0, backend.log.size() - 12)):
      lines.append(" ".join(entry.map(func(part: Variant) -> String: return str(part))))
    backend_label.text = "Validation backend\n" + ("\n".join(lines) if not lines.is_empty() else "(no calls yet)")

func _ready() -> void:
  deep_link.pressed.connect(_deliver_deep_link)
  if not OS.get_cmdline_user_args().has("--validate"):
    return
  capturing = OS.get_cmdline_user_args().has("--capture")
  # The headless window is 64 by 64, which leaves the native button outside the viewport, where the
  # GUI would never hover it. The window takes the project's own size, which a graphical run already has.
  get_window().size = Vector2i(ProjectSettings.get_setting("display/window/size/viewport_width"),
    ProjectSettings.get_setting("display/window/size/viewport_height"))
  surface.set_meta("validation_input_device", DEVICE)
  await run()

func run() -> void:
  var mounted := await wait_for(func() -> bool: return BUTTONS.all(func(id: String) -> bool: return control(id) != null))
  verify(mounted, "The public example mounts its four buttons as native Godot Controls")
  await frames(10)
  var initial := await wait_for(func() -> bool: return text("ds-initial") == "No launch URL")
  stages.initial = {"example": example(), "services": services()}
  verify(initial and example().get("initial") == null and section("linking").get("launchUrl") == null,
    "A process started without --uri= shows no launch URL")
  verify(int(section("modules").get("Clipboard", -1)) == 0 and int(section("modules").get("Vibration", -1)) == 0
    and int(section("modules").get("LinkingManager", -1)) == 1,
    "Only the LinkingManager module exists before a button is pressed: Clipboard and Vibration are created on first use")
  await capture("initial")

  # Copy, then Paste: the stand-in pasteboard holds exactly what React wrote.
  await click("ds-copy")
  var copied := example()
  stages.copied = {"example": copied, "backend": backend.log.duplicate(true), "services": services()}
  verify(backend.pasteboard == SAMPLE and backend.log == [["set", SAMPLE]] and text("ds-clipboard") == "Copied: " + SAMPLE,
    "Copy writes the sample text to the clipboard backend, which the screen reports")
  await capture("copied")
  await click("ds-paste")
  stages.pasted = {"example": example(), "backend": backend.log.duplicate(true)}
  verify(await wait_for(func() -> bool: return text("ds-pasted") == SAMPLE) and backend.log.back() == ["get"],
    "Paste reads the text Copy wrote, multibyte characters and emoji included")
  await capture("pasted")
  backend.pasteboard = OUTSIDE
  await click("ds-paste")
  verify(await wait_for(func() -> bool: return text("ds-pasted") == OUTSIDE),
    "A change made outside the application is what Paste reads next")

  # Open URL: the stand-in is asked once, exactly.
  var before: int = backend.log.size()
  await click("ds-open")
  stages.opened = {"example": example(), "backend": backend.log.slice(before)}
  verify(await wait_for(func() -> bool: return text("ds-link") == "Opened " + LINK) and backend.log.slice(before) == [["open", LINK]],
    "Open URL asks the backend for the exact URL once and the screen reports it opened")
  await capture("opened")

  # Deep link: the native Button hands the link to the running application, once, to the screen's listener.
  await click_native(deep_link)
  var first := DEEP_LINK + "&n=1"
  verify(await wait_for(func() -> bool: return text("ds-deep-link") == "1. " + first) and example().get("links") == [first],
    "The native Deep link button delivers a link through deliver_url, which the screen hears exactly once")
  await click_native(deep_link)
  var second := DEEP_LINK + "&n=2"
  verify(await wait_for(func() -> bool: return text("ds-deep-link") == "2. " + second) and example().get("links") == [first, second],
    "A second link arrives after the first, in order")
  stages.deep_link = {"example": example(), "services": services()}
  await capture("deep-link")

  # Vibrate: a duration reaches the backend.
  before = backend.log.size()
  await click("ds-vibrate")
  verify(await wait_for(func() -> bool: return text("ds-vibration") == "Vibrated for 150 ms") and backend.log.slice(before) == [["vibrate", 150]],
    "Vibrate passes its duration to the backend")
  await capture("vibrated")

  # What goes wrong is reported, never swallowed: a backend that fails rejects openURL with RN's message, and
  # without a clipboard both Copy and Paste report E_CLIPBOARD_UNAVAILABLE and touch nothing.
  backend.open_code = ERR_UNAVAILABLE
  await click("ds-open")
  verify(await wait_for(func() -> bool: return text("ds-link") == "Failed: Unable to open URL: " + LINK),
    "A backend that fails rejects openURL with RN's own message")
  backend.open_code = 0
  backend.available = false
  await click("ds-paste")
  await click("ds-copy")
  var reported := await wait_for(unavailable_reported)
  verify(reported and backend.pasteboard == OUTSIDE,
    "Without a clipboard both Copy and Paste report E_CLIPBOARD_UNAVAILABLE and touch nothing")
  backend.available = true
  await capture("failures")

  var counters := services()
  stages.final = {"example": example(), "services": counters, "backend": backend.log.duplicate(true)}
  verify(int(section("clipboard").get("writes", -1)) == 1 and int(section("clipboard").get("reads", -1)) == 2
    and int(section("clipboard").get("unavailable", -1)) == 2 and int(section("linking").get("opened", -1)) == 1
    and int(section("linking").get("refused", -1)) == 1 and int(section("linking").get("urlsObserved", -1)) == 2
    and int(section("vibration").get("vibrations", -1)) == 1,
    "The host's own counters match what the buttons did")
  verify(native_state().get("errors", []).is_empty(), "The run raised no host error")
  await finish()

func finish() -> void:
  application.call("stop")
  await frames(8)
  var stopped := native_state()
  verify(stopped.get("stopped", false) and stopped.get("rootCount", -1) == 0 and stopped.get("errors", []).is_empty(),
    "Stop releases the root without a host error")
  verify(application.call("deliver_url", "godotfabric://example/after-stop") == false and services().get("stopped") == true,
    "After stop deliver_url refuses a link and the services are stopped")
  var report := {"scenario": "device-services", "godot": Engine.get_version_info().string, "react": "19.2.3", "reactNative": "0.87.1",
    "engine": "hermes", "renderer": "fabric", "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages,
    "applicationStopped": stopped}
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://build"))
  var output := FileAccess.open("res://build/report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_ERROR: Cannot write the device services report")
    get_tree().quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  print("FABRIC_VALIDATION_FAILED: device-services" if failed else "FABRIC_VALIDATION_PASSED: device-services " + str(checks.size()))
  get_tree().quit(1 if failed else 0)
