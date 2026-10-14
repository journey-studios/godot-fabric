extends SceneTree

# GF-05 slice B. The host defines neither performance nor console: the bundle starts with RN's console polyfill (Metro runs it before any
# module; the build injects it) and RN's own setUpGlobals, setUpDOM, setUpPerformance and setUpNavigator build the rest of the JavaScript
# environment. This probe runs the bundle in the actual Hermes runtime of an actual FabricApplication, mounts one root and reads what
# the fixture recorded: the host's state before the first line of the bundle, the globals, the performance clock against the host's and
# Godot's own, and the console's messages and levels as they reach the host's logging hook. tests/js-globals-oracle.mjs re-derives every
# verdict from RN's sources.
var application: Node
var surface: Control
var checks: Array = []
var stages := {}
var expected_original_failures: Array = []
var allow_original_negative := false
var sabotage := false
var bundle_file := "js-globals-probe.js"

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

# A normative check needs what this slice changed in the host: the host that defined a performance stub with only now and a console of
# three functions before any JS ran must fail exactly these checks, while the same bundle holds every other one.
func host_check(condition: bool, name: String) -> bool:
  expected_original_failures.append(name)
  return check(condition, name)

func settle(count := 6) -> void:
  for index in range(count):
    await process_frame

func js(expression: String) -> Variant:
  return JSON.parse_string(str(application.call("evaluate", "JSON.stringify(" + expression + ")")))

func native() -> Dictionary:
  return JSON.parse_string(application.call("snapshot"))

# performance.now() between the two reads of the host clock that bracket it: the same call in every sample, so no sample is exempt.
func bracketed(samples: Array) -> bool:
  if samples.is_empty():
    return false
  for entry: Dictionary in samples:
    if entry.now == null or entry.before > entry.now or entry.now > entry.after:
      return false
  return true

# Never backward from one sample to the next, and the last is later than the first. How many frames came, and how far apart, is the
# pacing of the machine and is not judged.
func moves_forward(samples: Array) -> bool:
  if samples.size() < 2 or samples.any(func(entry: Dictionary) -> bool: return entry.now == null):
    return false
  for index in range(1, samples.size()):
    if samples[index].now < samples[index - 1].now:
      return false
  return samples[samples.size() - 1].now > samples[0].now

# The call of the scenario to console.<method> whose first argument is `first`, with what it sent the host's hook.
func call_of(per_call: Array, method: String, first: Variant) -> Dictionary:
  for entry: Dictionary in per_call:
    if entry.method == method and entry.args.size() > 0 and entry.args[0] == first:
      return entry
  return {}

# That call sent exactly one message to the hook, with this text and at this level.
func sends(per_call: Array, method: String, first: Variant, message: String, level: int) -> bool:
  var entry := call_of(per_call, method, first)
  return (not entry.is_empty() and entry.threw == null and entry.logged.size() == 1 and entry.logged[0].message == message
    and int(entry.logged[0].level) == level)

func sends_nothing(per_call: Array, method: String, first: Variant) -> bool:
  var entry := call_of(per_call, method, first)
  return not entry.is_empty() and entry.threw == null and entry.logged.is_empty()

func check_host() -> void:
  var host: Dictionary = js("JsGlobalsHost")
  var first: Dictionary = js("JsGlobalsEarly.atFirstModule")
  var early: Array = js("JsGlobalsEarly.logged")
  stages.host = host
  stages.first = first
  stages.early = early
  host_check(host.console == "undefined" and host.performance == "undefined",
    "host/The host defines neither performance nor console before the first line of the bundle")
  check((host.nativeLoggingHook == "function" and host.nativePerformanceNow == "function" and host.globalIsGlobalThis == true
    and host.dev == false),
    "host/The host binds nativeLoggingHook and nativePerformanceNow and sets global and __DEV__")
  check((first.console == "object" and first.polyfilled == true and first.window == "undefined" and first.process == "undefined"
    and first.navigator == "undefined"),
    "first/RN's console polyfill has run when the first module of the bundle starts, and no setup module of RN has")
  check(early.size() >= 1 and early[0].message == "'first', 'module', 1" and int(early[0].level) == 1,
    "first/The first line the bundle logs reaches the host's hook in RN's format at the info level")

func check_globals(env: Dictionary) -> void:
  var window_descriptor: Variant = env.window.descriptor
  check((env.global == true and env.window.sameAsGlobal == true and env.self.sameAsGlobal == true and window_descriptor != null
    and window_descriptor.writable == false and window_descriptor.configurable == false),
    "globals/window and self are the global object, and window is RN's fixed property")
  check(env.process.type == "object" and env.process.envType == "object" and env.process.nodeEnv == "production",
    "globals/process.env.NODE_ENV is production at run time")
  var navigator_descriptor: Variant = env.navigator.descriptor
  check((env.navigator.product == "ReactNative" and navigator_descriptor != null and navigator_descriptor.writable == false
    and navigator_descriptor.configurable == true),
    "globals/navigator.product is ReactNative, on the property RN defines")

