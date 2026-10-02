extends Node

static func host_snapshot_ok(source: String) -> bool:
  var parser := JSON.new()
  if parser.parse(source) != OK:
    return false
  var snapshot = parser.data
  return typeof(snapshot) == TYPE_DICTIONARY and typeof(snapshot.get("errors")) == TYPE_ARRAY and snapshot.errors.is_empty()

func _ready() -> void:
  var surface := FabricSurface.new()
  surface.set_meta("scenario", "parity")
  add_child(surface)
  var deadline := Time.get_ticks_msec() + 15000
  while surface.evaluate("Boolean(globalThis.fabricParityReport)") != "true" and Time.get_ticks_msec() < deadline:
    await get_tree().process_frame
    if not host_snapshot_ok(surface.snapshot()):
      push_error("FABRIC_ERROR: parity host error")
      get_tree().quit(1)
      return
  var result = JSON.parse_string(surface.evaluate("JSON.stringify(globalThis.fabricParityReport || null)"))
  if typeof(result) != TYPE_DICTIONARY or result.get("status") != "passed":
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
