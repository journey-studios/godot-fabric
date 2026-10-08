extends Node

# Ordinary project GDScript: the independent consumer drives its own scene with
# real pointer events and reads the native tree through the SDK's snapshot. It
# waits for states (a node, a colour, a React counter), never for a frame count.
const DEADLINE_MS := 10000
const SLATE_100 := "f1f5f9ff"
const SLATE_900 := "0f172aff"
const SLATE_800 := "1e293bff"
const SLATE_700 := "334155ff"
const INDIGO_600 := "4f46e5ff"
const INDIGO_300 := "a5b4fcff"
const BRAND_600 := "059669ff"
const BRAND_400 := "34d399ff"
const BLUE_600 := "2563ebff"
const BLUE_400 := "60a5faff"
const WHITE := "ffffffff"

var checks: Array = []
var surface: FabricSurface
var runtime: Node
var capture_pixels: Dictionary = {}
var stages: Array = []

func check(condition: bool, message: String) -> void:
  checks.append({"name": message, "passed": condition})
  print(("PASS " if condition else "FAIL ") + message)
  if not condition:
    push_error("CONSUMER_CHECK_FAILED: " + message)

func frames(count: int = 1) -> void:
  for i in range(count):
    await get_tree().process_frame

func state() -> Dictionary:
  return JSON.parse_string(surface.call("snapshot"))

func node(id: String) -> Dictionary:
  for entry in state().nodes:
    if entry.testID == id:
      return entry
  return {}

func stats() -> Dictionary:
  return JSON.parse_string(runtime.call("evaluate", "JSON.stringify(LibrariesStats)"))

func background(id: String) -> String:
  return node(id).get("appearance", {}).get("background", "")

func text_color(id: String) -> String:
  return node(id).get("appearance", {}).get("textColor", "")

func text(id: String) -> String:
  return node(id).get("nativeText", "")

func close(actual: float, expected: float, tolerance: float = 0.51) -> bool:
  return absf(actual - expected) <= tolerance

func all_close(actual: Array, expected: float) -> bool:
  return actual.size() == 4 and actual.all(func(value: Variant) -> bool: return close(float(value), expected))

func svg_root() -> Dictionary:
  for entry in state().nodes:
    if entry.get("svg", {}).get("tag", "") == "svg":
      return entry
  return {}

func primitives(tag: String) -> Array:
  return state().nodes.filter(func(entry: Dictionary) -> bool: return entry.get("svg", {}).get("tag", "") == tag)

func line_path() -> String:
  for entry in primitives("path"):
    if entry.svg.attributes.get("fill", "") == "none":
      return entry.svg.attributes.d
  return ""

# Polls a condition until it holds or the deadline passes; the check records which.
func until(condition: Callable) -> bool:
  var deadline := Time.get_ticks_msec() + DEADLINE_MS
  while Time.get_ticks_msec() < deadline:
    if condition.call():
      return true
    await frames()
  return condition.call()

func js(expression: String) -> bool:
  return await until(func() -> bool: return runtime.call("evaluate", "Boolean(" + expression + ")") == "true")

func wait_node(id: String, present: bool = true) -> bool:
  return await until(func() -> bool: return node(id).is_empty() != present)

func wait_background(id: String, expected: String) -> bool:
  return await until(func() -> bool: return background(id) == expected)

func wait_text(id: String, expected: String) -> bool:
  return await until(func() -> bool: return text(id) == expected)

func at(id: String) -> Vector2:
  var control: Control = surface.find_child(id, true, false)
  return control.get_global_rect().get_center()

func pointer(phase: String, position: Vector2) -> void:
  if phase == "start":
    # Hover first, as a real pointer arrives, so Godot's GUI state is current.
    var motion := InputEventMouseMotion.new()
    motion.device = 1001
    motion.position = position
    get_viewport().push_input(motion, true)
    await frames()
  var event := InputEventMouseButton.new()
  event.device = 1001
  event.position = position
  event.button_index = MOUSE_BUTTON_LEFT
  event.pressed = phase == "start"
  get_viewport().push_input(event, true)
  await frames()

