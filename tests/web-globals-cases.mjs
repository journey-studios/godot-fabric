// GF-05 slice E. What the fixture (in Hermes, over the SDK) and the oracle (in V8, over RN's own files and nothing else) both run, written once: the
// stimulus and the way a result is written down, never an expectation. The fixture bundles this module with the SDK, the oracle bundles it with RN's
// modules, and each runs it inside its own engine, so both describe values with the same code and a difference between the two results is a difference
// between the engines or between the two builds of RN's code, never of the describer.
//
// A case is {id, run, engineMessage?}. `run` receives the globals under test (`env`) and returns a value or throws. `engineMessage` marks a case whose throw
// carries a message the engine wrote (`undefined is not an object ...`, `Class constructors cannot be invoked ...`): the oracle compares the name of such an
// error and not its text, where for every other case the text is RN's own and is compared.

const tagOf = value => Object.prototype.toString.call(value);

// A JSON-safe image of a value. JSON loses undefined, NaN, -0 and the identity of functions, so each is tagged.
function describe(value) {
  if (value === undefined) {
    return {$: "undefined"};
  }
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) && !Object.is(value, -0) ? value : {$: "number", text: Object.is(value, -0) ? "-0" : String(value)};
  }
  if (typeof value === "symbol") {
    return {$: "symbol", text: String(value)};
  }
  if (typeof value === "function") {
    return {$: "function", name: value.name, length: value.length};
  }
  if (Array.isArray(value)) {
    return value.map(describe);
  }
  if (value instanceof Error) {
    return {$: "error", name: String(value.name), message: String(value.message), ...(value.code === undefined ? {} : {code: value.code})};
  }
  return Object.fromEntries(Object.keys(value).map(key => [key, describe(value[key])]));
}

// What a call did: it returned a value or it threw one.
function attempt(callback) {
  try {
    return {threw: false, value: describe(callback())};
  } catch (error) {
    return {threw: true, thrown: describe(error)};
  }
}

// The codes of a string: the one way a string that holds bytes (atob's) or lone surrogates travels through a report.
const codesOf = text => Array.from({length: text.length}, (_, index) => text.charCodeAt(index));
export const stringOf = codes => String.fromCharCode(...codes);

const makeCase = (id, run, options = {}) => ({id, run, engineMessage: options.engineMessage === true});

// ------------------------------------------------------------------------------------------------------------------------------------------------
// URL
// ------------------------------------------------------------------------------------------------------------------------------------------------

const URL_MEMBERS = ["hash", "host", "hostname", "href", "origin", "password", "pathname", "port", "protocol", "search", "username"];
const partsOf = url => Object.fromEntries(URL_MEMBERS.map(name => [name, url[name]]));
// The ways a URL becomes a string. None of them reads searchParams, which would change what toString returns.
const formsOf = url => ({string: String(url), template: `${url}`, concat: url + "", json: url.toJSON(), stringified: JSON.stringify({url})});
const full = url => ({parts: partsOf(url), ...formsOf(url)});
const entriesOf = params => Array.from(params.entries());
// The object RN's createObjectURL reads: blob.data.blobId, blob.data.offset and blob.size are all it touches.
const blobLike = {data: {blobId: "blob-id-7", offset: 3}, size: 12};

