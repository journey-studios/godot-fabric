import assert from "node:assert/strict";

// Independent oracle of the text-original probe. It judges the raw observations of tests/text-original-probe.gd (the
// events JS received, the native snapshots, the host errors) against rules restated here from RN's sources, never
// against the probe's own verdicts:
//   Pressability.js   the touch states, the region (the responder's rectangle plus pressRectOffset, strict bounds,
//                     the offsets 20/20/20/30 by default), the 130 ms minimum press duration that defers a press out,
//                     the 500 ms long press that cancels the press
//   Text.js           which props make a paragraph pressable, the 18 pt default this platform keeps, the styles
//   the facade        the errors of the rejected props (src/text.jsx, src/react-native-platform.jsx)
// It is run on every lane: a lane that does not behave as the slice says is rejected here by what it observed.
const MIN_PRESS_MS = 130;
const LONG_PRESS_MS = 500;
// Either order of press and press out is accepted within this band of the minimum press duration (clock jitter).
const BAND_MS = 3;
const DEFAULT_OFFSET = {top: 20, left: 20, right: 20, bottom: 30};
const INLINE = "Inline Controls are not implemented in Godot Text";
const INK = "f8fafcff";

// The press targets of the fixture, as declared there.
const targets = {
  tap: {offset: DEFAULT_OFFSET}, long: {offset: DEFAULT_OFFSET, long: true},
  retention: {offset: {top: 10, left: 14, bottom: 10, right: 14}}, span: {offset: DEFAULT_OFFSET},
  inert: {offset: DEFAULT_OFFSET}, responder: {responder: true}, disabled: {inert: true}, plain: {inert: true},
  sentinel: {offset: DEFAULT_OFFSET},
};
// Every gesture runs with a real mouse and a real touch.
const devices = ["mouse", "touch"];
const gestureNames = devices.flatMap(device => ["tap", "held", "outside", "region/default-right-back", "region/default-bottom-back",
  "region/default-right-outside", "region/retention-right-back", "region/retention-bottom-back", "region/retention-right-outside", "long",
  "long-tap", "disabled", "plain", "span/on-span", "span/on-rest", "inert", "responder", "sentinel"].map(name => `${name}/${device}`));

// What each rejected prop must fail with, word for word (a prefix where the message goes on to explain).
const rejections = {
  "span-press": "Godot Text does not implement onPress on a nested Text",
  "span-press-in": "Godot Text does not implement onPressIn on a nested Text",
  "span-press-out": "Godot Text does not implement onPressOut on a nested Text",
  "span-long-press": "Godot Text does not implement onLongPress on a nested Text",
  "span-responder": "Godot Text does not implement onResponderGrant on a nested Text",
  "span-start": "Godot Text does not implement onStartShouldSetResponder on a nested Text",
  "span-move": "Godot Text does not implement onMoveShouldSetResponder on a nested Text",
  "span-start-capture": "Godot Text does not implement onStartShouldSetResponderCapture on a nested Text",
  "span-move-capture": "Godot Text does not implement onMoveShouldSetResponderCapture on a nested Text",
  "span-responder-reject": "Godot Text does not implement onResponderReject on a nested Text",
  "span-responder-start": "Godot Text does not implement onResponderStart on a nested Text",
  "span-responder-end": "Godot Text does not implement onResponderEnd on a nested Text",
  selectable: "Godot Text does not implement selectable",
  fit: "Godot Text does not implement adjustsFontSizeToFit",
  head: "Godot Text supports tail or clip ellipsizeMode",
  middle: "Godot Text supports tail or clip ellipsizeMode",
  bogus: "Godot Text supports tail or clip ellipsizeMode",
  "selection-color": "Godot Text does not implement selectionColor",
  detector: "Godot Text does not implement dataDetectorType",
  "break-strategy": "Godot Text does not implement textBreakStrategy",
  "line-break-ios": "Godot Text does not implement lineBreakStrategyIOS",
  hyphenation: "Godot Text does not implement android_hyphenationFrequency",
  "text-prop": "Godot Text does not implement text: it is not a prop of RN's Text",
  "font-size-prop": "Godot Text does not implement fontSize: it is not a prop of RN's Text",
  "font-style-oblique": "Godot Text does not implement style fontStyle",
  "decoration-dotted": "Godot Text does not implement style textDecorationStyle",
  "lines-negative": "Text numberOfLines must be a nonnegative integer",
  "lines-fraction": "Text numberOfLines must be a nonnegative integer",
  "lines-span": "Godot Text numberOfLines applies to the outer paragraph only",
  "layout-string": "Godot Text onTextLayout must be a function",
  "inline-view": INLINE, "inline-pressable": INLINE, "inline-touchable": INLINE,
};
// A NativeText that skips the wrapper: the host's own refusal, word for word.
const bypass = {
  fit: "Godot Text does not implement adjustsFontSizeToFit",
  head: "Godot Text supports tail or clip ellipsizeMode",
  middle: "Godot Text supports tail or clip ellipsizeMode",
};

