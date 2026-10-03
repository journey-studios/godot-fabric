extends Node
var checks: Array = []
var app: Node
var first: Control
var second: Control
var before_stop: Dictionary
var reentrant_calls := 0
var retained_during_stop := false
var root_retirement: Dictionary = {}
func check(value: bool, name: String) -> void:
  checks.append({"name": name, "passed": value})
  if not value: push_error("ADAPTER_CHECK_FAILED: " + name)
func frames() -> void:
  for i in range(10): await get_tree().process_frame
func data(owner: Node) -> Dictionary:
  return JSON.parse_string(owner.call("snapshot"))
func js(source: String) -> Variant:
  return JSON.parse_string(app.call("evaluate", "JSON.stringify(" + source + ")"))
func stats() -> Dictionary:
  return js("AdapterFixture.stats()")
func node(surface: Control, id: String) -> Dictionary:
  for value in data(surface).nodes:
    if value.testID == id: return value
  return {}
func root_pixels(image: Image, surface: Control) -> bool:
  # The graphical fixture uses unscaled content coordinates. Check paint that
  # would remain stale if only native identity/state assertions were observed.
  var origin := Vector2i(surface.global_position)
  if image.get_pixelv(origin + Vector2i(6, 6)).to_html(false) != "14213d": return false
  if image.get_pixelv(origin + Vector2i(22, 242)).to_html(false) != "2563eb": return false
  var white := 0
  for y in range(16, 43):
    for x in range(16, 455):
      var pixel := image.get_pixelv(origin + Vector2i(x, y))
      if pixel.r > 0.85 and pixel.g > 0.85 and pixel.b > 0.85: white += 1
  return white > 100
func capture(stage: String) -> void:
  if not OS.get_cmdline_user_args().has("--capture"): return
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  check(image.save_png("res://adapter-" + stage + ".png") == OK, "Rendered capture: " + stage)
  if stage.begins_with("root-"):
    check(root_pixels(image, second) and (not is_instance_valid(first) or first.call("get_surface_id") == 0 or root_pixels(image, first)), "Surviving roots paint their panel, title and core Button: " + stage)
func _ready() -> void:
  app = $Application/Runtime
  first = $First
  second = $Second
  if OS.get_cmdline_user_args().has("--external-appearance"): run_external_appearance()
  elif OS.get_cmdline_user_args().has("--root-remount-resize"): run_reentrant_root("resize", true)
  elif OS.get_cmdline_user_args().has("--root-unmount-resize"): run_reentrant_root("resize")
  elif OS.get_cmdline_user_args().has("--root-unmount-raf"): run_reentrant_root("raf")
  elif OS.get_cmdline_user_args().has("--root-unmount-timer"): run_reentrant_root("timer")
  elif OS.get_cmdline_user_args().has("--root-unmount-pressed"): run_reentrant_root("pressed")
  elif OS.get_cmdline_user_args().has("--root-free-resize"): run_reentrant_root("resize", false, true)
  elif OS.get_cmdline_user_args().has("--root-owner-switch-resize"): run_owner_switch_resize()
  elif OS.get_cmdline_user_args().has("--root-stale-core-owner-switch-resize"): run_owner_switch_resize(true)
  elif OS.get_cmdline_user_args().has("--reentrant-stop"): run_reentrant_stop("resize")
  elif OS.get_cmdline_user_args().has("--reentrant-raf"): run_reentrant_stop("raf")
  elif OS.get_cmdline_user_args().has("--reentrant-timer"): run_reentrant_stop("timer")
  else: run_probe()
func run_external_appearance() -> void:
  await frames()
  var button := first.find_child("first-a", true, false)
  check(button is Button and node(first,"first-a").adapter.count == 7, "Appearance fixture mounts original external Props on a real Button")
  if not button is Button: finish(); return
  var adapter_color := Color("#d97706")
  button.add_theme_color_override("font_color", adapter_color)
  check(button.has_theme_color_override("font_color") and button.get_theme_color("font_color") == adapter_color, "An external adapter can own its native font color")
  app.call("evaluate", "AdapterFixture.action('first','update')")
  await frames()
  check(button.has_theme_color_override("font_color") and button.get_theme_color("font_color") == adapter_color and node(first,"first-a").adapter.count == 18, "Generic ViewProps updates preserve the external adapter's font color")
  app.call("evaluate", "AdapterFixture.action('first','defaults'); AdapterFixture.action('first','resize')")
  await frames()
  check(button.has_theme_color_override("font_color") and button.get_theme_color("font_color") == adapter_color and node(first,"first-a").adapter.count == 0 and node(first,"first-a").height == 64, "Original prop defaults and layout changes preserve external font ownership")
  before_stop = data(app)
  app.call("stop")
  await frames()
  check(data(app).errors.is_empty() and stats().probe.disposals == stats().probe.creates and stats().cleanups == 2, "Appearance fixture releases both roots without host errors")
  finish()
