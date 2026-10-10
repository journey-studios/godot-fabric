extends PanelContainer

# The stress panel of the comparison (docs/research/frontier-stress.md), shown in every context while the snapshot carries `stress`: a log of
# 200 lines and a production list of 100 items, each in a ScrollContainer, one Label for each row. A step of the mode appends a line, drops the
# oldest and changes one item, so a step touches one row of each list: each list is kept by key, in place, a row whose text did not change is
# left as it is, and a step is found by comparing the lists with what was shown (not by asking all 300 rows). A log line begins with its
# sequence number, which is its key; an item is keyed by its id.

const Kit := preload("kit.gd")
# The width of the sequence number a log line begins with (services/stress.gd).
const KEY_DIGITS := 5

@onready var _log: VBoxContainer = get_node("%hud-stress-log")
@onready var _production: VBoxContainer = get_node("%hud-stress-production")

var _log_rows := {}
var _production_rows := {}
# What the lists showed last. A step moves the log on by whole lines and changes one item, so what stays is found by comparing the new lists with
# these (two comparisons the engine makes in native code) and not by asking every row.
var _lines: Array = []
var _items: Array = []


func render(snapshot: Dictionary, _hover: Dictionary) -> void:
  var stress: Dictionary = snapshot.stress
  var lines: Array = stress.log
  if lines != _lines:
    _sync_log(lines)
    _lines = lines
  var items: Array = stress.production
  if items != _items:
    _sync_production(items)
    _items = items


# A log that moved on: the oldest lines left the front and newer ones came at the end, and the lines in between are the same ones. Those rows
# are not touched. A row that left is not freed to make another like it: it is given the key and the text of a line that came and goes to the end
# (a Label is the dearest thing a step makes), and only the difference in number is freed or mounted. Any other change (the mode began again,
# a jump in the sequence) is brought to the lines in full.
func _sync_log(lines: Array) -> void:
  var dropped := _lines.find(lines[0]) if not lines.is_empty() else -1
  var kept := _lines.size() - dropped
  if dropped >= 0 and kept <= lines.size() and _lines.slice(dropped) == lines.slice(0, kept):
    var arriving := lines.size() - kept
    var recycled := mini(dropped, arriving)
    for index in range(dropped):
      var gone := String(_lines[index]).substr(0, KEY_DIGITS)
      if index >= recycled:
        _drop(_log, _log_rows, gone)
        continue
      var line: String = lines[kept + index]
      var key := line.substr(0, KEY_DIGITS)
      var label: Label = _log_rows[gone]
      _log_rows.erase(gone)
      label.name = "hud-stress-log-" + key
      Kit.set_text(label, line)
      _log.move_child(label, -1)
      _log_rows[key] = label
    for index in range(kept + recycled, lines.size()):
      var line: String = lines[index]
      var key := line.substr(0, KEY_DIGITS)
      _log_rows[key] = _mount(_log, "hud-stress-log-" + key, line)
    return
  _reconcile(_log, _log_rows, lines.map(func(line: String) -> String: return line.substr(0, KEY_DIGITS)), lines, "hud-stress-log-")


# The same items with some of them changed: set the text of the ones that differ. A different set of items is brought to the list in full.
func _sync_production(items: Array) -> void:
  if items.size() == _items.size():
    for index in range(items.size()):
      var item: Dictionary = items[index]
      var before: Dictionary = _items[index]
      if item == before:
        continue
      if item.id != before.id:
        _reconcile(_production, _production_rows, items.map(_item_key), items.map(_item_text), "hud-stress-production-")
        return
      Kit.set_text(_production_rows[_item_key(item)], _item_text(item))
    return
  _reconcile(_production, _production_rows, items.map(_item_key), items.map(_item_text), "hud-stress-production-")


func _item_key(item: Dictionary) -> String:
  return "%02d" % item.id


func _item_text(item: Dictionary) -> String:
  return "%s %d/%d" % [item.label, item.progress, item.cost]


func _mount(list: VBoxContainer, id: String, text: String) -> Label:
  var label := Kit.line(id, text, &"SmallMutedLabel")
  label.autowrap_mode = TextServer.AUTOWRAP_OFF
  label.clip_text = true
  list.add_child(label)
  return label


func _drop(list: VBoxContainer, rows: Dictionary, key: String) -> void:
  var stale: Label = rows[key]
  list.remove_child(stale)
  stale.queue_free()
  rows.erase(key)


# Brings the rows of `list` to the keys and texts given, in their order: a row whose key is gone is freed, a key that is new makes a row, a row
# that is there has its text set only if it differs, and a row is moved only when it is not where the order puts it.
func _reconcile(list: VBoxContainer, rows: Dictionary, keys: Array, texts: Array, prefix: String) -> void:
  var wanted := {}
  for key: String in keys:
    wanted[key] = true
  for key: String in rows.keys():
    if not wanted.has(key):
      _drop(list, rows, key)
  for index in range(keys.size()):
    var key: String = keys[index]
    var label: Label = rows.get(key)
    if label == null:
      label = _mount(list, prefix + key, texts[index])
      rows[key] = label
    else:
      Kit.set_text(label, texts[index])
    if list.get_child(index) != label:
      list.move_child(label, index)
