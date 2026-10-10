extends "res://hud_probe.gd"

# The HUD lane's probe, run with `-- --validate-hud` (tests/civ-lite-ui-native.test.mjs does): it drives the real game scene and
# writes what the HUD showed as raw observations, which tests/civ-lite-ui-oracle.mjs judges again on its own. It decides nothing
# the HUD should decide: the context, the actions and the phase it compares with come from the services, and what it compares them
# with is the HUD's tree as the native host reports it (testID, text, position, whether a Control stops the pointer, whether a
# Pressable is disabled). The helpers it shares with the overlay probe are in hud_probe.gd.
#
#   matrix   the replay's steps 0 to 45 played through the services on a fresh game, the HUD observed after each (the seven covering
#            steps are the contexts): the panels it shows, the actions it lists and the bar, and whether an overlay blocks the map
#            exactly in the two contexts that have one. The state it waits for is what the game published; a wait that reaches its
#            limit is a failed check, and what was seen is recorded either way.
#   phase    End turn pressed on the HUD: every frame of the job observed (the spinner, the button and the phase text must agree),
#            then a second job held at its first phase, where the spinner, the disabled End turn and its reason are looked at and a
#            press on the disabled End turn changes nothing.
#   input    real pointer events through the viewport (device 1001, the validation device of the Surface): a click on a tile selects
#            it, the pointer over a tile publishes the hover, a click on a panel does not reach the map, an action is pressed and a
#            disabled one is not, and all of it again after a trip through the menu (the World comes back ahead of the HUD).
#
#   stress   the comparison's stress mode (docs/research/frontier-stress.md): refused during a turn, begun, the panel shown with 200 log rows and
#            100 production rows, 20 steps one frame apart (each row that was there is the same Control, the last line and the changed
#            items are the game's), ended (the panel gone, the contexts' panels back, the snapshot byte for byte as it was) and refused when
#            the mode is off; and the runner's `stats()` against what the node emitted.
#
#   irrigation  the request of the cost-of-change experiment (docs/research/frontier-change-cost.md), asked of either HUD the same way: a Settler on a
#            Plain with Water beside it is offered Irrigate, enabled, with the irrigation icon; a real press on it irrigates the tile; and the card of
#            the irrigated tile shows the irrigation icon and says Irrigated on its units line, with the food the game gives, the bonus included.
#
#   --capture    saves one PNG per context, one during the AI phase and one with the stress panel full (a headed run)

const LAST_STEP := 45
# The steps of the roteiro that cover each context (docs/research/frontier-game.md).
const COVERING := {"stack": 2, "settler": 3, "warrior": 9, "city": 18, "tile": 32, "none": 33, "dialog": 45}
const AI_PHASES := ["ai_plan", "ai_move"]

var recording := false
var samples: Array = []


func flag() -> String:
  return "--validate-hud"


func report_path() -> String:
  return "res://civ-lite-ui-report.json"


func marker() -> String:
  return "CIVLITE_UI"


func _process(_delta: float) -> void:
  if recording:
    samples.append(sample())


func run_probe() -> void:
  await run_matrix()
  await run_phase()
  await run_stress()
  await run_input()
  await run_irrigation()


# --- Matrix: the seven contexts ------------------------------------------------------------------------------------

func run_matrix() -> void:
  services.new_game()
  var rows: Array = []
  var covered := {}
  var all_settled := true
  await settle()
  for index in range(LAST_STEP + 1):
    var step: Dictionary = Replay.STEPS[index]
    var result: Dictionary = services.callv(step.intent, step.args)
    if step.intent == "end_turn" and int(result.ok) == 1:
      await wait_until(func() -> bool: return int(services.job) == 0)
    var reached := await settle()
    var snapshot := game_snapshot()
    var seen := observe()
    all_settled = all_settled and reached
    rows.append({"index": index, "label": step.label, "intent": step.intent, "args": step.args, "code": result.code, "expectedCode": step.code,
      "expectedContext": step.context, "settled": reached, "snapshot": snapshot, "observed": seen, "panels": panels_shown(seen)})
    if step.label.begins_with("cover-"):
      var context: String = snapshot.context
      covered[context] = index
      if capture:
        check(await capture_to("civ-lite-ui-%s.png" % context), "Capture saved: the %s context" % context)
  report["matrix"] = rows
  report["covering"] = covered
  check(all_settled, "The HUD caught up with the game after each of the %d steps of the roteiro" % (LAST_STEP + 1))
  check(covered == COVERING, "The covering steps of the roteiro reached the seven contexts at the steps the game's notes list")
  for row: Dictionary in rows:
    var expected: Array = TABLE.get(row.snapshot.context, [])
    check(row.panels == expected, "Step %d (%s): the HUD showed %s for the %s context, the table says %s" % [row.index, row.intent, row.panels, row.snapshot.context, expected])
    check(bar_matches(row.observed, row.snapshot),
      "Step %d (%s): the bar's End turn is enabled exactly as the game's end_turn action says, with its reason, and the spinner shows exactly while the phase is not idle" % [row.index, row.intent])
    if expected.has("hud-actions"):
      check(rendered_actions(row.observed) == expected_actions(row.snapshot),
        "Step %d (%s): the actions panel lists the snapshot's actions but End turn, in order, with their enabled flags and reasons" % [row.index, row.intent])
  # The map is the World's, except under an overlay. Nothing of the HUD that is in the tree and stops the pointer covers a tile, in any
  # context; and the Modal's Window, which holds the city screen and the dialog, covers the whole map exactly in the two contexts that
  # have an overlay: that is what blocks the pointer there.
  var map_rect := Rect2(MAP_ORIGIN, Vector2(24, 16) * MAP_TILE)
  var covering_map: Array = []
  var wrong_blocking: Array = []
  for row: Dictionary in rows:
    var blocks := false
    for stopper: Dictionary in row.observed.stoppers:
      var rect := Rect2(stopper.rect[0], stopper.rect[1], stopper.rect[2], stopper.rect[3])
      if stopper.modal:
        blocks = blocks or rect.encloses(map_rect)
      elif rect.intersects(map_rect):
        covering_map.append("step %d %s" % [row.index, stopper.testID])
    if blocks != (row.snapshot.context in ["city", "dialog"]):
      wrong_blocking.append("step %d (%s)" % [row.index, row.snapshot.context])
  check(covering_map.is_empty(), "No Control of the HUD in the tree that stops the pointer covers the map: %s" % [covering_map])
  check(wrong_blocking.is_empty(), "The Modal covers the whole map in every step of the city and dialog contexts and in no step of the others: %s" % [wrong_blocking])


