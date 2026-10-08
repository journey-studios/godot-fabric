# macOS arm64 export: preparation and implementation evidence

P2 of Frontier 0.5, V05-07, contributes to GF-28. The observations below establish
the starting point. They do not accept the export-plugin, signature, Frontier
replay, or second-machine criteria.

## Executed starting point

The unmodified, editable `consumers/minimal` passed **40 headless and 43 graphical
checks** on macOS arm64 with official Godot
`4.7.2.stable.official.ed1daf0bf`, using a freshly provisioned private SDK. The
[baseline receipt](editable-baseline-receipt.json) binds the SDK, bundle, build
report, engine and process observations; the
[independent root review](editable-baseline-root-review.json) checked those
bindings and the captures. The SDK producer was
`5148df64d7bbe2b44244c036fef7fe09ff8e82f9`; the subsequent squash merge
`e0f0a9d2958a12b92fee0706162fe7f9e9eeac2a` has the same Git tree.

These captures are from the **editable project**, not an exported application:

![Editable consumer: initial panels](editable-initial.png)
![Editable consumer: shared and local state updates](editable-updated.png)
![Editable consumer: resized inventory panel](editable-resized.png)

A separate stock SDK export then succeeded with CLI exit 0 and an actual arm64
executable. Its [invocation](stock-export-invocation.json),
[export log](stock-export.log), and [actual app inventory](stock-export-inventory.json)
show **one** automatically collected `fabric_godot.dylib` and **neither** required
dependency framework. The app was not launched; signing was disabled.

| Observed app path | Result |
| --- | --- |
| `Contents/Frameworks/fabric_godot.dylib` | One file; SHA-256 matches the provisioned host |
| `Contents/Frameworks/frameworks/hermesvm.framework/hermesvm` | Missing |
| `Contents/Frameworks/frameworks/ReactNativeDependencies.framework/ReactNativeDependencies` | Missing |
| `Contents/MacOS/Godot Fabric P2 Stock SDK Export` | arm64 only, executable permissions |

The host's existing `@loader_path/frameworks` runpath requires both complete
framework directories at those locations. The macOS hook must package them
without collecting a second host.

The first export attempt failed before the hooks because the project lacked
`rendering/textures/vram_compression/import_etc2_astc=true`. The
[failed invocation](stock-setup-failure-invocation.json) and
[log](stock-setup-failure.log) are retained separately. This was a setup failure,
not a negative control for the plugin. The successful attempt used a new project
copy with the texture import settings corrected.

The installed macOS template contains universal engine members. The successful
arm64 observation used a private ZIP with an additional thin arm64 Release
member derived from the original universal executable, not a rebuilt engine.
The installed ZIP was preserved. This local derivation does not establish the
download provenance of the installed archive.

[File hashes](pre-implementation-files.json) record both original observation
hashes and public-copy hashes. Public JSON replaces workstation and template
directory prefixes with named placeholders; the original files and logs remain
unchanged under the ignored local build directory. Implementation, exported
runtime, signing, and rejection evidence will be recorded separately.
