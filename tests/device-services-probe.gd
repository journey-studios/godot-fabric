extends SceneTree

# RN's original Linking, Clipboard and Vibration, run through the public
# react-native import in two actual FabricApplications, each with its own Hermes
# runtime and the same bundle:
#
#   A  the validation backend (the validation_device_services meta replaces every
#      backend function with a Callable that records the call): two roots, every
#      positive and negative check, the vibration hazard and stop.
#   R  the real Godot backend, with only open_url replaced so that no URL can open.
#      The headless DisplayServer has no clipboard, so the real backend must report
#      E_CLIPBOARD_UNAVAILABLE; Input.vibrate_handheld is a silent no-op here; and
#      getInitialURL reads the --uri= this very process was started with.
#
# --launch-only runs the second launch case: R alone, in a process started
# without --uri=, where getInitialURL must resolve null.
#
# The probe judges order and counts, never time. Each step lists the commands it
# ran; the independent oracle (device-services-oracle.mjs) replays them against a
# model written from RN's rules and compares calls, backend log, events and
# counters.
const LAUNCH_ONLY := "--launch-only"
const ERR_UNAVAILABLE := 2

var checks: Array = []
var stages := {"A": {}, "R": {}}
var expected_original_failures: Array = []
var allow_original_negative := false
var sabotage := false
var launch_only := false
var expected_launch := ""
var surfaces := {}
var apps := {}
# The state each application's validation backend keeps, and the log of every
# backend call: ["open", url], ["get"], ["set", text], ["vibrate", ms], ["cancel"].
var backends := {}
var vibration_available := true

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

# A normative check needs the native device services: a native result, a backend
# call or a module. The preceding host has none of them, so it must fail exactly
# these checks.
func normative(condition: bool, name: String) -> bool:
  expected_original_failures.append(name)
  return check(condition, name)

func settle(count := 6) -> void:
  for index in range(count):
    await process_frame

func wait_for(condition: Callable, limit_ms: int = 4000) -> bool:
  var started := Time.get_ticks_msec()
  while Time.get_ticks_msec() - started < limit_ms and not condition.call():
    await process_frame
  return condition.call()

# ---- the validation backend ----
func backend_open(url: String, state: Dictionary) -> int:
  state.log.append(["open", url])
  return state.open_code

func backend_available(state: Dictionary) -> bool:
  return state.available

func backend_get(state: Dictionary) -> String:
  state.log.append(["get"])
  return state.pasteboard

func backend_set(text: String, state: Dictionary) -> void:
  state.log.append(["set", text])
  state.pasteboard = text

func backend_vibrate(milliseconds: float, state: Dictionary) -> void:
  # A whole number of milliseconds is logged as an int, which compares equal to the int the checks name.
  var shown: Variant = int(milliseconds) if milliseconds == floorf(milliseconds) else milliseconds
  state.log.append(["vibrate", shown])

func backend_cancel(state: Dictionary) -> void:
  state.log.append(["cancel"])

func new_backend() -> Dictionary:
  return {"log": [], "pasteboard": "", "available": true, "open_code": 0}

func overlay(state: Dictionary, everything: bool) -> Dictionary:
  var replaced := {"open_url": backend_open.bind(state)}
  if everything:
    replaced["clipboard_available"] = backend_available.bind(state)
    replaced["clipboard_get"] = backend_get.bind(state)
    replaced["clipboard_set"] = backend_set.bind(state)
    replaced["vibrate"] = backend_vibrate.bind(state)
    replaced["cancel_vibration"] = backend_cancel.bind(state)
  return replaced

# ---- applications, roots and JS ----
func make_application(name: String, state: Dictionary, everything: bool) -> Node:
  var application: Node = ClassDB.instantiate("FabricApplication")
  application.name = name
  application.set("bundle_path", "res://build/device-services-probe.js")
  application.set_meta("validation_device_services", overlay(state, everything))
  root.add_child(application)
  apps[name] = application
  return application

func mount(app_name: String, root_name: String, x: int) -> void:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = app_name + root_name
  surface.position = Vector2(x, 0)
  surface.size = Vector2(140, 60)
  surface.set("application_path", NodePath("../" + app_name))
  surface.set("component_name", "DeviceServicesProbe")
  surface.set("initial_props", {"name": root_name})
  surfaces[app_name + root_name] = surface
  root.add_child(surface)
  await settle()

func js(app_name: String, expression: String) -> Variant:
  return JSON.parse_string(apps[app_name].call("evaluate", "JSON.stringify(" + expression + ")"))

func run_js(app_name: String, expression: String) -> void:
  apps[app_name].call("evaluate", expression)

func native(app_name: String) -> Dictionary:
  return JSON.parse_string(apps[app_name].call("snapshot"))

func services(app_name: String) -> Dictionary:
  var value: Variant = native(app_name).get("deviceServices", {})
  return value if value is Dictionary else {}

func modules_of(app_name: String) -> Dictionary:
  var value: Variant = services(app_name).get("modules", {})
  return value if value is Dictionary else {}

func linking_of(app_name: String) -> Dictionary:
  var value: Variant = services(app_name).get("linking", {})
  return value if value is Dictionary else {}

