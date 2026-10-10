import assert from "node:assert/strict";

// Independent oracle for build/scope-0.5-report.json, written apart from tests/scope-0.5-probe.gd and from src/prop-scope.mjs. It
// recomputes what every case must have done from two documents only: the inventory of the props RN declares
// (docs/compatibility/contracts-0.87.1.json) and the manifest's classification (docs/compatibility/scope-0.5.json), then judges
// the raw errors and the raw nodes of the report, not the verdicts of the probe.
const components = ["View", "Text", "Pressable", "Image", "Modal", "ActivityIndicator", "ScrollView"];
const owners = {View: "ViewProps", Text: "TextProps", Pressable: "PressableProps", Image: "ImageProps", Modal: "ModalProps",
  ActivityIndicator: "ActivityIndicatorProps", ScrollView: "ScrollViewProps"};
// What the host makes of each component's element.
const kinds = {View: "view", Text: "paragraph", Pressable: "view", Image: "image", Modal: "modal", ActivityIndicator: "activity", ScrollView: "scroll"};
// What the SDK of main before this slice already refused, and with which text: the causal control on that SDK passes these
// cases and fails the others. The Pressable threw for a truthy hover handler with its own text.
const mainRefused = {
  Text: ["selectable", "adjustsFontSizeToFit", "selectionColor", "dataDetectorType", "textBreakStrategy", "lineBreakStrategyIOS",
    "android_hyphenationFrequency", "ellipsizeMode"],
  Image: ["children"],
};
// The platform options of the Text that main refused at any value that is not null, their defaults included: the rule of the
// default is new, so main fails the default group of the Text.
const mainRefusedAtDefault = {Text: ["dataDetectorType", "textBreakStrategy", "lineBreakStrategyIOS", "android_hyphenationFrequency"]};
const mainOtherText = {Pressable: {onHoverIn: "Godot Pressable hover events are not implemented yet",
  onHoverOut: "Godot Pressable hover events are not implemented yet"}};
// The SDK of main has the ScrollView of PR #58, whose contract refused its own table of props with other words: the props that the
// manifest decides for the ScrollView by the decision of that contract (and removeClippedSubviews, which was in its table too), and
// the two props the lists hand it. The manifest says which: its rules cite the test of that contract.
const scrollContract = "tests/scroll-view-contract.test.mjs";
function mainMessage(component, name, rule) {
  if (component === "ScrollView" && (rule.source?.includes(scrollContract) || name === "removeClippedSubviews")) {
    return name === "onRefresh" || name === "refreshing" ? "Godot ScrollView refreshControl is not implemented" : `Godot ScrollView ${name} is not implemented`;
  }
  return mainOtherText[component]?.[name];
}
// The refused Modal props that the host of main refuses itself from inside the mount, which stops the application: the
// control cannot drive them.
const hostFatalOnMain = {Modal: ["animationType", "presentationStyle", "statusBarTranslucent", "navigationBarTranslucent",
  "hardwareAccelerated", "allowSwipeDismissal"]};
// Counters of what the host did and when, and identities: not part of what an element looks like.
const volatile = ["tag", "id", "testID", "x", "y", "fabricX", "fabricY", "focused"];

function scrub(node) {
  const value = structuredClone(node);
  for (const key of volatile) {
    delete value[key];
  }
  if (value.modalWindow) {
    for (const key of ["id", "parentId", "exclusive"]) {
      delete value.modalWindow[key];
    }
  }
  for (const key of ["counters", "events", "ignored", "drawn", "planned"]) {
    delete value.image?.[key];
  }
  for (const key of ["frames", "draws", "turns"]) {
    delete value.activity?.[key];
  }
  delete value.activity?.drawn?.turns;
  delete value.activity?.drawn?.head;
  delete value.accessibility?.applies;
  delete value.accessibility?.clicks;
  return value;
}
// The nodes of a slot, by what they are inside it.
function shapeOf(slot, nodes) {
  return Object.fromEntries(nodes.map(node => [node.testID.slice(slot.length + 1), scrub(node)]));
}
const same = (left, right) => JSON.stringify(sortKeys(left)) === JSON.stringify(sortKeys(right));
function sortKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortKeys(value[key])]));
  }
  return value;
}

