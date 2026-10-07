extends SceneTree

# Drives React Native's own fetch, XMLHttpRequest, FormData, Blob, FileReader and
# AbortController, through the public react-native import in two roots of one
# application, against the suite's local server (tests/networking-server.mjs: a
# child process of the runner whose ports arrive as user arguments). The server
# answers real HTTP and HTTPS over loopback; this probe reads what JS observed
# and, through its own HTTPClient, what the server recorded. Waits are bounded by
# events (a case ending, a held request reaching the server, its connection being
# closed), never by a number of frames or seconds, and the limit that bounds each
# wait is only there to turn a hang into a failure.
#
# A normative check needs the native networking modules: the preceding host has
# none, so it must fail exactly those checks, and every other check holds on both.
const LIMIT_MS := 30000
const UTF8_TEXT := "Olá, mundo — ação 日本語 😀 Zażółć gęślą jaźń"
const TRUST_META := "validation_tls_trusted_authorities"
const FAILED_FETCH := "Network request failed"
# JSON numbers parse as floats, and arrays compare strictly.
const JSON_BODY := {"message": "hello", "list": [1.0, 2.0, 3.0], "unicode": "ação", "nested": {"ok": true}}

var application: Node
var surfaces := {}
var checks: Array = []
var stages := {}
var expected_original_failures: Array = []
var allow_original_negative := false
var sabotage := false
var ports := {}
var authority := ""
var other_authority := ""
var base := ""
# False on a host without the networking modules: nothing then reaches the server, so waiting for it is pointless.
var native_available := false
# Set when a wait runs out of its limit: the rest of the probe then fails fast instead of waiting again.
var stalled := false

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

# A normative check needs the native modules to hold.
func network_check(condition: bool, name: String) -> bool:
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

func section(value: Dictionary, key: String) -> Dictionary:
  var inner: Variant = value.get(key, {})
  return inner if inner is Dictionary else {}

func count_of(value: Dictionary, key: String) -> int:
  return int(value.get(key, 0))

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

func raw_header(record: Dictionary, name: String) -> Variant:
  var raw: Array = record.rawHeaders
  for index in range(0, raw.size(), 2):
    if str(raw[index]).to_lower() == name.to_lower():
      return raw[index + 1]
  return null

func body_text(record: Dictionary) -> String:
  return Marshalls.base64_to_raw(str(record.bodyBase64)).get_string_from_utf8()

# --- cases -------------------------------------------------------------------------

func begin(root_name: String, case_name: String, case_args: Dictionary = {}) -> String:
  var expression := "NetworkingProbe.start(%s, %s, %s)" % [JSON.stringify(case_name), JSON.stringify(root_name), JSON.stringify(case_args)]
  return str(js(expression))

func status_of(key: String) -> String:
  return str(js("NetworkingProbe.status(%s)" % JSON.stringify(key)))

func finished(key: String) -> bool:
  return await wait_until(func() -> bool: return status_of(key) != "running")

func entry_of(key: String) -> Dictionary:
  var value: Variant = js("NetworkingProbe.entry(%s)" % JSON.stringify(key))
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

func error_is(value: Variant, error_name: String, text: String) -> bool:
  if not value is Dictionary:
    return false
  var error: Variant = value.get("error")
  return error is Dictionary and error.get("name") == error_name and str(error.get("message")).contains(text)

func is_failed_fetch(value: Variant) -> bool:
  return error_is(value, "TypeError", FAILED_FETCH)

func sha256(bytes: PackedByteArray) -> String:
  var context := HashingContext.new()
  context.start(HashingContext.HASH_SHA256)
  context.update(bytes)
  return context.finish().hex_encode()

func sha_text(text: String) -> String:
  return sha256(text.to_utf8_buffer())

# What a server that reads header bytes as ISO-8859-1 makes of UTF-8 bytes.
func latin1(bytes: PackedByteArray) -> String:
  var text := ""
  for byte: int in bytes:
    text += char(byte)
  return text

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

func url_of(path: String, origin := "http") -> String:
  var origins := {"http": "http://127.0.0.1:%d" % int(ports.http), "other": "http://127.0.0.1:%d" % int(ports.other),
    "https": "https://127.0.0.1:%d" % int(ports.https), "httpsUntrusted": "https://127.0.0.1:%d" % int(ports.httpsUntrusted)}
  return str(origins[origin]) + path

func event_types(events: Variant) -> Array:
  var types: Array = []
  if events is Array:
    for event: Dictionary in events:
      types.append(event.type)
  return types

func event_states(events: Variant) -> Array:
  var states: Array = []
  if events is Array:
    for event: Dictionary in events:
      states.append([event.type, int(event.readyState), int(event.status)])
  return states

func headers_of(echo: Variant) -> Dictionary:
  var headers: Variant = echo.get("headers") if echo is Dictionary else null
  return headers if headers is Dictionary else {}

func _initialize() -> void:
  allow_original_negative = OS.get_cmdline_user_args().has("--allow-original-negative")
  sabotage = OS.get_cmdline_user_args().has("--sabotage")
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
  surface.set("application_path", NodePath("../NetworkingApplication"))
  surface.set("component_name", "NetworkingProbe")
  surface.set("initial_props", {"name": name})
  surfaces[name] = surface
  root.add_child(surface)
  await frames(6)

