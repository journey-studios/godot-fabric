@tool
extends EditorPlugin

const Builder = preload("build.gd")
const IOSExport = preload("ios_export.gd")
const MacOSExport = preload("macos_export.gd")
var ios_export: EditorExportPlugin
var macos_export: EditorExportPlugin

func _enter_tree() -> void:
  ios_export = IOSExport.new()
  add_export_plugin(ios_export)
  macos_export = MacOSExport.new()
  add_export_plugin(macos_export)
  add_tool_menu_item("Godot Fabric: Build UI", _build_ui)
  if OS.get_cmdline_user_args().has("--godot-fabric-build-check"):
    call_deferred("_build_check")

func _exit_tree() -> void:
  if ios_export != null:
    remove_export_plugin(ios_export)
  if macos_export != null:
    remove_export_plugin(macos_export)
  remove_tool_menu_item("Godot Fabric: Build UI")

func _build_ui() -> void:
  Builder.run()

func _build() -> bool:
  return Builder.run()

func _build_check() -> void:
  # Run the actual plugin in the normal editor MainLoop, including fresh import.
  for i in range(30):
    await get_tree().process_frame
  while EditorInterface.get_resource_filesystem().is_scanning():
    await get_tree().process_frame
  var success := _build()
  print("CONSUMER_EDITOR_BUILD_PASSED" if success else "CONSUMER_EDITOR_BUILD_REJECTED")
  get_tree().quit(0 if success else 1)