// What the inventory and the manifest say, as a plain table: component -> name -> {decision, message, when, probe}.
function expectations(manifest, inventory) {
  const expected = {};
  for (const component of components) {
    const declared = new Set(inventory.contracts.filter(row => row.owner === owners[component] && (row.kind === "prop" || row.kind === "event"))
      .map(row => row.name));
    const entry = manifest.components[component];
    assert.equal(entry.owner, owners[component], component);
    const table = {};
    const classify = (rule, name, listed) => {
      if (rule.decision !== "supported") {
        // A prop that is not supported says why and where from.
        assert.ok(typeof rule.reason === "string" && rule.reason.length > 10, `${component}.${name} has a reason`);
        assert.ok(Array.isArray(rule.source) && rule.source.length > 0 && rule.source.every(source => typeof source === "string" && source.length > 0),
          `${component}.${name} cites a source`);
      }
      if (rule.decision === "refused") {
        // The value that leaves the host as it is passes: it comes first in `accepts`, with the source that gives it. A function has
        // no default, and a prop that accepts nothing says in its reason that it has none or that its default is refused too.
        if (rule.accepts === undefined) {
          assert.ok(isEvent(name) || /no default|default included/.test(rule.reason), `${component}.${name} has no default and says so`);
        } else {
          assert.ok(Array.isArray(rule.accepts) && rule.accepts.length > 0, `${component}.${name} accepts its default`);
          assert.ok(Array.isArray(rule.defaultSource) && rule.defaultSource.length > 0, `${component}.${name} cites its default`);
          assert.ok(!rule.accepts.some(value => sameJson(value, probeOf(name, rule))), `${component}.${name}: the probe is refused`);
        }
      }
      table[name] = {decision: rule.decision, accepts: rule.accepts, message: rule.message, probe: rule.probe, source: rule.source,
        ...(listed ? {listed: true} : {})};
    };
    for (const rule of entry.rules) {
      for (const name of rule.names) {
        assert.ok(declared.has(name), `${component}.${name} is declared by RN`);
        assert.ok(!(name in table), `${component}.${name} is classified once`);
        classify(rule, name, false);
      }
    }
    assert.deepEqual(Object.keys(table).sort(), [...declared].sort(), `${component}: every declared prop is classified`);
    // The refused props that RN does not declare for the component and the lists hand to it: the ScrollView's pull to refresh.
    for (const rule of entry.listRules ?? []) {
      for (const name of rule.names) {
        assert.ok(!declared.has(name) && !(name in table), `${component}.${name} is not declared by RN for the component`);
        assert.equal(rule.decision, "refused", `${component}.${name}`);
        classify(rule, name, true);
      }
    }
    expected[component] = table;
  }
  return expected;
}

const functionMarker = "function";
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const isEvent = name => /^on[A-Z]/.test(name);
function probeOf(name, rule) {
  return rule.probe !== undefined ? rule.probe : isEvent(name) ? functionMarker : true;
}
const allowedOf = rule => rule.accepts ?? [];

const controlEffects = {
  View: (made, base) => made.el.accessibility.control.accessibilityName === "Control" && base.el.accessibility.control.accessibilityName === "",
  Pressable: (made, base) => made.el.accessibility.control.accessibilityName === "Control" && base.el.accessibility.control.accessibilityName === "",
  Text: (made, base) => made.el.fabricHeight < base.el.fabricHeight && made.el.ellipses > base.el.ellipses,
  Image: (made, base) => made.el.image.props.blurRadius === 3 && base.el.image.props.blurRadius === 0,
  Modal: (made, base) => made.el === undefined && base.el.modalWindow.visible === true,
  ActivityIndicator: (made, base) => made.el.activity.animating === false && base.el.activity.animating === true,
  ScrollView: (made, base) => made.el.scroll.enabled === false && base.el.scroll.enabled === true,
};

