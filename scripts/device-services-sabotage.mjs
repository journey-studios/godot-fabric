import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {copyFile, mkdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {guardSources} from "./sabotage-sources.mjs";

// The retained sabotages of the device services slice: each breaks one behavior of the host on purpose, runs the
// probe and the independent oracle against it, and the source is restored byte for byte, proven by hash, and the
// genuine host rebuilt.
//
//  duplicate-url    emits Linking's "url" event twice for each deep link, as a host that emitted it once per root
//                   would with two roots: every listener then hears every link twice.
//  stale-clipboard  answers getString with the first text it read and never asks the platform again: a change made
//                   outside the application, or by another write, never shows.
//
// Both the probe's checks and the oracle (which replays the commands against RN's rules) must reject each host. The
// sources come back whatever ends the run, a signal included (scripts/sabotage-sources.mjs). Run with:
//   node scripts/device-services-sabotage.mjs
const root = fileURLToPath(new URL("..", import.meta.url));
const host = path.join(root, "addons/fabric_godot.dylib");
const cmake = path.join(root, ".deps/python/bin/cmake");
const variants = [
  {name: "duplicate-url", argument: "--sabotage=duplicate-url", hostDirectory: "build/device-services-sabotage-duplicate-url-host",
    file: "native/device_services.cpp", find: "    state_->emit_url(url);\n", replace: "    state_->emit_url(url);\n    state_->emit_url(url);\n"},
  {name: "stale-clipboard", argument: "--sabotage=stale-clipboard", hostDirectory: "build/device-services-sabotage-stale-clipboard-host",
    file: "native/device_services.cpp", find: "    if (auto text = state_->core.clipboard_get()) {\n      promise.resolve(std::move(*text));\n",
    replace: "    static std::optional<std::string> stale;\n    if (auto text = state_->core.clipboard_get()) {\n      if (!stale) {\n        stale = std::move(*text);\n      }\n      promise.resolve(*stale);\n"},
];
const digest = content => createHash("sha256").update(content).digest("hex");
const sha = async file => digest(await readFile(file));
const files = [...new Set(variants.map(variant => variant.file))];
const sources = guardSources(root, files);

async function build(name) {
  const result = await sources.run(cmake, ["--build", ".deps/build", "--parallel", "4", "--target", "fabric_godot"]);
  await writeFile(path.join(root, `build/device-services-sabotage-${name}-build.log`), result.stdout + result.stderr);
  assert.equal(result.status, 0, `The ${name} host must build: build/device-services-sabotage-${name}-build.log`);
}

const receipt = {format: "godot-fabric.device-services-sabotage/v1", sourceSha256: {genuine: sources.genuine}, variants: []};
for (const variant of variants) {
  sources.sabotaged(variant);
  await mkdir(path.join(root, variant.hostDirectory), {recursive: true});
}
// The genuine host first, so the restored one can be compared to it.
await build("genuine");
receipt.hostSha256 = {genuine: await sha(host)};
try {
  for (const variant of variants) {
    try {
      const broken = sources.sabotaged(variant);
      const entry = {name: variant.name, file: variant.file, find: variant.find, replace: variant.replace, sourceSha256: digest(broken)};
      sources.swap(variant.file, broken);
      await build(variant.name);
      entry.hostSha256 = await sha(host);
      assert.notEqual(entry.hostSha256, receipt.hostSha256.genuine);
      await copyFile(host, path.join(root, variant.hostDirectory, "fabric_godot.dylib"));
      entry.runStatus = (await sources.run(process.execPath, ["tests/device-services-native.test.mjs", variant.argument])).status;
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
await writeFile(path.join(root, "build/device-services-sabotage.json"), JSON.stringify(receipt, null, 2) + "\n");
for (const entry of receipt.variants) {
  assert.equal(entry.runStatus, 0, `The probe and oracle must reject the ${entry.name} host: build/device-services-probe-sabotage-${entry.name}.log`);
}
console.log(JSON.stringify(receipt, null, 2));
