extends "res://scripts/pointer_validation.gd"

func count_events(id: String, type: String) -> int:
  var count := 0
  for event in react().events:
    if event.id == id and event.type == type:
      count += 1
  return count

func last_event(id: String, type: String) -> Dictionary:
  var result := {}
  for event in react().events:
    if event.id == id and event.type == type:
      result = event
  return result

func clear_events() -> void:
  surface.evaluate("GodotApp.run('clear')")

func click_pressable(id: String) -> void:
  await mouse("start", at(id))
  await mouse("end", at(id))
  await get_tree().create_timer(0.15).timeout

func _ready() -> void:
  if DisplayServer.get_name() == "headless":
    get_window().size = Vector2i(900, 680)
  surface = FabricSurface.new()
  surface.set_meta("scenario", "pressable")
  if OS.get_cmdline_user_args().has("--validate"):
    surface.set_meta("validation_input_device", 1001)
  add_child(surface)
  await wait_native("basic")
  if not OS.get_cmdline_user_args().has("--validate"):
    return
  await frames(3)
  await click_pressable("basic")
  verify(count_events("basic", "PressIn") == 1 and count_events("basic", "Press") == 1 and count_events("basic", "PressOut") == 1, "Mouse press emits one upstream in/press/out sequence")
  verify(data().pointer.responder == 0 and data().pointer.activeTouches == 0, "Release clears Fabric responder and native pointer capture")
  var propagation: Array = react().events.filter(func(e): return e.type.begins_with("Touch"))
  verify(propagation.map(func(e): return e.id + ":" + e.type) == ["root:TouchCapture", "basic:TouchCapture", "basic:TouchBubble", "root:TouchBubble"], "Touch capture and bubble follow the React tree")
  var event: Dictionary = last_event("basic", "PressIn")
  verify(event.target != 0 and event.currentTarget == node("basic").tag and event.touches == 1 and event.changedTouches == 1 and event.timestamp > 0, "Fabric touch payload includes target, responder, contact arrays and timestamp")
  verify(event.locationX >= 0 and event.locationY >= 0, "Touch coordinates refer to the native target")

  surface.evaluate("GodotApp.run('stopTouches')")
  await frames(3)
  clear_events()
  await click_pressable("basic")
  verify(count_events("root", "TouchBubble") == 0 and count_events("basic", "Press") == 1, "Stopping touch propagation does not duplicate or suppress responder press")
  surface.evaluate("GodotApp.run('stopTouches')")
  await frames(3)
  clear_events()
  await mouse("start", at("basic"))
  verify(node("basic-state").nativeText.contains("pressionado") and node("basic").opacity == 0.5, "Function children and style rerender into native pressed text and opacity")
  await mouse("move", at("basic") + Vector2(0, 180))
  await get_tree().create_timer(0.15).timeout
  verify(count_events("basic", "PressOut") == 1 and data().pointer.responder == node("basic").tag, "Leaving retention region deactivates while retaining responder")
  await mouse("move", at("basic"))
  await mouse("end", at("basic"))
  await get_tree().create_timer(0.15).timeout
  verify(count_events("basic", "PressIn") == 2 and count_events("basic", "Press") == 1 and count_events("basic", "PressOut") == 2, "Returning to retention region reactivates before release")
  clear_events()
  await mouse("start", at("basic"))
  await mouse("move", at("basic") + Vector2(0, 180))
  await mouse("end", at("basic") + Vector2(0, 180))
  await get_tree().create_timer(0.15).timeout
  verify(count_events("basic", "Press") == 0 and data().pointer.responder == 0, "Release outside retention region does not press another control")

  clear_events()
  await touch("start", at("basic"))
  await touch("cancel", at("basic"))
  await get_tree().create_timer(0.15).timeout
  verify(count_events("basic", "Press") == 0 and count_events("basic", "PressOut") == 1 and data().pointer.activeTouches == 0 and data().pointer.responder == 0, "Canceled touch terminates upstream Pressability without press")
  clear_events()
  await mouse("start", at("basic"))
  surface.remove_meta("validation_input_device")
  surface.notification(Node.NOTIFICATION_WM_WINDOW_FOCUS_OUT)
  surface.set_meta("validation_input_device", 1001)
  await frames(2)
  await get_tree().create_timer(0.15).timeout
  verify(count_events("basic", "Press") == 0 and count_events("basic", "PressOut") == 1 and data().pointer.responder == 0, "Window focus notification cancels a held gesture without press")
  await click_pressable("basic")
  verify(count_events("basic", "Press") == 1, "A new press works after window focus cancellation")
  clear_events()
  await touch("start", at("basic"), 2)
  await touch("start", at("basic") + Vector2(4, 0), 3)
  verify(count_events("basic", "PressIn") == 1 and count_events("basic", "Press") == 0 and data().pointer.activeTouches == 2 and data().pointer.responder == node("basic").tag, "Two descendant contacts share one active Pressability responder")
  await touch("move", at("basic") + Vector2(5, 0), 3)
  verify(last_event("basic", "PressMove").identifier == 4 and last_event("basic", "PressMove").touches == 2, "Touch drag keeps identifier and both active contacts")
  await touch("end", at("basic"), 2)
  # Pressability reacts to responder release. Ending one of its descendant
  # contacts must not release the responder while another descendant remains.
  verify(count_events("basic", "Press") == 0 and count_events("basic", "PressOut") == 0 and data().pointer.activeTouches == 1 and data().pointer.responder == node("basic").tag, "First descendant contact end retains the responder without press or deactivation")
  verify(node("basic-state").nativeText.contains("pressionado") and node("basic").opacity == 0.5, "Pressed React render state remains active while its second descendant contact survives")
  await touch("move", at("basic") + Vector2(6, 0), 3)
  var remaining_move := last_event("basic", "PressMove")
  verify(count_events("basic", "PressMove") == 2 and remaining_move.identifier == 4 and remaining_move.touches == 1 and remaining_move.changedTouches == 1 and remaining_move.currentTarget == node("basic").tag and remaining_move.timestamp > 0, "Remaining descendant still moves the responder with its original identifier and one-contact Fabric payload")
  await touch("end", at("basic"), 3)
  await get_tree().create_timer(0.15).timeout
  verify(count_events("basic", "PressIn") == 1 and count_events("basic", "Press") == 1 and count_events("basic", "PressOut") == 1 and data().pointer.activeTouches == 0 and data().pointer.responder == 0, "Last descendant contact releases one responder with exactly one activation press and deactivation")
  var final_press := last_event("basic", "Press")
  verify(final_press.identifier == 4 and final_press.touches == 0 and final_press.changedTouches == 1 and final_press.currentTarget == node("basic").tag and final_press.timestamp > 0, "Final press carries the last released descendant and an empty remaining-contact array")

  clear_events()
  await click_pressable("inner")
  verify(count_events("inner", "Press") == 1 and count_events("outer", "Press") == 0, "Nested Pressable gives deepest responder exclusive press")
  await click_pressable("disabled")
  verify(count_events("disabled", "PressIn") == 0 and count_events("disabled", "Press") == 0, "Disabled Pressable never claims responder")
  clear_events()
  await mouse("start", at("long"))
  await get_tree().create_timer(0.25).timeout
  verify(count_events("long", "LongPress") == 1, "Long-press timer runs through Hermes and upstream Pressability")
  await mouse("end", at("long"))
  await get_tree().create_timer(0.15).timeout
  verify(count_events("long", "Press") == 0 and count_events("long", "PressOut") == 1, "Long press suppresses normal press on release")
  clear_events()
  await mouse("start", at("delayed"))
  verify(count_events("delayed", "PressIn") == 0, "Press delay defers activation")
  await mouse("end", at("delayed"))
  await get_tree().create_timer(0.15).timeout
  verify(count_events("delayed", "PressIn") == 1 and count_events("delayed", "Press") == 1 and count_events("delayed", "PressOut") == 1, "Fast release still produces the upstream delayed press sequence")

  clear_events()
  await mouse("start", at("negotiated"))
  surface.evaluate("GodotApp.run('transfer')")
  await frames(3)
  await mouse("move", at("negotiated") + Vector2(5, 0))
  await get_tree().create_timer(0.15).timeout
  verify(data().pointer.responder == node("negotiator").tag and data().pointer.blockNative and count_events("negotiated", "PressOut") == 1, "Ancestor capture negotiates termination and takes responder")
  await mouse("end", at("negotiated"))
  verify(count_events("negotiated", "Press") == 0 and count_events("parent", "Release") == 1, "Transferred responder releases only its current owner")
  surface.evaluate("GodotApp.run('hold')")
  await frames(3)
  clear_events()
  await mouse("start", at("negotiated"))
  surface.evaluate("GodotApp.run('transfer')")
  await frames(3)
  await mouse("move", at("negotiated") + Vector2(5, 0))
  verify(data().pointer.responder == node("negotiated").tag and count_events("parent", "Reject") == 1, "Noncancelable Pressable rejects ancestor responder transfer")
  await mouse("end", at("negotiated"))
  await get_tree().create_timer(0.15).timeout
  verify(count_events("negotiated", "Press") == 1, "Rejected transfer preserves the child's press")
  surface.evaluate("GodotApp.run('resetTransfer')")
  await frames(3)

  clear_events()
  await mouse("start", at("slop") + Vector2(-60, 0))
  await mouse("end", at("slop") + Vector2(-60, 0))
  await get_tree().create_timer(0.15).timeout
  verify(count_events("slop", "Press") == 1, "HitSlop expands initial touch target within parent bounds")
  clear_events()
  await mouse("start", at("slop") + Vector2(-65, 0))
  await mouse("end", at("slop") + Vector2(-65, 0))
  verify(count_events("slop", "PressIn") == 0, "HitSlop cannot escape its parent's bounds")
  clear_events()
  await click_pressable("underlay")
  verify(count_events("underlay", "Press") == 1, "pointerEvents none passes through an overlapping view")
  surface.evaluate("GodotApp.run('overlay', 'box-only')")
  await frames(3)
  clear_events()
  await click_pressable("underlay")
  verify(count_events("underlay", "Press") == 0, "Higher-Z box-only overlay blocks the lower press target")
  surface.evaluate("GodotApp.run('overlay', 'box-none')")
  await frames(3)
  await click_pressable("underlay")
  verify(count_events("underlay", "Press") == 1, "pointerEvents box-none excludes the container itself")

  clear_events()
  var original_point := at("basic")
  await mouse("start", original_point)
  var identity = node("basic").id
  surface.evaluate("GodotApp.run('version'); GodotApp.run('reorder')")
  await frames(3)
  verify(node("basic").id == identity and data().pointer.responder == node("basic").tag, "Keyed reorder preserves native identity and responder capture")
  await mouse("move", original_point)
  await mouse("end", original_point)
  await get_tree().create_timer(0.15).timeout
  verify(last_event("basic", "Press").get("version") == 2, "Active gesture invokes the latest committed React handler")

  clear_events()
  await mouse("start", at("removable"))
  surface.evaluate("GodotApp.run('remove')")
  await frames(5)
  await get_tree().create_timer(0.25).timeout
  verify(node("removable").is_empty() and data().pointer.activeTouches == 0 and data().pointer.responder == 0, "Unmount cancels native contacts and releases upstream responder")
  verify(count_events("removable", "Press") == 0 and count_events("removable", "LongPress") == 0, "Unmount resets Pressability timers and callbacks")
  await click_pressable("basic")
  verify(count_events("basic", "Press") == 1, "New press after responder unmount has clean touch history")
  clear_events()
  await mouse("start", at("basic"))
  surface.evaluate("GodotApp.run('disable')")
  await frames(4)
  await mouse("end", at("basic"))
  await get_tree().create_timer(0.15).timeout
  verify(count_events("basic", "Press") == 0 and data().pointer.responder == 0, "Disabling during a gesture cancels capture without a phantom press")
  clear_events()
  var hidden_point := at("spare")
  await mouse("start", hidden_point)
  surface.evaluate("GodotApp.run('hideRow')")
  await frames(4)
  verify(data().pointer.activeTouches == 0 and data().pointer.responder == 0, "Hiding an ancestor cancels its descendant responder")
  await mouse("end", hidden_point)
  await get_tree().create_timer(0.15).timeout
  verify(count_events("spare", "Press") == 0, "Hidden descendants cannot complete a phantom press")
  surface.evaluate("GodotApp.run('hideRow')")
  await frames(3)
  await verify_native_blocking()

  if OS.get_cmdline_user_args().has("--capture"):
    await RenderingServer.frame_post_draw
    get_viewport().get_texture().get_image().save_png("res://build/pressable.png")
  await mouse("start", at("spare"))
  # GPU readback can exceed the long-press delay. Capture after timed gesture
  # assertions, so saving an image cannot turn their click into a long press.
  if OS.get_cmdline_user_args().has("--capture"):
    await RenderingServer.frame_post_draw
    get_viewport().get_texture().get_image().save_png("res://build/pressable-pressed.png")
  var before_stop := data()
  surface.stop()
  var stopped := data()
  var stopped_react := react()
  verify(stopped.stopped and stopped.nodes.is_empty() and stopped.creates == stopped.deletes and stopped.nativeTags == 0, "Surface stop unmounts every committed native Control")
  verify(stopped.pointer.activeTouches == 0 and stopped.pointer.responder == 0 and stopped.pendingTimers == 0, "Stop during a press releases responder, contacts and timers")
  verify(stopped.errors.is_empty() and stopped_react.cleanups == 1, "React lifecycle cleanup completes without host errors")
  save_report("pressable", before_stop, stopped, stopped_react)

func verify_native_blocking() -> void:
  if DisplayServer.get_name() == "headless":
    return
  clear_events()
  await click_pressable("native-button")
  verify(count_events("native-button", "Activate") == 1, "Unclaimed mouse input reaches the native Godot Button")
  surface.evaluate("GodotApp.run('nativeMode')")
  await frames(3)
  clear_events()
  await click_pressable("native-button")
  verify(count_events("native-button", "Activate") == 0, "pointerEvents none also excludes the native Button GUI path")
  surface.evaluate("GodotApp.run('nativeMode'); GodotApp.run('block')")
  await frames(3)
  clear_events()
  await mouse("start", at("native-button"))
  verify(data().pointer.blockNative, "Fabric blockNativeResponder takes effect before Godot GUI input")
  await mouse("end", at("native-button"))
  verify(count_events("native-button", "Activate") == 0 and count_events("native-parent", "Release") == 1, "Blocked gesture produces no native Button activation")
