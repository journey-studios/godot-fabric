import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {guardSources} from "./sabotage-sources.mjs";

// The retained sabotages of Frontier's HUD lane: each breaks one source of the template on purpose, runs
// tests/civ-lite-ui-native.test.mjs against it with --sabotage=<name> (which provisions the broken template, builds it and runs the
// HUD probe on it), and the probe's checks and the independent oracle must both reject it, for the reason it was broken. The source is
// restored byte for byte whatever ends the run, a signal included (scripts/sabotage-sources.mjs); the receipt proves it by hash, and
// the restored template must then pass the plain lane.
//
//  city-by-data       the city overlay and the city screen are gated on `city.present` and not on the context: once the city exists they
//                     are in every context, and so is the Modal that blocks the map.
//  actions-reversed   the actions panel lists the snapshot's actions in the opposite order.
//  spinner-always     the spinner is not tied to the phase: it spins at rest too.
//  end-turn-by-phase  End turn is enabled by a rule of the HUD's own (the phase is idle) and not by the game's `end_turn` action.
//  spacer             a full-height spacer with a testID (so Fabric does not flatten it) covers the map: it stops the pointer and the
//                     World never hears a click. (The spacer of 5e1f6a1's HUD has no testID and no style that paints: Fabric flattens it
//                     and it claims nothing, which the control run of the lane shows.)
//  hover-unpublished  the World no longer tells the node which tile is under the pointer: the hover is never published.
//  world-behind-hud   a World that comes back after the menu is no longer put ahead of the HUD's layer: it hears the unhandled input
//                     before the HUD's Surface can claim it, so a click on a panel reaches the map.
//  disabled-ignored   the button no longer passes the game's `enabled` to its Pressable: a disabled action is pressable and asks the game.
//  queue-out-of-order an answered event leaves the game's queue by its tail and not by its head: the first event stays the head, so the
//                     second never comes up, in the game and in the HUD.
//  position-in-js     the dialog's "n of m" is computed by the HUD from the event's id and not read from the snapshot: it is wrong for the
//                     third event.
//  city-in-tree       the city screen and the research list are panels of the tree and not a Modal: nothing blocks the map under them.
//  dialog-unkeyed     the dialog is not keyed by the event's id: the three events are one subtree that updates in place, so the Control
//                     of the dialog is the same one every time.
//
// The five of the stability lane (V05-05 `estabilidade`) run its probe alone, or only its static scan, and the oracle's categories are theirs:
//  close-leaks-connection  the store opens a connection to the snapshot every time the game is asked to clear the selection (the call Close and
//                     Escape make) and never lets it go: a listener leak, one registry subscription and one HUD connection more each time.
//  modal-stays-mounted  the city screen's Modal is gated on the city existing and not on the context: once the city is founded its Window stays
//                     open, empty, after the screen is closed (a Window leak, which also keeps the map blocked).
//  focus-grabbed      a Control under the overlay (the World's) takes the focus when the city screen or the dialog opens: the overlay's Window
//                     is no longer the only place the focus is.
//  icon-missing       an icon points at an asset that is not there: its Image fails to load and draws nothing.
//  import-outside-manifest  the HUD imports TextInput, a name the 0.5 manifest leaves out; nothing runs it, only the static scan sees it.
//
// The three of arm B (V05-10 `braco-b`) break the native HUD (consumers/civ-lite/native_hud/) and run the HUD and overlay probes on the second scene
// (main_native.tscn); the oracles are the same as the React Native HUD's:
//  native-city-shows-tile   the table of panels mounts the tile card in the city context too, so the city screen is open over a tile card the
//                     context does not call for.
//  native-overlay-not-blocking  the overlay no longer stops the pointer: it is still drawn, dimming the game, but it is not a layer that blocks, so
//                     the World hears the clicks, the right clicks and the wheel under the city screen and the dialog.
//  native-end-turn-by-phase  End turn is enabled by a rule of the HUD's own (the phase is idle) and not by the game's `end_turn` action.
//
// The five of the stress mode (docs/research/frontier-stress.md) and of the runner's `stats()` run the HUD and overlay probes like the rest; the
// stress stage and its oracle rules reject each for the reason it was broken:
//  stress-rows-rebuilt          the React Native stress panel keys each log row by its line and by the newest line, so every step gives every row a
//                     new key: React mounts 200 rows again for one line (the row-identity check).
//  native-stress-rows-rebuilt   the native stress panel frees every row on every render and makes it again (the same check).
//  stress-end-keeps-overlay     `stress_end` publishes a snapshot and leaves the overlay in the node: the mode never ends, the panel stays and the
//                     snapshot is not the one from before the mode (the byte-identity check).
//  stats-miss-turn-ended        the React Native HUD's stats() does not count the ends of turn the registry ingested, and so its events fall short
//                     of what the node emitted.
//  native-stats-miss-turn-ended the native HUD handles `turn_ended` and does not count it (the same rule).
//
// A variant whose run leaves no observed.json (a crash, a failed assertion that came first) is recorded as nothing observed and is not
// rejected. Run with:
//   node scripts/civ-lite-ui-sabotage.mjs
const root = fileURLToPath(new URL("..", import.meta.url));
const template = "consumers/civ-lite";
const CITY_OVERLAY = `    {panels.includes("city") || panels.includes("research") ? <Overlay id="hud-city-overlay" onRequestClose={closeSelection}>
      <View pointerEvents="box-none" style={{ position: "absolute", left: 616, top: 24, width: 440, gap: 8 }}>
        {panels.includes("city") ? <City snapshot={snapshot} /> : null}
        {panels.includes("research") ? <Research snapshot={snapshot} /> : null}
      </View>
    </Overlay> : null}
`;
const catalogue = [
  {name: "city-by-data", file: `${template}/ui/hud/hud.tsx`,
    find: CITY_OVERLAY,
    replace: CITY_OVERLAY.replace("panels.includes(\"city\") || panels.includes(\"research\") ?", "snapshot.city.present === 1 ?")
      .replace("{panels.includes(\"city\") ? <City", "{snapshot.city.present === 1 ? <City")},
  {name: "actions-reversed", file: `${template}/ui/hud/actions.tsx`,
    find: "    {actions.filter(action => action.id !== \"end_turn\").map(action => {\n",
    replace: "    {[...actions].reverse().filter(action => action.id !== \"end_turn\").map(action => {\n"},
  {name: "spinner-always", file: `${template}/ui/hud/bar.tsx`,
    find: "      {snapshot.phase === \"idle\" ? null : <ActivityIndicator testID=\"hud-turn-spinner\" size=\"small\" color={COLORS.accent} />}\n",
    replace: "      <ActivityIndicator testID=\"hud-turn-spinner\" size=\"small\" color={COLORS.accent} />\n"},
  {name: "end-turn-by-phase", file: `${template}/ui/hud/bar.tsx`,
    find: "  const enabled = endTurn !== undefined && endTurn.enabled === 1;\n",
    replace: "  const enabled = snapshot.phase === \"idle\";\n"},
  {name: "spacer", file: `${template}/ui/hud/hud.tsx`,
    find: "    <Bar snapshot={snapshot} answer={answer} />\n",
    replace: "    <View testID=\"hud-spacer\" style={{ position: \"absolute\", left: 0, top: 0, width: 616, height: 512 }} />\n    <Bar snapshot={snapshot} answer={answer} />\n"},
  {name: "hover-unpublished", file: `${template}/world/world.gd`,
    find: "    services.set_hover(tile.x, tile.y)\n",
    replace: "    pass\n"},
  {name: "world-behind-hud", file: `${template}/services/game_services.gd`,
    find: "  for child in get_children():\n    if child is CanvasLayer:\n      move_child(world, child.get_index())\n      break\n",
    replace: ""},
  {name: "queue-out-of-order", file: `${template}/game/intents.gd`,
    find: "  state.events.queue.remove_at(0)\n",
    replace: "  state.events.queue.pop_back()\n"},
  {name: "position-in-js", file: `${template}/ui/hud/dialog.tsx`,
    find: "{`${dialog.index} of ${dialog.count}`}",
    replace: "{`${dialog.id === \"wanderers\" ? 1 : 2} of ${dialog.count}`}"},
  {name: "city-in-tree", file: `${template}/ui/hud/hud.tsx`,
    find: CITY_OVERLAY,
    replace: CITY_OVERLAY.replace("<Overlay id=\"hud-city-overlay\" onRequestClose={closeSelection}>", "<View testID=\"hud-city-overlay\" pointerEvents=\"box-none\" style={{ flex: 1 }}>").replace("</Overlay>", "</View>")},
  {name: "dialog-unkeyed", file: `${template}/ui/hud/hud.tsx`,
    find: "<Dialog key={snapshot.dialog.id} dialog={snapshot.dialog} />",
    replace: "<Dialog dialog={snapshot.dialog} />"},
  {name: "disabled-ignored", file: `${template}/ui/hud/kit.tsx`,
    find: "  return <Pressable testID={id} disabled={!enabled} onPress={onPress}\n",
    replace: "  return <Pressable testID={id} onPress={onPress}\n"},
  {name: "stress-rows-rebuilt", file: `${template}/ui/hud/stress.tsx`,
    find: "<Text key={keyOf(line)} testID={`hud-stress-log-${keyOf(line)}`}",
    replace: "<Text key={`${keyOf(line)}-${keyOf(stress.log[stress.log.length - 1])}`} testID={`hud-stress-log-${keyOf(line)}`}"},
  {name: "native-stress-rows-rebuilt", file: `${template}/native_hud/stress.gd`,
    find: "    if not wanted.has(key):\n      var stale: Label = rows[key]\n",
    replace: "    if true:\n      var stale: Label = rows[key]\n"},
  {name: "stress-end-keeps-overlay", file: `${template}/services/game_services.gd`,
    find: "    return _plain(_refusal(\"stress_off\"))\n  stress = null\n  _publish()\n",
    replace: "    return _plain(_refusal(\"stress_off\"))\n  _publish()\n"},
  {name: "stats-miss-turn-ended", file: `${template}/hud_stats.gd`,
    find: "\"events\": int(snapshot.sent) + int(hover.sent) + int(ended.emitted)}",
    replace: "\"events\": int(snapshot.sent) + int(hover.sent)}"},
  {name: "native-stats-miss-turn-ended", file: `${template}/native_hud/hud.gd`,
    find: "func _on_turn_ended(_summary: Dictionary) -> void:\n  _events += 1\n",
    replace: "func _on_turn_ended(_summary: Dictionary) -> void:\n  pass\n"},
  {name: "native-city-shows-tile", file: `${template}/native_hud/hud.gd`,
    find: "  \"city\": [\"city\", \"research\"],\n",
    replace: "  \"city\": [\"city\", \"research\", \"tile\"],\n"},
  {name: "native-overlay-not-blocking", file: `${template}/native_hud/overlay.gd`,
    find: "  mouse_filter = Control.MOUSE_FILTER_STOP\n",
    replace: "  mouse_filter = Control.MOUSE_FILTER_IGNORE\n"},
  {name: "native-end-turn-by-phase", file: `${template}/native_hud/bar.gd`,
    find: "  var enabled: bool = not end_turn.is_empty() and int(end_turn.enabled) == 1\n",
    replace: "  var enabled: bool = snapshot.phase == \"idle\"\n"},
  {name: "close-leaks-connection", file: `${template}/ui/store.ts`,
    find: "export function send(...call: FrontierCall): Promise<FrontierResult | null> {\n  return record(call[0], callFrontier(...call));\n}\n",
    replace: "export function send(...call: FrontierCall): Promise<FrontierResult | null> {\n  if (call[0] === FRONTIER_CLEAR_SELECTION) {\n"
      + "    hold(GodotFabric.connect<FrontierSnapshot>(FRONTIER_SNAPSHOT, () => {}));\n  }\n  return record(call[0], callFrontier(...call));\n}\n"},
  {name: "modal-stays-mounted", file: `${template}/ui/hud/hud.tsx`,
    find: "    {panels.includes(\"city\") || panels.includes(\"research\") ? <Overlay id=\"hud-city-overlay\" onRequestClose={closeSelection}>\n",
    replace: "    {snapshot.city.present === 1 ? <Overlay id=\"hud-city-overlay\" onRequestClose={closeSelection}>\n"},
  {name: "focus-grabbed", file: `${template}/world/world.gd`,
    find: "func _on_snapshot_changed(_snapshot: Dictionary) -> void:\n  queue_redraw()\n",
    replace: "var _grabber: Control\n\n\nfunc _on_snapshot_changed(_snapshot: Dictionary) -> void:\n  queue_redraw()\n  if _snapshot.context == \"city\" or _snapshot.context == \"dialog\":\n"
      + "    if _grabber == null:\n      _grabber = Control.new()\n      _grabber.focus_mode = Control.FOCUS_ALL\n      add_child(_grabber)\n    _grabber.grab_focus()\n"},
  {name: "icon-missing", file: `${template}/ui/hud/icons.ts`,
    find: "import food from \"../icons/food.png\";\n",
    replace: "const food = { uri: \"res://icons/missing.png\", width: 32, height: 32 };\n"},
  {name: "import-outside-manifest", file: `${template}/ui/hud/kit.tsx`,
    find: "import { Image, Pressable, Text, View } from \"react-native\";\n",
    replace: "import { Image, Pressable, Text, TextInput, View } from \"react-native\";\n"},
];
// With names on the command line only those run, and neither the plain lane afterwards nor the receipt: a way to try one sabotage.
const only = process.argv.slice(2);
assert.ok(only.every(name => catalogue.some(variant => variant.name === name)), `Unknown sabotage in ${only.join(", ")}`);
const variants = only.length === 0 ? catalogue : catalogue.filter(variant => only.includes(variant.name));
const digest = content => createHash("sha256").update(content).digest("hex");
const files = [...new Set(variants.map(variant => variant.file))];
const sources = guardSources(root, files);

