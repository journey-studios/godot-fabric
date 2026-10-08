extends SceneTree

# RN's own Image over the host's native image pipeline: RN's ImageShadowNode, ImageRequest and observers, a host
# ImageManager whose loader reads and decodes on Godot's worker pool, and a GodotImage view. Every phase waits for a state
# (the loader idle, a request in flight, a log complete), never for a number of frames. The pool is held with the
# certification fixture module wherever a decode has to be in flight.
const SCALE := 2.0
const FORMATS := "res://tests/fixtures/images/formats/"
const USER_FILE := "user://images-probe/wide.png"
const MODES := ["cover", "contain", "stretch", "center", "repeat", "none"]
var application: Node
var surface_a: Control
var surface_b: Control
var checks: Array = []
var stages: Dictionary = {}
var allow_original_negative := false
var sabotage := false
var expected_original_failures: Array = []
var manifest: Dictionary = {}
var inputs: Dictionary = {}
var declared: Array = []

func check(condition: bool, name: String, normative: bool = false) -> bool:
  checks.append({"name": name, "passed": condition})
  if normative:
    expected_original_failures.append(name)
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

func settle(count: int = 6) -> void:
  for index in range(count):
    await process_frame

# True once the predicate holds; a state is awaited, never a count of frames.
func wait_until(predicate: Callable, limit: int = 900) -> bool:
  for index in range(limit):
    if predicate.call():
      return true
    await process_frame
  return false

func js_json(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(" + expression + ")"))

func react() -> Dictionary:
  var value: Variant = js_json("ImagesProbe.snapshot()")
  return value if value is Dictionary else {}

func run_js(expression: String) -> void:
  application.call("evaluate", "ImagesProbe." + expression)

func native(target: Object) -> Dictionary:
  var value: Variant = JSON.parse_string(target.call("snapshot"))
  return value if value is Dictionary else {}

func loader() -> Dictionary:
  return native(application).get("images", {})

func counters() -> Dictionary:
  return loader().get("counters", {})

func errors() -> Array:
  return native(application).get("errors", [])

# The pool is full and every worker in it has finished its job and waits at the gate: whatever happens to the requests
# now happens to decodes that are done.
func held_flight(count: int) -> bool:
  var state := loader()
  return int(state.get("inFlight", -1)) == count and int(state.get("atGate", -2)) == count

func idle(expected_requests: int = 0) -> bool:
  var state := loader()
  var done: Dictionary = state.get("counters", {})
  return (int(state.get("pending", 1)) == 0 and int(state.get("inFlight", 1)) == 0 and int(state.get("finished", 1)) == 0
    and int(state.get("ready", 1)) == 0 and int(done.get("requested", 0)) >= expected_requests)

func node_of(test_id: String, surface: Control = null) -> Dictionary:
  for entry: Dictionary in native(surface if surface != null else surface_a).get("nodes", []):
    if entry.testID == test_id:
      return entry
  return {}

func view(case_id: String) -> Dictionary:
  return node_of("A-" + case_id).get("image", {})

func picture(case_id: String) -> Dictionary:
  var value: Variant = view(case_id).get("image", null)
  return value if value is Dictionary else {}

func types(case_id: String, logs: Dictionary) -> Array:
  var out: Array = []
  for event: Dictionary in logs.get("A-" + case_id, []):
    out.append(event.type)
  return out

func event_of(case_id: String, logs: Dictionary, type: String) -> Dictionary:
  for event: Dictionary in logs.get("A-" + case_id, []):
    if event.type == type:
      return event
  return {}

func dimensions(result: Dictionary) -> Array:
  if not bool(result.get("ok", false)):
    return []
  return [int(result.value.width), int(result.value.height)]

func rect(value: Variant) -> Array:
  if not value is Dictionary:
    return []
  return [float(value.x), float(value.y), float(value.width), float(value.height)]

func jobs_for(part: String) -> Array:
  return loader().get("jobs", []).filter(func(job: Dictionary) -> bool: return String(job.uri).contains(part))

func fingerprint(path: String) -> String:
  return String(manifest.get("files", {}).get(path, {}).get("fingerprint", "?"))

func mount_surface(name: String, component: String, position: Vector2, size: Vector2, props: Dictionary) -> Control:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = name
  surface.position = position
  surface.size = size
  surface.set("application_path", NodePath("../ImagesApplication"))
  surface.set("component_name", component)
  surface.set("initial_props", props)
  root.add_child(surface)
  return surface

func prepare_files() -> void:
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("user://images-probe"))
  var source := FileAccess.get_file_as_bytes("res://tests/fixtures/images/assets/wide.png")
  var copy := FileAccess.open(USER_FILE, FileAccess.WRITE)
  copy.store_buffer(source)
  copy.close()
  manifest = JSON.parse_string(FileAccess.get_file_as_string("res://tests/fixtures/images/manifest.json"))
  inputs = {"name": "A", "userUri": USER_FILE,
    "fileUri": "file://" + ProjectSettings.globalize_path("res://tests/fixtures/images/assets/wide.png"),
    "missingUri": "file://" + ProjectSettings.globalize_path(FORMATS) + "missing.png",
    "corruptUri": "file://" + ProjectSettings.globalize_path("res://tests/fixtures/images/broken/corrupt.png")}

