extends SceneTree

# The windowed lane of the pointer spike, run by scripts/world-input-graphics.mjs and never in CI: the scene of
# topology (a) (examples/world-input/scene.tscn) on a real window and the native renderer. It confirms that the
# display server is not headless, takes the same counts as the headless probe with N = 100 (the empty area
# reaches the world, a Pressable does not, an open overlay lets nothing through), and captures the map with its HUD.
# The counts are taken on bursts the same way as there (tests/world-input-driver.gd).
const Driver := preload("res://tests/world-input-driver.gd")
const SCENE := "res://examples/world-input/scene.tscn"
const SIZE := Vector2i(800, 600)
const N := 100
const CAPTURES := "res://build/world-input-graphics"
const VOID := Vector2(700, 550)
const BUTTON := Vector2(70, 40)
const OVERLAY_BUTTON := Vector2(350, 320)
# A point of the bar, away from its Pressable, and a point of the map no HUD covers.
const BAR_PIXEL := Vector2i(200, 90)
const MAP_PIXEL := Vector2i(750, 500)
const BAR_COLOR := Color8(0x22, 0x33, 0x44)

var checks: Array = []
var captures: Array = []
var scene: Node
var driver: Driver

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("WORLD_INPUT_GRAPHICS_CHECK_FAILED: " + name)
  return condition

func settle(count := 3) -> void:
  for index in range(count):
    await process_frame

# The frame as drawn, saved as a PNG; the image is returned for the pixel checks.
func capture(label: String) -> Image:
  await process_frame
  await RenderingServer.frame_post_draw
  var image := root.get_texture().get_image()
  image.save_png(ProjectSettings.globalize_path(CAPTURES + "/" + label + ".png"))
  captures.append("build/world-input-graphics/" + label + ".png")
  return image

func painted(image: Image) -> bool:
  var bar := image.get_pixelv(BAR_PIXEL)
  var map := image.get_pixelv(MAP_PIXEL)
  return absf(bar.r - BAR_COLOR.r) < 0.03 and absf(bar.g - BAR_COLOR.g) < 0.03 and absf(bar.b - BAR_COLOR.b) < 0.03 \
    and map.g > map.r + 0.05 and map.g > map.b + 0.05

func overlay_cycle(kind: String) -> void:
  var opened := await driver.set_overlay(kind, true)
  await capture(kind + "-overlay-open")
  var covered := driver.run([Driver.part("covered", "left", VOID)], N)
  var button := driver.run([Driver.part(kind + "-button", "left", OVERLAY_BUTTON)], N)
  check(opened, "%s overlay: it opens" % kind)
  check(covered.world.is_empty() and covered.rn.is_empty(), "%s overlay open: %d clicks reach neither the world nor the HUD's handlers" % [kind, N])
  check(button.world.is_empty() and button.rn == {"hud/" + kind + "Press": N}, "%s overlay open: its Pressable is pressed %d times and none reaches the world" % [kind, N])
  var closed := await driver.set_overlay(kind, false)
  var again := driver.run([Driver.part("void", "left", VOID)], N)
  check(closed and again.world == Driver.stream_of("left", N) and again.rn.is_empty(), "%s overlay closed again: %d of %d clicks reach the world" % [kind, N, N])

func run() -> void:
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(CAPTURES))
  DisplayServer.window_set_size(SIZE)
  root.size = SIZE
  await settle()
  var packed: PackedScene = load(SCENE)
  scene = packed.instantiate()
  root.add_child(scene)
  var world: Node2D = scene.get_node("World")
  var app: Node = scene.get_node("Application")
  var surfaces: Array = scene.get_node("Hud").get_children()
  driver = Driver.new(world, app, surfaces)
  check(await driver.wait_for(driver.mounted), "the scene mounts on the native renderer")
  check(DisplayServer.get_name() != "headless", "the display server is not headless: " + DisplayServer.get_name())
  check(surfaces[0].mouse_filter == Control.MOUSE_FILTER_IGNORE, "the Surface takes no pointer (IGNORE)")
  var map := await capture("map-with-hud")
  check(painted(map), "the frame shows the bar of the HUD over the map")
  var empty := driver.run([Driver.part("void", "left", VOID)], N)
  check(empty.world == Driver.stream_of("left", N) and empty.rn.is_empty() and empty.tiles.size() == 1,
    "%d clicks on the empty area reach the world once each and none reaches the HUD" % N)
  await capture("tile-selected")
  var button := driver.run([Driver.part("button", "left", BUTTON)], N)
  check(button.world.is_empty() and button.rn == {"hud/press": N, "hud/barDown": N}, "%d clicks on the Pressable press it %d times and none reaches the world" % [N, N])
  var tap := driver.run([Driver.part("void", "touch", VOID)], N)
  check(tap.world == Driver.stream_of("touch", N) and tap.rn.is_empty(), "%d taps on the empty area reach the world as ScreenTouch and as the emulated mouse" % N)
  var tap_button := driver.run([Driver.part("button", "touch", BUTTON)], N)
  check(tap_button.world.is_empty() and tap_button.rn == {"hud/press": N, "hud/barDown": N}, "%d taps on the Pressable press it %d times and none reaches the world" % [N, N])
  check(driver.hovered(VOID) == null, "gui_get_hovered_control() is null over the map")
  check(driver.hovered(BUTTON) != null, "a control of the HUD is the hovered one over the HUD")
  await overlay_cycle("tree")
  await overlay_cycle("modal")
  app.call("stop")
  scene.queue_free()
  await settle(2)
  finish()

func finish() -> void:
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed)
  var report := {"scenario": "native-world-input-graphics", "godot": Engine.get_version_info().string, "displayServer": DisplayServer.get_name(),
    "renderer": RenderingServer.get_current_rendering_method(), "adapter": RenderingServer.get_video_adapter_name(),
    "viewport": [SIZE.x, SIZE.y], "n": N, "checks": checks, "captures": captures}
  var output := FileAccess.open("res://build/world-input-graphics-report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_ERROR: cannot write the graphics report")
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  output.close()
  print("WORLD_INPUT_GRAPHICS_PASSED: " + str(checks.size()) if failures.is_empty() else "WORLD_INPUT_GRAPHICS_FAILED")
  quit(0 if failures.is_empty() else 1)

func _initialize() -> void:
  call_deferred("run")
