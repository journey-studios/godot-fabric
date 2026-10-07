import assert from "node:assert/strict";
import {bytePattern, latin1Bytes, sha256, utf8Text} from "./networking-server.mjs";

// An independent check of a networking report. It trusts nothing the probe concluded: it recomputes what the
// server must have sent from the server's own definitions (the constants and byte pattern of
// networking-server.mjs), reads what the server recorded exactly as it arrived on the wire (raw header
// names, order, duplicates, body hashes, how each connection ended) and compares both with what JS observed
// through React Native's fetch and XMLHttpRequest. It derives the request multiset the cases must have
// caused, and ties the native counters to the server's record by arithmetic.
//
// A report is judged without its `checks`: the runner also feeds it a copy in which every check is marked
// passed, which a wrong host must still fail.

const JSON_BODY = {message: "hello", list: [1, 2, 3], unicode: "ação", nested: {ok: true}};
const text = value => Buffer.from(value, "utf8");
const same = (actual, expected, message) => assert.deepEqual(actual, expected, "networking oracle: " + message);
const equal = (actual, expected, message) => assert.equal(actual, expected, "networking oracle: " + message);
const check = (condition, message) => assert.ok(condition, "networking oracle: " + message);

function fnv1a(bytes) {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  return hash;
}
const allBytes = Buffer.from(Array.from({length: 256}, (_, index) => index));

const headerPairs = record => {
  const pairs = [];
  for (let index = 0; index < record.rawHeaders.length; index += 2) {
    pairs.push([record.rawHeaders[index].toLowerCase(), record.rawHeaders[index + 1]]);
  }
  return pairs;
};
const headerValues = (record, name) => headerPairs(record).filter(([key]) => key === name).map(([, value]) => value);
const headerValue = (record, name) => headerValues(record, name)[0];
const joinedHeaders = record => {
  const joined = {};
  for (const [name, value] of headerPairs(record)) {
    joined[name] = name in joined ? `${joined[name]}, ${value}` : value;
  }
  return joined;
};
const bodyOf = record => Buffer.from(record.bodyBase64 ?? "", "base64");

// The requests the cases cause, as "listener method url", derived from what each case is documented to send.
function expectedRequests() {
  const requests = [];
  const add = (method, url, listener = "http", times = 1) => {
    for (let count = 0; count < times; count += 1) {
      requests.push([listener, method, url].join(" "));
    }
  };
  const target = value => encodeURIComponent(value);
  // fetch cases, then XMLHttpRequest ones, in the order the probe runs them.
  add("GET", "/json", "http", 1 + 4); // fetch().json(); xhrEvents, xhrMinimal, xhrIncremental, xhrTypes' json
  add("GET", "/utf8", "http", 1 + 2); // fetch; xhrTypes' blob and text
  for (let index = 0; index < 5; index += 1) {
    add("GET", `/utf8?collect=${index}`); // the unclosed case: five responses whose blobs only the collector releases
  }
  add("GET", "/latin1");
  add("GET", "/close/70000");
  add("GET", "/close-chunked/70000");
  add("GET", "/bom", "http", 2); // fetch and XMLHttpRequest
  add("GET", "/bad-utf8", "http", 2);
  add("GET", "/bytes/4096");
  add("GET", "/large/1048576");
  for (const code of [404, 500, 204, 304]) {
    add("GET", `/status/${code}`);
  }
  add("HEAD", "/status/200");
  add("GET", "/echo?case=headers");
  add("GET", "/headers", "http", 2); // responseHeaders, and the cookies case that asks for them
  add("GET", "/echo?case=cookies");
  for (const name of ["post-json", "post-default", "post-bytes", "form-data", "post-blob"]) {
    add("POST", `/echo?case=${name}`);
  }
  // Redirects: each hop is a request.
  add("POST", `/redirect/302?to=${target("/echo?case=redirect-302-A")}`);
  add("GET", "/echo?case=redirect-302-A");
  add("POST", `/redirect/307?to=${target("/echo?case=redirect-307")}`);
  add("POST", "/echo?case=redirect-307");
  for (let hop = 20; hop >= 0; hop -= 1) {
    add("GET", `/redirect-chain/${hop}`);
  }
  for (let hop = 21; hop >= 1; hop -= 1) {
    add("GET", `/redirect-chain/${hop}`);
  }
  add("GET", "/redirect-loop", "http", 21);
  add("GET", `/redirect/302?to=${target("/echo?case=redirect-same")}`);
  add("GET", "/echo?case=redirect-same");
  add("GET", "/redirect-cross");
  add("GET", "/echo", "other");
  add("GET", "/redirect-scheme");
  // Failures that reach the server: a compressed answer to fetch and to XMLHttpRequest, a reset, a cut-short body.
  add("GET", "/gzip", "http", 2);
  add("GET", "/reset", "http", 3); // networkErrors, xhrTypes' failed blob and the contract case
  add("GET", "/utf8?contract=text");
  add("GET", "/bytes/16");
  add("GET", "/truncated");
  // TLS: only the two handshakes the engine accepted reached an HTTP server.
  add("GET", "/json?case=trusted", "https");
  add("GET", "/json?case=right", "https-untrusted");
  add("GET", "/bytes/512");
  add("GET", "/status/204");
  add("GET", "/status/404");
  add("POST", "/status/500");
  for (const root of ["A", "B"]) {
    add("GET", `/json?root=${root}`);
    add("GET", `/utf8?root=${root}`);
    add("POST", `/echo?root=${root}`);
  }
  add("GET", "/bytes/64", "http", 2);
  for (const name of ["abort-fetch", "timeout-xhr", "abort-blob", "stop-a", "stop-c"]) {
    add("GET", `/hang/${name}`);
  }
  for (const name of ["abort-xhr", "stop-b"]) {
    add("GET", `/hang-body/${name}`);
  }
  return requests.sort();
}

