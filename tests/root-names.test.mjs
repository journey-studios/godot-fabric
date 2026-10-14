import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultInputs, resolveMap } from "../scripts/parity-map.mjs";
import { classifyFacade } from "../scripts/parity-facade.mjs";

// The census of RN's root: every value name of the 1.0 scope (docs/compatibility/contract-map-0.87.1.json) is exported by the
// facade, a placeholder of it, or missing, by the rule that scripts/parity-status.mjs counts with. Every name the facade
// exports, placeholders included, has a public type in types/react-native.ts and is imported and used by the TSX consumer
// (tests/types/consumer.tsx), which `npm run type-check` checks. The names the facade does not export are pinned below, so that
// implementing one fails this test until its type exists and the list is updated.

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file) => readFileSync(path.join(root, file), "utf8");

// The 1.0 root names that src/react-native-platform.jsx does not export yet, sorted. They have no type on purpose: a type for a
// name the facade lacks would promise an API that fails with an undefined import.
const MISSING = [
  "Alert", "BackHandler", "DevMenu", "DevSettings", "DeviceEventEmitter", "DeviceInfo", "EventEmitter", "Keyboard", "LogBox",
  "NativeAppEventEmitter", "NativeComponentRegistry", "Networking", "PlatformColor", "ReactNativeVersion", "Settings", "Share",
  "Systrace", "UTFSequence", "processColor", "registerCallableModule", "requireNativeComponent", "unstable_batchedUpdates",
  "useAnimatedColor", "usePressability",
];

const isExported = (node) => node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;

// The value names a declaration file gives a type: its exported constants, functions, classes and enums. A type alias or an
// interface names a type, not a value, and a namespace of types only (Animated.Value) names none either; it sits next to the
// constant that does.
function declaredValueNames(contents) {
  const source = ts.createSourceFile("react-native.ts", contents, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = new Set();
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement) || ts.isExportAssignment(statement)) {
      throw new Error("Review the re-exports of types/react-native.ts: the census reads its declarations only");
    }
    if (!isExported(statement)) {
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) {
          throw new Error("Review destructured declarations in types/react-native.ts");
        }
        names.add(declaration.name.text);
      }
    } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) {
      names.add(statement.name.text);
    }
  }
  return names;
}

// What a consumer file takes from "react-native": the value names it imports (not the type-only ones), and the names it
// uses somewhere other than in an import or as the member of an expression.
function consumerNames(contents) {
  const source = ts.createSourceFile("consumer.tsx", contents, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imported = new Map();
  const used = new Set();
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      const bindings = node.importClause?.namedBindings;
      if (node.moduleSpecifier.text === "react-native" && !node.importClause?.isTypeOnly && bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements.filter((candidate) => !candidate.isTypeOnly)) {
          imported.set((element.propertyName ?? element.name).text, element.name.text);
        }
      }
      return;
    }
    if (ts.isIdentifier(node) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) {
      used.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { imported, used };
}

// The problems of the census, each saying what to do. `roots` are the 1.0 value names, `facade` is classifyFacade's map, `typed`
// the value names types/react-native.ts declares, `consumer` consumerNames' result and `pinned` the MISSING list.
function censusProblems({ roots, facade, typed, consumer, pinned }) {
  const problems = [];
  const status = (name) => facade.get(name) ?? "missing";
  const present = roots.filter((name) => status(name) !== "missing");
  for (const name of present.filter((candidate) => !typed.has(candidate))) {
    const what = status(name) === "explicit_placeholder" ? "has a placeholder for it" : "exports it";
    problems.push(`${name}: the facade ${what}, but types/react-native.ts declares no value ${name}. Add \`export declare const ${name}: typeof RN.${name};\` there (a Pick of it where the facade implements a subset) and use it in tests/types/consumer.tsx.`);
  }
  for (const name of [...typed].sort().filter((candidate) => !facade.has(candidate))) {
    problems.push(`${name}: types/react-native.ts declares it, but the facade does not export it. Remove the declaration, or export ${name} from src/react-native-platform.jsx first.`);
  }
  const missing = roots.filter((name) => status(name) === "missing");
  const added = missing.filter((name) => !pinned.includes(name));
  const removed = pinned.filter((name) => !missing.includes(name));
  if (added.length > 0) {
    problems.push(`${added.join(", ")}: missing from the facade but not in MISSING of tests/root-names.test.mjs. They were exported before, or are 1.0 names the contract map added: restore the export, or add them to MISSING.`);
  }
  if (removed.length > 0) {
    problems.push(`${removed.join(", ")}: in MISSING of tests/root-names.test.mjs but not missing any more (the facade exports it now, or the contract map no longer scopes it to 1.0). Declare its type in types/react-native.ts, use it in tests/types/consumer.tsx and delete it from MISSING.`);
  }
  for (const name of present.filter((candidate) => typed.has(candidate))) {
    if (!consumer.imported.has(name)) {
      problems.push(`${name}: tests/types/consumer.tsx does not import it from "react-native". Add it to an import there.`);
    } else if (!consumer.used.has(consumer.imported.get(name))) {
      problems.push(`${name}: tests/types/consumer.tsx imports it but never uses it. Use it once in a typed context.`);
    }
  }
  return problems;
}

