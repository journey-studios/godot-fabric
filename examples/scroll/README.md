# Scroll, filter and edit

[Application](App.jsx) · [Godot scene](scene.tscn) · [Examples index](../README.md)

Scroll the synthetic item list, filter it, select an item and rename it. Resize
the window and use the horizontal category area.

## Run

From the repository root after `npm run setup`:

```sh
npm run example -- scroll
npm run example -- scroll --headless
npm run example -- scroll --capture
```

The first command opens the UI; the others validate and exit. Edit `App.jsx`,
close the window and rerun to rebuild. Reports use `build/report.json`.
Captures use `build/scroll-*.png` (renderer readbacks). Retained public results
are in [evidence](../../docs/evidence/README.md).

## Contract and validation

Internal controls include the LineEdit adapter. All rows mount; this is not
FlatList/VirtualizedList. It exercises a bounded ScrollView contract.

Offsets, content geometry, clipping, pointer ownership, filtering/editing,
commands, resize and visible rejection of unsupported behavior.
The native checks additionally require the acceptance marker and reject script
errors, runtime errors, crashes and timeouts. Generated reports are local and
are overwritten by another individual check.
