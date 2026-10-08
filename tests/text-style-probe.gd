extends SceneTree

# The public Text with fontStyle italic and textDecorationLine over the host paragraph. JS (tests/text-style-fixture.jsx)
# declares the styles and records the errors of the facade; the native snapshots say what the host shaped, would paint
# and measured. The relations between them are checked here; tests/text-style-oracle.mjs judges the same raw
# observations again, from the font tables and the rules of RN's attributes, without this file's verdicts.
#
# --lane current          the SDK and the host of this slice
# --lane previous         the SDK and the host of main before the slice (the facade rejects both styles)
# --lane previous-host    this SDK on the host of main before the slice (no skew, no decoration, no guards)
# --lane sabotage         a sabotaged source (scripts/text-style-sabotage.mjs): some check must fail
const SIZE := Vector2(380, 1700)
const SKEW := 0.25
const EPSILON := 0.01
const INK := "f8fafcff"
const GREEN := "22c55eff"
const ORANGE := "f97316ff"
const RED := "ef4444ff"
const SKY := "38bdf8ff"
# Each style the facade rejects and the text its error must start with (the oracle keeps its own copy).
const REJECTIONS := [
  ["oblique", "Godot Text does not implement style fontStyle oblique: use normal or italic"],
  ["font-style-bogus", "Godot Text does not implement style fontStyle slanted: use normal or italic"],
  ["line-strikethrough", "Godot Text does not implement style textDecorationLine strikethrough: use none, underline, line-through or underline line-through"],
  ["line-underline-strikethrough", "Godot Text does not implement style textDecorationLine underline-strikethrough: use none"],
  ["line-reversed", "Godot Text does not implement style textDecorationLine line-through underline: use none"],
  ["line-overline", "Godot Text does not implement style textDecorationLine overline: use none"],
  ["line-bogus", "Godot Text does not implement style textDecorationLine sideways: use none"],
  ["style-double", "Godot Text does not implement style textDecorationStyle double: only solid"],
  ["style-dotted", "Godot Text does not implement style textDecorationStyle dotted: only solid"],
  ["style-dashed", "Godot Text does not implement style textDecorationStyle dashed: only solid"],
  ["style-wavy", "Godot Text does not implement style textDecorationStyle wavy: only solid"],
  ["style-alone", "Godot Text does not implement style textDecorationStyle dotted: only solid"],
  ["span-oblique", "Godot Text does not implement style fontStyle oblique: use normal or italic"],
  ["span-dotted", "Godot Text does not implement style textDecorationStyle dotted: only solid"],
  ["view-italic", "Godot View does not implement style fontStyle"],
  ["view-decoration", "Godot View does not implement style textDecorationLine"],
  ["input-italic", "Godot TextInput does not implement style fontStyle"],
  ["input-decoration", "Godot TextInput does not implement style textDecorationLine"],
]
# A NativeText imported directly reaches the host with these styles; the host must refuse them with these errors.
const BYPASS := [
  ["oblique", "Godot Text does not implement style fontStyle oblique: use normal or italic"],
  ["double", "Godot Text does not implement style textDecorationStyle double: only solid"],
  ["dotted", "Godot Text does not implement style textDecorationStyle dotted: only solid"],
  ["dashed", "Godot Text does not implement style textDecorationStyle dashed: only solid"],
  ["wavy", "Godot Text does not implement style textDecorationStyle wavy: only solid"],
]
# Paragraphs that measure and break exactly like the plain "base" one, and the pairs that do against their "-base".
const LIKE_BASE := ["normal", "italic", "underline", "strike", "both", "none", "color", "inert", "solid"]
const PAIRS := ["wrap", "wrap-spans", "centered", "spaced", "newline", "clip", "truncated", "truncated-two"]
const MEASURED := ["lines", "visibleLines", "measuredWidth", "measuredHeight", "ellipses", "lineMetrics"]
const COUNT := 41
var lane := "current"
var application: Node
var surfaces: Dictionary = {}
var checks: Array = []
var stages: Dictionary = {}
var normative: Array = []
var host_checks: Array = []
var cache: Dictionary = {}

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

# A check the SDK of main before this slice must fail: its facade rejects the styles the check needs.
func normative_check(condition: bool, name: String) -> bool:
  normative.append(name)
  return check(condition, name)

