import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {copyFile, mkdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {SABOTAGES as variants} from "../tests/native-animated-sabotages.mjs";
import {guardSources} from "./sabotage-sources.mjs";

// The retained sabotages of the native Animated slice: each breaks the host on
// purpose, runs the probe and the independent oracle against it, and the source
// is restored byte for byte, proven by hash, and the genuine host rebuilt.
//
//  frames       hands RN's AnimationBackend its frame timestamps in seconds, where
//               every driver and RN's own clock expect milliseconds, so animations
//               run a thousand times slower than the clock the host reports.
//  persistence  leaves the JS thread's runtime shadow node reference update off,
//               the setting RN's ReactInstance makes before every JS callback
//               (ReactInstance.cpp:101): the nodes the backend's commit hook clones
//               with the animated props are then not what React holds, so it clones
//               the nodes it created before an animation and its next commits undo
//               the animated props.
//
// Both the probe's checks and the oracle (which recomputes each sample from the
// reported milliseconds and each box's final props from the raw samples) must
// reject each host. The sources come back whatever ends the run, a signal
// included (scripts/sabotage-sources.mjs). Run with:
//   node scripts/native-animated-sabotage.mjs
const root = fileURLToPath(new URL("..", import.meta.url));
const host = path.join(root, "addons/fabric_godot.dylib");
const cmake = path.join(root, ".deps/python/bin/cmake");
const digest = content => createHash("sha256").update(content).digest("hex");
const sha = async file => digest(await readFile(file));
const files = [...new Set(variants.map(variant => variant.file))];
const sources = guardSources(root, files);

async function build(name) {
  const result = await sources.run(cmake, ["--build", ".deps/build", "--parallel", "4", "--target", "fabric_godot"]);
  await writeFile(path.join(root, `build/native-animated-sabotage-${name}-build.log`), result.stdout + result.stderr);
  assert.equal(result.status, 0, `The ${name} host must build: build/native-animated-sabotage-${name}-build.log`);
}

const receipt = {format: "godot-fabric.native-animated-sabotage/v3", sourceSha256: {genuine: sources.genuine}, variants: []};
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
      entry.runStatus = (await sources.run(process.execPath, ["tests/native-animated-native.test.mjs", variant.argument])).status;
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
await writeFile(path.join(root, "build/native-animated-sabotage.json"), JSON.stringify(receipt, null, 2) + "\n");
for (const entry of receipt.variants) {
  assert.equal(entry.runStatus, 0, `The probe and oracle must reject the ${entry.name} host: build/native-animated-sabotage${entry.name === "frames" ? "" : "-" + entry.name}.log`);
}
console.log(JSON.stringify(receipt, null, 2));
