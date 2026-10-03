// Read-only build preflight. This never loads a native library or project JS.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const ADAPTER_FORMAT = 'godot-fabric.experimental-adapter/v1';
export const ADAPTER_ENTRY_POINT = 'godot_fabric_adapter_init_v1';
const CODEGEN_FORMAT = 'godot-fabric.experimental-codegen/v1';
const SCHEMA_PROFILE = 'godot-fabric.experimental-common-cxx/v1';
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const json = value => `${JSON.stringify(canonical(value), null, 2)}\n`;

export class AdapterManifestError extends Error {
  constructor(code, message, cause) {
    super(`${code}: ${message}`, cause ? {cause} : undefined);
    this.name = 'AdapterManifestError';
    this.code = code;
  }
}
const fail = (code, message, cause) => { throw new AdapterManifestError(code, message, cause); };

function exact(value, keys, where) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail('ADAPTER_MANIFEST_INVALID', `${where} must be a JSON object`);
  }
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) {
    fail('ADAPTER_MANIFEST_INVALID', `${where} requires exactly ${keys.join(', ')}`);
  }
}

function identifier(value, where) {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    fail('ADAPTER_MANIFEST_INVALID', `${where} must be an identifier`);
  }
}

function names(value, where) {
  if (!Array.isArray(value)) fail('ADAPTER_MANIFEST_INVALID', `${where} must be an array`);
  value.forEach(name => identifier(name, where));
  if (new Set(value).size !== value.length) fail('ADAPTER_NAME_COLLISION', `${where} contains duplicates`);
}

function safeRelative(value, where) {
  if (typeof value !== 'string' || !value || !value.isWellFormed()
    || /[\\:\x00-\x1f\x7f]/.test(value) || path.posix.isAbsolute(value)
    || value.split('/').some(part => !part || part === '.' || part === '..')) {
    fail('ADAPTER_UNSAFE_PATH', `${where} must be a safe package-relative POSIX path`);
  }
  return value;
}

function inside(root, absolute) {
  const relative = path.relative(root, absolute);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

function regular(root, base, relative, where) {
  safeRelative(relative, where);
  try {
    const real = fs.realpathSync(path.join(base, relative));
    if (!inside(root, real)) fail('ADAPTER_UNSAFE_PATH', `${where} escapes the package after realpath`);
    if (!fs.statSync(real).isFile()) fail('ADAPTER_UNSAFE_PATH', `${where} is not a regular file`);
    return real;
  } catch (error) {
    if (error instanceof AdapterManifestError) throw error;
    fail('ADAPTER_FILE_MISSING', `${where}: ${error.code || error.message}`, error);
  }
}

function readJson(filename, where) {
  try {
    const bytes = fs.readFileSync(filename), text = bytes.toString('utf8');
    if (!Buffer.from(text).equals(bytes)) fail('ADAPTER_MANIFEST_INVALID', `${where} is not valid UTF-8`);
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof AdapterManifestError) throw error;
    fail('ADAPTER_MANIFEST_INVALID', `${where}: ${error.message}`, error);
  }
}

function hashedFile(root, base, reference, where, generator = false) {
  exact(reference, generator ? ['path', 'sha256', 'generator'] : ['path', 'sha256'], where);
  if (typeof reference.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(reference.sha256)) {
    fail('ADAPTER_MANIFEST_INVALID', `${where}.sha256 must be lowercase SHA-256`);
  }
  const real = regular(root, base, reference.path, `${where}.path`);
  if (sha256(fs.readFileSync(real)) !== reference.sha256) fail('ADAPTER_HASH_MISMATCH', `${where}: file bytes differ`);
  return real;
}

// Mirror the pinned RN componentNameByReactViewName.cpp, including its single
// RCT-prefix removal. Fabric aliases are not a general "Fabric" prefix rule.
export function normalizeComponentName(name) {
  identifier(name, 'component name');
  const raw = name.startsWith('RCT') ? name.slice(3) : name;
  const aliases = {Text: 'Paragraph', SelectableText: 'SelectableParagraph', VirtualText: 'Text',
    ImageView: 'Image', AndroidHorizontalScrollView: 'ScrollView', RKShimmeringView: 'ShimmeringView',
    RefreshControl: 'PullToRefreshView', ScrollContentView: 'View',
    MultilineTextInputView: 'TextInput', SinglelineTextInputView: 'TextInput'};
  return Object.hasOwn(aliases, raw) ? aliases[raw] : raw;
}

