extends SceneTree

# GF-05 slice C. RN's error path runs in the host: the error-guard polyfill's ErrorUtils, RN's setUpErrorHandling and ExceptionsManager over
# the NativeExceptionsManager module of the host, and the JsErrorHandler (ReactCommon/jserrorhandler) with the five globals ReactInstance
# installs over it. This probe runs one bundle in three actual Hermes applications, each in a scenario of its own:
#   ready   the default: a root mounts, and each case of the fixture's list is run (soft and fatal errors, the RuntimeScheduler's catch site);
#   early   errors are reported while the bundle is still being evaluated, before the runtime is ready: RN$handleException takes them into C++;
#   escape  an error escapes the evaluation of the bundle.
# It reads what the fixture recorded and the host's own counters (snapshot().jsErrors, errors). tests/js-errors-oracle.mjs re-derives every
# verdict from RN's sources and from RN's own JavaScript run in V8. The fatal cases make the host record a failure on purpose
# (FABRIC_ERROR); tests/js-errors-native.test.mjs accepts those lines, and only those.
var checks: Array = []
var stages := {}
var expected_original_failures: Array = []
var allow_original_negative := false
var sabotage := false
var bundle_file := "js-errors-probe.js"
var nodes: Array = []

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

# A normative check needs what this slice changed in the host: the host without RN's error path must fail exactly these checks, while the same
# bundle holds every other one.
func host_check(condition: bool, name: String) -> bool:
  expected_original_failures.append(name)
  return check(condition, name)

func settle(count := 6) -> void:
  for index in range(count):
    await process_frame

func js(application: Node, expression: String) -> Variant:
  return JSON.parse_string(str(application.call("evaluate", "JSON.stringify(" + expression + ")")))

# js() for an application that is running: one whose bundle did not evaluate has stopped itself, and a call into it would only add a failure
# of its own to the record (a lane that breaks the bundle on purpose reads nothing, and every check says so).
func js_if(alive: bool, application: Node, expression: String) -> Variant:
  return js(application, expression) if alive else null

func snap(application: Node) -> Dictionary:
  return JSON.parse_string(application.call("snapshot"))

# value[path[0]][path[1]]..., or the fallback where the report is not what the check expects (a lane that did not run, a host without the field).
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

func start_lane(label: String, scenario: String) -> Dictionary:
  var application: Node = ClassDB.instantiate("FabricApplication")
  application.name = "JsErrors" + label + "Application"
  application.set("bundle_path", "res://build/" + bundle_file)
  application.set_meta("scenario", scenario)
  root.add_child(application)
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = "JsErrors" + label + "Root"
  surface.size = Vector2(140, 60)
  surface.set("application_path", NodePath("../" + application.name))
  surface.set("component_name", "JsErrorsApp")
  root.add_child(surface)
  nodes.append(surface)
  nodes.append(application)
  return {"application": application, "surface": surface}

# The root mounts when Hermes has evaluated the bundle and run the component: wait for it, whatever the pace of the machine's frames.
func wait_mounted(lane: Dictionary) -> void:
  var waited := 0
  while int(snap(lane.application).get("rootCount", 0)) < 1 and waited < 600:
    await process_frame
    waited += 1
  await settle()

# An application whose bundle did not evaluate stops itself.
func wait_stopped(lane: Dictionary) -> void:
  var waited := 0
  while not bool(snap(lane.application).get("stopped", false)) and waited < 600:
    await process_frame
    waited += 1
  await settle()

func journal(snapshot: Dictionary) -> Dictionary:
  return snapshot.get("jsErrors", {})

# How many reports of this route and kind the host counted between two snapshots of the application.
func counted(case_record: Dictionary, route: String, kind: String) -> int:
  return int(dig(case_record, ["after", route, kind], 0)) - int(dig(case_record, ["before", route, kind], 0))

func run_case(lane: Dictionary, name: String) -> Dictionary:
  var before := snap(lane.application)
  var result: Variant = js(lane.application, "JsErrorsProbe.runCase(%s)" % JSON.stringify(name))
  await settle(2)
  var after := snap(lane.application)
  var errors_before: Array = before.get("errors", [])
  var errors_after: Array = after.get("errors", [])
  return {"result": result, "before": journal(before), "after": journal(after), "errors": errors_after.slice(errors_before.size())}

