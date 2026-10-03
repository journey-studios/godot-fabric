import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {captureBuildInputs, recordNativeBuild, packageNativeSdk, verifyNativeSdk,
  treeRecords} from '../scripts/native-sdk.mjs';
import {validateCombination} from '../scripts/codegen-contract.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function write(root, relative, content) {
  const filename = path.join(root, relative);
  fs.mkdirSync(path.dirname(filename), {recursive: true});
  fs.writeFileSync(filename, content);
  return filename;
}
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'godot-fabric-native-sdk-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const lock = JSON.parse(fs.readFileSync(path.join(repository, 'dependencies.json'), 'utf8'));
  write(root, 'dependencies.json', JSON.stringify(lock));
  write(root, 'scripts/native-sdk.mjs', fs.readFileSync(path.join(repository, 'scripts/native-sdk.mjs')));
  write(root, 'scripts/codegen-contract.mjs', fs.readFileSync(path.join(repository, 'scripts/codegen-contract.mjs')));
  write(root, 'native/CMakeLists.txt', 'fixture-not-a-build');
  write(root, 'native/adapter_registry.h', '#pragma once\n#include "turbo_module_registry.h"\n');
  write(root, 'native/adapter_loader.h', '#pragma once\n#include "adapter_registry.h"\n');
  write(root, 'native/turbo_module_registry.h', '#pragma once\n');
  write(root, 'native/adapter_registry.cpp', '// fixture only\n');
  write(root, 'native/godot-profile.json', '{"enabled_classes":["Control","Button"]}');
  const buildDir = path.join(root, '.deps/build');
  const compiler = write(root, '.deps/compiler', 'fixture-not-a-compiler');
  const sysroot = path.join(root, '.deps/SDK/MacOSX26.2.sdk');
  fs.mkdirSync(sysroot, {recursive: true});
  write(root, '.deps/build/CMakeCache.txt', [
    'CMAKE_GENERATOR:INTERNAL=Unix Makefiles',
    'CMAKE_BUILD_TYPE:STRING=Release', 'CMAKE_OSX_ARCHITECTURES:STRING=arm64',
    'GODOTCPP_SYMBOL_VISIBILITY:STRING=visible', 'CMAKE_HOME_DIRECTORY:INTERNAL=' + path.join(root, 'native'),
    'CMAKE_CXX_COMPILER:FILEPATH=' + compiler, '',
  ].join('\n'));
  const trees = [
    'native', '.deps/' + lock['react-native'].directory + '/ReactCommon',
    '.deps/' + lock['react-native'].directory + '/React/FBReactNativeSpec',
    '.deps/' + lock.hermes.directory + '/destroot/include',
    '.deps/' + lock['rn-dependencies'].directory + '/packages/react-native/third-party/ReactNativeDependenciesHeaders.xcframework/macos-arm64_x86_64/Headers',
    '.deps/' + lock['godot-cpp'].directory + '/include',
    '.deps/build/godot-cpp/gen/include', '.deps/' + lock['godot-cpp'].directory + '/gdextension',
  ];
  for (const tree of trees) write(root, tree + '/fixture.h', '#pragma once\n');
  write(root, trees[1] + '/ignore.cpp', '// do not publish native source\n');
  const flagsFile = write(root, '.deps/build/CMakeFiles/fabric_godot.dir/flags.make', [
    'CXX_DEFINES = -DGDEXTENSION -DMACOS_ENABLED -DFOLLY_MOBILE=1 -Dfabric_godot_EXPORTS',
    'CXX_INCLUDES = ' + trees.map(tree => '-I"' + path.join(root, tree) + '"').join(' ')
      + ' -I"' + path.join(root, '.deps/' + lock['react-native'].directory + '/ReactCommon/unused') + '"',
    'CXX_FLAGS = -O3 -DNDEBUG -std=gnu++20 -arch arm64 -isysroot "' + sysroot + '" -mmacosx-version-min=13.0 -fPIC', '',
  ].join('\n'));
  write(root, '.deps/build/CMakeFiles/fabric_core.dir/flags.make', 'fixture-core-flags');
  write(root, '.deps/build/godot-cpp/CMakeFiles/godot-cpp.dir/flags.make', 'fixture-godot-flags');
  write(root, trees[1] + '/original.cpp', '// fixture native upstream source');
  write(root, '.deps/' + lock['godot-cpp'].directory + '/src/godot.cpp', '// fixture native binding source');
  write(root, '.deps/build/godot-cpp/gen/src/classes/control.cpp', '// fixture generated binding source');
  const hermes = '.deps/' + lock.hermes.directory + '/destroot/Library/Frameworks/macosx/hermesvm.framework';
  const rn = '.deps/' + lock['rn-dependencies'].directory
    + '/packages/react-native/third-party/ReactNativeDependencies.xcframework/macos-arm64_x86_64/ReactNativeDependencies.framework';
  for (const [framework, binary] of [[hermes, 'hermesvm'], [rn, 'ReactNativeDependencies']]) {
    write(root, framework + '/Versions/A/' + binary, 'fixture-shared-binary-' + binary);
    fs.symlinkSync('A', path.join(root, framework, 'Versions/Current'));
    fs.symlinkSync('Versions/Current/' + binary, path.join(root, framework, binary));
  }
  for (const relative of ['LICENSE', '.deps/' + lock['react-native'].directory + '/LICENSE',
    '.deps/' + lock.hermes.directory + '/LICENSE', '.deps/' + lock['godot-cpp'].directory + '/LICENSE.md'])
    write(root, relative, 'fixture-license\n');
  write(root, 'THIRD_PARTY_NOTICES.md', 'fixture-notices\n');
  const host = write(root, 'addons/fabric_godot.dylib', 'fixture-not-a-linked-host');
  const options = {root, buildDir, host, fixture: true,
    probeCompiler: () => ({name: 'AppleClang', version: 'fixture-not-a-compiler-proof'})};
  return {root, lock, trees, flagsFile, options, out: path.join(root, 'build/sdk')};
}
function record(value) {
  captureBuildInputs(value.options);
  return recordNativeBuild(value.options);
}
function rejects(code, action) {
  assert.throws(action, error => error.code === code);
}

