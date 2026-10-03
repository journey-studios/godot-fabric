import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {ADAPTER_ENTRY_POINT, ADAPTER_FORMAT, AdapterManifestError, normalizeComponentName,
  preflightAdapters} from '../scripts/adapter-manifest.mjs';
import {generateCodegen} from '../scripts/codegen.mjs';

const fixtures = fileURLToPath(new URL('./codegen/', import.meta.url));
const combination = JSON.parse(fs.readFileSync(path.join(fixtures, 'native-combination.json'), 'utf8'));
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'godot-fabric-adapter-test-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  return directory;
}

function fixture(t, {id = 'AdapterA', component = `${id}Badge`, module = `${id}Probe`,
  dependsOn = [], flow = false} = {}) {
  const root = temporary(t), specs = [];
  if (component) {
    const filename = `${component}NativeComponent.ts`;
    fs.writeFileSync(path.join(root, filename), fs.readFileSync(path.join(fixtures, 'BadgeNativeComponent.ts'), 'utf8')
      .replaceAll('CodegenBadge', component));
    specs.push(filename);
  }
  if (module) {
    const filename = `Native${module}.${flow ? 'js' : 'ts'}`;
    fs.writeFileSync(path.join(root, filename), fs.readFileSync(path.join(fixtures,
      flow ? 'NativeFlowProbe.js' : 'NativeCodegenProbe.ts'), 'utf8')
      .replaceAll(flow ? 'FlowProbe' : 'CodegenProbe', module));
    specs.push(filename);
  }
  const out = path.join(root, 'generated');
  generateCodegen({root, specs, libraryName: `${id}Generated`, nativeCombination: combination, out});
  fs.mkdirSync(path.join(root, 'bin'));
  // These intentionally are not a native binary: a preflight must not imply
  // successful dlopen, binary ABI, compilation or execution from a hash match.
  fs.writeFileSync(path.join(root, 'bin', 'fixture.library'), `opaque bytes for ${id}`);
  const manifest = {format: ADAPTER_FORMAT, id, entryPoint: ADAPTER_ENTRY_POINT,
    library: {path: 'bin/fixture.library', sha256: digest(fs.readFileSync(path.join(root, 'bin', 'fixture.library')))},
    nativeCombination: structuredClone(combination),
    codegenManifest: {path: 'generated/manifest.json', sha256: digest(fs.readFileSync(path.join(out, 'manifest.json')))},
    components: component ? [component] : [], modules: module ? [module] : [], dependsOn};
  const write = () => fs.writeFileSync(path.join(root, 'adapter.json'), json(manifest));
  const editCodegen = action => {
    const filename = path.join(out, 'manifest.json');
    const recorded = JSON.parse(fs.readFileSync(filename, 'utf8'));
    action(recorded);
    fs.writeFileSync(filename, json(recorded));
    manifest.codegenManifest.sha256 = digest(fs.readFileSync(filename));
    write();
  };
  write();
  return {root, out, manifest, write, editCodegen, input: {packageRoot: root}};
}

const run = (packages, options = {}) => preflightAdapters({adapters: packages.map(pkg => pkg.input),
  nativeCombination: combination, ...options});
const rejects = (code, operation, cause) => assert.rejects(operation, error => error instanceof AdapterManifestError
  && error.code === code && (!cause || error.cause?.code === cause));

function fileSnapshot(root) {
  const visit = (directory, relative = '') => fs.readdirSync(directory).sort().flatMap(name => {
    const item = path.join(directory, name), key = path.join(relative, name);
    return fs.statSync(item).isDirectory() ? visit(item, key) : [[key, digest(fs.readFileSync(item))]];
  });
  return visit(root);
}

test('independent package validates original source/schema/artifacts without tools or dependencies in that package', async t => {
  const pkg = fixture(t), before = fileSnapshot(pkg.root);
  const input = structuredClone(pkg.manifest);
  const [result] = await run([pkg]);
  assert.equal(result.manifest.id, 'AdapterA');
  assert.equal(result.packageRoot, fs.realpathSync(pkg.root));
  assert.equal(result.libraryPath, fs.realpathSync(path.join(pkg.root, pkg.manifest.library.path)));
  assert.equal(result.codegenManifestPath, fs.realpathSync(path.join(pkg.out, 'manifest.json')));
  assert.equal(result.codegenManifest.sources.length, 2);
  assert.equal(result.codegenManifest.artifacts.length, 12);
  assert.deepEqual(result.validation, {codegenProvenanceVerified: true, libraryHashVerified: true,
    nativeLoaded: false, runtimeExecuted: false, abiCertified: false});
  assert.deepEqual(result.codegenManifest.claims, {nativeCompiled: false, nativeLoaded: false,
    runtimeExecuted: false, abiCertified: false});
  assert.deepEqual(fileSnapshot(pkg.root), before, 'preflight must not mutate the package');
  assert.deepEqual(pkg.manifest, input, 'preflight must not mutate caller inputs');
  assert.equal(fs.existsSync(path.join(pkg.root, 'node_modules')), false);
  assert.equal(fs.existsSync(path.join(pkg.root, 'package.json')), false);
});

