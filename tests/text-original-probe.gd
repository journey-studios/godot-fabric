extends SceneTree

# The public Text over RN's ORIGINAL Libraries/Text/Text.js, driven by actual Godot mouse and touch input. JS
# (tests/text-original-fixture.jsx) records what the Text reports; native snapshots show what the host mounted and
# paints. The relations between them are checked here; tests/text-original-oracle.mjs judges the same raw
# observations again, from the rules of RN's Pressability and the declared styles, without this file's verdicts.
#
# --lane current          the SDK and the host of this slice
# --lane previous         the SDK and the host of main before the slice (the old wrapper, no guard)
# --lane previous-host    this SDK on the host of main before the slice (the native guard is missing)
# --lane sabotage         a sabotaged source (scripts/text-original-sabotage.mjs): some check must fail
const DEVICE := 1001
const SIZE := Vector2(400, 440)
const ORIGIN := Vector2.ZERO
const MIN_PRESS_MS := 130
const INLINE := "Inline Controls are not implemented in Godot Text"
# Each rejected prop and the text its error must carry (the oracle keeps its own copy).
const REJECTIONS := [
  ["span-press", "does not implement onPress"],
  ["span-press-in", "does not implement onPressIn"],
  ["span-press-out", "does not implement onPressOut"],
  ["span-long-press", "does not implement onLongPress"],
  ["span-responder", "does not implement onResponderGrant"],
  ["span-start", "does not implement onStartShouldSetResponder"],
  ["selectable", "does not implement selectable"],
  ["fit", "does not implement adjustsFontSizeToFit"],
  ["head", "supports tail or clip ellipsizeMode"],
  ["middle", "supports tail or clip ellipsizeMode"],
  ["bogus", "supports tail or clip ellipsizeMode"],
  ["selection-color", "does not implement selectionColor"],
  ["detector", "does not implement dataDetectorType"],
  ["break-strategy", "does not implement textBreakStrategy"],
  ["line-break-ios", "does not implement lineBreakStrategyIOS"],
  ["hyphenation", "does not implement android_hyphenationFrequency"],
  ["text-prop", "does not implement text"],
  ["font-size-prop", "does not implement fontSize"],
  ["font-style", "does not implement style fontStyle"],
  ["decoration", "does not implement style textDecorationLine"],
  ["lines-negative", "numberOfLines must be a nonnegative integer"],
  ["lines-fraction", "numberOfLines must be a nonnegative integer"],
  ["lines-span", "numberOfLines applies to the outer paragraph only"],
  ["layout-string", "onTextLayout must be a function"],
  ["inline-view", INLINE],
  ["inline-pressable", INLINE],
  ["inline-touchable", INLINE],
]
# A NativeText imported directly reaches the host with these props; the host must refuse them with these errors.
const BYPASS := [
  ["fit", "Godot Text does not implement adjustsFontSizeToFit"],
  ["head", "Godot Text supports tail or clip ellipsizeMode"],
  ["middle", "Godot Text supports tail or clip ellipsizeMode"],
]
var lane := "current"
var application: Node
var surfaces: Dictionary = {}
var checks: Array = []
var stages: Dictionary = {}
var normative: Array = []
var host_checks: Array = []

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

# A check the SDK of main before this slice (its own wrapper, registering RCTText itself) must fail.
func normative_check(condition: bool, name: String) -> bool:
  normative.append(name)
  return check(condition, name)

# A check the host of main before this slice (no guard in ParagraphLayout::prepare) must fail.
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

func wait_since(start: int, elapsed: int) -> void:
  while Time.get_ticks_msec() - start < elapsed:
    await process_frame

func native(owner: Node) -> Dictionary:
  var value: Variant = JSON.parse_string(owner.call("snapshot"))
  return value if value is Dictionary else {}

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(TextOriginalProbe." + expression + ")"))

func run_js(expression: String) -> void:
  application.call("evaluate", "TextOriginalProbe." + expression)

func take() -> Array:
  var value: Variant = js("take()")
  return value if value is Array else []

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

func tag(root_name: String, id: String) -> int:
  var entry := view(root_name, id)
  return int(entry.tag) if not entry.is_empty() else -1

func rect(root_name: String, id: String) -> Rect2:
  var control: Control = surfaces[root_name].find_child(id, true, false)
  # A missing host yields a point outside every surface, never a script error.
  return control.get_global_rect() if control != null else Rect2(-1000, -1000, 0, 0)

