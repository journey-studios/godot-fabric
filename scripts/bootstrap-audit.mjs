// The rules behind docs/compatibility/bootstrap-audit-0.87.1.json. The audit says, for every step of the JavaScript environment RN
// builds before an application runs, what the host does instead; this module checks the audit against the pinned RN sources and
// against the repository, so that it cannot go stale silently. It reads nothing itself: tests/bootstrap-audit.test.mjs hands it
// the parsed audit, the scan of the pinned chain, and a reader for repository files, which is also how the test mutates its input.
// checkBootstrapAudit only composes the validators below; each one reports into the shared context and owns one kind of rule.

export const STATUSES = ["runs", "replaced", "host", "pending", "not-applicable"];
// The decisions the user took for GF-05 on 2026-10-13. Dropping one from the audit is a failure, not an edit.
export const REQUIRED_DECISIONS = ["encoding", "performance", "performance-classes", "starvation"];
const SCOPES = ["1_0", "post_1_0"];
const HOST_ENTRY = "src/initialize.js";
const OWN_TASK = "GF-05";

const NODE_KEYS = ["status", "reason", "evidence", "slice", "owner", "decision", "verifyIn"];
const STEP_KEYS = ["id", "file", "role", "installer", "gates", "summary", "globals", "parts", ...NODE_KEYS];
const PART_KEYS = ["name", "globals", ...NODE_KEYS];
const POLYFILL_KEYS = ["id", "file", "summary", "globals", ...NODE_KEYS];
const DECISION_KEYS = ["id", "date", "topic", "decision", "scope", "slice", "roadmap", "parityGap", "globals", "reason"];
const EVIDENCE_KEYS = ["file", "symbol", "anchor"];

const text = (value) => typeof value === "string" && value.trim() !== "";
const strings = (value) => Array.isArray(value) && value.every((item) => typeof item === "string" && item !== "");
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const withoutExtension = (file) => file.replace(/\.js$/, "");

function parse(ts, name, source) {
  return ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}

// The specifiers a module imports at its top level, with the local name of a default import, and the names it calls as statements.
function importsOf(ts, source) {
  const sf = parse(ts, HOST_ENTRY, source);
  const imports = new Map();
  const calls = new Set();
  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      imports.set(statement.moduleSpecifier.text, statement.importClause?.name?.text ?? null);
    } else if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)) {
      const callee = statement.expression.expression;
      const first = statement.expression.arguments[0];
      if (ts.isIdentifier(callee) && callee.text === "require" && first && ts.isStringLiteral(first)) {
        imports.set(first.text, null);
      } else if (ts.isIdentifier(callee)) {
        calls.add(callee.text);
      }
    }
  }
  return { imports, calls };
}

// Setup modules such as setUpDOM export a function that must be called; importing them installs nothing.
function exportsSetupFunction(ts, source) {
  const sf = parse(ts, "upstream.js", source);
  return sf.statements.some((statement) => ts.isFunctionDeclaration(statement) &&
    statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) &&
    statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword));
}

// The files RN hands Metro as polyfills: every `require.resolve('./x.js')` of @react-native/js-polyfills/index.js.
export function metroPolyfills(ts, source) {
  const sf = parse(ts, "index.js", source);
  const files = [];
  (function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "resolve" &&
      ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "require" &&
      node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text.startsWith("./")) {
      files.push(`@react-native/js-polyfills/${node.arguments[0].text.slice(2)}`);
    }
    node.forEachChild(visit);
  })(sf);
  if (!files.length) {
    throw new Error("@react-native/js-polyfills/index.js no longer lists polyfills through require.resolve('./file')");
  }
  return files;
}

const occurrences = (source, needle) => source.split(needle).length - 1;

function createContext({ audit, scan, polyfills, version, tasks, ts, readSource }) {
  const issues = [];
  const hostEntry = readSource(HOST_ENTRY);
  return {
    audit, scan, polyfills, version, tasks, ts, readSource, issues,
    issue: (where, message) => issues.push(`${where}: ${message}`),
    slices: new Set(Object.keys(audit.slices ?? {})),
    decisionIds: new Set((audit.decisions ?? []).map((decision) => decision.id)),
    // Everything the pinned chain installs, for the decisions that name globals.
    chainGlobals: new Set(scan.steps.flatMap((step) => step.globals)),
    hostImports: hostEntry === undefined ? undefined : importsOf(ts, hostEntry),
    ids: new Set(),
  };
}

function onlyKeys({ issue }, where, value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      issue(where, `unknown field ${key}`);
    }
  }
}

function checkId({ issue, ids }, where, id) {
  if (!text(id) || ids.has(id)) {
    issue(where, "needs an id that no other entry uses");
  }
  ids.add(id);
}

