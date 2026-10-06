extends SceneTree

# RN's original TouchableWithoutFeedback, TouchableHighlight and TouchableOpacity
# on two real roots, driven by actual Godot mouse and touch input. JS records
# what the touchables report; native snapshots show what the Controls display.
# --lane current runs every case. --lane preceding-sdk and --lane sabotage run
# the same fixture on another SDK; --lane animated presses the public
# TouchableOpacity alone and follows its opacity through RN's native module.
const DEVICE := 1001
const SIZE := Vector2(400, 520)
const ORIGINS := {"A": Vector2.ZERO, "B": Vector2(420, 0)}
# Hosts each case must commit, and the backgrounds RN's style gives them.
const CASE_HOSTS := {"twf": ["twf"], "th": ["th", "th-child"], "long": ["long", "long-child"], "delayed": ["delayed", "delayed-child"],
  "slop": ["slop"], "disabled": ["disabled", "disabled-child"], "nested": ["outer", "inner"], "card": ["card", "card-button"],
  "removable": ["removable", "removable-child"], "toggle": ["toggle", "toggle-child"], "text": ["label", "label-child"], "caption": ["caption"],
  "opacity": ["opacity"]}
const BASE := {"twf": "334155ff", "th": "16a34aff", "th-child": "2563ebff", "long": "0f766eff", "long-child": "1d4ed8ff",
  "delayed": "334155ff", "delayed-child": "0891b2ff", "slop": "a16207ff", "disabled": "64748bff", "disabled-child": "94a3b8ff",
  "outer": "1e293bff", "inner": "be185dff", "card": "1e293bff", "card-button": "4d7c0fff", "removable": "475569ff",
  "removable-child": "7e22ceff", "toggle": "365314ff", "toggle-child": "b45309ff", "label": "0f766eff", "label-child": "00000000",
  "caption": "7c2d12ff", "opacity": "0e7490ff"}
# Underlay color and child activeOpacity while each TouchableHighlight is pressed.
const PRESSED := {"th": ["dc2626ff", 0.4], "long": ["7c3aedff", 0.85], "delayed": ["ea580cff", 0.6],
  "removable": ["f43f5eff", 0.5], "toggle": ["22d3eeff", 0.85], "label": ["1d4ed8ff", 0.6]}
const CHILDREN_ONLY := "React.Children.only expected to receive a single React element child."
const INLINE := "Inline Controls are not implemented in Godot Text"
const STYLE := "Godot TouchableHighlight does not implement style shadowColor"
var lane := "current"
var application: Node
var surfaces: Dictionary = {}
var checks: Array = []
var stages: Dictionary = {}
var geometry: Dictionary = {}
var normative: Array = []

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

# A check the preceding SDK, whose touchables throw at render, must fail.
func normative_check(condition: bool, name: String) -> bool:
  normative.append(name)
  return check(condition, name)

func settle(count: int = 8) -> void:
  for index in range(count):
    await process_frame

func wait_since(start: int, elapsed: int) -> void:
  while Time.get_ticks_msec() - start < elapsed:
    await process_frame

# The native driver's frames come at the host's frame-clock ticks, which are its pacing and not a
# number of Godot frames: wait for what the animation does.
func wait_until(condition: Callable, limit_ms: int = 5000) -> bool:
  var deadline := Time.get_ticks_msec() + limit_ms
  while Time.get_ticks_msec() < deadline and not condition.call():
    await process_frame
  return condition.call()

func native(owner: Node) -> Dictionary:
  var value: Variant = JSON.parse_string(owner.call("snapshot"))
  return value if value is Dictionary else {}

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(TouchablesProbe." + expression + ")"))

func take() -> Array:
  var value: Variant = js("take()")
  return value if value is Array else []

func view(root_name: String, id: String) -> Dictionary:
  for entry: Dictionary in native(surfaces[root_name]).get("nodes", []):
    if entry.testID == root_name + "-" + id:
      return entry
  return {}

func background(entry: Dictionary) -> String:
  var appearance: Variant = entry.get("appearance")
  return str(appearance.background) if appearance is Dictionary else ""

func tag(root_name: String, id: String) -> int:
  var entry := view(root_name, id)
  return int(entry.tag) if not entry.is_empty() else -1

func rect(root_name: String, id: String) -> Rect2:
  var control: Control = surfaces[root_name].find_child(root_name + "-" + id, true, false)
  # A missing host yields a point outside every surface, never a script error.
  return control.get_global_rect() if control != null else Rect2(-1000, -1000, 0, 0)

func center(root_name: String, id: String) -> Vector2:
  return rect(root_name, id).get_center()

# What a TouchableHighlight displays: its own background and its child's opacity.
func look(root_name: String, id: String) -> Dictionary:
  return {"background": background(view(root_name, id)), "childOpacity": view(root_name, id + "-child").get("opacity", -1.0)}

