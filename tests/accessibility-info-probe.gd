extends SceneTree

# RN's original AccessibilityInfo, run through the public react-native import in two actual FabricApplications,
# each with its own Hermes runtime and the same bundle:
#
#   A  the validation metas (validation_accessibility_settings replaces the DisplayServer's reading of the keys it
#      names; validation_accessibility_announcer replaces the AccessibilityServer, where announcements go, by a recorder
#      that behaves as a screen reader): two roots, every positive and negative check, the events, the announcements
#      and stop. The probe changes a setting by setting the meta again and waits for the polls the host counts, never
#      for time. It never sends NOTIFICATION_ACCESSIBILITY_UPDATE: the recorder runs the update the engine would.
#   R  the real Godot backend. The headless DisplayServer reports every setting as -1 and has no screen reader, so every
#      getter must reject, no event may ever arrive and every announcement is dropped; the application runs next to A
#      and outlives it.
#
# The probe judges order and counts, never time. Each step lists the commands it ran; the independent oracle
# (accessibility-info-oracle.mjs) replays them against a model written from RN's rules and compares calls, events,
# counters and the calls the announcer made to the platform. No check here says that a screen reader spoke: what AccessKit
# posts to the system is the local graphical run's (accessibility-announcements-bridge.test.mjs).
const META := "validation_accessibility_settings"
const ANNOUNCER := "validation_accessibility_announcer"
const DEVICE_EVENTS := ["screenReaderChanged", "reduceMotionChanged", "reduceTransparencyChanged", "darkerSystemColorsChanged",
  "boldTextChanged", "grayscaleChanged", "invertColorsChanged", "announcementFinished"]
const SILENT_EVENTS := ["boldTextChanged", "grayscaleChanged", "invertColorsChanged", "announcementFinished"]
const FOCUS_MESSAGE := "E_UNSUPPORTED: Godot has a single focus; moving the screen reader's focus would move the keyboard focus and blur the focused control, which iOS does not do"
const QUEUE_MESSAGE := "the macOS accessibility API has no announcement queue"
const PRIORITY_MESSAGE := "AccessKit has only polite and assertive"
# What the preceding host (GF-20 slice 2a) says for a focus event and for each announcement: it names the slice that was to do it.
const OLD_MESSAGE := "focus is not implemented yet (GF-20 slice 2b)"
# The engine API the announcements use, by name. The oracle keeps its own list; the host reports the one it uses.
const ANNOUNCEMENT_API := {
  "server": "AccessibilityServer",
  "methods": ["is_supported", "create_sub_element", "update_set_value", "update_set_live", "free_element"],
  "constants": ["ROLE_STATIC_TEXT", "LIVE_POLITE", "LIVE_ASSERTIVE"],
  "tree": "is_accessibility_enabled",
  "node": ["get_accessibility_element", "queue_accessibility_update"],
}
const PREFIX := "AccessibilityInfo."

var checks: Array = []
var stages := {"A": {}, "R": {}}
var expected_original_failures: Array = []
var allow_original_negative := false
var sabotage := false
var surfaces := {}
var apps := {}
# The meta each application started with (null for the one that uses the real backend), which the oracle needs to
# know what the platform reported before the first command.
var initial_meta := {}
# The recorder's settings each application started with (null for the one that announces to the real server).
var initial_announcer := {}
# What the engine says of the API the announcements use, asked of the engine itself: whether each name exists, and the answers
# of the headless server and tree, which the oracle compares with what the host reports.
var announce_facts := {}
# What the real backend's application says each setting reads, and what the DisplayServer says to this script: the oracle
# compares the method names with its own list of the engine's.
var display_facts := {}
# How many of the accessibility events the probe sent through the public API were "focus". The log of the run holds one engine
# error for each of them, on this host and on the preceding one (the other types are ignored without a diagnostic).
var sent_focus := 0

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

# A normative check needs what this slice added: an announcement the host speaks or drops with a reason, and the reason the
# focus is refused. The preceding host (GF-20 slice 2a) refuses all of it as "not implemented yet", so it must fail exactly
# these checks and pass the others.
func normative(condition: bool, name: String) -> bool:
  expected_original_failures.append(name)
  return check(condition, name)

func settle(count := 6) -> void:
  for index in range(count):
    await process_frame

# ---- applications, roots and JS ----
func make_application(name: String, meta: Variant, announcer: Variant) -> Node:
  var application: Node = ClassDB.instantiate("FabricApplication")
  application.name = name
  application.set("bundle_path", "res://build/accessibility-info-probe.js")
  initial_meta[name] = meta.duplicate() if meta != null else null
  initial_announcer[name] = announcer.duplicate() if announcer != null else null
  if meta != null:
    application.set_meta(META, meta)
  if announcer != null:
    application.set_meta(ANNOUNCER, announcer)
  root.add_child(application)
  apps[name] = application
  return application

func mount(app_name: String, root_name: String, x: int) -> void:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = app_name + root_name
  surface.position = Vector2(x, 0)
  surface.size = Vector2(140, 60)
  surface.set("application_path", NodePath("../" + app_name))
  surface.set("component_name", "AccessibilityInfoProbe")
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

# The host's counters; empty on a host without AccessibilityInfo.
func info_of(app_name: String) -> Dictionary:
  var value: Variant = native(app_name).get("accessibilityInfo", {})
  return value if value is Dictionary else {}

func polls_of(app_name: String) -> int:
  return int(info_of(app_name).get("polls", -1))

# The poll counter is the frames the host has delivered since the module exists: the probe waits for it, not for time.
# It is bounded by a number of frames, so that a host that never polls fails a check and does not hang.
func wait_polls(app_name: String, target: int) -> bool:
  for frame in range(1200):
    if polls_of(app_name) >= target:
      return true
    await process_frame
  return false

# Before the first root mounts there is no runtime and no bundle, so nothing to read.
func snapshot_of(app_name: String) -> Dictionary:
  var value: Variant = null
  if native(app_name).get("runtimeInitialized", false):
    value = js(app_name, "AccessibilityInfoProbe.snapshot()")
  return value if value is Dictionary else {"calls": [], "events": [], "listeners": {}, "roots": {}, "subscriptions": {}, "access": {}, "retained": {}}

