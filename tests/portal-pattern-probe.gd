extends SceneTree

# The in-root portal pattern (examples/portal-pattern/App.jsx) in the real host. The fixture loads the example's own PortalProvider,
# Portal and scenario component and the example installs the provider with AppRegistry.setWrapperComponentProvider; this probe mounts
# actual FabricSurface roots of one FabricApplication in front of a Godot node that stands for the game's world, drives them with real
# Godot mouse events, and reads the native Controls the application mounted: where the dropdown's Controls sit in the tree, what clips
# them, who hears each press, what a closed portal and an unmounted root leave behind, and what the second root has of its own.
# The host's own snapshot gives the frames and texts, the scene tree gives the parents, the order, the clipping and the lifetimes, and the
# fixture's observation hook (the example's own) gives what the JS handlers counted. The oracle judges the raw report.
# Lanes: current (every check passes) and sabotage (a retained sabotage broke the example, so at least one check must fail).
const WINDOW := Vector2i(800, 500)
const SURFACE := Vector2(360, 440)
const OFFSETS := {"A": Vector2(20, 20), "B": Vector2(420, 20)}
const OPTIONS := ["Small", "Medium", "Large"]
const PORTAL_IDS := ["dropdown", "dropdown-header", "dropdown-context", "dropdown-live", "dropdown-item-Small", "dropdown-item-Medium",
  "dropdown-item-Large"]
# A point of the surface that no View covers: below the card and below the dropdown, in the root's empty area.
const EMPTY := Vector2(180, 390)
const WAIT_MS := 5000
const WAIT_AFTER_FAILURE_MS := 400

# The game's world: it hears what no surface claims, as the world of the pointer spike does (examples/world-input/world.gd).
class World extends Node:
  var received: Array = []

  func _unhandled_input(event: InputEvent) -> void:
    if event is InputEventMouseButton:
      received.append([event.position.x, event.position.y, int(event.button_index), event.pressed])

  func presses() -> Array:
    var list: Array = []
    for entry: Array in received:
      if int(entry[2]) == MOUSE_BUTTON_LEFT and entry[3]:
        list.append([entry[0], entry[1]])
    return list

var application: Node
var world: World
var surfaces := {}
var checks: Array = []
var stages := {}
var clicks: Array = []
var lane := "current"
var wait_limit := WAIT_MS

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

func settle(count := 4) -> void:
  for index in range(count):
    await process_frame

# Until a condition holds, polled one frame at a time. A hosted runner delivers slow, bursty frames, so what React commits is waited for, never
# counted in frames; only a check that nothing happens settles for a fixed number. After a wait that failed (a sabotaged example never
# draws what the probe waits for) the later waits are short, so that a broken lane ends in seconds and not in minutes.
func until(condition: Callable) -> bool:
  var started := Time.get_ticks_msec()
  while Time.get_ticks_msec() - started < wait_limit and not condition.call():
    await process_frame
  var held: bool = condition.call()
  if not held:
    wait_limit = WAIT_AFTER_FAILURE_MS
  return held

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(PortalPatternProbe." + expression + ")"))

func app_state() -> Dictionary:
  return JSON.parse_string(application.call("snapshot"))

func surface_state(name: String) -> Dictionary:
  return JSON.parse_string(surfaces[name].call("snapshot"))

func record(name: String) -> Dictionary:
  var state: Dictionary = js("state()")
  return state.roots.get(name, {})

# ---- the native tree ----
func control(name: String, id: String) -> Control:
  return (surfaces[name] as Node).find_child(id, true, false) as Control

func node(name: String, id: String) -> Dictionary:
  for entry: Dictionary in surface_state(name).nodes:
    if entry.testID == id:
      return entry
  return {}

func text_of(name: String, id: String) -> String:
  var entry := node(name, id)
  return str(entry.get("nativeText", entry.get("text", "")))

func count_of(name: String, id: String) -> int:
  return surface_state(name).nodes.filter(func(entry: Dictionary) -> bool: return entry.testID == id).size()

func rect_of(target: Control) -> Array:
  var rect := target.get_global_rect()
  return [rect.position.x, rect.position.y, rect.size.x, rect.size.y]

