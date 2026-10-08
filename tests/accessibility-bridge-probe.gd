extends SceneTree

# The graphical, macOS half of the accessibility proof. The same bundle as the headless probe runs in a real
# window with --accessibility always, and an NSAccessibility inspector injected into this process
# (tests/accessibility-bridge-probe.m) reads the tree that the window serves to the system and presses elements
# with AXPress. This script drives the app and asks the inspector through files in FABRIC_AX_DIR; every wait is
# on a state (a tree that shows what it should, an event the app logged) counted in delivered frames, never on a
# fixed time. A wait that runs out is a failed check, not a pause.
const FRAMES := 240
const POLL_FRAMES := 600
# What the real tree must say about the fixture's elements, by name. count is how many roots serve one.
const TREE := {
  "Save draft": {"role": "AXButton", "help": "Saves the draft", "enabled": true, "count": 2},
  "Tap wins": {"role": "AXUnknown", "enabled": true, "count": 2},
  "Open": {"role": "AXButton", "help": "Opens the file", "enabled": true, "count": 2},
  "Share": {"role": "AXButton", "help": "Shares the file", "enabled": true, "count": 2},
  "Mute": {"role": "AXButton", "enabled": true, "count": 2},
  "Like": {"role": "AXRadioButton", "subrole": "AXTabButton", "enabled": true, "count": 2},
  "Locked": {"role": "AXUnknown", "enabled": false, "count": 2},
  "Off": {"role": "AXButton", "enabled": false, "count": 2},
  "Inside": {"role": "AXButton", "enabled": true, "count": 2},
  "Temporary": {"role": "AXButton", "enabled": true, "count": 2},
}
# Prop updates of one View and what the tree must say about it afterwards (the element is named Dyn).
const UPDATES := [
  {"id": "switch-on", "props": {"accessibilityLabel": "Dyn", "accessibilityRole": "switch", "accessibilityState": {"checked": true}, "accessibilityHint": "Toggles it"},
    "expect": {"role": "AXCheckBox", "subrole": "AXSwitch", "value": 1, "help": "Toggles it", "enabled": true}},
  {"id": "switch-off", "props": {"accessibilityLabel": "Dyn", "accessibilityRole": "switch", "accessibilityState": {"checked": false}},
    "expect": {"role": "AXCheckBox", "subrole": "AXSwitch", "value": 0, "help": null, "enabled": true}},
  {"id": "disabled", "props": {"accessibilityLabel": "Dyn", "accessibilityRole": "button", "accessibilityState": {"disabled": true}},
    "expect": {"role": "AXButton", "enabled": false}},
  {"id": "enabled", "props": {"accessibilityLabel": "Dyn", "accessibilityRole": "button"},
    "expect": {"role": "AXButton", "enabled": true}},
  {"id": "heading", "props": {"accessibilityLabel": "Dyn", "accessibilityRole": "header"},
    "expect": {"role": "AXStaticText", "roleDescription": "heading"}},
  {"id": "tab", "props": {"accessibilityLabel": "Dyn", "role": "tab", "accessibilityState": {"selected": true}},
    "expect": {"role": "AXRadioButton", "subrole": "AXTabButton", "value": 1}},
  {"id": "listitem", "props": {"accessibilityLabel": "Dyn", "role": "listitem", "accessibilityState": {"selected": true}},
    "expect": {"selected": true}},
  {"id": "toggle", "props": {"accessibilityLabel": "Dyn", "accessibilityRole": "togglebutton", "accessibilityState": {"checked": true}},
    "expect": {"role": "AXCheckBox", "subrole": "AXToggle", "roleDescription": "toggle button", "value": 1}},
  {"id": "link", "props": {"accessibilityLabel": "Dyn", "accessibilityRole": "link"}, "expect": {"role": "AXLink"}},
  {"id": "banner", "props": {"accessibilityLabel": "Dyn", "role": "banner"},
    "expect": {"role": "AXGroup", "subrole": "AXLandmarkRegion", "roleDescription": "banner"}},
  {"id": "aria", "props": {"aria-label": "Dyn", "role": "switch", "aria-checked": true}, "expect": {"role": "AXCheckBox", "subrole": "AXSwitch", "value": 1}},
]
var application: Node
var surfaces: Dictionary = {}
var checks: Array = []
var stages: Dictionary = {}
var allow_original_negative := false
var expected_original_failures: Array = []
var directory := ""
var request_id := 0
var waits: Array = []
# Why the inspector is taken as lost (ask), or empty while it answers.
var inspector_lost := ""

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
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(AccessibilityProbe." + expression + ")"))

