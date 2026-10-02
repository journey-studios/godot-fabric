import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

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
