extends SceneTree

# GF-05 slice D2. RN bridgeless installs requestIdleCallback and cancelIdleCallback from its NativeIdleCallbacks module (setUpTimers.js), a C++ module
# that schedules the callback as an idle-priority task of the RuntimeScheduler. This probe runs one bundle in an actual Hermes application of this host,
# with one mounted root, and judges:
#   - setUpTimers: the bundle imports RN's setUpTimers unchanged, so the flag is written before the renderer reads it, setImmediate and clearImmediate are
#     RN's immediateShim, and the idle callbacks are lazy getters until they are read;
#   - the module: the globals reach RN's C++ module (the registry's counters), a callback requested outside any task runs and is told RN's deadline,
#     a canceled callback never runs, and the edges of cancel are RN's;
#   - the cases of tests/idle-callbacks-cases.mjs, each the handler of a Pressable's onPress driven by Godot mouse events through the host's real event
#     path: the order idle callbacks run in against microtasks, immediates, a timer and the scheduler's priorities; what timeRemaining reads against the
#     clock and the scheduler's yield; what the timeout option does (only didTimeout) and does not do (run a callback early); cancel;
#   - the lifecycle gate: an idle callback queued before the application stops does not run once it is inactive, although the scheduler ran the task
#     queued with it, and nothing is scheduled after; nor does one that a commit in flight queues after a native signal requested the stop.
# tests/idle-callbacks-oracle.mjs derives every order, reading class and verdict again from RN's sources and V8.
const DEVICE := 1001
const SIZE := Vector2(200, 100)
# The length of the deadline in NativeIdleCallbacks.cpp, and the slack of float arithmetic. The oracle reads the 50 from the C++ and requires this to equal it.
const DEADLINE_MS := 50.0
const EPSILON := 0.000001
# The order of marks each case comes out in. The oracle derives these from the RuntimeScheduler's rules and V8's microtask queue; they are written out here
# for the probe to judge by.
const ORDERS := {
  "order": ["handler-end", "microtask", "promise", "immediate", "task-immediate", "task-user-blocking", "task-normal", "idle-a", "idle-a-microtask",
    "idle-a-promise", "idle-a-immediate", "idle-b", "timeout", "end"],
  "deadline": ["handler-end", "idle", "end"],
  "yield": ["handler-end", "idle-a", "task-normal", "idle-b", "idle-nested", "end"],
  "yield-immediate": ["handler-end", "idle", "task-immediate", "end"],
  "timeout": ["handler-end", "busy-1", "busy-2", "busy-3", "idle-timeout-1", "idle-timeout-60000", "idle-timeout-0", "idle-timeout-negative",
    "idle-no-timeout", "end"],
  "cancel": ["handler-end", "idle-a", "idle-c", "idle-d", "end"],
}
# What each reading of timeRemaining is, by the model: zero (the scheduler yields, or the deadline is past), or timed (between what the clock allows).
const SAMPLES := {
  "deadline": {"entry": "timed", "again": "timed", "after-quick": "timed", "after-deadline": "zero"},
  "yield": {"entry": "timed", "after-idle": "timed", "after-task": "zero", "again": "zero"},
  "yield-immediate": {"entry": "timed", "after-task": "zero"},
}
# Which idle callbacks the timeout case's model says time out.
const DID_TIMEOUT := {"idle-timeout-1": true, "idle-timeout-60000": false, "idle-timeout-0": false, "idle-timeout-negative": false, "idle-no-timeout": false}
const KEYS := ["didTimeout", "timeRemaining"]
var checks: Array = []
var stages := {}
var expected_original_failures: Array = []
var allow_original_negative := false
var sabotage := false
var bundle_file := "idle-callbacks-probe.js"
var application: Node
var surface: Control
# The nodes of the lane that has ended: they are freed with the last one.
var retired: Array = []

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

# A normative check needs what this slice changed in the host: the host without RN's NativeIdleCallbacks module must fail exactly these checks, while the
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

# The counters of the registry for RN's NativeIdleCallbacks module: requests and cancels that reached it, or -1 each where the host serves none.
func counts(snapshot: Dictionary) -> Dictionary:
  return {"requests": int(dig(snapshot, ["nativeModules", "idleCallbacks", "requests"], -1)), "cancels": int(dig(snapshot, ["nativeModules", "idleCallbacks", "cancels"], -1))}

