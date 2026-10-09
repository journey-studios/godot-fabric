extends SceneTree

# The windowed lane of the performance baseline, run by scripts/frontier-baseline-graphics.mjs and never in CI: the scene of the
# baseline (examples/frontier-baseline/scene.tscn) in a real window on the native renderer (Compatibility, as the project
# sets it), which is where a frame time exists. Headless nothing paces the loop and nothing is drawn
# (docs/research/frame-clock.md), so the frame time is measured only here.
#
# One run, one process: the same swaps as the headless probe (WARMUP_ROUNDS + ROUNDS rounds of the tour, a real click on the
# button of each panel), the intervals between consecutive process frames, from Time.get_ticks_usec, in two windows (the map and
# the HUD idle, and the frames that took a click), the time from a click to the first frame drawn after the nodes exist, and the
# vsync mode and refresh rate of the window, read back (DisplayServer.window_get_vsync_mode, screen_get_refresh_rate) and not
# assumed. Nothing is judged on a duration; the script computes the percentiles of the raw intervals that the run writes.
# Every exact count of the headless lane holds here too.
#
# --run=<n> names the run's file. --captures makes the run that saves one image per panel and measures nothing.
const Sampler := preload("res://tests/performance-sampler.gd")
const Swap := preload("res://tests/frontier-baseline-swap.gd")
const SCENE := "res://examples/frontier-baseline/scene.tscn"
const SIZE := Vector2i(800, 600)
const IDLE_FRAMES := 600
const CAPTURES := "res://build/frontier-baseline-graphics"
const VSYNC_NAMES := ["disabled", "enabled", "adaptive", "mailbox"]
# A point of the bar away from its buttons, a point of the map no HUD covers, and a point inside the panels' region.
const BAR_PIXEL := Vector2i(600, 22)
const MAP_PIXEL := Vector2i(750, 500)
const PANEL_PIXEL := Vector2i(40, 200)
const BAR_COLOR := Color8(0x22, 0x33, 0x44)

var run_index := 1
var capturing := false
var checks: Array = []
var captures: Array = []
var scene: Node
var application: Node
var sampler: Sampler
var session: Swap

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FRONTIER_BASELINE_GRAPHICS_CHECK_FAILED: " + name)
  return condition

func settle(count: int = 3) -> void:
  for index in range(count):
    await process_frame

func close(a: Color, b: Color, tolerance: float = 0.03) -> bool:
  return absf(a.r - b.r) < tolerance and absf(a.g - b.g) < tolerance and absf(a.b - b.b) < tolerance

# The frame as drawn.
func look() -> Image:
  await process_frame
  await RenderingServer.frame_post_draw
  return root.get_texture().get_image()

func save(image: Image, label: String) -> void:
  image.save_png(ProjectSettings.globalize_path(CAPTURES + "/" + label + ".png"))
  captures.append("build/frontier-baseline-graphics/" + label + ".png")

# After the measured swaps: one image per panel and one of the base, to show what was measured, and pixel checks that the frame as
# drawn has the bar over the map, each panel where the HUD puts it, and the base again after them.
func capture_panels() -> void:
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(CAPTURES))
  var base_image := await look()
  save(base_image, "panel-empty")
  var painted := close(base_image.get_pixelv(BAR_PIXEL), BAR_COLOR) and base_image.get_pixelv(MAP_PIXEL).g > base_image.get_pixelv(MAP_PIXEL).r + 0.05
  var current := "empty"
  for panel: String in ["units", "city", "research"]:
    var row: Dictionary = await session.swap(current, panel)
    await session.quiet()
    current = panel
    var image := await look()
    save(image, "panel-" + panel)
    painted = painted and Sampler.number(row.latencyFrames) >= 0.0 and not close(image.get_pixelv(PANEL_PIXEL), base_image.get_pixelv(PANEL_PIXEL), 0.05)
  var back: Dictionary = await session.swap(current, "empty")
  await session.quiet()
  var again := await look()
  painted = painted and Sampler.number(back.latencyFrames) >= 0.0 and close(again.get_pixelv(PANEL_PIXEL), base_image.get_pixelv(PANEL_PIXEL), 0.01)
  check(painted, "render/The frame as drawn shows the bar over the map and each panel where the HUD puts it, and the base again after them")

