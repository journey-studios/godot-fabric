extends SceneTree

# RN's iOS- and Android-specific APIs on Godot, where Platform.OS is "godot": the
# upstream unavailability, reproduced. Two FabricApplications, each with its own
# Hermes runtime and the same bundle, run RN's original ToastAndroid (its
# fallback), PermissionsAndroid, DynamicColorIOS, ActionSheetIOS,
# ProgressBarAndroid, DrawerLayoutAndroid (its fallback), InputAccessoryView,
# PushNotificationIOS and TouchableNativeFeedback through the public
# react-native import, with the host's real TurboModule registry:
#
#   A  every API, every outcome: reads, calls, mounted components, the host
#      modules RN looks up, a real mouse and touch press on a
#      TouchableNativeFeedback, and the same APIs after stop.
#   B  a second application: RN's one-time notices print again, once, in its own
#      runtime.
#
# The probe judges what JS recorded, never time. The independent oracle
# (os-contracts-oracle.mjs) derives RN's texts, keys and counts from the pinned
# sources and compares every recorded call, warning and native view. This slice
# has no native code: --allow-previous-sdk runs the same bundle built from the
# SDK that origin/main had before it, and the normative checks must fail there.
const DEVICE := 1001
const SIZE := Vector2(400, 360)
const ORIGINS := {"A": Vector2.ZERO, "B": Vector2(420, 0)}
const FEEDBACK := Vector2(91, 224)
# The views each root commits: the app wrapper and the root, ProgressBarAndroid
# and its child, the plain-View control and its child, the drawer and its main
# child, the accessory wrapper, and three touchable children.
const NATIVE_VIEWS := 12
const APIS := ["ToastAndroid", "PermissionsAndroid", "DynamicColorIOS", "ActionSheetIOS", "ProgressBarAndroid", "DrawerLayoutAndroid",
  "InputAccessoryView", "PushNotificationIOS", "TouchableNativeFeedback", "StatusBar"]
const ORIGINALS := ["ToastAndroid", "PermissionsAndroid", "DynamicColorIOS", "ActionSheetIOS", "ProgressBarAndroid", "DrawerLayoutAndroid",
  "InputAccessoryView", "PushNotificationIOS"]
const TOAST := ["ToastAndroid.show", "ToastAndroid.showWithGravity", "ToastAndroid.showWithGravityAndOffset"]
const PERMISSION_CALLS := ["PermissionsAndroid.check", "PermissionsAndroid.request", "PermissionsAndroid.request/rationale",
  "PermissionsAndroid.requestMultiple", "PermissionsAndroid.checkPermission", "PermissionsAndroid.requestPermission"]
const SHEET_CALLS := ["ActionSheetIOS.showActionSheetWithOptions/no-options", "ActionSheetIOS.showActionSheetWithOptions/no-callback",
  "ActionSheetIOS.showActionSheetWithOptions", "ActionSheetIOS.showShareActionSheetWithOptions/no-options",
  "ActionSheetIOS.showShareActionSheetWithOptions/no-failure-callback", "ActionSheetIOS.showShareActionSheetWithOptions/no-success-callback",
  "ActionSheetIOS.showShareActionSheetWithOptions", "ActionSheetIOS.dismissActionSheet"]
const PUSH_CALLS := ["PushNotificationIOS.checkPermissions/no-callback", "PushNotificationIOS.addEventListener/unsupported",
  "PushNotificationIOS.addEventListener", "PushNotificationIOS.removeEventListener", "PushNotificationIOS.removeEventListener/unsupported"]
const TOAST_WARNING := "ToastAndroid is not supported on this platform."
const PLATFORM_WARNING := "\"PermissionsAndroid\" module works only for Android platform."
const ACCESSORY_WARNING := "<InputAccessoryView> is only supported on iOS."
const PUSH_UNAVAILABLE := "PushNotificationManager is not available."
const SHEET_UNAVAILABLE := "ActionSheetManager doesn't exist"
const DRAWER_UNAVAILABLE := "DrawerLayoutAndroid is only available on Android"
const HOST_MODULES := ["ToastAndroid", "PermissionsAndroid", "ActionSheetManager", "DialogManagerAndroid", "PushNotificationManager",
  "StatusBarManager"]

