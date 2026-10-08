import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import ts from "typescript";

// The independent oracle of Frontier's services. It judges the raw observations of the probe's report and none of the
// probe's verdicts (`checks`, `allPassed`), and it never reads the GDScript schemas: the schema every snapshot is
// validated against is derived here from the hand-written TypeScript types (consumers/civ-lite/ui/frontier-types.ts) with
// the TypeScript compiler API. That is also the extractor tests/frontier-services-parity.test.mjs compares with the
// schemas Godot registered, so the two sides of the parity are not written by the same hand.
//
// What it requires of the report, written again here from docs/research/frontier-services.md:
//   - the schemas the node registered are the TypeScript types', name by name and field by field;
//   - every snapshot JavaScript received conforms to those types, is the node's own snapshot, is canonical, and agrees
//     with the state the report serialized (turn, phase, selection, stocks);
//   - every action in every snapshot is a call: `frontier.<id>` takes exactly the arguments the action carries, and sent
//     back as they are on a copy of the reference game each enabled action was accepted and each disabled one refused;
//   - every method answered the uniform {ok, code, text}, with a code from the game's table and its text, and a refused
//     intent published nothing; an accepted one published exactly one snapshot; revisions only rose with those;
//   - an accepted end_turn emitted exactly one turn_ended, before that turn's snapshot, with the six phases in order;
//   - the epoch of the roteiro's snapshots is 1 and each new_game raised it by 1, back to the initial state, and the
//     epoch is outside the state (no `epoch` key) and outside the hash;
//   - SHA-256 of each reported serialization is its hash, the final one is the golden hash, and the hashes of the steps
//     make the trace hash the game fixed;
//   - the schema violations never ran GDScript; persistence kept the bindings, the generation, the state and the epoch;
//     and the largest snapshot is inside the transport's limits.

export const TYPES_FILE = "consumers/civ-lite/ui/frontier-types.ts";

const ROTEIRO_STEPS = 73;
const PHASES = ["ai_plan", "ai_move", "production", "growth", "research", "refresh"];
const TASK_LIMIT = 64;
const EVENT_LIMIT = 128;
const NODE_LIMIT = 10000;
const DEPTH_LIMIT = 32;
const BINDINGS = 13;
const NEW_GAMES = 3;
const PREFIX = "frontier.";

// The refusal codes and their texts: the table of docs/research/frontier-game.md.
const REFUSALS = {
  turn_in_progress: "The turn is being processed.",
  event_pending: "A decision is waiting. Resolve the event first.",
  no_turn_job: "No turn is being processed.",
  out_of_bounds: "That tile is outside the map.",
  nothing_selected: "Nothing is selected.",
  unknown_unit: "No such unit.",
  not_your_unit: "That unit belongs to another faction.",
  not_adjacent: "The destination is not an adjacent tile.",
  impassable_terrain: "Land units cannot enter water.",
  tile_occupied: "A foreign unit blocks that tile.",
  no_moves_left: "The unit has no movement points left.",
  not_enough_moves: "Not enough movement points for that terrain.",
  cannot_fortify: "Settlers cannot fortify.",
  already_fortified: "The unit is already fortified.",
  not_a_settler: "Only a Settler can found a city.",
  city_exists: "This scenario allows a single city.",
  too_close_to_edge: "A city needs open ground on every side.",
  no_city: "There is no city to manage yet.",
  unknown_item: "Unknown production item.",
  tech_required: "Research the required technology first.",
  already_built: "The city already has that building.",
  already_queued: "That building is already in the queue.",
  queue_full: "The production queue is full.",
  bad_slot: "Pick an existing queue slot or the next free one.",
  unknown_tech: "Unknown technology.",
  tech_known: "That technology is already known.",
  research_out_of_order: "Technologies are researched in list order.",
  already_researching: "That technology is already being researched.",
  no_event: "There is no event to resolve.",
  unknown_choice: "That is not one of the choices.",
};
// The 24 codes the roteiro plays; the other four of the table cannot be reached in the scenario.
const ROTEIRO_REFUSALS = ["out_of_bounds", "not_adjacent", "impassable_terrain", "not_your_unit", "unknown_unit", "no_moves_left", "not_enough_moves",
  "cannot_fortify", "already_fortified", "not_a_settler", "no_city", "unknown_item", "tech_required", "already_built", "already_queued", "bad_slot",
  "unknown_tech", "tech_known", "research_out_of_order", "already_researching", "event_pending", "unknown_choice", "no_event", "nothing_selected"].sort();
