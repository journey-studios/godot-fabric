# Frontier comparison: final report

Status: `complete`. Every arm has the minimum number of accepted executions of the presented lane and the campaign did not stop: the statistics below are the protocol's.

Generated from a report in the format `godot-fabric.frontier-comparison-report/v1` by `scripts/frontier-comparison-report-markdown.mjs`: it formats the numbers of the report and computes none (at most three decimals, trailing zeros dropped). The per-run values and the oriented intervals stay in the report JSON.

## Provenance

| Field | Value |
| --- | --- |
| Commit | synthetic-commit |
| Machine | synthetic machine |
| System | synthetic system |
| Display | synthetic display |
| Renderer | synthetic renderer |
| Adapter | synthetic adapter |

### Protocol

- Protocol: `frontier-comparison-protocol`, item V05-10
- SHA-256: `2319c9b6fbe39262c932c439a5642525818ea4d3e0c66f278f8039d491526f93`
- Amendments: 4

**Frozen values**

- `cpu-time-instrument`, frozen at 2026-10-10:
  - quantity: total_ms = physics_ms + process_ms + setup_ms + render_ms for each process frame, in milliseconds: the monotonic elapsed time between the engine's hooks on the main thread (not the thread's CPU clock of the operating system), every term ending before the frame is presented; the percentile and the windows are the protocol's
  - reading: Time.get_ticks_usec stamped at SceneTree.process_frame, RenderingServer.frame_pre_draw (the last _process when the frame does not draw), SceneTree.physics_frame and the last _physics_process; RenderingServer.get_frame_setup_time_cpu() and viewport_get_measured_render_time_cpu() read at frame_post_draw, with the render measure on for the main window's viewport; never Performance.TIME_PROCESS or TIME_PHYSICS_PROCESS, which are a once-a-second maximum and, for TIME_PROCESS with the vsync on, hold the wait for the display (TIME_PROCESS stays in the samples as a cross-check)
  - alignment: the render reading of a draw is the one taken 6 draws later (Compatibility renderer, Godot 4.7.2, macOS), joined by draw index when the run is over; the harness keeps 6 draws after the last window it needs, and the lag is checked by the render pulse every time the lab probe runs
  - observedError: against a load of known duration, at most 0.16% at 2, 5, 10 and 20 ms headless and at most 1.5% in a presented window (the 2 ms load; 0.22% or less in the others), under the 10% rule; the instrument's floor, the idle total, is about 0.014 ms headless and 0.082 ms in a window, the same in every arm
  - gate: the protocol's `instrument` rule is operational as: tests/cpu-time-instrument.gd is byte-identical to the one the probe and the oracle passed (its hash goes in the provenance), and the probe and the oracle are rerun on the machine, the engine and the renderer of the campaign before it starts
  - evidence:
    - research: docs/research/cpu-time-instrument.md
    - record: docs/evidence/cpu-time-instrument/README.md
    - pinnedCommit: e38615da6ad7f9ca774e2ef8c46de33707c1b427