var checks: Array = []
var expected_previous_failures: Array = []
var allow_previous_sdk := false
var sabotage := false
var bundle_file := "os-contracts-probe.js"
var apps := {}
var surfaces := {}
var data := {"A": {}, "B": {}}

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

# A normative check needs the SDK of this slice: the previous SDK exports none of
# these APIs, so it must fail exactly these checks.
func normative(condition: bool, name: String) -> bool:
  expected_previous_failures.append(name)
  return check(condition, name)

func settle(count: int = 8) -> void:
  for index in range(count):
    await process_frame

func js(app_name: String, expression: String) -> Variant:
  return JSON.parse_string(apps[app_name].call("evaluate", "JSON.stringify(OsContractsProbe." + expression + ")"))

func run_js(app_name: String, expression: String) -> void:
  apps[app_name].call("evaluate", "OsContractsProbe." + expression)

func dictionary(value: Variant) -> Dictionary:
  return value if value is Dictionary else {}

func array(value: Variant) -> Array:
  return value if value is Array else []

func native(target: Object) -> Dictionary:
  return dictionary(JSON.parse_string(target.call("snapshot")))

func state_of(app_name: String) -> Dictionary:
  return dictionary(js(app_name, "snapshot()"))

func node_of(app_name: String, id: String) -> Dictionary:
  for entry: Dictionary in array(native(surfaces[app_name]).get("nodes", [])):
    if entry.testID == app_name + "-" + id:
      return entry
  return {}

# A child inside its parent: both sizes and where the child sits in the parent.
func shape(parent: Dictionary, child: Dictionary) -> Array:
  if parent.is_empty() or child.is_empty():
    return []
  return [parent.fabricWidth, parent.fabricHeight, child.fabricWidth, child.fabricHeight,
    child.fabricX - parent.fabricX, child.fabricY - parent.fabricY]

func call_of(value: Dictionary, op: String) -> Dictionary:
  for entry: Dictionary in array(value.get("calls", [])):
    if entry.op == op:
      return entry
  return {}

func read_of(value: Dictionary, name: String) -> Dictionary:
  for entry: Dictionary in array(value.get("reads", [])):
    if entry.name == name:
      return entry
  return {}

# How many warnings the nth read of an API printed; -1 when it did not happen.
func printed(rows: Array, index: int) -> int:
  return array(dictionary(rows[index]).get("warnings", [])).size() if rows.size() > index else -1

func reads_of(value: Dictionary, name: String) -> Array:
  return array(value.get("reads", [])).filter(func(entry: Dictionary) -> bool: return entry.name == name)

# One recorded call: how it ended, what it produced, and what it printed.
func matches(entry: Dictionary, state: String, result: Variant, error: Variant, warnings: Array) -> bool:
  return (entry.get("state", "") == state and entry.get("value") == result and entry.get("error") == error
    and array(entry.get("warnings", [])) == warnings)

func all_match(value: Dictionary, ops: Array, state: String, result: Variant, error: Variant, warnings: Array) -> bool:
  return ops.all(func(op: String) -> bool: return matches(call_of(value, op), state, result, error, warnings))

func is_original(value: Dictionary, api: String) -> bool:
  var entry := read_of(value, api)
  return entry.get("available") == true and entry.get("sameAsOriginal") == true and entry.get("error") == null

# The child of a touchable got Pressability's handlers and no native Android drawable.
func clean_feedback(value: Dictionary, id: String) -> bool:
  var keys: Array = array(dictionary(dictionary(value.get("seen", {})).get("A-" + id, {})).get("keys", []))
  return (not keys.is_empty() and not keys.has("nativeBackgroundAndroid") and not keys.has("nativeForegroundAndroid")
    and keys.has("onResponderGrant") and keys.has("onStartShouldSetResponder") and keys.has("onClick"))

func absent_module(modules: Dictionary, name: String) -> bool:
  var row := dictionary(modules.get(name, {}))
  return row.get("get") == null and dictionary(row.get("getEnforcing", {})).has("error")

# The one-time notices RN's index.js prints when ProgressBarAndroid, DrawerLayoutAndroid or PushNotificationIOS is first read.
func is_notice(row: String) -> bool:
  return (row.begins_with("ProgressBarAndroid has been extracted") or row.begins_with("DrawerLayoutAndroid is deprecated")
    or row.begins_with("PushNotificationIOS has been extracted"))