# A check the host of main before this slice must fail: it neither slants, nor draws lines, nor refuses.
func host_check(condition: bool, name: String) -> bool:
  host_checks.append(name)
  return check(condition, name)

func settle(count: int = 8) -> void:
  for index in range(count):
    await process_frame

# The condition is judged each frame; the limit only bounds the wait and never decides a check.
func wait_until(condition: Callable, limit_ms: int = 5000) -> bool:
  var deadline := Time.get_ticks_msec() + limit_ms
  while Time.get_ticks_msec() < deadline and not condition.call():
    await process_frame
  return condition.call()

func native(owner: Node) -> Dictionary:
  var value: Variant = JSON.parse_string(owner.call("snapshot"))
  return value if value is Dictionary else {}

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(TextStyleProbe." + expression + ")"))

func run_js(expression: String) -> void:
  application.call("evaluate", "TextStyleProbe." + expression)

func react() -> Dictionary:
  var value: Variant = js("snapshot()")
  return value if value is Dictionary else {}

func app_errors() -> Array:
  return native(application).get("errors", [])

func view(root_name: String, id: String) -> Dictionary:
  for entry: Dictionary in native(surfaces[root_name]).get("nodes", []):
    if entry.get("testID", "") == id:
      return entry
  return {}

func mount_surface(root_name: String, component: String, position: Vector2, size: Vector2, props: Dictionary = {}) -> void:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = root_name
  surface.position = position
  surface.size = size
  surface.set("application_path", NodePath("../TextStyleApplication"))
  surface.set("component_name", component)
  surface.set("initial_props", props)
  surfaces[root_name] = surface
  root.add_child(surface)

func paragraphs(root_name: String) -> Dictionary:
  var out := {}
  for entry: Dictionary in native(surfaces[root_name]).get("nodes", []):
    if entry.kind == "paragraph" and entry.get("testID", "") != "":
      out[entry.testID] = entry
  return out

# ---------------------------------------------------------------------------------------------------------------
# Readers of the static paragraphs. A paragraph the SDK did not mount reads as empty, so every lane runs the same
# checks and the ones that need it fail by what they observe.

func para(id: String) -> Dictionary:
  return cache.get(id, {})

func runs(id: String) -> Array:
  return para(id).get("runs", [])

func decorations(id: String) -> Array:
  return para(id).get("decorations", [])

func painted(id: String) -> Array:
  return para(id).get("painted", [])

func lines(id: String) -> Array:
  return para(id).get("lineMetrics", [])

func near(actual: Variant, expected: float, epsilon: float = EPSILON) -> bool:
  return (actual is float or actual is int) and absf(float(actual) - expected) <= epsilon

func kinds(id: String) -> Array:
  return decorations(id).map(func(row: Dictionary) -> String: return row.kind)

func colors(id: String) -> Array:
  return decorations(id).map(func(row: Dictionary) -> String: return row.color)

func by_run(id: String) -> Array:
  return decorations(id).map(func(row: Dictionary) -> int: return int(row.run))

func measures_like(id: String, other: String) -> bool:
  var left := para(id)
  var right := para(other)
  if left.is_empty() or right.is_empty():
    return false
  for key: String in MEASURED:
    if left.get(key) != right.get(key):
      return false
  return true

# The first run of a paragraph is the only one of the single-run cases below.
func glyph(id: String, index: int = 0) -> Dictionary:
  var rows := runs(id)
  return rows[index].get("glyphI", {}) if index < rows.size() else {}

# How far the top of the "I" of the run leans right of its bottom, relative to the plain run of the same font.
func leans(id: String, plain: String, index: int = 0, plain_index: int = 0) -> bool:
  var slanted := glyph(id, index)
  var upright := glyph(plain, plain_index)
  if slanted.is_empty() or upright.is_empty():
    return false
  var height := float(upright.bottom) - float(upright.top)
  return (height > 0 and near(float(slanted.top) - float(upright.top), 0.0) and near(float(slanted.bottom), float(upright.bottom))
    and near(float(slanted.topX) - float(upright.topX), SKEW * height, 0.1) and near(slanted.bottomX, float(upright.bottomX), 0.1)
    and near(slanted.advance, float(upright.advance)))