export const urlCases = [
  makeCase("url/absolute", ({URL}) => full(new URL("https://example.com/path/to/page?x=1&y=two#frag"))),
  makeCase("url/credentials-and-port", ({URL}) => full(new URL("https://user:pass@example.com:8080/a/b?q=1#h"))),
  makeCase("url/user-without-password", ({URL}) => full(new URL("https://user@example.com/"))),
  makeCase("url/bare-host-gets-a-slash", ({URL}) => full(new URL("http://example.com"))),
  makeCase("url/bare-host-and-port", ({URL}) => full(new URL("https://example.com:8080"))),
  makeCase("url/bare-host-with-hash", ({URL}) => full(new URL("http://example.com#frag"))),
  makeCase("url/bare-host-with-query", ({URL}) => full(new URL("http://example.com?x=1"))),
  makeCase("url/ipv4-and-port", ({URL}) => full(new URL("http://127.0.0.1:3000/x/y"))),
  makeCase("url/ftp-is-not-http", ({URL}) => full(new URL("ftp://files.example.com/pub/file.txt"))),
  makeCase("url/uppercase-scheme", ({URL}) => full(new URL("HTTPS://EXAMPLE.COM/Path"))),
  makeCase("url/custom-scheme", ({URL}) => full(new URL("myapp://open/item?id=3"))),
  makeCase("url/path-only", ({URL}) => full(new URL("/just/a/path?x=1"))),
  makeCase("url/empty-string", ({URL}) => full(new URL(""))),
  makeCase("url/spaces-and-unicode", ({URL}) => full(new URL("https://example.com/a b/ação?q=ç#é"))),
  makeCase("url/two-hashes", ({URL}) => full(new URL("https://example.com/p#a#b"))),
  makeCase("url/colon-in-path", ({URL}) => full(new URL("https://example.com/a:80/b"))),
  makeCase("url/base-and-absolute-path", ({URL}) => full(new URL("/other", "https://example.com/base/"))),
  makeCase("url/base-and-relative-path", ({URL}) => full(new URL("path/x", "https://example.com/dir"))),
  makeCase("url/base-and-dot-dot", ({URL}) => full(new URL("../up", "https://example.com/a/b/"))),
  makeCase("url/base-and-query", ({URL}) => full(new URL("?x=1", "https://example.com/p"))),
  makeCase("url/base-is-a-url", ({URL}) => full(new URL("/y", new URL("https://example.com/base")))),
  makeCase("url/base-ignored-for-an-absolute-url", ({URL}) => full(new URL("https://other.test/x", "https://example.com/"))),
  makeCase("url/base-already-ends-with-the-path", ({URL}) => full(new URL("/base", "https://example.com/base"))),
  makeCase("url/empty-base-is-no-base", ({URL}) => full(new URL("x", ""))),
  makeCase("url/invalid-base-throws", ({URL}) => new URL("x", "not a url")),
  makeCase("url/hash-without-a-scheme-throws", ({URL}) => new URL("abc#x"), {engineMessage: true}),
  makeCase("url/undefined-throws", ({URL}) => new URL(), {engineMessage: true}),
  makeCase("url/number-throws", ({URL}) => new URL(123), {engineMessage: true}),
  makeCase("url/object-with-tostring-throws", ({URL}) => new URL({toString: () => "https://a.test/"}), {engineMessage: true}),
  makeCase("url/called-without-new-throws", ({URL}) => URL("https://a.test/"), {engineMessage: true}),
  makeCase("url/search-setter", ({URL}) => {
    const url = new URL("https://example.com/p?a=1#h");
    const steps = [];
    const note = (label, target) => steps.push({label, href: target.href, search: target.search, hash: target.hash});
    note("start", url);
    url.search = "?b=2";
    note("with a question mark", url);
    url.search = "c=3&d=4";
    note("without", url);
    url.search = "";
    note("empty", url);
    url.search = "e=5";
    note("again, after the empty one", url);
    const bare = new URL("https://example.com/p");
    bare.search = "?z=26";
    note("set on a URL that had none", bare);
    const hashOnly = new URL("https://example.com/p#h");
    hashOnly.search = "y=25";
    note("set on a URL that had only a hash", hashOnly);
    return {steps};
  }),
  makeCase("url/read-only-members", ({URL}) => {
    const url = new URL("https://example.com/p?a=1#h");
    const writes = {};
    const descriptors = {};
    for (const name of [...URL_MEMBERS, "searchParams"]) {
      writes[name] = Reflect.set(url, name, "changed");
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(url), name);
      descriptors[name] = {get: typeof descriptor?.get, set: typeof descriptor?.set};
    }
    return {writes, descriptors, href: url.href};
  }),
  makeCase("url/search-params-are-live", ({URL}) => {
    const url = new URL("https://example.com/p?a=1&b=2#h");
    const params = url.searchParams;
    const steps = [];
    const note = label => steps.push({label, href: url.href, search: url.search, string: String(url), json: url.toJSON(), entries: entriesOf(params)});
    note("start");
    params.append("c", "3 4");
    note("after append (search is still the text the URL holds)");
    params.delete("a");
    note("after delete");
    const same = url.searchParams === params;
    url.search = "?x=1";
    note("after the search setter");
    return {steps, sameInstance: same, replaced: url.searchParams !== params, entriesAfter: entriesOf(url.searchParams)};
  }),
  makeCase("url/search-params-of-a-bare-url", ({URL}) => {
    const url = new URL("https://example.com/");
    const params = url.searchParams;
    return {size: params.size, text: params.toString(), href: url.href, string: String(url), sizeOfAHashOnlyUrl: new URL("https://example.com/#top").searchParams.size};
  }),
  makeCase("url/search-params-keep-the-hash", ({URL}) => {
    const url = new URL("https://example.com/p?a=1#h");
    url.searchParams.set("a", "2");
    url.searchParams.append("b", "x y");
    return {href: url.href, hash: url.hash};
  }),
  makeCase("url/search-params-removed-entirely", ({URL}) => {
    const url = new URL("https://example.com/p?a=1#h");
    url.searchParams.delete("a");
    return {href: url.href, string: String(url)};
  }),
  makeCase("url/shape", ({URL}) => {
    const url = new URL("https://a.test/");
    return {
      prototype: Object.getOwnPropertyNames(URL.prototype).sort(),
      statics: Object.getOwnPropertyNames(URL).sort(),
      length: URL.length,
      keys: Object.keys(url),
      tag: tagOf(url),
      canParse: typeof URL.canParse,
      parse: typeof URL.parse,
      isInstance: url instanceof URL,
    };
  }),
  makeCase("url/object-urls", ({URL}) => ({created: URL.createObjectURL(blobLike), revoked: URL.revokeObjectURL("blob:anything")})),
];

// ------------------------------------------------------------------------------------------------------------------------------------------------
// URLSearchParams
// ------------------------------------------------------------------------------------------------------------------------------------------------

function build(URLSearchParams, init) {
  const params = new URLSearchParams(init);
  return {size: params.size, entries: entriesOf(params), text: params.toString()};
}