func pressed_look(root_name: String, id: String) -> bool:
  var value := look(root_name, id)
  return value.background == PRESSED[id][0] and is_equal_approx(float(value.childOpacity), PRESSED[id][1])

func resting_look(root_name: String, id: String) -> bool:
  var value := look(root_name, id)
  return value.background == BASE[id] and is_equal_approx(float(value.childOpacity), 1.0)

func pointer(root_name: String) -> Dictionary:
  return native(surfaces[root_name]).get("pointer", {})

func released(root_name: String) -> bool:
  var value := pointer(root_name)
  return int(value.get("responder", -1)) == 0 and int(value.get("activeTouches", -1)) == 0

# One actual Godot input sample. Mouse downs first move the button-less pointer
# there, as a real mouse does; touch uses the given contact index.
func send(device: String, phase: String, at: Vector2, index: int = 0) -> void:
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
    drag.index = index
    drag.position = at
    Input.parse_input_event(drag)
  else:
    var contact := InputEventScreenTouch.new()
    contact.device = DEVICE
    contact.index = index
    contact.position = at
    contact.pressed = phase == "down"
    Input.parse_input_event(contact)

# Sends one sample, lets JS and Fabric settle and stores what both sides saw.
func step(stage: String, root_name: String, device: String, phase: String, at: Vector2, index: int = 0) -> Array:
  send(device, phase, at, index)
  await settle()
  var events := take()
  stages[stage] = {"root": root_name, "device": device, "phase": phase, "global": [at.x, at.y],
    "page": [at.x - ORIGINS[root_name].x, at.y - ORIGINS[root_name].y], "events": events, "pointer": pointer(root_name)}
  return events

# A row another step produced; empty when that step reported fewer rows.
func item(rows: Array, index: int) -> Dictionary:
  return rows[index] if index < rows.size() else {}

func kinds(events: Array) -> Array:
  return events.map(func(row: Dictionary) -> String: return row.id + ":" + row.type)

# RN's responder payload: the original hit host as target, the responder as
# currentTarget, root-relative page coordinates and target-local location.
func payload(entry: Dictionary, registration: String, root_name: String, target: String, current: String, at: Vector2, touches: int) -> bool:
  if entry.is_empty():
    return false
  var page: Vector2 = at - ORIGINS[root_name]
  var origin: Vector2 = rect(root_name, target).position - ORIGINS[root_name]
  return (entry.root == root_name and entry.registration == registration and int(entry.target) == tag(root_name, target)
    and (entry.currentTarget == null if current.is_empty() else int(entry.currentTarget) == tag(root_name, current))
    and is_equal_approx(float(entry.pageX), page.x) and is_equal_approx(float(entry.pageY), page.y)
    and is_equal_approx(float(entry.locationX), page.x - origin.x) and is_equal_approx(float(entry.locationY), page.y - origin.y)
    and int(entry.touches) == touches and int(entry.changedTouches) == 1 and float(entry.timestamp) > 0.0)

func same_payload(left: Dictionary, right: Dictionary) -> bool:
  return not left.is_empty() and not right.is_empty() and left.payloadId != null and int(left.payloadId) == int(right.payloadId)

func same_contact(rows: Array) -> bool:
  var touched := rows.filter(func(entry: Dictionary) -> bool: return entry.identifier != null)
  return not touched.is_empty() and touched.all(func(entry: Dictionary) -> bool: return int(entry.identifier) == int(touched[0].identifier))

func record_geometry() -> void:
  for root_name: String in surfaces:
    var hosts := {}
    for ids: Array in CASE_HOSTS.values():
      for id: String in ids:
        var bounds := rect(root_name, id)
        hosts[id] = {"tag": tag(root_name, id), "page": [bounds.position.x - ORIGINS[root_name].x, bounds.position.y - ORIGINS[root_name].y, bounds.size.x, bounds.size.y],
          "background": background(view(root_name, id)), "opacity": view(root_name, id).get("opacity", -1.0)}
    geometry[root_name] = {"origin": [ORIGINS[root_name].x, ORIGINS[root_name].y], "hosts": hosts}

func mount_surface(root_name: String, component: String) -> void:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = root_name
  surface.position = ORIGINS[root_name]
  surface.size = SIZE
  surface.set("application_path", NodePath("../TouchablesApplication"))
  surface.set("component_name", component)
  surface.set("initial_props", {"name": root_name})
  surface.set_meta("validation_input_device", DEVICE)
  surfaces[root_name] = surface
  root.add_child(surface)