- `budget-p95-ai-phase`, frozen at 2026-10-10: 15.5
- `budget-p95-event-burst`, frozen at 2026-10-10: 15.5
- `budget-p95-context-switches`, frozen at 2026-10-10: 16
- `budget-p95-stress`, frozen at 2026-10-10: N/A: V05-06 measured no log of 200 lines and no production list of 100 items (the turn's tour and the soak's 100 turns keep the game's state small), so the stress window is judged by the relative rule alone

### Registration

- Seed: 4242
- Replay golden hash: `synthetic-replay-golden-hash`
- Soak final hash: `synthetic-soak-final-hash`
- Instrument SHA-256: `089a5b553289f7e7da18edda5aa2e06f43c76155fee0f01c33a3478736ca5430`

| Arm | Binary SHA-256 | Package SHA-256 | Script SHA-256 |
| --- | --- | --- | --- |
| A | `cf39dd3ee65299004d02024fd66e38d6ef4171eacad33aa26969c3bf39ec707d` | `1ebfda2e1030aa75f400326e0c3341600e59c9c93a291120f87d266376607dae` | `b3af84aaa32d4a3a45f0b326a3919b054cc51c97d4253e748d47926ff7692b64` |
| B | `53a5c0478ca709f0d026a5b3e6beb3ea3dfaf8af5a9b3abee9b8e1874ae85a91` | `5efd9ecaaaa2d8d28c1e122807a10753ecc492922224116ecc72e5149b5aee8f` | `d4337483dd7a15623eb1454a24ec3e9e38d48647c599394841a534f6541eec40` |
| C | `bbbd38669ecfd3fee53329cc6a1a2a24f183fa06348cf3cf538e82c11931e930` | `84e856108c12c705a5581dbb59779daec52dc00e84ed2a21b07d77485e46681b` | `838166bc268392e5656db7515d416dea08b5abb7459499ca4e251389682f7f30` |

### Instrument

- Self-check passed: true; passed: true
- SHA-256: `089a5b553289f7e7da18edda5aa2e06f43c76155fee0f01c33a3478736ca5430`; registered SHA-256: `089a5b553289f7e7da18edda5aa2e06f43c76155fee0f01c33a3478736ca5430`
- Unchanged after the self-check: true

### Readings

**Vsync**

| Lane | Mode | Refresh (Hz) | Executions |
| --- | --- | --- | --- |
| presented | ENABLED | 120 | 37 |
| unlimited | DISABLED | 120 | 36 |

**Load**

- Command: `sysctl vm.loadavg`
- Limit of the 1-minute average: 2
- Highest before an attempt: 5.3; after: 1.28

### Deviations from the protocol

None.

## Validity

- Attempts per slot: at most 3
- Accepted executions required per arm: 10

### Executions by lane and arm

#### Lane: presented

| Arm | Planned | Accepted | Rejected | Open | Missing | Exhausted |
| --- | --- | --- | --- | --- | --- | --- |
| A | 12 | 12 | 0 | 0 | 0 | 0 |
| B | 12 | 12 | 0 | 0 | 0 | 0 |
| C | 12 | 12 | 1 | 0 | 0 | 0 |

Balance by position in the block (positions counted from 0). Balanced: true.

| Position | A planned | A accepted | B planned | B accepted | C planned | C accepted |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 4 | 4 | 4 | 4 | 4 | 4 |
| 1 | 4 | 4 | 4 | 4 | 4 | 4 |
| 2 | 4 | 4 | 4 | 4 | 4 | 4 |

#### Lane: unlimited

| Arm | Planned | Accepted | Rejected | Open | Missing | Exhausted |
| --- | --- | --- | --- | --- | --- | --- |
| A | 12 | 12 | 0 | 0 | 0 | 0 |
| B | 12 | 12 | 0 | 0 | 0 | 0 |
| C | 12 | 12 | 0 | 0 | 0 | 0 |

Balance by position in the block (positions counted from 0). Balanced: true.

| Position | A planned | A accepted | B planned | B accepted | C planned | C accepted |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 4 | 4 | 4 | 4 | 4 | 4 |
| 1 | 4 | 4 | 4 | 4 | 4 | 4 |
| 2 | 4 | 4 | 4 | 4 | 4 | 4 |

### Stops

The campaign did not stop.

### Rejected attempts

| Lane | Slot | Arm | Slot state | Accepted attempt | Attempt | Report | Vsync | Load before | Load after | Reasons |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| presented | 4 | C | accepted | 2 | 1 | written | ENABLED at 120 Hz | 5.3 | 0.53 | load / before (value 5.3, limit 2) |

## Primary outcome

- Outcome: `cpu-time-p95`, in ms, lowerIsBetter
- Interval: percentile bootstrap of the difference of the medians, level 0.95, 10000 resamples, seed 20261009, PRNG mulberry32
- Multiplicity: Holm over the four primary windows of H3 (C minus B), one-sided alpha 0.025

### AI phase (`ai-phase`)

| Arm | Executions | Median (ms) | IQR (ms) |
| --- | --- | --- | --- |
| A | 12 | 5.003 | 0.034 |
| B | 12 | 7.999 | 0.063 |
| C | 12 | 5.994 | 0.058 |

| Pair | Hypothesis | Minuend | Subtrahend | Difference (ms) | Interval |
| --- | --- | --- | --- | --- | --- |
| C-A | H1 | C | A | 0.99 | [0.96, 1.03] |
| B-A | H2 | B | A | 2.996 | [2.963, 3.032] |
| C-B | H3 | C | B | -2.006 | [-2.043, -1.962] |

**C-B (H3), decision**

- Category: gain (unadjusted: gain; downgraded by the Holm guard: false)
- Non-inferior: true
- Holm guard stands: true; one-sided p-value 0.0001
- Margin: 0.8 ms = max(relative x the median of B, floor), with relative 0.1, floor 0.5 ms and the median of the reference 7.999 ms
- Budget `budget-p95-ai-phase` (15.5 ms): B median 7.999 ms, met; C median 5.994 ms, met

### End-of-turn event burst (`event-burst`)

| Arm | Executions | Median (ms) | IQR (ms) |
| --- | --- | --- | --- |
| A | 12 | 5.01 | 0.043 |
| B | 12 | 8.012 | 0.043 |
| C | 12 | 8.046 | 0.034 |

| Pair | Hypothesis | Minuend | Subtrahend | Difference (ms) | Interval |
| --- | --- | --- | --- | --- | --- |
| C-A | H1 | C | A | 3.036 | [3.011, 3.059] |
| B-A | H2 | B | A | 3.002 | [2.968, 3.022] |
| C-B | H3 | C | B | 0.034 | [0.014, 0.064] |

**C-B (H3), decision**

- Category: neutral (unadjusted: neutral; downgraded by the Holm guard: false)
- Non-inferior: true
- Holm guard stands: true; one-sided p-value 0.0001
- Margin: 0.801 ms = max(relative x the median of B, floor), with relative 0.1, floor 0.5 ms and the median of the reference 8.012 ms
- Budget `budget-p95-event-burst` (15.5 ms): B median 8.012 ms, met; C median 8.046 ms, met

### 50 consecutive context switches (`context-switches`)

| Arm | Executions | Median (ms) | IQR (ms) |
| --- | --- | --- | --- |
| A | 12 | 4.989 | 0.055 |
| B | 12 | 7.997 | 0.049 |
| C | 12 | 10 | 0.045 |

| Pair | Hypothesis | Minuend | Subtrahend | Difference (ms) | Interval |
| --- | --- | --- | --- | --- | --- |
| C-A | H1 | C | A | 5.011 | [4.961, 5.041] |
| B-A | H2 | B | A | 3.008 | [2.962, 3.026] |
| C-B | H3 | C | B | 2.003 | [1.978, 2.037] |

**C-B (H3), decision**

- Category: cost (unadjusted: cost; downgraded by the Holm guard: false)
- Non-inferior: false
- Holm guard stands: true; one-sided p-value 0.0001
- Margin: 0.8 ms = max(relative x the median of B, floor), with relative 0.1, floor 0.5 ms and the median of the reference 7.997 ms
- Budget `budget-p95-context-switches` (16 ms): B median 7.997 ms, met; C median 10 ms, met

### Stress: a log of 200 lines and a production list of 100 items (`stress`)

| Arm | Executions | Median (ms) | IQR (ms) |
| --- | --- | --- | --- |
| A | 12 | 5.005 | 0.055 |
| B | 12 | 8.572 | 3.844 |
| C | 12 | 7.75 | 2.215 |

| Pair | Hypothesis | Minuend | Subtrahend | Difference (ms) | Interval |
| --- | --- | --- | --- | --- | --- |
| C-A | H1 | C | A | 2.745 | [1.792, 4.273] |
| B-A | H2 | B | A | 3.566 | [1.44, 5.209] |
| C-B | H3 | C | B | -0.822 | [-3.09, 1.861] |

**C-B (H3), decision**

- Category: inconclusive (unadjusted: inconclusive; downgraded by the Holm guard: false)
- Non-inferior: false
- Holm guard stands: false; one-sided p-value 0.495
- Margin: 0.857 ms = max(relative x the median of B, floor), with relative 0.1, floor 0.5 ms and the median of the reference 8.572 ms
- Budget `budget-p95-stress` (N/A: V05-06 measured no log of 200 lines and no production list of 100 items (the turn's tour and the soak's 100 turns keep the game's state small), so the stress window is judged by the relative rule alone): B median 8.572 ms, n/a; C median 7.75 ms, n/a

## Axes

### Verdicts, C against B

| Axis | Window | Unit | Orientation | Difference | Interval | Margin | Category | Non-inferior | Excludes zero |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Click to panel latency (click-to-panel) |  | frames | lowerIsBetter | 0 | [0, 0] | 1 | neutral | true |  |
| Resident memory of the process (rss) |  | MB | lowerIsBetter | 20.459 | [18.816, 21.494] | 30.949 | neutral | true |  |
| Time to the interactive HUD (time-to-interactive-hud) |  | ms | lowerIsBetter | 22.326 | [17.782, 24.576] | 39.989 | neutral | true |  |
| FPS without a limit, per window (fps-unlimited) | ai-phase | frames per second | higherIsBetter | 398.33 | [392.885, 409.18] | 99.807 | gain | true | true |
| FPS without a limit, per window (fps-unlimited) | event-burst | frames per second | higherIsBetter | 1.6 | [-7.545, 7.75] | 100.218 | neutral | true | false |
| FPS without a limit, per window (fps-unlimited) | context-switches | frames per second | higherIsBetter | -0.56 | [-5.955, 6.96] | 99.947 | neutral | true | false |
| FPS without a limit, per window (fps-unlimited) | stress | frames per second | higherIsBetter | 7.195 | [-3.01, 12.91] | 99.508 | neutral | true | false |
| Size of the exported Release package (package-size) |  | bytes | lowerIsBetter | 14000000 | [14000000, 14000000] | 4100000 | cost | false |  |
| Cost of change: one new action for the Settler (change-cost) |  | files, lines, time and tests |  |  |  |  | inconclusive |  |  |

### Values behind the verdicts

| Axis | Window | Unit | Arm | Executions | Median | IQR |
| --- | --- | --- | --- | --- | --- | --- |
| Click to panel latency (click-to-panel) |  | frames | B | 12 | 3 | 0 |
| Click to panel latency (click-to-panel) |  | frames | C | 12 | 3 | 0 |
| Resident memory of the process (rss) |  | MB | A | 12 | 300.371 | 2.135 |
| Resident memory of the process (rss) |  | MB | B | 12 | 309.488 | 1.963 |
| Resident memory of the process (rss) |  | MB | C | 12 | 329.947 | 1.484 |
| Time to the interactive HUD (time-to-interactive-hud) |  | ms | B | 12 | 399.894 | 2.983 |
| Time to the interactive HUD (time-to-interactive-hud) |  | ms | C | 12 | 422.22 | 5.07 |
| FPS without a limit, per window (fps-unlimited) | ai-phase | frames per second | A | 12 | 3001.53 | 11.09 |
| FPS without a limit, per window (fps-unlimited) | ai-phase | frames per second | B | 12 | 998.065 | 6.96 |
| FPS without a limit, per window (fps-unlimited) | ai-phase | frames per second | C | 12 | 1396.395 | 12.08 |
| FPS without a limit, per window (fps-unlimited) | event-burst | frames per second | A | 12 | 3003.495 | 15.21 |
| FPS without a limit, per window (fps-unlimited) | event-burst | frames per second | B | 12 | 1002.18 | 8.74 |
| FPS without a limit, per window (fps-unlimited) | event-burst | frames per second | C | 12 | 1003.78 | 10.48 |
| FPS without a limit, per window (fps-unlimited) | context-switches | frames per second | A | 12 | 3008.06 | 28.82 |
| FPS without a limit, per window (fps-unlimited) | context-switches | frames per second | B | 12 | 999.47 | 7.82 |
| FPS without a limit, per window (fps-unlimited) | context-switches | frames per second | C | 12 | 998.91 | 10.11 |
| FPS without a limit, per window (fps-unlimited) | stress | frames per second | A | 12 | 2994.52 | 19.81 |
| FPS without a limit, per window (fps-unlimited) | stress | frames per second | B | 12 | 995.08 | 12.38 |
| FPS without a limit, per window (fps-unlimited) | stress | frames per second | C | 12 | 1002.275 | 9.69 |

**FPS without a limit, per window (fps-unlimited): readings of the unlimited lane**

| Arm | Accepted | With FPS | Vsync modes read |
| --- | --- | --- | --- |
| A | 12 | 12 | DISABLED: 12 |
| B | 12 | 12 | DISABLED: 12 |
| C | 12 | 12 | DISABLED: 12 |

**Size of the exported Release package (package-size): the exports of each arm**

| Arm | Export bytes | Equal |
| --- | --- | --- |
| A | 40000000, 40000000 | true |
| B | 41000000, 41000000 | true |
| C | 55000000, 55000000 | true |

**Cost of change: one new action for the Settler (change-cost): one observation per arm** (observations per arm 1; the measures agree: false)

| Measure | B | C | Difference | Margin | Category | Non-inferior |
| --- | --- | --- | --- | --- | --- | --- |
| files | 3 | 3 | 0 | 0.3 | neutral | true |
| lines | 120 | 100 | -20 | 12 | gain | true |
| timeMinutes | 90 | 85 | -5 | 9 | neutral | true |
| tests | 4 | 4 | 0 | 0.4 | neutral | true |

### Descriptive outcomes

#### `cpu-time-p50`

CPU time per frame, 50th percentile, per window

| Series | Window | Unit | Arm | Executions | Median | IQR |
| --- | --- | --- | --- | --- | --- | --- |
| cpu-time-p50 | ai-phase | ms | A | 12 | 2.002 | 0.014 |
| cpu-time-p50 | ai-phase | ms | B | 12 | 3.2 | 0.025 |
| cpu-time-p50 | ai-phase | ms | C | 12 | 2.397 | 0.023 |
| cpu-time-p50 | event-burst | ms | A | 12 | 2.004 | 0.018 |
| cpu-time-p50 | event-burst | ms | B | 12 | 3.205 | 0.017 |
| cpu-time-p50 | event-burst | ms | C | 12 | 3.218 | 0.013 |
| cpu-time-p50 | context-switches | ms | A | 12 | 1.996 | 0.022 |
| cpu-time-p50 | context-switches | ms | B | 12 | 3.199 | 0.02 |
| cpu-time-p50 | context-switches | ms | C | 12 | 4 | 0.018 |
| cpu-time-p50 | stress | ms | A | 12 | 2.002 | 0.022 |
| cpu-time-p50 | stress | ms | B | 12 | 3.429 | 1.537 |
| cpu-time-p50 | stress | ms | C | 12 | 3.1 | 0.886 |

| Series | Window | Unit | Pair | Difference | Interval |
| --- | --- | --- | --- | --- | --- |
| cpu-time-p50 | ai-phase | ms | C-A | 0.396 | [0.384, 0.412] |
| cpu-time-p50 | ai-phase | ms | B-A | 1.198 | [1.185, 1.213] |
| cpu-time-p50 | ai-phase | ms | C-B | -0.802 | [-0.817, -0.784] |
| cpu-time-p50 | event-burst | ms | C-A | 1.214 | [1.204, 1.224] |
| cpu-time-p50 | event-burst | ms | B-A | 1.201 | [1.188, 1.209] |
| cpu-time-p50 | event-burst | ms | C-B | 0.013 | [0.006, 0.025] |
| cpu-time-p50 | context-switches | ms | C-A | 2.004 | [1.985, 2.016] |
| cpu-time-p50 | context-switches | ms | B-A | 1.203 | [1.184, 1.21] |
| cpu-time-p50 | context-switches | ms | C-B | 0.801 | [0.791, 0.815] |
| cpu-time-p50 | stress | ms | C-A | 1.098 | [0.717, 1.71] |
| cpu-time-p50 | stress | ms | B-A | 1.427 | [0.577, 2.083] |
| cpu-time-p50 | stress | ms | C-B | -0.329 | [-1.236, 0.745] |

#### `cpu-time-p99`

CPU time per frame, 99th percentile, per window

| Series | Window | Unit | Arm | Executions | Median | IQR |
| --- | --- | --- | --- | --- | --- | --- |
| cpu-time-p99 | ai-phase | ms | A | 12 | 5.003 | 0.034 |
| cpu-time-p99 | ai-phase | ms | B | 12 | 7.999 | 0.063 |
| cpu-time-p99 | ai-phase | ms | C | 12 | 5.994 | 0.058 |
| cpu-time-p99 | event-burst | ms | A | 12 | 5.01 | 0.043 |
| cpu-time-p99 | event-burst | ms | B | 12 | 8.012 | 0.043 |
| cpu-time-p99 | event-burst | ms | C | 12 | 8.046 | 0.034 |
| cpu-time-p99 | context-switches | ms | A | 12 | 4.989 | 0.055 |
| cpu-time-p99 | context-switches | ms | B | 12 | 7.997 | 0.049 |
| cpu-time-p99 | context-switches | ms | C | 12 | 10 | 0.045 |
| cpu-time-p99 | stress | ms | A | 12 | 5.005 | 0.055 |
| cpu-time-p99 | stress | ms | B | 12 | 8.572 | 3.844 |
| cpu-time-p99 | stress | ms | C | 12 | 7.75 | 2.215 |

| Series | Window | Unit | Pair | Difference | Interval |
| --- | --- | --- | --- | --- | --- |
| cpu-time-p99 | ai-phase | ms | C-A | 0.99 | [0.96, 1.03] |
| cpu-time-p99 | ai-phase | ms | B-A | 2.996 | [2.963, 3.032] |
| cpu-time-p99 | ai-phase | ms | C-B | -2.006 | [-2.043, -1.962] |
| cpu-time-p99 | event-burst | ms | C-A | 3.036 | [3.011, 3.059] |
| cpu-time-p99 | event-burst | ms | B-A | 3.002 | [2.968, 3.022] |
| cpu-time-p99 | event-burst | ms | C-B | 0.034 | [0.014, 0.064] |
| cpu-time-p99 | context-switches | ms | C-A | 5.011 | [4.961, 5.041] |
| cpu-time-p99 | context-switches | ms | B-A | 3.008 | [2.962, 3.026] |
| cpu-time-p99 | context-switches | ms | C-B | 2.003 | [1.978, 2.037] |
| cpu-time-p99 | stress | ms | C-A | 2.745 | [1.792, 4.273] |
| cpu-time-p99 | stress | ms | B-A | 3.566 | [1.44, 5.209] |
| cpu-time-p99 | stress | ms | C-B | -0.822 | [-3.09, 1.861] |

#### `frames-above-twice-idle-reference`

Frames of a window whose CPU time is above twice the run's idle reference (the median of the half-sums of consecutive pairs of the CPU time per frame of the idle window)

| Series | Window | Unit | Arm | Executions | Median | IQR |
| --- | --- | --- | --- | --- | --- | --- |
| frames-above-twice-idle-reference.count | ai-phase | frames | A | 12 | 588 | 0 |
| frames-above-twice-idle-reference.count | ai-phase | frames | B | 12 | 588 | 0 |
| frames-above-twice-idle-reference.count | ai-phase | frames | C | 12 | 588 | 0 |
| frames-above-twice-idle-reference.count | event-burst | frames | A | 12 | 588 | 0 |
| frames-above-twice-idle-reference.count | event-burst | frames | B | 12 | 588 | 0 |
| frames-above-twice-idle-reference.count | event-burst | frames | C | 12 | 588 | 0 |
| frames-above-twice-idle-reference.count | context-switches | frames | A | 12 | 150 | 0 |
| frames-above-twice-idle-reference.count | context-switches | frames | B | 12 | 150 | 0 |
| frames-above-twice-idle-reference.count | context-switches | frames | C | 12 | 150 | 0 |
| frames-above-twice-idle-reference.count | stress | frames | A | 12 | 660 | 0 |
| frames-above-twice-idle-reference.count | stress | frames | B | 12 | 660 | 0 |
| frames-above-twice-idle-reference.count | stress | frames | C | 12 | 660 | 0 |
| frames-above-twice-idle-reference.share | ai-phase | share | A | 12 | 1 | 0 |
| frames-above-twice-idle-reference.share | ai-phase | share | B | 12 | 1 | 0 |
| frames-above-twice-idle-reference.share | ai-phase | share | C | 12 | 1 | 0 |
| frames-above-twice-idle-reference.share | event-burst | share | A | 12 | 1 | 0 |
| frames-above-twice-idle-reference.share | event-burst | share | B | 12 | 1 | 0 |
| frames-above-twice-idle-reference.share | event-burst | share | C | 12 | 1 | 0 |
| frames-above-twice-idle-reference.share | context-switches | share | A | 12 | 1 | 0 |
| frames-above-twice-idle-reference.share | context-switches | share | B | 12 | 1 | 0 |
| frames-above-twice-idle-reference.share | context-switches | share | C | 12 | 1 | 0 |
| frames-above-twice-idle-reference.share | stress | share | A | 12 | 1 | 0 |
| frames-above-twice-idle-reference.share | stress | share | B | 12 | 1 | 0 |
| frames-above-twice-idle-reference.share | stress | share | C | 12 | 1 | 0 |

| Series | Window | Unit | Pair | Difference | Interval |
| --- | --- | --- | --- | --- | --- |
| frames-above-twice-idle-reference.count | ai-phase | frames | C-A | 0 | [0, 0] |
| frames-above-twice-idle-reference.count | ai-phase | frames | B-A | 0 | [0, 0] |
| frames-above-twice-idle-reference.count | ai-phase | frames | C-B | 0 | [0, 0] |
| frames-above-twice-idle-reference.count | event-burst | frames | C-A | 0 | [0, 0] |
| frames-above-twice-idle-reference.count | event-burst | frames | B-A | 0 | [0, 0] |
| frames-above-twice-idle-reference.count | event-burst | frames | C-B | 0 | [0, 0] |
| frames-above-twice-idle-reference.count | context-switches | frames | C-A | 0 | [0, 0] |
| frames-above-twice-idle-reference.count | context-switches | frames | B-A | 0 | [0, 0] |
| frames-above-twice-idle-reference.count | context-switches | frames | C-B | 0 | [0, 0] |
| frames-above-twice-idle-reference.count | stress | frames | C-A | 0 | [0, 0] |
| frames-above-twice-idle-reference.count | stress | frames | B-A | 0 | [0, 0] |
| frames-above-twice-idle-reference.count | stress | frames | C-B | 0 | [0, 0] |
| frames-above-twice-idle-reference.share | ai-phase | share | C-A | 0 | [0, 0] |
| frames-above-twice-idle-reference.share | ai-phase | share | B-A | 0 | [0, 0] |
| frames-above-twice-idle-reference.share | ai-phase | share | C-B | 0 | [0, 0] |
| frames-above-twice-idle-reference.share | event-burst | share | C-A | 0 | [0, 0] |
| frames-above-twice-idle-reference.share | event-burst | share | B-A | 0 | [0, 0] |
| frames-above-twice-idle-reference.share | event-burst | share | C-B | 0 | [0, 0] |
| frames-above-twice-idle-reference.share | context-switches | share | C-A | 0 | [0, 0] |
| frames-above-twice-idle-reference.share | context-switches | share | B-A | 0 | [0, 0] |
| frames-above-twice-idle-reference.share | context-switches | share | C-B | 0 | [0, 0] |
| frames-above-twice-idle-reference.share | stress | share | C-A | 0 | [0, 0] |
| frames-above-twice-idle-reference.share | stress | share | B-A | 0 | [0, 0] |
| frames-above-twice-idle-reference.share | stress | share | C-B | 0 | [0, 0] |

#### `frames-above-100-ms`

Frames of a window whose CPU time is above 100 ms

| Series | Window | Unit | Arm | Executions | Median | IQR |
| --- | --- | --- | --- | --- | --- | --- |
| frames-above-100-ms.count | ai-phase | frames | A | 12 | 0 | 0 |
| frames-above-100-ms.count | ai-phase | frames | B | 12 | 0 | 0 |
| frames-above-100-ms.count | ai-phase | frames | C | 12 | 0 | 0 |
| frames-above-100-ms.count | event-burst | frames | A | 12 | 0 | 0 |
| frames-above-100-ms.count | event-burst | frames | B | 12 | 0 | 0 |
| frames-above-100-ms.count | event-burst | frames | C | 12 | 0 | 0 |
| frames-above-100-ms.count | context-switches | frames | A | 12 | 0 | 0 |
| frames-above-100-ms.count | context-switches | frames | B | 12 | 0 | 0 |
| frames-above-100-ms.count | context-switches | frames | C | 12 | 0 | 0 |
| frames-above-100-ms.count | stress | frames | A | 12 | 0 | 0 |
| frames-above-100-ms.count | stress | frames | B | 12 | 0 | 0 |
| frames-above-100-ms.count | stress | frames | C | 12 | 0 | 0 |
| frames-above-100-ms.share | ai-phase | share | A | 12 | 0 | 0 |
| frames-above-100-ms.share | ai-phase | share | B | 12 | 0 | 0 |
| frames-above-100-ms.share | ai-phase | share | C | 12 | 0 | 0 |
| frames-above-100-ms.share | event-burst | share | A | 12 | 0 | 0 |
| frames-above-100-ms.share | event-burst | share | B | 12 | 0 | 0 |
| frames-above-100-ms.share | event-burst | share | C | 12 | 0 | 0 |
| frames-above-100-ms.share | context-switches | share | A | 12 | 0 | 0 |
| frames-above-100-ms.share | context-switches | share | B | 12 | 0 | 0 |
| frames-above-100-ms.share | context-switches | share | C | 12 | 0 | 0 |
| frames-above-100-ms.share | stress | share | A | 12 | 0 | 0 |
| frames-above-100-ms.share | stress | share | B | 12 | 0 | 0 |
| frames-above-100-ms.share | stress | share | C | 12 | 0 | 0 |

| Series | Window | Unit | Pair | Difference | Interval |
| --- | --- | --- | --- | --- | --- |
| frames-above-100-ms.count | ai-phase | frames | C-A | 0 | [0, 0] |
| frames-above-100-ms.count | ai-phase | frames | B-A | 0 | [0, 0] |
| frames-above-100-ms.count | ai-phase | frames | C-B | 0 | [0, 0] |
| frames-above-100-ms.count | event-burst | frames | C-A | 0 | [0, 0] |
| frames-above-100-ms.count | event-burst | frames | B-A | 0 | [0, 0] |
| frames-above-100-ms.count | event-burst | frames | C-B | 0 | [0, 0] |
| frames-above-100-ms.count | context-switches | frames | C-A | 0 | [0, 0] |
| frames-above-100-ms.count | context-switches | frames | B-A | 0 | [0, 0] |
| frames-above-100-ms.count | context-switches | frames | C-B | 0 | [0, 0] |
| frames-above-100-ms.count | stress | frames | C-A | 0 | [0, 0] |
| frames-above-100-ms.count | stress | frames | B-A | 0 | [0, 0] |
| frames-above-100-ms.count | stress | frames | C-B | 0 | [0, 0] |
| frames-above-100-ms.share | ai-phase | share | C-A | 0 | [0, 0] |
| frames-above-100-ms.share | ai-phase | share | B-A | 0 | [0, 0] |
| frames-above-100-ms.share | ai-phase | share | C-B | 0 | [0, 0] |
| frames-above-100-ms.share | event-burst | share | C-A | 0 | [0, 0] |
| frames-above-100-ms.share | event-burst | share | B-A | 0 | [0, 0] |
| frames-above-100-ms.share | event-burst | share | C-B | 0 | [0, 0] |
| frames-above-100-ms.share | context-switches | share | C-A | 0 | [0, 0] |
| frames-above-100-ms.share | context-switches | share | B-A | 0 | [0, 0] |
| frames-above-100-ms.share | context-switches | share | C-B | 0 | [0, 0] |
| frames-above-100-ms.share | stress | share | C-A | 0 | [0, 0] |
| frames-above-100-ms.share | stress | share | B-A | 0 | [0, 0] |
| frames-above-100-ms.share | stress | share | C-B | 0 | [0, 0] |

#### `rss`

Resident memory of the process

| Series | Window | Unit | Arm | Executions | Median | IQR |
| --- | --- | --- | --- | --- | --- | --- |
| rss.max |  | MB | A | 12 | 312.404 | 1.466 |
| rss.max |  | MB | B | 12 | 321.631 | 2.75 |
| rss.max |  | MB | C | 12 | 341.272 | 1.615 |

| Series | Window | Unit | Pair | Difference | Interval |
| --- | --- | --- | --- | --- | --- |
| rss.max |  | MB | C-A | 28.868 | [27.919, 30.186] |
| rss.max |  | MB | B-A | 9.227 | [7.733, 10.96] |
| rss.max |  | MB | C-B | 19.641 | [18.123, 21.251] |

#### `hermes-heap`

Hermes live heap after a forced collection, and the Fabric native views

| Series | Window | Unit | Arm | Executions | Median | IQR |
| --- | --- | --- | --- | --- | --- | --- |
| hermes-heap.bytes |  | bytes | C | 12 | 5004129 | 30449 |
| hermes-heap.nativeViews |  | nodes | C | 12 | 150 | 0 |

#### `scene-nodes`

Nodes of the SceneTree

| Series | Window | Unit | Arm | Executions | Median | IQR |
| --- | --- | --- | --- | --- | --- | --- |
| scene-nodes |  | nodes | A | 12 | 120 | 0 |
| scene-nodes |  | nodes | B | 12 | 180 | 0 |
| scene-nodes |  | nodes | C | 12 | 190 | 0 |

| Series | Window | Unit | Pair | Difference | Interval |
| --- | --- | --- | --- | --- | --- |
| scene-nodes |  | nodes | C-A | 70 | [70, 70] |
| scene-nodes |  | nodes | B-A | 60 | [60, 60] |
| scene-nodes |  | nodes | C-B | 10 | [10, 10] |

## Cost of change

Observations per arm: 1. Statistical claim: false. This is one observation per arm: it describes the change and makes no statistical claim (`statisticalClaim: false`).

| Measure | B | C |
| --- | --- | --- |
| files | 3 | 3 |
| lines | 120 | 100 |
| timeMinutes | 90 | 85 |
| tests | 4 | 4 |

> SYNTHETIC EXAMPLE: the single observation of each arm was made up.

## Budgets

| Window | Threshold | Frozen budget | Frozen at | A: median of the per-run p95, result | B: median of the per-run p95, result | C: median of the per-run p95, result |
| --- | --- | --- | --- | --- | --- | --- |
| ai-phase | budget-p95-ai-phase | 15.5 ms | 2026-10-10 | 5.003 ms, met | 7.999 ms, met | 5.994 ms, met |
| event-burst | budget-p95-event-burst | 15.5 ms | 2026-10-10 | 5.01 ms, met | 8.012 ms, met | 8.046 ms, met |
| context-switches | budget-p95-context-switches | 16 ms | 2026-10-10 | 4.989 ms, met | 7.997 ms, met | 10 ms, met |
| stress | budget-p95-stress | N/A: V05-06 measured no log of 200 lines and no production list of 100 items (the turn's tour and the soak's 100 turns keep the game's state small), so the stress window is judged by the relative rule alone | 2026-10-10 | 5.005 ms, n/a | 8.572 ms, n/a | 7.75 ms, n/a |

## Decision

> SYNTHETIC EXAMPLE: no decision was made. The data of this campaign were made up to exercise the analysis script, and none of them is a result of any arm.

Partial report rule applies: false.

## Limitations

> SYNTHETIC EXAMPLE: nothing was measured; there is no machine, no display and no iPhone behind these numbers.

## Reproduction

- Raw data: synthetic: no raw data
- Campaign SHA-256: `62eccb0534b33f16192da2d06eed2e474289c14377f7da893bd293725e129eed`
- Protocol SHA-256: `2319c9b6fbe39262c932c439a5642525818ea4d3e0c66f278f8039d491526f93`
- Seed: 20261009
- Resamples: 10000

**Commands**

```sh
node scripts/frontier-comparison-analysis.mjs <campaign.json> --out <report.json>
```