func run_probe() -> void:
  root.size = Vector2i(320, 80)
  base = url_of("")
  application = ClassDB.instantiate("FabricApplication")
  application.name = "NetworkingApplication"
  application.set("bundle_path", "res://build/networking-probe.js")
  # The test server's authority is trusted only through the validation seam.
  application.set_meta(TRUST_META, authority)
  root.add_child(application)
  await mount("A")
  await mount("B")
  var app := native()
  check(int(app.rootCount) == 2 and app.errors.is_empty(), "mount/Two roots mount through the original AppRegistry in one application")
  application.call("evaluate", "NetworkingProbe.configure(%s)" % JSON.stringify(ports))
  await module_stage()
  await javascript_stage()
  await fetch_stage()
  await redirect_stage()
  await failure_stage()
  await https_stage()
  await xhr_stage()
  await contract_stage()
  await blob_stage()
  await roots_stage()
  await abort_stage()
  await stop_stage()
  await finish()

# --- stages ------------------------------------------------------------------------

func module_stage() -> void:
  var modules: Dictionary = js("NetworkingProbe.modules()")
  stages.modules = modules
  native_available = modules.get("Networking") == true
  network_check(modules.get("Networking") == true and modules.get("BlobModule") == true and modules.get("FileReaderModule") == true,
    "modules/RN's Networking, BlobModule and FileReaderModule load from the native host")
  # WebSocket has a suite of its own; here it is only seen to be there, where this slice's first version saw it fail.
  network_check(modules.get("WebSocketModule") == true, "modules/WebSocketModule is provided by the native host")
  var socket: Dictionary = js("NetworkingProbe.webSocket()")
  stages.webSocket = socket
  network_check(socket.get("created") == true, "modules/RN's own WebSocket constructs over the native module")
  var globals := await run_case("A", "globals")
  stages.globals = globals
  network_check(result_of(globals).get("XMLHttpRequest") == "function" and result_of(globals).get("FileReader") == "function",
    "modules/XMLHttpRequest and FileReader are RN's, installed by the host's initialization over its native modules")
  var initial := networking()
  stages.initial = initial
  network_check(not initial.is_empty() and section(initial, "transport").get("transport") == "godot-http-client"
    and count_of(section(initial, "requests"), "inFlight") == 0, "modules/The application's networking runs on the Godot transport with nothing in flight")

func javascript_stage() -> void:
  var entry := await run_case("A", "pure")
  stages.pure = entry
  var result := result_of(entry)
  var globals: Dictionary = section(result, "globals")
  check(entry.status == "done" and ["fetch", "Headers", "Request", "Response", "FormData", "Blob", "File", "URL",
    "URLSearchParams", "AbortController", "AbortSignal"].all(func(name: String) -> bool: return globals.get(name) == "function"),
    "javascript/RN's web globals are installed lazily from its setUpXHR")
  check(result.get("header") == "1, 2" and result.get("method") == "POST" and result.get("requestText") == "ação",
    "javascript/Headers joins repeats and Request normalizes the method and keeps a string body")
  check(result.get("aborted") == true and result.get("heard") == [true] and result.get("search") == "ç",
    "javascript/AbortController aborts its signal once and URLSearchParams decodes")
  var parts: Array = result.get("formParts", [])
  check(parts.size() == 1 and parts[0].string == "ação" and parts[0].headers.get("content-disposition") == "form-data; name=\"field\"",
    "javascript/FormData describes its parts as RN sends them to the native module")

