extends SceneTree

# Godot's platform layers report OS lifecycle events by calling
# MainLoop.notification() on the running main loop: macOS
# applicationDidResignActive/applicationDidBecomeActive, Windows WM_ACTIVATEAPP,
# X11 focus, Android onPause/onResume and the iOS resign, background, foreground
# and memory-warning delegates. This probe makes that same call on the actual
# main loop, and SceneTree._notification propagates each notification to every
# node exactly as for a real OS event, including the actual FabricApplication.
# Two roots of that application observe RN's original AppState through the
# public react-native import.
const IN := Node.NOTIFICATION_APPLICATION_FOCUS_IN
const OUT := Node.NOTIFICATION_APPLICATION_FOCUS_OUT
const PAUSED := Node.NOTIFICATION_APPLICATION_PAUSED
const RESUMED := Node.NOTIFICATION_APPLICATION_RESUMED
const MEMORY := Node.NOTIFICATION_OS_MEMORY_WARNING
const NAMES := {IN: "focusIn", OUT: "focusOut", PAUSED: "paused", RESUMED: "resumed", MEMORY: "memoryWarning"}
const EVENTS := ["change", "memoryWarning", "focus", "blur"]

var application: Node
var surfaces := {}
var checks: Array = []
var stages := {}
var expected_original_failures: Array = []
var allow_original_negative := false
var delivered := {"focusIn": 0, "focusOut": 0, "paused": 0, "resumed": 0, "memoryWarning": 0}
var emitted := {"change": 0, "focus": 0, "blur": 0, "memoryWarning": 0}
# Who listens to each AppState event, in subscription order. The library
# subscribed at bundle evaluation; each root subscribes in its effect.
var listening := {"change": ["library"], "memoryWarning": ["library"], "focus": ["library"], "blur": ["library"]}
# The state JS last received, and the application's focus and pause flags.
var state := "active"
var app_focused := true
var app_paused := false

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

# A normative check needs the native lifecycle: an emitted event, the native
# state or the AppState module. The preceding host has none of them, so it
# must fail exactly these checks.
func lifecycle_check(condition: bool, name: String) -> bool:
  expected_original_failures.append(name)
  return check(condition, name)

func settle(count := 6) -> void:
  for index in range(count):
    await process_frame

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(AppStateProbe." + expression + ")"))

func native() -> Dictionary:
  return JSON.parse_string(application.call("snapshot"))

func lifecycle() -> Dictionary:
  var value: Variant = native().get("appState", {})
  return value if value is Dictionary else {}

func deliver(what: int) -> void:
  # The exact call the platform layers make: OS::get_main_loop()->notification().
  Engine.get_main_loop().notification(what)
  delivered[NAMES[what]] += 1

func mount(name: String) -> void:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = name
  surface.position = Vector2(0 if name == "A" else 160, 0)
  surface.size = Vector2(140, 60)
  surface.set("application_path", NodePath("../AppStateApplication"))
  surface.set("component_name", "AppStateProbe")
  surface.set("initial_props", {"name": name})
  surfaces[name] = surface
  root.add_child(surface)
  for event: String in EVENTS:
    listening[event].append(name)
  await settle()

# The state RN derives: iOS reports inactive between WillResignActive and
# DidBecomeActive and background between DidEnterBackground and
# WillEnterForeground; Godot sends FOCUS_OUT and PAUSED for those transitions.
func derived() -> String:
  return "background" if app_paused else "active" if app_focused else "inactive"

# What the native module must emit for one notification, in order: the state
# change first, then Android's focus change.
func emissions(what: int) -> Array:
  var result: Array = []
  var before := derived()
  match what:
    IN, OUT:
      if app_focused == (what == IN):
        return result
      app_focused = what == IN
      if derived() != before:
        result.append(["change", derived()])
      result.append(["focus" if app_focused else "blur", null])
    PAUSED, RESUMED:
      if app_paused == (what == PAUSED):
        return result
      app_paused = what == PAUSED
      if derived() != before:
        result.append(["change", derived()])
    MEMORY:
      result.append(["memoryWarning", null])
  return result

# Each emission reaches every current listener of its event, in subscription
# order, after AppState's own listener has updated currentState.
func expected_log(list: Array) -> Array:
  var expected: Array = []
  for emission: Array in list:
    if emission[0] == "change":
      state = emission[1]
    emitted[emission[0]] += 1
    for root_name: String in listening[emission[0]]:
      expected.append([root_name, emission[0], emission[1], state])
  return expected

