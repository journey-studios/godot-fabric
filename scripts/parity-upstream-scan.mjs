import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// The parts of the contract inventory that come from RN's JavaScript sources rather than its generated declarations:
// the globals RN's InitializeCore chain installs, the globals RN's JS reads and the host must provide, the commands
// codegenNativeCommands registers, and the platform marker of the OS-specific modules. Every file is read with the
// TypeScript parser (which accepts RN's Flow syntax closely enough for statements and calls) and nothing is matched by
// regular expression over source text; tests/parity-inventory.test.mjs cross-checks the result with a separate oracle.

const SCAN_ROOTS = ["Libraries", "src"];
// __tests__, __mocks__, __flowtests__, __docs__ and the like never run in an app.
const SKIPPED_DIRECTORY = /^__.+__$/;
const SETUP_WRAPPER = "Libraries/Core/InitializeCore.js";
const SETUP_ENTRY = "src/private/setup/setUpDefaultReactNativeEnvironment.js";
// A setup module nested under an installer is followed only when it is named like one.
const NESTED_SETUP = /^(setUp|polyfill)/;
const HOST_GLOBAL_NAME = /^(native[A-Z]|RN\$|__)/;
const GLOBAL_ROOTS = new Set(["global", "globalThis"]);
const METRO_PREFIX = "__METRO_GLOBAL_PREFIX__";

// Globals RN's JS reads that the host must provide and whose names do not follow the host naming rule above. Each entry is
// reviewed by hand; the generator fails when a listed name stops being read.
const HOST_GLOBAL_ALLOW = {
  ErrorUtils: "Metro's error-guard polyfill defines it before RN's code runs; Libraries/vendor/core/ErrorUtils.js re-exports it",
  HermesInternal: "Hermes engine global that polyfillPromise.js and parseErrorStack.js feature-detect",
  globalEvalWithSourceUrl: "Eval hook the host installs; Libraries/Core/Devtools/loadBundleFromServer.js calls it in DEV",
};
// Names RN's JS reads without a `global.` prefix; the generator looks for exactly these free identifiers.
const FREE_IDENTIFIER_READS = ["RN$enableMicrotasksInReact", "__DEV__", "__REACT_DEVTOOLS_GLOBAL_HOOK__", "nativeFabricUIManager"];
// Reads that are not host contracts, with the reason. A read outside this table, the allow-list and the naming rule fails.
const HOST_GLOBAL_EXCLUSIONS = {
  ArrayBuffer: "ECMAScript built-in that the engine provides",
  hasOwnProperty: "Object.prototype method reached through the global object",
  unescape: "ECMAScript Annex B built-in that the engine provides",
  __REACT_DEVTOOLS_GLOBAL_HOOK__: "react-refresh's injectIntoGlobalHook(global), called from Libraries/Core/setUpReactRefresh.js, installs it in DEV; the renderer only reads it behind a typeof guard",
};

const byText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const collapse = (text) => text.replace(/\s+/g, " ").trim();

function walk(directory, found) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => byText(left.name, right.name))) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORY.test(entry.name)) {
        walk(path.join(directory, entry.name), found);
      }
    } else if (entry.name.endsWith(".js")) {
      found.push(path.join(directory, entry.name));
    }
  }
}

function visit(node, callback) {
  if (callback(node) === false) {
    return;
  }
  node.forEachChild((child) => visit(child, callback));
}

const sortedUnique = (items) => [...new Set(items.map((item) => JSON.stringify(item)))].sort(byText).map((item) => JSON.parse(item));

// The source layer: every .js file under the scan roots, parsed once. The parse is plain TS mode, which accepts RN's generic
// calls and Flow annotations; the JS modes drop `codegenNativeCommands<T>(...)`.
function loadSources(ts, upstream) {
  const files = [];
  for (const root of SCAN_ROOTS) {
    walk(path.join(upstream, root), files);
  }
  const sources = new Map();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const rel = path.relative(upstream, file).split(path.sep).join("/");
    const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    sources.set(rel, { rel, text, sf, sha256: createHash("sha256").update(text).digest("hex") });
  }
  return sources;
}