func fetch_stage() -> void:
  var json := await run_case("A", "json")
  stages.json = json
  var result := result_of(json)
  network_check(result.get("status") == 200.0 and result.get("ok") == true and result.get("url") == url_of("/json")
    and result.get("contentType") == "application/json; charset=utf-8" and result.get("missing") == null
    and result.get("body") == JSON_BODY,
    "fetch/GET returns the status, the final URL, the headers and the parsed JSON body")

  var utf8 := await run_case("A", "utf8")
  stages.utf8 = utf8
  result = result_of(utf8)
  network_check(result.get("text") == UTF8_TEXT and int(result.get("blobSize", -1)) == UTF8_TEXT.to_utf8_buffer().size()
    and result.get("blobType") == "text/plain; charset=utf-8", "fetch/A multi-byte body reads back as text and its blob counts bytes, not characters")
  var latin1 := await run_case("A", "latin1")
  stages.latin1 = latin1
  result = result_of(latin1)
  network_check(result.get("text") == "ação" and int(result.get("blobSize", -1)) == 4 and result.get("blobType") == "text/plain; charset=iso-8859-1",
    "fetch/The Content-Type charset reaches the blob, and FileReader decodes ISO-8859-1 with it")
  var bom := await run_case("A", "bom")
  stages.bom = bom
  result = result_of(bom)
  network_check(result.get("viaFetch") == "\ufeffcom BOM" and result.get("viaXhr") == "com BOM",
    "fetch/Android's paths differ on a byte order mark: FileReader keeps it and XMLHttpRequest's text drops it")
  var bad := await run_case("A", "badUtf8")
  stages.badUtf8 = bad
  result = result_of(bad)
  network_check(result.get("viaFetch") == "a\ufffdb\ufffd" and result.get("viaXhr") == "a\ufffdb\ufffd",
    "fetch/Invalid UTF-8 becomes U+FFFD on both paths")
  var bytes := await run_case("A", "bytes")
  stages.bytes = bytes
  result = result_of(bytes)
  network_check(int(result.get("length", -1)) == 4096 and same_bytes(result.get("bytes"), pattern(4096))
    and result.get("sha256") == sha256(pattern(4096)), "fetch/arrayBuffer returns every byte of a binary body")
  var before_large := networking()
  var large := await run_case("A", "large")
  stages.large = large
  result = result_of(large)
  var after_large := networking()
  network_check(int(result.get("length", -1)) == 1048576 and str(result.get("declared")) == "1048576"
    and int(section(after_large, "transport").get("bytesReceived", 0)) - int(section(before_large, "transport").get("bytesReceived", 0)) >= 1048576
    and int(section(after_large, "transport").get("polls", 0)) - int(section(before_large, "transport").get("polls", 0)) >= 2,
    "fetch/A megabyte body arrives complete over several budgeted polls")
  var closing := await run_case("A", "closing")
  stages.closing = closing
  result = result_of(closing)
  var expected_fnv := fnv1a(pattern(70000))
  network_check(int(section(result, "sized").get("length", -1)) == 70000 and int(section(result, "sized").get("fnv", -1)) == expected_fnv
    and int(section(result, "chunked").get("length", -1)) == 70000 and int(section(result, "chunked").get("fnv", -1)) == expected_fnv,
    "fetch/A server that closes the connection right after its answer still delivers the whole body, sized or chunked")
  var status := await run_case("A", "status")
  stages.status = status
  result = result_of(status)
  network_check(section(result, "404").get("status") == 404.0 and section(result, "404").get("ok") == false and section(result, "404").get("text") == "status 404"
    and section(result, "500").get("status") == 500.0 and section(result, "204").get("status") == 204.0 and section(result, "204").get("text") == ""
    and section(result, "304").get("status") == 304.0 and section(result, "head").get("status") == 200.0 and section(result, "head").get("text") == ""
    and section(result, "head").get("contentType") == "text/plain", "fetch/HTTP errors are responses, and 204, 304 and HEAD carry no body")

  var echo_headers := await run_case("A", "echoHeaders")
  stages.echoHeaders = echo_headers
  result = result_of(echo_headers)
  var echoed := headers_of(section(result, "echo"))
  network_check(echoed.get("x-custom") == "one, two" and echoed.get("accept") == "application/json" and echoed.get("host") == "127.0.0.1:%d" % int(ports.http)
    and echoed.has("user-agent") and echoed.get("x-unicode") == latin1("ação".to_utf8_buffer()),
    "fetch/Request headers reach the server: joined repeats, Host from the URL and UTF-8 values as bytes")
  var response_headers := await run_case("A", "responseHeaders")
  stages.responseHeaders = response_headers
  result = result_of(response_headers)
  network_check(result.get("setCookie") == "a=1, b=2" and result.get("multi") == "one, two, three" and result.get("mixed") == "Value"
    and result.get("empty") == "" and result.get("has") == true,
    "fetch/Repeated response headers are joined with a comma, and names match case-insensitively")

  var cookies := await run_case("A", "cookies")
  stages.cookies = cookies
  result = result_of(cookies)
  network_check(result.get("setCookie") == "a=1, b=2" and result.get("sentCookie") == null and result.get("cleared") == false,
    "fetch/Cookies are neither stored nor sent, and clearCookies has nothing to clear")
  var post_json := await run_case("A", "postJson")
  stages.postJson = post_json
  result = result_of(post_json)
  var sent_json := str(result.get("sent"))
  var post_echo := section(result, "echo")
  network_check(post_echo.get("method") == "POST" and post_echo.get("bodySha256") == sha_text(sent_json)
    and int(post_echo.get("bodyBytes", -1)) == sent_json.to_utf8_buffer().size()
    and headers_of(post_echo).get("content-type") == "application/json", "fetch/A string body is sent as UTF-8 with the caller's content type")
  var default_type := await run_case("A", "postDefaultType")
  stages.postDefaultType = default_type
  post_echo = section(result_of(default_type), "echo")
  network_check(post_echo.get("bodySha256") == sha_text("só texto") and headers_of(post_echo).get("content-type") == "text/plain;charset=UTF-8",
    "fetch/A string body without a content type gets whatwg-fetch's own")
  var post_bytes := await run_case("A", "postBytes")
  stages.postBytes = post_bytes
  post_echo = section(result_of(post_bytes), "echo")
  var every_byte := PackedByteArray()
  for index in range(256):
    every_byte.append(index)
  network_check(post_echo.get("bodySha256") == sha256(every_byte) and int(post_echo.get("bodyBytes", -1)) == 256
    and headers_of(post_echo).get("content-length") == "256" and headers_of(post_echo).get("content-type") == "application/octet-stream",
    "fetch/A typed array body travels as base64 and arrives byte for byte")
  var no_type := await run_case("A", "postBytesNoType")
  stages.postBytesNoType = no_type
  network_check(is_failed_fetch(result_of(no_type)), "fetch/A binary body without a content type is refused, as on Android")
  var form := await run_case("A", "postFormData")
  stages.postFormData = form
  post_echo = section(result_of(form), "echo")
  var form_body := Marshalls.base64_to_raw(str(post_echo.get("bodyBase64", ""))).get_string_from_utf8()
  var form_type := str(headers_of(post_echo).get("content-type"))
  network_check(form_type.begins_with("multipart/form-data; boundary=") and form_body.contains("name=\"field\"\r\n\r\nação 日本語\r\n")
    and form_body.contains("name=\"plain\"\r\n\r\nabc\r\n") and form_body.ends_with("--" + form_type.get_slice("boundary=", 1) + "--\r\n"),
    "fetch/FormData is sent as multipart with a boundary and its parts")
  var form_file := await run_case("A", "postFormDataFile")
  stages.postFormDataFile = form_file
  network_check(is_failed_fetch(result_of(form_file)), "fetch/A FormData file part fails explicitly")
  var post_blob := await run_case("A", "postBlob")
  stages.postBlob = post_blob
  result = result_of(post_blob)
  post_echo = section(result, "echo")
  var blob_text := "olá mundo 😀"
  network_check(int(result.get("blobSize", -1)) == blob_text.to_utf8_buffer().size() and post_echo.get("bodySha256") == sha_text(blob_text)
    and headers_of(post_echo).get("content-type") == "text/plain;charset=utf-8", "fetch/A Blob body is sent with its bytes and its type")
  var log := await server_log()
  check(records_for(log, "/echo?case=post-bytes-no-type").is_empty() and records_for(log, "/echo?case=form-data-file").is_empty(),
    "fetch/Requests refused by the host never reach the server")

