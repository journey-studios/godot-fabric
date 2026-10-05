extends SceneTree

# Every root of one application shares RN's single JS responder and touch
# history, so each TouchEvent lists every touch that runtime sees. A touch
# ending in root B therefore never looks like the end of root A's gesture: RN
# releases a responder only when no listed touch remains in it (the legacy
# plugin) or none remains at all (native dispatch). A touch starting in another
# root cannot claim the responder (the roots share no ancestor), and a cancel
# terminates the one responder, as in RN.
const DEVICE := 1001
const K := Vector2(80, 60)
var application: Node
var surfaces: Dictionary = {}
var checks: Array = []
var stages: Dictionary = {}
var flag_mode := "enabled"
var allow_original_negative := false
var expected_original_failures: Array = []
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
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(SharedTouchesProbe." + expression + ")"))

func mount(name: String, position: Vector2) -> void:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = name
  surface.position = position
  surface.size = Vector2(300, 200)
  surface.set("application_path", NodePath("../SharedTouchesApplication"))
  surface.set("component_name", "SharedTouchesProbe")
  surface.set("initial_props", {"name": name})
  surface.set_meta("validation_input_device", DEVICE)
  surfaces[name] = surface
  root.add_child(surface)

func touch(name: String, index: int, pressed: bool, canceled := false) -> void:
  var event := InputEventScreenTouch.new()
  event.device = DEVICE
  event.index = index
  event.position = surfaces[name].position + K
  event.pressed = pressed
  event.canceled = canceled
  Input.parse_input_event(event)
  await settle()

func mouse(name: String, pressed: Variant) -> void:
  if pressed == null:
    var motion := InputEventMouseMotion.new()
    motion.device = DEVICE
    motion.position = surfaces[name].position + K
    motion.button_mask = mask
    Input.parse_input_event(motion)
  else:
    mask = MOUSE_BUTTON_MASK_LEFT if pressed else 0
    var event := InputEventMouseButton.new()
    event.device = DEVICE
    event.position = surfaces[name].position + K
    event.button_index = MOUSE_BUTTON_LEFT
    event.pressed = pressed
    event.button_mask = mask
    Input.parse_input_event(event)
  await settle()

func perform(action: Array) -> void:
  match action[0]:
    "down": await touch(action[1], action[2], true)
    "up": await touch(action[1], action[2], false)
    "cancel": await touch(action[1], action[2], false, true)
    "hover": await mouse(action[1], null)
    "press": await mouse(action[1], true)
    "release": await mouse(action[1], false)
    # Pressability defers onPressOut until a press lasted 130 ms.
    "wait": await create_timer(float(action[1]) / 1000.0).timeout

func ints(value: Variant) -> Variant:
  return null if value == null else value.map(func(entry: Variant) -> int: return int(entry))

# Callbacks are [Pressable's root, callback, changed identifier, root of the
# touch that caused it]; raw rows are [root, type, changed, touches, targetTouches].
func run_case(spec: Dictionary) -> void:
  var prefix: String = spec.id
  print("SHARED_TOUCHES_STEP: " + prefix)
  js("arm(%s)" % JSON.stringify(prefix))
  for action: Array in spec.actions:
    await perform(action)
  var value: Dictionary = js("snapshot()")
  var app := native(application)
  stages[prefix] = {"react": value, "application": app, "surfaces": {"A": native(surfaces.A), "B": native(surfaces.B)}}
  var tags := {}
  for name: String in ["A", "B"]:
    for node: Dictionary in native(surfaces[name]).nodes:
      if node.testID == name + "-press":
        tags[int(node.tag)] = name
  var events: Array = value.events.map(func(row: Dictionary) -> Array:
    return [row.name, row.callback, ints(row.changed), tags.get(int(row.target), "?") if row.target != null else null])
  var raw: Array = value.raw.map(func(row: Dictionary) -> Array:
    return [tags.get(int(row.target), "?"), row.type, ints(row.changed), ints(row.touches), ints(row.targetTouches)])
  var names := {"events": prefix + "/The original Pressables see RN's single-responder gesture",
    "raw": prefix + "/Each TouchEvent lists every touch the application's runtime sees"}
  for kind: String in spec.get("normative", []):
    expected_original_failures.append(names[kind])
  check(events == spec.events, names.events)
  check(raw == spec.raw, names.raw)
  check(int(native(surfaces.A).pointer.activeTouches) == 0 and int(native(surfaces.B).pointer.activeTouches) == 0 and
      int(app.pointerRouting.active) == 0, prefix + "/Both roots end without a retained touch or contact")

