extends SceneTree

# Drives React Native's own WebSocket, with its Blob and FileReader, through the public react-native import in two
# roots of one application, against the suite's local server (tests/websocket-server.mjs: a child process of the runner
# whose ports arrive as user arguments). The server speaks RFC 6455 over loopback, with and without TLS; this probe reads
# what JS observed and, through its own HTTPClient, what the server recorded: the handshakes with their raw headers and
# every frame in both directions. Waits are bounded by events (a case ending, a held handshake reaching the server, a
# close frame arriving there), never by a number of frames or seconds, and the limit that bounds each wait is only there
# to turn a hang into a failure.
#
# A normative check needs the native WebSocketModule: the preceding host has none, so it must fail exactly those checks,
# and every other check holds on both.
const LIMIT_MS := 30000
const UTF8_TEXT := "Olá, mundo — ação 日本語 😀 Zażółć gęślą jaźń"
const TRUST_META := "validation_tls_trusted_authorities"
const CLOCK_META := "validation_clock_offset_ms"
const BEFORE_OPEN := "WebSocket is closed before the connection is established."
const MEGABYTE := 1048576

var application: Node
var surfaces := {}
var checks: Array = []
var stages := {}
var expected_original_failures: Array = []
var allow_original_negative := false
var sabotage := false
var tls_close_smoke := false
var ports := {}
var authority := ""
var other_authority := ""
# False on a host without the WebSocket module: nothing then reaches the server, so waiting for it is pointless.
var native_available := false
# Set when a wait runs out of its limit: the rest of the probe then fails fast instead of waiting again.
var stalled := false

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

# A normative check needs the native module to hold.
func socket_check(condition: bool, name: String) -> bool:
  expected_original_failures.append(name)
  return check(condition, name)

func frames(count := 1) -> void:
  for index in range(count):
    await process_frame

func wait_until(condition: Callable, limit_ms := LIMIT_MS) -> bool:
  var started := Time.get_ticks_msec()
  while not stalled and Time.get_ticks_msec() - started < limit_ms and not condition.call():
    await process_frame
  var reached: bool = condition.call()
  if not reached:
    stalled = true
  return reached

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(" + expression + ")"))

func native() -> Dictionary:
  return JSON.parse_string(application.call("snapshot"))

func networking() -> Dictionary:
  var value: Variant = native().get("networking", {})
  return value if value is Dictionary else {}

func websocket() -> Dictionary:
  var value: Variant = networking().get("webSocket", {})
  return value if value is Dictionary else {}

func section(value: Variant, key: String) -> Dictionary:
  var inner: Variant = value.get(key, {}) if value is Dictionary else {}
  return inner if inner is Dictionary else {}

func count_of(value: Variant, key: String) -> int:
  return int(value.get(key, 0)) if value is Dictionary else 0

func transport_of(state: Dictionary) -> Dictionary:
  return section(state, "transport")

# --- the server, through the probe's own HTTPClient -----------------------------------

func control(path: String) -> Dictionary:
  var client := HTTPClient.new()
  client.connect_to_host("127.0.0.1", int(ports.ws))
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
  return str(section(log, "holds").get(name, "none"))

func wait_for_hold(name: String, wanted: String) -> bool:
  if not native_available:
    return false
  var started := Time.get_ticks_msec()
  while not stalled and Time.get_ticks_msec() - started < LIMIT_MS:
    if await hold_state(name) == wanted:
      return true
    await process_frame
  stalled = true
  return false

# The code of the close frame the server received on a connection, once it has one; -1 when none arrives.
func client_close_code(label: String) -> int:
  var started := Time.get_ticks_msec()
  while Time.get_ticks_msec() - started < LIMIT_MS:
    var log: Dictionary = await server_log()
    var frame := close_of(connection(log, label), "in")
    if not frame.is_empty():
      return int(frame.get("closeCode", -1))
    await process_frame
  return -1

func release(name: String) -> void:
  await control("/__control/release/" + name)

# The connection the server recorded for a case label (the `case` query parameter of its URL), {} when it has none.
func connection(log: Dictionary, label: String) -> Dictionary:
  var all: Variant = log.get("connections", [])
  for entry: Dictionary in all:
    if str(entry.url).get_slice("case=", 1).get_slice("&", 0) == label:
      return entry
  return {}

func connections_matching(log: Dictionary, prefix: String) -> Array:
  var found: Array = []
  var all: Variant = log.get("connections", [])
  for entry: Dictionary in all:
    if str(entry.url).get_slice("case=", 1).get_slice("&", 0).begins_with(prefix):
      found.append(entry)
  return found

func frames_of(entry: Dictionary, direction: String, opcodes: Array = []) -> Array:
  var found: Array = []
  var all: Variant = entry.get("frames", [])
  for frame: Dictionary in all:
    if frame.direction == direction and (opcodes.is_empty() or opcodes.has(frame.opcode)):
      found.append(frame)
  return found

# Data frames in one direction, as "opcode:length".
func data_summary(entry: Dictionary, direction: String) -> Array:
  var summary: Array = []
  for frame: Dictionary in frames_of(entry, direction, ["text", "binary", "continuation"]):
    summary.append("%s:%d" % [frame.opcode, int(frame.length)])
  return summary

func handshake_status(entry: Dictionary) -> int:
  return int(section(entry, "handshake").get("status", 0))

func close_of(entry: Dictionary, direction: String) -> Dictionary:
  var closes := frames_of(entry, direction, ["close"])
  return closes[0] if not closes.is_empty() else {}

func raw_headers(entry: Dictionary, name: String) -> Array:
  var values: Array = []
  var raw: Array = entry.get("rawHeaders", [])
  for index in range(0, raw.size(), 2):
    if str(raw[index]).to_lower() == name.to_lower():
      values.append(raw[index + 1])
  return values

func frame_text(frame: Dictionary) -> String:
  return Marshalls.base64_to_raw(str(frame.get("base64", ""))).get_string_from_utf8()

# --- cases ----------------------------------------------------------------------------

func begin(root_name: String, case_name: String, case_args: Dictionary = {}) -> String:
  var expression := "WebSocketProbe.start(%s, %s, %s)" % [JSON.stringify(case_name), JSON.stringify(root_name), JSON.stringify(case_args)]
  return str(js(expression))

func status_of(key: String) -> String:
  return str(js("WebSocketProbe.status(%s)" % JSON.stringify(key)))

func finished(key: String) -> bool:
  return await wait_until(func() -> bool: return status_of(key) != "running")

func entry_of(key: String) -> Dictionary:
  var value: Variant = js("WebSocketProbe.entry(%s)" % JSON.stringify(key))
  return value if value is Dictionary else {}

func run_case(root_name: String, case_name: String, case_args: Dictionary = {}) -> Dictionary:
  var key := begin(root_name, case_name, case_args)
  var done := await finished(key)
  var entry := entry_of(key)
  entry["key"] = key
  entry["timedOut"] = not done
  return entry

# The result object of a finished case, {} when it threw.
func result_of(entry: Dictionary) -> Dictionary:
  var value: Variant = entry.get("result")
  return value if value is Dictionary else {}

