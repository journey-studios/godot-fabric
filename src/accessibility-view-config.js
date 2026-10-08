// The accessibility attributes of RN's View that the Godot host maps to the OS's
// assistive technology (see docs/research/accessibility.md). A prop that is not
// registered here never reaches the host, so the list is also the list of what is
// supported; a registered prop is checked in `process` before it is sent, and a
// value the host cannot honor fails where the View renders, with a message that
// names the prop, instead of becoming an inert attribute. The roles that the host
// maps to a Godot role, and the ones it rejects, are decided in
// native/accessibility_core.h.

// RN 0.87.1 Libraries/Components/View/ViewAccessibility.js: AccessibilityRole and Role.
export const accessibilityRoles = Object.freeze(["none", "button", "dropdownlist", "togglebutton", "link", "search",
  "image", "keyboardkey", "text", "adjustable", "imagebutton", "header", "summary", "alert", "checkbox", "combobox",
  "menu", "menubar", "menuitem", "progressbar", "radio", "radiogroup", "scrollbar", "spinbutton", "switch", "tab",
  "tabbar", "tablist", "timer", "list", "toolbar", "grid", "pager", "scrollview", "horizontalscrollview", "viewgroup",
  "webview", "drawerlayout", "slidingdrawer", "iconmenu"]);
export const ariaRoles = Object.freeze(["alert", "alertdialog", "application", "article", "banner", "button", "cell",
  "checkbox", "columnheader", "combobox", "complementary", "contentinfo", "definition", "dialog", "directory", "document",
  "feed", "figure", "form", "grid", "group", "heading", "img", "link", "list", "listitem", "log", "main", "marquee",
  "math", "menu", "menubar", "menuitem", "meter", "navigation", "none", "note", "option", "presentation", "progressbar",
  "radio", "radiogroup", "region", "row", "rowgroup", "rowheader", "scrollbar", "searchbox", "separator", "slider",
  "spinbutton", "status", "summary", "switch", "tab", "table", "tablist", "tabpanel", "term", "timer", "toolbar",
  "tooltip", "tree", "treegrid", "treeitem"]);
const liveRegions = ["none", "polite", "assertive"];
const importance = ["auto", "yes", "no", "no-hide-descendants"];
const stateBooleans = ["busy", "disabled", "expanded", "selected"];

function reject(prop, message) {
  throw new Error(`Godot accessibility: ${prop} ${message}`);
}
function typed(prop, type) {
  return {
    process(value) {
      if (value != null && typeof value !== type) {
        reject(prop, `must be a ${type}, not ${typeof value}`);
      }
      return value;
    },
  };
}
function oneOf(prop, values) {
  return {
    process(value) {
      if (value != null && !values.includes(value)) {
        reject(prop, `must be one of ${values.join(", ")}, not ${JSON.stringify(value)}`);
      }
      return value;
    },
  };
}
// A removed role must reach the host as "none". RN's C++ AccessibilityProps keeps the previous role when the
// prop arrives as null (AccessibilityProps.cpp: `!hasValue()` copies sourceProps), so null is mapped here, and the
// components that render the host's View (the facade View, Pressable) send "none" instead of leaving the prop out.
function role(prop, vocabulary) {
  return {
    process(value) {
      if (value == null) {
        return "none";
      }
      if (typeof value !== "string") {
        reject(prop, `must be a string, not ${typeof value}`);
      }
      if (!vocabulary.includes(value)) {
        reject(prop, `${JSON.stringify(value)} is not a React Native ${prop}`);
      }
      return value;
    },
  };
}

// The attributes, with the checks that need nothing from the host. A value that is
// valid in RN but has no Godot equivalent (a role such as webview, checked "mixed",
// a state a role cannot show) is rejected by the host, which knows the role table.
export const accessibilityAttributes = {
  accessible: typed("accessible", "boolean"),
  accessibilityLabel: typed("accessibilityLabel", "string"),
  accessibilityHint: typed("accessibilityHint", "string"),
  accessibilityRole: role("accessibilityRole", accessibilityRoles),
  role: role("role", ariaRoles),
  accessibilityState: {
    process(value) {
      if (value == null) {
        return value;
      }
      if (typeof value !== "object" || Array.isArray(value)) {
        reject("accessibilityState", "must be an object");
      }
      for (const name of stateBooleans) {
        if (value[name] != null && typeof value[name] !== "boolean") {
          reject(`accessibilityState.${name}`, `must be a boolean, not ${typeof value[name]}`);
        }
      }
      if (value.checked != null && typeof value.checked !== "boolean" && value.checked !== "mixed") {
        reject("accessibilityState.checked", `must be true, false or "mixed", not ${JSON.stringify(value.checked)}`);
      }
      return value;
    },
  },
  accessibilityLiveRegion: oneOf("accessibilityLiveRegion", liveRegions),
  accessibilityElementsHidden: typed("accessibilityElementsHidden", "boolean"),
  importantForAccessibility: oneOf("importantForAccessibility", importance),
  // The host cannot publish custom actions yet.
  accessibilityActions: {
    process(value) {
      if (value != null && (!Array.isArray(value) || value.length > 0)) {
        reject("accessibilityActions", "is not supported yet: custom accessibility actions need Godot's custom-action bridge");
      }
      return value;
    },
  },
  onAccessibilityTap: true,
};
// RN dispatches the OS's activation as the direct event topAccessibilityTap.
export const accessibilityEventTypes = {
  topAccessibilityTap: { registrationName: "onAccessibilityTap" },
};

// The props of a View with its roles spelled out, so that removing a role reaches the host (see `role` above).
export function withExplicitRoles(props) {
  return { ...props, accessibilityRole: props.accessibilityRole ?? "none", role: props.role ?? "none" };
}

// RN's View.js turns aria-* props into accessibility* props before the host sees them. A component of this
// platform that renders the host's View itself (the Godot Pressable) needs the same step, and RN's own
// Pressable.js (lines 249-280) adds its defaults: it is accessible unless it says otherwise, and its disabled
// prop is the disabled accessibility state. Props this platform does not map are left alone and never sent.
export function pressableAccessibilityProps(props) {
  const {
    accessible,
    accessibilityState,
    disabled,
    "aria-busy": ariaBusy,
    "aria-checked": ariaChecked,
    "aria-disabled": ariaDisabled,
    "aria-expanded": ariaExpanded,
    "aria-hidden": ariaHidden,
    "aria-label": ariaLabel,
    "aria-live": ariaLive,
    "aria-selected": ariaSelected,
    ...rest
  } = props;
  const state = {
    busy: ariaBusy ?? accessibilityState?.busy,
    checked: ariaChecked ?? accessibilityState?.checked,
    disabled: ariaDisabled ?? accessibilityState?.disabled,
    expanded: ariaExpanded ?? accessibilityState?.expanded,
    selected: ariaSelected ?? accessibilityState?.selected,
  };
  const resolved = { ...withExplicitRoles(rest), accessible: accessible !== false, accessibilityState: disabled != null ? { ...state, disabled } : state };
  if (disabled != null) {
    resolved.disabled = disabled;
  }
  if (ariaLabel !== undefined) {
    resolved.accessibilityLabel = ariaLabel;
  }
  if (ariaLive !== undefined) {
    resolved.accessibilityLiveRegion = ariaLive === "off" ? "none" : ariaLive;
  }
  if (ariaHidden !== undefined) {
    resolved.accessibilityElementsHidden = ariaHidden;
    if (ariaHidden === true) {
      resolved.importantForAccessibility = "no-hide-descendants";
    }
  }
  return resolved;
}
