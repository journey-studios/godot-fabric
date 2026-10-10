extends "res://stability_judge.gd"

# The stability probe, run with `-- --validate-stability` (tests/civ-lite-ui-native.test.mjs does, after the other two): each overlay is
# opened and closed twenty times, and what a leak would grow is measured at rest after every close and compared with the first cycle. It
# writes raw observations, which tests/civ-lite-stability-oracle.mjs judges again on its own. The helpers it shares with the other probes
# (the HUD's tree as the host reports it, waiting for state, the replay through the services, real pointer events, bursts) are in
# hud_probe.gd, and the checks it makes of what it observed are in stability_judge.gd.
#
#   icons    the Images the HUD mounts in four contexts (none, stack, settler, city): each must have drawn with no error, the city
#            screen's inside the Modal's window.
#   city     twenty cycles of two rounds: a real click on the city's tile opens the city screen and a real press on Close closes it; a
#            second click opens it and Escape closes it (`onRequestClose`, the game's `clear_selection`).
#   dialog   twenty cycles of a new game played through the services to turn 5, where the three events are raised, and answered by
#            real presses (sixty answers). The Modal stays mounted from the first event to the third answer, so a cycle is measured at
#            four rests: the dialog open, and after each answer. Escape on the open dialog does nothing.
#
# A measure waits for state (no pending work, no retiring tag, the Modals the screen has), then reads the host with the Hermes heap
# collected first (the validation meta the sampler uses): the nodes of the tree, the orphans, the objects, the Windows, the native views, the
# pointer routes, the registry's subscriptions and pending work, the HUD's connections, the signal's connections and the heap. Focus is read
# as the host can say it: the root viewport's owner, each Modal Window (exclusive, focused, its own owner) and every node that reports
# `focused`. The first and the last cycle of each screen also push 100 real left clicks, right clicks and wheel ticks at the map under the
# overlay; a headed run saves the pictures.
#
#   --capture    saves the bar, the actions and the city screen with their icons, and the city screen and the dialog at the first and the
#                last cycle (the same pixels, but for the first row of the bar, where the dialog's epoch is)

const CITY_STEP := 18
# The end_turn of the replay that raises the three events.
const EVENT_STEP := 44
const CITY_TILE := Vector2i(7, 8)
const COLLECT_META := "validation_collect_garbage_on_status"
# The HUD's telemetry keeps the last 64 results: the lists are filled before the first measure, so what they hold does not grow in a cycle.
const FILL := 70
# The limit of a wait for a screen to be at rest, in frames: a wait that reaches it is a screen that never rested, and it says so.
const REST_FRAMES := 150
# Once a screen has not come to rest within that limit, the next waits are short: the checks already say it, and a project that never rests
# (a Modal that stays open) would otherwise wait the limit out at every measure of the run.
const SHORT_REST_FRAMES := 10

var shot_names: Array = []
var rest_limit := REST_FRAMES


func flag() -> String:
  return "--validate-stability"


func report_path() -> String:
  return "res://civ-lite-stability-report.json"


func marker() -> String:
  return "CIVLITE_STABILITY"


func run_probe() -> void:
  await fill_telemetry()
  var base := await measure(0)
  var icons := await run_icons()
  var city := await run_city()
  var dialog := await run_dialog()
  report["base"] = base
  report["icons"] = icons
  report["city"] = city
  report["dialog"] = dialog
  report["captures"] = shot_names
  judge_icons(icons)
  judge_city(city, base)
  judge_dialog(dialog, base)
  if capture:
    judge_shots()
  # The run ends with no overlay open: the engine logs an error when the application quits with a Modal's window still mounted, which is
  # the host's and not what this probe measures.
  services.new_game()
  await settle()


# --- Reading the host ------------------------------------------------------------------------------------------------

func surface() -> Dictionary:
  var value: Variant = JSON.parse_string(hud.call("snapshot"))
  return value if value is Dictionary else {}