# Before the first root mounts there is no runtime and no bundle, so nothing to read.
func snapshot_of(app_name: String) -> Dictionary:
  var value: Variant = null
  if native(app_name).get("runtimeInitialized", false):
    value = js(app_name, "DeviceServicesProbe.snapshot()")
  return value if value is Dictionary else {"calls": [], "events": [], "listeners": {}, "roots": {}, "library": [], "access": {}, "retained": {}}

func url_event_count(snapshot: Dictionary) -> int:
  return snapshot.events.filter(func(event: Dictionary) -> bool: return not event.get("cleanup", false)).size()

# One command of a step. Each is a Dictionary, kept in the report so that the
# oracle can replay it; deliver stores its result in the command.
func exec(app_name: String, command: Dictionary) -> void:
  var state: Dictionary = backends[app_name]
  match command["do"]:
    "call":
      run_js(app_name, "DeviceServicesProbe.run(...%s)" % JSON.stringify(
        [command.label, command.get("root", "A"), command.api, command.get("args", [])]))
    "direct":
      run_js(app_name, "DeviceServicesProbe.direct(...%s)" % JSON.stringify(
        [command.label, command.module, command.method, command.get("args", [])]))
    "same_tick":
      run_js(app_name, "DeviceServicesProbe.sameTick(...%s)" % JSON.stringify([command.label, command.get("root", "A"), command.value]))
    "read":
      command["result"] = js(app_name, "DeviceServicesProbe.read(%s)" % JSON.stringify(command.api))
    "retain":
      command["result"] = js(app_name, "DeviceServicesProbe.retain()")
    "subscribe":
      run_js(app_name, "DeviceServicesProbe.subscribe(%s)" % JSON.stringify(command.root))
    "unsubscribe":
      run_js(app_name, "DeviceServicesProbe.unsubscribe(%s)" % JSON.stringify(command.root))
    "external":
      state.pasteboard = command.value
    "available":
      state.available = command.value
    "open_code":
      state.open_code = command.code
    "deliver":
      # The preceding host has no deliver_url; calling a missing method is an engine error.
      command["result"] = apps[app_name].call("deliver_url", command.url) if apps[app_name].has_method("deliver_url") else null
    "unmount":
      surfaces[command.surface].call("unmount")
    "settle":
      await settle(command.get("frames", 6))
    "wait_vibrations":
      var baseline: int = command.get("since", 0)
      command["reached"] = false
      if vibration_available:
        command["reached"] = await wait_for(func() -> bool: return vibrations(state, baseline) >= command.count)
    "stop":
      apps[app_name].call("stop")

func vibrations(state: Dictionary, since := 0) -> int:
  var count := 0
  for index in range(since, state.log.size()):
    if state.log[index][0] == "vibrate":
      count += 1
  return count

# Runs the commands in order, lets the frames settle, and keeps everything that
# happened: the commands, the calls JS recorded, the events, the backend log and the
# native counters.
func step(app_name: String, name: String, commands: Array) -> Dictionary:
  var state: Dictionary = backends[app_name]
  var before := snapshot_of(app_name)
  var log_before: int = state.log.size()
  for command: Dictionary in commands:
    await exec(app_name, command)
  await settle()
  var after := snapshot_of(app_name)
  var record := {"commands": commands, "calls": after.calls.slice(before.calls.size()),
    "events": after.events.slice(before.events.size()), "backendLog": state.log.slice(log_before),
    "pasteboard": state.pasteboard, "js": after, "services": services(app_name)}
  stages[app_name][name] = record
  return record

# One group of the native counters of a step; empty on a host without the device services.
func group(record: Dictionary, name: String) -> Dictionary:
  var value: Variant = record.services.get(name, {})
  return value if value is Dictionary else {}

func call_of(record: Dictionary, label: String) -> Dictionary:
  for entry: Dictionary in record.calls:
    if entry.label == label:
      return entry
  return {}

func resolved(record: Dictionary, label: String, value: Variant) -> bool:
  var entry := call_of(record, label)
  return entry.get("state") == "resolved" and entry.get("value") == value

func rejected(record: Dictionary, label: String, pattern: String) -> bool:
  var entry := call_of(record, label)
  return entry.get("state") == "rejected" and str(entry.get("error")).contains(pattern)

func threw(record: Dictionary, label: String, pattern: String) -> bool:
  var entry := call_of(record, label)
  return entry.get("state") == "threw" and str(entry.get("error")).contains(pattern)

func delivered_urls(record: Dictionary) -> Array:
  return record.events.filter(func(event: Dictionary) -> bool: return not event.get("cleanup", false)).map(
    func(event: Dictionary) -> Array: return [event.listener, event.url])

func make(label: String, api: String, args := [], root_name := "A") -> Dictionary:
  return {"do": "call", "label": label, "api": api, "args": args, "root": root_name}