// Pinned RN core names remain reserved even where Godot has not ported them.
const CORE_COMPONENTS = ['RootView', 'View', 'Paragraph', 'Text', 'RawText', 'TextEffect', 'ScrollView',
  'Image', 'TextInput', 'AndroidTextInput', 'SafeAreaView', 'InputAccessoryView', 'ModalHostView',
  'AndroidProgressBar', 'AndroidSwitch', 'Switch', 'ActivityIndicatorView', 'VirtualView',
  'LayoutConformance', 'UnimplementedView', 'LegacyViewManagerInterop',
  'LegacyViewManagerAndroidInterop', 'AndroidHorizontalScrollContentView', 'SelectableParagraph',
  'ShimmeringView', 'PullToRefreshView', 'GodotControl', 'Button', 'Pressable', 'ActivityIndicator', 'Modal'];
const CORE_MODULES = ('AccessibilityInfo AccessibilityManager ActionSheetManager AlertManager AppState Appearance '
  + 'BlobModule CPUTimeCxx Clipboard DevLoadingView DevMenu DevSettings DeviceEventManager DeviceInfo '
  + 'DialogManagerAndroid ExceptionsManager FileReaderModule FrameRateLogger HeadlessJsTaskSupport I18nManager '
  + 'ImageEditingManager ImageLoader ImageStoreManager IntentAndroid JSCHeapCapture KeyboardObserver LinkingManager '
  + 'LogBox ModalManager NativeAnimatedModule NativeAnimatedTurboModule NativeDOMCxx NativeFantomCxx '
  + 'NativeFantomTestSpecificMethodsCxx NativeIdleCallbacksCxx NativeIntersectionObserverCxx NativeMicrotasksCxx '
  + 'NativeMutationObserverCxx NativePerformanceCxx NativeReactNativeFeatureFlagsCxx NativeViewTransitionCxx '
  + 'Networking PermissionsAndroid PlatformConstants PushNotificationManager ReactDevToolsRuntimeSettingsModule '
  + 'ReactDevToolsSettingsManager RedBox SampleTurboModule SegmentFetcher SettingsManager ShareModule SoundManager '
  + 'SourceCode StatusBarManager Timing ToastAndroid Vibration WebSocketModule GodotFabricServices '
  + 'GodotFabricNativeFixture').split(' ');

function reserveAndOrder(records, extraComponents, extraModules) {
  names(extraComponents, 'reservedComponents'); names(extraModules, 'reservedModules');
  const byId = new Map(), publicNames = new Map();
  const components = new Map([...CORE_COMPONENTS, ...extraComponents]
    .flatMap(name => [[name, 'host core'], [normalizeComponentName(name), 'host core']]));
  const modules = new Map([...CORE_MODULES, ...extraModules].map(name => [name, 'host core']));
  const claim = (map, name, owner) => {
    if (map.has(name)) fail('ADAPTER_NAME_COLLISION', `${owner}: ${name} collides with ${map.get(name)}`);
    map.set(name, owner);
  };
  for (const record of records) {
    const {id} = record.manifest;
    if (byId.has(id)) fail('ADAPTER_NAME_COLLISION', `duplicate adapter ID ${id}`);
    byId.set(id, record);
    for (const name of record.manifest.components) {
      const normalized = normalizeComponentName(name);
      if (!normalized) fail('ADAPTER_MANIFEST_INVALID', `${id}: empty normalized component name`);
      claim(publicNames, name, id);
      claim(components, normalized, id);
      if (name !== normalized) claim(components, name, id);
    }
    for (const name of record.manifest.modules) {
      claim(publicNames, name, id); claim(modules, name, id);
    }
  }
  const ordered = [], visiting = new Set(), visited = new Set();
  function visit(id) {
    if (visiting.has(id)) fail('ADAPTER_DEPENDENCY_CYCLE', `dependency cycle at ${id}`);
    if (visited.has(id)) return;
    const record = byId.get(id);
    if (!record) fail('ADAPTER_DEPENDENCY_MISSING', `missing adapter dependency ${id}`);
    visiting.add(id);
    [...record.manifest.dependsOn].sort().forEach(visit);
    visiting.delete(id); visited.add(id); ordered.push(record);
  }
  [...byId.keys()].sort().forEach(visit);
  return ordered;
}