func center(id: String) -> Vector2:
  return rect("P", id).get_center()

func pointer() -> Dictionary:
  return native(surfaces.P).get("pointer", {})

func released() -> bool:
  var value := pointer()
  return int(value.get("responder", -1)) == 0 and int(value.get("activeTouches", -1)) == 0

func types(rows: Array) -> Array:
  return rows.map(func(row: Dictionary) -> String: return row.type)

func ids(rows: Array) -> Array:
  return rows.map(func(row: Dictionary) -> String: return row.id)

# One actual Godot input sample. Mouse downs first move the button-less pointer there, as a real mouse does; touch
# uses contact 0.
func send(device: String, phase: String, at: Vector2) -> void:
  if device == "mouse":
    if phase != "up":
      var motion := InputEventMouseMotion.new()
      motion.device = DEVICE
      motion.position = at
      motion.button_mask = MOUSE_BUTTON_MASK_LEFT if phase == "move" else 0
      Input.parse_input_event(motion)
    if phase != "move":
      var button := InputEventMouseButton.new()
      button.device = DEVICE
      button.position = at
      button.button_index = MOUSE_BUTTON_LEFT
      button.pressed = phase == "down"
      button.button_mask = MOUSE_BUTTON_MASK_LEFT if phase == "down" else 0
      Input.parse_input_event(button)
  elif phase == "move":
    var drag := InputEventScreenDrag.new()
    drag.device = DEVICE
    drag.index = 0
    drag.position = at
    Input.parse_input_event(drag)
  else:
    var contact := InputEventScreenTouch.new()
    contact.device = DEVICE
    contact.index = 0
    contact.position = at
    contact.pressed = phase == "down"
    Input.parse_input_event(contact)

# A gesture on one target: every sample sent and what JS reported after it, in order. The oracle replays the
# samples against the target's rectangle; the checks below read the same rows.
func begin(name: String, id: String, device: String) -> Dictionary:
  var bounds := rect("P", id)
  var gesture := {"name": name, "id": id, "device": device, "tag": tag("P", id),
    "rect": [bounds.position.x, bounds.position.y, bounds.size.x, bounds.size.y], "steps": []}
  stages[name] = gesture
  return gesture

func step(gesture: Dictionary, phase: String, at: Vector2, frames: int = 2) -> Array:
  send(gesture.device, phase, at)
  await settle(frames)
  var events := take()
  gesture.steps.append({"phase": phase, "page": [at.x - ORIGIN.x, at.y - ORIGIN.y], "events": events, "pointer": pointer()})
  return events

# Waits, for the duration given, with the pointer untouched; whatever JS reports meanwhile is the step's events.
func hold(gesture: Dictionary, elapsed_ms: int) -> Array:
  await wait_since(Time.get_ticks_msec(), elapsed_ms)
  var events := take()
  gesture.steps.append({"phase": "hold", "page": [], "events": events, "elapsed": elapsed_ms, "pointer": pointer()})
  return events

# Waits until JS reports a row of the type (a long press), or, for "out", until every press in has been pressed out
# (the deferred press out of a short tap), however long the frames take.
func wait_for(gesture: Dictionary, type: String, limit_ms: int = 4000) -> Array:
  var rows: Array = []
  var deadline := Time.get_ticks_msec() + limit_ms
  while Time.get_ticks_msec() < deadline and not complete(gesture, rows, type):
    await process_frame
    rows.append_array(take())
  await settle(2)
  rows.append_array(take())
  gesture.steps.append({"phase": "wait", "type": type, "page": [], "events": rows, "pointer": pointer()})
  return rows

func complete(gesture: Dictionary, rows: Array, type: String) -> bool:
  var kinds := types(rows_of(gesture) + rows)
  if type == "out":
    return kinds.count("out") >= kinds.count("in")
  return kinds.has(type)

func rows_of(gesture: Dictionary) -> Array:
  var rows: Array = []
  for entry: Dictionary in gesture.steps:
    rows.append_array(entry.events)
  return rows

func at_of(rows: Array, type: String) -> float:
  for row: Dictionary in rows:
    if row.type == type:
      return float(row.at)
  return -1.0

