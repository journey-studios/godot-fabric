@tool
extends Node

@export var application: GodotFabricApplication

func _enter_tree() -> void:
  if Engine.is_editor_hint():
    return
  if application == null or not application.validation_error().is_empty():
    push_error("Godot Fabric: configure a valid application Resource")
    return
  if not FileAccess.file_exists(application.bundle_file):
    push_error("Godot Fabric: bundle missing; enable the editor plugin and build before Play")
    return
  if not ClassDB.class_exists("FabricApplication"):
    push_error("Godot Fabric: native addon unavailable on this platform")
    return
  var runtime: Node = ClassDB.instantiate("FabricApplication")
  runtime.name = "Runtime"
  runtime.set("bundle_path", application.bundle_file)
  add_child(runtime)
