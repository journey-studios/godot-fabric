import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {cp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {transformAsync} from "@babel/core";
import {build} from "esbuild";
import {platformPlugin} from "../sdk/toolchain/platform-plugin.mjs";
import {godotExtensions} from "../sdk/toolchain/platform-resolution.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const requireSdk = createRequire(import.meta.url);
const rnRoot = path.dirname(requireSdk.resolve("react-native/package.json"));
const digest = value => createHash("sha256").update(value).digest("hex");
// Local controls: the SDK this slice started from and a retained sabotage.
const precedingSdk = process.argv.includes("--preceding-sdk");
const sabotage = process.argv.includes("--sabotage");
const PRECEDING_COMMIT = "15e1dda2b2daa31650cc0bd427651499a33410eb";
const PRECEDING_FACADE_SHA256 = "32a54afe21b773defe4853fa26015364845a806d9afab3d51dd2bd8e55d38278";
const sources = ["tests/touchables-fixture.jsx", "tests/touchables-animated-fixture.jsx", "tests/touchables-probe.gd",
  "tests/touchables-native.test.mjs", "src/react-native-platform.jsx", "src/components.jsx", "src/text.jsx",
  "src/base-view-config.js", "src/render-application.jsx", "sdk/toolchain/platform-plugin.mjs", "sdk/toolchain/platform-resolution.mjs"];
const originalSources = ["Libraries/Components/Touchable/TouchableWithoutFeedback.js", "Libraries/Components/Touchable/TouchableHighlight.js",
  "Libraries/Components/Touchable/TouchableOpacity.js", "Libraries/Pressability/Pressability.js", "Libraries/Pressability/usePressability.js",
  "Libraries/Components/View/View.js", "Libraries/StyleSheet/StyleSheet.js", "Libraries/Animated/createAnimatedComponent.js",
  "src/private/animated/createAnimatedPropsHook.js", "src/private/animated/NativeAnimatedHelper.js",
  "Libraries/Renderer/implementations/ReactFabric-prod.js"];
const CHILDREN_ONLY = "React.Children.only expected to receive a single React element child.";
const OPACITY = "Godot platform does not implement TouchableOpacity: its original Animated.View requires NativeAnimatedModule, which Godot does not provide yet";
const INLINE = "Inline Controls are not implemented in Godot Text";
const STYLE = "Godot TouchableHighlight does not implement style shadowColor";
const CASES = ["twf", "th", "long", "delayed", "slop", "disabled", "nested", "card", "removable", "toggle", "text", "caption"];
// Fixture props, read here independently of the probe: each host's own
// background, and each TouchableHighlight's underlay and child activeOpacity
// (RN's default is 0.85). card and outer style a TouchableWithoutFeedback child.
const BASE = {twf: "334155ff", th: "16a34aff", "th-child": "2563ebff", long: "0f766eff", "long-child": "1d4ed8ff",
  delayed: "334155ff", "delayed-child": "0891b2ff", slop: "a16207ff", disabled: "64748bff", "disabled-child": "94a3b8ff",
  outer: "1e293bff", inner: "be185dff", card: "1e293bff", "card-button": "4d7c0fff", removable: "475569ff",
  "removable-child": "7e22ceff", toggle: "365314ff", "toggle-child": "b45309ff", label: "0f766eff", "label-child": "00000000",
  caption: "7c2d12ff"};
const UNDERLAY = {th: ["dc2626ff", 0.4], long: ["7c3aedff", 0.85], delayed: ["ea580cff", 0.6], removable: ["f43f5eff", 0.5],
  toggle: ["22d3eeff", 0.85], label: ["1d4ed8ff", 0.6], card: ["0ea5e9ff", null]};
// TouchableWithoutFeedback and TouchableHighlight pass minPressDuration 0, so
// Pressability deactivates (onPressOut) before it presses on release. The
// Highlight shows its underlay before onPressIn, hides it in onPressOut, shows
// it again in onPress and hides it from a delayPressOut (here 0 ms) timer.
const TWF_DOWN = ["in"], TWF_UP = ["out", "press"];
const TH_DOWN = ["show", "in"], TH_UP = ["hide", "out", "show", "press", "hide"];
// hitSlop {8, 12, 8, 12} and pressRetentionOffset {10, 14, 10, 14} of the slop case.
const SLOP = {top: 8, left: 12, bottom: 8, right: 12}, RETENTION = {top: 10, left: 14, bottom: 10, right: 14};
// The preceding SDK exported every touchable as a placeholder that throws at
// render; a case reports the first touchable it renders.
const PRECEDING = {twf: "TouchableWithoutFeedback", th: "TouchableHighlight", long: "TouchableHighlight", delayed: "TouchableHighlight",
  slop: "TouchableWithoutFeedback", disabled: "TouchableHighlight", nested: "TouchableHighlight", card: "TouchableHighlight",
  removable: "TouchableHighlight", toggle: "TouchableHighlight", text: "TouchableHighlight", caption: "TouchableWithoutFeedback",
  "single-two": "TouchableHighlight",
  "single-none": "TouchableWithoutFeedback", opacity: "TouchableOpacity", inline: "TouchableHighlight", style: "TouchableHighlight"};
const precedingFailures = [...CASES.map(name => `mount/${name}/The original touchable commits its hosts at rest in both roots without a render error`),
  "mount/th-ref/A ref on TouchableHighlight reaches its native host in both roots",
  "mount/single-two/TouchableHighlight with two children fails at render with React.Children.only",
  "mount/single-none/TouchableWithoutFeedback without a child fails at render with React.Children.only",
  "mount/opacity/TouchableOpacity fails at render with its explicit NativeAnimatedModule reason",
  "mount/inline/TouchableHighlight inside Text fails at render as an inline Control",
  "mount/style/TouchableHighlight rejects a style its native View does not implement",
  "mount/render-errors/Only the single-child, contract and TouchableOpacity cases fail at render"];

async function optionalFile(file) {
  try { return await readFile(path.join(root, file)); }
  catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
const near = (actual, expected) => typeof actual === "number" && Math.abs(actual - expected) < 1e-4;
const types = rows => rows.map(row => row.type);

// RN's original TouchableOpacity reaches FlatList/SectionList through
// AnimatedExports' lazy getters, and AnimatedColor imports the platform color
// module, which has no Godot variant. Neither runs on the mount path the
// animated lane observes; this test-only seam lets that original bundle build.
const animatedSeams = {name: "touchables-animated-seams", setup(builder) {
  builder.onResolve({filter: /^\.\/components\/Animated(?:Flat|Section)List$/}, ({importer}) =>
    importer === path.join(rnRoot, "Libraries/Animated/AnimatedExports.js") ? {path: "lists", namespace: "touchables-seam"} : undefined);
  builder.onResolve({filter: /^\.\.\/\.\.\/StyleSheet\/PlatformColorValueTypes$/}, ({importer}) =>
    importer === path.join(rnRoot, "Libraries/Animated/nodes/AnimatedColor.js") ? {path: "colors", namespace: "touchables-seam"} : undefined);
  builder.onLoad({filter: /.*/, namespace: "touchables-seam"}, ({path: kind}) => ({loader: "js", contents: kind === "lists"
    ? "export default function AnimatedListOutsideProbe() { throw new Error('Animated lists are outside the touchables probe'); }"
    : "export function processColorObject() { return null; }"}));
}};

// The public consumer build: default platform options and production defines.
async function bundle(lane, entry, platformRoot, plugins = []) {
  const outfile = path.join(root, `build/touchables-${lane}.js`);
  const result = await build({absWorkingDir: root, entryPoints: [entry], outfile, bundle: true, platform: "neutral", format: "iife",
    metafile: true, logLevel: "silent", define: {"process.env.NODE_ENV": '"production"', __DEV__: "false"},
    mainFields: ["main"], resolveExtensions: godotExtensions,
    plugins: [...plugins, platformPlugin(platformRoot, id => requireSdk.resolve(id))]});
  // Hermes needs the RN syntax transforms on bundler helpers too.
  const code = (await transformAsync(await readFile(outfile, "utf8"), {filename: outfile, configFile: false, babelrc: false,
    presets: [["@react-native/babel-preset", {disableImportExportTransform: true, enableBabelRuntime: false}]]})).code + "\n";
  await writeFile(outfile, code);
  return {sha256: digest(code), platformRoot: path.relative(root, platformRoot),
    facadeSha256: digest(await readFile(path.join(platformRoot, "react-native-platform.jsx"))),
    inputs: Object.keys(result.metafile.inputs).sort()};
}

// Pins the harness and every bundled file outside node_modules, so a control
// lane records the exact SDK it bundled.
async function provenance(bundled) {
  const files = [...new Set([...sources, ...bundled.inputs.filter(file => !file.startsWith("node_modules/") && !file.includes(":"))])].sort();
  return {node: process.version, nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))),
    sources: Object.fromEntries(await Promise.all(files.map(async file => [file, digest(await readFile(path.join(root, file)))]))),
    originalReactNativeSources: Object.fromEntries(await Promise.all(originalSources
      .map(async file => [file, digest(await readFile(path.join(rnRoot, file)))])))};
}

