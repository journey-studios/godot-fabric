// What the Godot platform does with every prop that React Native 0.87.1 declares for the six components the Frontier
// HUD renders from the facade: View, Text, Pressable, Image, Modal and ActivityIndicator. One module owns the tables and
// the one checker that the facades call on every render, so that a prop is never accepted without anyone having decided
// it (GF-04, "no silent acceptance"), on mount and on update alike.
//
// A declared prop is classified exactly once, by the names in docs/compatibility/contracts-0.87.1.json (the owner rows):
//
//   supported  it has behavior on this host: the view config lets it reach the host, or the facade or RN's own JS
//              consumes it with an effect. `how` says which ("host" or "js"), `via` names the prop RN's JS turns it into.
//   ignored    it is accepted and changes nothing, for the reason and the source given. `basis` says why:
//                ios-drops       RN's iOS view config does not list the name RN's JS finally sends, so
//                                ReactNativeAttributePayload drops it before any native code sees it (Android's props);
//                ios-noop        the name is forwarded as it is and no iOS component reads it;
//                android-native  only RN's Android host props read it;
//                not-forwarded   the RN JS component never passes it on (Modal.js reads a handful of props);
//                overwritten     the RN JS component replaces the value with its own;
//                dependent       it only matters together with a prop that is refused;
//                decision        an earlier, documented decision of this platform.
//   refused    iOS has behavior that Godot does not implement (`basis: "ios"`), or an earlier decision refuses it
//              (`basis: "decision"`): the facade throws `Godot <Component> does not implement <prop>` when the value is
//              not null or undefined, unless `accepts` lists it. `accepts` is the list of the values that work, the value
//              that leaves the host as it is first: RN's default, which does nothing on iOS either (the view only acts when
//              a value leaves it), and `defaultSource` names the RN source that gives or describes it. A flag that is off by
//              default accepts [false]. The ScrollView's behavior props list instead the request its host can honor, which
//              is not always RN's default (bounces: false, where iOS bounces). A prop without `accepts` fails with any value
//              that is not null: a function (on*) has no default, and a prop that is not a function says in its `reason` that
//              it has no default or that its default is included. `typed` marks a prop that types/react-native.ts keeps,
//              with the values it accepts. `message` replaces the text where an earlier decision published another one,
//              `probe` is a value that fails.
//
// One class of props has behavior on iOS and is nevertheless ignored here, and says so: the ones that RN's own components hand
// to every View they render (RN's touchables clone their child with a computed `focusable`, and TouchableNativeFeedback with an
// `accessibilityValue` object; VirtualizedList's cells register `onFocusCapture`). A refusal would break those components, and
// docs/research/accessibility.md already records the accessibility ones as not mapped yet and dropped by the view config.
//
// A key that RN does not declare for the component is never checked: RN's Fabric view config drops every name it does
// not list. This is the one rule for undeclared keys. Two documented exceptions follow it: `legacyProps`, the props of
// this platform's earlier wrapper that RN's Text never had, and the Pressable, which renders the host's Control and so
// drops the undeclared keys itself (`declaredProps`) instead of leaving them to a view config that lists Control-only
// names such as `text` and `kind`.
//
// The tables only say what each prop is. tests/scope-0.5.test.mjs checks them against the inventory, the view configs
// and RN's iOS sources, and docs/compatibility/scope-0.5.json carries them for the reader and for the independent oracle
// of the native suite.