func cases() -> Array:
  return [
    # The first root keeps its press while a second root's touch starts and
    # ends; that touch can neither claim nor release the shared responder.
    {"id": "touch/overlap-a-then-b", "normative": ["events", "raw"],
      "actions": [["down", "A", 0], ["wait", 200], ["down", "B", 1], ["up", "B", 1], ["up", "A", 0]],
      "events": [["A", "pressIn", [1], "A"], ["A", "pressOut", [1], "A"], ["A", "press", [1], "A"]],
      "raw": [["A", "topTouchStart", [1], [1], [1]], ["B", "topTouchStart", [2], [1, 2], [2]],
        ["B", "topTouchEnd", [2], [1], []], ["A", "topTouchEnd", [1], [], []]]},
    {"id": "touch/overlap-b-then-a", "normative": ["events", "raw"],
      "actions": [["down", "B", 0], ["wait", 200], ["down", "A", 1], ["up", "A", 1], ["up", "B", 0]],
      "events": [["B", "pressIn", [1], "B"], ["B", "pressOut", [1], "B"], ["B", "press", [1], "B"]],
      "raw": [["B", "topTouchStart", [1], [1], [1]], ["A", "topTouchStart", [2], [1, 2], [2]],
        ["A", "topTouchEnd", [2], [1], []], ["B", "topTouchEnd", [1], [], []]]},
    # The mouse's touch (identifier 0) in A survives a touch in B.
    {"id": "mixed/mouse-a-touch-b", "normative": ["events", "raw"],
      "actions": [["hover", "A"], ["press", "A"], ["wait", 200], ["down", "B", 0], ["up", "B", 0], ["release", "A"]],
      "events": [["A", "pressIn", [0], "A"], ["A", "pressOut", [0], "A"], ["A", "press", [0], "A"]],
      "raw": [["A", "topTouchStart", [0], [0], [0]], ["B", "topTouchStart", [1], [0, 1], [1]],
        ["B", "topTouchEnd", [1], [0], []], ["A", "topTouchEnd", [0], [], []]]},
    {"id": "touch/sequential", "normative": [],
      "actions": [["down", "A", 0], ["wait", 200], ["up", "A", 0], ["down", "B", 0], ["wait", 200], ["up", "B", 0]],
      "events": [["A", "pressIn", [1], "A"], ["A", "pressOut", [1], "A"], ["A", "press", [1], "A"],
        ["B", "pressIn", [1], "B"], ["B", "pressOut", [1], "B"], ["B", "press", [1], "B"]],
      "raw": [["A", "topTouchStart", [1], [1], [1]], ["A", "topTouchEnd", [1], [], []],
        ["B", "topTouchStart", [1], [1], [1]], ["B", "topTouchEnd", [1], [], []]]},
    # A cancel terminates RN's one responder, whichever root it comes from.
    {"id": "touch/cancel-b", "normative": ["raw"],
      "actions": [["down", "A", 0], ["wait", 200], ["down", "B", 1], ["cancel", "B", 1], ["up", "A", 0]],
      "events": [["A", "pressIn", [1], "A"], ["A", "pressOut", [2], "B"]],
      "raw": [["A", "topTouchStart", [1], [1], [1]], ["B", "topTouchStart", [2], [1, 2], [2]],
        ["B", "topTouchCancel", [2], [1], []], ["A", "topTouchEnd", [1], [], []]]},
  ]

func _initialize() -> void:
  var args := OS.get_cmdline_user_args()
  allow_original_negative = args.has("--allow-original-negative")
  for arg: String in args:
    if arg.begins_with("--flag="):
      flag_mode = arg.trim_prefix("--flag=")
  call_deferred("run_probe")

func run_probe() -> void:
  root.size = Vector2i(680, 200)
  application = ClassDB.instantiate("FabricApplication")
  application.name = "SharedTouchesApplication"
  application.set("bundle_path", "res://build/shared-touches-" + flag_mode + ".js")
  root.add_child(application)
  mount("A", Vector2.ZERO)
  mount("B", Vector2(340, 0))
  await settle()
  check(int(native(application).rootCount) == 2 and native(application).errors.is_empty(), "mount/Two roots share one Hermes application")
  for spec: Dictionary in cases():
    await run_case(spec)
  check(int(stages["touch/sequential"].react.panels.A.presses) >= 1, "presses/Each root's own taps still press")
  stages.beforeStop = {"application": native(application)}
  check(stages.beforeStop.application.errors.is_empty(), "cleanup/No dispatch or responder diagnostic was hidden")
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
  var observed := failures.duplicate()
  var expected := expected_original_failures.duplicate()
  observed.sort()
  expected.sort()
  var original_negative_observed := allow_original_negative and observed == expected and not failures.is_empty()
  var report := {"scenario": "native-shared-touches", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "flagMode": flag_mode, "checks": checks, "failures": failures, "stages": stages,
    "afterStop": stopped, "expectedOriginalFailures": expected_original_failures, "allowOriginalNegative": allow_original_negative,
    "originalNegativeObserved": original_negative_observed, "allAssertionsPassed": failures.is_empty(),
    "scope": {"actualNativeInput": true, "applicationWideTouches": true, "singleJSResponder": true,
      "multipleTouchDevices": false, "hardwareCertified": false, "publicDefaultEnabled": false}}
  var output := FileAccess.open("res://build/shared-touches-report.json", FileAccess.WRITE)
  if not check(output != null, "report/Shared touches report is saved"):
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  print("SHARED_TOUCHES_ORIGINAL_NEGATIVE: " + str(failures.size()) if original_negative_observed else "SHARED_TOUCHES_PASSED: " + str(checks.size()) if failures.is_empty() else "SHARED_TOUCHES_FAILED")
  quit(0 if failures.is_empty() or original_negative_observed else 1)