func run_js(expression: String) -> void:
  application.call("evaluate", "AccessibilityProbe." + expression)

func state() -> Dictionary:
  var value: Variant = js("snapshot()")
  return value if value is Dictionary else {}

func mount(name: String, position: Vector2) -> void:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = name
  surface.position = position
  surface.size = Vector2(360, 440)
  surface.set("application_path", NodePath("../AccessibilityApplication"))
  surface.set("component_name", "AccessibilityProbe")
  surface.set("initial_props", {"name": name})
  surfaces[name] = surface
  root.add_child(surface)

# One round trip with the inspector, counted in frames. An answer that does not come is reported as such, with
# "unanswered": true. The first time that happens the inspector is taken as lost: every later ask fails at once with the
# same reason, so a dead inspector costs POLL_FRAMES once and not once per wait and press, and the probe still writes its
# report well inside the test's timeout.
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
  # No answer: withdraw the request the inspector never took, so that it cannot answer it after the next one has
  # been asked. A late reply to an earlier id is still ignored above, which checks the id.
  if FileAccess.file_exists(request_path):
    DirAccess.remove_absolute(request_path)
  inspector_lost = "the inspector did not answer the %s request in %d frames" % [operation.get("op", "?"), POLL_FRAMES]
  # A check of its own (once), so that the loss is in the report and in the log as a failure with its reason.
  check(false, "bridge/The inspector answers every request: " + inspector_lost)
  return {"error": inspector_lost, "unanswered": true}

# Every node of a tree, depth first.
func flatten(node: Dictionary, nodes: Array = []) -> Array:
  nodes.append(node)
  for child: Dictionary in node.get("children", []):
    flatten(child, nodes)
  return nodes

func titled(nodes: Array, title: String) -> Array:
  return nodes.filter(func(node: Dictionary) -> bool: return node.get("title") == title)

# An empty help is no help: AccessKit sets the description only when there is one.
func attribute(node: Dictionary, key: String) -> Variant:
  var found: Variant = node.get(key)
  return null if found is String and found == "" else found

func describes(node: Dictionary, expected: Dictionary) -> bool:
  for key: String in expected:
    if key == "count":
      continue
    var actual: Variant = attribute(node, key)
    var wanted: Variant = expected[key]
    # AccessKit hands a check box's value over as a boolean NSNumber, which JSON writes as true or false.
    if actual is bool and (wanted is int or wanted is float):
      actual = 1 if actual else 0
    if wanted is int or wanted is float:
      if not (actual is int or actual is float) or float(actual) != float(wanted):
        return false
    elif actual != wanted:
      return false
  return true

# Asks for the tree until the predicate holds on its nodes, or the frames run out. Returns the last tree. An inspector
# that does not answer ends the wait at once, as a wait that was not met and says why: asking again would only spend
# POLL_FRAMES more on each of the FRAMES attempts.
func wait_tree(label: String, predicate: Callable) -> Dictionary:
  var last := {}
  for attempt in range(FRAMES):
    var answer := await ask({"op": "dump"})
    if answer.get("unanswered", false):
      waits.append({"label": label, "attempts": attempt + 1, "met": false, "error": answer.error})
      return last
    if answer.has("tree"):
      last = answer.tree
      if predicate.call(flatten(answer.tree)):
        waits.append({"label": label, "attempts": attempt + 1, "met": true})
        return last
    await process_frame
  waits.append({"label": label, "attempts": FRAMES, "met": false})
  return last