func case_steps(case_record: Dictionary) -> Array:
  return dig(case_record, ["result", "steps"], [])

func case_reports(case_record: Dictionary) -> Array:
  return dig(case_record, ["result", "reports"], [])

func case_logged(case_record: Dictionary) -> Array:
  return dig(case_record, ["result", "logged"], [])

func no_step_threw(case_record: Dictionary) -> bool:
  var steps := case_steps(case_record)
  return not steps.is_empty() and steps.all(func(step: Dictionary) -> bool: return step.threw == false)

# The reports of the module's JS wrapper: one, of this kind and message (and name, null where RN gives none).
func reported_once(case_record: Dictionary, fatal: bool, message: String, name: Variant) -> bool:
  var reports := case_reports(case_record)
  return (reports.size() == 1 and reports[0].isFatal == fatal and reports[0].message == message and reports[0].name == name
    and reports[0].stack.size() > 0)

# The host counted the same report: its kind and message, the frames of the stack and the id RN gave it.
func native_saw(case_record: Dictionary, fatal: bool, message: String) -> bool:
  var reports := case_reports(case_record)
  var seen: Array = dig(case_record, ["after", "reports"], [])
  if reports.size() != 1 or seen.is_empty():
    return false
  var last: Dictionary = seen[seen.size() - 1]
  return (last.origin == "module" and last.fatal == fatal and last.message == message and int(last.frames) == reports[0].stack.size()
    and int(last.id) == int(reports[0].id) and counted(case_record, "module", "fatal" if fatal else "soft") == 1
    and counted(case_record, "module", "soft" if fatal else "fatal") == 0 and counted(case_record, "handler", "soft") == 0
    and counted(case_record, "handler", "fatal") == 0)

# What the hook of the host's logging received: this message at this level, once (the console's own line, which RN's polyfill sends).
func logged_once(case_record: Dictionary, message: String, level: int) -> bool:
  var lines := case_logged(case_record).filter(func(entry: Dictionary) -> bool: return entry.message == message)
  return lines.size() == 1 and int(lines[0].level) == level

# The failure the host recorded for a fatal exception: the message, ", stack:" and a "method@file:line:column" line per frame of the stack.
func failure_text(text: String, message: String, frames: int) -> bool:
  var prefix := message + ", stack:\n"
  if not text.begins_with(prefix):
    return false
  var lines := Array(text.substr(prefix.length()).split("\n", false))
  if lines.size() != frames or frames == 0:
    return false
  var pattern := RegEx.create_from_string("^.*@.+:-?\\d+(:\\d+)?$")
  return lines.all(func(line: String) -> bool: return pattern.search(line) != null)

# One host failure, for the fatal exception its JS wrapper reported: nothing else was recorded.
func failed_once(case_record: Dictionary, message: String) -> bool:
  var reports := case_reports(case_record)
  var errors: Array = case_record.get("errors", [])
  return (reports.size() == 1 and reports[0].isFatal == true and errors.size() == 1
    and failure_text(errors[0], message, reports[0].stack.size()) and native_saw(case_record, true, message))

