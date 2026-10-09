import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { CONTRACTS_JOBS, GUARD_STEP, OPT_IN_JOBS, checkReceipts } from "./hosted-receipts-check.mjs";
import { REPOSITORY, REPOSITORY_URL, SLICES } from "./hosted-receipts-slices.mjs";

// Hosted receipts of the 0.5 Frontier slices that already reached main.
//
//   node scripts/hosted-receipts.mjs --write [--slice <folder>[,<folder>]] [--work-dir <dir>]
//   node scripts/hosted-receipts.mjs --check [--evidence-dir <dir>]
//
// --write asks the GitHub API through the authenticated `gh` (reads only: `gh api` GET), downloads
// the job logs and the artifacts into a temporary directory outside the repository and writes
// docs/evidence/<folder>/hosted-ci.json and publication.json. Every fact comes from the API, from a
// log or from a downloaded file.
// --check reads the committed receipts and judges their internal coherence. It needs no network.
// The table of slices is in hosted-receipts-slices.mjs and the offline check in hosted-receipts-check.mjs.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_EVIDENCE_DIR = path.join(REPO_ROOT, "docs", "evidence");

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const stable = (value) => `${JSON.stringify(value, null, 2)}\n`;

// ---------------------------------------------------------------------------------------------
// GitHub through `gh api`. Only the default GET method is ever used.

function ghBuffer(endpoint, accept) {
  const args = ["api", endpoint];
  if (accept) {
    args.push("-H", `Accept: ${accept}`);
  }
  return execFileSync("gh", args, { maxBuffer: 1 << 29, timeout: 600000, stdio: ["ignore", "pipe", "pipe"] });
}

const ghJson = (endpoint) => JSON.parse(ghBuffer(endpoint).toString("utf8"));

const withPage = (endpoint, page) => `${endpoint}${endpoint.includes("?") ? "&" : "?"}per_page=100&page=${page}`;

// Endpoints that answer { total_count, <key>: [...] }.
function ghPages(endpoint, key) {
  const items = [];
  for (let page = 1; ; page += 1) {
    const body = ghJson(withPage(endpoint, page));
    items.push(...body[key]);
    if (items.length >= body.total_count || body[key].length === 0) {
      return items;
    }
  }
}

