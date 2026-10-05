extends SceneTree

# RN's PanResponder over the original responder system, driven by actual Godot
# touches and mouse buttons. The responder grants a requester before asking the
# current responder to yield, so a refused claim still sees its grant and then
# its reject. Gesture state follows RN's accumulation: dx/dy add the centroid
# change of the touches that moved, x0/y0 is the centroid at grant, and
# numberActiveTouches comes from the touch history at start and end. With more
# than one active touch, TouchHistoryMath counts every touch that changed at or
# after the accounted time, so a two-finger move uses the centroid of both.
const DEVICE := 1001
var application: Node
var surfaces: Dictionary = {}
var checks: Array = []
var stages: Dictionary = {}
var flag_mode := "enabled"
var allow_previous_sdk := false
var mask := 0

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

func settle() -> void:
  for index in range(8):
    await process_frame

func native(owner: Node) -> Dictionary:
  var value: Variant = JSON.parse_string(owner.call("snapshot"))
  return value if value is Dictionary else {}

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(PanResponderProbe." + expression + ")"))

func state() -> Dictionary:
  var value: Variant = js("snapshot()")
  return value if value is Dictionary else {}

func mount(name: String, position: Vector2) -> void:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = name
  surface.position = position
  surface.size = Vector2(300, 200)
  surface.set("application_path", NodePath("../PanResponderApplication"))
  surface.set("component_name", "PanResponderProbe")
  surface.set("initial_props", {"name": name})
  surface.set_meta("validation_input_device", DEVICE)
  surfaces[name] = surface
  root.add_child(surface)

func touch(name: String, point: Vector2, index: int, pressed: bool) -> void:
  var event := InputEventScreenTouch.new()
  event.device = DEVICE
  event.index = index
  event.position = surfaces[name].position + point
  event.pressed = pressed
  Input.parse_input_event(event)
  await settle()

func drag(name: String, point: Vector2, index: int) -> void:
  var event := InputEventScreenDrag.new()
  event.device = DEVICE
  event.index = index
  event.position = surfaces[name].position + point
  Input.parse_input_event(event)
  await settle()

func mouse_move(name: String, point: Vector2) -> void:
  var event := InputEventMouseMotion.new()
  event.device = DEVICE
  event.position = surfaces[name].position + point
  event.button_mask = mask
  Input.parse_input_event(event)
  await settle()

func mouse_button(name: String, point: Vector2, pressed: bool) -> void:
  mask = MOUSE_BUTTON_MASK_LEFT if pressed else 0
  var event := InputEventMouseButton.new()
  event.device = DEVICE
  event.position = surfaces[name].position + point
  event.button_index = MOUSE_BUTTON_LEFT
  event.pressed = pressed
  event.button_mask = mask
  Input.parse_input_event(event)
  await settle()

func perform(name: String, action: Array) -> void:
  match action[0]:
    "down": await touch(name, action[1], action[2] if action.size() > 2 else 0, true)
    "up": await touch(name, action[1], action[2] if action.size() > 2 else 0, false)
    "drag": await drag(name, action[1], action[2] if action.size() > 2 else 0)
    "hover": await mouse_move(name, action[1])
    "press": await mouse_button(name, action[1], true)
    "release": await mouse_button(name, action[1], false)
    "move": await mouse_move(name, action[1])
    "remove":
      js("removeTarget(%s)" % JSON.stringify(name))
      await settle()
    # Pressability defers onPressOut until a press lasted 130 ms.
    "wait": await create_timer(float(action[1]) / 1000.0).timeout

# A sequence entry is [view, callback, fields]: only the named fields are
# compared, as numbers (JSON numbers are floats).
func matches(row: Dictionary, entry: Array) -> bool:
  if row.view != entry[0] or row.callback != entry[1]:
    return false
  var fields: Dictionary = entry[2] if entry.size() > 2 else {}
  for key: String in fields:
    if row.get(key) == null or not is_equal_approx(float(row[key]), float(fields[key])):
      return false
  return true

# Velocity follows the move direction: never against it and finite.
func velocity_follows(row: Dictionary) -> bool:
  return (row.vx != null and row.vy != null and float(row.vx) * float(row.dx) >= 0 and float(row.vy) * float(row.dy) >= 0)

func run_case(spec: Dictionary) -> void:
  var name: String = spec.get("panel", "A")
  var prefix: String = spec.id
  print("PAN_RESPONDER_STEP: " + prefix)
  js("arm(%s,%s)" % [JSON.stringify(name), JSON.stringify(prefix)])
  for action: Array in spec.actions:
    await perform(name, action)
  var value := state()
  var app := native(application)
  stages[prefix] = {"react": value, "application": app, "surface": native(surfaces[name])}
  var expected: Array = spec.expected
  var events: Array = value.events
  var sequence_ok := events.size() == expected.size()
  for index in range(min(events.size(), expected.size())):
    sequence_ok = sequence_ok and matches(events[index], expected[index])
  check(sequence_ok and events.all(func(row: Dictionary) -> bool: return row.name == name),
    prefix + "/The original PanResponder delivers exactly RN's callbacks and gesture state")
  var moves: Array = events.filter(func(row: Dictionary) -> bool: return row.callback == "move")
  check(moves.all(func(row: Dictionary) -> bool: return velocity_follows(row) and row.touchHistory),
    prefix + "/Every move carries the original touch history and a velocity that follows it")
  check(int(native(surfaces[name]).pointer.activeTouches) == 0 and int(app.pointerRouting.active) == 0 and
      int(app.pointerProcessor.active) == 0,
    prefix + "/The gesture ends without a retained touch, contact or pointer")

