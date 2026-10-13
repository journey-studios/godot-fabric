# Frontier 0.5: the Release campaign stopped by the load rule

**The final comparison remains open.** This is an actual windowed Release campaign, not a rehearsal. Its 41 attempts include 27 accepted executions and 14 load-only rejections. Slot 28 (arm A) exhausted its three attempts, so the registered rule stopped the campaign. The analysis produces **no performance statistics, budget verdict or decision about the React Native HUD** from these data.

| Presented lane | Accepted | Rejected | Required accepted |
| --- | ---: | ---: | ---: |
| A: game without HUD | 9 | 6 | 12 |
| B: native Godot HUD | 9 | 1 | 12 |
| C: React Native HUD | 9 | 7 | 12 |

The unlimited lane never started. V05-10 `execucao`, `metricas` and `relatorio`, and exits X6 and X11, cannot close on this campaign. The iPhone remains outside the macOS closure under the recorded NO-GO; none of its physical criteria is claimed as executed.

The [generated report](stopped-load-6/report.md) and [report JSON](stopped-load-6/report.json) state `stopped`. The [summary](stopped-load-6/summary.json) retains the plan and validity counts. A new complete campaign is needed; its attempts must not be mixed with this stopped cohort.

## Registration and runtime

- Export source: clean `500aac3f874d4f6f0d2e72d4e253817e9bed2811`.
- Runner/protocol at campaign start: `f984f37ec360e55a9d3f1671e1fec75613a880a7`.
- Protocol bytes: `153442795dea2cb70901278782c2bd5b7668cf2d9a686d313cb2f0e8819e852e`.
- All 150 native inputs and 42 measurement-source entries matched their receipts/manifests. [Preparation receipt](preparation.json); [export manifests](exports/summary.json).
- Godot 4.7.2 stable official, arm64 Release template derived from the official template. All four exported apps passed `codesign --verify --deep --strict`.
- Apple M3 Pro, 11 logical cores, 18 GB; macOS 26.6.2 (25G83); Compatibility/OpenGL renderer; display 3024×1964 at scale 2; game window 1080×600; effective refresh read back as 120 Hz.
- The graphical instrument probe and oracle passed before the first attempt, in the same engine and renderer. The scenario checks seed, replay/soak hashes, HUD parity, presentation, configuration and instrument identity. Every attempt is a fresh process; the order is the registered `ABC CAB BCA` repeated four times per lane.

The apps are actual official Release exports. Compiled apps and provisioned dependencies are build products, retained locally rather than committed as source evidence. The product-size export was repeated for each arm, with equal bytes in both exports; its manifests are retained here. This campaign supplies no comparative package-size verdict because the whole comparison stopped.

## Load and operational record

The original protocol's cap of 2.0 prevented any comparative attempt. Its [zero-attempt state](before-amendment/campaign-state.json) and [original protocol](before-amendment/protocol.json) are retained separately. After the user authorized execution without reaching 2.0, amendment 5 registered a finite cap of 6.0, committed and pushed **before** this campaign. The frozen performance budgets, margins, sample counts, order, seeds and statistical methods did not change.

The cap applies to the one-minute load reading before and after each process. Every before-reading was at most 5.98; the highest after-reading was 25.62. The 14 rejected attempts remain in the archive with their readings and reasons. Background work, including a QEMU VM, and disk pressure were observed on this shared Mac. A low starting load did not guarantee a valid ending load: the last attempt started at 4.98 and ended at 7.76.

The coordination board later reported concurrent native Godot, cold-start and contracts validation in another worktree around 13:00–13:20 UTC. This is a reported additional confound, not a retroactive exclusion rule: all attempts retain the protocol's original judgments. Before/after load readings cannot establish that an accepted process had no interference in between. The stopped cohort supplies no comparison result, and a new campaign needs a coordinated stable window.

Two operational pauses affected only the idle orchestrator, with no game process active. The [cache-cleanup record](stopped-load-6/cache-cleanup.json) retains the removal of three task-owned disposable inputs while preserving the measured exports and raw data. The [extra-wait record](stopped-load-6/operator-wait-slot28.json) retains a bounded wait for a quieter start before the last attempt; it resumed at 4.98. Neither pause changed the acceptance rule or any measured execution. The paused runner was resumed, the campaign exited, and the apps/Downloads window hidden or minimized for the test were restored.

The previously accepted [change-cost experiment](../frontier-change-cost/README.md) remains a separate, single observation per HUD. It supports a description, not a general productivity claim, and does not supply missing executions for this comparison. Earlier clean-profile and hosted clean-machine macOS export proofs remain separate from this local campaign.

## Raw data and reproduction

[campaign-data.tar.gz](stopped-load-6/campaign-data.tar.gz) retains 96 files, including every raw scenario JSON and log, the original campaign, operational state, graphical self-check and analysis. [archive-index.json](stopped-load-6/archive-index.json) lists every member's bytes and SHA-256; the archive was read back and every member verified before publication. No AppleDouble members or symlinks are included.

Only absolute checkout prefixes in three operational metadata files and the orchestrator's console log were replaced with `<checkout>`. [Metadata normalization](metadata-normalization.json) and [log provenance](stopped-load-6/orchestrator-log-provenance.json) retain both original and published hashes. Raw scenario reports/logs, `campaign.json` and `report.json` are byte-identical to their originals. The [original verification receipt](stopped-load-6/raw-verification-original.json) and [public verification receipt](stopped-load-6/raw-verification.json) record the same 41 raw derivations and 84 raw/self-check files; their state hashes differ only by the disclosed metadata normalization.

Run these commands from the checkout. The archived protocol makes reproduction independent of any future amendment of the active protocol.

```sh
mkdir -p /tmp/frontier-stopped-load-6
tar -xzf docs/evidence/frontier-comparison-final/stopped-load-6/campaign-data.tar.gz -C /tmp/frontier-stopped-load-6
node docs/evidence/frontier-comparison-final/verify-raw.mjs . /tmp/frontier-stopped-load-6 /tmp/frontier-raw-verification.json /tmp/frontier-stopped-load-6/protocol.json
cmp /tmp/frontier-raw-verification.json docs/evidence/frontier-comparison-final/stopped-load-6/raw-verification.json
node scripts/frontier-comparison-analysis.mjs /tmp/frontier-stopped-load-6/campaign.json --protocol /tmp/frontier-stopped-load-6/protocol.json --out /tmp/frontier-report.json
cmp /tmp/frontier-report.json docs/evidence/frontier-comparison-final/stopped-load-6/report.json
node scripts/frontier-comparison-report-markdown.mjs /tmp/frontier-report.json --protocol /tmp/frontier-stopped-load-6/protocol.json --out /tmp/frontier-report.md
cmp /tmp/frontier-report.md docs/evidence/frontier-comparison-final/stopped-load-6/report.md
```

The source that produced the exports and the runner's commit are pinned above. A future change to the analysis or window-derivation code requires using its matching source revision to reproduce these bytes. No result is inferred from exit code alone: the raw verifier rederives all reported attempts and checks their logs, and the analysis applies the registered validity rules.
