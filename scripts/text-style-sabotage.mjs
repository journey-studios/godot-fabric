import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {copyFile, mkdir, readFile, writeFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {guardSources} from "./sabotage-sources.mjs";

// The retained controls of the text-style slice. Each runs tests/text-style-native.test.mjs, whose probe and
// independent oracle judge the report:
//
//   previous        the SDK and the host of main before this slice (the facade rejects fontStyle and textDecoration*).
//                   The host is build/text-style-previous-host/fabric_godot.dylib, the dylib that main's build produced,
//                   installed in addons/ for the run. It must fail exactly the normative and the host checks.
//   previous-host   this SDK on that host: the styles are accepted and nothing slants, draws a line or refuses, so exactly
//                   the host checks fail.
//
// and one sabotage per decision of the slice. Each breaks one source on purpose, the probe's checks and the oracle
// must both reject it (the oracle in the section named in tests/text-style-native.test.mjs), and the source comes back
// byte for byte whatever ends the run, a signal included (scripts/sabotage-sources.mjs):
//
//   decoration-above  the underline sits above the baseline (the sign of its offset is inverted)         rebuilds the host
//   color-ignored     textDecorationColor is ignored: the line takes the text color                      rebuilds the host
//   inherit           the facade drops a child's textDecorationLine none, so the child inherits the underline
//   whole-line        the line covers the whole row from its x to its width, whatever the run and the cut   rebuilds the host
//   skew-sign         the italic slant leans the other way                                               rebuilds the host
//   facade-dotted     the facade lets textDecorationStyle dotted through to the host
//   ellipsis-run      the ellipsis takes the run of the first glyph again, as before this slice            rebuilds the host
//   guard             ParagraphLayout::prepare does not refuse oblique and the non-solid line styles      rebuilds the host
//
// Run with:
//   node scripts/text-style-sabotage.mjs
// The controls on the previous host are skipped, and said so, when that dylib is not there.
const root = fileURLToPath(new URL("..", import.meta.url));
const host = path.join(root, "addons/fabric_godot.dylib");
const previousHost = path.join(root, "build/text-style-previous-host/fabric_godot.dylib");
const genuineCopy = path.join(root, "build/text-style-genuine-host/fabric_godot.dylib");
const cmake = path.join(root, ".deps/python/bin/cmake");
const layout = "native/paragraph_layout.cpp";
const facade = "src/react-native-platform.jsx";
const variants = [
  {name: "decoration-above", argument: "--sabotage=decoration-above", file: layout, native: true,
    find: "add(false, line.y + run.font->get_underline_position(run.size));",
    replace: "add(false, line.y - run.font->get_underline_position(run.size));"},
  {name: "color-ignored", argument: "--sabotage=color-ignored", file: layout, native: true,
    find: "auto decoration = a.textDecorationColor ? color(a.textDecorationColor) : ink;",
    replace: "auto decoration = ink;"},
  {name: "inherit", argument: "--sabotage=inherit", file: facade,
    find: "  return <GodotText {...props} style={flat} />;",
    replace: "  const { textDecorationLine, ...inherited } = flat;\n" +
      '  return <GodotText {...props} style={textDecorationLine === "none" ? inherited : flat} />;'},
  {name: "whole-line", argument: "--sabotage=whole-line", file: layout, native: true,
    find: "    for (const auto &group : painted_groups(painted_glyphs(line, runs), false)) {\n",
    replace: "    for (auto group : painted_groups(painted_glyphs(line, runs), false)) {\n" +
      "      group.x0 = line.x;\n      group.x1 = line.x + line.width;\n"},
  {name: "skew-sign", argument: "--sabotage=skew-sign", file: layout, native: true,
    find: "constexpr float ITALIC_SKEW = 0.25f;", replace: "constexpr float ITALIC_SKEW = -0.25f;"},
  {name: "facade-dotted", argument: "--sabotage=facade-dotted", file: facade,
    find: 'name === "textDecorationStyle" && value !== "solid"',
    replace: 'name === "textDecorationStyle" && value !== "solid" && value !== "dotted"'},
  {name: "ellipsis-run", argument: "--sabotage=ellipsis-run", file: layout, native: true,
    find: "  paint(ts->shaped_text_get_ellipsis_glyphs(line.rid), -1, true);",
    replace: "  run = 0;\n  paint(ts->shaped_text_get_ellipsis_glyphs(line.rid), -1, true);"},
  {name: "guard", argument: "--sabotage=guard", file: layout, native: true,
    find: "  if (a.fontStyle == rn::FontStyle::Oblique) {\n" +
      '    throw std::runtime_error("Godot Text does not implement style fontStyle oblique: use normal or italic");\n' +
      "  }\n" +
      "  if (a.textDecorationStyle.has_value() && *a.textDecorationStyle != rn::TextDecorationStyle::Solid) {\n" +
      '    static const char *const names[] = {"solid", "double", "dotted", "dashed", "wavy"};\n' +
      '    throw std::runtime_error(std::string("Godot Text does not implement style textDecorationStyle ") +\n' +
      '        names[static_cast<int>(*a.textDecorationStyle)] + ": only solid");\n' +
      "  }\n",
    replace: "  (void)a;\n"},
];
const digest = content => createHash("sha256").update(content).digest("hex");
const sha = async target => digest(await readFile(target));
const files = [...new Set(variants.map(variant => variant.file))];
const sources = guardSources(root, files);

async function build(name) {
  const result = await sources.run(cmake, ["--build", ".deps/build", "--parallel", "4", "--target", "fabric_godot"]);
  await writeFile(path.join(root, `build/text-style-sabotage-${name}-build.log`), result.stdout + result.stderr);
  assert.equal(result.status, 0, `The ${name} host must build: build/text-style-sabotage-${name}-build.log`);
}

// The test's own output is kept beside the probe's log: it says which assertion rejected (or accepted) a control.
async function run(argument) {
  const result = await sources.run(process.execPath, ["tests/text-style-native.test.mjs", ...(argument ? [argument] : [])]);
  await writeFile(path.join(root, `build/text-style-${argument ? argument.replace(/^--/, "").replace("=", "-") : "current"}-test.log`),
    result.stdout + result.stderr);
  return result;
}
const receipt = {format: "godot-fabric.text-style-sabotage/v1", sourceSha256: {genuine: sources.genuine}, controls: {}, variants: []};

for (const variant of variants.filter(entry => entry.native)) {
  sources.sabotaged(variant);
  await mkdir(path.join(root, `build/text-style-sabotage-${variant.name}-host`), {recursive: true});
}
// The genuine host first, kept so that it can be put back after the controls that replace it.
await build("genuine");
receipt.hostSha256 = {genuine: await sha(host)};
await mkdir(path.dirname(genuineCopy), {recursive: true});
await copyFile(host, genuineCopy);
try {
  if (existsSync(previousHost)) {
    for (const [name, argument] of [["previous", "--previous"], ["previous-host", "--previous-host"]]) {
      await copyFile(previousHost, host);
      const entry = {hostSha256: await sha(host), previousHostSha256: await sha(previousHost)};
      entry.runStatus = (await run(argument)).status;
      receipt.controls[name] = entry;
      await copyFile(genuineCopy, host);
    }
  } else {
    console.log("No previous host at build/text-style-previous-host: the controls on it are skipped.");
  }
  for (const variant of variants) {
    try {
      const broken = sources.sabotaged(variant);
      const entry = {name: variant.name, file: variant.file, find: variant.find, replace: variant.replace, sourceSha256: digest(broken)};
      sources.swap(variant.file, broken);
      if (variant.native) {
        await build(variant.name);
        entry.hostSha256 = await sha(host);
        assert.notEqual(entry.hostSha256, receipt.hostSha256.genuine);
        await copyFile(host, path.join(root, `build/text-style-sabotage-${variant.name}-host`, "fabric_godot.dylib"));
      }
      entry.runStatus = (await run(variant.argument)).status;
      receipt.variants.push(entry);
    } finally {
      sources.restore();
      if (variant.native) {
        await copyFile(genuineCopy, host);
      }
    }
  }
} finally {
  receipt.sourceSha256.restored = sources.restore();
  await build("restored");
  receipt.hostSha256.restored = await sha(host);
}
assert.equal(receipt.hostSha256.restored, receipt.hostSha256.genuine, "The rebuilt host is the genuine one");
// The genuine lane last, so that its comparison reads the reports of every control above.
receipt.currentRunStatus = (await run()).status;
await writeFile(path.join(root, "build/text-style-sabotage.json"), JSON.stringify(receipt, null, 2) + "\n");
for (const [name, entry] of Object.entries(receipt.controls)) {
  assert.equal(entry.runStatus, 0, `The ${name} control fails exactly its checks: build/text-style-${name}.log`);
}
for (const entry of receipt.variants) {
  assert.equal(entry.runStatus, 0, `The probe and oracle must reject the ${entry.name} sabotage: build/text-style-sabotage-${entry.name}.log`);
}
assert.equal(receipt.currentRunStatus, 0, "The genuine run passes: build/text-style-current.log");
console.log(JSON.stringify(receipt, null, 2));
