import React, {Component, useEffect} from "react";

// Records what JS observes of RN's iOS- and Android-specific APIs through the
// public react-native import on Godot, where Platform.OS is "godot". Every
// warning goes through a wrapper of console.warn that is installed before
// react-native is evaluated and still forwards to the host, so the report can
// say which call printed what and the log can show that the host printed it.
const warnings = [];
const nativeWarn = console.warn;
console.warn = (...args) => {
  warnings.push(args.map(String).join(" "));
  return nativeWarn.apply(console, args);
};
// A require, not an import: imports are hoisted above the wrapper.
const ReactNative = require("react-native");
const importWarnings = warnings.length;
const {AppRegistry, Text, TurboModuleRegistry, View} = ReactNative;

// The original RN modules the facade exports, read by their own path. The
// facade must return exactly these, never a copy.
const originals = {
  ToastAndroid: () => require("react-native/Libraries/Components/ToastAndroid/ToastAndroidFallback").default,
  PermissionsAndroid: () => require("react-native/Libraries/PermissionsAndroid/PermissionsAndroid").default,
  DynamicColorIOS: () => require("react-native/Libraries/StyleSheet/PlatformColorValueTypesIOS").DynamicColorIOS,
  ActionSheetIOS: () => require("react-native/Libraries/ActionSheetIOS/ActionSheetIOS").default,
  ProgressBarAndroid: () => require("react-native/Libraries/Components/ProgressBarAndroid/ProgressBarAndroid").default,
  DrawerLayoutAndroid: () => require("react-native/Libraries/Components/DrawerAndroid/DrawerLayoutAndroidFallback").default,
  InputAccessoryView: () => require("react-native/Libraries/Components/TextInput/InputAccessoryView").default,
  PushNotificationIOS: () => require("react-native/Libraries/PushNotificationIOS/PushNotificationIOS").default,
  TouchableNativeFeedback: () => require("react-native/Libraries/Components/Touchable/TouchableNativeFeedback").default,
};
// The host modules the original modules ask the registry for.
const hostModuleNames = ["ToastAndroid", "PermissionsAndroid", "ActionSheetManager", "DialogManagerAndroid", "PushNotificationManager",
  "StatusBarManager"];

const reads = [];
const calls = [];
const events = [];
const seen = {};
const renderErrors = [];
const roots = {};
const drawers = {};
// How many times each case rendered: a root renders more than once while it mounts.
const renders = {};
let sequence = 0;

// The first line of an error's message: a host function's exception adds its stack below it.
function message(error) {
  return String(error?.message ?? error).split("\n")[0];
}
function noop() {}

// A read of a public export, with what the read itself printed. inspect leaves
// no record; read does.
function inspect(name) {
  const before = warnings.length;
  try {
    const value = ReactNative[name];
    return {name, at: before, available: value !== undefined, type: typeof value, error: null, value, warnings: warnings.slice(before)};
  } catch (error) {
    return {name, at: before, available: false, type: "error", error: message(error), value: undefined, warnings: warnings.slice(before)};
  }
}
function read(name) {
  const {value, ...entry} = inspect(name);
  entry.sameAsOriginal = name in originals && value !== undefined && value === originals[name]();
  reads.push(entry);
  return entry;
}

