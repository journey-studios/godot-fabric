import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {SABOTAGES as variants} from "../tests/scope-sabotages.mjs";
import {guardSources} from "./sabotage-sources.mjs";

// The retained sabotages of the 0.5 scope slice. Each breaks one decision on purpose, runs the native suite (whose probe and
// independent oracle judge the report, tests/scope-0.5-native.test.mjs --sabotage=<name>) and the JS lane
// (tests/scope-0.5.test.mjs), and the source comes back byte for byte whatever ends the run, a signal included
// (scripts/sabotage-sources.mjs). Nothing here touches the host: the slice changes no native code.
//
//   updates     the View checks its props on the mount only (a ref set by the first render), so a refused prop passes on an update;
//   undeclared  the Pressable hands every key to the host's Control again, so a name only the Control has reaches it;
//   modal       the Modal wrapper does not check, so a refused prop reaches RN's Modal and the host (which refuses some of them
//               from inside the mount and stops the application: the probe aborts at that group);
//   scroll      the ScrollView's contract does not run the check, so its table is not enforced (the ScrollView of PR #58 enforced it
//               itself before the table moved to src/prop-scope.mjs);
//   defaults    the checker does not accept the first value of `accepts`, so the value RN gives a prop by default fails;
//   reason      a refused prop of the manifest has no reason.
//
// `native` says that the native suite has to reject the variant, `lane` that the JS lane has to. Run with:
//   node scripts/scope-sabotage.mjs
const root = fileURLToPath(new URL("..", import.meta.url));
const digest = content => createHash("sha256").update(content).digest("hex");
const sources = guardSources(root, [...new Set(variants.map(variant => variant.file))]);
const receipt = {format: "godot-fabric.scope-sabotage/v1", sourceSha256: {genuine: sources.genuine}, variants: []};
try {
  for (const variant of variants) {
    try {
      const broken = sources.sabotaged(variant);
      const entry = {name: variant.name, file: variant.file, find: variant.find, replace: variant.replace, sourceSha256: digest(broken)};
      sources.swap(variant.file, broken);
      const native = await sources.run(process.execPath, ["tests/scope-0.5-native.test.mjs", `--sabotage=${variant.name}`]);
      await writeFile(path.join(root, `build/scope-0.5-sabotage-${variant.name}-test.log`), native.stdout + native.stderr);
      entry.nativeRejected = native.status === 0;
      const js = await sources.run(process.execPath, ["--test", "tests/scope-0.5.test.mjs"]);
      await writeFile(path.join(root, `build/scope-0.5-sabotage-${variant.name}-js.log`), js.stdout + js.stderr);
      entry.jsLaneRejected = js.status !== 0;
      receipt.variants.push(entry);
    } finally {
      sources.restore();
    }
  }
} finally {
  receipt.sourceSha256.restored = sources.restore();
}
assert.deepEqual(receipt.sourceSha256.restored, receipt.sourceSha256.genuine, "Every source is restored byte for byte");
await writeFile(path.join(root, "build/scope-0.5-sabotage.json"), JSON.stringify(receipt, null, 2) + "\n");
for (const [index, variant] of variants.entries()) {
  const entry = receipt.variants[index];
  assert.ok(entry.nativeRejected, `The native suite (probe and oracle) must reject the ${variant.name} sabotage: build/scope-0.5-sabotage-${variant.name}-test.log`);
  assert.equal(entry.jsLaneRejected, variant.lane, `The JS lane ${variant.lane ? "must" : "does not"} reject the ${variant.name} sabotage`);
}
console.log(JSON.stringify(receipt, null, 2));
