import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {REPORT_FORMAT} from "../scripts/frontier-comparison-report.mjs";
import {renderReport} from "../scripts/frontier-comparison-report-markdown.mjs";
import {harness, overLoaded, readProtocol, redoSlot, withResamples} from "./frontier-comparison-synthetic.mjs";

// The final report of the comparison (V05-10) as a Markdown document: scripts/frontier-comparison-report-markdown.mjs renders the JSON of scripts/frontier-comparison-report.mjs and computes nothing.
// This test renders SYNTHETIC reports (tests/frontier-comparison-synthetic.mjs), whose numbers were made up: it proves the document is the same bytes for the same report, that it carries every
// status, every table and every text of the JSON, that it refuses what is not a report of the protocol, and that no number in it is one the JSON does not hold. No number here is a result of any arm.
const root = fileURLToPath(new URL("../", import.meta.url));
const EVIDENCE = "docs/evidence/frontier-comparison-analysis";
const SCRIPT = path.join(root, "scripts/frontier-comparison-report-markdown.mjs");
const SYNTHETIC = path.join(root, "tests/frontier-comparison-synthetic.mjs");
const ANALYSIS = path.join(root, "scripts/frontier-comparison-analysis.mjs");
const EXAMPLE_JSON = path.join(root, EVIDENCE, "example-analysis.json");
const EXAMPLE_MARKDOWN = path.join(root, EVIDENCE, "example-analysis.md");
const exampleText = fs.readFileSync(EXAMPLE_JSON, "utf8");
const example = () => JSON.parse(exampleText);
// The protocol file as the command reads it ({protocol, protocolSha256} of its bytes): the example report was made under it. The synthetic reports below are made under a copy with 200 resamples.
const onDisk = readProtocol();
const {protocol, protocolSha256} = withResamples(onDisk.protocol, 200);
const synthetic = {protocol, protocolSha256};
const {build, analyze} = harness(protocol, protocolSha256);
const renderExample = report => renderReport(report, onDisk);
const renderSynthetic = report => renderReport(report, synthetic);
const TEXT = {decision: "Decision words.", limitations: "Limitation words.", costOfChange: "Cost-of-change words."};
const HEADINGS = ["Provenance", "Validity", "Primary outcome", "Axes", "Cost of change", "Budgets", "Decision", "Limitations", "Reproduction"];

