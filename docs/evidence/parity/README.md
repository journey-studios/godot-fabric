# core-ui-v1 evidence

Local validation used unmodified official Godot 4.7.2 on macOS arm64 and the
original RN 0.87.1 / React 19.2.3 / Hermes iOS app in Release configuration,
built with Xcode 26.2 and executed in an iOS 26.3 iPhone simulator.

The nine shared cases passed in both runtimes. The retained Godot report uses
the native window; the same cases also passed headless. Reports contain source
hashes, versions and case outcomes, without local paths, simulator identifiers,
private project data or environment logs:

- [Godot report](parity-godot.json)
- [Original iOS report](parity-ios.json)
- [Godot / iOS comparison](parity-comparison-ios.json)

The local comparison explicitly has `completeMobileReferences: false`: Android
was not executed locally.

## Original iOS and Android CI references

[CI run 36956707027](https://github.com/journey-studios/godot-fabric/actions/runs/36956707027)
passed all five jobs at source commit
[`2b48a55d913ebf7f169c8dc4dfe3e3751aad68f2`](https://github.com/journey-studios/godot-fabric/commit/2b48a55d913ebf7f169c8dc4dfe3e3751aad68f2):
source contracts, uncached native Godot installation/startup, original iOS,
original Android and the final comparison. The retained artifacts come from
that same run:

- [Godot CI report](ci/parity-godot.json), headless on macOS 15 arm64.
- [Original iOS CI report](ci/parity-ios.json), Release on an iPhone simulator
  hosted by macOS 26.
- [Original Android CI report](ci/parity-android.json), Release on an API 35
  x86_64 emulator; the build uses SDK platform 37.0, build-tools 37.0.0 and
  NDK 27.1.12297006.
- [Three-host comparison](ci/parity-comparison.json), nine matched cases with
  `completeMobileReferences: true`.

The artifacts were downloaded and compared again against the current fixture,
catalog and upstream hashes before retention. Both original mobile references
use RN's Fabric/Hermes renderer; neither imports the Godot facade. The uncached
Godot job also passed both fresh projects' React and typography assertions.

These historical JSON files are evidence snapshots; the live gate uses newly
generated reports in `build/` and rejects stale hashes. The completion flag
means both original mobile reference reports are present, not complete RN
behavioral coverage.

This proves the listed examples and their React lifecycle observations. It does
not certify the remaining RN APIs, native input/IME, all concurrent scheduling,
or Godot Fabric support on iOS/Android. Reproduction and remaining gaps are in
the [baseline](../../compatibility/BASELINE.md).
