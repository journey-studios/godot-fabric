extends "res://game.gd"

var checks: Array = []
var hud: Control
var inventory: Control
var geometry_observations: Dictionary = {}

func check(condition: bool, message: String) -> void:
  checks.append({"name": message, "passed": condition})
  if not condition:
    push_error("CONSUMER_CHECK_FAILED: " + message)
    print("MACOS_EXPORT_FAILED_SNAPSHOT:" + JSON.stringify({"check": message, "hud": state(hud), "inventory": state(inventory)}))

func damage_events_equal(actual: Array, expected: Array) -> bool:
  if actual.size() != expected.size():
    return false
  for index in range(actual.size()):
    if not actual[index] is Dictionary or actual[index].size() != 2:
      return false
    if actual[index].get("amount") != float(expected[index].amount) or actual[index].get("reason") != expected[index].reason:
      return false
  return true

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

func services() -> Dictionary:
  return JSON.parse_string($Application/Runtime.call("evaluate", "JSON.stringify(ConsumerServices.stats())"))

func geometry() -> Dictionary:
  return JSON.parse_string($Application/Runtime.call("evaluate", "JSON.stringify(ConsumerGeometry.stats())"))

func rect_matches(actual: Dictionary, expected: Rect2) -> bool:
  return actual.size() == 4 and absf(float(actual.get("x", -1000)) - expected.position.x) < 0.1 and absf(float(actual.get("y", -1000)) - expected.position.y) < 0.1 and absf(float(actual.get("width", -1000)) - expected.size.x) < 0.1 and absf(float(actual.get("height", -1000)) - expected.size.y) < 0.1

func wait_for_services(expression: String) -> bool:
  for index in range(64):
    if $Application/Runtime.call("evaluate", expression) == "true":
      return true
    await get_tree().process_frame
  return false

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
  check(get_viewport().get_texture().get_image().save_png("user://consumer-" + stage + ".png") == OK, "Consumer capture saved: " + stage)

