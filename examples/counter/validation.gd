extends "res://scripts/pointer_validation.gd"

var value_images: Dictionary = {}

func press(id: String) -> void:
  await mouse("start", at(id))
  await mouse("end", at(id))
  await get_tree().create_timer(0.15).timeout

func capture(stage: String) -> void:
  if not OS.get_cmdline_user_args().has("--capture"):
    return
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  var value: Control = surface.find_child("counter-value", true, false)
  var region := image.get_region(Rect2i(value.get_global_rect()))
  var glyph_pixels := 0
  for y in range(region.get_height()):
    for x in range(region.get_width()):
      var color := region.get_pixel(x, y)
      glyph_pixels += int(color.g > 0.6 and color.g > color.r * 1.3)
  verify(glyph_pixels > 50, "Public Text paints actual glyph pixels: " + stage)
  value_images[stage] = hash(region.get_data())
  verify(image.save_png("res://build/counter-" + stage + ".png") == OK, "Renderer capture saved: " + stage)

func _ready() -> void:
  if DisplayServer.get_name() == "headless":
    get_window().size = Vector2i(900, 680)
  surface = FabricSurface.new()
  surface.set_meta("scenario", "counter")
  if OS.get_cmdline_user_args().has("--validate"):
    surface.set_meta("validation_input_device", 1001)
  add_child(surface)
  await wait_native("counter-value")
  if failure or not OS.get_cmdline_user_args().has("--validate"):
    return
  await wait_js("GodotApp.stats().mounts === 1", 3)
  verify(react().count == 0 and node("counter-value").nativeText == "0", "Public Text displays the initial React state")
  var identity = node("counter-value").id
  var control: Control = surface.find_child("counter-plus", true, false)
  verify(control.size.x > 0 and control.size.y > 0, "Public Pressable has native Yoga hit geometry")
  await capture("initial")
  await press("counter-minus")
  verify(react().count == 0 and data().pointer.responder == 0, "Disabled public Pressable cannot decrement below zero")
  await mouse("start", at("counter-plus"))
  verify(is_equal_approx(node("counter-plus").opacity, 0.72), "Pressed style function updates the native Control")
  await mouse("end", at("counter-plus"))
  await wait_js("GodotApp.stats().count === 1", 3)
  await press("counter-plus")
  await wait_js("GodotApp.stats().count === 2", 3)
  verify(node("counter-value").nativeText == "2", "Pointer presses rerender the public rich Text")
  verify(node("counter-value").id == identity and react().mounts == 1, "Reconciliation preserves native identity and one React mount")
  verify(data().pointer.activeTouches == 0 and data().pointer.responder == 0, "Release clears native contacts and the Fabric responder")
  await capture("updated")
  if OS.get_cmdline_user_args().has("--capture"):
    verify(value_images.initial != value_images.updated, "React count update changes the renderer readback")
  await press("counter-minus")
  await wait_js("GodotApp.stats().count === 1", 3)
  verify(node("counter-value").nativeText == "1", "Functional decrement updates the existing native Text")
  await press("counter-reset")
  await wait_js("GodotApp.stats().count === 0", 3)
  verify(node("counter-value").nativeText == "0", "Reset updates public UI without remounting")
  await press("counter-minus")
  verify(react().count == 0 and react().mounts == 1, "Disabled state follows the committed reset")
  var before_stop := data()
  surface.stop()
  var stopped := data()
  var stopped_react := react()
  verify(stopped.stopped and stopped.nodes.is_empty() and stopped.creates == stopped.deletes and stopped.nativeTags == 0, "Stop deletes every native Control and tag")
  verify(stopped.pointer.activeTouches == 0 and stopped.pointer.responder == 0 and stopped.pendingTimers == 0, "Stop releases pointer ownership and timers")
  verify(stopped.errors.is_empty() and stopped_react.cleanups == 1, "React lifecycle cleanup completes without host errors")
  save_report("counter", before_stop, stopped, stopped_react, {"valueImageHashes": value_images})
