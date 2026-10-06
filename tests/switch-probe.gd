extends SceneTree

# RN's original Switch.js over the native Switch descriptor, driven by actual
# Godot mouse and touch input in two roots of one Hermes application.
const DEVICE := 1001
const SWITCHES := ["controlled", "fixed", "disabled", "colors", "plain", "sized", "removable"]
const RAW_TOUCH := ["topTouchStart", "topTouchMove", "topTouchEnd", "topTouchCancel", "topChange"]
const SETVALUE_ERROR := "setValue requires [boolean]"
var application: Node
var surfaces: Dictionary = {}
var checks: Array = []
var stages: Dictionary = {}
var allow_original_negative := false
var expected_original_failures: Array = []
var expected_errors: Array = []

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
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(SwitchProbe." + expression + ")"))

# A JS action without a result; evaluate() would return "undefined".
func run_js(expression: String) -> void:
  application.call("evaluate", "SwitchProbe." + expression)

func state() -> Dictionary:
  var value: Variant = js("snapshot()")
  return value if value is Dictionary else {}

func native(target: Object) -> Dictionary:
  var value: Variant = JSON.parse_string(target.call("snapshot"))
  return value if value is Dictionary else {}

func node_of(name: String, case_id: String) -> Dictionary:
  for entry: Dictionary in native(surfaces[name]).get("nodes", []):
    if entry.testID == name + "-" + case_id:
      return entry
  return {}

func switch_of(name: String, case_id: String) -> Dictionary:
  return node_of(name, case_id).get("switch", {})

func tag_of(name: String, case_id: String) -> int:
  var entry := node_of(name, case_id)
  return int(entry.tag) if entry.has("tag") else 0

func point(name: String, case_id: String) -> Vector2:
  var control := surfaces[name].find_child(name + "-" + case_id, true, false) as Control
  return control.get_global_rect().get_center() if control != null else Vector2(-1, -1)

func mount(name: String, position: Vector2) -> void:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = name
  surface.position = position
  surface.size = Vector2(360, 300)
  surface.set("application_path", NodePath("../SwitchApplication"))
  surface.set("component_name", "SwitchProbe")
  surface.set("initial_props", {"name": name})
  surfaces[name] = surface
  root.add_child(surface)

# Actual Godot input through Input, the DisplayServer and the Viewport. No
# validation device filter is set: the emulated mouse that Godot derives from
# a touch reaches the GUI too, as in an exported game.
func mouse_move(at: Vector2) -> void:
  var event := InputEventMouseMotion.new()
  event.device = DEVICE
  event.position = at
  event.global_position = at
  Input.parse_input_event(event)
  await settle()

func mouse_button(at: Vector2, pressed: bool) -> void:
  var event := InputEventMouseButton.new()
  event.device = DEVICE
  event.button_index = MOUSE_BUTTON_LEFT
  event.position = at
  event.global_position = at
  event.pressed = pressed
  event.button_mask = MOUSE_BUTTON_MASK_LEFT if pressed else 0
  Input.parse_input_event(event)
  await settle()

func touch(at: Vector2, pressed: bool) -> void:
  var event := InputEventScreenTouch.new()
  event.device = DEVICE
  event.index = 0
  event.position = at
  event.pressed = pressed
  Input.parse_input_event(event)
  await settle()

func press(name: String, case_id: String, device: String) -> void:
  var at := point(name, case_id)
  if device == "mouse":
    await mouse_move(at)
    await mouse_button(at, true)
  else:
    await touch(at, true)

func release(name: String, case_id: String, device: String, at: Vector2 = Vector2(-1, -1)) -> void:
  var where := at if at.x >= 0 else point(name, case_id)
  if device == "mouse":
    await mouse_button(where, false)
  else:
    await touch(where, false)

func raw_rows(value: Dictionary) -> Array:
  return value.log.filter(func(row: Dictionary) -> bool: return row.label == "raw" and row.type in RAW_TOUCH)