func check_ready(lane: Dictionary) -> void:
  var application: Node = lane.application
  var mounted := snap(application)
  stages.mount = {"application": mounted, "surfaceId": lane.surface.call("get_surface_id")}
  check(int(mounted.get("rootCount", 0)) == 1 and int(lane.surface.call("get_surface_id")) > 0 and mounted.get("errors", []).is_empty(),
    "mount/The ready lane mounts a root through the original AppRegistry without a diagnostic")
  var alive := int(mounted.get("rootCount", 0)) == 1 and not bool(mounted.get("stopped", false))
  var host: Variant = js_if(alive, application, "JsErrorsHost")
  var first: Variant = js_if(alive, application, "JsErrorsEarly.atFirstModule")
  var environment: Variant = js_if(alive, application, "JsErrorsProbe.environment()")
  stages.host = host
  stages.first = first
  stages.environment = environment
  var read_only_attributes := {"writable": false, "enumerable": false, "configurable": false}
  var globals: Variant = dig(host, ["globals"], {})
  var read_only := func(name: String, length: int) -> bool:
    var entry: Variant = dig(globals, [name], {})
    return (dig(entry, ["type"]) == "function" and int(dig(entry, ["length"], -1)) == length and dig(entry, ["descriptor"]) == read_only_attributes)
  # RN$useAlwaysAvailableJSErrorHandling is the flag's value, not a function: false, the pinned default.
  var flag_value := func() -> bool:
    var entry: Variant = dig(globals, ["RN$useAlwaysAvailableJSErrorHandling"], {})
    return (dig(entry, ["type"]) == "boolean" and dig(entry, ["value"]) == false and dig(entry, ["descriptor"]) == read_only_attributes)
  var absent := func(name: String) -> bool:
    return dig(globals, [name, "type"]) == "undefined"
  host_check((flag_value.call() and read_only.call("RN$isRuntimeReady", 0) and read_only.call("RN$inExceptionHandler", 0)
    and read_only.call("RN$handleException", 3) and read_only.call("RN$registerExceptionListener", 1)
    and ["RN$hasHandledFatalException", "RN$notifyOfFatalException"].all(absent)),
    "host/The host installs the five globals of ReactInstance's error family that keep a runtime running as ReactInstance defines them, and neither RN$hasHandledFatalException nor RN$notifyOfFatalException")
  check((dig(host, ["errorUtils"]) == "undefined" and dig(host, ["console"]) == "undefined" and dig(first, ["errorUtils"]) == "object"
    and dig(first, ["defaultHandlerType"]) == "function" and dig(first, ["defaultHandlerRethrows"]) == "js-errors default handler"
    and dig(first, ["consoleErrorOriginal"]) == "undefined"),
    "first/RN's error-guard polyfill has run when the first module of the bundle starts, and setUpErrorHandling has not")
  var members := ["applyWithGuard", "applyWithGuardIfNeeded", "getGlobalHandler", "guard", "inGuard", "reportError", "reportFatalError", "setGlobalHandler"]
  var utils: Variant = dig(environment, ["errorUtils"], {})
  check((dig(utils, ["type"]) == "object" and dig(utils, ["names"]) == members
    and members.all(func(name: String) -> bool: return dig(utils, ["kinds", name]) == "function") and dig(utils, ["sameAsVendor"]) == true),
    "errorutils/ErrorUtils has the members of RN's error-guard polyfill and is the module RN reads through Libraries/vendor/core/ErrorUtils")
  var handler: Variant = dig(environment, ["handler"], {})
  var console_state: Variant = dig(environment, ["console"], {})
  check((dig(handler, ["type"]) == "function" and dig(handler, ["name"]) == "handleError" and int(dig(handler, ["length"], -1)) == 2
    and int(dig(handler, ["setCalls"], -1)) == 1 and dig(handler, ["isTheOneSet"]) == true and dig(handler, ["isThePolyfillDefault"]) == false
    and dig(console_state, ["errorOriginal"]) == "function" and dig(console_state, ["errorIsOriginal"]) == false
    and dig(console_state, ["errorName"]) == "reactConsoleErrorHandler"),
    "handler/ErrorUtils.getGlobalHandler() is the handler setUpErrorHandling registered, once, and console.error is ExceptionsManager's reporter")

  var cases := {}
  var names: Variant = js_if(alive, application, "JsErrorsProbe.caseNames")
  for name: Variant in (names if names is Array else []):
    cases[str(name)] = await run_case(lane, str(name))
  # An exception that escapes a task of RN's RuntimeScheduler.
  var task_before := snap(application)
  js_if(alive, application, "JsErrorsProbe.scheduleTask()")
  var task_state: Variant = {}
  var waited := 0
  while alive and waited < 600 and not (task_state is Dictionary and task_state.get("done", false) == true):
    await process_frame
    waited += 1
    task_state = js(application, "JsErrorsProbe.taskState()")
  await settle(2)
  var task_after := snap(application)
  var task_errors_before: Array = task_before.get("errors", [])
  var task_errors_after: Array = task_after.get("errors", [])
  var task_case := {"result": dig(task_state, ["result"]), "before": journal(task_before), "after": journal(task_after),
    "errors": task_errors_after.slice(task_errors_before.size())}
  cases["scheduler-task"] = task_case
  stages.cases = cases

  var soft_string: Dictionary = cases.get("console-string", {})
  var soft_error: Dictionary = cases.get("console-error", {})
  var soft_multi: Dictionary = cases.get("console-multi", {})
  host_check((no_step_threw(soft_string) and reported_once(soft_string, false, "console.error: js-errors console string", "console.error")
    and native_saw(soft_string, false, "console.error: js-errors console string") and logged_once(soft_string, "js-errors console string", 3)
    and soft_string.errors.is_empty()
    and no_step_threw(soft_error) and reported_once(soft_error, false, "Error: js-errors console error object", "Error")
    and native_saw(soft_error, false, "Error: js-errors console error object") and soft_error.errors.is_empty()
    and no_step_threw(soft_multi) and reported_once(soft_multi, false, "console.error: js-errors 7 {\"a\":1}", "console.error")
    and native_saw(soft_multi, false, "console.error: js-errors 7 {\"a\":1}") and soft_multi.errors.is_empty()),
    "soft/console.error goes through ExceptionsManager to NativeExceptionsManager.reportException with isFatal false, is logged, and records no failure")
  var warning: Dictionary = cases.get("console-warning", {})
  check((no_step_threw(warning) and case_reports(warning).is_empty() and logged_once(warning, "Warning: js-errors react warning", 2)
    and counted(warning, "module", "soft") == 0 and counted(warning, "module", "fatal") == 0 and warning.get("errors", [0]).is_empty()),
    "soft/A console.error whose message starts with \"Warning: \" is logged at the warning level and reported to nothing")
  var report_error: Dictionary = cases.get("report-error", {})
  var report_string: Dictionary = cases.get("report-error-string", {})
  host_check((no_step_threw(report_error) and reported_once(report_error, false, "Error: js-errors ErrorUtils.reportError", "Error")
    and native_saw(report_error, false, "Error: js-errors ErrorUtils.reportError")
    and logged_once(report_error, "[Error: js-errors ErrorUtils.reportError]", 3) and report_error.errors.is_empty()
    and no_step_threw(report_string) and reported_once(report_string, false, "js-errors ErrorUtils.reportError string", null)
    and native_saw(report_string, false, "js-errors ErrorUtils.reportError string") and report_string.errors.is_empty()),
    "soft/ErrorUtils.reportError reports a soft exception once, for an Error and for a thrown string, logs the error once and records no failure")
  var guard: Dictionary = cases.get("guard", {})
  var guard_steps := case_steps(guard)
  host_check((no_step_threw(guard) and guard_steps.size() == 3 and guard_steps[0].value == false and guard_steps[1].value == null
    and guard_steps[2].value == false and dig(guard, ["result", "observed", "inGuard"]) == true
    and reported_once(guard, false, "Error: js-errors applyWithGuard", "Error") and native_saw(guard, false, "Error: js-errors applyWithGuard")
    and guard.errors.is_empty()),
    "soft/ErrorUtils.applyWithGuard reports the error it catches as a soft exception and returns null, and inGuard is true inside the call only")

  var fatal_error: Dictionary = cases.get("fatal-error", {})
  var fatal_string: Dictionary = cases.get("fatal-string", {})
  host_check((no_step_threw(fatal_error) and failed_once(fatal_error, "Error: js-errors reportFatalError")
    and no_step_threw(fatal_string) and failed_once(fatal_string, "js-errors thrown string")),
    "fatal/ErrorUtils.reportFatalError reaches reportException with isFatal true and records exactly one host failure, with the message and the parsed stack")
  var task_result_reports: Array = dig(task_state, ["result", "reports"], [])
  var task_failed := false
  if task_result_reports.size() == 1:
    var task_failures: Array = task_case.get("errors", [])
    # RN's RuntimeScheduler catches jsi::JSError and then std::exception, and Hermes' errors are the second kind in this linkage
    # (native/js_error_path.cpp, js_error_of): the scheduler hands its handler "Non-js exception: " and what() of the error.
    var task_message: String = task_result_reports[0].message
    task_failed = (task_result_reports[0].isFatal == true and task_failures.size() == 1
      and task_message.begins_with("Error: Non-js exception: js-errors scheduler task\n\nError: js-errors scheduler task")
      and failure_text(task_failures[0], task_message, task_result_reports[0].stack.size())
      and counted(task_case, "module", "fatal") == 1 and counted(task_case, "module", "soft") == 0
      and counted(task_case, "handler", "fatal") == 0 and counted(task_case, "handler", "soft") == 0)
  host_check(task_failed,
    "fatal/An exception that escapes a task of RN's RuntimeScheduler reaches ErrorUtils as a fatal error and records exactly one host failure")

  var deprecated: Dictionary = cases.get("deprecated-soft", {})
  var direct: Dictionary = cases.get("direct", {})
  var direct_steps := case_steps(direct)
  var deprecated_seen: Array = dig(deprecated, ["after", "reports"], [])
  var direct_seen: Array = dig(direct, ["after", "reports"], [])
  var last_deprecated: Dictionary = deprecated_seen[deprecated_seen.size() - 1] if not deprecated_seen.is_empty() else {}
  var last_direct: Dictionary = direct_seen[direct_seen.size() - 1] if not direct_seen.is_empty() else {}
  host_check((no_step_threw(deprecated) and deprecated.errors.is_empty() and counted(deprecated, "module", "soft") == 1
    and last_deprecated.get("origin") == "module" and last_deprecated.get("fatal") == false
    and last_deprecated.get("message") == "js-errors deprecated reportSoftException" and int(last_deprecated.get("frames", 0)) == 1
    and int(last_deprecated.get("id", 0)) == 42
    and no_step_threw(direct) and direct.errors.is_empty() and direct_steps.size() == 2 and direct_steps[1].value == null
    and counted(direct, "module", "soft") == 1 and last_direct.get("message") == "js-errors direct reportException"
    and int(last_direct.get("frames", 0)) == 1 and int(last_direct.get("id", 0)) == 43 and last_direct.get("fatal") == false),
    "module/The deprecated reportSoftException, a direct reportException and dismissRedbox answer as RN's iOS and Android modules do: a soft exception is logged and never a failure")
  var handle_ready: Dictionary = cases.get("handle-ready", {})
  var handle_steps := case_steps(handle_ready)
  host_check((no_step_threw(handle_ready) and handle_steps.size() == 3 and handle_steps[0].value == false and handle_steps[1].value == false
    and handle_steps[2].value == true and case_reports(handle_ready).is_empty() and handle_ready.errors.is_empty() and counted(handle_ready, "handler", "soft") == 0
    and counted(handle_ready, "module", "soft") == 0),
    "ready/Once the bundle has evaluated, RN$isRuntimeReady says so, RN$handleException hands the error back to JS and nothing is in the middle of reporting")
  var refused: Dictionary = cases.get("arguments", {})
  var refused_steps := case_steps(refused)
  host_check((refused_steps.size() == 3 and refused_steps.all(func(step: Dictionary) -> bool: return step.threw == true)
    and refused_steps[0].error.contains("handleException requires 3 arguments: error, isFatal, logToConsole (optional)")
    and refused_steps[1].error.contains("registerExceptionListener: requires 1 argument: fn")
    and refused_steps[2].error.contains("registerExceptionListener: The first argument must be a function")),
    "ready/RN$handleException and RN$registerExceptionListener refuse the calls ReactInstance refuses, with its messages")

  var settled := snap(application)
  var totals: Dictionary = journal(settled)
  var module_soft := int(dig(totals, ["module", "soft"], -1))
  var module_fatal := int(dig(totals, ["module", "fatal"], -1))
  var failures: Array = settled.get("errors", [])
  var fatal_messages := ["Error: js-errors reportFatalError", "js-errors thrown string", "Error: Non-js exception: js-errors scheduler task"]
  host_check((totals.get("runtimeReady") == true and totals.get("handledFatalError") == false and totals.get("inHandler") == false
    and int(totals.get("listeners", -1)) == 0 and int(dig(totals, ["handler", "soft"], -1)) == 0 and int(dig(totals, ["handler", "fatal"], -1)) == 0
    and module_fatal == 3 and module_soft == 8 and failures.size() == 3
    and failures.size() == fatal_messages.size() and range(3).all(func(index: int) -> bool: return failures[index].begins_with(fatal_messages[index]))),
    "native/The host counted what reached it by route: eight soft and three fatal reports from ExceptionsManager, none from the C++ pipeline, and a failure for each fatal one only")
  stages.settled = settled