func redirect_stage() -> void:
  var redirect_302 := await run_case("A", "redirect302", {"id": "A"})
  stages.redirect302 = redirect_302
  var result := result_of(redirect_302)
  var echo := section(result, "echo")
  network_check(result.get("status") == 200.0 and result.get("url") == url_of("/echo?case=redirect-302-A") and echo.get("method") == "GET"
    and int(echo.get("bodyBytes", -1)) == 0 and not headers_of(echo).has("content-type") and not headers_of(echo).has("content-length")
    and headers_of(echo).get("x-keep") == "kept" and headers_of(echo).has("host"),
    "redirect/302 turns a POST into a GET without a body and reports the final URL")
  var redirect_307 := await run_case("A", "redirect307")
  stages.redirect307 = redirect_307
  result = result_of(redirect_307)
  echo = section(result, "echo")
  network_check(result.get("status") == 200.0 and echo.get("method") == "POST" and echo.get("bodySha256") == sha_text("payload-307")
    and headers_of(echo).get("content-type") == "text/plain", "redirect/307 keeps the method and the body")
  var twenty := await run_case("A", "redirectChain", {"hops": 20, "label": "20"})
  stages.redirectChain20 = twenty
  result = result_of(twenty)
  network_check(result.get("status") == 200.0 and result.get("text") == "chain end" and result.get("url") == url_of("/redirect-chain/0"),
    "redirect/Twenty follow-ups succeed")
  var twenty_one := await run_case("A", "redirectChain", {"hops": 21, "label": "21"})
  stages.redirectChain21 = twenty_one
  network_check(is_failed_fetch(result_of(twenty_one)), "redirect/The twenty-first follow-up fails")
  var loop := await run_case("A", "redirectLoop")
  stages.redirectLoop = loop
  network_check(is_failed_fetch(result_of(loop)), "redirect/A redirect loop ends in a network error")
  var origins := await run_case("A", "redirectOrigins")
  stages.redirectOrigins = origins
  result = result_of(origins)
  var same := section(result, "same")
  var cross := section(result, "cross")
  network_check(headers_of(same).get("authorization") == "Bearer secret" and headers_of(same).get("x-keep") == "kept"
    and not headers_of(cross).has("authorization") and headers_of(cross).get("x-keep") == "kept"
    and cross.get("url") == "/echo" and headers_of(cross).get("host") == "127.0.0.1:%d" % int(ports.other),
    "redirect/Authorization crosses no origin and Host follows the new URL")
  var scheme := await run_case("A", "redirectScheme")
  stages.redirectScheme = scheme
  result = result_of(scheme)
  network_check(result.get("status") == 302.0 and result.get("ok") == false and result.get("location") == "ftp://127.0.0.1/file" and result.get("text") == "elsewhere",
    "redirect/A redirect to a scheme the host cannot follow is delivered as the response")
  var log := await server_log()
  network_check(records_for(log, "/redirect-chain/").size() == 21 + 21 and records_for(log, "/redirect-loop").size() == 21,
    "redirect/The server saw 21 requests for each chain and for the loop: the request and 20 follow-ups")
  var requests_302 := records_for(log, "/redirect/302?to=%2Fecho%3Fcase%3Dredirect-302-A") + records_for(log, "/echo?case=redirect-302-A")
  network_check(requests_302.size() == 2 and requests_302[0].method == "POST" and requests_302[1].method == "GET" and int(requests_302[1].bodyBytes) == 0,
    "redirect/The server saw the POST and then the GET that replaced it")

func failure_stage() -> void:
  var gzip := await run_case("A", "gzip")
  stages.gzip = gzip
  var result := result_of(gzip)
  network_check(is_failed_fetch(section(result, "fetched")) and str(section(result, "xhr").get("responseText")).contains("Unsupported Content-Encoding")
    and event_types(section(result, "xhr").get("events")).has("error"), "failure/A compressed response fails explicitly instead of delivering raw bytes")
  var errors := await run_case("A", "networkErrors")
  stages.networkErrors = errors
  result = result_of(errors)
  network_check(is_failed_fetch(result.get("refused")) and is_failed_fetch(result.get("reset")),
    "failure/A refused connection and a reset one reject like Android's")
  var truncated := section(result, "truncated")
  var truncated_host := "127.0.0.1:%d" % int(ports.http)
  var truncated_reason := str(truncated.get("responseText"))
  network_check(event_states(truncated.get("events")) == [["readystatechange", 1, 0], ["readystatechange", 2, 200], ["readystatechange", 4, 200], ["error", 4, 200], ["loadend", 4, 200]]
    and ["unexpected end of stream from " + truncated_host,
      "Connection to " + truncated_host + " was lost while receiving the response"].has(truncated_reason),
    "failure/A body cut short after the headers ends in an error, not a load")
  network_check(is_failed_fetch(result.get("unsupported")) and is_failed_fetch(result.get("invalid"))
    and event_types(section(result, "method").get("events")).has("error"),
    "failure/An unsupported scheme, an invalid URL and an unsupported method are network errors")
  var requests := networking()
  stages.afterFailures = requests
  network_check(count_of(section(requests, "requests"), "failures") >= 6 and count_of(section(requests, "requests"), "inFlight") == 0,
    "failure/Every failed request left the in-flight set")