func straight(id: String, index: int = 0) -> bool:
  var upright := glyph(id, index)
  return not upright.is_empty() and near(upright.topX, float(upright.bottomX), 0.1)

# A line that covers its whole row: from the row's x to its x plus its width, which the host rounds up to a whole pixel.
func covers_row(row: Dictionary, line: Dictionary) -> bool:
  return not line.is_empty() and near(row.get("x0"), float(line.x)) and near(row.get("x1"), float(line.x) + float(line.width), 1.0)

# Every line of a one-row paragraph covers its row.
func covers_its_row(id: String) -> bool:
  var rows := decorations(id)
  var metrics := lines(id)
  return metrics.size() == 1 and not rows.is_empty() and rows.all(func(row: Dictionary) -> bool: return covers_row(row, metrics[0]))

# The lines of a kind lie on one side of the baseline, at least a pixel thick.
func lies(id: String, kind: String, below: bool) -> bool:
  var rows := decorations(id).filter(func(row: Dictionary) -> bool: return row.kind == kind)
  var metrics := lines(id)
  if rows.is_empty() or metrics.is_empty():
    return false
  return rows.all(func(row: Dictionary) -> bool: return side(float(row.y), float(metrics[int(row.line)].baseline), below) and float(row.thickness) >= 1.0)

func side(y: float, baseline: float, below: bool) -> bool:
  return y > baseline if below else y < baseline

func alpha(color: String) -> int:
  return color.substr(6, 2).hex_to_int()

func distinct(values: Array) -> bool:
  var seen := {}
  for value: Variant in values:
    seen[value] = true
  return seen.size() == values.size()

func summary(id: String) -> Array:
  return decorations(id).map(func(row: Dictionary) -> Array: return [int(row.run), row.kind, row.color])

func ellipsis_rows(id: String) -> Array:
  return painted(id).filter(func(row: Dictionary) -> bool: return row.ellipsis)

func is_plain(id: String) -> bool:
  return not para(id).is_empty() and decorations(id).is_empty()

func style_of(id: String) -> Array:
  return runs(id).map(func(row: Dictionary) -> String: return row.get("fontStyle", ""))

func italic_run(id: String) -> bool:
  return runs(id).size() == 1 and style_of(id) == ["italic"] and runs(id)[0].get("syntheticItalic") == true

func upright_run(id: String) -> bool:
  return runs(id).size() == 1 and style_of(id) == ["normal"] and runs(id)[0].get("syntheticItalic") == false