async function runLane(binary, lane, bundled) {
  await rm(path.join(root, "build/touchables-report.json"), {force: true});
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/touchables-probe.gd", "--", "--lane", lane],
    {encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, `build/touchables-${lane}.log`), log);
  const bytes = await optionalFile("build/touchables-report.json");
  const report = bytes == null ? null : JSON.parse(bytes);
  if (report != null) {
    report.provenance = {...await provenance(bundled), bundle: bundled};
    await writeFile(path.join(root, `build/touchables-${lane}-report.json`), JSON.stringify(report, null, 2) + "\n");
  }
  // Save artifacts before asserting. Every lane exits cleanly and hides no
  // engine, script or native error behind its own check failures.
  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.equal(result.status, 0, log);
  assert.ok(report != null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual([...checkErrors].sort(), [...failures].sort());
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, checkErrors.length, "No native diagnostic, script or engine error is hidden");
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  assert.equal(report.scenario, "native-touchables");
  assert.equal(report.lane, lane);
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, "headless");
  return {report, log, failures};
}

function payload(report, row, {root: rootName, registration, target, current = target, page, touches}) {
  const hosts = report.geometry[rootName].hosts;
  assert.equal(row.root, rootName);
  assert.equal(row.registration, registration);
  assert.equal(row.target, hosts[target].tag);
  assert.equal(row.currentTarget, current == null ? null : hosts[current].tag);
  const [x, y] = hosts[target].page;
  assert.ok(near(row.pageX, page[0]) && near(row.pageY, page[1]), JSON.stringify(row));
  assert.ok(near(row.locationX, page[0] - x) && near(row.locationY, page[1] - y), JSON.stringify(row));
  assert.equal(row.touches, touches);
  assert.equal(row.changedTouches, 1);
  assert.ok(row.timestamp > 0);
}
function idle(stage) {
  assert.equal(stage.pointer.responder, 0);
  assert.equal(stage.pointer.activeTouches, 0);
}
function look(report, value, id, pressed) {
  if (pressed) {
    assert.equal(value.background, UNDERLAY[id][0]);
    assert.ok(near(value.childOpacity, UNDERLAY[id][1]));
  } else {
    assert.equal(value.background, BASE[id]);
    assert.ok(near(value.childOpacity, 1));
  }
}
// One gesture on a TouchableWithoutFeedback whose child is the responder.
function verifyTwf(report, prefix, rootName, id) {
  const down = report.stages[prefix + "/down"], up = report.stages[prefix + "/up"];
  assert.deepEqual(types(down.events), TWF_DOWN, prefix);
  assert.deepEqual(types(up.events), TWF_UP, prefix);
  assert.ok([...down.events, ...up.events].every(row => row.id === id), prefix);
  payload(report, down.events[0], {root: rootName, registration: "onResponderGrant", target: id, page: down.page, touches: 1});
  for (const row of up.events) {
    payload(report, row, {root: rootName, registration: "onResponderRelease", target: id, page: up.page, touches: 0});
  }
  assert.equal(up.events[0].payloadId, up.events[1].payloadId);
  assert.notEqual(up.events[0].payloadId, down.events[0].payloadId);
  assert.ok([down.events[0], ...up.events].every(row => row.identifier === down.events[0].identifier));
  assert.ok(up.events[0].timestamp >= down.events[0].timestamp);
  assert.equal(down.pointer.responder, report.geometry[rootName].hosts[id].tag);
  idle(up);
}
function verifyHighlight(report, prefix, rootName, id) {
  const down = report.stages[prefix + "/down"], up = report.stages[prefix + "/up"];
  assert.deepEqual(types(down.events), TH_DOWN, prefix);
  assert.deepEqual(types(up.events), TH_UP, prefix);
  assert.ok([...down.events, ...up.events].every(row => row.id === id && row.root === rootName), prefix);
  payload(report, down.events[1], {root: rootName, registration: "onResponderGrant", target: id + "-child", current: id, page: down.page, touches: 1});
  for (const row of [up.events[1], up.events[3]]) {
    payload(report, row, {root: rootName, registration: "onResponderRelease", target: id + "-child", current: id, page: up.page, touches: 0});
  }
  assert.equal(up.events[1].payloadId, up.events[3].payloadId);
  look(report, down.look, id, true);
  // Each sampled frame shows one of the two looks, ending at rest.
  for (const sample of up.samples) {
    look(report, sample, id, sample.background === UNDERLAY[id][0]);
  }
  look(report, up.samples.at(-1), id, false);
  idle(up);
}
// Pressability's region: the measured host plus hitSlop and the retention
// offset, with strict bounds; a move toggles activation across it.
function verifyRetention(report, prefix, phases) {
  const [x, y, width, height] = report.geometry.A.hosts.slop.page;
  const inside = ([px, py]) => px > x - SLOP.left - RETENTION.left && px < x + width + SLOP.right + RETENTION.right &&
    py > y - SLOP.top - RETENTION.top && py < y + height + SLOP.bottom + RETENTION.bottom;
  let active = false;
  const rows = [];
  for (const phase of phases) {
    const stage = report.stages[`${prefix}/${phase}`];
    let expected = [];
    if (stage.phase === "down") {
      expected = ["in"];
      active = true;
    } else if (stage.phase === "up") {
      expected = active ? ["out", "press"] : [];
      active = false;
    } else if (active !== inside(stage.page)) {
      expected = [active ? "out" : "in"];
      active = !active;
    }
    assert.deepEqual(types(stage.events), expected, `${prefix}/${phase}`);
    const registration = {down: "onResponderGrant", move: "onResponderMove", up: "onResponderRelease"}[stage.phase];
    for (const row of stage.events) {
      payload(report, row, {root: "A", registration, target: "slop", page: stage.page, touches: stage.phase === "up" ? 0 : 1});
    }
    rows.push(...stage.events);
  }
  assert.ok(rows.every(row => row.identifier === rows[0].identifier));
  return rows;
}