func rows(entries: Array) -> Array:
  return entries.map(func(entry: Dictionary) -> Array: return [entry.root, entry.event, entry.value, entry.currentState])

func counters_match(value: Dictionary, field: String, expected: Dictionary) -> bool:
  var actual: Variant = value.get(field, {})
  if not actual is Dictionary:
    return false
  for key: String in expected:
    if int(actual.get(key, -1)) != int(expected[key]):
      return false
  return true

func native_matches(value: Dictionary, observed: bool, expected_state: String) -> bool:
  return (value.get("state") == expected_state and value.get("focused") == app_focused and value.get("paused") == app_paused
    and value.get("observed") == observed and counters_match(value, "notifications", delivered)
    and counters_match(value, "events", emitted))

func listener_counts(value: Dictionary, change: int, focus: int, memory: int) -> bool:
  return (int(value.listeners.appStateDidChange) == change and int(value.listeners.appStateFocusChange) == focus
    and int(value.listeners.memoryWarning) == memory)

# One step of actual notifications. setup runs first (a subscription change
# or a root unmount); the rows it causes are expected before the events.
func step(name: String, notifications: Array, setup: Callable = Callable(), setup_rows: Array = []) -> void:
  var before: Dictionary = js("snapshot()")
  if setup.is_valid():
    await setup.call()
  var expected: Array = setup_rows.duplicate()
  for what: int in notifications:
    deliver(what)
    expected.append_array(expected_log(emissions(what)))
  await settle()
  application.call("evaluate", "AppStateProbe.query(%s)" % JSON.stringify(name))
  await settle()
  var after: Dictionary = js("snapshot()")
  var observed: Array = rows(after.log.slice(before.log.size()))
  var queries: Array = after.queries.filter(func(query: Dictionary) -> bool: return query.label == name)
  var events_name := name + "/JS receives exactly RN's AppState events in order on every listener"
  # The preceding host emits nothing and reports no state: a step that
  # expects no row passes there, so it is not normative.
  if expected.is_empty():
    check(observed == expected, events_name)
  else:
    lifecycle_check(observed == expected, events_name)
  lifecycle_check((after.currentState == state and queries.size() == 1 and queries[0].value == state
    and queries[0].error == null),
    name + "/AppState.currentState and getCurrentAppState report the native state")
  var app_state := lifecycle()
  lifecycle_check(native_matches(app_state, true, derived()),
    name + "/The application's lifecycle holds the state and counts each notification and event once")
  stages[name] = {"notifications": notifications.map(func(what: int) -> String: return NAMES[what]),
    "scenePaused": paused, "expected": expected, "observed": observed, "js": after, "lifecycle": app_state}

# A game pause (SceneTree.paused) is not the application lifecycle (V2-D11);
# FabricApplication processes always, so JS keeps receiving events.
func pause_tree() -> void:
  paused = true

func resume_tree() -> void:
  paused = false

func remove_from_a() -> void:
  application.call("evaluate", "AppStateProbe.remove('A', ['memoryWarning', 'blur'])")
  listening.memoryWarning.erase("A")
  listening.blur.erase("A")

func unmount_a() -> void:
  surfaces.A.call("unmount")
  await settle()
  for event: String in EVENTS:
    listening[event].erase("A")

func _initialize() -> void:
  allow_original_negative = OS.get_cmdline_user_args().has("--allow-original-negative")
  call_deferred("run_probe")

