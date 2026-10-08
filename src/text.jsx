// The module of the facade's Text: its host contract (what this platform accepts and rejects) around RN's
// ORIGINAL Libraries/Text/Text.js. The original owns the props, the style processing, the Pressability of a
// pressable paragraph and the two native components (NativeText, NativeVirtualText), which register RCTText and
// RCTVirtualText with their own view configs over the platform's base config (src/base-view-config.js).
import React, { useContext } from "react";
import OriginalText from "react-native/Libraries/Text/Text";
import TextAncestorContext from "react-native/Libraries/Text/TextAncestorContext";
import { checkProps } from "./prop-scope.mjs";

// The context RN's own View and Text read, so that a Text, a View and the facade's Controls agree on what is
// inside a paragraph.
export function useTextAncestor() {
  return useContext(TextAncestorContext);
}
// The text styles, one list for the platform: the base view config declares them for RN's Text and the facade's
// style checks read them from here.
export { textStyleAttributes } from "./base-view-config.js";
// The size of an outer paragraph that sets none. RN's is 14; this platform kept its own 18 (see
// docs/research/text-original.md), and the spans inherit whichever size their paragraph has.
const DEFAULT_FONT_SIZE = 18;
// A nested Text is a span of its paragraph. A press on a span needs hit testing by fragment and its own dispatch,
// which the host does not have: only the outer paragraph is pressable. Text.js hands every responder prop it does
// not know to the span's host component, so the whole family is refused by its shape and not by a list that would
// have to follow RN: the four press props, and every onResponder*, onStartShouldSetResponder* and
// onMoveShouldSetResponder* (the Capture, Reject, Start, End and Termination variants included).
const pressProps = ["onPress", "onPressIn", "onPressOut", "onLongPress"];
const responderProp = /^on(Responder|StartShouldSetResponder|MoveShouldSetResponder)/;
const isSpanPressProp = name => pressProps.includes(name) || responderProp.test(name);

// The props RN's Text declares and the paragraph cannot honor (selectable, adjustsFontSizeToFit, selectionColor, the platform
// text options, head and middle ellipsis), and the two props of this platform's earlier wrapper that RN's Text never had,
// fail in src/prop-scope.mjs, on the mount and on every update, because the check runs in the render.
export function ParagraphText(allProps) {
  checkProps("Text", allProps);
  const { style, numberOfLines, ellipsizeMode, onTextLayout, ...props } = allProps;
  const nested = useTextAncestor();
  if (nested) {
    for (const name of Object.keys(props)) {
      if (isSpanPressProp(name) && props[name] != null) {
        throw new Error(`Godot Text does not implement ${name} on a nested Text: only the outer paragraph is pressable`);
      }
    }
    if (numberOfLines != null && numberOfLines !== 0) {
      throw new Error("Godot Text numberOfLines applies to the outer paragraph only");
    }
  }
  if (numberOfLines != null && (!Number.isInteger(numberOfLines) || numberOfLines < 0)) {
    throw new Error("Text numberOfLines must be a nonnegative integer");
  }
  if (onTextLayout != null && typeof onTextLayout !== "function") {
    throw new Error("Godot Text onTextLayout must be a function");
  }
  // RN's span (NativeVirtualText) never emits onTextLayout: it is ignored there.
  return (
    <OriginalText
      {...props}
      {...(nested ? {} : { onTextLayout })}
      style={nested ? style : [{ fontSize: DEFAULT_FONT_SIZE }, style]}
      numberOfLines={numberOfLines}
      ellipsizeMode={ellipsizeMode}
    />
  );
}
