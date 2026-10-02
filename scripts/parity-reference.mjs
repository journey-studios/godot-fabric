// Original RN mobile renderer: no Godot facade, adapters, esbuild aliases or mocks.
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertReport, provenance } from "./parity-protocol.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const platformIndex = process.argv.indexOf("--platform");
const platform = process.argv[platformIndex + 1];
if (platformIndex < 0 || !["ios", "android"].includes(platform)) throw new Error("Use --platform ios or --platform android");
const deps = path.join(root, ".deps");
const project = path.join(deps, "parity-reference");
mkdirSync(deps, { recursive: true });
mkdirSync(path.join(root, "build"), { recursive: true });
const reportPath = path.join(root, `build/parity-${platform}.json`);
rmSync(reportPath, { force: true });
const fixture = readFileSync(path.join(root, "tests/parity/fixture.jsx"));

function command(binary, args, cwd = project, timeout = 600000) {
  console.log(`Reference ${platform}: ${binary} ${args.join(" ")}`);
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd, stdio: "inherit" });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, timeout);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0 && !timedOut) resolve(); else reject(new Error(`${binary} failed: ${timedOut ? "timeout" : signal || code}`));
    });
  });
}

const archive = path.join(deps, "react-native-community-template-0.87.1.tgz");
if (!existsSync(archive)) await command("curl", ["--fail", "--location", "--retry", "2", "--max-time", "180", "https://registry.npmjs.org/@react-native-community/template/-/template-0.87.1.tgz", "-o", archive], root);
if (createHash("sha256").update(readFileSync(archive)).digest("hex") !== "7bc00d99a24378f6c1c415a9585abbe287742aefa2c028d94037e90f6a7b7c0c")
  throw new Error("Reference template checksum mismatch");
if (!existsSync(project)) {
  const staging = mkdtempSync(path.join(deps, ".reference-template-"));
  try {
    await command("tar", ["-xzf", archive, "-C", staging], root);
    renameSync(path.join(staging, "package/template"), project);
  } finally { rmSync(staging, { recursive: true, force: true }); }
}
for (const name of ["package.json", "package-lock.json"])
  cpSync(path.join(root, "tests/parity/reference", name), path.join(project, name));
await command("npm", ["ci", "--ignore-scripts"]);
// The template app is generic and disposable; do not install as HelloWorld.
const xcodeProject = path.join(project, "ios/HelloWorld.xcodeproj/project.pbxproj");
writeFileSync(xcodeProject, readFileSync(xcodeProject, "utf8").replaceAll("org.reactjs.native.example.$(PRODUCT_NAME:rfc1034identifier)", "org.godotfabric.parity"));
const gradle = path.join(project, "android/app/build.gradle");
writeFileSync(gradle, readFileSync(gradle, "utf8").replace('applicationId "com.helloworld"', 'applicationId "org.godotfabric.parity"'));
// Enable localhost HTTP only in this disposable reference app.
const manifest = path.join(project, "android/app/src/main/AndroidManifest.xml");
writeFileSync(manifest, readFileSync(manifest, "utf8").replace('android:usesCleartextTraffic="${usesCleartextTraffic}"', 'android:usesCleartextTraffic="true"'));
mkdirSync(path.join(project, "parity"), { recursive: true });
writeFileSync(path.join(project, "parity/fixture.jsx"), fixture);
rmSync(path.join(project, "App.tsx"), { force: true });

