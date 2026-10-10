import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { campaignErrors } from "./frontier-comparison-format.mjs";
import { protocolErrors } from "./frontier-comparison-protocol.mjs";
import { buildReport, serializeReport } from "./frontier-comparison-report.mjs";

// The analysis of the final comparison of the 0.5 Frontier (V05-10): from the raw data of a campaign to every number of the final report, as docs/research/frontier-comparison-protocol.json
// defines them. The protocol is read when the script runs: the percentiles, the bootstrap (level, seed, resamples, generator), the pairs, the margins, the categories, the Holm guard, the
// order of the executions, the load limit, the invalidation rules, the frozen thresholds and the sections of the report are its, and none is written here.
//
//   node scripts/frontier-comparison-analysis.mjs <campaign.json> [--out <report.json>] [--protocol <file>]
//   node scripts/frontier-comparison-analysis.mjs --check-format <campaign.json> [--protocol <file>]
//
// The campaign is in the format godot-fabric.frontier-comparison-campaign/v1 (scripts/frontier-comparison-format.mjs; docs/research/frontier-comparison-analysis.md, field by field). The
// report goes to --out, or to the standard output; it is the same bytes for the same campaign and protocol file. --check-format validates the campaign and prints what it holds.
// The implementation is in frontier-comparison-statistics.mjs (the PRNG, the quantiles, the bootstrap, Holm), -decision.mjs (the margin, the categories), -format.mjs and -validity.mjs (the
// data and the invalidation rules), -measures.mjs, -primary.mjs, -axes.mjs and -report.mjs (the sections).

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PROTOCOL = path.join(REPO_ROOT, "docs", "research", "frontier-comparison-protocol.json");

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

function readInputs(campaignFile, protocolFile) {
  const campaignBytes = readFileSync(campaignFile);
  const protocolBytes = readFileSync(protocolFile);
  return {
    campaign: JSON.parse(campaignBytes.toString("utf8")),
    protocol: JSON.parse(protocolBytes.toString("utf8")),
    campaignSha256: sha256(campaignBytes),
    protocolSha256: sha256(protocolBytes),
  };
}

// The report of the campaign in a file, against the protocol in a file (the committed one by default).
const analyzeFiles = (campaignFile, protocolFile = DEFAULT_PROTOCOL) => buildReport(readInputs(campaignFile, protocolFile));

// The problems of the protocol and of the campaign's format, none when the campaign can be analysed.
function checkFormat(campaignFile, protocolFile = DEFAULT_PROTOCOL) {
  const { campaign, protocol } = readInputs(campaignFile, protocolFile);
  const problems = protocolErrors(protocol);
  return problems.length > 0 ? problems : campaignErrors(campaign, protocol);
}

function parseArguments(argv) {
  const options = { mode: "analyze", campaign: null, out: null, protocolFile: DEFAULT_PROTOCOL };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check-format") {
      options.mode = "check-format";
    } else if (argument === "--out") {
      options.out = argv[++index] ?? "";
    } else if (argument === "--protocol") {
      options.protocolFile = path.resolve(argv[++index] ?? "");
    } else if (argument.startsWith("--") || options.campaign !== null) {
      throw new Error(`unknown argument ${argument}`);
    } else {
      options.campaign = path.resolve(argument);
    }
  }
  if (options.campaign === null) {
    throw new Error("use <campaign.json> [--out <report.json>] [--protocol <file>], or --check-format <campaign.json>");
  }
  return options;
}

function main(argv) {
  const options = parseArguments(argv);
  if (options.mode === "check-format") {
    const problems = checkFormat(options.campaign, options.protocolFile);
    for (const problem of problems) {
      console.error(`FAIL ${problem}`);
    }
    if (problems.length > 0) {
      throw new Error(`${problems.length} problem(s) in the campaign`);
    }
    const { campaign } = readInputs(options.campaign, options.protocolFile);
    console.log(`FRONTIER_COMPARISON_FORMAT_PASSED: ${campaign.executions.length} attempts, arm B ${campaign.armB.ready ? "ready" : "not ready"}`);
    return;
  }
  const report = analyzeFiles(options.campaign, options.protocolFile);
  if (options.out === null) {
    process.stdout.write(serializeReport(report));
    return;
  }
  writeFileSync(path.resolve(options.out), serializeReport(report));
  console.log(`FRONTIER_COMPARISON_ANALYSIS_WRITTEN: ${options.out}, status ${report.status}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
