extends SceneTree

# The prop policy of the 0.5 scope (src/prop-scope.mjs) through the six public components, in one Hermes application with one
# root. The fixture (tests/scope-0.5-fixture.jsx) renders every case of a group in its own boundary beside a baseline; this
# probe drives each group three ways and records what React and the host did, without judging more than the sentences below:
#   mount    the cases are mounted with their prop (every slot replaced);
#   update   the baseline is mounted, then the same elements receive the prop in place (no key changes);
#   cleanup  the groups are removed and the host's Controls balance.
# Nothing waits for a number of frames: each wait is for the state it names (the commit of the request, then a host that has
# stopped changing, then images that are not loading). tests/scope-0.5-oracle.mjs re-derives the expected outcomes from the
# inventory and the manifest and judges the raw nodes of this report, not these verdicts.
const MAX_FRAMES := 900
const QUIET := 4
const VOLATILE := ["tag", "id", "testID", "x", "y", "fabricX", "fabricY", "focused"]
var application: Node
var surface: Control
var checks: Array = []
var expected_original_failures: Array = []
var allow_original_negative := false
var plan: Dictionary = {}
var group_reports: Array = []
var seen_errors := 0
var waits: Array = []

func check(condition: bool, name: String, normative: bool = false) -> bool:
  checks.append({"name": name, "passed": condition})
  if normative:
    expected_original_failures.append(name)
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(ScopeProbe." + expression + ")"))

# A JS action without a result; evaluate() would return "undefined".
func run_js(expression: String) -> void:
  application.call("evaluate", "ScopeProbe." + expression)

func native(target: Object) -> Dictionary:
  var value: Variant = JSON.parse_string(target.call("snapshot"))
  return value if value is Dictionary else {}

func all_nodes() -> Array:
  return native(surface).get("nodes", [])

func host_errors() -> Array:
  return native(application).get("errors", [])

# The host's errors since the last call.
func new_host_errors() -> Array:
  var all := host_errors()
  var fresh := all.slice(seen_errors)
  seen_errors = all.size()
  return fresh

func loading(nodes: Array) -> bool:
  for entry: Dictionary in nodes:
    if entry.has("image") and entry.image.get("status", "") == "loading":
      return true
  return false

# Waits for the state of the request: React committed it, the host stopped changing for QUIET frames in a row and no image is
# still loading. A pace-free wait: it ends on the state, and the frame cap only fails a host that never gets there.
func settle(label: String) -> bool:
  var quiet := 0
  var last := ""
  for frame in range(MAX_FRAMES):
    await process_frame
    var state: Dictionary = js("snapshot()")
    if int(state.committed) < int(state.requested):
      continue
    var snapshot := native(surface)
    var signature := str(snapshot.get("nodes", []).size()) + ":" + str(snapshot.get("commits", 0)) + ":" + str(snapshot.get("updates", 0))
    quiet = quiet + 1 if signature == last else 0
    last = signature
    if quiet >= QUIET and not loading(snapshot.get("nodes", [])):
      waits.append({"label": label, "frames": frame + 1})
      return true
  check(false, "settle/" + label + " reached the requested state")
  return false

# The nodes of one slot (its cell, its element and what is inside), as the host reported them.
func nodes_of(slot: String) -> Array:
  var found: Array = []
  for entry: Dictionary in all_nodes():
    if str(entry.testID).begins_with(slot + "-"):
      found.append(entry)
  return found

func slots_of(group: Dictionary) -> Array:
  var slots: Array = []
  for entry: Dictionary in group.baselines:
    slots.append(entry.slot)
  for entry: Dictionary in group.cases:
    slots.append(entry.slot)
  return slots

func read_slots(group: Dictionary) -> Dictionary:
  var by_slot := {}
  for slot: String in slots_of(group):
    by_slot[slot] = nodes_of(slot)
  return by_slot

