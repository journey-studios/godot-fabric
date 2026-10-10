import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {mkdir, readFile, readdir, rm, stat, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {runMacOSExport} from "../scripts/macos-export.mjs";
import {GOLDEN_HASH, REPLAY_TURNS, TRACE_HASH} from "../scripts/macos-export-civ-lite.mjs";
import {assertHudReport} from "./civ-lite-ui-oracle.mjs";
import {judgeExportReceipt, judgeReplayReport, parseRoteiro, RUN_LABELS} from "./macos-export-civ-lite-oracle.mjs";
import {SABOTAGES} from "./macos-export-civ-lite-sabotages.mjs";

// V05-07 `replay` (exits X1, X2 and X7): Frontier, the game, as a signed Release .app on this Mac. scripts/macos-export.mjs --consumer civ-lite provisions the
// template, builds its HUD with the editor plugin, exports a Release .app with the Hermes and React Native frameworks, signs it ad hoc, audits its load paths,
// and then plays the 12-turn replay (consumers/civ-lite/replay_validation.gd, 77 intents through GameServices) three times in the provisioned project and three
// times in a copy of the app that sits in another directory, each in a clean user profile, and the HUD's matrix once in the copy. Every run must give the golden and
// the trace hash that tests/civ-lite-game-native.test.mjs pins. This file then judges the export again with tests/macos-export-civ-lite-oracle.mjs, which reads the
// roteiro from the game's own source and recomputes the hashes from the raw states, and checks the signature, the load paths and the profile on the files themselves.
//
// It needs MACOS_EXPORT_TEMPLATE (the derived arm64 template ZIP, as npm run test:export:macos does) and a committed, clean source tree: the SDK the project is
// provisioned with carries its commit, and the export refuses a dirty one. Run it with npm run test:export:civ-lite; it is not part of test:contracts.
//
// With --sabotage=<name> the same export is made of a project whose copy was broken on purpose (tests/macos-export-civ-lite-sabotages.mjs): it passes only if the
// export is rejected for the pinned hashes, in all six runs, and the oracle rejects the reports too. scripts/macos-export-civ-lite-sabotage.mjs runs it.
const root = fileURLToPath(new URL("..", import.meta.url));
const template = process.env.MACOS_EXPORT_TEMPLATE ? path.resolve(process.env.MACOS_EXPORT_TEMPLATE) : null;
const sabotageArgument = process.argv.find(argument => argument.startsWith("--sabotage="));
const sabotageName = sabotageArgument === undefined ? null : sabotageArgument.slice("--sabotage=".length);
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const expected = {goldenHash: GOLDEN_HASH, traceHash: TRACE_HASH};
const skip = template ? false : "MACOS_EXPORT_TEMPLATE is unset; the Frontier export requires the reviewed Godot arm64 Release template";
// The load commands the exported binaries may name: the app's own bundle and the system, never a path of the machine that built them.
const ALLOWED_LOADS = [/^@rpath\//, /^@loader_path(?:\/|$)/, /^@executable_path(?:\/|$)/, /^\/System\/Library\//, /^\/usr\/lib\//];

const tool = (command, args) => {
  const result = spawnSync(command, args, {encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024});
  assert.equal(result.error, undefined, `${command} ${args.join(" ")}`);
  return {status: result.status, output: (result.stdout ?? "") + (result.stderr ?? "")};
};

async function readKept(directory, label) {
  const bytes = await readFile(path.join(directory, `${label}.json`));
  return {report: JSON.parse(bytes.toString("utf8")), sha256: sha256(bytes)};
}

async function filesUnder(directory, found = []) {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await filesUnder(filename, found);
    } else if (entry.isFile()) {
      found.push(filename);
    }
  }
  return found;
}

