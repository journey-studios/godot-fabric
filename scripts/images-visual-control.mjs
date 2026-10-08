import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {guardSources} from "./sabotage-sources.mjs";

// The causal control of the visual Images work: the same bundle, probe and server run on the host that was built from main before this
// work (build/images-visual-previous-host/, kept outside Git), which loads and draws every picture and does none of what is done to it:
// no tint, no blur, no cap insets, no rounded clip. The probe must fail exactly the checks it declares normative, the oracle must accept the
// report in its original mode, and the genuine host is put back byte for byte, whatever ends the run (scripts/sabotage-sources.mjs guards a
// signal too). Run with:
//   node scripts/images-visual-control.mjs
const root = fileURLToPath(new URL("..", import.meta.url));
const host = "addons/fabric_godot.dylib";
const previous = path.join(root, "build/images-visual-previous-host/fabric_godot.dylib");
const digest = content => createHash("sha256").update(content).digest("hex");
const guard = guardSources(root, [host]);
const receipt = {format: "godot-fabric.images-visual-control/v1", hostSha256: {genuine: guard.genuine[host]}};
try {
  const old = readFileSync(previous);
  receipt.hostSha256.previous = digest(old);
  assert.notEqual(receipt.hostSha256.previous, receipt.hostSha256.genuine, "The preceding host is not the genuine one");
  guard.swap(host, old);
  const result = await guard.run(process.execPath, ["tests/images-visual-native.test.mjs", "--allow-original-negative"]);
  writeFileSync(path.join(root, "build/images-visual-control-run.log"), result.stdout + result.stderr);
  receipt.runStatus = result.status;
} finally {
  receipt.hostSha256.restored = guard.restore()[host];
}
assert.equal(receipt.hostSha256.restored, receipt.hostSha256.genuine, "The genuine host is back");
writeFileSync(path.join(root, "build/images-visual-control.json"), JSON.stringify(receipt, null, 2) + "\n");
assert.equal(receipt.runStatus, 0, "The probe and the oracle must accept the control: build/images-visual-control-run.log");
console.log(JSON.stringify(receipt, null, 2));
