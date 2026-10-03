@tool
extends EditorExportPlugin

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
    get_export_platform().add_message(EditorExportPlatform.EXPORT_MESSAGE_ERROR, "Godot Fabric", "The iOS checkpoint provides Release artifacts only")
    return
  var sdk_path: String = (get_script() as Script).resource_path.get_base_dir()
  var application_path: String = ProjectSettings.get_setting("godot_fabric/application", "res://ui/application.tres")
  var application: Resource = load(application_path)
  if application == null or not application.has_method("validation_error") or not application.validation_error().is_empty():
    get_export_platform().add_message(EditorExportPlatform.EXPORT_MESSAGE_ERROR, "Godot Fabric", "Configure a valid application Resource before exporting")
    return
  if not FileAccess.file_exists(application.bundle_file):
    get_export_platform().add_message(EditorExportPlatform.EXPORT_MESSAGE_ERROR, "Godot Fabric", "Build the application bundle before exporting")
    return
  # The generated bundle lives in a hidden directory and is not an imported
  # resource. Include its bytes explicitly under the same runtime resource path.
  add_file(application.bundle_file, FileAccess.get_file_as_bytes(application.bundle_file), false)
  add_apple_embedded_platform_embedded_framework(sdk_path.path_join("native/ios/hermesvm.xcframework"))
  add_apple_embedded_platform_embedded_framework(sdk_path.path_join("native/ios/ReactNativeDependencies.xcframework"))
  add_apple_embedded_platform_linker_flags("-Wl,-u,_fabric_library_init")

func _export_file(path: String, _type: String, _features: PackedStringArray) -> void:
  var sdk_path: String = (get_script() as Script).resource_path.get_base_dir() + "/"
  for directory in ["toolchain/", "src/", "types/"]:
    if path.begins_with(sdk_path + directory):
      skip()
  for editor_file in ["plugin.gd", "ios_export.gd", "build.gd", "plugin.cfg"]:
    if path == sdk_path + editor_file:
      skip()
  if path in [sdk_path + "manifest.json", sdk_path + "native/ios/build-manifests.json"]:
    skip()
