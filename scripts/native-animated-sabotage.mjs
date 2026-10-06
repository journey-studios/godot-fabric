import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {copyFile, mkdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

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
// reject each host. Run with:  node scripts/native-animated-sabotage.mjs
const root = fileURLToPath(new URL("..", import.meta.url));
const host = path.join(root, "addons/fabric_godot.dylib");
const cmake = path.join(root, ".deps/python/bin/cmake");
const variants = [
  {name: "frames", argument: "--sabotage", hostDirectory: "build/native-animated-sabotage-host",
    file: "native/native_animated.cpp",
    find: "onAnimationFrame(rn::AnimationTimestamp(timestamp_ms));",
    replace: "onAnimationFrame(rn::AnimationTimestamp(timestamp_ms / 1000.0));"},
  {name: "persistence", argument: "--sabotage=persistence", hostDirectory: "build/native-animated-sabotage-persistence-host",
    file: "native/application_runtime.cpp",
    find: "rn::ShadowNode::setUseRuntimeShadowNodeReferenceUpdateOnThread(true);",
    replace: "rn::ShadowNode::setUseRuntimeShadowNodeReferenceUpdateOnThread(false);"},
];
const digest = content => createHash("sha256").update(content).digest("hex");
const sha = async file => digest(await readFile(file));
const files = [...new Set(variants.map(variant => variant.file))];

async function build(name) {
  const result = spawnSync(cmake, ["--build", ".deps/build", "--parallel", "4", "--target", "fabric_godot"],
    {cwd: root, encoding: "utf8", timeout: 600000, maxBuffer: 64 * 1024 * 1024});
  await writeFile(path.join(root, `build/native-animated-sabotage-${name}-build.log`), (result.stdout ?? "") + (result.stderr ?? ""));
  assert.equal(result.status, 0, `The ${name} host must build: build/native-animated-sabotage-${name}-build.log`);
}

const originals = new Map(await Promise.all(files.map(async file => [file, await readFile(path.join(root, file))])));
const receipt = {format: "godot-fabric.native-animated-sabotage/v3",
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
      entry.runStatus = spawnSync(process.execPath, ["tests/native-animated-native.test.mjs", variant.argument],
        {cwd: root, encoding: "utf8", timeout: 600000, maxBuffer: 64 * 1024 * 1024}).status;
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
await writeFile(path.join(root, "build/native-animated-sabotage.json"), JSON.stringify(receipt, null, 2) + "\n");
for (const entry of receipt.variants) {
  assert.equal(entry.runStatus, 0, `The probe and oracle must reject the ${entry.name} host: build/native-animated-sabotage${entry.name === "frames" ? "" : "-" + entry.name}.log`);
}
console.log(JSON.stringify(receipt, null, 2));
