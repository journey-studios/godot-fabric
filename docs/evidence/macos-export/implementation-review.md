# P2 implementation review: payload and executed export

The root reviewer applies the thermo-nuclear code-quality skill to the Luna
implementation. The first review below covered the shared payload boundary and
thin export hooks based on `e0f0a9d2958a12b92fee0706162fe7f9e9eeac2a`.
The historical review covers producer `58f527193039222b19794960e7b662cb34c65e74`,
including main `ec831ac`. Local signing, relocation, exported runtime and negative
controls now have separate executed evidence; hosted CI and CodeRabbit remain
pending for delivery. This accepts only the minimal macOS Release slice.

## Current fixed-window delivery review

Root reviewed Luna's changes through producer
`29969eb0d64201a1797e6e866a2ef650b1282fde`, including the accepted main71 policy.
The physical-window adaptation stays in the disposable fixture: 540×300 physical,
1080×600 logical, headed-only canvas-items scaling and fixed aspect/resizing.
Canonical consumer assertions, check IDs/order and geometry tolerances are unchanged.
The runner requires actual PNG dimensions and RN window metrics together.

One shared list owns failed consumer output retention and cleanup. Before copying,
the helper rejects symlink/non-file inputs and every existing destination; exclusive
copies retain exact bytes and hashes. A retention error is recorded separately from
the original failure and leaves source outputs in place. Four storage tests cover
byte preservation and fail-closed preflight. They do not claim that the historical
pre-Godot failure exercised runtime-output retention.

Root rejected a broader fatal-output matcher and a duplicated engine version.
Generic subprocess execution now checks process errors and status; the unchanged
Godot fatal markers belong to editor/runtime boundaries. Portable controls verify
that a source literal in a diff is accepted, while genuine engine markers and wrong
process exits are rejected. The canonical PCK parser and consumer harness remain
shared. The affected code files remain below 1,000 lines.

The [current packet](fixed-window/README.md) records the executed 13/13 native lane,
40/43 exported checks, 280-check local archive audit and 24-check root comparison
against a separately executed editable project. Root independently checked every
curated source/public hash and confirmed that substitutions redact paths only.
The private baseline runner records equality values; the root review independently
asserts all three actual byte equalities. No passing replay explains the historical
remount failure. Hosted CI and the new delivery review remain pending.

CodeRabbit's subsequent containment review consolidated the three path guards
in one private `path.relative` predicate. Root itself and descendants are admitted;
the parent component and sibling paths are rejected. The public load-path test
also covers `.app/..framework`: treating every relative string that starts with
`..` as a parent escape would incorrectly reject that valid child. The helper uses
component boundaries instead. Portable checks pass without a real Godot binary;
the native-export test remains an explicit skip in that lane. These runner/test
files are outside the SDK's 220 source-pin inventory, which remains unchanged.
The [executed follow-up](containment-review/README.md) then passed 13/13 real
native tests, exact 40/43 runtime checks and 284 independent local archive checks
at clean producer `881a711`. Root also compared all 220 pins and the three new PNG
bytes with the existing exported/editable packet; all match. Hosted CI for the
final delivery remains pending.

## Historical independent review

The runner reuses the canonical consumer harness and PCK reader. Its export
hooks share one payload validator; the iOS hook retains its existing embedding
and linker behavior. Mach-O inspection distinguishes library identities from
dependency loads, resolves both required frameworks inside the app, and rejects
external runtime paths. The staged framework normalizer verifies duplicate
content before changing aliases and signs resource bundles before their parent.
Output guards reject existing paths and dangling symlinks; failures retain the
rejected app and diagnostics.

Root corrected a redundant identity wrapper and a signature-test expectation:
modifying the enclosing Info.plist is correctly rejected while checking its
executable, before reaching the outer app check. The final Luna read-only review
found no high-confidence implementation blockers. Root then independently
verified all 219 SDK source pins against producer Git blobs, the retained
manifest/report/bundle, engine/template and host bindings, exact 40/43 runtime
assertions, three captures, five controls and the final app signature.

