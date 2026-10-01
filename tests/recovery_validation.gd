extends SceneTree

var checks: Array = []

func _initialize() -> void:
  call_deferred("run_probe")

func check(condition: bool, message: String) -> void:
  checks.append({"name": message, "passed": condition})

func tag_for(state: Dictionary, id: String) -> int:
  for entry in state.nodes:
    if entry.testID == id:
      return int(entry.tag)
  return 0

func run_probe() -> void:
  var surface := FabricSurface.new()
  root.add_child(surface)
  for i in range(10):
    await process_frame
  var before: Dictionary = JSON.parse_string(surface.snapshot())
  check(not before.nodes.is_empty(), "Probe starts with mounted native Controls")
  surface.evaluate("globalThis.recoveryTimer=0; setTimeout(()=>recoveryTimer++,0); godotSetWindowListener(()=>{}); GodotApp.stop=()=>{throw Error('FABRIC_INJECTED_UNMOUNT_FAILURE')};")
  var pending: Dictionary = JSON.parse_string(surface.snapshot())
  check(pending.pendingTimers > 0 and pending.windowListener, "Probe enqueues a real timer and window listener")
  check(surface.evaluate("recoveryTimer") == "0", "Due timer has not run before stop begins")
  surface.stop()
  var stopped: Dictionary = JSON.parse_string(surface.snapshot())
  surface.activate(tag_for(before, "counter"))
  surface.change("late edit", tag_for(before, "input"))
  await create_timer(0.08).timeout
  var late: Dictionary = JSON.parse_string(surface.snapshot())
  check(stopped.stopped, "JS unmount failure still marks native surface stopped")
  check(stopped.nodes.is_empty() and stopped.nativeTags == 0, "JS unmount failure frees Controls and tag registry")
  check(stopped.creates == stopped.deletes, "All created Controls are destroyed after failed unmount")
  check(stopped.pendingTimers == 0 and not stopped.windowListener, "Failed unmount clears timers and window listener")
  check(late.events == stopped.events, "Native events after failed unmount are ignored")
  check(surface.evaluate("recoveryTimer") == "0", "Pending timer cannot run after failed unmount")
  check(stopped.errors.size() == 1 and "FABRIC_INJECTED_UNMOUNT_FAILURE" in stopped.errors[0], "Original JS unmount error remains visible")
  surface.stop()
  var repeated: Dictionary = JSON.parse_string(surface.snapshot())
  check(repeated.errors.size() == stopped.errors.size() and repeated.deletes == stopped.deletes, "Repeated stop is idempotent after failed unmount")
  print("FABRIC_RECOVERY_RESULT: ", JSON.stringify({"checks": checks, "afterStop": repeated}))
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  quit(1 if failed else 0)