# A count the bundle reports, or 0 where it reported none (a bundle that did not evaluate has no probe object).
func whole(value: Variant) -> int:
  return int(value) if (value is float or value is int) else 0

func microtask_calls(snapshot: Dictionary) -> int:
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
  return marks.map(func(entry: Dictionary) -> String: return str(entry.label))

# Arms the case, presses the root and waits for the case to finish: its own last timer says so, whatever the pace of the frames.
func run_case(name: String) -> Dictionary:
  var armed: Variant = js("IdleCallbacksProbe.arm(%s)" % JSON.stringify(name))
  var center := surface.get_global_rect().get_center()
  send("down", center)
  await settle(2)
  send("up", center)
  var waited := 0
  var record: Variant = null
  while waited < 600:
    await process_frame
    waited += 1
    record = js("IdleCallbacksProbe.state().results[%s]" % JSON.stringify(name))
    if record is Dictionary and record.done == true:
      break
  await settle(2)
  var state: Variant = js("IdleCallbacksProbe.state()")
  return {"armed": armed, "record": record, "labels": labels(record), "presses": dig(state, ["presses"], 0), "waitedFrames": waited}

func wait_mounted() -> void:
  var waited := 0
  while int(snap().get("rootCount", 0)) < 1 and waited < 600:
    await process_frame
    waited += 1
  await settle()

# Waits until the expression is true, frame by frame: the callbacks being waited for are the host's own idle tasks, whatever the pace of the frames.
func wait_for(expression: String) -> int:
  var waited := 0
  while waited < 300 and js(expression) != true:
    await process_frame
    waited += 1
  return waited

# What a reading of timeRemaining may be: the callback is told the time its task started, which lies between the request and the callback's entry, and
# the deadline is 50 ms from it. So a reading is at most what is left of 50 ms from the entry to the call, and at least what is left from the request to the
# end of the call, and never negative.
func reading_bounds(idle: Dictionary, sample: Dictionary) -> Array:
  var requested: Dictionary = idle.get("requested", {})
  var low := maxf(0.0, float(requested.get("before", 0.0)) + DEADLINE_MS - float(sample.after))
  var high := minf(DEADLINE_MS, maxf(0.0, float(idle.get("entry", 0.0)) + DEADLINE_MS - float(sample.at)))
  return [low, high]

# Whether the readings of an idle callback that the classes name are what the model says: the zero ones are exactly zero, the timed ones lie within the bounds of
# the clock, the timestamps are in order and a later reading is never larger than an earlier one.
func readings_hold(idle: Variant, classes: Dictionary) -> bool:
  if not (idle is Dictionary):
    return false
  var record: Dictionary = idle
  var samples: Array = []
  for sample: Dictionary in record.get("samples", []):
    if classes.has(sample.get("label")):
      samples.append(sample)
  if samples.size() != classes.size():
    return false
  var requested: Dictionary = record.get("requested", {})
  var stamps: Array = [requested.get("before"), requested.get("after"), record.get("entry")]
  for sample: Dictionary in samples:
    stamps.append(sample.get("at"))
    stamps.append(sample.get("after"))
  for index in range(stamps.size()):
    if not (stamps[index] is float or stamps[index] is int):
      return false
    if index > 0 and float(stamps[index]) < float(stamps[index - 1]):
      return false
  var previous := INF
  for sample: Dictionary in samples:
    if not (sample.get("value") is float or sample.get("value") is int):
      return false
    var value := float(sample.value)
    if value > previous + EPSILON:
      return false
    previous = value
    var kind: String = classes[sample.label]
    if kind == "zero":
      if value != 0.0:
        return false
    elif kind == "timed":
      var bounds := reading_bounds(record, sample)
      if value < float(bounds[0]) - EPSILON or value > float(bounds[1]) + EPSILON:
        return false
    else:
      return false
  return true

