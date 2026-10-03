# Native foundation evidence

Recorded 2026-10-03 with official Godot 4.7.2, macOS arm64, React 19.2.3,
RN 0.87.1 and Hermes 250829098.0.17. Godot was not rebuilt. Reports and PNGs
come from native Godot/Hermes execution and original production Fabric.

| Case | Execution | Scope |
| --- | --- | --- |
| Modules | 76 assertions, headless | Public registry/emitter imports, lazy identity, sync/async errors, typed/legacy events, callable order/re-registration, two runtimes and disposal |
| Refs | 23 headless / 25 graphical assertions | Original element/document identity, tree relationships, measures, zero/hidden geometry, invalid handles, imperative/declarative updates and stale refs |
| Metrics | 64 headless / 67 graphical assertions | Original DeviceInfo/Dimensions/PixelRatio, resize, local React state, reads without listeners, uniform density and Yoga rounding |
| Metrics failures | 58 assertions, headless, four fresh applications | Rejected viewport/nonuniform scaling, one visible diagnostic per application, continuing React commits and full cleanup under both teardown orders |
| External consumer | 18 build/ownership, 18 headless / 20 graphical assertions | Provisioned addon, original renderer startup in the external entry order, project-owned dependencies and cleanup |

Extra graphical checks verify capture creation. Screenshots are visual
evidence for this example, not complete differential RN certification.
[provenance.json](provenance.json) records hashes and runtime metadata;
[refs.json](refs.json), [metrics.json](metrics.json),
[metrics-errors.json](metrics-errors.json) and [native-modules.json](native-modules.json) record
individual outcomes.

![Initial scaled and rotated surfaces](refs-initial.png)

A has Godot scale 2; B rotates 90 degrees. RN window rectangles are compared
with all four actual native Control corners. measure/measureLayout retain
root/layout coordinates. Valid zero-size geometry keeps its window position;
display:none remains empty.

![Moved first root after replacement and second-root unmount](refs-updated.png)

The child receives imperative width/opacity through original Fabric commits,
retains them during unrelated rendering, then accepts a changed declarative
width. Keyed replacement gets a fresh tag; stale refs cannot mutate it.
Removing B invalidates its document while A stays connected.

![Metrics after resize, retaining React state](metrics-resized.png)

The original RN Dimensions event updates the hook and public listeners when
the Godot window changes. Local React state remains 7. Removing every
subscriber still permits fresh synchronous reads and correct hook remount.

![Metrics at uniform Godot content scale 2](metrics-scaled.png)

Uniform content scale 2 halves logical dimensions and makes Yoga round a
10.3-point View to 10.5 points. The displayed font multiplier remains 1;
OS accessibility font preferences are still pending.

Validation exposed an eager renderer export cycle, empty-layout assumptions,
retired-document comparison and unsafe numeric tag conversion. The new cases
exercise those boundaries in the native runtime. Original refs also exposed
real SourceCode/DeviceInfo startup dependencies, now using generated specs.

Both laboratory and external consumer entry orders require lazy renderer
loading; merely forwarding eager CJS exports still starts an initialization
cycle. Unsupported live window modes exposed a second issue: throwing from
metrics sampling prevented React cleanup from draining. The negative fixture
now proves the actual nonuniform transform before asserting rejection, since
a square headless window with square content remains uniform.
Callable re-registration also follows the original ReactInstance policy:
the first lazy factory or resolved module remains authoritative. A replacement
sentinel is registered before and after the first call and must never run.

The [example matrix](examples.json) records all 14 headless scenarios and
569 individual assertions. These checks cover implemented contracts and do
not replace the full differential RN suite. The independent consumer results
are recorded in [consumer.json](consumer.json).

Full GF-08/GF-09/GF-25 acceptance remains open. See the
[implemented contracts and limits](../../NATIVE_MODULES.md). The separate
[iOS checkpoint](../../IOS_BUILD.md) certifies compile/link/package only.
