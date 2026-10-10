import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {copyFile, mkdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {SABOTAGES as variants} from "../tests/images-network-sabotages.mjs";
import {guardSources} from "./sabotage-sources.mjs";

// The retained sabotages of the network Images work: each breaks one behavior of the host on purpose, runs the probe and the
// independent oracle against it, and the source is restored byte for byte, proven by hash, and the genuine host rebuilt.
//
//  decoded-reload   lets a request that asks to reload consult the decoded cache (the routing of image_cache.h): the picture of an earlier
//                   request answers it, with no request to the server, where reload must go to the network.
//  cancel-open      forgets to tell the transport to close the request of a download nobody wants any more: the connection stays open
//                   and the server never sees the client leave, though the Image delivers nothing.
//  texture-mutation gives the texture a repeating Image tiles the size override that a tile of its size in points needs, as the first
//                   slice did: the texture the cache hands to every Image of the picture is resized under all of them.
//
// Both the probe's checks and the oracle (which states the requests the server must see, the model of the caches and the textures a
// picture has) must reject each host. The sources come back whatever ends the run, a signal included (scripts/sabotage-sources.mjs).
// Run with:
//   node scripts/images-network-sabotage.mjs
const root = fileURLToPath(new URL("..", import.meta.url));
const host = path.join(root, "addons/fabric_godot.dylib");
const cmake = path.join(root, ".deps/python/bin/cmake");
const digest = content => createHash("sha256").update(content).digest("hex");
const sha = async file => digest(await readFile(file));
const files = [...new Set(variants.map(variant => variant.file))];
const sources = guardSources(root, files);

async function build(name) {
  const result = await sources.run(cmake, ["--build", ".deps/build", "--parallel", "4", "--target", "fabric_godot"]);
  await writeFile(path.join(root, `build/images-network-sabotage-${name}-build.log`), result.stdout + result.stderr);
  assert.equal(result.status, 0, `The ${name} host must build: build/images-network-sabotage-${name}-build.log`);
}

const receipt = {format: "godot-fabric.images-network-sabotage/v1", sourceSha256: {genuine: sources.genuine}, variants: []};
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
      const run = await sources.run(process.execPath, ["tests/images-network-native.test.mjs", variant.argument]);
      await writeFile(path.join(root, `build/images-network-sabotage-${variant.name}-run.log`), run.stdout + run.stderr);
      entry.runStatus = run.status;
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
await writeFile(path.join(root, "build/images-network-sabotage.json"), JSON.stringify(receipt, null, 2) + "\n");
for (const entry of receipt.variants) {
  assert.equal(entry.runStatus, 0, `The probe and oracle must reject the ${entry.name} host: build/images-network-sabotage-${entry.name}-run.log`);
}
console.log(JSON.stringify(receipt, null, 2));
