@tool
extends EditorExportPlugin

const ExportPayload = preload("export_payload.gd")
const FRAMEWORKS := ["hermesvm.framework", "ReactNativeDependencies.framework"]

func _get_name() -> String:
	return "FabricGodotMacOS"

func _supports_platform(platform: EditorExportPlatform) -> bool:
	return platform is EditorExportPlatformMacOS

func _export_begin(features: PackedStringArray, is_debug: bool, _path: String, _flags: int) -> void:
	if not features.has("macos"):
		return
	if is_debug:
		_export_error("The macOS checkpoint provides Release artifacts only")
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
	for framework in FRAMEWORKS:
		add_shared_object(sdk_path.path_join("native/frameworks").path_join(framework), PackedStringArray(), "Contents/Frameworks/frameworks")

func _export_error(message: String) -> void:
	get_export_platform().add_message(EditorExportPlatform.EXPORT_MESSAGE_ERROR, "Godot Fabric", message)

func _export_file(path: String, _type: String, _features: PackedStringArray) -> void:
	var sdk_path: String = (get_script() as Script).resource_path.get_base_dir() + "/"
	if ExportPayload.is_editor_file(path, sdk_path):
		skip()
