extends SceneTree

# The graphical, macOS half of the proof of announcements. It runs on a developer's Mac, not in hosted CI: it needs a window
# session. RN's AccessibilityInfo (the bundle of the headless probe) runs in a real window with --accessibility always, and an
# inspector injected into this process (tests/accessibility-bridge-probe.m) intercepts, by dyld interposition,
# NSAccessibilityPostNotificationWithUserInfo: the call AccessKit's macOS adapter makes to ask AppKit for
# NSAccessibilityAnnouncementRequestedNotification. What this proves is what the host made AccessKit post: the text and the
# priority level, in the right order, once per announcement. That VoiceOver spoke it is not provable from inside the process
# and nothing here says it.
#
# The script drives the app and asks the inspector through files in FABRIC_AX_DIR; every wait is on a state counted in delivered
# frames, never on a fixed time. A wait that runs out is a failed check, not a pause.
const POLL_FRAMES := 600
const WAIT_FRAMES := 240
const QUIET_FRAMES := 40
const NOTIFICATION := "AXAnnouncementRequested"
# NSAccessibilityPriorityLevel: AccessKit posts Medium for a polite node and High for an assertive one.
const MEDIUM := 50
const HIGH := 90
const WINDOW := "GodotWindow"

var application: Node
var surface: Control
var checks: Array = []
var stages: Dictionary = {}
var waits: Array = []
var allow_original_negative := false
# A run on a host broken on purpose (the retained sabotages): the lane must fail on it, and does not pass for it.
var sabotage := false
var expected_original_failures: Array = []
var directory := ""
var request_id := 0
# How many notifications the inspector had seen the last time it was asked, so that the next ask is for the new ones.
var cursor := 0
# Why the inspector is taken as lost (ask), or empty while it answers.
var inspector_lost := ""
# What each announcement of the script made AccessKit post, by step, for the test to judge on its own.
var steps: Dictionary = {}

func check(condition: bool, name: String, normative: bool = false) -> bool:
  checks.append({"name": name, "passed": condition})
  if normative:
    expected_original_failures.append(name)
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

func settle(count: int = 8) -> void:
  for index in range(count):
    await process_frame

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(AccessibilityInfoProbe." + expression + ")"))

func run_js(expression: String) -> void:
  application.call("evaluate", "AccessibilityInfoProbe." + expression)

# One round trip with the inspector, counted in frames; an answer that does not come ends the run's patience once (see
# accessibility-bridge-probe.gd).
func ask(operation: Dictionary) -> Dictionary:
  if inspector_lost != "":
    return {"error": inspector_lost, "unanswered": true}
  request_id += 1
  operation["id"] = request_id
  var response_path := directory + "/response.json"
  var request_path := directory + "/request.json"
  if FileAccess.file_exists(response_path):
    DirAccess.remove_absolute(response_path)
  var file := FileAccess.open(request_path, FileAccess.WRITE)
  file.store_string(JSON.stringify(operation))
  file.close()
  for frame in range(POLL_FRAMES):
    await process_frame
    if FileAccess.file_exists(response_path):
      var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(response_path))
      if parsed is Dictionary and int(parsed.get("id", -1)) == request_id:
        return parsed
  if FileAccess.file_exists(request_path):
    DirAccess.remove_absolute(request_path)
  inspector_lost = "the inspector did not answer the %s request in %d frames" % [operation.get("op", "?"), POLL_FRAMES]
  check(false, "bridge/The inspector answers every request: " + inspector_lost)
  return {"error": inspector_lost, "unanswered": true}

func flatten(node: Dictionary, nodes: Array = []) -> Array:
  nodes.append(node)
  for child: Dictionary in node.get("children", []):
    flatten(child, nodes)
  return nodes

# The announcement posts the inspector has seen since the last ask, as [text, priority, element] rows, and moves the cursor.
func new_posts() -> Array:
  var answer := await ask({"op": "posted", "since": cursor})
  if answer.get("unanswered", false):
    return []
  cursor = int(answer.get("total", cursor))
  var rows: Array = []
  for post: Dictionary in answer.get("posted", []):
    if post.get("notification") == NOTIFICATION:
      rows.append([post.get("announcement"), int(post.get("priority", -1)), post.get("element")])
  return rows

# Waits until `count` announcement posts arrived, counted in frames, and returns them.
func posts_after(label: String, count: int) -> Array:
  var rows: Array = []
  for attempt in range(WAIT_FRAMES):
    rows.append_array(await new_posts())
    if inspector_lost != "":
      waits.append({"label": label, "attempts": attempt + 1, "met": false, "error": inspector_lost})
      return rows
    if rows.size() >= count:
      # Frames pass before the last of them could still arrive: a post the host should not have made shows here.
      await settle(QUIET_FRAMES)
      rows.append_array(await new_posts())
      waits.append({"label": label, "attempts": attempt + 1, "met": rows.size() == count})
      return rows
    await process_frame
  waits.append({"label": label, "attempts": WAIT_FRAMES, "met": false})
  return rows