# RN's responder payload: the paragraph as target and current target, root-relative page coordinates and
# target-local location.
func payload(entry: Dictionary, target: String, at: Vector2, touches: int) -> bool:
  if entry.is_empty():
    return false
  var origin := rect("P", target).position - ORIGIN
  var page := at - ORIGIN
  return (int(entry.target) == tag("P", target) and int(entry.currentTarget) == tag("P", target)
    and is_equal_approx(float(entry.pageX), page.x) and is_equal_approx(float(entry.pageY), page.y)
    and is_equal_approx(float(entry.locationX), page.x - origin.x) and is_equal_approx(float(entry.locationY), page.y - origin.y)
    and int(entry.touches) == touches and int(entry.changedTouches) == 1 and float(entry.timestamp) > 0.0)

func item(rows: Array, index: int) -> Dictionary:
  return rows[index] if index >= 0 and index < rows.size() else {}

func mount_surface(root_name: String, component: String, position: Vector2, size: Vector2, props: Dictionary = {}) -> void:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = root_name
  surface.position = position
  surface.size = size
  surface.set("application_path", NodePath("../TextOriginalApplication"))
  surface.set("component_name", component)
  surface.set("initial_props", props)
  surface.set_meta("validation_input_device", DEVICE)
  surfaces[root_name] = surface
  root.add_child(surface)

func paragraphs(root_name: String) -> Dictionary:
  var out := {}
  for entry: Dictionary in native(surfaces[root_name]).get("nodes", []):
    if entry.kind == "paragraph" and entry.get("testID", "") != "":
      out[entry.testID] = entry
  return out

# ---------------------------------------------------------------------------------------------------------------

func mount_case() -> void:
  var errors: Array = react().get("renderErrors", []).filter(func(row: Dictionary) -> bool: return not row.case.begins_with("s-"))
  var nodes := paragraphs("P")
  var hosts_ok := true
  for id: String in ["tap", "long", "retention", "disabled", "span", "inert", "responder", "plain"]:
    hosts_ok = hosts_ok and nodes.has(id) and surfaces.P.find_child(id, true, false) != null
  stages["mount"] = {"renderErrors": errors, "paragraphs": nodes.keys(), "application": native(application)}
  normative_check(hosts_ok and errors.is_empty(), "mount/The original Text commits every press and static case as a paragraph without a render error")
  check(app_errors().is_empty(), "mount/The application reports no runtime error")

func registry_case() -> void:
  var value: Variant = js("registry()")
  var found: Dictionary = value if value is Dictionary else {}
  stages["registry"] = found
  var text: Dictionary = found.get("text", {})
  var virtual: Dictionary = found.get("virtual", {})
  var original: Dictionary = found.get("original", {})
  normative_check(original.get("loaded", false) == true and original.get("text") == "RCTText" and original.get("virtual") == "RCTVirtualText"
    and str(found.get("secondText", "")).contains("same name RCTText") and str(found.get("secondVirtual", "")).contains("same name RCTVirtualText"),
    "registry/RN's TextNativeComponent loads: RCTText and RCTVirtualText have exactly one registration, and it is its own")
  var styles: Array = text.get("styleNames", [])
  normative_check(text.get("onTextLayout") == true and text.get("topTextLayout") == "onTextLayout" and text.get("isPressable") == true
    and ["fontFamily", "fontSize", "fontWeight", "letterSpacing", "lineHeight", "textAlign", "color"].all(func(name: String) -> bool: return styles.has(name)),
    "registry/The one RCTText declares onTextLayout, topTextLayout, isPressable and the text styles the paragraph paints")
  normative_check(virtual.get("onTextLayout") == false and virtual.get("isPressable") == true and virtual.get("topTextLayout") == null,
    "registry/RCTVirtualText has no onTextLayout and no topTextLayout")

# A tap: the press and the release reach the host in the same frame, so the press lasts a few milliseconds whatever
# the pace of the frames, far inside the minimum press duration: Pressability presses, then presses out once the
# minimum has passed. The deferred press out is waited for by its event.
func tap_at(name: String, id: String, device: String, at: Vector2) -> Array:
  var gesture := begin(name, id, device)
  send(device, "down", at)
  send(device, "up", at)
  await settle(2)
  var burst := take()
  gesture.steps.append({"phase": "tap", "page": [at.x - ORIGIN.x, at.y - ORIGIN.y], "events": burst, "pointer": pointer()})
  await wait_for(gesture, "out")
  return rows_of(gesture)

