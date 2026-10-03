extends SceneTree

var checks: Array = []
var applications: Array[Node] = []
var surfaces: Array[Control] = []

func check(condition: bool, name: String) -> void:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)

func frames(count := 8) -> void:
  for index in range(count):
    await process_frame

func state(application: Node) -> Dictionary:
  return JSON.parse_string(application.call("snapshot"))

func report(application: Node, native := true) -> Dictionary:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(NativeModuleFixture." + ("stats" if native else "report") + "())"))

func make_application(label: String) -> Node:
  var application: Node = ClassDB.instantiate("FabricApplication")
  application.name = label
  application.set_meta("scenario", "modules")
  root.add_child(application)
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = label + "Root"
  surface.set("application_path", NodePath("../" + label))
  surface.set("component_name", "NativeModulesFixture")
  surface.size = Vector2(320, 200)
  root.add_child(surface)
  applications.append(application)
  surfaces.append(surface)
  return application

func _initialize() -> void:
  call_deferred("run_probe")

func run_probe() -> void:
  var first := make_application("FirstModuleApplication")
  var second := make_application("SecondModuleApplication")
  await frames()
  check(surfaces.all(func(surface: Control): return surface.call("get_surface_id") > 0), "Both module fixtures mount through original AppRegistry")
  check(state(first).errors.is_empty() and state(second).errors.is_empty(), "Both native-module runtimes initialize without host errors")
  check(report(first).constants.runtimeId != report(second).constants.runtimeId, "Separate applications own different native module instances and runtime identities")
  for application in applications:
    check(report(application).sourceCode.scriptURL == application.call("get_bundle_path"), "SourceCode reports the exact bundle URL evaluated by this application: " + application.name)
  for application in applications:
    application.call("evaluate", "NativeModuleFixture.afterDelivery()")
    application.call("invoke_callable", "GodotFabricFixtureCallable", "accept", [31])
    application.call("invoke_callable", "GodotFabricFixtureCallable", "accept", [32])
  await frames()
  for application in applications:
    application.call("evaluate", "NativeModuleFixture.afterRemoval()")
  first.call("evaluate", "NativeModuleFixture.setValue(41)")
  await frames()
  check(report(first).native.value == 41 and report(second).native.value == 13, "Mutating one native module leaves the other runtime's state unchanged")
  check(state(first).nativeModules.callableCalls == 2 and state(second).nativeModules.callableCalls == 2, "Native callable-module routing preserves per-runtime ownership")

  # Dispose one fixture while its Promise/event are queued. Its RN callbacks
  # must reject or be invalidated according to the module's native lifetime.
  first.call("evaluate", "NativeModuleFixture.dispose()")
  await frames()
  first.call("evaluate", "NativeModuleFixture.afterDisposal()")
  var javascript: Array = report(first, false).checks + report(second, false).checks
  checks.append_array(javascript)
  var before := {"first": state(first), "second": state(second)}
  check(before.first.nativeModules.fixture.disposals == 1 and not before.first.nativeModules.fixture.active, "Repeated explicit disposal closes the native module once")
  for application in applications:
    application.call("stop")
    application.call("stop")
  await frames()
  var after := {"first": state(first), "second": state(second)}
  for label in ["first", "second"]:
    var stopped: Dictionary = after[label]
    check(stopped.nativeModules.stopped and stopped.nativeModules.loaded == 0 and stopped.nativeModules.callableModules == 0, "Shutdown releases module caches and callable factories: " + label)
    check(stopped.nativeModules.fixture.disposals == 1 and stopped.nativeModules.fixture.listeners == 0, "Shutdown disposes each native module and clears listener counts exactly once: " + label)
    check(stopped.rootCount == 0 and stopped.errors.is_empty(), "Runtime shutdown preserves visible error accounting and releases all roots: " + label)
  var stale: String = first.call("evaluate", "(() => { try { NativeModuleFixture.setValue(70); return 'unexpected'; } catch (error) { return error.message; } })()")
  check(stale.contains("E_MODULE_DISPOSED"), "A retained native method cannot reenter a stopped runtime generation")
  var extracted: String = first.call("evaluate", "(() => { try { NativeModuleFixture.retainedMethod(); return 'unexpected'; } catch (error) { return error.message; } })()")
  check(extracted.contains("E_MODULE_DISPOSED"), "An extracted TurboModule method remains safe after cache disposal")
  var source_code: String = first.call("evaluate", "(() => { try { NativeModuleFixture.retainedSourceCodeMethod(); return 'unexpected'; } catch (error) { return error.message; } })()")
  check(source_code.contains("E_MODULE_DISPOSED"), "An extracted SourceCode method cannot access its disposed application URL getter")
  var output := FileAccess.open("res://build/native-modules-report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_ERROR: cannot publish native modules report")
    quit(1)
    return
  output.store_string(JSON.stringify({"scenario": "modules", "engine": "hermes", "renderer": "fabric", "godot": Engine.get_version_info().string, "reactNative": "0.87.1", "checks": checks, "beforeStop": before, "afterStop": after}, "  ") + "\n")
  for surface in surfaces:
    surface.queue_free()
  for application in applications:
    application.queue_free()
  await frames(2)
  var failed := checks.any(func(entry: Dictionary): return not entry.passed)
  print("NATIVE_MODULES_FAILED" if failed else "NATIVE_MODULES_PASSED: " + str(checks.size()))
  quit(1 if failed else 0)
