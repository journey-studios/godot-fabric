import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {copyFile, mkdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {SABOTAGES as variants} from "../tests/images-sabotages.mjs";
import {guardSources} from "./sabotage-sources.mjs";

// The retained sabotages of the Images slice: each breaks one behavior of the host's image pipeline on purpose, runs the
// probe and the independent oracle against it, and the source is restored byte for byte, proven by hash, and the genuine
// host rebuilt.
//
//  main-thread    runs each job in the call that queues it instead of on the worker pool: the reads and decodes happen on the
//                 main thread, where they block frames. The recorded thread identity of every job is the main thread's, and no
//                 decode is ever in flight for the held pool to hold.
//  stale-request  never takes a view off the request it swaps away from, so that the request is not cancelled and its image
//                 still reaches the view after the one that replaced it: the view reports a load for a picture it no longer shows.
//
// Both the probe's checks and the oracle (which states the events, the pictures and the jobs a correct host reports) must
// reject each host. The sources come back whatever ends the run, a signal included (scripts/sabotage-sources.mjs). Run with:
//   node scripts/images-sabotage.mjs
const root = fileURLToPath(new URL("..", import.meta.url));
const host = path.join(root, "addons/fabric_godot.dylib");
const cmake = path.join(root, ".deps/python/bin/cmake");
const digest = content => createHash("sha256").update(content).digest("hex");
const sha = async file => digest(await readFile(file));
const files = [...new Set(variants.map(variant => variant.file))];
const sources = guardSources(root, files);

async function build(name) {
  const result = await sources.run(cmake, ["--build", ".deps/build", "--parallel", "4", "--target", "fabric_godot"]);
  await writeFile(path.join(root, `build/images-sabotage-${name}-build.log`), result.stdout + result.stderr);
  assert.equal(result.status, 0, `The ${name} host must build: build/images-sabotage-${name}-build.log`);
}

const receipt = {format: "godot-fabric.images-sabotage/v1", sourceSha256: {genuine: sources.genuine}, variants: []};
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
      entry.runStatus = (await sources.run(process.execPath, ["tests/images-native.test.mjs", variant.argument])).status;
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
await writeFile(path.join(root, "build/images-sabotage.json"), JSON.stringify(receipt, null, 2) + "\n");
for (const entry of receipt.variants) {
  assert.equal(entry.runStatus, 0, `The probe and oracle must reject the ${entry.name} host: build/images-sabotage-${entry.name}.log`);
}
console.log(JSON.stringify(receipt, null, 2));