# The early lane: the fixture reported errors while the bundle was still being evaluated.
func check_early(lane: Dictionary) -> void:
  var application: Node = lane.application
  var mounted := snap(application)
  stages.early_mount = mounted
  check(int(mounted.get("rootCount", 0)) == 1 and int(lane.surface.call("get_surface_id")) > 0,
    "early-mount/The early lane mounts a root: an error handled while the bundle evaluates does not stop the application")
  var alive := int(mounted.get("rootCount", 0)) == 1 and not bool(mounted.get("stopped", false))
  var recorded: Variant = js_if(alive, application, "JsErrorsEarlyLane")
  stages.early_lane = recorded
  var late := await run_case(lane, "handle-ready") if alive else {}
  stages.early_late = late
  var early_cases: Array = dig(recorded, ["cases"], [])
  var by_name := {}
  for entry: Variant in early_cases:
    by_name[entry.name] = entry
  var seen_one := func(name: String, message: String, fatal: bool) -> bool:
    var seen: Array = dig(by_name, [name, "seen"], [])
    return (seen.size() == 1 and seen[0].message == message and seen[0].isFatal == fatal and seen[0].preventDefault == "function"
      and seen[0].inHandler == true and int(seen[0].stack) > 0 and seen[0].isComponentError == false)
  var no_report := func(name: String) -> bool:
    return dig(by_name, [name, "reports"], [0]).is_empty()
  host_check((dig(recorded, ["registered", "threw"]) == false and early_cases.size() == 6
    and seen_one.call("soft", "[runtime not ready]: Error: js-errors early soft", false)
    and seen_one.call("prevented", "[runtime not ready]: Error: js-errors early prevented", false)
    and seen_one.call("warn", "[runtime not ready]: Error: js-errors early warn", false)
    and seen_one.call("direct", "[runtime not ready]: Error: js-errors early direct", false)
    and seen_one.call("fatal", "[runtime not ready]: Error: js-errors early fatal", true)
    and seen_one.call("fatal-again", "[runtime not ready]: Error: js-errors early fatal again", true)
    and dig(by_name, ["direct", "steps", 0, "value"]) == true
    and ["soft", "prevented", "warn", "direct", "fatal", "fatal-again"].all(no_report)
    and dig(recorded, ["inHandlerAfter", "value"]) == false),
    "early/A listener registered with RN$registerExceptionListener sees each error RN$handleException takes into C++, with RN's data and RN$inExceptionHandler true, and RN$handleException answers true")
  var settled := snap(application)
  var totals: Dictionary = journal(settled)
  var failures: Array = settled.get("errors", [])
  var reports: Array = totals.get("reports", [])
  var logged_by_handler := reports.filter(func(entry: Dictionary) -> bool: return entry.origin == "handler" and entry.fatal == false)
  host_check((int(dig(totals, ["handler", "soft"], -1)) == 3 and int(dig(totals, ["handler", "fatal"], -1)) == 1
    and int(dig(totals, ["module", "soft"], -1)) == 0 and int(dig(totals, ["module", "fatal"], -1)) == 0
    and logged_by_handler.size() == 3
    and logged_by_handler[0].message == "[runtime not ready]: Error: js-errors early soft"
    and logged_by_handler[1].message == "[runtime not ready]: Error: js-errors early direct"
    and logged_by_handler[2].message == "[runtime not ready]: Error: js-errors ready direct"
    and failures.size() == 1 and failures[0].begins_with("[runtime not ready]: Error: js-errors early fatal, stack:\n")),
    "early/JsErrorHandler's pipeline logs the soft errors no listener prevented, skips the warn, and records the first fatal error as a failure, with the runtime-not-ready prefix, and not the second")
  host_check((totals.get("runtimeReady") == false and totals.get("handledFatalError") == true and totals.get("inHandler") == false
    and no_step_threw(late) and case_steps(late).size() == 3 and case_steps(late)[0].value == true and case_steps(late)[1].value == false
    and case_steps(late)[2].value == false),
    "early/A fatal error handled while the bundle evaluates leaves the runtime not ready: RN$isRuntimeReady says so, and RN$handleException keeps taking errors into C++")
  stages.early_settled = settled