# One command of a step. Each is a Dictionary, kept in the report so that the oracle can replay it; a command that
# returns something stores it in the command.
func exec(app_name: String, command: Dictionary) -> void:
  match command["do"]:
    "call":
      run_js(app_name, "AccessibilityInfoProbe.run(...%s)" % JSON.stringify(
        [command.label, command.get("root", "A"), PREFIX + command.api, command.get("args", [])]))
    "send":
      if command.type == "focus":
        sent_focus += 1
      run_js(app_name, "AccessibilityInfoProbe.send(...%s)" % JSON.stringify([command.label, command.get("root", "A"), command.type]))
    "direct":
      run_js(app_name, "AccessibilityInfoProbe.direct(...%s)" % JSON.stringify([command.label, command.method, command.get("args", [])]))
    "read":
      command["result"] = js(app_name, "AccessibilityInfoProbe.read()")
    "android":
      command["result"] = js(app_name, "AccessibilityInfoProbe.androidModule()")
    "retain":
      command["result"] = js(app_name, "AccessibilityInfoProbe.retain()")
    "subscribe":
      command["result"] = js(app_name, "AccessibilityInfoProbe.subscribe(%s)" % JSON.stringify([command.id, command.root, command.event]).trim_prefix("[").trim_suffix("]"))
    "unsubscribe":
      run_js(app_name, "AccessibilityInfoProbe.unsubscribe(%s)" % JSON.stringify(command.id))
    "meta":
      # The platform now reports these values; absent keys are left to the DisplayServer, which reports -1 here.
      apps[app_name].set_meta(META, command.value.duplicate())
    "announcer":
      # The recorder now behaves as these keys say (available, element, delivers; a key left out is true).
      apps[app_name].set_meta(ANNOUNCER, command.value.duplicate())
    "wait":
      var base := polls_of(app_name)
      var reached := true
      if base < 0:
        await settle(int(command.polls) + 3)
      else:
        reached = await wait_polls(app_name, base + int(command.polls))
        await settle(2)
      command["reached"] = reached
    "unmount":
      surfaces[command.surface].call("unmount")
    "settle":
      await settle(command.get("frames", 6))
    "stop":
      apps[app_name].call("stop")

# Runs the commands in order, lets the frames settle, and keeps everything that happened: the commands, the calls
# JS recorded, the events, and the native counters.
func step(app_name: String, name: String, commands: Array) -> Dictionary:
  var before := snapshot_of(app_name)
  for command: Dictionary in commands:
    await exec(app_name, command)
  await settle()
  var after := snapshot_of(app_name)
  var record := {"commands": commands, "calls": after.calls.slice(before.calls.size()),
    "events": after.events.slice(before.events.size()), "js": after, "info": info_of(app_name),
    "errors": native(app_name).get("errors", [])}
  stages[app_name][name] = record
  return record

# ---- reading a step ----
func section(record: Dictionary, key: String) -> Dictionary:
  var value: Variant = record.info.get(key, {})
  return value if value is Dictionary else {}

func setting(record: Dictionary, name: String) -> Dictionary:
  var value: Variant = section(record, "settings").get(name, {})
  return value if value is Dictionary else {}

# A value of the host's counters, or the fallback on a host that has none.
func infov(record: Dictionary, key: String, fallback: Variant = null) -> Variant:
  return record.info.get(key, fallback)

func sv(record: Dictionary, name: String, key: String) -> Variant:
  return setting(record, name).get(key, null)

func modules_created(record: Dictionary) -> int:
  return int(section(record, "modules").get("AccessibilityManager", -1))

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

func returned(record: Dictionary, label: String) -> bool:
  return call_of(record, label).get("state") == "returned"

# What the listeners heard, in order: [subscription, public event name, value].
func rows(record: Dictionary) -> Array:
  return record.events.filter(func(event: Dictionary) -> bool: return not event.get("cleanup", false)).map(
    func(event: Dictionary) -> Array: return [event.id, event.event, event.value])

func counted(record: Dictionary, event: String) -> int:
  return int(section(record, "events").get(event, -1))

# ---- the announcements section of the host's counters ----
func announced(record: Dictionary) -> Dictionary:
  return section(record, "announcements")

# [requested, published, released, pending, held]
func tally(record: Dictionary) -> Array:
  var counters := announced(record)
  return [int(counters.get("requested", -1)), int(counters.get("published", -1)), int(counters.get("released", -1)),
    int(counters.get("pending", -1)), int(counters.get("held", -1))]

# [noScreenReader, empty, expired, stopped]
func dropped(record: Dictionary) -> Array:
  var reasons: Dictionary = announced(record).get("dropped", {})
  return [int(reasons.get("noScreenReader", -1)), int(reasons.get("empty", -1)), int(reasons.get("expired", -1)), int(reasons.get("stopped", -1))]

# [queue, priority]
func refused_announcements(record: Dictionary) -> Array:
  var reasons: Dictionary = announced(record).get("refused", {})
  return [int(reasons.get("queue", -1)), int(reasons.get("priority", -1))]

# [updatesRequested, updates]
func updates_of(record: Dictionary) -> Array:
  var counters := announced(record)
  return [int(counters.get("updatesRequested", -1)), int(counters.get("updates", -1))]

# Every call the announcer made to the recorder so far, as "op handle text".
func ops_of(record: Dictionary) -> Array:
  var result: Array = []
  var recorded: Array = announced(record).get("recorded", [])
  for entry: Dictionary in recorded:
    var line: String = entry.op
    if int(entry.handle) > 0:
      line += " " + str(int(entry.handle))
    if str(entry.text) != "":
      line += " " + str(entry.text)
    result.append(line)
  return result

func refused_of(record: Dictionary, key: String) -> int:
  return int(section(record, "refused").get(key, -1))

func silent_counts(record: Dictionary) -> bool:
  return SILENT_EVENTS.all(func(event: String) -> bool: return counted(record, event) == 0)

func listening(record: Dictionary, event: String) -> int:
  return int(record.js.listeners.get(event, -1))

# ---- commands ----
func meta_of(screen: Variant, motion: Variant, transparency: Variant, contrast: Variant) -> Dictionary:
  var value := {}
  if screen != null:
    value["screen_reader"] = screen
  if motion != null:
    value["reduce_animation"] = motion
  if transparency != null:
    value["reduce_transparency"] = transparency
  if contrast != null:
    value["increase_contrast"] = contrast
  return {"do": "meta", "value": value}

func wait(polls := 3) -> Dictionary:
  return {"do": "wait", "polls": polls}

func make(label: String, api: String, args := [], root_name := "A") -> Dictionary:
  return {"do": "call", "label": label, "api": api, "args": args, "root": root_name}

func sub(id: String, root_name: String, event: String) -> Dictionary:
  return {"do": "subscribe", "id": id, "root": root_name, "event": event}

func direct(label: String, method: String, args := []) -> Dictionary:
  return {"do": "direct", "label": label, "method": method, "args": args}

# The recorder (the validation stand-in for the AccessibilityServer) now behaves as these keys say.
func recorder(value := {}) -> Dictionary:
  return {"do": "announcer", "value": value}

func say(label: String, text: String, root_name := "A") -> Dictionary:
  return make(label, "announceForAccessibility", [text], root_name)

func say_with(label: String, text: String, options: Dictionary, root_name := "A") -> Dictionary:
  return make(label, "announceForAccessibilityWithOptions", [text, options], root_name)

# The four backed getters of the public API, labelled with a prefix.
func backed(prefix: String, root_name := "A") -> Array:
  return [make(prefix + "/screen", "isScreenReaderEnabled", [], root_name), make(prefix + "/motion", "isReduceMotionEnabled", [], root_name),
    make(prefix + "/transparency", "isReduceTransparencyEnabled", [], root_name), make(prefix + "/contrast", "isDarkerSystemColorsEnabled", [], root_name)]

func _initialize() -> void:
  var user := OS.get_cmdline_user_args()
  allow_original_negative = user.has("--allow-original-negative")
  sabotage = user.has("--sabotage")
  call_deferred("run_probe")

