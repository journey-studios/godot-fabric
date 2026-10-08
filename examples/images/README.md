# Image

```sh
npm run example -- images
npm run example -- images --headless
npm run example -- images --capture
npm run test:images
```

The public `Image`, `ImageBackground`, `Animated.Image` and `AssetRegistry` are React Native's
originals: `Image.ios.js`, `ImageBackground.js`, `AnimatedImage.js` and the asset registry that
Metro's asset modules register in. Because Godot is not Android, `Image` takes its iOS-family
path: the generated `RCTImageView` component, its `onLoadStart`, `onProgress`, `onLoad`,
`onError` and `onLoadEnd` events, and the `ImageLoader` TurboModule for `getSize`. The native
half is React Native's own C++ image pipeline (`ImageShadowNode`, `ImageRequest` and the observer
coordinator) over a host `ImageManager`: every request is read and decoded on Godot's
`WorkerThreadPool`, never on the main thread, and a `GodotImage` view draws the texture in the
content frame with the six resize modes UIKit maps (`RCTImagePrimitivesConversions.h`).

The launcher entry is the interactive demo: the six resize modes of one bundled landscape; a logo
with `@1x`, `@2x` and `@3x` files, which RN's `pickScale` chooses between by the content scale; a
PNG and an SVG as `data:` URIs; an `ImageBackground` with a child over the picture; a picture that
does not exist and fails through `onError`; and a preview that two buttons change (the next resize
mode, and the picture itself). The example runs at a content scale of 2, so the `@2x` logo is the
file RN picks and the texture has its 64 pixels for a 32 point layout.

## What the validation establishes

[validation.gd](validation.gd) sends real Godot mouse input and reads each picture from the native
`GodotImage` that shows it, from what JS observed and, with `--capture`, from the renderer's frame.
It checks that the example mounts twelve Images and two buttons and that every picture that exists
loads; that `pickScale` chooses `logo@2x.png` at a pixel ratio of 2 and the texture has that file's
64x64 pixels while its layout is the asset's 32x32 points; that each of the six resize modes draws
the rectangles UIKit draws for a 120x60 point picture in an 84x84 point frame (repeat tiles at the
picture's size in points); that the `data:` PNG is shown at its size in points and the `data:` SVG
is rasterized at the content scale; that the `ImageBackground` draws its picture under its `Text`
child; that the missing picture fails through `onError`, leaves no texture and shows why; that JS
saw `loadStart`, `load` and `loadEnd` for each picture and `loadStart`, `error` and `loadEnd` for
the missing one; and that the loader's own record shows all twelve pictures read and decoded on
worker threads, eleven loaded and one failed. Six real clicks take the preview through the six
resize modes, redrawing it each time and loading nothing; a click on the second button swaps the
picture, which is a new request with one `loadStart` and one `load`. Stopping the application
awaits every worker task and leaves no texture. With `--capture`, the renderer's frame shows the
left-edge mark in stretch, contain and repeat and crops it out in cover and center, draws `none`
at the top-left corner with the bottom of the frame bare, and the six tiles have six different
digests. The headless run passes 17 checks and the capture run 25.

## Evidence suite

```sh
npm run test:images
```

With the preceding native host installed, the runner checks the control:

```sh
node tests/images-native.test.mjs --allow-original-negative
```

and `node scripts/images-sabotage.mjs` runs the retained sabotages (decoding on the main thread,
and a view that keeps listening to a request it swapped away from).

## Original syntax

```jsx
import {Image, ImageBackground} from 'react-native';

export function Cover() {
  return (
    <ImageBackground source={require('./cover.png')} resizeMode="cover" style={{width: 320, height: 180}}>
      <Image source={{uri: 'data:image/png;base64,iVBOR...'}} style={{width: 48, height: 48}} />
    </ImageBackground>
  );
}
```

A `require()`d image is the module Metro makes of it: `npm run bundle` and the SDK builder register
every `@Nx` variant with the asset registry and copy the files beside the bundle with a
`<bundle>.assets.json` manifest. Sources are `require()` assets, `res://`, `user://`, absolute
`file://` and `data:` URIs; PNG, JPEG, WebP, BMP, TGA and SVG decode, and GIF or anything else
fails through `onError`.

## Limits

`tintColor`, `blurRadius`, `capInsets`, `defaultSource`, `loadingIndicatorSource`, `fadeDuration`,
`progressiveRenderingEnabled`, `resizeMethod`, `resizeMultiplier`, `overlayColor`, a border radius
on the image's own style, and `headers`, `method`, `body` and `cache` on a source fail where the
Image renders, naming the later slice. Network images, the decoded-image cache and prefetch,
animated GIF and WebP, and desktop and Android export of assets are not delivered yet.
