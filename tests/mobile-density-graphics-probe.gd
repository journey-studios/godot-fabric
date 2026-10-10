extends SceneTree

# The windowed lane of the density slice, run by scripts/mobile-density-graphics.mjs and never in CI (it needs a real window and the native
# renderer). It mounts the HUD of tests/mobile-density-fixture.jsx under density_policy "screen" at the scale of the display (2 on a Retina
# Mac; a seam stands in when the display is not at 2) and states the unsafe bands of an iPhone in landscape through validation_safe_area. It then
# captures the frame as drawn and reads pixels back from it:
#  - with the insets, the bars of the HUD (the top bar, the Pressable, the side panels) lie inside the safe rectangle: the pixels of the bands are
#    the root's, and the pixels at the centre of the bars are theirs;
#  - without the insets, the same pixel in the left band is the side panel's: the bars have moved out to the window's edge.
# The second capture also paints the bands the probe states, in translucent red, over the frame so that a reader can see them; the pixel checks run
# on the clean captures, never on that one. Nothing here touches a phone: the window is a macOS window, and the bands are the seam's numbers.
const WINDOW := Vector2i(1200, 720)
const INSETS := {"left": 47.0, "top": 20.0, "right": 47.5, "bottom": 21.0}
const CAPTURES := "res://build/mobile-density-graphics"
const ROOT_COLOR := Color8(0x0b, 0x12, 0x20)
const TOP_BAR_COLOR := Color8(0x1d, 0x4e, 0xd8)
const PANEL_COLOR := Color8(0xf5, 0x9e, 0x0b)
const TARGET_COLOR := Color8(0x22, 0xc5, 0x5e)
const FILL_COLOR := Color8(0x13, 0x23, 0x3a)

var application: Node
var surface: Control
var checks: Array = []
var captures: Array = []
var facts: Dictionary = {}

# Paints the bands the probe states over the frame, in the content's points.
class Bands extends Control:
  var unsafe := {}
  func _draw() -> void:
    var size := get_viewport_rect().size
    var tint := Color(1.0, 0.1, 0.1, 0.38)
    draw_rect(Rect2(0, 0, float(unsafe.left), size.y), tint)
    draw_rect(Rect2(size.x - float(unsafe.right), 0, float(unsafe.right), size.y), tint)
    draw_rect(Rect2(float(unsafe.left), 0, size.x - float(unsafe.left) - float(unsafe.right), float(unsafe.top)), tint)
    draw_rect(Rect2(float(unsafe.left), size.y - float(unsafe.bottom), size.x - float(unsafe.left) - float(unsafe.right), float(unsafe.bottom)), tint)
    draw_rect(Rect2(float(unsafe.left), float(unsafe.top), size.x - float(unsafe.left) - float(unsafe.right),
        size.y - float(unsafe.top) - float(unsafe.bottom)), Color(1.0, 0.9, 0.2, 0.9), false, 1.0)

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("MOBILE_DENSITY_GRAPHICS_CHECK_FAILED: " + name)
  return condition

func js_snapshot() -> Dictionary:
  var value: Variant = JSON.parse_string(application.call("evaluate", "JSON.stringify(MobileDensityProbe.snapshot())"))
  return value if value is Dictionary else {}

func native_nodes() -> Dictionary:
  var value: Variant = JSON.parse_string(surface.call("snapshot"))
  var result := {}
  if value is Dictionary:
    for node: Dictionary in value.get("nodes", []):
      if str(node.get("testID", "")) != "":
        result[node.testID] = node
  return result

func wait_for(condition: Callable, seconds := 20.0) -> bool:
  var limit := Time.get_ticks_msec() + int(seconds * 1000.0)
  while Time.get_ticks_msec() < limit:
    if condition.call():
      return true
    await process_frame
  return condition.call()

func padded(left: float, top: float) -> bool:
  var node: Dictionary = native_nodes().get("hud", {})
  return (node.has("safeArea") and absf(float(node.safeArea.left) - left) < 0.01 and absf(float(node.safeArea.top) - top) < 0.01)

