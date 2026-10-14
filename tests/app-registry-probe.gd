extends SceneTree

# The public AppRegistry facade in the real host. The fixture runs a script of registry calls when its bundle loads; this probe
# then mounts actual FabricSurface roots of one FabricApplication and drives the surface members from JS and from Godot:
# the wrapper, root view style and instrumentation providers, setSurfaceProps, runApplication, the registered runnables and
# sections, the unmount RN's Fabric logs an error for, and the stop of a root. Native facts (the Controls of a root, its
# style, its geometry, the root count) are read from the application's own snapshot, never from JS.
# Lanes: current (every check passes) and sabotage (a retained sabotage broke the SDK, so at least one check must fail).
const SURFACE := Vector2(240, 120)
const ROOT_PADDING := 8.0
const WRAPPER_PADDING := 6.0
const ROOT_RADIUS := 12.0
const REFUSED := "AppRegistry component key is already registered or reserved: "
const UNMOUNT_ERROR := "Unexpected call to unmountApplicationComponentAtRootTag in Fabric."
const HEADLESS := ["registerHeadlessTask", "registerCancellableHeadlessTask", "startHeadlessTask", "cancelHeadlessTask"]
const MEMBERS := ["cancelHeadlessTask", "getAppKeys", "getRegistry", "getRunnable", "getSectionKeys", "getSections",
  "registerCancellableHeadlessTask", "registerComponent", "registerConfig", "registerHeadlessTask", "registerRunnable",
  "registerSection", "runApplication", "setComponentProviderInstrumentationHook", "setRootViewStyleProvider", "setSurfaceProps",
  "setWrapperComponentProvider", "startHeadlessTask", "unmountApplicationComponentAtRootTag"]

var application: Node
var surfaces := {}
var tags := {}
var checks: Array = []
var stages := {}
var lane := "current"

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

func settle(count := 6) -> void:
  for index in range(count):
    await process_frame

# Until a condition holds, polled one frame at a time. A hosted runner delivers slow, bursty frames, so what React commits is waited for,
# never counted in frames; only a check that nothing happens settles for a fixed number.
func until(condition: Callable, limit_ms := 5000) -> bool:
  var started := Time.get_ticks_msec()
  while Time.get_ticks_msec() - started < limit_ms and not condition.call():
    await process_frame
  return condition.call()

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(AppRegistryProbe." + expression + ")"))

func native() -> Dictionary:
  return JSON.parse_string(application.call("snapshot"))

func surface_state(name: String) -> Dictionary:
  return JSON.parse_string(surfaces[name].call("snapshot"))

func mount(name: String, component: String, props: Dictionary) -> void:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = name
  surface.position = Vector2(260 * surfaces.size(), 0)
  surface.size = SURFACE
  surface.set("application_path", NodePath("../RegistryApplication"))
  surface.set("component_name", component)
  surface.set("initial_props", props)
  surfaces[name] = surface
  root.add_child(surface)
  await until(func() -> bool: return int(surface.call("get_surface_id")) > 0 and not node(name, "registry-content").is_empty())
  await settle(2)
  tags[name] = int(surface.call("get_surface_id"))

# The native Control of a node of a root: by testID, and the root View, which is the one without a testID.
func node(name: String, test_id: String) -> Dictionary:
  for entry: Dictionary in surface_state(name).nodes:
    if entry.testID == test_id:
      return entry
  return {}

func box(entry: Dictionary) -> Array:
  return [float(entry.get("x", -1)), float(entry.get("y", -1)), float(entry.get("width", -1)), float(entry.get("height", -1))]

func background(entry: Dictionary) -> String:
  return str(entry.get("appearance", {}).get("background", ""))

func row(script: Array, id: String) -> Dictionary:
  for entry: Dictionary in script:
    if entry.id == id:
      return entry
  return {}

func returned(script: Array, id: String) -> Variant:
  return row(script, id).get("returned")

# What a call threw, as data: empty when it did not throw, so that a check fails instead of the script.
func threw(entry: Dictionary) -> Dictionary:
  return entry.get("threw", {})

func message(entry: Dictionary) -> String:
  return str(threw(entry).get("message", ""))

func refused(script: Array, id: String, key: String) -> bool:
  var entry := row(script, id)
  return entry.has("threw") and message(entry) == REFUSED + key and entry.threw.isError and not entry.threw.isTypeError

