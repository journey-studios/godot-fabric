@tool
extends RefCounted
class_name FabricExportPayload

const MANIFEST_FORMAT := "godot-fabric.assets/v1"
const REPORT_NAME := "build-report.json"

static func validate_application(application: Resource) -> Dictionary:
	if application == null or not application.has_method("validation_error"):
		return _failure("Configure a valid Godot Fabric application Resource before exporting")
	var application_error: String = application.validation_error()
	if not application_error.is_empty():
		return _failure(application_error)
	var bundle_path: Variant = application.get("bundle_file")
	if not bundle_path is String or not _is_project_path(bundle_path):
		return _failure("The application bundle must be a normalized res:// path")
	var selected_bundle: String = bundle_path
	if not _is_regular_project_file(bundle_path):
		return _failure("The application bundle is missing or passes through a symlink: %s" % bundle_path)
	var bundle_bytes := FileAccess.get_file_as_bytes(bundle_path)
	var bundle_sha := _sha256(bundle_bytes)
	var report_path: String = selected_bundle.get_base_dir().path_join(REPORT_NAME)
	if not _is_regular_project_file(report_path):
		return _failure("The bundle build report is missing or passes through a symlink: %s" % report_path)
	var report := _read_json(report_path)
	if not report.ok:
		return _failure("The bundle build report is malformed: %s" % report_path)
	var build: Dictionary = report.value
	for key in ["schemaVersion", "entry", "bundle", "sdkSourceCommit", "sha256", "inputs", "typeChecker", "adapterSelection", "assets", "styles"]:
		if not build.has(key):
			return _failure("The bundle build report is missing required field '%s'" % key)
	if build.schemaVersion != 1 or build.bundle != selected_bundle or not build.entry is String or not build.inputs is Array or not build.typeChecker is Dictionary or (build.styles != null and not build.styles is Dictionary):
		return _failure("The bundle build report does not describe the selected application bundle")
	if build.entry != application.get("entry_file") or not build.sdkSourceCommit is String or build.sdkSourceCommit.is_empty():
		return _failure("The bundle build report does not match the selected entry point or SDK source")
	if not _valid_sha(build.sha256) or build.sha256 != bundle_sha:
		return _failure("The bundle SHA-256 does not match its build report")
	if build.adapterSelection != null:
		return _failure("Codegen adapter selections are not supported by this export target")
	var adapter_packet_path: String = selected_bundle + ".adapters.json"
	if FileAccess.file_exists(adapter_packet_path) or _path_has_symlink(adapter_packet_path):
		if not _is_regular_project_file(adapter_packet_path):
			return _failure("The adapter selection packet passes through a symlink: %s" % adapter_packet_path)
		return _failure("An adapter selection packet is present but not declared by the bundle build report")
	if not build.assets is Dictionary and build.assets != null:
		return _failure("The bundle build report has an invalid assets record")
	return _validate_assets(bundle_path, bundle_bytes, build.assets)

