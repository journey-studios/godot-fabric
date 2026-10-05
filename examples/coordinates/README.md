# Root, local and window coordinates

This public `react-native` UI mounts the same registered component in two
explicit `FabricSurface` Controls owned by one `FabricApplication`. Each root
keeps its own refs, touch records, pressed render state and completed press
count. The surfaces start at different nonzero positions in the Godot window.

```sh
npm run example -- coordinates
npm run example -- coordinates --headless
npm run example -- coordinates --capture
```

The validation projects all four corners of the actual Godot Controls through
`get_global_transform_with_canvas()`. It compares that independent geometry
with public `measure`, `measureLayout`, `measureInWindow` and DOMRect results.
Every injected start, move and end also checks that the original touch payload
uses React root coordinates for `pageX/pageY` and target coordinates for
`locationX/locationY`, while the recorded window point includes the embedding.
`screenX/screenY` includes the native window position and current content
density. The original touch arrays retain the same coordinates and identity.

Genuine viewport mouse and touch events exercise the upstream Pressability
sequence: start inside, move beyond retention, return inside and release. A
separate case releases outside and must not increment the count. Surface A
then moves during a held gesture and receives another real move before release;
finally its nonuniform Godot scale changes to `(0.8, 1.2)` and both gesture
transports repeat. Surface B is tapped after each embedding change to check
that its root identity, coordinates and React state remain independent.

An additional density-two stage supplies physical window-pixel input with
`push_input(event, false)`, exercising Godot's actual input localization.
Its first START is injected synchronously after the density changes, before
any frame or JS evaluation can refresh cached metrics. The oracle samples the
current Godot transforms independently; the remaining gestures also compare
original public Dimensions and PixelRatio without dividing layout points twice.

The [executed checkpoint](../../docs/evidence/coordinates/README.md) records
238 passing headless assertions and 247 passing native assertions, including
six actual target-background RGBA samples. The final fixture detects 121 failures
on the previous host in each lane. A separate intermediate implementation fails
the first START after changing density because it uses cached metrics.

![Two independent roots start at different window positions](../../docs/evidence/coordinates/coordinate-initial.png)

![Scaled root A stays held while root B remains ready](../../docs/evidence/coordinates/coordinate-scaled.png)

![Density-two window pixels preserve logical root and target points](../../docs/evidence/coordinates/coordinate-density.png)

These are actual Godot Viewport readbacks. The scaled capture includes a
dedicated held touch with a ten-second long-press delay; retention cases run
separately from GPU readback. The density capture follows completed raw-window
gestures; both roots are ready and display the same logical layout point despite
their different window positions. Capture output is saved under `build/`.

This fixture covers Godot surface translation and positive nonuniform scale in
one native window. It does not certify RN style transforms, rotation during an
active gesture, hardware input, simultaneous cross-root multitouch, DPI policy,
SubViewport or embedded Windows, singular transforms or other operating systems.
Shutdown checks both roots' effect cleanup, retained stale refs and the host's
remaining native work. GF-08/GF-13 retain their broader acceptance requirements.
