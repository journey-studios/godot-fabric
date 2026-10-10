extends RefCounted

# The readings of the comparative execution that are not the CPU time of a frame (V05-10): the resident memory, the nodes of the SceneTree, in arm C Hermes' live heap after a forced
# collection and the Fabric native views, and what the machine, the engine and the display say of themselves. Every one of them is taken at rest, between two frames that belong to
# no window, and its cost is measured: `timed` answers the value and the microseconds the reading took, which the report keeps beside it
# (docs/research/frontier-comparison-execution.md, "What each reading costs and where it falls"). Nothing here is read inside a measured frame.
const Sampler := preload("performance-sampler.gd")

const VSYNC_NAMES := ["DISABLED", "ENABLED", "ADAPTIVE", "MAILBOX"]


# The vsync mode as the protocol writes it (`vsync.unlimitedFpsRequires` is DISABLED).
static func vsync_name() -> String:
  var mode := DisplayServer.window_get_vsync_mode()
  return VSYNC_NAMES[mode] if mode >= 0 and mode < VSYNC_NAMES.size() else "UNKNOWN"


# Asks for the vsync to be off and reads the mode back: the protocol counts the FPS without a limit only if the mode reads back DISABLED.
static func disable_vsync() -> String:
  DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
  return vsync_name()


# The resident set size of the process in MB, or -1.0 when `ps` cannot say.
static func rss_mb() -> float:
  var output: Array = []
  var status := OS.execute("ps", ["-o", "rss=", "-p", str(OS.get_process_id())], output)
  if status != 0 or output.is_empty():
    return -1.0
  return float(str(output[0]).strip_edges().to_int()) / 1024.0


static func scene_nodes(tree: SceneTree) -> int:
  return tree.get_node_count()


# Hermes' live heap after a forced collection of it and the Fabric native views, read the way the turn lane's reading at rest reads them (tests/performance-sampler.gd): the heap is
# the host's `hermes_allocatedBytes` after the collection and the views are its `nativeViews` counter. `errors` is how many errors the application has reported, which are the
# unhandled JavaScript errors of the execution.
static func hermes(tree: SceneTree, application: Node) -> Dictionary:
  var sampler := Sampler.new(tree, application, "")
  var reading: Dictionary = sampler.sample()
  var host: Dictionary = reading.get("host", {})
  return {"heapBytes": int(Sampler.heap_of(reading)), "nativeViews": int(Sampler.number(Sampler.dig(Sampler.perf_of(reading), ["counters", "nativeViews"]))),
    "errors": int(Sampler.number(host.get("errors"), 0.0))}


# What the reading answers and the microseconds it took.
static func timed(reading: Callable) -> Dictionary:
  var started := Time.get_ticks_usec()
  var value: Variant = reading.call()
  return {"value": value, "usec": Time.get_ticks_usec() - started}


# The engine, the system and the display as they report themselves. Names of the machine and its serials are not kept.
static func provenance(windowed: bool) -> Dictionary:
  var info := Engine.get_version_info()
  var screen := DisplayServer.screen_get_size()
  return {"godot": str(info.string), "godotHash": str(info.hash), "architecture": Engine.get_architecture_name(), "os": OS.get_name(), "osVersion": OS.get_version(),
    "processor": OS.get_processor_name(), "processorCount": OS.get_processor_count(), "displayServer": DisplayServer.get_name(),
    "renderingDriver": RenderingServer.get_current_rendering_driver_name(), "renderingMethod": RenderingServer.get_current_rendering_method(),
    "adapter": RenderingServer.get_video_adapter_name(), "windowed": windowed, "screenSize": [screen.x, screen.y], "screenScale": DisplayServer.screen_get_scale(),
    "windowSize": [DisplayServer.window_get_size().x, DisplayServer.window_get_size().y], "vsyncMode": vsync_name(), "refreshHz": DisplayServer.screen_get_refresh_rate(),
    "maxFps": Engine.max_fps, "windowCanDraw": DisplayServer.window_can_draw(), "lowProcessorUsageMode": OS.low_processor_usage_mode}
