extends Node

var checks: Array = []
var stages: Dictionary = {}
var pixels: Array = []
var child_ids: Dictionary = {}
@onready var application: Node = $Application
@onready var surface_a: Control = $A
@onready var surface_b: Control = $B

func verify(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

func frames(count: int = 6) -> void:
  for index in range(count):
    await get_tree().process_frame

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(" + expression + ")"))

func stats() -> Dictionary:
  var value: Variant = js("GodotTree.stats()")
  return value if value is Dictionary else {}

func native_state() -> Dictionary:
  var value: Variant = JSON.parse_string(application.call("snapshot"))
  return value if value is Dictionary else {}

func surface(name: String) -> Control:
  return surface_a if name == "A" else surface_b

func root_state(name: String) -> Dictionary:
  var value: Variant = JSON.parse_string(surface(name).call("snapshot"))
  return value if value is Dictionary else {}

func node_by_tag(name: String, tag: int) -> Dictionary:
  for entry in root_state(name).get("nodes", []):
    if int(entry.get("tag", -1)) == tag:
      return entry
  return {}

func control(name: String, id: String) -> Control:
  return surface(name).find_child(name + "-" + id, true, false) as Control

func probe(name: String, stage: String) -> Dictionary:
  var expression: String
  if stage == "initial":
    expression = "GodotTree.initial(%s)" % JSON.stringify(name)
  elif stage == "retired":
    expression = "GodotTree.retired(%s)" % JSON.stringify(name)
  else:
    expression = "GodotTree.mutation(%s,%s)" % [JSON.stringify(name), JSON.stringify(stage)]
  var value: Variant = js(expression)
  var result: Dictionary = value if value is Dictionary else {}
  if result.get("checks", []).is_empty():
    verify(false, "Original public tree probe completes: " + name + " " + stage)
  for entry: Dictionary in result.get("checks", []):
    verify(entry.get("passed", false), name + " " + stage + ": " + entry.get("name", "unnamed"))
  stages[name + "-" + stage] = result
  return result

func action(name: String, action_name: String) -> void:
  application.call("evaluate", "GodotTree.action(%s,%s)" % [JSON.stringify(name), JSON.stringify(action_name)])
  await frames()

func native_tree(name: String, stage: String, observed: Dictionary) -> void:
  # Independent layout oracle: panel padding 20; header 34, description 32,
  # button 40 and three gaps of 10 place the item row at local y=156.
  var root_origin := Vector2(40, 40) if name == "A" else Vector2(470, 40)
  var layout: Dictionary = {}
  var layout_passed := true
  for id in ["first", "second"]:
    var slot := 0 if (id == "first") == (stage == "initial") else 1
    var expected := root_origin + Vector2(20 + slot * 155, 156)
    var node := control(name, id)
    var position := node.get_global_transform_with_canvas().origin if node != null else Vector2.INF
    var size := node.size if node != null else Vector2.ZERO
    layout_passed = layout_passed and position.distance_to(expected) < 0.1 and size.distance_to(Vector2(145, 90)) < 0.1
    layout[id] = {"expectedPosition": [expected.x, expected.y], "position": [position.x, position.y],
      "size": [size.x, size.y]}
  verify(layout_passed, name + " " + stage + ": Native item order and frames match independent declared layout")
  stages[name + "-layout-" + stage] = layout
  if stage == "initial":
    var wrapper_tag: int = int(observed.get("wrapperTag", -1))
    verify(wrapper_tag > 0 and node_by_tag(name, wrapper_tag).is_empty() and control(name, "leaf") != null and \
      control(name, "leaf").get_parent() == control(name, "panel"),
      name + ": Logical wrapper has an original public tag and no concrete native Control")
    child_ids[name] = control(name, "identity-child").get_instance_id()
    var identity_tag: int = int(observed.get("identityTag", -1))
    verify(identity_tag > 0 and not node_by_tag(name, identity_tag).is_empty(),
      name + ": Declared nativeID makes its otherwise invisible View concrete")
  elif stage == "updated":
    var identity_tag: int = int(observed.get("identityTag", -1))
    verify(identity_tag > 0 and node_by_tag(name, identity_tag).is_empty() and control(name, "identity-child") != null and \
      control(name, "identity-child").get_instance_id() == child_ids.get(name, 0),
      name + ": Removing nativeID flattens its View and preserves the real child Control")

func capture(stage: String) -> void:
  if not OS.get_cmdline_user_args().has("--capture"):
    return
  print("TREE_CAPTURE_BEGIN: " + stage)
  get_window().grab_focus()
  await frames(2)
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  for name in ["A", "B"]:
    for id in ["first", "second"]:
      # Sample the declared slot, never a point derived from the actual item.
      var root_origin := Vector2(40, 40) if name == "A" else Vector2(470, 40)
      var slot := 0 if (id == "first") == (stage == "initial") else 1
      var logical := root_origin + Vector2(120 + slot * 155, 221)
      var physical: Vector2 = get_window().get_final_transform() * logical
      var point := Vector2i(floori(physical.x), floori(physical.y))
      var in_bounds := point.x >= 0 and point.y >= 0 and point.x < image.get_width() and point.y < image.get_height()
      var actual := image.get_pixelv(point) if in_bounds else Color.TRANSPARENT
      var expected_hex: String = "#0284c7" if id == "first" else "#0f766e"
      var expected := Color(expected_hex)
      var passed := in_bounds and maxf(absf(actual.r - expected.r), maxf(absf(actual.g - expected.g), absf(actual.b - expected.b))) <= 0.02 and actual.a > 0.99
      verify(passed, "Native pixels retain the correct item after public tree updates: " + stage + " " + name + " " + id)
      pixels.append({"stage": stage, "root": name, "id": id, "point": [point.x, point.y], "expected": expected_hex,
        "actual": [actual.r, actual.g, actual.b, actual.a], "passed": passed})
  verify(image.save_png("res://build/tree-" + stage + ".png") == OK, "Native tree capture saved: " + stage)
  print("TREE_CAPTURE_END: " + stage)

func _ready() -> void:
  if DisplayServer.get_name() == "headless":
    get_window().size = Vector2i(900, 680)
  if not OS.get_cmdline_user_args().has("--validate"):
    return
  surface_a.set_meta("validation_input_device", 1001)
  surface_b.set_meta("validation_input_device", 1001)
  await frames(8)
  var deadline := Time.get_ticks_msec() + 5000
  while application.call("evaluate", "Boolean(globalThis.GodotTree && GodotTree.stats().mounts.A === 1 && GodotTree.stats().mounts.B === 1)") != "true" and \
    Time.get_ticks_msec() < deadline and native_state().get("errors", []).is_empty():
    await frames(1)
  if not verify(application.call("evaluate", "Boolean(globalThis.GodotTree && GodotTree.stats().mounts.A === 1 && GodotTree.stats().mounts.B === 1)") == "true",
    "AppRegistry mounts two original public TreePanel roots"):
    await finish()
    return
  verify(native_state().get("rootCount", -1) == 2 and native_state().get("bundleEvaluations", -1) == 1 and \
    root_state("A").get("runtimeId", -1) == root_state("B").get("runtimeId", -2) and \
    root_state("A").get("surfaceId", -1) != root_state("B").get("surfaceId", -1),
    "Two logical documents share one Hermes application and one bundle evaluation")
  for name in ["A", "B"]:
    application.call("evaluate", "GodotTree.retain(%s)" % JSON.stringify(name))
    var observed := probe(name, "initial")
    native_tree(name, "initial", observed)
  var cross: Variant = js("GodotTree.cross()")
  stages["cross-root"] = cross
  if cross is Dictionary:
    for entry: Dictionary in cross.get("checks", []):
      verify(entry.get("passed", false), entry.get("name", "cross-root"))
  else:
    verify(false, "Cross-root original document probe completes")
  await capture("initial")
  await action("A", "duplicate")
  probe("A", "duplicate-initial")
  await action("A", "update")
  native_tree("A", "updated", probe("A", "updated"))
  verify(application.call("evaluate", "GodotTree.stats().states.B.phase === 'initial' && GodotTree.stats().states.B.revision === 0") == "true" and \
    root_state("B").get("errors", []).is_empty(), "Updating root A leaves root B React state and host authority intact")
  await action("B", "update")
  native_tree("B", "updated", probe("B", "updated"))
  await action("A", "duplicate")
  probe("A", "duplicate-updated")
  await capture("updated")
  for name in ["A", "B"]:
    for pair: Array in [["replace", "replaced"], ["remove", "removed"], ["fallback", "fallback"], ["imperative", "imperative"], ["rerender", "rerender"], ["declare", "declared"]]:
      await action(name, pair[0])
      probe(name, pair[1])
  surface_a.call("unmount")
  await frames(8)
  probe("A", "retired")
  var partial := native_state()
  var retired := root_state("A")
  verify(partial.get("rootCount", -1) == 1 and not partial.get("stopped", true) and stats().get("cleanups", {}).get("A", -1) == 1 and \
    stats().get("cleanups", {}).get("B", 0) == 0 and root_state("B").get("nativeTags", 0) > 0,
    "Retiring one document cleans only its React root and preserves the second mounted tree")
  verify(retired.get("nativeTags", -1) == 0 and retired.get("creates", -1) == retired.get("deletes", -2) and \
    retired.get("pointer", {}).get("activeTouches", -1) == 0 and retired.get("pointer", {}).get("responder", -1) == 0,
    "Partial root retirement releases native Controls, tags and responders")
  stages["partial-retirement"] = {"application": partial, "A": retired, "B": root_state("B"), "react": stats()}
  await finish()

func finish() -> void:
  var before := {"A": root_state("A"), "B": root_state("B"), "application": native_state()}
  application.call("stop")
  await frames(8)
  if application.call("evaluate", "Boolean(globalThis.GodotTree)") == "true":
    probe("B", "retired")
  var stopped := native_state()
  var after := {"A": root_state("A"), "B": root_state("B")}
  var observed := stats()
  verify(observed.get("mounts", {}).get("A", -1) == 1 and observed.get("mounts", {}).get("B", -1) == 1 and \
    observed.get("cleanups", {}).get("A", -1) == 1 and observed.get("cleanups", {}).get("B", -1) == 1,
    "Tree mutations retain one mounted React panel and one cleanup per root")
  var rows: Dictionary = observed.get("rows", {})
  var balanced := rows.size() == 6
  for row: Dictionary in rows.values():
    balanced = balanced and row.get("mounts", -1) == 1 and row.get("cleanups", -1) == 1
  verify(balanced, "Key replacement and removal preserve exactly one mount and cleanup per real item component")
  for name in ["A", "B"]:
    var state: Dictionary = after[name]
    verify(state.get("nativeTags", -1) == 0 and state.get("creates", -1) == state.get("deletes", -2) and state.get("nodes", ["missing"]).is_empty() and \
      state.get("pointer", {}).get("activeTouches", -1) == 0 and state.get("pointer", {}).get("responder", -1) == 0,
      "Final stop retires every native Control, node and input authority in root " + name)
  verify(stopped.get("stopped", false) and stopped.get("rootCount", -1) == 0 and stopped.get("errors", []).is_empty() and \
    stopped.get("pendingTimers", -1) == 0 and stopped.get("pendingAnimationFrames", -1) == 0 and stopped.get("pendingWork", -1) == 0 and \
    stopped.get("pendingRootRetirements", -1) == 0, "Original tree navigation and mutation leave no host error or scheduler resources")
  var report := {"scenario": "tree", "godot": Engine.get_version_info().string, "react": "19.2.3", "reactNative": "0.87.1",
    "engine": "hermes", "renderer": "fabric", "displayServer": DisplayServer.get_name(),
    "checks": checks, "stages": stages, "pixels": pixels, "beforeStop": before, "afterStop": after,
    "applicationStopped": stopped, "reactState": observed}
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://build"))
  var output := FileAccess.open("res://build/report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_ERROR: Cannot write original tree report")
    get_tree().quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  print("FABRIC_VALIDATION_FAILED: tree" if failed else "FABRIC_VALIDATION_PASSED: tree " + str(checks.size()))
  get_tree().quit(1 if failed else 0)