function verifyRecords(records, ports) {
  const listenerPort = {http: ports.http, other: ports.other, https: ports.https, "https-untrusted": ports.httpsUntrusted};
  records.forEach((record, index) => {
    const label = `request ${record.sequence} ${record.method} ${record.url}`;
    if (index > 0) {
      check(record.sequence > records[index - 1].sequence, "sequences increase");
    }
    equal(record.httpVersion, "1.1", `${label} is HTTP/1.1`);
    same(headerValues(record, "host"), [`127.0.0.1:${listenerPort[record.listener]}`], `${label} names the host it was sent to, once`);
    check(headerValues(record, "content-length").length <= 1, `${label} has at most one Content-Length`);
    equal(headerValues(record, "transfer-encoding").length, 0, `${label} declares no Transfer-Encoding`);
    check(record.state !== "open", `${label} ended`);
    check(headerValue(record, "user-agent") && headerValue(record, "accept"), `${label} carries the transport's default headers`);
    equal(headerValues(record, "cookie").length, 0, `${label} sends no cookie, though /headers set some`);
    if (["GET", "HEAD"].includes(record.method)) {
      equal(record.bodyBytes, 0, `${label} has no body`);
      equal(headerValues(record, "content-type").length, 0, `${label} has no content type`);
    }
    if (["POST", "PUT", "PATCH"].includes(record.method)) {
      equal(headerValue(record, "content-length"), String(record.bodyBytes), `${label} declares the length of its body`);
    }
    if (record.bodyBase64 !== null) {
      equal(sha256(bodyOf(record)), record.bodySha256, `${label} hashes to what the server computed`);
      equal(bodyOf(record).length, record.bodyBytes, `${label} body length`);
    }
  });
}

function only(records, url, listener = "http") {
  const found = records.filter(record => record.url === url && record.listener === listener);
  equal(found.length, 1, `exactly one request for ${url} on ${listener}`);
  return found[0];
}