# ---- stages ----

func mount_stage() -> void:
  var value := react()
  var nodes: Array = native(surface_a).get("nodes", []).filter(func(row: Dictionary) -> bool: return row.kind == "image")
  var expected := declared.size() + 3
  check(nodes.size() == expected and not value.is_empty(),
    "mount/Every Image of the fixture mounts one native GodotImage: the declared cases, the scale probe, the ImageBackground and the Animated.Image", true)
  check(errors().is_empty(), "mount/The application reports no host or runtime error")
  check(int(counters().get("requested", 0)) == expected and value.boundaries.keys().all(func(key: String) -> bool: return key.contains("refusal")),
    "mount/Every Image asked the loader for exactly one request and none failed to render", true)
  stages.mount = {"react": value, "nodes": nodes.size(), "surface": native(surface_a), "loader": loader(), "declared": declared}

func bundled_stage() -> void:
  var logs: Dictionary = stages.mount.react.logs
  var loaded := picture("badge")
  var expected := fingerprint("assets/badge@2x.png")
  check(react().pixelRatio == SCALE, "bundled/RN's PixelRatio is the content scale of the window, 2")
  check(String(view("badge").source.uri).ends_with("/assets/tests/fixtures/images/assets/badge@2x.png"),
    "bundled/pickScale chooses the @2x variant at a pixel ratio of 2 and AssetSourceResolver names it beside the bundle", true)
  check(int(loaded.get("width", 0)) == 32 and int(loaded.get("height", 0)) == 32 and float(loaded.get("scale", 0)) == 2.0,
    "bundled/The texture has the pixels of the chosen variant: 32x32 at scale 2", true)
  check(String(loaded.get("fingerprint", "")) == expected and expected != "?",
    "bundled/The decoded pixels are those of badge@2x.png in the fixture manifest", true)
  var node := node_of("A-badge")
  check(float(node.get("fabricWidth", 0)) == 16.0 and float(node.get("fabricHeight", 0)) == 16.0,
    "bundled/Layout uses the asset's size in points, 16x16", true)
  check(types("badge", logs) == ["loadStart", "progress", "load", "loadEnd"],
    "bundled/A bundled asset reports loadStart, progress, load and loadEnd in that order, once each", true)
  var progress := event_of("badge", logs, "progress")
  check(float(progress.get("progress", 0)) == 1.0 and float(progress.get("loaded", 0)) == 1.0 and float(progress.get("total", 0)) == 1.0,
    "bundled/RCTBundleAssetImageLoader's progress is (1, 1)", true)
  var load := event_of("badge", logs, "load")
  check(float(load.get("width", 0)) == 32.0 and float(load.get("height", 0)) == 32.0 and String(load.get("uri", "")).ends_with("badge@2x.png"),
    "bundled/onLoad reports the source uri and the size in pixels", true)
  var big := picture("badge-big")
  check(int(big.get("width", 0)) == 32 and rect(view("badge-big").get("drawn", {}).get("dst", null)) == [0.0, 0.0, 64.0, 64.0],
    "bundled/A bundled asset is never resized by the decoder; the view stretches it", true)
  stages.bundled = {"badge": view("badge"), "big": view("badge-big")}