// [text, fontSize, fontWeight, fontFamily, color, lineHeight] of every run of a static paragraph, as its style says.
const run = (text, size, weight, family, color = INK, lineHeight = 0) => ({text, size, weight, family, color, lineHeight});
const expectedRuns = {
  "s-default": [run("Default size paragraph", 18, 400, "NotoSans")],
  "s-18": [run("Default size paragraph", 18, 400, "NotoSans")],
  "s-14": [run("Default size paragraph", 14, 400, "NotoSans")],
  "s-mono": [run("Monospaced paragraph", 16, 400, "JetBrainsMono")],
  "s-bold": [run("Bold paragraph", 16, 700, "NotoSans")],
  "s-600": [run("Semibold paragraph", 16, 600, "NotoSans")],
  "s-lh": [run("Explicit leading over several lines", 16, 400, "NotoSans", INK, 30)],
  "s-ls": [run("Spaced letters", 16, 400, "NotoSans")],
  "s-nols": [run("Spaced letters", 16, 400, "NotoSans")],
  "s-center": [run("Centered", 16, 400, "NotoSans")],
  "s-right": [run("Right", 16, 400, "NotoSans")],
  "s-color": [run("Colored paragraph", 16, 400, "NotoSans", "38bdf8ff")],
  "s-spans": [run("base ", 20, 400, "NotoSans"), run("bold", 20, 700, "NotoSans"), run(" amber", 20, 700, "NotoSans", "f59e0bff"),
    run(" ", 20, 400, "NotoSans"), run("big", 28, 400, "NotoSans"), run(" tail", 20, 400, "NotoSans")],
  // No font size and no family anywhere: the 18 pt default of the paragraph reaches the spans that set none.
  "s-inherit": [run("plain ", 18, 400, ""), run("bold", 18, 700, ""), run(" ", 18, 400, ""), run("big", 30, 400, ""), run(" end", 18, 400, "")],
  "s-layout": [run("The text layout still reaches JS through the original Text", 16, 400, "NotoSans")],
  "s-span-layout": [run("Outer ", 16, 400, "NotoSans"), run("inner", 16, 700, "NotoSans")],
  "s-accepted": [run("Default size paragraph", 18, 400, "NotoSans")],
  "s-lines": [run("A paragraph that wants far more than two lines of a narrow box to say all it has", 16, 400, "NotoSans")],
  "s-clip": [run("A paragraph that wants far more than one line of a narrow box", 16, 400, "NotoSans")],
};

const types = rows => rows.map(row => row.type);
const rowsOf = gesture => gesture.steps.flatMap(step => step.events);
const near = (actual, expected) => typeof actual === "number" && Math.abs(actual - expected) < 1e-3;

// The types a gesture must produce, by Pressability's states. "RELEASE" stands for the release of an active press:
// press and press out, in the order the minimum press duration gives them (settled from the timestamps below).
function expectedTypes(gesture) {
  const config = targets[gesture.id];
  const [x, y, width, height] = gesture.rect;
  const hit = ([px, py]) => px >= x && px < x + width && py >= y && py < y + height;
  const region = ([px, py]) => px > x - config.offset.left && px < x + width + config.offset.right &&
    py > y - config.offset.top && py < y + height + config.offset.bottom;
  const expected = [];
  let granted = false, active = false, longFired = false;
  for (const step of gesture.steps) {
    if (step.phase === "tap") {
      // Press and release in the same frame.
      if (hit(step.page) && !config.inert) {
        expected.push(...(config.responder ? ["grant", "release"] : ["in", "RELEASE"]));
      }
    } else if (step.phase === "down" && hit(step.page) && !config.inert) {
      expected.push(config.responder ? "grant" : "in");
      granted = active = true;
    } else if (step.phase === "move" && granted && !config.responder) {
      if (region(step.page) !== active) {
        active = !active;
        expected.push(active ? "in" : "out");
      }
    } else if (step.phase === "wait" && step.type === "long" && config.long && granted && active) {
      expected.push("long");
      longFired = true;
    } else if (step.phase === "up" && granted) {
      if (config.responder) {
        expected.push("release");
      } else if (active) {
        expected.push(longFired ? "out" : "RELEASE");
      }
      granted = active = false;
    }
  }
  return expected;
}

