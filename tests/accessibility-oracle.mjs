import assert from "node:assert/strict";

// Independent oracle for build/accessibility-report.json. It re-derives every stage from the raw observations
// (the props React sent, what the host resolved and set, what RN's JS saw) with its own tables, written apart
// from native/accessibility_core.h and tests/accessibility-probe.gd. It never trusts a probe verdict.
//
// What it can judge is metadata: the descriptor, the Control properties and the host path of the OS's press.
// What an assistive technology sees is judged by tests/accessibility-bridge.test.mjs.

// The role table of docs/research/accessibility.md: [name, vocabularies, Godot role, role description, capabilities,
// rejected]. Vocabularies: a is RN's accessibilityRole, r is RN's role. Capabilities: c checked, s selected,
// e expanded, p pressable by the OS.
export const roleTable = [
  ["none", "ar", null, "", ""], ["presentation", "r", null, "", ""],
  ["button", "ar", "ROLE_BUTTON", "", "pe"], ["togglebutton", "a", "ROLE_BUTTON", "toggle button", "cp"],
  ["imagebutton", "a", "ROLE_BUTTON", "image button", "p"], ["keyboardkey", "a", "ROLE_BUTTON", "keyboard key", "p"],
  ["link", "ar", "ROLE_LINK", "", "p"], ["checkbox", "ar", "ROLE_CHECK_BOX", "", "cp"],
  ["radio", "ar", "ROLE_RADIO_BUTTON", "", "cp"], ["switch", "ar", "ROLE_CHECK_BUTTON", "", "cp"],
  ["menuitem", "ar", "ROLE_MENU_ITEM", "", "pe"], ["option", "r", "ROLE_LIST_BOX_OPTION", "", "sp"],
  ["tab", "ar", "ROLE_TAB", "", "sp"],
  ["text", "a", "ROLE_STATIC_TEXT", "", ""], ["header", "a", "ROLE_STATIC_TEXT", "heading", ""],
  ["heading", "r", "ROLE_STATIC_TEXT", "heading", ""], ["image", "a", "ROLE_IMAGE", "", ""], ["img", "r", "ROLE_IMAGE", "", ""],
  ["progressbar", "ar", "ROLE_PROGRESS_INDICATOR", "", ""], ["alert", "ar", "ROLE_STATIC_TEXT", "alert", ""],
  ["status", "r", "ROLE_STATIC_TEXT", "status", ""], ["timer", "ar", "ROLE_STATIC_TEXT", "timer", ""],
  ["tooltip", "r", "ROLE_TOOLTIP", "", ""],
  ["list", "ar", "ROLE_LIST", "", ""], ["listitem", "r", "ROLE_LIST_ITEM", "", "s"], ["menu", "ar", "ROLE_MENU", "", ""],
  ["menubar", "ar", "ROLE_MENU_BAR", "", ""], ["tablist", "ar", "ROLE_TAB_BAR", "", ""], ["tabbar", "a", "ROLE_TAB_BAR", "", ""],
  ["tabpanel", "r", "ROLE_TAB_PANEL", "", ""], ["dialog", "r", "ROLE_DIALOG", "", ""],
  ["alertdialog", "r", "ROLE_DIALOG", "alert dialog", ""], ["radiogroup", "ar", "ROLE_CONTAINER", "radio group", ""],
  ["toolbar", "ar", "ROLE_CONTAINER", "toolbar", ""], ["group", "r", "ROLE_CONTAINER", "", ""],
  ["viewgroup", "a", "ROLE_CONTAINER", "", ""], ["search", "a", "ROLE_REGION", "search", ""],
  ["region", "r", "ROLE_REGION", "", ""], ["banner", "r", "ROLE_REGION", "banner", ""],
  ["complementary", "r", "ROLE_REGION", "complementary", ""], ["contentinfo", "r", "ROLE_REGION", "content information", ""],
  ["form", "r", "ROLE_REGION", "form", ""], ["main", "r", "ROLE_REGION", "main", ""],
  ["navigation", "r", "ROLE_REGION", "navigation", ""],
];
export const rejectedRoles = {
  a: ["dropdownlist", "adjustable", "summary", "combobox", "scrollbar", "spinbutton", "grid", "pager", "scrollview",
    "horizontalscrollview", "webview", "drawerlayout", "slidingdrawer", "iconmenu"],
  r: ["application", "article", "cell", "columnheader", "combobox", "definition", "directory", "document", "feed", "figure",
    "grid", "log", "marquee", "math", "meter", "note", "row", "rowgroup", "rowheader", "scrollbar", "searchbox", "separator",
    "slider", "spinbutton", "summary", "table", "term", "tree", "treegrid", "treeitem"],
};
// RN 0.87.1 ViewAccessibility.js.
export const rnVocabularies = {
  a: ["none", "button", "dropdownlist", "togglebutton", "link", "search", "image", "keyboardkey", "text", "adjustable",
    "imagebutton", "header", "summary", "alert", "checkbox", "combobox", "menu", "menubar", "menuitem", "progressbar", "radio",
    "radiogroup", "scrollbar", "spinbutton", "switch", "tab", "tabbar", "tablist", "timer", "list", "toolbar", "grid", "pager",
    "scrollview", "horizontalscrollview", "viewgroup", "webview", "drawerlayout", "slidingdrawer", "iconmenu"],
  r: ["alert", "alertdialog", "application", "article", "banner", "button", "cell", "checkbox", "columnheader", "combobox",
    "complementary", "contentinfo", "definition", "dialog", "directory", "document", "feed", "figure", "form", "grid", "group",
    "heading", "img", "link", "list", "listitem", "log", "main", "marquee", "math", "menu", "menubar", "menuitem", "meter",
    "navigation", "none", "note", "option", "presentation", "progressbar", "radio", "radiogroup", "region", "row", "rowgroup",
    "rowheader", "scrollbar", "searchbox", "separator", "slider", "spinbutton", "status", "summary", "switch", "tab", "table",
    "tablist", "tabpanel", "term", "timer", "toolbar", "tooltip", "tree", "treegrid", "treeitem"],
};
const propOf = {a: "accessibilityRole", r: "role"};
const emptyDescriptor = {accessible: false, name: "", description: "", role: null, roleSource: null, godotRole: null,
  roleDescription: "", live: "none", hidden: false, disabled: false, busy: false, checked: "none", selected: false,
  expanded: null, onAccessibilityTap: false, clickAction: false};
