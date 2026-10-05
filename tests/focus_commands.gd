extends SceneTree

var checks: Array = []
var cases: Array = []
var owners: Array = []
var shared: Node
var independent: Node
var surfaces: Dictionary = {}
var expected_errors: Array = []

func check(condition: bool, name: String) -> void:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)

func settle() -> void:
  for index in range(8):
    await process_frame

func state(application: Node) -> Dictionary:
  var value: Variant = JSON.parse_string(application.call("snapshot"))
  return value if value is Dictionary else {}

func react(application: Node) -> Dictionary:
  var value: Variant = JSON.parse_string(application.call("evaluate", "JSON.stringify(FocusCommandFixture.snapshot())"))
  return value if value is Dictionary else {}

func js(application: Node, expression: String) -> void:
  application.call("evaluate", expression)

func command(application: Node, name: String, field: String, operation: String) -> void:
  js(application, "FocusCommandFixture.command(%s,%s,%s)" % [JSON.stringify(name), JSON.stringify(field), JSON.stringify(operation)])
  await settle()

func application(label: String) -> Node:
  var owner: Node = ClassDB.instantiate("FabricApplication")
  owner.name = label
  owner.set("bundle_path", "res://build/focus-commands.js")
  root.add_child(owner)
  return owner

func mount(name: String, owner: Node, offset: Vector2) -> Control:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = name
  surface.position = offset
  surface.size = Vector2(260, 210)
  surface.set("application_path", NodePath("../" + str(owner.name)))
  surface.set("component_name", "FocusCommandsFixture")
  surface.set("initial_props", {"name": name})
  root.add_child(surface)
  surfaces[name] = surface
  return surface

func input(name: String, field: String = "input") -> LineEdit:
  var surface: Control = surfaces[name]
  return surface.find_child(name + "-" + field, true, false) as LineEdit

func focus_owner(name: String, field: String, stage: String) -> void:
  var expected := input(name, field) if not name.is_empty() else null
  var actual := root.gui_get_focus_owner()
  var all_match := true
  for root_name: String in surfaces:
    for field_name in ["input", "readonly", "victim"]:
      var node := input(root_name, field_name)
      if node != null and node.has_focus() != (node == expected):
        all_match = false
  var passed := (name.is_empty() or expected != null) and actual == expected and all_match
  check(passed, "Actual Viewport owner and LineEdit.has_focus agree: " + stage)
  owners.append({"stage": stage, "expected": name + "-" + field if not name.is_empty() else "",
    "actual": str(actual.name) if actual != null else "", "passed": passed})

func state_owner(owner: Node, name: String, field: String, stage: String) -> void:
  var snapshot := react(owner)
  var expected: Variant = name + "-" + field if not name.is_empty() else null
  check(snapshot.get("focusedKey") == expected and snapshot.get("originalSingletonSame", false),
    "Original RN singleton and public State agree: " + stage)

func _initialize() -> void:
  call_deferred("run_probe")

