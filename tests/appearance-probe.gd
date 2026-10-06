extends SceneTree

# Godot's DisplayServer keeps one system theme callback for the whole process,
# registered with set_system_theme_change_callback (which replaces the previous
# one), and calls it with no arguments when the OS theme changes (macOS
# AppleInterfaceThemeChangedNotification, Windows, X11 and Wayland portals,
# Android, iOS). The headless DisplayServer has no system theme, drops the
# Callable and never calls back. This probe therefore supplies the system
# scheme through each application's validation meta and calls the very
# Callable the Appearance modules registered, once per change, as DisplayServer
# would; from that call on, the path is the production one. Two roots of one
# application render through RN's original useColorScheme and listen through
# the public Appearance; two more applications then observe at the same time.
const SEAM := "validation_system_theme_callback"
# The per-application callback of hosts that predate the shared owner.
const CALLBACK := "_on_system_theme_changed"
const SYSTEM_META := "validation_system_color_scheme"
const COLORS := {"light": "e2e8f0ff", "dark": "0f172aff", "none": "ef4444ff"}

var application: Node
var surfaces := {}
var checks: Array = []
var stages := {}
var expected_original_failures: Array = []
var expected_prefix_failures: Array = []
var allow_original_negative := false
var allow_prefix_negative := false
# DisplayServer's single slot: the Callable it would call on a theme change.
var slot := Callable()
# Every live application, whose validation meta follows the process-wide theme.
var applications: Array = []
# The theme the OS reports to every application; empty while it reports none.
var os_scheme := ""
# The main application observes until it stops, then leaves the callback.
var main_observing := true
# The state the native module must hold, tracked independently of it.
var system := {"supported": false, "dark": false}
var override := "unspecified"
var reported := "light"
var counts := {"events": 0, "notifications": 0, "overrides": 0, "unobserved": 0}
# Change listeners in subscription order, and the roots rendering the hook.
var listening: Array = ["library"]
var rendering: Array = []
# Every action this probe performs, in order, for the independent oracle.
var actions: Array = []

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

# A normative check needs the native Appearance module: an emitted event, the
# native scheme or the registered callback. The preceding host has none of
# them, so it must fail exactly these checks.
func module_check(condition: bool, name: String) -> bool:
  expected_original_failures.append(name)
  return check(condition, name)

# A check that needs the shared system theme callback: one registration that
# reaches every observing application. The host before it registered one
# callback per application, the last one replacing the others, so it must fail
# exactly these checks. They need the native module too.
func shared_check(condition: bool, name: String) -> bool:
  expected_prefix_failures.append(name)
  return module_check(condition, name)

func settle(count := 6) -> void:
  for index in range(count):
    await process_frame

func js(target: Node, expression: String) -> Variant:
  return JSON.parse_string(target.call("evaluate", "JSON.stringify(AppearanceProbe." + expression + ")"))

func native(target: Node) -> Dictionary:
  return JSON.parse_string(target.call("snapshot"))

func appearance(target: Node) -> Dictionary:
  var value: Variant = native(target).get("systemAppearance", {})
  return value if value is Dictionary else {}

func background(name: String) -> String:
  var state: Dictionary = JSON.parse_string(surfaces[name].call("snapshot"))
  for entry: Dictionary in state.get("nodes", []):
    if entry.get("testID") == "appearance-" + name:
      return str(entry.get("appearance", {}).get("background", ""))
  return ""

func effective() -> String:
  if override == "light" or override == "dark":
    return override
  return "dark" if system.supported and system.dark else "light"

# What the observing module must emit after an action: one appearanceChanged
# when the effective scheme differs from the last one it reported, nothing
# otherwise. Once stopped it has left the callback and reads nothing more.
func emission() -> Array:
  var current := effective()
  if current == reported:
    return []
  reported = current
  counts.events += 1
  return [current]

func mount(target: Node, name: String) -> void:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = name
  surface.position = Vector2(160 * surfaces.size(), 0)
  surface.size = Vector2(140, 60)
  surface.set("application_path", NodePath("../" + target.name))
  surface.set("component_name", "AppearanceProbe")
  surface.set("initial_props", {"name": name})
  surfaces[name] = surface
  root.add_child(surface)
  await settle()
  registered_callback(target)

