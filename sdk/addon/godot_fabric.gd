class_name GodotFabric
extends RefCounted

## Experimental game-service facade. Each scope keeps only a weak reference to
## its application; game rules and state remain on the registered Godot owner.
class Scope extends RefCounted:
  var application: WeakRef

  func _init(owner: Node) -> void:
    application = weakref(owner)

  func _owner() -> Node:
    var owner: Variant = application.get_ref()
    if not is_instance_valid(owner):
      push_error("GODOT_FABRIC_SERVICE_ERROR: E_APPLICATION_GONE")
      return null
    return owner

  func bind_signal(name: String, source: Signal, argument_schema: Array, options: Dictionary = {}) -> Object:
    var owner := _owner()
    return owner.call("bind_signal", name, source, argument_schema, options) if owner else null

  func bind_state(name: String, getter: Callable, changed: Signal, value_schema: Variant, options: Dictionary = {}) -> Object:
    var owner := _owner()
    return owner.call("bind_state", name, getter, changed, value_schema, options) if owner else null

  func register_method(name: String, method: Callable, argument_schema: Array, result_schema: Variant, options: Dictionary = {}) -> Object:
    var owner := _owner()
    return owner.call("register_method", name, method, argument_schema, result_schema, options) if owner else null

static var _default_scope: Scope

static func for_application(application: Node) -> Scope:
  if not is_instance_valid(application) or not application.has_method("bind_signal"):
    push_error("GODOT_FABRIC_SERVICE_ERROR: E_APPLICATION: expected a FabricApplication")
    return null
  return Scope.new(application)

static func set_application(application: Node) -> void:
  _default_scope = for_application(application)

static func _scope() -> Scope:
  if _default_scope == null:
    push_error("GODOT_FABRIC_SERVICE_ERROR: E_APPLICATION: configure an application first")
  return _default_scope

static func bind_signal(name: String, source: Signal, argument_schema: Array, options: Dictionary = {}) -> Object:
  var scope := _scope()
  return scope.bind_signal(name, source, argument_schema, options) if scope else null

static func bind_state(name: String, getter: Callable, changed: Signal, value_schema: Variant, options: Dictionary = {}) -> Object:
  var scope := _scope()
  return scope.bind_state(name, getter, changed, value_schema, options) if scope else null

static func register_method(name: String, method: Callable, argument_schema: Array, result_schema: Variant, options: Dictionary = {}) -> Object:
  var scope := _scope()
  return scope.register_method(name, method, argument_schema, result_schema, options) if scope else null