# --- Phase: the turn the game processes ------------------------------------------------------------------------------

# What the bar says right now: the phase, the spinner, and End turn with the reason it gives when it is not enabled.
func sample() -> Dictionary:
  var seen := observe()
  var end_turn := find_node(seen, "hud-bar-end-turn")
  var spinner := find_node(seen, "hud-turn-spinner")
  return {"phase": text_of(seen, "hud-bar-phase"), "spinner": not spinner.is_empty() and spinner.visible, "animating": spinner.get("animating", false),
    "endTurnDisabled": end_turn.get("disabled", false), "endTurnReason": text_of(seen, "hud-bar-end-turn-reason"), "turn": text_of(seen, "hud-bar-turn")}


func run_phase() -> void:
  services.new_game()
  await settle()
  var published: Array = []
  var recorder := func(snapshot: Dictionary) -> void:
    var end_turn: Dictionary = snapshot.actions.filter(func(action: Dictionary) -> bool: return action.id == "end_turn")[0]
    published.append({"phase": snapshot.phase, "turn": snapshot.turn, "endTurnEnabled": int(end_turn.enabled), "endTurnReason": end_turn.reason,
      "lastJob": snapshot.last_job})
  services.snapshot_changed.connect(recorder)
  var turn_before := int(game_snapshot().turn)
  var job_expected := int(services.next_job)
  var idle_before := sample()

  # The job runs on its own after the press, and every frame of it is observed.
  samples = []
  recording = true
  var pressed := await press("hud-bar-end-turn")
  var finished := await wait_until(func() -> bool: return int(services.job) == 0 and int(services.finished_jobs.get(job_expected, 0)) == 1)
  var settled := await settle()
  recording = false
  var free_samples := samples.duplicate()
  var free_job := {"pressed": pressed, "finished": finished, "settled": settled, "turnBefore": turn_before, "turnAfter": int(game_snapshot().turn),
    "lastJob": int(game_snapshot().last_job), "idleBefore": idle_before, "idleAfter": sample(), "samples": free_samples}
  services.snapshot_changed.disconnect(recorder)

  # A second job is held at its first phase, where the HUD is looked at. The job's driver is the node's _process: while it is off,
  # the press is accepted, the first phase is published, and nothing goes on.
  var held := {}
  services.set_process(false)
  var calls_before_press := int(services.callbacks.get("end_turn", 0))
  var pressed_held := await press("hud-bar-end-turn")
  await wait_until(func() -> bool: return int(services.job) != 0 and sample().spinner)
  var phase_held: String = game_snapshot().phase
  held = {"pressed": pressed_held, "gamePhase": phase_held, "job": int(services.job), "sample": sample(), "observed": observe(),
    "acceptedCalls": int(services.callbacks.get("end_turn", 0)) - calls_before_press}
  if capture:
    check(await capture_to("civ-lite-ui-ai-phase.png"), "Capture saved: the AI phase with the spinner")
  # End turn is disabled now: pressing it again asks nothing of the game.
  var callbacks_before: int = services.callbacks.values().reduce(func(total: int, count: int) -> int: return total + count, 0)
  var job_before := int(services.job)
  var stats_before := hud_stats()
  await press("hud-bar-end-turn")
  await frames(3)
  var callbacks_after: int = services.callbacks.values().reduce(func(total: int, count: int) -> int: return total + count, 0)
  held["disabledPress"] = {"callbacksBefore": callbacks_before, "callbacksAfter": callbacks_after, "jobBefore": job_before, "jobAfter": int(services.job),
    "hudCallsBefore": int(stats_before.get("calls", -1)), "hudCallsAfter": int(hud_stats().get("calls", -2))}
  services.set_process(true)
  await wait_until(func() -> bool: return int(services.job) == 0)
  var settled_after := await settle()
  held["finished"] = int(services.job) == 0
  held["settledAfter"] = settled_after
  held["idleAfter"] = sample()
  held["turnAfter"] = int(game_snapshot().turn)

  report["phase"] = {"published": published, "free": free_job, "held": held}
  check(published.any(func(entry: Dictionary) -> bool: return AI_PHASES.has(entry.phase)), "The job published a snapshot at an AI phase")
  check(published.all(func(entry: Dictionary) -> bool: return entry.phase == "idle" or (int(entry.endTurnEnabled) == 0 and entry.endTurnReason == "turn_in_progress")),
    "Every snapshot published while the turn is processed has End turn disabled with turn_in_progress")
  check(free_job.pressed and free_job.finished and free_job.settled and free_job.turnAfter == turn_before + 1, "End turn pressed on the HUD ran a job to rest and the turn advanced")
  check(free_samples.all(func(entry: Dictionary) -> bool: return entry.spinner == (entry.phase != "idle") and entry.endTurnDisabled == (entry.phase != "idle")),
    "In every frame of the job the spinner is shown and End turn is disabled exactly while the phase is not idle")
  check(not idle_before.spinner and not idle_before.endTurnDisabled, "At rest before the job the spinner is not shown and End turn is enabled")
  check(held.sample.spinner and held.sample.animating and held.sample.endTurnDisabled and AI_PHASES.has(phase_held) and held.sample.phase == phase_held,
    "Held at %s: the bar shows that phase, the spinner is spinning and End turn is disabled" % phase_held)
  check(held.sample.endTurnReason == "The turn is being processed.", "Held at an AI phase, End turn shows the game's reason: the turn is being processed")
  check(held.disabledPress.callbacksBefore == held.disabledPress.callbacksAfter and held.disabledPress.jobBefore == held.disabledPress.jobAfter
    and held.disabledPress.hudCallsBefore == held.disabledPress.hudCallsAfter and held.acceptedCalls == 1,
    "A press on the disabled End turn asks nothing of the game: no call, no second job")
  check(held.finished and held.settledAfter and not held.idleAfter.spinner and not held.idleAfter.endTurnDisabled and held.turnAfter == turn_before + 2,
    "Released, the held job finished: the spinner is gone, End turn is enabled and the turn advanced")