func check_escape(lane: Dictionary) -> void:
  var stopped := snap(lane.application)
  stages.escape = {"application": stopped, "surfaceId": lane.surface.call("get_surface_id")}
  var failures: Array = stopped.get("errors", [])
  var totals: Dictionary = journal(stopped)
  host_check((int(lane.surface.call("get_surface_id")) == 0 and int(stopped.get("rootCount", -1)) == 0 and int(stopped.get("bundleEvaluations", -1)) == 0
    and stopped.get("stopped") == true and failures.size() == 1
    and failures[0].begins_with("[runtime not ready]: Error: js-errors escaped the bundle, stack:\n")
    and int(dig(totals, ["handler", "fatal"], -1)) == 1 and totals.get("runtimeReady") == false and totals.get("handledFatalError") == true),
    "escape/An error that escapes the evaluation of the bundle is reported by JsErrorHandler while the runtime is not ready, is the application's one failure, and nothing mounts")

func _initialize() -> void:
  var arguments := OS.get_cmdline_user_args()
  allow_original_negative = arguments.has("--allow-original-negative")
  sabotage = arguments.has("--sabotage")
  for argument: String in arguments:
    if argument.begins_with("--bundle="):
      bundle_file = argument.trim_prefix("--bundle=")
  call_deferred("run_probe")

