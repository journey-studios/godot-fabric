extends SceneTree

const DEVICE := 1001
const MODES := ["disabled", "imperative-only", "internal-only", "enabled"]
var checks: Array = []
var gaps: Array = []
var applications: Dictionary = {}
var surfaces: Dictionary = {}
var capabilities: Dictionary = {}
var stages: Dictionary = {}

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

func expected_gap(condition: bool, id: String, details: Dictionary) -> void:
  gaps.append({"id": id, "observed": condition, "status": "original-gap-observed" if condition else "expected-gap-not-reproduced", "details": details})
  check(condition, "EXPECTED_GAP: " + id)

func settle() -> void:
  for index in range(8):
    await process_frame

func native(owner: Node) -> Dictionary:
  var value: Variant = JSON.parse_string(owner.call("snapshot"))
  return value if value is Dictionary else {}

func js(mode: String, expression: String) -> Variant:
  return JSON.parse_string(applications[mode].call("evaluate", "JSON.stringify(EventTargetProbe." + expression + ")"))

func state(mode: String = "enabled") -> Dictionary:
  var value: Variant = js(mode, "snapshot()")
  return value if value is Dictionary else {}

func application(mode: String) -> Node:
  var owner: Node = ClassDB.instantiate("FabricApplication")
  owner.name = "EventTarget_" + mode.replace("-", "_")
  owner.set("bundle_path", "res://build/event-target-" + mode + ".js")
  root.add_child(owner)
  applications[mode] = owner
  return owner

func mount(name: String, owner: Node, position: Vector2, size: Vector2) -> void:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = name
  surface.position = position
  surface.size = size
  surface.set("application_path", NodePath("../" + str(owner.name)))
  surface.set("component_name", "EventTargetProbe")
  surface.set("initial_props", {"name": name})
  surface.set_meta("validation_input_device", DEVICE)
  surfaces[name] = surface
  root.add_child(surface)

func inject(pressed: bool, position: Vector2, index: int) -> void:
  var touch := InputEventScreenTouch.new()
  touch.device = DEVICE
  touch.position = position
  touch.index = index
  touch.pressed = pressed
  Input.parse_input_event(touch)
  await settle()

func _initialize() -> void:
  call_deferred("run_probe")