export function verifyScopeReport(report, {manifest, inventory, original = false}) {
  assert.equal(report.scenario, "native-scope-0.5");
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, "headless");
  assert.equal(report.allowOriginalNegative, original);
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length, "check names are unique");
  const expected = expectations(manifest, inventory);
  const lane = original ? "previous" : "current";
  assert.equal(report.plan.lane, lane);
  // The plan drives every refused, ignored and partly refused prop of the six components, and the controls, and nothing else.
  const fatal = original ? hostFatalOnMain : {};
  assert.deepEqual(report.plan.skipped.map(row => `${row.component}.${row.prop}`).sort(),
    Object.entries(fatal).flatMap(([component, names]) => names.map(name => `${component}.${name}`)).sort());
  const planned = {refused: {}, ignored: {}, allowed: {}, default: {}};
  assert.equal(report.aborted, "", "the run reached the end of its plan");
  const legacy = manifest.propPolicy.legacyProps;
  const undeclared = ["kind", "text", "onActivate", "svg", "placeholder", "submitBehavior", "unknownProp", "data-test", "className"];
  for (const group of report.plan.groups.filter(entry => !["controls", "legacy", "undeclared"].includes(entry.kind))) {
    assert.ok(components.includes(group.component), group.id);
    assert.ok(group.id.startsWith(`${group.component}/${group.kind}/`), group.id);
    assert.deepEqual(group.baselines.map(row => row.slot), [`${group.id}#base`]);
    for (const entry of group.cases) {
      assert.equal(entry.component, group.component, entry.slot);
      const key = `${entry.component}.${entry.prop}`;
      const rule = expected[entry.component][entry.prop];
      assert.ok(rule !== undefined, `${key} is declared`);
      planned[group.kind][key] ??= [];
      planned[group.kind][key].push(entry);
      if (group.kind === "refused") {
        assert.equal(rule.decision, "refused", key);
        assert.equal(entry.message, rule.message ?? `Godot ${entry.component} does not implement ${entry.prop}`, key);
        assert.deepEqual(entry.value, probeOf(entry.prop, rule), key);
      } else if (group.kind === "ignored") {
        assert.equal(rule.decision, "ignored", key);
        assert.ok(entry.value !== null && entry.value !== undefined, `${key} is driven with a value`);
      } else {
        assert.equal(rule.decision, "refused", key);
        assert.ok(allowedOf(rule).some(value => sameJson(value, entry.value)), `${key} is driven with a value that works`);
        // the default of the prop is driven in its own group, with the snapshot compared; the other values only have to work
        assert.equal(sameJson(entry.value, rule.accepts[0]), group.kind === "default", `${key}: ${group.kind} is the group of ${JSON.stringify(entry.value)}`);
      }
    }
  }
  const wanted = {refused: [], ignored: [], allowed: [], default: []};
  for (const component of components) {
    for (const [name, rule] of Object.entries(expected[component])) {
      const key = `${component}.${name}`;
      if (rule.decision === "refused" && !fatal[component]?.includes(name)) {
        wanted.refused.push(key);
        for (const value of allowedOf(rule)) {
          wanted[sameJson(value, rule.accepts[0]) ? "default" : "allowed"].push(key);
        }
      } else if (rule.decision === "ignored") {
        wanted.ignored.push(key);
      }
    }
  }
  assert.deepEqual(Object.keys(planned.refused).sort(), wanted.refused.sort(), "every refused prop is driven once");
  assert.ok(Object.values(planned.refused).every(list => list.length === 1));
  assert.deepEqual(Object.keys(planned.ignored).sort(), wanted.ignored.sort(), "every ignored prop is driven once");
  assert.ok(Object.values(planned.ignored).every(list => list.length === 1));
  assert.deepEqual(Object.keys(planned.allowed).sort(), [...new Set(wanted.allowed)].sort(), "every partly refused prop is driven with its allowed values");
  assert.deepEqual(Object.keys(planned.default).sort(), [...new Set(wanted.default)].sort(), "every partly refused prop is driven with RN's default");
  assert.ok(Object.values(planned.default).every(list => list.length === 1), "RN's default is one value");
  // Each group, mount and update.
  const outcomes = {refused: 0, ignored: 0, allowed: 0, default: 0, undeclared: 0};
  const silent = [];
  // The keys RN does not declare: Text's earlier wrapper props fail with the hint; every other key is not checked.
  const extra = report.plan.groups.filter(entry => entry.kind === "legacy" || entry.kind === "undeclared");
  assert.deepEqual(extra.filter(group => group.kind === "legacy").flatMap(group => group.cases.map(entry => `${group.component}.${entry.prop}`)).sort(),
    Object.entries(legacy).flatMap(([component, props]) => Object.keys(props).map(prop => `${component}.${prop}`)).sort());
  for (const component of components) {
    const keys = extra.filter(group => group.component === component && group.kind === "undeclared").flatMap(group => group.cases.map(entry => entry.prop)).sort();
    assert.deepEqual(keys, undeclared.filter(key => !(key in (legacy[component] ?? {}))).sort(), `${component}: the undeclared keys driven`);
    assert.ok(keys.every(key => expected[component][key] === undefined), `${component}: none of them is declared by RN`);
  }
  const leaked = [];
  const defaultRefused = [];
  for (const group of report.groups.filter(entry => entry.kind !== "controls")) {
    const baseSlot = group.baselines[0].slot;
    assert.deepEqual(group.base.errors, [], `${group.id}: the baseline mounts clean`);
    assert.deepEqual(group.base.hostErrors, [], group.id);
    const baseline = shapeOf(baseSlot, group.base.slots[baseSlot]);
    assert.ok(baseline.el?.kind === kinds[group.component] && baseline.cell?.kind === "view", `${group.id}: the baseline mounts a ${kinds[group.component]}`);
    for (const phase of ["mount", "update"]) {
      const data = group[phase];
      assert.deepEqual(data.hostErrors, [], `${group.id}/${phase}: the host reports nothing`);
      assert.deepEqual(data.slots[baseSlot].map(node => node.testID).sort(), group.base.slots[baseSlot].map(node => node.testID).sort(),
        `${group.id}/${phase}: the baseline does not move`);
      for (const entry of group.cases) {
        const rule = expected[group.component][entry.prop];
        const errors = data.errors.filter(row => row.slot === entry.slot);
        const slotNodes = data.slots[entry.slot];
        const element = slotNodes.find(node => node.testID === `${entry.slot}-el`);
        const label = `${group.id}/${phase}/${entry.prop}`;
        if (group.kind === "legacy") {
          assert.equal(errors.length, 1, `${label}: fails once`);
          assert.equal(errors[0].message, `Godot ${group.component} does not implement ${entry.prop}: ${legacy[group.component][entry.prop]}`, label);
          assert.equal(element, undefined, label);
          continue;
        }
        if (group.kind === "refused") {
          const accepted = mainRefused[group.component]?.includes(entry.prop) ?? false;
          const text = rule.message ?? `Godot ${group.component} does not implement ${entry.prop}`;
          if (original && !accepted) {
            // The SDK of main drops it silently (or, for the hover handlers, says something else).
            const other = mainMessage(group.component, entry.prop, rule);
            if (other === undefined) {
              assert.deepEqual(errors, [], `${label}: main drops it without a word`);
              assert.ok(element !== undefined && element.kind === kinds[group.component], `${label}: and mounts the element`);
              silent.push(label);
            } else {
              assert.equal(errors.length, 1, label);
              assert.equal(errors[0].message, other, label);
              assert.notEqual(other, text, label);
              assert.equal(element, undefined, label);
            }
          } else {
            assert.equal(errors.length, 1, `${label}: fails once`);
            assert.equal(errors[0].message, text, `${label}: with the error of the table`);
            assert.equal(errors[0].group, group.id, label);
            assert.equal(element, undefined, `${label}: and mounts nothing`);
            assert.equal(slotNodes.filter(node => node.testID.endsWith("-child")).length, 0, `${label}: not even its child`);
            assert.equal(slotNodes.filter(node => node.testID.endsWith("-cell")).length, 1, `${label}: only the cell around it stays`);
          }
          outcomes.refused += 1;
        } else if (original && group.kind === "default" && mainRefusedAtDefault[group.component]?.includes(entry.prop)) {
          assert.equal(errors.length, 1, `${label}: main refuses the default too`);
          assert.equal(errors[0].message, `Godot ${group.component} does not implement ${entry.prop}`, label);
          assert.equal(element, undefined, label);
          defaultRefused.push({group: group.id, phase});
          outcomes.default += 1;
        } else {
          assert.deepEqual(errors, [], `${label}: no error`);
          assert.ok(element !== undefined && element.kind === kinds[group.component], `${label}: the element mounts`);
          if (group.kind === "ignored" || group.kind === "undeclared" || group.kind === "default") {
            const equal = same(shapeOf(entry.slot, slotNodes), baseline);
            if (original && group.kind === "undeclared" && group.component === "Pressable") {
              // main hands the Control's own names to the host: the control sees what leaked.
              if (!equal) {
                leaked.push({label, group: group.id, phase});
              }
            } else {
              assert.ok(equal, `${label}: the host shows what the baseline shows`);
            }
          }
          outcomes[group.kind] += 1;
        }
      }
    }
  }
  assert.equal(outcomes.refused, 2 * wanted.refused.length);
  assert.equal(outcomes.ignored, 2 * wanted.ignored.length);
  assert.equal(outcomes.allowed, 2 * wanted.allowed.length);
  assert.equal(outcomes.default, 2 * wanted.default.length);
  assert.equal(outcomes.undeclared, 2 * components.reduce((sum, component) => sum + undeclared.filter(key => !(key in (legacy[component] ?? {}))).length, 0));
  // The controls: a supported prop changes what the host shows, so that the equalities above could have failed.
  const controls = report.groups.find(group => group.id === "controls");
  assert.deepEqual(controls.mount.errors, []);
  assert.deepEqual(controls.mount.hostErrors, []);
  assert.deepEqual(controls.cases.map(entry => entry.component), components);
  for (const entry of controls.cases) {
    const made = shapeOf(entry.slot, controls.mount.slots[entry.slot]);
    const base = shapeOf(`${entry.slot}#base`, controls.mount.slots[`${entry.slot}#base`]);
    assert.ok(controlEffects[entry.component](made, base), `control ${entry.component}.${entry.prop} changes what the host shows`);
    assert.ok(!same(made, base), `control ${entry.component}.${entry.prop}`);
  }
  // Cleanup
  assert.ok(report.afterStop.stopped && report.afterStop.rootCount === 0 && report.afterStop.pendingWork === 0);
  assert.ok(report.finalRoot.nativeTags === 0 && report.finalRoot.creates === report.finalRoot.deletes);
  assert.ok(report.cleared.nativeTags <= 2, "removing every group leaves only the root View");
  assert.ok(report.waits.length >= report.groups.length * 4);
  if (original) {
    // main drops the refused props that it did not already refuse, and the probe's own checks fail exactly on those groups,
    // plus the Pressable groups in which a name only the Control has reached the host.
    assert.ok(report.originalNegativeObserved);
    const failing = report.checks.filter(row => !row.passed).map(row => row.name).sort();
    const phases = group => ["mount", "update"].map(phase => [group, phase]);
    const refusedChecks = report.groups.filter(group => group.kind === "refused").flatMap(group => phases(group.id))
      .map(([id, phase]) => `${id}/${phase}/Each refused prop fails in its own boundary with the error of the table and mounts nothing`);
    const leakChecks = [...new Set(leaked.map(row => `${row.group}/${row.phase}/Every ignored prop leaves the host exactly as the baseline has it`))];
    const defaultSentences = ["No case fails and the host reports nothing", "Each refused prop's default leaves the host exactly as the baseline has it"];
    const defaultChecks = [...new Set(defaultRefused.map(row => `${row.group}/${row.phase}`))].flatMap(prefix => defaultSentences.map(sentence => `${prefix}/${sentence}`));
    assert.deepEqual(failing, [...refusedChecks, ...leakChecks, ...defaultChecks].sort());
    const permitted = new Set([...refusedChecks, ...report.groups.filter(group => group.kind === "undeclared" && group.component === "Pressable")
      .flatMap(group => phases(group.id)).map(([id, phase]) => `${id}/${phase}/Every ignored prop leaves the host exactly as the baseline has it`),
    ...report.groups.filter(group => group.kind === "default" && group.component === "Text").flatMap(group => phases(group.id))
      .flatMap(([id, phase]) => defaultSentences.map(sentence => `${id}/${phase}/${sentence}`))]);
    assert.deepEqual([...report.expectedOriginalFailures].sort(), [...permitted].sort());
    assert.ok(leaked.length > 0 && silent.length > 0 && defaultRefused.length > 0,
      "main leaks the Control's names through the Pressable, drops the refused props and refuses the Text options at their defaults");
    return {silent: silent.length, refusedCases: outcomes.refused, leaked: leaked.length, defaultRefused: defaultRefused.length};
  }
  assert.equal(report.originalNegativeObserved, false);
  assert.ok(report.checks.every(row => row.passed), "every check of the probe passed");
  assert.equal(report.allCurrentAssertionsPassed, true);
  return {refusedCases: outcomes.refused, ignoredCases: outcomes.ignored, allowedCases: outcomes.allowed, defaultCases: outcomes.default,
    undeclaredCases: outcomes.undeclared};
}

