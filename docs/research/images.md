# Image: RN's own pipeline over worker-thread decoding in Godot

Status: executed local validation against pinned RN 0.87.1 and official Godot 4.7.2 on macOS
arm64. The [evidence](../evidence/images/README.md) owns the 74 headless checks across actual
SceneTree frames, the control on the preceding host (the 3 normative checks it can reach fail), two
retained sabotages that the probe and the independent oracle both reject, 15 mutations of the
genuine report that the oracle refuses, the 17 headless and 25 graphical checks of the example and
its two captures. Hosted CI has not run this slice. GF-16 stays open; only its first-slice
checkpoint is claimed.

All paths below are under `node_modules/react-native/` unless they start with `native/`, `src/`,
`sdk/` or `tests/`.

## What RN does

**The C++ side decides when a picture is requested.**
`ReactCommon/react/renderer/components/image/ImageShadowNode.cpp` requests an image from inside
layout. `setImageManager` (22-43) starts a request when a clone arrives with a clean layout and
one source or a frame with a size; `layout` (157-160) calls `updateStateIfNeeded` (45-108) first.
That function builds `ImageRequestParams` and returns early when the chosen source and the
parameters equal the saved state's (77-79); otherwise it commits
`ImageState{source, imageManager_->requestImage(source, surfaceId, params, tag), params}` (102-107).
`getImageSource` (110-153) picks the only source or the best area fit of several (133-146) and then
overwrites its `size` with the content frame and its `scale` with `pointScaleFactor` (125-126,
149-150), so the request is for what the layout will show, not for what the file holds.
`ImageComponentDescriptor.cpp:13-29` finds the `"ImageManager"` entry of the `ContextContainer`
(`ImageManagerKey`) and gives it to every shadow node it adopts; without one the platform's inert
manager answers with an empty request.

**An `ImageRequest` is a coordinator and two functions.** `imagemanager/ImageRequest.cpp:12-20`
builds an `ImageResponseObserverCoordinator` from a resume and a cancel `SharedFunction`.
`ImageResponseObserverCoordinator.cpp` is the whole protocol: `addObserver` (23-55) delivers a
completed response and consumes it, delivers a failure again, appends the observer while loading,
and, for a cancelled or consumed request, re-adds the observer and calls resume;
`removeObserver` (57-70) cancels when the last observer leaves while the request is loading;
`nativeImageResponseProgress`, `Complete` and `Failed` (72-122) assert the request is loading or
cancelled and call the observers outside the lock, so observers must be thread-safe
(`ImageResponseObserver.h`). `ImageState.h:25-65` holds the source, a `shared_ptr<ImageRequest>`
and the parameters.

**The iOS mount observes the request.**
`React/Fabric/Mounting/ComponentViews/Image/RCTImageComponentView.mm`: `updateState` (77-100)
swaps the observer on the new state's request before it decides whether to tell JS that loading
started, and emits `onLoadStart` only when there was no previous source or the source changed
(89-99); `_setStateAndResubscribeImageResponseObserver` (102-116) removes the proxy from the old
request's coordinator and adds it to the new one's (so a request that nobody observes any longer
is cancelled by `removeObserver`); recycling drops the observer and the image (118-123).
`didReceiveImage` (127-169) emits `onLoad` and then `onLoadEnd` before it sets the image
(136-140), `didReceiveProgress` (171-181) forwards progress, and `didReceiveFailure` (183-210)
clears the image and emits `onError` and then `onLoadEnd` (208-209). Notifications that arrive
after the view was recycled are ignored (129-134, 176-178). The payloads are
`ImageEventEmitter.cpp:16-26` (`source.uri`, width and height as the picture's point size times
the source's scale: pixels), `32-43` (`progress`, `loaded`, `total`) and `45-63` (`error`, and
`responseCode` and headers only for HTTP).
`imagemanager/platform/ios/.../RCTImagePrimitivesConversions.h:14-32` maps the resize modes:
cover to aspect fill, contain to aspect fit, stretch to scale-to-fill, center to center, repeat to
scale-to-fill (the repeat itself is a tiled resizable `UIImage`, `RCTImageComponentView.mm:148-150`)
and none to top-left.

