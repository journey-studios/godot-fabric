import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test, { after, before } from "node:test";
import { SOAK_FINAL_HASH } from "../scripts/frontier-comparison-run-campaign.mjs";
import { launchScenario, prepareProject } from "../scripts/frontier-comparison-run.mjs";

// The scripted player of the 100-turn soak, in GDScript (tests/frontier-comparison-player.gd), against the soak of JavaScript (tests/frontier-soak-fixture.jsx, `decide`). The same seed
// (4242), the same game, the same decisions: arm A (main_bare.tscn, the game with no HUD) must reach the same final hash, the same trail and the same number of decisions as the soak.
//
// The numbers are the soak of JavaScript's today, as `npm run test:frontier-soak` reports them ("The game after 100 turns, in 3 executions: final hash 0b21c332..., trail hash
// 4d6d3c4c...") and as docs/evidence/civ-lite-ui/README.md and report.json (`afterTheChange`: finalHash, trailHash, 429 decisions) record them. They are NOT the numbers
// docs/research/frontier-soak.md still prints (a35c55f2... and fe9d4f36..., lines 96 to 100): that note describes the run before #93, which added the three events of turn 5 and moved
// the state of the game. The final hash is the SHA-256 of the canonical serialization of the state after turn 100, `game.state_hash()`, and the trail hash is the SHA-256 of the hundred
// turn hashes, one per line (tests/frontier-soak-oracle.mjs, `trailHash`).
const FINAL_HASH = "0b21c332c1f86fb41522cdbed0144f168831f6ab51bc427769a68a146aa6afd0";
const TRAIL_HASH = "4d6d3c4c1078518f8971b76caef08a9b3ba6434c01fdc3658ce7787013d6371b";
const DECISIONS = 429;
const TURNS = 100;

const reportOf = async (run) => JSON.parse(await readFile(run.reportFile, "utf8"));

let prepared = null;
let genuine = null;

before(async () => {
  prepared = await prepareProject({ name: "frontier-comparison-player" });
});

after(async () => {
  await prepared?.harness.cleanup();
});

test("the player in GDScript plays the soak of JavaScript: the same final hash, the same trail and the same 429 decisions on arm A", async () => {
  const run = launchScenario({ prepared, arm: "A", lane: "presented" });
  assert.equal(run.process.exitCode, 0, run.log);
  genuine = await reportOf(run);
  const { game, anomalies, aborted } = genuine;
  assert.equal(aborted, "");
  assert.deepEqual(anomalies, []);
  assert.equal(game.soakTurnHashes.length, TURNS);
  assert.equal(new Set(game.soakTurnHashes).size, TURNS, "no two turns leave the game in the same state");
  assert.equal(game.soakTurnHashes.at(-1), FINAL_HASH, `the final hash after ${TURNS} turns`);
  assert.equal(game.soakFinalHash, FINAL_HASH);
  assert.equal(game.soakTrailHash, TRAIL_HASH, "the trail hash");
  assert.equal(game.soakDecisions, DECISIONS, "the number of decisions");
  assert.equal(game.soakRefusals, 0, "every call the player makes is one the snapshot offers as enabled, so the game accepts all of them");
  assert.equal(game.soakGameTurn, TURNS + 1);
  assert.equal(SOAK_FINAL_HASH, FINAL_HASH, "the runner registers the final hash pinned here");
  console.log(`The player in GDScript, ${TURNS} turns on arm A: final hash ${game.soakFinalHash}, trail hash ${game.soakTrailHash}, ${game.soakDecisions} decisions`);
});

test("a player that decides otherwise reaches another game, and the first turn at which it parts is found", async () => {
  assert.notEqual(genuine, null, "the equivalence test runs first");
  // A garrison of two units instead of six: the player builds fewer Warriors, so the state of the game is another from the turn the city has two.
  const file = path.join(prepared.harness.project, "comparison", "frontier-comparison-player.gd");
  const source = await readFile(file, "utf8");
  assert.equal(source.split("const GARRISON_CAP := 6").length, 2, "the control changes exactly one place");
  await writeFile(file, source.replace("const GARRISON_CAP := 6", "const GARRISON_CAP := 2"));
  const run = launchScenario({ prepared, arm: "A", lane: "presented" });
  assert.equal(run.process.exitCode, 0, run.log);
  const { game } = await reportOf(run);
  assert.notEqual(game.soakFinalHash, FINAL_HASH, "the final hash moved");
  assert.notEqual(game.soakTrailHash, TRAIL_HASH, "the trail hash moved");
  const parted = game.soakTurnHashes.findIndex((hash, index) => hash !== genuine.game.soakTurnHashes[index]);
  assert.ok(parted > 0 && parted < TURNS, `the hashes of the turns part at turn ${parted + 1}`);
  assert.deepEqual(game.soakTurnHashes.slice(0, parted), genuine.game.soakTurnHashes.slice(0, parted), "and agree before it");
  console.log(`The control (a garrison of two) parts from the genuine player at turn ${parted + 1}`);
});