# --- Stress: the comparison's stress mode ----------------------------------------------------------------------------

const STRESS_STEPS := 20
const STRESS_LOG := "hud-stress-log-"
const STRESS_PRODUCTION := "hud-stress-production-"


# The snapshot as text, the keys sorted: two snapshots are the same if their texts are.
func canonical(snapshot: Dictionary) -> String:
  return JSON.stringify(snapshot, "", true)


# The rows of a stress list as the HUD shows them, in the order they are drawn: key, text and the Control they are.
func stress_rows(seen: Dictionary, prefix: String) -> Array:
  var rows: Array = []
  for entry: Dictionary in seen.nodes:
    var id: String = entry.testID
    if id.begins_with(prefix) and not id.ends_with("-title") and entry.visible:
      rows.append({"key": id.trim_prefix(prefix), "text": entry.text, "instance": entry.instance, "y": entry.rect[1]})
  rows.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a.y < b.y or (a.y == b.y and a.key < b.key))
  return rows.map(func(row: Dictionary) -> Dictionary: return {"key": row.key, "text": row.text, "instance": row.instance})


# The HUD shows the stress lists the published snapshot carries: every line and every item, in order.
func stress_matches(snapshot: Dictionary) -> bool:
  if not snapshot.has("stress"):
    return not shown(observe(), "hud-stress")
  var seen := observe()
  var log: Array = stress_rows(seen, STRESS_LOG).map(func(row: Dictionary) -> String: return row.text)
  var production: Array = stress_rows(seen, STRESS_PRODUCTION).map(func(row: Dictionary) -> String: return row.text)
  var items: Array = snapshot.stress.production.map(func(item: Dictionary) -> String: return "%s %d/%d" % [item.label, item.progress, item.cost])
  return shown(seen, "hud-stress") and log == Array(snapshot.stress.log) and production == items


func stress_settle() -> bool:
  var reached := await wait_until(func() -> bool: return stress_matches(services.get_snapshot()))
  await frames(3)
  return reached and stress_matches(services.get_snapshot())


func stress_view(label: String) -> Dictionary:
  var seen := observe()
  var snapshot: Dictionary = services.get_snapshot()
  return {"label": label, "context": snapshot.context, "panels": panels_shown(seen), "panelShown": shown(seen, "hud-stress"), "log": stress_rows(seen, STRESS_LOG),
    "production": stress_rows(seen, STRESS_PRODUCTION), "carried": snapshot.has("stress"),
    "lines": Array(snapshot.stress.log) if snapshot.has("stress") else [], "items": snapshot.stress.production if snapshot.has("stress") else []}


