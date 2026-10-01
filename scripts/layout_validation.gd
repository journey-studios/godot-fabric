extends "res://scripts/validation_base.gd"

func _ready() -> void:
  if DisplayServer.get_name() == "headless":
    get_window().size = Vector2i(900, 680)
  surface = FabricSurface.new()
  surface.set_meta("scenario", "layout")
  add_child(surface)
  if "--validate" not in OS.get_cmdline_user_args():
    return
  await wait_js("GodotApp.stats().mounts === 1")
  await frames(4)
  var short_text := node("intrinsic")
  verify(short_text.width > 50 and short_text.height > 10, "Text gets intrinsic size without width or height")
  verify(short_text.width < node("layout-root").width - 48, "Intrinsic text hugs content instead of stretching")
  verify(short_text.nativeText == "Olá, Fabric!" and node("numeric").nativeText == "42", "Text accepts JSX string and numeric children")
  verify(node("newline").lines == 2 and node("newline").visibleLines == 2, "Explicit newlines get measured height without clipping")
  verify(node("empty").height > 0 and node("empty").height < 50, "Empty text keeps one native line with finite geometry")
  verify(node("clipped").height == 12, "Explicit Yoga height overrides native font minimum")
  verify(data().textMeasurements > 0, "Fabric invokes native TextServer measurement during Yoga layout")
  verify(react().windowSubscribers == 1 and data().windowListener, "Window hook subscribes through the native host")
  verify_frames_match("initial")
  verify_layout_effect("initial")

  var allocation_count: int = data().creates
  await click("text-change")
  await frames(4)
  verify(node("intrinsic").width > short_text.width and node("intrinsic").height >= short_text.height, "Content update invalidates Yoga text measurement")
  verify(node("intrinsic").nativeText.contains("العربية"), "Unicode content reaches native shaped Label")
  verify(node("intrinsic").id == short_text.id and data().creates == allocation_count, "Content update keeps native identity and allocates no Controls")
  verify_frames_match("content")
  verify_layout_effect("content")
  surface.evaluate("GodotApp.run('short')")
  await frames(4)
  verify(abs(node("intrinsic").width - short_text.width) < 1, "Shorter content shrinks the previous measured width")
  await click("font-change")
  await frames(4)
  verify(node("intrinsic").width > short_text.width and node("intrinsic").height > short_text.height, "Font size update invalidates width and height")
  verify_frames_match("font")
  verify_layout_effect("font")
  await click("layout-count")
  await frames(4)

  var original_paragraph := node("paragraph")
  await click("paragraph-narrow")
  await frames(4)
  verify(node("paragraph").width == 280 and node("paragraph").height > original_paragraph.height, "Width constraint increases wrapped text height")
  verify(node("paragraph").visibleLines == node("paragraph").lines, "Padded wrapped Label shows every measured line")
  verify(node("after-paragraph").y >= node("paragraph").y + node("paragraph").height, "Yoga places following sibling after measured paragraph")
  verify_frames_match("paragraph narrow")
  surface.evaluate("GodotApp.run('fluid')")
  await frames(4)
  verify(node("paragraph").height == original_paragraph.height, "Widening a paragraph removes stale native height")

  var root_id: float = node("layout-root").id
  var paragraph_id: float = node("paragraph").id
  await resize_window(Vector2i(620, 900))
  verify(node("layout-root").width == 620 and node("layout-root").height == 900, "Native viewport changes Fabric root constraints")
  verify(node("dimensions").nativeText.contains("620 × 900") and node("dimensions").nativeText.contains("Estado: 1"), "Window hook rerenders dimensions and preserves React state")
  verify(node("paragraph").width == 572 and node("paragraph").height > original_paragraph.height, "Percentage layout reflows shaped text after native resize")
  verify_frames_match("small viewport")
  verify_layout_effect("small viewport")
  if "--capture" in OS.get_cmdline_user_args():
    await RenderingServer.frame_post_draw
    get_viewport().get_texture().get_image().save_png("res://build/layout-narrow.png")

  await resize_window(Vector2i(1100, 900))
  verify(node("layout-root").width == 1100 and node("paragraph").width == 1052, "Growing viewport recomputes percentage geometry")
  verify(node("paragraph").height <= original_paragraph.height, "Growing viewport shrinks wrapped paragraph height")
  verify(node("layout-root").id == root_id and node("paragraph").id == paragraph_id and data().creates == allocation_count, "Viewport changes preserve native tree identity without allocations")
  verify_frames_match("large viewport")
  verify_layout_effect("large viewport")
  var layouts_before: int = react().layouts.size()
  var updates_before: int = data().viewportUpdates
  await frames(8)
  verify(react().layouts.size() == layouts_before and data().viewportUpdates == updates_before, "Unchanged viewport produces no resize rerenders or commits")
  if "--capture" in OS.get_cmdline_user_args():
    await RenderingServer.frame_post_draw
    get_viewport().get_texture().get_image().save_png("res://build/layout-wide.png")
  var before_stop := data()
  remove_child(surface)
  var stopped := data()
  var stopped_react := react()
  verify(stopped.stopped and stopped.nodes.is_empty() and stopped.creates == stopped.deletes, "Scene exit releases every measured native Control")
  verify(stopped_react.cleanups == 1 and stopped_react.windowSubscribers == 0 and not stopped.windowListener, "Scene exit removes React window subscriptions and native callback")
  verify(stopped.errors.is_empty() and stopped.pendingTimers == 0, "Layout surface leaves no host errors or timers")
  surface.free()
  save_report("layout", before_stop, stopped, stopped_react)

func verify_frames_match(stage: String) -> void:
  var matches := true
  var visible := true
  for entry in data().nodes:
    matches = matches and abs(entry.width - entry.fabricWidth) < 1 and abs(entry.height - entry.fabricHeight) < 1
    if entry.kind == "text" and entry.testID != "clipped":
      visible = visible and entry.visibleLines == entry.lines
  verify(matches, "Fabric frames match actual Controls: " + stage)
  verify(visible, "Intrinsic text has no hidden lines: " + stage)

func verify_layout_effect(stage: String) -> void:
  var observation: Dictionary = react().layouts.back()
  verify(observation.width == node("intrinsic").width and observation.height == node("intrinsic").height and observation.native.width == observation.width and observation.native.height == observation.height, "Layout effect observes committed measured Control: " + stage)

func resize_window(size: Vector2i) -> void:
  get_window().size = size
  await wait_js("GodotApp.stats().layouts.slice(-1)[0].window.width === %d && GodotApp.stats().layouts.slice(-1)[0].window.height === %d" % [size.x, size.y], 4)
  await frames(4)
