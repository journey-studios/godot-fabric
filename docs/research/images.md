# Image: RN's own pipeline over worker-thread decoding in Godot

Status: executed local validation against pinned RN 0.87.1 and official Godot 4.7.2 on macOS
arm64. The [first slice's evidence](../evidence/images/README.md) owns the checks of the local
pipeline across actual SceneTree frames (74 when it was recorded, 73 now that the second slice
changed the contract), the control on the preceding host (the 3 normative checks it can reach
fail), two retained sabotages that the probe and the independent oracle both reject and the oracle's
mutations of the genuine report. The [network slice's evidence](../evidence/images-network/README.md)
owns the 74 headless checks over a loopback Node server (HTTP and HTTPS), the control on the
preceding host (37 checks run, the 30 that need the network fail), three retained sabotages that the
probe and the oracle both reject, 33 mutations of the genuine report that the oracle refuses and the
22 headless and 30 graphical checks of the example and its two captures. Hosted run 37724902858 (the
push of main 6d02746, the squash of #56) passed all five jobs in its first attempt; its native job
ran `npm run test:images` (1 of 1 TAP test passing) and its artifact repeated the first slice's 74
checks, and the independent oracle accepts its report
([receipt](../evidence/images/hosted-ci.json)). Hosted run 37750455295 (the push of main fb50a32, the
squash of #64) passed all five jobs in its first attempt; its native job ran `npm run
test:images-network` (1 of 1 TAP test passing) and its artifact repeated the network slice's 74 checks
with identical IDs and the bundle SHA-256 the report records (no pinned producer changed since
`910cffb`: 194 of 194 tracked paths have its bytes), and the independent oracle accepts its report
([receipt](../evidence/images-network/hosted-ci.json)). The
[visual slice's evidence](../evidence/images-visual/README.md) owns the 53 headless checks of what is done to a
picture (tint, blur, cap insets and the rounded clip, and the props iOS ignores), the control on the preceding
host (all 53 run, the 40 normative fail), four retained sabotages that the probe and the oracle both reject, 48
mutations of the genuine report that the oracle refuses, the exact pixels of 14 blurred bitmaps and the 26
headless and 39 graphical checks of the example with its two captures; hosted CI has not run it. GF-16
stays open; neither the network slice nor the visual slice closes a checkpoint.

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

## What RN does for a network image

**The source becomes a request.** `ReactCommon/react/renderer/components/image/conversions.h:78-103`
reads `headers`, `body`, `method` and `cache` (`reload`, `force-cache`, `only-if-cached`) from the JS
source, and `Libraries/Image/ImageSourceUtils.js:39-47` turns `crossOrigin="use-credentials"` into an
`Access-Control-Allow-Credentials: true` header and `referrerPolicy` into `Referrer-Policy`.
`.../imagemanager/platform/ios/react/renderer/imagemanager/RCTImagePrimitivesConversions.h:114-153`
(`NSURLRequestFromImageSource`) builds the `NSURLRequest`: `GET`, or the method upper-cased (125-128),
a body for any method (129-132), each header through `setValue:forHTTPHeaderField:` so that a later
value of a name replaces the earlier one (140-146), and the cache policy (52-65): `reload` is
`NSURLRequestReloadIgnoringLocalCacheData`, `force-cache` `ReturnCacheDataElseLoad`, `only-if-cached`
`ReturnCacheDataDontLoad` and anything else the protocol's own policy. A plain `GET` returns before any
of that (135-138).

**The loader decides where the picture comes from.** `RCTImageManager.mm:83-113` asks
`loadImageWithURLRequest` with the content frame, the scale, `clipped:NO` and stretch, and turns the
progress block into `(progress / total, progress, total)` (89). In `Libraries/Image/RCTImageLoader.mm`,
`_loadImageOrDataWithURLRequest` (492) makes a `NSURLRequestReloadIgnoringLocalCacheData` request
uncacheable (540-542). A request that no URL loader claims, which is every http and https one, asks the
decoded cache first, `RCTImageCache`, for its key (665-672) and, on a miss, goes to `_loadURLRequest`
(705-820) and the `RCTNetworking` module; after the decode the picture is stored with the response
(863-870). `RCTImageCache.mm` keys a picture by `url|width|height|scale|mode` written with `%g` (30-34),
keeps at most 2 MiB a picture and 20 MiB in all (21-22, 75-78), empties itself on a memory warning and
when the app resigns active (49-56), and drops an entry that went stale when it is asked for it (81-96).
It decides whether a response may be kept and when it goes stale in `addImageToCache:...response:`
(98-148): a `Cache-Control` component that contains `no-cache` or `no-store`, or ends in `max-age=0`,
forbids keeping it; `max-age=N` makes it stale at `Date + N`; without one, `Expires` gives the time,
and otherwise a tenth of the time between `Last-Modified` and `Date`; a response with no readable `Date`
has no stale time. The date format is the one `dateWithHeaderString` reads (150-162).

**Downloads.** `_loadURLRequest` queues an `RCTNetworkTask` (759-801). `dequeueTasks` (425-486) starts
at most `maxConcurrentLoadingTasks` of them (4, `RCTImageLoader.mm:131`) in order, and removes the
finished ones, decrementing `_activeTasks` for each (432-437), a cancelled one that never started
included. `Libraries/Network/RCTNetworkTask.mm:170-217` accumulates the body and calls the progress block
with `(received, expectedContentLength)` for every chunk. `processResponse` (728-756) judges the result:
an error passes through; no data is `Unknown image download error` (736-738); a status other than 200 is
an `NSError` whose code is the status and whose text is `Failed to load <response URL>` (744-750); both
reach the completion with the response. `RCTHTTPRequestHandler.mm:147-160` replaces the headers of a
redirected request with the cookies' (an app header does not survive a redirect), and the session
accepts cookies (98-100).

**The statics.** `getSize` (`RCTImageLoader.mm:1231-1245`) rejects `E_GET_SIZE_FAILURE` with
`Failed to getSize of <uri>`; `getSizeWithHeaders` (1248-1265) rejects it with no message and resolves a
`{width, height}` object. Both go through `getImageSizeForURLRequest` (1065-1116), which loads the bytes
and reads their metadata without decoding (1072). `prefetchImage` and `prefetchImageWithMetadata`
(1267-1297) are a `loadImageWithURLRequest` of size 0x0, scale 1 and prefetch priority that resolves
`YES` or rejects `E_PREFETCH_FAILURE`, so a prefetched picture is stored in the decoded cache under the
key of size 0x0. `queryCache` (1299-1303, `getImageCacheStatus` 1119-1140) asks the shared `NSURLCache`
and answers `memory`, `disk` or `disk/memory` for each URL it holds.

**The error payload.** `RCTImageComponentView.mm:183-210` reads `httpStatusCode` and
`httpResponseHeaders` out of the error's `userInfo` and `ImageEventEmitter.cpp:45-63` sends
`responseCode` and `httpResponseHeaders` only when they are present. `RCTImageLoader` puts the keys in the
error: `addResponseHeadersToError` (`RCTImageLoader.mm:37-46`) copies `response.statusCode` and
`response.allHeaderFields` into its `userInfo`, and the loader's completion applies it (576-579) to every
error that arrives with an `NSHTTPURLResponse` unless the completion runs on the main queue with data
(567-574), a path a download does not take, since its completion runs on the network handler's queue.

## What RN does for tint, blur, cap insets and rounded corners

**Which props reach the native side.** On iOS the generated component's `validAttributes`
(`Libraries/Image/ImageViewNativeComponent.js:133-153`) are `blurRadius`, `capInsets`, `defaultSource`,
`internal_analyticTag`, `resizeMode`, `source` and `tintColor`;
`Libraries/ReactNative/ReactFabricPublicInstance/ReactNativeAttributePayload.js:73-74` (creation) and `246-247`
(update) skip every prop without an entry. `loadingIndicatorSource`, `fadeDuration`,
`progressiveRenderingEnabled`, `resizeMethod`, `resizeMultiplier` and `overlayColor` are listed only in the Android
branch (81-109, the first as `loadingIndicatorSrc`), so they never reach an iOS view. `defaultSource` does, and
`ReactCommon/react/renderer/components/image/ImageProps.cpp:22-27` parses it (as `overlayColor` is at 82-87), but
nothing in `RCTImageComponentView` reads it. `Image.ios.js:141-146` flattens the style and passes `tintColor` as
`props.tintColor ?? flattenedStyle?.tintColor`; the base style (261-265) has `overflow: 'hidden'`.
`Libraries/Image/ImageProps.js:310-313` documents the tint as changing "the color of all non-transparent pixels".

**What a new image does to the view.** `ImageShadowNode::updateStateIfNeeded`
(`ReactCommon/react/renderer/components/image/ImageShadowNode.cpp:45-108`) builds the request params, which are the
blur radius alone on iOS (`ReactCommon/react/renderer/imagemanager/platform/ios/react/renderer/imagemanager/ImageRequestParams.h:17`),
and commits a new `ImageState` with a new request unless both the source and the params equal the saved ones
(77-80): a changed `blurRadius` asks for the same source again, and
`React/Fabric/Mounting/ComponentViews/Image/RCTImageComponentView.mm:89-99` sends `onLoadStart` only when the source
changed. `updateProps` sets the `tintColor` on the `UIImageView` (64-67). `didReceiveImage` (127-169) sends `onLoad`
and `onLoadEnd` first (139-140), then makes the image a template when `tintColor` is set (144-146), makes it
resizable with the `capInsets` (a tiling resize for `repeat`, 148-150; a stretching one when the insets are not all
zero, 151-155) and, when `blurRadius > __FLT_EPSILON__`, blurs that image on a global queue and sets the result
(157-166).

**The blur.** `Libraries/Image/RCTImageBlurUtils.mm` reads only the `CGImage` and the scale of the image it gets
(12-14), converts anything that is not 32-bit with alpha to ARGB (22-31), takes a box of
`floor((radius × scale × 3·√(2π)/4 + 0.5) / 2) | 1` pixels (52-53) and runs `vImageBoxConvolve_ARGB8888` with
`kvImageEdgeExtend`. A box of one pixel has no temporary buffer and the function returns its input (56-62). The
three convolutions (76-78) write `buffer2`, `buffer1` and `buffer2`; the function frees `buffer2` and builds its
result from `buffer1` (81-96), so two passes reach the picture, and the new `UIImage` carries nothing of the
template, the caps or the tiling of the one it was given.

**The clip.** `React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm:371-374` sets `clipsToBounds` from
`getClipsContentToBounds()` (`ReactCommon/react/renderer/components/view/BaseViewProps.cpp:563-565`: `overflow` is
not `visible`), and the block at 1300-1337, with `enableIOSViewClipToPaddingBox` false
(`ReactCommon/react/featureflags/ReactNativeFeatureFlagsDefaults.h:138-140`), clips the view to its border box with
the radii (a `cornerRadius` when the radii are uniform and circular, `components/view/primitives.h:251-254`; a path
mask otherwise) and, because a `UIImageView` is the content view, masks that image view with the radii less the
widths of the borders beside each corner (`RCTGetCornerInsets`, `React/Views/RCTBorderDrawing.m:43-61`) in a
rectangle the size of the content frame (`RCTViewComponentView.mm:1315-1324`, the content view's frame being
`getContentFrame()` at 86-96). `RCTPathCreateWithRoundedRect` (`RCTBorderDrawing.m:104-130`) limits each radius to
what the neighbouring corner leaves of the side. The radii that reach it have been through `BaseViewProps.cpp`'s CSS
overlap rule (415-468) and its percentage resolution (470-487, `resolveBorderMetrics` at 506-524), where a
percentage is of the width along a corner's horizontal radius and of the height along its vertical one.

**How `capInsets` are read.** `ReactCommon/react/renderer/core/graphicsConversions.h:147-180` reads a number as all
four insets, an object by its keys (155-172) and a list as left, top, right and bottom (174-180); but a raw list is
also a `std::unordered_map<std::string, Float>` of the keys `"0"` to `"3"`, which is tried first, so a list reaches
the object branch, logs `Unsupported EdgeInsets map key` for each entry and leaves every inset at zero.

## What this host did

`src/react-native-platform.jsx` exported `Image` and `ImageBackground` as `unavailable`
placeholders that threw on render, `AssetRegistry` was not exported, `Animated.Image` failed with
"Image is not implemented", and the application's `ContextContainer` held no `ImageManager`. The
generated `ImageComponentDescriptor` was not registered, and the same SDK bundle on the preceding
host fails where RN's `Image.ios.js` asks the host for the `ImageLoader` module:
`TurboModuleRegistry.getEnforcing(...): 'ImageLoader' could not be found`.

## The implementation

- **RN's own Image, behind a validating wrapper.** `src/image.jsx` renders RN's `Image.ios.js`
  after `src/image-contract.mjs` has refused what is a mistake (below), and exposes
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
  `user://` and `file://`, `data:` with base64 or percent encoding, http(s) sent to the network sources below),
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
  the header alone, and, since the network slice, `prefetch` and `queryCache` as described below.
- **The asset pipeline.** `sdk/toolchain/asset-plugin.mjs` is one esbuild plugin for every build:
  `require()` of an image becomes Metro's module with Metro's descriptor (the unit tests compare it
  with `getAssetData` of Metro itself, hash included, and with `generateAssetCodeFileAst`'s shape),
  every `@Nx` variant is merged into one descriptor, and the files are copied beside the bundle
  under `assets/` with a `<bundle>.assets.json` manifest that holds each file's SHA-256 and the
  bundle's. The iOS export hook copies the manifest's files (`sdk/addon/ios_export.gd`).
- **Network downloads (the second slice).** `native/image_network.cpp` is `ImageNetwork`, the loader's own
  downloader over an `HttpTransport` that `application_runtime.cpp:599-607` makes from the same factory,
  trust and clock as Networking's (a second instance: a shared one would collide on caller-chosen ids and
  `Networking::stop` would end image loads). It builds the request like `NSURLRequestFromImageSource`
  (`build_download_request`, 32-55), runs at most four downloads in first-in-first-out order
  (`start_queued`, 129-185), judges each result like `processResponse` (`judge_download`, 57-73) and
  enforces the size and idle limits and the progress in `settle_active` (187-241). Transport listeners only
  record; cancelling, the limits, the progress and the outcome all happen after `transport->poll()` returns,
  because cancelling inside a listener is a use-after-free in the transport, and `stop()` stops the transport
  first so that no listener runs afterwards (252-259). Every image request sets
  `HttpRequest::drop_headers_on_redirect` (`native/http_transport.h:21-26`, honored by `plan_redirect`,
  `native/http_core.h:283-310`, and passed at `native/godot_http_transport.cpp:177`): the follow-up request
  carries none of the request's headers, as `RCTHTTPRequestHandler` leaves only the cookies and the host has none;
  Networking leaves it off and keeps OkHttp's rules. A request that carries `Authorization`,
  `Proxy-Authorization` or `Cookie` and whose URL is http is refused in `build_download_request` before any
  request, with a host message.
- **The route and the two caches.** `native/image_cache.h` holds what needs no Godot: the HTTP date format
  and `integerValue` of `RCTImageCache` (57-104), `response_freshness` (123-154), the decoded key (32-36),
  `carries_credentials` (172-177), `route()` (204-221) and `ExpiringLru` (227-314). `native/image_sources.cpp`
  (`ImageSources`) owns the network and both caches: `resolve` (74-158) builds the request, asks `route()` (a
  decoded hit never touches the byte cache, because a lookup moves an entry to the front of its cache; a
  request that carries credentials asks neither cache), and answers from the decoded cache, from the byte
  cache (decoded again off the main thread) or from a download; `from_download` (162-199) keeps a 200 in the
  byte cache whoever asked (a view, `getSize` or `prefetch`) unless the request carried credentials, and
  `keep_picture` (215-220) keeps the decoded picture of a view's request unless it reloaded, the response
  forbids it or the request carried credentials.
  Time is the validation clock, moved by `validation_clock_offset_ms` (monotonic for the idle timeout, wall
  for the stale times), so no check sleeps.
- **The statics.** `native/image_loader_module.cpp` answers `getSize` and `getSizeWithHeaders` of a network
  URL (45-75; a header value that is not a string is written as `image::number_text` or as `1` or `0`,
  `native/image_core.h`), `prefetchImage` and `prefetchImageWithMetadata` (79-80 and 102-111, which download,
  check off the main thread that the bytes are a picture, and keep only the response) and `queryCache`
  (83-95, `memory` for a URL the byte cache holds).
- **The view and the lifecycle.** `GodotImage` fills `responseCode` and `httpResponseHeaders` of a failure
  (`native/image_view.cpp:152-162`) and tiles without resizing the shared texture (182-190);
  `AppLifecycle::on_memory_warning` (`native/app_lifecycle.h:46-53`) runs the caches' clearing before JS is
  told of a memory warning.

- **What is done to a picture (the third slice).** `native/image_effects_core.h` is pure: `blur_plan` (the
  box and whether it changes anything, 47-56), `premultiplied` and `straightened` (59-67), `row_window_sums` and
  `box_pass` (71-109, the exact sum of the square window with the edge extended, divided once),
  `box_blur_rgba8` (113-125: premultiply, two passes, straighten), `corner_insets` and `fit_corners` (155-179, the
  two functions of `RCTBorderDrawing.m`), `clip_geometry` (181-186: the border box with the radii, and the
  content frame with each radius less the border beside it, clamped in the content frame's own size),
  `patch_margins` (211-219: points of the picture times its scale, no more than the picture holds) and `paint()`
  (278-312: the effective mode, the rectangles in pixels of the picture, the nine-patch, the tint and the clip of
  one draw, for a blurred ("plain") picture or not). `native/image_effects.cpp` is `PictureLayer`: a canvas item
  that is a child of the view's, scaled by 1/scale so that the shader's coordinates and the nine-patch margins are
  texels (`draw`, 168-203; `ensure_item`, 124-134), one shader for every view (the code at 25-76, made on first
  use by `shader()` at 83 and freed by `release_shader()` at 223 when the extension terminates,
  `native/register.cpp:39`) and one material per view (`set_material`, 135-167, which keeps what it passed to
  `material_set_param`). The shader tints with `COLOR = vec4(tint.rgb, COLOR.a * tint.a)` and masks with the
  coverage of two rounded rectangles, each corner a quarter ellipse with the first-order distance
  `k0 (k0 - 1) / k1` (exact for a circle), over a one-pixel ramp of the screen from `fwidth`. RIDs are not
  reference counted: the view frees the item and then the material, and `PictureLayer::counters()` (217) is in
  the application snapshot (`native/application_runtime.cpp:2440`). `GodotImage::apply`
  (`native/image_view.cpp:100-128`) reads the tint, the cap insets, the blur radius, the radii and widths of
  `resolveBorderMetrics` and the `overflow`; `painting()` (213) and `_draw()` (231) hand `paint()`'s result to the
  layer, and the texture they draw is the cache's and is never written. `ImageLoader`
  (`native/image_loader.cpp:356-366`) blurs on the worker after the decode and before the fingerprint and the
  texture, `request_of` (478) leaves a blurring request out of the decoded cache, the job's record carries the
  radius, box, passes and outcome (394), and the `blurred` counter (623) counts the pictures the blur changed;
  `GodotImageManager` (`native/godot_image_manager.cpp:26-27`) passes the params' radius to the load.

## Where the host departs from RN

- **Error codes are message prefixes.** The `ImageLoader` module rejects with a message that starts
  `E_GET_SIZE_FAILURE: ...` or `E_PREFETCH_FAILURE: ...`; RN's `reject(code, message, error)` also
  sets `Error.code`, which the host's promise rejection does not carry.
- **Repeat tiles at the picture's exact size in points.** UIKit tiles a resizable image at its size in
  points with float geometry. The first slice drew a texture whose size override was an integer
  number of points; the network slice tiles at the exact, possibly fractional, size with a draw
  transform (`native/image_view.cpp:182-190`), because the decoded cache hands one texture to every
  view of a picture and no view may resize it.
- **SVG is rasterized at the request's scale**, which iOS's decoder does not do (RN has no SVG
  image on iOS); `getSize` of an SVG measures at scale 1.
- **`res://` is the bundle.** A `res://` source is decoded whole at the scale of its file name
  like a bundled asset, because that is what the exported project's resources are.
- **`getSize` believes the header** and decodes nothing, so a corrupt or oversized picture still
  has its size; the headers of `getSizeWithHeaders` are sent for a network source and ignored for a
  local one.
- **GIF is refused** through `onError` (Godot has no GIF decoder), and animated formats are not
  played.
- **ImageIO's thumbnail rounding is assumed round-to-nearest**; the host shrinks with
  `Image::resize` (Lanczos) to `RCTTargetSize`'s size and has not been compared with an iOS device.
- **Host bounds on what is decoded:** 16,384 pixels a side, 64 Mi pixels and 128 MiB of source
  bytes, where RN's loader bounds only concurrency. Every refusal is an `onError` with iOS's
  decode-error text.
- **A wrapper refuses what is a mistake.** Invalid values, unregistered asset ids and an Image inside `Text` fail
  where the Image renders, with the host's messages, instead of being dropped silently; since the visual slice
  that includes a `blurRadius` that is not a finite number and `capInsets` that are not a number or an object of
  `top`, `left`, `bottom` and `right` numbers. Every prop of RN's `ImageProps` is taken.

### Where the network slice departs from RN iOS

Each of these was a decision of the slice, recorded in the [evidence](../evidence/images-network/README.md)
and in its `report.json`. Those that rest on how `NSURLSession` and `NSURLCache` behave inside (progress
of a cached response, what the cache keeps, revalidation, the `gzip` offer) come from Apple's
documentation and RN's code and were not compared on an iOS device.

- **Progress is coalesced** to at most one event per request per pump, cumulative; iOS reports one per
  chunk (`RCTNetworkTask.mm:211-215`). A picture served from either cache reports none.
- **The byte cache is the host's own** (`native/image_cache.h:24-28`, `native/image_sources.cpp:162-199`):
  memory only, 20 MiB, no entry over 1 MiB, only a 200 for a `GET` without a body, under the URL that was
  asked for (a redirect's own response is not kept), with `Date` taken as the arrival time when the response
  has none. A stale entry is downloaded again, never revalidated (no `If-None-Match`, no 304), and `Vary`,
  `Set-Cookie` and `Authorization` are ignored when a response is kept. `queryCache` answers `memory` or
  nothing.
- **`prefetch` keeps only the bytes**; `RCTImageLoader` also stores the decoded picture under the key of size
  0x0 (1267-1297), which no view asks for. `getSize` does not consult the decoded cache. `prefetch` also
  accepts local sources.
- **Failure texts of the transport are the host's** (`Failed to connect to 127.0.0.1:N`, `unexpected end of
  stream from H:N`, `The request timed out.`), and a header name or value the wire cannot carry, or a
  method the transport cannot send, fails through `onError` before any request
  (`native/image_network.cpp:32-55`).
- **No departure in the error payload.** The status and the headers that come with a failure are the ones
  `RCTImageLoader` hands the completion (`native/image_network.cpp:57-73`), and `GodotImage` sends them as
  `responseCode` and `httpResponseHeaders` (`native/image_view.cpp:152-162`), as `RCTImageComponentView`
  does from the `userInfo` that `addResponseHeadersToError` fills (see above).
- **No cookies, no compression offered** (iOS offers `gzip` and decodes it), HTTP/1.1 only, and cleartext
  http is allowed for a request without credentials (App Transport Security blocks it by default on iOS; a
  request with credentials is refused, below).
- **A request that carries credentials neither reads nor writes either cache**, which is stricter than iOS.
  `RCTImageCache` and `NSURLCache` are keyed by URL (`RCTImageCache.mm:30-34`), so on iOS a response fetched
  with one credential can answer a request that carries another or none; here a request whose headers
  carry `Authorization`, `Proxy-Authorization` or `Cookie` (`native/image_cache.h:172-177`, `route()` at
  204-221, `ImageSources::resolve` and `keep_picture`) always asks the server, `only-if-cached` finds nothing
  for it, and `queryCache` still reports what the byte cache holds.
- **A request that carries those headers over http is refused** (`native/image_network.cpp:32-55`): it fails
  through `onError`, or rejects a size, with a host message before any request. iOS reaches the same end
  through App Transport Security, which blocks cleartext http by default; the host blocks only the http
  that carries credentials.
- **Host policy.** A response over 128 MiB is refused, by `Content-Length` or as it arrives, and a download
  that receives no bytes for 60 s fails with `The request timed out.` (`native/image_network.cpp:187-241`);
  RN bounds concurrency, not the size of a response, and 60 s is `NSURLSession`'s default request timeout
  read as idleness. The limit of four downloads is exact, where `dequeueTasks` can let a fifth run after a
  cancellation (432-437).
- **The OS memory warning empties both caches** (`native/app_lifecycle.h:46-53`,
  `native/application_runtime.cpp:608-610`); `RCTImageCache` also empties when the app resigns active, and
  this host does not.
- **`crossOrigin` and `referrerPolicy`** become request headers as `ImageSourceUtils.js` makes them, and
  the source's own headers are used as given.

### Where the visual slice departs from RN iOS

Each of these is recorded in the [evidence](../evidence/images-visual/README.md) and in its `report.json`. None was
compared with an iOS device.

- **The blur is not bit-identical to vImage's.** `vImageBoxConvolve_ARGB8888` is closed, so the host states its own
  arithmetic (`native/image_effects_core.h:59-67` and `71-125`): premultiply by `round(c a / 255)`, two square box
  passes whose window mean is rounded to the nearest once (an odd divisor leaves no tie), straighten by
  `round(p 255 / a)` capped at 255 with black where `a` is 0. A box over 2^20 pixels is limited to it. The box, the
  two passes, the premultiplied alpha and the extended edge are RN's (`RCTImageBlurUtils.mm:52-53`, `76-96`).
- **`tintColor`, `capInsets` and the clip take effect on the next draw.** On iOS the template and the caps are
  applied when an image response arrives (`RCTImageComponentView.mm:144-155`): a changed `tintColor` waits for the
  next response, and clearing it leaves a template image tinted by the window.
- **`onLoad` comes after the blur.** The worker blurs before the texture exists. On iOS `onLoad` and `onLoadEnd`
  are sent first (139-140), with the same payload, and the blurred image replaces the view's later (157-166).
- **`capInsets` apply to `stretch` and `repeat` only.** UIKit's behavior for a resizable image under the other
  content modes, the tiling of its edges in `repeat` and a view smaller than the caps were not verified; Godot's
  nine-patch does not limit the margins to the destination, and the host limits them to the picture
  (`patch_margins`, 211-219).
- **A list of `capInsets` is refused.** `graphicsConversions.h:147-180` reads one, but the object form is tried
  first and a list passes for it (155), so RN keeps no inset and logs; the wrapper says so instead.
- **A fully transparent black `tintColor` is not a tint.** RN's C++ color for this host is one integer in which zero
  is "no color" (`graphics/Color.h:56-59`, `graphics/platform/cxx/.../HostPlatformColor.h:19`), and `"transparent"` is
  zero; on iOS it is a defined `UIColor` and the template image disappears.
- **The border is painted below the picture**, by the view's own item; on iOS the border layer is above the image.
  With the clip rules above the picture never reaches the border, so nothing differs in what is seen.
- **A blurred picture has a texture of its own** that no cache holds (RN's blurred `UIImage` is not in
  `RCTImageCache` either, since the blur happens in the view); a box of one pixel leaves the picture as it was,
  with its tint, caps and tiling, as `RCTBlurredImageWithRadius` returns its input (56-62).

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

The network suite ([driver](../../tests/images-network-probe.gd), [oracle](../../tests/images-network-oracle.mjs))
runs a Node server in a child process that records every request as it arrived on the wire and holds
responses until a control request releases them, so the stages wait on state: four downloads at the server
and two queued, a partial body, a download cancelled before and after its head, a swap, the size limit
(announced and found out), the idle timeout moved by the clock offset, and a stop with a decode and five
downloads in flight. The oracle reads the server's log and the served files, recomputes what
`RCTImageLoader`, `RCTImageCache` and `NSURLCache` do with them, and replays the 115 cache and credential operations over a
model of the two caches with the clock each ran at. No check counts progress events or relies on how the
transport segmented the bytes, and each stale time sits more than 20 s from the clock of its stage. The
control on the preceding host runs 37 checks and fails exactly the 30 normative ones among them. Three
retained sabotages break one behavior each: a reload that consults the decoded cache fails 1 check (the oracle
rejects where `c1-reload` came from), a download whose transport request is never closed fails 34 (the oracle
rejects the first Image that does not end in `loadEnd`) and a repeating Image that resizes the shared texture
fails 2 (the oracle rejects the shared texture's pixels).

The visual suite ([driver](../../tests/images-visual-probe.gd), [oracle](../../tests/images-visual-oracle.mjs))
runs in the headless dummy renderer, which draws no pixel and ignores a material's parameters, so it certifies
what the view asked the renderer for: every rectangle, radius, margin and tint of 52 declared Images and 13
live changes (the view's snapshot records the values it passed to `material_set_param` and the commands it added),
and the pixels of the blur by the fingerprint of the bitmap the worker made, which the oracle recomputes pixel by
pixel and the manifest holds for each picture and box. The network stage mounts one picture in six Images in turn
(blurred, plain, blurred, tinted, masked, blurred again) and checks the counters of both caches and the server's log
after each. The control on the preceding host runs all 53 checks and fails exactly the 40 normative ones. Four
retained sabotages break one behavior each: a clip that ignores the border width fails 2 checks, a third blur pass
fails 3, a blurred request that uses the decoded cache fails 8 and cap insets that ignore the scale fail 2, and the
oracle rejects each. Only the example's capture lane, in the native renderer, saw the shader draw: it samples the
tinted icon's pixels, the soft edge of the blurred landscape, the border of the stretched card and the avatars'
corners and borders.

## What stays open for GF-16

- **A disk cache, revalidation, `Vary`, cookies, compression and HTTP/2** for network images, and a pass
  against a remote server, a proxy and real network conditions; the network slice ran against a loopback
  server.
- **A differential comparison of the caches and the failure texts** with iOS.
- **A differential comparison of the visual effects with iOS**: the blur's box and rounding, the template
  rendering, the nine-patch's tiling and its behavior under the other content modes, and a view smaller than its
  caps.
- **A placeholder for `defaultSource` and `loadingIndicatorSource`**, which iOS does not draw either; and
  **`fadeDuration`**, **`progressiveRenderingEnabled`**, **`resizeMethod`**, **`resizeMultiplier`** and
  **`overlayColor`**, which are Android's and are accepted without effect.
- **Hosted CI** for the visual slice.
- **Animated GIF and WebP**, **`nativeImageSource`**, and Image inside Text.
- **Export of assets** for desktop and Android (the iOS hook exists but no exported app ran),
  and a hardware pass of decode memory and the upload budget.
- **Differential parity against RN on iOS**, including ImageIO's rounding and UIKit's tiling.