func run_stress() -> void:
  services.new_game()
  await settle()
  var stress := {}
  # A full turn through the HUD's eyes: the runner's stats() and the node's counters before and after, and the snapshots the node published meanwhile.
  var published := [0]
  var counter := func(_snapshot: Dictionary) -> void: published[0] += 1
  services.snapshot_changed.connect(counter)
  var stats_before: Dictionary = reader.runner_stats()
  var emitted_before := int(services.notifications_emitted())
  var accepted: Dictionary = services.end_turn()
  # The mode is refused while that turn's job runs.
  var during: Dictionary = services.stress_begin()
  await wait_until(func() -> bool: return int(services.job) == 0)
  await settle()
  await frames(3)
  services.snapshot_changed.disconnect(counter)
  var stats_after: Dictionary = reader.runner_stats()
  stress["turn"] = {"accepted": accepted.code, "refused": during, "carried": game_snapshot().has("stress"), "statsBefore": stats_before, "statsAfter": stats_after,
    "emittedBefore": emitted_before, "emittedAfter": int(services.notifications_emitted()), "snapshotsPublished": int(published[0])}
  # Outside the mode the intents of the mode are refused, and nothing changes.
  var off_step: Dictionary = services.stress_step()
  var off_end: Dictionary = services.stress_end()
  stress["off"] = {"step": off_step, "end": off_end}
  var before_text := canonical(services.get_snapshot())
  var begun: Dictionary = services.stress_begin()
  var begun_in_time := await stress_settle()
  stress["begun"] = stress_view("begun")
  stress["begun"]["result"] = begun
  stress["begun"]["settled"] = begun_in_time
  stress["again"] = services.stress_begin()
  # Twenty updates, one a frame.
  var results: Array = []
  for _index in range(STRESS_STEPS):
    await tree_frame()
    results.append(services.stress_step())
  var stepped_in_time := await stress_settle()
  stress["steps"] = {"results": results, "view": stress_view("stepped"), "settled": stepped_in_time}
  if capture:
    check(await capture_to("civ-lite-ui-stress.png"), "Capture saved: the stress panel full")
  var ended: Dictionary = services.stress_end()
  var ended_in_time := await wait_until(func() -> bool: return stress_matches(services.get_snapshot()))
  await settle()
  var after_text := canonical(services.get_snapshot())
  stress["ended"] = stress_view("ended")
  stress["ended"]["result"] = ended
  stress["ended"]["settled"] = ended_in_time
  stress["snapshots"] = {"before": before_text, "after": after_text}
  await frames(3)
  stress["final"] = {"stats": reader.runner_stats(), "emitted": int(services.notifications_emitted())}
  report["stress"] = stress
  judge_stress(stress)


func tree_frame() -> void:
  await get_tree().process_frame


func judge_stress(stress: Dictionary) -> void:
  var turn: Dictionary = stress.turn
  check(turn.accepted == "ok" and int(turn.refused.ok) == 0 and turn.refused.code == "turn_in_progress" and not turn.carried,
    "The stress mode is refused with turn_in_progress while a turn runs, and the snapshot carries nothing of it")
  check(int(turn.statsAfter.events) - int(turn.statsBefore.events) == int(turn.emittedAfter) - int(turn.emittedBefore)
    and int(turn.statsAfter.snapshots) - int(turn.statsBefore.snapshots) == int(turn.snapshotsPublished) and int(turn.snapshotsPublished) > 0,
    "Over a whole turn the runner's stats() counts the notifications the node emitted and the snapshots it published, and no others")
  check(int(stress.off.step.ok) == 0 and stress.off.step.code == "stress_off" and int(stress.off.end.ok) == 0 and stress.off.end.code == "stress_off",
    "With the mode off, a step and an end are refused with stress_off")
  var begun: Dictionary = stress.begun
  check(int(begun.result.ok) == 1 and begun.settled and begun.carried and begun.lines.size() == 200 and begun.items.size() == 100 and begun.panelShown
    and begun.log.size() == 200 and begun.production.size() == 100 and begun.panels == TABLE.get(begun.context, []),
    "The stress mode shows hud-stress with 200 log rows and 100 production rows in the context's own panels, which the table did not change")
  check(int(stress.again.ok) == 0 and stress.again.code == "stress_on", "A second begin is refused with stress_on")
  var steps: Dictionary = stress.steps
  var kept_log := 0
  var kept_production := 0
  var before_log := {}
  var before_production := {}
  for row: Dictionary in begun.log:
    before_log[row.key] = row.instance
  for row: Dictionary in begun.production:
    before_production[row.key] = row.instance
  for row: Dictionary in steps.view.log:
    if before_log.get(row.key, -1) == row.instance:
      kept_log += 1
  for row: Dictionary in steps.view.production:
    if before_production.get(row.key, -1) == row.instance:
      kept_production += 1
  check(steps.results.all(func(result: Dictionary) -> bool: return int(result.ok) == 1) and steps.settled and steps.view.log.size() == 200 and steps.view.production.size() == 100
    and kept_log == 200 - STRESS_STEPS and kept_production == 100,
    "Twenty steps, one a frame, leave the HUD with the game's 200 lines and 100 items, and every row that was there is the same Control: one line mounted and one dropped for each step, no row built again")
  var ended: Dictionary = stress.ended
  check(int(ended.result.ok) == 1 and ended.settled and not ended.carried and not ended.panelShown and ended.panels == TABLE.get(ended.context, []) and ended.log.is_empty()
    and ended.production.is_empty() and stress.snapshots.before == stress.snapshots.after,
    "Leaving the mode removes the panel, the context's panels are shown again and the snapshot is byte for byte the one before the mode began")
  var final: Dictionary = stress.final
  check(int(final.stats.events) == int(final.emitted), "The runner's stats() has consumed every notification the node emitted")


