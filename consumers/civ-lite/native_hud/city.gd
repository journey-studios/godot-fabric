extends PanelContainer

# The city screen: what the city is, what it builds and what it can be told to build. Each item carries the game's own `enabled` and
# `reason_text`; pressing one puts it in the slot the snapshot's items were checked for, the first free one or the last. It is shown in
# an overlay, so it has a Close of its own: the game's `clear_selection`, the same call as Escape. The queue and the items are touched only
# when what they list changes, and then row by row.

signal intent(method: StringName, args: Array)

const Kit := preload("kit.gd")
const Icons := preload("icons.gd")

@onready var _title: Label = get_node("%hud-city-title")
@onready var _rates: Label = get_node("%hud-city-rates")
@onready var _queue_title: Label = get_node("%hud-city-queue-title")
@onready var _queue: VBoxContainer = get_node("%Queue")
@onready var _items: VBoxContainer = get_node("%Items")
@onready var _buildings: Label = get_node("%hud-city-buildings")
@onready var _garrison: Label = get_node("%hud-city-garrison")

var _queue_lines: Array = []
var _item_rows: Array = []
var _slot := 0


func _ready() -> void:
  get_node("%hud-city-close").pressed.connect(func() -> void: intent.emit(&"clear_selection", []))


func render(snapshot: Dictionary, _hover: Dictionary) -> void:
  var city: Dictionary = snapshot.city
  _slot = mini(city.queue.size(), int(city.queue_max) - 1)
  Kit.set_text(_title, "%s · size %d/%d" % [city.name, city.size, city.max_size] if int(city.present) == 1 else "No city yet")
  Kit.set_text(_rates, "Food %d/%d (+%d) · Production +%d · Science +%d" % [snapshot.resources.food.stock, city.food_needed, city.food_rate,
    city.production_rate, city.science_rate])
  Kit.set_text(_queue_title, "Queue %d/%d" % [city.queue.size(), city.queue_max])
  _set_queue(city.queue)
  _set_items(city.items)
  Kit.set_text(_buildings, "Buildings: " + ("none" if city.buildings.is_empty() else ", ".join(city.buildings)))
  Kit.set_text(_garrison, "Garrison: " + ("none" if city.garrison.is_empty() else ", ".join(city.garrison.map(
    func(unit: Dictionary) -> String: return "%s #%d" % [unit.kind, unit.id]))))


func _set_queue(queue: Array) -> void:
  var lines: Array = queue.map(func(entry: Dictionary) -> Array: return [int(entry.slot), "%d. %s %d/%d" % [int(entry.slot) + 1, entry.label, entry.stock, entry.cost]])
  if lines == _queue_lines:
    return
  _queue_lines = lines
  Kit.sync_lines(_queue, "hud-city-queue-", lines)


func _set_items(items: Array) -> void:
  var rows: Array = items.map(func(item: Dictionary) -> Dictionary: return {"key": item.id, "label": "%s (%d)" % [item.label, item.cost],
    "enabled": int(item.enabled) == 1, "reason": "" if int(item.enabled) == 1 else item.reason_text, "icon": Icons.item_icon(item.id)})
  if rows == _item_rows:
    return
  _item_rows = rows
  Kit.sync_choices(_items, "hud-city-item-", rows, _on_item_pressed)


func _on_item_pressed(item_id: String) -> void:
  intent.emit(&"set_production", [item_id, _slot])