func run_reentrant_stop(mode: String) -> void:
  await frames()
  var button := first.find_child("first-a",true,false)
  check(button is Button and not node(second,"second-a").is_empty(), "Reentrant-stop fixture has real external Controls in both roots")
  if not button is Button: finish(); return
  if mode != "resize": app.call("evaluate", "AdapterFixture.focus('first-a')")
  button.connect("resized" if mode == "resize" else "focus_exited", func():
    reentrant_calls += 1
    app.call("stop")
    # Do not reenter Hermes from its current Fabric commit. Native signals and
    # a host snapshot establish the immediate cancellation boundary directly.
    retained_during_stop = is_instance_valid(button) and data(app).stopRequested and data(app).rootCount == 2
    button.emit_signal("pressed")
    first.find_child("first-internal",true,false).emit_signal("pressed")
  )
  before_stop = data(app)
  if mode == "resize": app.call("evaluate", "AdapterFixture.action('first','resize')")
  else:
    var schedule := "requestAnimationFrame" if mode == "raf" else "setTimeout"
    app.call("evaluate", "globalThis.afterReentrantStop=0; " + schedule + "(()=>AdapterFixture.focus('first-b'),0); " + schedule + "(()=>globalThis.afterReentrantStop++,0)")
  await frames()
  check(reentrant_calls == 1, "A native signal synchronously requests application stop during " + mode)
  check(retained_during_stop, "Stop retires authority while preserving the Control until the emitting stack returns")
  var after := data(app)
  check(after.stopped and not after.stopRequested and after.rootCount == 0 and after.pendingWork == 0, "Deferred teardown completes once the outer execution stack unwinds")
  check(data(first).nodes.is_empty() and data(second).nodes.is_empty(), "Reentrant shutdown clears both external native trees")
  check(stats().probe.disposals == stats().probe.creates and stats().probe.stopped and stats().cleanups == 2, "Views, module providers and React effects dispose once on reentrant stop")
  check(stats().probe.rejected == 1 and stats().events.is_empty() and data(first).events == 0, "External and core pressed signals after the stop request cannot enqueue events")
  if mode != "resize": check(js("globalThis.afterReentrantStop") == 0, "Remaining " + mode + " callbacks do not execute after the stop request")
  check(after.errors.is_empty(), "Reentrant shutdown finishes without a host error")
  finish()
