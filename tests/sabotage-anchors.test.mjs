import assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import path from "node:path";
import test from "node:test";
import {fileURLToPath, pathToFileURL} from "node:url";
import {occurrences} from "../scripts/sabotage-sources.mjs";

// Every retained sabotage patches a source on purpose: it finds a text, replaces it, runs its lane and requires the lane to reject the result. A sabotage whose text
// is no longer in the source (or is in it twice) cannot apply, and nothing notices until someone runs the lane: #113 and #119 changed GameServices and left four
// sabotages of scripts/frontier-services-sabotage.mjs unable to apply. This test asks the question without a run, so it costs milliseconds and needs no Godot: it loads the
// table of every retained sabotage (tests/*-sabotages.mjs, written once and read by the script that runs it) and applies the rule the guard of
// scripts/sabotage-sources.mjs applies when the script runs, to the sources as they are now: each `find` occurs exactly once, in the text the edits before it left.
//
// A table is an `export const SABOTAGES` of entries `{name, file, find, replace}` or, for several edits of one file, `{name, file, edits: [{find, replace}]}`. `file` is the
// repository's, except for the entries of a provisioned copy of the template (see BASES).

const root = fileURLToPath(new URL("..", import.meta.url));
const read = file => readFileSync(path.join(root, file), "utf8");
const tables = readdirSync(path.join(root, "tests")).filter(name => name.endsWith("-sabotages.mjs")).sort();

// Where the `file` of an entry is relative to, by the `target` it names, for the tables that have more than the repository: the sabotages of the turn lane that break the
// provisioned copy (scripts/frontier-turn-lane.mjs) name a file of the project that scripts/create-consumer.mjs makes of the template, and the template is that tree.
const BASES = {"frontier-turn-sabotages.mjs": {copy: "consumers/civ-lite"}};

// The scripts that have no table to import of their own: the lane they run takes its sabotages from the module named, through the script that bundles it.
const SERVED_BY = {
  "os-contracts-sabotage.mjs": {table: "os-contracts-sabotages.mjs", through: "os-contracts-bundle.mjs"},
  "scroll-view-list-sabotage.mjs": {table: "virtualized-list-sabotages.mjs", through: "virtualized-list-bundle.mjs"},
};

const editsOf = entry => entry.edits ?? [{find: entry.find, replace: entry.replace}];
const preview = find => JSON.stringify(find.length > 90 ? `${find.slice(0, 90)}...` : find);

// What is wrong with a table, one sentence per fault. The edits of an entry are judged in order, each against the text the one before it left, as the scripts apply them.
function anchorProblems({table, entries, bases = {}, readText = read}) {
  const problems = [];
  const names = new Set();
  for (const entry of entries) {
    const label = `${table} ${entry.name}`;
    if (typeof entry.name !== "string" || entry.name === "" || names.has(entry.name)) {
      problems.push(`${label}: the name is missing or another sabotage of the table has it`);
    }
    names.add(entry.name);
    const file = path.posix.join(bases[entry.target] ?? "", entry.file ?? "");
    let text;
    try {
      text = readText(file);
    } catch {
      problems.push(`${label}: ${file} cannot be read`);
      continue;
    }
    const edits = editsOf(entry);
    if (edits.length === 0) {
      problems.push(`${label}: it has no edit`);
    }
    for (const [position, {find, replace}] of edits.entries()) {
      const edit = edits.length === 1 ? "" : ` (edit ${position + 1} of ${edits.length})`;
      if (typeof find !== "string" || find === "" || typeof replace !== "string") {
        problems.push(`${label}${edit}: it needs a text to find and a text to put in its place`);
        break;
      }
      const found = occurrences(text, find);
      if (found !== 1) {
        problems.push(`${label}${edit}: ${found === 0 ? "the text is not in" : `the text is ${found} times in`} ${file}, where the sabotage must replace exactly one place: ${preview(find)}`);
        break;
      }
      if (replace === find) {
        problems.push(`${label}${edit}: the replacement is the text itself, so nothing is broken`);
      }
      text = text.replace(find, () => replace);
    }
  }
  return problems;
}

// The names a script's imports of tests/*-sabotages.mjs bring in that nothing else in the script mentions (import statements and comments left out): a runner that
// imports its table and then applies another list of its own would pass the check of the path alone.
function unusedTableBindings(text) {
  const imports = [...text.matchAll(/import\s*\{([^}]*)\}\s*from\s*"\.\.\/tests\/([a-z0-9-]+-sabotages\.mjs)";?/g)];
  const rest = imports.reduce((left, [statement]) => left.replace(statement, ""), text).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return imports.flatMap(([, specifiers, table]) => specifiers.split(",").map(specifier => specifier.trim()).filter(Boolean)
    .map(specifier => ({table, binding: specifier.split(/\s+as\s+/).pop()})).filter(({binding}) => !new RegExp(`\\b${binding}\\b`).test(rest)));
}

const load = async table => (await import(pathToFileURL(path.join(root, "tests", table)).href)).SABOTAGES;

test("there are retained sabotage tables to check", () => {
  assert.ok(tables.length >= 25, `only ${tables.length} tables found in tests/`);
});