# --- Irrigation: the experiment's request ----------------------------------------------------------------------------

# The route to an irrigable Plain is the start: the player's Settler (unit 1) begins on tile (6, 8), a Plain with Water at (5, 8), so selecting it
# through the services is the whole of it, and every run takes the same one. The pointer is first taken off the map, so that the tile card is the
# selected tile's. The press is a real click through the viewport; if the HUD does not send the intent, the probe sends it through the services so
# that what the HUD shows of an irrigated tile is still looked at, and the press is recorded as having failed.
const IRRIGATION_UNIT := 1
const IRRIGATION_TILE := Vector2i(6, 8)
const IRRIGATION_ACTION := "hud-actions-irrigate-1"
const IRRIGATION_ASSET := "irrigation.png"
# The tile card's mark of an irrigated tile: the irrigation icon (an Image).
const IRRIGATION_MARK := "hud-tile-irrigated"
# The tile's four sides, north, east, south and west.
const SIDES := [Vector2i(0, -1), Vector2i(1, 0), Vector2i(0, 1), Vector2i(-1, 0)]


func tile_index(tile: Vector2i) -> int:
  return tile.y * 24 + tile.x


# The rows of the HUD that are about the action and the tile card: what the stage reads.
func irrigation_rows(seen: Dictionary) -> Array:
  return seen.nodes.filter(func(entry: Dictionary) -> bool: return entry.testID.begins_with(IRRIGATION_ACTION) or entry.testID.begins_with("hud-tile"))


# What the game says and what the HUD shows, now.
func irrigation_view() -> Dictionary:
  var state: Dictionary = services.game.state
  var snapshot := game_snapshot()
  var sides: Array = SIDES.map(func(side: Vector2i) -> int: return int(state.map.terrain[tile_index(IRRIGATION_TILE + side)]))
  return {"snapshot": {"context": snapshot.context, "selection": snapshot.selection, "tile": snapshot.tile,
      "actions": snapshot.actions.filter(func(action: Dictionary) -> bool: return action.id == "irrigate")},
    "game": {"irrigated": state.irrigated.duplicate(), "moves": int(unit_by_id(IRRIGATION_UNIT).get("moves", -1)), "terrain": int(state.map.terrain[tile_index(IRRIGATION_TILE)]),
      "sides": sides},
    "nodes": irrigation_rows(observe())}


func is_irrigated(tile: Vector2i) -> bool:
  return services.game.state.irrigated.has(tile_index(tile))


func run_irrigation() -> void:
  services.new_game()
  await settle()
  await move_to(Vector2(610, 300))
  await wait_until(func() -> bool: return services.hover.x < 0)
  var selected: Dictionary = services.select_unit(IRRIGATION_UNIT)
  var in_context := await wait_until(func() -> bool: return game_snapshot().context == "settler")
  await settle()
  var before := irrigation_view()
  var irrigate_calls := int(services.callbacks.get("irrigate", 0))
  var hud_calls := int(hud_stats().get("calls", 0))
  var pressed := await press(IRRIGATION_ACTION)
  var by_press := await wait_until(func() -> bool: return is_irrigated(IRRIGATION_TILE))
  var pushed := {"pressed": pressed, "irrigatedByPress": by_press, "irrigateCalls": int(services.callbacks.get("irrigate", 0)) - irrigate_calls,
    "hudCalls": int(hud_stats().get("calls", 0)) - hud_calls}
  if not by_press:
    services.irrigate(IRRIGATION_UNIT)
  await settle()
  var after := irrigation_view()
  var irrigation := {"unit": IRRIGATION_UNIT, "tile": [IRRIGATION_TILE.x, IRRIGATION_TILE.y], "selected": selected, "inContext": in_context, "before": before,
    "press": pushed, "after": after}
  report["irrigation"] = irrigation
  judge_irrigation(irrigation)


func irrigation_node(view: Dictionary, id: String) -> Dictionary:
  for entry: Dictionary in view.nodes:
    if entry.testID == id:
      return entry
  return {}


# An Image of the irrigation icon that is on screen: visible, with a rect that has an area, and drawing the file the generator made.
func irrigation_icon(view: Dictionary, id: String) -> bool:
  var entry := irrigation_node(view, id)
  return (not entry.is_empty() and entry.visible and entry.kind == "image" and entry.asset == IRRIGATION_ASSET and float(entry.rect[2]) > 0.0 and float(entry.rect[3]) > 0.0)


