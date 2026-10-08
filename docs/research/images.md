# Image: RN's own pipeline over worker-thread decoding in Godot

Status: executed local validation against pinned RN 0.87.1 and official Godot 4.7.2 on macOS
arm64. The [first slice's evidence](../evidence/images/README.md) owns the checks of the local
pipeline across actual SceneTree frames (74 when it was recorded, 73 now that the second slice
changed the contract), the control on the preceding host (the 3 normative checks it can reach
fail), two retained sabotages that the probe and the independent oracle both reject and the oracle's
mutations of the genuine report. The [network slice's evidence](../evidence/images-network/README.md)
owns the 72 headless checks over a loopback Node server (HTTP and HTTPS), the control on the
preceding host (37 checks run, the 30 that need the network fail), three retained sabotages that the
probe and the oracle both reject, 27 mutations of the genuine report that the oracle refuses and the
22 headless and 30 graphical checks of the example and its two captures. Hosted CI has not run the
network slice. GF-16 stays open; the network slice closes no checkpoint.

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
  downloader over an `HttpTransport` that `application_runtime.cpp:596-603` makes from the same factory,
  trust and clock as Networking's (a second instance: a shared one would collide on caller-chosen ids and
  `Networking::stop` would end image loads). It builds the request like `NSURLRequestFromImageSource`
  (`build_download_request`, 31-47), runs at most four downloads in first-in-first-out order
  (`start_queued`, 121-177), judges each result like `processResponse` (`judge_download`, 49-66) and
  enforces the size and idle limits and the progress in `settle_active` (179-233). Transport listeners only
  record; cancelling, the limits, the progress and the outcome all happen after `transport->poll()` returns,
  because cancelling inside a listener is a use-after-free in the transport, and `stop()` stops the transport
  first so that no listener runs afterwards (244-249).
- **The route and the two caches.** `native/image_cache.h` holds what needs no Godot: the HTTP date format
  and `integerValue` of `RCTImageCache` (57-105), `response_freshness` (123-157), the decoded key (32-36),
  `route()` (193-211) and `ExpiringLru` (213-302). `native/image_sources.cpp` (`ImageSources`) owns the network
  and both caches: `resolve` (74-157) builds the request, asks `route()` (a decoded hit never touches the
  byte cache, because a lookup moves an entry to the front of its cache), and answers from the decoded
  cache, from the byte cache (decoded again off the main thread) or from a download; `from_download`
  (159-196) keeps a 200 in the byte cache whoever asked (a view, `getSize` or `prefetch`), and `keep_picture`
  (212-217) keeps the decoded picture of a view's request unless it reloaded or the response forbids it.
  Time is the validation clock, moved by `validation_clock_offset_ms` (monotonic for the idle timeout, wall
  for the stale times), so no check sleeps.
- **The statics.** `native/image_loader_module.cpp` answers `getSize` and `getSizeWithHeaders` of a network
  URL (49-80), `prefetchImage` and `prefetchImageWithMetadata` (82-115, which download, check off the main
  thread that the bytes are a picture, and keep only the response) and `queryCache` (88-100, `memory` for a
  URL the byte cache holds).
- **The view and the lifecycle.** `GodotImage` fills `responseCode` and `httpResponseHeaders` of a failure
  (`native/image_view.cpp:152-162`) and tiles without resizing the shared texture (182-190);
  `AppLifecycle::on_memory_warning` (`native/app_lifecycle.h:46-53`) runs the caches' clearing before JS is
  told of a memory warning.

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
- **A wrapper refuses what the host does not implement.** RN's `Image` accepts `tintColor`,
  `blurRadius`, `capInsets`, `defaultSource`, `loadingIndicatorSource`, `fadeDuration`,
  `progressiveRenderingEnabled`, `resizeMethod`, `resizeMultiplier` and `overlayColor`, and a border
  radius on the style. The wrapper makes each fail where the Image renders, with a message that names the prop and why, and invalid
  values, unregistered asset ids and an Image inside `Text` fail with the host's messages, instead
  of dropping them silently.

### Where the network slice departs from RN iOS

Each of these was a decision of the slice, recorded in the [evidence](../evidence/images-network/README.md)
and in its `report.json`. Those that rest on how `NSURLSession` and `NSURLCache` behave inside (progress
of a cached response, what the cache keeps, revalidation, the `gzip` offer) come from Apple's
documentation and RN's code and were not compared on an iOS device.

- **Progress is coalesced** to at most one event per request per pump, cumulative; iOS reports one per
  chunk (`RCTNetworkTask.mm:211-215`). A picture served from either cache reports none.
- **Redirects keep the source's headers** (`native/http_core.h:285-305` drops only an `Authorization`
  that would cross to another origin); iOS replaces them with the cookies' (`RCTHTTPRequestHandler.mm:147-160`).
- **The byte cache is the host's own** (`native/image_cache.h:23-28`, `native/image_sources.cpp:159-196`):
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
  (`native/image_network.cpp:31-47`).
- **No departure in the error payload.** The status and the headers that come with a failure are the ones
  `RCTImageLoader` hands the completion (`native/image_network.cpp:49-66`), and `GodotImage` sends them as
  `responseCode` and `httpResponseHeaders` (`native/image_view.cpp:152-162`), as `RCTImageComponentView`
  does from the `userInfo` that `addResponseHeadersToError` fills (see above).
- **No cookies, no compression offered** (iOS offers `gzip` and decodes it), HTTP/1.1 only, and cleartext
  http is allowed (no App Transport Security).
- **Host policy.** A response over 128 MiB is refused, by `Content-Length` or as it arrives, and a download
  that receives no bytes for 60 s fails with `The request timed out.` (`native/image_network.cpp:179-233`);
  RN bounds concurrency, not the size of a response, and 60 s is `NSURLSession`'s default request timeout
  read as idleness. The limit of four downloads is exact, where `dequeueTasks` can let a fifth run after a
  cancellation (432-437).
- **The OS memory warning empties both caches** (`native/app_lifecycle.h:46-53`,
  `native/application_runtime.cpp:605-607`); `RCTImageCache` also empties when the app resigns active, and
  this host does not.
- **`crossOrigin` and `referrerPolicy`** become request headers as `ImageSourceUtils.js` makes them, and
  the source's own headers are used as given.

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
`RCTImageLoader`, `RCTImageCache` and `NSURLCache` do with them, and replays the 100 cache operations over a
model of the two caches with the clock each ran at. No check counts progress events or relies on how the
transport segmented the bytes, and each stale time sits more than 20 s from the clock of its stage. The
control on the preceding host runs 37 checks and fails exactly the 30 normative ones among them. Three
retained sabotages break one behavior each: a reload that consults the decoded cache fails 1 check (the oracle
rejects where `c1-reload` came from), a download whose transport request is never closed fails 32 (the oracle
rejects the first Image that does not end in `loadEnd`) and a repeating Image that resizes the shared texture
fails 2 (the oracle rejects the shared texture's pixels).

## What stays open for GF-16

- **A disk cache, revalidation, `Vary`, cookies, compression and HTTP/2** for network images, and a pass
  against a remote server, a proxy and real network conditions; the network slice ran against a loopback
  server.
- **Hosted CI** for the network slice, and a differential comparison of the caches and the failure texts with
  iOS.
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
