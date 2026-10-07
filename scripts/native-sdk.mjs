// Experimental shared native SDK. No compilation, downloads or library loading.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateCombination} from './codegen-contract.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const format = 'godot-fabric.experimental-native-sdk/v1';
const inputFormat = 'godot-fabric.experimental-native-sdk-inputs/v1';
const receiptFormat = 'godot-fabric.experimental-native-sdk-build/v1';
const headerPattern = /\.(?:h|hh|hpp|hxx|inc|inl|ipp|tcc|def)$/i;
const sourcePattern = /\.(?:cpp|cc|cxx|c)$/i;
const claims = {adapterLinked: false, adapterLoaded: false, runtimeExecuted: false,
  runtimeIdentityVerified: false, abiCertified: false};

function fail(code, message) {
  const error = new Error(code + ': ' + message);
  error.code = code;
  throw error;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function json(value) { return JSON.stringify(canonical(value), null, 2) + '\n'; }
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function fileHash(filename) { return digest(fs.readFileSync(filename)); }
function inside(root, filename) {
  const relative = path.relative(root, filename);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
function exists(filename) {
  try { fs.lstatSync(filename); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
function readJson(filename) { return JSON.parse(fs.readFileSync(filename, 'utf8')); }
function same(left, right) { return json(left) === json(right); }
function atomicJson(filename, value) {
  const content = json(value);
  if (exists(filename) && fs.readFileSync(filename, 'utf8') === content) return;
  const staging = filename + '.staging-' + process.pid;
  try { fs.writeFileSync(staging, content, {flag: 'wx'}); fs.renameSync(staging, filename); }
  finally { if (exists(staging)) fs.unlinkSync(staging); }
}

export function treeRecords(directory, headersOnly = false) {
  const base = fs.realpathSync(directory);
  const records = [];
  function visit(current) {
    for (const entry of fs.readdirSync(current, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const filename = path.join(current, entry.name);
      const relative = path.relative(base, filename).split(path.sep).join('/');
      if (entry.isSymbolicLink()) {
        const physical = fs.realpathSync(filename);
        if (!inside(base, physical)) fail('SDK_SYMLINK_ESCAPE', relative);
        if (!headersOnly || fs.statSync(filename).isDirectory()
          || (headersOnly === 'sources' ? sourcePattern : headerPattern).test(entry.name))
          records.push({path: relative, link: fs.readlinkSync(filename)});
      } else if (entry.isDirectory()) visit(filename);
      else if (entry.isFile() && (!headersOnly || (headersOnly === 'sources' ? sourcePattern : headerPattern).test(entry.name)))
        records.push({path: relative, sha256: fileHash(filename)});
      else if (!entry.isFile()) fail('SDK_FILE_TYPE', relative);
    }
  }
  visit(base);
  return records.sort((a, b) => a.path.localeCompare(b.path));
}

function shellWords(value) {
  const words = [];
  let word = '', quote = '', escaped = false, started = false;
  for (const char of value) {
    if (escaped) { word += char; escaped = false; started = true; continue; }
    if (char === '\\' && quote !== "'") { escaped = true; started = true; continue; }
    if (quote) { if (char === quote) quote = ''; else word += char; started = true; continue; }
    if (char === "'" || char === '"') { quote = char; started = true; continue; }
    if (/\s/.test(char)) { if (started) words.push(word); word = ''; started = false; continue; }
    word += char; started = true;
  }
  if (escaped || quote) fail('SDK_FLAGS', 'unterminated CMake argument');
  if (started) words.push(word);
  return words;
}
function settings(buildDir, root, fixture) {
  const cacheFile = path.join(buildDir, 'CMakeCache.txt');
  const flagFile = path.join(buildDir, 'CMakeFiles/fabric_godot.dir/flags.make');
  const cache = Object.fromEntries(fs.readFileSync(cacheFile, 'utf8').split('\n')
    .flatMap(line => { const match = /^([^:#]+):[^=]+=(.*)$/.exec(line); return match ? [[match[1], match[2]]] : []; }));
  if (cache.CMAKE_GENERATOR !== 'Unix Makefiles')
    fail('SDK_GENERATOR', 'native SDK receipts currently consume Unix Makefiles flags.make only');
  const make = Object.fromEntries(fs.readFileSync(flagFile, 'utf8').split('\n')
    .flatMap(line => { const match = /^([A-Z_]+)\s*=\s*(.*)$/.exec(line); return match ? [[match[1], match[2]]] : []; }));
  if (!fixture && (process.platform !== 'darwin' || process.arch !== 'arm64'))
    fail('SDK_TARGET', 'this SDK requires a macOS arm64 build host');
  if (cache.CMAKE_BUILD_TYPE !== 'Release' || cache.CMAKE_OSX_ARCHITECTURES !== 'arm64'
    || cache.GODOTCPP_SYMBOL_VISIBILITY !== 'visible'
    || fs.realpathSync(cache.CMAKE_HOME_DIRECTORY) !== path.join(root, 'native'))
    fail('SDK_TARGET', 'require this checkout, Release/arm64 and visible shared Godot bindings');
  const groups = {};
  for (const name of ['CXX_DEFINES', 'CXX_INCLUDES', 'CXX_FLAGS']) {
    if (!make[name] || make[name].includes('$')) fail('SDK_FLAGS', 'missing/unexpanded ' + name);
    groups[name] = shellWords(make[name]);
  }
  const flags = groups.CXX_FLAGS;
  if (!flags.includes('-mmacosx-version-min=13.0') || !flags.includes('-std=gnu++20')
    || !flags.includes('-O3') || !flags.includes('-DNDEBUG')
    || flags.filter(word => word === '-arch').length !== 1 || flags[flags.indexOf('-arch') + 1] !== 'arm64')
    fail('SDK_TARGET', 'actual compiler flags must match macOS arm64 Release C++20/minimum13.0');
  const sysrootIndex = flags.indexOf('-isysroot');
  if (sysrootIndex < 0 || !flags[sysrootIndex + 1]
    || !/^MacOSX[^/]*\.sdk$/.test(path.basename(flags[sysrootIndex + 1]))
    || !fs.statSync(flags[sysrootIndex + 1]).isDirectory())
    fail('SDK_TARGET', 'native macOS SDK is missing');
  const expectedFlags = ['-O3', '-DNDEBUG', '-std=gnu++20', '-arch', 'arm64', '-isysroot',
    flags[sysrootIndex + 1], '-mmacosx-version-min=13.0', '-fPIC'];
  if (!same(flags, expectedFlags)) fail('SDK_FLAGS', 'extra or reordered native flags are outside this identified SDK profile');
  if (groups.CXX_INCLUDES.some(word => !word.startsWith('-I') || word.length === 2)
    || groups.CXX_DEFINES.some(word => !word.startsWith('-D') || word.length === 2))
    fail('SDK_FLAGS', 'unsupported include/definition syntax');
  const compiler = fs.realpathSync(cache.CMAKE_CXX_COMPILER);
  return {cache, groups, compiler, cacheSha256: fileHash(cacheFile), flagsSha256: fileHash(flagFile)};
}

function probeCompiler(compiler) {
  const result = spawnSync(compiler, ['--version'], {encoding: 'utf8', timeout: 10000});
  if (result.error || result.status !== 0) fail('SDK_COMPILER', 'cannot query native compiler');
  const versions = result.stdout.split('\n').filter(line => line.startsWith('Apple clang version '));
  if (versions.length !== 1) fail('SDK_COMPILER', 'expected an identified AppleClang compiler');
  return {name: 'AppleClang', version: versions[0]};
}
function headerTrees(root, buildDir, lock) {
  const rn = path.join(root, '.deps', lock['react-native'].directory);
  const godot = path.join(root, '.deps', lock['godot-cpp'].directory);
  return [
    {name: 'sdk', source: path.join(root, 'native'), destination: 'include/sdk',
      publicFiles: ['adapter_registry.h', 'adapter_loader.h', 'turbo_module_registry.h']},
    {name: 'react-native-pointer-overlay', source: path.join(buildDir, 'rn-pointer-overlay'), destination: 'include/rn-pointer-overlay'},
    {name: 'react-native', source: path.join(rn, 'ReactCommon'), destination: 'include/react-native/ReactCommon'},
    {name: 'react-native-specs', source: path.join(rn, 'React/FBReactNativeSpec'), destination: 'include/react-native/React/FBReactNativeSpec'},
    {name: 'hermes', source: path.join(root, '.deps', lock.hermes.directory, 'destroot/include'), destination: 'include/hermes'},
    {name: 'rn-dependencies', source: path.join(root, '.deps', lock['rn-dependencies'].directory,
      'packages/react-native/third-party/ReactNativeDependenciesHeaders.xcframework/macos-arm64_x86_64/Headers'),
    destination: 'include/rn-dependencies'},
    {name: 'godot-cpp', source: path.join(godot, 'include'), destination: 'include/godot-cpp/include'},
    {name: 'godot-cpp-generated', source: path.join(buildDir, 'godot-cpp/gen/include'), destination: 'include/godot-cpp/gen/include'},
    {name: 'godot-cpp-interface', source: path.join(godot, 'gdextension'), destination: 'include/godot-cpp/gdextension'},
  ];
}
function sharedLibraries(root, lock) {
  return [
    {name: 'hermes', source: path.join(root, '.deps', lock.hermes.directory,
      'destroot/Library/Frameworks/macosx/hermesvm.framework'), binary: 'hermesvm'},
    {name: 'rn-dependencies', source: path.join(root, '.deps', lock['rn-dependencies'].directory,
      'packages/react-native/third-party/ReactNativeDependencies.xcframework/macos-arm64_x86_64/ReactNativeDependencies.framework'),
    binary: 'ReactNativeDependencies'},
  ];
}
function snapshot(options) {
  const root = fs.realpathSync(options.root ?? project);
  const buildDir = fs.realpathSync(options.buildDir);
  if (!inside(root, buildDir)) fail('SDK_PATH', 'native build must belong to the source checkout');
  const lock = readJson(path.join(root, 'dependencies.json'));
  const actual = settings(buildDir, root, options.fixture === true);
  const trees = headerTrees(root, buildDir, lock);
  const privateIncludeTrees = [
    {name: 'wslay-internal-headers', source: path.join(root, '.deps', lock.wslay.directory, 'lib')},
    {name: 'wslay-generated-config', source: path.join(buildDir, 'wslay')},
  ];
  for (const name of ['adapter_registry.h', 'adapter_loader.h', 'turbo_module_registry.h'])
    if (!exists(path.join(root, 'native', name))) fail('SDK_SPI_MISSING', name);
  const treeInputs = trees.map(tree => ({name: tree.name, destination: tree.destination,
    source: path.relative(root, tree.source).split(path.sep).join('/'),
    files: tree.publicFiles ? tree.publicFiles.map(name => ({path: name, sha256: fileHash(path.join(tree.source, name))}))
      : treeRecords(tree.source, true)}));
  const privateTreeInputs = privateIncludeTrees.map(tree => ({name: tree.name,
    source: path.relative(root, tree.source).split(path.sep).join('/'), files: treeRecords(tree.source, true)}));
  const sourceFiles = fs.readdirSync(path.join(root, 'native')).filter(name => /\.(?:cpp|h)$/.test(name)
    || ['CMakeLists.txt', 'godot-profile.json'].includes(name)).map(name => 'native/' + name);
  sourceFiles.push('dependencies.json', 'scripts/native-sdk.mjs', 'scripts/codegen-contract.mjs', 'scripts/rn-pointer-overlay.mjs');
  const sourceSha256 = Object.fromEntries(sourceFiles.sort().map(name => [name, fileHash(path.join(root, name))]));
  // The host also compiles RN's generated core-component Props/EventEmitters.
  const sourceTrees = [['react-native', path.join(root, '.deps', lock['react-native'].directory, 'ReactCommon')],
    ['react-native-specs', path.join(root, '.deps', lock['react-native'].directory, 'React/FBReactNativeSpec')],
    ['godot-cpp', path.join(root, '.deps', lock['godot-cpp'].directory, 'src')],
    ['wslay', path.join(root, '.deps', lock.wslay.directory, 'lib')],
    ['godot-cpp-generated', path.join(buildDir, 'godot-cpp/gen/src')],
    ['react-native-pointer-overlay', path.join(buildDir, 'rn-pointer-overlay')]]
    .map(([name, directory]) => ({name, files: treeRecords(directory, 'sources')}));
  sourceTrees.find(tree => tree.name === 'react-native-pointer-overlay').manifestSha256 =
    fileHash(path.join(buildDir, 'rn-pointer-overlay/overlay-manifest.json'));
  const targetFlagsSha256 = Object.fromEntries(['CMakeFiles/fabric_core.dir/flags.make',
    'godot-cpp/CMakeFiles/godot-cpp.dir/flags.make', 'wslay/CMakeFiles/wslay.dir/flags.make']
    .map(name => [name, fileHash(path.join(buildDir, name))]));
  const dependencies = sharedLibraries(root, lock).map(library => ({name: library.name,
    source: path.relative(root, library.source).split(path.sep).join('/'), binary: library.binary,
    sha256: fileHash(path.join(library.source, library.binary)), files: treeRecords(library.source)}));
  const compiler = {...(options.probeCompiler ?? probeCompiler)(actual.compiler),
    executableSha256: fileHash(actual.compiler)};
  const includeDirectories = [];
  const omittedIncludes = [];
  for (const flag of actual.groups.CXX_INCLUDES) {
    const absolute = path.resolve(flag.slice(2));
    if (!exists(absolute)) { omittedIncludes.push(path.relative(root, absolute)); continue; }
    const physical = fs.realpathSync(absolute);
    if (privateIncludeTrees.some(tree => inside(fs.realpathSync(tree.source), physical))) continue;
    const tree = trees.find(candidate => inside(fs.realpathSync(candidate.source), physical));
    if (!tree) fail('SDK_INCLUDE', 'include is outside declared shared header trees: ' + flag);
    const relative = path.relative(fs.realpathSync(tree.source), physical).split(path.sep).join('/');
    includeDirectories.push(tree.destination + (relative ? '/' + relative : ''));
  }
  if (!includeDirectories.includes('include/sdk')) includeDirectories.unshift('include/sdk');
  return {format: inputFormat, fixture: options.fixture === true, target: {platform: 'macos', architecture: 'arm64',
    configuration: 'Release', minimumOS: '13.0'}, compiler,
  node: {version: process.version, executableSha256: fileHash(fs.realpathSync(process.execPath))},
  buildSettings: {cacheSha256: actual.cacheSha256, flagsSha256: actual.flagsSha256,
    definitions: actual.groups.CXX_DEFINES, flags: actual.groups.CXX_FLAGS},
  includeDirectories: [...new Set(includeDirectories)], omittedIncludes, sourceSha256, sourceTrees,
  targetFlagsSha256, trees: treeInputs, privateTrees: privateTreeInputs, dependencies};
}

export function captureBuildInputs(options) {
  const current = snapshot(options);
  atomicJson(path.join(options.buildDir, 'native-sdk-inputs.json'), current);
  return current;
}
export function recordNativeBuild(options) {
  const captured = readJson(path.join(options.buildDir, 'native-sdk-inputs.json'));
  const current = snapshot(options);
  if (captured.format !== inputFormat || !same(captured, current))
    fail('SDK_BUILD_INPUTS_CHANGED', 'native inputs changed during compilation; rebuild from a frozen source tree');
  const root = fs.realpathSync(options.root ?? project);
  const host = fs.realpathSync(options.host);
  if (!inside(root, host) || !host.endsWith('.dylib')) fail('SDK_HOST', 'expected the shared host inside the checkout');
  const receipt = {format: receiptFormat, inputs: captured,
    host: {source: path.relative(root, host).split(path.sep).join('/'), sha256: fileHash(host)},
    nativeHostBuildRecorded: !options.fixture, ...claims};
  atomicJson(path.join(options.buildDir, 'native-sdk-build.json'), receipt);
  return receipt;
}

function cmakeQuote(value) {
  if (/[;\r\n"]/.test(value)) fail('SDK_CMAKE_VALUE', 'unrepresentable CMake value');
  return '"' + value.replaceAll('\\', '/') + '"';
}
function cmakeConfig(inputs, lock) {
  const ref = name => '$' + '{' + name + '}';
  const sdk = ref('_gfs_root');
  const target = ref('target');
  const runtime = ref('GF_HOST_RUNTIME_DIR');
  const includes = inputs.includeDirectories.map(name => cmakeQuote(sdk + '/' + name)).join('\n  ');
  const definitions = inputs.buildSettings.definitions.filter(name => name !== '-Dfabric_godot_EXPORTS')
    .map(name => cmakeQuote(name.slice(2))).join('\n  ');
  return [
    '# Identified experimental C++ SPI; no stable cross-version ABI.',
    'get_filename_component(_gfs_root "' + ref('CMAKE_CURRENT_LIST_DIR') + '/.." ABSOLUTE)',
    'if(NOT CMAKE_SYSTEM_NAME STREQUAL "Darwin" OR NOT CMAKE_BUILD_TYPE STREQUAL "Release"',
    '   OR NOT CMAKE_OSX_ARCHITECTURES STREQUAL "arm64")',
    '  message(FATAL_ERROR "This native SDK requires macOS arm64 Release")',
    'endif()',
    'if(NOT CMAKE_CXX_COMPILER_ID STREQUAL "AppleClang")',
    '  message(FATAL_ERROR "This identified native SDK requires AppleClang")',
    'endif()',
    'file(SHA256 "' + ref('CMAKE_CXX_COMPILER') + '" _gfs_compiler_sha)',
    'if(NOT _gfs_compiler_sha STREQUAL "' + inputs.compiler.executableSha256 + '")',
    '  message(FATAL_ERROR "Compiler binary differs from this SDK native combination")',
    'endif()',
    'add_library(GodotFabric::Hermes SHARED IMPORTED GLOBAL)',
    'set_target_properties(GodotFabric::Hermes PROPERTIES IMPORTED_LOCATION "' + sdk + '/lib/frameworks/hermesvm.framework/hermesvm")',
    'add_library(GodotFabric::RNDependencies SHARED IMPORTED GLOBAL)',
    'set_target_properties(GodotFabric::RNDependencies PROPERTIES IMPORTED_LOCATION "' + sdk + '/lib/frameworks/ReactNativeDependencies.framework/ReactNativeDependencies")',
    'add_library(GodotFabric::Host SHARED IMPORTED GLOBAL)',
    'set_target_properties(GodotFabric::Host PROPERTIES IMPORTED_LOCATION "' + sdk + '/lib/fabric_godot.dylib")',
    'set_property(TARGET GodotFabric::Host PROPERTY INTERFACE_INCLUDE_DIRECTORIES\n  ' + includes + ')',
    'set_property(TARGET GodotFabric::Host PROPERTY INTERFACE_COMPILE_DEFINITIONS\n  ' + definitions + ')',
    'set_target_properties(GodotFabric::Host PROPERTIES',
    '  INTERFACE_COMPILE_FEATURES "cxx_std_20"',
    '  INTERFACE_COMPILE_OPTIONS "-O3;-DNDEBUG;-std=gnu++20;-mmacosx-version-min=13.0"',
    '  INTERFACE_LINK_LIBRARIES "GodotFabric::Hermes;GodotFabric::RNDependencies")',
    'function(godot_fabric_configure_adapter target)',
    '  cmake_parse_arguments(GF "" "HOST_RUNTIME_DIR" "" ' + ref('ARGN') + ')',
    '  if(NOT GF_HOST_RUNTIME_DIR OR IS_ABSOLUTE "' + runtime + '" OR GF_HOST_RUNTIME_DIR MATCHES "[;$]")',
    '    message(FATAL_ERROR "Provide HOST_RUNTIME_DIR relative to the deployed adapter library; never the development SDK")',
    '  endif()',
    '  target_link_libraries(' + target + ' PRIVATE GodotFabric::Host)',
    '  target_link_options(' + target + ' PRIVATE "LINKER:-undefined,error")',
    '  set_target_properties(' + target + ' PROPERTIES POSITION_INDEPENDENT_CODE ON',
    '    BUILD_WITH_INSTALL_RPATH TRUE INSTALL_RPATH_USE_LINK_PATH FALSE',
    '    INSTALL_RPATH "@loader_path/' + runtime + ';@loader_path/' + runtime + '/frameworks")',
    'endfunction()',
    '# Godot ' + lock.godot.version + '; RN ' + lock['react-native'].version + '; check native-combination.json before loading.',
    '',
  ].join('\n');
}

export function packageNativeSdk(options) {
  const root = fs.realpathSync(options.root ?? project);
  const buildDir = fs.realpathSync(options.buildDir);
  const out = path.resolve(options.out);
  const buildRoot = path.resolve(root, 'build');
  if (exists(out)) fail('SDK_OUTPUT_EXISTS', 'preserve the existing SDK output');
  if (out === buildRoot || !inside(buildRoot, out)) fail('SDK_PATH', 'SDK output must be a new child under build/');
  let ancestor = path.dirname(out);
  while (!exists(ancestor)) ancestor = path.dirname(ancestor);
  const projected = path.join(fs.realpathSync(ancestor), path.relative(ancestor, out));
  if (!inside(buildRoot, projected)) fail('SDK_PATH', 'output resolves outside the build directory');
  const receipt = readJson(path.join(buildDir, 'native-sdk-build.json'));
  const current = snapshot(options);
  if (receipt.format !== receiptFormat || !same(receipt.inputs, current)
    || receipt.nativeHostBuildRecorded !== !options.fixture)
    fail('SDK_STALE_BUILD', 'shared host receipt does not match current inputs');
  const host = path.join(root, receipt.host.source);
  if (!inside(root, fs.realpathSync(host)) || fileHash(host) !== receipt.host.sha256)
    fail('SDK_STALE_BINARY', 'shared host binary changed after the build receipt');
  const lock = readJson(path.join(root, 'dependencies.json'));
  fs.mkdirSync(path.dirname(out), {recursive: true});
  try { fs.mkdirSync(out); }
  catch (error) { if (error.code === 'EEXIST') fail('SDK_OUTPUT_EXISTS', 'another publisher owns this output'); throw error; }
  try {
    for (const tree of headerTrees(root, buildDir, lock)) {
      const destination = path.join(out, tree.destination);
      if (tree.publicFiles) {
        fs.mkdirSync(destination, {recursive: true});
        for (const name of tree.publicFiles) fs.copyFileSync(path.join(tree.source, name), path.join(destination, name));
      } else fs.cpSync(tree.source, destination, {recursive: true, verbatimSymlinks: true,
        filter: filename => fs.lstatSync(filename).isDirectory() || fs.lstatSync(filename).isSymbolicLink()
          || headerPattern.test(filename)});
    }
    fs.mkdirSync(path.join(out, 'lib/frameworks'), {recursive: true});
    fs.copyFileSync(host, path.join(out, 'lib/fabric_godot.dylib'));
    for (const library of sharedLibraries(root, lock))
      fs.cpSync(library.source, path.join(out, 'lib/frameworks', path.basename(library.source)),
        {recursive: true, verbatimSymlinks: true});
    fs.mkdirSync(path.join(out, 'cmake'));
    fs.writeFileSync(path.join(out, 'cmake/GodotFabricNativeSDKConfig.cmake'), cmakeConfig(current, lock));
    fs.mkdirSync(path.join(out, 'licenses'));
    for (const [name, source] of [['SDK', 'LICENSE'], ['ReactNative', '.deps/' + lock['react-native'].directory + '/LICENSE'],
      ['Hermes', '.deps/' + lock.hermes.directory + '/LICENSE'],
      ['GodotCpp', '.deps/' + lock['godot-cpp'].directory + '/LICENSE.md'],
      ['Wslay', '.deps/' + lock.wslay.directory + '/COPYING']])
      fs.copyFileSync(path.join(root, source), path.join(out, 'licenses/' + name + '-LICENSE'));
    fs.copyFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), path.join(out, 'licenses/THIRD_PARTY_NOTICES.md'));
    const allHeaders = current.trees.map(tree => ({destination: tree.destination, files: tree.files}));
    const rnHeaders = current.trees.filter(tree => tree.name.startsWith('react-native'))
      .map(tree => ({destination: tree.destination, files: tree.files}));
    const combination = validateCombination({
      format: 'godot-fabric.experimental-native-combination/v1',
      purpose: options.fixture ? 'test-fixture' : 'build-declaration',
      sdkRevision: digest(json({sources: current.sourceSha256, upstreamSources: current.sourceTrees,
        targetFlags: current.targetFlagsSha256, host: receipt.host.sha256, compiler: current.compiler})),
      sdkHeadersSha256: digest(json(allHeaders)), reactNativeVersion: lock['react-native'].version,
      reactNativeHeadersSha256: digest(json(rnHeaders)), hermesVersion: lock.hermes.version,
      hermesRuntimeSha256: current.dependencies.find(dependency => dependency.name === 'hermes').sha256,
      godotVersion: lock.godot.version, godotCppRevision: lock['godot-cpp'].commit,
      target: current.target, toolchain: {name: current.compiler.name, version: current.compiler.version},
      nativeDependencies: [{name: 'fabric_godot', sha256: receipt.host.sha256},
        ...current.dependencies.map(dependency => ({name: dependency.name, sha256: dependency.sha256}))],
    });
    fs.writeFileSync(path.join(out, 'native-combination.json'), json(combination));
    fs.writeFileSync(path.join(out, 'receipt.json'), json({format, nativeHostBuildRecorded: receipt.nativeHostBuildRecorded,
      hostSha256: receipt.host.sha256, buildReceiptSha256: fileHash(path.join(buildDir, 'native-sdk-build.json')),
      sourceSha256: current.sourceSha256, upstreamSourceTreesSha256: digest(json(current.sourceTrees)),
      targetFlagsSha256: current.targetFlagsSha256, compiler: current.compiler, node: current.node,
      omittedIncludes: current.omittedIncludes, headerTreesSha256: digest(json(allHeaders)), ...claims}));
    if (!same(current, snapshot(options)) || fileHash(host) !== receipt.host.sha256)
      fail('SDK_INPUTS_CHANGED', 'inputs changed during SDK publication');
    const files = treeRecords(out);
    const manifest = {format, target: current.target, combinationSha256: fileHash(path.join(out, 'native-combination.json')),
      files, ...claims};
    fs.writeFileSync(path.join(out, 'manifest.json'), json(manifest), {flag: 'wx'});
    return manifest;
  } catch (error) {
    fs.writeFileSync(path.join(out, 'failure.json'), json({code: error.code ?? 'SDK_FAILURE', message: error.message}));
    throw error;
  }
}

export function verifyNativeSdk(directory) {
  const root = fs.realpathSync(directory);
  const manifest = readJson(path.join(root, 'manifest.json'));
  if (!Object.entries(claims).every(([name, value]) => manifest[name] === value))
    fail('SDK_PACKAGE_STALE', 'unsupported execution/ABI claims in a build-only package');
  if (manifest.format !== format || !same(manifest.files,
    treeRecords(root).filter(entry => entry.path !== 'manifest.json')))
    fail('SDK_PACKAGE_STALE', 'SDK files no longer match the manifest');
  const combination = validateCombination(readJson(path.join(root, 'native-combination.json')));
  if (!same(manifest.target, combination.target)
    || fileHash(path.join(root, 'native-combination.json')) !== manifest.combinationSha256)
    fail('SDK_PACKAGE_STALE', 'native combination changed');
  return manifest;
}

function cli() {
  const [command, ...args] = process.argv.slice(2);
  const values = {};
  const allowed = {capture: ['--build-dir'], record: ['--build-dir', '--host'],
    pack: ['--build-dir', '--out'], verify: ['--sdk']}[command];
  if (!allowed) fail('SDK_ARGUMENT', 'expected capture|record|pack|verify');
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.includes(args[i]) || !args[i + 1] || values[args[i]])
      fail('SDK_ARGUMENT', 'use capture|record|pack|verify with explicit paths');
    values[args[i]] = path.resolve(args[i + 1]);
  }
  const options = {buildDir: values['--build-dir'], host: values['--host'], out: values['--out']};
  let result;
  if (command === 'capture' && options.buildDir) result = captureBuildInputs(options);
  else if (command === 'record' && options.buildDir && options.host) result = recordNativeBuild(options);
  else if (command === 'pack' && options.buildDir && options.out) result = packageNativeSdk(options);
  else if (command === 'verify' && values['--sdk']) result = verifyNativeSdk(values['--sdk']);
  else fail('SDK_ARGUMENT', 'expected capture/record --build-dir; pack --build-dir --out; verify --sdk');
  console.log(JSON.stringify({command, format: result.format, target: result.target ?? result.inputs?.target, ...claims}));
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try { cli(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
