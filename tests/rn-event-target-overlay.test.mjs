import assert from "node:assert/strict";
import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {build} from "esbuild";
import {renderEventTargetParentOverlay} from "../sdk/toolchain/rn-event-target-overlay.mjs";
import {platformPlugin} from "../sdk/toolchain/platform-plugin.mjs";

const resolveSdk = createRequire(import.meta.url).resolve;
const rnRoot = path.dirname(resolveSdk("react-native/package.json"));
const source = await readFile(path.join(rnRoot, "src/private/webapis/dom/events/internals/EventTargetInternals.js"), "utf8");

test("original control returns the pinned input byte-for-byte", () => {
  assert.equal(renderEventTargetParentOverlay(source, "original"), source);
  assert.notEqual(renderEventTargetParentOverlay(source), source);
});

test("pin drift rejects both correction and original-control builds", () => {
  for (const mode of ["current", "original"])
    for (const drift of [source + "\n", source.replace("getEventTargetParent", "changedParent")])
      assert.throws(() => renderEventTargetParentOverlay(drift, mode), /E_EVENT_TARGET_OVERLAY_INPUT/);
});

test("applying correction twice fails rather than silently accepting generated input", () => {
  assert.throws(() => renderEventTargetParentOverlay(renderEventTargetParentOverlay(source)), /E_EVENT_TARGET_OVERLAY_INPUT/);
});

test("unsupported modes fail visibly at overlay and toolchain entry", () => {
  assert.throws(() => renderEventTargetParentOverlay(source, "unknown"), /E_EVENT_TARGET_OVERLAY_MODE/);
  assert.throws(() => platformPlugin("unused", resolveSdk, {eventTargetParentMode: "unknown"}), /E_EVENT_TARGET_OVERLAY_MODE/);
});

test("a project's matching module name retains project-owned source", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "godot-event-parent-seam-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const relative = "src/private/webapis/dom/events/internals/EventTargetInternals.js";
  await mkdir(path.dirname(path.join(directory, relative)), {recursive: true});
  await writeFile(path.join(directory, relative), 'export default "project-owned-event-parent";');
  await writeFile(path.join(directory, "App.js"), 'export {default} from "./' + relative + '";');
  const result = await build({absWorkingDir: directory, entryPoints: ["App.js"], bundle: true,
    write: false, format: "esm", metafile: true,
    plugins: [platformPlugin(path.resolve("src"), resolveSdk)]});
  assert.match(result.outputFiles[0].text, /project-owned-event-parent/);
  assert.equal(Object.keys(result.metafile.inputs).length, 2);
});
