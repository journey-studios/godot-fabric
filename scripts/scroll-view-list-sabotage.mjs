// Run as a one-off node:test entrypoint without changing the normal suite's
// lane selection or discovering a duplicate *.test.mjs file.
process.argv.push("--lane", "sabotage");
await import("../tests/virtualized-list-native.test.mjs");