func run_probe() -> void:
  root.size = Vector2i(840, 530)
  for mode: String in MODES:
    application(mode)
  mount("A", applications.enabled, Vector2.ZERO, Vector2(360, 230))
  mount("B", applications.enabled, Vector2(420, 0), Vector2(360, 230))
  for index in range(3):
    mount(MODES[index], applications[MODES[index]], Vector2(index * 270, 270), Vector2(240, 230))
  await settle()

  for mode: String in MODES:
    var name := "A" if mode == "enabled" else mode
    var value: Variant = js(mode, "capability(%s)" % JSON.stringify(name))
    if not check(value is Dictionary, "Original ref capability probe is available: " + mode):
      continue
    var capability: Dictionary = value
    capabilities[mode] = capability
    var expected_public := mode == "enabled"
    var expected_base := mode in ["enabled", "internal-only"]
    check(capability.mode == mode and capability.originalElement and capability.originalEventTarget == expected_base,
      "Flag matrix chooses original ReadOnlyNode base at module evaluation: " + mode)
    check(capability.methods.values().all(func(type: String) -> bool: return type == ("function" if expected_public else "undefined")),
      "Flag matrix gates every public element EventTarget method: " + mode)
    check(capability.documentMethods.values().all(func(type: String) -> bool: return type == ("function" if expected_base else "undefined")),
      "Document capability follows its own original final class: " + mode)
    var rejection := "were accessed before being overridden" if mode == "disabled" else "cannot be overridden more than once"
    check(capability.globalsOriginal and str(capability.overrideRejection).contains(rejection),
      "Globals retain original constructors and late/repeated override is rejected: " + mode)
    check(capability.logicalFlatParent and not native(surfaces[name]).nodes.any(func(node: Dictionary) -> bool: return node.tag == capability.flatTag),
      "Original logical EventTarget ancestry includes a genuinely flattened View: " + mode)
  check(native(surfaces.A).runtimeId == native(surfaces.B).runtimeId and native(surfaces.A).surfaceId != native(surfaces.B).surfaceId,
    "Two enabled roots share actual Hermes and retain distinct native surface identities")

  if capabilities.get("enabled", {}).get("methods", {}).get("dispatchEvent") == "function":
    stages.manualA = js("enabled", "manual('A')")
    stages.manualB = js("enabled", "manual('B')")
    stages.crossRoots = js("enabled", "crossRoots('A','B')")

    # Positive manual delivery proves the imperative-only native control owns a
    # genuine working listener before either transport boundary is examined.
    var tags: Dictionary = js("enabled", "armNative('A')")
    check(js("enabled", "pokeOnly('A')") == true, "Imperative-only mounted Control supports manual Event dispatch")
    var poked := state()
    check(poked.imperative.size() == 1 and poked.imperative[0].id == "only" and poked.imperative[0].targetIsOriginalRef and not poked.imperative[0].trusted and poked.raw.is_empty() and poked.declarative.is_empty(),
      "Manual listener positive does not impersonate native RawEventEmitter or JSX input")
    js("enabled", "clearNative()")
    var before_only := native(surfaces.A)
    await inject(true, Vector2(60, 60), 41)
    var only := state()
    var after_only := native(surfaces.A)
    check(after_only.events > before_only.events and native(applications.enabled).pointerRouting.active == 1,
      "Real touch down is ingested into the native route even without JSX pointer listeners")
    expected_gap(only.raw.is_empty() and only.declarative.is_empty() and only.imperative.is_empty(), "native-interest", {
      "react": only, "nativeBefore": before_only, "nativeAfter": after_only, "tags": tags,
      "explanation": "Imperative-only pointerdown listener does not inform the original native ViewProps interest filter."})
    await inject(false, Vector2(60, 60), 41)
    check(native(applications.enabled).pointerRouting.active == 0, "Interest-negative contact releases through genuine touch up")

    js("enabled", "clearNative()")
    check(js("enabled", "pokeMixed('A')") == true, "Mixed mounted Control independently supports manual Event dispatch")
    var mixed_poked := state()
    check(mixed_poked.imperative.size() == 1 and mixed_poked.imperative[0].id == "mixed" and mixed_poked.imperative[0].targetIsOriginalRef and not mixed_poked.imperative[0].trusted and mixed_poked.raw.is_empty() and mixed_poked.declarative.size() == 1 and mixed_poked.declarative[0].target == null and mixed_poked.declarative[0].pointerId == null and not mixed_poked.declarative[0].trusted,
      "The exact mixed Control's imperative listener works before the native-dispatch negative")
    js("enabled", "clearNative()")
    await inject(true, Vector2(220, 60), 42)
    var mixed := state()
    check(mixed.raw.size() == 1 and mixed.declarative.size() == 1 and mixed.raw[0].target == tags.mixedTag and mixed.declarative[0].target == tags.mixedTag and mixed.raw[0].pointerId == mixed.declarative[0].pointerId,
      "Real JSX handler positively receives the same native pointer down observed by original RawEventEmitter")
    expected_gap(mixed.raw.size() == 1 and mixed.declarative.size() == 1 and mixed.imperative.is_empty(), "native-dispatch", {
      "react": mixed, "native": native(surfaces.A), "tags": tags,
      "explanation": "Native interest supplied by the second Control's functional JSX handler exposes the unchanged compiled legacy dispatcher; it does not call that same Control's EventTarget listener."})
    await inject(false, Vector2(220, 60), 42)
    check(state().currentPriority == state().defaultPriority, "Negative native cases restore original default event priority")
    stages.nativeInterest = {"react": only, "native": after_only}
    stages.nativeDispatch = {"react": mixed, "native": native(surfaces.A)}

    var primed: Dictionary = js("enabled", "primeCache('A')")
    check(primed.warmParent and primed.coldParent and primed.warmConnected and primed.coldConnected and primed.trace.size() == 2,
      "Parent-cache control starts with two connected refs but dispatches only the warm one")
    js("enabled", "removeCache('A')")
    await settle()
    var cache: Dictionary = js("enabled", "inspectCache('A')")
    check(not cache.warmConnected and not cache.coldConnected and cache.warmParentNull and cache.coldParentNull and cache.parentConnected,
      "Original NativeDOM reports current disconnection while former parent remains mounted")
    check(cache.coldStaleParentAbsent and cache.trace.any(func(entry: Dictionary) -> bool: return entry.id == "cold" and entry.at == "self" and entry.target),
      "Never-dispatched detached ref performs legal self-dispatch without a stale ancestor")
    expected_gap(cache.originalParentCacheObserved and cache.coldStaleParentAbsent, "original-parent-cache", {
      "primed": primed, "afterRemoval": cache,
      "explanation": "Original permanent parent cache propagates warm detached ref to an old ancestor; cold detached control does not."})
    stages.parentCache = cache

    var before_fault := native(applications.enabled)
    stages.publicFault = js("enabled", "publicFault('A')")
    await settle()
    var after_fault := native(applications.enabled)
    check(after_fault.errors.size() == before_fault.errors.size() + 1 and str(after_fault.errors.back()).contains("EventTarget deliberate public listener fault"),
      "Original public listener error arrives exactly once through real TimerManager after dispatch returns")
    check(state().currentPriority == state().defaultPriority and not after_fault.stopped,
      "Public timer fault preserves live runtime and default priority")
    stages.afterFault = after_fault
  else:
    check(false, "Enabled capability is required before exercising imperative contracts")

  var enabled_state := state()
  for entry: Dictionary in enabled_state.get("checks", []):
    check(entry.passed, entry.name)
  var after_stop := {}
  for mode: String in MODES:
    applications[mode].call("stop")
  await settle()
  for mode: String in MODES:
    var status := native(applications[mode])
    after_stop[mode] = status
    var expected_errors := 1 if mode == "enabled" else 0
    check(status.stopped and status.rootCount == 0 and status.pendingWork == 0 and status.pendingTimers == 0 and status.pendingAnimationFrames == 0 and status.errors.size() == expected_errors,
      "Isolated flag runtime stops all roots/timers with only the deliberate fault: " + mode)
  for name: String in surfaces:
    var status := native(surfaces[name])
    check(status.nativeTags == 0 and status.creates == status.deletes, "Probe retires all native nodes: " + name)
    surfaces[name].queue_free()
  for mode: String in MODES:
    applications[mode].queue_free()
  await settle()

  var file := FileAccess.open("res://build/event-target-report.json", FileAccess.WRITE)
  file.store_string(JSON.stringify({"scenario": "event-target-original-probe", "reactNative": "0.87.1",
    "godot": Engine.get_version_info().string, "displayServer": DisplayServer.get_name(), "checks": checks,
    "capabilities": capabilities, "stages": stages, "gaps": gaps, "afterStop": after_stop,
    "scope": {"manualDispatch": true, "publicDefaultEnabled": false, "nativeEventTargetIntegrated": false,
      "parentCacheFixed": false, "rendererOverlay": false}}, "  ") + "\n")
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  print("EVENT_TARGET_PROBE_FAILED" if failed else "EVENT_TARGET_PROBE_PASSED: " + str(checks.size()))
  quit(1 if failed else 0)
