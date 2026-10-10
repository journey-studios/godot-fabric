# macOS export symlink-parent review

This record adds a fresh, local review of the macOS arm64 Release export on clean producer `6c2169abbe2e6f6da79f6b51d50dfa76bac1cddc`. It extends the existing V05-07 `plugin` and `assinatura` evidence; it does not close the Frontier replay, second-machine/clean-profile, or remaining V05-07 criteria.

## Result

The official Godot 4.7.2 macOS arm64 template was verified and derived again after the continuation checkout recovery. `npm run setup` passed from pinned inputs and rebuilt the native addon dependencies; Godot itself was not rebuilt. With the derived template, `npm run test:export:macos` passed all **14/14** tests with no skips. The real relocated, ad-hoc-signed `consumers/minimal` application passed **40 headless and 43 headed** runtime checks. The native control report passed all **7** copied-app controls, including `symlink-parent-rpath-target-outside-app-rejected`.

The new control creates a copied app whose `LC_RPATH` symlink resolves physically outside the app. The loader-path target is rejected before that external target is loaded or executed. A separate physical review verified the installed host's SHA-256 and Mach-O RPATH and compared all **220** SDK source pins against the producer's Git blobs. The causal fixture confirms both `@loader_path/jump/../shadow.dylib` and `@executable_path/jump/../shadow.dylib` were accepted by `0c03dd9` and are rejected by the fix in `daba1d5`.

The app, host and PCK hashes are recorded in [`execution.json`](execution.json), and the raw export receipt, build report, SDK manifest and both runtime reports are retained under `export/`. The three actual 540×300 captures are copied unchanged; their hashes match the receipt and also match the earlier `symlink-review` captures. The historical files remain untouched. Source and curated-file hashes for each retained artifact appear in [`checksums.json`](checksums.json); path roots are replaced with documented tokens in the curated text copies.

The [local dashboard capture](captures/dashboard-local.jpg) and its [metadata](dashboard-local.json) show V05-07 at 50% and the 1.0 checkpoint counts for the recorded migration JSON hash. This is a local view, not a Pages deployment receipt.

The curation-time contract gates passed before these documentation changes: parity **7/7**, dashboard and agents board **43/43**, the main contract run **399 tests (398 passed, 1 explicit native skip, 0 failed)**, and Python **23/23**. Static analysis passed with 337 entry points and no issues; publication scan passed for 2,030 files with no failures. These are local checks. They are retained as logs in `gates/`; the repository's validation is being rerun after this curation. Hosted CI, final review, and Pages publication are pending and are not inferred from these local results.

## Scope and limits

This is one local macOS arm64 run using ad-hoc signing and fresh per-application data on the same machine. It is not a clean OS profile or second-machine/VM run, does not replay Frontier's 12 turns, and does not establish iPhone behavior, Developer ID distribution, or notarization. The app SHA-256 records the published local `.app`; the app bundle itself is not duplicated in this evidence packet.

## Continuation incident

During the continuation, an external Codex app snapshot/checkout lifecycle created `refs/codex/snapshots/961a516fd89667f3516e277e0925bdfcafd9e66f` at snapshot `481f91a` and removed the checkout and ignored artifacts. The two expected tracked modifications were restored from that snapshot and compared byte-for-byte with the recovered patch (`cmp` passed). The ignored `.deps`, `build`, `node_modules`, and local evidence artifacts were lost; dependencies, native host and official export template were rebuilt or derived again for this run. Committed historical evidence was preserved. [`incident.json`](incident.json) records the event and recovery without replacing historical proof.

## Retained files

- `export/receipt.json`, `build-report.json`, `sdk-manifest.json`, `runtime-headless.json`, and `runtime-headed.json`: original run outputs with local path roots tokenized in the copies.
- `controls/report.json`, `native-independent-review.json`, `causal-review.json`, and `controls/logs/`: native controls and independent physical/cause review.
- `captures/`: the three unchanged PNG outputs.
- `gates/`: setup/build, native export, contract, static and publication logs captured for this curation.
- `checksums.json`: original source hashes and hashes of the curated copies. Screenshots have identical source and curated hashes.

Tokens used in retained text: `{WORKTREE}` for the checkout, `{HOME}` for the user's home, `{DISPOSABLE_PROJECT}` for the temporary consumer project, and `{TEMP}` for the system temporary directory.
