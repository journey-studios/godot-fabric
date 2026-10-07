extends SceneTree

const LIMIT_MS := 60000
var ports := {}
var bytes_per_message := 8192
var application: Node
var failures: Array[String] = []
var first_progress_frame := []
var sampled_frames := 0

func _init() -> void:
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--ports="):
			ports = JSON.parse_string(argument.trim_prefix("--ports="))
		elif argument.begins_with("--bytes="):
			bytes_per_message = int(argument.trim_prefix("--bytes="))
	call_deferred("run")

func run() -> void:
	root.size = Vector2i(200, 80)
	application = ClassDB.instantiate("FabricApplication")
	application.name = "WebSocketLoadApplication"
	application.set("bundle_path", "res://build/websocket-probe.js")
	root.add_child(application)
	var surface: Control = ClassDB.instantiate("FabricSurface")
	surface.name = "LoadSurface"
	surface.size = Vector2(160, 60)
	surface.set("application_path", NodePath("../WebSocketLoadApplication"))
	surface.set("component_name", "WebSocketProbe")
	surface.set("initial_props", {"name": "load"})
	root.add_child(surface)
	await frames(8)
	application.call("evaluate", "WebSocketProbe.configure(%s)" % JSON.stringify(ports))
	first_progress_frame.resize(8)
	first_progress_frame.fill(-1)
	var key := str(application.call("evaluate", "WebSocketProbe.start('load', 'load', {count: 128, sockets: 8, bytes: %d})" % bytes_per_message))
	var began := Time.get_ticks_msec()
	while Time.get_ticks_msec() - began < LIMIT_MS and status_of(key) == "running":
		sample_work()
		var progress := progress_of()
		for index in range(min(8, progress.get("received", []).size())):
			if first_progress_frame[index] == -1 and int(progress.received[index]) > 0:
				first_progress_frame[index] = sampled_frames
		await process_frame
	var done := status_of(key) == "done"
	for index in range(12):
		await process_frame
		sample_work()
	var entry := entry_of(key)
	var result: Dictionary = entry.get("result", {})
	var progress := progress_of()
	var runtime := native()
	var networking: Dictionary = runtime.get("networking", {})
	var web_socket: Dictionary = networking.get("webSocket", {})
	var transport: Dictionary = web_socket.get("transport", {})
	var received: Array = progress.get("received", [])
	var first_frames := first_progress_frame.duplicate()
	var active_first := first_frames.filter(func(frame: int) -> bool: return frame >= 0)
	var fairness_span: int = active_first.max() - active_first.min() if active_first.size() == 8 else 999999
	var expected := 8
	if not done:
		failures.append("load case did not finish: " + status_of(key))
	if int(result.get("results", 0)) != expected or received.size() != expected:
		failures.append("not every socket completed: " + JSON.stringify(result))
	for count in received:
		if int(count) != 128:
			failures.append("a socket missed an application message: " + JSON.stringify(received))
	if int(result.get("setStateCalls", 0)) != 1024 or int(result.get("timerTicks", 0)) < 4 or int(result.get("renders", 0)) < 2:
		failures.append("the load did not exercise WebSocket handlers, React state and timers: " + JSON.stringify(result))
	var events: Dictionary = networking.get("events", {})
	if int(events.get("peakPending", -1)) > 256 or int(events.get("pending", -1)) != 0:
		failures.append("the canonical networking event queue exceeded or failed to drain its 256-item bound: " + JSON.stringify(events))
	if bytes_per_message == 8192 and (int(transport.get("maxBytesPerPoll", -1)) > 1048576 or int(transport.get("maxBytesPerPoll", 0)) < 900000):
		failures.append("the shared one-megabyte wire budget was not exercised: " + JSON.stringify(transport))
	if int(transport.get("maxMessagesPerPoll", -1)) > 256:
		failures.append("the transport exceeded its shared 256-message admission limit: " + JSON.stringify(transport))
	if int(transport.get("maxEventsAdmittedPerPoll", -1)) > 256:
		failures.append("the transport exceeded its shared 256-event admission limit: " + JSON.stringify(transport))
	if bytes_per_message == 512 and (int(transport.get("maxEventsAdmittedPerPoll", 0)) < 200 or int(events.get("peakPending", 0)) < 200):
		failures.append("the shared 256-event admission limit was not exercised: " + JSON.stringify(events))
	if fairness_span > 12:
		failures.append("socket progress was not fairly rotated: " + JSON.stringify(first_frames))
	var report := {"format": "godot-fabric.websocket-load/v1", "godot": Engine.get_version_info().string,
		"bytesPerMessage": bytes_per_message,
		"done": done, "case": result, "progress": progress, "runtime": runtime, "transport": transport,
		"sampledFrames": sampled_frames, "firstProgressFrames": first_frames,
		"fairnessSpan": fairness_span, "failures": failures}
	var output := FileAccess.open("res://build/websocket-load-report.json", FileAccess.WRITE)
	if output != null:
		output.store_string(JSON.stringify(report, "  ") + "\n")
		output.close()
	print("WEBSOCKET_LOAD: " + JSON.stringify(report))
	application.call("stop")
	quit(0 if failures.is_empty() else 1)

func sample_work() -> void:
	sampled_frames += 1

func progress_of() -> Dictionary:
	var value: Variant = application.call("evaluate", "JSON.stringify(WebSocketProbe.loadProgress())")
	var parsed: Variant = JSON.parse_string(str(value))
	return parsed if parsed is Dictionary else {}

func native() -> Dictionary:
	var parsed: Variant = JSON.parse_string(str(application.call("snapshot")))
	return parsed if parsed is Dictionary else {}

func status_of(key: String) -> String:
	return str(application.call("evaluate", "WebSocketProbe.status(%s)" % JSON.stringify(key)))

func entry_of(key: String) -> Dictionary:
	var value: Variant = application.call("evaluate", "JSON.stringify(WebSocketProbe.entry(%s))" % JSON.stringify(key))
	var parsed: Variant = JSON.parse_string(str(value))
	return parsed if parsed is Dictionary else {}

func frames(count: int) -> void:
	for index in range(count):
		await process_frame
