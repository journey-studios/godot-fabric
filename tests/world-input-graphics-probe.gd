extends SceneTree

# The windowed lane of the pointer spike, run by scripts/world-input-graphics.mjs and never in CI: the scene of
# topology (a) (examples/world-input/scene.tscn) on a real window and the native renderer. It confirms that the
# display server is not headless, takes the same counts as the headless probe with N = 100 (the empty area
# reaches the world, a Pressable does not, an open overlay lets nothing through, and the six gaps of a1 are closed: a hit slop,
# a Text with onPress, the gap of a ScrollView, the wheel over the HUD, over a ScrollView and over an overlay), and captures the
# map with its HUD. The counts are taken on bursts the same way as there (tests/world-input-driver.gd), so they do not depend on the pace
# of the frames. The report also reads the V-Sync mode back and measures the idle frames, to say whether the frames the lane
# drew were paced by the display (and so presented) or ran unpaced.
const Driver := preload("res://tests/world-input-driver.gd")
const SCENE := "res://examples/world-input/scene.tscn"
const SIZE := Vector2i(800, 600)
const N := 100
const CAPTURES := "res://build/world-input-graphics"
const VOID := Vector2(700, 550)
const BUTTON := Vector2(70, 40)
const OVERLAY_BUTTON := Vector2(350, 320)
const BAR := Vector2(250, 80)
const SCROLL_BUTTON := Vector2(100, 200)
# The places the GUI alone would let through to the world (see the headless probe): L1 a hit slop, L2 a Text with onPress, L3 the gap
# of a ScrollView. The handler is the one that hears a click or a tap there.
const GAP_PLACES := [
  {"label": "L1 hit slop", "region": "slop", "at": Vector2(490, 120), "handler": "slopPress"},
  {"label": "L2 Text onPress", "region": "text", "at": Vector2(520, 212), "handler": "textPress"},
  {"label": "L3 ScrollView gap", "region": "scroll-gap", "at": Vector2(550, 400), "handler": "wrapDown"},
]
# The idle frames measured to tell a paced display from an unpaced one.
const IDLE_FRAMES := 90
# A point of the bar, away from its Pressable, and a point of the map no HUD covers.
const BAR_PIXEL := Vector2i(200, 90)
const MAP_PIXEL := Vector2i(750, 500)
const BAR_COLOR := Color8(0x22, 0x33, 0x44)

var checks: Array = []
var captures: Array = []
var display := {}
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

# The selected tile is painted as a translucent yellow over the green map: the pixels of a frame that are that color.
func highlighted_pixels(image: Image) -> int:
  var total := 0
  for x in range(0, image.get_width(), 4):
    for y in range(0, image.get_height(), 4):
      var pixel := image.get_pixel(x, y)
      if pixel.r > 0.6 and pixel.g > 0.55 and pixel.b < 0.35:
        total += 1
  return total

func median(values: Array) -> float:
  var sorted := values.duplicate()
  sorted.sort()
  return float(sorted[sorted.size() >> 1]) if not sorted.is_empty() else -1.0

# What the display did while the lane ran. The V-Sync mode and the refresh rate are read back from the display server, and the
# frames of an idle scene are timed: a window paced by V-Sync spends about one refresh period on a frame, and one that runs unpaced
# (a display that is asleep, a mode that is disabled, a limit on the frame rate) spends far less. Unpaced frames were drawn, not presented
# at the refresh rate, and the report says so; the counts do not depend on the pace.
func display_report() -> Dictionary:
  var modes := {DisplayServer.VSYNC_DISABLED: "disabled", DisplayServer.VSYNC_ENABLED: "enabled", DisplayServer.VSYNC_ADAPTIVE: "adaptive",
    DisplayServer.VSYNC_MAILBOX: "mailbox"}
  var mode := DisplayServer.window_get_vsync_mode()
  var rate := DisplayServer.screen_get_refresh_rate()
  var period := 1000.0 / rate if rate > 0.0 else -1.0
  var gaps: Array = []
  var previous := Time.get_ticks_usec()
  for index in range(IDLE_FRAMES):
    await process_frame
    var now := Time.get_ticks_usec()
    gaps.append((now - previous) / 1000.0)
    previous = now
  var middle := median(gaps)
  var paced := (mode == DisplayServer.VSYNC_ENABLED or mode == DisplayServer.VSYNC_ADAPTIVE) and period > 0.0 and middle >= period / 2.0
  return {"vsyncMode": modes.get(mode, "unknown"), "refreshRate": rate, "periodMs": snappedf(period, 0.001), "idleFrames": IDLE_FRAMES,
    "idleMedianGapMs": snappedf(middle, 0.001), "maxFps": Engine.max_fps, "canDraw": DisplayServer.window_can_draw(),
    "pacing": "paced" if paced else "unpaced",
    "presented": "The frames are paced by the display, so the captures and the counts ran on presented frames." if paced else
      "The frames ran unpaced (the idle median is far below the refresh period, or V-Sync is not on): they were drawn, not presented at the refresh rate. The counts do not depend on the pace and stand; the captures are the viewport's readback."}