// The signals by which a process dies of its own fault: an abort (an uncaught C++ exception), a bad access, an illegal instruction, an
// arithmetic fault and a trap. A SIGKILL or a SIGTERM comes from outside (the out-of-memory killer, a person, CI cancelling the job),
// so it says nothing about the host refusing the SDK and must not pass as the sabotage's rejection.
const HOST_CRASH_SIGNALS = ["SIGABRT", "SIGBUS", "SIGSEGV", "SIGILL", "SIGFPE", "SIGTRAP"];

// For a sabotaged run that wrote no report: whether the host itself refused the SDK. A refused prop that reaches the host throws
// inside RN's C++ prop conversion and the process dies by one of its own crash signals: SIGABRT with Godot's crash text on most runs,
// SIGBUS with no text on some (1 run in 14 on the machine that found it). The signal is the rejection and the text is not needed; a
// probe that stops by itself leaves `SCRIPT ERROR`. A run that ends without a report, a crash signal or a text rejected nothing,
// whatever its exit code.
export function hostRejected({signal}, log) {
  return HOST_CRASH_SIGNALS.includes(signal) || /Program crashed|SCRIPT ERROR/.test(log);
}

// For a sabotaged run: why the oracle does not accept the report, or null when it does.
export function oracleRejection(report, context) {
  try {
    verifyScopeReport(report, context);
    return null;
  } catch (error) {
    return error.message;
  }
}
