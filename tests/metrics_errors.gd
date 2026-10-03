extends SceneTree

const ERRORS := {
  "viewport": "Embedded windows and viewport stretch require a complete React Native metrics adapter",
  "nonuniform": "React Native window metrics require uniform positive Godot content scaling",
}
var checks: Array = []
var cases: Array = []
var original: Dictionary = {}

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

func frames(count: int = 8) -> void:
  for index in range(count):
    await process_frame

func data(node: Node) -> Dictionary:
  var value: Variant = JSON.parse_string(node.call("snapshot"))
  return value if value is Dictionary else {}

func js(app: Node, expression: String) -> Variant:
  return JSON.parse_string(app.call("evaluate", "JSON.stringify(" + expression + ")"))

func react(app: Node) -> Dictionary:
  var value: Variant = js(app, "GodotMetrics.stats()")
  return value if value is Dictionary else {}

func subscriptions(app: Node) -> int:
  var value: Variant = js(app, "GodotMetricsSubscriptionCount()")
  return int(value) if value is int or value is float else -1

func wait_js(app: Node, expression: String) -> bool:
  var deadline := Time.get_ticks_msec() + 5000
  while Time.get_ticks_msec() < deadline:
    if app.call("evaluate", "Boolean(" + expression + ")") == "true":
      await frames(4)
      return true
    await frames(1)
  return false

func restore_window() -> void:
  root.content_scale_factor = original.factor
  root.content_scale_size = original.contentSize
  root.content_scale_aspect = original.aspect
  root.content_scale_mode = original.mode
  root.size = original.size

func inject_invalid(mode: String) -> void:
  if mode == "viewport":
    root.content_scale_mode = Window.CONTENT_SCALE_MODE_VIEWPORT
  else:
    root.content_scale_mode = Window.CONTENT_SCALE_MODE_CANVAS_ITEMS
    root.content_scale_aspect = Window.CONTENT_SCALE_ASPECT_IGNORE
    # A --script headless Window begins at 64x64. A square target would preserve
    # its aspect ratio and produce uniform scaling. Derive a different aspect
    # from the actual physical window so x stretches twice as much as y.
    root.content_scale_size = Vector2i(maxi(1, roundi(root.size.x * 0.5)), maxi(1, root.size.y))

func window_geometry() -> Dictionary:
  var content_transform := root.get_final_transform() * root.get_global_canvas_transform().affine_inverse()
  var scale := content_transform.get_scale()
  return {"windowSize": [root.size.x, root.size.y], "visibleSize": [root.get_visible_rect().size.x, root.get_visible_rect().size.y], "contentSize": [root.content_scale_size.x, root.content_scale_size.y], "contentMode": root.content_scale_mode, "transformScale": [scale.x, scale.y]}

func native_local_is_seven(surface: Node) -> bool:
  for node in data(surface).get("nodes", []):
    if node.get("testID", "") == "metrics-local":
      return node.get("nativeText", "") == "Local React state: 7"
  return false

