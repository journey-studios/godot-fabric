extends Node

func _ready() -> void:
  var surface := FabricSurface.new()
  surface.set_meta("scenario", "parity")
  add_child(surface)
  var deadline := Time.get_ticks_msec() + 15000
  while surface.evaluate("Boolean(globalThis.fabricParityReport)") != "true" and Time.get_ticks_msec() < deadline:
    await get_tree().process_frame
    var snapshot: Dictionary = JSON.parse_string(surface.snapshot())
    if not snapshot.get("errors", []).is_empty():
      push_error("FABRIC_ERROR: parity host error")
      get_tree().quit(1)
      return
  var result = JSON.parse_string(surface.evaluate("JSON.stringify(globalThis.fabricParityReport || null)"))
  if result == null or result.status != "passed":
    push_error("FABRIC_ERROR: parity fixture failed: " + str(result))
    get_tree().quit(1)
    return
  var report := FileAccess.open("res://build/parity-godot.json", FileAccess.WRITE)
  if report == null:
    push_error("FABRIC_ERROR: cannot write parity report")
    get_tree().quit(1)
    return
  report.store_string(JSON.stringify(result, "  ") + "\n")
  surface.stop()
  print("FABRIC_PARITY_PASSED")
  get_tree().quit()
