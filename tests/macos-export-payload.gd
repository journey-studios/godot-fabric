extends SceneTree

const ExportPayload = preload("../sdk/addon/export_payload.gd")
const ApplicationScript = preload("../sdk/addon/application_resource.gd")
const IOSExportScript = preload("../sdk/addon/ios_export.gd")
const MacOSExportScript = preload("../sdk/addon/macos_export.gd")
const ROOT := "res://.godot_fabric/export-payload-tests"
const BUNDLE := ROOT + "/app.js"
const MANIFEST := BUNDLE + ".assets.json"
const ASSET := "assets/icon.bin"

var checks := 0

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	assert(IOSExportScript != null and MacOSExportScript != null)
	var app := _application()
	var report := _report(null)
	_setup("bundle", report, null, {})
	_expect_success(app, "valid bundle without assets")
	report = _report(null)
	report.erase("sdkSourceCommit")
	_setup("bundle", report, null, {})
	_expect_rejection(app, "SDK source field is required", "sdkSourceCommit")
	report = _report({"path": MANIFEST.trim_prefix("res://"), "files": 0})
	_setup("bundle", report, null, {})
	_expect_success(app, "zero assets can omit a manifest")
	report.entry = "res://ui/other.js"
	_setup("bundle", report, null, {})
	_expect_rejection(app, "entry point must match the application resource", "entry point")
	report = _report(null)
	report.sha256 = _sha("old bundle")
	_setup("bundle", report, null, {})
	_expect_rejection(app, "report SHA must match serialized bundle bytes", "SHA-256")

	report = _report({"path": MANIFEST.trim_prefix("res://"), "files": 0})
	_setup("bundle", report, {"format": "godot-fabric.assets/v1", "bundle": "app.js", "bundleSha256": _sha("bundle"), "publicPath": "/assets", "assets": [], "files": []}, {})
	_expect_success(app, "valid empty manifest")

	report = _report({"path": MANIFEST.trim_prefix("res://"), "files": 1})
	_setup("bundle", report, _manifest("bundle", [{"path": ASSET, "sha256": _sha("icon"), "bytes": 4}]), {ASSET: "icon"})
	_expect_success(app, "valid hashed asset")

	_setup("changed bundle", report, _manifest("bundle", [{"path": ASSET, "sha256": _sha("icon"), "bytes": 4}]), {ASSET: "icon"})
	_expect_rejection(app, "build report SHA must bind the selected bundle", "SHA-256")

	report = _report({"path": MANIFEST.trim_prefix("res://"), "files": 1})
	_setup("bundle", report, null, {})
	_expect_rejection(app, "positive asset count requires its manifest", "manifest is missing")
	report.assets.files = 0
	_setup("bundle", report, _manifest("bundle", [{"path": ASSET, "sha256": _sha("icon"), "bytes": 4}]), {ASSET: "icon"})
	_expect_rejection(app, "zero count cannot hide a nonempty manifest", "file count")
	report.assets.files = 0.5
	_setup("bundle", report, null, {})
	_expect_rejection(app, "fractional asset counts are invalid", "invalid assets record")
	report = _report({"path": ROOT + "/build-report.json", "files": 1})
	_setup("bundle", report, _manifest("bundle", [{"path": ASSET, "sha256": _sha("icon"), "bytes": 4}]), {ASSET: "icon"})
	_expect_rejection(app, "asset destinations cannot target build metadata", "invalid asset manifest")
	report = _report({"path": MANIFEST.trim_prefix("res://"), "files": 1})
	_setup("bundle", report, _manifest("bundle", []), {})
	_expect_rejection(app, "report file count must match manifest", "file count")
	var wrong_bundle_manifest := _manifest("bundle", [{"path": ASSET, "sha256": _sha("icon"), "bytes": 4}])
	wrong_bundle_manifest.bundle = "other.js"
	_setup("bundle", report, wrong_bundle_manifest, {ASSET: "icon"})
	_expect_rejection(app, "manifest bundle hash must match current bundle", "does not describe")
	_setup("bundle", report, _manifest("bundle", [{"path": "assets/missing.bin", "sha256": _sha("icon"), "bytes": 4}]), {})
	_expect_rejection(app, "manifest assets must exist", "missing or passes through")

	_setup("bundle", _report(null), _manifest("bundle", []), {})
	_expect_rejection(app, "null asset record cannot hide a stale manifest", "stale asset manifest")

	_setup("bundle", _report({"path": MANIFEST.trim_prefix("res://"), "files": 0}), _manifest("bundle", []), {})
	_expect_success(app, "present empty manifest is validated")

	report = _report(null)
	report.erase("adapterSelection")
	_setup("bundle", report, null, {})
	_expect_rejection(app, "build report must state adapterSelection", "adapterSelection")

	report = _report(null)
	report.adapterSelection = {"adapters": 1}
	_setup("bundle", report, null, {})
	_expect_rejection(app, "selected Codegen adapters are explicitly unsupported", "Codegen adapter selections")
	report = _report(null)
	_setup("bundle", report, null, {})
	_write(BUNDLE + ".adapters.json", "{}".to_utf8_buffer())
	_expect_rejection(app, "undeclared adapter packet must be rejected", "packet is present but not declared")

	report = _report({"path": MANIFEST.trim_prefix("res://"), "files": 1})
	_setup("bundle", report, _manifest("bundle", [{"path": ASSET, "sha256": _sha("wrong"), "bytes": 4}]), {ASSET: "icon"})
	_expect_rejection(app, "asset hash must match manifest", "asset hash")
	_setup("bundle", report, _manifest("bundle", [{"path": ASSET, "sha256": _sha("icon"), "bytes": 5}]), {ASSET: "icon"})
	_expect_rejection(app, "optional manifest byte count must match", "byte count")
	_setup("bundle", report, _manifest("bundle", [{"path": "../escape.bin", "sha256": _sha("icon"), "bytes": 4}]), {ASSET: "icon"})
	_expect_rejection(app, "parent traversal must be rejected", "unsafe path")
	_setup("bundle", report, _manifest("bundle", [{"path": "assets\\icon.bin", "sha256": _sha("icon"), "bytes": 4}]), {ASSET: "icon"})
	_expect_rejection(app, "backslash paths must be rejected", "unsafe path")
	_setup("bundle", report, _manifest("bundle", [{"path": "/tmp/icon.bin", "sha256": _sha("icon"), "bytes": 4}]), {ASSET: "icon"})
	_expect_rejection(app, "absolute asset paths must be rejected", "unsafe path")
	report.assets.files = 2
	_setup("bundle", report, _manifest("bundle", [
		{"path": ASSET, "sha256": _sha("icon"), "bytes": 4},
		{"path": ASSET, "sha256": _sha("icon"), "bytes": 4}]), {ASSET: "icon"})
	_expect_rejection(app, "duplicate paths must be rejected", "duplicate or unsafe path")

	report = _report({"path": MANIFEST.trim_prefix("res://"), "files": 1})
	_setup("bundle", report, _manifest("bundle", [{"path": "assets/link.bin", "sha256": _sha("icon"), "bytes": 4}]), {ASSET: "icon"})
	_write(ROOT + "/outside.bin", "icon".to_utf8_buffer())
	var link_directory := DirAccess.open(ROOT)
	var link_error := link_directory.create_link("../outside.bin", "assets/link.bin")
	assert(link_error == OK, "The test requires local symlink creation")
	assert(FileAccess.file_exists(ROOT + "/assets/link.bin"), "The test link must resolve to a real file")
	_expect_rejection(app, "asset symlinks must be rejected", "symlink")
	DirAccess.remove_absolute(ProjectSettings.globalize_path(ROOT + "/assets/link.bin"))
	DirAccess.remove_absolute(ProjectSettings.globalize_path(BUNDLE + ".adapters.json"))

	_setup("bundle", [], null, {})
	_expect_rejection(app, "malformed build report must be rejected", "malformed")
	print("MACOS_EXPORT_PAYLOAD_PASSED: %d" % checks)
	quit(0)

