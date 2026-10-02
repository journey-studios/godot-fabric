extends SceneTree

const Checks = preload("res://scripts/parity_validation.gd")

func _initialize() -> void:
  for entry in [["", false], ["[]", false], ['{"errors":null}', false], ['{"errors":["failure"]}', false], ['{"errors":[]}', true]]:
    if Checks.host_snapshot_ok(entry[0]) != entry[1]:
      push_error("FABRIC_ERROR: snapshot guard did not reject malformed/native failure data")
      quit(1)
      return
  test_completion.call_deferred()

func test_completion() -> void:
  var surface := FabricSurface.new()
  surface.set_meta("scenario", "parity-completion-failure")
  root.add_child(surface)
  var deadline := Time.get_ticks_msec() + 10000
  while surface.evaluate("Number(globalThis.fabricParityCompletions || 0)") == "0" and Time.get_ticks_msec() < deadline:
    await process_frame
  for i in range(20):
    await process_frame
  if surface.evaluate("Number(globalThis.fabricParityCompletions || 0)") != "1":
    push_error("FABRIC_ERROR: completion reporter ran repeatedly or did not run")
    surface.stop()
    quit(1)
    return
  surface.stop()
  print("FABRIC_PARITY_GUARDS_PASSED")
  quit()