func run_probe() -> void:
  root.size = Vector2i(320, 80)
  var ready_lane := start_lane("Ready", "react")
  await wait_mounted(ready_lane)
  await check_ready(ready_lane)
  ready_lane.application.call("stop")
  await settle()
  var stopped := snap(ready_lane.application)
  var stopped_failures: Array = stopped.get("errors", [])
  var settled_failures: Array = dig(stages, ["settled", "errors"], [])
  var root_state: Dictionary = JSON.parse_string(ready_lane.surface.call("snapshot"))
  check(stopped.get("stopped", false) == true and int(stopped.get("rootCount", -1)) == 0 and stopped_failures.size() == settled_failures.size()
    and int(root_state.get("nativeTags", -1)) == 0 and int(root_state.get("creates", 0)) == int(root_state.get("deletes", -1)),
    "lifecycle/Stop releases the root without a further diagnostic, and all native Controls of the root are balanced")
  stages.stop = {"application": stopped, "root": root_state}

  var early_lane := start_lane("Early", "js-errors-early")
  await wait_mounted(early_lane)
  await check_early(early_lane)
  early_lane.application.call("stop")
  await settle()
  var early_stopped := snap(early_lane.application)
  var early_settled_failures: Array = dig(stages, ["early_settled", "errors"], [])
  var early_errors: Array = early_stopped.get("errors", [])
  check(early_stopped.get("stopped", false) == true and int(early_stopped.get("rootCount", -1)) == 0 and early_errors.size() == early_settled_failures.size(),
    "early-lifecycle/Stop releases the early lane's root without a further diagnostic")
  stages.early_stop = early_stopped

  var escape_lane := start_lane("Escape", "js-errors-escape")
  await wait_stopped(escape_lane)
  check_escape(escape_lane)
  await finish()

