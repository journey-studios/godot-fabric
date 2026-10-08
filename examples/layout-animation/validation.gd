extends Node

# The public LayoutAnimation example under real mouse input. The tiles are animated by RN's own LayoutAnimationDriver, so each state is
# read from the actual Godot Control it updated, and with --capture the renderer's frame is saved too.
const DEVICE := 1001
# A tile (72 points) and the gap (12) between tiles: the layouts below follow from them and from where the first tile rests.
const STEP := 84.0
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
  var value: Variant = js("globalThis.LayoutAnimationExample.state()")
  return value if value is Dictionary else {}

func native_state() -> Dictionary:
  var value: Variant = JSON.parse_string(application.call("snapshot"))
  return value if value is Dictionary else {}

func driver() -> Dictionary:
  var value: Variant = native_state().get("layoutAnimation", {})
  return value if value is Dictionary else {}

func control(id: String) -> Control:
  return surface.find_child(id, true, false) as Control

func tile(id: int) -> Control:
  return control("layout-animation-tile-%d" % id)

func place(id: int) -> Vector2:
  var node := tile(id)
  return node.position if node != null else Vector2(-1.0, -1.0)

func near(left: Vector2, right: Vector2, tolerance: float = 1e-3) -> bool:
  return left.distance_to(right) <= tolerance

func snap(stage: String) -> Dictionary:
  var value := {}
  for id in range(1, 5):
    var node := tile(id)
    value[str(id)] = {"present": node != null, "x": node.position.x if node != null else -1.0, "y": node.position.y if node != null else -1.0,
      "opacity": node.modulate.a if node != null else -1.0}
  stages[stage] = {"tiles": value, "driver": driver(), "example": example()}
  return value

# The readback rectangle of a Control, in the physical pixels of the saved frame.
func region(node: Control) -> Rect2i:
  var physical := get_window().get_final_transform() * node.get_global_rect()
  return Rect2i(Vector2i(physical.position.round()), Vector2i(physical.size.round()))

func digest(image: Image, area: Rect2i) -> String:
  var context := HashingContext.new()
  context.start(HashingContext.HASH_SHA256)
  context.update(image.get_region(area).get_data())
  return context.finish().hex_encode()

# The whole frame changes for unrelated reasons (a dimmed button, the status text), so each stage is hashed over the stage the tiles move in.
func capture(stage: String) -> void:
  if not capturing:
    return
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  verify(image.save_png("res://build/layout-animation-%s.png" % stage) == OK, "Renderer capture saved: " + stage)
  var area := region(control("layout-animation-stage"))
  var inside := area.has_area() and Rect2i(Vector2i.ZERO, image.get_size()).encloses(area)
  verify(inside, "The stage lies inside the captured frame: " + stage)
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

# Until the example's end callback count and the driver's idle state say that animation n is over.
func animation_over(count: int) -> bool:
  return example().get("ends", []).size() == count and driver().get("active") == false and int(driver().get("completed", -1)) == count

func column(first: Vector2, ids: Array) -> bool:
  for index in range(ids.size()):
    if not near(place(ids[index]), first + Vector2(0.0, STEP * index)):
      return false
  return true

func row(first: Vector2, ids: Array) -> bool:
  for index in range(ids.size()):
    if not near(place(ids[index]), first + Vector2(STEP * index, 0.0)):
      return false
  return true

