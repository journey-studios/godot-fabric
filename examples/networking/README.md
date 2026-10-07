# fetch and XMLHttpRequest over Godot's HTTP client

```sh
npm run example -- networking
npm run example -- networking --headless
npm run example -- networking --capture
npm run test:networking
```

React Native's original `fetch` (with `Headers`, `Request` and `Response`),
`XMLHttpRequest`, `FormData`, `Blob`, `FileReader` and `AbortController` run in
the application: RN's own JavaScript, installed from the host's initialization
exactly as `InitializeCore` installs it, over three native modules the host
implements with RN's Android contract (`Networking`, `BlobModule` and
`FileReaderModule`) and a transport on Godot's `HTTPClient`. The launcher entry is
the interactive demo: a screen with six buttons (GET JSON, GET text, POST form,
Redirect, Slow and Abort) that call `fetch` against a small HTTP server the scene
starts on loopback, with a status badge, the final URL, the content type, the body
and a log of the operations. Nothing reaches the network.

`npm run test:networking` is the evidence suite, outside the catalog: RN's APIs
against a deterministic Node server over HTTP and HTTPS, in two roots of one
application, with the preceding host as the control and retained sabotages.

## Use the example

The scene starts a server on an ephemeral loopback port and passes its address to
the root as `baseUrl`. Click a button, read the badge, and click Slow, then Abort,
to end a request the server never answers.

## What the validation establishes

[validation.gd](validation.gd) sends actual Godot mouse input and reads the labels
and the badge color the host drew, what React observed, the requests the server
received and the application's networking module. GET JSON shows the status 200,
the final URL, `application/json; charset=utf-8` and the parsed body, and the
server received exactly one GET. GET text decodes a UTF-8 body with accents. POST
form sends `FormData` as multipart: the server finds both parts. Redirect shows
that the host follows the 302 itself and reports the final URL, with two requests
at the server. Slow stays in flight, the badge turns amber and the module counts
one request in flight; Abort ends it with an `AbortError`, the server sees the
connection closed and nothing stays in flight. With `--capture` the renderer's
frame is saved and the badge's color sampled in it.

## Original syntax

```jsx
const controller = new AbortController();
const response = await fetch(`${baseUrl}/api/profile`, {signal: controller.signal});
const data = await response.json();

const form = new FormData();
form.append("name", "Ana");
await fetch(`${baseUrl}/api/echo`, {method: "POST", body: form});

const request = new XMLHttpRequest();
request.onload = () => console.log(request.status, request.responseText);
request.open("GET", `${baseUrl}/api/text`);
request.send();
```

## Limits

Cookies are neither stored nor sent, responses are not decompressed (a compressed
answer fails explicitly), requests use HTTP/1.1 on one connection each, upload and
download progress events are not sent, and `FormData` file parts and `uri` bodies
fail explicitly. WebSocket is a separate slice: until it lands its first use fails
with RN's own `'WebSocketModule' could not be found`. See the
[research](../../docs/research/networking.md).