# What one observed socket recorded.
func types_of(session: Variant) -> Array:
  var types: Array = []
  var events: Variant = session.get("events") if session is Dictionary else null
  if events is Array:
    for event: Dictionary in events:
      types.append(event.type)
  return types

func states_of(session: Variant) -> Array:
  var states: Array = []
  var events: Variant = session.get("events") if session is Dictionary else null
  if events is Array:
    for event: Dictionary in events:
      states.append([event.type, int(event.readyState)])
  return states

func messages_of(session: Variant) -> Array:
  var messages: Array = []
  var events: Variant = session.get("events") if session is Dictionary else null
  if events is Array:
    for event: Dictionary in events:
      if event.type == "message":
        messages.append(event)
  return messages

func close_event(session: Variant) -> Dictionary:
  var events: Variant = session.get("events") if session is Dictionary else null
  if events is Array:
    for event: Dictionary in events:
      if event.type == "close":
        return event
  return {}

func ended_with(session: Variant, code: int, reason: String) -> bool:
  var closed := close_event(session)
  return not closed.is_empty() and int(closed.get("code", -1)) == code and str(closed.get("reason")) == reason

# A socket that failed: the error event, then the close that RN's WebSocket makes of it, code 1006, reason the failure's own words.
func failed_with(session: Variant, message_part: String) -> bool:
  var closed := close_event(session)
  return types_of(session).slice(-2) == ["error", "close"] and int(closed.get("code", -1)) == 1006 and str(closed.get("reason")).contains(message_part)

func sha256(bytes: PackedByteArray) -> String:
  var context := HashingContext.new()
  context.start(HashingContext.HASH_SHA256)
  context.update(bytes)
  return context.finish().hex_encode()

func fnv1a(bytes: PackedByteArray) -> int:
  var hash := 0x811c9dc5
  for byte: int in bytes:
    hash = ((hash ^ byte) * 0x01000193) & 0xFFFFFFFF
  return hash

func pattern(size: int) -> PackedByteArray:
  var bytes := PackedByteArray()
  bytes.resize(size)
  for index in range(size):
    bytes[index] = (index * 31 + 7) & 255
  return bytes

func same_bytes(actual: Variant, expected: PackedByteArray) -> bool:
  if not actual is Array or actual.size() != expected.size():
    return false
  for index in range(expected.size()):
    if int(actual[index]) != int(expected[index]):
      return false
  return true

func ints(values: Variant) -> Array:
  var converted: Array = []
  if values is Array:
    for value: Variant in values:
      converted.append(int(value))
  return converted

func url_of(path: String, origin := "ws") -> String:
  var origins := {"ws": "ws://127.0.0.1:%d" % int(ports.ws), "wss": "wss://127.0.0.1:%d" % int(ports.wss), "wssUntrusted": "wss://127.0.0.1:%d" % int(ports.wssUntrusted)}
  return str(origins[origin]) + path

func _initialize() -> void:
  allow_original_negative = OS.get_cmdline_user_args().has("--allow-original-negative")
  sabotage = OS.get_cmdline_user_args().has("--sabotage")
  tls_close_smoke = OS.get_cmdline_user_args().has("--tls-close-smoke")
  for argument: String in OS.get_cmdline_user_args():
    if argument.begins_with("--ports="):
      ports = JSON.parse_string(argument.trim_prefix("--ports="))
    elif argument.begins_with("--ca="):
      authority = FileAccess.get_file_as_string(argument.trim_prefix("--ca="))
    elif argument.begins_with("--other-ca="):
      other_authority = FileAccess.get_file_as_string(argument.trim_prefix("--other-ca="))
  call_deferred("run_probe")

func mount(name: String) -> void:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = name
  surface.position = Vector2(0 if name == "A" else 160, 0)
  surface.size = Vector2(140, 60)
  surface.set("application_path", NodePath("../WebSocketApplication"))
  surface.set("component_name", "WebSocketProbe")
  surface.set("initial_props", {"name": name})
  surfaces[name] = surface
  root.add_child(surface)
  await frames(6)

func run_probe() -> void:
  root.size = Vector2i(320, 80)
  application = ClassDB.instantiate("FabricApplication")
  application.name = "WebSocketApplication"
  application.set("bundle_path", "res://build/websocket-probe.js")
  # The test server's authority is trusted only through the validation seam.
  application.set_meta(TRUST_META, authority)
  root.add_child(application)
  await mount("A")
  await mount("B")
  var app := native()
  check(int(app.rootCount) == 2 and app.errors.is_empty(), "mount/Two roots mount through the original AppRegistry in one application")
  application.call("evaluate", "WebSocketProbe.configure(%s)" % JSON.stringify(ports))
  await module_stage()
  if tls_close_smoke:
    await tls_close_stage()
    await finish()
    return
  await state_stage()
  await echo_stage()
  await protocol_stage()
  await header_stage()
  await close_stage()
  await connecting_stage()
  await failure_stage()
  await large_stage()
  await overflow_stage()
  await frame_stage()
  await tls_stage()
  await contract_stage()
  await roots_stage()
  await timeout_stage()
  await accounting_stage()
  await stop_stage()
  await finish()

# --- stages ---------------------------------------------------------------------------

func module_stage() -> void:
  var initial := websocket()
  stages.initial = initial
  var modules: Dictionary = js("WebSocketProbe.modules()")
  stages.modules = modules
  native_available = modules.get("WebSocketModule") == true
  socket_check(modules.get("WebSocketModule") == true and modules.get("BlobModule") == true,
    "modules/RN's WebSocketModule and BlobModule load from the native host")
  var constructs: Dictionary = js("WebSocketProbe.constructs()")
  stages.constructs = constructs
  # On a host without the module the first use of WebSocket fails where RN's own lookup looks for it, and nowhere else.
  check(constructs.get("created") == true or str(constructs.get("message")).contains("'WebSocketModule' could not be found"),
    "modules/Constructing a WebSocket either works or fails with RN's own module lookup error")
  socket_check(constructs.get("created") == true, "modules/RN's own WebSocket constructs over the native module")
  socket_check(transport_of(initial).get("transport") == "godot-httpclient-wslay" and count_of(section(initial, "sockets"), "open") == 0
    and count_of(transport_of(initial), "active") == 0 and count_of(initial, "connects") == 0,
    "modules/The application's sockets use the HTTPClient and wslay transport with nothing open")
  # The socket of the constructs probe ends by itself: its port refuses.
  if native_available:
    await wait_until(func() -> bool: return count_of(transport_of(websocket()), "active") == 0)