func _initialize() -> void:
  var user := OS.get_cmdline_user_args()
  backends = {"A": new_backend(), "R": new_backend()}
  allow_original_negative = user.has("--allow-original-negative")
  sabotage = user.has("--sabotage")
  launch_only = user.has(LAUNCH_ONLY)
  for argument: String in user:
    if argument.begins_with("--launch-expected="):
      expected_launch = argument.trim_prefix("--launch-expected=")
  call_deferred("run_probe")

func run_probe() -> void:
  root.size = Vector2i(480, 80)
  var headless := DisplayServer.get_name() == "headless"
  # Both clipboard checks of the real backend rest on this: the headless
  # DisplayServer reports no clipboard, and asking it would log an engine error.
  check(headless and not DisplayServer.has_feature(DisplayServer.FEATURE_CLIPBOARD),
    "environment/The headless DisplayServer reports no clipboard feature")
  if launch_only:
    await run_launch_only()
  else:
    await run_validation_application()
    await run_real_application()
  await finish()

# ---------------------------------------------------------------- application A
func run_validation_application() -> void:
  var state: Dictionary = backends.A
  state.pasteboard = "pasteboard before the application"
  make_application("A", state, true)
  # A deep link before any runtime exists is accepted and reaches no JS: nothing
  # reads Linking yet, and the host buffers nothing for later.
  var early: Dictionary = await step("A", "early", [{"do": "deliver", "url": "godotfabric://early/before-runtime"}])
  normative(early.commands[0].result == true and int(linking_of("A").get("urlsUnobserved", -1)) == 1
    and int(linking_of("A").get("urlsObserved", -1)) == 0 and int(linking_of("A").get("urlsAccepted", -1)) == 1,
    "early/A deep link before the runtime exists is accepted and observed by no module")
  normative(linking_of("A").get("launchUrl") == (expected_launch if expected_launch != "" else null),
    "early/The application read the launch URL from the process arguments")
  await mount("A", "A", 0)
  await mount("A", "B", 160)
  var app := native("A")
  check(int(app.rootCount) == 2 and surfaces.AA.call("get_surface_id") > 0 and surfaces.AB.call("get_surface_id") > 0 and app.errors.is_empty(),
    "mount/Two actual roots mount through the original AppRegistry in one Hermes application")
  var created := modules_of("A")
  normative(int(created.get("LinkingManager", -1)) == 0 and int(created.get("Clipboard", -1)) == 0 and int(created.get("Vibration", -1)) == 0
    and not services("A").is_empty() and services("A").stopped == false,
    "mount/No device module exists until JS first reads its API")

  # Each module is created by the first read of its public API, and by nothing else.
  var lazy_clipboard: Dictionary = await step("A", "lazy-clipboard", [{"do": "read", "api": "Clipboard"}])
  var read_clipboard: Dictionary = lazy_clipboard.commands[0].result
  normative(read_clipboard.available == true and read_clipboard.sameAsOriginal == true and read_clipboard.error == null
    and int(group(lazy_clipboard, "modules").get("Clipboard", -1)) == 1 and int(group(lazy_clipboard, "modules").get("LinkingManager", -1)) == 0
    and int(group(lazy_clipboard, "modules").get("Vibration", -1)) == 0,
    "lazy/Reading Clipboard creates RN's original Clipboard and only the Clipboard module")
  var lazy_vibration: Dictionary = await step("A", "lazy-vibration", [{"do": "read", "api": "Vibration"}])
  var read_vibration: Dictionary = lazy_vibration.commands[0].result
  vibration_available = read_vibration.available == true
  normative(read_vibration.available == true and read_vibration.sameAsOriginal == true
    and int(group(lazy_vibration, "modules").get("Vibration", -1)) == 1 and int(group(lazy_vibration, "modules").get("LinkingManager", -1)) == 0,
    "lazy/Reading Vibration creates RN's original Vibration and only the Vibration module")
  var lazy_linking: Dictionary = await step("A", "lazy-linking", [{"do": "read", "api": "Linking"}, {"do": "retain"}])
  var read_linking: Dictionary = lazy_linking.commands[0].result
  # Linking.js looks its module up when it is imported, so the public Linking is
  # available either way; only the native module differs.
  check(read_linking.available == true and read_linking.sameAsOriginal == true,
    "lazy/Reading Linking yields RN's original Linking")
  normative(int(group(lazy_linking, "modules").get("LinkingManager", -1)) == 1
    and lazy_linking.commands[1].result == {"LinkingManager": true, "Clipboard": true, "Vibration": true}
    and int(group(lazy_linking, "modules").get("Clipboard", -1)) == 1 and int(group(lazy_linking, "modules").get("Vibration", -1)) == 1,
    "lazy/Linking creates the LinkingManager module, and looking the modules up again creates no second one")

  await run_clipboard_steps()
  await run_linking_steps()
  await run_deep_link_steps()
  await run_vibration_steps()
  await run_hazard_and_stop()

