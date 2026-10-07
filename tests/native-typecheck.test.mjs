import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import {resolveNativeCompiler} from "../sdk/toolchain/native-compiler.mjs";
import {checkNativeTypes} from "../sdk/toolchain/native-typecheck.mjs";

function fixture(t, source, compilerOptions = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "godot-native-typecheck-"));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const filename = path.join(root, "index.ts");
  fs.writeFileSync(filename, source);
  const options = {strict: true, noEmit: true, target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    ...compilerOptions};
  return {root, filename, source, options};
}

function run(f) {
  return checkNativeTypes({rootFiles: [f.filename], compilerOptions: f.options,
    resolveModuleName: () => undefined});
}

test("native checker reports semantic diagnostics at UTF-16 source positions", t => {
  const source = "const marker = '😀';\nconst value: string = 123;\n";
  const f = fixture(t, source);
  const result = run(f);
  assert.equal(result.errorCount, 1);
  const diagnostic = result.diagnostics.find(item => item.code === 2322);
  assert.ok(diagnostic, "expected the native checker to report TS2322");
  // tsc-rs reports the assignment diagnostic at the declared variable name.
  // The preceding astral character makes this absolute offset distinguish
  // UTF-16 code units from UTF-8 bytes and Unicode code points.
  const expected = source.indexOf("value");
  assert.equal(diagnostic.fileName, f.filename);
  assert.equal(diagnostic.start, expected);
  assert.equal(diagnostic.pos, expected);
  assert.deepEqual(diagnostic.startPosition, {line: 1, character: 6});
  assert.match(typeof diagnostic.messageText === "string" ? diagnostic.messageText
    : ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"), /number.*string|Type 'number' is not assignable/);
  assert.equal(fs.existsSync(path.join(f.root, "index.js")), false);
});

test("native checker reports parse failures without running TypeScript's JavaScript checker", t => {
  const f = fixture(t, "export const broken = ;\n");
  const result = run(f);
  assert.ok(result.errorCount > 0);
  assert.ok(result.diagnostics.some(item => item.category === ts.DiagnosticCategory.Error
    && item.code === 1109), "expected a native syntax diagnostic");
  assert.equal(fs.existsSync(path.join(f.root, "index.js")), false);
});

test("native checker refuses effective compiler options outside its supported profile", t => {
  const f = fixture(t, "export const value = 1;", {unrecognizedProjectOption: true});
  assert.throws(() => run(f), /E_NATIVE_TYPECHECK:.*unrecognizedProjectOption/);
});

test("native checker only classifies missing compiler binaries as compiler unavailable", t => {
  const source = "import value from './missing';\nexport {value};\n";
  for (const message of ["Module not found: ./missing", "Source file not found: ./missing"]) {
    const f = fixture(t, source);
    const expected = new Error(message);
    assert.throws(() => checkNativeTypes({rootFiles: [f.filename], compilerOptions: f.options,
      resolveModuleName: () => { throw expected; } }), error => error.message.includes(message)
        && !error.message.includes("native compiler is unavailable"),
    `expected ${message} to retain its general classification`);
  }

  for (const message of ["Unable to resolve @tsc-rs/darwin-arm64", "Executable not found: tsc",
    "spawn tsc ENOENT"]) {
    const f = fixture(t, source);
    assert.throws(() => checkNativeTypes({rootFiles: [f.filename], compilerOptions: f.options,
      resolveModuleName: () => { throw new Error(message); }}),
    error => error.message.startsWith("E_NATIVE_TYPECHECK: tsc-rs@0.1.0 native compiler is unavailable"),
    `expected ${message} to remain actionable`);
  }
});

test("native checker reports a removed TypeScript option instead of silently dropping it", t => {
  const f = fixture(t, "export const value = 1;", {allowSyntheticDefaultImports: false});
  const result = run(f);
  const diagnostic = result.diagnostics.find(item => item.code === 5108);
  assert.ok(diagnostic, "expected the native compiler's removed-option diagnostic TS5108");
  assert.match(diagnostic.text, /removed/i);
  assert.ok(result.errorCount > 0);
});

test("native binder diagnostics are deduplicated across diagnostic passes", t => {
  const f = fixture(t, "const duplicate = 1;\nconst duplicate = 2;\n");
  const result = run(f);
  const duplicates = result.diagnostics.filter(item => item.code === 2451);
  assert.equal(duplicates.length, 2, "one duplicate declaration diagnostic should remain at each location");
});

test("native compiler resolution validates platform, pinned package versions, and executable", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "godot-native-compiler-"));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const writePackage = (name, manifest) => {
    const directory = path.join(root, "node_modules", name);
    fs.mkdirSync(path.join(directory, "lib"), {recursive: true});
    fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify(manifest));
    return directory;
  };
  const resolvePackage = specifier => {
    const filename = path.join(root, "node_modules", specifier);
    if (!fs.existsSync(filename)) throw new Error(`Cannot find ${specifier}`);
    return filename;
  };
  writePackage("tsc-rs", {version: "0.1.0", tscVersion: "7.0.0-dev"});
  const platformRoot = writePackage("@tsc-rs/darwin-arm64", {version: "0.1.0"});
  const executable = path.join(platformRoot, "lib/tsc");
  fs.writeFileSync(executable, "compiler fixture");
  fs.chmodSync(executable, 0o755);
  assert.deepEqual(resolveNativeCompiler({resolvePackage, platform: "darwin", architecture: "arm64"}), {
    executable, packageVersion: "0.1.0", typescriptVersion: "7.0.0-dev",
    platformPackage: "@tsc-rs/darwin-arm64",
  });
  assert.throws(() => resolveNativeCompiler({resolvePackage, platform: "win32", architecture: "x64"}),
    /E_TYPESCRIPT_COMPILER:.*does not support win32-x64/);
  assert.throws(() => resolveNativeCompiler({resolvePackage: specifier => {
    if (specifier === "@tsc-rs/darwin-arm64/package.json") throw new Error("missing optional package");
    return resolvePackage(specifier);
  }, platform: "darwin", architecture: "arm64"}), /E_TYPESCRIPT_COMPILER:.*optional dependencies/);
  fs.writeFileSync(path.join(platformRoot, "package.json"), JSON.stringify({version: "0.2.0"}));
  assert.throws(() => resolveNativeCompiler({resolvePackage, platform: "darwin", architecture: "arm64"}),
    /E_TYPESCRIPT_COMPILER:.*expected tsc-rs and @tsc-rs\/darwin-arm64 0\.1\.0/);
  fs.writeFileSync(path.join(platformRoot, "package.json"), JSON.stringify({version: "0.1.0"}));
  fs.chmodSync(executable, 0o644);
  assert.throws(() => resolveNativeCompiler({resolvePackage, platform: "darwin", architecture: "arm64"}),
    /E_TYPESCRIPT_COMPILER:.*not executable/);
});
