extends SceneTree

# RN's View, Pressable and TouchableOpacity with accessibility props, over the host's accessible View, on
# two roots of one Hermes application. HEADLESS: Godot has no OS accessibility tree here (the dummy driver),
# so this proves the semantic descriptor the host resolved, the properties it set on each Control, and the
# host path of the OS's press (accessibility_click, the method the AccessibilityServer calls). It does not
# prove what an assistive technology sees; tests/accessibility-bridge.test.mjs does, on a graphical macOS run.
const RN_ROLES := ["none", "button", "dropdownlist", "togglebutton", "link", "search", "image", "keyboardkey", "text",
  "adjustable", "imagebutton", "header", "summary", "alert", "checkbox", "combobox", "menu", "menubar", "menuitem",
  "progressbar", "radio", "radiogroup", "scrollbar", "spinbutton", "switch", "tab", "tabbar", "tablist", "timer", "list",
  "toolbar", "grid", "pager", "scrollview", "horizontalscrollview", "viewgroup", "webview", "drawerlayout", "slidingdrawer",
  "iconmenu"]
const ARIA_ROLES := ["alert", "alertdialog", "application", "article", "banner", "button", "cell", "checkbox", "columnheader",
  "combobox", "complementary", "contentinfo", "definition", "dialog", "directory", "document", "feed", "figure", "form", "grid",
  "group", "heading", "img", "link", "list", "listitem", "log", "main", "marquee", "math", "menu", "menubar", "menuitem", "meter",
  "navigation", "none", "note", "option", "presentation", "progressbar", "radio", "radiogroup", "region", "row", "rowgroup",
  "rowheader", "scrollbar", "searchbox", "separator", "slider", "spinbutton", "status", "summary", "switch", "tab", "table",
  "tablist", "tabpanel", "term", "timer", "toolbar", "tooltip", "tree", "treegrid", "treeitem"]
# The roles that have no Godot accessibility role, written apart from the host's table (docs/research/accessibility.md).
const RN_REJECTED := ["dropdownlist", "adjustable", "summary", "combobox", "scrollbar", "spinbutton", "grid", "pager",
  "scrollview", "horizontalscrollview", "webview", "drawerlayout", "slidingdrawer", "iconmenu"]
const ARIA_REJECTED := ["application", "article", "cell", "columnheader", "combobox", "definition", "directory", "document",
  "feed", "figure", "grid", "log", "marquee", "math", "meter", "note", "row", "rowgroup", "rowheader", "scrollbar", "searchbox",
  "separator", "slider", "spinbutton", "summary", "table", "term", "tree", "treegrid", "treeitem"]
const ELEMENTS := ["root", "labeled", "tap-press", "pressable", "touchable", "touchable-aria", "pressable-aria", "disabled-pressable",
  "disabled-state", "hidden-group", "hidden-child", "important", "dyn", "dyn-aria", "removable", "plain", "translated"]
const EMPTY := {"accessible": false, "name": "", "description": "", "role": null, "roleSource": null, "godotRole": null,
  "godotRoleValue": null, "roleDescription": "", "live": "none", "hidden": false, "disabled": false, "busy": false,
  "checked": "none", "selected": false, "expanded": null, "onAccessibilityTap": false, "clickAction": false}