test('dependency order is stable regardless of input order, with component-only and module-only adapters', async t => {
  const base = fixture(t, {id: 'Base', module: null});
  const leaf = fixture(t, {id: 'Leaf', component: null, dependsOn: ['Base']});
  assert.deepEqual((await run([leaf, base])).map(record => record.manifest.id), ['Base', 'Leaf']);
  assert.deepEqual((await run([base, leaf])).map(record => record.manifest.id), ['Base', 'Leaf']);
  assert.deepEqual(await run([]), []);
});

test('packaged Flow specs use original Hermes derivation and keep native claims false', async t => {
  const pkg = fixture(t, {id: 'FlowAdapter', component: null, flow: true});
  const [result] = await run([pkg]);
  assert.deepEqual(result.codegenManifest.sources.map(source => source.path), ['NativeFlowAdapterProbe.js']);
  assert.equal(result.codegenManifest.artifacts.length, 1);
  assert.equal(result.codegenManifest.tools.parserDependencies[1].package, 'hermes-parser');
  assert.equal(result.validation.abiCertified, false);
});

test('envelope requires exact top-level and file-reference keys plus explicit identity/entry point', async t => {
  const pkg = fixture(t), original = structuredClone(pkg.manifest);
  const cases = [m => { m.extra = true; }, m => { delete m.dependsOn; }, m => { m.id = 'bad-id'; },
    m => { m.entryPoint = 'other_entry'; }, m => { m.format = 'adapter/v2'; },
    m => { m.library.optional = false; }, m => { delete m.codegenManifest.sha256; },
    m => { m.library.sha256 = 'ABC'; }, m => { m.modules = 'Module'; },
    m => { m.components = []; m.modules = []; }];
  for (const edit of cases) {
    Object.keys(pkg.manifest).forEach(key => { delete pkg.manifest[key]; });
    Object.assign(pkg.manifest, structuredClone(original));
    edit(pkg.manifest); pkg.write();
    await rejects('ADAPTER_MANIFEST_INVALID', () => run([pkg]));
  }
});

test('invalid JSON and UTF-8 cannot supply an adapter manifest', async t => {
  const pkg = fixture(t);
  fs.writeFileSync(path.join(pkg.root, 'adapter.json'), '{');
  await rejects('ADAPTER_MANIFEST_INVALID', () => run([pkg]));
  fs.writeFileSync(path.join(pkg.root, 'adapter.json'), Buffer.from([0xff]));
  await rejects('ADAPTER_MANIFEST_INVALID', () => run([pkg]));
});

test('absolute, traversal, Windows/URL, NUL and ambiguous paths are rejected before file lookup', async t => {
  const pkg = fixture(t), original = pkg.manifest.library.path;
  for (const bad of ['/etc/passwd', '../library', 'a/../library', 'a/./library', './library',
    'a//library', 'a/', 'C:/library', 'https://example.com/library', 'bin\\library', 'bin/\0library']) {
    pkg.manifest.library.path = bad; pkg.write();
    await rejects('ADAPTER_UNSAFE_PATH', () => run([pkg]));
  }
  pkg.manifest.library.path = original; pkg.write();
  await rejects('ADAPTER_UNSAFE_PATH', () => run([pkg], {adapters: [{packageRoot: pkg.root, manifestPath: '../adapter.json'}]}));
});

test('missing files and directory-valued libraries fail before the native loader', async t => {
  const pkg = fixture(t);
  pkg.manifest.library.path = 'bin/missing'; pkg.write();
  await rejects('ADAPTER_FILE_MISSING', () => run([pkg]));
  pkg.manifest.library.path = 'bin'; pkg.write();
  await rejects('ADAPTER_UNSAFE_PATH', () => run([pkg]));
});