func style_cases() -> void:
  cache = paragraphs("S")
  stages["static"] = {"paragraphs": cache, "react": react()}
  var errors: Array = react().get("renderErrors", [])
  normative_check(errors.is_empty() and cache.size() == COUNT,
    "mount/Every style case commits as a paragraph without a render error")
  check(app_errors().is_empty(), "mount/The application reports no runtime error")

  # fontStyle
  host_check(["italic", "italic-mono", "italic-bold", "italic-default"].all(italic_run)
    and ["base", "normal", "mono", "bold"].all(upright_run),
    "italic/An italic run says italic and synthetic, an upright or normal one says normal")
  host_check(style_of("italic-span") == ["normal", "italic", "normal"],
    "italic/A span's fontStyle applies to it, and a nested normal cancels it")
  host_check(leans("italic", "base") and leans("italic-mono", "mono") and leans("italic-bold", "bold"),
    "italic/The top of an italic I leans 0.25 of its height to the right in both families and at bold, with the bottom and the advance unchanged")
  host_check(["base", "mono", "bold", "normal"].all(func(id: String) -> bool: return straight(id)),
    "italic/An upright I does not lean")
  var fallback := glyph("italic-default")
  host_check(not fallback.is_empty() and float(fallback.bottom) > float(fallback.top)
    and near(float(fallback.topX) - float(fallback.bottomX), SKEW * (float(fallback.bottom) - float(fallback.top)), 0.1),
    "italic/An italic paragraph that names no family leans too, instead of falling back to the upright font")
  normative_check(LIKE_BASE.all(func(id: String) -> bool: return measures_like(id, "base")),
    "measure/An italic or decorated paragraph measures and breaks exactly like the plain one")
  normative_check(PAIRS.all(func(id: String) -> bool: return measures_like(id, id + "-base")),
    "measure/A decorated, wrapped, aligned, truncated or clipped paragraph measures like the same without its decoration")

  # The lines drawn
  host_check(kinds("underline") == ["underline"] and kinds("strike") == ["line-through"]
    and kinds("both") == ["underline", "line-through"] and kinds("solid") == ["underline"] and kinds("mono-underline") == ["underline"],
    "decoration/Underline, line-through and both draw their lines, and an explicit solid style changes nothing")
  normative_check(["base", "italic", "none", "inert", "empty", "normal"].all(is_plain),
    "decoration/No line, none, a color or solid style without a line, an empty paragraph and plain text draw nothing")
  host_check(["underline", "strike", "both", "color", "mono-underline", "big-underline", "small-underline", "solid"].all(covers_its_row),
    "decoration/A line under a run that covers its row goes from the row's x to its x plus its width")
  host_check(["underline", "both", "color", "mono-underline", "big-underline", "small-underline"].all(func(id: String) -> bool: return lies(id, "underline", true))
    and ["strike", "both"].all(func(id: String) -> bool: return lies(id, "line-through", false)),
    "decoration/The underline sits below the baseline, the line-through above it, and neither is thinner than a pixel")
  host_check(colors("underline") == [INK] and colors("color") == [ORANGE] and colors("both") == [INK, INK],
    "decoration/The line takes the text color unless textDecorationColor sets one")
  host_check(by_run("spans") == [1, 3] and kinds("spans") == ["underline", "line-through"] and colors("spans") == [INK, GREEN],
    "decoration/Each span draws its own line, and only under its own run")
  var joined := decorations("adjacent")
  host_check(by_run("adjacent") == [0, 1, 2] and colors("adjacent") == [INK, INK, SKY]
    and near(joined[0].get("x1"), float(joined[1].get("x0", -1.0))) and near(joined[1].get("x1"), float(joined[2].get("x0", -1.0))),
    "decoration/Adjacent decorated runs draw contiguous lines in their own colors")
  var thick := decorations("big-underline")
  var thin := decorations("small-underline")
  host_check(thick.size() == 1 and float(thick[0].thickness) > 1.0 and thin.size() == 1 and near(thin[0].get("thickness"), 1.0),
    "decoration/The line is as thick as the font's underline and never thinner than a pixel")

  # Inheritance: a child replaces its parent's field, so none cancels an underline and a color alone only recolors
  host_check(summary("inherit") == [[0, "underline", GREEN], [2, "underline", GREEN], [3, "line-through", GREEN], [4, "underline", GREEN],
      [5, "underline", ORANGE], [6, "underline", GREEN], [7, "underline", RED], [7, "line-through", RED]],
    "inheritance/A child replaces its parent's line and color field by field: none cancels, line-through replaces underline, a color alone recolors")

  # Opacity multiplies the text and the line alike
  var faded := runs("fade")
  var dimmed := runs("fade-default")
  var dim := str(faded[1].get("color")) if faded.size() == 2 else ""
  host_check(dim.begins_with("ffffff") and alpha(dim) in [127, 128] and colors("fade") == ["ff0000" + dim.substr(6, 2)]
    and dimmed.size() == 2 and colors("fade-default") == [dimmed[1].get("color")],
    "opacity/A span's opacity dims its explicit line color as it dims its text, and a line without a color follows the dimmed text")

  # Rows, runs and the truncated text
  var wrapped := para("wrap")
  host_check(int(wrapped.get("visibleLines", 0)) > 1 and decorations("wrap").size() == int(wrapped.get("visibleLines", -1))
    and decorations("wrap").all(func(row: Dictionary) -> bool: return covers_row(row, lines("wrap")[int(row.line)])),
    "rows/A decorated paragraph that wraps draws one line per visible row, each as wide as its row")
  var crossing := decorations("wrap-spans")
  host_check(crossing.size() > 1 and crossing.all(func(row: Dictionary) -> bool: return int(row.run) == 1)
    and distinct(crossing.map(func(row: Dictionary) -> int: return int(row.line))),
    "rows/A decorated run that wraps draws one segment per visible row, and nothing under the other runs")
  host_check(decorations("centered").size() == 1 and float(lines("centered")[0].x) > 0.0 and covers_its_row("centered"),
    "rows/The line follows an aligned row instead of the paragraph's left edge")
  host_check(covers_its_row("spaced"), "rows/The line covers the letter spacing of its run")
  host_check(int(para("newline").get("visibleLines", 0)) == 2 and decorations("newline").size() == 1 and int(decorations("newline")[0].line) == 0,
    "rows/The empty row after a trailing newline has no line")
  var tail := ellipsis_rows("truncated")
  host_check(int(para("truncated").get("ellipses", 0)) == 1 and tail.size() == 1 and int(tail[0].run) == 1 and by_run("truncated") == [1]
    and decorations("truncated")[0].get("x1") == tail[0].get("x1"),
    "ellipsis/The ellipsis takes the run of the last glyph before it: its color and its line, not the first run's")
  var tail_two := ellipsis_rows("truncated-two")
  var second_row := decorations("truncated-two").filter(func(row: Dictionary) -> bool: return int(row.line) == 1)
  host_check(tail_two.size() == 1 and int(tail_two[0].run) == 1 and int(tail_two[0].line) == 1
    and second_row.map(func(row: Dictionary) -> String: return row.kind) == ["underline", "line-through"]
    and decorations("truncated-two").all(func(row: Dictionary) -> bool: return row.color == GREEN and int(row.run) == 1),
    "ellipsis/On the second of two rows the line under a truncated tail keeps its kinds and its explicit color to the ellipsis")
  var clipped := decorations("clip")
  host_check(clipped.size() == 1 and int(para("clip").get("ellipses", -1)) == 0 and painted("clip").size() == 1
    and clipped[0].get("x0") == painted("clip")[0].get("x0") and clipped[0].get("x1") == painted("clip")[0].get("x1"),
    "ellipsis/A clipped paragraph draws its line under the glyphs that are painted and no further")