const UNIT_INTENTS = ["select_unit", "found_city", "fortify"];

const digest = value => createHash("sha256").update(value).digest("hex");

// --- The schemas, from the TypeScript types ----------------------------------------------------------------------

function unsupported(where, what) {
  throw new Error(`${where}: ${what}`);
}

// Reads the hand-written types with the TypeScript API and converts each shape to the registry's schema language
// (docs/GAME_SERVICES.md): "integer", "string", {array: schema} and {object: {field: schema}}. The alias `Int` is the
// integer; a bare `number` converts to "number", which the registry also has and the types do not use. What the language
// cannot say is refused by name, so the types cannot drift into it: an optional field, a union, `any`, `unknown`, a
// generic or an inheritance. Answers {registrations, constants}: one entry per registered name, in the form the probe
// reports what Godot registered: {name, kind: "state", value}, {name, kind: "signal", args} and
// {name, kind: "method", args, result}.
export function extractFrontierSchemas(text = readFileSync(new URL(`../${TYPES_FILE}`, import.meta.url), "utf8")) {
  const file = ts.createSourceFile(TYPES_FILE, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const declarations = new Map();
  const constants = {};
  for (const statement of file.statements) {
    if (ts.isInterfaceDeclaration(statement)) {
      if (statement.typeParameters !== undefined || statement.heritageClauses !== undefined) {
        unsupported(statement.name.text, "an interface with type parameters or an extends clause has no schema");
      }
      declarations.set(statement.name.text, {members: statement.members});
    } else if (ts.isTypeAliasDeclaration(statement)) {
      if (statement.typeParameters !== undefined) {
        unsupported(statement.name.text, "a generic type alias has no schema");
      }
      declarations.set(statement.name.text, {type: statement.type});
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer !== undefined && ts.isStringLiteral(declaration.initializer)) {
          constants[declaration.name.text] = declaration.initializer.text;
        }
      }
    }
  }
  const integer = declarations.get("Int");
  if (integer?.type?.kind !== ts.SyntaxKind.NumberKeyword) {
    unsupported("Int", "the integer alias must be `type Int = number`");
  }

  function schemaOf(node, where, visiting = []) {
    switch (node.kind) {
      case ts.SyntaxKind.StringKeyword:
        return "string";
      case ts.SyntaxKind.NumberKeyword:
        return "number";
      case ts.SyntaxKind.BooleanKeyword:
        return "boolean";
      case ts.SyntaxKind.ParenthesizedType:
        return schemaOf(node.type, where, visiting);
      case ts.SyntaxKind.TypeOperator:
        if (node.operator === ts.SyntaxKind.ReadonlyKeyword) {
          return schemaOf(node.type, where, visiting);
        }
        break;
      case ts.SyntaxKind.ArrayType:
        return {array: schemaOf(node.elementType, `${where}[]`, visiting)};
      case ts.SyntaxKind.TypeLiteral:
        return objectOf(node.members, where, visiting);
      case ts.SyntaxKind.TypeReference: {
        if (!ts.isIdentifier(node.typeName) || node.typeArguments !== undefined) {
          unsupported(where, "a qualified or generic type reference has no schema");
        }
        const name = node.typeName.text;
        if (name === "Int") {
          return "integer";
        }
        const declared = declarations.get(name);
        if (declared === undefined) {
          unsupported(where, `${name} is not declared in ${TYPES_FILE}`);
        }
        if (visiting.includes(name)) {
          unsupported(where, `${name} refers to itself, and the schema language has no recursion`);
        }
        const next = [...visiting, name];
        return declared.members === undefined ? schemaOf(declared.type, name, next) : objectOf(declared.members, name, next);
      }
      default:
        break;
    }
    return unsupported(where, `${ts.SyntaxKind[node.kind]} is not in the schema language (no optional field, union, any, unknown or generic)`);
  }

  function objectOf(members, where, visiting) {
    const fields = {};
    for (const member of members) {
      if (!ts.isPropertySignature(member) || member.type === undefined) {
        unsupported(where, "only plain properties belong in a schema");
      }
      if (!ts.isIdentifier(member.name) && !ts.isStringLiteral(member.name)) {
        unsupported(where, "a computed property name has no schema");
      }
      const name = member.name.text;
      if (member.questionToken !== undefined) {
        unsupported(`${where}.${name}`, "an optional field has no schema: the objects are exact");
      }
      fields[name] = schemaOf(member.type, `${where}.${name}`, visiting);
    }
    return {object: fields};
  }

  function tupleOf(node, where) {
    if (!ts.isTupleTypeNode(node)) {
      unsupported(where, "expected a tuple of arguments");
    }
    return node.elements.map((element, position) => {
      if (ts.isOptionalTypeNode(element) || ts.isRestTypeNode(element) || (ts.isNamedTupleMember(element) && (element.questionToken || element.dotDotDotToken))) {
        unsupported(`${where}[${position}]`, "an optional or rest argument has no schema");
      }
      return schemaOf(ts.isNamedTupleMember(element) ? element.type : element, `${where}[${position}]`);
    });
  }

  function membersOf(name) {
    const declared = declarations.get(name);
    if (declared?.members === undefined) {
      unsupported(name, `${TYPES_FILE} must declare the interface ${name}`);
    }
    return declared.members;
  }

  const result = objectOf(membersOf("FrontierResult"), "FrontierResult", ["FrontierResult"]);
  const registrations = [];
  for (const member of membersOf("FrontierStates")) {
    registrations.push({name: member.name.text, kind: "state", value: schemaOf(member.type, member.name.text)});
  }
  for (const member of membersOf("FrontierSignals")) {
    registrations.push({name: member.name.text, kind: "signal", args: tupleOf(member.type, member.name.text)});
  }
  for (const member of membersOf("FrontierMethods")) {
    registrations.push({name: member.name.text, kind: "method", args: tupleOf(member.type, member.name.text), result});
  }
  registrations.sort((a, b) => (a.name < b.name ? -1 : 1));
  return {registrations, constants};
}