// Endpoints that answer a bare array.
function ghList(endpoint) {
  const items = [];
  for (let page = 1; ; page += 1) {
    const body = ghJson(withPage(endpoint, page));
    items.push(...body);
    if (body.length < 100) {
      return items;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Archives. The system's unzip and tar do the reading, each into a new empty directory of the work
// directory (outside the repository). Both exit non-zero on a corrupt archive, a failed CRC or a path
// that leaves the directory, and anything that is neither a regular file nor a directory in what they
// wrote is refused here.

function extractInto(command, args, directory) {
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  execFileSync(command, [...args, directory], { stdio: ["ignore", "pipe", "pipe"] });
}

const unzipInto = (zipFile, directory) => extractInto("unzip", ["-q", zipFile, "-d"], directory);
const untarInto = (tarFile, directory) => extractInto("tar", ["-xf", tarFile, "-C"], directory);

// Every regular file under the directory, by its path relative to it with "/" separators.
function extractedFiles(directory) {
  const files = new Map();
  for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
    const file = path.join(entry.parentPath, entry.name);
    if (entry.isFile()) {
      files.set(path.relative(directory, file).split(path.sep).join("/"), readFileSync(file));
    } else if (!entry.isDirectory()) {
      throw new Error(`${file} is neither a regular file nor a directory`);
    }
  }
  return files;
}

const fileDigests = (files) => Object.fromEntries([...files.keys()].sort().map((name) => [name, sha256(files.get(name))]));

// ---------------------------------------------------------------------------------------------
// Logs. A job log is one text; each step opens with a "##[group]Run ..." line.

// biome-ignore lint/suspicious/noControlCharactersInRegex: strips the ANSI escapes of the runner logs
const ANSI = /\u001b\[[0-9;]*m/g;
const TIMESTAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z /;
const MARKER = /^(?:# )?[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_PASSED\b.*$/;
const SUMMARY_FIELDS = ["tests", "suites", "pass", "fail", "cancelled", "skipped", "todo"];

const parseLog = (buffer) =>
  buffer
    .toString("utf8")
    .split("\n")
    .map((line) => line.replace(/\r$/, "").replace(TIMESTAMP, "").replace(ANSI, ""));

function stepSection(lines, stepName) {
  const start = lines.indexOf(`##[group]${stepName}`);
  if (start < 0) {
    throw new Error(`the log has no step "${stepName}"`);
  }
  let end = lines.findIndex((line, index) => index > start && line.startsWith("##[group]Run "));
  if (end < 0) {
    end = lines.length;
  }
  return lines.slice(start, end);
}

function tapSummaries(lines) {
  const summaries = [];
  for (const line of lines) {
    const match = /^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)$/.exec(line);
    if (!match) {
      continue;
    }
    if (match[1] === "tests") {
      summaries.push({});
    }
    if (summaries.length > 0) {
      summaries[summaries.length - 1][match[1]] = parseInt(match[2], 10);
    }
  }
  return summaries.map((summary) => Object.fromEntries(SUMMARY_FIELDS.map((name) => [name, summary[name] ?? 0])));
}

function stepResult(lines) {
  const topLevel = lines.map((line) => /^(not )?ok \d+ - (.*)$/.exec(line)).filter(Boolean);
  return {
    tap: tapSummaries(lines),
    tests: topLevel.filter((match) => !match[1]).map((match) => match[2]),
    failedTests: topLevel.filter((match) => match[1]).map((match) => match[2]),
    markers: lines.filter((line) => MARKER.test(line)),
  };
}

function checkoutShas(lines) {
  const shas = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (/^\[command\].*\/git log -1 --format=%H$/.test(lines[index])) {
      shas.push(lines[index + 1]);
    }
  }
  return shas;
}

function stepRecord(job, name) {
  const step = job.steps.find((candidate) => candidate.name === name);
  if (!step) {
    throw new Error(`job ${job.name} has no step "${name}"`);
  }
  return {
    step: step.name,
    number: step.number,
    conclusion: step.conclusion,
    startedAt: step.started_at,
    completedAt: step.completed_at,
  };
}

function uploadFromLog(lines, artifactName) {
  const done = lines.findIndex((line) => line.startsWith(`Artifact ${artifactName} has been successfully uploaded! `));
  if (done < 0) {
    return null;
  }
  const upload = /Final size is (\d+) bytes\. Artifact ID is (\d+)/.exec(lines[done]);
  let digest = null;
  for (let index = done; index >= Math.max(0, done - 20) && digest === null; index -= 1) {
    const match = /^SHA256 digest of uploaded artifact zip is ([0-9a-f]{64})$/.exec(lines[index]);
    digest = match ? match[1] : null;
  }
  return { bytes: parseInt(upload[1], 10), id: parseInt(upload[2], 10), digest };
}

// ---------------------------------------------------------------------------------------------
// Facts from the API for one slice.

function fetchPullRequest(slice, squash) {
  const pull = ghJson(`repos/${REPOSITORY}/pulls/${slice.pr}`);
  if (!pull.merged || pull.merge_commit_sha !== squash || pull.base.ref !== "main") {
    throw new Error(`${slice.folder}: #${slice.pr} was not squash-merged into main as ${slice.squash}`);
  }
  const headCommit = ghJson(`repos/${REPOSITORY}/git/commits/${pull.head.sha}`);
  const squashCommit = ghJson(`repos/${REPOSITORY}/git/commits/${squash}`);
  if (squashCommit.parents.length !== 1) {
    throw new Error(`${slice.folder}: ${squash} is not a squash commit`);
  }
  return { pull, headCommit, squashCommit, commits: ghList(`repos/${REPOSITORY}/pulls/${slice.pr}/commits`) };
}

function fetchTreeFiles(treeSha) {
  const tree = ghJson(`repos/${REPOSITORY}/git/trees/${treeSha}?recursive=1`);
  if (tree.truncated) {
    throw new Error(`the tree ${treeSha} is too large to compare`);
  }
  return new Map(tree.tree.filter((entry) => entry.type === "blob").map((entry) => [entry.path, entry.sha]));
}

// The head of a pull request and its squash commit have the same tree unless main moved in between.
// When they differ, the paths that differ must all be paths that main changed after the head forked.
function explainTreeDifference(headSha, headTreeSha, squashTreeSha, squashParentSha) {
  const head = fetchTreeFiles(headTreeSha);
  const squash = fetchTreeFiles(squashTreeSha);
  const differing = [...new Set([...head.keys(), ...squash.keys()])].filter((file) => head.get(file) !== squash.get(file)).sort();
  const sinceFork = ghJson(`repos/${REPOSITORY}/compare/${headSha}...${squashParentSha}`);
  const touched = new Set(sinceFork.files.map((file) => file.filename));
  // The compare endpoint lists at most 300 files; a longer list would be a truncated explanation.
  const complete = sinceFork.files.length < 300;
  return {
    differingPaths: differing,
    pathsMainChangedAfterTheHeadForked: touched.size,
    comparisonComplete: complete,
    explainedByMain: complete && differing.every((file) => touched.has(file)),
  };
}

// A commit subject is recorded as written, except that this repository's own URL becomes <repository>: a merge commit of the form
// "Merge branch 'main' of https://github.com/<repository> into <branch>" carries it, and the publication scan refuses the organization's URL
// when a space follows the name.
const subjectOf = (message) => message.split("\n")[0].replaceAll(REPOSITORY_URL, "<repository>");

function pullRequestRecord(slice, squash) {
  const { pull, headCommit, squashCommit, commits } = fetchPullRequest(slice, squash);
  const equal = headCommit.tree.sha === squashCommit.tree.sha;
  const record = {
    number: slice.pr,
    url: `${REPOSITORY_URL}/pull/${slice.pr}`,
    title: pull.title,
    headSha: pull.head.sha,
    baseSha: pull.base.sha,
    squashMergeCommit: squash,
    squashCommitSubject: subjectOf(squashCommit.message),
    mergedAt: pull.merged_at,
    headTreeSha: headCommit.tree.sha,
    mainTreeSha: squashCommit.tree.sha,
    headTreeEqualsMainTree: equal,
  };
  if (!equal) {
    record.treeDifference = explainTreeDifference(pull.head.sha, headCommit.tree.sha, squashCommit.tree.sha, squashCommit.parents[0].sha);
  }
  record.commitCount = pull.commits;
  record.commits = commits.map((commit) => ({ sha: commit.sha, subject: subjectOf(commit.commit.message) }));
  record.changedFiles = pull.changed_files;
  record.additions = pull.additions;
  record.deletions = pull.deletions;
  return record;
}

function jobRecord(job) {
  return {
    name: job.name,
    status: job.status,
    conclusion: job.conclusion,
    databaseId: job.id,
    runAttempt: job.run_attempt,
    headSha: job.head_sha,
    startedAt: job.started_at,
    completedAt: job.completed_at,
    url: job.html_url,
  };
}

function runFacts(runId) {
  const run = ghJson(`repos/${REPOSITORY}/actions/runs/${runId}`);
  const jobs = ghPages(`repos/${REPOSITORY}/actions/runs/${runId}/jobs?filter=all`, "jobs");
  if (run.run_attempt !== 1 || jobs.some((job) => job.run_attempt !== 1)) {
    throw new Error(`run ${runId} has more than one attempt; the receipt format records one`);
  }
  // A skipped job never ran and GitHub keeps no log for it: the API answers 404.
  const logs = new Map();
  for (const job of jobs.filter((candidate) => candidate.conclusion !== "skipped")) {
    logs.set(job.name, parseLog(ghBuffer(`repos/${REPOSITORY}/actions/jobs/${job.id}/logs`)));
  }
  return { run, jobs, logs };
}

function checkoutsOf(jobs, logs, squash) {
  const checkouts = {};
  for (const job of jobs.filter((candidate) => logs.has(candidate.name)).sort((a, b) => a.name.localeCompare(b.name))) {
    const shas = checkoutShas(logs.get(job.name));
    if (shas.length === 0 || shas.some((sha) => sha !== squash)) {
      throw new Error(`job ${job.name} did not check out ${squash}: ${shas.join(", ") || "no checkout"}`);
    }
    checkouts[job.name] = squash;
  }
  return checkouts;
}

function artifactRecord(descriptor, runArtifacts, nativeLog, workDir, runId) {
  const same = runArtifacts.filter((artifact) => artifact.name === descriptor.name);
  if (same.length > 1) {
    throw new Error(`run ${runId} holds ${same.length} artifacts named ${descriptor.name}`);
  }
  const upload = uploadFromLog(nativeLog, descriptor.name);
  if (same.length === 0 || same[0].expired) {
    return {
      available: false,
      name: descriptor.name,
      sameNameArtifactsInTheRun: same.length,
      expired: same.length === 1,
      uploadLogArtifactId: upload?.id ?? null,
      uploadLogDigest: upload?.digest ?? null,
      reason: same.length === 0 ? "the run no longer lists an artifact with this name" : "the artifact expired",
    };
  }
  const [artifact] = same;
  const zip = ghBuffer(`repos/${REPOSITORY}/actions/artifacts/${artifact.id}/zip`);
  const zipFile = path.join(workDir, `${runId}-${descriptor.name}.zip`);
  const directory = path.join(workDir, `${runId}-${descriptor.name}`);
  writeFileSync(zipFile, zip);
  const zipSha256 = sha256(zip);
  if (artifact.digest !== `sha256:${zipSha256}`) {
    throw new Error(`${descriptor.name}: the downloaded zip is ${zipSha256}, the API digest is ${artifact.digest}`);
  }
  if (!upload || upload.digest !== zipSha256 || upload.id !== artifact.id) {
    throw new Error(`${descriptor.name}: the upload log does not describe the downloaded artifact`);
  }
  unzipInto(zipFile, directory);
  const files = extractedFiles(directory);
  const markers = [];
  for (const name of [...files.keys()].sort()) {
    if (name.endsWith(".log")) {
      for (const line of parseLog(files.get(name))) {
        if (MARKER.test(line) || /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_HASH: [0-9a-f]{64}$/.test(line)) {
          markers.push({ file: name, line });
        }
      }
    }
  }
  return {
    available: true,
    id: artifact.id,
    name: artifact.name,
    sameNameArtifactsInTheRun: same.length,
    zipSizeBytes: zip.length,
    zipSizeBytesEqualsArtifactAPISize: zip.length === artifact.size_in_bytes,
    zipSha256,
    apiDigest: artifact.digest,
    zipSha256EqualsArtifactAPIDigest: true,
    uploadLogDigest: upload.digest,
    zipSha256EqualsUploadLogDigest: true,
    uploadedAt: artifact.created_at,
    expiresAt: artifact.expires_at,
    fileCount: files.size,
    files: fileDigests(files),
    markers,
  };
}

function contractTestRecord(file, squash, lines) {
  const source = ghBuffer(`repos/${REPOSITORY}/contents/${file}?ref=${squash}`, "application/vnd.github.raw").toString("utf8");
  const names = [...source.matchAll(/^test\((["'`])(.+?)\1,/gm)].map((match) => match[2]);
  const ok = new Set(lines.map((line) => /^ok \d+ - (.*)$/.exec(line)?.[1]).filter(Boolean));
  const passed = names.filter((name) => ok.has(name));
  if (names.length === 0 || passed.length !== names.length) {
    throw new Error(`${file}: ${passed.length} of its ${names.length} top-level tests passed in the contracts job log`);
  }
  return { file, tests: names.length, passed: passed.length, topLevel: names };
}

// The step that runs the milestone exit guards compared the tree with its base, which on a push is the parent of the squash.
function guardRecord(job, lines, squashParent) {
  const result = stepResult(stepSection(lines, GUARD_STEP.header));
  const line = result.markers.find((marker) => marker.startsWith(GUARD_STEP.marker));
  const base = /--base ([0-9a-f]{40})\b/.exec(line ?? "")?.[1];
  if (base !== squashParent) {
    throw new Error(`the milestone guards step compared with ${base ?? "no base"}, not with the squash's parent ${squashParent}`);
  }
  return { ...stepRecord(job, GUARD_STEP.name), markers: result.markers, base };
}

function contractsRecord(slice, squash, squashParent, job, lines) {
  const test = stepRecord(job, "Run npm run test:contracts");
  const section = stepSection(lines, "Run npm run test:contracts");
  const result = stepResult(section);
  const python = /^Ran (\d+) tests? in /.exec(section.find((line) => /^Ran \d+ tests? in /.test(line)) ?? "");
  const scan = stepSection(lines, "Run npm run check:publication").join("\n");
  return {
    steps: {
      ...(slice.guard ? { "milestone-guards": guardRecord(job, lines, squashParent) } : {}),
      "test:contracts": {
        ...test,
        tap: result.tap,
        failedTests: result.failedTests,
        markers: result.markers,
        pythonContractTests: python ? parseInt(python[1], 10) : null,
      },
      "check:static": stepRecord(job, "Run npm run check:static"),
      "check:publication": {
        ...stepRecord(job, "Run npm run check:publication"),
        passed: /"passed": true/.test(scan),
        files: parseInt(/"files": (\d+)/.exec(scan)?.[1] ?? "0", 10),
      },
    },
    sliceContractTests: slice.contractTests.map((file) => contractTestRecord(file, squash, section)),
  };
}

// The one native job that ran a step or uploaded an artifact: a dispatched run splits the suites between jobs.
function nativeJobOf(jobs, logs, label, holds) {
  const holders = jobs.filter((job) => job.name.startsWith("native-") && logs.has(job.name) && holds(job, logs.get(job.name)));
  if (holders.length !== 1) {
    throw new Error(`${label} is in ${holders.length} native jobs of the run, not in one`);
  }
  return holders[0];
}

function hostedCiReceipt(slice, workDir) {
  const facts = runFacts(slice.contractsRun);
  const { run, jobs, logs } = facts;
  const squash = run.head_sha;
  // Since the native suites became opt-in, a push of main skips them: a slice with a native step needs the Contracts run
  // dispatched on main while it was still at the squash (gh workflow run contracts.yml --ref main). A slice with no native
  // step and no native artifact is judged from the push itself, whose skipped native jobs are recorded as skipped.
  if (!squash.startsWith(slice.squash) || !Object.hasOwn(CONTRACTS_JOBS, run.event) || run.head_branch !== "main" || run.name !== "Contracts") {
    throw new Error(`${slice.folder}: run ${slice.contractsRun} is not a Contracts push or dispatch of main at ${slice.squash}`);
  }
  const withoutNative = run.event === "push" && slice.nativeSteps.length === 0 && slice.artifacts.length === 0;
  const skippedOnPurpose = (job) => job.conclusion === "skipped" && withoutNative && OPT_IN_JOBS.includes(job.name);
  if (run.status !== "completed" || run.conclusion !== "success" || jobs.some((job) => job.conclusion !== "success" && !skippedOnPurpose(job))) {
    throw new Error(`${slice.folder}: run ${slice.contractsRun} did not succeed in every job (a push skips the native jobs; dispatch the run, or use a slice with no native step)`);
  }
  const pullRequest = pullRequestRecord(slice, squash);
  const squashParent = slice.guard ? ghJson(`repos/${REPOSITORY}/git/commits/${squash}`).parents[0].sha : null;
  const nativeSteps = {};
  for (const wanted of slice.nativeSteps) {
    const name = `Run npm run ${wanted.script}`;
    const native = nativeJobOf(jobs, logs, `step "${name}"`, (job) => job.steps.some((step) => step.name === name));
    const result = stepResult(stepSection(logs.get(native.name), name));
    nativeSteps[wanted.script] = { ...(run.event === "push" ? {} : { job: native.name }), ...stepRecord(native, name), result };
  }
  const runArtifacts = ghPages(`repos/${REPOSITORY}/actions/runs/${slice.contractsRun}/artifacts`, "artifacts");
  const artifacts = {};
  for (const descriptor of slice.artifacts) {
    const uploader = nativeJobOf(jobs, logs, `the upload of ${descriptor.name}`, (job, lines) => uploadFromLog(lines, descriptor.name) !== null);
    artifacts[descriptor.key] = artifactRecord(descriptor, runArtifacts, logs.get(uploader.name), workDir, slice.contractsRun);
  }
  // The parity comparison needs the cold build, so a run that skipped the native jobs has no comparison to read.
  const parity = logs.get("parity-comparison")?.find((line) => line.startsWith("PARITY_COMPARISON_PASSED"));
  const receipt = {
    schemaVersion: 1,
    scenario: slice.folder,
    status: slice.artifacts.length > 0 ? "verified-completed-hosted-workflow-and-slice-artifacts" : "verified-completed-hosted-workflow-and-slice-contract-tests",
    at: new Date().toISOString(),
    repository: REPOSITORY,
    run: {
      id: run.id,
      headSha: squash,
      event: run.event,
      branch: run.head_branch,
      workflow: run.name,
      url: run.html_url,
      mergedPullRequest: pullRequest.url,
      status: run.status,
      conclusion: run.conclusion,
      attemptCount: run.run_attempt,
      startedAt: run.run_started_at,
      updatedAt: run.updated_at,
      jobs: jobs.map(jobRecord).sort((a, b) => a.name.localeCompare(b.name)),
      jobCheckouts: checkoutsOf(jobs, logs, squash),
      contractsJob: contractsRecord(slice, squash, squashParent, jobs.find((job) => job.name === "contracts"), logs.get("contracts")),
      referenceParity: { comparison: parity ?? null },
      nativeSteps,
    },
    pullRequest,
    artifacts,
    findings: Object.values(artifacts)
      .filter((artifact) => !artifact.available)
      .map((artifact) => `${artifact.name}: ${artifact.reason}`),
  };
  return receipt;
}

function deploymentRecord(squash, run) {
  const windowStart = Date.parse(run.created_at) - 60000;
  const windowEnd = Date.parse(run.updated_at) + 60000;
  const deployments = ghJson(`repos/${REPOSITORY}/deployments?sha=${squash}&environment=github-pages&per_page=100`).filter(
    (deployment) => Date.parse(deployment.created_at) >= windowStart && Date.parse(deployment.updated_at) <= windowEnd,
  );
  if (deployments.length !== 1) {
    throw new Error(`expected one github-pages deployment of ${squash} during run ${run.id}, found ${deployments.length}`);
  }
  const [deployment] = deployments;
  const statuses = ghJson(`repos/${REPOSITORY}/deployments/${deployment.id}/statuses?per_page=100`);
  return {
    id: deployment.id,
    sha: deployment.sha,
    state: statuses[0].state,
    at: statuses[0].created_at,
    environmentUrl: statuses[0].environment_url,
  };
}

function publicationReceipt(slice, squash, pullUrl, workDir) {
  const { run, jobs, logs } = runFacts(slice.pagesRun);
  if (run.head_sha !== squash || run.event !== "push" || run.head_branch !== "main") {
    throw new Error(`${slice.folder}: Pages run ${slice.pagesRun} is not the push of main at ${slice.squash}`);
  }
  if (run.status !== "completed" || run.conclusion !== "success" || jobs.some((job) => job.conclusion !== "success")) {
    throw new Error(`${slice.folder}: Pages run ${slice.pagesRun} did not succeed`);
  }
  const build = logs.get("build");
  const deployLog = logs.get("deploy");
  const checkouts = new Set(checkoutShas(build));
  if (checkouts.size !== 1 || !checkouts.has(squash)) {
    throw new Error(`${slice.folder}: the Pages build did not check out ${squash}`);
  }
  const testStep = jobs.find((job) => job.name === "build").steps.find((step) => /^Run node --test /.test(step.name));
  const tap = tapSummaries(stepSection(build, testStep.name)).pop();
  const upload = uploadFromLog(build, "github-pages");
  if (!upload) {
    throw new Error(`${slice.folder}: the Pages build log does not show the github-pages upload`);
  }
  const deployedId = parseInt(/"artifact_id": (\d+)/.exec(deployLog.join("\n"))?.[1] ?? "0", 10);
  const committed = ghBuffer(`repos/${REPOSITORY}/contents/dashboard/migration.json?ref=${squash}`, "application/vnd.github.raw");
  const committedJson = JSON.parse(committed.toString("utf8"));
  const committedHasActivity = committedJson.activity.some((entry) => entry.id === slice.activity);
  if (!committedHasActivity || upload.id !== deployedId) {
    throw new Error(`${slice.folder}: the activity entry or the deployed artifact id is not what the table says`);
  }
  const listed = ghPages(`repos/${REPOSITORY}/actions/runs/${slice.pagesRun}/artifacts`, "artifacts").filter((artifact) => artifact.name === "github-pages");
  const deployment = deploymentRecord(squash, run);
  const deployed = deployedArtifactFacts(slice, listed, upload, deployedId, committed, workDir);
  const activity = committedJson.activity.find((entry) => entry.id === slice.activity);
  const receipt = {
    schemaVersion: 1,
    scenario: slice.folder,
    status: deployed.available ? "verified" : "verified-deployment-artifact-unavailable",
    at: new Date().toISOString(),
    repository: REPOSITORY,
    mergedPullRequest: pullUrl,
    mainCommit: squash,
    run: run.id,
    url: run.html_url,
    event: run.event,
    branch: run.head_branch,
    startedAt: run.run_started_at,
    completedAt: run.updated_at,
    triggeredBy: run.triggering_actor.login,
    jobs: Object.fromEntries(jobs.map((job) => [job.name, job.conclusion]).sort((a, b) => a[0].localeCompare(b[0]))),
    buildAndDeployPassed: true,
    attempts: run.run_attempt,
    buildCheckout: squash,
    dashboardTestsTap: { pass: tap.pass, fail: tap.fail },
    deployment,
    deployedArtifact: deployed.artifact,
    committedMigrationJsonSha256: sha256(committed),
  };
  if (deployed.available) {
    receipt.deployedJSONBytesEqualCommittedBytes = deployed.bytesEqual;
    receipt.deployedJSONEqualsCommittedData = true;
    receipt.deployedBytesEqualCanonicalSerializationOfCommittedData = deployed.canonicalEqual;
  }
  receipt.sliceActivity = {
    id: slice.activity,
    taskIds: activity.taskIds,
    presentInCommittedJson: true,
    presentInDeployedJson: deployed.available ? true : null,
  };
  receipt.livePublicSite = {
    url: "https://journey-studios.github.io/godot-fabric/migration.json",
    compared: false,
    note: "a later push to main replaces the deployment, so the public site serves a later deployment's data and is not the evidence",
  };
  receipt.findings = [];
  if (!deployed.available) {
    receipt.findings.push(
      "the deployment succeeded, but its github-pages artifact is no longer retrievable, so the deployed migration.json was not compared with the committed bytes",
    );
  } else if (!deployed.bytesEqual) {
    receipt.findings.push(
      "the committed dashboard/migration.json is not in the canonical serialization (two spaces, final newline) that the Pages build writes, so its bytes differ from the deployed file's; the deployed file is that serialization of the same data",
    );
  }
  return receipt;
}

// The artifact the deployment published: downloaded and opened, or recorded as gone.
function deployedArtifactFacts(slice, listed, upload, deployedId, committed, workDir) {
  if (listed.length === 0 || listed[0].expired) {
    return {
      available: false,
      artifact: {
        available: false,
        name: "github-pages",
        id: deployedId,
        sizeBytes: upload.bytes,
        uploadLogDigest: upload.digest,
        reason: listed.length === 0 ? "the run no longer lists the github-pages artifact" : "the github-pages artifact expired",
      },
    };
  }
  const [artifact] = listed;
  const zip = ghBuffer(`repos/${REPOSITORY}/actions/artifacts/${artifact.id}/zip`);
  const zipFile = path.join(workDir, `${slice.pagesRun}-github-pages.zip`);
  const outerDirectory = path.join(workDir, `${slice.pagesRun}-github-pages`);
  const siteDirectory = path.join(workDir, `${slice.pagesRun}-github-pages-site`);
  writeFileSync(zipFile, zip);
  const zipSha256 = sha256(zip);
  if (artifact.digest !== `sha256:${zipSha256}` || upload.digest !== zipSha256 || artifact.id !== deployedId) {
    throw new Error(`${slice.folder}: the downloaded github-pages zip does not match the API digest, the upload log or the deployment`);
  }
  unzipInto(zipFile, outerDirectory);
  const outer = extractedFiles(outerDirectory);
  if (outer.size !== 1 || !outer.has("artifact.tar")) {
    throw new Error(`${slice.folder}: the github-pages zip does not hold exactly artifact.tar`);
  }
  untarInto(path.join(outerDirectory, "artifact.tar"), siteDirectory);
  const site = extractedFiles(siteDirectory);
  const deployed = site.get("migration.json");
  if (!deployed) {
    throw new Error(`${slice.folder}: the Pages artifact has no migration.json`);
  }
  const deployedJson = JSON.parse(deployed.toString("utf8"));
  const committedJson = JSON.parse(committed.toString("utf8"));
  // The Pages build parses the data and writes it back with two spaces and a final newline, so the
  // deployed bytes are the committed bytes only when the committed file already is that serialization.
  const bytesEqual = Buffer.compare(deployed, committed) === 0;
  const canonicalEqual = Buffer.compare(deployed, Buffer.from(`${JSON.stringify(committedJson, null, 2)}\n`)) === 0;
  if (!isDeepStrictEqual(deployedJson, committedJson) || !(bytesEqual || canonicalEqual)) {
    throw new Error(`${slice.folder}: the deployed migration.json is neither the committed bytes nor their canonical serialization`);
  }
  if (!deployedJson.activity.some((entry) => entry.id === slice.activity)) {
    throw new Error(`${slice.folder}: the deployed migration.json lacks the activity entry ${slice.activity}`);
  }
  return {
    available: true,
    bytesEqual,
    canonicalEqual,
    artifact: {
      available: true,
      name: artifact.name,
      id: artifact.id,
      zipSizeBytes: zip.length,
      zipSha256,
      apiDigest: artifact.digest,
      zipSha256EqualsArtifactAPIDigest: true,
      zipSha256EqualsUploadLogDigest: true,
      deploymentUsedThisArtifact: true,
      files: [...site.keys()].sort(),
      migrationJsonSha256: sha256(deployed),
      publicationMetadataPresent: Object.hasOwn(deployedJson, "publication"),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Writing.

const LOCAL_PATH = [/\/Users\//i, /(?<![\w.-])\/private\//i, /[A-Z]:\\Users\\/i];

function assertPublishable(text, label) {
  for (const pattern of LOCAL_PATH) {
    if (pattern.test(text)) {
      throw new Error(`${label} would publish a local path (${pattern.source})`);
    }
  }
}

function writeReceipts(options) {
  const slices = options.slices.length === 0 ? SLICES : SLICES.filter((slice) => options.slices.includes(slice.folder));
  if (slices.length !== (options.slices.length === 0 ? SLICES.length : options.slices.length)) {
    throw new Error(`unknown slice in --slice ${options.slices.join(",")}`);
  }
  const workDir = options.workDir ?? mkdtempSync(path.join(tmpdir(), "hosted-receipts-"));
  mkdirSync(workDir, { recursive: true });
  if (!path.relative(REPO_ROOT, path.resolve(workDir)).startsWith("..")) {
    throw new Error("--work-dir must be outside the repository");
  }
  for (const slice of slices) {
    const ci = hostedCiReceipt(slice, workDir);
    const publication = publicationReceipt(slice, ci.run.headSha, ci.pullRequest.url, workDir);
    const directory = path.join(options.evidenceDir, slice.folder);
    mkdirSync(directory, { recursive: true });
    for (const [file, receipt] of [
      ["hosted-ci.json", ci],
      ["publication.json", publication],
    ]) {
      const text = stable(receipt);
      assertPublishable(text, `${slice.folder}/${file}`);
      writeFileSync(path.join(directory, file), text);
    }
    console.log(`${slice.folder}: wrote hosted-ci.json (run ${ci.run.id}) and publication.json (run ${publication.run})`);
  }
  console.log(`downloads stayed in ${workDir}`);
}

// ---------------------------------------------------------------------------------------------
// Command line.

function parseArguments(argv) {
  const options = { mode: null, slices: [], workDir: null, evidenceDir: DEFAULT_EVIDENCE_DIR };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check" || argument === "--write") {
      options.mode = argument.slice(2);
    } else if (argument === "--slice") {
      options.slices = (argv[++index] ?? "").split(",").filter(Boolean);
    } else if (argument === "--work-dir") {
      options.workDir = path.resolve(argv[++index] ?? "");
    } else if (argument === "--evidence-dir") {
      options.evidenceDir = path.resolve(argv[++index] ?? "");
    } else {
      throw new Error(`unknown argument ${argument}`);
    }
  }
  if (!options.mode) {
    throw new Error("use --check, or --write [--slice <folder>] [--work-dir <dir>]");
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.mode === "check") {
      const problems = checkReceipts(options.evidenceDir);
      for (const problem of problems) {
        console.error(`FAIL ${problem}`);
      }
      if (problems.length > 0) {
        throw new Error(`${problems.length} problem(s) in the hosted receipts`);
      }
      console.log(`HOSTED_RECEIPTS_CHECK_PASSED: ${SLICES.length} slices, ${SLICES.length * 2} receipts`);
    } else {
      writeReceipts(options);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