function resolveModule(sources, from, spec) {
  const base = path.posix.join(path.posix.dirname(from), spec);
  const resolved = [base, `${base}.js`, `${base}/index.js`].find((candidate) => sources.has(candidate));
  if (!resolved) {
    throw new Error(`Unresolved setup module ${spec} in ${from}`);
  }
  return resolved;
}

// Syntax helpers shared by the categories below.
function createSyntax(ts) {
  const unwrap = (node) => {
    let current = node;
    while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isNonNullExpression(current) ||
      ts.isTypeAssertionExpression(current) || ts.isSatisfiesExpression(current)) {
      current = current.expression;
    }
    return current;
  };
  const literalText = (node) => {
    const value = unwrap(node);
    return ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value) ? value.text : undefined;
  };
  const assignments = [
    ts.SyntaxKind.EqualsToken, ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.AmpersandAmpersandEqualsToken,
    ts.SyntaxKind.QuestionQuestionEqualsToken,
  ];
  const isAssignment = (node) => ts.isBinaryExpression(node) && assignments.includes(node.operatorToken.kind);
  const isAssignmentTarget = (node) => isAssignment(node.parent) && node.parent.left === node;

  // The property path from the global object that an expression names: `global` is [], `global.process.env` is
  // ["process", "env"], and a local alias such as `const navigator = global.navigator` stands for its own path.
  function globalPath(node, aliases) {
    const value = unwrap(node);
    if (ts.isIdentifier(value)) {
      return GLOBAL_ROOTS.has(value.text) ? [] : aliases.get(value.text) ?? null;
    }
    if (ts.isPropertyAccessExpression(value)) {
      const base = globalPath(value.expression, aliases);
      return base && [...base, value.name.text];
    }
    if (ts.isElementAccessExpression(value)) {
      const base = globalPath(value.expression, aliases);
      const key = literalText(value.argumentExpression);
      return base && key !== undefined ? [...base, key] : null;
    }
    return null;
  }
  // `global.__METRO_GLOBAL_PREFIX__ || ''` and its `??` form: the prefix Metro puts in front of some global names.
  const isMetroPrefix = (node) => {
    const value = unwrap(node);
    if (!ts.isBinaryExpression(value) || ![ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(value.operatorToken.kind)) {
      return false;
    }
    const prefix = globalPath(value.left, new Map());
    return prefix?.length === 1 && prefix[0] === METRO_PREFIX && literalText(value.right) === "";
  };
  const prefixedKey = (node) => {
    const value = unwrap(node);
    if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken && isMetroPrefix(value.left)) {
      return literalText(value.right);
    }
    if (ts.isTemplateExpression(value) && value.head.text === "" && value.templateSpans.length === 1 && isMetroPrefix(value.templateSpans[0].expression)) {
      return value.templateSpans[0].literal.text;
    }
    return undefined;
  };

  const gateText = (node, sf) => collapse(node.getText(sf));
  // The conditions an `if` or ternary puts around a node, outermost first, up to `stop` (a function boundary) or the file.
  function gatesOf(node, sf, stop) {
    const gates = [];
    let child = node;
    for (let parent = node.parent; parent && child !== stop; child = parent, parent = parent.parent) {
      if (ts.isIfStatement(parent)) {
        if (child === parent.thenStatement) {
          gates.push(gateText(parent.expression, sf));
        } else if (child === parent.elseStatement) {
          gates.push(`!(${gateText(parent.expression, sf)})`);
        }
      } else if (ts.isConditionalExpression(parent)) {
        if (child === parent.whenTrue) {
          gates.push(gateText(parent.condition, sf));
        } else if (child === parent.whenFalse) {
          gates.push(`!(${gateText(parent.condition, sf)})`);
        }
      }
    }
    return gates.reverse();
  }
  const enclosingFunction = (node) => {
    for (let current = node.parent; current; current = current.parent) {
      if (ts.isArrowFunction(current) || ts.isFunctionExpression(current) || ts.isFunctionDeclaration(current)) {
        return current;
      }
    }
    return undefined;
  };
  return { ts, unwrap, literalText, isAssignment, isAssignmentTarget, globalPath, prefixedKey, gatesOf, enclosingFunction };
}

