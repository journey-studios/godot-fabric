#!/usr/bin/env node
// Standalone experiment: original RN specs -> original common C++ / ViewConfig.
// This does not load native libraries, install providers, or implement a widget.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {CODEGEN_VERSION, CodegenError, SCHEMA_PROFILE, reject, validateCombination,
  validateSchema} from './codegen-contract.mjs';

const require = createRequire(import.meta.url);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_FORMAT = 'godot-fabric.experimental-codegen/v1';
const CPP_GENERATORS = ['generateComponentDescriptorH', 'generateComponentDescriptorCpp',
  'generateEventEmitterH', 'generateEventEmitterCpp', 'generatePropsH', 'generatePropsCpp',
  'generateStateH', 'generateStateCpp', 'generateShadowNodeH', 'generateShadowNodeCpp'];
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const slash = value => value.split(path.sep).join('/');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

function listFiles(directory, relative = '', ownPackage = false) {
  const result = [];
  for (const entry of fs.readdirSync(path.join(directory, relative)).sort()) {
    // Dependency packages have their own identities below. This also handles
    // nested npm installs without treating node_modules/.bin links as source.
    if (ownPackage && entry === 'node_modules') continue;
    const filename = path.join(relative, entry);
    const stat = fs.lstatSync(path.join(directory, filename));
    if (stat.isDirectory()) result.push(...listFiles(directory, filename, ownPackage));
    else if (stat.isFile()) result.push(slash(filename));
    else reject('UNSAFE_PATH', `non-regular entry ${slash(filename)}`);
  }
  return result;
}

function readJson(filename) {
  try { return JSON.parse(fs.readFileSync(filename, 'utf8')); }
  catch (error) { reject('INVALID_JSON', `${path.basename(filename)}: ${error.message}`); }
}

function packageIdentity(name, resolver, lock) {
  const packagePath = resolver.resolve(`${name}/package.json`);
  const packageRoot = path.dirname(packagePath);
  const pkg = readJson(packagePath);
  const installPath = slash(path.relative(repository, packageRoot));
  const locked = lock.packages?.[installPath];
  if (pkg.name !== name || typeof pkg.version !== 'string' || locked?.version !== pkg.version
    || typeof locked.integrity !== 'string' || !locked.integrity) {
    reject('TOOL_VERSION_MISMATCH', `the project lockfile must identify the resolved ${name} package at ${installPath}`);
  }
  const fileHashes = listFiles(packageRoot, '', true).map(filename => ({path: filename,
    sha256: sha256(fs.readFileSync(path.join(packageRoot, filename)))}));
  return {packagePath, identity: {package: name, version: pkg.version, integrity: locked.integrity,
    installPath, sourceTreeSha256: sha256(json(fileHashes))}};
}

function toolIdentity() {
  const lockPath = path.join(repository, 'package-lock.json');
  const lock = readJson(lockPath);
  const codegen = packageIdentity('@react-native/codegen', require, lock);
  if (codegen.identity.version !== CODEGEN_VERSION) {
    reject('TOOL_VERSION_MISMATCH', `expected Codegen ${CODEGEN_VERSION}, found ${codegen.identity.version}`);
  }
  const codegenRequire = createRequire(codegen.packagePath);
  // Resolve at the original import sites, rather than assuming project-level
  // hoisting. Hermes' ESTree transforms execute hermes-estree at runtime;
  // Babel's @babel/types dependency is declaration-only, not parser execution.
  const babel = packageIdentity('@babel/parser', createRequire(codegenRequire.resolve(
    './lib/parsers/typescript/parser.js')), lock);
  const hermes = packageIdentity('hermes-parser', createRequire(codegenRequire.resolve(
    './lib/parsers/flow/parseFlowAndThrowErrors.js')), lock);
  const estree = packageIdentity('hermes-estree', createRequire(hermes.packagePath), lock);
  return {
    ...codegen.identity, lockfileSha256: sha256(fs.readFileSync(lockPath)),
    parserDependencies: [babel, hermes, estree].map(({identity}) => identity),
    nodeVersion: process.version,
    wrapperSources: ['scripts/codegen-contract.mjs', 'scripts/codegen.mjs'].map(filename => ({
      path: filename, sha256: sha256(fs.readFileSync(path.join(repository, filename))),
    })),
  };
}