// multipart/form-data as RN's FormData is sent: the parts, their headers and the closing delimiter.
function parseMultipart(record) {
  const type = headerValue(record, "content-type");
  const boundary = /^multipart\/form-data; boundary=(\S+)$/.exec(type)?.[1];
  check(boundary, "the multipart content type names its boundary: " + type);
  const raw = bodyOf(record).toString("utf8");
  check(raw.startsWith(`--${boundary}\r\n`) && raw.endsWith(`\r\n--${boundary}--\r\n`), "the multipart body is delimited");
  return raw.slice(`--${boundary}\r\n`.length, raw.length - `\r\n--${boundary}--\r\n`.length).split(`\r\n--${boundary}\r\n`).map(part => {
    const separator = part.indexOf("\r\n\r\n");
    return {headers: part.slice(0, separator).split("\r\n"), value: part.slice(separator + 4)};
  });
}

function verifyBodies(records) {
  const json = only(records, "/echo?case=post-json");
  equal(bodyOf(json).toString("utf8"), JSON.stringify({text: "ação", list: [1, 2, 3]}), "the JSON body arrived as UTF-8");
  equal(headerValue(json, "content-type"), "application/json", "the JSON content type");
  const defaulted = only(records, "/echo?case=post-default");
  equal(bodyOf(defaulted).toString("utf8"), "só texto", "the default-typed body");
  equal(headerValue(defaulted, "content-type"), "text/plain;charset=UTF-8", "whatwg-fetch's own content type");
  const bytes = only(records, "/echo?case=post-bytes");
  check(bodyOf(bytes).equals(allBytes), "every byte of the typed array arrived");
  equal(headerValue(bytes, "content-type"), "application/octet-stream", "the binary content type");
  const blob = only(records, "/echo?case=post-blob");
  equal(bodyOf(blob).toString("utf8"), "olá mundo 😀", "the blob body is its parts' bytes");
  equal(headerValue(blob, "content-type"), "text/plain;charset=utf-8", "the blob's type is the content type");
  same(parseMultipart(only(records, "/echo?case=form-data")), [
    {headers: ['content-disposition: form-data; name="field"'], value: "ação 日本語"},
    {headers: ['content-disposition: form-data; name="plain"'], value: "abc"},
  ], "the multipart parts, their headers and values");
  // 302 replaces the POST by a GET without body or its headers, 307 repeats the POST.
  const post302 = only(records, `/redirect/302?to=${encodeURIComponent("/echo?case=redirect-302-A")}`);
  const get302 = only(records, "/echo?case=redirect-302-A");
  equal(bodyOf(post302).toString("utf8"), "payload-302", "the redirected POST carried its body");
  equal(get302.method, "GET", "302 turns the POST into a GET");
  equal(get302.bodyBytes, 0, "and drops the body");
  same(headerValues(get302, "x-keep"), ["kept"], "while other headers follow");
  check(get302.sequence > post302.sequence, "the GET follows the POST");
  const post307 = only(records, `/redirect/307?to=${encodeURIComponent("/echo?case=redirect-307")}`);
  const again307 = only(records, "/echo?case=redirect-307");
  equal(again307.method, "POST", "307 keeps the method");
  equal(again307.bodySha256, post307.bodySha256, "and sends the same body again");
  equal(bodyOf(again307).toString("utf8"), "payload-307", "the repeated body is the original");
  equal(headerValue(again307, "content-type"), "text/plain", "with its content type");
  // Authorization follows a same-origin redirect and stops at another origin.
  same(headerValues(only(records, "/echo?case=redirect-same"), "authorization"), ["Bearer secret"], "Authorization follows a same-origin redirect");
  same(headerValues(only(records, "/echo", "other"), "authorization"), [], "Authorization stops at another origin");
  same(headerValues(only(records, "/echo", "other"), "x-keep"), ["kept"], "other headers cross origins");
  // Names as whatwg-fetch lowercases them, repeats joined once, UTF-8 values untouched.
  const sent = only(records, "/echo?case=headers");
  same(headerValues(sent, "x-custom"), ["one, two"], "repeated request headers were joined by Headers into one line");
  same(headerValues(sent, "accept"), ["application/json"], "Accept replaces the transport's default instead of repeating it");
  same(headerValues(sent, "x-unicode"), [Buffer.from("ação", "utf8").toString("latin1")], "a non-ASCII header value travels as UTF-8 bytes");
}

