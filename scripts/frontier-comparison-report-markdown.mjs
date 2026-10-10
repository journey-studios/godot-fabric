import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REPORT_FORMAT } from "./frontier-comparison-report.mjs";

// The final report of the comparison (V05-10, criterion `relatorio`) as the Markdown document that a person reads: a pure and deterministic rendering of the JSON of
// scripts/frontier-comparison-report.mjs under the protocol it was made with. It computes no statistic, rounds no verdict and decides nothing: it formats what the JSON holds. From the protocol it
// takes, and does not copy, the ids and the order of the sections (`report.sections`) and the words of the partial report rule (`decisionRule.partialReport`). The rules:
//  - numbers: at most three decimals, no trailing zeros, integers as integers, no locale; a non-zero number that three decimals would erase shows three significant digits in plain notation (0.00009999
//    reads 0.0001, never 0 and never 1e-4); the units are the JSON's, next to the number or in the column;
//  - verdicts, categories and results are the JSON's words; the texts of `decision`, `limitations` and `cost-of-change` enter as they are (a quotation) and a `|` inside a table is escaped;
//  - a field the renderer does not know goes, in compact JSON, to an "Other fields" block at the end of its section (the example of the evidence record has none). The per-run values (`perRun`), the
//    oriented intervals and the position of a slot in the order are left to the JSON on purpose.
// The command line is `node scripts/frontier-comparison-report-markdown.mjs <report.json> [--out <file.md>] [--protocol <file>]`; it hashes the protocol file's bytes, and the renderer refuses a report
// whose `provenance.protocol.sha256` is another.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PROTOCOL = path.join(REPO_ROOT, "docs", "research", "frontier-comparison-protocol.json");

// What the renderer says of a status in its own words; the words of the partial report rule are the protocol's (see partialRuleText).
const STATUS_WORDS = {
  complete: "Every arm has the minimum number of accepted executions of the presented lane and the campaign did not stop: the statistics below are the protocol's.",
  incomplete: "An arm has fewer accepted executions of the presented lane than the protocol requires: no statistic is produced.",
  stopped: "The campaign stopped: no statistic is produced.",
};

// A non-zero number that three decimals would erase: three significant digits, written out in plain notation (toPrecision would go exponential below 1e-6).
function smallNumber(value) {
  const [mantissa, exponent] = value.toExponential(2).split("e");
  const plain = `0.${"0".repeat(-Number.parseInt(exponent, 10) - 1)}${mantissa.replace(/[-.]/g, "")}`.replace(/0+$/, "");
  return value < 0 ? `-${plain}` : plain;
}

function formatNumber(value) {
  if (!Number.isFinite(value) || Number.isInteger(value)) {
    return String(value);
  }
  const rounded = Number(value.toFixed(3));
  return rounded === 0 ? smallNumber(value) : String(rounded);
}

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function show(value) {
  if (value === undefined) {
    return "";
  }
  if (typeof value === "number") {
    return formatNumber(value);
  }
  return value !== null && typeof value === "object" ? JSON.stringify(value) : String(value);
}

const inline = (value) => show(value).replace(/\r?\n/g, "<br>");
const cell = (value) => inline(value).replaceAll("|", "\\|");
const code = (value) => `\`${inline(value)}\``;
const withUnit = (value, unit) => (unit === undefined || unit === null ? show(value) : `${show(value)} ${unit}`);
const interval = ([low, high]) => `[${formatNumber(low)}, ${formatNumber(high)}]`;
const row = (cells) => `| ${cells.map(cell).join(" | ")} |`;
const table = (header, rows) => [row(header), row(header.map(() => "---")), ...rows.map(row)].join("\n");
const bullets = (items) => items.map((item) => `- ${item}`).join("\n");
const quote = (text) =>
  show(text)
    .split(/\r?\n/)
    .map((line) => (line === "" ? ">" : `> ${line}`))
    .join("\n");
const textBlock = (text) => (text === null ? "_No text was recorded for this section._" : quote(text));
const joinCells = (entries) => entries.map(([key, value]) => `${key} ${show(value)}`).join(", ");