func judge_irrigation(irrigation: Dictionary) -> void:
  var before: Dictionary = irrigation.before
  var after: Dictionary = irrigation.after
  var pushed: Dictionary = irrigation.press
  var offered: Dictionary = before.snapshot.actions[0] if before.snapshot.actions.size() == 1 else {}
  var button := irrigation_node(before, IRRIGATION_ACTION)
  check(irrigation.inContext and before.game.terrain == 1 and before.game.sides.has(0) and before.game.irrigated.is_empty()
    and not offered.is_empty() and int(offered.enabled) == 1 and not button.is_empty() and button.visible and not button.disabled
    and irrigation_node(before, IRRIGATION_ACTION + "-label").get("text", "") == offered.label,
    "Irrigate: a Settler on a Plain with Water beside it is offered Irrigate in the actions panel, enabled, with the game's label")
  check(irrigation_icon(before, IRRIGATION_ACTION + "-icon"), "Irrigate: the action shows the irrigation icon, drawn")
  check(pushed.pressed and pushed.irrigatedByPress and pushed.irrigateCalls == 1 and pushed.hudCalls == 1,
    "Irrigate: a real press on the enabled action irrigated the tile, with one call to the game")
  var card: Dictionary = after.snapshot.tile
  check(after.game.irrigated == [tile_index(IRRIGATION_TILE)] and after.game.moves == 0 and int(card.irrigated) == 1
    and int(card.food) == int(before.snapshot.tile.food) + 1 and int(card.production) == int(before.snapshot.tile.production),
    "Irrigate: the game irrigated the tile, spent all of the Settler's moves and gave the tile one more food")
  var gone: Dictionary = after.snapshot.actions[0] if after.snapshot.actions.size() == 1 else {}
  var done := irrigation_node(after, IRRIGATION_ACTION)
  check(not gone.is_empty() and int(gone.enabled) == 0 and gone.reason == "already_irrigated" and not done.is_empty() and done.disabled
    and irrigation_node(after, IRRIGATION_ACTION + "-reason").get("text", "") == gone.reason_text,
    "Irrigate: once the tile is irrigated the action is disabled, with the game's reason beside it")
  var yields := "Food %d · Production %d · Science %d · Move %d%s" % [card.food, card.production, card.science, card.move_cost, " · City" if int(card.city) == 1 else ""]
  check(irrigation_node(after, "hud-tile-yields").get("text", "") == yields,
    "Irrigate: the tile card's food is the game's, the irrigation's included")
  var units_before: String = irrigation_node(before, "hud-tile-units").get("text", "")
  check(not irrigation_node(before, IRRIGATION_MARK).get("visible", false) and not units_before.contains("Irrigated"),
    "Irrigate: before it is irrigated the tile card shows no irrigation icon and its units line does not say Irrigated")
  check(irrigation_icon(after, IRRIGATION_MARK), "Irrigate: the card of the irrigated tile shows the irrigation icon, drawn")
  var units: String = irrigation_node(after, "hud-tile-units").get("text", "")
  check(units.contains("Irrigated") and card.units.all(func(unit: Dictionary) -> bool: return units.contains(unit.name)),
    "Irrigate: the units line of the irrigated tile says Irrigated and still lists its units")


# --- Input: real pointer events -------------------------------------------------------------------------------------

func snapshot_of_input(label: String, extra: Dictionary = {}) -> Dictionary:
  var seen := observe()
  var snapshot := game_snapshot()
  var row := {"label": label, "context": snapshot.context, "selection": snapshot.selection, "heard": heard_now(),
    "hover": services.get_hover(), "callbacks": services.callbacks.duplicate(), "tileTitle": text_of(seen, "hud-tile-title"),
    "tileYields": text_of(seen, "hud-tile-yields"), "tileUnits": text_of(seen, "hud-tile-units"), "panels": panels_shown(seen), "actions": rendered_actions(seen),
    "units": services.game.state.units.duplicate(true)}
  row.merge(extra)
  return row