// Every statement of a file that installs something on the global object. A name that a local helper forwards from its
// parameter (setUpTimers.js's defineLazyTimer) is resolved through the helper's calls in the same file.
function findInstalls(syntax, { sf }) {
  const { ts, unwrap, literalText, isAssignment, globalPath, prefixedKey, gatesOf, enclosingFunction } = syntax;
  const aliases = new Map();
  visit(sf, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const target = globalPath(node.initializer, new Map());
      if (target?.length) {
        aliases.set(node.name.text, target);
      }
    }
  });
  const found = [];
  const unresolved = [];
  function keysOf(expression, node) {
    if (typeof expression === "string") {
      return [{ name: expression, gates: gatesOf(node, sf) }];
    }
    const literal = literalText(expression);
    if (literal !== undefined) {
      return [{ name: literal, gates: gatesOf(node, sf) }];
    }
    const prefixed = prefixedKey(expression);
    if (prefixed !== undefined) {
      return [{ name: prefixed, prefixedBy: METRO_PREFIX, gates: gatesOf(node, sf) }];
    }
    const value = unwrap(expression);
    const helper = ts.isIdentifier(value) ? enclosingFunction(node) : undefined;
    const parameter = helper?.parameters.findIndex((candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === value.text);
    const helperName = helper && (ts.isFunctionDeclaration(helper) ? helper.name?.text
      : ts.isVariableDeclaration(helper.parent) && ts.isIdentifier(helper.parent.name) ? helper.parent.name.text : undefined);
    if (parameter === undefined || parameter < 0 || !helperName) {
      return undefined;
    }
    const names = [];
    visit(sf, (candidate) => {
      if (ts.isCallExpression(candidate) && ts.isIdentifier(candidate.expression) && candidate.expression.text === helperName) {
        names.push({ name: literalText(candidate.arguments[parameter] ?? candidate), call: candidate });
      }
    });
    if (!names.length || names.some((entry) => entry.name === undefined)) {
      return undefined;
    }
    return names.map(({ name, call }) => ({ name, gates: [...gatesOf(call, sf), ...gatesOf(node, sf, helper)] }));
  }
  function install(node, objectPath, nameExpression, form) {
    const keys = keysOf(nameExpression, node);
    if (!keys) {
      unresolved.push({ form, expression: collapse(node.getText(sf)), source: sf.fileName });
      return;
    }
    for (const key of keys) {
      found.push({ node, path: [...objectPath, key.name], form, gates: key.gates, ...(key.prefixedBy ? { prefixedBy: key.prefixedBy } : {}) });
    }
  }
  visit(sf, (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && callee.text === "polyfillGlobal" && node.arguments.length >= 2) {
        install(node, [], node.arguments[0], "polyfillGlobal");
      } else if (ts.isIdentifier(callee) && callee.text === "polyfillObjectProperty" && node.arguments.length >= 3) {
        const target = globalPath(node.arguments[0], aliases);
        if (target) {
          install(node, target, node.arguments[1], "polyfillObjectProperty");
        } else {
          unresolved.push({ form: "polyfillObjectProperty", expression: collapse(node.getText(sf)), source: sf.fileName });
        }
      } else if (ts.isPropertyAccessExpression(callee) && callee.name.text === "defineProperty" &&
        ts.isIdentifier(callee.expression) && callee.expression.text === "Object" && node.arguments.length >= 3) {
        const target = globalPath(node.arguments[0], aliases);
        if (target) {
          install(node, target, node.arguments[1], "defineProperty");
        }
      }
    } else if (isAssignment(node) && (ts.isPropertyAccessExpression(node.left) || ts.isElementAccessExpression(node.left))) {
      // Aliases are for the helper calls above; `alias.x = 1` changes an object, it does not install a global.
      const target = globalPath(node.left.expression, new Map());
      if (target) {
        install(node, target, ts.isPropertyAccessExpression(node.left) ? node.left.name.text : node.left.argumentExpression, "assignment");
      }
    }
  });
  return { found, unresolved };
}