func run_clipboard_steps() -> void:
  var ascii: Dictionary = await step("A", "clipboard-ascii", [make("set", "Clipboard.setString", ["hello"], "A"), {"do": "settle"},
    make("get", "Clipboard.getString", [], "B")])
  normative(resolved(ascii, "get", "hello") and ascii.backendLog == [["set", "hello"], ["get"]],
    "clipboard/ASCII text written on behalf of root A is read back on behalf of root B, through the application's one Clipboard module")
  normative(call_of(ascii, "set").get("state") == "returned" and call_of(ascii, "set").get("valueUndefined") == true,
    "clipboard/setString returns nothing, as RN's Clipboard does")
  var text := "héllo 日本語 🚀 é́ end"
  var unicode: Dictionary = await step("A", "clipboard-unicode", [make("set", "Clipboard.setString", [text]), make("get", "Clipboard.getString", [], "B")])
  normative(resolved(unicode, "get", text) and unicode.backendLog == [["set", text], ["get"]],
    "clipboard/Multibyte text, an astral emoji and a combining mark survive the round trip")
  var lines := "first\nsecond\r\nthird\n\n"
  var newlines: Dictionary = await step("A", "clipboard-newlines", [make("set", "Clipboard.setString", [lines]), make("get", "Clipboard.getString")])
  normative(resolved(newlines, "get", lines), "clipboard/Line breaks, including CRLF and a trailing blank line, survive the round trip")
  var empty: Dictionary = await step("A", "clipboard-empty", [make("set", "Clipboard.setString", [""]), make("get", "Clipboard.getString")])
  normative(resolved(empty, "get", "") and empty.backendLog == [["set", ""], ["get"]],
    "clipboard/The empty string is a value: an empty clipboard resolves '' and not null")
  var overwrite: Dictionary = await step("A", "clipboard-overwrite", [make("first", "Clipboard.setString", ["first"]), make("second", "Clipboard.setString", ["second"]),
    make("get", "Clipboard.getString")])
  normative(resolved(overwrite, "get", "second") and overwrite.backendLog == [["set", "first"], ["set", "second"], ["get"]],
    "clipboard/A second write replaces the first")
  var external: Dictionary = await step("A", "clipboard-external", [{"do": "external", "value": "changed outside the application"},
    make("get", "Clipboard.getString", [], "B")])
  normative(resolved(external, "get", "changed outside the application"),
    "clipboard/A change made outside the application is what getString reads next")
  var again: Dictionary = await step("A", "clipboard-external-again", [{"do": "external", "value": "changed twice"}, make("get", "Clipboard.getString")])
  normative(resolved(again, "get", "changed twice") and again.backendLog == [["get"]],
    "clipboard/Every getString asks the platform, so a second outside change shows too")
  var same_tick: Dictionary = await step("A", "clipboard-same-tick", [{"do": "same_tick", "label": "tick", "value": "set and read in one turn"}])
  normative(resolved(same_tick, "tick/get", "set and read in one turn") and same_tick.backendLog == [["set", "set and read in one turn"], ["get"]],
    "clipboard/A set followed by a get in the same JavaScript turn reads the new text")
  var bridge: Dictionary = await step("A", "clipboard-bridge", [make("undefined", "Clipboard.setString", []), make("number", "Clipboard.setString", [42])])
  normative(call_of(bridge, "undefined").get("state") == "threw" and bridge.backendLog.is_empty(),
    "clipboard/setString(undefined) fails at the bridge and reaches no clipboard")
  normative(call_of(bridge, "number").get("state") == "threw", "clipboard/setString(42) fails at the bridge")
  var unavailable: Dictionary = await step("A", "clipboard-unavailable", [{"do": "available", "value": false},
    make("get", "Clipboard.getString"), make("set", "Clipboard.setString", ["nobody reads this"]), {"do": "available", "value": true},
    make("after", "Clipboard.getString")])
  normative(rejected(unavailable, "get", "E_CLIPBOARD_UNAVAILABLE") and threw(unavailable, "set", "E_CLIPBOARD_UNAVAILABLE"),
    "clipboard/An unavailable clipboard rejects getString and throws from setString with E_CLIPBOARD_UNAVAILABLE")
  normative(unavailable.backendLog == [["get"]] and resolved(unavailable, "after", "set and read in one turn"),
    "clipboard/An unavailable clipboard reaches no backend read or write, and the clipboard works once it is available again")