# The same reading with the Hermes heap collected first; only around a reading, as the performance sampler asks for it.
func collected() -> Dictionary:
  application.set_meta(COLLECT_META, true)
  var value := surface()
  application.remove_meta(COLLECT_META)
  return value


# The Modals the host has presented: a node of kind `modal` with a Window. (`modalRuntimeMembers` is not their number: it counts the
# runtimes in the modal stack, which is 1 for as long as the application runs, with a Modal open or not.)
func modal_nodes(seen: Dictionary) -> int:
  return seen.get("nodes", []).filter(func(entry: Dictionary) -> bool: return entry.kind == "modal" and entry.has("modalWindow")).size()


# Every Image the host mounted has settled: loaded and drawn, or failed with its error. One that is still loading (its decode is on a worker,
# at the machine's own pace) is not a state anyone may judge.
func images_settled(seen: Dictionary) -> bool:
  for entry: Dictionary in seen.get("nodes", []):
    if entry.kind != "image":
      continue
    var image: Dictionary = entry.get("image", {})
    var counters: Dictionary = image.get("counters", {})
    var status := str(image.get("status", ""))
    var failed := status == "failed" and int(counters.get("errors", 0)) >= 1
    var drawn := status == "loaded" and int(counters.get("loads", 0)) >= 1 and image.get("drawn") is Dictionary and int(counters.get("draws", 0)) > 0
    if not (failed or drawn):
      return false
  return true


# The state a screen at rest is judged in: nothing pending (work, timers, animation frames, host tasks, events, pointer contacts), no tag
# retiring, the Modals the screen has as presented nodes and as Windows, no orphan node, the host's views, tags and nodes the same, and every
# Image settled.
func at_rest(seen: Dictionary, modals: int) -> bool:
  var routing: Dictionary = seen.get("pointerRouting", {})
  var registry: Dictionary = seen.get("gameServices", {})
  var nodes: int = seen.get("nodes", []).size()
  return (int(seen.get("pendingWork", -1)) == 0 and int(seen.get("pendingTimers", -1)) == 0 and int(seen.get("pendingAnimationFrames", -1)) == 0
    and int(seen.get("retiringTags", -1)) == 0 and modal_nodes(seen) == modals and windows_in_tree() == modals
    and int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT)) == 0
    and int(routing.get("active", -1)) == 0 and int(routing.get("suppressed", -1)) == 0
    and int(registry.get("pendingHostTasks", -1)) == 0 and int(registry.get("pendingEvents", -1)) == 0
    and int(seen.get("nativeTags", -1)) == nodes and int(seen.get("performance", {}).get("counters", {}).get("nativeViews", -1)) == nodes
    and images_settled(seen))


# What a reading says is still moving: the engine's nodes, orphans and Windows, the host's counters of what it created and deleted, its views,
# the pointer routes and the registry. Two readings with the same signature are a screen nothing is still arriving at.
func rest_signature(seen: Dictionary) -> String:
  var counters: Dictionary = seen.get("performance", {}).get("counters", {})
  return str([get_tree().get_node_count(), int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT)), windows_in_tree(), counters.get("creates"),
    counters.get("deletes"), counters.get("nativeViews"), seen.get("nativeTags"), seen.get("retiringTags"), seen.get("pointerRouting"), seen.get("pointerProcessor"),
    seen.get("gameServices", {}).get("subscriptions"), services.snapshot_changed.get_connections().size()])


# Waits for the screen to come to rest by state, with `rest_limit` frames as the limit of the wait and not as its length: the state of
# `at_rest` in two readings running with the same signature. The result is whether it did.
func come_to_rest(modals: int) -> bool:
  var previous := ""
  for index in range(rest_limit):
    var seen := surface()
    var signature := rest_signature(seen)
    if signature == previous and at_rest(seen, modals):
      return true
    previous = signature
    await get_tree().process_frame
  var last := surface()
  var reached := rest_signature(last) == previous and at_rest(last, modals)
  if not reached:
    rest_limit = SHORT_REST_FRAMES
  return reached


