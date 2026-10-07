extends SceneTree

const LIMIT_MS := 15000
const CLOSE_MASK := [0x11, 0x22, 0x33, 0x44]

var port := 0
var control_port := 0
var ca_path := ""
var failures: Array[String] = []

func _init() -> void:
	call_deferred("run")

func run() -> void:
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--port="):
			port = int(argument.trim_prefix("--port="))
		elif argument.begins_with("--control-port="):
			control_port = int(argument.trim_prefix("--control-port="))
		elif argument.begins_with("--ca="):
			ca_path = argument.trim_prefix("--ca=")
	var cases := {}
	cases.echo = await exchange("/echo?case=stream-spike-echo", 1000, "client")
	cases.different = await exchange("/different-close?case=stream-spike-different", 3000, "client")
	cases.drop = await exchange("/drop-after-close?case=stream-spike-drop", 3000, "client")
	var report := {"godot": Engine.get_version_info().string, "cases": cases, "failures": failures}
	print("WEBSOCKET_STREAM_SPIKE: " + JSON.stringify(report))
	quit(0 if failures.is_empty() else 1)

func exchange(path: String, code: int, reason: String) -> Dictionary:
	var ca := X509Certificate.new()
	if ca.load(ca_path) != OK:
		return fail(path, "test CA could not be loaded")
	var connector := HTTPClient.new()
	var error := connector.connect_to_host("127.0.0.1", port, TLSOptions.client(ca))
	if error != OK or not await until_connected(connector):
		return fail(path, "HTTPClient TCP/TLS connect failed: %d, status %d" % [error, connector.get_status()])
	var stream := connector.get_connection()
	if stream == null:
		return fail(path, "HTTPClient did not expose its connected stream")
	var key := "dGhlIHNhbXBsZSBub25jZQ=="
	var request := "GET %s HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: %s\r\n\r\n" % [path, port, key]
	if stream.put_data(request.to_utf8_buffer()) != OK:
		return fail(path, "TLS handshake request write failed")
	var header := await read_http_headers(stream)
	if not header.ok or not header.text.begins_with("HTTP/1.1 101 "):
		return fail(path, "WebSocket upgrade failed: " + header.get("text", "EOF"))
	var payload := PackedByteArray([code >> 8, code & 0xff])
	payload.append_array(reason.to_utf8_buffer())
	var frame := PackedByteArray([0x88, 0x80 | payload.size()])
	frame.append_array(CLOSE_MASK)
	for index in range(payload.size()):
		frame.append(payload[index] ^ CLOSE_MASK[index % 4])
	if stream.put_data(frame) != OK:
		return fail(path, "client close frame write failed")
	var response := await read_frame(stream)
	var log := await read_server_log()
	var connection: Variant = null
	for candidate: Dictionary in log.get("connections", []):
		if str(candidate.url).contains(path.get_slice("case=", 1)):
			connection = candidate
			break
	if connection == null:
		failures.append(path + ": server control log did not contain the connection")
	var result := {"response": response, "serverConnection": connection}
	connector.close()
	return result

func until_connected(client: HTTPClient) -> bool:
	var start := Time.get_ticks_msec()
	while Time.get_ticks_msec() - start < LIMIT_MS:
		client.poll()
		if client.get_status() == HTTPClient.STATUS_CONNECTED:
			return true
		if client.get_status() in [HTTPClient.STATUS_CANT_CONNECT, HTTPClient.STATUS_CONNECTION_ERROR]:
			return false
		await process_frame
	return false

func read_http_headers(stream: StreamPeer) -> Dictionary:
	var bytes := PackedByteArray()
	var start := Time.get_ticks_msec()
	while Time.get_ticks_msec() - start < LIMIT_MS:
		var chunk := await read_bytes(stream, 1)
		if not chunk.ok:
			return {"ok": false, "text": "EOF before upgrade headers"}
		bytes.append_array(chunk.bytes)
		var text := bytes.get_string_from_ascii()
		if text.ends_with("\r\n\r\n"):
			return {"ok": true, "text": text}
	return {"ok": false, "text": "upgrade headers timed out"}

func read_frame(stream: StreamPeer) -> Dictionary:
	var header := await read_bytes(stream, 2)
	if not header.ok:
		return {"kind": "error", "message": header.message}
	var length := int(header.bytes[1] & 0x7f)
	if length == 126:
		var extended := await read_bytes(stream, 2)
		if not extended.ok:
			return {"kind": "error", "message": extended.message}
		length = (int(extended.bytes[0]) << 8) | int(extended.bytes[1])
	if length > 125:
		return {"kind": "error", "message": "close frame exceeded control-frame limit"}
	var body := await read_bytes(stream, length)
	if not body.ok:
		return {"kind": "error", "message": body.message}
	if (header.bytes[0] & 0x0f) != 0x8:
		return {"kind": "error", "message": "server response was not a close frame"}
	var response_code := 1005
	var response_reason := ""
	if length >= 2:
		response_code = (int(body.bytes[0]) << 8) | int(body.bytes[1])
		response_reason = body.bytes.slice(2).get_string_from_utf8()
	return {"kind": "close", "code": response_code, "reason": response_reason}

func read_bytes(stream: StreamPeer, length: int) -> Dictionary:
	var bytes := PackedByteArray()
	var start := Time.get_ticks_msec()
	while bytes.size() < length and Time.get_ticks_msec() - start < LIMIT_MS:
		# A sized TLS read stops at the WebSocket frame instead of consuming a following close_notify record.
		var available := stream.get_available_bytes()
		var requested: int = min(length - bytes.size(), available) if available > 0 else 1
		var result := stream.get_partial_data(requested)
		var status: int = result[0]
		if status == OK:
			bytes.append_array(result[1])
		elif status != ERR_BUSY:
			return {"ok": false, "message": "TLS read ended with %d" % status}
		if bytes.size() < length:
			await process_frame
	return {"ok": bytes.size() == length, "bytes": bytes, "message": "TLS read timed out"}

func read_server_log() -> Dictionary:
	var client := HTTPClient.new()
	client.connect_to_host("127.0.0.1", control_port)
	var started := Time.get_ticks_msec()
	var requested := false
	var response := PackedByteArray()
	while Time.get_ticks_msec() - started < LIMIT_MS:
		client.poll()
		if client.get_status() == HTTPClient.STATUS_CONNECTED and not requested:
			requested = true
			client.request(HTTPClient.METHOD_GET, "/__control/log", PackedStringArray())
		elif client.get_status() == HTTPClient.STATUS_BODY:
			response.append_array(client.read_response_body_chunk())
		elif client.get_status() == HTTPClient.STATUS_CONNECTED and requested:
			break
		await process_frame
	client.close()
	var value: Variant = JSON.parse_string(response.get_string_from_utf8())
	return value if value is Dictionary else {}

func fail(path: String, message: String) -> Dictionary:
	failures.append(path + ": " + message)
	return {"response": {"kind": "error", "message": message}}