func _enter_tree() -> void:
  super._enter_tree()
  if DisplayServer.get_name() != "headless":
    get_tree().root.content_scale_mode = Window.CONTENT_SCALE_MODE_CANVAS_ITEMS

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
  check(service_bindings.size() == 3 and service_bindings.all(func(binding: Object) -> bool: return is_instance_valid(binding)), "SDK runtime_available hook binds GDScript services before consumer roots mount")
  check(await wait_for_services("ConsumerServices.stats().ready === 2"), "Public typed state and signal subscriptions initialize in the independent SDK consumer")
  check(health == 95 and getter_calls == 2 and services().health == 95 and services().revision == 1,
    "State snapshot retries a changed getter and exposes the current revision")
  check(damage_events_equal(services().damages, [{"amount": 5, "reason": "during-connect"}]), "Initial snapshot race preserves its signal occurrence exactly once")
  check(text(hud, "hud-health") == "Game health: 95" and text(inventory, "inventory-health") == "Game health: 95",
    "Game-owned state rerenders both independent native roots")
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
  $Application/Runtime.call("evaluate", "ConsumerServices.damage(3, 'consumer-call')")
  check(method_calls == 0 and health == 95, "Typed calls queue GDScript work outside the JavaScript render stack")
  check(await wait_for_services("ConsumerServices.stats().operations.length === 1"), "Typed consumer call settles through the native SDK transport")
  var operation: Dictionary = services().operations[0]
  check(method_calls == 1 and health == 92 and operation.value == 92 and operation.response == "completion" and operation.name == "consumer.damage" and operation.origin == "default",
    "Completion metadata and result correspond to the executed GDScript method")
  apply_damage(1, "signal-one")
  apply_damage(2, "signal-two")
  await frames()
  var delivered: Array = services().damages
  check(delivered.size() == 4 and damage_events_equal(delivered.slice(2), [{"amount": 1, "reason": "signal-one"}, {"amount": 2, "reason": "signal-two"}]),
    "Consecutive Godot signals preserve every occurrence and its argument order")
  check(services().health == 89 and services().revision == 4 and text(hud, "hud-health") == "Game health: 89" and text(inventory, "inventory-health") == "Game health: 89",
    "Typed state updates pair the same revision with both native trees")
  var hud_before_resize := state(hud)
  var inventory_before_resize := state(inventory)
  var inventory_size := inventory.size
  inventory.size = Vector2(430, inventory_size.y)
  await frames()
  var resized := state(inventory)
  check(float(resized.viewport.width) == 430 and state(hud).viewport == hud_before_resize.viewport,
    "Inventory-only resize changes its Yoga constraints while preserving HUD constraints")
  check(resized.surfaceId == inventory_before_resize.surfaceId and state(hud).surfaceId == hud_before_resize.surfaceId and text(hud, "hud-local") == "Local: 1" and text(inventory, "inventory-local") == "Local: 0",
    "Independent resize preserves root identity and local React state")
  check(resized.dimensions == hud_before_resize.dimensions and state(hud).dimensions == hud_before_resize.dimensions,
    "Surface constraints do not replace original RN window and screen metrics")
  $Application/Runtime.call("evaluate", "ConsumerGeometry.measure('hud'); ConsumerGeometry.measure('inventory')")
  check(await wait_for_services("ConsumerGeometry.stats().hud != null && ConsumerGeometry.stats().inventory != null"),
    "Original public View refs measure both resized consumer surfaces")
  var measured := geometry()
  geometry_observations = {"resized": measured, "windowMetrics": resized.dimensions}
  check(rect_matches(measured.hud, hud.get_global_rect()) and rect_matches(measured.inventory, inventory.get_global_rect()),
    "Public measureInWindow agrees with Godot global geometry after inventory-only resize")
  var inventory_input: LineEdit = inventory.find_child("inventory-input", true, false)
  inventory_input.text = "resized inventory"
  inventory_input.emit_signal("text_changed", inventory_input.text)
  await frames()
  check(text(inventory, "inventory-query") == "Input: resized inventory" and text(hud, "hud-query") == "Input: consumer TSX",
    "Native editing after resize reaches only the inventory React root")
  await capture("resized")
  inventory.size = inventory_size
  await frames()
  $Application/Runtime.call("evaluate", "ConsumerGeometry.measure('inventory')")
  await frames()
  check(float(state(inventory).viewport.width) == inventory_size.x and rect_matches(geometry().inventory, inventory.get_global_rect()),
    "Restoring inventory constraints updates layout and the same public ref without remount")
  inventory.call("unmount")
  await frames()
  check(state(inventory).nodes.is_empty() and text(hud, "hud-local") == "Local: 1", "Consumer unmount preserves the other native tree")
  check(services().activePanels == 1 and services().connections == 2 and state(hud).gameServices.subscriptions == 2,
    "Closing one consumer root preserves application-owned game connections")
  check(inventory.call("mount"), "Consumer root mounts again")
  await frames()
  check(text(inventory, "inventory-local") == "Local: 0" and text(inventory, "inventory-shared") == "Shared: 1", "Remount resets local state and preserves the project store")
  check(text(inventory, "inventory-health") == "Game health: 89" and services().panelMounts == 3,
    "Remount observes current GDScript state without installing duplicate game subscriptions")
  check(state(hud).errors.is_empty() and state(inventory).errors.is_empty(), "Consumer lifecycle remains free of native errors")
  $Application/Runtime.call("stop")
  check(state(hud).nativeTags == 0 and state(hud).rootCount == 0 and state(hud).pendingTimers == 0, "Consumer shutdown releases native tags, roots and timers")
  var stopped_services := services()
  check(stopped_services.disposed and stopped_services.activePanels == 0 and stopped_services.listeners == 0 and stopped_services.connections == 0 and stopped_services.serviceCleanups == 1,
    "Final React cleanup removes shared SDK service listeners exactly once")
  check(state(hud).gameServices.stopped and state(hud).gameServices.bindings == 0 and state(hud).gameServices.subscriptions == 0 and state(hud).gameServices.pendingHostTasks == 0 and state(hud).gameServices.pendingEvents == 0 and health_changed.get_connections().is_empty() and damaged.get_connections().is_empty(),
    "SDK shutdown disconnects GDScript sources and clears service queues and bindings")
  var before_late_signal: Array = services().damages
  apply_damage(1, "after-stop")
  await frames()
  check(services().damages == before_late_signal and services().errors.is_empty(), "Stopped consumer handlers cannot receive later game signals")
  var report := {"schemaVersion": 1, "host": "independent-consumer", "displayServer": DisplayServer.get_name(), "checks": checks, "beforeStop": initial, "afterStop": state(hud), "geometry": geometry_observations}
  var output := FileAccess.open("user://consumer-report.json", FileAccess.WRITE)
  output.store_string(JSON.stringify(report, "  ") + "\n")
  var success := checks.all(func(entry: Dictionary) -> bool: return entry.passed)
  print("MACOS_EXPORT_USER_DATA_DIR:" + OS.get_user_data_dir())
  print("CONSUMER_VALIDATION_PASSED" if success else "CONSUMER_VALIDATION_FAILED")
  get_tree().quit(0 if success else 1)