func threw_unavailable(entry: Dictionary) -> bool:
  return matches(entry, "threw", null, PUSH_UNAVAILABLE, [])

func make_application(app_name: String) -> void:
  var application: Node = ClassDB.instantiate("FabricApplication")
  application.name = app_name
  application.set("bundle_path", "res://build/" + bundle_file)
  root.add_child(application)
  apps[app_name] = application
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = "Surface" + app_name
  surface.position = ORIGINS[app_name]
  surface.size = SIZE
  surface.set("application_path", NodePath("../" + app_name))
  surface.set("component_name", "OsContractsProbe")
  surface.set("initial_props", {"name": app_name})
  surface.set_meta("validation_input_device", DEVICE)
  surfaces[app_name] = surface
  root.add_child(surface)

func run_calls(app_name: String, label: String, ops: Array) -> void:
  for op: String in ops:
    run_js(app_name, "run(%s, %s)" % [JSON.stringify(label), JSON.stringify(op)])
  await settle()

# ---------------------------------------------------------------- mount
func mount_stage() -> void:
  var value := state_of("A")
  var tree := native(surfaces.A)
  var errors: Array = array(value.get("renderErrors", [])).map(func(row: Dictionary) -> String: return row.case + ": " + row.message)
  errors.sort()
  check(array(tree.get("errors", [])).is_empty() and array(native(surfaces.B).get("errors", [])).is_empty()
    and dictionary(dictionary(value.get("roots", {})).get("A", {})).get("mounted") == true,
    "mount/Both applications mount their root without a host or runtime error")
  check(int(value.get("importWarnings", -1)) == 0,
    "mount/Importing react-native prints no notice or warning before an API is read")
  normative(errors == ["inline: Inline Controls are not implemented in Godot Text", "status-bar: Godot platform does not implement StatusBar"],
    "mount/Only StatusBar and a TouchableNativeFeedback inside Text fail at render, each with its own error")
  var progress := shape(node_of("A", "progress"), node_of("A", "progress-child"))
  var control := shape(node_of("A", "control"), node_of("A", "control-child"))
  normative(not progress.is_empty() and progress == control,
    "mount/ProgressBarAndroid commits what a plain nested View commits: its child inside the wrapper, with no extra native view")
  var drawer := shape(node_of("A", "drawer"), node_of("A", "drawer-main"))
  normative(drawer == [120.0, 60.0, 50.0, 30.0, 0.0, 0.0] and node_of("A", "drawer-navigation").is_empty(),
    "mount/DrawerLayoutAndroid commits its main child only: renderNavigationView is not called")
  var accessory: Array = array(value.get("warnings", [])).filter(func(row: String) -> bool: return row == ACCESSORY_WARNING)
  var renders := int(dictionary(value.get("renders", {})).get("A-accessory", -1))
  normative(not node_of("A", "accessory").is_empty() and node_of("A", "accessory-child").is_empty() and renders > 0
    and accessory.size() == renders,
    "mount/InputAccessoryView renders nothing and warns once per render")
  var feedback := ["native-feedback", "native-feedback-foreground", "native-feedback-default"]
  normative(feedback.all(func(id: String) -> bool: return node_of("A", id).get("fabricWidth") == 150.0 and node_of("A", id).get("fabricHeight") == 48.0),
    "mount/TouchableNativeFeedback commits its child as one host view with the child's own layout, three ways")
  normative(int(tree.get("nativeTags", -1)) == NATIVE_VIEWS and int(native(surfaces.B).get("nativeTags", -1)) == NATIVE_VIEWS,
    "mount/Each root commits exactly the expected native views")
  data.A.mount = {"js": value, "native": tree}
  data.B.mount = {"js": state_of("B"), "native": native(surfaces.B)}

