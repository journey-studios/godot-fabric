import ts from "typescript";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const upstream = path.join(root, "node_modules/react-native");
const entry = path.join(upstream, "types_generated/index.d.ts");
const globals = path.join(upstream, "src/types/globals.d.ts");
const outputIndex = process.argv.indexOf("--output");
if (outputIndex >= 0 && !process.argv[outputIndex + 1]) throw new Error("--output requires a path");
const output = outputIndex >= 0 ? path.resolve(process.argv[outputIndex + 1])
  : path.join(root, "docs/compatibility/contracts-0.87.1.json");
const hash = (contents) => createHash("sha256").update(contents).digest("hex");
const version = JSON.parse(readFileSync(path.join(upstream, "package.json"), "utf8")).version;
if (version !== "0.87.1") throw new Error(`Review the parity baseline before upgrading RN: ${version}`);
const program = ts.createProgram([entry], {
  strict: true, skipLibCheck: true, noEmit: true, target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
});
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
  getCanonicalFileName: (file) => file, getCurrentDirectory: () => root, getNewLine: () => "\n",
}));
const checker = program.getTypeChecker();
const source = program.getSourceFile(entry);
const exports = checker.getExportsOfModule(checker.getSymbolAtLocation(source));
const records = [];
const identities = new Map();
function typeString(type) {
  return checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation)
    .replaceAll(root + "node_modules/", "");
}
function record(kind, owner, name, type, declaration) {
  const file = declaration?.getSourceFile().fileName;
  const row = {
    id: `${kind}:${owner}.${name}`, kind, owner, name, type: typeString(type),
    ...(file?.startsWith(upstream + path.sep) ? { source: path.relative(upstream, file) } : {}),
  };
  const previous = identities.get(row.id);
  if (previous) {
    if (JSON.stringify(previous) !== JSON.stringify(row)) throw new Error(`Conflicting contract declarations: ${row.id}`);
    return; // A resolved overloaded function already contains all signatures.
  }
  identities.set(row.id, row);
  records.push(row);
}
function members(type, owner, kind) {
  for (const member of checker.getPropertiesOfType(type)) {
    const declaration = member.valueDeclaration || member.declarations?.[0];
    if (!declaration) continue;
    const fieldType = checker.getTypeOfSymbolAtLocation(member, declaration);
    const category = kind === "prop" && /^on[A-Z]/.test(member.name) ? "event" : kind;
    record(category, owner, member.name, fieldType, declaration);
  }
}
for (const exported of exports) {
  const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
  const declaration = symbol.valueDeclaration || symbol.declarations?.[0];
  if (!declaration) throw new Error(`Unresolved upstream declaration: ${exported.name}`);
  // Type-only exports must not be counted as values even when their target is a class.
  const typeOnly = exported.declarations?.every((node) => ts.isExportSpecifier(node) &&
    (node.isTypeOnly || node.parent.parent.isTypeOnly));
  if (!typeOnly && symbol.flags & ts.SymbolFlags.Value) {
    const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
    record("value", "react-native", exported.name, type, declaration);
    members(type, exported.name, "api-member");
  } else {
    const type = checker.getDeclaredTypeOfSymbol(symbol);
    record("type", "react-native", exported.name, type, declaration);
    const kind = /Props$/.test(exported.name) ? "prop"
      : ["ViewStyle", "TextStyle", "ImageStyle", "TransformsStyle"].includes(exported.name) ? "style"
        : /Instance$|ImperativeMethods$/.test(exported.name) ? "ref-member" : "type-member";
    members(type, exported.name, kind);
  }
}
const globalSource = program.getSourceFile(globals);
const globalModule = globalSource.statements.find((node) => ts.isModuleDeclaration(node) && node.name.text === "global");
if (!globalModule || !ts.isModuleBlock(globalModule.body)) throw new Error("Upstream global declarations changed");
for (const declaration of globalModule.body.statements) {
  if (ts.isVariableStatement(declaration)) {
    for (const field of declaration.declarationList.declarations) {
      if (!ts.isIdentifier(field.name)) throw new Error("Unsupported destructured global declaration");
      record("global-value", "global", field.name.text, checker.getTypeAtLocation(field), field);
    }
  } else if (declaration.name) {
    const kind = ts.isInterfaceDeclaration(declaration) || ts.isTypeAliasDeclaration(declaration) ? "global-type" : "global-value";
    const symbol = checker.getSymbolAtLocation(declaration.name);
    const type = kind === "global-value" ? checker.getTypeOfSymbolAtLocation(symbol, declaration)
      : checker.getDeclaredTypeOfSymbol(symbol);
    record(kind, "global", declaration.name.text, type, declaration);
    members(type, declaration.name.text, "global-member");
  }
}
records.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
const sourceFiles = program.getSourceFiles().filter((file) => file.fileName.startsWith(upstream + path.sep))
  .map((file) => ({ file: path.relative(upstream, file.fileName), sha256: hash(file.text) }))
  .sort((left, right) => left.file < right.file ? -1 : left.file > right.file ? 1 : 0);
const counts = {};
for (const row of records) counts[row.kind] = (counts[row.kind] || 0) + 1;
const inventory = {
  schemaVersion: 1, reactNative: version, typescript: ts.version,
  scope: "Root public generated declarations, their immediate members, and explicitly declared RN globals. Signatures retain nested types and overloads; private deep imports and undeclared runtime globals are outside this inventory. Rows define contracts, not behavior coverage.",
  counts, upstreamFiles: sourceFiles, contracts: records,
};
// One generated contract per line keeps reviews and text searches practical.
const metadata = JSON.stringify({ ...inventory, upstreamFiles: undefined, contracts: undefined }, null, 2).slice(0, -2);
const array = (values) => values.map((value) => "    " + JSON.stringify(value)).join(",\n");
const contents = `${metadata},\n  "upstreamFiles": [\n${array(sourceFiles)}\n  ],\n  "contracts": [\n${array(records)}\n  ]\n}\n`;
if (contents.includes(root)) throw new Error("Inventory contains a local absolute path");
if (process.argv.includes("--check")) {
  if (readFileSync(output, "utf8") !== contents) throw new Error("Parity inventory drift: regenerate and review docs/compatibility/contracts-0.87.1.json");
} else {
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, contents);
}
console.log(`PARITY_INVENTORY_PASSED: ${records.length} contracts, ${counts.value} public values`);
