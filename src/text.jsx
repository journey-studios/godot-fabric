import React, { createContext, useContext } from "react";
import { register } from "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry";
import { controlViewConfig } from "./components";

const Ancestor = createContext(false);
export function useTextAncestor() {
  return useContext(Ancestor);
}
export const textStyleAttributes = [
  "fontSize",
  "fontFamily",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "color",
];
const style = { ...controlViewConfig.validAttributes.style };
for (const name of textStyleAttributes)
  if (!(name in style)) style[name] = true;
const config = {
  validAttributes: {
    ...controlViewConfig.validAttributes,
    style,
    numberOfLines: true,
    ellipsizeMode: true,
  },
  bubblingEventTypes: controlViewConfig.bubblingEventTypes,
  directEventTypes: controlViewConfig.directEventTypes,
};
// Like RN's textViewConfig, only the paragraph declares onTextLayout and its
// topTextLayout event; RN's NativeVirtualText has neither, so a span drops it.
const Paragraph = register("RCTText", () => ({
  ...config,
  validAttributes: { ...config.validAttributes, onTextLayout: true },
  directEventTypes: {
    ...config.directEventTypes,
    topTextLayout: { registrationName: "onTextLayout" },
  },
  uiViewClassName: "RCTText",
}));
const Span = register("RCTVirtualText", () => ({
  ...config,
  uiViewClassName: "RCTVirtualText",
}));

export function ParagraphText({
  children,
  text,
  style,
  fontSize,
  numberOfLines = 0,
  ellipsizeMode = "tail",
  onTextLayout,
  ...props
}) {
  const nested = useTextAncestor();
  if (fontSize !== undefined && (!Number.isFinite(fontSize) || fontSize <= 0))
    throw new Error("Godot Text fontSize must be finite and positive");
  if (nested && numberOfLines !== 0)
    throw new Error(
      "Godot Text numberOfLines applies to the outer paragraph only",
    );
  if (children !== undefined && text !== undefined)
    throw new Error("Text accepts children or text, not both");
  if (!Number.isInteger(numberOfLines) || numberOfLines < 0)
    throw new Error("Text numberOfLines must be a nonnegative integer");
  if (!["tail", "clip"].includes(ellipsizeMode))
    throw new Error("Godot Text supports tail or clip ellipsizeMode");
  // Inline native attachments, touch spans, selection and platform-specific
  // font scaling require separate contracts. Reject them before native layout.
  for (const name of [
    "onPress",
    "onPressIn",
    "onPressOut",
    "onLongPress",
    "selectable",
    "adjustsFontSizeToFit",
  ])
    if (props[name]) throw new Error(`Godot Text does not implement ${name}`);
  if (onTextLayout != null && typeof onTextLayout !== "function") {
    throw new Error("Godot Text onTextLayout must be a function");
  }
  // RN's span (NativeVirtualText) never emits onTextLayout: it is ignored there.
  const Component = nested ? Span : Paragraph;
  return (
    <Ancestor.Provider value={true}>
      <Component
        {...props}
        {...(nested ? {} : { onTextLayout })}
        style={[
          nested ? {} : { fontSize: 18 },
          style,
          fontSize === undefined ? {} : { fontSize },
        ]}
        numberOfLines={numberOfLines}
        ellipsizeMode={ellipsizeMode}
      >
        {children === undefined ? (text ?? "") : children}
      </Component>
    </Ancestor.Provider>
  );
}
