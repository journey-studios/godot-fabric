import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {copyFile, mkdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

// The retained sabotage of the singular-transform slice's pointer projection. The
// preceding host cannot isolate that code: it rejects the whole commit of a collapsed
// transform, so every check that mounts one fails with it. This breaks the genuine
// host on purpose instead, in exactly one place, runs the probe and the independent
// oracle against it, and restores the source byte for byte, proven by hash, and
// rebuilds the genuine host.
//
//  collapsed-branch  removes the branch of pointer_local_point that reports a target
//                    or capture owner inside a collapsed subtree as hidden. The nearest
//                    mounted Control keeps its last invertible transform, so a pointer
//                    captured by a View that has collapsed is projected through it and
//                    its events report the owner's layout coordinates where RN's own
//                    payload (the offsets its retargeter computes against the
//                    degenerate box, as for display none) is expected.
//
// The probe must fail exactly capture/CAPTURE_COLLAPSED and capture/CAPTURE_END and
// nothing else, raise no host error, and the oracle must reject the report: the
// runner (transform-guards-check.mjs --lane=singular --sabotage) requires all of it
// and exits 0 only then. The receipt it leaves in build/ is verified by the same
// runner on its next current run, when present, against the source and host under
// test. Run with:  node scripts/transform-singular-sabotage.mjs
const root = fileURLToPath(new URL("..", import.meta.url));
const host = path.join(root, "addons/fabric_godot.dylib");
const cmake = path.join(root, ".deps/python/bin/cmake");
const variants = [
  {name: "collapsed-branch", hostDirectory: "build/transforms-singular-sabotage-host", file: "native/pointer_geometry.cpp",
    find: "if (collapsed(*layout)) {", replace: "if (false && collapsed(*layout)) {"},
];
const digest = content => createHash("sha256").update(content).digest("hex");
const sha = async file => digest(await readFile(file));
const files = [...new Set(variants.map(variant => variant.file))];

async function build(name) {
  const result = spawnSync(cmake, ["--build", ".deps/build", "--parallel", "4", "--target", "fabric_godot"],
    {cwd: root, encoding: "utf8", timeout: 600000, maxBuffer: 64 * 1024 * 1024});
  await writeFile(path.join(root, `build/transforms-singular-sabotage-${name}-build.log`), (result.stdout ?? "") + (result.stderr ?? ""));
  assert.equal(result.status, 0, `The ${name} host must build: build/transforms-singular-sabotage-${name}-build.log`);
}

const originals = new Map(await Promise.all(files.map(async file => [file, await readFile(path.join(root, file))])));
const receipt = {format: "godot-fabric.transform-singular-sabotage/v1",
  sourceSha256: {genuine: Object.fromEntries([...originals].map(([file, content]) => [file, digest(content)]))}, variants: []};
for (const variant of variants) {
  assert.equal(originals.get(variant.file).toString("utf8").split(variant.find).length, 2,
    `The ${variant.name} sabotage must replace exactly one place in ${variant.file}`);
  await mkdir(path.join(root, variant.hostDirectory), {recursive: true});
}
// The genuine host first, so the restored one can be compared to it.
await build("genuine");
receipt.hostSha256 = {genuine: await sha(host)};
try {
  for (const variant of variants) {
    const target = path.join(root, variant.file);
    try {
      const broken = originals.get(variant.file).toString("utf8").replace(variant.find, variant.replace);
      const entry = {name: variant.name, file: variant.file, find: variant.find, replace: variant.replace, sourceSha256: digest(broken)};
      await writeFile(target, broken);
      await build(variant.name);
      entry.hostSha256 = await sha(host);
      assert.notEqual(entry.hostSha256, receipt.hostSha256.genuine);
      await copyFile(host, path.join(root, variant.hostDirectory, "fabric_godot.dylib"));
      const run = spawnSync(process.execPath, ["scripts/transform-guards-check.mjs", "--lane=singular", "--sabotage"],
        {cwd: root, encoding: "utf8", timeout: 600000, maxBuffer: 64 * 1024 * 1024});
      await writeFile(path.join(root, `build/transforms-singular-sabotage-${variant.name}-run.log`), (run.stdout ?? "") + (run.stderr ?? ""));
      entry.runStatus = run.status;
      receipt.variants.push(entry);
    } finally {
      await writeFile(target, originals.get(variant.file));
    }
  }
} finally {
  for (const [file, content] of originals) {
    await writeFile(path.join(root, file), content);
  }
  receipt.sourceSha256.restored = Object.fromEntries(await Promise.all(files.map(async file => [file, await sha(path.join(root, file))])));
  assert.deepEqual(receipt.sourceSha256.restored, receipt.sourceSha256.genuine, "Every source is restored byte for byte");
  await build("restored");
  receipt.hostSha256.restored = await sha(host);
}
assert.equal(receipt.hostSha256.restored, receipt.hostSha256.genuine, "The rebuilt host is the genuine one");
await writeFile(path.join(root, "build/transforms-singular-sabotage.json"), JSON.stringify(receipt, null, 2) + "\n");
for (const entry of receipt.variants) {
  assert.equal(entry.runStatus, 0,
    `The probe and oracle must reject the ${entry.name} host: build/transforms-singular-sabotage-${entry.name}-run.log and build/transforms-singular-sabotage.log`);
}
console.log(JSON.stringify(receipt, null, 2));
