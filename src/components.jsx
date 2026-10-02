import React, {
  useState,
  useRef,
  useLayoutEffect,
  useCallback,
  useMemo,
} from "react";
import { register } from "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry";

import usePressability from "react-native/Libraries/Pressability/usePressability";
import { normalizeRect } from "react-native/Libraries/StyleSheet/Rect";
import processColor from "react-native/Libraries/StyleSheet/processColor";

const style = Object.fromEntries(
  [
    "width",
    "height",
    "minWidth",
    "minHeight",
    "maxWidth",
    "maxHeight",
    "flex",
    "flexGrow",
    "flexShrink",
    "flexBasis",
    "flexDirection",
    "flexWrap",
    "justifyContent",
    "alignItems",
    "alignSelf",
    "alignContent",
    "gap",
    "rowGap",
    "columnGap",
    "padding",
    "paddingHorizontal",
    "paddingVertical",
    "paddingLeft",
    "paddingRight",
    "paddingTop",
    "paddingBottom",
    "margin",
    "marginHorizontal",
    "marginVertical",
    "marginLeft",
    "marginRight",
    "marginTop",
    "marginBottom",
    "position",
    "top",
    "left",
    "bottom",
    "right",
    "display",
    "opacity",
    "zIndex",
    "overflow",
  ].map((name) => [name, true]),
);
for (const name of ["backgroundColor", "borderColor", "color"])
  style[name] = { process: processColor };
for (const name of [
  "borderWidth",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderRadius",
  "borderTopLeftRadius",
  "borderTopRightRadius",
  "borderBottomLeftRadius",
  "borderBottomRightRadius",
  "borderStyle",
  "fontSize",
])
  style[name] = true;
export const controlViewConfig = {
  uiViewClassName: "GodotControl",
  validAttributes: {
    ...Object.fromEntries(
      [
        "onStartShouldSetResponder",
        "onStartShouldSetResponderCapture",
        "onMoveShouldSetResponder",
        "onMoveShouldSetResponderCapture",
        "onResponderGrant",
        "onResponderReject",
        "onResponderStart",
        "onResponderEnd",
        "onResponderMove",
        "onResponderRelease",
        "onResponderTerminate",
        "onResponderTerminationRequest",
        "onTouchStart",
        "onTouchStartCapture",
        "onTouchMove",
        "onTouchMoveCapture",
        "onTouchEnd",
        "onTouchEndCapture",
        "onTouchCancel",
        "onTouchCancelCapture",
      ].map((name) => [name, true]),
    ),
    pointerEvents: true,
    hitSlop: { process: normalizeRect },
    kind: true,
    svg: true,
    text: true,
    fontSize: true,
    color: { process: processColor },
    disabled: true,
    placeholder: true,
    submitBehavior: true,
    testID: true,
    onActivate: true,
    onActivateCapture: true,
    onChange: true,
    onFocus: true,
    onBlur: true,
    onEndEditing: true,
    onSubmitEditing: true,
    onSelectionChange: true,
    onKeyPress: true,
    onLayout: true,
    style,
  },
  bubblingEventTypes: {
    ...Object.fromEntries(
      ["Start", "Move", "End", "Cancel"].map((phase) => [
        `topTouch${phase}`,
        {
          phasedRegistrationNames: {
            bubbled: `onTouch${phase}`,
            captured: `onTouch${phase}Capture`,
          },
        },
      ]),
    ),
    topActivate: {
      phasedRegistrationNames: {
        bubbled: "onActivate",
        captured: "onActivateCapture",
      },
    },
  },
  directEventTypes: {
    topChange: { registrationName: "onChange" },
    topFocus: { registrationName: "onFocus" },
    topBlur: { registrationName: "onBlur" },
    topEndEditing: { registrationName: "onEndEditing" },
    topSubmitEditing: { registrationName: "onSubmitEditing" },
    topSelectionChange: { registrationName: "onSelectionChange" },
    topKeyPress: { registrationName: "onKeyPress" },
    topLayout: { registrationName: "onLayout" },
  },
};
export const NativeControl = register("GodotControl", () => controlViewConfig);
export function View(props) {
  return <NativeControl {...props} kind="view" />;
}
export function Text({ children, text, ...props }) {
  if (children !== undefined && text !== undefined)
    throw new Error("Text accepts children or text, not both");
  const values =
    children === undefined ? [text ?? ""] : React.Children.toArray(children);
  if (
    values.some(
      (value) => typeof value !== "string" && typeof value !== "number",
    )
  )
    throw new Error(
      "Godot Text currently accepts plain strings/numbers; rich text is not implemented",
    );
  return <NativeControl {...props} text={values.join("")} kind="text" />;
}
export function Button(props) {
  return <NativeControl {...props} kind="button" />;
}
export function TextInput({
  ref,
  value,
  text,
  defaultValue = "",
  selection,
  editable = true,
  disabled = false,
  placeholder = "",
  submitBehavior = "blurAndSubmit",
  multiline = false,
  onChange,
  onChangeText,
  onSelectionChange,
  ...props
}) {
  if (value !== undefined && text !== undefined)
    throw new Error(
      "TextInput accepts value or the legacy text prop, not both",
    );
  if (multiline)
    throw new Error("Godot TextInput currently supports a single line");
  if (!["submit", "blurAndSubmit"].includes(submitBehavior))
    throw new Error("TextInput submitBehavior must be submit or blurAndSubmit");
  const controlled = value ?? text;
  if (
    (controlled !== undefined && typeof controlled !== "string") ||
    typeof defaultValue !== "string"
  )
    throw new Error("TextInput value/text/defaultValue must be strings");
  if (
    selection &&
    (!Number.isInteger(selection.start) ||
      selection.start < 0 ||
      (selection.end !== undefined &&
        (!Number.isInteger(selection.end) || selection.end < 0)))
  )
    throw new Error("TextInput selection uses nonnegative UTF-16 offsets");
  const initial = useRef(controlled ?? defaultValue);
  const native = useRef(null);
  const [eventCount, acknowledge] = useState(0);
  const [nativeSelection, observeSelection] = useState(null);
  const attach = useCallback(
    (instance) => {
      native.current = instance;
      let cleanup;
      if (typeof ref === "function") cleanup = ref(instance);
      else if (ref) ref.current = instance;
      return () => {
        native.current = null;
        if (typeof cleanup === "function") cleanup();
        else if (typeof ref === "function") ref(null);
        else if (ref) ref.current = null;
      };
    },
    [ref],
  );
  useLayoutEffect(() => {
    if (controlled === undefined && selection === undefined) return;
    native.current?.setTextAndSelection(
      eventCount,
      controlled ?? null,
      selection?.start ?? -1,
      selection?.end ?? selection?.start ?? -1,
    );
  }, [
    eventCount,
    controlled,
    selection?.start,
    selection?.end,
    nativeSelection?.start,
    nativeSelection?.end,
  ]);
  return (
    <NativeControl
      {...props}
      ref={attach}
      kind="input"
      text={controlled ?? initial.current}
      disabled={disabled || !editable}
      placeholder={placeholder}
      submitBehavior={submitBehavior}
      onSelectionChange={(event) => {
        onSelectionChange?.(event);
        observeSelection(event.nativeEvent.selection);
      }}
      onChange={(event) => {
        onChange?.(event);
        onChangeText?.(event.nativeEvent.text);
        // Updating the acknowledgement also rerenders a controlled input whose
        // owner rejects an edit by leaving its value unchanged.
        acknowledge(event.nativeEvent.eventCount);
      }}
    />
  );
}

