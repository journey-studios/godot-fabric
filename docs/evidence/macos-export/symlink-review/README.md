# macOS export symlink review

This local follow-up uses clean producer commit `5596acb1cf975ff470acf531c0843fef19706e70`. The exported app passed the native lane **14/14 with no skips**, preserving the existing 40 headless and 43 headed consumer assertions. The SDK manifest records 220 clean source pins; the host source hash remains `1333055f5ce81a8625a1d3e25cd29adeafc18018260cef5a83882f281552c773`, matching the prior fixed-window evidence. The runner and test changes are outside the SDK source inventory.

The copied-app suite passed six controls, including an app whose host `LC_RPATH` enters an in-app symlink to a private external directory. The auditor rejects that physical escape before signature verification; the target library is never executed. The independent local archive audit passed **285/285**, and the focused physical-control review passed **9/9**. Its extra symlink case verifies the actual Mach-O load command, mutated host, link and external target. Two damaged-report controls also remained rejected. The portable review passed 12 tests with one explicit native-template skip; static checks found 311 entry points and no issues. Contracts completed **397 Node tests (396 passed, one explicit native skip) and 23 Python tests passed**.

The export ran with `MACOS_EXPORT_TEMPLATE="$PWD/build/p2-native-export-producer/official-arm64-template.zip" npm run test:export:macos` from 2026-10-08T23:44:12.455Z to 2026-10-08T23:44:43.510Z. The executable reports `4.7.2.stable.official.ed1daf0bf`; the SDK manifest records Godot 4.7.2, React 19.2.3, React Native 0.87.1, Node 22.23.3 and macOS arm64.

The three current-export captures are byte-identical to the already published fixed-window captures and are linked here rather than duplicated:

![Initial exported capture](../fixed-window/export/captures/initial.png)

![Updated exported capture](../fixed-window/export/captures/updated.png)

![Resized exported capture](../fixed-window/export/captures/resized.png)

Evidence: [export receipt](export/receipt.json), [SDK manifest](export/sdk-manifest.json), [build report](export/build-report.json), [headless runtime](export/runtime-headless.json), [headed runtime](export/runtime-headed.json), [six native controls](controls/report.json), [285-check local archive audit](local-audit/audit.json), [physical symlink-control review](local-audit/physical-control-review.json), [damaged-report controls](local-audit/auditor-negative-controls.json), [pre-fix runner RED reproduction](controls/loader-symlink-red.json), [source/public hash index](evidence-index.json), [native lane log](gates/native-tests.log), [portable review log](gates/portable-review.log), [static log](gates/static.log), [contracts log](gates/contracts.log), and the [export operation logs](export/logs/).

The raw pre-fix runner reproduction against `873bbc6` is retained as historical RED evidence: both alias paths through an external symlink were accepted before the fix, while the host binary itself was unchanged. The current result is local evidence. Hosted CI/review, a second Mac or clean OS profile, Frontier replay, iPhone behavior, Developer ID distribution and notarization are not established. The physical control checks rejection before signature verification and does not load or execute the external target. Raw files remain in ignored `build/` paths listed in the index; copied text replaces the worktree, home, disposable-project and one owned symlink-fixture temporary root with the declared tokens.

The [local dashboard captures](../dashboard-symlink-local.md) show the unchanged
P2 criteria and the new review activity. They do not establish a Pages deployment.