func run_linking_steps() -> void:
  var valid := ["https://example.com", "http://127.0.0.1:8080/a?b=1#c", "godotfabric://open/42", "mailto:a@b.c", "tel:+15555550100",
    "geo:37.48,-122.14", "x-custom+scheme.v2:rest", "file:///tmp/x"]
  var invalid := ["example.com", "example.com/path", "//example.com", "/tmp/file", "a:", "https:", "1http://x", "ht tp://x", "555-0100"]
  var commands: Array = []
  for url: String in valid:
    commands.append(make("can " + url, "Linking.canOpenURL", [url]))
  for url: String in invalid:
    commands.append(make("can " + url, "Linking.canOpenURL", [url]))
  var can: Dictionary = await step("A", "linking-can-open", commands)
  normative(valid.all(func(url: String) -> bool: return resolved(can, "can " + url, true)),
    "linking/canOpenURL resolves true for every absolute URL with an RFC 3986 scheme")
  normative(invalid.all(func(url: String) -> bool: return resolved(can, "can " + url, false)),
    "linking/canOpenURL resolves false for a string without a scheme or with nothing after it")
  normative(can.backendLog.is_empty() and resolved(can, "can https://example.com", true),
    "linking/canOpenURL answers without asking a backend, since Godot cannot query installed handlers")

  var url := "https://example.com/path?q=1&r=é"
  var opened: Dictionary = await step("A", "linking-open", [make("open", "Linking.openURL", [url]), make("custom", "Linking.openURL", ["godotfabric://open/42"])])
  normative(resolved(opened, "open", true) and resolved(opened, "custom", true)
    and opened.backendLog == [["open", url], ["open", "godotfabric://open/42"]],
    "linking/openURL resolves true and the backend saw each URL exactly once, byte for byte")
  var refused: Dictionary = await step("A", "linking-open-refused", [{"do": "open_code", "code": ERR_UNAVAILABLE},
    make("refused", "Linking.openURL", ["https://refused.example"]), {"do": "open_code", "code": 0}])
  normative(rejected(refused, "refused", "Unable to open URL: https://refused.example") and refused.backendLog == [["open", "https://refused.example"]],
    "linking/A backend that fails rejects openURL with RN's message, after being asked once")
  var invalid_open: Dictionary = await step("A", "linking-open-invalid", [make("no-scheme", "Linking.openURL", ["example.com/no-scheme"]),
    make("colon", "Linking.openURL", ["https:"])])
  normative(rejected(invalid_open, "no-scheme", "Unable to open URL: example.com/no-scheme") and rejected(invalid_open, "colon", "Unable to open URL: https:")
    and invalid_open.backendLog.is_empty(),
    "linking/A URL without a scheme is rejected before the backend, which would have opened it")
  # RN's own invariants stop these before any native call.
  var javascript: Dictionary = await step("A", "linking-open-javascript", [make("empty", "Linking.openURL", [""]), make("number", "Linking.openURL", [42]),
    make("null", "Linking.openURL", [null]), make("can-empty", "Linking.canOpenURL", [""])])
  check(threw(javascript, "empty", "Invalid URL: cannot be empty") and threw(javascript, "number", "Invalid URL: should be a string. Was: 42")
    and threw(javascript, "null", "Invalid URL: should be a string. Was: null") and threw(javascript, "can-empty", "Invalid URL: cannot be empty"),
    "linking/openURL('') and a non-string fail RN's own invariant without calling the native module")
  check(javascript.backendLog.is_empty(), "linking/The JavaScript invariants reach no backend")
  var rest: Dictionary = await step("A", "linking-settings", [make("settings", "Linking.openSettings"), make("intent", "Linking.sendIntent", ["android.intent.action.VIEW"])])
  normative(rejected(rest, "settings", "Unable to open app settings: unavailable on Godot"),
    "linking/openSettings rejects with an explicit error and never resolves in silence")
  check(rejected(rest, "intent", "Unsupported"), "linking/sendIntent rejects in RN's JavaScript outside Android")
  var initial: Dictionary = await step("A", "linking-initial", [make("initial", "Linking.getInitialURL")])
  normative(resolved(initial, "initial", expected_launch if expected_launch != "" else null),
    "linking/getInitialURL resolves the --uri= this process was started with")

