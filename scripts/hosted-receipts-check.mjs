import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { REPOSITORY, REPOSITORY_URL, SLICES } from "./hosted-receipts-slices.mjs";

// The offline check of the committed hosted receipts. No network: the receipts must agree with the
// table of slices and with themselves (scripts/hosted-receipts.mjs --check).

// The jobs of the Contracts run a receipt records, by the event that started it. Every push of main ran
// the one native job until the native suites became opt-in; since then only a dispatched run has them,
// split between the cold build and the three suite jobs that restore its host (.github/workflows/contracts.yml).
export const CONTRACTS_JOBS = {
  push: ["contracts", "native-cold-start", "parity-comparison", "reference-android", "reference-ios"],
  workflow_dispatch: [
    "contracts",
    "native-cold-start",
    "native-suites-frontier",
    "native-suites-input",
    "native-suites-runtime",
    "parity-comparison",
    "reference-android",
    "reference-ios",
  ],
};
// Since the native suites became opt-in, a push of main lists the dispatch's eight jobs and skips these five (the cold build, the three suite
// jobs that restore its host and the parity comparison that needs the cold build). A skipped job has no log, so a receipt of such a run proves
// only what the other jobs ran: it is valid for a slice with no native step and no native artifact.
export const OPT_IN_JOBS = ["native-cold-start", "native-suites-frontier", "native-suites-input", "native-suites-runtime", "parity-comparison"];
const PAGES_JOBS = ["build", "deploy"];

// The step of the `contracts` job that runs the milestone exit guards. The API names the step; its log group is headed by the first line of its script.
export const GUARD_STEP = { name: "Milestone exit guards (X9 and X10)", header: 'Run case "$EVENT_NAME" in', marker: "MILESTONE_GUARDS_CHECK_PASSED" };

const isSha1 = (value) => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
const isSha256 = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const isCount = (value) => Number.isInteger(value) && value >= 0;
const isTime = (value) => typeof value === "string" && !Number.isNaN(Date.parse(value));

// The skips a receipt may carry, each by the description and the reason the reporter wrote for it. Any other skip is a problem: a test that
// skips for another reason, or that the summaries count but the receipt does not name, is not all-pass.
const ALLOWED_SKIPS = [
  {
    file: "tests/macos-export-native.test.mjs",
    description: "native macOS arm64 export and copied-app rejection controls",
    reasonPrefix: "MACOS_EXPORT_TEMPLATE is unset",
    why: "the native export test of #75 runs only with the reviewed Godot arm64 Release template, which the hosted contracts job does not have before test:contracts, so it skips there by design",
  },
];

// A TAP summary is all-pass when each of its tests passed or was skipped by ALLOWED_SKIPS: pass + skipped equals tests, and the skips the
// summaries count of the step are exactly the skipped tests the receipt records (a receipt with no `skippedTests` records none), each
// allowed skip at most once per step.
function checkTap(label, summaries, skippedTests, problems) {
  if (!Array.isArray(summaries) || summaries.length === 0) {
    problems.push(`${label}: no TAP summary was recorded`);
    return;
  }
  for (const summary of summaries) {
    const clean = summary.tests > 0 && summary.pass + summary.skipped === summary.tests && summary.fail === 0 && summary.cancelled === 0 && summary.todo === 0;
    if (!clean) {
      problems.push(`${label}: a TAP summary is not all-pass (${JSON.stringify(summary)})`);
    }
  }
  const wellFormed = Array.isArray(skippedTests) && skippedTests.every((test) => typeof test?.description === "string" && typeof test?.reason === "string");
  if (!wellFormed) {
    problems.push(`${label}: the skipped tests are not recorded as descriptions and reasons`);
    return;
  }
  const counted = summaries.reduce((total, summary) => total + summary.skipped, 0);
  if (counted !== skippedTests.length) {
    problems.push(`${label}: the TAP summaries count ${counted} skipped test(s), and the receipt records ${skippedTests.length}`);
  }
  const recorded = new Map();
  for (const test of skippedTests) {
    const entry = ALLOWED_SKIPS.find((candidate) => candidate.description === test.description && test.reason.startsWith(candidate.reasonPrefix));
    if (!entry) {
      problems.push(`${label}: skipped test "${test.description}" is not in ALLOWED_SKIPS (reason: "${test.reason}")`);
    } else {
      recorded.set(entry, (recorded.get(entry) ?? 0) + 1);
    }
  }
  for (const [entry, count] of recorded) {
    if (count > 1) {
      problems.push(`${label}: skipped test "${entry.description}" is recorded ${count} times, and an allowed skip counts at most once per step`);
    }
  }
}

