extends SceneTree

# RN's original ActivityIndicator.js over the generated ActivityIndicatorView
# descriptor and a custom-drawn Godot spinner, in two roots of one Hermes
# application. Every phase check spans actual SceneTree frames.
const CASES := ["default", "large", "numeric", "controlled", "removable"]
const FRAMES := 10
const DEFAULT_COLOR := "999999ff"
var application: Node
var surfaces: Dictionary = {}
var checks: Array = []
var stages: Dictionary = {}
var allow_original_negative := false
var expected_original_failures: Array = []

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

func state() -> Dictionary:
  var value: Variant = JSON.parse_string(application.call("evaluate", "JSON.stringify(IndicatorProbe.snapshot())"))
  return value if value is Dictionary else {}

# A JS action without a result; evaluate() would return "undefined".
func run_js(expression: String) -> void:
  application.call("evaluate", "IndicatorProbe." + expression)

func native(target: Object) -> Dictionary:
  var value: Variant = JSON.parse_string(target.call("snapshot"))
  return value if value is Dictionary else {}

func node_of(name: String, case_id: String) -> Dictionary:
  for entry: Dictionary in native(surfaces[name]).get("nodes", []):
    if entry.testID == name + "-" + case_id:
      return entry
  return {}

func indicator(name: String, case_id: String) -> Dictionary:
  return node_of(name, case_id).get("activity", {})

func tag_of(name: String, case_id: String) -> int:
  var entry := node_of(name, case_id)
  return int(entry.tag) if entry.has("tag") else 0

func errors() -> Array:
  return native(application).get("errors", [])

func mount(name: String, position: Vector2) -> void:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = name
  surface.position = position
  surface.size = Vector2(440, 200)
  surface.set("application_path", NodePath("../IndicatorApplication"))
  surface.set("component_name", "IndicatorProbe")
  surface.set("initial_props", {"name": name})
  surfaces[name] = surface
  root.add_child(surface)

# Native spinner state around FRAMES actual SceneTree frames.
func across_frames(name: String, case_id: String) -> Array:
  var before := indicator(name, case_id)
  await settle(FRAMES)
  return [before, indicator(name, case_id)]

func advanced(pair: Array) -> bool:
  var before: Dictionary = pair[0]
  var after: Dictionary = pair[1]
  return (int(after.frames) - int(before.frames) == FRAMES and float(after.turns) > float(before.turns)
    and after.drawn.visible and float(after.drawn.turns) > float(before.turns))

func frozen(pair: Array) -> bool:
  var before: Dictionary = pair[0]
  var after: Dictionary = pair[1]
  return (int(after.frames) == int(before.frames) and float(after.turns) == float(before.turns)
    and not after.processing)

func mount_stage() -> void:
  var counts := {}
  for name: String in ["A", "B"]:
    counts[name] = native(surfaces[name]).get("nodes", []).filter(func(row: Dictionary) -> bool: return row.kind == "activity").size()
  check(counts.A == CASES.size() and counts.B == CASES.size(),
    "mount/Each root mounts one native spinner for each of its five RCTActivityIndicatorView elements", true)
  check(errors().is_empty(), "mount/The application reports no host or runtime error", true)
  stages.mount = {"counts": counts, "application": native(application), "react": state(),
    "roots": {"A": native(surfaces.A), "B": native(surfaces.B)}}

func refs_stage() -> void:
  var value := state()
  var tags_match := true
  for name: String in ["A", "B"]:
    for case_id: String in CASES:
      tags_match = tags_match and int(value.roots[name].tags[case_id]) == tag_of(name, case_id)
  check(tags_match, "refs/Every public ref resolves to the tag of its native spinner")
  stages.refs = {"react": value}

func defaults_stage() -> void:
  var entry := node_of("A", "default")
  var spinner: Dictionary = entry.get("activity", {})
  check(spinner.animating and spinner.hidesWhenStopped and spinner.size == "small" and spinner.processing and spinner.spinnerVisible,
    "defaults/ActivityIndicator.js defaults reach the native spinner: animating, hidesWhenStopped and small")
  check(spinner.color == null and spinner.drawColor == DEFAULT_COLOR and spinner.drawn.color == DEFAULT_COLOR,
    "defaults/Without a color prop the spinner draws RN's iOS gray")
  check(float(entry.fabricWidth) == 20.0 and float(entry.fabricHeight) == 20.0 and float(entry.width) == 20.0 and float(entry.height) == 20.0,
    "defaults/The small size gives the native spinner RN's 20x20 frame")
  check(float(spinner.drawn.width) == 20.0 and float(spinner.drawn.radius) == 10.0 and int(spinner.drawn.spokes) == 8,
    "defaults/The spinner is drawn over the whole Yoga frame")
  stages.defaults = {"node": entry}

