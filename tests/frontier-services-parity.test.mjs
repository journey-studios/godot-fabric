import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {conforms, diffRegistrations, diffSchema, extractFrontierSchemas, TYPES_FILE, verifyFrontierServicesReport} from "./frontier-services-oracle.mjs";

// Parity of the Godot schemas and the TypeScript types, in both directions. The TypeScript side is read from the
// hand-written consumers/civ-lite/ui/frontier-types.ts with the TypeScript compiler API and converted to the registry's
// schema language; the Godot side is what the node registered, dumped by the native probe into its report (so this test
// runs after tests/frontier-services-native.test.mjs, which leaves it: `npm run test:frontier-services` runs both).
//
// Convention: the alias `Int` is the registry's `integer`; a bare `number` converts to `number` and so differs from a
// schema that says `integer`. A field more or less on either side, a different type, another number of arguments or a
// name registered on one side only fails, and the message says which. Synthetic mutations of each side, held back here,
// must be rejected by the comparison, so that a comparison that stopped comparing would fail this test.
const root = fileURLToPath(new URL("..", import.meta.url));
const digest = value => createHash("sha256").update(value).digest("hex");
const clone = value => JSON.parse(JSON.stringify(value));

const typesText = await readFile(path.join(root, TYPES_FILE), "utf8");
const report = JSON.parse(await readFile(path.join(root, "build/frontier-services-current-1-report.json"), "utf8"));
const typescript = extractFrontierSchemas(typesText);

// The registration that has this name, in a list.
const named = (registrations, name) => registrations.find(entry => entry.name === name);
// The object of a schema at a path of field names, `[]` standing for an array's element: ["actions", "[]", "args"].
function at(schema, pathNames) {
  let cursor = schema;
  for (const name of pathNames) {
    cursor = name === "[]" ? cursor.array : cursor.object[name];
  }
  return cursor;
}

test("the dump is of this tree: the report was made from the sources the types and the schemas are in now", async () => {
  for (const file of ["consumers/civ-lite/ui/frontier-types.ts", "consumers/civ-lite/services/schema.gd", "consumers/civ-lite/services/game_services.gd"]) {
    assert.equal(report.provenance.bundle.sources[file], digest(await readFile(path.join(root, file))), `${file} is the one the probe ran: run the native test first`);
  }
  assert.equal(report.sabotage, false);
  assert.equal(report.allPassed, true);
});

test("the TypeScript types and the schemas Godot registered declare the same names, fields and types", () => {
  assert.equal(typescript.registrations.length, 14, "one state, one signal and 12 methods");
  assert.deepEqual(diffRegistrations(typescript.registrations, report.registered), []);
  // The name constants are the registered names: a constant that named nothing would be a call to a missing service.
  assert.deepEqual(Object.values(typescript.constants).sort(), typescript.registrations.map(entry => entry.name).sort());
  assert.deepEqual(report.registered.map(entry => entry.kind).sort(), ["method", "method", "method", "method", "method", "method", "method", "method", "method",
    "method", "method", "method", "signal", "state"]);
  // The shapes the HUD leans on, spelled out once more.
  const snapshot = named(typescript.registrations, "frontier.snapshot").value;
  assert.deepEqual(at(snapshot, ["actions", "[]", "args"]), {array: "integer"}, "an action's args are the intent's positional arguments, integers");
  assert.equal(at(snapshot, ["epoch"]), "integer");
  assert.deepEqual(named(typescript.registrations, "frontier.turn_ended").args, [{object: {turn: "integer", phases: {array: {object: {name: "string", tasks: "integer", events: "integer"}}}}}]);
  assert.deepEqual(named(typescript.registrations, "frontier.set_production").args, ["string", "integer"]);
  assert.deepEqual(named(typescript.registrations, "frontier.end_turn").result, {object: {ok: "integer", code: "string", text: "string"}});
});

