# macOS arm64 export

The first macOS export slice packages the addon host and its two required runtime frameworks into a Godot 4.7.2 Release `.app`. It uses the existing editable `consumers/minimal` fixture as its runtime oracle and publishes the requested output only after payload checks, app inspection, ad-hoc signing, and relocated 40/43-check runs succeed.

## Export a new application

After the normal source setup on macOS arm64, download the official export-template archive named by `godot.export_templates.url` in `dependencies.json`. Derive a new private template; the helper checks its locked byte count, SHA-256 and version before extracting and thinning the Release engine.

```sh
python3 scripts/macos-template.py \
  --archive .deps/godot-export-templates.tpz \
  --out build/macos-arm64-template.zip
```

Use the derived ZIP and a new application output path:

```sh
node scripts/macos-export.mjs \
  --template "$PWD/build/macos-arm64-template.zip" \
  --out "$PWD/build/macos-export/consumer.app"
```

The runner requires an explicit ZIP, records its archive/member hashes, checks the exact arm64 Release member, and binds the unsigned exported engine to those bytes. The derivation helper authenticates the official input; a separately supplied ZIP is recorded as observed input. The installed templates stay untouched. Godot 4.7.2 expects an architecture-specific member, so the helper adds the arm64 member to a private copy of the official macOS ZIP.

The runner provisions the SDK with the canonical packer, builds the temporary consumer, and runs the same payload validator used by the export hooks. External Codegen adapter selection is rejected until an adapter-capable macOS export is implemented. A null asset record is valid for an asset-free bundle; positive asset records require the exact manifest and content hashes.

The export hook adds the bundle and declared assets, then adds the Hermes and React Native dependency frameworks at `Contents/Frameworks/frameworks/`. Godot collects the single `fabric_godot.dylib` host through its GDExtension configuration. The runner checks that exported host bytes match the provisioned SDK, both frameworks match their provisioned source bytes and contain arm64, and the app has no development-machine load paths. Before signing, it verifies the known framework layouts and reconstructs flattened aliases only when they contain exactly the canonical version bytes. The official RN dependency package also places four resource bundles at the framework root: the staged-app copy moves them into `Versions/A/` and retains root aliases through `Versions/Current/`. It signs nested resource bundles before their framework. SDK and vendor inputs remain unchanged. This follows Apple’s [versioned bundle/signing requirements](https://developer.apple.com/library/archive/technotes/tn2206/).

Godot's export-plugin error message is not an abort guarantee. The runner therefore executes `export_preflight.gd` with the same shared payload validator before exporting. It refuses any existing destination, stages the app beside the requested path, signs nested frameworks and the app ad hoc, verifies signatures, relocates the app, and runs the unchanged consumer assertions before the final rename. The exact SDK manifest, build report, generated bundle, runtime reports, logs and captures remain under `build/` after project cleanup. On failure, any present report or capture from the uniquely owned consumer user-data directory is copied byte-for-byte to `runtime-failed-consumer-*` files with SHA-256 and byte-count records; missing outputs remain a normal partial failure. If retention fails, its error is recorded separately and source outputs are left in place. A rejected staged app is retained there for diagnosis. Existing output paths, including dangling symlinks, are refused.

The fixture adaptation is confined to the disposable copied project: its report and captures move from read-only `res://` to `user://`, and it prints the actual user-data directory so the runner can collect and verify the report and PNGs. After a failed check, the copy also logs the check name and both surface snapshots for diagnosis; it does not change the assertion or check inventory. The committed consumer stays unchanged. The runner compares exact check names and order against [`macos-export-checks.json`](../scripts/macos-export-checks.json), including the three headed captures.

For the bounded export fixture, the copied project fixes the physical headed window at 540×300 and keeps the 1080×600 logical canvas at a uniform 0.5 scale; resizing is disabled. Headless validation leaves Godot's default scale mode untouched. The runner requires both the exact PNG dimensions and matching RN window metrics (`1080×600`, scale `0.5`, font scale `1`) so a smaller/clipped render cannot pass by image size alone.

CI retains the verified app as `Verified.app.tar.gz`; extract it with `tar -xzf Verified.app.tar.gz` so bundle permissions and framework symlinks are preserved. Verify the extracted bundle with `codesign --verify --deep --strict --verbose=2 Verified.app`.

Ad-hoc signing is for local validation only. This slice does not establish Developer ID distribution, notarization, an iOS export, mobile-device behavior, or a second-machine replay. The observed environment is the same Mac with fresh per-application user data, rather than a clean OS user profile. The Frontier twelve-turn game replay, clean profile, second Mac/VM and physical-device criteria remain open.

## Evidence status

The [containment review delta](evidence/macos-export/containment-review/README.md)
records a subsequent clean run at `881a711`: 13/13 native tests, exact 40/43 runtime
checks and 284 independent local archive checks. The new private containment
predicate admits the app root and valid `..framework` children while rejecting
parent traversal and prefix-sharing siblings. The SDK's 220 source pins and all
three capture bytes are unchanged. This follow-up remains local evidence.

The [current executed evidence](evidence/macos-export/fixed-window/README.md)
records clean producer `29969eb0d64201a1797e6e866a2ef650b1282fde`, after integrating
main's Frontier input policy and rebuilding the addon host. The actual signed,
relocated `.app` passed 40/43 checks; all three 540×300 captures match an independently
executed editable baseline byte for byte, with RN window metrics 1080×600 at scale 0.5.
The native lane passed 13/13 without skips, the local archive audit passed 280 checks
and the independent baseline review passed 24 checks. All 220 SDK source pins match
the producer. Run `37844090577` at `7c6a4f8` failed the preceding capture-size protocol;
this local record does not establish hosted acceptance.
The packet preserves that failure and the unexplained earlier local remount failure. The later [symlink review](evidence/macos-export/symlink-review/README.md) adds six native controls and a 285-check local archive audit for physical load-path containment; hosted CI remains a separate result.
The [historical 58f5271 proof](evidence/macos-export/README.md#historical-producer-58f5271)
and its 1080×600 images remain unchanged.

Run the same lane with `MACOS_EXPORT_TEMPLATE` set to the derived ZIP:

```sh
MACOS_EXPORT_TEMPLATE="$PWD/build/macos-arm64-template.zip" npm run test:export:macos
```

Without that variable, the lightweight argument/path guards run and the actual native lane is explicitly skipped. The macOS CI job supplies it; contract CI does not establish export acceptance.
