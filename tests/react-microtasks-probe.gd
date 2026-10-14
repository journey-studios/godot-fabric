extends SceneTree

# GF-05 slice D1. RN bridgeless sets RN$enableMicrotasksInReact and installs queueMicrotask from its NativeMicrotasks module (setUpTimers.js), so
# that React's sync work commits in a microtask instead of a RuntimeScheduler Immediate task. This probe runs one bundle in an actual Hermes
# application of this host with one mounted root and judges:
#   - the flag and the global: the flag is true, and written, before the renderer reads it; the renderer captures the queueMicrotask the host
#     installed; each call through the global reaches the C++ module (the registry's counter) and setImmediate reaches it too;
#   - the microtask queue: FIFO order, interleaved with Promise reactions, ahead of the next RuntimeScheduler task and of a timer;
#   - React: a sync-lane update inside a press handler, driven by a Godot mouse event through the host's real event path, commits in a
#     microtask, in the order the pinned renderer's flag branch dictates (the cases of tests/react-microtasks-cases.mjs);
#   - the lifecycle gate: what was queued before the application stops completes first, while it is alive, and what is queued once it has
#     stopped is dropped; the stop unmounts the root through React's own microtask, also when a native signal requested it in the middle of a commit.
# tests/react-microtasks-oracle.mjs derives every order again from RN's sources, the pinned renderer and V8.
const DEVICE := 1001
const SIZE := Vector2(200, 100)
# The order of marks each case comes out in with RN$enableMicrotasksInReact true, as RN bridgeless runs it. The oracle derives these from the
# renderer's flag branch (scheduleImmediateRootScheduleTask) and from the RuntimeScheduler; they are written out here for the probe to judge by.
const ORDERS := {
  "fifo": ["handler-end", "promise-1", "microtask-1", "promise-2", "microtask-2", "immediate", "microtask-1-nested", "microtask-1-promise",
    "promise-2-microtask", "task-normal", "timeout", "end"],
  "react-microtask": ["handler-end", "microtask-before", "commit:1", "microtask-after", "promise-after", "end"],
  "react-tasks": ["handler-end", "commit:1", "microtask-after", "task-immediate", "task-user-blocking", "task-normal", "timeout", "end"],
  "react-batched": ["handler-end", "commit:2", "microtask-1", "microtask-2", "end"],
}
var checks: Array = []
var stages := {}
var expected_original_failures: Array = []
var allow_original_negative := false
var sabotage := false
var bundle_file := "react-microtasks-probe.js"
var application: Node
var surface: Control
# The nodes of the lane that has ended: they are freed with the last one.
var retired: Array = []

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

# A normative check needs what this slice changed in the host: the host without RN's NativeMicrotasks module must fail exactly these checks, while the
# same bundle holds every other one.
func host_check(condition: bool, name: String) -> bool:
  expected_original_failures.append(name)
  return check(condition, name)

func settle(count := 6) -> void:
  for index in range(count):
    await process_frame

# A value the expression does not give (a name the bundle never defined, a call that threw) is null, not a failure of the parse.
func js(expression: String) -> Variant:
  return JSON.parse_string(str(application.call("evaluate", "JSON.stringify((" + expression + ") ?? null)")))

func snap() -> Dictionary:
  return JSON.parse_string(application.call("snapshot"))

# value[path[0]][path[1]]..., or the fallback where the report is not what the check expects (a host without the module, a case that did not run).
func dig(value: Variant, path: Array, fallback: Variant = null) -> Variant:
  var current: Variant = value
  for key: Variant in path:
    if current is Dictionary and (current as Dictionary).has(key):
      current = (current as Dictionary)[key]
    elif current is Array and (key is int) and int(key) >= 0 and int(key) < (current as Array).size():
      current = (current as Array)[int(key)]
    else:
      return fallback
  return current

