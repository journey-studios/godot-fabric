extends "res://scripts/validation_base.gd"

func _ready() -> void:
  surface = FabricSurface.new()
  surface.set_meta("scenario", "lineheight")
  add_child(surface)
  await wait_native("leading-small-first")
  await frames(4)
  var small := node("leading-small-first")
  var large := node("leading-large-first")
  verify(small.lineMetrics[0].height == 21 and small.lineMetrics[1].height == 42,
    "An adjacent larger run does not change the preceding line height")
  verify(large.lineMetrics[0].height == 42 and large.lineMetrics[1].height == 21,
    "An adjacent larger run does not change the following line height")
  verify(small.height == 63 and large.height == 63,
    "Yoga measures only the runs overlapping each ordinary line")
  var terminal := node("leading-terminal")
  verify(terminal.lineMetrics[0].height == 42 and terminal.lineMetrics[1].height == 42 and terminal.height == 84,
    "A trailing-newline sentinel keeps the last run's explicit height")
  verify(node("leading-empty").height == 27,
    "An empty paragraph sentinel keeps its explicit height")
  verify(data().errors.is_empty(), "Mixed line heights do not report native errors")
  var before_stop := data()
  remove_child(surface)
  var stopped := data()
  verify(stopped.stopped and stopped.nodes.is_empty() and stopped.creates == stopped.deletes,
    "The line-height fixture destroys every native Control")
  surface.free()
  var report := {"checks": checks, "beforeStop": before_stop, "afterStop": stopped}
  var file := FileAccess.open("res://build/line-height-report.json", FileAccess.WRITE)
  if file == null:
    push_error("FABRIC_ERROR: cannot write line-height-report.json")
    get_tree().quit(1)
    return
  file.store_string(JSON.stringify(report, "  ") + "\n")
  if not failure:
    print("FABRIC_LINE_HEIGHT_PASSED")
  get_tree().quit(1 if failure else 0)
