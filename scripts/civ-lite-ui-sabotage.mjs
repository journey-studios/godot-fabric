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
//  city-by-data       the city screen is gated on `city.present` and not on the context: once the city exists it is in every context.
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
//
// A variant whose run leaves no observed.json (a crash, a failed assertion that came first) is recorded as nothing observed and is not
// rejected. Run with:
//   node scripts/civ-lite-ui-sabotage.mjs
const root = fileURLToPath(new URL("..", import.meta.url));
const template = "consumers/civ-lite";
const variants = [
  {name: "city-by-data", file: `${template}/ui/hud/hud.tsx`,
    find: "      {panels.includes(\"city\") ? <City snapshot={snapshot} /> : null}\n",
    replace: "      {snapshot.city.present === 1 ? <City snapshot={snapshot} /> : null}\n"},
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
  {name: "disabled-ignored", file: `${template}/ui/hud/kit.tsx`,
    find: "  return <Pressable testID={id} disabled={!enabled} onPress={onPress}\n",
    replace: "  return <Pressable testID={id} onPress={onPress}\n"},
];
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
const control = await sources.run(process.execPath, ["tests/civ-lite-ui-native.test.mjs"]);
await writeFile(path.join(root, "build/civ-lite-ui-sabotage-control.log"), control.stdout + control.stderr);
receipt.controlStatus = control.status;
await writeFile(path.join(root, "build/civ-lite-ui-sabotage.json"), JSON.stringify(receipt, null, 2) + "\n");
for (const entry of receipt.variants) {
  assert.ok(entry.rejected, `The lane must reject the ${entry.name} project, and its run must leave what it observed `
    + `(status ${entry.runStatus}, observed ${entry.observed}): build/civ-lite-ui-sabotage-${entry.name}.log`);
}
assert.equal(receipt.controlStatus, 0, "The restored template must pass the plain lane: build/civ-lite-ui-sabotage-control.log");
console.log(JSON.stringify(receipt, null, 2));