func state_stage() -> void:
  var states := await run_case("A", "states")
  stages.states = states
  var result := result_of(states)
  socket_check(ints(result.get("constants")) == [0, 1, 2, 3] and int(result.get("initial", -1)) == 0 and result.get("initialBinaryType") == null,
    "state/A new WebSocket is CONNECTING with no binaryType")
  socket_check(result.get("sendConnecting") == "INVALID_STATE_ERR" and result.get("pingConnecting") == "INVALID_STATE_ERR",
    "state/send and ping while CONNECTING throw INVALID_STATE_ERR")
  socket_check(result.get("invalidBinaryType") == "binaryType must be either 'blob' or 'arraybuffer'" and result.get("afterBlob") == "blob"
    and result.get("afterArrayBuffer") == "arraybuffer", "state/binaryType accepts blob and arraybuffer and refuses anything else")
  socket_check(int(result.get("openState", -1)) == 1 and result.get("unsupportedData") == "Unsupported data type"
    and int(result.get("closingState", -1)) == 2 and int(result.get("finalState", -1)) == 3,
    "state/readyState goes OPEN, CLOSING, CLOSED, and send refuses data it cannot send")

func echo_stage() -> void:
  var text := await run_case("A", "echoText")
  stages.echoText = text
  var session := result_of(text)
  var messages := messages_of(session)
  socket_check(types_of(session) == ["open", "message", "close"] and states_of(session) == [["open", 1], ["message", 1], ["close", 3]]
    and session.get("protocol") == "" and int(section(session, "created").get("readyState", -1)) == 0 and section(session, "created").get("url") == url_of("/echo?case=echo-text"),
    "echo/A socket opens, receives and closes in RN's order, with the states RN reports and no subprotocol")
  socket_check(messages.size() == 1 and messages[0].kind == "text" and messages[0].text == UTF8_TEXT and ended_with(session, 4000, "bye"),
    "echo/A multi-byte text message comes back whole, and close(4000, 'bye') is the server's echo of it")
  var binary := await run_case("A", "echoBinary")
  stages.echoBinary = binary
  session = result_of(binary)
  var every_byte := PackedByteArray()
  for index in range(256):
    every_byte.append(index)
  messages = messages_of(session)
  var sent := [every_byte, every_byte, every_byte.slice(10, 20), PackedByteArray([1, 0, 254, 255, 44, 1]), every_byte.slice(4, 12)]
  var all_same := messages.size() == sent.size()
  for index in range(min(messages.size(), sent.size())):
    all_same = all_same and messages[index].kind == "arraybuffer" and same_bytes(messages[index].bytes, sent[index])
  socket_check(all_same and types_of(session).slice(-1) == ["close"], "echo/Typed arrays, ArrayBuffers and DataViews are sent with their own offsets and come back as ArrayBuffers")
  var default := await run_case("A", "echoDefault")
  stages.echoDefault = default
  session = result_of(default)
  socket_check(messages_of(session).size() == 1 and messages_of(session)[0].kind == "arraybuffer" and same_bytes(messages_of(session)[0].bytes, PackedByteArray([7, 8, 9]))
    and session.get("binaryType") == null, "echo/Without a binaryType a binary message is an ArrayBuffer")
  var before := websocket()
  var blobs_before := section(networking(), "blobs")
  var blob := await run_case("A", "echoBlob")
  var after := websocket()
  var blobs_after := section(networking(), "blobs")
  stages.echoBlob = blob
  session = result_of(blob)
  messages = messages_of(session)
  var blob_text := "blob ação".to_utf8_buffer()
  socket_check(messages.size() == 4 and messages[0].kind == "blob" and int(messages[0].get("size", -1)) == 4 and same_bytes(messages[0].bytes, PackedByteArray([1, 2, 3, 250]))
    and messages[0].mime == "" and messages[1].kind == "text" and messages[1].text == "texto"
    and messages[2].kind == "blob" and int(messages[2].get("size", -1)) == blob_text.size() and same_bytes(messages[2].bytes, blob_text)
    and messages[3].kind == "arraybuffer" and same_bytes(messages[3].bytes, PackedByteArray([9, 8, 7])) and int(session.get("blobSent", 0)) == blob_text.size(),
    "echo/binaryType blob delivers binary messages as blobs, sends a Blob's bytes, keeps text as text, and arraybuffer gives ArrayBuffers back")
  stages.blobBooks = {"before": blobs_before, "after": blobs_after}
  socket_check(count_of(after, "blobMessages") - count_of(before, "blobMessages") == 2 and count_of(after, "blobSends") - count_of(before, "blobSends") == 1
    and count_of(after, "blobHandlerChanges") - count_of(before, "blobHandlerChanges") >= 2,
    "echo/BlobModule's WebSocket hooks ran: two messages became blobs and one blob was sent")
  socket_check(count_of(blobs_after, "stored") - count_of(blobs_before, "stored") == 3 and count_of(blobs_after, "closed") - count_of(blobs_before, "closed") == 3
    and count_of(blobs_after, "count") == count_of(blobs_before, "count"),
    "echo/The two blobs received and the one made to be sent were all closed by JS and released: the store is back where it was")
  var log := await server_log()
  var echo_text := connection(log, "echo-text")
  socket_check(data_summary(echo_text, "in") == ["text:%d" % UTF8_TEXT.to_utf8_buffer().size()] and data_summary(echo_text, "out") == ["text:%d" % UTF8_TEXT.to_utf8_buffer().size()]
    and int(close_of(echo_text, "in").get("closeCode", -1)) == 4000 and close_of(echo_text, "in").get("closeReason") == "bye"
    and echo_text.get("state") == "closed",
    "echo/The server saw one text frame, a masked client close with 4000 and 'bye', and answered the close")
  var echo_blob := connection(log, "echo-blob")
  socket_check(data_summary(echo_blob, "in") == ["binary:4", "text:5", "binary:%d" % blob_text.size(), "binary:3"]
    and frames_of(echo_blob, "in", ["text", "binary"]).all(func(frame: Dictionary) -> bool: return frame.masked == true),
    "echo/The server saw the blob's bytes as a binary frame, and every client frame masked")

func protocol_stage() -> void:
  var protocols := await run_case("A", "subprotocol")
  stages.subprotocol = protocols
  var result := result_of(protocols)
  socket_check(section(result, "list").get("protocol") == "chat.v2" and not messages_of(section(result, "list")).is_empty()
    and messages_of(section(result, "list"))[0].text == "protocol:chat.v2"
    and section(result, "single").get("protocol") == "chat.v1" and section(result, "none").get("protocol") == ""
    and section(result, "filtered").get("protocol") == "chat.v1",
    "protocol/The server's choice among the offered subprotocols is the socket's protocol, '' when none was offered")
  var log := await server_log()
  socket_check(raw_headers(connection(log, "sub-list"), "sec-websocket-protocol") == ["chat.v3,chat.v2,chat.v1"]
    and raw_headers(connection(log, "sub-single"), "sec-websocket-protocol") == ["chat.v1"]
    and raw_headers(connection(log, "sub-none"), "sec-websocket-protocol").is_empty()
    and raw_headers(connection(log, "sub-filtered"), "sec-websocket-protocol") == ["chat.v1"],
    "protocol/The subprotocols travel in one header, trimmed, and empty ones and ones with a comma are not offered")

