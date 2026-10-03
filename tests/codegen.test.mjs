import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {generateCodegen, prepareCodegen, verifyCodegen} from '../scripts/codegen.mjs';
import {validateSchema} from '../scripts/codegen-contract.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(repository, 'tests/codegen');
const combination = JSON.parse(fs.readFileSync(path.join(fixtures, 'native-combination.json'), 'utf8'));
const specs = ['NativeCodegenProbe.ts', 'BadgeNativeComponent.ts'];
const clone = value => structuredClone(value);
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const require = createRequire(import.meta.url);
const codegenRequire = createRequire(require.resolve('@react-native/codegen/package.json'));
const typescriptRequire = createRequire(codegenRequire.resolve('./lib/parsers/typescript/parser.js'));
const flowRequire = createRequire(codegenRequire.resolve('./lib/parsers/flow/parseFlowAndThrowErrors.js'));
const hermesRequire = createRequire(flowRequire.resolve('hermes-parser/package.json'));
const parserPackages = [['@babel/parser', typescriptRequire], ['hermes-parser', flowRequire],
  ['hermes-estree', hermesRequire]];

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'godot-fabric-codegen-test-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  return directory;
}

function options(directory, overrides = {}) {
  return {root: fixtures, specs, libraryName: 'CodegenFixture', nativeCombination: combination,
    out: path.join(directory, 'generated'), ...overrides};
}

function fails(code, action, match) {
  assert.throws(action, error => error.code === code && (!match || match.test(error.message)));
}