func quick_tap(name: String, id: String, device: String) -> Array:
  var at := center(id)
  var rows := await tap_at(name, id, device, at)
  var kinds := types(rows)
  var pressed := item(rows, kinds.find("press"))
  normative_check(kinds.find("in") == 0 and payload(item(rows, 0), id, at, 1) and item(rows, 0).get("registration") == "onResponderGrant",
    name + "/Press in fires once on the grant, with the paragraph as target and current target")
  normative_check(kinds == ["in", "press", "out"] and ids(rows).all(func(row_id: String) -> bool: return row_id == id)
    and float(item(rows, 2).get("at", 0.0)) - float(item(rows, 0).get("at", 0.0)) >= MIN_PRESS_MS - 3,
    name + "/A tap presses first and presses out once the minimum press duration has passed")
  normative_check(payload(pressed, id, at, 0) and pressed.get("registration") == "onResponderRelease"
    and item(rows, 2).get("payloadId") == pressed.get("payloadId"),
    name + "/The press carries the release payload of the same contact, and the deferred press out the same event")
  check(released(), name + "/Release clears the native responder and contacts")
  return rows

func held_press(device: String) -> void:
  var name := "held/" + device
  var gesture := begin(name, "tap", device)
  var at := center("tap")
  await step(gesture, "down", at)
  # Longer than the minimum press duration and shorter than a long press: out is not deferred.
  await hold(gesture, MIN_PRESS_MS + 120)
  var up := await step(gesture, "up", at)
  await settle(2)
  var rows := rows_of(gesture)
  normative_check(types(rows) == ["in", "out", "press"] and types(up) == ["out", "press"],
    name + "/A press held past the minimum duration reports press out before press, both at the release")

func outside_press(device: String) -> void:
  var name := "outside/" + device
  var gesture := begin(name, "tap", device)
  var bounds := rect("P", "tap")
  var at := Vector2(bounds.position.x - 10, bounds.get_center().y)
  var down := await step(gesture, "down", at)
  var held := pointer()
  var up := await step(gesture, "up", at)
  await settle(4)
  var late := take()
  normative_check(bounds.size.x > 0 and down.is_empty() and up.is_empty() and late.is_empty() and int(held.get("responder", -1)) == 0,
    name + "/A press 10 px outside the paragraph neither claims the responder nor reports anything")

# Leaving and re-entering the region around the paragraph: the default offsets (20, 20, 20, 30) or the paragraph's
# pressRetentionOffset, strictly judged. Pressability defers a press out until the minimum press duration (130 ms)
# has passed since the press in, and never cancels a deferred one when the press comes back; so each activation is
# held past that minimum before the next sample, and every event arrives at its own sample.
func region_press(name: String, id: String, device: String, edge: String, offset: float, finish: String) -> void:
  var gesture := begin(name, id, device)
  var bounds := rect("P", id)
  var mid := bounds.get_center()
  var far: Vector2
  var near: Vector2
  if edge == "right":
    far = Vector2(bounds.end.x + offset + 3, mid.y)
    near = Vector2(bounds.end.x + offset - 3, mid.y)
  else:
    far = Vector2(mid.x, bounds.end.y + offset + 3)
    near = Vector2(mid.x, bounds.end.y + offset - 3)
  await step(gesture, "down", mid)
  await hold(gesture, MIN_PRESS_MS + 30)
  await step(gesture, "move", far)
  if finish == "back":
    await step(gesture, "move", near)
    await hold(gesture, MIN_PRESS_MS + 30)
    await step(gesture, "up", near)
  else:
    await step(gesture, "up", far)
  await settle(4)
  gesture.steps.append({"phase": "settle", "page": [], "events": take(), "pointer": pointer()})
  var expected: Array = ["in", "out", "in", "out", "press"] if finish == "back" else ["in", "out"]
  normative_check(types(rows_of(gesture)) == expected and released(),
    name + "/Moving 3 px beyond the region deactivates, 3 px back inside reactivates, and a release presses only inside it")