test('dry package has original combination shape, SPI headers and shared imported targets', t => {
  const value = fixture(t);
  record(value);
  const manifest = packageNativeSdk({...value.options, out: value.out});
  assert.deepEqual(verifyNativeSdk(value.out), manifest);
  const combination = validateCombination(JSON.parse(fs.readFileSync(path.join(value.out, 'native-combination.json'), 'utf8')));
  assert.equal(combination.purpose, 'test-fixture');
  assert.equal(combination.target.platform, 'macos');
  assert.equal(combination.target.architecture, 'arm64');
  assert.equal(combination.nativeDependencies.length, 3);
  assert.ok(fs.existsSync(path.join(value.out, 'include/sdk/adapter_registry.h')));
  assert.ok(fs.existsSync(path.join(value.out, 'include/sdk/turbo_module_registry.h')));
  assert.ok(fs.existsSync(path.join(value.out, 'lib/frameworks/hermesvm.framework/hermesvm')));
  assert.equal(fs.readlinkSync(path.join(value.out, 'lib/frameworks/hermesvm.framework/Versions/Current')), 'A');
  assert.ok(manifest.files.every(entry => !/\.(?:a|o|cpp)$/.test(entry.path)));
  const config = fs.readFileSync(path.join(value.out, 'cmake/GodotFabricNativeSDKConfig.cmake'), 'utf8');
  assert.match(config, /GodotFabric::Host SHARED IMPORTED/);
  assert.match(config, /INTERFACE_LINK_LIBRARIES "GodotFabric::Hermes;GodotFabric::RNDependencies"/);
  assert.match(config, /LINKER:-undefined,error/);
  assert.match(config, /BUILD_WITH_INSTALL_RPATH TRUE INSTALL_RPATH_USE_LINK_PATH FALSE/);
  assert.match(config, /HOST_RUNTIME_DIR/);
  assert.ok(!config.includes(value.root), 'CMake package must be relocatable');
  assert.ok(!config.includes('fabric_godot_EXPORTS'), 'adapter must not compile as host');
  assert.deepEqual([manifest.adapterLinked, manifest.runtimeExecuted, manifest.runtimeIdentityVerified,
    manifest.abiCertified], [false, false, false, false]);
  const receipt = JSON.parse(fs.readFileSync(path.join(value.out, 'receipt.json'), 'utf8'));
  assert.equal(receipt.nativeHostBuildRecorded, false, 'dry fixtures must never attest a native build');
});