# A count the bundle reports, or 0 where it reported none (a bundle that did not evaluate, as slice D2's setUpTimers makes of a host without the module, has no probe object).
func whole(value: Variant) -> int:
  return int(value) if (value is float or value is int) else 0

# How many calls the registry counted for RN's NativeMicrotasks module.
func calls(snapshot: Dictionary) -> int:
  return int(dig(snapshot, ["nativeModules", "microtasks", "calls"], -1))

# One actual Godot mouse sample over the root, as a real mouse does: the button-less pointer moves there first.
func send(phase: String, at: Vector2) -> void:
  if phase == "down":
    var motion := InputEventMouseMotion.new()
    motion.device = DEVICE
    motion.position = at
    Input.parse_input_event(motion)
  var button := InputEventMouseButton.new()
  button.device = DEVICE
  button.position = at
  button.button_index = MOUSE_BUTTON_LEFT
  button.pressed = phase == "down"
  button.button_mask = MOUSE_BUTTON_MASK_LEFT if phase == "down" else 0
  Input.parse_input_event(button)

func labels(record: Variant) -> Array:
  var marks: Array = dig(record, ["marks"], [])
  return marks.map(func(entry: Dictionary) -> String: return entry.label if entry.detail == null else str(entry.label) + ":" + str(int(entry.detail)))

# Arms the case, presses the root and waits for the case to finish: its own last timer says so, whatever the pace of the frames.
func run_case(name: String) -> Dictionary:
  var armed: Variant = js("ReactMicrotasksProbe.arm(%s)" % JSON.stringify(name))
  var center := surface.get_global_rect().get_center()
  send("down", center)
  await settle(2)
  send("up", center)
  var waited := 0
  var record: Variant = null
  while waited < 600:
    await process_frame
    waited += 1
    record = js("ReactMicrotasksProbe.state().results[%s]" % JSON.stringify(name))
    if record is Dictionary and record.done == true:
      break
  await settle(2)
  var state: Variant = js("ReactMicrotasksProbe.state()")
  return {"armed": armed, "record": record, "labels": labels(record), "presses": dig(state, ["presses"], 0), "waitedFrames": waited}

func wait_mounted() -> void:
  var waited := 0
  while int(snap().get("rootCount", 0)) < 1 and waited < 600:
    await process_frame
    waited += 1
  await settle()

# The renderer reads the flag and queueMicrotask when it evaluates (ReactFabric-prod.js). The host's runtime wrote both before: the log of the
# accessors the host-state module put on the globals says so in the order it happened.
func check_renderer(environment: Variant) -> void:
  var events: Array = dig(environment, ["events"], [])
  var first_flag_read := -1
  var flag_write := -1
  var function_write := -1
  var first_function_read := -1
  for index in range(events.size()):
    var event: Dictionary = events[index]
    if event.name == "RN$enableMicrotasksInReact":
      if event.op == "write" and event.value == true and flag_write < 0:
        flag_write = index
      if event.op == "read" and first_flag_read < 0:
        first_flag_read = index
    if event.name == "queueMicrotask":
      if event.op == "write" and event.type == "function" and function_write < 0:
        function_write = index
      if event.op == "read" and first_function_read < 0 and event.type == "function":
        first_function_read = index
  var first_flag: Dictionary = events[first_flag_read] if first_flag_read >= 0 else {}
  var first_function: Dictionary = events[first_function_read] if first_function_read >= 0 else {}
  check((flag_write >= 0 and first_flag_read > flag_write and first_flag.get("value") == true),
    "flag/RN$enableMicrotasksInReact is written true by the host runtime before the renderer reads it, and the renderer reads true")
  check((function_write >= 0 and first_function_read > function_write and first_function.get("final") == true and flag_write < first_flag_read),
    "flag/The host runtime installs queueMicrotask before the renderer evaluates, and the renderer captures that function")
  var host_before: Dictionary = dig(stages, ["host", "before"], {})
  check((host_before.get("RN$enableMicrotasksInReact") == "undefined" and dig(environment, ["queueMicrotask", "type"]) == "function"
    and dig(environment, ["queueMicrotask", "length"]) == 1 and dig(environment, ["setImmediate", "type"]) == "function"),
    "flag/The host defines no RN$enableMicrotasksInReact before the bundle, and queueMicrotask is a one-argument function once it has run")

