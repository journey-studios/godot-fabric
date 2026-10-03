extends Node

# The laboratory keeps SDK sources behind .gdignore; installed addons expose
# the same script as the public global GodotFabric class.
const FabricAPI = preload("res://sdk/addon/godot_fabric.gd")

signal health_changed(value: int)
signal equipment_changed(value: Dictionary)
signal damaged(amount: int, reason: String)
signal operation_finished(job: String, item: String, cancelled: bool)

var health := 100
var equipment := {"item": "none", "count": 0}
var getter_calls := 0
var mutate_during_first_read := true
var bindings: Array = []
var jobs: Dictionary = {}
var next_job := 1
var finished_jobs: Array = []

func _enter_tree() -> void:
  var api = FabricAPI.for_application($Application)
  bindings.append(api.bind_signal("player.damaged", damaged, ["integer", "string"]))
  bindings.append(api.bind_signal("inventory.finished", operation_finished, ["string", "string", "boolean"]))
  bindings.append(api.bind_state("player.health", get_health, health_changed, "integer"))
  bindings.append(api.bind_state("inventory.equipment", get_equipment, equipment_changed,
    {"object": {"item": "string", "count": "integer"}}))
  bindings.append(api.register_method("player.damage", damage, ["integer", "string"], "integer"))
  bindings.append(api.register_method("inventory.equip", request_equip, ["string"],
    {"object": {"job": "string", "item": "string"}}, {"response": "acceptance"}))
  bindings.append(api.register_method("inventory.cancel", cancel_job, ["string"], "boolean"))

func get_health() -> int:
  getter_calls += 1
  var observed := health
  if mutate_during_first_read:
    mutate_during_first_read = false
    damage(5, "during-connect")
  return observed

func get_equipment() -> Dictionary:
  return equipment.duplicate(true)

func damage(amount: int, reason: String) -> int:
  health = maxi(0, health - amount)
  health_changed.emit(health)
  damaged.emit(amount, reason)
  return health

func request_equip(item: String) -> Dictionary:
  var job := "equip-" + str(next_job)
  next_job += 1
  var timer := Timer.new()
  timer.one_shot = true
  timer.wait_time = 0.3
  # This is game time, distinct from UI/Hermes timers. The game owns this job
  # and does not cancel it merely because the inventory surface unmounts.
  timer.process_mode = Node.PROCESS_MODE_PAUSABLE
  add_child(timer)
  jobs[job] = timer
  timer.timeout.connect(_complete_job.bind(job, item))
  timer.start()
  return {"job": job, "item": item}

func _complete_job(job: String, item: String) -> void:
  if not jobs.has(job):
    return
  var timer: Timer = jobs[job]
  jobs.erase(job)
  timer.queue_free()
  equipment = {"item": item, "count": int(equipment.count) + 1}
  equipment_changed.emit(equipment.duplicate(true))
  finished_jobs.append({"job": job, "item": item, "cancelled": false})
  operation_finished.emit(job, item, false)

func cancel_job(job: String) -> bool:
  if not jobs.has(job):
    return false
  var timer: Timer = jobs[job]
  jobs.erase(job)
  timer.stop()
  timer.queue_free()
  finished_jobs.append({"job": job, "item": "", "cancelled": true})
  operation_finished.emit(job, "", true)
  return true