func cases() -> Array:
  var P := Vector2(40, 40)
  return [
    {"id": "touch/drag", "actions": [["down", P], ["drag", Vector2(60, 50)], ["drag", Vector2(80, 70)], ["up", Vector2(80, 70)]],
      "expected": [["P", "grant", {"x0": 40, "y0": 40, "dx": 0, "dy": 0, "numberActiveTouches": 1}],
        ["P", "start", {"numberActiveTouches": 1}],
        ["P", "move", {"dx": 20, "dy": 10, "moveX": 60, "moveY": 50, "numberActiveTouches": 1}],
        ["P", "move", {"dx": 40, "dy": 30, "moveX": 80, "moveY": 70}],
        ["P", "end", {"numberActiveTouches": 0, "dx": 40, "dy": 30}],
        ["P", "release", {"dx": 40, "dy": 30, "x0": 40, "y0": 40, "numberActiveTouches": 0}]]},
    {"id": "mouse/drag", "actions": [["hover", P], ["press", P], ["move", Vector2(60, 50)], ["move", Vector2(80, 70)], ["release", Vector2(80, 70)]],
      "expected": [["P", "grant", {"x0": 40, "y0": 40, "dx": 0, "dy": 0}],
        ["P", "start", {"numberActiveTouches": 1}],
        ["P", "move", {"dx": 20, "dy": 10, "moveX": 60, "moveY": 50}],
        ["P", "move", {"dx": 40, "dy": 30, "moveX": 80, "moveY": 70}],
        ["P", "end", {"numberActiveTouches": 0}],
        ["P", "release", {"dx": 40, "dy": 30}]]},
    # The first move counts both touches from their starts (centroid 60,30 to
    # 60,40); the second counts both again, the second one changed at the
    # accounted time (centroid 60,30 to 60,50 from their previous positions).
    {"id": "touch/two-fingers", "actions": [["down", Vector2(30, 30), 0], ["down", Vector2(90, 30), 1], ["drag", Vector2(90, 50), 1],
        ["drag", Vector2(30, 50), 0], ["up", Vector2(90, 50), 1], ["up", Vector2(30, 50), 0]],
      "expected": [["P", "grant", {"x0": 30, "y0": 30, "numberActiveTouches": 1}],
        ["P", "start", {"numberActiveTouches": 1}],
        ["P", "start", {"numberActiveTouches": 2}],
        ["P", "move", {"dx": 0, "dy": 10, "moveX": 60, "moveY": 40, "numberActiveTouches": 2}],
        ["P", "move", {"dx": 0, "dy": 30, "moveX": 60, "moveY": 50, "numberActiveTouches": 2}],
        ["P", "end", {"numberActiveTouches": 1}],
        ["P", "end", {"numberActiveTouches": 0}],
        ["P", "release", {"dx": 0, "dy": 30}]]},
    # Pressability deactivates (pressOut) before it presses on release.
    {"id": "touch/tap-pressable", "actions": [["down", Vector2(185, 35)], ["wait", 200], ["up", Vector2(185, 35)]],
      "expected": [["K", "pressIn"], ["K", "pressOut"], ["K", "press"]]},
    # Q claims in its capture phase once |dy| passes 10; the Pressable yields.
    {"id": "touch/claim", "actions": [["down", Vector2(185, 35)], ["wait", 200], ["drag", Vector2(185, 40)], ["drag", Vector2(185, 55)],
        ["drag", Vector2(185, 70)], ["up", Vector2(185, 70)]],
      "expected": [["K", "pressIn"], ["Q", "grant", {"x0": 185, "y0": 55, "dx": 0, "dy": 0}], ["K", "pressOut"],
        ["Q", "move", {"dx": 0, "dy": 15, "moveY": 70}], ["Q", "end", {"numberActiveTouches": 0}], ["Q", "release", {"dy": 15}]]},
    # R refuses: Q sees its speculative grant, then its reject; R keeps moving.
    {"id": "touch/refuse", "actions": [["down", Vector2(250, 35)], ["drag", Vector2(250, 55)], ["up", Vector2(250, 55)]],
      "expected": [["R", "grant", {"x0": 250, "y0": 35}], ["R", "start", {"numberActiveTouches": 1}],
        ["Q", "grant", {"x0": 250, "y0": 55, "dx": 0, "dy": 0}], ["Q", "reject"],
        ["R", "move", {"dx": 0, "dy": 20, "moveY": 55}], ["R", "end", {"numberActiveTouches": 0}], ["R", "release", {"dy": 20}]]},
    {"id": "touch/capture", "actions": [["down", Vector2(45, 140)], ["drag", Vector2(55, 150)], ["up", Vector2(55, 150)]],
      "expected": [["T", "grant", {"x0": 45, "y0": 140}], ["T", "start", {"numberActiveTouches": 1}],
        ["T", "move", {"dx": 10, "dy": 10}], ["T", "end", {"numberActiveTouches": 0}], ["T", "release", {"dx": 10, "dy": 10}]]},
    # Removing the responder's View mid-gesture: the host cancels the contact,
    # the unmounted responder receives no further callback (RN cannot deliver
    # to an unmounted instance either), the release is inert, and the next
    # gesture is granted normally because nothing stays stuck.
    {"id": "touch/remove", "actions": [["down", Vector2(180, 140)], ["drag", Vector2(190, 150)], ["remove"], ["up", Vector2(190, 150)],
        ["down", Vector2(40, 40)], ["up", Vector2(40, 40)]],
      "expected": [["M", "grant", {"x0": 180, "y0": 140}], ["M", "start", {"numberActiveTouches": 1}],
        ["M", "move", {"dx": 10, "dy": 10}], ["P", "grant", {"x0": 40, "y0": 40}], ["P", "start", {"numberActiveTouches": 1}],
        ["P", "end", {"numberActiveTouches": 0}], ["P", "release", {"dx": 0, "dy": 0}]]},
    {"id": "B/touch/drag", "panel": "B", "actions": [["down", P], ["drag", Vector2(70, 40)], ["up", Vector2(70, 40)]],
      "expected": [["P", "grant", {"x0": 40, "y0": 40}], ["P", "start", {"numberActiveTouches": 1}],
        ["P", "move", {"dx": 30, "dy": 0}], ["P", "end", {"numberActiveTouches": 0}], ["P", "release", {"dx": 30, "dy": 0}]]},
  ]