func modes_stage() -> void:
  var expected := {
    "cover": {"dst": [0.0, 0.0, 60.0, 60.0], "src": [10.0, 0.0, 20.0, 20.0]},
    "contain": {"dst": [0.0, 15.0, 60.0, 30.0], "src": [0.0, 0.0, 40.0, 20.0]},
    "stretch": {"dst": [0.0, 0.0, 60.0, 60.0], "src": [0.0, 0.0, 40.0, 20.0]},
    "center": {"dst": [10.0, 20.0, 40.0, 20.0], "src": [0.0, 0.0, 40.0, 20.0]},
    "repeat": {"dst": [0.0, 0.0, 60.0, 60.0], "src": [0.0, 0.0, 40.0, 20.0]},
    "none": {"dst": [0.0, 0.0, 40.0, 20.0], "src": [0.0, 0.0, 40.0, 20.0]}}
  var drawn: Dictionary = {}
  var all_match := true
  for mode: String in MODES:
    var snapshot := view("mode-" + mode)
    var current: Dictionary = snapshot.get("drawn", {}) if snapshot.get("drawn", null) is Dictionary else {}
    drawn[mode] = current
    all_match = all_match and not current.is_empty() and rect(current.get("dst", null)) == expected[mode].dst and rect(current.get("src", null)) == expected[mode].src
  check(all_match, "modes/Each of the six resize modes draws the rectangles UIKit draws for a 40x20 point picture in a 60x60 point frame", true)
  check(bool(drawn.repeat.get("tiled", false)) and float(drawn.repeat.get("tileWidth", 0)) == 40.0 and float(drawn.repeat.get("tileHeight", 0)) == 20.0
    and not bool(drawn.cover.get("tiled", true)), "modes/Repeat tiles the picture at its size in points and no other mode tiles", true)
  var small: Dictionary = view("mode-small-center").get("drawn", {})
  check(rect(small.get("dst", null)) == [11.0, 11.0, 8.0, 8.0], "modes/Center keeps a small picture its size and centers it", true)
  var contained: Dictionary = view("mode-fit").get("drawn", {})
  check(rect(contained.get("dst", null)) == [0.0, 15.0, 60.0, 30.0], "modes/style.objectFit contain reaches the native view as the contain mode", true)
  var inset := view("mode-inset")
  check(rect(inset.get("content", null)) == [5.0, 5.0, 70.0, 30.0] and rect(inset.get("drawn", {}).get("dst", null)) == [5.0, 5.0, 70.0, 30.0],
    "modes/The picture is drawn in the content frame, inside the border and the padding", true)
  var before := int(counters().get("requested", 0))
  var loads_before := int(view("mode-changing").get("counters", {}).get("loads", -1))
  run_js("update('A-mode-changing', {resizeMode: 'contain'})")
  await wait_until(func() -> bool: return String(view("mode-changing").get("mode", "")) == "contain")
  await settle()
  var changed := view("mode-changing")
  check(rect(changed.get("drawn", {}).get("dst", null)) == [0.0, 15.0, 60.0, 30.0] and int(counters().get("requested", 0)) == before
    and int(changed.get("counters", {}).get("loads", -2)) == loads_before, "modes/Changing the resize mode redraws the picture and loads nothing", true)
  stages.modes = {"drawn": drawn, "changed": changed, "requestedBefore": before, "requestedAfter": int(counters().get("requested", 0))}

func sources_stage() -> void:
  var logs: Dictionary = stages.mount.react.logs
  var formats := {"res-png": "png", "res-jpg": "jpeg", "res-webp": "webp", "res-bmp": "bmp", "res-tga": "tga"}
  var match_all := true
  var exact_all := true
  for case_id: String in formats:
    var loaded := picture(case_id)
    match_all = match_all and String(loaded.get("format", "")) == formats[case_id] and int(loaded.get("width", 0)) == 24 and int(loaded.get("height", 0)) == 24
    if case_id != "res-jpg":
      exact_all = exact_all and String(loaded.get("fingerprint", "")) == fingerprint("formats/format." + ("jpg" if case_id == "res-jpg" else case_id.substr(4)))
  check(match_all, "sources/PNG, JPEG, WebP, BMP and TGA each decode to the 24x24 pixels of their header", true)
  check(exact_all, "sources/The lossless formats decode to the pixels the fixture generator wrote", true)
  var svg := picture("res-svg")
  check(String(svg.get("format", "")) == "svg" and int(svg.get("width", 0)) == 48 and float(svg.get("scale", 0)) == SCALE,
    "sources/An SVG is rasterized at the content scale: 24 points are 48 pixels", true)
  var user := picture("user-png")
  var file := picture("file-png")
  check(String(user.get("format", "")) == "png" and int(user.get("width", 0)) == 40 and float(user.get("scale", 0)) == SCALE
    and String(user.get("fingerprint", "")) == fingerprint("assets/wide.png"), "sources/A user:// file decodes to its pixels at the request's scale", true)
  check(String(file.get("fingerprint", "")) == fingerprint("assets/wide.png") and int(file.get("width", 0)) == 40,
    "sources/An absolute file:// URI decodes to the same pixels", true)
  var shrunk := picture("file-shrink")
  check(int(shrunk.get("width", 0)) == 20 and int(shrunk.get("height", 0)) == 10 and int(shrunk.get("sourceWidth", 0)) == 40,
    "sources/A file shown in 5x5 points at scale 2 is decoded at the size that covers it, 20x10 pixels, and never upscaled", true)
  var data := picture("data-png")
  check(int(data.get("width", 0)) == 8 and String(data.get("fingerprint", "")) == fingerprint("assets/tile.png"),
    "sources/A base64 data URI decodes to the pixels of the PNG it holds", true)
  var data_svg := picture("data-svg")
  check(String(data_svg.get("format", "")) == "svg" and int(data_svg.get("width", 0)) == 48, "sources/A percent-encoded SVG data URI decodes", true)
  var user_progress := event_of("user-png", logs, "progress")
  var file_bytes := int(manifest.files["assets/wide.png"].bytes)
  check(float(user_progress.get("progress", 0)) == 1.0 and int(user_progress.get("loaded", 0)) == file_bytes and int(user_progress.get("total", 0)) == file_bytes,
    "sources/A file reports its size over its size, as RCTFileRequestHandler does", true)
  var data_progress := event_of("data-png", logs, "progress")
  var data_bytes := int(manifest.files["assets/tile.png"].bytes)
  check(int(data_progress.get("loaded", 0)) == data_bytes and int(data_progress.get("total", 0)) == -1 and float(data_progress.get("progress", 0)) == -float(data_bytes),
    "sources/A data URI reports its bytes over an unknown length, as RCTDataRequestHandler does", true)
  var multi: Dictionary = view("multi").get("source", {})
  check(String(multi.get("uri", "")).ends_with("format.png") and float(multi.get("width", 0)) == 20.0 and float(multi.get("scale", 0)) == SCALE,
    "sources/Of several sources the shell node picks the best fit of the content area and gives it the frame and scale", true)
  stages.sources = {"formats": formats.keys()}