func run_reentrant_root(mode: String, remount: bool = false, free_host: bool = false) -> void:
  await frames()
  var a := node(first, "first-a")
  var b := node(first, "first-b")
  var c := node(second, "second-a")
  var button := first.find_child("first-a", true, false)
  var internal := first.find_child("first-internal", true, false)
  check(button is Button and internal is Button and not a.is_empty() and not b.is_empty() and not c.is_empty(), "Root-retirement fixture has real external and core Controls in two mounted roots")
  if not button is Button or not internal is Button or a.is_empty() or b.is_empty() or c.is_empty(): finish(); return
  var initial_app := data(app)
  var initial_first := data(first)
  var initial_second := data(second)
  root_retirement = {"mode":mode, "remount":remount, "freeHost":free_host, "initialApplication":initial_app,
    "initialSurfaceId":initial_first.surfaceId, "initialSurfaceGeneration":initial_first.surfaceGeneration,
    "hostInstanceId":initial_first.hostInstanceId}
  app.call("evaluate", "AdapterFixture.retain('first-a')")
  if mode == "raf" or mode == "timer":
    app.call("evaluate", "AdapterFixture.focus('first-a')")
    await frames()
  var signal_name := "resized" if mode == "resize" else ("pressed" if mode == "pressed" else "focus_exited")
  button.connect(signal_name, func():
    if reentrant_calls != 0: return
    reentrant_calls += 1
    if free_host: first.free()
    else: first.call("unmount")
    # Only native snapshots and signals are allowed on this stack. The resize
    # and focus callbacks can run inside Hermes/Fabric; pressed also tests a
    # Godot signal emitted outside any application execution scope.
    var application := data(app)
    root_retirement.requestedApplication = application
    root_retirement.retained = is_instance_valid(button) and is_instance_valid(internal)
    root_retirement.authorityRetired = application.pendingRootRetirements == 1 and application.rootCount == 2 and not application.stopped and not application.stopRequested
    var event_count := 0
    if free_host:
      root_retirement.authorityRetired = root_retirement.authorityRetired and not is_instance_valid(first)
      root_retirement.hostFreed = not is_instance_valid(first)
    else:
      var retiring := data(first)
      root_retirement.requestedSurface = retiring
      root_retirement.authorityRetired = root_retirement.authorityRetired and retiring.state == "retiring" and retiring.unmountRequested and retiring.surfaceGeneration == initial_first.surfaceGeneration
      event_count = retiring.events
    button.emit_signal("pressed")
    internal.emit_signal("pressed")
    if not free_host: root_retirement.blockedSignals = data(first).events == event_count
    if remount:
      root_retirement.mountAccepted = first.call("mount")
      root_retirement.remountRequestedSurface = data(first)
      root_retirement.retainedAfterMount = is_instance_valid(button) and is_instance_valid(internal)
  )
  await capture("root-initial")
  if mode == "resize": app.call("evaluate", "AdapterFixture.action('first','resize')")
  elif mode == "pressed": button.emit_signal("pressed")
  else:
    var schedule := "requestAnimationFrame" if mode == "raf" else "setTimeout"
    app.call("evaluate", "globalThis.afterRootUnmount=0; " + schedule + "(()=>AdapterFixture.focus('first-b'),0); " + schedule + "(()=>{AdapterFixture.action('second','update');globalThis.afterRootUnmount++;},0)")
  await frames()
  var after := data(app)
  var retired_stats := stats()
  root_retirement.completedApplication = after
  root_retirement.completedStats = retired_stats
  check(reentrant_calls == 1, "A native " + mode + " signal synchronously requests one root retirement")
  check(root_retirement.get("retained", false) and root_retirement.get("authorityRetired", false), "Root authority retires immediately while both emitting Controls remain valid")
  var signals_blocked: bool = retired_stats.events.is_empty() if free_host else root_retirement.get("blockedSignals", false)
  check(signals_blocked and retired_stats.probe.rejected == 1 and retired_stats.events.is_empty(), "External and core pressed signals cannot deliver queued events after root retirement")
  check(after.pendingRootRetirements == 0 and after.pendingWork == 0 and after.rootCount == (2 if remount else 1) and not after.stopped and not after.stopRequested, "Deferred root retirement completes without stopping application scheduling")
  check(not is_instance_valid(button) and not is_instance_valid(internal), "Old external and core Controls are deleted only after the native signal returns")
  check(retired_stats.probe.disposals == 2 and retired_stats.cleanups == 1 and retired_stats.lifecycle.first.cleanups == 1 and retired_stats.lifecycle.second.cleanups == 0, "Only the retired generation releases two views and one React effect")
  check(not after.nativeModules.stopped and not after.adapters.stopped and not retired_stats.probe.stopped and retired_stats.probe.modules == 1 and js("AdapterFixture.add()") == 5, "Shared original TurboModule remains live after one root retires")
  check(after.runtimeId == initial_app.runtimeId and after.bundleEvaluations == initial_app.bundleEvaluations and after.bundleEvaluations == 1, "Root retirement preserves the Hermes VM and its single bundle evaluation")
  var surviving := node(second, "second-a")
  check(surviving.id == c.id and surviving.tag == c.tag and surviving.mountId == c.mountId and data(second).surfaceId == initial_second.surfaceId and data(second).surfaceGeneration == initial_second.surfaceGeneration, "The other root preserves its surface, Control, Fabric tag and mount authority")
  var commands: int = stats().probe.commands
  var event_count: int = stats().events.size()
  check(js("AdapterFixture.fire(" + str(int(a.adapter.capturedIndex)) + ")") == false, "An emitter captured by the retired generation cannot enter the surviving application")
  app.call("evaluate", "AdapterFixture.staleFocus()")
  await frames()
  check(stats().probe.commands == commands and stats().events.size() == event_count, "A stale public ref cannot command or emit into the old or remounted generation")
  if mode == "raf" or mode == "timer":
    check(js("globalThis.afterRootUnmount") == 1, "The remaining shared " + mode + " callback executes for the surviving root")
  app.call("evaluate", "AdapterFixture.action('second','update')")
  await frames()
  surviving = node(second, "second-a")
  check(surviving.id == c.id and surviving.adapter.count == 18 and surviving.adapter.caption == "second a updated" and not surviving.adapter.enabled, "The surviving root continues applying React state updates")
  second.find_child("second-internal", true, false).emit_signal("pressed")
  await frames()
  var delivered: Array = stats().events
  check(delivered.size() == event_count + 1 and delivered[-1].panel == "second" and delivered[-1].kind == "core", "The surviving root continues delivering its core native callback")
  if remount:
    var fresh := node(first, "first-a")
    var fresh_b := node(first, "first-b")
    var requested: Dictionary = root_retirement.get("remountRequestedSurface", {})
    check(root_retirement.get("mountAccepted", false) and root_retirement.get("retainedAfterMount", false) and requested.get("surfaceId", 0) != initial_first.surfaceId and requested.get("surfaceId", 0) == data(first).surfaceId and requested.get("surfaceGeneration", 0) == data(first).surfaceGeneration and data(first).hostInstanceId == initial_first.hostInstanceId, "Same-host immediate remount keeps its new surface generation after old cleanup")
    check(not fresh.is_empty() and not fresh_b.is_empty() and fresh.id != a.id and fresh.tag != a.tag and fresh.mountId != a.mountId and fresh_b.id != b.id and fresh_b.tag != b.tag and fresh_b.mountId != b.mountId, "Immediate remount constructs fresh Controls, Fabric tags and mount identities")
    check(stats().probe.creates == 6 and stats().probe.disposals == 2 and stats().mounts == 3 and stats().lifecycle.first.mounts == 2 and stats().lifecycle.first.cleanups == 1 and stats().lifecycle.second.mounts == 1 and stats().probe.modules == 1, "Old cleanup runs exactly once while the new generation creates two views")
    app.call("evaluate", "AdapterFixture.action('first','update'); AdapterFixture.focus('first-a')")
    await frames()
    fresh = node(first, "first-a")
    check(fresh.adapter.count == 18 and fresh.adapter.caption == "first a updated" and not fresh.adapter.enabled and fresh.focused and stats().probe.commands == commands + 1 and node(second,"second-a").adapter.count == 18, "New-generation state and named Commands survive delayed old ref and effect cleanup")
    first.find_child("first-a", true, false).emit_signal("pressed")
    await frames()
    delivered = stats().events
    check(delivered.size() == event_count + 2 and delivered[-1].panel == "first" and delivered[-1].phase == 1 and delivered[-1].count == 18, "The remounted generation receives the latest original typed event")
    await capture("root-remounted")
  else:
    if free_host:
      check(root_retirement.get("hostFreed", false) and not is_instance_valid(first) and data(app).pendingRootRetirements == 0 and stats().probe.creates == 4 and stats().probe.disposals == 2 and stats().cleanups == 1, "A synchronously freed host stays absent after exactly one deferred retirement")
    else:
      first.call("unmount")
      await frames()
      check(data(first).state == "unmounted" and data(first).nodes.is_empty() and data(app).pendingRootRetirements == 0 and stats().probe.creates == 4 and stats().probe.disposals == 2 and stats().cleanups == 1, "Repeated root unmount is idempotent after deferred retirement")
    await capture("root-unmounted")
  app.call("evaluate", "AdapterFixture.unsubscribe()")
  before_stop = data(app)
  app.call("stop")
  await frames()
  var stopped := data(app)
  check(stopped.stopped and stopped.rootCount == 0 and stopped.pendingRootRetirements == 0 and stopped.pendingWork == 0 and stats().probe.disposals == stats().probe.creates and stats().cleanups == stats().mounts, "Final application stop releases every remaining generation exactly once")
  check(stopped.errors.is_empty(), "Per-root reentrant retirement completes without a host error")
  finish()
