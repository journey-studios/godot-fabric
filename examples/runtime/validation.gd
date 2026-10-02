extends "res://scripts/pointer_validation.gd"

var image_hashes: Dictionary = {}

func press(id: String) -> void:
  await mouse("start", at(id))
  await mouse("end", at(id))
  await frames(3)

func capture(stage: String) -> void:
  if not OS.get_cmdline_user_args().has("--capture"):
    return
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  var value: Control = surface.find_child("runtime-value", true, false)
  var region := image.get_region(Rect2i(value.get_global_rect()))
  var glyph_pixels := 0
  for y in range(region.get_height()):
    for x in range(region.get_width()):
      var color := region.get_pixel(x, y)
      glyph_pixels += int(color.g > 0.6 and color.g > color.r * 1.3)
  verify(glyph_pixels > 50, "Actual Text glyphs appear in the renderer: " + stage)
  image_hashes[stage] = hash(region.get_data())
  var track: Control = surface.find_child("runtime-track", true, false)
  var rect := track.get_global_rect()
  var painted := 0
  for x in range(2, int(rect.size.x) - 2):
    var color := image.get_pixel(int(rect.position.x) + x, int(rect.get_center().y))
    painted += int(color.g > 0.6 and color.g > color.r * 1.3)
  verify(absf(float(painted) / (rect.size.x - 4) - react().ticks / 6.0) < 0.025, "Progress pixels match committed React ticks: " + stage)
  verify(image.save_png("res://build/runtime-" + stage + ".png") == OK, "Renderer capture saved: " + stage)

func _ready() -> void:
  if DisplayServer.get_name() == "headless":
    get_window().size = Vector2i(900, 680)
  surface = FabricSurface.new()
  surface.set_meta("scenario", "runtime")
  if OS.get_cmdline_user_args().has("--validate"):
    surface.set_meta("validation_input_device", 1001)
  add_child(surface)
  await wait_native("runtime-value")
  if failure or not OS.get_cmdline_user_args().has("--validate"):
    return
  await wait_js("GodotApp.stats().mounts === 1", 3)
  verify(data().timerEngine == "react-native/TimerManager", "The host uses the upstream React Native TimerManager")
  verify(react().ticks == 0 and node("runtime-value").nativeText == "0 / 6", "Initial React state commits through public Text")
  var identity = node("runtime-value").id
  await capture("initial")
  await press("runtime-start")
  await wait_js("GodotApp.stats().ticks >= 2 && GodotApp.stats().report !== null")
  verify(react().checks.size() == 4 and react().checks.all(func(check): return check.passed), "All four shared runtime contracts pass in actual Hermes")
  verify(react().report.trace == ["sync", "promise", "microtask", "immediate", "nested", "timer"], "Nested microtasks and immediate callbacks precede native timers")
  verify(react().report.intervalTicks == 3 and react().report.objectIdentity, "Interval cancellation and timeout argument identity survive JSI")
  await press("runtime-pause")
  await wait_js("GodotApp.stats().status === 'Paused'", 3)
  var paused := react()
  verify(paused.ticks >= 2 and paused.ticks < 6 and paused.frames > 0, "Pointer input pauses a running interval and frame loop")
  await get_tree().create_timer(0.35).timeout
  # Upstream Pressability may still own its delayed press-out timeout immediately
  # after release. Check the complete queue after that deadline has elapsed.
  verify(data().pendingTimers == 0 and data().pendingAnimationFrames == 0, "Pausing releases both native callback queues")
  verify(react().ticks == paused.ticks and react().frames == paused.frames, "Cancelled clocks remain unchanged after their previous deadlines")
  verify(node("runtime-value").id == identity, "React rerenders preserve the native Text instance")
  await capture("paused")
  await press("runtime-start")
  await wait_js("GodotApp.stats().status === 'Complete' && GodotApp.stats().report !== null", 3)
  await frames(4)
  verify(react().ticks == 6 and node("runtime-value").nativeText == "6 / 6", "Six recurring callbacks commit the complete public UI")
  verify(is_equal_approx(node("runtime-progress").width, node("runtime-track").width), "Completed Yoga progress fills the native track")
  verify(data().pendingTimers == 0 and data().pendingAnimationFrames == 0, "Completion cancels the interval and next frame")
  await capture("complete")
  if OS.get_cmdline_user_args().has("--capture"):
    verify(image_hashes.initial != image_hashes.paused and image_hashes.paused != image_hashes.complete, "Timer-driven React updates change actual painted glyphs")
  await press("runtime-start")
  verify(data().pendingTimers > 0 and data().pendingAnimationFrames > 0, "Unmount begins with a live clock and queued work")
  surface.evaluate("globalThis.afterStopCalls=0; globalThis.savedTimeout=setTimeout; globalThis.savedInterval=setInterval; globalThis.savedFrame=requestAnimationFrame; setTimeout(()=>afterStopCalls++,0); setInterval(()=>afterStopCalls++,0); setImmediate(()=>afterStopCalls++); queueMicrotask(()=>afterStopCalls++); requestAnimationFrame(()=>afterStopCalls++)")
  var before_stop := data()
  surface.stop()
  await frames(4)
  var stopped := data()
  var stopped_react := react()
  verify(surface.evaluate("afterStopCalls") == "0", "Queued timer, interval, immediate, microtask and frame callbacks cannot run after stop begins")
  verify(surface.evaluate("savedTimeout(()=>afterStopCalls++,0)+savedInterval(()=>afterStopCalls++,0)+savedFrame(()=>afterStopCalls++)") == "0", "Previously captured scheduling functions reject work after shutdown")
  verify(stopped.stopped and stopped.pendingTimers == 0 and stopped.pendingAnimationFrames == 0 and stopped.pendingWork == 0, "Stop releases every native deadline and work item")
  verify(stopped.nodes.is_empty() and stopped.nativeTags == 0 and stopped.creates == stopped.deletes, "Stop removes every native Control")
  verify(stopped_react.cleanups == 1 and stopped_react.clockCleanups == 3 and stopped.errors.is_empty(), "React effect cleanups finish without runtime errors")
  save_report("runtime", before_stop, stopped, stopped_react, {"imageHashes": image_hashes})