const show = schema => {
  const text = JSON.stringify(schema);
  return text.length > 70 ? `${text.slice(0, 67)}...` : text;
};

// The differences between a schema the TypeScript types declare and one Godot registered, one line each, naming the
// field: `frontier.snapshot.actions[].reason_text: declared in TypeScript, missing from Godot's schema`.
export function diffSchema(typescript, godot, where) {
  if (typeof typescript === "string" || typeof godot === "string") {
    return typescript === godot ? [] : [`${where}: TypeScript declares ${show(typescript)}, Godot registers ${show(godot)}`];
  }
  if ("array" in typescript || "array" in godot) {
    if ("array" in typescript && "array" in godot) {
      return diffSchema(typescript.array, godot.array, `${where}[]`);
    }
    return [`${where}: TypeScript declares ${show(typescript)}, Godot registers ${show(godot)}`];
  }
  const declared = typescript.object;
  const registered = godot.object;
  const differences = [];
  for (const field of [...new Set([...Object.keys(declared), ...Object.keys(registered)])].sort()) {
    if (!(field in registered)) {
      differences.push(`${where}.${field}: declared in TypeScript, missing from Godot's schema`);
    } else if (!(field in declared)) {
      differences.push(`${where}.${field}: registered by Godot, missing from the TypeScript types`);
    } else {
      differences.push(...diffSchema(declared[field], registered[field], `${where}.${field}`));
    }
  }
  return differences;
}

function diffArguments(typescript, godot, where) {
  const differences = [];
  if (typescript.length !== godot.length) {
    differences.push(`${where}: TypeScript declares ${typescript.length} arguments, Godot registers ${godot.length}`);
  }
  for (let position = 0; position < Math.min(typescript.length, godot.length); position += 1) {
    differences.push(...diffSchema(typescript[position], godot[position], `${where}(arguments)[${position}]`));
  }
  return differences;
}

