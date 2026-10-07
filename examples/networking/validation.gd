extends Node

# The public networking example under real mouse input. The scene starts a small HTTP server and a WebSocket echo
# server on loopback and hands their addresses to the React screen, whose buttons call RN's own fetch, FormData,
# AbortController and WebSocket. Each state is read from the native tree (the labels and the status badge the host
# drew), from what React observed, from what the servers received and from the application's networking module;
# with --capture the renderer's frame is saved and the badge's color sampled in it.
const DEVICE := 1001
const BUTTONS := ["net-json", "net-text", "net-form", "net-redirect", "net-slow", "net-abort",
  "ws-connect", "ws-send", "ws-binary", "ws-close", "ws-server-close", "ws-drop"]
const BADGE_IDLE := "475569ff"
const BADGE_PENDING := "d97706ff"
const BADGE_OK := "16a34aff"
const BADGE_FAILED := "dc2626ff"
const LocalServer := preload("res://examples/networking/local_server.gd")
var server := LocalServer.new()
var checks: Array = []
var stages: Dictionary = {}
var pages: Dictionary = {}
var capturing := false
@onready var application: Node = $Application
@onready var surface: Control = $Surface

# The server must be listening before the screen renders: its address is a prop of the root.
func _enter_tree() -> void:
  if server.start() != OK:
    push_error("FABRIC_ERROR: The example's local server could not listen on loopback")
  get_node("Surface").set("initial_props", {"baseUrl": "http://127.0.0.1:%d" % server.port, "socketUrl": "ws://127.0.0.1:%d/echo" % server.socket_port})

func _process(_delta: float) -> void:
  server.poll()

func _exit_tree() -> void:
  server.stop()