function checkNativeStep(slice, wanted, ci, problems) {
  const label = `${slice.folder}: step ${wanted.script}`;
  const step = ci.run?.nativeSteps?.[wanted.script];
  if (!step) {
    problems.push(`${label} is missing`);
    return;
  }
  if (step.conclusion !== "success") {
    problems.push(`${label} did not succeed (${step.conclusion})`);
  }
  if (!isCount(step.number) || !isTime(step.startedAt) || !isTime(step.completedAt) || Date.parse(step.startedAt) > Date.parse(step.completedAt)) {
    problems.push(`${label} has no number or a bad time window`);
  }
  if (step.result?.failedTests?.length > 0) {
    problems.push(`${label} recorded failed tests`);
  }
  if (wanted.expect === "tap") {
    checkTap(label, step.result?.tap, step.result?.skippedTests ?? [], problems);
    if (!(step.result?.tests?.length > 0)) {
      problems.push(`${label} recorded no test names`);
    }
  } else if (!step.result?.markers?.some((line) => line.startsWith(wanted.marker))) {
    problems.push(`${label} has no ${wanted.marker} marker`);
  }
}

function checkArtifact(label, entry, descriptor, problems) {
  if (!entry) {
    problems.push(`${label} is missing`);
    return;
  }
  if (entry.name !== descriptor.name) {
    problems.push(`${label} is named ${entry.name}, not ${descriptor.name}`);
  }
  if (entry.available === false) {
    // An artifact that expired or does not exist is recorded as such, with the digest of its upload.
    if (typeof entry.reason !== "string" || !isSha256(entry.uploadLogDigest)) {
      problems.push(`${label} is unavailable without a reason and the digest of its upload log`);
    }
    return;
  }
  if (entry.available !== true || !isCount(entry.id) || !isSha256(entry.zipSha256)) {
    problems.push(`${label} has no id or no zip SHA-256 digest`);
  }
  if (entry.apiDigest !== `sha256:${entry.zipSha256}` || entry.zipSha256EqualsArtifactAPIDigest !== true) {
    problems.push(`${label}: the zip SHA-256 is not the API digest`);
  }
  if (entry.uploadLogDigest !== entry.zipSha256 || entry.zipSha256EqualsUploadLogDigest !== true) {
    problems.push(`${label}: the zip SHA-256 is not the upload log's digest`);
  }
  if (entry.sameNameArtifactsInTheRun !== 1 || !(entry.zipSizeBytes > 0)) {
    problems.push(`${label}: the artifact is not unique in the run or has no size`);
  }
  const files = entry.files && typeof entry.files === "object" ? Object.entries(entry.files) : [];
  if (files.length === 0 || files.length !== entry.fileCount || files.some(([, digest]) => !isSha256(digest))) {
    problems.push(`${label}: the file list is empty, has a different count or a file without a SHA-256`);
  }
}

// The whole line the guard prints when it passes: it names the base by its first 12 hex digits and by the full SHA, and its verdicts are the
// ones that do not fail the step. X9 is not-applicable when the push adds no 0.5 entry; a violation never reaches this line.
const guardLine = (base) => new RegExp(`^${GUARD_STEP.marker}: against ${base.slice(0, 12)} \\(--base ${base}\\); X9 (?:clean|not-applicable), X10 clean$`);

// The guard step exists in the `contracts` job from #87 on. A slice that the table marks with `guard` must show it passed, with the line it prints
// and the base it compared against; an older slice must not have a record of a step its run did not have.
function checkGuardStep(slice, step, label, problems) {
  if (slice.guard !== true) {
    if (step !== undefined) {
      problems.push(`${label}: the table does not expect the milestone guards step`);
    }
    return;
  }
  if (step?.step !== GUARD_STEP.name || step.conclusion !== "success" || !isCount(step.number) || !isTime(step.startedAt) || !isTime(step.completedAt)) {
    problems.push(`${label}: the milestone guards step did not succeed`);
  }
  const lines = Array.isArray(step?.markers) ? step.markers.filter((marker) => marker.startsWith(GUARD_STEP.marker)) : [];
  if (!isSha1(step?.base) || lines.length !== 1 || !guardLine(step.base).test(lines[0])) {
    problems.push(`${label}: the milestone guards step has no ${GUARD_STEP.marker} line for its base, ending in X9 clean or not-applicable and X10 clean`);
  }
}