const sample = "a=1&b=2&a=3&c=4";
const searchParamsCases = [
  makeCase("sp/from-a-string", ({URLSearchParams}) => build(URLSearchParams, sample)),
  makeCase("sp/from-a-string-with-a-question-mark", ({URLSearchParams}) => build(URLSearchParams, "?a=1&b=2")),
  makeCase("sp/from-an-empty-string", ({URLSearchParams}) => build(URLSearchParams, "")),
  makeCase("sp/from-empty-pairs", ({URLSearchParams}) => build(URLSearchParams, "&&a=1&&b=2&")),
  makeCase("sp/from-a-key-without-a-value", ({URLSearchParams}) => build(URLSearchParams, "a&b=&=c")),
  makeCase("sp/from-a-value-with-an-equals-sign", ({URLSearchParams}) => build(URLSearchParams, "a=1=2&b=x")),
  makeCase("sp/from-percent-encoding-and-plus", ({URLSearchParams}) => build(URLSearchParams, "a=%20b+c&d%20e=%E2%9C%93&f=%C3%A7")),
  makeCase("sp/from-a-bad-percent-sequence-throws", ({URLSearchParams}) => build(URLSearchParams, "a=%"), {engineMessage: true}),
  makeCase("sp/from-null", ({URLSearchParams}) => build(URLSearchParams, null)),
  makeCase("sp/from-nothing", ({URLSearchParams}) => build(URLSearchParams, undefined)),
  makeCase("sp/from-a-number", ({URLSearchParams}) => build(URLSearchParams, 5)),
  makeCase("sp/from-an-object", ({URLSearchParams}) => build(URLSearchParams, {b: "2", a: "1", c: "x y"})),
  makeCase("sp/from-an-object-with-other-values", ({URLSearchParams}) => build(URLSearchParams, {n: 1, t: true, u: undefined, z: null})),
  makeCase("sp/from-an-array-of-pairs", ({URLSearchParams}) => build(URLSearchParams, [["a", "1"], ["a", "2"], ["b", "3"]])),
  makeCase("sp/from-short-and-long-pairs", ({URLSearchParams}) => build(URLSearchParams, [["a"], ["b", "1", "extra"]])),
  makeCase("sp/from-an-array-of-non-pairs-throws", ({URLSearchParams}) => build(URLSearchParams, [1]), {engineMessage: true}),
  makeCase("sp/from-a-map-is-not-iterated", ({URLSearchParams}) => build(URLSearchParams, new Map([["a", "1"]]))),
  makeCase("sp/from-an-iterator-is-not-iterated", ({URLSearchParams}) => build(URLSearchParams, [["a", "1"]][Symbol.iterator]())),
  makeCase("sp/from-another-instance-is-read-as-an-object", ({URLSearchParams}) => build(URLSearchParams, new URLSearchParams("a=1"))),
  makeCase("sp/called-without-new-throws", ({URLSearchParams}) => URLSearchParams("a=1"), {engineMessage: true}),
  makeCase("sp/append", ({URLSearchParams}) => {
    const params = new URLSearchParams("a=1");
    const returned = params.append("a", "2");
    params.append("b", "3");
    params.append("a", "4");
    return {returned, entries: entriesOf(params), size: params.size};
  }),
  makeCase("sp/get-and-get-all", ({URLSearchParams}) => {
    const params = new URLSearchParams(sample);
    return {a: params.get("a"), b: params.get("b"), missing: params.get("z"), all: params.getAll("a"), allMissing: params.getAll("z"),
      empty: new URLSearchParams("e=").get("e"), emptyAll: new URLSearchParams("e=").getAll("e"), noValue: new URLSearchParams("e").get("e")};
  }),
  makeCase("sp/has", ({URLSearchParams}) => {
    const params = new URLSearchParams(sample);
    return {a: params.has("a"), z: params.has("z"), withValue: params.has("a", "9"), keyOfAnEmptyList: (() => {
      const gone = new URLSearchParams("a=1");
      gone.delete("a");
      return gone.has("a");
    })()};
  }),
  makeCase("sp/set", ({URLSearchParams}) => {
    const params = new URLSearchParams(sample);
    const returned = params.set("a", "9");
    params.set("z", "26");
    return {returned, entries: entriesOf(params), text: params.toString()};
  }),
  makeCase("sp/delete", ({URLSearchParams}) => {
    const params = new URLSearchParams(sample);
    const returned = params.delete("a");
    const first = entriesOf(params);
    params.delete("missing");
    params.delete("b", "not-the-value");
    const second = entriesOf(params);
    params.append("a", "again");
    return {returned, first, second, third: entriesOf(params), size: params.size};
  }),
  makeCase("sp/iteration", ({URLSearchParams}) => {
    const params = new URLSearchParams(sample);
    const each = [];
    params.forEach((value, key, owner) => each.push({value, key, owner: owner === params}));
    return {
      keys: Array.from(params.keys()),
      values: Array.from(params.values()),
      entries: Array.from(params.entries()),
      spread: [...params],
      forOf: (() => {
        const seen = [];
        for (const [key, value] of params) {
          seen.push(key + "=" + value);
        }
        return seen;
      })(),
      each,
      iteratorIsEntries: params[Symbol.iterator] === params.entries,
      keysTag: tagOf(params.keys()),
      valuesTag: tagOf(params.values()),
      entriesTag: tagOf(params.entries()),
    };
  }),
  makeCase("sp/iteration-is-live-for-keys-and-a-snapshot-for-symbol-iterator", ({URLSearchParams}) => {
    const params = new URLSearchParams("a=1&b=2");
    const iterator = params[Symbol.iterator]();
    params.append("c", "3");
    const snapshot = Array.from(iterator);
    const live = params.keys();
    params.append("d", "4");
    return {snapshot, live: Array.from(live)};
  }),
  makeCase("sp/sort-ascii", ({URLSearchParams}) => {
    const params = new URLSearchParams("d=4&b=2&a=1&c=3&b=1&a=0");
    const returned = params.sort();
    return {returned, entries: entriesOf(params), text: params.toString()};
  }),
  makeCase("sp/sort-mixed-case-and-punctuation", ({URLSearchParams}) => {
    const params = new URLSearchParams("b=1&a=2&B=3&A=4&z=6&10=7&9=8&_x=9&-y=10&Z=11&e=13&E=14");
    params.sort();
    return Array.from(params.keys());
  }),
  makeCase("sp/sort-already-sorted-and-empty", ({URLSearchParams}) => {
    const sorted = new URLSearchParams("a=1&b=2");
    sorted.sort();
    const empty = new URLSearchParams("");
    empty.sort();
    return {sorted: entriesOf(sorted), empty: entriesOf(empty)};
  }),
  makeCase("sp/to-string-encoding", ({URLSearchParams}) => {
    const params = new URLSearchParams();
    params.append("sp ace", "a b");
    params.append("mark", "!'()*~-._");
    params.append("sep", "&=+%#?/");
    params.append("accent", "ção");
    params.append("emoji", "😀");
    params.append("empty", "");
    return {text: params.toString(), size: params.size, roundTrip: entriesOf(new URLSearchParams(params.toString()))};
  }),
  makeCase("sp/to-string-of-odd-values", ({URLSearchParams}) => build(URLSearchParams, {n: 1, t: true, u: undefined, z: null, o: {toString: () => "obj"}})),
  makeCase("sp/to-string-with-a-lone-surrogate-throws", ({URLSearchParams}) => {
    const params = new URLSearchParams();
    params.append("a", String.fromCharCode(0xd800));
    return params.toString();
  }, {engineMessage: true}),
  makeCase("sp/shape", ({URLSearchParams}) => {
    const params = new URLSearchParams("a=1");
    const size = Object.getOwnPropertyDescriptor(URLSearchParams.prototype, "size");
    return {
      prototype: Object.getOwnPropertyNames(URLSearchParams.prototype).sort(),
      symbols: Object.getOwnPropertySymbols(URLSearchParams.prototype).map(String),
      statics: Object.getOwnPropertyNames(URLSearchParams).sort(),
      length: URLSearchParams.length,
      keys: Object.keys(params),
      tag: tagOf(params),
      size: {get: typeof size?.get, set: typeof size?.set},
      toJSON: typeof params.toJSON,
      stringified: JSON.stringify(params),
    };
  }),
];
export {searchParamsCases};

// ------------------------------------------------------------------------------------------------------------------------------------------------
// AbortController and AbortSignal
// ------------------------------------------------------------------------------------------------------------------------------------------------