func windows_in_tree() -> int:
  return get_tree().root.find_children("*", "Window", true, false).size()


func world_count() -> int:
  var count := 0
  for child in services.get_children():
    var script: Script = child.get_script()
    if script != null and script.resource_path.ends_with("/world/world.gd"):
      count += 1
  return count


func focus_owner(viewport: Viewport) -> int:
  var focused := viewport.gui_get_focus_owner()
  return focused.get_instance_id() if focused != null else 0


# What focus is, as this host can measure it: the root viewport's owner, each Modal Window of the snapshot (is it exclusive, does it have
# the focus, who owns the focus inside it) and every node that reports `focused`, with whether it is in a Modal's window.
func focus_state(seen: Dictionary) -> Dictionary:
  var modals: Array = []
  var focused: Array = []
  for entry: Dictionary in seen.get("nodes", []):
    if entry.kind == "modal" and entry.has("modalWindow"):
      var window := instance_from_id(int(entry.modalWindow.id)) as Window
      modals.append({"id": int(entry.modalWindow.id), "exclusive": bool(entry.modalWindow.exclusive), "visible": bool(entry.modalWindow.visible),
        "windowFocus": window != null and window.has_focus(), "owner": focus_owner(window) if window != null else -1})
    if bool(entry.get("focused", false)):
      var control := instance_from_id(int(entry.id)) as Control
      focused.append({"testID": entry.testID, "modal": control != null and control.get_window() != get_tree().root})
  return {"root": focus_owner(get_tree().root), "rootWindow": get_tree().root.has_focus(), "modals": modals, "focused": focused}


# The Images the HUD mounts: where each is, whether it drew, with what counters and from which asset.
func images_of(seen: Dictionary) -> Array:
  var rows: Array = []
  for entry: Dictionary in seen.get("nodes", []):
    if entry.kind != "image":
      continue
    var control := instance_from_id(int(entry.id)) as Control
    var image: Dictionary = entry.get("image", {})
    var counters: Dictionary = image.get("counters", {})
    var source: Dictionary = image.get("source", {})
    rows.append({"testID": entry.testID, "visible": control != null and control.is_visible_in_tree(),
      "modal": control != null and control.get_window() != get_tree().root, "drawn": image.get("drawn") is Dictionary, "status": str(image.get("status", "")),
      "draws": int(counters.get("draws", 0)), "loads": int(counters.get("loads", 0)), "errors": int(counters.get("errors", -1)), "error": str(image.get("error", "")),
      "uri": str(source.get("uri", "")), "width": float(entry.width), "height": float(entry.height)})
  return rows