func check_setuptimers(environment: Variant) -> void:
  var events: Array = dig(environment, ["events"], [])
  var flag_write := -1
  var first_flag_read := -1
  for index in range(events.size()):
    var event: Dictionary = events[index]
    if event.name == "RN$enableMicrotasksInReact":
      if event.op == "write" and event.value == true and flag_write < 0:
        flag_write = index
      if event.op == "read" and first_flag_read < 0:
        first_flag_read = index
  var first_flag: Dictionary = events[first_flag_read] if first_flag_read >= 0 else {}
  check((flag_write >= 0 and first_flag_read > flag_write and first_flag.get("value") == true),
    "setUpTimers/RN$enableMicrotasksInReact is written true by RN's setUpTimers before the renderer reads it, and the renderer reads true")
  var before: Dictionary = dig(stages, ["host", "before"], {})
  var undefined_before := true
  for name: String in ["RN$enableMicrotasksInReact", "setImmediate", "clearImmediate", "requestIdleCallback", "cancelIdleCallback"]:
    undefined_before = undefined_before and before.get(name) == "undefined"
  check((undefined_before and dig(environment, ["kindsAtStart", "requestIdleCallback"]) == "getter" and dig(environment, ["kindsAtStart", "cancelIdleCallback"]) == "getter"),
    "setUpTimers/The host defines none of the globals setUpTimers installs, and the idle callbacks are lazy getters that nothing has read when the bundle has evaluated")
  check((dig(environment, ["setImmediate", "isShim"]) == true and dig(environment, ["clearImmediate", "isShim"]) == true),
    "setUpTimers/setImmediate and clearImmediate are RN's immediateShim")
  var calls_before := microtask_calls(snap())
  js("IdleCallbacksProbe.queueImmediate()")
  var calls_after := microtask_calls(snap())
  await settle(2)
  var immediate: Variant = js("IdleCallbacksProbe.immediateState()")
  stages.drained = {"immediate": immediate, "callsBefore": calls_before, "callsAfter": calls_after}
  check((calls_after - calls_before == 1 and calls_before >= 0 and dig(immediate, ["ran"]) == true),
    "setUpTimers/setImmediate reaches RN's NativeMicrotasks through queueMicrotask and runs")

func check_module(environment: Variant) -> void:
  var native: Variant = dig(environment, ["native"], {})
  host_check((dig(native, ["loaded"]) == true and dig(native, ["hasRequestIdleCallback"]) == true and dig(native, ["hasCancelIdleCallback"]) == true
    and dig(native, ["requestType"]) == "function" and dig(native, ["cancelType"]) == "function" and dig(native, ["stableFunctions"]) == true),
    "module/RN's NativeIdleCallbacks spec module loads over the host's NativeIdleCallbacksCxx and exposes requestIdleCallback and cancelIdleCallback")
  var registered := snap()
  stages.registry = registered
  host_check((counts(registered).requests >= 0 and counts(registered).cancels >= 0),
    "module/The registry serves RN's NativeIdleCallbacks module and counts the calls that reach it")
  # No frame passes between the two snapshots, so the host queues nothing of its own in between.
  var count := whole(js("IdleCallbacksProbe.bulk"))
  var before := snap()
  var result: Variant = js("IdleCallbacksProbe.requestMany(%d)" % count)
  var after := snap()
  stages.request_many = {"count": count, "before": counts(before), "after": counts(after), "result": result}
  host_check((count > 1 and counts(after).requests - counts(before).requests == count and counts(after).cancels == counts(before).cancels and counts(before).requests >= 0
    and dig(result, ["handleTypes"], []).size() == count and dig(result, ["handleTypes"], []).all(func(kind: Variant) -> bool: return kind == "object")
    and dig(result, ["distinct"]) == count and dig(result, ["errors"], [null]).is_empty()),
    "module/Each requestIdleCallback call through the global reaches the C++ module once and returns a task handle")