func sizes_stage() -> void:
  var large := node_of("A", "large")
  var numeric := node_of("A", "numeric")
  check(float(large.fabricWidth) == 36.0 and float(large.fabricHeight) == 36.0 and large.activity.size == "large" and float(large.activity.drawn.radius) == 18.0,
    "sizes/The large size gives a 36x36 frame and the native large style")
  check(float(numeric.fabricWidth) == 48.0 and float(numeric.fabricHeight) == 48.0 and numeric.activity.size == "small" and float(numeric.activity.drawn.radius) == 24.0,
    "sizes/A numeric size sizes the frame while the native style keeps its small default")
  check(large.activity.drawn.color == "ff3b30ff" and numeric.activity.drawn.color == "ffcc00ff",
    "sizes/Each color prop reaches its native spinner")
  var frames_match := true
  for name: String in ["A", "B"]:
    for case_id: String in CASES:
      var entry := node_of(name, case_id)
      frames_match = frames_match and not entry.is_empty() and float(entry.width) == float(entry.fabricWidth) and float(entry.height) == float(entry.fabricHeight)
  check(frames_match, "sizes/Every native spinner frame equals its Yoga frame")
  stages.sizes = {"large": large, "numeric": numeric}

func spin_stage() -> void:
  var pair := await across_frames("A", "default")
  check(advanced(pair), "spin/The phase advances once per actual SceneTree frame while animating")
  var others: Array = []
  for case_id: String in ["large", "numeric", "controlled", "removable"]:
    others.append(indicator("A", case_id).turns)
  stages.spin = {"pair": pair, "others": others}

func stop_stage() -> void:
  run_js("animate('A',false)")
  await settle()
  var stopped := indicator("A", "controlled")
  check(not stopped.animating and not stopped.processing and int(stopped.stops) == 1 and int(stopped.starts) == 1,
    "stop/animating false stops the spinner and its per-frame work")
  check(not stopped.spinnerVisible and not stopped.drawn.visible,
    "stop/With hidesWhenStopped the stopped spinner is not drawn")
  var controlled := await across_frames("A", "controlled")
  var running := [indicator("A", "default"), null]
  await settle(FRAMES)
  running[1] = indicator("A", "default")
  check(frozen(controlled), "stop/The stopped phase stays frozen across actual frames")
  check(int(running[1].frames) - int(running[0].frames) == FRAMES, "stop/Other spinners keep animating")
  stages.stop = {"stopped": stopped, "controlled": controlled, "running": running}

func static_stage() -> void:
  var frozen_turns := float(indicator("A", "controlled").turns)
  run_js("hides('A',false)")
  await settle()
  var shown := indicator("A", "controlled")
  check(shown.spinnerVisible and shown.drawn.visible and float(shown.drawn.turns) == frozen_turns and not shown.processing,
    "static/Without hidesWhenStopped the stopped spinner is drawn at its frozen phase")
  var pair := await across_frames("A", "controlled")
  check(frozen(pair) and pair[1].drawn.visible, "static/The visible stopped spinner does not advance")
  stages.static = {"frozenTurns": frozen_turns, "shown": shown, "pair": pair}

func restart_stage() -> void:
  var frozen_turns := float(indicator("A", "controlled").turns)
  run_js("animate('A',true)")
  await settle()
  var restarted := indicator("A", "controlled")
  check(restarted.animating and restarted.processing and int(restarted.starts) == 2 and float(restarted.turns) > frozen_turns,
    "restart/animating true resumes the spinner from its frozen phase")
  var pair := await across_frames("A", "controlled")
  check(advanced(pair), "restart/The resumed phase advances once per actual frame")
  stages.restart = {"frozenTurns": frozen_turns, "restarted": restarted, "pair": pair}

func color_stage() -> void:
  run_js("color('A','#34c759')")
  await settle()
  var green := indicator("A", "controlled")
  check(green.color == "34c759ff" and green.drawColor == "34c759ff" and green.drawn.color == "34c759ff",
    "color/A new color prop recolors the native spinner")
  run_js("color('A',null)")
  await settle()
  var reset := indicator("A", "controlled")
  check(reset.color == null and reset.drawColor == DEFAULT_COLOR and reset.drawn.color == DEFAULT_COLOR,
    "color/Removing the color prop restores RN's iOS gray")
  stages.color = {"green": green, "reset": reset}

