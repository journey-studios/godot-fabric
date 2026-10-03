extends Node
var checks: Array = []
var app: Node
var first: Control
var second: Control
var before_stop: Dictionary
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
func capture(stage: String) -> void:
  if not OS.get_cmdline_user_args().has("--capture"): return
  await RenderingServer.frame_post_draw
  check(get_viewport().get_texture().get_image().save_png("res://adapter-" + stage + ".png") == OK, "Rendered capture: " + stage)
func _ready() -> void:
  app = $Application/Runtime
  first = $First
  second = $Second
  run_probe()
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
  var out := FileAccess.open("res://adapter-report.json",FileAccess.WRITE)
  out.store_string(JSON.stringify(report,"  ")+"\n")
  var failed := checks.any(func(value: Dictionary) -> bool: return not value.passed)
  print("ADAPTER_RUNTIME_FAILED" if failed else "ADAPTER_RUNTIME_OK: " + str(checks.size()))
  get_tree().quit(1 if failed else 0)