func handler_rows(value: Dictionary) -> Array:
  return value.log.filter(func(row: Dictionary) -> bool: return row.label != "raw")

func other(name: String) -> String:
  return "B" if name == "A" else "A"

# The value-bearing part of a native Switch snapshot (draw counters excluded).
func essence(value: Dictionary) -> Dictionary:
  return {"value": value.get("value"), "toggles": value.get("toggles"), "commands": value.get("commands"),
    "transitions": value.get("transitions")}

func arm(prefix: String) -> void:
  run_js("arm(%s)" % JSON.stringify(prefix))

func errors() -> Array:
  return native(application).get("errors", [])

# One tap on a Switch whose native value changes. RN receives TouchStart,
# TouchEnd and then one Change; capture, Switch.js's handleChange (onChange,
# then onValueChange) and bubble follow. A Switch whose value prop does not
# follow is restored by exactly one setValue command.
func toggle_stage(prefix: String, name: String, case_id: String, device: String, expected: bool,
    value_handler: bool, reverted: bool, mid_press: bool = false) -> void:
  arm(prefix)
  var before := switch_of(name, case_id)
  var other_before := switch_of(other(name), case_id)
  var tag := tag_of(name, case_id)
  var cell := tag_of(name, case_id + "-cell")
  await press(name, case_id, device)
  var pressed := switch_of(name, case_id)
  var pressed_pointer: Dictionary = native(surfaces[name]).pointer
  if mid_press:
    check(pressed.pressing == device and int(pressed_pointer.responder) == tag and not pressed_pointer.blockNative,
      prefix + "/During the press the Switch is RN's JS responder and the native GUI press is not blocked")
  await release(name, case_id, device)
  await settle()
  var value := state()
  var after := switch_of(name, case_id)
  var pointer: Dictionary = native(surfaces[name]).pointer
  var raw := raw_rows(value)
  check(raw.map(func(row: Dictionary) -> Array: return [row.type, int(row.nativeTarget)]) == [["topTouchStart", tag], ["topTouchEnd", tag], ["topChange", tag]],
    prefix + "/RN receives TouchStart, TouchEnd and then one Change targeting the Switch")
  check(raw.size() == 3 and raw[2].value == expected, prefix + "/The Change payload carries the new native value")
  var rows := handler_rows(value)
  var labels: Array = ["parent-capture", "switch-change"] + (["value-change"] if value_handler else []) + ["parent-bubble"]
  var rows_match := rows.all(func(row: Dictionary) -> bool: return (row.root == name and row.caseId == case_id and row.value == expected))
  check(rows.map(func(row: Dictionary) -> String: return row.label) == labels and rows_match,
    prefix + "/Capture, onChange, onValueChange and bubble run once in RN order")
  var changes: Array = rows.filter(func(row: Dictionary) -> bool: return row.label == "switch-change")
  check(changes.size() == 1 and int(changes[0].nativeTarget) == tag and changes[0].keys == ["target", "timeStamp", "value"] and changes[0].targetIsSwitch and changes[0].currentIsSwitch,
    prefix + "/onChange receives {target, value} with the Switch tag as target and RN's timeStamp")
  var parents: Array = rows.filter(func(row: Dictionary) -> bool: return row.label.begins_with("parent-"))
  check(parents.size() == 2 and parents.all(func(row: Dictionary) -> bool: return int(row.currentTag) == cell and int(row.nativeTarget) == tag),
    prefix + "/The bubbling Change reaches the parent View in both phases")
  var transitions: Array = after.transitions.slice(before.transitions.size())
  var expected_transitions: Array = [{"value": expected, "cause": "input"}]
  if reverted:
    expected_transitions.append({"value": not expected, "cause": "command"})
  check(int(after.toggles) == int(before.toggles) + 1 and transitions == expected_transitions,
    prefix + "/The native Switch toggles once from the " + device)
  if reverted:
    check(int(after.commands) == int(before.commands) + 1 and after.value == (not expected),
      prefix + "/Switch.js restores the unchanged value prop with exactly one setValue command")
  else:
    check(int(after.commands) == int(before.commands) and after.value == expected,
      prefix + "/A value prop that follows onValueChange needs no setValue command")
  if device == "touch":
    check(int(after.ignoredEmulated) == int(before.ignoredEmulated) + 2,
      prefix + "/Godot's emulated mouse press and release reach the Switch and are ignored")
  check(after.pressing == "none" and int(pointer.responder) == 0 and int(pointer.activeTouches) == 0,
    prefix + "/Release clears the native press, the responder and the contact")
  check(essence(switch_of(other(name), case_id)) == essence(other_before) and value.log.all(func(row: Dictionary) -> bool: return not row.has("root") or row.root == name),
    prefix + "/The other root observes nothing")
  stages[prefix] = {"react": value, "before": before, "pressed": pressed, "pressedPointer": pressed_pointer,
    "after": after, "pointer": pointer, "tag": tag, "cellTag": cell, "otherBefore": other_before,
    "otherAfter": switch_of(other(name), case_id), "device": device, "expected": expected,
    "valueHandler": value_handler, "reverted": reverted, "root": name, "caseId": case_id}

