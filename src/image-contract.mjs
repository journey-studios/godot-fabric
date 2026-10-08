// What the Godot Image takes of RN's ImageProps. RN's own Image.ios.js renders the host component; this contract
// decides, before it does, which of its props this host has no native implementation for yet. Those fail where the
// Image renders, with the next slice named, instead of being dropped. A source's uri is runtime data, so an unreadable
// one is no mistake here: it fails as a load, through onError. The request a source makes (headers, method, body and cache,
// which crossOrigin and referrerPolicy turn into headers) belongs to the network, and reaches it as RN's ImageSource gives it.
const resizeModes = ["cover", "contain", "stretch", "center", "repeat", "none"];
const objectFits = ["contain", "cover", "fill", "scale-down", "none"];
// Props whose native half is a later slice of the Images work (tint needs a shader on the image's own canvas item,
// the others a filter, a nine-patch, a second image, a transition or a decode option).
const laterProps = {
  tintColor: "tinting needs a shader on its own canvas item",
  blurRadius: "blurring is a later image effect",
  capInsets: "nine-patch stretching is a later image mode",
  defaultSource: "placeholder images are a later image state",
  loadingIndicatorSource: "placeholder images are a later image state",
  fadeDuration: "the fade-in transition is a later image state",
  progressiveRenderingEnabled: "progressive decoding is a later image mode",
  resizeMethod: "the decode method is chosen by the host",
  resizeMultiplier: "the decode size is chosen by the host",
  overlayColor: "rounded-corner overlays follow rounded image clipping",
};
const laterStyles = {
  tintColor: laterProps.tintColor,
  overlayColor: laterProps.overlayColor,
};
const handlers = ["onLoadStart", "onLoad", "onLoadEnd", "onError", "onProgress", "onPartialLoad", "onLayout"];

function present(value) {
  return value !== undefined && value !== null;
}
function later(name, reason) {
  return new Error(`Godot Image does not implement ${name} yet: ${reason}`);
}

function validateImageSource(source, registered) {
  if (!present(source)) return;
  if (typeof source === "number") {
    if (!registered(source)) throw new Error("Godot Image source is a number that no asset registered");
    return;
  }
  if (Array.isArray(source)) {
    for (const entry of source) validateImageSource(entry, registered);
    return;
  }
  if (typeof source !== "object") throw new Error("Godot Image source must be an asset, a {uri} object or a list of them");
  if (present(source.uri) && typeof source.uri !== "string") throw new Error("Godot Image source.uri must be a string");
  for (const name of ["width", "height", "scale"]) {
    if (present(source[name]) && !Number.isFinite(source[name])) throw new Error(`Godot Image source.${name} must be a finite number`);
  }
}

// `validStyle` holds the style names the Godot View implements; the Image adds its own two.
function validateImageStyle(flat, validStyle) {
  for (const [name, value] of Object.entries(flat ?? {})) {
    if (!present(value)) continue;
    if (Object.hasOwn(laterStyles, name)) throw later(`style.${name}`, laterStyles[name]);
    if (/^border(?:Top|Bottom)?(?:Left|Right)?Radius$/.test(name)) {
      throw later(`style.${name}`, "the host clips rectangles only, and rounded image clipping is a later slice");
    }
    if (name === "resizeMode" && !resizeModes.includes(value)) throw new Error(`Godot Image resizeMode must be ${resizeModes.join(", ")}`);
    if (name === "objectFit" && !objectFits.includes(value)) throw new Error(`Godot Image objectFit must be ${objectFits.join(", ")}`);
    if (name === "resizeMode" || name === "objectFit") continue;
    if (!Object.hasOwn(validStyle, name)) throw new Error(`Godot Image does not implement style ${name}`);
  }
}

export function validateImageProps(props, flatStyle, validStyle, registered) {
  for (const [name, reason] of Object.entries(laterProps)) {
    if (present(props[name])) throw later(name, reason);
  }
  if (present(props.resizeMode) && !resizeModes.includes(props.resizeMode)) {
    throw new Error(`Godot Image resizeMode must be ${resizeModes.join(", ")}`);
  }
  for (const name of handlers) {
    if (present(props[name]) && typeof props[name] !== "function") throw new Error(`Image ${name} must be a function`);
  }
  for (const name of ["src", "srcSet"]) {
    if (present(props[name]) && typeof props[name] !== "string") throw new Error(`Godot Image ${name} must be a string`);
  }
  if (props.testID !== undefined && typeof props.testID !== "string") throw new Error("Image testID must be a string");
  validateImageSource(props.source, registered);
  validateImageStyle(flatStyle, validStyle);
}