# The Callable DisplayServer holds after an application's module started. The
# current host reports the one its shared owner registered. A host without
# that seam registered Callable(application, CALLBACK) from each module, and
# the last registration replaced the previous one.
func registered_callback(target: Node) -> void:
  if target.has_method(SEAM):
    slot = target.call(SEAM)
  elif appearance(target).get("callbackRegistered") == true and target.has_method(CALLBACK):
    slot = Callable(target, CALLBACK)

func seam_callable(target: Node) -> Callable:
  return target.call(SEAM) if target.has_method(SEAM) else Callable()

func owner_of(target: Node) -> Dictionary:
  var value: Variant = native(target).get("systemThemeCallback", {})
  return value if value is Dictionary else {}

func members_are(owner: Dictionary, targets: Array) -> bool:
  return owner.get("members") is Array and owner.members == targets.map(
    func(target: Node) -> String: return str(target.get_instance_id()))

func grew(before: Dictionary, after: Dictionary, key: String, amount: int) -> bool:
  return before.has(key) and after.has(key) and int(after[key]) - int(before[key]) == amount

# Delivers a system theme change exactly as DisplayServer does: the OS theme
# changes for every application, then the one Callable in DisplayServer's slot
# runs, without arguments, and whoever it reaches reads the system again.
func system_theme(scheme: String) -> void:
  actions.append({"kind": "system", "value": scheme})
  os_scheme = scheme
  for target: Node in applications:
    if is_instance_valid(target):
      target.set_meta(SYSTEM_META, scheme)
  if main_observing:
    system = {"supported": true, "dark": scheme == "dark"}
    counts.notifications += 1
  # DisplayServer skips a Callable whose object is gone.
  if slot.is_valid():
    slot.call()

func set_override(value: String) -> Dictionary:
  actions.append({"kind": "override", "value": value})
  var result: Dictionary = js(application, "set(%s)" % JSON.stringify(value))
  if value in ["light", "dark", "auto", "unspecified"]:
    override = "unspecified" if value == "auto" else value
    counts.overrides += 1
  return result

func rows(entries: Array) -> Array:
  return entries.map(func(entry: Dictionary) -> Array: return [entry.root, entry.event, entry.colorScheme, entry.read])

func renders_by_root(entries: Array) -> Dictionary:
  var result := {}
  for entry: Dictionary in entries:
    if not result.has(entry.root):
      result[entry.root] = []
    result[entry.root].append(entry.scheme)
  return result

func counters_match(value: Dictionary) -> bool:
  for key: String in counts:
    if int(value.get(key, -1)) != int(counts[key]):
      return false
  return true

func native_matches(value: Dictionary, observed: bool) -> bool:
  var expected_system: Variant = value.get("system", {})
  return (value.get("scheme") == effective() and value.get("override") == override and expected_system is Dictionary
    and expected_system.get("supported") == system.supported and expected_system.get("dark") == system.dark
    and value.get("observed") == observed and int(value.get("observers", -1)) == 1
    and int(value.get("listeners", -1)) == 1 and value.get("callbackRegistered") == true and counters_match(value))