# ---------------------------------------------------------------- reads
func reads_stage() -> void:
  for api: String in APIS:
    run_js("A", "read(%s)" % JSON.stringify(api))
  # A second read of the APIs that print a notice must print nothing.
  for api: String in ["ProgressBarAndroid", "DrawerLayoutAndroid", "PushNotificationIOS"]:
    run_js("A", "read(%s)" % JSON.stringify(api))
  await settle()
  var value := state_of("A")
  normative(ORIGINALS.all(func(api: String) -> bool: return is_original(value, api)), "reads/Eight exports are defined and each is RN's original module, never a copy")
  var wrapper := read_of(value, "TouchableNativeFeedback")
  normative(wrapper.get("available") == true and wrapper.get("type") == "function" and wrapper.get("sameAsOriginal") == false,
    "reads/TouchableNativeFeedback is the SDK's guarded wrapper, and a different function from RN's class")
  var bar := reads_of(value, "ProgressBarAndroid")
  var drawer := reads_of(value, "DrawerLayoutAndroid")
  var push := reads_of(value, "PushNotificationIOS")
  normative(printed(bar, 0) == 0 and printed(drawer, 0) == 0 and printed(push, 0) == 1
    and printed(push, 1) == 0 and printed(bar, 1) == 0 and printed(drawer, 1) == 0,
    "reads/PushNotificationIOS prints its extraction notice on its first read, and the notices of ProgressBarAndroid and DrawerLayoutAndroid were printed at mount, once")
  var status := read_of(value, "StatusBar")
  check(status.get("available") == true and status.get("type") == "function" and status.get("sameAsOriginal") == false
    and array(status.get("warnings", [])).is_empty(),
    "reads/StatusBar is still the placeholder the facade exported before, not RN's module")
  data.A.reads = {"js": value}

