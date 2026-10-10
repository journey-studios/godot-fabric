import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {copyFile, mkdir, readFile, writeFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {SABOTAGES as variants} from "../tests/text-original-sabotages.mjs";
import {guardSources} from "./sabotage-sources.mjs";

// The retained controls of the text-original slice. Each runs tests/text-original-native.test.mjs, whose probe and
// independent oracle judge the report:
//
//   previous        the SDK and the host of main before this slice (the wrapper that registers RCTText itself, no
//                   press, no guard). The host is build/text-original-previous-host/fabric_godot.dylib, the dylib that
//                   main's build produced, installed in addons/ for the run. It must fail exactly the normative checks.
//   previous-host   this SDK on that host: only the host's guard is missing, so exactly the three bypass checks fail.
//
// and one sabotage per decision of the slice. Each breaks one source on purpose, the probe's checks and the oracle
// must both reject it, and the source comes back byte for byte whatever ends the run, a signal included
// (scripts/sabotage-sources.mjs):
//
//   register     the SDK registers RCTText and RCTVirtualText itself again (the registry then refuses RN's own)
//   style        the base view config declares no text style, so fontFamily and the rest never reach the paragraph
//   ancestor     the SDK reads a private text ancestor context instead of the one RN's Text and View share
//   span-press   a nested Text may be pressable
//   guard        ParagraphLayout::prepare does not refuse head, middle and adjustsFontSizeToFit (rebuilds the host)
//   default      the paragraph's default size is RN's 14 instead of this platform's 18
//
// Run with:
//   node scripts/text-original-sabotage.mjs
// The controls on the previous host are skipped, and said so, when that dylib is not there.
const root = fileURLToPath(new URL("..", import.meta.url));
const host = path.join(root, "addons/fabric_godot.dylib");
const previousHost = path.join(root, "build/text-original-previous-host/fabric_godot.dylib");
const genuineCopy = path.join(root, "build/text-original-genuine-host/fabric_godot.dylib");
const cmake = path.join(root, ".deps/python/bin/cmake");
const digest = content => createHash("sha256").update(content).digest("hex");
const sha = async target => digest(await readFile(target));
const files = [...new Set(variants.map(variant => variant.file))];
const sources = guardSources(root, files);

async function build(name) {
  const result = await sources.run(cmake, ["--build", ".deps/build", "--parallel", "4", "--target", "fabric_godot"]);
  await writeFile(path.join(root, `build/text-original-sabotage-${name}-build.log`), result.stdout + result.stderr);
  assert.equal(result.status, 0, `The ${name} host must build: build/text-original-sabotage-${name}-build.log`);
}

// The test's own output is kept beside the probe's log: it says which assertion rejected (or accepted) a control.
async function run(argument) {
  const result = await sources.run(process.execPath, ["tests/text-original-native.test.mjs", ...(argument ? [argument] : [])]);
  await writeFile(path.join(root, `build/text-original-${argument ? argument.replace(/^--/, "").replace("=", "-") : "current"}-test.log`),
    result.stdout + result.stderr);
  return result;
}
const receipt = {format: "godot-fabric.text-original-sabotage/v1", sourceSha256: {genuine: sources.genuine}, controls: {}, variants: []};

for (const variant of variants.filter(entry => entry.native)) {
  sources.sabotaged(variant);
  await mkdir(path.join(root, `build/text-original-sabotage-${variant.name}-host`), {recursive: true});
}
// The genuine host first, kept so that it can be put back after the controls that replace it.
await build("genuine");
receipt.hostSha256 = {genuine: await sha(host)};
await mkdir(path.dirname(genuineCopy), {recursive: true});
await copyFile(host, genuineCopy);
try {
  if (existsSync(previousHost)) {
    for (const [name, argument] of [["previous", "--previous"], ["previous-host", "--previous-host"]]) {
      await copyFile(previousHost, host);
      const entry = {hostSha256: await sha(host), previousHostSha256: await sha(previousHost)};
      entry.runStatus = (await run(argument)).status;
      receipt.controls[name] = entry;
      await copyFile(genuineCopy, host);
    }
  } else {
    console.log("No previous host at build/text-original-previous-host: the controls on it are skipped.");
  }
  for (const variant of variants) {
    try {
      const broken = sources.sabotaged(variant);
      const entry = {name: variant.name, file: variant.file, find: variant.find, replace: variant.replace, sourceSha256: digest(broken)};
      sources.swap(variant.file, broken);
      if (variant.native) {
        await build(variant.name);
        entry.hostSha256 = await sha(host);
        assert.notEqual(entry.hostSha256, receipt.hostSha256.genuine);
        await copyFile(host, path.join(root, `build/text-original-sabotage-${variant.name}-host`, "fabric_godot.dylib"));
      }
      entry.runStatus = (await run(variant.argument)).status;
      receipt.variants.push(entry);
    } finally {
      sources.restore();
      if (variant.native) {
        await copyFile(genuineCopy, host);
      }
    }
  }
} finally {
  receipt.sourceSha256.restored = sources.restore();
  await build("restored");
  receipt.hostSha256.restored = await sha(host);
}
assert.equal(receipt.hostSha256.restored, receipt.hostSha256.genuine, "The rebuilt host is the genuine one");
// The genuine lane last, so that its comparison reads the reports of every control above.
receipt.currentRunStatus = (await run()).status;
await writeFile(path.join(root, "build/text-original-sabotage.json"), JSON.stringify(receipt, null, 2) + "\n");
for (const [name, entry] of Object.entries(receipt.controls)) {
  assert.equal(entry.runStatus, 0, `The ${name} control fails exactly its normative checks: build/text-original-${name}.log`);
}
for (const entry of receipt.variants) {
  assert.equal(entry.runStatus, 0, `The probe and oracle must reject the ${entry.name} sabotage: build/text-original-sabotage-${entry.name}.log`);
}
assert.equal(receipt.currentRunStatus, 0, "The genuine run passes: build/text-original-current.log");
console.log(JSON.stringify(receipt, null, 2));
