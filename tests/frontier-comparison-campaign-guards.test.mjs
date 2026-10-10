import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { runCampaign } from "../scripts/frontier-comparison-campaign.mjs";
import { runSelfCheck } from "../scripts/frontier-comparison-campaign-instrument.mjs";
import { acquireLock, defaultLockFile, isAlive } from "../scripts/frontier-comparison-campaign-lock.mjs";
import { fakeClock, fakeLauncher, scriptedLoad, selfCheck, sha, where } from "./frontier-comparison-campaign-fake.mjs";
import { readProtocol, withResamples } from "./frontier-comparison-synthetic.mjs";

// What the campaign does to the machine and what it asks of it, with the machine replaced (V05-10, `execucao`, part 2): the lock against two campaigns on one machine, and the instrument's
// self-check, in a headless or a windowed lane, run against a probe process and an oracle that the test supplies. Nothing runs, no window opens and nothing here was measured. The campaign
// as a whole is tests/frontier-comparison-campaign.test.mjs and the self-check for real is tests/frontier-comparison-campaign-native.test.mjs.
const { protocol, protocolSha256 } = withResamples(readProtocol().protocol, 200);

let scratch = null;
before(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "frontier-comparison-campaign-guards-"));
});
after(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const exists = (file) => stat(file).then(() => true, () => false);
const lockPath = (name) => path.join(scratch, `${name}.lock`);
// The pid of a process that has ended: nothing lives under it.
const deadPid = () => spawnSync(process.execPath, ["-e", ""]).pid;

test("the lock is taken with the pid and the directory of the campaign, refuses a live holder, takes over a dead one's and is released", async () => {
  const file = lockPath("unit");
  const release = await acquireLock({ file, out: "/campaigns/first", pid: 4001, alive: () => false });
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { pid: 4001, out: "/campaigns/first" });
  // A holder that is alive refuses the second campaign and is left alone.
  await assert.rejects(acquireLock({ file, out: "/campaigns/second", pid: 4002, alive: (pid) => pid === 4001 }), /another campaign is running on this machine \(pid 4001, --out \/campaigns\/first\)/);
  assert.equal(JSON.parse(await readFile(file, "utf8")).pid, 4001);
  // A holder that is dead was killed: the lock is old, and the second campaign takes it.
  const taken = await acquireLock({ file, out: "/campaigns/second", pid: 4002, alive: () => false });
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { pid: 4002, out: "/campaigns/second" });
  // The first one's release finds the lock no longer its own and leaves it; the second's removes it.
  await release();
  assert.ok(await exists(file));
  await taken();
  assert.ok(!(await exists(file)));
  // A lock that cannot be read is not guessed at.
  await writeFile(file, "not a lock");
  await assert.rejects(acquireLock({ file, out: "/campaigns/third", pid: 4003, alive: () => false }), /holds no pid that can be read/);
  assert.equal(await readFile(file, "utf8"), "not a lock");
});

test("a process is alive if a signal can be asked of it, and the default lock is in the system's temporary directory", () => {
  assert.equal(isAlive(process.pid), true);
  assert.equal(isAlive(deadPid()), false);
  assert.equal(path.dirname(defaultLockFile()), tmpdir());
});

// A campaign of two slots against the fake launcher, with the lock at `lockFile`.
const run = ({ lockFile, out, launcher = fakeLauncher({ protocol }) }) =>
  runCampaign({ launcher, protocol, protocolSha256, out, lanes: ["presented"], slots: [1, 2], runCheck: selfCheck(), read: scriptedLoad([0.5]), clock: fakeClock(), where, lockFile });

test("a campaign does not start while another is alive on the machine, whatever its directory, and starts when the lock is free", async () => {
  const file = lockPath("campaign");
  const release = await acquireLock({ file, out: "/campaigns/running" });
  const launcher = fakeLauncher({ protocol });
  const out = path.join(scratch, "refused");
  await assert.rejects(run({ lockFile: file, out, launcher }), new RegExp(`another campaign is running on this machine \\(pid ${process.pid}, --out /campaigns/running\\)`));
  assert.equal(launcher.calls.length, 0);
  assert.ok(!(await exists(out)), "nothing was written for the campaign that was refused");
  await release();
  const started = await run({ lockFile: file, out });
  assert.equal(started.status, "done");
  assert.ok(!(await exists(file)), "released at the end");
});

