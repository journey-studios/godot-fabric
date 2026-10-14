extends SceneTree

# GF-05 slice E. RN's setUpXHR installs URL, URLSearchParams, AbortController and AbortSignal from its own modules, and the engine the host links has
# TextEncoder, atob and btoa and no TextDecoder (the user's decision of 2026-10-13: parity with Hermes on RN iOS and Android). This probe runs the bundle in
# the actual Hermes runtime of an actual FabricApplication, mounts one root and reads what the fixture recorded: what the host and the engine define before
# any JavaScript runs, the identity of each global with the export of RN's module, the result of every case of tests/web-globals-cases.mjs, and the
# integration of the signals with the host's fetch and XMLHttpRequest, against the networking suite's local server (a child process of the runner whose ports
# arrive as a user argument). A case is judged against tests/web-globals-expected.json, the expectation the oracle derives from RN's own files run in V8, from
# Node's own encoders and from the pinned Hermes, and checks that this file still holds. tests/web-globals-oracle.mjs re-derives every verdict.
#
# This slice changes no native code, so there is no previous-host control: the sabotages (--sabotage) break the SDK's bundle in memory and the probe must reject each.
const LIMIT_MS := 30000
const SABOTAGE_LIMIT_MS := 6000
const EXPECTED_PATH := "res://tests/web-globals-expected.json"

var application: Node
var surface: Control
var checks: Array = []
var stages := {}
var sabotage := false
var bundle_file := "web-globals-probe.js"
var ports := {}
var limit_ms := LIMIT_MS
# Set when a wait runs out of its limit: the rest of the probe then fails fast instead of waiting again.
var stalled := false
var expected: Dictionary = {}
var observed: Dictionary = {}
var failed_cases: Array = []

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

func frames(count := 1) -> void:
  for index in range(count):
    await process_frame

func wait_until(condition: Callable) -> bool:
  var started := Time.get_ticks_msec()
  while not stalled and Time.get_ticks_msec() - started < limit_ms and not condition.call():
    await process_frame
  var reached: bool = condition.call()
  if not reached:
    stalled = true
  return reached

func js(expression: String) -> Variant:
  return JSON.parse_string(str(application.call("evaluate", "JSON.stringify(" + expression + ")")))

func native() -> Dictionary:
  return JSON.parse_string(application.call("snapshot"))

# --- the server, through the probe's own HTTPClient ---------------------------------

func control(path: String) -> Dictionary:
  var client := HTTPClient.new()
  client.connect_to_host("127.0.0.1", int(ports.http))
  var body := PackedByteArray()
  var sent := false
  var started := Time.get_ticks_msec()
  while Time.get_ticks_msec() - started < LIMIT_MS:
    client.poll()
    var status := client.get_status()
    if status == HTTPClient.STATUS_CONNECTED and not sent:
      sent = true
      client.request(HTTPClient.METHOD_GET, path, PackedStringArray())
    elif status == HTTPClient.STATUS_CONNECTED and sent:
      break
    elif status == HTTPClient.STATUS_BODY:
      var chunk := client.read_response_body_chunk()
      if chunk.is_empty():
        await process_frame
      body.append_array(chunk)
    elif status in [HTTPClient.STATUS_CANT_CONNECT, HTTPClient.STATUS_CANT_RESOLVE, HTTPClient.STATUS_CONNECTION_ERROR]:
      break
    else:
      await process_frame
  client.close()
  var parsed: Variant = JSON.parse_string(body.get_string_from_utf8())
  return parsed if parsed is Dictionary else {}

func server_log() -> Dictionary:
  return await control("/__control/log")

func hold_state(name: String) -> String:
  var log: Dictionary = await server_log()
  var holds: Variant = log.get("holds", {})
  return str(holds.get(name, "none")) if holds is Dictionary else "none"

func wait_for_hold(name: String, wanted: String) -> bool:
  var started := Time.get_ticks_msec()
  while not stalled and Time.get_ticks_msec() - started < limit_ms:
    if await hold_state(name) == wanted:
      return true
    await process_frame
  stalled = true
  return false

func release(name: String) -> void:
  await control("/__control/release/" + name)

# What the server recorded for a path (a prefix of the request target), in arrival order.
func records_for(log: Dictionary, prefix: String) -> Array:
  var found: Array = []
  var all: Variant = log.get("records", [])
  for record: Dictionary in all:
    if str(record.url).begins_with(prefix):
      found.append(record)
  return found

# --- judging a case against its expectation -----------------------------------------

