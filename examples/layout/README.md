# Measured and responsive layout

[Application](App.jsx) · [Godot scene](scene.tscn) · [Examples index](../README.md)

Change the text/font, increment state and switch paragraph width. Resize the
window to observe Yoga layout, native intrinsic measurement and line wrapping.

## Run

From the repository root after `npm run setup`:

```sh
npm run example -- layout
npm run example -- layout --headless
npm run example -- layout --capture
```

The first command opens the UI; the others validate and exit. Edit `App.jsx`,
close the window and rerun to rebuild. Reports use `build/report.json`.
Captures use `build/layout-narrow.png`, `layout-wide.png` (renderer readbacks). Retained public results
are in [evidence](../../docs/evidence/README.md).

## Contract and validation

Internal text/button wrappers. This probes measurement; it does not establish
complete RN styles, high-DPI conversion or physical-device layout parity.

Intrinsic sizes, constrained/newline/empty text, viewport resizing, measurement
callbacks and preservation of React/native identity.
The native checks additionally require the acceptance marker and reject script
errors, runtime errors, crashes and timeouts. Generated reports are local and
are overwritten by another individual check.
