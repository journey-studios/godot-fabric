import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {SABOTAGES as catalogue} from "../tests/civ-lite-ui-sabotages.mjs";
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