func check_module_runs() -> void:
  var waited := await wait_for("IdleCallbacksProbe.manyState().ran === IdleCallbacksProbe.manyState().requested")
  var many: Variant = js("IdleCallbacksProbe.manyState()")
  stages.many_done = {"many": many, "waitedFrames": waited}
  var deadlines: Array = dig(many, ["deadlines"], [])
  host_check((dig(many, ["requested"]) == int(stages.request_many.count) and dig(many, ["ran"]) == dig(many, ["requested"]) and deadlines.size() == int(stages.request_many.count)
    and deadlines.all(func(entry: Dictionary) -> bool: return entry.get("didTimeout") == false and entry.get("timeRemainingType") == "function" and entry.get("keys") == KEYS)),
    "module/Idle callbacks requested outside any task run, each told a deadline with didTimeout false and a timeRemaining function")
  var count := whole(js("IdleCallbacksProbe.bulk"))
  var before := snap()
  var result: Variant = js("IdleCallbacksProbe.cancelMany(%d)" % count)
  var after := snap()
  await wait_for("IdleCallbacksProbe.cancelManyState().controlRan === true")
  var state: Variant = js("IdleCallbacksProbe.cancelManyState()")
  stages.cancel_many = {"count": count, "before": counts(before), "after": counts(after), "result": result, "state": state}
  host_check((count > 1 and counts(after).cancels - counts(before).cancels == count and counts(after).requests - counts(before).requests == count + 1 and counts(before).cancels >= 0
    and dig(state, ["requested"]) == count and dig(state, ["canceled"]) == count and dig(state, ["ran"]) == 0 and dig(state, ["controlRan"]) == true
    and dig(state, ["errors"], [null]).is_empty()),
    "module/Each cancelIdleCallback call through the global reaches the C++ module once, and a canceled callback never runs")
  var requested: Variant = js("IdleCallbacksProbe.edgeRequest()")
  await wait_for("IdleCallbacksProbe.edgeState().ran === true")
  var edge_state: Variant = js("IdleCallbacksProbe.edgeState()")
  var cancels: Variant = js("IdleCallbacksProbe.edgeCancels()")
  stages.edges = {"request": requested, "state": edge_state, "cancels": cancels}
  host_check((dig(edge_state, ["ran"]) == true and dig(cancels, ["afterRun", "threw"]) == false and dig(cancels, ["again", "threw"]) == false
    and dig(cancels, ["plainObject", "threw"]) == false and dig(cancels, ["number", "threw"]) == true),
    "module/Cancelling a handle that has already run, one already canceled or an object that is no handle does nothing; a value that is no object throws")