function verifyChains(records) {
  const chain = records.filter(record => record.url.startsWith("/redirect-chain/")).map(record => Number(record.url.split("/")[2]));
  same(chain, [...Array.from({length: 21}, (_, index) => 20 - index), ...Array.from({length: 21}, (_, index) => 21 - index)],
    "each chain was followed hop by hop, the second one stopping at the twenty-first follow-up");
  equal(records.filter(record => record.url === "/redirect-loop").length, 21, "the loop was followed 20 times and then refused");
}

const heldRequests = ["abort-fetch", "abort-xhr", "timeout-xhr", "abort-blob", "stop-a", "stop-b", "stop-c"];
function verifyHolds(records, holds) {
  same(Object.keys(holds).sort(), [...heldRequests].sort(), "the held requests");
  for (const name of heldRequests) {
    equal(holds[name], "closed-by-client", `${name} ended by the client closing its connection, not by an answer`);
    const prefix = ["abort-xhr", "stop-b"].includes(name) ? "/hang-body/" : "/hang/";
    equal(only(records, prefix + name).state, "closed-by-client", `${name} is recorded as closed by the client`);
  }
  for (const record of records.filter(entry => entry.url === "/reset")) {
    equal(record.state, "closed-by-server", "a reset connection was the server's doing");
  }
  equal(only(records, "/truncated").state, "closed-by-server", "so was the truncated one");
}

const resultOf = entry => {
  check(entry && entry.status === "done", "case finished: " + JSON.stringify(entry?.error ?? entry?.key));
  return entry.result;
};
const failedFetch = outcome => same([outcome.error.name, outcome.error.message], ["TypeError", "Network request failed"], "the request fails like Android's networking");