func painted(image: Image) -> bool:
  var bar := image.get_pixelv(BAR_PIXEL)
  var map := image.get_pixelv(MAP_PIXEL)
  return absf(bar.r - BAR_COLOR.r) < 0.03 and absf(bar.g - BAR_COLOR.g) < 0.03 and absf(bar.b - BAR_COLOR.b) < 0.03 \
    and map.g > map.r + 0.05 and map.g > map.b + 0.05

# The six gaps of a1, closed by a2, at N = 100: a click, a tap and the emulated mouse in a hit slop, on a Text and in the gap of a ScrollView
# reach the handler (the emulated mouse nobody) and not the world; the wheel over the HUD and over a ScrollView reaches neither the world nor a handler.
func gap_checks() -> void:
  for place: Dictionary in GAP_PLACES:
    for input: String in ["left", "touch"]:
      var row := driver.run([Driver.part(place.region, input, place.at)], N)
      check(row.world.is_empty() and row.rn == {"hud/" + place.handler: N},
        "%s: %d %s inputs reach the handler %d times and none reaches the world" % [place.label, N, input, N])
    var emulated := driver.run([Driver.part(place.region, "emulated", place.at)], N)
    check(emulated.world.is_empty() and emulated.rn.is_empty(), "%s: %d emulated mouse clicks reach neither the world nor a handler" % [place.label, N])
  var bar := driver.run([Driver.part("bar", "wheel", BAR)], N)
  check(bar.world.is_empty() and bar.rn.is_empty(), "L4 wheel over the HUD: %d ticks on a bar reach neither the world nor a handler" % N)
  var scroll := driver.run([Driver.part("scroll-button", "wheel", SCROLL_BUTTON)], N)
  check(scroll.world.is_empty() and scroll.rn.is_empty(), "L5 wheel over a ScrollView: %d ticks reach neither the world nor a handler (press and release)" % N)

func overlay_cycle(kind: String) -> void:
  var opened := await driver.set_overlay(kind, true)
  await capture(kind + "-overlay-open")
  if kind == "tree":
    var wheel := driver.run([Driver.part("covered", "wheel", VOID)], N)
    check(wheel.world.is_empty() and wheel.rn.is_empty(), "L6 wheel over the tree overlay: %d ticks reach neither the world nor a handler" % N)
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
  display = await display_report()
  check(DisplayServer.get_name() != "headless", "the display server is not headless: " + DisplayServer.get_name())
  check(surfaces[0].mouse_filter == Control.MOUSE_FILTER_IGNORE, "the Surface takes no pointer (IGNORE)")
  var map := await capture("map-with-hud")
  check(painted(map), "the frame shows the bar of the HUD over the map")
  var empty := driver.run([Driver.part("void", "left", VOID)], N)
  check(empty.world == Driver.stream_of("left", N) and empty.rn.is_empty() and empty.tiles.size() == 1,
    "%d clicks on the empty area reach the world once each and none reaches the HUD" % N)
  var selected := await capture("tile-selected")
  check(highlighted_pixels(selected) > 0, "the frame shows the tile the empty-area clicks selected")
  var button := driver.run([Driver.part("button", "left", BUTTON)], N)
  check(button.world.is_empty() and button.rn == {"hud/press": N, "hud/barDown": N}, "%d clicks on the Pressable press it %d times and none reaches the world" % [N, N])
  var tap := driver.run([Driver.part("void", "touch", VOID)], N)
  check(tap.world == Driver.stream_of("touch", N) and tap.rn.is_empty(), "%d taps on the empty area reach the world as ScreenTouch and as the emulated mouse" % N)
  var tap_button := driver.run([Driver.part("button", "touch", BUTTON)], N)
  check(tap_button.world.is_empty() and tap_button.rn == {"hud/press": N, "hud/barDown": N}, "%d taps on the Pressable press it %d times and none reaches the world" % [N, N])
  check(driver.hovered(VOID) == null, "gui_get_hovered_control() is null over the map")
  check(driver.hovered(BUTTON) != null, "a control of the HUD is the hovered one over the HUD")
  gap_checks()
  # All the gaps in one burst, then a frame: the world selected no tile, so the map shows no highlight.
  var every: Array = []
  for place: Dictionary in GAP_PLACES:
    every.append(Driver.part(place.region, "left", place.at))
    every.append(Driver.part(place.region, "touch", place.at))
  every.append(Driver.part("bar", "wheel", BAR))
  var all_gaps := driver.run(every, N)
  var claimed := await capture("gaps-claimed")
  check(all_gaps.world.is_empty() and all_gaps.tiles.is_empty() and highlighted_pixels(claimed) == 0,
    "%d rounds over every gap place select no tile: the frame shows no highlight and the world heard nothing" % N)
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
    "viewport": [SIZE.x, SIZE.y], "n": N, "display": display, "checks": checks, "captures": captures}
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
