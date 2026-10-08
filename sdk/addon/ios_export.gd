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
  # The pictures the bundle requires are raw files beside it, named with their SHA-256 in <bundle>.assets.json. Add exactly the
  # files that manifest names, under their resource paths: nothing else in that directory ships.
  var manifest_path: String = application.bundle_file + ".assets.json"
  if FileAccess.file_exists(manifest_path) and not _add_assets(application.bundle_file, manifest_path):
    return
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

func _sha256(bytes: PackedByteArray) -> String:
  var context := HashingContext.new()
  context.start(HashingContext.HASH_SHA256)
  context.update(bytes)
  return context.finish().hex_encode()

func _asset_error(message: String) -> bool:
  get_export_platform().add_message(EditorExportPlatform.EXPORT_MESSAGE_ERROR, "Godot Fabric", message)
  return false

func _add_assets(bundle_path: String, manifest_path: String) -> bool:
  var manifest: Variant = JSON.parse_string(FileAccess.get_file_as_string(manifest_path))
  if not manifest is Dictionary or manifest.get("format", "") != "godot-fabric.assets/v1" or not manifest.get("files", null) is Array:
    return _asset_error("%s is not a godot-fabric.assets/v1 manifest; build the application bundle again" % manifest_path)
  # The manifest and the bundle are written together; a manifest of another bundle is a build that did not finish.
  if manifest.get("bundleSha256", "") != _sha256(FileAccess.get_file_as_bytes(bundle_path)):
    return _asset_error("The asset manifest does not belong to the application bundle; build the application bundle again")
  var directory := bundle_path.get_base_dir()
  var entries: Array = []
  for entry: Variant in manifest.files:
    if not entry is Dictionary or not entry.get("path", null) is String or not entry.get("sha256", null) is String:
      return _asset_error("The asset manifest has an entry without a path and a SHA-256")
    var relative: String = entry.path
    if relative.is_empty() or relative.is_absolute_path() or relative.begins_with("/") or ".." in relative.split("/"):
      return _asset_error("The asset manifest names a path outside the bundle's directory: %s" % relative)
    var file_path := directory.path_join(relative)
    if not FileAccess.file_exists(file_path):
      return _asset_error("The asset %s is missing; build the application bundle again" % file_path)
    var bytes := FileAccess.get_file_as_bytes(file_path)
    if _sha256(bytes) != entry.sha256:
      return _asset_error("The asset %s changed after the application bundle was built; build it again" % file_path)
    entries.append([file_path, bytes])
  for entry: Array in entries:
    add_file(entry[0], entry[1], false)
  add_file(manifest_path, FileAccess.get_file_as_bytes(manifest_path), false)
  return true
