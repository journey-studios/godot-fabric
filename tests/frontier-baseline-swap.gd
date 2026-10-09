extends RefCounted

# The panel swap of the Frontier baseline, shared by the headless probe (frontier-baseline-probe.gd) and the windowed one
# (frontier-baseline-graphics-probe.gd): the scene of the pointer spike with the HUD of tests/frontier-baseline-fixture.jsx,
# and one swap made the way a player makes it, by a real click on the button of the panel. The click is the pointer spike's
# own injection (tests/world-input-driver.gd, preloaded and not copied): a motion, a press and a release through
# Input.parse_input_event, delivered at once by Input.flush_buffered_events.
#
# A swap is measured and never paced by the probe. It records, in process frames and in microseconds, from the flush of the
# click to the moment the SceneTree holds the nodes of the base and of the new panel (a count the engine keeps, which costs
# nothing to read at every frame); only then it reads the Surface's snapshot, which weighs about a hundred nodes, to confirm that
# the last node of the new panel is there and the root of the old one is not. Nothing heavy is read between the flush and that
# moment, nor in the two frames after it, so the frame intervals it records hold the work of the swap and not the probe's.
const Driver := preload("res://tests/world-input-driver.gd")
const Sampler := preload("res://tests/performance-sampler.gd")

# The experiment, as tests/frontier-baseline-cases.mjs states it (the oracle checks that the probe ran these).
const PANELS := ["units", "city", "research", "empty"]
const NATIVE_NODES := {"units": 50, "city": 75, "research": 100, "empty": 0}
const BASE_NATIVE_NODES := 12
const TAB_LEFT := 20.0
const TAB_TOP := 8.0
const TAB_STEP := 120.0
const TAB_WIDTH := 100.0
const TAB_HEIGHT := 28.0
const TOUR := ["empty", "units", "empty", "city", "empty", "research", "units", "city", "research", "city", "units", "research", "empty"]
const WARMUP_ROUNDS := 2
const ROUNDS := 30
const STABLE_FRAMES := 6
# The frames the swap waits after the arrival before it reads the snapshot, so that the read is not inside the frames it measures.
const TRAILING_FRAMES := 2
# Bounds on a wait for a state, never a measure: a state that never comes ends the wait, and a click whose panel does not show within
# ARRIVAL_FRAMES ends the run (what follows would start from a state nobody knows).
const ARRIVAL_FRAMES := 60
const FRAME_LIMIT := 600

var tree: SceneTree
var scene: Node
var world: Node2D
var app: Node
var surface: Control
var driver: Driver
var sampler: Sampler
# The SceneTree's nodes with the base shown (no panel), once the scene is quiet.
var base_nodes := 0
# The time of every frame the windowed lane drew, when it asked for them.
var draw_stamps: Array = []

func _init(scene_tree: SceneTree, scene_root: Node, sampler_in: Sampler) -> void:
  tree = scene_tree
  scene = scene_root
  world = scene.get_node("World")
  app = scene.get_node("Application")
  surface = scene.get_node("Hud/Surface")
  driver = Driver.new(world, app, [surface])
  sampler = sampler_in

# The windowed lane records when each frame was drawn: the first draw after a click is the first image that can show the panel.
func track_draws() -> void:
  RenderingServer.frame_post_draw.connect(note_draw)

func untrack_draws() -> void:
  RenderingServer.frame_post_draw.disconnect(note_draw)

func note_draw() -> void:
  draw_stamps.append(Time.get_ticks_usec())

static func tab_center(panel: String) -> Vector2:
  return Vector2(TAB_LEFT + TAB_STEP * PANELS.find(panel) + TAB_WIDTH / 2.0, TAB_TOP + TAB_HEIGHT / 2.0)

func settle(count: int) -> void:
  for index in range(count):
    await tree.process_frame

