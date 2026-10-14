import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {SABOTAGES as variants} from "../tests/portal-pattern-sabotages.mjs";
import {guardSources} from "./sabotage-sources.mjs";

// The retained controls of the portal pattern slice. The slice changes the example and no native code, so there is no previous host to
// run (the host is the one main builds, and nothing in it is touched): each control breaks one decision of the pattern on purpose in
// examples/portal-pattern/App.jsx, runs tests/portal-pattern-native.test.mjs on it, and the probe's checks and the independent oracle must
// both reject it. The source comes back byte for byte whatever ends the run, a signal included (scripts/sabotage-sources.mjs), and the genuine
// lane runs last so that its comparison (build/portal-pattern-comparison.json) reads the reports of every control.
//
//  host-in-scroll          the provider renders no host and the ScrollView's content renders it: the portal's Controls are the ScrollView's, so
//                          its clip cuts the dropdown and the host is no longer the last child of the root's View.
//  host-blocks-world       the host loses pointerEvents="box-none": its Control stops the mouse and RN's hit test finds it, so a press on the
//                          surface's empty area no longer reaches the world.
//  provider-not-installed  AppRegistry.setWrapperComponentProvider is never called: no root has a host, and a Portal draws nothing.
//  portal-leaks            the Portal does not remove its content on unmount: a closed dropdown stays in the host.
//  host-flattened          the host loses its zIndex, so it forms no stacking context and Fabric hoists the portal's Controls out of it into the
//                          root's Control: the host's children are no longer the portal's.
//
// Run with:
//   node scripts/portal-pattern-sabotage.mjs
const root = fileURLToPath(new URL("..", import.meta.url));
const digest = content => createHash("sha256").update(content).digest("hex");
const files = [...new Set(variants.map(variant => variant.file))];
const sources = guardSources(root, files);

// The source of a variant with its edits made. The first goes through the guard (which refuses a place that is not unique); the others are
// checked the same way against the text the one before it left.
function broken(variant) {
  const [first, ...rest] = variant.edits;
  let text = sources.sabotaged({name: variant.name, file: variant.file, ...first});
  for (const {find, replace} of rest) {
    assert.equal(text.split(find).length, 2, `The ${variant.name} sabotage must replace exactly one place in ${variant.file}: ${find}`);
    text = text.replace(find, () => replace);
  }
  return text;
}

// The test's own output is kept beside the probe's log: it says which assertion rejected (or accepted) a control.
async function run(argument) {
  const result = await sources.run(process.execPath, ["tests/portal-pattern-native.test.mjs", ...(argument ? [argument] : [])]);
  await writeFile(path.join(root, `build/portal-pattern-${argument ? argument.replace(/^--/, "").replace("=", "-") : "current"}-test.log`),
    result.stdout + result.stderr);
  return result;
}
const receipt = {format: "godot-fabric.portal-pattern-sabotage/v1", sourceSha256: {genuine: sources.genuine}, variants: []};
for (const variant of variants) {
  broken(variant);
}
try {
  for (const variant of variants) {
    try {
      const source = broken(variant);
      const entry = {name: variant.name, file: variant.file, edits: variant.edits, sourceSha256: digest(source)};
      sources.swap(variant.file, source);
      entry.runStatus = (await run(variant.argument)).status;
      receipt.variants.push(entry);
    } finally {
      sources.restore();
    }
  }
} finally {
  receipt.sourceSha256.restored = sources.restore();
}
assert.deepEqual(receipt.sourceSha256.restored, receipt.sourceSha256.genuine, "No example source was edited");
// The genuine lane last, so that its comparison reads the reports of every control above.
receipt.currentRunStatus = (await run()).status;
receipt.hostSha256 = digest(await readFile(path.join(root, "addons/fabric_godot.dylib")));
await writeFile(path.join(root, "build/portal-pattern-sabotage.json"), JSON.stringify(receipt, null, 2) + "\n");
for (const entry of receipt.variants) {
  assert.equal(entry.runStatus, 0, `The probe and oracle must reject the ${entry.name} sabotage: build/portal-pattern-${entry.name}.log`);
}
assert.equal(receipt.currentRunStatus, 0, "The genuine run passes: build/portal-pattern-current.log");
console.log(JSON.stringify(receipt, null, 2));
