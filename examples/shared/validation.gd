extends Node

var checks: Array = []

func check(condition: bool, message: String) -> void:
  checks.append({"name": message, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + message)

func frames(count: int = 8) -> void:
  for i in range(count):
    await get_tree().process_frame

func state(surface: Node) -> Dictionary:
  return JSON.parse_string(surface.call("snapshot"))

func native_node(surface: Control, id: String) -> Dictionary:
  for entry in state(surface).nodes:
    if entry.testID == id:
      return entry
  return {}

func press(surface: Control, id: String) -> void:
  var control: Control = surface.find_child(id, true, false)
  # Exercise the real Godot Button transport in both lanes.
  if DisplayServer.get_name() == "headless":
    control.emit_signal("pressed")
  else:
    var motion := InputEventMouseMotion.new()
    motion.device = 1001
    motion.position = control.get_global_rect().get_center()
    get_viewport().push_input(motion, true)
    for down in [true, false]:
      var event := InputEventMouseButton.new()
      event.device = 1001
      event.position = motion.position
      event.button_index = MOUSE_BUTTON_LEFT
      event.pressed = down
      get_viewport().push_input(event, true)
  await frames()

func js(application: Node) -> Dictionary:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(SharedRoots.stats())"))

func finish() -> void:
  var report := {"scenario": "shared", "engine": "hermes", "renderer": "fabric", "godot": Engine.get_version_info().string, "reactNative": "0.87.1", "displayServer": DisplayServer.get_name(), "checks": checks, "beforeStop": before_stop, "afterStop": state(hud)}
  var output := FileAccess.open("res://build/report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_ERROR: Cannot publish shared application report")
    get_tree().quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  print("SHARED_APPLICATION_FAILED" if failed else "FABRIC_VALIDATION_PASSED: shared " + str(checks.size()))
  get_tree().quit(1 if failed else 0)

var app: Node
var hud: Control
var inventory: Control
var before_stop: Dictionary = {}

func _ready() -> void:
  app = $SharedApplication
  hud = $HUD
  inventory = $Inventory
  get_window().size = Vector2i(1080, 560)
  if not OS.get_cmdline_user_args().has("--validate"):
    return
  hud.set_meta("validation_input_device", 1001)
  inventory.set_meta("validation_input_device", 1001)
  run_probe()

func capture(stage: String) -> void:
  if not OS.get_cmdline_user_args().has("--capture"):
    return
  await RenderingServer.frame_post_draw
  check(get_viewport().get_texture().get_image().save_png("res://build/shared-" + stage + ".png") == OK, "Renderer capture saved: " + stage)

func run_probe() -> void:
  await frames()
  var a := state(hud)
  var b := state(inventory)
  check(a.surfaceId != b.surfaceId, "Native roots receive distinct IDs")
  check(a.runtimeId == b.runtimeId, "Both roots use the same Hermes runtime")
  check(js(app).evaluations == 1 and a.bundleEvaluations == 1, "Application bundle executes once")
  check(js(app).roots.hud.rootTag == a.surfaceId and js(app).roots.inventory.rootTag == b.surfaceId, "Original RootTagContext identifies each root")
  check(a.nodes.size() > 0 and b.nodes.size() > 0, "Both roots commit native Controls")
  check(a.viewport.width == 460 and b.viewport.width == 460, "Each root uses its own Control constraints")
  var inv_tag: int = native_node(inventory, "inventory-increment").tag
  hud.call("activate", inv_tag)
  await frames()
  check(js(app).roots.inventory.local == 0, "An event cannot target another root through a borrowed tag")
  await press(hud, "hud-increment")
  check(js(app).roots.hud.local == 1 and js(app).roots.inventory.local == 0, "HUD native input reaches only the HUD React root")
  await press(inventory, "inventory-increment")
  check(js(app).roots.inventory.local == 1 and js(app).roots.hud.local == 1, "Inventory native input reaches only the Inventory React root")
  app.call("evaluate", "SharedRoots.local('hud',0); SharedRoots.local('inventory',0)")
  await frames()
  inventory.size.x = 380
  await frames()
  check(state(inventory).viewport.width == 380 and state(hud).viewport.width == 460, "Resizing one surface preserves the other root's constraints")
  inventory.size.x = 460
  await frames()
  await capture("initial")
  app.call("evaluate", "SharedRoots.local('hud',2); SharedRoots.share(7)")
  await frames()
  check(js(app).roots.hud.local == 2 and js(app).roots.inventory.local == 0, "Local React state stays independent")
  check(js(app).roots.hud.shared == 7 and js(app).roots.inventory.shared == 7, "Explicit module store updates both roots")
  hud.call("update_props", {"panel": "hud", "title": "HUD updated"})
  await frames()
  check(state(hud).surfaceId == a.surfaceId and js(app).roots.hud.local == 2, "Prop updates preserve root identity and local state")
  check(js(app).roots.hud.title == "HUD updated", "AppRegistry receives updated root props")
  await capture("updated")
  var old_tags: Array = state(inventory).nodes.map(func(node: Dictionary) -> int: return int(node.tag))
  var tick_before: int = js(app).ticks
  inventory.call("unmount")
  await frames()
  var detached := state(inventory)
  check(detached.nodes.is_empty() and detached.nativeTags == 0 and detached.creates == detached.deletes, "Unmount removes only the selected native tree and releases every tag")
  check(js(app).cleanups.inventory == 1 and js(app).cleanups.get("hud", 0) == 0, "React cleanup belongs to the unmounted root")
  check(js(app).roots.hud.local == 2 and not js(app).roots.has("inventory"), "Surviving root preserves state")
  await capture("unmounted")
  check(js(app).subscribers == 1, "Unmount releases root subscriptions without clearing the store")
  await get_tree().create_timer(0.08).timeout
  check(js(app).ticks > tick_before, "Application timers survive an individual unmount")
  check(inventory.call("mount"), "A detached surface can mount again")
  await frames()
  check(state(inventory).surfaceId != b.surfaceId, "Remount allocates a new root identity")
  check(js(app).roots.inventory.local == 0 and js(app).roots.inventory.shared == 7, "Remount resets local state and preserves application state")
  check(state(inventory).nodes.all(func(node: Dictionary) -> bool: return not old_tags.has(int(node.tag))), "Retired tags cannot identify the new native tree")
  inventory.call("activate", inv_tag)
  await frames()
  check(js(app).roots.inventory.local == 0, "Queued activation with a retired tag cannot affect the new root")
  hud.hide()
  await frames()
  check(js(app).roots.hud.local == 2 and js(app).subscribers == 2, "Hiding preserves the React root and effects")
  hud.show()
  inventory.queue_free()
  await frames()
  check(js(app).subscribers == 1 and js(app).roots.hud.local == 2, "Removing a Godot Node unmounts its root without restarting Hermes")
  var replacement: Control = ClassDB.instantiate("FabricSurface")
  replacement.set("application_path", NodePath("../SharedApplication"))
  replacement.set("component_name", "Inventory")
  replacement.set("initial_props", {"panel": "inventory", "title": "New scene"})
  replacement.position = Vector2(520, 24)
  replacement.size = Vector2(460, 500)
  add_child(replacement)
  await frames()
  check(state(replacement).runtimeId == a.runtimeId and js(app).evaluations == 1, "A replacement scene node reuses the live application and module cache")
  check(js(app).roots.inventory.local == 0 and js(app).roots.inventory.shared == 7, "A replacement root starts fresh local state over the existing store")
  var previous: int = state(hud).surfaceId
  hud.call("unmount")
  replacement.call("unmount")
  var idle := js(app)
  await get_tree().create_timer(0.06).timeout
  check(js(app).subscribers == 0 and js(app).ticks > idle.ticks and JSON.parse_string(app.call("snapshot")).rootCount == 0, "Application remains alive with zero mounted roots")
  check(hud.call("mount"), "The live application can mount after all roots were removed")
  await frames()
  check(state(hud).surfaceId != previous and js(app).roots.hud.local == 0 and js(app).roots.hud.shared == 7, "A new root receives fresh identity over persistent module state")
  check(state(hud).errors.is_empty(), "Root lifecycle and input complete without host errors")
  before_stop = state(hud)
  app.call("stop")
  await frames()
  var stopped := state(hud)
  check(stopped.nodes.is_empty() and stopped.nativeTags == 0 and stopped.creates == stopped.deletes and stopped.rootCount == 0 and stopped.pendingTimers == 0 and stopped.pendingAnimationFrames == 0 and stopped.pendingWork == 0, "Application shutdown removes all roots and scheduling resources")
  check(js(app).subscribers == 0, "Application shutdown releases remaining React effects")
  app.queue_free()
  await frames()
  check(state(hud).applicationStopped and state(hud).stopped and state(hud).nodes.is_empty(), "Surface can inspect finalized shutdown after its application Node is freed")
  finish()
