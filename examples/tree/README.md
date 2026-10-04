# Public RN IDs and read-only tree

```sh
npm run example -- tree
npm run example -- tree --headless
npm run example -- tree --capture
```

This public fixture exercises original React Native document refs, IDs and
logical tree traversal through two Fabric roots sharing one Hermes application.
It passes 89 headless and 99 native assertions on macOS arm64 with official
Godot 4.7.2 and RN 0.87.1, including eight RGBA samples and two actual captures.
The existing native host is reused; Godot is not rebuilt.

## IDs enter through React Native

The platform `View` delegates to original RN `View.js`, which maps its public
`id` prop to native `nativeID`. If both are supplied, `id` takes precedence.
The platform ViewConfig forwards `nativeID`, and the narrowed public types expose
`id`/`nativeID` on View and `nativeID` on Text.

```jsx
<View ref={panelRef} id="inventory" nativeID="ignored-fallback">
  <Text nativeID="inventory-title">Inventory</Text>
</View>
```

Read the document from an original host ref rather than assuming a browser
global:

```js
const panel = panelRef.current;
const document = panel?.ownerDocument;
const samePanel = document?.getElementById("inventory");
```

Original `ReactNativeDocument.getElementById` searches the current Fabric
revision for that root. Two roots can use the same ID without sharing a
document. Godot's scene-node names and `testID` are separate identifiers.

## Two ID representations

The read-only ref's `.id` getter reads original React's canonical current props
(`id ?? nativeID`). Native lookup reads the committed ShadowNode `nativeId`.
An imperative `setNativeProps({ nativeID: "temporary-id" })` changes the native
props used by lookup without rewriting React's declarative canonical props.
Consequently, native lookup and `.id` can intentionally disagree after an
imperative update. This fixture records the immediate native lookup change
while `.id` retains its declarative fallback. The next children-only React
commit restores that fallback in native lookup through the pinned renderer's
original cloning path. A later changed declarative ID updates both. These
observations do not promise imperative ID persistence across every re-render.

## Logical tree and retained collections

The executed checks cover parent/child and sibling navigation,
`contains`, `compareDocumentPosition`, `getRootNode`, connection state and root
isolation. `childNodes` includes raw text nodes; `children` filters to elements.
These are original Fabric logical relationships, including flattened Views,
and can differ from physical Godot Control parenting.

Pinned RN `NodeList` and `HTMLCollection` objects snapshot their members when
the getter is read. A saved collection keeps those members after a keyed React
reorder or removal; reading the getter again obtains the current order. The
member refs themselves retain their original connection and prop semantics.
`HTMLCollection.namedItem` is unused in the pinned RN implementation and returns
null; it is not an ID lookup replacement.

Keyed reordering preserves element refs while fresh traversal and native lookup
follow the new order. Duplicate IDs within a root resolve by original pre-order;
the same ID in the other root remains independent. Key replacement creates a
new ref and lookup authority; removal disconnects the old node while retained
collections keep their snapshot membership. Adding/removing `nativeID` makes an
otherwise invisible View concrete and flattens it again without replacing its
logical ref or surviving child Control.

## Raw text follows the pinned renderer

Updating `Hello ` to `Updated ` creates a new RawText node and public ref.
Immediately after that commit, the retained initial text object is disconnected
and its data is empty. The unchanged `world 🌍` span keeps its text-node identity.
Retained changed-text objects can resolve current data again through later Fiber
alternates; the fixture does not assume they remain disconnected forever.

RawText `ownerDocument` is null in this pinned production renderer because the
original public-text-instance call omits the document argument. This differs
from element refs. Retirement checks the initial, updated and unchanged span
text objects separately: all disconnect, expose empty data/value/text, lose
their parent and return themselves from `getRootNode`.

## Observed UI

![Two roots with separate RN documents and the same item ID](../../docs/evidence/tree/tree-initial.png)

Each panel starts with the blue first item before the green second item and
composed `Hello world 🌍` text. The anonymous logical wrapper has a public ref
while its real blue child occupies a flatter Godot hierarchy.

![Keyed reorder and changed text preserve root and element identity](../../docs/evidence/tree/tree-updated.png)

**Update IDs, text and item order** puts the green item before the blue item,
changes the declarative ID and replaces only the changed RawText prefix.
Headless/capture validation additionally runs key replacement, item removal,
ID fallback/imperative updates and retirement. Retiring root A leaves root B
mounted; final application stop releases both roots and scheduling resources.

## Executed evidence

Four assertions compare native frames to the declared layout; eight pixel
samples use fixed expected slots to verify the actual keyed reorder.

The [evidence record](../../docs/evidence/tree/README.md) keeps the 89/99 executed
assertions, original-instance identities, native tree checks and two captures.
It also records 25 expected failures in the previous-configuration control,
19 examples / 1,308 final checks and the independent-consumer regression. GF-08 remains in
progress. Browser selectors, mutable DOM, complete ref/event APIs and mobile
reference certification remain outside this bounded slice.