func run_probe() -> void:
  root.size = Vector2i(320, 80)
  application = ClassDB.instantiate("FabricApplication")
  application.name = "AppStateApplication"
  application.set("bundle_path", "res://build/app-state-probe.js")
  root.add_child(application)
  check(Engine.get_main_loop() == self, "lifecycle/The probe drives the running main loop itself")
  lifecycle_check(native_matches(lifecycle(), false, "active"),
    "lifecycle/A new application is active, as Godot's Input assumes a focused application")
  # Focus leaves before any runtime exists: the application owns the lifecycle,
  # and AppState must start from it rather than from a fixed value.
  deliver(OUT)
  var unobserved := emissions(OUT).size()
  state = derived()
  lifecycle_check((native_matches(lifecycle(), false, "inactive")
    and int(lifecycle().get("unobserved", -1)) == unobserved),
    "lifecycle/A notification before the runtime exists updates the application's state without an observer")
  await mount("A")
  await mount("B")
  var app := native()
  check((int(app.rootCount) == 2 and surfaces.A.call("get_surface_id") > 0 and surfaces.B.call("get_surface_id") > 0
    and app.errors.is_empty()),
    "mount/Two actual roots mount through the original AppRegistry in one Hermes application")
  var initial: Dictionary = js("initial()")
  application.call("evaluate", "AppStateProbe.query('initial')")
  await settle()
  var snapshot: Dictionary = js("snapshot()")
  stages.initial = {"js": snapshot, "initial": initial, "lifecycle": lifecycle(), "application": app}
  lifecycle_check((snapshot.access.available and snapshot.access.sameAsOriginal and snapshot.access.isAvailable == true
    and snapshot.access.error == null),
    "initial/The public react-native AppState is RN's original module, constructed on first read and available")
  lifecycle_check((initial.nativeModule and initial.constants is Dictionary
    and initial.constants.get("initialAppState") == "inactive" and snapshot.currentState == "inactive"),
    "initial/initialAppState and currentState carry the state the application held before the bundle loaded")
  var queries: Array = snapshot.queries.filter(func(query: Dictionary) -> bool: return query.label == "initial")
  lifecycle_check(queries.size() == 1 and queries[0].value == "inactive" and queries[0].error == null,
    "initial/getCurrentAppState answers asynchronously with the native state")
  lifecycle_check(initial.unknownEvent == "Trying to subscribe to unknown event: suspend",
    "initial/An unknown event fails with RN's original AppState error")
  lifecycle_check(snapshot.log.is_empty() and listener_counts(snapshot, 4, 6, 3),
    "initial/AppState, the library and both roots subscribe through RN's device emitter without an event")
  var app_state := lifecycle()
  lifecycle_check((int(app_state.get("observers", 0)) == 1 and int(app_state.get("unobserved", -1)) == unobserved
    and native_matches(app_state, true, "inactive")),
    "initial/Exactly one AppState module observes the shared lifecycle of both roots")

  await step("focus-in", [IN])
  await step("focus-out", [OUT])
  await step("focus-out-repeat", [OUT])
  await step("focus-in-again", [IN])
  await step("memory-warning", [MEMORY])
  # Godot on Android sends FOCUS_OUT then PAUSED from Activity.onPause and
  # FOCUS_IN then RESUMED on resume; on iOS it sends the same pairs for
  # WillResignActive/DidEnterBackground and WillEnterForeground.
  await step("mobile-background", [OUT, PAUSED])
  await step("mobile-foreground", [IN, RESUMED])
  await step("paused-focused", [PAUSED])
  await step("blur-while-paused", [OUT])
  await step("resume-unfocused", [RESUMED])
  await step("focus-after-resume", [IN])
  await step("scene-pause", [], pause_tree)
  await step("focus-out-scene-paused", [OUT])
  lifecycle_check(stages["focus-out-scene-paused"].scenePaused and stages["focus-out-scene-paused"].observed.size() > 0,
    "scene-pause/A paused game tree keeps delivering AppState events to JS")
  await step("focus-in-scene-resumed", [IN], resume_tree)
  # Removing a subscription, twice, stops only that listener.
  await step("remove", [MEMORY, OUT], remove_from_a)
  var removed: Dictionary = stages.remove.js
  lifecycle_check(listener_counts(removed, 4, 5, 2) and removed.roots.A.subscriptions == ["change", "focus"],
    "remove/Each removed subscription releases its device listener once")
  # Root A's unmount removes its remaining subscriptions; root B keeps the
  # shared state.
  await step("unmount-a", [IN], unmount_a, [["A", "cleanup", null, state]])
  var unmounted: Dictionary = stages["unmount-a"].js
  check((unmounted.roots.A.mounted == false and int(unmounted.roots.A.cleanups) == 1 and unmounted.roots.B.mounted == true
    and int(native().rootCount) == 1),
    "unmount-a/Root A unmounts through its effect cleanup while root B stays mounted")
  lifecycle_check(listener_counts(unmounted, 3, 4, 2), "unmount-a/The unmounted root holds no AppState listener")
  await stop_case()
  await finish()