func press(id: String) -> void:
  await pointer("start", at(id))
  await pointer("end", at(id))

# Pressability keeps a released press for its minimum duration; a picture of the scene waits until every Pressable rests.
func settled() -> bool:
  var resting := {"lib-count-press": BLUE_600, "lib-subtree-press": BRAND_600, "lib-accent-press": SLATE_700, "lib-light-press": SLATE_700, "lib-dark-press": SLATE_700, "lib-subtree-toggle": SLATE_700, "lib-data-press": SLATE_700, "lib-animate-press": SLATE_700}
  var nodes: Array = state().nodes
  return resting.keys().all(func(id: String) -> bool: return nodes.all(func(entry: Dictionary) -> bool: return entry.testID != id or entry.appearance.background == resting[id]))

func capture(stage: String, expected_card: String) -> void:
  stages.append({"stage": stage, "nodes": state().nodes.size(), "svg": svg_root().get("svg", {})})
  if not OS.get_cmdline_user_args().has("--capture"):
    return
  check(await until(settled), "Every Pressable is back at rest before the capture: " + stage)
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  var card: Control = surface.find_child("lib-card", true, false)
  var rect := card.get_global_rect()
  var sample := image.get_pixelv(Vector2i(rect.end.x - 10, rect.end.y - 10))
  capture_pixels[stage] = sample.to_html(false)
  check(image.save_png("res://libraries-" + stage + ".png") == OK, "A real renderer capture is saved: " + stage)
  check(sample.is_equal_approx(Color(expected_card.substr(0, 6))), "The captured card pixel is the colour of its compiled class: " + stage)

# A script error inside a coroutine would leave the scene waiting forever; bound the whole probe.
func watchdog() -> void:
  print("LIBRARIES_VALIDATION_FAILED: the probe did not finish")
  get_tree().quit(1)

func _ready() -> void:
  if not OS.get_cmdline_user_args().has("--validate"):
    return
  get_tree().create_timer(120.0).timeout.connect(watchdog)
  surface = $Surface
  runtime = $Application/Runtime
  surface.set_meta("validation_input_device", 1001)
  run_probe()