func check_module(environment: Variant) -> void:
  var native: Variant = dig(environment, ["native"], {})
  host_check((dig(native, ["loaded"]) == true and dig(native, ["hasQueueMicrotask"]) == true and dig(native, ["queueMicrotaskType"]) == "function"
    and dig(native, ["stableFunction"]) == true),
    "module/RN's NativeMicrotasks spec module loads over the host's NativeMicrotasksCxx and exposes queueMicrotask")
  var registered := snap()
  stages.registry = registered.get("nativeModules", {})
  host_check(calls(registered) >= 0,
    "module/The registry serves RN's NativeMicrotasks module and counts the calls that reach it")
  # No frame passes between the two snapshots, so the host queues nothing of its own in between.
  var count := whole(js("ReactMicrotasksProbe.bulk"))
  var before := snap()
  js("ReactMicrotasksProbe.queueMany(%d)" % count)
  var after := snap()
  host_check(count > 1 and calls(after) - calls(before) == count and calls(before) >= 0,
    "module/Each queueMicrotask call through the global reaches the C++ module once")
  stages.queue_many = {"count": count, "before": calls(before), "after": calls(after)}

func check_module_drained() -> void:
  var many: Variant = js("ReactMicrotasksProbe.queueManyState()")
  host_check(dig(many, ["queued"]) != null and dig(many, ["ran"]) == dig(many, ["queued"]) and int(dig(many, ["queued"], 0)) == int(dig(stages, ["queue_many", "count"], -1)),
    "module/The host drains the callbacks it queued on the module's microtask queue")
  var before := snap()
  js("ReactMicrotasksProbe.queueImmediate()")
  var after := snap()
  await settle(2)
  var immediate: Variant = js("ReactMicrotasksProbe.immediateState()")
  stages.drained = {"many": many, "immediate": immediate, "callsBefore": calls(before), "callsAfter": calls(after)}
  host_check(calls(after) - calls(before) == 1 and calls(before) >= 0 and dig(immediate, ["ran"]) == true,
    "module/setImmediate, RN's shim over queueMicrotask, reaches the C++ module through the global and runs")

func check_cases() -> void:
  for name: String in ORDERS.keys():
    var outcome := await run_case(name)
    stages["case_" + name.replace("-", "_")] = outcome
  host_check(stages.case_fifo.labels == ORDERS.fifo,
    "fifo/Promise reactions, microtasks and an immediate run in the order they were queued, nested ones behind them, before the next RuntimeScheduler task and a timer")
  host_check(stages.case_react_microtask.labels == ORDERS["react-microtask"],
    "react-microtask/A sync-lane update commits in a microtask: after the microtask queued before it, ahead of the microtask and the Promise reaction queued after it")
  host_check(stages.case_react_tasks.labels == ORDERS["react-tasks"],
    "react-tasks/The commit comes before every task queued earlier through the RuntimeScheduler, an Immediate one included, and before a timer")
  host_check(stages.case_react_batched.labels == ORDERS["react-batched"],
    "react-batched/Two updates in one handler are one commit, ahead of the microtasks queued between and after them")

func _initialize() -> void:
  var arguments := OS.get_cmdline_user_args()
  allow_original_negative = arguments.has("--allow-original-negative")
  sabotage = arguments.has("--sabotage")
  for argument: String in arguments:
    if argument.begins_with("--bundle="):
      bundle_file = argument.trim_prefix("--bundle=")
  call_deferred("run_probe")

