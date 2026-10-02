# Rich text and variable fonts

[Application](App.jsx) · [Godot scene](scene.tscn) · [Examples index](../README.md)

Increment child state, change fonts, reset it and resize the window. Compare
nested colored spans, regular/bold text, wrapping, clipped text and scrolling.

## Run

From the repository root after `npm run setup`:

```sh
npm run example -- typography
npm run example -- typography --headless
npm run example -- typography --capture
```

The first command opens the UI; the others validate and exit. Edit `App.jsx`,
close the window and rerun to rebuild. Reports use `build/report.json`.
Captures use `build/typography-*.png` (renderer readbacks). Retained public results
are in [evidence](../../docs/evidence/README.md).

## Contract and validation

Public rich Text/View/Pressable/ScrollView with NativeWind; internal Button
and diagnostic probes are also used. Inline attachments and full selectable/
bidi/accessibility behavior are not certified.

Distinct rendered colors/variable-font weight, wrapping/truncation, empty and
trailing lines, line heights, retained child state and balanced native cleanup.
The native checks additionally require the acceptance marker and reject script
errors, runtime errors, crashes and timeouts. Generated reports are local and
are overwritten by another individual check.