# Waits a number of frames and returns the posts that came in them.
func posts_in_quiet(label: String) -> Array:
  await settle(QUIET_FRAMES)
  var rows := await new_posts()
  waits.append({"label": label, "attempts": QUIET_FRAMES, "met": true})
  return rows

func say(label: String, text: String) -> void:
  run_js("run(%s,'G','AccessibilityInfo.announceForAccessibility',%s)" % [JSON.stringify(label), JSON.stringify([text])])

func say_with(label: String, text: String, options: Dictionary) -> void:
  run_js("run(%s,'G','AccessibilityInfo.announceForAccessibilityWithOptions',%s)" % [JSON.stringify(label), JSON.stringify([text, options])])

func call_of(label: String) -> Dictionary:
  var snapshot: Variant = js("snapshot()")
  if snapshot is Dictionary:
    for entry: Dictionary in snapshot.calls:
      if entry.label == label:
        return entry
  return {}

func returned(label: String) -> bool:
  return call_of(label).get("state") == "returned"

func threw(label: String, pattern: String) -> bool:
  var entry := call_of(label)
  return entry.get("state") == "threw" and str(entry.get("error")).contains(pattern)

func announcements_of_host() -> Dictionary:
  var info: Variant = JSON.parse_string(application.call("snapshot")).get("accessibilityInfo", {})
  var section: Variant = info.get("announcements", {}) if info is Dictionary else {}
  return section if section is Dictionary else {}

func _initialize() -> void:
  allow_original_negative = OS.get_cmdline_user_args().has("--allow-original-negative")
  sabotage = OS.get_cmdline_user_args().has("--sabotage")
  directory = OS.get_environment("FABRIC_AX_DIR")
  call_deferred("run_probe")

func run_probe() -> void:
  if directory == "":
    push_error("FABRIC_CHECK_FAILED: FABRIC_AX_DIR names the inspector's directory")
    quit(1)
    return
  application = ClassDB.instantiate("FabricApplication")
  application.name = "AnnouncementApplication"
  application.set("bundle_path", "res://build/accessibility-info-probe.js")
  root.add_child(application)
  surface = ClassDB.instantiate("FabricSurface")
  surface.name = "G"
  surface.size = Vector2(160, 60)
  surface.set("application_path", NodePath("../AnnouncementApplication"))
  surface.set("component_name", "AccessibilityInfoProbe")
  surface.set("initial_props", {"name": "G"})
  root.add_child(surface)
  await settle(20)
  check(is_accessibility_enabled() and is_accessibility_supported() and AccessibilityServer.is_supported(),
    "bridge/Godot runs with an OS accessibility driver and an active tree (--accessibility always)")
  # The first query of the tree activates AccessKit's adapter: until then no update is built and nothing is posted.
  run_js("read()")
  var tree: Dictionary = {}
  for attempt in range(WAIT_FRAMES):
    var answer := await ask({"op": "dump"})
    if answer.get("unanswered", false):
      break
    tree = answer.get("tree", {})
    if not tree.get("children", []).is_empty():
      break
    await process_frame
  check(not tree.get("children", []).is_empty(), "bridge/The adapter is active: the window serves a tree to the system")
  await settle(10)
  await new_posts_discard()
  await announce_stages()
  stages.steps = steps
  stages.beforeStop = {"announcements": announcements_of_host()}
  application.call("stop")
  await settle(4)
  say("stopped/say", "after stop")
  await settle(4)
  var late := await posts_in_quiet("after-stop")
  # The preceding host holds this too: it throws E_MODULE_DISPOSED after stop, as every host with the module does.
  check(late.is_empty() and threw("stopped/say", "E_MODULE_DISPOSED"), "post/After stop the module is disposed and nothing more is posted")
  stages.afterStop = {"late": late}
  surface.queue_free()
  application.queue_free()
  await settle()
  await finish()

# Anything posted before the first announcement (AccessKit's own) is not the announcements'; the cursor moves past it.
func new_posts_discard() -> void:
  var rows := await new_posts()
  stages.beforeAnnouncements = rows

