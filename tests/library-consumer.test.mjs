import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import vm from "node:vm";
import test from "node:test";
import { resolveNativeCompiler } from "../sdk/toolchain/native-compiler.mjs";
import { selectedAdapterInputs } from "../sdk/toolchain/adapter-plugin.mjs";
import { parseTailwindDeclaration, scanTailwindContent } from "../sdk/toolchain/tailwind-plugin.mjs";

// GF-27, JavaScript lane: the independent consumers/libraries project installs
// its own lockfile from the registry and is built, type-checked and bundled by
// the relocated SDK alone. The native lane (scripts/consumer-libraries-check.mjs)
// runs the same template in Godot.
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireRepository = createRequire(path.join(repository, "package.json"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const libraries = ["nativewind", "react-native-css-interop", "tailwindcss", "react-native-chart-kit", "react-native-svg"];

test("godotFabric.tailwind is closed JSON, and adapters stay the only selection", t => {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "godot-tailwind-declaration-")));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  const declared = parseTailwindDeclaration({ content: ["./ui/**/*.{ts,tsx}"], theme: { extend: { colors: { brand: "#059669" } } } });
  assert.deepEqual(declared.patterns, ["ui/**/*.{ts,tsx}"], "braces stay in the glob the SDK expands in the project");
  assert.equal(declared.darkMode, "media");
  assert.equal(parseTailwindDeclaration(undefined), undefined);
  for (const [name, value] of [
    ["an unknown field", { content: ["./ui/**"], plugins: [] }],
    ["a preset", { content: ["./ui/**"], presets: [] }],
    ["no content", { theme: {} }],
    ["empty content", { content: [] }],
    ["an absolute glob", { content: ["/etc/**"] }],
    ["a glob that leaves the project", { content: ["../outside/**"] }],
    ["a brace alternative that names a parent directory", { content: ["{..,ui}/**/*.tsx"] }],
    ["a brace alternative that names a parent directory after a path", { content: ["ui/{a,../../b}/**/*.tsx"] }],
    ["an absolute brace alternative", { content: ["{/etc,ui}/**/*.tsx"] }],
    ["a home directory", { content: ["~/ui/**"] }],
    ["a negated glob", { content: ["!ui/skip/**"] }],
    ["class dark mode", { content: ["./ui/**"], darkMode: "class" }],
    ["an array theme", { content: ["./ui/**"], theme: [] }],
    ["a non-object", "ui/**"],
  ]) assert.throws(() => parseTailwindDeclaration(value), /E_PROJECT_TAILWIND/, name);
  const config = { dependencies: {}, godotFabric: { tailwind: { content: ["./ui/**"] } } };
  assert.deepEqual(selectedAdapterInputs(project, config), [], "a tailwind declaration alone selects no adapter");
  assert.throws(() => selectedAdapterInputs(project, { godotFabric: { tailwind: { content: ["./ui/**"] }, other: true } }), /E_ADAPTER_SELECTION/);
  assert.throws(() => selectedAdapterInputs(project, { godotFabric: { adapters: "x" } }), /E_ADAPTER_SELECTION/);
});