# What the static elements of the fixture must resolve to; the members not named are those of EMPTY.
const STATIC := {
  "root": {},
  "labeled": {"accessible": true, "name": "Save draft", "description": "Saves the draft", "role": "button", "roleSource": "accessibilityRole",
    "godotRole": "ROLE_BUTTON", "live": "polite", "onAccessibilityTap": true, "clickAction": true},
  "tap-press": {"accessible": true, "name": "Tap wins", "onAccessibilityTap": true, "clickAction": true},
  "pressable": {"accessible": true, "name": "Open", "description": "Opens the file", "role": "button", "roleSource": "accessibilityRole",
    "godotRole": "ROLE_BUTTON", "clickAction": true},
  "touchable": {"accessible": true, "name": "Share", "description": "Shares the file", "role": "button", "roleSource": "accessibilityRole",
    "godotRole": "ROLE_BUTTON", "clickAction": true},
  "touchable-aria": {"accessible": true, "name": "Mute", "role": "button", "roleSource": "accessibilityRole", "godotRole": "ROLE_BUTTON",
    "live": "assertive", "busy": true, "expanded": false, "clickAction": true},
  "pressable-aria": {"accessible": true, "name": "Like", "role": "tab", "roleSource": "accessibilityRole", "godotRole": "ROLE_TAB",
    "live": "polite", "clickAction": true},
  "disabled-pressable": {"accessible": true, "name": "Locked", "disabled": true},
  "disabled-state": {"accessible": true, "name": "Off", "role": "button", "roleSource": "accessibilityRole", "godotRole": "ROLE_BUTTON",
    "disabled": true, "onAccessibilityTap": true},
  "hidden-group": {},
  "hidden-child": {"accessible": true, "name": "Inside", "role": "button", "roleSource": "accessibilityRole", "godotRole": "ROLE_BUTTON",
    "onAccessibilityTap": true, "clickAction": true},
  "important": {"name": "Skipped", "hidden": true},
  "dyn": {},
  "dyn-aria": {},
  "removable": {"accessible": true, "name": "Temporary", "role": "button", "roleSource": "accessibilityRole", "godotRole": "ROLE_BUTTON",
    "onAccessibilityTap": true, "clickAction": true},
  "plain": {},
  "translated": {"name": "Save", "description": "Save"},
}
# Updates and removals of one view's props. expect is what the descriptor must say (the rest is EMPTY's).
const CASES := [
  {"id": "initial", "props": {}, "expect": {}},
  {"id": "label", "props": {"accessibilityLabel": "L1"}, "expect": {"name": "L1"}},
  {"id": "hint", "props": {"accessibilityLabel": "L1", "accessibilityHint": "H1"}, "expect": {"name": "L1", "description": "H1"}},
  {"id": "role", "props": {"accessibilityLabel": "L1", "accessibilityHint": "H1", "accessibilityRole": "link"},
    "expect": {"name": "L1", "description": "H1", "role": "link", "roleSource": "accessibilityRole", "godotRole": "ROLE_LINK", "clickAction": true}},
  {"id": "update", "props": {"accessibilityLabel": "L2", "accessibilityRole": "header"},
    "expect": {"name": "L2", "role": "header", "roleSource": "accessibilityRole", "godotRole": "ROLE_STATIC_TEXT", "roleDescription": "heading"}},
  {"id": "removal", "props": {}, "expect": {}},
  {"id": "role-wins", "props": {"accessibilityRole": "button", "role": "link"},
    "expect": {"role": "link", "roleSource": "role", "godotRole": "ROLE_LINK", "clickAction": true}},
  {"id": "checkbox-checked", "props": {"accessibilityRole": "checkbox", "accessibilityState": {"checked": true}},
    "expect": {"role": "checkbox", "roleSource": "accessibilityRole", "godotRole": "ROLE_CHECK_BOX", "checked": "checked", "clickAction": true}},
  {"id": "checkbox-unchecked", "props": {"accessibilityRole": "checkbox", "accessibilityState": {"checked": false}},
    "expect": {"role": "checkbox", "roleSource": "accessibilityRole", "godotRole": "ROLE_CHECK_BOX", "checked": "unchecked", "clickAction": true}},
  {"id": "switch-checked", "props": {"role": "switch", "accessibilityState": {"checked": true}},
    "expect": {"role": "switch", "roleSource": "role", "godotRole": "ROLE_CHECK_BUTTON", "checked": "checked", "clickAction": true}},
  {"id": "toggle-busy", "props": {"accessibilityRole": "togglebutton", "accessibilityState": {"busy": true, "checked": true}},
    "expect": {"role": "togglebutton", "roleSource": "accessibilityRole", "godotRole": "ROLE_BUTTON", "roleDescription": "toggle button",
    "busy": true, "checked": "checked", "clickAction": true}},
  {"id": "tab-selected", "props": {"accessibilityRole": "tab", "accessibilityState": {"selected": true}},
    "expect": {"role": "tab", "roleSource": "accessibilityRole", "godotRole": "ROLE_TAB", "selected": true, "clickAction": true}},
  {"id": "button-expanded", "props": {"accessibilityRole": "button", "accessibilityState": {"expanded": true}},
    "expect": {"role": "button", "roleSource": "accessibilityRole", "godotRole": "ROLE_BUTTON", "expanded": true, "clickAction": true}},
  {"id": "disabled", "props": {"accessibilityRole": "button", "accessibilityState": {"disabled": true}, "onAccessibilityTap": true},
    "expect": {"role": "button", "roleSource": "accessibilityRole", "godotRole": "ROLE_BUTTON", "disabled": true, "onAccessibilityTap": true}},
  {"id": "live-polite", "props": {"accessibilityLiveRegion": "polite"}, "expect": {"live": "polite"}},
  {"id": "live-assertive", "props": {"accessibilityLiveRegion": "assertive"}, "expect": {"live": "assertive"}},
  {"id": "live-none", "props": {"accessibilityLiveRegion": "none"}, "expect": {}},
  {"id": "hidden-prop", "props": {"accessible": true, "accessibilityElementsHidden": true}, "expect": {"accessible": true, "hidden": true}},
  {"id": "hidden-important", "props": {"accessible": true, "importantForAccessibility": "no-hide-descendants"},
    "expect": {"accessible": true, "hidden": true}},
  {"id": "important-auto", "props": {"accessible": true, "importantForAccessibility": "auto"}, "expect": {"accessible": true, "clickAction": true}},
  {"id": "important-yes", "props": {"importantForAccessibility": "yes"}, "expect": {}},
  {"id": "tap", "props": {"onAccessibilityTap": true}, "expect": {"onAccessibilityTap": true, "clickAction": true}},
  {"id": "accessible", "props": {"accessible": true}, "expect": {"accessible": true, "clickAction": true}},
  {"id": "not-accessible", "props": {"accessible": false, "accessibilityLabel": "Still named"}, "expect": {"name": "Still named"}},
  {"id": "image", "props": {"role": "img", "accessibilityLabel": "Logo"}, "expect": {"name": "Logo", "role": "img", "roleSource": "role", "godotRole": "ROLE_IMAGE"}},
  {"id": "heading", "props": {"role": "heading", "accessibilityLabel": "Title"},
    "expect": {"name": "Title", "role": "heading", "roleSource": "role", "godotRole": "ROLE_STATIC_TEXT", "roleDescription": "heading"}},
  {"id": "banner", "props": {"role": "banner"},
    "expect": {"role": "banner", "roleSource": "role", "godotRole": "ROLE_REGION", "roleDescription": "banner"}},
  {"id": "presentation", "props": {"role": "presentation", "accessibilityRole": "button"},
    "expect": {"role": "presentation", "roleSource": "role"}},
  {"id": "literal-label", "props": {"accessibilityLabel": "100% {0} %s \\ \"q\" é 日本", "accessibilityHint": "line\nbreak"},
    "expect": {"name": "100% {0} %s \\ \"q\" é 日本", "description": "line\nbreak"}},
  # Different props, the same descriptor: the host has nothing to apply the second time.
  {"id": "same-a", "props": {"accessibilityLabel": "Same"}, "expect": {"name": "Same"}},
  {"id": "same-b", "props": {"accessibilityLabel": "Same", "importantForAccessibility": "yes"}, "expect": {"name": "Same"}},
  {"id": "cleared", "props": {}, "expect": {}},
]
# aria-* against the accessibility* props they stand for: the same descriptor.
const ARIA_PAIRS := [
  {"id": "label-live-hidden-state", "accessibility": {"accessibilityLabel": "Q", "accessibilityLiveRegion": "assertive",
    "accessibilityElementsHidden": true, "importantForAccessibility": "no-hide-descendants",
    "accessibilityState": {"busy": true, "disabled": true}, "accessibilityRole": "button"},
    "aria": {"aria-label": "Q", "aria-live": "assertive", "aria-hidden": true, "aria-busy": true, "aria-disabled": true,
    "accessibilityRole": "button"}},
  {"id": "live-off", "accessibility": {"accessibilityLiveRegion": "none", "accessibilityLabel": "R"}, "aria": {"aria-live": "off", "aria-label": "R"}},
  {"id": "selected", "accessibility": {"role": "tab", "accessibilityState": {"selected": true}}, "aria": {"role": "tab", "aria-selected": true}},
  {"id": "checked", "accessibility": {"accessibilityRole": "switch", "accessibilityState": {"checked": true}},
    "aria": {"accessibilityRole": "switch", "aria-checked": true}},
  {"id": "expanded", "accessibility": {"accessibilityRole": "button", "accessibilityState": {"expanded": true}},
    "aria": {"accessibilityRole": "button", "aria-expanded": true}},
]
# Values RN's ViewConfig stops where the View renders, before the host sees them.
const JS_NEGATIVES := [
  {"id": "unknown-accessibilityRole", "props": {"accessibilityRole": "banana"}},
  {"id": "unknown-role", "props": {"role": "banana"}},
  {"id": "heading-is-not-an-accessibilityRole", "props": {"accessibilityRole": "heading"}},
  {"id": "role-number", "props": {"accessibilityRole": 5}},
  {"id": "label-number", "props": {"accessibilityLabel": 5}},
  {"id": "hint-boolean", "props": {"accessibilityHint": true}},
  {"id": "accessible-string", "props": {"accessible": "yes"}},
  {"id": "state-disabled-string", "props": {"accessibilityState": {"disabled": "yes"}}},
  {"id": "state-checked-maybe", "props": {"accessibilityState": {"checked": "maybe"}}},
  {"id": "live-off", "props": {"accessibilityLiveRegion": "off"}},
  {"id": "hidden-string", "props": {"accessibilityElementsHidden": "yes"}},
  {"id": "important-sometimes", "props": {"importantForAccessibility": "sometimes"}},
  {"id": "actions", "props": {"accessibilityActions": [{"name": "activate"}]}},
]
# Values valid in RN that reach the host, which rejects them with the reasons.
const HOST_NEGATIVES := [
  {"id": "mixed", "props": {"accessibilityRole": "checkbox", "accessibilityState": {"checked": "mixed"}}},
  {"id": "checked-button", "props": {"accessibilityRole": "button", "accessibilityState": {"checked": true}}},
  {"id": "checked-no-role", "props": {"accessibilityState": {"checked": false}}},
  {"id": "selected-button", "props": {"accessibilityRole": "button", "accessibilityState": {"selected": true}}},
  {"id": "expanded-text", "props": {"accessibilityRole": "text", "accessibilityState": {"expanded": false}}},
  {"id": "important-no", "props": {"importantForAccessibility": "no"}},
  {"id": "webview-with-label", "props": {"accessibilityRole": "webview", "accessibilityLabel": "Not applied", "accessible": true}},
  {"id": "invalid-loser", "props": {"accessibilityRole": "adjustable", "role": "button", "accessibilityLabel": "Not applied"}},
  {"id": "everything", "props": {"role": "table", "importantForAccessibility": "no"}},
]
var application: Node
var surfaces: Dictionary = {}
var checks: Array = []
var stages: Dictionary = {}
var timeline: Array = []
var allow_original_negative := false
var sabotage := false
var expected_original_failures: Array = []
var seen_errors := 0
var translation: Translation

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

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(AccessibilityProbe." + expression + ")"))

