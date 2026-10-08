// The module of the facade's Text: its host contract (what this platform accepts and rejects) around RN's
// ORIGINAL Libraries/Text/Text.js. The original owns the props, the style processing, the Pressability of a
// pressable paragraph and the two native components (NativeText, NativeVirtualText), which register RCTText and
// RCTVirtualText with their own view configs over the platform's base config (src/base-view-config.js).
import React, { useContext } from "react";
import OriginalText from "react-native/Libraries/Text/Text";
import TextAncestorContext from "react-native/Libraries/Text/TextAncestorContext";

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
// Props that exist in RN's Text and that this platform's paragraph cannot honor yet. The host would otherwise
// drop them without a word, so they fail where the Text renders: the two flags when they are on, the rest when
// they are set at all.
const unsupportedFlags = ["selectable", "adjustsFontSizeToFit"];
const unsupportedProps = [
  "selectionColor",
  "dataDetectorType",
  "textBreakStrategy",
  "lineBreakStrategyIOS",
  "android_hyphenationFrequency",
];
// The props of this platform's earlier wrapper that RN's Text does not have, and what to do instead.
const wrapperOnlyProps = { text: "pass the text as children", fontSize: "set it in style" };
// A nested Text is a span of its paragraph. A press on a span needs hit testing by fragment and its own dispatch,
// which the host does not have: only the outer paragraph is pressable.
const spanPressProps = [
  "onPress",
  "onPressIn",
  "onPressOut",
  "onLongPress",
  "onStartShouldSetResponder",
  "onMoveShouldSetResponder",
  "onResponderGrant",
  "onResponderMove",
  "onResponderRelease",
  "onResponderTerminate",
  "onResponderTerminationRequest",
];

export function ParagraphText({ style, numberOfLines, ellipsizeMode, onTextLayout, ...props }) {
  const nested = useTextAncestor();
  // The wrapper of this platform used to accept these two; RN's Text has neither.
  for (const [name, hint] of Object.entries(wrapperOnlyProps)) {
    if (props[name] !== undefined) {
      throw new Error(`Godot Text does not implement ${name}: it is not a prop of RN's Text, ${hint}`);
    }
  }
  for (const name of unsupportedFlags) {
    if (props[name]) {
      throw new Error(`Godot Text does not implement ${name}`);
    }
  }
  for (const name of unsupportedProps) {
    if (props[name] != null) {
      throw new Error(`Godot Text does not implement ${name}`);
    }
  }
  if (nested) {
    for (const name of spanPressProps) {
      if (props[name] != null) {
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
  if (ellipsizeMode != null && !["tail", "clip"].includes(ellipsizeMode)) {
    throw new Error("Godot Text supports tail or clip ellipsizeMode");
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