func long_press(device: String) -> void:
  var name := "long/" + device
  var gesture := begin(name, "long", device)
  var at := center("long")
  await step(gesture, "down", at)
  var held := await wait_for(gesture, "long", 4000)
  var up := await step(gesture, "up", at)
  await settle(2)
  var rows := rows_of(gesture)
  var started := at_of(rows, "in")
  normative_check(types(rows) == ["in", "long", "out"] and types(held).has("long") and at_of(held, "long") - started >= 499.0,
    name + "/onLongPress fires after the 500 ms delay, waited for by its event")
  normative_check(types(up) == ["out"] and not types(rows).has("press") and released(),
    name + "/Release after a long press reports press out and no press")
  var tap := await quick_tap("long-tap/" + device, "long", device)
  normative_check(types(tap) == ["in", "press", "out"],
    "long-tap/" + device + "/A short tap on a paragraph with onLongPress still presses and never reports a long press")

func disabled_press(device: String) -> void:
  var name := "disabled/" + device
  var gesture := begin(name, "disabled", device)
  var at := center("disabled")
  var down := await step(gesture, "down", at)
  var held := pointer()
  var up := await step(gesture, "up", at)
  await settle(4)
  var late := take()
  normative_check(rect("P", "disabled").size.x > 0 and down.is_empty() and up.is_empty() and late.is_empty() and int(held.get("responder", -1)) == 0,
    name + "/A disabled paragraph never claims the responder and reports nothing")

func plain_press(device: String) -> void:
  var name := "plain/" + device
  var gesture := begin(name, "plain", device)
  var at := center("plain")
  var down := await step(gesture, "down", at)
  var held := pointer()
  var up := await step(gesture, "up", at)
  check(down.is_empty() and up.is_empty() and int(held.get("responder", -1)) == 0,
    name + "/A paragraph without handlers claims no responder")

func span_press(device: String) -> void:
  var bounds := rect("P", "span")
  # The paragraph starts with its bold span, so 12 px from the left edge is over the span's own text; the right
  # part of the box is past the text.
  for point_name: String in ["on-span", "on-rest"]:
    var at := Vector2(bounds.position.x + (12 if point_name == "on-span" else 262), bounds.get_center().y)
    var name := "span/%s/%s" % [point_name, device]
    var rows := await tap_at(name, "span", device, at)
    normative_check(types(rows) == ["in", "press", "out"] and ids(rows).all(func(row_id: String) -> bool: return row_id == "span")
      and rows.all(func(row: Dictionary) -> bool: return int(row.target) == tag("P", "span")),
      name + "/A press over the paragraph reaches the outer paragraph, whether it is over a span's text or not")

func responder_press(device: String) -> void:
  var name := "responder/" + device
  var gesture := begin(name, "responder", device)
  var at := center("responder")
  var down := await step(gesture, "down", at)
  var held := pointer()
  var up := await step(gesture, "up", at)
  check(types(down) == ["grant"] and types(up) == ["release"] and int(held.get("responder", -1)) == tag("P", "responder") and released(),
    name + "/onStartShouldSetResponder alone makes the paragraph the responder: grant and release reach its handlers")

func sentinel_press(device: String) -> void:
  var name := "sentinel/" + device
  var rows := await tap_at(name, "sentinel", device, center("sentinel"))
  check(types(rows).count("press") == 1 and ids(rows).all(func(row_id: String) -> bool: return row_id == "sentinel") and released(),
    name + "/The SDK Pressable sentinel presses once and releases the responder")

# Every case with each device: a real mouse and a real touch.
func press_cases() -> void:
  for device: String in ["mouse", "touch"]:
    await quick_tap("tap/" + device, "tap", device)
    await held_press(device)
    await outside_press(device)
    await region_press("region/default-right-back/" + device, "tap", device, "right", 20.0, "back")
    await region_press("region/default-bottom-back/" + device, "tap", device, "bottom", 30.0, "back")
    await region_press("region/default-right-outside/" + device, "tap", device, "right", 20.0, "outside")
    await region_press("region/retention-right-back/" + device, "retention", device, "right", 14.0, "back")
    await region_press("region/retention-bottom-back/" + device, "retention", device, "bottom", 10.0, "back")
    await region_press("region/retention-right-outside/" + device, "retention", device, "right", 14.0, "outside")
    await long_press(device)
    await disabled_press(device)
    await plain_press(device)
    await span_press(device)
    await quick_tap("inert/" + device, "inert", device)
    await responder_press(device)
    await sentinel_press(device)

# ---------------------------------------------------------------------------------------------------------------

