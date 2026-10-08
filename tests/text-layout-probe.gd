extends SceneTree

# The public Text's onTextLayout and Yoga baseline over the Godot platform TextLayoutManager.
# The fixture (tests/text-layout-fixture.jsx) records what JS receives; the host snapshot says
# what it measured and paints. The relations between the two are checked here, the numbers
# against the font tables by tests/text-layout-oracle.mjs.
const SENTINEL := "​"
const FIELDS := ["ascender", "capHeight", "descender", "height", "text", "width", "x", "xHeight", "y"]
const PARAGRAPH_FIELDS := ["testID", "fabricX", "fabricY", "fabricWidth", "fabricHeight", "lines", "visibleLines",
  "lineMetrics", "nativeText", "runs"]
const INLINE_ERROR := "Inline Controls are not implemented in Godot Text"
const REJECTIONS := [
  ["string", "onTextLayout must be a function"],
  ["object", "onTextLayout must be a function"],
  ["press", "does not implement onPress"],
  ["selectable", "does not implement selectable"],
  ["fit", "does not implement adjustsFontSizeToFit"],
]
var application: Node
var surfaces: Dictionary = {}
var checks: Array = []
var stages: Dictionary = {}
var allow_original_negative := false
var sabotage := false
var expected_original_failures: Array = []

func check(condition: bool, name: String, normative: bool = false) -> bool:
  checks.append({"name": name, "passed": condition})
  if normative:
    expected_original_failures.append(name)
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

func settle(count: int = 8) -> void:
  for index in range(count):
    await process_frame

# The condition is judged each frame; the number of frames never decides a check, it only bounds the wait.
func wait_until(condition: Callable, frames: int = 120) -> bool:
  for index in range(frames):
    if condition.call():
      return true
    await process_frame
  return condition.call()

func state() -> Dictionary:
  var value: Variant = JSON.parse_string(application.call("evaluate", "JSON.stringify(TextLayoutProbe.snapshot())"))
  return value if value is Dictionary else {}

func run_js(expression: String) -> void:
  application.call("evaluate", "TextLayoutProbe." + expression)

func status() -> Dictionary:
  var value: Variant = JSON.parse_string(application.call("snapshot"))
  return value if value is Dictionary else {}

func native(target: Object) -> Dictionary:
  var value: Variant = JSON.parse_string(target.call("snapshot"))
  return value if value is Dictionary else {}

func line_measurements() -> int:
  return int(status().get("textLineMeasurements", 0))

func text_measurements() -> int:
  return int(status().get("textMeasurements", 0))

func errors() -> Array:
  return status().get("errors", [])

func events_of(id: String) -> Array:
  return state().log.filter(func(row: Dictionary) -> bool: return row.id == id)

func paragraphs(name: String) -> Dictionary:
  var out := {}
  for entry: Dictionary in native(surfaces[name]).get("nodes", []):
    if entry.kind != "paragraph":
      continue
    var slim := {}
    for field: String in PARAGRAPH_FIELDS:
      if entry.has(field):
        slim[field] = entry[field]
    out[entry.testID] = slim
  return out

func node_exists(name: String, test_id: String) -> bool:
  for entry: Dictionary in native(surfaces[name]).get("nodes", []):
    if entry.testID == test_id:
      return true
  return false

func mount(name: String, component: String, position: Vector2, props: Dictionary = {}) -> void:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = name
  surface.position = position
  surface.size = Vector2(380, 900)
  surface.set("application_path", NodePath("../TextLayoutApplication"))
  surface.set("component_name", component)
  surface.set("initial_props", props)
  surfaces[name] = surface
  root.add_child(surface)

func finite_number(value: Variant) -> bool:
  return (value is float or value is int) and is_finite(float(value))

func nine_fields(lines: Array) -> bool:
  for line: Dictionary in lines:
    var keys: Array = line.keys()
    keys.sort()
    if keys != FIELDS or not (line.text is String):
      return false
    for key: String in FIELDS:
      if key != "text" and not finite_number(line[key]):
        return false
  return not lines.is_empty()

func joined(lines: Array) -> String:
  var text := ""
  for line: Dictionary in lines:
    text += line.text
  return text

func total_height(lines: Array) -> float:
  var sum := 0.0
  for line: Dictionary in lines:
    sum += float(line.height)
  return sum

