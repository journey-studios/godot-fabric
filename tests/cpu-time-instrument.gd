extends Node

# The CPU time of the main thread for each process frame: the instrument of the final comparison V05-10 (threshold `cpu-time-instrument`
# of docs/research/frontier-comparison-protocol.md). It depends on neither React Native nor the Fabric host, so the same file serves arm A
# (no HUD), arm B (a Godot HUD) and arm C (the React Native HUD): add one to the tree, call begin(tree), and read samples() at the end.
#
# Why it stamps the clock and does not read Performance.TIME_PROCESS: that monitor is set once a second, to the largest process time of
# the last second, and the time it measures includes the wait for the display (docs/research/cpu-time-instrument.md has the engine source
# and the observation). So the instrument reads Time.get_ticks_usec at the engine's own hooks and adds up the terms that end before the
# frame is presented. The terms of one process frame, in milliseconds:
#
#   physics_ms  the scripted physics steps of the iteration: from the physics_frame signal to the last _physics_process of the tree
#               (the physics server's own step is not in it; 0 when the iteration has no physics step)
#   process_ms  from the process_frame signal, which opens the process step, to frame_pre_draw, which opens the draw and comes after the
#               nodes' _process, the timers and the deferred calls (layout and redraw requests among them); a frame that does not draw
#               ends at the last _process of the tree
#   setup_ms    RenderingServer.get_frame_setup_time_cpu() of the frame's draw (the scene and canvas updates before the viewports render)
#   render_ms   RenderingServer.viewport_get_measured_render_time_cpu() of the measured viewports for the frame's draw, which the engine
#               reports RENDER_READING_LAG_DRAWS draws later: the sample of a frame takes the reading of the draw that long after its own
#   total_ms    physics_ms + process_ms + setup_ms + render_ms
#
# The wait for the display is inside RenderingServer.draw, after the viewports render and at the swap, and no term spans it. A headless run
# has no draw: setup_ms and render_ms are 0 and the total is the physics and process terms. interval_ms, the time between the starts of
# two process frames, is recorded to show that it is another quantity (it holds the wait, the sleeps of the loop and everything outside
# the frame) and monitor_ms is the engine's own monitor, recorded for the same reason. Neither enters the total.
const LAST_PRIORITY := 2147483647
# Draws between a draw and the reading of its viewport render time, measured in the windowed lane of tests/cpu-time-instrument-probe.gd
# (a render pulse at known draws lands six readings later on the Compatibility renderer of 4.7.2) and checked by it in every run.
const RENDER_READING_LAG_DRAWS := 6

# Per process frame, appended as the frames come. Times are Time.get_ticks_usec values.
var _frame := PackedInt64Array()
var _start_usec := PackedInt64Array()
var _last_process_usec := PackedInt64Array()
var _pre_draw_usec := PackedInt64Array()
var _physics_usec := PackedInt64Array()
var _draw_index := PackedInt64Array()
var _setup_ms := PackedFloat64Array()
var _monitor_ms := PackedFloat64Array()
# The reading of the measured viewports at the end of each draw, with the index of the draw it was taken at.
var _reading_draw := PackedInt64Array()
var _reading_ms := PackedFloat64Array()

var _tree: SceneTree
var _viewports: Array[RID] = []
var _physics_start_usec := 0
var _pending_physics_usec := 0
var _active := false

# Starts reading the frames of the tree. The viewports are the ones whose render time is measured (the main window's by default).
func begin(scene_tree: SceneTree, viewports: Array[RID] = []) -> void:
  _tree = scene_tree
  _viewports = viewports.duplicate()
  if _viewports.is_empty():
    _viewports.append(scene_tree.root.get_viewport_rid())
  process_mode = Node.PROCESS_MODE_ALWAYS
  process_priority = LAST_PRIORITY
  process_physics_priority = LAST_PRIORITY
  for viewport: RID in _viewports:
    RenderingServer.viewport_set_measure_render_time(viewport, true)
  _tree.process_frame.connect(_on_process_frame)
  _tree.physics_frame.connect(_on_physics_frame)
  RenderingServer.frame_pre_draw.connect(_on_pre_draw)
  RenderingServer.frame_post_draw.connect(_on_post_draw)
  _active = true
  _tree.root.add_child(self)

# Stops reading. The samples stay, and so does the node: whoever added it frees it.
func finish() -> void:
  if not _active:
    return
  _active = false
  _tree.process_frame.disconnect(_on_process_frame)
  _tree.physics_frame.disconnect(_on_physics_frame)
  RenderingServer.frame_pre_draw.disconnect(_on_pre_draw)
  RenderingServer.frame_post_draw.disconnect(_on_post_draw)
  for viewport: RID in _viewports:
    RenderingServer.viewport_set_measure_render_time(viewport, false)