func run_case(mode: String, teardown: String) -> void:
  restore_window()
  await frames(2)
  var label := mode + "/" + teardown
  var owner := Node.new()
  owner.name = "MetricsFailureCase"
  root.add_child(owner)
  var app: Node = ClassDB.instantiate("FabricApplication")
  app.name = "Application"
  app.set_meta("scenario", "metrics")
  owner.add_child(app)
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = "Panel"
  surface.set("application_path", NodePath("../Application"))
  surface.set("component_name", "MetricsPanel")
  surface.size = Vector2(780, 540)
  owner.add_child(surface)
  var ready := await wait_js(app, "globalThis.GodotMetrics && GodotMetrics.stats().mounts === 1 && GodotMetrics.stats().hook !== null")
  if not check(ready and data(app).get("rootCount", 0) == 1 and subscriptions(app) == 2, "Live MetricsPanel owns a hook and public listener: " + label):
    app.call("stop")
    owner.queue_free()
    await frames()
    return
  var initial := data(app)
  check(initial.get("errors", []).is_empty() and initial.get("nativeModules", {}).get("loaded", 0) > 0, "Fresh runtime begins with valid metrics and native modules: " + label)
  inject_invalid(mode)
  await frames(12)
  var injected_geometry := window_geometry()
  var injected_scale: Array = injected_geometry.transformScale
  check((mode == "viewport" and root.content_scale_mode == Window.CONTENT_SCALE_MODE_VIEWPORT) or (mode == "nonuniform" and not is_equal_approx(float(injected_scale[0]), float(injected_scale[1]))), "Fixture applies the intended unsupported coordinate transform: " + label)
  var rejected := data(app)
  check(rejected.get("errors", []) == [ERRORS[mode]], "Invalid coordinate contract produces exactly one visible diagnostic: " + label)
  await frames(12)
  check(data(app).get("errors", []).size() == 1, "Repeated invalid samples do not flood diagnostics: " + label)
  check(rejected.get("dimensions", {}) == initial.get("dimensions", {}) and rejected.get("viewportUpdates", -1) == initial.get("viewportUpdates", -2), "Rejected metrics preserve the last valid RN Dimensions state: " + label)
  app.call("evaluate", "GodotMetrics.setLocal(7)")
  var delivered := await wait_js(app, "GodotMetrics.stats().local === 7")
  check(delivered and native_local_is_seven(surface), "Metrics failure does not starve React state or native commits: " + label)
  var after_unmount: Dictionary = {}
  if teardown == "unmount":
    # Exercise the original starvation path without entering application stop:
    # unmount pumps React cleanup while the metrics getter remains invalid.
    surface.call("unmount")
    await frames()
    after_unmount = data(app)
    check(subscriptions(app) == 0 and react(app).get("publicListeners", -1) == 0 and react(app).get("cleanups", 0) == 1, "Partial unmount releases hook and public subscriptions under invalid metrics: " + label)
    var retired := data(surface)
    check(after_unmount.get("rootCount", -1) == 0 and not after_unmount.get("stopped", true) and retired.get("nodes", []).is_empty() and retired.get("nativeTags", -1) == 0 and retired.get("creates", -1) == retired.get("deletes", -2), "Partial unmount retires every Control without stopping the application: " + label)
  else:
    check(subscriptions(app) == 2 and react(app).get("cleanups", -1) == 0, "Direct-stop case retains live React effects before shutdown: " + label)
  # Prove shutdown clears real scheduling resources, not already-empty queues.
  app.call("evaluate", "globalThis.metricsErrorTimer=setInterval(()=>{},10000); globalThis.metricsErrorFrame=requestAnimationFrame(()=>{})")
  var before_stop := data(app)
  check(before_stop.get("pendingTimers", 0) > 0 and before_stop.get("pendingAnimationFrames", 0) > 0, "Application has real timers and frame callbacks before stop: " + label)
  app.call("stop")
  await frames()
  var stopped := data(app)
  check(subscriptions(app) == 0 and react(app).get("publicListeners", -1) == 0 and react(app).get("cleanups", 0) == 1, "Stop delivers React cleanup exactly once despite invalid metrics: " + label)
  var modules: Dictionary = stopped.get("nativeModules", {})
  check(stopped.get("stopped", false) and stopped.get("rootCount", -1) == 0 and modules.get("stopped", false) and modules.get("loaded", -1) == 0, "Stop releases every root and native module authority: " + label)
  check(stopped.get("pendingTimers", -1) == 0 and stopped.get("pendingAnimationFrames", -1) == 0 and stopped.get("pendingWork", -1) == 0, "Stop drains React work and cancels native scheduling: " + label)
  check(stopped.get("errors", []) == [ERRORS[mode]], "Shutdown preserves the one original diagnostic without resampling: " + label)
  app.call("stop")
  await frames()
  var repeated := data(app)
  check(repeated == stopped and subscriptions(app) == 0 and react(app).get("cleanups", 0) == 1, "Repeated stop preserves the finalized state and cleanup count: " + label)
  cases.append({"mode": mode, "teardown": teardown, "initial": initial, "injectedGeometry": injected_geometry, "afterError": rejected, "afterUnmount": after_unmount, "beforeStop": before_stop, "afterStop": repeated, "react": react(app), "subscriptions": subscriptions(app)})
  owner.queue_free()
  await frames(2)
  restore_window()
  await frames(2)

func _initialize() -> void:
  call_deferred("run_probe")

func run_probe() -> void:
  original = {"size": root.size, "contentSize": root.content_scale_size, "mode": root.content_scale_mode, "aspect": root.content_scale_aspect, "factor": root.content_scale_factor}
  for mode in ["viewport", "nonuniform"]:
    for teardown in ["unmount", "stop"]:
      await run_case(mode, teardown)
  restore_window()
  var report := {"scenario": "metrics-errors", "engine": "hermes", "renderer": "fabric", "godot": Engine.get_version_info().string, "reactNative": "0.87.1", "displayServer": DisplayServer.get_name(), "checks": checks, "cases": cases}
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://build"))
  var output := FileAccess.open("res://build/metrics-errors-report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_CHECK_FAILED: Cannot publish metrics failure report")
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  var failed := cases.size() != 4 or checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  print("METRICS_ERRORS_FAILED" if failed else "METRICS_ERRORS_PASSED")
  quit(1 if failed else 0)
