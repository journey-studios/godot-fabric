# Shared SDK and external registry checkpoint

This GF-26 foundation packages the built native host and links an independent
C++ registry client against a relocated copy of that SDK. Original generated
component descriptors are compiled with the packaged headers. Godot/RN archives
are not linked into the client. The client executes **11 cases / 207 checks**
without constructing a Godot Control or Hermes VM.

| Executed acceptance | Result | Record |
| --- | --- | --- |
| Read-only adapter preflight | 22/22 Node tests | [validation.json](validation.json) |
| SDK receipt/packaging negative cases | 14/14 Node tests | [validation.json](validation.json) |
| Frozen-input native build, package and verify | Passed | [package.json](package.json), [provenance.json](provenance.json) |
| Relocated SDK, original generated C++, strict shared link | Passed | [registry.json](registry.json) |
| Registry rollback, selection, lazy install and cleanup | 11 cases / 207 checks | [registry.json](registry.json) |
| Contract/type/Python gates | 111 Node + 13 Python, zero failure/skip; types passed | [validation.json](validation.json) |
| Actual Godot regression suites | Cold start; runtime 2, application 4, modules 2, services 2 tests | [validation.json](validation.json) |
| Existing native examples / consumer | 15 examples, 605 checks; 18 consumer tooling + 40 native checks | [validation.json](validation.json) |

Executed on macOS arm64, Release, minimum OS 13.0, Node 22.23.3, Apple clang
17.0.0 (`clang-1700.6.3.2`), original RN 0.87.1/Hermes 250829098.0.17 and official
Godot `4.7.2.stable.official.ed1daf0bf`. The [package record](package.json) retains
the actual native combination, host/framework hashes and header/source tree
identities. The [provenance](provenance.json) identifies the pre-commit parent
and every consumed local native source; the working tree was dirty during the
build. Curated reports retain raw receipt/log digests; binaries and raw logs
stay under ignored `build/` and the native CI artifact.

The C++ test exercises the real generated CodegenBadge provider and actual RN
RuntimeScheduler/TurboModuleRegistry. Its executor fails if JS runtime access is
attempted. Factory counters remain **zero**. Selection rejects invalid/core/
duplicate names and handles before invoking an initializer. A failing or
incomplete initializer removes only its state and permits a valid retry.
Cleanup cannot re-enter component/module registration, begin either a same-ID
or another initializer, seal or stop the registry while rollback is in progress.
Earlier registrations survive. Lazy installation, stopped lookup and
exactly-once cleanup—including a throwing disposer—are exercised.

Reproduce from a fresh prepared macOS arm64 Release build:

```sh
npm run test:adapters
npm run sdk:native:pack -- --build-dir .deps/build --out build/native-sdk-proof
npm run sdk:native:verify -- --sdk build/native-sdk-proof
npm run test:adapters:native -- --sdk build/native-sdk-proof --out build/adapter-registry-proof
```

Use CMake's selected Node for SDK packaging. The runner verifies both original
and relocated packages, copied runtime files, source files and the executable
before/after execution. It retains CMake/link/dependency/registry logs and fails
on missing markers, malformed counters, source drift or unsuccessful stages.
Its link imports `fabric_godot`, Hermes and RN dependency shared binaries with
relative deployment RPATHs; it does not compile another binding archive.

The [hosted run 37147754831](https://github.com/journey-studios/godot-fabric/actions/runs/37147754831) passed all five jobs at
`7a67f9698a7251ecc06c2a612f55550796438f8b`. The downloaded original SDK artifact confirms package/verify,
relocated strict client linking and the same **11 cases / 207 checks**.
[hosted-ci.json](hosted-ci.json) records native source, host/compiler and report
hashes. Actual CI Node is **22.23.2** and Apple clang is **17.0.0
(clang-1700.0.13.5)**; local Node/compiler identity remains separate.
Reference iOS/Android jobs validate original RN apps, not the Godot ports.
These hosted SDK results do not certify the historical iOS binaries.

No runtime adapter loader, external mount/update/command/event path or initialized
binding identity in Godot is proved here. The factory stop guard and already
extracted module methods still need real-VM lifecycle cases. Complete ABI,
export packaging, public JSX integration and other-platform SDKs remain open.
There is no screenshot because this fixture does not render an external view.
See [native extension contracts](../../NATIVE_EXTENSIONS.md) and the full
[GF-26/GF-28/GF-31 acceptance](../../../ROADMAP.md).
