# The freeze: the performance budget of V05-06 and the thresholds of the V05-10 protocol, frozen once on 2026-10-10

Status: documentation, a script, a test and the data they read; the delivery changes no product code and runs no game, so the public API, the PARITY table and the compatibility documents do not change. It is the single act that the 0.5 Frontier milestone had reserved for after
the windowed baseline: the **budget of V05-06** (criterion `congelado`) and the **five thresholds of the final comparison's protocol** (V05-10, criterion `protocolo`) are frozen together, on 2026-10-10, before any comparative execution. The
[evidence record](../evidence/frontier-freeze/README.md), with its [`freeze.json`](../evidence/frontier-freeze/freeze.json), holds every value with its derivation, and `node scripts/frontier-freeze.mjs --check` recomputes them from the committed inputs. **The exit criterion X6** (performance budget pre-registered *and met*) **stays open**: "met" depends on the arms of the
comparison and on the diagnosis in [the observation (c)](#four-observations-that-change-no-rule). This note moves no checkpoint, grade, weight or denominator of the 1.0.

## The question

Two things were waiting, and both were written to be done once. The budget of V05-06 was a **proposal** ([the baseline note](frontier-baseline.md#the-budget-frozen-on-2026-10-10) derived it from the presented windowed baseline of `1bc3a3c`: "recorded, then frozen once after the macOS baseline of V05-06 and before the first
device session", ROADMAP.md). And the protocol of V05-10 had five thresholds with `frozenValue: null` and `frozenAt: null`, which `preRegistration.freeze` lets "a later act" fill, **once**, "together with the `congelado` criterion of V05-06 and before the first comparative execution", with nothing else of the
file changing and the pin not moving ([the protocol](frontier-comparison-protocol.md#the-freeze)). This is that act. The result has to be recomputable by anyone from committed inputs and judged by a test.

## The inputs

**The decision of the user, 2026-10-09:** freeze by the executions of `1bc3a3c`. The executions of the night of 2026-10-09 on `916387e` are corroboration and become no threshold.

`1bc3a3c` is the branch of #99 before the squash `ffeeb5c`: against the squash, the probe, the script and `window-presence.gd` differ only in comments, and the consumer `civ-lite` is the one before #100. The two windowed lanes were measured on that commit, one after the other, on 2026-10-09, in the state of the machine with the lowest load of the executions available (a
one-minute average of 5.26 to 7.55 around the runs), with the user absent, 5 of 5 slots accepted at the first attempt in each lane and no frame that the engine could not draw.

| Role | SHA-256 of the raw receipt | Commit | 1-minute load around the runs | Bundle | Host |
| --- | --- | --- | --- | --- | --- |
| the baseline, **freezes** | `36b32e0d6d1418af122260aa453bdd77bd9619811181731a88855a1e526e13b7` (437,679 bytes; [committed byte for byte](../evidence/frontier-baseline/windowed-presented-raw.json)) | `1bc3a3c` | 5.26 to 6.16 | `7895d359…` | `212d0f6e…` |
| the turn, **freezes** | `8dd6ec9cf4776a8026c3056c337da9a9bb7c811b6b529f05c1ecee3ca111e90f` (1,539,885 bytes; outside the repository) | `1bc3a3c` | 5.35 to 7.55 | `fce50a0a…` | `212d0f6e…` |
| corroboration: the baseline again | `9959a269a61b615d5ccfff3864f262732f2fd28bcbf240f01987c29e3027e9f4` (439,244 bytes; outside the repository) | `916387e` | 8.34 to 13.55 | `7895d359…` | `497e4f95…` |
| corroboration: the turn, HUD of #100 (the current one) | `4708f22b7dc62544a1e22b1c7e1e4f96cc7895216ae7b68c9f4ff62a4da370ca` (1,548,415 bytes; outside the repository) | `916387e` | 6.56 to 10.53 | `54b8af7d…` | `497e4f95…` |
| corroboration, A/B: the turn, HUD of before #100 | `244f6ffd37eef631df4587abc8eb5542af3d89524a130e7a7771cd7ef0c13545` (1,538,986 bytes; outside the repository) | `916387e` | 5.75 to 8.60 | `fce50a0a…` | `497e4f95…` |

The raw receipt of the baseline is in the repository, byte for byte ([`windowed-presented-raw.json`](../evidence/frontier-baseline/windowed-presented-raw.json)); the others stay outside it, with their hash, as the turn's always did. **Each hash was checked before use**, and each receipt was accepted by the oracles
(`verifyGraphicsReceipt` and `graphicsRunValidity` of `tests/frontier-baseline-oracle.mjs`, which the lanes themselves use; the baseline's `summarizeGraphicsRuns` over the raw intervals gives the receipt's `summary` exactly, so the baseline's extract is read from that summary and the test recomputes it from the raw intervals; the turn's per-phase and busy-sum statistics, recomputed from the raw intervals, are the receipt's `turnFrames`).
What the rule reads is committed as [`inputs.json`](../evidence/frontier-freeze/inputs.json): per accepted run, the p50, p95 and p99 of the swap frame over all the swaps and by nodes created, the idle p99, the counts of frames of 100 ms or more and, for the turn, every raw interval of the two windows, in microseconds.
The corroboration is in the same file in the same form, so that the check recomputes its numbers too.

The corroborating executions ran on `main` at `916387e` on the night of 2026-10-09 (local time), with no suite, build or export of another agent running (the principal's sampler checked every 15 seconds, and its file, outside the repository, shows only the processes of the lane) and the user absent. The A/B reverted only `consumers/civ-lite` to `fb51c07` (the main before #100) with `git restore` and restored it afterwards. The two hosts are two Release builds
of the same native code, which does not change between `1bc3a3c` and `916387e`.

## The rule

For a statistic, its value in each of the five runs, in **integer microseconds** from the raw intervals, sorted; the median is the third value, Q1 the second and Q3 the fourth (the quartiles of five by nearest rank, those of `tests/performance-oracle.mjs`, which the script and the test import); the bound is **the median plus three times the IQR** (Q3 minus Q1), **rounded up to 0.5 ms**.
A count of frames of 100 ms or more follows the same rule and is not rounded. It is one function, `budgetOf(perRunValuesUsec)` in `scripts/frontier-freeze.mjs`, which returns the values sorted, Q1, the median, Q3, the IQR, the median plus three IQR and the bound. The test applies it to rows of the derivation table of `1bc3a3c` in the baseline note as fixtures (13.632 / 13.690 / 13.714 / 13.721 / 13.794 ms
gives 14.0; the p99 with 50 nodes gives 27.5; the counts of zero give 0) and recomputes the three numeric thresholds with a formula of its own.

## What is frozen

The five thresholds of the protocol, on 2026-10-10:

| Threshold | Frozen value |
| --- | --- |
| `cpu-time-instrument` | an object with the quantity, the reading, the alignment, the observed error, the gate and the evidence (below) |
| `budget-p95-ai-phase` | **15.5 ms** |
| `budget-p95-event-burst` | **15.5 ms** |
| `budget-p95-context-switches` | **16.0 ms** |
| `budget-p95-stress` | **N/A**: V05-06 measured no log of 200 lines and no production list of 100 items, so the stress window is judged by the relative rule alone |

The three numbers, with the account (milliseconds; the five runs sorted, the quartiles of five and the rule):

| Statistic (ms) | The five runs, sorted | Q1 | Median | Q3 | IQR | Median + 3 IQR | Up to 0.5 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| AI phase p95 (the protocol's `budget-p95-ai-phase`) | 13.784 / 14.539 / 14.642 / 14.799 / 14.928 | 14.539 | 14.642 | 14.799 | 0.260 | 15.422 | **15.5** |
| End-of-turn p95 (the protocol's `budget-p95-event-burst`) | 14.677 / 14.715 / 14.847 / 14.868 / 14.952 | 14.715 | 14.847 | 14.868 | 0.153 | 15.306 | **15.5** |
| Swap frame p95, all swaps (the protocol's `budget-p95-context-switches`) | 14.217 / 14.497 / 14.835 / 14.875 / 15.928 | 14.497 | 14.835 | 14.875 | 0.378 | 15.969 | **16.0** |

In run order (runs 1 to 5): the AI phase p95 is 14.642 / 14.539 / 14.799 / 14.928 / 13.784 ms; the end of the turn 14.677 / 14.847 / 14.868 / 14.952 / 14.715 ms; the swap frame over all swaps 14.835 / 14.497 / 15.928 / 14.217 / 14.875 ms.

- **`budget-p95-ai-phase`** is, per run of the windowed turn, the p95 (nearest rank) of the frames of the `ai-phase` window of the protocol (from the frame that accepts the turn to the last one before the frame that delivers `turn_ended`) over the 120 steady turns: in the terms of the turn's record, the **first six busy frames**, 6 a turn and 720 a run. The two warm-up rounds
  are left out as the oracle leaves them (the first interval of a turn starts at the injection, a few milliseconds after the frame boundary, and is shorter; it is in the window).
- **`budget-p95-event-burst`** is the p95 of the frames of the end of the turn that the lane records: the **seventh busy frame**, which delivers `turn_ended`, and the frames after it until the HUD shows it, which are **one in every turn** (2 a turn, 240 a run). The protocol's window has at least 5 frames from `turn_ended` and the lane records only these, so the later frames were not measured: the bound is that
  of these two, and none was invented.
- **`budget-p95-context-switches`** is the swap frame p95 **over all the swaps** of a run of the baseline (`swapFrameMs.p95` of the receipt's summary): the 360 steady swaps go through the panels of 0, 50, 75 and 100 nodes as the 50 swaps of the window go through the seven contexts. The values by size are beside it in the freeze and become no threshold.
- **`budget-p95-stress`** is N/A because no V05-06 execution measured the stress scenario: the turn's tour keeps the game's state small ([the turn's limitations](frontier-turn.md#limitations-and-open)), the soak's game stops changing after turn 14 ([the soak's limitations](frontier-soak.md#limitations-and-open)), and the services' stress case measures the 64-task and 128-event budgets and not a log of 200 lines or a production list of 100 items (the ROADMAP's final comparison).
- **`cpu-time-instrument`** freezes the five points that [the instrument's note](cpu-time-instrument.md#what-cpu-time-instrument-should-freeze) recommends, condensed without changing their sense: the quantity (`total_ms = physics_ms + process_ms + setup_ms + render_ms` per process frame, the elapsed monotonic time between the engine's hooks on the main thread and not the operating system's CPU clock), the reading
  (`Time.get_ticks_usec` at the engine's hooks, never `Performance.TIME_PROCESS`), the alignment of the render term (6 draws later), the error observed against a load of known duration (0.16% headless, 1.5% in a window, against the 10% rule) and the gate (the instrument's file byte-identical to the one the probe and the oracle passed, and both rerun on the campaign's machine before it starts); its `evidence` names the research and
  the record with the commit that the record pins (`e38615da6ad7f9ca774e2ef8c46de33707c1b427`).

**The budget of V05-06.** Every row, with its decision (the full table, with the baseline and the rule of each row, is in [the baseline note](frontier-baseline.md#the-budget-frozen-on-2026-10-10)):

| Metric (lane) | Frozen bound | Decision |
| --- | --- | --- |
| Native nodes after a swap (headless, exact) | exact | kept |
| Nodes a swap creates and deletes (headless, exact) | exact | kept |
| A click swaps once, never reaches the map, a round ends at the base (headless, exact) | exact | kept |
| Live heap at rest, first to last half of the steady rounds, each by its median (headless, exact) | at most 2,048 bytes | kept |
| Frames from the click to the panel (headless) | at most 1 | kept |
| CPU time of the swap (injection and flush), p95, by nodes created 0 / 50 / 75 / 100 (headless, 180 swaps each) | 4.5 / 11.0 / 13.5 / 16.0 ms | kept |
| Heap a mounted panel holds over the base (headless, forced collection) | 320,000 / 410,000 / 510,000 bytes | kept |
| Swap frame p50, by nodes created 0 / 50 / 75 / 100 (windowed, the display presents the window, vsync on, 120 Hz; 90 swaps of each size in each of 5 runs) | 4.0 / 9.0 / 12.0 / 13.5 ms | recomputed |
| Swap frame p95, by nodes created 0 / 50 / 75 / 100 (windowed, same) | 14.0 / 12.5 / 20.0 / 17.0 ms | recomputed |
| Swap frame p95, all swaps (windowed, same; the protocol's `budget-p95-context-switches`) | 16.0 ms | recomputed |
| Idle frame p99 (windowed, 600 idle intervals in each run) | 16.5 ms | recomputed |
| Swap frames and idle frames of 100 ms or more (windowed) | 0 | recomputed |
| AI phase frame p95 (windowed turn, vsync on, 120 Hz; the first six busy frames of each of the 120 steady turns, 720 a run, in each of 5 runs; the protocol's `budget-p95-ai-phase`) | 15.5 ms | added |
| End-of-turn frame p95 (windowed turn, same; the seventh busy frame, which delivers `turn_ended`, and the frame after it, 240 a run; the protocol's `budget-p95-event-burst`) | 15.5 ms | added |
| Resident memory and Godot's static memory per round | none | kept |
| Swap frame p99, by nodes created 0 / 50 / 75 / 100 (windowed, same) | none (the proposal had 16.5 / 27.5 / 29.5 / 41.5 ms) | removed |

- **Kept**: the headless rows and the rows marked **exact** come from the headless lane pinned in #77, which does not change.
- **Recomputed**: the windowed rows, from the intervals of `1bc3a3c`, the execution the proposal came from: they give the same bounds as the proposal.
- **Removed**: the p99 of the swap frame by size. The p99 of 90 swaps is the largest of them, so one swap a run fixes the bound and it is the noisiest; the tail is covered by the count of frames of 100 ms or more, which stays at 0.
- **Added**: the two rows of the turn, which are the thresholds `budget-p95-ai-phase` and `budget-p95-event-burst`.

## Decisions

1. **The rule** is the one of the protocol and of the baseline's proposal ([The rule](#the-rule)), on microseconds.
2. **`frozenAt`** is the same date in the five thresholds, the local date of the commit that fills them.
3. **Nothing else of the protocol's JSON changes.** `status`, `baseline.windowed` and the first `open` item keep the pre-registration's text, because the pin hashes them (the test holds `0b0644716fb5e4bf85ef7556347e56fa5ea12d3be3f19a0576498370ddc618b6` for the two amendments); [the protocol's note](frontier-comparison-protocol.md#the-freeze) explains it.
4. **The derivation table of the baseline note became the derivation of the freeze**: every number of its rows was checked against the script and matches, and the by-size p99 rows stay in it, marked as not frozen.
5. **The corroboration moves no number and no threshold.** The frozen limits are those of `1bc3a3c`, by the user's decision; the other executions are in the freeze and in this note as observations.
6. **A small de-duplication**: `quartiles` is exported by `tests/performance-oracle.mjs` and the baseline's oracle imports it instead of keeping a private copy (no behaviour changes); the script and the test import it too. The copy in `tests/frontier-turn-oracle.mjs` stays, because the file belongs to another delivery in progress; it is a pending item.

## Four observations that change no rule

None of them changes the protocol, and none loosens a bound.

**(a) The absolute budget compares two different quantities.** `decisionRule.absoluteBudget` compares the p95 of the *CPU time* per frame of an arm with a bound derived from the *frame time* of a presented window, which includes the wait for the display. The bound is wide for the CPU time by construction: the frame time of a presented window at 120 Hz is made of the clusters of the vsync (the idle window of the baseline already has intervals of 13 to 15 ms with nothing happening), while the CPU time of the same idle frames, read by the instrument, was 0.08 ms ([the instrument's note](cpu-time-instrument.md#what-the-runs-showed)).
A budget of about two periods will rarely be exceeded by a CPU time; **the relative rule (C against B) is what decides**, and the absolute budget is reported beside the category and never changes it.

**(b) The executions of the freeze ran far above the load limit of the comparative executions.** The comparative executions require a 1-minute load average of at most 2.0 (`runs.load.limit1MinuteAverage`). The baseline of the freeze ran at 5.26 to 6.16 around its runs (`{ 5.41 5.71 7.07 }` before the lane and `{ 6.79 6.05 6.87 }` after) and the
turn at 5.35 to 7.55; the corroboration ran at 8.34 to 13.55 (the baseline), 6.56 to 10.53 (the turn) and 5.75 to 8.60 (the A/B). The sampler of the corroboration read the 1-minute average between 5.06 and 13.17 and the 5-minute average between 6.97 and 10.09 with no agent suite running:
the idle floor of this machine, with the desktop applications open, was never near 2. The `execucao` criterion will need a machine within the limit, and an execution that does not meet it is redone by the protocol's own rule.

**(c) With the HUD of #100 the turn is over the frozen bounds.** The turn with the HUD of before #100, measured on `916387e` (the A/B: the same machine, the same night and the same main, only `consumers/civ-lite` differs), reproduces `1bc3a3c`; with the HUD of #100 every frame of the turn after the first took about 6 ms more (about 14 ms at the median against about 7.5):

| Turn (windowed, five runs each) | `1bc3a3c`, frozen | main, HUD before #100 | main, HUD of #100 |
| --- | --- | --- | --- |
| The seven frames of the job added, p50 (median across the runs) | 54.234 ms | 54.911 ms | 94.688 ms |
| AI phase p95 in each run | 13.784 to 14.928 ms | 14.506 to 14.787 ms | 16.561 to 17.123 ms |
| Median of the five runs' AI phase p95, against the frozen 15.5 ms | 14.642 ms, met | 14.602 ms, met | 16.787 ms, exceeded |
| Median of the five runs' end-of-turn p95, against the frozen 15.5 ms | 14.847 ms, met | 14.784 ms, met | 17.192 ms, exceeded |
| The bounds the rule would give (AI phase, end of the turn) | 15.5, 15.5 ms | 15.5, 15.0 ms | 18.5, 18.5 ms |
| p50 of each of the seven frames (median across the runs) | 3.497 / 6.290 / 7.370 / 7.661 / 7.588 / 7.076 / 7.241 ms | 4.201 / 7.791 / 7.369 / 7.368 / 7.631 / 7.617 / 7.273 ms | 7.420 / 14.390 / 14.393 / 14.195 / 14.044 / 14.102 / 14.026 ms |

The record says only what the A/B shows: with the HUD of #100 each frame after the first took about 14 ms at the median, more than one period of 8.33 ms, and **the turn on today's main is over the frozen bounds of the turn**. **The cause is under diagnosis by another delivery (GF-35) and is not stated here.** It may be the HUD itself (the `Icon` and `Image` re-rendered on every snapshot), or the cost of the observation: according to a preliminary
diagnosis, the probe reads the Surface's snapshot inside the measured frames, and that snapshot carries the records of the image loader, which grew with #100. **The bounds were not loosened.** If the observation also weighed on `1bc3a3c`, the frozen bounds include that cost and are wider than they would be, not tighter: this is a limitation of the frozen numbers. "Met" for the exit criterion X6 depends on that diagnosis.

**(d) The baseline is sensitive to load.** The same bundle of the baseline ran on the night of 2026-10-09 at a higher load and was about 25% slower, which is why the executions of the lowest load are the ones that count:

| Baseline (windowed, five runs each) | `1bc3a3c`, frozen (load 5.26 to 6.16) | corroboration (load 8.34 to 13.55) |
| --- | --- | --- |
| Injection and flush p50, in each run | 6.824 to 7.305 ms | 8.343 to 9.035 ms |
| Swap frame p95 over all swaps, in each run | 14.217 to 15.928 ms | 18.776 to 20.377 ms |
| Swap frame p50 by nodes created 0 / 50 / 75 / 100 (median of the runs) | 3.662 / 8.448 / 11.171 / 13.144 ms | 4.954 / 11.529 / 14.115 / 16.758 ms |
| Swap frame p95 by nodes created 0 / 50 / 75 / 100 (median of the runs) | 13.714 / 11.052 / 14.080 / 16.577 ms | 13.484 / 13.233 / 16.778 / 20.915 ms |
| The bound the rule would give for the swap frame p95 over all swaps | 16.0 ms | 22.0 ms |

The higher system load is the likely cause (the principal saw `fseventsd`, Spotlight and `CacheDelete` busy); it was not isolated. The turn of before #100, measured the same night (at a load of 5.75 to 8.60), hardly changed from the frozen one (the seven frames of the job add up to 54.911 ms at the p50, against 54.234 ms). The idle p99 stays at 15.329 ms (frozen 15.213 ms) and one frame of 100 ms or more (a swap frame or an idle interval) appears in the last run (none in the frozen runs).

## What does not change

- **The protocol's JSON and its pin**: only the `frozenValue` and `frozenAt` of the five thresholds were filled; `status`, `baseline.windowed` and `open[0]` keep the text of the pre-registration; the test of the protocol still holds the pin of the two amendments and `protocol.amendments.length == 2`.
- **The rules and the numbers of the protocol**: the hypotheses, the windows, the outcomes, the statistics, the margin, the invalidation rules and the report are as they were. The freeze is not an amendment.
- **The headless baseline of #77**, its exact rows and the proposal's headless bounds.
- **The code of the product**, the public API, `docs/PARITY.md`, the compatibility documents and the native modules: nothing in them is added or changed.
- **The notes of the turn and the evidence of the baseline and of the turn**: another delivery works on them (`docs/research/frontier-turn.md`, `docs/evidence/frontier-turn/` and `docs/evidence/frontier-baseline/`); this one points to them.

## What is still open

- **Arm B** (`braco-b`) does not exist: the relative rule (C against B) needs it. Its time-box of 16.0 h is set ([the protocol's amendment](frontier-comparison-protocol.md#amendments)), and nothing is run.
- **`execucao`**: the comparative executions, with the instrument wired in the three arms, the scripts and the hashes written first, and a machine within the load limit (observation (b)).
- **The HUD of #100** over the frozen bounds of the turn (observation (c)): the diagnosis is another delivery's, and the exit criterion X6 ("met") waits for it and for the arms.
- **The stress window** has no absolute budget: it is judged by the relative rule alone, and the scenario that fills a log of 200 lines and a list of 100 items is first measured by the comparison.
- **The end of a turn** was measured over two frames; the frames after them, which the protocol's window of at least five frames would include, were not.
- **The iPhone** is a NO-GO (V05-09, 2026-10-09): the comparison covers macOS only.
- **`quartiles` in the turn's oracle**: its private copy stays until the delivery that owns `tests/frontier-turn-oracle.mjs` imports the exported one.

## Reproducing

```sh
node scripts/frontier-freeze.mjs --check                 # recomputes every value of freeze.json from inputs.json and requires the protocol's thresholds to carry them, on one date
node --test tests/frontier-freeze.test.mjs tests/frontier-comparison-protocol.test.mjs
# with the raw receipts (the baseline's is in the repository, the others are outside it and are checked by their SHA-256): judges them with the oracles and rewrites inputs.json and freeze.json
node scripts/frontier-freeze.mjs --from-receipts docs/evidence/frontier-baseline/windowed-presented-raw.json <turn.json> --corroborate baseline-main=<file> --corroborate turn-main=<file> --corroborate turn-main-pre-100-hud=<file> --date 2026-10-10
```