func mount_case() -> void:
  var app := native(application)
  check(int(app.get("rootCount", 0)) == 2 and native(surfaces.A).runtimeId == native(surfaces.B).runtimeId and native(surfaces.A).surfaceId != native(surfaces.B).surfaceId
    and js("mounts()") == {"A": 1.0, "B": 1.0}, "mount/Two roots share one Hermes runtime and mount the fixture once each")
  var errors: Array = js("renderErrors()")
  stages["mount"] = {"renderErrors": errors, "application": app}
  record_geometry()
  for name: String in CASE_HOSTS:
    var hosts_ok := true
    for root_name: String in ["A", "B"]:
      for id: String in CASE_HOSTS[name]:
        var entry := view(root_name, id)
        hosts_ok = hosts_ok and not entry.is_empty() and background(entry) == BASE[id] and is_equal_approx(float(entry.opacity), 1.0)
    var failed := errors.filter(func(entry: Dictionary) -> bool: return entry.case == name)
    normative_check(hosts_ok and failed.is_empty(), "mount/" + name + "/The original touchable commits its hosts at rest in both roots without a render error")
  var refs: Dictionary = js("refs()")
  stages["mount"].refs = refs
  normative_check(["A", "B"].all(func(root_name: String) -> bool: return refs.get(root_name + "-th") is float and int(refs[root_name + "-th"]) == tag(root_name, "th")),
    "mount/th-ref/A ref on TouchableHighlight reaches its native host in both roots")
  var failing := {"single-two": [CHILDREN_ONLY, "TouchableHighlight with two children fails at render with React.Children.only"],
    "single-none": [CHILDREN_ONLY, "TouchableWithoutFeedback without a child fails at render with React.Children.only"],
    "inline": [INLINE, "TouchableHighlight inside Text fails at render as an inline Control"],
    "style": [STYLE, "TouchableHighlight rejects a style its native View does not implement"]}
  for name: String in failing:
    var messages: Array = errors.filter(func(entry: Dictionary) -> bool: return entry.case == name).map(func(entry: Dictionary) -> String: return entry.root + ":" + entry.message)
    normative_check(messages == ["A:" + failing[name][0], "B:" + failing[name][0]], "mount/" + name + "/" + failing[name][1])
  var unexpected := errors.filter(func(entry: Dictionary) -> bool: return not entry.case in failing)
  normative_check(unexpected.is_empty() and errors.size() == 2 * failing.size(), "mount/render-errors/Only the single-child and contract cases fail at render")

# The SDK Pressable is the same in every lane; it proves the harness presses.
func sentinel_case() -> void:
  var at := center("A", "sentinel")
  await step("sentinel/down", "A", "mouse", "down", at)
  var start := Time.get_ticks_msec()
  send("mouse", "up", at)
  # Pressable's default minimum press duration may defer onPressOut by 130 ms.
  await wait_since(start, 260)
  var events := take()
  stages["sentinel/up"] = {"events": events}
  var all: Array = stages["sentinel/down"].events + events
  check(all.filter(func(entry: Dictionary) -> bool: return entry.id == "sentinel" and entry.type == "press").size() == 1
    and all.all(func(entry: Dictionary) -> bool: return entry.root == "A" and entry.id == "sentinel") and released("A"),
    "sentinel/The SDK Pressable sentinel presses once and releases the responder")

# A TouchableWithoutFeedback gesture: its cloned child is target and responder.
func without_feedback_case(prefix: String, id: String, device: String) -> void:
  var at := center("A", id)
  var down := await step(prefix + "/down", "A", device, "down", at)
  check(kinds(down) == [id + ":in"] and payload(down[0], "onResponderGrant", "A", id, id, at, 1)
    and int(pointer("A").get("responder", -1)) == tag("A", id),
    prefix + "/Press in fires once on grant with the child as target and responder")
  var up := await step(prefix + "/up", "A", device, "up", at)
  check(kinds(up) == [id + ":out", id + ":press"] and payload(up[0], "onResponderRelease", "A", id, id, at, 0)
    and payload(up[1], "onResponderRelease", "A", id, id, at, 0) and same_payload(up[0], up[1]) and same_contact(down + up),
    prefix + "/Release reports press out before press, both with the release payload")
  check(released("A"), prefix + "/Release clears the native responder and contacts")

# Samples the host every frame after release until RN's zero-delay hide ran.
func highlight_release(prefix: String, root_name: String, id: String, device: String, at: Vector2) -> Array:
  send(device, "up", at)
  var samples: Array = []
  for index in range(12):
    await process_frame
    samples.append(look(root_name, id))
  var events := take()
  stages[prefix + "/up"] = {"root": root_name, "device": device, "events": events, "samples": samples, "pointer": pointer(root_name),
    "page": [at.x - ORIGINS[root_name].x, at.y - ORIGINS[root_name].y]}
  return events