# One action against the live application. setup runs first (a subscription
# removal or a root unmount) and its rows are expected before the events.
func step(name: String, action: Callable, setup: Callable = Callable(), setup_rows: Array = []) -> void:
  var first := actions.size()
  var before: Dictionary = js(application, "snapshot()")
  if setup.is_valid():
    await setup.call()
  var result: Variant = await action.call()
  var emitted := emission()
  await settle()
  var after: Dictionary = js(application, "snapshot()")
  var expected: Array = setup_rows.duplicate()
  var expected_renders := {}
  for scheme: String in emitted:
    for listener: String in listening:
      expected.append([listener, "change", scheme, scheme])
    for root_name: String in rendering:
      expected_renders[root_name] = [scheme]
  var observed: Array = rows(after.log.slice(before.log.size()))
  var observed_renders := renders_by_root(after.renders.slice(before.renders.size()))
  var events_name := name + "/Every listener receives RN's change exactly once per effective scheme change"
  var renders_name := name + "/Both roots re-render through useColorScheme only when the scheme changes"
  # The preceding host emits nothing: a step that expects nothing passes there.
  if expected.is_empty():
    check(observed == expected, events_name)
  else:
    module_check(observed == expected, events_name)
  if expected_renders.is_empty():
    check(observed_renders == expected_renders, renders_name)
  else:
    module_check(observed_renders == expected_renders, renders_name)
  var colors_match := rendering.all(func(root_name: String) -> bool: return background(root_name) == COLORS[reported])
  module_check(after.colorScheme == reported and colors_match,
    name + "/getColorScheme and the native Views of the rendering roots show the effective scheme")
  var state := appearance(application)
  module_check(native_matches(state, true), name + "/The native module holds the effective scheme and counts each change once")
  var backgrounds := {}
  for root_name: String in rendering:
    backgrounds[root_name] = background(root_name)
  stages[name] = {"actions": actions.slice(first), "backgrounds": backgrounds, "result": result, "system": system.duplicate(), "override": override, "emitted": emitted,
    "expected": expected, "observed": observed, "expectedRenders": expected_renders, "renders": observed_renders,
    "js": after, "native": state, "owner": owner_of(application)}

func dark_system() -> void:
  system_theme("dark")

func light_system() -> void:
  system_theme("light")

func remove_from_a() -> void:
  actions.append({"kind": "remove", "value": "A"})
  application.call("evaluate", "AppearanceProbe.remove('A')")
  listening.erase("A")
  # Following the system again changes nothing here: the system is light.
  set_override("unspecified")
  emission()

func unmount_a() -> void:
  actions.append({"kind": "unmount", "value": "A"})
  surfaces.A.call("unmount")
  await settle()
  listening.erase("A")
  rendering.erase("A")

func _initialize() -> void:
  allow_original_negative = OS.get_cmdline_user_args().has("--allow-original-negative")
  allow_prefix_negative = OS.get_cmdline_user_args().has("--allow-prefix-negative")
  call_deferred("run_probe")

func run_probe() -> void:
  root.size = Vector2i(480, 80)
  application = ClassDB.instantiate("FabricApplication")
  application.name = "AppearanceApplication"
  application.set("bundle_path", "res://build/appearance-probe.js")
  root.add_child(application)
  applications.append(application)
  await mount(application, "A")
  await mount(application, "B")
  rendering = ["A", "B"]
  listening.append_array(["A", "B"])
  var app := native(application)
  check((int(app.rootCount) == 2 and surfaces.A.call("get_surface_id") > 0 and surfaces.B.call("get_surface_id") > 0
    and app.errors.is_empty()),
    "mount/Two actual roots mount through the original AppRegistry in one Hermes application")
  await initial_case()
  await step("system-dark", dark_system)
  await step("system-dark-repeat", dark_system)
  await step("override-light", set_override.bind("light"))
  await step("system-light-overridden", light_system)
  await step("override-dark", set_override.bind("dark"))
  await step("unspecified", set_override.bind("unspecified"))
  await step("auto-unchanged", set_override.bind("auto"))
  await step("override-same", set_override.bind("light"))
  await step("unknown-override", set_override.bind("sepia"))
  module_check(str(stages["unknown-override"].result.get("error")).contains("E_ARGUMENT"),
    "unknown-override/setColorScheme rejects an unknown override and keeps the scheme")
  # A removed listener stops alone; the root's hook still re-renders.
  await step("remove", dark_system, remove_from_a)
  # Root A's unmount removes its hook and listener; root B keeps the scheme.
  await step("unmount-a", light_system, unmount_a, [["A", "cleanup", null, reported]])
  var unmounted: Dictionary = stages["unmount-a"].js
  check((unmounted.roots.A.mounted == false and int(unmounted.roots.A.cleanups) == 1 and unmounted.roots.B.mounted == true
    and int(native(application).rootCount) == 1),
    "unmount-a/Root A unmounts through its effect cleanup while root B stays mounted")
  await stop_case()
  await dark_application_case()
  await two_applications_case()
  await finish()

