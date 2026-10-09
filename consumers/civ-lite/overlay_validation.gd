extends "res://hud_probe.gd"

# The overlay probe, run with `-- --validate-overlays` (tests/civ-lite-ui-native.test.mjs does, after the HUD probe): the city screen
# and the event dialog are blocking Modals, and the game holds a queue of three events. It writes raw observations, which
# tests/civ-lite-overlay-oracle.mjs judges again on its own, from its own table of the three events. The helpers it shares with the HUD
# probe are in hud_probe.gd.
#
#   queue      the replay played to the turn that raises the events, then the dialog answered by real presses: for each of the three
#              heads, what the game says (the snapshot's dialog), what the HUD shows (its position "n of 3", title, text and
#              choices, in the Modal's window), that every other intent is refused with the state untouched, and what the press did.
#              Every frame of each change of head is observed, so that another event cannot flash in between.
#   remount    with the second event at the head the HUD's Surface is unmounted and mounted again: the first thing it shows is the
#              second event, "2 of 3"; the queue goes on to the third. The city screen is remounted the same way.
#   blocking   with each overlay open, 100 real left clicks, 100 right clicks and 100 wheel ticks on the map reach the World 0 times
#              and the overlay's Pressables work; with it closed they reach the World again.
#   new game   the new session of a game dropped with events waiting has no queue until its own turn 5.
#
#   --capture    saves the city overlay and the dialog at 1 of 3, at 2 of 3 after the remount and at 3 of 3 (a headed run)

# The end_turn of the replay that raises the events (the dialog's covering step is the next one), and the step that founds the city.
const EVENT_STEP := 44
const CITY_STEP := 18
# The choice of each event that the probe presses: welcome (it draws from the PRNG), buy_tools and send_on.
const PICKS := [0, 1, 1]
const CLICKS := 100
# The three events of the queue in the order the game raises them, and for each round a choice that belongs to another event: the probe's
# own copy, so that it runs against a game that has no queue too (the control). EVENT_TURN is the turn that raises them.
const EVENT_IDS := ["wanderers", "traders", "scholar"]
const FOREIGN := ["buy_grain", "host", "welcome"]
const EVENT_TURN := 5
# What the game must refuse, with the same words, while an event waits.
const WAITING_CALLS := [["select_tile", [7, 8]], ["select_unit", [1]], ["clear_selection", []], ["move_unit", [2, 8, 8]], ["found_city", [1]],
  ["fortify", [2]], ["set_production", ["warrior", 0]], ["set_research", ["bronze_working"]], ["end_turn", []]]

var recording := false
var samples: Array = []


func flag() -> String:
  return "--validate-overlays"


func report_path() -> String:
  return "res://civ-lite-overlay-report.json"


func marker() -> String:
  return "CIVLITE_OVERLAYS"


func _process(_delta: float) -> void:
  if recording:
    samples.append(dialog_view(observe()))


func run_probe() -> void:
  await run_queue()
  await run_remount()
  await run_blocking()
  await run_new_game()
  # The run ends with no overlay open: the engine logs an error when the application quits with a Modal's window still mounted
  # (`remove_child` on a root that is already being freed), which is the host's and not what this probe measures.
  services.new_game()
  await settle()


# --- Reading and driving ---------------------------------------------------------------------------------------------

# A fresh game played through the services up to the step, waiting for the jobs of the end turns, and the HUD caught up.
func play_to(step: int) -> void:
  services.new_game()
  await settle()
  for index in range(step + 1):
    var move: Dictionary = Replay.STEPS[index]
    var result: Dictionary = services.callv(move.intent, move.args)
    if move.intent == "end_turn" and int(result.ok) == 1:
      await wait_until(func() -> bool: return int(services.job) == 0)
  await settle()


# What the HUD shows of the dialog: its position, title, text and choices in the order they are drawn, whether it is in a Modal's
# window, and the instance of its Control (a new subtree is a new instance).
func dialog_view(seen: Dictionary) -> Dictionary:
  var panel := find_node(seen, "hud-dialog")
  var choices: Array = []
  for entry: Dictionary in seen.nodes:
    var id: String = entry.testID
    if id.begins_with("hud-dialog-choice-") and not id.ends_with("-label") and not id.ends_with("-detail"):
      choices.append({"id": id.trim_prefix("hud-dialog-choice-"), "label": text_of(seen, id + "-label"), "detail": text_of(seen, id + "-detail"),
        "disabled": entry.disabled, "y": entry.rect[1]})
  choices.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a.y < b.y)
  return {"shown": not panel.is_empty() and panel.visible, "modal": bool(panel.get("modal", false)), "instance": int(panel.get("instance", 0)),
    "position": text_of(seen, "hud-dialog-position"), "title": text_of(seen, "hud-dialog-title"), "text": text_of(seen, "hud-dialog-text"),
    "choices": choices.map(func(choice: Dictionary) -> Dictionary: return {"id": choice.id, "label": choice.label, "detail": choice.detail, "disabled": choice.disabled})}