# One measure at rest: it waits for the state a screen at rest has, reads the host with the heap collected, and records every number a
# leak would grow beside the focus.
func measure(modals: int) -> Dictionary:
  var rested := await come_to_rest(modals)
  var seen := collected()
  var counters: Dictionary = seen.get("performance", {}).get("counters", {})
  var heap: Dictionary = seen.get("performance", {}).get("hermes", {})
  var routing: Dictionary = seen.get("pointerRouting", {})
  var processor: Dictionary = seen.get("pointerProcessor", {})
  var registry: Dictionary = seen.get("gameServices", {})
  var stats := hud_stats()
  return {"rested": rested and at_rest(seen, modals), "expectedModals": modals, "context": game_snapshot().context,
    "nodes": get_tree().get_node_count(), "orphans": int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT)),
    "objects": int(Performance.get_monitor(Performance.OBJECT_COUNT)), "windows": windows_in_tree(),
    "nativeViews": int(counters.get("nativeViews", -1)), "nativeTags": int(seen.get("nativeTags", -1)), "surfaceNodes": seen.get("nodes", []).size(),
    "liveRoots": int(counters.get("liveRoots", -1)), "retiringTags": int(seen.get("retiringTags", -1)), "modalNodes": modal_nodes(seen),
    "modalMembers": int(seen.get("modalRuntimeMembers", -1)),
    "creates": int(counters.get("creates", -1)), "deletes": int(counters.get("deletes", -1)),
    "pendingWork": int(seen.get("pendingWork", -1)), "pendingTimers": int(seen.get("pendingTimers", -1)),
    "pendingAnimationFrames": int(seen.get("pendingAnimationFrames", -1)),
    "pointerStored": int(routing.get("stored", -1)), "pointerSuppressed": int(routing.get("suppressed", -1)), "pointerContacts": int(routing.get("contacts", -1)),
    "pointerActive": int(routing.get("active", -1)), "pointerHover": int(routing.get("hoverPointers", -1)),
    "processorActive": int(processor.get("active", -1)), "processorPendingCapture": int(processor.get("pendingCapture", -1)),
    "processorActiveCapture": int(processor.get("activeCapture", -1)), "processorHover": int(processor.get("hover", -1)),
    "bindings": int(registry.get("bindings", -1)), "subscriptions": int(registry.get("subscriptions", -1)),
    "pendingHostTasks": int(registry.get("pendingHostTasks", -1)), "pendingEvents": int(registry.get("pendingEvents", -1)),
    "hudSubscriptions": int(stats.get("subscriptions", -1)), "connections": services.snapshot_changed.get_connections().size(),
    "hoverConnections": services.hover_changed.get_connections().size(), "worlds": world_count(), "epoch": int(services.epoch),
    "errors": seen.get("errors", []).size() + registry.get("errors", []).size() + int(stats.get("problemCount", 0)),
    "heap": int(heap.get("heap", {}).get("hermes_allocatedBytes", 0)), "collected": bool(heap.get("collectedBeforeReading", false)),
    "focus": focus_state(seen)}


# The telemetry's lists keep the last 64 entries and grow until then: fill them, so that the heap at rest is not their growth.
func fill_telemetry() -> void:
  services.new_game()
  await settle()
  var start := int(hud_stats().resultCount)
  for index in range(FILL):
    application.call("evaluate", "FrontierHud.send(\"clear_selection\", [])")
  var filled := await wait_until(func() -> bool: return int(hud_stats().resultCount) >= start + FILL)
  # The bar shows the last refusal ("Nothing is selected."): two calls the game accepts take it off.
  application.call("evaluate", "FrontierHud.send(\"select_unit\", [1])")
  application.call("evaluate", "FrontierHud.send(\"clear_selection\", [])")
  filled = await wait_until(func() -> bool: return int(hud_stats().resultCount) >= start + FILL + 2) and filled
  report["fill"] = {"filled": filled, "kept": hud_stats().results.size()}
  await settle()


# --- Driving ---------------------------------------------------------------------------------------------------------

# The Window that is exclusive in the snapshot: the Modal's.
func modal_window() -> Window:
  for entry: Dictionary in surface().get("nodes", []):
    if entry.kind == "modal" and entry.has("modalWindow") and bool(entry.modalWindow.exclusive):
      return instance_from_id(int(entry.modalWindow.id)) as Window
  return null


# The three bursts at the map under an overlay. The input events they push are freed over the next frames, not at once: what follows is
# measured once the engine's object count is back to what it was before.
func burst_all() -> Array:
  var before := int(Performance.get_monitor(Performance.OBJECT_COUNT))
  var rows := await bursts()
  await wait_until(func() -> bool: return int(Performance.get_monitor(Performance.OBJECT_COUNT)) <= before, rest_limit)
  return rows


func city_closed() -> bool:
  return game_snapshot().context == "none" and not shown(observe(), "hud-city")


# The first row of the bar: the turn, the phase and the three resources with their icons. The digits of the epoch (the dialog's game has its
# own) move what is to their right, so a picture is compared with another without this row.
func bar_row() -> Array:
  var row := Rect2()
  for id in ["hud-bar-turn", "hud-bar-phase", "hud-bar-food", "hud-bar-production", "hud-bar-science", "hud-bar-food-icon", "hud-bar-production-icon", "hud-bar-science-icon"]:
    var control := control_of(id)
    if control != null:
      row = control.get_global_rect() if row.size == Vector2.ZERO else row.merge(control.get_global_rect())
  return [row.position.x, row.position.y, row.size.x, row.size.y]