**The request reaches the loader with decode parameters.**
`.../RCTImageManager.mm:39-110` builds the `ImageRequest` with shared resume and cancel
functions, wraps the loader's completion and progress blocks in `weak_ptr` locks of the coordinator
(68-90) and calls the image loader with the content frame size, the scale, `clipped:NO` (97) and
`RCTResizeModeStretch` (98). `Libraries/Image/RCTImageUtils.mm` then decodes for that size:
`RCTDecodeImageWithData` (281-360) turns stretch into cover because the decoder cannot change the
aspect ratio (309-313), asks `RCTTargetSize(..., allowUpscaling NO)` (316; 182-216) for the target
and creates an ImageIO thumbnail only when the source is larger than the target in pixels
(319-336); otherwise it keeps the full image. `RCTTargetSize` returns the source size when the
target would be larger than the source (207-212): a picture is never upscaled. A bundled asset does
not go through that path: `RCTBundleAssetImageLoader.mm:52-62` loads it whole from the local
asset URL (UIKit caches it, 39-41), reports progress `(1, 1)` only on success and fails
with `Could not find image <url>`. File and data requests report progress through the request
handlers' download blocks (`RCTImageLoader.mm:790-793`; `RCTFileRequestHandler.mm`,
`RCTDataRequestHandler.mm`): the file handler reports its byte count over the file's length and the
data handler reports over an unknown length. A failed decode reports
`Error decoding image data <NSData %p; %tu bytes>` (`RCTImageLoader.mm:1021`). The loader bounds
concurrency, not size: 4 loads, 2 decodes and 30 MB of decodes (131-133).

**The JavaScript side.** `Libraries/Image/Image.js` only re-imports itself so that a bundler picks a
platform file; `Image.ios.js:112-198` reads `source` through `getImageSourcesFromImageProps`,
chooses `resizeMode` from `objectFit`, the prop or the style (141-144), refuses children (147-151)
and renders the generated `ImageViewNativeComponent` (182-193) with the sources array.
`resolveAssetSource.js:111-142` and `AssetSourceResolver.js:169-179`
(`scaledAssetURLNearBundle`: the script URL's directory plus the scaled asset path, with `../`
rewritten to `_`) turn an `@Nx` asset registered through `AssetRegistry` (`registerAsset` and
`getAssetByID`, `src/private/assets/AssetRegistry.js:36-52`) into a file URI beside the bundle,
and `AssetUtils.js:16-30` (`pickScale`) chooses the first scale at least the pixel ratio, else the
largest. `resolveAssetSource.js:57-77` (`_coerceLocalScriptURL`) keeps the script URL's directory,
so a `res://` script URL gives `res://` asset URIs. Metro's module for an asset is
`module.exports = require("react-native/asset-registry").registerAsset(<descriptor>)`
(`node_modules/metro/src/Bundler/util.js:42-57`), and the descriptor is `Assets.js:160-192`: the
fields `__packager_asset`, `httpServerLocation`, `width`, `height`, `scales`, `hash`, `name` and
`type`, with the size of the first scale divided by that scale. `Image.getSize`,
`getSizeWithHeaders`, `prefetch`, `prefetchWithMetadata` and `queryCache` call the
`ImageLoader` TurboModule (`Libraries/Image/NativeImageLoaderIOS.js`;
`RCTImageLoader.mm:1235-1300`: `getSize` rejects with `E_GET_SIZE_FAILURE`).

## What this host did

`src/react-native-platform.jsx` exported `Image` and `ImageBackground` as `unavailable`
placeholders that threw on render, `AssetRegistry` was not exported, `Animated.Image` failed with
"Image is not implemented", and the application's `ContextContainer` held no `ImageManager`. The
generated `ImageComponentDescriptor` was not registered, and the same SDK bundle on the preceding
host fails where RN's `Image.ios.js` asks the host for the `ImageLoader` module:
`TurboModuleRegistry.getEnforcing(...): 'ImageLoader' could not be found`.

## The implementation

- **RN's own Image, behind a validating wrapper.** `src/image.jsx` renders RN's `Image.ios.js`
  after `src/image-contract.mjs` has refused what the host cannot show yet (below), and exposes
  RN's statics. `Image.ios.js` is loaded on first use: it asks for the `ImageLoader` module as it
  evaluates, so an application that never renders an Image, or a bundle that runs on a host
  without the module, still evaluates; the failure of a module that threw while evaluating is
  remembered, because a half-initialized module is returned again on the next `require`. The
  SDK's platform plugin aliases RN's `Image`, `ImageBackground` and `AnimatedImage` imports to the
  wrapper, since `Image.js` itself resolves to neither platform file.
