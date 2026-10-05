import assert from "node:assert/strict";

// End may inspect the newly supported Up Maps. It must not retry Down, consume
// a Down fault, or turn an empty registry into delivery. Cancel never queries.
export function assertTerminalInterestQueries(rows, {cancel = false, installed = true} = {}) {
  assert.ok(Array.isArray(rows));
  if (cancel || !installed) { assert.deepEqual(rows, []); return; }
  assert.equal(rows.length % 2, 0, "Negative Up lookups retain bubble/capture pairs");
  for (let index = 0; index < rows.length; index += 2) {
    const pair = rows.slice(index, index + 2);
    assert.deepEqual(pair.map(row => row.offset), [36, 37]);
    for (const row of pair)
      assert.ok(row.action === "delegate" && row.matched === false && row.resultKind === "boolean" && row.result === false,
        "Only healthy false Up lookups are allowed; no Down retry or fault");
    for (const field of ["targetTag", "candidateTag", "isRootHandle", "name"])
      assert.equal(pair[0][field], pair[1][field], "Each negative phase pair belongs to one candidate");
  }
}
