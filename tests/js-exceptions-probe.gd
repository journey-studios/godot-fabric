extends SceneTree

# GF-05 slice F. RN reports the exception of every callback it runs, and bounds its microtask checkpoint; this probe runs one bundle in an actual Hermes
# application of this host with one mounted root and judges, per callback kind, where the exception is reported (a fatal error for JsErrorHandler, or nowhere),
# whether the rest of the queue still runs, that the runtime keeps running (V2-D26), and what a self-requeuing microtask and a Promise storm do to a timer and a
# frame callback queued beside them. The cases are tests/js-exceptions-cases.mjs; tests/js-exceptions-oracle.mjs derives every expectation from RN's pinned
# sources and from a model of RN's event loop. The fatal cases make the host record a failure on purpose (FABRIC_ERROR); tests/js-exceptions-native.test.mjs
# accepts those lines, and only those.
const DEVICE := 1001
const SIZE := Vector2(200, 100)
# RuntimeScheduler_Modern::performMicrotaskCheckpoint's bound (kRetriesBound) and the sizes of the two chains of tests/js-exceptions-cases.mjs. The oracle reads the
# bound out of RN's source and the sizes out of the cases, and requires these to be the same.
const BOUND := 255
const RETRY_TOTAL := 300
const STORM_TOTAL := 1000000
const BOUND_TEXT := "Error: Non-JS exception: Hits microtasks retries bound., stack:\n"
# The microtasks of one turn come out of the queue in this order (the oracle derives it from V8's own microtask queue and the model of the host's pump).
const MICRO := ["start", "m1", "m2", "p", "i1", "i2", "m3", "m4", "timer"]
# The journal of every case that has no chain, as the oracle's model gives it. The cases with a chain are judged by their own rules.
const JOURNALS := {
  "timeout": ["start", "a", "b", "c"],
  "interval": ["start", "tick#1", "tick#2", "tick#3"],
  "raf": ["start", "r1", "r2", "r3"],
  "idle": ["start", "i1", "i2", "timer"],
  "event": ["onPress", "timer"],
  "event-after": ["onPress", "timer"],
  "soft": ["start", "soft", "timer"],
  "microtask-evaluate": MICRO,
  "microtask-timer": MICRO,
  "microtask-raf": MICRO,
  "microtask-press": MICRO,
  "promise": ["start", "then-throws", "then-catch-throws", "async-throws", "after", "then-catch-caught", "timer"],
  "stop": ["queued", "s1", "s2", "sp", "si", "s3"],
}
# The fatal errors each case makes, in order: the callback that threw and the route its exception took. "host": the host's own catch reports it as the JS error it
# is (a timer, a frame callback, a microtask at a checkpoint the host performs). "scheduler": RN's compiled RuntimeScheduler catches it and hands its error handler
# "Non-js exception: " and what() of the error (an idle callback, an event handler, a microtask at RN's own checkpoint).
const FATAL := {
  "timeout": [["a", "host"]],
  "interval": [["tick#1", "host"], ["tick#2", "host"]],
  "raf": [["r1", "host"]],
  "idle": [["i1", "scheduler"]],
  "event": [["onPress", "scheduler"]],
  "event-after": [],
  "soft": [],
  "microtask-evaluate": [["m1", "host"], ["i1", "host"]],
  "microtask-timer": [["m1", "host"], ["i1", "host"]],
  "microtask-raf": [["m1", "host"], ["i1", "host"]],
  "microtask-press": [["m1", "scheduler"], ["i1", "scheduler"]],
  "promise": [],
  "stop": [["s1", "host"]],
}
var checks: Array = []
var stages := {}
var expected_original_failures: Array = []
var allow_original_negative := false
var sabotage := false
var bundle_file := "js-exceptions-probe.js"
var application: Node
var surface: Control
# The nodes of the lane that has ended: they are freed with the last one.
var retired: Array = []

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

# A normative check needs what this slice changed in the host: the previous host must fail exactly these checks, while the same bundle holds every other one.
func host_check(condition: bool, name: String) -> bool:
  expected_original_failures.append(name)
  return check(condition, name)

func settle(count := 6) -> void:
  for index in range(count):
    await process_frame

# A value the expression does not give is null, not a failure of the parse.
func js(expression: String) -> Variant:
  return JSON.parse_string(str(application.call("evaluate", "JSON.stringify((" + expression + ") ?? null)")))

func snap() -> Dictionary:
  return JSON.parse_string(application.call("snapshot"))