func initial_case() -> void:
  var snapshot: Dictionary = js(application, "snapshot()")
  var state := appearance(application)
  stages.initial = {"js": snapshot, "native": state, "backgrounds": {"A": background("A"), "B": background("B")},
    "owner": owner_of(application)}
  module_check(slot.is_valid() and state.get("callbackRegistered") == true,
    "callback/The application registers the system theme Callable this probe invokes")
  module_check(snapshot.nativeModule and snapshot.colorScheme == "light" and native_matches(state, true),
    "initial/An unsupported system theme starts light, as RN's platforms report without a dark style")
  module_check(renders_by_root(snapshot.renders) == {"A": ["light"], "B": ["light"]} and background("A") == COLORS.light
    and background("B") == COLORS.light,
    "initial/Both roots render the initial scheme through useColorScheme")
  module_check(int(snapshot.deviceListeners) == 1,
    "initial/Appearance subscribes its single native listener through RN's device emitter")
  check(snapshot.log.is_empty(), "initial/No change event is sent before the scheme changes")

func stop_case() -> void:
  # The scheme JS last received; native changes after stop never reach it.
  var delivered := reported
  var first := actions.size()
  var before: Dictionary = js(application, "snapshot()")
  var registry_before: Dictionary = native(application).get("nativeModules", {})
  application.call("stop")
  main_observing = false
  await settle()
  var stopped := native(application)
  var after: Dictionary = js(application, "snapshot()")
  var cleanup: Array = rows(after.log.slice(before.log.size())).map(func(row: Array) -> Array: return [row[0], row[1]])
  check(cleanup == [["B", "cleanup"]] and after.renders.size() == before.renders.size(),
    "stop/Stop runs root B's cleanup and emits no Appearance event")
  module_check(after.colorScheme == delivered, "stop/Appearance keeps its last scheme; stop fabricates no change")
  var state := appearance(application)
  module_check((native_matches(state, false) and int(stopped.nativeModules.disposals) > int(registry_before.get("disposals", 0))),
    "stop/Stop disposes the Appearance module and releases its observer")
  check(stopped.stopped and int(stopped.rootCount) == 0 and stopped.errors.is_empty(),
    "stop/Stop releases every root without diagnostics")
  for name: String in ["A", "B"]:
    var root_state: Dictionary = JSON.parse_string(surfaces[name].call("snapshot"))
    check(int(root_state.nativeTags) == 0 and int(root_state.creates) == int(root_state.deletes),
      "stop/" + name + "/All native Controls of the root are balanced")
  # The system keeps changing after stop. Nothing reaches JS, not even the
  # never-removed library listener, and the module sends nothing. Whether the
  # stopped application still reads the change differs between the hosts
  # compared here; the two-application stage checks that the current host
  # stops delivering it.
  var owner_before := owner_of(application)
  system_theme("dark")
  await settle()
  var late: Dictionary = js(application, "snapshot()")
  check(late.log.size() == after.log.size(), "stop/A system change after stop reaches no JS listener")
  var late_state := appearance(application)
  module_check((late_state.get("observed") == false and int(late_state.get("events", -1)) == counts.events
    and late_state.get("override") == override and int(late_state.get("overrides", -1)) == counts.overrides
    and int(late_state.get("listeners", -1)) == 1 and late_state.get("callbackRegistered") == true),
    "stop/The stopped application emits nothing for a later system change")
  var retained: Dictionary = js(application, "afterStop()")
  module_check(str(retained.retainedGetColorScheme).contains("E_MODULE_DISPOSED"),
    "stop/A retained getColorScheme cannot reach the disposed module")
  check(str(retained.lookup).contains("E_RUNTIME_STOPPED"), "stop/A lookup after stop is refused by the stopped registry")
  # The SDK's environment disposal releases the Appearance device subscription,
  # as VM teardown would, without changing the last scheme.
  var disposed: Dictionary = js(application, "dispose()")
  check(int(disposed.environment.appearance) == 0 and int(disposed.log) == after.log.size(),
    "dispose/disposeEnvironment releases the Appearance device subscription without an event")
  module_check(disposed.colorScheme == delivered and retained.colorScheme == delivered,
    "dispose/disposeEnvironment leaves Appearance's last scheme unchanged")
  stages.stop = {"actions": actions.slice(first), "before": before, "after": after, "late": late, "retained": retained, "disposed": disposed,
    "application": stopped, "native": late_state, "ownerBefore": owner_before, "ownerAfter": owner_of(application)}