# Deep equality of two images of JSON. An expected error without a message stands for an error of that name whose message is the engine's: it is judged by its name.
func matches(seen: Variant, wanted: Variant) -> bool:
  if wanted is Dictionary:
    if not (seen is Dictionary):
      return false
    var wanted_dictionary: Dictionary = wanted
    var seen_dictionary: Dictionary = seen
    if wanted_dictionary.get("$", "") == "error" and not wanted_dictionary.has("message"):
      return seen_dictionary.get("$", "") == "error" and seen_dictionary.get("name", null) == wanted_dictionary.get("name", "")
    if wanted_dictionary.size() != seen_dictionary.size():
      return false
    for key: Variant in wanted_dictionary:
      if not seen_dictionary.has(key) or not matches(seen_dictionary[key], wanted_dictionary[key]):
        return false
    return true
  if wanted is Array:
    if not (seen is Array):
      return false
    var wanted_array: Array = wanted
    var seen_array: Array = seen
    if wanted_array.size() != seen_array.size():
      return false
    for index in range(wanted_array.size()):
      if not matches(seen_array[index], wanted_array[index]):
        return false
    return true
  return typeof(seen) == typeof(wanted) and seen == wanted

func group_holds(group: Dictionary) -> bool:
  var ids: Array = group.ids
  var holds := not ids.is_empty()
  for id: String in ids:
    if not observed.has(id) or not expected.expected.has(id) or not matches(observed[id], expected.expected[id]):
      holds = false
      failed_cases.append(id)
  return holds

# --- the checks -----------------------------------------------------------------------

func check_host() -> void:
  var host: Dictionary = js("WebGlobalsHost")
  var first: Dictionary = js("WebGlobalsEarly.atFirstModule")
  stages.host = host
  stages.first = first
  check((host.URL == "undefined" and host.URLSearchParams == "undefined" and host.AbortController == "undefined" and host.AbortSignal == "undefined"
    and host.TextDecoder == "undefined" and host.DOMException == "undefined" and host.TextEncoder == "function" and host.atob == "function"
    and host.btoa == "function"),
    "host/The host defines none of URL, URLSearchParams, AbortController, AbortSignal and TextDecoder, and the engine defines TextEncoder, atob and btoa, before the first line of the bundle")
  check((first.URL == "undefined" and first.URLSearchParams == "undefined" and first.AbortController == "undefined" and first.AbortSignal == "undefined"
    and first.TextDecoder == "undefined" and first.TextEncoder == "function" and first.atob == "function" and first.btoa == "function"
    and first.sameEncoder == true and first.sameAtob == true and first.sameBtoa == true),
    "first/When the first module of the bundle runs, RN's polyfills have defined none of them, and the engine's encoders are still the engine's own functions")

func descriptor_is(descriptor: Variant, kind: String, writable: Variant, enumerable: bool) -> bool:
  return (descriptor is Dictionary and descriptor.kind == kind and descriptor.writable == writable and descriptor.enumerable == enumerable
    and descriptor.configurable == true)

func check_globals(env: Dictionary) -> void:
  var before: Dictionary = env.lazyBefore
  var after: Dictionary = env.lazyAfter
  var identity: Dictionary = env.identity
  check((["URL", "URLSearchParams", "AbortSignal"].all(func(name: String) -> bool:
      return descriptor_is(before.get(name), "accessor", null, true) and before[name].setter == "function")
    and descriptor_is(before.get("AbortController"), "data", true, true)
    and ["URL", "URLSearchParams", "AbortController", "AbortSignal"].all(func(name: String) -> bool: return descriptor_is(after.get(name), "data", true, true))),
    "globals/URL, URLSearchParams and AbortSignal are lazy accessors that nothing had read, AbortController is the data property the accessor becomes once the renderer read it, and all four are data properties after")
  check((identity.urlIsModuleUrl == true and identity.searchParamsIsModuleSearchParams == true and identity.searchParamsModulesAgree == true
    and identity.abortControllerIsModuleController == true and identity.abortSignalIsModulePublicSignal == true),
    "globals/URL, URLSearchParams, AbortController and AbortSignal are the exports of the modules RN's setUpXHR names")
  check((identity.publicSignalDiffersFromClass == true and identity.publicPrototypeIsClassPrototype == true and identity.controllerSignalIsClassInstance == true
    and identity.controllerSignalIsPublicInstance == true and identity.urlSearchParamsIsUrlsOwn == true),
    "globals/AbortSignal is RN's public wrapper over the class whose prototype every signal has, and URL's searchParams is a URLSearchParams")
  var before_encoding: Dictionary = env.encodingBefore
  var after_encoding: Dictionary = env.encodingAfter
  check((["TextEncoder", "atob", "btoa"].all(func(name: String) -> bool:
      return (descriptor_is(before_encoding.get(name), "data", true, false) and descriptor_is(after_encoding.get(name), "data", true, false)))
    and identity.engineEncoder == true and identity.engineAtob == true and identity.engineBtoa == true),
    "globals/TextEncoder, atob and btoa are the engine's own functions, still non-enumerable data properties of the global object, and nothing in the bundle replaced them")
  check(before_encoding.get("TextDecoder") == null and after_encoding.get("TextDecoder") == null,
    "globals/TextDecoder is not a property of the global object before or after the bundle")

