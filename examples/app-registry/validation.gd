extends Node

# The public AppRegistry example under real mouse input. Each state is read from the actual Godot Controls the example mounted (the root
# View, the wrapper the provider returned, the texts), and with --capture the renderer's frame is saved too.
const DEVICE := 1001
const ROOT_PADDING := 16.0
const ROOT_RADIUS := 24.0
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

func wait_for(condition: Callable, limit_ms: int = 8000) -> bool:
  var started := Time.get_ticks_msec()
  while Time.get_ticks_msec() - started < limit_ms and not condition.call():
    await frames()
  return condition.call()

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(" + expression + ")"))

func example() -> Dictionary:
  var value: Variant = js("globalThis.AppRegistryExample.state()")
  return value if value is Dictionary else {}

func native_state() -> Dictionary:
  var value: Variant = JSON.parse_string(application.call("snapshot"))
  return value if value is Dictionary else {}

func nodes() -> Array:
  var value: Variant = JSON.parse_string(surface.call("snapshot"))
  return value.nodes if value is Dictionary else []

# The native node of a testID; the root View is the only View without one.
func node(id: String) -> Dictionary:
  for entry: Dictionary in nodes():
    if entry.testID == id and (id != "" or entry.kind == "view"):
      return entry
  return {}

func text_of(id: String) -> String:
  return str(node(id).get("nativeText", node(id).get("text", "")))

func background(entry: Dictionary) -> String:
  return str(entry.get("appearance", {}).get("background", ""))

func control(id: String) -> Control:
  return surface.find_child(id, true, false) as Control

func snap(stage: String) -> void:
  stages[stage] = {"nodes": nodes(), "example": example()}

func region(node_: Control) -> Rect2i:
  var physical := get_window().get_final_transform() * node_.get_global_rect()
  return Rect2i(Vector2i(physical.position.round()), Vector2i(physical.size.round()))

func digest(image: Image, area: Rect2i) -> String:
  var context := HashingContext.new()
  context.start(HashingContext.HASH_SHA256)
  context.update(image.get_region(area).get_data())
  return context.finish().hex_encode()

# Each stage is hashed over the whole surface, which is what the providers change.
func capture(stage: String) -> void:
  if not capturing:
    return
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  verify(image.save_png("res://build/app-registry-%s.png" % stage) == OK, "Renderer capture saved: " + stage)
  var area := region(surface)
  var inside := area.has_area() and Rect2i(Vector2i.ZERO, image.get_size()).encloses(area)
  verify(inside, "The surface lies inside the captured frame: " + stage)
  images[stage] = digest(image, area) if inside else ""

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
  await mouse("down", at(id))
  await frames(4)
  await mouse("up", at(id))

func _ready() -> void:
  if not OS.get_cmdline_user_args().has("--validate"):
    return
  capturing = OS.get_cmdline_user_args().has("--capture")
  surface.set_meta("validation_input_device", DEVICE)
  await run()

func run() -> void:
  var mounted := await wait_for(func() -> bool: return (control("app-registry-apply") != null and control("app-registry-count") != null
    and control("app-registry-update") != null and not node("app-registry-title").is_empty()))
  verify(mounted, "The public example mounts its card and three Pressable buttons")
  await frames(10)
  var tag := int(surface.call("get_surface_id"))
  var root_before := node("")
  snap("before")
  verify(text_of("app-registry-title") == "Before the providers" and example().get("renders") == 1 and tag > 0,
    "The registered component renders once with the props of the scene")
  verify(text_of("app-registry-keys") == "keys: AppRegistryExample, AppRegistrySettings" and text_of("app-registry-sections") == "sections: AppRegistrySettings",
    "getAppKeys lists the component and the section, and getSectionKeys lists the section alone")
  verify((background(root_before) == "00000000" and node("app-registry-wrapper").is_empty()
    and float(root_before.width) == surface.size.x and example().get("wrapperCalls").is_empty() and example().get("styleCalls").is_empty()),
    "Without providers the root View is RN's default: it fills the surface, has no background, and nothing wraps the card")
  await capture("before")

  # The providers apply from the next run: the button sets them and runs the surface again with setSurfaceProps.
  await click("app-registry-apply")
  var applied := await wait_for(func() -> bool: return not node("app-registry-wrapper").is_empty() and text_of("app-registry-title") == "Providers applied")
  await frames(8)
  snap("providers")
  var root_after := node("")
  var wrapper := node("app-registry-wrapper")
  verify(applied, "The wrapper provider's component appears around the card after setSurfaceProps, with the new props")
  verify((background(root_after) == "3730a3ff" and root_after.appearance.cornerRadii == [ROOT_RADIUS, ROOT_RADIUS, ROOT_RADIUS, ROOT_RADIUS]
    and float(root_after.width) == surface.size.x and float(wrapper.x) == ROOT_PADDING and float(wrapper.y) == ROOT_PADDING
    and float(wrapper.width) == surface.size.x - 2.0 * ROOT_PADDING),
    "The root view style provider's style is on the native root Control: its background, its corner radius and its padding around the wrapper")
  verify(text_of("app-registry-frame-label") == "WRAPPER · Providers applied",
    "The wrapper gets the root's initialProps")
  var calls := example()
  verify((calls.wrapperCalls.size() == 1 and calls.wrapperCalls[0].appKey == "AppRegistryExample" and int(calls.wrapperCalls[0].rootTag) == tag
    and calls.styleCalls.size() == 1 and int(calls.styleCalls[0].rootTag) == tag),
    "Each provider ran once for the root, with its tag and the registered key")
  await capture("providers")

  # setSurfaceProps keeps the component's state: the count survives a new run.
  await click("app-registry-count")
  await click("app-registry-count")
  var counted := await wait_for(func() -> bool: return text_of("app-registry-tag") == "rootTag %d · count 2" % tag)
  verify(counted, "Pressable updates the component's state")
  await click("app-registry-update")
  var updated := await wait_for(func() -> bool: return text_of("app-registry-title") == "Props updated")
  await frames(8)
  snap("updated")
  verify(updated and text_of("app-registry-tag") == "rootTag %d · count 2" % tag and text_of("app-registry-frame-label") == "WRAPPER · Props updated",
    "setSurfaceProps changes the props and keeps the state: the count is still 2, and the wrapper shows the new props")
  verify(example().get("runs") == ["Providers applied", "Props updated"] and example().get("wrapperCalls").size() == 2,
    "Two runs of the surface called the wrapper provider twice")
  if capturing:
    verify(images.get("before") != "" and images.get("providers") != "" and images.get("before") != images.get("providers"),
      "The pixels of the surface differ before and after the providers: the renderer drew the wrapper and the root style")
  await finish()

func finish() -> void:
  application.call("stop")
  await frames(8)
  var stopped := native_state()
  verify(stopped.get("stopped", false) and stopped.get("rootCount", -1) == 0 and stopped.get("errors", []).is_empty(),
    "Stop releases the root without a host error")
  var report := {"scenario": "app-registry", "godot": Engine.get_version_info().string, "react": "19.2.3", "reactNative": "0.87.1",
    "engine": "hermes", "renderer": "fabric", "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages,
    "images": images, "applicationStopped": stopped}
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://build"))
  var output := FileAccess.open("res://build/report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_ERROR: Cannot write the app-registry report")
    get_tree().quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  print("FABRIC_VALIDATION_FAILED: app-registry" if failed else "FABRIC_VALIDATION_PASSED: app-registry " + str(checks.size()))
  get_tree().quit(1 if failed else 0)
