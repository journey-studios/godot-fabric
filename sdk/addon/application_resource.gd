@tool
extends Resource
class_name GodotFabricApplication

# Experimental format for the bounded consumer prototype; not SDK 1.0.
@export var format_version: int = 1
@export_file("*.tsx", "*.ts", "*.jsx", "*.js") var entry_file: String = "res://ui/index.tsx"
@export var bundle_file: String = "res://.godot_fabric/app.js"

func validation_error() -> String:
  if format_version != 1:
    return "Unsupported application Resource version: " + str(format_version)
  for value in [entry_file, bundle_file]:
    if not value.begins_with("res://") or value.contains(".."):
      return "Application paths must be inside the project: " + value
  if entry_file == bundle_file:
    return "Entry and output bundle must be different files"
  if not bundle_file.begins_with("res://.godot_fabric/") or not bundle_file.ends_with(".js"):
    return "This prototype writes JavaScript bundles only under res://.godot_fabric/"
  return ""