const iosBase = "react-native/Libraries/NativeComponent/BaseViewConfig.ios.js";
const iosView = "react-native/React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm";
const androidView = "react-native/ReactCommon/react/renderer/components/view/platform/android/react/renderer/components/view/HostPlatformViewProps.cpp";
const viewJs = "react-native/Libraries/Components/View/View.js";
const pressableJs = "react-native/Libraries/Components/Pressable/Pressable.js";
const textJs = "react-native/Libraries/Text/Text.js";
const textConfig = "react-native/Libraries/Text/TextNativeComponent.js";
const imageJs = "react-native/Libraries/Image/Image.ios.js";
const imageConfig = "react-native/Libraries/Image/ImageViewNativeComponent.js";
const indicatorJs = "react-native/Libraries/Components/ActivityIndicator/ActivityIndicator.js";
const modalJs = "react-native/Libraries/Modal/Modal.js";
const touchableWithoutFeedbackJs = "react-native/Libraries/Components/Touchable/TouchableWithoutFeedback.js";
const touchableNativeFeedbackJs = "react-native/Libraries/Components/Touchable/TouchableNativeFeedback.js";
const touchableOpacityJs = "react-native/Libraries/Components/Touchable/TouchableOpacity.js";
const listCellJs = "@react-native/virtualized-lists/Lists/VirtualizedListCellRenderer.js";
const accessibilityDecisions = "docs/research/accessibility.md";
const textDecisions = "docs/research/text-original.md";
const imageDecisions = "src/image-contract.mjs";
const modalHost = "native/modal_presentation.cpp";
const scrollViewJs = "react-native/Libraries/Components/ScrollView/ScrollView.js";
const scrollViewConfig = "react-native/Libraries/Components/ScrollView/ScrollViewNativeComponent.js";
const scrollViewDecisions = "tests/scroll-view-contract.test.mjs";
const virtualizedListJs = "@react-native/virtualized-lists/Lists/VirtualizedList.js";
const modalSpec = "react-native/src/private/components/modal/specs/RCTModalHostViewNativeComponent.js";
const accessibilityPropsH = "react-native/ReactCommon/react/renderer/components/view/AccessibilityProps.h";
const baseViewPropsH = "react-native/ReactCommon/react/renderer/components/view/BaseViewProps.h";
const textPropsJs = "react-native/Libraries/Text/TextProps.js";
const paragraphAttributesH = "react-native/ReactCommon/react/renderer/attributedstring/ParagraphAttributes.h";

// The event families of RN's ViewProps, in the order of the inventory.
const pointerEvents = ["Down", "Move", "Up", "Cancel", "Over", "Out", "Enter", "Leave"]
  .flatMap(phase => [`onPointer${phase}`, `onPointer${phase}Capture`]);
const pointerCapture = ["onGotPointerCapture", "onGotPointerCaptureCapture", "onLostPointerCapture", "onLostPointerCaptureCapture"];
const clickEvents = ["onClick", "onClickCapture"];
const touchEvents = ["Start", "Move", "End", "Cancel"].flatMap(phase => [`onTouch${phase}`, `onTouch${phase}Capture`]);
const responderEvents = ["onStartShouldSetResponder", "onStartShouldSetResponderCapture", "onMoveShouldSetResponder",
  "onMoveShouldSetResponderCapture", "onResponderGrant", "onResponderReject", "onResponderStart", "onResponderEnd",
  "onResponderMove", "onResponderRelease", "onResponderTerminate", "onResponderTerminationRequest"];
const inputEvents = [...pointerEvents, ...pointerCapture, ...clickEvents, ...touchEvents, ...responderEvents];
// The accessibility props the host maps (src/accessibility-view-config.js).
const mappedAccessibility = ["accessible", "accessibilityLabel", "accessibilityHint", "accessibilityRole", "role", "accessibilityState",
  "accessibilityLiveRegion", "accessibilityElementsHidden", "importantForAccessibility", "accessibilityActions", "onAccessibilityTap"];
// Recorded as not mapped yet and dropped by the view config (docs/research/accessibility.md), and set by RN's own components.
const documentedUnmapped = ["accessibilityValue", "accessibilityViewIsModal", "accessibilityLanguage", "focusable"];
const focusEvents = ["onFocus", "onBlur", "onFocusCapture", "onBlurCapture"];
// Props RN declares for Android's View and that RN's iOS view config does not list.
const androidViewOnly = ["accessibilityLabelledBy", "screenReaderFocusable", "nativeBackgroundAndroid", "nativeForegroundAndroid",
  "renderToHardwareTextureAndroid", "nextFocusDown", "nextFocusForward", "nextFocusLeft", "nextFocusRight", "nextFocusUp"];
