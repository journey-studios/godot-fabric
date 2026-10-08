import {readFileSync, rmSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {ensureGodotBinary} from "./godot-binary.mjs";
import {bundleNativeProbe} from "./native-probe-bundle.mjs";
import {guardSources} from "./sabotage-sources.mjs";

// Reproduces, once and on purpose, what the ScrollView sabotage of scripts/scope-sabotage.mjs does to the host: the contract of the
// ScrollView stops calling the checker of src/prop-scope.mjs, so a refused prop reaches RN's own ScrollView.js and the host. The
// fixture of the suite is cut to the ScrollView, one case to a group, and the probe prints the group before it drives it, so the
// last line before the crash names the case. The source goes back byte for byte whatever ends the run (scripts/sabotage-sources.mjs).
//
//   node scripts/scope-scroll-crash.mjs                      every refused ScrollView prop, one at a time, until the host crashes
//   node scripts/scope-scroll-crash.mjs <prop> [<json>]      one prop, alone, with the value the table probes with or the JSON given
//
// It writes build/scope-scroll-crash.log and prints the group that was being driven when the host stopped.
const root = fileURLToPath(new URL("..", import.meta.url));
const contract = "src/scroll-view-contract.mjs";
const [only, valueArgument] = process.argv.slice(2);
if (valueArgument !== undefined) {
  JSON.parse(valueArgument);
}
const sources = guardSources(root, [contract]);
const broken = sources.sabotaged({name: "scroll", file: contract, find: '  checkProps("ScrollView", props);\n', replace: ""});

let fixture = readFileSync(path.join(root, "tests/scope-0.5-fixture.jsx"), "utf8");
const edit = (find, replace) => {
  if (fixture.split(find).length !== 2) {
    throw new Error(`The fixture must contain exactly one: ${find}`);
  }
  fixture = fixture.replace(find, () => replace);
};
edit("const SIZE = {Modal: 8};", "const SIZE = {Modal: 8, ScrollView: 1};");
edit("  for (const component of scopedComponents) {\n    const refusedCases", '  for (const component of scopedComponents) {\n    if (component !== "ScrollView") { continue; }\n    const refusedCases');
edit('  built.push({id: "controls", component: null, kind: "controls", cases: controls.map(entry => ({...entry, slot: `controls#${entry.component}`}))});\n', "");
if (only !== undefined) {
  const value = valueArgument === undefined ? "probeValue(component, prop)" : valueArgument;
  edit("      refusedCases.push({prop, value: probeValue(component, prop)});",
    `      if (prop === ${JSON.stringify(only)}) { refusedCases.push({prop, value: ${value}}); }`);
}
let probe = readFileSync(path.join(root, "tests/scope-0.5-probe.gd"), "utf8");
probe = probe.replace("res://build/scope-0.5-probe.js", "res://build/scope-scroll-crash-probe.js")
  .replace("res://build/scope-0.5-report.json", "res://build/scope-scroll-crash-report.json")
  .replace(/  run_js\("show\(" \+ JSON\.stringify\(id\) \+ ", '(base|case)', (true|false)\)"\)/g,
    (match, mode, remount) => `  printerr("TRACE show ", id, " ${mode} remount=${remount}")\n${match}`);

let log = "";
try {
  writeFileSync(path.join(root, "build/scope-scroll-crash-fixture.jsx"), fixture);
  writeFileSync(path.join(root, "build/scope-scroll-crash-probe.gd"), probe);
  sources.swap(contract, broken);
  await bundleNativeProbe({name: "scope-scroll-crash", entryPoint: "build/scope-scroll-crash-fixture.jsx", sources: [], seams: [], bundled: [], references: []});
  rmSync(path.join(root, "build/scope-scroll-crash-report.json"), {force: true});
  const result = await sources.run(await ensureGodotBinary(), ["--path", root, "--headless", "--script", "res://build/scope-scroll-crash-probe.gd", "--"]);
  log = result.stdout + result.stderr;
  writeFileSync(path.join(root, "build/scope-scroll-crash.log"), log);
  console.log(`godot: status ${result.status}, signal ${result.signal}`);
} finally {
  sources.restore();
  rmSync(path.join(root, "build/scope-scroll-crash-fixture.jsx"), {force: true});
  rmSync(path.join(root, "build/scope-scroll-crash-probe.gd"), {force: true});
}
const lines = log.split("\n");
const traces = lines.filter(line => line.startsWith("TRACE"));
const crash = lines.findIndex(line => line.includes("Program crashed"));
console.log(`${traces.length} group steps driven; the last one: ${traces.at(-1) ?? "none"}`);
console.log(crash >= 0 ? `crash: ${lines[crash]}` : "no crash handler line (see build/scope-scroll-crash.log)");
for (const line of lines.slice(crash >= 0 ? crash : 0).filter(entry => /hermes::vm::getForInPropertyNames|BaseScrollViewProps::setProp|UIManager::createNode|parsePlatformColor/.test(entry)).slice(0, 4)) {
  console.log(`  ${line.replace(/^\[\d+\] \w+ /, "").slice(0, 170)}`);
}
console.log("src/scroll-view-contract.mjs is restored byte for byte");
