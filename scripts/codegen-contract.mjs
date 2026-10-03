// Experimental input profile for the standalone Codegen spike, not an SDK ABI.
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {toPascalCase} = require('@react-native/codegen/lib/generators/Utils.js');
const {generateEventStructName} = require('@react-native/codegen/lib/generators/components/CppHelpers.js');
export const SCHEMA_PROFILE = 'godot-fabric.experimental-common-cxx/v1';
const COMBINATION_FORMAT = 'godot-fabric.experimental-native-combination/v1';
export const CODEGEN_VERSION = '0.87.1';
const RESERVED = new Set(('alignas alignof and and_eq asm atomic_cancel atomic_commit atomic_noexcept auto '
  + 'bitand bitor bool break case catch char char8_t char16_t char32_t class compl concept const consteval '
  + 'constexpr constinit const_cast continue co_await co_return co_yield decltype default delete do double '
  + 'dynamic_cast else enum explicit export extern false float for friend goto if inline int long mutable '
  + 'namespace new noexcept not not_eq nullptr operator or or_eq private protected public reflexpr register '
  + 'reinterpret_cast requires return short signed sizeof static static_assert static_cast struct switch '
  + 'synchronized template this thread_local throw true try typedef typeid typename union unsigned using '
  + 'virtual void volatile wchar_t while xor xor_eq arguments await debugger eval extends finally function '
  + 'implements import in instanceof interface let package super var with yield __proto__').split(' '));
// Types brought into facebook::react by the original common C++ generators.
// This bounded list is not a registry of every external adapter's symbols.
const CORE_SYMBOLS = ['Props', 'ViewProps', 'RawProps', 'PropsParserContext', 'YogaStylableProps',
  'EventEmitter', 'ViewEventEmitter', 'ShadowNode', 'ViewShadowNode', 'LayoutableShadowNode',
  'ConcreteViewShadowNode', 'State', 'StateData', 'ConcreteState', 'ComponentDescriptor',
  'ConcreteComponentDescriptor', 'ComponentDescriptorProviderRegistry', 'TurboModule', 'CallInvoker'];

export class CodegenError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'CodegenError';
    this.code = code;
  }
}

export function reject(code, message) {
  throw new CodegenError(code, message);
}