const run = (args, script = SCRIPT) => spawnSync(process.execPath, [script, ...args], {encoding: "utf8", maxBuffer: 1 << 28});
const withDirectory = body => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "frontier-comparison-report-markdown-"));
  try {
    return body(directory);
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
};
const sectionOf = (markdown, title) => markdown.split(/\n(?=## )/).find(part => part.startsWith(`## ${title}\n`));

// The rule of the numbers, written here a second way: at most three decimals, no trailing zeros, integers as integers, and a non-zero number that three decimals would erase shows three
// significant digits in plain notation.
function rule(value) {
  if (Number.isInteger(value)) {
    return String(value);
  }
  const fixed = value.toFixed(3).replace(/\.?0+$/, "");
  if (!/^-?0$/.test(fixed)) {
    return fixed;
  }
  return value.toFixed(2 - Math.floor(Math.log10(Math.abs(value)))).replace(/0+$/, "");
}
const tokens = text => text.match(/\d+(?:\.\d+)?/g) ?? [];
function walk(value, found) {
  if (typeof value === "number") {
    found.numbers.push(value);
  } else if (typeof value === "string") {
    found.strings.push(value);
  } else if (value !== null && typeof value === "object") {
    for (const inner of Object.values(value)) {
      walk(inner, found);
    }
  }
  return found;
}
// Every number of the document (a run of digits with an optional decimal part) is one of the JSON's, formatted by the rule, or a digit of a string of the JSON, or of the renderer's own words
// ("1-minute", "SHA-256", the position counted from 0).
function assertNoInventedNumbers(report, markdown) {
  const {numbers, strings} = walk(report, {numbers: [], strings: []});
  const allowed = new Set(["0", "1", "256", ...numbers.flatMap(number => tokens(rule(number))), ...strings.flatMap(tokens)]);
  const invented = [...new Set(tokens(markdown))].filter(token => !allowed.has(token));
  assert.deepEqual(invented, [], "every number of the document is in the JSON");
}
// Every table of the document keeps the number of cells of its header, whatever a text holds.
function assertRectangularTables(markdown) {
  let group = [];
  const cells = line => (line.match(/(?<!\\)\|/g) ?? []).length;
  for (const line of [...markdown.split("\n"), ""]) {
    if (line.startsWith("|")) {
      group.push(line);
    } else {
      assert.equal(new Set(group.map(cells)).size <= 1, true, `table with a ragged row:\n${group.join("\n")}`);
      group = [];
    }
  }
}
// Every fenced block of the document is closed by its own fence (a line of backticks at least as long as the opening one) and the last line of the document is not inside one.
function assertFencesHold(markdown) {
  let open = null;
  for (const line of markdown.split("\n")) {
    const opening = /^(`{3,})\w*$/.exec(line);
    if (open === null && opening !== null) {
      open = opening[1].length;
    } else if (open !== null && /^`+$/.test(line) && line.length >= open) {
      open = null;
    }
  }
  assert.equal(open, null, "every fenced block is closed");
}
const assertSound = (report, markdown) => {
  assertNoInventedNumbers(report, markdown);
  assertRectangularTables(markdown);
  assertFencesHold(markdown);
  assert.doesNotMatch(markdown, /other fields/i);
};

// ---- the example ----
test("the example renders byte for byte as the command line prints it and as the file of the evidence record, and its sections are the protocol's, in order", () => {
  const markdown = renderExample(example());
  const printed = run([EXAMPLE_JSON]);
  assert.deepEqual([printed.status, printed.stderr], [0, ""]);
  assert.equal(printed.stdout, markdown, "the standard output is the rendering of the library");
  assert.equal(fs.readFileSync(EXAMPLE_MARKDOWN, "utf8"), markdown, "docs/evidence/frontier-comparison-analysis/example-analysis.md is the output of the command on example-analysis.json");
  withDirectory(directory => {
    const file = path.join(directory, "example-analysis.md");
    const written = run([EXAMPLE_JSON, "--out", file]);
    assert.equal(written.status, 0, written.stderr);
    assert.match(written.stdout, /^FRONTIER_COMPARISON_REPORT_MARKDOWN_WRITTEN: .*example-analysis\.md, status complete\n$/);
    assert.equal(fs.readFileSync(file, "utf8"), markdown);
  });
  assert.deepEqual(Object.keys(example().sections), onDisk.protocol.report.sections.map(({id}) => id), "the example holds the sections of the protocol, in its order");
  assert.deepEqual(markdown.split("\n").filter(line => line.startsWith("## ")), HEADINGS.map(title => `## ${title}`));
  assert.match(markdown, /^# Frontier comparison: final report\n\nStatus: `complete`\./);
  assert.equal(markdown.endsWith("\n") && !markdown.endsWith("\n\n"), true);
  assertSound(example(), markdown);
});

test("the same report gives the same bytes, and rendering changes nothing in it", () => {
  const report = example();
  const before = structuredClone(report);
  assert.equal(renderExample(report), renderExample(report));
  assert.equal(renderExample(structuredClone(report)), renderExample(report));
  assert.deepEqual(report, before);
});

test("the example shows what each section holds: the provenance, the validity of the redone slot, the verdicts of the four windows, the axes, the budgets and the words of the campaign", () => {
  const markdown = renderExample(example());
  const provenance = sectionOf(markdown, "Provenance");
  assert.match(provenance, /\| Commit \| synthetic-commit \|/);
  assert.match(provenance, /- `budget-p95-ai-phase`, frozen at 2026-10-10: 15\.5\n/);
  assert.match(provenance, /- `cpu-time-instrument`, frozen at 2026-10-10:\n {2}- quantity: /);
  assert.match(provenance, /\| presented \| ENABLED \| 120 \| 37 \|/);
  assert.match(provenance, /Deviations from the protocol\n\nNone\./);
  const validity = sectionOf(markdown, "Validity");
  assert.match(validity, /\| C \| 12 \| 12 \| 1 \| 0 \| 0 \| 0 \|/);
  assert.match(validity, /\| presented \| 4 \| C \| accepted \| 2 \| 1 \| written \| ENABLED at 120 Hz \| 5\.3 \| 0\.53 \| load \/ before \(value 5\.3, limit 2\) \|/);
  const primary = sectionOf(markdown, "Primary outcome");
  assert.match(primary, /Interval: percentile bootstrap of the difference of the medians, level 0\.95, 10000 resamples, seed 20261009, PRNG mulberry32/);
  assert.deepEqual([...primary.matchAll(/- Category: (\w+) \(unadjusted: (\w+); downgraded by the Holm guard: (\w+)\)/g)].map(match => match.slice(1)), [
    ["gain", "gain", "false"],
    ["neutral", "neutral", "false"],
    ["cost", "cost", "false"],
    ["inconclusive", "inconclusive", "false"]
  ]);
  assert.match(primary, /- Margin: 0\.8 ms = max\(relative x the median of B, floor\), with relative 0\.1, floor 0\.5 ms and the median of the reference 7\.999 ms/);
  assert.match(primary, /- Budget `budget-p95-ai-phase` \(15\.5 ms\): B median 7\.999 ms, met; C median 5\.994 ms, met/);
  assert.match(primary, /\| C-B \| H3 \| C \| B \| -2\.006 \| \[-2\.043, -1\.962\] \|/);
  const axes = sectionOf(markdown, "Axes");
  assert.match(axes, /\| Size of the exported Release package \(package-size\) \|  \| bytes \| lowerIsBetter \| 14000000 \| \[14000000, 14000000\] \| 4100000 \| cost \| false \|/);
  assert.match(axes, /\| ai-phase \| frames per second \| higherIsBetter \| 398\.33 \| \[392\.885, 409\.18\] \| 99\.807 \| gain \| true \| true \|/);
  assert.match(axes, /\| lines \| 120 \| 100 \| -20 \| 12 \| gain \| true \|/);
  assert.match(sectionOf(markdown, "Cost of change"), /one observation per arm: it describes the change and makes no statistical claim \(`statisticalClaim: false`\)\.\n\n\| Measure \| B \| C \|/);
  assert.match(sectionOf(markdown, "Budgets"), /\| ai-phase \| budget-p95-ai-phase \| 15\.5 ms \| 2026-10-10 \| 5\.003 ms, met \| 7\.999 ms, met \| 5\.994 ms, met \|/);
  assert.match(sectionOf(markdown, "Budgets"), /\| stress \| budget-p95-stress \| N\/A: V05-06 .*alone \| 2026-10-10 \| 5\.005 ms, n\/a \| 8\.572 ms, n\/a \| 7\.75 ms, n\/a \|/);
  assert.match(sectionOf(markdown, "Decision"), /^## Decision\n\n> SYNTHETIC EXAMPLE: no decision was made\./);
  assert.match(sectionOf(markdown, "Limitations"), /^## Limitations\n\n> SYNTHETIC EXAMPLE: nothing was measured/);
  assert.match(sectionOf(markdown, "Reproduction"), /```sh\nnode scripts\/frontier-comparison-analysis\.mjs <campaign\.json> --out <report\.json>\n```\n$/);
});

// ---- the statuses ----
test("a partial report compares A and C, claims no gain and says why the sections that need B are not available", () => {
  const report = analyze(build({armBReady: false, text: TEXT}));
  assert.equal(report.status, "partial");
  const markdown = renderSynthetic(report);
  const {when, report: statement} = protocol.decisionRule.partialReport;
  assert.equal(statement, "a partial comparison of A against C: H1 only, no category for H3 and no gain claimed");
  assert.match(markdown, new RegExp(`^Status: \`partial\`\\. Partial report rule of the protocol \\(decisionRule\\.partialReport\\): when ${when}, the report is ${statement}\\.$`, "m"), "the words of the rule are the protocol's, as they are");
  const reworded = structuredClone(protocol);
  reworded.decisionRule.partialReport.report = "another sentence of the protocol";
  const other = renderReport(report, {protocol: reworded, protocolSha256});
  assert.match(other, /, the report is another sentence of the protocol\.$/m, "a reworded protocol gives a reworded document: the sentence is not copied here");
  assert.doesNotMatch(other, /a partial comparison of A against C/);
  const unworded = structuredClone(protocol);
  delete unworded.decisionRule.partialReport.report;
  assert.throws(() => renderReport(report, {protocol: unworded, protocolSha256}), /decisionRule\.partialReport has no `when` and `report` text/);
  const primary = sectionOf(markdown, "Primary outcome");
  assert.doesNotMatch(primary, /Category:|decision\*\*/, "no category for H3 in the primary section");
  assert.equal(primary.match(/skipped: reference-arm-not-ready/g).length, 8, "B-A and C-B are skipped in each of the four windows");
  assert.match(primary, /\| C-A \| H1 \| C \| A \| /);
  assert.equal(sectionOf(markdown, "Axes").match(/not applicable \(reference-arm-not-ready\)/g).length, 6);
  assert.match(sectionOf(markdown, "Cost of change"), /^## Cost of change\n\nNot available: reference-arm-not-ready\.\n/);
  assert.match(sectionOf(markdown, "Budgets"), /\| Window \| Threshold \| Frozen budget \| Frozen at \| A: [^|]+ \| C: [^|]+ \|\n/);
  assert.match(sectionOf(markdown, "Decision"), /> Decision words\.\n\nPartial report rule applies: true\. Reason: synthetic: arm B did not pass the context matrix in its time-box/);
  assert.match(sectionOf(markdown, "Validity"), /\| B \| 0 \| 0 \| 0 \| 0 \| 0 \| 0 \|/);
  assertSound(report, markdown);
});

test("an incomplete report says which arm is short and leaves the statistical sections as one line with the reason", () => {
  const campaign = build({text: TEXT});
  let dropped = 0;
  campaign.executions = campaign.executions.filter(execution => !(execution.lane === "presented" && execution.arm === "C" && dropped++ < 3));
  const report = analyze(campaign);
  assert.equal(report.status, "incomplete");
  const markdown = renderSynthetic(report);
  assert.match(markdown, /^Status: `incomplete`\. An arm has fewer accepted executions of the presented lane than the protocol requires: no statistic is produced\.\n\nWhy:\n\n- minimum-per-arm \(arm C, accepted 9, required 10\)\n/m);
  for (const title of ["Primary outcome", "Axes", "Cost of change", "Budgets"]) {
    assert.equal(sectionOf(markdown, title), `## ${title}\n\nNot available: incomplete.\n`);
  }
  assert.match(sectionOf(markdown, "Validity"), /\| C \| 12 \| 9 \| 0 \| 0 \| 3 \| 0 \|/);
  assert.match(sectionOf(markdown, "Decision"), /Partial report rule applies: false\./);
  assertSound(report, markdown);
});

test("a stopped campaign lists why it stopped and every attempt of the slot that used its attempts up", () => {
  const report = analyze(redoSlot(build({text: TEXT}), "presented", 4, [overLoaded, overLoaded, overLoaded]));
  assert.equal(report.status, "stopped");
  const markdown = renderSynthetic(report);
  assert.match(markdown, /^Status: `stopped`\. The campaign stopped: no statistic is produced\.\n\nWhy:\n\n- attempts \(lane presented, slot 4, arm C, attempts 4, limit 3\)\n/m);
  const validity = sectionOf(markdown, "Validity");
  assert.match(validity, /### Stops\n\n- attempts \(lane presented, slot 4, arm C, attempts 4, limit 3\)\n/);
  assert.equal(validity.match(/\| presented \| 4 \| C \| exhausted \| none \| \d \|/g).length, 4);
  assert.match(validity, /\| attempts \/ beyond-the-limit \(limit 3\) \|/);
  for (const title of ["Primary outcome", "Axes", "Cost of change", "Budgets"]) {
    assert.equal(sectionOf(markdown, title), `## ${title}\n\nNot available: stopped.\n`);
  }
  assertSound(report, markdown);
});

test("an attempt that wrote no report is marked in the validity of the synthetic --unreported campaign, analysed and rendered by the commands", () => {
  withDirectory(directory => {
    const campaign = path.join(directory, "campaign.json");
    const report = path.join(directory, "report.json");
    const markdownFile = path.join(directory, "report.md");
    assert.equal(run(["--unreported", campaign], SYNTHETIC).status, 0);
    assert.equal(run([campaign, "--out", report], ANALYSIS).status, 0);
    assert.equal(run([report, "--out", markdownFile]).status, 0);
    const markdown = fs.readFileSync(markdownFile, "utf8");
    const validity = sectionOf(markdown, "Validity");
    assert.match(validity, /^\| presented \| 7 \| B \| accepted \| 2 \| 1 \| none \(reported: false\) \| not read \| [\d.]+ \| [\d.]+ \| errors \/ no-report \(crashed true, timedOut false, signal SIGSEGV\) \|$/m);
    assert.equal(validity.match(/reported: false/g).length, 1, "only the attempt without a report is marked");
    assert.match(validity, /\| B \| 12 \| 12 \| 1 \| 0 \| 0 \| 0 \|/, "the slot redone after it still counts one rejected attempt");
    assertSound(JSON.parse(fs.readFileSync(report, "utf8")), markdown);
  });
});

// ---- what is refused ----
test("a JSON that is not a report of this format, or whose sections are not the protocol's in its order, is refused with the reason", () => {
  assert.throws(() => renderExample({...example(), format: "godot-fabric.frontier-comparison-campaign/v1"}), new RegExp(`not a frontier comparison report: its format is "godot-fabric.frontier-comparison-campaign/v1", expected ${REPORT_FORMAT.replaceAll(".", "\\.")}`));
  for (const notReport of [null, 7, [], {}]) {
    assert.throws(() => renderExample(notReport), /not a frontier comparison report/);
  }
  const swapped = example();
  const entries = Object.entries(swapped.sections);
  [entries[1], entries[2]] = [entries[2], entries[1]];
  swapped.sections = Object.fromEntries(entries);
  assert.throws(() => renderExample(swapped), /the report's sections \(provenance,primary,validity,.*\) are not the protocol's \(provenance,validity,primary,.*\), in that order/);
  const missing = example();
  delete missing.sections.limitations;
  assert.throws(() => renderExample(missing), /are not the protocol's/);
  const extra = example();
  extra.sections.appendix = {text: "x"};
  assert.throws(() => renderExample(extra), /are not the protocol's/);
  assert.throws(() => renderExample({format: REPORT_FORMAT, status: "complete", why: []}), /the report has no sections, the protocol's are \(provenance,validity,/);
});

test("a report is rendered only under the protocol it was made with: another hash is refused, and the ids and the order of the sections are the protocol's", () => {
  const recorded = example().sections.provenance.protocol.sha256;
  assert.equal(recorded, onDisk.protocolSha256, "the example was made under the protocol file");
  assert.throws(() => renderReport(example(), {protocol: onDisk.protocol, protocolSha256: "0".repeat(64)}), new RegExp(`made under another protocol: its provenance records the SHA-256 ${recorded}, the protocol given hashes to ${"0".repeat(64)}`));
  assert.throws(() => renderReport(example(), synthetic), /made under another protocol/, "a protocol with 200 resamples is another file");
  for (const given of [undefined, {}, {protocol: onDisk.protocol}, {protocol: {}, protocolSha256: recorded}]) {
    assert.throws(() => renderReport(example(), given), /render a report with the protocol it was made with/);
  }
  // The ids and their order are read from `report.sections` of the protocol (the digest of the real file is kept so that only the sections differ).
  const reordered = structuredClone(onDisk.protocol);
  [reordered.report.sections[1], reordered.report.sections[2]] = [reordered.report.sections[2], reordered.report.sections[1]];
  const given = {protocol: reordered, protocolSha256: recorded};
  assert.throws(() => renderReport(example(), given), /the report's sections \(provenance,validity,primary,.*\) are not the protocol's \(provenance,primary,validity,.*\), in that order/);
  const sameOrder = example();
  const entries = Object.entries(sameOrder.sections);
  [entries[1], entries[2]] = [entries[2], entries[1]];
  sameOrder.sections = Object.fromEntries(entries);
  const markdown = renderReport(sameOrder, given);
  assert.deepEqual(markdown.split("\n").filter(line => line.startsWith("## ")).slice(0, 3), ["## Provenance", "## Primary outcome", "## Validity"], "the document follows the order of the protocol");
  const fewer = structuredClone(onDisk.protocol);
  fewer.report.sections = fewer.report.sections.filter(({id}) => id !== "limitations");
  assert.throws(() => renderReport(example(), {protocol: fewer, protocolSha256: recorded}), /are not the protocol's/);
  // A section of the protocol that this renderer does not know how to render is refused, not skipped.
  const grown = structuredClone(onDisk.protocol);
  grown.report.sections.push({id: "appendix", holds: "something new"});
  const withAppendix = example();
  withAppendix.sections.appendix = {text: "x"};
  assert.throws(() => renderReport(withAppendix, {protocol: grown, protocolSha256: recorded}), /the protocol's report sections \(appendix\) have no rendering here/);
});

test("the command line refuses a file that is not a report, a file that is not JSON, a missing file and wrong arguments, and writes nothing", () => {
  withDirectory(directory => {
    const wrong = path.join(directory, "wrong.json");
    const notJson = path.join(directory, "not.json");
    const out = path.join(directory, "out.md");
    fs.writeFileSync(wrong, JSON.stringify({...example(), format: "other/v1"}));
    fs.writeFileSync(notJson, "{ not json");
    const refused = run([wrong, "--out", out]);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /^not a frontier comparison report: its format is "other\/v1", expected godot-fabric\.frontier-comparison-report\/v1\n$/);
    assert.equal(refused.stdout, "");
    assert.equal(fs.existsSync(out), false);
    assert.match(run([notJson]).stderr, /not\.json cannot be read as JSON/);
    assert.match(run([path.join(directory, "absent.json")]).stderr, /absent\.json cannot be read: ENOENT/);
    assert.match(run([]).stderr, /use <report\.json> \[--out <file\.md>\] \[--protocol <file>\]/);
    assert.match(run([EXAMPLE_JSON, "--wat"]).stderr, /unknown argument --wat/);
    assert.match(run([EXAMPLE_JSON, EXAMPLE_JSON]).stderr, /unknown argument/);
    assert.match(run([EXAMPLE_JSON, "--out"]).stderr, /--out needs a file/);
    assert.match(run([EXAMPLE_JSON, "--protocol"]).stderr, /--protocol needs a file/);
    for (const args of [[], [EXAMPLE_JSON, "--wat"], [EXAMPLE_JSON, "--out"], [EXAMPLE_JSON, "--protocol"], [wrong]]) {
      assert.equal(run(args).status, 1);
    }
  });
});

test("the command line reads the protocol file (docs/research/frontier-comparison-protocol.json by default, or --protocol), hashes its bytes and refuses a report made under another", () => {
  withDirectory(directory => {
    const copy = path.join(directory, "protocol-copy.json");
    const edited = path.join(directory, "protocol-edited.json");
    const notJson = path.join(directory, "protocol-not.json");
    fs.copyFileSync(path.join(root, "docs/research/frontier-comparison-protocol.json"), copy);
    fs.writeFileSync(edited, `${JSON.stringify(onDisk.protocol)}\n`);
    fs.writeFileSync(notJson, "{ not json");
    const expected = renderExample(example());
    assert.equal(run([EXAMPLE_JSON]).stdout, expected, "the default protocol is the committed one");
    assert.equal(run([EXAMPLE_JSON, "--protocol", copy]).stdout, expected, "a file with the same bytes is the same protocol");
    const refused = run([EXAMPLE_JSON, "--protocol", edited]);
    assert.equal(refused.status, 1);
    assert.equal(refused.stdout, "");
    assert.match(refused.stderr, new RegExp(`made under another protocol: its provenance records the SHA-256 ${onDisk.protocolSha256}, the protocol given hashes to [0-9a-f]{64}\\n$`), "the same JSON with other bytes is another protocol");
    assert.match(run([EXAMPLE_JSON, "--protocol", notJson]).stderr, /protocol-not\.json cannot be read as JSON/);
    assert.match(run([EXAMPLE_JSON, "--protocol", path.join(directory, "absent.json")]).stderr, /absent\.json cannot be read: ENOENT/);
  });
});

// ---- the text, the numbers and what is not known ----
test("a | inside a table is escaped and a text enters as it is, quoted line by line, so that it can open no heading or list of the document", () => {
  const report = example();
  report.sections.provenance.machine = "box | with a pipe\nsecond line";
  report.sections.budgets.windows[3].budget = "N/A | not a number";
  report.sections.provenance.deviations = ["first | deviation"];
  report.sections.decision.text = "Keep | the HUD\n\n# not a heading\n- not a list";
  report.sections.limitations.text = null;
  report.sections["cost-of-change"].text = "Cost | text";
  const markdown = renderExample(report);
  assert.match(markdown, /^\| Machine \| box \\\| with a pipe<br>second line \|$/m);
  assert.match(markdown, /\| stress \| budget-p95-stress \| N\/A \\\| not a number \| 2026-10-10 \|/);
  assert.match(markdown, /^- first \| deviation$/m);
  assert.match(sectionOf(markdown, "Decision"), /^## Decision\n\n> Keep \| the HUD\n>\n> # not a heading\n> - not a list\n\nPartial report rule applies: false\.\n$/);
  assert.match(sectionOf(markdown, "Limitations"), /^## Limitations\n\n_No text was recorded for this section\._\n$/);
  assert.match(sectionOf(markdown, "Cost of change"), /\n> Cost \| text\n$/);
  assert.deepEqual(markdown.split("\n").filter(line => /^#+ /.test(line)).filter(line => line.includes("not a heading")), [], "a quoted text opens no heading");
  assertSound(report, markdown);
});

test("the numbers follow one rule: at most three decimals, no trailing zeros, integers as integers, no locale, and a non-zero number that rounds to 0 shows three significant digits, never exponential", () => {
  const report = example();
  const [first] = report.sections.primary.windows;
  first.arms.A.median = 1234567.891234;
  first.arms.A.iqr = 0.30000000000000004;
  first.arms.B.median = 100;
  first.arms.B.iqr = -0.0004;
  first.arms.C.median = 12.3456;
  first.arms.C.iqr = 5e-7; // (5e-7).toPrecision(3) is "5.00e-7"
  first.pairs[0].difference = 0.00012345;
  first.pairs[0].interval = [-0.00012345, 1.2345e-8];
  first.pairs[1].difference = 0.00049999;
  first.pairs[1].interval = [0, -0.0000001]; // the interval of a difference is not checked here, only how it prints
  first.pairs[2].difference = 0;
  const markdown = renderExample(report);
  assert.match(markdown, /^\| A \| 12 \| 1234567\.891 \| 0\.3 \|$/m);
  assert.match(markdown, /^\| B \| 12 \| 100 \| -0\.0004 \|$/m);
  assert.match(markdown, /^\| C \| 12 \| 12\.346 \| 0\.0000005 \|$/m, "plain notation, not 5e-7");
  assert.match(markdown, /^\| C-A \| H1 \| C \| A \| 0\.000123 \| \[-0\.000123, 0\.0000000123\] \|$/m);
  assert.match(markdown, /^\| B-A \| H2 \| B \| A \| 0\.0005 \| \[0, -0\.0000001\] \|$/m, "just under half a thousandth keeps its digits instead of 0");
  assert.match(markdown, /^\| C-B \| H3 \| C \| B \| 0 \| /m, "zero stays 0");
  assert.doesNotMatch(markdown, /\d,\d{3}/, "no thousands separator");
  assert.doesNotMatch(markdown, /\de[-+]\d/, "no exponential notation");
  assert.equal(example().sections.primary.windows[0].pairs[2].pValue, 0.00009999000099990002);
  assert.match(markdown, /one-sided p-value 0\.0001\n/, "a probability of one in ten thousand reads 0.0001, not 0");
  assert.deepEqual([0.00009999000099990002, 0.00012345, 5e-7, -0.00012345, 1.2345e-8, 0.00049999, 0.001, 2.0004, 0].map(rule), ["0.0001", "0.000123", "0.0000005", "-0.000123", "0.0000000123", "0.0005", "0.001", "2", "0"]);
});

test("every median and interquartile range of the primary tables is the JSON's, formatted by the rule, and no number of the document is one the JSON lacks", () => {
  for (const [report, markdown] of [[example(), renderExample(example())], [analyze(build({text: TEXT})), renderSynthetic(analyze(build({text: TEXT})))]]) {
    const primary = sectionOf(markdown, "Primary outcome");
    for (const entry of report.sections.primary.windows) {
      for (const [arm, summary] of Object.entries(entry.arms)) {
        assert.equal(primary.includes(`\n| ${arm} | ${summary.executions} | ${rule(summary.median)} | ${rule(summary.iqr)} |\n`), true, `${entry.id} ${arm}`);
      }
      for (const pair of entry.pairs) {
        assert.equal(primary.includes(`| ${pair.id} | ${pair.hypothesis} | ${pair.minuend} | ${pair.subtrahend} | ${rule(pair.difference)} | [${rule(pair.interval[0])}, ${rule(pair.interval[1])}] |`), true, `${entry.id} ${pair.id}`);
      }
    }
    assertNoInventedNumbers(report, markdown);
  }
});

test("a field the renderer does not know is not dropped: it goes to an Other fields block at the end of its section, and the example has none", () => {
  assert.doesNotMatch(renderExample(example()), /other fields/i, "the example is fully covered");
  const report = example();
  report.novelty = {top: true};
  report.sections.provenance.novelty = "p";
  report.sections.validity.slots[0].attempts[0].novelty = false;
  report.sections.primary.windows[0].pairs[2].novelty = {x: 1, quoted: "a `tick` word"};
  report.sections.axes.verdicts[0].novelty = 2;
  report.sections.reproduction.novelty = "```";
  const markdown = renderExample(report);
  assert.match(markdown, /\*\*Other fields\*\* \(in the report JSON, not formatted above\):\n\n```json\n\{"report\.novelty":\{"top":true\}\}\n```\n\n## Provenance/);
  assert.match(sectionOf(markdown, "Provenance"), /```json\n\{"provenance\.novelty":"p"\}\n```\n$/);
  assert.match(sectionOf(markdown, "Validity"), /\{"validity\.slots\[0\]\.attempts\[0\]\.novelty":false\}/);
  assert.match(sectionOf(markdown, "Primary outcome"), /\{"primary\.windows\[0\]\.pairs\[2\]\.novelty":\{"x":1,"quoted":"a `tick` word"\}\}\n```\n$/);
  assert.match(sectionOf(markdown, "Axes"), /\{"axes\.verdicts\[0\]\.novelty":2\}/);
  assert.match(sectionOf(markdown, "Reproduction"), /````json\n\{"reproduction\.novelty":"```"\}\n````\n$/, "the fence is longer than any run of backticks in the JSON");
  assert.equal(markdown.match(/\*\*Other fields\*\*/g).length, 6);
  const unavailable = example();
  unavailable.sections.primary = {available: false, reason: "stopped", novelty: 1};
  assert.match(sectionOf(renderExample(unavailable), "Primary outcome"), /^## Primary outcome\n\nNot available: stopped\.\n\n\*\*Other fields\*\* .*:\n\n```json\n\{"primary\.novelty":1\}\n```\n$/);
});

test("a command with a run of backticks stays inside its fence: the fence of the document is longer than the run", () => {
  const report = example();
  report.sections.reproduction.commands = ["```", "echo ```` four", "node scripts/frontier-comparison-analysis.mjs <campaign.json> --out <report.json>"];
  const markdown = renderExample(report);
  assert.match(sectionOf(markdown, "Reproduction"), /\n`````sh\n```\necho ```` four\nnode scripts\/frontier-comparison-analysis\.mjs <campaign\.json> --out <report\.json>\n`````\n$/, "five backticks, one more than the longest run of the commands");
  assertSound(report, markdown);
  const shortRuns = example();
  shortRuns.sections.reproduction.commands = ["echo ``` three"];
  assert.match(sectionOf(renderExample(shortRuns), "Reproduction"), /\n````sh\necho ``` three\n````\n$/);
  assert.match(sectionOf(renderExample(example()), "Reproduction"), /\n```sh\nnode scripts\/frontier-comparison-analysis\.mjs <campaign\.json> --out <report\.json>\n```\n$/, "a command with no backticks keeps the plain fence of three");
});

// ---- the documents ----
test("the README of the evidence record gives the command that regenerates the example and says the Markdown is not edited by hand, and the research note has the section", () => {
  const readme = fs.readFileSync(path.join(root, EVIDENCE, "README.md"), "utf8");
  assert.match(readme, new RegExp(`node scripts/frontier-comparison-report-markdown\\.mjs ${EVIDENCE}/example-analysis\\.json --out ${EVIDENCE}/example-analysis\\.md`));
  assert.match(readme, /não se edita à mão/);
  const note = fs.readFileSync(path.join(root, "docs/research/frontier-comparison-analysis.md"), "utf8");
  assert.match(note, /^## The report as a document$/m);
  assert.match(note, /node scripts\/frontier-comparison-report-markdown\.mjs <report\.json> \[--out <file\.md>\] \[--protocol <file>\]/);
  assert.match(note, /generated this way from the `report\.json` of the real campaign and never edited by hand/);
});