func negative_case() -> void:
  var failures: Array = []
  var before_errors := app_errors().size()
  for entry: Array in REJECTIONS:
    var kind: String = entry[0]
    var expected: String = entry[1]
    var before: int = react().get("rejections", []).size()
    run_js("attempt('%s')" % kind)
    await wait_until(func() -> bool: return react().get("rejections", []).size() > before, 1500)
    var rejected: Array = react().get("rejections", [])
    var message: String = rejected[before] if rejected.size() > before else ""
    var fallback := not view("A", "guard-fallback").is_empty()
    var ok: bool = rejected.size() == before + 1 and message.begins_with(expected) and fallback
    # The facade before this slice rejects the style of a View with the very same words.
    if kind.begins_with("view-"):
      check(ok, "negative/" + kind + "/The facade rejects it before any native layout: " + expected)
    else:
      normative_check(ok, "negative/" + kind + "/The facade rejects it before any native layout: " + expected)
    failures.append({"kind": kind, "expected": expected, "message": message, "fallback": fallback})
    run_js("attempt(null)")
    await settle(4)
  check(app_errors().size() == before_errors, "negative/Rejected styles reach no native layout and report no host error")
  check(view("A", "guard-fallback").is_empty(), "negative/The boundary recovers once the rejected style is removed")
  stages["negative"] = {"failures": failures, "react": react()}

func bypass_case() -> void:
  var reports: Array = []
  var position := Vector2(820, 140)
  for entry: Array in BYPASS:
    var kind: String = entry[0]
    var expected: String = entry[1]
    var before := app_errors().size()
    mount_surface("F-" + kind, "TextStyleBypass", position, Vector2(220, 100), {"kind": kind})
    position.y += 110
    await settle(14)
    var fresh: Array = app_errors().slice(before)
    var render: Array = react().get("renderErrors", []).filter(func(row: Dictionary) -> bool: return row.case == "bypass-" + kind)
    var drawn := not view("F-" + kind, "bypass").is_empty()
    var report := {"kind": kind, "expected": expected, "errors": fresh, "renderErrors": render, "mounted": drawn}
    reports.append(report)
    host_check(not fresh.is_empty() and fresh.all(func(error: String) -> bool: return error == expected) and render.is_empty() and drawn,
      "bypass/" + kind + "/A NativeText that skips the facade is refused by the host with: " + expected)
  stages["bypass"] = {"reports": reports}

