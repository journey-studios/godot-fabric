// Platform-owned data shared by Controls and the original RN static ViewConfig.
// Lazy original processors keep this module free of renderer/bootstrap imports.
import { accessibilityAttributes, accessibilityEventTypes } from "./accessibility-view-config.js";
function processGodotColor(value) {
  return require("react-native/Libraries/StyleSheet/processColor").default(value);
}
function normalizeGodotRect(value) {
  return require("react-native/Libraries/StyleSheet/Rect").normalizeRect(value);
}
function processGodotTransform(value) {
  return require("react-native/Libraries/StyleSheet/processTransform").default(value);
}
function processGodotTransformOrigin(value) {
  return require("react-native/Libraries/StyleSheet/processTransformOrigin").default(value);
}

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
for (const name of ["backgroundColor", "borderColor", "borderLeftColor", "borderTopColor", "borderRightColor", "borderBottomColor", "color"])
  style[name] = { process: processGodotColor };
// Upstream processors preserve RN operation order and origin syntax. The
// native host owns affine support and rejects unsupported 3D matrices.
style.transform = { process: processGodotTransform };
style.transformOrigin = { process: processGodotTransformOrigin };
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
        ...["Down", "Move", "Up", "Cancel", "Over", "Out", "Enter", "Leave"].flatMap(phase =>
          [`onPointer${phase}`, `onPointer${phase}Capture`]),
        "onGotPointerCapture",
        "onGotPointerCaptureCapture",
        "onLostPointerCapture",
        "onLostPointerCaptureCapture",
        "onClick",
        "onClickCapture",
      ].map((name) => [name, true]),
    ),
    pointerEvents: true,
    collapsable: true,
    collapsableChildren: true,
    ...accessibilityAttributes,
    hitSlop: { process: normalizeGodotRect },
    kind: true,
    svg: true,
    text: true,
    fontSize: true,
    color: { process: processGodotColor },
    disabled: true,
    placeholder: true,
    submitBehavior: true,
    testID: true,
    nativeID: true,
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
    ...Object.fromEntries(["Down", "Move", "Up", "Cancel", "Over", "Out", "Enter", "Leave", "GotPointerCapture", "LostPointerCapture"]
      .map(phase => {
        const name = phase.endsWith("PointerCapture") ? phase : "Pointer" + phase;
        return [`top${name}`, {phasedRegistrationNames: {bubbled: `on${name}`, captured: `on${name}Capture`,
          ...(["Enter", "Leave"].includes(phase) ? {skipBubbling: true} : {})}}];
      })),
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
    // The host synthesizes click on a primary release, like RN's platforms.
    topClick: {
      phasedRegistrationNames: {
        bubbled: "onClick",
        captured: "onClickCapture",
      },
    },
    topActivate: {
      phasedRegistrationNames: {
        bubbled: "onActivate",
        captured: "onActivateCapture",
      },
    },
  },
  directEventTypes: {
    ...accessibilityEventTypes,
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
export const coreEventConfigs = {
  bubblingEventTypes: controlViewConfig.bubblingEventTypes,
  directEventTypes: {
    ...controlViewConfig.directEventTypes,
    topScroll: { registrationName: "onScroll" },
    topScrollBeginDrag: { registrationName: "onScrollBeginDrag" },
    topScrollEndDrag: { registrationName: "onScrollEndDrag" },
  },
};

// The text styles beyond the Controls' own: RN's Text builds its view config over this base, and a style the
// config does not declare never reaches the paragraph. The Controls' style map above stays as it is.
const textStyle = Object.fromEntries(["fontFamily", "fontWeight", "lineHeight", "letterSpacing", "textAlign"]
  .map(name => [name, true]));

// Generated components extend ViewProps, not the GodotControl-specific props.
export default {
  validAttributes: {
    ...Object.fromEntries(Object.entries(controlViewConfig.validAttributes).filter(([name]) =>
      /^(onTouch|onPointer|onGotPointer|onLostPointer|onClick|onResponder|onStartShould|onMoveShould)/.test(name) ||
      ["style", "testID", "nativeID", "pointerEvents", "hitSlop", "onLayout", "collapsable", "collapsableChildren",
        ...Object.keys(accessibilityAttributes)].includes(name))),
    style: {...controlViewConfig.validAttributes.style, ...textStyle},
  },
  bubblingEventTypes: Object.fromEntries(Object.entries(controlViewConfig.bubblingEventTypes)
    .filter(([name]) => /^(topTouch|topPointer|topGotPointer|topLostPointer|topClick)/.test(name))),
  directEventTypes: { topLayout: { registrationName: "onLayout" }, ...accessibilityEventTypes },
};
