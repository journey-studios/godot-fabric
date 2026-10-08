extends SceneTree

# The machinery of tests/images-network-probe.gd, which drives RN's own Image over the host's network image pipeline: the checks and
# their report, waits for a state, the application's and the loader's snapshots, the suite's server through the probe's own HTTPClient
# (its log, marks, holds), the clock the application runs on and the loader's job records, kept whole. Nothing here knows what a
# stage certifies.
const SCALE := 2.0
const LIMIT_MS := 30000
const TRUST_META := "validation_tls_trusted_authorities"
const OFFSET_META := "validation_clock_offset_ms"
const FIXTURE_DIR := "res://tests/fixtures/images/"
const MEMORY := Node.NOTIFICATION_OS_MEMORY_WARNING
const ABSENT := "<absent>"

var application: Node
var surface: Control
var checks: Array = []
var stages: Dictionary = {}
var expected_original_failures: Array = []
var allow_original_negative := false
var sabotage := false
var ports: Dictionary = {}
var authority := ""
var manifest: Dictionary = {}
var inputs: Dictionary = {}
var declared: Array = []
# Set when a wait runs out of its limit: the rest of the probe then fails fast instead of waiting again.
var stalled := false
# The clock offset the validation run has moved the application's clocks by, and every job record seen so far (the loader keeps 256).
var offset_ms := 0.0
var jobs_seen: Dictionary = {}
var last_job := 0
var ops: Array = []

func check(condition: bool, name: String, normative: bool = false) -> bool:
  checks.append({"name": name, "passed": condition})
  if normative:
    expected_original_failures.append(name)
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

func frames(count: int = 1) -> void:
  for index in range(count):
    await process_frame

func wait_until(predicate: Callable, limit_ms: int = LIMIT_MS) -> bool:
  var started := Time.get_ticks_msec()
  while not stalled and Time.get_ticks_msec() - started < limit_ms and not predicate.call():
    await process_frame
  var reached: bool = predicate.call()
  if not reached:
    stalled = true
  return reached

func js_json(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(" + expression + ")"))

func react() -> Dictionary:
  var value: Variant = js_json("ImagesNetwork.snapshot()")
  return value if value is Dictionary else {}

func run_js(expression: String) -> void:
  application.call("evaluate", "ImagesNetwork." + expression)

func native(target: Object) -> Dictionary:
  var value: Variant = JSON.parse_string(target.call("snapshot"))
  return value if value is Dictionary else {}

func section(value: Dictionary, key: String) -> Dictionary:
  var inner: Variant = value.get(key, {})
  return inner if inner is Dictionary else {}

func loader() -> Dictionary:
  return section(native(application), "images")

func counters() -> Dictionary:
  return section(loader(), "counters")

func network() -> Dictionary:
  return section(loader(), "network")

func caches() -> Dictionary:
  return section(loader(), "caches")

func number(value: Dictionary, key: String) -> int:
  return int(value.get(key, 0))

# Every request the loader has accepted has ended, and nothing is waiting to start, downloading, decoding or being told.
func idle(expected_requests: int = 0) -> bool:
  var state := loader()
  var done := section(state, "counters")
  var net := section(state, "network")
  return (int(state.get("pending", 1)) == 0 and int(state.get("inFlight", 1)) == 0 and int(state.get("finished", 1)) == 0
    and int(state.get("ready", 1)) == 0 and number(state, "fresh") == 0 and number(state, "downloading") == 0
    and number(net, "queued") == 0 and number(net, "active") == 0 and int(done.get("requested", 0)) >= expected_requests)

func errors() -> Array:
  return native(application).get("errors", [])

func node_of(test_id: String) -> Dictionary:
  for entry: Dictionary in native(surface).get("nodes", []):
    if entry.testID == test_id:
      return entry
  return {}

func view(id: String) -> Dictionary:
  return node_of(id).get("image", {})

func picture(id: String) -> Dictionary:
  var value: Variant = view(id).get("image", null)
  return value if value is Dictionary else {}

func log_of(id: String) -> Array:
  return react().get("logs", {}).get(id, [])

func types_of(id: String) -> Array:
  var out: Array = []
  for event: Dictionary in log_of(id):
    out.append(event.type)
  return out

func event_of(id: String, type: String) -> Dictionary:
  for event: Dictionary in log_of(id):
    if event.type == type:
      return event
  return {}

func events_of(id: String, type: String) -> Array:
  return log_of(id).filter(func(event: Dictionary) -> bool: return event.type == type)

func ended(id: String) -> bool:
  return types_of(id).has("loadEnd")

func fingerprint(path: String) -> String:
  return String(manifest.get("files", {}).get(path, {}).get("fingerprint", "?"))

func rect(value: Variant) -> Array:
  if not value is Dictionary:
    return []
  return [float(value.x), float(value.y), float(value.width), float(value.height)]

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

func mark(label: String) -> void:
  await control("/__control/mark/" + label)

# The requests the server has recorded for a path and query, as the client sent them (whatever the host or the method).
func requests_for(target: String) -> Array:
  var log: Dictionary = await server_log()
  return log.get("records", []).filter(func(row: Dictionary) -> bool: return String(row.url) == target)

func hold_state(name: String) -> String:
  var log: Dictionary = await server_log()
  return str(section(log, "holds").get(name, "none"))

func wait_for_hold(name: String, wanted: String) -> bool:
  var started := Time.get_ticks_msec()
  while not stalled and Time.get_ticks_msec() - started < LIMIT_MS:
    if await hold_state(name) == wanted:
      return true
    await process_frame
  stalled = true
  return false

func release(name: String) -> void:
  await control("/__control/release/" + name)

func advance(milliseconds: float) -> void:
  offset_ms += milliseconds
  application.set_meta(OFFSET_META, offset_ms)

# --- the loader's job records, kept whole -------------------------------------------

func collect_jobs() -> void:
  for job: Dictionary in loader().get("jobs", []):
    jobs_seen[int(job.id)] = job
    last_job = maxi(last_job, int(job.id))

func jobs_since(id: int) -> Array:
  collect_jobs()
  var out: Array = []
  for key: int in jobs_seen:
    if key > id:
      out.append(jobs_seen[key])
  return out

func mount_surface(name: String, component: String, position: Vector2, size: Vector2, props: Dictionary) -> Control:
  var made: Control = ClassDB.instantiate("FabricSurface")
  made.name = name
  made.position = position
  made.size = size
  made.set("application_path", NodePath("../NetworkApplication"))
  made.set("component_name", component)
  made.set("initial_props", props)
  root.add_child(made)
  return made

func base(listener: String) -> String:
  return ("https://127.0.0.1:" if listener == "https" else "http://127.0.0.1:") + str(int(ports[listener]))

