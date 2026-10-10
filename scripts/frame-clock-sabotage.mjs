import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {copyFile, mkdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {SABOTAGES as variants} from "../tests/frame-clock-sabotages.mjs";
import {guardSources} from "./sabotage-sources.mjs";

// The retained sabotages of the frame clock slice: each breaks the clock's decision on
// purpose, runs the probe and the independent oracle against it, and the source is
// restored byte for byte, proven by hash, and the genuine host rebuilt.
//
//  always        ticks every frame that has a consumer, whatever the pacing: the cadence the
//                host had before the clock (a callback or an animation frame in every Godot
//                frame), now reported by a clock that says so. Unlike the preceding host it
//                has the clock's counters, so only what the cadence itself does can reject it:
//                ticks closer than half a period, the frame times that must not have ticked,
//                and a decay that ends early at a fast pace.
//  idle          decides without asking whether anything consumes frames, so it ticks (and
//                counts a tick) for Godot frames that nothing waits for.
//  presentation  ignores that a window is presented with V-Sync and applies the time rule to
//                it: the pipelined frames of a presented window then wait, and the images the
//                display shows lose the updates of every frame the rule drops.
//
// Both the probe's checks and the oracle (which recomputes each decision of the clock
// from the Godot frame times) must reject each host. The source comes back whatever
// ends the run, a signal included (scripts/sabotage-sources.mjs). Run with:
//   node scripts/frame-clock-sabotage.mjs
const root = fileURLToPath(new URL("..", import.meta.url));
const host = path.join(root, "addons/fabric_godot.dylib");
const cmake = path.join(root, ".deps/python/bin/cmake");
const digest = content => createHash("sha256").update(content).digest("hex");
const sha = async file => digest(await readFile(file));
const files = [...new Set(variants.map(variant => variant.file))];
const sources = guardSources(root, files);

async function build(name) {
  const result = await sources.run(cmake, ["--build", ".deps/build", "--parallel", "4", "--target", "fabric_godot"]);
  await writeFile(path.join(root, `build/frame-clock-sabotage-${name}-build.log`), result.stdout + result.stderr);
  assert.equal(result.status, 0, `The ${name} host must build: build/frame-clock-sabotage-${name}-build.log`);
}

const receipt = {format: "godot-fabric.frame-clock-sabotage/v1", sourceSha256: {genuine: sources.genuine}, variants: []};
for (const variant of variants) {
  sources.sabotaged(variant);
  await mkdir(path.join(root, variant.hostDirectory), {recursive: true});
}
// The genuine host first, so the restored one can be compared to it.
await build("genuine");
receipt.hostSha256 = {genuine: await sha(host)};
try {
  for (const variant of variants) {
    try {
      const broken = sources.sabotaged(variant);
      const entry = {name: variant.name, file: variant.file, find: variant.find, replace: variant.replace, sourceSha256: digest(broken)};
      sources.swap(variant.file, broken);
      await build(variant.name);
      entry.hostSha256 = await sha(host);
      assert.notEqual(entry.hostSha256, receipt.hostSha256.genuine);
      await copyFile(host, path.join(root, variant.hostDirectory, "fabric_godot.dylib"));
      entry.runStatus = (await sources.run(process.execPath, ["tests/frame-clock-native.test.mjs", variant.argument])).status;
      receipt.variants.push(entry);
    } finally {
      sources.restore();
    }
  }
} finally {
  receipt.sourceSha256.restored = sources.restore();
  await build("restored");
  receipt.hostSha256.restored = await sha(host);
}
assert.equal(receipt.hostSha256.restored, receipt.hostSha256.genuine, "The rebuilt host is the genuine one");
await writeFile(path.join(root, "build/frame-clock-sabotage.json"), JSON.stringify(receipt, null, 2) + "\n");
for (const entry of receipt.variants) {
  assert.equal(entry.runStatus, 0, `The probe and oracle must reject the ${entry.name} host: build/frame-clock-sabotage-${entry.name}.log`);
}
console.log(JSON.stringify(receipt, null, 2));
