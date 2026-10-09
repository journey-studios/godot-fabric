# Contributing

Use a feature branch and a pull request. Keep platform behavior changes bounded
and include a positive native proof plus an explicit negative case when the
contract rejects an unsupported feature. Preserve existing assertion coverage
and failure visibility.

Run setup on supported macOS arm64, then the relevant scene in headless and
graphical modes. Native tests share output files and must run sequentially.
Generated dependencies, framework binaries, logs and raw per-run reports are
never committed. Evidence keeps the curated record (README, matrix, provenance,
captures); `.gitignore` covers the report paths.

Before sending a PR, run `npm run test:contracts`, `npm run check:static` and
`npm run check:publication`. The publication scan rejects environment paths,
credential-shaped text and unrelated internal project references. It is one
check alongside manual inspection of the actual staged files and captures.

## Hosted CI

The [Contracts workflow](.github/workflows/contracts.yml) runs its short jobs on
every pull request and every push of `main`: `contracts` (the three checks
above) and the iOS and Android reference apps. The native suites take over an
hour of macOS runner time, so they run only when someone asks for them:

```sh
gh workflow run contracts.yml --ref <branch>
```

The **Run workflow** button under Actions → Contracts does the same. A
dispatched run adds five jobs:

- `native-cold-start` builds the native host from scratch with `npm run setup`,
  packs the native SDK and uploads the built workspace (`.deps`, `addons`,
  `.godot`, `node_modules` and `build`) as the `native-host` artifact, kept one
  day. It then runs `test:cold` and `parity:godot` on that cold build.
- Three suite jobs start when it ends. Each one checks out the same commit and
  restores `native-host`. A configured CMake tree cannot move, so it first
  checks that `.deps/build` was configured at this job's workspace path (GitHub's
  macOS runners use the same one for every job). It then checks that a rebuild
  of `fabric_godot` changes no byte of the host or of its receipt, and that the
  host matches
  `.deps/build/native-sdk-build.json` and this checkout's native sources. Then
  it runs its share of the suites in their original order:
  - `native-suites-runtime`: the examples, runtime, list, text, networking,
    image, modal and WebSocket suites, then the consumer lanes;
  - `native-suites-frontier`: the Frontier baseline, game, services, soak,
    turn and the CPU-time instrument's self-check;
  - `native-suites-input`: the module, focus, pointer, event, responder and
    accessibility suites.

  `test:examples` imports the project for the suites after it. The frontier
  and input jobs do not run it, so they import the project the same way first.
- `parity-comparison` compares the Godot, iOS and Android reports.

In the first dispatched run (37936787624, 2026-10-09), `native-cold-start`
took 6.5 minutes, the setup 4 of them and packing the 321 MB artifact 48
seconds. The suite jobs took 25.6 (runtime), 20.7 (frontier) and 22.4 (input)
minutes, each spending about a minute restoring the host and importing the
project. The single job they replace took 60 to 69 minutes, so the run needs
about 32 minutes when runners are free, for 75 minutes of runner time instead
of 69. That run took 63 minutes in all, because the input job waited 31
minutes for a macOS runner while other pull requests ran the old single job.

Each suite still runs alone on its runner, and its artifact keeps its name. The
hosted receipts of a slice (`scripts/hosted-receipts.mjs`) need a dispatched run
of `main` at the slice's squash commit, because a push no longer runs the
native suites.