func announce_stages() -> void:
  say("a/saved", "Saved")
  var saved := await posts_after("saved", 1)
  steps.saved = saved
  check(returned("a/saved") and saved == [["Saved", MEDIUM, WINDOW]],
    "post/An announcement is posted on the window as AXAnnouncementRequested with its text and the medium priority level", true)
  say("a/saved-again", "Saved")
  var again := await posts_after("saved-again", 1)
  steps.again = again
  check(returned("a/saved-again") and again == [["Saved", MEDIUM, WINDOW]],
    "post/The same text said a second time is posted a second time: every announcement is an element of its own", true)
  say_with("a/high", "Alert", {"priority": "high"})
  var high := await posts_after("high", 1)
  steps.high = high
  check(returned("a/high") and high == [["Alert", HIGH, WINDOW]], "post/Priority high is posted with the high priority level", true)
  say_with("a/default", "Plain", {"priority": "default"})
  var plain := await posts_after("default", 1)
  steps.plain = plain
  say_with("a/unknown", "Odd", {"priority": "urgent", "queue": false})
  var odd := await posts_after("unknown", 1)
  steps.odd = odd
  check(returned("a/default") and returned("a/unknown") and plain == [["Plain", MEDIUM, WINDOW]] and odd == [["Odd", MEDIUM, WINDOW]],
    "post/Priority default, a priority iOS ignores and queue: false are posted with the medium priority level", true)
  say("a/first", "First")
  say("a/second", "Second")
  say_with("a/third", "Third", {"priority": "high"})
  var batch := await posts_after("batch", 3)
  steps.batch = batch
  check(batch == [["First", MEDIUM, WINDOW], ["Second", MEDIUM, WINDOW], ["Third", HIGH, WINDOW]],
    "post/Three announcements of one frame are three posts in the order they were made, each with its own priority level: one per update", true)
  # The order AccessKit's adapter posted them in, for the report (the elements of one update came out in an order of their own).
  stages.batchOrder = batch.map(func(row: Array) -> Variant: return row[0])
  say("a/empty", "")
  say_with("a/queue", "Queued", {"queue": true})
  say_with("a/low", "Low", {"priority": "low"})
  var silent := await posts_in_quiet("silent")
  steps.silent = silent
  check(returned("a/empty") and threw("a/queue", "no announcement queue") and threw("a/low", "only polite and assertive") and silent.is_empty(),
    "post/An empty text, queue: true and priority low post nothing: the empty one is dropped and the other two are refused with their reason", true)
  # The elements are freed after the update that published them: none of the announced texts is in the tree any more.
  await settle(10)
  var after := await ask({"op": "dump"})
  var values: Array = []
  for node: Dictionary in flatten(after.get("tree", {})):
    if node.get("value") is String and node.get("value") != "":
      values.append(node.get("value"))
  var posted := 0
  for rows: Array in steps.values():
    posted += rows.size()
  check(posted == 8 and not values.has("Saved") and not values.has("Alert") and not values.has("First"),
    "post/The elements the announcements were made of are gone from the OS tree once published (all eight were posted first)", true)
  stages.afterTree = {"valuesInTree": values}
  var host := announcements_of_host()
  stages.host = host
  check(host.get("osTree") == true and int(host.get("requested", -1)) == 9 and int(host.get("published", -1)) == 8 and int(host.get("released", -1)) == 8
    and int(host.get("held", -1)) == 0 and int(host.get("pending", -1)) == 0 and host.get("dropped", {}).get("empty") == 1
    and host.get("dropped", {}).get("noScreenReader") == 0 and host.get("dropped", {}).get("expired") == 0 and host.get("recorded", []).is_empty(),
    "post/The host published exactly the eight announcements AccessKit posted, freed them all, and used the real server (nothing recorded)", true)

func finish() -> void:
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var observed := failures.duplicate()
  var expected := expected_original_failures.duplicate()
  observed.sort()
  expected.sort()
  var original_negative_observed := allow_original_negative and observed == expected and not failures.is_empty()
  var sabotage_observed := sabotage and not failures.is_empty()
  var report := {"scenario": "native-accessibility-announcements-bridge", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages, "waits": waits, "inspectorLost": inspector_lost,
    "expectedOriginalFailures": expected_original_failures, "allowOriginalNegative": allow_original_negative, "sabotage": sabotage,
    "originalNegativeObserved": original_negative_observed, "allCurrentAssertionsPassed": failures.is_empty(),
    "accessibilitySupported": AccessibilityServer.is_supported(), "accessibilityEnabled": is_accessibility_enabled(),
    "scope": {"headless": false, "accessKitPostObserved": true, "dyldInterposition": true, "inProcessInspector": true,
      "assistiveTechnologySpeech": false, "voiceOverSpoke": false, "externalAXUIElement": false, "hardwareCertified": false}}
  var output := FileAccess.open("res://build/accessibility-announcements-bridge-report.json", FileAccess.WRITE)
  if not check(output != null, "report/The announcements bridge report is saved"):
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  output.close()
  if original_negative_observed:
    print("ACCESSIBILITY_ANNOUNCEMENTS_BRIDGE_ORIGINAL_NEGATIVE: " + str(failures.size()))
  elif sabotage_observed:
    print("ACCESSIBILITY_ANNOUNCEMENTS_BRIDGE_SABOTAGE_REJECTED: " + str(failures.size()))
  elif failures.is_empty():
    print("ACCESSIBILITY_ANNOUNCEMENTS_BRIDGE_PASSED: " + str(checks.size()))
  else:
    print("ACCESSIBILITY_ANNOUNCEMENTS_BRIDGE_FAILED")
  quit(0 if failures.is_empty() or original_negative_observed or sabotage_observed else 1)