export const normativeOriginalFailures = [
  "mount/Each root mounts its Views, and the surface's root View, as accessible Views on the host",
  "static/Every element resolves to the descriptor of its RN props, in both roots",
  "static/The label and the hint are the Control's accessibility name and description",
  "static/The accessibilityLabel reaches the accessibility name of the Control",
  "static/The accessibilityHint reaches the accessibility description of the Control",
  "static/A View without accessibility props carries an empty descriptor",
  "static/accessibilityLiveRegion sets the Control's live mode to the engine's constant",
  "static/An RN label that is also a translation key stays literal",
  "static/The accessible View translates no message and does not auto translate",
  "static/A View whose descriptor is empty is not applied again, and one with a descriptor is applied at least once",
];
export const supportedNames = vocabulary => roleTable.filter(row => row[1].includes(vocabulary)).map(row => row[0]);

// RN's View.js (Libraries/Components/View/View.js lines 35-110): aria-* props become accessibility* props.
function viewProps(props) {
  const {accessibilityState, "aria-busy": busy, "aria-checked": checked, "aria-disabled": disabled, "aria-expanded": expanded,
    "aria-hidden": hidden, "aria-label": label, "aria-live": live, "aria-selected": selected, ...rest} = props;
  const out = {...rest};
  if (label !== undefined) {
    out.accessibilityLabel = label;
  }
  if (live !== undefined) {
    out.accessibilityLiveRegion = live === "off" ? "none" : live;
  }
  if (hidden !== undefined) {
    out.accessibilityElementsHidden = hidden;
    if (hidden === true) {
      out.importantForAccessibility = "no-hide-descendants";
    }
  }
  if (accessibilityState != null || [busy, checked, disabled, expanded, selected].some(value => value != null)) {
    out.accessibilityState = {busy: busy ?? accessibilityState?.busy, checked: checked ?? accessibilityState?.checked,
      disabled: disabled ?? accessibilityState?.disabled, expanded: expanded ?? accessibilityState?.expanded,
      selected: selected ?? accessibilityState?.selected};
  }
  return out;
}

// The error the ViewConfig of the platform throws for a prop, or null (src/accessibility-view-config.js).
function jsError(props) {
  const fail = (prop, message) => `Godot accessibility: ${prop} ${message}`;
  const typed = (prop, type) => props[prop] != null && typeof props[prop] !== type ? fail(prop, `must be a ${type}, not ${typeof props[prop]}`) : null;
  const oneOf = (prop, values) => props[prop] != null && !values.includes(props[prop]) ? fail(prop, `must be one of ${values.join(", ")}, not ${JSON.stringify(props[prop])}`) : null;
  const role = (prop, vocabulary) => {
    const value = props[prop];
    if (value == null) {
      return null;
    }
    if (typeof value !== "string") {
      return fail(prop, `must be a string, not ${typeof value}`);
    }
    return rnVocabularies[vocabulary].includes(value) ? null : fail(prop, `${JSON.stringify(value)} is not a React Native ${prop}`);
  };
  const state = () => {
    const value = props.accessibilityState;
    if (value == null) {
      return null;
    }
    for (const name of ["busy", "disabled", "expanded", "selected"]) {
      if (value[name] != null && typeof value[name] !== "boolean") {
        return fail(`accessibilityState.${name}`, `must be a boolean, not ${typeof value[name]}`);
      }
    }
    if (value.checked != null && typeof value.checked !== "boolean" && value.checked !== "mixed") {
      return fail("accessibilityState.checked", `must be true, false or "mixed", not ${JSON.stringify(value.checked)}`);
    }
    return null;
  };
  const actions = () => props.accessibilityActions != null && (!Array.isArray(props.accessibilityActions) || props.accessibilityActions.length > 0)
    ? fail("accessibilityActions", "is not supported yet: custom accessibility actions need Godot's custom-action bridge") : null;
  // The order of the checks does not matter: the cases hold one invalid prop each.
  return typed("accessible", "boolean") ?? typed("accessibilityLabel", "string") ?? typed("accessibilityHint", "string") ??
    role("accessibilityRole", "a") ?? role("role", "r") ?? state() ?? oneOf("accessibilityLiveRegion", ["none", "polite", "assertive"]) ??
    typed("accessibilityElementsHidden", "boolean") ?? oneOf("importantForAccessibility", ["auto", "yes", "no", "no-hide-descendants"]) ?? actions();
}