# A JS action without a result; evaluate() would return "undefined".
func run_js(expression: String) -> void:
  application.call("evaluate", "AccessibilityProbe." + expression)

func state() -> Dictionary:
  var value: Variant = js("snapshot()")
  return value if value is Dictionary else {}

func native(target: Object) -> Dictionary:
  var value: Variant = JSON.parse_string(target.call("snapshot"))
  return value if value is Dictionary else {}

func node_of(name: String, id: String) -> Dictionary:
  for entry: Dictionary in native(surfaces[name]).get("nodes", []):
    if entry.testID == name + "-" + id:
      return entry
  return {}

# The accessible View's snapshot of one element, or {} when the element has none (not mounted, or no such host).
func ax_of(name: String, id: String) -> Dictionary:
  return node_of(name, id).get("accessibility", {})

func descriptor_of(name: String, id: String) -> Dictionary:
  return ax_of(name, id).get("descriptor", {})

func control_of(name: String, id: String) -> Control:
  return surfaces[name].find_child(name + "-" + id, true, false) as Control

func errors() -> Array:
  return native(application).get("errors", [])

# The host errors since the last call.
func new_errors() -> Array:
  var all := errors()
  var fresh := all.slice(seen_errors)
  seen_errors = all.size()
  return fresh

func engine_constant(constant_name: String) -> int:
  return ClassDB.class_get_integer_constant("AccessibilityServer", constant_name)