// Names that desktop React Native has and RN's iOS view config does not list.
const desktopOnly = ["onKeyDown", "onKeyDownCapture", "onKeyUp", "onKeyUpCapture", "onMouseEnter", "onMouseLeave"];
const ariaValue = ["aria-valuemax", "aria-valuemin", "aria-valuenow", "aria-valuetext"];
// The aria-* props that RN's View.js (and Image.ios.js, Pressable.js, Text.js for some) turn into the host's names.
const ariaStates = ["aria-busy", "aria-checked", "aria-disabled", "aria-expanded", "aria-selected"];
const accessibilityStateVia = Object.fromEntries(ariaStates.map(name => [name, "accessibilityState"]));

const supportedHost = names => ({ decision: "supported", how: "host", names });
const supportedJs = (names, via) => ({ decision: "supported", how: "js", names, ...(via === undefined ? {} : { via }) });
const ignored = (basis, names, reason, source, extra) => ({ decision: "ignored", basis, names, reason, source, ...extra });
const refused = (basis, names, reason, source, extra) => ({ decision: "refused", basis, names, reason, source, ...extra });

// The values of a refused prop that work, the RN default first, and where that default is read.
const accepting = (values, defaultSource, extra) => ({ accepts: values, defaultSource, ...extra });
const refusedByIos = (names, extra) => refused("ios", names, "RN's iOS view reads it and this host has no equivalent", [iosBase, iosView], extra);
// What RN's iOS view reads and this host does not (RCTViewComponentView.mm), each acting only when its value leaves the default
// that AccessibilityProps.h and BaseViewProps.h give it: the large-content viewer and title, the invert-colors and
// interaction flags, the accessibility order, the escape, magic-tap and action gestures, clipping of subviews and rasterization.
const iosAccessibilityRules = () => [
  refusedByIos(["accessibilityIgnoresInvertColors", "accessibilityShowsLargeContentViewer"], accepting([false], [accessibilityPropsH])),
  refusedByIos(["accessibilityLargeContentTitle"], accepting([""], [accessibilityPropsH], { probe: "Large title" })),
  refusedByIos(["accessibilityRespondsToUserInteraction"], accepting([true], [accessibilityPropsH], { probe: false })),
  refusedByIos(["onAccessibilityAction"]),
];
const iosViewRules = () => [
  refusedByIos(["experimental_accessibilityOrder"], accepting([[]], [accessibilityPropsH],
    { probe: ["child"], defaultName: { experimental_accessibilityOrder: "accessibilityOrder" } })),
  refusedByIos(["onAccessibilityEscape", "onMagicTap"]),
  refusedByIos(["removeClippedSubviews"], accepting([false], [baseViewPropsH])),
  refusedByIos(["shouldRasterizeIOS"], accepting([false], [baseViewPropsH], { defaultName: { shouldRasterizeIOS: "shouldRasterize" } })),
];
const androidIgnored = names => ignored("ios-drops", names,
  "RN's Android View declares it and RN's iOS view config does not list it", [iosBase]);
const androidNativeIgnored = names => ignored("android-native", names,
  "only RN's Android host props read it (platform/android HostPlatformViewProps.cpp)", [androidView]);
const desktopIgnored = names => ignored("ios-drops", names,
  "RN's iOS view config does not list it (desktop React Native only)", [iosBase]);
const unmappedIgnored = (names, extra) => ignored("decision", names,
  "recorded as not mapped yet and dropped by the view config, and RN's touchables set focusable and accessibilityValue on every View they clone",
  [accessibilityDecisions, touchableWithoutFeedbackJs, touchableNativeFeedbackJs], extra);
const focusIgnored = () => ignored("decision", focusEvents,
  "no View of this host takes keyboard focus, so nothing emits them; RN's touchables strip them and the cells of its lists register onFocusCapture on every render",
  [touchableOpacityJs, listCellJs]);

