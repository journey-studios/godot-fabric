extends Node

var checks: Array = []
var hud: Control
var inventory: Control

func check(condition: bool, message: String) -> void:
  checks.append({"name": message, "passed": condition})
  if not condition:
    push_error("CONSUMER_CHECK_FAILED: " + message)

func state(surface: Node) -> Dictionary:
  return JSON.parse_string(surface.call("snapshot"))

func text(surface: Node, id: String) -> String:
  for entry in state(surface).nodes:
    if entry.testID == id:
      return entry.get("nativeText", "")
  return ""

func frames() -> void:
  for i in range(8):
    await get_tree().process_frame

func press(surface: Control, id: String) -> void:
  var control: Control = surface.find_child(id, true, false)
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

func capture(stage: String) -> void:
  if not OS.get_cmdline_user_args().has("--capture"):
    return
  await RenderingServer.frame_post_draw
  check(get_viewport().get_texture().get_image().save_png("res://consumer-" + stage + ".png") == OK, "Consumer capture saved: " + stage)

func _ready() -> void:
  if not OS.get_cmdline_user_args().has("--validate"):
    return
  hud = $HUD
  inventory = $Inventory
  hud.set_meta("validation_input_device", 1001)
  inventory.set_meta("validation_input_device", 1001)
  run_probe()

func run_probe() -> void:
  await frames()
  var initial := state(hud)
  check(not initial.nodes.is_empty() and not state(inventory).nodes.is_empty(), "External TSX mounts native trees")
  check(initial.runtimeId == state(inventory).runtimeId and initial.bundleEvaluations == 1, "Resource config produces one shared application and one bundle evaluation")
  check(initial.surfaceId != state(inventory).surfaceId, "Consumer roots have distinct identities")
  check(text(hud, "hud-title") == "Consumer HUD" and text(inventory, "inventory-title") == "Consumer Inventory", "Scene props reach registered public components")
  check(initial.nodes.any(func(entry: Dictionary) -> bool: return entry.get("nativeText", "") == "Project TSX · Godot platform source"), "Consumer resolution selects project .godot.ts")
  check(initial.errors.is_empty(), "Addon fonts and host load without runtime errors")
  check(not DirAccess.dir_exists_absolute("res://assets"), "Consumer has no laboratory asset directory")
  check(hud.find_child("hud-input", true, false).is_class("LineEdit"), "Public TextInput commits a native editor")
  await capture("initial")
  await press(hud, "hud-increment")
  check(text(hud, "hud-local") == "Local: 1" and text(inventory, "inventory-local") == "Local: 0", "Native input updates only its own React root")
  await press(hud, "hud-publish")
  check(text(hud, "hud-shared") == "Shared: 1" and text(inventory, "inventory-shared") == "Shared: 1", "Project-owned store updates both roots")
  var input: LineEdit = hud.find_child("hud-input", true, false)
  input.text = "consumer TSX"
  input.emit_signal("text_changed", input.text)
  await frames()
  check(text(hud, "hud-query") == "Input: consumer TSX", "Native editing rerenders the consumer component")
  hud.call("update_props", {"panel": "hud", "title": "Props from Godot"})
  await frames()
  check(text(hud, "hud-title") == "Props from Godot" and text(hud, "hud-local") == "Local: 1", "Godot prop updates preserve local React state")
  check(state(hud).surfaceId == initial.surfaceId, "Prop updates retain root identity")
  await capture("updated")
  inventory.call("unmount")
  await frames()
  check(state(inventory).nodes.is_empty() and text(hud, "hud-local") == "Local: 1", "Consumer unmount preserves the other native tree")
  check(inventory.call("mount"), "Consumer root mounts again")
  await frames()
  check(text(inventory, "inventory-local") == "Local: 0" and text(inventory, "inventory-shared") == "Shared: 1", "Remount resets local state and preserves the project store")
  check(state(hud).errors.is_empty() and state(inventory).errors.is_empty(), "Consumer lifecycle remains free of native errors")
  $Application/Runtime.call("stop")
  check(state(hud).nativeTags == 0 and state(hud).rootCount == 0 and state(hud).pendingTimers == 0, "Consumer shutdown releases native tags, roots and timers")
  var report := {"schemaVersion": 1, "host": "independent-consumer", "displayServer": DisplayServer.get_name(), "checks": checks, "beforeStop": initial, "afterStop": state(hud)}
  var output := FileAccess.open("res://consumer-report.json", FileAccess.WRITE)
  output.store_string(JSON.stringify(report, "  ") + "\n")
  var success := checks.all(func(entry: Dictionary) -> bool: return entry.passed)
  print("CONSUMER_VALIDATION_PASSED" if success else "CONSUMER_VALIDATION_FAILED")
  get_tree().quit(0 if success else 1)
