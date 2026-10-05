# Original View pointer events and capture

```sh
npm run example -- pointers
npm run example -- pointers --headless
npm run example -- pointers --capture
```

Two `PointerPanel` roots share one Hermes application. Validation constructs a
third panel in an independent application. Original public `View` refs receive
`onPointer*` events and call `setPointerCapture`, `hasPointerCapture` and
`releasePointerCapture`. Godot injects real mouse/touch input through
`Input.parse_input_event`; it never calls JS handlers or synthetic emitters.

The consumer API stays in JSX and the original React Native ref:

```jsx
const ref = React.useRef(null);

<View
  ref={ref}
  onPointerDown={({ nativeEvent }) => {
    ref.current.setPointerCapture(nativeEvent.pointerId);
    // hasPointerCapture now reports the pending assignment.
  }}
  onPointerMove={({ nativeEvent }) => {
    // Movement is delivered here even when the pointer is outside this View.
    console.log(nativeEvent.pointerId, nativeEvent.offsetX, nativeEvent.offsetY);
  }}
  onGotPointerCapture={({ nativeEvent }) => console.log("got", nativeEvent.pointerId)}
  onLostPointerCapture={({ nativeEvent }) => console.log("lost", nativeEvent.pointerId)}
/>
```

`hasPointerCapture(id)` queries the pending assignment immediately. Got/lost
notifications are processed at the next native pointer sample. Transfer emits
lost on the old connected owner, then got on the new connected owner before
that sample's move. Release by a different owner and inactive IDs retain the
pinned RN no-op behavior. Up/cancel releases capture through the original
processor. The fixture separates those notifications from hover and touch
events instead of assuming browser exception behavior.

The addon transports native `PointerEvent` payloads into the original RN
`PointerEventsProcessor` and preserves the TouchEvent/Pressability path. A
[generated lifetime overlay](../../scripts/rn-pointer-overlay.mjs) verifies
the SHA-256 hashes of four original RN 0.87.1 input files before generating
native adapter sources under the build directory. Downloaded `.deps` sources
remain immutable; the SDK manifest records original and generated inputs.
This compiles the addon and its native RN adapter. The Godot engine executable
and React reconciler are not rebuilt or replaced.

Declared JSX frames supply independent client, target-local and native screen
coordinate oracles. The fixture checks immediate pending capture queries,
delayed got/lost ordering, sibling transfer, repeated capture, wrong-owner
release, inactive IDs and buttons-free hover. It moves capture across the
shared sibling root and outside every surface, then exercises implicit up and
cancel release. Simultaneous touches preserve their separate identities and
one contact's cancellation preserves the other root's capture.

Retained refs cover pending/active origin removal, capture-target removal while
the physical origin survives, keyed replacement and a real React move callback
that removes its View. Disconnected targets receive no assumed lost notification.
Capture cleanup and contact cancellation are checked independently.
Cleanup drops disconnected capture targets without calling their handlers.
Removing a physical origin cancels that contact; removing only its capture
target preserves the surviving origin. Root/application retirement clears its
own state while other roots and applications keep their active contacts.
The overlay guards null newest clones and event continuations invalidated by
callbacks rather than depending on garbage collection or a global reset.

Genuine JSX move callbacks invoke registered typed Godot services to retire a
root and stop its application. These requests use the native work queue; they
are not evidence of synchronous callback retirement. The surviving root and
independent application must remain usable. Original Pressability/touch probes
guard against duplicate activation and final reports check native resources,
queued work and original active/capture/hover registries.

Optional native captures save `build/pointers-initial.png` and
`build/pointers-updated.png`, with pixel samples derived from the declared box
frames. Executed results, negative controls and publication evidence belong in
the [pointer evidence documentation](../../docs/evidence/pointers/README.md)
after validation. The public fixture passes **132 headless / 146 native checks**,
with **12 pixel samples and two captures**. Native processor fixtures pass
**144 assertions**; two unmodified-source controls reproduce expected crashes.
The isolated original JSX fault/stop fixture passes **43 checks** and preserves
six deliberate diagnostics. These are local executed proofs, not mobile parity.

![Original public View pointer roots after React replacement](../../docs/evidence/pointers/pointers-updated.png)

Imperative EventTarget flags remain off, matching the original pinned JS
defaults. Captured offsets under transforms are not certified: the original
retargeter uses an incomplete origin subtraction. These untransformed,
injected-input cases do not certify hardware devices, mobile input, overlapping
roots across applications or their z-order. Full GF-08/GF-13 parity remains
open. [Source analysis and acceptance boundaries](../../docs/research/pointer-capture-boundary.md)
retain the original removal gap and the scope of the adapter hardening.