function lookup(prop, name, errors) {
  const vocabulary = prop === "role" ? "r" : "a";
  if (name == null || name === "") {
    return null;
  }
  if (rejectedRoles[vocabulary].includes(name)) {
    errors.push({kind: "rejected", prop, name});
    return null;
  }
  const row = roleTable.find(entry => entry[0] === name && entry[1].includes(vocabulary));
  if (!row) {
    errors.push({kind: "unknown", prop, name});
    return null;
  }
  return row;
}

// What the host must resolve for the props RN's View sent it (after viewProps). The result carries the descriptor, or
// the reasons and the empty descriptor of a rejected View.
function resolve(sent) {
  const errors = [];
  // RN's Role has no unset: none is both, so a role of none leaves the decision to accessibilityRole.
  const fromRole = lookup("role", sent.role === "none" ? null : sent.role, errors);
  const fromAccessibilityRole = lookup("accessibilityRole", sent.accessibilityRole, errors);
  let winner = fromRole ?? fromAccessibilityRole;
  if (winner && winner[0] === "none") {
    winner = null;
  }
  const capabilities = winner ? winner[4] : "";
  const state = sent.accessibilityState ?? {};
  const where = winner ? `"${winner[0]}"` : "no role";
  const checked = state.checked === "mixed" ? "mixed" : state.checked === true ? "checked" : state.checked === false ? "unchecked" : "none";
  if (checked === "mixed") {
    errors.push({kind: "mixed"});
  } else if (checked !== "none" && !capabilities.includes("c")) {
    errors.push({kind: "checked", where});
  }
  if (state.selected === true && !capabilities.includes("s")) {
    errors.push({kind: "selected", where});
  }
  if (typeof state.expanded === "boolean" && !capabilities.includes("e")) {
    errors.push({kind: "expanded", where});
  }
  if (Array.isArray(sent.accessibilityActions) && sent.accessibilityActions.length > 0) {
    errors.push({kind: "actions"});
  }
  if (sent.importantForAccessibility === "no") {
    errors.push({kind: "important"});
  }
  const messages = errors.map(error => ({
    unknown: `accessibility: ${error.prop} "${error.name}" is not a React Native ${error.prop}`,
    rejected: `accessibility: ${error.prop} "${error.name}" has no Godot accessibility role: `,
    mixed: "accessibility: accessibilityState.checked \"mixed\" is not supported: Godot's accessibility has no mixed state",
    checked: `accessibility: accessibilityState.checked needs a checkable role (checkbox, radio, switch or togglebutton), not ${error.where}`,
    selected: `accessibility: accessibilityState.selected needs a selectable role (tab, listitem or option), not ${error.where}`,
    expanded: `accessibility: accessibilityState.expanded needs an expandable role (button, menuitem), not ${error.where}`,
    actions: "accessibility: accessibilityActions is not supported yet: custom actions need Godot's custom-action bridge",
    important: "accessibility: importantForAccessibility \"no\" is not supported: Godot can hide an element only together with its descendants (use \"no-hide-descendants\")",
  })[error.kind]);
  if (errors.length > 0) {
    return {rejected: true, messages, descriptor: {...emptyDescriptor}};
  }
  const hidden = sent.accessibilityElementsHidden === true || sent.importantForAccessibility === "no-hide-descendants";
  const disabled = state.disabled === true;
  const descriptor = {accessible: sent.accessible === true, name: sent.accessibilityLabel ?? "", description: sent.accessibilityHint ?? "",
    role: winner ? winner[0] : null, roleSource: winner ? (fromRole ? "role" : "accessibilityRole") : null,
    godotRole: winner ? winner[2] : null, roleDescription: winner ? winner[3] : "",
    live: sent.accessibilityLiveRegion ?? "none", hidden, disabled, busy: state.busy === true, checked,
    selected: state.selected === true, expanded: typeof state.expanded === "boolean" ? state.expanded : null,
    onAccessibilityTap: sent.onAccessibilityTap === true,
    clickAction: false};
  descriptor.clickAction = !hidden && !disabled && (descriptor.onAccessibilityTap || descriptor.accessible || capabilities.includes("p"));
  return {rejected: false, messages: [], descriptor};
}