func expected_descriptor(overrides: Dictionary) -> Dictionary:
  var value := EMPTY.duplicate()
  for key: String in overrides:
    value[key] = overrides[key]
  return value

# The descriptor with the engine's own number of the Godot role, which the probe looks up itself.
func with_engine_role(expected: Dictionary) -> Dictionary:
  var value := expected.duplicate()
  if value.godotRole != null:
    value.godotRoleValue = engine_constant(value.godotRole)
  return value

# Numbers parsed from JSON are floats; the expectation holds ints.
func same_value(actual: Variant, expected: Variant) -> bool:
  var numeric := [TYPE_INT, TYPE_FLOAT]
  if typeof(actual) in numeric and typeof(expected) in numeric:
    return float(actual) == float(expected)
  return typeof(actual) == typeof(expected) and actual == expected

func matches(actual: Dictionary, overrides: Dictionary) -> bool:
  var expected := with_engine_role(expected_descriptor(overrides))
  if actual.size() != expected.size():
    return false
  for key: String in expected:
    if not actual.has(key) or not same_value(actual[key], expected[key]):
      return false
  return true

func mount(name: String, position: Vector2) -> void:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = name
  surface.position = position
  surface.size = Vector2(360, 440)
  surface.set("application_path", NodePath("../AccessibilityApplication"))
  surface.set("component_name", "AccessibilityProbe")
  surface.set("initial_props", {"name": name})
  surfaces[name] = surface
  root.add_child(surface)

func arm(prefix: String) -> void:
  run_js("arm(%s)" % JSON.stringify(prefix))

func set_view(name: String, view: String, props: Dictionary, remount: bool = false) -> void:
  run_js("%s(%s,%s,%s)" % ["setDyn" if view == "dyn" else "setAria", JSON.stringify(name), JSON.stringify(props), str(remount)])
  await settle(12)

# Sets a view's props and records the step: what the view held afterwards, and what the host reported on the way.
# Every change of a view goes through here, in order, so the oracle can replay the timeline.
func set_and_record(id: String, name: String, view: String, props: Dictionary, remount: bool = false) -> Dictionary:
  await set_view(name, view, props, remount)
  var entry := {"id": id, "root": name, "view": view, "props": props, "remount": remount,
    "accessibility": ax_of(name, view), "present": not node_of(name, view).is_empty(),
    "hostErrors": new_errors(), "jsErrors": state().errors.size()}
  timeline.append(entry)
  return entry

func step_of(id: String) -> Dictionary:
  for entry: Dictionary in timeline:
    if entry.id == id:
      return entry
  return {}

func mount_stage() -> void:
  var value := state()
  var counts := {}
  for name: String in ["A", "B"]:
    var nodes: Array = native(surfaces[name]).get("nodes", [])
    counts[name] = {"accessible": nodes.filter(func(row: Dictionary) -> bool: return row.has("accessibility")).size(), "all": nodes.size()}
  check(counts.A.accessible == ELEMENTS.size() + 1 and counts.B.accessible == ELEMENTS.size() + 1,
    "mount/Each root mounts its Views, and the surface's root View, as accessible Views on the host", true)
  var classes_match := true
  for name: String in ["A", "B"]:
    for id: String in ELEMENTS:
      var control := control_of(name, id)
      classes_match = classes_match and control != null and control.is_class("Panel")
  check(classes_match, "mount/Every element is still a Godot Panel")
  check(errors().is_empty(), "mount/The application reports no host or runtime error")
  check(value.errors.is_empty(), "mount/No render error reaches an error boundary")
  stages.mount = {"react": value, "counts": counts, "application": native(application),
    "roots": {"A": native(surfaces.A), "B": native(surfaces.B)}}

