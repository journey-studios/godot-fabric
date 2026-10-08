extends SceneTree

const CAPTURE_DIR := "res://docs/evidence/scroll-view/captures"
const BLUE := Color(29.0 / 255.0, 78.0 / 255.0, 216.0 / 255.0)
const LIGHT_BACKGROUND := Color(0.96, 0.97, 0.98, 1.0)

var app: Node
var primary: Control
var secondary: Control
var checks: Array[Dictionary] = []
var captures: Array[String] = []

func frames(count: int = 5) -> void:
  for index in range(count): await process_frame

func snapshot(target: Object) -> Dictionary:
  if target == null or not is_instance_valid(target): return {}
  var parsed: Variant = JSON.parse_string(target.call("snapshot"))
  return parsed if parsed is Dictionary else {}

func scroll(target: Control, test_id: String) -> Dictionary:
  for row: Dictionary in snapshot(target).get("nodes", []):
    if row.get("testID") == test_id: return row.get("scroll", {})
  return {}

func record(ok: bool, name: String, detail: Variant = null) -> void:
  checks.append({"name": name, "passed": ok, "detail": detail})
  if not ok: push_error("SCROLL_GRAPHICS_CHECK_FAILED: " + name)

func capture(label: String) -> Image:
  await process_frame
  await RenderingServer.frame_post_draw
  var image := get_root().get_texture().get_image()
  var path := CAPTURE_DIR + "/" + label + ".png"
  image.save_png(ProjectSettings.globalize_path(path))
  captures.append(path.trim_prefix("res://"))
  return image

func evaluate(source: String) -> Variant:
  return app.call("evaluate", source)

func touch(point: Vector2, down: bool) -> void:
  var event := InputEventScreenTouch.new()
  event.device = 1
  event.index = 0
  event.position = point
  event.pressed = down
  Input.parse_input_event(event)

func move(point: Vector2) -> void:
  var event := InputEventScreenDrag.new()
  event.device = 1
  event.index = 0
  event.position = point
  Input.parse_input_event(event)

func horizontal_pan(from: Vector2, to: Vector2) -> void:
  touch(from, true)
  await frames(2)
  for index in range(1, 5):
    move(from.lerp(to, float(index) / 4.0))
    await frames(2)
  touch(to, false)
  var deadline := Time.get_ticks_msec() + 3000
  for index in range(240):
    await process_frame
    var state := scroll(secondary, "secondary-scroll")
    if int(state.get("motion", -1)) == 0 and absf(float(state.get("x", 0)) - float(state.get("fabricX", -999))) < 0.01:
      return
    if Time.get_ticks_msec() >= deadline: return

