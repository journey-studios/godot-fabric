# P2 implementation review

The root reviewer applies the thermo-nuclear code-quality skill to the Luna
implementation. This record covers the shared payload boundary and thin export
hooks on the working tree based on
`e0f0a9d2958a12b92fee0706162fe7f9e9eeac2a`. It is not approval of the complete
macOS export lane; signing, publication, exported runtime, CI and CodeRabbit
still need their own evidence.

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
