import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {conforms, diffRegistrations, diffSchema, extractFrontierSchemas, TYPES_FILE, verifyFrontierServicesReport, verifyRuleLane} from "./frontier-services-oracle.mjs";

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
  assert.equal(typescript.registrations.length, 18, "two states (the snapshot and the hover), one signal and 15 methods");
  assert.deepEqual(diffRegistrations(typescript.registrations, report.registered), []);
  // The name constants are the registered names: a constant that named nothing would be a call to a missing service.
  assert.deepEqual(Object.values(typescript.constants).sort(), typescript.registrations.map(entry => entry.name).sort());
  assert.deepEqual(report.registered.map(entry => entry.kind).sort(), ["method", "method", "method", "method", "method", "method", "method", "method", "method",
    "method", "method", "method", "method", "method", "method", "signal", "state", "state"]);
  // The shapes the HUD leans on, spelled out once more.
  const snapshot = named(typescript.registrations, "frontier.snapshot").value;
  // The hover is the card of the tile under the pointer: the same DTO as the snapshot's `tile`, on both sides.
  assert.deepEqual(named(typescript.registrations, "frontier.hover").value, at(snapshot, ["tile"]), "the hover is the snapshot's tile card");
  assert.deepEqual(named(report.registered, "frontier.hover").value, named(report.registered, "frontier.snapshot").value.object.tile, "and so it is in Godot's schemas");
  assert.deepEqual(at(snapshot, ["actions", "[]", "args"]), {array: "integer"}, "an action's args are the intent's positional arguments, integers");
  assert.equal(at(snapshot, ["epoch"]), "integer");
  assert.equal(at(snapshot, ["last_job"]), "integer", "the snapshot carries the last job that finished");
  assert.deepEqual(named(typescript.registrations, "frontier.turn_ended").args,
    [{object: {turn: "integer", phases: {array: {object: {name: "string", tasks: "integer", events: "integer"}}}, job: "integer"}}]);
  assert.deepEqual(named(typescript.registrations, "frontier.set_production").args, ["string", "integer"]);
  // One result for every method: the job a call started is 0 for all but an accepted end_turn.
  assert.deepEqual(named(typescript.registrations, "frontier.end_turn").result, {object: {ok: "integer", code: "string", text: "string", job: "integer"}});
  assert.deepEqual(typescript.registrations.filter(entry => entry.kind === "method").map(entry => entry.result),
    Array(15).fill({object: {ok: "integer", code: "string", text: "string", job: "integer"}}));
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
  {name: "the result's job removed", target: "frontier.end_turn", change: value => delete value.result.object.job,
    expected: {godot: "frontier.end_turn result.job: declared in TypeScript, missing from Godot's schema", typescript: "frontier.end_turn result.job: registered by Godot, missing from the TypeScript types"}},
  {name: "the result's job removed from a method that starts no job", target: "frontier.select_unit", change: value => delete value.result.object.job,
    expected: {godot: "frontier.select_unit result.job: declared in TypeScript, missing from Godot's schema", typescript: "frontier.select_unit result.job: registered by Godot, missing from the TypeScript types"}},
  {name: "the snapshot's last_job removed", target: "frontier.snapshot", change: value => delete at(value, []).object.last_job,
    expected: {godot: "frontier.snapshot.last_job: declared in TypeScript, missing from Godot's schema", typescript: "frontier.snapshot.last_job: registered by Godot, missing from the TypeScript types"}},
  {name: "the signal's job removed", target: "frontier.turn_ended", change: value => delete value.args[0].object.job,
    expected: {godot: "frontier.turn_ended(arguments)[0].job: declared in TypeScript, missing from Godot's schema", typescript: "frontier.turn_ended(arguments)[0].job: registered by Godot, missing from the TypeScript types"}},
  {name: "the dialog's index removed", target: "frontier.snapshot", change: value => delete at(value, ["dialog"]).object.index,
    expected: {godot: "frontier.snapshot.dialog.index: declared in TypeScript, missing from Godot's schema", typescript: "frontier.snapshot.dialog.index: registered by Godot, missing from the TypeScript types"}},
  {name: "the dialog's count turned into a string", target: "frontier.snapshot", change: value => { at(value, ["dialog"]).object.count = "string"; },
    expected: {godot: "frontier.snapshot.dialog.count: TypeScript declares \"integer\", Godot registers \"string\"", typescript: "frontier.snapshot.dialog.count: TypeScript declares \"string\", Godot registers \"integer\""}},
  {name: "a hover card field removed", target: "frontier.hover", change: value => delete at(value, []).object.terrain_name,
    expected: {godot: "frontier.hover.terrain_name: declared in TypeScript, missing from Godot's schema", typescript: "frontier.hover.terrain_name: registered by Godot, missing from the TypeScript types"}},
  {name: "a hover card unit's type swapped", target: "frontier.hover", change: value => { at(value, ["units", "[]"]).object.moves = "string"; },
    expected: {godot: "frontier.hover.units[].moves: TypeScript declares \"integer\", Godot registers \"string\"", typescript: "frontier.hover.units[].moves: TypeScript declares \"string\", Godot registers \"integer\""}},
  {name: "the job's type swapped", target: "frontier.end_turn", change: value => { value.result.object.job = "string"; },
    expected: {godot: "frontier.end_turn result.job: TypeScript declares \"integer\", Godot registers \"string\"", typescript: "frontier.end_turn result.job: TypeScript declares \"string\", Godot registers \"integer\""}},
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
  // An optional field is `{optional: schema}`, and the parity names it against Godot's registration: the snapshot's `stress` is the one the types declare.
  const optionalRate = extractFrontierSchemas(typesText.replace("readonly rate: Int;", "readonly rate?: Int;"));
  assert.deepEqual(at(named(optionalRate.registrations, "frontier.snapshot").value, ["resources", "food"]).object.rate, {optional: "integer"});
  assert.ok(diffRegistrations(optionalRate.registrations, report.registered).some(line => /stock\.rate: TypeScript declares/.test(line) || /\.rate: TypeScript declares/.test(line)),
    "a field optional in TypeScript and required in Godot is a difference");
  assert.equal(at(named(typescript.registrations, "frontier.snapshot").value, ["stress"]).optional.object.log.array, "string", "the snapshot's stress is optional in TypeScript");
  assert.deepEqual(at(named(report.registered, "frontier.snapshot").value, ["stress"]), at(named(typescript.registrations, "frontier.snapshot").value, ["stress"]), "and in Godot's schema");
  // A bare `number` is read as `number`, and the parity then names the field against Godot's `integer`.
  const bare = extractFrontierSchemas(typesText.replace("readonly epoch: Int;", "readonly epoch: number;"));
  assert.ok(diffRegistrations(bare.registrations, report.registered).includes("frontier.snapshot.epoch: TypeScript declares \"number\", Godot registers \"integer\""));
});

