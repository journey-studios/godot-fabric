import { axesSection, costOfChangeSection } from "./frontier-comparison-axes.mjs";
import { decisionRuleOf } from "./frontier-comparison-decision.mjs";
import { campaignErrors, plannedArms, unreportedAttempts } from "./frontier-comparison-format.mjs";
import { readingValues, windowMeasures, windowSeriesOf } from "./frontier-comparison-measures.mjs";
import { budgetsSection, primarySection, primaryValues } from "./frontier-comparison-primary.mjs";
import { PRESENTED, protocolErrors, rolesOf } from "./frontier-comparison-protocol.mjs";
import { assessValidity } from "./frontier-comparison-validity.mjs";

// The final report of the comparison (V05-10, criterion `relatorio`): the sections of docs/research/frontier-comparison-protocol.json `report.sections`, in its order, as a JSON that is a pure
// function of the campaign, the protocol file and the seed. The words of `decision`, `limitations` and `cost-of-change` come from the campaign's `text`: the analysis computes numbers and
// invents no text.

export const REPORT_FORMAT = "godot-fabric.frontier-comparison-report/v1";

const COMMAND = "node scripts/frontier-comparison-analysis.mjs <campaign.json> --out <report.json>";

// Whether the statistics can be produced, and why not. `stopped`: the campaign stopped (a slot used up its attempts, a repeat of the other game in one arm, an instrument that did not
// pass) and produces no statistic; `incomplete`: an arm has fewer accepted executions of the presented lane than runs.minimumPerArm; `partial`: arm B was not ready in its time-box,
// so the comparison is A against C (decisionRule.partialReport); `complete` otherwise.
function statusOf(validity, campaign, arms) {
  if (validity.stopped.length > 0) {
    return { status: "stopped", why: validity.stopped };
  }
  const short = arms
    .filter((arm) => validity.accepted[PRESENTED][arm].length < validity.minimumPerArm)
    .map((arm) => ({ rule: "minimum-per-arm", arm, accepted: validity.accepted[PRESENTED][arm].length, required: validity.minimumPerArm }));
  if (short.length > 0) {
    return { status: "incomplete", why: short };
  }
  return { status: campaign.armB.ready ? "complete" : "partial", why: [] };
}

// The readings of the vsync (the mode and the refresh rate read back, of the executions that wrote a report) and of the load, over every attempt, rejected ones and the ones that wrote no report
// included.
function readingsOf(campaign, protocol) {
  const vsync = [];
  for (const { lane, vsync: reading } of campaign.executions) {
    const found = vsync.find((candidate) => candidate.lane === lane && candidate.mode === reading.mode && candidate.refreshHz === reading.refreshHz);
    if (found === undefined) {
      vsync.push({ lane, mode: reading.mode, refreshHz: reading.refreshHz, executions: 1 });
    } else {
      found.executions += 1;
    }
  }
  const loads = [...campaign.executions, ...unreportedAttempts(campaign)].map((attempt) => attempt.load);
  const highest = (when) => (loads.length === 0 ? null : Math.max(...loads.map((load) => load[when])));
  return {
    vsync,
    load: { command: protocol.runs.load.command, limit1MinuteAverage: protocol.runs.load.limit1MinuteAverage, highestBefore: highest("before"), highestAfter: highest("after") },
  };
}

function provenanceSection({ campaign, protocol, validity }, protocolSha256) {
  const { commit, machine, system, display, renderer, adapter, deviations } = campaign.provenance;
  return {
    protocol: {
      id: protocol.id,
      item: protocol.item,
      sha256: protocolSha256,
      amendments: protocol.amendments.length,
      frozen: protocol.thresholds.map((threshold) => ({ id: threshold.id, frozenValue: threshold.frozenValue, frozenAt: threshold.frozenAt })),
    },
    commit,
    machine,
    system,
    display,
    renderer,
    adapter,
    registered: campaign.registered,
    instrument: validity.instrument,
    ...readingsOf(campaign, protocol),
    deviations,
  };
}