# A picture of the screen as it is, kept under `key` with the place of the bar's first row, which a later picture is compared without.
func shot(file: String, key: String = "") -> void:
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  var saved := image != null and image.save_png("res://" + file) == OK
  check(saved, "Capture saved: " + file.trim_prefix("civ-lite-stability-").trim_suffix(".png"))
  if saved:
    shot_names.append(file)
    if key != "":
      shots[key] = image
      masks[key] = bar_row()


# --- Icons -----------------------------------------------------------------------------------------------------------

# What the HUD shows now, as the game says it and as the host reports its Images.
func icons_now(label: String, modals: int) -> Dictionary:
  var rested := await come_to_rest(modals)
  var snapshot := game_snapshot()
  var actions: Array = snapshot.actions.map(func(action: Dictionary) -> Dictionary: return {"id": action.id, "args": action.args})
  var units: Array = snapshot.tile.units.map(func(unit: Dictionary) -> Dictionary: return {"id": unit.id, "kind": unit.kind})
  var items: Array = snapshot.city.items.map(func(item: Dictionary) -> String: return item.id)
  return {"label": label, "rested": rested, "snapshot": {"context": snapshot.context, "actions": actions, "tile": {"city": snapshot.tile.city, "irrigated": snapshot.tile.get("irrigated", 0), "units": units}, "cityItems": items},
    "images": images_of(surface())}


func run_icons() -> Array:
  var seen: Array = []
  services.new_game()
  await settle()
  seen.append(await icons_now("none", 0))
  if capture:
    await shot("civ-lite-stability-bar.png")
  await click_at(tile_centre(6, 8))
  await wait_until(func() -> bool: return game_snapshot().context == "stack")
  await settle()
  seen.append(await icons_now("stack", 0))
  var selected := await press("hud-actions-select_unit-1")
  await wait_until(func() -> bool: return game_snapshot().context == "settler")
  await settle()
  var settler := await icons_now("settler", 0)
  settler["pressed"] = selected
  seen.append(settler)
  if capture:
    await shot("civ-lite-stability-actions.png")
  await play_to(CITY_STEP)
  seen.append(await icons_now("city", 1))
  if capture:
    await shot("civ-lite-stability-city.png")
  await press("hud-city-close")
  await wait_until(city_closed)
  await settle()
  return seen


func icon_drew(image: Dictionary) -> bool:
  return image.visible and image.drawn and image.errors == 0 and image.error == "" and image.draws > 0 and image.loads == 1


func judge_icons(seen: Array) -> void:
  var every: Array = []
  for entry: Dictionary in seen:
    every.append_array(entry.images)
  check(not every.is_empty() and seen.all(func(entry: Dictionary) -> bool: return entry.rested) and every.all(icon_drew), "Icons: every Image the HUD mounted in the none, stack, settler and city contexts is visible and drew once loaded, with no error")
  var modal_images: Array = seen[3].images.filter(func(image: Dictionary) -> bool: return image.modal)
  check(seen[3].snapshot.context == "city" and modal_images.size() == 1 + seen[3].snapshot.cityItems.size() and modal_images.all(icon_drew),
    "Icons: the city screen's icon and its production items' icons are Images inside the Modal's window, and they drew")
  check(seen[0].images.size() == 3 and seen[1].images.size() > 3 and seen[2].images.size() > 3 and seen[2].pressed,
    "Icons: the bar has its three resource icons in every context, and the actions and the tile card add theirs")


# --- The city screen -------------------------------------------------------------------------------------------------