# Waits for a state of the app's log.
func wait_log(label: String, minimum: int) -> Dictionary:
  var last := {}
  # The events it waits for come from presses the inspector never made.
  if inspector_lost != "":
    waits.append({"label": label, "attempts": 0, "met": false, "error": inspector_lost})
    return state()
  for attempt in range(FRAMES):
    last = state()
    if handlers(last.get("log", [])).size() >= minimum:
      waits.append({"label": label, "attempts": attempt + 1, "met": true})
      return last
    await process_frame
  waits.append({"label": label, "attempts": FRAMES, "met": false})
  return last

func press(title: String, occurrence: int = 0) -> Dictionary:
  return await ask({"op": "press", "title": title, "occurrence": occurrence})

func handlers(log: Array) -> Array:
  return log.filter(func(row: Dictionary) -> bool: return row.label != "raw")

func touches(log: Array) -> Array:
  return log.filter(func(row: Dictionary) -> bool: return row.label == "raw" and row.type.begins_with("topTouch"))

func summary(log: Array) -> Array:
  return handlers(log).map(func(row: Dictionary) -> Array: return [row.label, row.root, row.id])

func tree_stage() -> void:
  var tree := await wait_tree("tree", func(nodes: Array) -> bool: return titled(nodes, "Save draft").size() == 2 and titled(nodes, "Temporary").size() == 2)
  var nodes := flatten(tree)
  var exact := true
  for title: String in TREE:
    var found := titled(nodes, title)
    exact = exact and found.size() == TREE[title].count and found.all(func(node: Dictionary) -> bool: return describes(node, TREE[title]))
  check(exact, "tree/The OS tree names every View RN labeled, with the role, the hint and the enabled state RN gave it, in both roots", true)
  check(titled(nodes, "Open").size() == 2 and titled(nodes, "Skipped").is_empty() and titled(nodes, "Gone").is_empty(),
    "tree/importantForAccessibility no-hide-descendants and display none leave nothing of the View in the OS tree", true)
  check(titled(nodes, "Save draft").size() == 2 and titled(nodes, "Save draft").all(func(node: Dictionary) -> bool: return node.get("enabled") == true),
    "tree/Both roots serve their own element of the same label", true)
  check(titled(nodes, "Like").size() == 2 and titled(nodes, "Like").all(func(node: Dictionary) -> bool: return node.get("role") == "AXRadioButton" and node.get("subrole") == "AXTabButton"),
    "tree/accessibilityRole tab is the OS's tab button", true)
  stages.tree = {"tree": tree}

# onAccessibilityTap answers AXPress and nothing else.
func press_tap_stage() -> void:
  run_js("arm('press/tap')")
  var answer := await press("Save draft", 0)
  var after := await wait_log("press/tap", 1)
  check(answer.get("pressed") == true and summary(after.get("log", [])) == [["tap", "A", "labeled"]] and touches(after.get("log", [])).is_empty(),
    "press/AXPress on a View with onAccessibilityTap runs that handler and sends RN no touch", true)
  stages["press/tap"] = {"answer": answer, "react": after}

func press_stage() -> void:
  run_js("arm('press/tap-wins')")
  var wins := await press("Tap wins", 0)
  var wins_state := await wait_log("press/tap-wins", 1)
  check(wins.get("pressed") == true and summary(wins_state.get("log", [])) == [["tap", "A", "tap-press"]] and touches(wins_state.get("log", [])).is_empty(),
    "press/A Pressable with both handlers answers AXPress with onAccessibilityTap, not onPress", true)
  stages["press/tap-wins"] = {"answer": wins, "react": wins_state}
  # Without a handler AXPress clicks the View, and RN's own press handling runs.
  for spec: Array in [["Open", "pressable"], ["Share", "touchable"], ["Mute", "touchable-aria"], ["Like", "pressable-aria"]]:
    run_js("arm('press/%s')" % spec[1])
    var pressed := await press(spec[0], 0)
    var after := await wait_log("press/" + spec[1], 1)
    var log: Array = after.get("log", [])
    check(pressed.get("pressed") == true and summary(log) == [["press", "A", spec[1]]] and touches(log).map(func(row: Dictionary) -> String: return row.type) == ["topTouchStart", "topTouchEnd"],
      "press/AXPress on %s without a handler clicks it and RN runs its onPress once" % spec[0], true)
    stages["press/" + spec[1]] = {"answer": pressed, "react": after}
  # Disabled elements answer no press, and nothing reaches RN: the real press after them is the first event.
  run_js("arm('press/disabled')")
  var locked := await press("Locked", 0)
  var off := await press("Off", 0)
  var marker := await press("Open", 0)
  var disabled_state := await wait_log("press/disabled", 1)
  check(locked.get("matched") == 2 and locked.get("pressed") == false and off.get("matched") == 2 and off.get("pressed") == false and marker.get("pressed") == true and \
    summary(disabled_state.get("log", [])) == [["press", "A", "pressable"]],
    "press/A disabled element refuses AXPress and RN sees nothing of it", true)
  stages["press/disabled"] = {"locked": locked, "off": off, "marker": marker, "react": disabled_state}
  # The second root has its own element: the second match is root B's.
  run_js("arm('press/two-roots')")
  var second := await press("Save draft", 1)
  var second_state := await wait_log("press/two-roots", 1)
  check(second.get("pressed") == true and summary(second_state.get("log", [])) == [["tap", "B", "labeled"]],
    "press/AXPress on the second root's View reaches that root's handler", true)
  stages["press/two-roots"] = {"answer": second, "react": second_state}