func static_stage() -> void:
  var rows := {}
  var all_match := true
  var control_match := true
  for name: String in ["A", "B"]:
    for id: String in STATIC:
      var ax := ax_of(name, id)
      var descriptor: Dictionary = ax.get("descriptor", {})
      rows[name + "/" + id] = ax
      if not matches(descriptor, STATIC[id]):
        all_match = false
        push_warning("static mismatch " + name + "/" + id + ": " + JSON.stringify(descriptor))
      var control: Dictionary = ax.get("control", {})
      control_match = control_match and not control.is_empty() and control.accessibilityName == descriptor.get("name") and control.accessibilityDescription == descriptor.get("description")
  check(all_match, "static/Every element resolves to the descriptor of its RN props, in both roots", true)
  check(control_match, "static/The label and the hint are the Control's accessibility name and description", true)
  var labeled_control: Dictionary = ax_of("A", "labeled").get("control", {})
  check(descriptor_of("A", "labeled").get("name") == "Save draft" and labeled_control.get("accessibilityName") == "Save draft",
    "static/The accessibilityLabel reaches the accessibility name of the Control", true)
  check(descriptor_of("A", "labeled").get("description") == "Saves the draft" and labeled_control.get("accessibilityDescription") == "Saves the draft",
    "static/The accessibilityHint reaches the accessibility description of the Control", true)
  var plain: Dictionary = ax_of("A", "plain")
  check(matches(plain.get("descriptor", {}), {}) and plain.get("control", {}).get("accessibilityName") == "",
    "static/A View without accessibility props carries an empty descriptor", true)
  check(int(labeled_control.get("accessibilityLive", -1)) == engine_constant("LIVE_POLITE") and
    int(ax_of("A", "touchable-aria").get("control", {}).get("accessibilityLive", -1)) == engine_constant("LIVE_ASSERTIVE") and
    int(ax_of("A", "plain").get("control", {}).get("accessibilityLive", -1)) == engine_constant("LIVE_OFF"),
    "static/accessibilityLiveRegion sets the Control's live mode to the engine's constant", true)
  # Fabric does not mount a display none View at all, so no element of it reaches the OS tree.
  check(node_of("A", "gone").is_empty() and node_of("B", "gone").is_empty() and control_of("A", "gone") == null,
    "static/display none mounts no Control, so nothing of it reaches the accessibility tree")
  var translated: Dictionary = ax_of("A", "translated").get("control", {})
  check(translated.get("accessibilityName") == "Save" and translated.get("accessibilityDescription") == "Save" and
    translation.get_message("Save") == "TRANSLATED" and TranslationServer.get_locale() == "en",
    "static/An RN label that is also a translation key stays literal", true)
  check(labeled_control.get("messageTranslation") == false and int(labeled_control.get("autoTranslateMode", -1)) == Node.AUTO_TRANSLATE_MODE_DISABLED,
    "static/The accessible View translates no message and does not auto translate", true)
  # Most Views carry no accessibility props. Their descriptor never changes, so the host does nothing for them after
  # the first look; a View with a descriptor to publish applies it at least once.
  var skipping := true
  for name: String in ["A", "B"]:
    for id: String in STATIC:
      var counters := ax_of(name, id)
      var applies := int(counters.get("applies", 0))
      var skipped := int(counters.get("skippedApplies", -1))
      if STATIC[id].is_empty():
        skipping = skipping and applies >= 1 and skipped == applies
      else:
        skipping = skipping and skipped >= 0 and skipped < applies
  check(skipping, "static/A View whose descriptor is empty is not applied again, and one with a descriptor is applied at least once", true)
  var published := 0
  for name: String in ["A", "B"]:
    for id: String in ELEMENTS:
      published += int(ax_of(name, id).get("updates", 0))
  check(published == 0 and not is_accessibility_enabled(),
    "static/No OS accessibility tree stands behind a headless run, so nothing was published to an assistive technology")
  stages["static"] = {"rows": rows, "translation": {"locale": TranslationServer.get_locale(), "message": translation.get_message("Save")}}

func cases_stage() -> void:
  arm("cases")
  var all := true
  var control_ok := true
  for spec: Dictionary in CASES:
    var entry := await set_and_record(spec.id, "A", "dyn", spec.props)
    var ok: bool = matches(entry.accessibility.get("descriptor", {}), spec.expect) and not entry.accessibility.get("rejected", true)
    all = all and ok
    var control: Dictionary = entry.accessibility.get("control", {})
    control_ok = control_ok and control.get("accessibilityName") == spec.expect.get("name", "") and control.get("accessibilityDescription") == spec.expect.get("description", "")
    if not ok:
      push_warning("case mismatch " + spec.id + ": " + JSON.stringify(entry.accessibility.get("descriptor", {})))
  check(all, "cases/Updating and removing props sets, replaces and clears every member of the descriptor", true)
  check(control_ok, "cases/The Control's name and description follow each update and are cleared by the removal", true)
  check(errors().is_empty(), "cases/No valid prop is reported as an error")
  check(matches(step_of("removal").accessibility.get("descriptor", {}), {}), "cases/Removing every prop returns the descriptor to the empty one", true)
  var updated: Dictionary = step_of("update").accessibility.get("descriptor", {})
  check(updated.get("name") == "L2" and updated.get("description") == "" and updated.get("role") == "header", "cases/An update drops the previous hint", true)
  var polite: Dictionary = step_of("live-polite").accessibility.get("control", {})
  var assertive: Dictionary = step_of("live-assertive").accessibility.get("control", {})
  var off: Dictionary = step_of("live-none").accessibility.get("control", {})
  check(int(polite.get("accessibilityLive", -1)) == engine_constant("LIVE_POLITE") and int(assertive.get("accessibilityLive", -1)) == engine_constant("LIVE_ASSERTIVE") and
    int(off.get("accessibilityLive", -1)) == engine_constant("LIVE_OFF"),
    "cases/The live region moves between the engine's off, polite and assertive modes", true)
  # An update that leaves the descriptor as it was is counted and skipped, not applied.
  var same_a: Dictionary = step_of("same-a").accessibility
  var same_b: Dictionary = step_of("same-b").accessibility
  check(int(same_b.get("applies", 0)) == int(same_a.get("applies", 0)) + 1 and int(same_b.get("skippedApplies", -1)) == int(same_a.get("skippedApplies", -2)) + 1 and \
    same_b.get("control", {}).get("accessibilityName") == "Same",
    "cases/An update that leaves the descriptor as it was is skipped, and the Control keeps its name", true)
  check(int(same_a.get("skippedApplies", -1)) < int(same_a.get("applies", 0)), "cases/The updates that changed the descriptor before it were applied, not skipped", true)
  stages.cases = {"count": CASES.size()}

func aria_stage() -> void:
  var same := true
  var rows: Array = []
  for pair: Dictionary in ARIA_PAIRS:
    var plain := await set_and_record("aria/" + pair.id + "/accessibility", "A", "dyn", pair.accessibility)
    var aria := await set_and_record("aria/" + pair.id + "/aria", "A", "dyn-aria", pair.aria)
    var left: Dictionary = plain.accessibility.get("descriptor", {})
    var right: Dictionary = aria.accessibility.get("descriptor", {})
    same = same and not left.is_empty() and left == right and not plain.accessibility.rejected and not aria.accessibility.rejected
    rows.append({"id": pair.id, "left": left, "right": right})
  check(same, "aria/aria-* props resolve to the descriptor of the accessibility* props they stand for", true)
  var first: Dictionary = rows[0].right
  check(first.name == "Q" and first.live == "assertive" and first.hidden and first.busy and first.disabled and not first.clickAction,
    "aria/aria-label, aria-live, aria-hidden, aria-busy and aria-disabled reach the host", true)
  check(rows[1].right.live == "none" and rows[1].right.name == "R", "aria/aria-live off is RN's none")
  stages.aria = {"pairs": rows}
  await set_and_record("aria/cleared", "A", "dyn", {})
  await set_and_record("aria/cleared-aria", "A", "dyn-aria", {})