func provenance() -> Dictionary:
  var value := sampler.provenance()
  var mode := DisplayServer.window_get_vsync_mode()
  value.merge({"vsyncMode": mode, "vsyncModeName": VSYNC_NAMES[mode] if mode >= 0 and mode < VSYNC_NAMES.size() else "unknown",
    "refreshRate": DisplayServer.screen_get_refresh_rate(), "maxFps": Engine.max_fps, "adapter": RenderingServer.get_video_adapter_name(),
    "screenSize": [DisplayServer.screen_get_size().x, DisplayServer.screen_get_size().y], "screenScale": DisplayServer.screen_get_scale(),
    "windowSize": [DisplayServer.window_get_size().x, DisplayServer.window_get_size().y]})
  return value

# The exact counts of the headless lane, over the swaps of this run.
func check_swaps(swaps: Array, base_nodes: int, base_tags: float) -> void:
  var total := (Swap.WARMUP_ROUNDS + Swap.ROUNDS) * (Swap.TOUR.size() - 1)
  var shown := swaps.size() == total
  var nodes := swaps.size() == total
  var counted := swaps.size() == total
  var once := swaps.size() == total
  var world := swaps.size() == total
  for row: Dictionary in swaps:
    var size := Sampler.number(Swap.NATIVE_NODES[row.to])
    var roots: Array = row.shownRoots
    shown = shown and Sampler.number(row.latencyFrames) >= 0.0 and row.snapshotComplete and roots == ([] if row.to == "empty" else [row.to])
    nodes = nodes and Sampler.number(row.treeNodes) == float(base_nodes) + size and Sampler.number(row.surface.nativeTags) == base_tags + size
    counted = counted and Sampler.number(row.host.creates) == size and Sampler.number(row.host.deletes) == Sampler.number(Swap.NATIVE_NODES[row.from])
    var pressed := 0.0
    for panel: String in row.rn.presses.keys():
      pressed += Sampler.number(row.rn.presses[panel])
    once = once and pressed == 1.0 and Sampler.number(row.rn.presses.get(row.to)) == 1.0 and Sampler.number(row.rn.changes) == 1.0 and row.rn.shown == row.to
    world = world and Sampler.number(row.worldClicks) == 0.0
  check(shown, "swap/Every click shows its panel: the Surface's snapshot holds its last node and the root of no other panel")
  check(nodes, "swap/Every swap leaves the SceneTree and the Surface with the base's nodes plus the new panel's")
  check(counted, "swap/Every swap creates the nodes of the new panel and deletes those of the old one")
  check(once, "swap/Every click swaps exactly once")
  check(world, "swap/No press, release or touch of a swap reaches the Godot world (the motion of the real pointer over the map is recorded, not judged)")

