extends SceneTree

var checks: Array = []
func check(condition: bool, name: String) -> void:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)

func frames() -> void:
  for i in range(8):
    await process_frame

func data(node: Node) -> Dictionary:
  return JSON.parse_string(node.call("snapshot"))

func make_surface(owner: String, entry: String) -> Control:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.set("application_path", NodePath("../" + owner))
  surface.set("component_name", entry)
  surface.set("initial_props", {"panel": "hud", "title": "Failure probe"})
  surface.size = Vector2(460, 500)
  root.add_child(surface)
  return surface

func _initialize() -> void:
  call_deferred("run_probe")

func run_probe() -> void:
  var wrong := Node.new()
  wrong.name = "WrongOwner"
  root.add_child(wrong)
  var invalid := make_surface("WrongOwner", "HUD")
  check(invalid.call("get_surface_id") == 0 and data(invalid).nodes.is_empty(), "A wrong application path cannot allocate a native root")
  invalid.queue_free()
  wrong.queue_free()
  var app: Node = ClassDB.instantiate("FabricApplication")
  app.name = "Application"
  app.set_meta("scenario", "shared")
  root.add_child(app)
  var surface := make_surface("Application", "MissingEntry")
  await frames()
  check(data(app).rootCount == 0 and surface.call("get_surface_id") == 0, "An unregistered entry fails before allocating a ShadowTree")
  surface.set("component_name", "toString")
  check(not surface.call("mount") and data(app).rootCount == 0, "Prototype properties cannot masquerade as registered entries")
  check(data(app).errors.size() == 2, "Mount failures reach the application diagnostic channel")
  surface.set("component_name", "HUD")
  check(surface.call("mount"), "The live application accepts a registered entry after a rejected mount")
  await frames()
  check(data(surface).nodes.size() > 0 and data(app).bundleEvaluations == 1, "Failed mounts do not reevaluate the bundle")
  for kind in ["duplicate", "section", "reserved"]:
    var message: String = app.call("evaluate", "SharedRoots.registrationProbe('" + kind + "')")
    check(message != "unexpected success", "Registry rejects unsupported or duplicate registration: " + kind)
  check(app.call("evaluate", "JSON.stringify(SharedRoots.stats().roots.hud.title)") == '"Failure probe"', "Duplicate registration cannot replace a live entry")
  app.call("stop")
  check(data(surface).nodes.is_empty() and data(app).rootCount == 0 and data(app).pendingTimers == 0, "Shutdown clears all resources after rejected mounts")
  check(not surface.call("mount"), "A stopped application cannot silently restart")
  app.queue_free()
  await frames()
  var missing: Node = ClassDB.instantiate("FabricApplication")
  missing.name = "MissingBundle"
  missing.set_meta("scenario", "shared")
  missing.set("bundle_path", "res://tests/absent-shared-bundle.js")
  root.add_child(missing)
  var cold := make_surface("MissingBundle", "HUD")
  await frames()
  check(cold.call("get_surface_id") == 0 and data(missing).rootCount == 0, "Missing bundle cannot leave a partially mounted root")
  check(data(missing).stopped and data(missing).pendingTimers == 0 and data(missing).pendingWork == 0, "Failed initialization releases scheduling resources")
  check(data(missing).errors.size() == 1 and data(missing).bundleEvaluations == 0, "Failed bundle load remains visible and is never counted as evaluated")
  # Detaching the owner must fail promptly; repeatedly deferred retries could
  # otherwise hang Godot's message queue with no opportunity to process a frame.
  root.remove_child(missing)
  check(not cold.call("mount"), "An off-tree owner is rejected without an unbounded deferred retry")
  missing.free()
  check(data(cold).nodes.is_empty(), "A surface with a freed owner exposes an empty native tree")
  var closing: Node = ClassDB.instantiate("FabricApplication")
  closing.name = "OwnerExit"
  closing.set_meta("scenario", "shared")
  root.add_child(closing)
  var orphan := make_surface("OwnerExit", "HUD")
  await frames()
  check(data(orphan).nodes.size() > 0 and data(closing).pendingTimers > 0, "Owner destruction starts with a committed root and a live application timer")
  closing.queue_free()
  await frames()
  var closed := data(orphan)
  check(closed.stopped and closed.applicationStopped and closed.nodes.is_empty() and closed.nativeTags == 0 and closed.creates == closed.deletes and closed.pendingTimers == 0 and closed.pendingWork == 0, "Destroying a live owner releases its runtime resources while surface Nodes survive")
  var report := {"checks": checks}
  var output := FileAccess.open("res://build/shared-failures-report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_CHECK_FAILED: Cannot save failure report")
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  print("SHARED_FAILURES_FAILED" if failed else "SHARED_FAILURES_PASSED")
  quit(1 if failed else 0)