func sweep_stage() -> void:
  var entries: Array = []
  var wrong: Array = []
  for vocabulary: Array in [["accessibilityRole", RN_ROLES, RN_REJECTED], ["role", ARIA_ROLES, ARIA_REJECTED]]:
    for role_name: String in vocabulary[1]:
      var props := {vocabulary[0]: role_name}
      var entry := await set_and_record("sweep/" + vocabulary[0] + "/" + role_name, "A", "dyn", props)
      var ax: Dictionary = entry.accessibility
      var rejected: bool = role_name in vocabulary[2]
      var descriptor: Dictionary = ax.get("descriptor", {})
      var ok: bool = ax.get("rejected", not rejected) == rejected and entry.hostErrors.size() == (1 if rejected else 0)
      if rejected:
        ok = ok and matches(descriptor, {}) and ax.errors.size() == 1
      elif role_name == "none" or role_name == "presentation":
        ok = ok and descriptor.godotRole == null
      else:
        ok = ok and descriptor.role == role_name and descriptor.godotRole != null and int(descriptor.godotRoleValue) == engine_constant(descriptor.godotRole)
      if not ok:
        wrong.append(vocabulary[0] + "/" + role_name)
      entries.append({"prop": vocabulary[0], "name": role_name, "rejected": rejected})
  check(wrong.is_empty(), "sweep/Every role RN spells is mapped to a Godot role with the engine's number, or rejected with exactly one error", true)
  check(entries.size() == RN_ROLES.size() + ARIA_ROLES.size() and RN_REJECTED.size() < RN_ROLES.size() and ARIA_REJECTED.size() < ARIA_ROLES.size(),
    "sweep/Both vocabularies are swept whole")
  var button: Dictionary = step_of("sweep/accessibilityRole/button").accessibility.get("descriptor", {})
  var header: Dictionary = step_of("sweep/accessibilityRole/header").accessibility.get("descriptor", {})
  var switch_role: Dictionary = step_of("sweep/role/switch").accessibility.get("descriptor", {})
  check(button.get("godotRole") == "ROLE_BUTTON" and header.get("godotRole") == "ROLE_STATIC_TEXT" and header.get("roleDescription") == "heading" and switch_role.get("godotRole") == "ROLE_CHECK_BUTTON",
    "sweep/button is a button, header is static text described as a heading and switch is Godot's check button", true)
  stages.sweep = {"entries": entries, "wrong": wrong}
  await set_and_record("sweep/cleared", "A", "dyn", {})

func negatives_stage() -> void:
  var js_rows: Array = []
  var recovered := true
  var js_ok := true
  for spec: Dictionary in JS_NEGATIVES:
    var before: int = state().errors.size()
    var entry := await set_and_record("js/" + spec.id, "A", "dyn", spec.props, true)
    var fresh: Array = state().errors.slice(before)
    js_rows.append({"id": spec.id, "errors": fresh})
    js_ok = js_ok and fresh.size() == 1 and fresh[0].slot == "dyn" and not entry.present and entry.hostErrors.is_empty()
    # A new boundary and a valid View recover the element.
    var back := await set_and_record("js/" + spec.id + "/recovered", "A", "dyn", {"accessibilityLabel": "Recovered"}, true)
    recovered = recovered and back.present and back.accessibility.get("descriptor", {}).get("name") == "Recovered"
  check(js_ok, "negatives/A value RN accepts but the host cannot take fails where the View renders, once, naming the prop", true)
  check(recovered, "negatives/A View that failed is replaced by a valid one", true)
  var host_ok := true
  var host_rows: Array = []
  for spec: Dictionary in HOST_NEGATIVES:
    var entry := await set_and_record("host/" + spec.id, "A", "dyn", spec.props, true)
    var ax: Dictionary = entry.accessibility
    host_ok = host_ok and entry.present and ax.get("rejected", false) and ax.errors.size() >= 1 and entry.hostErrors == ax.errors and \
      matches(ax.descriptor, {}) and ax.control.accessibilityName == "" and ax.control.accessibilityDescription == ""
    host_rows.append({"id": spec.id, "errors": ax.get("errors", [])})
  check(host_ok, "negatives/A rejected View reports each reason once and carries no semantics at all, not even the part that could be applied", true)
  # The same invalid props applied again are not reported again.
  var repeated_props := {"accessibilityRole": "checkbox", "accessibilityState": {"checked": "mixed"}, "accessibilityLabel": "changes nothing"}
  var first := await set_and_record("host/repeat-a", "A", "dyn", HOST_NEGATIVES[0].props, true)
  var second := await set_and_record("host/repeat-b", "A", "dyn", repeated_props, false)
  check(first.hostErrors.size() == 1 and second.hostErrors.is_empty() and second.accessibility.errors == first.accessibility.errors,
    "negatives/The same reasons are not reported again while they stand")
  var valid := await set_and_record("host/valid-again", "A", "dyn", {"accessibilityLabel": "Valid again"})
  check(not valid.accessibility.rejected and valid.accessibility.descriptor.name == "Valid again" and valid.hostErrors.is_empty(),
    "negatives/Valid props after a rejection are applied")
  stages.negatives = {"js": js_rows, "host": host_rows}
  await set_and_record("negatives/cleared", "A", "dyn", {})