func failures_stage() -> void:
  var logs: Dictionary = stages.mount.react.logs
  var failing := ["missing", "corrupt", "truncated", "gif", "notimage", "empty", "oversize-png", "oversize-jpg", "scheme", "data", "data-garbage", "file", "file-corrupt"]
  var sequences := true
  var textureless := true
  var uninvolved := true
  for name: String in failing:
    var case_id := "neg-" + name
    var kinds := types(case_id, logs)
    var with_progress := name in ["data-garbage", "file-corrupt"]
    sequences = sequences and kinds == (["loadStart", "progress", "error", "loadEnd"] if with_progress else ["loadStart", "error", "loadEnd"])
    textureless = textureless and view(case_id).get("image", null) == null and String(view(case_id).get("status", "")) == "failed" and view(case_id).get("drawn", null) == null
    uninvolved = uninvolved and not String(view(case_id).get("error", "")).is_empty()
  check(sequences, "failures/Each failing source reports loadStart, error and loadEnd, with a progress event only when its bytes were read", true)
  check(textureless, "failures/A failed Image leaves no texture and draws nothing", true)
  check(uninvolved and String(event_of("neg-missing", logs, "error").get("error", "")).contains("Could not find image"),
    "failures/A missing file reports that it could not be found", true)
  var corrupt := String(event_of("neg-corrupt", logs, "error").get("error", ""))
  var truncated := String(event_of("neg-truncated", logs, "error").get("error", ""))
  check(corrupt.begins_with("Error decoding image data <") and truncated.begins_with("Error decoding image data <"),
    "failures/Corrupt and truncated pictures fail with iOS's decode error", true)
  check(String(event_of("neg-gif", logs, "error").get("error", "")).contains("GIF") and String(event_of("neg-notimage", logs, "error").get("error", "")).contains("not an image format")
    and String(event_of("neg-empty", logs, "error").get("error", "")) == "No image data", "failures/GIF, unrecognized and empty data are refused by name", true)
  var oversize_png := jobs_for("oversize.png")
  var oversize_jpg := jobs_for("oversize.jpg")
  check(oversize_png.size() == 1 and oversize_jpg.size() == 1 and int(oversize_png[0].sourceWidth) == 65535 and int(oversize_jpg[0].sourceHeight) == 65535
    and int(oversize_png[0].width) == 0 and int(oversize_jpg[0].width) == 0 and String(oversize_png[0].error).contains("over the host limit"),
    "failures/A header that claims 65535x65535 pixels is read and refused before any decoder runs", true)
  check(String(event_of("neg-scheme", logs, "error").get("error", "")).contains("Unsupported image URI") and String(event_of("neg-scheme", logs, "error").get("error", "")).contains("http:// and https://"),
    "failures/An unknown scheme is refused through onError, naming the schemes the host loads", true)
  check(String(event_of("neg-data", logs, "error").get("error", "")).contains("valid base64"), "failures/Invalid base64 in a data URI fails through onError", true)
  stages.failures = {"failing": failing}

func threads_stage() -> void:
  var state := loader()
  var host := String(state.hostThread)
  var all_workers := true
  var recorded := 0
  for job: Dictionary in state.jobs:
    if String(job.outcome) in ["cancelled"]:
      continue
    recorded += 1
    all_workers = all_workers and bool(job.thread.worker) and String(job.thread.id) != host
  check(recorded > 0 and all_workers, "threads/Every read and decode ran on a worker thread: the recorded identity of each job differs from the main thread's", true)
  var done: Dictionary = state.counters
  check(int(done.peakInFlight) >= 1 and int(done.peakInFlight) <= int(state.limits.maxInFlight), "threads/No more jobs were in the pool at once than the limit allows", true)
  check(int(done.tasksStarted) == int(done.tasksAwaited) and int(state.inFlight) == 0 and int(state.finished) == 0 and int(state.pending) == 0,
    "threads/Every task the pool handed out was awaited and nothing is left in flight", true)
  stages.threads = {"host": host, "recorded": recorded}

