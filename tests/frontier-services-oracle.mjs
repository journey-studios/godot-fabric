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
//   - every method answered the uniform {ok, code, text, job}, with a code from the game's table and its text, and a refused
//     intent published nothing; an accepted one published exactly one snapshot; revisions only rose with those;
//   - end_turn is an accepted job: it answers on acceptance, with the id of the job (1, 2, 3 ... for the accepted ones, 0 when
//     refused), and the job goes on in the node, advancing one phase per frame: seven snapshots in seven consecutive frames (the first phase
//     at acceptance, then one after each of the six phases, which show the turn's progress and end at rest), and exactly one
//     turn_ended with that job, after the snapshot of the last phase and before the snapshot of the turn that begins, whose
//     `last_job` is the job; every frame of a job fits in one pump (64 tasks, 128 events) and leaves nothing pending;
//   - the job outlives the screen: closed in the frame after the acceptance, it finished with no root, once, and the
//     application's own subscription received its turn_ended once, also after the remount;
//   - every call made while a job runs was refused with turn_in_progress and started no job;
//   - the registry's budgets under 150 more subscribers: a publication of more than 128 events drains in ceil(events / 128)
//     pumps, every subscriber receives exactly one snapshot per publication, in the order they were queued;
//   - the epoch of the roteiro's snapshots is 1 and each new_game raised it by 1, back to the initial state, and the
//     epoch is outside the state (no `epoch` key) and outside the hash;
//   - SHA-256 of each reported serialization is its hash, the final one is the golden hash, and the hashes of the steps
//     make the trace hash the game fixed;
//   - the schema violations never ran GDScript; persistence kept the bindings, the generation, the state and the epoch;
//     and the largest snapshot is inside the transport's limits.

export const TYPES_FILE = "consumers/civ-lite/ui/frontier-types.ts";