# Presses the View through the host path of the OS's action and reports what RN saw.
func press_stage(prefix: String, name: String, id: String, expect: String) -> void:
  arm(prefix)
  var before := ax_of(name, id)
  var tag := int(node_of(name, id).tag)
  var other := "B" if name == "A" else "A"
  var other_before := ax_of(other, id)
  var control := control_of(name, id)
  control.call("accessibility_click", null)
  await settle(10)
  var value := state()
  var after := ax_of(name, id)
  var raw: Array = value.log.filter(func(row: Dictionary) -> bool: return row.label == "raw")
  var handlers: Array = value.log.filter(func(row: Dictionary) -> bool: return row.label != "raw")
  var touches := raw.filter(func(row: Dictionary) -> bool: return row.type.begins_with("topTouch")).map(func(row: Dictionary) -> String: return row.type)
  var rows_ok := handlers.all(func(row: Dictionary) -> bool: return row.root == name and row.id == id)
  match expect:
    "tap":
      check(handlers.map(func(row: Dictionary) -> String: return row.label) == ["tap"] and rows_ok and touches.is_empty() and \
        int(after.taps) == int(before.taps) + 1 and int(after.clicks) == int(before.clicks) and int(after.requests) == int(before.requests) + 1,
        prefix + "/The OS's press dispatches onAccessibilityTap and nothing else: no touch, no press", true)
      check(raw.map(func(row: Dictionary) -> Array: return [row.type, int(row.nativeTarget)]) == [["topAccessibilityTap", tag]],
        prefix + "/RN receives one topAccessibilityTap targeting the View", true)
    "press":
      check(handlers.map(func(row: Dictionary) -> String: return row.label) == ["press"] and rows_ok and touches == ["topTouchStart", "topTouchEnd"] and \
        int(after.clicks) == int(before.clicks) + 1 and int(after.taps) == int(before.taps) and int(after.requests) == int(before.requests) + 1,
        prefix + "/Without a handler the OS's press clicks the View's center: RN sees a touch and runs onPress once", true)
      check(raw.all(func(row: Dictionary) -> bool: return int(row.nativeTarget) == tag) and not raw.any(func(row: Dictionary) -> bool: return row.type == "topAccessibilityTap"),
        prefix + "/The click targets the pressed View and RN receives no accessibility event", true)
    "ignored":
      check(handlers.is_empty() and raw.is_empty() and int(after.ignoredRequests) == int(before.ignoredRequests) + 1 and \
        int(after.taps) == int(before.taps) and int(after.clicks) == int(before.clicks),
        prefix + "/A View with no action ignores the OS's press: nothing reaches RN", true)
  var other_after := ax_of(other, id)
  check(other_after.get("requests") == other_before.get("requests") and other_after.get("taps") == other_before.get("taps") and other_after.get("clicks") == other_before.get("clicks"),
    prefix + "/The other root observes nothing")
  stages[prefix] = {"react": value, "before": before, "after": after, "tag": tag, "expect": expect, "root": name, "id": id}

func actions_stage() -> void:
  await press_stage("action/tap", "A", "labeled", "tap")
  await press_stage("action/tap-wins", "A", "tap-press", "tap")
  await press_stage("action/pressable", "A", "pressable", "press")
  await press_stage("action/touchable", "A", "touchable", "press")
  await press_stage("action/touchable-aria", "A", "touchable-aria", "press")
  await press_stage("action/pressable-aria", "A", "pressable-aria", "press")
  await press_stage("action/two-roots", "B", "labeled", "tap")
  await press_stage("action/disabled-pressable", "A", "disabled-pressable", "ignored")
  await press_stage("action/disabled-state", "A", "disabled-state", "ignored")
  await press_stage("action/hidden", "A", "important", "ignored")
  await press_stage("action/plain", "A", "plain", "ignored")
  # An element that was pressable stops being so when it is hidden, and is again when it is shown.
  await set_and_record("action/dyn-hidden", "A", "dyn", {"accessible": true, "onAccessibilityTap": true, "accessibilityElementsHidden": true})
  await press_stage("action/dyn-hidden", "A", "dyn", "ignored")
  await set_and_record("action/dyn-shown", "A", "dyn", {"accessible": true, "onAccessibilityTap": true})
  await press_stage("action/dyn-shown", "A", "dyn", "tap")
  await set_and_record("action/cleared", "A", "dyn", {})
  var counts: Array = []
  for prefix: String in ["action/tap", "action/tap-wins", "action/pressable", "action/touchable", "action/touchable-aria", "action/pressable-aria", "action/two-roots"]:
    counts.append(int(stages[prefix].after.requests))
  check(counts.all(func(count: int) -> bool: return count == 1), "action/Each pressed View counted exactly one request from the OS", true)

func hidden_stage() -> void:
  arm("hidden")
  var before := descriptor_of("A", "hidden-group")
  run_js("hide('A',true)")
  await settle(12)
  var hidden := descriptor_of("A", "hidden-group")
  var child := descriptor_of("A", "hidden-child")
  run_js("hide('A',false)")
  await settle(12)
  var shown := descriptor_of("A", "hidden-group")
  check(before.get("hidden") == false and hidden.get("hidden") == true and shown.get("hidden") == false,
    "hidden/aria-hidden hides the View's element and showing it again clears it", true)
  check(child.get("hidden") == false and child.get("name") == "Inside",
    "hidden/The element of a descendant is not marked hidden itself: the OS tree hides it with its ancestor", true)
  check(descriptor_of("B", "hidden-group") == before and before.get("name") == "", "hidden/Hiding one root's View changes nothing in the other root", true)
  stages.hidden = {"before": before, "hidden": hidden, "child": child, "shown": shown, "other": descriptor_of("B", "hidden-group")}