// Each case changes one thing at a path and says what the comparison must report. `side` is the side that is changed.
const mutations = [
  {name: "a snapshot field removed", target: "frontier.snapshot", change: value => delete at(value, []).object.epoch,
    expected: {godot: "frontier.snapshot.epoch: declared in TypeScript, missing from Godot's schema", typescript: "frontier.snapshot.epoch: registered by Godot, missing from the TypeScript types"}},
  {name: "a nested field removed", target: "frontier.snapshot", change: value => delete at(value, ["resources", "food"]).object.rate,
    expected: {godot: "frontier.snapshot.resources.food.rate: declared in TypeScript, missing from Godot's schema",
      typescript: "frontier.snapshot.resources.food.rate: registered by Godot, missing from the TypeScript types"}},
  {name: "the args element type swapped", target: "frontier.snapshot", change: value => { at(value, ["actions", "[]"]).object.args.array = "string"; },
    expected: {godot: "frontier.snapshot.actions[].args[]: TypeScript declares \"integer\", Godot registers \"string\"",
      typescript: "frontier.snapshot.actions[].args[]: TypeScript declares \"string\", Godot registers \"integer\""}},
  {name: "the args array turned into an object", target: "frontier.snapshot", change: value => { at(value, ["actions", "[]"]).object.args = {object: {unit_id: "integer"}}; },
    expected: {godot: "frontier.snapshot.actions[].args: TypeScript declares {\"array\":\"integer\"}, Godot registers {\"object\":{\"unit_id\":\"integer\"}}",
      typescript: "frontier.snapshot.actions[].args: TypeScript declares {\"object\":{\"unit_id\":\"integer\"}}, Godot registers {\"array\":\"integer\"}"}},
  {name: "a field added", target: "frontier.snapshot", change: value => { at(value, ["city"]).object.gold = "integer"; },
    expected: {godot: "frontier.snapshot.city.gold: registered by Godot, missing from the TypeScript types", typescript: "frontier.snapshot.city.gold: declared in TypeScript, missing from Godot's schema"}},
  {name: "integer swapped for string", target: "frontier.snapshot", change: value => { at(value, ["resources", "food"]).object.stock = "string"; },
    expected: {godot: "frontier.snapshot.resources.food.stock: TypeScript declares \"integer\", Godot registers \"string\"",
      typescript: "frontier.snapshot.resources.food.stock: TypeScript declares \"string\", Godot registers \"integer\""}},
  {name: "an array turned into its element", target: "frontier.snapshot", change: value => { at(value, ["research"]).object.techs = at(value, ["research", "techs", "[]"]); },
    expected: {godot: "frontier.snapshot.research.techs: TypeScript declares {\"array\":", typescript: "frontier.snapshot.research.techs: TypeScript declares {\"object\":"}},
  {name: "a signal payload field removed", target: "frontier.turn_ended", change: value => delete value.args[0].object.phases.array.object.events,
    expected: {godot: "frontier.turn_ended(arguments)[0].phases[].events: declared in TypeScript, missing from Godot's schema",
      typescript: "frontier.turn_ended(arguments)[0].phases[].events: registered by Godot, missing from the TypeScript types"}},
  {name: "an argument removed", target: "frontier.move_unit", change: value => value.args.pop(),
    expected: {godot: "frontier.move_unit: TypeScript declares 3 arguments, Godot registers 2", typescript: "frontier.move_unit: TypeScript declares 2 arguments, Godot registers 3"}},
  {name: "an argument added", target: "frontier.end_turn", change: value => value.args.push("integer"),
    expected: {godot: "frontier.end_turn: TypeScript declares 0 arguments, Godot registers 1", typescript: "frontier.end_turn: TypeScript declares 1 arguments, Godot registers 0"}},
  {name: "an argument's type swapped", target: "frontier.set_production", change: value => { value.args[1] = "string"; },
    expected: {godot: "frontier.set_production(arguments)[1]: TypeScript declares \"integer\", Godot registers \"string\"",
      typescript: "frontier.set_production(arguments)[1]: TypeScript declares \"string\", Godot registers \"integer\""}},
  {name: "a result field removed", target: "frontier.select_tile", change: value => delete value.result.object.text,
    expected: {godot: "frontier.select_tile result.text: declared in TypeScript, missing from Godot's schema", typescript: "frontier.select_tile result.text: registered by Godot, missing from the TypeScript types"}},
  {name: "a result field added", target: "frontier.end_turn", change: value => { value.result.object.turn = "integer"; },
    expected: {godot: "frontier.end_turn result.turn: registered by Godot, missing from the TypeScript types", typescript: "frontier.end_turn result.turn: declared in TypeScript, missing from Godot's schema"}},
];

