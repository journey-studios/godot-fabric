extends RefCounted

# A small HTTP/1.1 server for the images example: it listens on loopback, answers two pictures and remembers every request it saw,
# so that the example needs no network and no other process. The scene polls it on every frame. /pictures/sunrise.png is a PNG the
# server draws itself, with the headers a CDN would give it (Date and Cache-Control: max-age), which is what lets the host keep
# it; /pictures/missing.png does not exist, and answers 404 with a body and a header to show in onError. Each answer closes its
# connection.
const SUNRISE := "/pictures/sunrise.png"
const MISSING := "/pictures/missing.png"
const WIDTH := 192
const HEIGHT := 128
var server := TCPServer.new()
var connections: Array = []
var requests: Array = []
var port := 0
var sunrise := PackedByteArray()

func start() -> Error:
  sunrise = draw_sunrise()
  var error := server.listen(0, "127.0.0.1")
  port = server.get_local_port()
  return error

func stop() -> void:
  for connection: Dictionary in connections:
    connection.peer.disconnect_from_host()
  connections.clear()
  server.stop()

# How many times a path was asked for.
func count(path: String) -> int:
  return requests.filter(func(request: Dictionary) -> bool: return request.target == path).size()

# A sky that warms toward the horizon, a sun and two hills, with a mark on each side so that a crop shows which side it kept.
func draw_sunrise() -> PackedByteArray:
  var picture := Image.create_empty(WIDTH, HEIGHT, false, Image.FORMAT_RGBA8)
  for y in range(HEIGHT):
    var sky := Color(0.15, 0.2, 0.45).lerp(Color(0.98, 0.6, 0.3), float(y) / float(HEIGHT))
    for x in range(WIDTH):
      var color := sky
      if Vector2(x, y).distance_to(Vector2(WIDTH * 0.62, HEIGHT * 0.62)) < 22.0:
        color = Color(1.0, 0.92, 0.55)
      var ridge := HEIGHT * 0.78 + sin(float(x) / 24.0) * 9.0
      if y > ridge:
        color = Color(0.1, 0.22, 0.2).lerp(Color(0.05, 0.12, 0.12), float(y - ridge) / 30.0)
      picture.set_pixel(x, y, color)
  for y in range(HEIGHT / 2 - 3, HEIGHT / 2 + 3):
    for x in range(6):
      picture.set_pixel(x, y, Color(0.94, 0.27, 0.27))
      picture.set_pixel(WIDTH - 1 - x, y, Color(0.13, 0.77, 0.37))
  return picture.save_png_to_buffer()

func http_date() -> String:
  var now := Time.get_datetime_dict_from_system(true)
  var days := ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  var months := ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return "%s, %02d %s %04d %02d:%02d:%02d GMT" % [days[now.weekday], now.day, months[now.month - 1], now.year, now.hour, now.minute, now.second]

func poll() -> void:
  while server.is_connection_available():
    connections.append({"peer": server.take_connection(), "buffer": PackedByteArray()})
  for connection: Dictionary in connections.duplicate():
    var peer: StreamPeerTCP = connection.peer
    peer.poll()
    if peer.get_status() != StreamPeerTCP.STATUS_CONNECTED:
      connections.erase(connection)
      continue
    var available := peer.get_available_bytes()
    if available > 0:
      connection.buffer.append_array(peer.get_data(available)[1])
    try_answer(connection)

func try_answer(connection: Dictionary) -> void:
  var text := (connection.buffer as PackedByteArray).get_string_from_ascii()
  var end := text.find("\r\n\r\n")
  if end < 0:
    return
  var lines := text.substr(0, end).split("\r\n")
  var request_line := lines[0].split(" ")
  var target: String = request_line[1].get_slice("?", 0)
  requests.append({"method": request_line[0], "target": target})
  if target == SUNRISE:
    respond(connection, "200 OK", "image/png", sunrise, "Cache-Control: public, max-age=3600\r\nDate: %s\r\n" % http_date())
  else:
    respond(connection, "404 Not Found", "text/plain", "no such picture".to_utf8_buffer(), "X-Reason: the example has two pictures\r\n")

func respond(connection: Dictionary, status: String, type: String, body: PackedByteArray, extra: String) -> void:
  var head := "HTTP/1.1 %s\r\nContent-Type: %s\r\nContent-Length: %d\r\nConnection: close\r\n%s\r\n" % [status, type, body.size(), extra]
  var peer: StreamPeerTCP = connection.peer
  peer.put_data(head.to_utf8_buffer() + body)
  peer.disconnect_from_host()
  connections.erase(connection)