func app_errors() -> Array:
  var state: Variant = JSON.parse_string(application.call("snapshot"))
  return state.get("errors", []) if state is Dictionary else ["no snapshot"]


func queue_state() -> Dictionary:
  var events: Dictionary = services.game.state.get("events", {})
  return {"queue": events.get("queue", []).duplicate(), "resolved": events.get("resolved", []).duplicate(true)}


func total_calls() -> int:
  return int(services.callbacks.values().reduce(func(total: int, count: int) -> int: return total + count, 0))


# Real pointer events of one kind over the map, `count` of them on tiles that cycle through it, all pushed before a frame passes: the
# World hears them in `_unhandled_input` or does not, and nothing in the HUD needs a frame to decide that.
func burst(kind: String, count: int) -> Dictionary:
  var before := heard_now()
  var selects_before := int(services.callbacks.get("select_tile", 0))
  var selection_before: Dictionary = game_snapshot().selection.duplicate()
  for index in range(count):
    var point := tile_centre(2 + index % 20, 2 + int(index / 20.0) % 12)
    var motion := InputEventMouseMotion.new()
    motion.device = DEVICE
    motion.position = point
    motion.global_position = point
    get_viewport().push_input(motion, true)
    for down in [true, false]:
      var event := InputEventMouseButton.new()
      event.device = DEVICE
      event.position = point
      event.global_position = point
      event.button_index = {"left": MOUSE_BUTTON_LEFT, "right": MOUSE_BUTTON_RIGHT, "wheel": MOUSE_BUTTON_WHEEL_UP}[kind]
      event.pressed = down
      get_viewport().push_input(event, true)
  await frames(4)
  return {"kind": kind, "count": count, "heardBefore": before, "heardAfter": heard_now(), "selectCalls": int(services.callbacks.get("select_tile", 0)) - selects_before,
    "selectionBefore": selection_before, "selectionAfter": game_snapshot().selection.duplicate()}


func bursts() -> Array:
  var rows: Array = []
  for kind in ["left", "right", "wheel"]:
    rows.append(await burst(kind, CLICKS))
  return rows


# --- The queue -------------------------------------------------------------------------------------------------------

# The head of the queue answered by a real press on its pick: the game's dialog and the HUD's before, the intents refused meanwhile,
# every frame from the press until the HUD shows the next head, and what the game says after.
func answer_head(round_index: int) -> Dictionary:
  var head: Dictionary = game_snapshot().dialog
  var seen := observe()
  var row := {"round": round_index, "context": game_snapshot().context, "dialog": head.duplicate(true), "hud": dialog_view(seen), "refusals": []}
  var hash_before: String = services.game.state_hash()
  var calls_before := total_calls()
  for call: Array in WAITING_CALLS:
    var result: Dictionary = services.callv(call[0], call[1])
    row.refusals.append({"intent": call[0], "ok": int(result.ok), "code": result.code})
  # Another event's choice, and one that is nobody's: refused as unknown, whoever the head is.
  for choice in [FOREIGN[round_index], "bogus"]:
    var result: Dictionary = services.resolve_event(choice)
    row.refusals.append({"intent": "resolve_event:" + choice, "ok": int(result.ok), "code": result.code})
  row["untouched"] = services.game.state_hash() == hash_before and total_calls() == calls_before + WAITING_CALLS.size() + 2
  var pick: String = head.choices[PICKS[round_index]].id if head.choices.size() > PICKS[round_index] else ""
  var resolves_before := int(services.callbacks.get("resolve_event", 0))
  samples = []
  recording = true
  var pressed := await press("hud-dialog-choice-" + pick)
  var moved := await wait_until(func() -> bool: return game_snapshot().dialog.open == 0 or game_snapshot().dialog.id != head.id)
  var settled := await settle()
  recording = false
  row["pick"] = pick
  row["pressed"] = pressed
  row["moved"] = moved
  row["settled"] = settled
  row["resolveCalls"] = int(services.callbacks.get("resolve_event", 0)) - resolves_before
  row["samples"] = samples.duplicate(true)
  row["after"] = {"context": game_snapshot().context, "dialog": game_snapshot().dialog.duplicate(true), "events": queue_state(), "hud": dialog_view(observe())}
  return row