# Every Control under a surface, in tree order, with what the checks need: parent, index among siblings, clipping, mouse filter, global frame.
func tree_of(name: String) -> Array:
  var list: Array = []
  var pending: Array = [{"node": surfaces[name], "parent": 0}]
  while not pending.is_empty():
    var item: Dictionary = pending.pop_front()
    var current: Node = item.node
    list.append({"id": current.get_instance_id(), "name": String(current.name), "parent": item.parent, "index": current.get_index(),
      "clip": (current as Control).clip_contents, "filter": (current as Control).mouse_filter, "rect": rect_of(current as Control)})
    var children := current.get_children().filter(func(child: Node) -> bool: return child is Control)
    # Depth first: a node's children go in front of the nodes waiting.
    var expanded: Array = children.map(func(child: Node) -> Dictionary: return {"node": child, "parent": current.get_instance_id()})
    pending = expanded + pending
  return list

func stage_of(name: String) -> Dictionary:
  return {"nodes": surface_state(name).nodes, "tree": tree_of(name), "example": js("state()").roots.get(name, {}), "world": world.presses()}

# ---- real mouse input ----
func button_event(at: Vector2, pressed: bool) -> void:
  var event := InputEventMouseButton.new()
  event.position = at
  event.global_position = at
  event.button_index = MOUSE_BUTTON_LEFT
  event.pressed = pressed
  event.button_mask = MOUSE_BUTTON_MASK_LEFT if pressed else 0
  Input.parse_input_event(event)
  Input.flush_buffered_events()

func click(at: Vector2) -> void:
  var motion := InputEventMouseMotion.new()
  motion.position = at
  motion.global_position = at
  Input.parse_input_event(motion)
  Input.flush_buffered_events()
  button_event(at, true)
  await settle(2)
  button_event(at, false)
  await settle(2)

# A Control that is not there (a sabotaged example never draws the dropdown) has no center: the press goes to the window's corner, which no View
# covers, and the oracle judges it against the intent like any other.
func center_of(name: String, id: String) -> Vector2:
  var target := control(name, id)
  return target.get_global_rect().get_center() if target != null else Vector2(1.0, 1.0)

func kids(host: Control) -> int:
  return host.get_child_count() if host != null else -1

# A press, recorded with what each side of the pointer's route heard of it afterwards. The intent is what the probe means the press to be: the
# oracle works out from its own layout which View lies at the point, and requires that to be the intent and the outcome to follow from it.
func press(name: String, id: String, intent: String, at: Vector2, settled := Callable()) -> void:
  await click(at)
  if settled.is_valid():
    await until(settled)
  await settle(3)
  var seen := record(name)
  clicks.append({"id": id, "root": name, "intent": intent, "at": [at.x, at.y], "after": {"world": world.presses(),
    "rowPresses": seen.get("rowPresses", []), "choices": seen.get("choices", []), "picks": seen.get("picks", 0),
    "open": control(name, "dropdown") != null, "status": text_of(name, "portal-status"), "live": text_of(name, "dropdown-live")}})

# ---- mounting ----
func mount(name: String, props: Dictionary) -> void:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = name
  surface.position = OFFSETS[name]
  surface.size = SURFACE
  surface.set("application_path", NodePath("../PortalApplication"))
  surface.set("component_name", "PortalPatternExample")
  surface.set("initial_props", props)
  surfaces[name] = surface
  root.add_child(surface)
  await until(func() -> bool: return int(surface.call("get_surface_id")) > 0 and control(name, "portal-pick") != null and not node(name, "portal-status").is_empty())
  await settle(4)

func open_dropdown(name: String, id: String) -> void:
  await press(name, id, "pick", center_of(name, "portal-pick"), func() -> bool: return control(name, "dropdown") != null and control(name, "dropdown-item-Large") != null)
  await settle(4)

# A row press has settled when the example counted it, the status line shows the count and, while the dropdown is open, so does the dropdown.
func row_settled(name: String, count: int) -> Callable:
  return func() -> bool:
    var shown := text_of(name, "portal-status").ends_with("rows pressed: %d" % count)
    var open := control(name, "dropdown") != null
    return (record(name).get("rowPresses", []).size() == count and shown and (not open or text_of(name, "dropdown-live").ends_with("rows: %d" % count)))