func rejected_input(script: Array, id: String) -> bool:
  var entry := row(script, id)
  return entry.has("threw") and entry.threw.isTypeError

func renders_of(snapshot: Dictionary, component: String) -> Array:
  return snapshot.renders.filter(func(entry: Dictionary) -> bool: return entry.component == component)

# The Plain component's effects for the given labels, in order, as [event, label].
func effects_of(snapshot: Dictionary, labels: Array) -> Array:
  var list: Array = []
  for effect: Dictionary in snapshot.effects:
    if effect.component == "Plain" and labels.has(effect.label):
      list.append([effect.event, effect.label])
  return list

func last_render(snapshot: Dictionary, component: String) -> Dictionary:
  var list := renders_of(snapshot, component)
  return list[list.size() - 1] if not list.is_empty() else {}

func run_probe() -> void:
  root.size = Vector2i(1000, 140)
  application = ClassDB.instantiate("FabricApplication")
  application.name = "RegistryApplication"
  application.set("bundle_path", "res://build/app-registry-probe.js")
  root.add_child(application)

  # Root A mounts before any provider is set: RN's defaults.
  await mount("A", "Plain", {"label": "A"})
  var initial: Dictionary = js("initial()")
  var script: Array = js("script()")
  var snapshot: Dictionary = js("snapshot()")
  stages.initial = initial
  stages.script = script
  stages.mountA = {"snapshot": snapshot, "nodes": surface_state("A").nodes, "tag": tags.A}
  check((initial.frozen and initial.members == MEMBERS and initial.memberTypes.values().all(func(kind: String) -> bool: return kind == "function")),
    "facade/The facade is frozen and exposes exactly RN's nineteen AppRegistry members as functions")
  check(initial.keysAtEvaluation.is_empty(),
    "facade/Nothing is registered when the bundle loads: the facade imports AppRegistryImpl, which registers no LogBox")

  var created := [returned(script, "reg-plain"), returned(script, "reg-counter"), returned(script, "reg-menu"), returned(script, "reg-hub"),
    returned(script, "reg-custom"), returned(script, "reg-config")]
  check(created == ["Plain", "Counter", null, "Hub", "Custom", null] and not row(script, "reg-plain").has("threw"),
    "registry/registerComponent and registerRunnable return the key, registerSection and registerConfig return nothing")
  var keys: Array = returned(script, "keys")
  check(keys == ["Plain", "Counter", "Menu", "Hub", "Custom", "CfgComponent", "CfgRun", "CfgSection", "Early"],
    "registry/getAppKeys lists every registered key in registration order, the first entry of the failed config included")
  var partial := row(script, "reg-config-partial")
  check((partial.has("threw") and partial.threw.name == "Invariant Violation" and message(partial).contains("`Neither` has neither")
    and not partial.threw.isTypeError and partial.threw.code == null),
    "registry/A config with neither run nor component fails with RN's own invariant after the entry before it")
  check(returned(script, "section-keys") == ["Menu", "Hub", "CfgSection"],
    "registry/A section is registerSection, a true section flag or a config's section; a false flag is not")
  var sections: Dictionary = returned(script, "sections")
  check(sections.keys == ["Menu", "Hub", "CfgSection"] and sections.same == [true, true, true],
    "registry/getSections answers the sections with the very runnables getRunnable answers")
  var registry: Dictionary = returned(script, "registry")
  check((registry.sections == ["Menu", "Hub", "CfgSection"] and registry.runnables == keys
    and registry.same.all(func(same: bool) -> bool: return same)),
    "registry/getRegistry answers the section keys and every runnable, the same functions getRunnable answers")
  check((returned(script, "runnable-plain").type == "function" and returned(script, "runnable-section").type == "function"
    and returned(script, "runnable-missing").type == "undefined" and returned(script, "runnable-inherited").type == "undefined"),
    "registry/getRunnable answers a function for a registered key and undefined for an unknown or an inherited name")
  check(returned(script, "copies").unchanged, "registry/The answers of the getters are copies: changing them changes nothing")

  check((refused(script, "dup-component", "Plain") and refused(script, "dup-section", "Plain") and refused(script, "dup-runnable", "Plain")
    and refused(script, "dup-config", "Plain") and refused(script, "dup-config-twice", "Twice") and refused(script, "dup-section-flag", "Menu")),
    "diagnostics/A key registered once is refused again through component, section, runnable and config, and twice in one config")
  check((refused(script, "reserved-component", "__proto__") and refused(script, "reserved-runnable", "constructor")
    and refused(script, "reserved-section", "prototype") and refused(script, "reserved-config", "__proto__")),
    "diagnostics/The reserved keys __proto__, constructor and prototype are refused through every route")
  check((rejected_input(script, "empty-key") and rejected_input(script, "blank-key") and rejected_input(script, "number-key")
    and rejected_input(script, "no-provider") and rejected_input(script, "no-run") and rejected_input(script, "config-not-array")
    and rejected_input(script, "config-bad-entry")),
    "diagnostics/An empty, blank or non-string key, a missing provider or run function and a malformed config fail with a TypeError")
  check(returned(script, "keys-after-refusals") == keys,
    "diagnostics/The refusals register nothing: a refused config leaves none of its entries behind")

  var headless_ok := true
  for member: String in HEADLESS:
    var found := row(script, "headless-" + {"registerHeadlessTask": "register", "registerCancellableHeadlessTask": "register-cancellable",
      "startHeadlessTask": "start", "cancelHeadlessTask": "cancel"}[member])
    headless_ok = (headless_ok and found.has("threw") and found.threw.code == "E_APP_REGISTRY_HEADLESS_TASK" and found.threw.isError
      and message(found).begins_with("E_APP_REGISTRY_HEADLESS_TASK: AppRegistry." + member + " is not implemented")
      and not found.threw.isTypeError)
  check(headless_ok, "headless/The four headless-task members fail with E_APP_REGISTRY_HEADLESS_TASK, an Error that names the member")
  check((returned(script, "keys-after-headless") == keys and snapshot.errors.is_empty() and snapshot.warnings.is_empty()
    and snapshot.logs == ["Running \"Plain\""]),
    "headless/A headless call registers nothing, starts nothing and logs nothing: RN's own warning for a repeated task never appears")

  # Mount A, before the providers.
  var render_a := last_render(snapshot, "Plain")
  check((render_a.label == "A" and render_a.props == ["label", "rootTag"] and int(render_a.rootTagProp) == tags.A
    and int(render_a.rootTagContext) == tags.A and tags.A > 0),
    "mount-A/The root's component gets its props and the root tag, and RootTagContext carries the same tag")
  var root_a := node("A", "")
  var content_a := node("A", "registry-content")
  check((box(root_a) == [0.0, 0.0, SURFACE.x, SURFACE.y] and background(root_a) == "00000000" and node("A", "registry-wrapper").is_empty()
    and box(content_a) == [0.0, 0.0, 100.0, 40.0]),
    "mount-A/Without providers the root View is RN's default (it fills the surface, no background) and nothing wraps the content")

  # The providers, set while root A is running, apply from the next run.
  var providers: Dictionary = js("install()")
  stages.install = providers
  var before_install: Dictionary = snapshot.calls
  check(before_install.wrapper.is_empty() and before_install.style.is_empty() and before_install.hook.is_empty(),
    "providers/Setting the providers calls none of them: they apply when a runnable runs")

  await mount("B", "Counter", {"label": "B"})
  snapshot = js("snapshot()")
  var root_b := node("B", "")
  var wrapper_b := node("B", "registry-wrapper")
  var content_b := node("B", "registry-content")
  stages.mountB = {"snapshot": snapshot, "nodes": surface_state("B").nodes, "tag": tags.B, "providers": providers}
  check((box(root_b) == [0.0, 0.0, SURFACE.x, SURFACE.y] and background(root_b) == "0f172aff"
    and root_b.appearance.cornerRadii == [ROOT_RADIUS, ROOT_RADIUS, ROOT_RADIUS, ROOT_RADIUS]),
    "mount-B/The root view style provider's style is on the root's native Control: background, corner radius and full size")
  check((box(wrapper_b) == [ROOT_PADDING, ROOT_PADDING, SURFACE.x - 2.0 * ROOT_PADDING, SURFACE.y - 2.0 * ROOT_PADDING]
    and background(wrapper_b) == "1e293bff"
    and box(content_b) == [ROOT_PADDING + WRAPPER_PADDING, ROOT_PADDING + WRAPPER_PADDING, 100.0, 40.0]),
    "mount-B/The wrapper provider's component wraps the content inside the root's padding, and the content sits inside the wrapper's")
  check((snapshot.calls.wrapper.size() == 1 and snapshot.calls.wrapper[0].appKey == "Counter" and int(snapshot.calls.wrapper[0].rootTag) == tags.B
    and snapshot.calls.wrapper[0].initialProps == {"label": "B"} and snapshot.calls.style.size() == 1
    and int(snapshot.calls.style[0].rootTag) == tags.B and snapshot.calls.wrapperRenders == [{"keys": ["label"], "label": "B"}]),
    "mount-B/The wrapper provider gets the appParameters and the key, the style provider the appParameters, the wrapper the initialProps")
  check((snapshot.calls.hook == [{"providerType": "function", "loggerType": "object", "loggerHasGetExtras": true}]
    and snapshot.calls.instrumentedRenders == [{"inner": "Counter", "label": "B"}] and last_render(snapshot, "Counter").label == "B"),
    "mount-B/The instrumentation hook gets the provider and RN's logger, and the component it returns renders the root's component")

  # setSurfaceProps from JS on the running root: new props, same component state.
  var instance_before := int(last_render(snapshot, "Counter").instance)
  var set_result: Dictionary = js("setProps('Counter', %d, {label: 'B2'})" % tags.B)
  await until(func() -> bool: return last_render(js("snapshot()"), "Counter").get("label") == "B2")
  snapshot = js("snapshot()")
  var render_b2 := last_render(snapshot, "Counter")
  stages.setProps = {"result": set_result, "snapshot": snapshot}
  check((not set_result.has("threw") and render_b2.label == "B2" and int(render_b2.instance) == instance_before and int(render_b2.rootTagProp) == tags.B
    and snapshot.effects.filter(func(effect: Dictionary) -> bool: return effect.component == "Counter" and effect.event == "cleanup").is_empty()),
    "set-props/setSurfaceProps updates the running root's props and keeps its component state: no remount, no cleanup")
  check((snapshot.logs.has("Updating props for Surface \"Counter\" with {\"rootTag\":%d,\"initialProps\":{\"label\":\"B2\"}}" % tags.B)
    and snapshot.calls.wrapper.size() == 2 and snapshot.calls.wrapper[1].initialProps == {"label": "B2"} and snapshot.calls.style.size() == 2
    and snapshot.calls.hook.size() == 2),
    "set-props/RN logs the update, and the providers and the hook run again for the new run")

  var run_result: Dictionary = js("runApp('Counter', %d, {label: 'B3'})" % tags.B)
  await until(func() -> bool: return last_render(js("snapshot()"), "Counter").get("label") == "B3")
  snapshot = js("snapshot()")
  var render_b3 := last_render(snapshot, "Counter")
  stages.runApplication = {"result": run_result, "snapshot": snapshot}
  check((not run_result.has("threw") and render_b3.label == "B3" and int(render_b3.instance) == instance_before
    and snapshot.logs.has("Running \"Counter\"") and snapshot.logs.filter(func(line: String) -> bool: return line == "Running \"Counter\"").size() == 2),
    "run-application/runApplication on a running surface runs its component again with the new props, state kept")

  # The host's own path through RN's binding reaches the same root.
  surfaces.B.call("update_props", {"label": "B4"})
  await until(func() -> bool: return last_render(js("snapshot()"), "Counter").get("label") == "B4")
  snapshot = js("snapshot()")
  var render_b4 := last_render(snapshot, "Counter")
  stages.hostUpdate = {"snapshot": snapshot}
  check(render_b4.label == "B4" and int(render_b4.instance) == instance_before and snapshot.calls.wrapper.size() == 4,
    "host-update/FabricSurface.update_props reaches the same root through RN's own binding, and the providers apply to it too")

  # A root that was already running takes the providers at its next run.
  var rerun: Dictionary = js("setProps('Plain', %d, {label: 'A2'})" % tags.A)
  await until(func() -> bool: return effects_of(js("snapshot()"), ["A", "A2"]).size() == 3 and not node("A", "registry-wrapper").is_empty())
  snapshot = js("snapshot()")
  var wrapper_a := node("A", "registry-wrapper")
  stages.rerunA = {"result": rerun, "snapshot": snapshot, "nodes": surface_state("A").nodes}
  check((not rerun.has("threw") and background(node("A", "")) == "0f172aff" and not wrapper_a.is_empty()
    and box(node("A", "registry-content")) == [ROOT_PADDING + WRAPPER_PADDING, ROOT_PADDING + WRAPPER_PADDING, 100.0, 40.0]
    and effects_of(snapshot, ["A", "A2"]) == [["mount", "A"], ["cleanup", "A"], ["mount", "A2"]]),
    "rerun-A/A root that was running takes the providers at its next run: the style and the wrapper appear, and the hook's component remounts the content")

  # Registered runnables, a section and a registration after the roots exist.
  await mount("C", "Custom", {"label": "C"})
  await mount("D", "Menu", {"label": "D"})
  await mount("E", "CfgRun", {"label": "E"})
  snapshot = js("snapshot()")
  var runs: Array = snapshot.calls.run
  stages.runnables = {"snapshot": snapshot, "tags": tags}
  check((runs.size() == 2 and int(runs[0].rootTag) == tags.C and runs[0].initialProps == {"label": "C"} and runs[0].fabric == true
    and int(runs[0].displayMode) == 1 and int(runs[1].rootTag) == tags.E and runs[1].initialProps == {"label": "E"}),
    "runnables/A runnable registered by registerRunnable or by a config's run gets the host's appParameters and display mode")
  check((not node("C", "registry-content").is_empty() and not node("D", "registry-content").is_empty()
    and not node("E", "registry-content").is_empty() and tags.D > 0 and int(native().rootCount) == 5),
    "runnables/A runnable that draws through a registered component, and a section, mount as roots like any component")
  var late: Dictionary = js("late('Late')")
  await mount("F", "Late", {"label": "F"})
  check(not late.has("threw") and late.returned == "Late" and not node("F", "registry-content").is_empty(),
    "runnables/A component registered after the roots exist mounts at once")

  # Surface members that cannot work.
  var before_unknown: Dictionary = js("snapshot()")
  var rendered: int = before_unknown.renders.size()
  var unknown_run: Dictionary = js("runApp('Plain', 99999, {label: 'x'})")
  var unknown_props: Dictionary = js("setProps('Plain', 99999, {label: 'x'})")
  await settle()
  snapshot = js("snapshot()")
  stages.unknownRoot = {"run": unknown_run, "props": unknown_props, "rendersBefore": rendered, "snapshot": snapshot}
  check((threw(unknown_run).get("code") == "E_APP_REGISTRY_UNKNOWN_ROOT" and threw(unknown_props).get("code") == "E_APP_REGISTRY_UNKNOWN_ROOT"
    and message(unknown_run).contains("99999") and threw(unknown_run).get("isError", false) and snapshot.renders.size() == rendered
    and int(native().rootCount) == 6 and native().errors.is_empty()),
    "unknown-root/runApplication and setSurfaceProps for a tag no surface owns fail with E_APP_REGISTRY_UNKNOWN_ROOT and render nothing")
  var missing: Dictionary = js("setProps('Nope', %d, {label: 'x'})" % tags.B)
  check((threw(missing).get("name") == "Invariant Violation" and message(missing).contains("\"Nope\" has not been registered")
    and threw(missing).has("code") and threw(missing).code == null),
    "unknown-root/An unregistered key on a running surface fails with RN's own invariant")
  var suspended: Dictionary = js("setProps('Counter', %d, {label: 'B5'}, 2)" % tags.B)
  await settle()
  snapshot = js("snapshot()")
  check((message(suspended) == "Godot AppRegistry does not implement suspended/hidden display modes"
    and last_render(snapshot, "Counter").label == "B4"),
    "display-mode/A suspended display mode is refused (the pause and resume slice owns it) and leaves the root unchanged")
  var unmount_call: Dictionary = js("unmount(%d)" % tags.B)
  await settle()
  stages.unmountApi = {"result": unmount_call, "nodes": surface_state("B").nodes, "rootCount": native().rootCount}
  check((not unmount_call.has("threw") and unmount_call.errors == [UNMOUNT_ERROR] and not node("B", "registry-content").is_empty()
    and int(native().rootCount) == 6 and surfaces.B.call("get_surface_id") == tags.B),
    "unmount-api/unmountApplicationComponentAtRootTag logs RN's error and unmounts nothing: the root stays until the host stops it")

  # The host stops a root: its tag stops being a surface.
  surfaces.A.call("unmount")
  await until(func() -> bool: return (surfaces.A.call("get_surface_id") == 0 and int(native().rootCount) == 5
    and effects_of(js("snapshot()"), ["A", "A2"]).size() == 4))
  snapshot = js("snapshot()")
  var rendered_before_stale: int = snapshot.renders.size()
  var stale: Dictionary = js("setProps('Plain', %d, {label: 'late'})" % tags.A)
  await settle()
  var after_stale: Dictionary = js("snapshot()")
  stages.stopA = {"snapshot": snapshot, "stale": stale, "rendersBefore": rendered_before_stale, "rendersAfter": after_stale.renders.size()}
  check((effects_of(snapshot, ["A", "A2"]) == [["mount", "A"], ["cleanup", "A"], ["mount", "A2"], ["cleanup", "A2"]]
    and int(native().rootCount) == 5 and surfaces.A.call("get_surface_id") == 0),
    "stop-A/FabricSurface.unmount stops the root: React's cleanup runs once for its content and the root count drops")
  check(threw(stale).get("code") == "E_APP_REGISTRY_UNKNOWN_ROOT" and after_stale.renders.size() == rendered_before_stale,
    "stop-A/The stopped root's tag is no surface any more: running it again fails and renders nothing")
  var live: Dictionary = js("setProps('Counter', %d, {label: 'B6'})" % tags.B)
  await until(func() -> bool: return last_render(js("snapshot()"), "Counter").get("label") == "B6")
  check(not live.has("threw") and last_render(js("snapshot()"), "Counter").label == "B6",
    "stop-A/The other roots keep running and keep updating")

  stages.final = {"snapshot": js("snapshot()"), "tags": tags, "surface": {"width": SURFACE.x, "height": SURFACE.y},
    "rootCount": native().rootCount}
  await stop_case()
  await finish()