# value[path[0]][path[1]]..., or the fallback where the report is not what the check expects (a case that did not run).
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

func journal(snapshot: Dictionary) -> Dictionary:
  return snapshot.get("jsErrors", {})

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

func wait_mounted() -> void:
  var waited := 0
  while int(snap().get("rootCount", 0)) < 1 and waited < 600:
    await process_frame
    waited += 1
  await settle()

# A case runs from the entry its source says, and ends with its own last callback (record.done), whatever the pace of the machine's frames. The host's failures
# and its counters are read before and after, so that a case is judged by what it made and not by what the cases before it left.
func run_case(name: String) -> Dictionary:
  var before := snap()
  var started: Variant = js("JsExceptionsProbe.start(%s)" % JSON.stringify(name))
  if dig(started, ["source"]) == "press":
    var center := surface.get_global_rect().get_center()
    send("down", center)
    await settle(2)
    send("up", center)
  var waited := 0
  var record: Variant = null
  while waited < 1800:
    await process_frame
    waited += 1
    record = js("JsExceptionsProbe.record(%s)" % JSON.stringify(name))
    if record is Dictionary and record.done == true:
      break
  await settle(2)
  record = js("JsExceptionsProbe.record(%s)" % JSON.stringify(name))
  var after := snap()
  var errors_before: Array = before.get("errors", [])
  var errors_after: Array = after.get("errors", [])
  return {"started": started, "record": record, "before": journal(before), "after": journal(after), "errors": errors_after.slice(errors_before.size()),
    "logged": js("JsExceptionsProbe.loggedSince(%d)" % int(dig(record, ["loggedBefore"], 0))), "waitedFrames": waited, "presses": dig(js("JsExceptionsProbe.state()"), ["presses"], 0)}

# ---- What a case made, read from the report -----------------------------------------------------------------------------------------------------------------

func labels_of(case_record: Dictionary) -> Array:
  var journal_entries: Array = dig(case_record, ["record", "journal"], [])
  return journal_entries.map(func(entry: Dictionary) -> String: return str(entry.label))

func entry_of(case_record: Dictionary, label: String) -> Dictionary:
  var journal_entries: Array = dig(case_record, ["record", "journal"], [])
  var found: Array = journal_entries.filter(func(entry: Dictionary) -> bool: return entry.label == label)
  return found[0] if found.size() == 1 else {}

# What the host counted between the two snapshots of a case: reports of this route and kind.
func counted(case_record: Dictionary, route: String, kind: String) -> int:
  return int(dig(case_record, ["after", route, kind], 0)) - int(dig(case_record, ["before", route, kind], 0))

func finished(case_record: Dictionary) -> bool:
  return dig(case_record, ["record", "done"]) == true

func frames_ok(lines: Array) -> bool:
  var pattern := RegEx.create_from_string("^.*@.+:-?\\d+(:\\d+)?$")
  return not lines.is_empty() and lines.all(func(line: String) -> bool: return pattern.search(line) != null)

# The failure the host recorded for a fatal error whose exception its own catch reported: the message RN composed (the name, then the message), ", stack:" and a
# "method@file:line:column" line per frame (slice C's format).
func host_text(text: String, case_name: String, label: String) -> bool:
  var prefix := "Error: js-exceptions %s/%s, stack:\n" % [case_name, label]
  return text.begins_with(prefix) and frames_ok(Array(text.substr(prefix.length()).split("\n", false)))

# The same, for an exception that RN's compiled RuntimeScheduler caught: its catch for jsi::JSError misses Hermes' own class, so it hands its error handler
# "Non-js exception: " and what() of the error, which is the error and its stack as V8 writes them (slice C's finding).
func scheduler_text(text: String, case_name: String, label: String) -> bool:
  var message := "js-exceptions %s/%s" % [case_name, label]
  var head := "Error: Non-js exception: %s\n\nError: %s\n" % [message, message]
  var at := text.find(", stack:\n")
  return text.begins_with(head) and at > head.length() and frames_ok(Array(text.substr(at + ", stack:\n".length()).split("\n", false)))

func route_text(text: String, case_name: String, label: String, route: String) -> bool:
  return host_text(text, case_name, label) if route == "host" else scheduler_text(text, case_name, label)