func run_queue() -> void:
  await play_to(EVENT_STEP)
  var rounds: Array = []
  for round_index in range(EVENT_IDS.size()):
    await settle()
    # The second event is captured after the remount.
    if capture and round_index != 1:
      check(await capture_to("civ-lite-overlay-dialog-%d.png" % (round_index + 1)), "Capture saved: the dialog at %d of 3" % (round_index + 1))
    rounds.append(await answer_head(round_index))
  report["queue"] = {"rounds": rounds, "final": {"context": game_snapshot().context, "events": queue_state(), "dialog": game_snapshot().dialog.duplicate(true),
    "hud": dialog_view(observe())}}
  judge_queue(rounds)


func judge_queue(rounds: Array) -> void:
  var heads: Array = rounds.map(func(row: Dictionary) -> String: return row.dialog.id)
  check(heads == EVENT_IDS, "The dialog showed the three events in the game's order, one at a time: %s" % [heads])
  check(rounds.all(func(row: Dictionary) -> bool: return row.dialog.get("count", -1) == 3 and row.dialog.get("index", -1) == row.round + 1 and row.hud.position == "%d of 3" % (row.round + 1)),
    "The game counted the queue as 1 of 3, 2 of 3 and 3 of 3, and the HUD showed the position the game gave")
  check(rounds.all(func(row: Dictionary) -> bool: return row.hud.shown and row.hud.modal and row.hud.title == row.dialog.title and row.hud.text == row.dialog.text),
    "Each dialog was in the Modal's window, with the head's title and text")
  check(rounds.all(func(row: Dictionary) -> bool: return row.hud.choices == row.dialog.choices.map(func(choice: Dictionary) -> Dictionary: return {"id": choice.id, "label": choice.label, "detail": choice.detail, "disabled": false})),
    "Each dialog offered the head's own choices")
  check(rounds.all(func(row: Dictionary) -> bool: return row.refusals.all(func(entry: Dictionary) -> bool: return int(entry.ok) == 0 and entry.code == ("unknown_choice" if entry.intent.begins_with("resolve_event:") else "event_pending")) and row.untouched),
    "While an event waits every other intent is refused with event_pending, a choice of another event or of none with unknown_choice, and nothing changes")
  check(rounds.all(func(row: Dictionary) -> bool: return row.pressed and row.moved and row.settled and row.resolveCalls == 1),
    "A real press on a choice answered the head once and the game moved on")
  var resolved: Array = rounds[rounds.size() - 1].after.events.resolved
  check(resolved.map(func(answer: Dictionary) -> String: return answer.id) == heads and resolved.map(func(answer: Dictionary) -> String: return answer.choice) == rounds.map(func(row: Dictionary) -> String: return row.pick),
    "The game recorded the three answers in the order of the queue, each the choice that was pressed")
  check(rounds.size() == 3 and rounds[2].after.context == "none" and rounds[2].after.events.queue.is_empty() and not rounds[2].after.hud.shown,
    "After the third answer the queue is empty, the context leaves the dialog and the Modal is gone")
  check(rounds.all(func(row: Dictionary) -> bool: return row.samples.all(func(sample: Dictionary) -> bool: return not sample.shown or sample.title == row.dialog.title or sample.title == row.after.dialog.title)),
    "Between two heads the HUD showed the old event or the next one and never another")
  var instances: Array = rounds.map(func(row: Dictionary) -> int: return int(row.hud.instance))
  check(instances.size() == 3 and instances[0] != instances[1] and instances[1] != instances[2] and instances[0] != instances[2],
    "Each event of the queue was a subtree of its own: the dialog's Control was a new one every time")


# --- Remount ---------------------------------------------------------------------------------------------------------

# Unmounts the HUD's Surface and mounts it again, observing every frame from the mount until the HUD shows `wanted`.
func remount(wanted: String) -> Dictionary:
  var unmounted_context: String = game_snapshot().context
  hud.call("unmount")
  var gone := await wait_until(func() -> bool: return observe().nodes.is_empty())
  var while_unmounted := {"context": game_snapshot().context, "dialog": game_snapshot().dialog.duplicate(true), "events": queue_state()}
  samples = []
  recording = true
  hud.call("mount")
  var back := await wait_until(func() -> bool: return shown(observe(), wanted))
  var settled := await settle()
  recording = false
  return {"context": unmounted_context, "gone": gone, "whileUnmounted": while_unmounted, "back": back, "settled": settled, "samples": samples.duplicate(true),
    "hud": dialog_view(observe()), "dialog": game_snapshot().dialog.duplicate(true), "panels": panels_shown(observe()), "errors": app_errors()}