func header_stage() -> void:
  var headers := await run_case("A", "headers")
  stages.headers = headers
  var result := result_of(headers)
  var seen := {}
  for label: String in ["plain", "custom", "origin", "lowerOrigin", "secure"]:
    var first: Array = messages_of(section(result, label))
    var info: Variant = JSON.parse_string(str(first[0].text)) if not first.is_empty() else {}
    seen[label] = info if info is Dictionary else {}
  var plain_origin := []
  var raw: Array = section(seen, "plain").get("rawHeaders", [])
  for index in range(0, raw.size(), 2):
    if str(raw[index]).to_lower() == "origin":
      plain_origin.append(raw[index + 1])
  socket_check(plain_origin == ["http://127.0.0.1:%d" % int(ports.ws)], "headers/Without an Origin the socket sends one made of its URL, as Android's module does")
  var log := await server_log()
  var custom := connection(log, "headers-custom")
  socket_check(raw_headers(custom, "x-custom") == ["one"] and raw_headers(custom, "authorization") == ["Bearer t"] and raw_headers(custom, "x-number").is_empty()
    and raw_headers(custom, "origin") == ["http://127.0.0.1:%d" % int(ports.ws)],
    "headers/Headers from the options are sent in the handshake, one that is not a string is ignored, and the default Origin is added")
  socket_check(raw_headers(custom, "host") == ["127.0.0.1:%d" % int(ports.ws)] and raw_headers(custom, "upgrade") == ["websocket"]
    and raw_headers(custom, "sec-websocket-protocol").is_empty() and raw_headers(custom, "connection") == ["Upgrade"],
    "headers/The handshake's own headers stay the engine's: a Host, Upgrade or protocol the caller gave is dropped")
  var origin := connection(log, "headers-origin")
  var lower := connection(log, "headers-origin-lower")
  socket_check(raw_headers(origin, "origin") == ["https://app.example"] and raw_headers(lower, "origin") == ["https://lower.example"],
    "headers/An Origin the caller gave is the only Origin, whatever its case")
  socket_check(raw_headers(connection(log, "headers-wss"), "origin") == ["https://127.0.0.1:%d" % int(ports.wss)],
    "headers/The default Origin of a wss URL is its https origin")
  socket_check(types_of(section(result, "httpScheme")) == ["open", "message", "close"] and types_of(section(result, "httpsScheme")) == ["open", "message", "close"]
    and raw_headers(connection(log, "headers-http"), "origin") == ["http://127.0.0.1:%d" % int(ports.ws)]
    and raw_headers(connection(log, "headers-https"), "origin") == ["https://127.0.0.1:%d" % int(ports.wss)],
    "headers/An http or https URL connects as ws or wss, as OkHttp reads it, with its own origin")
  socket_check(raw_headers(connection(log, "headers-plain"), "cookie").is_empty() and raw_headers(connection(log, "headers-plain"), "sec-websocket-version") == ["13"]
    and raw_headers(connection(log, "headers-plain"), "sec-websocket-key").size() == 1, "headers/No cookie is sent, and the engine's own handshake headers are there once")

func close_stage() -> void:
  var closes := await run_case("A", "serverClose")
  stages.serverClose = closes
  var result := result_of(closes)
  socket_check(types_of(section(result, "atOnce")) == ["open", "close"] and ended_with(section(result, "atOnce"), 4001, "going away"),
    "close/A close the server starts at once arrives as open and then close with the server's code and reason, and no error")
  socket_check(types_of(section(result, "onMessage")) == ["open", "close"] and ended_with(section(result, "onMessage"), 4002, "after a message"),
    "close/A close the server sends after a message arrives the same way")
  socket_check(types_of(section(result, "empty")) == ["open", "close"] and ended_with(section(result, "empty"), 1005, ""),
    "close/A close frame without a status is reported as 1005 with no reason")
  var client := await run_case("A", "clientClose")
  stages.clientClose = client
  result = result_of(client)
  socket_check(ended_with(section(result, "defaults"), 1000, "") and types_of(section(result, "defaults")) == ["open", "close"]
    and ended_with(section(result, "custom"), 3000, "ação"), "close/close() sends 1000 with no reason, and a code and reason go to the server as given")
  var rejected_sessions: Array = result.get("rejected", [])
  var all_ended := rejected_sessions.size() == 3
  for session: Dictionary in rejected_sessions:
    all_ended = all_ended and types_of(session) == ["open", "close"] and ended_with(session, 1000, "bye")
  var native_state := websocket()
  socket_check(all_ended and count_of(native_state, "closeRejections") == 3,
    "close/A reason over 123 bytes, a reserved code and a code out of range are refused as OkHttp refuses them, and the socket stays open")
  var after_close := section(result, "sendAfterClose")
  socket_check(types_of(after_close) == ["open", "error", "close"] and failed_with(after_close, "client is null") and count_of(native_state, "programmerErrors") >= 1,
    "close/A send after close() fails the socket with Android's 'client is null' before the server answers")
  var log := await server_log()
  var rejected_reason := connection(log, "close-rejected-reason")
  socket_check(data_summary(rejected_reason, "in") == ["text:3"] and frame_text(frames_of(rejected_reason, "in", ["text"])[0]) == "now"
    and int(close_of(rejected_reason, "out").get("closeCode", -1)) == 1000 and int(close_of(rejected_reason, "in").get("closeCode", -1)) == 1000,
    "close/The server received the message sent after the refused close, and ended the socket itself")
  var defaults := connection(log, "close-default")
  var custom := connection(log, "close-custom")
  socket_check(int(close_of(defaults, "in").get("closeCode", -1)) == 1000 and close_of(defaults, "in").get("closeReason") == ""
    and int(close_of(custom, "in").get("closeCode", -1)) == 3000 and close_of(custom, "in").get("closeReason") == "ação" and custom.get("state") == "closed",
    "close/The server saw the close frames with their codes and reasons, and a clean TCP end")

func connecting_stage() -> void:
  var key := begin("A", "holdConnecting", {"name": "close-connecting"})
  var held := await wait_for_hold("close-connecting", "waiting")
  socket_check(held, "connecting/The server received the handshake and holds it")
  var before := websocket()
  application.call("evaluate", "WebSocketProbe.closeSocket('close-connecting')")
  var done := await finished(key)
  var entry := entry_of(key)
  stages.holdConnecting = entry
  var session := result_of(entry)
  socket_check(done and types_of(session) == ["error", "close"] and states_of(session) == [["error", 3], ["close", 3]] and failed_with(session, BEFORE_OPEN),
    "connecting/close() while CONNECTING ends the attempt with an error and a close, and no open")
  socket_check(await wait_for_hold("close-connecting", "closed-by-client"), "connecting/The attempt's connection is closed, which the server saw while it still held the handshake")
  await release("close-connecting")
  await frames(30)
  var after := websocket()
  socket_check(count_of(after, "connectingCloses") - count_of(before, "connectingCloses") == 1
    and count_of(section(after, "sockets"), "connecting") == 0 and count_of(transport_of(after), "opened") == count_of(transport_of(before), "opened"),
    "connecting/The module counted the close, and releasing the held handshake opened nothing")
  socket_check(types_of(result_of(entry_of(key))) == ["error", "close"], "connecting/Nothing reaches the socket after its close")