func stop_case() -> void:
  application.call("stop")
  await until(func() -> bool: return native().stopped and int(native().rootCount) == 0)
  var stopped := native()
  check(stopped.stopped and int(stopped.rootCount) == 0 and stopped.errors.is_empty(),
    "stop/Stopping the application releases every root without a diagnostic")
  var balanced := true
  for name: String in surfaces:
    var state := surface_state(name)
    balanced = balanced and int(state.nativeTags) == 0 and int(state.creates) == int(state.deletes)
  check(balanced, "stop/Every root's native Controls are created and deleted in balance")
  stages.stop = {"application": stopped}

func finish() -> void:
  for surface: Control in surfaces.values():
    surface.queue_free()
  application.queue_free()
  await settle(2)
  var failures: Array = checks.filter(func(entry: Dictionary) -> bool: return not entry.passed).map(func(entry: Dictionary) -> String: return entry.name)
  var report := {"scenario": "native-app-registry", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "lane": lane, "checks": checks, "stages": stages,
    "sabotageRejected": lane == "sabotage" and not failures.is_empty(), "allCurrentAssertionsPassed": failures.is_empty(),
    "scope": {"publicReactNativeImport": true, "originalAppRegistryImpl": true, "actualFabricSurfaces": true, "oneApplication": true,
      "headlessTasksTypedError": true, "rootReplacementCertified": false, "pauseResumeCertified": false, "errorCleanupCertified": false,
      "mobileExportsCertified": false}}
  var output := FileAccess.open("res://build/app-registry-report.json", FileAccess.WRITE)
  if not check(output != null, "report/The AppRegistry report is saved with any failure visible"):
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  output.close()
  if lane == "sabotage":
    print("APP_REGISTRY_SABOTAGE_REJECTED: " + str(failures.size()) if not failures.is_empty() else "APP_REGISTRY_SABOTAGE_ACCEPTED")
    quit(0 if not failures.is_empty() else 1)
  else:
    print("APP_REGISTRY_PASSED: " + str(checks.size()) if failures.is_empty() else "APP_REGISTRY_FAILED")
    quit(0 if failures.is_empty() else 1)

func _initialize() -> void:
  var arguments := OS.get_cmdline_user_args()
  var at := arguments.find("--lane")
  if at >= 0 and at + 1 < arguments.size():
    lane = arguments[at + 1]
  call_deferred("run_probe")
