import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {SABOTAGES as variants} from "../tests/app-registry-sabotages.mjs";
import {guardSources} from "./sabotage-sources.mjs";

// The retained controls of the AppRegistry slice. The slice changes the SDK and no native code, so there is no previous host
// to run: each control breaks one decision of the facade on purpose, runs tests/app-registry-native.test.mjs on it, and the
// probe's checks and the independent oracle must both reject it. The source comes back byte for byte whatever ends the run, a
// signal included (scripts/sabotage-sources.mjs), and the genuine lane runs last so that its comparison
// (build/app-registry-comparison.json) reads the reports of every control.
//
//  section-dropped         registerComponent forgets its section flag: a component registered as a section is not one.
//  duplicate-accepted      a key registered once can be registered again, through every route.
//  headless-silent         the four headless-task members return instead of failing: a silent no-op.
//  wrapper-ignored         setWrapperComponentProvider does nothing: no root is ever wrapped.
//  props-dropped           setSurfaceProps does nothing: a running root keeps its props.
//  inherited-runnable      getRunnable answers Object.prototype's function for a name nobody registered.
//  root-not-tracked        the container never reports the roots it renders, so no tag is a surface and every run fails.
//  stop-not-forgotten      the host's stop is not noticed, so the tag of a stopped root is still a surface.
//  unknown-root-unchecked  a tag that no surface owns is let through to the renderer.
//
// Run with:
//   node scripts/app-registry-sabotage.mjs
const root = fileURLToPath(new URL("..", import.meta.url));
const digest = content => createHash("sha256").update(content).digest("hex");
const files = [...new Set(variants.map(variant => variant.file))];
const sources = guardSources(root, files);

// The test's own output is kept beside the probe's log: it says which assertion rejected (or accepted) a control.
async function run(argument) {
  const result = await sources.run(process.execPath, ["tests/app-registry-native.test.mjs", ...(argument ? [argument] : [])]);
  await writeFile(path.join(root, `build/app-registry-${argument ? argument.replace(/^--/, "").replace("=", "-") : "current"}-test.log`),
    result.stdout + result.stderr);
  return result;
}
const receipt = {format: "godot-fabric.app-registry-sabotage/v1", sourceSha256: {genuine: sources.genuine}, variants: []};
for (const variant of variants) {
  sources.sabotaged(variant);
}
try {
  for (const variant of variants) {
    try {
      const broken = sources.sabotaged(variant);
      const entry = {name: variant.name, file: variant.file, find: variant.find, replace: variant.replace, sourceSha256: digest(broken)};
      sources.swap(variant.file, broken);
      entry.runStatus = (await run(variant.argument)).status;
      receipt.variants.push(entry);
    } finally {
      sources.restore();
    }
  }
} finally {
  receipt.sourceSha256.restored = sources.restore();
}
assert.deepEqual(receipt.sourceSha256.restored, receipt.sourceSha256.genuine, "No SDK source was edited");
// The genuine lane last, so that its comparison reads the reports of every control above.
receipt.currentRunStatus = (await run()).status;
receipt.hostSha256 = digest(await readFile(path.join(root, "addons/fabric_godot.dylib")));
await writeFile(path.join(root, "build/app-registry-sabotage.json"), JSON.stringify(receipt, null, 2) + "\n");
for (const entry of receipt.variants) {
  assert.equal(entry.runStatus, 0, `The probe and oracle must reject the ${entry.name} sabotage: build/app-registry-sabotage-${entry.name}.log`);
}
assert.equal(receipt.currentRunStatus, 0, "The genuine run passes: build/app-registry-current.log");
console.log(JSON.stringify(receipt, null, 2));
