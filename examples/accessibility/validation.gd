extends Node

# The public accessibility example, headless or in a window. Each state is read from the semantic descriptor the
# host resolved for the accessible View behind each element (the name, the role, the states, the live region,
# hidden) and from what React observed. The OS's press is called on the host path that the AccessibilityServer
# uses (accessibility_click); the OS tree itself is read by tests/accessibility-bridge.test.mjs. With --capture the
# renderer's frame is saved too.
const IDS := ["a11y-title", "a11y-modes", "a11y-mode-compact", "a11y-mode-detailed", "a11y-rating", "a11y-rating-1", "a11y-rating-2",
  "a11y-rating-3", "a11y-send", "a11y-reset", "a11y-status", "a11y-decoration"]
const FRAMES := 240
var checks: Array = []
var stages: Dictionary = {}
var capturing := false
@onready var application: Node = $Application
@onready var surface: Control = $Surface

func verify(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

func frames(count: int = 1) -> void:
  for index in range(count):
    await get_tree().process_frame

# Waits on a state, counted in delivered frames.
func wait_for(condition: Callable) -> bool:
  for attempt in range(FRAMES):
    if condition.call():
      return true
    await frames()
  return condition.call()

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(" + expression + ")"))

func example() -> Dictionary:
  var value: Variant = js("globalThis.AccessibilityExample.state()")
  return value if value is Dictionary else {}

func native_state() -> Dictionary:
  var value: Variant = JSON.parse_string(application.call("snapshot"))
  return value if value is Dictionary else {}

func node_of(id: String) -> Dictionary:
  var nodes: Variant = JSON.parse_string(surface.call("snapshot")).get("nodes", [])
  for entry: Dictionary in nodes:
    if entry.get("testID") == id:
      return entry
  return {}

func descriptor(id: String) -> Dictionary:
  var value: Variant = node_of(id).get("accessibility", {}).get("descriptor", {})
  return value if value is Dictionary else {}

# What the host counted for an element: the OS's requests, the ones it ignored, and the clicks and taps it sent on.
func counters(id: String) -> Dictionary:
  var value: Variant = node_of(id).get("accessibility", {})
  return value if value is Dictionary else {}

# One request more, ignored, and no click or tap sent on to React.
func refused(before: Dictionary, after: Dictionary) -> bool:
  for key in ["requests", "ignoredRequests", "clicks", "taps"]:
    if not before.has(key) or not after.has(key):
      return false
  return int(after["requests"]) == int(before["requests"]) + 1 \
    and int(after["ignoredRequests"]) == int(before["ignoredRequests"]) + 1 \
    and int(after["clicks"]) == int(before["clicks"]) \
    and int(after["taps"]) == int(before["taps"])

func control(id: String) -> Control:
  return surface.find_child(id, true, false) as Control

# The OS's press on an element, as the AccessibilityServer calls it.
func press(id: String) -> void:
  control(id).call("accessibility_click", null)
  await frames(10)

func capture(stage: String) -> void:
  if not capturing:
    return
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  verify(image.save_png("res://build/accessibility-%s.png" % stage) == OK, "Renderer capture saved: " + stage)

func _ready() -> void:
  if not OS.get_cmdline_user_args().has("--validate"):
    return
  capturing = OS.get_cmdline_user_args().has("--capture")
  await run()

func run() -> void:
  var mounted := await wait_for(func() -> bool: return IDS.all(func(id: String) -> bool: return control(id) != null))
  verify(mounted, "The public example mounts its twelve named elements as Godot Controls")
  await frames(10)
  verify(IDS.all(func(id: String) -> bool: return node_of(id).has("accessibility")),
    "Every element is an accessible View of the host")
  var title := descriptor("a11y-title")
  verify(title.get("name") == "Send feedback" and title.get("role") == "header" and title.get("godotRole") == "ROLE_STATIC_TEXT" and title.get("roleDescription") == "heading",
    "The title is static text described as a heading, named by its accessibilityLabel")
  var tabs := descriptor("a11y-modes")
  var compact := descriptor("a11y-mode-compact")
  var detailed := descriptor("a11y-mode-detailed")
  verify(tabs.get("role") == "tablist" and tabs.get("godotRole") == "ROLE_TAB_BAR" and tabs.get("name") == "Layout"
    and compact.get("role") == "tab" and compact.get("godotRole") == "ROLE_TAB" and compact.get("name") == "Compact" and compact.get("selected") == true
    and detailed.get("role") == "tab" and detailed.get("name") == "Detailed" and detailed.get("selected") == false,
    "The layout switch is a tab list of two tabs named by aria-label, and the compact one is selected by aria-selected")
  var group := descriptor("a11y-rating")
  var radios := [1, 2, 3].map(func(value: int) -> Dictionary: return descriptor("a11y-rating-%d" % value))
  verify(group.get("role") == "radiogroup" and group.get("name") == "Rating" and group.get("roleDescription") == "radio group"
    and radios.all(func(radio: Dictionary) -> bool: return radio.get("role") == "radio" and radio.get("godotRole") == "ROLE_RADIO_BUTTON" and radio.get("checked") == "unchecked" and radio.get("clickAction") == true and radio.get("description") == "Rates this screen")
    and radios.map(func(radio: Dictionary) -> Variant: return radio.get("name")) == ["1 of 3", "2 of 3", "3 of 3"],
    "The rating is a radio group of three radios, named, described and unchecked")
  var send := descriptor("a11y-send")
  verify(send.get("role") == "button" and send.get("name") == "Send" and send.get("description") == "Sends your feedback"
    and send.get("disabled") == true and send.get("clickAction") == false,
    "Send is a button that is disabled until a rating is chosen, and a disabled button offers no press")
  var status := descriptor("a11y-status")
  verify(status.get("live") == "polite" and status.get("name") == "Choose a rating to send", "The status is a polite live region that says what the screen says")
  var decoration := descriptor("a11y-decoration")
  verify(decoration.get("hidden") == true and decoration.get("clickAction") == false, "The decoration is hidden from assistive technologies by aria-hidden")
  stages.initial = {"title": title, "tabs": tabs, "compact": compact, "detailed": detailed, "group": group, "radios": radios, "send": send,
    "status": status, "decoration": decoration, "example": example()}
  await capture("initial")

  # The OS's press on a radio runs the Pressable's onPress through the click the host sends.
  await press("a11y-rating-2")
  var rated := example()
  var radios_after := [1, 2, 3].map(func(value: int) -> Dictionary: return descriptor("a11y-rating-%d" % value))
  verify(rated.get("rating") == 2 and radios_after.map(func(radio: Dictionary) -> Variant: return radio.get("checked")) == ["unchecked", "checked", "unchecked"],
    "Pressing the second radio chooses 2 and checks only that radio")
  send = descriptor("a11y-send")
  status = descriptor("a11y-status")
  verify(send.get("disabled") == false and send.get("clickAction") == true and status.get("name") == "2 of 3 chosen",
    "Choosing a rating enables Send, which now offers the press, and updates the live region's name")
  await press("a11y-mode-detailed")
  compact = descriptor("a11y-mode-compact")
  detailed = descriptor("a11y-mode-detailed")
  verify(example().get("mode") == "detailed" and compact.get("selected") == false and detailed.get("selected") == true,
    "Pressing the other tab moves the selected state")
  await press("a11y-send")
  var done := example()
  send = descriptor("a11y-send")
  status = descriptor("a11y-status")
  verify(done.get("sent") == true and status.get("name") == "Thanks! You rated this 2 of 3" and send.get("disabled") == true and send.get("clickAction") == false,
    "Pressing Send through the touchable sends once, tells the live region and disables Send again")
  await capture("sent")
  # A press on the disabled Send is delivered to the host and refused there: the host counts one more request,
  # all of them ignored, sends no click, and the Send handler of React, which ran once for the press above, does not run.
  var send_before := counters("a11y-send")
  var sends_before: Variant = example().get("sends")
  await press("a11y-send")
  var send_after := counters("a11y-send")
  verify(sends_before == 1 and example().get("sends") == sends_before and example().get("sent") == true
    and refused(send_before, send_after),
    "The OS's press on the disabled Send is refused by the host and never reaches the Send handler")
  # The same press on the hidden decoration, which has no handler, is checked on the host's counters alone.
  var decoration_before := counters("a11y-decoration")
  await press("a11y-decoration")
  verify(refused(decoration_before, counters("a11y-decoration")),
    "The OS's press on the hidden decoration is refused by the host")
  # A new rating after the send is a new message: the sent state clears and Send offers the press again.
  await press("a11y-rating-3")
  var rerated := example()
  send = descriptor("a11y-send")
  status = descriptor("a11y-status")
  verify(rerated.get("rating") == 3 and rerated.get("sent") == false and rerated.get("sends") == 1
    and send.get("disabled") == false and send.get("clickAction") == true and status.get("name") == "3 of 3 chosen",
    "Choosing another rating after the send clears it: the status follows the rating and Send offers the press again")
  # onAccessibilityTap answers the OS's press instead of onPress.
  await press("a11y-reset")
  var reset := example()
  verify(reset.get("taps", []) == [{"id": "reset"}] and reset.get("rating") == 0 and reset.get("sent") == false and descriptor("a11y-send").get("disabled") == true,
    "The OS's press on Start over runs onAccessibilityTap, and the form starts over")
  verify(native_state().get("errors", []).is_empty(), "The run raised no host error")
  await finish()

func finish() -> void:
  application.call("stop")
  await frames(8)
  var stopped := native_state()
  verify(stopped.get("stopped", false) and stopped.get("rootCount", -1) == 0 and stopped.get("errors", []).is_empty(),
    "Stop releases the root without a host error")
  var report := {"scenario": "accessibility", "godot": Engine.get_version_info().string, "react": "19.2.3", "reactNative": "0.87.1",
    "engine": "hermes", "renderer": "fabric", "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages,
    "osTree": false, "applicationStopped": stopped}
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://build"))
  var output := FileAccess.open("res://build/report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_ERROR: Cannot write the accessibility report")
    get_tree().quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  print("FABRIC_VALIDATION_FAILED: accessibility" if failed else "FABRIC_VALIDATION_PASSED: accessibility " + str(checks.size()))
  get_tree().quit(1 if failed else 0)
