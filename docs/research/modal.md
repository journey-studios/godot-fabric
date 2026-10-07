# Modal: native host decision and verification boundaries

Investigation on 2026-10-07 for RN 0.87.1 and Godot 4.7.2-stable, before product
integration. GF-18 remains planned; no checkpoint is completed by this study.

## Physical ownership

Use sibling embedded Godot Windows owned by their common host Window, with only
the top presented Modal exclusive. Logical RN nesting remains in the ShadowTree.
The physical Window tree need not mirror it. A Window-owned presentation stack
can arbitrate multiple applications without reparenting a foreign top Modal when
a lower application's owner stops.

The parent-wide input helper was rejected. In Godot's original
[Viewport input dispatch](https://github.com/godotengine/godot/blob/4.7.2-stable/scene/main/viewport.cpp),
marking input handled before GUI dispatch also suppresses Button and LineEdit
GUI in that Window. Embedded subwindows receive forwarding before the parent's
input/GUI path, allowing stock exclusive routing to do the work.

An independent desktop reexecution of the isolated GUI fixture passed 56
observations. It exercised actual Button and LineEdit controls with injected
mouse/key events, two background application Controls, bounds outside small
roots, top-only input and a full-window Modal. Freeing the lower sibling kept
the top Window, Button and LineEdit identities, focus, text and visibility
transition count. The top continued accepting clicks and text. A separate
embedded Window remained interactive while a Modal was presented.

Physical nesting followed by reparenting was also tested: identities and text
survived but LineEdit focus was lost. Keeping sibling Windows avoids that
operation in the tested case. A background grab_focus probe made both embedded
Viewports report focused LineEdits, while injected keys still reached only the
exclusive top. Control focus flags alone therefore cannot identify keyboard
authority; RN background focus commands and events need product proof.

The final investigation source SHA-256 was
`0923fa4c1f0cf1f5a091c483164a761c8c7dc52f53b0a42e928dc728a66bd4d7`;
the independently rerun log SHA-256 was
`debc1f53b96db3b4e262d42aede852ecd7cc603e49a8520d16f495ea1a72bdd7`.
These identify local ignored investigation inputs, not a committed production
Modal fixture. No OS hardware input, separate OS top-level, mobile, export or
React Native integration is certified by these observations.

## Original descriptor and metrics

The pinned [Modal renderer sources](https://github.com/facebook/react-native/tree/v0.87.1/packages/react-native/ReactCommon/react/renderer/components/modal)
provide ShadowNode, State, event emitter and descriptor behavior. Compose with
the final upstream descriptor, overriding initial State from the host Window
metrics and delegating upstream adoption. Do not copy RN cloning or layout.
Portable compilation needs only ModalHostViewShadowNode.cpp and the cxx
ModalHostViewUtils.cpp in addition to the existing core archive. The five extra
core/debug objects used in an initial spike were removed after symbol inspection
and an independent release-mode link/run.

Root independently tested an actual 320x240 RN Root containing an 800x600 Modal.
Canonical State/child/Root clones changed the Modal to 1024x768 while the Root
stayed 320x240. The original family and RootNodeKind traits survived. This proves
the isolated C++ layout behavior; initial JS onLayout, asynchronous UIManager
resize, native mounting and presentation still need integrated execution.
Each runtime already owns one host Window. A surface-to-Window metrics map would
duplicate that invariant. Window resize must update Modal State even when the
FabricSurface's own dimensions remain unchanged.

## Integration obligations

Resolve physical embedding by target family against a retained current RN tree
revision, including its actual physical Viewport. SurfaceId alone cannot select
a nested Modal Window. Use the canonical resolver for DOM projection, pointer
geometry and physical input authority. RootNodeKind limits geometry ancestry;
it does not authorize truncating RN bubbling, responder, Fiber or ref paths.

measureInWindow, page, screen and target offset use different origins/transforms.
Validate them with nonzero host origins, density/scaling and transforms inside
versus outside the geometry boundary. Preserve source Window/Viewport guards,
capture cancellation, callback lifetime and stale-reference rejection.

Use original Modal and SafeAreaView JS exports without changing Platform.OS.
The pinned non-iOS SafeAreaView default is View; that is not mobile inset proof.
The first product slice should cover none animation, full-screen/transparent
presentation, onShow, top-only onRequestClose without automatic dismissal,
keyboard controls, nested dialogs and abrupt owner teardown. Reject unsupported
props or nonembedded host modes explicitly before presentation. GF-18's full
orientation/insets, reference parity and exported mobile requirements remain
separate acceptance work.
