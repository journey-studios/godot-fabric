import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {copyFile, mkdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {guardSources} from "./sabotage-sources.mjs";

// The retained sabotages of the WebSocket slice: each breaks one behavior of the host's WebSocket support on purpose,
// runs the probe and the independent oracle against it, and the source is restored byte for byte, proven by hash, and
// the genuine host rebuilt.
//
//  origin  never adds the default Origin header: a socket opened without one sends none, where RN's Android module
//          sends the origin of the URL, and the server's record of the handshake shows it.
//  stop    closes the sockets an application stop ends with 1000 instead of 1001 (going away): the server's record of
//          the close frames shows it.
//
// Both the probe's checks and the oracle (which states what the server must have received and sent) must reject each
// host. The sources come back whatever ends the run, a signal included (scripts/sabotage-sources.mjs). Run with:
//   node scripts/websocket-sabotage.mjs
const root = fileURLToPath(new URL("..", import.meta.url));
const host = path.join(root, "addons/fabric_godot.dylib");
const cmake = path.join(root, ".deps/python/bin/cmake");
const variants = [
  {name: "origin", argument: "--sabotage=origin", hostDirectory: "build/websocket-sabotage-origin-host",
    file: "native/websocket_module.cpp",
    find: '    if (!has_origin) request.headers.emplace_back("origin", websocket::default_origin(url));',
    replace: '    if (false) request.headers.emplace_back("origin", websocket::default_origin(url));'},
  {name: "stop", argument: "--sabotage=stop", hostDirectory: "build/websocket-sabotage-stop-host",
    file: "native/godot_websocket_transport.cpp",
    find: "    const bool open = peer->get_ready_state() == WebSocketPeer::STATE_OPEN;\n    peer->close(websocket::close_going_away, \"\");",
    replace: "    const bool open = peer->get_ready_state() == WebSocketPeer::STATE_OPEN;\n    peer->close(1000, \"\");"},
];
const digest = content => createHash("sha256").update(content).digest("hex");
const sha = async file => digest(await readFile(file));
const files = [...new Set(variants.map(variant => variant.file))];
const sources = guardSources(root, files);

async function build(name) {
  const result = await sources.run(cmake, ["--build", ".deps/build", "--parallel", "4", "--target", "fabric_godot"]);
  await writeFile(path.join(root, `build/websocket-sabotage-${name}-build.log`), result.stdout + result.stderr);
  assert.equal(result.status, 0, `The ${name} host must build: build/websocket-sabotage-${name}-build.log`);
}

const receipt = {format: "godot-fabric.websocket-sabotage/v1", sourceSha256: {genuine: sources.genuine}, variants: []};
for (const variant of variants) {
  sources.sabotaged(variant);
  await mkdir(path.join(root, variant.hostDirectory), {recursive: true});
}
// The genuine host first, so the restored one can be compared to it.
await build("genuine");
receipt.hostSha256 = {genuine: await sha(host)};
try {
  for (const variant of variants) {
    try {
      const broken = sources.sabotaged(variant);
      const entry = {name: variant.name, file: variant.file, find: variant.find, replace: variant.replace, sourceSha256: digest(broken)};
      sources.swap(variant.file, broken);
      await build(variant.name);
      entry.hostSha256 = await sha(host);
      assert.notEqual(entry.hostSha256, receipt.hostSha256.genuine);
      await copyFile(host, path.join(root, variant.hostDirectory, "fabric_godot.dylib"));
      entry.runStatus = (await sources.run(process.execPath, ["tests/websocket-native.test.mjs", variant.argument])).status;
      receipt.variants.push(entry);
    } finally {
      sources.restore();
    }
  }
} finally {
  receipt.sourceSha256.restored = sources.restore();
  await build("restored");
  receipt.hostSha256.restored = await sha(host);
}
assert.equal(receipt.hostSha256.restored, receipt.hostSha256.genuine, "The rebuilt host is the genuine one");
await writeFile(path.join(root, "build/websocket-sabotage.json"), JSON.stringify(receipt, null, 2) + "\n");
for (const entry of receipt.variants) {
  assert.equal(entry.runStatus, 0, `The probe and oracle must reject the ${entry.name} host: build/websocket-sabotage-${entry.name}.log`);
}
console.log(JSON.stringify(receipt, null, 2));