// What an abort reason is, for both the default one (a DOMException) and one the caller passed.
function reasonShape(reason) {
  if (reason !== null && typeof reason === "object") {
    return {kind: "object", error: reason instanceof Error, tag: tagOf(reason), name: reason.name, message: reason.message, code: reason.code,
      keys: Object.keys(reason).sort()};
  }
  return {kind: typeof reason, value: reason};
}

// What an abort event is, as a listener sees it.
function heard(log, label, signal) {
  return event => log.push({label, type: event.type, target: event.target === signal, currentTarget: event.currentTarget === signal,
    trusted: event.isTrusted, bubbles: event.bubbles, cancelable: event.cancelable, phase: event.eventPhase, aborted: signal.aborted,
    reason: signal.reason === undefined ? null : reasonShape(signal.reason).name ?? null});
}

const abortCases = [
  makeCase("abort/new-controller", ({AbortController, AbortSignal}) => {
    const controller = new AbortController();
    const signal = controller.signal;
    return {
      aborted: signal.aborted, reason: signal.reason, onabort: signal.onabort, sameSignal: controller.signal === signal,
      controllerTag: tagOf(controller), signalTag: tagOf(signal), isSignal: signal instanceof AbortSignal,
      controllerKeys: Object.keys(controller), signalKeys: Object.keys(signal),
      controllerPrototype: Object.getOwnPropertyNames(AbortController.prototype).sort(),
      signalPrototype: Object.getOwnPropertyNames(Object.getPrototypeOf(signal)).sort(),
      controllerLength: AbortController.length,
    };
  }),
  makeCase("abort/abort-without-a-reason", ({AbortController}) => {
    const controller = new AbortController();
    const log = [];
    controller.signal.addEventListener("abort", heard(log, "listener", controller.signal));
    const returned = controller.abort();
    return {returned, aborted: controller.signal.aborted, reason: reasonShape(controller.signal.reason), log};
  }),
  makeCase("abort/abort-with-reasons", ({AbortController}) => {
    const results = {};
    const error = new Error("because");
    const reasons = {string: "a reason", error, zero: 0, falsy: false, nothing: null, undefinedReason: undefined, object: {why: "x"}};
    for (const [name, reason] of Object.entries(reasons)) {
      const controller = new AbortController();
      controller.abort(reason);
      const shape = reasonShape(controller.signal.reason);
      results[name] = {aborted: controller.signal.aborted, shape, sameValue: controller.signal.reason === reason};
    }
    return results;
  }),
  makeCase("abort/abort-twice", ({AbortController}) => {
    const controller = new AbortController();
    const log = [];
    controller.signal.addEventListener("abort", heard(log, "listener", controller.signal));
    controller.abort("first");
    controller.abort("second");
    controller.abort();
    return {reason: controller.signal.reason, log};
  }),
  makeCase("abort/listener-order-with-onabort", ({AbortController}) => {
    const controller = new AbortController();
    const signal = controller.signal;
    const log = [];
    signal.addEventListener("abort", heard(log, "listener-1", signal));
    signal.onabort = heard(log, "onabort", signal);
    signal.addEventListener("abort", heard(log, "listener-2", signal));
    const handler = signal.onabort;
    controller.abort("go");
    return {log, handlerIsFunction: typeof handler};
  }),
  makeCase("abort/onabort-set-before-and-replaced", ({AbortController}) => {
    const controller = new AbortController();
    const signal = controller.signal;
    const log = [];
    signal.onabort = heard(log, "first-handler", signal);
    signal.addEventListener("abort", heard(log, "listener", signal));
    signal.onabort = heard(log, "second-handler", signal);
    controller.abort();
    return {log};
  }),
  makeCase("abort/onabort-values", ({AbortController}) => {
    const signal = new AbortController().signal;
    const states = {initial: signal.onabort};
    const handler = () => {};
    signal.onabort = handler;
    states.afterFunction = signal.onabort === handler;
    signal.onabort = null;
    states.afterNull = signal.onabort;
    signal.onabort = "not a function";
    states.afterString = signal.onabort;
    signal.onabort = undefined;
    states.afterUndefined = signal.onabort;
    signal.onabort = {handleEvent() {}};
    states.afterObject = typeof signal.onabort;
    return states;
  }),
  makeCase("abort/onabort-cleared-before-abort", ({AbortController}) => {
    const controller = new AbortController();
    const log = [];
    controller.signal.onabort = heard(log, "handler", controller.signal);
    controller.signal.onabort = null;
    controller.abort();
    return {log};
  }),
  makeCase("abort/listener-options", ({AbortController}) => {
    const controller = new AbortController();
    const signal = controller.signal;
    const log = [];
    const removed = heard(log, "removed", signal);
    const twice = heard(log, "added-twice", signal);
    signal.addEventListener("abort", heard(log, "once", signal), {once: true});
    signal.addEventListener("abort", removed);
    signal.removeEventListener("abort", removed);
    signal.addEventListener("abort", twice);
    signal.addEventListener("abort", twice);
    signal.addEventListener("abort", heard(log, "capture", signal), true);
    signal.addEventListener("abort", {handleEvent: heard(log, "object", signal)});
    controller.abort();
    return {log};
  }),
  makeCase("abort/listener-added-while-dispatching", ({AbortController}) => {
    const controller = new AbortController();
    const signal = controller.signal;
    const log = [];
    signal.addEventListener("abort", () => {
      log.push("first");
      signal.addEventListener("abort", () => log.push("added during dispatch"));
    });
    signal.addEventListener("abort", () => log.push("second"));
    controller.abort();
    const afterwards = log.length;
    signal.addEventListener("abort", () => log.push("added after abort"));
    return {log, afterwards, final: log.length};
  }),
  makeCase("abort/throw-if-aborted", ({AbortController}) => {
    const controller = new AbortController();
    const before = attempt(() => controller.signal.throwIfAborted());
    const reason = new Error("stop");
    controller.abort(reason);
    let thrown = null;
    try {
      controller.signal.throwIfAborted();
    } catch (error) {
      thrown = error;
    }
    const defaulted = new AbortController();
    defaulted.abort();
    return {before, identity: thrown === reason, defaultThrown: attempt(() => defaulted.signal.throwIfAborted())};
  }),
  makeCase("abort/signal-abort", ({AbortSignal}) => {
    const log = [];
    const plain = AbortSignal.abort();
    plain.addEventListener("abort", heard(log, "late", plain));
    const reason = AbortSignal.abort("why");
    const error = new Error("x");
    const withError = AbortSignal.abort(error);
    return {plain: {aborted: plain.aborted, reason: reasonShape(plain.reason)}, withString: {aborted: reason.aborted, reason: reason.reason},
      withError: {aborted: withError.aborted, same: withError.reason === error}, log, isSignal: plain instanceof AbortSignal};
  }),
  makeCase("abort/signal-any", ({AbortController, AbortSignal}) => {
    const first = new AbortController();
    const second = new AbortController();
    const merged = AbortSignal.any([first.signal, second.signal]);
    const log = [];
    merged.addEventListener("abort", heard(log, "merged", merged));
    const beforeAbort = merged.aborted;
    second.abort("from the second");
    first.abort("from the first");
    const already = AbortSignal.any([AbortSignal.abort("early"), first.signal]);
    const none = AbortSignal.any([]);
    return {beforeAbort, merged: {aborted: merged.aborted, reason: merged.reason}, log, already: {aborted: already.aborted, reason: already.reason},
      none: {aborted: none.aborted}, isSignal: merged instanceof AbortSignal};
  }),
  makeCase("abort/signal-any-rejects-bad-arguments", ({AbortSignal}) => ({
    notAnArray: attempt(() => AbortSignal.any(new Set())),
    notASignal: attempt(() => AbortSignal.any([AbortSignal.abort(), {}])),
    missing: attempt(() => AbortSignal.any()),
  })),
  makeCase("abort/signal-timeout-rejects-bad-arguments", ({AbortSignal}) => ({
    negative: attempt(() => AbortSignal.timeout(-1)),
    notANumber: attempt(() => AbortSignal.timeout(NaN)),
    nothing: attempt(() => AbortSignal.timeout()),
    text: attempt(() => AbortSignal.timeout("soon")),
  })),
  makeCase("abort/signal-cannot-be-constructed", ({AbortSignal}) => ({
    construct: attempt(() => new AbortSignal()),
    call: attempt(() => AbortSignal()),
    length: AbortSignal.length,
    // `arguments` and `caller` are own properties of a sloppy function in some engines and not in others: the engine's, not RN's.
    statics: Object.getOwnPropertyNames(AbortSignal).filter(name => name !== "arguments" && name !== "caller").sort(),
    prototypeTag: tagOf(AbortSignal.prototype),
    prototypeMembers: Object.getOwnPropertyNames(AbortSignal.prototype).sort(),
    prototypeIsTheClassOne: Object.getPrototypeOf(AbortSignal.abort()) === AbortSignal.prototype,
  })),
  makeCase("abort/members-on-the-wrong-object", ({AbortController, AbortSignal}) => {
    const signalGetter = Object.getOwnPropertyDescriptor(AbortController.prototype, "signal").get;
    const abortedGetter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted").get;
    return {signal: attempt(() => signalGetter.call({})), abort: attempt(() => AbortController.prototype.abort.call({})),
      aborted: attempt(() => abortedGetter.call({})), reason: attempt(() => Object.getOwnPropertyDescriptor(AbortSignal.prototype, "reason").get.call({}))};
  }),
];
export {abortCases};

