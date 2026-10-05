import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {verifyAddonNativeInputs} from '../scripts/pack-addon.mjs';
import {treeRecords, verifyNativeSdk} from '../scripts/native-sdk.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const claims = {adapterLinked: false, adapterLoaded: false, runtimeExecuted: false,
  runtimeIdentityVerified: false, abiCertified: false};
function write(root, relative, content) {
  const filename = path.join(root, relative);
  fs.mkdirSync(path.dirname(filename), {recursive: true});
  fs.writeFileSync(filename, content);
  return filename;
}
function writeJson(root, relative, value) { return write(root, relative, JSON.stringify(value, null, 2) + '\n'); }
function sealSdk(value) {
  writeJson(value.sdk, 'manifest.json', {
    format: 'godot-fabric.experimental-native-sdk/v1', target: value.combination.target,
    combinationSha256: digest(fs.readFileSync(path.join(value.sdk, 'native-combination.json'))),
    files: treeRecords(value.sdk).filter(entry => entry.path !== 'manifest.json'), ...claims,
  });
}
function fixture(t) {
  // Synthetic receipts exercise composition checks; these bytes are never compiled, loaded or provisioned.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'godot-fabric-addon-native-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const lock = JSON.parse(fs.readFileSync(path.join(repository, 'dependencies.json'), 'utf8'));
  writeJson(root, 'dependencies.json', lock);
  const inputs = {
    'native/application_runtime.cpp': '// current native host includes the instance-handle seam\n',
    'native/application_runtime.h': '#pragma once\n',
    'native/CMakeLists.txt': '# synthetic native build definition\n',
    'native/godot-profile.json': '{"enabled_classes":["Control"]}\n',
    'scripts/rn-pointer-overlay.mjs': '// current native pointer overlay generator\n',
    'scripts/native-sdk.mjs': '// bookkeeping is not a compiled host contract\n',
    'scripts/codegen-contract.mjs': '// bookkeeping is not a compiled host contract\n',
    'src/private-interface.js': '// current JS facade\n',
  };
  for (const [filename, content] of Object.entries(inputs)) write(root, filename, content);
  const sourceSha256 = Object.fromEntries(Object.entries(inputs).map(([filename, content]) => [filename, digest(content)]));
  sourceSha256['dependencies.json'] = digest(fs.readFileSync(path.join(root, 'dependencies.json')));
  const binaries = {host: 'fixture-not-a-compiled-host', hermes: 'fixture-not-hermes', dependencies: 'fixture-not-rn-dependencies'};
  const hashes = Object.fromEntries(Object.entries(binaries).map(([name, bytes]) => [name, digest(bytes)]));
  write(root, 'addons/fabric_godot.dylib', binaries.host);
  write(root, 'addons/frameworks/hermesvm.framework/hermesvm', binaries.hermes);
  write(root, 'addons/frameworks/ReactNativeDependencies.framework/ReactNativeDependencies', binaries.dependencies);
  const target = {platform: 'macos', architecture: 'arm64', configuration: 'Release', minimumOS: '13.0'};
  const receipt = {
    format: 'godot-fabric.experimental-native-sdk-build/v1', nativeHostBuildRecorded: true,
    host: {source: 'addons/fabric_godot.dylib', sha256: hashes.host},
    inputs: {format: 'godot-fabric.experimental-native-sdk-inputs/v1', target, sourceSha256,
      dependencies: [{name: 'hermes', sha256: hashes.hermes}, {name: 'rn-dependencies', sha256: hashes.dependencies}]},
    ...claims,
  };
  writeJson(root, '.deps/build/native-sdk-build.json', receipt);
  const sdk = path.join(root, 'build/sdk');
  write(sdk, 'lib/fabric_godot.dylib', binaries.host);
  write(sdk, 'lib/frameworks/hermesvm.framework/hermesvm', binaries.hermes);
  write(sdk, 'lib/frameworks/ReactNativeDependencies.framework/ReactNativeDependencies', binaries.dependencies);
  const combination = {
    format: 'godot-fabric.experimental-native-combination/v1', purpose: 'build-declaration',
    sdkRevision: 'synthetic-composition-check-only', sdkHeadersSha256: digest('fixture-headers'),
    reactNativeVersion: lock['react-native'].version, reactNativeHeadersSha256: digest('fixture-rn-headers'),
    hermesVersion: lock.hermes.version, hermesRuntimeSha256: hashes.hermes,
    godotVersion: lock.godot.version, godotCppRevision: lock['godot-cpp'].commit, target,
    toolchain: {name: 'AppleClang', version: 'fixture-not-a-compiler-proof'},
    nativeDependencies: [{name: 'fabric_godot', sha256: hashes.host},
      {name: 'hermes', sha256: hashes.hermes}, {name: 'rn-dependencies', sha256: hashes.dependencies}],
  };
  writeJson(sdk, 'native-combination.json', combination);
  const sdkReceipt = {format: 'godot-fabric.experimental-native-sdk/v1', nativeHostBuildRecorded: true,
    hostSha256: hashes.host, sourceSha256, ...claims};
  writeJson(sdk, 'receipt.json', sdkReceipt);
  const value = {root, sdk, receipt, sdkReceipt, combination, hashes};
  sealSdk(value);
  return value;
}
const verify = (value, packaged) => verifyAddonNativeInputs({sourceRoot: value.root, nativeSdk: packaged ? value.sdk : null});
const rejects = (code, action) => assert.rejects(action, error => error.code === code);