// What a file executes when it is required: expression statements that require a relative module (the entry function
// requires its setup modules this way) or call a function imported from one. Lazy thunks are not executed.
function executedModules(syntax, source) {
  const { ts, unwrap, literalText, gatesOf } = syntax;
  const imported = new Map();
  for (const statement of source.sf.statements) {
    const clause = ts.isImportDeclaration(statement) && !statement.importClause?.isTypeOnly ? statement.importClause : undefined;
    if (clause && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text.startsWith(".")) {
      if (clause.name) {
        imported.set(clause.name.text, statement.moduleSpecifier.text);
      }
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          if (!element.isTypeOnly) {
            imported.set(element.name.text, statement.moduleSpecifier.text);
          }
        }
      }
    }
  }
  const requireSpecifier = (expression) => {
    let current = unwrap(expression);
    while (ts.isCallExpression(current) || ts.isPropertyAccessExpression(current)) {
      if (ts.isCallExpression(current) && ts.isIdentifier(current.expression) && current.expression.text === "require") {
        const spec = current.arguments[0] && literalText(current.arguments[0]);
        return spec?.startsWith(".") ? spec : undefined;
      }
      current = unwrap(current.expression);
    }
    return undefined;
  };
  const modules = [];
  visit(source.sf, (node) => {
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      return false;
    }
    if (ts.isExpressionStatement(node)) {
      const call = unwrap(node.expression);
      const spec = requireSpecifier(call) ?? (ts.isCallExpression(call) && ts.isIdentifier(call.expression) ? imported.get(call.expression.text) : undefined);
      if (spec) {
        modules.push({ spec, gates: gatesOf(node, source.sf) });
      }
    }
    return true;
  });
  return modules;
}

// The chain InitializeCore runs: the wrapper files down to the entry function, every module the entry function requires
// (the installers), and the setUp*/polyfill* modules those load.
function setupChain(syntax, sources) {
  const chain = [];
  const chainFiles = new Map();
  const register = (entry) => {
    chain.push(entry);
    chainFiles.set(entry.file, entry);
  };
  function follow(file, role, installer, gates, filter) {
    if (chainFiles.has(file)) {
      return;
    }
    register({ file, role, ...(installer ? { installer } : {}), gates });
    for (const module of executedModules(syntax, sources.get(file))) {
      if (filter(module.spec)) {
        follow(resolveModule(sources, file, module.spec), "nested", installer, [...gates, ...module.gates], filter);
      }
    }
  }
  const wrapperPath = [];
  (function findEntry(file, trail) {
    if (file === SETUP_ENTRY) {
      wrapperPath.push(...trail);
      return;
    }
    if (wrapperPath.length || trail.includes(file)) {
      return;
    }
    for (const module of executedModules(syntax, sources.get(file))) {
      findEntry(resolveModule(sources, file, module.spec), [...trail, file]);
    }
  })(SETUP_WRAPPER, []);
  if (!wrapperPath.length) {
    throw new Error(`${SETUP_WRAPPER} no longer reaches ${SETUP_ENTRY}`);
  }
  for (const file of wrapperPath) {
    register({ file, role: "wrapper", gates: [] });
  }
  register({ file: SETUP_ENTRY, role: "entry", gates: [] });
  for (const module of executedModules(syntax, sources.get(SETUP_ENTRY))) {
    const installer = resolveModule(sources, SETUP_ENTRY, module.spec);
    follow(installer, "installer", installer, module.gates, (spec) => NESTED_SETUP.test(path.posix.basename(spec)));
  }
  return { chain, chainFiles, wrapperPath };
}

const globalOwner = (installPath) => installPath.length === 1 ? "global" : installPath.slice(0, -1).join(".");