func update_stage() -> void:
  var rows: Array = []
  # A label changes in place.
  run_js("relabel('A','Renamed')")
  var renamed := await wait_tree("update/relabel", func(nodes: Array) -> bool: return titled(nodes, "Renamed").size() == 1 and titled(nodes, "Save draft").size() == 1)
  var named := titled(flatten(renamed), "Renamed")
  check(named.size() == 1 and describes(named[0], {"role": "AXButton", "help": "Saves the draft"}),
    "update/Changing accessibilityLabel renames the element in the OS tree and keeps its role and hint", true)
  rows.append({"id": "relabel", "tree": renamed})
  # The View with any props: each update shows in the tree.
  var all_steps := true
  for step: Dictionary in UPDATES:
    run_js("setDyn('A',%s,false)" % JSON.stringify(step.props))
    var tree := await wait_tree("update/" + step.id, func(nodes: Array) -> bool:
      var found := titled(nodes, "Dyn")
      return found.size() == 1 and describes(found[0], step.expect))
    var found := titled(flatten(tree), "Dyn")
    var ok: bool = found.size() == 1 and describes(found[0], step.expect)
    all_steps = all_steps and ok
    rows.append({"id": step.id, "props": step.props, "expect": step.expect, "ok": ok, "node": found[0] if found.size() == 1 else null})
  check(all_steps, "update/Each prop update reaches the OS tree: role, state, value, hint, enabled and role description follow it", true)
  # Removing every prop takes the name and the role away.
  run_js("setDyn('A',{},false)")
  var removed := await wait_tree("update/removal", func(nodes: Array) -> bool: return titled(nodes, "Dyn").is_empty())
  check(titled(flatten(removed), "Dyn").is_empty() and titled(flatten(removed), "Save draft").size() == 1, "update/Removing every prop takes the name and the role out of the OS tree", true)
  rows.append({"id": "removal", "tree": removed})
  # aria-hidden hides the element, and the descendants with it.
  run_js("hide('A',true)")
  var hidden := await wait_tree("update/hidden", func(nodes: Array) -> bool: return titled(nodes, "Inside").size() == 1)
  check(titled(flatten(hidden), "Inside").size() == 1 and titled(flatten(hidden), "Open").size() == 2,
    "update/aria-hidden on a View removes the View's descendants from the OS tree and no other element", true)
  rows.append({"id": "hidden", "tree": hidden})
  run_js("hide('A',false)")
  var shown := await wait_tree("update/shown", func(nodes: Array) -> bool: return titled(nodes, "Inside").size() == 2)
  check(titled(flatten(shown), "Inside").size() == 2, "update/Showing the View again brings its descendants back", true)
  rows.append({"id": "shown", "tree": shown})
  # A View with aria-hidden is not in the tree. The marker View appears in the same update, so that the wait is on a
  # state that shows the update was applied.
  run_js("setDyn('A',{'accessibilityLabel':'Dyn gone','aria-hidden':true},false)")
  run_js("setAria('A',{'accessibilityLabel':'Dyn marker'},false)")
  var aria_hidden := await wait_tree("update/aria-hidden", func(nodes: Array) -> bool: return titled(nodes, "Dyn marker").size() == 1)
  check(titled(flatten(aria_hidden), "Dyn marker").size() == 1 and titled(flatten(aria_hidden), "Dyn gone").is_empty(),
    "update/A View with aria-hidden is not in the OS tree while its sibling updated in the same commit is", true)
  rows.append({"id": "aria-hidden", "tree": aria_hidden})
  run_js("setDyn('A',{},false)")
  run_js("setAria('A',{},false)")
  # Unmounting and mounting a View.
  run_js("remove('A')")
  var gone := await wait_tree("update/removable", func(nodes: Array) -> bool: return titled(nodes, "Temporary").size() == 1)
  check(titled(flatten(gone), "Temporary").size() == 1, "update/Unmounting a View removes its element from the OS tree", true)
  run_js("restore('A')")
  var back := await wait_tree("update/restored", func(nodes: Array) -> bool: return titled(nodes, "Temporary").size() == 2)
  check(titled(flatten(back), "Temporary").size() == 2, "update/Mounting it again puts a new element in the OS tree", true)
  rows.append({"id": "remount", "gone": gone, "back": back})
  stages.update = rows