const validitySection = ({ validity }) => ({
  maxAttempts: validity.maxAttempts,
  minimumPerArm: validity.minimumPerArm,
  totals: validity.totals,
  balance: validity.balance,
  stopped: validity.stopped,
  slots: validity.slots,
});

// The context of the sections that hold statistics: the presented lane's accepted executions of each planned arm, reduced to the values the statistics take.
function contextOf(campaign, protocol, validity, arms) {
  const windowSeries = windowSeriesOf(protocol);
  const measures = Object.fromEntries(
    arms.map((arm) => [
      arm,
      validity.accepted[PRESENTED][arm].map((execution) => ({
        windows: Object.fromEntries(protocol.windows.map((window) => [window.id, windowMeasures(execution, window, windowSeries.series)])),
        readings: readingValues(execution),
      })),
    ]),
  );
  return { protocol, roles: rolesOf(protocol), decision: decisionRuleOf(protocol), arms, campaign, validity, measures, windowSeries };
}

const unavailable = (reason) => ({ available: false, reason });

// The sections of the report, by the protocol's ids. `ctx` is null when no statistic is produced.
function sectionBuilders({ campaign, protocol, validity, status, ctx, protocolSha256, campaignSha256 }) {
  const values = ctx === null ? null : primaryValues(ctx);
  const statistical = (build) => () => (ctx === null ? unavailable(status) : build());
  return {
    provenance: () => provenanceSection({ campaign, protocol, validity }, protocolSha256),
    validity: () => validitySection({ validity }),
    primary: statistical(() => primarySection(ctx, values)),
    axes: statistical(() => axesSection(ctx)),
    "cost-of-change": statistical(() => costOfChangeSection(ctx)),
    budgets: statistical(() => budgetsSection(ctx, values)),
    decision: () => ({ text: campaign.text?.decision ?? null, partialReport: { applies: status === "partial", reason: campaign.armB.reason ?? null } }),
    limitations: () => ({ text: campaign.text?.limitations ?? null }),
    reproduction: () => ({
      rawData: campaign.provenance.rawData,
      campaignSha256,
      protocolSha256,
      seed: protocol.statistics.interval.seed,
      resamples: protocol.statistics.interval.resamples,
      commands: [COMMAND],
    }),
  };
}

// The report of a campaign. `protocolSha256` and `campaignSha256` are the SHA-256 of the files read; the callers hash the bytes they read. Throws when the protocol is not one the analysis
// understands, the campaign is not in the format, or its attempts contradict one another.
export function buildReport({ campaign, protocol, protocolSha256, campaignSha256 }) {
  const problems = [...protocolErrors(protocol), ...campaignErrors(campaign, protocol)];
  if (problems.length > 0) {
    throw new Error(`the campaign cannot be analysed:\n${problems.join("\n")}`);
  }
  const validity = assessValidity(campaign, protocol, protocolSha256);
  if (validity.problems.length > 0) {
    throw new Error(`the attempts of the campaign contradict one another:\n${validity.problems.join("\n")}`);
  }
  const arms = plannedArms(campaign, protocol);
  const { status, why } = statusOf(validity, campaign, arms);
  const ctx = status === "complete" || status === "partial" ? contextOf(campaign, protocol, validity, arms) : null;
  const builders = sectionBuilders({ campaign, protocol, validity, status, ctx, protocolSha256, campaignSha256 });
  const ids = protocol.report.sections.map((section) => section.id);
  if (ids.join() !== Object.keys(builders).join()) {
    throw new Error(`the protocol's report sections (${ids}) are not the ones the analysis builds (${Object.keys(builders)})`);
  }
  return { format: REPORT_FORMAT, status, why, sections: Object.fromEntries(ids.map((id) => [id, builders[id]()])) };
}

// The report as the bytes that are written: two-space JSON and a final newline, deterministic for the same report.
export const serializeReport = (report) => `${JSON.stringify(report, null, 2)}\n`;