test('library links may resolve inside the package but never outside, including ancestor links', async t => {
  const pkg = fixture(t), outside = temporary(t);
  fs.writeFileSync(path.join(outside, 'foreign.library'), 'foreign');
  fs.symlinkSync(path.join(pkg.root, pkg.manifest.library.path), path.join(pkg.root, 'inside.library'));
  pkg.manifest.library.path = 'inside.library'; pkg.write();
  assert.equal((await run([pkg]))[0].libraryPath, fs.realpathSync(path.join(pkg.root, 'bin/fixture.library')));
  fs.symlinkSync(path.join(outside, 'foreign.library'), path.join(pkg.root, 'outside.library'));
  pkg.manifest.library.path = 'outside.library'; pkg.write();
  await rejects('ADAPTER_UNSAFE_PATH', () => run([pkg]));
  fs.symlinkSync(outside, path.join(pkg.root, 'foreign'));
  pkg.manifest.library.path = 'foreign/foreign.library'; pkg.write();
  await rejects('ADAPTER_UNSAFE_PATH', () => run([pkg]));
});

test('library and generated-manifest hash mismatches fail independently', async t => {
  const pkg = fixture(t);
  fs.appendFileSync(path.join(pkg.root, pkg.manifest.library.path), 'modified');
  await rejects('ADAPTER_HASH_MISMATCH', () => run([pkg]));
  pkg.manifest.library.sha256 = digest(fs.readFileSync(path.join(pkg.root, pkg.manifest.library.path))); pkg.write();
  fs.appendFileSync(path.join(pkg.out, 'manifest.json'), '\n');
  await rejects('ADAPTER_HASH_MISMATCH', () => run([pkg]));
});

test('current target, SDK/headers, dependency bytes and generated combination cannot be selected by the adapter', async t => {
  const pkg = fixture(t);
  for (const change of [c => { c.target.architecture = 'arm64'; }, c => { c.sdkRevision = 'stale'; },
    c => { c.sdkHeadersSha256 = '4'.repeat(64); }, c => { c.nativeDependencies[0].sha256 = '5'.repeat(64); }]) {
    const actual = structuredClone(combination); change(actual);
    await rejects('ADAPTER_COMBINATION_MISMATCH', () => run([pkg], {nativeCombination: actual}));
  }
  await rejects('ADAPTER_COMBINATION_INVALID', () => run([pkg], {nativeCombination: {...combination, undocumented: true}}));
  pkg.editCodegen(m => { m.nativeCombination.declaration.target.architecture = 'arm64'; });
  await rejects('ADAPTER_COMBINATION_MISMATCH', () => run([pkg]));
});

test('normalized component aliases exactly follow pinned RN without inventing generic Fabric-prefix stripping', () => {
  for (const [name, expected] of [['RCTText', 'Paragraph'], ['VirtualText', 'Text'], ['RCTVirtualText', 'Text'],
    ['RCTImageView', 'Image'], ['AndroidHorizontalScrollView', 'ScrollView'], ['RefreshControl', 'PullToRefreshView'],
    ['ScrollContentView', 'View'], ['SinglelineTextInputView', 'TextInput'], ['MultilineTextInputView', 'TextInput'],
    ['RCTSelectableText', 'SelectableParagraph'], ['RKShimmeringView', 'ShimmeringView'],
    ['RCTBadge', 'Badge'], ['RCTRCTBadge', 'RCTBadge'], ['FabricBadge', 'FabricBadge']]) {
    assert.equal(normalizeComponentName(name), expected);
  }
});

test('adapter IDs, public declarations and normalized component names cannot collide', async t => {
  const first = fixture(t, {id: 'First', component: 'SharedBadge'});
  const second = fixture(t, {id: 'Second', component: 'RCTSharedBadge'});
  await rejects('ADAPTER_NAME_COLLISION', () => run([first, second]));
  second.manifest.components = ['SecondBadge']; second.manifest.id = 'First'; second.write();
  await rejects('ADAPTER_NAME_COLLISION', () => run([first, second]));
  first.manifest.modules = [first.manifest.components[0]]; first.write();
  await rejects('ADAPTER_NAME_COLLISION', () => run([first]));
  first.manifest.modules = ['Module', 'Module']; first.write();
  await rejects('ADAPTER_NAME_COLLISION', () => run([first]));
});

test('the first SPI rejects alias provider declarations before reading libraries, while canonical declarations remain valid', async t => {
  const pkg = fixture(t, {component: 'RCTCustomBadge'});
  fs.unlinkSync(path.join(pkg.root, pkg.manifest.library.path));
  await rejects('ADAPTER_COMPONENT_NAME_UNSUPPORTED', () => run([pkg]));
  const canonical = fixture(t, {id: 'Canonical', component: 'CustomBadge'});
  const [result] = await run([canonical]);
  assert.deepEqual(result.manifest.components, ['CustomBadge']);
  assert.equal(normalizeComponentName('RCTCustomBadge'), result.manifest.components[0]);
});