func check_cases() -> void:
  for name: String in ORDERS.keys():
    var outcome := await run_case(name)
    stages["case_" + name.replace("-", "_")] = outcome
  host_check(stages.case_order.labels == ORDERS.order,
    "order/Idle callbacks run behind the work queued with them whatever its priority, in the order they were requested, with their own microtasks between, and ahead of the timer")
  var deadline: Variant = dig(stages, ["case_deadline", "record", "idle", "idle"])
  host_check((dig(deadline, ["ran"]) == true and dig(deadline, ["didTimeout"]) == false and dig(deadline, ["timeRemainingType"]) == "function" and dig(deadline, ["deadlineKeys"]) == KEYS),
    "deadline/An idle callback with no timeout is told didTimeout false and a timeRemaining function")
  host_check(readings_hold(deadline, {"entry": "timed", "again": "timed", "after-quick": "timed"}),
    "deadline/timeRemaining reads no more than 50 ms and no less than the clock leaves of it, and a later reading is never larger")
  var past: Array = (dig(deadline, ["samples"], []) as Array).filter(func(sample: Dictionary) -> bool: return sample.label == "after-deadline")
  host_check((past.size() == 1 and past[0].value == 0 and float(past[0].at) - float(dig(deadline, ["entry"], 0.0)) >= DEADLINE_MS),
    "deadline/timeRemaining is exactly zero once the 50 ms are past")
  host_check(readings_hold(dig(stages, ["case_yield", "record", "idle", "idle-a"]), SAMPLES["yield"]),
    "yield/A task queued inside an idle callback takes the scheduler's yield, so timeRemaining reads zero from then on; an idle callback queued inside does not")
  host_check(stages.case_yield.labels == ORDERS["yield"],
    "yield/The task runs before the idle callback requested earlier, and that one before the callback requested inside")
  host_check((readings_hold(dig(stages, ["case_yield_immediate", "record", "idle", "idle"]), SAMPLES["yield-immediate"]) and stages.case_yield_immediate.labels == ORDERS["yield-immediate"]),
    "yield-immediate/An Immediate task queued inside an idle callback takes the yield too")
  host_check(stages.case_timeout.labels == ORDERS.timeout,
    "timeout/The timeout option does not run a callback early: the idle callbacks wait behind a scheduler that stays busy")
  var timed_out := true
  var idles: Dictionary = dig(stages, ["case_timeout", "record", "idle"], {})
  for owner: String in DID_TIMEOUT.keys():
    timed_out = timed_out and dig(idles, [owner, "ran"]) == true and dig(idles, [owner, "didTimeout"]) == DID_TIMEOUT[owner]
  host_check((timed_out and idles.size() == DID_TIMEOUT.size()),
    "timeout/didTimeout is true for a callback that runs after its timeout, false for a longer one, and false for a timeout of zero or less or none")
  host_check(stages.case_cancel.labels == ORDERS.cancel,
    "cancel/A canceled callback does not run, and the ones around it do, including one canceled from inside an idle callback")

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
  application.name = "IdleCallbacksApplication"
  application.set("bundle_path", "res://build/" + bundle_file)
  root.add_child(application)
  surface = ClassDB.instantiate("FabricSurface")
  surface.name = "IdleCallbacksRoot"
  surface.size = SIZE
  surface.set("application_path", NodePath("../IdleCallbacksApplication"))
  surface.set("component_name", "IdleCallbacksApp")
  root.add_child(surface)
  await wait_mounted()
  var mounted := snap()
  stages.mount = {"application": mounted, "surfaceId": surface.call("get_surface_id")}
  check(int(mounted.get("rootCount", 0)) == 1 and int(surface.call("get_surface_id")) > 0 and mounted.get("errors", []).is_empty(),
    "mount/The root mounts through the original AppRegistry without a diagnostic")
  var alive := int(mounted.get("rootCount", 0)) == 1 and not bool(mounted.get("stopped", false))
  var environment: Variant = js("IdleCallbacksProbe.environment()")
  stages.host = {"before": js("ReactMicrotasksHost.before")}
  stages.environment = environment
  await check_setuptimers(environment)
  check_module(environment)
  await check_module_runs()
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
  host_check(false, "order/Idle callbacks run behind the work queued with them whatever its priority, in the order they were requested, with their own microtasks between, and ahead of the timer")
  host_check(false, "deadline/An idle callback with no timeout is told didTimeout false and a timeRemaining function")
  host_check(false, "deadline/timeRemaining reads no more than 50 ms and no less than the clock leaves of it, and a later reading is never larger")
  host_check(false, "deadline/timeRemaining is exactly zero once the 50 ms are past")
  host_check(false, "yield/A task queued inside an idle callback takes the scheduler's yield, so timeRemaining reads zero from then on; an idle callback queued inside does not")
  host_check(false, "yield/The task runs before the idle callback requested earlier, and that one before the callback requested inside")
  host_check(false, "yield-immediate/An Immediate task queued inside an idle callback takes the yield too")
  host_check(false, "timeout/The timeout option does not run a callback early: the idle callbacks wait behind a scheduler that stays busy")
  host_check(false, "timeout/didTimeout is true for a callback that runs after its timeout, false for a longer one, and false for a timeout of zero or less or none")
  host_check(false, "cancel/A canceled callback does not run, and the ones around it do, including one canceled from inside an idle callback")

func check_gate() -> void:
  # An idle callback and a Normal task are queued in one turn and the application stops before the host pumps.
  js("IdleCallbacksProbe.queueGated()")
  application.call("stop")
  await settle()
  var stopped := snap()
  var gate: Variant = js("IdleCallbacksProbe.gateState()")
  stages.gate = {"state": gate, "application": stopped}
  host_check((dig(gate, ["queued", "threw"]) == false and dig(gate, ["controlRan"]) == true and dig(gate, ["idleRan"]) == false),
    "gate/An idle callback queued before the application stops does not run once it is inactive, although the scheduler ran the task queued with it")
  var after_stop: Variant = js("IdleCallbacksProbe.afterStop()")
  var after := snap()
  await settle(2)
  stages.after_stop = {"result": after_stop, "requests": counts(after).requests, "cancels": counts(after).cancels, "state": js("IdleCallbacksProbe.gateState()")}
  host_check((dig(after_stop, ["request", "threw"]) == false and dig(after_stop, ["request", "value"]) == 0 and dig(after_stop, ["cancel", "threw"]) == false
    and dig(after_stop, ["cancelNumber", "threw"]) == false and counts(after).requests == counts(stopped).requests and counts(after).cancels == counts(stopped).cancels
    and counts(stopped).requests >= 0 and dig(stages, ["after_stop", "state", "afterStopRan"]) == false),
    "gate/Once the application is inactive, requestIdleCallback schedules nothing, returns zero and does not reach the module, and cancelIdleCallback does nothing")
  var root_state: Dictionary = JSON.parse_string(surface.call("snapshot"))
  check(stopped.get("stopped", false) == true and int(stopped.get("rootCount", -1)) == 0 and int(root_state.get("nativeTags", -1)) == 0
    and int(root_state.get("creates", 0)) == int(root_state.get("deletes", -1)),
    "lifecycle/Stop releases the root, and all native Controls of the root are balanced")
  stages.stop = {"application": stopped, "root": root_state}