test('original parsers/generators derive the module and Badge contract reproducibly', t => {
  const directory = temporary(t);
  const input = options(directory);
  const manifest = generateCodegen(input);
  const other = options(directory, {out: path.join(directory, 'second'), specs: [...specs].reverse()});
  const second = generateCodegen(other);
  assert.deepEqual(second, manifest, 'input order must not change derived artifacts or manifest');
  assert.deepEqual(verifyCodegen(input), manifest);
  assert.equal(manifest.tools.package, '@react-native/codegen');
  assert.equal(manifest.tools.version, '0.87.1');
  assert.match(manifest.tools.sourceTreeSha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.artifacts.length, 12);
  assert.deepEqual(manifest.claims, {nativeCompiled: false, nativeLoaded: false,
    runtimeExecuted: false, abiCertified: false});
  assert.equal(manifest.nativeCombination.declaration.purpose, 'test-fixture');
  const schema = JSON.parse(fs.readFileSync(path.join(input.out, 'schema.json'), 'utf8'));
  const badge = schema.modules.CodegenBadge.components.CodegenBadge;
  assert.deepEqual(badge.props.map(prop => [prop.name, prop.typeAnnotation.default]),
    [['caption', ''], ['enabled', true], ['count', 0]]);
  assert.equal(badge.events[0].bubblingType, 'direct');
  assert.deepEqual(badge.events[0].typeAnnotation.argument.properties.map(prop => prop.name), ['count', 'label']);
  assert.equal(badge.commands[0].name, 'focus');
  assert.equal(schema.modules.NativeCodegenProbe.spec.methods[1].typeAnnotation.returnTypeAnnotation.type,
    'PromiseTypeAnnotation');
  for (const artifact of manifest.artifacts) {
    const bytes = fs.readFileSync(path.join(input.out, artifact.path));
    assert.equal(digest(bytes), artifact.sha256);
    assert.deepEqual(bytes, fs.readFileSync(path.join(other.out, artifact.path)));
  }
  const cpp = filename => fs.readFileSync(path.join(input.out,
    'cpp/react/renderer/components/CodegenFixture', filename), 'utf8');
  assert.match(cpp('ComponentDescriptors.h'), /ConcreteComponentDescriptor<CodegenBadgeShadowNode>/);
  assert.match(cpp('Props.h'), /bool enabled\{true\}/);
  assert.match(cpp('EventEmitters.h'), /onActivate\(OnActivate/);
  assert.match(cpp('States.h'), /CodegenBadgeState/);
  assert.match(cpp('ShadowNodes.h'), /CodegenBadgeShadowNode/);
  const module = fs.readFileSync(path.join(input.out, 'cpp/CodegenFixtureJSI.h'), 'utf8');
  assert.match(module, /NativeCodegenProbeCxxSpec/);
  assert.match(module, /methodMap_\["add"\]/);
  assert.match(module, /AsyncEventEmitter/);
  assert.match(module, /emitOnResult/);
  assert.match(module, /ProbeResult/);
  const view = fs.readFileSync(path.join(input.out, 'viewconfigs/CodegenBadgeNativeViewConfig.js'), 'utf8');
  assert.match(view, /uiViewClassName: "CodegenBadge"/);
  assert.match(view, /onActivate/);
  assert.match(view, /dispatchCommand\(ref, "focus", \[\]\)/);
  assert.match(view, /@generated/);
  assert.doesNotMatch(fs.readFileSync(path.join(input.out, 'manifest.json'), 'utf8'),
    new RegExp(directory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('both TurboModule-only and component-only generation use the original relevant generators', t => {
  const directory = temporary(t);
  const module = generateCodegen(options(directory, {specs: [specs[0]]}));
  assert.deepEqual(module.artifacts.map(file => file.path), ['cpp/CodegenFixtureJSI.h']);
  const component = generateCodegen(options(directory, {specs: [specs[1]], out: path.join(directory, 'component')}));
  assert.equal(component.artifacts.length, 11);
  assert.ok(component.artifacts.every(file => !file.path.endsWith('JSI.h')));
});

test('original Flow parser derives and verifies a separate native module without collisions', t => {
  const directory = temporary(t);
  const input = options(directory, {specs: ['NativeFlowProbe.js'], libraryName: 'FlowFixture'});
  const manifest = generateCodegen(input);
  assert.deepEqual(verifyCodegen(input), manifest);
  assert.deepEqual(manifest.artifacts.map(file => file.path), ['cpp/FlowFixtureJSI.h']);
  const schema = JSON.parse(fs.readFileSync(path.join(input.out, 'schema.json'), 'utf8'));
  const module = schema.modules.NativeFlowProbe;
  assert.equal(module.moduleName, 'FlowProbe');
  assert.deepEqual(module.spec.methods.map(method => [method.name, method.typeAnnotation.returnTypeAnnotation.type]),
    [['echo', 'StringTypeAnnotation'], ['count', 'NumberTypeAnnotation']]);
  assert.equal(module.spec.methods[0].typeAnnotation.params[0].typeAnnotation.type, 'StringTypeAnnotation');
  const header = fs.readFileSync(path.join(input.out, manifest.artifacts[0].path), 'utf8');
  assert.match(header, /NativeFlowProbeCxxSpec/);
  assert.match(header, /kModuleName = "FlowProbe"/);
  assert.match(header, /methodMap_\["echo"\]/);
  assert.match(header, /methodMap_\["count"\]/);
  const combined = options(directory, {specs: [...specs, 'NativeFlowProbe.js'],
    out: path.join(directory, 'combined')});
  assert.equal(generateCodegen(combined).artifacts.length, 12);
  assert.deepEqual(verifyCodegen(combined).sources.map(source => source.path),
    ['BadgeNativeComponent.ts', 'NativeCodegenProbe.ts', 'NativeFlowProbe.js']);
});

test('resolved Babel, Hermes and runtime ESTree trees participate in tool identity', t => {
  const directory = temporary(t);
  const input = options(directory);
  const manifest = generateCodegen(input);
  const lock = JSON.parse(fs.readFileSync(path.join(repository, 'package-lock.json'), 'utf8'));
  assert.deepEqual(manifest.tools.parserDependencies.map(dependency => dependency.package),
    parserPackages.map(([name]) => name));
  for (const [index, [name, resolver]] of parserPackages.entries()) {
    const packagePath = resolver.resolve(`${name}/package.json`);
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    const installPath = path.relative(repository, path.dirname(packagePath)).split(path.sep).join('/');
    const identity = manifest.tools.parserDependencies[index];
    assert.equal(identity.installPath, installPath);
    assert.equal(identity.version, pkg.version);
    assert.equal(identity.integrity, lock.packages[installPath].integrity);
    assert.match(identity.sourceTreeSha256, /^[a-f0-9]{64}$/);
    const entry = resolver.resolve(name);
    const read = fs.readFileSync;
    // Simulate changed installed bytes without modifying shared node_modules.
    fs.readFileSync = (filename, ...args) => {
      const original = read(filename, ...args);
      if (filename !== entry) return original;
      return typeof original === 'string' ? original + '\n// changed parser identity\n'
        : Buffer.concat([original, Buffer.from('\n// changed parser identity\n')]);
    };
    try { fails('STALE_TOOL', () => verifyCodegen(input)); }
    finally { fs.readFileSync = read; }
    assert.deepEqual(verifyCodegen(input), manifest);
  }
});

test('parser identities follow actual nested Codegen and Hermes resolution', t => {
  const directory = temporary(t);
  const scriptDirectory = path.join(directory, 'scripts');
  fs.mkdirSync(scriptDirectory);
  for (const name of ['codegen.mjs', 'codegen-contract.mjs']) {
    fs.copyFileSync(path.join(repository, 'scripts', name), path.join(scriptDirectory, name));
  }
  const lock = JSON.parse(fs.readFileSync(path.join(repository, 'package-lock.json'), 'utf8'));
  const install = (name, resolver, parent) => {
    const source = path.dirname(resolver.resolve(`${name}/package.json`));
    const destination = path.join(parent, 'node_modules', name);
    fs.cpSync(source, destination, {recursive: true});
    const sourcePath = path.relative(repository, source).split(path.sep).join('/');
    const installPath = path.relative(directory, destination).split(path.sep).join('/');
    lock.packages[installPath] = lock.packages[sourcePath];
    return {destination, installPath};
  };
  const codegen = install('@react-native/codegen', require, directory);
  const babel = install('@babel/parser', typescriptRequire, codegen.destination);
  const hermes = install('hermes-parser', flowRequire, codegen.destination);
  const estree = install('hermes-estree', hermesRequire, hermes.destination);
  // Standard nested npm installs may contain .bin links. These are dependency
  // installation metadata, not files belonging to Codegen's own source tree.
  const bin = path.join(codegen.destination, 'node_modules', '.bin');
  fs.mkdirSync(bin);
  fs.symlinkSync(path.join(babel.destination, 'bin', 'babel-parser.js'), path.join(bin, 'babel-parser'));
  fs.writeFileSync(path.join(directory, 'package-lock.json'), JSON.stringify(lock));
  const output = path.join(directory, 'generated');
  const flags = ['--root', fixtures, '--library', 'NestedFlow', '--native-combination',
    path.join(fixtures, 'native-combination.json'), '--out', output, '--spec', 'NativeFlowProbe.js'];
  // Other unchanged Codegen helpers can resolve from the real installation;
  // the three parsers under test must select the nearer nested packages.
  const env = {...process.env, NODE_PATH: path.join(repository, 'node_modules')};
  const run = command => spawnSync(process.execPath,
    [path.join(scriptDirectory, 'codegen.mjs'), command, ...flags], {encoding: 'utf8', env,
      timeout: 30000, maxBuffer: 1024 * 1024});
  const generated = run('generate');
  assert.equal(generated.status, 0, generated.stderr);
  assert.equal(JSON.parse(generated.stdout).artifacts, 1);
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.tools.parserDependencies.map(dependency => dependency.installPath),
    [babel.installPath, hermes.installPath, estree.installPath]);
  assert.equal(run('verify').status, 0);
});

test('changed spec bytes and changed source sets cannot validate old artifacts', t => {
  const directory = temporary(t);
  const source = path.join(directory, 'specs');
  fs.cpSync(fixtures, source, {recursive: true});
  const input = options(directory, {root: source});
  generateCodegen(input);
  fs.appendFileSync(path.join(source, specs[0]), '\n// Edited after generation.\n');
  fails('STALE_SOURCE', () => verifyCodegen(input));
  fails('STALE_SOURCE', () => verifyCodegen({...input, root: fixtures, specs: [specs[0]]}));
});

test('changed derived schema, unsupported fields and unsupported annotations are explicit failures', t => {
  const directory = temporary(t);
  const input = options(directory);
  generateCodegen(input);
  const schemaPath = path.join(input.out, 'schema.json');
  const original = fs.readFileSync(schemaPath, 'utf8');
  const schema = JSON.parse(original);
  schema.modules.CodegenBadge.components.CodegenBadge.props[0].typeAnnotation.default = 'stale';
  fs.writeFileSync(schemaPath, JSON.stringify(schema));
  fails('STALE_SCHEMA', () => verifyCodegen(input));
  schema.modules.CodegenBadge.components.CodegenBadge.props[0].unexpectedHostHint = true;
  fs.writeFileSync(schemaPath, JSON.stringify(schema));
  fails('UNSUPPORTED_SCHEMA', () => verifyCodegen(input), /unexpectedHostHint/);
  delete schema.modules.CodegenBadge.components.CodegenBadge.props[0].unexpectedHostHint;
  schema.modules.CodegenBadge.components.CodegenBadge.props[0].typeAnnotation.type = 'GodotWidgetType';
  fails('UNSUPPORTED_SCHEMA', () => validateSchema(schema), /GodotWidgetType/);
});

test('valid upstream ColorValue specs outside the profile do not silently lose fields', t => {
  const directory = temporary(t);
  const input = options(directory, {specs: ['UnsupportedBadgeNativeComponent.ts']});
  fails('UNSUPPORTED_SCHEMA', () => generateCodegen(input), /ReservedPropTypeAnnotation/);
  assert.equal(fs.existsSync(input.out), false);
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('duplicate paths, module keys, runtime names and member names are rejected before generation', t => {
  const directory = temporary(t);
  fails('NAME_COLLISION', () => prepareCodegen(options(directory, {specs: [specs[0], specs[0]]})));
  const source = path.join(directory, 'specs');
  fs.mkdirSync(source);
  fs.mkdirSync(path.join(source, 'copy'));
  fs.copyFileSync(path.join(fixtures, specs[0]), path.join(source, specs[0]));
  fs.copyFileSync(path.join(fixtures, specs[0]), path.join(source, 'copy', specs[0]));
  fails('NAME_COLLISION', () => prepareCodegen(options(directory, {root: source,
    specs: [specs[0], `copy/${specs[0]}`]})), /module key/);
  fs.writeFileSync(path.join(source, 'NativeOther.ts'), fs.readFileSync(path.join(fixtures, specs[0]), 'utf8'));
  fails('NAME_COLLISION', () => prepareCodegen(options(directory, {root: source,
    specs: [specs[0], 'NativeOther.ts']})), /CodegenProbe/);
  const {files} = prepareCodegen(options(directory));
  const schema = JSON.parse(files.get('schema.json'));
  schema.modules.CodegenBadge.components.CodegenBadge.props.push(clone(schema.modules.CodegenBadge.components.CodegenBadge.props[0]));
  fails('NAME_COLLISION', () => validateSchema(schema), /caption/);
  const cross = JSON.parse(files.get('schema.json'));
  cross.modules.NativeCodegenProbe.moduleName = 'CodegenBadge';
  fails('NAME_COLLISION', () => validateSchema(cross), /CodegenBadge/);
});

test('every declared native combination dimension participates in mismatch detection', t => {
  const directory = temporary(t);
  const input = options(directory);
  generateCodegen(input);
  const edits = [
    value => { value.sdkRevision = 'another-sdk'; },
    value => { value.sdkHeadersSha256 = 'a'.repeat(64); },
    value => { value.reactNativeHeadersSha256 = 'b'.repeat(64); },
    value => { value.hermesRuntimeSha256 = 'c'.repeat(64); },
    value => { value.hermesVersion = 'another-hermes'; },
    value => { value.godotCppRevision = 'another-godot-cpp'; },
    value => { value.godotVersion = '4.7.3'; },
    value => { value.target.architecture = 'arm64'; },
    value => { value.target.platform = 'ios-device'; },
    value => { value.target.configuration = 'Debug'; },
    value => { value.target.minimumOS = '16.0'; },
    value => { value.toolchain.version = 'another-compiler'; },
    value => { value.nativeDependencies[0].sha256 = 'd'.repeat(64); },
  ];
  for (const edit of edits) {
    const value = clone(combination);
    edit(value);
    fails('NATIVE_COMBINATION_MISMATCH', () => verifyCodegen({...input, nativeCombination: value}));
  }
  const incompatible = clone(combination);
  incompatible.reactNativeVersion = '0.88.0';
  fails('NATIVE_COMBINATION_MISMATCH', () => generateCodegen({...input,
    out: path.join(directory, 'incompatible'), nativeCombination: incompatible}));
  assert.equal(fs.existsSync(path.join(directory, 'incompatible')), false);
  const invalid = clone(combination);
  invalid.sdkHeadersSha256 = 'not-a-hash';
  fails('NATIVE_COMBINATION_INVALID', () => prepareCodegen({...input, nativeCombination: invalid}));
});

test('original generated event symbols, wire conventions and implicit command names are guarded', t => {
  const directory = temporary(t);
  const source = path.join(directory, 'specs');
  fs.mkdirSync(source);
  const original = fs.readFileSync(path.join(fixtures, specs[1]), 'utf8');
  const cases = [
    ['UNSUPPORTED_SCHEMA', original.replace('onActivate?:', 'topActivate?:'), /on \+ uppercase/],
    ['UNSUPPORTED_SCHEMA', original.replace('onActivate?:', 'OnActivate?:'), /on \+ uppercase/],
    ['NAME_COLLISION', original.replace('type ActivateEvent = Readonly<{count: Int32; label: string}>;',
      'type ActivateEvent = Readonly<{aB: Readonly<{first: string}>; a: Readonly<{b: Readonly<{second: string}>}>}>;'), /OnActivateAB/],
    ['UNSUPPORTED_SCHEMA', original.replace('caption?:', 'class?:'), /reserved/],
    ['UNSUPPORTED_SCHEMA', original.replace('caption?:', '__proto__?:'), /reserved/],
    ['NAME_COLLISION', original.replace("'CodegenBadge'", "'View'"), /ViewProps/],
    ['NAME_COLLISION', original.replace("'CodegenBadge'", "'Concrete'"), /ConcreteState/],
    ['UNSUPPORTED_SCHEMA', original.replace('viewRef: React.ElementRef<HostComponent<NativeProps>>',
      'viewRef: React.ElementRef<HostComponent<NativeProps>>, ref: Int32'), /implicit command receiver/],
  ];
  for (const [code, contents, match] of cases) {
    fs.writeFileSync(path.join(source, specs[1]), contents);
    fails(code, () => generateCodegen(options(directory, {root: source, specs: [specs[1]]})), match);
    assert.equal(fs.existsSync(path.join(directory, 'generated')), false);
  }
  const module = fs.readFileSync(path.join(fixtures, specs[0]), 'utf8')
    .replace('readonly onResult: EventEmitter<ProbeResult>;',
      'readonly onResult: EventEmitter<ProbeResult>; readonly OnResult: EventEmitter<ProbeResult>;');
  fs.writeFileSync(path.join(source, specs[0]), module);
  fails('NAME_COLLISION', () => prepareCodegen(options(directory, {root: source, specs: [specs[0]]})), /emitOnResult/);
});

test('original aliases cannot emit duplicate C++ struct/bridging symbols across modules', t => {
  const directory = temporary(t);
  const makeModule = (alias, runtimeName) => `
import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';
type ${alias} = Readonly<{value: string}>;
export interface Spec extends TurboModule { echo(value: ${alias}): ${alias}; }
export default TurboModuleRegistry.getEnforcing<Spec>('${runtimeName}');
`;
  fs.writeFileSync(path.join(directory, 'NativeA.ts'), makeModule('BC', 'ModuleA'));
  fs.writeFileSync(path.join(directory, 'NativeAB.ts'), makeModule('C', 'ModuleAB'));
  fails('NAME_COLLISION', () => generateCodegen(options(directory, {root: directory,
    specs: ['NativeA.ts', 'NativeAB.ts']})), /NativeABC/);
  fs.writeFileSync(path.join(directory, 'NativeA.ts'), makeModule('BC', 'ModuleA')
    .replace('type BC =', 'type BCBridging = Readonly<{other: string}>; type BC =')
    .replace('echo(value: BC): BC;', 'echo(value: BC): BC; another(value: BCBridging): BCBridging;'));
  fails('NAME_COLLISION', () => prepareCodegen(options(directory, {root: directory,
    specs: ['NativeA.ts']})), /NativeABCBridging/);
});

test('case-folded ViewConfig paths are rejected before writing on every platform', t => {
  const directory = temporary(t);
  fs.copyFileSync(path.join(fixtures, specs[1]), path.join(directory, specs[1]));
  fs.writeFileSync(path.join(directory, 'LowerBadgeNativeComponent.ts'),
    fs.readFileSync(path.join(fixtures, specs[1]), 'utf8').replace("'CodegenBadge'", "'codegenBadge'"));
  const input = options(directory, {root: directory, specs: [specs[1], 'LowerBadgeNativeComponent.ts']});
  fails('NAME_COLLISION', () => generateCodegen(input), /portable artifact path/);
  assert.equal(fs.existsSync(input.out), false);
});

test('string defaults which original CppHelpers cannot emit faithfully are diagnosed', t => {
  const directory = temporary(t);
  const original = fs.readFileSync(path.join(fixtures, specs[1]), 'utf8');
  for (const value of ['double"quote', 'back\\slash', 'line\nbreak', 'nul\u0000', '\ud800']) {
    fs.writeFileSync(path.join(directory, specs[1]), original.replace("WithDefault<string, ''>",
      'WithDefault<string, ' + JSON.stringify(value) + '>'));
    const input = options(directory, {root: directory, specs: [specs[1]]});
    fails('UNSUPPORTED_SCHEMA', () => generateCodegen(input), /unescaped C\+\+ string generator/);
    assert.equal(fs.existsSync(input.out), false);
  }
});

test('valid UTF-8 source bytes are required and generated bytes cannot be replaced by decoding equivalents', t => {
  const directory = temporary(t);
  fs.writeFileSync(path.join(directory, 'NativeBroken.ts'), Buffer.from([0xff]));
  fails('INVALID_SPEC', () => prepareCodegen(options(directory, {root: directory,
    specs: ['NativeBroken.ts']})), /valid UTF-8/);
  const native = clone(combination);
  native.sdkRevision = 'valid-\uFFFD';
  const input = options(directory, {nativeCombination: native});
  generateCodegen(input);
  const filename = path.join(input.out, 'manifest.json');
  const bytes = fs.readFileSync(filename);
  const offset = bytes.indexOf(Buffer.from('\uFFFD'));
  assert.ok(offset >= 0);
  fs.writeFileSync(filename, Buffer.concat([bytes.subarray(0, offset), Buffer.from([0xff]), bytes.subarray(offset + 3)]));
  fails('STALE_ARTIFACT', () => verifyCodegen(input), /bytes/);
});

test('a concurrent output reservation survives intact and failed publication leaves no generated directory', t => {
  const directory = temporary(t);
  const input = options(directory);
  const mkdir = fs.mkdirSync;
  let injected = false;
  fs.mkdirSync = (filename, ...args) => {
    if (filename === input.out && !injected) {
      injected = true;
      mkdir(filename);
      fs.writeFileSync(path.join(filename, 'concurrent.txt'), 'other producer');
    }
    return mkdir(filename, ...args);
  };
  try { fails('OUTPUT_EXISTS', () => generateCodegen(input)); }
  finally { fs.mkdirSync = mkdir; }
  assert.equal(injected, true);
  assert.equal(fs.readFileSync(path.join(input.out, 'concurrent.txt'), 'utf8'), 'other producer');
  assert.deepEqual(fs.readdirSync(directory), ['generated']);
  const failed = options(directory, {out: path.join(directory, 'failed')});
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (to === path.join(failed.out, 'cpp')) throw new Error('injected publish failure');
    return rename(from, to);
  };
  try { assert.throws(() => generateCodegen(failed), /injected publish failure/); }
  finally { fs.renameSync = rename; }
  assert.equal(fs.existsSync(failed.out), false);
  assert.deepEqual(fs.readdirSync(directory), ['generated']);
});

test('tool/wrapper provenance and false runtime claims cannot be changed in a manifest', t => {
  const directory = temporary(t);
  const input = options(directory);
  const manifest = generateCodegen(input);
  const filename = path.join(input.out, 'manifest.json');
  const edited = clone(manifest);
  edited.tools.sourceTreeSha256 = 'f'.repeat(64);
  fs.writeFileSync(filename, JSON.stringify(edited));
  fails('STALE_TOOL', () => verifyCodegen(input));
  for (const index of manifest.tools.parserDependencies.keys()) {
    for (const field of ['version', 'integrity', 'sourceTreeSha256']) {
      const changed = clone(manifest);
      changed.tools.parserDependencies[index][field] = 'changed parser identity';
      fs.writeFileSync(filename, JSON.stringify(changed));
      fails('STALE_TOOL', () => verifyCodegen(input));
    }
  }
  edited.tools = manifest.tools;
  edited.claims.runtimeExecuted = true;
  fs.writeFileSync(filename, JSON.stringify(edited));
  fails('STALE_MANIFEST', () => verifyCodegen(input));
});

test('modified, missing, extra and symlinked artifacts fail verification without rewriting', t => {
  const directory = temporary(t);
  const input = options(directory);
  const manifest = generateCodegen(input);
  const filename = path.join(input.out, manifest.artifacts[0].path);
  const original = fs.readFileSync(filename);
  fs.writeFileSync(filename, 'changed generated artifact\n');
  fails('STALE_ARTIFACT', () => verifyCodegen(input));
  assert.equal(fs.readFileSync(filename, 'utf8'), 'changed generated artifact\n');
  fs.writeFileSync(filename, original);
  fs.writeFileSync(path.join(input.out, 'unexpected.txt'), 'extra');
  fails('STALE_ARTIFACT', () => verifyCodegen(input));
  fs.rmSync(path.join(input.out, 'unexpected.txt'));
  fs.rmSync(filename);
  fails('STALE_ARTIFACT', () => verifyCodegen(input));
  fs.symlinkSync(path.join(fixtures, specs[0]), filename);
  fails('UNSAFE_PATH', () => verifyCodegen(input));
});

test('generation preserves existing outputs and rejects source traversal and empty specs', t => {
  const directory = temporary(t);
  const input = options(directory);
  fs.mkdirSync(input.out);
  fs.writeFileSync(path.join(input.out, 'user.txt'), 'preserve me');
  fails('OUTPUT_EXISTS', () => generateCodegen(input));
  assert.equal(fs.readFileSync(path.join(input.out, 'user.txt'), 'utf8'), 'preserve me');
  fails('UNSAFE_PATH', () => prepareCodegen({...input, specs: ['../godot-fabric.test.mjs']}));
  fails('INVALID_ARGUMENT', () => prepareCodegen({...input, specs: []}));
  const source = path.join(directory, 'Empty.ts');
  fs.writeFileSync(source, 'export const value = 1;\n');
  fails('EMPTY_SCHEMA', () => prepareCodegen({...input, root: directory, specs: ['Empty.ts']}));
});

test('public CLI generates/verifies and reports nonzero failures', t => {
  const directory = temporary(t);
  const output = path.join(directory, 'cli');
  const flags = ['--root', fixtures, '--library', 'CodegenFixture', '--native-combination',
    path.join(fixtures, 'native-combination.json'), '--out', output, ...specs.flatMap(spec => ['--spec', spec])];
  const run = (command, args = flags) => spawnSync(process.execPath,
    [path.join(repository, 'scripts/codegen.mjs'), command, ...args], {encoding: 'utf8'});
  const generated = run('generate');
  assert.equal(generated.status, 0, generated.stderr);
  assert.equal(JSON.parse(generated.stdout).artifacts, 12);
  assert.equal(run('verify').status, 0);
  const again = run('generate');
  assert.equal(again.status, 1);
  assert.match(again.stderr, /OUTPUT_EXISTS/);
  const invalid = run('generate', ['--unknown', 'value']);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /INVALID_ARGUMENT/);
});