for (const table of tables) {
  test(`${table}: every sabotage still finds exactly one place in its source`, async () => {
    const entries = await load(table);
    assert.ok(Array.isArray(entries) && entries.length > 0, `${table} exports no SABOTAGES`);
    assert.deepEqual(anchorProblems({table, entries, bases: BASES[table]}), []);
  });
}

test("every sabotage script and every table is wired to the other", () => {
  const scripts = readdirSync(path.join(root, "scripts")).sort();
  const sabotageScripts = scripts.filter(name => /sabotage/.test(name) && name !== "sabotage-sources.mjs");
  const importedBy = new Map(tables.map(table => [table, []]));
  for (const name of scripts.filter(entry => entry.endsWith(".mjs"))) {
    for (const [, table] of read(`scripts/${name}`).matchAll(/from "\.\.\/tests\/([a-z0-9-]+-sabotages\.mjs)"/g)) {
      assert.ok(importedBy.has(table), `scripts/${name} imports tests/${table}, which does not exist`);
      importedBy.get(table).push(name);
    }
    assert.deepEqual(unusedTableBindings(read(`scripts/${name}`)), [], `scripts/${name} imports a name of a table and never uses it: its runner applies something else`);
  }
  for (const name of sabotageScripts) {
    const served = SERVED_BY[name];
    if (served === undefined) {
      const expected = name.replace(/-sabotage\.mjs$/, "-sabotages.mjs");
      assert.ok(importedBy.get(expected)?.includes(name), `scripts/${name} keeps its table inline: move it to tests/${expected}, where this test can check it`);
    } else {
      assert.ok(importedBy.get(served.table)?.includes(served.through), `scripts/${served.through} must import tests/${served.table}, which serves scripts/${name}`);
    }
  }
  for (const [table, users] of importedBy) {
    assert.ok(users.length > 0, `tests/${table} is read by no script: its sabotages are never run`);
  }
});

test("the wiring check bites: an imported table that the script never uses is found, one that it uses is not", () => {
  const imported = 'import {SABOTAGES as variants, SURFACE as surface} from "../tests/x-sabotages.mjs";\n';
  const unused = (...names) => names.map(binding => ({table: "x-sabotages.mjs", binding}));
  assert.deepEqual(unusedTableBindings(`${imported}const local = [];\nfor (const variant of local) {}\n`), unused("variants", "surface"));
  // A mention in a comment is not a use.
  assert.deepEqual(unusedTableBindings(`${imported}use(variants);\n// surface\n/* surface */\n`), unused("surface"));
  assert.deepEqual(unusedTableBindings(`${imported}use(variants, surface);\n`), []);
  assert.deepEqual(unusedTableBindings('import {SABOTAGES} from "../tests/x-sabotages.mjs";\nSABOTAGES.find(Boolean);\n'), []);
  assert.deepEqual(unusedTableBindings('import {SABOTAGES} from "../tests/x-sabotages.mjs";\n'), unused("SABOTAGES"));
});

test("the check bites: a table with a text that is not in its source, or twice, or unchanged, or a file that is not there, fails", async () => {
  const [table] = tables;
  const [first] = await load(table);
  const {find, replace} = editsOf(first)[0];
  const judge = fields => anchorProblems({table, entries: [{name: "mutated", file: first.file, target: first.target, find, replace, ...fields}], bases: BASES[table]});

  // The copy of a real entry, as it is, is fine: what follows differs from it by one fault each.
  assert.deepEqual(judge({}), []);
  // Its find is not in the source.
  const absent = judge({find: `${find}\u0000not in the source`});
  assert.equal(absent.length, 1, absent.join("\n"));
  assert.match(absent[0], /the text is not in .* where the sabotage must replace exactly one place/);
  // Its find occurs more than once (every line of a source ends with a newline).
  const ambiguous = judge({find: "\n"});
  assert.equal(ambiguous.length, 1, ambiguous.join("\n"));
  assert.match(ambiguous[0], /the text is \d+ times in/);
  // Its replacement changes nothing, so it breaks nothing.
  assert.match(judge({replace: find}).join("\n"), /the replacement is the text itself/);
  // Its file is not there.
  assert.match(judge({file: "no/such/file.txt"}).join("\n"), /cannot be read/);
  // Two sabotages of one table have one name.
  assert.match(anchorProblems({table, entries: [first, first], bases: BASES[table]}).join("\n"), /another sabotage of the table has it/);

  // The edits of an entry are judged in order, each against the text the one before it left, as the scripts apply them.
  const source = {"a.txt": "one two\n"};
  const edits = (...list) => anchorProblems({table: "synthetic", entries: [{name: "edits", file: "a.txt", edits: list}], readText: file => source[file]});
  assert.deepEqual(edits({find: "one", replace: "three"}, {find: "three two", replace: "x"}), []);
  assert.match(edits({find: "one", replace: "three"}, {find: "one", replace: "x"}).join("\n"), /edit 2 of 2.*not in a\.txt/);
  assert.match(edits({find: "one", replace: "two"}, {find: "two", replace: "x"}).join("\n"), /edit 2 of 2.*2 times in a\.txt/);
});
