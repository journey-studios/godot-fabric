import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import test from "node:test";
import {resolveNativeCompiler} from "../sdk/toolchain/native-compiler.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

test("a relocated consumer builds with its copied native checker and preserves its bundle on failures", async t => {
  // Exercise the JS builder without claiming a native host, editor or runtime build.
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-native-checker-consumer-")));
  t.after(() => fs.rmSync(project, {recursive: true, force: true}));
  fs.cpSync(path.join(repository, "consumers/minimal"), project, {recursive: true});
  const sdk = path.join(project, "addons/godot_fabric");
  for (const [from, to] of [["sdk/toolchain", "toolchain"], ["src", "src"], ["types", "types"],
    ["node_modules", "toolchain/node_modules"]])
    fs.cpSync(path.join(repository, from), path.join(sdk, to),
      {recursive: true, mode: fs.constants.COPYFILE_FICLONE});
  fs.copyFileSync(path.join(repository, "package.json"), path.join(sdk, "toolchain/package.json"));
  const typeFile = path.join(sdk, "types/react-native.ts");
  fs.writeFileSync(typeFile, fs.readFileSync(typeFile, "utf8").replace("../node_modules/", "../toolchain/node_modules/"));
  const compiler = resolveNativeCompiler({resolvePackage: createRequire(path.join(sdk, "toolchain/package.json")).resolve});
  assert.ok(compiler.executable.startsWith(sdk + path.sep), "the executable must come from the copied SDK");
  const sourcePackage = JSON.parse(fs.readFileSync(path.join(repository, "package.json")));
  const manifest = {node: process.version.slice(1), react: sourcePackage.dependencies.react,
    "react-native": sourcePackage.dependencies["react-native"], sourceCommit: "checker-test-fixture",
    typeChecker: {name: "tsc-rs", version: compiler.packageVersion,
      typescriptVersion: compiler.typescriptVersion, platformPackage: compiler.platformPackage,
      executableSha256: hash(fs.readFileSync(compiler.executable))}};
  const manifestFile = path.join(sdk, "manifest.json");
  const saveManifest = value => fs.writeFileSync(manifestFile, JSON.stringify(value));
  saveManifest(manifest);
  const entry = path.join(project, "ui/index.tsx");
  let source = fs.readFileSync(entry, "utf8");
  source = source.replace("import { AppRegistry, RootTagContext, View, Text, Button, TextInput } from \"react-native\";",
    "import { AppRegistry, RootTagContext, View, Text, Button, TextInput, Modal, SafeAreaView } from \"react-native\";")
    .replace("  </View>;\n}\nAppRegistry.registerComponent",
      "    <Modal visible={false} transparent animationType=\"none\" presentationStyle=\"overFullScreen\" backdropColor=\"#101820\" testID=\"consumer-modal\" onShow={() => {}} onRequestClose={() => {}}><SafeAreaView testID=\"consumer-safe-area\" /></Modal>\n  </View>;\n}\nAppRegistry.registerComponent");
  fs.writeFileSync(entry, source);
  const bundle = path.join(project, ".godot_fabric/app.js");
  const build = () => spawnSync(process.execPath,
    [path.join(sdk, "toolchain/build.mjs"), project, "res://ui/index.tsx", "res://.godot_fabric/app.js"],
    {cwd: project, encoding: "utf8", timeout: 30000, env: {...process.env, PATH: ""}});
  const result = build();
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const expectedHash = hash(fs.readFileSync(bundle));
  const report = JSON.parse(fs.readFileSync(path.join(project, ".godot_fabric/build-report.json")));
  assert.deepEqual(report.typeChecker, {name: "tsc-rs", version: "0.1.0", typescriptVersion: "7.1.0-dev"});
  assert.equal(report.sha256, expectedHash);

  const reject = pattern => {
    const failed = build();
    assert.equal(failed.error, undefined);
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, pattern);
    assert.equal(hash(fs.readFileSync(bundle)), expectedHash, "a rejected build must preserve the valid bundle");
  };
  await t.test("the relocated public RN entry accepts the supported Modal and SafeAreaView contract", () => {
    assert.match(source, /Modal visible=\{false\}[^>]*presentationStyle=\"overFullScreen\"/);
    assert.match(source, /<SafeAreaView testID=\"consumer-safe-area\"/);
  });
  await t.test("the relocated public RN entry rejects unsupported Modal props", () => {
    try {
      fs.writeFileSync(entry, source.replace("testID=\"consumer-modal\"", "hardwareAccelerated testID=\"consumer-modal\""));
      reject(/TypeScript failed[\s\S]*hardwareAccelerated/);
    } finally { fs.writeFileSync(entry, source); }
  });
  await t.test("semantic errors retain native TS diagnostics and the valid bundle", () => {
    try {
      fs.writeFileSync(entry, source + "\nconst invalidMigration: string = 123;\n");
      reject(/TypeScript failed[\s\S]*ui[\\/]index\.tsx\(\d+,\d+\): error TS2322/);
    } finally { fs.writeFileSync(entry, source); }
  });
  await t.test("syntax errors block publication", () => {
    try {
      fs.writeFileSync(entry, source + "\nconst broken = ;\n");
      reject(/TypeScript failed[\s\S]*TS1109/);
    } finally { fs.writeFileSync(entry, source); }
  });
  await t.test("missing manifest identity cannot bypass compiler binding", () => {
    try { const {typeChecker, ...missing} = manifest; saveManifest(missing); reject(/E_TYPESCRIPT_COMPILER/); }
    finally { saveManifest(manifest); }
  });
  await t.test("mismatched compiler bytes cannot bypass manifest binding", () => {
    try { saveManifest({...manifest, typeChecker: {...manifest.typeChecker, executableSha256: "0".repeat(64)}});
      reject(/E_TYPESCRIPT_COMPILER/); }
    finally { saveManifest(manifest); }
  });
  await t.test("a missing copied executable fails without a global fallback", () => {
    const moved = compiler.executable + ".disabled";
    try { fs.renameSync(compiler.executable, moved); reject(/E_TYPESCRIPT_COMPILER.*native executable/); }
    finally { fs.renameSync(moved, compiler.executable); }
  });
  await t.test("the same inputs still produce the same bundle after recovery", () => {
    const recovered = build();
    assert.equal(recovered.status, 0, recovered.stdout + recovered.stderr);
    assert.equal(hash(fs.readFileSync(bundle)), expectedHash);
    assert.equal(fs.existsSync(path.join(project, "ui/index.js")), false);
  });
});