func static_case() -> void:
  var nodes := paragraphs("S")
  var layout: Variant = react()
  stages["static"] = {"paragraphs": nodes, "react": layout}
  var errors: Array = react().get("renderErrors", []).filter(func(row: Dictionary) -> bool: return row.case.begins_with("s-"))
  check(errors.is_empty() and nodes.size() == 19, "static/Every static paragraph commits without a render error")
  if nodes.size() != 19:
    return
  var base: Dictionary = nodes["s-18"]
  check(nodes["s-default"].runs[0].fontSize == 18 and nodes["s-default"].lineMetrics == base.lineMetrics
    and nodes["s-default"].measuredHeight == base.measuredHeight and nodes["s-14"].runs[0].fontSize == 14
    and nodes["s-14"].measuredHeight < base.measuredHeight,
    "static/A paragraph without a font size is laid out exactly like one at 18, and a style of 14 is smaller")
  check(nodes["s-inherit"].runs.map(func(run: Dictionary) -> int: return int(run.fontSize)) == [18, 18, 18, 30, 18],
    "static/Spans inherit the default size of their paragraph and a span's own size applies to it alone")
  check(nodes["s-spans"].runs.map(func(run: Dictionary) -> int: return int(run.fontSize)) == [20, 20, 20, 20, 28, 20]
    and nodes["s-spans"].runs.map(func(run: Dictionary) -> int: return int(run.fontWeight)) == [400, 700, 700, 400, 400, 400],
    "static/Spans inherit the size of an explicit paragraph and the weight of the span they sit in")
  check(nodes["s-mono"].runs[0].fontFamily == "JetBrainsMono" and nodes["s-bold"].runs[0].fontWeight == 700
    and nodes["s-600"].runs[0].fontWeight == 600 and nodes["s-lh"].runs[0].lineHeight == 30
    and nodes["s-lh"].lineMetrics.all(func(row: Dictionary) -> bool: return is_equal_approx(float(row.height), 30.0))
    and nodes["s-color"].runs[0].color == "38bdf8ff",
    "static/fontFamily, fontWeight (bold and a number), lineHeight and color reach the runs the host paints")
  check(float(nodes["s-ls"].measuredWidth) > float(nodes["s-nols"].measuredWidth),
    "static/letterSpacing widens the paragraph")
  check(is_equal_approx(float(nodes["s-center"].lineMetrics[0].x), (200.0 - float(nodes["s-center"].lineMetrics[0].width)) / 2.0)
    and is_equal_approx(float(nodes["s-right"].lineMetrics[0].x), 200.0 - float(nodes["s-right"].lineMetrics[0].width)),
    "static/textAlign centers and right-aligns the line inside the paragraph")
  var accepted: Dictionary = nodes["s-accepted"]
  check(accepted.runs == base.runs and accepted.lineMetrics == base.lineMetrics and accepted.measuredWidth == base.measuredWidth
    and accepted.measuredHeight == base.measuredHeight,
    "static/allowFontScaling, maxFontSizeMultiplier, dynamicTypeRamp and suppressHighlighting change nothing the host paints")
  check(int(nodes["s-lines"].visibleLines) == 2 and int(nodes["s-lines"].ellipses) == 1 and int(nodes["s-clip"].visibleLines) == 1
    and int(nodes["s-clip"].ellipses) == 0, "static/numberOfLines keeps its lines and the default tail adds an ellipsis, clip adds none")
  var reported: Array = react().get("layouts", [])
  var outer := reported.filter(func(row: Dictionary) -> bool: return row.id == "s-layout")
  var spans := reported.filter(func(row: Dictionary) -> bool: return row.id.begins_with("s-span-"))
  check(outer.size() == 1 and outer[0].text == "The text layout still reaches JS through the original Text"
    and spans.size() == 1 and spans[0].id == "s-span-layout" and spans[0].text == "Outer inner",
    "static/onTextLayout reaches JS for the outer paragraph only and reports its nested text")

