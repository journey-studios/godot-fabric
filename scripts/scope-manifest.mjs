import {readFileSync, writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {legacyProps, scope, scopedComponents} from "../src/prop-scope.mjs";

// docs/compatibility/scope-0.5.json decides, for the thirteen React Native names the Frontier HUD imports, what the platform does
// with each. Its `components` section is the per-prop classification of src/prop-scope.mjs, written by this script and judged
// by tests/scope-0.5.test.mjs: it is never edited by hand, and a drift fails the test. Run
//   node scripts/scope-manifest.mjs --write   after a change to the tables;
//   node scripts/scope-manifest.mjs --check   to see whether the file is in step.
const manifestPath = fileURLToPath(new URL("../docs/compatibility/scope-0.5.json", import.meta.url));

export function describeComponents() {
  return Object.fromEntries(scopedComponents.map(component => {
    const counts = {supported: 0, ignored: 0, refused: 0};
    for (const rule of scope[component].rules) {
      counts[rule.decision] += rule.names.length;
    }
    return [component, {owner: scope[component].owner, counts: {declared: counts.supported + counts.ignored + counts.refused, ...counts},
      rules: scope[component].rules.map(rule => ({...rule})),
      ...(scope[component].listRules === undefined ? {} : {listRules: scope[component].listRules.map(rule => ({...rule}))})}];
  }));
}

export function renderManifest(manifest) {
  const propPolicy = {...manifest.propPolicy, legacyProps: JSON.parse(JSON.stringify(legacyProps))};
  return JSON.stringify({...manifest, propPolicy, components: describeComponents()}, null, 2) + "\n";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const current = JSON.parse(readFileSync(manifestPath, "utf8"));
  const rendered = renderManifest(current);
  if (process.argv.includes("--write")) {
    writeFileSync(manifestPath, rendered);
    console.log("scope-0.5.json: components rewritten from src/prop-scope.mjs");
  } else if (readFileSync(manifestPath, "utf8") !== rendered) {
    console.error("scope-0.5.json is out of step with src/prop-scope.mjs: run node scripts/scope-manifest.mjs --write");
    process.exit(1);
  } else {
    console.log("scope-0.5.json is in step with src/prop-scope.mjs");
  }
}
