@tool
extends RefCounted

static func run() -> bool:
  var resource_path: String = ProjectSettings.get_setting("godot_fabric/application", "res://ui/application.tres")
  var application: Resource = load(resource_path)
  if application == null or not application.has_method("validation_error"):
    push_error("Godot Fabric: configure godot_fabric/application with an application Resource")
    return false
  var problem: String = application.validation_error()
  if not problem.is_empty():
    push_error("Godot Fabric: " + problem)
    return false
  var sdk := "res://addons/godot_fabric/"
  var executable := ProjectSettings.globalize_path(sdk + "toolchain/node/bin/node")
  if not FileAccess.file_exists(executable):
    push_error("Godot Fabric: private toolchain missing; install a provisioned addon (Play never installs packages)")
    return false
  var output: Array = []
  var code := OS.execute(executable, PackedStringArray([
    ProjectSettings.globalize_path(sdk + "toolchain/build.mjs"),
    ProjectSettings.globalize_path("res://"), application.entry_file, application.bundle_file,
  ]), output, true)
  for line in output:
    print(str(line).strip_edges())
  if code != 0:
    push_error("Godot Fabric: build failed; Play blocked. See the build diagnostic above.")
    return false
  return true