func https_stage() -> void:
  var trusted := await run_case("A", "https", {"origin": "https", "label": "trusted"})
  stages.httpsTrusted = trusted
  var result := result_of(trusted)
  network_check(result.get("status") == 200.0 and str(result.get("url")).begins_with("https://127.0.0.1:") and section(result, "body").get("message") == "hello",
    "https/A server certified by the authority the validation seam trusts answers over TLS")
  var untrusted := await run_case("A", "https", {"origin": "httpsUntrusted", "label": "untrusted"})
  stages.httpsUntrusted = untrusted
  network_check(is_failed_fetch(result_of(untrusted)), "https/A certificate from an authority that is not trusted is a network error")
  application.remove_meta(TRUST_META)
  var without := await run_case("A", "https", {"origin": "https", "label": "no-seam"})
  stages.httpsDefault = without
  network_check(is_failed_fetch(result_of(without)), "https/Without the seam only Godot's default roots are trusted, and the test authority is not among them")
  application.set_meta(TRUST_META, other_authority)
  var wrong := await run_case("A", "https", {"origin": "https", "label": "wrong"})
  var right := await run_case("A", "https", {"origin": "httpsUntrusted", "label": "right"})
  stages.httpsOther = {"wrong": wrong, "right": right}
  network_check(is_failed_fetch(result_of(wrong)) and result_of(right).get("status") == 200.0,
    "https/Trust follows the configured authority: the other server's certificate verifies and the first one's does not")
  application.set_meta(TRUST_META, "not a certificate")
  var invalid := await run_case("A", "https", {"origin": "https", "label": "invalid"})
  stages.httpsInvalid = invalid
  network_check(is_failed_fetch(result_of(invalid)), "https/Trust that is not valid PEM refuses the request instead of trusting everything")
  application.set_meta(TRUST_META, authority)
  # The engine prints a handshake error for each certificate it refuses: the runner expects these three.
  stages.deliberateTlsFailures = 3

func xhr_stage() -> void:
  var events := await run_case("A", "xhrEvents")
  stages.xhrEvents = events
  var result := result_of(events)
  network_check(event_states(result.get("events")) == [["readystatechange", 1, 0], ["readystatechange", 2, 200], ["readystatechange", 3, 200],
    ["readystatechange", 4, 200], ["load", 4, 200], ["loadend", 4, 200]] and result.get("responseURL") == url_of("/json")
    and result.get("contentType") == "application/json; charset=utf-8" and result.get("missing") == null
    and result.get("json") == JSON_BODY,
    "xhr/The states and events follow RN's order, with the response URL and headers")
  network_check(str(result.get("allHeaders")).contains("content-type: application/json; charset=utf-8\r\n"), "xhr/getAllResponseHeaders lists the headers RN's way")
  var minimal := await run_case("A", "xhrMinimal")
  stages.xhrMinimal = minimal
  result = result_of(minimal)
  network_check(event_types(result.get("events")) == ["load"] and result.get("status") == 200.0 and str(result.get("responseText")).begins_with("{\"message\":\"hello\""),
    "xhr/A request without readystatechange or progress listeners still loads")
  var incremental := await run_case("A", "xhrIncremental")
  stages.xhrIncremental = incremental
  network_check(result_of(incremental).get("status") == 200.0 and str(result_of(incremental).get("responseText")).begins_with("{\"message\":\"hello\""),
    "xhr/Asking for incremental updates still delivers the body")
  var types := await run_case("A", "xhrTypes")
  stages.xhrTypes = types
  result = result_of(types)
  network_check(same_bytes(section(result, "arraybuffer").get("bytes"), pattern(512)) and section(result, "json").get("value") == JSON_BODY
    and section(result, "text").get("responseText") == UTF8_TEXT, "xhr/The arraybuffer, json and text response types return the body")
  var blob := section(result, "blob")
  network_check(int(blob.get("size", -1)) == UTF8_TEXT.to_utf8_buffer().size() and blob.get("type") == "text/plain; charset=utf-8" and blob.get("text") == UTF8_TEXT
    and int(section(result, "emptyBlob").get("size", -1)) == 0 and section(result, "failedBlob").get("response") == "object"
    and event_types(section(result, "failedBlob").get("events")).has("error"), "xhr/The blob response type returns a blob of the body, an empty one for 204 and for a failure")
  var errors := await run_case("A", "xhrHttpErrors")
  stages.xhrHttpErrors = errors
  result = result_of(errors)
  network_check(event_types(section(result, "notFound").get("events")).has("load") and not event_types(section(result, "notFound").get("events")).has("error")
    and section(result, "notFound").get("status") == 404.0 and section(result, "notFound").get("responseText") == "status 404"
    and section(result, "failure").get("status") == 500.0, "xhr/4xx and 5xx statuses are loads, never errors")

func contract_stage() -> void:
  var contract := await run_case("A", "contract")
  stages.contract = contract
  var result := result_of(contract)
  var text := section(result, "text")
  var id: Variant = text.get("requestId")
  var names: Array = text.get("events", []).map(func(event: Dictionary) -> String: return event.name)
  var response: Array = text.get("events", [{"payload": []}])[0].payload
  network_check(id is float and int(id) >= 1 and names == ["didReceiveNetworkResponse", "didReceiveNetworkData", "didCompleteNetworkResponse"]
    and response.size() == 4 and response[0] == id and response[1] == 200.0 and response[3] == url_of("/utf8?contract=text")
    and section({"headers": response[2]}, "headers").get("Content-Type") == "text/plain; charset=utf-8",
    "contract/A response arrives as didReceiveNetworkResponse [id, status, headers, url], didReceiveNetworkData and didCompleteNetworkResponse in order")
  var events: Array = text.get("events", [])
  network_check(events.size() == 3 and events[1].payload == [id, UTF8_TEXT] and events[2].payload == [id, null],
    "contract/The data event carries the decoded text and a success completes with a null error")
  var base64: Array = section(result, "base64").get("events", [])
  network_check(base64.size() == 3 and base64[1].payload[1] == Marshalls.raw_to_base64(pattern(16)),
    "contract/The base64 response type delivers the body as base64 text")
  var reset: Array = section(result, "reset").get("events", [])
  network_check(reset.size() == 1 and reset[0].name == "didCompleteNetworkResponse" and reset[0].payload.size() == 2
    and str(reset[0].payload[1]).contains("was lost before a response arrived"),
    "contract/A failure before any response is a single didCompleteNetworkResponse [id, message]")
  var timeout: Array = section(result, "timeout").get("events", [])
  network_check(timeout.size() == 1 and timeout[0].payload.size() == 3 and timeout[0].payload[1] == "The request timed out." and timeout[0].payload[2] == true,
    "contract/A time-out completes with [id, message, true]")