function parseSpecs(root, specs) {
  const {TypeScriptParser} = require('@react-native/codegen/lib/parsers/typescript/parser.js');
  const {FlowParser} = require('@react-native/codegen/lib/parsers/flow/parser.js');
  const inputs = new Map();
  for (const input of specs) {
    const absolute = fs.realpathSync(path.resolve(root, input));
    const relative = slash(path.relative(root, absolute));
    if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) reject('UNSAFE_PATH', `spec must be inside the source root: ${input}`);
    if (!fs.statSync(absolute).isFile()) reject('INVALID_SPEC', `${relative} is not a file`);
    if (inputs.has(relative)) reject('NAME_COLLISION', `duplicate spec path ${relative}`);
    const extension = path.extname(relative);
    if (!['.ts', '.js'].includes(extension)) reject('INVALID_SPEC', `${relative}: this experiment accepts .ts or Flow .js specs`);
    const bytes = fs.readFileSync(absolute);
    const contents = bytes.toString('utf8');
    if (!Buffer.from(contents, 'utf8').equals(bytes)) reject('INVALID_SPEC', `${relative}: specs must contain valid UTF-8`);
    try {
      const parser = extension === '.ts' ? new TypeScriptParser() : new FlowParser();
      const schema = parser.parseString(contents, relative);
      validateSchema(schema);
      inputs.set(relative, {bytes, schema});
    } catch (error) {
      if (error instanceof CodegenError) throw error;
      reject('INVALID_SPEC', `${relative}: ${error.message}`);
    }
  }
  const schema = {modules: Object.create(null)};
  const sources = [];
  for (const relative of [...inputs.keys()].sort()) {
    const input = inputs.get(relative);
    sources.push({path: relative, sha256: sha256(input.bytes)});
    for (const [name, module] of Object.entries(input.schema.modules)) {
      if (Object.hasOwn(schema.modules, name)) reject('NAME_COLLISION', `module key ${name} is declared by more than one spec`);
      schema.modules[name] = module;
    }
  }
  validateSchema(schema);
  require('@react-native/codegen/lib/SchemaValidator.js').validate(schema);
  return {schema, sources};
}

function createArtifacts(libraryName, schema) {
  const codegen = require('@react-native/codegen/lib/generators/RNCodegen.js');
  const files = new Map();
  const portablePaths = new Map();
  const add = (filename, content, generator) => {
    if (typeof filename !== 'string' || !filename || path.isAbsolute(filename)
      || filename.includes('\\') || filename.split('/').some(part => !part || part === '.' || part === '..')) {
      reject('UNSAFE_PATH', `generator ${generator} emitted an unsafe path`);
    }
    if (files.has(filename)) reject('NAME_COLLISION', `generators collide at ${filename}`);
    const portable = filename.toLowerCase();
    if (portablePaths.has(portable)) reject('NAME_COLLISION', `portable artifact path ${filename} collides with ${portablePaths.get(portable)}`);
    portablePaths.set(portable, filename);
    if (typeof content !== 'string') reject('GENERATION_FAILED', `${generator} emitted non-text ${filename}`);
    files.set(filename, {content, generator});
  };
  // Call the original generators directly so filename collisions cannot be
  // silently overwritten by RNCodegen.generate's write loop. No iOS/Java stubs.
  if (Object.values(schema.modules).some(module => module.type === 'Component')) {
    const prefix = `react/renderer/components/${libraryName}/`;
    for (const name of CPP_GENERATORS) {
      const generator = codegen.allGenerators[name];
      if (typeof generator !== 'function') reject('TOOL_VERSION_MISMATCH', `missing original generator ${name}`);
      for (const [filename, content] of generator(libraryName, schema, undefined, false, prefix, false)) {
        add(`cpp/${prefix}${filename}`, content, name);
      }
    }
    for (const [moduleName, module] of Object.entries(schema.modules)) {
      if (module.type !== 'Component') continue;
      for (const [componentName, component] of Object.entries(module.components)) {
        const viewSchema = {modules: {[moduleName]: {type: 'Component', components: {[componentName]: component}}}};
        const content = codegen.generateViewConfig({libraryName: componentName, schema: viewSchema});
        add(`viewconfigs/${componentName}NativeViewConfig.js`, content, 'generateViewConfigJs');
      }
    }
  }
  if (Object.values(schema.modules).some(module => module.type === 'NativeModule')) {
    for (const [filename, content] of codegen.allGenerators.generateModuleH(libraryName, schema)) {
      add(`cpp/${filename}`, content, 'generateModuleH');
    }
  }
  return new Map([...files.entries()].sort(([left], [right]) => left.localeCompare(right, 'en')));
}