# ---------------------------------------------------------------- calls
func calls_stage() -> void:
  await run_calls("A", "toast", TOAST)
  await run_calls("A", "permissions", PERMISSION_CALLS)
  await run_calls("A", "dynamic-color", ["DynamicColorIOS"])
  await run_calls("A", "action-sheet", SHEET_CALLS)
  await run_calls("A", "push", PUSH_CALLS)
  run_js("A", "runPushStatics('push-statics')")
  data.A.drawer = dictionary(js("A", "runDrawer('drawer', 'A')"))
  await settle()
  data.A.statics = dictionary(js("A", "statics()"))
  data.A.hostModules = dictionary(js("A", "hostModules()"))
  var value := state_of("A")
  data.A.calls = {"js": value}
  var statics := dictionary(data.A.statics)

  var toast := dictionary(statics.get("toast", {}))
  normative(dictionary(toast.get("constants", {})).values().all(func(item: Variant) -> bool: return item == 0.0)
    and dictionary(toast.get("constants", {})).size() == 5 and toast.get("methods") == ["show", "showWithGravity", "showWithGravityAndOffset"],
    "toast/ToastAndroid has RN's five constants, all 0, and its three methods")
  normative(all_match(value, TOAST, "returned", null, null, [TOAST_WARNING]) and TOAST.all(func(op: String) -> bool: return call_of(value, op).get("valueUndefined") == true),
    "toast/show, showWithGravity and showWithGravityAndOffset return undefined and warn once with RN's text")
  check(statics.get("genericToastAndroid") == "undefined",
    "toast/RN's generic ToastAndroid path imports itself and resolves to undefined: a third-party import of it stays unavailable")

  var permissions := dictionary(statics.get("permissions", {}))
  var table := dictionary(permissions.get("permissions", {}))
  normative(table.size() == 44 and table.get("CAMERA") == "android.permission.CAMERA" and table.get("ADD_VOICEMAIL") == "com.android.voicemail.permission.ADD_VOICEMAIL"
    and dictionary(permissions.get("results", {})) == {"GRANTED": "granted", "DENIED": "denied", "NEVER_ASK_AGAIN": "never_ask_again"}
    and permissions.get("frozen") == [true, true],
    "permissions/PERMISSIONS holds RN's 44 names and RESULTS its three results, both frozen")
  normative(matches(call_of(value, "PermissionsAndroid.check"), "resolved", false, null, [PLATFORM_WARNING]),
    "permissions/check warns once and resolves false")
  normative(all_match(value, ["PermissionsAndroid.request", "PermissionsAndroid.request/rationale"], "resolved", "denied", null, [PLATFORM_WARNING]),
    "permissions/request warns once and resolves 'denied', with and without a rationale")
  normative(matches(call_of(value, "PermissionsAndroid.requestMultiple"), "resolved", {}, null, [PLATFORM_WARNING]),
    "permissions/requestMultiple warns once and resolves an empty object")
  normative(matches(call_of(value, "PermissionsAndroid.checkPermission"), "resolved", false, null,
    ["\"PermissionsAndroid.checkPermission\" is deprecated. Use \"PermissionsAndroid.check\" instead", PLATFORM_WARNING])
    and matches(call_of(value, "PermissionsAndroid.requestPermission"), "resolved", false, null,
    ["\"PermissionsAndroid.requestPermission\" is deprecated. Use \"PermissionsAndroid.request\" instead", PLATFORM_WARNING]),
    "permissions/The deprecated checkPermission and requestPermission warn of the deprecation, then of the platform, and resolve false")

  normative(matches(call_of(value, "DynamicColorIOS"), "threw", null, "DynamicColorIOS is not available on this platform.", []),
    "dynamic-color/DynamicColorIOS throws RN's error")
  normative(matches(call_of(value, SHEET_CALLS[0]), "threw", null, "Options must be a valid object", [])
    and matches(call_of(value, SHEET_CALLS[1]), "threw", null, "Must provide a valid callback", [])
    and matches(call_of(value, SHEET_CALLS[3]), "threw", null, "Options must be a valid object", [])
    and matches(call_of(value, SHEET_CALLS[4]), "threw", null, "Must provide a valid failureCallback", [])
    and matches(call_of(value, SHEET_CALLS[5]), "threw", null, "Must provide a valid successCallback", []),
    "action-sheet/RN's argument invariants run first, before the missing module")
  normative(all_match(value, [SHEET_CALLS[2], SHEET_CALLS[6], SHEET_CALLS[7]], "threw", null, SHEET_UNAVAILABLE, []),
    "action-sheet/With valid arguments showActionSheetWithOptions, showShareActionSheetWithOptions and dismissActionSheet throw ActionSheetManager doesn't exist")

  var statics_calls: Array = array(value.get("calls", [])).filter(func(entry: Dictionary) -> bool: return entry.label == "push-statics")
  normative(statics_calls.size() == 15 and statics_calls.all(threw_unavailable),
    "push/Fifteen static methods of PushNotificationIOS throw PushNotificationManager is not available.")
  normative(matches(call_of(value, PUSH_CALLS[0]), "threw", null, "Must provide a valid callback", []),
    "push/checkPermissions validates its callback before the missing module")
  var events := "PushNotificationIOS only supports `notification`, `register`, `registrationError`, and `localNotification` events"
  normative(matches(call_of(value, PUSH_CALLS[1]), "threw", null, events, []) and matches(call_of(value, PUSH_CALLS[4]), "threw", null, events, [])
    and matches(call_of(value, PUSH_CALLS[2]), "returned", null, null, []) and matches(call_of(value, PUSH_CALLS[3]), "returned", null, null, [])
    and dictionary(dictionary(statics.get("push", {})).get("fetchResult", {})).size() == 3,
    "push/addEventListener and removeEventListener run in JS for RN's four events and reject any other; FetchResult is RN's")

  var drawer := dictionary(data.A.drawer)
  var methods: Array = array(drawer.get("names", []))
  normative(drawer.get("mounted") == true and methods == ["openDrawer", "closeDrawer", "blur", "focus", "measure", "measureInWindow", "measureLayout", "setNativeProps"]
    and methods.all(func(name: String) -> bool: return matches(call_of(value, "DrawerLayoutAndroid." + name), "threw", null, DRAWER_UNAVAILABLE, [])),
    "drawer/The eight methods of the mounted DrawerLayoutAndroid throw it is only available on Android")

  var touchable := dictionary(statics.get("touchable", {}))
  var selectable := dictionary(touchable.get("selectable", {}))
  var borderless := dictionary(touchable.get("borderless", {}))
  var ripple := dictionary(touchable.get("ripple", {}))
  normative(array(touchable.get("sameStatics", [])).size() == 4 and array(touchable.get("sameStatics", [])).all(func(row: Array) -> bool: return row[1] == true)
    and selectable.get("type") == "ThemeAttrAndroid" and selectable.get("attribute") == "selectableItemBackground" and selectable.get("rippleRadius") == 4.0
    and borderless.get("attribute") == "selectableItemBackgroundBorderless" and ripple.get("type") == "RippleAndroid" and ripple.get("borderless") == true
    and ripple.get("rippleRadius") == 5.0 and touchable.get("canUseNativeForeground") == false,
    "native-feedback/The four statics are RN's own: SelectableBackground, SelectableBackgroundBorderless and Ripple describe a drawable, canUseNativeForeground is false")
  normative(["native-feedback", "native-feedback-foreground", "native-feedback-default"].all(func(id: String) -> bool: return clean_feedback(value, id)),
    "native-feedback/No native background or foreground prop reaches the host view, with a ripple, with useForeground and by default; Pressability's handlers do")

  var counts := dictionary(native(apps.A).get("nativeModules", {}))
  check(array(native(apps.A).get("errors", [])).is_empty() and int(counts.get("staleCalls", -1)) == 0,
    "calls/No call of these APIs left a host or runtime diagnostic")
  var modules := dictionary(data.A.hostModules)
  check(HOST_MODULES.all(func(name: String) -> bool: return absent_module(modules, name)) and modules.size() == HOST_MODULES.size(),
    "host/The host registers none of ToastAndroid, PermissionsAndroid, ActionSheetManager, DialogManagerAndroid, PushNotificationManager and StatusBarManager: get is null and getEnforcing throws")