function object(value, where, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    reject('UNSUPPORTED_SCHEMA', `${where} must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) reject('UNSUPPORTED_SCHEMA', `${where}.${key} is outside ${SCHEMA_PROFILE}`);
  }
}

function identifier(value, where) {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    reject('UNSUPPORTED_SCHEMA', `${where} must be a C++/JS identifier`);
  }
  if (RESERVED.has(value)) reject('UNSUPPORTED_SCHEMA', `${where}: reserved C++/JS identifier ${value}`);
}

function claimSymbol(symbols, name, where) {
  if (symbols.has(name)) reject('NAME_COLLISION', `generated symbol ${name}: ${symbols.get(name)} collides with ${where}`);
  symbols.set(name, where);
}

function uniqueNames(items, where, used = new Set()) {
  if (!Array.isArray(items)) reject('UNSUPPORTED_SCHEMA', `${where} must be an array`);
  for (const item of items) {
    identifier(item?.name, `${where}.name`);
    if (used.has(item.name)) reject('NAME_COLLISION', `${where}: duplicate ${item.name}`);
    used.add(item.name);
  }
  return used;
}

function property(value, where, aliases, mode) {
  object(value, where, ['name', 'optional', 'typeAnnotation']);
  identifier(value.name, `${where}.name`);
  if (typeof value.optional !== 'boolean') reject('UNSUPPORTED_SCHEMA', `${where}.optional must be boolean`);
  if (mode === 'event-value' && value.optional) reject('UNSUPPORTED_SCHEMA', `${where}: optional event payload fields are outside this profile`);
  annotation(value.typeAnnotation, `${where}.typeAnnotation`, aliases, mode);
}

const SCALARS = new Set(['StringTypeAnnotation', 'BooleanTypeAnnotation', 'NumberTypeAnnotation',
  'Int32TypeAnnotation', 'DoubleTypeAnnotation', 'FloatTypeAnnotation']);

function annotation(value, where, aliases, mode) {
  if (!value || typeof value !== 'object') reject('UNSUPPORTED_SCHEMA', `${where} must be a type annotation`);
  if (SCALARS.has(value.type)) {
    if (['prop', 'event-value'].includes(mode) && value.type === 'NumberTypeAnnotation') reject('UNSUPPORTED_SCHEMA', `${where}: component numbers need an explicit RN numeric annotation`);
    object(value, where, mode === 'prop' ? ['type', 'default'] : ['type']);
    if (mode === 'prop') {
      if (!Object.hasOwn(value, 'default')) reject('UNSUPPORTED_SCHEMA', `${where} needs an explicit upstream default`);
      const expected = value.type === 'StringTypeAnnotation' ? 'string'
        : value.type === 'BooleanTypeAnnotation' ? 'boolean' : 'number';
      if (typeof value.default !== expected || (expected === 'number' && !Number.isFinite(value.default))) {
        reject('UNSUPPORTED_SCHEMA', `${where}.default must be ${expected}`);
      }
      if (value.type === 'Int32TypeAnnotation' && (!Number.isInteger(value.default)
        || value.default < -2147483648 || value.default > 2147483647)) {
        reject('UNSUPPORTED_SCHEMA', `${where}.default must be int32`);
      }
      // The pinned CppHelpers interpolates string defaults without escaping.
      // Reject values it would change or render as invalid C++ source.
      if (expected === 'string' && (!value.default.isWellFormed()
        || value.default.includes(String.fromCharCode(34))
        || value.default.includes(String.fromCharCode(92))
        || [...value.default].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))) {
        reject('UNSUPPORTED_SCHEMA', `${where}.default cannot be emitted faithfully by the original unescaped C++ string generator`);
      }
      if (value.type === 'FloatTypeAnnotation' && !Number.isFinite(Math.fround(value.default))) {
        reject('UNSUPPORTED_SCHEMA', `${where}.default exceeds finite float32 range`);
      }
    }
    return;
  }
  if (mode === 'prop' || mode === 'command-param') {
    reject('UNSUPPORTED_SCHEMA', `${where}: ${value.type} is outside the experimental primitive prop/command profile`);
  }
  if (mode === 'event-value' && !['ArrayTypeAnnotation', 'ObjectTypeAnnotation'].includes(value.type)) {
    reject('UNSUPPORTED_SCHEMA', `${where}: ${value.type} is outside the component event payload profile`);
  }
  switch (value.type) {
    case 'VoidTypeAnnotation':
      object(value, where, ['type']);
      if (!['return', 'emitter-payload'].includes(mode)) reject('UNSUPPORTED_SCHEMA', `${where}: void is not a value`);
      return;
    case 'TypeAliasTypeAnnotation':
      object(value, where, ['type', 'name']);
      if (!Object.hasOwn(aliases, value.name)) reject('UNSUPPORTED_SCHEMA', `${where}: missing alias ${value.name}`);
      return;
    case 'NullableTypeAnnotation':
      object(value, where, ['type', 'typeAnnotation']);
      annotation(value.typeAnnotation, `${where}.typeAnnotation`, aliases, mode);
      return;
    case 'ArrayTypeAnnotation':
      object(value, where, ['type', 'elementType']);
      annotation(value.elementType, `${where}.elementType`, aliases, mode === 'event-value' ? mode : 'value');
      return;
    case 'ObjectTypeAnnotation':
      object(value, where, ['type', 'properties']);
      uniqueNames(value.properties, `${where}.properties`);
      value.properties.forEach((entry, i) => property(entry, `${where}.properties[${i}]`, aliases, mode === 'event-value' ? mode : 'value'));
      return;
    case 'PromiseTypeAnnotation':
      object(value, where, ['type', 'elementType']);
      if (mode !== 'return') reject('UNSUPPORTED_SCHEMA', `${where}: promises are only method returns`);
      annotation(value.elementType, `${where}.elementType`, aliases, 'value');
      return;
    default:
      reject('UNSUPPORTED_SCHEMA', `${where}: unsupported type ${String(value.type)}`);
  }
}

function method(value, where, aliases, command = false) {
  object(value, where, ['name', 'optional', 'typeAnnotation']);
  if (value.optional !== false) reject('UNSUPPORTED_SCHEMA', `${where}: optional methods/commands are outside this profile`);
  const type = value.typeAnnotation;
  object(type, `${where}.typeAnnotation`, ['type', 'params', 'returnTypeAnnotation']);
  if (type.type !== 'FunctionTypeAnnotation') reject('UNSUPPORTED_SCHEMA', `${where}: expected FunctionTypeAnnotation`);
  uniqueNames(type.params, `${where}.params`);
  if (command && type.params.some(param => param.name === 'ref')) reject('UNSUPPORTED_SCHEMA', `${where}: ref is the implicit command receiver`);
  type.params.forEach((param, i) => property(param, `${where}.params[${i}]`, aliases, command ? 'command-param' : 'value'));
  annotation(type.returnTypeAnnotation, `${where}.return`, aliases, 'return');
  if (command && type.returnTypeAnnotation.type !== 'VoidTypeAnnotation') {
    reject('UNSUPPORTED_SCHEMA', `${where}: native commands must return void`);
  }
}

export function validateSchema(schema) {
  object(schema, 'schema', ['modules']);
  object(schema.modules, 'schema.modules', Object.keys(schema.modules ?? {}));
  if (Object.keys(schema.modules).length === 0) reject('EMPTY_SCHEMA', 'specs generated no native modules or components');
  const publicNames = new Map();
  const nativeSymbols = new Map(CORE_SYMBOLS.map(name => [name, 'pinned RN common C++ imports']));
  const register = (name, where) => {
    identifier(name, where);
    if (publicNames.has(name)) reject('NAME_COLLISION', `${name} is declared by ${publicNames.get(name)} and ${where}`);
    publicNames.set(name, where);
  };
  for (const [name, module] of Object.entries(schema.modules)) {
    identifier(name, `module ${name}`);
    if (module?.type === 'NativeModule') {
      object(module, name, ['type', 'aliasMap', 'enumMap', 'spec', 'moduleName', 'excludedPlatforms']);
      // The upstream parser includes this key with undefined when no exclusion
      // was declared. Actual exclusions need a separate target-aware contract.
      if (module.excludedPlatforms !== undefined) reject('UNSUPPORTED_SCHEMA', `${name}.excludedPlatforms is outside this profile`);
      register(module.moduleName, `${name}.moduleName`);
      claimSymbol(nativeSymbols, `${name}CxxSpec`, name);
      object(module.aliasMap, `${name}.aliasMap`, Object.keys(module.aliasMap ?? {}));
      object(module.enumMap, `${name}.enumMap`, []);
      for (const [alias, type] of Object.entries(module.aliasMap)) {
        identifier(alias, `${name}.aliasMap.${alias}`);
        if (type.type !== 'ObjectTypeAnnotation') reject('UNSUPPORTED_SCHEMA', `${name}.aliasMap.${alias}: C++ struct aliases must be objects`);
        claimSymbol(nativeSymbols, `${name}${alias}`, `${name}.aliasMap.${alias}`);
        claimSymbol(nativeSymbols, `${name}${alias}Bridging`, `${name}.aliasMap.${alias}.bridging`);
        annotation(type, `${name}.aliasMap.${alias}`, module.aliasMap, 'value');
      }
      object(module.spec, `${name}.spec`, ['methods', 'eventEmitters']);
      const used = uniqueNames(module.spec.methods, `${name}.methods`);
      module.spec.methods.forEach((entry, i) => method(entry, `${name}.methods[${i}]`, module.aliasMap));
      uniqueNames(module.spec.eventEmitters, `${name}.eventEmitters`, used);
      const emittedMethods = new Map();
      module.spec.eventEmitters.forEach((entry, i) => {
        const where = `${name}.eventEmitters[${i}]`;
        object(entry, where, ['name', 'optional', 'typeAnnotation']);
        if (entry.optional !== false) reject('UNSUPPORTED_SCHEMA', `${where}: optional emitters are outside this profile`);
        claimSymbol(emittedMethods, `emit${toPascalCase(entry.name)}`, where);
        object(entry.typeAnnotation, where, ['type', 'typeAnnotation']);
        if (entry.typeAnnotation.type !== 'EventEmitterTypeAnnotation') reject('UNSUPPORTED_SCHEMA', `${where}: expected EventEmitterTypeAnnotation`);
        annotation(entry.typeAnnotation.typeAnnotation, `${where}.payload`, module.aliasMap, 'emitter-payload');
      });
    } else if (module?.type === 'Component') {
      object(module, name, ['type', 'components']);
      object(module.components, `${name}.components`, Object.keys(module.components ?? {}));
      if (Object.keys(module.components).length === 0) reject('EMPTY_SCHEMA', `${name} declares no components`);
      for (const [componentName, component] of Object.entries(module.components)) {
        const where = `${name}.${componentName}`;
        register(componentName, where);
        for (const suffix of ['Props', 'State', 'EventEmitter', 'ShadowNode', 'ComponentDescriptor', 'ComponentName']) {
          claimSymbol(nativeSymbols, `${componentName}${suffix}`, `${where}.${suffix}`);
        }
        object(component, where, ['extendsProps', 'events', 'props', 'commands']);
        if (!Array.isArray(component.extendsProps) || component.extendsProps.length !== 1) {
          reject('UNSUPPORTED_SCHEMA', `${where} must extend only ReactNativeCoreViewProps`);
        }
        const base = component.extendsProps[0];
        object(base, `${where}.extendsProps[0]`, ['type', 'knownTypeName']);
        if (base.type !== 'ReactNativeBuiltInType' || base.knownTypeName !== 'ReactNativeCoreViewProps') {
          reject('UNSUPPORTED_SCHEMA', `${where} must extend ReactNativeCoreViewProps`);
        }
        const used = uniqueNames(component.props, `${where}.props`);
        component.props.forEach((entry, i) => property(entry, `${where}.props[${i}]`, {}, 'prop'));
        uniqueNames(component.events, `${where}.events`, used);
        const eventSymbols = new Map(component.events.map(event => [event.name, `${where}.${event.name}.method`]));
        const wireNames = new Map();
        const reserveEventStructs = (type, parts, location) => {
          if (type.type === 'ArrayTypeAnnotation') return reserveEventStructs(type.elementType, parts, `${location}[]`);
          if (type.type !== 'ObjectTypeAnnotation') return;
          claimSymbol(eventSymbols, generateEventStructName(parts), location);
          for (const entry of type.properties) reserveEventStructs(entry.typeAnnotation, [...parts, entry.name], `${location}.${entry.name}`);
        };
        component.events.forEach((event, i) => {
          const location = `${where}.events[${i}]`;
          object(event, location, ['name', 'optional', 'bubblingType', 'typeAnnotation']);
          if (typeof event.optional !== 'boolean' || !['direct', 'bubble'].includes(event.bubblingType)) {
            reject('UNSUPPORTED_SCHEMA', `${location}: unsupported event declaration`);
          }
          // EventEmitterCpp strips the leading "on" before dispatch; a different
          // prefix would disagree with the original ViewConfig wire name.
          if (!/^on[A-Z][A-Za-z0-9_]*$/.test(event.name)) reject('UNSUPPORTED_SCHEMA', `${location}: component event names must use on + uppercase suffix`);
          object(event.typeAnnotation, location, ['type', 'argument']);
          if (event.typeAnnotation.type !== 'EventTypeAnnotation') reject('UNSUPPORTED_SCHEMA', `${location}: expected EventTypeAnnotation`);
          // Match the pinned original ViewConfig generator's wire normalization.
          const wireName = event.name.startsWith('on') ? event.name.replace(/^on/, 'top')
            : event.name.startsWith('top') ? event.name : `top${toPascalCase(event.name)}`;
          claimSymbol(wireNames, wireName, location);
          if (event.typeAnnotation.argument !== null) {
            if (event.typeAnnotation.argument.type !== 'ObjectTypeAnnotation') reject('UNSUPPORTED_SCHEMA', `${location}: event payload must be an object or null`);
            annotation(event.typeAnnotation.argument, `${location}.argument`, {}, 'event-value');
            reserveEventStructs(event.typeAnnotation.argument, [event.name], `${location}.argument`);
          }
        });
        uniqueNames(component.commands, `${where}.commands`, used);
        component.commands.forEach((entry, i) => method(entry, `${where}.commands[${i}]`, {}, true));
      }
    } else {
      reject('UNSUPPORTED_SCHEMA', `${name}: unsupported module type ${String(module?.type)}`);
    }
  }
}

export function validateCombination(value) {
  const keys = ['format', 'purpose', 'sdkRevision', 'sdkHeadersSha256', 'reactNativeVersion',
    'reactNativeHeadersSha256', 'hermesVersion', 'hermesRuntimeSha256', 'godotVersion',
    'godotCppRevision', 'target', 'toolchain', 'nativeDependencies'];
  try {
    object(value, 'native combination', keys);
    if (value.format !== COMBINATION_FORMAT || !['build-declaration', 'test-fixture'].includes(value.purpose)) {
      reject('NATIVE_COMBINATION_INVALID', 'expected an explicitly experimental native combination declaration');
    }
    for (const key of keys.filter(key => !['target', 'toolchain', 'nativeDependencies'].includes(key))) {
      if (typeof value[key] !== 'string' || value[key].length === 0) reject('NATIVE_COMBINATION_INVALID', `missing ${key}`);
    }
    if (value.reactNativeVersion !== CODEGEN_VERSION) {
      reject('NATIVE_COMBINATION_MISMATCH', `RN ${value.reactNativeVersion} does not match Codegen ${CODEGEN_VERSION}`);
    }
    for (const key of ['sdkHeadersSha256', 'reactNativeHeadersSha256', 'hermesRuntimeSha256']) {
      if (!/^[a-f0-9]{64}$/.test(value[key])) reject('NATIVE_COMBINATION_INVALID', `${key} must be SHA-256`);
    }
    for (const [key, required] of [['target', ['platform', 'architecture', 'configuration', 'minimumOS']],
      ['toolchain', ['name', 'version']]]) {
      object(value[key], `native combination.${key}`, required);
      for (const field of required) {
        if (typeof value[key][field] !== 'string' || !value[key][field]) reject('NATIVE_COMBINATION_INVALID', `missing ${key}.${field}`);
      }
    }
    if (!Array.isArray(value.nativeDependencies)) reject('NATIVE_COMBINATION_INVALID', 'nativeDependencies must be an array');
    const names = new Set();
    for (const dependency of value.nativeDependencies) {
      object(dependency, 'native dependency', ['name', 'sha256']);
      if (typeof dependency.name !== 'string' || !dependency.name || names.has(dependency.name)
        || !/^[a-f0-9]{64}$/.test(dependency.sha256)) reject('NATIVE_COMBINATION_INVALID', 'invalid or duplicate native dependency');
      names.add(dependency.name);
    }
  } catch (error) {
    if (error.code === 'UNSUPPORTED_SCHEMA') reject('NATIVE_COMBINATION_INVALID', error.message);
    throw error;
  }
  return value;
}