func check_performance(env: Dictionary) -> void:
  var performance_state: Dictionary = env.performance
  var members := ["clearMarks", "clearMeasures", "mark", "measure", "now"]
  host_check((performance_state.type == "object" and performance_state.ownKeys == members
    and members.all(func(member: String) -> bool: return performance_state.members.get(member) == "function")),
    "performance/performance has RN's five members and no other")
  host_check((performance_state.calls.size() == 4
    and performance_state.calls.values().all(func(result: Dictionary) -> bool: return result.threw == false and result.type == "undefined")),
    "performance/mark, measure, clearMarks and clearMeasures return without throwing")
  # Two reads of Godot's own clock bracket each read of JS's, so what the two clocks advanced between the reads is compared in the
  # engine's time and not in the host's.
  var a_before := Time.get_ticks_usec()
  var sample_a: Dictionary = js("JsGlobalsProbe.sample()")
  var a_after := Time.get_ticks_usec()
  var frames_wanted := int(js("JsGlobalsProbe.clockFrames"))
  application.call("evaluate", "JsGlobalsProbe.startClock(%d)" % frames_wanted)
  var frames: Array = []
  var deadline := Time.get_ticks_msec() + 20000
  while Time.get_ticks_msec() < deadline and frames.size() < frames_wanted:
    await process_frame
    frames = js("JsGlobalsProbe.clock()")
  var b_before := Time.get_ticks_usec()
  var sample_b: Dictionary = js("JsGlobalsProbe.sample()")
  var b_after := Time.get_ticks_usec()
  stages.clock = {"frames": frames, "framesWanted": frames_wanted, "a": sample_a, "b": sample_b,
    "godot": {"aBefore": a_before, "aAfter": a_after, "bBefore": b_before, "bAfter": b_after}}
  var all_samples := [sample_a] + frames + [sample_b]
  check(bracketed(all_samples) and frames.size() == frames_wanted,
    "performance/now() reads the host clock: it falls between two nativePerformanceNow() reads in every sample")
  check(moves_forward(all_samples), "performance/now() never goes backward from one sample to the next, and moves forward")
  var advanced := -1.0
  var lowest := 0.0
  var highest := 0.0
  if sample_a.now != null and sample_b.now != null:
    advanced = float(sample_b.now) - float(sample_a.now)
    # Each read of JS's clock happened between the two reads of Godot's around it; a millisecond covers the microsecond rounding.
    lowest = (b_before - a_after) / 1000.0 - 1.0
    highest = (b_after - a_before) / 1000.0 + 1.0
  check(advanced >= 0.0 and advanced >= lowest and advanced <= highest,
    "performance/now() advances as much as Godot's own clock did between two reads")

func check_dom(env: Dictionary) -> void:
  var dom: Dictionary = env.dom
  check((dom.names.size() == 14
    and dom.names.all(func(name: String) -> bool: return dom.lazyBeforeUse.get(name) == true and dom.resolved.get(name) == "function")),
    "dom/RN's 14 DOM globals are lazy getters until first used, and classes after")
  var dispatch: Dictionary = env.domDispatch
  check((dispatch.type == "function" and dispatch.result != null and dispatch.result.threw == false and dispatch.result.type == "boolean"),
    "dom/RN$isNativeEventTargetEventDispatchingEnabled is a function that answers a boolean")

func check_console(env: Dictionary) -> void:
  # The polyfill's members, and the one that RN's setUpErrorHandling adds since slice C: ExceptionsManager.installConsoleErrorReporter
  # keeps the polyfill's console.error as console._errorOriginal.
  var names := ["_errorOriginal", "_isPolyfilled", "assert", "count", "countReset", "createTask", "debug", "error", "group", "groupCollapsed",
    "groupEnd", "info", "log", "table", "time", "timeEnd", "timeStamp", "trace", "warn"]
  var kinds: Dictionary = env.console.kinds
  check((env.console.type == "object" and env.console.names == names and env.console.polyfilled == true
    and names.all(func(name: String) -> bool: return kinds.get(name) == ("boolean" if name == "_isPolyfilled" else "function"))
    and env.console.task != null and env.console.task.threw == false and int(env.console.task.value) == 7),
    "console/console has the members of RN's polyfill, and createTask runs its callback")
  var scenario: Dictionary = js("JsGlobalsProbe.consoleScenario()")
  var per_call: Array = scenario.perCall
  stages.console = scenario
  check(per_call.all(func(entry: Dictionary) -> bool: return entry.threw == null),
    "console/Every call of the scenario runs without throwing")
  check(sends(per_call, "log", "one string", "one string", 1) and sends(per_call, "log", "A", "'A', 'B'", 1),
    "console/A lone string is logged as it is, and log(\"A\", \"B\") as 'A', 'B', at the info level")
  check((sends(per_call, "info", "count", "'count', 3, true, null", 1) and sends(per_call, "debug", "debug", "debug", 0)
    and sends(per_call, "trace", "trace", "'trace', 0", 0) and sends(per_call, "warn", "warn", "'warn', 2", 2)
    and sends(per_call, "error", "error", "'error', 3", 3)
    and sends(per_call, "error", "Warning: reported as a warning", "'Warning: reported as a warning', 1", 2)),
    "console/info, debug, trace, warn and error carry RN's levels, and an error that starts with \"Warning: \" is a warning")
  check(sends(per_call, "assert", false, "Assertion failed: boom", 3) and sends_nothing(per_call, "assert", true),
    "console/assert(false, \"boom\") logs \"Assertion failed: boom\" at the error level, and assert(true) logs nothing")
  check((["time", "timeEnd", "timeStamp"].all(func(method: String) -> bool: return sends_nothing(per_call, method, "t"))
    and ["count", "countReset"].all(func(method: String) -> bool: return sends_nothing(per_call, method, "c"))),
    "console/time, timeEnd, timeStamp, count and countReset are RN's silent stubs")

