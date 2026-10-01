extends "res://scripts/validation_base.gd"

func key(code: Key, unicode_value: int = 0, shift := false, ctrl := false) -> void:
  for pressed in [true, false]:
    var event := InputEventKey.new()
    event.keycode = code
    event.unicode = unicode_value
    event.shift_pressed = shift
    event.ctrl_pressed = ctrl
    event.pressed = pressed
    get_viewport().push_input(event)

func count_events(id: String, type: String) -> int:
  var count := 0
  for event in react().events:
    if event.id == id and event.type == type:
      count += 1
  return count

func last_event(id: String, type: String) -> Dictionary:
  var events: Array = react().events
  events.reverse()
  for event in events:
    if event.id == id and event.type == type:
      return event
  return {}

func selection_is(value: Dictionary, start: int, end: int) -> bool:
  return value.start == start and value.end == end

func same_frames() -> bool:
  for entry in data().nodes:
    if abs(entry.width - entry.fabricWidth) > 0.1 or abs(entry.height - entry.fabricHeight) > 0.1:
      return false
  return true

func _ready() -> void:
  if DisplayServer.get_name() == "headless":
    get_window().size = Vector2i(900, 680)
  surface = FabricSurface.new()
  surface.set_meta("scenario", "input")
  add_child(surface)
  if "--validate" not in OS.get_cmdline_user_args():
    return
  await wait_js("GodotApp.stats().mounts === 1")
  var initial := data()
  verify(same_frames(), "All native frames match Yoga, including widgets below themed minimums")
  verify(node("tiny-button").width == 20 and node("tiny-button").height == 12, "Native Button obeys 20x12 frame without extra wrapper Controls")
  verify(node("tiny-input").width == 30 and node("tiny-input").height == 12, "Native LineEdit obeys 30x12 frame without scaling text")
  verify(node("zero-text").height == 0 and node("zero-button").width == 0, "Zero Yoga frames stay zero despite native minimums")
  verify(react().measurements[0].height == 12 and react().measurements[0].native.height == 12, "Layout effects see the actual constrained native widget")
  verify(selection_is(node("controlled").input.selection, 1, 3), "UTF-16 selection spans one astral character in native LineEdit")
  verify(node("uncontrolled").nativeText == "livre" and node("uncontrolled").placeholder == "Digite aqui", "Uncontrolled default value and placeholder mount natively")

  surface.evaluate("GodotApp.run('focus')")
  await frames(4)
  surface.evaluate("GodotApp.run('isFocused')")
  verify(node("controlled").focused and react().refFocused and count_events("controlled", "focus") == 1, "Public ref focus and isFocused agree with native focus event")
  surface.evaluate("GodotApp.run('blur')")
  await frames(4)
  verify(not node("controlled").focused and last_event("controlled", "blur").text == "A😀B", "Public ref blur releases focus and emits the current native value")
  surface.evaluate("GodotApp.run('focus')")
  await frames(4)
  surface.evaluate("GodotApp.run('upper')")
  await frames(4)
  key(KEY_C, "ç".unicode_at(0))
  await frames(4)
  verify(node("controlled").nativeText == "AÇB" and node("controlled").caret == 2, "Controlled transform preserves native caret while replacing selected emoji")
  verify(node("controlled").input.eventCount == 1 and last_event("controlled", "change").text == "AçB" and react().changedText == "AçB", "onChange and onChangeText receive native text and monotonically counted edit")
  var key_index := -1
  var change_index := -1
  for i in range(react().events.size()):
    if react().events[i].id == "controlled" and react().events[i].type == "key": key_index = i
    if react().events[i].id == "controlled" and react().events[i].type == "change": change_index = i
  verify(key_index >= 0 and key_index < change_index, "Native keyPress precedes change through Fabric discrete events")

  surface.evaluate("GodotApp.run('handlers')")
  await frames(4)
  key(KEY_LEFT)
  await frames(4)
  verify(selection_is(last_event("controlled", "selection").selection, 1, 1), "Native arrow key reports UTF-16 caret selection without text change")
  key(KEY_X, "x".unicode_at(0))
  key(KEY_Y, "y".unicode_at(0))
  await frames(4)
  verify(node("controlled").nativeText == "AXYÇB" and node("controlled").input.eventCount == 2, "Burst keys coalesce to one native change without losing either character")
  verify(react().handlerVersion == 1, "Native edits call the latest handler after a React rerender")
  surface.evaluate("GodotApp.run('command', 1, 'obsolete', 0, 0)")
  await frames(4)
  verify(node("controlled").nativeText == "AXYÇB" and node("controlled").input.rejectedCommands == 1, "Stale setTextAndSelection Fabric command cannot overwrite newer native edits")
  surface.evaluate("GodotApp.run('value', 'A😀B', undefined); GodotApp.run('command', 2, 'A😀B', 1, 3)")
  await frames(4)
  verify(node("controlled").nativeText == "A😀B" and selection_is(node("controlled").input.selection, 1, 3), "Acknowledged Fabric command changes text and converts UTF-16 selection")
  verify(count_events("controlled", "change") == 2, "Programmatic text synchronization emits no synthetic native change")

  var controlled_before := node("controlled")
  var focus_before := count_events("controlled", "focus")
  var blur_before := count_events("controlled", "blur")
  surface.evaluate("GodotApp.run('reorder')")
  await frames(4)
  verify(node("controlled").id == controlled_before.id and node("controlled").focused and node("controlled").input.editing, "Keyed input reorder preserves native instance, focus and editing session")
  verify(count_events("controlled", "focus") == focus_before and count_events("controlled", "blur") == blur_before, "Same-parent reorder emits no spurious blur/focus events")
  verify(selection_is(node("controlled").input.selection, 1, 3) and data().creates == initial.creates, "Reorder retains native selection without allocating replacement widgets")

  surface.evaluate("GodotApp.run('focus', 'uncontrolled')")
  await frames(4)
  verify(not node("controlled").focused and node("uncontrolled").focused and count_events("controlled", "end") == 2, "Focus transfer sends blur/endEditing and focuses the other native input")
  var free_input: LineEdit = surface.find_child("uncontrolled", true, false)
  free_input.caret_column = free_input.text.length()
  key(KEY_NONE, "😀".unicode_at(0))
  await frames(4)
  verify(node("uncontrolled").nativeText == "livre😀" and last_event("uncontrolled", "selection").selection.end == 7, "Uncontrolled editing keeps astral text and reports UTF-16 offsets")
  surface.evaluate("GodotApp.run('handlers')")
  await frames(4)
  verify(node("uncontrolled").nativeText == "livre😀" and node("uncontrolled").caret == 6, "Uncontrolled text/caret survive unrelated React prop updates")

  key(KEY_BACKSPACE)
  await frames(4)
  verify(node("uncontrolled").nativeText == "livre" and last_event("uncontrolled", "selection").selection.end == 5, "Native Backspace deletes an astral character without splitting UTF-16 text")

  surface.evaluate("GodotApp.run('focus', 'fixed')")
  await frames(4)
  key(KEY_X, "x".unicode_at(0))
  await frames(4)
  verify(node("fixed").nativeText == "fixo" and node("fixed").input.eventCount == 1, "Controlled value rejects user edit even when parent value stays unchanged")
  verify(count_events("fixed", "change") == 1 and node("fixed").focused, "Rejected edit restores value without event loops or focus loss")

  surface.evaluate("GodotApp.run('value', 'submit', undefined); GodotApp.run('focus')")
  await frames(4)
  key(KEY_ENTER)
  await frames(4)
  verify(last_event("controlled", "submit").text == "submit" and node("controlled").focused and node("controlled").input.editing, "Enter submits native text and submit behavior keeps editing")
  surface.evaluate("GodotApp.run('submit')")
  await frames(4)
  key(KEY_ENTER)
  await frames(4)
  verify(not node("controlled").focused and last_event("controlled", "end").text == "submit", "blurAndSubmit sends submit, blur and endEditing through Fabric")
  surface.evaluate("GodotApp.run('focus'); GodotApp.run('editable', false)")
  await frames(4)
  var changes_before := count_events("controlled", "change")
  key(KEY_Q, "q".unicode_at(0))
  await frames(4)
  verify(not node("controlled").editable and node("controlled").nativeText == "submit" and count_events("controlled", "change") == changes_before, "editable=false blocks native keyboard editing")
  surface.evaluate("GodotApp.run('editable', true)")
  await frames(4)

  # Exercise Godot's own Unicode composition path. This uses the same
  # has_ime_text guard but does not claim coverage of a macOS input method.
  var compose := InputEventKey.new()
  compose.keycode = KEY_U
  compose.ctrl_pressed = true
  compose.shift_pressed = true
  InputMap.action_add_event("ui_unicode_start", compose)
  key(KEY_U, 0, true, true)
  await frames(4)
  verify(node("controlled").input.composing, "Native Unicode composition enters LineEdit composing state")
  surface.evaluate("GodotApp.run('value', 'deferred', undefined); GodotApp.run('command', 2, 'deferred', 2, 2)")
  await frames(4)
  verify(node("controlled").input.pendingEdit and node("controlled").input.composing and node("controlled").nativeText == "submit" and node("controlled").text == "deferred", "React value and Fabric command wait without cancelling active native composition")
  surface.evaluate("GodotApp.run('reorder')")
  await frames(4)
  verify(node("controlled").input.composing and node("controlled").focused, "Keyed reorder preserves native composition session")
  key(KEY_ESCAPE)
  await frames(4)
  verify(not node("controlled").input.composing and not node("controlled").input.pendingEdit and node("controlled").nativeText == "deferred", "Composition cancellation drains the last acknowledged command")

  key(KEY_U, 0, true, true)
  await frames(4)
  surface.evaluate("GodotApp.run('command', 2, 'must-not-win', 0, 0)")
  # Hex 1F600 -> U+1F600. A native composition commit creates a newer edit;
  # the queued command must be rejected before it can erase that edit.
  for code in [KEY_1, KEY_F, KEY_6, KEY_0, KEY_0]:
    key(code, String.chr(code).to_lower().unicode_at(0))
  key(KEY_ENTER)
  await frames(6)
  verify(node("controlled").input.eventCount == 3 and node("controlled").input.rejectedCommands == 2 and not node("controlled").input.pendingEdit, "Composition commit invalidates an older deferred React command")
  verify(last_event("controlled", "change").text.contains("😀") and node("controlled").nativeText.contains("😀"), "Committed native composition reaches React as one Unicode edit")
  InputMap.action_erase_event("ui_unicode_start", compose)

  key(KEY_TAB)
  await frames(4)
  verify(node("uncontrolled").focused and not node("controlled").focused, "Tab follows reconciled native input order and transfers focus")

  var button: Button = surface.find_child("keyboard-button", true, false)
  button.grab_focus()
  key(KEY_ENTER)
  await frames(4)
  verify(react().presses == 1, "Keyboard activates the real native Button through Fabric")
  surface.evaluate("GodotApp.run('resize')")
  await frames(4)
  verify(same_frames() and node("tiny-input").height == 8 and react().measurements.back().native.height == 8, "React resize keeps all native frames within Yoga after theme minimum updates")
  verify(react().refAttached == 1, "React rerenders preserve the TextInput callback ref attachment")
  verify(data().creates == initial.creates and data().errors.is_empty(), "Editing, commands and resizing allocate no replacement widgets or host errors")

  if "--capture" in OS.get_cmdline_user_args():
    await RenderingServer.frame_post_draw
    get_viewport().get_texture().get_image().save_png("res://build/input.png")
  var before_stop := data()
  remove_child(surface)
  var stopped := data()
  var stopped_react := react()
  verify(stopped.stopped and stopped.nodes.is_empty() and stopped.creates == stopped.deletes, "Scene exit releases every committed native widget and input adapter")
  verify(stopped_react.refCleanups == 1, "React 19 callback ref cleanup propagates through the TextInput wrapper")
  verify(stopped_react.cleanups == 1 and stopped.pendingTimers == 0 and stopped.errors.is_empty(), "Input scenario unmount runs React cleanup without runtime errors or timers")
  surface.free()
  save_report("input", before_stop, stopped, stopped_react)
