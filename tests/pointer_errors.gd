extends SceneTree

const DEVICE := 1001
var checks: Array = []
var cases: Array = []
var shared: Node
var independent: Node
var surfaces: Dictionary = {}
var focus_stops := 0

func check(condition: bool, name: String) -> void:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)

func settle() -> void:
  for index in range(8):
    await process_frame

func state(owner: Node) -> Dictionary:
  return JSON.parse_string(owner.call("snapshot"))

func react(owner: Node) -> Dictionary:
  return JSON.parse_string(owner.call("evaluate", "JSON.stringify(PointerErrorsFixture.snapshot())"))

func js(owner: Node, expression: String) -> void:
  owner.call("evaluate", "PointerErrorsFixture." + expression)

func query(owner: Node, name: String, pointer_id: int) -> bool:
  return JSON.parse_string(owner.call("evaluate", "JSON.stringify(PointerErrorsFixture.query(%s,'left',%d))" % [JSON.stringify(name), pointer_id])) == true

func last_id(owner: Node, name: String, type: String) -> int:
  var result := -1
  for entry: Dictionary in react(owner).events:
    if entry.name == name and entry.type == type:
      result = int(entry.pointerId)
  return result

func inject(kind: String, phase: String, position: Vector2, index: int = 0) -> void:
  var event: InputEvent
  if kind == "mouse":
    var motion := InputEventMouseMotion.new()
    motion.position = position
    event = motion
  elif phase == "move":
    var drag := InputEventScreenDrag.new()
    drag.position = position
    drag.index = index
    event = drag
  else:
    var touch := InputEventScreenTouch.new()
    touch.position = position
    touch.index = index
    touch.pressed = phase == "down"
    event = touch
  event.device = DEVICE
  Input.parse_input_event(event)
  await settle()

func application(label: String) -> Node:
  var owner: Node = ClassDB.instantiate("FabricApplication")
  owner.name = label
  owner.set("bundle_path", "res://build/pointer-errors.js")
  root.add_child(owner)
  return owner

func mount(name: String, owner: Node, offset: Vector2) -> void:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = name
  surface.position = offset
  surface.size = Vector2(400, 270)
  surface.set("application_path", NodePath("../" + str(owner.name)))
  surface.set("component_name", "PointerErrorsFixture")
  surface.set("initial_props", {"name": name})
  surface.set_meta("validation_input_device", DEVICE)
  surfaces[name] = surface
  root.add_child(surface)

func _initialize() -> void:
  call_deferred("run_probe")

func stop_from_focus() -> void:
  focus_stops += 1
  shared.call("stop")