func run_probe() -> void:
  root.size = Vector2i(480, 80)
  check(DisplayServer.get_name() == "headless" and DisplayServer.accessibility_screen_reader_active() == -1
    and DisplayServer.accessibility_should_reduce_animation() == -1 and DisplayServer.accessibility_should_reduce_transparency() == -1
    and DisplayServer.accessibility_should_increase_contrast() == -1,
    "environment/The headless DisplayServer reports all four accessibility settings as unknown (-1)")
  collect_announce_facts()
  # R is created and mounted first and keeps running while A does everything, so that A's changes can be seen not to reach it.
  await run_real_setup()
  await run_validation_application()
  await run_real_finish()
  await finish()

# The engine's own answer to every name the announcements use (the oracle compares it with the host's report), and what the
# headless server and tree say: no screen reader can be there.
func collect_announce_facts() -> void:
  var methods := {}
  for name: String in ANNOUNCEMENT_API.methods:
    methods[name] = ClassDB.class_has_method("AccessibilityServer", name)
  var constants := {}
  for name: String in ANNOUNCEMENT_API.constants:
    constants[name] = ClassDB.class_has_integer_constant("AccessibilityServer", name)
  var node_methods := {}
  for name: String in ANNOUNCEMENT_API.node:
    node_methods[name] = ClassDB.class_has_method("Node", name)
  announce_facts = {"serverRegistered": Engine.has_singleton("AccessibilityServer"), "methods": methods, "constants": constants,
    "treeMethod": ClassDB.class_has_method("SceneTree", ANNOUNCEMENT_API.tree), "nodeMethods": node_methods,
    "serverSupported": AccessibilityServer.is_supported(), "treeEnabled": is_accessibility_enabled(), "treeSupported": is_accessibility_supported()}
  check(announce_facts.serverRegistered and announce_facts.methods.values().all(func(found: bool) -> bool: return found)
    and announce_facts.constants.values().all(func(found: bool) -> bool: return found) and announce_facts.treeMethod
    and announce_facts.nodeMethods.values().all(func(found: bool) -> bool: return found),
    "announce-api/Every AccessibilityServer, SceneTree and Node name the announcements call, and every constant, exists in this engine's ClassDB")
  check(announce_facts.serverSupported == false and announce_facts.treeEnabled == false,
    "announce-api/The headless AccessibilityServer is not supported and the tree's accessibility is not enabled, so no screen reader can be there")

# ---------------------------------------------------------------- application R, first part
func run_real_setup() -> void:
  make_application("R", null, null)
  await mount("R", "R", 320)
  var read: Dictionary = await step("R", "real-read", [{"do": "read"}])
  check(read.commands[0].result.available == true and read.commands[0].result.sameAsOriginal == true and read.commands[0].result.error == null,
    "real/Reading AccessibilityInfo yields RN's original module")
  var getters: Dictionary = await step("R", "real-getters", backed("real") + [
    make("real/bold", "isBoldTextEnabled", [], "R"), make("real/crossfade", "prefersCrossFadeTransitions", [], "R")])
  check(["real/screen", "real/motion", "real/transparency", "real/contrast"].all(
    func(label: String) -> bool: return rejected(getters, label, "E_ACCESSIBILITY_UNKNOWN")),
    "real/With the real backend the headless DisplayServer reports -1, so all four getters reject E_ACCESSIBILITY_UNKNOWN")
  check(rejected(getters, "real/bold", "E_ACCESSIBILITY_UNAVAILABLE") and rejected(getters, "real/crossfade", "E_ACCESSIBILITY_UNAVAILABLE"),
    "real/The settings Godot cannot read reject E_ACCESSIBILITY_UNAVAILABLE")
  var subscribed: Dictionary = await step("R", "real-subscribe", [sub("R.screen", "R", "screenReaderChanged"), sub("R.change", "R", "change"),
    sub("R.motion", "R", "reduceMotionChanged"), sub("R.transparency", "R", "reduceTransparencyChanged"),
    sub("R.contrast", "R", "darkerSystemColorsChanged"), wait(4)])
  check(subscribed.commands[5].reached == true and rows(subscribed).is_empty() and section(subscribed, "events").get("screenReaderChanged", -1) == 0
    and int(section(subscribed, "settings").get("screenReader", {}).get("reads", -1)) == 1 + int(subscribed.info.get("polls", -2)),
    "real/The real backend polls every frame and, reporting -1 each time, emits nothing")
  # The headless server reports -1 for all four, so a reading taken from the wrong method looks the same as the right one.
  # What does tell them apart is the method the host names for each setting (displayMethod in its snapshot): it has to be a
  # method the DisplayServer has, and the DisplayServer's own answer to it has to be what the host last read.
  var all_exist := true
  var all_equal := true
  for name: String in ["screenReader", "reduceMotion", "reduceTransparency", "increaseContrast"]:
    var method: Variant = sv(subscribed, name, "displayMethod")
    var last: Variant = sv(subscribed, name, "last")
    var exists: bool = method is String and method != "" and ClassDB.class_has_method("DisplayServer", method)
    var reading: Variant = DisplayServer.call(method) if exists else null
    var equal: bool = exists and (typeof(last) == TYPE_FLOAT or typeof(last) == TYPE_INT) and int(reading) == int(last)
    display_facts[name] = {"method": method, "exists": exists, "reading": reading, "last": last}
    all_exist = all_exist and exists
    all_equal = all_equal and equal
  check(all_exist, "real/The method the host reads for each of the four settings exists in the DisplayServer of this engine")
  check(all_equal, "real/What the DisplayServer answers to each of those methods is what the host last read for that setting")
  normative(announced(subscribed).get("api", {}) == ANNOUNCEMENT_API.merged({"missing": []}),
    "announce-api/The host reports the engine API it calls for announcements, by name, and none of it is missing")