// The props that reach the host for each static element of the fixture, after the facade, RN's View and the touchable.
const staticProps = {
  root: {},
  labeled: {accessible: true, accessibilityLabel: "Save draft", accessibilityHint: "Saves the draft", accessibilityRole: "button",
    accessibilityLiveRegion: "polite", onAccessibilityTap: true},
  "tap-press": {accessible: true, accessibilityLabel: "Tap wins", onAccessibilityTap: true},
  pressable: {accessible: true, accessibilityLabel: "Open", accessibilityHint: "Opens the file", accessibilityRole: "button"},
  touchable: {accessible: true, accessibilityLabel: "Share", accessibilityHint: "Shares the file", accessibilityRole: "button"},
  "touchable-aria": {accessible: true, accessibilityLabel: "Mute", accessibilityRole: "button", accessibilityLiveRegion: "assertive",
    accessibilityState: {busy: true, expanded: false}},
  "pressable-aria": {accessible: true, accessibilityLabel: "Like", accessibilityRole: "tab", accessibilityLiveRegion: "polite",
    accessibilityState: {selected: false}},
  "disabled-pressable": {accessible: true, accessibilityLabel: "Locked", accessibilityState: {disabled: true}},
  "disabled-state": {accessible: true, accessibilityLabel: "Off", accessibilityRole: "button", accessibilityState: {disabled: true},
    onAccessibilityTap: true},
  "hidden-group": {accessibilityElementsHidden: false},
  "hidden-child": {accessible: true, accessibilityLabel: "Inside", accessibilityRole: "button", onAccessibilityTap: true},
  important: {importantForAccessibility: "no-hide-descendants", accessibilityLabel: "Skipped"},
  dyn: {}, "dyn-aria": {},
  removable: {accessible: true, accessibilityLabel: "Temporary", accessibilityRole: "button", onAccessibilityTap: true},
  plain: {},
  translated: {accessibilityLabel: "Save", accessibilityHint: "Save"},
};

const numbered = (descriptor, constants) => ({...descriptor,
  godotRoleValue: descriptor.godotRole === null ? null : constants.roles[descriptor.godotRole]});
function verifyDescriptor(actual, expected, constants, label) {
  assert.deepEqual(actual, numbered(expected, constants), label);
  if (expected.godotRole !== null) {
    assert.ok(Number.isInteger(constants.roles[expected.godotRole]), label + ": the engine has the role constant");
  }
}
function verifyAccessibility(ax, expectation, constants, label) {
  assert.ok(ax != null && ax.descriptor != null, label + ": the element has an accessible View");
  verifyDescriptor(ax.descriptor, expectation.descriptor, constants, label);
  assert.equal(ax.rejected, expectation.rejected, label);
  assert.equal(ax.errors.length, expectation.messages.length, label);
  expectation.messages.forEach((message, index) => {
    if (message.endsWith("has no Godot accessibility role: ")) {
      assert.ok(ax.errors[index].startsWith(message) && ax.errors[index].length > message.length, label + ": " + ax.errors[index]);
    } else {
      assert.equal(ax.errors[index], message, label);
    }
  });
  // What Godot itself will publish for the Control.
  assert.equal(ax.control.accessibilityName, expectation.descriptor.name, label);
  assert.equal(ax.control.accessibilityDescription, expectation.descriptor.description, label);
  assert.equal(ax.control.accessibilityLive, constants.live[{none: "LIVE_OFF", polite: "LIVE_POLITE", assertive: "LIVE_ASSERTIVE"}[expectation.descriptor.live]], label);
  assert.equal(ax.control.messageTranslation, false, label);
  assert.equal(ax.control.autoTranslateMode, 2, label);
  // Headless: no OS tree, so the host published nothing.
  assert.equal(ax.updates, 0, label);
  assert.equal(ax.published, null, label);
  assert.equal(ax.publishFailures, 0, label);
}

function verifyStatic(report) {
  const constants = report.constants;
  const rows = report.stages.static.rows;
  assert.deepEqual(Object.keys(rows).sort(), ["A", "B"].flatMap(root => Object.keys(staticProps).map(id => `${root}/${id}`)).sort());
  for (const [key, ax] of Object.entries(rows)) {
    const id = key.split("/")[1];
    const expectation = resolve(viewProps(staticProps[id]));
    verifyAccessibility(ax, expectation, constants, "static " + key);
    assert.equal(ax.applies >= 1, true, key);
    // A View with the empty descriptor is skipped every time (its Control holds Godot's defaults); one with a
    // descriptor to publish is applied at least once.
    const empty = JSON.stringify(expectation.descriptor) === JSON.stringify(emptyDescriptor);
    if (empty) {
      assert.equal(ax.skippedApplies, ax.applies, key + ": nothing to apply");
    } else {
      assert.ok(ax.skippedApplies < ax.applies, key + ": applied at least once");
    }
    assert.deepEqual([ax.requests, ax.taps, ax.clicks, ax.ignoredRequests], [0, 0, 0, 0], key);
  }
  assert.equal(rows["A/translated"].control.accessibilityName, "Save");
  assert.deepEqual(report.stages.static.translation, {locale: "en", message: "TRANSLATED"}, "A translation for the label existed");
}

