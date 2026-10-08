import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {guardSources} from "./sabotage-sources.mjs";

// The causal control of the network Images work: the same bundle, probe and server run on the host that was built from main before
// this work (build/images-network-previous-host/, kept outside Git), which fails every http(s) source. The probe must fail exactly
// the checks it declares normative, the oracle must accept the report in its original mode, and the genuine host is put back byte
// for byte, whatever ends the run (scripts/sabotage-sources.mjs guards a signal too). Run with:
//   node scripts/images-network-control.mjs
const root = fileURLToPath(new URL("..", import.meta.url));
const host = "addons/fabric_godot.dylib";
const previous = path.join(root, "build/images-network-previous-host/fabric_godot.dylib");
const digest = content => createHash("sha256").update(content).digest("hex");
const guard = guardSources(root, [host]);
const receipt = {format: "godot-fabric.images-network-control/v1", hostSha256: {genuine: guard.genuine[host]}};
try {
  const old = readFileSync(previous);
  receipt.hostSha256.previous = digest(old);
  assert.notEqual(receipt.hostSha256.previous, receipt.hostSha256.genuine, "The preceding host is not the genuine one");
  guard.swap(host, old);
  const result = await guard.run(process.execPath, ["tests/images-network-native.test.mjs", "--allow-original-negative"]);
  writeFileSync(path.join(root, "build/images-network-control-run.log"), result.stdout + result.stderr);
  receipt.runStatus = result.status;
} finally {
  receipt.hostSha256.restored = guard.restore()[host];
}
assert.equal(receipt.hostSha256.restored, receipt.hostSha256.genuine, "The genuine host is back");
writeFileSync(path.join(root, "build/images-network-control.json"), JSON.stringify(receipt, null, 2) + "\n");
assert.equal(receipt.runStatus, 0, "The probe and the oracle must accept the control: build/images-network-control-run.log");
console.log(JSON.stringify(receipt, null, 2));
