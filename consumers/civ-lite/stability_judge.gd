extends "res://hud_probe.gd"

# What the stability probe says of itself (stability_validation.gd, which extends this): the checks it makes of what it observed, with the
# helpers they share. The independent judgement of the same observations is tests/civ-lite-stability-oracle.mjs.

const CYCLES := 20
# The choice of each of the three events that the probe presses.
const PICKS := [0, 1, 1]
const BURST_CYCLES := [1, 20]
# The groups of numbers a leak would grow, by the name each has in a measure. `objects` is not in them: the engine's object count holds
# the 300 input events a burst pushed until the next frames free them, and it has a jitter of one object; it is judged apart, on the
# rests after a close, by the median rule of the heap.
const FIELDS := {
  "tree": ["nodes", "orphans", "windows"],
  "views": ["nativeViews", "nativeTags", "surfaceNodes", "liveRoots", "retiringTags", "modalNodes", "modalMembers"],
  "pointers": ["pointerStored", "pointerSuppressed", "pointerContacts", "pointerActive", "pointerHover", "processorActive", "processorPendingCapture",
    "processorActiveCapture", "processorHover"],
  "services": ["bindings", "subscriptions", "pendingHostTasks", "pendingEvents", "hudSubscriptions", "connections", "hoverConnections", "worlds"],
  "work": ["pendingWork", "pendingTimers", "pendingAnimationFrames"],
}

var shots: Dictionary = {}
var masks: Dictionary = {}


# --- Judging ---------------------------------------------------------------------------------------------------------

# What moved, in the groups, from the first of the rows.
func drift(rows: Array, groups: Array) -> Array:
  var moved: Array = []
  for index in range(1, rows.size()):
    for group: String in groups:
      for field: String in FIELDS[group]:
        if rows[index][field] != rows[0][field]:
          moved.append("%s of row %d is %s, the first one's is %s" % [field, index + 1, rows[index][field], rows[0][field]])
  if not moved.is_empty():
    print("STABILITY_DRIFT: ", moved.slice(0, 6))
  return moved


func series(rows: Array, phase: String) -> Array:
  return rows.map(func(row: Dictionary) -> Dictionary: return row[phase])


# The median by nearest rank.
func median(values: Array) -> int:
  var sorted := values.duplicate()
  sorted.sort()
  return int(sorted[maxi(ceili(sorted.size() * 0.5) - 1, 0)])


# The rule of the performance baseline for the heap at rest, for a number of the rows: leave the first two rounds out, and the median of
# the last half may not be more than `limit` over the median of the first half. The Hermes heap's limit is 2,048 bytes; the engine's
# object count, which has a jitter of one, has 1.
func flat(rows: Array, field: String, limit: int) -> bool:
  var values: Array = rows.map(func(row: Dictionary) -> int: return row[field])
  var steady := values.slice(2)
  var half := int(steady.size() / 2)
  if half < 1 or not values.all(func(value: int) -> bool: return value > 0):
    return false
  var growth := median(steady.slice(steady.size() - half)) - median(steady.slice(0, half))
  if growth > limit:
    print("STABILITY_FLAT: %s rose %d" % [field, growth])
  return growth <= limit


func focus_kept(row: Dictionary) -> bool:
  return row.after.focus.root == row.before.focus.root


func is_modal_entry(entry: Dictionary) -> bool:
  return entry.modal


# While an overlay is open its Window is the one exclusive Modal Window, and nothing under it has the focus.
func focus_under(row: Dictionary) -> bool:
  var focus: Dictionary = row.open.focus
  var exclusive: Array = focus.modals.filter(func(window: Dictionary) -> bool: return window.exclusive and window.visible)
  return exclusive.size() == 1 and focus.modals.size() == 1 and focus.root == 0 and focus.focused.all(is_modal_entry)


func has_bursts(row: Dictionary) -> bool:
  return row.has("blocking")


func burst_silent(row: Dictionary) -> bool:
  return row.blocking.all(silent)


