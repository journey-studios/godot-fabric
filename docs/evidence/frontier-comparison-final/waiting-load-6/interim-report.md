# Frontier comparison: final report

Status: `incomplete`. An arm has fewer accepted executions of the presented lane than the protocol requires: no statistic is produced.

Why:

- minimum-per-arm (arm A, accepted 0, required 10)
- minimum-per-arm (arm B, accepted 0, required 10)
- minimum-per-arm (arm C, accepted 0, required 10)

Generated from a report in the format `godot-fabric.frontier-comparison-report/v1` by `scripts/frontier-comparison-report-markdown.mjs`: it formats the numbers of the report and computes none (at most three decimals, trailing zeros dropped). The per-run values and the oriented intervals stay in the report JSON.

## Provenance

| Field | Value |
| --- | --- |
| Commit | de310cf5f461dfd5ee5883c47d8517dc337b48b5 |
| Machine | Apple M3 Pro, 11 cores, 18 GB |
| System | macOS 26.6.2 (25G83) |
| Display | macOS, 3024x1964 at scale 2, window 1080x600 |
| Renderer | opengl3 (gl_compatibility) |
| Adapter | Apple M3 Pro |

### Protocol

- Protocol: `frontier-comparison-protocol`, item V05-10
- SHA-256: `153442795dea2cb70901278782c2bd5b7668cf2d9a686d313cb2f0e8819e852e`
- Amendments: 5

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
- Replay golden hash: `cb7ab974f47f18c37ae96bda57ffd1b87f8c3733e251a386040dc17ccb540e8d`
- Soak final hash: `0b21c332c1f86fb41522cdbed0144f168831f6ab51bc427769a68a146aa6afd0`
- Instrument SHA-256: `4bdcda83771c38221b3e9da47bdca2622ac4bda119d0b41809e83bceabf28c9d`

| Arm | Binary SHA-256 | Package SHA-256 | Script SHA-256 |
| --- | --- | --- | --- |
| A | `a9825bfa9754ac9ef27aea54ca0e7587e94ca07bbd2210ef52727705b343696f` | `6e0bcb203f3ad0198a5be4e52cfdded7397192adbb5959abb513dac897b85ca3` | `40b56bf258435e3bbcd2277181e9696e9a053d45054fff3612e3252aae6d9768` |
| B | `5ce2fb5e8b24c87f79ebc7d8c1a0fb01a994440f8d98b827a855714cbbcfe89d` | `83bff7bcbf282e79a5f5d079cb9be2c46fe94092011e02d60e1bbc6859cc3ffb` | `40b56bf258435e3bbcd2277181e9696e9a053d45054fff3612e3252aae6d9768` |
| C | `3f3f8b5b018dd53e86ce3379fe4e3b932cc7b047a9e160585410e0a9f33f203d` | `bbdb7b12cbea1fde3f764ecbf7a25a1faa250531518056bedb70850165c5a145` | `40b56bf258435e3bbcd2277181e9696e9a053d45054fff3612e3252aae6d9768` |

### Instrument

- Self-check passed: true; passed: true
- SHA-256: `4bdcda83771c38221b3e9da47bdca2622ac4bda119d0b41809e83bceabf28c9d`; registered SHA-256: `4bdcda83771c38221b3e9da47bdca2622ac4bda119d0b41809e83bceabf28c9d`
- Unchanged after the self-check: true

### Readings

**Vsync**

| Lane | Mode | Refresh (Hz) | Executions |
| --- | --- | --- | --- |
| presented | ENABLED | 120 | 1 |

**Load**

- Command: `sysctl vm.loadavg`
- Limit of the 1-minute average: 6
- Highest before an attempt: 5.65; after: 6.62

### Deviations from the protocol

None.

## Validity

- Attempts per slot: at most 3
- Accepted executions required per arm: 10

### Executions by lane and arm

#### Lane: presented

| Arm | Planned | Accepted | Rejected | Open | Missing | Exhausted |
| --- | --- | --- | --- | --- | --- | --- |
| A | 12 | 0 | 1 | 1 | 11 | 0 |
| B | 12 | 0 | 0 | 0 | 12 | 0 |
| C | 12 | 0 | 0 | 0 | 12 | 0 |

Balance by position in the block (positions counted from 0). Balanced: false.

| Position | A planned | A accepted | B planned | B accepted | C planned | C accepted |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 4 | 0 | 4 | 0 | 4 | 0 |
| 1 | 4 | 0 | 4 | 0 | 4 | 0 |
| 2 | 4 | 0 | 4 | 0 | 4 | 0 |

#### Lane: unlimited

| Arm | Planned | Accepted | Rejected | Open | Missing | Exhausted |
| --- | --- | --- | --- | --- | --- | --- |
| A | 12 | 0 | 0 | 0 | 12 | 0 |
| B | 12 | 0 | 0 | 0 | 12 | 0 |
| C | 12 | 0 | 0 | 0 | 12 | 0 |

Balance by position in the block (positions counted from 0). Balanced: false.

| Position | A planned | A accepted | B planned | B accepted | C planned | C accepted |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 4 | 0 | 4 | 0 | 4 | 0 |
| 1 | 4 | 0 | 4 | 0 | 4 | 0 |
| 2 | 4 | 0 | 4 | 0 | 4 | 0 |

### Stops

The campaign did not stop.

### Rejected attempts

| Lane | Slot | Arm | Slot state | Accepted attempt | Attempt | Report | Vsync | Load before | Load after | Reasons |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| presented | 1 | A | open | none | 1 | written | ENABLED at 120 Hz | 5.65 | 6.62 | load / after (value 6.62, limit 6) |

## Primary outcome

Not available: incomplete.

## Axes

Not available: incomplete.

## Cost of change

Not available: incomplete.

## Budgets

Not available: incomplete.

## Decision

_No text was recorded for this section._

Partial report rule applies: false.

## Limitations

_No text was recorded for this section._

## Reproduction

- Raw data: build/frontier-05-final/campaign-quiet-20261013
- Campaign SHA-256: `0e8731def8cdc6eb6293ac4f0902591fd935c3979b86a05b04af6fcb8e1ea440`
- Protocol SHA-256: `153442795dea2cb70901278782c2bd5b7668cf2d9a686d313cb2f0e8819e852e`
- Seed: 20261009
- Resamples: 10000

**Commands**

```sh
node scripts/frontier-comparison-analysis.mjs <campaign.json> --out <report.json>
```