// The header: the audited version, the files the audit says it derives from, the vocabulary and the slice plan.
function checkHeader(ctx) {
  const { audit, scan, version, issue, hostImports, slices } = ctx;
  if (audit.schemaVersion !== 1) {
    issue("audit", "schemaVersion must be 1");
  }
  if (audit.reactNative !== version) {
    issue("audit", `audits RN ${audit.reactNative} but the pinned RN is ${version}; audit the new chain before upgrading`);
  }
  if (audit.derivation?.wrapper !== scan.wrapper || audit.derivation?.entry !== scan.entry || audit.derivation?.host !== HOST_ENTRY) {
    issue("audit.derivation", `wrapper, entry and host must be ${scan.wrapper}, ${scan.entry} and ${HOST_ENTRY}`);
  }
  if (!same(Object.keys(audit.statuses ?? {}).sort(), [...STATUSES].sort()) || !Object.values(audit.statuses ?? {}).every(text)) {
    issue("audit.statuses", `must describe exactly ${STATUSES.join(", ")}`);
  }
  if (!hostImports) {
    issue("audit", `${HOST_ENTRY} does not exist`);
  }
  if (!slices.size) {
    issue("audit.slices", "the slice plan is missing");
  }
  for (const [name, description] of Object.entries(audit.slices ?? {})) {
    if (!text(description)) {
      issue(`audit.slices.${name}`, "needs a description");
    }
  }
}

// The user's decisions: complete, well formed, and tied to the plan, the roadmap and the globals they talk about.
function checkDecisions(ctx) {
  const { audit, slices, tasks, chainGlobals, decisionIds, issue } = ctx;
  const seen = new Set();
  for (const decision of audit.decisions ?? []) {
    const where = `decision ${decision.id}`;
    onlyKeys(ctx, where, decision, DECISION_KEYS);
    if (!text(decision.id) || seen.has(decision.id)) {
      issue(where, "needs a unique id");
    }
    seen.add(decision.id);
    for (const field of ["date", "topic", "decision", "reason"]) {
      if (!text(decision[field])) {
        issue(where, `${field} is required`);
      }
    }
    if (!SCOPES.includes(decision.scope)) {
      issue(where, `scope must be ${SCOPES.join(" or ")}`);
    }
    if (decision.scope === "1_0" && decision.slice === undefined) {
      issue(where, "a 1_0 decision names the slice that delivers it");
    }
    if (decision.slice !== undefined && !slices.has(decision.slice)) {
      issue(where, `slice ${decision.slice} is not in the plan`);
    }
    if (decision.roadmap !== undefined && !tasks.has(decision.roadmap)) {
      issue(where, `roadmap ${decision.roadmap} is not a task of the dashboard`);
    }
    if (decision.scope === "post_1_0" && decision.roadmap === undefined) {
      issue(where, "a post_1_0 decision names the roadmap task that owns it");
    }
    for (const name of decision.globals ?? []) {
      if (!chainGlobals.has(name)) {
        issue(where, `${name} is not installed by the pinned chain`);
      }
    }
  }
  for (const id of REQUIRED_DECISIONS) {
    if (!decisionIds.has(id)) {
      issue("audit.decisions", `the user's decision ${id} of 2026-10-13 is missing`);
    }
  }
}

// What is wrong with one piece of evidence in its file, if anything. The symbol must still be there; when it occurs more than once,
// an anchor (a short text around it that occurs exactly once) says which occurrence is meant. No line number takes part, so an
// unrelated edit elsewhere in the file cannot break the audit.
function evidenceProblem({ symbol, anchor }, source) {
  const symbols = occurrences(source, symbol);
  if (!symbols) {
    return `no longer contains ${JSON.stringify(symbol)}`;
  }
  if (anchor === undefined) {
    return symbols > 1 ? `${JSON.stringify(symbol)} occurs ${symbols} times; add an anchor, a short text around it that occurs once` : undefined;
  }
  if (!anchor.includes(symbol)) {
    return `the anchor ${JSON.stringify(anchor)} does not contain the symbol ${JSON.stringify(symbol)}`;
  }
  const anchors = occurrences(source, anchor);
  if (anchors === 1) {
    return undefined;
  }
  return anchors ? `the anchor ${JSON.stringify(anchor)} is ambiguous: it occurs ${anchors} times` : `the anchor ${JSON.stringify(anchor)} is no longer in the file`;
}