// One row per property the chain installs, with every site (installer, file, form, conditions) that installs it.
function chainRows(syntax, sources, chain) {
  const sites = new Map();
  const installsByFile = new Map();
  for (const entry of chain) {
    const source = sources.get(entry.file);
    const { found, unresolved } = findInstalls(syntax, source);
    if (unresolved.length) {
      throw new Error(`Unresolved install in the setup chain: ${unresolved.map((item) => `${item.source}: ${item.expression}`).join("; ")}`);
    }
    installsByFile.set(entry.file, found.length);
    for (const item of found) {
      const owner = globalOwner(item.path);
      const name = item.path.at(-1);
      const id = `runtime-global:${owner}.${name}`;
      const site = {
        installer: entry.installer ?? entry.file, source: entry.file, form: item.form,
        // A condition that guards both the installer and the install (setUpReactRefresh's `__DEV__`) is listed once.
        gates: [...new Set([...entry.gates, ...item.gates])], ...(item.prefixedBy ? { prefixedBy: item.prefixedBy } : {}),
      };
      const group = sites.get(id) ?? { owner, name, sites: [] };
      group.sites.push({ ...site, position: item.node.getStart(source.sf), index: chain.indexOf(entry) });
      sites.set(id, group);
    }
  }
  const rows = [...sites].map(([id, group]) => {
    const ordered = group.sites.sort((left, right) => left.index - right.index || left.position - right.position)
      .map(({ position: _position, index: _index, ...site }) => site);
    const forms = [...new Set(ordered.map((site) => site.form))].sort(byText);
    return {
      id, kind: "runtime-global", owner: group.owner, name: group.name, type: forms.join(", "),
      source: ordered[0].source, installer: ordered[0].installer, sites: ordered,
    };
  });
  return { rows, installsByFile };
}

// Every install in the scanned tree: what installs a top-level global name (and whether the chain does), the installs the
// chain does not run, and the installs whose name could not be resolved.
function treeInstalls(syntax, sources, chainFiles) {
  const installedRoots = new Map();
  const outsideChain = new Map();
  const unresolved = [];
  for (const source of sources.values()) {
    const found = findInstalls(syntax, source);
    for (const item of found.found) {
      if (item.path.length === 1) {
        installedRoots.set(item.path[0], [...(installedRoots.get(item.path[0]) ?? []), source.rel]);
      }
      if (!chainFiles.has(source.rel)) {
        const id = `runtime-global:${globalOwner(item.path)}.${item.path.at(-1)}`;
        outsideChain.set(`${id}\0${source.rel}`, { id, source: source.rel, form: item.form });
      }
    }
    if (!chainFiles.has(source.rel)) {
      unresolved.push(...found.unresolved);
    }
  }
  const installedBy = new Map([...installedRoots].map(([name, files]) => [name, {
    file: [...new Set(files)].sort(byText)[0], inChain: files.some((file) => chainFiles.has(file)),
  }]));
  return {
    installedBy, unresolved: sortedUnique(unresolved),
    outsideChain: [...outsideChain.values()].sort((left, right) => byText(left.id, right.id) || byText(left.source, right.source)),
  };
}

// The runtime globals of the chain. `installedBy` (top-level global name -> the file that installs it and whether the chain
// does) is what the host globals exclude.
function runtimeGlobals(syntax, sources, { chain, chainFiles, wrapperPath }) {
  const { rows, installsByFile } = chainRows(syntax, sources, chain);
  const tree = treeInstalls(syntax, sources, chainFiles);
  return {
    rows, installedBy: tree.installedBy,
    derivation: {
      rule: `Statements that install a property on the global object in the modules InitializeCore runs: the wrappers ${wrapperPath.join(" and ")}, the entry function ${SETUP_ENTRY}, every module that function requires as a statement (installers), and the setUp*/polyfill* modules those load. Forms: polyfillGlobal, polyfillObjectProperty, Object.defineProperty and assignment on global or globalThis, with names resolved through literals, local helper calls and Metro's ${METRO_PREFIX} prefix. Each row lists its sites with the conditions around them, outermost first.`,
      chain: chain.map((entry) => ({ ...entry, installs: installsByFile.get(entry.file) })),
      outsideChain: tree.outsideChain,
      unresolved: tree.unresolved,
    },
  };
}