# One failure for each fatal error the case makes, in order and by route, each in its format; the host counted them as fatal reports of the ExceptionsManager module
# (the runtime is ready, so RN's JS reports them) and none as soft, and the C++ pipeline of JsErrorHandler counted nothing.
func fatal_made(case_name: String, expected: Array) -> bool:
  var case_record: Dictionary = stages.cases.get(case_name, {})
  var errors: Array = case_record.get("errors", [0])
  if errors.size() != expected.size() or case_record.is_empty():
    return false
  for index in range(expected.size()):
    if not route_text(str(errors[index]), case_name, str(expected[index][0]), str(expected[index][1])):
      return false
  return (counted(case_record, "module", "fatal") == expected.size() and counted(case_record, "module", "soft") == 0
    and counted(case_record, "handler", "fatal") == 0 and counted(case_record, "handler", "soft") == 0)

# The journal is the model's, the case ended by its own last callback, and nothing the case ran was left behind.
func ran_as_journaled(case_name: String) -> bool:
  var case_record: Dictionary = stages.cases.get(case_name, {})
  return finished(case_record) and labels_of(case_record) == JOURNALS[case_name]

func nothing_reported(case_name: String) -> bool:
  var case_record: Dictionary = stages.cases.get(case_name, {})
  return (not case_record.is_empty() and case_record.errors.is_empty() and counted(case_record, "module", "fatal") == 0 and counted(case_record, "module", "soft") == 0
    and counted(case_record, "handler", "fatal") == 0 and counted(case_record, "handler", "soft") == 0 and (case_record.logged as Array).is_empty())

# A chain that throws every time: RN's checkpoint cuts it after BOUND failures and reports "Hits microtasks retries bound.", then the next checkpoint carries on.
# The failures come in this order: BOUND of the chain's, the bound, and the rest of the chain's (the report's own order, not a count of frames).
func bound_reported(case_name: String, route_of_first: String) -> bool:
  var case_record: Dictionary = stages.cases.get(case_name, {})
  var errors: Array = case_record.get("errors", [])
  if errors.size() != RETRY_TOTAL + 1 or str(errors[BOUND]) != BOUND_TEXT:
    return false
  for index in range(errors.size()):
    if index == BOUND:
      continue
    # The failures of the first checkpoint are RN's own when it was RN's checkpoint that ran it (after a task of the RuntimeScheduler); the host performs the rest.
    var route := route_of_first if index < BOUND else "host"
    if not route_text(str(errors[index]), case_name, "retry", route):
      return false
  return (counted(case_record, "module", "fatal") == RETRY_TOTAL + 1 and counted(case_record, "module", "soft") == 0 and counted(case_record, "handler", "fatal") == 0)

# What a timer and a frame callback queued beside a chain saw of it: the count of runs at the moment they ran. A checkpoint is not interleaved, so it is one of the
# boundaries between checkpoints (BOUND runs when the first one is cut, all of them when it is done), never in the middle of one, and after at least the first.
func beside_chain(case_name: String, chain: String, total: int, boundaries: Array) -> bool:
  var case_record: Dictionary = stages.cases.get(case_name, {})
  var order := labels_of(case_record)
  var timer_entry := entry_of(case_record, "alongside-timer")
  var frame_entry := entry_of(case_record, "alongside-raf")
  var last_entry := entry_of(case_record, chain + "-last")
  var end_entry := entry_of(case_record, "end")
  if timer_entry.is_empty() or frame_entry.is_empty() or last_entry.is_empty() or end_entry.is_empty() or not finished(case_record):
    return false
  var seen := [int(dig(timer_entry, ["chains", chain], -1)), int(dig(frame_entry, ["chains", chain], -1))]
  return (order.size() == 5 and order[0] == "start" and order[4] == "end" and seen.all(func(count: int) -> bool: return boundaries.has(count))
    and int(dig(last_entry, ["chains", chain], -1)) == total and int(dig(end_entry, ["chains", chain], -1)) == total
    and order.find("alongside-timer") < 4 and order.find("alongside-raf") < 4)

# ---- The probe ---------------------------------------------------------------------------------------------------------------------------------------------------

