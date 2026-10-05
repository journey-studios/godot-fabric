extends Node

var checks: Array = []
var stages: Dictionary = {}
var pixels: Array = []
var surface_b: Control
var reentrant_stops := 0
var reentrant_retirements := 0
var off_tree_callbacks := 0
@onready var application: Node = $Application
@onready var surface_a: Control = $A

func verify(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

func frames(count: int = 6) -> void:
  for index in range(count):
    await get_tree().process_frame

func settle() -> void:
  await frames(4)
  await get_tree().create_timer(0.05).timeout
  await frames(2)

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(" + expression + ")"))

func react() -> Dictionary:
  var value: Variant = js("GodotFocus.snapshot()")
  return value if value is Dictionary else {}

func native_state() -> Dictionary:
  var value: Variant = JSON.parse_string(application.call("snapshot"))
  return value if value is Dictionary else {}

func surface(name: String) -> Control:
  return surface_a if name == "A" else surface_b

func root_state(name: String) -> Dictionary:
  var host := surface(name)
  if host == null:
    return {}
  var value: Variant = JSON.parse_string(host.call("snapshot"))
  return value if value is Dictionary else {}

func control(name: String, id: String) -> Control:
  var host := surface(name)
  return host.find_child(name + "-" + id, true, false) as Control if host != null else null

func input(name: String, id: String) -> LineEdit:
  return control(name, id) as LineEdit

func mount_b() -> void:
  surface_b = ClassDB.instantiate("FabricSurface") as Control
  surface_b.name = "B"
  surface_b.position = Vector2(470, 40)
  surface_b.size = Vector2(390, 580)
  surface_b.set("application_path", NodePath("../Application"))
  surface_b.set("component_name", "FocusPanel")
  surface_b.set("initial_props", {"name": "B"})
  surface_b.set_meta("validation_input_device", 1001)
  add_child(surface_b)

func wait_root(name: String) -> bool:
  var expression := "Boolean(globalThis.GodotFocus && GodotFocus.snapshot().mounts.%s === 1)" % name
  var deadline := Time.get_ticks_msec() + 5000
  while application.call("evaluate", expression) != "true" and Time.get_ticks_msec() < deadline and native_state().get("errors", []).is_empty():
    await frames(1)
  await settle()
  return verify(application.call("evaluate", expression) == "true", "AppRegistry mounts public FocusPanel root " + name)

func probe(stage: String) -> Dictionary:
  var value: Variant = js("GodotFocus.probe(%s)" % JSON.stringify(stage))
  var result: Dictionary = value if value is Dictionary else {}
  verify(not result.get("checks", []).is_empty(), "Original public focus probe completes: " + stage)
  for entry: Dictionary in result.get("checks", []):
    verify(entry.get("passed", false), stage + ": " + entry.get("name", "unnamed"))
  stages[stage] = result
  return result

func action(name: String, operation: String, id: String = "primary") -> void:
  application.call("evaluate", "GodotFocus.action(%s,%s,%s)" % [JSON.stringify(name), JSON.stringify(operation), JSON.stringify(id)])
  await settle()

func retain(name: String, id: String, key: String) -> void:
  application.call("evaluate", "GodotFocus.retain(%s,%s,%s)" % [JSON.stringify(name), JSON.stringify(id), JSON.stringify(key)])

func count_event(name: String, id: String, type: String) -> int:
  var result := 0
  for entry: Dictionary in react().get("events", []):
    if entry.get("name") == name and entry.get("id") == id and entry.get("type") == type:
      result += 1
  return result

func focus_owner(name: String, id: String, stage: String) -> void:
  var target: LineEdit = input(name, id) if not name.is_empty() else null
  var owner := get_viewport().gui_get_focus_owner()
  var state := react()
  var live: Dictionary = state.get("live", {}).get(name, {}).get(id, {}) if not name.is_empty() else {}
  var expected_tag: int = int(live.get("tag", -1)) if target != null else -1
  var current: Dictionary = state.get("focused", {}) if state.get("focused") is Dictionary else {}
  var original: Dictionary = state.get("originalFocused", {}) if state.get("originalFocused") is Dictionary else {}
  var passed := (name.is_empty() or target != null) and owner == target and (target == null or target.has_focus())
  for root_name in ["A", "B"]:
    for field in ["primary", "secondary", "readonly"]:
      var node := input(root_name, field)
      if node != null:
        passed = passed and node.has_focus() == (node == target)
  passed = passed and ((current.is_empty() and original.is_empty()) if target == null else
    int(current.get("tag", -2)) == expected_tag and int(original.get("tag", -3)) == expected_tag and live.get("focused", false))
  verify(passed, stage + ": Viewport owner, every actual LineEdit and original/public State agree")
  stages[stage + "-owner"] = {"expected": name + "-" + id if not name.is_empty() else null,
    "actual": owner.name if owner != null else null, "expectedTag": expected_tag, "react": state}

func native_transfer(name: String, id: String) -> void:
  var target := input(name, id)
  if verify(target != null, "Native transfer target exists: " + name + "-" + id):
    target.grab_focus()
  await settle()

func frames_oracle(stage: String) -> void:
  for name in ["A", "B"]:
    var origin := Vector2(40, 40) if name == "A" else Vector2(470, 40)
    for index in range(3):
      var id: String = ["primary", "secondary", "readonly"][index]
      var target := input(name, id)
      var expected := origin + Vector2(20, 138 + index * 88)
      verify(target != null and target.get_global_transform_with_canvas().origin.distance_to(expected) < 0.1 and
        target.size.distance_to(Vector2(350, 50)) < 0.1, stage + ": Independent declared LineEdit frame " + name + "-" + id)

func capture(stage: String) -> void:
  if not OS.get_cmdline_user_args().has("--capture"):
    return
  print("FOCUS_CAPTURE_BEGIN: " + stage)
  get_window().grab_focus()
  await settle()
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  for name in ["A", "B"]:
    var origin := Vector2(40, 40) if name == "A" else Vector2(470, 40)
    for index in range(3):
      # Sample positions come from declared layout, not measured Controls.
      var logical := origin + Vector2(355, 163 + index * 88)
      var physical: Vector2 = get_window().get_final_transform() * logical
      var point := Vector2i(floori(physical.x), floori(physical.y))
      var in_bounds := point.x >= 0 and point.y >= 0 and point.x < image.get_width() and point.y < image.get_height()
      var actual := image.get_pixelv(point) if in_bounds else Color.TRANSPARENT
      var expected_hex: String = "#46303f" if index == 2 else "#203251"
      var expected := Color(expected_hex)
      var passed := in_bounds and maxf(absf(actual.r - expected.r), maxf(absf(actual.g - expected.g), absf(actual.b - expected.b))) <= 0.025 and actual.a > 0.99
      verify(passed, "Native LineEdit paints its declared background: " + stage + " " + name + " " + str(index))
      pixels.append({"stage": stage, "root": name, "field": index, "point": [point.x, point.y], "expected": expected_hex,
        "actual": [actual.r, actual.g, actual.b, actual.a], "passed": passed})
  verify(image.save_png("res://build/focus-" + stage + ".png") == OK, "Native focus capture saved: " + stage)
  print("FOCUS_CAPTURE_END: " + stage)

func retire_inside_focus() -> void:
  reentrant_retirements += 1
  var survivor := input("B", "secondary")
  if survivor != null:
    survivor.grab_focus()
  application.call("evaluate", "GodotFocus.action('B','stateFocus','secondary')")
  surface_a.call("unmount")
  # This runs while the outer command's ExecutionScope still owns retirement.
  # The public A ref is connected/registered, but its root is already stopping.
  application.call("evaluate", "GodotFocus.action('A','stale','retiring')")
  probe("retiring")
  focus_owner("B", "secondary", "inside-reentrant-retirement")
  verify(native_state().get("pendingRootRetirements", 0) > 0,
    "Stopping root is guarded before deferred retirement completes")

func focus_while_off_tree() -> void:
  off_tree_callbacks += 1
  application.call("evaluate", "GodotFocus.action('A','focus'); GodotFocus.action('A','stateFocus')")
  probe("off-tree")
  focus_owner("B", "secondary", "inside-off-tree-reparenting")

func _ready() -> void:
  if DisplayServer.get_name() == "headless":
    get_window().size = Vector2i(900, 680)
  if not OS.get_cmdline_user_args().has("--validate"):
    mount_b()
    return
  surface_a.set_meta("validation_input_device", 1001)
  if not await wait_root("A"):
    await finish()
    return
  probe("initial-A")
  focus_owner("A", "primary", "callback-ref")
  verify(count_event("A", "primary", "focus") == 1, "Callback ref focus emits one genuine native focus event")
  retain("A", "primary", "original")
  mount_b()
  if not await wait_root("B"):
    await finish()
    return
  verify(native_state().get("rootCount", -1) == 2 and native_state().get("bundleEvaluations", -1) == 1 and
    root_state("A").get("runtimeId", -1) == root_state("B").get("runtimeId", -2), "Two focus roots share one Hermes application and original RN singleton")
  probe("initial-B")
  focus_owner("B", "secondary", "autoFocus")
  verify(count_event("B", "secondary", "focus") == 1 and count_event("A", "primary", "blur") == 1 and count_event("A", "primary", "end") == 1,
    "AutoFocus in a second root transfers actual focus and emits native blur/endEditing")
  frames_oracle("initial")
  await capture("initial")
  await action("A", "focus")
  focus_owner("A", "primary", "public-ref-focus")
  var repeated: int = react().get("events", []).size()
  await action("A", "focus")
  await action("A", "stateFocus")
  await action("A", "commandFocus")
  await action("A", "blur", "secondary")
  await action("A", "stateBlur", "secondary")
  verify(react().get("events", []).size() == repeated, "Repeated focus and blur of an unfocused input produce no extra native editing events")
  focus_owner("A", "primary", "repeat-and-unfocused-blur")
  await native_transfer("B", "primary")
  focus_owner("B", "primary", "native-cross-root-transfer")
  probe("native-transfer")
  await action("A", "stateFocus", "secondary")
  focus_owner("A", "secondary", "public-State-focus")
  await action("A", "stateBlur", "secondary")
  focus_owner("", "", "public-State-blur")
  await action("B", "commandFocus", "secondary")
  focus_owner("B", "secondary", "original-codegen-focus")
  await action("A", "focus", "readonly")
  await action("A", "stateFocus", "readonly")
  await action("A", "commandFocus", "readonly")
  await action("A", "focus", "view")
  await action("A", "blur", "view")
  focus_owner("B", "secondary", "readonly-and-original-View-noop")
  verify(input("A", "readonly") != null and not input("A", "readonly").is_editable(), "Declared editable false reaches the actual native LineEdit")
  await action("A", "lock")
  verify(input("A", "secondary") != null and not input("A", "secondary").is_editable(), "A committed editable update reaches the existing native input")
  await action("A", "focus", "secondary")
  await action("A", "stateFocus", "secondary")
  await action("A", "commandFocus", "secondary")
  focus_owner("B", "secondary", "committed-readonly-noop")
  await action("A", "unlock")
  var native_readonly := input("A", "secondary")
  if verify(native_readonly != null and native_readonly.is_editable(), "Committed editing is restored before testing a native-only update"):
    native_readonly.set_editable(false)
  await action("A", "focus", "secondary")
  await action("A", "stateFocus", "secondary")
  await action("A", "commandFocus", "secondary")
  focus_owner("B", "secondary", "native-readonly-noop")
  verify(application.call("evaluate", "GodotFocus.snapshot().live.A.secondary.effectiveEditable === false && GodotFocus.snapshot().live.A.secondary.nativeEditable === false") == "true",
    "Public input focus capability reflects the actual committed native editability")
  if native_readonly != null:
    native_readonly.set_editable(true)
  await action("A", "focus", "secondary")
  focus_owner("A", "secondary", "committed-editable-restored")
  await action("A", "focus")
  var original := input("A", "primary")
  var original_id: int = original.get_instance_id() if original != null else 0
  var before_churn: int = react().get("events", []).size()
  await action("A", "churn")
  verify(input("A", "primary") != null and input("A", "primary").get_instance_id() == original_id,
    "Callback ref changes preserve the same actual native LineEdit")
  verify(react().get("events", []).size() == before_churn, "Callback ref changes do not emit an artificial blur or focus")
  probe("churned")
  focus_owner("A", "primary", "callback-ref-churn")
  frames_oracle("updated")
  await capture("updated")
  await native_transfer("B", "secondary")
  var before_reparent: int = input("A", "primary").get_parent().get_instance_id() if input("A", "primary") != null else 0
  var reparent_target := input("A", "primary")
  if verify(reparent_target != null and reparent_target.get_parent() != control("A", "panel"),
    "A nativeID wrapper physically hosts the original input before flattening"):
    reparent_target.connect("tree_exited", focus_while_off_tree, CONNECT_ONE_SHOT)
    await action("A", "flatten")
  verify(off_tree_callbacks == 1 and input("A", "primary") != null and input("A", "primary").get_instance_id() == original_id and
    input("A", "primary").get_parent() == control("A", "panel") and input("A", "primary").get_parent().get_instance_id() != before_reparent,
    "Removing nativeID flattens the wrapper, reparents the same LineEdit and exercises one real off-tree callback")
  focus_owner("B", "secondary", "off-tree-reparenting")
  await action("A", "replace")
  verify(input("A", "primary") != null and input("A", "primary").get_instance_id() != original_id,
    "A changed React key creates an independent native replacement")
  probe("replaced")
  var stale_before: int = react().get("events", []).size()
  await action("A", "stale", "original")
  verify(react().get("events", []).size() == stale_before, "Retained replaced refs and original codegen commands are harmless")
  focus_owner("B", "secondary", "replacement-stale-commands")
  retain("A", "secondary", "removed")
  await native_transfer("A", "secondary")
  focus_owner("A", "secondary", "before-focused-removal")
  await action("A", "remove")
  probe("removed")
  verify(input("A", "secondary") == null, "Focused removal deletes the actual native LineEdit")
  focus_owner("", "", "focused-removal")
  await action("A", "stale", "removed")
  focus_owner("", "", "removed-stale-commands")
  await action("B", "stateFocus", "secondary")
  retain("A", "primary", "retiring")
  var retiring_target := input("A", "primary")
  if verify(retiring_target != null and not retiring_target.has_focus(), "Reentrant retirement starts with an unfocused mounted A input"):
    retiring_target.connect("focus_entered", retire_inside_focus, CONNECT_ONE_SHOT)
    await action("A", "focus")
  verify(reentrant_retirements == 1, "A real native focus_entered callback retires its own root once")
  if native_state().get("rootCount", -1) == 2:
    surface_a.call("unmount")
    await settle()
  probe("partial")
  focus_owner("B", "secondary", "partial-root-retirement")
  verify(native_state().get("rootCount", -1) == 1 and not native_state().get("stopped", true) and
    native_state().get("pendingRootRetirements", -1) == 0 and root_state("A").get("nativeTags", -1) == 0 and
    root_state("A").get("creates", -1) == root_state("A").get("deletes", -2) and root_state("B").get("nativeTags", 0) > 0,
    "Retiring root A releases its native Controls and pending retirement while preserving root B")
  await finish(true)

func finish(reentrant: bool = false) -> void:
  var before := {"A": root_state("A"), "B": root_state("B"), "application": native_state()}
  if reentrant:
    var target := input("B", "primary")
    if verify(target != null and not target.has_focus(), "Reentrant shutdown target is a live, unfocused native input"):
      # Real Godot focus_entered inside the original command, not a synthetic
      # ApplicationRuntime.focus event or a timer-delayed stop.
      target.connect("focus_entered", func() -> void:
        reentrant_stops += 1
        application.call("stop"), CONNECT_ONE_SHOT)
      await action("B", "commandFocus", "primary")
    verify(reentrant_stops == 1 and native_state().get("stopped", false), "Native focus_entered can stop the application reentrantly through the original command")
  if not native_state().get("stopped", false):
    application.call("stop")
  await settle()
  if application.call("evaluate", "Boolean(globalThis.GodotFocus)") == "true":
    probe("stopped")
  var stopped := native_state()
  var after := {"A": root_state("A"), "B": root_state("B")}
  for name in ["A", "B"]:
    var state: Dictionary = after[name]
    verify(state.get("nativeTags", -1) == 0 and state.get("creates", -1) == state.get("deletes", -2) and
      state.get("nodes", ["missing"]).is_empty() and state.get("pointer", {}).get("activeTouches", -1) == 0 and
      state.get("pointer", {}).get("responder", -1) == 0, "Final stop retires every native input, tag and responder in root " + name)
  verify(get_viewport().gui_get_focus_owner() == null, "Final application stop releases the actual Viewport focus owner")
  verify(stopped.get("stopped", false) and stopped.get("rootCount", -1) == 0 and stopped.get("errors", []).is_empty() and
    stopped.get("pendingTimers", -1) == 0 and stopped.get("pendingAnimationFrames", -1) == 0 and stopped.get("pendingWork", -1) == 0 and
    stopped.get("pendingRootRetirements", -1) == 0, "Original focus contracts leave no host error or scheduling resources")
  var report := {"scenario": "focus", "godot": Engine.get_version_info().string, "react": "19.2.3", "reactNative": "0.87.1",
    "engine": "hermes", "renderer": "fabric", "displayServer": DisplayServer.get_name(), "checks": checks,
    "stages": stages, "pixels": pixels, "offTreeCallbacks": off_tree_callbacks,
    "reentrantRetirements": reentrant_retirements, "reentrantStops": reentrant_stops,
    "beforeStop": before, "afterStop": after, "applicationStopped": stopped,
    "reactState": react() if application.call("evaluate", "Boolean(globalThis.GodotFocus)") == "true" else {}}
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://build"))
  var output := FileAccess.open("res://build/report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_ERROR: Cannot write public focus report")
    get_tree().quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  print("FABRIC_VALIDATION_FAILED: focus" if failed else "FABRIC_VALIDATION_PASSED: focus " + str(checks.size()))
  get_tree().quit(1 if failed else 0)
