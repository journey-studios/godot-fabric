extends SceneTree

# What RN's Image does to its picture, over the host's native image pipeline: the tint, the blur, the cap insets and the clip of
# rounded corners, and the props that iOS ignores. A headless run uses the dummy renderer, which draws no pixel and ignores the
# parameters of a material, so every effect is checked by what the view asked the renderer for (its snapshot: the rectangles, the radii,
# the margins, the tint and the item and material it made), and the pixels of the blur by the fingerprint of the bitmap the worker made
# of them. The captures of the example prove what the renderer drew. Every phase waits for a state (the loader idle, a request
# answered, a view drawn), never for a number of frames.
const SCALE := 2.0
const DIR := "res://tests/fixtures/images-visual/"
const IMAGES := "res://tests/fixtures/images/"
const TOLERANCE := 0.002
var application: Node
var surface: Control
var network_surface: Control
var checks: Array = []
var stages: Dictionary = {}
var allow_original_negative := false
var sabotage := false
var expected_original_failures: Array = []
var manifest: Dictionary = {}
var shared_manifest: Dictionary = {}
var declared: Array = []
var ports: Dictionary = {}
var base_url := ""
# Every change the probe made to a live Image, with the view as it was drawn after it: the oracle replays them.
var changes: Array = []

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

# True once the predicate holds; a state is awaited, never a count of frames. The limit is a time, so that a runner that draws few frames
# gets as long as one that draws many: it is only how long the probe waits for what never comes.
func wait_until(predicate: Callable, limit_ms: int = 30000) -> bool:
  var started := Time.get_ticks_msec()
  while Time.get_ticks_msec() - started < limit_ms and not predicate.call():
    await process_frame
  return predicate.call()

func dict(value: Variant) -> Dictionary:
  return value if value is Dictionary else {}

func arr(value: Variant) -> Array:
  return value if value is Array else []