// Independent oracle over the probe's raw observations, by behavior. Controls
// run it without the probe's own status gates, so only observations reject.
const sections = {
  mount(report) {
    const errors = report.stages.mount.renderErrors.map(row => [row.root, row.case, row.message]);
    assert.deepEqual(errors, ["A", "B"].flatMap(name => [[name, "single-two", CHILDREN_ONLY], [name, "single-none", CHILDREN_ONLY],
      [name, "opacity", OPACITY], [name, "inline", INLINE], [name, "style", STYLE]]));
    for (const name of ["A", "B"]) {
      for (const [id, background] of Object.entries(BASE)) {
        const host = report.geometry[name].hosts[id];
        assert.ok(host.tag > 0 && host.background === background && near(host.opacity, 1), `${name}-${id}`);
      }
      assert.equal(report.stages.mount.refs[name + "-th"], report.geometry[name].hosts.th.tag);
    }
    const tags = ["A", "B"].flatMap(name => Object.values(report.geometry[name].hosts).map(host => host.tag));
    assert.equal(new Set(tags).size, 2 * Object.keys(BASE).length);
    const sentinel = [...report.stages["sentinel/down"].events, ...report.stages["sentinel/up"].events];
    assert.equal(sentinel.filter(row => row.type === "press").length, 1);
  },
  withoutFeedback(report) {
    verifyTwf(report, "twf/mouse", "A", "twf");
    verifyTwf(report, "twf/touch", "A", "twf");
  },
  highlight(report) {
    verifyHighlight(report, "th/A/mouse", "A", "th");
    verifyHighlight(report, "th/A/touch", "A", "th");
  },
  // Text children: the Highlight dims its paragraph; the paragraph responds.
  textChildren(report) {
    verifyHighlight(report, "text/label/mouse", "A", "label");
    verifyTwf(report, "text/caption/touch", "A", "caption");
  },
  // delayPressOut 160: press at once, then the persisted release event.
  delayPressOut(report) {
    const delayed = report.stages["delayed/mouse/up"];
    assert.deepEqual(types(report.stages["delayed/mouse/down"].events), TH_DOWN);
    assert.deepEqual(types(delayed.events), ["show", "press", "out", "hide"]);
    payload(report, delayed.events[1], {root: "A", registration: "onResponderRelease", target: "delayed-child", current: "delayed", page: delayed.page, touches: 0});
    assert.equal(delayed.events[2].registration, "onResponderRelease");
    assert.equal(delayed.events[2].currentTarget, null);
    assert.equal(delayed.events[2].payloadId, delayed.events[1].payloadId);
    assert.ok(delayed.events[2].at - delayed.events[1].at >= 159);
    const within = delayed.samples.filter(sample => sample.elapsed < 150);
    assert.ok(within.length > 0);
    for (const sample of within) {
      look(report, sample.look, "delayed", true);
    }
    look(report, delayed.samples.at(-1).look, "delayed", false);
  },
  // delayLongPress 250: the persisted grant event, without a later press;
  // moving 15 px exceeds RN's 10 px long-press deactivation distance only.
  longPress(report) {
    const down = report.stages["long/touch/down"], hold = report.stages["long/touch/hold"], up = report.stages["long/touch/up"];
    assert.deepEqual(types(down.events), TH_DOWN);
    assert.deepEqual(types(hold.events), ["long"]);
    assert.ok(hold.events[0].at - down.events[1].at >= 249);
    assert.equal(hold.events[0].registration, "onResponderGrant");
    assert.equal(hold.events[0].currentTarget, null);
    assert.equal(hold.events[0].payloadId, down.events[1].payloadId);
    look(report, hold.look, "long", true);
    assert.deepEqual(types(up.events), ["hide", "out"]);
    payload(report, up.events[1], {root: "A", registration: "onResponderRelease", target: "long-child", current: "long", page: up.page, touches: 0});
    const moved = report.stages["long/moved/hold"];
    assert.deepEqual(types(moved.events), TH_DOWN);
    payload(report, moved.events[1], {root: "A", registration: "onResponderGrant", target: "long-child", current: "long", page: moved.page, touches: 1});
    assert.ok(moved.moveAfterMs < 200 && Math.hypot(moved.movePage[0] - moved.page[0], moved.movePage[1] - moved.page[1]) > 10);
    assert.deepEqual(types(report.stages["long/moved/up"].events), TH_UP);
  },
  // Native hit testing honors hitSlop; Pressability then owns retention.
  hitSlopAndRetention(report) {
    const [x, y, width, height] = report.geometry.A.hosts.slop.page;
    const hit = report.stages["slop/hit-slop/down"].page, miss = report.stages["slop/outside/down"].page;
    assert.ok(hit[0] >= x - SLOP.left && hit[0] < x && hit[1] > y && hit[1] < y + height);
    assert.ok(miss[0] < x - SLOP.left);
    verifyRetention(report, "slop/hit-slop", ["down", "up"]);
    assert.deepEqual([...report.stages["slop/outside/down"].events, ...report.stages["slop/outside/up"].events], []);
    assert.equal(report.stages["slop/outside/down"].pointer.responder, 0);
    assert.deepEqual(types(verifyRetention(report, "slop/retention", ["down", "far", "near", "up"])), ["in", "out", "in", "out", "press"]);
    assert.ok(report.stages["slop/retention/up"].page[0] > x + width);
    assert.deepEqual(types(verifyRetention(report, "slop/release-outside", ["down", "far", "up"])), ["in", "out"]);
    assert.deepEqual(types(verifyRetention(report, "slop/touch", ["down", "far", "near", "up"])), ["in", "out", "in", "out", "press"]);
  },
  // Disabled: never granted; a disabled inner one lets its ancestor claim.
  disabled(report) {
    assert.deepEqual([...report.stages["disabled/down"].events, ...report.stages["disabled/up"].events], []);
    assert.equal(report.stages["disabled/down"].pointer.responder, 0);
    look(report, report.stages["disabled/down"].look, "disabled", false);
    const card = report.stages["card/down"];
    assert.deepEqual(card.events.map(row => row.id + ":" + row.type), ["card:show", "card:in"]);
    payload(report, card.events[1], {root: "A", registration: "onResponderGrant", target: "card-button", current: "card", page: card.page, touches: 1});
    assert.equal(card.look.background, UNDERLAY.card[0]);
    assert.ok(near(card.look.buttonOpacity, 1));
    assert.deepEqual(report.stages["card/up"].events.map(row => row.id + ":" + row.type), TH_UP.map(type => "card:" + type));
  },
  // The deepest touchable is the responder; the outer one stays idle.
  nested(report) {
    for (const device of ["mouse", "touch"]) {
      verifyTwf(report, "nested/" + device, "A", "inner");
      assert.equal(report.stages[`nested/${device}/down`].outer, BASE.outer);
    }
  },
  // disabled only gates the grant: a granted press completes.
  disabledMidPress(report) {
    assert.deepEqual(types(report.stages["toggle/down"].events), TH_DOWN);
    assert.deepEqual(report.stages["toggle/disable"].events, []);
    assert.equal(report.stages["toggle/disable"].pointer.responder, report.geometry.A.hosts.toggle.tag);
    assert.deepEqual(types(report.stages["toggle/up"].events), TH_UP);
    assert.deepEqual([...report.stages["toggle/disabled-down"].events, ...report.stages["toggle/disabled-up"].events], []);
  },
  // Removal mid-press: one native cancel, no callback, a clean remount.
  removal(report) {
    const removal = report.stages["removable/remove"];
    assert.deepEqual(types(report.stages["removable/down"].events), TH_DOWN);
    assert.ok(!removal.present && removal.events.length === 0 && removal.after.cancels === removal.before.cancels + 1);
    assert.ok(removal.after.responder === 0 && removal.after.activeTouches === 0);
    assert.deepEqual([...report.stages["removable/late"].events, ...report.stages["removable/up"].events], []);
    assert.deepEqual(types(report.stages["removable/again-down"].events), TH_DOWN);
    assert.deepEqual(types(report.stages["removable/again-up"].events), TH_UP);
  },
  // Two roots: B's gestures report only B and B-relative pages.
  roots(report) {
    verifyHighlight(report, "th/B/touch", "B", "th");
    verifyTwf(report, "roots/twf", "B", "twf");
    assert.ok(report.stages["roots/twf/down"].page[0] < 400 && report.stages["roots/twf/down"].global[0] >= 420);
    for (const [name, stage] of Object.entries(report.stages)) {
      if (name.startsWith("th/B/") || name.startsWith("roots/")) {
        assert.ok(stage.events.every(row => row.root === "B"), name);
      } else if (Array.isArray(stage.events)) {
        assert.ok(stage.events.every(row => row.root === "A"), name);
      }
    }
  },
  stop(report) {
    const stopped = report.stages.afterStop;
    assert.ok(stopped.stopped && stopped.rootCount === 0 && stopped.pendingTimers === 0 && stopped.errors.length === 0);
  },
};
function verifyCurrent(report) {
  assert.equal(report.allCurrentAssertionsPassed, true);
  assert.ok(report.checks.every(row => row.passed));
  assert.deepEqual([...report.expectedPrecedingFailures].sort(), [...precedingFailures].sort());
  for (const section of Object.values(sections)) {
    section(report);
  }
}
// Each oracle section's first rejected observation in a control report.
function oracleRejections(report) {
  return Object.fromEntries(Object.entries(sections).map(([name, section]) => {
    try {
      section(report);
      return [name, null];
    } catch (error) {
      return [name, error.message.replace(/\s+/g, " ").slice(0, 300)];
    }
  }));
}