function checkHostedCi(slice, ci, problems) {
  const label = `${slice.folder}: hosted-ci.json`;
  if (ci.schemaVersion !== 1 || ci.scenario !== slice.folder || ci.repository !== REPOSITORY) {
    problems.push(`${label} does not describe ${slice.folder} in ${REPOSITORY}`);
  }
  const run = ci.run ?? {};
  if (run.id !== slice.contractsRun) {
    problems.push(`${label}: the run is ${run.id}, the table says ${slice.contractsRun}`);
  }
  if (!isSha1(run.headSha) || !run.headSha.startsWith(slice.squash)) {
    problems.push(`${label}: the run's head ${run.headSha} is not the squash ${slice.squash} of #${slice.pr}`);
  }
  const jobs = Array.isArray(run.jobs) ? run.jobs : [];
  // A push that skipped the opt-in native jobs lists the dispatch's eight jobs; any other skipped job, or a skipped job of another event, is refused below.
  const skipped = jobs.filter((job) => job.conclusion === "skipped").map((job) => job.name).sort();
  const optIn = skipped.length > 0 && run.event === "push";
  let expectedJobs = Object.hasOwn(CONTRACTS_JOBS, run.event) ? CONTRACTS_JOBS[run.event] : null;
  if (optIn) {
    expectedJobs = CONTRACTS_JOBS.workflow_dispatch;
  }
  if (!expectedJobs || run.branch !== "main" || run.workflow !== "Contracts" || run.status !== "completed" || run.conclusion !== "success" || run.attemptCount !== 1) {
    problems.push(`${label}: the run is not a completed, successful, first-attempt Contracts push or dispatch of main`);
  }
  if (run.mergedPullRequest !== `${REPOSITORY_URL}/pull/${slice.pr}`) {
    problems.push(`${label}: the merged pull request is not #${slice.pr}`);
  }
  if (skipped.length > 0 && (!optIn || JSON.stringify(skipped) !== JSON.stringify(OPT_IN_JOBS))) {
    problems.push(`${label}: only a push may skip jobs, and exactly the opt-in native ones (${OPT_IN_JOBS.join(", ")}), not ${skipped.join(", ")}`);
  }
  if (optIn && (slice.nativeSteps.length > 0 || slice.artifacts.length > 0)) {
    problems.push(`${label}: a run that skipped the native jobs cannot prove the native steps or artifacts of the table`);
  }
  if (expectedJobs && JSON.stringify(jobs.map((job) => job.name).sort()) !== JSON.stringify(expectedJobs)) {
    problems.push(`${label}: the jobs are not ${expectedJobs.join(", ")}`);
  }
  for (const job of jobs) {
    if (job.status !== "completed" || (job.conclusion !== "success" && job.conclusion !== "skipped")) {
      problems.push(`${label}: job ${job.name} is ${job.status}/${job.conclusion}, not completed/success`);
    }
    if (job.headSha !== run.headSha || job.runAttempt !== 1 || !isCount(job.databaseId)) {
      problems.push(`${label}: job ${job.name} has another head, another attempt or no id`);
    }
    // A skipped job never ran, so the receipt keeps no times for it; a job that ran has both, and its completion is not before its start.
    if (job.conclusion === "skipped") {
      if (Object.hasOwn(job, "startedAt") || Object.hasOwn(job, "completedAt")) {
        problems.push(`${label}: job ${job.name} is skipped, so it has no startedAt or completedAt`);
      }
    } else if (!isTime(job.startedAt) || !isTime(job.completedAt) || Date.parse(job.startedAt) > Date.parse(job.completedAt)) {
      problems.push(`${label}: job ${job.name} ran but has no valid startedAt and completedAt, or completedAt is before startedAt`);
    }
  }
  // A skipped job has no log, so it has no checkout either.
  const checkouts = run.jobCheckouts ?? {};
  const checkedOut = expectedJobs?.filter((name) => !skipped.includes(name)) ?? null;
  if (JSON.stringify(Object.keys(checkouts).sort()) !== JSON.stringify(checkedOut) || Object.values(checkouts).some((sha) => sha !== run.headSha)) {
    problems.push(`${label}: not every job checked out the squash`);
  }
  const pull = ci.pullRequest ?? {};
  if (pull.number !== slice.pr || pull.squashMergeCommit !== run.headSha || !isTime(pull.mergedAt) || !isSha1(pull.headSha)) {
    problems.push(`${label}: the pull request is not #${slice.pr} merged as the run's head`);
  }
  if (typeof pull.squashCommitSubject !== "string" || !pull.squashCommitSubject.endsWith(`(#${slice.pr})`)) {
    problems.push(`${label}: the squash commit's subject does not name #${slice.pr}`);
  }
  if (!isSha1(pull.headTreeSha) || !isSha1(pull.mainTreeSha)) {
    problems.push(`${label}: the head and squash trees are missing`);
  } else if ((pull.headTreeSha === pull.mainTreeSha) !== (pull.headTreeEqualsMainTree === true)) {
    problems.push(`${label}: headTreeEqualsMainTree contradicts the two tree SHAs`);
  } else if (pull.headTreeEqualsMainTree !== true && pull.treeDifference?.explainedByMain !== true) {
    problems.push(`${label}: the head tree differs from the squash tree and main does not explain it`);
  }
  const steps = Object.keys(run.nativeSteps ?? {}).sort();
  if (JSON.stringify(steps) !== JSON.stringify(slice.nativeSteps.map((step) => step.script).sort())) {
    problems.push(`${label}: the native steps are not those of the table`);
  }
  for (const wanted of slice.nativeSteps) {
    checkNativeStep(slice, wanted, ci, problems);
    // A receipt of the single native job names no job; one of a dispatched run names the job that ran the step.
    const job = run.nativeSteps?.[wanted.script]?.job ?? "native-cold-start";
    if (!job.startsWith("native-") || !expectedJobs?.includes(job)) {
      problems.push(`${slice.folder}: step ${wanted.script} ran in ${job}, not in a native job of the run`);
    }
  }
  const contracts = run.contractsJob ?? {};
  for (const name of ["test:contracts", "check:static", "check:publication"]) {
    if (contracts.steps?.[name]?.conclusion !== "success") {
      problems.push(`${label}: contracts step ${name} did not succeed`);
    }
  }
  checkTap(`${label}: test:contracts`, contracts.steps?.["test:contracts"]?.tap, contracts.steps?.["test:contracts"]?.skippedTests ?? [], problems);
  if (contracts.steps?.["check:publication"]?.passed !== true) {
    problems.push(`${label}: check:publication did not report passed`);
  }
  checkGuardStep(slice, contracts.steps?.["milestone-guards"], label, problems);
  const sliceTests = contracts.sliceContractTests ?? [];
  if (JSON.stringify(sliceTests.map((entry) => entry.file)) !== JSON.stringify(slice.contractTests)) {
    problems.push(`${label}: the contract test files are not those of the table`);
  }
  for (const entry of sliceTests) {
    if (!(entry.tests > 0) || entry.passed !== entry.tests || entry.topLevel?.length !== entry.tests) {
      problems.push(`${label}: not every test of ${entry.file} passed in the contracts job`);
    }
  }
  const artifactKeys = Object.keys(ci.artifacts ?? {}).sort();
  if (JSON.stringify(artifactKeys) !== JSON.stringify(slice.artifacts.map((entry) => entry.key).sort())) {
    problems.push(`${label}: the artifacts are not those of the table`);
  }
  for (const descriptor of slice.artifacts) {
    checkArtifact(`${label}: artifact ${descriptor.name}`, ci.artifacts?.[descriptor.key], descriptor, problems);
  }
  const unavailable = Object.values(ci.artifacts ?? {}).filter((entry) => entry?.available === false).length;
  if (!Array.isArray(ci.findings) || ci.findings.length !== unavailable) {
    problems.push(`${label}: the findings are not exactly the ${unavailable} unavailable artifact(s)`);
  }
}