test('matching SDK and default native receipts both accept the exact host and dependency bytes', async t => {
  const value = fixture(t);
  verifyNativeSdk(value.sdk);
  for (const packaged of [false, true]) {
    const result = await verify(value, packaged);
    assert.deepEqual(result.nativeHashes, value.hashes);
    assert.equal(result.nativeCombination?.purpose, packaged ? 'build-declaration' : undefined);
  }
});

test('JS, docs, package and bookkeeping changes do not require native receipt identity', async t => {
  const value = fixture(t);
  for (const filename of ['src/private-interface.js', 'README.md', 'package.json',
    'scripts/native-sdk.mjs', 'scripts/codegen-contract.mjs']) write(value.root, filename, '// unrelated to compiled native input\n');
  for (const packaged of [false, true]) await verify(value, packaged);
});

test('an intact older SDK or local host is rejected after native source, header, build profile or overlay changes', async t => {
  for (const filename of ['native/application_runtime.cpp', 'native/application_runtime.h',
    'native/CMakeLists.txt', 'native/godot-profile.json', 'scripts/rn-pointer-overlay.mjs']) {
    const value = fixture(t);
    write(value.root, filename, '// new host contract\n');
    verifyNativeSdk(value.sdk); // Old package remains internally valid; composition must still fail.
    for (const packaged of [false, true]) {
      await assert.rejects(() => verify(value, packaged), error => error.code === 'SDK_HOST_SOURCE_MISMATCH'
        && error.message.includes(filename) && error.message.includes('rebuild'));
    }
  }
});

test('added and removed native inputs reject a receipt with a different source set', async t => {
  for (const change of ['added', 'removed']) {
    const value = fixture(t);
    if (change === 'added') write(value.root, 'native/new_host_feature.cpp', '// newly linked feature\n');
    else fs.unlinkSync(path.join(value.root, 'native/application_runtime.h'));
    for (const packaged of [false, true]) await rejects('SDK_HOST_SOURCE_MISMATCH', () => verify(value, packaged));
  }
});

test('changed dependency build definitions reject the default receipt and the old SDK combination', async t => {
  const value = fixture(t);
  const lock = JSON.parse(fs.readFileSync(path.join(value.root, 'dependencies.json'), 'utf8'));
  lock.godot.version = 'different-native-engine';
  writeJson(value.root, 'dependencies.json', lock);
  await rejects('SDK_HOST_SOURCE_MISMATCH', () => verify(value, false));
  verifyNativeSdk(value.sdk);
  await assert.rejects(() => verify(value, true), /matching macOS arm64 Release host\/dependency build/);
});