func js_json(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(" + expression + ")"))

func react() -> Dictionary:
  return dict(js_json("ImagesVisual.snapshot()"))

func run_js(expression: String) -> void:
  application.call("evaluate", "ImagesVisual." + expression)

func native(target: Object) -> Dictionary:
  return dict(JSON.parse_string(target.call("snapshot")))

func loader() -> Dictionary:
  return dict(native(application).get("images", null))

func counters() -> Dictionary:
  return dict(loader().get("counters", null))

func caches() -> Dictionary:
  return dict(loader().get("caches", null))

func effects_counters() -> Dictionary:
  return dict(native(application).get("imageEffects", null))

func errors() -> Array:
  return arr(native(application).get("errors", null))

func idle(expected_requests: int = 0) -> bool:
  var state := loader()
  var done := dict(state.get("counters", null))
  return (int(state.get("pending", 1)) == 0 and int(state.get("inFlight", 1)) == 0 and int(state.get("finished", 1)) == 0
    and int(state.get("ready", 1)) == 0 and int(state.get("fresh", 1)) == 0 and int(state.get("downloading", 1)) == 0
    and int(done.get("requested", 0)) >= expected_requests)

func node_of(test_id: String, target: Control = null) -> Dictionary:
  for entry: Dictionary in arr(native(target if target != null else surface).get("nodes", null)):
    if entry.testID == test_id:
      return entry
  return {}

func view(case_id: String, prefix: String = "V") -> Dictionary:
  return dict(node_of(prefix + "-" + case_id, network_surface if prefix == "N" else surface).get("image", null))

func appearance(case_id: String) -> Dictionary:
  return dict(node_of("V-" + case_id).get("appearance", null))

func picture(case_id: String, prefix: String = "V") -> Dictionary:
  return dict(view(case_id, prefix).get("image", null))

func drawn(case_id: String, prefix: String = "V") -> Dictionary:
  return dict(view(case_id, prefix).get("drawn", null))

func effects(case_id: String, prefix: String = "V") -> Dictionary:
  return dict(drawn(case_id, prefix).get("effects", null))

func layer(case_id: String, prefix: String = "V") -> Dictionary:
  return dict(effects(case_id, prefix).get("layer", null))

func params(case_id: String) -> Dictionary:
  return dict(layer(case_id).get("params", null))

func commands(case_id: String) -> Array:
  return arr(layer(case_id).get("commands", null))

func command(case_id: String) -> Dictionary:
  var all := commands(case_id)
  return dict(all[0]) if all.size() == 1 else {}

func fingerprint_of(case_id: String, prefix: String = "V") -> String:
  return String(picture(case_id, prefix).get("fingerprint", "?"))

func blur_of(case_id: String, prefix: String = "V") -> Dictionary:
  return dict(picture(case_id, prefix).get("blur", null))

func counter(case_id: String, key: String, prefix: String = "V") -> int:
  return int(dict(view(case_id, prefix).get("counters", null)).get(key, -1))

func log_types(case_id: String, prefix: String = "V") -> Array:
  var out: Array = []
  for event: Dictionary in arr(dict(react().get("logs", null)).get(prefix + "-" + case_id, null)):
    out.append(event.type)
  return out

func fixture_fingerprint(file: String) -> String:
  return String(dict(dict(manifest.get("files", null)).get(file, null)).get("fingerprint", "?"))

# An integer of a snapshot, or a value no check expects when it is missing: a host without the counter fails the check, it does not abort it.
func n(source: Dictionary, key: String) -> int:
  return int(source.get(key, -1000000))

# The fingerprint of the bitmap the blur must make of a fixture picture for a box (the manifest's, written by the oracle's blur).
func blurred_fingerprint(file: String, kernel: int) -> String:
  return String(dict(dict(dict(manifest.get("files", null)).get(file, null)).get("blurred", null)).get(str(kernel), "?"))

func numbers(value: Variant) -> Array:
  var out: Array = []
  for item: Variant in arr(value):
    out.append(float(item))
  return out

func close(actual: Variant, expected: float) -> bool:
  return (actual is float or actual is int) and absf(float(actual) - expected) <= TOLERANCE

func close_all(actual: Variant, expected: Array) -> bool:
  var values := numbers(actual)
  if values.size() != expected.size():
    return false
  for index in range(expected.size()):
    if absf(float(values[index]) - float(expected[index])) > TOLERANCE:
      return false
  return true

func rect4(value: Variant) -> Array:
  var rect := dict(value)
  return [float(rect.get("x", -1)), float(rect.get("y", -1)), float(rect.get("width", -1)), float(rect.get("height", -1))]

func shown(case_id: String) -> bool:
  return String(view(case_id).get("status", "")) == "loaded" and not drawn(case_id).is_empty()

func all_shown() -> bool:
  for entry: Dictionary in declared:
    if not shown(entry.id):
      return false
  return true

func mount_surface(name: String, component: String, position: Vector2, size: Vector2, props: Dictionary) -> Control:
  var created: Control = ClassDB.instantiate("FabricSurface")
  created.name = name
  created.position = position
  created.size = size
  created.set("application_path", NodePath("../ImagesVisualApplication"))
  created.set("component_name", component)
  created.set("initial_props", props)
  root.add_child(created)
  return created

# Changes what an Image was declared with, and waits for the view to draw again with it (the patch is in the view's committed props
# when `ready` holds).
func change(case_id: String, patch: Dictionary, ready: Callable, prefix: String = "V") -> bool:
  var draws := counter(case_id, "draws", prefix)
  run_js("update('" + prefix + "-" + case_id + "', " + JSON.stringify(patch) + ")")
  var reached: bool = await wait_until(func() -> bool: return ready.call() and counter(case_id, "draws", prefix) > draws, 8000)
  await settle(2)
  changes.append({"id": case_id, "prefix": prefix, "patch": patch, "reached": reached, "view": view(case_id, prefix)})
  return reached

# ---- stages ----

func mount_stage() -> void:
  var value := react()
  var nodes: Array = arr(native(surface).get("nodes", null)).filter(func(row: Dictionary) -> bool: return row.kind == "image")
  check(nodes.size() == declared.size() and not value.is_empty() and errors().is_empty(),
    "mount/Every declared Image mounts one native GodotImage, and the application reports no host or runtime error")
  var boundaries := dict(value.get("boundaries", null))
  var refusals: Array = arr(js_json("ImagesVisual.refusals()"))
  var missing: Array = refusals.filter(func(row: Dictionary) -> bool: return not boundaries.has("V-refusal-" + row.id))
  check(missing.is_empty() and boundaries.keys().all(func(key: String) -> bool: return key.contains("refusal")),
    "contract/A blur radius or cap insets that are not numbers fail where the Image renders, and no declared Image fails")
  var named := true
  for row: Dictionary in refusals:
    var message := String(boundaries.get("V-refusal-" + row.id, ""))
    named = named and (message == "Godot Image blurRadius must be a finite number" or message.begins_with("Godot Image capInsets must be a number or an object"))
  check(named, "contract/Each refusal names the prop and what it must be")
  check(int(counters().get("requested", 0)) == declared.size(), "mount/Every Image asked the loader for exactly one request")
  stages.mount = {"react": value, "surface": native(surface), "loader": loader(), "declared": declared, "refusals": refusals, "effects": effects_counters()}

func ignored_stage() -> void:
  var all := dict(view("ignored-all").get("ignored", null))
  var control := dict(view("ignored-control").get("ignored", null))
  check(bool(all.get("defaultSource", false)) and not bool(control.get("defaultSource", true)),
    "ignored/defaultSource reaches the view and is read by nothing: the view holds it and draws nothing of it", true)
  check(not bool(all.get("loadingIndicatorSource", true)) and close(all.get("fadeDuration", -1), 300.0) and not bool(all.get("progressiveRenderingEnabled", true))
    and String(all.get("resizeMethod", "")) == "auto" and close(all.get("resizeMultiplier", -1), 1.0) and not bool(all.get("overlayColor", true)),
    "ignored/loadingIndicatorSource, fadeDuration, progressiveRenderingEnabled, resizeMethod, resizeMultiplier and overlayColor never reach the view: it holds their defaults", true)
  check(String(view("ignored-all").get("status", "")) == "loaded" and log_types("ignored-all") == log_types("ignored-control") and log_types("ignored-control") == ["loadStart", "progress", "load", "loadEnd"],
    "ignored/An Image with all of them loads and reports exactly what one without them does")
  var left := drawn("ignored-all")
  var right := drawn("ignored-control")
  check(left == right and not left.is_empty() and picture("ignored-all") == picture("ignored-control"),
    "ignored/and draws the same picture the same way, with the same effects")
  stages.ignored = {"all": view("ignored-all"), "control": view("ignored-control")}

func blur_stage() -> void:
  var plain_fingerprint := fixture_fingerprint("glyph@2x.png")
  var kernels := {"blur-1x-r4": 5, "blur-2x-r1": 3, "blur-2x-r2": 5, "blur-2x-r4": 7, "blur-2x-r6": 11, "blur-3x-r4": 11, "blur-3x-r30": 85,
    "blur-tint": 5, "blur-caps": 5, "blur-repeat": 5}
  var exact := true
  var passes := true
  var textures := true
  var sizes := {"blur-1x-r4": [12, 9], "blur-3x-r4": [36, 27], "blur-3x-r30": [36, 27]}
  for case_id: String in kernels:
    var blur := blur_of(case_id)
    exact = exact and int(blur.get("kernel", -1)) == int(kernels[case_id]) and bool(blur.get("applies", false))
    passes = passes and int(blur.get("passes", 0)) == 2
    var size: Array = sizes.get(case_id, [24, 18])
    textures = textures and int(picture(case_id).get("width", 0)) == size[0] and int(picture(case_id).get("height", 0)) == size[1] and int(picture(case_id).get("textureWidth", 0)) == size[0]
  check(exact, "blur/The box is floor((radius x scale x 3 sqrt(2 pi) / 4 + 0.5) / 2) made odd, in the pixels of the bitmap: 5, 3, 5, 7, 11, 11 and 85 for the radii and scales declared", true)
  check(passes and textures, "blur/Two box passes reach the picture, which keeps the size of its bitmap and its own texture", true)
  var unchanged := true
  for case_id: String in ["blur-kernel-1", "blur-epsilon", "blur-zero", "plain-2x"]:
    unchanged = unchanged and fingerprint_of(case_id) == plain_fingerprint and plain_fingerprint != "?" and not bool(blur_of(case_id).get("applies", true))
  check(unchanged, "blur/A box of one pixel, a radius at epsilon and no radius leave every pixel of the bitmap: the pixels are those of the fixture file", true)
  var distinct: Dictionary = {}
  for case_id: String in ["blur-2x-r1", "blur-2x-r2", "blur-2x-r4", "blur-2x-r6"]:
    distinct[fingerprint_of(case_id)] = true
  check(distinct.size() == 4 and not distinct.has(plain_fingerprint) and fingerprint_of("blur-tint") == fingerprint_of("blur-2x-r2") and fingerprint_of("blur-caps") == fingerprint_of("blur-2x-r2"),
    "blur/Each box changes the pixels in its own way, and the same box makes the same pixels whatever else the Image has", true)
  var by_file := {"blur-1x-r4": ["glyph.png", 5], "blur-2x-r1": ["glyph@2x.png", 3], "blur-2x-r2": ["glyph@2x.png", 5], "blur-2x-r4": ["glyph@2x.png", 7], "blur-2x-r6": ["glyph@2x.png", 11],
    "blur-3x-r4": ["glyph@3x.png", 11], "blur-3x-r30": ["glyph@3x.png", 85], "blur-tint": ["glyph@2x.png", 5], "blur-caps": ["glyph@2x.png", 5], "blur-repeat": ["glyph@2x.png", 5]}
  var same_pixels := true
  for case_id: String in by_file:
    var held := blurred_fingerprint(by_file[case_id][0], by_file[case_id][1])
    same_pixels = same_pixels and held != "?" and fingerprint_of(case_id) == held
  check(same_pixels, "blur/Every blurred bitmap is, byte for byte, the one the manifest holds for its picture and its box: two passes, in premultiplied alpha, the edge extended", true)
  check(effects("blur-kernel-1").get("tint", null) != null and String(effects("blur-kernel-1").get("kind", "")) == "ninePatch" and effects("blur-epsilon").get("tint", null) != null
    and effects("blur-zero").get("tint", null) != null, "blur/A picture a blur left alone is still a template and still a nine-patch: iOS returns the image it was given", true)
  check(effects("blur-tint").get("tint", 1) == null and String(effects("blur-caps").get("kind", "")) == "region" and String(effects("blur-repeat").get("kind", "")) == "region"
    and String(drawn("blur-repeat").get("mode", "")) == "stretch" and not bool(drawn("blur-repeat").get("tiled", true)),
    "blur/A blurred picture is plain: it takes no tint and no cap insets, and repeat fills the view with it instead of tiling", true)
  var types_ok := true
  for case_id: String in kernels:
    types_ok = types_ok and log_types(case_id) == ["loadStart", "progress", "load", "loadEnd"]
  check(types_ok, "blur/A blurred Image reports loadStart, progress, load and loadEnd, once each")
  var state := loader()
  var blurred := 0
  var on_workers := true
  for job: Dictionary in arr(state.get("jobs", null)):
    if bool(dict(job.get("blur", null)).get("applies", false)):
      blurred += 1
      on_workers = on_workers and bool(dict(job.get("thread", null)).get("worker", false)) and String(job.outcome) == "loaded"
  check(blurred == kernels.size() and int(dict(state.get("counters", null)).get("blurred", -1)) == kernels.size() and on_workers,
    "blur/Every blur ran on a worker thread as part of its job, and the loader counted exactly the ten blurred pictures", true)
  stages.blur = {"kernels": kernels, "plain": plain_fingerprint}

func blur_live_stage() -> void:
  var plain_fingerprint := fixture_fingerprint("glyph@2x.png")
  var base := counters()
  var before := fingerprint_of("blur-live")
  run_js("clearLog('V-blur-live')")
  var reached: bool = await change("blur-live", {"props": {"blurRadius": 2}}, func() -> bool: return bool(blur_of("blur-live").get("applies", false)))
  await wait_until(func() -> bool: return idle(int(base.requested) + 1))
  var types := log_types("blur-live")
  check(reached and before == plain_fingerprint and fingerprint_of("blur-live") == fingerprint_of("blur-2x-r2") and types == ["progress", "load", "loadEnd"],
    "live/Setting blurRadius asks for the same source again: onLoad and onLoadEnd come again, with no onLoadStart, and the picture is the blurred one", true)
  var asked := int(counters().requested) - int(base.requested)
  run_js("clearLog('V-blur-live')")
  var cleared: bool = await change("blur-live", {"props": {"blurRadius": null}}, func() -> bool: return not bool(blur_of("blur-live").get("applies", true)))
  await wait_until(func() -> bool: return idle(int(base.requested) + 2))
  check(cleared and fingerprint_of("blur-live") == plain_fingerprint and log_types("blur-live") == ["progress", "load", "loadEnd"] and asked == 1,
    "live/Clearing blurRadius loads the plain picture again, and each change is exactly one request", true)
  stages.blurLive = {"types": types, "asked": asked, "after": counters()}

func tint_stage() -> void:
  var expected := {"tint-hex": [1.0, 0.53333, 0.0, 1.0], "tint-alpha": [0.0, 0.47059, 1.0, 0.50196], "tint-transparent": [1.0, 0.0, 0.0, 0.0],
    "tint-style": [0.0, 0.8, 0.4, 1.0], "tint-prop-wins": [1.0, 0.0, 0.0, 1.0], "tint-appearance": [1.0, 0.53333, 0.0, 1.0]}
  var colors := true
  var params_ok := true
  for case_id: String in expected:
    colors = colors and close_all(effects(case_id).get("tint", null), expected[case_id])
    var current := params(case_id)
    params_ok = (params_ok and close(current.get("tinted", -1), 1.0) and close_all(current.get("tint", null), expected[case_id]) and close(current.get("clipped", -1), 0.0)
      and bool(layer(case_id).get("shaded", false)) and bool(layer(case_id).get("item", false)) and bool(layer(case_id).get("material", false)))
  check(colors, "tint/tintColor draws the picture in that color, from the prop and from the style, with the prop first, and a fully transparent one is declared as it is", true)
  check(params_ok, "tint/The shader is told to tint with the color and not to clip, on an item and a material of the view's own", true)
  var untinted := layer("plain-2x")
  check(not bool(untinted.get("shaded", true)) and not bool(untinted.get("material", true)) and bool(untinted.get("item", false)) and dict(untinted.get("params", null)).is_empty(),
    "tint/An Image with no tint and no rounded clip has an item and no material: the shader is not used", true)
  var node := appearance("tint-appearance")
  check(String(node.get("background", "")) == "203040ff" and String(node.get("borderColor", "")) == "abcdefff" and numbers(node.get("borderWidths", null)) == [2.0, 2.0, 2.0, 2.0],
    "tint/The background and the border of a tinted Image are painted as they are: the tint belongs to the picture's own item")
  check(rect4(command("tint-appearance").get("dst", null)) == [6.0, 6.0, 52.0, 40.0], "tint/and the picture lies in the content frame inside the border and the padding", true)
  # Live: the tint is read from the committed props, with no request.
  var base := counters()
  var item_baseline := layer("tint-live")
  var drawn_before := counter("tint-live", "draws")
  var first: bool = await change("tint-live", {"props": {"tintColor": "#ff00ff"}}, func() -> bool: return effects("tint-live").get("tint", null) != null)
  var created := n(effects_counters(), "materialsCreated")
  var first_layer := layer("tint-live")
  var second: bool = await change("tint-live", {"props": {"tintColor": "#00ffff"}}, func() -> bool: return close_all(effects("tint-live").get("tint", null), [0.0, 1.0, 1.0, 1.0]))
  var second_material := n(effects_counters(), "materialsCreated")
  var second_layer := layer("tint-live")
  var third: bool = await change("tint-live", {"props": {"tintColor": null}}, func() -> bool: return effects("tint-live").get("tint", 1) == null)
  var last := layer("tint-live")
  check(first and second and third and not bool(item_baseline.get("shaded", true)) and bool(first_layer.get("shaded", false))
    and close_all(dict(first_layer.get("params", null)).get("tint", null), [1.0, 0.0, 1.0, 1.0]) and close_all(dict(second_layer.get("params", null)).get("tint", null), [0.0, 1.0, 1.0, 1.0])
    and not bool(last.get("shaded", true)) and dict(last.get("params", null)).is_empty(),
    "tint/Setting, changing and clearing tintColor redraws at once: the picture is tinted, tinted again and plain again", true)
  check(second_material == created and bool(last.get("material", false)) and n(counters(), "requested") == n(base, "requested") and counter("tint-live", "draws") >= drawn_before + 3
    and counter("tint-live", "loads") == 1, "tint/The material is made once and kept, and a tint loads nothing: the picture is the one the request gave", true)
  stages.tint = {"expected": expected}

func caps_stage() -> void:
  var cases := {
    "caps-object": {"kind": "ninePatch", "dst": [0.0, 0.0, 120.0, 80.0], "margins": [6.0, 6.0, 6.0, 6.0], "x": "stretch", "y": "stretch"},
    "caps-number": {"kind": "ninePatch", "dst": [0.0, 0.0, 120.0, 80.0], "margins": [8.0, 8.0, 8.0, 8.0], "x": "stretch", "y": "stretch"},
    "caps-asymmetric": {"kind": "ninePatch", "dst": [0.0, 0.0, 120.0, 80.0], "margins": [4.0, 2.0, 8.0, 6.0], "x": "stretch", "y": "stretch"},
    "caps-partial": {"kind": "ninePatch", "dst": [0.0, 0.0, 120.0, 80.0], "margins": [0.0, 10.0, 0.0, 0.0], "x": "stretch", "y": "stretch"},
    "caps-repeat": {"kind": "ninePatch", "dst": [0.0, 0.0, 120.0, 80.0], "margins": [6.0, 6.0, 6.0, 6.0], "x": "tile", "y": "tile"},
    "caps-oversize": {"kind": "ninePatch", "dst": [0.0, 0.0, 120.0, 80.0], "margins": [24.0, 24.0, 12.0, 12.0], "x": "stretch", "y": "stretch"},
    "caps-frame": {"kind": "ninePatch", "dst": [10.0, 10.0, 100.0, 60.0], "margins": [6.0, 6.0, 6.0, 6.0], "x": "stretch", "y": "stretch"}}
  var matches := true
  for case_id: String in cases:
    var expected: Dictionary = cases[case_id]
    var current := command(case_id)
    var margins := dict(current.get("margins", null))
    matches = (matches and String(effects(case_id).get("kind", "")) == expected.kind and String(current.get("op", "")) == "ninePatch" and rect4(current.get("dst", null)) == expected.dst
      and rect4(current.get("src", null)) == [0.0, 0.0, 36.0, 36.0]
      and [float(margins.get("left", -1)), float(margins.get("top", -1)), float(margins.get("right", -1)), float(margins.get("bottom", -1))] == expected.margins
      and String(current.get("xMode", "")) == expected.x and String(current.get("yMode", "")) == expected.y)
  check(matches, "caps/capInsets as a number or an object of top, left, bottom and right become a nine-patch of the whole picture over the content frame, with margins in the pixels of the picture and the modes of the resize mode", true)
  check(String(command("caps-repeat-zero").get("op", "")) == "textureRectTile" and String(effects("caps-repeat-zero").get("kind", "")) == "tile"
    and String(command("caps-cover").get("op", "")) == "textureRectRegion" and String(command("caps-zero").get("op", "")) == "textureRectRegion",
    "caps/Repeat with no insets tiles the whole picture, and cover or zero insets draw as they do without them", true)
  check(bool(layer("caps-object").get("item", false)) and not bool(layer("caps-object").get("shaded", true)) and not bool(layer("caps-object").get("material", true)),
    "caps/A nine-patch needs no shader: the item draws it with no material", true)
  var base := counters()
  var drawn_before := counter("caps-live", "draws")
  var set_caps: bool = await change("caps-live", {"props": {"capInsets": {"top": 3, "left": 3, "bottom": 3, "right": 3}}}, func() -> bool: return String(effects("caps-live").get("kind", "")) == "ninePatch")
  var first := command("caps-live")
  var changed: bool = await change("caps-live", {"props": {"capInsets": 5}}, func() -> bool: return float(dict(command("caps-live").get("margins", null)).get("left", 0)) == 10.0)
  var cleared: bool = await change("caps-live", {"props": {"capInsets": null}}, func() -> bool: return String(effects("caps-live").get("kind", "")) == "region")
  check(set_caps and changed and cleared and float(dict(first.get("margins", null)).get("left", 0)) == 6.0 and n(counters(), "requested") == n(base, "requested")
    and counter("caps-live", "draws") >= drawn_before + 3 and counter("caps-live", "loads") == 1,
    "caps/Setting, changing and clearing capInsets redraws at once with no request: a nine-patch, another and the plain picture", true)
  stages.caps = {"cases": cases}

# One declared mask: the rectangles and radii of the outer and the inner shape, in points of the view, and the same in the pixels of the
# picture that the shader reads.
func mask_matches(case_id: String, expected: Dictionary, scale: float = SCALE) -> bool:
  var current := dict(effects(case_id).get("clip", null))
  if current.is_empty():
    return false
  var outer := dict(current.get("outer", null))
  var inner := dict(current.get("inner", null))
  var outer_radii := dict(outer.get("radii", null))
  var inner_radii := dict(inner.get("radii", null))
  var point_ok: bool = (rect4(outer.get("rect", null)) == expected.outer_rect and rect4(inner.get("rect", null)) == expected.inner_rect
    and close_all(outer_radii.get("horizontal", null), expected.outer_rx) and close_all(outer_radii.get("vertical", null), expected.outer_ry)
    and close_all(inner_radii.get("horizontal", null), expected.inner_rx) and close_all(inner_radii.get("vertical", null), expected.inner_ry))
  var current_params := params(case_id)
  var pixels := func(values: Array) -> Array: return values.map(func(value: float) -> float: return value * scale)
  var pixel_ok: bool = (close(current_params.get("clipped", -1), 1.0) and bool(layer(case_id).get("shaded", false))
    and close_all(current_params.get("outer_rect", null), pixels.call(expected.outer_rect)) and close_all(current_params.get("inner_rect", null), pixels.call(expected.inner_rect))
    and close_all(current_params.get("outer_rx", null), pixels.call(expected.outer_rx)) and close_all(current_params.get("outer_ry", null), pixels.call(expected.outer_ry))
    and close_all(current_params.get("inner_rx", null), pixels.call(expected.inner_rx)) and close_all(current_params.get("inner_ry", null), pixels.call(expected.inner_ry)))
  return point_ok and pixel_ok

func rep(value: float) -> Array:
  return [value, value, value, value]

func mask_stage() -> void:
  var cases := {
    "mask-radius": {"outer_rect": [0.0, 0.0, 40.0, 40.0], "inner_rect": [0.0, 0.0, 40.0, 40.0], "outer_rx": rep(10), "outer_ry": rep(10), "inner_rx": rep(10), "inner_ry": rep(10)},
    "mask-border": {"outer_rect": [0.0, 0.0, 40.0, 40.0], "inner_rect": [2.0, 2.0, 36.0, 36.0], "outer_rx": rep(10), "outer_ry": rep(10), "inner_rx": rep(8), "inner_ry": rep(8)},
    "mask-padding": {"outer_rect": [0.0, 0.0, 40.0, 40.0], "inner_rect": [5.0, 5.0, 30.0, 30.0], "outer_rx": rep(12), "outer_ry": rep(12), "inner_rx": rep(10), "inner_ry": rep(10)},
    "mask-ellipse": {"outer_rect": [0.0, 0.0, 60.0, 30.0], "inner_rect": [0.0, 0.0, 60.0, 30.0], "outer_rx": rep(30), "outer_ry": rep(15), "inner_rx": rep(30), "inner_ry": rep(15)},
    "mask-corners": {"outer_rect": [0.0, 0.0, 60.0, 40.0], "inner_rect": [4.0, 2.0, 55.0, 35.0], "outer_rx": [20.0, 4.0, 0.0, 12.0], "outer_ry": [20.0, 4.0, 0.0, 12.0],
      "inner_rx": [16.0, 3.0, 0.0, 8.0], "inner_ry": [18.0, 2.0, 0.0, 9.0]},
    "mask-pill": {"outer_rect": [0.0, 0.0, 40.0, 40.0], "inner_rect": [2.0, 2.0, 36.0, 36.0], "outer_rx": rep(20), "outer_ry": rep(20), "inner_rx": rep(18), "inner_ry": rep(18)},
    "mask-overlap": {"outer_rect": [0.0, 0.0, 40.0, 40.0], "inner_rect": [0.0, 0.0, 40.0, 40.0], "outer_rx": [20.0, 20.0, 0.0, 0.0], "outer_ry": [20.0, 20.0, 0.0, 0.0],
      "inner_rx": [20.0, 20.0, 0.0, 0.0], "inner_ry": [20.0, 20.0, 0.0, 0.0]},
    "mask-scroll": {"outer_rect": [0.0, 0.0, 40.0, 40.0], "inner_rect": [0.0, 0.0, 40.0, 40.0], "outer_rx": rep(10), "outer_ry": rep(10), "inner_rx": rep(10), "inner_ry": rep(10)},
    "mask-cover": {"outer_rect": [0.0, 0.0, 40.0, 40.0], "inner_rect": [0.0, 0.0, 40.0, 40.0], "outer_rx": rep(10), "outer_ry": rep(10), "inner_rx": rep(10), "inner_ry": rep(10)},
    "mask-contain": {"outer_rect": [0.0, 0.0, 40.0, 40.0], "inner_rect": [0.0, 0.0, 40.0, 40.0], "outer_rx": rep(10), "outer_ry": rep(10), "inner_rx": rep(10), "inner_ry": rep(10)},
    "mask-center": {"outer_rect": [0.0, 0.0, 40.0, 40.0], "inner_rect": [0.0, 0.0, 40.0, 40.0], "outer_rx": rep(10), "outer_ry": rep(10), "inner_rx": rep(10), "inner_ry": rep(10)},
    "mask-repeat": {"outer_rect": [0.0, 0.0, 40.0, 40.0], "inner_rect": [0.0, 0.0, 40.0, 40.0], "outer_rx": rep(10), "outer_ry": rep(10), "inner_rx": rep(10), "inner_ry": rep(10)},
    "all-together": {"outer_rect": [0.0, 0.0, 60.0, 40.0], "inner_rect": [2.0, 2.0, 56.0, 36.0], "outer_rx": rep(12), "outer_ry": rep(12), "inner_rx": rep(10), "inner_ry": rep(10)}}
  var matches := true
  var failing: Array = []
  for case_id: String in cases:
    if not mask_matches(case_id, cases[case_id]):
      matches = false
      failing.append(case_id)
  check(matches, "mask/A view that clips and has radii clips its picture to the border box with the radii, and to the content frame with each radius less the border beside it, limited as RCTPathCreateWithRoundedRect limits them", true)
  check(mask_matches("mask-3x", {"outer_rect": [0.0, 0.0, 30.0, 30.0], "inner_rect": [1.0, 1.0, 28.0, 28.0], "outer_rx": rep(8), "outer_ry": rep(8), "inner_rx": rep(7), "inner_ry": rep(7)}, 3.0),
    "mask/The shader's coordinates are the pixels of the picture: at scale 3 every point is three", true)
  var none := true
  for case_id: String in ["mask-visible", "mask-square"]:
    none = (none and effects(case_id).get("clip", 1) == null and not bool(layer(case_id).get("shaded", true))
      and bool(dict(view(case_id).get("props", null)).get("clips", false)) == (case_id == "mask-square"))
  check(none, "mask/overflow visible keeps only the rectangle of the content frame, and a clipping view with no radius needs no mask", true)
  var drawn_shapes := true
  for case_id: String in ["mask-cover", "mask-contain", "mask-center", "mask-repeat"]:
    drawn_shapes = drawn_shapes and String(effects(case_id).get("kind", "")) == ("tile" if case_id == "mask-repeat" else "region")
  var contained := command("mask-contain")
  check(drawn_shapes and rect4(contained.get("dst", null)) == [0.0, 10.0, 80.0, 60.0],
    "mask/The mask belongs to the view, not to the picture: every resize mode keeps its drawing under the same shape", true)
  # Live.
  var base := counters()
  var drawn_before := counter("mask-live", "draws")
  var rounded: bool = await change("mask-live", {"style": {"borderRadius": 12}}, func() -> bool: return effects("mask-live").get("clip", null) != null)
  var round_params := params("mask-live")
  var clear: bool = await change("mask-live", {"style": {"overflow": "visible"}}, func() -> bool: return effects("mask-live").get("clip", 1) == null)
  var back: bool = await change("mask-live", {"style": {"overflow": "hidden", "borderRadius": 6, "borderWidth": 1}}, func() -> bool: return effects("mask-live").get("clip", null) != null)
  var smaller := dict(dict(dict(effects("mask-live").get("clip", null)).get("outer", null)).get("radii", null))
  check(rounded and clear and back and close_all(round_params.get("outer_rx", null), [24.0, 24.0, 24.0, 24.0]) and close_all(smaller.get("horizontal", null), rep(6))
    and n(counters(), "requested") == n(base, "requested") and counter("mask-live", "draws") >= drawn_before + 3,
    "mask/Giving the view a radius, letting it overflow and clipping it again redraws at once with no request", true)
  # Everything at once.
  var together := effects("all-together")
  var together_params := params("all-together")
  check(String(together.get("kind", "")) == "ninePatch" and close_all(together.get("tint", null), [1.0, 0.8, 0.0, 1.0]) and close(together_params.get("tinted", -1), 1.0)
    and close(together_params.get("clipped", -1), 1.0) and String(command("all-together").get("op", "")) == "ninePatch",
    "combined/A tinted nine-patch in a rounded view is one item: the tint, the mask and the nine-patch are declared together", true)
  stages.mask = {"cases": cases, "failing": failing}

func shared_blurred(kernel: int) -> String:
  return String(dict(dict(dict(manifest.get("shared", null)).get("formats/format.png", null)).get("blurred", null)).get(str(kernel), "?"))

func network_stage() -> void:
  var plain_fingerprint := String(dict(dict(shared_manifest.get("files", null)).get("formats/format.png", null)).get("fingerprint", "?"))
  var net_declared: Array = arr(js_json("ImagesVisual.declaredNetwork()"))
  var before := counters()
  var before_decoded := dict(caches().get("decoded", null))
  var before_live := n(loader(), "liveTextures")
  var steps: Array = []
  var snap := func(label: String) -> void:
    var shown_views := {}
    for id: String in ["blur-a", "plain-a", "blur-b", "tint", "mask"]:
      if not view(id, "N").is_empty():
        shown_views[id] = view(id, "N")
    steps.append({"label": label, "counters": counters(), "decoded": dict(caches().get("decoded", null)), "bytes": dict(caches().get("bytes", null)),
      "live": n(loader(), "liveTextures"), "views": shown_views})
  # 1. A blurred request first: it downloads, and leaves the decoded cache empty.
  run_js("update('N-blur-a', {show: true})")
  await wait_until(func() -> bool: return idle(n(before, "requested") + 1) and String(view("blur-a", "N").get("status", "")) == "loaded")
  await settle(3)
  snap.call("blur-a")
  var one: Dictionary = steps[0]
  check(n(one.counters, "downloads") == n(before, "downloads") + 1 and n(one.decoded, "entries") == n(before_decoded, "entries") and n(one.decoded, "stores") == n(before_decoded, "stores")
    and n(one.counters, "decodedHits") == n(before, "decodedHits") and n(one.bytes, "entries") == 1 and bool(blur_of("blur-a", "N").get("applies", false))
    and fingerprint_of("blur-a", "N") == shared_blurred(3),
    "network/A blurred request downloads, decodes, blurs and keeps its picture to itself: the decoded cache holds nothing, and the byte cache holds the response", true)
  # 2. The plain request of the same address: from the byte cache, and decoded again, unblurred.
  run_js("update('N-plain-a', {show: true})")
  await wait_until(func() -> bool: return idle(n(before, "requested") + 2) and String(view("plain-a", "N").get("status", "")) == "loaded")
  await settle(3)
  snap.call("plain-a")
  var two: Dictionary = steps[1]
  check(n(two.counters, "downloads") == n(one.counters, "downloads") and n(two.counters, "byteHits") == n(one.counters, "byteHits") + 1 and n(two.decoded, "entries") == 1
    and fingerprint_of("plain-a", "N") == plain_fingerprint and fingerprint_of("blur-a", "N") != plain_fingerprint and bool(blur_of("blur-a", "N").get("applies", false)),
    "network/The plain request after it is answered from the byte cache and decodes the pixels of the file: no blurred pixel went into the decoded cache", true)
  # 3. Another blurred request: the decoded cache holds a plain picture now, and a blurred request does not read it.
  run_js("update('N-blur-b', {show: true})")
  await wait_until(func() -> bool: return idle(n(before, "requested") + 3) and String(view("blur-b", "N").get("status", "")) == "loaded")
  await settle(3)
  snap.call("blur-b")
  var three: Dictionary = steps[2]
  check(n(three.counters, "decodedHits") == n(two.counters, "decodedHits") and n(three.counters, "byteHits") == n(two.counters, "byteHits") + 1
    and n(three.counters, "downloads") == n(two.counters, "downloads") and fingerprint_of("blur-b", "N") == fingerprint_of("blur-a", "N") and fingerprint_of("blur-b", "N") != plain_fingerprint
    and n(three.decoded, "entries") == 1 and n(three.decoded, "stores") == n(two.decoded, "stores") and bool(blur_of("blur-b", "N").get("applies", false)),
    "network/A blurred request does not read the decoded cache, though it holds the picture: it takes the bytes and blurs them, and the cache is as it was", true)
  # 4. A tinted and a masked view of the cached picture: both are answered by the decoded cache, and one picture is shared by them.
  run_js("update('N-tint', {show: true})")
  run_js("update('N-mask', {show: true})")
  await wait_until(func() -> bool: return idle(n(before, "requested") + 5) and String(view("tint", "N").get("status", "")) == "loaded" and String(view("mask", "N").get("status", "")) == "loaded")
  await settle(3)
  snap.call("shared")
  var four: Dictionary = steps[3]
  var cached := picture("plain-a", "N")
  check(n(four.counters, "decodedHits") == n(three.counters, "decodedHits") + 2 and n(four.counters, "uploads") == n(three.counters, "uploads") and n(four.decoded, "entries") == 1
    and not cached.is_empty() and cached == picture("tint", "N") and cached == picture("mask", "N") and fingerprint_of("tint", "N") == plain_fingerprint,
    "network/A tinted view and a masked view of the cached picture are answered by the decoded cache: they share its picture, and no texture is made")
  check(effects("tint", "N").get("tint", null) != null and effects("mask", "N").get("clip", null) != null and effects("tint", "N").get("clip", 1) == null
    and effects("mask", "N").get("tint", 1) == null and effects("blur-a", "N").get("tint", 1) == null and n(four, "live") == before_live + 3,
    "network/Each view draws what it was given, tinted, masked or blurred, over the same picture; the live textures are the cached one and the two blurred, no more", true)
  # 5. The same Image blurs, and then does not: a blurred request leaves the shared picture alone, a plain one finds it again.
  run_js("clearLog('N-plain-a')")
  var became_blurred: bool = await change("plain-a", {"props": {"blurRadius": 2}}, func() -> bool: return bool(blur_of("plain-a", "N").get("applies", false)), "N")
  await wait_until(func() -> bool: return idle(n(before, "requested") + 6))
  snap.call("blurred-again")
  var five: Dictionary = steps[4]
  var types := log_types("plain-a", "N")
  var blurred_fingerprint := fingerprint_of("plain-a", "N")
  run_js("clearLog('N-plain-a')")
  var plain_again: bool = await change("plain-a", {"props": {"blurRadius": null}}, func() -> bool: return not bool(blur_of("plain-a", "N").get("applies", true)), "N")
  await wait_until(func() -> bool: return idle(n(before, "requested") + 7))
  snap.call("plain-again")
  var six: Dictionary = steps[5]
  check(became_blurred and types == ["load", "loadEnd"] and n(five.counters, "decodedHits") == n(four.counters, "decodedHits") and n(five.decoded, "entries") == 1
    and blurred_fingerprint != plain_fingerprint and blurred_fingerprint == shared_blurred(5),
    "network/Blurring an Image that showed the cached picture asks again, with no onLoadStart, and reads nothing from the decoded cache", true)
  check(cached == picture("tint", "N") and cached == picture("mask", "N") and fingerprint_of("tint", "N") == plain_fingerprint and not cached.is_empty(),
    "network/and the cached picture, shown by two other views, is as it was")
  check(plain_again and n(six.counters, "decodedHits") == n(five.counters, "decodedHits") + 1 and fingerprint_of("plain-a", "N") == plain_fingerprint
    and n(six.counters, "downloads") == n(five.counters, "downloads"), "network/Clearing the blur finds the cached picture again, without the network", true)
  stages.network = {"steps": steps, "declared": net_declared, "before": before, "beforeDecoded": before_decoded, "beforeLive": before_live, "types": types}

func layers_of(target: Control) -> Dictionary:
  var items := 0
  var materials := 0
  var views := 0
  for row: Dictionary in arr(native(target).get("nodes", null)):
    if row.kind != "image":
      continue
    views += 1
    var current := dict(dict(dict(dict(row.get("image", null)).get("drawn", null)).get("effects", null)).get("layer", null))
    items += 1 if bool(current.get("item", false)) else 0
    materials += 1 if bool(current.get("material", false)) else 0
  return {"views": views, "items": items, "materials": materials}

func lifecycle_stage() -> void:
  var first := effects_counters()
  var local := layers_of(surface)
  var remote := layers_of(network_surface)
  var live_items := n(first, "itemsCreated") - n(first, "itemsFreed")
  var live_materials := n(first, "materialsCreated") - n(first, "materialsFreed")
  check(n(first, "itemsCreated") > 0 and live_items == int(local.items) + int(remote.items) and live_items == int(local.views) + int(remote.views)
    and live_materials == int(local.materials) + int(remote.materials) and int(local.materials) > 0,
    "lifecycle/Every Image that has a picture has one item of its own, and every Image that tints or clips has one material: the RIDs made and freed are the live ones", true)
  check(n(first, "shadersCreated") == 1 and n(first, "shadersFreed") == 0,
    "lifecycle/One shader serves every view, made the first time one needed it, and it is freed with the extension, not with a view", true)
  # Unmounting an Image frees its item, and its material if it has one.
  run_js("update('V-tint-hex', {show: false})")
  await wait_until(func() -> bool: return node_of("V-tint-hex").is_empty())
  var after_tinted := effects_counters()
  run_js("update('V-plain-2x', {show: false})")
  await wait_until(func() -> bool: return node_of("V-plain-2x").is_empty())
  var after_plain := effects_counters()
  check(n(after_tinted, "itemsFreed") == n(first, "itemsFreed") + 1 and n(after_tinted, "materialsFreed") == n(first, "materialsFreed") + 1
    and n(after_plain, "itemsFreed") == n(after_tinted, "itemsFreed") + 1 and n(after_plain, "materialsFreed") == n(after_tinted, "materialsFreed") and n(after_plain, "shadersFreed") == 0,
    "lifecycle/Unmounting a tinted Image frees its item and its material, and unmounting a plain one frees its item alone", true)
  run_js("update('V-tint-hex', {show: true})")
  await wait_until(func() -> bool: return shown("tint-hex"))
  var after_remount := effects_counters()
  check(n(after_remount, "itemsCreated") == n(after_plain, "itemsCreated") + 1 and n(after_remount, "materialsCreated") == n(after_plain, "materialsCreated") + 1
    and n(after_remount, "shadersCreated") == 1, "lifecycle/Mounting it again makes an item and a material of its own and does not make the shader again", true)
  stages.lifecycle = {"first": first, "afterTinted": after_tinted, "afterPlain": after_plain, "afterRemount": after_remount, "local": local, "remote": remote}

func stop_stage() -> void:
  stages.beforeStop = {"effects": effects_counters(), "loader": loader()}
  network_surface.queue_free()
  await wait_until(func() -> bool: return int(native(application).get("rootCount", 0)) == 1)
  await settle(4)
  var after_surface := effects_counters()
  var local := layers_of(surface)
  check(n(after_surface, "itemsCreated") > 0 and n(after_surface, "itemsCreated") - n(after_surface, "itemsFreed") == int(local.views),
    "lifecycle/Unmounting a root frees the items and materials of its Images, and only theirs", true)
  application.call("stop")
  surface.queue_free()
  await wait_until(func() -> bool:
    var current := effects_counters()
    return n(current, "itemsCreated") > 0 and n(current, "itemsCreated") == n(current, "itemsFreed") and n(current, "materialsCreated") == n(current, "materialsFreed"), 8000)
  await settle(4)
  var final := effects_counters()
  var stopped := native(application)
  var done := dict(dict(stopped.get("images", null)).get("counters", null))
  check(bool(stopped.get("stopped", false)) and n(final, "itemsCreated") > 0 and n(final, "itemsCreated") == n(final, "itemsFreed")
    and n(final, "materialsCreated") == n(final, "materialsFreed") and n(final, "shadersCreated") == 1 and n(final, "shadersFreed") == 0
    and n(done, "tasksStarted") == n(done, "tasksAwaited") and n(dict(stopped.get("images", null)), "liveTextures") == 0,
    "lifecycle/When the application stops and its views are gone, no item and no material is left, no texture outlives it, and the shader still waits for the extension to end", true)
  stages.afterStop = {"application": stopped, "effects": final, "afterSurface": after_surface}

func _initialize() -> void:
  var arguments := OS.get_cmdline_user_args()
  allow_original_negative = arguments.has("--allow-original-negative")
  sabotage = arguments.has("--sabotage")
  for argument: String in arguments:
    if argument.begins_with("--ports="):
      ports = JSON.parse_string(argument.trim_prefix("--ports="))
  call_deferred("run_probe")

func run_probe() -> void:
  root.content_scale_size = Vector2i.ZERO
  root.content_scale_mode = Window.CONTENT_SCALE_MODE_CANVAS_ITEMS
  root.size = Vector2i(2200, 1700)
  root.content_scale_factor = SCALE
  await settle(2)
  manifest = JSON.parse_string(FileAccess.get_file_as_string(DIR + "manifest.json"))
  shared_manifest = JSON.parse_string(FileAccess.get_file_as_string(IMAGES + "manifest.json"))
  base_url = "http://127.0.0.1:" + str(int(ports.get("http", 0)))
  application = ClassDB.instantiate("FabricApplication")
  application.name = "ImagesVisualApplication"
  application.set_meta("scenario", "images-fixture")
  application.set("bundle_path", "res://build/images-visual-probe.js")
  root.add_child(application)
  surface = mount_surface("A", "ImagesVisual", Vector2(0, 0), Vector2(1100, 760), {"name": "V"})
  network_surface = mount_surface("B", "ImagesVisualNetwork", Vector2(0, 780), Vector2(300, 120), {"name": "N", "baseUrl": base_url})
  await wait_until(func() -> bool: return int(dict(react().get("mounts", null)).get("V", 0)) == 1 and int(dict(react().get("mounts", null)).get("N", 0)) == 1, 60000)
  declared = arr(js_json("ImagesVisual.declared()"))
  await wait_until(func() -> bool: return idle(declared.size()) and all_shown(), 60000)
  await settle(6)
  mount_stage()
  ignored_stage()
  blur_stage()
  await blur_live_stage()
  await tint_stage()
  await caps_stage()
  await mask_stage()
  await network_stage()
  await lifecycle_stage()
  check(errors().is_empty(), "cleanup/No host or runtime diagnostic was reported")
  await stop_stage()
  var stopped := dict(stages.afterStop.application)
  check(bool(stopped.get("stopped", false)) and int(stopped.get("rootCount", -1)) == 0 and int(stopped.get("pendingWork", -1)) == 0, "cleanup/Stop releases every root and queued work")
  if is_instance_valid(surface):
    surface.queue_free()
  if is_instance_valid(network_surface):
    network_surface.queue_free()
  application.queue_free()
  await settle()
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var observed := failures.duplicate()
  var expected_failures := expected_original_failures.duplicate()
  observed.sort()
  expected_failures.sort()
  var original_negative_observed := allow_original_negative and observed == expected_failures and not failures.is_empty()
  stages.changes = changes
  var report := {"scenario": "images-visual", "reactNative": "0.87.1", "godot": Engine.get_version_info().string, "displayServer": DisplayServer.get_name(),
    "checks": checks, "stages": stages, "expectedOriginalFailures": expected_original_failures, "scale": SCALE, "ports": ports, "baseUrl": base_url,
    "allowOriginalNegative": allow_original_negative, "originalNegativeObserved": original_negative_observed, "sabotage": sabotage,
    "allCurrentAssertionsPassed": failures.is_empty(),
    "scope": {"actualSceneTreeFrames": true, "workerThreadIdentity": true, "originalImageIos": true, "pixelCapture": false, "headlessRenderer": true, "network": true}}
  var output := FileAccess.open("res://build/images-visual-report.json", FileAccess.WRITE)
  if not check(output != null, "report/The visual images report is saved"):
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  output.close()
  var verdict := "IMAGES_VISUAL_SABOTAGE_REJECTED: " + str(failures.size()) if sabotage and not failures.is_empty() else "IMAGES_VISUAL_ORIGINAL_NEGATIVE: " + str(failures.size()) if original_negative_observed else "IMAGES_VISUAL_PASSED: " + str(checks.size()) if failures.is_empty() else "IMAGES_VISUAL_FAILED"
  print(verdict)
  quit(0 if failures.is_empty() or original_negative_observed or (sabotage and not failures.is_empty()) else 1)