// The engine's constants the host resolves by name must exist and be consistent.
function verifyConstants(report) {
  const {constants} = report;
  for (const group of ["roles", "flags", "actions", "live"]) {
    assert.ok(Object.keys(constants[group]).length > 0, group);
    assert.ok(Object.values(constants[group]).every(Number.isInteger), group);
  }
  assert.deepEqual(Object.keys(constants.live).sort(), ["LIVE_ASSERTIVE", "LIVE_OFF", "LIVE_POLITE"]);
  assert.equal(new Set(Object.values(constants.live)).size, 3);
  assert.ok("FLAG_HIDDEN" in constants.flags && "FLAG_DISABLED" in constants.flags && "FLAG_BUSY" in constants.flags);
  assert.ok("ACTION_CLICK" in constants.actions);
  for (const row of roleTable) {
    if (row[2] !== null) {
      assert.ok(row[2] in constants.roles, row[2]);
    }
  }
  assert.notEqual(constants.roles.ROLE_BUTTON, constants.roles.ROLE_LINK);
}

// Replays the timeline: every change of the dyn and dyn-aria views, in order, against the oracle's resolution.
function verifyTimeline(report) {
  const constants = report.constants, previous = {A: {}, B: {}};
  const hostErrors = [];
  const jsMessages = report.stages.negatives.js;
  let jsIndex = 0;
  for (const step of report.stages.timeline) {
    const sent = viewProps(step.props);
    const label = `timeline ${step.id}`;
    // A remount is a new native View, which has reported nothing yet.
    const view = previous[step.root][step.view] ??= {messages: []};
    if (step.remount) {
      view.messages = [];
    }
    const jsFailure = jsError(sent);
    if (jsFailure !== null) {
      // RN's ViewConfig throws, the boundary keeps the error, and the View is never mounted.
      assert.equal(step.present, false, label);
      assert.deepEqual(step.accessibility, {}, label);
      assert.deepEqual(step.hostErrors, [], label);
      const row = jsMessages[jsIndex++];
      assert.equal(step.id, "js/" + row.id, label);
      assert.equal(row.errors.length, 1, label);
      assert.equal(row.errors[0].message, jsFailure, label);
      assert.equal(row.errors[0].slot, step.view, label);
      continue;
    }
    assert.equal(step.present, true, label);
    const expectation = resolve(sent);
    verifyAccessibility(step.accessibility, expectation, constants, label);
    // The host reports each set of reasons once, until they change.
    const reported = expectation.messages.length > 0 && JSON.stringify(expectation.messages) !== JSON.stringify(view.messages);
    view.messages = expectation.messages;
    if (reported) {
      assert.equal(step.hostErrors.length, expectation.messages.length, label);
      step.hostErrors.forEach((error, index) => {
        assert.equal(error, step.accessibility.errors[index], label);
      });
      hostErrors.push(...step.hostErrors);
    } else {
      assert.deepEqual(step.hostErrors, [], label);
    }
  }
  assert.equal(jsIndex, jsMessages.length, "Every JS negative reached the timeline");
  // The application reports the host errors of the timeline and nothing else.
  assert.deepEqual(report.stages.beforeStop.application.errors, hostErrors);
}

function verifyCases(report) {
  const steps = report.stages.timeline;
  const cases = steps.slice(0, report.stages.cases.count);
  assert.equal(cases.length, report.stages.cases.count);
  assert.deepEqual(cases[0].props, {});
  // Every case after the first sets what the case before it did not, and removal clears it.
  const named = id => steps.find(step => step.id === id);
  assert.equal(named("update").accessibility.descriptor.description, "", "Replacing props drops the hint of the case before");
  assert.deepEqual(named("removal").accessibility.descriptor, numbered(emptyDescriptor, report.constants));
  assert.equal(named("role-wins").accessibility.descriptor.roleSource, "role");
  assert.equal(named("literal-label").accessibility.descriptor.name, "100% {0} %s \\ \"q\" é 日本");
  // Different props with the same descriptor: counted, and skipped rather than applied again.
  const sameA = named("same-a").accessibility, sameB = named("same-b").accessibility;
  assert.deepEqual(sameB.descriptor, sameA.descriptor);
  assert.equal(sameB.applies, sameA.applies + 1);
  assert.equal(sameB.skippedApplies, sameA.skippedApplies + 1);
  assert.ok(sameA.skippedApplies < sameA.applies, "The updates before were applied");
  assert.deepEqual(named("cleared").accessibility.descriptor, numbered(emptyDescriptor, report.constants));
}

function verifyAria(report) {
  for (const pair of report.stages.aria.pairs) {
    assert.deepEqual(pair.left, pair.right, "aria " + pair.id);
    assert.notDeepEqual(pair.left, numbered(emptyDescriptor, report.constants), "aria " + pair.id);
  }
}