func check_groups() -> void:
  for group: Dictionary in expected.groups:
    check(group_holds(group), group.check)

# --- the integration with the networking the host provides ---------------------------

func net_state() -> Dictionary:
  return js("WebGlobalsProbe.network()")

func timers_have_ended() -> bool:
  var timers: Variant = js("WebGlobalsProbe.timers()")
  return timers is Dictionary and timers.done == true

func fetch_status(name: String) -> String:
  var state: Dictionary = net_state()
  var fetches: Dictionary = state.fetches
  return str(fetches.get(name, {}).get("status", "missing"))

func network_stage() -> void:
  var net := {}
  application.call("evaluate", "WebGlobalsProbe.configure({http: %d})" % int(ports.http))
  # fetch with a signal that aborts while the server holds the request
  application.call("evaluate", "WebGlobalsProbe.startFetch('wg-fetch', '/hang/wg-fetch')")
  var held := await wait_for_hold("wg-fetch", "waiting")
  application.call("evaluate", "WebGlobalsProbe.abort('wg-fetch')")
  var settled := await wait_until(func() -> bool: return fetch_status("wg-fetch") == "done")
  var closed := await wait_for_hold("wg-fetch", "closed-by-client")
  net.fetchAbort = {"held": held, "settled": settled, "closed": closed}
  # the caller's own reason: fetch ignores it, the signal keeps it
  application.call("evaluate", "WebGlobalsProbe.startFetch('wg-reason', '/hang/wg-reason')")
  var held_reason := await wait_for_hold("wg-reason", "waiting")
  application.call("evaluate", "WebGlobalsProbe.abort('wg-reason', 'error')")
  var settled_reason := await wait_until(func() -> bool: return fetch_status("wg-reason") == "done")
  var closed_reason := await wait_for_hold("wg-reason", "closed-by-client")
  net.reasonAbort = {"held": held_reason, "settled": settled_reason, "closed": closed_reason}
  # a signal that is aborted before fetch starts
  application.call("evaluate", "WebGlobalsProbe.startFetch('wg-before', '/echo?case=wg-aborted-before', {abortFirst: true})")
  net.abortedBefore = {"settled": await wait_until(func() -> bool: return fetch_status("wg-before") == "done")}
  # a fetch that completes with a signal, aborted afterwards
  application.call("evaluate", "WebGlobalsProbe.startFetch('wg-done', '/json?case=wg-completed')")
  var done_settled := await wait_until(func() -> bool: return fetch_status("wg-done") == "done")
  application.call("evaluate", "WebGlobalsProbe.abort('wg-done')")
  await frames(3)
  net.completed = {"settled": done_settled}
  # XMLHttpRequest wired to a signal
  application.call("evaluate", "WebGlobalsProbe.startXhr('wg-xhr', '/hang/wg-xhr')")
  var held_xhr := await wait_for_hold("wg-xhr", "waiting")
  application.call("evaluate", "WebGlobalsProbe.abort('wg-xhr')")
  var xhr_done := await wait_until(func() -> bool: return js("WebGlobalsProbe.network().xhrs['wg-xhr'].ended") == true)
  var closed_xhr := await wait_for_hold("wg-xhr", "closed-by-client")
  net.xhrAbort = {"held": held_xhr, "settled": xhr_done, "closed": closed_xhr}
  # the server lets go of everything it holds; nothing more reaches JS from a request that was aborted
  var before_release: Dictionary = net_state()
  for name in ["wg-fetch", "wg-reason", "wg-xhr"]:
    await release(name)
  await frames(20)
  var after_release: Dictionary = net_state()
  net.beforeRelease = before_release
  net.afterRelease = after_release
  net.serverLog = await server_log()
  stages.network = net

