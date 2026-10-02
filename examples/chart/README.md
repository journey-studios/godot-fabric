# Original React Native Chart Kit

[Application](App.jsx) · [Godot scene](scene.tscn) · [Examples index](../README.md)

Change the synthetic dataset, toggle the curve, clear the data and click a
point to show its tooltip. The library itself is the original Chart Kit v2.

## Run

From the repository root after `npm run setup`:

```sh
npm run example -- chart
npm run example -- chart --headless
npm run example -- chart --capture
```

The first command opens the UI; the others validate and exit. Edit `App.jsx`,
close the window and rerun to rebuild. Reports use `build/report.json`.
Captures use `build/chart-*.png` (renderer readbacks). Retained public results
are in [evidence](../../docs/evidence/README.md).

## Contract and validation

Internal surrounding controls with a local supported SVG subset. Full
`react-native-svg`, Reanimated and arbitrary chart-library compatibility are
not implemented.

SVG layout/paths, dataset updates, native point hit testing, selection, empty
data, unsupported behavior and lifecycle cleanup.
The native checks additionally require the acceptance marker and reject script
errors, runtime errors, crashes and timeouts. Generated reports are local and
are overwritten by another individual check.
