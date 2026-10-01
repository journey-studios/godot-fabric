extends SceneTree

var checks: Array = []

func _initialize() -> void:
  call_deferred("run")

func check(condition: bool, message: String) -> void:
  checks.append({"name": message, "passed": condition})

func settle() -> void:
  for i in range(4):
    await process_frame

func node(state: Dictionary, id: String) -> Dictionary:
  for entry in state.nodes:
    if entry.testID == id:
      return entry
  return {}

func run() -> void:
  root.size = Vector2i(900, 680)
  var surface := FabricSurface.new()
  root.add_child(surface)
  await settle()
  surface.evaluate("GodotApp.stop()")
  await settle()
  # Exercise the real Hermes/JSI/Fabric mount boundary, bypassing the JS SVG
  # contract deliberately so the native refresh guard can fail in a commit.
  surface.evaluate("""
    const ui = nativeFabricUIManager;
    const payload = (tag, attrs) => JSON.stringify({tag, attrs, text: ''});
    const make = (tag, id, width) => ui.createNode(tag, 'GodotControl', 1,
      {kind:'svg', testID:id, width, height:32, flexShrink:0,
       svg:payload('svg', {width:String(width), height:'32'})}, {});
    const commit = (nodes) => {
      const set = ui.createChildSet();
      nodes.forEach(node => ui.appendChildToSet(set, node));
      ui.completeRoot(1, set);
    };
    const first = make(10002, 'first-svg', 32);
    const second = make(10004, 'second-svg', 32);
    const rect = ui.createNode(10006, 'GodotControl', 1,
      {kind:'svg', width:0, height:0, position:'absolute',
       svg:payload('rect', {width:'32', height:'32', fill:'#ff0000'})}, {});
    ui.appendChild(second, rect);
    const retired = ui.createNode(10008, 'GodotControl', 1,
      {testID:'retired-control', width:32, height:32}, {});
    globalThis.svgMountProbe = (stage) => {
      if (stage === 'initial') commit([first, second, retired]);
      if (stage === 'failure') {
        const bad = ui.cloneNodeWithNewProps(first, {width:4096});
        const green = ui.cloneNodeWithNewProps(rect,
          {svg:payload('rect', {width:'32', height:'32', fill:'#00ff00'})});
        const healthy = ui.cloneNodeWithNewChildren(second);
        ui.appendChild(healthy, green);
        commit([bad, healthy]);
      }
      if (stage === 'recover') commit([first, second]);
    };
    GodotApp.stop = () => commit([]);
    svgMountProbe('initial');
  """)
  await settle()
  var initial: Dictionary = JSON.parse_string(surface.snapshot())
  check(initial.errors.is_empty() and node(initial, "second-svg").svg.paintedPixels == 1024, "Healthy SVG mounts and paints before the failure")
  surface.evaluate("svgMountProbe('failure')")
  await settle()
  var failed: Dictionary = JSON.parse_string(surface.snapshot())
  check(failed.errors.size() == 1 and "2048 pixel surface budget" in failed.errors[0], "Native refresh failure remains visible exactly once")
  check(failed.mountReports == failed.commits and failed.retiringTags == 0, "Failed SVG commit still reports mount and clears retiring tags")
  check(node(failed, "retired-control").is_empty() and failed.deletes > initial.deletes, "The same failed commit deletes its retiring Control")
  check(node(failed, "second-svg").svg.rasterHash != node(initial, "second-svg").svg.rasterHash and node(failed, "second-svg").svg.document.contains("#00ff00"), "Later healthy SVG refreshes despite the first SVG failure")
  surface.evaluate("svgMountProbe('recover')")
  await settle()
  var recovered: Dictionary = JSON.parse_string(surface.snapshot())
  check(node(recovered, "first-svg").width == 32 and recovered.errors.size() == 1 and recovered.mountReports == recovered.commits, "A later valid commit recovers without repeating the error")
  surface.stop()
  var stopped: Dictionary = JSON.parse_string(surface.snapshot())
  check(stopped.nodes.is_empty() and stopped.creates == stopped.deletes and stopped.retiringTags == 0 and stopped.mountReports == stopped.commits, "Recovery teardown finalizes every commit and releases all Controls")
  print("SVG_MOUNT_RECOVERY_RESULT: ", JSON.stringify({"checks": checks, "initial": initial, "failed": failed, "recovered": recovered, "stopped": stopped}))
  surface.free()
  quit(1 if checks.any(func(entry): return not entry.passed) else 0)