func run_probe() -> void:
  root.size = Vector2i(840, 280)
  shared = application("SharedFocusCommands")
  independent = application("IndependentFocusCommands")
  mount("A", shared, Vector2(10, 10))
  mount("B", shared, Vector2(290, 10))
  mount("C", independent, Vector2(570, 10))
  await settle()
  check(state(shared).get("rootCount", -1) == 2 and state(independent).get("rootCount", -1) == 1,
    "Original AppRegistry mounts two shared roots and an independent application")
  check(state(shared).get("bundleEvaluations", -1) == 1 and state(independent).get("bundleEvaluations", -1) == 1,
    "Each application evaluates only the isolated command bundle once")
  check(state(shared).get("runtimeId") != state(independent).get("runtimeId"),
    "Independent application owns a distinct Hermes runtime")
  check(react(shared).get("live", {}).size() == 6 and react(independent).get("live", {}).size() == 3 and
    react(shared).get("live", {}).values().all(func(entry: Dictionary) -> bool: return entry.get("registered", false) and entry.get("connected", false)) and
    react(independent).get("live", {}).values().all(func(entry: Dictionary) -> bool: return entry.get("registered", false) and entry.get("connected", false)),
    "Public input refs are registered in their application singleton")
  check(state(shared).get("errors", ["missing"]).is_empty() and state(independent).get("errors", ["missing"]).is_empty(),
    "Both applications initialize without a native diagnostic")
  await command(shared, "B", "input", "focus")
  focus_owner("B", "input", "initial original Codegen focus")
  state_owner(shared, "B", "input", "initial original Codegen focus")

  for kind: String in ["null", "object", "string", "nonempty"]:
    for operation: String in ["focus", "blur"]:
      var target := "A" if operation == "focus" else "B"
      var before := react(shared)
      var errors_before: int = state(shared).get("errors", []).size()
      js(shared, "FocusCommandFixture.raw(%s,'input',%s,%s)" % [JSON.stringify(target), JSON.stringify(operation), JSON.stringify(kind)])
      await settle()
      var after := react(shared)
      expected_errors.append(operation + " requires an empty argument array")
      var errors: Array = state(shared).get("errors", [])
      check(errors.size() == errors_before + 1 and errors == expected_errors,
        "Malformed " + operation + "/" + kind + " reports exactly the native empty-array guard")
      focus_owner("B", "input", operation + "/" + kind + " rejected")
      check(after.get("focusedTag") == before.get("focusedTag") and after.get("events") == before.get("events") and after.get("originalSingletonSame", false),
        "Malformed " + operation + "/" + kind + " preserves actual focus, public State and editing events")
      js(shared, "FocusCommandFixture.action('B','update')")
      js(independent, "FocusCommandFixture.action('C','update')")
      await settle()
      var expected_updates := expected_errors.size()
      check(input("B") != null and input("C") != null and
        react(shared).get("updates", {}).get("B", -1) == expected_updates and input("B").text == "B:" + str(expected_updates) and
        react(independent).get("updates", {}).get("C", -1) == expected_updates and input("C").text == "C:" + str(expected_updates) and state(independent).get("errors", ["missing"]).is_empty(),
        "Unrelated root and independent application commit after " + operation + "/" + kind + " rejection")
      await command(shared, "A", "input", "focus")
      focus_owner("A", "input", operation + "/" + kind + " recovery focus")
      state_owner(shared, "A", "input", operation + "/" + kind + " recovery focus")
      await command(shared, "A", "input", "blur")
      focus_owner("", "", operation + "/" + kind + " recovery blur")
      state_owner(shared, "", "", operation + "/" + kind + " recovery blur")
      await command(shared, "B", "input", "focus")
      focus_owner("B", "input", operation + "/" + kind + " unrelated root recovery")
      check(state(shared).get("errors", []) == expected_errors,
        "Valid original Codegen commands add no diagnostic after " + operation + "/" + kind)
      cases.append({"command": operation, "kind": kind, "before": before, "afterRejection": after,
        "afterRecovery": react(shared), "errors": errors})

  var readonly_before := react(shared)
  await command(shared, "A", "readonly", "focus")
  await command(shared, "A", "readonly", "blur")
  focus_owner("B", "input", "readonly original Codegen commands")
  check(input("A", "readonly") != null and not input("A", "readonly").is_editable() and
    react(shared).get("focusedTag") == readonly_before.get("focusedTag") and react(shared).get("events") == readonly_before.get("events"),
    "Direct readonly commands preserve native focus and the shared State")

  js(shared, "FocusCommandFixture.retain('A','victim','removed'); FocusCommandFixture.action('A','remove')")
  await settle()
  check(input("A", "victim") == null and not react(shared).get("retained", {}).get("removed", {}).get("connected", true) and
    not react(shared).get("retained", {}).get("removed", {}).get("registered", true),
    "Committed removal disconnects the retained public input and its original registry entry")
  var removed_before := react(shared)
  js(shared, "FocusCommandFixture.stale('removed')")
  await settle()
  focus_owner("B", "input", "removed public ref commands")
  check(react(shared).get("events") == removed_before.get("events") and state(shared).get("errors", []) == expected_errors,
    "Retained removed ref cannot focus, blur, emit editing events or add native authority")

  js(shared, "FocusCommandFixture.retain('B','input','stopped')")
  await command(independent, "C", "input", "focus")
  focus_owner("C", "input", "independent original Codegen focus")
  state_owner(independent, "C", "input", "independent original Codegen focus")
  state_owner(shared, "", "", "native cross-application blur")
  shared.call("stop")
  await settle()
  var shared_stopped := state(shared)
  var stopped_react := react(shared)
  check(stopped_react.get("live", {"missing": true}).is_empty() and stopped_react.get("focusedTag") == null and
    stopped_react.get("cleanups", {}).get("A", 0) == 1 and stopped_react.get("cleanups", {}).get("B", 0) == 1 and
    not stopped_react.get("retained", {}).get("stopped", {}).get("connected", true) and
    not stopped_react.get("retained", {}).get("stopped", {}).get("registered", true),
    "Application stop unregisters both shared roots and disconnects their retained ref")
  var independent_before := react(independent)
  js(shared, "FocusCommandFixture.stale('removed'); FocusCommandFixture.stale('stopped')")
  await settle()
  focus_owner("C", "input", "stopped application stale commands")
  check(react(independent).get("focusedTag") == independent_before.get("focusedTag") and
    react(independent).get("events") == independent_before.get("events") and state(shared) == shared_stopped,
    "Stopped application commands cannot steal another owner's focus or change retired diagnostics")
  await command(independent, "C", "input", "blur")
  focus_owner("", "", "independent blur after other owner stop")
  state_owner(independent, "", "", "independent blur after other owner stop")
  await command(independent, "C", "input", "focus")
  focus_owner("C", "input", "independent recovery after other owner stop")
  independent.call("stop")
  await settle()
  focus_owner("", "", "final stop")
  var after := {"shared": state(shared), "independent": state(independent)}
  var final_react := {"shared": react(shared), "independent": react(independent)}
  for label: String in ["shared", "independent"]:
    var status: Dictionary = after[label]
    check(status.get("stopped", false) and status.get("rootCount", -1) == 0,
      "Final stop releases application roots: " + label)
    check(status.get("pendingTimers", -1) == 0 and status.get("pendingAnimationFrames", -1) == 0 and
      status.get("pendingWork", -1) == 0 and status.get("pendingRootRetirements", -1) == 0,
      "Final stop releases scheduled work and retirement scopes: " + label)
    check(final_react[label].get("live", {"missing": true}).is_empty() and final_react[label].get("focusedTag") == null and
      final_react[label].get("registrations", {}).size() == (6 if label == "shared" else 3) and
      final_react[label].get("registrations", {}).values().all(func(entry: Dictionary) -> bool: return not entry.get("registered", true) and not entry.get("connected", true) and not entry.get("focused", true)) and
      final_react[label].get("events", []).all(func(event: Dictionary) -> bool: return event.get("stateAgrees", false)),
      "Final original registry and all actual event callbacks agree with public State: " + label)
  for name: String in surfaces:
    var status: Dictionary = JSON.parse_string(surfaces[name].call("snapshot"))
    check(status.get("creates", -1) == status.get("deletes", -2) and status.get("nativeTags", -1) == 0 and
      status.get("nodes", ["missing"]).is_empty(), "Native Create/Delete lifetimes are balanced: " + name)
    surfaces[name].queue_free()
  check(after.shared.get("errors", []) == expected_errors and after.independent.get("errors", ["missing"]).is_empty(),
    "Only eight deliberate command diagnostics survive final cleanup")
  shared.queue_free()
  independent.queue_free()
  await settle()
  var output := FileAccess.open("res://build/focus-commands-report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_CHECK_FAILED: Cannot publish focus command report")
    quit(1)
    return
  output.store_string(JSON.stringify({"scenario": "focus-commands", "engine": "hermes", "renderer": "fabric",
    "godot": Engine.get_version_info().string, "reactNative": "0.87.1", "displayServer": DisplayServer.get_name(),
    "bundlePath": "res://build/focus-commands.js", "checks": checks, "cases": cases, "focusOwners": owners,
    "expectedErrors": expected_errors, "afterStop": after, "reactState": final_react}, "  ") + "\n")
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  print("FOCUS_COMMANDS_FAILED" if failed else "FOCUS_COMMANDS_PASSED: " + str(checks.size()))
  quit(1 if failed else 0)