const inputs = defaultInputs();
const outcome = resolveMap(inputs);
const roots = inputs.inventory.contracts
  .filter((row) => row.kind === "value" && outcome.resolved.get(row.id)?.scope === "1_0")
  .map((row) => row.name)
  .sort();
const facade = classifyFacade(read("src/react-native-platform.jsx"));
const typed = declaredValueNames(read("types/react-native.ts"));
const consumer = consumerNames(read("tests/types/consumer.tsx"));
const committed = { roots, facade, typed, consumer, pinned: MISSING };

test("the contract map resolves and names the value names of RN's 1.0 root", () => {
  assert.deepEqual(outcome.problems, []);
  assert.equal(new Set(roots).size, roots.length);
  assert.ok(roots.length > 0);
});

test("every root name the facade exports, a placeholder included, has a public type that the TSX consumer imports and uses, and no type names a name the facade lacks", () => {
  assert.deepEqual(censusProblems(committed), []);
});

test("the missing names are pinned: the facade exports none of them and has no type for them", () => {
  const missing = roots.filter((name) => !facade.has(name));
  assert.deepEqual(missing, [...MISSING].sort());
  assert.deepEqual(MISSING.filter((name) => typed.has(name)), []);
});

test("an exported name without a type fails the census and says how to fix it", () => {
  const problems = censusProblems({ ...committed, typed: new Set([...typed].filter((name) => name !== "PixelRatio")) });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^PixelRatio: the facade exports it, but types\/react-native\.ts declares no value PixelRatio\. Add `export declare const PixelRatio/);
  const placeholder = censusProblems({ ...committed, typed: new Set([...typed].filter((name) => name !== "StatusBar")) });
  assert.match(placeholder.join("\n"), /^StatusBar: the facade has a placeholder for it/);
});

test("a type for a name the facade does not export fails the census", () => {
  const problems = censusProblems({ ...committed, typed: new Set([...typed, "Alert"]) });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^Alert: types\/react-native\.ts declares it, but the facade does not export it\. Remove the declaration/);
});

test("implementing a pinned name, or losing an export, fails until MISSING is updated", () => {
  const implemented = new Map([...facade, ["Alert", "exported_unverified"]]);
  const withType = new Set([...typed, "Alert"]);
  const consumerWithAlert = { imported: new Map([...consumer.imported, ["Alert", "Alert"]]), used: new Set([...consumer.used, "Alert"]) };
  const grown = censusProblems({ ...committed, facade: implemented, typed: withType, consumer: consumerWithAlert });
  assert.equal(grown.length, 1);
  assert.match(grown[0], /^Alert: in MISSING of tests\/root-names\.test\.mjs but not missing any more/);
  const shrunk = new Map([...facade].filter(([name]) => name !== "PixelRatio"));
  const lost = censusProblems({ ...committed, facade: shrunk }).join("\n");
  assert.match(lost, /PixelRatio: missing from the facade but not in MISSING/);
  assert.match(lost, /PixelRatio: types\/react-native\.ts declares it, but the facade does not export it/);
});

test("a root name the consumer drops, or only imports, fails the census", () => {
  const dropped = new Map([...consumer.imported].filter(([name]) => name !== "PanResponder"));
  assert.match(censusProblems({ ...committed, consumer: { ...consumer, imported: dropped } }).join("\n"), /^PanResponder: tests\/types\/consumer\.tsx does not import it/);
  const idle = new Set([...consumer.used].filter((name) => name !== "I18nManager"));
  assert.match(censusProblems({ ...committed, consumer: { ...consumer, used: idle } }).join("\n"), /^I18nManager: tests\/types\/consumer\.tsx imports it but never uses it/);
});

test("the readers see what they should: aliases, type-only imports and member names", () => {
  const found = consumerNames([
    "import { A, B as C, type D, E } from \"react-native\";",
    "import type { F } from \"react-native\";",
    "import { G } from \"elsewhere\";",
    "const x = C; const y = holder.E; void x; void y;",
  ].join("\n"));
  assert.deepEqual([...found.imported], [["A", "A"], ["B", "C"], ["E", "E"]]);
  assert.ok(found.used.has("C") && !found.used.has("A") && !found.used.has("E"));
  const names = declaredValueNames([
    "export declare const A: number;", "export declare function B(): void;", "export declare class C {}",
    "export type D = number;", "export interface E {}", "declare const F: number;",
    "export declare namespace H { type T = number }",
  ].join("\n"));
  assert.deepEqual([...names], ["A", "B", "C"]);
  assert.throws(() => declaredValueNames("export { A } from \"./a\";"), /re-exports/);
});