// The cases that end on a timer. Each resolves with what it saw, and waits for an event, never for a number of frames or milliseconds: the timeout
// itself is the shortest RN accepts, and what the result records is the order of what happened, not when.
const abortTimerCases = [
  makeCase("abort-timer/timeout", ({AbortSignal, setTimeout}) => new Promise(resolve => {
    const signal = AbortSignal.timeout(1);
    const log = [];
    const before = {aborted: signal.aborted, reason: signal.reason};
    signal.addEventListener("abort", heard(log, "listener", signal));
    signal.addEventListener("abort", () => setTimeout(() => resolve({before, after: {aborted: signal.aborted, reason: reasonShape(signal.reason)}, log}), 0));
  })),
  makeCase("abort-timer/timeout-zero", ({AbortSignal, setTimeout}) => new Promise(resolve => {
    const signal = AbortSignal.timeout(0);
    const before = signal.aborted;
    signal.addEventListener("abort", () => setTimeout(() => resolve({before, reason: reasonShape(signal.reason)}), 0));
  })),
  makeCase("abort-timer/any-of-a-timeout", ({AbortController, AbortSignal, setTimeout}) => new Promise(resolve => {
    const never = new AbortController();
    const merged = AbortSignal.any([never.signal, AbortSignal.timeout(1)]);
    const log = [];
    merged.addEventListener("abort", heard(log, "merged", merged));
    merged.addEventListener("abort", () => setTimeout(() => resolve({reason: reasonShape(merged.reason), neverAborted: never.signal.aborted, log}), 0));
  })),
];
export {abortTimerCases};

// ------------------------------------------------------------------------------------------------------------------------------------------------
// Encoding: TextEncoder, atob and btoa are the engine's; TextDecoder is not there
// ------------------------------------------------------------------------------------------------------------------------------------------------

// Inputs are lists of UTF-16 code units, so a lone surrogate travels through a report as numbers and never as a string.
export const encodingInputs = {
  empty: [],
  ascii: Array.from("Hello, world", character => character.charCodeAt(0)),
  bmp: Array.from("Olá, mundo — ação 日本語", character => character.charCodeAt(0)),
  astral: [0xd83d, 0xde00, 0x20, 0xd835, 0xdcb3, 0x20, 0x61],
  loneHigh: [0x61, 0xd800, 0x62],
  loneLow: [0x61, 0xdc00, 0x62],
  trailingHigh: [0x78, 0xd83d],
  swappedPair: [0xde00, 0xd83d],
  nul: [0x61, 0x00, 0x62],
  maxBmp: [0xffff],
  replacement: [0xfffd],
  byteOrderMark: [0xfeff, 0x78],
  boundaries: [0x7f, 0x80, 0x7ff, 0x800, 0xd7ff, 0xe000],
};

// The bytes of the string the 256 byte values make, and a longer deterministic one.
const allBytes = Array.from({length: 256}, (_, index) => index);
const pattern = Array.from({length: 4099}, (_, index) => (index * 31 + 7) & 0xff);

