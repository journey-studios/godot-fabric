extends RefCounted

# A small HTTP/1.1 server for the networking example: it listens on loopback, answers a few routes and
# remembers what it saw, so the example needs no network and no other process. The scene polls it on every
# frame. Each answer closes its connection; /api/slow never answers, to be aborted.
const SLOW := "/api/slow"
var server := TCPServer.new()
var connections: Array = []
var requests: Array = []
# Slow requests whose client closed the connection before any answer.
var abandoned := 0
var port := 0

func start() -> Error:
  var error := server.listen(0, "127.0.0.1")
  port = server.get_local_port()
  return error

func stop() -> void:
  for connection: Dictionary in connections:
    connection.peer.disconnect_from_host()
  connections.clear()
  server.stop()

func poll() -> void:
  while server.is_connection_available():
    connections.append({"peer": server.take_connection(), "buffer": PackedByteArray(), "held": false})
  for connection: Dictionary in connections.duplicate():
    var peer: StreamPeerTCP = connection.peer
    peer.poll()
    if peer.get_status() != StreamPeerTCP.STATUS_CONNECTED:
      # The client went away: a held request it had abandoned is the one an abort leaves behind.
      abandoned += 1 if connection.held else 0
      connections.erase(connection)
      continue
    var available := peer.get_available_bytes()
    if available > 0:
      connection.buffer.append_array(peer.get_data(available)[1])
    if not connection.held:
      try_answer(connection)

func header_end(buffer: PackedByteArray) -> int:
  var text := buffer.get_string_from_ascii()
  return text.find("\r\n\r\n")

func try_answer(connection: Dictionary) -> void:
  var buffer: PackedByteArray = connection.buffer
  var end := header_end(buffer)
  if end < 0:
    return
  var lines := buffer.slice(0, end).get_string_from_utf8().split("\r\n")
  var request_line := lines[0].split(" ")
  var headers := {}
  for index in range(1, lines.size()):
    var colon := lines[index].find(":")
    if colon > 0:
      headers[lines[index].substr(0, colon).to_lower()] = lines[index].substr(colon + 1).strip_edges()
  var length := int(headers.get("content-length", "0"))
  var body := buffer.slice(end + 4)
  if body.size() < length:
    return
  var target: String = request_line[1]
  requests.append({"method": request_line[0], "target": target, "type": headers.get("content-type", ""), "length": length,
    "body": body.slice(0, length).get_string_from_utf8()})
  answer(connection, request_line[0], target, headers, body.slice(0, length))

func respond(connection: Dictionary, status: String, type: String, body: String, extra := "") -> void:
  var bytes := body.to_utf8_buffer()
  var head := "HTTP/1.1 %s\r\nContent-Type: %s\r\nContent-Length: %d\r\nConnection: close\r\n%s\r\n" % [status, type, bytes.size(), extra]
  var peer: StreamPeerTCP = connection.peer
  peer.put_data(head.to_utf8_buffer() + bytes)
  peer.disconnect_from_host()

func answer(connection: Dictionary, method: String, target: String, headers: Dictionary, body: PackedByteArray) -> void:
  var path := target.get_slice("?", 0)
  if path == "/api/profile":
    respond(connection, "200 OK", "application/json; charset=utf-8", JSON.stringify({"message": "Olá do servidor local", "items": [1, 2, 3]}))
  elif path == "/api/text":
    respond(connection, "200 OK", "text/plain; charset=utf-8", "Zażółć gęślą jaźń — do servidor, com acentos")
  elif path == "/api/echo":
    # The multipart parts a FormData body carries, listed by name.
    var fields: Array = []
    var type: String = headers.get("content-type", "")
    var boundary := type.get_slice("boundary=", 1)
    if not boundary.is_empty():
      for part in body.get_string_from_utf8().split("--" + boundary):
        var name_start := part.find("name=\"")
        if name_start >= 0:
          var name := part.substr(name_start + 6).get_slice("\"", 0)
          fields.append(name + "=" + part.get_slice("\r\n\r\n", 1).strip_edges())
    respond(connection, "200 OK", "application/json; charset=utf-8", JSON.stringify({"method": method, "type": type, "fields": fields}))
  elif path == "/api/redirect":
    respond(connection, "302 Found", "text/plain", "moved", "Location: /api/profile?from=redirect\r\n")
  elif path == SLOW:
    connection.held = true
  else:
    respond(connection, "404 Not Found", "text/plain", "not found")
