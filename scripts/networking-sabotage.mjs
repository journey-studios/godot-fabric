import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {copyFile, mkdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

// The retained sabotages of the networking slice: each breaks one behavior of the host's HTTP layer on purpose,
// runs the probe and the independent oracle against it, and the source is restored byte for byte, proven by
// hash, and the genuine host rebuilt.
//
//  redirects  never follows a redirect: the 3xx answer is delivered as the response. fetch then returns the 302
//             where RN's Android client returns the page it points to, and the server never sees the follow-ups.
//  headers    keeps repeated response headers as separate entries instead of joining them with a comma: JS then
//             sees only the last Set-Cookie and X-Multi, where OkHttp's map has them all.
//
// Both the probe's checks and the oracle (which recomputes the requests the server must have seen and what JS
// must have read) must reject each host. Run with:
//   node scripts/networking-sabotage.mjs
const root = fileURLToPath(new URL("..", import.meta.url));
const host = path.join(root, "addons/fabric_godot.dylib");
const cmake = path.join(root, ".deps/python/bin/cmake");
const variants = [
  {name: "redirects", argument: "--sabotage=redirects", hostDirectory: "build/networking-sabotage-redirects-host",
    file: "native/godot_http_transport.cpp",
    find: "if (auto redirect = http::plan_redirect(x.request.method, status, x.url, x.request.headers, headers)) {",
    replace: "if (auto redirect = std::optional<http::Redirect>()) {"},
  {name: "headers", argument: "--sabotage=headers", hostDirectory: "build/networking-sabotage-headers-host",
    file: "native/http_core.h", find: '    else existing->second += ", " + value;', replace: "    else joined.emplace_back(name, value);"},
];
const digest = content => createHash("sha256").update(content).digest("hex");
const sha = async file => digest(await readFile(file));
const files = [...new Set(variants.map(variant => variant.file))];

async function build(name) {
  const result = spawnSync(cmake, ["--build", ".deps/build", "--parallel", "4", "--target", "fabric_godot"],
    {cwd: root, encoding: "utf8", timeout: 600000, maxBuffer: 64 * 1024 * 1024});
  await writeFile(path.join(root, `build/networking-sabotage-${name}-build.log`), (result.stdout ?? "") + (result.stderr ?? ""));
  assert.equal(result.status, 0, `The ${name} host must build: build/networking-sabotage-${name}-build.log`);
}

const originals = new Map(await Promise.all(files.map(async file => [file, await readFile(path.join(root, file))])));
const receipt = {format: "godot-fabric.networking-sabotage/v1",
  sourceSha256: {genuine: Object.fromEntries([...originals].map(([file, content]) => [file, digest(content)]))}, variants: []};
for (const variant of variants) {
  assert.equal(originals.get(variant.file).toString("utf8").split(variant.find).length, 2,
    `The ${variant.name} sabotage must replace exactly one place in ${variant.file}`);
  await mkdir(path.join(root, variant.hostDirectory), {recursive: true});
}
// The genuine host first, so the restored one can be compared to it.
await build("genuine");
receipt.hostSha256 = {genuine: await sha(host)};
try {
  for (const variant of variants) {
    const target = path.join(root, variant.file);
    try {
      const broken = originals.get(variant.file).toString("utf8").replace(variant.find, () => variant.replace);
      const entry = {name: variant.name, file: variant.file, find: variant.find, replace: variant.replace, sourceSha256: digest(broken)};
      await writeFile(target, broken);
      await build(variant.name);
      entry.hostSha256 = await sha(host);
      assert.notEqual(entry.hostSha256, receipt.hostSha256.genuine);
      await copyFile(host, path.join(root, variant.hostDirectory, "fabric_godot.dylib"));
      entry.runStatus = spawnSync(process.execPath, ["tests/networking-native.test.mjs", variant.argument],
        {cwd: root, encoding: "utf8", timeout: 600000, maxBuffer: 64 * 1024 * 1024}).status;
      receipt.variants.push(entry);
    } finally {
      await writeFile(target, originals.get(variant.file));
    }
  }
} finally {
  for (const [file, content] of originals) {
    await writeFile(path.join(root, file), content);
  }
  receipt.sourceSha256.restored = Object.fromEntries(await Promise.all(files.map(async file => [file, await sha(path.join(root, file))])));
  assert.deepEqual(receipt.sourceSha256.restored, receipt.sourceSha256.genuine, "Every source is restored byte for byte");
  await build("restored");
  receipt.hostSha256.restored = await sha(host);
}
assert.equal(receipt.hostSha256.restored, receipt.hostSha256.genuine, "The rebuilt host is the genuine one");
await writeFile(path.join(root, "build/networking-sabotage.json"), JSON.stringify(receipt, null, 2) + "\n");
for (const entry of receipt.variants) {
  assert.equal(entry.runStatus, 0, `The probe and oracle must reject the ${entry.name} host: build/networking-sabotage-${entry.name}.log`);
}
console.log(JSON.stringify(receipt, null, 2));
