extends "res://scripts/validation_base.gd"

var chart_stages: Array = []

func _ready() -> void:
  if DisplayServer.get_name() == "headless":
    get_window().size = Vector2i(900, 680)
  surface = FabricSurface.new()
  surface.set_meta("scenario", "chart")
  if "--validate" in OS.get_cmdline_user_args():
    surface.set_meta("validation_input_device", 1001)
  add_child(surface)
  if "--validate" not in OS.get_cmdline_user_args():
    return
  await wait_js("GodotApp.stats().mounts === 1")
  await frames(6)
  var initial := svg_root()
  verify(not initial.is_empty(), "Upstream LineChart commits a native SVG surface")
  verify(initial.width == 852 and initial.svg.textCount >= 15 and initial.svg.paintedPixels > 10000, "SVG raster contains pixels and native axis text in the expected viewport")
  verify(initial.svg.document.contains("<path") and initial.svg.document.contains("<linearGradient") and primitives("circle").size() == 8, "Original chart emits area gradient, line path and eight markers")
  verify(node("chart-title").visibleLines == 1, "Intrinsic title height shows the full native heading")
  verify(initial.svg.rasterLayers == 2, "Raster segments retain paint order around native text")
  await capture("chart-initial")
  var original_path := line_path()
  await chart_button("chart-data")
  await frames(5)
  verify(node("chart-state").nativeText.contains("Dados: 1") and line_path() != original_path and svg_root().svg.rasterHash != initial.svg.rasterHash, "React state update changes the library geometry committed to Godot")
  verify(svg_root().id == initial.id, "Dataset rerender preserves native SVG surface identity")
  var linear := line_path()
  await chart_button("chart-curve")
  await frames(5)
  verify(line_path() != linear and line_path().contains("C"), "Library monotone curve generates cubic path commands rendered by Godot")
  surface.evaluate("GodotApp.run('raf')")
  var motion := InputEventMouseMotion.new()
  motion.device = 1001
  motion.position = Vector2.ZERO
  get_viewport().push_input(motion, true)
  verify(react().raf.is_empty(), "Input event pumping cannot advance animation frame callbacks")
  await wait_js("GodotApp.stats().raf.length === 2")
  verify(not react().cancelledRan and react().raf[1] > react().raf[0], "Cancelled RAF stays cancelled and nested callback gets a later frame timestamp")

  await mouse("start", point(3))
  await wait_js("GodotApp.stats().selections.length >= 1")
  verify(react().selections.back().xLabel == "D4" and react().selections.back().series[0].value == 100, "Native pointer selects the original library point and updated value")
  await mouse("move", point(6))
  await wait_js("GodotApp.stats().selections.slice(-1)[0].xLabel === 'D7'")
  await mouse("end", point(6))
  await get_tree().create_timer(0.22).timeout
  verify(data().pointer.responder == 0 and data().pointer.activeTouches == 0, "Scrub release clears the original Fabric responder")
  verify(svg_root().svg.textCount > initial.svg.textCount and svg_root().svg.document.contains("cargo: 109"), "Library tooltip and active marker commit and paint after scrub")
  verify(data().animationFramesRun >= 4, "Library tooltip uses host animation frames")
  await capture("chart-selected")
  var rendered: int = svg_root().svg.renders
  await frames(12)
  verify(svg_root().svg.renders == rendered, "Idle frames reuse the committed SVG textures")

  get_window().size = Vector2i(2400, 820)
  await wait_js("godotWindowMetrics().width === 2400 && GodotApp.stats().layout.rects[0].width === 2048", 5)
  await frames(5)
  verify(svg_root().width == 2048 and node("library-chart").width == 2048 and data().errors.is_empty(), "Wide viewport caps both native chart container and SVG to the raster budget")
  verify(svg_root().id == initial.id and node("chart-selection").nativeText.contains("D7") and primitives("circle").size() >= 8, "Wide resize preserves chart identity, selection and data")
  await capture("chart-wide")

  get_window().size = Vector2i(640, 820)
  await wait_js("GodotApp.stats().layout.rects[0].width === 592", 5)
  await frames(5)
  verify(svg_root().width == 592 and svg_root().id == initial.id and node("chart-selection").nativeText.contains("D7"), "Native resize reflows chart while preserving surface identity and selection")
  await capture("chart-narrow")
  await chart_button("chart-empty")
  await frames(5)
  verify(primitives("circle").is_empty() and line_path().is_empty(), "Empty data removes all library markers and paths")
  await capture("chart-empty")
  await chart_button("chart-empty")
  await frames(5)
  verify(primitives("circle").size() >= 8 and not line_path().is_empty(), "Restoring data reconciles chart primitives into the same surface")
  var unclipped_hash: String = svg_root().svg.rasterHash
  surface.evaluate("GodotApp.run('threshold')")
  await frames(5)
  verify(primitives("clipPath").size() == 2 and svg_root().svg.document.contains("clip-path"), "Original threshold feature mounts clip path definitions and references")
  verify(svg_root().svg.rasterHash != unclipped_hash, "Threshold coloring changes native raster pixels")
  await capture("chart-threshold")
  surface.evaluate("GodotApp.run('negative')")
  verify(react().negatives.size() == 5 and not react().negatives.has("accepted"), "Hermes adapter rejects unsupported primitive, transform, invalid number, oversize and rich text")
  var old_id: float = svg_root().id
  surface.evaluate("GodotApp.run('visible')")
  await frames(4)
  verify(svg_root().is_empty(), "Unmount deletes the chart SVG subtree")
  surface.evaluate("GodotApp.run('visible')")
  await frames(6)
  verify(svg_root().id != old_id and svg_root().svg.paintedPixels > 10000, "Remount allocates a fresh SVG surface and renders it")
  surface.evaluate("GodotApp.run('pending')")
  verify(data().pendingAnimationFrames == 1, "Teardown fixture has a pending frame callback")
  var before := data()
  before["chartStages"] = chart_stages
  remove_child(surface)
  var stopped := data()
  var state := react()
  verify(not state.stoppedCallbackRan and stopped.errors.is_empty() and stopped.pendingTimers == 0 and stopped.pendingAnimationFrames == 0, "Chart leaves no errors, timers or animation callbacks")
  verify(stopped.nodes.is_empty() and stopped.creates == stopped.deletes and state.cleanups == 1 and state.windowSubscribers == 0, "Scene exit releases every SVG Control and React subscription")
  surface.free()
  save_report("chart", before, stopped, state)