func run_input() -> void:
  var steps: Array = []
  services.new_game()
  await settle()
  # Every card the node publishes as the hover, in order: it must publish a change and never the same card twice running.
  var hover_log: Array = []
  var hover_recorder := func(card: Dictionary) -> void: hover_log.append(card)
  services.hover_changed.connect(hover_recorder)

  # A click on a tile selects it: (6, 8) holds two units, a stack; (9, 8) is an empty plain.
  var before := snapshot_of_input("before")
  var point := tile_centre(6, 8)
  await click_at(point)
  var stack_selected := await wait_until(func() -> bool: return game_snapshot().context == "stack")
  await settle()
  steps.append(snapshot_of_input("click-tile-6-8", {"point": [point.x, point.y], "reached": stack_selected, "before": before}))
  point = tile_centre(9, 8)
  await click_at(point)
  var tile_selected := await wait_until(func() -> bool: return game_snapshot().context == "tile")
  await settle()
  steps.append(snapshot_of_input("click-tile-9-8", {"point": [point.x, point.y], "reached": tile_selected}))

  # The pointer over another tile publishes the hover, and the tile card shows it; the selection does not move.
  point = tile_centre(12, 4)
  await move_to(point)
  var hovered := await wait_until(func() -> bool: return services.hover == Vector2i(12, 4) and text_of(observe(), "hud-tile-title").begins_with("Pointer"))
  steps.append(snapshot_of_input("hover-tile-12-4", {"point": [point.x, point.y], "reached": hovered}))
  # Over a panel the pointer is no longer over the map: the hover goes, and the card is the selected tile's again.
  point = centre_of("hud-bar")
  await move_to(point)
  var left_for_panel := await wait_until(func() -> bool: return services.hover.x < 0 and text_of(observe(), "hud-tile-title").begins_with("Selected"))
  steps.append(snapshot_of_input("hover-over-bar", {"point": [point.x, point.y], "reached": left_for_panel, "barRect": rect_of("hud-bar")}))
  await move_to(tile_centre(12, 4))
  await wait_until(func() -> bool: return services.hover == Vector2i(12, 4))
  point = Vector2(610, 300)
  await move_to(point)
  var left_for_gap := await wait_until(func() -> bool: return services.hover.x < 0)
  steps.append(snapshot_of_input("hover-off-map", {"point": [point.x, point.y], "reached": left_for_gap}))

  # A click on a panel does not reach the map: the World hears nothing and the selection stays.
  var panel_clicks: Array = []
  for id in ["hud-tile", "hud-bar"]:
    panel_clicks.append(await click_panel(id))
  steps.append(snapshot_of_input("click-on-panels", {"panelClicks": panel_clicks}))

  # An action Pressable performs its action: select the Warrior out of the stack, then fortify it; a second Fortify is disabled.
  await click_at(tile_centre(6, 8))
  await wait_until(func() -> bool: return game_snapshot().context == "stack")
  await settle()
  var select_pressed := await press("hud-actions-select_unit-2")
  var warrior_selected := await wait_until(func() -> bool: return game_snapshot().context == "warrior")
  await settle()
  steps.append(snapshot_of_input("press-select-warrior", {"pressed": select_pressed, "reached": warrior_selected}))
  var fortify_before := int(services.callbacks.get("fortify", 0))
  var fortify_pressed := await press("hud-actions-fortify-2")
  var fortified := await wait_until(func() -> bool: return int(unit_by_id(2).get("fortified", 0)) == 1)
  await settle()
  steps.append(snapshot_of_input("press-fortify", {"pressed": fortify_pressed, "reached": fortified, "fortifyCallsBefore": fortify_before}))
  var callbacks_total_before: int = services.callbacks.values().reduce(func(total: int, count: int) -> int: return total + count, 0)
  var disabled_pressed := await press("hud-actions-fortify-2")
  await frames(3)
  var callbacks_total_after: int = services.callbacks.values().reduce(func(total: int, count: int) -> int: return total + count, 0)
  steps.append(snapshot_of_input("press-disabled-fortify", {"pressed": disabled_pressed, "callbacksTotalBefore": callbacks_total_before,
    "callbacksTotalAfter": callbacks_total_after}))

  # The menu and back: the World is a new node, and it has to be ahead of the HUD again for the panels to keep the pointer.
  var menu_pressed := await press("hud-bar-menu")
  var in_menu := await wait_until(func() -> bool: return world() == null and shown(observe(), "menu-new-game"))
  var hover_in_menu: Dictionary = services.get_hover()
  var new_pressed := await press("menu-new-game")
  var back := await wait_until(func() -> bool: return world() != null and shown(observe(), "hud-bar"))
  await settle()
  var layer: Node = hud.get_parent()
  steps.append(snapshot_of_input("after-menu", {"menuPressed": menu_pressed, "inMenu": in_menu, "newPressed": new_pressed, "back": back, "hoverInMenu": hover_in_menu,
    "worldIndex": world().get_index() if world() != null else -1, "layerIndex": layer.get_index()}))
  point = tile_centre(9, 8)
  await click_at(point)
  var selected_after_menu := await wait_until(func() -> bool: return game_snapshot().context == "tile")
  await settle()
  steps.append(snapshot_of_input("click-tile-after-menu", {"point": [point.x, point.y], "reached": selected_after_menu}))
  panel_clicks = []
  for id in ["hud-tile", "hud-bar"]:
    panel_clicks.append(await click_panel(id))
  steps.append(snapshot_of_input("click-on-panels-after-menu", {"panelClicks": panel_clicks}))

  services.hover_changed.disconnect(hover_recorder)
  report["input"] = steps
  report["hoverPublished"] = hover_log
  judge_input(steps)
  check(hover_log.size() > 1 and range(1, hover_log.size()).all(func(index: int) -> bool: return hover_log[index] != hover_log[index - 1]),
    "The node published the hover as a change each time and never the same card twice running")