const declaredNames = ({ ts }, sf) => {
  const names = new Set();
  visit(sf, (node) => {
    const declaration = ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node) ||
      ts.isImportSpecifier(node) || ts.isImportClause(node) || ts.isNamespaceImport(node) || ts.isBindingElement(node);
    if (declaration && node.name && ts.isIdentifier(node.name)) {
      names.add(node.name.text);
    }
  });
  return names;
};
const isFreeReference = ({ ts }, node) => {
  const parent = node.parent;
  if ((ts.isPropertyAccessExpression(parent) && parent.name === node) || (ts.isQualifiedName(parent)) || ts.isTypeReferenceNode(parent) ||
    ts.isJsxAttribute(parent) || ts.isExportSpecifier(parent) || ts.isImportSpecifier(parent)) {
    return false;
  }
  return !((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent) ||
    ts.isPropertySignature(parent) || ts.isMethodSignature(parent)) && parent.name === node);
};

// Every read of a global name: `global.<name>`, `global["<name>"]` and the listed free identifiers, by name and by file.
function collectReads(syntax, sources) {
  const { ts, literalText, isAssignmentTarget } = syntax;
  const reads = new Map();
  const dynamicReads = [];
  const addRead = (name, form, rel) => {
    const entry = reads.get(name) ?? { files: new Set(), forms: new Set() };
    entry.files.add(rel);
    entry.forms.add(form);
    reads.set(name, entry);
  };
  for (const source of sources.values()) {
    const declared = declaredNames(syntax, source.sf);
    visit(source.sf, (node) => {
      if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && ts.isIdentifier(node.expression) &&
        GLOBAL_ROOTS.has(node.expression.text) && !isAssignmentTarget(node)) {
        const name = ts.isPropertyAccessExpression(node) ? node.name.text : literalText(node.argumentExpression);
        if (name === undefined) {
          dynamicReads.push({ source: source.rel, expression: collapse(node.getText(source.sf)) });
        } else {
          addRead(name, "global member read", source.rel);
        }
      } else if (ts.isIdentifier(node) && FREE_IDENTIFIER_READS.includes(node.text) && !declared.has(node.text) && isFreeReference(syntax, node)) {
        addRead(node.text, "free identifier read", source.rel);
      }
    });
  }
  return { reads, dynamicReads };
}

// The globals RN's JS reads that no RN file installs. `installedBy` comes from the runtime globals: what the chain (or any
// other RN module) installs is not a host contract.
function hostGlobals(syntax, sources, installedBy) {
  const { reads, dynamicReads } = collectReads(syntax, sources);
  const rows = [];
  const excluded = [];
  for (const name of [...reads.keys()].sort(byText)) {
    const read = reads.get(name);
    const readers = [...read.files].sort(byText);
    const installer = installedBy.get(name);
    if (installer) {
      excluded.push({ name, readers: readers.length, reason: `installed by RN's own JS ${installer.inChain ? "in the setup chain" : "outside the setup chain"}: ${installer.file}` });
    } else if (HOST_GLOBAL_EXCLUSIONS[name]) {
      excluded.push({ name, readers: readers.length, reason: HOST_GLOBAL_EXCLUSIONS[name] });
    } else if (HOST_GLOBAL_NAME.test(name) || HOST_GLOBAL_ALLOW[name]) {
      rows.push({
        id: `host-global:global.${name}`, kind: "host-global", owner: "global", name, type: [...read.forms].sort(byText).join(", "),
        source: readers[0], readers: readers.length,
      });
    } else {
      throw new Error(`Review the global RN reads: ${name} is not installed by RN, not host-named and not excluded (${readers[0]})`);
    }
  }
  for (const name of [...Object.keys(HOST_GLOBAL_ALLOW), ...FREE_IDENTIFIER_READS]) {
    if (!reads.has(name)) {
      throw new Error(`The host-global list names ${name}, which no scanned RN file reads`);
    }
  }
  for (const name of Object.keys(HOST_GLOBAL_EXCLUSIONS)) {
    if (!reads.has(name)) {
      throw new Error(`The host-global exclusions name ${name}, which no scanned RN file reads`);
    }
  }
  return {
    rows,
    derivation: {
      rule: `Names RN's JS reads as global.<name>, globalThis.<name> or global["<name>"], plus the free identifiers listed below, that no file under ${SCAN_ROOTS.join(" or ")} installs. A name is a row when it starts with native<Upper>, RN$ or __, or is in the allow-list; every other read must be excluded below with its reason or the generator fails. Directories named __*__ are not scanned.`,
      allowList: Object.entries(HOST_GLOBAL_ALLOW).map(([name, reason]) => ({ name, reason })).sort((left, right) => byText(left.name, right.name)),
      freeIdentifierReads: [...FREE_IDENTIFIER_READS].sort(byText),
      excluded,
      dynamicReads: sortedUnique(dynamicReads),
    },
  };
}