# ---------------------------------------------------------------- application A
func run_validation_application() -> void:
  # The platform reports the screen reader on, the other two known settings off, and increase contrast not at all.
  # The announcer's recorder (an empty Dictionary: it behaves as a screen reader that is looking at the window) stands in for the
  # AccessibilityServer.
  make_application("A", {"screen_reader": 1, "reduce_animation": 0, "reduce_transparency": 0}, {})
  var early: Dictionary = await step("A", "early", [])
  check(not early.info.is_empty() and infov(early, "started") == false and modules_created(early) == 0 and int(infov(early, "polls", -1)) == 0
    and infov(early, "stopped") == false, "early/Before any runtime exists the application owns the settings but has read nothing")
  await mount("A", "A", 0)
  await mount("A", "B", 160)
  var app := native("A")
  check(int(app.rootCount) == 2 and surfaces.AA.call("get_surface_id") > 0 and surfaces.AB.call("get_surface_id") > 0 and app.errors.is_empty(),
    "mount/Two actual roots mount through the original AppRegistry in one Hermes application")

  var lazy: Dictionary = await step("A", "lazy-before", [{"do": "android"}])
  check(lazy.commands[0].result == false, "lazy/TurboModuleRegistry.get('AccessibilityInfo') finds no Android module")
  check(modules_created(lazy) == 0 and int(infov(lazy, "polls", -1)) == 0 and not infov(lazy, "started"),
    "lazy/Mounting roots and looking the Android module up create no AccessibilityManager module and read nothing")
  var first_read: Dictionary = await step("A", "lazy-read", [{"do": "read"}])
  check(first_read.commands[0].result.available == true and first_read.commands[0].result.sameAsOriginal == true
    and first_read.commands[0].result.error == null, "lazy/Reading AccessibilityInfo yields RN's original module")
  check(modules_created(first_read) == 1 and infov(first_read, "started") == true
    and sv(first_read, "screenReader", "last") == 1 and sv(first_read, "screenReader", "known") == true
    and sv(first_read, "reduceMotion", "last") == 0 and sv(first_read, "reduceMotion", "known") == false
    and sv(first_read, "reduceTransparency", "last") == 0
    and sv(first_read, "increaseContrast", "last") == -1 and sv(first_read, "increaseContrast", "known") == null
    and ["screenReader", "reduceMotion", "reduceTransparency", "increaseContrast"].all(
      func(name: String) -> bool: return sv(first_read, name, "events") == 0),
    "lazy/The first read creates the module, which takes the baseline from the platform and reports nothing for it")

  var getters: Dictionary = await step("A", "getters", backed("get"))
  check(resolved(getters, "get/screen", true) and resolved(getters, "get/motion", false) and resolved(getters, "get/transparency", false),
    "getters/A known setting resolves true for 1 and false for 0")
  check(rejected(getters, "get/contrast", "E_ACCESSIBILITY_UNKNOWN"),
    "getters/An unknown setting (-1) rejects E_ACCESSIBILITY_UNKNOWN and never resolves false")

  var unbacked: Dictionary = await step("A", "unbacked", [make("bold", "isBoldTextEnabled"), make("gray", "isGrayscaleEnabled"),
    make("invert", "isInvertColorsEnabled"), make("crossfade", "prefersCrossFadeTransitions"), make("contrast-text", "isHighTextContrastEnabled"),
    make("service", "isAccessibilityServiceEnabled"), make("timeout", "getRecommendedTimeoutMillis", [3000]),
    make("timeout-zero", "getRecommendedTimeoutMillis", [0])])
  check(["bold", "gray", "invert", "crossfade"].all(func(label: String) -> bool: return rejected(unbacked, label, "E_ACCESSIBILITY_UNAVAILABLE"))
    and int(section(unbacked, "unbacked").get("boldText", -1)) == 1 and int(section(unbacked, "unbacked").get("crossFadeTransitions", -1)) == 1,
    "unbacked/Bold text, grayscale, inverted colors and cross-fade reject E_ACCESSIBILITY_UNAVAILABLE and are counted")
  check(resolved(unbacked, "contrast-text", false) and rejected(unbacked, "service", "only available on Android")
    and resolved(unbacked, "timeout", 3000) and resolved(unbacked, "timeout-zero", 0),
    "unbacked/RN's own answers that need no host hold: high text contrast false, the Android service rejects, the timeout is the one given")

  var subscribed: Dictionary = await step("A", "subscribe", [
    sub("A.screen", "A", "screenReaderChanged"), sub("A.change", "A", "change"), sub("A.motion", "A", "reduceMotionChanged"),
    sub("A.transparency", "A", "reduceTransparencyChanged"), sub("A.contrast", "A", "darkerSystemColorsChanged"),
    sub("A.bold", "A", "boldTextChanged"), sub("A.gray", "A", "grayscaleChanged"), sub("A.invert", "A", "invertColorsChanged"),
    sub("A.announce", "A", "announcementFinished"), sub("A.android", "A", "highTextContrastChanged"), sub("A.unknown", "A", "nonsense"),
    sub("B.motion", "B", "reduceMotionChanged"), sub("B.change", "B", "change"), sub("library.screen", "library", "screenReaderChanged"),
    {"do": "retain"}])
  check(subscribed.commands.slice(0, 14).all(func(command: Dictionary) -> bool: return command.result != null and command.result.removable == true),
    "subscribe/Every event name, even one RN does not map, returns a removable subscription")
  check(listening(subscribed, "screenReaderChanged") == 4 and listening(subscribed, "reduceMotionChanged") == 2
    and listening(subscribed, "reduceTransparencyChanged") == 1 and listening(subscribed, "darkerSystemColorsChanged") == 1
    and SILENT_EVENTS.all(func(event: String) -> bool: return listening(subscribed, event) == 1),
    "subscribe/The alias change is a listener of screenReaderChanged, and a name RN does not map registers nothing")

  var quiet: Dictionary = await step("A", "quiet", [meta_of(1, 0, 0, null), wait(5)])
  check(quiet.commands[1].reached == true and rows(quiet).is_empty() and int(infov(quiet, "polls", -1)) >= 5
    and ["screenReader", "reduceMotion", "reduceTransparency"].all(func(name: String) -> bool: return sv(quiet, name, "events") == 0),
    "events/An unchanged platform emits nothing, frame after frame")

  var motion: Dictionary = await step("A", "motion-on", [meta_of(1, 1, 0, null), wait(), make("motion/get", "isReduceMotionEnabled")])
  check(rows(motion) == [["A.motion", "reduceMotionChanged", true], ["B.motion", "reduceMotionChanged", true]]
    and counted(motion, "reduceMotionChanged") == 1 and counted(motion, "reduceTransparencyChanged") == 0,
    "events/Reduce motion turning on is one reduceMotionChanged(true) to the listeners of both roots, once each, and nothing else")
  check(resolved(motion, "motion/get", true), "events/The getter answers the new value")

  var screen: Dictionary = await step("A", "alias", [meta_of(0, 1, 0, null), wait(), make("alias/get", "isScreenReaderEnabled")])
  check(rows(screen) == [["A.screen", "screenReaderChanged", false], ["A.change", "change", false], ["B.change", "change", false],
    ["library.screen", "screenReaderChanged", false]] and counted(screen, "screenReaderChanged") == 1,
    "events/'change' and 'screenReaderChanged' hear the same one event, in subscription order")
  check(resolved(screen, "alias/get", false), "events/The screen reader getter answers the new value")

  var transparency: Dictionary = await step("A", "transparency-on", [meta_of(0, 1, 1, null), wait(), make("transparency/get", "isReduceTransparencyEnabled")])
  check(rows(transparency) == [["A.transparency", "reduceTransparencyChanged", true]] and resolved(transparency, "transparency/get", true),
    "events/Reduce transparency turning on is one reduceTransparencyChanged(true)")

  var contrast: Dictionary = await step("A", "contrast-appears", [meta_of(0, 1, 1, 0), wait(), make("contrast/get", "isDarkerSystemColorsEnabled")])
  check(rows(contrast) == [["A.contrast", "darkerSystemColorsChanged", false]] and resolved(contrast, "contrast/get", false),
    "events/A setting that was unknown and is now known is a change")
  var contrast_on: Dictionary = await step("A", "contrast-on", [meta_of(0, 1, 1, 1), wait()])
  check(rows(contrast_on) == [["A.contrast", "darkerSystemColorsChanged", true]],
    "events/Increase contrast turning on is one darkerSystemColorsChanged(true)")

  var together: Dictionary = await step("A", "together", [meta_of(1, 0, 0, 0), wait()])
  check(rows(together) == [["A.screen", "screenReaderChanged", true], ["A.change", "change", true], ["B.change", "change", true],
    ["library.screen", "screenReaderChanged", true], ["A.motion", "reduceMotionChanged", false], ["B.motion", "reduceMotionChanged", false],
    ["A.transparency", "reduceTransparencyChanged", false], ["A.contrast", "darkerSystemColorsChanged", false]],
    "events/Four settings that change in one frame are four events, once each, in the order of the settings")

  var unknown: Dictionary = await step("A", "unknown", [meta_of(-1, 0, 0, 0), wait(), make("unknown/screen", "isScreenReaderEnabled"), wait()])
  check(rows(unknown).is_empty() and rejected(unknown, "unknown/screen", "E_ACCESSIBILITY_UNKNOWN")
    and sv(unknown, "screenReader", "last") == -1 and sv(unknown, "screenReader", "known") == true,
    "unknown/A setting that becomes unknown (-1) emits nothing and its getter rejects, frame after frame (-1 to -1 emits nothing)")
  var back: Dictionary = await step("A", "unknown-back", [meta_of(1, 0, 0, 0), wait(), make("back/screen", "isScreenReaderEnabled")])
  check(rows(back).is_empty() and resolved(back, "back/screen", true),
    "unknown/Coming back to the last known value is not a change, and the getter resolves again")
  var different: Dictionary = await step("A", "unknown-different", [meta_of(-1, 0, 0, 0), wait(2), meta_of(0, 0, 0, 0), wait()])
  check(rows(different) == [["A.screen", "screenReaderChanged", false], ["A.change", "change", false], ["B.change", "change", false],
    ["library.screen", "screenReaderChanged", false]], "unknown/A known value that differs from the last known one is a change after an unknown reading")

  var removed: Dictionary = await step("A", "key-removed", [meta_of(0, 0, null, 0), wait(), make("removed/transparency", "isReduceTransparencyEnabled")])
  check(rows(removed).is_empty() and rejected(removed, "removed/transparency", "E_ACCESSIBILITY_UNKNOWN"),
    "seam/A key the meta leaves out is the DisplayServer's reading, which is -1 here")
  var invalid: Dictionary = await step("A", "invalid-values", [meta_of(0, 2, 0, "yes"), wait(), make("invalid/motion", "isReduceMotionEnabled"),
    make("invalid/contrast", "isDarkerSystemColorsEnabled")])
  check(rows(invalid).is_empty() and rejected(invalid, "invalid/motion", "E_ACCESSIBILITY_UNKNOWN") and rejected(invalid, "invalid/contrast", "E_ACCESSIBILITY_UNKNOWN"),
    "seam/A value that is not -1, 0 or 1 is unknown")
  var restored: Dictionary = await step("A", "restored", [meta_of(0, 0, 0, 0), wait()] + backed("restored"))
  check(rows(restored).is_empty() and sv(restored, "reduceMotion", "events") == 2 and sv(restored, "reduceTransparency", "events") == 2
    and ["restored/screen", "restored/motion", "restored/transparency", "restored/contrast"].all(
      func(label: String) -> bool: return resolved(restored, label, false)),
    "seam/Settings that come back from unknown to the value they last had report nothing, and every getter resolves again")

  var direct_getters: Dictionary = await step("A", "direct-getters", [
    direct("direct/screen", "getCurrentVoiceOverState", [{"$callback": "success"}, {"$callback": "error"}]),
    direct("direct/bold", "getCurrentBoldTextState", [{"$callback": "success"}, {"$callback": "error"}]),
    direct("direct/crossfade", "getCurrentPrefersCrossFadeTransitionsState", [{"$callback": "success"}, {"$callback": "error"}]),
    meta_of(0, 0, null, 0), wait(),
    direct("direct/transparency", "getCurrentReduceTransparencyState", [{"$callback": "success"}, {"$callback": "error"}])])
  var screen_callbacks: Array = call_of(direct_getters, "direct/screen").get("callbacks", [])
  var bold_callbacks: Array = call_of(direct_getters, "direct/bold").get("callbacks", [])
  var transparency_callbacks: Array = call_of(direct_getters, "direct/transparency").get("callbacks", [])
  check(screen_callbacks.size() == 1 and screen_callbacks[0].name == "success" and screen_callbacks[0].value == false
    and bold_callbacks.size() == 1 and bold_callbacks[0].name == "error" and bold_callbacks[0].isError == true
    and str(bold_callbacks[0].message).begins_with("E_ACCESSIBILITY_UNAVAILABLE")
    and transparency_callbacks.size() == 1 and transparency_callbacks[0].name == "error" and transparency_callbacks[0].isError == true
    and str(transparency_callbacks[0].message).begins_with("E_ACCESSIBILITY_UNKNOWN"),
    "callbacks/A getter hands its setting to the success callback, and a refusal to the error callback as an Error")

  var content: Dictionary = await step("A", "content-size", [
    direct("size/valid", "setAccessibilityContentSizeMultipliers", [{"extraLarge": 1.5, "small": null}]),
    direct("size/empty", "setAccessibilityContentSizeMultipliers", [{}]),
    direct("size/extra-key", "setAccessibilityContentSizeMultipliers", [{"notACategory": -7, "large": 2}]),
    direct("size/negative", "setAccessibilityContentSizeMultipliers", [{"large": -1}]),
    direct("size/zero", "setAccessibilityContentSizeMultipliers", [{"medium": 0}]),
    direct("size/string", "setAccessibilityContentSizeMultipliers", [{"medium": "2"}]),
    direct("size/nan", "setAccessibilityContentSizeMultipliers", [{"small": {"$number": "NaN"}}])])
  check(["size/valid", "size/empty", "size/extra-key"].all(func(label: String) -> bool: return threw(content, label, "E_UNSUPPORTED"))
    and ["size/negative", "size/zero", "size/string", "size/nan"].all(func(label: String) -> bool: return threw(content, label, "E_ARGUMENT"))
    and int(section(content, "refused").get("contentSize", -1)) == 3 and int(section(content, "refused").get("contentSizeInvalid", -1)) == 4,
    "content-size/The multipliers are validated, and a valid argument throws E_UNSUPPORTED")

  await run_announcements()

  var ui: Dictionary = await step("A", "ui-events", [
    {"do": "send", "label": "ui/click", "root": "A", "type": "click"}, {"do": "send", "label": "ui/hover", "root": "B", "type": "viewHoverEnter"},
    {"do": "send", "label": "ui/window", "root": "A", "type": "windowStateChange"}, {"do": "send", "label": "ui/click-again", "root": "B", "type": "click"}])
  check(["ui/click", "ui/hover", "ui/window", "ui/click-again"].all(func(label: String) -> bool: return returned(ui, label))
    and int(section(ui, "uiEvents").get("ignored", -1)) == 4 and int(section(ui, "uiEvents").get("unsupported", -1)) == 0
    and int(section(ui, "uiEvents").get("byType", {}).get("click", -1)) == 2 and int(section(ui, "uiEvents").get("byType", {}).get("viewHoverEnter", -1)) == 1
    and int(section(ui, "uiEvents").get("byType", {}).get("windowStateChange", -1)) == 1 and section(ui, "uiEvents").get("byType", {}).size() == 3
    and ui.errors.is_empty(),
    "ui-events/sendAccessibilityEvent of a type other than focus is ignored and counted by type, as on iOS, with no error")

  var released: Dictionary = await step("A", "unsubscribe", [{"do": "unsubscribe", "id": "A.motion"}, meta_of(0, 1, 0, 0), wait()])
  check(rows(released) == [["B.motion", "reduceMotionChanged", true]] and listening(released, "reduceMotionChanged") == 1,
    "lifetime/A removed subscription hears nothing, even removed twice, and the other root still does")
  var unmounted: Dictionary = await step("A", "unmount", [{"do": "unmount", "surface": "AB"}, {"do": "settle"}, meta_of(0, 0, 0, 0), wait()])
  check(rows(unmounted).is_empty() and listening(unmounted, "reduceMotionChanged") == 0 and counted(unmounted, "reduceMotionChanged") == 4
    and unmounted.events.filter(func(event: Dictionary) -> bool: return event.get("cleanup", false)).map(
      func(event: Dictionary) -> String: return event.id) == ["B"] and unmounted.js.roots.B.mounted == false,
    "lifetime/An unmounted root's subscriptions go with it: the event still happens in the host and no one hears it")

  await run_stop()