func check_network() -> void:
  var net: Dictionary = stages.network
  var state: Dictionary = net.afterRelease
  var fetches: Dictionary = state.fetches
  var controllers: Dictionary = state.controllers
  var log: Dictionary = net.serverLog
  var holds: Dictionary = log.get("holds", {})
  var abort_error := {"resolved": false, "error": {"name": "AbortError", "message": "Aborted", "isError": true}}
  var fetch_entry: Dictionary = fetches.get("wg-fetch", {})
  var fetch_signal: Dictionary = controllers.get("wg-fetch", {})
  check((net.fetchAbort.held == true and net.fetchAbort.settled == true and net.fetchAbort.closed == true and fetch_entry.get("outcome") == abort_error
    and fetch_signal.get("signalEvents") == 1 and fetch_signal.get("abortedAtEvent") == true and fetch_signal.get("aborted") == true
    and holds.get("wg-fetch") == "closed-by-client"),
    "network/fetch rejects with the AbortError whose message is Aborted when its signal aborts while the server holds the request, and the connection is closed")
  var reason_entry: Dictionary = fetches.get("wg-reason", {})
  var reason_signal: Dictionary = controllers.get("wg-reason", {})
  check((net.reasonAbort.held == true and net.reasonAbort.settled == true and net.reasonAbort.closed == true and reason_entry.get("outcome") == abort_error
    and reason_signal.get("signalEvents") == 1 and reason_signal.get("reasonIsTheCallers") == true and reason_signal.get("reasonAtEvent") == "Error"
    and holds.get("wg-reason") == "closed-by-client"),
    "network/fetch ignores the reason a caller gives abort(): it rejects with the same AbortError, and the signal keeps the caller's reason")
  var before_entry: Dictionary = fetches.get("wg-before", {})
  var before_signal: Dictionary = controllers.get("wg-before", {})
  check((net.abortedBefore.settled == true and before_entry.get("outcome") == abort_error and before_signal.get("aborted") == true
    and records_for(log, "/echo?case=wg-aborted-before").is_empty()),
    "network/A signal that is already aborted rejects fetch with the same AbortError, and no request reaches the server")
  var done_entry: Dictionary = fetches.get("wg-done", {})
  var done_signal: Dictionary = controllers.get("wg-done", {})
  check((net.completed.settled == true and done_entry.get("outcome") == {"resolved": true, "status": 200.0} and done_signal.get("aborted") == true
    and done_signal.get("signalEvents") == 1 and records_for(log, "/json?case=wg-completed").size() == 1),
    "network/A fetch that completed is not changed by aborting its signal afterwards")
  var xhrs: Dictionary = state.xhrs
  var xhr_entry: Dictionary = xhrs.get("wg-xhr", {})
  var xhr_events: Array = xhr_entry.get("events", [])
  var xhr_tail: Array = xhr_events.map(func(event: Dictionary) -> Array: return [event.type, event.readyState, event.status]).slice(-3)
  check((net.xhrAbort.held == true and net.xhrAbort.settled == true and net.xhrAbort.closed == true
    and xhr_tail == [["readystatechange", 4.0, 0.0], ["abort", 4.0, 0.0], ["loadend", 4.0, 0.0]]
    and not xhr_events.any(func(event: Dictionary) -> bool: return ["load", "error", "timeout"].has(event.type))
    and controllers.get("wg-xhr", {}).get("signalEvents") == 1 and holds.get("wg-xhr") == "closed-by-client"),
    "network/An XMLHttpRequest aborted by its signal dispatches readystatechange, abort and loadend and never load or error, and the connection is closed")
  var before_state: Dictionary = net.beforeRelease
  check((before_state.fetches == state.fetches and before_state.xhrs == state.xhrs and before_state.log == state.log
    and state.log.filter(func(entry: Dictionary) -> bool: return entry.event == "fetch").size() == 4),
    "network/After the server lets go, an aborted request delivers nothing more: each fetch settled once and the events of the XMLHttpRequest did not grow")

func _initialize() -> void:
  var arguments := OS.get_cmdline_user_args()
  sabotage = arguments.has("--sabotage")
  for argument: String in arguments:
    if argument.begins_with("--bundle="):
      bundle_file = argument.trim_prefix("--bundle=")
    elif argument.begins_with("--ports="):
      var parsed: Variant = JSON.parse_string(argument.trim_prefix("--ports="))
      ports = parsed if parsed is Dictionary else {}
  limit_ms = SABOTAGE_LIMIT_MS if sabotage else LIMIT_MS
  call_deferred("run_probe")