- **RN's own C++ pipeline.** The host registers RN's generated `ImageComponentDescriptor` and an
  `ImageManager` under `ImageManagerKey`. `native/godot_image_manager.cpp` builds the
  `ImageRequest` RN expects, with resume and cancel functions, and hands the loader the source and
  a `weak_ptr` of the request's coordinator; an invalid source gets an inert request. Nothing about
  when a request starts, restarts or is cancelled is decided by the host: `ImageShadowNode` and the
  coordinator decide, as on iOS.
- **Worker-thread loading.** `native/image_loader.cpp` queues jobs (at most four in the pool at
  once, `limit()` for the tests) and runs them with `WorkerThreadPool::add_native_task`: the read,
  the magic-byte sniff, the header read, the bounds, the decode and the shrink. The main thread
  never touches a file or a decoder. A finished job goes to a mailbox; `poll()`, called from the
  application's pump, creates the texture (within an upload budget per pump, one texture
  always) and tells the coordinator's observers, in the order a `RCTImageManager` completion block
  would. A cancelled request flags its job: a decode in flight finishes (the pool requires every
  task to be awaited) and its result is dropped without a texture. `stop()` cancels everything,
  releases the gate and waits for every task. Each recorded job carries the identity of the thread
  that ran it, so the evidence can show that none ran on the main thread.
- **What is decoded.** `native/image_core.h` classifies the URI (`res://` and bundled assets,
  `user://` and `file://`, `data:` with base64 or percent encoding, http(s) refused by name),
  sniffs the format from magic bytes, reads the dimensions from the header of PNG, JPEG, WebP,
  BMP, TGA and SVG and refuses absurd ones before any decoder runs (Godot's JPEG loader multiplies
  dimensions in `unsigned int` and its PNG loader allocates before checking `Image::MAX_PIXELS`),
  and ports `RCTTargetSize` for the shrink. A non-bundled picture is decoded and shrunk to cover
  the request in pixels and never upscaled; a bundled asset is decoded whole at the scale its file
  name states; an SVG is rasterized at the request's scale.
- **The view.** `native/image_view.cpp` is `GodotImage`, a `Panel` that observes its state's
  request the way `RCTImageComponentView` does: swap the observer when the state's request
  changes, `onLoadStart` only when the source changed, `onLoad` then `onLoadEnd` with the size in
  pixels, `onError` then `onLoadEnd`, `onProgress` per the handlers' rules, and nothing after a
  detach. `native/image_geometry.h` computes the rectangles of the six content modes from the
  content frame and the picture's point size, with the texture's filter set to linear; repeat tiles
  at the picture's size in points. The `ImageLoader` TurboModule (`native/image_loader_module.cpp`)
  answers `getSize` with `[width, height]` and `getSizeWithHeaders` with `{width, height}` from
  the header alone, and rejects the rest as described below.
