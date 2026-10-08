import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {guardSources} from "./sabotage-sources.mjs";

// The retained controls of the pointer spike. Each runs the same bundle, probe and independent oracle, and each must be
// rejected, or accepted as the control it is:
//
//  surface-stop   the probe gives every Surface MOUSE_FILTER_STOP again, as the host had before the policy: the Control
//                 under the empty area takes the pointer and 0 of 100 clicks reach the world. The probe's checks fail and
//                 the oracle rejects the report.
//  views-ignore   the probe gives every Control of the Views MOUSE_FILTER_IGNORE, so that no View takes the pointer
//                 either: the Pressable, the bar and the panels let it through, and the world hears what React Native also
//                 takes. The probe's checks fail and the oracle rejects the report.
//  previous host  the host built from main before the policy (build/world-input-previous-host/, kept outside Git) runs the
//                 bundle: the probe must fail exactly the checks it declares normative, and the oracle accepts the report in
//                 its original mode. The genuine host is put back byte for byte, whatever ends the run
//                 (scripts/sabotage-sources.mjs guards a signal too).
//
// Nothing here changes a source: the sabotages are the probe's, so no host is rebuilt. A last run of the current host
// writes build/world-input-comparison.json with all three reports beside it. Run with:
//   node scripts/world-input-sabotage.mjs
const root = fileURLToPath(new URL("..", import.meta.url));
const host = "addons/fabric_godot.dylib";
const previous = path.join(root, "build/world-input-previous-host/fabric_godot.dylib");
const test = "tests/world-input-native.test.mjs";
const digest = content => createHash("sha256").update(content).digest("hex");
const guard = guardSources(root, [host]);
const receipt = {format: "godot-fabric.world-input-sabotage/v1", hostSha256: {genuine: guard.genuine[host]}, runs: []};

async function run(name, args) {
  const result = await guard.run(process.execPath, [test, ...args]);
  writeFileSync(path.join(root, `build/world-input-control-${name}-run.log`), result.stdout + result.stderr);
  receipt.runs.push({name, args, status: result.status});
  return result.status;
}

try {
  for (const name of ["surface-stop", "views-ignore"]) {
    await run(name, [`--sabotage=${name}`]);
  }
  const old = readFileSync(previous);
  receipt.hostSha256.previous = digest(old);
  assert.notEqual(receipt.hostSha256.previous, receipt.hostSha256.genuine, "The preceding host is not the genuine one");
  guard.swap(host, old);
  await run("previous-host", ["--allow-original-negative"]);
} finally {
  receipt.hostSha256.restored = guard.restore()[host];
}
assert.equal(receipt.hostSha256.restored, receipt.hostSha256.genuine, "The genuine host is back");
await run("current", []);
writeFileSync(path.join(root, "build/world-input-sabotage.json"), JSON.stringify(receipt, null, 2) + "\n");
for (const entry of receipt.runs) {
  assert.equal(entry.status, 0, `The ${entry.name} run must be rejected or accepted as its control: build/world-input-control-${entry.name}-run.log`);
}
console.log(JSON.stringify(receipt, null, 2));
