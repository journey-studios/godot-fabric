extends Node

# The execution runner's `stats()` for the React Native HUD (arm C), in the shape the native HUD's has (docs/research/frontier-stress.md):
#
#   stats() -> {snapshots: int, context: String, events: int}
#
# It costs no JavaScript and no Surface snapshot: the registry counts, natively, the events it hands to the JavaScript runtime for each service
# (`service_delivery`, a read of counters), and the node remembers the context of each snapshot it published by the registry's revision number.
#   snapshots  the snapshot events the registry handed to the HUD's subscription since boot
#   context    the context of the last snapshot revision the registry delivered to it
#   events     snapshot and hover events handed to its subscriptions, and the ends of turn the registry ingested (the HUD has no listener of
#              `frontier.turn_ended`, so for it the end of a turn is consumed when it is emitted)
# "Handed to the JavaScript runtime" is as far as the host counts: the store's listeners run in the same process step, when Hermes drains its queue.

const SNAPSHOT := "frontier.snapshot"
const HOVER := "frontier.hover"
const TURN_ENDED := "frontier.turn_ended"

var _services: Node
var _runtime: Node


func _ready() -> void:
  _services = get_parent()
  _runtime = _services.get_node("Application/Runtime")


func stats() -> Dictionary:
  var snapshot: Dictionary = _runtime.service_delivery(SNAPSHOT)
  var hover: Dictionary = _runtime.service_delivery(HOVER)
  var ended: Dictionary = _runtime.service_delivery(TURN_ENDED)
  return {"snapshots": int(snapshot.sent), "context": _services.context_at(int(snapshot.delivered)), "events": int(snapshot.sent) + int(hover.sent) + int(ended.emitted)}