func _initialize() -> void:
  var args := OS.get_cmdline_user_args()
  allow_previous_sdk = args.has("--allow-previous-sdk")
  for arg: String in args:
    if arg.begins_with("--flag="):
      flag_mode = arg.trim_prefix("--flag=")
  call_deferred("run_probe")

func run_probe() -> void:
  root.size = Vector2i(680, 200)
  application = ClassDB.instantiate("FabricApplication")
  application.name = "PanResponderApplication"
  application.set("bundle_path", "res://build/pan-responder-" + flag_mode + ".js")
  root.add_child(application)
  mount("A", Vector2.ZERO)
  mount("B", Vector2(340, 0))
  await settle()
  var mounted := native(application)
  var rendered: bool = mounted.get("errors", []).is_empty() and int(mounted.get("rootCount", 0)) == 2 and state().has("events")
  # The preceding SDK replaced PanResponder with a stub that throws on create.
  stages.mount = {"application": mounted}
  if not check(rendered, "mount/Two roots render original PanResponder instances in one Hermes application"):
    finish()
    return
  for spec: Dictionary in cases():
    await run_case(spec)
  check(int(stages["touch/tap-pressable"].react.panels.A.presses) == 1 and int(stages["touch/claim"].react.panels.A.presses) == 1,
    "pressable/Only the untouched tap presses; the claimed gesture never does")
  finish()

func finish() -> void:
  stages.beforeStop = {"application": native(application)}
  check(stages.beforeStop.application.get("errors", []).is_empty(), "cleanup/No dispatch or responder diagnostic was hidden")
  application.call("stop")
  await settle()
  var stopped := native(application)
  check(stopped.stopped and stopped.rootCount == 0 and stopped.pendingWork == 0 and stopped.pointerRouting.contacts == 0 and stopped.errors.is_empty(),
    "cleanup/Stop balances roots, routes and work without diagnostics")
  for name: String in ["A", "B"]:
    surfaces[name].queue_free()
  application.queue_free()
  await settle()
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var previous_sdk_observed: bool = allow_previous_sdk and failures.has("mount/Two roots render original PanResponder instances in one Hermes application")
  var report := {"scenario": "native-pan-responder", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "flagMode": flag_mode, "checks": checks, "failures": failures, "stages": stages,
    "afterStop": stopped, "allowPreviousSDK": allow_previous_sdk, "previousSDKObserved": previous_sdk_observed,
    "allAssertionsPassed": failures.is_empty(),
    "scope": {"actualNativeInput": true, "originalPanResponder": true, "originalResponderSystem": true,
      "nestedNegotiation": true, "multiTouch": true, "hardwareCertified": false, "publicDefaultEnabled": false}}
  var output := FileAccess.open("res://build/pan-responder-report.json", FileAccess.WRITE)
  if not check(output != null, "report/PanResponder report is saved"):
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  print("PAN_RESPONDER_PREVIOUS_SDK: " + str(failures.size()) if previous_sdk_observed else "PAN_RESPONDER_PASSED: " + str(checks.size()) if failures.is_empty() else "PAN_RESPONDER_FAILED")
  quit(0 if failures.is_empty() or previous_sdk_observed else 1)
