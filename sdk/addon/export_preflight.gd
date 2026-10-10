extends SceneTree

const ExportPayload = preload("export_payload.gd")

func _initialize() -> void:
	var application_path: String = ProjectSettings.get_setting("godot_fabric/application", "res://ui/application.tres")
	var application: Resource = load(application_path)
	var payload := ExportPayload.validate_application(application)
	if not payload.error.is_empty():
		printerr("GODOT_FABRIC_EXPORT_PREFLIGHT_REJECTED: " + payload.error)
		quit(1)
		return
	print("GODOT_FABRIC_EXPORT_PREFLIGHT_PASSED: %s" % payload.bundle_path)
	quit(0)