func run_deep_link_steps() -> void:
  var subscribed: Dictionary = await step("A", "deep-link-subscribe", [{"do": "subscribe", "root": "library"}, {"do": "subscribe", "root": "A"}, {"do": "subscribe", "root": "B"}])
  check(subscribed.js.listeners.url == 3 and subscribed.js.library == ["url"] and subscribed.js.roots.A.subscriptions == ["url"]
    and subscribed.js.roots.B.subscriptions == ["url"],
    "deep-link/The library and both roots subscribe to Linking's url event through RN's device emitter")
  var one: Dictionary = await step("A", "deep-link-one", [{"do": "deliver", "url": "godotfabric://deep/1"}])
  normative(one.commands[0].result == true and delivered_urls(one) == [["library", "godotfabric://deep/1"], ["A", "godotfabric://deep/1"], ["B", "godotfabric://deep/1"]],
    "deep-link/deliver_url reaches the listeners of both roots exactly once each, in subscription order")
  normative(one.events.size() == 3 and one.events.all(func(event: Dictionary) -> bool: return event.fields == ["url"]),
    "deep-link/Each url event carries exactly {url}")
  var two: Dictionary = await step("A", "deep-link-order", [{"do": "deliver", "url": "https://example.com/second?x=1&y=é"}, {"do": "deliver", "url": "godotfabric://deep/third"}])
  var expected_order: Array = []
  for url: String in ["https://example.com/second?x=1&y=é", "godotfabric://deep/third"]:
    for listener: String in ["library", "A", "B"]:
      expected_order.append([listener, url])
  normative(delivered_urls(two) == expected_order, "deep-link/Two links delivered back to back arrive in order at every listener")
  var rejected_links: Dictionary = await step("A", "deep-link-invalid", [{"do": "deliver", "url": "no-scheme"}, {"do": "deliver", "url": ""}, {"do": "deliver", "url": "a:"}])
  normative(rejected_links.commands.all(func(command: Dictionary) -> bool: return command.result == false) and rejected_links.events.is_empty()
    and int(group(rejected_links, "linking").get("urlsRejected", -1)) == 3,
    "deep-link/deliver_url returns false and emits nothing for a string without a URL scheme")
  var removed: Dictionary = await step("A", "deep-link-remove", [{"do": "unsubscribe", "root": "A"}, {"do": "deliver", "url": "godotfabric://deep/after-remove"}])
  normative(removed.js.listeners.url == 2 and delivered_urls(removed) == [["library", "godotfabric://deep/after-remove"], ["B", "godotfabric://deep/after-remove"]],
    "deep-link/A removed subscription (removed twice) stops receiving links and the others still do")
  var unmounted: Dictionary = await step("A", "deep-link-unmount", [{"do": "unmount", "surface": "AA"}, {"do": "settle"}, {"do": "deliver", "url": "godotfabric://deep/after-unmount"},
    {"do": "settle"}, make("clipboard", "Clipboard.setString", ["written after root A unmounted"], "B"), make("read", "Clipboard.getString", [], "B"),
    make("open", "Linking.openURL", ["godotfabric://still/works"], "B"), make("initial", "Linking.getInitialURL", [], "B")])
  normative(delivered_urls(unmounted) == [["library", "godotfabric://deep/after-unmount"], ["B", "godotfabric://deep/after-unmount"]]
    and resolved(unmounted, "read", "written after root A unmounted") and resolved(unmounted, "open", true)
    and resolved(unmounted, "initial", expected_launch if expected_launch != "" else null),
    "deep-link/Unmounting root A keeps the device services and the links for root B")
  check(unmounted.js.roots.A.mounted == false and int(unmounted.js.roots.A.cleanups) == 1 and unmounted.js.roots.B.mounted == true
    and int(native("A").rootCount) == 1,
    "deep-link/Root A unmounts through its effect cleanup while root B stays mounted")
  var stable: Dictionary = await step("A", "linking-initial-stable", [make("initial", "Linking.getInitialURL", [], "B")])
  normative(resolved(stable, "initial", expected_launch if expected_launch != "" else null),
    "deep-link/getInitialURL is stable for the application: link events do not change it")

func run_vibration_steps() -> void:
  var state: Dictionary = backends.A
  var defaults: Dictionary = await step("A", "vibration-default", [make("default", "Vibration.vibrate"), make("explicit", "Vibration.vibrate", [250])])
  normative(defaults.backendLog == [["vibrate", 400], ["vibrate", 250]],
    "vibration/vibrate() uses RN's default of 400 and vibrate(250) passes 250 on")
  var start: int = state.log.size()
  var pattern_commands: Array = [make("pattern", "Vibration.vibrate", [[0, 100, 50, 100]]),
    {"do": "wait_vibrations", "since": start, "count": 4}]
  var pattern: Dictionary = await step("A", "vibration-pattern", pattern_commands)
  normative(pattern.commands[1].reached == true and pattern.backendLog == [["vibrate", 400], ["vibrate", 400], ["vibrate", 400], ["vibrate", 400]],
    "vibration/The pattern [0, 100, 50, 100] vibrates four times, in order, and ends")
  var after_pattern: Dictionary = await step("A", "vibration-after-pattern", [make("after", "Vibration.vibrate", [75])])
  normative(after_pattern.backendLog == [["vibrate", 75]], "vibration/A finished pattern leaves RN free to vibrate again")
  var cancel: Dictionary = await step("A", "vibration-cancel", [make("cancel", "Vibration.cancel")])
  normative(cancel.backendLog == [["cancel"]], "vibration/cancel() reaches the native module")
  var wrong: Dictionary = await step("A", "vibration-argument", [make("string", "Vibration.vibrate", ["x"]), make("object", "Vibration.vibrate", [{"duration": 1}])])
  normative(threw(wrong, "string", "Vibration pattern should be a number or array") and threw(wrong, "object", "Vibration pattern should be a number or array")
    and wrong.backendLog.is_empty(),
    "vibration/vibrate('x') throws RN's own error and calls nothing native")
  var native_arguments: Dictionary = await step("A", "vibration-native-arguments", [make("negative", "Vibration.vibrate", [-5]),
    make("infinite", "Vibration.vibrate", [{"$number": "Infinity"}]), make("nan", "Vibration.vibrate", [{"$number": "NaN"}]),
    {"do": "direct", "label": "by-pattern", "module": "Vibration", "method": "vibrateByPattern", "args": [[1, 2], 0]}])
  normative(native_arguments.backendLog.is_empty() and threw(native_arguments, "negative", "E_ARGUMENT") and threw(native_arguments, "infinite", "E_ARGUMENT")
    and threw(native_arguments, "nan", "E_ARGUMENT") and threw(native_arguments, "by-pattern", "E_UNSUPPORTED"),
    "vibration/A negative or non-finite duration and a direct vibrateByPattern fail explicitly, are not accepted in silence and reach no backend")
  var constants: Dictionary = await step("A", "vibration-constants", [{"do": "direct", "label": "clipboard", "module": "Clipboard", "method": "getConstants"},
    {"do": "direct", "label": "vibration", "module": "Vibration", "method": "getConstants"}])
  normative(call_of(constants, "clipboard").get("state") == "returned" and call_of(constants, "vibration").get("state") == "returned",
    "vibration/getConstants of Clipboard and Vibration return an empty object")