# The frame as drawn, saved as a PNG; the image is returned for the pixel checks.
func capture(label: String) -> Image:
  await process_frame
  await RenderingServer.frame_post_draw
  var image := root.get_texture().get_image()
  image.save_png(ProjectSettings.globalize_path(CAPTURES + "/" + label + ".png"))
  captures.append("build/mobile-density-graphics/" + label + ".png")
  return image

func near(actual: Color, expected: Color) -> bool:
  return absf(actual.r8 - expected.r8) <= 6 and absf(actual.g8 - expected.g8) <= 6 and absf(actual.b8 - expected.b8) <= 6

# The colour of the pixel at a point of the HUD, in points, of an image in window pixels.
func pixel(image: Image, at: Vector2, scale: float) -> Color:
  return image.get_pixel(clampi(roundi(at.x * scale), 0, image.get_width() - 1), clampi(roundi(at.y * scale), 0, image.get_height() - 1))

func center(frame: Dictionary) -> Vector2:
  return Vector2(float(frame.x) + float(frame.width) / 2.0, float(frame.y) + float(frame.height) / 2.0)

func _initialize() -> void:
  call_deferred("run_probe")

func run_probe() -> void:
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(CAPTURES))
  root.size = WINDOW
  var display_name := DisplayServer.get_name()
  check(display_name != "headless", "display/The probe runs on a real display server")
  var real_scale := DisplayServer.screen_get_scale(DisplayServer.window_get_current_screen())
  var use_seam := not is_equal_approx(real_scale, 2.0)
  application = ClassDB.instantiate("FabricApplication")
  application.name = "GraphicsApplication"
  application.set("bundle_path", "res://build/mobile-density-probe.js")
  application.set("density_policy", "screen")
  application.set_meta("validation_safe_area", INSETS)
  if use_seam:
    application.set_meta("validation_screen_scale", 2.0)
  root.add_child(application)
  surface = ClassDB.instantiate("FabricSurface")
  surface.name = "GraphicsSurface"
  surface.size = Vector2(root.get_visible_rect().size)
  surface.set("application_path", NodePath("../GraphicsApplication"))
  surface.set("component_name", "MobileDensityProbe")
  root.add_child(surface)
  surface.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
  var ready: bool = await wait_for(func() -> bool:
    var frames: Dictionary = js_snapshot().get("frames", {})
    return frames.has("hud-top") and frames.has("touch-target") and frames.has("hud-left") and padded(INSETS.left, INSETS.top))
  check(ready, "mount/The HUD mounts and its SafeAreaView holds the seam's left and top band")
  var js := js_snapshot()
  var window: Dictionary = js.dimensions.window
  var scale := float(window.scale)
  var frames: Dictionary = js.frames
  facts = {"displayServer": display_name, "renderer": RenderingServer.get_current_rendering_method(), "adapter": RenderingServer.get_video_adapter_name(),
    "realScreenScale": real_scale, "scaleSource": "seam validation_screen_scale" if use_seam else "DisplayServer.screen_get_scale",
    "windowPixels": [root.size.x, root.size.y], "contentScaleFactor": root.content_scale_factor, "contentScaleMode": int(root.content_scale_mode),
    "dimensions": window, "insets": INSETS}
  check(is_equal_approx(scale, 2.0) and is_equal_approx(root.content_scale_factor, 2.0) and int(root.content_scale_mode) == Window.CONTENT_SCALE_MODE_CANVAS_ITEMS,
    "density/density_policy screen gives Dimensions.scale 2 and a canvas_items window at factor 2")
  check(absf(float(window.width) * scale - float(root.size.x)) < 0.01 and absf(float(window.height) * scale - float(root.size.y)) < 0.01,
    "density/The window in points is its pixels over the scale")
  var target: Dictionary = frames["touch-target"]
  check(absf(float(target.width) - 44.0) <= 0.5 and absf(float(target.height) - 44.0) <= 0.5, "density/A 44-point Pressable measures 44 ± 0.5 via measureInWindow")

  # With the insets: the bars lie inside the safe rectangle, and the bands are the root's.
  var clean := await capture("insets-scale-2")
  var band_point := Vector2(float(INSETS.left) / 2.0, float(window.height) / 2.0)
  var right_band_point := Vector2(float(window.width) - float(INSETS.right) / 2.0, float(window.height) / 2.0)
  var top_band_point := Vector2(float(window.width) / 2.0, float(INSETS.top) / 2.0)
  var bottom_band_point := Vector2(float(window.width) / 2.0, float(window.height) - float(INSETS.bottom) / 2.0)
  check(near(pixel(clean, band_point, scale), ROOT_COLOR) and near(pixel(clean, right_band_point, scale), ROOT_COLOR)
      and near(pixel(clean, top_band_point, scale), ROOT_COLOR) and near(pixel(clean, bottom_band_point, scale), ROOT_COLOR),
    "insets/The four bands the seam states show the root's colour: no bar of the HUD reaches them")
  check(near(pixel(clean, center(frames["hud-top"]), scale), TOP_BAR_COLOR) and near(pixel(clean, center(frames["touch-target"]), scale), TARGET_COLOR)
      and near(pixel(clean, center(frames["hud-left"]), scale), PANEL_COLOR),
    "insets/The top bar, the 44-point Pressable and the side panel are drawn where they were measured, inside the safe rectangle")
  var inside := true
  for id: String in ["hud-top", "hud-left", "hud-right", "hud-bottom", "touch-target"]:
    var frame: Dictionary = frames[id]
    inside = inside and (float(frame.x) >= float(INSETS.left) - 0.01 and float(frame.y) >= float(INSETS.top) - 0.01
      and float(frame.x) + float(frame.width) <= float(window.width) - float(INSETS.right) + 0.51
      and float(frame.y) + float(frame.height) <= float(window.height) - float(INSETS.bottom) + 0.01)
  check(inside, "insets/The measured frames of the bars lie inside the safe rectangle")

  # The same frame with the bands painted over it, for the reader.
  var bands := Bands.new()
  bands.unsafe = INSETS
  bands.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
  bands.mouse_filter = Control.MOUSE_FILTER_IGNORE
  var layer := CanvasLayer.new()
  layer.layer = 10
  layer.add_child(bands)
  root.add_child(layer)
  await capture("insets-scale-2-bands")
  layer.queue_free()

  # Without the insets the bars go to the window's edge.
  application.remove_meta("validation_safe_area")
  var cleared: bool = await wait_for(func() -> bool:
    var node: Dictionary = native_nodes().get("hud", {})
    return node.has("safeArea") and absf(float(node.safeArea.left)) < 0.01 and absf(float(node.safeArea.top)) < 0.01 and float(js_snapshot().frames["hud-left"].x) < 1.0)
  check(cleared, "cleared/The SafeAreaView returns to no padding when the seam is removed")
  var bare := await capture("no-insets-scale-2")
  var bare_frames: Dictionary = js_snapshot().frames
  check(near(pixel(bare, band_point, scale), PANEL_COLOR) and near(pixel(bare, center(bare_frames["hud-top"]), scale), TOP_BAR_COLOR),
    "cleared/Without the insets the same pixel of the left band is the side panel's")
  check(float(bare_frames["hud-left"].x) < 1.0 and float(frames["hud-left"].x) >= float(INSETS.left) - 0.01,
    "cleared/The side panel moves from the inset to the window's edge")
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed)
  var report := {"scenario": "mobile-density-graphics", "godot": Engine.get_version_info().string, "facts": facts, "checks": checks, "captures": captures,
    "pixels": {"window": [clean.get_width(), clean.get_height()]}}
  var output := FileAccess.open("res://build/mobile-density-graphics-report.json", FileAccess.WRITE)
  output.store_string(JSON.stringify(report, "  ") + "\n")
  output.close()
  surface.queue_free()
  application.queue_free()
  await process_frame
  await process_frame
  print("MOBILE_DENSITY_GRAPHICS_PASSED: " + str(checks.size()) if failures.is_empty() else "MOBILE_DENSITY_GRAPHICS_FAILED")
  quit(0 if failures.is_empty() else 1)
