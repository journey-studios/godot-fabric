# Portal pattern

```sh
npm run example -- portal-pattern
npm run example -- portal-pattern --headless
npm run example -- portal-pattern --capture
npm run test:portal-pattern
```

How an RN app draws a **non-blocking overlay** (a dropdown, a tooltip, a menu) above everything in a root when the control that opens it
sits inside a `ScrollView`, a list row or any other View that clips or forms a stacking context. It is plain React Native, written
the way an app writes it: **Context plus a host View inside every root**, installed with
`AppRegistry.setWrapperComponentProvider`. There is no `createPortal` and the SDK exports no portal: the pattern lives in
[App.jsx](App.jsx) and in this page, and the decision that put it here is in
[the overlays research note](../../docs/research/overlays-portals.md) (option c).

## RN parity comes first

The overlay contract on Godot is the one an RN app has on iOS and Android:

- `zIndex` and absolutely positioned Views inside a root, for content that stays in the tree where it is written;
- [`Modal`](../../docs/research/modal.md) (GF-18) for a blocking presentation;
- a second `FabricSurface` for content that has to leave a surface or serve several.

The pattern answers the one case those leave without a non-blocking answer: content that must **escape an `overflow` clip or a
stacking context** and still let the game, or the rest of the UI, go on being pressed.

## The pattern

```jsx
AppRegistry.setWrapperComponentProvider(() => PortalProvider);   // before any root runs; each root gets its own provider and host
```

| Piece | What it does |
| --- | --- |
| `PortalProvider` | Wraps the registered root. Holds the portal entries in state and renders the root's content followed by one `PortalHost`. |
| `PortalHost` | An absolutely positioned, full-size `View` with `pointerEvents="box-none"` and a `zIndex`, the last child of the root's View. It renders the entries. |
| `Portal` | Registers its children with the provider through Context on mount, updates them when they change and removes them on unmount. It renders nothing where it stands. |

The scenario is a card with a `ScrollView` of six rows. The third row has a **Pick** button that measures itself with
`measureInWindow`, measures the host the same way (the surface is not at the window's origin, so the two differ), and opens a
dropdown through `Portal` under the button with its right edge on the button's. The dropdown reaches past the `ScrollView`'s
bottom edge and over the card, and nothing clips it.

![The list with the dropdown closed](../../docs/evidence/portal-pattern/portal-pattern-closed.png)

**Closed.** A `ScrollView` of rows; the world behind the surface has heard no press.

![The dropdown open over the ScrollView's edge](../../docs/evidence/portal-pattern/portal-pattern-open.png)

**Open.** The dropdown is drawn by the host, above the `ScrollView` and the card, and is not clipped by either.

![After choosing](../../docs/evidence/portal-pattern/portal-pattern-chosen.png)

**After choosing.** Choosing closed the dropdown and updated the row. The amber square is where a press on the surface's empty area
went: through the `box-none` host to the Godot world, which counted it.

## What it guarantees on this host

Certified by [`npm run test:portal-pattern`](../../docs/evidence/portal-pattern/README.md): a headless probe that drives real mouse events
against actual `FabricSurface` roots in front of a Godot node that stands for the world, reads the native Controls, and an independent
oracle that derives the geometry and the routing from the layout and the host's pointer rules.

- **Placement.** The dropdown's Controls are the children of the root's host Control, not of the `ScrollView`'s content, and the host is
  the last child of the root's own Control, so Godot draws it last.
- **Clipping.** The `ScrollView`'s Control clips its content; the dropdown reaches past its rectangle and no ancestor clips any part of it.
- **Input.** An item press reaches the item. A press on a row outside the open dropdown reaches the row, and the dropdown stays open
  (there is no backdrop). The dropdown is opaque: a press on its header reaches neither the row under it nor the world. Once it is
  closed, a press where it was reaches the row under that area. A press on the root's empty area passes through the host to the world,
  with the dropdown open and closed.
- **Lifecycle.** Closing removes the portal's Controls. Unmounting a root removes its host with no Control left over, even with a portal
  open, and the other root keeps its own.
- **Per root.** Two roots have two hosts and a portal opened in one never appears in the other; state is per root.

## Known limits of the pattern

- **Context does not follow the Portal.** The `Portal`'s children render under the host, so they see the host's providers and not the
  ones around the trigger. Here the card provides an accent (`indigo`) to the trigger's subtree and the dropdown reads the default
  (`none`): the dropdown's header shows both. Pass the value as a prop, as this example does (`prop: indigo`), or provide the Context again
  inside the `Portal`'s children. The content's React ancestors are the host's too, so events bubble through the host's subtree and not the
  trigger's (the suite asserts the Context and does not assert bubbling).
- **The host has a `zIndex` for a reason.** Among the root's positioned children it sorts last, so it stays above a sibling with a
  `zIndex` of its own. And a positioned View with a `zIndex` forms a stacking context in Fabric (`ViewShadowNode.cpp`), so the portal's
  Controls are children of the host's own Control. Without it Fabric hoists them into the root's Control: still drawn last and still
  unclipped, but no longer inside the host (the `host-flattened` sabotage of the suite).
- **Per root, and inside the surface.** An overlay shared by several surfaces needs a second surface, or a store and one host per root.
  The host cannot draw outside the rectangle of its surface.
- **No dismissal on an outside press.** The host is `box-none` so that the press reaches what is under it; closing is the app's choice
  (here a choice or the **Pick** button). A full-size transparent `Pressable` under the dropdown would dismiss on an outside press and
  would block everything under it: that is a blocking overlay, and `Modal` is the supported one.
- **Not an SDK helper.** Whether the pair also becomes a helper of the SDK was not decided; until it is, copy the pattern. A portal
  library on top of it belongs to GF-27.
- **Overlapping surfaces** are a different question (V2-D10): this pattern lives inside one root.
