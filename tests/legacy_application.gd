extends SceneTree

var checks: Array = []
func verify(condition: bool, name: String) -> void:
  checks.append({"name": name, "passed": condition})

func frames() -> void:
  for i in range(8):
    await process_frame

func state(node: Node) -> Dictionary:
  return JSON.parse_string(node.call("snapshot"))

func finish() -> void:
  var output := FileAccess.open("res://build/legacy-application-report.json", FileAccess.WRITE)
  output.store_string(JSON.stringify({"checks": checks}, "  ") + "\n")
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  print("LEGACY_APPLICATION_FAILED" if failed else "LEGACY_APPLICATION_PASSED")
  quit(1 if failed else 0)

func _initialize() -> void:
  call_deferred("run_probe")

func run_probe() -> void:
  var first := FabricSurface.new()
  first.set_meta("scenario", "counter")
  root.add_child(first)
  await frames()
  verify(not state(first).nodes.is_empty(), "Initial anonymous root commits native Controls")
  var original: int = state(first).runtimeId
  first.stop()
  var next := FabricSurface.new()
  next.set_meta("scenario", "counter")
  root.add_child(next)
  await frames()
  verify(not state(next).nodes.is_empty() and state(next).runtimeId != original, "A new anonymous scene receives a fresh application after shutdown")
  if state(next).nodes.is_empty():
    finish()
    return
  var stats: Dictionary = JSON.parse_string(next.evaluate("JSON.stringify(GodotApp.stats())"))
  verify(stats.mounts == 1 and stats.cleanups == 0 and stats.count == 0, "The replacement legacy runtime starts with fresh React and module state")
  var previous: int = state(next).runtimeId
  root.remove_child(next)
  verify(state(next).stopped, "Anonymous scene exit still shuts down its application")
  root.add_child(next)
  await frames()
  verify(not state(next).nodes.is_empty() and state(next).runtimeId != previous, "The same anonymous surface can reenter with a fresh owner")
  stats = JSON.parse_string(next.evaluate("JSON.stringify(GodotApp.stats())"))
  verify(stats.mounts == 1 and stats.cleanups == 0, "Reentry evaluates a new legacy bundle exactly once")
  var owners := root.get_children().filter(func(node: Node) -> bool: return node.is_class("FabricApplication"))
  verify(owners.size() == 1 and not state(owners[0]).stopped and has_meta("_fabric_application_id") and get_meta("_fabric_application_id") == owners[0].get_instance_id() and state(owners[0]).runtimeId == state(next).runtimeId, "Retired implicit owners are freed and tree metadata identifies the live owner")
  next.queue_free()
  await frames()
  verify(state(owners[0]).stopped and state(owners[0]).rootCount == 0 and state(owners[0]).pendingTimers == 0, "Final anonymous scene exit releases its new runtime resources")
  finish()