test('unchanged capture preserves its mtime so an incremental build need not relink', t => {
  const value = fixture(t);
  const first = captureBuildInputs(value.options);
  const filename = path.join(value.options.buildDir, 'native-sdk-inputs.json');
  fs.utimesSync(filename, new Date(1000), new Date(1000));
  const before = fs.statSync(filename).mtimeMs;
  assert.deepEqual(captureBuildInputs(value.options), first);
  assert.equal(fs.statSync(filename).mtimeMs, before);
});

test('changed native source during compilation refuses the completed host receipt', t => {
  const value = fixture(t);
  captureBuildInputs(value.options);
  write(value.root, 'native/adapter_registry.cpp', '// changed during compile');
  rejects('SDK_BUILD_INPUTS_CHANGED', () => recordNativeBuild(value.options));
  assert.ok(!fs.existsSync(path.join(value.options.buildDir, 'native-sdk-build.json')));
});

test('changed consumed headers or build flags reject stale SDK publication', t => {
  for (const input of ['header', 'flags', 'rn-source', 'godot-source']) {
    const value = fixture(t);
    record(value);
    if (input === 'header') write(value.root, value.trees[1] + '/fixture.h', '#pragma once\n// changed');
    else if (input === 'flags') fs.appendFileSync(path.join(value.options.buildDir, 'CMakeFiles/fabric_core.dir/flags.make'), '\nchanged');
    else if (input === 'rn-source') write(value.root, value.trees[1] + '/original.cpp', '// changed original RN source');
    else write(value.root, '.deps/' + value.lock['godot-cpp'].directory + '/src/godot.cpp', '// changed global binding source');
    rejects('SDK_STALE_BUILD', () => packageNativeSdk({...value.options, out: value.out}));
    assert.ok(!fs.existsSync(value.out));
  }
});

test('changed binary rejects publication even with unchanged headers and source', t => {
  const value = fixture(t);
  record(value);
  fs.appendFileSync(value.options.host, 'changed-binary');
  rejects('SDK_STALE_BINARY', () => packageNativeSdk({...value.options, out: value.out}));
});

test('hidden bindings, other architecture and missing SPI are explicit failures', t => {
  for (const change of ['hidden', 'architecture', 'spi']) {
    const value = fixture(t);
    const cache = path.join(value.options.buildDir, 'CMakeCache.txt');
    if (change === 'hidden') fs.writeFileSync(cache, fs.readFileSync(cache, 'utf8').replace('=visible', '=hidden'));
    else if (change === 'architecture') fs.writeFileSync(cache, fs.readFileSync(cache, 'utf8').replace('=arm64', '=x86_64'));
    else fs.unlinkSync(path.join(value.root, 'native/adapter_registry.h'));
    rejects(change === 'spi' ? 'SDK_SPI_MISSING' : 'SDK_TARGET', () => captureBuildInputs(value.options));
  }
});

