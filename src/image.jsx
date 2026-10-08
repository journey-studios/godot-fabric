import React from "react";
import flattenStyle from "react-native/Libraries/StyleSheet/flattenStyle";
import resolveAssetSource from "react-native/Libraries/Image/resolveAssetSource";
import { getAssetByID } from "react-native/asset-registry";
import { controlViewConfig } from "./components";
import { validateImageProps } from "./image-contract.mjs";
import { useTextAncestor } from "./text";

// RN's Libraries/Image/Image.js only imports itself, so that deep imports pick a platform file; this host resolves
// neither extension. Every importer of RN's Image (ImageBackground, AnimatedImage and the public export) gets this
// module instead (sdk/toolchain/platform-plugin.mjs). The rendering is RN's own Image.ios.js, which reads the
// sources, picks the asset scale and renders the generated host component; this wrapper only refuses what is a mistake
// (image-contract.mjs).
//
// Like RN's index.js, it loads Image.ios.js on first use: that module asks the host for the ImageLoader module as it
// evaluates, and an application that never renders an Image should not create it.
let upstream, failure;
function original() {
  // A module that threw while it evaluated is half initialized when required again: remember why it failed.
  if (failure) throw failure;
  try {
    return (upstream ??= require("react-native/Libraries/Image/Image.ios").default);
  } catch (error) {
    failure = error;
    throw error;
  }
}
const registered = (id) => getAssetByID(id) != null;

function Image({ ref, style, ...props }) {
  if (useTextAncestor()) throw new Error("Inline Controls are not implemented in Godot Text");
  validateImageProps({ ...props }, flattenStyle(style), controlViewConfig.validAttributes.style, registered);
  const Original = original();
  return <Original {...props} ref={ref} style={style} />;
}
Image.displayName = "Image";
Image.getSize = (...args) => original().getSize(...args);
Image.getSizeWithHeaders = (...args) => original().getSizeWithHeaders(...args);
Image.prefetch = (...args) => original().prefetch(...args);
Image.prefetchWithMetadata = (...args) => original().prefetchWithMetadata(...args);
Image.queryCache = (...args) => original().queryCache(...args);
Image.resolveAssetSource = resolveAssetSource;

export default Image;