export function prepareCodegen({root, specs, libraryName, nativeCombination}) {
  if (!Array.isArray(specs) || specs.length === 0) reject('INVALID_ARGUMENT', 'at least one --spec is required');
  if (typeof libraryName !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(libraryName)) {
    reject('INVALID_ARGUMENT', '--library must be a C++ identifier');
  }
  const sourceRoot = fs.realpathSync(root);
  const combination = canonical(validateCombination(nativeCombination));
  const tools = toolIdentity();
  const {schema, sources} = parseSpecs(sourceRoot, specs);
  let artifacts;
  try { artifacts = createArtifacts(libraryName, schema); }
  catch (error) {
    if (error instanceof CodegenError) throw error;
    reject('GENERATION_FAILED', error.message);
  }
  const schemaContent = json(schema);
  const manifest = {
    format: MANIFEST_FORMAT, schemaProfile: SCHEMA_PROFILE, libraryName,
    nativeCombination: {declaration: combination, sha256: sha256(json(combination))},
    tools, sources, schema: {path: 'schema.json', sha256: sha256(schemaContent)},
    artifacts: [...artifacts].map(([filename, {content, generator}]) => ({path: filename,
      sha256: sha256(content), generator})),
    claims: {nativeCompiled: false, nativeLoaded: false, runtimeExecuted: false, abiCertified: false},
  };
  const files = new Map([...artifacts].map(([filename, {content}]) => [filename, content]));
  files.set('schema.json', schemaContent);
  files.set('manifest.json', json(manifest));
  return {manifest, files};
}

export function generateCodegen(options) {
  const output = path.resolve(options.out);
  if (fs.existsSync(output)) reject('OUTPUT_EXISTS', `${output} already exists; verify it or choose a new directory`);
  const prepared = prepareCodegen(options);
  fs.mkdirSync(path.dirname(output), {recursive: true});
  const staging = fs.mkdtempSync(path.join(path.dirname(output), '.codegen-'));
  let reservedOutput = false;
  let published = false;
  try {
    for (const [filename, contents] of prepared.files) {
      const destination = path.join(staging, filename);
      fs.mkdirSync(path.dirname(destination), {recursive: true});
      fs.writeFileSync(destination, contents);
    }
    // Reserve the destination with exclusive mkdir. rename(staging, output)
    // would replace a concurrently created empty directory on POSIX.
    try { fs.mkdirSync(output); }
    catch (error) {
      if (error.code === 'EEXIST') reject('OUTPUT_EXISTS', `${output} was created during generation`);
      throw error;
    }
    reservedOutput = true;
    const entries = fs.readdirSync(staging).filter(entry => entry !== 'manifest.json').sort();
    for (const entry of [...entries, 'manifest.json']) fs.renameSync(path.join(staging, entry), path.join(output, entry));
    // Readers only accept a directory after the complete manifest is published.
    published = true;
  } finally {
    if (fs.existsSync(staging)) fs.rmSync(staging, {recursive: true, force: true});
    if (reservedOutput && !published) fs.rmSync(output, {recursive: true, force: true});
  }
  return prepared.manifest;
}