func scales_stage() -> void:
  var results: Array = []
  var names := {3.0: "badge@3x.png", 1.0: "badge.png", 2.0: "badge@2x.png"}
  for factor: float in [3.0, 1.0, SCALE]:
    var requested := int(counters().get("requested", 0))
    root.content_scale_factor = factor
    var ratio_ok: bool = await wait_until(func() -> bool: return react().pixelRatio == factor)
    run_js("rerender()")
    var name: String = names[factor]
    # The scale probe picks its file again, and so do the Images whose best source depends on the scale: the loader is idle once the
    # probe shows the file this ratio asks for.
    var loaded: bool = await wait_until(func() -> bool: return idle() and String(view("scales").get("source", {}).get("uri", "")).ends_with("/" + name))
    await settle()
    var node := node_of("A-scales")
    var current: Dictionary = node.get("image", {})
    var pixels: Dictionary = current.get("image", {}) if current.get("image", null) is Dictionary else {}
    results.append({"factor": factor, "ratio": ratio_ok, "loaded": loaded, "requested": [requested, int(counters().get("requested", 0))],
      "uri": current.get("source", {}).get("uri", ""), "multi": view("multi").get("source", {}).get("uri", ""), "width": pixels.get("width", 0),
      "scale": pixels.get("scale", 0), "fingerprint": pixels.get("fingerprint", ""), "layoutWidth": node.get("fabricWidth", 0),
      "stateScale": current.get("source", {}).get("scale", 0)})
  var chosen := true
  for entry: Dictionary in results:
    var name: String = names[float(entry.factor)]
    chosen = chosen and entry.ratio and entry.loaded and String(entry.uri).ends_with("/" + name) and int(entry.width) == int(16 * entry.factor)
    chosen = chosen and String(entry.fingerprint) == fingerprint("assets/" + name) and float(entry.layoutWidth) == 16.0 and float(entry.stateScale) == float(entry.factor)
  check(chosen, "scales/At pixel ratios 3, 1 and 2 RN's pickScale picks the @3x, @1x and @2x files; each texture has that variant's pixels and the layout stays 16 points", true)
  var multi_follows := String(results[0].multi).ends_with("format.bmp") and String(results[1].multi).ends_with("format.png") and String(results[2].multi).ends_with("format.png")
  check(multi_follows, "scales/An Image with several sources picks again when the content scale changes: the best fit at 3 is the 2x source, at 1 and 2 the 1x one", true)
  stages.scales = {"results": results}

func swap_stage() -> void:
  run_js("clearLog('A-swap')")
  var before := int(counters().get("requested", 0))
  run_js("update('A-swap', {source: {uri: '" + FORMATS + "format.bmp', width: 24, height: 24}})")
  await wait_until(func() -> bool: return int(counters().get("requested", 0)) == before + 1 and idle())
  await settle()
  var logs: Dictionary = react().logs
  check(types("swap", logs) == ["loadStart", "progress", "load", "loadEnd"] and String(event_of("swap", logs, "load").uri).ends_with("format.bmp"),
    "swap/Changing the source swaps the request: one loadStart, then the new picture's events", true)
  run_js("update('A-swap', {resizeMode: 'contain', style: {width: 30, height: 30}})")
  await settle(10)
  var again: Dictionary = react().logs
  check(types("swap", again) == types("swap", logs) and int(counters().get("requested", 0)) == before + 1,
    "swap/Rendering the same URI again loads and reports nothing", true)
  stages.swap = {"log": again.get("A-swap", []), "requestedBefore": before, "requestedAfter": int(counters().get("requested", 0)), "view": view("swap")}

func budget_stage() -> void:
  var base := counters()
  var requested := int(base.requested)
  # A poll always creates one texture and creates another only while the budget lasts: with a budget of one byte it creates exactly
  # one, however many are ready, and every picture still loads.
  run_js("budget(1)")
  surface_b = mount_surface("B0", "ImagesHeld", Vector2(0, 780), Vector2(300, 60), {"name": "B0", "userUri": USER_FILE})
  var done: bool = await wait_until(func() -> bool: return idle(requested + 6) and int(counters().get("loaded", 0)) == int(base.loaded) + 6)
  await settle(6)
  var after := counters()
  run_js("budget(0)")
  surface_b.queue_free()
  await wait_until(func() -> bool: return int(native(application).get("rootCount", 0)) == 1)
  check(done and int(after.peakUploadsPerPoll) == 1 and int(after.uploads) - int(base.uploads) == 6 and int(after.loaded) - int(base.loaded) == 6,
    "budget/With an upload budget of one byte each poll creates exactly one texture, and all six pictures still load", true)
  stages.budget = {"before": base, "after": after}

func inflight_swap_stage() -> void:
  run_js("clearLog('A-swap')")
  var base := counters()
  # The pool decides how many tasks run at once; one job in flight is the most every machine can hold.
  run_js("limit(1)")
  run_js("hold(true)")
  var requested := int(base.requested)
  run_js("update('A-swap', {source: {uri: '" + FORMATS + "format.jpg', width: 24, height: 24}})")
  var first: bool = await wait_until(func() -> bool: return int(counters().get("requested", 0)) == requested + 1 and held_flight(1))
  run_js("update('A-swap', {source: {uri: '" + FORMATS + "format.tga', width: 24, height: 24}})")
  var second: bool = await wait_until(func() -> bool: return int(counters().get("requested", 0)) == requested + 2 and held_flight(1) and int(loader().get("pending", 0)) == 1)
  var held_state := loader()
  check(first and second and bool(held_state.held) and int(held_state.inFlight) == 1 and int(held_state.pending) == 1,
    "inflight/One decode is in flight, done and held, while the request that replaced it waits", true)
  run_js("hold(false)")
  await wait_until(func() -> bool: return idle(requested + 2))
  await settle()
  var logs: Dictionary = react().logs
  check(types("swap", logs) == ["loadStart", "loadStart", "progress", "load", "loadEnd"] and String(event_of("swap", logs, "load").uri).ends_with("format.tga"),
    "inflight/A request swapped away while its decode is in flight never reports: only the request that replaced it does", true)
  var after := counters()
  var first_job := jobs_for("format.jpg")
  var last: Dictionary = first_job[first_job.size() - 1] if not first_job.is_empty() else {}
  check(String(last.get("outcome", "")) == "dropped" and not bool(last.get("uploaded", true)) and int(after.uploads) == int(base.uploads) + 1,
    "inflight/The decode that finished after its request was cancelled is dropped and creates no texture", true)
  stages.inflight = {"log": logs.get("A-swap", []), "before": base, "after": after, "jobs": first_job, "view": view("swap")}