let resolveReport;
const collected = new Promise((resolve) => { resolveReport = resolve; });
const server = createServer((request, response) => {
  if (request.method !== "POST" || request.url !== "/report") { response.writeHead(404).end(); return; }
  let body = "";
  request.on("data", (chunk) => {
    body += chunk;
    if (body.length > 65536) request.destroy();
  });
  request.on("end", () => {
    try {
      const report = JSON.parse(body);
      response.writeHead(200).end("ok");
      resolveReport(report);
    } catch { response.writeHead(400).end("invalid report"); }
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
writeFileSync(path.join(project, "App.jsx"), `import React from 'react';
import {Platform} from 'react-native';
import {ParityFixture} from './parity/fixture';
export default function App() {
  return <ParityFixture onComplete={report => {
    const result = {...report, platform:Platform.OS, ...${JSON.stringify(provenance())}};
    fetch('http://127.0.0.1:${port}/report', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result)}).catch(error => console.error(error));
  }} />;
}
`);
let simulator;
let bootedHere = false;
let serial;
let reversedHere = false;
try {
  if (platform === "ios") {
    if (process.platform !== "darwin") throw new Error("iOS reference requires macOS, Xcode and CocoaPods");
    await command("pod", ["install"], path.join(project, "ios"));
    if (process.argv.includes("--prepare-only")) console.log("Reference dependencies prepared");
    else {
      const result = spawnSync("xcrun", ["simctl", "list", "devices", "available", "--json"], { encoding: "utf8", timeout: 10000 });
      if (result.status !== 0) throw new Error(result.stderr || "Cannot list iOS simulators");
      const available = Object.entries(JSON.parse(result.stdout).devices).filter(([runtime]) => runtime.includes("iOS"))
        .sort(([left], [right]) => right.localeCompare(left, undefined, { numeric: true }))
        .flatMap(([, devices]) => devices).filter((device) => device.isAvailable && device.name.includes("iPhone"));
      simulator = process.env.RN_SIMULATOR_UDID ? available.find((device) => device.udid === process.env.RN_SIMULATOR_UDID)
        : available.find((device) => device.state === "Shutdown");
      if (!simulator) throw new Error("Set RN_SIMULATOR_UDID to an available iPhone simulator");
      const derived = path.join(deps, "reference-derived");
      await command("xcodebuild", ["-workspace", "ios/HelloWorld.xcworkspace", "-scheme", "HelloWorld", "-configuration", "Release", "-sdk", "iphonesimulator", "-destination", "generic/platform=iOS Simulator", "-derivedDataPath", derived, "-quiet", "CODE_SIGNING_ALLOWED=NO", "ARCHS=arm64", "ONLY_ACTIVE_ARCH=YES"]);
      if (simulator.state === "Shutdown") { await command("xcrun", ["simctl", "boot", simulator.udid]); bootedHere = true; }
      await command("xcrun", ["simctl", "bootstatus", simulator.udid, "-b"], project, 120000);
      await command("xcrun", ["simctl", "install", simulator.udid, path.join(derived, "Build/Products/Release-iphonesimulator/HelloWorld.app")]);
      await command("xcrun", ["simctl", "launch", simulator.udid, "org.godotfabric.parity"]);
    }
  } else {
    serial = process.env.RN_ANDROID_SERIAL;
    if (!serial && !process.argv.includes("--prepare-only")) throw new Error("Set RN_ANDROID_SERIAL to a running emulator");
    await command("./gradlew", [":app:assembleRelease", `-PreactNativeArchitectures=${process.env.RN_ANDROID_ABI || "x86_64"}`], path.join(project, "android"));
    if (!process.argv.includes("--prepare-only")) {
      await command("adb", ["-s", serial, "reverse", `tcp:${port}`, `tcp:${port}`]);
      reversedHere = true;
      await command("adb", ["-s", serial, "install", "-r", path.join(project, "android/app/build/outputs/apk/release/app-release.apk")]);
      await command("adb", ["-s", serial, "shell", "am", "start", "-n", "org.godotfabric.parity/com.helloworld.MainActivity"]);
    }
  }
  if (!process.argv.includes("--prepare-only")) {
    let timer;
    const report = await Promise.race([collected, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Native reference did not send a completion report")), 60000); })]).finally(() => clearTimeout(timer));
    assertReport(report, platform);
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
    console.log(`PARITY_REFERENCE_PASSED: original RN ${platform}, ${report.checks.length} checks`);
  }
} finally {
  server.close();
  if (bootedHere) await command("xcrun", ["simctl", "shutdown", simulator.udid], project, 30000);
  if (reversedHere) await command("adb", ["-s", serial, "reverse", "--remove", `tcp:${port}`], project, 30000);
}