# What a node looks like once what differs between two instances of the same element is taken away: identities, positions, the
# host's own counters of what it did and when, and whether a modal's window is the exclusive one (the modal stack gives that to
# the last window it presented, so it depends on where the element is in the group, not on the element).
func normalize(node: Dictionary) -> Dictionary:
  var value := node.duplicate(true)
  for key: String in VOLATILE:
    value.erase(key)
  if value.has("modalWindow"):
    value.modalWindow.erase("id")
    value.modalWindow.erase("parentId")
    value.modalWindow.erase("exclusive")
  if value.has("image"):
    for key: String in ["counters", "events", "ignored", "drawn", "planned"]:
      value.image.erase(key)
  # Counters of what the host did, which depend on when it did it: the spinner's frames and turns, the accessibility applier's
  # passes.
  if value.has("activity"):
    for key: String in ["frames", "draws", "turns"]:
      value.activity.erase(key)
    if value.activity.has("drawn"):
      value.activity.drawn.erase("turns")
      value.activity.drawn.erase("head")
  if value.has("accessibility"):
    value.accessibility.erase("applies")
    value.accessibility.erase("clicks")
  return value

func suffix_of(node: Dictionary, slot: String) -> String:
  return str(node.testID).substr(slot.length() + 1)

# The slot's nodes by what they are inside the slot, normalized.
func shape(nodes: Array, slot: String) -> Dictionary:
  var shaped := {}
  for entry: Dictionary in nodes:
    shaped[suffix_of(entry, slot)] = normalize(entry)
  return shaped

func same_shape(left: Dictionary, right: Dictionary) -> bool:
  return JSON.stringify(left, "", true) == JSON.stringify(right, "", true)

func errors_since(count: int) -> Array:
  var state: Dictionary = js("snapshot()")
  return state.errors.slice(count)

func error_count() -> int:
  var state: Dictionary = js("snapshot()")
  return state.errors.size()

# One group in the three ways. The report keeps the raw nodes and the raw errors.
func run_group(group: Dictionary) -> bool:
  var settled := true
  var id: String = group.id
  var report := {"id": id, "component": group.component, "kind": group.kind, "baselines": group.baselines, "cases": group.cases}
  var first := error_count()
  run_js("show(" + JSON.stringify(id) + ", 'base', true)")
  settled = await settle(id + "/base") and settled
  report.base = {"slots": read_slots(group), "errors": errors_since(first), "hostErrors": new_host_errors()}
  var before := error_count()
  run_js("show(" + JSON.stringify(id) + ", 'case', true)")
  settled = await settle(id + "/mount") and settled
  report.mount = {"slots": read_slots(group), "errors": errors_since(before), "hostErrors": new_host_errors()}
  run_js("show(" + JSON.stringify(id) + ", 'base', true)")
  settled = await settle(id + "/reset") and settled
  new_host_errors()
  var middle := error_count()
  run_js("show(" + JSON.stringify(id) + ", 'case', false)")
  settled = await settle(id + "/update") and settled
  report.update = {"slots": read_slots(group), "errors": errors_since(middle), "hostErrors": new_host_errors()}
  group_reports.append(report)
  return settled

# What the probe itself requires of a group, so that a log says which group failed. The oracle judges every case again.
func judge(report: Dictionary) -> void:
  var id: String = report.id
  var kind: String = report.kind
  var baseline_slot: String = report.baselines[0].slot
  for phase: String in ["mount", "update"]:
    var data: Dictionary = report[phase]
    var failed_slots := {}
    for entry: Dictionary in data.errors:
      failed_slots[entry.slot] = int(failed_slots.get(entry.slot, 0)) + 1
    if kind == "refused" or kind == "legacy":
      var good := true
      for entry: Dictionary in report.cases:
        var slot: String = entry.slot
        var recorded: Array = data.errors.filter(func(row: Dictionary) -> bool: return row.slot == slot)
        var mounted: Array = data.slots[slot].filter(func(row: Dictionary) -> bool: return str(row.testID).ends_with("-el"))
        good = good and recorded.size() == 1 and recorded[0].message == entry.message and mounted.is_empty()
      good = good and data.hostErrors.is_empty()
      check(good, id + "/" + phase + "/Each refused prop fails in its own boundary with the error of the table and mounts nothing", kind == "refused")
    else:
      var clean: bool = data.errors.is_empty() and data.hostErrors.is_empty()
      # The Text of main refused the platform options at their defaults too: the control sees the new rule.
      check(clean, id + "/" + phase + "/No case fails and the host reports nothing", kind == "default" and report.component == "Text")
      if kind == "ignored" or kind == "undeclared" or kind == "default":
        var reference := shape(data.slots[baseline_slot], baseline_slot)
        var equal := true
        for entry: Dictionary in report.cases:
          var slot: String = entry.slot
          equal = equal and same_shape(shape(data.slots[slot], slot), reference)
        # The Pressable of main hands the Control's own names (text, onActivate...) to the host: the causal control sees it.
        var sentence := "Each refused prop's default leaves the host exactly as the baseline has it" if kind == "default" \
          else "Every ignored prop leaves the host exactly as the baseline has it"
        check(equal, id + "/" + phase + "/" + sentence, (kind == "undeclared" and report.component == "Pressable") or (kind == "default" and report.component == "Text"))