// The type of a command: its member of the Commands interface, which is local or a generic interface imported by a local
// alias (`type NativeCommands = TextInputNativeCommands<NativeType>`) with its argument substituted.
function commandTyper(syntax, sources) {
  const { ts } = syntax;
  const printer = ts.createPrinter({ removeComments: true, omitTrailingSemicolon: true });
  const printNode = (node, sf) => collapse(printer.printNode(ts.EmitHint.Unspecified, node, sf));
  const declarationNamed = (sf, name) => sf.statements.find((statement) =>
    (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) && statement.name.text === name);
  function commandInterface(source, reference) {
    const declaration = declarationNamed(source.sf, reference.typeName.text);
    if (!declaration) {
      throw new Error(`${source.rel}: no declaration of ${reference.typeName.text}`);
    }
    if (ts.isInterfaceDeclaration(declaration)) {
      return { declaration, sf: source.sf, substitutions: new Map() };
    }
    const target = declaration.type;
    if (!ts.isTypeReferenceNode(target) || !ts.isIdentifier(target.typeName)) {
      throw new Error(`${source.rel}: unsupported commands alias ${reference.typeName.text}`);
    }
    for (const statement of source.sf.statements) {
      const bindings = ts.isImportDeclaration(statement) ? statement.importClause?.namedBindings : undefined;
      const element = bindings && ts.isNamedImports(bindings)
        ? bindings.elements.find((candidate) => candidate.name.text === target.typeName.text) : undefined;
      if (element) {
        const imported = sources.get(resolveModule(sources, source.rel, statement.moduleSpecifier.text));
        const generic = declarationNamed(imported.sf, (element.propertyName ?? element.name).text);
        const substitutions = new Map();
        generic.typeParameters?.forEach((parameter, index) => {
          substitutions.set(parameter.name.text, printNode(target.typeArguments[index], source.sf));
        });
        return { declaration: generic, sf: imported.sf, substitutions };
      }
    }
    throw new Error(`${source.rel}: ${target.typeName.text} is not imported`);
  }
  function commandType({ declaration, sf, substitutions }, command, rel) {
    const member = declaration.members.find((candidate) => ts.isPropertySignature(candidate) && candidate.name.getText(sf) === command);
    if (!member?.type) {
      throw new Error(`${rel}: ${command} is not a member of ${declaration.name.text}`);
    }
    if (!substitutions.size) {
      return printNode(member.type, sf);
    }
    const result = ts.transform(member.type, [(context) => (root) => {
      const replace = (node) => ts.isTypeReferenceNode(node) && !node.typeArguments && ts.isIdentifier(node.typeName) && substitutions.has(node.typeName.text)
        ? ts.factory.createTypeReferenceNode(substitutions.get(node.typeName.text))
        : ts.visitEachChild(node, replace, context);
      return ts.visitNode(root, replace);
    }]);
    const printed = printNode(result.transformed[0], sf);
    result.dispose();
    return printed;
  }
  return { commandInterface, commandType };
}