function checkEvidence(ctx, where, evidence) {
  const { issue, readSource } = ctx;
  if (!Array.isArray(evidence)) {
    issue(where, "evidence must be a list");
    return;
  }
  evidence.forEach((item, index) => {
    const at = `${where}.evidence[${index}]`;
    if (!item || typeof item !== "object") {
      issue(at, "must be {file, symbol} with an optional anchor");
      return;
    }
    onlyKeys(ctx, at, item, EVIDENCE_KEYS);
    if (!text(item.file) || !text(item.symbol) || (item.anchor !== undefined && !text(item.anchor))) {
      issue(at, "needs a file and a symbol, and a non-empty anchor when it has one");
      return;
    }
    const source = readSource(item.file);
    if (source === undefined) {
      issue(at, `${item.file} does not exist`);
      return;
    }
    const problem = evidenceProblem(item, source);
    if (problem) {
      issue(at, `${item.file} ${problem}`);
    }
  });
}

// The references of a node: the plan's slices, the owning task, the recorded decision and the slices that verify it.
function checkReferences(ctx, where, node) {
  const { issue, slices, tasks, decisionIds } = ctx;
  if (node.status === "pending" && !slices.has(node.slice)) {
    issue(where, `a pending entry names a slice of the plan (${[...slices].join(", ")}); got ${node.slice}`);
  }
  if (node.status !== "pending" && node.slice !== undefined) {
    issue(where, "slice belongs to pending entries");
  }
  if (node.owner !== undefined && (node.status !== "not-applicable" || !tasks.has(node.owner) || node.owner === OWN_TASK)) {
    issue(where, `owner ${node.owner} must name another dashboard task and belongs to not-applicable entries`);
  }
  if (node.decision !== undefined && !decisionIds.has(node.decision)) {
    issue(where, `decision ${node.decision} is not recorded`);
  }
  for (const slice of node.verifyIn ?? []) {
    if (!slices.has(slice)) {
      issue(where, `verifyIn names ${slice}, which is not in the plan`);
    }
  }
}

// A `runs` claim is static: src/initialize.js imports the module, and calls it when it exports a setup function.
function checkRuns(ctx, where, { module, upstreamPath }) {
  const { issue, ts, readSource, hostImports } = ctx;
  if (!hostImports) {
    return;
  }
  if (!hostImports.imports.has(module)) {
    issue(where, `claims runs but ${HOST_ENTRY} does not import ${module}`);
    return;
  }
  const upstream = readSource(upstreamPath);
  const binding = hostImports.imports.get(module);
  if (upstream !== undefined && exportsSetupFunction(ts, upstream) && (!binding || !hostImports.calls.has(binding))) {
    issue(where, `${upstreamPath} exports a setup function, and ${HOST_ENTRY} must import and call it for the step to run`);
  }
}

// The checks every status-bearing node shares, a step without parts or one part. `target` names the specifier that src/initialize.js
// must import for `runs` and the repository path of that module.
function checkNode(ctx, where, node, target) {
  const { issue } = ctx;
  if (!STATUSES.includes(node.status)) {
    issue(where, `status must be one of ${STATUSES.join(", ")}`);
    return;
  }
  if (node.status !== "runs" && !text(node.reason)) {
    issue(where, `a ${node.status} entry needs a reason`);
  }
  if (node.evidence !== undefined) {
    checkEvidence(ctx, where, node.evidence);
  }
  if ((node.status === "replaced" || node.status === "host") && !node.evidence?.length) {
    issue(where, `a ${node.status} entry needs evidence: the file and symbol that do the job`);
  }
  checkReferences(ctx, where, node);
  if (node.status === "runs") {
    checkRuns(ctx, where, target);
  }
}

// The audited files against the files upstream has: none missing, none extra, none twice, in upstream's order.
function compareFiles({ issue }, kind, listed, upstream, label) {
  const byFile = new Map();
  if (!Array.isArray(listed)) {
    issue(kind, "must be a list");
  }
  const audited = Array.isArray(listed) ? listed : [];
  for (const entry of audited) {
    if (byFile.has(entry.file)) {
      issue(`${kind} ${entry.file}`, "listed twice");
    }
    byFile.set(entry.file, entry);
  }
  const upstreamFiles = new Set(upstream);
  for (const file of upstream) {
    if (!byFile.has(file)) {
      issue(`${kind} ${file}`, `${label} has this step and the audit does not list it`);
    }
  }
  for (const file of byFile.keys()) {
    if (!upstreamFiles.has(file)) {
      issue(`${kind} ${file}`, `the audit lists this step and ${label} no longer has it`);
    }
  }
  const common = upstream.filter((file) => byFile.has(file));
  if (!same(audited.map((entry) => entry.file).filter((file) => upstreamFiles.has(file)), common)) {
    issue(kind, `the audit is not in ${label}'s order`);
  }
  return byFile;
}