// What View and Pressable share. RN's View.js maps id, tabIndex and the aria-* props before the host sees them, and the
// Pressable.js around it adds its own mappings, so each rule names the prop the host finally gets in `via`.
const viewShared = [
  supportedHost(["testID", "nativeID", "pointerEvents", "hitSlop", "onLayout", "collapsable", "collapsableChildren", "style",
    ...mappedAccessibility, ...inputEvents]),
  supportedJs(["children"]),
  supportedJs(["id"], { id: "nativeID" }),
  supportedJs(["aria-label"], { "aria-label": "accessibilityLabel" }),
  supportedJs(["aria-live"], { "aria-live": "accessibilityLiveRegion" }),
  supportedJs(["aria-hidden"], { "aria-hidden": "accessibilityElementsHidden" }),
  supportedJs(ariaStates, accessibilityStateVia),
  ...iosAccessibilityRules(),
  unmappedIgnored(documentedUnmapped),
  unmappedIgnored(ariaValue, { via: Object.fromEntries(ariaValue.map(name => [name, "accessibilityValue"])) }),
  unmappedIgnored(["tabIndex"], { via: { tabIndex: "focusable" } }),
  focusIgnored(),
  ...iosViewRules(),
  androidIgnored(androidViewOnly),
  ignored("ios-drops", ["aria-labelledby"], "RN's View.js turns it into accessibilityLabelledBy, which iOS does not list",
    [viewJs, iosBase], { via: { "aria-labelledby": "accessibilityLabelledBy" } }),
  androidNativeIgnored(["needsOffscreenAlphaCompositing", "hasTVPreferredFocus"]),
];
// View: RN's original View.js over the base view config (src/base-view-config.js).
const view = [
  ...viewShared,
  ignored("ios-drops", ["aria-modal"], "RN's View.js does not map it and iOS does not list the name", [viewJs, iosBase]),
  desktopIgnored(desktopOnly),
];

// Pressable: Pressability's press props around the View of the host's Control (src/components.jsx). Its props are
// RN's PressableProps: ViewProps without the mouse events, plus the press, hover and Android props.
const pressable = [
  ...viewShared,
  unmappedIgnored(["aria-modal"], { via: { "aria-modal": "accessibilityViewIsModal" } }),
  desktopIgnored(desktopOnly.filter(name => !name.startsWith("onMouse"))),
  supportedJs(["onPress", "onPressIn", "onPressOut", "onLongPress", "onPressMove", "disabled", "pressRetentionOffset", "delayLongPress",
    "unstable_pressDelay", "cancelable", "blockNativeResponder"]),
  refused("decision", ["onHoverIn", "onHoverOut"],
    "hover events need a desktop pointer adapter that the 0.5 leaves out; the press stays on the responder",
    ["ROADMAP.md", "docs/PARITY.md"]),
  refused("ios", ["testOnly_pressed"], "RN's Pressable.js forces the pressed state with it and the Godot port has no such switch", [pressableJs],
    accepting([false], [pressableJs])),
  ignored("ios-drops", ["android_disableSound", "android_ripple"],
    "RN's Pressable.js reads them for Android only: useAndroidRippleForView returns null off Android", [pressableJs]),
  ignored("dependent", ["delayHoverIn", "delayHoverOut"],
    "they only delay onHoverIn and onHoverOut, which are refused", [pressableJs]),
];

// Text: RN's original Text.js over the paragraph of the host (src/text.jsx).
const textHost = ["testID", "nativeID", "pointerEvents", "onLayout", "accessible", "accessibilityLabel", "accessibilityHint", "accessibilityRole",
  "role", "accessibilityState", "accessibilityLiveRegion", "accessibilityElementsHidden", "importantForAccessibility", "accessibilityActions",
  "onPointerEnter", "onPointerLeave", "onPointerMove", "numberOfLines", "onTextLayout", "disabled"];