func blob_stage() -> void:
  var before := networking()
  var blobs := await run_case("A", "blobs")
  var after := networking()
  stages.blobs = blobs
  var result := result_of(blobs)
  var text := "ação 日本語 😀"
  var whole := (text + " e mais").to_utf8_buffer()
  network_check(int(result.get("size", -1)) == whole.size() and result.get("type") == "text/plain;charset=utf-8"
    and int(result.get("sliceSize", -1)) == 6 and result.get("sliceType") == "application/x-slice" and result.get("text") == text + " e mais",
    "blob/A Blob counts the bytes of its parts and FileReader reads them back")
  network_check(result.get("latin1") == "abc" and result.get("dataUrl") == "data:text/plain;charset=utf-8;base64," + Marshalls.raw_to_base64(whole)
    and result.get("untyped") == "data:application/octet-stream;base64,eA==" and same_bytes(result.get("arrayBuffer"), whole.slice(2, 8)),
    "blob/readAsDataURL, readAsArrayBuffer and slices read the right bytes")
  var file := section(result, "file")
  network_check(file.get("name") == "nota.txt" and int(file.get("size", -1)) == "conteúdo".to_utf8_buffer().size() and file.get("type") == "text/plain"
    and int(file.get("lastModified", 0)) == 1234 and file.get("text") == "conteúdo" and str(result.get("objectUrl")).begins_with("blob:<id>?offset=0&size="),
    "blob/File and URL.createObjectURL work over the native store")
  network_check(str(section(result, "badEncoding").get("message")).contains("E_UNSUPPORTED_ENCODING")
    and error_is(result.get("badRead"), "Error", "E_INVALID_BLOB: The specified blob is invalid")
    and error_is(result.get("badSlice"), "Error", "outside the specified blob") and str(result.get("closed")).contains("closed"),
    "blob/Unreadable blobs, ranges and encodings reject the FileReader's promise")
  var blobs_before := section(before, "blobs")
  var blobs_after := section(after, "blobs")
  # Every blob that was stored left by JS closing it or by the collector, or is still held: the store's books balance.
  var made := count_of(blobs_after, "stored") - count_of(blobs_before, "stored")
  network_check(made >= 5 and count_of(blobs_after, "closed") - count_of(blobs_before, "closed") == made and books_balance(blobs_after),
    "blob/Every blob the case made is closed by JS and released from the store, and the store's books balance")
  network_check(count_of(blobs_after, "networkingHandlers") >= 1, "blob/XMLHttpRequest announced itself to the BlobModule")
  # fetch leaves a blob for each response and nothing in whatwg-fetch closes it: only the collector can.
  var started := section(networking(), "blobs")
  var unclosed := await run_case("A", "unclosed")
  stages.unclosed = unclosed
  network_check(count_of(section(networking(), "blobs"), "stored") - count_of(started, "stored") >= 5,
    "blob/fetch makes a native blob for every response, and the case never closes them")
  var churned := [0]
  var collected := native_available and await wait_until(func() -> bool:
    churned[0] += 1
    application.call("evaluate", "NetworkingProbe.churn()")
    return count_of(section(networking(), "blobs"), "count") <= count_of(started, "count"))
  var settled := section(networking(), "blobs")
  stages.collection = {"churned": churned[0], "before": started, "after": settled}
  network_check(collected and count_of(settled, "collected") - count_of(started, "collected") >= 5
    and count_of(settled, "released") - count_of(started, "released") >= 5,
    "blob/The garbage collector releases the response blobs nothing closed, so the native store does not grow")

# count == stored - closed - collected: a blob is held, or was closed by JS, or was collected.
func books_balance(blobs: Dictionary) -> bool:
  return count_of(blobs, "count") == count_of(blobs, "stored") - count_of(blobs, "closed") - count_of(blobs, "collected")

func roots_stage() -> void:
  var a := begin("A", "concurrent")
  var b := begin("B", "concurrent")
  var a_done := await finished(a)
  var b_done := await finished(b)
  var both_done := a_done and b_done
  var a_entry := entry_of(a)
  var b_entry := entry_of(b)
  stages.concurrent = {"A": a_entry, "B": b_entry}
  check(both_done, "roots/Both roots' requests end")
  for root_name: String in ["A", "B"]:
    var result := result_of(a_entry if root_name == "A" else b_entry)
    var post := section(result, "post")
    network_check(section(result, "json").get("message") == "hello" and result.get("text") == UTF8_TEXT and same_bytes(result.get("bytes"), pattern(64))
      and post.get("url") == "/echo?root=" + root_name and post.get("bodySha256") == sha_text("from root " + root_name),
      "roots/Root %s receives only its own responses from four requests in flight at once" % root_name)
  var state := networking()
  check(count_of(section(state, "requests"), "inFlight") == 0, "roots/Nothing is left in flight")