func start_application(label: String) -> void:
  application = ClassDB.instantiate("FabricApplication")
  application.name = "JsExceptions" + label + "Application"
  application.set("bundle_path", "res://build/" + bundle_file)
  root.add_child(application)
  surface = ClassDB.instantiate("FabricSurface")
  surface.name = "JsExceptions" + label + "Root"
  surface.size = SIZE
  surface.set("application_path", NodePath("../" + application.name))
  surface.set("component_name", "JsExceptionsApp")
  root.add_child(surface)

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
  start_application("Main")
  await wait_mounted()
  var mounted := snap()
  stages.mount = {"application": mounted, "surfaceId": surface.call("get_surface_id")}
  check(int(mounted.get("rootCount", 0)) == 1 and int(surface.call("get_surface_id")) > 0 and mounted.get("errors", []).is_empty(),
    "mount/The root mounts through the original AppRegistry without a diagnostic")
  var environment: Variant = js("JsExceptionsProbe.environment()")
  stages.environment = environment
  stages.cases = {}
  var names: Variant = js("JsExceptionsProbe.mainCaseNames")
  for name: Variant in (names if names is Array else []):
    stages.cases[str(name)] = await run_case(str(name))
  # The rejection tracker's positive control runs after the `promise` case, so it cannot have tracked anything there.
  js("JsExceptionsProbe.trackRejections()")
  await wait_tracked()
  js("JsExceptionsProbe.handleTracked()")
  await settle(3)
  stages.tracked = js("JsExceptionsProbe.tracked()")
  stages.beforeStop = snap()
  check_environment(environment)
  check_task_callbacks()
  check_microtasks()
  check_promises()
  check_starvation()
  await check_stop()
  retire()
  await check_wedge()
  await finish()

# Hermes reports an unhandled rejection after a timer of its own (two seconds for an Error): wait for the report, which is an event, with a generous bound in real time.
func wait_tracked() -> void:
  var started := Time.get_ticks_msec()
  while Time.get_ticks_msec() - started < 20000:
    await process_frame
    var tracked: Variant = js("JsExceptionsProbe.tracked()")
    if (dig(tracked, ["unhandled"], []) as Array).size() >= 1:
      break

func check_environment(environment: Variant) -> void:
  var host: Variant = dig(environment, ["host"], {})
  var globals: Variant = dig(environment, ["globals"], {})
  var callable := ["queueMicrotask", "setImmediate", "setTimeout", "setInterval", "requestAnimationFrame", "requestIdleCallback"]
  check((dig(host, ["dev"]) == false and dig(host, ["tracker", "hasPromise"]) == true and dig(environment, ["promiseIsHermes"]) == true
    and callable.all(func(name: String) -> bool: return dig(globals, [name, "type"]) == "function")),
    "release/The bundle is a release build on Hermes' own Promise, and the six callback globals under test are installed")

func check_task_callbacks() -> void:
  host_check(fatal_made("timeout", FATAL["timeout"]),
    "timeout/An exception in a setTimeout callback is a fatal error for JsErrorHandler, with RN's message and stack, and records one host failure")
  check(ran_as_journaled("timeout"),
    "timeout/The other timers due in the same tick still run, and the runtime keeps running")
  host_check(fatal_made("interval", FATAL["interval"]),
    "interval/An exception in a setInterval callback is a fatal error, once per tick that threw")
  check(ran_as_journaled("interval"),
    "interval/The interval keeps ticking after an exception, and clears itself when it is told to")
  host_check(fatal_made("raf", FATAL["raf"]),
    "raf/An exception in a requestAnimationFrame callback is a fatal error, as RN's timer-based frame callback is")
  check(ran_as_journaled("raf"),
    "raf/The other callbacks of the frame, and the ones they request, still run")
  check(fatal_made("idle", FATAL["idle"]),
    "idle/An exception in a requestIdleCallback callback leaves its RuntimeScheduler task and is a fatal error through the scheduler's handler")
  check(ran_as_journaled("idle"),
    "idle/The idle callback queued behind it still runs: the scheduler's queue is not cleared on an error")
  check(fatal_made("event", FATAL["event"]),
    "event/An exception in an event handler (a Pressable's onPress) reaches the RuntimeScheduler's handler as a fatal error, once")
  check(ran_as_journaled("event") and ran_as_journaled("event-after") and int(dig(stages.cases.get("event-after", {}), ["presses"], 0)) == 2
    and fatal_made("event-after", FATAL["event-after"]),
    "event/The timer the handler queued still runs, and the runtime keeps running: the next press is handled and makes no error")
  var soft: Dictionary = stages.cases.get("soft", {})
  check((ran_as_journaled("soft") and soft.errors.is_empty() and counted(soft, "module", "soft") == 1 and counted(soft, "module", "fatal") == 0
    and counted(soft, "handler", "soft") == 0 and counted(soft, "handler", "fatal") == 0),
    "soft/A soft exception reported from a timer callback (ErrorUtils.reportError) is counted as soft, logged, and records no failure")

