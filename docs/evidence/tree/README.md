# Public RN IDs and logical tree refs

This checkpoint runs the [public tree fixture](../../../examples/tree/README.md)
on macOS arm64 with official Godot 4.7.2, React 19.2.3, React Native 0.87.1,
Hermes and the Compatibility renderer. Two Fabric roots share one application
and bundle evaluation while retaining separate original RN documents.

The executed implementation is [`31d08ac`](https://github.com/journey-studios/godot-fabric/commit/31d08ac37d1fb61a80c233aada6a3cfc3549bfcc). Its
12 JS/fixture hashes and 47 unchanged native-source hashes match the recorded
working-tree inputs; native implementation remains `6e5db7b`.

## Executed evidence

| Lane | Result | What it establishes |
| --- | --- | --- |
| Headless tree | 89 assertions passed | Original node/document classes, ID lookup, logical traversal, collection snapshots, text replacement, native flattening and retirement |
| Native tree | 99 assertions passed, including eight RGBA samples | The same contracts plus actual reordered item pixels and two saved captures |

```sh
npm run example -- tree --headless
npm run example -- tree --capture
```

[checks.json](checks.json) retains assertions, native/logical geometry, collection
and RawText snapshots, root lifetime evidence and pixel samples.
[provenance.json](provenance.json) identifies the source, toolchain, unchanged
native host and captures. The existing GDExtension binary has SHA-256
`42ee5c75a70e8fc7fdee9d6144c810248abe6aa1a2f0100abd2f3383e18eac79`;
this slice changes the JS facade, types and fixtures rather than native code.
Godot is not rebuilt. These are local results; hosted CI and mobile tree
differentials require their own executed receipts.

## Negative control and regressions

[negative-control.json](negative-control.json) records the **same final
89-check fixture and unchanged native host**, with only the JS View wrapper and
base ViewConfig restored to `9089686`. The corresponding bundle differs from
the positive bundle. It exits 1 with **25 failed ID/materialization assertions**,
without a script error, crash or unexpected host error. Restoring both source
files regenerates the exact positive bundle bytes. This establishes the missing
JS contract without attributing it to a native-host change.

[regressions.json](regressions.json) records **206 Node / 13 Python tests**,
**10 native runtime tests**, **19 headless examples / 1,308 final checks** and
**17 external-adapter runs / 318 checks** against the same loaded host. The full
example suite first passed 1,304 checks; strengthening only the tree fixture
adds four independent frame assertions and its final rerun passes 89.

The first external-consumer attempt timed out during `root-remount-graphical`
after earlier headless and graphical lanes passed. There was no completed
report for that lane; the preceding lane's report was not accepted as its proof.
That failure is retained with its timeout and log hash. The capture fixture now
requests native window focus and two frames before awaiting the renderer,
with begin/end markers. A fresh independent consumer then passed all 17 lanes,
including four graphical lanes, without automatic retry. The timeout's exact
cause was not conclusively attributed. This capture preparation changes only
the test fixture; it does not change application runtime focus semantics.

## Source-backed contract

The platform View now passes through original
[View.js](https://github.com/react/react-native/blob/v0.87.1/packages/react-native/Libraries/Components/View/View.js#L76-L80),
which translates public `id` to `nativeID` and gives `id` precedence over an
explicit `nativeID`. The platform ViewConfig admits `nativeID`; narrowed public
types expose View IDs, Text `nativeID` and additional read-only node traversal
methods derived from upstream declarations. These changes use the existing
native runtime and do not require a Godot engine rebuild.

Original [ReadOnlyElement.id](https://github.com/react/react-native/blob/v0.87.1/packages/react-native/src/private/webapis/dom/nodes/ReadOnlyElement.js#L88-L92)
reads declarative canonical props through
[NodeInternals](https://github.com/react/react-native/blob/v0.87.1/packages/react-native/src/private/webapis/dom/nodes/internals/NodeInternals.js#L165-L173).
Original [document lookup](https://github.com/react/react-native/blob/v0.87.1/packages/react-native/src/private/webapis/dom/nodes/ReactNativeDocument.js#L82-L99)
passes its root tag to NativeDOM, whose
[current-revision search](https://github.com/react/react-native/blob/v0.87.1/packages/react-native/ReactCommon/react/nativemodule/dom/NativeDOM.cpp#L175-L189)
finds the native `nativeId`. These are distinct representations.

Original `setNativeProps` patches native props; it does not rewrite React's
canonical props. A temporary imperative native ID can therefore change lookup
while the public ref's `.id` retains its declarative value. The validation must
preserve this upstream distinction. Both roots execute an imperative ID update:
native lookup changes immediately while `.id` retains the fallback. The next
children-only React commit restores the declarative native ID. Original
[UIManager cloning](https://github.com/react/react-native/blob/v0.87.1/packages/react-native/ReactCommon/react/renderer/uimanager/UIManager.cpp#L111-L177)
does not merge family native overrides for an empty RawProps patch; original
[surface completion](https://github.com/react/react-native/blob/v0.87.1/packages/react-native/ReactCommon/react/renderer/uimanager/UIManager.cpp#L190-L223)
commits that resulting tree. A later changed declarative ID updates lookup and
the canonical getter. The receipt records this pinned-runtime behavior without
promising imperative ID persistence across all React commits.

## Logical tree and snapshots

The two roots execute separate owner documents, repeated IDs
across roots, precedence, missing/stale lookup and retained refs. The checks
compare original parent/sibling traversal, node type/name/value,
containment, document position and root identity before and after keyed changes
and root retirement. Fabric logical parenting is distinct from concrete Godot
Control parenting, especially for flattened Views and raw text nodes.

The pinned [ReadOnlyNode](https://github.com/react/react-native/blob/v0.87.1/packages/react-native/src/private/webapis/dom/nodes/ReadOnlyNode.js)
builds `childNodes` from all public child instances. `ReadOnlyElement.children`
filters those children to element nodes. Original
[NodeList](https://github.com/react/react-native/blob/v0.87.1/packages/react-native/src/private/webapis/dom/oldstylecollections/NodeList.js)
and [HTMLCollection](https://github.com/react/react-native/blob/v0.87.1/packages/react-native/src/private/webapis/dom/oldstylecollections/HTMLCollection.js)
store a membership snapshot at construction; retained collections must not
silently become live after reordering. Their member refs can still reflect
current props or become disconnected. `HTMLCollection.namedItem` remains the
pinned upstream unused method returning null. Retained collections keep the
initial membership/order after keyed changes; fresh getters see the current
tree. Element replacement/removal disconnects old refs and retires their lookup
authority. Declared `nativeID` materializes a View and its removal flattens that
View while its logical ref and real child remain stable.

## RawText replacement and pinned quirks

Changing the prefix string creates a new RawText ShadowNode/public ref through
the production renderer's original
[HostText completion](https://github.com/react/react-native/blob/v0.87.1/packages/react-native/Libraries/Renderer/implementations/ReactFabric-prod.js#L7127-L7154)
and [text-node creation](https://github.com/react/react-native/blob/v0.87.1/packages/react-native/Libraries/Renderer/implementations/ReactFabric-prod.js#L10341-L10358).
Immediately after the update, the retained initial prefix is disconnected and
empty; the new prefix is connected with `Updated `. The unchanged `world 🌍`
span retains its original public text object. Unicode assertions also cover
UTF-16 length and the original `substringData` behavior.

The pinned production
[public text-instance call](https://github.com/react/react-native/blob/v0.87.1/packages/react-native/Libraries/Renderer/implementations/ReactFabric-prod.js#L10580-L10593)
omits the document argument, so RawText `ownerDocument` is null. This is an
observed upstream quirk, not a synthetic Godot document binding. Later Fiber
alternates can make a retained changed-prefix object resolve current data
again; the stage snapshots preserve that behavior and do not assume permanent
disconnection after a text update.

Retirement checks three retained text objects per root: initial prefix,
updated prefix and unchanged span text. All must be disconnected with empty
`data`/`nodeValue`/`textContent`, zero length, no parent and `getRootNode() === self`.
Self containment and comparison remain true/zero as in original RN. A retired
document keeps its cached `documentElement`/element collection even though
native `childNodes` is empty and ID lookup no longer finds nodes. Root B remains
mounted after A retires, and comparisons against A's retired document are safe
and disconnected in both directions.

## Observed rendering

![Two roots with independent RN documents and duplicate item IDs](tree-initial.png)

Four frame assertions compare actual Controls with positions and sizes derived
from declared padding, header heights and row gap. Eight RGBA samples use fixed
expected slots rather than each Control’s transform. Initial pixels identify
the blue first and green second item in both roots.
The anonymous wrapper retains its original logical ref without a concrete
Control; the declared-ID View starts concrete.

![Keyed item order and text update in both retained roots](tree-updated.png)

Updated pixels follow the keyed reorder while original element refs remain
stable. The changed prefix is rendered as `Updated `, the nested span remains
mounted and removal of the otherwise invisible View's native ID flattens it.
The full lifetime sequence balances native creates/deletes, React cleanups,
tags, contacts and application scheduling resources.

## Remaining boundaries

This is a bounded read-only ref and ID slice. Browser selectors, mutable DOM
operations, event-target/pointer-capture acceptance, the full typed SDK and
cross-platform RN differentials require separate work. GF-08 remains in
progress; this receipt does not certify complete ref parity or mobile behavior.
The original
[native-foundation record](../native-foundation/README.md) retains its earlier
geometry/module proof; this record will not relabel that historical evidence.
