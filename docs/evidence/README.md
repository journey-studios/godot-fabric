# Initial public release validation

This record describes the initial public-source snapshot before the examples
reorganization. Its provenance hashes remain historical; they are not hashes
of today's moved source files. Subsequent [cold-start/oracle work](cold-start.md)
has separate evidence.

The [runnable examples record](examples/README.md) has fresh source hashes,
reports for the nine interactive cases and the new public counter captures.

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
commands and report filenames. The complete per-run reports are not versioned:
`npm run check` regenerates each one as `build/report.json`. Every report was
checked for scene, display mode, expected assertion count and passing results. Native runs are sequential because they share a
generated report path.

Additional release checks: 9 Node contract tests and 6 Python archive-recovery
fixtures; 4 typography Node tests (including the native line-height and rejected
attachment cases); 4 chart tests; 2 native recovery tests. Fallow reported no
unused code. The publication scan and manual source/capture review check scope
and avoid carrying environment-specific logs into the public tree.

The first hosted run exposed static analysis treating a generated test log as
an imported dependency. The test now constructs that filesystem path from the
project directory. Its native line-height check passed again, and static analysis
passed with the log absent. Runtime source and the matrix evidence are unchanged.

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
exception. The line-height run report, regenerated as
`build/line-height-report.json`, proves both span orders, empty/trailing lines and balanced native cleanup.

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
That control does not attribute the crash to Godot alone. The underlying engine root cause remains unresolved. The current runner
contains the late-extension-discovery failure by preparing the startup list
before import; [cold-start evidence](cold-start.md) records fresh native CI
checks without retries.

## Scope and remaining proof

Only the renderer's reviewed source, generic fixtures, font assets/licenses and
fresh public evidence are committed. This is a new repository history. Runtime
dependencies, build caches, native framework binaries, raw logs and unrelated
project documentation are excluded. The publication scanner has negative
fixtures for local paths, internal references and credential-shaped strings.

These initial results are local runtime evidence. The current workflow also
runs cold native Godot checks, original RN iOS/Android reference apps and
differential comparison. Mobile reference jobs do not certify Godot mobile
builds. [API limits](../API.md)
describe capabilities that still need dedicated validation.