func _initialize() -> void:
  var arguments := OS.get_cmdline_user_args()
  allow_original_negative = arguments.has("--allow-original-negative")
  sabotage = arguments.has("--sabotage")
  for argument: String in arguments:
    if argument.begins_with("--bundle="):
      bundle_file = argument.trim_prefix("--bundle=")
  call_deferred("run_probe")

func run_probe() -> void:
  root.size = Vector2i(320, 80)
  application = ClassDB.instantiate("FabricApplication")
  application.name = "JsGlobalsApplication"
  application.set("bundle_path", "res://build/" + bundle_file)
  root.add_child(application)
  surface = ClassDB.instantiate("FabricSurface")
  surface.name = "JsGlobalsRoot"
  surface.size = Vector2(140, 60)
  surface.set("application_path", NodePath("../JsGlobalsApplication"))
  surface.set("component_name", "JsGlobalsApp")
  root.add_child(surface)
  # The root mounts when Hermes has evaluated the bundle and run the component: wait for it, whatever the pace of the machine's frames.
  var waited := 0
  while int(native().rootCount) < 1 and waited < 600:
    await process_frame
    waited += 1
  await settle()
  var app := native()
  stages.mount = {"application": app, "surfaceId": surface.call("get_surface_id")}
  check(int(app.rootCount) == 1 and int(surface.call("get_surface_id")) > 0 and app.errors.is_empty(),
    "mount/A root mounts through the original AppRegistry in the Hermes application the bundle ran in")
  check_host()
  var env: Dictionary = js("JsGlobalsProbe.environment()")
  stages.environment = env
  check_globals(env)
  await check_performance(env)
  check_dom(env)
  check_console(env)
  application.call("stop")
  await settle()
  var stopped := native()
  var root_state: Dictionary = JSON.parse_string(surface.call("snapshot"))
  check(stopped.stopped and int(stopped.rootCount) == 0 and stopped.errors.is_empty(),
    "lifecycle/Stop releases the root without a diagnostic")
  check(int(root_state.nativeTags) == 0 and int(root_state.creates) == int(root_state.deletes),
    "lifecycle/All native Controls of the root are balanced")
  stages.stop = {"application": stopped, "root": root_state}
  await finish()

func finish() -> void:
  surface.queue_free()
  application.queue_free()
  await settle(2)
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var observed := failures.duplicate()
  var expected := expected_original_failures.duplicate()
  observed.sort()
  expected.sort()
  var original_negative_observed := allow_original_negative and observed == expected and not failures.is_empty()
  var sabotage_observed := sabotage and not failures.is_empty()
  var report := {"scenario": "native-js-globals", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "bundle": bundle_file, "checks": checks, "stages": stages,
    "expectedOriginalFailures": expected_original_failures, "allowOriginalNegative": allow_original_negative,
    "originalNegativeObserved": original_negative_observed, "sabotage": sabotage,
    "allCurrentAssertionsPassed": failures.is_empty(),
    "scope": {"actualHermesRuntime": true, "actualFabricApplication": true, "rnSetupModules": ["setUpGlobals", "setUpDOM", "setUpPerformance",
      "setUpNavigator"], "metroConsolePolyfill": true, "webPerformanceClassesCertified": false, "errorPathCertified": false}}
  var output := FileAccess.open("res://build/js-globals-report.json", FileAccess.WRITE)
  if not check(output != null, "report/The JS globals report is saved with any normative failure visible"):
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  output.close()
  if original_negative_observed:
    print("JS_GLOBALS_ORIGINAL_NEGATIVE: " + str(failures.size()))
  elif sabotage_observed:
    print("JS_GLOBALS_SABOTAGE_REJECTED: " + str(failures.size()))
  elif failures.is_empty():
    print("JS_GLOBALS_PASSED: " + str(checks.size()))
  else:
    print("JS_GLOBALS_FAILED")
  quit(0 if failures.is_empty() or original_negative_observed or sabotage_observed else 1)
