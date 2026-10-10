extends RefCounted

# The comparison's stress mode (docs/research/frontier-stress.md): a log of 200 lines and a production list of 100 items that the
# snapshot carries only while the mode is on. It is an overlay the GameServices node owns, outside the game: nothing here is in the
# game's state, its hash, the normal log (LOG_MAX 32) or the replay, and leaving the mode leaves the snapshot as it was before
# entering it. What it holds is deterministic: the same steps give the same lines and counters.
#
# A line begins with its sequence number, five digits, which is its key (a step appends the next number and drops the oldest line,
# so the other 199 keep their keys); an item is keyed by its id and a step raises the progress of item `steps % 100` by one.

const LOG_LINES := 200
const ITEMS := 100
# The width of the sequence number a line begins with: the key a HUD names the row by.
const KEY_DIGITS := 5

var lines: Array = []
var production: Array = []
var steps := 0
var next_line := 1


func _init() -> void:
  for _index in range(LOG_LINES):
    lines.append(_line(next_line))
    next_line += 1
  for id in range(ITEMS):
    production.append({"id": id, "label": "Item %02d" % id, "progress": 0, "cost": 100 + id})


# One update: a line appended with the oldest dropped, and one item changed.
func step() -> void:
  lines.pop_front()
  lines.append(_line(next_line))
  next_line += 1
  var item: Dictionary = production[steps % ITEMS]
  item.progress = int(item.progress) + 1
  steps += 1


# The DTO the snapshot carries: copies, so that a snapshot already published never changes.
func dto() -> Dictionary:
  return {"log": lines.duplicate(), "production": production.map(func(item: Dictionary) -> Dictionary: return item.duplicate())}


static func _line(number: int) -> String:
  return "%0*d · the watch counts %d bags of grain at gate %d" % [KEY_DIGITS, number, (number * 7919) % 997, number % 12]