func run() -> void:
  for argument: String in OS.get_cmdline_user_args():
    if argument.begins_with("--run="):
      run_index = int(argument.get_slice("=", 1))
    elif argument == "--captures":
      capturing = true
  DisplayServer.window_set_size(SIZE)
  root.size = SIZE
  await settle()
  var packed: PackedScene = load(SCENE)
  scene = packed.instantiate()
  root.add_child(scene)
  application = scene.get_node("Application")
  sampler = Sampler.new(self, application, "FrontierBaselineProbe")
  session = Swap.new(self, scene, sampler)
  session.track_draws()
  var mounted: bool = await session.mount()
  var surface: Control = scene.get_node("Hud/Surface")
  check(mounted, "scene/The HUD mounts over the world on the native renderer")
  check(DisplayServer.get_name() != "headless", "display/The display server is not headless: " + DisplayServer.get_name())
  check(surface.mouse_filter == Control.MOUSE_FILTER_IGNORE, "scene/The Surface takes no pointer (IGNORE)")
  var info := provenance()
  check(info.vsyncMode >= 0 and info.vsyncMode < VSYNC_NAMES.size() and float(info.refreshRate) > 0.0,
    "vsync/The vsync mode and the refresh rate of the screen are read back from the window")
  var base_row := session.surface_row()
  var heap_start := sampler.sample()
  var swaps: Array = []
  var idle: Array = []
  var idle_draws := 0
  var aborted: Variant = null
  if capturing:
    # The captures are a run of their own, apart from the measured ones: they show what was measured and measure nothing.
    await capture_panels()
  else:
    for round_index in range(Swap.WARMUP_ROUNDS + Swap.ROUNDS):
      if round_index == Swap.WARMUP_ROUNDS:
        # The runtime is warm: the idle window, with the map and the HUD still and nothing read.
        await session.quiet()
        var drawn_before := session.draw_stamps.size()
        idle = await session.idle(IDLE_FRAMES)
        idle_draws = session.draw_stamps.size() - drawn_before
      for step in range(Swap.TOUR.size() - 1):
        var row: Dictionary = await session.swap(Swap.TOUR[step], Swap.TOUR[step + 1])
        row.merge({"round": round_index, "step": step})
        swaps.append(row)
        await session.quiet()
        if Sampler.number(row.latencyFrames) < 0.0:
          aborted = {"round": round_index, "step": step, "from": row.from, "to": row.to}
          break
      if aborted != null:
        break
    check_swaps(swaps, session.base_nodes, Sampler.number(base_row.nativeTags))
    check(idle.size() == IDLE_FRAMES, "idle/The idle window took its frames")
  var heap_end := sampler.sample()
  session.untrack_draws()
  application.call("stop")
  scene.queue_free()
  await settle(2)
  finish(info, base_row, swaps, [idle, idle_draws], aborted, heap_start, heap_end)

func finish(info: Dictionary, base_row: Dictionary, swaps: Array, idle_window: Array, aborted: Variant, heap_start: Dictionary, heap_end: Dictionary) -> void:
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed)
  var report := {"scenario": "frontier-baseline-graphics", "run": run_index, "godot": Engine.get_version_info().string, "provenance": info,
    "viewport": [SIZE.x, SIZE.y],
    "config": {"panels": Swap.PANELS, "nativeNodes": Swap.NATIVE_NODES, "baseNativeNodes": Swap.BASE_NATIVE_NODES,
      "tab": {"left": Swap.TAB_LEFT, "top": Swap.TAB_TOP, "step": Swap.TAB_STEP, "width": Swap.TAB_WIDTH, "height": Swap.TAB_HEIGHT},
      "tour": Swap.TOUR, "warmupRounds": Swap.WARMUP_ROUNDS, "rounds": Swap.ROUNDS, "stableFrames": Swap.STABLE_FRAMES, "idleFrames": IDLE_FRAMES},
    "baseNodes": session.base_nodes, "base": {"surface": base_row, "treeNodes": session.base_nodes}, "swaps": swaps,
    "idle": {"frames": IDLE_FRAMES, "intervalsUsec": idle_window[0], "draws": idle_window[1]},
    "frames": {"processed": Engine.get_process_frames(), "drawn": session.draw_stamps.size()},
    "aborted": aborted, "heap": {"start": heap_start, "end": heap_end},
    "checks": checks, "captures": captures}
  var output := FileAccess.open("res://build/frontier-baseline-graphics-run-%d.json" % run_index, FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_ERROR: cannot write the graphics run")
    quit(1)
    return
  output.store_string(JSON.stringify(report) + "\n")
  output.close()
  print("FRONTIER_BASELINE_GRAPHICS_PASSED: " + str(checks.size()) if failures.is_empty() else "FRONTIER_BASELINE_GRAPHICS_FAILED")
  quit(0 if failures.is_empty() else 1)

func _initialize() -> void:
  call_deferred("run")