test("a field more or less, or a type that differs, on either side fails the parity and names the field", () => {
  for (const mutation of mutations) {
    for (const side of ["godot", "typescript"]) {
      const declared = clone(typescript.registrations);
      const registered = clone(report.registered);
      const changed = named(side === "godot" ? registered : declared, mutation.target);
      mutation.change(changed.kind === "state" ? changed.value : changed, changed);
      // For a state the schema is the value; for the others the entry itself carries args and result.
      const differences = diffRegistrations(declared, registered);
      assert.ok(differences.length > 0, `${mutation.name} on the ${side} side must be rejected`);
      assert.ok(differences.some(line => line.startsWith(mutation.expected[side])), `${mutation.name} on the ${side} side: ${differences.join(" | ")}`);
    }
  }
});

test("a name registered on one side only, or of another kind, fails the parity", () => {
  const dropped = report.registered.filter(entry => entry.name !== "frontier.new_game");
  assert.deepEqual(diffRegistrations(typescript.registrations, dropped), ["frontier.new_game: declared in TypeScript, not registered by Godot"]);
  const extra = [...report.registered, {name: "frontier.teleport", kind: "method", args: ["integer"], result: named(report.registered, "frontier.end_turn").result}];
  assert.deepEqual(diffRegistrations(typescript.registrations, extra), ["frontier.teleport: registered by Godot, not declared in the TypeScript types"]);
  const asSignal = clone(report.registered);
  Object.assign(named(asSignal, "frontier.fortify"), {kind: "signal"});
  assert.deepEqual(diffRegistrations(typescript.registrations, asSignal), ["frontier.fortify: TypeScript declares a method, Godot registers a signal"]);
  assert.deepEqual(diffSchema("integer", "integer", "x"), []);
  assert.deepEqual(diffSchema({array: "string"}, {array: "string"}, "x"), []);
});

test("the extractor reads the convention and refuses what the schema language cannot say", () => {
  const variants = [
    ["an optional field", text => text.replace("readonly rate: Int;", "readonly rate?: Int;"), /Stock\.rate: an optional field has no schema/],
    ["any", text => text.replace("readonly label: string;\n  /**\n   * The intent's positional", "readonly label: any;\n  /**\n   * The intent's positional"), /Action\.label: AnyKeyword is not in the schema language/],
    ["unknown", text => text.replace("readonly detail: string;", "readonly detail: unknown;"), /Choice\.detail: UnknownKeyword is not in the schema language/],
    ["a union", text => text.replace("readonly code: string;", "readonly code: string | null;"), /FrontierResult\.code: UnionType is not in the schema language/],
    ["an inheritance", text => text.replace("export interface Stock {", "export interface Stock extends Selection {"), /Stock: an interface with type parameters or an extends clause has no schema/],
    ["a generic alias", text => text.replace("export type TurnPhase = {", "export type TurnPhase<T> = {"), /TurnPhase: a generic type alias has no schema/],
    ["an optional argument", text => text.replace("[x: Int, y: Int];", "[x: Int, y?: Int];"), /frontier\.select_tile\[1\]: an optional or rest argument has no schema/],
    ["a type that is not declared", text => text.replace("readonly selection: Selection;", "readonly selection: Selections;"), /FrontierSnapshot\.selection: Selections is not declared/],
    ["an integer alias that is not number", text => text.replace("export type Int = number;", "export type Int = string;"), /the integer alias must be `type Int = number`/],
  ];
  for (const [name, change, pattern] of variants) {
    const changed = change(typesText);
    assert.notEqual(changed, typesText, `${name}: the variant must change the text`);
    assert.throws(() => extractFrontierSchemas(changed), pattern, name);
  }
  // A bare `number` is read as `number`, and the parity then names the field against Godot's `integer`.
  const bare = extractFrontierSchemas(typesText.replace("readonly epoch: Int;", "readonly epoch: number;"));
  assert.ok(diffRegistrations(bare.registrations, report.registered).includes("frontier.snapshot.epoch: TypeScript declares \"number\", Godot registers \"integer\""));
});