func run_probe() -> void:
  root.size = Vector2i(320, 200)
  application = ClassDB.instantiate("FabricApplication")
  application.name = "ReactMicrotasksApplication"
  application.set("bundle_path", "res://build/" + bundle_file)
  root.add_child(application)
  surface = ClassDB.instantiate("FabricSurface")
  surface.name = "ReactMicrotasksRoot"
  surface.size = SIZE
  surface.set("application_path", NodePath("../ReactMicrotasksApplication"))
  surface.set("component_name", "ReactMicrotasksApp")
  root.add_child(surface)
  await wait_mounted()
  var mounted := snap()
  stages.mount = {"application": mounted, "surfaceId": surface.call("get_surface_id")}
  host_check(int(mounted.get("rootCount", 0)) == 1 and int(surface.call("get_surface_id")) > 0 and mounted.get("errors", []).is_empty(),
    "mount/The root mounts through the original AppRegistry without a diagnostic")
  var alive := int(mounted.get("rootCount", 0)) == 1 and not bool(mounted.get("stopped", false))
  var environment: Variant = js("ReactMicrotasksProbe.environment()")
  stages.host = {"before": js("ReactMicrotasksHost.before")}
  stages.environment = environment
  check_renderer(environment)
  check_module(environment)
  await settle(2)
  await check_module_drained()
  if alive:
    await check_cases()
  else:
    for name: String in ORDERS.keys():
      stages["case_" + name.replace("-", "_")] = {"labels": []}
    check_cases_missing()
  await check_gate()
  await check_reentrant()
  await finish()

# The root did not mount, so no handler ran: every case fails its check, and says so.
func check_cases_missing() -> void:
  host_check(false, "fifo/Promise reactions, microtasks and an immediate run in the order they were queued, nested ones behind them, before the next RuntimeScheduler task and a timer")
  host_check(false, "react-microtask/A sync-lane update commits in a microtask: after the microtask queued before it, ahead of the microtask and the Promise reaction queued after it")
  host_check(false, "react-tasks/The commit comes before every task queued earlier through the RuntimeScheduler, an Immediate one included, and before a timer")
  host_check(false, "react-batched/Two updates in one handler are one commit, ahead of the microtasks queued between and after them")

func check_gate() -> void:
  # A microtask, an immediate and a Promise reaction are queued in one turn, with an update of the component, and the application stops before
  # the host drains them.
  js("ReactMicrotasksProbe.queueGated()")
  application.call("stop")
  await settle()
  var stopped := snap()
  var gate: Variant = js("ReactMicrotasksProbe.gateState()")
  stages.gate = {"state": gate, "application": stopped}
  host_check((dig(gate, ["queued"]) == true and dig(gate, ["microtaskAlive"]) == true and dig(gate, ["immediateAlive"]) == true
    and dig(gate, ["promiseAlive"]) == true),
    "gate/A microtask, an immediate and a Promise reaction queued before the application stops complete first, while it is still alive")
  host_check(dig(gate, ["cleanups"]) == 1,
    "gate/Stop unmounts the root through React's own microtask: the update pending at the stop is not lost, and the root's effect cleanup runs once")
  var calls_before := calls(stopped)
  var after_stop: Variant = js("ReactMicrotasksProbe.queueAfterStop()")
  var after := snap()
  await settle(2)
  var late: Variant = js("ReactMicrotasksProbe.gateState()")
  stages.after_stop = {"result": after_stop, "calls": calls(after), "ran": dig(late, ["afterStopRan"])}
  host_check(dig(after_stop, ["threw"]) == false and calls(after) == calls_before and calls_before >= 0 and dig(late, ["afterStopRan"]) == false,
    "gate/Once the application has stopped, queueMicrotask schedules nothing, does not reach the module, and nothing queued then runs")
  var root_state: Dictionary = JSON.parse_string(surface.call("snapshot"))
  check(stopped.get("stopped", false) == true and int(stopped.get("rootCount", -1)) == 0 and int(root_state.get("nativeTags", -1)) == 0
    and int(root_state.get("creates", 0)) == int(root_state.get("deletes", -1)),
    "lifecycle/Stop releases the root, and all native Controls of the root are balanced")
  stages.stop = {"application": stopped, "root": root_state}