function verifyFetchResults(report, records) {
  const stages = report.stages;
  const {ports} = report.server;
  const json = resultOf(stages.json);
  same(json.body, JSON_BODY, "fetch().json() is the server's body");
  equal(json.url, `http://127.0.0.1:${ports.http}/json`, "the response URL");
  equal(json.contentType, "application/json; charset=utf-8", "the content type header");
  const utf8 = resultOf(stages.utf8);
  equal(utf8.text, utf8Text, "text() decodes the multi-byte body");
  equal(utf8.blobSize, Buffer.byteLength(utf8Text), "the blob counts bytes");
  equal(utf8.blobType, "text/plain; charset=utf-8", "the blob type is the Content-Type");
  const latin1 = resultOf(stages.latin1);
  equal(latin1.text, latin1Bytes.toString("latin1"), "text() honors the charset the Content-Type declares");
  equal(latin1.blobSize, latin1Bytes.length, "the ISO-8859-1 blob is one byte per character");
  const bom = resultOf(stages.bom);
  equal(bom.viaFetch, "\uFEFFcom BOM", "FileReader keeps a byte order mark");
  equal(bom.viaXhr, "com BOM", "XMLHttpRequest's text drops it");
  const invalid = Buffer.from([0x61, 0xff, 0x62, 0xc3]).toString("utf8");
  same(resultOf(stages.badUtf8), {viaFetch: invalid, viaXhr: invalid}, "invalid UTF-8 is replaced the same way on both paths");
  const bytes = resultOf(stages.bytes);
  same(bytes.bytes, [...bytePattern(4096)], "the bytes of a binary body");
  equal(bytes.sha256, sha256(bytePattern(4096)), "the server's own hash of them");
  const large = resultOf(stages.large);
  equal(large.length, 1048576, "the megabyte body is whole");
  equal(large.fnv, fnv1a(bytePattern(1048576)), "and byte-exact");
  equal(large.sha256, sha256(bytePattern(1048576)), "against the server's hash");
  const closing = resultOf(stages.closing);
  same(closing, {sized: {length: 70000, fnv: fnv1a(bytePattern(70000))}, chunked: {length: 70000, fnv: fnv1a(bytePattern(70000))}},
    "a server that closes right after answering delivers whole bodies, sized and chunked");
  const status = resultOf(stages.status);
  same(Object.fromEntries(["404", "500", "204", "304"].map(code => [code, [status[code].status, status[code].ok, status[code].text]])), {
    404: [404, false, "status 404"], 500: [500, false, "status 500"], 204: [204, true, ""], 304: [304, false, ""],
  }, "statuses, ok and bodies");
  same([status.head.status, status.head.text, status.head.contentType], [200, "", "text/plain"], "HEAD has headers and no body");
  // What JS read back from /echo is the server's own record of that request.
  same(resultOf(stages.cookies), {setCookie: "a=1, b=2", sentCookie: null, cleared: false}, "cookies are not stored and there is nothing to clear");
  const echo = resultOf(stages.echoHeaders).echo;
  const sent = only(records, "/echo?case=headers");
  same(echo.headers, joinedHeaders(sent), "the echo JS parsed is the request the server recorded");
  same(echo.rawHeaders, sent.rawHeaders, "and its raw header lines");
  const byName = Object.fromEntries(resultOf(stages.responseHeaders).pairs);
  same([byName["set-cookie"], byName["x-multi"], byName["x-mixed-case"], byName["x-empty"], byName["content-type"], byName["content-length"]],
    ["a=1, b=2", "one, two, three", "Value", "", "text/plain", "7"], "response headers, repeats joined with a comma");
  check(Object.keys(byName).every(name => name === name.toLowerCase()), "Headers lower-cases every name");
  for (const [name, stage] of Object.entries({"post-json": "postJson", "post-default": "postDefaultType", "post-bytes": "postBytes", "post-blob": "postBlob"})) {
    const echoed = resultOf(stages[stage]).echo;
    const record = only(records, `/echo?case=${name}`);
    same([echoed.method, echoed.bodyBytes, echoed.bodySha256], [record.method, record.bodyBytes, record.bodySha256], `${name}: the echo is the recorded request`);
  }
  equal(resultOf(stages.postJson).sent, JSON.stringify({text: "ação", list: [1, 2, 3]}), "the JSON JS sent");
  equal(resultOf(stages.postFormData).echo.bodyBase64, only(records, "/echo?case=form-data").bodyBase64, "the multipart body JS got back is the recorded one");
  failedFetch(resultOf(stages.postBytesNoType));
  failedFetch(resultOf(stages.postFormDataFile));
}

function verifyRedirectResults(report) {
  const stages = report.stages;
  const {ports} = report.server;
  const r302 = resultOf(stages.redirect302);
  same([r302.status, r302.url, r302.echo.method, r302.echo.bodyBytes], [200, `http://127.0.0.1:${ports.http}/echo?case=redirect-302-A`, "GET", 0],
    "302: the response is the follow-up's, at the final URL");
  const r307 = resultOf(stages.redirect307);
  same([r307.status, r307.echo.method, r307.echo.bodySha256], [200, "POST", sha256(text("payload-307"))], "307: the follow-up repeated the POST");
  same(resultOf(stages.redirectChain20), {status: 200, url: `http://127.0.0.1:${ports.http}/redirect-chain/0`, text: "chain end"}, "twenty follow-ups succeed");
  failedFetch(resultOf(stages.redirectChain21));
  failedFetch(resultOf(stages.redirectLoop));
  const origins = resultOf(stages.redirectOrigins);
  equal(origins.same.headers.authorization, "Bearer secret", "same origin keeps Authorization");
  equal(origins.cross.headers.authorization, undefined, "another origin loses it");
  equal(origins.cross.headers.host, `127.0.0.1:${ports.other}`, "and Host is the other origin's");
  const scheme = resultOf(stages.redirectScheme);
  same([scheme.status, scheme.ok, scheme.location, scheme.text], [302, false, "ftp://127.0.0.1/file", "elsewhere"], "an unfollowable redirect is the response");
}