The [18-check root report](root-independent-review.json),
[native controls](native-controls.json) and [executed summary](executed-summary.json)
record these observations. The native lane passed 7/7 without skips. The
[executed export record](README.md) defines the remaining Frontier and target
limits; the historical asset preflights below are not exported-image proof.

## Delivery-review test correction

PR75's CodeRabbit review identified that failed payload expectations used Godot
`assert()` without a reliable process exit. In the retained pre-fix control,
a forced positive-expectation failure actually returned zero and printed
`MACOS_EXPORT_PAYLOAD_PASSED: 27` alongside a script error; it did not reproduce
the proposed timeout mechanism. The Node runner already rejected that log/count,
but the probe's own success marker and exit status were misleading.

Expectation helpers now return a boolean, print a specific diagnostic and request
exit status 1 on failure; every call returns from the scenario immediately when false.
The existing 28 expectations retain their meaning. Two disposable mutated probe
copies force success and rejection expectations to fail: each must exit 1 before
its bounded 5-second process timeout, with the exact diagnostic, no script error
and no success marker. This test-only correction leaves the exported app producer
and its original observations unchanged.

## Corrected before accepting the first slice

- The first validator compared a project-relative bundle path to the builder's
  actual `res://` value. It also required integer values where Godot's JSON
  parser returns integral floats, and rejected the builder's nullable `styles`.
  These checks now follow the real builder schema and bind the selected entry
  and bundle to its report.
- A present adapter packet could pass when the report said no adapters were
  selected. Both declared selection and undeclared packets are now rejected
  explicitly in this export checkpoint.
- The first path check called an instance-only Godot API statically. The path
  walk now uses an opened `DirAccess` and rejects resolving and dangling payload
  symlinks. Asset destinations stay under the canonical `assets/` directory.
- Two negative controls initially failed for incidental reasons: the duplicate
  case had a mismatched count, and the symlink target did not exist. They now
  reach the intended boundary and assert the rejection reason.
- Copying the aggregate `frameworks` directory would make Godot synthesize a
  framework plist for that wrapper. The hook instead passes the two complete
  framework directories individually to the export API's directory target.

## Structural simplification

One addon helper owns report, bundle and asset validation. It returns one list
of validated paths and bytes, which both platform hooks pass to `add_file`.
The same helper owns the SDK files excluded from the exported payload. This
removes the duplicated iOS asset validator, repeated manifest branches and
duplicated exclusion lists. The machine preflight consumes the same result.

The macOS hook leaves host collection to the existing GDExtension exporter and
adds only the two dependency frameworks. The iOS hook preserves its Apple
framework embedding and linker flag. No native host or SDK toolchain code
changed in this slice.

## Executed validation

`node --test tests/macos-export.test.mjs` passed in both Luna's run and an
independent root run. It launches an isolated project with **28 exact payload
checks**, positive and negative CLI preflight, and an editor invocation loading
the plugin and parsing both hooks. Negative cases assert specific diagnostics.

The root also checked the helper against **real builder output**:

- The [original minimal bundle and report](actual-baseline-preflight.json) pass
  without rebuilding their bytes; this exercises `assets: null` and
  `styles: null` from the canonical builder.
- A disposable minimal fixture imports two real PNG variants through the
  private SDK builder. Its [actual preflight receipt](actual-assets-preflight.json)
  and [actual asset manifest](actual-assets-manifest.json) bind the builder's
  two emitted files, byte counts and SHA-256 values. The positive preflight
  exits 0. Removing that manifest makes the same preflight exit 1 with
  `The asset manifest is missing`; the original manifest is then restored.

[Observation hashes](implementation-observation-files.json) distinguish original
process observations from the public copies, which replace disposable project
paths with a placeholder. These runs did not export or launch an application and
do not accept any V05-07 criterion.