func run_probe() -> void:
  root.size = Vector2i(850, 310)
  shared = application("Shared")
  independent = application("Independent")
  mount("A", shared, Vector2.ZERO)
  mount("B", independent, Vector2(420, 0))
  await settle()
  check(react(shared).mounts.get("A", 0) == 1 and react(independent).mounts.get("B", 0) == 1, "Fault fixture mounts original public View and TextInput in separate applications")
  await inject("touch", "down", Vector2(460, 60), 100)
  var survivor := last_id(independent, "B", "Down")
  js(independent, "capture('B','left',%d)" % survivor)
  await inject("touch", "move", Vector2(640, 60), 100)
  check(query(independent, "B", survivor), "Independent capture is genuinely active before listener faults")
  for phase: String in ["Out", "Over", "Enter", "Leave"]:
    await inject("mouse", "hover", Vector2(40, 60))
    js(shared, "clear()")
    js(shared, "arm('A',%s,%s)" % [JSON.stringify("right" if phase in ["Over", "Enter"] else "left"), JSON.stringify(phase)])
    var prior: int = state(shared).errors.size()
    await inject("mouse", "hover", Vector2(220, 60))
    var failed := state(shared)
    check(failed.errors.size() == prior + 1 and str(failed.errors.back()).contains("Pointer listener fault " + phase), "Original JSX listener fault remains visible exactly once: " + phase)
    check(failed.pointerProcessor.active == 0 and failed.pointerProcessor.pendingCapture == 0 and failed.pointerProcessor.activeCapture == 0 and failed.pointerProcessor.hover == 0,
      "Throwing hover listener retires only its own processor continuation: " + phase)
    check(react(shared).currentPriority == react(shared).defaultPriority, "Native binding restores original default priority after JS throw: " + phase)
    js(shared, "clear()")
    await inject("mouse", "hover", Vector2(220, 60))
    check(react(shared).events.any(func(entry: Dictionary) -> bool: return entry.type == "Move" and entry.box == "right"), "Next real hover sample recovers without dereferencing moved tracker: " + phase)
    check(query(independent, "B", survivor), "JS fault preserves independent pointer capture: " + phase)
    cases.append({"phase": phase, "stateAfterError": failed, "afterRecovery": state(shared), "react": react(shared)})
  for phase: String in ["GotPointerCapture", "Up"]:
    await inject("mouse", "hover", Vector2(840, 300))
    await inject("touch", "down", Vector2(40, 60), 50)
    var pointer_id := last_id(shared, "A", "Down")
    js(shared, "capture('A','left',%d)" % pointer_id)
    if phase == "Up":
      await inject("touch", "move", Vector2(220, 60), 50)
    js(shared, "clear()")
    js(shared, "arm('A','left',%s)" % JSON.stringify(phase))
    var prior: int = state(shared).errors.size()
    await inject("touch", "move" if phase == "GotPointerCapture" else "up", Vector2(220, 60), 50)
    var failed := state(shared)
    check(failed.errors.size() == prior + 1 and str(failed.errors.back()).contains("Pointer listener fault " + phase), "Original captured JSX listener fault remains visible exactly once: " + phase)
    check(not query(shared, "A", pointer_id) and failed.pointerProcessor.active == 0 and failed.pointerProcessor.pendingCapture == 0 and failed.pointerProcessor.activeCapture == 0,
      "Fault clears offending active and pending capture authority: " + phase)
    check(react(shared).currentPriority == react(shared).defaultPriority and query(independent, "B", survivor), "Captured fault restores priority and preserves independent active contact: " + phase)
    if phase == "GotPointerCapture":
      await inject("touch", "move", Vector2(220, 60), 50)
      await inject("touch", "up", Vector2(220, 60), 50)
    await inject("touch", "down", Vector2(40, 60), 51)
    var recovery_id := last_id(shared, "A", "Down")
    js(shared, "capture('A','left',%d)" % recovery_id)
    await inject("touch", "move", Vector2(220, 60), 51)
    check(query(shared, "A", recovery_id), "A new physical down reacquires original capture after a listener fault: " + phase)
    await inject("touch", "up", Vector2(220, 60), 51)
    check(not query(shared, "A", recovery_id), "Recovered pointer releases through original real up: " + phase)
    cases.append({"phase": phase, "stateAfterError": failed, "afterRecovery": state(shared), "react": react(shared)})
  var line := surfaces.A.find_child("A-input", true, false) as LineEdit
  check(line != null, "Reentrant stop uses a genuine mounted native LineEdit")
  line.focus_entered.connect(stop_from_focus)
  await inject("touch", "down", Vector2(40, 60), 60)
  var stop_id := last_id(shared, "A", "Down")
  js(shared, "capture('A','left',%d)" % stop_id)
  js(shared, "stopOnGot()")
  js(shared, "clear()")
  await inject("touch", "move", Vector2(220, 60), 60)
  check(focus_stops == 1 and state(shared).stopped and react(shared).events.map(func(entry: Dictionary) -> String: return entry.type) == ["GotPointerCapture"],
    "Real focus signal stops application inside got callback and immediately prevents later pointer continuation")
  check(query(independent, "B", survivor), "Reentrant stop preserves the other application's already-active capture")
  js(independent, "clear()")
  await inject("touch", "move", Vector2(640, 60), 100)
  check(react(independent).events.map(func(entry: Dictionary) -> String: return entry.type) == ["Move"], "Independent capture keeps receiving native movement after faulting application stops")
  await inject("touch", "up", Vector2(640, 60), 100)
  independent.call("stop")
  await settle()
  var after := {"shared": state(shared), "independent": state(independent)}
  for label: String in after:
    var status: Dictionary = after[label]
    check(status.stopped and status.rootCount == 0 and status.pendingWork == 0 and status.pendingTimers == 0 and status.pendingAnimationFrames == 0,
      "Fault lifecycle releases native roots and scheduled work: " + label)
    check(["active", "pendingCapture", "activeCapture", "hover"].all(func(key: String) -> bool: return status.pointerProcessor.get(key, -1) == 0) and status.pointerRouting.stored == 0 and status.pointerRouting.suppressed == 0,
      "Fault lifecycle clears actual pointer processor and all physical route storage: " + label)
  check(after.shared.errors.size() == 6 and after.independent.errors.is_empty(), "Exactly six deliberate listener errors survive final shutdown")
  for name: String in surfaces:
    var status: Dictionary = JSON.parse_string(surfaces[name].call("snapshot"))
    check(status.creates == status.deletes and status.nativeTags == 0, "Fault lifecycle balances native node identities: " + name)
    surfaces[name].queue_free()
  shared.queue_free()
  independent.queue_free()
  await settle()
  var file := FileAccess.open("res://build/pointer-errors-report.json", FileAccess.WRITE)
  file.store_string(JSON.stringify({"scenario": "pointer-errors", "godot": Engine.get_version_info().string, "reactNative": "0.87.1", "displayServer": DisplayServer.get_name(), "checks": checks,
    "cases": cases, "focusStops": focus_stops, "afterStop": after}, "  ") + "\n")
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  print("POINTER_ERRORS_FAILED" if failed else "POINTER_ERRORS_PASSED: " + str(checks.size()))
  quit(1 if failed else 0)