func _application() -> Resource:
	var application: Resource = ApplicationScript.new()
	application.entry_file = "res://ui/index.js"
	application.bundle_file = BUNDLE
	return application

func _report(assets_record: Variant) -> Dictionary:
	return {"schemaVersion": 1, "entry": "res://ui/index.js", "bundle": BUNDLE,
		"sdkSourceCommit": "fixture", "sha256": _sha("bundle"), "inputs": [], "typeChecker": {"name": "tsc-rs"},
		"adapterSelection": null, "assets": assets_record, "styles": {}}

func _manifest(bundle_text: String, files: Array) -> Dictionary:
	return {"format": "godot-fabric.assets/v1", "bundle": "app.js", "bundleSha256": _sha(bundle_text),
		"publicPath": "/assets", "assets": [], "files": files}

func _setup(bundle_text: String, report: Variant, manifest: Variant, files: Dictionary) -> void:
	var absolute_root := ProjectSettings.globalize_path(ROOT)
	DirAccess.make_dir_recursive_absolute(absolute_root.path_join("assets"))
	DirAccess.remove_absolute(ProjectSettings.globalize_path(BUNDLE + ".adapters.json"))
	_write(BUNDLE, bundle_text.to_utf8_buffer())
	_write(ROOT + "/build-report.json", (JSON.stringify(report) if report is Dictionary else str(report)).to_utf8_buffer())
	if manifest == null:
		DirAccess.remove_absolute(ProjectSettings.globalize_path(MANIFEST))
	else:
		_write(MANIFEST, JSON.stringify(manifest).to_utf8_buffer())
	for relative: String in files:
		_write(ROOT.path_join(relative), str(files[relative]).to_utf8_buffer())
	var asset_dir := ProjectSettings.globalize_path(ROOT.path_join("assets"))
	for name in DirAccess.get_files_at(asset_dir):
		if not files.has("assets/" + name):
			DirAccess.remove_absolute(asset_dir.path_join(name))

func _write(path: String, bytes: PackedByteArray) -> void:
	var absolute := ProjectSettings.globalize_path(path)
	DirAccess.make_dir_recursive_absolute(absolute.get_base_dir())
	var file := FileAccess.open(absolute, FileAccess.WRITE)
	assert(file != null, "Unable to write fixture file: " + path)
	file.store_buffer(bytes)
	file.close()

func _expect_success(application: Resource, name: String) -> void:
	var result := ExportPayload.validate_application(application)
	assert(result.get("error", "") == "", "%s: %s" % [name, result.get("error", "missing result")])
	checks += 1

func _expect_rejection(application: Resource, name: String, reason: String) -> void:
	var result := ExportPayload.validate_application(application)
	assert(str(result.get("error", "")).contains(reason), "%s: wrong rejection: %s" % [name, result.get("error", "missing result")])
	checks += 1

func _sha(text: String) -> String:
	var context := HashingContext.new()
	context.start(HashingContext.HASH_SHA256)
	context.update(text.to_utf8_buffer())
	return context.finish().hex_encode()