func removal_stage() -> void:
  run_js("clearLog('A-removable')")
  var base := counters()
  run_js("update('A-removable', {show: false})")
  await wait_until(func() -> bool: return node_of("A-removable").is_empty())
  var live_after_hide := int(loader().liveTextures)
  run_js("hold(true)")
  var requested := int(base.requested)
  run_js("update('A-removable', {show: true})")
  var started: bool = await wait_until(func() -> bool: return int(counters().get("requested", 0)) == requested + 1 and held_flight(1))
  var mounted_again := not node_of("A-removable").is_empty()
  run_js("update('A-removable', {show: false})")
  var removed: bool = await wait_until(func() -> bool: return node_of("A-removable").is_empty())
  var uploads_before := int(counters().uploads)
  run_js("hold(false)")
  await wait_until(func() -> bool: return idle(requested + 1))
  await settle(10)
  var logs: Dictionary = react().logs
  var jobs := jobs_for("badge")
  var last: Dictionary = jobs[jobs.size() - 1] if not jobs.is_empty() else {}
  check(started and mounted_again and removed and logs.get("A-removable", []).size() == 1 and logs["A-removable"][0].type == "loadStart",
    "removal/Unmounting an Image while its decode is in flight delivers no event beyond the loadStart it had", true)
  check(String(last.get("outcome", "")) == "dropped" and int(counters().uploads) == uploads_before,
    "removal/The result of the unmounted Image's decode is dropped and creates no texture", true)
  check(int(loader().liveTextures) == live_after_hide, "removal/Nothing leaks: the live textures are those that were alive before the Image came back", true)
  stages.removal = {"log": logs.get("A-removable", []), "before": base, "after": counters(), "last": last, "liveBefore": live_after_hide, "liveAfter": int(loader().liveTextures)}

func root_unmount_stage() -> void:
  var base := counters()
  var live_before := int(loader().liveTextures)
  run_js("hold(true)")
  surface_b = mount_surface("B", "ImagesHeld", Vector2(0, 780), Vector2(300, 60), {"name": "B", "userUri": USER_FILE})
  var requested := int(base.requested)
  var flight: bool = await wait_until(func() -> bool: return int(counters().get("requested", 0)) == requested + 6 and held_flight(1) and int(loader().get("pending", 0)) == 5)
  var held_state := loader()
  check(flight and int(held_state.pending) == 5 and int(held_state.limits.maxInFlight) == 1,
    "root unmount/Six requests: one decode in flight, done and held, and five waiting behind it", true)
  surface_b.queue_free()
  var gone: bool = await wait_until(func() -> bool: return int(native(application).get("rootCount", 0)) == 1)
  run_js("hold(false)")
  await wait_until(func() -> bool: return idle(requested + 6))
  await settle(10)
  var after := counters()
  var cancelled := int(after.cancelled) - int(base.cancelled)
  var dropped := int(after.dropped) - int(base.dropped)
  check(gone and dropped == 1 and cancelled == 5 and int(after.uploads) == int(base.uploads) and int(loader().liveTextures) == live_before,
    "root unmount/Unmounting the root drops the decode in flight, cancels the five requests that waited, creates no texture and leaks none", true)
  var silent := true
  var logs: Dictionary = react().logs
  for index in range(6):
    var log: Array = logs.get("B-held-" + str(index), [])
    silent = silent and log.size() == 1 and log[0].type == "loadStart"
  check(silent, "root unmount/The unmounted root's Images saw a loadStart and nothing after it", true)
  stages.rootUnmount = {"before": base, "after": after, "held": held_state, "logs": logs, "liveBefore": live_before, "liveAfter": int(loader().liveTextures)}