func attempt_case() -> void:
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
    var ok: bool = rejected.size() == before + 1 and message.contains(expected) and fallback
    # The preceding SDK rejects some of these with the very same words; those are not what it must fail.
    if kind in ["span-responder", "span-start", "selection-color", "detector", "break-strategy", "line-break-ios", "hyphenation", "text-prop", "font-size-prop"]:
      normative_check(ok, "negative/" + kind + "/The wrapper rejects it before any native layout: " + expected)
    else:
      check(ok, "negative/" + kind + "/The wrapper rejects it before any native layout: " + expected)
    failures.append({"kind": kind, "expected": expected, "message": message, "fallback": fallback})
    run_js("attempt(null)")
    await settle(4)
  check(app_errors().size() == before_errors, "negative/Rejected props reach no native layout and report no host error")
  check(view("A", "guard-fallback").is_empty(), "negative/The boundary recovers once the rejected prop is removed")
  stages["negative"] = {"failures": failures, "react": react()}

func bypass_case() -> void:
  var reports: Array = []
  var position := Vector2(820, 140)
  for entry: Array in BYPASS:
    var kind: String = entry[0]
    var expected: String = entry[1]
    var before := app_errors().size()
    mount_surface("F-" + kind, "TextOriginalBypass", position, Vector2(220, 100), {"kind": kind})
    position.y += 110
    await settle(14)
    var fresh: Array = app_errors().slice(before)
    var render: Array = react().get("renderErrors", []).filter(func(row: Dictionary) -> bool: return row.case == "bypass-" + kind)
    var drawn := not view("F-" + kind, "bypass").is_empty()
    var report := {"kind": kind, "expected": expected, "errors": fresh, "renderErrors": render, "mounted": drawn}
    reports.append(report)
    host_check(not fresh.is_empty() and fresh.all(func(error: String) -> bool: return error == expected) and render.is_empty() and drawn,
      "bypass/" + kind + "/A NativeText that skips the wrapper is refused by the host with: " + expected)
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
    push_error("FABRIC_ERROR: unknown text-original lane " + lane)
    quit(1)
    return
  root.size = Vector2i(1100, 760)
  application = ClassDB.instantiate("FabricApplication")
  application.name = "TextOriginalApplication"
  application.set("bundle_path", "res://build/text-original-%s.js" % ("previous-probe" if lane == "previous" else "probe"))
  root.add_child(application)
  mount_surface("P", "TextOriginalPress", Vector2.ZERO, SIZE)
  mount_surface("S", "TextOriginalStatic", Vector2(420, 0), Vector2(380, 760))
  mount_surface("A", "TextOriginalAttempt", Vector2(820, 0), Vector2(240, 120))
  await settle(16)
  mount_case()
  registry_case()
  await press_cases()
  static_case()
  await attempt_case()
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
  var report := {"scenario": "native-text-original", "lane": lane, "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages, "origin": [ORIGIN.x, ORIGIN.y],
    "expectedPreviousFailures": expected_previous, "expectedPreviousHostFailures": expected_host,
    "previousNegativeObserved": previous_negative, "previousHostNegativeObserved": previous_host_negative,
    "allCurrentAssertionsPassed": failed.is_empty(), "expectedErrors": stages.get("afterStop", {}).get("errors", []),
    "scope": {"actualNativeInput": true, "publicFacadeImports": true, "originalTextModules": lane != "previous", "productionBundle": true,
      "pressOnSpansImplemented": false, "accessibilityOfText": false, "hardwareCertified": false}}
  var file := FileAccess.open("res://build/text-original-report.json", FileAccess.WRITE)
  if not check(file != null, "report/The text original report can be saved"):
    quit(1)
    return
  file.store_string(JSON.stringify(report, "  ") + "\n")
  if lane == "previous":
    print("TEXT_ORIGINAL_PREVIOUS_NEGATIVE: " + str(failed.size()) if previous_negative else "TEXT_ORIGINAL_FAILED")
  elif lane == "previous-host":
    print("TEXT_ORIGINAL_PREVIOUS_HOST_NEGATIVE: " + str(failed.size()) if previous_host_negative else "TEXT_ORIGINAL_FAILED")
  elif lane == "sabotage":
    print("TEXT_ORIGINAL_SABOTAGE_REJECTED: " + str(failed.size()) if not failed.is_empty() else "TEXT_ORIGINAL_SABOTAGE_ACCEPTED")
  else:
    print("TEXT_ORIGINAL_PASSED: " + str(checks.size()) if failed.is_empty() else "TEXT_ORIGINAL_FAILED")
  quit(0 if (failed.is_empty() and lane != "sabotage") or previous_negative or previous_host_negative or (lane == "sabotage" and not failed.is_empty()) else 1)