// The arguments of the calls the probe names: valid ones, and the invalid ones that
// make RN's argument invariants fire before the missing module.
const sheetOptions = {options: ["Copy", "Delete", "Cancel"], cancelButtonIndex: 2, destructiveButtonIndex: 1, title: "Pick"};
const shareOptions = {message: "hello", url: "https://example.com"};
const pushArguments = {
  presentLocalNotification: [{alertBody: "now"}],
  scheduleLocalNotification: [{alertBody: "later", fireDate: 0}],
  getDeliveredNotifications: [noop],
  removeDeliveredNotifications: [["identifier"]],
  setApplicationIconBadgeNumber: [3],
  getApplicationIconBadgeNumber: [noop],
  cancelLocalNotifications: [{}],
  getScheduledLocalNotifications: [noop],
  requestPermissions: [{alert: true}],
  checkPermissions: [noop],
  getAuthorizationStatus: [noop],
};
const operations = {
  "ToastAndroid.show": module => module.show("hello", module.SHORT),
  "ToastAndroid.showWithGravity": module => module.showWithGravity("hello", module.LONG, module.TOP),
  "ToastAndroid.showWithGravityAndOffset": module => module.showWithGravityAndOffset("hello", module.LONG, module.BOTTOM, 10, 20),
  "PermissionsAndroid.check": module => module.check(module.PERMISSIONS.CAMERA),
  "PermissionsAndroid.request": module => module.request(module.PERMISSIONS.CAMERA),
  "PermissionsAndroid.request/rationale": module => module.request(module.PERMISSIONS.CAMERA, {title: "Camera", message: "Needed"}),
  "PermissionsAndroid.requestMultiple": module => module.requestMultiple([module.PERMISSIONS.CAMERA, module.PERMISSIONS.RECORD_AUDIO]),
  "PermissionsAndroid.checkPermission": module => module.checkPermission(module.PERMISSIONS.CAMERA),
  "PermissionsAndroid.requestPermission": module => module.requestPermission(module.PERMISSIONS.CAMERA),
  "DynamicColorIOS": module => module({light: "#ffffff", dark: "#000000"}),
  "ActionSheetIOS.showActionSheetWithOptions/no-options": module => module.showActionSheetWithOptions(null, noop),
  "ActionSheetIOS.showActionSheetWithOptions/no-callback": module => module.showActionSheetWithOptions(sheetOptions, null),
  "ActionSheetIOS.showActionSheetWithOptions": module => module.showActionSheetWithOptions(sheetOptions, noop),
  "ActionSheetIOS.showShareActionSheetWithOptions/no-options": module => module.showShareActionSheetWithOptions(null, noop, noop),
  "ActionSheetIOS.showShareActionSheetWithOptions/no-failure-callback": module => module.showShareActionSheetWithOptions(shareOptions, null, noop),
  "ActionSheetIOS.showShareActionSheetWithOptions/no-success-callback": module => module.showShareActionSheetWithOptions(shareOptions, noop, null),
  "ActionSheetIOS.showShareActionSheetWithOptions": module => module.showShareActionSheetWithOptions(shareOptions, noop, noop),
  "ActionSheetIOS.dismissActionSheet": module => module.dismissActionSheet(),
  "PushNotificationIOS.checkPermissions/no-callback": module => module.checkPermissions(null),
  "PushNotificationIOS.addEventListener/unsupported": module => module.addEventListener("unknown", noop),
  "PushNotificationIOS.addEventListener": module => module.addEventListener("notification", noop),
  "PushNotificationIOS.removeEventListener": module => module.removeEventListener("notification"),
  "PushNotificationIOS.removeEventListener/unsupported": module => module.removeEventListener("unknown"),
};
// Every API call is recorded whatever happens: it returns, throws, or its
// promise settles later. warnings holds what the synchronous part printed, and at
// where in the global list it started.
function record(label, op, run) {
  const entry = {id: calls.length + 1, label, op, state: "pending", value: null, valueUndefined: false, error: null, warnings: [],
    settledAt: null};
  calls.push(entry);
  const name = op.split(".")[0].split("/")[0];
  const target = inspect(name);
  if (!target.available) {
    entry.state = "unavailable";
    entry.error = target.error ?? "the export is undefined";
    return entry;
  }
  const finish = (state, value, error) => {
    entry.state = state;
    entry.valueUndefined = value === undefined;
    entry.value = value === undefined ? null : value;
    entry.error = error;
    entry.settledAt = ++sequence;
  };
  const before = warnings.length;
  entry.at = before;
  let result;
  try {
    result = run(ReactNative[name]);
  } catch (error) {
    entry.warnings = warnings.slice(before);
    finish("threw", undefined, message(error));
    return entry;
  }
  entry.warnings = warnings.slice(before);
  if (result != null && typeof result.then === "function") {
    result.then(value => finish("resolved", value, null), error => finish("rejected", undefined, message(error)));
  } else {
    finish("returned", result, null);
  }
  return entry;
}

// Each case sits in its own error boundary, so an SDK that lacks an export or a
// platform that throws at render still mounts the sentinel and reports exactly
// which case failed and why.
class Case extends Component {
  state = {error: null};
  static getDerivedStateFromError(error) {
    return {error};
  }
  componentDidCatch(error) {
    renderErrors.push({root: this.props.root, case: this.props.name, message: message(error)});
  }
  render() {
    return this.state.error ? null : this.props.children;
  }
}
// What TouchableNativeFeedback hands its child: the props RN clones into it.
function Recorder({recorder, ...props}) {
  seen[recorder] = {keys: Object.keys(props).sort(), nativeBackgroundAndroid: props.nativeBackgroundAndroid ?? null,
    nativeForegroundAndroid: props.nativeForegroundAndroid ?? null, renders: (seen[recorder]?.renders ?? 0) + 1};
  return <View {...props} />;
}
function press(id) {
  return {onPressIn: () => events.push({sequence: ++sequence, id, type: "in"}), onPress: () => events.push({sequence: ++sequence, id, type: "press"}),
    onPressOut: () => events.push({sequence: ++sequence, id, type: "out"})};
}