test('the SDK also requires the exact recorded dependency build definition when native version labels match', async t => {
  const value = fixture(t);
  fs.appendFileSync(path.join(value.root, 'dependencies.json'), '\n');
  await rejects('SDK_HOST_SOURCE_MISMATCH', () => verify(value, true));
});

test('missing native source hashes reject otherwise intact receipts', async t => {
  const value = fixture(t);
  delete value.sdkReceipt.sourceSha256['native/application_runtime.cpp'];
  writeJson(value.sdk, 'receipt.json', value.sdkReceipt);
  writeJson(value.root, '.deps/build/native-sdk-build.json', value.receipt);
  sealSdk(value);
  verifyNativeSdk(value.sdk);
  for (const packaged of [false, true]) await rejects('SDK_HOST_SOURCE_MISMATCH', () => verify(value, packaged));
});

test('corrupted SDK binaries and receipts still fail existing package integrity validation first', async t => {
  for (const filename of ['lib/fabric_godot.dylib', 'receipt.json']) {
    const value = fixture(t);
    fs.appendFileSync(path.join(value.sdk, filename), 'corrupt');
    write(value.root, 'native/application_runtime.cpp', '// also changed\n');
    await rejects('SDK_PACKAGE_STALE', () => verify(value, true));
  }
});

test('a coherently sealed SDK must still link its receipt to the declared host binary', async t => {
  const value = fixture(t);
  value.sdkReceipt.hostSha256 = digest('older-host-binary');
  writeJson(value.sdk, 'receipt.json', value.sdkReceipt);
  sealSdk(value);
  verifyNativeSdk(value.sdk);
  await rejects('SDK_HOST_BINARY_MISMATCH', () => verify(value, true));
});

test('default host and framework bytes must still match the recorded native build', async t => {
  for (const filename of ['addons/fabric_godot.dylib', 'addons/frameworks/hermesvm.framework/hermesvm',
    'addons/frameworks/ReactNativeDependencies.framework/ReactNativeDependencies']) {
    const value = fixture(t);
    fs.appendFileSync(path.join(value.root, filename), 'older-or-corrupted-binary');
    await rejects('SDK_HOST_BINARY_MISMATCH', () => verify(value, false));
  }
});

test('default provisioning without a build receipt gives a rebuild or matching SDK diagnostic', async t => {
  const value = fixture(t);
  fs.unlinkSync(path.join(value.root, '.deps/build/native-sdk-build.json'));
  await assert.rejects(() => verify(value, false), error => error.code === 'SDK_HOST_RECEIPT_MISSING'
    && error.message.includes('setup/CMake') && error.message.includes('--native-sdk'));
});

test('default provisioning rejects fixture, wrong-target and incomplete binary receipts', async t => {
  for (const change of ['fixture', 'target', 'hash']) {
    const value = fixture(t);
    if (change === 'fixture') value.receipt.nativeHostBuildRecorded = false;
    else if (change === 'target') value.receipt.inputs.target.architecture = 'x86_64';
    else delete value.receipt.inputs.dependencies[0].sha256;
    writeJson(value.root, '.deps/build/native-sdk-build.json', value.receipt);
    await rejects('SDK_HOST_RECEIPT_INVALID', () => verify(value, false));
  }
});

test('SDK fixture declarations and incompatible dependency combinations remain rejected', async t => {
  for (const change of ['fixture', 'target', 'dependency']) {
    const value = fixture(t);
    if (change === 'fixture') value.sdkReceipt.nativeHostBuildRecorded = false;
    else if (change === 'target') value.combination.target.architecture = 'x86_64';
    else value.combination.godotCppRevision = 'different-godot-bindings';
    writeJson(value.sdk, 'receipt.json', value.sdkReceipt);
    writeJson(value.sdk, 'native-combination.json', value.combination);
    sealSdk(value);
    await assert.rejects(() => verify(value, true), /matching macOS arm64 Release host\/dependency build/);
  }
});