func blocked(rounds: Array) -> bool:
  var rows: Array = rounds.filter(has_bursts)
  return rows.size() == BURST_CYCLES.size() and rows.all(burst_silent)


func city_done(row: Dictionary) -> bool:
  return row.opened and row.pressed and row.closed


func city_round_clean(row: Dictionary) -> bool:
  return (row.after.nativeViews == row.before.nativeViews and row.after.nodes == row.before.nodes and row.after.windows == row.before.windows
    and row.after.creates - row.before.creates == row.after.deletes - row.before.deletes)


func city_open_counts(row: Dictionary) -> bool:
  return row.open.windows == row.before.windows + 1 and row.open.modalNodes == 1


func at_rest_closed(row: Dictionary, base: Dictionary) -> bool:
  return row.rested and row.windows == base.windows and row.modalNodes == 0 and row.modalMembers == base.modalMembers and row.retiringTags == 0 and row.errors == 0


func at_rest_open(row: Dictionary, base: Dictionary) -> bool:
  return row.rested and row.windows == base.windows + 1 and row.modalNodes == 1 and row.modalMembers == base.modalMembers and row.errors == 0


func judge_city(city: Dictionary, base: Dictionary) -> void:
  var rounds: Array = city.rounds
  var closes := rounds.filter(func(row: Dictionary) -> bool: return row.how == "close")
  var escapes := rounds.filter(func(row: Dictionary) -> bool: return row.how == "escape")
  check(rounds.size() == 2 * CYCLES and rounds.all(city_done),
    "City: the screen was opened by a real click on its tile and closed by a real press on Close, and by Escape, in every cycle")
  check(rounds.all(func(row: Dictionary) -> bool: return row.clearCalls == 1), "City: Close and Escape each asked the game once to clear the selection, in every cycle")
  for rows: Array in [closes, escapes]:
    var which: String = rows[0].how
    for phase in ["after", "open"]:
      var group := series(rows, phase)
      check(drift(group, ["tree"]).is_empty(), "City (%s, %s): the nodes, the orphans and the Windows are the first cycle's" % [which, phase])
      check(drift(group, ["views", "work"]).is_empty(), "City (%s, %s): the native views, the Modal members and the pending work are the first cycle's" % [which, phase])
      check(drift(group, ["pointers", "services"]).is_empty(),
        "City (%s, %s): the pointer routes, the registry's subscriptions and pending work, the HUD's connections and the signal's are the first cycle's" % [which, phase])
    check(flat(series(rows, "after"), "objects", 1), "City (%s): the engine's objects at rest after a close are flat across the cycles, by the baseline's rule" % which)
    check(flat(series(rows, "after"), "heap", 2048), "City (%s): the Hermes heap at rest is flat across the cycles, by the baseline's rule" % which)
  check(series(rounds, "after").all(at_rest_closed.bind(base)),
    "City: after every close the screen is at rest with the Windows the game had before, no Modal, the same Modal members, no retiring tag and no error")
  check(rounds.all(city_round_clean), "City: after a close the HUD is what it was before the open, and what the cycle created it deleted")
  check(rounds.all(city_open_counts), "City: the open screen is one Window and one Modal member more")
  check(rounds.all(focus_kept), "City: the root viewport's focus owner after every close is the one before the open")
  check(rounds.all(focus_under), "City: while the screen is open its Window is the one exclusive Modal Window and no Control under it has the focus")
  check(blocked(rounds), "City: with the screen open in the first and the last cycle, 100 left clicks, 100 right clicks and 100 wheel ticks on the map reach the World 0 times")


func answered(answer: Dictionary) -> bool:
  return answer.pressed and answer.moved and answer.resolveCalls == 1


func dialog_done(row: Dictionary) -> bool:
  return row.opened and row.answers.size() == PICKS.size() and row.answers.all(answered)