// This wrapper supplies Godot's View and React's pressed render state. The
// responder handlers, geometry, delays and transitions are upstream Pressability.
export function Pressable({
  children,
  style,
  disabled = false,
  hitSlop,
  pressRetentionOffset,
  delayLongPress,
  unstable_pressDelay,
  cancelable,
  blockNativeResponder,
  onPress,
  onPressMove,
  onPressIn,
  onPressOut,
  onLongPress,
  onHoverIn,
  onHoverOut,
  ...props
}) {
  if (onHoverIn || onHoverOut)
    throw new Error("Godot Pressable hover events are not implemented yet");
  const [pressed, setPressed] = useState(false);
  const config = useMemo(
    () => ({
      disabled,
      hitSlop,
      pressRectOffset: pressRetentionOffset,
      delayLongPress,
      delayPressIn: unstable_pressDelay,
      cancelable,
      blockNativeResponder,
      onPress,
      onPressMove,
      onLongPress,
      onPressIn(event) {
        setPressed(true);
        onPressIn?.(event);
      },
      onPressOut(event) {
        setPressed(false);
        onPressOut?.(event);
      },
    }),
    [
      disabled,
      hitSlop,
      pressRetentionOffset,
      delayLongPress,
      unstable_pressDelay,
      cancelable,
      blockNativeResponder,
      onPress,
      onPressMove,
      onPressIn,
      onPressOut,
      onLongPress,
    ],
  );
  const handlers = usePressability(config);
  // Hover/click activation needs a desktop/accessibility adapter. Never pretend
  // those paths work by registering callbacks that native input cannot emit.
  const { onMouseEnter, onMouseLeave, onClick, ...responderHandlers } =
    handlers;
  return (
    <View
      {...props}
      {...responderHandlers}
      disabled={disabled}
      hitSlop={hitSlop}
      style={typeof style === "function" ? style({ pressed }) : style}
    >
      {typeof children === "function" ? children({ pressed }) : children}
    </View>
  );
}