func run_owner_switch_resize(stale_core: bool = false) -> void:
  await frames()
  var a := node(first, "first-a")
  var c := node(second, "second-a")
  var button := first.find_child("first-a", true, false)
  var internal := first.find_child("first-internal", true, false)
  check(button is Button and internal is Button and not a.is_empty() and not c.is_empty(), "Owner-switch fixture starts with two real roots in the original application")
  if not button is Button or not internal is Button or a.is_empty() or c.is_empty(): finish(); return
  var initial_app := data(app)
  var initial_first := data(first)
  var initial_second := data(second)
  var old_core := node(first, "first-internal")
  # Reuse the SDK node and the project's existing application Resource. The
  # second Runtime is configured before the callback; its VM starts on mount.
  var wrapper := Node.new()
  wrapper.set_script($Application.get_script())
  wrapper.name = "OtherApplication"
  wrapper.set("application", $Application.get("application"))
  add_child(wrapper)
  var other_app: Node = wrapper.get_node("Runtime")
  root_retirement = {"mode":"stale-core-owner-switch-resize" if stale_core else "owner-switch-resize", "initialApplication":initial_app,
    "initialSurfaceId":initial_first.surfaceId, "initialSurfaceGeneration":initial_first.surfaceGeneration,
    "hostInstanceId":initial_first.hostInstanceId}
  if stale_core: root_retirement.oldCore = old_core
  app.call("evaluate", "AdapterFixture.retain('first-a')")
  button.connect("resized", func():
    if reentrant_calls != 0: return
    reentrant_calls += 1
    first.call("unmount")
    var retiring := data(first)
    var application := data(app)
    root_retirement.requestedSurface = retiring
    root_retirement.requestedApplication = application
    root_retirement.retained = is_instance_valid(button) and is_instance_valid(internal)
    root_retirement.authorityRetired = retiring.state == "retiring" and retiring.unmountRequested and application.pendingRootRetirements == 1 and application.rootCount == 2
    var event_count: int = retiring.events
    button.emit_signal("pressed")
    internal.emit_signal("pressed")
    root_retirement.blockedSignals = data(first).events == event_count
    first.set("application_path", NodePath("../OtherApplication/Runtime"))
    root_retirement.mountAccepted = first.call("mount")
    root_retirement.remountRequestedSurface = data(first)
    root_retirement.requestedOtherApplication = data(other_app)
    root_retirement.retainedAfterMount = is_instance_valid(button) and is_instance_valid(internal)
    if stale_core:
      # Queue the old Button before the original Runtime's ExecutionScope can
      # schedule retirement. No forced pump or Hermes reentry is needed: the
      # new owner processes its ordinary frame before this deferred signal.
      root_retirement.oldCoreRetainedBeforeDeferredSignal = is_instance_valid(internal)
      internal.call_deferred("emit_signal", "pressed")
      root_retirement.oldCoreSignalDeferred = true
  )
  await capture("root-initial")
  app.call("evaluate", "AdapterFixture.action('first','resize')")
  await frames()
  var after := data(app)
  var other_after := data(other_app)
  var retired_stats := stats()
  var fresh_stats: Dictionary = JSON.parse_string(other_app.call("evaluate", "JSON.stringify(AdapterFixture.stats())"))
  var fresh := node(first, "first-a")
  root_retirement.completedApplication = after
  root_retirement.completedOtherApplication = other_after
  root_retirement.completedStats = retired_stats
  root_retirement.completedOtherStats = fresh_stats
  check(reentrant_calls == 1 and root_retirement.get("authorityRetired", false), "Resize synchronously retires the old owner's root authority once")
  check(root_retirement.get("retained", false) and root_retirement.get("retainedAfterMount", false) and not is_instance_valid(button) and not is_instance_valid(internal), "Owner switch retains old Controls until the signal returns and then deletes them")
  check(root_retirement.get("blockedSignals", false) and retired_stats.probe.rejected == 1 and retired_stats.events.is_empty(), "Old-owner external and core signals cannot enqueue after retirement")
  check(after.pendingRootRetirements == 0 and after.rootCount == 1 and not after.stopped and other_after.rootCount == 1 and not other_after.stopped, "Both applications remain live with one independent root after owner switch")
  var requested: Dictionary = root_retirement.get("remountRequestedSurface", {})
  check(root_retirement.get("mountAccepted", false) and requested.get("surfaceId", 0) == initial_first.surfaceId and data(first).surfaceId == initial_first.surfaceId and data(first).runtimeId == other_after.runtimeId and other_after.runtimeId != initial_app.runtimeId and data(first).hostInstanceId == initial_first.hostInstanceId, "Late old cleanup preserves the same host's repeated root ID in its new runtime")
  check(not fresh.is_empty() and fresh.id != a.id and data(first).state == "mounted", "The new owner constructs a fresh native Control and completes its Fabric mount")
  check(after.runtimeId == initial_app.runtimeId and after.bundleEvaluations == 1 and other_after.bundleEvaluations == 1, "Each application evaluates the original bundle once in its own Hermes VM")
  check(retired_stats.probe.creates == 4 and retired_stats.probe.disposals == 2 and retired_stats.cleanups == 1 and fresh_stats.probe.creates == 2 and fresh_stats.probe.disposals == 0 and fresh_stats.cleanups == 0, "Only the old generation disposes while the new owner creates two views")
  check(retired_stats.probe.modules == 1 and fresh_stats.probe.modules == 1 and not retired_stats.probe.stopped and not fresh_stats.probe.stopped and js("AdapterFixture.add()") == 5 and JSON.parse_string(other_app.call("evaluate", "JSON.stringify(AdapterFixture.add())")) == 5, "The original generated TurboModule is isolated and live in each runtime")
  if stale_core:
    var new_core := node(first, "first-internal")
    root_retirement.newCore = new_core
    root_retirement.afterDeferredCoreSurface = data(first)
    check(root_retirement.get("oldCoreSignalDeferred", false) and root_retirement.get("oldCoreRetainedBeforeDeferredSignal", false) and old_core.tag == new_core.tag and old_core.id != new_core.id and data(first).surfaceId == initial_first.surfaceId and data(first).runtimeId != initial_first.runtimeId, "The retained old core Button defers its signal across repeated tags and root IDs in different runtimes")
    check(fresh_stats.events.is_empty() and data(first).events == 0, "An old deferred core Callable cannot deliver through the host's new application or repeated tag")
    first.find_child("first-internal", true, false).emit_signal("pressed")
    await frames()
    fresh_stats = JSON.parse_string(other_app.call("evaluate", "JSON.stringify(AdapterFixture.stats())"))
    root_retirement.afterFreshCoreStats = fresh_stats
    check(fresh_stats.events.size() == 1 and fresh_stats.events[0].panel == "first" and fresh_stats.events[0].kind == "core" and data(first).events == 1 and stats().events.is_empty(), "The new core Button still delivers exactly one event through its original current Callable")
  var commands: int = retired_stats.probe.commands
  check(js("AdapterFixture.fire(" + str(int(a.adapter.capturedIndex)) + ")") == false, "The retired owner's captured emitter cannot target the new runtime")
  app.call("evaluate", "AdapterFixture.staleFocus()")
  await frames()
  check(stats().probe.commands == commands and stats().events.is_empty() and node(first,"first-a").id == fresh.id, "The old runtime's retained public ref cannot command the new owner's Control")
  app.call("evaluate", "AdapterFixture.action('second','update')")
  other_app.call("evaluate", "AdapterFixture.action('first','update'); AdapterFixture.focus('first-a')")
  await frames()
  var surviving := node(second, "second-a")
  fresh = node(first, "first-a")
  fresh_stats = JSON.parse_string(other_app.call("evaluate", "JSON.stringify(AdapterFixture.stats())"))
  check(surviving.id == c.id and surviving.tag == c.tag and surviving.mountId == c.mountId and data(second).surfaceId == initial_second.surfaceId and surviving.adapter.count == 18, "The old owner's remaining root continues applying state without identity changes")
  check(fresh.adapter.count == 18 and fresh.adapter.caption == "first a updated" and fresh.focused and fresh_stats.probe.commands == 1 and data(first).runtimeId == other_after.runtimeId, "The new owner applies state and original named Commands after old completion")
  first.find_child("first-a", true, false).emit_signal("pressed")
  second.find_child("second-internal", true, false).emit_signal("pressed")
  await frames()
  fresh_stats = JSON.parse_string(other_app.call("evaluate", "JSON.stringify(AdapterFixture.stats())"))
  check(fresh_stats.events.size() == (2 if stale_core else 1) and fresh_stats.events[-1].panel == "first" and fresh_stats.events[-1].phase == 1 and stats().events.size() == 1 and stats().events[0].panel == "second", "Typed and core callbacks remain scoped to the correct owner after switching")
  await capture("root-owner-switched")
  app.call("evaluate", "AdapterFixture.unsubscribe()")
  before_stop = data(app)
  app.call("stop")
  await frames()
  check(data(app).stopped and data(app).rootCount == 0 and data(second).nodes.is_empty() and not data(other_app).stopped and data(first).state == "mounted" and data(first).surfaceId == initial_first.surfaceId and JSON.parse_string(other_app.call("evaluate", "JSON.stringify(AdapterFixture.add())")) == 5, "Stopping the old owner cannot retire the new owner's repeated root ID")
  other_app.call("evaluate", "AdapterFixture.unsubscribe()")
  other_app.call("stop")
  await frames()
  fresh_stats = JSON.parse_string(other_app.call("evaluate", "JSON.stringify(AdapterFixture.stats())"))
  root_retirement.stoppedOtherApplication = data(other_app)
  check(data(other_app).stopped and data(other_app).rootCount == 0 and data(first).nodes.is_empty() and stats().probe.disposals == stats().probe.creates and stats().cleanups == 2 and fresh_stats.probe.disposals == fresh_stats.probe.creates and fresh_stats.cleanups == 1, "Each owner tears down only its own remaining views and React effects once")
  check(data(app).pendingRootRetirements == 0 and data(other_app).pendingRootRetirements == 0 and data(app).pendingWork == 0 and data(other_app).pendingWork == 0 and data(app).errors.is_empty() and data(other_app).errors.is_empty(), "Cross-owner retirement completes without queued work or host errors")
  finish()
