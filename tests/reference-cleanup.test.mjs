import test from "node:test";
import assert from "node:assert/strict";
import { cleanupReference } from "../scripts/reference-cleanup.mjs";

test("cleanup attempts every resource and preserves the primary assertion error", async () => {
  const original = new Error("Native assertion failed");
  const attempted = [], logged = [];
  const actions = [
    async () => { attempted.push("simulator"); throw new Error("Shutdown failed"); },
    async () => { attempted.push("reverse"); throw new Error("Reverse removal failed"); },
  ];
  await assert.rejects(cleanupReference(actions, original, (...args) => logged.push(args)), (error) => error === original);
  assert.deepEqual(attempted, ["simulator", "reverse"]);
  assert.equal(logged.length, 2);
});
test("cleanup errors fail an otherwise successful run, and successful cleanup resolves", async () => {
  const failure = new Error("Shutdown failed");
  await assert.rejects(cleanupReference([async () => { throw failure; }], undefined, () => {}), (error) => error instanceof AggregateError && error.errors[0] === failure);
  await cleanupReference([async () => {}]);
});
