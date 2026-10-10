import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { matchContractTests, tapDescription } from "../scripts/hosted-receipts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts", "hosted-receipts.mjs");
const evidence = path.join(root, "docs", "evidence");
const FOLDERS = [
  "frontier-game",
  "world-input",
  "frontier-services",
  "frontier-consumer",
  "frontier-baseline",
  "world-input-a2",
  "frontier-authority",
  "frontier-soak",
  "frontier-scope",
  "civ-lite-ui",
  "frontier-turn",
  "milestone-exit-guards",
  "idle-reference",
  "cpu-time-instrument",
  "civ-lite-ui/overlays",
  "civ-lite-ui/stability",
  "windowed-presence",
  "mobile-density",
  "frontier-freeze",
  "civ-lite-ui/frame-time",
  "frontier-arm-b",
  "frontier-freeze/followup",
  "frontier-comparison-analysis",
  "frontier-stress",
  "frontier-comparison-execution",
  "frontier-arm-b/optimization",
  "frontier-comparison-campaign",
  "frontier-comparison-analysis/unreported",
];

// The check reads committed files only. A PATH without `gh` proves that it asks GitHub nothing.
const offline = { ...process.env, PATH: path.dirname(process.execPath) };
const runCheck = (evidenceDir) => spawnSync(process.execPath, [script, "--check", "--evidence-dir", evidenceDir], { encoding: "utf8", env: offline });
const read = (directory, folder, file) => JSON.parse(readFileSync(path.join(directory, folder, file), "utf8"));
const write = (directory, folder, file, value) => writeFileSync(path.join(directory, folder, file), `${JSON.stringify(value, null, 2)}\n`);