# A TouchableHighlight gesture on its child, sampling the native look.
func highlight_case(prefix: String, root_name: String, id: String, device: String) -> void:
  var at := center(root_name, id + "-child")
  var down := await step(prefix + "/down", root_name, device, "down", at)
  stages[prefix + "/down"].look = look(root_name, id)
  check(kinds(down) == [id + ":show", id + ":in"] and payload(down[1], "onResponderGrant", root_name, id + "-child", id, at, 1),
    prefix + "/Press in shows the underlay, then reports onPressIn for the child target")
  check(pressed_look(root_name, id), prefix + "/The pressed host shows underlayColor and its child takes activeOpacity")
  var other := "B" if root_name == "A" else "A"
  check(resting_look(other, id) and PRESSED.keys().all(func(key: String) -> bool: return key == id or resting_look(root_name, key)),
    prefix + "/Only the pressed TouchableHighlight changes its native appearance, in its own root")
  var up := await highlight_release(prefix, root_name, id, device, at)
  check(kinds(up) == [id + ":hide", id + ":out", id + ":show", id + ":press", id + ":hide"]
    and payload(up[1], "onResponderRelease", root_name, id + "-child", id, at, 0) and same_payload(up[1], up[3])
    and payload(up[3], "onResponderRelease", root_name, id + "-child", id, at, 0) and same_contact(down + up)
    and up.all(func(entry: Dictionary) -> bool: return entry.root == root_name),
    prefix + "/Release hides, reports press out, shows again for press and hides after the zero-delay timer")
  var samples: Array = stages[prefix + "/up"].samples
  var pressed: Array = PRESSED[id]
  check(resting_look(root_name, id) and samples.all(func(value: Dictionary) -> bool:
      return (value.background in [pressed[0], BASE[id]]
        and (value.background == pressed[0]) == is_equal_approx(float(value.childOpacity), pressed[1]))),
    prefix + "/Every frame after release shows the pressed or the resting look, ending at rest")
  check(released(root_name) and resting_look(other, id), prefix + "/Release clears the responder and leaves the other root untouched")

func delayed_case() -> void:
  var prefix := "delayed/mouse"
  var at := center("A", "delayed-child")
  var down := await step(prefix + "/down", "A", "mouse", "down", at)
  check(kinds(down) == ["delayed:show", "delayed:in"] and pressed_look("A", "delayed"), prefix + "/Press in shows the underlay")
  send("mouse", "up", at)
  var released_at := Time.get_ticks_msec()
  # The hide timer starts after this send, so every frame within 150 ms of it
  # must still show the pressed look, however slowly frames arrive.
  var samples: Array = []
  while Time.get_ticks_msec() - released_at < 420:
    await process_frame
    samples.append({"elapsed": Time.get_ticks_msec() - released_at, "look": look("A", "delayed")})
  var events := take()
  stages[prefix + "/up"] = {"root": "A", "page": [at.x, at.y], "events": events, "samples": samples, "pointer": pointer("A")}
  var inside := samples.filter(func(sample: Dictionary) -> bool: return int(sample.elapsed) < 150)
  check(kinds(events) == ["delayed:show", "delayed:press", "delayed:out", "delayed:hide"]
    and payload(events[1], "onResponderRelease", "A", "delayed-child", "delayed", at, 0),
    prefix + "/Release reports press at once, then press out and the hide after delayPressOut")
  check(not inside.is_empty() and inside.all(func(sample: Dictionary) -> bool:
      return sample.look.background == PRESSED.delayed[0] and is_equal_approx(float(sample.look.childOpacity), PRESSED.delayed[1])),
    prefix + "/Every frame within 150 ms of release keeps the underlay and child opacity")
  check(events.size() == 4 and events[2].registration == "onResponderRelease" and events[2].currentTarget == null
    and same_payload(events[2], events[1]) and float(events[2].at) - float(events[1].at) >= 159.0,
    prefix + "/delayPressOut defers press out with the persisted release event")
  check(resting_look("A", "delayed") and released("A"), prefix + "/The host returns to rest")