function verifySweep(report) {
  const steps = report.stages.timeline.filter(step => step.id.startsWith("sweep/") && step.id !== "sweep/cleared");
  const expectedCount = rnVocabularies.a.length + rnVocabularies.r.length;
  assert.equal(steps.length, expectedCount, "Both vocabularies are swept whole");
  const seen = new Set(steps.map(step => step.id));
  assert.equal(seen.size, steps.length);
  // The table covers every spelling: each is either mapped or rejected, never unknown.
  for (const vocabulary of ["a", "r"]) {
    for (const name of rnVocabularies[vocabulary]) {
      const step = steps.find(entry => entry.id === `sweep/${propOf[vocabulary]}/${name}`);
      assert.ok(step, name);
      const rejected = rejectedRoles[vocabulary].includes(name);
      assert.equal(step.accessibility.rejected, rejected, `${propOf[vocabulary]} ${name}`);
      if (!rejected) {
        const row = roleTable.find(entry => entry[0] === name && entry[1].includes(vocabulary));
        assert.ok(row, `${propOf[vocabulary]} ${name} is in the table`);
        const descriptor = step.accessibility.descriptor;
        assert.equal(descriptor.godotRole, row[2], name);
        assert.equal(descriptor.roleDescription, row[3], name);
        assert.equal(descriptor.godotRoleValue, row[2] === null ? null : report.constants.roles[row[2]], name);
        assert.notEqual(descriptor.godotRole, "ROLE_UNKNOWN");
        assert.notEqual(descriptor.godotRole, "ROLE_PANEL");
      }
    }
  }
  assert.equal(supportedNames("a").length + rejectedRoles.a.length, rnVocabularies.a.length);
  assert.equal(supportedNames("r").length + rejectedRoles.r.length, rnVocabularies.r.length);
  // A role the table maps to the generic one would be silent: none maps to ROLE_UNKNOWN or ROLE_PANEL.
  assert.ok(roleTable.every(row => row[2] !== "ROLE_UNKNOWN" && row[2] !== "ROLE_PANEL"));
}

function verifyActions(report) {
  const stage = key => report.stages[`action/${key}`];
  const specs = {
    tap: ["A", "labeled", "tap"], "tap-wins": ["A", "tap-press", "tap"], pressable: ["A", "pressable", "press"],
    touchable: ["A", "touchable", "press"], "touchable-aria": ["A", "touchable-aria", "press"],
    "pressable-aria": ["A", "pressable-aria", "press"], "two-roots": ["B", "labeled", "tap"],
    "disabled-pressable": ["A", "disabled-pressable", "ignored"], "disabled-state": ["A", "disabled-state", "ignored"],
    hidden: ["A", "important", "ignored"], plain: ["A", "plain", "ignored"], "dyn-hidden": ["A", "dyn", "ignored"],
    "dyn-shown": ["A", "dyn", "tap"],
  };
  for (const [key, [root, id, expect]] of Object.entries(specs)) {
    const row = stage(key), label = `action ${key}`;
    assert.deepEqual([row.root, row.id, row.expect], [root, id, expect], label);
    const raw = row.react.log.filter(entry => entry.label === "raw");
    const handlers = row.react.log.filter(entry => entry.label !== "raw");
    const touches = raw.filter(entry => entry.type.startsWith("topTouch")).map(entry => entry.type);
    const delta = name => row.after[name] - row.before[name];
    assert.equal(delta("requests"), 1, label);
    if (expect === "tap") {
      assert.deepEqual(handlers.map(entry => [entry.label, entry.root, entry.id]), [["tap", root, id]], label);
      assert.deepEqual(raw.map(entry => [entry.type, entry.nativeTarget]), [["topAccessibilityTap", row.tag]], label);
      assert.deepEqual([delta("taps"), delta("clicks"), delta("ignoredRequests")], [1, 0, 0], label);
      assert.deepEqual(touches, [], label + ": the OS's press with a handler dispatches only the accessibility event");
    } else if (expect === "press") {
      assert.deepEqual(handlers.map(entry => [entry.label, entry.root, entry.id]), [["press", root, id]], label);
      assert.deepEqual(touches, ["topTouchStart", "topTouchEnd"], label);
      assert.ok(raw.every(entry => entry.nativeTarget === row.tag), label);
      assert.deepEqual([delta("taps"), delta("clicks"), delta("ignoredRequests")], [0, 1, 0], label);
    } else {
      assert.deepEqual(row.react.log, [], label);
      assert.deepEqual([delta("taps"), delta("clicks"), delta("ignoredRequests")], [0, 0, 1], label);
      // An element without an action is one the descriptor says has none.
      assert.equal(row.after.descriptor.clickAction, false, label);
    }
  }
  // The elements that offer the action are the ones the descriptor says do.
  assert.equal(stage("tap").before.descriptor.clickAction, true);
  assert.equal(stage("pressable").before.descriptor.clickAction, true);
  assert.equal(stage("dyn-shown").before.descriptor.clickAction, true);
  assert.equal(stage("dyn-hidden").before.descriptor.hidden, true);
}

function verifyHidden(report) {
  const {hidden} = report.stages;
  assert.equal(hidden.before.hidden, false);
  assert.equal(hidden.hidden.hidden, true);
  assert.equal(hidden.shown.hidden, false);
  assert.equal(hidden.child.hidden, false);
  assert.equal(hidden.child.name, "Inside");
  assert.deepEqual(hidden.other, hidden.before);
  const {removal, relabel} = report.stages;
  assert.equal(removal.removed.deletes, removal.rootBefore.deletes + 1, "Removing the View deletes one Control");
  assert.ok(removal.removed.nodes.every(node => node.testID !== "A-removable"), "The removed View leaves no node");
  assert.notEqual(removal.restored.tag, removal.before.tag);
  assert.equal(removal.restored.accessibility.requests, 0);
  assert.equal(relabel.renamed.descriptor.name, "Renamed");
  assert.equal(relabel.renamed.control.accessibilityName, "Renamed");
  assert.equal(relabel.renamed.descriptor.description, "Saves the draft");
}