func finish() -> void:
  for node: Node in nodes:
    if is_instance_valid(node):
      node.queue_free()
  await settle(2)
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var observed := failures.duplicate()
  var expected := expected_original_failures.duplicate()
  observed.sort()
  expected.sort()
  var original_negative_observed := allow_original_negative and observed == expected and not failures.is_empty()
  var sabotage_observed := sabotage and not failures.is_empty()
  var report := {"scenario": "native-js-errors", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "bundle": bundle_file, "checks": checks, "stages": stages,
    "expectedOriginalFailures": expected_original_failures, "allowOriginalNegative": allow_original_negative,
    "originalNegativeObserved": original_negative_observed, "sabotage": sabotage,
    "allCurrentAssertionsPassed": failures.is_empty(),
    "scope": {"actualHermesRuntime": true, "actualFabricApplication": true, "lanes": ["ready", "early", "escape"],
      "rnModules": ["error-guard", "setUpErrorHandling", "ExceptionsManager"], "jsErrorHandler": true, "timerCallbackExceptionsCertified": false}}
  var output := FileAccess.open("res://build/js-errors-report.json", FileAccess.WRITE)
  if not check(output != null, "report/The JS errors report is saved with any normative failure visible"):
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  output.close()
  if original_negative_observed:
    print("JS_ERRORS_ORIGINAL_NEGATIVE: " + str(failures.size()))
  elif sabotage_observed:
    print("JS_ERRORS_SABOTAGE_REJECTED: " + str(failures.size()))
  elif failures.is_empty():
    print("JS_ERRORS_PASSED: " + str(checks.size()))
  else:
    print("JS_ERRORS_FAILED")
  quit(0 if failures.is_empty() or original_negative_observed or sabotage_observed else 1)
