# React Native ScrollView on Godot

Status: desktop implementation slice under review; no GF-14 checkpoint has
been accepted. The pinned React Native 0.87.1 `ScrollView` remains the public
component and owns commands, responder policy, child structure and context. A
small public contract rejects host behavior that is not implemented. The
Godot wrapper does not change `Platform.OS`.

The native `ScrollAdapter` owns one fractional offset and one clipped Control
content transform. That offset drives paint, Fabric state, scroll events, DOM
measurement and pointer coordinates. `ScrollMotion` models command animation,
drag and momentum. The existing pointer route selects the native pan candidate;
when it claims a drag, the child pointer and touch stream are canceled once.
The final registered `RCTScrollView` config adds only the missing `horizontal`
attribute for custom Godot OS builds; the original RN component registers first,
and ordinary `RCTView` / `GodotControl` configs remain unchanged.

The supported slice covers vertical and horizontal offsets, default native
indicators, fractional measurement, `scrollTo` / `scrollToEnd` (including RN's
default `animated: true`), command replacement, native pan, measured drag
velocity, momentum, responder-mediated cancellation and Android's
`scrollEventThrottle` rule. Requested native behavior outside this slice fails
at the public boundary. Bounce, paging, zoom, sticky headers, refresh controls,
indicator customization, nested or multitouch scrolling, hardware/refresh-rate
behavior and mobile exports remain unsupported or unverified.
For `scrollToEnd`, desktop follows the pinned Android command's axis policy:
vertical mode reaches the bottom while preserving x, and horizontal mode reaches
the right edge while preserving y. This is verified with both dimensions
overflowing and does not claim iOS parity.

The [evidence record](../evidence/scroll-view/README.md) includes a mounted
headless probe, a separate macOS windowed pixel-clipping capture, retained
VirtualizedList consumer checks and their limits. The capture verifies the
Godot desktop renderer; physical-device input, refresh-rate coverage and mobile
behavior remain unverified.