func run_remount() -> void:
  await play_to(EVENT_STEP)
  var first := await answer_head(0)
  await settle()
  var remounted := await remount("hud-dialog")
  if capture:
    check(await capture_to("civ-lite-overlay-dialog-2-remounted.png"), "Capture saved: the dialog at 2 of 3 after the remount")
  var rest: Array = []
  for round_index in range(1, EVENT_IDS.size()):
    rest.append(await answer_head(round_index))
  # The city screen is remounted the same way: it comes back as an overlay.
  await play_to(CITY_STEP)
  var city := await remount("hud-city")
  var city_seen := observe()
  city["modal"] = bool(find_node(city_seen, "hud-city").get("modal", false))
  city["research"] = shown(city_seen, "hud-research")
  report["remount"] = {"first": first, "remounted": remounted, "rest": rest, "city": city}
  judge_remount(first, remounted, rest, city)


func judge_remount(first: Dictionary, remounted: Dictionary, rest: Array, city: Dictionary) -> void:
  # The second event is what the game said was the head once the first was answered.
  var second: Dictionary = first.after.dialog
  check(first.moved and remounted.gone and remounted.back and remounted.settled and second.id == EVENT_IDS[1] and remounted.whileUnmounted.dialog.id == second.id,
    "With the second event at the head the Surface was unmounted (the HUD left the tree) and mounted again, and the game kept its queue meanwhile")
  check(remounted.hud.shown and remounted.hud.modal and remounted.hud.position == "2 of 3" and remounted.hud.title == second.title and remounted.hud.text == second.text,
    "The remounted HUD shows the second event, 2 of 3, in the Modal's window")
  check(remounted.samples.all(func(sample: Dictionary) -> bool: return not sample.shown or sample.title == second.title),
    "From the mount until it settled the HUD showed no event but the second")
  check(rest.size() == 2 and rest[0].dialog.id == second.id and rest[1].dialog.id == EVENT_IDS[2] and rest[1].after.context == "none"
    and rest[1].after.events.queue.is_empty() and rest.all(func(row: Dictionary) -> bool: return row.pressed and row.moved and row.resolveCalls == 1),
    "After the remount the queue went on, by real presses, to the third event and to the end")
  check(city.gone and city.back and city.settled and city.modal and city.research and city.panels == TABLE.city,
    "The city screen came back after a remount as an overlay, with the research list")


# --- Blocking --------------------------------------------------------------------------------------------------------

func run_blocking() -> void:
  # The city screen.
  await play_to(CITY_STEP)
  var city_open := await bursts()
  var production_before := int(services.callbacks.get("set_production", 0))
  var city_pressed := await press("hud-city-item-warrior")
  await settle()
  var city_press := {"pressed": city_pressed, "calls": int(services.callbacks.get("set_production", 0)) - production_before,
    "queue": game_snapshot().city.queue.map(func(entry: Dictionary) -> String: return entry.item)}
  if capture:
    check(await capture_to("civ-lite-overlay-city.png"), "Capture saved: the city screen as an overlay")
  var closed_pressed := await press("hud-city-close")
  var closed := await wait_until(func() -> bool: return game_snapshot().context == "none" and not shown(observe(), "hud-city"))
  await settle()
  var city_closed := await bursts()
  # The event dialog.
  await play_to(EVENT_STEP)
  var dialog_open := await bursts()
  var dialog_context: String = game_snapshot().context
  var answers: Array = []
  for round_index in range(EVENT_IDS.size()):
    var head: Dictionary = game_snapshot().dialog
    var pick: String = head.choices[PICKS[round_index]].id if head.choices.size() > PICKS[round_index] else ""
    var pressed := await press("hud-dialog-choice-" + pick)
    await wait_until(func() -> bool: return game_snapshot().dialog.open == 0 or game_snapshot().dialog.id != head.id)
    await settle()
    answers.append(pressed)
  var dialog_closed := await bursts()
  report["blocking"] = {"cityOpen": city_open, "cityPress": city_press, "cityClosePressed": closed_pressed, "cityClosed": closed, "cityAfter": city_closed,
    "dialogOpen": dialog_open, "dialogContext": dialog_context, "dialogAnswers": answers, "dialogAfter": dialog_closed}
  judge_blocking(city_open, city_press, closed_pressed and closed, city_closed, dialog_open, dialog_context, answers, dialog_closed)


