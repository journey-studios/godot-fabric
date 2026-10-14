# Overlays and portals against React Native's public contract

Status: design note for GF-07 (slice 5), 2026-10-14, against RN 0.87.1, React 19.2.3 and Godot 4.7.2. It is source reading plus
ten tests, [`tests/overlays-portals-facts.test.mjs`](../../tests/overlays-portals-facts.test.mjs), that pin its facts in `test:contracts`.
Nothing is implemented, no native code ran, and **the choice among the options in "Options and recommendation" is open: it is
for the user to decide.** GF-07's other open slices (error cleanup, replacement cycles, pause and resume) are not touched.

## The question

GF-07's acceptance says: "Design overlays/portal needs against the actual public RN contract." A game UI draws above other
content all the time: tooltips, context menus, dropdowns, toasts, dialogs, drag previews, a HUD over the world. Three things have
to be known before anything is built: what RN's public API gives for each of them, what the Godot host gives today, and, for what
is left, whether the SDK should offer a portal. The 2026-10-13 gap notes put it in three sentences: there is no public
`createPortal`, `Modal` belongs to GF-18, and input on overlapping surfaces is not certified (V2-D10).

## How to read the evidence

Each claim carries one of four levels.

- **pinned**: asserted by the facts test against `node_modules`; an RN upgrade that changes it fails the test, and this note has
  to be read again.
- **source**: read in the pinned RN package or in this repository at the `file:line` given, not executed. In section 1 a path is
  inside `node_modules/react-native` (the 0.87.1 package) unless the text says "repository"; from section 2 on a path is the
  repository's, and one inside the RN package carries a `react-native/` prefix.
- **repo evidence**: executed by an earlier slice, linked.
- **documentation**: not verifiable from the installed sources. No portal library is a dependency of this repository, and the
  RN documentation site was not consulted (the work was offline).

## 1. What RN 0.87.1 offers publicly

### Modal

`Modal` is RN's public primitive for content above the app. `index.js:91` exports it, `types_generated/index.d.ts:37-38` types
it, and its own doc comment says "A basic way to present content above an enclosing view" (`Libraries/Modal/Modal.js:249-253`).