test('unsupported host generator gives an explicit SDK diagnostic', t => {
  const value = fixture(t);
  const cache = path.join(value.options.buildDir, 'CMakeCache.txt');
  fs.writeFileSync(cache, fs.readFileSync(cache, 'utf8').replace('=Unix Makefiles', '=Ninja'));
  rejects('SDK_GENERATOR', () => captureBuildInputs(value.options));
});

test('existing, dangling and outside output paths preserve user files', t => {
  const value = fixture(t);
  record(value);
  fs.mkdirSync(value.out, {recursive: true});
  write(value.root, 'build/sdk/user-file', 'preserve');
  rejects('SDK_OUTPUT_EXISTS', () => packageNativeSdk({...value.options, out: value.out}));
  assert.equal(fs.readFileSync(path.join(value.out, 'user-file'), 'utf8'), 'preserve');
  const dangling = path.join(value.root, 'build/dangling');
  fs.symlinkSync('absent', dangling);
  rejects('SDK_OUTPUT_EXISTS', () => packageNativeSdk({...value.options, out: dangling}));
  rejects('SDK_PATH', () => packageNativeSdk({...value.options, out: path.join(value.root, 'native/escape')}));
});

test('header symlink escaping the declared tree is rejected before capture', t => {
  const value = fixture(t);
  fs.symlinkSync(value.options.host, path.join(value.root, value.trees[1], 'escaped.h'));
  rejects('SDK_SYMLINK_ESCAPE', () => captureBuildInputs(value.options));
});

test('an untransmitted ABI compiler option is rejected instead of producing a combination', t => {
  const value = fixture(t);
  fs.appendFileSync(value.flagsFile, fs.readFileSync(value.flagsFile, 'utf8')
    .split('\n').find(line => line.startsWith('CXX_FLAGS =')) + ' -fpack-struct=1\n');
  rejects('SDK_FLAGS', () => captureBuildInputs(value.options));
});

test('output ancestor symlinks cannot redirect the package outside build/', t => {
  const value = fixture(t);
  record(value);
  fs.mkdirSync(path.join(value.root, 'build'));
  fs.symlinkSync(path.join(value.root, 'native'), path.join(value.root, 'build/redirect'));
  rejects('SDK_PATH', () => packageNativeSdk({...value.options, out: path.join(value.root, 'build/redirect/sdk')}));
  assert.ok(!fs.existsSync(path.join(value.root, 'native/sdk')));
});

test('verification catches changed, missing or extra SDK files', t => {
  for (const change of ['changed', 'missing', 'extra']) {
    const value = fixture(t);
    record(value);
    packageNativeSdk({...value.options, out: value.out});
    const filename = path.join(value.out, 'include/sdk/adapter_registry.h');
    if (change === 'changed') fs.appendFileSync(filename, '// altered');
    else if (change === 'missing') fs.unlinkSync(filename);
    else fs.writeFileSync(path.join(value.out, 'extra-file'), 'unrecorded');
    rejects('SDK_PACKAGE_STALE', () => verifyNativeSdk(value.out));
  }
});

test('verification rejects execution claims added to a build-only manifest', t => {
  const value = fixture(t);
  record(value);
  packageNativeSdk({...value.options, out: value.out});
  const filename = path.join(value.out, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(filename, 'utf8'));
  manifest.runtimeExecuted = true;
  fs.writeFileSync(filename, JSON.stringify(manifest));
  rejects('SDK_PACKAGE_STALE', () => verifyNativeSdk(value.out));
});

test('incomplete publication retains failure evidence without a completion manifest', t => {
  const value = fixture(t);
  record(value);
  fs.unlinkSync(path.join(value.root, 'LICENSE'));
  assert.throws(() => packageNativeSdk({...value.options, out: value.out}), /ENOENT/);
  assert.ok(fs.existsSync(path.join(value.out, 'failure.json')));
  assert.ok(!fs.existsSync(path.join(value.out, 'manifest.json')));
  assert.ok(treeRecords(value.out).some(entry => entry.path === 'lib/fabric_godot.dylib'));
});