func mount_stage() -> void:
  var value := state()
  var counts := {}
  for name: String in ["A", "B"]:
    counts[name] = native(surfaces[name]).get("nodes", []).filter(func(row: Dictionary) -> bool: return row.kind == "switch").size()
  check(counts.A == SWITCHES.size() and counts.B == SWITCHES.size(),
    "mount/Each root mounts one native Switch for each of its seven RCTSwitch elements", true)
  check(errors().is_empty(), "mount/The application reports no host or runtime error", true)
  stages.mount = {"react": value, "counts": counts, "application": native(application),
    "roots": {"A": native(surfaces.A), "B": native(surfaces.B)}}

func registry_stage() -> void:
  var value := state()
  check(value.registry.bubbling == {"bubbled": "onChange", "captured": "onChangeCapture"},
    "registry/The generated Switch ViewConfig registers topChange as RN's bubbling onChange")
  check(value.registry.direct == {"registrationName": "onChange"},
    "registry/The GodotControl direct topChange registration remains in the registry")
  check(value.roots.A.hasSetNativeProps and value.roots.B.hasSetNativeProps,
    "registry/Public Switch refs are RN host instances, so Switch.js sends setValue")
  var tags_match := true
  for name: String in ["A", "B"]:
    for case_id: String in SWITCHES:
      tags_match = tags_match and int(value.roots[name].tags[case_id]) == tag_of(name, case_id)
  check(tags_match, "registry/Every public ref resolves to the tag of its native Switch")
  stages.registry = {"react": value}

func layout_stage() -> void:
  var plain := node_of("A", "plain")
  var cell := node_of("A", "plain-cell")
  var sized := node_of("A", "sized")
  check(float(plain.fabricWidth) == 63.0 and float(plain.fabricHeight) == 28.0 and float(plain.width) == 63.0 and float(plain.height) == 28.0,
    "layout/A Switch without size occupies RN's iOS 26 frame of 63x28 natively")
  check(float(cell.fabricWidth) == 166.0 and float(plain.fabricX) == float(cell.fabricX) + 6.0,
    "layout/Switch.js's alignSelf flex-start keeps it at its measured width in a stretching column")
  check(float(sized.fabricWidth) == 80.0 and float(sized.fabricHeight) == 40.0 and float(sized.width) == 80.0 and float(sized.height) == 40.0,
    "layout/An explicit style size replaces the measured size")
  check(float(plain.switch.drawn.width) == 63.0 and float(plain.switch.drawn.height) == 28.0 and float(sized.switch.drawn.width) == 80.0 and float(sized.switch.drawn.height) == 40.0,
    "layout/The track is drawn over the whole Yoga frame")
  var frames_match := true
  for name: String in ["A", "B"]:
    for case_id: String in SWITCHES:
      var entry := node_of(name, case_id)
      frames_match = frames_match and not entry.is_empty() and float(entry.width) == float(entry.fabricWidth) and float(entry.height) == float(entry.fabricHeight)
  check(frames_match, "layout/Every native Switch frame equals its Yoga frame")
  stages.layout = {"plain": plain, "cell": cell, "sized": sized}

