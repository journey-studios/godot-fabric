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

Use synthetic/generic fixture data. Evidence must identify the measured source,
platform and runtime versions, distinguish runtime proof from CI status, and
avoid local paths, private URLs or unrelated application definitions.