test("end_turn is registered to answer on acceptance and every other method on completion", () => {
  assert.deepEqual(report.registered.filter(entry => entry.kind === "method").map(entry => [entry.name, entry.response]).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    typescript.registrations.filter(entry => entry.kind === "method").map(entry => [entry.name, entry.name === "frontier.end_turn" ? "acceptance" : "completion"]));
});

test("the validator the oracle uses rejects a snapshot with a field more or less or of another type", () => {
  const snapshotSchema = named(typescript.registrations, "frontier.snapshot").value;
  const received = JSON.parse(report.steps[16].jsSnapshot);
  conforms(received, snapshotSchema, "snapshot");
  // The optional field is accepted when it is absent (the snapshot above) and when it is there with the declared shape.
  conforms({...received, stress: {log: ["00001 a line"], production: [{id: 0, label: "Item 00", progress: 0, cost: 100}]}}, snapshotSchema, "snapshot");
  const cases = [
    ["a field removed", value => delete value.epoch, /snapshot has the required fields and no field the declaration does not name/],
    ["a field added", value => { value.city.gold = 1; }, /snapshot\.city has the required fields and no field the declaration does not name/],
    ["a stress overlay of another shape", value => { value.stress = {log: "x", production: []}; }, /snapshot\.stress\.log must be an array/],
    ["a stress overlay with a field more", value => { value.stress = {log: [], production: [], gold: 1}; }, /snapshot\.stress has the required fields and no field the declaration does not name/],
    ["a stress overlay without its list", value => { value.stress = {log: []}; }, /snapshot\.stress has the required fields and no field the declaration does not name/],
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

test("a job is judged: the oracle rejects one that skipped a phase, ran in one frame, finished twice, was accepted with the wrong id, or left work pending", () => {
  const hashes = {goldenHash: report.finalHash, traceHash: digest(report.steps.map(step => step.hash).join("\n")), typesText};
  verifyFrontierServicesReport(report, hashes);
  const first = report.steps.findIndex(step => step.intent === "end_turn" && step.result.value.ok === 1);
  const variants = [
    ["a phase's snapshot never published", mutant => { mutant.steps[first].job.progress.splice(3, 1); }, /JavaScript saw the turn go through every phase/],
    ["last_job set before the job finished", mutant => { mutant.steps[first].job.progress[2].last_job = 1; }, /last_job is the previous job until this one finishes/],
    ["the six phases in one frame", mutant => { mutant.steps[first].job.rows.filter(row => row.kind === "snapshot").forEach(row => { row.frame = 100; }); }, /seven consecutive frames/],
    ["a job that finished twice", mutant => { mutant.steps[first].turnEndedEmitted = 2; }, /turn_ended is emitted exactly once per accepted end_turn/],
    ["the game counted the job twice", mutant => { mutant.steps[first].job.finishedCount = 2; }, /the game finished the job exactly once/],
    ["an acceptance with the wrong id", mutant => { mutant.steps[first].result.value.job = 7; }, /answers the next job id/],
    ["an end_turn that answered on completion", mutant => { mutant.steps[first].result.response = "completion"; }, /answers on acceptance/],
    ["a refused end_turn that started a job", mutant => { mutant.steps.find(step => step.intent === "end_turn" && step.result.value.ok === 0).result.value.job = 5; }, /answers job 0/],
    ["a pump that left events pending", mutant => { mutant.steps[first].job.pumps[2].after.pendingEvents = 3; }, /the pump left nothing pending/],
    ["a pump over the event budget", mutant => { mutant.steps[first].job.pumps[2].after.eventsSent += 200; }, /at most 128 events/],
    ["a pump over the task budget", mutant => { mutant.steps[first].job.pumps[2].after.hostTasksRun += 100; }, /at most 64 tasks/],
    ["a call accepted while the job ran", mutant => { mutant.jobLane.burst.job.attempts[0].value = {ok: 1, code: "ok", text: "", job: 0}; }, /refused with turn_in_progress/],
    ["a root held while the screen was closed", mutant => { mutant.persistence.job.rootCounts[1] = 1; }, /held no root/],
    ["a screen closed after the job had run", mutant => { mutant.persistence.job.phaseAtUnmount = "production"; }, /first phase not yet run/],
    ["a job received twice after the remount", mutant => { mutant.persistence.job.turnEndedForJob = 2; }, /received turn_ended for the job exactly once/],
    ["a remounted root at the wrong job", mutant => { mutant.persistence.job.firstPanel.last_job = 2; }, /first snapshot is at rest/],
    ["a delivery out of order", mutant => { const arrivals = mutant.jobLane.stress.isolated.arrivals; [arrivals[3], arrivals[4]] = [arrivals[4], arrivals[3]]; }, /\(FIFO\)/],
    ["a subscriber that lost a snapshot", mutant => { mutant.jobLane.stress.isolated.received[5].splice(3, 1); }, /none lost, none repeated/],
    ["a drain in more pumps than its events take", mutant => { mutant.jobLane.stress.isolated.drains[2].pumps = [100, 28, 24]; }, /drained in ceil\(152 \/ 128\) pumps/],
    ["a backlog that never grew", mutant => { mutant.jobLane.stress.free.pending = mutant.jobLane.stress.free.pending.map(() => 0); }, /the acceptance left one publication waiting/],
    ["a job lost from the log", mutant => { mutant.jobs.turnEndedLog.splice(4, 1); }, /received turn_ended for each job, once, in order/],
  ];
  for (const [name, change, pattern] of variants) {
    const mutant = clone(report);
    change(mutant);
    assert.throws(() => verifyFrontierServicesReport(mutant, hashes), pattern, name);
  }
});

test("the rule lane's oracle accepts what the mutation predicts and rejects anything else", async () => {
  const genuine = JSON.parse(await readFile(path.join(root, "build/frontier-services-rule-genuine-1-report.json"), "utf8"));
  const mutated = JSON.parse(await readFile(path.join(root, "build/frontier-services-rule-mutated-1-report.json"), "utf8"));
  const bundle = genuine.provenance.bundle.bundle.sha256;
  const options = {genuineMoves: 2, mutatedMoves: 0, typesText, bundleSha256: {genuine: bundle, mutated: bundle},
    genuineRulesSha256: genuine.provenance.bundle.sources["consumers/civ-lite/game/rules.gd"], mutatedRulesSha256: mutated.provenance.bundle.sources["consumers/civ-lite/game/rules.gd"]};
  const result = verifyRuleLane(genuine, mutated, options);
  assert.equal(result.refusedMove, "no_moves_left");
  assert.equal(result.bundleSha256, bundle);
  const variants = [
    ["the bundle changed", () => [genuine, mutated, {...options, bundleSha256: {genuine: bundle, mutated: bundle.replace(/^./, "0")}}], /the JavaScript bundle is the same in both runs/],
    ["the rules are the same", () => [genuine, mutated, {...options, mutatedRulesSha256: options.genuineRulesSha256}], /rules.gd is not the same in both runs/],
    ["something else changed in the snapshot", () => {
      const other = clone(mutated);
      const snapshot = JSON.parse(other.ruleLane.rows[2].snapshot);
      snapshot.resources.food.stock += 1;
      other.ruleLane.rows[2].snapshot = JSON.stringify(snapshot);
      return [genuine, other, options];
    }, /found_city, its reason and the Settler's card are all that differ/],
    ["the rule did not change the snapshot", () => {
      const other = clone(mutated);
      other.ruleLane.rows[2].snapshot = genuine.ruleLane.rows[2].snapshot;
      return [genuine, other, options];
    }, /found_city is turned off by the game's rule with no_moves_left/],
    ["the mutated move was accepted", () => {
      const other = clone(mutated);
      other.ruleLane.rows[3].result = genuine.ruleLane.rows[3].result;
      return [genuine, other, options];
    }, /the same move is refused by the game's rule/],
    ["the state was the same", () => {
      const other = clone(mutated);
      other.ruleLane.rows[1].hash = genuine.ruleLane.rows[1].hash;
      return [genuine, other, options];
    }, /the state is not the same in both runs/],
  ];
  for (const [name, build, pattern] of variants) {
    assert.throws(() => verifyRuleLane(...build()), pattern, name);
  }
});