test("the validator the oracle uses rejects a snapshot with a field more or less or of another type", () => {
  const snapshotSchema = named(typescript.registrations, "frontier.snapshot").value;
  const received = JSON.parse(report.steps[16].jsSnapshot);
  conforms(received, snapshotSchema, "snapshot");
  const cases = [
    ["a field removed", value => delete value.epoch, /snapshot has exactly the declared fields/],
    ["a field added", value => { value.city.gold = 1; }, /snapshot\.city has exactly the declared fields/],
    ["an integer turned into a string", value => { value.resources.food.stock = "3"; }, /snapshot\.resources\.food\.stock must be an integer/],
    ["a fraction", value => { value.turn = 1.5; }, /snapshot\.turn must be an integer/],
    ["a string turned into an integer", value => { value.actions[0].label = 1; }, /snapshot\.actions\[0\]\.label must be a string/],
    ["an object turned into an array", value => { value.selection = []; }, /snapshot\.selection must be an object/],
    ["an args element that is not an integer", value => { value.actions[0].args.push("x"); }, /snapshot\.actions\[0\]\.args\[0\] must be an integer/],
    ["args turned into an object", value => { value.actions[0].args = {unit_id: 0}; }, /snapshot\.actions\[0\]\.args must be an array/],
  ];
  for (const [name, change, pattern] of cases) {
    const mutant = clone(received);
    change(mutant);
    assert.throws(() => conforms(mutant, snapshotSchema, "snapshot"), pattern, name);
  }
});

test("an action is a call: the oracle rejects one whose args are not its method's arguments, or that was not accepted when enabled", () => {
  // The report's own hashes, so that the only thing wrong with a mutant is the mutation.
  const hashes = {goldenHash: report.finalHash, traceHash: digest(report.steps.map(step => step.hash).join("\n")), typesText};
  verifyFrontierServicesReport(report, hashes);
  // The stack on the start tile (step 2) offers one select_unit per unit: [1] and [2].
  assert.equal(JSON.parse(report.steps[2].jsSnapshot).actions.filter(action => action.id === "select_unit").length, 2);
  const withArgs = replacement => {
    const mutant = clone(report);
    for (const field of ["jsSnapshot", "godotSnapshot"]) {
      assert.ok(mutant.steps[2][field].includes("\"args\":[1],"));
      mutant.steps[2][field] = mutant.steps[2][field].replace("\"args\":[1],", `"args":${replacement},`);
    }
    return mutant;
  };
  assert.throws(() => verifyFrontierServicesReport(withArgs("[]"), hashes), /step 2 select_tile\(6, 8\): the action select_unit carries as many arguments as its method \(1\)/);
  assert.throws(() => verifyFrontierServicesReport(withArgs("[1,1]"), hashes), /step 2 select_tile\(6, 8\): the action select_unit carries as many arguments as its method \(1\)/);
  assert.throws(() => verifyFrontierServicesReport(withArgs("[\"1\"]"), hashes), /step 2 select_tile\(6, 8\) snapshot\.actions\[0\]\.args\[0\] must be an integer/);
  const refused = clone(report);
  refused.steps[2].actionsTried[0].ok = 0;
  assert.throws(() => verifyFrontierServicesReport(refused, hashes), /step 2 select_tile\(6, 8\): the action select_unit is accepted exactly when enabled/);
  const unsent = clone(report);
  unsent.steps[2].actionsTried.pop();
  assert.throws(() => verifyFrontierServicesReport(unsent, hashes), /step 2 select_tile\(6, 8\): every action of the snapshot was sent back/);
});