function verifyAnimated(report) {
  assert.ok(report.allCurrentAssertionsPassed && report.checks.every(row => row.passed));
  const stage = report.stages.animated;
  assert.deepEqual(stage.renderErrors.map(row => [row.root, row.case, row.name, row.message]),
    [["A", "opacity", "Invariant Violation", "Native animated module is not available"]]);
  assert.equal(stage.hosts.length, 2);
  assert.ok(Number.isInteger(stage.hosts[0]) && stage.hosts[0] > 0 && stage.hosts[1] === null);
  assert.deepEqual(stage.application.errors, []);
  assert.ok(!stage.root.nodes.some(node => node.testID === "A-opacity") && stage.root.nodes.some(node => node.testID === "A-sibling"));
}

async function precedingSdkRoot() {
  const target = path.join(root, "build/touchables-preceding-sdk");
  await rm(target, {recursive: true, force: true});
  const listed = spawnSync("git", ["ls-tree", "-r", "--name-only", PRECEDING_COMMIT, "src"], {cwd: root, encoding: "utf8"});
  assert.equal(listed.status, 0, "The preceding SDK control needs commit " + PRECEDING_COMMIT + " locally");
  for (const file of listed.stdout.trim().split("\n")) {
    const shown = spawnSync("git", ["show", `${PRECEDING_COMMIT}:${file}`], {cwd: root, maxBuffer: 16 * 1024 * 1024});
    assert.equal(shown.status, 0);
    await mkdir(path.dirname(path.join(target, file)), {recursive: true});
    await writeFile(path.join(target, file), shown.stdout);
  }
  assert.equal(digest(await readFile(path.join(target, "src/react-native-platform.jsx"))), PRECEDING_FACADE_SHA256);
  return path.join(target, "src");
}

