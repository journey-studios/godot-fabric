extends SceneTree

func _initialize() -> void:
  call_deferred("run")

func run() -> void:
  var surface := FabricSurface.new()
  surface.set_meta("scenario", "typography")
  root.add_child(surface)
  for i in range(8):
    await process_frame
  surface.evaluate("GodotApp.run('fail', 'native')")
  for i in range(8):
    await process_frame
  var report: Dictionary = JSON.parse_string(surface.snapshot())
  var reported := false
  for error in report.errors:
    reported = reported or error.contains("Inline Controls")
  surface.stop()
  var stopped: Dictionary = JSON.parse_string(surface.snapshot())
  print("TYPOGRAPHY_NATIVE_FAILURE: ", JSON.stringify({"reported": reported, "stopped": stopped.stopped, "balanced": stopped.creates == stopped.deletes, "errors": report.errors}))
  surface.free()
  quit(1 if reported and stopped.stopped and stopped.creates == stopped.deletes else 2)
