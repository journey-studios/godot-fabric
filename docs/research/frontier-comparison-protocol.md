# The final comparison's protocol: pre-registered before any measurement

Status: pre-registered protocol of the final comparison of the 0.5 Frontier milestone (V05-10, criterion `protocolo`). It is documentation, a
[machine-readable protocol](frontier-comparison-protocol.json) and a [Node test](../../tests/frontier-comparison-protocol.test.mjs); it changes no
native code and runs no game. **This note states no result**: no arm has been measured, and nothing here says that the React Native HUD is faster, slower
or equal to anything. The rules and the formulas are closed. The numbers that depend on the windowed baseline of V05-06, which was
[presented](frontier-baseline.md#the-windowed-baseline-presented-2026-10-09-1bc3a3c) on 2026-10-09 with a proposal and not a freeze (its [evidence record](../evidence/frontier-baseline/README.md) pins both halves), are formulas with a null value, to be frozen later in one act together with the `congelado`
criterion of V05-06. **The `protocolo` criterion therefore stays open**: it closes when those numbers are frozen. This slice moves no checkpoint, grade,
weight or denominator of the 1.0.

## The question

The same Frontier game runs in three arms with the same seed, the same replay and the same scripted input, in a Release export on the same machine:

- **A** has no HUD. It is the cost control: **B minus A** and **C minus A** are the price of each HUD.
- **B** has a native Godot HUD written idiomatically in GDScript (Controls, signals, updating only what changed) with the same 6 panels, 7 contexts and testIDs as C,
  held to functional parity by the same context matrix, with the same time-box as C and one optimization pass, so that it is not a straw man.
- **C** has the React Native HUD of V05-05.

The question of gain is **C against B**. The RN HUD is not expected to raise the frame rate, because Hermes, Yoga and the Control mount share the main thread
with the game ([ROADMAP.md](../../ROADMAP.md), section 0.5). **"No gain" is a valid result** and is recorded as such.

## Hypotheses

Written before any run, and fixed once.

| Id | Contrast | Nature | Reads |
| --- | --- | --- | --- |
| `H1` | C minus A | An estimate of the price of the React Native HUD. The difference and its 95% interval are reported in each window, with no category. | The primary outcome in each window |
| `H2` | B minus A | An estimate of the price of the native Godot HUD, reported like H1. | The primary outcome in each window |
| `H3` | C minus B | Confirmatory. The null hypothesis is **"C is not better than B"**. It takes the decision rule, its four categories and the Holm guard. | The primary outcome in each window |

H3 is also read as non-inferiority: C is non-inferior to B in a window when the upper end of the 95% interval of C minus B is at most +margin. The expectation, written
before any run, is no gain in the CPU time of the frame; if a gain appears it is expected in the cost of change and not in the frame.

## Outcomes

**The primary outcome is the CPU time per frame, 95th percentile, within each active window** (ms, lower is better). The quantity is the CPU time of the main thread
for a process frame, read by **one instrument that is the same in the three arms**, and never the interval between frames: with the vsync on, process frames come in
clusters ([frame-clock.md](frame-clock.md)), so an interval says nothing about CPU. It is valid with the vsync on or off. For each execution and window, the value is the
95th percentile by nearest rank (the rank `ceil(95 n / 100)` of the `n` sorted frame values, as the [V05-06 baseline](frontier-baseline.md) and the GF-30 oracle compute
it) over the frames of the window's measured occurrences. The value of an arm in a window is the median over its executions of those per-run values. Each window is
analysed on its own, and **idle frames are left out of the primary outcome** so that they do not dilute the difference.

The exact reading of the instrument is the threshold `cpu-time-instrument`: one engine-side reading of the main thread's CPU time for the frame, from the same code in
the three arms, that excludes the wait for the display, checked with a synthetic load of known duration before the first comparative execution. The host's own pump accounting is not
used, because arms A and B have no host.

**FPS without a limit counts only if `DisplayServer.window_get_vsync_mode()` reads back `DISABLED`.** Otherwise the band of FPS is N/A, with the reading recorded, and the
primary outcome stays the CPU time. The refresh rate (`DisplayServer.screen_get_refresh_rate()`) is read back and recorded, never assumed. Missed frames with the vsync on stay
open, as in the baseline: Godot gives no presentation timestamps.

**Secondary outcomes.** Those with a verdict get a category for C against B by the decision rule, with their own margin (10% of B's median, and the floor in the table). The
others are descriptive: their medians, interquartile ranges and 95% intervals are reported, with no category.

| Outcome | Unit | Arms | Observed | Verdict, floor of the margin |
| --- | --- | --- | --- | --- |
| p50 and p99 of the CPU time per frame, per window | ms | A, B, C | per execution | descriptive |
| Frames above twice the run's idle reference, and above 100 ms | count and share of the window | A, B, C | per execution | descriptive |
| Click to panel latency | frames | B, C | per execution (median of the measured clicks) | yes, floor 1 frame |
| Resident memory (RSS) | MB | A, B, C | per execution (end of the run, and the maximum kept) | yes |
| Hermes live heap after a forced collection, and the Fabric native views | bytes and nodes | C | per execution | descriptive |
| Nodes of the SceneTree | nodes | A, B, C | per execution | descriptive |
| Time to the interactive HUD | ms | B, C | per execution | yes |
| FPS without a limit, per window | frames per second | A, B, C | per execution, `unlimited` lane only, vsync read back `DISABLED` | yes, and its interval must exclude zero |
| Size of the exported Release package | bytes | A, B, C | deterministic: one export per arm, repeated once | yes |
| Cost of change: one new action for the Settler | files, lines, time and tests | B, C | single: one implementation per arm | yes, by the rule of one observation |

## The active windows

Four windows are measured apart. A frame is a process frame of the main loop. The idle reference is 600 consecutive frames after the boot with the map and the HUD still
and nothing injected (the baseline's idle window). **The run's idle reference is the median (nearest rank) of the half-sums of the consecutive pairs of the per-frame values of those frames**, `median((x[i] + x[i+1]) / 2)` for `i` from 0 to `n - 2`,
**in the same quantity as the frames it is compared with**: the CPU time per frame (the primary outcome's instrument) for the secondary outcome "frames above twice the idle reference", and the elapsed intervals between process frames, as the windowed lane records them, for
the pacing check of the presented lane (`not-presented`). It is not the median of the values: see [Amendments](#amendments).

| Window | Starts at | Ends at | Warm-up | Measured |
| --- | --- | --- | ---: | ---: |
| `ai-phase` | the frame in which the End Turn intent is accepted (`frontier.end_turn` answers with a job id) | the last frame before the frame that delivers `frontier.turn_ended` | 2 turns | 98 of the soak's 100 |
| `event-burst` | the frame that delivers `frontier.turn_ended` | the first frame after which every event of that turn has been delivered to its consumers (the HUD's subscribers in B and C, the harness's own counter in A), and at least 5 frames from the start | 2 turns | 98 of the soak's 100 |
| `context-switches` | the frame that receives the selection intent that changes the game's context | the second frame after the starting frame (3 frames) | 24 switches | 50 consecutive switches through the seven contexts |
| `stress` | the frame that receives the intent that fills a log with 200 lines and a production list with 100 items | the second frame after the last of 20 consecutive per-frame updates (a log line appended and an item changed in each) | 2 rounds | 30 rounds |

The warm-up follows the V05-06 baseline protocol: the first 2 occurrences are thrown away, kept in the raw data and flagged; the context switches discard 24, which are 2 rounds of
the baseline's 12-swap tour.

## Executions

**What is fixed.** The same Mac for every execution of every arm; the Release export, never Debug, with the hashes of the binary, the package and the scenario script recorded in every
execution; the scenario seed of V05-03 (4242); the 12-turn replay of 73 intents, whose golden hash is the one fixed in `tests/civ-lite-game-native.test.mjs`; the 100-turn soak; and
scripted game intents identical in the three arms, delivered at the game's intent boundary. The only real clicks are the latency pass of B and C. Each execution is a fresh process that
runs the script once, and no two executions overlap.

**The number and the order.** At least 10 executions per arm are required. The design is **12 per arm**, the smallest multiple of 3 at or above 10, because the order is a Latin square
repeated: the blocks `ABC`, `CAB` and `BCA`, four times, in this fixed order and not drawn:

```
ABC CAB BCA  ABC CAB BCA  ABC CAB BCA  ABC CAB BCA
```

Each arm runs 12 times and 4 times in each position of a block. Position is balanced; first-order carry-over is not, and no claim rests on it. That is 36 executions per lane.

**Lanes.** The `presented` lane keeps the project's default vsync (read back and recorded) and reads every outcome except the FPS without a limit. The `unlimited` lane requests the vsync
`DISABLED`, reads it back, and reads the FPS without a limit, per window, on the same sequence; if the reading is not `DISABLED` the lane is N/A and is not run further.

**The script of an execution:**

1. `boot`: starts the process and reads the time to the interactive HUD (B and C) from the engine's clock.
2. `idle`: 600 frames with nothing injected; their CPU time per frame gives the idle reference of the secondary outcome, and the elapsed intervals between their process frames give the pacing check of the presented lane.
3. `replay`: the 12-turn replay; its golden hash must match; its frames are kept in the raw data and belong to no window.
4. `soak`: 100 turns of scripted End Turn intents; the windows `ai-phase` and `event-burst`.
5. `context-switches`: 24 warm-up and 50 measured consecutive selection intents through the seven contexts (none, tile, Settler, Warrior, stack of two units, city, dialog).
6. `latency`: B and C only; 2 warm-up and 30 measured real clicks on HUD controls found by testID, injected through `Input.parse_input_event` and flushed as in the V05-06 baseline.
7. `stress`: 2 warm-up and 30 measured rounds.
8. `end`: reads the resident memory, the SceneTree's nodes and, in C, the Hermes heap after a forced collection and the native views; records the exit code.

**The load of the system** (`sysctl vm.loadavg`) is recorded before an execution starts and after it ends. The limit is written here: a 1-minute load average above **2.0** in either reading
and the execution is redone. The rejected attempt stays in the raw data with its readings and its reason, the redone one takes its place in the sequence, there are at most 3 attempts per slot, and
when they are used up the campaign stops with that recorded and produces no statistic. Provenance recorded for every execution: the commit, the machine, the system, the display, the renderer and
the adapter, the vsync mode and the refresh rate read back, the load, and the hashes. All the raw data (every frame of every execution, the warm-up flagged, every rejected attempt) are kept under
`docs/evidence/`, so that anyone can apply another rule to the same data.

## Statistics

- **Per run:** percentiles by nearest rank. **Across runs:** the median (the mean of the two middle values when the number of runs is even) and the interquartile range by nearest rank (ranks
  `ceil(n / 4)` and `ceil(3 n / 4)`; with 5 runs, the fourth minus the second, as the baseline does; with 12, the ninth minus the third).
- **The contrast** is the difference of the medians across the executions of two arms. Three pairs, C minus A (`H1`), B minus A (`H2`) and C minus B (`H3`), times the four windows: twelve primary intervals.
- **The interval** is a 95% percentile bootstrap of that difference: **10,000 resamples** and the **fixed seed 20261009**. The unit of resampling is the execution, resampled with replacement and independently within
  each of the two arms. The generator is `mulberry32` (`a = a + 0x6D2B79F5 | 0; t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; u = ((t ^ t >>> 14) >>> 0) / 4294967296`), and its
  first three draws for the seed are 0.2487912888173014, 0.41786690312437713 and 0.04105158778838813, so that an implementation can check itself. There is one generator for each interval, seeded with the seed; for each
  resample it draws the minuend arm and then the subtrahend arm, each draw being `floor(u n)`. The bounds are the elements of rank 250 and 9750 of the 10,000 sorted differences.
- **Multiplicity.** The confirmatory family is the **four primary windows of H3**, adjusted by **Holm**. For each window, the p-value is the smallest of three one-sided bootstrap p-values, with `d` the resampled difference oriented so
  that negative is better and `R` the number of resamples: for a gain, `(1 + #{d >= -margin}) / (R + 1)`; for a cost, `(1 + #{d <= margin}) / (R + 1)`; for neutral, the larger of `(1 + #{d <= -margin}) / (R + 1)` and
  `(1 + #{d >= margin}) / (R + 1)`. Sort the four; the k-th smallest (k from 1) stands when it is at most 0.025 / (4 - k + 1) and every smaller one stood (0.025 is the one-sided half of 0.05). **The guard only downgrades**: a gain, cost or neutral
  verdict of a window whose claim does not stand is reported as inconclusive, with the unadjusted category and interval beside it; an inconclusive window stays inconclusive. H1 and H2 are estimates and the secondary axes are read with their unadjusted
  intervals: none is adjusted, and none claims more than its interval says.
- **No outlier is discarded.** The warm-up and the validity rules below are the only rules that leave data out.
- The analysis runs from a script committed before the first comparative execution, and its output is reproducible from the raw data and the seed.

## The decision rule

For C against B, in each primary window and on each axis with a verdict.

**The margin** is `max(10% of the median of B in that window, 0.5 ms)`: the median over the executions of B of the per-run value in that window, and a floor of 0.5 ms. The formula is fixed here and the number comes from the measurement of B.
For an outcome where higher is better (FPS), the interval of C minus B is negated to `[-hi, -lo]` before the categories apply, so that a gain always means better. With `[lo, hi]` the 95% interval:

| Category | When | Means |
| --- | --- | --- |
| `gain` | `hi < -margin` | C is better than B beyond the margin |
| `neutral` | `lo >= -margin` and `hi <= +margin` | the whole interval lies within the margin |
| `cost` | `lo > +margin` | C is worse than B beyond the margin |
| `inconclusive` | `lo < -margin` and `hi >= -margin`, or `lo <= +margin` and `hi > +margin` | the interval crosses -margin or +margin: too wide to decide |

The four are exclusive and exhaustive for any interval, which the test proves from the JSON on a grid of intervals and margins and against a hand-coded copy. **An inconclusive interval is reported as inconclusive and never rounded to neutral.** The test
also shows that a boundary belongs to one category only: an interval whose upper end is exactly -margin is inconclusive, because a gain is strictly below. The **non-inferior** flag (`hi <= +margin`) is reported beside the category, never in its place.
**A gain in FPS is stated only when the interval excludes zero**; a gain by the rule already does.

The examples below use **invented numbers** to show how the rule reads an interval. They are not results. B's median is 8 ms (margin 0.8 ms) in the first six rows and 3 ms (margin 0.5 ms, the floor) in the last two.

| B's median (ms) | Margin (ms) | Interval of C minus B (ms) | Category | Non-inferior |
| ---: | ---: | --- | --- | --- |
| 8 | 0.8 | `[-3.1, -1.2]` | `gain` | yes |
| 8 | 0.8 | `[-0.6, +0.7]` | `neutral` | yes |
| 8 | 0.8 | `[+0.9, +2.4]` | `cost` | no |
| 8 | 0.8 | `[-2, +0.3]` | `inconclusive`: crosses -margin | yes |
| 8 | 0.8 | `[-0.5, +1.5]` | `inconclusive`: crosses +margin | no |
| 8 | 0.8 | `[-1, -0.8]` | `inconclusive`: the upper end is -margin, not below it | yes |
| 3 | 0.5 | `[-0.4, +0.4]` | `neutral` | yes |
| 3 | 0.5 | `[+0.6, +1.1]` | `cost` | no |

**Verdict by axis.** Every axis with a verdict gets one category. The frame time gets one for each of the four windows, shown side by side and never averaged.
**One observation.** The cost of change has one implementation per arm, so there is no interval: the category is taken on the difference of each of files, lines, time and tests against the margin, the axis takes it only when the four agree and is inconclusive
otherwise, and the report says it is one observation per arm and supports a description and not a statistical claim. **A deterministic axis**, the package size, has its repeated export give equal sizes, so the interval is a point; if the two exports of an arm differ, the axis is inconclusive.
**Absolute budgets.** Once frozen, the median over the executions of an arm of the per-run p95 of a window is compared with the window's budget (met when at most the budget, exceeded otherwise, N/A while it is null). It is reported beside the category for B and for C and never changes it.
**If arm B is not ready in its time-box**, the report is a partial comparison of A against C: `H1` only, no category for `H3`, and no gain claimed. The time-box is the same as arm C's plus one optimization pass; its length was set and recorded before arm B started ([Amendments](#amendments)): **16.0 h** of subagent active time, 12.8 h to pass the `parity` rule and one optimization pass of at most 3.2 h.

## What is open

- **The windowed baseline of V05-06.** No windowed attempt was presented by the display, so no frame time is pinned; `turno`, `soak` and `congelado` are open. The absolute budgets are therefore formulas with a null value:

  | Threshold | Rule | Source | Frozen |
  | --- | --- | --- | --- |
  | `cpu-time-instrument` | one engine-side reading of the main thread's CPU time for the frame, the same code in the three arms, that excludes the wait for the display, checked within 10% against a synthetic load of known duration | the instrument self-check of `execucao` | null |
  | `budget-p95-ai-phase` | the median across five presented runs of the window's p95 plus three times its interquartile range, rounded up to 0.5 ms, as the V05-06 proposal derives a presented frame time | V05-06 `turno`: the frame time of a turn with the AI sliced per frame | null |
  | `budget-p95-event-burst` | the same rule, on the frames of the end of a turn | V05-06 `turno` | null |
  | `budget-p95-context-switches` | the same rule, on the swap frame p95 of the presented windowed baseline | V05-06 windowed baseline, pending until a display presents the window | null |
  | `budget-p95-stress` | the same rule on the stress counterpart in V05-06; frozen as N/A with the reason if V05-06 measured none, and then the window is judged by the relative rule alone | V05-06 `turno` or `soak` | null |

  Each threshold in the JSON has `rule`, `source`, `frozenValue: null` and `frozenAt: null`. The freeze fills only `frozenValue` and `frozenAt`, all together and on one date.
- **Arm B** (`braco-b`) does not exist yet. Its time-box is set: 16.0 h, by the amendment of 2026-10-09 below.
- **The instrument** of the CPU time per frame is chosen and checked by `execucao`, then frozen as `cpu-time-instrument`. The instrument and its self-check are written in [cpu-time-instrument.md](cpu-time-instrument.md); the threshold stays unfrozen here.
- **Missed frames with the vsync on** need presentation timestamps that Godot does not give; the band is N/A until an instrument exists.
- **The iPhone:** V05-09 is a NO-GO (2026-10-09, [its record](../evidence/frontier-device/README.md)), so the comparison covers macOS only. The rule written for a GO stays as it was: with a GO, the same measurements run with the same windows and statistics, the effective refresh rate is recorded, and if the vsync cannot be disabled there the `unlimited` lane is N/A and the CPU time per frame
  and the headroom against the refresh period with the vsync on are the outcome. With a NO-GO the comparison covers macOS only.
- **The scripts**: the scenario script, the analysis script and the hashes of the binary and the package are written by `execucao` and `relatorio` before the first comparative execution.

## What invalidates an execution

| Rule | Condition | Action |
| --- | --- | --- |
| `load` | the 1-minute load average above the written limit before or after the execution | redo |
| `not-presented` | in the `presented` lane, the window did not draw throughout (a frame drawn after every measured intent and in at least nine of ten frames of the idle window) or the loop was not paced (the idle reference, the median of the half-sums of consecutive pairs of the elapsed intervals between process frames of the idle window, is under half of the refresh period read back) | reject with the reason, keep the raw data, redo |
| `not-the-registered-build` | a Debug build, or a binary, package or script whose hash differs from the registered one, or a seed that is not the registered one | reject, redo |
| `other-game` | the golden hash of the 12-turn replay or the final hash of the soak differs from the registered one | reject, redo; a repeat in one arm stops the campaign |
| `errors` | an unhandled JavaScript error, a script error or an error in Godot's log, a crash, or an exit code that is not 0 | reject, redo |
| `parity` | in B or C, the visible testIDs differ from the table of the context matrix in any of the seven contexts | reject, redo; B is not ready until it passes |
| `vsync-reading` | in the `unlimited` lane, the vsync mode does not read back `DISABLED` | not invalid: the FPS band is N/A for that execution, with the reading recorded |
| `incomplete` | a window has fewer measured occurrences than its protocol number | reject, redo |
| `instrument` | the instrument's self-check was not passed, or the reading changed after it | no comparative execution counts until it is repeated and passed |

## The final report

The report is reproducible and structured in this order. It is written even when the result is no gain.

1. `provenance`: the commit, the hash of the protocol and the frozen values with their dates, the machine, the system, the display, the renderer, the vsync and load readings, the hashes of the binary, the package and the scripts, and every deviation from this protocol (or that there is none).
2. `validity`: the executions planned, accepted and redone for every slot, with each reason.
3. `primary`: for each window and each pair, the executions, the median and interquartile range of each arm, the difference and its 95% interval; for C against B the margin with its formula and value, the category, the non-inferior flag and whether the Holm guard downgraded it.
4. `axes`: the verdict of C against B on each axis with a verdict, and the descriptive outcomes with their medians and intervals.
5. `cost-of-change`: files, lines, time and tests of the new Settler action in B and in C, stated as one observation per arm.
6. `budgets`: the absolute budgets as frozen, and whether each arm met them.
7. `decision`: the decision on keeping the React Native HUD for games, written even when the result is no gain; the partial report rule when B was not ready.
8. `limitations`: what stayed open, the iPhone, and the limits of one machine and one display.
9. `reproduction`: where the raw data are and the commands that reproduce every number.

## The pin

The test holds the **SHA-256 of the JSON in canonical form** (keys sorted at every depth, no whitespace) **without the `frozenValue` and `frozenAt` fields**, for the number of amendments the file carries. It has one pin per state:

```
8dd7779dd9f21386cf2e272845339c9031ceebd16cf01aa7dbec3a9d6f00353c   the pre-registration: no amendments (commit 82f5f43)
8833e54e54718694486f626644faa4eef4adef1915f80f973d9827aa44098efb   one amendment: 2026-10-09, the idle reference
0b0644716fb5e4bf85ef7556347e56fa5ea12d3be3f19a0576498370ddc618b6   two amendments: 2026-10-09, arm B's time-box and the iPhone's NO-GO
```

The freeze may fill those two fields of the entries of `thresholds` and nothing else, and the test requires it: no other object may carry them (a freeze field elsewhere would escape the hash), the value and the date are filled together, all the thresholds are frozen
or none is, and on one date. Anything else that changes in the JSON, even a letter, changes the hash and fails the test. That is on purpose: changing the protocol after its pre-registration must be a decision somebody makes, in the same commit, with **an entry in the `amendments` list of
the JSON, a new pin in the test and the reason written in the next section**. The test refuses a change without its entry (the hash of the file no longer is the one pinned for its number of entries), an entry without its pin, and an entry whose `measurementsBefore` is not 0 while the `execucao` criterion
of V05-10 (the comparative executions) has not run. The pin is a tripwire and not a signature: it proves the file is the one the test was written for, and the commit that holds both is what fixes the date.

## Amendments

Changes made after the pre-registration are listed here with their date, commit and reason, and no execution made under the previous text is mixed with the new one. Each is also an entry of the `amendments` list of the JSON (`date`, `what`, `why`, `before`, `measurementsBefore`).

### 2026-10-09: the idle reference is the median of the half-sums of consecutive pairs

**Commit:** the one that adds this section, the entry in the JSON and the second pin of the test (the commit is what fixes the date). **Comparative measurements before it: 0**, so no execution is made under the previous text and none needs to be redone. **Pin after it:** `8833e54e54718694486f626644faa4eef4adef1915f80f973d9827aa44098efb` (the pre-registered one was `8dd7779dd9f21386cf2e272845339c9031ceebd16cf01aa7dbec3a9d6f00353c`).

**What changes.** The idle reference of a run is the median (nearest rank) of the half-sums of the consecutive pairs of the per-frame values of the 600 idle frames, `median((x[i] + x[i+1]) / 2)` for `i` from 0 to `n - 2`, in the same quantity as the frames it is compared with, in place of the median of those values.
For the secondary outcome "frames above twice the idle reference" (which was "frames above twice the idle median"; its id is now `frames-above-twice-idle-reference`) the values are the **CPU time per frame**, read by the primary outcome's instrument (`cpu-time-instrument`), so the outcome compares a CPU time with a CPU time and its label stays in
CPU time. For the pacing clause of the `not-presented` rule, which compares the reference with half of the refresh period, the values are the **elapsed intervals between process frames**, as the windowed lane records them and its oracle computes. Five texts of the JSON change: `idleReference.rule`, the id and
label of that outcome, the `idle` step of the script, the `not-presented` rule and `preRegistration.amendments` (which now names the list). The thresholds, the primary outcome, the windows, the hypotheses, the statistics and the decision rule are the same.

**Why.** The V05-06 windowed baseline found that, with the vsync on at 120 Hz, the 600 idle intervals of a window the display presents come in two groups that alternate: about 300 under 4.17 ms and about 300 of 12 ms or more, so two neighbours add up to about 16.67 ms and the mean is about 8.33 ms.
The median falls in one group or the other by a few samples:

- one presented attempt of the baseline was refused as unpaced with a median of 4.136 ms against the 4.167 ms required, with a mean of 8.333 ms and 5,106 of 5,110 frames drawn;
- the five accepted runs of the turn had medians from 4.421 to 13.177 ms, and in its run 3 (median 4.421 ms) 242 of 360 click frames were "above twice the idle median" only because the median was in the low group.

The median of the half-sums of pairs was between 8.327 and 8.342 ms in the 16 attempts of 2026-10-09 whose intervals came in two groups, is about 0.6 ms in a loop that nothing paces (0.704 to 0.710 ms in the three unpaced attempts of 2026-10-08), and a single stall moves only two of the half-sums, which the mean would not survive. The comparison
of the three statistics over every attempt is in [the baseline's note](frontier-baseline.md) and in the evidence of the change (`docs/evidence/idle-reference/`), and the same statistic is the pacing rule of the windowed lane from the next execution on (the receipts recorded before it were judged by the median and are not judged again).

**The quantity.** The two alternating groups are an effect of the elapsed intervals between process frames with the vsync on, not of the CPU time; the median of the half-sums of pairs is robust to them and to an isolated stall and, in a series with no groups, is practically its median (6.888 against 6.901 ms in a uniform loop of the baseline's receipt A,
0.704 against 0.706 ms in an unpaced one of 2026-10-08), so the same statistic serves both quantities. The pre-registered text defined the idle median over the CPU time of the idle frames and compared the same idle median with half of the refresh period, which is a quantity of intervals; the amendment names, for each use, the quantity that is compared.
The entry was reworded twice on review of the pull request, before the amendment reached main, so it is one amendment with one pin: its first wording (commit `237b171`, pin `6e58144ece9d1c291c818d8079f883c14bd232b7154b0274c93fa683548cb2b0`) said "CPU times" for both uses, and the second (pin `b43c5e9a0e560879c5c67a40c92a755175a74d9bc54f96938222d986e1b3319f`) said the intervals for both. The primary outcome, the CPU time per frame read by one instrument, does not change.

**What it replaces.** In `idleReference.rule`: "the median CPU time of those frames is the run's idle median, the reference of the frames above twice the idle median". In the outcome: "Frames of a window whose CPU time is above twice the run's idle median". In the script: "the idle median". In `not-presented`: "the idle median is under half of the refresh period read back".

### 2026-10-09: arm B's time-box gets its length, and the iPhone's open item records the NO-GO

**Commit:** the one that adds this section, the entry `amendments[1]` of the JSON and the third pin of the test. **Comparative measurements before it: 0**, and arm B
has not started: no arm-B subagent has run. **Pin after it:** `0b0644716fb5e4bf85ef7556347e56fa5ea12d3be3f19a0576498370ddc618b6`.

**What changes.** Three texts of the JSON change. The arms, the hypotheses, the outcomes, the windows, the executions, the statistics, the thresholds and the categories of the decision rule stay as they were.

- `decisionRule.partialReport.timeBox`: its first words are the pre-registered rule, and it now gives the unit, arm C's measurement, the pass and the total.
- The `arm-b` open item: it points at the time-box.
- The `iphone` open item: it records the NO-GO. The `iphone` block keeps its GO and NO-GO rules, and its NO-GO branch is the one that applies.

| | Active time |
| --- | ---: |
| Arm C, the React Native HUD of V05-05 (#82, #93 and #100) | 12.8 h |
| Arm B, to pass the context matrix (the invalidation rule `parity`) | 12.8 h |
| Arm B, one optimization pass after the parity passes | at most 3.2 h |
| **Arm B's time-box** | **16.0 h** |

**The unit** is the active time of the subagents that implement and research the arm. It is the sum of the gaps shorter than 30 minutes between consecutive timestamped events of their transcripts; a longer gap is a wait for review or for a decision, not work. Arm B's clock starts at the first event of its first subagent and is
counted the same way. The orchestrator's own time is counted in neither arm. **The optimization pass** is one round: it profiles arm B alone by idiomatic Godot means, outside any comparative execution, and keeps the parity.

**Why.** The pre-registration said the time-box is the same as arm C's plus one optimization pass, and that its length is set and recorded before arm B starts. It gave no unit, no measurement of C and no length for the pass.

- **The unit.** The subagents' active time is the only effort of C that carries timestamps. By transcript:

  | Subagent of arm C | Active time |
  | --- | ---: |
  | Implementer of #82 and #93 (one agent) | 7.35 h |
  | Implementer of #100 | 5.12 h |
  | Researcher | 0.12 h |
  | Researcher | 0.19 h |
  | **Total** | **12.78 h** |

- **The cut** of 30 minutes is on a plateau. The total is 12.78 h with a cut of 30 or 60 minutes, 11.62 h with 20 and 10.50 h with 10.
  - The gaps under the cut are native suites that ran for up to 25 minutes with no event.
  - The only gap above it, 305 minutes, is the wait between the first slice and the second.
- **The box is generous.** C's 12.8 h also built the game side that B reuses: the event queue, the context in the snapshot, the input blocking under overlays and the probes. A native HUD that is not a straw man needs that room.
- **The pass is a quarter of C's**, because C had none and the protocol asks for one round, not a second implementation.
- **The NO-GO** of V05-09 was recorded on 2026-10-09 ([its record](../evidence/frontier-device/README.md), #102). The `iphone` block already said that with a NO-GO the comparison covers macOS only.

**What it replaces.** In `decisionRule.partialReport.timeBox`: "the same as arm C's plus one optimization pass; its length is set and recorded before arm B starts". In the open item `arm-b`: "arm B (criterion `braco-b`) does not exist; its time-box has no length yet". In the open item `iphone`: "the iPhone depends on the GO or NO-GO of V05-09".

## Reproducing

```sh
node --test tests/frontier-comparison-protocol.test.mjs   # the schema, the decision rule, the order of the executions, the bootstrap, the pin; part of npm run test:contracts
```