// codegenNativeCommands<Commands>({supportedCommands: [...]}) call sites, one row per supported command.
function nativeCommands(syntax, sources) {
  const { ts, unwrap, literalText } = syntax;
  const { commandInterface, commandType } = commandTyper(syntax, sources);
  const rows = [];
  const callSites = [];
  for (const source of sources.values()) {
    visit(source.sf, (node) => {
      if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== "codegenNativeCommands") {
        return true;
      }
      const reference = node.typeArguments?.[0];
      const options = node.arguments[0] && unwrap(node.arguments[0]);
      const property = options && ts.isObjectLiteralExpression(options)
        ? options.properties.find((candidate) => ts.isPropertyAssignment(candidate) && candidate.name.getText(source.sf) === "supportedCommands") : undefined;
      const list = property && unwrap(property.initializer);
      if (!reference || !ts.isTypeReferenceNode(reference) || !ts.isIdentifier(reference.typeName) || !list || !ts.isArrayLiteralExpression(list) ||
        list.elements.some((element) => literalText(element) === undefined)) {
        throw new Error(`${source.rel}: unsupported codegenNativeCommands call`);
      }
      const owner = path.posix.basename(source.rel, ".js");
      const commands = list.elements.map(literalText);
      const resolved = commandInterface(source, reference);
      callSites.push({ owner, source: source.rel, commands: commands.length });
      for (const command of commands) {
        rows.push({
          id: `native-command:${owner}.${command}`, kind: "native-command", owner, name: command,
          type: commandType(resolved, command, source.rel), source: source.rel,
        });
      }
      return true;
    });
  }
  callSites.sort((left, right) => byText(left.source, right.source));
  return {
    rows,
    derivation: {
      rule: `Every codegenNativeCommands<Commands>({supportedCommands: [...]}) call under ${SCAN_ROOTS.join(" and ")}; owner is the file's name, type the command's member of the Commands interface (generic arguments substituted).`,
      callSites,
    },
  };
}

export function scanUpstream({ ts, upstream }) {
  const syntax = createSyntax(ts);
  const sources = loadSources(ts, upstream);
  const runtime = runtimeGlobals(syntax, sources, setupChain(syntax, sources));
  const host = hostGlobals(syntax, sources, runtime.installedBy);
  const commands = nativeCommands(syntax, sources);
  return {
    rows: [...runtime.rows, ...host.rows, ...commands.rows],
    derivation: { runtimeGlobals: runtime.derivation, hostGlobals: host.derivation, nativeCommands: commands.derivation },
    files: [...sources.values()].map(({ rel, sha256 }) => ({ file: rel, sha256 })),
  };
}

// The setup chain as the bootstrap audit (tests/bootstrap-audit.test.mjs) reads it: every module InitializeCore runs, in order,
// with the conditions around it and the names it installs. It comes from the same derivation as the runtime-global rows above and
// changes nothing in scanUpstream's output.
export function scanBootstrap({ ts, upstream }) {
  const syntax = createSyntax(ts);
  const sources = loadSources(ts, upstream);
  const { chain } = setupChain(syntax, sources);
  const { rows } = chainRows(syntax, sources, chain);
  const installed = new Map();
  for (const row of rows) {
    const name = row.owner === "global" ? row.name : `${row.owner}.${row.name}`;
    for (const site of row.sites) {
      installed.set(site.source, [...(installed.get(site.source) ?? []), name]);
    }
  }
  return {
    wrapper: SETUP_WRAPPER,
    entry: SETUP_ENTRY,
    steps: chain.map((entry) => ({
      file: entry.file, role: entry.role, ...(entry.installer ? { installer: entry.installer } : {}), gates: entry.gates,
      globals: [...new Set(installed.get(entry.file) ?? [])].sort(byText),
    })),
  };
}

// A mechanical marker: the module of a public value has an iOS or Android implementation file next to its generic one, or
// one of `names` (the value's, and for a member also its member's) says it. It is not a decision about what applies to Godot.
export function platformImplementation(upstream, declarationSource, names) {
  const module = declarationSource.replace(/^types_generated\//, "").replace(/\.d\.ts$/, "");
  const evidence = [];
  const platforms = new Set();
  for (const platform of ["android", "ios"]) {
    const file = `${module}.${platform}.js`;
    if (existsSync(path.join(upstream, file))) {
      platforms.add(platform);
      evidence.push(file);
    }
  }
  for (const name of names) {
    const suffix = /(IOS|Android)$/.exec(name)?.[1];
    if (suffix) {
      platforms.add(suffix === "IOS" ? "ios" : "android");
      evidence.push(`${name} ends with ${suffix}`);
    }
  }
  return platforms.size ? { platformImplementation: [...platforms].sort(byText), platformEvidence: evidence } : undefined;
}
