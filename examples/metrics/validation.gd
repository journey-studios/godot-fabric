extends Node

var checks: Array = []
var stages: Dictionary = {}
var original_size: Vector2i
var original_content_size: Vector2i
var original_mode: int
var original_factor: float
@onready var application: Node = $Application
@onready var panel: Control = $Panel

func verify(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

func frames(count: int = 8) -> void:
  for index in range(count):
    await get_tree().process_frame

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(" + expression + ")"))

func stats() -> Dictionary:
  var value: Variant = js("GodotMetrics.stats()")
  return value if value is Dictionary else {}

func native_state() -> Dictionary:
  var value: Variant = JSON.parse_string(application.call("snapshot"))
  return value if value is Dictionary else {}

func wait_js(expression: String, name: String) -> bool:
  var deadline := Time.get_ticks_msec() + 5000
  while Time.get_ticks_msec() < deadline:
    if not native_state().get("errors", []).is_empty():
      return verify(false, name + " (host error)")
    if application.call("evaluate", "Boolean(" + expression + ")") == "true":
      await frames(4)
      return verify(true, name)
    await frames(1)
  return verify(false, name + " (timeout)")

func close_size(actual: Dictionary, expected: Vector2, scale: float) -> bool:
  return is_equal_approx(float(actual.get("width", -1)), expected.x) and \
    is_equal_approx(float(actual.get("height", -1)), expected.y) and \
    is_equal_approx(float(actual.get("scale", -1)), scale) and \
    is_equal_approx(float(actual.get("fontScale", -1)), 1)

func verify_metrics(stage: String, expected_scale: float, mounted: bool = true) -> void:
  var observed := stats()
  var logical := get_window().get_visible_rect().size
  var screen := DisplayServer.window_get_current_screen(get_window().get_window_id())
  var expected_screen := Vector2(DisplayServer.screen_get_size(screen)) / expected_scale
  verify(close_size(observed.get("window", {}), logical, expected_scale), "Dimensions.window matches the application viewport: " + stage)
  verify(close_size(observed.get("screen", {}), expected_screen, expected_scale), "Dimensions.screen uses the current screen and content density: " + stage)
  verify(is_equal_approx(float(observed.get("pixelRatio", -1)), expected_scale) and observed.get("fontScale", -1) == 1, "Original PixelRatio reports actual content density and font multiplier: " + stage)
  verify(observed.get("pixelsFor12Points", -1) == roundi(12 * expected_scale), "PixelRatio converts logical layout size to pixels: " + stage)
  if mounted:
    verify(close_size(observed.get("hook", {}), logical, expected_scale), "useWindowDimensions observes the original RN Dimensions state: " + stage)
  var native := native_state()
  verify(close_size(native.get("dimensions", {}).get("window", {}), logical, expected_scale), "Native DeviceInfo payload agrees with public Dimensions: " + stage)
  stages[stage] = {"react": observed, "nativeDimensions": native.get("dimensions", {}), "nativeProbeWidth": native_probe_width() if mounted else null, "godotVisibleSize": [logical.x, logical.y], "godotWindowSize": [get_window().size.x, get_window().size.y], "screenIndex": screen}

func subscription_count() -> int:
  var value: Variant = js("GodotMetricsSubscriptionCount()")
  return int(value) if value is float or value is int else -1

func native_probe_width() -> float:
  var snapshot: Variant = JSON.parse_string(panel.call("snapshot"))
  if snapshot is Dictionary:
    for node in snapshot.get("nodes", []):
      if node.get("testID", "") == "metrics-pixel-probe":
        return float(node.get("width", -1))
  return -1

func resize(size: Vector2i, name: String) -> bool:
  get_window().size = size
  await frames(4)
  var logical := get_window().get_visible_rect().size
  return await wait_js("GodotMetrics.stats().window.width === %s && GodotMetrics.stats().window.height === %s" % [logical.x, logical.y], name)

func capture(stage: String) -> void:
  if not OS.get_cmdline_user_args().has("--capture"):
    return
  await RenderingServer.frame_post_draw
  verify(get_viewport().get_texture().get_image().save_png("res://build/metrics-" + stage + ".png") == OK, "Renderer capture saved: " + stage)

func _ready() -> void:
  original_size = get_window().size
  original_content_size = get_window().content_scale_size
  original_mode = get_window().content_scale_mode
  original_factor = get_window().content_scale_factor
  if not OS.get_cmdline_user_args().has("--validate"):
    return
  get_window().size = Vector2i(1000, 720)
  await frames()
  if not await wait_js("globalThis.GodotMetrics && GodotMetrics.stats().mounts === 1 && GodotMetrics.stats().hook !== null", "Registered MetricsPanel mounts through AppRegistry"):
    await finish()
    return
  verify_metrics("initial", 1)
  verify(is_equal_approx(native_probe_width(), 10), "Fabric initially rounds a 10.3-point edge to one-pixel content density")
  verify(native_state().get("nativeModules", {}).get("loaded", 0) > 0 and not native_state().get("windowListener", true), "Metrics initialize from original DeviceInfo without the legacy window callback")
  verify(subscription_count() == 2 and stats().get("publicListeners", 0) == 1, "Mounted hook and public listener own two tracked RN subscriptions")
  await capture("initial")
  application.call("evaluate", "GodotMetrics.setLocal(7)")
  if not await wait_js("GodotMetrics.stats().local === 7", "React local state updates before resizing"):
    await finish()
    return
  var events_before: int = stats().get("events", []).size()
  if not await resize(Vector2i(1100, 760), "Native resize reaches original Dimensions state"):
    await finish()
    return
  verify_metrics("resized", 1)
  var observed := stats()
  verify(observed.get("local", -1) == 7 and observed.get("mounts", 0) == 1, "Window resize preserves local state and component identity")
  verify(observed.get("events", []).size() > events_before, "didUpdateDimensions reaches the original RN public change listener")
  var events: Array = observed.get("events", [])
  verify(not events.is_empty() and close_size(events.back().get("window", {}), get_window().get_visible_rect().size, 1), "Public change callback carries the new application window metrics")
  await capture("resized")
  var commits_before: int = observed.get("commits", -1)
  var updates_before: int = native_state().get("viewportUpdates", -1)
  await frames(12)
  verify(stats().get("commits", -2) == commits_before and native_state().get("viewportUpdates", -2) == updates_before, "Unchanged native metrics cause no React rerenders or viewport updates")
  events_before = stats().get("events", []).size()
  application.call("evaluate", "GodotMetrics.publishEqualDimensions()")
  await frames()
  verify(stats().get("events", []).size() == events_before + 1 and stats().get("commits", -2) == commits_before, "Equal RN Dimensions values emit once without rerendering the hook")
  var unknown_event: Variant = js("GodotMetrics.unknownEventError()")
  verify(unknown_event is String and unknown_event.to_lower().contains("unknown event"), "Original Dimensions rejects unknown subscription events")
  application.call("evaluate", "GodotMetrics.unsubscribe(); GodotMetrics.unsubscribe()")
  verify(stats().get("publicListeners", -1) == 0 and subscription_count() == 1, "Public unsubscribe is idempotent and preserves only the hook subscription")
  events_before = stats().get("events", []).size()
  if not await resize(Vector2i(840, 640), "Hook remains responsive after public unsubscribe"):
    await finish()
    return
  verify(stats().get("events", []).size() == events_before and stats().get("local", -1) == 7, "Removed public listener receives no events while React state survives")
  panel.call("unmount")
  await frames()
  verify(subscription_count() == 0 and stats().get("cleanups", 0) == 1 and native_state().get("rootCount", -1) == 0, "Unmount removes every hook and public subscription while the application lives")
  if not await resize(Vector2i(960, 700), "Original Dimensions updates with no React roots or public listeners"):
    await finish()
    return
  verify_metrics("without-subscribers", 1, false)
  verify(subscription_count() == 0 and stats().get("events", []).size() == events_before, "Reading fresh Dimensions does not recreate subscriptions")
  verify(panel.call("mount"), "The same application remounts MetricsPanel")
  if not await wait_js("GodotMetrics.stats().mounts === 2 && GodotMetrics.stats().hook !== null", "Remounted hook reads current RN dimensions"):
    await finish()
    return
  verify_metrics("remounted", 1)
  verify(stats().get("local", -1) == 0 and subscription_count() == 2, "Remount starts fresh local state and owns fresh subscriptions")
  get_window().size = Vector2i(1280, 960)
  get_window().content_scale_size = Vector2i.ZERO
  get_window().content_scale_mode = Window.CONTENT_SCALE_MODE_CANVAS_ITEMS
  get_window().content_scale_factor = 2
  if not await wait_js("GodotMetrics.stats().pixelRatio === 2 && GodotMetrics.stats().hook.scale === 2", "Uniform canvas content scaling updates original PixelRatio and the hook"):
    await finish()
    return
  verify_metrics("scaled", 2)
  verify(is_equal_approx(native_probe_width(), 10.5), "Fabric pointScaleFactor follows content density when rounding native Control frames")
  var logical := get_window().get_visible_rect().size
  verify(logical.is_equal_approx(Vector2(get_window().size) / 2) and stats().get("rounded10Point3", -1) == 10.5, "Two physical pixels per point agree with Godot logical content and RN rounding")
  await capture("scaled")
  get_window().content_scale_factor = original_factor
  get_window().content_scale_size = original_content_size
  get_window().content_scale_mode = original_mode
  get_window().size = original_size
  if not await wait_js("GodotMetrics.stats().pixelRatio === 1 && GodotMetrics.stats().hook.scale === 1", "Restoring Godot content settings restores RN density"):
    await finish()
    return
  verify_metrics("restored", 1)
  verify(is_equal_approx(native_probe_width(), 10), "Restoring content density also restores Fabric edge rounding")
  await finish()

func finish() -> void:
  # Restore project settings even when a bounded wait failed. A failed check is
  # retained in the report; restoration never turns a failure into success.
  get_window().content_scale_factor = original_factor
  get_window().content_scale_size = original_content_size
  get_window().content_scale_mode = original_mode
  get_window().size = original_size
  await frames()
  var before_stop := native_state()
  application.call("stop")
  await frames()
  var after_stop := native_state()
  verify(subscription_count() == 0 and stats().get("publicListeners", -1) == 0, "Application shutdown releases all metric subscriptions")
  verify(after_stop.get("errors", []).is_empty() and after_stop.get("rootCount", -1) == 0 and after_stop.get("nativeModules", {}).get("stopped", false), "Metrics validation shuts down roots and native modules without host errors")
  verify(after_stop.get("pendingTimers", -1) == 0 and after_stop.get("pendingAnimationFrames", -1) == 0 and after_stop.get("pendingWork", -1) == 0, "Shutdown leaves no scheduling resources")
  var report := {"scenario": "metrics", "godot": Engine.get_version_info().string, "react": "19.2.3", "reactNative": "0.87.1", "engine": "hermes", "renderer": "fabric", "displayServer": DisplayServer.get_name(), "metricTransport": "NativeDeviceInfo + didUpdateDimensions", "checks": checks, "stages": stages, "beforeStop": before_stop, "afterStop": after_stop, "reactState": stats()}
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://build"))
  var output := FileAccess.open("res://build/report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_ERROR: Cannot write metrics report")
    get_tree().quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  print("FABRIC_VALIDATION_FAILED: metrics" if failed else "FABRIC_VALIDATION_PASSED: metrics " + str(checks.size()))
  get_tree().quit(1 if failed else 0)