func long_case() -> void:
  var prefix := "long/touch"
  var at := center("A", "long-child")
  var down := await step(prefix + "/down", "A", "touch", "down", at)
  check(kinds(down) == ["long:show", "long:in"] and payload(down[1], "onResponderGrant", "A", "long-child", "long", at, 1),
    prefix + "/Press in shows the underlay")
  await wait_since(Time.get_ticks_msec(), 420)
  var held := take()
  stages[prefix + "/hold"] = {"root": "A", "events": held, "look": look("A", "long")}
  check(kinds(held) == ["long:long"] and float(held[0].at) - float(item(down, 1).get("at", INF)) >= 249.0,
    prefix + "/onLongPress waits for delayLongPress")
  check(held.size() == 1 and held[0].registration == "onResponderGrant" and held[0].currentTarget == null and same_payload(held[0], item(down, 1)),
    prefix + "/onLongPress receives the persisted grant event")
  check(pressed_look("A", "long"), prefix + "/The underlay stays while the long press is held")
  var up := await step(prefix + "/up", "A", "touch", "up", at)
  check(kinds(up) == ["long:hide", "long:out"] and payload(up[1], "onResponderRelease", "A", "long-child", "long", at, 0),
    prefix + "/Release after a long press reports press out without press")
  check(resting_look("A", "long") and released("A"), prefix + "/The host returns to rest")
  # Moving more than RN's 10 px deactivation distance cancels only the timer.
  # The move follows the down by two frames, well inside delayLongPress.
  prefix = "long/moved"
  var moved := at + Vector2(15, 0)
  send("mouse", "down", at)
  var pressed_at := Time.get_ticks_msec()
  await settle(2)
  send("mouse", "move", moved)
  var move_after := Time.get_ticks_msec() - pressed_at
  await wait_since(pressed_at, 480)
  var moved_rows := take()
  stages[prefix + "/hold"] = {"root": "A", "events": moved_rows, "page": [at.x, at.y], "movePage": [moved.x, moved.y], "moveAfterMs": move_after}
  var up_moved := await step(prefix + "/up", "A", "mouse", "up", moved)
  check(move_after < 200 and kinds(moved_rows) == ["long:show", "long:in"] and payload(moved_rows[1], "onResponderGrant", "A", "long-child", "long", at, 1)
    and kinds(up_moved) == ["long:hide", "long:out", "long:show", "long:press", "long:hide"] and resting_look("A", "long") and released("A"),
    prefix + "/Moving 15 px inside the host cancels the long press but keeps the press")

# hitSlop {8, 12, 8, 12} and pressRetentionOffset {10, 14, 10, 14} around an
# 80x32 View: Pressability keeps a press in (rect + slop + offset), strictly.
func slop_case() -> void:
  var bounds := rect("A", "slop")
  var mid := bounds.get_center()
  var inside_slop := Vector2(bounds.position.x - 8, mid.y)
  var down := await step("slop/hit-slop/down", "A", "mouse", "down", inside_slop)
  var up := await step("slop/hit-slop/up", "A", "mouse", "up", inside_slop)
  check(kinds(down) == ["slop:in"] and payload(down[0], "onResponderGrant", "A", "slop", "slop", inside_slop, 1)
    and kinds(up) == ["slop:out", "slop:press"] and same_payload(up[0], up[1]),
    "slop/hit-slop/A press 8 px outside the left edge hits the View through its hitSlop")
  var outside := Vector2(bounds.position.x - 16, mid.y)
  var missed := await step("slop/outside/down", "A", "mouse", "down", outside)
  var missed_pointer := pointer("A")
  missed += await step("slop/outside/up", "A", "mouse", "up", outside)
  check(missed.is_empty() and int(missed_pointer.get("responder", -1)) == 0, "slop/outside/A press 16 px outside the left edge misses the hitSlop")
  var far := Vector2(bounds.end.x + 12 + 14 + 3, mid.y)
  var near := Vector2(bounds.end.x + 12 + 14 - 3, mid.y)
  var start := await step("slop/retention/down", "A", "mouse", "down", mid)
  var left_region := await step("slop/retention/far", "A", "mouse", "move", far)
  var still := int(pointer("A").get("responder", -1)) == tag("A", "slop")
  var back := await step("slop/retention/near", "A", "mouse", "move", near)
  var ended := await step("slop/retention/up", "A", "mouse", "up", near)
  check(kinds(start) == ["slop:in"] and kinds(left_region) == ["slop:out"] and payload(left_region[0], "onResponderMove", "A", "slop", "slop", far, 1) and still,
    "slop/retention/Moving 3 px beyond the retention offset deactivates while keeping the responder")
  check(kinds(back) == ["slop:in"] and payload(back[0], "onResponderMove", "A", "slop", "slop", near, 1),
    "slop/retention/Moving back 3 px inside the retention offset reactivates the press")
  check(kinds(ended) == ["slop:out", "slop:press"] and payload(ended[1], "onResponderRelease", "A", "slop", "slop", near, 0) and same_contact(start + left_region + back + ended),
    "slop/retention/Release inside the retention region presses although it is outside the View")
  var again := await step("slop/release-outside/down", "A", "mouse", "down", mid)
  again += await step("slop/release-outside/far", "A", "mouse", "move", far)
  var outside_up := await step("slop/release-outside/up", "A", "mouse", "up", far)
  check(kinds(again) == ["slop:in", "slop:out"] and outside_up.is_empty() and released("A"),
    "slop/release-outside/Release beyond the retention region never presses")
  # The vertical bounds with an actual touch drag: bottom + 8 + 10.
  var low := Vector2(mid.x, bounds.end.y + 8 + 10 + 3)
  var high := Vector2(mid.x, bounds.end.y + 8 + 10 - 3)
  var vertical := await step("slop/touch/down", "A", "touch", "down", mid)
  vertical += await step("slop/touch/far", "A", "touch", "move", low)
  vertical += await step("slop/touch/near", "A", "touch", "move", high)
  vertical += await step("slop/touch/up", "A", "touch", "up", high)
  check(kinds(vertical) == ["slop:in", "slop:out", "slop:in", "slop:out", "slop:press"] and payload(vertical[1], "onResponderMove", "A", "slop", "slop", low, 1)
    and payload(vertical[2], "onResponderMove", "A", "slop", "slop", high, 1) and same_contact(vertical) and released("A"),
    "slop/touch/A touch drag leaves and re-enters through the bottom retention bound")