# ---------------------------------------------------------------- presses
func send(device: String, phase: String, at: Vector2) -> void:
  if device == "mouse":
    if phase == "down":
      var motion := InputEventMouseMotion.new()
      motion.device = DEVICE
      motion.position = at
      Input.parse_input_event(motion)
    var button := InputEventMouseButton.new()
    button.device = DEVICE
    button.position = at
    button.button_index = MOUSE_BUTTON_LEFT
    button.pressed = phase == "down"
    button.button_mask = MOUSE_BUTTON_MASK_LEFT if phase == "down" else 0
    Input.parse_input_event(button)
  else:
    var contact := InputEventScreenTouch.new()
    contact.device = DEVICE
    contact.index = 0
    contact.position = at
    contact.pressed = phase == "down"
    Input.parse_input_event(contact)

func take_events() -> Array:
  return array(js("A", "take()"))

func pointer(app_name: String) -> Dictionary:
  return dictionary(native(surfaces[app_name]).get("pointer", {}))

func press_stage() -> void:
  var before := pointer("A")
  var presses := {}
  for device: String in ["mouse", "touch"]:
    var at: Vector2 = ORIGINS.A + FEEDBACK
    send(device, "down", at)
    await settle()
    var down := take_events()
    var held := pointer("A")
    send(device, "up", at)
    await settle()
    var released := take_events()
    presses[device] = {"down": down, "up": released, "held": held, "after": pointer("A")}
  var after := pointer("A")
  var rows: Array = []
  for device: String in ["mouse", "touch"]:
    rows.append_array(array(presses[device].down))
    rows.append_array(array(presses[device].up))
  var kinds := rows.map(func(row: Dictionary) -> String: return row.type)
  normative(kinds == ["in", "out", "press", "in", "out", "press"] and rows.all(func(row: Dictionary) -> bool: return row.id == "A-native-feedback"),
    "press/A real mouse press and a real touch each give onPressIn on contact, then onPressOut and onPress on release, as Pressability orders them")
  normative(int(after.get("grants", -1)) - int(before.get("grants", -1)) == 2 and int(after.get("releases", -1)) - int(before.get("releases", -1)) == 2
    and int(after.get("responder", -1)) == 0 and int(after.get("activeTouches", -1)) == 0,
    "press/Both presses were granted to the touchable and released with no responder or touch left")
  var value := state_of("A")
  normative(array(native(apps.A).get("errors", [])).is_empty() and clean_feedback(value, "native-feedback"),
    "press/The press reaches the host with no native background and no native command: the host reports no error")
  data.A.press = {"before": before, "after": after, "presses": presses}
  data.A.final = {"js": value, "native": native(surfaces.A), "application": native(apps.A)}

# ---------------------------------------------------------------- second application
func second_application_stage() -> void:
  for api: String in ["ToastAndroid", "ProgressBarAndroid", "PushNotificationIOS"]:
    run_js("B", "read(%s)" % JSON.stringify(api))
  await run_calls("B", "toast", [TOAST[0]])
  await run_calls("B", "permissions", [PERMISSION_CALLS[0]])
  var value := state_of("B")
  var warnings: Array = array(value.get("warnings", []))
  var notices := warnings.filter(is_notice)
  normative(notices.size() == 3 and matches(call_of(value, TOAST[0]), "returned", null, null, [TOAST_WARNING])
    and matches(call_of(value, PERMISSION_CALLS[0]), "resolved", false, null, [PLATFORM_WARNING]),
    "application-b/A second application prints each one-time notice again, once, in its own runtime, and its calls behave the same")
  data.B.final = {"js": value, "native": native(surfaces.B), "application": native(apps.B)}

