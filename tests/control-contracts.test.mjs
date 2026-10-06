import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateButton, validateInput, validateSelection } from "../src/control-contracts.mjs";
import { listOnlyProps } from "../src/list-props.mjs";

test("public control contracts accept documented RN props", () => {
  assert.doesNotThrow(() => validateButton({ title: "Save", disabled: false, color: "#2563eb", onPress() {} }));
  assert.doesNotThrow(() => validateInput({ value: "A😀B", selection: { start: 1, end: 3 }, editable: true,
    submitBehavior: "submit", onChangeText() {}, multiline: false }));
  assert.doesNotThrow(() => validateInput({ defaultValue: "", placeholder: "Name", autoFocus: true }));
});
test("mobile, accessibility and legacy aliases fail visibly rather than disappear", () => {
  for (const property of ["accessibilityLabel", "secureTextEntry", "keyboardType", "text", "disabled", "children"])
    assert.throws(() => validateInput({ [property]: "unsupported" }), /does not implement prop/);
  for (const property of ["accessibilityLabel", "onActivate", "text", "style"])
    assert.throws(() => validateButton({ title: "Save", [property]: "unsupported" }), /does not implement prop/);
  assert.throws(() => validateInput({ multiline: true }), /one line/);
  assert.throws(() => validateInput({ submitBehavior: "newline" }), /submit or blurAndSubmit/);
});
test("wrong values and invalid UTF-16 selections are rejected", () => {
  for (const props of [{ title: 4 }, { title: "Save", color: 123 }, { title: "Save", onPress: true }, { title: "Save", disabled: "true" }])
    assert.throws(() => validateButton(props));
  for (const props of [{ value: 123 }, { value: "first\nsecond" }, { editable: 1 }, { onChangeText: "callback" }, { selection: { start: -1 } }, { selection: null }, { selection: 2 }])
    assert.throws(() => validateInput(props));
  for (const [start, end] of [[2, 1], [0.5, 2], [0, NaN]])
    assert.throws(() => validateSelection(start, end), /UTF-16/);
});

test("the SDK ScrollView drops exactly the list props that RN's ScrollViewProps lacks", () => {
  // VirtualizedList spreads every list prop onto its ScrollView. The pinned
  // inventory decides which ones belong to the lists; the rest stay strict.
  const inventory = JSON.parse(readFileSync(new URL("../docs/compatibility/contracts-0.87.1.json", import.meta.url), "utf8"));
  const names = owner => inventory.contracts.filter(row => row.owner === owner).map(row => row.name);
  const scrollView = new Set(names("ScrollViewProps"));
  const lists = ["VirtualizedListProps", "FlatListProps", "SectionListProps", "VirtualizedSectionListProps"].flatMap(names);
  assert.deepEqual([...listOnlyProps].sort(), [...new Set(lists.filter(name => !scrollView.has(name)))].sort());
});

test("bundled TSX consumer uses the original renderer and Godot public controls", async () => {
  const { readFile } = await import("node:fs/promises");
  const inputs = JSON.parse(await readFile(new URL("../build/bundle-inputs.json", import.meta.url), "utf8"));
  for (const suffix of ["examples/form/App.tsx", "src/react-native-platform.jsx", "src/public-input.jsx",
    "node_modules/react-native/Libraries/Renderer/implementations/ReactFabric-prod.js"])
    assert.ok(inputs.some(input => input.endsWith(suffix)), suffix);
  assert.equal(inputs.some(input => /Components\/TextInput\/TextInput\.js$/.test(input)), false);
  assert.equal(inputs.some(input => /(?:react-dom|react-native-web)\//.test(input)), false);
});

test("Godot/native/generic module precedence agrees in the bundler and strict types", async () => {
  const { build } = await import("esbuild");
  const ts = (await import("typescript")).default;
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const { join } = await import("node:path");
  const { godotExtensions } = await import("../scripts/platform-resolution.mjs");
  const root = fileURLToPath(new URL("..", import.meta.url));
  await mkdir(join(root, "build"), { recursive: true });
  const directory = await mkdtemp(join(root, "build", "resolution-"));
  try {
    const consumer = join(directory, "consumer.ts");
    const configuration = ts.readConfigFile(join(root, "tsconfig.godot.json"), ts.sys.readFile);
    assert.equal(configuration.error, undefined);
    const parsed = ts.parseJsonConfigFileContent(configuration.config, ts.sys, root);
    assert.deepEqual(parsed.errors, []);
    for (const { files, platforms } of [
      { files: ["module.godot.tsx", "module.native.tsx", "module.tsx"], platforms: ["godot", "native", "generic"] },
      // TypeScript prefers .ts over .tsx before considering platform suffixes.
      { files: ["module.native.ts", "module.godot.tsx", "module.tsx"], platforms: ["native", "godot", "generic"] },
    ]) {
      for (let index = 0; index < files.length; index++)
        await writeFile(join(directory, files[index]), `export const platform = "${platforms[index]}";`);
      for (const [index, platform] of platforms.entries()) {
        await writeFile(consumer, `import { platform } from "./module"; const expected: "${platform}" = platform;`);
        const bundled = await build({ entryPoints: [consumer], bundle: true, write: false, metafile: true,
          resolveExtensions: godotExtensions, format: "esm" });
        assert.ok(Object.keys(bundled.metafile.inputs).some(input => input.endsWith(files[index])));
        const program = ts.createProgram([consumer], parsed.options);
        assert.deepEqual(ts.getPreEmitDiagnostics(program).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")), []);
        await rm(join(directory, files[index]));
      }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