func empty_point(name: String) -> Vector2:
  return OFFSETS[name] + EMPTY

# ---- the probe ----
func run_probe() -> void:
  root.size = WINDOW
  world = World.new()
  world.name = "World"
  root.add_child(world)
  application = ClassDB.instantiate("FabricApplication")
  application.name = "PortalApplication"
  application.set("bundle_path", "res://build/portal-pattern-probe.js")
  root.add_child(application)

  await mount("A", {"name": "A"})
  var setup: Dictionary = js("state()")
  stages.setup = {"window": [WINDOW.x, WINDOW.y], "surface": [SURFACE.x, SURFACE.y], "offsets": {"A": [OFFSETS.A.x, OFFSETS.A.y], "B": [OFFSETS.B.x, OFFSETS.B.y]},
    "layout": setup.layout, "options": setup.options, "accent": setup.accent, "keys": js("keys()")}
  var closed_a := stage_of("A")
  stages.A = {"closed": closed_a}
  var host_a := control("A", "portal-host")
  var scroll_a := control("A", "portal-scroll")
  var root_a: Control = host_a.get_parent() as Control if host_a != null else null

  # Placement of the host, before anything opens.
  check((host_a != null and count_of("A", "portal-host") == 1 and root_a != null and host_a.get_index() == root_a.get_child_count() - 1
    and host_a.get_global_rect() == root_a.get_global_rect() and not host_a.clip_contents),
    "placement/The wrapper provider put one host View in the root, the last child of the root's own View, filling it and not clipping")
  check((host_a != null and host_a.mouse_filter == Control.MOUSE_FILTER_IGNORE and root_a != null and root_a.mouse_filter == Control.MOUSE_FILTER_IGNORE),
    "placement/The host's Control and the root's ignore the mouse: pointerEvents box-none, so the GUI never stops a press on empty area")
  check(host_a != null and kids(host_a) == 0 and PORTAL_IDS.all(func(id: String) -> bool: return count_of("A", id) == 0),
    "lifecycle/Closed, the host holds no Controls: a Portal draws nothing until it mounts")

  # Open the dropdown from the Pick button in the ScrollView.
  await open_dropdown("A", "A/pick-open")
  var open_a := stage_of("A")
  stages.A.open = open_a
  var dropdown_a := control("A", "dropdown")
  var opened := dropdown_a != null
  var family_a := PORTAL_IDS.map(func(id: String) -> Control: return control("A", id))
  check((opened and family_a.all(func(entry: Control) -> bool: return entry != null and entry.get_parent() == host_a)
    and kids(host_a) == PORTAL_IDS.size()
    and not scroll_a.is_ancestor_of(dropdown_a) and not control("A", "portal-card").is_ancestor_of(dropdown_a)),
    "placement/The dropdown's Controls are the children of the root's host View, and of nothing in the ScrollView or the card")
  # Godot draws siblings in tree order and a Control after its parent: the host's subtree is last when every Control of the surface that is not in
  # it, and is not the host, the root's View or the surface, comes before the host in the tree's depth-first order.
  var later := opened
  if opened:
    var order: Array = open_a.tree.map(func(entry: Dictionary) -> int: return int(entry.id))
    var at: int = order.find(host_a.get_instance_id())
    for entry: Dictionary in open_a.tree:
      var id := int(entry.id)
      var other: Node = instance_from_id(id)
      if id != host_a.get_instance_id() and id != root_a.get_instance_id() and id != surfaces.A.get_instance_id() and not host_a.is_ancestor_of(other):
        later = later and order.find(id) < at
  check(opened and later and host_a.get_index() == root_a.get_child_count() - 1,
    "placement/The host and the portal's Controls in it come after every other Control of the root in tree order, so Godot draws them last")
  var pick_rect := control("A", "portal-pick").get_global_rect()
  check((opened and dropdown_a.get_global_rect().position == Vector2(pick_rect.end.x - 160.0, pick_rect.end.y + 4.0)
    and dropdown_a.get_global_rect().size == Vector2(160.0, 160.0)),
    "placement/The dropdown sits under the trigger with its right edge on the trigger's, the position the trigger measured with measureInWindow")
  var clipped_by := []
  var walk: Node = dropdown_a.get_parent() if opened else null
  while walk != null and walk is Control:
    if (walk as Control).clip_contents and not (walk as Control).get_global_rect().encloses(dropdown_a.get_global_rect()):
      clipped_by.append(String(walk.name))
    walk = walk.get_parent()
  check(scroll_a != null and scroll_a.clip_contents, "clipping/The ScrollView's Control clips its contents, the clip the dropdown has to escape")
  check((opened and dropdown_a.get_global_rect().end.y > scroll_a.get_global_rect().end.y and clipped_by.is_empty()
    and not host_a.clip_contents),
    "clipping/The dropdown reaches past the ScrollView's clip rectangle and no ancestor of it clips any part of it")
  var context_a := record("A")
  check((text_of("A", "dropdown-context") == "context: none" and context_a.get("triggerAccent") == stages.setup.accent
    and context_a.get("portalAccent") == "none" and text_of("A", "dropdown-live").begins_with("prop: " + str(stages.setup.accent))),
    "context/The trigger's Context does not reach the portal's content, which renders under the host's providers; a prop carries the value")

  # Presses while the dropdown is open.
  await press("A", "A/row-0-while-open", "row:0", center_of("A", "portal-row-0"), row_settled("A", 1))
  stages.A.rowWhileOpen = stage_of("A")
  await press("A", "A/world-while-open", "world", empty_point("A"))
  stages.A.worldWhileOpen = stage_of("A")
  var header_at := center_of("A", "dropdown-header") + Vector2(40, 0)
  await press("A", "A/header", "dropdown-body", header_at)
  stages.A.header = stage_of("A")
  await press("A", "A/row-3-outside", "row:3", Vector2(OFFSETS.A.x + 80, center_of("A", "portal-row-3").y), row_settled("A", 2))
  stages.A.rowOutside = stage_of("A")
  var live_text := text_of("A", "dropdown-live")
  check(live_text.ends_with("rows: 2") and control("A", "dropdown") != null,
    "lifecycle/The portal's content updates while it is open: the dropdown shows the row count as the state changes, and stays open")

  # An item press.
  await press("A", "A/item-large", "item:Large", center_of("A", "dropdown-item-Large"), func() -> bool: return control("A", "dropdown") == null)
  await until(func() -> bool: return text_of("A", "portal-row-label-2") == "Size: Large")
  stages.A.chosen = stage_of("A")
  check((control("A", "dropdown") == null and kids(host_a) == 0 and PORTAL_IDS.all(func(id: String) -> bool: return count_of("A", id) == 0)
    and text_of("A", "portal-row-label-2") == "Size: Large"),
    "lifecycle/Choosing an item closes the dropdown: the portal's Controls leave the host and the row shows the choice")

  # The area the dropdown covered, once closed, and the world.
  var under_at := Vector2(OFFSETS.A.x + 200, center_of("A", "portal-row-3").y)
  await press("A", "A/row-3-under-closed", "row:3", under_at, row_settled("A", 3))
  stages.A.underClosed = stage_of("A")
  await press("A", "A/world-closed", "world", empty_point("A"))
  stages.A.worldClosed = stage_of("A")

  # Per input: the clicks as a whole are judged by the oracle; the probe's own verdicts follow from the same counters.
  var by_id := {}
  for entry: Dictionary in clicks:
    by_id[entry.id] = entry
  var row_open: Dictionary = by_id["A/row-0-while-open"].after
  check((row_open.rowPresses.size() == 1 and int(row_open.rowPresses[0]) == 0 and row_open.open and row_open.world.is_empty()),
    "input/A press on a row outside the open dropdown reaches that row, leaves the dropdown open and does not reach the world")
  var world_open: Dictionary = by_id["A/world-while-open"].after
  check(world_open.world.size() == 1 and world_open.open and world_open.rowPresses.size() == 1,
    "input/With the dropdown open, a press on the surface's empty area passes through the host to the world and reaches no View")
  var header: Dictionary = by_id["A/header"].after
  check(header.world.size() == 1 and header.open and header.rowPresses.size() == 1,
    "input/A press on the dropdown's header, which has no handler, reaches neither the row beneath it nor the world: the dropdown is opaque")
  var item: Dictionary = by_id["A/item-large"].after
  check((item.choices == ["Large"] and not item.open and item.rowPresses.size() == 2 and item.world.size() == 1 and int(item.picks) == 1),
    "input/An item press, a real mouse press, reaches the item: it chooses Large and closes, and reaches neither the row below nor the world")
  var under: Dictionary = by_id["A/row-3-under-closed"].after
  check((under.rowPresses.size() == 3 and int(under.rowPresses[2]) == 3 and under.world.size() == 1),
    "input/Once the dropdown is closed, a press where it was reaches the row under that area")
  var world_closed: Dictionary = by_id["A/world-closed"].after
  check(world_closed.world.size() == 2 and world_closed.rowPresses.size() == 3,
    "input/With the dropdown closed, a press on the surface's empty area passes through the box-none host to the world")

  # The second root.
  await mount("B", {"name": "B"})
  stages.B = {"closed": stage_of("B")}
  var host_b := control("B", "portal-host")
  check((host_b != null and host_b != host_a and count_of("B", "portal-host") == 1 and kids(host_b) == 0
    and host_b.get_global_rect().position == OFFSETS.B),
    "roots/A second root has a host of its own, empty and at its own place, though a portal exists in the first")
  await open_dropdown("A", "A/pick-reopen")
  await open_dropdown("B", "B/pick-open")
  stages.A.reopened = stage_of("A")
  stages.B.open = stage_of("B")
  var dropdown_b := control("B", "dropdown")
  var dropdown_a2 := control("A", "dropdown")
  var family_b := PORTAL_IDS.map(func(id: String) -> Control: return control("B", id))
  check((dropdown_b != null and dropdown_a2 != null and dropdown_a2 != dropdown_b
    and family_b.all(func(entry: Control) -> bool: return entry != null and entry.get_parent() == host_b)
    and kids(host_b) == PORTAL_IDS.size() and kids(host_a) == PORTAL_IDS.size()
    and dropdown_b.get_global_rect().position.x >= OFFSETS.B.x and dropdown_a2.get_global_rect().end.x <= OFFSETS.B.x),
    "roots/A portal opened in one root is drawn by that root's host alone: each host holds exactly its own dropdown, which never appears in the other root")
  await press("B", "B/item-small", "item:Small", center_of("B", "dropdown-item-Small"), func() -> bool: return control("B", "dropdown") == null)
  await until(func() -> bool: return text_of("B", "portal-row-label-2") == "Size: Small")
  stages.B.chosen = stage_of("B")
  stages.A.afterB = stage_of("A")
  check((text_of("B", "portal-row-label-2") == "Size: Small" and text_of("A", "portal-row-label-2") == "Size: Large"
    and control("A", "dropdown") != null and control("B", "dropdown") == null and kids(host_a) == PORTAL_IDS.size()),
    "roots/State is per root: choosing in the second root changes its row alone, and the first root's dropdown stays open")

  # Unmounting a root with an open portal.
  await open_dropdown("B", "B/pick-reopen")
  var ids_b: Array = tree_of("B").map(func(entry: Dictionary) -> int: return int(entry.id))
  var hosts_before: int = root.find_children("portal-host", "Control", true, false).size()
  stages.B.beforeUnmount = stage_of("B")
  surfaces.B.call("unmount")
  await until(func() -> bool: return int(surfaces.B.call("get_surface_id")) == 0 and ids_b.all(func(id: int) -> bool: return not is_instance_id_valid(id) or id == surfaces.B.get_instance_id()))
  await settle(4)
  var retired_b := surface_state("B")
  var dropdowns_after: int = root.find_children("dropdown", "Control", true, false).size()
  var hosts_after: int = root.find_children("portal-host", "Control", true, false).size()
  var leaked: Array = ids_b.filter(func(id: int) -> bool: return is_instance_id_valid(id) and id != surfaces.B.get_instance_id() and instance_from_id(id) is Control and not (instance_from_id(id) as Control).is_queued_for_deletion())
  stages.unmountB = {"hostsBefore": hosts_before, "hostsAfter": hosts_after, "dropdownsAfter": dropdowns_after, "leaked": leaked.size(), "retired": {
    "nativeTags": retired_b.get("nativeTags"), "creates": retired_b.get("creates"), "deletes": retired_b.get("deletes")},
    "surfaceId": int(surfaces.B.call("get_surface_id")), "rootCount": int(app_state().rootCount), "A": stage_of("A")}
  check((hosts_before == 2 and hosts_after == 1 and leaked.is_empty() and dropdowns_after == 1 and int(retired_b.nativeTags) == 0
    and int(retired_b.creates) == int(retired_b.deletes) and control("A", "dropdown") != null and int(app_state().rootCount) == 1),
    "lifecycle/Unmounting a root with an open portal removes its host and the portal's Controls with none left over, and the other root keeps its own")

  await stop_case()
  await finish()