# A second application: a native signal asks for the stop in the middle of a React commit (the Control of the root is resized by it), as the adapter acceptance does
# with an external Control. React finishes the commit after the signal returns, and its layout effect requests an idle callback then, between the request and the
# stop's teardown. The gate is open there as the plain one is (nothing of the RuntimeScheduler runs while a stop is requested), and the callback must not run: the
# teardown begins before the scheduler's next task, and the strict gate is closed from then on.
func check_reentrant() -> void:
  retired.append(application)
  retired.append(surface)
  application = ClassDB.instantiate("FabricApplication")
  application.name = "IdleCallbacksReentrantApplication"
  application.set("bundle_path", "res://build/" + bundle_file)
  root.add_child(application)
  surface = ClassDB.instantiate("FabricSurface")
  surface.name = "IdleCallbacksReentrantRoot"
  surface.size = SIZE
  surface.set("application_path", NodePath("../IdleCallbacksReentrantApplication"))
  surface.set("component_name", "IdleCallbacksApp")
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
  js("IdleCallbacksProbe.resize()")
  var waited := 0
  while not bool(snap().get("stopped", false)) and waited < 300:
    await process_frame
    waited += 1
  await settle()
  var stopped := snap()
  var state: Variant = js("IdleCallbacksProbe.reentrantState()")
  stages.reentrant = {"mounted": mounted, "requests": requests.size(), "controlFound": found, "state": state, "application": stopped}
  host_check((found and requests.size() >= 1 and stopped.get("stopped", false) == true and int(stopped.get("rootCount", -1)) == 0
    and dig(state, ["requested", "threw"]) == false and dig(state, ["requested", "value"]) == true and dig(state, ["ran"]) == false),
    "reentrant/An idle callback that the commit in flight at a native stop request queues after the request never runs, and the stop still completes")

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
  var report := {"scenario": "native-idle-callbacks", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "bundle": bundle_file, "checks": checks, "stages": stages, "orders": ORDERS, "samples": SAMPLES,
    "deadlineMs": int(DEADLINE_MS), "expectedOriginalFailures": expected_original_failures, "allowOriginalNegative": allow_original_negative,
    "originalNegativeObserved": original_negative_observed, "sabotage": sabotage,
    "allCurrentAssertionsPassed": failures.is_empty(),
    "scope": {"actualHermesRuntime": true, "actualFabricApplication": true, "realEventPath": true, "nativeIdleCallbacksModule": true, "setUpTimersUnchanged": true,
      "callbackExceptionsCertified": false}}
  var output := FileAccess.open("res://build/idle-callbacks-report.json", FileAccess.WRITE)
  if not check(output != null, "report/The idle callbacks report is saved with any normative failure visible"):
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  output.close()
  if original_negative_observed:
    print("IDLE_CALLBACKS_ORIGINAL_NEGATIVE: " + str(failures.size()))
  elif sabotage_observed:
    print("IDLE_CALLBACKS_SABOTAGE_REJECTED: " + str(failures.size()))
  elif failures.is_empty():
    print("IDLE_CALLBACKS_PASSED: " + str(checks.size()))
  else:
    print("IDLE_CALLBACKS_FAILED")
  quit(0 if failures.is_empty() or original_negative_observed or sabotage_observed else 1)
