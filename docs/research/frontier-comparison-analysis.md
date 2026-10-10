# The analysis of the final comparison: the script, written before the first measurement

Status: documentation, a set of Node modules, two Node tests and a synthetic-campaign helper; the delivery changes no product code, runs no game and measures nothing, so the public API, the PARITY table and
the compatibility documents do not change. It prepares the criteria `execucao` and `relatorio` of V05-10 and **closes neither**: the arms B and A do not exist yet, no comparative execution has run, and
**this note states no result**. Every campaign the tests analyse is **synthetic**: its numbers were made up to exercise the script, and none of them says anything about an arm. This slice moves no
checkpoint, grade, weight or denominator of the 1.0. The [evidence record](../evidence/frontier-comparison-analysis/README.md) pins the delivery and keeps the report of a synthetic example campaign.

## The question

The [protocol](frontier-comparison-protocol.md) says that the analysis "runs from a script committed before the first comparative execution, and its output is reproducible from the raw data and the seed"
(`statistics.analysis`), and lists as open that the scenario script, the analysis script and the hashes "are written by `execucao` and `relatorio`, before the first comparative execution" (`open`, id `scripts`).
This is the analysis script: from the raw data of a comparative campaign, every number of the final report exactly as the protocol defines it, with the rule of the protocol that each number implements cited next
to the code. It is not a second statement of the protocol. **The protocol is read when the script runs**: the percentiles and the shape of the statistics across runs, the level, the seed, the resamples and the
generator of the bootstrap, the pairs and the hypotheses, the margin (relative and floor), the categories and the non-inferior condition, the Holm alpha, the order of the executions, the minimum per arm, the load limit,
the invalidation rules, the frozen thresholds and the sections of the report are the JSON's, and the code implements the rules over them. The few rules the protocol states in words and not in data are
checked against the sentence they come from, so that an amendment that rewrites one fails loudly instead of being silently ignored (see [Readings](#where-the-protocol-is-a-sentence-and-the-readings-chosen)).

## What is delivered

| File | What it holds |
| --- | --- |
| `scripts/frontier-comparison-statistics.mjs` | The PRNG `mulberry32`, the median of the protocol, the interquartile range, the percentile bootstrap, the interval bounds, Holm, the one-sided p-values of a claim, the idle reference. Pure functions of numbers. |
| `scripts/frontier-comparison-decision.mjs` | The margin, the categories and the non-inferior flag, evaluated from the JSON's own conditions and bound to a protocol by `decisionRuleOf(protocol)`; the verdict of an interval; the absolute budget. |
| `scripts/frontier-comparison-protocol.mjs` | What the analysis reads from the protocol besides numbers: the roles of the arms, the slots of the order, how each outcome is observed, the sentences it checks. |
| `scripts/frontier-comparison-format.mjs` | The format of a campaign and its validation. |
| `scripts/frontier-comparison-validity.mjs` | The invalidation rules computable from the data, the redo in the slot, the attempts limit, the balance, the campaign that stops. |
| `scripts/frontier-comparison-measures.mjs` | The per-execution values: the percentiles of a window, the frames above twice the idle reference and above 100 ms, the readings. |
| `scripts/frontier-comparison-primary.mjs` | The `primary` and `budgets` sections. |
| `scripts/frontier-comparison-axes.mjs` | The `axes` and `cost-of-change` sections. |
| `scripts/frontier-comparison-report.mjs` | The report: the sections in the protocol's order, the status. |
| `scripts/frontier-comparison-analysis.mjs` | The command line. |
| `tests/frontier-comparison-analysis.test.mjs`, `tests/frontier-comparison-validity.test.mjs` | The tests, on synthetic campaigns. |
| `tests/frontier-comparison-synthetic.mjs` | The generator of the synthetic campaigns and the helpers of the tests; run as `node tests/frontier-comparison-synthetic.mjs <campaign.json>`, it writes the example campaign of the evidence record; with `--unreported` the same campaign with an attempt that wrote no report, and with `--unreported-validity` the `validity` section of its report. |

The statistics and the decision functions that used to live, private, in `tests/frontier-comparison-protocol.test.mjs` (`holds`, `orient`, `categoriesOf`, `classify`, `nonInferior`, `marginOf`, `holmStands`,
`guarded`, `claimPValue`, `mulberry32`, `ascending`, `nearestRank`, `median`, `iqr`, `bootstrapDifferences`, `intervalOf`) moved to the modules above and that test imports them (the decision functions bound to its
protocol with `decisionRuleOf(protocol)`): it passes as it did, with its fixed examples and its fixed interval (`[0.900000, 1.250000]`) intact. `nearestRank` and the quartiles are the ones of `tests/performance-oracle.mjs`, which the baseline and the freeze already use. **One difference is on
purpose:** the protocol's median with an even number of values is the mean of the two middle values (`statistics.acrossRuns.center`), while the oracle's `median` is the nearest rank (the lower of the two). The
analysis uses the protocol's where the protocol commands it, and the oracle's `iqr` (ranks `ceil(n / 4)` and `ceil(3 n / 4)` are the nearest ranks at 25 and 75).

## The command line

```sh
node scripts/frontier-comparison-analysis.mjs <campaign.json> [--out <report.json>] [--protocol <file>]
node scripts/frontier-comparison-analysis.mjs --check-format <campaign.json> [--protocol <file>]
```

The report goes to `--out` or to the standard output, and it is the same bytes for the same campaign file and protocol file. `--check-format` validates the campaign and prints
`FRONTIER_COMPARISON_FORMAT_PASSED` with the number of attempts (every attempt, and when some wrote no report the split, "74 attempts (73 with a report, 1 without)"), or one `FAIL` line for each problem (the first 50, then a count) and exits 1. An analysis that cannot proceed (a protocol this analysis does not understand, a campaign out of the format,
attempts that contradict one another) exits 1 with the reasons. A campaign that is valid and has no statistic to give (the campaign stopped, or an arm has too few executions) is a report with `status` `stopped` or
`incomplete`, not an error.

## The campaign format

`godot-fabric.frontier-comparison-campaign/v1` is what `execucao` has to produce. It is a single JSON object; a key not listed is refused, and so is a missing one, unless it is marked optional. Times are integer
microseconds, the readings are in the protocol's units.

**The campaign**

| Field | Holds | Read by |
| --- | --- | --- |
| `format` | the constant above | |
| `registered.seed` | the registered seed of the scenario (4242) | `invalidation` `not-the-registered-build` (a seed that is not the registered one) |
| `registered.replayGoldenHash`, `registered.soakFinalHash` | the registered golden hash of the 12-turn replay and the final hash of the soak, the same in the three arms because it is the same game | `invalidation` `other-game` |
| `registered.arms.<A,B,C>.{binarySha256, packageSha256, scriptSha256}` | the hashes written before the first execution, by arm | `invalidation` `not-the-registered-build`; `runs.fixed.build` |
| `registered.instrumentSha256` | the hash of the instrument's file that the self-check passed | `invalidation` `instrument`; `thresholds` `cpu-time-instrument` `gate` |
| `instrument.{selfCheckPassed, sha256}` | whether the self-check passed, and the hash of the instrument's file the campaign ran with | `invalidation` `instrument` (not passed, or the reading changed after it) |
| `armB.ready`, `armB.reason?` | whether arm B was ready in its time-box (`false` makes the report partial), and why not | `decisionRule.partialReport` |
| `provenance.{commit, machine, system, display, renderer, adapter}` | free text, copied to the report | `runs.provenance`, `report.sections` `provenance` |
| `provenance.rawData` | where the raw data are kept | `runs.rawData`, `report.sections` `reproduction` |
| `provenance.deviations` | every deviation from the protocol; `[]` says there is none | `report.sections` `provenance` |
| `executions` | every attempt of every slot of both lanes that wrote a report, rejected ones included (below) | `runs.load.redo` (the rejected attempt stays in the raw data) |
| `unreported?` | the attempts whose process wrote no report the analysis can read, one entry each (below); absent or `[]` when there is none | `runs.load.redo`; `invalidation` `errors` |
| `packages.<arm>.exportBytes` | the size of the exported Release package in bytes, twice: the export and its repeat; required for every planned arm | `secondaryOutcomes` `package-size`; `decisionRule.deterministic` |
| `changeCost.<B,C>.{files, lines, timeMinutes, tests}` | the single observation of the cost of change, optional until it is made; the time is in minutes | `secondaryOutcomes` `change-cost`; `decisionRule.singleObservation` |
| `text.{decision, limitations, costOfChange}` | the words of the people who write the report, optional | `report.sections` `decision`, `limitations`, `cost-of-change` |

**An attempt of `executions`**

| Field | Holds | Read by |
| --- | --- | --- |
| `arm`, `lane` | the arm and the lane (`presented`, `unlimited`) | `runs.lanes` |
| `slot` | the position in the order of the executions, from 1 to 36; the arm must be the one the order puts there | `runs.sequence` |
| `attempt` | from 1, without gaps; the redone attempt takes the place of the rejected one | `runs.load.redo` |
| `load.{before, after}` | the 1-minute load average before the execution starts and after it ends | `runs.load` |
| `build` | `release` or `debug` | `invalidation` `not-the-registered-build` |
| `seed` | the seed the scenario ran with | the same |
| `hashes.{binary, package, script, protocol}` | the hashes the execution recorded; `protocol` is the SHA-256 of the protocol file the execution ran under | the same |
| `vsync.{mode, refreshHz}` | the vsync mode and the refresh rate read back | `vsync`; `invalidation` `not-presented` (half of the period) and `vsync-reading` |
| `game.{replayGoldenHash, soakFinalHash}` | the hashes the execution reached | `invalidation` `other-game` |
| `errors.{unhandledJs, scriptErrors, godotLogErrors, crashed, exitCode}` | the counts, the crash and the exit code | `invalidation` `errors` |
| `parityMatches?` | whether the visible testIDs match the table of the context matrix in the seven contexts; only in an arm with a HUD | `invalidation` `parity` |
| `drew.{afterEveryMeasuredIntent, idleDrawnFrames}` | whether a frame was drawn after every measured intent, and how many of the idle frames were drawn | `invalidation` `not-presented` |
| `idle.cpuUsec`, `idle.intervalsUsec` | the CPU time per frame and the elapsed interval between process frames of the 600 idle frames | `idleReference`; `secondaryOutcomes` `frames-above-twice-idle-reference`; `invalidation` `not-presented` (pacing) |
| `windows.<id>.occurrences[]` | for each window of the protocol, its occurrences in order: `warmup` (the first ones, flagged) and `frameUsec`, the CPU time of each frame | `primaryOutcome.perRun`, `runs.warmup`, `invalidation` `incomplete` |
| `windows.<id>.fps?` | the FPS of the window; only in the unlimited lane and only when the vsync mode reads back `DISABLED` | `secondaryOutcomes` `fps-unlimited`; `vsync.unlimitedFpsRequires` |
| `readings.clickToPanelFrames?` | the latency in frames of each measured click (B and C) | `secondaryOutcomes` `click-to-panel` |
| `readings.rssMb?` `{end, max}` | the resident memory at the end of the run and the maximum of the readings kept | `rss` |
| `readings.hermes?` `{heapBytes, nativeViews}` | the live heap after a forced collection and the Fabric native views (C) | `hermes-heap` |
| `readings.sceneNodes?` | the nodes of the SceneTree | `scene-nodes` |
| `readings.timeToInteractiveHudMs?` | the time to the interactive HUD, in ms (B and C) | `time-to-interactive-hud` |

**An attempt of `unreported`.** A process that crashed, hit its time limit or ended without writing a report has no execution to hold (a refresh rate cannot be made up), so the entry holds what was read of the attempt:

| Field | Holds | Read by |
| --- | --- | --- |
| `arm`, `lane`, `slot`, `attempt` | as in `executions`; the arm must be the one the order puts in the slot, and the numbering `attempt` 1, 2, ... of a slot is **over `executions` and `unreported` together** | `runs.sequence`, `runs.load.redo` |
| `load.{before, after}` | the 1-minute load average before the process starts and after it ends | `runs.load` (recorded; the attempt is rejected by `errors`) |
| `errors.crashed` | whether the process was killed by a signal or its log shows a crash (the same reading as `errors.crashed` of an execution) | `invalidation` `errors` |
| `errors.timedOut` | whether the launcher killed the process at its time limit | `invalidation` `errors` |
| `errors.exitCode?` | the exit code, when the process exited by itself; absent when it died by a signal | `invalidation` `errors` |
| `errors.signal?` | the signal that killed it; absent when it exited by itself | `invalidation` `errors` |
| `logSha256` | the SHA-256 of the process's log, kept in the raw data | `runs.load.redo` (the rejected attempt stays in the raw data) |

The entry must say how the process ended: it crashed, it timed out, or it has an exit code (which may be 0; reading 15). An attempt appears once, in `executions` or in `unreported`. The attempt that wrote no report is rejected by `errors`, clause `no-report`, and counts as an attempt of its slot like any other (below).

**The format changed on 2026-10-10 to hold it** (V05-10 `execucao`, the orchestrator of #126). The campaign of that delivery left such an attempt out of `executions`, renumbered the others 1, 2, ... and listed it only in its own state and summary, so the report of the analysis counted fewer attempts than were made and the stop on three used-up attempts could not be checked from `campaign.json`. Now the attempt is in the data and the analysis judges it. This is not an amendment of the protocol: `errors`, `runs.load.redo` and `report.sections` `validity` ("the executions planned, accepted and redone for every slot, with each reason") already cover the case, and only the data format, which is the analysis', changed. The format is still `godot-fabric.frontier-comparison-campaign/v1`: the field is optional, no real campaign exists yet and every campaign written before (the example and the rehearsals) is still valid. In the report, the record of every attempt in `validity.slots[].attempts[]` has `reported` (`true` for an execution, `false` for an attempt without a report, which has its `load` and no `vsync`).

The readings an arm has are those of `secondaryOutcomes[].arms`: a reading an arm does not have is refused, and one it has is required. Every execution carries all its windows, even in the unlimited lane, because the
`incomplete` rule is about the windows; the unlimited lane's CPU times are validated and not analysed (the `presented` lane reads every outcome except the FPS; the `unlimited` lane reads the FPS only).

## What the script computes

Each item cites the rule of the protocol that it implements; the same citation is in the code.

**Validity** (`invalidation`, `runs`). For every slot of both lanes, the attempts in order (the executions and the attempts without a report together, numbered 1, 2, ... without gaps) and, for each, the reasons that reject it. A reason is `{rule, clause, ...values}`: the protocol's id, the part of the rule and
the numbers that decided it; the script writes no sentence. The rules that can be computed from the data:

- `load`: the load average above `runs.load.limit1MinuteAverage` before or after (above, not at).
- `not-presented`, in the presented lane only: a frame drawn after every measured intent and in at least nine of ten frames of the idle window; and the loop paced, which is that the idle reference of the
  `idle.intervalsUsec` (the median of the half-sums of the consecutive pairs, `idleReference.rule`) is not under half of the refresh period read back.
- `not-the-registered-build`: a Debug build; a binary, package or script whose hash differs from the registered one of the arm; a seed that is not the registered one; and a protocol hash that is not the SHA-256 of
  the file being analysed.
- `other-game`, `errors`, `parity`. An attempt that wrote no report (`unreported`) is rejected by `errors` with the clause `no-report` and the values of its entry (`crashed`, `timedOut`, `exitCode` or `signal`): it is judged by this rule alone (the others read the execution it lacks), and it counts in the totals and in the slot like any other attempt.
- `incomplete`: a window with fewer measured occurrences than its protocol number, or an idle window with fewer than `idleReference.frames` frames.

`vsync-reading` is not a rejection (the unlimited lane's FPS is N/A for that execution, with the reading recorded) and `instrument` belongs to the campaign. A slot is `accepted` at its first attempt that no rule
rejects, `open` while its last attempt is rejected and waits for the redo, `exhausted` when `maxAttempts` (3) attempts are rejected, `missing` with no attempt and `not-planned` for an arm that is not ready. Per lane and
arm the report gives the planned, accepted, rejected, open, missing and exhausted counts, and the planned against the accepted executions by position in the block (`runs.balance`).

**The campaign that stops** produces no statistic: a slot that used its attempts (or has a fourth one) with none accepted (`runs.load.redo`; the attempts that wrote no report count, so three of them in a slot stop the campaign by this rule); a repeat of `other-game` in one arm (`invalidation` `other-game`); an
instrument whose self-check did not pass or whose file is not the one it passed (`invalidation` `instrument`, "no comparative execution counts"). The status is `stopped` and `why` says which. An arm with fewer accepted
presented-lane executions than `runs.minimumPerArm` leaves the status `incomplete`. Otherwise the status is `complete`, or `partial` when `armB.ready` is false.

**The primary outcome** (`primaryOutcome`, `windows`, `statistics`). For each window and each arm, the p95 by nearest rank of the CPU time of the frames of the measured occurrences of each accepted presented
execution, in ms (`primaryOutcome.perRun`); the median across the executions and the interquartile range (`statistics.acrossRuns`; the median of an even number is the mean of the two middle values). For each pair of
`statistics.pairs` and each window: the difference of the medians and the 95% percentile-bootstrap interval, with `mulberry32`, one generator per interval seeded with `statistics.interval.seed`, the minuend arm drawn
and then the subtrahend, `floor(u n)` for each draw, and the elements of rank 250 and 9750 of the 10,000 sorted differences (`statistics.interval`). For `H1` and `H2` that is all: an estimate, no category. For `H3`
(C minus B): the margin `max(relative x the median of B, floor)` (`decisionRule.margin`), the category by `decisionRule.categories`, the `nonInferior` flag beside it (`decisionRule.nonInferior`), and the Holm
guard over the four windows (`statistics.multiplicity`): the claim's one-sided p-value from the resampled differences of the same interval, the step-down at `alphaOneSided`, and a category whose claim does not stand
downgraded to `inconclusive` with `unadjustedCategory` beside it (`downgraded`). The windows are side by side and never averaged.

**The axes** (`secondaryOutcomes` with `verdict: true`, `decisionRule`). For each, the verdict of C against B with the outcome's own margin and orientation:

- `click-to-panel`, `rss`, `time-to-interactive-hud`: the per-run value (the median of the measured clicks, for the first), the difference of the medians and the interval of the same bootstrap, the margin
  (`relative x the median of B`, and the floor of one frame for the first), the category and the flag, unadjusted (`statistics.multiplicity.outsideTheFamily`).
- `fps-unlimited`: higher is better, so the interval is negated before the categories (`decisionRule.orientation`); one verdict per window; reported with whether the interval excludes zero (`decisionRule.fpsGain`,
  which a gain by the rule already implies). N/A when the vsync mode does not read back `DISABLED`: the unlimited lane's executions that read another mode have no FPS and are not invalid, and the axis is N/A unless
  C and B each have `minimumPerArm` executions with a reading, with the modes read recorded (`vsync`).
- `package-size`: deterministic. The two exports of an arm are equal, so the interval is the point and the category is taken on the difference of the sizes against the margin; if the two exports of C or B differ
  the axis is `inconclusive` (`decisionRule.deterministic`).
- `change-cost`: a single observation. The category of each of files, lines, time and tests is taken on the difference against the margin (`relative x B's value`), a point interval being gain below `-margin`, cost
  above `+margin` and neutral within; the axis takes a category only when the four agree and is `inconclusive` otherwise; the section says it is one observation per arm and makes no statistical claim
  (`decisionRule.singleObservation`).

**The descriptive outcomes** (`verdict: false`): for each series (the p50 and p99 of each window, the count and the share of the frames above twice the run's idle reference and above 100 ms, the Hermes heap and
native views, the SceneTree nodes, and the maximum resident memory), the median and the interquartile range of each arm that has it, and the difference and the 95% bootstrap interval for every pair of
`statistics.pairs` whose two arms have it, with no category. The frames above twice the idle reference compare the CPU time of a frame with twice the run's idle reference
(`idleReference.rule`, the median by nearest rank of the half-sums of the consecutive pairs of the 600 idle CPU times).

**The absolute budgets** (`decisionRule.absoluteBudget`, `thresholds`). For each window, the frozen budget (`thresholds` `budget-p95-<window>`) and, for each arm, the median over its executions of the per-run p95
against it: `met` when at most the budget, `exceeded` otherwise, `n/a` when the budget is not a number (the stress window was frozen as an N/A with its reason). For B and C it is also beside the category in `primary`;
it never changes it.

**The partial report** (`decisionRule.partialReport`). With `armB.ready: false` arm B is not planned and has no execution; the slots of B stay in the order, `not-planned`; the pairs with B are skipped; `H1` is
estimated and `H3` has no category; every axis is `n/a` for the reason that B is not ready; no gain is claimed anywhere (the test searches the `primary` section for a category and finds none).

**The report** (`report.sections`). A JSON with `format`, `status`, `why` and `sections` keyed by the protocol's ids in its order: `provenance` (the hash of the protocol file, the frozen values with their dates, the
registration, the instrument, the vsync readings (of the executions) and the load readings (of every attempt, the ones without a report too), the deviations), `validity`, `primary`, `axes`, `cost-of-change`, `budgets`, `decision`, `limitations` and `reproduction` (the raw data, the hash of
the campaign file, the seed and the resamples). The words of `decision`, `limitations` and `cost-of-change` come from `text`; without them they are `null`. The report holds no date, path or random number.

## Where the protocol is a sentence, and the readings chosen

The protocol states some rules in words. The code follows them, the sentence is checked when the script runs (`proseRulesOf`), and these are the readings that were chosen. None of them is a freedom taken with a
number: each decides how the sentence meets the data. The three that can change a result (2, 5 and 6) were put to the lead on the review of the delivery and **decided by the lead**: they stand as written. The others
stand as the implementer documented them.

1. **The attempts per slot** (`runs.load.redo`: "at most 3 attempts per slot") and the nine-in-ten and half-period clauses of `not-presented` are read from their sentences. If an amendment rewrites one, the analysis
   refuses the protocol.
2. **`other-game`: "a repeat of it in one arm stops the campaign".** Read as the second rejected attempt for `other-game` among the attempts of the same arm, in either lane. *This reading can change a result.* **Decided by the lead:** the strict reading stays, because "a repeat of
   it in one arm" speaks of the arm and not of the slot.
3. **The campaign that stops.** A slot with three rejected attempts stops it, and so does a fourth attempt, which the protocol does not allow (and does not count, even if its data are fine).
4. **`runs.minimumPerArm`** ("at least 10 executions per arm are required") is read as the gate of the statistics: with fewer accepted executions of the presented lane in an arm that the comparison uses, the status is
   `incomplete` and there is no statistic. Slots missing above the minimum are reported (`missing`, `balanced: false`) and the statistics are produced with the executions there are.
5. **`rss`.** The observation has two values, "the reading at the end of the run, and the maximum of the readings kept". The verdict is taken on the reading at the end of the run, which is named first; the maximum is a
   descriptive series with its interval and no category. *This reading can change a result.* **Decided by the lead:** it stays.
6. **`fps-unlimited`.** The outcome is "per window", so there is one verdict for each of the four windows, and the axis is N/A without enough executions that read back `DISABLED`. *This reading can change the number of verdicts, not their rule.* **Decided by the lead:** it stays.
7. **`package-size`.** "One export of each arm, repeated once" is the campaign's `packages.<arm>.exportBytes`, two sizes by arm, and not a reading of each execution (which carries the package's hash).
8. **`incomplete` and the idle window.** The idle window of 600 frames is called "the idle window" by the protocol; fewer frames than that is read as incomplete, like a window with fewer occurrences.
9. **`not-presented`** is computed from the data where the protocol gives a number (the pacing, from the 600 intervals; the nine-in-ten, from the count of the idle frames drawn) and recorded as a flag where it
   gives a fact only the harness sees (a frame drawn after every measured intent). **`parity`** is a flag too: the table of the context matrix is not in the protocol's data.
10. **The protocol hash of an execution** must be the SHA-256 of the file analysed. It is read under `not-the-registered-build` and `preRegistration.amendments` ("no execution made under the previous text is mixed with
    the new one").
11. **Descriptive intervals.** "Medians and 95% intervals" for an outcome with no verdict is read as the bootstrap interval of the difference of medians for each pair of arms that has the outcome, the only interval
    the protocol defines.
12. **The Holm family** has the four windows of H3 whatever their category: an inconclusive window's p-value takes its rank in the step-down, and the guard downgrades and never upgrades. The `nonInferior` flag is the
    interval's and the guard does not touch it ("a flag beside the category, never in its place").
13. **The partial report.** B's slots keep their numbers in the order and are `not-planned`; whether B was "ready in its time-box" is the campaign's `armB.ready`, decided by `relatorio` from the time-box
    (`decisionRule.partialReport.timeBox`), not computed here.
14. **The budgets** are compared for the three arms in `budgets`; the number of an arm is the median of its per-run p95 in ms, the quantity the protocol compares (and the freeze's note (a) says the bound is wide for it).

15. **An attempt that wrote no report.** The protocol's `errors` names an unhandled error, a script error or an error in Godot's log, a crash and an exit code that is not 0; it does not say what a process that wrote
    no report is. It is read as `errors` whatever its exit code was, with the clause `no-report`: the scenario writes its report before it exits 0 (`tests/frontier-comparison-scenario.gd` exits 2 on a bad command line, 1 when it cannot write the report or when it aborts, and 0 only after the report is written), so a process
    that ends cleanly without one did not complete the scenario. "No report" covers a report the scenario's format cannot read as well as none at all. Only `errors` judges such an attempt, because every other rule reads
    the execution that it lacks, and its load readings are recorded, not judged. The format asks the entry to say how the process ended (crashed, timed out or an exit code, which may be 0), and refuses one that says none of them.
    *This reading can change a result only when a process exits 0 without a report.* It is put to the lead's review with the delivery of 2026-10-10.

## What stays for `execucao` and for `relatorio`

For `execucao` (criterion `execucao`): the scenario script that plays the 100-turn soak, the context switches, the latency pass and the stress rounds; the three arms (A and B do not exist yet); the instrument's
self-check on the campaign's machine; the registration of the hashes of the binary, the package and the scripts, which the campaign file carries as `registered`; a machine within the load limit of 2.0; the
export of each arm twice; and the raw data in this format, every frame and every rejected attempt. The format asks for what the invalidation rules read, and the harness has to record the flags it alone can see
(a frame drawn after every measured intent, whether the testIDs match the matrix, the exit code and the errors).

For `relatorio` (criterion `relatorio`): the text of the `decision`, the `limitations` and the cost of change, and the decision itself on keeping the React Native HUD for games, written even if it is no gain.
The script computes the numbers and invents no sentence.

## Limits

- **No result.** The tests analyse synthetic campaigns; they prove that the script computes what the protocol says, not anything about an arm or about how the data will look.
- **The format is the script's reading of what the protocol needs.** `execucao` may find that a field cannot be recorded as asked. That is a change to this format (the script, the tests and this note), and not to the
  protocol, unless a rule of the protocol has to change, which is an amendment.
- **The sentences of the protocol that are not checked here**: the content of the context matrix, the definition of the windows' start and end (the harness's), and the 5-frame minimum of the event burst. The
  script takes the frames of each occurrence as recorded.
- **Not run on the real protocol's data**: nothing has been measured; the first real campaign will exercise paths (a rejected load, a campaign that stops) that the synthetic ones only simulate.

## Reproducing

The synthetic example of the [evidence record](../evidence/frontier-comparison-analysis/README.md) is regenerated by the first two commands of its README and checked byte for byte by the analysis test; so is the `validity`
section of the example with an attempt that wrote no report (`node tests/frontier-comparison-synthetic.mjs --unreported-validity <file>`).

```sh
node --test tests/frontier-comparison-analysis.test.mjs tests/frontier-comparison-validity.test.mjs tests/frontier-comparison-protocol.test.mjs   # part of npm run test:contracts
node scripts/frontier-comparison-analysis.mjs --check-format <campaign.json>
node scripts/frontier-comparison-analysis.mjs <campaign.json> --out <report.json>
```
