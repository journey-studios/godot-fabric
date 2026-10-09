extends RefCounted

# The readings that the performance probes share (tests/performance-probe.gd, the soak of GF-30, and
# tests/frontier-baseline-probe.gd, the baseline on the pointer spike's scene): one reading of what the engine holds
# (the nodes of the SceneTree, Godot's own node, orphan and object monitors, its static memory and the process' resident
# memory) next to what the host reports of itself (its performance section, taken after a full collection of Hermes'
# heap). Both probes take their readings through this one code, so that a baseline and a soak are comparable and no
# sampling or percentile logic is written twice (docs/research/performance.md).
#
# A reading is taken between two Godot frames, never inside a pump. The collection and the sample windows are asked for
# through the application's validation metas (a product never sets them), only around a reading: every other read of the
# snapshot gets neither.
const COLLECT_META := "validation_collect_garbage_on_status"
const SAMPLES_META := "validation_performance_samples"
# Where each duration series sits in the host's section, so that a reading can drop the sample windows.
const SERIES_PATHS := [["pump"], ["phases", "js"], ["phases", "mount"], ["phases", "layout"], ["surfaces", "start"], ["surfaces", "retire"]]

var tree: SceneTree
var application: Node
# The JS global of the fixture whose engine() hands back HermesInternal's runtime properties.
var probe_global: String
var origin_usec := 0

func _init(scene_tree: SceneTree, app: Node, probe_name: String) -> void:
  tree = scene_tree
  application = app
  probe_global = probe_name
  origin_usec = Time.get_ticks_usec()

static func number(value: Variant, fallback: float = -1.0) -> float:
  return float(value) if value is float or value is int else fallback

static func dig(value: Variant, path: Array) -> Variant:
  var current: Variant = value
  for key: String in path:
    if not current is Dictionary or not current.has(key):
      return null
    current = current[key]
  return current

static func perf_of(reading: Dictionary) -> Dictionary:
  var value: Variant = reading.get("performance", {})
  return value if value is Dictionary else {}

# The live bytes of Hermes' heap in a reading.
static func heap_of(reading: Dictionary) -> float:
  return number(dig(perf_of(reading), ["hermes", "heap", "hermes_allocatedBytes"]))

static func without_windows(perf: Dictionary) -> Dictionary:
  var copy: Dictionary = perf.duplicate(true)
  for path: Array in SERIES_PATHS:
    var series: Variant = dig(copy, path)
    if series is Dictionary:
      series.erase("windowMs")
  return copy

static func parsed(text: String) -> Dictionary:
  var value: Variant = JSON.parse_string(text)
  return value if value is Dictionary else {}

static func surface_state(node: Control) -> Dictionary:
  return parsed(node.call("snapshot"))

# Whether a value has a shape: the check a probe's --replay makes before it reads a recorded report, so that a report that lacks
# what the checks index is refused (status 2) and not aborted on. A shape is a type name ("number", "string", "bool",
# "dictionary" for a Dictionary of any content, "any" for any value that is there), a Dictionary of the keys that must be present,
# each with its shape, ["each", shape] for an Array whose items all have the shape, or ["pair", shape] for an Array of exactly two.
static func matches(value: Variant, shape: Variant) -> bool:
  if shape is String:
    match shape:
      "number":
        return value is int or value is float
      "string":
        return value is String
      "bool":
        return value is bool
      "dictionary":
        return value is Dictionary
      _:
        return true
  if shape is Array:
    if not value is Array or (shape[0] == "pair" and value.size() != 2):
      return false
    for item: Variant in value:
      if not matches(item, shape[1]):
        return false
    return true
  if shape is Dictionary:
    if not value is Dictionary:
      return false
    for key: String in shape.keys():
      if not value.has(key) or not matches(value[key], shape[key]):
        return false
    return true
  return false

func set_flag(name: String, on: bool) -> void:
  if on:
    application.set_meta(name, true)
  elif application.has_meta(name):
    application.remove_meta(name)

# The application's snapshot. A reading asks for a full collection of Hermes' heap before it is taken and, when it keeps
# the windows, for the samples the percentiles come from; every other read of the snapshot gets neither.
func snapshot_text(collecting: bool = false, samples: bool = false) -> String:
  set_flag(COLLECT_META, collecting)
  set_flag(SAMPLES_META, samples)
  var text: String = application.call("snapshot")
  set_flag(COLLECT_META, false)
  set_flag(SAMPLES_META, false)
  return text

func app_state(collecting: bool = false, samples: bool = false) -> Dictionary:
  return parsed(snapshot_text(collecting, samples))

# The resident set size of the process in KB, or -1.
func rss_kb() -> int:
  var output: Array = []
  var status := OS.execute("ps", ["-o", "rss=", "-p", str(OS.get_process_id())], output)
  return int(str(output[0]).strip_edges()) if status == 0 and output.size() > 0 else -1

# One reading, taken between two Godot frames, so that no pump is running: what the engine holds
# (the nodes of the SceneTree, Godot's own node, orphan and object monitors, its static memory and the
# process' resident memory) and what the host reports, its performance section after a full
# collection of Hermes' heap. Windows are the samples the percentiles come from; the readings in
# between leave them out.
func sample(windows: bool = false) -> Dictionary:
  var state := app_state(true, windows)
  var perf: Dictionary = state.get("performance", {})
  var errors: Array = state.get("errors", [])
  return {"frame": Engine.get_process_frames(), "ms": (Time.get_ticks_usec() - origin_usec) / 1000.0,
    "godot": {"nodes": tree.get_node_count(), "nodeMonitor": number(Performance.get_monitor(Performance.OBJECT_NODE_COUNT)),
      "orphans": number(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT)),
      "objects": number(Performance.get_monitor(Performance.OBJECT_COUNT)),
      "staticMemory": OS.get_static_memory_usage(), "staticPeak": OS.get_static_memory_peak_usage(), "rssKb": rss_kb()},
    "host": {"rootCount": number(state.get("rootCount")), "pendingRootRetirements": number(state.get("pendingRootRetirements")),
      "pendingWork": number(state.get("pendingWork")), "pendingTimers": number(state.get("pendingTimers")),
      "errors": errors.size()},
    "performance": perf if windows else without_windows(perf)}

func engine_properties() -> Dictionary:
  var value: Variant = JSON.parse_string(application.call("evaluate", "JSON.stringify(" + probe_global + ".engine())"))
  return value if value is Dictionary else {}

func provenance() -> Dictionary:
  var engine := engine_properties()
  var properties: Dictionary = engine.get("properties", {}) if engine.get("properties") is Dictionary else {}
  return {"godot": Engine.get_version_info().string, "godotHash": Engine.get_version_info().hash, "hermes": str(properties.get("OSS Release Version", "")),
    "hermesProperties": properties, "architecture": Engine.get_architecture_name(), "os": OS.get_name(),
    "displayServer": DisplayServer.get_name(), "renderingDriver": RenderingServer.get_current_rendering_driver_name(),
    "renderingMethod": RenderingServer.get_current_rendering_method(), "processor": OS.get_processor_name(),
    "processorCount": OS.get_processor_count()}