# Each event line against the host's own line metrics for the same paragraph: the event is
# the host's snapshot read back through RN, so x, width and height are the same numbers and the
# baseline is the line's top plus the ascender.
func lines_match(lines: Array, metrics: Array) -> bool:
  if lines.size() != metrics.size():
    return false
  var top := 0.0
  for index in range(lines.size()):
    var line: Dictionary = lines[index]
    var row: Dictionary = metrics[index]
    var same: bool = absf(float(line.x) - float(row.x)) < 0.001 and absf(float(line.width) - float(row.width)) < 0.001 \
      and absf(float(line.height) - float(row.height)) < 0.001 and absf(float(line.y) - top) < 0.001 \
      and absf(float(line.y) + float(line.ascender) - float(row.baseline)) < 0.001 \
      and absf(float(line.ascender) + float(line.descender) - float(line.height)) < 0.001
    if not same:
      return false
    top += float(row.height)
  return true

func mount_stage() -> Dictionary:
  var expected_ids: Array = []
  for spec: Dictionary in state().specs:
    expected_ids.append(spec.id)
  expected_ids.append_array(["dynamic", "span-outer"])
  # Judged by what arrived, not by when: wait for the events, then give a late one frames to show up.
  await wait_until(func() -> bool: return state().log.size() >= expected_ids.size())
  await settle(12)
  var value := state()
  var ids: Array = value.log.map(func(row: Dictionary) -> String: return row.id)
  var sorted_ids := ids.duplicate()
  sorted_ids.sort()
  var sorted_expected := expected_ids.duplicate()
  sorted_expected.sort()
  check(sorted_ids == sorted_expected,
    "events/Every paragraph with onTextLayout receives exactly one event after its first layout", true)
  check(events_of("silent").is_empty() and events_of("span-inner").is_empty(),
    "events/A paragraph without the prop and a nested span with it receive nothing")
  var nodes := paragraphs("A")
  var drawn := true
  for id: String in expected_ids:
    drawn = drawn and nodes.has(id) and nodes[id].has("lineMetrics") and not nodes[id].lineMetrics.is_empty()
  check(drawn, "events/Every paragraph with a handler is mounted and painted with its line metrics")
  var sequences: Array = value.log.map(func(row: Dictionary) -> int: return int(row.sequence))
  var ordered := sequences.duplicate()
  ordered.sort()
  check(sequences == ordered, "events/Events reach JS in the order the host dispatched them")
  return {"react": value, "nodes": nodes, "expectedIds": expected_ids, "status": status()}

func agreement_stage(mounted: Dictionary) -> void:
  var value: Dictionary = mounted.react
  var nodes: Dictionary = mounted.nodes
  for spec: Dictionary in value.specs:
    var id: String = spec.id
    var rows := events_of(id)
    if rows.size() != 1:
      check(false, "payload/" + id + "/The paragraph receives one event")
      continue
    var lines: Array = rows[0].lines
    var node: Dictionary = nodes[id]
    check(rows[0].keys == ["lines", "target", "timeStamp"] and nine_fields(lines),
      "payload/" + id + "/The event is {lines} with RN's target and timeStamp, and each line has exactly the nine fields, all finite")
    check(lines.size() == int(node.visibleLines) and (int(spec.numberOfLines) == 0 or lines.size() == int(spec.numberOfLines)),
      "agreement/" + id + "/The number of lines is the number of visible lines")
    if int(spec.numberOfLines) == 0:
      check(joined(lines) == spec.text,
        "agreement/" + id + "/The line texts concatenate to the paragraph's text without the sentinel")
    else:
      check(not joined(lines).contains(SENTINEL),
        "agreement/" + id + "/A truncated paragraph's lines never carry the sentinel")
    check(absf(total_height(lines) - float(node.fabricHeight)) <= 1.0,
      "agreement/" + id + "/The heights add up to the node's height")
    check(lines_match(lines, node.lineMetrics),
      "agreement/" + id + "/Each line has the x, width, height and baseline of the host's own line metrics")
  var outer: Array = events_of("span-outer")
  check(outer.size() == 1 and joined(outer[0].lines) == "Outer before inner span and after",
    "agreement/span-outer/A composite paragraph reports its nested text as part of its lines")

func dynamic_step(label: String, patch: String, expect_event: bool, steps: Array) -> void:
  var before_events := events_of("dynamic").size()
  var before_total: int = state().log.size()
  var before_calls := line_measurements()
  var before_node: Dictionary = paragraphs("A")["dynamic"]
  run_js("dynamic(%s)" % patch)
  if expect_event:
    await wait_until(func() -> bool: return events_of("dynamic").size() > before_events)
  else:
    await settle(30)
  var after_events := events_of("dynamic")
  var node: Dictionary = paragraphs("A")["dynamic"]
  steps.append({"label": label, "patch": JSON.parse_string(patch), "eventsBefore": before_events, "eventsAfter": after_events.size(),
    "totalEventsBefore": before_total, "totalEventsAfter": state().log.size(),
    "lineMeasurementCalls": line_measurements() - before_calls, "before": before_node, "after": node,
    "lines": after_events.back().lines if not after_events.is_empty() else []})