func failure_stage() -> void:
  var failures := await run_case("A", "failures")
  stages.failures = failures
  var result := result_of(failures)
  socket_check(failed_with(section(result, "rejected"), "HTTP/1.1 403 Forbidden") and failed_with(section(result, "unauthorized"), "HTTP/1.1 401 Forbidden")
    and failed_with(section(result, "badAccept"), "invalid Sec-WebSocket-Accept") and failed_with(section(result, "refused"), "failed before the upgrade"),
    "failure/A handshake the server refuses (403, 401, a wrong accept key) or a port that refuses is an error and a close with code 1006")
  socket_check(failed_with(section(result, "wrongProtocol"), "unoffered subprotocol")
    and types_of(section(result, "unmatchedProtocol")) == ["open", "close"]
    and section(result, "unmatchedProtocol").get("protocol") == "" and ended_with(section(result, "unmatchedProtocol"), 1000, ""),
    "limits/An unoffered subprotocol is rejected, while the optional absence of a selected protocol opens with an empty protocol")
  socket_check(failed_with(section(result, "badScheme"), "Expected URL scheme 'http' or 'https' but was 'ftp'")
    and failed_with(section(result, "noScheme"), "Expected URL scheme 'http' or 'https' but no scheme was found"),
    "failure/Unsupported and missing URL schemes fail with the host's endpoint diagnostic")
  socket_check(failed_with(section(result, "badHeader"), "Unexpected char 0x0a at 1 in X-Bad value: a\\u000ab")
    and failed_with(section(result, "nonAsciiHeader"), "Unexpected char 0xe7 at 1 in X-Unicode value: ação")
    and failed_with(section(result, "badProtocol"), "Unexpected char 0x01 at 3 in Sec-WebSocket-Protocol value: bad\\u0001"),
    "failure/A header or subprotocol OkHttp refuses fails the socket with its message")
  socket_check(types_of(section(result, "dropped")) == ["open", "error", "close"] and failed_with(section(result, "dropped"), "ended without exposing a close frame")
    and types_of(section(result, "reset")) == ["open", "error", "close"] and failed_with(section(result, "reset"), "ended without exposing a close frame"),
    "failure/A connection cut after it opened, by a FIN or a reset, is an error and a close with code 1006 after open")
  var log := await server_log()
  socket_check(connection(log, "reject").get("state") == "refused" and handshake_status(connection(log, "reject")) == 403
    and handshake_status(connection(log, "reject-401")) == 401 and connection(log, "bad-accept").get("state") == "bad-accept"
    and connection(log, "drop").get("state") == "dropped-by-server",
    "failure/The server recorded each refusal, and the connection it cut")
  var untouched := true
  for label: String in ["refused", "bad-header", "non-ascii-header", "bad-protocol"]:
    untouched = untouched and connection(log, label).is_empty()
  check(untouched, "failure/A request the host refuses itself never reaches the server")
func large_stage() -> void:
  var before := transport_of(websocket())
  var large := await run_case("A", "large")
  var after := transport_of(websocket())
  stages.large = large
  var result := result_of(large)
  var expected := pattern(MEGABYTE)
  var expected_fnv := fnv1a(expected)
  var binary := messages_of(section(result, "binary"))
  var text := messages_of(section(result, "text"))
  var from_server := messages_of(section(result, "fromServer"))
  var blob := messages_of(section(result, "blob"))
  socket_check(binary.size() == 1 and int(binary[0].length) == MEGABYTE and int(binary[0].fnv) == expected_fnv
    and text.size() == 1 and int(text[0].length) == MEGABYTE and int(text[0].fnv) == fnv1a("x".repeat(MEGABYTE).to_utf8_buffer()),
    "large/A megabyte message, binary or text, goes to the server and comes back whole")
  socket_check(from_server.size() == 1 and int(from_server[0].length) == MEGABYTE and int(from_server[0].fnv) == expected_fnv
    and blob.size() == 1 and int(blob[0].get("size", -1)) == MEGABYTE and int(blob[0].length) == MEGABYTE and int(blob[0].fnv) == expected_fnv,
    "large/A megabyte the server sends arrives whole, as an ArrayBuffer and as a blob")
  var log := await server_log()
  var echoed := connection(log, "large-binary")
  var received_frames := frames_of(echoed, "in", ["binary"])
  var echoed_frames := frames_of(echoed, "out", ["binary"])
  var pushed_frames := frames_of(connection(log, "large-server"), "out", ["binary"])
  var expected_sha := sha256(expected)
  socket_check(received_frames.size() == 1 and received_frames[0].sha256 == expected_sha and echoed_frames.size() == 1 and echoed_frames[0].sha256 == expected_sha
    and pushed_frames.size() == 1 and int(pushed_frames[0].length) == MEGABYTE and pushed_frames[0].sha256 == expected_sha,
    "large/The server's own hashes agree with what JS sent and received")
  socket_check(count_of(section(after, "messagesIn"), "bytes") - count_of(section(before, "messagesIn"), "bytes") >= 4 * MEGABYTE
    and count_of(section(after, "messagesOut"), "bytes") - count_of(section(before, "messagesOut"), "bytes") >= 2 * MEGABYTE,
    "large/The transport counted the megabytes both ways")

func overflow_stage() -> void:
  var before := websocket()
  var overflow := await run_case("A", "overflow")
  stages.overflow = overflow
  var after := websocket()
  socket_check(types_of(result_of(overflow)) == ["open", "close"] and ended_with(result_of(overflow), 1001, "")
    and count_of(after, "overflows") - count_of(before, "overflows") == 1 and count_of(after, "sent") == count_of(before, "sent"),
    "large/A message that does not fit in the 16 MiB OkHttp queues closes the socket with 1001, and nothing is sent")