func escape_idle(row: Dictionary) -> bool:
  var escape: Dictionary = row.escape
  return escape.heard == 1 and escape.sameHead and escape.unchanged and escape.stillOpen and escape.windows == 0 and escape.context == "dialog"


func dialog_focus_row(row: Dictionary) -> Dictionary:
  return {"before": row.before, "after": row.answers[PICKS.size() - 1].after, "open": row.open}


func judge_dialog(dialog: Dictionary, base: Dictionary) -> void:
  var cycles: Array = dialog.cycles
  check(cycles.all(dialog_done), "Dialog: in every cycle the events were raised at turn 5 and the three were answered by real presses, each answering the head once")
  check(cycles.all(escape_idle), "Dialog: Escape on the open dialog reached its Window and did nothing: the same event, no call, no state change, the Modal open")
  var rests: Array = [["open", series(cycles, "open")]]
  for index in range(PICKS.size()):
    rests.append(["answer %d" % (index + 1), cycles.map(func(row: Dictionary) -> Dictionary: return row.answers[index].after)])
  for rest: Array in rests:
    check(drift(rest[1], ["tree", "views", "work", "pointers", "services"]).is_empty(),
      "Dialog (%s): the tree, the native views, the pending work, the pointer routes and the connections are the first cycle's" % rest[0])
  var closed: Array = rests[PICKS.size()][1]
  check(flat(closed, "objects", 1), "Dialog: the engine's objects at rest after the last answer are flat across the cycles, by the baseline's rule")
  check(flat(closed, "heap", 2048), "Dialog: the Hermes heap at rest after the last answer is flat across the cycles, by the baseline's rule")
  check(closed.all(at_rest_closed.bind(base)) and closed.all(func(row: Dictionary) -> bool: return row.context == "none"),
    "Dialog: after the third answer every cycle is at rest with the Windows the game had before, no Modal, the same Modal members, no retiring tag and no error")
  var held: Array = rests[0][1] + rests[1][1] + rests[2][1]
  check(held.all(at_rest_open.bind(base)), "Dialog: from the first event to the third answer the Modal is one Window, one presented Modal, and is not remounted")
  var focus_rows := cycles.map(dialog_focus_row)
  check(focus_rows.all(focus_kept), "Dialog: the root viewport's focus owner after the last answer is the one before the events were raised")
  check(focus_rows.all(focus_under), "Dialog: while the dialog is open its Window is the one exclusive Modal Window and no Control under it has the focus")
  check(blocked(cycles), "Dialog: with the dialog open in the first and the last cycle, 100 left clicks, 100 right clicks and 100 wheel ticks on the map reach the World 0 times")


# A headed run: the screen of the last cycle is the first cycle's, pixel for pixel, but for the first row of the bar (the dialog's game has its
# own epoch, and its digits move the row).
func judge_shots() -> void:
  var same := true
  var differ: Array = []
  var rects: Dictionary = {}
  for screen: String in ["city", "dialog"]:
    var first: Image = shots.get(screen + "-1")
    var last: Image = shots.get(screen + "-20")
    if first == null or last == null:
      same = false
      continue
    var a: Array = masks[screen + "-1"]
    var b: Array = masks[screen + "-20"]
    var left := minf(a[0], b[0]) - 2.0
    var top := minf(a[1], b[1]) - 2.0
    var mask := Rect2i(int(left), int(top), int(maxf(a[0] + a[2], b[0] + b[2]) + 2.0 - left), int(maxf(a[1] + a[3], b[1] + b[3]) + 2.0 - top))
    rects[screen] = [mask.position.x, mask.position.y, mask.size.x, mask.size.y]
    first.fill_rect(mask, Color.BLACK)
    last.fill_rect(mask, Color.BLACK)
    if first.get_data() != last.get_data():
      same = false
      differ.append(screen)
  report["drift"] = {"same": same, "differ": differ, "masked": rects}
  check(same, "Capture saved: the city screen and the dialog in the last cycle are the first cycle's pixels, the bar's first row apart")