const ROTEIRO_STEPS = 77;
const UNMOUNT_AFTER_TURNS = 3;
const PHASES = ["ai_plan", "ai_move", "production", "growth", "research", "refresh"];
const TASK_LIMIT = 64;
const EVENT_LIMIT = 128;
const NODE_LIMIT = 10000;
const DEPTH_LIMIT = 32;
const BINDINGS = 18;
const NEW_GAMES = 3;
const JOB_SNAPSHOTS = 7;
const STRESS_SUBSCRIBERS = 150;
const DURING_JOB_CALLS = 10;
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
    return unsupported(where, `${ts.SyntaxKind[node.kind]} is not in the schema language (no union, any, unknown or generic)`);
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
      const field = schemaOf(member.type, `${where}.${name}`, visiting);
      // An optional field is `{optional: schema}`: the one place the registry's language has it (an object's field, never an element or an argument).
      fields[name] = member.questionToken === undefined ? field : {optional: field};
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
  if ("optional" in typescript || "optional" in godot) {
    if ("optional" in typescript && "optional" in godot) {
      return diffSchema(typescript.optional, godot.optional, where);
    }
    return [`${where}: TypeScript declares ${show(typescript)}, Godot registers ${show(godot)}`];
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
    const required = Object.entries(schema.object).filter(([, inner]) => typeof inner === "string" || !("optional" in inner)).map(([field]) => field);
    const declared = Object.keys(schema.object);
    assert.ok(required.every(field => field in value) && Object.keys(value).every(field => declared.includes(field)),
      `${where} has the required fields and no field the declaration does not name`);
    for (const [field, inner] of Object.entries(schema.object)) {
      if (field in value) {
        conforms(value[field], typeof inner !== "string" && "optional" in inner ? inner.optional : inner, `${where}.${field}`);
      }
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

// --- A job ----------------------------------------------------------------------------------------------------------

const sum = list => list.reduce((total, value) => total + value, 0);
const range = (from, to) => Array.from({length: to - from + 1}, (_, position) => from + position);

// Judges what the probe kept of one end-of-turn job: what JavaScript saw (a snapshot per phase, the old turn and the old
// last_job until it finished), the frame each snapshot was published in on the Godot side, and what the registry held before
// and after the pump of each of those frames. `ended` and `turnEndedSeq` are the signal JavaScript received.
function verifyJob(job, {where, jobId, turnBefore, lastJobBefore, turnEndedSeq, duringCalls = 0}) {
  assert.equal(job.id, jobId, `${where}: the record is of the job the acceptance answered`);
  assert.deepEqual(job.progress.map(entry => entry.phase), [...PHASES, "idle"], `${where}: JavaScript saw the turn go through every phase and arrive at rest`);
  assert.deepEqual(job.progress.map(entry => entry.turn), [...Array(PHASES.length).fill(turnBefore), turnBefore + 1],
    `${where}: the snapshots show the old turn until the job finishes, and then the turn that begins`);
  assert.deepEqual(job.progress.map(entry => entry.last_job), [...Array(PHASES.length).fill(lastJobBefore), jobId],
    `${where}: last_job is the previous job until this one finishes, and then this one`);
  job.progress.slice(1).forEach((entry, position) => {
    assert.equal(entry.revision, job.progress[position].revision + 1, `${where}: one revision per snapshot, none skipped`);
    assert.ok(entry.seq > job.progress[position].seq, `${where}: the snapshots arrive in order`);
  });
  assert.ok(job.progress[PHASES.length - 1].seq < turnEndedSeq && turnEndedSeq < job.progress[PHASES.length].seq,
    `${where}: turn_ended comes after the snapshot of the last phase and before the snapshot of the turn that begins`);

  // The node on the Godot side: one phase per frame, and turn_ended once, in the frame of the last phase, ahead of its snapshot.
  assert.deepEqual(job.rows.map(row => row.kind), [...Array(PHASES.length).fill("snapshot"), "turn_ended", "snapshot"],
    `${where}: the node published a snapshot for each phase, then turn_ended once, then the snapshot of the turn that begins`);
  const published = job.rows.filter(row => row.kind === "snapshot");
  assert.deepEqual(published.map(row => row.phase), [...PHASES, "idle"], `${where}: the node's snapshots are of the phases in order`);
  assert.deepEqual(published.map(row => row.frame), range(published[0].frame, published[0].frame + PHASES.length),
    `${where}: the node ran one phase a frame: its seven snapshots were published in seven consecutive frames`);
  const ended = job.rows.find(row => row.kind === "turn_ended");
  assert.deepEqual([ended.job, ended.turn, ended.frame], [jobId, turnBefore + 1, published.at(-1).frame],
    `${where}: turn_ended finishes the job in the frame of the last phase`);

  // The registry: one pump per frame is enough. The tasks and events here are the registry's (calls run, signals sent), and
  // not the game's own counters that turn_ended reports for each phase.
  assert.equal(job.pumps.length, JOB_SNAPSHOTS, `${where}: the registry was read for each of the seven frames`);
  job.pumps.forEach((pump, position) => {
    const frame = `${where}, frame ${pump.frame} (${pump.phase})`;
    assert.equal(pump.frame, published[position].frame, `${frame}: the pump is of the frame of the snapshot`);
    assert.ok(Object.keys(pump.before).length === 4 && Object.keys(pump.after).length === 4, `${frame}: the registry was read before and after the pump`);
    assert.deepEqual([pump.after.pendingHostTasks, pump.after.pendingEvents], [0, 0], `${frame}: the pump left nothing pending`);
    assert.ok(pump.after.hostTasksRun - pump.before.hostTasksRun <= TASK_LIMIT, `${frame}: at most 64 tasks`);
    assert.ok(pump.after.eventsSent - pump.before.eventsSent <= EVENT_LIMIT && pump.before.pendingEvents <= EVENT_LIMIT, `${frame}: at most 128 events`);
    assert.ok(pump.after.eventsSent - pump.before.eventsSent >= 1, `${frame}: the pump delivered the publication`);
  });
  assert.equal(job.finishedCount, 1, `${where}: the game finished the job exactly once`);

  // The calls a HUD made while the job ran: refused by the game's own rule, none of them a job.
  assert.equal(job.attempts.length, duringCalls, `${where}: ${duringCalls} calls were made while the job ran`);
  if (duringCalls > 0) {
    assert.notEqual(job.phaseAtAttempts, "idle", `${where}: they were sent with the turn in progress`);
    for (const attempt of job.attempts) {
      assert.equal(attempt.state, "resolved", `${where}: ${attempt.label} was answered`);
      assert.equal(attempt.response, attempt.method === `${PREFIX}end_turn` ? "acceptance" : "completion", `${where}: ${attempt.label} answered on its own response`);
      assert.deepEqual(attempt.value, {ok: 0, code: "turn_in_progress", text: REFUSALS.turn_in_progress, job: 0},
        `${where}: ${attempt.label} was refused with turn_in_progress and started no job`);
    }
    assert.ok(job.pumps.some(pump => pump.after.hostTasksRun - pump.before.hostTasksRun >= duringCalls), `${where}: the calls were run by the registry in a frame of the job`);
  }
}

// The registry's budgets under STRESS_SUBSCRIBERS more subscribers of the snapshot, with the application's own and the panel's.
// A publication then holds more than 128 events: it drains in ceil(events / 128) pumps (counted as pumps, never as time), no
// subscriber loses one, and they arrive in the order they were queued. Once with each phase published on its own, once with the
// node's own driver, one phase per frame, outrunning the pump.
function verifyStress(stress, {firstJob}) {
  assert.equal(stress.subscribers, STRESS_SUBSCRIBERS, "the stress case has 150 more subscribers");
  const perPublication = STRESS_SUBSCRIBERS + 1 + (stress.panelConnected ? 1 : 0);
  assert.ok(perPublication > EVENT_LIMIT, "stress: a publication holds more than 128 events");
  const base = stress.initialRevision;
  const arrivalsOf = (from, to) => range(from, to).flatMap(revision => range(0, STRESS_SUBSCRIBERS - 1).map(subscriber => [subscriber, revision]));

  const isolated = stress.isolated;
  assert.deepEqual([isolated.job, isolated.accepted.ok, isolated.accepted.job], [firstJob, 1, firstJob], "stress: the job driven a phase at a time was accepted with its id");
  assert.deepEqual(isolated.drains.map(drain => drain.label), ["accepted", ...PHASES], "stress: the publications are the acceptance and each of the six phases");
  isolated.drains.forEach((drain, position) => {
    const where = `stress, publication ${drain.label}`;
    // The last one also carries turn_ended: one more subscription, one more event.
    assert.equal(drain.generated, perPublication + (position === JOB_SNAPSHOTS - 1 ? 1 : 0), `${where}: one event for each subscriber`);
    assert.ok(drain.generated > EVENT_LIMIT, `${where}: more events than one pump sends`);
    assert.equal(sum(drain.pumps), drain.generated, `${where}: every event was sent`);
    assert.ok(drain.pumps.every(sent => sent <= EVENT_LIMIT), `${where}: no pump sent more than 128`);
    assert.equal(drain.pumps.length, Math.ceil(drain.generated / EVENT_LIMIT), `${where}: it drained in ceil(${drain.generated} / 128) pumps`);
    assert.deepEqual([drain.pendingAfter, drain.pendingTasksAfter, drain.tasksRun, drain.eventsSent], [0, 0, 0, drain.generated], `${where}: nothing left pending`);
  });
  assert.equal(isolated.received.length, STRESS_SUBSCRIBERS);
  isolated.received.forEach((entries, subscriber) => {
    const where = `stress, subscriber ${subscriber}`;
    assert.deepEqual(entries.map(entry => entry[0]), range(base, base + JOB_SNAPSHOTS), `${where}: its initial value and one snapshot for each publication, none lost, none repeated`);
    assert.deepEqual(entries.slice(1).map(entry => entry[2]), [...PHASES, "idle"], `${where}: the phases in order`);
    const turnBefore = entries[0][1];
    assert.deepEqual(entries.slice(1).map(entry => entry[1]), [...Array(PHASES.length).fill(turnBefore), turnBefore + 1], `${where}: the turn advances with the last one`);
    assert.deepEqual(entries.slice(1).map(entry => entry[3]), [...Array(PHASES.length).fill(firstJob - 1), firstJob], `${where}: last_job becomes the job with the last one`);
  });
  assert.deepEqual(isolated.arrivals, arrivalsOf(base + 1, base + JOB_SNAPSHOTS), "stress: the deliveries arrived in the order they were queued (FIFO), publication by publication");

  const free = stress.free;
  const total = JOB_SNAPSHOTS * perPublication + 1;
  assert.deepEqual([free.job, free.accepted.ok, free.accepted.job], [firstJob + 1, 1, firstJob + 1], "stress: the job driven by the node was accepted with the next id");
  assert.equal(free.eventsSent, total, "stress: the node's own driver published seven snapshots and one turn_ended, and every event was sent");
  assert.equal(sum(free.pumps), total, "stress: the pumps sent every event");
  assert.ok(free.pumps.every(sent => sent <= EVENT_LIMIT), "stress: no pump sent more than 128");
  assert.equal(free.pumps.length, Math.ceil(total / EVENT_LIMIT), `stress: a job that outran the pump drained in ceil(${total} / 128) pumps`);
  assert.equal(free.pending[0], perPublication, "stress: the acceptance left one publication waiting");
  assert.ok(Math.max(...free.pending) > EVENT_LIMIT && free.pending.at(-1) === 0, "stress: the backlog grew beyond one pump while the job ran, and drained completely");
  free.received.forEach((entries, subscriber) => {
    const where = `stress, subscriber ${subscriber}, with the node's driver`;
    assert.deepEqual(entries.map(entry => entry[0]), range(base, base + 2 * JOB_SNAPSHOTS), `${where}: one snapshot for each publication, none lost, none repeated`);
    assert.deepEqual(entries.slice(1 + JOB_SNAPSHOTS).map(entry => entry[2]), [...PHASES, "idle"], `${where}: the phases in order`);
    assert.equal(entries.at(-1)[3], firstJob + 1, `${where}: last_job becomes the job with the last one`);
  });
  assert.deepEqual(free.arrivals, arrivalsOf(base + JOB_SNAPSHOTS + 1, base + 2 * JOB_SNAPSHOTS), "stress: with the node's driver the deliveries still arrived in the order they were queued");
  return {subscribers: STRESS_SUBSCRIBERS, perPublication, isolatedPumps: isolated.drains.map(drain => drain.pumps), freeEvents: total, freePumps: free.pumps, freePending: free.pending};
}

// --- The rule lane ---------------------------------------------------------------------------------------------------

// Every path at which two JSON trees differ, as {path, from, to}.
function differences(left, right, where = "") {
  const object = value => value !== null && typeof value === "object";
  if (!object(left) || !object(right) || Array.isArray(left) !== Array.isArray(right)) {
    return left === right ? [] : [{path: where, from: left, to: right}];
  }
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort((a, b) => (Array.isArray(left) ? Number(a) - Number(b) : a < b ? -1 : 1));
  return keys.flatMap(key => differences(left[key], right[key], Array.isArray(left) ? `${where}[${key}]` : where === "" ? key : `${where}.${key}`));
}

// The same first intents of the game on the genuine rules and on rules with one constant mutated, read from the snapshots
// JavaScript received. The only thing that differs is what Godot decided: the same bundle ran in both. The expected
// differences are derived here from the genuine snapshots and the one constant, and must be exactly what changed: the
// Settler's card (moves and max_moves) wherever it is shown, and found_city, which the game's own rule turns off with
// no_moves_left once the Settler has none.
export function verifyRuleLane(genuine, mutated, {genuineMoves, mutatedMoves, typesText, bundleSha256, genuineRulesSha256, mutatedRulesSha256}) {
  assert.notEqual(genuineMoves, mutatedMoves, "the mutation changes the Settler's movement points");
  assert.equal(mutatedMoves, 0, "the mutation takes the Settler's movement points to 0, so that found_city is turned off from the start");
  assert.deepEqual(bundleSha256.genuine, bundleSha256.mutated, "the JavaScript bundle is the same in both runs: it contains no .gd");
  assert.notEqual(genuineRulesSha256, mutatedRulesSha256, "rules.gd is not the same in both runs");
  const snapshotSchema = extractFrontierSchemas(typesText).registrations.find(entry => entry.name === `${PREFIX}snapshot`).value;
  for (const [label, report] of [["genuine", genuine], ["mutated", mutated]]) {
    assert.equal(report.scenario, "frontier-services-rule-lane", `${label}: the report is the rule lane's`);
    assert.equal(report.sabotage, false);
    assert.equal(report.ruleLane.rows.length, 4, `${label}: the lane ran four observations`);
    assert.equal(report.native.errors.length, 0, `${label}: the application reports no error`);
    report.ruleLane.rows.forEach(row => conforms(JSON.parse(row.snapshot), snapshotSchema, `${label}: ${row.name}`));
  }
  assert.equal(genuine.ruleLane.settlerMoves, genuineMoves, "the genuine run played the genuine constant");
  assert.equal(mutated.ruleLane.settlerMoves, mutatedMoves, "the mutated run played the mutated constant");
  assert.deepEqual(genuine.ruleLane.rows.map(row => [row.name, row.method, row.args]), mutated.ruleLane.rows.map(row => [row.name, row.method, row.args]),
    "both runs sent the same intents");
  const [initial, stack, settler, moved] = genuine.ruleLane.rows.map(row => JSON.parse(row.snapshot));
  const [initialMutated, stackMutated, settlerMutated, movedMutated] = mutated.ruleLane.rows.map(row => JSON.parse(row.snapshot));

  // Nothing of the Settler is shown before it is selected: the first snapshot is the same, though the state is not.
  assert.deepEqual(differences(initial, initialMutated), [], "the initial snapshot shows nothing of the Settler's points: it is the same in both runs");
  genuine.ruleLane.rows.forEach((row, position) => assert.notEqual(row.hash, mutated.ruleLane.rows[position].hash,
    `${row.name}: the state is not the same in both runs: Godot changed`));

  const unit = (snapshot) => snapshot.tile.units.findIndex(card => card.kind === "settler");
  const settlerCard = unit(stack);
  assert.ok(settlerCard >= 0 && unit(stackMutated) === settlerCard, "the Settler is on the stack the player selected");
  const card = `tile.units[${settlerCard}]`;
  assert.deepEqual(differences(stack, stackMutated), [
    {path: `${card}.max_moves`, from: genuineMoves, to: mutatedMoves},
    {path: `${card}.moves`, from: genuineMoves, to: mutatedMoves},
  ], "selecting the stack: the Settler's card shows the points, and only it differs");

  const foundCity = settler.actions.findIndex(action => action.id === "found_city");
  assert.ok(foundCity >= 0 && settler.actions[foundCity].enabled === 1 && settler.actions[foundCity].reason === "", "genuine: found_city is enabled for a Settler with points");
  assert.deepEqual(settlerMutated.actions[foundCity], {id: "found_city", label: "Found city", args: [1], enabled: 0, reason: "no_moves_left", reason_text: REFUSALS.no_moves_left},
    "mutated: found_city is turned off by the game's rule with no_moves_left");
  assert.deepEqual(differences(settler, settlerMutated), [
    {path: `actions[${foundCity}].enabled`, from: 1, to: 0},
    {path: `actions[${foundCity}].reason`, from: "", to: "no_moves_left"},
    {path: `actions[${foundCity}].reason_text`, from: "", to: REFUSALS.no_moves_left},
    {path: `${card}.max_moves`, from: genuineMoves, to: mutatedMoves},
    {path: `${card}.moves`, from: genuineMoves, to: mutatedMoves},
  ],
  "selecting the Settler: found_city, its reason and the Settler's card are all that differ, exactly as the rule predicts");

  // The intent the rule decides: the same move is accepted with points and refused without.
  const [, , , moving] = genuine.ruleLane.rows;
  const [, , , refusedMove] = mutated.ruleLane.rows;
  assert.deepEqual(moving.result, {ok: 1, code: "ok", text: "", job: 0}, "genuine: the Settler enters the forest");
  assert.deepEqual(refusedMove.result, {ok: 0, code: "no_moves_left", text: REFUSALS.no_moves_left, job: 0}, "mutated: the same move is refused by the game's rule");
  assert.deepEqual(movedMutated, settlerMutated, "mutated: a refused move changes nothing in the snapshot");
  assert.equal(mutated.ruleLane.rows[3].hash, mutated.ruleLane.rows[2].hash, "mutated: a refused move changes nothing in the state");
  assert.notEqual(moved.selection.x, settler.selection.x, "genuine: the accepted move changed the selection");
  assert.equal(moved.actions.find(action => action.id === "found_city").reason, "no_moves_left", "genuine: after the forest the Settler has no points left, and found_city says so");
  return {
    differences: {initial: differences(initial, initialMutated), select_tile: differences(stack, stackMutated), select_unit: differences(settler, settlerMutated)},
    moveUnit: {genuine: moving.result, mutated: refusedMove.result},
    refusedMove: refusedMove.result.code, bundleSha256: bundleSha256.genuine, genuineRulesSha256, mutatedRulesSha256,
  };
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
  assert.equal(report.registered.length, BINDINGS, "registration: one state, one signal and one method per service");
  assert.deepEqual(report.registered.filter(entry => entry.kind === "method").map(entry => [entry.name, entry.response]).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    [...methods.keys()].sort().map(name => [name, name === `${PREFIX}end_turn` ? "acceptance" : "completion"]),
    "registration: end_turn is registered to answer on acceptance, and every other method on completion");
  assert.equal(report.native.gameServices.bindings, BINDINGS, "registration: the registry holds every binding");
  assert.deepEqual(report.native.errors, [], "the application reports no error");

  assert.equal(report.roteiroSteps, ROTEIRO_STEPS, "the roteiro has its 77 steps");
  assert.equal(report.steps.length, ROTEIRO_STEPS, "every step of the roteiro was played through the services");

  const refusals = {};
  let accepted = 0;
  let actionsSentBack = 0;
  let turns = 0;
  let revision = null;
  let generation = null;
  let turn = 1;
  let jobs = 0;
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
    assert.equal(result.response, step.intent === "end_turn" ? "acceptance" : "completion",
      `${where}: end_turn answers on acceptance and every other method on completion`);
    conforms(result.value, resultSchema, `${where} result`);
    const answer = result.value;
    assert.ok(answer.ok === 0 || answer.ok === 1, `${where}: ok is 0 or 1`);
    const takesTurn = step.intent === "end_turn" && answer.ok === 1;
    assert.equal(answer.job, takesTurn ? jobs + 1 : 0, `${where}: an accepted end_turn answers the next job id (${jobs + 1}) and every other call, and a refused end_turn, answers job 0`);
    assert.equal(answer.code, step.expectedCode, `${where}: the roteiro expects ${step.expectedCode}`);
    if (answer.ok === 1) {
      assert.deepEqual([answer.code, answer.text], ["ok", ""], `${where}: an accepted intent answers ok and no text`);
    } else {
      assert.ok(answer.code in REFUSALS, `${where}: ${answer.code} is a refusal code of the game's table`);
      assert.equal(answer.text, REFUSALS[answer.code], `${where}: a refusal carries its code's text`);
      refusals[answer.code] = (refusals[answer.code] ?? 0) + 1;
    }

    // What was published: a refused intent changed nothing and published nothing; an accepted one, one snapshot, and an
    // accepted end_turn the seven snapshots of its job.
    assert.equal(step.snapshotsEmitted, takesTurn ? JOB_SNAPSHOTS : answer.ok,
      `${where}: ${takesTurn ? "an accepted end_turn publishes exactly the seven snapshots of its job" : answer.ok === 1 ? "an accepted intent publishes exactly one snapshot" : "a refused intent publishes nothing"}`);
    assert.equal(step.turnEndedEmitted, takesTurn ? 1 : 0, `${where}: turn_ended is emitted exactly once per accepted end_turn, and by nothing else`);

    // The snapshot JavaScript holds.
    const received = JSON.parse(step.jsSnapshot);
    assert.equal(step.jsSnapshot, canonical(received), `${where}: the received snapshot is canonical`);
    assert.equal(step.jsSnapshot, step.godotSnapshot, `${where}: the snapshot JavaScript holds is the node's, byte for byte`);
    conforms(received, snapshotSchema, `${where} snapshot`);
    assert.equal(received.version, 1, `${where}: DTO version`);
    assert.equal(received.epoch, 1, `${where}: the first session has epoch 1 at every step`);
    assert.equal(received.last_job, takesTurn ? jobs + 1 : jobs, `${where}: last_job is the last job that finished`);
    assert.equal(received.phase, "idle", `${where}: the roteiro waits for the job, so every step is seen at rest`);
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
    assert.ok(!("epoch" in state) && !("last_job" in state), `${where}: the epoch and the last job are not in the state`);
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
      jobs += 1;
      conforms(step.turnEnded, turnEndedSchema, `${where} turn_ended`);
      assert.deepEqual(step.turnEnded.phases.map(phase => phase.name), PHASES, `${where}: turn_ended lists the six phases in their order`);
      // The tasks and events of a phase are the game's own counters (what the phase did to the state); the registry's are
      // counted apart, in the pumps of the job below.
      assert.ok(step.turnEnded.phases.every(phase => phase.tasks <= TASK_LIMIT && phase.events <= EVENT_LIMIT), `${where}: every phase is within 64 tasks and 128 events`);
      assert.equal(step.turnEnded.turn, turn + 1, `${where}: turn_ended carries the turn that begins`);
      assert.equal(step.turnEnded.turn, received.turn, `${where}: turn_ended agrees with the snapshot of the turn that begins`);
      assert.equal(step.turnEnded.job, answer.job, `${where}: turn_ended finishes the job the acceptance answered`);
      assert.equal(step.turnEndedEmitted, 1, `${where}: the job finished exactly once`);
      verifyJob(step.job, {where, jobId: answer.job, turnBefore: turn, lastJobBefore: jobs - 1, turnEndedSeq: step.turnEndedSeq});
      turn += 1;
    } else {
      assert.equal(received.turn, turn, `${where}: the turn only moves with an accepted end_turn`);
      assert.deepEqual(step.job, {}, `${where}: a call that starts no job reports none`);
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
    assert.deepEqual(entry.result, {ok: 1, code: "ok", text: "", job: 0}, `${where}: accepted with the uniform result, and no job`);
    assert.equal(received.last_job, 0, `${where}: a new game has finished no job`);
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
  const owned = persisted => ({bindings: persisted.bindings, generation: persisted.generation, epoch: persisted.epoch, sameNode: persisted.sameNode,
    sameGame: persisted.sameGame, registered: persisted.registered});
  assert.deepEqual(owned(kept.unmounted), owned(kept.before), "unmounting the surface changed nothing the node owns");
  assert.equal(kept.before.bindings, BINDINGS, "the registry held every binding before the unmount");
  assert.equal(kept.remounted.bindings, BINDINGS, "and after the remount");
  assert.deepEqual([kept.remounted.registered, kept.remounted.epoch, kept.remounted.sameNode, kept.remounted.sameGame], [BINDINGS, 1, true, true],
    "the node, its game and its epoch are the ones from before");
  assert.equal(kept.firstPanelGeneration, kept.before.generation, "the remounted root connected to the same registration generation");
  assert.equal(kept.firstPanelSnapshot, report.steps[kept.playedUnmountedStep].godotSnapshot,
    "the remounted root's first value is the snapshot the step played with no surface left");
  assert.notEqual(kept.moved.hash, kept.before.hash, "a step played with no surface at all changed the game");
  assert.ok(kept.panel.connected && kept.panel.mounts === 2 && kept.panel.cleanups === 1 && kept.panel.error === null, "the panel mounted twice and cleaned up once");
  // The job that outlived the screen: the third accepted end_turn, with the surface closed in the frame after the acceptance.
  const unmountedStep = report.steps.filter(step => step.intent === "end_turn" && step.result.value.ok === 1)[UNMOUNT_AFTER_TURNS - 1];
  const survivor = kept.job;
  assert.equal(survivor.id, unmountedStep.result.value.job, "the job the surface was closed during is the third job");
  assert.deepEqual(survivor.id, UNMOUNT_AFTER_TURNS, "...and its id is 3");
  assert.equal(survivor.phaseAtUnmount, "ai_plan", "the screen was closed with the job accepted and its first phase not yet run");
  assert.equal(survivor.finishedAtUnmount, 0, "the job had not finished when the screen was closed");
  assert.ok(survivor.rootCounts.length >= 2 && survivor.rootCounts.every(count => count === 0), "the application held no root while the job ran");
  assert.equal(survivor.finishedCount, 1, "the game finished the job exactly once");
  assert.equal(survivor.turnEndedForJob, 1, "the application's own subscription received turn_ended for the job exactly once, with the remount");
  assert.equal(survivor.turnAfterJob, survivor.turnAtUnmount + 1, "the job advanced the turn with no screen");
  assert.deepEqual(survivor.firstPanel, {phase: "idle", turn: survivor.turnAtUnmount + 1, last_job: survivor.id},
    "the remounted root's first snapshot is at rest, in the advanced turn, with last_job = the job");
  assert.deepEqual(unmountedStep.turnEnded.job, survivor.id, "turn_ended finished that job");

  // The job lane: a job that is sent every kind of call while it runs, and the registry's budgets under many subscribers. The game
  // is the live one after the last new game: the turn is 1, and no job has finished in it.
  const burst = report.jobLane.burst;
  const burstJob = jobs + 1;
  assert.deepEqual([burst.result.response, burst.result.value.ok, burst.result.value.job], ["acceptance", 1, burstJob], "the burst job was accepted with the next id");
  verifyJob(burst.job, {where: "the burst job", jobId: burstJob, turnBefore: 1, lastJobBefore: 0, turnEndedSeq: burst.turnEndedSeq, duringCalls: DURING_JOB_CALLS});
  assert.deepEqual(burst.turnEnded.job, burstJob, "the burst job's turn_ended finishes it");
  jobs += 1;
  const stressed = verifyStress(report.jobLane.stress, {firstJob: jobs + 1});
  jobs += 2;

  // Every job the application was told about, once, in order; the game finished each of them once, and none is left.
  assert.equal(report.jobs.expected, jobs, "the probe accepted the jobs it expected");
  assert.deepEqual(report.jobs.turnEndedLog.map(entry => entry.job), range(1, jobs), "the application's own subscription received turn_ended for each job, once, in order");
  const acceptedSteps = report.steps.filter(step => step.intent === "end_turn" && step.result.value.ok === 1);
  acceptedSteps.forEach((step, position) => assert.deepEqual({turn: report.jobs.turnEndedLog[position].turn, phases: report.jobs.turnEndedLog[position].phases, job: report.jobs.turnEndedLog[position].job},
    step.turnEnded, `job ${position + 1}: the log holds the turn_ended the step saw`));
  assert.deepEqual(report.jobs.finished, Object.fromEntries(range(1, jobs).map(id => [String(id), 1])), "the game finished each job exactly once");
  assert.deepEqual([report.jobs.next, report.jobs.running], [jobs + 1, 0], "the node's next id follows the last, and no job is left running");

  // Limits.
  assert.deepEqual([report.limits.maxNodes, report.limits.maxDepth], [largest.nodes, largest.depth], "the reported limits are what the snapshots measure");
  assert.ok(largest.nodes < NODE_LIMIT && largest.depth < DEPTH_LIMIT, "the largest snapshot is inside the transport's limits");

  return {steps: report.steps.length, accepted, refused: report.steps.length - accepted, refusals, turns, epochs: report.epochs.map(entry => entry.epoch),
    finalHash: report.finalHash, largest, violations: report.violations.length, registrations: report.registered.length, actionsSentBack, hashes,
    jobs, stress: stressed};
}