# What the application's snapshot says between two frames, without a collection of Hermes' heap and without the windows: the
# counters, the pending work and the time and samples the pump and its phases have accumulated.
func light() -> Dictionary:
  var state := sampler.app_state()
  var perf: Dictionary = state.get("performance", {})
  var counters: Dictionary = perf.get("counters", {})
  var errors: Array = state.get("errors", [])
  var out := {"commits": Sampler.number(counters.get("commits")), "creates": Sampler.number(counters.get("creates")),
    "deletes": Sampler.number(counters.get("deletes")), "updates": Sampler.number(counters.get("updates")),
    "nativeViews": Sampler.number(counters.get("nativeViews")), "pendingWork": Sampler.number(state.get("pendingWork")),
    "pendingTimers": Sampler.number(state.get("pendingTimers")), "pendingAnimationFrames": Sampler.number(state.get("pendingAnimationFrames")),
    "errors": errors.size(), "pump": {"count": Sampler.number(Sampler.dig(perf, ["pump", "count"])),
      "totalMs": Sampler.number(Sampler.dig(perf, ["pump", "totalMs"]))}}
  for name: String in ["js", "mount", "layout"]:
    out[name] = {"count": Sampler.number(Sampler.dig(perf, ["phases", name, "count"])), "totalMs": Sampler.number(Sampler.dig(perf, ["phases", name, "totalMs"]))}
  return out

# What the host did between two light readings.
static func host_delta(before: Dictionary, after: Dictionary) -> Dictionary:
  var out := {}
  for name: String in ["commits", "creates", "deletes", "updates"]:
    out[name] = Sampler.number(after.get(name)) - Sampler.number(before.get(name))
  for name: String in ["pump", "js", "mount", "layout"]:
    out[name + "Ms"] = Sampler.number(Sampler.dig(after, [name, "totalMs"])) - Sampler.number(Sampler.dig(before, [name, "totalMs"]))
    out[name + "Count"] = Sampler.number(Sampler.dig(after, [name, "count"])) - Sampler.number(Sampler.dig(before, [name, "count"]))
  return out

static func light_key(reading: Dictionary) -> String:
  return JSON.stringify([reading.commits, reading.creates, reading.deletes, reading.updates, reading.pendingWork, reading.pendingTimers,
    reading.pendingAnimationFrames])

# Frames until the application has done nothing for STABLE_FRAMES frames, or -1.
func quiet() -> int:
  var last := ""
  var stable := 0
  for frame in range(FRAME_LIMIT):
    await tree.process_frame
    var key := light_key(light())
    stable = stable + 1 if key == last else 0
    last = key
    if stable >= STABLE_FRAMES:
      return frame + 1
  return -1

# The scene is mounted when the bar's buttons are native nodes; then it is waited quiet and the base is read.
func mount() -> bool:
  var reached := await driver.wait_for(func() -> bool: return int(surface.call("get_surface_id")) != 0 and not driver.node_by("tab-units").is_empty())
  var frames: int = await quiet()
  base_nodes = tree.get_node_count()
  return reached and frames > 0

func surface_state() -> Dictionary:
  return Sampler.surface_state(surface)

# The Surface's counts, which belong to the one root it mounts.
static func row_of(state: Dictionary) -> Dictionary:
  var nodes: Array = state.get("nodes", [])
  return {"state": str(state.get("state", "")), "nativeTags": Sampler.number(state.get("nativeTags")), "creates": Sampler.number(state.get("creates")),
    "deletes": Sampler.number(state.get("deletes")), "commits": Sampler.number(state.get("commits")), "nodes": nodes.size()}

func surface_row() -> Dictionary:
  return row_of(surface_state())

# The test IDs of the nodes of a snapshot of the Surface.
static func ids_of(state: Dictionary) -> Dictionary:
  var ids := {}
  for node: Dictionary in state.get("nodes", []):
    var test_id := str(node.get("testID", ""))
    if test_id != "":
      ids[test_id] = true
  return ids

# What React did since the fixture's last reset: the presses each button took, the panels it committed and the one shown.
func rn() -> Dictionary:
  var value: Variant = JSON.parse_string(app.call("evaluate", "JSON.stringify(FrontierBaselineProbe.snapshot())"))
  return value if value is Dictionary else {}