func load_expected() -> bool:
  var file := FileAccess.open(EXPECTED_PATH, FileAccess.READ)
  if file == null:
    return false
  var parsed: Variant = JSON.parse_string(file.get_as_text())
  if not (parsed is Dictionary):
    return false
  expected = parsed
  stages.expectedSha256 = FileAccess.get_sha256(EXPECTED_PATH)
  return true

func run_probe() -> void:
  root.size = Vector2i(320, 80)
  if not check(load_expected(), "report/The expectation file the cases are judged against is there"):
    quit(1)
    return
  application = ClassDB.instantiate("FabricApplication")
  application.name = "WebGlobalsApplication"
  application.set("bundle_path", "res://build/" + bundle_file)
  root.add_child(application)
  surface = ClassDB.instantiate("FabricSurface")
  surface.name = "WebGlobalsRoot"
  surface.size = Vector2(140, 60)
  surface.set("application_path", NodePath("../WebGlobalsApplication"))
  surface.set("component_name", "WebGlobalsApp")
  root.add_child(surface)
  # The root mounts when Hermes has evaluated the bundle and run the component: wait for it, whatever the pace of the machine's frames.
  var waited := 0
  while int(native().rootCount) < 1 and waited < 600:
    await process_frame
    waited += 1
  await frames(6)
  var app := native()
  stages.mount = {"application": app, "surfaceId": surface.call("get_surface_id")}
  check(int(app.rootCount) == 1 and int(surface.call("get_surface_id")) > 0 and app.errors.is_empty(),
    "mount/A root mounts through the original AppRegistry in the Hermes application the bundle ran in")
  check_host()
  # The environment is read first: it looks at RN's lazy accessors before the first read of any of them resolves them.
  var env: Dictionary = js("WebGlobalsProbe.environment()")
  stages.environment = env
  check_globals(env)
  var results := {}
  for kind: String in ["url", "searchParams", "abort", "encoding", "decoder"]:
    var found: Variant = js("WebGlobalsProbe.run('%s')" % kind)
    results[kind] = found if found is Dictionary else {}
    observed.merge(results[kind])
  stages.cases = results
  # The cases that end on a timer: the probe waits for the last of them to settle, never for a number of frames.
  application.call("evaluate", "WebGlobalsProbe.startTimers()")
  var timers_done := await wait_until(timers_have_ended)
  var timers: Variant = js("WebGlobalsProbe.timers()")
  stages.timers = timers if timers is Dictionary else {}
  if timers_done and timers is Dictionary and timers.results is Dictionary:
    observed.merge(timers.results)
  check_groups()
  stages.failedCases = failed_cases
  await network_stage()
  check_network()
  application.call("stop")
  await frames(6)
  var stopped := native()
  var root_state: Dictionary = JSON.parse_string(surface.call("snapshot"))
  check(stopped.stopped and int(stopped.rootCount) == 0 and stopped.errors.is_empty(), "lifecycle/Stop releases the root without a diagnostic")
  check(int(root_state.nativeTags) == 0 and int(root_state.creates) == int(root_state.deletes), "lifecycle/All native Controls of the root are balanced")
  stages.stop = {"application": stopped, "root": root_state}
  await finish()

func finish() -> void:
  surface.queue_free()
  application.queue_free()
  await frames(2)
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var sabotage_observed := sabotage and not failures.is_empty()
  var report := {"scenario": "native-web-globals", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "bundle": bundle_file, "checks": checks, "stages": stages, "sabotage": sabotage,
    "allCurrentAssertionsPassed": failures.is_empty(),
    "scope": {"actualHermesRuntime": true, "actualFabricApplication": true, "nativeCodeChanged": false, "previousHostControl": "not applicable: this slice changes no native code",
      "rnModules": ["setUpXHR", "URL", "URLSearchParams", "AbortController", "AbortSignal", "fetch", "XMLHttpRequest"], "engineBuiltins": ["TextEncoder", "atob", "btoa"],
      "textDecoderAbsent": true}}
  var output := FileAccess.open("res://build/web-globals-report.json", FileAccess.WRITE)
  if not check(output != null, "report/The web globals report is saved with any normative failure visible"):
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  output.close()
  if sabotage_observed:
    print("WEB_GLOBALS_SABOTAGE_REJECTED: " + str(failures.size()))
  elif failures.is_empty():
    print("WEB_GLOBALS_PASSED: " + str(checks.size()))
  else:
    print("WEB_GLOBALS_FAILED")
  quit(0 if failures.is_empty() or sabotage_observed else 1)