func disabled_stage(prefix: String, device: String) -> void:
  arm(prefix)
  var before := switch_of("A", "disabled")
  var tag := tag_of("A", "disabled")
  await press("A", "disabled", device)
  await release("A", "disabled", device)
  await settle()
  var value := state()
  var after := switch_of("A", "disabled")
  var raw := raw_rows(value)
  check(raw.map(func(row: Dictionary) -> Array: return [row.type, int(row.nativeTarget)]) == [["topTouchStart", tag], ["topTouchEnd", tag]],
    prefix + "/RN still receives the touch but no Change")
  check(handler_rows(value).is_empty(), prefix + "/No onChange, onValueChange or parent handler runs")
  check(after.disabled and not after.value and int(after.toggles) == int(before.toggles) and after.transitions == before.transitions and after.pressing == "none",
    prefix + "/The disabled native Switch neither presses nor toggles")
  stages[prefix] = {"react": value, "before": before, "after": after, "tag": tag, "device": device}

func colors_stage() -> void:
  var initial := node_of("A", "colors")
  var off: Dictionary = initial.switch
  check(off.tintColor == "ff3b30ff" and off.onTintColor == "5856d6ff" and off.thumbTintColor == "ffcc00ff",
    "colors/trackColor and thumbColor reach the native tintColor, onTintColor and thumbTintColor")
  check(off.trackColor == "ff3b30ff" and off.thumbColor == "ffcc00ff" and off.drawn.track == "ff3b30ff" and off.drawn.thumb == "ffcc00ff",
    "colors/The off Switch draws trackColor.false and thumbColor")
  # RN resolves Switch.js's borderRadius 16 to half of the 28-point height.
  check(initial.appearance.background == "1c1c1eff" and initial.appearance.cornerRadii == [14.0, 14.0, 14.0, 14.0],
    "colors/ios_backgroundColor paints the host background with Switch.js's radius 16 as RN resolves it")
  await toggle_stage("colors/toggle", "A", "colors", "mouse", true, true, false)
  var on := switch_of("A", "colors")
  check(on.trackColor == "5856d6ff" and on.drawn.track == "5856d6ff" and on.drawn.thumb == "ffcc00ff" and float(on.drawn.thumbX) == 63.0 - 14.0,
    "colors/The on Switch draws trackColor.true with the thumb at the trailing end")
  run_js("palette('A','second')")
  await settle()
  var second := node_of("A", "colors")
  check(second.switch.tintColor == "8e8e93ff" and second.switch.onTintColor == "30b0c7ff" and second.switch.thumbTintColor == "007affff" and second.switch.drawn.track == "30b0c7ff" and second.switch.drawn.thumb == "007affff" and second.appearance.background == "3a3a3cff",
    "colors/New color props update the native Switch and host background")
  run_js("palette('A','none')")
  await settle()
  var defaults := node_of("A", "colors")
  check(defaults.switch.tintColor == null and defaults.switch.onTintColor == null and defaults.switch.thumbTintColor == null and defaults.switch.drawn.track == "34c759ff" and defaults.switch.drawn.thumb == "ffffffff" and defaults.appearance.background == "00000000" and defaults.appearance.cornerRadii == [0.0, 0.0, 0.0, 0.0],
    "colors/Removing the color props restores the defaults and drops the host background")
  var plain := switch_of("A", "plain")
  check(plain.drawn.track == "e9e9eaff" and plain.drawn.thumb == "ffffffff",
    "colors/A Switch without colors draws the default off track and thumb")
  stages.colors = {"initial": initial, "on": on, "second": second, "defaults": defaults, "plain": plain}

