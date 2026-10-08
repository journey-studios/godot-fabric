// What the Godot Image takes of RN's ImageProps. RN's own Image.ios.js renders the host component; this contract
// decides, before it does, which of its props are mistakes. A source's uri is runtime data, so an unreadable
// one is no mistake here: it fails as a load, through onError. The request a source makes (headers, method, body and cache,
// which crossOrigin and referrerPolicy turn into headers) belongs to the network, and reaches it as RN's ImageSource gives it.
//
// Every other prop of RN's ImageProps is taken, as the reference platform takes it. tintColor, blurRadius and capInsets are drawn
// (image_effects.h), and so are the radii of the style. loadingIndicatorSource, fadeDuration, progressiveRenderingEnabled,
// resizeMethod, resizeMultiplier and overlayColor are Android's: the view config of the iOS component (ImageViewNativeComponent.js,
// the branch that is not Android's) does not list them, so ReactNativeAttributePayload drops them before the native side sees
// them, and defaultSource, which that config does list, is parsed by ImageProps and read by no iOS component. They are accepted
// here and have no effect, as they have none on iOS.
const resizeModes = ["cover", "contain", "stretch", "center", "repeat", "none"];
const objectFits = ["contain", "cover", "fill", "scale-down", "none"];
// Style names that ImageStyle declares and the host's View does not: the tint is read by Image.ios.js and passed on as a prop,
// and the overlay is Android's, which iOS leaves out of its style attributes.
const imageStyles = ["tintColor", "overlayColor"];
const insetNames = ["top", "left", "bottom", "right"];
const handlers = ["onLoadStart", "onLoad", "onLoadEnd", "onError", "onProgress", "onPartialLoad", "onLayout"];

function present(value) {
  return value !== undefined && value !== null;
}
// capInsets is a number or an object of top, left, bottom and right. RN's C++ also reads a list as left, top, right and bottom
// (graphicsConversions.h), but it tries the object form first, and a list passes for one with the keys 0 to 3: it logs "Unsupported
// EdgeInsets map key" for each and keeps no inset. A list is refused here instead of being dropped.
function validateCapInsets(value) {
  if (!present(value)) return;
  const finite = Number.isFinite;
  const valid = typeof value === "number"
    ? finite(value)
    : typeof value === "object" && !Array.isArray(value) && Object.entries(value).every(([name, inset]) => insetNames.includes(name) && finite(inset));
  if (!valid) throw new Error("Godot Image capInsets must be a number or an object of top, left, bottom and right numbers");
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

// `validStyle` holds the style names the Godot View implements; the Image adds its own two (imageStyles).
function validateImageStyle(flat, validStyle) {
  for (const [name, value] of Object.entries(flat ?? {})) {
    if (!present(value)) continue;
    if (imageStyles.includes(name)) continue;
    if (name === "resizeMode" && !resizeModes.includes(value)) throw new Error(`Godot Image resizeMode must be ${resizeModes.join(", ")}`);
    if (name === "objectFit" && !objectFits.includes(value)) throw new Error(`Godot Image objectFit must be ${objectFits.join(", ")}`);
    if (name === "resizeMode" || name === "objectFit") continue;
    if (!Object.hasOwn(validStyle, name)) throw new Error(`Godot Image does not implement style ${name}`);
  }
}

export function validateImageProps(props, flatStyle, validStyle, registered) {
  if (present(props.blurRadius) && !Number.isFinite(props.blurRadius)) throw new Error("Godot Image blurRadius must be a finite number");
  validateCapInsets(props.capInsets);
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
