extends Node

# The public Image example under real mouse input. Every picture is read from the native GodotImage that shows it (its source,
# its texture, the rectangles it drew) and from what JS observed, across actual SceneTree frames; the loader's own record says
# which thread read and decoded each one. The scene also starts a small HTTP server on loopback (local_server.gd) and hands its address
# to the screen, whose network row downloads a picture, mounts it again and asks for one that is not there; the server counts what
# it is asked. With --capture the renderer's frame is saved and sampled too.
const LocalServer := preload("res://examples/images/local_server.gd")
const DEVICE := 1001
const SCALE := 2.0
const MODES := ["cover", "contain", "stretch", "center", "repeat", "none"]
const IMAGE_IDS := ["images-mode-cover", "images-mode-contain", "images-mode-stretch", "images-mode-center", "images-mode-repeat", "images-mode-none",
  "images-logo", "images-data-png", "images-data-svg", "images-background", "images-missing", "images-net-photo", "images-net-missing", "images-preview"]
const BACKGROUND := Color8(30, 41, 59)
const RED := Color8(239, 68, 68)
const WHITE := Color8(255, 255, 255)
# A 120x60 point landscape in an 84x84 frame, as UIKit's content modes draw it: [dst, src] in points of the content frame and the picture.
const TILE_RECTS := {
  "cover": [[0.0, 0.0, 84.0, 84.0], [30.0, 0.0, 60.0, 60.0]], "contain": [[0.0, 21.0, 84.0, 42.0], [0.0, 0.0, 120.0, 60.0]],
  "stretch": [[0.0, 0.0, 84.0, 84.0], [0.0, 0.0, 120.0, 60.0]], "center": [[0.0, 12.0, 84.0, 60.0], [18.0, 0.0, 84.0, 60.0]],
  "repeat": [[0.0, 0.0, 84.0, 84.0], [0.0, 0.0, 120.0, 60.0]], "none": [[0.0, 0.0, 84.0, 60.0], [0.0, 0.0, 84.0, 60.0]]}
# The same picture in the 150x90 preview.
const PREVIEW_RECTS := {
  "cover": [[0.0, 0.0, 150.0, 90.0], [10.0, 0.0, 100.0, 60.0]], "contain": [[0.0, 7.5, 150.0, 75.0], [0.0, 0.0, 120.0, 60.0]],
  "stretch": [[0.0, 0.0, 150.0, 90.0], [0.0, 0.0, 120.0, 60.0]], "center": [[15.0, 15.0, 120.0, 60.0], [0.0, 0.0, 120.0, 60.0]],
  "repeat": [[0.0, 0.0, 150.0, 90.0], [0.0, 0.0, 120.0, 60.0]], "none": [[0.0, 0.0, 120.0, 60.0], [0.0, 0.0, 120.0, 60.0]]}
var checks: Array = []
var stages: Dictionary = {}
var samples: Dictionary = {}
var capturing := false
var validating := false
var server := LocalServer.new()
@onready var application: Node = $Application
@onready var surface: Control = $Surface

# The density is the example's: RN's PixelRatio is the content scale, and the logo has @1x, @2x and @3x files. A validation
# pins it at 2, so that the same file is chosen on every machine; a person running the example gets the screen's own.
func _enter_tree() -> void:
  validating = OS.get_cmdline_user_args().has("--validate")
  var scale := SCALE if validating else maxf(1.0, DisplayServer.screen_get_scale())
  var window := get_window()
  window.content_scale_size = Vector2i.ZERO
  window.content_scale_mode = Window.CONTENT_SCALE_MODE_CANVAS_ITEMS
  window.size = Vector2i(roundi(900 * scale), roundi(840 * scale))
  window.content_scale_factor = scale
  # The address is a prop of the root, so the server listens before the screen renders.
  if server.start() != OK:
    push_error("FABRIC_ERROR: The example's local server could not listen on loopback")
  get_node("Surface").set("initial_props", {"baseUrl": "http://127.0.0.1:%d" % server.port})