func stop_case() -> void:
  var before: Dictionary = js("snapshot()")
  var registry_before: Dictionary = native().get("nativeModules", {})
  application.call("stop")
  await settle()
  var stopped := native()
  var after: Dictionary = js("snapshot()")
  var cleanup: Array = rows(after.log.slice(before.log.size())).map(func(row: Array) -> Array: return [row[0], row[1]])
  check(cleanup == [["B", "cleanup"]], "stop/Stop runs root B's cleanup and emits no AppState event")
  lifecycle_check(after.currentState == state, "stop/AppState keeps its last native state; stop fabricates no transition")
  var app_state := lifecycle()
  lifecycle_check((native_matches(app_state, false, derived())
    and int(stopped.nativeModules.disposals) > int(registry_before.get("disposals", 0))),
    "stop/Stop disposes the AppState module and releases its lifecycle observer")
  check(stopped.stopped and int(stopped.rootCount) == 0 and stopped.errors.is_empty(),
    "stop/Stop releases every root without diagnostics")
  for name: String in ["A", "B"]:
    var root_state: Dictionary = JSON.parse_string(surfaces[name].call("snapshot"))
    check(int(root_state.nativeTags) == 0 and int(root_state.creates) == int(root_state.deletes),
      "stop/" + name + "/All native Controls of the root are balanced")
  # Notifications keep arriving after stop. The application still counts
  # them, but nothing reaches JS, not even the never-removed library listener.
  var unobserved := int(app_state.get("unobserved", 0))
  for what: int in [OUT, PAUSED, MEMORY]:
    deliver(what)
    unobserved += emissions(what).size()
  await settle()
  var late: Dictionary = js("snapshot()")
  check(late.log.size() == after.log.size(), "stop/Notifications after stop reach no JS listener")
  var late_state := lifecycle()
  lifecycle_check((native_matches(late_state, false, "background")
    and int(late_state.get("unobserved", -1)) == unobserved),
    "stop/The stopped application keeps counting notifications without emitting")
  var retained: Dictionary = js("afterStop()")
  lifecycle_check(retained.currentState == state and str(retained.retainedGetConstants).contains("E_MODULE_DISPOSED"),
    "stop/A retained AppState method cannot reach the disposed module")
  check(str(retained.lookup).contains("E_RUNTIME_STOPPED"), "stop/A lookup after stop is refused by the stopped registry")
  # The SDK's environment disposal releases every AppState subscription, as
  # VM teardown would, without fabricating an event.
  var disposed: Dictionary = js("dispose()")
  check(int(disposed.environment.appState) == 0 and disposed.log == after.log.size(),
    "dispose/disposeEnvironment releases every AppState subscription without an event")
  lifecycle_check(disposed.currentState == state, "dispose/disposeEnvironment leaves AppState's last state unchanged")
  stages.stop = {"before": before, "after": after, "late": late, "retained": retained, "disposed": disposed,
    "application": stopped, "lifecycle": late_state}

func finish() -> void:
  for surface: Control in surfaces.values():
    surface.queue_free()
  application.queue_free()
  await settle(2)
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var observed := failures.duplicate()
  var expected := expected_original_failures.duplicate()
  observed.sort()
  expected.sort()
  var original_negative_observed := allow_original_negative and observed == expected and not failures.is_empty()
  var report := {"scenario": "native-app-state", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages, "delivered": delivered,
    "expectedOriginalFailures": expected_original_failures, "allowOriginalNegative": allow_original_negative,
    "originalNegativeObserved": original_negative_observed, "allCurrentAssertionsPassed": failures.is_empty(),
    "scope": {"actualGodotNotifications": true, "deliveredThrough": "MainLoop.notification on the running SceneTree",
      "originalAppStateModule": true, "publicReactNativeImport": true, "twoRootsOneApplication": true,
      "desktopFocusIsInactive": true, "focusBlurFromApplicationFocus": true, "mobileExportsCertified": false,
      "hardwareFocusCertified": false}}
  var output := FileAccess.open("res://build/app-state-report.json", FileAccess.WRITE)
  if not check(output != null, "report/The AppState report is saved with any normative failure visible"):
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  output.close()
  print("APP_STATE_ORIGINAL_NEGATIVE: " + str(failures.size()) if original_negative_observed else "APP_STATE_PASSED: " + str(checks.size()) if failures.is_empty() else "APP_STATE_FAILED")
  quit(0 if failures.is_empty() or original_negative_observed else 1)
