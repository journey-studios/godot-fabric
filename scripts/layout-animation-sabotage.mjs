import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {copyFile, mkdir, readFile, writeFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {guardSources} from "./sabotage-sources.mjs";

// The retained controls of the layout animation slice. Each runs tests/layout-animation-native.test.mjs, whose probe and
// independent oracle judge the report:
//
//   previous host         the host of main before this slice, installed in addons/ (it never installs a LayoutAnimationDriver,
//                         so configureNextLayoutAnimation does nothing and only RN's JS timer ends a call). It must fail
//                         exactly the normative checks.
//   seconds-clock         the driver reads the host's frame time in seconds, not milliseconds: its progress never moves.
//   no-register-surface   no surface hands the driver its mounting coordinator: it never overrides a transaction, so the
//                         Controls get the committed layout in one step.
//   no-consumer           the driver's animation is not a consumer of the frame clock: it never ticks and the animation stalls
//                         at its first frame (the probe waits on the driver's completion, with a limit).
//   drop-callback         the success callback the driver queues is counted and dropped: only RN's JS timer ends the call.
//   unguarded-tick        the driver is ticked on every tick of the frame clock, whatever caused it: a requestAnimationFrame loop with
//                         no animation configured ticks the driver and its counter.
//   no-rearm              a new surface does not hand the interest back when the last one stopped with an animation RN still holds: the
//                         pull that finds the old animation in flight signals no start for the new one, and nothing ticks it.
//
// Each sabotage breaks a source on purpose and rebuilds the host from it; the probe's checks and the oracle (which derives
// every number from RN's formulas) must both reject it. The sources come back whatever ends the run, a signal included
// (scripts/sabotage-sources.mjs), and so does the genuine host. Run with:
//   node scripts/layout-animation-sabotage.mjs
// The previous host is build/layout-animation-previous-host/fabric_godot.dylib, the dylib that main's build produced; the
// control is skipped, and said so, when it is not there.
const root = fileURLToPath(new URL("..", import.meta.url));
const host = path.join(root, "addons/fabric_godot.dylib");
const previousHost = path.join(root, "build/layout-animation-previous-host/fabric_godot.dylib");
const genuineCopy = path.join(root, "build/layout-animation-genuine-host/fabric_godot.dylib");
const cmake = path.join(root, ".deps/python/bin/cmake");
const module = "native/layout_animation.cpp";
const runtime = "native/application_runtime.cpp";
const variants = [
  {name: "seconds-clock", argument: "--sabotage=seconds-clock", hostDirectory: "build/layout-animation-sabotage-seconds-clock-host", file: module,
    find: "    owner->last_read_ms = static_cast<uint64_t>(owner->frame_ms);",
    replace: "    owner->last_read_ms = static_cast<uint64_t>(owner->frame_ms / 1000.0);"},
  {name: "no-register-surface", argument: "--sabotage=no-register-surface", hostDirectory: "build/layout-animation-sabotage-no-register-surface-host", file: module,
    find: "  tree.getMountingCoordinator()->setMountingOverrideDelegate(state_->recorder);\n",
    replace: ""},
  {name: "no-consumer", argument: "--sabotage=no-consumer", hostDirectory: "build/layout-animation-sabotage-no-consumer-host", file: runtime,
    find: " || (layout_animation && layout_animation->active());",
    replace: ";"},
  {name: "drop-callback", argument: "--sabotage=drop-callback", hostDirectory: "build/layout-animation-sabotage-drop-callback-host", file: module,
    find: "    executor(std::move(callback));\n",
    replace: "    static_cast<void>(callback);\n"},
  {name: "unguarded-tick", argument: "--sabotage=unguarded-tick", hostDirectory: "build/layout-animation-sabotage-unguarded-tick-host", file: module,
    find: "  if (!active()) {\n    return;\n  }\n  clock(frame_ms);\n",
    replace: "  if (state_->stopped) {\n    return;\n  }\n  clock(frame_ms);\n"},
  {name: "no-rearm", argument: "--sabotage=no-rearm", hostDirectory: "build/layout-animation-sabotage-no-rearm-host", file: module,
    find: "    if (state_->stale && state_->driver->shouldOverridePullTransaction()) {\n      state_->animating = true;\n    }\n",
    replace: ""},
];
const digest = content => createHash("sha256").update(content).digest("hex");
const sha = async target => digest(await readFile(target));
const sources = guardSources(root, [module, runtime]);

async function build(name) {
  const result = await sources.run(cmake, ["--build", ".deps/build", "--parallel", "4", "--target", "fabric_godot"]);
  await writeFile(path.join(root, `build/layout-animation-sabotage-${name}-build.log`), result.stdout + result.stderr);
  assert.equal(result.status, 0, `The ${name} host must build: build/layout-animation-sabotage-${name}-build.log`);
}

const run = argument => sources.run(process.execPath, ["tests/layout-animation-native.test.mjs", ...(argument ? [argument] : [])]);
const receipt = {format: "godot-fabric.layout-animation-sabotage/v1", sourceSha256: {genuine: sources.genuine}, previousHost: null, variants: []};

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
    entry.runStatus = (await run("--previous-host")).status;
    receipt.previousHost = entry;
    await copyFile(genuineCopy, host);
  } else {
    console.log("No previous host at build/layout-animation-previous-host: the old-host control is skipped.");
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
await writeFile(path.join(root, "build/layout-animation-sabotage.json"), JSON.stringify(receipt, null, 2) + "\n");
if (receipt.previousHost != null) {
  assert.equal(receipt.previousHost.runStatus, 0, "The previous host fails exactly the normative checks: build/layout-animation-previous-host.log");
}
for (const entry of receipt.variants) {
  assert.equal(entry.runStatus, 0, `The probe and oracle must reject the ${entry.name} host: build/layout-animation-sabotage-${entry.name}.log`);
}
console.log(JSON.stringify(receipt, null, 2));