- **It is not a portal.** `Modal.js:363-397` renders a `RCTModalHostView` host component where the `<Modal>` element stands, and
  the modal's children are children of that host view in the same React tree. State, Context and event bubbling therefore stay
  with the call site (pinned: the host view wraps `{innerChildren}`, and the spec's native component is `ModalHostView`). The
  platform presents that content apart from the app: iOS presents a view controller from the host view's own view controller,
  `reactViewController` (`React/Fabric/Mounting/ComponentViews/Modal/RCTModalHostViewComponentView.mm:149-155` and `164-181`);
  Android creates a `Dialog` with its own window and forwards view changes into a `DialogRootViewGroup`
  (`ReactAndroid/src/main/java/com/facebook/react/views/modal/ReactModalHostView.kt:60-70` and `278-286`). That a presented
  Modal blocks the app below it is platform behavior and, here, from documentation; in the source, `_shouldSetResponder` keeps
  responder events from bubbling out of it (`Modal.js:400-403`).
- **Declared public props** (pinned, from `types_generated/Libraries/Modal/Modal.d.ts` and the Flow source, which agree):
  `ModalBaseProps` has `animationType`, `transparent`, `visible`, `onRequestClose`, `onShow`, `backdropColor` and `modalRef`;
  the iOS group has `presentationStyle`, `supportedOrientations`, `onDismiss`, `onOrientationChange` and `allowSwipeDismissal`;
  the Android group has `hardwareAccelerated`, `statusBarTranslucent` and `navigationBarTranslucent`; `ModalProps` adds
  `ViewProps`.

### zIndex and absolute positioning inside one root

`zIndex?: number` is documented as working "like the CSS `z-index` property"
(`Libraries/StyleSheet/StyleSheetTypes.js:631-643`). In Fabric's C++ (pinned):

- only views whose position is not `static` get an order index, which is their `zIndex` or 0
  (`ReactCommon/react/renderer/components/view/ConcreteViewShadowNode.h:106-111`);
- the siblings of a parent are sorted by it with a stable sort when the mounting pairs are sliced
  (`ReactCommon/react/renderer/mounting/internal/sliceChildShadowNodeViewPairs.cpp:26` and `191`);
- a positioned view that has a `zIndex` forms a stacking context
  (`ReactCommon/react/renderer/components/view/ViewShadowNode.cpp:49-50`).

So `zIndex` orders siblings inside their stacking context and does not lift a descendant out of an ancestor that forms one or
clips with `overflow`. This host runs exactly that case (repo evidence): in `examples/view/App.jsx:94-101` a child with
`zIndex: 100` inside a parent with `zIndex: 1` stays under an outside sibling with `zIndex: 2`, and rises above it when the
parent stops forming a context (`examples/view/validation.gd:256-260`, [View evidence](../evidence/view/README.md)).

RN's own overlays are built from these two things and never from a portal (source):

- the dev `AppContainer` is a root `View` with `pointerEvents="box-none"` that holds the app and, as siblings, the debugging
  overlay, the inspector and `LogBoxNotificationContainer`, the toast of warnings
  (`Libraries/ReactNative/AppContainer-dev.js:180-209`);
- the LogBox inspector runs as a second surface: `Libraries/ReactNative/AppRegistry.js:14-23` registers `LogBox` "as a
  default surface" (a no-op outside `__DEV__`) and `AppRegistryImpl.js:111` flags its root.

### createPortal

- **The package does not export it** (pinned). Not `index.js`, not `index.js.flow`, not `types_generated/index.d.ts`, and not
  among the 97 runtime names that [react-native-0.87.1.json](../compatibility/react-native-0.87.1.json) audits. React's own
  entry has no `createPortal` either: a renderer provides it.
- **Only the renderer has it** (pinned). Across `Libraries`, `src`, `types`, `types_generated` and `flow`, the only files that
  mention `createPortal` are the three Fabric builds, `Libraries/Renderer/implementations/ReactFabric-{prod,dev,profiling}.js`
  (`exports.createPortal = function (children, containerTag)`; prod `:10518`, dev `:18927`, profiling `:12321`), and 0.87.1
  ships no other renderer. RN's own contract for the renderer leaves it out: `ReactFabricType`
  (`Libraries/Renderer/shims/ReactNativeTypes.js:144-174`) lists ten members, `render` and `unmountComponentAtNode` among
  them, and no portal, and `Libraries/ReactNative/RendererImplementation.js:45-56` re-exports eight functions without it. The
  same eight are what the repository's `src/renderer-proxy.js` re-exports for the SDK (pinned).
- **Reaching it takes a deep import.** The package's `exports` map opens `./Libraries/*` with `"types": null`
  (`package.json:36-40`): the renderer resolves at run time and has no types. The SDK already imports the module (the
  repository's `src/render-application.jsx:2` and `src/app-registry.js:2`), and its bundler resolves `react-native/*` deep
  imports (`sdk/toolchain/platform-plugin.mjs:165`), so a project can import it today, unsupported and untyped. The SDK facade
  does not expose it (pinned: no `createPortal` anywhere in the repository's `src/` or `types/`).
- **Is it documented, and do RN apps use it?** The installed package documents it nowhere (no type, no doc file, no caller in
  RN's own JS), and the documentation site was not consulted. Apps cannot import it from `react-native`, RN itself never calls
  it, and the community libraries below are described as context-and-host-view libraries. There is therefore no evidence that
  RN apps rely on it; their real usage cannot be measured from installed sources.
- **What a Fabric portal does** (the renderer part is executed, with a stub `UIManager`, in the facts test; the C++ part is
  pinned text):
  - `createPortal(children, x)` stores `x` unchanged as the portal's `containerInfo`, whatever the parameter's name says;
  - at commit the reconciler gives the portal its own child list and calls `completeRoot(container.containerTag, childSet)`
    (prod `:6944-6953` and `:7657-7667`, dev `:15963-15965`). It reads `.containerTag` from the argument, while
    `render()` builds the root's container as `{publicInstance, containerTag}` (prod `:10624-10628`) and nothing public hands
    that object out. Executed: `createPortal(view, 11)` commits its children to `completeRoot(undefined, ...)`;
  - `completeRoot` ends in `UIManager::completeSurface`, which builds the new root with `.children = rootChildren`
    (`ReactCommon/react/renderer/uimanager/UIManager.cpp:191-223`, `UIManagerBinding.cpp:462-489`): it **replaces the surface's
    whole child list**. Executed with a stand-in container for the portal's own surface, `{containerTag: 1}`: the portal commits
    its children as surface 1's entire child list, and the root's commit of the same transaction replaces them; removing the
    portal commits `completeRoot(1, [])`. With `{containerTag: 2}` the portal's children become surface 2's entire child list;
  - reading, not executed against the real `UIManager`: a Fabric portal means "render this subtree as the whole content of
    another surface", not "add content next to the root's". It is not the overlay layer that RN's portal libraries want.

### What the community patterns rely on (documentation)

`@gorhom/portal`, `react-native-portalize` and the `Portal` of `react-native-paper` are described by their documentation as one
approach: a provider or host component mounted near the root of the app, and a `Portal` component that hands its children to
the host through React context or a store; the host draws them as absolutely positioned Views inside the same root, over the
rest. They are JS libraries on the public contract (View, Context, absolute position, `pointerEvents`), not users of
`createPortal`. Two properties follow from the approach, whichever library is used: the children are rendered inside the
host's subtree, so they see the host's providers, not the providers at the `Portal`'s own position, and their events bubble
through the host's subtree. None of them is installed here or certified on this host; GF-27 (selected library certification) is
where one would be.

## 2. What the Godot host offers today

### Several roots in one runtime

One `FabricApplication` owns one Hermes runtime; each `FabricSurface` is an independent React root with its own surface id (root
tags end in 1 and step by 10, `native/application_runtime.cpp:803`), its own `RootTagContext`, constraints and pointer adapter.
Local state and Context belong to a root; sharing a store is an explicit choice
(`docs/ARCHITECTURE_V2.md:136`, [shared-roots evidence](../evidence/shared-roots/README.md): 35 headless, 38 graphical and 19
negative checks). Unmounting one root leaves the others running. Surfaces are Controls of the scene tree that Godot places and
sizes. Repo evidence covers surfaces side by side; overlapping or nested roots are listed as open in
[`ROADMAP.md`](../../ROADMAP.md) ("Current position": "Overlapping/nested roots ... still require their own evidence"), in
[API.md](../API.md#shared-application-and-root-authoring) and in the shared-roots README ("Remaining gaps").

### Z-order between surfaces

- **RN's `zIndex` stops at the surface.** The host gives every mounted Control `z_index = 0` because Fabric has already
  flattened stacking contexts and sorted the mount order (`native/application_runtime.cpp:1548-1550`;
  [View evidence](../evidence/view/README.md), "Observed behavior"). A surface's content is therefore one contiguous block in
  Godot's draw order (documentation: equal `z_index` draws in tree order), and one root's content is never interleaved with
  another root's.
- **Between surfaces Godot decides** (documentation): drawing follows `CanvasItem.z_index` and then tree order, and a
  `CanvasLayer` has its own layer.
- **Pointer selection uses tree order** (source). `pointer_hit_surface` picks, among the surfaces of one viewport whose RN hit
  test finds a View at the point, the one that is greater in tree order (`Node::is_greater_than`,
  `native/application_runtime.cpp:2130-2139`); a contact that is already pressed stays with the surface that took the press
  (`:2227`). If a scene gives overlapping surfaces different `z_index` values or layers, drawing and picking can disagree. That
  is a reading of the code and has not been measured.

### Input on overlapping surfaces, and what V2-D10 says

V2-D10 (approved 2026-10-02, [ARCHITECTURE_V2.md:471-480](../ARCHITECTURE_V2.md#v2-d10)) says the host routes input among
roots, external Controls and the game with declared consumption policies; inside a root RN's responders and Pressability rule;
modals own focus and give it back; and the specification still has to define the policies for a transparent background,
keyboard and gamepad, and overlays, without the game activating twice. Its validation line asks that a click on a transparent
background reach the game when allowed, that a button and a modal not activate gameplay, and that focus cross to the right trees
and come back ([ARCHITECTURE_V2_DECISIONS.md:252-265](../ARCHITECTURE_V2_DECISIONS.md#v2-d10)).

What the host does today (source, with the repo evidence it rests on):

1. A Surface takes no pointer from Godot's GUI (`mouse_filter` IGNORE, `native/fabric_surface.cpp:17-22`). RN hears the pointer
   through each Surface's `_input` (`:157-163`), and the application routes each physical sample to one surface
   (`routed_input`, `native/application_runtime.cpp:2169`, the choice at `:2227`).
2. The application's root View is `pointerEvents="box-none"` (`src/render-application.jsx:30`), so a point on empty root area
   finds nothing in that surface and falls to what lies beneath, a lower surface or the world (`hit_test`,
   `native/application_runtime.cpp:1828-1857`).
3. In `_unhandled_input` a surface claims the event from the world when RN's hit test finds a View of that surface at the point
   (`native/fabric_surface.cpp:165-174`, `ApplicationRuntime::claims` at `:2959-2980`). This is the HUD-over-world rule, certified
   on macOS desktop and decided GO in [world-input.md](world-input.md#decision-slice-3).
4. Every root feeds the one RN responder and touch history ([shared-touches.md](shared-touches.md)).
5. A `Modal` is an exclusive Godot Window above everything: with one open, nothing below it, world or surface, hears the
   pointer ([world-input.md](world-input.md#topologies), [frontier-hud.md](frontier-hud.md)).

What is measured: one full-screen surface, two surfaces side by side, a full-screen View overlay and a `Modal`
(world-input.md, "Topologies"). What is not: overlapping surfaces, a HUD of several layers, a `CanvasLayer` before the world,
keyboard and gamepad focus across surfaces, a real touch screen (world-input.md, "Not certified"). Overlapping-surface input is
therefore uncertified, as the gap notes say.

### Modal on Godot (GF-18)

The host runs RN's original `Modal.js` and its `ModalHostView` descriptor, and presents the content as an embedded, exclusive
Godot Window, a sibling under the owning Window with only the top one exclusive ([modal.md](modal.md)). The policy for the
declared props is `src/prop-scope.mjs:252-271`: `animationType` only `none`, `presentationStyle` only `fullScreen` and
`overFullScreen`, the system-window flags and `allowSwipeDismissal` refused (`E_MODAL_*`, `native/modal_presentation.cpp`),
`onDismiss`, `onOrientationChange` and `supportedOrientations` refused as iOS-only. A Modal's Controls are children of its own
Window, not of the Surface's subtree ([frontier-hud.md](frontier-hud.md), "Reading a Modal's nodes"). GF-18's `slice`
checkpoint is done; contract, parity and targets (orientation, insets, mobile) are open.

## 3. The needs of a game UI

"Within one root" means a sibling View with `position: "absolute"`, a `zIndex` and `pointerEvents`, as RN's own overlays do.
"Second surface" means another `FabricSurface`. "Needs a portal" marks the one case no RN-public mechanism covers without
blocking: content that must escape an `overflow` clip or a stacking context of its own React tree while the rest of the UI stays
interactive.

| Need | RN-public mechanism on iOS and Android | Mapping on Godot | Gap and owner |
| --- | --- | --- | --- |
| Tooltip | No component. An absolute View shown from hover (`onPointerEnter` and `onPointerLeave`, `react-native/Libraries/Components/View/ViewPropTypes.js:92-95`; `Pressable.onHoverIn`, `react-native/Libraries/Components/Pressable/Pressable.js:98-101`) or long press, placed from `measureInWindow` (`react-native/src/private/webapis/dom/nodes/ReactNativeElement.js:214`) | Within one root. **Needs a portal** when the trigger sits in a clipping or stacking ancestor (a list row, a ScrollView). **Second surface** when it must leave the surface's rectangle. `Modal` is wrong: it is exclusive | GF-13 (hover), GF-08 (measure), GF-07 (the overlay root) |
| Context menu | No component in RN core: `ActionSheetIOS` is iOS-only. Custom: a long-press Pressable, an absolute menu and a full-root transparent Pressable to dismiss it, or a transparent `Modal` | Within one root while the menu fits the surface. `Modal` (GF-18) when it must also block the world and the other surfaces | GF-18, GF-13, GF-24 (`ActionSheetIOS` throws RN's own error on Godot) |
| Dropdown or select | RN 0.87.1 exports no picker or select. An absolute list under the trigger, or a transparent `Modal`, placed with `measureInWindow` | Within one root while no ancestor clips or isolates it (the View fixture above shows how a `zIndex` is trapped). `Modal` for a full-screen or blocking list. **Needs a portal** for the non-blocking case inside a ScrollView or list | GF-10 (clip and `zIndex`), GF-18, GF-07 |
| Toast | iOS: none. Android: `ToastAndroid` (Android-only; on Godot RN's fallback warns). Cross-platform it is a non-blocking absolute container at the root, as RN's own LogBox notification (`react-native/Libraries/ReactNative/AppContainer-dev.js:208`) | Within one root: a `box-none` sibling at the root, which `renderApplication` already provides. A toast shared by several surfaces needs one owning surface (usually the HUD). `Modal` is wrong | GF-07 (which surface owns shared overlays), GF-24 (`ToastAndroid`) |
| Dialog | `Modal` for custom content; `Alert.alert` for a native dialog (iOS `RCTAlertManager`, Android `NativeDialogManagerAndroid`, `react-native/Libraries/Alert/Alert.js:103-113`) | `Modal` (GF-18): exclusive Window, `onRequestClose` on Escape without the host dismissing it, used by the Frontier HUD. `Alert` is not in the facade, and RN's code has no branch for a third platform, so a Godot alert is an application `Modal` | GF-18 (orientation, insets, mobile), GF-23 (`Alert`) |
| Drag preview | No component. An absolute View with `pointerEvents="none"` that follows a `PanResponder` or an `Animated.ValueXY`. On a phone one root is the whole screen, so the preview can go anywhere | Within one root while the drag stays in one surface. Between surfaces or into the world: a **second surface** that holds the preview, with pointer capture across roots, which two surfaces of one application already do ([modal.md](modal.md), "Explicit capture"); not certified for overlap | GF-13 (capture, `PanResponder`), GF-19 (`Animated`), GF-07 (the overlay root) |
| HUD over world | Not an RN case. The analogue is RN UI over a native view, with a `box-none` root | A surface above the world in the scene tree, a `box-none` root, the claim rule. Certified on macOS desktop (headless and one windowed lane); open: several layers, a `CanvasLayer` before the world, touch on a phone | 0.5 milestone (V05-02), GF-13, GF-07 |

Two readings of the table. First, only the clipped or stacking case of tooltips and dropdowns needs more than the RN-public
mechanisms plus the surfaces the host already has; on iOS and Android that case is met today with a transparent `Modal` or with
a host-view library (documentation). Second, every "second surface" row runs into the same unmeasured thing: overlapping
surfaces and the policy between them.

## 4. Options and recommendation

Options (a), (b) and (c) are alternatives, though (a) and (c) combine. None is chosen here.

### (a) RN parity only

No public `createPortal` in the SDK facade. Overlays use `zIndex` and absolute Views inside a root, `Modal` for blocking
presentation, and a second `FabricSurface` for what must leave a surface or serve several.

- Pros: it is what an RN app on iOS and Android can do with 0.87.1, so code and libraries written for RN need nothing from the
  SDK. No new surface to specify, test or carry across RN upgrades. The host work it needs (Modal, surfaces) exists or is
  GF-18's.
- Cons: the clipped or stacking case has no non-blocking answer. `Modal` stops the world and the other surfaces, a second surface
  is heavy plumbing and Context does not cross roots, so game UIs with many ephemeral layers would hand-roll hosts.

### (b) Expose the renderer's `createPortal` as an SDK extension

A re-export plus types over the module the SDK already imports.

- Pros: smallest code. The portal belongs to the React tree of the component that renders it, so its Context flows. It is the
  only way to render a subtree into another surface from a deep component.
- Cons and risks, each from section 1:
  1. It is outside RN's public contract: absent from the entry, the types, the renderer contract and RN's own code. The SDK would
     own an extension across RN upgrades; the facts test flags a change but cannot repair one.
  2. Its Fabric semantics replace the target surface's whole child list. A portal into the surface it lives in is overwritten by
     the root's commit, and removing it commits an empty list; into another surface it is that surface's entire content, which
     fights the root that surface already runs.
  3. The container is not obtainable: the argument called `containerTag` is read as an object, and a number commits to
     `undefined`. The SDK would have to invent a container handle tied to a surface's lifetime and generation (V2-D02), with
     stale-handle rules.
  4. Input and geometry follow two trees at once. Events bubble in the origin's React tree (as a Modal's already do:
     [modal.md](modal.md), "Explicit capture, logical ancestry and foreign runtime proof"), while Godot's hit test,
     `measureInWindow` and the DOM projection resolve a physical embedding per surface, the class of problem Modal needed a
     retained-revision resolver for ([modal.md](modal.md), "Integration obligations").
  5. Two React roots committing to one surface tag is outside what RN exercises.

### (c) A documented portal pattern: Context plus a host View inside a root

The pattern of the community libraries, written down for this SDK. A host View (absolute fill, `pointerEvents="box-none"`)
sits at the end of a root, and a `Portal` component gives it children through Context or a store. The host can be installed
per root with `AppRegistry.setWrapperComponentProvider`, which GF-07 slice 1 exposes at parity (`docs/API.md`, "AppRegistry
members"), or by the author.

- Pros: public contract only (View, Context, absolute position, `pointerEvents`), so it is the technique RN apps use
  (documentation). It covers the clipped and stacking case without blocking, with no native work, and a fixture can certify
  it on this host.
- Cons: it is per root (`docs/ARCHITECTURE_V2.md:136`), so an overlay shared by several surfaces still needs a second surface or
  a store plus a host per root. Children render under the host's providers and bubble through its subtree. It cannot draw
  outside the surface's rectangle. If the SDK ships a helper component it becomes an extension outside RN's contract, and a
  pattern with no fixture on this host is a promise, not a contract.

### Recommendation (for the user to decide)

(a) as the SDK contract now, with (c) as the documented answer to the clipped and stacking case, to be certified by a fixture
and, through GF-27, by one portal library, instead of becoming an API. (b) is not recommended: its semantics do not match what
an overlay needs, and its container handle would be an SDK invention. What the user decides:

1. Option (a), (b), (c) or a combination, and in particular whether the SDK only documents (c) or also ships a host helper.
2. Whether a second `FabricSurface` is the sanctioned route for overlays that leave a surface or are shared by several.
3. The policy between overlapping surfaces that V2-D10 asks for: whether `z_index` and `CanvasLayer` of a surface are supported
   for input, or tree order stays the rule (see "Z-order between surfaces").

## 5. Executable facts

[`tests/overlays-portals-facts.test.mjs`](../../tests/overlays-portals-facts.test.mjs) is in `test:contracts` and needs only
Node and the installed packages. Its renderer facts run the pinned `ReactFabric-prod.js` with React 19.2.3 and a stub
`UIManager`; the others read files.

| Fact the design relies on | Assertion |
| --- | --- |
| `react-native`'s public entry has no `createPortal`; `Modal` is its overlay export | `index.js` getters, `index.js.flow`, the exports of `types_generated/index.d.ts` (parsed with TypeScript) and the 97 audited names |
| Only the three Fabric builds mention it in the package | every source under `Libraries`, `src`, `types`, `types_generated` and `flow`; the exports of each build; the renderer folder holds no other renderer |
| RN's own renderer contracts leave it out, and a deep import is untyped | `ReactFabricType`, the exports of `RendererImplementation.js`, and `exports["./Libraries/*"].types === null` |
| React's entry has no `createPortal` | `require("react")` |
| `ReactFabric-prod` exports `createPortal` beside `render`, and a portal keeps its container as given | the module is evaluated and its export list and `createPortal(child, 11)` are compared |
| A Fabric portal commits its own children through `completeRoot`, and the root commits over it | the evaluated renderer drives three renders against a recording `completeRoot` (number container, same-surface container, other-surface container) |
| The sources behind that: container read, container made, child list replaced | text of `commitHostPortalContainerChildren`, `replaceContainerChildren`, `render`, `UIManager::completeSurface` and the `completeRoot` binding |
| `zIndex` orders positioned siblings only | the style declaration and the three C++ sites in section 1 |
| The SDK facade does not expose `createPortal`, exposes `Modal`, and re-exports RN's renderer set | `src/` and `types/` scanned, `Modal` in the facade and its types, `src/renderer-proxy.js` against `RendererImplementation.js` |
| Modal's declared public props | the three prop groups from the `.d.ts` and from the Flow source, equal to each other and to the lists in section 1; `ModalProps` includes `ViewProps`; the host view wraps the children |

If an RN upgrade moves one of these, the test fails and this note has to be revisited before the fact is re-pinned.

## 6. Not certified, and who would close it

- Overlapping surfaces: which surface takes the pointer, hover across the boundary, capture, the claim over the world and the
  disagreement between `z_index` and tree order. Owner: a later GF-07 slice with a native probe and an independent oracle
  (V2-D10's policy for overlays).
- Pattern (c) on this host, with a host installed through `setWrapperComponentProvider`, and a portal library. Owner: GF-07 for
  the fixture, GF-27 for the library.
- Escaping a surface's rectangle (whether a root's overflow is drawn and targeted outside it is measured for Views, not for
  the root itself). Owner: GF-07 with GF-10.
- Drag previews across surfaces, tooltip hover across surfaces. Owner: GF-13 and GF-07.
- `Modal` orientation, insets and mobile presentation, and `Alert`. Owners: GF-18 and GF-23.
- The real documentation site's wording on `createPortal`, and the usage of the renderer's `createPortal` by apps.

## Primary references

- [Modal.js](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/Libraries/Modal/Modal.js)
- [ReactFabric-prod.js](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/Libraries/Renderer/implementations/ReactFabric-prod.js)
- [UIManager.cpp](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/ReactCommon/react/renderer/uimanager/UIManager.cpp)
- [AppContainer-dev.js](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/Libraries/ReactNative/AppContainer-dev.js)
- [AppRegistry.js](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/Libraries/ReactNative/AppRegistry.js)

The versioned source and lockfiles define this release; online documentation may evolve independently.