func city_round(cycle: int, how: String) -> Dictionary:
  var before := await measure(0)
  await click_at(tile_centre(CITY_TILE.x, CITY_TILE.y))
  var opened := await wait_until(func() -> bool: return game_snapshot().context == "city" and shown(observe(), "hud-city"))
  await settle()
  var row := {"cycle": cycle, "how": how, "before": before, "opened": opened, "open": await measure(1), "openImages": images_of(surface())}
  if cycle in BURST_CYCLES and how == "close":
    row["blocking"] = await burst_all()
    if capture:
      await shot("civ-lite-stability-city-%d.png" % cycle, "city-%d" % cycle)
  var clears := int(services.callbacks.get("clear_selection", 0))
  var pressed := true
  if how == "escape":
    await press_escape()
  else:
    pressed = await press("hud-city-close")
  row["pressed"] = pressed
  row["closed"] = await wait_until(city_closed)
  await settle()
  row["clearCalls"] = int(services.callbacks.get("clear_selection", 0)) - clears
  row["after"] = await measure(0)
  return row


func run_city() -> Dictionary:
  await play_to(CITY_STEP)
  await press("hud-city-close")
  await wait_until(city_closed)
  await settle()
  var rounds: Array = []
  for cycle in range(1, CYCLES + 1):
    for how in ["close", "escape"]:
      rounds.append(await city_round(cycle, how))
  return {"rounds": rounds}


# --- The event dialog ------------------------------------------------------------------------------------------------

func answer_head(index: int) -> Dictionary:
  var head: Dictionary = game_snapshot().dialog
  var pick: String = head.choices[PICKS[index]].id if head.choices.size() > PICKS[index] else ""
  var resolves := int(services.callbacks.get("resolve_event", 0))
  var pressed := await press("hud-dialog-choice-" + pick)
  var moved := await wait_until(func() -> bool: return game_snapshot().dialog.open == 0 or game_snapshot().dialog.id != head.id)
  await settle()
  return {"event": head.id, "pick": pick, "pressed": pressed, "moved": moved, "resolveCalls": int(services.callbacks.get("resolve_event", 0)) - resolves,
    "after": await measure(1 if index < PICKS.size() - 1 else 0)}


# Escape on the open dialog: the Window hears it, and nothing changes (the event has to be answered).
func escape_on_dialog() -> Dictionary:
  var window := modal_window()
  var heard := [0]
  var listener := func(event: InputEvent) -> void:
    if event is InputEventKey and event.pressed and event.keycode == KEY_ESCAPE:
      heard[0] += 1
  if window != null:
    window.window_input.connect(listener)
  var head: Dictionary = game_snapshot().dialog.duplicate(true)
  var hash_before: String = services.game.state_hash()
  var calls := total_calls()
  var windows := windows_in_tree()
  await press_escape()
  await come_to_rest(1)
  if window != null and is_instance_valid(window):
    window.window_input.disconnect(listener)
  var after: Dictionary = game_snapshot().dialog
  return {"heard": heard[0], "sameHead": after.id == head.id and after.index == head.index, "context": game_snapshot().context,
    "unchanged": services.game.state_hash() == hash_before and total_calls() == calls, "windows": windows_in_tree() - windows, "stillOpen": shown(observe(), "hud-dialog")}


func dialog_cycle(cycle: int) -> Dictionary:
  services.new_game()
  await settle()
  for index in range(EVENT_STEP):
    await play_step(index)
  await settle()
  var before := await measure(0)
  await play_step(EVENT_STEP)
  var opened := await wait_until(func() -> bool: return game_snapshot().context == "dialog" and shown(observe(), "hud-dialog"))
  await settle()
  var row := {"cycle": cycle, "before": before, "opened": opened, "open": await measure(1)}
  if cycle in BURST_CYCLES:
    row["blocking"] = await burst_all()
    if capture:
      await shot("civ-lite-stability-dialog-%d.png" % cycle, "dialog-%d" % cycle)
  row["escape"] = await escape_on_dialog()
  var answers: Array = []
  for index in range(PICKS.size()):
    answers.append(await answer_head(index))
  row["answers"] = answers
  return row


func run_dialog() -> Dictionary:
  var cycles: Array = []
  for cycle in range(1, CYCLES + 1):
    cycles.append(await dialog_cycle(cycle))
  return {"cycles": cycles}