const encodingCases = [
  ...Object.entries(encodingInputs).map(([name, units]) =>
    makeCase(`encode/${name}`, ({TextEncoder}) => Array.from(new TextEncoder().encode(stringOf(units))))),
  makeCase("encode/result-type", ({TextEncoder}) => {
    const bytes = new TextEncoder().encode("ab");
    return {constructor: bytes.constructor.name, length: bytes.length, byteLength: bytes.byteLength, byteOffset: bytes.byteOffset, tag: tagOf(bytes),
      bufferLength: bytes.buffer.byteLength};
  }),
  makeCase("encode/no-argument", ({TextEncoder}) => Array.from(new TextEncoder().encode())),
  makeCase("encode/undefined", ({TextEncoder}) => Array.from(new TextEncoder().encode(undefined))),
  makeCase("encode/null", ({TextEncoder}) => Array.from(new TextEncoder().encode(null))),
  makeCase("encode/number", ({TextEncoder}) => Array.from(new TextEncoder().encode(42))),
  makeCase("encode/object", ({TextEncoder}) => Array.from(new TextEncoder().encode({toString: () => "obj"}))),
  makeCase("encode/symbol-throws", ({TextEncoder}) => new TextEncoder().encode(Symbol("s")), {engineMessage: true}),
  makeCase("encode/shape", ({TextEncoder}) => {
    const encoder = new TextEncoder();
    const encoding = Object.getOwnPropertyDescriptor(TextEncoder.prototype, "encoding");
    return {encoding: encoder.encoding, getter: typeof encoding?.get, setter: typeof encoding?.set, tag: tagOf(encoder), name: TextEncoder.name,
      length: TextEncoder.length, prototype: Object.getOwnPropertyNames(TextEncoder.prototype).sort(), argumentIgnored: new TextEncoder("utf-16").encoding,
      called: attempt(() => TextEncoder()), encodeOnAnObject: attempt(() => TextEncoder.prototype.encode.call({}, "a")),
      encodingOnAnObject: attempt(() => encoding.get.call({}))};
  }, {engineMessage: true}),
  ...Object.entries({ascii: "héllo", astral: "a😀b", exactAstral: "a😀", lone: stringOf([0x61, 0xd800, 0x62]), empty: ""}).flatMap(([name, text]) =>
    [8, 3, 5, 0].map(room => makeCase(`encodeInto/${name}-into-${room}`, ({TextEncoder}) => {
      const destination = new Uint8Array(room);
      const result = new TextEncoder().encodeInto(text, destination);
      return {read: result.read, written: result.written, keys: Object.keys(result), bytes: Array.from(destination)};
    }))),
  makeCase("encodeInto/rejects-what-is-not-a-uint8array", ({TextEncoder}) => ({
    uint16: attempt(() => new TextEncoder().encodeInto("abc", new Uint16Array(4))),
    array: attempt(() => new TextEncoder().encodeInto("abc", [1, 2])),
    missing: attempt(() => new TextEncoder().encodeInto("abc")),
    onAnObject: attempt(() => TextEncoder.prototype.encodeInto.call({}, "abc", new Uint8Array(3))),
  }), {engineMessage: true}),
  makeCase("encodeInto/into-a-view", ({TextEncoder}) => {
    const backing = new Uint8Array(8);
    const view = new Uint8Array(backing.buffer, 2, 4);
    const result = new TextEncoder().encodeInto("abcdef", view);
    return {read: result.read, written: result.written, backing: Array.from(backing)};
  }),
  makeCase("btoa/ascii", ({btoa}) => btoa("Hello, world")),
  makeCase("btoa/empty", ({btoa}) => btoa("")),
  makeCase("btoa/padding", ({btoa}) => [btoa("a"), btoa("ab"), btoa("abc"), btoa("abcd"), btoa("abcde")]),
  makeCase("btoa/latin1", ({btoa}) => btoa(stringOf([0xe7, 0xe3, 0xff, 0x80, 0x00]))),
  makeCase("btoa/all-byte-values", ({btoa}) => btoa(stringOf(allBytes))),
  makeCase("btoa/long", ({btoa}) => btoa(stringOf(pattern))),
  makeCase("btoa/out-of-range-throws", ({btoa}) => btoa(stringOf([0x100]))),
  makeCase("btoa/astral-throws", ({btoa}) => btoa(stringOf([0xd83d, 0xde00]))),
  makeCase("btoa/no-argument", ({btoa}) => btoa()),
  makeCase("btoa/null", ({btoa}) => btoa(null)),
  makeCase("btoa/number", ({btoa}) => btoa(12)),
  makeCase("btoa/object", ({btoa}) => btoa({toString: () => "ob"})),
  makeCase("btoa/symbol-throws", ({btoa}) => btoa(Symbol("s")), {engineMessage: true}),
  makeCase("atob/ascii", ({atob}) => codesOf(atob("SGVsbG8sIHdvcmxk"))),
  makeCase("atob/empty", ({atob}) => codesOf(atob(""))),
  makeCase("atob/padding", ({atob}) => ["YQ==", "YWI=", "YWJj", "YWJjZA==", "YQ", "YWI", "YWJjZA"].map(text => codesOf(atob(text)))),
  makeCase("atob/ignores-ascii-whitespace", ({atob}) => [" YW Jj\n", "YW\tJj", "\r\nYWJj  "].map(text => codesOf(atob(text)))),
  makeCase("atob/all-byte-values", ({atob}) => codesOf(atob("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaanqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/w=="))),
  makeCase("atob/trailing-bits-are-discarded", ({atob}) => [codesOf(atob("YR==")), codesOf(atob("YWJ="))]),
  makeCase("atob/high-byte", ({atob}) => codesOf(atob("/w=="))),
  makeCase("atob/null", ({atob}) => codesOf(atob(null))),
  makeCase("atob/number", ({atob}) => codesOf(atob(1234))),
  makeCase("atob/invalid-character-throws", ({atob}) => atob("YW$j")),
  makeCase("atob/url-alphabet-throws", ({atob}) => atob("-_-_")),
  makeCase("atob/unicode-throws", ({atob}) => atob("éééé")),
  makeCase("atob/one-character-throws", ({atob}) => atob("A")),
  makeCase("atob/five-characters-throw", ({atob}) => atob("YWJjZ")),
  makeCase("atob/padding-of-a-short-string-throws", ({atob}) => atob("YQ=")),
  makeCase("atob/too-much-padding-throws", ({atob}) => atob("YQ===")),
  makeCase("atob/padding-in-the-middle-throws", ({atob}) => atob("YQ==YQ==")),
  makeCase("atob/no-argument", ({atob}) => atob()),
  makeCase("atob/symbol-throws", ({atob}) => atob(Symbol("s")), {engineMessage: true}),
  makeCase("base64/round-trip-every-byte", ({atob, btoa}) => atob(btoa(stringOf(allBytes))) === stringOf(allBytes)),
  makeCase("base64/round-trip-long", ({atob, btoa}) => atob(btoa(stringOf(pattern))) === stringOf(pattern)),
  makeCase("base64/round-trip-of-utf8", ({atob, btoa, TextEncoder}) => {
    const bytes = new TextEncoder().encode("Olá, mundo — ação 日本語 😀");
    const text = btoa(stringOf(Array.from(bytes)));
    return {text, back: Array.from(codesOf(atob(text)))};
  }),
];
export {encodingCases};