func api_stage() -> void:
  run_js("api()")
  run_js("resolve()")
  var keys := ["getSize", "getSize-callback", "getSize-svg", "getSize-data", "getSize-jpeg", "getSize-webp", "getSize-missing", "getSize-corrupt", "getSize-oversize",
    "getSizeWithHeaders", "prefetch", "prefetchWithMetadata", "prefetch-missing", "queryCache", "getSize-failure-callback", "resolve"]
  var ready: bool = await wait_until(func() -> bool:
    var results: Dictionary = react().results
    return keys.all(func(key: String) -> bool: return results.has(key)))
  var results: Dictionary = react().results
  check(ready, "api/Every Image static settled")
  var sizes := true
  for key: String in ["getSize", "getSize-callback", "getSize-svg", "getSize-jpeg", "getSize-webp", "getSizeWithHeaders"]:
    sizes = sizes and dimensions(results[key]) == [24, 24]
  check(sizes and dimensions(results["getSize-data"]) == [8, 8],
    "api/getSize and getSizeWithHeaders answer {width, height} in pixels for res://, data: and every format", true)
  check(dimensions(results["getSize-corrupt"]) == [16, 16] and dimensions(results["getSize-oversize"]) == [65535, 65535],
    "api/getSize reads the header and decodes nothing, so a corrupt or oversized picture still has its size", true)
  var missing: Dictionary = results["getSize-missing"]
  check(not missing.ok and String(missing.message).begins_with("E_GET_SIZE_FAILURE: Failed to getSize of ") and String(results["getSize-failure-callback"].value).begins_with("E_GET_SIZE_FAILURE"),
    "api/A size that cannot be read rejects with E_GET_SIZE_FAILURE, to the promise and to the failure callback", true)
  check(results.prefetch.ok and results.prefetch.value == true and results.prefetchWithMetadata.ok and results.prefetchWithMetadata.value == true
    and not results["prefetch-missing"].ok and String(results["prefetch-missing"].message).begins_with("E_PREFETCH_FAILURE: Could not find image "),
    "api/prefetch and prefetchWithMetadata resolve true for a picture that loads and reject with E_PREFETCH_FAILURE and the failure text for one that does not", true)
  check(results.queryCache.ok and results.queryCache.value == {}, "api/queryCache finds nothing cached, for a file and for an address no download ever asked for", true)
  var resolved: Dictionary = results.resolve.value
  check(int(resolved.pickScale) == 2 and String(resolved.source.uri).ends_with("badge@2x.png") and resolved.nullish == null and resolved.missing == null
    and float(resolved.source.scale) == 2.0 and resolved.object.uri == "res://x.png", "api/resolveAssetSource picks the scale from PixelRatio and passes objects through")
  stages.api = {"results": results}

func contract_stage() -> void:
  var value := react()
  var messages: Dictionary = value.boundaries
  var ids: Array = js_json("ImagesProbe.refusals()")
  var missing: Array = ids.filter(func(id: String) -> bool: return not messages.has("A-refusal-" + id))
  check(missing.is_empty(), "contract/Every unsupported Image prop fails where the Image renders")
  var later := ["tintColor", "style.tintColor", "blurRadius", "capInsets", "defaultSource", "loadingIndicatorSource", "fadeDuration", "progressiveRenderingEnabled",
    "resizeMethod", "resizeMultiplier", "overlayColor", "style.borderRadius", "style.borderTopLeftRadius"]
  var named := true
  for id: String in later:
    named = named and String(messages.get("A-refusal-" + id, "")).begins_with("Godot Image does not implement ") and String(messages.get("A-refusal-" + id, "")).contains(" yet: ")
  check(named, "contract/Each refusal names the prop and why the host does not implement it yet")
  check(String(messages.get("A-refusal-resizeMode", "")).begins_with("Godot Image resizeMode must be") and String(messages.get("A-refusal-style.objectFit", "")).begins_with("Godot Image objectFit must be")
    and String(messages.get("A-refusal-style.aspectRatio", "")) == "Godot Image does not implement style aspectRatio"
    and String(messages.get("A-refusal-source.unregistered", "")).contains("no asset registered") and String(messages.get("A-refusal-onLoad", "")) == "Image onLoad must be a function"
    and String(messages.get("A-refusal-inline", "")) == "Inline Controls are not implemented in Godot Text",
    "contract/Invalid values, unregistered assets and Images inside Text are refused with the host's messages")
  check(String(messages.get("A-refusal-children", "")).begins_with("The <Image> component cannot contain children"), "contract/RN's own refusal of children reaches the host", true)
  var descriptor: Dictionary = value.assets.badge.descriptor
  check(descriptor.keys().size() == 8 and descriptor.__packager_asset == true and descriptor.httpServerLocation == "/assets/tests/fixtures/images/assets"
    and descriptor.scales.map(func(value: Variant) -> float: return float(value)) == [1.0, 2.0, 3.0] and descriptor.name == "badge" and descriptor.type == "png" and float(descriptor.width) == 16.0 and float(descriptor.height) == 16.0
    and String(descriptor.hash).length() == 32, "assets/The bundled asset registers the descriptor Metro writes, with the first scale's size in points")
  check(value.assets.badge.source.uri.ends_with("/assets/tests/fixtures/images/assets/badge@2x.png"), "assets/RN's resolver turns the descriptor into the file beside the bundle")
  stages.contract = {"messages": messages, "assets": value.assets, "refusals": ids}