const text = [
  supportedHost(textHost),
  supportedJs(["children", "style", "onPress", "onPressIn", "onPressOut", "onLongPress", "pressRetentionOffset",
    "onStartShouldSetResponder", "onMoveShouldSetResponder", "onResponderGrant", "onResponderMove", "onResponderRelease",
    "onResponderTerminate", "onResponderTerminationRequest"]),
  supportedJs(["id"], { id: "nativeID" }),
  supportedJs(["aria-label"], { "aria-label": "accessibilityLabel" }),
  supportedJs(["aria-hidden"], { "aria-hidden": "accessibilityElementsHidden" }),
  supportedJs(ariaStates, accessibilityStateVia),
  ...iosAccessibilityRules(),
  unmappedIgnored(["accessibilityValue", "accessibilityViewIsModal", "accessibilityLanguage"]),
  refused("decision", ["selectable", "adjustsFontSizeToFit"],
    "selection and fitting the font to the box are not implemented by the paragraph", [textDecisions, textJs], accepting([false], [textPropsJs])),
  refused("decision", ["selectionColor"], "a platform text option the paragraph does not implement, with no default: unset means none",
    [textDecisions, textConfig]),
  refused("decision", ["dataDetectorType"], "a platform text option the paragraph does not implement", [textDecisions, textConfig],
    accepting(["none"], [textPropsJs], { probe: "link" })),
  refused("decision", ["textBreakStrategy"], "a platform text option the paragraph does not implement", [textDecisions, textConfig],
    accepting(["highQuality"], [textPropsJs, paragraphAttributesH], { probe: "simple" })),
  refused("decision", ["lineBreakStrategyIOS"], "a platform text option the paragraph does not implement", [textDecisions, textConfig],
    accepting(["none"], [textPropsJs], { probe: "standard" })),
  refused("decision", ["android_hyphenationFrequency"], "a platform text option the paragraph does not implement", [textDecisions, textConfig],
    accepting(["none"], [textPropsJs], { probe: "normal" })),
  refused("decision", ["ellipsizeMode"], "head and middle ellipsis are not implemented by the paragraph", [textDecisions, textConfig],
    accepting(["tail", "clip"], [textPropsJs], { typed: true, message: "Godot Text supports tail or clip ellipsizeMode", probe: "middle" })),
  ignored("decision", ["allowFontScaling", "maxFontSizeMultiplier", "dynamicTypeRamp", "suppressHighlighting"],
    "accepted and inert: the host's font scale is 1 and nothing highlights outside iOS", [textDecisions]),
  ignored("dependent", ["minimumFontScale"], "it only matters with adjustsFontSizeToFit, which is refused", [textConfig]),
  androidIgnored(["accessibilityLabelledBy", "screenReaderFocusable"]),
  ignored("ios-noop", ["aria-live", "aria-labelledby", "aria-modal", ...ariaValue],
    "RN's Text.js forwards the name as it is and no iOS component reads it", [textJs]),
];

// Image: RN's original Image.ios.js behind the validating wrapper (src/image.jsx, src/image-contract.mjs). It forwards the
// props it does not read as they are, so only the aria-* props it maps have an effect.
const imageIosNoop = ["id", "tabIndex", "aria-live", "aria-labelledby", "aria-modal", ...ariaValue];
const image = [
  supportedHost(["testID", "nativeID", "pointerEvents", "hitSlop", "onLayout", "collapsable", "collapsableChildren", "style",
    ...mappedAccessibility, ...inputEvents]),
  supportedHost(["source", "resizeMode", "tintColor", "blurRadius", "capInsets", "onLoadStart", "onLoad", "onLoadEnd", "onError", "onProgress",
    "onPartialLoad"]),
  supportedJs(["src", "srcSet", "width", "height", "crossOrigin", "referrerPolicy"]),
  supportedJs(["alt"], { alt: "accessibilityLabel" }),
  supportedJs(["aria-label"], { "aria-label": "accessibilityLabel" }),
  supportedJs(["aria-hidden"], { "aria-hidden": "accessible" }),
  supportedJs(ariaStates, accessibilityStateVia),
  refused("ios", ["children"], "RN's Image.ios.js throws for children, and the facade says the same first; no default: unset means no children",
    [imageJs], { message: "The <Image> component cannot contain children. If you want to render content on top of the image, consider using the <ImageBackground> component or absolute positioning." }),
  ...iosAccessibilityRules(),
  unmappedIgnored(documentedUnmapped),
  focusIgnored(),
  ...iosViewRules(),
  ignored("decision", ["defaultSource", "loadingIndicatorSource", "fadeDuration", "progressiveRenderingEnabled", "resizeMethod", "resizeMultiplier"],
    "accepted without effect, as on iOS: Android's props, and defaultSource, which no iOS component reads", [imageDecisions, imageConfig]),
  ignored("overwritten", ["internal_analyticTag"], "RN's Image.ios.js overwrites it with the analytics context", [imageJs]),
  ignored("ios-noop", imageIosNoop, "RN's Image.ios.js forwards the name as it is and no iOS component reads it", [imageJs]),
  androidIgnored(androidViewOnly),
  androidNativeIgnored(["needsOffscreenAlphaCompositing", "hasTVPreferredFocus"]),
  desktopIgnored(desktopOnly),
];