// A plausible shortcut over the SDK Pressable instead of RN's originals.
async function sabotageRoot() {
  const target = path.join(root, "build/touchables-sabotage");
  await rm(target, {recursive: true, force: true});
  await cp(path.join(root, "src"), path.join(target, "src"), {recursive: true});
  const facade = path.join(target, "src/react-native-platform.jsx");
  let source = await readFile(facade, "utf8");
  const replace = (start, end, replacement) => {
    const from = source.indexOf(start), to = source.indexOf(end, from);
    assert.ok(from >= 0 && to > from && source.indexOf(start, from + 1) < 0, "Sabotage anchor: " + start);
    source = source.slice(0, from) + replacement + source.slice(to);
  };
  replace("export function TouchableWithoutFeedback(", "export function TouchableHighlight(",
    "export function TouchableWithoutFeedback({ children, ...props }) {\n  return <Pressable {...props}>{children}</Pressable>;\n}\n");
  replace("export function TouchableHighlight(", "// RN 0.87.1 TouchableOpacity",
    "export function TouchableHighlight({ children, style, underlayColor = \"black\", activeOpacity = 0.85, onShowUnderlay, onHideUnderlay, ...props }) {\n" +
    "  const child = React.Children.only(children);\n" +
    "  return <Pressable {...props} style={({ pressed }) => [nativeStyle(style, \"TouchableHighlight\"), pressed ? { backgroundColor: underlayColor } : null]}>\n" +
    "    {({ pressed }) => React.cloneElement(child, { style: [child.props.style, pressed ? { opacity: activeOpacity } : null] })}\n" +
    "  </Pressable>;\n}\n");
  await writeFile(facade, source);
  return {platformRoot: path.join(target, "src"), facadeSha256: digest(source)};
}