func dedupe_stage() -> Dictionary:
  var steps: Array = []
  var first := events_of("dynamic")
  check(first.size() == 1, "dedupe/The first layout emits one event")
  await dynamic_step("color", '{"color":"#38bdf8"}', false, steps)
  var color_step: Dictionary = steps.back()
  check(color_step.eventsAfter == color_step.eventsBefore and color_step.after.runs[0].color != color_step.before.runs[0].color,
    "dedupe/A change of color alone repaints and emits no new event")
  await dynamic_step("sameLines", '{"width":161}', false, steps)
  var same_step: Dictionary = steps.back()
  check(same_step.eventsAfter == same_step.eventsBefore and same_step.after.fabricWidth != same_step.before.fabricWidth and same_step.lineMeasurementCalls > 0,
    "dedupe/A new width that wraps the same lines asks measureLines again and emits no new event")
  await dynamic_step("width", '{"width":110}', true, steps)
  var width_step: Dictionary = steps.back()
  check(width_step.eventsAfter == width_step.eventsBefore + 1 and lines_match(width_step.lines, width_step.after.lineMetrics),
    "dedupe/A narrower width emits one event with the new lines")
  await dynamic_step("text", '{"text":"Different words now fill this paragraph box"}', true, steps)
  var text_step: Dictionary = steps.back()
  check(text_step.eventsAfter == text_step.eventsBefore + 1 and joined(text_step.lines) == "Different words now fill this paragraph box",
    "dedupe/A new text emits one event with the new lines")
  await dynamic_step("numberOfLines", '{"numberOfLines":2}', true, steps)
  var limit_step: Dictionary = steps.back()
  check(limit_step.eventsAfter == limit_step.eventsBefore + 1 and limit_step.lines.size() == 2 and int(limit_step.after.visibleLines) == 2,
    "dedupe/A new numberOfLines emits one event with the visible lines")
  await dynamic_step("withoutHandler", '{"listen":false,"width":130}', false, steps)
  var silent_step: Dictionary = steps.back()
  check(silent_step.eventsAfter == silent_step.eventsBefore and silent_step.after.fabricWidth != silent_step.before.fabricWidth,
    "dedupe/Removing the prop stops the events while the layout still follows the width")
  return {"steps": steps}

func baseline_stage() -> Dictionary:
  var before := line_measurements()
  mount("B", "TextLayoutBaseline", Vector2(400, 0))
  await settle(14)
  var rows := paragraphs("B")
  var calls := line_measurements() - before
  var small: Dictionary = rows["baseline-small"]
  var large: Dictionary = rows["baseline-large"]
  var self_large: Dictionary = rows["self-large"]
  var self_small: Dictionary = rows["self-small"]
  var sans: Dictionary = rows["mixed-sans"]
  var mono: Dictionary = rows["mixed-mono"]
  check(float(small.fabricY) > float(large.fabricY) + 1.0,
    "baseline/In an alignItems baseline row the 14 px text sits below the top of the 28 px text", true)
  check(float(self_small.fabricY) > float(self_large.fabricY) + 1.0,
    "baseline/With alignSelf baseline the 12 px text sits below the top of the 24 px text", true)
  check(float(sans.fabricY) > float(mono.fabricY) + 1.0,
    "baseline/Across two fonts the baseline of a lineHeight 40 mono text pushes the 14 px sans text down", true)
  check(calls > 0, "baseline/Yoga's baseline callback reaches measureLines: no paragraph of this root has a handler", true)
  return {"nodes": rows, "lineMeasurementCalls": calls, "before": before}

func negative_stage() -> Dictionary:
  var failures: Array = []
  for index in range(REJECTIONS.size()):
    var kind: String = REJECTIONS[index][0]
    var expected: String = REJECTIONS[index][1]
    run_js("attempt('%s')" % kind)
    await wait_until(func() -> bool: return state().rejections.size() == index + 1, 60)
    var value := state()
    var message: String = value.rejections[index] if value.rejections.size() > index else ""
    check(value.rejections.size() == index + 1 and message.contains(expected) and node_exists("A", "guard-fallback"),
      "negative/The wrapper rejects " + kind + " before any native layout: " + expected)
    failures.append(message)
    run_js("attempt(null)")
    await settle(6)
  check(errors().is_empty(), "negative/Rejected props reach no native layout and report no host error")
  var value := state()
  check(value.rejections.size() == REJECTIONS.size() and not node_exists("A", "guard-fallback"),
    "negative/The boundary recovers once the rejected prop is removed")
  return {"messages": failures, "react": value}

