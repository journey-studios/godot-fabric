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
#   --capture    saves one PNG per context and one during the AI phase (a headed run)

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
  await run_input()


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