func stop_stage() -> void:
  var base := counters()
  run_js("hold(true)")
  surface_b = mount_surface("B2", "ImagesHeld", Vector2(0, 780), Vector2(300, 60), {"name": "B2", "userUri": USER_FILE})
  var requested := int(base.requested)
  var flight: bool = await wait_until(func() -> bool: return int(counters().get("requested", 0)) == requested + 6 and held_flight(1) and int(loader().get("pending", 0)) == 5)
  stages.beforeStop = {"loader": loader(), "react": react(), "requestedBefore": requested}
  check(flight, "stop/Decodes are in flight when the application stops", true)
  application.call("stop")
  await settle()
  var stopped := native(application)
  var final: Dictionary = stopped.images
  check(bool(stopped.stopped) and int(final.counters.tasksStarted) == int(final.counters.tasksAwaited) and int(final.inFlight) == 0 and int(final.pending) == 0
    and int(final.finished) == 0 and int(final.ready) == 0, "stop/The application's stop waited for every decode: the loader's tasks started equal the tasks awaited and nothing is left", true)
  check(int(final.liveTextures) == 0, "stop/No texture outlives the application", true)
  stages.afterStop = {"application": stopped, "loader": final}

func _initialize() -> void:
  var arguments := OS.get_cmdline_user_args()
  allow_original_negative = arguments.has("--allow-original-negative")
  sabotage = arguments.has("--sabotage")
  call_deferred("run_probe")

func run_probe() -> void:
  root.content_scale_size = Vector2i.ZERO
  root.content_scale_mode = Window.CONTENT_SCALE_MODE_CANVAS_ITEMS
  root.size = Vector2i(2200, 1700)
  root.content_scale_factor = SCALE
  await settle(2)
  prepare_files()
  application = ClassDB.instantiate("FabricApplication")
  application.name = "ImagesApplication"
  application.set_meta("scenario", "images-fixture")
  application.set("bundle_path", "res://build/images-probe.js")
  root.add_child(application)
  surface_a = mount_surface("A", "ImagesProbe", Vector2(0, 0), Vector2(1100, 760), inputs)
  await wait_until(func() -> bool: return int(react().get("mounts", {}).get("A", 0)) == 1, 300)
  declared = js_json("ImagesProbe.declared()")
  var expected := declared.size() + 3
  await wait_until(func() -> bool: return idle(expected) or allow_original_negative, 900)
  await settle(10)
  mount_stage()
  contract_stage()
  if not allow_original_negative:
    bundled_stage()
    await modes_stage()
    sources_stage()
    failures_stage()
    threads_stage()
    await api_stage()
    await scales_stage()
    await swap_stage()
    await budget_stage()
    await inflight_swap_stage()
    await removal_stage()
    await root_unmount_stage()
    check(errors().is_empty(), "cleanup/No host or runtime diagnostic was reported", true)
    await stop_stage()
  else:
    stages.beforeStop = {"loader": loader(), "react": react()}
    application.call("stop")
    await settle()
    stages.afterStop = {"application": native(application), "loader": native(application).get("images", {})}
  var stopped: Dictionary = stages.afterStop.application
  check(bool(stopped.stopped) and int(stopped.rootCount) == 0 and int(stopped.pendingWork) == 0, "cleanup/Stop releases every root and queued work")
  surface_a.queue_free()
  if is_instance_valid(surface_b):
    surface_b.queue_free()
  application.queue_free()
  await settle()
  DirAccess.remove_absolute(ProjectSettings.globalize_path(USER_FILE))
  DirAccess.remove_absolute(ProjectSettings.globalize_path("user://images-probe"))
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var observed := failures.duplicate()
  var expected_failures := expected_original_failures.duplicate()
  observed.sort()
  expected_failures.sort()
  var original_negative_observed := allow_original_negative and observed == expected_failures and not failures.is_empty()
  var report := {"scenario": "images", "reactNative": "0.87.1", "godot": Engine.get_version_info().string, "displayServer": DisplayServer.get_name(),
    "checks": checks, "stages": stages, "expectedOriginalFailures": expected_original_failures, "scale": SCALE, "inputs": inputs,
    "allowOriginalNegative": allow_original_negative, "originalNegativeObserved": original_negative_observed, "sabotage": sabotage,
    "allCurrentAssertionsPassed": failures.is_empty(),
    "scope": {"actualSceneTreeFrames": true, "workerThreadIdentity": true, "originalImageIos": true, "pixelCapture": false, "headlessRenderer": true, "network": false}}
  var output := FileAccess.open("res://build/images-report.json", FileAccess.WRITE)
  if not check(output != null, "report/The Images report is saved"):
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  output.close()
  var verdict := "IMAGES_SABOTAGE_REJECTED: " + str(failures.size()) if sabotage and not failures.is_empty() else "IMAGES_ORIGINAL_NEGATIVE: " + str(failures.size()) if original_negative_observed else "IMAGES_PASSED: " + str(checks.size()) if failures.is_empty() else "IMAGES_FAILED"
  print(verdict)
  quit(0 if failures.is_empty() or original_negative_observed or (sabotage and not failures.is_empty()) else 1)
