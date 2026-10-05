# Captured pointer geometry and the pinned RN baseline

Status: bounded native adapter behavior verified on macOS arm64. Full GF-08/GF-13 acceptance
remains open. This investigation does not approve an architecture decision.

## Two distinct numerical contracts

RN 0.87.1 explicitly calls its capture retargeting geometry incomplete. It
subtracts the target's transformed axis-aligned bounding origin from the source
pointer client coordinate. A bounding rectangle cannot invert rotation or skew;
a target in another surface also has a different root embedding.

The portable native witness runs the unchanged processor and lifetime overlay,
each compiled with its matching binding implementation/header layout. It does
not instantiate Hermes or execute the binding. Each passes 108 checks without
a geometry projection and produces identical results from real
UIManager/ShadowTrees:

| Declared case | True local point | Upstream captured offset |
| --- | --- | --- |
| Same-root translation | (15, 10) | (15, 10) |
| Rotation 90 degrees | (15, 10) | (30, 15) |
| Skew X 45 degrees | (15, 10) | (25, 10) |
| Other-root embedding | (15, 15) | (415, 115) |

These are separate assertions: the expected native affine local point comes
from declared coefficients; the observed upstream metric and offset are retained
as the baseline. The hypothetical embedding in the portable witness is not a
Godot Window or hardware test. The public Godot example proves the corrected
geometry independently; fixing this limitation does not make its offsets equal
to the incomplete pinned algorithm.

## Queue-owned native samples

`GodotPointerEvent` derives from the unchanged upstream PointerEvent. It adds
immutable native viewport position and source surface/Window/Viewport identity
only to the native shared payload. These fields are not JavaScript API fields.
The original generic EventEmitter dispatch methods preserve categories, unique
move coalescing and the payload. The by-value `onPointer*` methods would slice
these fields. A latest-point map keyed by pointer ID would conflate queued or
coalesced samples and lose the terminal sample after route retirement.

The generated UIManagerBinding callback retains the original queued payload
while the original processor copies and retargets the public event. Immediately
before JS delivery, native projection changes only `offsetPoint` for the actual
newest dispatched target. Client/page remain in the physical origin root;
screen, pointer identity, buttons, timestamp and priorities remain the original
sample. Got/lost and individually targeted hover events each use their own
current target geometry. No capture negotiation is moved into Godot or JS.

## Native and logical target geometry

The adapter validates application/root authority and matching Window/Viewport.
A materialized target supplies its current real Control transform. A connected
flattened ref has no Control; the helper resolves its family in one retained
current ShadowTree revision, locates the nearest mounted ancestor and composes
remaining logical frames, resolved affine transforms about the center and
parent content offsets. Registry locks are released before native callbacks.
A visible target never falls back to AABB origin subtraction.

The immutable viewport sample is projected against current target geometry,
including after an earlier callback moves that root. Retired or disconnected
targets cannot regain authority. Nonfinite, singular, out-of-range or 3D
geometry produces a named E_POINTER_GEOMETRY diagnostic; existing pointer
exception cleanup retires only the offending continuation and preserves other
contacts. Ordinary PointerEvents supplied by other adapters retain their
upstream behavior when no Godot sample envelope is present.

Native ScrollView content is normally materialized. A purely logical suffix
without a native content anchor uses the committed Fabric content offset; an
unpublished native scroll displacement is not certified by this slice.
Cross-window hosting remains outside the current mounting contract.

## Terminal samples and hidden targets

History belongs to one native contact; a new mouse Down starts fresh history
although the mouse hover sample survives Up. Entries contain weak target
families and the exact native point. Newer normal envelopes clear the previous
sample; terminal envelopes advance the serial while retaining prior valid
geometry. Older deliveries can neither clear nor overwrite the newest sample.
The direct helper test includes normal `3 → 2`, terminal `4 → normal 3` and
normal `5 → terminal 4`; it does not execute EventQueue coalescing.

If a Godot embedding becomes singular, terminal cancel/lost callbacks can use
only the same family's offset at that exact last valid native point. There is
no speculative coordinate fallback. Without valid history, terminal delivery
is omitted while original implicit release/contact cleanup still proceeds.
A nonterminal projection fault remains a visible diagnostic.

A connected `display:none` capture target has no painted inverse. It retains
original RN delivery and the pinned EmptyLayoutMetrics numerical behavior.
The executed hidden fixture explicitly checks offsets equal to owner-root
client coordinates. This does not advertise hidden paint or local inversion.

## Executed proof and remaining acceptance

The [curated receipt](../evidence/pointer-geometry/README.md) records 631
headless and 648 native checks, 14 pixel samples and three real Viewport PNGs.
The identical final fixture fails 55/631 checks on the saved preceding host:
54 local offsets and one exact terminal-coordinate check. It uses original
View refs/handlers, independent declared affines, capture transfer, another
shared root, flattened refs, no-hit drag, React transform updates, Godot
embedding changes, immediate density changes, singular cancellation and hidden
capture. Painting, original AABB measures, event geometry and cleanup have
separate assertions. Screenshots illustrate frames, not event ordering.

The real Hermes/binding witness passes 378 checks with original retained
RawEvent batches. It verifies immutable source envelopes, interleaved roots,
public fields, native/actual JS exceptions, temporary retention, default
priority before the first event and recovery after faults. The executed
priority-mapping flag is false. The production `std::exception` boundary is
verified; typed JSI exception RTTI across the framework remains uncertified.

Ordinary Godot input flushes work per accepted sample. Omitting frames does
not create a queued-coalescing certificate. The original generic emitter keeps
its unique/category APIs, but actual EventQueue enqueue/coalescing requires a
separate witness. Physical hardware, full responder/PanResponder, imperative
EventTarget, multi-window/scroll capture and complete mobile parity remain
open. The existing RN mobile core fixture contains no captured-pointer oracle;
a green reference job is regression evidence only. No GF item closes here.

## Primary pinned sources

- [RN capture retargeter](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/ReactCommon/react/renderer/uimanager/PointerEventsProcessor.cpp)
- [Original EventEmitter queue APIs](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/ReactCommon/react/renderer/core/EventEmitter.h)
- [Pointer categories and unique moves](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/ReactCommon/react/renderer/components/view/TouchEventEmitter.cpp)
- [Layout transforms and content offsets](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/ReactCommon/react/renderer/core/LayoutableShadowNode.cpp)
- [iOS native pointer coordinates](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/React/Fabric/RCTSurfacePointerHandler.mm)

Installed pinned sources control this investigation. Executed source hashes,
platform/mode and commands accompany the linked evidence receipt.