func check_microtasks() -> void:
  for source: String in ["evaluate", "timer", "raf", "press"]:
    var name := "microtask-" + source
    var where := {"evaluate": "at the head of the host's pump", "timer": "after a timer's work item", "raf": "after a frame callback", "press": "in RN's own checkpoint after a RuntimeScheduler task"}[source] as String
    var verdict := fatal_made(name, FATAL[name])
    if source == "press":
      check(verdict, name + "/A throwing queueMicrotask callback and a throwing setImmediate callback are fatal errors " + where)
    else:
      host_check(verdict, name + "/A throwing queueMicrotask callback and a throwing setImmediate callback are fatal errors " + where)
    check(ran_as_journaled(name),
      name + "/The microtasks behind the one that threw still run in order: the other callback, the Promise reaction, the immediate, the nested callback, and the timer after them")

func check_promises() -> void:
  check(nothing_reported("promise"),
    "promise/A Promise reaction that throws, a rejection nobody handles and an async function that throws reach no host: nothing is reported, logged or recorded")
  # Hermes' tracker reports an unhandled rejection once (never the one that got its handler at once), and a handler attached afterwards as handled.
  var tracked: Variant = stages.get("tracked", {})
  var unhandled: Array = dig(tracked, ["unhandled"], [])
  var handled: Array = dig(tracked, ["handled"], [])
  check(ran_as_journaled("promise") and dig(tracked, ["enabled"]) == true and unhandled.size() == 1 and unhandled[0].message == "js-exceptions tracked/unhandled"
    and handled.size() == 1 and int(handled[0].id) == int(unhandled[0].id),
    "promise/The reactions ran in order and the catch ran; Hermes tracks a rejection only when told to, and then reports the unhandled one, and the late handler of it")

func check_starvation() -> void:
  for source: String in ["evaluate", "timer", "raf"]:
    var name := "retry-bound-" + source
    host_check(bound_reported(name, "host"),
      name + "/A microtask that queues itself and throws every time is cut after RN's 255 retries and reported as \"Hits microtasks retries bound.\"; the rest of the chain runs in the next checkpoint")
    check(beside_chain(name, "retry", RETRY_TOTAL, [BOUND, RETRY_TOTAL]),
      name + "/A timer and a frame callback queued beside the chain run only between checkpoints, after the first one was cut, and the chain completes")
  for source: String in ["evaluate", "timer"]:
    var name := "storm-" + source
    check(nothing_reported(name),
      name + "/A Promise storm of a million reactions is bounded by nothing and reported by nothing: no failure, no log, no bound")
    check(beside_chain(name, "storm", STORM_TOTAL, [STORM_TOTAL]),
      name + "/A timer and a frame callback queued beside the storm run only after the whole chain: RN's event loop is starved for its duration, as the host's is")

# The microtasks pending when the application stops complete first in one checkpoint, the one that throws included (the stop path of slice D1, now with RN's loop).
func check_stop() -> void:
  js("JsExceptionsProbe.queueForStop()")
  var before := snap()
  application.call("stop")
  await settle()
  var stopped := snap()
  var record: Variant = js("JsExceptionsProbe.record('stop')")
  var errors_before: Array = before.get("errors", [])
  var errors_after: Array = stopped.get("errors", [])
  stages.cases["stop"] = {"record": record, "before": journal(before), "after": journal(stopped), "errors": errors_after.slice(errors_before.size()), "logged": [], "presses": 0}
  check(fatal_made("stop", FATAL["stop"]) and labels_of(stages.cases["stop"]) == JOURNALS["stop"],
    "stop/The microtasks pending when the application stops complete in one checkpoint even when one throws: its exception is a fatal error and the ones behind it still run")
  var root_state: Dictionary = JSON.parse_string(surface.call("snapshot"))
  stages.stop = {"application": stopped, "root": root_state}
  check(stopped.get("stopped", false) == true and int(stopped.get("rootCount", -1)) == 0 and int(root_state.get("nativeTags", -1)) == 0
    and int(root_state.get("creates", 0)) == int(root_state.get("deletes", -1)),
    "lifecycle/Stop releases the root, and all native Controls of the root are balanced")
  var expected_total := 0
  for name: String in stages.cases.keys():
    expected_total += (stages.cases[name].errors as Array).size()
  var all_errors: Array = stopped.get("errors", [])
  check(all_errors.size() == expected_total and (stages.beforeStop.get("errors", []) as Array).size() == expected_total - (stages.cases["stop"].errors as Array).size(),
    "errors/The host recorded a failure for every fatal error of the cases and for nothing else: the application's own list is the cases' failures, in order")