// A reason {rule, clause?, ...values} of a stop, of the status or of a rejected attempt: the rule, the clause and the values that decided it, as the JSON has them.
function reasonText({ rule, clause, ...values }) {
  const head = clause === undefined ? show(rule) : `${show(rule)} / ${show(clause)}`;
  const rest = Object.entries(values);
  return rest.length === 0 ? head : `${head} (${joinCells(rest)})`;
}

const entryLines = (object, depth) =>
  Object.entries(object).flatMap(([key, value]) =>
    isRecord(value) ? [`${"  ".repeat(depth)}- ${key}:`, ...entryLines(value, depth + 1)] : [`${"  ".repeat(depth)}- ${key}: ${inline(value)}`],
  );

// The fields of the JSON that a section does not know, kept in compact JSON by their path so that nothing is lost silently.
function tracker(id) {
  const found = {};
  return {
    check(where, value, allowed) {
      for (const key of isRecord(value) ? Object.keys(value) : []) {
        if (!allowed.includes(key)) {
          found[`${id}${where}.${key}`] = value[key];
        }
      }
    },
    blocks() {
      if (Object.keys(found).length === 0) {
        return [];
      }
      const json = JSON.stringify(found);
      const fence = "`".repeat(Math.max(3, ...(json.match(/`+/g) ?? []).map((run) => run.length + 1)));
      return ["**Other fields** (in the report JSON, not formatted above):", `${fence}json\n${json}\n${fence}`];
    },
  };
}

const ARM_KEYS = ["executions", "median", "iqr", "perRun"];

// The rows [...prefix, arm, executions, median, iqr] of an `arms` object.
const armRows = (extras, where, arms, prefix) =>
  Object.entries(arms).map(([arm, summary]) => {
    extras.check(`${where}.${arm}`, summary, ARM_KEYS);
    return [...prefix, arm, summary.executions, summary.median, summary.iqr];
  });

function frozenList(frozen, extras) {
  return frozen
    .flatMap((entry, index) => {
      extras.check(`.protocol.frozen[${index}]`, entry, ["id", "frozenValue", "frozenAt"]);
      const head = `- ${code(entry.id)}, frozen at ${inline(entry.frozenAt)}`;
      return isRecord(entry.frozenValue) ? [`${head}:`, ...entryLines(entry.frozenValue, 1)] : [`${head}: ${inline(entry.frozenValue)}`];
    })
    .join("\n");
}

function registrationBlocks(registered, instrument, extras) {
  const armRowsOf = Object.entries(registered.arms).map(([arm, hashes]) => {
    extras.check(`.registered.arms.${arm}`, hashes, ["binarySha256", "packageSha256", "scriptSha256"]);
    return [arm, code(hashes.binarySha256), code(hashes.packageSha256), code(hashes.scriptSha256)];
  });
  return [
    "### Registration",
    bullets([`Seed: ${show(registered.seed)}`, `Replay golden hash: ${code(registered.replayGoldenHash)}`, `Soak final hash: ${code(registered.soakFinalHash)}`, `Instrument SHA-256: ${code(registered.instrumentSha256)}`]),
    table(["Arm", "Binary SHA-256", "Package SHA-256", "Script SHA-256"], armRowsOf),
    "### Instrument",
    bullets([
      `Self-check passed: ${show(instrument.selfCheckPassed)}; passed: ${show(instrument.passed)}`,
      `SHA-256: ${code(instrument.sha256)}; registered SHA-256: ${code(instrument.registeredSha256)}`,
      `Unchanged after the self-check: ${show(instrument.unchangedAfterSelfCheck)}`,
    ]),
  ];
}

function provenanceBody(section, extras) {
  extras.check("", section, ["protocol", "commit", "machine", "system", "display", "renderer", "adapter", "registered", "instrument", "vsync", "load", "deviations"]);
  const { protocol, registered, instrument, load } = section;
  extras.check(".protocol", protocol, ["id", "item", "sha256", "amendments", "frozen"]);
  extras.check(".registered", registered, ["seed", "replayGoldenHash", "soakFinalHash", "instrumentSha256", "arms"]);
  extras.check(".instrument", instrument, ["selfCheckPassed", "sha256", "registeredSha256", "unchangedAfterSelfCheck", "passed"]);
  extras.check(".load", load, ["command", "limit1MinuteAverage", "highestBefore", "highestAfter"]);
  const vsyncRows = section.vsync.map((reading, index) => {
    extras.check(`.vsync[${index}]`, reading, ["lane", "mode", "refreshHz", "executions"]);
    return [reading.lane, reading.mode, reading.refreshHz, reading.executions];
  });
  return [
    table(["Field", "Value"], ["commit", "machine", "system", "display", "renderer", "adapter"].map((key) => [`${key[0].toUpperCase()}${key.slice(1)}`, section[key]])),
    "### Protocol",
    bullets([`Protocol: ${code(protocol.id)}, item ${inline(protocol.item)}`, `SHA-256: ${code(protocol.sha256)}`, `Amendments: ${show(protocol.amendments)}`]),
    "**Frozen values**",
    frozenList(protocol.frozen, extras),
    ...registrationBlocks(registered, instrument, extras),
    "### Readings",
    "**Vsync**",
    table(["Lane", "Mode", "Refresh (Hz)", "Executions"], vsyncRows),
    "**Load**",
    bullets([`Command: ${code(load.command)}`, `Limit of the 1-minute average: ${show(load.limit1MinuteAverage)}`, `Highest before an attempt: ${show(load.highestBefore)}; after: ${show(load.highestAfter)}`]),
    "### Deviations from the protocol",
    section.deviations.length === 0 ? "None." : bullets(section.deviations.map(inline)),
  ];
}

const SLOT_KEYS = ["lane", "slot", "block", "position", "arm", "state", "accepted", "rejected", "attempts"];
const ATTEMPT_KEYS = ["attempt", "reported", "load", "vsync", "status", "reasons"];

function totalsTable(totals, extras, lane) {
  const rows = Object.entries(totals).map(([arm, count]) => {
    extras.check(`.totals.${lane}.${arm}`, count, ["planned", "accepted", "rejected", "open", "missing", "exhausted"]);
    return [arm, count.planned, count.accepted, count.rejected, count.open, count.missing, count.exhausted];
  });
  return table(["Arm", "Planned", "Accepted", "Rejected", "Open", "Missing", "Exhausted"], rows);
}

function balanceBlocks(balance, extras, lane) {
  extras.check(`.balance.${lane}`, balance, ["planned", "accepted", "balanced"]);
  const arms = Object.keys(balance.planned[0] ?? {});
  const rows = balance.planned.map((planned, position) => [position, ...arms.flatMap((arm) => [planned[arm], balance.accepted[position][arm]])]);
  return [`Balance by position in the block (positions counted from 0). Balanced: ${show(balance.balanced)}.`, table(["Position", ...arms.flatMap((arm) => [`${arm} planned`, `${arm} accepted`])], rows)];
}

function rejectedRows(slots, extras) {
  return slots.flatMap((slot, index) => {
    extras.check(`.slots[${index}]`, slot, SLOT_KEYS);
    return slot.attempts.flatMap((attempt, position) => {
      const where = `.slots[${index}].attempts[${position}]`;
      extras.check(where, attempt, ATTEMPT_KEYS);
      extras.check(`${where}.load`, attempt.load, ["before", "after"]);
      extras.check(`${where}.vsync`, attempt.vsync, ["mode", "refreshHz"]);
      if (attempt.status !== "rejected") {
        return [];
      }
      const report = attempt.reported ? "written" : "none (reported: false)";
      const vsync = attempt.vsync === undefined ? "not read" : `${attempt.vsync.mode} at ${show(attempt.vsync.refreshHz)} Hz`;
      return [[slot.lane, slot.slot, slot.arm, slot.state, slot.accepted ?? "none", attempt.attempt, report, vsync, attempt.load.before, attempt.load.after, attempt.reasons.map(reasonText).join("; ")]];
    });
  });
}

function validityBody(section, extras) {
  extras.check("", section, ["maxAttempts", "minimumPerArm", "totals", "balance", "stopped", "slots"]);
  const laneBlocks = Object.entries(section.totals).flatMap(([lane, totals]) => [`#### Lane: ${lane}`, totalsTable(totals, extras, lane), ...balanceBlocks(section.balance[lane], extras, lane)]);
  const rejected = rejectedRows(section.slots, extras);
  const header = ["Lane", "Slot", "Arm", "Slot state", "Accepted attempt", "Attempt", "Report", "Vsync", "Load before", "Load after", "Reasons"];
  return [
    bullets([`Attempts per slot: at most ${show(section.maxAttempts)}`, `Accepted executions required per arm: ${show(section.minimumPerArm)}`]),
    "### Executions by lane and arm",
    ...laneBlocks,
    "### Stops",
    section.stopped.length === 0 ? "The campaign did not stop." : bullets(section.stopped.map(reasonText)),
    "### Rejected attempts",
    rejected.length === 0 ? "No attempt was rejected." : table(header, rejected),
  ];
}

const PAIR_KEYS = ["id", "hypothesis", "minuend", "subtrahend", "difference", "interval", "margin", "unadjustedCategory", "category", "downgraded", "nonInferior", "pValue", "holmStands", "budget", "skipped"];

function marginText(margin, unit, extras, where) {
  extras.check(where, margin, ["value", "relative", "floor", "medianOfReference", "formula"]);
  extras.check(`${where}.floor`, margin.floor, ["value", "unit"]);
  const floor = margin.floor === null ? "no floor" : `floor ${withUnit(margin.floor.value, margin.floor.unit)}`;
  return `Margin: ${withUnit(margin.value, unit)} = ${margin.formula}, with relative ${show(margin.relative)}, ${floor} and the median of the reference ${withUnit(margin.medianOfReference, unit)}`;
}

function budgetText(budget, unit, extras, where) {
  const armEntries = Object.entries(budget).filter(([, value]) => isRecord(value));
  extras.check(where, budget, ["threshold", "value", ...armEntries.map(([arm]) => arm)]);
  const arms = armEntries.map(([arm, result]) => `${arm} median ${withUnit(result.median, unit)}, ${show(result.result)}`);
  const frozen = typeof budget.value === "number" ? withUnit(budget.value, unit) : inline(budget.value);
  return `Budget ${code(budget.threshold)} (${frozen}): ${arms.join("; ")}`;
}

// The decision pair of a window (C minus B): the category and the flags, the margin with its formula, the budget.
function decisionLines(pair, unit, extras, where) {
  const budget = pair.budget === undefined ? [] : [budgetText(pair.budget, unit, extras, `${where}.budget`)];
  return bullets([
    `Category: ${show(pair.category)} (unadjusted: ${show(pair.unadjustedCategory)}; downgraded by the Holm guard: ${show(pair.downgraded)})`,
    `Non-inferior: ${show(pair.nonInferior)}`,
    `Holm guard stands: ${show(pair.holmStands)}; one-sided p-value ${show(pair.pValue)}`,
    marginText(pair.margin, unit, extras, `${where}.margin`),
    ...budget,
  ]);
}

function windowBlocks(entry, index, section, extras) {
  const where = `.windows[${index}]`;
  extras.check(where, entry, ["id", "label", "arms", "pairs"]);
  const { unit } = section;
  const arms = table(["Arm", "Executions", `Median (${unit})`, `IQR (${unit})`], armRows(extras, `${where}.arms`, entry.arms, []));
  const estimated = entry.pairs.filter((pair) => pair.skipped === undefined);
  const pairs = estimated.map((pair) => [pair.id, pair.hypothesis, pair.minuend, pair.subtrahend, pair.difference, interval(pair.interval)]);
  const skipped = entry.pairs.filter((pair) => pair.skipped !== undefined).map((pair) => `${code(pair.id)} (${show(pair.hypothesis)}) skipped: ${show(pair.skipped)}`);
  const decided = entry.pairs.flatMap((pair, position) => {
    extras.check(`${where}.pairs[${position}]`, pair, PAIR_KEYS);
    return pair.category === undefined ? [] : [`**${pair.id} (${show(pair.hypothesis)}), decision**`, decisionLines(pair, unit, extras, `${where}.pairs[${position}]`)];
  });
  return [
    `### ${entry.label} (${code(entry.id)})`,
    arms,
    table(["Pair", "Hypothesis", "Minuend", "Subtrahend", `Difference (${unit})`, "Interval"], pairs),
    ...(skipped.length === 0 ? [] : [bullets(skipped)]),
    ...decided,
  ];
}

function primaryBody(section, extras) {
  extras.check("", section, ["available", "outcome", "unit", "orientation", "interval", "multiplicity", "windows"]);
  const { interval: method, multiplicity } = section;
  extras.check(".interval", method, ["level", "method", "resamples", "seed", "prng"]);
  extras.check(".multiplicity", multiplicity, ["family", "method", "alphaOneSided"]);
  return [
    bullets([
      `Outcome: ${code(section.outcome)}, in ${show(section.unit)}, ${show(section.orientation)}`,
      `Interval: ${show(method.method)}, level ${show(method.level)}, ${show(method.resamples)} resamples, seed ${show(method.seed)}, PRNG ${show(method.prng)}`,
      `Multiplicity: ${show(multiplicity.method)} over ${show(multiplicity.family)}, one-sided alpha ${show(multiplicity.alphaOneSided)}`,
    ]),
    ...section.windows.flatMap((entry, index) => windowBlocks(entry, index, section, extras)),
  ];
}

const AXIS_KEYS = ["id", "label", "unit", "kind", "applicable", "reason", "readings", "arms", "difference", "interval", "orientation", "orientedInterval", "margin", "category", "nonInferior", "excludesZero", "windows", "observationsPerArm", "measures", "agree"];
const AXIS_WINDOW_KEYS = ["window", "arms", "difference", "interval", "orientation", "orientedInterval", "margin", "category", "nonInferior", "excludesZero"];
const MEASURE_KEYS = ["measure", "difference", "margin", "category", "nonInferior"];

const axisName = (axis) => `${axis.label} (${axis.id})`;

function categoryText(entry) {
  if (entry.applicable === false) {
    return `not applicable (${show(entry.reason)})`;
  }
  return entry.reason === undefined ? show(entry.category) : `${show(entry.category)} (${show(entry.reason)})`;
}

function verdictRow(axis, entry, window) {
  const range = entry.interval === undefined ? "" : interval(entry.interval);
  return [axisName(axis), window, axis.unit, entry.orientation, entry.difference, range, entry.margin?.value, categoryText(entry), entry.nonInferior, entry.excludesZero];
}

const verdictRows = (axis) => (axis.kind === "interval-per-window" ? axis.windows.map((entry) => verdictRow(axis, entry, entry.window)) : [verdictRow(axis, axis, "")]);

function valueRows(axis, index, extras) {
  const where = `.verdicts[${index}]`;
  if (axis.kind === "interval") {
    return armRows(extras, `${where}.arms`, axis.arms, [axisName(axis), "", axis.unit]);
  }
  if (axis.kind === "interval-per-window") {
    return axis.windows.flatMap((entry, position) => armRows(extras, `${where}.windows[${position}].arms`, entry.arms, [axisName(axis), entry.window, axis.unit]));
  }
  return [];
}

// What the verdicts stand on and cannot show in one row: the FPS readings, the package exports, the four measures of the cost of change.
function axisDetails(axis, index, extras) {
  const where = `.verdicts[${index}]`;
  const blocks = [];
  if (axis.readings !== undefined) {
    const rows = Object.entries(axis.readings).map(([arm, reading]) => {
      extras.check(`${where}.readings.${arm}`, reading, ["accepted", "withFps", "modes"]);
      return [arm, reading.accepted, reading.withFps, Object.entries(reading.modes).map(([mode, count]) => `${mode}: ${show(count)}`).join(", ")];
    });
    blocks.push(`**${axisName(axis)}: readings of the unlimited lane**`, table(["Arm", "Accepted", "With FPS", "Vsync modes read"], rows));
  }
  if (axis.kind === "deterministic") {
    const rows = Object.entries(axis.arms).map(([arm, exported]) => {
      extras.check(`${where}.arms.${arm}`, exported, ["exportBytes", "equal"]);
      return [arm, exported.exportBytes.map(formatNumber).join(", "), exported.equal];
    });
    blocks.push(`**${axisName(axis)}: the exports of each arm**`, table(["Arm", "Export bytes", "Equal"], rows));
  }
  if (axis.kind === "single-observation") {
    const arms = Object.keys(axis.measures[0] ?? {}).filter((key) => !MEASURE_KEYS.includes(key));
    const rows = axis.measures.map((measure, position) => {
      extras.check(`${where}.measures[${position}]`, measure, [...MEASURE_KEYS, ...arms]);
      extras.check(`${where}.measures[${position}].margin`, measure.margin, ["value", "relative", "floor", "medianOfReference"]);
      return [measure.measure, ...arms.map((arm) => measure[arm]), measure.difference, measure.margin.value, measure.category, measure.nonInferior];
    });
    blocks.push(
      `**${axisName(axis)}: one observation per arm** (observations per arm ${show(axis.observationsPerArm)}; the measures agree: ${show(axis.agree)})`,
      table(["Measure", ...arms, "Difference", "Margin", "Category", "Non-inferior"], rows),
    );
  }
  return blocks;
}

function descriptiveBlocks(descriptive, extras) {
  return descriptive.flatMap((outcome, index) => {
    const where = `.descriptive[${index}]`;
    extras.check(where, outcome, ["id", "label", "series"]);
    const armsOf = outcome.series.flatMap((series, position) => {
      extras.check(`${where}.series[${position}]`, series, ["id", "window", "unit", "arms", "pairs"]);
      return armRows(extras, `${where}.series[${position}].arms`, series.arms, [series.id, series.window ?? "", series.unit]);
    });
    const pairsOf = outcome.series.flatMap((series, position) =>
      series.pairs.map((pair, pairPosition) => {
        extras.check(`${where}.series[${position}].pairs[${pairPosition}]`, pair, ["id", "difference", "interval"]);
        return [series.id, series.window ?? "", series.unit, pair.id, pair.difference, interval(pair.interval)];
      }),
    );
    return [
      `#### ${code(outcome.id)}`,
      show(outcome.label),
      table(["Series", "Window", "Unit", "Arm", "Executions", "Median", "IQR"], armsOf),
      ...(pairsOf.length === 0 ? [] : [table(["Series", "Window", "Unit", "Pair", "Difference", "Interval"], pairsOf)]),
    ];
  });
}

function axesBody(section, extras) {
  extras.check("", section, ["available", "verdicts", "descriptive"]);
  for (const [index, axis] of section.verdicts.entries()) {
    extras.check(`.verdicts[${index}]`, axis, AXIS_KEYS);
    for (const [position, entry] of (axis.windows ?? []).entries()) {
      extras.check(`.verdicts[${index}].windows[${position}]`, entry, AXIS_WINDOW_KEYS);
    }
  }
  const verdictHeader = ["Axis", "Window", "Unit", "Orientation", "Difference", "Interval", "Margin", "Category", "Non-inferior", "Excludes zero"];
  const values = section.verdicts.flatMap((axis, index) => valueRows(axis, index, extras));
  return [
    "### Verdicts, C against B",
    table(verdictHeader, section.verdicts.flatMap(verdictRows)),
    ...(values.length === 0 ? [] : ["### Values behind the verdicts", table(["Axis", "Window", "Unit", "Arm", "Executions", "Median", "IQR"], values)]),
    ...section.verdicts.flatMap((axis, index) => axisDetails(axis, index, extras)),
    "### Descriptive outcomes",
    ...descriptiveBlocks(section.descriptive, extras),
  ];
}

function costOfChangeBody(section, extras) {
  extras.check("", section, ["available", "observationsPerArm", "statisticalClaim", "observation", "text"]);
  const arms = Object.keys(section.observation);
  const measures = Object.keys(section.observation[arms[0]] ?? {});
  const rows = measures.map((measure) => [measure, ...arms.map((arm) => section.observation[arm][measure])]);
  const sentence = section.observationsPerArm === 1 && section.statisticalClaim === false ? "This is one observation per arm: it describes the change and makes no statistical claim (`statisticalClaim: false`)." : "";
  return [
    `Observations per arm: ${show(section.observationsPerArm)}. Statistical claim: ${show(section.statisticalClaim)}. ${sentence}`.trim(),
    table(["Measure", ...arms], rows),
    textBlock(section.text),
  ];
}

function budgetsBody(section, extras) {
  extras.check("", section, ["available", "windows"]);
  const arms = [...new Set(section.windows.flatMap((entry) => Object.keys(entry.arms)))];
  const rows = section.windows.map((entry, index) => {
    extras.check(`.windows[${index}]`, entry, ["id", "threshold", "unit", "budget", "frozenAt", "arms"]);
    const budget = typeof entry.budget === "number" ? withUnit(entry.budget, entry.unit) : show(entry.budget);
    const results = arms.map((arm) => {
      const result = entry.arms[arm];
      extras.check(`.windows[${index}].arms.${arm}`, result, ["median", "result"]);
      return result === undefined ? "" : `${withUnit(result.median, entry.unit)}, ${show(result.result)}`;
    });
    return [entry.id, entry.threshold, budget, entry.frozenAt, ...results];
  });
  return [table(["Window", "Threshold", "Frozen budget", "Frozen at", ...arms.map((arm) => `${arm}: median of the per-run p95, result`)], rows)];
}

function decisionBody(section, extras) {
  extras.check("", section, ["text", "partialReport"]);
  extras.check(".partialReport", section.partialReport, ["applies", "reason"]);
  const { applies, reason } = section.partialReport;
  const why = reason === null ? "" : ` Reason: ${show(reason)}`;
  return [textBlock(section.text), `Partial report rule applies: ${show(applies)}.${why}`];
}

const limitationsBody = (section, extras) => {
  extras.check("", section, ["text"]);
  return [textBlock(section.text)];
};

function reproductionBody(section, extras) {
  extras.check("", section, ["rawData", "campaignSha256", "protocolSha256", "seed", "resamples", "commands"]);
  const commands = section.commands.join("\n");
  return [
    bullets([
      `Raw data: ${inline(section.rawData)}`,
      `Campaign SHA-256: ${code(section.campaignSha256)}`,
      `Protocol SHA-256: ${code(section.protocolSha256)}`,
      `Seed: ${show(section.seed)}`,
      `Resamples: ${show(section.resamples)}`,
    ]),
    "**Commands**",
    `\`\`\`sh\n${commands}\n\`\`\``,
  ];
}

const SECTIONS = {
  provenance: { title: "Provenance", body: provenanceBody },
  validity: { title: "Validity", body: validityBody },
  primary: { title: "Primary outcome", body: primaryBody },
  axes: { title: "Axes", body: axesBody },
  "cost-of-change": { title: "Cost of change", body: costOfChangeBody },
  budgets: { title: "Budgets", body: budgetsBody },
  decision: { title: "Decision", body: decisionBody },
  limitations: { title: "Limitations", body: limitationsBody },
  reproduction: { title: "Reproduction", body: reproductionBody },
};

// A section with `available: false` is one line with its reason.
function sectionBlocks(id, section) {
  const extras = tracker(id);
  const { title, body } = SECTIONS[id];
  if (section.available === false) {
    extras.check("", section, ["available", "reason"]);
    return [`## ${title}`, `Not available: ${show(section.reason)}.`, ...extras.blocks()];
  }
  return [`## ${title}`, ...body(section, extras), ...extras.blocks()];
}

// The partial report rule in the protocol's own words (`decisionRule.partialReport`: `when` and `report`), quoted as they are.
function partialRuleText(protocol) {
  const { when, report } = protocol.decisionRule?.partialReport ?? {};
  if (typeof when !== "string" || typeof report !== "string") {
    throw new Error("the protocol's decisionRule.partialReport has no `when` and `report` text to quote");
  }
  return `Partial report rule of the protocol (decisionRule.partialReport): when ${when}, the report is ${report}.`;
}

function statusBlocks(report, protocol) {
  const extras = tracker("report");
  extras.check("", report, ["format", "status", "why", "sections"]);
  const words = report.status === "partial" ? partialRuleText(protocol) : (STATUS_WORDS[report.status] ?? "");
  const why = report.why.length === 0 ? [] : ["Why:", bullets(report.why.map(reasonText))];
  return [
    "# Frontier comparison: final report",
    `Status: ${code(report.status)}. ${words}`.trim(),
    ...why,
    `Generated from a report in the format ${code(report.format)} by \`scripts/frontier-comparison-report-markdown.mjs\`: it formats the numbers of the report and computes none (at most three decimals, trailing zeros dropped). The per-run values and the oriented intervals stay in the report JSON.`,
    ...extras.blocks(),
  ];
}

// The ids of the protocol's `report.sections`, in its order, once the report is known to be one of this format made under this protocol: the SHA-256 of the protocol's bytes (hashed by the caller,
// which read them) is the one the report's provenance records, and the sections of the report are the protocol's, in its order, each one with a rendering here.
function sectionIdsOf(report, given) {
  const { protocol, protocolSha256 } = given ?? {};
  if (!isRecord(report) || report.format !== REPORT_FORMAT) {
    throw new Error(`not a frontier comparison report: its format is ${JSON.stringify(report?.format)}, expected ${REPORT_FORMAT}`);
  }
  if (!Array.isArray(protocol?.report?.sections) || typeof protocolSha256 !== "string") {
    throw new Error("render a report with the protocol it was made with: {protocol, protocolSha256}, the protocol having report.sections");
  }
  const ids = protocol.report.sections.map((section) => section.id);
  if (!isRecord(report.sections)) {
    throw new Error(`the report has no sections, the protocol's are (${ids})`);
  }
  const recorded = report.sections.provenance?.protocol?.sha256;
  if (recorded !== protocolSha256) {
    throw new Error(`the report was made under another protocol: its provenance records the SHA-256 ${show(recorded)}, the protocol given hashes to ${protocolSha256}`);
  }
  if (Object.keys(report.sections).join() !== ids.join()) {
    throw new Error(`the report's sections (${Object.keys(report.sections)}) are not the protocol's (${ids}), in that order`);
  }
  const unknown = ids.filter((id) => !Object.hasOwn(SECTIONS, id));
  if (unknown.length > 0) {
    throw new Error(`the protocol's report sections (${unknown}) have no rendering here`);
  }
  return ids;
}

// The Markdown of a report under the protocol it was made with: the status, then one section per section of the protocol's `report.sections`, in its order. Pure: `protocolSha256` is the SHA-256
// of the protocol bytes that the caller read.
export function renderReport(report, given) {
  const ids = sectionIdsOf(report, given);
  const blocks = [...statusBlocks(report, given.protocol), ...ids.flatMap((id) => sectionBlocks(id, report.sections[id]))];
  return `${blocks.join("\n\n")}\n`;
}

function parseArguments(argv) {
  const options = { report: null, out: null, protocolFile: DEFAULT_PROTOCOL };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--out" || argument === "--protocol") {
      index += 1;
      if (argv[index] === undefined) {
        throw new Error(`${argument} needs a file`);
      }
      options[argument === "--out" ? "out" : "protocolFile"] = path.resolve(argv[index]);
    } else if (argument.startsWith("--") || options.report !== null) {
      throw new Error(`unknown argument ${argument}`);
    } else {
      options.report = path.resolve(argument);
    }
  }
  if (options.report === null) {
    throw new Error("use <report.json> [--out <file.md>] [--protocol <file>]");
  }
  return options;
}

function readJson(file) {
  try {
    const bytes = readFileSync(file);
    return { bytes, value: JSON.parse(bytes.toString("utf8")) };
  } catch (error) {
    throw new Error(`${file} cannot be read${error instanceof SyntaxError ? " as JSON" : ""}: ${error.message}`);
  }
}

function main(argv) {
  const options = parseArguments(argv);
  const { value: report } = readJson(options.report);
  const { bytes, value: protocol } = readJson(options.protocolFile);
  const markdown = renderReport(report, { protocol, protocolSha256: createHash("sha256").update(bytes).digest("hex") });
  if (options.out === null) {
    process.stdout.write(markdown);
    return;
  }
  writeFileSync(options.out, markdown);
  console.log(`FRONTIER_COMPARISON_REPORT_MARKDOWN_WRITTEN: ${options.out}, status ${report.status}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