test("the SDK owns the content scan: braces expand inside the project and nothing outside it is read", t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "godot-tailwind-scan-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, "project"), outside = path.join(root, "outside");
  const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
  write(path.join(project, "ui/a.tsx"), "export const a = 'p-4';\n");
  write(path.join(project, "ui/b.ts"), "export const b = 'gap-2';\n");
  write(path.join(project, "ui/deep/d.tsx"), "export const d = 'rounded-lg';\n");
  write(path.join(project, "ui/notes.md"), "p-8\n");
  write(path.join(outside, "secret.tsx"), "export const secret = 'bg-[#123456]';\n");
  write(path.join(outside, "dir/more.tsx"), "export const more = 'bg-[#654321]';\n");
  const scan = patterns => scanTailwindContent(project, patterns);
  const names = patterns => scan(patterns).map(entry => entry.file);

  // The valid brace pattern still works, and the scan hands over the files' text.
  const braced = scan(parseTailwindDeclaration({ content: ["./ui/**/*.{ts,tsx}"] }).patterns);
  assert.deepEqual(braced.map(entry => entry.file), ["ui/a.tsx", "ui/b.ts", "ui/deep/d.tsx"]);
  assert.deepEqual(braced.map(entry => entry.extension), ["tsx", "ts", "tsx"]);
  assert.equal(braced[0].raw, "export const a = 'p-4';\n");
  assert.deepEqual(names(["ui/{a,b}.*", "ui/deep/*.tsx"]), ["ui/a.tsx", "ui/b.ts", "ui/deep/d.tsx"], "alternatives expand inside the project");
  assert.throws(() => names(["ui/nothing/**/*.tsx"]), /E_PROJECT_TAILWIND: .*matched no file/);

  // A symbolic link that stays inside the project is read once, whatever its name.
  fs.symlinkSync(path.join(project, "ui/a.tsx"), path.join(project, "ui/alias.tsx"));
  assert.deepEqual(names(["ui/*.tsx"]), ["ui/a.tsx"], "a link to a file of the project duplicates nothing");
  fs.rmSync(path.join(project, "ui/alias.tsx"));

  // Nothing outside is read, not even when a link reaches it: the build fails and names the link.
  const reads = [];
  const readFileSync = fs.readFileSync;
  fs.readFileSync = function (file, ...rest) { reads.push(String(file)); return readFileSync.call(this, file, ...rest); };
  try {
    fs.symlinkSync(path.join(outside, "secret.tsx"), path.join(project, "ui/link.tsx"));
    assert.throws(() => names(["ui/**/*.{ts,tsx}"]), /E_PROJECT_TAILWIND: .*ui\/link\.tsx, a symbolic link that leaves the project/);
    fs.rmSync(path.join(project, "ui/link.tsx"));
    fs.symlinkSync(outside + "/dir", path.join(project, "ui/linked"));
    assert.throws(() => names(["ui/**/*.{ts,tsx}"]), /E_PROJECT_TAILWIND: .*ui\/linked, a symbolic link that leaves the project/);
    fs.rmSync(path.join(project, "ui/linked"));
    fs.symlinkSync(outside, path.join(project, "escape"));
    assert.throws(() => names(["escape/**/*.tsx"]), /E_PROJECT_TAILWIND: .*escape, a symbolic link that leaves the project/);
  } finally { fs.readFileSync = readFileSync; }
  assert.deepEqual(reads.filter(file => file.startsWith(outside) || file.includes("secret.tsx") || file.includes("more.tsx")), [],
    "no file outside the project was read while the scan refused the links");
  fs.rmSync(path.join(project, "escape"));
  assert.deepEqual(names(["ui/**/*.{ts,tsx}"]), ["ui/a.tsx", "ui/b.ts", "ui/deep/d.tsx"], "the scan recovers once the links are gone");
});

