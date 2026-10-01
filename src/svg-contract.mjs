// Explicit subset of react-native-svg's public primitives. This is a Godot
// platform adapter, not the upstream iOS/Android SVG native implementation.
const shared = [
  "id",
  "fill",
  "fillOpacity",
  "stroke",
  "strokeWidth",
  "strokeOpacity",
  "strokeDasharray",
  "strokeLinecap",
  "strokeLinejoin",
  "opacity",
  "clipPath",
];
const attributes = {
  svg: ["width", "height", "viewBox"],
  g: [],
  defs: [],
  clipPath: [],
  path: ["d"],
  rect: ["x", "y", "width", "height", "rx", "ry"],
  circle: ["cx", "cy", "r"],
  line: ["x1", "x2", "y1", "y2"],
  linearGradient: ["x1", "x2", "y1", "y2", "gradientUnits"],
  stop: ["offset", "stopColor", "stopOpacity"],
  text: ["x", "y", "fontSize", "fontWeight", "textAnchor"],
};
export function svgPayload(tag, props) {
  if (!attributes[tag])
    throw new Error(`Unsupported Godot SVG primitive: ${tag}`);
  const allowed = new Set([...shared, ...attributes[tag]]);
  const attrs = {};
  for (const [name, value] of Object.entries(props)) {
    if (value == null || ["children", "testID", "pointerEvents"].includes(name))
      continue;
    // Chart Kit supplies the tooltip text both as a hint and as children.
    if (name === "text" && tag === "text") continue;
    if (!allowed.has(name))
      throw new Error(`Unsupported Godot SVG ${tag} prop: ${name}`);
    if (typeof value !== "string" && typeof value !== "number")
      throw new Error(`Godot SVG ${name} must be a string or number`);
    if (typeof value === "number" && !Number.isFinite(value))
      throw new Error(`Godot SVG ${name} must be finite`);
    if (
      tag === "text" &&
      ["x", "y", "fontSize"].includes(name) &&
      !Number.isFinite(Number(value))
    )
      throw new Error(`Godot SVG text ${name} requires a numeric coordinate`);
    const xmlName = ["viewBox", "gradientUnits"].includes(name)
      ? name
      : name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    attrs[xmlName] = String(value);
  }
  let text = "";
  if (tag === "text") {
    const values = Array.isArray(props.children)
      ? props.children.flat(Infinity)
      : [props.children ?? props.text ?? ""];
    if (
      values.some(
        (value) => typeof value !== "string" && typeof value !== "number",
      )
    )
      throw new Error("Godot SVG Text supports plain strings/numbers");
    text = values.join("");
    if (
      attrs["text-anchor"] &&
      !["start", "middle", "end"].includes(attrs["text-anchor"])
    )
      throw new Error("Godot SVG Text anchor must be start, middle or end");
    // Drawing text through Godot's Font does not implement clipping/inheritance.
    if (attrs["clip-path"])
      throw new Error("Godot SVG text clipping is not implemented");
    if (Object.keys(attrs).some((key) => key.startsWith("stroke")))
      throw new Error("Godot SVG text stroke is not implemented");
    if (attrs.fill && !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(attrs.fill))
      throw new Error("Godot SVG text fill requires a hex RGB or RGBA color");
    if (
      attrs["font-size"] &&
      !(
        Number(attrs["font-size"]) >= 1 &&
        Number.isInteger(Number(attrs["font-size"]))
      )
    )
      throw new Error("Godot SVG text fontSize requires a positive integer");
    if (
      attrs["font-weight"] &&
      !["400", "600", "normal"].includes(attrs["font-weight"])
    )
      throw new Error("Godot SVG Text supports fontWeight 400 or 600");
  }
  if (tag === "g" && Object.keys(attrs).some((key) => key !== "id"))
    throw new Error("Godot SVG group attribute inheritance is not implemented");
  if (tag === "svg") {
    if (
      Object.keys(attrs).some(
        (key) => !["id", "width", "height", "viewBox"].includes(key),
      )
    )
      throw new Error(
        "Godot SVG root attribute inheritance is not implemented",
      );
    const width = Number(attrs.width),
      height = Number(attrs.height);
    if (!(width > 0 && height > 0 && width <= 2048 && height <= 2048))
      throw new Error(
        "Godot SVG surface must be between 1 and 2048 logical pixels",
      );
    if (attrs.viewBox && attrs.viewBox !== `0 0 ${width} ${height}`)
      throw new Error(
        "Godot SVG currently requires an unscaled 0 0 width height viewBox",
      );
  }
  return JSON.stringify({ tag, attrs, text });
}
