extends SceneTree

var checks: Array = []

func _initialize() -> void:
  exercise.call_deferred()

func verify(condition: bool, name: String) -> void:
  checks.append({"name": name, "passed": condition})

func exercise() -> void:
  var surface := FabricSurface.new()
  surface.set_meta("scenario", "counter")
  root.add_child(surface)
  for i in range(6):
    await process_frame
  surface.evaluate("globalThis.errorTrace=[]; setTimeout(()=>{errorTrace.push('timeout');throw new Error('EXPECTED_RUNTIME_TIMEOUT')},0); setTimeout(()=>errorTrace.push('after-timeout'),0); queueMicrotask(()=>{throw new Error('EXPECTED_RUNTIME_MICROTASK')}); requestAnimationFrame(()=>{throw new Error('EXPECTED_RUNTIME_FRAME')}); requestAnimationFrame(()=>errorTrace.push('after-frame'))")
  surface.evaluate("globalThis.intervalErrors=0; const id=setInterval(()=>{if(++intervalErrors===2)clearInterval(id);throw new Error('EXPECTED_RUNTIME_INTERVAL')},0)")
  var deadline := Time.get_ticks_msec() + 5000
  while Time.get_ticks_msec() < deadline:
    var snapshot: Dictionary = JSON.parse_string(surface.snapshot())
    if snapshot.errors.size() == 5 and snapshot.pendingTimers == 0 and snapshot.pendingAnimationFrames == 0:
      break
    await process_frame
  var before_stop: Dictionary = JSON.parse_string(surface.snapshot())
  verify(Time.get_ticks_msec() < deadline, "Throwing callbacks finish without hanging the pump")
  verify(before_stop.errors.size() == 5, "Each uncaught callback exception reaches the host error channel")
  verify(surface.evaluate("intervalErrors") == "2", "An interval survives a callback exception and can cancel itself on its next invocation")
  verify(surface.evaluate("JSON.stringify(errorTrace)") == '["after-frame","timeout","after-timeout"]', "A failed callback cannot prevent unrelated queued work")
  verify(before_stop.pendingTimers == 0 and before_stop.pendingAnimationFrames == 0, "Failed one-shot callbacks release native registrations")
  surface.stop()
  var stopped: Dictionary = JSON.parse_string(surface.snapshot())
  verify(stopped.pendingTimers == 0 and stopped.pendingWork == 0 and stopped.nodes.is_empty(), "Shutdown also completes after callback failures")
  var report := {"checks": checks, "errors": before_stop.errors, "trace": JSON.parse_string(surface.evaluate("JSON.stringify(errorTrace)"))}
  print("RUNTIME_ERRORS_RESULT: ", JSON.stringify(report))
  quit(0 if checks.all(func(check): return check.passed) else 1)