func failure_variant(name: String, listen: bool, position: Vector2) -> Dictionary:
  var before_errors := errors().size()
  var before_measure := text_measurements()
  var before_lines := line_measurements()
  mount(name, "TextLayoutFailure", position, {"listen": listen})
  await settle(14)
  var reported := errors()
  var measure_calls := text_measurements() - before_measure
  var line_calls := line_measurements() - before_lines
  var new_errors: Array = reported.slice(before_errors)
  var report := {"listen": listen, "errors": new_errors, "measureCalls": measure_calls, "lineCalls": line_calls}
  check(not new_errors.is_empty() and new_errors.all(func(error: String) -> bool: return error == INLINE_ERROR),
    "failure/" + name + "/The failing paragraph reports the host error and nothing else")
  # Each failed measure and measureLines call reports; so does the paint preparation of the mount. Nothing else
  # in this root asks the host for text, so the calls are a floor for the reports.
  check(new_errors.size() >= measure_calls + line_calls and measure_calls > 0,
    "failure/" + name + "/Every failed measure and measureLines call reports its error and none unwinds through Yoga")
  if not allow_original_negative:
    check(line_calls > 0, "failure/" + name + "/The baseline callback of Yoga reached measureLines and survived the failure")
  report["rows"] = paragraphs(name)
  return report

func failure_stage() -> Dictionary:
  var without_handler := await failure_variant("F1", false, Vector2(800, 0))
  var with_handler := await failure_variant("F2", true, Vector2(800, 200))
  check(events_of("failure").is_empty(), "failure/A paragraph whose lines cannot be measured emits no onTextLayout")
  return {"baselineOnly": without_handler, "withHandler": with_handler}

func _initialize() -> void:
  allow_original_negative = OS.get_cmdline_user_args().has("--allow-original-negative")
  sabotage = OS.get_cmdline_user_args().has("--sabotage")
  call_deferred("run_probe")

func run_probe() -> void:
  root.size = Vector2i(1200, 900)
  application = ClassDB.instantiate("FabricApplication")
  application.name = "TextLayoutApplication"
  application.set("bundle_path", "res://build/text-layout-probe.js")
  root.add_child(application)
  mount("A", "TextLayoutProbe", Vector2(0, 0))
  var mounted := await mount_stage()
  stages.mount = mounted
  if not allow_original_negative:
    agreement_stage(mounted)
    stages.dedupe = await dedupe_stage()
  stages.baseline = await baseline_stage()
  stages.negative = await negative_stage()
  stages.failure = await failure_stage()
  stages.beforeStop = {"application": status(), "react": state()}
  application.call("stop")
  await settle()
  var stopped := status()
  check(stopped.stopped and int(stopped.rootCount) == 0 and int(stopped.pendingWork) == 0,
    "cleanup/Stop releases every root and pending work")
  for name: String in surfaces.keys():
    var final_root := native(surfaces[name])
    check(int(final_root.nativeTags) == 0 and int(final_root.creates) == int(final_root.deletes),
      "cleanup/" + name + "/All native Controls are balanced")
    stages["stoppedRoot" + name] = final_root
    surfaces[name].queue_free()
  application.queue_free()
  await settle()
  var failed: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var observed := failed.duplicate()
  var expected := expected_original_failures.duplicate()
  observed.sort()
  expected.sort()
  var original_negative_observed := allow_original_negative and observed == expected and not failed.is_empty()
  var report := {"scenario": "native-text-layout", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages, "afterStop": stopped,
    "expectedErrors": stopped.get("errors", []), "expectedOriginalFailures": expected_original_failures,
    "allowOriginalNegative": allow_original_negative, "originalNegativeObserved": original_negative_observed,
    "allCurrentAssertionsPassed": failed.is_empty(), "sabotage": sabotage,
    "scope": {"headless": true, "onTextLayout": true, "yogaBaseline": true, "fontTables": true,
      "measureLinesFailure": true, "paintedInkAgreement": false, "iosSimulatorReference": false}}
  var output := FileAccess.open("res://build/text-layout-report.json", FileAccess.WRITE)
  if not check(output != null, "report/The text layout report is saved"):
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  if original_negative_observed:
    print("TEXT_LAYOUT_ORIGINAL_NEGATIVE: " + str(failed.size()))
  elif sabotage and not failed.is_empty():
    print("TEXT_LAYOUT_SABOTAGE_REJECTED: " + str(failed.size()))
  elif failed.is_empty():
    print("TEXT_LAYOUT_PASSED: " + str(checks.size()))
  else:
    print("TEXT_LAYOUT_FAILED")
  quit(0 if failed.is_empty() or original_negative_observed or (sabotage and not failed.is_empty()) else 1)