function verifyFailures(report) {
  const stages = report.stages;
  const gzip = resultOf(stages.gzip);
  failedFetch(gzip.fetched);
  check(/^Unsupported Content-Encoding "gzip"/.test(gzip.xhr.responseText), "XMLHttpRequest is told why: " + gzip.xhr.responseText);
  const errors = resultOf(stages.networkErrors);
  for (const name of ["refused", "reset", "unsupported", "invalid"]) {
    failedFetch(errors[name]);
  }
  same(errors.truncated.events.map(event => [event.type, event.readyState, event.status]),
    [["readystatechange", 1, 0], ["readystatechange", 2, 200], ["readystatechange", 4, 200], ["error", 4, 200], ["loadend", 4, 200]],
    "a body cut short is an error after the headers, never a load");
  check(/^unexpected end of stream from 127\.0\.0\.1:\d+$/.test(errors.truncated.responseText), "with its reason: " + errors.truncated.responseText);
  equal(errors.method.events.some(event => event.type === "error"), true, "an unsupported method is an error event");
}

function verifyHttps(report, records) {
  const stages = report.stages;
  const {ports} = report.server;
  const trusted = resultOf(stages.httpsTrusted);
  same([trusted.status, trusted.url, trusted.body], [200, `https://127.0.0.1:${ports.https}/json?case=trusted`, JSON_BODY], "TLS to the trusted authority's server");
  for (const refused of [stages.httpsUntrusted, stages.httpsDefault, stages.httpsOther.wrong, stages.httpsInvalid]) {
    failedFetch(resultOf(refused));
  }
  const right = resultOf(stages.httpsOther.right);
  same([right.status, right.url], [200, `https://127.0.0.1:${ports.httpsUntrusted}/json?case=right`], "trust follows the configured authority");
  // The engine refused three certificates, and no HTTP request ever reached either TLS server for them.
  equal(records.filter(record => record.listener === "https").length, 1, "the trusted server saw one request: the one it was trusted for");
  equal(records.filter(record => record.listener === "https-untrusted").length, 1, "the other TLS server saw one request");
  equal(stages.deliberateTlsFailures, 3, "three certificates were refused on purpose");
}

// RN's XMLHttpRequest events, as its source orders them: open, headers, data, completion, then load and loadend.
function verifyXhr(report) {
  const stages = report.stages;
  const events = resultOf(stages.xhrEvents);
  same(events.events.map(event => [event.type, event.readyState, event.status]),
    [["readystatechange", 1, 0], ["readystatechange", 2, 200], ["readystatechange", 3, 200], ["readystatechange", 4, 200], ["load", 4, 200], ["loadend", 4, 200]],
    "the readystatechange states and the terminal events");
  same(events.json, JSON_BODY, "XMLHttpRequest's body");
  check(events.responseURL.endsWith("/json"), "responseURL");
  check(events.allHeaders.endsWith("\r\n") && events.allHeaders.split("\r\n").slice(0, -1).every(line => /^[a-z0-9-]+: /.test(line)),
    "getAllResponseHeaders lists lower-case names");
  same(resultOf(stages.xhrMinimal).events.map(event => event.type), ["load"], "without readystatechange or progress listeners only load is observed");
  equal(resultOf(stages.xhrIncremental).status, 200, "incremental updates are asked for and the response still arrives");
  const types = resultOf(stages.xhrTypes);
  same(types.arraybuffer.bytes, [...bytePattern(512)], "arraybuffer");
  same(types.json.value, JSON_BODY, "json");
  equal(types.text.responseText, utf8Text, "text");
  same([types.blob.size, types.blob.type, types.blob.text], [Buffer.byteLength(utf8Text), "text/plain; charset=utf-8", utf8Text], "blob");
  same([types.emptyBlob.size, types.failedBlob.response], [0, "object"], "a 204 and a failure still give a blob, an empty one");
  same(types.failedBlob.events.map(event => event.type), ["readystatechange", "readystatechange", "error", "loadend"], "a refused connection is an error event");
  const errors = resultOf(stages.xhrHttpErrors);
  same(errors.notFound.events.map(event => event.type).filter(type => type !== "readystatechange"), ["load", "loadend"], "404 is a load");
  same([errors.notFound.status, errors.notFound.responseText, errors.failure.status], [404, "status 404", 500], "statuses");
  const aborted = resultOf(stages.abortXhr);
  same(aborted.events.slice(-3).map(event => [event.type, event.readyState, event.status]),
    [["readystatechange", 4, 0], ["abort", 4, 0], ["loadend", 4, 0]], "abort() dispatches readystatechange, abort and loadend");
  equal(aborted.events.some(event => ["load", "error", "timeout"].includes(event.type)), false, "and nothing else terminal");
  for (const timeout of [resultOf(stages.timeout), resultOf(stages.timeoutReal)]) {
    same(timeout.events.slice(-3).map(event => event.type), ["readystatechange", "timeout", "loadend"], "a time-out ends in timeout, not error");
    same([timeout.status, timeout.responseText], [0, "The request timed out."], "with no status and the reason");
  }
  same([resultOf(stages.abortFetch).error.name, resultOf(stages.abortFetch).error.message], ["AbortError", "Aborted"], "AbortController aborts a fetch");
  same([resultOf(stages.abortedBefore).error.name, resultOf(stages.abortedBefore).error.message], ["AbortError", "Aborted"],
    "an aborted signal fails before any request");
}