test("a lock left by a campaign that was killed is taken over, and the lock is released when a campaign fails", async () => {
  const file = lockPath("stale");
  await writeFile(file, `${JSON.stringify({ pid: deadPid(), out: "/campaigns/killed" })}\n`);
  const taken = await run({ lockFile: file, out: path.join(scratch, "stale-campaign") });
  assert.equal(taken.status, "done");
  assert.ok(!(await exists(file)));
  await assert.rejects(run({ lockFile: file, out: path.join(scratch, "failing-campaign"), launcher: fakeLauncher({ protocol, interruptBefore: 1 }) }), /simulated interruption/);
  assert.ok(!(await exists(file)), "released although the campaign failed");
});

// ---- the self-check, in a lane ----

// A checkout with the instrument's file in it, and a probe process that writes its report while it runs (the check removes any report before it starts the process) and ends as the test says.
async function checkout(name, content = "extends Node\n") {
  const project = path.join(scratch, name);
  await mkdir(path.join(project, "tests"), { recursive: true });
  await writeFile(path.join(project, "tests", "cpu-time-instrument.gd"), content);
  return project;
}
const GOOD_REPORT = { checks: [{ name: "a", passed: true }], allCurrentAssertionsPassed: true, provenance: { godot: "4.7.2" } };
function probe({ status = 0, log = "CPU_TIME_INSTRUMENT_PASSED: 3\n", report = GOOD_REPORT } = {}) {
  const calls = [];
  const spawn = (engine, args) => {
    calls.push({ engine, args });
    if (report !== null) {
      const name = args.find((argument) => argument.startsWith("--report=")).slice("--report=".length);
      writeFileSync(path.join(args[args.indexOf("--path") + 1], "build", name), JSON.stringify(report));
    }
    return { status, signal: null, stdout: log, stderr: "" };
  };
  return { calls, spawn };
}
async function check({ project, windowed, verdict, ...options }) {
  const fake = probe(options);
  const result = await runSelfCheck({ engine: "the-engine", windowed, outDirectory: path.join(project, "self-check"), project, spawn: fake.spawn, judge: () => verdict });
  return { result, calls: fake.calls };
}
const judged = { judged: true, violations: [] };
const presented = { judged: true, presented: true, violations: [] };

test("the self-check runs the probe headless or in a window as it is asked, and a check that passed records the lane and the hash of the instrument's file", async () => {
  const project = await checkout("lanes");
  const headless = await check({ project, windowed: false, verdict: judged });
  assert.deepEqual(headless.calls[0].args.slice(0, 5), ["--path", project, "--headless", "--script", "res://tests/cpu-time-instrument-probe.gd"]);
  assert.equal(headless.calls[0].engine, "the-engine");
  assert.deepEqual([headless.result.passed, headless.result.lane, headless.result.why], [true, "headless", []]);
  assert.equal(headless.result.sha256, sha("extends Node\n"));
  assert.deepEqual(headless.result.provenance, { godot: "4.7.2" });
  assert.ok(await exists(path.join(project, "self-check", "probe-report.json")));
  const windowed = await check({ project, windowed: true, verdict: presented });
  assert.ok(windowed.calls[0].args.includes("--windowed") && !windowed.calls[0].args.includes("--headless"));
  assert.deepEqual([windowed.result.passed, windowed.result.lane, windowed.result.oracle.presented], [true, "windowed", true]);
});

test("a window that no display presented, an oracle that rejects, a probe that fails or writes nothing, and a log with a hidden error do not pass the check", async () => {
  const project = await checkout("failures");
  const dark = await check({ project, windowed: true, verdict: { judged: false, presented: false, reason: "the window drew 12 of the 600 idle frames", violations: [] } });
  assert.equal(dark.result.passed, false);
  assert.match(dark.result.why.join("\n"), /no display presented the window, so the check measured nothing: the window drew 12 of the 600 idle frames/);
  // A headless check needs no display, and the oracle that finds nothing wrong in it passes it.
  assert.equal((await check({ project, windowed: false, verdict: judged })).result.passed, true);
  const rejected = await check({ project, windowed: false, verdict: { judged: true, violations: ["The 10 ms load is read to within 10%"] } });
  assert.match(rejected.result.why.join("\n"), /the oracle rejects the report: The 10 ms load is read to within 10%/);
  assert.match((await check({ project, windowed: false, verdict: judged, status: 1 })).result.why.join("\n"), /the probe ended with exit 1/);
  assert.match((await check({ project, windowed: false, verdict: judged, log: "ERROR: something hidden\n" })).result.why.join("\n"), /1 error line\(s\) in the probe's log are not a failed check/);
  const failedCheck = { checks: [{ name: "idle", passed: false }], allCurrentAssertionsPassed: false, provenance: {} };
  assert.match((await check({ project, windowed: false, verdict: judged, report: failedCheck })).result.why.join("\n"), /the probe's checks failed: idle/);
  assert.match((await check({ project, windowed: false, verdict: judged, report: null })).result.why.join("\n"), /the probe wrote no report/);
});