# A left click and then a tick of the wheel on a panel's own area: what the World heard and what was selected, before and after each. The
# GUI keeps the click from the World (the panel's Control stops it) but lets the wheel through, which only the HUD's Surface keeps from
# a World it hears first.
func click_panel(id: String) -> Dictionary:
  var corner := corner_of(id)
  var heard_before := heard_now()
  var selection_before: Dictionary = game_snapshot().selection.duplicate()
  await click_at(corner)
  await frames(3)
  var heard_after_click := heard_now()
  await wheel_at(corner)
  await frames(3)
  return {"panel": id, "present": corner.x >= 0, "point": [corner.x, corner.y], "rect": rect_of(id), "heardBefore": heard_before, "heardAfter": heard_after_click,
    "heardAfterWheel": heard_now(), "selectionBefore": selection_before, "selectionAfter": game_snapshot().selection.duplicate()}


func unit_by_id(id: int) -> Dictionary:
  for unit: Dictionary in services.game.state.units:
    if int(unit.id) == id:
      return unit
  return {}


func judge_input(steps: Array) -> void:
  var by_label := {}
  for step: Dictionary in steps:
    by_label[step.label] = step
  var clicked: Dictionary = by_label["click-tile-6-8"]
  check(clicked.reached and clicked.selection.x == 6 and clicked.selection.y == 8 and clicked.context == "stack" and clicked.panels == TABLE.stack,
    "A real left click on tile (6, 8) selected it through the World: the stack context, with its panels")
  var clicked_again: Dictionary = by_label["click-tile-9-8"]
  # The pointer is still over the tile it clicked, so the card is the hovered one: the same tile.
  check(clicked_again.reached and clicked_again.selection.x == 9 and clicked_again.selection.y == 8 and clicked_again.context == "tile"
    and clicked_again.tileTitle.ends_with("(9, 8) Plain"), "A real left click on tile (9, 8) selected it, and the tile card is that tile's")
  var hovering: Dictionary = by_label["hover-tile-12-4"]
  check(hovering.reached and hovering.hover.present == 1 and hovering.hover.x == 12 and hovering.hover.y == 4 and hovering.tileTitle.begins_with("Pointer · (12, 4)")
    and hovering.selection.x == 9 and hovering.context == "tile", "The pointer over tile (12, 4) published the hover and the tile card shows it; the selection did not move")
  var over_bar: Dictionary = by_label["hover-over-bar"]
  check(over_bar.reached and over_bar.hover.present == 0 and over_bar.tileTitle.begins_with("Selected · (9, 8)"),
    "The pointer over a panel clears the hover, and the tile card is the selected tile's")
  var off_map: Dictionary = by_label["hover-off-map"]
  check(off_map.reached and off_map.hover.present == 0, "The pointer outside the map and outside the panels clears the hover")
  var on_panels: Dictionary = by_label["click-on-panels"]
  check(on_panels.panelClicks.all(func(row: Dictionary) -> bool: return row.present and row.heardBefore == row.heardAfter and row.heardAfter == row.heardAfterWheel and row.selectionBefore == row.selectionAfter),
    "A click and a tick of the wheel on a panel do not reach the World: it heard nothing and the selection stayed")
  var select_warrior: Dictionary = by_label["press-select-warrior"]
  check(select_warrior.pressed and select_warrior.reached and select_warrior.context == "warrior" and int(select_warrior.selection.unit) == 2,
    "A real press on the enabled action \"Select Warrior\" selected the Warrior")
  var fortify: Dictionary = by_label["press-fortify"]
  check(fortify.pressed and fortify.reached and int(fortify.callbacks.get("fortify", 0)) == fortify.fortifyCallsBefore + 1,
    "A real press on the enabled action \"Fortify\" fortified the Warrior, with one call to the game")
  var disabled: Dictionary = by_label["press-disabled-fortify"]
  var fortify_row: Array = disabled.actions.filter(func(row: Dictionary) -> bool: return row.key == "fortify-2")
  check(disabled.pressed and disabled.callbacksTotalBefore == disabled.callbacksTotalAfter and not fortify_row.is_empty() and not fortify_row[0].enabled
    and fortify_row[0].reason == "The unit is already fortified.", "A press on the disabled \"Fortify\" asked nothing of the game, and the HUD shows its reason")
  var menu: Dictionary = by_label["after-menu"]
  check(menu.menuPressed and menu.inMenu and menu.hoverInMenu.present == 0 and menu.newPressed and menu.back and menu.worldIndex < menu.layerIndex,
    "Through the menu and back, the World returned ahead of the HUD's layer in the tree")
  var after_menu: Dictionary = by_label["click-tile-after-menu"]
  check(after_menu.reached and after_menu.selection.x == 9 and after_menu.context == "tile", "After the menu, a real left click on a tile still selects it")
  var panels_after_menu: Dictionary = by_label["click-on-panels-after-menu"]
  check(panels_after_menu.panelClicks.all(func(row: Dictionary) -> bool: return row.present and row.heardBefore == row.heardAfter and row.heardAfter == row.heardAfterWheel and row.selectionBefore == row.selectionAfter),
    "After the menu, a click and a tick of the wheel on a panel still do not reach the World")