// The decoder the decision leaves out. Written so that it needs no global to exist: typeof on an undeclared name is the one way to ask.
export const decoderCases = [
  makeCase("decoder/typeof", () => typeof TextDecoder),
  makeCase("decoder/in-global", () => "TextDecoder" in globalThis),
  makeCase("decoder/own-property", () => Object.getOwnPropertyNames(globalThis).includes("TextDecoder")),
  makeCase("decoder/descriptor", () => Object.getOwnPropertyDescriptor(globalThis, "TextDecoder") === undefined),
  makeCase("decoder/construct-throws", () => new TextDecoder()),
  makeCase("decoder/read-throws", () => TextDecoder),
  makeCase("decoder/typeof-the-others", () => ({TextEncoder: typeof TextEncoder, atob: typeof atob, btoa: typeof btoa})),
];


// ------------------------------------------------------------------------------------------------------------------------------------------------
// The checks the cases are grouped into. A group is one sentence of the probe: every case of it must come out as the expectation says. This is organisation,
// not expectation: the oracle derives what each case must come out as, and checks that every case is in exactly one group.
// ------------------------------------------------------------------------------------------------------------------------------------------------

const idsWith = (cases, ...ids) => ids.map(id => {
  if (!cases.some(entry => entry.id === id)) {
    throw new Error("No case is named " + id);
  }
  return id;
});
const idsBetween = (cases, prefix) => cases.filter(entry => entry.id.startsWith(prefix)).map(entry => entry.id);