test('core reservations include aliases and missing RN ports; caller may add but cannot remove reservations', async t => {
  const pkg = fixture(t, {component: 'RCTImageView'});
  await rejects('ADAPTER_NAME_COLLISION', () => run([pkg]));
  const custom = fixture(t, {id: 'Custom'});
  for (const name of ['Button', 'Pressable', 'ActivityIndicator', 'Modal']) {
    custom.manifest.components = [name]; custom.write();
    await rejects('ADAPTER_NAME_COLLISION', () => run([custom]));
  }
  custom.manifest.components = ['CustomBadge']; custom.write();
  for (const name of ['GodotFabricServices', 'NativeDOMCxx', 'Networking', 'SourceCode']) {
    custom.manifest.modules = [name]; custom.write();
    await rejects('ADAPTER_NAME_COLLISION', () => run([custom]));
  }
  custom.manifest.modules = ['CustomProbe']; custom.write();
  await rejects('ADAPTER_NAME_COLLISION', () => run([custom], {reservedComponents: ['RCTCustomBadge']}));
  await rejects('ADAPTER_NAME_COLLISION', () => run([custom], {reservedModules: ['CustomProbe']}));
});

test('missing dependencies and cycles fail for the complete set before provenance checks', async t => {
  const first = fixture(t, {id: 'First', dependsOn: ['Missing']});
  await rejects('ADAPTER_DEPENDENCY_MISSING', () => run([first]));
  first.manifest.dependsOn = ['First']; first.write();
  await rejects('ADAPTER_DEPENDENCY_CYCLE', () => run([first]));
  const second = fixture(t, {id: 'Second', dependsOn: ['First']});
  first.manifest.dependsOn = ['Second']; first.write();
  await rejects('ADAPTER_DEPENDENCY_CYCLE', () => run([first, second]));
});

test('an envelope cannot rename, omit or invent schema declarations even with correct hashes', async t => {
  const pkg = fixture(t);
  for (const update of [() => { pkg.manifest.components = ['Invented']; },
    () => { pkg.manifest.components = ['AdapterABadge']; pkg.manifest.modules = []; },
    () => { pkg.manifest.modules = ['AnotherModule']; }]) {
    update(); pkg.write();
    await rejects('ADAPTER_SCHEMA_NAMES', () => run([pkg]));
  }
});

test('original schema profile and false native/runtime/ABI claims remain mandatory', async t => {
  const pkg = fixture(t), original = fs.readFileSync(path.join(pkg.out, 'manifest.json'));
  for (const claim of ['nativeCompiled', 'nativeLoaded', 'runtimeExecuted', 'abiCertified']) {
    fs.writeFileSync(path.join(pkg.out, 'manifest.json'), original);
    pkg.editCodegen(m => { m.claims[claim] = true; });
    await rejects('ADAPTER_CODEGEN_CLAIM', () => run([pkg]));
  }
  fs.writeFileSync(path.join(pkg.out, 'manifest.json'), original);
  pkg.editCodegen(m => { m.schemaProfile = 'future-profile'; });
  await rejects('ADAPTER_CODEGEN_PROFILE', () => run([pkg]));
});

test('changed specs/schema/artifacts and a changed generated file set are not valid provenance', async t => {
  const pkg = fixture(t);
  const manifest = JSON.parse(fs.readFileSync(path.join(pkg.out, 'manifest.json'), 'utf8'));
  const source = path.join(pkg.root, manifest.sources[0].path), before = fs.readFileSync(source);
  fs.writeFileSync(source, before.toString('utf8').replace('WithDefault<Int32, 0>', 'WithDefault<Int32, 5>'));
  await rejects('ADAPTER_HASH_MISMATCH', () => run([pkg]));
  pkg.editCodegen(m => { m.sources[0].sha256 = digest(fs.readFileSync(source)); });
  await rejects('ADAPTER_CODEGEN_PROVENANCE', () => run([pkg]), 'STALE_SCHEMA');
  // Updating the source hash cannot attest a schema derived from the old prop.
  fs.writeFileSync(source, before);
  pkg.editCodegen(m => { m.sources[0].sha256 = digest(before); });
  const artifact = path.join(pkg.out, manifest.artifacts[0].path);
  const originalArtifact = fs.readFileSync(artifact);
  fs.appendFileSync(artifact, '// changed\n');
  await rejects('ADAPTER_HASH_MISMATCH', () => run([pkg]));
  fs.writeFileSync(artifact, originalArtifact);
  fs.writeFileSync(path.join(pkg.out, 'unexpected.txt'), 'extra');
  await rejects('ADAPTER_CODEGEN_PROVENANCE', () => run([pkg]), 'STALE_ARTIFACT');
});