func _initialize() -> void:
  allow_original_negative = OS.get_cmdline_user_args().has("--allow-original-negative")
  directory = OS.get_environment("FABRIC_AX_DIR")
  call_deferred("run_probe")

func run_probe() -> void:
  if directory == "":
    push_error("FABRIC_CHECK_FAILED: FABRIC_AX_DIR names the inspector's directory")
    quit(1)
    return
  application = ClassDB.instantiate("FabricApplication")
  application.name = "AccessibilityApplication"
  application.set("bundle_path", "res://build/accessibility-probe.js")
  root.add_child(application)
  mount("A", Vector2(0, 0))
  mount("B", Vector2(380, 0))
  await settle(20)
  check(is_accessibility_enabled() and is_accessibility_supported(), "bridge/Godot runs with an OS accessibility driver and an active tree (--accessibility always)")
  await tree_stage()
  await press_tap_stage()
  if not allow_original_negative:
    await press_stage()
    await update_stage()
  stages.beforeStop = {"application": JSON.parse_string(application.call("snapshot")), "react": state()}
  application.call("stop")
  await settle()
  for name: String in ["A", "B"]:
    surfaces[name].queue_free()
  application.queue_free()
  await settle()
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var observed := failures.duplicate()
  var expected := expected_original_failures.duplicate()
  observed.sort()
  expected.sort()
  var original_negative_observed := allow_original_negative and observed == expected and not failures.is_empty()
  var report := {"scenario": "native-accessibility-bridge", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages, "waits": waits, "inspectorLost": inspector_lost,
    "expectedOriginalFailures": expected_original_failures, "allowOriginalNegative": allow_original_negative,
    "originalNegativeObserved": original_negative_observed, "allCurrentAssertionsPassed": failures.is_empty(),
    "accessibilitySupported": AccessibilityServer.is_supported(), "accessibilityEnabled": is_accessibility_enabled(),
    "scope": {"headless": false, "osTree": true, "nsAccessibility": true, "inProcessInspector": true, "axPress": true,
      "assistiveTechnologySpeech": false, "externalAXUIElement": false, "hardwareCertified": false}}
  var output := FileAccess.open("res://build/accessibility-bridge-report.json", FileAccess.WRITE)
  if not check(output != null, "report/Bridge report is saved"):
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  if original_negative_observed:
    print("ACCESSIBILITY_BRIDGE_ORIGINAL_NEGATIVE: " + str(failures.size()))
  elif failures.is_empty():
    print("ACCESSIBILITY_BRIDGE_PASSED: " + str(checks.size()))
  else:
    print("ACCESSIBILITY_BRIDGE_FAILED")
  quit(0 if failures.is_empty() or original_negative_observed else 1)