func abort_stage() -> void:
  var before := networking()
  # fetch + AbortController while the server holds the request
  var key := begin("A", "hangFetch", {"name": "abort-fetch"})
  var held := await wait_for_hold("abort-fetch", "waiting")
  network_check(held, "abort/The server received the request and holds it")
  application.call("evaluate", "NetworkingProbe.abort('abort-fetch')")
  var done := await finished(key)
  var entry := entry_of(key)
  stages.abortFetch = entry
  network_check(done and error_is(result_of(entry), "AbortError", "Aborted"), "abort/AbortController rejects the fetch with an AbortError")
  var closed := await wait_for_hold("abort-fetch", "closed-by-client")
  network_check(closed, "abort/Aborting closes the connection the server was holding")
  # no event reaches JS after the abort, even once the server lets go
  var settled_log: Variant = js("NetworkingProbe.snapshot().log.length")
  await release("abort-fetch")
  await frames(30)
  check(js("NetworkingProbe.snapshot().log.length") == settled_log and status_of(key) == "done", "abort/A released request that was aborted delivers nothing")
  var already := await run_case("A", "abortedBefore")
  stages.abortedBefore = already
  check(error_is(result_of(already), "AbortError", "Aborted"), "abort/A signal that is already aborted rejects without a request")
  var log := await server_log()
  check(records_for(log, "/echo?case=aborted-before").is_empty(), "abort/An already aborted fetch never reached the server")

  # XMLHttpRequest.abort() after the headers arrived and the body is still coming
  var xhr_key := begin("B", "hangXhr", {"name": "abort-xhr", "body": true})
  await wait_for_hold("abort-xhr", "waiting")
  var headers_seen := native_available and await wait_until(func() -> bool: return event_states(js("NetworkingProbe.xhrEvents('abort-xhr')")).has(["readystatechange", 2, 200]))
  network_check(headers_seen, "abort/The headers of a response whose body is still coming reach XMLHttpRequest")
  application.call("evaluate", "NetworkingProbe.abortXhr('abort-xhr')")
  await finished(xhr_key)
  var xhr_entry := entry_of(xhr_key)
  stages.abortXhr = xhr_entry
  var xhr_result := result_of(xhr_entry)
  network_check(event_states(xhr_result.get("events")).slice(-3) == [["readystatechange", 4, 0], ["abort", 4, 0], ["loadend", 4, 0]]
    and not event_types(xhr_result.get("events")).has("load") and not event_types(xhr_result.get("events")).has("error"),
    "abort/XMLHttpRequest.abort() dispatches readystatechange, abort and loadend and never load or error")
  network_check(await wait_for_hold("abort-xhr", "closed-by-client"), "abort/Aborting an XMLHttpRequest in its body closes the connection")
  var xhr_log: Variant = js("(NetworkingProbe.xhrEvents('abort-xhr') ?? []).length")
  await release("abort-xhr")
  await frames(30)
  check(js("(NetworkingProbe.xhrEvents('abort-xhr') ?? []).length") == xhr_log, "abort/Nothing more reaches an XMLHttpRequest that was aborted")

  # A request's own timeout, on a clock the validation moves: the deadline is a minute away, the server holds the request,
  # and only then does the clock jump past it, so the outcome does not depend on how fast anything ran.
  var timeout_key := begin("A", "hangXhr", {"name": "timeout-xhr", "timeout": 60000})
  var held_for_timeout := await wait_for_hold("timeout-xhr", "waiting")
  var still_waiting := status_of(timeout_key) == "running"
  application.set_meta("validation_clock_offset_ms", 120000.0)
  await finished(timeout_key)
  var timeout_entry := entry_of(timeout_key)
  stages.timeout = timeout_entry
  var timeout_result := result_of(timeout_entry)
  network_check(held_for_timeout and still_waiting and event_types(timeout_result.get("events")).slice(-3) == ["readystatechange", "timeout", "loadend"] and not event_types(timeout_result.get("events")).has("error")
    and timeout_result.get("status") == 0.0 and timeout_result.get("responseText") == "The request timed out.",
    "abort/A request that outlives its timeout ends with a timeout event and no status")
  network_check(await wait_for_hold("timeout-xhr", "closed-by-client"), "abort/The timed out request closes its connection")
  await release("timeout-xhr")
  var natural := await run_case("A", "timeoutReal")
  stages.timeoutReal = natural
  var natural_result := result_of(natural)
  network_check(event_types(natural_result.get("events")).slice(-3) == ["readystatechange", "timeout", "loadend"] and natural_result.get("status") == 0.0
    and natural_result.get("responseText") == "The request timed out.",
    "abort/A request to a port that never answers times out on the real clock")
  # a blob request that is aborted creates no blob
  var blobs_stored := count_of(section(networking(), "blobs"), "stored")
  var blob_key := begin("B", "hangXhr", {"name": "abort-blob", "responseType": "blob"})
  await wait_for_hold("abort-blob", "waiting")
  application.call("evaluate", "NetworkingProbe.abortXhr('abort-blob')")
  await finished(blob_key)
  network_check(await wait_for_hold("abort-blob", "closed-by-client") and count_of(section(networking(), "blobs"), "stored") == blobs_stored,
    "abort/Aborting a blob request makes no blob")
  await release("abort-blob")
  var after := networking()
  stages.afterAborts = after
  network_check(count_of(section(after, "requests"), "aborted") - count_of(section(before, "requests"), "aborted") == 3
    and count_of(section(after, "transport"), "timedOut") - count_of(section(before, "transport"), "timedOut") == 2
    and count_of(section(after, "requests"), "inFlight") == 0, "abort/The native side counted the aborts and the time-out, and holds nothing")
  var requests := section(after, "requests")
  network_check(count_of(requests, "sent") > 0 and count_of(requests, "sent") == count_of(requests, "completions") + count_of(requests, "failures") + count_of(requests, "aborted") - count_of(requests, "refused"),
    "abort/Every accepted request ended exactly one way: completed, failed or aborted")