function checkPublication(slice, pub, ci, problems) {
  const label = `${slice.folder}: publication.json`;
  if (pub.schemaVersion !== 1 || pub.scenario !== slice.folder || pub.repository !== REPOSITORY) {
    problems.push(`${label} does not describe ${slice.folder} in ${REPOSITORY}`);
  }
  if (pub.run !== slice.pagesRun || pub.event !== "push" || pub.branch !== "main" || pub.attempts !== 1) {
    problems.push(`${label}: the run is not the first attempt of Pages run ${slice.pagesRun} on a push of main`);
  }
  if (!isSha1(pub.mainCommit) || !pub.mainCommit.startsWith(slice.squash) || pub.mainCommit !== ci.run?.headSha) {
    problems.push(`${label}: the main commit ${pub.mainCommit} is not the squash ${slice.squash} that hosted-ci.json records`);
  }
  if (pub.mergedPullRequest !== `${REPOSITORY_URL}/pull/${slice.pr}` || pub.buildCheckout !== pub.mainCommit) {
    problems.push(`${label}: the pull request or the build checkout is not the slice's`);
  }
  if (JSON.stringify(Object.keys(pub.jobs ?? {}).sort()) !== JSON.stringify(PAGES_JOBS) || Object.values(pub.jobs ?? {}).some((value) => value !== "success") || pub.buildAndDeployPassed !== true) {
    problems.push(`${label}: build and deploy are not both success`);
  }
  if (!(pub.dashboardTestsTap?.pass > 0) || pub.dashboardTestsTap?.fail !== 0) {
    problems.push(`${label}: the dashboard tests did not pass`);
  }
  const deployment = pub.deployment ?? {};
  if (!isCount(deployment.id) || deployment.sha !== pub.mainCommit || deployment.state !== "success" || typeof deployment.environmentUrl !== "string") {
    problems.push(`${label}: the deployment is not a success of the squash`);
  }
  if (!isSha256(pub.committedMigrationJsonSha256)) {
    problems.push(`${label}: the committed migration.json digest is missing`);
  }
  const activity = pub.sliceActivity ?? {};
  if (activity.id !== slice.activity || activity.presentInCommittedJson !== true) {
    problems.push(`${label}: the slice's activity entry ${slice.activity} is not recorded in the committed data`);
  }
  const artifact = pub.deployedArtifact ?? {};
  if (artifact.name !== "github-pages") {
    problems.push(`${label}: the deployed artifact is not github-pages`);
  }
  if (artifact.available === false) {
    if (pub.status !== "verified-deployment-artifact-unavailable" || typeof artifact.reason !== "string" || !isSha256(artifact.uploadLogDigest) || !Array.isArray(pub.findings) || pub.findings.length === 0) {
      problems.push(`${label}: an unavailable artifact is not recorded as such, with the upload log digest and a finding`);
    }
    return;
  }
  // A committed file that is not in the Pages build's own serialization is a finding, not a failure.
  const bytesEqual = artifact.migrationJsonSha256 === pub.committedMigrationJsonSha256;
  if (pub.status !== "verified" || !Array.isArray(pub.findings) || pub.findings.length !== (bytesEqual ? 0 : 1)) {
    problems.push(`${label}: the status or the findings contradict an available artifact`);
  }
  if (!isCount(artifact.id) || !isSha256(artifact.zipSha256)) {
    problems.push(`${label}: the deployed artifact has no id or no zip SHA-256 digest`);
  }
  if (artifact.apiDigest !== `sha256:${artifact.zipSha256}` || artifact.zipSha256EqualsArtifactAPIDigest !== true || artifact.zipSha256EqualsUploadLogDigest !== true) {
    problems.push(`${label}: the zip SHA-256 is not the API digest and the upload log's digest`);
  }
  if (!Array.isArray(artifact.files) || artifact.files.length === 0 || !artifact.files.includes("migration.json") || !isSha256(artifact.migrationJsonSha256)) {
    problems.push(`${label}: the file list or the deployed migration.json digest is missing`);
  }
  if (pub.deployedJSONBytesEqualCommittedBytes !== bytesEqual) {
    problems.push(`${label}: the deployed migration.json is not the committed one, byte for byte, as the receipt says`);
  }
  if (pub.deployedJSONEqualsCommittedData !== true || (!bytesEqual && pub.deployedBytesEqualCanonicalSerializationOfCommittedData !== true)) {
    problems.push(`${label}: the deployed migration.json is neither the committed bytes nor their canonical serialization`);
  }
  if (activity.presentInDeployedJson !== true) {
    problems.push(`${label}: the deployed data does not hold the slice's activity entry`);
  }
}

function readReceipt(evidenceDir, relative, problems) {
  const file = path.join(evidenceDir, relative);
  if (!existsSync(file)) {
    problems.push(`${relative} does not exist`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    problems.push(`${relative} is not JSON: ${error.message}`);
    return null;
  }
}

export function checkReceipts(evidenceDir) {
  const problems = [];
  const squashes = new Set();
  for (const slice of SLICES) {
    const ci = readReceipt(evidenceDir, `${slice.folder}/hosted-ci.json`, problems);
    const pub = readReceipt(evidenceDir, `${slice.folder}/publication.json`, problems);
    if (ci) {
      checkHostedCi(slice, ci, problems);
    }
    if (ci && pub) {
      checkPublication(slice, pub, ci, problems);
    }
    squashes.add(slice.squash);
  }
  if (squashes.size !== SLICES.length) {
    problems.push("the table repeats a squash commit");
  }
  return problems;
}