func _process(_delta: float) -> void:
  server.poll()

func _exit_tree() -> void:
  server.stop()

func verify(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

func frames(count: int = 1) -> void:
  for index in range(count):
    await get_tree().process_frame

func wait_for(condition: Callable, limit_ms: int = 8000) -> bool:
  var started := Time.get_ticks_msec()
  while Time.get_ticks_msec() - started < limit_ms and not condition.call():
    await frames()
  return condition.call()

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(" + expression + ")"))

func example() -> Dictionary:
  var value: Variant = js("globalThis.ImagesExample.state()")
  return value if value is Dictionary else {}

func native_state() -> Dictionary:
  var value: Variant = JSON.parse_string(application.call("snapshot"))
  return value if value is Dictionary else {}

func loader() -> Dictionary:
  return native_state().get("images", {})

func nodes() -> Array:
  var value: Variant = JSON.parse_string(surface.call("snapshot"))
  var all: Variant = value.get("nodes", []) if value is Dictionary else []
  return all if all is Array else []

func node_of(id: String) -> Dictionary:
  for entry: Dictionary in nodes():
    if entry.get("testID") == id:
      return entry
  return {}

func view(id: String) -> Dictionary:
  return node_of(id).get("image", {})

func picture(id: String) -> Dictionary:
  var value: Variant = view(id).get("image", null)
  return value if value is Dictionary else {}

func rect(value: Variant) -> Array:
  if not value is Dictionary:
    return []
  return [float(value.x), float(value.y), float(value.width), float(value.height)]

# The rectangles are doubles the host computed; a crop of a picture that does not divide evenly differs from a table in the last bits.
func close(actual: Array, expected: Array) -> bool:
  if actual.size() != expected.size() or actual.is_empty():
    return false
  for index in range(actual.size()):
    if absf(float(actual[index]) - float(expected[index])) > 0.0001:
      return false
  return true

func drawn(id: String, key: String) -> Array:
  var value: Variant = view(id).get("drawn", null)
  return rect(value.get(key, null)) if value is Dictionary else []

func control(id: String) -> Control:
  return surface.find_child(id, true, false) as Control

func at(id: String) -> Vector2:
  return control(id).get_global_rect().get_center()

# Every Image has told JS how it ended, and the loader has nothing left to do.
func settled() -> bool:
  var state := loader()
  var found := nodes().filter(func(entry: Dictionary) -> bool: return entry.get("kind") == "image")
  return (found.size() >= IMAGE_IDS.size() and found.all(func(entry: Dictionary) -> bool: return entry.image.status != "loading" and entry.image.status != "idle")
    and int(state.get("pending", 1)) == 0 and int(state.get("inFlight", 1)) == 0 and int(state.get("ready", 1)) == 0
    and int(state.get("fresh", 1)) == 0 and int(state.get("downloading", 1)) == 0)

func mouse(phase: String, point: Vector2) -> void:
  if phase == "down":
    var motion := InputEventMouseMotion.new()
    motion.device = DEVICE
    motion.position = point
    Input.parse_input_event(motion)
  var button := InputEventMouseButton.new()
  button.device = DEVICE
  button.position = point
  button.button_index = MOUSE_BUTTON_LEFT
  button.pressed = phase == "down"
  button.button_mask = MOUSE_BUTTON_MASK_LEFT if phase == "down" else 0
  Input.parse_input_event(button)
  await frames(2)

# A full click. Pressability keeps a press visible for at least 130 ms, so the pressed style is released a little after the mouse is.
func click(id: String) -> void:
  # Injected events are in window pixels; the Control's rectangle is in the content coordinates the window scales.
  var point := get_window().get_final_transform() * at(id)
  await mouse("down", point)
  await frames(3)
  await mouse("up", point)
  await wait_for(func() -> bool: return is_equal_approx(control(id).modulate.a, 1.0))
  await frames(2)

# The readback rectangle of a Control, in the physical pixels of the saved frame.
func region(node: Control) -> Rect2i:
  var physical := get_window().get_final_transform() * node.get_global_rect()
  return Rect2i(Vector2i(physical.position.round()), Vector2i(physical.size.round()))

func digest(image: Image, area: Rect2i) -> String:
  var context := HashingContext.new()
  context.start(HashingContext.HASH_SHA256)
  context.update(image.get_region(area).get_data())
  return context.finish().hex_encode()

func near(a: Color, b: Color) -> bool:
  return absf(a.r - b.r) < 0.09 and absf(a.g - b.g) < 0.09 and absf(a.b - b.b) < 0.09

# The pixel of the saved frame at a point of a Control, given in points of that Control.
func pixel(image: Image, id: String, point: Vector2) -> Color:
  var area := region(control(id))
  var scale := get_window().content_scale_factor
  return image.get_pixel(area.position.x + roundi(point.x * scale), area.position.y + roundi(point.y * scale))

func capture(stage: String) -> Image:
  if not capturing:
    return null
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  verify(image.save_png("res://build/images-%s.png" % stage) == OK, "Renderer capture saved: " + stage)
  var frame := Rect2i(Vector2i.ZERO, image.get_size())
  var digests := {}
  var inside := true
  var ids := IMAGE_IDS.duplicate()
  if control("images-net-again") != null:
    ids.append("images-net-again")
  for id: String in ids:
    var area := region(control(id))
    inside = inside and area.has_area() and frame.encloses(area)
    digests[id] = digest(image, area) if area.has_area() and frame.encloses(area) else ""
  verify(inside, "Every picture lies inside the captured frame: " + stage)
  samples[stage] = digests
  return image

func _ready() -> void:
  if not validating:
    return
  capturing = OS.get_cmdline_user_args().has("--capture")
  surface.set_meta("validation_input_device", DEVICE)
  await run()

# The network row: a PNG downloaded from the scene's server, and an address it answers 404 for.
func verify_network(state: Dictionary, jobs: Array) -> void:
  var photo := view("images-net-photo")
  var made := picture("images-net-photo")
  var events: Dictionary = state.events
  var progress: Dictionary = state.progress.get("net-photo", {})
  verify(photo.get("status") == "loaded" and made.get("format") == "png" and int(made.get("width", 0)) == 192 and int(made.get("height", 0)) == 128 and float(made.get("scale", 0)) == 2.0
    and close(drawn("images-net-photo", "dst"), [0.0, 0.0, 96.0, 64.0]) and close(drawn("images-net-photo", "src"), [0.0, 0.0, 96.0, 64.0]),
    "The PNG the server drew is downloaded and decoded: 192x128 pixels at scale 2 fill the 96x64 point frame")
  verify(events["net-photo"].size() >= 4 and events["net-photo"][0] == "loadStart" and events["net-photo"][1] == "progress"
    and events["net-photo"][events["net-photo"].size() - 2] == "load" and events["net-photo"][events["net-photo"].size() - 1] == "loadEnd"
    and int(progress.get("loaded", 0)) > 0 and int(progress.get("loaded", 0)) == int(progress.get("total", -1)) and server.count(LocalServer.SUNRISE) == 1,
    "JS saw loadStart, progress up to the whole body, load and loadEnd for the download, and the server was asked once")
  var net_jobs: Array = jobs.filter(func(job: Dictionary) -> bool: return String(job.uri).ends_with(LocalServer.SUNRISE))
  verify(net_jobs.size() == 1 and net_jobs[0].served == "network" and net_jobs[0].thread.worker == true and String(net_jobs[0].thread.id) != String(loader().hostThread),
    "The downloaded bytes were sniffed, measured and decoded on a worker thread, not on the main thread")
  var missing := view("images-net-missing")
  var failure: Dictionary = state.errors.get("net-missing", {})
  verify(missing.status == "failed" and missing.image == null and failure.get("responseCode") == 404.0 and failure.get("error") == "Failed to load http://127.0.0.1:%d%s" % [server.port, LocalServer.MISSING]
    and failure.get("httpResponseHeaders", {}).get("X-Reason") == "the example has two pictures" and events["net-missing"].has("error") and server.count(LocalServer.MISSING) == 1
    and String(node_of("net-missing-status").get("nativeText", "")) == "HTTP 404",
    "A 404 fails through onError with Failed to load <URL>, the status and the response headers, leaves no texture, and the tile shows the status")

func run() -> void:
  var mounted := await wait_for(func() -> bool: return IMAGE_IDS.all(func(id: String) -> bool: return control(id) != null) and control("images-next-mode") != null)
  verify(mounted, "The public example mounts its fourteen Images and its two buttons, and the third button waits for the click that mounts a fifteenth")
  var ready := await wait_for(settled)
  await frames(6)
  verify(ready and nodes().filter(func(entry: Dictionary) -> bool: return entry.get("kind") == "image").size() == IMAGE_IDS.size(),
    "Each Image is a native GodotImage and every picture has finished loading or failing")
  var state := example()
  var logo := picture("images-logo")
  verify(state.get("pixelRatio") == SCALE and String(state.logo.uri).ends_with("/assets/examples/images/assets/logo@2x.png") and float(state.logo.scale) == 2.0,
    "RN's pickScale chooses logo@2x.png at a pixel ratio of 2 and the resolver names the file beside the bundle")
  verify(int(logo.get("width", 0)) == 64 and int(logo.get("height", 0)) == 64 and float(logo.get("scale", 0)) == 2.0
    and float(node_of("images-logo").get("fabricWidth", 0)) == 32.0 and float(node_of("images-logo").get("fabricHeight", 0)) == 32.0,
    "The logo's texture has the @2x file's 64x64 pixels while its layout is the asset's 32x32 points")
  var all_loaded := IMAGE_IDS.all(func(id: String) -> bool: return id == "images-missing" or id == "images-net-missing" or view(id).get("status") == "loaded")
  verify(all_loaded, "Every picture that exists is loaded")

  var rects_match := true
  for mode: String in MODES:
    var id := "images-mode-" + mode
    rects_match = rects_match and close(drawn(id, "dst"), TILE_RECTS[mode][0]) and close(drawn(id, "src"), TILE_RECTS[mode][1]) and view(id).mode == mode
  verify(rects_match, "The six resize modes draw the rectangles UIKit draws for a 120x60 point landscape in an 84x84 point frame")
  var tiled: Dictionary = view("images-mode-repeat").drawn
  verify(bool(tiled.tiled) and float(tiled.tileWidth) == 120.0 and float(tiled.tileHeight) == 60.0, "Repeat tiles the picture at its size in points")

  var sprite := picture("images-data-png")
  var badge := picture("images-data-svg")
  verify((int(sprite.get("width", 0)) == 32 and sprite.get("format") == "png" and close(drawn("images-data-png", "dst"), [28.0, 28.0, 16.0, 16.0])
    and badge.get("format") == "svg" and int(badge.get("width", 0)) == 128 and int(badge.get("height", 0)) == 128),
    "The data: PNG is decoded at the request's scale and shown at its size in points; the data: SVG is rasterized at the content scale, 64 points are 128 pixels")
  verify(node_of("images-background-text").has("tag") and float(node_of("images-background").get("fabricWidth", 0)) == 96.0
    and view("images-background").get("status") == "loaded", "The ImageBackground draws its picture under its Text child")
  var missing := view("images-missing")
  verify(missing.status == "failed" and missing.image == null and missing.drawn == null and String(missing.error).contains("Could not find image")
    and String(node_of("missing-status").get("nativeText", "")).contains("Could not find image"),
    "A picture that does not exist fails through onError, leaves no texture and shows why")
  var events: Dictionary = state.events
  var sequences := true
  for id: String in ["mode-cover", "logo", "data-png", "data-svg", "background", "preview"]:
    sequences = sequences and events[id] == ["loadStart", "load", "loadEnd"]
  verify(sequences and events.missing == ["loadStart", "error", "loadEnd"], "JS saw loadStart, load and loadEnd for each picture, and loadStart, error and loadEnd for the missing one")
  var state_of_loader := loader()
  var jobs: Array = state_of_loader.jobs
  # A download that fails before its body is a picture (the 404) has nothing to decode and never reaches a worker.
  var workers := jobs.all(func(job: Dictionary) -> bool: return String(job.format) == "" or (job.thread.worker == true and String(job.thread.id) != String(state_of_loader.hostThread)))
  verify(jobs.size() == IMAGE_IDS.size() and workers and jobs.filter(func(job: Dictionary) -> bool: return String(job.format) != "").size() == IMAGE_IDS.size() - 2
    and int(state_of_loader.counters.failed) == 2 and int(state_of_loader.counters.loaded) == 12,
    "All fourteen pictures were asked for, the twelve that exist were read and decoded on worker threads, twelve loaded and two failed")
  stages.mounted = {"example": state, "loader": state_of_loader, "nodes": nodes()}
  verify_network(state, jobs)
  var image := await capture("all-modes")
  if image != null:
    var tile_samples := {}
    var stretch_red := near(pixel(image, "images-mode-stretch", Vector2(1, 42)), RED)
    var contain_red := near(pixel(image, "images-mode-contain", Vector2(1, 42)), RED)
    var repeat_red := near(pixel(image, "images-mode-repeat", Vector2(1, 30)), RED)
    var cover_red := near(pixel(image, "images-mode-cover", Vector2(1, 42)), RED)
    var center_red := near(pixel(image, "images-mode-center", Vector2(1, 42)), RED)
    tile_samples = {"stretch": stretch_red, "contain": contain_red, "repeat": repeat_red, "cover": cover_red, "center": center_red}
    verify(stretch_red and contain_red and repeat_red and not cover_red and not center_red,
      "The renderer shows the left-edge mark in stretch, contain and repeat, and crops it out in cover and center")
    var none_top := near(pixel(image, "images-mode-none", Vector2(1.5, 1.5)), WHITE)
    var none_bottom := near(pixel(image, "images-mode-none", Vector2(40, 80)), BACKGROUND)
    var contain_bar := near(pixel(image, "images-mode-contain", Vector2(40, 8)), BACKGROUND)
    verify(none_top and none_bottom and contain_bar, "The renderer draws none at the top-left corner, leaving the bottom of the frame bare, and contain between two bare bars")
    var distinct := {}
    for mode: String in MODES:
      distinct[samples["all-modes"]["images-mode-" + mode]] = true
    verify(distinct.size() == MODES.size(), "The six tiles are drawn differently: six distinct renderer digests")
    verify(samples["all-modes"]["images-missing"] != samples["all-modes"]["images-logo"], "The failed picture left no pixels of a picture")
    stages.pixels = tile_samples

  # Real clicks cycle the preview through the six modes, with no new load.
  var requested := int(loader().counters.requested)
  var cycle_ok := true
  var pictures_match := true
  var cycles: Array = []
  for step in range(1, MODES.size() + 1):
    await click("images-next-mode")
    var expected: String = MODES[step % MODES.size()]
    cycle_ok = cycle_ok and await wait_for(func() -> bool: return view("images-preview").get("mode") == expected)
    await frames(2)
    pictures_match = (pictures_match and close(drawn("images-preview", "dst"), PREVIEW_RECTS[expected][0]) and close(drawn("images-preview", "src"), PREVIEW_RECTS[expected][1])
      and String(node_of("images-preview-mode").get("nativeText", "")) == 'resizeMode="%s"' % expected)
    cycles.append({"mode": expected, "view": view("images-preview")})
  verify(cycle_ok and pictures_match, "Six real clicks on the button take the preview through contain, stretch, center, repeat, none and cover, redrawing it each time")
  verify(int(loader().counters.requested) == requested and view("images-preview").counters.loads == 1, "Changing the resize mode loads nothing")
  stages.cycle = cycles

  await click("images-next-mode")
  await click("images-next-mode")
  await click("images-next-mode")
  # The swap loads another picture: a new request, one loadStart and one load.
  await click("images-swap")
  var swapped := await wait_for(func() -> bool: return int(loader().counters.requested) == requested + 1 and settled())
  await frames(4)
  var after := example()
  verify(swapped and after.picture == "logo" and String(view("images-preview").source.uri).ends_with("logo@2x.png") and picture("images-preview").get("width") == 64
    and after.events.preview == ["loadStart", "load", "loadEnd", "loadStart", "load", "loadEnd"],
    "A click on the second button swaps the picture: a new request, one loadStart and one load, and the logo's @2x file")
  stages.swap = {"example": after, "view": view("images-preview")}
  # The same address and size mounted again is answered from memory: no second request, no progress, and the picture is shared.
  var textures := int(loader().liveTextures)
  var asked := server.count(LocalServer.SUNRISE)
  # The button is replaced by the Image it mounts, so there is no pressed style to wait out.
  var point := get_window().get_final_transform() * at("images-net-mount")
  await mouse("down", point)
  await frames(3)
  await mouse("up", point)
  var again := await wait_for(func() -> bool: return control("images-net-again") != null and view("images-net-again").get("status") == "loaded")
  await frames(4)
  var remounted := example()
  var newest: Array = loader().jobs.filter(func(job: Dictionary) -> bool: return String(job.uri).ends_with(LocalServer.SUNRISE))
  verify(again and server.count(LocalServer.SUNRISE) == asked and newest.size() == 2 and newest[1].served == "decoded" and newest[1].thread.worker == false
    and remounted.events["net-again"] == ["loadStart", "load", "loadEnd"] and int(loader().liveTextures) == textures
    and picture("images-net-again").get("fingerprint") == picture("images-net-photo").get("fingerprint")
    and String(node_of("net-again-status").get("nativeText", "")) == "loaded 192x128 px",
    "Mounting the same address and size again is answered by the decoded cache: the server is not asked again, no progress is reported and the two Images share one picture")
  stages.remount = {"example": remounted, "jobs": newest, "textures": [textures, int(loader().liveTextures)]}
  await capture("interaction")
  await finish()

func finish() -> void:
  application.call("stop")
  await frames(8)
  var finished := native_state()
  var last: Dictionary = finished.get("images", {})
  verify(finished.get("stopped", false) and finished.get("rootCount", -1) == 0 and finished.get("errors", []).is_empty(),
    "Stop releases the root and every picture without a host error")
  verify(int(last.counters.tasksStarted) == int(last.counters.tasksAwaited) and int(last.inFlight) == 0 and int(last.liveTextures) == 0
    and int(last.downloading) == 0 and int(last.network.active) == 0 and int(last.network.queued) == 0,
    "Every worker task was awaited, no download is left and no texture outlives the application")
  var report := {"scenario": "images", "godot": Engine.get_version_info().string, "react": "19.2.3", "reactNative": "0.87.1",
    "engine": "hermes", "renderer": "fabric", "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages,
    "samples": samples, "scale": SCALE, "applicationStopped": finished}
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://build"))
  var output := FileAccess.open("res://build/report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_ERROR: Cannot write the images report")
    get_tree().quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  print("FABRIC_VALIDATION_FAILED: images" if failed else "FABRIC_VALIDATION_PASSED: images " + str(checks.size()))
  get_tree().quit(1 if failed else 0)