# The frame being sampled is the one whose process step has begun and not ended; a hook that fires before the first process_frame
# after begin(), or from an iteration that was not sampled, belongs to no sample.
func _current() -> int:
  var last := _frame.size() - 1
  return last if last >= 0 and _frame[last] == Engine.get_process_frames() else -1

func _on_process_frame() -> void:
  var now := Time.get_ticks_usec()
  _frame.append(Engine.get_process_frames())
  _start_usec.append(now)
  _last_process_usec.append(now)
  _pre_draw_usec.append(0)
  _physics_usec.append(_pending_physics_usec)
  _pending_physics_usec = 0
  _draw_index.append(-1)
  _setup_ms.append(0.0)
  _monitor_ms.append(Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0)

func _on_physics_frame() -> void:
  _physics_start_usec = Time.get_ticks_usec()

func _physics_process(_delta: float) -> void:
  _pending_physics_usec += Time.get_ticks_usec() - _physics_start_usec

# Last of the nodes' _process in the tree.
func _process(_delta: float) -> void:
  var now := Time.get_ticks_usec()
  var index := _current()
  if index >= 0:
    _last_process_usec[index] = now

func _on_pre_draw() -> void:
  var now := Time.get_ticks_usec()
  var index := _current()
  if index >= 0:
    _pre_draw_usec[index] = now
    _draw_index[index] = Engine.get_frames_drawn()

func _on_post_draw() -> void:
  var draw := Engine.get_frames_drawn()
  var render := 0.0
  for viewport: RID in _viewports:
    render += RenderingServer.viewport_get_measured_render_time_cpu(viewport)
  _reading_draw.append(draw)
  _reading_ms.append(render)
  var index := _current()
  if index >= 0 and _draw_index[index] == draw:
    _setup_ms[index] = RenderingServer.get_frame_setup_time_cpu()

# The samples as columns, one entry per process frame. renderKnown is 0 for a frame whose draw has not had its reading yet (the last
# RENDER_READING_LAG_DRAWS draws of a run): its renderMs and totalMs are not a sample of the frame and are not to be judged. A frame
# that did not draw has no render term and is known.
func samples() -> Dictionary:
  var count := _frame.size()
  var by_draw := {}
  for index in range(_reading_draw.size()):
    by_draw[_reading_draw[index]] = _reading_ms[index]
  var interval_ms := PackedFloat64Array()
  var process_ms := PackedFloat64Array()
  var physics_ms := PackedFloat64Array()
  var render_ms := PackedFloat64Array()
  var render_known := PackedByteArray()
  var total_ms := PackedFloat64Array()
  var drawn := PackedByteArray()
  interval_ms.resize(count)
  process_ms.resize(count)
  physics_ms.resize(count)
  render_ms.resize(count)
  render_known.resize(count)
  total_ms.resize(count)
  drawn.resize(count)
  for index in range(count):
    var did_draw := _draw_index[index] >= 0
    interval_ms[index] = 0.0 if index == 0 else float(_start_usec[index] - _start_usec[index - 1]) / 1000.0
    process_ms[index] = float((_pre_draw_usec[index] if did_draw else _last_process_usec[index]) - _start_usec[index]) / 1000.0
    physics_ms[index] = float(_physics_usec[index]) / 1000.0
    drawn[index] = 1 if did_draw else 0
    var key := _draw_index[index] + RENDER_READING_LAG_DRAWS
    render_known[index] = 1 if not did_draw or by_draw.has(key) else 0
    render_ms[index] = float(by_draw[key]) if did_draw and by_draw.has(key) else 0.0
    total_ms[index] = physics_ms[index] + process_ms[index] + (_setup_ms[index] if did_draw else 0.0) + render_ms[index]
  return {"frame": _frame, "startUsec": _start_usec, "lastProcessUsec": _last_process_usec, "preDrawUsec": _pre_draw_usec,
    "physicsUsec": _physics_usec, "drawIndex": _draw_index, "drawn": drawn, "setupMs": _setup_ms, "monitorMs": _monitor_ms,
    "intervalMs": interval_ms, "processMs": process_ms, "physicsMs": physics_ms, "renderMs": render_ms, "renderKnown": render_known,
    "totalMs": total_ms, "renderReadings": {"draw": _reading_draw, "ms": _reading_ms}}