# A second application starts from a supported dark system: its initial scheme
# comes from the system read when the module is created.
func dark_application_case() -> void:
  var dark: Node = ClassDB.instantiate("FabricApplication")
  dark.name = "AppearanceDarkApplication"
  dark.set("bundle_path", "res://build/appearance-probe.js")
  root.add_child(dark)
  dark.set_meta(SYSTEM_META, "dark")
  applications.append(dark)
  await mount(dark, "C")
  var snapshot: Dictionary = js(dark, "snapshot()")
  var state := appearance(dark)
  var dark_owner := owner_of(dark)
  var system_state: Variant = state.get("system", {})
  var view_background := background("C")
  module_check((snapshot.colorScheme == "dark" and renders_by_root(snapshot.renders) == {"C": ["dark"]}
    and view_background == COLORS.dark and snapshot.log.is_empty() and system_state is Dictionary
    and system_state.get("supported") == true and system_state.get("dark") == true and state.get("scheme") == "dark"
    and int(state.get("events", -1)) == 0),
    "initial-dark/A supported dark system is the initial scheme of a new application, without an event")
  dark.call("stop")
  await settle()
  var stopped := native(dark)
  check(stopped.stopped and int(stopped.rootCount) == 0 and stopped.errors.is_empty(),
    "initial-dark/The second application stops without diagnostics")
  stages["initial-dark"] = {"js": snapshot, "native": state, "backgrounds": {"C": view_background}, "owner": dark_owner,
    "ownerAfterStop": owner_of(dark)}
  surfaces.C.queue_free()
  surfaces.erase("C")
  applications.erase(dark)
  dark.queue_free()
  await settle()

func start_application(app_name: String, root_name: String) -> Node:
  var target: Node = ClassDB.instantiate("FabricApplication")
  target.name = app_name
  target.set("bundle_path", "res://build/appearance-probe.js")
  root.add_child(target)
  if not os_scheme.is_empty():
    target.set_meta(SYSTEM_META, os_scheme)
  applications.append(target)
  actions.append({"kind": "start", "value": root_name})
  await mount(target, root_name)
  return target

func pair_state(target: Node, root_name: String) -> Dictionary:
  var state := {"js": js(target, "snapshot()"), "native": appearance(target)}
  if surfaces.has(root_name):
    state.background = background(root_name)
  return state

# Whether one application of the pair received exactly one change to scheme
# since before: its library listener and its root's, one render of its root,
# getColorScheme and its root's native View.
func followed(before: Dictionary, after: Dictionary, root_name: String, scheme: String) -> bool:
  return (rows(after.js.log.slice(before.js.log.size())) == [["library", "change", scheme, scheme], [root_name, "change", scheme, scheme]]
    and renders_by_root(after.js.renders.slice(before.js.renders.size())) == {root_name: [scheme]}
    and after.js.colorScheme == scheme and after.get("background") == COLORS[scheme])

# Whether its observing module read the system and counted every change once.
func counted(state: Dictionary, scheme: String, total: int) -> bool:
  var value: Dictionary = state.native
  var system_state: Variant = value.get("system", {})
  return (value.get("scheme") == scheme and system_state is Dictionary and system_state.get("supported") == true
    and system_state.get("dark") == (scheme == "dark") and value.get("observed") == true
    and int(value.get("notifications", -1)) == total and int(value.get("events", -1)) == total)

func stop_pair_member(target: Node, root_name: String) -> Dictionary:
  actions.append({"kind": "stop", "value": root_name})
  var before: Dictionary = js(target, "snapshot()")
  target.call("stop")
  await settle()
  var stopped := native(target)
  var after: Dictionary = js(target, "snapshot()")
  var cleanup: Array = rows(after.log.slice(before.log.size())).map(func(row: Array) -> Array: return [row[0], row[1]])
  check(cleanup == [[root_name, "cleanup"]] and stopped.stopped and int(stopped.rootCount) == 0 and stopped.errors.is_empty(),
    "two-applications/stop-" + root_name + "/Stop runs the root's cleanup without diagnostics")
  return {"js": after, "native": appearance(target)}

