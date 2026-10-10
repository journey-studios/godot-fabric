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

Ad-hoc signing is for local validation only. This slice does not establish Developer ID distribution, notarization, an iOS export, mobile-device behavior, or a second-machine replay. The observed environment is the same Mac with fresh per-application user data, rather than a clean OS user profile. The Frontier game and its twelve-turn replay are exported and run by the next section; a clean OS profile, a second Mac or VM and the physical-device criteria remain open.

## Export Frontier, the game, and replay it

`--consumer civ-lite` exports `consumers/civ-lite` (Frontier, the Civilization-2-style game with a React Native HUD) instead of the minimal fixture. The default consumer is `minimal`, and its path, evidence and 40/43-check lane are the ones above, unchanged.

```sh
node scripts/macos-export.mjs --consumer civ-lite \
  --template "$PWD/build/macos-arm64-template.zip" \
  --out "$PWD/build/macos-export-civ-lite/Frontier.app"
```

The runner provisions the template as `scripts/consumer-civ-lite-check.mjs` does, then, in the disposable copy only, gives the project a name of its own (`Frontier Export <token>`, so that its user-data directory belongs to the export), turns on the texture import formats an export needs and writes the export preset. It exports the Release `.app` with the Hermes and React Native frameworks, signs it ad hoc, verifies it (`codesign --verify --deep --strict`), audits the load commands of the executable, the host and both frameworks, and requires the exported engine to be the template's arm64 Release member. The game's build report declares its HUD icons as assets, which the payload validator checks like the minimal fixture's empty record.

**The replay gate.** Godot's official Release template is built with `disable_path_overrides`: `-s` and `--main-loop` are accepted and dropped, `--path`, `--main-pack` and `--scene` abort, and `--headless`, `--rendering-driver` and the user arguments after `--` work. The replay therefore runs from the exported scene behind a user argument, as `--validate` does. `consumers/civ-lite/replay_validation.gd` is an inert node of `main.tscn` that, with `-- --validate-replay`, plays the 77 intents of `game/replay.gd` through `GameServices` (the twelve turns, each end-of-turn job awaited), hashes the canonical serialization after every intent with the game's `canon.gd`, prints the golden state hash and the trace hash, and writes its report to `user://` because `res://` is read-only in an export. It pins no hash. The pins are the ones the headless lane holds (`tests/civ-lite-game-native.test.mjs`), and the runner requires each run to reach both.

**The runs.** After signing, the runner plays the replay three times in the provisioned project (the editor binary, headless) and three times in a copy of the `.app` made in another directory (a clone of the bundle, checked byte for byte against the original and verified again after the runs), then runs the HUD's matrix once in that copy (`-- --validate-hud`: the 46 steps of the context matrix, the six panels and the seven contexts; its report goes to `user://` only when exported). Each run starts in a clean profile: the project's user-data directory, `~/Library/Application Support/Godot/app_userdata/Frontier Export <token>`, must not exist when the run starts, its path is recorded, and it is removed before the next run. A run that does not reach the pinned hashes, prints an engine or script error, or finds a profile that was not clean fails the export, and nothing is published; the receipt keeps the records of every run before it judges them.

**The limit.** The profile is the application's user-data directory on the Mac that built the app. It is not a clean macOS user, a second Mac or a virtual machine, and the receipt says so (`same Mac, fresh application user-data directory per run`): the milestone's clean-machine criterion stays open. Developer ID signing and notarization are out of scope here as well.

Run the lane with `MACOS_EXPORT_TEMPLATE` set to the derived ZIP, from a committed, clean source tree (the provisioned SDK carries its commit, and the export refuses a dirty one):

```sh
MACOS_EXPORT_TEMPLATE="$PWD/build/macos-arm64-template.zip" npm run test:export:civ-lite
```

`tests/macos-export-civ-lite.test.mjs` exports, then judges the result again with `tests/macos-export-civ-lite-oracle.mjs`, which reads the roteiro from `replay.gd`, recomputes the golden hash from the final canonical state and the trace hash from the step hashes, and checks the six profiles, the copy, the HUD report (with the HUD lane's own oracle), `codesign`, `otool` and the strings of the non-binary files of the bundle. Without the variable the lane is skipped explicitly. It is not part of `npm run test:contracts`, whose template-free half is `tests/macos-export-civ-lite-oracle.test.mjs`. The retained sabotage, `node scripts/macos-export-civ-lite-sabotage.mjs`, alters the game's seed in the disposable copy and requires all six runs to be rejected for the pinned hashes with nothing published; the template tree is hashed before and after. CI runs the lane in the `native-suites-runtime` job after the minimal export.

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

The later [symlink-parent review](evidence/macos-export/symlink-parent-review/README.md)
records a fresh local run on producer `6c2169a`: 14/14 native tests, 40/43 runtime
checks, seven copied-app controls, and a physical `LC_RPATH` symlink escape check
that rejects a target outside the app before loading it. The independent review
verified the host hash and RPATH and matched all 220 SDK pins. Its evidence is
additive; it does not establish Frontier replay, clean-profile/second-machine,
Developer ID/notarization, hosted CI, final review or Pages publication.

Run the same lane with `MACOS_EXPORT_TEMPLATE` set to the derived ZIP:

```sh
MACOS_EXPORT_TEMPLATE="$PWD/build/macos-arm64-template.zip" npm run test:export:macos
```

Without that variable, the lightweight argument/path guards run and the actual native lane is explicitly skipped. The macOS CI job supplies it; contract CI does not establish export acceptance.
