# Public release validation

The source was compiled and executed independently on **macOS arm64** using
official Godot **4.7.2**, React **19.2.3**, React Native **0.87.1**, Hermes
**250829098.0.17**, NativeWind **4.2.7** and css-interop **0.2.7**.

The GDExtension and JSX bundle were built in this standalone project. Setup
verified the native archives by SHA-256. Godot itself was not rebuilt. The
[provenance](provenance.json) records public source and evidence hashes.

## Acceptance matrix

| Scene | Headless | Native |
| --- | ---: | ---: |
| React | 36 | 36 |
| Layout | 47 | 47 |
| Input | 45 | 45 |
| Pressability | 43 | 47 |
| Chart Kit | 34 | 34 |
| ScrollView | 62 | 68 |
| NativeWind | 49 | 58 |
| Typography | 50 | 63 |
| **Total** | **366** | **398** |

**764 passing assertions in 16 runs.** [matrix.json](matrix.json) contains
commands and report filenames; complete per-run reports remain beside it.
Every retained report was checked for scene, display mode, expected assertion
count and passing results. Native runs are sequential because they share a
generated report path.

Additional release checks: 9 Node contract tests and 6 Python archive-recovery
fixtures; 4 typography Node tests (including the native line-height and rejected
attachment cases); 4 chart tests; 2 native recovery tests. Fallow reported no
unused code. The publication scan and manual source/capture review check scope
and avoid carrying environment-specific logs into the public tree.

## Native captures

These images are Godot renderer readbacks of generic fixtures, not desktop
screenshots. They contain no other applications or game content.

![Initial typography](typography-initial.png)

![Clip without ellipsis](typography-clip.png)

![Font change with child state retained](typography-changed.png)

![Narrow viewport and retained child state](typography-narrow.png)

![Original Chart Kit with synthetic data](chart-initial.png)

![Chart selection and tooltip](chart-selected.png)

The typography child retains count 1 and one mount while fonts and width change.
Glyph pixels verify distinct span colors and real variable-font bold. Logical
Viewport events use validation device 1001. This does not certify physical OS
input, DPI/Retina, IME or mobile gestures.

## Line-height regression

[line-height-negative.json](line-height-negative.json) records the inclusive
run-overlap implementation failing before the fix. A 42-height first run leaked
into the next 21-height line: the measured height was 84 instead of 63. The
corrected implementation uses strict half-open overlap plus a final-run sentinel
exception. [line-height-report.json](line-height-report.json) proves both span
orders, empty/trailing lines and balanced native cleanup.

The chart test also moves the native GUI pointer to the target button before
press/release after resize. Its original missing motion caused the empty-data
assertion to fail in the graphical lane. The same assertions passed with the
complete pointer sequence; they were not removed or weakened.

## Initial import limitation

The first standalone editor import with an empty `.godot` cache logged a
**signal 11** crash after resource import. The next cached import passed, as did
the editor imports preceding the retained matrix runs. The runner still rejects
crashes; no automatic retry or suppressed native error was added.

A separate font-only control without Fabric, a GDExtension or application code
passed its cold import: [editor-import-control.json](editor-import-control.json).
That control does not attribute the crash to Godot alone. The root cause of
the initial standalone failure remains unresolved.

## Scope and remaining proof

Only the renderer's reviewed source, generic fixtures, font assets/licenses and
fresh public evidence are committed. This is a new repository history. Runtime
dependencies, build caches, native framework binaries, raw logs and unrelated
project documentation are excluded. The publication scanner has negative
fixtures for local paths, internal references and credential-shaped strings.

These are local runtime results, independent of hosted CI. The Ubuntu contract
workflow checks JS/Python/compiler contracts and publication scope; it does not
certify native macOS rendering or additional platforms. [API limits](../API.md)
describe capabilities that still need dedicated validation.