func disabled_case() -> void:
  var at := center("A", "disabled-child")
  var down := await step("disabled/down", "A", "mouse", "down", at)
  var held := pointer("A")
  var look_held := look("A", "disabled")
  var up := await step("disabled/up", "A", "mouse", "up", at)
  stages["disabled/down"].look = look_held
  check(down.is_empty() and up.is_empty() and int(held.get("responder", -1)) == 0 and look_held.background == BASE.disabled
    and is_equal_approx(float(look_held.childOpacity), 1.0), "disabled/A disabled TouchableHighlight never claims the responder or shows its underlay")

func card_case() -> void:
  var at := center("A", "card-button")
  var down := await step("card/down", "A", "mouse", "down", at)
  var held := {"background": background(view("A", "card")), "buttonOpacity": view("A", "card-button").get("opacity", -1.0)}
  stages["card/down"].look = held
  check(kinds(down) == ["card:show", "card:in"] and payload(down[1], "onResponderGrant", "A", "card-button", "card", at, 1),
    "card/A disabled inner touchable lets the enclosing TouchableHighlight claim the press")
  # The Highlight styles its direct child, a TouchableWithoutFeedback, which
  # never forwards style: the inner View keeps its opacity, as in RN.
  check(held.background == "0ea5e9ff" and is_equal_approx(float(held.buttonOpacity), 1.0),
    "card/The enclosing host shows its underlay while the inner View keeps its opacity")
  var up := await step("card/up", "A", "mouse", "up", at)
  check(kinds(up) == ["card:hide", "card:out", "card:show", "card:press", "card:hide"] and background(view("A", "card")) == "1e293bff" and released("A"),
    "card/Release presses only the enclosing touchable and restores it")

func nested_case(device: String) -> void:
  var prefix := "nested/" + device
  var at := center("A", "inner")
  var down := await step(prefix + "/down", "A", device, "down", at)
  var outer_held := background(view("A", "outer"))
  stages[prefix + "/down"].outer = outer_held
  var up := await step(prefix + "/up", "A", device, "up", at)
  check(kinds(down) == ["inner:in"] and payload(down[0], "onResponderGrant", "A", "inner", "inner", at, 1)
    and kinds(up) == ["inner:out", "inner:press"] and same_payload(up[0], up[1]),
    prefix + "/The inner touchable becomes the responder and alone reports its press")
  check(outer_held == "1e293bff" and background(view("A", "outer")) == "1e293bff" and released("A"),
    prefix + "/The outer TouchableHighlight is never pressed and never shows its underlay")

# RN reads disabled when it grants the responder; a press already granted
# completes on release.
func toggle_case() -> void:
  var at := center("A", "toggle-child")
  var down := await step("toggle/down", "A", "mouse", "down", at)
  js("act('A','toggleDisabled',true)")
  await settle()
  var after_toggle := take()
  var held := pointer("A")
  var up := await step("toggle/up", "A", "mouse", "up", at)
  stages["toggle/disable"] = {"events": after_toggle, "pointer": held}
  check(kinds(down) == ["toggle:show", "toggle:in"] and after_toggle.is_empty() and int(held.get("responder", -1)) == tag("A", "toggle")
    and kinds(up) == ["toggle:hide", "toggle:out", "toggle:show", "toggle:press", "toggle:hide"],
    "toggle/Disabling mid-press keeps RN's granted press, which completes on release")
  var second := await step("toggle/disabled-down", "A", "mouse", "down", at)
  second += await step("toggle/disabled-up", "A", "mouse", "up", at)
  check(second.is_empty() and resting_look("A", "toggle") and released("A"), "toggle/Once disabled, a new press is not granted")
  js("act('A','toggleDisabled',false)")
  await settle()