func reached(row: Dictionary) -> bool:
  return int(row.heardAfter.buttons) - int(row.heardBefore.buttons) == 2 * int(row.count)


func silent(row: Dictionary) -> bool:
  return row.heardAfter == row.heardBefore and row.selectCalls == 0 and row.selectionAfter == row.selectionBefore


func judge_blocking(city_open: Array, city_press: Dictionary, city_closed_ok: bool, city_after: Array, dialog_open: Array, dialog_context: String, answers: Array, dialog_after: Array) -> void:
  check(city_open.all(silent), "With the city screen open, %d left clicks, %d right clicks and %d wheel ticks on the map reach the World 0 times" % [CLICKS, CLICKS, CLICKS])
  check(city_press.pressed and city_press.calls == 1 and city_press.queue == ["warrior"], "With the city screen open, a Pressable in it works: the item was put in the queue")
  check(city_closed_ok, "The city screen's Close is a real press that closes it: the context leaves the city and the Modal is gone")
  check(reached(city_after[0]) and city_after[0].selectCalls == CLICKS and reached(city_after[1]) and reached(city_after[2]),
    "With the city screen closed, %d of %d left clicks reach the World again (and each selects), and so do the right clicks and the wheel" % [CLICKS, CLICKS])
  check(dialog_context == "dialog" and dialog_open.all(silent), "With the dialog open, %d left clicks, %d right clicks and %d wheel ticks on the map reach the World 0 times" % [CLICKS, CLICKS, CLICKS])
  check(answers.size() == 3 and answers.all(func(pressed: bool) -> bool: return pressed), "With the dialog open, its Pressables work: the three events were answered by real presses")
  check(reached(dialog_after[0]) and dialog_after[0].selectCalls == CLICKS and reached(dialog_after[1]) and reached(dialog_after[2]),
    "With the queue answered, %d of %d left clicks reach the World again, and so do the right clicks and the wheel" % [CLICKS, CLICKS])


# --- A new game with events waiting ----------------------------------------------------------------------------------

func run_new_game() -> void:
  await play_to(EVENT_STEP)
  var answered := await answer_head(0)
  var before := {"epoch": int(services.epoch), "events": queue_state(), "dialog": game_snapshot().dialog.duplicate(true)}
  # The overlay holds the bar, so the HUD's Menu and New game cannot be pressed while an event waits: the services are what they call.
  services.open_menu()
  await frames(3)
  services.new_game()
  await wait_until(func() -> bool: return world() != null and int(services.epoch) == int(before.epoch) + 1)
  var settled := await settle()
  var fresh := {"epoch": int(services.epoch), "context": game_snapshot().context, "turn": int(game_snapshot().turn), "events": queue_state(), "dialog": game_snapshot().dialog.duplicate(true),
    "hud": dialog_view(observe()), "settled": settled, "worldReady": world() != null}
  for _turn in range(EVENT_TURN - 1):
    services.end_turn()
    await wait_until(func() -> bool: return int(services.job) == 0)
  var raised_settled := await settle()
  var raised := {"turn": int(game_snapshot().turn), "context": game_snapshot().context, "events": queue_state(), "dialog": game_snapshot().dialog.duplicate(true),
    "hud": dialog_view(observe()), "settled": raised_settled}
  report["newGame"] = {"answered": answered, "before": before, "fresh": fresh, "raised": raised}
  check(before.dialog.get("index", -1) == 2 and before.events.queue.size() == 2 and before.events.resolved.size() == 1,
    "A new game was started with the second event at the head: one answered and two waiting")
  check(fresh.settled and fresh.worldReady and fresh.epoch == int(before.epoch) + 1 and fresh.context == "none" and fresh.dialog.open == 0 and fresh.events.queue.is_empty()
    and fresh.events.resolved.is_empty() and not fresh.hud.shown, "The new session has no queue, no dialog and no Modal until its own turn 5")
  check(raised.settled and raised.turn == EVENT_TURN and raised.context == "dialog" and raised.events.queue.size() == 3 and raised.events.resolved.is_empty()
    and raised.dialog.get("index", -1) == 1 and raised.dialog.get("count", -1) == 3 and raised.hud.position == "1 of 3" and raised.hud.shown and raised.hud.modal,
    "At its turn 5 the new session raised its own three events, and the HUD showed the first, 1 of 3")