func run() -> void:
  var mounted := await wait_for(func() -> bool: return (tile(1) != null and tile(2) != null and tile(3) != null
    and control("layout-animation-spring") != null and control("layout-animation-ease") != null))
  verify(mounted, "The public example mounts three tiles and two TouchableOpacity buttons")
  await frames(10)
  var origin := place(1)
  var before := snap("before")
  verify(row(origin, [1, 2, 3]) and tile(4) == null,
    "Before any animation the three tiles rest in a row, one tile and a gap apart")
  var state := driver()
  verify((state.get("enabled") == true and state.get("active") == false and int(state.get("started", -1)) == 0
    and int(state.get("pullsTotal", -1)) == 0 and example().get("renders") == 1),
    "RN's driver is installed and idle, and React has rendered once")
  await capture("before")

  # Spring: configureNext(Presets.spring), then the direction changes. The tiles leave the row for the column through RN's spring curve.
  var third_row := place(3)
  await click("layout-animation-spring")
  var moving := await wait_for(func() -> bool: return driver().get("active") == true and place(3).distance_to(third_row) > 8.0)
  var mid := snap("spring-mid")
  var final_third := origin + Vector2(0.0, STEP * 2)
  verify((moving and not near(place(3), third_row, 1.0) and not near(place(3), final_third, 1.0) and tile(3).get_parent() == tile(1).get_parent()
    and near(place(1), origin) and example().get("label") == "spring: running"),
    "Mid-animation the third tile is neither in the row nor in the column yet, and the first tile has not moved")
  await capture("spring-mid")
  var spring_over := await wait_for(func() -> bool: return animation_over(1))
  await frames(8)
  var spring_end := snap("spring-end")
  verify(spring_over and column(origin, [1, 2, 3]) and example().get("ends") == ["spring"] and example().get("label") == "spring: finished",
    "RN's onAnimationDidEnd comes once and the tiles rest in a column, exactly where Yoga laid them out")
  verify((int(driver().get("started", -1)) == 1 and int(driver().get("callbacksQueued", -1)) == 1 and int(driver().get("pullsTotal", -1)) >= 3
    and int(example().get("fails", -1)) == 0 and example().get("renders") == 3),
    "One animation started and completed, and React rendered three times (mount, request, end): the animation never committed")
  await capture("spring-end")

  # Ease in / out: one tile enters (a create) and another leaves (a delete) while the rest slide into the gap.
  await click("layout-animation-ease")
  var crossing := await wait_for(func() -> bool: return (tile(4) != null and tile(1) != null and tile(4).modulate.a > 0.05 and tile(4).modulate.a < 0.95
    and tile(1).modulate.a > 0.05 and tile(1).modulate.a < 0.95))
  var ease_mid := snap("ease-mid")
  verify((crossing and is_equal_approx(tile(4).modulate.a + tile(1).modulate.a, 1.0) and place(2).y < origin.y + STEP and place(2).y > origin.y),
    "Mid-animation the new tile fades in while the old one, still mounted, fades out, and the second tile slides between its two places")
  await capture("ease-mid")
  var ease_over := await wait_for(func() -> bool: return animation_over(2))
  await frames(8)
  var ease_end := snap("ease-end")
  verify((ease_over and tile(1) == null and column(origin, [2, 3, 4]) and is_equal_approx(tile(4).modulate.a, 1.0)
    and example().get("ends") == ["spring", "easeInEaseOut"]),
    "The old tile is removed only when the animation ends, the new one is opaque, and the three tiles rest in a column")
  await capture("ease-end")

  # Spring again: the direction flips back and the three tiles come back to a row.
  await click("layout-animation-spring")
  var returned := await wait_for(func() -> bool: return animation_over(3))
  await frames(8)
  var back := snap("back")
  verify(returned and row(origin, [2, 3, 4]) and example().get("ends") == ["spring", "easeInEaseOut", "spring"],
    "The third animation returns the tiles to a row")
  var final := driver()
  verify((int(final.get("started", -1)) == 3 and int(final.get("completed", -1)) == 3 and int(final.get("callbacksQueued", -1)) == 3
    and example().get("renders") == 7 and example().get("fails") == 0 and native_state().get("errors", []).is_empty()),
    "Three animations, three callbacks, seven React renders and no host error")
  if capturing:
    var stage_images := [images.get("before"), images.get("spring-mid"), images.get("spring-end"), images.get("ease-mid"), images.get("ease-end")]
    var distinct := {}
    for image in stage_images:
      distinct[image] = true
    verify(not stage_images.has("") and distinct.size() == stage_images.size(),
      "The stage's pixels differ at rest, in both mid-animation frames and at both ends: the renderer drew the moving tiles")
  verify(before.size() == 4 and mid.size() == 4 and spring_end.size() == 4 and ease_mid.size() == 4 and ease_end.size() == 4 and back.size() == 4,
    "Every stage was read")
  await finish()

func finish() -> void:
  application.call("stop")
  await frames(8)
  var stopped := native_state()
  verify(stopped.get("stopped", false) and stopped.get("rootCount", -1) == 0 and stopped.get("errors", []).is_empty()
    and driver().get("active") == false, "Stop releases the root and the driver without a host error")
  var report := {"scenario": "layout-animation", "godot": Engine.get_version_info().string, "react": "19.2.3", "reactNative": "0.87.1",
    "engine": "hermes", "renderer": "fabric", "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages,
    "images": images, "applicationStopped": stopped}
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://build"))
  var output := FileAccess.open("res://build/report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_ERROR: Cannot write the layout-animation report")
    get_tree().quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  print("FABRIC_VALIDATION_FAILED: layout-animation" if failed else "FABRIC_VALIDATION_PASSED: layout-animation " + str(checks.size()))
  get_tree().quit(1 if failed else 0)
