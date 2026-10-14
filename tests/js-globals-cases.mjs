// What the fixture (in Hermes) and the oracle (in Node) both do, written once: the stimulus, never an expectation. The oracle derives
// what must come out from RN's own sources, so nothing here says what a console prints or which globals RN installs.

// The calls the console scenario makes. A value is JSON, except {"$error": text}, which stands for new Error(text).
export const consoleCalls = [
  {method: "log", args: ["one string"]},
  {method: "log", args: ["A", "B"]},
  {method: "info", args: ["count", 3, true, null]},
  {method: "log", args: [{a: 1, b: ["x", 2]}]},
  {method: "debug", args: ["debug"]},
  {method: "trace", args: ["trace", 0]},
  {method: "warn", args: ["warn", 2]},
  {method: "error", args: ["error", 3]},
  {method: "error", args: ["Warning: reported as a warning", 1]},
  {method: "error", args: [{$error: "boom"}]},
  {method: "assert", args: [true, "not logged"]},
  {method: "assert", args: [false, "boom"]},
  {method: "group", args: ["outer"]},
  {method: "log", args: ["inside"]},
  {method: "groupCollapsed", args: ["inner"]},
  {method: "log", args: ["deeper"]},
  {method: "groupEnd", args: []},
  {method: "groupEnd", args: []},
  {method: "log", args: ["after the groups"]},
  {method: "table", args: [[{name: "a", n: 1}, {name: "b", n: 2}]]},
  {method: "time", args: ["t"]},
  {method: "timeEnd", args: ["t"]},
  {method: "timeStamp", args: ["t"]},
  {method: "count", args: ["c"]},
  {method: "countReset", args: ["c"]},
];

// The call the first module of the bundle makes, before the fixture's own code and before RN's setup modules run.
export const firstCall = {method: "log", args: ["first", "module", 1]};

// The DOM globals the fixture resolves. The oracle compares the list with RN's setUpDOM.js, so a global RN adds fails there.
export const domGlobals = ["DOMRect", "DOMRectReadOnly", "DOMRectList", "HTMLCollection", "NodeList", "Node", "Document", "CharacterData",
  "Text", "Element", "HTMLElement", "Event", "EventTarget", "CustomEvent"];

// The frames the clock sample waits for. The probe stops at the first frame past this count and at no later time than the deadline.
export const clockFrames = 12;

export function materialize(value, makeError) {
  if (Array.isArray(value)) {
    return value.map(item => materialize(item, makeError));
  }
  if (value !== null && typeof value === "object") {
    if (typeof value.$error === "string") {
      return makeError(value.$error);
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, materialize(item, makeError)]));
  }
  return value;
}