func judge_controls(report: Dictionary) -> void:
  var data: Dictionary = report.mount
  var good: bool = data.errors.is_empty() and data.hostErrors.is_empty()
  var effects := {}
  for entry: Dictionary in report.cases:
    var slot: String = entry.slot
    var base_slot := slot + "#base"
    effects[entry.component] = not same_shape(shape(data.slots[slot], slot), shape(data.slots[base_slot], base_slot))
  for component: String in effects:
    good = good and effects[component]
  check(good, "controls/A supported prop of each component changes what the host shows, and nothing fails")

func _initialize() -> void:
  allow_original_negative = OS.get_cmdline_user_args().has("--allow-original-negative")
  call_deferred("run_probe")

func run_probe() -> void:
  root.size = Vector2i(1200, 700)
  application = ClassDB.instantiate("FabricApplication")
  application.name = "ScopeApplication"
  application.set("bundle_path", "res://build/scope-0.5-probe.js")
  root.add_child(application)
  surface = ClassDB.instantiate("FabricSurface")
  surface.name = "Scope"
  surface.size = Vector2(1200, 700)
  surface.set("application_path", NodePath("../ScopeApplication"))
  surface.set("component_name", "ScopeProbe")
  root.add_child(surface)
  for frame in range(12):
    await process_frame
  plan = js("plan(" + JSON.stringify("previous" if allow_original_negative else "current") + ")")
  check(host_errors().is_empty(), "mount/The application starts without a host or runtime error")
  var created_before := int(native(surface).get("creates", 0))
  # A host that stops (a sabotaged wrapper lets a refused prop reach the host, which throws from inside the mount) ends the run:
  # the groups after it cannot settle, and the report says which one did not.
  var aborted := ""
  for group: Dictionary in plan.groups:
    if not await run_group(group):
      aborted = group.id
      break
  for report: Dictionary in group_reports:
    if report.kind == "controls":
      judge_controls(report)
    else:
      judge(report)
  run_js("clear()")
  await settle("clear")
  var cleared := native(surface)
  check(int(cleared.nativeTags) == 1 or int(cleared.nativeTags) == 2, "cleanup/Only the root View stays after every group is removed")
  var application_state := native(application)
  application.call("stop")
  for frame in range(12):
    await process_frame
  var stopped := native(application)
  check(stopped.stopped and int(stopped.rootCount) == 0 and int(stopped.pendingWork) == 0, "cleanup/Stop releases every root")
  var final_root := native(surface)
  check(int(final_root.nativeTags) == 0 and int(final_root.creates) == int(final_root.deletes), "cleanup/All native Controls are balanced")
  surface.queue_free()
  application.queue_free()
  await process_frame
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var observed := failures.duplicate()
  var expected := expected_original_failures.duplicate()
  observed.sort()
  expected.sort()
  var original_negative_observed := allow_original_negative and not failures.is_empty() and observed.all(func(name: String) -> bool: return expected.has(name))
  var report := {"aborted": aborted, "scenario": "native-scope-0.5", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "checks": checks, "plan": plan, "groups": group_reports,
    "waits": waits, "cleared": cleared, "createdBeforeGroups": created_before, "applicationBeforeStop": application_state,
    "afterStop": stopped, "finalRoot": final_root, "expectedOriginalFailures": expected_original_failures,
    "allowOriginalNegative": allow_original_negative, "originalNegativeObserved": original_negative_observed,
    "allCurrentAssertionsPassed": failures.is_empty(),
    "scope": {"actualSceneTreeFrames": true, "publicFacade": true, "originalRnComponents": true, "pixelCapture": false,
      "screenshots": false, "hardwareCertified": false}}
  var output := FileAccess.open("res://build/scope-0.5-report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_CHECK_FAILED: report/The report is saved")
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  print("SCOPE_ORIGINAL_NEGATIVE: " + str(failures.size()) if original_negative_observed else "SCOPE_PASSED: " + str(checks.size()) if failures.is_empty() else "SCOPE_FAILED")
  quit(0 if failures.is_empty() or original_negative_observed else 1)
