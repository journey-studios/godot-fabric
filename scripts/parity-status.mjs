import ts from "typescript";
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { cases, assertReport } from "./parity-protocol.mjs";

const inventory = JSON.parse(readFileSync("docs/compatibility/contracts-0.87.1.json", "utf8"));
const ids = new Set(inventory.contracts.map((row) => row.id));
for (const fixture of cases) for (const id of fixture.contracts)
  if (!ids.has(id)) throw new Error(`Fixture ${fixture.id} names an unknown RN contract: ${id}`);
const contents = readFileSync("src/react-native-platform.jsx", "utf8");
const source = ts.createSourceFile("facade.jsx", contents, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const facade = new Map();
for (const statement of source.statements) {
  if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause))
    for (const exported of statement.exportClause.elements) facade.set(exported.name.text, "exported_unverified");
  if (!statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
  if (ts.isFunctionDeclaration(statement) && statement.name) facade.set(statement.name.text, "exported_unverified");
  if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name)) throw new Error("Review destructured facade exports");
    const placeholder = ts.isCallExpression(declaration.initializer) && declaration.initializer.expression.getText(source) === "unavailable";
    facade.set(declaration.name.text, placeholder ? "explicit_placeholder" : "exported_unverified");
  }
}
const exports = inventory.contracts.filter((row) => row.kind === "value").map((row) => ({ name: row.name, status: facade.get(row.name) || "missing" }));
const counts = {};
for (const row of exports) counts[row.status] = (counts[row.status] || 0) + 1;
const comparisons = {};
for (const platform of ["godot", "ios", "android"]) {
  const file = `build/parity-${platform}.json`;
  if (!existsSync(file)) comparisons[platform] = "not_run";
  else {
    try { assertReport(JSON.parse(readFileSync(file, "utf8")), platform); comparisons[platform] = "passed_subset"; }
    catch { comparisons[platform] = "invalid_or_stale"; }
  }
}
const report = {
  schemaVersion: 1, reactNative: inventory.reactNative,
  facadeSha256: createHash("sha256").update(contents).digest("hex"),
  declaredContracts: inventory.counts, facadeNames: counts, exports,
  fixtureCases: cases.length, nativeEvidence: comparisons,
  scope: "Exports are source presence, not behavior coverage. Native evidence covers only core-ui-v2. All other declared contracts remain unverified by this differential fixture.",
};
mkdirSync("build", { recursive: true });
writeFileSync("build/parity-status.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ facadeNames: counts, fixtureCases: cases.length, nativeEvidence: comparisons }, null, 2));