func removable_case() -> void:
  var at := center("A", "removable-child")
  var down := await step("removable/down", "A", "touch", "down", at)
  check(kinds(down) == ["removable:show", "removable:in"] and pressed_look("A", "removable"), "removable/Press in shows the underlay")
  var start := Time.get_ticks_msec()
  var before := pointer("A")
  js("act('A','present',false)")
  await settle()
  var removed := take()
  var after := pointer("A")
  stages["removable/remove"] = {"events": removed, "before": before, "after": after, "present": not view("A", "removable").is_empty()}
  check(view("A", "removable").is_empty() and removed.is_empty() and int(after.responder) == 0 and int(after.activeTouches) == 0
    and int(after.cancels) == int(before.cancels) + 1, "removable/Removing the pressed touchable cancels its contact and releases the responder")
  await wait_since(start, 480)
  var late := take()
  var up := await step("removable/up", "A", "touch", "up", at)
  stages["removable/late"] = {"events": late}
  check(late.is_empty() and up.is_empty(), "removable/No callback or long press fires after removal, even on release")
  js("act('A','present',true)")
  await settle()
  check(resting_look("A", "removable"), "removable/The remounted touchable starts at rest")
  var again := await step("removable/again-down", "A", "mouse", "down", center("A", "removable-child"))
  var pressed_again := pressed_look("A", "removable")
  var again_up := await step("removable/again-up", "A", "mouse", "up", center("A", "removable-child"))
  check(kinds(again) == ["removable:show", "removable:in"] and pressed_again
    and kinds(again_up) == ["removable:hide", "removable:out", "removable:show", "removable:press", "removable:hide"]
    and resting_look("A", "removable") and released("A"), "removable/The remounted touchable presses normally")

# Root B: its own coordinates, callbacks and native host; A observes nothing.
func roots_case() -> void:
  await highlight_case("th/B/touch", "B", "th", "touch")
  var at := center("B", "twf")
  var down := await step("roots/twf/down", "B", "mouse", "down", at)
  var up := await step("roots/twf/up", "B", "mouse", "up", at)
  check(kinds(down) == ["twf:in"] and payload(down[0], "onResponderGrant", "B", "twf", "twf", at, 1)
    and kinds(up) == ["twf:out", "twf:press"] and payload(up[1], "onResponderRelease", "B", "twf", "twf", at, 0)
    and (down + up).all(func(entry: Dictionary) -> bool: return entry.root == "B") and released("B") and released("A"),
    "roots/B's TouchableWithoutFeedback reports B-relative coordinates and only B's callbacks")

func stop_case() -> void:
  stages["beforeStop"] = {"application": native(application)}
  application.call("stop")
  await settle()
  var stopped := native(application)
  stages["afterStop"] = stopped
  var errors: Array = stopped.get("errors", [])
  check(stopped.stopped and int(stopped.rootCount) == 0 and int(stopped.pendingTimers) == 0 and int(stopped.pendingAnimationFrames) == 0
    and errors.is_empty(), "stop/Stop retires every root without timers or runtime errors")
  for root_name: String in surfaces:
    var final_root := native(surfaces[root_name])
    check(int(final_root.nativeTags) == 0 and int(final_root.creates) == int(final_root.deletes), "stop/Root " + root_name + " balances its native Controls")

# The public TouchableOpacity renders RN's Animated.View: Pressability animates its
# opacity with the native driver, which RN's C++ NativeAnimatedModule runs on
# the frame clock's ticks. A real press dims the host and release restores it.
func animated_case() -> void:
  await settle(12)
  var app := native(application)
  var errors: Array = js("renderErrors()")
  var rest := view("A", "opacity")
  var animated: Dictionary = app.get("nativeAnimated", {})
  stages["animated"] = {"application": app, "renderErrors": errors, "rest": rest, "root": native(surfaces.A)}
  check(errors.is_empty() and not rest.is_empty() and is_equal_approx(float(rest.opacity), 1.0) and animated.get("enabled") == true
    and view("A", "sibling").get("testID", "") == "A-sibling",
    "animated/RN's TouchableOpacity commits its Animated.View host over RN's native module without a render error")
  var at := center("A", "opacity")
  send("mouse", "down", at)
  # The press has dimmed the host and the backend has gone idle: the release starts a second run.
  await wait_until(func() -> bool: return (is_equal_approx(float(view("A", "opacity").get("opacity", -1.0)), 0.5)
    and native(application).get("nativeAnimated", {}).get("active") == false))
  var pressed := view("A", "opacity")
  var held: Dictionary = native(application).get("nativeAnimated", {})
  stages["animated"].pressed = pressed
  stages["animated"].held = held
  check(is_equal_approx(float(pressed.get("opacity", -1.0)), 0.5) and int(held.get("directUpdates", 0)) > 0,
    "animated/A real press dims the host to activeOpacity through the native driver")
  send("mouse", "up", at)
  await wait_until(func() -> bool:
    var backend: Dictionary = native(application).get("nativeAnimated", {})
    return (is_equal_approx(float(view("A", "opacity").get("opacity", -1.0)), 1.0) and backend.get("active") == false
      and int(backend.get("resumes", 0)) == 2))
  await settle(2)
  var released := view("A", "opacity")
  var events: Array = take()
  var finished: Dictionary = native(application).get("nativeAnimated", {})
  stages["animated"].released = released
  stages["animated"].events = events
  stages["animated"].finished = finished
  check((is_equal_approx(float(released.get("opacity", -1.0)), 1.0) and int(finished.get("resumes", 0)) == 2
    and finished.get("active") == false and int(finished.get("staleDirectUpdates", -1)) == 0
    and events.map(func(row: Dictionary) -> String: return row.type) == ["in", "out", "press"]),
    "animated/Release restores the opacity, onPress fires once and the backend idles after two runs")
  var app_errors: Array = native(application).get("errors", [])
  check(app_errors.is_empty(), "animated/The root runs without a runtime error")
  await stop_case()