function counted(key) {
  renders[key] = (renders[key] ?? 0) + 1;
}

function ProgressCase({name}) {
  const {ProgressBarAndroid} = ReactNative;
  counted(name + "-progress");
  return <View testID={name + "-progress"} style={{width: 100, height: 40}}>
    <ProgressBarAndroid styleAttr="Horizontal" indeterminate={false} progress={0.5}>
      <View testID={name + "-progress-child"} style={{width: 60, height: 20, backgroundColor: "#0891b2"}} />
    </ProgressBarAndroid>
  </View>;
}
// The same tree with a plain View where RN renders its UnimplementedView.
function ControlCase({name}) {
  return <View testID={name + "-control"} style={{width: 100, height: 40}}>
    <View>
      <View testID={name + "-control-child"} style={{width: 60, height: 20, backgroundColor: "#0891b2"}} />
    </View>
  </View>;
}
function DrawerCase({name}) {
  const {DrawerLayoutAndroid} = ReactNative;
  counted(name + "-drawer");
  return <View testID={name + "-drawer"} style={{width: 120, height: 60}}>
    <DrawerLayoutAndroid ref={instance => { drawers[name] = instance; }} drawerWidth={200}
      renderNavigationView={() => <View testID={name + "-drawer-navigation"} style={{width: 20, height: 20}} />}>
      <View testID={name + "-drawer-main"} style={{width: 50, height: 30, backgroundColor: "#16a34a"}} />
    </DrawerLayoutAndroid>
  </View>;
}
function AccessoryCase({name}) {
  const {InputAccessoryView} = ReactNative;
  counted(name + "-accessory");
  return <View testID={name + "-accessory"} style={{width: 80, height: 20}}>
    <InputAccessoryView nativeID={name + "-accessory-view"}>
      <View testID={name + "-accessory-child"} style={{width: 40, height: 10}} />
    </InputAccessoryView>
  </View>;
}
function StatusBarCase() {
  const {StatusBar} = ReactNative;
  return <StatusBar />;
}
// The three ways a TouchableNativeFeedback is configured: with a ripple, with a
// foreground, and by default.
const feedbackCases = {
  "native-feedback": {left: 16, top: 200, backgroundColor: "#334155"},
  "native-feedback-foreground": {left: 200, top: 200, backgroundColor: "#475569"},
  "native-feedback-default": {left: 16, top: 270, backgroundColor: "#64748b"},
};
function FeedbackCase({name, kind}) {
  const {TouchableNativeFeedback} = ReactNative;
  const id = name + "-" + kind;
  counted(id);
  const options = {
    "native-feedback": {...press(id), background: TouchableNativeFeedback.Ripple("#ff0000", false)},
    "native-feedback-foreground": {useForeground: true, background: TouchableNativeFeedback.SelectableBackgroundBorderless(8)},
    "native-feedback-default": {},
  }[kind];
  // TouchableNativeFeedback gives its child the testID of its own props.
  return <TouchableNativeFeedback {...options} testID={id}>
    <Recorder recorder={id} style={{position: "absolute", width: 150, height: 48, ...feedbackCases[kind]}} />
  </TouchableNativeFeedback>;
}
function InlineCase({name}) {
  const {TouchableNativeFeedback} = ReactNative;
  return <Text>
    <TouchableNativeFeedback>
      <Recorder recorder={name + "-inline"} />
    </TouchableNativeFeedback>
  </Text>;
}

function OsContractsProbe({name}) {
  useEffect(() => {
    roots[name] = {mounted: true, cleanups: 0};
    return () => {
      roots[name].mounted = false;
      roots[name].cleanups += 1;
    };
  }, [name]);
  return <View testID={name + "-root"} style={{width: 400, height: 360, backgroundColor: "#0f172a"}}>
    <Case root={name} name="progress"><ProgressCase name={name} /></Case>
    <Case root={name} name="control"><ControlCase name={name} /></Case>
    <Case root={name} name="drawer"><DrawerCase name={name} /></Case>
    <Case root={name} name="accessory"><AccessoryCase name={name} /></Case>
    <Case root={name} name="status-bar"><StatusBarCase /></Case>
    {Object.keys(feedbackCases).map(kind => <Case key={kind} root={name} name={kind}><FeedbackCase name={name} kind={kind} /></Case>)}
    <Case root={name} name="inline"><InlineCase name={name} /></Case>
  </View>;
}
AppRegistry.registerComponent("OsContractsProbe", () => OsContractsProbe);