// Registrations against registrations, in both directions: a name registered on one side only, a different kind, an
// argument more or less, a field more or less, a type that differs.
export function diffRegistrations(typescript, godot) {
  const declared = new Map(typescript.map(entry => [entry.name, entry]));
  const registered = new Map(godot.map(entry => [entry.name, entry]));
  const differences = [];
  for (const name of [...new Set([...declared.keys(), ...registered.keys()])].sort()) {
    const one = declared.get(name);
    const other = registered.get(name);
    if (other === undefined) {
      differences.push(`${name}: declared in TypeScript, not registered by Godot`);
    } else if (one === undefined) {
      differences.push(`${name}: registered by Godot, not declared in the TypeScript types`);
    } else if (one.kind !== other.kind) {
      differences.push(`${name}: TypeScript declares a ${one.kind}, Godot registers a ${other.kind}`);
    } else if (one.kind === "state") {
      differences.push(...diffSchema(one.value, other.value, name));
    } else {
      differences.push(...diffArguments(one.args, other.args, name));
      if (one.kind === "method") {
        differences.push(...diffSchema(one.result, other.result, `${name} result`));
      }
    }
  }
  return differences;
}

// --- Validation of what JavaScript received ---------------------------------------------------------------------

// Exact validation of a value against a schema of the registry's language, with the path in the message.
export function conforms(value, schema, where) {
  if (schema === "integer") {
    assert.ok(Number.isSafeInteger(value), `${where} must be an integer`);
  } else if (schema === "string") {
    assert.equal(typeof value, "string", `${where} must be a string`);
  } else if ("array" in schema) {
    assert.ok(Array.isArray(value), `${where} must be an array`);
    value.forEach((item, position) => conforms(item, schema.array, `${where}[${position}]`));
  } else {
    assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), `${where} must be an object`);
    assert.deepEqual(Object.keys(value).sort(), Object.keys(schema.object).sort(), `${where} has exactly the declared fields`);
    for (const [field, inner] of Object.entries(schema.object)) {
      conforms(value[field], inner, `${where}.${field}`);
    }
  }
}