func remount_stage() -> void:
  var old_tag := tag_of("A", "removable")
  var old := indicator("A", "removable")
  var root_before := native(surfaces.A)
  run_js("remove('A')")
  await settle()
  var removed := native(surfaces.A)
  check(node_of("A", "removable").is_empty() and int(removed.deletes) == int(root_before.deletes) + 1,
    "remount/Removing the spinner deletes its native Control")
  run_js("restore('A')")
  await settle()
  var fresh := indicator("A", "removable")
  check(tag_of("A", "removable") != old_tag and fresh.animating and int(fresh.starts) == 1 and float(fresh.turns) < float(old.turns),
    "remount/A remounted spinner is a new native instance that starts its own phase")
  var pair := await across_frames("A", "removable")
  check(advanced(pair), "remount/The remounted spinner advances once per actual frame")
  stages.remount = {"oldTag": old_tag, "old": old, "deletesBefore": int(root_before.deletes), "removed": removed,
    "fresh": fresh, "pair": pair, "newTag": tag_of("A", "removable")}

func two_roots_stage() -> void:
  var initial: Dictionary = stages.refs.react.roots.B.tags
  var value := state()
  var controlled := indicator("B", "controlled")
  check(controlled.animating and controlled.processing and controlled.color == "0a84ffff" and int(controlled.starts) == 1 and int(controlled.stops) == 0,
    "two-roots/B's controlled spinner keeps its own state")
  check(value.roots.B.tags == initial and value.roots.A.tags.controlled != value.roots.B.tags.controlled,
    "two-roots/B keeps its native instances while A remounts")
  var pair := await across_frames("B", "default")
  check(advanced(pair), "two-roots/B's spinners keep advancing once per actual frame")
  stages.twoRoots = {"react": value, "controlled": controlled, "pair": pair}

func _initialize() -> void:
  allow_original_negative = OS.get_cmdline_user_args().has("--allow-original-negative")
  call_deferred("run_probe")

func run_probe() -> void:
  root.size = Vector2i(900, 220)
  application = ClassDB.instantiate("FabricApplication")
  application.name = "IndicatorApplication"
  application.set("bundle_path", "res://build/activity-indicator.js")
  root.add_child(application)
  mount("A", Vector2(0, 0))
  mount("B", Vector2(450, 0))
  await settle(12)
  mount_stage()
  if not allow_original_negative:
    refs_stage()
    defaults_stage()
    sizes_stage()
    await spin_stage()
    await stop_stage()
    await static_stage()
    await restart_stage()
    await color_stage()
    await remount_stage()
    await two_roots_stage()
    check(errors().is_empty(), "cleanup/No host or runtime diagnostic was reported")
  stages.beforeStop = {"application": native(application), "react": state()}
  application.call("stop")
  await settle()
  var stopped := native(application)
  check(stopped.stopped and int(stopped.rootCount) == 0 and int(stopped.pendingWork) == 0 and int(stopped.pointerRouting.stored) == 0,
    "cleanup/Stop releases every root and route")
  for name: String in ["A", "B"]:
    var final_root := native(surfaces[name])
    check(int(final_root.nativeTags) == 0 and int(final_root.creates) == int(final_root.deletes),
      "cleanup/" + name + "/All native Controls are balanced")
    stages["stoppedRoot" + name] = final_root
    surfaces[name].queue_free()
  application.queue_free()
  await settle()
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var observed := failures.duplicate()
  var expected := expected_original_failures.duplicate()
  observed.sort()
  expected.sort()
  var original_negative_observed := allow_original_negative and observed == expected and not failures.is_empty()
  var report := {"scenario": "native-activity-indicator", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages, "afterStop": stopped,
    "expectedOriginalFailures": expected_original_failures, "frames": FRAMES,
    "allowOriginalNegative": allow_original_negative, "originalNegativeObserved": original_negative_observed,
    "allCurrentAssertionsPassed": failures.is_empty(),
    "scope": {"actualSceneTreeFrames": true, "originalActivityIndicatorJs": true, "generatedDescriptor": true,
      "pixelCapture": false, "accessibility": false, "hardwareCertified": false}}
  var output := FileAccess.open("res://build/activity-indicator-report.json", FileAccess.WRITE)
  if not check(output != null, "report/ActivityIndicator report is saved"):
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  print("ACTIVITY_INDICATOR_ORIGINAL_NEGATIVE: " + str(failures.size()) if original_negative_observed else "ACTIVITY_INDICATOR_PASSED: " + str(checks.size()) if failures.is_empty() else "ACTIVITY_INDICATOR_FAILED")
  quit(0 if failures.is_empty() or original_negative_observed else 1)