static func _validate_assets(bundle_path: String, bundle_bytes: PackedByteArray, assets_record: Variant) -> Dictionary:
	var manifest_path := bundle_path + ".assets.json"
	var manifest_exists := FileAccess.file_exists(manifest_path)
	var expected_count := 0
	if assets_record == null:
		if manifest_exists or _path_has_symlink(manifest_path):
			return _failure("A stale asset manifest is present but the build report declares no assets")
		return _success(bundle_path, bundle_bytes, [])
	if not assets_record.has("path") or not assets_record.path is String or not assets_record.has("files") or not _is_count(assets_record.files):
		return _failure("The bundle build report has an invalid assets record")
	if assets_record.path != manifest_path.trim_prefix("res://") or assets_record.files < 0:
		return _failure("The bundle build report names an invalid asset manifest")
	expected_count = int(assets_record.files)
	if not manifest_exists:
		if _path_has_symlink(manifest_path):
			return _failure("The asset manifest path passes through a symlink: %s" % manifest_path)
		if expected_count == 0:
			return _success(bundle_path, bundle_bytes, [])
		return _failure("The asset manifest is missing; build the application bundle again")
	if not _is_regular_project_file(manifest_path):
		return _failure("The asset manifest passes through a symlink: %s" % manifest_path)
	var parsed := _read_json(manifest_path)
	if not parsed.ok:
		return _failure("The asset manifest is malformed: %s" % manifest_path)
	var manifest: Dictionary = parsed.value
	if manifest.get("format") != MANIFEST_FORMAT or manifest.get("bundle") != bundle_path.get_file():
		return _failure("The asset manifest does not describe this application bundle")
	if manifest.get("bundleSha256") != _sha256(bundle_bytes):
		return _failure("The asset manifest does not match the selected bundle")
	if not manifest.get("publicPath") is String or not manifest.get("assets") is Array or not manifest.get("files") is Array:
		return _failure("The asset manifest does not match the selected bundle")
	if manifest.files.size() != expected_count:
		return _failure("The asset manifest file count does not match the bundle build report")
	var seen := {}
	var files: Array[Dictionary] = []
	for entry: Variant in manifest.files:
		if not entry is Dictionary or not entry.get("path") is String or not _valid_sha(entry.get("sha256")):
			return _failure("The asset manifest contains an invalid file record")
		var relative: String = entry.path
		if not _is_relative_path(relative) or not relative.begins_with("assets/") or seen.has(relative):
			return _failure("The asset manifest contains a duplicate or unsafe path: %s" % relative)
		seen[relative] = true
		var asset_path := bundle_path.get_base_dir().path_join(relative)
		if not _is_regular_project_file(asset_path):
			return _failure("The asset is missing or passes through a symlink: %s" % asset_path)
		var bytes := FileAccess.get_file_as_bytes(asset_path)
		if _sha256(bytes) != entry.sha256:
			return _failure("The asset hash does not match the manifest: %s" % asset_path)
		if entry.has("bytes") and (not _is_count(entry.bytes) or int(entry.bytes) != bytes.size()):
			return _failure("The asset byte count does not match the manifest: %s" % asset_path)
		files.append({"path": asset_path, "bytes": bytes})
	files.push_front({"path": manifest_path, "bytes": FileAccess.get_file_as_bytes(manifest_path)})
	return _success(bundle_path, bundle_bytes, files)

static func _is_project_path(value: String) -> bool:
	return value.begins_with("res://") and _is_relative_path(value.trim_prefix("res://"))

static func _is_relative_path(value: String) -> bool:
	if value.is_empty() or value.is_absolute_path() or "\\" in value:
		return false
	for part in value.split("/", true):
		if part.is_empty() or part == "." or part == "..":
			return false
	return true

static func _is_regular_project_file(path: String) -> bool:
	return _is_project_path(path) and FileAccess.file_exists(path) and not _path_has_symlink(path)

static func _path_has_symlink(path: String) -> bool:
	if not _is_project_path(path):
		return true
	var parts := path.trim_prefix("res://").split("/", true)
	var directory := DirAccess.open("res://")
	if directory == null:
		return true
	for index in range(parts.size()):
		if directory.is_link(parts[index]):
			return true
		if index < parts.size() - 1:
			if not directory.dir_exists(parts[index]) or directory.change_dir(parts[index]) != OK:
				return false
	return false

static func is_editor_file(path: String, sdk_path: String) -> bool:
	var root := sdk_path.trim_suffix("/") + "/"
	for directory in ["toolchain/", "src/", "types/"]:
		if path.begins_with(root + directory):
			return true
	for editor_file in ["plugin.gd", "ios_export.gd", "macos_export.gd", "export_payload.gd", "export_preflight.gd", "build.gd", "plugin.cfg"]:
		if path == root + editor_file:
			return true
	return path in [root + "manifest.json", root + "native/ios/build-manifests.json"]

static func _is_count(value: Variant) -> bool:
	if value is int:
		return value >= 0
	return value is float and is_finite(value) and value >= 0.0 and floor(value) == value

static func _read_json(path: String) -> Dictionary:
	var parser := JSON.new()
	if parser.parse(FileAccess.get_file_as_string(path)) != OK:
		return {"ok": false}
	return {"ok": parser.data is Dictionary, "value": parser.data}

static func _valid_sha(value: Variant) -> bool:
	if not value is String or value.length() != 64:
		return false
	for character in value:
		if not (character >= "0" and character <= "9") and not (character >= "a" and character <= "f"):
			return false
	return true

static func _sha256(bytes: PackedByteArray) -> String:
	var context := HashingContext.new()
	context.start(HashingContext.HASH_SHA256)
	context.update(bytes)
	return context.finish().hex_encode()

static func _success(bundle_path: String, bundle_bytes: PackedByteArray, payload_files: Array) -> Dictionary:
	var files: Array[Dictionary] = [{"path": bundle_path, "bytes": bundle_bytes}]
	files.append_array(payload_files)
	return {"error": "", "bundle_path": bundle_path, "files": files}

static func _failure(message: String) -> Dictionary:
	return {"error": message}