// The verdict of the oracle on a report. Throws on the first thing it cannot derive.
export function verifyAccessibilityReport(report, {original = false} = {}) {
  assert.equal(report.scenario, "native-accessibility");
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, "headless");
  assert.deepEqual(report.scope, {headless: true, metadataOnly: true, osTree: false, assistiveTechnology: false, hostPathOfOsPress: true,
    originalViewJs: true, touchableOpacity: true, pressable: true, hardwareCertified: false});
  assert.equal(report.accessibilitySupported, false, "A headless run has no OS accessibility driver");
  assert.deepEqual(report.stages.mount.counts.A, report.stages.mount.counts.B);
  if (original) {
    // The preceding host has no accessible View: its nodes carry no descriptor.
    const nodes = report.stages.mount.roots.A.nodes;
    assert.ok(nodes.length > 0 && nodes.every(node => node.accessibility === undefined));
    assert.equal(report.stages.mount.counts.A.accessible, 0);
    assert.ok(Object.values(report.stages.static.rows).every(row => Object.keys(row).length === 0));
    return;
  }
  const expectedViews = Object.keys(staticProps).length + 1;
  assert.deepEqual(report.stages.mount.counts, {A: {accessible: expectedViews, all: expectedViews}, B: {accessible: expectedViews, all: expectedViews}});
  verifyConstants(report);
  verifyStatic(report);
  verifyTimeline(report);
  verifyCases(report);
  verifyAria(report);
  verifySweep(report);
  verifyActions(report);
  verifyHidden(report);
  // Every control the application created was balanced after stop.
  for (const root of ["A", "B"]) {
    assert.equal(report.stages[`stoppedRoot${root}`].nativeTags, 0);
  }
}