func run() -> void:
  root.size = Vector2i(840, 420)
  DisplayServer.window_set_size(Vector2i(840, 420))
  RenderingServer.set_default_clear_color(LIGHT_BACKGROUND)
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(CAPTURE_DIR))
  app = ClassDB.instantiate("FabricApplication")
  if app == null:
    record(false, "FabricApplication is available")
    await finish()
    return
  app.name = "ScrollViewGraphicsApplication"
  app.set("bundle_path", "res://build/scroll-view-gf14-probe.js")
  root.add_child(app)
  primary = ClassDB.instantiate("FabricSurface") as Control
  secondary = ClassDB.instantiate("FabricSurface") as Control
  if primary == null or secondary == null:
    record(false, "two FabricSurface controls are available")
    await finish()
    return
  primary.name = "PrimaryScrollSurface"
  primary.set("application_path", NodePath("../ScrollViewGraphicsApplication"))
  primary.set("component_name", "ScrollViewFixture")
  primary.position = Vector2.ZERO
  primary.size = Vector2(420, 320)
  root.add_child(primary)
  secondary.name = "HorizontalScrollSurface"
  secondary.set("application_path", NodePath("../ScrollViewGraphicsApplication"))
  secondary.set("component_name", "SecondaryScrollViewFixture")
  secondary.position = Vector2(420, 0)
  secondary.size = Vector2(420, 320)
  root.add_child(secondary)
  await frames(30)
  var initial := scroll(primary, "scroll")
  var initial_image := await capture("initial")
  record(initial_image.get_width() == 840 and initial_image.get_height() == 420
      and float(initial.get("maxY", 0)) == 590.0,
    "initial frame contains both mounted roots at expected viewport size", {"size": initial_image.get_size(), "scroll": initial})

  evaluate("ScrollViewFixture.command('scrollTo',[{x:0,y:13.25,animated:false}])")
  await frames(4)
  evaluate("ScrollViewFixture.measureFirstRow()")
  await frames(6)
  var fractional := scroll(primary, "scroll")
  var measured: Dictionary = JSON.parse_string(evaluate("JSON.stringify(ScrollViewFixture.snapshot())")).get("measure", {})
  var fractional_image := await capture("fractional-13_25")
  record(is_equal_approx(float(fractional.get("y", -1)), 13.25)
      and is_equal_approx(float(fractional.get("fabricY", -1)), 13.25)
      and is_equal_approx(float(fractional.get("contentY", 0)), -13.25)
      and absf(float(measured.get("y", 999)) - 10.75) < 0.2
      and fractional_image.get_size() == Vector2i(840, 420),
    "fractional paint and RN measurement remain aligned at 13.25 px", {"native": fractional, "measure": measured})

  var viewport := secondary.find_child("secondary-scroll", true, false) as Control
  if viewport == null:
    record(false, "horizontal viewport is mounted for pixel clipping proof")
    await finish()
    return
  var rect := viewport.get_global_rect()
  await horizontal_pan(rect.get_center(), rect.get_center() + Vector2(-70, 0))
  var horizontal := scroll(secondary, "secondary-scroll")
  var horizontal_image := await capture("horizontal-pan-clipped")
  var inside := horizontal_image.get_pixel(650, 100)
  var outside := horizontal_image.get_pixel(680, 100)
  var inside_blue := absf(inside.r - BLUE.r) < 0.07 and absf(inside.g - BLUE.g) < 0.07 and absf(inside.b - BLUE.b) < 0.07
  var outside_blue := absf(outside.r - BLUE.r) < 0.07 and absf(outside.g - BLUE.g) < 0.07 and absf(outside.b - BLUE.b) < 0.07
  var outside_light: bool = (absf(outside.r - LIGHT_BACKGROUND.r) < 0.07
      and absf(outside.g - LIGHT_BACKGROUND.g) < 0.07 and absf(outside.b - LIGHT_BACKGROUND.b) < 0.07)
  record(horizontal.get("horizontal") == true and float(horizontal.get("x", 0)) >= 50.0
      and is_equal_approx(float(horizontal.get("contentX", 0)), -float(horizontal.get("x", 999)))
      and int(horizontal.get("motion", -1)) == 0 and inside_blue and not outside_blue and outside_light,
    "horizontal pan paints inside the viewport and clips blue content outside it", {
      "viewport": rect, "native": horizontal, "insidePixel": inside, "outsidePixel": outside})

  var app_before := snapshot(app)
  var primary_before := snapshot(primary)
  var secondary_before := snapshot(secondary)
  app.call("stop")
  await frames(8)
  var app_after := snapshot(app)
  var primary_after := snapshot(primary)
  var secondary_after := snapshot(secondary)
  var pointer_routing: Dictionary = app_after.get("pointerRouting", {})
  var pointer_processor: Dictionary = app_after.get("pointerProcessor", {})
  var clean: bool = (app_after.get("stopped") == true and int(app_after.get("rootCount", -1)) == 0
      and int(app_after.get("pendingRootRetirements", -1)) == 0 and int(app_after.get("pendingWork", -1)) == 0
      and int(app_after.get("pendingTimers", -1)) == 0 and int(app_after.get("pendingAnimationFrames", -1)) == 0
      and int(pointer_routing.get("active", -1)) == 0 and int(pointer_routing.get("contacts", -1)) == 0
      and int(pointer_processor.get("active", -1)) == 0 and int(pointer_processor.get("activeCapture", -1)) == 0)
  for surface_state: Dictionary in [primary_after, secondary_after]:
    var pointer: Dictionary = surface_state.get("pointer", {})
    clean = (clean and int(surface_state.get("nativeTags", -1)) == 0 and int(surface_state.get("retiringTags", -1)) == 0
        and int(pointer.get("activePointers", -1)) == 0 and int(pointer.get("activeTouches", -1)) == 0
        and int(pointer.get("takenPointers", -1)) == 0)
  record(clean, "both roots and all pointer/runtime ownership are empty after stop", {
    "before": {"app": app_before, "primary": primary_before, "secondary": secondary_before},
    "after": {"app": app_after, "primary": primary_after, "secondary": secondary_after}})
  if is_instance_valid(primary): primary.queue_free()
  if is_instance_valid(secondary): secondary.queue_free()
  if is_instance_valid(app): app.queue_free()
  await frames(2)
  await capture("cleanup")
  var report := {"scenario": "gf14-scroll-view-graphical-capture", "reactNative": "0.87.1",
    "godot": Engine.get_version_info(), "displayServer": DisplayServer.get_name(), "renderer": RenderingServer.get_current_rendering_method(),
    "checks": checks, "captures": captures}
  var file := FileAccess.open("res://build/scroll-view-graphics-report.json", FileAccess.WRITE)
  if file != null: file.store_string(JSON.stringify(report, "  ") + "\n")
  print("SCROLL_VIEW_GRAPHICS_REPORT=" + JSON.stringify(report))
  quit(0 if checks.all(func(row: Dictionary) -> bool: return row.passed) else 1)

func finish() -> void:
  if app != null and is_instance_valid(app): app.call("stop")
  await frames(5)
  quit(1)

func _initialize() -> void:
  call_deferred("run")