function generatedTree(root, directory) {
  for (const entry of fs.readdirSync(directory)) {
    const filename = path.join(directory, entry), stat = fs.lstatSync(filename);
    // Original verify rejects non-regular output entries; reject before it
    // could read a schema/artifact through a link outside the package.
    if ((!stat.isFile() && !stat.isDirectory()) || !inside(root, fs.realpathSync(filename))) {
      fail('ADAPTER_UNSAFE_PATH', 'generated output contains a link or non-regular entry');
    }
    if (stat.isDirectory()) generatedTree(root, filename);
  }
}

async function codegenTools() {
  try {
    const [contract, codegen] = await Promise.all([import('./codegen-contract.mjs'), import('./codegen.mjs')]);
    return {...contract, verifyCodegen: codegen.verifyCodegen};
  } catch (error) {
    fail('ADAPTER_TOOL_UNAVAILABLE', 'the SDK needs its pinned Codegen/profile/parser dependencies; project tools are never executed', error);
  }
}

/**
 * adapters: [{packageRoot: absolute directory, manifestPath: 'adapter.json'}].
 * sources[].path is packageRoot-relative; generated paths are relative to the
 * directory containing codegenManifest.path, which must end in manifest.json.
 * nativeCombination is the caller's current SDK/target declaration, never one
 * selected by the adapter. Results are dependency-first and do not attest ABI.
 */