func run_hazard_and_stop() -> void:
  var state: Dictionary = backends.A
  # RN's own Vibration.js leaves _vibrating set when a repeating pattern runs and
  # cancel() only reaches the native module (Vibration.js:90,106-110): the pattern
  # keeps going and a later vibrate() is ignored. That is upstream behavior and
  # the host must not "fix" it.
  var start: int = state.log.size()
  var repeat: Dictionary = await step("A", "hazard-repeat", [make("repeat", "Vibration.vibrate", [[0, 20, 20], true]),
    {"do": "wait_vibrations", "since": start, "count": 6}])
  var at_cancel: int = vibrations(state, start)
  var cancelled: Dictionary = await step("A", "hazard-cancel", [make("cancel", "Vibration.cancel"), {"do": "wait_vibrations", "since": start, "count": at_cancel + 4}])
  var ignored: Dictionary = await step("A", "hazard-ignored", [make("ignored", "Vibration.vibrate", [100])])
  var at_stop: int = vibrations(state, start)
  normative(repeat.commands[1].reached == true and cancelled.commands[1].reached == true and cancelled.backendLog.filter(
    func(entry: Array) -> bool: return entry[0] == "vibrate").size() >= 4,
    "hazard/A repeating pattern is not cancelled by cancel(): it keeps vibrating, as in RN")
  normative(cancelled.backendLog.has(["cancel"]) and not ignored.backendLog.has(["vibrate", 100]) and call_of(ignored, "ignored").get("state") == "returned",
    "hazard/cancel() reaches the native module, and a later vibrate(100) is ignored by RN while the pattern runs")

  # Stop. Retained modules and the public API fail with E_MODULE_DISPOSED, no
  # link is delivered, no backend is called and the pattern's timers are gone.
  var before := snapshot_of("A")
  var log_before: int = state.log.size()
  var stopped: Dictionary = await step("A", "stop", [{"do": "stop"}, {"do": "settle"},
    {"do": "direct", "label": "initial", "module": "LinkingManager", "method": "getInitialURL"},
    {"do": "direct", "label": "can-open", "module": "LinkingManager", "method": "canOpenURL", "args": ["https://example.com"]},
    {"do": "direct", "label": "open", "module": "LinkingManager", "method": "openURL", "args": ["https://example.com"]},
    {"do": "direct", "label": "settings", "module": "LinkingManager", "method": "openSettings"},
    {"do": "direct", "label": "get", "module": "Clipboard", "method": "getString"},
    {"do": "direct", "label": "set", "module": "Clipboard", "method": "setString", "args": ["after stop"]},
    {"do": "direct", "label": "vibrate", "module": "Vibration", "method": "vibrate", "args": [50]},
    {"do": "direct", "label": "cancel", "module": "Vibration", "method": "cancel"},
    make("public-get", "Clipboard.getString"), make("public-open", "Linking.openURL", ["https://example.com"]),
    {"do": "deliver", "url": "godotfabric://deep/after-stop"}, {"do": "deliver", "url": "no-scheme"}, {"do": "settle", "frames": 30}])
  var disposed := ["initial", "can-open", "open", "settings", "get", "set", "vibrate", "cancel", "public-get", "public-open"]
  normative(disposed.all(func(label: String) -> bool: return threw(stopped, label, "E_MODULE_DISPOSED")),
    "stop/A retained module or the public API throws E_MODULE_DISPOSED synchronously after stop")
  normative(stopped.commands[stopped.commands.size() - 3].result == false and stopped.commands[stopped.commands.size() - 2].result == false
    and stopped.events.filter(func(event: Dictionary) -> bool: return not event.get("cleanup", false)).is_empty(),
    "stop/deliver_url returns false after stop and nothing is emitted")
  normative(stopped.services.get("stopped") == true and stopped.backendLog.is_empty(), "stop/The stopped services call no backend")
  var timers_gone: int = vibrations(state, start)
  await settle(30)
  normative(vibrations(state, start) == timers_gone and timers_gone >= at_stop and at_stop >= 10,
    "stop/Stop clears the timers of the repeating pattern: no vibration arrives after it")
  check(stopped.js.library == ["url"] and url_event_count(stopped.js) == url_event_count(before),
    "stop/The never-removed library listener received no link after stop")
  var final_native := native("A")
  check(final_native.stopped and int(final_native.rootCount) == 0 and final_native.errors.is_empty() and state.log.size() >= log_before,
    "stop/Stop releases every root of the application without diagnostics")
  for name: String in ["AA", "AB"]:
    var root_state: Dictionary = JSON.parse_string(surfaces[name].call("snapshot"))
    check(int(root_state.nativeTags) == 0 and int(root_state.creates) == int(root_state.deletes),
      "stop/" + name + "/All native Controls of the root are balanced")

