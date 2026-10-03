# Original Codegen generation and C++ compilation checkpoint

This bounded GF-26 slice uses the original **React Native Codegen 0.87.1**
TypeScript/Flow parsers and generators. The public Probe/Badge specs generate
12 C++/ViewConfig artifacts. The [implementation guide](../../CODEGEN.md) and
[fixtures](../../../tests/codegen/README.md) describe the supported profile.

The [provenance](provenance.json) records the checkpoint's parent commit,
uncommitted source hashes at execution, and retained report hashes. Those source
bytes are included in the implementation commit; subsequent dashboard-only
main integrations do not relabel the earlier native evidence.

| Executed check | Result | Evidence |
| --- | --- | --- |
| Original TS/Flow generation and verification | 20/20 Node tests, no skips | [validation.json](validation.json) |
| Generated component C++ and concrete TurboModule bridging | 6/6 translation units compiled | [native-compile.json](native-compile.json) |
| Existing output / outside-build runner rejection | Both exit 2; prior report preserved | [validation.json](validation.json) |
| Integrated contracts before the latest dashboard integration | 74 Node, 10 Python; types pass | [validation.json](validation.json) |
| Contracts after integrating the data-ref publication workflow | 75 Node, 10 Python; types, dashboard check/eight tests/build, static/publication pass | [validation.json](validation.json) |

The C++ witness ran on **macOS arm64 Release**, minimum OS 13.0, C++20,
Apple clang 17.0.0 (`clang-1700.6.3.2`), macOS SDK 26.2, against the existing
RN 0.87.1/Hermes 250829098.0.17 native build. Five component translation units
and a concrete module instantiate generated sync methods, typed Promise
bridging and the result event emitter. Input/artifact hashes are checked again
after compilation. No Godot engine or export template was rebuilt.

The generation manifest's native-combination declaration uses synthetic fixture
hashes and declares a different test target. It is deliberately **not attested**
by the macOS compilation. [generated-manifest.json](generated-manifest.json)
keeps its runtime/ABI claims false; the separate compilation receipt identifies
the actual compiler and target. Native header trees have not been exhaustively
hashed or ABI certified.

The tests cover modified/missing/extra artifacts, source/schema drift,
unsupported fields, naming collisions, tool/parser changes, actual nested npm
parser resolution, and CLI execution through a realpath alias. They preserve
the previous output on rejection. Original upstream generators are unchanged.

## Reproduce

After laboratory setup, use a fresh output directory:

```sh
npm run test:codegen
python3 scripts/codegen-native-compile.py --out build/codegen-native-proof
```

The runner retains schema, manifest, objects, harness and per-stage logs under
that directory. Its first attempt overconstrained an unused include directory
from the existing CMake flags and failed before compilation; the corrected
runner preserves those flags and records include-directory existence. Both
attempts remain in local build outputs. Raw build logs and objects are excluded
from the public tree; curated receipts retain their hashes.

## Remaining acceptance

This slice does not link/load an adapter, render the Badge, execute its module
in Hermes, or certify an ABI/export combination. A provider/view factory,
safe external props/events/commands, lifetime checks, pre-bundle spec processing
and independent consumer/export proofs remain required. No screenshot is
included because this fixture has not rendered a Godot component.

GF-26 remains **In progress** in the [roadmap](../../../ROADMAP.md). Hosted CI
is tracked separately from these local results.