# A second application: a native signal asks for the stop in the middle of a React commit (the Control of the root is resized by it), as the adapter
# acceptance does with an external Control. React finishes the commit after the signal returns and queues its next job; the stop that follows must
# still be able to unmount the root.
func check_reentrant() -> void:
  retired.append(application)
  retired.append(surface)
  application = ClassDB.instantiate("FabricApplication")
  application.name = "ReactMicrotasksReentrantApplication"
  application.set("bundle_path", "res://build/" + bundle_file)
  root.add_child(application)
  surface = ClassDB.instantiate("FabricSurface")
  surface.name = "ReactMicrotasksReentrantRoot"
  surface.size = SIZE
  surface.set("application_path", NodePath("../ReactMicrotasksReentrantApplication"))
  surface.set("component_name", "ReactMicrotasksApp")
  root.add_child(surface)
  await wait_mounted()
  var mounted := snap()
  var control: Node = surface.find_child("pressable", true, false)
  var found := control != null
  var requests: Array = []
  if found:
    control.connect("resized", func() -> void:
      requests.append(1)
      application.call("stop"))
  js("ReactMicrotasksProbe.resize()")
  var waited := 0
  while not bool(snap().get("stopped", false)) and waited < 600:
    await process_frame
    waited += 1
  await settle()
  var stopped := snap()
  var gate: Variant = js("ReactMicrotasksProbe.gateState()")
  stages.reentrant = {"mounted": mounted, "requests": requests.size(), "controlFound": found, "state": gate, "application": stopped}
  host_check((found and requests.size() >= 1 and stopped.get("stopped", false) == true and int(stopped.get("rootCount", -1)) == 0
    and dig(gate, ["cleanups"]) == 1),
    "reentrant/A stop requested by a native signal in the middle of a commit still unmounts the root: React queues its next job after the request, and the gate does not refuse it")

func finish() -> void:
  for node: Node in retired:
    if is_instance_valid(node):
      node.queue_free()
  surface.queue_free()
  application.queue_free()
  await settle(2)
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var observed := failures.duplicate()
  var expected := expected_original_failures.duplicate()
  observed.sort()
  expected.sort()
  var original_negative_observed := allow_original_negative and observed == expected and not failures.is_empty()
  var sabotage_observed := sabotage and not failures.is_empty()
  var report := {"scenario": "native-react-microtasks", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "bundle": bundle_file, "checks": checks, "stages": stages, "orders": ORDERS,
    "expectedOriginalFailures": expected_original_failures, "allowOriginalNegative": allow_original_negative,
    "originalNegativeObserved": original_negative_observed, "sabotage": sabotage,
    "allCurrentAssertionsPassed": failures.is_empty(),
    "scope": {"actualHermesRuntime": true, "actualFabricApplication": true, "realEventPath": true, "nativeMicrotasksModule": true,
      "callbackExceptionsCertified": false, "idleCallbacksCertified": false}}
  var output := FileAccess.open("res://build/react-microtasks-report.json", FileAccess.WRITE)
  if not check(output != null, "report/The React microtasks report is saved with any normative failure visible"):
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  output.close()
  if original_negative_observed:
    print("REACT_MICROTASKS_ORIGINAL_NEGATIVE: " + str(failures.size()))
  elif sabotage_observed:
    print("REACT_MICROTASKS_SABOTAGE_REJECTED: " + str(failures.size()))
  elif failures.is_empty():
    print("REACT_MICROTASKS_PASSED: " + str(checks.size()))
  else:
    print("REACT_MICROTASKS_FAILED")
  quit(0 if failures.is_empty() or original_negative_observed or sabotage_observed else 1)
