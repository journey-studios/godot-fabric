extends Node

var surface: FabricSurface
var checks: Array = []
var failure := false

func save_report(scenario: String, before_stop: Dictionary, stopped: Dictionary, stopped_react: Dictionary, details: Dictionary = {}) -> void:
  var report := {"scenario": scenario, "godot": Engine.get_version_info().string, "react": "19.2.3", "reactNative": "0.87.1", "hermes": "250829098.0.17", "displayServer": DisplayServer.get_name(), "inputTransport": "viewport-pointer" if scenario in ["counter", "runtime", "pressable", "chart", "scroll", "nativewind", "typography"] else ("viewport-keyboard" if scenario in ["input", "form"] else ("native-signal" if DisplayServer.get_name() == "headless" else "viewport-pointer")), "checks": checks, "beforeStop": before_stop, "afterStop": stopped, "reactState": stopped_react}
  report.merge(details)
  if scenario in ["counter", "runtime", "pressable", "chart", "scroll", "nativewind", "typography"]:
    report["validationInputDevice"] = 1001
    report["osFocusIsolation"] = true
  if scenario == "chart":
    report["chartButtonTransport"] = "native-signal" if DisplayServer.get_name() == "headless" else "viewport-pointer"
  if scenario == "input":
    report["compositionTransport"] = "godot-unicode-input"
  var file := FileAccess.open("res://build/report.json", FileAccess.WRITE)
  if file == null:
    push_error("FABRIC_ERROR: cannot write report.json (" + error_string(FileAccess.get_open_error()) + ")")
    get_tree().quit(1)
    return
  file.store_string(JSON.stringify(report, "  ") + "\n")
  if not failure:
    print("FABRIC_VALIDATION_PASSED: ", scenario, " ", checks.size())
  get_tree().quit(1 if failure else 0)

func frames(count: int) -> void:
  for i in range(count):
    await get_tree().process_frame

func data() -> Dictionary:
  return JSON.parse_string(surface.snapshot())

func react() -> Dictionary:
  return JSON.parse_string(surface.evaluate("JSON.stringify(GodotApp.stats())"))

func node(id: String) -> Dictionary:
  for entry in data().nodes:
    if entry.testID == id:
      return entry
  return {}

func verify(condition: bool, message: String) -> void:
  checks.append({"name": message, "passed": condition})
  if not condition:
    failure = true
    push_error("FABRIC_CHECK_FAILED: " + message)
    print("FAILED_SNAPSHOT: ", surface.snapshot())
    print("FAILED_REACT_STATE: ", surface.evaluate("JSON.stringify(GodotApp.stats())"))
    get_tree().quit(1)

func wait_js(expression: String, minimum_frames: int = 0) -> void:
  await frames(minimum_frames)
  var deadline := Time.get_ticks_msec() + 5000
  while surface.evaluate("Boolean(" + expression + ")") != "true" and Time.get_ticks_msec() < deadline:
    if not data().get("errors", []).is_empty():
      verify(false, "Host/runtime error while waiting for React")
      return
    await frames(1)
  verify(Time.get_ticks_msec() < deadline, "React condition completed: " + expression)

func wait_native(id: String) -> void:
  var deadline := Time.get_ticks_msec() + 5000
  while node(id).is_empty() and Time.get_ticks_msec() < deadline:
    await frames(1)
  verify(not node(id).is_empty(), "Native node committed: " + id)

func click(id: String) -> void:
  var control: Control = surface.find_child(id, true, false)
  # Godot's dummy DisplayServer does not hit-test these mouse events. The
  # headless lane checks Fabric's native signal/event path. The headed lane
  # independently requires actual pointer hit-testing; it never emits a signal.
  if DisplayServer.get_name() == "headless":
    control.emit_signal("pressed")
    await frames(2)
    return
  var position := control.get_global_rect().get_center()
  var motion := InputEventMouseMotion.new()
  motion.position = position
  get_viewport().push_input(motion, true)
  for pressed in [true, false]:
    var event := InputEventMouseButton.new()
    event.position = position
    event.button_index = MOUSE_BUTTON_LEFT
    event.pressed = pressed
    get_viewport().push_input(event, true)
  await frames(2)