func _initialize() -> void:
  var args := OS.get_cmdline_user_args()
  var index := args.find("--lane")
  if index >= 0 and index + 1 < args.size():
    lane = args[index + 1]
  call_deferred("run")

func run() -> void:
  if not lane in ["current", "preceding-sdk", "sabotage", "animated"]:
    push_error("FABRIC_ERROR: unknown touchables lane " + lane)
    quit(1)
    return
  root.size = Vector2i(840, 520)
  application = ClassDB.instantiate("FabricApplication")
  application.name = "TouchablesApplication"
  application.set("bundle_path", "res://build/touchables-" + lane + ".js")
  root.add_child(application)
  if lane == "animated":
    mount_surface("A", "TouchablesAnimatedProbe")
    await animated_case()
  else:
    mount_surface("A", "TouchablesProbe")
    mount_surface("B", "TouchablesProbe")
    await settle(12)
    mount_case()
    await sentinel_case()
    if lane != "preceding-sdk":
      await without_feedback_case("twf/mouse", "twf", "mouse")
      await without_feedback_case("twf/touch", "twf", "touch")
      await highlight_case("th/A/mouse", "A", "th", "mouse")
      await highlight_case("th/A/touch", "A", "th", "touch")
      await highlight_case("text/label/mouse", "A", "label", "mouse")
      await without_feedback_case("text/caption/touch", "caption", "touch")
      await delayed_case()
      await long_case()
      await slop_case()
      await disabled_case()
      await card_case()
      await nested_case("mouse")
      await nested_case("touch")
      await toggle_case()
      await removable_case()
      await roots_case()
    await stop_case()
  for surface: Node in surfaces.values():
    surface.queue_free()
  application.queue_free()
  await settle()
  var failed: Array = checks.filter(func(entry: Dictionary) -> bool: return not entry.passed).map(func(entry: Dictionary) -> String: return entry.name)
  var expected := normative.duplicate()
  var observed := failed.duplicate()
  expected.sort()
  observed.sort()
  var preceding_negative := lane == "preceding-sdk" and not failed.is_empty() and observed == expected
  var report := {"scenario": "native-touchables", "lane": lane, "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages, "geometry": geometry,
    "expectedPrecedingFailures": normative, "precedingNegativeObserved": preceding_negative,
    "allCurrentAssertionsPassed": failed.is_empty(),
    "scope": {"actualNativeInput": true, "publicFacadeImports": lane != "animated", "originalTouchableModules": lane in ["current", "animated"],
      "productionBundle": true, "twoRoots": lane != "animated", "touchableOpacityAvailable": lane != "preceding-sdk",
      "concurrentCrossRootResponders": false, "hardwareCertified": false}}
  var file := FileAccess.open("res://build/touchables-report.json", FileAccess.WRITE)
  if not check(file != null, "report/The touchables report can be saved"):
    quit(1)
    return
  file.store_string(JSON.stringify(report, "  ") + "\n")
  if lane == "preceding-sdk":
    print("TOUCHABLES_PRECEDING_NEGATIVE: " + str(failed.size()) if preceding_negative else "TOUCHABLES_FAILED")
  elif lane == "animated":
    print("TOUCHABLES_ANIMATED_PASSED: " + str(checks.size()) if failed.is_empty() else "TOUCHABLES_FAILED")
  elif lane == "sabotage":
    print("TOUCHABLES_SABOTAGE_REJECTED: " + str(failed.size()) if not failed.is_empty() else "TOUCHABLES_SABOTAGE_ACCEPTED")
  else:
    print("TOUCHABLES_PASSED: " + str(checks.size()) if failed.is_empty() else "TOUCHABLES_FAILED")
  quit(0 if (failed.is_empty() and lane != "sabotage") or preceding_negative or (lane == "sabotage" and not failed.is_empty()) else 1)
