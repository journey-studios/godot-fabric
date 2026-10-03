# Explicit project TSConfig and repeatable bundles

A traditional consumer's unchanged recovery assertion failed locally and in
[hosted run 37151683147](https://github.com/journey-studios/godot-fabric/actions/runs/37151683147).
The failed hosted artifact did not contain its recovered bundle bytes. The
local investigation below reproduces a concrete cause; it does not claim a
byte-for-byte explanation of the missing hosted output.

The same SDK ESM facade enters the graph through a relative import and an
absolute native-module alias from CommonJS. With inferred TSConfig discovery,
the first resolution can give the facade different strict settings. The output
then inserts or omits a `use strict` directive. The original
[esbuild parser](https://github.com/evanw/esbuild/blob/v0.25.12/internal/js_parser/js_parser.go#L16282-L16285)
uses its TypeScript strict setting for that directive.

The builder now supplies the project's `tsconfig.json` explicitly to esbuild,
matching the file already passed to TypeScript. This uses esbuild's
[documented TSConfig option](https://esbuild.github.io/api/#tsconfig), preserving
file-based inheritance. No bundle normalization, retry, or weakened hash
assertion was added. The project's supported JSX settings also apply to SDK
facades; their original RN Babel transforms and renderer remain in use.

| Executed evidence | Result |
| --- | --- |
| Real consumer graph, separate processes, `write:false` | [18 executions](diagnosis.json); all 154 inputs and transformed `onLoad` results identical |
| Inferred configuration, six processes | Two raw and final bundle hashes |
| Explicit file and raw configuration controls, six processes each | One raw/final hash per mode; both modes agree |
| Independent consumer through the actual addon/editor | [18 tooling checks](consumer-tooling.json), [40 native checks](consumer-headless.json), [40 library-consumer checks](consumer-project-library-native.json) |
| Actual selected Codegen adapter and shared host | [35 headless](adapter-headless.json), [37 graphical](adapter-graphical.json) |
| Native resize/RAF/timer stop regression | [8](adapter-reentrant-stop.json), [9](adapter-reentrant-raf.json), [9](adapter-reentrant-timer.json) checks |
| Six subsequent builds of the same selected-adapter project | [154 unchanged inputs, identical bundle and selection packet](rebuilds.json) |

The causal Node regression forces the two resolution orders, observes the
inferred mismatch, and passes the explicit configuration taken from the real
builder's parsed options. It also executes the output to prove export identity
and one bootstrap evaluation. An [isolated mutation control](mutation-control.json)
uses the historical builder without the fix: the negative control passes, and
all four positive tests fail. Its strict/JSX/inheritance controls and executed
results are retained in [verification.json](verification.json).

The consumer's offline build, failure recovery, project lockfile ownership and
SDK React identity assertions still pass. Its initial and recovered bundle
SHA-256 are both
`942d8f60d5572c4e62b7e5b3020836515dc6cce2cc7179e71d9410091fc02219`.
[Provenance](provenance.json) identifies tested source hashes, versions, host and
SDK identities, commands and the historical native-source receipt.

![Original Codegen components and core Controls in two roots](adapter-initial.png)

![Updated root with the second root preserved](adapter-updated.png)

Reproduce with the pinned private Node:

```sh
node --test tests/bundle-determinism.test.mjs
npm run test:consumer
node scripts/adapter-runtime-check.mjs --sdk <verified-SDK> --out build/<new-directory> --capture
```

This fixes the reproduced TSConfig-order problem for the tested macOS arm64
Release consumers. It does not certify all TSConfig options, nested project
configurations, Metro package resolution, arbitrary libraries, installation-path
independent hashes, other targets, or complete GF-28 acceptance. Latest hosted
acceptance is tracked separately in the dashboard; older green runs do not
certify a newer builder. GF-03/GF-26/GF-28 remain In progress.

[Separate resolution probes](resolution-gaps.json) reproduce local `paths`
alias rejection and a `moduleSuffixes` type/runtime mismatch. The generic CJS
control observed the same execution behavior for inferred and explicit strict
configuration; arbitrary-library compatibility remains unverified. These are
GF-03 follow-up discovery evidence. The later
[project-resolution slice](../project-resolution/README.md) implements local
aliases and rejects suffix divergence explicitly; complete module resolution
and arbitrary-library compatibility remain open.