func command_stage() -> void:
  var prefix := "commands"
  arm(prefix)
  var before := switch_of("A", "sized")
  run_js("setValue('A','sized',false)")
  await settle()
  var off := switch_of("A", "sized")
  run_js("setValue('A','sized',true)")
  await settle()
  var on := switch_of("A", "sized")
  check(off.value == false and on.value == true and int(on.commands) == int(before.commands) + 2 and on.transitions.slice(before.transitions.size()) == [{"value": false, "cause": "command"}, {"value": true, "cause": "command"}],
    prefix + "/RN's generated setValue command sets the native value both ways")
  for args: String in ["[]", "[1]"]:
    run_js("rawCommand('A','sized',%s)" % args)
    expected_errors.append(SETVALUE_ERROR)
  await settle()
  var value := state()
  var after := switch_of("A", "sized")
  check(after.value == true and int(after.commands) == int(on.commands) and after.transitions == on.transitions,
    prefix + "/Malformed setValue arguments are rejected without changing the native value")
  check(raw_rows(value).is_empty() and handler_rows(value).is_empty(), prefix + "/Commands never emit onChange")
  check(errors() == expected_errors, prefix + "/Each malformed command reports exactly one setValue diagnostic")
  stages[prefix] = {"react": value, "before": before, "off": off, "on": on, "after": after, "errors": errors()}

func removal_stage() -> void:
  var prefix := "removal"
  arm(prefix)
  var tag := tag_of("A", "removable")
  var at := point("A", "removable")
  var root_before := native(surfaces.A)
  var others_before := {}
  for case_id: String in SWITCHES:
    others_before[case_id] = switch_of("A", case_id).get("toggles", 0)
  await press("A", "removable", "mouse")
  var pressed := switch_of("A", "removable")
  var pressed_pointer: Dictionary = native(surfaces.A).pointer
  check(pressed.pressing == "mouse" and int(pressed_pointer.responder) == tag,
    prefix + "/The pressed Switch holds the responder before React removes it")
  run_js("remove('A')")
  await settle()
  var removed := native(surfaces.A)
  check(node_of("A", "removable").is_empty() and int(removed.deletes) == int(root_before.deletes) + 1 and int(removed.pointer.responder) == 0,
    prefix + "/Removing the pressed Switch deletes its Control and releases the responder")
  await release("A", "removable", "mouse", at)
  await settle()
  var value := state()
  var toggled := false
  for case_id: String in SWITCHES:
    if case_id != "removable":
      toggled = toggled or int(switch_of("A", case_id).toggles) != int(others_before[case_id])
  check(not toggled and not raw_rows(value).any(func(row: Dictionary) -> bool: return row.type == "topChange") and handler_rows(value).is_empty(),
    prefix + "/The release after removal toggles nothing and emits no Change")
  var stale: Dictionary = js("staleSetValue('A',true)")
  await settle()
  check(not stale.connected and int(stale.tag) == tag and errors() == expected_errors and handler_rows(state()).is_empty(),
    prefix + "/setValue through the removed Switch's ref is ignored without a diagnostic")
  run_js("restore('A')")
  await settle()
  var restored := node_of("A", "removable")
  check(not restored.is_empty() and int(restored.tag) != tag and restored.switch.value == false and restored.switch.transitions == [{"value": false, "cause": "props"}],
    prefix + "/A remounted Switch is a new native instance with its initial value")
  stages[prefix] = {"react": value, "tag": tag, "pressed": pressed, "pressedPointer": pressed_pointer,
    "removed": removed, "stale": stale, "restored": restored}

