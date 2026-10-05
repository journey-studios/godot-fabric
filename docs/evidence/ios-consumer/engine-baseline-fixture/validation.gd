extends Control
func _ready() -> void:
  for _i in range(60):
    await get_tree().process_frame
  $Button.emit_signal("pressed")
  await RenderingServer.frame_post_draw
  var checks: Array = [
    {"name":"Original Godot iOS x86_64 runtime", "passed":OS.get_name()=="iOS" and OS.has_feature("x86_64")},
    {"name":"No Fabric extension exists", "passed":not ClassDB.class_exists("FabricApplication") and not ClassDB.class_exists("FabricSurface")},
    {"name":"Native Godot Button and Label", "passed":$Button is BaseButton and $Label is Label},
    {"name":"Compatibility renderer", "passed":RenderingServer.get_current_rendering_method()=="gl_compatibility"},
    {"name":"Native viewport capture", "passed":get_viewport().get_texture().get_image().save_png("user://ios-consumer.png")==OK}]
  var success: bool=checks.all(func(check: Dictionary) -> bool: return check.passed)
  var report: Dictionary={"schemaVersion":1,"host":"godot-native-baseline", "architecture":"x86_64", "os":OS.get_name(), "renderer":RenderingServer.get_current_rendering_method(), "checks":checks,"passed":success}
  var file: FileAccess=FileAccess.open("user://ios-consumer.json",FileAccess.WRITE)
  file.store_string(JSON.stringify(report,"  ")+"
");file.close()
  print("IOS_CONSUMER_VALIDATION_PASSED" if success else "IOS_CONSUMER_VALIDATION_FAILED")
  get_tree().quit(0 if success else 1)
