import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {copyFile, mkdir, readFile, writeFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {SABOTAGES as variants} from "../tests/mobile-density-sabotages.mjs";
import {guardSources} from "./sabotage-sources.mjs";

// The retained controls of the density slice. Each runs tests/mobile-density-native.test.mjs, whose probe and independent oracle judge
// the report:
//
//   previous host         the host and the SDK of main before this slice (b0e40aa): RN's SafeAreaView is a plain View, FabricApplication
//                         has no density policy and reads no seam. It must fail exactly the normative checks.
//   ignore-frame          the padding of a SafeAreaView ignores where its frame is: every view gets the whole band (a view away from the
//                         edges is padded as if it filled the window).
//   no-threshold          the update threshold is removed: a State is replaced on every pump, and a change under a pixel and 0.01
//                         is applied.
//   no-reapply            the density policy is applied once: a change of the screen's scale (a window dragged to another display)
//                         never reaches Dimensions, the layout or the events.
//   ignore-seam           validation_safe_area is ignored: the bands are whatever the display server reports, none on a desktop.
//
// A desktop display server reports no safe area and macOS answers get_display_safe_area with its usable rectangle, so there is
// nothing on this host to fall back to by mistake: that fault is judged by the simulator lane (the real iOS safe area).
//
// Each sabotage breaks a source on purpose and rebuilds the host from it; the probe's checks and the oracle (which derives every
// number from UIKit's rules and the frames JS measured) must both reject it. The sources come back whatever ends the run, a signal
// included (scripts/sabotage-sources.mjs), and so does the genuine host. Run with:
//   node scripts/mobile-density-sabotage.mjs
// The previous host is build/mobile-density-previous-host/fabric_godot.dylib, the dylib that main's build produced; the control is
// skipped, and said so, when it is not there.
const root = fileURLToPath(new URL("..", import.meta.url));
const host = path.join(root, "addons/fabric_godot.dylib");
const previousHost = path.join(root, "build/mobile-density-previous-host/fabric_godot.dylib");
const genuineCopy = path.join(root, "build/mobile-density-genuine-host/fabric_godot.dylib");
const cmake = path.join(root, ".deps/python/bin/cmake");
const digest = content => createHash("sha256").update(content).digest("hex");
const sha = async target => digest(await readFile(target));
const files = [...new Set(variants.map(variant => variant.file))];
const sources = guardSources(root, files);

async function build(name) {
  const result = await sources.run(cmake, ["--build", ".deps/build", "--parallel", "4", "--target", "fabric_godot"]);
  await writeFile(path.join(root, `build/mobile-density-sabotage-${name}-build.log`), result.stdout + result.stderr);
  assert.equal(result.status, 0, `The ${name} host must build: build/mobile-density-sabotage-${name}-build.log`);
}

const run = argument => sources.run(process.execPath, ["tests/mobile-density-native.test.mjs", ...(argument ? [argument] : [])]);
const receipt = {format: "godot-fabric.mobile-density-sabotage/v1", sourceSha256: {genuine: sources.genuine}, previousHost: null, variants: []};

for (const variant of variants) {
  sources.sabotaged(variant);
  await mkdir(path.join(root, variant.hostDirectory), {recursive: true});
}
// The genuine host first, kept so that it can be put back after the controls that replace it.
await build("genuine");
receipt.hostSha256 = {genuine: await sha(host)};
await mkdir(path.dirname(genuineCopy), {recursive: true});
await copyFile(host, genuineCopy);
try {
  if (existsSync(previousHost)) {
    await copyFile(previousHost, host);
    const entry = {hostSha256: await sha(host), previousHostSha256: await sha(previousHost)};
    entry.runStatus = (await run("--previous")).status;
    receipt.previousHost = entry;
    await copyFile(genuineCopy, host);
  } else {
    console.log("No previous host at build/mobile-density-previous-host: the old-host control is skipped.");
  }
  for (const variant of variants) {
    try {
      const broken = sources.sabotaged(variant);
      const entry = {name: variant.name, file: variant.file, find: variant.find, replace: variant.replace, sourceSha256: digest(broken)};
      sources.swap(variant.file, broken);
      await build(variant.name);
      entry.hostSha256 = await sha(host);
      assert.notEqual(entry.hostSha256, receipt.hostSha256.genuine);
      await copyFile(host, path.join(root, variant.hostDirectory, "fabric_godot.dylib"));
      entry.runStatus = (await run(variant.argument)).status;
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
await writeFile(path.join(root, "build/mobile-density-sabotage.json"), JSON.stringify(receipt, null, 2) + "\n");
if (receipt.previousHost != null) {
  assert.equal(receipt.previousHost.runStatus, 0, "The previous host fails exactly the normative checks: build/mobile-density-previous.log");
}
for (const entry of receipt.variants) {
  assert.equal(entry.runStatus, 0, `The probe and oracle must reject the ${entry.name} host: build/mobile-density-sabotage-${entry.name}.log`);
}
console.log(JSON.stringify(receipt, null, 2));