func free_pair_member(target: Node, root_name: String) -> void:
  actions.append({"kind": "free", "value": root_name})
  surfaces[root_name].queue_free()
  surfaces.erase(root_name)
  applications.erase(target)
  target.queue_free()
  await settle()

# Two applications observe at the same time. DisplayServer still holds one
# callback, so its single registration must reach both; stopping or freeing
# one must leave the other receiving, and a stopped application receives
# nothing. On the host before the shared owner the second application's
# registration displaced the first's.
func two_applications_case() -> void:
  var first_action := actions.size()
  var first := await start_application("AppearanceFirstApplication", "P")
  var second := await start_application("AppearanceSecondApplication", "Q")
  var ids := {"P": str(first.get_instance_id()), "Q": str(second.get_instance_id())}
  var initial_scheme := "dark" if os_scheme == "dark" else "light"
  var start := {"P": pair_state(first, "P"), "Q": pair_state(second, "Q"), "owner": owner_of(first)}
  var from_system := true
  for root_name: String in ["P", "Q"]:
    var state: Dictionary = start[root_name]
    from_system = from_system and (state.js.colorScheme == initial_scheme and state.js.log.is_empty()
      and renders_by_root(state.js.renders) == {root_name: [initial_scheme]} and state.background == COLORS[initial_scheme]
      and state.native.get("scheme") == initial_scheme and state.native.get("observed") == true
      and state.native.get("callbackRegistered") == true and int(state.native.get("events", -1)) == 0)
  module_check(from_system, "two-applications/start/Both applications start from the system theme without an event")
  shared_check((start.owner.get("registered") == true and int(start.owner.get("registrations", -1)) == 1
    and members_are(start.owner, [first, second]) and owner_of(second) == start.owner and slot.is_valid()
    and seam_callable(first) == slot and seam_callable(second) == slot),
    "two-applications/start/One DisplayServer registration serves both applications")

  # One change while both observe.
  var both_before := {"P": pair_state(first, "P"), "Q": pair_state(second, "Q"), "owner": owner_of(first)}
  system_theme("light")
  await settle()
  var both := {"P": pair_state(first, "P"), "Q": pair_state(second, "Q"), "owner": owner_of(first)}
  shared_check(followed(both_before.P, both.P, "P", "light") and followed(both_before.Q, both.Q, "Q", "light"),
    "two-applications/both/One system theme change reaches both applications' listeners and roots once")
  shared_check((counted(both.P, "light", 1) and counted(both.Q, "light", 1)
    and grew(both_before.owner, both.owner, "dispatches", 1) and grew(both_before.owner, both.owner, "deliveries", 2)),
    "two-applications/both/Both native modules read the change once through the one registered callback")

  # The second application stops: it leaves, the first keeps receiving.
  var second_stopped := await stop_pair_member(second, "Q")
  var owner_left := owner_of(first)
  shared_check((members_are(owner_left, [first]) and owner_left.get("registered") == true
    and int(owner_left.get("registrations", -1)) == 1),
    "two-applications/second-stopped/The stopped application leaves the callback registered for the other")
  var stopped_before := {"P": pair_state(first, "P"), "Q": second_stopped, "owner": owner_left}
  system_theme("dark")
  await settle()
  var stopped_after := {"P": pair_state(first, "P"), "Q": {"js": js(second, "snapshot()"), "native": appearance(second)},
    "owner": owner_of(first)}
  shared_check(followed(stopped_before.P, stopped_after.P, "P", "dark") and counted(stopped_after.P, "dark", 2),
    "two-applications/second-stopped/The running application still follows the system theme")
  shared_check((stopped_after.Q.native == stopped_before.Q.native and grew(stopped_before.owner, stopped_after.owner, "dispatches", 1)
    and grew(stopped_before.owner, stopped_after.owner, "deliveries", 1)),
    "two-applications/second-stopped/The stopped application receives no later system change")
  module_check((stopped_after.Q.native.get("observed") == false and int(stopped_after.Q.native.get("events", -1)) == 1
    and stopped_after.Q.js.log.size() == stopped_before.Q.js.log.size()),
    "two-applications/second-stopped/The stopped application emits nothing")

  # The second application is freed: nothing dangles, the first keeps receiving.
  await free_pair_member(second, "Q")
  var freed_before := {"P": pair_state(first, "P"), "owner": owner_of(first)}
  system_theme("light")
  await settle()
  var freed := {"P": pair_state(first, "P"), "owner": owner_of(first)}
  shared_check((followed(freed_before.P, freed.P, "P", "light") and counted(freed.P, "light", 3)
    and members_are(freed.owner, [first]) and grew(freed_before.owner, freed.owner, "deliveries", 1)),
    "two-applications/second-freed/A freed application leaves no dangling callback; the other still follows the system")

  # The first application is freed while it still observes, as a game frees a
  # node: freeing stops it and it leaves the callback, which stays registered
  # and idle. The process-wide owner is read through the stopped main
  # application.
  await free_pair_member(first, "P")
  var idle_before := owner_of(application)
  shared_check((members_are(idle_before, []) and idle_before.get("registered") == true
    and int(idle_before.get("registrations", -1)) == 1),
    "two-applications/first-freed/Freeing a running application leaves the callback, which stays registered")
  system_theme("dark")
  await settle()
  var idle := owner_of(application)
  shared_check(grew(idle_before, idle, "dispatches", 1) and grew(idle_before, idle, "deliveries", 0),
    "two-applications/first-freed/The registered callback still runs and reaches no application")
  stages["two-applications"] = {"actions": actions.slice(first_action),
    "applications": ids,
    "start": start, "both": {"before": both_before, "after": both},
    "second-stopped": {"stopped": second_stopped, "before": stopped_before, "after": stopped_after},
    "second-freed": {"before": freed_before, "after": freed},
    "first-freed": {"before": idle_before, "after": idle}}