// Modal: RN's original Modal.js (a wrapper in src/react-native-platform.jsx runs the check), over the host's window. Modal.js
// reads the props below and passes nothing else on, whatever ModalProps spreads from ViewProps.
const modalViewNames = [...new Set([...view.flatMap(rule => rule.names)])].filter(name => !["children", "style", "testID"].includes(name));
const modal = [
  supportedHost(["visible", "transparent", "onShow", "onRequestClose", "testID"]),
  supportedJs(["children", "style", "modalRef", "backdropColor"]),
  refused("decision", ["animationType"], "the host presents a modal without animation", [modalHost, modalJs],
    accepting(["none"], [modalJs], { typed: true, probe: "slide" })),
  refused("decision", ["presentationStyle"], "the host presents full screen and over full screen only", [modalHost, modalJs],
    // Modal.js gives a transparent modal overFullScreen, as the rest of the suite renders it, and any other fullScreen.
    accepting(["overFullScreen", "fullScreen"], [modalJs], { typed: true, probe: "pageSheet" })),
  refused("decision", ["statusBarTranslucent", "navigationBarTranslucent", "hardwareAccelerated", "allowSwipeDismissal"],
    "the host refuses system-window flags and swipe dismissal (E_MODAL_PROP)", [modalHost], accepting([false], [modalSpec, modalJs])),
  refused("ios", ["onDismiss"], "iOS calls it after the modal is dismissed and Modal.js calls it on iOS only", [modalJs]),
  refused("ios", ["onOrientationChange"], "iOS calls it on the first render and on every rotation, and a desktop window never reports it",
    [modalJs]),
  refused("ios", ["supportedOrientations"], "iOS restricts the rotation of the modal with it and this host has no equivalent",
    [modalJs], accepting([["portrait"]], [modalJs], { probe: ["landscape"] })),
  ignored("not-forwarded", modalViewNames,
    "RN's Modal.js reads only its own props, style, testID and children, and passes nothing else on", [modalJs]),
];

// ActivityIndicator: RN's original ActivityIndicator.js. It consumes onLayout and style for its container and forwards the
// rest, as they are, to the native indicator; no aria-* prop is mapped.
const indicator = [
  supportedHost(["testID", "nativeID", "pointerEvents", "hitSlop", "collapsable", "collapsableChildren", ...mappedAccessibility, ...inputEvents,
    "animating", "color", "hidesWhenStopped", "size"]),
  supportedJs(["children", "style", "onLayout"]),
  ...iosAccessibilityRules(),
  unmappedIgnored(documentedUnmapped),
  focusIgnored(),
  ...iosViewRules(),
  ignored("ios-noop", ["id", "tabIndex", ...ariaValue, "aria-label", "aria-live", "aria-hidden", "aria-labelledby", "aria-modal", ...ariaStates],
    "RN's ActivityIndicator.js forwards the name as it is and no iOS component reads it", [indicatorJs]),
  androidIgnored(androidViewOnly),
  androidNativeIgnored(["needsOffscreenAlphaCompositing", "hasTVPreferredFocus"]),
  desktopIgnored(desktopOnly),
];

// ScrollView: RN's original ScrollView.js behind the public wrapper (src/scroll-view.jsx; src/scroll-view-contract.mjs keeps the
// checks of values and takes the list props off). ScrollView.js hands the native RCTScrollView every prop it does not read, as it
// is, so the View props follow the rules of the components that forward theirs (no aria-* is mapped). Of its own props the host
// honors the scroll position, the enabling, the indicators and the five scroll events, RN's JS reads the content and its size,
// and the rest has behavior on RN's platforms and none here: the request that asks for nothing passes (`accepts`) and any other
// fails, as the contract of the ScrollView decided before this table existed (tests/scroll-view-contract.test.mjs).
const scrollRequest = (names, value, extra) => refused("decision", names,
  "the Godot ScrollView honors none of it, so only the request that asks for nothing passes", [scrollViewJs, scrollViewDecisions],
  accepting([value], [scrollViewJs], extra));