export function oracleRejection(report, options) {
  try {
    verifyAccessibilityReport(report, options);
    return null;
  } catch (error) {
    return error;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The graphical half: build/accessibility-bridge-report.json, from tests/accessibility-bridge-probe.gd and the
// NSAccessibility inspector injected into Godot. The trees in it are what the OS served; the oracle states what
// each element must say with its own table, and judges the waits and the presses from the raw answers.
export const bridgeNormativeOriginalFailures = [
  "tree/The OS tree names every View RN labeled, with the role, the hint and the enabled state RN gave it, in both roots",
  "tree/importantForAccessibility no-hide-descendants and display none leave nothing of the View in the OS tree",
  "tree/Both roots serve their own element of the same label",
  "tree/accessibilityRole tab is the OS's tab button",
  "press/AXPress on a View with onAccessibilityTap runs that handler and sends RN no touch",
];
// By title, what NSAccessibility must report: AX role, subrole, help, enabled.
const bridgeTree = {
  "Save draft": {role: "AXButton", help: "Saves the draft", enabled: true},
  "Tap wins": {role: "AXUnknown", enabled: true},
  Open: {role: "AXButton", help: "Opens the file", enabled: true},
  Share: {role: "AXButton", help: "Shares the file", enabled: true},
  Mute: {role: "AXButton", enabled: true},
  Like: {role: "AXRadioButton", subrole: "AXTabButton", enabled: true},
  Locked: {role: "AXUnknown", enabled: false},
  Off: {role: "AXButton", enabled: false},
  Inside: {role: "AXButton", enabled: true},
  Temporary: {role: "AXButton", enabled: true},
};
const bridgeUpdates = {
  "switch-on": {role: "AXCheckBox", subrole: "AXSwitch", value: 1, help: "Toggles it", enabled: true},
  "switch-off": {role: "AXCheckBox", subrole: "AXSwitch", value: 0, enabled: true},
  disabled: {role: "AXButton", enabled: false},
  enabled: {role: "AXButton", enabled: true},
  heading: {role: "AXStaticText", roleDescription: "heading"},
  tab: {role: "AXRadioButton", subrole: "AXTabButton", value: 1},
  listitem: {selected: true},
  toggle: {role: "AXCheckBox", subrole: "AXToggle", roleDescription: "toggle button", value: 1},
  link: {role: "AXLink"},
  banner: {role: "AXGroup", subrole: "AXLandmarkRegion", roleDescription: "banner"},
  aria: {role: "AXCheckBox", subrole: "AXSwitch", value: 1},
};
const nodesOf = (node, found = []) => {
  found.push(node);
  for (const child of node.children ?? []) {
    nodesOf(child, found);
  }
  return found;
};
const titled = (tree, title) => nodesOf(tree).filter(node => node.title === title);
function assertAxNode(node, expected, label) {
  for (const [key, wanted] of Object.entries(expected)) {
    const actual = node[key] === "" ? null : node[key];
    if (typeof wanted === "number") {
      assert.equal(Number(actual), wanted, `${label}: ${key}`);
    } else {
      assert.equal(actual, wanted, `${label}: ${key}`);
    }
  }
}
const eventsOf = react => react.log.filter(entry => entry.label !== "raw").map(entry => [entry.label, entry.root, entry.id]);
const touchesOf = react => react.log.filter(entry => entry.label === "raw" && entry.type.startsWith("topTouch")).map(entry => entry.type);

export function verifyBridgeReport(report, {original = false} = {}) {
  assert.equal(report.scenario, "native-accessibility-bridge");
  assert.equal(report.reactNative, "0.87.1");
  assert.notEqual(report.displayServer, "headless", "The bridge runs in a window");
  assert.deepEqual(report.scope, {headless: false, osTree: true, nsAccessibility: true, inProcessInspector: true, axPress: true,
    assistiveTechnologySpeech: false, externalAXUIElement: false, hardwareCertified: false});
  assert.equal(report.accessibilitySupported, true, "Godot has an OS accessibility driver in a window");
  assert.equal(report.accessibilityEnabled, true, "Godot's tree is active (--accessibility always)");
  // An inspector that stops answering fails every wait and press that follows: say so, also on the preceding host,
  // where the tree checks fail by design and would hide it.
  assert.equal(report.inspectorLost, "", "The inspector answered every request: " + report.inspectorLost);
  const tree = report.stages.tree.tree;
  if (original) {
    // The preceding host serves a tree of unnamed elements.
    assert.equal(titled(tree, "Save draft").length, 0);
    // Godot names the application node after the node, which no RN prop gave.
    const names = nodesOf(tree).map(node => node.title).filter(title => title !== null && title !== "");
    assert.ok(names.every(title => title === "AccessibilityApplication"), "No element carries a name RN gave it: " + names.join(", "));
    assert.equal(report.stages["press/tap"].answer.matched, 0);
    return;
  }
  assert.ok(report.waits.length > 0 && report.waits.every(wait => wait.met), "Every wait met its state in the frames it had");
  assert.equal(tree.role, "AXUnknown", "The window's content view is the root of the tree");
  for (const [title, expected] of Object.entries(bridgeTree)) {
    const found = titled(tree, title);
    assert.equal(found.length, 2, `${title} is served by both roots`);
    for (const node of found) {
      assertAxNode(node, expected, title);
    }
  }
  assert.deepEqual(["Skipped", "Gone", "Dyn", "Dyn gone"].map(title => titled(tree, title).length), [0, 0, 0, 0]);
  // Presses.
  const press = id => report.stages[`press/${id}`];
  assert.equal(press("tap").answer.pressed, true);
  assert.equal(press("tap").answer.matched, 2);
  assert.deepEqual(eventsOf(press("tap").react), [["tap", "A", "labeled"]]);
  assert.deepEqual(touchesOf(press("tap").react), [], "AXPress with onAccessibilityTap sends no touch");
  assert.deepEqual(eventsOf(press("tap-wins").react), [["tap", "A", "tap-press"]]);
  assert.deepEqual(touchesOf(press("tap-wins").react), []);
  for (const id of ["pressable", "touchable", "touchable-aria", "pressable-aria"]) {
    assert.equal(press(id).answer.pressed, true, id);
    assert.deepEqual(eventsOf(press(id).react), [["press", "A", id]], id);
    assert.deepEqual(touchesOf(press(id).react), ["topTouchStart", "topTouchEnd"], id);
  }
  assert.deepEqual([press("disabled").locked.pressed, press("disabled").off.pressed, press("disabled").marker.pressed], [false, false, true]);
  assert.deepEqual(eventsOf(press("disabled").react), [["press", "A", "pressable"]], "Nothing of the disabled elements reached RN");
  assert.equal(press("two-roots").answer.pressed, true);
  assert.deepEqual(eventsOf(press("two-roots").react), [["tap", "B", "labeled"]]);
  // Updates and removals.
  const rows = Object.fromEntries(report.stages.update.map(row => [row.id, row]));
  assertAxNode(titled(rows.relabel.tree, "Renamed")[0], {role: "AXButton", help: "Saves the draft"}, "relabel");
  assert.equal(titled(rows.relabel.tree, "Save draft").length, 1, "Only root B keeps the old label");
  for (const [id, expected] of Object.entries(bridgeUpdates)) {
    assert.ok(rows[id] != null && rows[id].ok, id);
    assertAxNode(rows[id].node, expected, "update " + id);
    assert.equal(rows[id].node.title, "Dyn", id);
  }
  assert.equal(titled(rows.removal.tree, "Dyn").length, 0, "Removing every prop removes the semantics");
  assert.equal(titled(rows.hidden.tree, "Inside").length, 1, "aria-hidden removes the descendants of the hidden View");
  assert.equal(titled(rows.hidden.tree, "Open").length, 2, "and no other element");
  assert.equal(titled(rows.shown.tree, "Inside").length, 2);
  assert.equal(titled(rows["aria-hidden"].tree, "Dyn gone").length, 0, "aria-hidden removes the View itself");
  assert.equal(titled(rows["aria-hidden"].tree, "Dyn marker").length, 1);
  assert.equal(titled(rows.remount.gone, "Temporary").length, 1);
  assert.equal(titled(rows.remount.back, "Temporary").length, 2);
  // The app's own record: the host reported no error.
  assert.deepEqual(report.stages.beforeStop.application.errors, []);
}

export function bridgeRejection(report, options) {
  try {
    verifyBridgeReport(report, options);
    return null;
  } catch (error) {
    return error;
  }
}