globalThis.OsContractsProbe = {
  // The public read of an export on its own: this is what constructs RN's module
  // and prints its notice.
  read(name) {
    return read(name);
  },
  // One call of the public API. The operation name selects the arguments.
  run(label, op) {
    record(label, op, operations[op]);
  },
  // Every static method of PushNotificationIOS, found on the class itself, with valid arguments.
  runPushStatics(label) {
    const module = read("PushNotificationIOS").available ? ReactNative.PushNotificationIOS : null;
    const names = module == null ? [] : Object.getOwnPropertyNames(module).filter(key => typeof module[key] === "function");
    // addEventListener and removeEventListener have their own operations.
    for (const key of names.filter(key => !key.endsWith("EventListener"))) {
      record(label, "PushNotificationIOS." + key, target => target[key](...(pushArguments[key] ?? [])));
    }
    return names;
  },
  // Every method of the mounted DrawerLayoutAndroid, found on its class.
  runDrawer(label, root) {
    const instance = drawers[root];
    const proto = read("DrawerLayoutAndroid").available ? ReactNative.DrawerLayoutAndroid.prototype : null;
    const names = proto == null ? [] : Object.getOwnPropertyNames(proto).filter(key => key !== "constructor" && key !== "render");
    const args = {measure: [noop], measureInWindow: [noop], measureLayout: [1, noop, noop], setNativeProps: [{}]};
    for (const key of names) {
      record(label, "DrawerLayoutAndroid." + key, () => instance[key](...(args[key] ?? [])));
    }
    return {names, mounted: instance != null};
  },
  // Static reads: no module is constructed that read() has not constructed.
  statics() {
    const tnf = ReactNative.TouchableNativeFeedback;
    const original = tnf == null ? null : originals.TouchableNativeFeedback();
    const generic = (() => {
      try {
        return require("react-native/Libraries/Components/ToastAndroid/ToastAndroid").default;
      } catch (error) {
        return message(error);
      }
    })();
    return {
      touchable: tnf == null ? null : {
        sameStatics: ["SelectableBackground", "SelectableBackgroundBorderless", "Ripple", "canUseNativeForeground"]
          .map(key => [key, tnf[key] === original[key]]),
        selectable: tnf.SelectableBackground(4),
        borderless: tnf.SelectableBackgroundBorderless(),
        ripple: tnf.Ripple("#ff0000", true, 5),
        canUseNativeForeground: tnf.canUseNativeForeground(),
        displayName: original.displayName ?? null,
      },
      permissions: ReactNative.PermissionsAndroid == null ? null : {
        permissions: {...ReactNative.PermissionsAndroid.PERMISSIONS},
        results: {...ReactNative.PermissionsAndroid.RESULTS},
        frozen: [Object.isFrozen(ReactNative.PermissionsAndroid.PERMISSIONS), Object.isFrozen(ReactNative.PermissionsAndroid.RESULTS)],
      },
      toast: ReactNative.ToastAndroid == null ? null : {
        constants: Object.fromEntries(["SHORT", "LONG", "TOP", "BOTTOM", "CENTER"].map(key => [key, ReactNative.ToastAndroid[key]])),
        methods: Object.keys(ReactNative.ToastAndroid).filter(key => typeof ReactNative.ToastAndroid[key] === "function").sort(),
      },
      push: ReactNative.PushNotificationIOS == null ? null : {fetchResult: {...ReactNative.PushNotificationIOS.FetchResult}},
      // RN's generic path imports itself, so a third-party package that uses it gets nothing.
      genericToastAndroid: typeof generic === "string" ? generic : generic === undefined ? "undefined" : typeof generic,
    };
  },
  // What the registry and the host answer for the modules the original ones look up.
  hostModules() {
    return Object.fromEntries(hostModuleNames.map(moduleName => {
      let found;
      try {
        found = TurboModuleRegistry.get(moduleName);
      } catch (error) {
        found = {error: message(error)};
      }
      let enforcing;
      try {
        enforcing = {value: TurboModuleRegistry.getEnforcing(moduleName) == null ? null : "module"};
      } catch (error) {
        enforcing = {error: message(error)};
      }
      return [moduleName, {get: found === null ? null : found?.error ?? "module", getEnforcing: enforcing}];
    }));
  },
  // The events of the real presses since the last take.
  take() {
    return events.splice(0, events.length);
  },
  // Pure JS reads only: this stays valid after the application stops.
  snapshot() {
    return {importWarnings, warnings, reads, calls, seen, renders, renderErrors, events,
      roots: Object.fromEntries(Object.entries(roots).map(([name, root]) => [name, {mounted: root.mounted, cleanups: root.cleanups}])),
      exports: Object.keys(ReactNative).sort()};
  },
};