func stop_case() -> void:
  stages["beforeStop"] = {"application": native(application)}
  application.call("stop")
  await settle()
  var stopped := native(application)
  stages["afterStop"] = stopped
  check(stopped.stopped and int(stopped.rootCount) == 0 and int(stopped.pendingTimers) == 0 and int(stopped.pendingAnimationFrames) == 0,
    "stop/Stop retires every root without timers")
  for root_name: String in surfaces:
    var final_root := native(surfaces[root_name])
    check(int(final_root.get("nativeTags", -1)) == 0 and int(final_root.get("creates", -1)) == int(final_root.get("deletes", -2)),
      "stop/Root " + root_name + " balances its native Controls")

# ---------------------------------------------------------------------------------------------------------------

func _initialize() -> void:
  var args := OS.get_cmdline_user_args()
  var index := args.find("--lane")
  if index >= 0 and index + 1 < args.size():
    lane = args[index + 1]
  call_deferred("run")

func run() -> void:
  if not lane in ["current", "previous", "previous-host", "sabotage"]:
    push_error("FABRIC_ERROR: unknown text-style lane " + lane)
    quit(1)
    return
  root.size = Vector2i(1100, 760)
  application = ClassDB.instantiate("FabricApplication")
  application.name = "TextStyleApplication"
  application.set("bundle_path", "res://build/text-style-%s.js" % ("previous-probe" if lane == "previous" else "probe"))
  root.add_child(application)
  mount_surface("S", "TextStyleStatic", Vector2.ZERO, SIZE)
  mount_surface("A", "TextStyleAttempt", Vector2(820, 0), Vector2(240, 120))
  await settle(16)
  style_cases()
  await negative_case()
  await bypass_case()
  await stop_case()
  for surface: Node in surfaces.values():
    surface.queue_free()
  application.queue_free()
  await settle()
  var failed: Array = checks.filter(func(entry: Dictionary) -> bool: return not entry.passed).map(func(entry: Dictionary) -> String: return entry.name)
  var expected_previous := normative.duplicate()
  expected_previous.append_array(host_checks)
  var expected_host := host_checks.duplicate()
  var observed := failed.duplicate()
  expected_previous.sort()
  expected_host.sort()
  observed.sort()
  var previous_negative := lane == "previous" and not failed.is_empty() and observed == expected_previous
  var previous_host_negative := lane == "previous-host" and not failed.is_empty() and observed == expected_host
  var report := {"scenario": "native-text-style", "lane": lane, "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages,
    "expectedPreviousFailures": expected_previous, "expectedPreviousHostFailures": expected_host,
    "previousNegativeObserved": previous_negative, "previousHostNegativeObserved": previous_host_negative,
    "allCurrentAssertionsPassed": failed.is_empty(), "expectedErrors": stages.get("afterStop", {}).get("errors", []),
    "scope": {"publicFacadeImports": true, "originalTextModules": true, "productionBundle": true, "syntheticItalic": true,
      "realItalicFace": false, "solidLinesOnly": true, "hardwareCertified": false}}
  var file := FileAccess.open("res://build/text-style-report.json", FileAccess.WRITE)
  if not check(file != null, "report/The text style report can be saved"):
    quit(1)
    return
  file.store_string(JSON.stringify(report, "  ") + "\n")
  if lane == "previous":
    print("TEXT_STYLE_PREVIOUS_NEGATIVE: " + str(failed.size()) if previous_negative else "TEXT_STYLE_FAILED")
  elif lane == "previous-host":
    print("TEXT_STYLE_PREVIOUS_HOST_NEGATIVE: " + str(failed.size()) if previous_host_negative else "TEXT_STYLE_FAILED")
  elif lane == "sabotage":
    print("TEXT_STYLE_SABOTAGE_REJECTED: " + str(failed.size()) if not failed.is_empty() else "TEXT_STYLE_SABOTAGE_ACCEPTED")
  else:
    print("TEXT_STYLE_PASSED: " + str(checks.size()) if failed.is_empty() else "TEXT_STYLE_FAILED")
  quit(0 if (failed.is_empty() and lane != "sabotage") or previous_negative or previous_host_negative or (lane == "sabotage" and not failed.is_empty()) else 1)
