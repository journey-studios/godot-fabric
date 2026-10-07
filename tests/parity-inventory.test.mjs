import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const inventory = JSON.parse(readFileSync(new URL("../docs/compatibility/contracts-0.87.1.json", import.meta.url)));
const row = (id) => inventory.contracts.find((contract) => contract.id === id);

test("inventory resolves inherited contracts and retains overloads, without claiming coverage", () => {
  assert.equal(inventory.counts.value, 97);
  assert.equal(new Set(inventory.contracts.map((contract) => contract.id)).size, inventory.contracts.length);
  for (const id of ["event:ViewProps.onLayout", "prop:TextInputProps.value", "style:TextStyle.fontSize", "style:ViewStyle.flexDirection", "ref-member:ViewInstance.measure", "api-member:AccessibilityInfo.announceForAccessibility", "global-value:global.setTimeout"]) {
    assert.ok(row(id), id);
    assert.notEqual(row(id).type, "any", id);
    assert.equal(row(id).status, undefined, "Declaration presence must not imply behavioral success");
  }
  assert.match(row("global-value:global.setTimeout").type, /\{.*;.*\}/);
  assert.ok(inventory.upstreamFiles.length > 100);
  assert.equal(row("global-member:Request.cache"), undefined, "Browser members must not become RN contracts");
  assert.ok(row("global-member:FormData.append"));
  assert.ok(row("global-member:AbortController.abort"));
  assert.ok(row("global-type:global.FormData"));
});

test("the check rejects drift and preserves the reviewed inventory", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "fabric-inventory-"));
  try {
    const file = path.join(directory, "inventory.json");
    writeFileSync(file, JSON.stringify({ ...inventory, contracts: inventory.contracts.slice(1) }));
    const before = readFileSync(file, "utf8");
    const result = spawnSync(process.execPath, ["scripts/parity-inventory.mjs", "--check", "--output", file], { encoding: "utf8", timeout: 30000 });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /Parity inventory drift/);
    assert.equal(readFileSync(file, "utf8"), before);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the status board counts every export form the facade can use", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "fabric-status-"));
  try {
    mkdirSync(path.join(directory, "docs/compatibility"), { recursive: true });
    mkdirSync(path.join(directory, "src"));
    writeFileSync(path.join(directory, "docs/compatibility/contracts-0.87.1.json"), readFileSync(new URL("../docs/compatibility/contracts-0.87.1.json", import.meta.url)));
    writeFileSync(path.join(directory, "src/react-native-platform.jsx"), [
      'export { default as Animated } from "./animated";',
      'export { AppState, Appearance } from "./environment";',
      'export * as TurboModuleRegistry from "./registry";',
      "export function View() { return null; }",
      "export class Pressable {}",
      "export const Text = () => null;",
      'export const Image = unavailable("Image");',
    ].join("\n"));
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/parity-status.mjs", import.meta.url))], { cwd: directory, encoding: "utf8", timeout: 30000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const report = JSON.parse(readFileSync(path.join(directory, "build/parity-status.json"), "utf8"));
    const status = Object.fromEntries(report.exports.map((entry) => [entry.name, entry.status]));
    for (const name of ["Animated", "AppState", "Appearance", "TurboModuleRegistry", "View", "Pressable", "Text"]) assert.equal(status[name], "exported_unverified", name);
    assert.equal(status.Image, "explicit_placeholder");
    assert.equal(status.Switch, "missing");
    assert.deepEqual(report.facadeNames, { exported_unverified: 7, explicit_placeholder: 1, missing: 89 });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