func removal_stage() -> void:
  arm("removal")
  var before := node_of("A", "removable")
  var root_before := native(surfaces.A)
  run_js("remove('A')")
  await settle(12)
  var removed := native(surfaces.A)
  check(node_of("A", "removable").is_empty() and int(removed.deletes) == int(root_before.deletes) + 1,
    "removal/Removing the View deletes its Control", true)
  run_js("restore('A')")
  await settle(12)
  var restored := node_of("A", "removable")
  check(not restored.is_empty() and int(restored.tag) != int(before.tag) and restored.get("accessibility", {}).get("descriptor", {}).get("name") == "Temporary" and \
    int(restored.get("accessibility", {}).get("requests", -1)) == 0,
    "removal/A remounted View is a new accessible View with its descriptor and no history", true)
  stages.removal = {"before": before, "rootBefore": root_before, "removed": removed, "restored": restored}
  # The label of a mounted View changes in place.
  run_js("relabel('A','Renamed')")
  await settle(12)
  var renamed := ax_of("A", "labeled")
  check(renamed.get("descriptor", {}).get("name") == "Renamed" and renamed.get("control", {}).get("accessibilityName") == "Renamed" and renamed.get("descriptor", {}).get("description") == "Saves the draft",
    "removal/Changing accessibilityLabel renames the element in place and keeps the rest", true)
  check(ax_of("B", "labeled").get("descriptor", {}).get("name") == "Save draft", "removal/The other root keeps its own label", true)
  stages.relabel = {"renamed": renamed}

func _initialize() -> void:
  allow_original_negative = OS.get_cmdline_user_args().has("--allow-original-negative")
  sabotage = OS.get_cmdline_user_args().has("--sabotage")
  call_deferred("run_probe")

func run_probe() -> void:
  root.size = Vector2i(760, 460)
  # A translation for the words of an RN label, to see that the label is not translated.
  translation = Translation.new()
  translation.locale = "en"
  translation.add_message("Save", "TRANSLATED")
  TranslationServer.add_translation(translation)
  TranslationServer.set_locale("en")
  application = ClassDB.instantiate("FabricApplication")
  application.name = "AccessibilityApplication"
  application.set("bundle_path", "res://build/accessibility-probe.js")
  root.add_child(application)
  mount("A", Vector2(0, 0))
  mount("B", Vector2(380, 0))
  await settle(14)
  mount_stage()
  # The preceding host has no accessible View: its nodes carry no descriptor, so the static checks fail there
  # and the stages that need one cannot run.
  static_stage()
  if not allow_original_negative:
    await cases_stage()
    await aria_stage()
    await sweep_stage()
    await negatives_stage()
    await actions_stage()
    await hidden_stage()
    await removal_stage()
    stages.timeline = timeline
  stages.beforeStop = {"application": native(application), "react": state()}
  application.call("stop")
  await settle()
  var stopped := native(application)
  check(stopped.stopped and int(stopped.rootCount) == 0 and int(stopped.pendingWork) == 0 and int(stopped.pointerRouting.stored) == 0 and int(stopped.pointerProcessor.active) == 0,
    "cleanup/Stop releases every root, route and active pointer")
  for name: String in ["A", "B"]:
    var final_root := native(surfaces[name])
    check(int(final_root.nativeTags) == 0 and int(final_root.creates) == int(final_root.deletes), "cleanup/" + name + "/All native Controls are balanced")
    stages["stoppedRoot" + name] = final_root
    surfaces[name].queue_free()
  application.queue_free()
  TranslationServer.remove_translation(translation)
  await settle()
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var observed := failures.duplicate()
  var expected := expected_original_failures.duplicate()
  observed.sort()
  expected.sort()
  var original_negative_observed := allow_original_negative and observed == expected and not failures.is_empty()
  var report := {"scenario": "native-accessibility", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages, "afterStop": stopped,
    "expectedOriginalFailures": expected_original_failures, "allowOriginalNegative": allow_original_negative,
    "originalNegativeObserved": original_negative_observed, "allCurrentAssertionsPassed": failures.is_empty(),
    "constants": {"roles": engine_constants("ROLE_"), "flags": engine_constants("FLAG_"), "actions": engine_constants("ACTION_"), "live": engine_constants("LIVE_")},
    "accessibilitySupported": AccessibilityServer.is_supported(),
    "scope": {"headless": true, "metadataOnly": true, "osTree": false, "assistiveTechnology": false, "hostPathOfOsPress": true,
      "originalViewJs": true, "touchableOpacity": true, "pressable": true, "hardwareCertified": false}}
  var output := FileAccess.open("res://build/accessibility-report.json", FileAccess.WRITE)
  if not check(output != null, "report/Accessibility report is saved"):
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  var rejected := sabotage and not failures.is_empty()
  if original_negative_observed:
    print("ACCESSIBILITY_ORIGINAL_NEGATIVE: " + str(failures.size()))
  elif rejected:
    print("ACCESSIBILITY_SABOTAGE_REJECTED: " + str(failures.size()))
  elif failures.is_empty():
    print("ACCESSIBILITY_PASSED: " + str(checks.size()))
  else:
    print("ACCESSIBILITY_FAILED")
  quit(0 if failures.is_empty() or original_negative_observed or rejected else 1)

# The numbers of the AccessibilityServer constants the host resolves by name, as this engine has them.
func engine_constants(prefix: String) -> Dictionary:
  var result := {}
  for constant_name: String in ClassDB.class_get_integer_constant_list("AccessibilityServer"):
    if constant_name.begins_with(prefix):
      result[constant_name] = engine_constant(constant_name)
  return result