# Whether the snapshot's test IDs show a panel complete (its last node) and the roots of the panels that should be gone.
static func complete(ids: Dictionary, panel: String) -> bool:
  return panel == "empty" or ids.has("last-" + panel)

static func shown_roots(ids: Dictionary) -> Array:
  return PANELS.filter(func(panel: String) -> bool: return panel != "empty" and ids.has("panel-" + panel))

# The first stamp after a moment, or -1.
static func first_after(stamps: Array, moment: int) -> int:
  for stamp: int in stamps:
    if stamp > moment:
      return stamp
  return -1

# One swap from `from_panel` to `to_panel` by a real click on the button of `to_panel`. Returns what it did, and leaves the
# application a few frames after the arrival; the caller waits it quiet and takes its readings.
#
# The click is delivered by the flush, at the start of a process frame, and the host can mount the new panel inside it: the
# nodes may exist the moment the flush returns (latencyFrames 0) or some frames later. `frameUsec` are the intervals between the
# frames, from the one that took the click up to the first at which the nodes exist (at least that one): the swap's own frames.
# `latencyUsec` is the time from the start of the injection to the moment the nodes exist, and, in the windowed lane, `drawUsec`
# the time to the first frame drawn after it.
func swap(from_panel: String, to_panel: String) -> Dictionary:
  world.reset()
  app.call("evaluate", "FrontierBaselineProbe.reset()")
  var before := light()
  await tree.process_frame
  var stamps: Array = [Time.get_ticks_usec()]
  var flush_frame := Engine.get_process_frames()
  driver.inject(Driver.part("tab-" + to_panel, "left", tab_center(to_panel)))
  Input.flush_buffered_events()
  var flushed := Time.get_ticks_usec()
  var target := base_nodes + int(NATIVE_NODES[to_panel])
  var arrived_frames := 0 if tree.get_node_count() == target else -1
  var arrived := flushed if arrived_frames == 0 else -1
  for index in range(ARRIVAL_FRAMES):
    await tree.process_frame
    var now := Time.get_ticks_usec()
    stamps.append(now)
    if arrived_frames < 0 and tree.get_node_count() == target:
      arrived_frames = Engine.get_process_frames() - flush_frame
      arrived = now
    if arrived_frames >= 0:
      break
  await settle(TRAILING_FRAMES)
  var after := light()
  var state := surface_state()
  var ids := ids_of(state)
  var intervals: Array = []
  for index in range(1, stamps.size()):
    intervals.append(stamps[index] - stamps[index - 1])
  var drawn := first_after(draw_stamps, arrived) if arrived >= 0 else -1
  return {"from": from_panel, "to": to_panel, "latencyFrames": arrived_frames, "flushUsec": flushed - stamps[0],
    "latencyUsec": arrived - stamps[0] if arrived >= 0 else null, "drawUsec": drawn - stamps[0] if drawn >= 0 else null, "frameUsec": intervals,
    "snapshotComplete": arrived_frames >= 0 and complete(ids, to_panel), "shownRoots": shown_roots(ids), "worldEvents": world.received.size(),
    "worldClicks": world_clicks(), "worldReceived": world.received.slice(0, 8), "rn": rn(), "host": host_delta(before, after),
    "surface": row_of(state), "treeNodes": tree.get_node_count()}

# The events that reached the world other than motion: the presses, releases and touches. A window on a display also gets the
# motion of the real pointer, which is the map's whenever it is over the map, so the windowed lane judges these only; the headless
# lane has no hardware and judges every event.
func world_clicks() -> int:
  var clicks := 0
  for received: Array in world.received:
    if received[0] != "InputEventMouseMotion":
      clicks += 1
  return clicks

# The intervals between FRAMES frames in which nothing happens: the map and the HUD are still.
func idle(frames: int) -> Array:
  var intervals: Array = []
  await tree.process_frame
  var previous := Time.get_ticks_usec()
  for index in range(frames):
    await tree.process_frame
    var now := Time.get_ticks_usec()
    intervals.append(now - previous)
    previous = now
  return intervals