func stop_stage() -> void:
  var hangs := {"stop-a": begin("A", "hangStays", {"kind": "fetch", "name": "stop-a", "label": "a"}),
    "stop-b": begin("B", "hangStays", {"kind": "xhr", "name": "stop-b", "body": true, "label": "b"}),
    "stop-c": begin("A", "hangStays", {"kind": "xhr", "name": "stop-c", "responseType": "blob", "label": "c"})}
  var held := true
  for name: String in hangs:
    held = held and await wait_for_hold(name, "waiting")
  var hangs_started := held
  network_check(held, "stop/Three requests, a fetch, an XMLHttpRequest in its body and a blob request, are in flight at the server")
  var in_flight := native_available and await wait_until(func() -> bool: return event_states(js("NetworkingProbe.xhrEvents('stop-b')")).has(["readystatechange", 2, 200]))
  var before := networking()
  stages.beforeStop = before
  network_check(in_flight and count_of(section(before, "requests"), "inFlight") == 3, "stop/The application counts them in flight and JS has seen the headers of one")
  var delivered_before := count_of(section(before, "events"), "delivered")
  var log_before: Variant = js("NetworkingProbe.snapshot().log")
  application.call("stop")
  await frames(4)
  var stopped := native()
  stages.stopped = stopped
  var networking_after: Dictionary = section(stopped, "networking")
  network_check(networking_after.get("stopped") == true and count_of(section(networking_after, "requests"), "inFlight") == 0
    and count_of(section(networking_after, "transport"), "active") == 0
    and count_of(section(networking_after, "transport"), "cancelled") - count_of(section(before, "transport"), "cancelled") == 3
    and count_of(section(networking_after, "blobs"), "count") == 0, "stop/Stopping cancels the requests in flight, releases the blobs and leaves nothing active")
  var closed := true
  for name: String in hangs:
    closed = closed and await wait_for_hold(name, "closed-by-client")
  network_check(closed, "stop/The server saw each connection closed by the client")
  for name: String in hangs:
    await release(name)
  await frames(30)
  var log_after: Array = js("NetworkingProbe.snapshot().log")
  var appended: Array = log_after.slice(log_before.size())
  var appended_events := appended.map(func(row: Dictionary) -> String: return str(row.event) + ":" + str(row.get("name", "")))
  network_check(hangs_started and (appended_events == ["cleanup:A", "cleanup:B"] or appended_events == ["cleanup:B", "cleanup:A"]),
    "stop/Stop runs the roots' cleanups and nothing else reaches JS: no load, error, abort or timeout of the requests in flight")
  var final_events := count_of(section(networking_after, "events"), "delivered")
  network_check(final_events == delivered_before and final_events > 0 and count_of(section(networking_after, "events"), "queued")
    == count_of(section(networking_after, "events"), "delivered") + count_of(section(networking_after, "events"), "dropped"),
    "stop/No device event was delivered by the stopped application, and every queued one is accounted for")
  var after_stop: Dictionary = js("NetworkingProbe.afterStop()")
  stages.afterStop = after_stop
  network_check(str(after_stop.get("send")).contains("E_MODULE_DISPOSED") and str(after_stop.get("clearCookies")).contains("E_MODULE_DISPOSED")
    and str(after_stop.get("constants")).contains("E_MODULE_DISPOSED") and str(after_stop.get("createFromParts")).contains("E_MODULE_DISPOSED")
    and str(after_stop.get("read")).contains("E_MODULE_DISPOSED") and str(after_stop.get("lookup")).contains("E_RUNTIME_STOPPED"),
    "stop/Retained module methods and a new lookup are refused after stop")
  network_check(after_stop.get("abort") == "returned" and after_stop.get("release") == "returned", "stop/Late cleanup, abortRequest and release, stays harmless")
  var environment: Dictionary = section(js("NetworkingProbe.snapshot()"), "environment")
  var subscribed := int(environment.get("networking", 0))
  var disposed: Dictionary = js("NetworkingProbe.dispose()")
  stages.disposed = disposed
  network_check(subscribed > 0 and section(disposed, "environment").get("networking") == 0.0,
    "stop/disposeEnvironment releases the device subscriptions of the requests that were still in flight")
  var roots: Dictionary = section(js("NetworkingProbe.snapshot()"), "roots")
  check(section(roots, "A").get("mounted") == false and section(roots, "B").get("mounted") == false and int(stopped.rootCount) == 0 and stopped.errors.is_empty(),
    "stop/Stop releases both roots without a host diagnostic")

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
  var report := {"scenario": "networking", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages, "ports": ports,
    "expectedOriginalFailures": expected_original_failures, "allowOriginalNegative": allow_original_negative,
    "originalNegativeObserved": original_negative_observed, "allCurrentAssertionsPassed": failures.is_empty(),
    "sabotage": sabotage,
    "scope": {"publicReactNativeImport": true, "originalRNJavaScript": true, "twoRootsOneApplication": true,
      "serverIsLoopbackNode": true, "tlsAuthorityThroughValidationSeam": true, "webSocketCertified": false, "cookiesCertified": false,
      "compressionCertified": false, "http2Certified": false, "uploadProgressCertified": false, "fileBodiesCertified": false}}
  var output := FileAccess.open("res://build/networking-report.json", FileAccess.WRITE)
  if not check(output != null, "report/The networking report is saved with any normative failure visible"):
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  output.close()
  var marker := "NETWORKING_SABOTAGE_REJECTED: " + str(failures.size()) if sabotage and not failures.is_empty() else "NETWORKING_SABOTAGE_NOT_REJECTED"
  var message := "NETWORKING_ORIGINAL_NEGATIVE: " + str(failures.size()) if original_negative_observed else "NETWORKING_PASSED: " + str(checks.size()) if failures.is_empty() else "NETWORKING_FAILED"
  print(marker if sabotage else message)
  quit(0 if failures.is_empty() or original_negative_observed or (sabotage and not failures.is_empty()) else 1)