// Settles RELEASE into press and out from the rows: after the minimum press duration out comes first, within it
// press comes first and out follows once the minimum has passed since the last press in.
function settle(gesture, expected, rows) {
  const at = expected.indexOf("RELEASE");
  if (at < 0) {
    return expected;
  }
  const pressed = rows.find(row => row.type === "press");
  assert.ok(pressed != null, `${gesture.name}: a release of an active press presses`);
  const started = rows.filter(row => row.type === "in" && row.sequence < pressed.sequence).at(-1);
  assert.ok(started != null, `${gesture.name}: the press in of the press`);
  const out = rows.filter(row => row.type === "out" && row.sequence > started.sequence).at(0);
  assert.ok(out != null, `${gesture.name}: the press out that follows the last press in`);
  const duration = pressed.at - started.at;
  const first = pressed.sequence < out.sequence ? ["press", "out"] : ["out", "press"];
  if (duration >= MIN_PRESS_MS + BAND_MS) {
    assert.deepEqual(first, ["out", "press"], `${gesture.name}: a press held ${duration} ms presses out before it presses`);
  } else if (duration <= MIN_PRESS_MS - BAND_MS) {
    assert.deepEqual(first, ["press", "out"], `${gesture.name}: a press held ${duration} ms presses before it presses out`);
    assert.ok(out.at - started.at >= MIN_PRESS_MS - BAND_MS, `${gesture.name}: press out waits for the minimum press duration`);
  }
  return [...expected.slice(0, at), ...first, ...expected.slice(at + 1)];
}

function verifyPayloads(gesture) {
  const [x, y] = gesture.rect;
  const registrations = {down: "onResponderGrant", move: "onResponderMove", up: "onResponderRelease"};
  const rows = rowsOf(gesture);
  const press = rows.find(row => row.type === "press");
  const started = rows.find(row => row.type === "in" || row.type === "grant");
  const grants = ["in", "grant"];
  for (const step of gesture.steps) {
    for (const row of step.events) {
      assert.equal(row.id, gesture.id, gesture.name);
      assert.equal(row.target, gesture.tag, `${gesture.name}: the paragraph is the target`);
      assert.ok(row.changedTouches === 1 && row.timestamp > 0, gesture.name);
      // A tap step presses and releases in one frame: its press in is the grant, the rest the release.
      const registration = step.phase === "tap" ? (grants.includes(row.type) ? "onResponderGrant" : "onResponderRelease") : registrations[step.phase];
      if (registration !== undefined) {
        assert.equal(row.registration, registration, `${gesture.name}: ${row.type} in the ${step.phase} step`);
        assert.equal(row.currentTarget, gesture.tag, gesture.name);
        assert.ok(near(row.pageX, step.page[0]) && near(row.pageY, step.page[1]), `${gesture.name}: page of ${row.type}`);
        assert.ok(near(row.locationX, step.page[0] - x) && near(row.locationY, step.page[1] - y), `${gesture.name}: location of ${row.type}`);
        const released = step.phase === "up" || step.phase === "tap" && !grants.includes(row.type);
        assert.equal(row.touches, released ? 0 : 1, gesture.name);
      } else if (step.phase === "wait" && row.type === "out") {
        // The deferred press out receives the persisted event of the release.
        assert.equal(row.registration, "onResponderRelease", gesture.name);
        assert.equal(row.payloadId, press.payloadId, `${gesture.name}: the deferred press out carries the release event`);
      } else if (step.phase === "wait" && row.type === "long") {
        assert.equal(row.registration, "onResponderGrant", gesture.name);
        assert.equal(row.payloadId, started.payloadId, `${gesture.name}: the long press carries the grant event`);
        assert.ok(row.at - started.at >= LONG_PRESS_MS - 1, `${gesture.name}: the long press waits for its 500 ms delay`);
      }
    }
  }
  assert.ok(rows.every(row => row.identifier === rows[0].identifier), `${gesture.name}: one contact`);
  assert.deepEqual(rows.map(row => row.sequence), rows.map(row => row.sequence).sort((a, b) => a - b), `${gesture.name}: events in dispatch order`);
}