// The Metro polyfills, which run before the chain.
function checkPolyfills(ctx) {
  const { audit, polyfills, issue } = ctx;
  const byFile = compareFiles(ctx, "polyfill", audit.polyfills, polyfills, "@react-native/js-polyfills");
  for (const entry of byFile.values()) {
    const where = `polyfill ${entry.file}`;
    onlyKeys(ctx, where, entry, POLYFILL_KEYS);
    checkId(ctx, where, entry.id);
    if (!text(entry.summary)) {
      issue(where, "needs a summary of what the polyfill does");
    }
    if (!strings(entry.globals)) {
      issue(where, "globals must list the names it installs");
    }
    checkNode(ctx, where, entry, { module: withoutExtension(entry.file), upstreamPath: `node_modules/${entry.file}` });
  }
}

// A step whose parts split what it installs: every part is a node of its own, and together they cover the step's globals once.
function checkParts(ctx, where, entry, upstream, target) {
  const { issue } = ctx;
  for (const key of [...NODE_KEYS, "globals"]) {
    if (entry[key] !== undefined) {
      issue(where, `a step with parts carries ${key} on its parts`);
    }
  }
  if (!Array.isArray(entry.parts) || entry.parts.length < 2) {
    issue(where, "parts must be a list of at least two");
    return;
  }
  const covered = new Map();
  const names = new Set();
  entry.parts.forEach((part, index) => {
    const at = `${where} part ${part.name ?? index}`;
    onlyKeys(ctx, at, part, PART_KEYS);
    if (!text(part.name) || names.has(part.name)) {
      issue(at, "needs a name that no other part of the step uses");
    }
    names.add(part.name);
    if (!strings(part.globals) || !part.globals.length) {
      issue(at, "globals must list the names this part covers");
    }
    for (const name of strings(part.globals) ? part.globals : []) {
      if (covered.has(name)) {
        issue(at, `${name} is also covered by part ${covered.get(name)}`);
      }
      covered.set(name, part.name);
    }
    checkNode(ctx, at, part, target);
  });
  if (!same([...covered.keys()].sort(), [...upstream.globals].sort())) {
    const missing = upstream.globals.filter((name) => !covered.has(name));
    const extra = [...covered.keys()].filter((name) => !upstream.globals.includes(name));
    issue(where, `the parts must cover exactly what the step installs${missing.length ? `; not covered: ${missing.join(", ")}` : ""}${extra.length ? `; not installed: ${extra.join(", ")}` : ""}`);
  }
}

// A step without parts lists the globals it installs, which must be exactly what the scan finds.
function checkListedGlobals({ issue }, where, entry, upstream) {
  if (strings(entry.globals) && same([...entry.globals].sort(), [...upstream.globals].sort())) {
    return;
  }
  const listed = strings(entry.globals) ? entry.globals : [];
  const missing = upstream.globals.filter((name) => !listed.includes(name));
  const extra = listed.filter((name) => !upstream.globals.includes(name));
  issue(where, `globals must be exactly what the step installs${missing.length ? `; not listed: ${missing.join(", ")}` : ""}${extra.length ? `; not installed: ${extra.join(", ")}` : ""}`);
}

// One audited step against the step RN's chain has under the same file.
function checkStep(ctx, entry, upstream) {
  const { issue } = ctx;
  const where = `step ${upstream.file}`;
  onlyKeys(ctx, where, entry, STEP_KEYS);
  checkId(ctx, where, entry.id);
  if (!text(entry.summary)) {
    issue(where, "needs a summary of what the step does");
  }
  if (entry.role !== upstream.role || entry.installer !== upstream.installer) {
    issue(where, `RN's chain has it as ${upstream.role}${upstream.installer ? ` under ${upstream.installer}` : ""}; the audit says ${entry.role}${entry.installer ? ` under ${entry.installer}` : ""}`);
  }
  if (!same(entry.gates, upstream.gates)) {
    issue(where, `the conditions around it changed: RN has ${JSON.stringify(upstream.gates)}, the audit ${JSON.stringify(entry.gates)}`);
  }
  const loaded = upstream.installer ?? upstream.file;
  const target = { module: `react-native/${withoutExtension(loaded)}`, upstreamPath: `node_modules/react-native/${loaded}` };
  if (entry.parts !== undefined) {
    checkParts(ctx, where, entry, upstream, target);
    return;
  }
  checkListedGlobals(ctx, where, entry, upstream);
  checkNode(ctx, where, entry, target);
}

// InitializeCore's chain: drift against the scan, then every step.
function checkChain(ctx) {
  const { audit, scan } = ctx;
  const byFile = compareFiles(ctx, "step", audit.steps, scan.steps.map((step) => step.file), "RN's chain");
  for (const upstream of scan.steps) {
    const entry = byFile.get(upstream.file);
    if (entry) {
      checkStep(ctx, entry, upstream);
    }
  }
}

export function checkBootstrapAudit(inputs) {
  const ctx = createContext(inputs);
  checkHeader(ctx);
  checkDecisions(ctx);
  checkPolyfills(ctx);
  checkChain(ctx);
  return ctx.issues;
}