# Application A's announcements and the focus. The recorder is the AccessibilityServer: it records every call the announcer
# makes and runs the update itself when one is asked for, so a step is a number of frames and an exact list of calls. In
# one frame an announcement is published (a new element: create, value, live, inside an update) and in the next the element is
# freed (outside any update), which takes one more update to remove it from the tree.
func run_announcements() -> void:
  var basic: Dictionary = await step("A", "announce-basic", [say("announce/say", "Saved"), wait(3)])
  var basic_ops := ops_of(basic)
  normative(returned(basic, "announce/say") and basic_ops == ["update.begin", "create 1", "value 1 Saved", "live 1 polite", "update.end",
      "free 1", "update.begin", "update.end"] and tally(basic) == [1, 1, 1, 0, 0] and dropped(basic) == [0, 0, 0, 0] and updates_of(basic) == [2, 2]
    and announced(basic).get("lastText") == "Saved" and announced(basic).get("lastPriority") == "polite" and announced(basic).get("osTree") == true,
    "announce/An announcement is a new element with the text as its value and a polite live mode, published in one update and freed outside the next one")
  var seen := basic_ops.size()

  var priorities: Dictionary = await step("A", "announce-priorities", [
    say_with("priority/high", "Alert", {"priority": "high"}), say_with("priority/default", "Plain", {"priority": "default"}),
    say_with("priority/unknown", "Odd", {"priority": "urgent", "queue": false}), say_with("priority/null", "Null", {"queue": null, "priority": null}), wait(3)])
  var priority_ops := ops_of(priorities).slice(seen)
  seen += priority_ops.size()
  normative(["priority/high", "priority/default", "priority/unknown", "priority/null"].all(func(label: String) -> bool: return returned(priorities, label))
    and priority_ops == ["update.begin", "create 2", "value 2 Alert", "live 2 assertive", "create 3", "value 3 Plain", "live 3 polite",
      "create 4", "value 4 Odd", "live 4 polite", "create 5", "value 5 Null", "live 5 polite", "update.end", "free 2", "free 3", "free 4", "free 5",
      "update.begin", "update.end"] and tally(priorities) == [5, 5, 5, 0, 0] and updates_of(priorities) == [4, 4]
    and announced(priorities).get("lastText") == "Null" and announced(priorities).get("lastPriority") == "polite",
    "priority/High is assertive; default, a priority iOS ignores, null options and queue: false are polite; one frame is one update for all four")

  var twice: Dictionary = await step("A", "announce-twice", [say("again/first", "Saved"), wait(3), say("again/second", "Saved"), wait(3)])
  var twice_ops := ops_of(twice).slice(seen)
  seen += twice_ops.size()
  normative(twice_ops == ["update.begin", "create 6", "value 6 Saved", "live 6 polite", "update.end", "free 6", "update.begin", "update.end",
      "update.begin", "create 7", "value 7 Saved", "live 7 polite", "update.end", "free 7", "update.begin", "update.end"]
    and tally(twice) == [7, 7, 7, 0, 0] and updates_of(twice) == [8, 8],
    "again/The same text said twice is two elements, never a value set again on the first one (a value equal to the one before does not speak)")

  var batch: Dictionary = await step("A", "announce-batch", [say("batch/one", "One"), say("batch/two", "Two"),
    direct("batch/three", "announceForAccessibility", ["Three"]), wait(3)])
  var batch_ops := ops_of(batch).slice(seen)
  seen += batch_ops.size()
  normative(returned(batch, "batch/three") and batch_ops == ["update.begin", "create 8", "value 8 One", "live 8 polite", "create 9", "value 9 Two",
      "live 9 polite", "create 10", "value 10 Three", "live 10 polite", "update.end", "free 8", "free 9", "free 10", "update.begin", "update.end"]
    and tally(batch) == [10, 10, 10, 0, 0] and updates_of(batch) == [10, 10],
    "batch/Announcements of one frame, public or direct, share one update in the order they were made")

  var odd: Dictionary = await step("A", "announce-empty", [say("odd/empty", ""), say("odd/unicode", "Salvo ✓ ação 日本"), wait(3)])
  var odd_ops := ops_of(odd).slice(seen)
  seen += odd_ops.size()
  normative(odd_ops == ["update.begin", "create 11", "value 11 Salvo ✓ ação 日本", "live 11 polite", "update.end", "free 11", "update.begin", "update.end"]
    and tally(odd) == [12, 11, 11, 0, 0] and dropped(odd) == [0, 1, 0, 0] and announced(odd).get("lastText") == "Salvo ✓ ação 日本",
    "odd/An empty text is dropped (AccessKit clears an empty value) and a text with accents and CJK reaches the element intact")

  var refused: Dictionary = await step("A", "announce-refused", [
    say_with("refuse/queue", "Q", {"queue": true}), say_with("refuse/low", "L", {"priority": "low"}),
    say_with("refuse/both", "B", {"queue": true, "priority": "low"}), say_with("refuse/queue-false-low", "QF", {"queue": false, "priority": "low"}),
    direct("refuse/direct-queue", "announceForAccessibilityWithOptions", ["DQ", {"queue": true, "priority": "high"}]),
    direct("refuse/bad-queue", "announceForAccessibilityWithOptions", ["X", {"queue": "yes"}]),
    direct("refuse/bad-queue-number", "announceForAccessibilityWithOptions", ["X", {"queue": 1}]),
    direct("refuse/bad-priority", "announceForAccessibilityWithOptions", ["X", {"priority": 3}]),
    direct("refuse/bad-priority-object", "announceForAccessibilityWithOptions", ["X", {"priority": {}}]),
    direct("refuse/bad-both", "announceForAccessibilityWithOptions", ["X", {"queue": "x", "priority": 2}]), wait(3)])
  var queue_refused := ["refuse/queue", "refuse/both", "refuse/direct-queue"].all(
    func(label: String) -> bool: return threw(refused, label, "E_UNSUPPORTED") and threw(refused, label, QUEUE_MESSAGE))
  var priority_refused := ["refuse/low", "refuse/queue-false-low"].all(
    func(label: String) -> bool: return threw(refused, label, "E_UNSUPPORTED") and threw(refused, label, PRIORITY_MESSAGE))
  var invalid_refused := ["refuse/bad-queue", "refuse/bad-queue-number", "refuse/bad-priority", "refuse/bad-priority-object", "refuse/bad-both"].all(
    func(label: String) -> bool: return threw(refused, label, "E_ARGUMENT"))
  normative(queue_refused and priority_refused and invalid_refused and refused_announcements(refused) == [3, 2] and refused_of(refused, "announceInvalid") == 5
    and tally(refused) == [12, 11, 11, 0, 0] and ops_of(refused).slice(seen).is_empty(),
    "refuse/queue: true is refused with the reason (the macOS API has no queue), priority 'low' with its own, and an option of the wrong type is E_ARGUMENT; nothing is taken or published")

  var focus: Dictionary = await step("A", "focus-refused", [make("focus/public", "setAccessibilityFocus", [1]),
    direct("focus/direct", "setAccessibilityFocus", [1])])
  normative(threw(focus, "focus/public", FOCUS_MESSAGE) and threw(focus, "focus/direct", FOCUS_MESSAGE) and refused_of(focus, "focus") == 2,
    "focus/setAccessibilityFocus is refused with the reason: Godot has one focus, and moving the screen reader's would move the keyboard's")

  var silent: Dictionary = await step("A", "announce-no-reader", [recorder({"available": false}), say("silent/plain", "Silent"),
    say_with("silent/high", "Silent high", {"priority": "high"}), wait(3), recorder({}), wait(3)])
  normative(returned(silent, "silent/plain") and returned(silent, "silent/high") and tally(silent) == [14, 11, 11, 0, 0] and dropped(silent) == [2, 1, 0, 0]
    and ops_of(silent).slice(seen).is_empty() and updates_of(silent) == [12, 12] and announced(silent).get("lastText") == "Silent high"
    and announced(silent).get("lastPriority") == "assertive",
    "no-reader/With no screen reader the call returns without error, the announcement is dropped and counted, and it is not spoken when one turns on")

  var leaves: Dictionary = await step("A", "announce-reader-leaves", [recorder({"delivers": false}), say("leaves/waiting", "Waiting"),
    recorder({"available": false, "delivers": false}), wait(3), recorder({}), wait(3)])
  normative(returned(leaves, "leaves/waiting") and tally(leaves) == [15, 11, 11, 0, 0] and dropped(leaves) == [3, 1, 0, 0] and ops_of(leaves).slice(seen).is_empty()
    and updates_of(leaves) == [12, 12],
    "reader-leaves/An announcement waiting for the update is dropped when the screen reader goes away, and is not published when it comes back")

  var expires: Dictionary = await step("A", "announce-expires", [recorder({"delivers": false}), say("expire/unheard", "Unheard"), wait(130),
    recorder({}), wait(3)])
  normative(returned(expires, "expire/unheard") and tally(expires) == [16, 11, 11, 0, 0] and dropped(expires) == [3, 1, 1, 0]
    and ops_of(expires).slice(seen).is_empty() and updates_of(expires) == [132, 12],
    "expires/An update that never comes (a screen reader not looking at this window) expires the announcement after 120 pumps: asked for 120 times, never published")

  var missing: Dictionary = await step("A", "announce-no-element", [recorder({"element": false}), say("element/none", "No element"), wait(3), recorder({})])
  var missing_ops := ops_of(missing).slice(seen)
  seen += missing_ops.size()
  normative(returned(missing, "element/none") and missing_ops == ["update.begin", "update.end"] and tally(missing) == [17, 11, 11, 0, 0]
    and dropped(missing) == [4, 1, 1, 0] and updates_of(missing) == [133, 13],
    "element/When the application has no element to put it in, the update finds nothing to create and the announcement is dropped")

