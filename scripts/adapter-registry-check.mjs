// Build and execute the bounded registry client against a packaged shared SDK.
// No Godot engine, Hermes VM, adapter loader or dependency installation.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {generateCodegen, verifyCodegen} from './codegen.mjs';
import {verifyNativeSdk, treeRecords} from './native-sdk.mjs';

const project = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const inside = (root, file) => {
  const rel = path.relative(root, file);
  return rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
};
function cmakePath(value) {
  if (/[";\r\n$]/.test(value)) throw new Error('E_REGISTRY_PATH: unsupported CMake path');
  return value.replaceAll('\\', '/');
}

function check({sdk, out, cmake}) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    throw new Error('E_REGISTRY_TARGET: requires macOS arm64');
  const output = path.resolve(out);
  if (!inside(path.join(project, 'build'), output)) throw new Error('E_REGISTRY_PATH: use a new child under build/');
  let ancestor = path.dirname(output);
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  if (!inside(path.join(project, 'build'), path.join(fs.realpathSync(ancestor), path.relative(ancestor, output))))
    throw new Error('E_REGISTRY_PATH: output resolves outside build/');
  try { fs.lstatSync(output); throw new Error('E_REGISTRY_OUTPUT_EXISTS: preserve existing output'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const originalSdk = fs.realpathSync(sdk);
  const sdkManifest = verifyNativeSdk(originalSdk);
  const cmakeBinary = fs.realpathSync(cmake);
  const inputs = ['scripts/adapter-registry-check.mjs', 'scripts/native-sdk.mjs', 'scripts/codegen.mjs', 'scripts/codegen-contract.mjs',
    'package-lock.json', 'tests/adapters/registry_test.cpp',
    'tests/codegen/NativeCodegenProbe.ts', 'tests/codegen/BadgeNativeComponent.ts'];
  const sourceSha256 = Object.fromEntries(inputs.map(file => [file, hash(path.join(project, file))]));
  const report = {format: 'godot-fabric.experimental-adapter-registry-witness/v1',
    checkedAt: new Date().toISOString(), sourceSha256, stages: [], passed: false,
    sdkManifestSha256: hash(path.join(originalSdk, 'manifest.json')),
    cmakeExecutableSha256: hash(cmakeBinary), node: {version: process.version, executableSha256: hash(process.execPath)},
    nativeClientLinked: false, registryExecuted: false, vmCreated: false, godotEngineStarted: false,
    adapterLoaded: false, componentMounted: false, abiCertified: false};
  fs.mkdirSync(path.dirname(output), {recursive: true});
  fs.mkdirSync(output);
  fs.mkdirSync(path.join(output, 'logs'));
  const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  function run(command, args, stage) {
    console.log('Adapter registry witness: ' + stage);
    const result = spawnSync(command, args, {cwd: project, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024});
    const log = path.join(output, 'logs', stage + '.log');
    fs.writeFileSync(log, JSON.stringify([command, ...args]) + '\n\n' + (result.stdout ?? '') + (result.stderr ?? ''));
    report.stages.push({stage, exitCode: result.status, log: path.relative(output, log), logSha256: hash(log)});
    save();
    if (result.error || result.status !== 0) throw new Error(stage + ' failed; retained ' + log);
    return result.stdout;
  }
  try {
    // Compile from a relocated package, not the checkout's upstream/native
    // include directories or archives. The runtime copy owns its RPATH.
    const relocated = path.join(output, 'sdk');
    fs.cpSync(originalSdk, relocated, {recursive: true, verbatimSymlinks: true});
    verifyNativeSdk(relocated);
    fs.cpSync(path.join(relocated, 'lib'), path.join(output, 'runtime'), {recursive: true, verbatimSymlinks: true});
    const expectedRuntime = sdkManifest.files.filter(file => file.path.startsWith('lib/'))
      .map(file => ({...file, path: file.path.slice(4)}));
    function verifyRuntime() {
      if (!isDeepStrictEqual(treeRecords(path.join(output, 'runtime')), expectedRuntime))
        throw new Error('E_REGISTRY_STALE: deployed runtime files changed');
    }
    verifyRuntime();
    const generated = path.join(output, 'generated');
    const options = {root: path.join(project, 'tests/codegen'),
      specs: ['NativeCodegenProbe.ts', 'BadgeNativeComponent.ts'], libraryName: 'CodegenFixture', out: generated,
      nativeCombination: read(path.join(relocated, 'native-combination.json'))};
    generateCodegen(options);
    verifyCodegen(options);
    const harness = path.join(output, 'harness');
    fs.mkdirSync(harness);
    fs.copyFileSync(path.join(project, 'tests/adapters/registry_test.cpp'), path.join(harness, 'registry_test.cpp'));
    const componentDir = path.join(generated, 'cpp/react/renderer/components/CodegenFixture');
    const cpp = ['ComponentDescriptors', 'EventEmitters', 'Props', 'ShadowNodes', 'States']
      .map(name => '  "' + cmakePath(path.join(componentDir, name + '.cpp')) + '"').join('\n');
    fs.writeFileSync(path.join(harness, 'CMakeLists.txt'), [
      'cmake_minimum_required(VERSION 3.31)', 'project(adapter_registry_witness LANGUAGES CXX)',
      'find_package(GodotFabricNativeSDK CONFIG REQUIRED PATHS "' + cmakePath(path.join(relocated, 'cmake')) + '" NO_DEFAULT_PATH)',
      'add_executable(adapter_registry_check registry_test.cpp\n' + cpp + ')',
      'target_include_directories(adapter_registry_check PRIVATE "' + cmakePath(path.join(generated, 'cpp')) + '")',
      'godot_fabric_configure_adapter(adapter_registry_check HOST_RUNTIME_DIR "../runtime")', '',
    ].join('\n'));
    const build = path.join(output, 'client');
    run(cmakeBinary, ['-S', harness, '-B', build, '-G', 'Unix Makefiles', '-DCMAKE_BUILD_TYPE=Release',
      '-DCMAKE_OSX_ARCHITECTURES=arm64', '-DCMAKE_OSX_DEPLOYMENT_TARGET=13.0'], 'configure');
    run(cmakeBinary, ['--build', build, '--parallel', '4'], 'compile-link');
    report.nativeClientLinked = true;
    const binary = path.join(build, 'adapter_registry_check');
    report.binarySha256 = hash(binary);
    run('/usr/bin/otool', ['-L', binary], 'native-dependencies');
    const linkCommand = fs.readFileSync(path.join(build, 'CMakeFiles/adapter_registry_check.dir/link.txt'), 'utf8');
    if (/\.a(?:\s|"|$)/.test(linkCommand) || !linkCommand.includes('-undefined') || !linkCommand.includes('fabric_godot.dylib')
      || !linkCommand.includes('@loader_path/../runtime'))
      throw new Error('E_REGISTRY_LINK: require strict shared host linking and relative runtime RPATH');
    verifyRuntime();
    const stdout = run(binary, [], 'registry');
    const lines = stdout.trim().split('\n');
    if (lines.length !== 1) throw new Error('E_REGISTRY_REPORT: unexpected executable output');
    const actual = JSON.parse(lines[0]);
    if (actual.format !== 'godot-fabric.experimental-adapter-registry-test/v1'
      || actual.marker !== 'ADAPTER_REGISTRY_OK' || actual.cases !== 11
      || !Number.isInteger(actual.checks) || actual.checks < 192 || !Number.isInteger(actual.initializers)
      || actual.viewFactoryCalls !== 0 || actual.moduleFactoryCalls !== 0
      || actual.vmCreated !== false || actual.godotEngineStarted !== false)
      throw new Error('E_REGISTRY_REPORT: missing or incomplete registry acceptance');
    report.registry = actual;
    report.registryExecuted = true;
    verifyCodegen(options);
    verifyNativeSdk(originalSdk);
    verifyNativeSdk(relocated);
    if ([originalSdk, relocated].some(directory => hash(path.join(directory, 'manifest.json')) !== report.sdkManifestSha256))
      throw new Error('E_REGISTRY_STALE: native SDK manifest changed during witness');
    verifyRuntime();
    if (hash(binary) !== report.binarySha256) throw new Error('E_REGISTRY_STALE: client binary changed');
    for (const [file, digest] of Object.entries(sourceSha256))
      if (hash(path.join(project, file)) !== digest) throw new Error('E_REGISTRY_STALE: source changed during witness');
    report.generatedManifestSha256 = hash(path.join(generated, 'manifest.json'));
    report.nativeCombination = options.nativeCombination;
    report.linkCommandSha256 = hash(path.join(build, 'CMakeFiles/adapter_registry_check.dir/link.txt'));
    report.passed = true;
    console.log(JSON.stringify({passed: true, checks: actual.checks, cases: actual.cases,
      nativeClientLinked: true, registryExecuted: true, componentMounted: false, abiCertified: false}));
  } catch (error) { report.error = error.message; throw error; }
  finally { save(); }
}

try {
  const values = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    if (!['--sdk', '--out', '--cmake'].includes(args[i]) || !args[i + 1] || values[args[i]])
      throw new Error('Use --sdk <package> --out <new build directory> [--cmake <executable>]');
    values[args[i]] = args[i + 1];
  }
  if (!values['--sdk'] || !values['--out']) throw new Error('Use --sdk and --out');
  check({sdk: values['--sdk'], out: values['--out'],
    cmake: values['--cmake'] ?? path.join(project, '.deps/python/bin/cmake')});
} catch (error) { console.error(error.message); process.exitCode = 1; }
