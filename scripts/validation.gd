extends "res://scripts/validation_base.gd"
var initial_count := 0

func _ready() -> void:
  if DisplayServer.get_name() == "headless":
    get_window().size = Vector2i(900, 680)
  surface = FabricSurface.new()
  add_child(surface)
  if "--validate" not in OS.get_cmdline_user_args():
    return
  await wait_js("GodotApp.stats().mounts === 1")
  initial_count = data().nodes.size()
  verify(initial_count == 20, "Fabric mounts exactly 20 native Controls")
  verify(node("counter").nativeText == "Contador: 0", "React initial state reaches native Button")
  verify(node("context").nativeText == "Context: React Native · Input: Godot nativo", "Context and UTF-8 reach native Label")
  verify(node("counter").width == 272 and node("batch").x == 284, "Yoga calculates flex widths and gap")
  verify(react().layout[0].width == 400 and react().layout[0].native.width == 400, "Layout effect sees committed Fabric and Godot geometry")
  verify(react().refAttached == 1, "React 19 callback ref receives public native instance")

  await click("counter")
  await wait_js("true", 4)
  verify(node("counter").nativeText == "Contador: 1", "Viewport mouse input crosses native event queue into React state" if DisplayServer.get_name() != "headless" else "Native Button signal crosses Fabric event queue into React state")
  verify(react().rowRenders == 3, "React.memo skips unrelated row renders")
  var commits_before: int = data().commits
  await click("batch")
  await frames(4)
  verify(node("counter").nativeText == "Contador: 4", "Functional updates compose inside an event batch")
  verify(data().commits == commits_before + 1, "Three state updates produce one Fabric commit")

  await click("row-A")
  await frames(4)
  var row_before: Dictionary = node("row-A")
  verify(row_before.nativeText == "A: 1" and react().bubbles == 1, "Fabric event bubbles to React ancestor")
  await click("reorder")
  await frames(4)
  var row_after: Dictionary = node("row-A")
  verify(row_after.id == row_before.id and row_after.tag == row_before.tag, "Keyed reorder preserves native instance and Fabric tag")
  verify(row_after.nativeText == "A: 1" and row_after.x == 568, "Keyed reorder preserves hook state and moves Yoga geometry")

  var input: LineEdit = surface.find_child("input", true, false)
  input.grab_focus()
  input.caret_column = 5
  var input_before: Dictionary = node("input")
  surface.evaluate("GodotApp.run('handlers')")
  await frames(4)
  verify(node("input").id == input_before.id and node("input").caret == 5 and node("input").focused, "Handler update preserves native focus and caret")
  var key := InputEventKey.new()
  key.pressed = true
  key.unicode = "ç".unicode_at(0)
  get_viewport().push_input(key)
  await frames(4)
  verify(node("input").nativeText == "Godotç nativo" and node("input").text == "Godotç nativo", "Native text input updates controlled React value with UTF-8")
  verify(react().handlerVersion == 1, "Native event calls latest React handler")
  surface.evaluate("GodotApp.run('reorder')")
  await frames(4)
  verify(node("input").focused and node("input").caret == 6, "Sibling reorder preserves focus and text caret")

  await click("measured")
  await frames(4)
  var layout: Dictionary = react().layout.back()
  verify(node("measured").width == 620 and layout.width == 620 and layout.native.width == 620, "Resize commits before layout effect measures native Control")
  surface.evaluate("GodotApp.run('store')")
  await frames(4)
  verify(node("store").nativeText == "External store: 1", "useSyncExternalStore rerenders from subscription")
  surface.evaluate("GodotApp.run('transition')")
  await frames(8)
  verify(node("counter").nativeText == "Contador: 14", "Concurrent root commits startTransition update")
  surface.evaluate("GodotApp.run('ref')")
  await frames(4)
  verify(react().refCleanups == 1 and node("ref-probe").is_empty(), "React 19 callback ref cleanup runs on removal")

  var suspense_start := Time.get_ticks_msec()
  await click("suspend")
  await wait_native("fallback")
  verify(not node("fallback").is_empty() and node("resolved").is_empty(), "Suspense commits native fallback while Promise is pending")
  await wait_native("resolved")
  verify(Time.get_ticks_msec() - suspense_start >= 350, "Host timer honors elapsed time before resolving Promise")
  verify(node("fallback").is_empty() and node("resolved").nativeText == "Suspense: Promise resolvida no Hermes", "Hermes microtask resumes Suspense and removes fallback")

  var created_before: int = data().creates
  await click("error")
  await wait_native("recovered")
  verify(react().caught == 1 and node("recovered").nativeText == "ErrorBoundary: recuperado", "ErrorBoundary recovers without console.error throwing")
  verify(node("abandoned").is_empty() and data().creates == created_before + 1, "Abandoned render allocates no native Controls")
  verify(data().errors.is_empty(), "Native host and runtime have no errors")

  if "--capture" in OS.get_cmdline_user_args():
    await RenderingServer.frame_post_draw
    get_viewport().get_texture().get_image().save_png("res://build/native.png")
  var before_stop := data()
  remove_child(surface)
  var stopped := data()
  var stopped_react := react()
  verify(stopped.stopped and stopped.nodes.is_empty(), "Scene exit unmounts React and empties native registry")
  verify(stopped.creates == stopped.deletes, "Every committed native allocation is released")
  verify(stopped_react.cleanups == 1 and stopped_react.subscribers == 0, "Scene exit runs passive cleanup and unsubscribes store")
  verify(stopped.pendingTimers == 0 and stopped.errors.is_empty(), "Scene exit leaves no queued timers or host errors")
  surface.free()
  save_report("react", before_stop, stopped, stopped_react)
