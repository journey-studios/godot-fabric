extends "res://scripts/keyboard_validation.gd"

func occurrences(type: String) -> int:
  return react().events.filter(func(event): return event.type == type).size()

func button(id: String) -> void:
  var control: Button = surface.find_child(id, true, false)
  control.grab_focus()
  key(KEY_ENTER)
  await frames(4)

func capture(stage: String) -> void:
  if not OS.get_cmdline_user_args().has("--capture"):
    return
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  var input: Control = surface.find_child("form-input", true, false)
  # Exclude the styled border: bright pixels here must come from native glyphs.
  var region := image.get_region(Rect2i(input.get_global_rect().grow(-6)))
  var glyph_pixels := 0
  for y in range(region.get_height()):
    for x in range(region.get_width()):
      var color := region.get_pixel(x, y)
      glyph_pixels += int(color.r > 0.8 and color.g > 0.8)
  verify(glyph_pixels > 20, "Public LineEdit paints native glyph pixels: " + stage)
  verify(image.save_png("res://build/form-" + stage + ".png") == OK,
    "Public form renderer capture saved: " + stage)

func _ready() -> void:
  if DisplayServer.get_name() == "headless":
    get_window().size = Vector2i(900, 680)
  surface = FabricSurface.new()
  surface.set_meta("scenario", "form")
  if OS.get_cmdline_user_args().has("--validate"):
    surface.set_meta("validation_input_device", 1001)
  add_child(surface)
  await wait_native("form-input")
  if failure or not OS.get_cmdline_user_args().has("--validate"):
    return
  await wait_js("GodotApp.stats().mounts === 1", 3)
  var original := data()
  var identity = node("form-input").id
  var save: Button = surface.find_child("form-save", true, false)
  verify(node("form-input").nativeText == "Ada" and node("form-free").nativeText == "Native-owned text", "Public controlled/uncontrolled TextInput mounts native values")
  verify(save.size.x > 0 and save.size.y >= 44 and node("form-save").nativeText == "Save name · 0", "Public Button title has measurable native geometry")
  verify(node("form-input").appearance.background == "172033ff" and node("form-input").appearance.textColor == "ffffffff", "Public input styles reach the native LineEdit")
  verify(node("form-free").focused, "Public autoFocus focuses the uncontrolled native input on mount")
  surface.evaluate("GodotApp.run('nativeRef'); GodotApp.run('measure')")
  await wait_js("GodotApp.stats().measurement !== null", 3)
  verify(react().nativeRef and react().measurement.width == node("form-input").width and react().measurement.height == 44,
    "Public input ref exposes its native host and asynchronous geometry")
  await capture("initial")
  surface.evaluate("GodotApp.run('focus'); GodotApp.run('focused'); GodotApp.run('select')")
  await frames(4)
  verify(node("form-input").focused and react().focused and occurrences("focus") == 1, "Public focus/isFocused agree with native focus event")
  verify(node("form-input").input.selection.start == 0 and node("form-input").input.selection.end == 3, "Public setSelection uses acknowledged UTF-16 native command")
  key(KEY_Z, "Z".unicode_at(0))
  await wait_js("GodotApp.stats().value === 'Z'", 3)
  verify(node("form-input").nativeText == "Z" and occurrences("change") == 1 and occurrences("key") == 1, "Logical native keyboard edits reach public callbacks and controlled React state")
  key(KEY_ENTER)
  await frames(4)
  verify(node("form-input").focused and occurrences("submit") == 1, "submit behavior emits editing event without blurring")
  await button("form-save")
  verify(occurrences("blur") == 1 and occurrences("end") == 1, "Native focus transfer emits public blur and endEditing")
  verify(react().saves == 1 and node("form-save").nativeText == "Save name · 1", "Native keyboard activation calls public Button onPress and updates title")
  surface.evaluate("GodotApp.run('value', 'A😀B'); GodotApp.run('styles')")
  await frames(4)
  verify(node("form-input").nativeText == "A😀B" and node("form-input").id == identity and react().refAttaches == 1, "Public updates preserve native input and callback ref identity")
  verify(node("form-input").height == 48 and node("form-input").appearance.background == "134e4aff" and node("form-input").appearance.textColor == "fef08aff", "Public style changes rerender into native frame, background and text color")
  verify(node("form-save").appearance.background == "0f766eff", "Public Button color updates native background")
  await capture("changed")
  await button("form-lock")
  var before_events := occurrences("change")
  surface.evaluate("GodotApp.run('focus')")
  await frames(3)
  key(KEY_X, "x".unicode_at(0))
  await frames(3)
  verify(not node("form-input").editable and occurrences("change") == before_events and node("form-input").nativeText == "A😀B", "editable false prevents native edits through the public API")
  await button("form-save")
  verify(react().saves == 1, "Disabled public Button ignores genuine keyboard activation")
  await button("form-lock")
  await button("form-clear")
  verify(node("form-input").nativeText == "" and node("form-value").nativeText == "React value: ", "Controlled clear updates native input and public Text")
  await button("form-save")
  verify(react().saves == 1, "Empty React value disables the public save button")
  surface.evaluate("GodotApp.run('freeFocus')")
  await frames(3)
  surface.evaluate("GodotApp.run('freeClear')")
  await frames(3)
  key(KEY_Q, "q".unicode_at(0))
  await frames(3)
  verify(node("form-free").nativeText == "q" and node("form-free").input.eventCount == 1, "Uncontrolled public clear resets caret and native editing continues")
  surface.evaluate("GodotApp.run('freeClear')")
  await frames(3)
  verify(node("form-free").nativeText == "" and node("form-free").input.selection.start == 0, "clear uses the latest acknowledged native edit count")
  surface.evaluate("GodotApp.run('invalidSelection')")
  verify(react().errors.size() == 1 and react().errors[0].contains("UTF-16"), "Public ref rejects invalid selection without a native command")
  for probe in ["multiline", "keyboard", "accessibility", "weight", "button"]:
    surface.evaluate("GodotApp.run('probe', '%s')" % probe)
    await frames(4)
    verify(not node("form-error").is_empty() and node("form-probe").is_empty(), "Unsupported public contract fails inside React boundary: " + probe)
  verify(react().errors.size() == 6 and data().errors.is_empty(), "All intentional errors are caught; the native runtime remains healthy")
  surface.evaluate("GodotApp.run('probe', ''); GodotApp.run('value', 'Ada'); GodotApp.run('styles')")
  await frames(4)
  verify(node("form-input").height == 44 and node("form-input").appearance.background == "172033ff", "Public styles and native geometry return to their original state")
  verify(react().refAttaches == 1 and data().creates == original.creates + 5, "Error fallback replacement preserves the original form controls")
  surface.evaluate("GodotApp.run('removeStyle')")
  await frames(4)
  var native_input: LineEdit = surface.find_child("form-input", true, false)
  verify(not native_input.has_theme_stylebox_override("normal") and not native_input.has_theme_color_override("font_color"),
    "Removing public appearance props restores the native Theme without stale overrides")
  surface.evaluate("GodotApp.run('removeStyle')")
  await frames(4)
  verify(node("form-input").id == identity and node("form-input").appearance.textColor == "ffffffff",
    "Restored public styling reaches the same native input")
  var before_stop := data()
  surface.stop()
  surface.evaluate("GodotApp.run('staleRef')")
  var stopped := data()
  var state := react()
  verify(state.staleRefReleased, "Retained public input refs release their native host and commands become harmless after unmount")
  verify(stopped.stopped and stopped.nodes.is_empty() and stopped.creates == stopped.deletes and stopped.nativeTags == 0, "Public form stop deletes every native Control and tag")
  verify(state.refCleanups == 1 and state.cleanups == 1, "Public React callback ref and lifecycle cleanup run once")
  verify(stopped.pendingTimers == 0 and stopped.pointer.activeTouches == 0 and stopped.pointer.responder == 0 and stopped.errors.is_empty(), "Public form cleanup leaves no timers, pointer ownership or host errors")
  save_report("form", before_stop, stopped, state)
