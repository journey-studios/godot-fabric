# Native TypeScript checker migration

`npm run type-check` and the consumer builder use pinned `tsc-rs` 0.1.0,
which reports upstream TypeScript `7.1.0-dev`. The SDK uses its synchronous
API with the existing scoped module lookup. TypeScript 6.0.3 remains for
configuration, module resolution and the parity inventory. esbuild, RN Babel
and the JavaScript runtime are unchanged.

## Measured comparison

[Benchmark data](benchmark.json) records seven alternating before/after runs
after one warmup per command on an Apple M3 Pro, 18 GiB RAM, Node 22.23.3.
Each run starts a fresh process. Installation and fixture creation are excluded.
The frozen SDK checker/builder sources match base commit `afa5d875` by SHA-256.

| Stage | Before median | After median | Difference |
| --- | ---: | ---: | ---: |
| Compiler directly | 514 ms | 39 ms | 475 ms / 92% |
| Repository npm type-check | 605 ms | 131 ms | 474 ms / 78% |
| Minimal consumer checker | 668 ms | 402 ms | 266 ms / 40% |
| Minimal consumer JS build, including checker | 3,164 ms | 2,991 ms | 173 ms / 5% |

The old npm command is replayed through a private package against the same
original compiler and absolute repository configuration; the new command runs
through the current repository package. The direct compiler and SDK timings
avoid this npm wrapper difference. The full build remains dominated by bundling
and transforms; its small change is sensitive to run-to-run variation.

The old and new consumer builders produce identical JavaScript bytes, SHA-256
`e0be1c5c3301f93520656716b5a4030307cbd36a548966f72a217ecf6dfa7ca3`.
This comparison does not measure Godot startup, rendering or a native host build.

## Validation

The contract command passed its parity/dashboard checks, 280 Node tests and
13 Python tests. Static analysis and publication scanning passed. The included
relocated-consumer test passed seven checks with an empty `PATH`: successful
build and recovery, native type/syntax diagnostics, missing manifest identity,
incorrect executable hash and missing native executable. Each rejected build
preserved the last valid bundle. These tests are included in `test:contracts`.

Resolution tests exercise app/library alias collisions, missing library imports,
SDK type identity, import/require conditions, inherited JSX/strict settings,
configuration fingerprints, incremental config metadata and no emission. Native diagnostic tests also cover
UTF-16 positions, removed TS6 compiler options, duplicate binder diagnostics
and unsupported/missing/mismatched compiler packages.

The consumer fixture copies the current JS toolchain, sources, types and npm
packages. It has no native host and does not run Godot. Full native addon
provisioning and Godot acceptance remain the responsibility of hosted native CI.