export function verifyCodegen(options) {
  const output = path.resolve(options.out);
  const recorded = readJson(path.join(output, 'manifest.json'));
  if (recorded.format !== MANIFEST_FORMAT || recorded.schemaProfile !== SCHEMA_PROFILE) reject('UNSUPPORTED_SCHEMA', 'unsupported artifact manifest/profile');
  const expectedCombination = canonical(validateCombination(options.nativeCombination));
  if (json(recorded.nativeCombination?.declaration) !== json(expectedCombination)) {
    reject('NATIVE_COMBINATION_MISMATCH', 'the expected target/architecture/SDK/headers/runtime/toolchain declaration differs');
  }
  validateSchema(readJson(path.join(output, 'schema.json')));
  const expected = prepareCodegen(options);
  if (json(recorded.tools) !== json(expected.manifest.tools)) reject('STALE_TOOL', 'Codegen, lockfile, Node, or wrapper provenance differs; regenerate');
  if (json(recorded.sources) !== json(expected.manifest.sources)) reject('STALE_SOURCE', 'source set or source bytes differ; regenerate');
  if (json(recorded.schema) !== json(expected.manifest.schema)
    || sha256(fs.readFileSync(path.join(output, 'schema.json'))) !== expected.manifest.schema.sha256) {
    reject('STALE_SCHEMA', 'derived schema differs from current specs');
  }
  if (json(recorded) !== json(expected.manifest)) reject('STALE_MANIFEST', 'manifest differs from the current reproducible generation');
  const actualPaths = listFiles(output);
  const expectedPaths = [...expected.files.keys()].sort();
  if (json(actualPaths.sort()) !== json(expectedPaths)) reject('STALE_ARTIFACT', 'generated file set differs (missing or unexpected file)');
  for (const [filename, contents] of expected.files) {
    if (!fs.readFileSync(path.join(output, filename)).equals(Buffer.from(contents, 'utf8'))) reject('STALE_ARTIFACT', `${filename} differs from original generator output bytes`);
  }
  return expected.manifest;
}

function main(args) {
  if (args.length === 0 || args[0] === '--help') {
    process.stdout.write('Experimental original RN Codegen (no native integration)\n'
      + 'node scripts/codegen.mjs generate|verify --root DIR --library NAME --native-combination JSON --out DIR --spec FILE [--spec FILE]\n'
      + 'generate requires a new output directory; verify compares current specs/tools/declaration and every generated byte.\n');
    return;
  }
  const command = args.shift();
  if (!['generate', 'verify'].includes(command)) reject('INVALID_ARGUMENT', 'expected generate or verify');
  const options = {specs: []};
  const names = {'--root': 'root', '--library': 'libraryName', '--out': 'out', '--native-combination': 'combinationPath'};
  while (args.length) {
    const option = args.shift();
    const value = args.shift();
    if (!value || value.startsWith('--')) reject('INVALID_ARGUMENT', `missing value for ${option}`);
    if (option === '--spec') options.specs.push(value);
    else if (Object.hasOwn(names, option) && !Object.hasOwn(options, names[option])) options[names[option]] = value;
    else reject('INVALID_ARGUMENT', `unknown or duplicate option ${option}`);
  }
  for (const key of Object.values(names)) if (!options[key]) reject('INVALID_ARGUMENT', `missing ${key}`);
  options.nativeCombination = readJson(options.combinationPath);
  const manifest = command === 'generate' ? generateCodegen(options) : verifyCodegen(options);
  process.stdout.write(json({command, libraryName: manifest.libraryName,
    schemaSha256: manifest.schema.sha256, artifacts: manifest.artifacts.length,
    nativeCombinationSha256: manifest.nativeCombination.sha256, claims: manifest.claims}));
}

if (process.argv[1] && fs.existsSync(process.argv[1])
  && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