func retire() -> void:
  retired.append(application)
  retired.append(surface)

# RN's own checkpoint, reached after a task of its RuntimeScheduler, throws the bound out of runEventLoop and ends the scheduler (see tests/js-exceptions-oracle.mjs): in
# an application of its own, because nothing that needs the scheduler runs afterwards. The timers and frame callbacks, which the host runs, do.
func check_wedge() -> void:
  start_application("Wedge")
  await wait_mounted()
  var mounted := snap()
  stages.wedge_mount = {"application": mounted}
  stages.wedge = {}
  stages.wedge["retry-bound-press"] = await run_case("retry-bound-press")
  # The second press is the one the scheduler never delivers.
  var before := snap()
  var started: Variant = js("JsExceptionsProbe.start('press-after')")
  var center := surface.get_global_rect().get_center()
  send("down", center)
  await settle(2)
  send("up", center)
  await settle(120)
  var after := snap()
  var state: Variant = js("JsExceptionsProbe.state()")
  stages.wedge["press-after"] = {"started": started, "record": js("JsExceptionsProbe.record('press-after')"), "state": state, "waitedFrames": 122,
    "before": journal(before), "after": journal(after)}
  stages.cases["retry-bound-press"] = stages.wedge["retry-bound-press"]
  host_check(bound_reported("retry-bound-press", "scheduler"),
    "retry-bound-press/RN's own checkpoint, after the press task, reports the same bound the host's does: BOUND failures, \"Hits microtasks retries bound.\", then the rest of the chain")
  check(beside_chain("retry-bound-press", "retry", RETRY_TOTAL, [BOUND, RETRY_TOTAL]),
    "retry-bound-press/The host's timers and frame callbacks keep running after the scheduler's checkpoint gave up, and the chain completes in the host's checkpoint")
  var second: Dictionary = stages.wedge["press-after"]
  check(dig(second, ["state", "presses"]) == 1 and dig(second, ["record", "done"]) == false and dig(second, ["record", "entered"]) == false,
    "retry-bound-press/The bound that escapes RN's runEventLoop leaves its RuntimeScheduler with a queued task and no scheduled loop, so the next press is never delivered")
  js("JsExceptionsProbe.queueForStop()")
  application.call("stop")
  await settle()
  var stopped := snap()
  check(stopped.get("stopped", false) == true and int(stopped.get("rootCount", -1)) == 0,
    "lifecycle/The application that lost its scheduler still stops, and releases its root")
  stages.wedge_stop = {"application": stopped}

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
  var report := {"scenario": "native-js-exceptions", "reactNative": "0.87.1", "godot": Engine.get_version_info().string, "displayServer": DisplayServer.get_name(),
    "bundle": bundle_file, "checks": checks, "stages": stages, "constants": {"bound": BOUND, "retryTotal": RETRY_TOTAL, "stormTotal": STORM_TOTAL},
    "journals": JOURNALS, "fatal": FATAL, "expectedOriginalFailures": expected_original_failures, "allowOriginalNegative": allow_original_negative,
    "originalNegativeObserved": original_negative_observed, "sabotage": sabotage, "allCurrentAssertionsPassed": failures.is_empty(),
    "scope": {"actualHermesRuntime": true, "actualFabricApplication": true, "realEventPath": true, "callbackExceptionsCertified": true,
      "nativeFrameCatchesCertified": false}}
  var output := FileAccess.open("res://build/js-exceptions-report.json", FileAccess.WRITE)
  if not check(output != null, "report/The callback exceptions report is saved with any normative failure visible"):
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  output.close()
  if original_negative_observed:
    print("JS_EXCEPTIONS_ORIGINAL_NEGATIVE: " + str(failures.size()))
  elif sabotage_observed:
    print("JS_EXCEPTIONS_SABOTAGE_REJECTED: " + str(failures.size()))
  elif failures.is_empty():
    print("JS_EXCEPTIONS_PASSED: " + str(checks.size()))
  else:
    print("JS_EXCEPTIONS_FAILED")
  quit(0 if failures.is_empty() or original_negative_observed or sabotage_observed else 1)