test("public touchables run RN's original modules on real Godot input", async () => {
  const binary = await ensureGodotBinary();
  const facadeBefore = digest(await readFile(path.join(root, "src/react-native-platform.jsx")));
  const current = await bundle("current", "tests/touchables-fixture.jsx", path.join(root, "src"));
  for (const file of ["Libraries/Components/Touchable/TouchableWithoutFeedback.js", "Libraries/Components/Touchable/TouchableHighlight.js",
    "Libraries/Pressability/Pressability.js", "Libraries/Components/View/View.js"]) {
    assert.ok(current.inputs.includes("node_modules/react-native/" + file), "The public bundle runs the original module: " + file);
  }
  assert.ok(!current.inputs.some(file => file.endsWith("Touchable/TouchableOpacity.js") || file.includes("react-native/Libraries/Animated/")),
    "The public facade neither bundles TouchableOpacity nor Animated");
  const lane = await runLane(binary, "current", current);
  assert.deepEqual(lane.failures, []);
  assert.match(lane.log, new RegExp(`TOUCHABLES_PASSED: ${lane.report.checks.length}$`, "m"));
  verifyCurrent(lane.report);
  assert.ok(Object.values(oracleRejections(lane.report)).every(value => value === null));

  const animated = await bundle("animated", "tests/touchables-animated-fixture.jsx", path.join(root, "src"), [animatedSeams]);
  for (const file of ["Libraries/Components/Touchable/TouchableOpacity.js", "Libraries/Animated/createAnimatedComponent.js",
    "src/private/animated/createAnimatedPropsHook.js", "src/private/animated/NativeAnimatedHelper.js"]) {
    assert.ok(animated.inputs.includes("node_modules/react-native/" + file), "The animated lane runs the original module: " + file);
  }
  // The seam keeps RN's Animated list wrappers out of this lane; the facade's
  // lazy getters still bundle the original lists, as RN's index.js does.
  assert.ok(!animated.inputs.some(file => /react-native\/Libraries\/Animated\/components\/Animated(?:Flat|Section)List\.js$/.test(file)));
  const animatedLane = await runLane(binary, "animated", animated);
  assert.match(animatedLane.log, new RegExp(`TOUCHABLES_ANIMATED_UNAVAILABLE: ${animatedLane.report.checks.length}$`, "m"));
  verifyAnimated(animatedLane.report);

  const comparison = {scenario: "native-touchables", current: {checks: lane.report.checks.length, bundleSha256: current.sha256},
    animated: {checks: animatedLane.report.checks.length, bundleSha256: animated.sha256}};
  if (precedingSdk) {
    const preceding = await bundle("preceding-sdk", "tests/touchables-fixture.jsx", await precedingSdkRoot());
    const precedingLane = await runLane(binary, "preceding-sdk", preceding);
    // Exactly the render checks fail, each for its placeholder's own error.
    assert.ok(precedingLane.report.precedingNegativeObserved);
    assert.deepEqual([...precedingLane.failures].sort(), [...precedingFailures].sort());
    assert.match(precedingLane.log, new RegExp(`TOUCHABLES_PRECEDING_NEGATIVE: ${precedingFailures.length}$`, "m"));
    assert.deepEqual(precedingLane.report.stages.mount.renderErrors.map(row => [row.root, row.case, row.message]),
      ["A", "B"].flatMap(name => Object.entries(PRECEDING).map(([key, component]) => [name, key, "Godot platform does not implement " + component])));
    for (const name of ["A", "B"]) {
      assert.ok(Object.values(precedingLane.report.geometry[name].hosts).every(host => host.tag === -1));
    }
    assert.ok(precedingLane.report.checks.some(row => row.name.startsWith("sentinel/") && row.passed));
    // Only the mount and stop stages exist without touchables to press.
    const rejected = oracleRejections(precedingLane.report);
    assert.ok(rejected.mount != null && rejected.stop == null, "The independent oracle rejects the preceding SDK at render");
    comparison.precedingSdk = {commit: PRECEDING_COMMIT, facadeSha256: PRECEDING_FACADE_SHA256, bundleSha256: preceding.sha256,
      checks: precedingLane.report.checks.length, failures: precedingLane.failures, oracleRejections: rejected};
  }
  if (sabotage) {
    const sabotaged = await sabotageRoot();
    const sabotageBundle = await bundle("sabotage", "tests/touchables-fixture.jsx", sabotaged.platformRoot);
    const sabotageLane = await runLane(binary, "sabotage", sabotageBundle);
    assert.ok(sabotageLane.failures.length > 0);
    assert.match(sabotageLane.log, new RegExp(`TOUCHABLES_SABOTAGE_REJECTED: ${sabotageLane.failures.length}$`, "m"));
    const rejected = oracleRejections(sabotageLane.report);
    assert.ok(Object.values(rejected).some(Boolean), "The independent oracle rejects the sabotaged SDK");
    comparison.sabotage = {facadeSha256: sabotaged.facadeSha256, bundleSha256: sabotageBundle.sha256,
      checks: sabotageLane.report.checks.length, failures: sabotageLane.failures, oracleRejections: rejected};
  }
  assert.equal(digest(await readFile(path.join(root, "src/react-native-platform.jsx"))), facadeBefore, "Controls never edit the SDK source");
  await writeFile(path.join(root, "build/touchables-comparison.json"), JSON.stringify(comparison, null, 2) + "\n");
});
