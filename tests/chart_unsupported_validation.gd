extends SceneTree

func _initialize() -> void:
  call_deferred("run")

func run() -> void:
  root.size = Vector2i(900, 680)
  var surface := FabricSurface.new()
  surface.set_meta("scenario", "chart")
  root.add_child(surface)
  for i in range(6):
    await process_frame
  surface.evaluate("GodotApp.run('unsupported')")
  for i in range(6):
    await process_frame
  var snapshot: Dictionary = JSON.parse_string(surface.snapshot())
  print("CHART_UNSUPPORTED_RESULT: ", JSON.stringify(snapshot.errors))
  root.remove_child(surface)
  surface.free()
  # The original library's rotated labels exceed our adapter contract. Keep the
  # production failure visible to the CLI rather than pretending it rendered.
  quit(1 if not snapshot.errors.is_empty() else 0)