const scrollRefusedAny = names => refused("decision", names,
  "the Godot ScrollView honors none of it, so it refuses every value that is not null, RN's default included",
  [scrollViewJs, scrollViewDecisions]);
const scrollView = [
  supportedHost(["testID", "nativeID", "pointerEvents", "hitSlop", "collapsable", "collapsableChildren", ...mappedAccessibility, ...inputEvents,
    "scrollEnabled", "showsVerticalScrollIndicator", "showsHorizontalScrollIndicator", "horizontal", "contentOffset", "scrollEventThrottle",
    "onScroll", "onScrollBeginDrag", "onScrollEndDrag", "onMomentumScrollBegin", "onMomentumScrollEnd"]),
  supportedJs(["children", "style", "onLayout", "contentContainerStyle", "onContentSizeChange", "innerViewRef", "scrollViewRef"]),
  ...iosAccessibilityRules(),
  unmappedIgnored(documentedUnmapped),
  focusIgnored(),
  // experimental_accessibilityOrder is the one member of ViewProps that ScrollViewProps leaves out.
  ...iosViewRules().filter(rule => !rule.names.includes("experimental_accessibilityOrder")),
  ignored("ios-noop", ["id", "tabIndex", ...ariaValue, "aria-label", "aria-live", "aria-hidden", "aria-labelledby", "aria-modal", ...ariaStates],
    "RN's ScrollView.js forwards the name as it is and no iOS component reads it", [scrollViewJs]),
  androidIgnored(androidViewOnly),
  androidNativeIgnored(["needsOffscreenAlphaCompositing", "hasTVPreferredFocus"]),
  desktopIgnored(desktopOnly),
  ignored("dependent", ["StickyHeaderComponent", "invertStickyHeaders", "stickyHeaderHiddenOnScroll"],
    "they only matter for the sticky headers that stickyHeaderIndices names, and it accepts the empty list only", [scrollViewJs]),
  scrollRequest(["alwaysBounceHorizontal", "alwaysBounceVertical", "automaticallyAdjustContentInsets", "automaticallyAdjustKeyboardInsets",
    "automaticallyAdjustsScrollIndicatorInsets", "bounces", "bouncesZoom", "centerContent", "disableIntervalMomentum",
    "disableScrollViewPanResponder", "nestedScrollEnabled", "pagingEnabled", "pinchGestureEnabled", "scrollToOverflowEnabled",
    "scrollsToTop"], false),
  scrollRequest(["canCancelContentTouches", "persistentScrollbar"], true, { probe: false }),
  scrollRequest(["keyboardDismissMode"], "none", { probe: "on-drag" }),
  scrollRequest(["overScrollMode"], "never", { probe: "always" }),
  scrollRequest(["snapToOffsets"], [], { probe: [20] }),
  scrollRequest(["stickyHeaderIndices"], [], { probe: [0] }),
  scrollRefusedAny(["contentInset", "contentInsetAdjustmentBehavior", "decelerationRate", "directionalLockEnabled", "endFillColor",
    "experimental_endDraggingSensitivityMultiplier", "fadingEdgeLength", "indicatorStyle", "keyboardShouldPersistTaps",
    "maintainVisibleContentPosition", "maximumZoomScale", "minimumZoomScale", "onScrollToTop", "onKeyboardDidShow", "onKeyboardDidHide",
    "onKeyboardWillShow", "onKeyboardWillHide", "refreshControl", "scrollIndicatorInsets", "scrollPerfTag", "scrollsChildToFocus",
    "snapToAlignment", "snapToInterval", "snapToStart", "snapToEnd", "zoomScale"]),
];
// What the lists hand to the ScrollView they render and ScrollViewProps does not declare, which the ScrollView refuses all the same:
// pull to refresh. They are checked with the declared props and are not part of the classification of what RN declares.
const scrollViewListRules = [
  refused("decision", ["onRefresh"], "pull to refresh is not implemented; a list hands onRefresh to its ScrollView, which does not declare it",
    [virtualizedListJs, scrollViewDecisions]),
  refused("decision", ["refreshing"], "pull to refresh is not implemented; a list hands refreshing to its ScrollView, which does not declare it",
    [virtualizedListJs, scrollViewDecisions], accepting([false], [virtualizedListJs])),
];

