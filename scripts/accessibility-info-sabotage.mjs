import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {copyFile, mkdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {guardSources} from "./sabotage-sources.mjs";

// The retained sabotages of the AccessibilityInfo slice: each breaks one behavior of the host on purpose, runs the
// probe and the independent oracle against it, and the source is restored byte for byte, proven by hash, and the
// genuine host rebuilt.
//
//  unknown-as-false  reads a setting the platform does not report (-1) as off: a getter then resolves false where RN
//                    must be told it is unknown, and a setting that becomes unknown emits an event for "false".
//  emit-every-poll   reports the known value of every setting on every poll, whether or not it changed: each listener
//                    then hears the same value over and over.
//  swapped-settings  swaps the keys of the validation meta of reduce motion and reduce transparency in the descriptor
//                    table: a change of one is reported as the other.
//  display-name      names a DisplayServer method that does not exist for reduce motion. The host reads it as unknown (-1),
//                    never as off, so the getter still rejects; but the method is not one the engine has, and neither the
//                    probe's existence check nor the oracle's list of the engine's four names accepts it. In headless all
//                    four real readings are -1, so only that check can tell a wrong name from a right one.
//
// The four of the announcements (slice 2b) break the announcer's core, which decides what is put in the element, with which live
// mode, whether there is a screen reader to put it for, and whether it is a new element:
//
//  announce-name       puts the text in the element's name and not its value. AccessKit's macOS adapter speaks the value of a
//                      live node (event.rs node_added / node_updated); a name alone is silent, which is what Godot's own
//                      Window::accessibility_announcement does there. The recorded calls say name where they must say value.
//  swapped-priorities  makes "high" polite and every other priority assertive: the recorded live modes are the wrong way round.
//  ungated-announce    answers that a screen reader is always there: the announcement is kept (or published) with none, and the
//                      headless real server, which has none, no longer drops it and counts it.
//  reused-element      makes the first element and puts every later announcement in it: the same text said twice does not speak
//                      again (a value equal to the one before is not an update), and the recorded calls show one element.
//
// A fifth sabotage of the settings, the missing legacySendAccessibilityEvent alias, breaks the JavaScript bundle and not the host:
// tests/platform-seams.test.mjs bundles without that rule and shows AccessibilityInfo's focus call break.
//
// Both the probe's checks and the oracle (which replays the commands against RN's rules) must reject each host. The
// sources come back whatever ends the run, a signal included (scripts/sabotage-sources.mjs). Run with:
//   node scripts/accessibility-info-sabotage.mjs
const root = fileURLToPath(new URL("..", import.meta.url));
const host = path.join(root, "addons/fabric_godot.dylib");
const cmake = path.join(root, ".deps/python/bin/cmake");
const table = "native/accessibility_info_core.h";
// The announcements' pure core, where the four sabotages of the announcements are made.
const announcements = "native/accessibility_announcement_core.h";
const variants = [
  {name: "unknown-as-false", argument: "--sabotage=unknown-as-false", hostDirectory: "build/accessibility-info-sabotage-unknown-as-false-host",
    file: table, find: "  if (raw == 0) {\n    return Reading::Off;\n  }\n  return Reading::Unknown;\n", replace: "  return Reading::Off;\n"},
  {name: "emit-every-poll", argument: "--sabotage=emit-every-poll", hostDirectory: "build/accessibility-info-sabotage-emit-every-poll-host",
    file: table, find: "      if (state.known && *state.known == *value) {\n", replace: "      if (false && state.known && *state.known == *value) {\n"},
  {name: "swapped-settings", argument: "--sabotage=swapped-settings", hostDirectory: "build/accessibility-info-sabotage-swapped-settings-host",
    file: table,
    find: "        \"reduce_animation\", \"accessibility_should_reduce_animation\"},\n"
      + "    {\"getCurrentReduceTransparencyState\", \"reduceTransparencyChanged\", \"reduceTransparency\", \"reduce transparency\",\n"
      + "        \"reduce_transparency\", \"accessibility_should_reduce_transparency\"},\n",
    replace: "        \"reduce_transparency\", \"accessibility_should_reduce_animation\"},\n"
      + "    {\"getCurrentReduceTransparencyState\", \"reduceTransparencyChanged\", \"reduceTransparency\", \"reduce transparency\",\n"
      + "        \"reduce_animation\", \"accessibility_should_reduce_transparency\"},\n"},
  {name: "display-name", argument: "--sabotage=display-name", hostDirectory: "build/accessibility-info-sabotage-display-name-host",
    file: table, find: "        \"reduce_animation\", \"accessibility_should_reduce_animation\"},\n",
    replace: "        \"reduce_animation\", \"accessibility_should_reduce_animations\"},\n"},
  {name: "announce-name", argument: "--sabotage=announce-name", hostDirectory: "build/accessibility-info-sabotage-announce-name-host",
    file: announcements, find: "inline constexpr TextProperty announcement_text = TextProperty::Value;\n",
    replace: "inline constexpr TextProperty announcement_text = TextProperty::Name;\n"},
  {name: "swapped-priorities", argument: "--sabotage=swapped-priorities", hostDirectory: "build/accessibility-info-sabotage-swapped-priorities-host",
    file: announcements,
    find: "  if (priority == \"high\") {\n    return Live::Assertive;\n  }\n  if (priority == \"low\") {\n    return std::nullopt;\n  }\n  return Live::Polite;\n",
    replace: "  if (priority == \"high\") {\n    return Live::Polite;\n  }\n  if (priority == \"low\") {\n    return std::nullopt;\n  }\n  return Live::Assertive;\n"},
  {name: "ungated-announce", argument: "--sabotage=ungated-announce", hostDirectory: "build/accessibility-info-sabotage-ungated-announce-host",
    file: announcements, find: "  bool available() const { return port_.available && port_.available(); }\n",
    replace: "  bool available() const { return true; }\n"},
  {name: "reused-element", argument: "--sabotage=reused-element", hostDirectory: "build/accessibility-info-sabotage-reused-element-host",
    file: announcements, find: "      const uint64_t handle = port_.create ? port_.create() : 0;\n      if (handle == 0) {\n",
    replace: "      static uint64_t reused = 0;\n      if (reused == 0) {\n        reused = port_.create ? port_.create() : 0;\n      }\n      const uint64_t handle = reused;\n      if (handle == 0) {\n"},
];
const digest = content => createHash("sha256").update(content).digest("hex");
const sha = async file => digest(await readFile(file));
const files = [...new Set(variants.map(variant => variant.file))];
const sources = guardSources(root, files);

async function build(name) {
  const result = await sources.run(cmake, ["--build", ".deps/build", "--parallel", "4", "--target", "fabric_godot"]);
  await writeFile(path.join(root, `build/accessibility-info-sabotage-${name}-build.log`), result.stdout + result.stderr);
  assert.equal(result.status, 0, `The ${name} host must build: build/accessibility-info-sabotage-${name}-build.log`);
}

const receipt = {format: "godot-fabric.accessibility-info-sabotage/v1", sourceSha256: {genuine: sources.genuine}, variants: []};
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
      entry.runStatus = (await sources.run(process.execPath, ["tests/accessibility-info-native.test.mjs", variant.argument])).status;
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
await writeFile(path.join(root, "build/accessibility-info-sabotage.json"), JSON.stringify(receipt, null, 2) + "\n");
for (const entry of receipt.variants) {
  assert.equal(entry.runStatus, 0, `The probe and oracle must reject the ${entry.name} host: build/accessibility-info-sabotage-${entry.name}.log`);
}
console.log(JSON.stringify(receipt, null, 2));