- **The asset pipeline.** `sdk/toolchain/asset-plugin.mjs` is one esbuild plugin for every build:
  `require()` of an image becomes Metro's module with Metro's descriptor (the unit tests compare it
  with `getAssetData` of Metro itself, hash included, and with `generateAssetCodeFileAst`'s shape),
  every `@Nx` variant is merged into one descriptor, and the files are copied beside the bundle
  under `assets/` with a `<bundle>.assets.json` manifest that holds each file's SHA-256 and the
  bundle's. The iOS export hook copies the manifest's files (`sdk/addon/ios_export.gd`).

## Where the host departs from RN

- **Error codes are message prefixes.** The `ImageLoader` module rejects with a message that starts
  `E_GET_SIZE_FAILURE: ...` or `E_PREFETCH_FAILURE: ...`; RN's `reject(code, message, error)` also
  sets `Error.code`, which the host's promise rejection does not carry.
- **Repeat tiles at an integer size in points.** UIKit tiles a resizable image at its size in
  points with float geometry; the host draws a texture whose size override is an integer number of
  points.
- **SVG is rasterized at the request's scale**, which iOS's decoder does not do (RN has no SVG
  image on iOS); `getSize` of an SVG measures at scale 1.
- **`res://` is the bundle.** A `res://` source is decoded whole at the scale of its file name
  like a bundled asset, because that is what the exported project's resources are.
- **`getSize` believes the header** and decodes nothing, so a corrupt or oversized picture still
  has its size; `getSizeWithHeaders` accepts and ignores its headers (only local sources load).
- **No cache and no prefetch.** `prefetch` and `prefetchWithMetadata` reject
  `E_PREFETCH_FAILURE: this host has no image cache yet`, and `queryCache` answers `{}`.
- **GIF is refused** through `onError` (Godot has no GIF decoder), and animated formats are not
  played.
- **ImageIO's thumbnail rounding is assumed round-to-nearest**; the host shrinks with
  `Image::resize` (Lanczos) to `RCTTargetSize`'s size and has not been compared with an iOS device.
- **Host bounds on what is decoded:** 16,384 pixels a side, 64 Mi pixels and 128 MiB of source
  bytes, where RN's loader bounds only concurrency. Every refusal is an `onError` with iOS's
  decode-error text.
- **A wrapper refuses what the host does not implement.** RN's `Image` accepts `tintColor`,
  `blurRadius`, `capInsets`, `defaultSource`, `loadingIndicatorSource`, `fadeDuration`,
  `progressiveRenderingEnabled`, `resizeMethod`, `resizeMultiplier` and `overlayColor`, a border
  radius on the style, and `headers`, `method`, `body` and `cache` on a source. The wrapper makes
  each fail where the Image renders, with a message that names the prop and why, and invalid
  values, unregistered asset ids and an Image inside `Text` fail with the host's messages, instead
  of dropping them silently.

## Why the probe is discriminating

The [driver](../../tests/images-probe.gd) mounts a fixture whose declared cases (bundled
assets at three scales, every format, `user://`, `file://`, `data:`, failures, resize modes, an
`ImageBackground` and an `Animated.Image`) are listed in the fixture and recomputed by the
[oracle](../../tests/images-oracle.mjs) from RN's formulas and the fixture files' own pixels. The
stages that matter most do not depend on pace: the pool is held at a gate (`hold`) so that a
decode is in flight for as long as a stage needs it, the in-flight limit is one (`limit`), and a
byte budget of one (`budget`, in a stage of its own) makes every pump create exactly one texture,
so each stage waits on a state and asserts what was delivered, never a count of frames. It checks that a request
swapped away while its decode is in flight reports nothing, that the decode is finished and
dropped without a texture, that unmounting an Image or a whole root drops what is in flight and
cancels what waited, that no texture outlives the application, and that every task started was
awaited.

The control on the preceding host reaches 11 checks, fails the 3 normative ones among them, and
the 8 that need no native pipeline hold. Two retained sabotages break one behavior each. Decoding
on the main thread fails 12 checks, and the oracle rejects the report at the event sequence of the
in-flight stage: the swapped-away request's events arrive at once because nothing was held in the
pool. A view that does not leave the request it swapped away from fails 2 checks, and the oracle
rejects the late second `progress`, `load` and `loadEnd`.

## What stays open for GF-16

- **Network images** (http and https, headers, method, body, cache) need GF-22's transport and a
  request layer for images, with the request's cancellation and progress.
- **The decoded-image cache, `prefetch` and a real `queryCache`.**
- **`tintColor`** (a shader on the Image's own canvas item), **`blurRadius`**, **`capInsets`**,
  **`defaultSource`**, **`loadingIndicatorSource`**, **`fadeDuration`**,
  **`progressiveRenderingEnabled`**, **`resizeMethod`**, **`resizeMultiplier`** and
  **`overlayColor`**.
- **Rounded image clipping**: the host clips rectangles only, so a border radius on the Image's own
  style fails; it comes with the next slice.
- **Animated GIF and WebP**, **`nativeImageSource`**, and Image inside Text.
- **Export of assets** for desktop and Android (the iOS hook exists but no exported app ran),
  and a hardware pass of decode memory and the upload budget.
- **Differential parity against RN on iOS**, including ImageIO's rounding and UIKit's tiling.
