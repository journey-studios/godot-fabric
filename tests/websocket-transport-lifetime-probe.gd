extends SceneTree

const LIMIT_MS := 10000
var port := 0
var failures: Array[String] = []

func _init() -> void:
	call_deferred("run")

func run() -> void:
	var extension = load("res://websocket_transport_test.gdextension")
	if extension == null:
		failures.append("test-only GDExtension could not be loaded")
		finish({})
		return
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--port="):
			port = int(argument.trim_prefix("--port="))
	var cases := {}
	var specs := [
		{"name": "cancel-open", "route": "echo", "action": "open", "stop": false},
		{"name": "stop-open", "route": "echo", "action": "open", "stop": true},
		{"name": "cancel-message", "route": "echo", "action": "message", "stop": false},
		{"name": "stop-message", "route": "echo", "action": "message", "stop": true},
		{"name": "cancel-greeting-open", "route": "greeting", "action": "open", "stop": false},
		{"name": "stop-greeting-open", "route": "greeting", "action": "open", "stop": true},
		{"name": "cancel-greeting-message", "route": "greeting", "action": "message", "stop": false},
		{"name": "stop-greeting-message", "route": "greeting", "action": "message", "stop": true},
	]
	for spec: Dictionary in specs:
		var name: String = spec.name
		var fixture = ClassDB.instantiate("WebSocketTransportTestFixture")
		if fixture == null:
			failures.append("test extension class is not registered")
			finish({})
			return
		fixture.begin("ws://127.0.0.1:%d/%s?case=lifetime-%s" % [port, spec.route, name], spec.action, spec.stop)
		cases[name] = fixture
	var began := Time.get_ticks_msec()
	while Time.get_ticks_msec() - began < LIMIT_MS:
		var done := true
		for fixture in cases.values():
			fixture.advance()
			done = done and int(fixture.result().active) == 0
		if done:
			break
		await process_frame
	for index in range(4):
		await process_frame
	var results := {}
	for name: String in cases:
		results[name] = cases[name].result()
		var result: Dictionary = results[name]
		var expected_messages := 1 if name.ends_with("message") else 0
		if (int(result.opened) != 1 or int(result.messages) != expected_messages or int(result.actions) != 1
			or int(result.closed) != 0 or int(result.failed) != 0 or int(result.active) != 0):
			failures.append("%s: unexpected terminal callback counts %s" % [name, JSON.stringify(result)])
	finish(results)

func finish(results: Dictionary) -> void:
	print("WEBSOCKET_TRANSPORT_LIFETIME: " + JSON.stringify({"godot": Engine.get_version_info().string, "results": results, "failures": failures}))
	quit(0 if failures.is_empty() else 1)
