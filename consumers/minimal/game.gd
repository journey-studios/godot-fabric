extends Node

# This is ordinary project GDScript. The SDK owns the native transport; this
# game owns its state, signal semantics and method implementation.
signal health_changed(value: int)
signal damaged(amount: int, reason: String)

var health := 100
var getter_calls := 0
var method_calls := 0
var first_read := true
var service_bindings: Array = []

func _enter_tree() -> void:
  $Application.runtime_available.connect(_bind_services)

func _bind_services(runtime: Node) -> void:
  var services := GodotFabric.for_application(runtime)
  service_bindings.append(services.bind_signal("consumer.damaged", damaged, ["integer", "string"]))
  service_bindings.append(services.bind_state("consumer.health", get_health, health_changed, "integer"))
  service_bindings.append(services.register_method("consumer.damage", damage, ["integer", "string"], "integer"))

func get_health() -> int:
  getter_calls += 1
  var observed := health
  if first_read:
    first_read = false
    # A stale first sample must be retried. The happening remains observable
    # by the subscription installed before this coordinated state read.
    apply_damage(5, "during-connect")
  return observed

func damage(amount: int, reason: String) -> int:
  method_calls += 1
  return apply_damage(amount, reason)

func apply_damage(amount: int, reason: String) -> int:
  health = maxi(0, health - amount)
  health_changed.emit(health)
  damaged.emit(amount, reason)
  return health

func _exit_tree() -> void:
  for binding in service_bindings:
    if is_instance_valid(binding):
      binding.remove()
  service_bindings.clear()