test("the libraries consumer builds, type-checks and bundles through the relocated SDK alone", async t => {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "godot-libraries-consumer-")));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  fs.cpSync(path.join(repository, "consumers/libraries"), project, { recursive: true });
  const sdk = path.join(project, "addons/godot_fabric");
  for (const [from, to] of [["sdk/toolchain", "toolchain"], ["src", "src"], ["types", "types"], ["node_modules", "toolchain/node_modules"]])
    fs.cpSync(path.join(repository, from), path.join(sdk, to), { recursive: true, mode: fs.constants.COPYFILE_FICLONE });
  fs.copyFileSync(path.join(repository, "package.json"), path.join(sdk, "toolchain/package.json"));
  const typeFile = path.join(sdk, "types/react-native.ts");
  fs.writeFileSync(typeFile, fs.readFileSync(typeFile, "utf8").replace("../node_modules/", "../toolchain/node_modules/"));
  const compiler = resolveNativeCompiler({ resolvePackage: createRequire(path.join(sdk, "toolchain/package.json")).resolve });
  const sourcePackage = readJson(path.join(repository, "package.json"));
  fs.writeFileSync(path.join(sdk, "manifest.json"), JSON.stringify({ node: process.version.slice(1), react: sourcePackage.dependencies.react,
    "react-native": sourcePackage.dependencies["react-native"], sourceCommit: "library-consumer-test-fixture",
    typeChecker: { name: "tsc-rs", version: compiler.packageVersion, typescriptVersion: compiler.typescriptVersion,
      platformPackage: compiler.platformPackage, executableSha256: hash(fs.readFileSync(compiler.executable)) } }));

  // The consumer installs from its own lockfile; no peer of its libraries is installed.
  const install = spawnSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: project, encoding: "utf8", timeout: 300000 });
  assert.equal(install.status, 0, install.stdout + install.stderr);
  const lock = readJson(path.join(project, "package-lock.json"));
  const installed = {};
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (!key.startsWith("node_modules/")) {
      continue;
    }
    const manifest = path.join(project, key, "package.json");
    // Optional platform packages of other systems are in the lock and not on disk.
    if (!fs.existsSync(manifest)) {
      continue;
    }
    installed[key.slice("node_modules/".length)] = readJson(manifest).version;
    assert.equal(installed[key.slice("node_modules/".length)], entry.version, `${key} installs the locked version`);
  }
  assert.deepEqual(libraries.map(name => installed[name]), ["4.2.7", "0.2.7", "3.4.17", "7.0.4", "15.15.5"]);
  for (const name of ["react", "react-native", "react-native-reanimated", "react-native-safe-area-context"])
    assert.equal(fs.existsSync(path.join(project, "node_modules", name)), false, `${name} stays out of the consumer: the SDK owns it or fronts it`);
  // The SDK compiles styles with the releases the consumer installed.
  for (const name of ["nativewind", "react-native-css-interop", "tailwindcss"])
    assert.equal(requireRepository(name + "/package.json").version, installed[name], `${name} equals the SDK's own copy`);

  const bundle = path.join(project, ".godot_fabric/app.js");
  const build = () => spawnSync(process.execPath, [path.join(sdk, "toolchain/build.mjs"), project, "res://ui/index.tsx", "res://.godot_fabric/app.js"],
    { cwd: project, encoding: "utf8", timeout: 120000, env: { ...process.env, PATH: "" } });
  const result = build();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /GODOT_FABRIC_BUILT/);
  const bundleHash = hash(fs.readFileSync(bundle));
  const report = readJson(path.join(project, ".godot_fabric/build-report.json"));
  const reject = (pattern, name) => {
    const failed = build();
    assert.equal(failed.status, 1, name + ": " + failed.stdout + failed.stderr);
    assert.match(failed.stderr, pattern, name);
    assert.equal(hash(fs.readFileSync(bundle)), bundleHash, name + " preserves the valid bundle");
  };
  const edit = (file, change) => {
    const filename = path.join(project, file);
    const original = fs.readFileSync(filename);
    fs.writeFileSync(filename, change(original.toString("utf8")));
    return () => fs.writeFileSync(filename, original);
  };

  await t.test("the bundle holds the original native interop and the SDK's SVG facade, and nothing of the laboratory", () => {
    assert.equal(report.sha256, bundleHash);
    const inputs = report.inputs;
    const allowed = file => /^sdk\/(?:src|toolchain\/node_modules)\//.test(file) || /^project\/(?:ui\/|global\.css$|node_modules\/)/.test(file);
    assert.deepEqual(inputs.filter(file => !allowed(file)), [],
      "only the consumer's ui, its CSS entry, its installed packages and the SDK's own sources and packages enter");
    assert.equal(inputs.some(file => /(?:^|\/)examples\//.test(file) || file.startsWith("project/src/")), false);
    for (const required of ["project/ui/index.tsx", "project/ui/App.tsx", "project/global.css", "project/ui/swatch.png",
      "project/node_modules/nativewind/jsx-runtime/index.js",
      "project/node_modules/react-native-css-interop/dist/runtime/jsx-runtime.js",
      "project/node_modules/react-native-css-interop/dist/runtime/api.native.js",
      "project/node_modules/react-native-css-interop/dist/runtime/native/native-interop.js",
      "project/node_modules/react-native-css-interop/dist/doctor.native.js",
      "project/node_modules/react-native-chart-kit/dist/v2/index.js", "sdk/src/svg.jsx"])
      assert.ok(inputs.includes(required), "missing " + required);
    assert.equal(inputs.some(file => file.includes("react-native-css-interop/dist/runtime/web/")), false, "the web interop runtime stays out");
    assert.equal(inputs.some(file => file.includes("node_modules/react-native-svg/")), false, "no upstream react-native-svg file enters");
    assert.equal(inputs.some(file => /node_modules\/react-native-(?:safe-area-context|reanimated)\//.test(file)), false,
      "the optional peers are fronted by the SDK's facades and not installed");
    assert.deepEqual(report.assets, { path: ".godot_fabric/app.js.assets.json", files: 1 });
  });

  await t.test("the build report records the style step and the exact releases", () => {
    assert.deepEqual({ ...report.styles, rules: undefined, compiledSha256: undefined }, {
      entry: "global.css", content: ["./ui/**/*.{ts,tsx}"], contentFiles: 4, darkMode: "media", rules: undefined, compiledSha256: undefined,
      nativewindOs: "godot", inlineRem: 14, tailwind: "3.4.17", nativewind: "4.2.7", reactNativeCssInterop: "0.2.7",
    });
    assert.ok(report.styles.rules > 40 && /^[0-9a-f]{64}$/.test(report.styles.compiledSha256));
  });

  await t.test("the compiled styles register with the one interop runtime and answer every class the consumer uses", () => {
    const code = fs.readFileSync(bundle, "utf8");
    const calls = [...code.matchAll(/registerCompiled\(\s*\{/g)];
    assert.equal(calls.length, 1, "styles register once, with a literal the builder compiled");
    const start = calls[0].index + calls[0][0].length - 1;
    // Babel prints the object as JavaScript; read the balanced literal back, skipping braces inside strings.
    let depth = 0, end = start, quote = null;
    for (; end < code.length; end++) {
      const char = code[end];
      if (quote) {
        if (char === "\\") {
          end++;
        } else if (char === quote) {
          quote = null;
        }
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
      } else if (char === "{") {
        depth++;
      } else if (char === "}" && --depth === 0) {
        break;
      }
    }
    const compiled = vm.runInNewContext("(" + code.slice(start, end + 1) + ")");
    assert.equal(compiled.rem, 14);
    for (const name of ["bg-slate-100", "dark:bg-slate-900", "bg-brand-600", "border-brand-400", "active:bg-blue-400", "rounded-xl", "text-2xl", "w-[420px]", "animate-spin"])
      assert.ok(compiled.rules[name], "the compiled styles hold " + name);
    assert.ok(compiled.rules["dark:bg-slate-900"].n.some(rule => rule.media), "dark: compiles to a media rule the interop evaluates against Appearance");
    assert.equal(compiled.rules["active:bg-blue-400"].active, true);
  });

  await t.test("the same inputs build the same bundle", () => {
    const again = build();
    assert.equal(again.status, 0, again.stdout + again.stderr);
    assert.equal(hash(fs.readFileSync(bundle)), bundleHash);
  });

  await t.test("a missing optional peer does not fail the build, and the SDK's facade is the control that proves it", () => {
    // The consumer never installs react-native-safe-area-context, which css-interop lists only in peerDependenciesMeta.
    assert.equal(fs.existsSync(path.join(project, "node_modules/react-native-safe-area-context")), false);
    const resolution = path.join(sdk, "toolchain/project-resolution.mjs");
    const original = fs.readFileSync(resolution);
    try {
      const sabotaged = original.toString("utf8").replace("      || owner.manifest.peerDependenciesMeta?.[name]?.optional === true;", "      ;");
      assert.notEqual(sabotaged, original.toString("utf8"), "the optional-peer rule is present to remove");
      fs.writeFileSync(resolution, sabotaged);
      reject(/E_PROJECT_DEPENDENCY: react-native-safe-area-context: undeclared import in react-native-css-interop dependencies/, "without the optional-peer rule");
    } finally { fs.writeFileSync(resolution, original); }
  });

  await t.test("a tailwind.config.js is refused and names the declarative field", () => {
    fs.writeFileSync(path.join(project, "tailwind.config.js"), "module.exports = { content: [] };\n");
    try { reject(/E_PROJECT_TAILWIND_CONFIG[\s\S]*godotFabric\.tailwind/, "tailwind.config.js"); }
    finally { fs.rmSync(path.join(project, "tailwind.config.js")); }
  });

  await t.test("CSS other than the Tailwind entry is still refused", () => {
    fs.writeFileSync(path.join(project, "ui/plain.css"), ".plain { color: red; }\n");
    const restore = edit("ui/index.tsx", source => 'import "./plain.css";\n' + source);
    try { reject(/E_PROJECT_CSS: ui\/plain\.css: only a Tailwind entry/, "plain CSS"); }
    finally { restore(); fs.rmSync(path.join(project, "ui/plain.css")); }
    fs.writeFileSync(path.join(project, "ui/imports.css"), '@import "./plain.css";\n@tailwind utilities;\n');
    const restoreImport = edit("ui/index.tsx", source => source.replace("../global.css", "./imports.css"));
    try { reject(/E_PROJECT_CSS: ui\/imports\.css/, "@import in the Tailwind entry"); }
    finally { restoreImport(); fs.rmSync(path.join(project, "ui/imports.css")); }
  });

  await t.test("the Tailwind declaration must exist, stay inside its fields and name only project globs", () => {
    for (const [name, change, pattern] of [
      ["a missing declaration", manifest => { delete manifest.godotFabric; }, /E_PROJECT_TAILWIND: global\.css: declare the Tailwind configuration/],
      ["a plugins field", manifest => { manifest.godotFabric.tailwind.plugins = []; }, /E_PROJECT_TAILWIND: godotFabric\.tailwind accepts only content, darkMode and theme/],
      ["a glob outside the project", manifest => { manifest.godotFabric.tailwind.content = ["../outside/**"]; }, /E_PROJECT_TAILWIND: .*must stay inside the project/],
    ]) {
      const restore = edit("package.json", source => { const manifest = JSON.parse(source); change(manifest); return JSON.stringify(manifest); });
      try { reject(pattern, name); } finally { restore(); }
    }
  });

  await t.test("the content scan stays inside the project: braces cannot leave it, a link cannot lead out, and valid braces still build", () => {
    const content = globs => source => { const manifest = JSON.parse(source); manifest.godotFabric.tailwind.content = globs; return JSON.stringify(manifest); };
    for (const [name, globs, pattern] of [
      ["a brace alternative with ..", ["{../outside,ui}/**/*.tsx"], /E_PROJECT_TAILWIND: godotFabric\.tailwind\.content "\{\.\.\/outside,ui\}\/\*\*\/\*\.tsx" must stay inside the project/],
      ["a bare brace alternative with ..", ["{..,ui}/**/*.tsx"], /E_PROJECT_TAILWIND: .*must stay inside the project/],
      ["an absolute brace alternative", ["{/etc,ui}/**/*.tsx"], /E_PROJECT_TAILWIND: .*must stay inside the project/],
    ]) {
      const restore = edit("package.json", content(globs));
      try { reject(pattern, name); } finally { restore(); }
    }
    // A symbolic link inside the project that leads out of it: the file is never read, and the build names the link.
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "godot-tailwind-outside-")));
    try {
      fs.writeFileSync(path.join(outside, "secret.tsx"), "export const secret = 'bg-[#123456]';\n");
      fs.mkdirSync(path.join(outside, "dir"));
      fs.writeFileSync(path.join(outside, "dir/more.tsx"), "export const more = 'bg-[#654321]';\n");
      for (const [name, target, link] of [["a symlinked file", "secret.tsx", "ui/escape.tsx"], ["a symlinked directory", "dir", "ui/escaped"]]) {
        fs.symlinkSync(path.join(outside, target), path.join(project, link));
        try { reject(new RegExp(`E_PROJECT_TAILWIND: .*${link.replace(".", "\\.")}, a symbolic link that leaves the project`), name); }
        finally { fs.rmSync(path.join(project, link)); }
      }
    } finally { fs.rmSync(outside, { recursive: true, force: true }); }
    // Valid braces, and two globs that reach the same files: the same files reach Tailwind, so the bundle is the same.
    const restore = edit("package.json", content(["./ui/**/*.{ts,tsx}", "./ui/{App,index}.tsx"]));
    try {
      const braced = build();
      assert.equal(braced.status, 0, braced.stdout + braced.stderr);
      assert.equal(hash(fs.readFileSync(bundle)), bundleHash, "brace alternatives that name the same files give the same bundle");
      assert.equal(readJson(path.join(project, ".godot_fabric/build-report.json")).styles.contentFiles, 4);
    } finally { restore(); }
  });

  await t.test("the installed interop must be the release the SDK compiles with", () => {
    const manifest = path.join(project, "node_modules/react-native-css-interop/package.json");
    const original = fs.readFileSync(manifest);
    try {
      fs.writeFileSync(manifest, original.toString("utf8").replace('"version": "0.2.7"', '"version": "0.2.6"'));
      reject(/E_PROJECT_NATIVEWIND_VERSION: react-native-css-interop 0\.2\.6 is installed but the SDK compiles styles with 0\.2\.7/, "css-interop 0.2.6");
    } finally { fs.writeFileSync(manifest, original); }
  });

  await t.test("className is a type error until the project opts in, and only for the four certified components", () => {
    const withoutOptIn = edit("tsconfig.json", source => source.replace(', "addons/godot_fabric/types/nativewind.ts"', ""));
    try { reject(/TypeScript failed[\s\S]*className/, "no opt-in"); } finally { withoutOptIn(); }
    for (const [name, element] of [["TextInput", '<TextInput className="p-2" />'], ["Switch", '<Switch className="p-2" />'],
      ["ActivityIndicator", '<ActivityIndicator className="p-2" />'], ["Button", '<Button title="x" className="p-2" />']]) {
      const restore = edit("ui/App.tsx", source => source.replace('from "react-native";', 'from "react-native";\nimport { ActivityIndicator, Button, Switch, TextInput } from "react-native";')
        .replace("      <View testID=\"lib-panel\"", `      ${element}\n      <View testID="lib-panel"`));
      try { reject(new RegExp(`TypeScript failed[\\s\\S]*className`), name + " className"); } finally { restore(); }
    }
    const unsupportedStyle = edit("ui/App.tsx", source => source.replace('testID="lib-image"', 'testID="lib-image" accessibilityLabel="x" blurRadius={2} fadeDuration="slow"'));
    try { reject(/TypeScript failed/, "an Image prop outside the type surface"); } finally { unsupportedStyle(); }
  });

  await t.test("the consumer builds again after every rejected request", () => {
    const recovered = build();
    assert.equal(recovered.status, 0, recovered.stdout + recovered.stderr);
    assert.equal(hash(fs.readFileSync(bundle)), bundleHash);
    assert.equal(fs.existsSync(path.join(project, "ui/index.js")), false);
  });
});