await mkdir(path.join(root, "build"), {recursive: true});
// Every replacement must find exactly one place before anything is edited.
for (const variant of variants) {
  sources.sabotaged(variant);
}

const receipt = {format: "godot-fabric.civ-lite-ui-sabotage/v1", sourceSha256: {genuine: sources.genuine}, variants: []};
try {
  for (const variant of variants) {
    try {
      const broken = sources.sabotaged(variant);
      const entry = {name: variant.name, file: variant.file, find: variant.find, replace: variant.replace, sourceSha256: digest(broken)};
      // What the run observed is written by the run itself. A file left by an earlier run must never stand for this one.
      const observedFile = path.join(root, `build/civ-lite-ui-sabotage-${variant.name}/observed.json`);
      await rm(observedFile, {force: true});
      sources.swap(variant.file, broken);
      const run = await sources.run(process.execPath, ["tests/civ-lite-ui-native.test.mjs", `--sabotage=${variant.name}`]);
      await writeFile(path.join(root, `build/civ-lite-ui-sabotage-${variant.name}.log`), run.stdout + run.stderr);
      entry.runStatus = run.status;
      let observed = null;
      try {
        observed = JSON.parse(await readFile(observedFile, "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
      entry.observed = observed !== null;
      entry.failedChecks = observed === null ? null : observed.failedChecks.length;
      entry.firstFailedCheck = observed === null ? null : (observed.failedChecks[0] ?? null);
      entry.categories = observed === null ? null : observed.categories;
      entry.findings = observed === null ? null : observed.findings.slice(0, 3);
      entry.rejected = entry.runStatus === 0 && entry.observed;
      receipt.variants.push(entry);
    } finally {
      sources.restore();
    }
  }
} finally {
  receipt.sourceSha256.restored = sources.restore();
}
assert.deepEqual(receipt.sourceSha256.restored, receipt.sourceSha256.genuine, "Every source is restored byte for byte");
// The restored template passes the plain lane: the sabotages are the only difference.
if (only.length === 0) {
  const control = await sources.run(process.execPath, ["tests/civ-lite-ui-native.test.mjs"]);
  await writeFile(path.join(root, "build/civ-lite-ui-sabotage-control.log"), control.stdout + control.stderr);
  receipt.controlStatus = control.status;
  await writeFile(path.join(root, "build/civ-lite-ui-sabotage.json"), JSON.stringify(receipt, null, 2) + "\n");
} else {
  receipt.controlStatus = 0;
}
for (const entry of receipt.variants) {
  assert.ok(entry.rejected, `The lane must reject the ${entry.name} project, and its run must leave what it observed `
    + `(status ${entry.runStatus}, observed ${entry.observed}): build/civ-lite-ui-sabotage-${entry.name}.log`);
}
assert.equal(receipt.controlStatus, 0, "The restored template must pass the plain lane: build/civ-lite-ui-sabotage-control.log");
console.log(JSON.stringify(receipt, null, 2));