// codesign, otool and a scan for this machine's paths, on the files of the published app and not on anything the runner recorded.
async function auditPublishedApp(app, receipt) {
  const verify = tool("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
  assert.equal(verify.status, 0, verify.output);
  const details = tool("/usr/bin/codesign", ["-dvv", app]);
  assert.match(details.output, /Signature=adhoc/, "the app is signed ad hoc");
  const contents = path.join(app, "Contents");
  const binaries = [path.join(contents, "MacOS", receipt.app.executableName), path.join(contents, "Frameworks", "fabric_godot.dylib"),
    path.join(contents, "Frameworks", "frameworks", "hermesvm.framework", "hermesvm"),
    path.join(contents, "Frameworks", "frameworks", "ReactNativeDependencies.framework", "ReactNativeDependencies")];
  const loads = [];
  for (const binary of binaries) {
    assert.equal(tool("/usr/bin/lipo", ["-archs", binary]).output.trim().split(/\s+/).includes("arm64"), true, `${binary} has an arm64 slice`);
    const listed = tool("/usr/bin/otool", ["-arch", "arm64", "-L", binary]).output.split("\n").slice(1).map(line => line.trim().replace(/ \(.*$/, "")).filter(Boolean);
    const rpaths = tool("/usr/bin/otool", ["-arch", "arm64", "-l", binary]).output.split("\n").filter(line => /^\s*path .* \(offset/.test(line)).map(line => line.trim().replace(/^path /, "").replace(/ \(offset.*$/, ""));
    for (const load of [...listed, ...rpaths]) {
      assert.ok(ALLOWED_LOADS.some(pattern => pattern.test(load)), `${path.basename(binary)} names ${load}, which is not the bundle's or the system's`);
    }
    loads.push({binary: path.relative(app, binary), loads: listed, rpaths});
  }
  // No other file of the bundle (the PCK, the Info.plist, the resources) may name the checkout or the home directory it was built in. The four binaries are audited by their
  // load commands above: the native host and the two frameworks are compiled here and carry the source paths of their own build as strings, which load nothing.
  const needles = [root, os.homedir()].map(value => Buffer.from(value));
  const named = [];
  for (const filename of (await filesUnder(contents)).filter(each => !binaries.includes(each))) {
    const bytes = await readFile(filename);
    if (needles.some(needle => bytes.includes(needle))) {
      named.push(path.relative(app, filename));
    }
  }
  assert.deepEqual(named, [], "files of the app name a path of the machine that built it");
  return {codesign: {verified: true, signature: "adhoc"}, loadCommands: loads, developmentPathsFound: named};
}

if (sabotageName === null) {
  test("Frontier's Release .app plays the 12-turn replay to the golden hash in the editor and in a copy, in clean profiles, and the HUD matrix passes in the app", {skip}, async () => {
    const startedAt = new Date().toISOString();
    const outputDirectory = path.join(root, "build", "macos-export-civ-lite-native");
    // One export directory, reused: this lane's own output of an earlier run goes first.
    await rm(outputDirectory, {recursive: true, force: true});
    await mkdir(outputDirectory, {recursive: true});
    const output = path.join(outputDirectory, "Frontier.app");
    const positive = await runMacOSExport({template, output, consumer: "civ-lite"});
    const {receipt, directory} = positive;
    assert.equal(receipt.status, "passed");

    const roteiro = parseRoteiro(await readFile(path.join(root, "consumers/civ-lite/game/replay.gd"), "utf8"));
    assert.equal(roteiro.length, 77, "the roteiro is the 77 intents");
    const reports = {};
    for (const label of RUN_LABELS) {
      reports[label] = await readKept(directory, label);
    }
    const hudBytes = await readFile(path.join(directory, "hud-app.json"));
    const hud = {report: JSON.parse(hudBytes.toString("utf8")), sha256: sha256(hudBytes)};
    assert.deepEqual(judgeExportReceipt({receipt, reports, hud, expected, roteiro, home: os.homedir()}), []);
    assertHudReport(hud.report);

    const audit = await auditPublishedApp(output, receipt);
    const profiles = RUN_LABELS.map(label => reports[label].report.userDataDir);
    for (const profile of new Set(profiles)) {
      await assert.rejects(stat(profile), {code: "ENOENT"}, `the profile ${profile} was removed after the last run`);
    }

    await writeFile(path.join(outputDirectory, "report.json"), JSON.stringify({
      format: "godot-fabric.macos-export-civ-lite/v1", status: "passed", startedAt, completedAt: new Date().toISOString(),
      limit: receipt.limitations.at(-1), app: {path: output, sha256: receipt.publishedAppSha256, executableName: receipt.app.executableName,
        bundleIdentifier: receipt.app.bundleIdentifier, engineVersion: receipt.app.engineVersion, pckSha256: receipt.pack.pckSHA256},
      template: {archiveSha256: receipt.templateMember.archiveSha256, memberSha256: receipt.templateMember.sha256},
      sdk: {sourceCommit: receipt.sdk.sourceCommit, hostSha256: receipt.sdk.hostSha256},
      replay: {goldenHash: GOLDEN_HASH, traceHash: TRACE_HASH, steps: roteiro.length, turns: REPLAY_TURNS,
        runs: receipt.replay.runs.map(run => ({label: run.label, lane: run.lane, goldenHash: run.goldenHash, traceHash: run.traceHash, checks: run.checks,
          reportSha256: run.reportSha256, logSha256: run.logSha256, profile: run.profile}))},
      hud: {checks: receipt.hud.checks, matrixRows: receipt.hud.matrixRows, covering: receipt.hud.covering, reportSha256: receipt.hud.reportSha256, profile: receipt.hud.profile},
      copy: receipt.copy, audit, harnessDirectory: directory, receiptPath: path.join(directory, "receipt.json"),
    }, null, 2) + "\n");
  });
} else {
  const sabotage = SABOTAGES.find(entry => entry.name === sabotageName);
  test(`the export of a project broken on purpose (${sabotageName}) is rejected for the replay hashes`, {skip: sabotage === undefined ? `${sabotageName} is not a retained sabotage` : skip}, async () => {
    const outputDirectory = path.join(root, "build", `macos-export-civ-lite-sabotage-${sabotageName}`);
    await rm(outputDirectory, {recursive: true, force: true});
    await mkdir(outputDirectory, {recursive: true});
    const output = path.join(outputDirectory, "Frontier.app");
    const verdictFile = path.join(root, "build", `macos-export-civ-lite-sabotage-${sabotageName}-verdict.json`);
    await rm(verdictFile, {force: true});
    // The sabotage's file is the template's, relative to the repository; the export edits the same file of its disposable copy.
    const edits = [{file: path.posix.relative("consumers/civ-lite", sabotage.file), find: sabotage.find, replace: sabotage.replace}];
    let rejection = null;
    await assert.rejects(runMacOSExport({template, output, consumer: "civ-lite", edits}), error => { rejection = error.message; return true; });
    assert.match(rejection, /The replay did not reach the pinned hashes in 6 of 6 runs/);
    const receiptPath = rejection.match(/Diagnostic receipt: (.+)$/m)?.[1];
    assert.ok(receiptPath, rejection);
    const directory = path.dirname(receiptPath);
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    assert.equal(receipt.status, "failed");
    assert.notEqual(receipt.published, true);
    await assert.rejects(stat(output), {code: "ENOENT"}, "a rejected export publishes nothing");

    const roteiro = parseRoteiro(await readFile(path.join(root, "consumers/civ-lite/game/replay.gd"), "utf8"));
    const rows = [];
    for (const label of RUN_LABELS) {
      const {report} = await readKept(directory, label);
      assert.notEqual(report.goldenHash, GOLDEN_HASH, `${label}: the sabotaged game does not end in the golden state`);
      assert.notEqual(report.traceHash, TRACE_HASH, `${label}: the sabotaged game does not follow the trace`);
      // The oracle rejects the report on its own, for the hashes: the report is internally consistent, so it is the pins that tell.
      const findings = judgeReplayReport(report, expected, roteiro);
      assert.ok(findings.some(finding => /is not the pinned/.test(finding)), `${label}: ${findings.join("\n")}`);
      rows.push({label, goldenHash: report.goldenHash, traceHash: report.traceHash, selfChecksPassed: report.allPassed, oracleFindings: findings.length});
    }
    await writeFile(verdictFile, JSON.stringify({format: "godot-fabric.macos-export-civ-lite-sabotage-run/v1", sabotage: sabotageName, rejected: true, pinned: expected,
      runs: rows, receiptPath, error: rejection.split("\n")[0], published: false}, null, 2) + "\n");
    // The rejected app the export kept for diagnosis is this run's own output; the receipt and the reports stay.
    if (receipt.rejectedAppPath) {
      await rm(receipt.rejectedAppPath, {recursive: true, force: true});
    }
    await rm(outputDirectory, {recursive: true, force: true});
  });
}