# ---------------------------------------------------------------- application R
func run_real_application() -> void:
  # Nothing in this application may open a URL: its open_url stand-in always fails.
  backends.R.open_code = ERR_UNAVAILABLE
  make_application("R", backends.R, false)
  await mount("R", "R", 320)
  var real_clipboard: Dictionary = await step("R", "real-clipboard", [make("get", "Clipboard.getString", [], "R"), make("set", "Clipboard.setString", ["never stored"], "R")])
  normative(rejected(real_clipboard, "get", "E_CLIPBOARD_UNAVAILABLE") and threw(real_clipboard, "set", "E_CLIPBOARD_UNAVAILABLE"),
    "real/The headless DisplayServer has no clipboard: getString rejects and setString throws E_CLIPBOARD_UNAVAILABLE")
  normative(int(group(real_clipboard, "clipboard").get("unavailable", -1)) == 2 and int(group(real_clipboard, "clipboard").get("reads", -1)) == 0
    and int(group(real_clipboard, "clipboard").get("writes", -1)) == 0,
    "real/The unavailable clipboard was reported twice and read or written never")
  var real_vibration: Dictionary = await step("R", "real-vibration", [make("vibrate", "Vibration.vibrate", [30], "R"), make("cancel", "Vibration.cancel", [], "R")])
  normative(call_of(real_vibration, "vibrate").get("state") == "returned" and call_of(real_vibration, "cancel").get("state") == "returned"
    and int(group(real_vibration, "vibration").get("vibrations", -1)) == 1 and int(group(real_vibration, "vibration").get("cancels", -1)) == 1,
    "real/Godot's Input.vibrate_handheld is a silent no-op on this platform and cancel has nothing to stop")
  var real_link: Dictionary = await step("R", "real-linking", [make("initial", "Linking.getInitialURL", [], "R"), make("can", "Linking.canOpenURL", ["https://example.com"], "R"),
    make("open", "Linking.openURL", ["https://example.com"], "R")])
  normative(resolved(real_link, "initial", expected_launch if expected_launch != "" else null) and resolved(real_link, "can", true),
    "real/getInitialURL reads this process's own --uri= argument")
  normative(rejected(real_link, "open", "Unable to open URL: https://example.com") and real_link.backendLog == [["open", "https://example.com"]],
    "real/The refusing open_url stand-in is the only thing openURL reached: no real URL opens")
  await step("R", "stop", [{"do": "stop"}, {"do": "settle"}])
  var final_native := native("R")
  check(final_native.stopped and int(final_native.rootCount) == 0 and final_native.errors.is_empty(),
    "real/Stop releases the real-backend application without diagnostics")

func run_launch_only() -> void:
  make_application("R", backends.R, false)
  await mount("R", "R", 0)
  var launch: Dictionary = await step("R", "launch", [make("initial", "Linking.getInitialURL", [], "R")])
  normative(resolved(launch, "initial", null) and group(launch, "linking").get("launchUrl", "missing") == null,
    "launch/getInitialURL resolves null when the process was started without --uri=")
  await step("R", "stop", [{"do": "stop"}, {"do": "settle"}])

func finish() -> void:
  for surface: Control in surfaces.values():
    surface.queue_free()
  for application: Node in apps.values():
    application.queue_free()
  await settle(2)
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var observed := failures.duplicate()
  var expected := expected_original_failures.duplicate()
  observed.sort()
  expected.sort()
  var original_negative_observed := allow_original_negative and observed == expected and not failures.is_empty()
  var sabotage_observed := sabotage and not failures.is_empty()
  var report := {"scenario": "native-device-services", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "launchOnly": launch_only, "expectedLaunch": expected_launch if expected_launch != "" else null,
    "checks": checks, "stages": stages, "expectedOriginalFailures": expected_original_failures,
    "allowOriginalNegative": allow_original_negative, "originalNegativeObserved": original_negative_observed,
    "sabotage": sabotage, "allCurrentAssertionsPassed": failures.is_empty(),
    "scope": {"actualGodotBackendInHeadless": true, "validationBackendRecordsEveryCall": true, "publicReactNativeImport": true,
      "twoRootsOneApplication": true, "realClipboardCertified": false, "realOpenURLCertified": false, "realVibrationCertified": false,
      "mobileExportsCertified": false}}
  var path := "res://build/device-services-launch-report.json" if launch_only else "res://build/device-services-report.json"
  var output := FileAccess.open(path, FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_ERROR: cannot write the device services report")
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  output.close()
  var prefix := "DEVICE_SERVICES_LAUNCH" if launch_only else "DEVICE_SERVICES"
  if original_negative_observed:
    print(prefix + "_ORIGINAL_NEGATIVE: " + str(failures.size()))
  elif sabotage_observed:
    print(prefix + "_SABOTAGE_REJECTED: " + str(failures.size()))
  elif failures.is_empty():
    print(prefix + "_PASSED: " + str(checks.size()))
  else:
    print(prefix + "_FAILED")
  quit(0 if failures.is_empty() or original_negative_observed or sabotage_observed else 1)