export async function preflightAdapters({adapters, nativeCombination,
  reservedComponents = [], reservedModules = []}) {
  if (!Array.isArray(adapters)) fail('ADAPTER_MANIFEST_INVALID', 'adapters must be an array');
  const tools = await codegenTools();
  try { tools.validateCombination(nativeCombination); }
  catch (error) { fail('ADAPTER_COMBINATION_INVALID', 'the caller must supply a valid current native combination', error); }
  const records = adapters.map(input => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      fail('ADAPTER_MANIFEST_INVALID', 'adapter inputs require packageRoot and optional manifestPath');
    }
    const {packageRoot, manifestPath = 'adapter.json'} = input;
    let root;
    try {
      root = fs.realpathSync(packageRoot);
      if (!fs.statSync(root).isDirectory()) throw new Error('not a directory');
    } catch (error) { fail('ADAPTER_UNSAFE_PATH', 'packageRoot must resolve to an existing package directory', error); }
    const manifestFile = regular(root, root, manifestPath, 'adapter manifest');
    const manifest = readJson(manifestFile, 'adapter manifest');
    exact(manifest, ['format', 'id', 'entryPoint', 'library', 'nativeCombination', 'codegenManifest',
      'components', 'modules', 'dependsOn'], 'adapter manifest');
    identifier(manifest.id, 'adapter.id');
    if (manifest.format !== ADAPTER_FORMAT || manifest.entryPoint !== ADAPTER_ENTRY_POINT) {
      fail('ADAPTER_MANIFEST_INVALID', 'unsupported adapter format or entryPoint');
    }
    names(manifest.components, `${manifest.id}.components`); names(manifest.modules, `${manifest.id}.modules`);
    names(manifest.dependsOn, `${manifest.id}.dependsOn`);
    if (!manifest.components.length && !manifest.modules.length) fail('ADAPTER_MANIFEST_INVALID', 'adapter declares no components or modules');
    try { tools.validateCombination(manifest.nativeCombination); }
    catch (error) { fail('ADAPTER_COMBINATION_INVALID', `${manifest.id}: invalid native combination`, error); }
    if (json(manifest.nativeCombination) !== json(nativeCombination)) {
      fail('ADAPTER_COMBINATION_MISMATCH', `${manifest.id}: current SDK/target differs`);
    }
    return {packageRoot: root, manifestPath: manifestFile, manifest};
  });
  const ordered = reserveAndOrder(records, reservedComponents, reservedModules);
  // This first native SPI registers the original generated descriptor name.
  // Requests may use RN aliases, but aliases cannot themselves be declared
  // providers until there is an explicit descriptor/handle alias strategy.
  for (const {manifest} of ordered) {
    for (const name of manifest.components) {
      if (normalizeComponentName(name) !== name) {
        fail('ADAPTER_COMPONENT_NAME_UNSUPPORTED', `${manifest.id}: declare the canonical descriptor name instead of ${name}`);
      }
    }
  }
  const schemas = {modules: Object.create(null)};
  for (const record of ordered) {
    const {packageRoot: root, manifest} = record;
    record.libraryPath = hashedFile(root, root, manifest.library, `${manifest.id}.library`);
    const codegenFile = hashedFile(root, root, manifest.codegenManifest, `${manifest.id}.codegenManifest`);
    if (path.basename(codegenFile) !== 'manifest.json') fail('ADAPTER_MANIFEST_INVALID', 'codegenManifest must be the original manifest.json');
    const generated = path.dirname(codegenFile);
    generatedTree(root, generated);
    const recorded = readJson(codegenFile, 'Codegen manifest');
    exact(recorded, ['format', 'schemaProfile', 'libraryName', 'nativeCombination', 'tools', 'sources',
      'schema', 'artifacts', 'claims'], 'Codegen manifest');
    if (recorded.format !== CODEGEN_FORMAT || recorded.schemaProfile !== SCHEMA_PROFILE) {
      fail('ADAPTER_CODEGEN_PROFILE', 'unsupported original Codegen manifest/profile');
    }
    exact(recorded.nativeCombination, ['declaration', 'sha256'], 'Codegen nativeCombination');
    if (json(recorded.nativeCombination.declaration) !== json(nativeCombination)
      || recorded.nativeCombination.sha256 !== sha256(json(nativeCombination))) {
      fail('ADAPTER_COMBINATION_MISMATCH', `${manifest.id}: generated native combination differs`);
    }
    exact(recorded.claims, ['nativeCompiled', 'nativeLoaded', 'runtimeExecuted', 'abiCertified'], 'Codegen claims');
    if (Object.values(recorded.claims).some(claim => claim !== false)) {
      fail('ADAPTER_CODEGEN_CLAIM', 'original Codegen does not attest native compilation, loading, runtime or ABI');
    }
    if (!Array.isArray(recorded.sources) || !recorded.sources.length || !Array.isArray(recorded.artifacts)) {
      fail('ADAPTER_MANIFEST_INVALID', 'Codegen requires source and artifact arrays');
    }
    recorded.sources.forEach(source => hashedFile(root, root, source, 'Codegen source'));
    const schemaFile = hashedFile(root, generated, recorded.schema, 'Codegen schema');
    recorded.artifacts.forEach(artifact => hashedFile(root, generated, artifact, 'Codegen artifact', true));
    const schema = readJson(schemaFile, 'Codegen schema');
    try {
      tools.validateSchema(schema);
      tools.verifyCodegen({root, specs: recorded.sources.map(source => source.path),
        libraryName: recorded.libraryName, nativeCombination, out: generated});
    } catch (error) {
      fail('ADAPTER_CODEGEN_PROVENANCE', `${manifest.id}: original Codegen verification failed (${error.code || error.message}); Node, SDK lock, wrappers and parser identities must match`, error);
    }
    const declaredComponents = [], declaredModules = [];
    for (const [key, module] of Object.entries(schema.modules)) {
      if (Object.hasOwn(schemas.modules, key)) fail('ADAPTER_NAME_COLLISION', `generated schema module ${key} collides`);
      schemas.modules[key] = module;
      if (module.type === 'Component') declaredComponents.push(...Object.keys(module.components));
      else declaredModules.push(module.moduleName);
    }
    if (json([...manifest.components].sort()) !== json(declaredComponents.sort())
      || json([...manifest.modules].sort()) !== json(declaredModules.sort())) {
      fail('ADAPTER_SCHEMA_NAMES', `${manifest.id}: envelope names do not exactly match generated schema names`);
    }
    record.codegenManifestPath = codegenFile;
    record.codegenManifest = recorded;
    record.validation = {codegenProvenanceVerified: true, libraryHashVerified: true,
      nativeLoaded: false, runtimeExecuted: false, abiCertified: false};
  }
  if (ordered.length) {
    try { tools.validateSchema(schemas); }
    catch (error) { fail('ADAPTER_NAME_COLLISION', 'cross-adapter generated C++ symbols collide', error); }
  }
  return ordered;
}