func run_stop() -> void:
  # Stop. Retained modules and the public API fail with E_MODULE_DISPOSED, nothing is read and no event is emitted.
  var before := info_of("A")
  var polls_before := int(before.get("polls", -1))
  var all_events: int = 0
  for name in DEVICE_EVENTS:
    all_events += int(before.get("events", {}).get(name, 0))
  var before_ops := ops_of({"info": before})
  # An announcement is waiting for an update that never comes when the application stops: stop drops it.
  var stopped: Dictionary = await step("A", "stop", [recorder({"delivers": false}), say("stop/pending", "Pending at stop"), {"do": "stop"}, {"do": "settle"}] + [
    direct("stop/screen", "getCurrentVoiceOverState", [{"$callback": "success"}, {"$callback": "error"}]),
    direct("stop/motion", "getCurrentReduceMotionState", [{"$callback": "success"}, {"$callback": "error"}]),
    direct("stop/transparency", "getCurrentReduceTransparencyState", [{"$callback": "success"}, {"$callback": "error"}]),
    direct("stop/contrast", "getCurrentDarkerSystemColorsState", [{"$callback": "success"}, {"$callback": "error"}]),
    direct("stop/bold", "getCurrentBoldTextState", [{"$callback": "success"}, {"$callback": "error"}]),
    direct("stop/gray", "getCurrentGrayscaleState", [{"$callback": "success"}, {"$callback": "error"}]),
    direct("stop/invert", "getCurrentInvertColorsState", [{"$callback": "success"}, {"$callback": "error"}]),
    direct("stop/crossfade", "getCurrentPrefersCrossFadeTransitionsState", [{"$callback": "success"}, {"$callback": "error"}]),
    direct("stop/size", "setAccessibilityContentSizeMultipliers", [{"large": 1}]), direct("stop/focus", "setAccessibilityFocus", [1]),
    direct("stop/announce", "announceForAccessibility", ["after stop"]),
    direct("stop/options", "announceForAccessibilityWithOptions", ["after stop", {"queue": false}]),
    make("stop/public-announce", "announceForAccessibility", ["after stop"]), sub("stop.late", "library", "reduceMotionChanged"),
    meta_of(1, 1, 1, 1), {"do": "settle", "frames": 30}])
  var disposed := ["stop/screen", "stop/motion", "stop/transparency", "stop/contrast", "stop/bold", "stop/gray", "stop/invert",
    "stop/crossfade", "stop/size", "stop/focus", "stop/announce", "stop/options", "stop/public-announce"]
  # The public getters are promises whose reactions a stopped runtime no longer drains, so the retained module is what
  # shows the rejection: every one of its twelve methods throws, and so does the public call that is not a promise.
  check(disposed.all(func(label: String) -> bool: return threw(stopped, label, "E_MODULE_DISPOSED")),
    "stop/A retained module throws E_MODULE_DISPOSED synchronously after stop, for all twelve methods and the public announcement")
  normative(returned(stopped, "stop/pending") and announced(stopped).get("stopped") == true and tally(stopped) == [18, 11, 11, 0, 0]
    and dropped(stopped) == [4, 1, 1, 1] and ops_of(stopped) == before_ops and updates_of(stopped) == [133, 13],
    "stop/Stop drops the announcement that was waiting for an update, counts it, and nothing is made, set or freed after it")
  check(stopped.commands[stopped.commands.size() - 3].result.removable == true,
    "stop/RN's own JS-only subscription still works after stop and hears nothing")
  check(infov(stopped, "stopped") == true and int(infov(stopped, "polls", -1)) == polls_before and rows(stopped).is_empty()
    and ["screenReader", "reduceMotion", "reduceTransparency", "increaseContrast"].all(
      func(name: String) -> bool: return int(sv(stopped, name, "reads")) == 1 + polls_before),
    "stop/A stopped application reads no setting and emits no event, whatever the platform reports")
  var all_after: int = 0
  for name in DEVICE_EVENTS:
    all_after += int(stopped.info.get("events", {}).get(name, 0))
  var library_heard: int = stopped.js.events.filter(func(event: Dictionary) -> bool: return not event.get("cleanup", false) and event.id == "library.screen").size()
  check(all_after == all_events and library_heard == 3 and library_heard == int(sv(stopped, "screenReader", "events")),
    "stop/The never-removed library listener heard exactly the screen reader events of the run and none after stop")
  var heard_names := {}
  for event: Dictionary in stopped.js.events:
    if not event.get("cleanup", false):
      heard_names[event.event] = true
  check(silent_counts(stopped) and SILENT_EVENTS.all(func(name: String) -> bool: return not heard_names.has(name))
    and not heard_names.has("highTextContrastChanged") and not heard_names.has("nonsense"),
    "silent/boldTextChanged, grayscaleChanged, invertColorsChanged and announcementFinished never fired, nor did a name RN does not map")
  var final_native := native("A")
  # The preceding host reports every accessibility event as an error, so only this host stops without diagnostics.
  check(final_native.stopped and int(final_native.rootCount) == 0 and final_native.errors.is_empty(),
    "stop/Stop releases every root of the application without diagnostics")
  for name: String in ["AA", "AB"]:
    var root_state: Dictionary = JSON.parse_string(surfaces[name].call("snapshot"))
    check(int(root_state.nativeTags) == 0 and int(root_state.creates) == int(root_state.deletes),
      "stop/" + name + "/All native Controls of the root are balanced")

