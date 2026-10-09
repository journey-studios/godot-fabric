extends RefCounted

# The presence of the window of a windowed lane (the baseline's tests/frontier-baseline-graphics-probe.gd and the turn's tests/frontier-turn-probe.gd),
# shared and not copied. A frame time exists only if the engine draws the window, and on macOS it stops drawing a window that nothing shows
# (docs/research/windowed-presence.md): the window delegate clears the window's visibility when the system says the window is occluded
# (covered by other windows, minimized, on another Space), DisplayServer.window_can_draw() reads that flag, and Main::iteration
# does not call RenderingServer.draw while no window can draw, so frame_post_draw never fires although the process frames go on.
#
# open() asks the system, once, to put the window where it can be seen: in front of the other windows (DisplayServer.window_move_to_foreground) and
# above them (Window.always_on_top, the floating level), and waits for the engine to say that it can draw. It changes nothing else: the window keeps
# its title bar and is never made borderless, and no window flag that refuses the focus is set. Then, at every process frame, the helper reads
# DisplayServer.window_can_draw() and counts the frames in which the engine could not draw, with the spans of those frames, so that a run which
# did not draw says whether the window was the cause. close() stops the sampling and returns the record the probe writes in its report.
#
# Nothing here judges: the validity of a run is the oracle's (graphicsRunValidity in tests/frontier-baseline-oracle.mjs) and does not read this.
# Headless there is no window to present: open() returns {"windowed": false} and nothing is sampled.
#
# Record of a windowed run:
#   windowed         true
#   opened           what open() asked for and read back: alwaysOnTop, focused, mode, canDraw (the engine could draw for `stableFrames` frames in
#                    a row), waitedFrames and waitedUsec (the wait for that), and the bounds of the wait
#   sampledFrames    the process frames sampled between open() and close()
#   undrawableFrames the sampled frames in which window_can_draw() was false
#   spanCount        the runs of consecutive undrawable frames, and spans the first SPAN_LIMIT of them as
#                    [first process frame, frames, microseconds from the start of the sampling to the first, and to the last]
#   canDrawAtEnd     window_can_draw() when close() was called
const OPEN_WAIT_USEC := 3_000_000
# The occlusion state reaches the window as a notification that the system sends some time after the window is ordered in, and the flag starts as
# true: a window is read as drawable only after it has been so for this many process frames in a row.
const STABLE_FRAMES := 12
const SPAN_LIMIT := 64

var tree: SceneTree
var window: Window
var opened: Dictionary = {"windowed": false}
var tracking := false
var sampled := 0
var undrawable := 0
var span_count := 0
var spans: Array = []
var current_span: Array = []
var previous_frame := -10
var since_usec := 0

func _init(scene_tree: SceneTree) -> void:
  tree = scene_tree
  window = scene_tree.root

# The microseconds are of the engine's clock; the frames of the SceneTree's.
func open() -> Dictionary:
  if DisplayServer.get_name() == "headless":
    opened = {"windowed": false}
    return opened
  window.always_on_top = true
  DisplayServer.window_move_to_foreground()
  var begin := Time.get_ticks_usec()
  var waited := 0
  var streak := 0
  while streak < STABLE_FRAMES and Time.get_ticks_usec() - begin < OPEN_WAIT_USEC:
    await tree.process_frame
    waited += 1
    streak = streak + 1 if DisplayServer.window_can_draw() else 0
  opened = {"windowed": true, "alwaysOnTop": window.always_on_top, "focused": DisplayServer.window_is_focused(),
    "mode": DisplayServer.window_get_mode(), "canDraw": streak >= STABLE_FRAMES, "waitedFrames": waited,
    "waitedUsec": Time.get_ticks_usec() - begin, "stableFrames": STABLE_FRAMES, "waitLimitUsec": OPEN_WAIT_USEC}
  since_usec = Time.get_ticks_usec()
  tracking = true
  tree.process_frame.connect(note_frame)
  return opened

# At the start of a process frame. The flag is the one the iteration reads, at the end of the same frame, to decide on the draw; the system's notification
# that changes it is delivered by the run loop that also calls the iteration, so a sample and the draw of its frame can differ only if one is delivered
# between them, which the research note takes as not happening (an inference from the source, not something the engine reports).
func note_frame() -> void:
  sampled += 1
  if DisplayServer.window_can_draw():
    return
  undrawable += 1
  var frame := Engine.get_process_frames()
  var at := Time.get_ticks_usec() - since_usec
  if frame == previous_frame + 1:
    current_span[1] += 1
    current_span[3] = at
  else:
    current_span = [frame, 1, at, at]
    span_count += 1
    if spans.size() < SPAN_LIMIT:
      spans.append(current_span)
  previous_frame = frame

func close() -> Dictionary:
  if tracking:
    tree.process_frame.disconnect(note_frame)
    tracking = false
  if not bool(opened.windowed):
    return {"windowed": false}
  return {"windowed": true, "opened": opened, "sampledFrames": sampled, "undrawableFrames": undrawable, "spanCount": span_count, "spans": spans,
    "canDrawAtEnd": DisplayServer.window_can_draw()}