function verifyBlobs(report) {
  const blobs = resultOf(report.stages.blobs);
  const whole = text("ação 日本語 😀 e mais");
  same([blobs.size, blobs.type, blobs.text], [whole.length, "text/plain;charset=utf-8", whole.toString("utf8")], "blob bytes, type and text");
  same([blobs.sliceSize, blobs.sliceType, blobs.arrayBuffer], [6, "application/x-slice", [...whole.subarray(2, 8)]], "a slice shares the bytes");
  equal(blobs.dataUrl, `data:text/plain;charset=utf-8;base64,${whole.toString("base64")}`, "readAsDataURL");
  equal(blobs.untyped, `data:application/octet-stream;base64,${Buffer.from("x").toString("base64")}`, "an untyped blob is octet-stream");
  equal(blobs.latin1, "abc", "readAsText with ISO-8859-1");
  same(blobs.file, {name: "nota.txt", size: Buffer.byteLength("conteúdo"), type: "text/plain", lastModified: 1234, text: "conteúdo"}, "File");
  check(/^blob:<id>\?offset=0&size=\d+$/.test(blobs.objectUrl), "URL.createObjectURL: " + blobs.objectUrl);
  check(blobs.badEncoding.message.startsWith("E_UNSUPPORTED_ENCODING"), "an unsupported encoding rejects");
  equal(blobs.badRead.error.message, "E_INVALID_BLOB: The specified blob is invalid", "an unknown blob rejects");
  check(blobs.badSlice.error.message.includes("outside the specified blob"), "a range outside the blob rejects");
}

// The native module's contract, below XMLHttpRequest: RCTNetworking.android.js's events with their payloads, in order.
function verifyContract(report, records) {
  const contract = resultOf(report.stages.contract);
  const {ports} = report.server;
  const text = contract.text;
  check(Number.isInteger(text.requestId) && text.requestId >= 1, "the request id is the wrapper's: an integer from 1");
  same(text.events.map(event => event.name), ["didReceiveNetworkResponse", "didReceiveNetworkData", "didCompleteNetworkResponse"], "events in RN's order");
  const [id, status, headers, url] = text.events[0].payload;
  same([id, status, url], [text.requestId, 200, `http://127.0.0.1:${ports.http}/utf8?contract=text`], "the response event: id, status and final URL");
  same([headers["Content-Type"], headers["Content-Length"]], ["text/plain; charset=utf-8", String(Buffer.byteLength(utf8Text))],
    "its headers keep the names the server sent them with");
  same(text.events[1].payload, [text.requestId, utf8Text], "the data event carries the decoded body");
  same(text.events[2].payload, [text.requestId, null], "and the completion has a null error");
  same(contract.base64.events[1].payload, [contract.base64.requestId, bytePattern(16).toString("base64")], "base64 response data");
  check(contract.base64.requestId > text.requestId, "request ids increase");
  same(contract.reset.events.map(event => event.name), ["didCompleteNetworkResponse"], "a reset connection ends in one completion event");
  check(/^Connection to 127\.0\.0\.1:\d+ was lost before a response arrived$/.test(contract.reset.events[0].payload[1]) && contract.reset.events[0].payload.length === 2,
    "with an error message and no time-out flag: " + JSON.stringify(contract.reset.events[0].payload));
  same(contract.timeout.events.map(event => event.payload.slice(1)), [["The request timed out.", true]], "a time-out completes with the message and true");
  same(only(records, "/utf8?contract=text").method, "GET", "the contract request reached the server");
}