test('self-consistent artifact hashes cannot replace original generated bytes', async t => {
  const pkg = fixture(t);
  pkg.editCodegen(m => {
    const artifact = m.artifacts[0];
    const filename = path.join(pkg.out, artifact.path);
    fs.appendFileSync(filename, '// forged generator output\n');
    artifact.sha256 = digest(fs.readFileSync(filename));
  });
  await rejects('ADAPTER_CODEGEN_PROVENANCE', () => run([pkg]), 'STALE_MANIFEST');
});

test('Node, parser/package and SDK wrapper identities require the current SDK tools, without running package scripts', async t => {
  const pkg = fixture(t), original = fs.readFileSync(path.join(pkg.out, 'manifest.json'));
  const edits = [m => { m.tools.nodeVersion = 'v0.0.0'; },
    m => { m.tools.parserDependencies[0].sourceTreeSha256 = '8'.repeat(64); },
    m => { m.tools.wrapperSources[0].sha256 = '9'.repeat(64); }];
  const marker = path.join(pkg.root, 'PROJECT_TOOL_EXECUTED');
  fs.writeFileSync(path.join(pkg.root, 'package.json'), json({scripts: {prepare: `touch ${marker}`}}));
  for (const edit of edits) {
    fs.writeFileSync(path.join(pkg.out, 'manifest.json'), original);
    pkg.editCodegen(edit);
    await rejects('ADAPTER_CODEGEN_PROVENANCE', () => run([pkg]), 'STALE_TOOL');
    assert.equal(fs.existsSync(marker), false);
  }
});

test('missing SDK parser/Codegen dependencies have a bounded explicit diagnostic without project installation', t => {
  const root = temporary(t), scripts = path.join(root, 'scripts');
  fs.mkdirSync(scripts);
  for (const filename of ['adapter-manifest.mjs', 'codegen-contract.mjs', 'codegen.mjs']) {
    fs.copyFileSync(fileURLToPath(new URL(`../scripts/${filename}`, import.meta.url)), path.join(scripts, filename));
  }
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    'import {preflightAdapters} from "./scripts/adapter-manifest.mjs"; '
      + 'try { await preflightAdapters({adapters:[],nativeCombination:{}}); process.exitCode=1; } '
      + 'catch(error) { console.log(JSON.stringify({code:error.code,cause:error.cause?.code,message:error.message})); }'],
  {cwd: root, encoding: 'utf8', timeout: 10000, env: {...process.env, NODE_PATH: ''}});
  assert.equal(result.status, 0, result.stderr);
  const error = JSON.parse(result.stdout);
  assert.equal(error.code, 'ADAPTER_TOOL_UNAVAILABLE');
  assert.equal(error.cause, 'MODULE_NOT_FOUND');
  assert.match(error.message, /SDK.*Codegen\/profile\/parser dependencies/);
  assert.equal(fs.existsSync(path.join(root, 'node_modules')), false);
});

test('generated and source references cannot traverse or follow escaped symlinks before original verification', async t => {
  const pkg = fixture(t), outside = temporary(t);
  fs.writeFileSync(path.join(outside, 'foreign.ts'), 'foreign');
  fs.symlinkSync(path.join(outside, 'foreign.ts'), path.join(pkg.root, 'foreign.ts'));
  pkg.editCodegen(m => { m.sources[0].path = 'foreign.ts'; });
  await rejects('ADAPTER_UNSAFE_PATH', () => run([pkg]));
  pkg.editCodegen(m => { m.sources[0].path = '../foreign.ts'; });
  await rejects('ADAPTER_UNSAFE_PATH', () => run([pkg]));
  const clean = fixture(t, {id: 'Clean'});
  fs.symlinkSync(path.join(outside, 'foreign.ts'), path.join(clean.out, 'schema-link'));
  await rejects('ADAPTER_UNSAFE_PATH', () => run([clean]));
  fs.unlinkSync(path.join(clean.out, 'schema-link'));
  fs.symlinkSync(path.join(outside, 'does-not-exist'), path.join(clean.out, 'broken-link'));
  await rejects('ADAPTER_UNSAFE_PATH', () => run([clean]));
});
