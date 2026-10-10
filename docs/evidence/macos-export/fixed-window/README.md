# macOS export: fixed-window local evidence

This packet records a local Godot Fabric macOS arm64 export and an independent editable-project comparison for producer commit `29969eb0d64201a1797e6e866a2ef650b1282fde`. The FabricSurface policy from main71 (`7ef63ed`) was integrated before this host and export were produced.

The local export receipt passed. The SDK manifest records 220 source files, a clean source tree, and host SHA-256 `1333055f5ce81a8625a1d3e25cd29adeafc18018260cef5a83882f281552c773`. The export used Godot 4.7.2 and a 540×300 physical window; the React Native report measured a 1080×600 logical window at uniform scale 0.5 and font scale 1. It recorded 40 headless and 43 headed checks. The three exported PNGs are preserved under `export/captures/`.

The separate editable-project baseline used the canonical consumer harness with only a unique project name, fixed window settings, and a headed-only canvas-items scale hook. Its 40/43 check names and order passed unchanged. The three editable PNGs under `editable/captures/` are byte-identical to the corresponding export captures; the independent root review records each equality. `editable/result.json` itself only records equality values, so use `editable/root-independent-review.json` for the independent assertions.

![Export initial capture](export/captures/initial.png)

![Export updated capture](export/captures/updated.png)

![Export resized capture](export/captures/resized.png)

The native macOS test run passed 13/13 with no skips, including five copied-app/native-source controls. The local archive audit passed 280 checks. Its `editableBaselineByteIdentical: false` fields compare against an earlier archived baseline, not the current fixed-window editable run; the independent review above performs the current comparison. The source refresh ledger records 146 native source files and `engineRebuilt: false`; this packet does not claim that the export command rebuilt the engine. The SDK manifest's 220 source-file inventory and the refresh ledger are separate inventories.

Local gates also passed: contracts ran 396 Node tests (395 passed, one explicit native-template skip) and 23 Python tests; static and publication checks exited successfully. The 346-test main Node group had 345 passes and one skip; parity (7) and dashboard (43) passed. These contract gates did not run the native export; that is covered by the separate 13/13 run.

Evidence files: [export receipt](export/receipt.json), [SDK manifest](export/sdk-manifest.json), [build report](export/build-report.json), [editable result](editable/result.json), [independent editable review](editable/root-independent-review.json), [native controls](controls/report.json), [local archive audit](local-audit/audit.json), [source/public hash index](evidence-index.json), [contracts log](gates/contracts.log), [native test log](gates/native-tests.log), [static log](gates/static.log), [publication log](gates/publication.log), and [historical failures](failure-history.json). Raw source artifacts remain in ignored `build/` paths listed by the index; these copies redact worktree, home, and disposable-project paths.

## Limits and earlier failures

This is local evidence only. It does not establish hosted CI success, a second-machine or clean-system result, game-turn/soak performance, Developer ID distribution, or notarization. Signing was ad hoc.

`failure-history.json` preserves three earlier diagnostics. Hosted run 37844090577 failed because the headed image was clamped to 1024×600 against the then-current 1080×600 expectation; the fixed-window fixture addresses that geometry. A local 9fe64bb export failed the remount assertion once; its sequential 40/43 replays passed without explaining that first failure, and the app outputs were written but removed before the wrapper collected them. A local producer `609f93a` attempt failed before Godot because a generic subprocess-output scan matched a source literal printed by `diff`; the boundary was corrected in `63dde9c`. It did not reach Godot or collect runtime outputs. The later four output-storage tests exercise byte preservation and fail-closed preflight controls, not collection from that historical failure. These remain historical diagnostics, not passing controls.