func input_stage() -> void:
  var prefix := "input"
  arm(prefix)
  run_js("focusInput('A')")
  await settle()
  for pressed: bool in [true, false]:
    var event := InputEventKey.new()
    event.device = DEVICE
    event.keycode = KEY_X
    event.unicode = "x".unicode_at(0)
    event.pressed = pressed
    Input.parse_input_event(event)
  await settle()
  var value := state()
  var rows := handler_rows(value)
  var input_tag := tag_of("A", "input")
  check(rows.map(func(row: Dictionary) -> Array: return [row.label, row.text]) == [["parent-capture", "x"], ["input-change", "x"], ["parent-bubble", "x"]],
    prefix + "/With topChange bubbling, a TextInput change runs its onChange once between the parent's capture and bubble")
  check(rows.size() == 3 and int(rows[1].currentTag) == input_tag and rows[0].currentTag == rows[2].currentTag and int(rows[0].currentTag) == tag_of("A", "input-cell"),
    prefix + "/The TextInput and its parent each receive the change as current target")
  stages[prefix] = {"react": value, "inputTag": input_tag}

func _initialize() -> void:
  allow_original_negative = OS.get_cmdline_user_args().has("--allow-original-negative")
  call_deferred("run_probe")

func run_probe() -> void:
  root.size = Vector2i(760, 320)
  application = ClassDB.instantiate("FabricApplication")
  application.name = "SwitchApplication"
  application.set("bundle_path", "res://build/switch.js")
  root.add_child(application)
  mount("A", Vector2(0, 0))
  mount("B", Vector2(380, 0))
  await settle(12)
  mount_stage()
  if not allow_original_negative:
    registry_stage()
    layout_stage()
    await toggle_stage("controlled/mouse", "A", "controlled", "mouse", true, true, false, true)
    await toggle_stage("controlled/touch", "A", "controlled", "touch", false, true, false, true)
    await toggle_stage("fixed/mouse", "A", "fixed", "mouse", true, true, true)
    await toggle_stage("fixed/touch", "A", "fixed", "touch", true, true, true)
    await toggle_stage("plain/mouse", "A", "plain", "mouse", true, false, true)
    await disabled_stage("disabled/mouse", "mouse")
    await disabled_stage("disabled/touch", "touch")
    await colors_stage()
    await command_stage()
    await removal_stage()
    await toggle_stage("two-roots/B", "B", "controlled", "mouse", true, true, false)
    var roots: Dictionary = state().roots
    check(roots.A.on == false and roots.B.on == true and int(roots.A.tags.controlled) != int(roots.B.tags.controlled),
      "two-roots/Each root keeps its own Switch state and tag")
    await input_stage()
    check(errors() == expected_errors, "cleanup/No host or runtime diagnostic beyond the malformed commands")
  stages.beforeStop = {"application": native(application), "react": state()}
  application.call("stop")
  await settle()
  var stopped := native(application)
  check(stopped.stopped and int(stopped.rootCount) == 0 and int(stopped.pendingWork) == 0 and int(stopped.pointerRouting.stored) == 0 and int(stopped.pointerProcessor.active) == 0,
    "cleanup/Stop releases every root, route and active pointer")
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
  var report := {"scenario": "native-switch", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages, "afterStop": stopped,
    "expectedOriginalFailures": expected_original_failures, "expectedErrors": expected_errors,
    "allowOriginalNegative": allow_original_negative, "originalNegativeObserved": original_negative_observed,
    "allCurrentAssertionsPassed": failures.is_empty(),
    "emulateMouseFromTouch": ProjectSettings.get_setting("input_devices/pointing/emulate_mouse_from_touch"),
    "scope": {"actualNativeInput": true, "mouse": true, "touch": true, "keyboardActivation": false,
      "originalSwitchJs": true, "generatedViewConfig": true, "rnSwitchDescriptor": true, "hardwareCertified": false,
      "accessibility": false, "animation": false}}
  var output := FileAccess.open("res://build/switch-report.json", FileAccess.WRITE)
  if not check(output != null, "report/Switch report is saved"):
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  print("SWITCH_ORIGINAL_NEGATIVE: " + str(failures.size()) if original_negative_observed else "SWITCH_PASSED: " + str(checks.size()) if failures.is_empty() else "SWITCH_FAILED")
  quit(0 if failures.is_empty() or original_negative_observed else 1)