function verifyGesture(gesture) {
  const rows = rowsOf(gesture);
  const expected = settle(gesture, expectedTypes(gesture), rows);
  assert.deepEqual(types(rows), expected, `${gesture.name}: the events Pressability derives from the samples`);
  verifyPayloads(gesture);
  const down = gesture.steps.find(step => step.phase === "down");
  if (down !== undefined) {
    assert.equal(down.pointer.responder, rows.length > 0 ? gesture.tag : 0, `${gesture.name}: the native responder`);
  }
  const last = gesture.steps.at(-1).pointer;
  assert.ok(last.responder === 0 && last.activeTouches === 0, `${gesture.name}: released at the end`);
}

export const sections = {
  mount(report) {
    const mount = report.stages.mount;
    assert.deepEqual(mount.renderErrors.filter(row => !row.case.startsWith("s-")), []);
    for (const id of ["tap", "long", "retention", "disabled", "span", "inert", "responder", "plain"]) {
      assert.ok(mount.paragraphs.includes(id), `${id} is mounted as a paragraph`);
    }
    assert.deepEqual(mount.application.errors, []);
  },
  registry(report) {
    const {text, virtual, original, secondText, secondVirtual} = report.stages.registry;
    assert.equal(original.error, null);
    assert.equal(original.loaded, true);
    assert.equal(original.text, "RCTText");
    assert.equal(original.virtual, "RCTVirtualText");
    assert.equal(secondText, "Tried to register two views with the same name RCTText");
    assert.equal(secondVirtual, "Tried to register two views with the same name RCTVirtualText");
    assert.deepEqual([text.uiViewClassName, text.onTextLayout, text.isPressable, text.topTextLayout],
      ["RCTText", true, true, "onTextLayout"]);
    for (const name of ["fontFamily", "fontSize", "fontWeight", "letterSpacing", "lineHeight", "textAlign", "color"]) {
      assert.ok(text.styleNames.includes(name), `RCTText declares the style ${name}`);
    }
    assert.deepEqual([virtual.uiViewClassName, virtual.onTextLayout, virtual.isPressable, virtual.topTextLayout],
      ["RCTVirtualText", false, true, null]);
  },
  press(report) {
    const names = Object.entries(report.stages).filter(([, stage]) => Array.isArray(stage.steps)).map(([name]) => name);
    assert.deepEqual(names.sort(), [...gestureNames].sort(), "every press gesture ran");
    for (const name of gestureNames) {
      verifyGesture({...report.stages[name], name});
    }
    // The deferred press out and the long press are judged by what happened, so these must have been exercised.
    for (const device of devices) {
      const kinds = name => types(rowsOf(report.stages[`${name}/${device}`]));
      assert.deepEqual(kinds("held"), ["in", "out", "press"], `${device}: a press held past the minimum presses out before it presses`);
      assert.deepEqual(kinds("long"), ["in", "long", "out"], `${device}: a long press does not press`);
      assert.deepEqual(kinds("region/retention-right-back"), ["in", "out", "in", "out", "press"], device);
      assert.deepEqual(kinds("region/default-bottom-back"), ["in", "out", "in", "out", "press"], device);
      assert.deepEqual(kinds("region/default-right-outside"), ["in", "out"], device);
      for (const name of ["disabled", "plain", "outside"]) {
        assert.deepEqual(kinds(name), [], `${name}/${device} reports nothing`);
      }
      // A press over the paragraph is the paragraph's, whether over a span or not.
      for (const name of ["span/on-span", "span/on-rest"]) {
        assert.deepEqual(kinds(name).filter(type => type === "press"), ["press"], `${name}/${device}`);
      }
    }
  },
  static(report) {
    const {paragraphs, react} = report.stages.static;
    assert.deepEqual(Object.keys(paragraphs).sort(), Object.keys(expectedRuns).sort());
    for (const [id, expected] of Object.entries(expectedRuns)) {
      const node = paragraphs[id];
      assert.equal(node.runs.length, expected.length, `${id}: the runs`);
      expected.forEach((want, index) => {
        const got = node.runs[index];
        assert.equal(node.nativeText.slice(got.start, got.end), want.text, `${id}: run ${index} text`);
        assert.deepEqual([got.fontSize, got.fontWeight, got.fontFamily, got.color, got.lineHeight],
          [want.size, want.weight, want.family, want.color, want.lineHeight], `${id}: run ${index} style`);
      });
      assert.equal(node.nativeText, expected.map(want => want.text).join(""), `${id}: the text`);
    }
    const lines = id => paragraphs[id].lineMetrics;
    assert.deepEqual(lines("s-default"), lines("s-18"), "no size lays out as 18");
    assert.ok(paragraphs["s-14"].measuredHeight < paragraphs["s-18"].measuredHeight);
    assert.ok(paragraphs["s-ls"].measuredWidth > paragraphs["s-nols"].measuredWidth, "letterSpacing widens");
    assert.ok(lines("s-lh").length > 1 && lines("s-lh").every(row => row.height === 30), "lineHeight is the height of every line");
    const centered = lines("s-center")[0], right = lines("s-right")[0];
    assert.ok(near(centered.x, (200 - centered.width) / 2) && near(right.x, 200 - right.width), "textAlign");
    for (const field of ["runs", "lineMetrics", "measuredWidth", "measuredHeight"]) {
      assert.deepEqual(paragraphs["s-accepted"][field], paragraphs["s-18"][field], `the accepted props leave ${field} alone`);
    }
    assert.deepEqual([paragraphs["s-lines"].visibleLines, paragraphs["s-lines"].ellipses], [2, 1]);
    assert.deepEqual([paragraphs["s-clip"].visibleLines, paragraphs["s-clip"].ellipses], [1, 0]);
    assert.deepEqual(react.layouts.map(row => [row.id, row.text]).sort(),
      [["s-layout", "The text layout still reaches JS through the original Text"], ["s-span-layout", "Outer inner"]],
      "onTextLayout reaches the outer paragraph only");
    assert.deepEqual(react.renderErrors.filter(row => row.case.startsWith("s-")), []);
  },
  negative(report) {
    const {failures, react} = report.stages.negative;
    assert.deepEqual(failures.map(row => row.kind), Object.keys(rejections), "every rejected prop was tried");
    for (const row of failures) {
      assert.ok(row.message.startsWith(rejections[row.kind]), `${row.kind} fails with ${rejections[row.kind]}, not ${row.message}`);
      assert.equal(row.fallback, true, `${row.kind}: the boundary caught it`);
    }
    assert.equal(react.rejections.length, Object.keys(rejections).length, "each prop failed once");
  },
  bypass(report) {
    const {reports} = report.stages.bypass;
    assert.deepEqual(reports.map(row => row.kind), Object.keys(bypass));
    for (const row of reports) {
      assert.deepEqual(row.renderErrors, [], `${row.kind}: the import itself works`);
      assert.equal(row.mounted, true, `${row.kind}: the paragraph is mounted`);
      assert.ok(row.errors.length > 0, `${row.kind}: the host refuses it`);
      assert.ok(row.errors.every(error => error === bypass[row.kind]), `${row.kind}: refused with ${bypass[row.kind]}`);
    }
  },
  stop(report) {
    const stopped = report.stages.afterStop;
    assert.ok(stopped.stopped && stopped.rootCount === 0 && stopped.pendingTimers === 0);
    // Every host error of the run is one of the bypass refusals, and nothing else.
    const allowed = new Set(Object.values(bypass));
    assert.ok(stopped.errors.every(error => allowed.has(error)), "no host error besides the refusals of the bypass cases");
  },
};

// Each section's first rejected observation of a report, by name; null where it accepts.
export function oracleRejections(report) {
  return Object.fromEntries(Object.entries(sections).map(([name, section]) => {
    try {
      section(report);
      return [name, null];
    } catch (error) {
      return [name, String(error.message).replace(/\s+/g, " ").slice(0, 300)];
    }
  }));
}

export function verifyTextOriginalReport(report) {
  for (const section of Object.values(sections)) {
    section(report);
  }
}