export const scope = Object.freeze({
  View: { owner: "ViewProps", rules: view },
  Text: { owner: "TextProps", rules: text },
  Pressable: { owner: "PressableProps", rules: pressable },
  Image: { owner: "ImageProps", rules: image },
  Modal: { owner: "ModalProps", rules: modal },
  ActivityIndicator: { owner: "ActivityIndicatorProps", rules: indicator },
  ScrollView: { owner: "ScrollViewProps", rules: scrollView, listRules: scrollViewListRules },
});
export const scopedComponents = Object.freeze(Object.keys(scope));

// Props of this platform's earlier wrapper that RN's Text does not have: the one exception to "undeclared keys are ignored".
export const legacyProps = Object.freeze({
  Text: Object.freeze({
    text: "it is not a prop of RN's Text, pass the text as children",
    fontSize: "it is not a prop of RN's Text, set it in style",
  }),
});

// One entry per declared name, built once. A name in two rules fails when the module loads, so "classified exactly once"
// holds before any test runs.
function tableOf(component) {
  const table = new Map();
  for (const rule of scope[component].rules) {
    for (const name of rule.names) {
      if (table.has(name)) {
        throw new Error(`${component}.${name} is classified twice`);
      }
      const { names: _names, ...entry } = rule;
      table.set(name, entry);
    }
  }
  return table;
}
const tables = new Map(scopedComponents.map(component => [component, tableOf(component)]));
// Every refused prop of a component: the declared ones, and the ones a list hands to it that RN does not declare for it.
function refusalsOf(component) {
  const refused = new Map([...tables.get(component)].filter(([, entry]) => entry.decision === "refused"));
  for (const rule of scope[component].listRules ?? []) {
    for (const name of rule.names) {
      if (tables.get(component).has(name) || refused.has(name)) {
        throw new Error(`${component}.${name} is classified twice`);
      }
      const { names: _names, ...entry } = rule;
      refused.set(name, entry);
    }
  }
  return refused;
}
const refusals = new Map(scopedComponents.map(component => [component, refusalsOf(component)]));

// The refused props of a component, the list props included.
export function refusalTable(component) {
  return refusals.get(component);
}

export function propTable(component) {
  const table = tables.get(component);
  if (table === undefined) {
    throw new Error(`Unknown scoped component: ${component}`);
  }
  return table;
}

// The same value, arrays by their members: a default can be a list.
function sameValue(left, right) {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((member, index) => sameValue(member, right[index]));
  }
  return left === right;
}

// Does this value make a refused prop fail? null and undefined never do; any other value does unless the prop accepts it.
export function refuses(entry, value) {
  return value !== undefined && value !== null && !(entry.accepts ?? []).some(works => sameValue(works, value));
}

// The text of the refusal of a prop: the entry's own, or the generic one.
function messageOf(component, name, entry) {
  return entry?.message ?? `Godot ${component} does not implement ${name}`;
}

export function refusalMessage(component, name) {
  return messageOf(component, name, refusalTable(component).get(name));
}

// A value that makes the prop fail, for the tests that drive every refused prop.
export function probeValue(component, name) {
  const entry = refusalTable(component).get(name);
  if (entry?.probe !== undefined) {
    return entry.probe;
  }
  return /^on[A-Z]/.test(name) ? () => {} : true;
}

// The one check. Facades call it with the props the application passed, on every render.
export function checkProps(component, props) {
  const refused = refusals.get(component);
  const legacy = legacyProps[component];
  for (const name of Object.keys(props)) {
    const entry = refused.get(name);
    if (entry !== undefined && refuses(entry, props[name])) {
      throw new Error(messageOf(component, name, entry));
    }
    if (legacy !== undefined && name in legacy && props[name] !== undefined) {
      throw new Error(`Godot ${component} does not implement ${name}: ${legacy[name]}`);
    }
  }
}

// The props RN declares for the component, and ref, which React hands to a function component as a prop.
export function declaredProps(component, props) {
  const table = propTable(component);
  const kept = {};
  for (const name of Object.keys(props)) {
    if (name === "ref" || table.has(name)) {
      kept[name] = props[name];
    }
  }
  return kept;
}