func frame_stage() -> void:
  var frames_case := await run_case("A", "frames")
  stages.frames = frames_case
  var result := result_of(frames_case)
  var fragmented := messages_of(section(result, "fragmented"))
  socket_check(fragmented.size() == 2 and fragmented[0].kind == "text" and fragmented[0].text == "fragmented" and fragmented[1].kind == "arraybuffer"
    and same_bytes(fragmented[1].bytes, PackedByteArray([1, 2, 3, 4, 5, 6])), "frames/Fragmented messages arrive as one message each")
  var log := await server_log()
  var ping := connection(log, "server-ping")
  var pongs := frames_of(ping, "in", ["pong"])
  socket_check(pongs.size() == 1 and frame_text(pongs[0]) == "ping-payload" and types_of(section(result, "serverPing")) == ["open", "message", "close"],
    "frames/The engine answers the server's ping with a pong that carries its payload, and JS sees nothing of it")
  var invalid := section(result, "invalidText")
  socket_check(types_of(invalid) == ["open", "error", "close"] and failed_with(invalid, "close code 1007"),
    "limits/Invalid UTF-8 sends close 1007 on the wire and terminates JS as an abnormal failure")
  var client_ping := connection(log, "client-ping")
  socket_check(data_summary(client_ping, "in") == ["binary:0"] and frames_of(client_ping, "out", ["binary"]).size() == 1
    and messages_of(section(result, "ping")).size() == 1 and int(messages_of(section(result, "ping"))[0].length) == 0,
    "frames/ping() sends an empty binary message, as Android's module does, and the echo of it is an empty ArrayBuffer")
  # The stream adapter must deliver each complete data message before the peer's close event.
  var observed := await run_case("A", "dataThenClose")
  stages.dataThenClose = observed
  var coalesced := section(result_of(observed), "coalesced")
  var delivered := messages_of(coalesced).size()
  stages.dataThenCloseObserved = {"sent": 3, "delivered": delivered}
  socket_check(ended_with(coalesced, 4003, "done") and delivered == 3 and types_of(coalesced).slice(-1) == ["close"],
    "limits/All messages coalesced with the peer's close arrive before its exact close code and reason")
  var interleaved := await run_case("A", "interleavedPing")
  stages.interleavedPing = interleaved
  var interleaved_messages := messages_of(section(result_of(interleaved), "fragmented"))
  stages.interleavedPingObserved = {"messages": interleaved_messages.size(), "text": interleaved_messages[0].get("text") if not interleaved_messages.is_empty() else null}
  socket_check(interleaved_messages.size() == 1 and interleaved_messages[0].text == "fragmented"
    and types_of(section(result_of(interleaved), "fragmented")).slice(-1) == ["close"],
    "limits/A ping between fragments stays out of the reassembled message")
  var after := await server_log()
  var written := connection(after, "data-then-close")
  socket_check(data_summary(written, "out") == ["text:2", "text:2", "text:2"] and int(close_of(written, "out").get("closeCode", -1)) == 4003,
    "limits/The server wrote the three messages and the close frame")

func tls_stage() -> void:
  var trusted := await run_case("A", "tls", {"origin": "wss", "label": "trusted"})
  stages.tlsTrusted = trusted
  var session := result_of(trusted)
  socket_check(types_of(session) == ["open", "message", "close"] and messages_of(session)[0].text == "secure" and str(section(session, "created").get("url")).begins_with("wss://127.0.0.1:"),
    "tls/A server certified by the authority the validation seam trusts answers over wss")
  var untrusted := await run_case("A", "tls", {"origin": "wssUntrusted", "label": "untrusted"})
  stages.tlsUntrusted = untrusted
  socket_check(failed_with(result_of(untrusted), "failed before the upgrade"), "tls/A certificate from an authority that is not trusted is an error and a close with code 1006")
  application.remove_meta(TRUST_META)
  var without := await run_case("A", "tls", {"origin": "wss", "label": "no-seam"})
  stages.tlsDefault = without
  socket_check(failed_with(result_of(without), "failed before the upgrade"), "tls/Without the seam only Godot's default roots are trusted, and the test authority is not among them")
  application.set_meta(TRUST_META, other_authority)
  var wrong := await run_case("A", "tls", {"origin": "wss", "label": "wrong"})
  var right := await run_case("A", "tls", {"origin": "wssUntrusted", "label": "right"})
  stages.tlsOther = {"wrong": wrong, "right": right}
  socket_check(failed_with(result_of(wrong), "failed before the upgrade") and types_of(result_of(right)) == ["open", "message", "close"],
    "tls/Trust follows the configured authority: the other server's certificate verifies and the first one's does not")
  application.set_meta(TRUST_META, "not a certificate")
  var invalid := await run_case("A", "tls", {"origin": "wss", "label": "invalid"})
  stages.tlsInvalid = invalid
  socket_check(failed_with(result_of(invalid), "not valid PEM"), "tls/Trust that is not valid PEM refuses the socket instead of trusting everything")
  application.set_meta(TRUST_META, authority)
  # Only the two TLS handshakes that reach the engine's TLS peer print a diagnostic; malformed trust is refused by the host.
  stages.deliberateTlsFailures = 3

func tls_close_stage() -> void:
  var entry := await run_case("A", "tlsCloseContract")
  stages.tlsCloseContract = entry
  var result := result_of(entry)
  var normal := section(result, "normal")
  var different := section(result, "different")
  var dropped := section(result, "dropped")
  socket_check(types_of(normal) == ["open", "close"] and ended_with(normal, 1000, ""),
    "tls close/A clean TLS close frame is delivered with its wire code and reason")
  socket_check(types_of(different) == ["open", "close"] and ended_with(different, 4002, "peer selected"),
    "tls close/A peer-selected TLS close code and reason are delivered literally")
  socket_check(types_of(dropped) == ["open", "error", "close"] and failed_with(dropped, "ended without exposing a close frame"),
    "tls close/A TLS drop after client close remains an abnormal failure")
  var log := await server_log()
  var normal_wire := connection(log, "tls-close-normal")
  var different_wire := connection(log, "tls-close-different")
  var dropped_wire := connection(log, "tls-close-drop")
  socket_check(int(close_of(normal_wire, "out").get("closeCode", -1)) == 1000 and close_of(normal_wire, "out").get("closeReason") == ""
    and int(close_of(different_wire, "out").get("closeCode", -1)) == 4002 and close_of(different_wire, "out").get("closeReason") == "peer selected"
    and close_of(dropped_wire, "out").is_empty() and int(close_of(dropped_wire, "in").get("closeCode", -1)) == 1000,
    "tls close/The server wire log distinguishes both close frames from the post-close TLS drop")

func contract_stage() -> void:
  var contract := await run_case("A", "contract")
  stages.contract = contract
  var result := result_of(contract)
  var lifecycle: Array = result.get("lifecycle", [])
  var names := lifecycle.map(func(event: Dictionary) -> String: return event.name)
  var payloads := lifecycle.map(func(event: Dictionary) -> Dictionary: return event.payload)
  socket_check(names == ["websocketOpen", "websocketMessage", "websocketMessage", "websocketMessage", "websocketClosed"]
    and lifecycle[0].keys == ["id", "protocol"] and payloads[0].protocol == "" and int(payloads[0].id) == 9001
    and lifecycle[1].keys == ["data", "id", "type"] and payloads[1].type == "text" and payloads[1].data == "hello"
    and payloads[2].type == "binary" and payloads[2].data == "AQID" and payloads[3].type == "binary" and payloads[3].data == ""
    and lifecycle[4].keys == ["code", "id", "reason"] and int(payloads[4].code) == 1000 and payloads[4].reason == "done",
    "contract/The four device events carry one object each, with RN Android's keys: open {id, protocol}, message {id, type, data}, closed {id, code, reason}")
  var unknown: Array = result.get("unknown", [])
  var unknown_names := unknown.map(func(event: Dictionary) -> String: return event.name)
  socket_check(unknown_names == ["websocketFailed", "websocketClosed", "websocketFailed", "websocketClosed", "websocketFailed", "websocketClosed"]
    and unknown[0].keys == ["id", "message"] and unknown[0].payload.message == "client is null" and unknown[1].payload.reason == "client is null"
    and int(unknown[1].payload.code) == 0 and int(unknown[0].payload.id) == 9100,
    "contract/send, sendBinary and ping for a socket that is not open raise Android's programmer error, a failure and a close that say 'client is null', and close says nothing")
  var bad: Array = result.get("badBase64", [])
  var bad_names := bad.map(func(event: Dictionary) -> String: return event.name)
  socket_check(bad_names == ["websocketOpen", "websocketFailed", "websocketFailed", "websocketClosed"] and bad[1].payload.message == "bytes == null"
    and bad[2].payload.message == "client is null" and bad[3].payload.reason == "client is null",
    "contract/Bytes that are no base64 fail the socket with Android's 'bytes == null', and the failure is its last event: the socket is gone")
  socket_check(str(result.get("duplicate")).contains("E_SOCKET_DUPLICATE") and str(result.get("invalidId")).contains("E_ARGUMENT"),
    "contract/A socket id in use and one that is no id are refused by throwing")
  var duplicate: Array = result.get("duplicateEvents", [])
  socket_check(duplicate.size() == 1 and duplicate[0].name == "websocketFailed" and duplicate[0].payload.message == BEFORE_OPEN and int(duplicate[0].payload.id) == 9003,
    "contract/Closing a socket that is connecting ends it with one failure")
  var log := await server_log()
  var base64_socket := connection(log, "contract-bad-base64")
  socket_check(int(close_of(base64_socket, "in").get("closeCode", -1)) == 1001 and base64_socket.get("state") == "closed",
    "contract/The server saw the failed socket closed with 1001")
  var ping_frames := frames_of(connection(log, "contract"), "in", ["binary"])
  socket_check(ping_frames.size() == 2 and int(ping_frames[1].length) == 0 and frame_text(frames_of(connection(log, "contract"), "in", ["text"])[0]) == "hello",
    "contract/The server saw the text, the three bytes and the empty binary message of ping")