// A copy of the 56 receipts that a test may break without touching the committed ones.
function withCopy(body) {
  const copy = mkdtempSync(path.join(tmpdir(), "hosted-receipts-test-"));
  try {
    for (const folder of FOLDERS) {
      mkdirSync(path.join(copy, folder));
      for (const file of ["hosted-ci.json", "publication.json"]) {
        cpSync(path.join(evidence, folder, file), path.join(copy, folder, file));
      }
    }
    return body(copy);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

function mutate(folder, file, change) {
  return withCopy((copy) => {
    const receipt = read(copy, folder, file);
    change(receipt);
    write(copy, folder, file, receipt);
    return runCheck(copy);
  });
}

function assertRejected(result, expected) {
  assert.notEqual(result.status, 0, "the mutated receipt was accepted");
  assert.match(result.stderr, expected);
}

test("the committed receipts of the twenty-eight Frontier slices are coherent, offline", () => {
  const result = runCheck(evidence);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HOSTED_RECEIPTS_CHECK_PASSED: 28 slices, 56 receipts$/m);
  assert.equal(withCopy((copy) => runCheck(copy).status), 0, "an untouched copy of the receipts must pass");
});

test("a TAP description reads back the name it escapes, one escape at a time", () => {
  // The log of #107's Contracts run writes the `#` of "#100" as `\#`, so its test was not found by name.
  assert.equal(tapDescription("the turn before \\#100 reproduces the frozen one"), "the turn before #100 reproduces the frozen one");
  // A backslash is written `\\`: one pass gives one backslash, and an escaped backslash before `#` is not read twice.
  assert.equal(tapDescription("a \\\\ b"), "a \\ b");
  assert.equal(tapDescription("a \\\\\\# b"), "a \\# b");
  // A description without escapes is the same text.
  assert.equal(tapDescription("the freeze is the one the inputs give by the rule"), "the freeze is the one the inputs give by the rule");
});

test("a test of a source is matched by the TAP description of its ok line, and a missing ok is refused", () => {
  const file = "tests/turn.test.mjs";
  const source = 'test("the turn before #100 reproduces the frozen one", () => {});\n';
  assert.deepEqual(matchContractTests(file, source, ["ok 7 - the turn before \\#100 reproduces the frozen one"]), {
    file,
    tests: 1,
    passed: 1,
    topLevel: ["the turn before #100 reproduces the frozen one"],
  });
  const two = 'test("first", () => {});\ntest("second", () => {});\n';
  assert.throws(() => matchContractTests(file, two, ["ok 1 - first"]), {
    message: `${file}: 1 of its 2 top-level tests passed in the contracts job log`,
  });
});

test("a receipt that carries the SHA of another slice is rejected", () => {
  const frontierGame = read(evidence, "frontier-game", "hosted-ci.json").run.headSha;
  assertRejected(
    mutate("world-input", "hosted-ci.json", (receipt) => {
      receipt.run.headSha = frontierGame;
    }),
    /world-input: hosted-ci\.json: the run's head e1c7a39\w+ is not the squash 7ef63ed of #71/,
  );
  assertRejected(
    mutate("frontier-soak", "hosted-ci.json", (receipt) => {
      receipt.pullRequest.squashMergeCommit = frontierGame;
    }),
    /frontier-soak: hosted-ci\.json: the pull request is not #83 merged as the run's head/,
  );
  assertRejected(
    mutate("frontier-baseline", "hosted-ci.json", (receipt) => {
      receipt.run.jobCheckouts["native-cold-start"] = frontierGame;
    }),
    /frontier-baseline: hosted-ci\.json: not every job checked out the squash/,
  );
  assertRejected(
    mutate("frontier-authority", "publication.json", (receipt) => {
      receipt.mainCommit = frontierGame;
      receipt.buildCheckout = frontierGame;
    }),
    /frontier-authority: publication\.json: the main commit e1c7a39\w+ is not the squash 5e1f6a1/,
  );
});

test("a job that is not in success is rejected, in the Contracts run and in the Pages run", () => {
  assertRejected(
    mutate("frontier-services", "hosted-ci.json", (receipt) => {
      receipt.run.jobs.find((job) => job.name === "native-cold-start").conclusion = "failure";
    }),
    /frontier-services: hosted-ci\.json: job native-cold-start is completed\/failure, not completed\/success/,
  );
  assertRejected(
    mutate("frontier-consumer", "hosted-ci.json", (receipt) => {
      receipt.run.nativeSteps["test:consumer:civ-lite"].conclusion = "failure";
    }),
    /frontier-consumer: step test:consumer:civ-lite did not succeed \(failure\)/,
  );
  assertRejected(
    mutate("world-input-a2", "hosted-ci.json", (receipt) => {
      receipt.run.nativeSteps["test:world-input"].result.tap[0].fail = 1;
    }),
    /world-input-a2: step test:world-input: a TAP summary is not all-pass/,
  );
  assertRejected(
    mutate("frontier-game", "publication.json", (receipt) => {
      receipt.jobs.deploy = "failure";
    }),
    /frontier-game: publication\.json: build and deploy are not both success/,
  );
  assertRejected(
    mutate("frontier-baseline", "hosted-ci.json", (receipt) => {
      receipt.run.conclusion = "failure";
    }),
    /frontier-baseline: hosted-ci\.json: the run is not a completed, successful, first-attempt Contracts push or dispatch of main/,
  );
});

test("a skipped job keeps no times, and a job that ran completes no earlier than it starts", () => {
  assertRejected(
    mutate("windowed-presence", "hosted-ci.json", (receipt) => {
      receipt.run.jobs.find((job) => job.name === "native-cold-start").startedAt = "2026-10-09T20:44:49Z";
    }),
    /windowed-presence: hosted-ci\.json: job native-cold-start is skipped, so it has no startedAt or completedAt/,
  );
  assertRejected(
    mutate("windowed-presence", "hosted-ci.json", (receipt) => {
      receipt.run.jobs.find((job) => job.name === "contracts").completedAt = "2026-10-09T20:40:00Z";
    }),
    /windowed-presence: hosted-ci\.json: job contracts ran but has no valid startedAt and completedAt, or completedAt is before startedAt/,
  );
});

// Since the native suites became opt-in, a push of main skips them and the receipt comes from a dispatched run, whose
// native suites are split between the cold build and three suite jobs.
function asDispatch(receipt) {
  const native = receipt.run.jobs.find((job) => job.name === "native-cold-start");
  receipt.run.event = "workflow_dispatch";
  for (const name of ["native-suites-frontier", "native-suites-input", "native-suites-runtime"]) {
    receipt.run.jobs.push({ ...native, name, databaseId: native.databaseId + receipt.run.jobs.length });
    receipt.run.jobCheckouts[name] = receipt.run.headSha;
  }
  for (const step of Object.values(receipt.run.nativeSteps)) {
    step.job = "native-suites-frontier";
  }
}

test("a dispatched run with the split native jobs is accepted, a push with them or a step outside them is not", () => {
  const dispatched = mutate("frontier-soak", "hosted-ci.json", asDispatch);
  assert.equal(dispatched.status, 0, dispatched.stderr);
  assertRejected(
    mutate("frontier-soak", "hosted-ci.json", (receipt) => {
      asDispatch(receipt);
      receipt.run.event = "push";
    }),
    /frontier-soak: hosted-ci\.json: the jobs are not contracts, native-cold-start, parity-comparison, reference-android, reference-ios/,
  );
  assertRejected(
    mutate("frontier-soak", "hosted-ci.json", (receipt) => {
      asDispatch(receipt);
      receipt.run.jobs = receipt.run.jobs.filter((job) => job.name !== "native-suites-input");
    }),
    /frontier-soak: hosted-ci\.json: the jobs are not contracts, native-cold-start, native-suites-frontier, native-suites-input, native-suites-runtime, parity-comparison/,
  );
  assertRejected(
    mutate("frontier-soak", "hosted-ci.json", (receipt) => {
      asDispatch(receipt);
      receipt.run.nativeSteps["test:frontier-soak"].job = "contracts";
    }),
    /frontier-soak: step test:frontier-soak ran in contracts, not in a native job of the run/,
  );
  assertRejected(
    mutate("frontier-soak", "hosted-ci.json", (receipt) => {
      receipt.run.event = "pull_request";
    }),
    /frontier-soak: hosted-ci\.json: the run is not a completed, successful, first-attempt Contracts push or dispatch of main/,
  );
});

test("a digest that is absent or that disagrees with the API is rejected", () => {
  assertRejected(
    mutate("frontier-soak", "hosted-ci.json", (receipt) => {
      delete receipt.artifacts.soak.zipSha256;
    }),
    /frontier-soak: hosted-ci\.json: artifact native-frontier-soak has no id or no zip SHA-256 digest/,
  );
  assertRejected(
    mutate("frontier-authority", "hosted-ci.json", (receipt) => {
      receipt.artifacts.consumer.apiDigest = `sha256:${"0".repeat(64)}`;
    }),
    /frontier-authority: hosted-ci\.json: artifact independent-civ-lite-consumer: the zip SHA-256 is not the API digest/,
  );
  assertRejected(
    mutate("frontier-services", "hosted-ci.json", (receipt) => {
      const files = receipt.artifacts.services.files;
      delete files[Object.keys(files)[0]];
    }),
    /frontier-services: hosted-ci\.json: artifact native-frontier-services: the file list is empty, has a different count or a file without a SHA-256/,
  );
  assertRejected(
    mutate("frontier-game", "publication.json", (receipt) => {
      delete receipt.deployedArtifact.zipSha256;
    }),
    /frontier-game: publication\.json: the deployed artifact has no id or no zip SHA-256 digest/,
  );
  assertRejected(
    mutate("frontier-consumer", "publication.json", (receipt) => {
      receipt.deployedArtifact.migrationJsonSha256 = "0".repeat(64);
    }),
    /frontier-consumer: publication\.json: the deployed migration\.json is not the committed one, byte for byte/,
  );
});

test("the slice's own steps, tests and activity entry are required", () => {
  assertRejected(
    mutate("frontier-baseline", "hosted-ci.json", (receipt) => {
      receipt.run.contractsJob.sliceContractTests.pop();
    }),
    /frontier-baseline: hosted-ci\.json: the contract test files are not those of the table/,
  );
  assertRejected(
    mutate("frontier-authority", "hosted-ci.json", (receipt) => {
      delete receipt.run.nativeSteps["test:frontier-services"];
    }),
    /frontier-authority: hosted-ci\.json: the native steps are not those of the table/,
  );
  assertRejected(
    mutate("world-input", "publication.json", (receipt) => {
      receipt.sliceActivity.id = "milestone-0-5-v05-02-pointer-a2-af941dd";
    }),
    /world-input: publication\.json: the slice's activity entry milestone-0-5-v05-02-pointer-03f039a is not recorded in the committed data/,
  );
  withCopy((copy) => {
    rmSync(path.join(copy, "frontier-soak", "publication.json"));
    assertRejected(runCheck(copy), /frontier-soak\/publication\.json does not exist/);
  });
});

// Since the native suites became opt-in, a push of main lists the dispatch's eight jobs and skips five of them, and a skipped job has no log. The committed
// receipt of idle-reference is such a push. Only a slice with no native step and no native artifact can be judged from it.
const OPT_IN_JOBS = ["native-cold-start", "native-suites-frontier", "native-suites-input", "native-suites-runtime", "parity-comparison"];

function asSkippedPush(receipt) {
  const native = receipt.run.jobs.find((job) => job.name === "native-cold-start");
  for (const name of ["native-suites-frontier", "native-suites-input", "native-suites-runtime"]) {
    receipt.run.jobs.push({ ...native, name, databaseId: native.databaseId + receipt.run.jobs.length });
  }
  for (const job of receipt.run.jobs.filter((candidate) => OPT_IN_JOBS.includes(candidate.name))) {
    job.conclusion = "skipped";
    delete receipt.run.jobCheckouts[job.name];
  }
}

test("a skipped native job is accepted only on a push, for exactly the opt-in jobs, and only for a slice with no native step", () => {
  const committed = read(evidence, "idle-reference", "hosted-ci.json");
  assert.deepEqual(
    committed.run.jobs.filter((job) => job.conclusion === "skipped").map((job) => job.name),
    OPT_IN_JOBS,
    "the committed receipt of idle-reference is the push that skipped the native jobs",
  );
  assert.deepEqual(committed.run.nativeSteps, {});
  assert.deepEqual(committed.artifacts, {});
  assert.equal(committed.run.referenceParity.comparison, null);
  assert.deepEqual(Object.keys(committed.run.jobCheckouts), ["contracts", "reference-android", "reference-ios"]);
  // The same shape, for a slice that has a native step and an artifact, proves neither.
  assertRejected(
    mutate("frontier-soak", "hosted-ci.json", asSkippedPush),
    /frontier-soak: hosted-ci\.json: a run that skipped the native jobs cannot prove the native steps or artifacts of the table/,
  );
  // A job that ran cannot be among the skipped ones, and a job outside the opt-in five cannot be skipped.
  assertRejected(
    mutate("idle-reference", "hosted-ci.json", (receipt) => {
      receipt.run.jobs.find((job) => job.name === "native-suites-input").conclusion = "success";
    }),
    /idle-reference: hosted-ci\.json: only a push may skip jobs, and exactly the opt-in native ones/,
  );
  assertRejected(
    mutate("idle-reference", "hosted-ci.json", (receipt) => {
      receipt.run.jobs.find((job) => job.name === "reference-ios").conclusion = "skipped";
      delete receipt.run.jobCheckouts["reference-ios"];
    }),
    /idle-reference: hosted-ci\.json: only a push may skip jobs, and exactly the opt-in native ones/,
  );
  // A dispatch runs every job: nothing is skipped there.
  assertRejected(
    mutate("idle-reference", "hosted-ci.json", (receipt) => {
      receipt.run.event = "workflow_dispatch";
    }),
    /idle-reference: hosted-ci\.json: only a push may skip jobs, and exactly the opt-in native ones/,
  );
  // A skipped job ran no checkout: one recorded for it contradicts the skip.
  assertRejected(
    mutate("idle-reference", "hosted-ci.json", (receipt) => {
      receipt.run.jobCheckouts["native-cold-start"] = receipt.run.headSha;
    }),
    /idle-reference: hosted-ci\.json: not every job checked out the squash/,
  );
});

test("the milestone guards step is required where the table says so, with its line and its base, and refused where it does not", () => {
  const guard = read(evidence, "milestone-exit-guards", "hosted-ci.json").run.contractsJob.steps["milestone-guards"];
  assert.equal(guard.step, "Milestone exit guards (X9 and X10)");
  assert.match(guard.markers[0], /^MILESTONE_GUARDS_CHECK_PASSED: against \w+ \(--base [0-9a-f]{40}\); X9 clean, X10 clean$/);
  assertRejected(
    mutate("milestone-exit-guards", "hosted-ci.json", (receipt) => {
      receipt.run.contractsJob.steps["milestone-guards"].markers = [];
    }),
    /milestone-exit-guards: hosted-ci\.json: the milestone guards step has no MILESTONE_GUARDS_CHECK_PASSED line for its base/,
  );
  assertRejected(
    mutate("idle-reference", "hosted-ci.json", (receipt) => {
      receipt.run.contractsJob.steps["milestone-guards"].base = "0".repeat(40);
    }),
    /idle-reference: hosted-ci\.json: the milestone guards step has no MILESTONE_GUARDS_CHECK_PASSED line for its base/,
  );
  assertRejected(
    mutate("idle-reference", "hosted-ci.json", (receipt) => {
      receipt.run.contractsJob.steps["milestone-guards"].conclusion = "failure";
    }),
    /idle-reference: hosted-ci\.json: the milestone guards step did not succeed/,
  );
  assertRejected(
    mutate("idle-reference", "hosted-ci.json", (receipt) => {
      delete receipt.run.contractsJob.steps["milestone-guards"];
    }),
    /idle-reference: hosted-ci\.json: the milestone guards step did not succeed/,
  );
  // The whole line is judged, not its prefix: the verdicts, the 12 digits of `against` (the start of the base) and the end of the line.
  const guardLineProblem = /idle-reference: hosted-ci\.json: the milestone guards step has no MILESTONE_GUARDS_CHECK_PASSED line for its base/;
  const withGuardLine = (change) =>
    mutate("idle-reference", "hosted-ci.json", (receipt) => {
      const step = receipt.run.contractsJob.steps["milestone-guards"];
      step.markers = change(step.markers[0]);
    });
  assertRejected(
    withGuardLine((line) => [line.replace("X9 clean", "X9 violated")]),
    guardLineProblem,
  );
  assertRejected(
    withGuardLine((line) => [line.replace("X10 clean", "X10 violated")]),
    guardLineProblem,
  );
  assertRejected(
    withGuardLine((line) => [line.replace("X10 clean", "X10 not-applicable")]),
    guardLineProblem,
  );
  assertRejected(
    withGuardLine((line) => [line.replace(/against [0-9a-f]{12}/, "against 1adcdb3c89b9")]),
    guardLineProblem,
  );
  assertRejected(
    withGuardLine((line) => [`${line}; X9 violated`]),
    guardLineProblem,
  );
  assertRejected(
    withGuardLine((line) => [`${line} `]),
    guardLineProblem,
  );
  assertRejected(
    withGuardLine((line) => [line, line]),
    guardLineProblem,
  );
  // X9 is not-applicable when the push adds no 0.5 entry, and that line passes.
  const notApplicable = withGuardLine((line) => [line.replace("X9 clean", "X9 not-applicable")]);
  assert.equal(notApplicable.status, 0, notApplicable.stderr);
  // The run of #83 had no such step: a receipt that records one describes another run.
  assertRejected(
    mutate("frontier-soak", "hosted-ci.json", (receipt) => {
      receipt.run.contractsJob.steps["milestone-guards"] = guard;
    }),
    /frontier-soak: hosted-ci\.json: the table does not expect the milestone guards step/,
  );
  // With no native step, the contract tests are the whole of what a receipt proves about the slice's code.
  assertRejected(
    mutate("idle-reference", "hosted-ci.json", (receipt) => {
      receipt.run.contractsJob.sliceContractTests.pop();
    }),
    /idle-reference: hosted-ci\.json: the contract test files are not those of the table/,
  );
  assertRejected(
    mutate("milestone-exit-guards", "hosted-ci.json", (receipt) => {
      receipt.run.contractsJob.sliceContractTests[0].passed -= 1;
    }),
    /milestone-exit-guards: hosted-ci\.json: not every test of tests\/milestone-guards\.test\.mjs passed in the contracts job/,
  );
});

test("an artifact that is gone is recorded as such, never as a verified digest", () => {
  const result = mutate("frontier-game", "publication.json", (receipt) => {
    const upload = receipt.deployedArtifact.zipSha256;
    receipt.status = "verified-deployment-artifact-unavailable";
    receipt.deployedArtifact = { available: false, name: "github-pages", id: receipt.deployedArtifact.id, sizeBytes: receipt.deployedArtifact.zipSizeBytes, uploadLogDigest: upload, reason: "the run no longer lists the github-pages artifact" };
    delete receipt.deployedJSONBytesEqualCommittedBytes;
    receipt.sliceActivity.presentInDeployedJson = null;
    receipt.findings = ["the deployment succeeded, but its github-pages artifact is no longer retrievable"];
  });
  assert.equal(result.status, 0, result.stderr);
  assertRejected(
    mutate("frontier-game", "publication.json", (receipt) => {
      receipt.deployedArtifact = { available: false, name: "github-pages", reason: "gone" };
    }),
    /frontier-game: publication\.json: an unavailable artifact is not recorded as such/,
  );
  // A receipt that calls its artifact unavailable must say why in `findings`: no array is not "no finding".
  assertRejected(
    mutate("world-input", "publication.json", (receipt) => {
      delete receipt.findings;
    }),
    /world-input: publication\.json: an unavailable artifact is not recorded as such/,
  );
  assertRejected(
    mutate("world-input", "publication.json", (receipt) => {
      receipt.findings = [];
    }),
    /world-input: publication\.json: an unavailable artifact is not recorded as such/,
  );
  assertRejected(
    mutate("frontier-soak", "publication.json", (receipt) => {
      delete receipt.findings;
    }),
    /frontier-soak: publication\.json: the status or the findings contradict an available artifact/,
  );
});

// A skipped test is accepted only from ALLOWED_SKIPS, with its description and its reason, and the summaries count exactly the skips recorded.
test("a skipped test is accepted only from ALLOWED_SKIPS, and the summaries count the skips that are recorded", () => {
  const folder = "frontier-comparison-analysis/unreported";
  const contracts = (receipt) => receipt.run.contractsJob.steps["test:contracts"];
  const summary590 = (receipt) => contracts(receipt).tap.find((summary) => summary.tests === 590);
  assert.equal(mutate(folder, "hosted-ci.json", () => {}).status, 0, "the committed skip, with its recorded reason, must be accepted");
  assertRejected(
    mutate(folder, "hosted-ci.json", (receipt) => {
      delete contracts(receipt).skippedTests;
    }),
    /frontier-comparison-analysis\/unreported: hosted-ci\.json: test:contracts: the TAP summaries count 1 skipped test\(s\), and the receipt records 0/,
  );
  assertRejected(
    mutate(folder, "hosted-ci.json", (receipt) => {
      contracts(receipt).skippedTests[0].description = "native macOS arm64 export";
    }),
    /test:contracts: skipped test "native macOS arm64 export" is not in ALLOWED_SKIPS/,
  );
  assertRejected(
    mutate(folder, "hosted-ci.json", (receipt) => {
      contracts(receipt).skippedTests[0].reason = "the runner has no disk left";
    }),
    /test:contracts: skipped test "native macOS arm64 export and copied-app rejection controls" is not in ALLOWED_SKIPS \(reason: "the runner has no disk left"\)/,
  );
  assertRejected(
    mutate(folder, "hosted-ci.json", (receipt) => {
      summary590(receipt).pass -= 1;
      summary590(receipt).skipped += 1;
    }),
    /test:contracts: the TAP summaries count 2 skipped test\(s\), and the receipt records 1/,
  );
  assertRejected(
    mutate(folder, "hosted-ci.json", (receipt) => {
      summary590(receipt).pass -= 1;
      summary590(receipt).skipped += 1;
      contracts(receipt).skippedTests.push({ ...contracts(receipt).skippedTests[0] });
    }),
    /test:contracts: skipped test "native macOS arm64 export and copied-app rejection controls" is recorded 2 times, and an allowed skip counts at most once per step/,
  );
});

test("each evidence page links its two receipts and the index links them too", () => {
  const index = readFileSync(path.join(evidence, "README.md"), "utf8");
  for (const folder of FOLDERS) {
    const page = path.join(evidence, folder, "README.md");
    assert.ok(existsSync(page), `${folder} has no README.md`);
    const text = readFileSync(page, "utf8");
    assert.match(text, /^## CI hospedada e Pages$/m, `${folder} has no "CI hospedada e Pages" section`);
    assert.ok(text.includes("(hosted-ci.json)") && text.includes("(publication.json)"), `${folder} does not link both receipts`);
    assert.doesNotMatch(text, /CI hospedada[^\n]{0,40}pendente|ainda não rodaram na CI hospedada|publicação no Pages estão pendentes/, `${folder} still says the hosted CI is pending`);
    assert.ok(index.includes(`(${folder}/hosted-ci.json)`) && index.includes(`(${folder}/publication.json)`), `the index does not link the receipts of ${folder}`);
  }
});
