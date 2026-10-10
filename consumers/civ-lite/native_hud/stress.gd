extends PanelContainer

# The stress panel of the comparison (docs/research/frontier-stress.md), shown in every context while the snapshot carries `stress`: a log of
# 200 lines and a production list of 100 items, each in a ScrollContainer, one Label for each row. A step of the mode appends a line, drops the
# oldest and changes one item, so a step touches one row of each list and moves one: each list is kept by key, in place, and a row whose
# text did not change is left as it is. A log line begins with its sequence number, which is its key; an item is keyed by its id.

const Kit := preload("kit.gd")
# The width of the sequence number a log line begins with (services/stress.gd).
const KEY_DIGITS := 5

@onready var _log: VBoxContainer = get_node("%hud-stress-log")
@onready var _production: VBoxContainer = get_node("%hud-stress-production")

var _log_rows := {}
var _production_rows := {}


func render(snapshot: Dictionary, _hover: Dictionary) -> void:
  var stress: Dictionary = snapshot.stress
  var lines: Array = stress.log
  _reconcile(_log, _log_rows, lines.map(func(line: String) -> String: return line.substr(0, KEY_DIGITS)), lines, "hud-stress-log-")
  var items: Array = stress.production
  _reconcile(_production, _production_rows, items.map(func(item: Dictionary) -> String: return "%02d" % item.id),
    items.map(func(item: Dictionary) -> String: return "%s %d/%d" % [item.label, item.progress, item.cost]), "hud-stress-production-")


# Brings the rows of `list` to the keys and texts given, in their order: a row whose key is gone is freed, a key that is new makes a row, a row
# that is there has its text set only if it differs, and a row is moved only when it is not where the order puts it.
func _reconcile(list: VBoxContainer, rows: Dictionary, keys: Array, texts: Array, prefix: String) -> void:
  var wanted := {}
  for key: String in keys:
    wanted[key] = true
  for key: String in rows.keys():
    if not wanted.has(key):
      var stale: Label = rows[key]
      list.remove_child(stale)
      stale.queue_free()
      rows.erase(key)
  for index in range(keys.size()):
    var key: String = keys[index]
    var label: Label = rows.get(key)
    if label == null:
      label = Kit.line(prefix + key, texts[index], &"SmallMutedLabel")
      label.autowrap_mode = TextServer.AUTOWRAP_OFF
      label.clip_text = true
      list.add_child(label)
      rows[key] = label
    else:
      Kit.set_text(label, texts[index])
    if list.get_child(index) != label:
      list.move_child(label, index)