func roots_stage() -> void:
  var a := begin("A", "concurrent")
  var b := begin("B", "concurrent")
  var a_done := await finished(a)
  var b_done := await finished(b)
  stages.concurrent = {"A": entry_of(a), "B": entry_of(b)}
  check(a_done and b_done, "roots/Both roots' sockets end")
  for root_name: String in ["A", "B"]:
    var result := result_of(entry_of(a) if root_name == "A" else entry_of(b))
    var sockets: Array = result.get("sockets", [])
    var own := sockets.size() == 3
    for index in range(sockets.size()):
      var session: Dictionary = sockets[index]
      var messages := messages_of(session)
      own = own and types_of(session) == ["open", "message", "close"] and messages[0].text == "from %s %d" % [root_name, index] and ended_with(session, 1000, "%s%d" % [root_name, index])
    socket_check(own, "roots/Root %s's three sockets, open at once with the other root's, receive only their own messages" % root_name)
  check(count_of(section(websocket(), "sockets"), "open") == 0, "roots/Nothing is left open")

func timeout_stage() -> void:
  # The host's close deadline is explicit; advance the validation clock after the server records the close frame.
  var before := websocket()
  var key := begin("A", "silentClose", {"name": "close-timeout"})
  var saw_close := false
  var waited_from := Time.get_ticks_msec()
  while native_available and not stalled and not saw_close and Time.get_ticks_msec() - waited_from < LIMIT_MS:
    var seen: Dictionary = await server_log()
    saw_close = not close_of(connection(seen, "close-timeout"), "in").is_empty()
    if not saw_close:
      await process_frame
  stalled = stalled or (native_available and not saw_close)
  var still_closing := status_of(key) == "running"
  application.set_meta(CLOCK_META, 120000.0)
  var done := await finished(key)
  application.set_meta(CLOCK_META, 0.0)
  var entry := entry_of(key)
  stages.closeTimeout = entry
  var session := result_of(entry)
  var after := websocket()
  socket_check(done and saw_close and still_closing and types_of(session) == ["open", "error", "close"] and failed_with(session, "close timed out")
    and count_of(transport_of(after), "closeTimeouts") - count_of(transport_of(before), "closeTimeouts") == 1,
    "timeout/A close the server never answers ends with an error and a close with code 1006 once the host's deadline passes")
  var log := await server_log()
  var silent := connection(log, "close-timeout")
  socket_check(int(close_of(silent, "in").get("closeCode", -1)) == 1000 and close_of(silent, "out").is_empty(),
    "timeout/The server had received the close frame and sent nothing back")
  var before_handshake := websocket()
  var handshake_key := begin("A", "handshakeTimeout", {"name": "handshake-timeout"})
  var handshake_held := await wait_for_hold("handshake-timeout", "waiting")
  application.set_meta(CLOCK_META, 31000.0)
  var handshake_done := await finished(handshake_key)
  application.set_meta(CLOCK_META, 0.0)
  var handshake := result_of(entry_of(handshake_key))
  stages.handshakeTimeout = entry_of(handshake_key)
  var after_handshake := websocket()
  socket_check(handshake_held and handshake_done and failed_with(handshake, "connection and upgrade timed out")
    and count_of(transport_of(after_handshake), "closeTimeouts") == count_of(transport_of(before_handshake), "closeTimeouts"),
    "timeout/A stalled connect or upgrade ends at the host's 30 second deadline without counting as a close timeout")
  socket_check(await wait_for_hold("handshake-timeout", "closed-by-client"),
    "timeout/Timing out an incomplete upgrade closes its held TCP connection")

func accounting_stage() -> void:
  var state := websocket()
  stages.beforeStop = state
  var transport := transport_of(state)
  var connects := count_of(state, "connects")
  # Every socket has ended: each connect was refused by the module, or ended as a close, a failure or a cancel.
  check(count_of(transport, "active") == 0 and count_of(section(state, "sockets"), "open") == 0 and count_of(section(state, "sockets"), "connecting") == 0
    and count_of(section(state, "sockets"), "closing") == 0, "accounting/No socket is left")
  socket_check(connects > 0 and connects == count_of(state, "refused") + count_of(state, "closed") + count_of(state, "failed"),
    "accounting/Every connect ended exactly one way: refused, closed or failed")
  socket_check(count_of(transport, "started") > 0 and count_of(transport, "started") == connects - count_of(state, "refused")
    and count_of(transport, "started") == count_of(transport, "closedByPeer") + count_of(transport, "failed") + count_of(transport, "cancelled"),
    "accounting/Every socket the transport started ended in a close, a failure or a cancel")
  socket_check(count_of(state, "sent") > 0 and count_of(state, "received") > 0
    and count_of(state, "received") == count_of(section(transport, "messagesIn"), "text") + count_of(section(transport, "messagesIn"), "binary")
    and count_of(state, "sent") == count_of(section(transport, "messagesOut"), "text") + count_of(section(transport, "messagesOut"), "binary")
    and count_of(state, "sentBytes") == count_of(section(transport, "messagesOut"), "bytes"),
    "accounting/The module's counts of messages and bytes agree with the transport's")
  var events := section(networking(), "events")
  check(count_of(events, "queued") == count_of(events, "delivered") + count_of(events, "dropped"), "accounting/Every queued event was delivered or dropped")

