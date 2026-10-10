@tool
extends EditorExportPlugin

const ExportPayload = preload("export_payload.gd")

func _get_name() -> String:
	# Godot sorts export file hooks by name. Run before its GDScript plugin,
	# which saves compiled scripts and then prevents later skip hooks from running.
	return "FabricGodotIOS"

func _supports_platform(platform: EditorExportPlatform) -> bool:
	return platform is EditorExportPlatformIOS

func _export_begin(features: PackedStringArray, is_debug: bool, _path: String, _flags: int) -> void:
	if not features.has("ios"):
		return
	if is_debug:
		_export_error("The iOS checkpoint provides Release artifacts only")
		return
	var application_path: String = ProjectSettings.get_setting("godot_fabric/application", "res://ui/application.tres")
	var application: Resource = load(application_path)
	var payload := ExportPayload.validate_application(application)
	if not payload.error.is_empty():
		_export_error(payload.error)
		return
	for file: Dictionary in payload.files:
		add_file(file.path, file.bytes, false)
	var sdk_path: String = (get_script() as Script).resource_path.get_base_dir()
	add_apple_embedded_platform_embedded_framework(sdk_path.path_join("native/ios/hermesvm.xcframework"))
	add_apple_embedded_platform_embedded_framework(sdk_path.path_join("native/ios/ReactNativeDependencies.xcframework"))
	add_apple_embedded_platform_linker_flags("-Wl,-u,_fabric_library_init")

func _export_error(message: String) -> void:
	get_export_platform().add_message(EditorExportPlatform.EXPORT_MESSAGE_ERROR, "Godot Fabric", message)

func _export_file(path: String, _type: String, _features: PackedStringArray) -> void:
	var sdk_path: String = (get_script() as Script).resource_path.get_base_dir() + "/"
	if ExportPayload.is_editor_file(path, sdk_path):
		skip()