// The text of a value as the game writes it: keys sorted, no whitespace.
function canonical(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// How many values a DTO has, as the transport counts them (every scalar and every container is one), and how deep.
function measure(value, depth = 0) {
  let nodes = 1;
  let deepest = depth;
  if (value !== null && typeof value === "object") {
    for (const inner of Object.values(value)) {
      const measured = measure(inner, depth + 1);
      nodes += measured.nodes;
      deepest = Math.max(deepest, measured.depth);
    }
  }
  return {nodes, depth: deepest};
}

// --- The report ----------------------------------------------------------------------------------------------------

// Throws on the first thing the report cannot justify; answers what it counted otherwise.
export function verifyFrontierServicesReport(report, {goldenHash, traceHash, typesText} = {}) {
  assert.equal(report.scenario, "frontier-services", "the report is the services probe's");
  assert.ok(typeof goldenHash === "string" && typeof traceHash === "string", "the golden and trace hashes are the game's, handed in by the test");
  const types = extractFrontierSchemas(typesText);
  const snapshotSchema = types.registrations.find(entry => entry.name === `${PREFIX}snapshot`).value;
  const turnEndedSchema = types.registrations.find(entry => entry.name === `${PREFIX}turn_ended`).args[0];
  const resultSchema = types.registrations.find(entry => entry.name === `${PREFIX}end_turn`).result;
  const methods = new Map(types.registrations.filter(entry => entry.kind === "method").map(entry => [entry.name, entry]));

  // Registration: before anything mounted, every service was there, and the schemas are the types'.
  const registration = report.registration;
  assert.ok(registration !== undefined && registration.application.errors.length === 0
    && registration.application.snapshotReady === 1 && registration.application.signalReady === 1,
  `registration: the bundle's own connections, made as it evaluated, were not ready (${JSON.stringify(registration?.application.errors)})`);
  assert.equal(registration.snapshots, 1, "registration: the first connection received exactly the initial snapshot");
  assert.deepEqual(diffRegistrations(types.registrations, report.registered), [], "registration: the schemas Godot registered are not the TypeScript types'");
  assert.equal(report.registered.length, BINDINGS, "registration: one state, one signal and one method per intent");
  assert.equal(report.native.gameServices.bindings, BINDINGS, "registration: the registry holds every binding");
  assert.deepEqual(report.native.errors, [], "the application reports no error");

  assert.equal(report.roteiroSteps, ROTEIRO_STEPS, "the roteiro has its 73 steps");
  assert.equal(report.steps.length, ROTEIRO_STEPS, "every step of the roteiro was played through the services");

  const refusals = {};
  let accepted = 0;
  let actionsSentBack = 0;
  let turns = 0;
  let revision = null;
  let generation = null;
  let turn = 1;
  let lastSnapshotSeq = 0;
  const hashes = [];
  const largest = {nodes: 0, depth: 0, step: -1};
  report.steps.forEach((step, position) => {
    const where = `step ${step.index} ${step.intent}(${step.args.join(", ")})`;
    assert.equal(step.index, position, `${where}: the steps are in order`);
    const result = step.result;
    assert.equal(result.state, "resolved", `${where}: the call was answered`);
    assert.equal(result.method, `${PREFIX}${step.intent}`, `${where}: it called the service of its intent`);
    assert.deepEqual(result.args, step.args, `${where}: it sent the roteiro's arguments`);
    assert.equal(result.response, "completion", `${where}: a method answers on completion`);
    conforms(result.value, resultSchema, `${where} result`);
    const answer = result.value;
    assert.ok(answer.ok === 0 || answer.ok === 1, `${where}: ok is 0 or 1`);
    assert.equal(answer.code, step.expectedCode, `${where}: the roteiro expects ${step.expectedCode}`);
    if (answer.ok === 1) {
      assert.deepEqual([answer.code, answer.text], ["ok", ""], `${where}: an accepted intent answers ok and no text`);
    } else {
      assert.ok(answer.code in REFUSALS, `${where}: ${answer.code} is a refusal code of the game's table`);
      assert.equal(answer.text, REFUSALS[answer.code], `${where}: a refusal carries its code's text`);
      refusals[answer.code] = (refusals[answer.code] ?? 0) + 1;
    }

    // What was published: a refused intent changed nothing and published nothing; an accepted one, one snapshot.
    const takesTurn = step.intent === "end_turn" && answer.ok === 1;
    assert.equal(step.snapshotsEmitted, answer.ok, `${where}: ${answer.ok === 1 ? "an accepted intent publishes exactly one snapshot" : "a refused intent publishes nothing"}`);
    assert.equal(step.turnEndedEmitted, takesTurn ? 1 : 0, `${where}: turn_ended is emitted exactly once per accepted end_turn, and by nothing else`);

    // The snapshot JavaScript holds.
    const received = JSON.parse(step.jsSnapshot);
    assert.equal(step.jsSnapshot, canonical(received), `${where}: the received snapshot is canonical`);
    assert.equal(step.jsSnapshot, step.godotSnapshot, `${where}: the snapshot JavaScript holds is the node's, byte for byte`);
    conforms(received, snapshotSchema, `${where} snapshot`);
    assert.equal(received.version, 1, `${where}: DTO version`);
    assert.equal(received.epoch, 1, `${where}: the first session has epoch 1 at every step`);
    assert.equal(received.context, step.context, `${where}: the context the roteiro expects`);
    // The HUD's contract: an action is a call. `frontier.<id>` takes exactly the positional arguments the action carries,
    // by the schema the TypeScript types declare, so a caller needs no knowledge of which intent takes what; and each
    // enabled action, sent back as that call on a copy of the reference game, was accepted, each disabled one refused.
    assert.equal(step.actionsTried.length, received.actions.length, `${where}: every action of the snapshot was sent back`);
    received.actions.forEach((action, index) => {
      const method = methods.get(`${PREFIX}${action.id}`);
      assert.ok(method !== undefined, `${where}: the action ${action.id} names a registered method`);
      assert.equal(action.args.length, method.args.length, `${where}: the action ${action.id} carries as many arguments as its method (${method.args.length})`);
      method.args.forEach((schema, position) => conforms(action.args[position], schema, `${where} ${action.id} args[${position}]`));
      if (UNIT_INTENTS.includes(action.id)) {
        assert.ok(action.args[0] > 0, `${where}: ${action.id} names a unit`);
      }
      if (action.id === "found_city" || action.id === "fortify") {
        assert.deepEqual(action.args, [received.selection.unit], `${where}: ${action.id} is for the selected unit`);
      }
      const tried = step.actionsTried[index];
      assert.deepEqual([tried.id, tried.args], [action.id, action.args], `${where}: the action ${action.id} was sent back as it came`);
      assert.equal(tried.ok, action.enabled, `${where}: the action ${action.id} is accepted exactly when enabled`);
      assert.ok(tried.ok === 1 || tried.code === action.reason, `${where}: the action ${action.id} is refused with its reason`);
      actionsSentBack += 1;
    });
    const measured = measure(received);
    assert.ok(measured.nodes < NODE_LIMIT && measured.depth < DEPTH_LIMIT, `${where}: the snapshot is inside the transport's limits`);
    if (measured.nodes > largest.nodes) {
      Object.assign(largest, {...measured, step: step.index});
    }

    // The snapshot against the state the report serialized, which is the game's.
    const state = JSON.parse(step.serialization);
    assert.equal(step.serialization, canonical(state), `${where}: the state's serialization is canonical`);
    assert.ok(!("epoch" in state), `${where}: the epoch is not in the state`);
    assert.deepEqual([received.turn, received.phase], [state.turn, state.phase], `${where}: the snapshot is of the state's turn and phase`);
    assert.deepEqual(received.selection, {x: state.sel.x, y: state.sel.y, unit: state.sel.unit}, `${where}: the snapshot's selection is the state's`);
    assert.deepEqual([received.resources.food.stock, received.resources.production.stock, received.resources.science.stock],
      [state.res.food, state.res.production, state.res.science], `${where}: the snapshot's stocks are the state's`);
    assert.equal(received.city.present, state.cities.length, `${where}: the snapshot has the city the state has`);
    assert.equal(digest(step.serialization), step.hash, `${where}: the hash is SHA-256 of the serialization`);
    assert.equal(step.hash, step.shadowHash, `${where}: the node's state is the roteiro's own session's`);
    hashes.push(step.hash);

    // Ordering and revisions.
    if (generation === null) {
      generation = step.generation;
    }
    assert.equal(step.generation, generation, `${where}: the registration generation never changes`);
    if (revision !== null) {
      assert.ok(answer.ok === 1 ? step.revision > revision : step.revision === revision, `${where}: the revision rises with a published snapshot and only then`);
    }
    revision = step.revision;
    if (answer.ok === 1) {
      accepted += 1;
      assert.ok(step.snapshotSeq > lastSnapshotSeq, `${where}: the snapshots arrive in order`);
      lastSnapshotSeq = step.snapshotSeq;
    }
    if (takesTurn) {
      turns += 1;
      conforms(step.turnEnded, turnEndedSchema, `${where} turn_ended`);
      assert.deepEqual(step.turnEnded.phases.map(phase => phase.name), PHASES, `${where}: turn_ended lists the six phases in their order`);
      assert.ok(step.turnEnded.phases.every(phase => phase.tasks <= TASK_LIMIT && phase.events <= EVENT_LIMIT), `${where}: every phase is within 64 tasks and 128 events`);
      assert.equal(step.turnEnded.turn, turn + 1, `${where}: turn_ended carries the turn that begins`);
      assert.equal(step.turnEnded.turn, received.turn, `${where}: turn_ended agrees with the snapshot of the turn that begins`);
      assert.ok(step.turnEndedSeq < step.snapshotSeq, `${where}: turn_ended comes before the snapshot of the turn that begins`);
      turn += 1;
    } else {
      assert.equal(received.turn, turn, `${where}: the turn only moves with an accepted end_turn`);
    }
  });
  assert.equal(turns, 12, "the roteiro ends 12 turns");
  assert.deepEqual(Object.keys(refusals).sort(), ROTEIRO_REFUSALS, "the roteiro is refused with every code it documents, through the services");

  // The hash: the epoch is outside the state, and the state is the game's golden one.
  const last = report.steps.at(-1);
  assert.equal(report.finalSerialization, last.serialization, "the final state is the last step's");
  assert.equal(digest(report.finalSerialization), report.finalHash, "the final hash is SHA-256 of the final serialization");
  assert.equal(report.finalHash, goldenHash, "the hash of the state the services left is the game's golden hash");
  assert.equal(digest(hashes.join("\n")), traceHash, "the states after every step are the trace the game fixed");
  assert.equal(report.steps[0].result.value.ok, 0, "the roteiro opens with a refusal, which leaves the initial state");
  assert.equal(report.initialHash, report.steps[0].hash, "the initial state's hash is the one a refusal leaves");

  // Epochs.
  assert.equal(report.epochs.length, NEW_GAMES, "three new games");
  let epoch = 1;
  report.epochs.forEach((entry, position) => {
    const where = `new_game ${position + 1}`;
    const received = JSON.parse(entry.jsSnapshot);
    conforms(received, snapshotSchema, `${where} snapshot`);
    assert.ok(entry.epoch > epoch, `${where}: the epoch rises strictly`);
    assert.equal(entry.epoch, epoch + 1, `${where}: the epoch rises by 1`);
    epoch = entry.epoch;
    assert.equal(received.epoch, entry.epoch, `${where}: the snapshot carries the epoch`);
    assert.equal(entry.jsSnapshot, entry.godotSnapshot, `${where}: the snapshot JavaScript holds is the node's`);
    assert.deepEqual(entry.result, {ok: 1, code: "ok", text: ""}, `${where}: accepted with the uniform result`);
    assert.deepEqual([entry.snapshotsEmitted, entry.turnEndedEmitted, entry.callbacksDelta], [1, 0, 1], `${where}: one snapshot, no turn_ended, one callback`);
    assert.equal(entry.hash, report.initialHash, `${where}: the state is the scenario's initial one: the epoch is outside the hash`);
    assert.deepEqual([received.turn, received.context, received.selection.x], [1, "none", -1], `${where}: the snapshot is of a fresh game`);
    const measured = measure(received);
    assert.ok(measured.nodes < NODE_LIMIT && measured.depth < DEPTH_LIMIT, `${where}: inside the transport's limits`);
  });
  assert.deepEqual(report.epochs.map(entry => entry.epoch), [2, 3, 4], "the epochs of the three new games");
  conforms(JSON.parse(report.liveStep.jsSnapshot), snapshotSchema, "the step after the last new game, snapshot");
  assert.equal(JSON.parse(report.liveStep.jsSnapshot).epoch, 4, "the game after the last new game answers in epoch 4");

  // Schema violations.
  assert.ok(report.violations.length >= 2, "the schema violations were played");
  const missing = report.violations.at(-1);
  assert.equal(missing.result.error.code, "E_SERVICE_MISSING", "a service that was never registered is a different error");
  for (const violation of report.violations.slice(0, -1)) {
    const where = `violation "${violation.label}"`;
    assert.equal(violation.result.state, "rejected", `${where} is rejected`);
    assert.equal(violation.result.error.code, "E_SERVICE_SCHEMA", `${where} is rejected by the schema`);
    assert.deepEqual([violation.callbacksDelta, violation.snapshotsEmitted, violation.turnEndedEmitted, violation.hashUnchanged], [0, 0, 0, true],
      `${where} never ran GDScript, published nothing and changed nothing`);
  }
  for (const kind of ["wrong type", "arity", "extra field"]) {
    assert.ok(report.violations.some(violation => violation.label.startsWith(kind)), `the violations include ${kind}`);
  }

  // Persistence across an unmounted surface.
  const kept = report.persistence;
  assert.deepEqual(kept.unmounted, kept.before, "unmounting the surface changed nothing the node owns");
  assert.equal(kept.before.bindings, BINDINGS, "the registry held every binding before the unmount");
  assert.equal(kept.remounted.bindings, BINDINGS, "and after the remount");
  assert.deepEqual([kept.remounted.registered, kept.remounted.epoch, kept.remounted.sameNode, kept.remounted.sameGame], [BINDINGS, 1, true, true],
    "the node, its game and its epoch are the ones from before");
  assert.equal(kept.firstPanelGeneration, kept.before.generation, "the remounted root connected to the same registration generation");
  assert.equal(kept.firstPanelSnapshot, report.steps[kept.playedUnmountedStep].godotSnapshot,
    "the remounted root's first value is the snapshot the step played with no surface left");
  assert.notEqual(kept.moved.hash, kept.before.hash, "a step played with no surface at all changed the game");
  assert.ok(kept.panel.connected && kept.panel.mounts === 2 && kept.panel.cleanups === 1 && kept.panel.error === null, "the panel mounted twice and cleaned up once");

  // Limits.
  assert.deepEqual([report.limits.maxNodes, report.limits.maxDepth], [largest.nodes, largest.depth], "the reported limits are what the snapshots measure");
  assert.ok(largest.nodes < NODE_LIMIT && largest.depth < DEPTH_LIMIT, "the largest snapshot is inside the transport's limits");

  return {steps: report.steps.length, accepted, refused: report.steps.length - accepted, refusals, turns, epochs: report.epochs.map(entry => entry.epoch),
    finalHash: report.finalHash, largest, violations: report.violations.length, registrations: report.registered.length, actionsSentBack, hashes};
}
