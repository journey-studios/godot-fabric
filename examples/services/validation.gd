extends Node

var checks: Array = []
var observations: Dictionary = {}
var application: Node
var hud: Control
var inventory: Control
var game: Node

func check(condition: bool, message: String) -> void:
  checks.append({"name": message, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + message)

func frames(count: int = 8) -> void:
  for index in range(count):
    await get_tree().process_frame

func native(node: Node) -> Dictionary:
  var value: Variant = JSON.parse_string(node.call("snapshot"))
  return value if value is Dictionary else {}

func stats() -> Dictionary:
  var value: Variant = JSON.parse_string(application.call("evaluate", "JSON.stringify(GodotServices.stats())"))
  return value if value is Dictionary else {}

func wait_for(expression: String) -> bool:
  var deadline := Time.get_ticks_msec() + 5000
  while Time.get_ticks_msec() < deadline:
    if application.call("evaluate", "Boolean(" + expression + ")") == "true":
      await frames(2)
      return true
    await frames(1)
  return false

func text(surface: Control, id: String) -> String:
  for node in native(surface).get("nodes", []):
    if node.get("testID", "") == id:
      return node.get("nativeText", "")
  return ""

func damage_events_equal(actual: Array, expected: Array) -> bool:
  if actual.size() != expected.size():
    return false
  for index in range(actual.size()):
    if not actual[index] is Dictionary or actual[index].size() != 2:
      return false
    # Godot's JSON parser represents JS numbers as floats. Dictionary equality
    # distinguishes int/float Variants even when their numeric values match.
    if actual[index].get("amount") != float(expected[index].amount) or actual[index].get("reason") != expected[index].reason:
      return false
  return true

func capture(stage: String) -> void:
  if not OS.get_cmdline_user_args().has("--capture"):
    return
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  check(image.save_png("res://build/services-" + stage + ".png") == OK,
    "Native services capture saved: " + stage)

func _ready() -> void:
  game = get_parent()
  application = game.get_node("Application")
  hud = game.get_node("HUD")
  inventory = game.get_node("Inventory")
  get_window().size = Vector2i(1020, 650)
  if OS.get_cmdline_user_args().has("--validate"):
    call_deferred("run_checks")

func run_checks() -> void:
  if not check_ready(await wait_for("globalThis.GodotServices && GodotServices.stats().ready === 4 && GodotServices.stats().hudMounts === 1 && GodotServices.stats().inventoryMounts === 1")):
    application.call("stop")
    finish()
    return
  var first := stats()
  observations.initial = first
  check(native(application).get("rootCount", 0) == 2 and native(application).get("bundleEvaluations", 0) == 1,
    "HUD and inventory share one application and one bundle evaluation")
  check(native(hud).get("surfaceId", 0) != native(inventory).get("surfaceId", 0),
    "Game UI roots preserve separate native identities")
  check(game.get("bindings").size() == 7 and game.get("bindings").all(func(binding: Variant) -> bool: return binding != null),
    "GDScript registers typed methods, signals and state without game C++")
  check(first.get("health") == 95 and first.get("healthRevision", -1) == 1 and game.get("getter_calls") >= 2,
    "Coordinated connection retries a getter changed during its initial read")
  check(damage_events_equal(first.get("damages", []), [{"amount": 5, "reason": "during-connect"}]),
    "A happening emitted during state connection reaches an already-installed subscription")
  check(text(hud, "services-health") == "Health: 95" and first.get("equipment", {}).get("item", "") == "none",
    "Original Fabric paints the current native snapshot in the HUD")
  check(first.get("errors", []).is_empty() and native(application).get("errors", []).is_empty(),
    "Initial service connection has no hidden transport errors")
  await capture("initial")

  game.call("damage", 3, "first")
  game.call("damage", 4, "second")
  check(await wait_for("GodotServices.stats().health === 88 && GodotServices.stats().damages.length === 3"),
    "Consecutive Godot changes update the shared Zustand representation")
  var changed := stats()
  check(damage_events_equal(changed.damages.slice(1), [{"amount": 3, "reason": "first"}, {"amount": 4, "reason": "second"}]),
    "Multiple signal arguments and consecutive happenings retain order without coalescing")
  check(changed.healthRevision == 3 and text(hud, "services-health") == "Health: 88",
    "State revisions and actual native text agree after consecutive updates")

  application.call("evaluate", "GodotServices.invoke('player.damage',[2,'typed call'])")
  check(await wait_for("GodotServices.stats().operations.length === 1 && GodotServices.stats().health === 86"),
    "JavaScript invokes a real GDScript operation through the host work queue")
  var response: Dictionary = stats().operations[0]
  check(response.get("response", "") == "completion" and response.get("value") == 86,
    "A completion response reports the GDScript result rather than mere queue acceptance")
  application.call("evaluate", "GodotServices.invoke('player.damage',[2.5,'invalid integer']); GodotServices.invoke('missing.method',[])")
  check(await wait_for("GodotServices.stats().errors.length === 2"),
    "Invalid typed arguments and missing methods produce distinguishable rejected calls")
  var rejected := stats()
  check(rejected.health == 86 and rejected.operations.size() == 1 and rejected.errors[0].code != rejected.errors[1].code,
    "Rejected calls neither mutate game state nor disguise errors as successful results")

  application.call("evaluate", "GodotServices.setInventoryLocal(7)")
  await frames()
  check(text(inventory, "services-inventory-local") == "Inventory local state: 7",
    "Inventory local React state is independent of the shared game representation")
  var inventory_id: int = native(inventory).get("surfaceId", 0)
  inventory.hide()
  await frames(2)
  check(not inventory.visible and native(inventory).get("surfaceId", 0) == inventory_id and stats().inventoryCleanups == 0 and text(inventory, "services-inventory-local") == "Inventory local state: 7",
    "Hiding a surface preserves its native identity, connections and local React state")
  inventory.show()
  application.call("evaluate", "GodotServices.invoke('inventory.equip',['bronze-blade'])")
  check(await wait_for("GodotServices.stats().operations.length === 2"),
    "Inventory operation returns its declared acceptance before the game job completes")
  var accepted: Dictionary = stats().operations[1]
  check(accepted.get("response", "") == "acceptance" and accepted.get("value", {}).get("job", "").begins_with("equip-") and game.get("jobs").size() == 1,
    "The game owns an accepted operation and exposes its job identity")
  get_tree().paused = true
  application.call("evaluate", "GodotServices.scheduleUITick()")
  await get_tree().create_timer(0.4, true, false, true).timeout
  check(stats().uiTicks == 1 and game.get("jobs").size() == 1 and stats().finished.is_empty(),
    "UI time advances while the pausable game clock retains its accepted job")
  check(native(application).get("rootCount", 0) == 2 and native(inventory).get("surfaceId", 0) == inventory_id,
    "Scene pause preserves the application and both mounted React roots")
  get_tree().paused = false
  var hud_id: int = native(hud).get("surfaceId", 0)
  inventory.call("unmount")
  await frames(2)
  check(native(application).get("rootCount", -1) == 1 and native(hud).get("surfaceId", 0) == hud_id and stats().inventoryCleanups == 1,
    "Closing inventory preserves the HUD, global subscriptions and accepted game operation")
  check(await wait_for("GodotServices.stats().equipment.item === 'bronze-blade' && GodotServices.stats().finished.length === 1"),
    "The accepted job finishes after inventory unmount and updates the surviving HUD")
  check(text(hud, "services-equipment") == "Equipped: bronze-blade" and game.get("jobs").is_empty(),
    "Actual native HUD text reflects the game job completion")
  var retired := native(inventory)
  check(retired.get("nodes", []).is_empty() and retired.get("nativeTags", -1) == 0 and retired.get("creates", -1) == retired.get("deletes", -2),
    "Operation completion retains no old inventory Controls or tags")
  await capture("completed")
  inventory.call("mount")
  check(await wait_for("GodotServices.stats().inventoryMounts === 2"),
    "Inventory remount observes the application-owned game representation")
  check(text(inventory, "services-inventory-equipment") == "Equipped: bronze-blade" and text(inventory, "services-inventory-local") == "Inventory local state: 0",
    "Remount restores current equipment and resets only local React state")

  application.call("evaluate", "GodotServices.invoke('inventory.equip',['cancelled-item'])")
  check(await wait_for("GodotServices.stats().operations.length === 3"),
    "A second accepted operation exposes an explicit cancellation target")
  var job: String = stats().operations[2].value.job
  application.call("evaluate", "GodotServices.invoke('inventory.cancel', [" + JSON.stringify(job) + "])")
  check(await wait_for("GodotServices.stats().operations.length === 4 && GodotServices.stats().finished.length === 2"),
    "Declared game cancellation completes through a typed method and signal")
  check(stats().finished[1].cancelled and stats().equipment.item == "bronze-blade" and game.get("jobs").is_empty(),
    "Cancellation does not equip the cancelled item or retain its timer")
  observations.beforeStop = stats()
  await capture("remounted")
  application.call("evaluate", "GodotServices.dispose(); GodotServices.dispose()")
  await frames()
  application.call("stop")
  await frames()
  var stopped := native(application)
  observations.afterStop = stopped
  check(stopped.get("stopped", false) and stopped.get("rootCount", -1) == 0,
    "Application stop releases both game UI roots")
  check(stopped.get("pendingTimers", -1) == 0 and stopped.get("pendingAnimationFrames", -1) == 0 and stopped.get("pendingWork", -1) == 0,
    "Game-service shutdown leaves no runtime scheduling resources")
  check(game.health_changed.get_connections().is_empty() and game.equipment_changed.get_connections().is_empty() and game.damaged.get_connections().is_empty() and game.operation_finished.get_connections().is_empty(),
    "Application stop disconnects every Godot source binding")
  check(stopped.get("errors", []).is_empty(), "Service shutdown preserves visible failure accounting")
  var services: Dictionary = stopped.get("gameServices", {})
  check(services.get("stopped", false) and services.get("bindings", -1) == 0 and services.get("subscriptions", -1) == 0 and services.get("pendingHostTasks", -1) == 0 and services.get("pendingEvents", -1) == 0,
    "Finalized service registry retains no bindings, subscribers, tasks or deliveries")
  application.call("stop")
  check(native(application) == stopped, "Repeated application stop preserves finalized service lifetime")
  finish()

func check_ready(condition: bool) -> bool:
  check(condition, "Public GodotFabric connections initialize before bounded validation")
  return condition

func finish() -> void:
  var report := {"scenario": "services", "engine": "hermes", "renderer": "fabric", "godot": Engine.get_version_info().string,
    "reactNative": "0.87.1", "zustand": "5.0.15", "displayServer": DisplayServer.get_name(), "checks": checks, "observations": observations}
  var output := FileAccess.open("res://build/report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_CHECK_FAILED: Cannot publish services report")
    get_tree().quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  print("SERVICES_FAILED" if failed else "FABRIC_VALIDATION_PASSED: services " + str(checks.size()))
  get_tree().quit(1 if failed else 0)
