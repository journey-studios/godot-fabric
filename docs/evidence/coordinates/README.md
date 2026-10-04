# Root, target and screen coordinates

This checkpoint runs the [public coordinate example](../../../examples/coordinates/README.md)
on macOS arm64 with official Godot 4.7.2, React Native 0.87.1, Hermes and the
Compatibility renderer. Two nonoverlapping FabricSurfaces share one application
and preserve separate refs, contact targets and React state. Only the project's
GDExtension is compiled; Godot is not rebuilt.

## Executed checks

| Lane | Result | What it establishes |
| --- | --- | --- |
| Headless coordinates | 238 assertions passed | Genuine mouse/touch movement, public measures, target identity, retention transitions, root isolation, current density and cleanup |
| Native coordinates | 247 assertions passed, including six RGBA samples | The same contracts, actual pressed-state pixels and three saved captures |
| Previous host | 121 of 238 headless and 121 of 247 native assertions failed | The final fixture detects the prior root/page/screen disagreement and resulting Pressability failures |
| Intermediate cached-density host | One of 238 headless assertions failed | The first contact after density changes still requires current transform and density together |
| JS / Python / native contracts | 202 JS, 13 Python and 10 native tests passed | Completed contract regressions on the corrected source |
| Example regression matrix | 17 scenes, 910 headless assertions passed | Existing public/internal examples and the coordinate fixture on the corrected host |
| Native adapters | 17 runs, 318 assertions passed | External component/module and root-retirement regressions against the fresh native SDK |

[checks.json](checks.json) retains assertions, public/native geometry, event
coordinates and pixel values. [negative-control.json](negative-control.json)
separates the two expected-failing controls. Source, binary and toolchain
identities are in [provenance.json](provenance.json); other completed suites are
in [regressions.json](regressions.json). These local results do not establish
new hosted CI, exported targets or complete RN parity.

[Hosted CI and publication](ci.json) record the coordinate snapshot separately.
The preceding documentation snapshot `0e05abe` passed contracts, native cold
start and Android; iOS simulator discovery timed out before app execution,
so its comparison was skipped. The current coordinate run retains its observed
job states in that receipt. Pages build/deploy succeeded for data `f40831e`,
and the public JSON exactly matched that committed snapshot.

## Coordinate contract and correction

Pinned RN [BaseTouch](https://github.com/react/react-native/blob/v0.87.1/packages/react-native/ReactCommon/react/renderer/components/view/BaseTouch.h#L23-L36)
defines page points relative to the root, local points relative to the original
target, and screen points in screen coordinates. Original
[DOM measurements](https://github.com/react/react-native/blob/v0.87.1/packages/react-native/ReactCommon/react/renderer/dom/DOM.cpp#L492-L550)
exclude viewport offset for `measure` and include it for `measureInWindow`.
[Pressability](https://github.com/react/react-native/blob/v0.87.1/packages/react-native/Libraries/Pressability/Pressability.js#L800-L874)
uses `measure` to form its retention region and compares movement's page points
against that region. Moving a Godot surface must therefore leave both in the
same logical React-root space.

The native adapter projects input through the inverse surface transform for
`pageX/pageY` and the inverse original-target transform for `locationX/locationY`.
Window measurements keep the embedding. Screen points add the native Window's
client-area position to its transformed input point, then divide by current
content density. Godot already localizes raw window input before `_input`, so
page/local points receive no additional density division.

The first density-two START is injected before any frame or JS evaluation can
refresh metrics. The intermediate host mixed the current transform with cached
density: its screen point was `(990, 568)` instead of `(495, 284)`. Sampling both
from the same current Window state fixes that executed failure. Godot's public
screen transform alone omits a standalone native Window's desktop position;
the adapter adds the actual client-area origin. See the pinned
[Window implementation](https://github.com/godotengine/godot/blob/4.7.2-stable/scene/main/window.cpp#L3008-L3017)
and [input localization](https://github.com/godotengine/godot/blob/4.7.2-stable/scene/main/viewport.cpp#L1361-L1373).

## Observed UI and gestures

![Both roots start ready at different window positions](coordinate-initial.png)

The initial capture shows two mounted roots with separate zero press counts.
Real MOVE events test staying inside retention, leaving it, returning and
releasing exactly one press. Releasing outside must produce no press.

![Scaled root A remains held while root B stays ready](coordinate-scaled.png)

Surface A moves during a held contact, then its Godot embedding scales to
`(0.8, 1.2)` without changing logical React measurements or native identity.
The scaled capture records A held in orange during a dedicated contact; B
remains ready. Separate gestures exercise the full retention sequence.

![Raw window pixels at density two preserve logical coordinates](coordinate-density.png)

The density-two stage supplies physical window-pixel events with
`push_input(event, false)`. Both roots finish ready. Their displayed root/local
points agree because the logical target layouts agree, despite different window
placements. All regular steps compare original contact arrays, responder
lifetime, public `measure` plus local point, and actual Godot geometry.

## Remaining boundaries

GF-08/GF-13 remain in progress. This slice exercises translated and positively
scaled Godot surfaces in one native Window. Full ref/command and input parity,
RN style transforms, rotation during active gestures, overlapping-root routing,
simultaneous multitouch, hardware input, OS DPI policy, SubViewport, embedded
Windows, singular transforms and other operating systems require separate
acceptance. The earlier [View checkpoint](../view/README.md) retains its own
historical hashes and reports; this correction does not relabel those results.