func stop_stage() -> void:
  var key := begin("A", "staysOpen")
  var opened := native_available and await wait_until(func() -> bool:
    var open: Variant = js("WebSocketProbe.socket('stop-open')")
    var blob: Variant = js("WebSocketProbe.socket('stop-blob')")
    var closing: Variant = js("WebSocketProbe.socket('stop-closing')")
    return open is Dictionary and open.events.size() >= 2 and blob is Dictionary and blob.events.size() >= 2 and closing is Dictionary and int(closing.readyState) == 2 and closing.events.size() >= 1)
  var held := await wait_for_hold("stop-connecting", "waiting")
  var before := websocket()
  stages.beforeStopOpen = before
  socket_check(opened and held and count_of(section(before, "sockets"), "open") == 2 and count_of(section(before, "sockets"), "connecting") == 1
    and count_of(section(before, "sockets"), "closing") == 1,
    "stop/Four sockets are in flight: two open (one of them with a blob message), one closing at a server that never answers, one connecting")
  var delivered_before := count_of(section(networking(), "events"), "delivered")
  var snapshots_before := {}
  for name: String in ["stop-open", "stop-blob", "stop-closing", "stop-connecting"]:
    snapshots_before[name] = js("WebSocketProbe.socket('%s')" % name)
  var log_before: Array = js("WebSocketProbe.snapshot().log")
  application.call("stop")
  await frames(4)
  var stopped := native()
  stages.stopped = stopped
  var after: Dictionary = section(section(stopped, "networking"), "webSocket")
  socket_check(section(stopped, "networking").get("stopped") == true and count_of(section(after, "sockets"), "open") == 0 and count_of(section(after, "sockets"), "connecting") == 0
    and count_of(section(after, "sockets"), "closing") == 0 and count_of(transport_of(after), "active") == 0
    and count_of(transport_of(after), "cancelled") - count_of(transport_of(before), "cancelled") == 4 and count_of(section(section(stopped, "networking"), "blobs"), "count") == 0,
    "stop/Stopping closes the sockets in flight, forgets them, releases the blobs and leaves nothing active")
  var server_saw := true
  for name: String in ["stop-open", "stop-blob"]:
    server_saw = server_saw and await client_close_code(name) == 1001
  var final_log: Dictionary = await server_log()
  socket_check(server_saw and await wait_for_hold("stop-connecting", "closed-by-client")
    and int(close_of(connection(final_log, "stop-closing"), "in").get("closeCode", -1)) == 1000 and connection(final_log, "stop-closing").get("tcp") == "closed-by-client",
    "stop/The server saw 1001 on each open socket, the connecting one dropped, and the one closing at a silent server dropped too")
  await release("stop-connecting")
  await frames(30)
  var log_after: Array = js("WebSocketProbe.snapshot().log")
  var appended: Array = log_after.slice(log_before.size())
  var appended_events := appended.map(func(row: Dictionary) -> String: return str(row.event) + ":" + str(row.get("name", "")))
  var unchanged := true
  for name: String in snapshots_before:
    var now: Variant = js("WebSocketProbe.socket('%s')" % name)
    unchanged = unchanged and now is Dictionary and snapshots_before[name] is Dictionary and now.events.size() == snapshots_before[name].events.size()
  socket_check(unchanged and (appended_events == ["cleanup:A", "cleanup:B"] or appended_events == ["cleanup:B", "cleanup:A"]),
    "stop/Stop runs the roots' cleanups and nothing else reaches JS: no message, error or close of a socket that was in flight")
  var final_events := count_of(section(section(stopped, "networking"), "events"), "delivered")
  check(final_events == delivered_before and count_of(section(section(stopped, "networking"), "events"), "queued")
    == count_of(section(section(stopped, "networking"), "events"), "delivered") + count_of(section(section(stopped, "networking"), "events"), "dropped"),
    "stop/No device event was delivered by the stopped application, and every queued one is accounted for")
  var after_stop: Dictionary = js("WebSocketProbe.afterStop()")
  stages.afterStop = after_stop
  socket_check(str(after_stop.get("connect")).contains("E_MODULE_DISPOSED") and str(after_stop.get("addHandler")).contains("E_MODULE_DISPOSED")
    and str(after_stop.get("sendOverSocket")).contains("E_MODULE_DISPOSED") and str(after_stop.get("lookup")).contains("E_RUNTIME_STOPPED"),
    "stop/Retained module methods that start something and a new lookup are refused after stop")
  socket_check(after_stop.get("send") == "returned" and after_stop.get("sendBinary") == "returned" and after_stop.get("ping") == "returned"
    and after_stop.get("close") == "returned" and after_stop.get("removeHandler") == "returned", "stop/Late cleanup and late sends stay harmless")
  var environment: Dictionary = section(js("WebSocketProbe.snapshot()"), "environment")
  var disposed: Dictionary = js("WebSocketProbe.dispose()")
  stages.disposed = disposed
  check(section(disposed, "environment").get("networking") == 0.0, "stop/disposeEnvironment leaves no device subscription of the requests behind")
  var roots: Dictionary = section(js("WebSocketProbe.snapshot()"), "roots")
  check(section(roots, "A").get("mounted") == false and section(roots, "B").get("mounted") == false and int(stopped.rootCount) == 0 and stopped.errors.is_empty(),
    "stop/Stop releases both roots without a host diagnostic")
  check(environment is Dictionary and status_of(key) == "running", "stop/The case that left the sockets in flight never settles")

func finish() -> void:
  for surface: Control in surfaces.values():
    surface.queue_free()
  application.queue_free()
  await frames(2)
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var observed := failures.duplicate()
  var expected := expected_original_failures.duplicate()
  observed.sort()
  expected.sort()
  var original_negative_observed := allow_original_negative and observed == expected and not failures.is_empty()
  var report := {"scenario": "websocket", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages, "ports": ports,
    "expectedOriginalFailures": expected_original_failures, "allowOriginalNegative": allow_original_negative,
    "originalNegativeObserved": original_negative_observed, "allCurrentAssertionsPassed": failures.is_empty(),
    "sabotage": sabotage,
    "scope": {"publicReactNativeImport": true, "originalRNJavaScript": true, "twoRootsOneApplication": true,
      "serverIsLoopbackNode": true, "tlsAuthorityThroughValidationSeam": true, "blobMessagesCertified": true, "cookiesCertified": false,
      "extensionsCertified": false, "handshakeStatusCertified": false, "dataWithCloseCertified": true, "interleavedControlFramesCertified": true}}
  var output := FileAccess.open("res://build/websocket-report.json", FileAccess.WRITE)
  if not check(output != null, "report/The websocket report is saved with any normative failure visible"):
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  output.close()
  var marker := "WEBSOCKET_SABOTAGE_REJECTED: " + str(failures.size()) if sabotage and not failures.is_empty() else "WEBSOCKET_SABOTAGE_NOT_REJECTED"
  var message := "WEBSOCKET_ORIGINAL_NEGATIVE: " + str(failures.size()) if original_negative_observed else "WEBSOCKET_PASSED: " + str(checks.size()) if failures.is_empty() else "WEBSOCKET_FAILED"
  print(marker if sabotage else message)
  quit(0 if failures.is_empty() or original_negative_observed or (sabotage and not failures.is_empty()) else 1)
