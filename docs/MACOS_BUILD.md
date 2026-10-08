# macOS arm64 export

The first macOS export slice packages the addon host and its two required runtime frameworks into a Godot 4.7.2 Release `.app`. It uses the existing editable `consumers/minimal` fixture as its runtime oracle and publishes the requested output only after payload checks, app inspection, ad-hoc signing, and relocated 40/43-check runs succeed.

## Export a new application

On macOS arm64, use a new output path:

```sh
node scripts/macos-export.mjs \
  --template /path/to/reviewed-godot-4.7.2-arm64.zip \
  --out "$PWD/build/macos-export/consumer.app"
```

The runner requires an explicit ZIP and inspects it for the exact Godot 4.7.2 arm64 Release engine member. It records the supplied archive and member hashes for that run; it does not accept an implicit template or claim that the archive is authenticated against an official download. A normal installation may contain only the universal member. The private derivation procedure and its input/tool/output hashes are recorded as local preparation evidence, while the installed template remains unchanged.

The runner provisions the SDK with the canonical packer, builds the temporary consumer, and runs the same payload validator used by the export hooks. External Codegen adapter selection is rejected until an adapter-capable macOS export is implemented. A null asset record is valid for an asset-free bundle; positive asset records require the exact manifest and content hashes.

The export hook adds the bundle and declared assets, then adds the Hermes and React Native dependency frameworks at `Contents/Frameworks/frameworks/`. Godot collects the single `fabric_godot.dylib` host through its GDExtension configuration. The runner checks that exported host bytes match the provisioned SDK, both frameworks match their provisioned source bytes and contain arm64, and the app has no development-machine load paths. It preserves framework directories and their internal symlinks.

Godot's export-plugin error message is not an abort guarantee. The runner therefore executes `export_preflight.gd` with the same shared payload validator before exporting. It refuses any existing destination, stages the app beside the requested path, signs nested frameworks and the app ad hoc, verifies signatures, relocates the app, and runs the unchanged consumer assertions before the final rename. Reports, logs, and captures live under `build/`.

The fixture adaptation is confined to the disposable copied project: its report and captures move from read-only `res://` to `user://`, and it prints the actual user-data directory so the runner can collect and verify the report and PNGs. The committed consumer stays unchanged. The runner compares exact check names and order against [`macos-export-checks.json`](../scripts/macos-export-checks.json), including the three headed captures.

Ad-hoc signing is for local validation only. This slice does not establish Developer ID distribution, notarization, an iOS export, mobile-device behavior, or a second-machine replay. Those Frontier criteria remain separate.

## Evidence status

The editable-project baseline and stock exporter observations in [`evidence/macos-export/README.md`](evidence/macos-export/README.md) are historical setup evidence. They show why the plugin must add both frameworks; they are not proof that this runner has produced or shipped an app. The implementation runner remains unexecuted pending review.