# ---------------------------------------------------------------- stop
func stop_stage() -> void:
  apps.A.call("stop")
  apps.B.call("stop")
  await settle()
  # Nothing here needs a host module, so the APIs outlive the application.
  run_js("A", "read('ToastAndroid')")
  await run_calls("A", "after-stop", [TOAST[0], PERMISSION_CALLS[0], "DynamicColorIOS"])
  var value := state_of("A")
  var after: Array = array(value.get("calls", [])).filter(func(entry: Dictionary) -> bool: return entry.label == "after-stop")
  # A promise is not settled once the runtime has stopped, because the host drains no more jobs: the warning it printed
  # before returning it is what stays observable.
  normative(after.size() == 3 and matches(after[0], "returned", null, null, [TOAST_WARNING])
    and array(dictionary(after[1]).get("warnings", [])) == [PLATFORM_WARNING]
    and matches(after[2], "threw", null, "DynamicColorIOS is not available on this platform.", []),
    "stop/After stop the synchronous parts of the APIs behave as before: they need no host module, so nothing throws E_MODULE_DISPOSED")
  var stopped := native(apps.A)
  var balanced := true
  for app_name: String in ["A", "B"]:
    var root_state := native(surfaces[app_name])
    balanced = balanced and int(root_state.get("nativeTags", -1)) == 0 and int(root_state.get("creates", -1)) == int(root_state.get("deletes", -2))
  check(stopped.get("stopped") == true and int(stopped.get("rootCount", -1)) == 0 and array(stopped.get("errors", [])).is_empty() and balanced,
    "stop/Stop releases both roots and balances every native view without a diagnostic")
  data.A.afterStop = {"js": value, "application": stopped}

func _initialize() -> void:
  var arguments := OS.get_cmdline_user_args()
  allow_previous_sdk = arguments.has("--allow-previous-sdk")
  sabotage = arguments.has("--sabotage")
  for argument: String in arguments:
    if argument.begins_with("--bundle="):
      bundle_file = argument.substr(9)
  call_deferred("run_probe")

func run_probe() -> void:
  root.size = Vector2i(900, 400)
  make_application("A")
  make_application("B")
  await settle(14)
  mount_stage()
  await reads_stage()
  await calls_stage()
  await press_stage()
  await second_application_stage()
  await stop_stage()
  for surface: Control in surfaces.values():
    surface.queue_free()
  for application: Node in apps.values():
    application.queue_free()
  await settle(2)
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var observed := failures.duplicate()
  var expected := expected_previous_failures.duplicate()
  observed.sort()
  expected.sort()
  var previous_observed := allow_previous_sdk and observed == expected and not failures.is_empty()
  var sabotage_observed := sabotage and not failures.is_empty()
  var report := {"scenario": "native-os-contracts", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "bundle": bundle_file, "checks": checks, "apps": data,
    "expectedPreviousSdkFailures": expected_previous_failures, "allowPreviousSdk": allow_previous_sdk,
    "previousSdkObserved": previous_observed, "sabotage": sabotage, "allCurrentAssertionsPassed": failures.is_empty(),
    "scope": {"publicReactNativeImport": true, "realHostRegistry": true, "twoApplications": true, "realMouseAndTouch": true,
      "androidOrIosBehaviorCertified": false, "nativeCodeInThisSlice": false}}
  var output := FileAccess.open("res://build/os-contracts-report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_ERROR: cannot write the OS contracts report")
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  output.close()
  if previous_observed:
    print("OS_CONTRACTS_PREVIOUS_SDK: " + str(failures.size()))
  elif sabotage_observed:
    print("OS_CONTRACTS_SABOTAGE_REJECTED: " + str(failures.size()))
  elif failures.is_empty():
    print("OS_CONTRACTS_PASSED: " + str(checks.size()))
  else:
    print("OS_CONTRACTS_FAILED")
  quit(0 if failures.is_empty() or previous_observed or sabotage_observed else 1)