func stop_case() -> void:
  application.call("stop")
  await until(func() -> bool: return app_state().stopped and int(app_state().rootCount) == 0)
  var stopped := app_state()
  var hosts: int = root.find_children("portal-host", "Control", true, false).size()
  var portal_controls := 0
  for id: String in PORTAL_IDS:
    portal_controls += root.find_children(id, "Control", true, false).size()
  var balanced := true
  var state_a := surface_state("A")
  balanced = balanced and int(state_a.nativeTags) == 0 and int(state_a.creates) == int(state_a.deletes)
  stages.stop = {"application": {"stopped": stopped.stopped, "rootCount": stopped.rootCount, "errors": stopped.errors}, "hosts": hosts, "portalControls": portal_controls,
    "A": {"nativeTags": state_a.nativeTags, "creates": state_a.creates, "deletes": state_a.deletes}}
  check(stopped.stopped and int(stopped.rootCount) == 0 and stopped.errors.is_empty() and hosts == 0 and portal_controls == 0 and balanced,
    "lifecycle/Stopping the application removes every host and every portal Control, with the Controls created and deleted in balance and no diagnostic")

func finish() -> void:
  stages.clicks = clicks
  for surface: Control in surfaces.values():
    surface.queue_free()
  application.queue_free()
  world.queue_free()
  await settle(2)
  var failures: Array = checks.filter(func(entry: Dictionary) -> bool: return not entry.passed).map(func(entry: Dictionary) -> String: return entry.name)
  var report := {"scenario": "native-portal-pattern", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "lane": lane, "checks": checks, "stages": stages,
    "sabotageRejected": lane == "sabotage" and not failures.is_empty(), "allCurrentAssertionsPassed": failures.is_empty(),
    "scope": {"publicReactNativeImport": true, "wrapperComponentProvider": true, "actualFabricSurfaces": true, "oneApplication": true,
      "realMouseEvents": true, "worldBehindSurface": true, "createPortalInSdk": false, "portalLibraryCertified": false,
      "overlappingSurfaceInputCertified": false, "touchCertified": false}}
  var output := FileAccess.open("res://build/portal-pattern-report.json", FileAccess.WRITE)
  if not check(output != null, "report/The portal pattern report is saved with any failure visible"):
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  output.close()
  if lane == "sabotage":
    print("PORTAL_PATTERN_SABOTAGE_REJECTED: " + str(failures.size()) if not failures.is_empty() else "PORTAL_PATTERN_SABOTAGE_ACCEPTED")
    quit(0 if not failures.is_empty() else 1)
  else:
    print("PORTAL_PATTERN_PASSED: " + str(checks.size()) if failures.is_empty() else "PORTAL_PATTERN_FAILED")
    quit(0 if failures.is_empty() else 1)

func _initialize() -> void:
  var arguments := OS.get_cmdline_user_args()
  var at := arguments.find("--lane")
  if at >= 0 and at + 1 < arguments.size():
    lane = arguments[at + 1]
  call_deferred("run_probe")