func finish() -> void:
  for surface: Control in surfaces.values():
    surface.queue_free()
  application.queue_free()
  await settle(2)
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var observed := failures.duplicate()
  var expected := expected_original_failures.duplicate()
  var expected_prefix := expected_prefix_failures.duplicate()
  observed.sort()
  expected.sort()
  expected_prefix.sort()
  var original_negative_observed := allow_original_negative and observed == expected and not failures.is_empty()
  var prefix_negative_observed := allow_prefix_negative and observed == expected_prefix and not failures.is_empty()
  var report := {"scenario": "native-appearance", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages, "counts": counts,
    "expectedOriginalFailures": expected_original_failures, "allowOriginalNegative": allow_original_negative,
    "originalNegativeObserved": original_negative_observed, "expectedPreFixFailures": expected_prefix_failures,
    "allowPrefixNegative": allow_prefix_negative, "prefixNegativeObserved": prefix_negative_observed,
    "allCurrentAssertionsPassed": failures.is_empty(),
    "scope": {"systemThemeDeliveredThrough": "the one Callable registered with DisplayServer, called once per change; system value from validation meta",
      "headlessDisplayServerThemeSupported": DisplayServer.is_dark_mode_supported(), "originalAppearanceModule": true,
      "originalUseColorScheme": true, "publicReactNativeImport": true, "twoRootsOneApplication": true,
      "twoApplicationsAtOnce": true, "realSystemThemeCertified": false, "mobileExportsCertified": false}}
  var output := FileAccess.open("res://build/appearance-report.json", FileAccess.WRITE)
  if not check(output != null, "report/The Appearance report is saved with any normative failure visible"):
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  output.close()
  if original_negative_observed:
    print("APPEARANCE_ORIGINAL_NEGATIVE: " + str(failures.size()))
  elif prefix_negative_observed:
    print("APPEARANCE_PREFIX_NEGATIVE: " + str(failures.size()))
  else:
    print("APPEARANCE_PASSED: " + str(checks.size()) if failures.is_empty() else "APPEARANCE_FAILED")
  quit(0 if failures.is_empty() or original_negative_observed or prefix_negative_observed else 1)
