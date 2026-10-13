import ts from "typescript";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { platformImplementation, scanUpstream } from "./parity-upstream-scan.mjs";

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
  lib: ["lib.esnext.d.ts"], types: ["react"],
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
function add(row) {
  const previous = identities.get(row.id);
  if (previous) {
    if (JSON.stringify(previous) !== JSON.stringify(row)) throw new Error(`Conflicting contract declarations: ${row.id}`);
    return; // A resolved overloaded function already contains all signatures.
  }
  identities.set(row.id, row);
  records.push(row);
}
function record(kind, owner, name, type, declaration) {
  const file = declaration?.getSourceFile().fileName;
  add({
    id: `${kind}:${owner}.${name}`, kind, owner, name, type: typeString(type),
    ...(file?.startsWith(upstream + path.sep) ? { source: path.relative(upstream, file) } : {}),
  });
}
// What RN declares lives in the react-native package and in the packages it splits off under @react-native/ (the
// virtualized lists FlatList and SectionList build on). Everything else the checker reaches is a language or React
// declaration that RN does not own.
const ownedDirectories = [upstream, path.join(root, "node_modules/@react-native")].map((directory) => directory + path.sep);
const declaredByRN = (declaration) => ownedDirectories.some((directory) => declaration.getSourceFile().fileName.startsWith(directory));
const PRIMITIVE_FLAGS = ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BigIntLike | ts.TypeFlags.BooleanLike |
  ts.TypeFlags.ESSymbolLike | ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void;
// A primitive, a literal or a union of them has no members of its own: the checker answers with the apparent members of
// String, Number or Symbol, which every string-literal union (29 types times 52 members) would repeat as RN contracts.
function isPrimitiveLike(type) {
  return type.isUnion() ? type.types.every(isPrimitiveLike) : (type.flags & PRIMITIVE_FLAGS) !== 0;
}
// The checker spells a well-known-symbol member `__@iterator@1079`: the number is its internal symbol counter, which moves with
// the work done before the name is first built. A row uses the source spelling, `[Symbol.iterator]`, so ids do not depend on it.
const SYMBOL_KEY = /^__@(\w+)@\d+$/;
const renderedSymbols = new Map();
function memberName(owner, member) {
  const match = SYMBOL_KEY.exec(member.name);
  if (!match) {
    return member.name;
  }
  const name = `[Symbol.${match[1]}]`;
  const previous = renderedSymbols.get(`${owner}.${name}`);
  if (previous !== undefined && previous !== member.name) {
    throw new Error(`Two symbol-keyed members of ${owner} render as ${name}: ${previous} and ${member.name}`);
  }
  renderedSymbols.set(`${owner}.${name}`, member.name);
  return name;
}
// A member is a contract when RN declares it, also when the declaration overrides a base member (VirtualizedList's render).
// What a class instance inherits from Object.prototype and React.Component, and the statics of React's classes, are not.
function members(type, owner, kind) {
  if (isPrimitiveLike(type)) {
    return;
  }
  for (const member of checker.getPropertiesOfType(type)) {
    const declaration = member.valueDeclaration || member.declarations?.[0];
    if (!declaration || !member.declarations.some(declaredByRN)) {
      continue;
    }
    const fieldType = checker.getTypeOfSymbolAtLocation(member, declaration);
    const category = kind === "prop" && /^on[A-Z]/.test(member.name) ? "event" : kind;
    record(category, owner, memberName(owner, member), fieldType, declaration);
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
    if (ts.isClassDeclaration(declaration)) {
      const instance = checker.getDeclaredTypeOfSymbol(symbol);
      record("global-type", "global", declaration.name.text, instance, declaration);
      members(instance, declaration.name.text, "global-member");
    }
  }
}
// What the declarations cannot say comes from RN's JavaScript sources: runtime globals, host globals and native commands.
const scan = scanUpstream({ ts, upstream });
for (const row of scan.rows) add(row);
// The platform marker is mechanical and inherited: a member carries the marker of the value that owns it.
const values = new Map(records.filter((row) => row.kind === "value").map((row) => [row.name, row]));
const marked = { value: 0, "api-member": 0 };
for (const row of records) {
  const owner = row.kind === "value" ? row : row.kind === "api-member" ? values.get(row.owner) : undefined;
  const marker = owner?.source && platformImplementation(upstream, owner.source, owner === row ? [row.name] : [owner.name, row.name]);
  if (marker) {
    Object.assign(row, marker);
    marked[row.kind]++;
  }
}
records.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
// Ids are what the map and the fixture catalog key on, so two rows must never share one.
const duplicates = records.filter((row, index) => index > 0 && records[index - 1].id === row.id).map((row) => row.id);
if (duplicates.length) {
  throw new Error(`Duplicate contract ids: ${duplicates.join(", ")}`);
}
const sourceFiles = [...new Map([
  ...program.getSourceFiles().filter((file) => file.fileName.startsWith(upstream + path.sep))
    .map((file) => [path.relative(upstream, file.fileName), hash(file.text)]),
  ...scan.files.map(({ file, sha256 }) => [file, sha256]),
]).entries()].map(([file, sha256]) => ({ file, sha256 })).sort((left, right) => left.file < right.file ? -1 : left.file > right.file ? 1 : 0);
const counts = {};
for (const row of records) counts[row.kind] = (counts[row.kind] || 0) + 1;
const inventory = {
  schemaVersion: 2, reactNative: version, typescript: ts.version,
  scope: "Root public generated declarations, their immediate members that RN's own sources declare (what the checker only reaches through String, Number, Symbol, Object.prototype or React's classes is not a contract), and explicitly declared RN globals, plus three kinds read from RN's JavaScript: the globals InitializeCore's chain installs (runtime-global), the globals RN's JS reads that the host must provide (host-global) and the commands codegenNativeCommands registers (native-command). Public values and their members carry a mechanical platformImplementation marker. Signatures retain nested types and overloads; private deep imports are outside this inventory. Rows define contracts, not behavior coverage.",
  counts,
  derivation: {
    ...scan.derivation,
    platformImplementation: {
      rule: "A public value (and each of its API members) is marked when its module has a <module>.ios.js or <module>.android.js file next to it, or when the value's or member's name ends in IOS or Android. Mechanical evidence only: applicability to Godot is decided elsewhere.",
      marked,
    },
  },
  upstreamFiles: sourceFiles, contracts: records,
};
// Objects get a line per key and arrays a line per element, so reviews and text searches stay practical.
function layout(value, depth) {
  const inner = "  ".repeat(depth + 1), outer = "  ".repeat(depth);
  if (Array.isArray(value)) return value.length ? `[\n${value.map((item) => inner + JSON.stringify(item)).join(",\n")}\n${outer}]` : "[]";
  if (value && typeof value === "object") {
    return `{\n${Object.entries(value).map(([key, item]) => `${inner}${JSON.stringify(key)}: ${layout(item, depth + 1)}`).join(",\n")}\n${outer}}`;
  }
  return JSON.stringify(value);
}
const contents = `${layout(inventory, 0)}\n`;
if (contents.includes(root)) throw new Error("Inventory contains a local absolute path");
if (process.argv.includes("--check")) {
  if (readFileSync(output, "utf8") !== contents) throw new Error("Parity inventory drift: regenerate and review docs/compatibility/contracts-0.87.1.json");
} else {
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, contents);
}
console.log(`PARITY_INVENTORY_PASSED: ${records.length} contracts, ${counts.value} public values`);