function verifyRoots(report) {
  for (const root of ["A", "B"]) {
    const result = resultOf(report.stages.concurrent[root]);
    same(result.json, JSON_BODY, `root ${root} json`);
    equal(result.text, utf8Text, `root ${root} text`);
    same(result.bytes, [...bytePattern(64)], `root ${root} bytes`);
    same([result.post.url, result.post.bodySha256], [`/echo?root=${root}`, sha256(text(`from root ${root}`))], `root ${root} received its own echo`);
  }
}

// The native counters and the server's record describe the same requests: a request is started once and ends once,
// and every request the server saw is the first hop of a started request or a redirect the transport followed.
function verifyCounters(report, records) {
  const stopped = report.stages.stopped.networking;
  const {transport, requests, events, blobs} = stopped;
  equal(stopped.stopped, true, "the application stopped");
  equal(requests.sent, transport.started, "every request the module sent was started by the transport");
  equal(transport.started, transport.completed + transport.failed + transport.cancelled, "every request ended exactly one way");
  // Three were aborted by JS and three were still in flight when the application stopped.
  equal(transport.cancelled, 3 + 3, "the cancelled requests are the aborts and the ones stop ended");
  equal(requests.aborted, 3, "three aborts");
  equal(transport.active + requests.inFlight, 0, "nothing is left in flight");
  equal(transport.timedOut, 3, "three time-outs: one on the moved clock and two on the real one");
  // Redirects followed: the POST 302, the POST 307, 20 per chain (twice, the second stopping at the limit), 20 for the
  // loop, and the two hops of the origin cases.
  equal(transport.redirectsFollowed, 1 + 1 + 20 + 20 + 20 + 1 + 1, "the follow-ups the transport made");
  // The server's record is the first hop of every started request that spoke HTTP, plus its redirects: six started
  // requests never did (a refused port, three certificates refused and two to the port that never answers).
  equal(records.length - transport.redirectsFollowed + 6, transport.started, "the server's record and the transport's counters agree");
  equal(events.queued, events.delivered + events.dropped, "every queued device event was delivered or dropped");
  equal(events.dropped, 0, "none of them was dropped");
  equal(blobs.count, 0, "no blob outlives the application");
}

export function verifyNetworkingReport(report, serverLog = report.server) {
  const ports = report.server.ports;
  const records = serverLog.records;
  check(records.length > 0, "the server recorded requests");
  verifyRecords(records, ports);
  same(records.map(record => [record.listener, record.method, record.url].join(" ")).sort(), expectedRequests(),
    "the server received exactly the requests the cases cause, no more and no fewer");
  verifyBodies(records);
  verifyChains(records);
  verifyHolds(records, serverLog.holds);
  verifyFetchResults(report, records);
  verifyRedirectResults(report);
  verifyFailures(report);
  verifyHttps(report, records);
  verifyXhr(report);
  verifyBlobs(report);
  verifyContract(report, records);
  verifyRoots(report);
  verifyCounters(report, records);
  return {requests: records.length,
    byListener: Object.fromEntries(["http", "other", "https", "https-untrusted"].map(name => [name, records.filter(record => record.listener === name).length]))};
}