func run_probe() -> void:
  await frames()
  var a := node(first, "first-a")
  var b := node(first, "first-b")
  var c := node(second, "second-a")
  check(not a.is_empty() and not b.is_empty() and not c.is_empty(), "Original generated descriptor mounts real Godot Controls in both roots")
  if a.is_empty() or b.is_empty() or c.is_empty(): finish(); return
  check(data(first).runtimeId == data(second).runtimeId and data(first).surfaceId != data(second).surfaceId, "External components share one Hermes VM across independent Fabric roots")
  check(data(app).bundleEvaluations == 1 and data(app).adapterLoader.loadedImageUUIDsMatched and data(app).adapterLoader.loadedImageFilesMatchedReceipts, "Identified external library loads before one bundle evaluation")
  check(not data(app).adapterLoader.abiCertified and not data(app).adapterLoader.runtimeIdentityVerified, "Runtime witness does not claim ABI certification")
  check(data(app).adapters.sealed and data(app).adapters.moduleProvidersInstalled, "Selected providers are sealed and installed per application")
  check(a.kind == "ExternalBadge" and a.adapter.caption == "first a initial" and a.adapter.count == 7 and a.adapter.enabled, "Original Props reach the external adapter without core ControlProps casts")
  check(a.width == a.fabricWidth and a.height == 52 and a.fabricHeight == 52, "Yoga commits native geometry for the external Control")
  check(first.find_child("first-a", true, false) is Button, "The generated host component uses a real Godot Button")
  check(stats().probe.creates == 4 and stats().probe.modules == 1, "Factories run only for committed native views and one lazy TurboModule")
  check(js("AdapterFixture.add()") == 5, "Original generated CxxSpec runs a synchronous method in Hermes")
  app.call("evaluate", "AdapterFixture.describe(); AdapterFixture.retainMethod(); AdapterFixture.retain('first-a')")
  await frames()
  check(stats().promise.label == "original CxxSpec" and stats().promise.value == 42, "Original AsyncPromise resolves through the application CallInvoker")
  check(stats().results.size() == 1 and stats().results[0].value == 42, "Original Codegen EventEmitter delivers the TurboModule event once")
  first.find_child("first-a", true, false).emit_signal("pressed")
  await frames()
  check(stats().events.size() == 1 and stats().events[0].count == 7 and stats().events[0].label == "first a initial", "Native Button signal invokes the original typed component emitter once")
  check(data(first).events == 1 and data(second).events == 0, "Typed component delivery remains scoped to its committed root")
  await capture("initial")
  app.call("evaluate", "AdapterFixture.action('first','reorder'); AdapterFixture.focus('first-a')")
  await frames()
  check(node(first,"first-a").id == a.id and node(first,"first-b").id == b.id and stats().probe.creates == 4, "Keyed React reorder preserves native instance identity and factories")
  check(node(first,"first-a").mountId == a.mountId and node(first,"first-a").focused and stats().probe.commands == 1, "Original named Codegen Commands target the current external mount")
  app.call("evaluate", "AdapterFixture.action('first','update')")
  await frames()
  var updated := node(first,"first-a")
  check(updated.id == a.id and updated.adapter.count == 18 and updated.adapter.caption == "first a updated" and not updated.adapter.enabled, "Re-render updates immutable generated Props without recreating the Control")
  check(node(second,"second-a").adapter.count == 7, "An external prop update preserves the other root")
  check(js("AdapterFixture.fire(" + str(int(a.adapter.capturedIndex)) + ")") == true, "A retained native transport resolves the current committed emitter")
  await frames()
  check(stats().events.size() == 2 and stats().events[1].phase == 1 and stats().events[1].count == 18, "Typed event payload and React callback follow the latest render")
  check(js("AdapterFixture.fire(" + str(int(a.adapter.capturedIndex)) + ",true)") == false, "An off-thread callback cannot touch host maps or emit into React")
  check(stats().events.size() == 2, "Rejected off-thread delivery leaves the event count unchanged")
  app.call("evaluate", "AdapterFixture.action('first','defaults')")
  await frames()
  var defaults: Dictionary = node(first,"first-a").adapter
  check(defaults.caption == "" and defaults.count == 0 and defaults.enabled, "Removing props restores original Codegen defaults")
  await capture("updated")
  app.call("evaluate", "AdapterFixture.action('first','remove')")
  await frames()
  check(node(first,"first-a").is_empty() and stats().probe.disposals == 1, "React removal disposes the external callbacks before native Control deletion")
  check(js("AdapterFixture.fire(" + str(int(a.adapter.capturedIndex)) + ")") == false, "A captured transport loses authority when its mount is retired")
  app.call("evaluate", "AdapterFixture.staleFocus()")
  await frames()
  check(stats().probe.commands == 1 and stats().events.size() == 2, "A stale public ref cannot command a surviving native instance")
  second.call("unmount")
  await frames()
  check(data(second).nodes.is_empty() and stats().probe.disposals == 3 and stats().cleanups == 1, "An individual root teardown releases its external views and React effects")
  check(js("AdapterFixture.fire(" + str(int(c.adapter.capturedIndex)) + ")") == false, "A callback captured by an unmounted root cannot enter the live application")
  check(second.call("mount"), "The live application can remount a selected external component")
  await frames()
  var fresh := node(second,"second-a")
  check(fresh.id != c.id and fresh.tag != c.tag and fresh.mountId != c.mountId, "Remount obtains fresh Control, Fabric tag and host authority identity")
  check(stats().probe.creates == 6 and stats().probe.modules == 1 and data(app).bundleEvaluations == 1, "Remount reuses the module and bundle while constructing new views")
  app.call("evaluate", "AdapterFixture.unsubscribe()")
  before_stop = data(app)
  app.call("stop")
  await frames()
  check(data(first).nodes.is_empty() and data(second).nodes.is_empty() and data(app).rootCount == 0, "Application stop removes all remaining external native trees")
  check(data(app).adapters.stopped and data(app).nativeModules.stopped and data(app).pendingWork == 0, "Application stop retires selected module providers and native scheduling")
  check(js("AdapterFixture.oldAdd()") == -1 and String(js("AdapterFixture.stats().probeError")).contains("E_ADAPTER_STOPPED"), "An extracted generated method cannot mutate a disposed native module")
  check(data(app).errors.is_empty(), "Original component/module lifecycle completes without host errors")
  finish()
func finish() -> void:
  var report := {"format":"godot-fabric.experimental-adapter-runtime-witness/v1", "godot":Engine.get_version_info().string,
    "reactNative":"0.87.1", "displayServer":DisplayServer.get_name(), "checks":checks, "beforeStop":before_stop, "afterStop":data(app)}
  if not root_retirement.is_empty(): report.rootRetirement = root_retirement
  var out := FileAccess.open("res://adapter-report.json",FileAccess.WRITE)
  out.store_string(JSON.stringify(report,"  ")+"\n")
  var failed := checks.any(func(value: Dictionary) -> bool: return not value.passed)
  print("ADAPTER_RUNTIME_FAILED" if failed else "ADAPTER_RUNTIME_OK: " + str(checks.size()))
  get_tree().quit(1 if failed else 0)