func run_probe() -> void:
  get_window().size = Vector2i(1120, 680)
  check(await wait_node("lib-card"), "The TSX bundle built by the SDK mounts a native tree")
  check(await js("LibrariesStats.appMounts === 1"), "The React effects of the application ran once")
  var first := state()
  check(first.errors.is_empty() and first.bundleEvaluations == 1, "The bundle evaluates once without host errors")
  # The manual scheme overrides whatever the operating system reports, so the probe starts from a pinned light theme.
  await press("lib-light-press")
  check(await wait_text("lib-theme-label", "Theme: light") and await wait_background("lib-root", SLATE_100), "Appearance.setColorScheme('light') pins the light theme before any assertion")

  # className through the original NativeWind interop: colours, spacing, borders, radius, typography.
  var root := node("lib-root")
  var card := node("lib-card")
  var image := node("lib-image")
  var title := node("lib-title")
  check(root.appearance.background == SLATE_100 and close(root.width, 1120) and close(root.height, 680), "w-full h-full bg-slate-100 paint the root over the real window")
  check(card.appearance.background == INDIGO_600 and card.appearance.borderColor == INDIGO_300, "bg-indigo-600 border-indigo-300 reach the card's native colours")
  check(all_close(card.appearance.borderWidths, 2) and all_close(card.appearance.cornerRadii, 10.5), "border-2 and rounded-xl reach the real border widths and corner radii")
  check(close(image.x - card.x, 16) and close(image.y - card.y, 16), "p-4 and border-2 offset the first child by 14 + 2 (NativeWind's rem is 14)")
  check(close(node("lib-panel").width, 420) and close(node("lib-count").x - (image.x + image.width), 10.5, 1.0), "w-[420px] and gap-3 size the panel and space its children")
  check(title.nativeFontSize == 21 and title.runs[0].fontWeight == 600 and close(title.runs[0].lineHeight, 28), "text-2xl font-semibold set the real font size, weight and line height")
  check(text_color("lib-title") == SLATE_900 and text_color("lib-count") == WHITE and node("lib-count").nativeFontSize == 16, "text colour and text-lg reach the labels")
  check(close(image.width, 49) and close(image.height, 49), "w-14 h-14 size the Image")
  check(await until(func() -> bool: return node("lib-image").get("image", {}).get("drawn") is Dictionary), "The Image loads its asset and draws")
  image = node("lib-image")
  check(image.image.drawn.effects.clip.outer.radii.horizontal.all(func(radius: Variant) -> bool: return close(float(radius), 7)), "rounded-lg clips the Image's pixels with real corner radii")
  check(image.image.source.uri.ends_with("/assets/ui/swatch.png") and image.image.counters.errors == 0, "The Image source is the asset the builder staged beside the bundle")
  check(node("lib-subtree").appearance.background == WHITE and background("lib-chart-panel") == WHITE, "Light-theme classes paint the subtree and chart panel")
  await capture("light", INDIGO_600)

  # active: on Pressable follows the original press lifecycle and the click fires on release.
  var press_id: float = node("lib-count-press").id
  check(background("lib-count-press") == BLUE_600, "bg-blue-600 paints the Pressable at rest")
  await pointer("start", at("lib-count-press"))
  check(await wait_background("lib-count-press", BLUE_400) and stats().presses == 0, "active:bg-blue-400 applies during the press, before onPress")
  await pointer("end", at("lib-count-press"))
  check(await js("LibrariesStats.presses === 1") and await wait_background("lib-count-press", BLUE_600), "Release fires onPress once and restores the resting class")
  check(await wait_text("lib-count", "Count: 1") and node("lib-count-press").id == press_id, "The click rerenders the label and keeps the Pressable's native Control")
  await press("lib-count-press")
  check(await wait_text("lib-count", "Count: 2"), "A second click counts again")
  await press("lib-subtree-press")
  check(await wait_text("lib-subtree-text", "Local: 1"), "The styled subtree holds its own state")

  # Changing className on a mounted node keeps state and native identity.
  var card_id: float = node("lib-card").id
  var title_id: float = node("lib-title").id
  var image_id: float = node("lib-image").id
  var subtree_id: float = node("lib-subtree").id
  await press("lib-accent-press")
  check(await wait_background("lib-card", BRAND_600), "Swapping the className applies the project's own theme colour (godotFabric.tailwind)")
  check(node("lib-card").appearance.borderColor == BRAND_400 and node("lib-card").id == card_id, "The border follows the new class on the same native Control")
  check(text("lib-count") == "Count: 2" and text("lib-subtree-text") == "Local: 1", "A className change retains component state")
  await capture("accent", BRAND_600)

  # Manual dark mode through Appearance.setColorScheme.
  await press("lib-dark-press")
  check(await wait_background("lib-root", SLATE_900) and await wait_text("lib-theme-label", "Theme: dark"), "dark: variants follow Appearance.setColorScheme('dark')")
  check(background("lib-subtree") == SLATE_800 and background("lib-chart-panel") == SLATE_800 and text_color("lib-title") == WHITE, "dark:bg-slate-800 and dark:text-white repaint the subtree, chart panel and title")
  check(node("lib-card").id == card_id and node("lib-title").id == title_id and node("lib-image").id == image_id and node("lib-subtree").id == subtree_id, "The theme switch keeps every styled Control")
  check(text("lib-count") == "Count: 2" and text("lib-subtree-text") == "Local: 1" and background("lib-card") == BRAND_600, "The theme switch retains component state and the swapped classes")
  await press("lib-accent-press")
  check(await wait_background("lib-card", INDIGO_600), "A className swap while dark restores the first classes")
  await capture("dark", INDIGO_600)

  # Unmount and remount a styled subtree while dark: its styles come back, its state starts over.
  await press("lib-subtree-toggle")
  check(await wait_node("lib-subtree", false) and await js("LibrariesStats.subtreeCleanups === 1"), "Unmounting the styled subtree removes its Controls and runs its cleanup")
  check(text("lib-count") == "Count: 2" and node("lib-card").id == card_id, "The rest of the tree is untouched by the unmount")
  await press("lib-subtree-toggle")
  check(await wait_node("lib-subtree") and await wait_background("lib-subtree", SLATE_800), "Remounting restores the compiled dark styles on fresh Controls")
  check(node("lib-subtree").id != subtree_id and text("lib-subtree-text") == "Local: 0" and stats().subtreeMounts == 2, "The remounted subtree is a new Control with new state")

  # Chart Kit v2's LineChart through the SDK's SVG adapter.
  var chart := svg_root()
  check(not chart.is_empty() and close(chart.width, 628) and close(chart.height, 260), "LineChart commits a native SVG surface sized by its props")
  check(chart.svg.paintedPixels > 10000 and chart.svg.textCount >= 15 and chart.svg.rasterLayers == 2, "The SVG raster has pixels, native axis text and ordered layers")
  check(chart.svg.document.contains("<path") and chart.svg.document.contains("<linearGradient") and primitives("circle").size() == 8, "The library emits an area gradient, a line path and eight markers")
  var chart_id: float = chart.id
  var path_before := line_path()
  var raster_before: String = chart.svg.rasterHash
  await press("lib-data-press")
  check(await until(func() -> bool: return line_path() != path_before and svg_root().svg.rasterHash != raster_before), "A React state update changes the geometry Godot paints")
  check(svg_root().id == chart_id and node("lib-chart").width == 628, "The data update reuses the native SVG surface")
  await capture("chart", INDIGO_600)

  # Unsupported interop fails loudly through the optional-peer facade.
  await press("lib-animate-press")
  check(await js("LibrariesStats.errors.length === 1") and stats().errors[0].contains("Reanimated"), "animate-spin fails explicitly at the missing Reanimated peer")
  check(not node("lib-unsupported").is_empty() and state().errors.is_empty(), "The failure is caught by React and is not a host error")
  await press("lib-animate-press")
  check(await wait_node("lib-unsupported", false) and text("lib-count") == "Count: 2", "The tree recovers after the failure")

  # Shutdown releases everything the libraries created.
  var before_stop := state()
  surface.call("unmount")
  check(await until(func() -> bool: return state().nodes.is_empty()), "Unmounting the surface removes every Control")
  check(await js("LibrariesStats.appCleanups === 1 && LibrariesStats.subtreeMounts === LibrariesStats.subtreeCleanups"), "Every React effect cleaned up exactly once")
  runtime.call("stop")
  var stopped := state()
  check(stopped.nativeTags == 0 and stopped.rootCount == 0 and stopped.pendingTimers == 0 and stopped.pendingAnimationFrames == 0, "Shutdown leaves no native tags, roots, timers or animation frames")
  check(stopped.creates == stopped.deletes and stopped.errors.is_empty(), "Every created Control was deleted and no host error occurred")
  var report := {"schemaVersion": 1, "host": "independent-libraries-consumer", "displayServer": DisplayServer.get_name(), "checks": checks, "beforeStop": before_stop, "afterStop": stopped, "stages": stages, "pixels": capture_pixels}
  var output := FileAccess.open("res://libraries-report.json", FileAccess.WRITE)
  output.store_string(JSON.stringify(report, "  ") + "\n")
  var success := checks.all(func(entry: Dictionary) -> bool: return entry.passed)
  print("LIBRARIES_VALIDATION_PASSED" if success else "LIBRARIES_VALIDATION_FAILED")
  get_tree().quit(0 if success else 1)
