import assert from "node:assert/strict";
import path from "node:path";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHarness, hash, root } from "./consumer-harness.mjs";

// GF-27, native lane: the independent consumers/libraries template (NativeWind
// className, manual dark mode, retained state and Chart Kit v2) provisioned with
// the SDK, installed from its own lockfile, built by the editor plugin and run in
// Godot. `--capture` adds the headed run that saves the screenshots;
// `--control-ref <git ref>` also builds the template on that revision's SDK.
const capture = process.argv.includes("--capture");
const controlIndex = process.argv.indexOf("--control-ref");
const controlRef = controlIndex < 0 ? null : process.argv[controlIndex + 1];
const nativeChecks = 46;
const graphicalChecks = nativeChecks + 12;
const libraries = ["nativewind", "react-native-css-interop", "tailwindcss", "react-native-chart-kit", "react-native-svg"];
const harness = await createHarness({ template: "libraries", name: "consumer-libraries" });
const { directory, project, env, checks, sdk, verify, run, editor } = harness;
const runtime = (label, headed = false) => harness.runtime(label, { headed, marker: /LIBRARIES_VALIDATION_PASSED/, report: "libraries-report.json", expectedChecks: headed ? graphicalChecks : nativeChecks });
const read = async (...names) => JSON.parse(await readFile(path.join(project, ...names), "utf8"));
await rm(path.join(directory, "report.json"), { force: true });
try {
  await harness.provision();
  await cp(path.join(sdk, "manifest.json"), path.join(directory, "sdk-manifest.json"));
  verify(spawnSync("node", ["--version"], { env }).error?.code === "ENOENT", "Consumer cannot find global Node");

  // The project's own lockfile, installed with the provisioned private Node and npm.
  const privateNode = path.join(sdk, "toolchain/node/bin/node");
  const lockPath = path.join(project, "package-lock.json");
  const originalLock = await readFile(lockPath);
  await run("install", privateNode, [path.join(sdk, "toolchain/node/lib/node_modules/npm/bin/npm-cli.js"), "ci", "--ignore-scripts", "--no-audit", "--no-fund"]);
  verify(hash(await readFile(lockPath)) === hash(originalLock), "Installing from the lockfile leaves it unchanged");
  const lock = await read("package-lock.json");
  const installed = {};
  const mismatched = [];
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (!key.startsWith("node_modules/")) {
      continue;
    }
    const manifest = path.join(project, key, "package.json");
    // Optional platform packages of other systems are locked and not installed.
    if (!existsSync(manifest)) {
      continue;
    }
    const version = JSON.parse(await readFile(manifest, "utf8")).version;
    installed[key.slice("node_modules/".length)] = version;
    if (version !== entry.version) {
      mismatched.push(`${key} ${version} != ${entry.version}`);
    }
  }
  verify(mismatched.length === 0 && libraries.every(name => installed[name] === lock.packages["node_modules/" + name].version),
    "Every installed package has the version its lockfile entry records");
  verify(["react", "react-native", "react-native-reanimated", "react-native-safe-area-context"].every(name => !existsSync(path.join(project, "node_modules", name))),
    "The SDK-owned and optional peers stay out of the consumer's node_modules");
  const exact = Object.fromEntries(libraries.map(name => [name, installed[name]]));
  await writeFile(path.join(directory, "installed.json"), JSON.stringify({ libraries: exact, packages: Object.keys(installed).length, lockfileSha256: hash(originalLock) }, null, 2) + "\n");

  await editor("editor-cold");
  verify(hash(await readFile(lockPath)) === hash(originalLock), "Editor build preserves the project lockfile");
  const native = await runtime("headless");
  verify(native.beforeStop.bundleEvaluations === 1, "The native consumer executes its bundle once");
  const screenshots = {};
  if (capture) {
    const graphical = await runtime("graphical", true);
    for (const stage of ["light", "accent", "dark", "chart"]) {
      await cp(path.join(project, `libraries-${stage}.png`), path.join(directory, stage + ".png"));
      screenshots[stage] = hash(await readFile(path.join(directory, stage + ".png")));
    }
    verify(Object.keys(graphical.pixels).length === 4, "The headed run sampled one card pixel per capture");
  }

  const bundlePath = path.join(project, ".godot_fabric", "app.js");
  const bundleHash = hash(await readFile(bundlePath));
  await cp(bundlePath, path.join(directory, "baseline-bundle.js"));
  const buildReport = await read(".godot_fabric", "build-report.json");
  await cp(path.join(project, ".godot_fabric", "build-report.json"), path.join(directory, "bundle-report.json"));
  const inputs = buildReport.inputs;
  verify(inputs.every(file => !/(?:^|\/)examples\//.test(file) && !file.startsWith("project/../") && !file.startsWith("project/src/")),
    "The bundle has no laboratory, examples or SDK-checkout source imported by the consumer");
  verify(!inputs.some(file => file.includes("react-native-css-interop/dist/runtime/web/") || file.includes("node_modules/react-native-svg/")),
    "The bundle has neither the web interop runtime nor an upstream react-native-svg file");
  verify(inputs.includes("sdk/src/svg.jsx") && inputs.includes("project/node_modules/react-native-chart-kit/dist/v2/index.js") && inputs.includes("project/global.css"),
    "Chart Kit v2 runs over the SDK's SVG facade and the Tailwind entry is compiled");
  verify(buildReport.styles?.nativewind === exact.nativewind && buildReport.styles.reactNativeCssInterop === exact["react-native-css-interop"]
      && buildReport.styles.tailwind === exact.tailwindcss,
    "The style step compiled with the releases the consumer installed");

  await run("offline", "/usr/bin/sandbox-exec", ["-p", "(version 1)(allow default)(deny network*)", privateNode, path.join(sdk, "toolchain", "build.mjs"), project, "res://ui/index.tsx", "res://.godot_fabric/app.js"]);
  verify(hash(await readFile(bundlePath)) === bundleHash, "The provisioned build works with network denied and gives the same bundle");

  // A tailwind.config.js is project JavaScript; the builder refuses it and keeps the bundle.
  const configPath = path.join(project, "tailwind.config.js");
  await writeFile(configPath, "module.exports = { content: ['./ui/**/*.tsx'] };\n");
  assert.match(await editor("tailwind-config", 1), /E_PROJECT_TAILWIND_CONFIG[\s\S]*godotFabric\.tailwind/);
  verify(hash(await readFile(bundlePath)) === bundleHash, "A tailwind.config.js is refused with the declarative field named, keeping the previous bundle");
  await rm(configPath);

  // Retained sabotage: without the optional-peer rule the consumer fails exactly where main's SDK did.
  const resolutionPath = path.join(sdk, "toolchain", "project-resolution.mjs");
  const resolutionSource = await readFile(resolutionPath);
  const sabotaged = resolutionSource.toString("utf8").replace("      || owner.manifest.peerDependenciesMeta?.[name]?.optional === true;", "      ;");
  assert.notEqual(sabotaged, resolutionSource.toString("utf8"), "The optional-peer rule must be present to remove");
  await writeFile(resolutionPath, sabotaged);
  try {
    assert.match(await editor("sabotage-optional-peer", 1), /E_PROJECT_DEPENDENCY: react-native-safe-area-context: undeclared import in react-native-css-interop dependencies/);
    verify(hash(await readFile(bundlePath)) === bundleHash, "Without the optional-peer rule the build fails at react-native-safe-area-context and keeps the previous bundle");
  } finally { await writeFile(resolutionPath, resolutionSource); }
  verify(hash(await readFile(resolutionPath)) === hash(resolutionSource), "The sabotaged resolution source is restored byte for byte");
  await editor("recovery");
  verify(hash(await readFile(bundlePath)) === bundleHash && hash(await readFile(lockPath)) === hash(originalLock),
    "The consumer builds the same bundle again after the rejected requests, with its lockfile intact");

  // The NativeWind root (its doctor module has JSX in a .js file) and react-native-css-interop load through the
  // builder with no CSS and no declaration. The same reduced project is the control for the SDK of another revision.
  const manifestPath = path.join(project, "package.json");
  const { godotFabric: declaration, ...undeclared } = await read("package.json");
  const tsconfig = await read("tsconfig.json");
  await writeFile(manifestPath, JSON.stringify(undeclared, null, 2) + "\n");
  await writeFile(path.join(project, "tsconfig.json"), JSON.stringify({ ...tsconfig, include: ["ui/index.tsx"] }, null, 2) + "\n");
  await writeFile(path.join(project, "ui/index.tsx"), 'import { vars } from "nativewind";\nimport { AppRegistry, View } from "react-native";\n\nAppRegistry.registerComponent("Libraries", () => () => <View style={vars({ "--reduced": "1" })} />);\n');
  await editor("nativewind-root");
  const rootReport = await read(".godot_fabric", "build-report.json");
  verify(rootReport.inputs.includes("project/node_modules/nativewind/dist/index.js") && rootReport.inputs.includes("project/node_modules/react-native-css-interop/dist/doctor.native.js") && rootReport.styles === null,
    "Importing the NativeWind root builds with no CSS: the doctor module's JSX loads through the narrow rule");

  // Optional causal control on another revision's SDK (local runs; CI checkouts hold no other ref).
  let control = null;
  if (controlRef) {
    const archive = await mkdtemp(path.join(tmpdir(), "godot-fabric-control-sdk-"));
    const firstError = log => (log.split("\n").find(line => /GODOT_FABRIC_BUILD_ERROR|E_PROJECT_|E_ADAPTER_|TypeScript failed/.test(line)) ?? "").trim();
    try {
      const extracted = spawnSync("sh", ["-c", `git -C "${root}" archive --format=tar "${controlRef}" -- sdk/toolchain src types | tar -x -C "${archive}"`], { encoding: "utf8" });
      assert.equal(extracted.status, 0, extracted.stderr);
      await cp(path.join(archive, "sdk/toolchain"), path.join(sdk, "toolchain"), { recursive: true, filter: file => file.endsWith(".mjs") || !path.extname(file) });
      await cp(path.join(archive, "src"), path.join(sdk, "src"), { recursive: true });
      await cp(path.join(archive, "types"), path.join(sdk, "types"), { recursive: true });
      const typeFile = path.join(sdk, "types/react-native.ts");
      await writeFile(typeFile, (await readFile(typeFile, "utf8")).replace("../node_modules/", "../toolchain/node_modules/"));
      const label = controlRef.replace(/[^A-Za-z0-9._-]/g, "-");
      const reduced = firstError(await editor("control-nativewind-root-" + label, 1));
      verify(/E_PROJECT_DEPENDENCY: react-native-safe-area-context: undeclared import in react-native-css-interop dependencies/.test(reduced),
        "The reduced consumer that only imports NativeWind fails on the SDK of " + controlRef + " at react-native-safe-area-context");
      await writeFile(manifestPath, JSON.stringify({ ...undeclared, godotFabric: declaration }, null, 2) + "\n");
      await writeFile(path.join(project, "tsconfig.json"), JSON.stringify(tsconfig, null, 2) + "\n");
      await cp(path.join(root, "consumers/libraries/ui"), path.join(project, "ui"), { recursive: true });
      const full = firstError(await editor("control-full-" + label, 1));
      verify(full !== "", "The full consumer is rejected by the SDK of " + controlRef);
      control = { ref: controlRef, nativewindRoot: reduced, fullConsumer: full };
    } finally { await rm(archive, { recursive: true, force: true }); }
  }
  await writeFile(path.join(directory, "report.json"), JSON.stringify({
    schemaVersion: 1, host: "macOS arm64", template: "libraries", checks, nativeChecks, graphicalChecks: capture ? graphicalChecks : null,
    libraries: exact, bundleSha256: bundleHash, styles: buildReport.styles, screenshots, control,
  }, null, 2) + "\n");
  console.log("CONSUMER_LIBRARIES_CHECK_PASSED: " + checks.length + " build/install checks; " + nativeChecks + " native checks");
} finally { await harness.cleanup(); }