func verify(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
    print("FAILED_SCREEN: ", ["net-status", "net-url", "net-type", "net-body", "net-log", "ws-status", "ws-protocol", "ws-last", "ws-log"].map(func(id: String) -> String: return id + "=" + text(id)))
  return condition

func frames(count: int = 1) -> void:
  for index in range(count):
    await get_tree().process_frame

func wait_for(condition: Callable, limit_ms: int = 20000) -> bool:
  var started := Time.get_ticks_msec()
  while Time.get_ticks_msec() - started < limit_ms and not condition.call():
    await frames()
  return condition.call()

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(" + expression + ")"))

func example() -> Dictionary:
  var value: Variant = js("globalThis.NetworkingExample.state()")
  return value if value is Dictionary else {}

func native_state() -> Dictionary:
  var value: Variant = JSON.parse_string(application.call("snapshot"))
  return value if value is Dictionary else {}

func module() -> Dictionary:
  var value: Variant = native_state().get("networking", {})
  return value if value is Dictionary else {}

func section(value: Dictionary, key: String) -> Dictionary:
  var inner: Variant = value.get(key, {})
  return inner if inner is Dictionary else {}

func node_of(id: String) -> Dictionary:
  var value: Variant = JSON.parse_string(surface.call("snapshot"))
  var nodes: Variant = value.get("nodes", []) if value is Dictionary else []
  for entry: Dictionary in nodes:
    if entry.get("testID") == id:
      return entry
  return {}

func text(id: String) -> String:
  return str(node_of(id).get("nativeText", ""))

func badge(id := "net-badge") -> String:
  var appearance: Variant = node_of(id).get("appearance")
  return str(appearance.get("background")) if appearance is Dictionary else ""

func control(id: String) -> Control:
  return surface.find_child(id, true, false) as Control

func at(id: String) -> Vector2:
  return control(id).get_global_rect().get_center()

func mouse(phase: String, point: Vector2) -> void:
  if phase == "down":
    var motion := InputEventMouseMotion.new()
    motion.device = DEVICE
    motion.position = point
    Input.parse_input_event(motion)
  var button := InputEventMouseButton.new()
  button.device = DEVICE
  button.position = point
  button.button_index = MOUSE_BUTTON_LEFT
  button.pressed = phase == "down"
  button.button_mask = MOUSE_BUTTON_MASK_LEFT if phase == "down" else 0
  Input.parse_input_event(button)
  await frames(2)

func click(id: String) -> void:
  var point := at(id)
  await mouse("down", point)
  await frames(3)
  await mouse("up", point)
  await frames(2)

# The readback rectangle of a Control, in the physical pixels of the saved frame.
func region(node: Control) -> Rect2i:
  var physical := get_window().get_final_transform() * node.get_global_rect()
  return Rect2i(Vector2i(physical.position.round()), Vector2i(physical.size.round()))

func close(a: Color, b: Color) -> bool:
  return absf(a.r - b.r) < 6.0 / 255.0 and absf(a.g - b.g) < 6.0 / 255.0 and absf(a.b - b.b) < 6.0 / 255.0

# The badge's own pixels, a few inside its rectangle, show the state's color in the renderer's frame.
func capture(stage: String, expected: String, badge_id := "net-badge", prefix := "networking") -> void:
  if not capturing:
    return
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  verify(image.save_png("res://build/%s-%s.png" % [prefix, stage]) == OK, "Renderer capture saved: " + stage)
  var area := region(control(badge_id))
  var frame := Rect2i(Vector2i.ZERO, image.get_size())
  var inside := area.has_area() and frame.encloses(area)
  var sampled := image.get_pixelv(area.position + Vector2i(3, area.size.y / 2)) if inside else Color()
  pages[stage] = sampled.to_html(false)
  verify(inside and close(sampled, Color.html("#" + expected)), "The renderer painted the status badge in the state's color: " + stage)

func requests_after(count: int) -> Array:
  return server.requests.slice(count)

func _ready() -> void:
  if not OS.get_cmdline_user_args().has("--validate"):
    return
  capturing = OS.get_cmdline_user_args().has("--capture")
  surface.set_meta("validation_input_device", DEVICE)
  await run()

func run() -> void:
  var base := "http://127.0.0.1:%d" % server.port
  var mounted := await wait_for(func() -> bool: return control("net-root") != null and BUTTONS.all(func(id: String) -> bool: return control(id) != null))
  verify(mounted, "The public example mounts its screen with its HTTP and WebSocket buttons")
  await frames(10)
  stages.idle = {"example": example(), "module": module()}
  verify(text("net-status") == "No request yet" and badge() == BADGE_IDLE and text("net-log") == "No requests yet" and server.requests.is_empty(),
    "Nothing has been requested: the badge is idle and the server has seen nothing")
  verify(not module().is_empty() and section(module(), "transport").get("transport") == "godot-http-client"
    and section(section(module(), "webSocket"), "transport").get("transport") == "godot-websocket-peer",
    "The application's networking module runs on the Godot transports, for HTTP and for sockets")
  await capture("idle", BADGE_IDLE)

  # GET JSON: RN's fetch(), Response.json() and headers over a real HTTP exchange.
  await click("net-json")
  var json_done := await wait_for(func() -> bool: return text("net-status") == "GET JSON: 200")
  stages.json = {"example": example(), "requests": server.requests.duplicate(true)}
  verify(json_done and text("net-url") == base + "/api/profile" and text("net-type") == "application/json; charset=utf-8"
    and text("net-body") == "Olá do servidor local · 3 items" and badge() == BADGE_OK,
    "GET JSON shows the status, the final URL, the content type and the parsed body, and the badge turns green")
  verify(server.requests.size() == 1 and server.requests[0].method == "GET" and server.requests[0].target == "/api/profile",
    "The server received exactly one GET for /api/profile")
  await capture("json", BADGE_OK)

  # GET text: a UTF-8 body with accents is decoded through the response's blob.
  var seen := server.requests.size()
  await click("net-text")
  var text_done := await wait_for(func() -> bool: return text("net-status") == "GET text: 200")
  var text_requests := requests_after(seen)
  stages.text = {"example": example(), "requests": text_requests}
  verify(text_done and text("net-body") == "Zażółć gęślą jaźń — do servidor, com acentos" and text("net-type") == "text/plain; charset=utf-8",
    "GET text decodes the multi-byte UTF-8 body")
  verify(text_requests.size() == 1 and text_requests[0].method == "GET" and text_requests[0].target == "/api/text",
    "The server received exactly one GET for /api/text")

  # POST form: FormData travels as multipart with a boundary and its two parts.
  seen = server.requests.size()
  await click("net-form")
  var form_done := await wait_for(func() -> bool: return text("net-status") == "POST form: 200")
  var form_requests := requests_after(seen)
  stages.form = {"example": example(), "requests": form_requests}
  verify(form_done and text("net-body") == "POST · name=Ana · note=olá, servidor", "POST form shows the fields the server found in the multipart body")
  verify(form_requests.size() == 1 and form_requests[0].method == "POST" and form_requests[0].type.begins_with("multipart/form-data; boundary=")
    and form_requests[0].body.contains("name=\"note\"\r\n\r\nolá, servidor"), "The server received one multipart POST with both parts")
  await capture("form", BADGE_OK)

  # Redirect: the host follows the 302 itself and reports the final URL.
  seen = server.requests.size()
  await click("net-redirect")
  var redirect_done := await wait_for(func() -> bool: return text("net-status") == "GET redirect: 200")
  var redirect_requests := requests_after(seen)
  stages.redirect = {"example": example(), "requests": redirect_requests}
  verify(redirect_done and text("net-url") == base + "/api/profile?from=redirect" and text("net-body") == "Olá do servidor local · followed one redirect",
    "The redirect is followed and the final URL is the one the server pointed to")
  verify(redirect_requests.size() == 2 and redirect_requests[0].target == "/api/redirect" and redirect_requests[1].target == "/api/profile?from=redirect",
    "The server saw the request and the follow-up the host made")
  await capture("redirect", BADGE_OK)

  # Slow + Abort: the server never answers, and AbortController ends the request.
  await click("net-slow")
  var pending := await wait_for(func() -> bool: return text("net-status") == "GET slow …" and server.requests.size() == seen + 3)
  stages.pending = {"example": example(), "requests": requests_after(seen + 2)}
  verify(pending and badge() == BADGE_PENDING and example().get("pending") == true and section(module(), "requests").get("inFlight") == 1,
    "A request the server never answers stays in flight, the badge is amber and the module counts it")
  await capture("pending", BADGE_PENDING)
  await click("net-abort")
  var aborted := await wait_for(func() -> bool: return text("net-status") == "GET slow: AbortError" and server.abandoned == 1)
  stages.aborted = {"example": example(), "abandoned": server.abandoned, "module": module()}
  verify(aborted and badge() == BADGE_FAILED and text("net-body") == "Aborted" and text("net-log").begins_with("5. GET slow → aborted"),
    "Abort ends the request with an AbortError and the badge turns red")
  verify(server.abandoned == 1 and section(module(), "requests").get("aborted") == 1 and section(module(), "requests").get("inFlight") == 0,
    "The server saw the connection closed and the module holds nothing")
  await capture("aborted", BADGE_FAILED)

  var requests := section(module(), "requests")
  var transport := section(module(), "transport")
  verify(int(requests.get("sent", 0)) == 5 and int(requests.get("completions", 0)) == 4 and int(transport.get("redirectsFollowed", 0)) == 1
    and example().get("operations", []).size() == 5 and native_state().get("errors", []).is_empty(),
    "Five requests were sent, four completed, one redirect was followed and the run raised no host error")
  await run_sockets()
  await finish()

# The WebSocket card: connect (with two subprotocols offered), echo a text and a binary message, and end the socket the
# three ways it can end: by the server's close, by a cut connection, and by its own close.
func web_socket() -> Dictionary:
  return section(module(), "webSocket")

func socket_events() -> Array:
  var value: Variant = example().get("socket", {}).get("events", [])
  return value if value is Array else []

func run_sockets() -> void:
  var url := "ws://127.0.0.1:%d/echo" % server.socket_port
  stages.socketIdle = {"example": example(), "module": web_socket()}
  verify(text("ws-status") == "No socket yet" and badge("ws-badge") == BADGE_IDLE and text("ws-url") == url and text("ws-log") == "No messages yet"
    and server.socket_events.is_empty() and server.open_sockets() == 0 and int(web_socket().get("connects", -1)) == 0,
    "No socket has been opened: the WebSocket badge is idle and the server has seen nothing")

  # Connect: the handshake offers echo.v2 and echo.v1, and the server speaks echo.v1.
  await click("ws-connect")
  var opened := await wait_for(func() -> bool: return text("ws-status") == "WebSocket: open")
  stages.socketOpen = {"example": example(), "serverEvents": server.socket_events.duplicate(true), "module": web_socket()}
  verify(opened and text("ws-protocol") == "echo.v1" and text("ws-last") == "Connected: send something" and badge("ws-badge") == BADGE_OK
    and text("ws-log") == "1. open (echo.v1)", "Connect opens the socket: the server chose echo.v1 of the two protocols offered, and the badge turns green")
  verify(server.socket_events == [{"event": "open", "protocol": "echo.v1"}] and section(web_socket(), "sockets").get("open") == 1
    and section(web_socket(), "transport").get("opened") == 1, "The server accepted one socket and the module counts it open")
  await capture("open", BADGE_OK, "ws-badge", "websocket")

  # Send: a text message with accents comes back from the server, byte for byte.
  await click("ws-send")
  var echoed := await wait_for(func() -> bool: return text("ws-last") == "olá, servidor")
  stages.socketEcho = {"example": example(), "serverEvents": server.socket_events.duplicate(true), "module": web_socket()}
  verify(echoed and text("ws-log").begins_with("3. echo ← olá, servidor") and badge("ws-badge") == BADGE_OK,
    "Send shows the text the server echoed, accents included")
  verify(server.socket_events.size() == 2 and server.socket_events[1] == {"event": "message", "text": true, "bytes": "olá, servidor".to_utf8_buffer().size(), "value": "olá, servidor"},
    "The server received that one text message")
  await capture("echo", BADGE_OK, "ws-badge", "websocket")

  # Binary: four bytes, one of them over 127, are echoed as an ArrayBuffer.
  await click("ws-binary")
  var binary_echoed := await wait_for(func() -> bool: return text("ws-last") == "4 bytes: 1 2 3 250")
  stages.socketBinary = {"example": example(), "serverEvents": server.socket_events.duplicate(true)}
  verify(binary_echoed and server.socket_events.size() == 3 and server.socket_events[2] == {"event": "message", "text": false, "bytes": 4, "value": ""},
    "Binary sends four bytes, the server receives them as a binary message and they come back as the same four bytes")

  # Server close: the server ends the socket with 4001 and a reason, and the page shows that exact close.
  await click("ws-server-close")
  var server_closed := await wait_for(func() -> bool: return text("ws-status") == "WebSocket: closed 4001")
  stages.socketServerClose = {"example": example(), "serverEvents": server.socket_events.duplicate(true), "module": web_socket()}
  verify(server_closed and text("ws-last") == "closed by the server" and badge("ws-badge") == BADGE_IDLE and socket_events().slice(-1) == ["close 4001 closed by the server"],
    "A close the server starts arrives with its code and reason, and the badge goes back to gray")
  var closed_events := server.socket_events.filter(func(row: Dictionary) -> bool: return row.event == "closed")
  verify(closed_events.size() == 1 and closed_events[0].code == 4001 and section(web_socket(), "sockets").get("open") == 0,
    "The server saw the close handshake finish and the module holds no socket")
  await capture("server-close", BADGE_IDLE, "ws-badge", "websocket")

  # Drop: the server cuts the connection with no close frame, which is an error and a close with code 1006.
  await click("ws-connect")
  await wait_for(func() -> bool: return text("ws-status") == "WebSocket: open")
  await click("ws-drop")
  var dropped := await wait_for(func() -> bool: return text("ws-status") == "WebSocket: failed")
  stages.socketDropped = {"example": example(), "serverEvents": server.socket_events.duplicate(true), "module": web_socket()}
  var dropped_log := socket_events().slice(-2)
  verify(dropped and badge("ws-badge") == BADGE_FAILED and dropped_log == ["error", "close 1006"]
    and text("ws-last").contains("was lost without a close frame"), "A connection the server cuts ends with an error and a close with code 1006, and the badge turns red")
  verify(int(section(web_socket(), "transport").get("failed", 0)) == 1 and int(web_socket().get("failed", 0)) == 1,
    "The module counted one failed socket")
  await capture("dropped", BADGE_FAILED, "ws-badge", "websocket")

  # Close: the page's own close(1000, "done") ends the socket cleanly, and the server sees that code and reason.
  await click("ws-connect")
  await wait_for(func() -> bool: return text("ws-status") == "WebSocket: open")
  await click("ws-close")
  var closed := await wait_for(func() -> bool: return text("ws-status") == "WebSocket: closed 1000")
  var server_ended := await wait_for(func() -> bool: return server.socket_events.filter(func(row: Dictionary) -> bool: return row.event == "closed").size() == 3)
  stages.socketClosed = {"example": example(), "serverEvents": server.socket_events.duplicate(true), "module": web_socket()}
  verify(closed and text("ws-last") == "done" and badge("ws-badge") == BADGE_IDLE, "Close ends the socket with 1000 and the reason the page gave")
  var last_closed: Dictionary = server.socket_events.filter(func(row: Dictionary) -> bool: return row.event == "closed").back()
  verify(server_ended and last_closed.code == 1000 and last_closed.reason == "done", "The server received that close frame")
  await capture("closed", BADGE_IDLE, "ws-badge", "websocket")
  var state := web_socket()
  verify(int(state.get("connects", 0)) == 3 and int(state.get("opened", 0)) == 3 and int(state.get("closed", 0)) == 2 and int(state.get("failed", 0)) == 1
    and section(state, "sockets").get("open") == 0 and int(state.get("programmerErrors", -1)) == 0 and native_state().get("errors", []).is_empty(),
    "Three sockets were opened, two ended in a close and one in a failure, and the run raised no host error")
  await frames()

func finish() -> void:
  application.call("stop")
  await frames(8)
  var stopped := native_state()
  verify(stopped.get("stopped", false) and stopped.get("rootCount", -1) == 0 and stopped.get("errors", []).is_empty()
    and section(stopped.get("networking", {}), "transport").get("stopped") == true
    and section(section(stopped.get("networking", {}), "webSocket"), "transport").get("stopped") == true,
    "Stop releases the root and the networking module, its HTTP and its WebSocket transports, without a host error")
  var report := {"scenario": "networking", "godot": Engine.get_version_info().string, "react": "19.2.3", "reactNative": "0.87.1",
    "engine": "hermes", "renderer": "fabric", "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages,
    "pages": pages, "applicationStopped": stopped}
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://build"))
  var output := FileAccess.open("res://build/report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_ERROR: Cannot write the networking report")
    get_tree().quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  print("FABRIC_VALIDATION_FAILED: networking" if failed else "FABRIC_VALIDATION_PASSED: networking " + str(checks.size()))
  get_tree().quit(1 if failed else 0)