# ---------------------------------------------------------------- application R, second part
func run_real_finish() -> void:
  # The real server of a headless engine: no screen reader, so every announcement is dropped at the call and the announcer
  # never touches the platform. The two refusals are the same as with the recorder.
  var real_say: Dictionary = await step("R", "real-announce", [say("real/say", "Real", "R"), say_with("real/high", "Real high", {"priority": "high"}, "R"),
    say_with("real/queue", "Q", {"queue": true}, "R"), say_with("real/low", "L", {"priority": "low"}, "R"), wait(3)])
  normative(returned(real_say, "real/say") and returned(real_say, "real/high") and threw(real_say, "real/queue", QUEUE_MESSAGE)
    and threw(real_say, "real/low", PRIORITY_MESSAGE) and tally(real_say) == [2, 0, 0, 0, 0] and dropped(real_say) == [2, 0, 0, 0]
    and refused_announcements(real_say) == [1, 1] and updates_of(real_say) == [0, 0] and announced(real_say).get("osTree") == false
    and ops_of(real_say).is_empty() and announced(real_say).get("lastText") == "Real high" and announced(real_say).get("lastPriority") == "assertive",
    "real/With the real, headless server there is no screen reader: the call returns, the announcement is dropped and counted, nothing is published and no OS tree stands behind the application")
  var after: Dictionary = await step("R", "real-after", [wait(3), make("after/motion", "isReduceMotionEnabled", [], "R"),
    {"do": "send", "label": "after/focus", "root": "R", "type": "focus"}])
  check(rejected(after, "after/motion", "E_ACCESSIBILITY_UNKNOWN") and rows(after).is_empty() and modules_created(after) == 1
    and not infov(after, "stopped"),
    "independence/R keeps its own state and hears nothing while A changes four settings and then stops")
  check(rows(after).is_empty() and after.js.events.filter(func(event: Dictionary) -> bool: return not event.get("cleanup", false)).is_empty(),
    "independence/None of A's events ever reached R's listeners")
  check(returned(after, "after/focus"), "focus/The renderer's sendAccessibilityEvent returns for a focus event")
  normative(int(section(after, "uiEvents").get("unsupported", -1)) == 1 and after.errors.has(FOCUS_MESSAGE),
    "focus/A focus event fails out loud with the reason: Godot has a single focus, and moving the screen reader's would blur the focused control")
  var stopped: Dictionary = await step("R", "real-stop", [{"do": "stop"}, {"do": "settle"}])
  check(infov(stopped, "stopped") == true and rows(stopped).is_empty(), "stop/R stops on its own after A has")
  var final_native := native("R")
  check(final_native.stopped and int(final_native.rootCount) == 0, "stop/Stop releases the real-backend application's roots")

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
  var report := {"scenario": "native-accessibility-info", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "initialMeta": initial_meta, "initialAnnouncer": initial_announcer, "displayMethods": display_facts,
    "announceFacts": announce_facts, "announceApi": ANNOUNCEMENT_API, "checks": checks, "stages": stages, "expectedOriginalFailures": expected_original_failures,
    "allowOriginalNegative": allow_original_negative, "originalNegativeObserved": original_negative_observed,
    "sabotage": sabotage, "allCurrentAssertionsPassed": failures.is_empty(),
    # The engine errors this run provokes on purpose: a focus event is refused out loud (one error each), with the reason on
    # this host and with "not implemented yet" on the preceding one.
    "expectedDiagnostics": {"current": {"FABRIC_ERROR: " + FOCUS_MESSAGE: sent_focus}, "original": {"FABRIC_ERROR: " + OLD_MESSAGE: sent_focus}},
    "scope": {"actualGodotBackendInHeadless": true, "validationMetaReplacesReadings": true, "publicReactNativeImport": true,
      "twoRootsOneApplication": true, "realScreenReaderCertified": false, "realReduceMotionCertified": false,
      "realTransparencyCertified": false, "realContrastCertified": false, "mobileExportsCertified": false,
      "announcementsRecorded": true, "screenReaderSpeechCertified": false, "accessKitPostCertifiedHere": false}}
  var output := FileAccess.open("res://build/accessibility-info-report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_ERROR: cannot write the accessibility info report")
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  output.close()
  if original_negative_observed:
    print("ACCESSIBILITY_INFO_ORIGINAL_NEGATIVE: " + str(failures.size()))
  elif sabotage_observed:
    print("ACCESSIBILITY_INFO_SABOTAGE_REJECTED: " + str(failures.size()))
  elif failures.is_empty():
    print("ACCESSIBILITY_INFO_PASSED: " + str(checks.size()))
  else:
    print("ACCESSIBILITY_INFO_FAILED")
  quit(0 if failures.is_empty() or original_negative_observed or sabotage_observed else 1)
