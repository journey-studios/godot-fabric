import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { REPOSITORY, REPOSITORY_URL, SLICES } from "./hosted-receipts-slices.mjs";

// The offline check of the committed hosted receipts. No network: the receipts must agree with the
// table of slices and with themselves (scripts/hosted-receipts.mjs --check).

const EXPECTED_JOBS = ["contracts", "native-cold-start", "parity-comparison", "reference-android", "reference-ios"];
const PAGES_JOBS = ["build", "deploy"];

const isSha1 = (value) => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
const isSha256 = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const isCount = (value) => Number.isInteger(value) && value >= 0;
const isTime = (value) => typeof value === "string" && !Number.isNaN(Date.parse(value));

function checkTap(label, summaries, problems) {
  if (!Array.isArray(summaries) || summaries.length === 0) {
    problems.push(`${label}: no TAP summary was recorded`);
    return;
  }
  for (const summary of summaries) {
    const clean = summary.tests > 0 && summary.pass === summary.tests && summary.fail === 0 && summary.cancelled === 0 && summary.skipped === 0 && summary.todo === 0;
    if (!clean) {
      problems.push(`${label}: a TAP summary is not all-pass (${JSON.stringify(summary)})`);
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
    checkTap(label, step.result?.tap, problems);
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
  if (run.event !== "push" || run.branch !== "main" || run.workflow !== "Contracts" || run.status !== "completed" || run.conclusion !== "success" || run.attemptCount !== 1) {
    problems.push(`${label}: the run is not a completed, successful, first-attempt Contracts push of main`);
  }
  if (run.mergedPullRequest !== `${REPOSITORY_URL}/pull/${slice.pr}`) {
    problems.push(`${label}: the merged pull request is not #${slice.pr}`);
  }
  const jobs = Array.isArray(run.jobs) ? run.jobs : [];
  if (JSON.stringify(jobs.map((job) => job.name).sort()) !== JSON.stringify(EXPECTED_JOBS)) {
    problems.push(`${label}: the jobs are not ${EXPECTED_JOBS.join(", ")}`);
  }
  for (const job of jobs) {
    if (job.status !== "completed" || job.conclusion !== "success") {
      problems.push(`${label}: job ${job.name} is ${job.status}/${job.conclusion}, not completed/success`);
    }
    if (job.headSha !== run.headSha || job.runAttempt !== 1 || !isCount(job.databaseId) || !isTime(job.startedAt) || !isTime(job.completedAt)) {
      problems.push(`${label}: job ${job.name} has another head, another attempt or no id and times`);
    }
  }
  const checkouts = run.jobCheckouts ?? {};
  if (JSON.stringify(Object.keys(checkouts).sort()) !== JSON.stringify(EXPECTED_JOBS) || Object.values(checkouts).some((sha) => sha !== run.headSha)) {
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
  }
  const contracts = run.contractsJob ?? {};
  for (const name of ["test:contracts", "check:static", "check:publication"]) {
    if (contracts.steps?.[name]?.conclusion !== "success") {
      problems.push(`${label}: contracts step ${name} did not succeed`);
    }
  }
  checkTap(`${label}: test:contracts`, contracts.steps?.["test:contracts"]?.tap, problems);
  if (contracts.steps?.["check:publication"]?.passed !== true) {
    problems.push(`${label}: check:publication did not report passed`);
  }
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
