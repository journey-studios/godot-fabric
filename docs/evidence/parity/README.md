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

The comparison explicitly has `completeMobileReferences: false`: Android was
not executed locally. The Android job and final two-reference comparison require
their own successful CI run. These historical JSON files are evidence snapshots;
the live gate uses newly generated reports in `build/` and rejects stale hashes.

This proves the listed examples and their React lifecycle observations. It does
not certify the remaining RN APIs, native input/IME, all concurrent scheduling,
or Godot Fabric support on iOS/Android. Reproduction and remaining gaps are in
the [baseline](../../compatibility/BASELINE.md).