export const checkGroups = [
  {check: "url/An absolute http or https URL answers every member as RN's regular expressions do", ids: idsWith(urlCases, "url/absolute", "url/credentials-and-port",
    "url/user-without-password", "url/ipv4-and-port", "url/spaces-and-unicode", "url/two-hashes", "url/colon-in-path")},
  {check: "url/A bare host gets the slash RN's constructor writes, unless a query follows", ids: idsWith(urlCases, "url/bare-host-gets-a-slash", "url/bare-host-and-port",
    "url/bare-host-with-hash", "url/bare-host-with-query")},
  {check: "url/Other schemes and bare paths keep their text and answer only what RN's patterns match", ids: idsWith(urlCases, "url/ftp-is-not-http", "url/uppercase-scheme",
    "url/custom-scheme", "url/path-only", "url/empty-string")},
  {check: "url/A base is joined to the URL the way RN's constructor writes it", ids: idsWith(urlCases, "url/base-and-absolute-path", "url/base-and-relative-path",
    "url/base-and-dot-dot", "url/base-and-query", "url/base-is-a-url", "url/base-ignored-for-an-absolute-url", "url/base-already-ends-with-the-path", "url/empty-base-is-no-base")},
  {check: "url/The constructor throws RN's TypeError for an invalid base, and the engine's where RN does not guard", ids: idsWith(urlCases, "url/invalid-base-throws",
    "url/hash-without-a-scheme-throws", "url/undefined-throws", "url/number-throws", "url/object-with-tostring-throws", "url/called-without-new-throws")},
  {check: "url/search is the one setter, and every other member is read-only", ids: idsWith(urlCases, "url/search-setter", "url/read-only-members")},
  {check: "url/searchParams is a live instance that toString folds back into the URL", ids: idsWith(urlCases, "url/search-params-are-live", "url/search-params-of-a-bare-url",
    "url/search-params-keep-the-hash", "url/search-params-removed-entirely")},
  {check: "url/The class has the members RN's source writes, and no canParse or parse", ids: idsWith(urlCases, "url/shape")},
  {check: "url/createObjectURL builds its URL from the blob module's constants", ids: idsWith(urlCases, "url/object-urls")},

  {check: "searchParams/A string is split, decoded and appended as RN's constructor does", ids: idsWith(searchParamsCases, "sp/from-a-string", "sp/from-a-string-with-a-question-mark",
    "sp/from-an-empty-string", "sp/from-empty-pairs", "sp/from-a-key-without-a-value", "sp/from-a-value-with-an-equals-sign", "sp/from-percent-encoding-and-plus",
    "sp/from-a-bad-percent-sequence-throws")},
  {check: "searchParams/null, nothing and a number make an empty list", ids: idsWith(searchParamsCases, "sp/from-null", "sp/from-nothing", "sp/from-a-number")},
  {check: "searchParams/An object and an array of pairs are appended in order", ids: idsWith(searchParamsCases, "sp/from-an-object", "sp/from-an-object-with-other-values",
    "sp/from-an-array-of-pairs", "sp/from-short-and-long-pairs", "sp/from-an-array-of-non-pairs-throws")},
  {check: "searchParams/RN does not iterate a Map or an iterator, and reads another instance as an object", ids: idsWith(searchParamsCases, "sp/from-a-map-is-not-iterated",
    "sp/from-an-iterator-is-not-iterated", "sp/from-another-instance-is-read-as-an-object", "sp/called-without-new-throws")},
  {check: "searchParams/append, get, getAll, has, set and delete behave as RN's class does", ids: idsWith(searchParamsCases, "sp/append", "sp/get-and-get-all", "sp/has", "sp/set", "sp/delete")},
  {check: "searchParams/keys, values, entries, forEach and the iterator walk the entries in order", ids: idsWith(searchParamsCases, "sp/iteration",
    "sp/iteration-is-live-for-keys-and-a-snapshot-for-symbol-iterator")},
  {check: "searchParams/sort orders the keys with localeCompare and keeps the order of equal keys", ids: idsWith(searchParamsCases, "sp/sort-ascii", "sp/sort-mixed-case-and-punctuation",
    "sp/sort-already-sorted-and-empty")},
  {check: "searchParams/toString encodes spaces as plus signs and the rest with encodeURIComponent", ids: idsWith(searchParamsCases, "sp/to-string-encoding", "sp/to-string-of-odd-values",
    "sp/to-string-with-a-lone-surrogate-throws")},
  {check: "searchParams/The class has the members RN's source writes, a size and no toJSON", ids: idsWith(searchParamsCases, "sp/shape")},

  {check: "abort/A new controller has an open signal of RN's classes", ids: idsWith(abortCases, "abort/new-controller")},
  {check: "abort/abort() without a reason aborts with an AbortError once, and a second abort does nothing", ids: idsWith(abortCases, "abort/abort-without-a-reason", "abort/abort-twice")},
  {check: "abort/abort(reason) keeps any reason the caller gives, the falsy ones included", ids: idsWith(abortCases, "abort/abort-with-reasons")},
  {check: "abort/Listeners and onabort run in the order they were added, and a replaced onabort keeps its place", ids: idsWith(abortCases, "abort/listener-order-with-onabort",
    "abort/onabort-set-before-and-replaced", "abort/onabort-values", "abort/onabort-cleared-before-abort")},
  {check: "abort/Listener options, removal and a listener added during the dispatch behave as RN's EventTarget does", ids: idsWith(abortCases, "abort/listener-options",
    "abort/listener-added-while-dispatching")},
  {check: "abort/throwIfAborted throws the reason itself", ids: idsWith(abortCases, "abort/throw-if-aborted")},
  {check: "abort/AbortSignal.abort and AbortSignal.any make signals that are already or soon aborted", ids: idsWith(abortCases, "abort/signal-abort", "abort/signal-any",
    "abort/signal-any-rejects-bad-arguments")},
  {check: "abort/AbortSignal.timeout rejects a bad time with RN's TypeError", ids: idsWith(abortCases, "abort/signal-timeout-rejects-bad-arguments")},
  {check: "abort/AbortSignal cannot be constructed, and the members refuse another object", ids: idsWith(abortCases, "abort/signal-cannot-be-constructed",
    "abort/members-on-the-wrong-object")},
  {check: "abort/AbortSignal.timeout aborts with a TimeoutError, alone and inside any", ids: abortTimerCases.map(entry => entry.id)},

  {check: "encoding/TextEncoder encodes ASCII, BMP, astral characters, lone surrogates and the boundaries to the UTF-8 bytes Node's encoders give", ids: idsBetween(encodingCases, "encode/")
    .filter(id => Object.keys(encodingInputs).some(name => id === "encode/" + name))},
  {check: "encoding/TextEncoder has the shape of the engine's class, and its result is a Uint8Array", ids: idsWith(encodingCases, "encode/result-type", "encode/shape")},
  {check: "encoding/encode turns its argument into a string first, so an absent one is the text undefined (Node's gives no bytes)", ids: idsWith(encodingCases, "encode/no-argument",
    "encode/undefined", "encode/null", "encode/number", "encode/object", "encode/symbol-throws")},
  {check: "encoding/encodeInto fills the destination and reports what it read and wrote as Node's does", ids: [...idsBetween(encodingCases, "encodeInto/")
    .filter(id => id !== "encodeInto/rejects-what-is-not-a-uint8array" && id !== "encodeInto/into-a-view"), "encodeInto/into-a-view"]},
  {check: "encoding/encodeInto refuses what is not a Uint8Array with a TypeError", ids: idsWith(encodingCases, "encodeInto/rejects-what-is-not-a-uint8array")},
  {check: "encoding/btoa writes the base64 of a Latin-1 string as Node's does", ids: idsWith(encodingCases, "btoa/ascii", "btoa/empty", "btoa/padding", "btoa/latin1",
    "btoa/all-byte-values", "btoa/long", "btoa/null", "btoa/number", "btoa/object")},
  {check: "encoding/atob reads base64, skips ASCII whitespace and discards trailing bits as Node's does", ids: idsWith(encodingCases, "atob/ascii", "atob/empty", "atob/padding",
    "atob/ignores-ascii-whitespace", "atob/all-byte-values", "atob/trailing-bits-are-discarded", "atob/high-byte", "atob/null", "atob/number")},
  {check: "encoding/btoa and atob round-trip every byte, a long string and UTF-8 text", ids: idsBetween(encodingCases, "base64/")},
  {check: "encoding/Invalid base64 input throws an Error where Node's throws an InvalidCharacterError", ids: idsWith(encodingCases, "btoa/out-of-range-throws", "btoa/astral-throws",
    "atob/invalid-character-throws", "atob/url-alphabet-throws", "atob/unicode-throws", "atob/one-character-throws", "atob/five-characters-throw",
    "atob/padding-of-a-short-string-throws", "atob/too-much-padding-throws", "atob/padding-in-the-middle-throws")},
  {check: "encoding/btoa and atob without an argument coerce undefined to text, where Node's throw a TypeError", ids: idsWith(encodingCases, "btoa/no-argument", "atob/no-argument",
    "btoa/symbol-throws", "atob/symbol-throws")},

  {check: "decoder/typeof TextDecoder is undefined, it is not a property of the global object, and the negative fixture sees no descriptor", ids: idsWith(decoderCases,
    "decoder/typeof", "decoder/in-global", "decoder/own-property", "decoder/descriptor")},
  {check: "decoder/Reading or constructing TextDecoder throws the engine's ReferenceError", ids: idsWith(decoderCases, "decoder/construct-throws", "decoder/read-throws")},
  {check: "decoder/TextEncoder, atob and btoa are functions beside the absent decoder", ids: idsWith(decoderCases, "decoder/typeof-the-others")},
];

// ------------------------------------------------------------------------------------------------------------------------------------------------

export function runCases(cases, env) {
  return Object.fromEntries(cases.map(entry => [entry.id, attempt(() => entry.run(env))]));
}

// The cases that end on a timer, run one after the other. Resolves with the same shape as runCases.
export async function runTimerCases(cases, env) {
  const results = {};
  for (const entry of cases) {
    try {
      results[entry.id] = {threw: false, value: describe(await entry.run(env))};
    } catch (error) {
      results[entry.id] = {threw: true, thrown: describe(error)};
    }
  }
  return results;
}