func svg_root() -> Dictionary:
  for entry in data().nodes:
    if entry.get("svg", {}).get("tag", "") == "svg":
      return entry
  return {}

func primitives(tag: String) -> Array:
  return data().nodes.filter(func(entry): return entry.get("svg", {}).get("tag", "") == tag)

func line_path() -> String:
  for entry in primitives("path"):
    if entry.svg.attributes.get("fill", "") == "none":
      return entry.svg.attributes.d
  return ""

func point(index: int) -> Vector2:
  var marker: Dictionary = primitives("circle")[index].svg.attributes
  var control: Control = surface.find_child("library-chart", true, false)
  return control.global_position + Vector2(float(marker.cx), float(marker.cy))

func mouse(phase: String, position: Vector2) -> void:
  if phase == "move":
    var event := InputEventMouseMotion.new()
    event.device = 1001
    event.position = position
    event.button_mask = MOUSE_BUTTON_MASK_LEFT
    get_viewport().push_input(event, true)
  else:
    var event := InputEventMouseButton.new()
    event.device = 1001
    event.position = position
    event.button_index = MOUSE_BUTTON_LEFT
    event.pressed = phase == "start"
    get_viewport().push_input(event, true)
  await frames(2)

func chart_button(id: String) -> void:
  if DisplayServer.get_name() == "headless":
    await click(id)
  else:
    var control: Control = surface.find_child(id, true, false)
    var motion := InputEventMouseMotion.new()
    motion.device = 1001
    motion.position = control.get_global_rect().get_center()
    get_viewport().push_input(motion, true)
    await frames(1)
    await mouse("start", control.get_global_rect().get_center())
    await mouse("end", control.get_global_rect().get_center())

func capture(name: String) -> void:
  var root := svg_root()
  chart_stages.append({"stage": name, "surfaceID": root.id, "width": root.width, "height": root.height, "svg": root.svg})
  if "--capture" in OS.get_cmdline_user_args():
    await RenderingServer.frame_post_draw
    get_viewport().get_texture().get_image().save_png("res://build/" + name + ".png")
