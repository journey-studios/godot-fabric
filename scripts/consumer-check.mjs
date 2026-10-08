import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, writeFile, rm, rename, symlink } from "node:fs/promises";
import { createHarness, hash } from "./consumer-harness.mjs";

const capture = process.argv.includes("--capture");
const nativeChecks = 40;
const graphicalChecks = nativeChecks + 3;
const harness = await createHarness({ template: "minimal", name: "consumer" });
const { directory, project, outside, env, checks, sdk, verify, run, editor } = harness;
const runtime = (label, headed = false) => harness.runtime(label, { headed, marker: /CONSUMER_VALIDATION_PASSED/, report: "consumer-report.json", expectedChecks: headed ? graphicalChecks : nativeChecks });
await rm(path.join(directory, "report.json"), { force: true });
try {
  await harness.provision();
  await cp(path.join(sdk, "manifest.json"), path.join(directory, "sdk-manifest.json"));
  const manifest = JSON.parse(await readFile(path.join(sdk, "manifest.json"), "utf8"));
  const guide = await readFile(path.join(project, "README.md"), "utf8");
  assert.doesNotMatch(guide, /\]\(\.\.\/\.\.\//);
  assert.ok(guide.includes("https://raw.githubusercontent.com/journey-studios/godot-fabric/" + manifest.sourceCommit + "/docs/evidence/game-services/consumer-updated.png"));
  verify(spawnSync("node", ["--version"], { env }).error?.code === "ENOENT", "Consumer cannot find global Node");
  const lockPath = path.join(project, "package-lock.json");
  const originalLock = await readFile(lockPath);
  await editor("editor-cold");
  verify(hash(await readFile(lockPath)) === hash(originalLock), "Editor build preserves the project lockfile");
  const native = await runtime("headless");
  verify(native.beforeStop.bundleEvaluations === 1, "Native consumer executes its bundle once");
  if (capture) {
    await runtime("graphical", true);
    for (const stage of ["initial", "updated", "resized"])
      await cp(path.join(project, `consumer-${stage}.png`), path.join(directory, stage + ".png"));
  }
  const bundlePath = path.join(project, ".godot_fabric", "app.js");
  const bundleHash = hash(await readFile(bundlePath));
  await cp(bundlePath, path.join(directory, "baseline-bundle.js"));
  const inputs = JSON.parse(await readFile(path.join(project, ".godot_fabric", "build-report.json"), "utf8")).inputs;
  await cp(path.join(project, ".godot_fabric", "build-report.json"), path.join(directory, "bundle-report.json"));
  verify(inputs.every(file => !file.includes("examples/") && !file.startsWith("project/../")), "Bundle has no laboratory or external checkout inputs");
  verify(inputs.some(file => file === "project/ui/platform.godot.ts") && !inputs.some(file => file === "project/ui/platform.native.ts"), "Consumer and types select the Godot platform source");
  await run("offline", "/usr/bin/sandbox-exec", ["-p", "(version 1)(allow default)(deny network*)", path.join(sdk, "toolchain", "node", "bin", "node"), path.join(sdk, "toolchain", "build.mjs"), project, "res://ui/index.tsx", "res://.godot_fabric/app.js"]);
  verify(hash(await readFile(bundlePath)) === bundleHash, "Provisioned build works with network denied and no global Node");
  const entryPath = path.join(project, "ui", "index.tsx");
  const originalEntry = await readFile(entryPath, "utf8");
  const packagePath = path.join(project, "package.json");
  const originalPackage = await readFile(packagePath, "utf8");
  const configPath = path.join(project, "tsconfig.json");
  const originalConfig = await readFile(configPath, "utf8");
  for (const [name, source, diagnostic] of [
    ["syntax", originalEntry + "\nconst broken = ;\n", /TypeScript failed/],
    ["unsupported-type", originalEntry.replace('title="Increment local"', 'title="Increment local" accessibilityLabel="unsupported"'), /accessibilityLabel/],
  ]) {
    await writeFile(entryPath, source);
    assert.match(await editor(name, 1), diagnostic);
    verify(hash(await readFile(bundlePath)) === bundleHash, name + " failure preserves the previous bundle");
  }
  await writeFile(entryPath, originalEntry);
  const resourcePath = path.join(project, "ui", "application.tres");
  const originalResource = await readFile(resourcePath, "utf8");
  await writeFile(resourcePath, originalResource.replace("format_version=1", "format_version=999"));
  assert.match(await editor("invalid-resource", 1), /Unsupported application Resource version/);
  verify(hash(await readFile(bundlePath)) === bundleHash, "An invalid Resource cannot replace the bundle");
  await writeFile(resourcePath, originalResource);
  const privateNode = path.join(sdk, "toolchain", "node", "bin", "node");
  await rename(privateNode, privateNode + ".unavailable");
  try {
    assert.match(await editor("missing-toolchain", 1), /private toolchain missing/);
    verify(hash(await readFile(bundlePath)) === bundleHash, "Missing private tools reject builds without global fallback or installation");
  } finally { await rename(privateNode + ".unavailable", privateNode); }
  const generated = path.join(project, ".godot_fabric");
  await rename(generated, generated + ".saved");
  await symlink(outside, generated);
  try {
    assert.match(await editor("escaped-output", 1), /Resource path resolves outside the project/);
    verify(hash(await readFile(path.join(generated + ".saved", "app.js"))) === bundleHash, "An output symlink outside the project is rejected");
  } finally { await rm(generated); await rename(generated + ".saved", generated); }
  const babelPath = path.join(project, "babel.config.cjs");
  await writeFile(babelPath, "module.exports = {};\n");
  assert.match(await editor("unsupported-babel", 1), /Project Babel configuration is not supported/);
  verify(hash(await readFile(bundlePath)) === bundleHash, "Project Babel configuration is rejected explicitly rather than ignored");
  await rm(babelPath);
  await writeFile(packagePath, JSON.stringify({ ...JSON.parse(originalPackage), dependencies: { react: "0.0.0" } }));
  assert.match(await editor("version", 1), /react must match SDK version/);
  verify(hash(await readFile(bundlePath)) === bundleHash, "Incompatible renderer version cannot replace the bundle");
  await writeFile(packagePath, JSON.stringify({ ...JSON.parse(originalPackage), dependencies: { "consumer-ui-lib": "1.0.0" } }));
  await writeFile(path.join(project, "ui", "library.d.ts"), 'declare module "consumer-ui-lib" { export function useMarker(): string; }\n');
  const libraryEntry = 'import { useMarker } from "consumer-ui-lib";\n' + originalEntry.replace('const root = useContext(RootTagContext);', 'const root = useContext(RootTagContext); const marker = useMarker();').replace('</View>;', '<Text testID="library-marker">{marker}</Text></View>;');
  await writeFile(entryPath, libraryEntry);
  assert.match(await editor("missing-dependency", 1), /Missing project dependency consumer-ui-lib/);
  verify(hash(await readFile(bundlePath)) === bundleHash, "An absent project library is diagnosed without implicit installation");
  const library = path.join(project, "node_modules", "consumer-ui-lib");
  await mkdir(path.join(library, "node_modules", "react"), { recursive: true });
  await writeFile(path.join(library, "package.json"), JSON.stringify({ name: "consumer-ui-lib", version: "1.0.0", main: "index.js" }));
  await writeFile(path.join(library, "index.js"), 'import React from "react"; export function useMarker() { return React.useState("Project library React identity")[0]; }\n');
  await writeFile(path.join(library, "node_modules", "react", "package.json"), '{"name":"react","version":"0.0.0","main":"index.js"}\n');
  await writeFile(path.join(library, "node_modules", "react", "index.js"), 'throw new Error("Wrong duplicated React selected");\n');
  await editor("project-library");
  const withLibrary = await runtime("project-library-native");
  verify(withLibrary.beforeStop.nodes.some(node => node.nativeText === "Project library React identity"), "An explicitly provided project library executes hooks with the SDK React identity");
  const libraryInputs = JSON.parse(await readFile(path.join(project, ".godot_fabric", "build-report.json"), "utf8")).inputs;
  verify(libraryInputs.includes("project/node_modules/consumer-ui-lib/index.js") && !libraryInputs.some(file => file.includes("consumer-ui-lib/node_modules/react")), "Library code is project-owned; duplicated React cannot enter the graph");

  // Exercise the normal provisioned builder, including inherited project paths.
  const baseConfigPath = path.join(project, "ui.base.json");
  const config = JSON.parse(originalConfig);
  const aliasOptions = {...config.compilerOptions, paths: {...config.compilerOptions.paths, "@ui/*": ["./ui/*"]}};
  await writeFile(baseConfigPath, JSON.stringify({compilerOptions: aliasOptions}));
  await writeFile(configPath, JSON.stringify({extends: "./ui.base.json", include: config.include}));
  const aliasEntry = originalEntry.replace('from "./store"', 'from "@ui/store"').replace('from "./platform"', 'from "@ui/platform"');
  await writeFile(entryPath, aliasEntry);
  await writeFile(packagePath, originalPackage);
  await editor("local-alias");
  const withAliases = await runtime("local-alias-native");
  verify(withAliases.beforeStop.bundleEvaluations === 1, "Inherited local aliases execute through one original React application");
  const aliasInputs = JSON.parse(await readFile(path.join(project, ".godot_fabric", "build-report.json"), "utf8")).inputs;
  verify(aliasInputs.includes("project/ui/store.ts") && aliasInputs.includes("project/ui/platform.godot.ts") && !aliasInputs.includes("project/ui/platform.native.ts"), "Local alias types and runtime select the same project Godot sources");
  if (capture) {
    await runtime("local-alias-graphical", true);
    for (const stage of ["initial", "updated", "resized"])
      await cp(path.join(project, `consumer-${stage}.png`), path.join(directory, "alias-" + stage + ".png"));
  }
  const aliasHash = hash(await readFile(bundlePath));
  const escapedPlatform = path.join(outside, "platform.ts");
  await writeFile(escapedPlatform, 'export const platformMessage = "Project TSX · Godot platform source";\n');
  for (const [label, target] of [["alias-outside", escapedPlatform], ["alias-symlink", "./ui/linked-platform.ts"]]) {
    if (label === "alias-symlink") await symlink(escapedPlatform, path.join(project, "ui/linked-platform.ts"));
    await writeFile(baseConfigPath, JSON.stringify({compilerOptions: {...aliasOptions, paths: {...aliasOptions.paths, "@ui/platform": [target]}}}));
    assert.match(await editor(label, 1), /E_PROJECT_ALIAS/);
    verify(hash(await readFile(bundlePath)) === aliasHash, label + " failure preserves the previous alias bundle");
  }
  await rm(path.join(project, "ui/linked-platform.ts"));
  await writeFile(baseConfigPath, JSON.stringify({compilerOptions: {...aliasOptions, moduleSuffixes: ["", ".godot", ".native"]}}));
  assert.match(await editor("suffix-divergence", 1), /E_PROJECT_SUFFIXES/);
  verify(hash(await readFile(bundlePath)) === aliasHash, "Divergent type/runtime suffix settings fail without publishing a mismatched bundle");
  await writeFile(path.join(project, "ui/fake-react.ts"), "export const unrelated = true;\n");
  await writeFile(baseConfigPath, JSON.stringify({compilerOptions: {...aliasOptions, paths: {...aliasOptions.paths, react: ["./ui/fake-react.ts"]}}}));
  assert.match(await editor("sdk-type-spoof", 1), /E_PROJECT_SDK_IDENTITY/);
  verify(hash(await readFile(bundlePath)) === aliasHash, "A project type alias cannot replace the SDK React identity");
  await rm(path.join(project, "ui/fake-react.ts"));
  await writeFile(configPath, originalConfig);
  await rm(baseConfigPath);

  const nestedHelper = path.join(library, "node_modules", "consumer-helper");
  await mkdir(nestedHelper, {recursive: true});
  await writeFile(path.join(nestedHelper, "package.json"), JSON.stringify({name: "consumer-helper", version: "1.0.0", main: "index.js"}));
  await writeFile(path.join(nestedHelper, "index.js"), 'exports.marker = "Nested helper · project SDK React identity";\n');
  await writeFile(path.join(library, "package.json"), JSON.stringify({name: "consumer-ui-lib", version: "1.0.0", main: "index.js", dependencies: {"consumer-helper": "1.0.0"}}));
  await writeFile(path.join(library, "index.js"), 'import React from "react"; import { marker } from "consumer-helper"; export function useMarker() { return React.useState(marker)[0]; }\n');
  await writeFile(packagePath, JSON.stringify({...JSON.parse(originalPackage), dependencies: {"consumer-ui-lib": "1.0.0"}}));
  await writeFile(entryPath, libraryEntry);
  await editor("nested-dependency");
  const nested = await runtime("nested-dependency-native");
  verify(nested.beforeStop.nodes.some(node => node.nativeText === "Nested helper · project SDK React identity"), "A declared transitive helper executes from its importing package without hoisting");
  const nestedInputs = JSON.parse(await readFile(path.join(project, ".godot_fabric", "build-report.json"), "utf8")).inputs;
  verify(nestedInputs.includes("project/node_modules/consumer-ui-lib/node_modules/consumer-helper/index.js") && !nestedInputs.some(file => file.includes("consumer-ui-lib/node_modules/react")), "Nested dependency ownership preserves the one SDK React instance");
  const nestedHash = hash(await readFile(bundlePath));
  await writeFile(path.join(project, "ui/library.d.ts"), 'declare module "consumer-ui-lib" { export function useMarker(): string; }\ndeclare module "consumer-helper" { export const marker: string; }\n');
  await writeFile(entryPath, 'import { marker as directMarker } from "consumer-helper";\n' + libraryEntry.replace('{marker}</Text>', '{marker + directMarker}</Text>'));
  assert.match(await editor("undeclared-direct-dependency", 1), /Declare consumer-helper in the project's dependencies/);
  verify(hash(await readFile(bundlePath)) === nestedHash, "A transitive package cannot silently become an undeclared direct app dependency");
  // A library's declarations and runtime keep its nested helper even when
  // the application uses that exact package spelling for a local source alias.
  await rm(path.join(project, "ui/library.d.ts"));
  await writeFile(path.join(nestedHelper, "package.json"), JSON.stringify({name: "consumer-helper", version: "1.0.0", main: "index.js", types: "index.d.ts"}));
  await writeFile(path.join(nestedHelper, "index.d.ts"), 'export declare const marker: "Nested helper · project SDK React identity";\n');
  await writeFile(path.join(library, "package.json"), JSON.stringify({name: "consumer-ui-lib", version: "1.0.0", main: "index.js", types: "index.d.ts", dependencies: {"consumer-helper": "1.0.0"}}));
  await writeFile(path.join(library, "index.d.ts"), 'import { marker } from "consumer-helper"; export declare function useMarker(): typeof marker;\n');
  await writeFile(path.join(project, "ui/helper.godot.ts"), 'export const marker = "Application alias marker" as const;\n');
  await writeFile(configPath, JSON.stringify({...config, compilerOptions: {...config.compilerOptions, paths: {...config.compilerOptions.paths, "consumer-helper": ["./ui/helper"]}}}));
  const collisionEntry = 'import { marker as appMarker } from "consumer-helper";\n' + libraryEntry
    .replace("flex: 1, padding: 20, gap: 10", "flex: 1, padding: 16, gap: 6")
    .replace('const marker = useMarker();', 'const marker = useMarker(); const typedLibrary: "Nested helper · project SDK React identity" = marker; const typedApp: "Application alias marker" = appMarker;')
    .replace('<Text testID="library-marker">{marker}</Text>', '<Text testID="library-marker" style={{color: "#a7f3d0", fontSize: 13}}>{typedLibrary}</Text><Text testID="application-alias-marker" style={{color: "#c4b5fd", fontSize: 13}}>{typedApp}</Text>');
  await writeFile(entryPath, collisionEntry);
  await editor("alias-package-coexistence");
  const coexistence = await runtime("alias-package-native");
  verify(["Application alias marker", "Nested helper · project SDK React identity"].every(text => coexistence.beforeStop.nodes.some(node => node.nativeText === text)), "App alias and identically named nested dependency retain distinct literal types and native text");
  const coexistenceInputs = JSON.parse(await readFile(path.join(project, ".godot_fabric", "build-report.json"), "utf8")).inputs;
  verify(coexistenceInputs.includes("project/ui/helper.godot.ts") && coexistenceInputs.includes("project/node_modules/consumer-ui-lib/node_modules/consumer-helper/index.js") && !coexistenceInputs.some(file => file.includes("consumer-ui-lib/node_modules/react")), "Both alias and package enter the graph while original SDK React remains unique");
  const coexistenceHash = hash(await readFile(bundlePath));
  await writeFile(entryPath, collisionEntry.replace('typedLibrary: "Nested helper · project SDK React identity"', 'typedLibrary: "Application alias marker"'));
  assert.match(await editor("alias-package-wrong-type", 1), /TypeScript failed[\s\S]*not assignable/);
  verify(hash(await readFile(bundlePath)) === coexistenceHash, "A wrong cross-scope literal type fails without replacing the valid coexistence bundle");
  await writeFile(entryPath, collisionEntry);
  if (capture) {
    await runtime("alias-package-graphical", true);
    for (const stage of ["initial", "updated", "resized"])
      await cp(path.join(project, `consumer-${stage}.png`), path.join(directory, "coexistence-" + stage + ".png"));
  }
  await writeFile(configPath, originalConfig);
  await rm(path.join(project, "ui/helper.godot.ts"));
  await writeFile(entryPath, originalEntry);
  await writeFile(packagePath, originalPackage);
  await editor("recovery");
  verify(hash(await readFile(lockPath)) === hash(originalLock), "Failure, dependency checks and recovery preserve the project lockfile");
  await cp(bundlePath, path.join(directory, "recovered-bundle.js"));
  verify(hash(await readFile(bundlePath)) === bundleHash, "The original consumer can build again after rejected requests");
  await writeFile(path.join(directory, "report.json"), JSON.stringify({ schemaVersion: 1, host: "macOS arm64", checks, nativeChecks, graphicalChecks: capture ? graphicalChecks : null }, null, 2) + "\n");
  console.log("CONSUMER_CHECK_PASSED: " + checks.length + " build/ownership checks; " + nativeChecks + " native checks");
} finally { await harness.cleanup(); }
