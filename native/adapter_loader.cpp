#include "adapter_loader.h"
#include <folly/json.h>
#include <react/renderer/componentregistry/componentNameByReactViewName.h>
#include <jsi/JSIDynamic.h>
#include <hermes/hermes.h>
#include <godot_cpp/godot.hpp>
#include <algorithm>
#include <array>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <map>
#include <mutex>
#include <set>
#include <span>
#include <stdexcept>
#include <vector>
#if defined(__APPLE__)
#include <TargetConditionals.h>
#endif
#if defined(__APPLE__) && defined(__aarch64__) && TARGET_OS_OSX
#include <CommonCrypto/CommonDigest.h>
#include <dlfcn.h>
#include <mach-o/dyld.h>
#include <mach-o/fat.h>
#include <mach-o/loader.h>
#define FABRIC_EXTERNAL_LOADER_MACOS 1
#else
#define FABRIC_EXTERNAL_LOADER_MACOS 0
#endif

namespace fabric_godot {
namespace {
namespace fs = std::filesystem;
namespace rn = facebook::react;
using Json = folly::dynamic;
[[noreturn]] void fail(const std::string &code, const std::string &message) {
  throw std::runtime_error(code + ": " + message);
}
void exact(const Json &object, std::initializer_list<const char *> fields, const std::string &where) {
  if (!object.isObject() || object.size() != fields.size()) fail("E_ADAPTER_MANIFEST", where + " has unexpected fields");
  for (auto field : fields) if (!object.count(field)) fail("E_ADAPTER_MANIFEST", where + " is missing " + field);
}
std::string text(const Json &value, const std::string &where) {
  if (!value.isString() || value.asString().empty() || value.asString().find('\0') != std::string::npos)
    fail("E_ADAPTER_MANIFEST", where + " requires a nonempty string without NUL");
  return value.asString();
}
bool identifier(const std::string &name) {
  auto letter = [](unsigned char c) { return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '_'; };
  return !name.empty() && letter(name.front()) && std::all_of(name.begin(), name.end(),
      [&](unsigned char c) { return letter(c) || (c >= '0' && c <= '9'); });
}
std::vector<std::string> names(const Json &value, const std::string &where) {
  if (!value.isArray() || value.size() > 4096) fail("E_ADAPTER_MANIFEST", where + " requires a bounded name array");
  std::vector<std::string> result;
  std::set<std::string> used;
  for (const auto &entry : value) {
    auto name = text(entry, where);
    if (!identifier(name) || !used.insert(name).second) fail("E_ADAPTER_COLLISION", where + ": " + name);
    result.push_back(std::move(name));
  }
  return result;
}
bool sha256_string(const std::string &value) {
  return value.size() == 64 && std::all_of(value.begin(), value.end(),
      [](char c) { return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'); });
}
std::string expected_hash(const Json &value, const std::string &where) {
  auto result = text(value, where);
  if (!sha256_string(result)) fail("E_ADAPTER_MANIFEST", where + " requires lowercase SHA-256");
  return result;
}
bool inside(const fs::path &root, const fs::path &file) {
  const auto relative = file.lexically_relative(root);
  return !relative.empty() && !relative.is_absolute() && *relative.begin() != "..";
}
fs::path canonical(const std::string &value, bool directory, const std::string &where) {
  std::error_code error;
  const fs::path input(value);
  const auto real = fs::canonical(input, error);
  if (error || !input.is_absolute() || input.lexically_normal() != real ||
      (directory ? !fs::is_directory(real) : !fs::is_regular_file(real)))
    fail("E_ADAPTER_PATH", where + " must be an existing canonical filesystem " + (directory ? "directory" : "file"));
  return real;
}
std::string relative_text(const Json &value, const std::string &where) {
  const auto result = text(value, where);
  if (result.front() == '/' || result.find('\\') != std::string::npos || result.find(':') != std::string::npos ||
      std::any_of(result.begin(), result.end(), [](unsigned char c) { return c < 32 || c == 127; }))
    fail("E_ADAPTER_PATH", where + " requires a safe relative POSIX path");
  std::size_t start = 0;
  while (start < result.size()) {
    const auto end = result.find('/', start);
    const auto part = result.substr(start, end == std::string::npos ? end : end - start);
    if (part.empty() || part == "." || part == "..") fail("E_ADAPTER_PATH", where + " contains traversal");
    if (end == std::string::npos) break;
    start = end + 1;
    if (start == result.size()) fail("E_ADAPTER_PATH", where + " contains an empty segment");
  }
  return result;
}
fs::path relative_file(const fs::path &root, const fs::path &base, const Json &value, const std::string &where, bool directory = false) {
  auto path = base / relative_text(value, where);
  std::error_code error;
  auto real = fs::canonical(path, error);
  if (error || !inside(root, real) || (directory ? !fs::is_directory(real) : !fs::is_regular_file(real)))
    fail("E_ADAPTER_PATH", where + " escapes its root or is missing/not regular");
  return real;
}
std::vector<uint8_t> bytes(const fs::path &file) {
  std::error_code error;
  const auto size = fs::file_size(file, error);
  if (error || size > 256 * 1024 * 1024) fail("E_ADAPTER_FILE", "missing or oversized file " + file.string());
  std::vector<uint8_t> result(static_cast<std::size_t>(size));
  std::ifstream stream(file, std::ios::binary);
  if (!stream || (size && !stream.read(reinterpret_cast<char *>(result.data()), result.size())) || stream.peek() != EOF)
    fail("E_ADAPTER_FILE", "file changed or cannot be read " + file.string());
  return result;
}
Json parse(const std::vector<uint8_t> &input, const std::string &where) {
  if (input.size() > 16 * 1024 * 1024) fail("E_ADAPTER_MANIFEST", where + " JSON exceeds 16 MiB");
  try {
    folly::json::serialization_opts options;
    options.validate_utf8 = true;
    options.allow_nan_inf = false;
    return folly::parseJson(folly::StringPiece(reinterpret_cast<const char *>(input.data()), input.size()), options);
  } catch (const std::exception &error) { fail("E_ADAPTER_MANIFEST", where + ": " + error.what()); }
}
// The declaration contains only strings, arrays and objects. This spelling is
// the original wrapper's JSON.stringify(canonical(value), null, 2) + newline.
std::string canonical_json(const Json &value, int depth = 0) {
  const std::string indent(depth * 2, ' '), next((depth + 1) * 2, ' ');
  if (value.isObject()) {
    std::vector<std::string> keys;
    for (const auto &item : value.items()) keys.push_back(item.first.asString());
    std::sort(keys.begin(), keys.end());
    if (keys.empty()) return "{}";
    std::string result = "{\n";
    for (std::size_t index = 0; index < keys.size(); ++index)
      result += next + folly::toJson(Json(keys[index])) + ": " + canonical_json(value[keys[index]], depth + 1) +
          (index + 1 == keys.size() ? "\n" : ",\n");
    return result + indent + "}";
  }
  if (value.isArray()) {
    if (value.empty()) return "[]";
    std::string result = "[\n";
    for (std::size_t index = 0; index < value.size(); ++index)
      result += next + canonical_json(value[index], depth + 1) + (index + 1 == value.size() ? "\n" : ",\n");
    return result + indent + "]";
  }
  return folly::toJson(value);
}
std::map<std::string, std::string> combination(const Json &value) {
  exact(value, {"format", "purpose", "sdkRevision", "sdkHeadersSha256", "reactNativeVersion",
      "reactNativeHeadersSha256", "hermesVersion", "hermesRuntimeSha256", "godotVersion",
      "godotCppRevision", "target", "toolchain", "nativeDependencies"}, "native combination");
  for (auto field : {"format", "purpose", "sdkRevision", "sdkHeadersSha256", "reactNativeVersion",
      "reactNativeHeadersSha256", "hermesVersion", "hermesRuntimeSha256", "godotVersion", "godotCppRevision"})
    text(value[field], field);
  if (value["format"] != "godot-fabric.experimental-native-combination/v1" || value["purpose"] != "build-declaration" ||
      value["reactNativeVersion"] != "0.87.1") fail("E_ADAPTER_COMBINATION", "require the identified original RN build declaration");
  for (auto field : {"sdkHeadersSha256", "reactNativeHeadersSha256", "hermesRuntimeSha256"})
    expected_hash(value[field], field);
  exact(value["target"], {"platform", "architecture", "configuration", "minimumOS"}, "native target");
  if (value["target"]["platform"] != "macos" || value["target"]["architecture"] != "arm64" ||
      value["target"]["configuration"] != "Release" || value["target"]["minimumOS"] != "13.0")
    fail("E_ADAPTER_PLATFORM", "external loading currently requires macOS arm64 Release/minimum 13.0");
  exact(value["toolchain"], {"name", "version"}, "native toolchain");
  if (value["toolchain"]["name"] != "AppleClang") fail("E_ADAPTER_COMBINATION", "expected AppleClang");
  text(value["toolchain"]["version"], "toolchain version");
  std::map<std::string, std::string> hashes;
  if (!value["nativeDependencies"].isArray()) fail("E_ADAPTER_COMBINATION", "native dependencies require an array");
  for (const auto &entry : value["nativeDependencies"]) {
    exact(entry, {"name", "sha256"}, "native dependency");
    auto name = text(entry["name"], "native dependency name");
    if (!hashes.emplace(name, expected_hash(entry["sha256"], name)).second)
      fail("E_ADAPTER_COMBINATION", "duplicate native dependency " + name);
  }
  if (hashes.size() != 3 || !hashes.count("fabric_godot") || !hashes.count("hermes") || !hashes.count("rn-dependencies") ||
      hashes.at("hermes") != value["hermesRuntimeSha256"].asString())
    fail("E_ADAPTER_COMBINATION", "expected exactly the host, original Hermes and RN dependency identities");
  return hashes;
}

#if FABRIC_EXTERNAL_LOADER_MACOS
std::string hex(std::span<const uint8_t> input) {
  static constexpr char digits[] = "0123456789abcdef";
  std::string result;
  for (auto byte : input) { result += digits[byte >> 4]; result += digits[byte & 15]; }
  return result;
}
std::string hash(std::span<const uint8_t> input) {
  std::array<uint8_t, CC_SHA256_DIGEST_LENGTH> result{};
  CC_SHA256(input.data(), static_cast<CC_LONG>(input.size()), result.data());
  return hex(result);
}
std::set<fs::path> generated_tree(const fs::path &directory);
struct Files {
  std::map<fs::path, std::string> expected;
  std::map<fs::path, std::set<fs::path>> generated_sets;
  std::vector<uint8_t> read(const fs::path &file, const std::string &sha = {}) {
    auto content = bytes(file);
    const auto actual = hash(content);
    if (!sha.empty() && actual != sha) fail("E_ADAPTER_HASH", "bytes differ: " + file.string());
    auto [entry, inserted] = expected.emplace(file, actual);
    if (!inserted && entry->second != actual) fail("E_ADAPTER_STALE", "file changed during selection: " + file.string());
    return content;
  }
  fs::path reference(const fs::path &root, const fs::path &base, const Json &ref, const std::string &where, bool artifact = false) {
    if (artifact) { exact(ref, {"path", "sha256", "generator"}, where); text(ref["generator"], "original generator"); }
    else exact(ref, {"path", "sha256"}, where);
    auto file = relative_file(root, base, ref["path"], where);
    read(file, expected_hash(ref["sha256"], where));
    return file;
  }
  void verify() const {
    for (const auto &[file, sha] : expected)
      if (!fs::is_regular_file(file) || fs::canonical(file) != file || hash(bytes(file)) != sha)
        fail("E_ADAPTER_STALE", "file changed during activation: " + file.string());
    for (const auto &[directory, expected_files] : generated_sets)
      if (fs::canonical(directory) != directory || generated_tree(directory) != expected_files)
        fail("E_ADAPTER_STALE", "generated file set changed during activation");
  }
};
template <typename T> T structure(std::span<const uint8_t> input, std::size_t offset) {
  if (offset > input.size() || sizeof(T) > input.size() - offset) fail("E_ADAPTER_MACHO", "truncated Mach-O structure");
  T result;
  std::memcpy(&result, input.data() + offset, sizeof(result));
  return result;
}
uint32_t big32(std::span<const uint8_t> input, std::size_t offset) {
  if (offset > input.size() || 4 > input.size() - offset) fail("E_ADAPTER_MACHO", "truncated fat architecture");
  return (uint32_t(input[offset]) << 24) | (uint32_t(input[offset + 1]) << 16) |
      (uint32_t(input[offset + 2]) << 8) | uint32_t(input[offset + 3]);
}
uint64_t big64(std::span<const uint8_t> input, std::size_t offset) {
  return (uint64_t(big32(input, offset)) << 32) | big32(input, offset + 4);
}
std::string thin_uuid(std::span<const uint8_t> input, uint32_t required_type) {
  const auto header = structure<mach_header_64>(input, 0);
  if (header.magic != MH_MAGIC_64 || header.cputype != CPU_TYPE_ARM64 ||
      (header.cpusubtype & ~CPU_SUBTYPE_MASK) != CPU_SUBTYPE_ARM64_ALL || header.filetype != required_type ||
      header.ncmds > 65536 || header.sizeofcmds > 16 * 1024 * 1024 ||
      header.sizeofcmds > input.size() - sizeof(header))
    fail("E_ADAPTER_MACHO", "require a bounded arm64 Mach-O of the expected type");
  std::size_t cursor = sizeof(header);
  const std::size_t end = cursor + header.sizeofcmds;
  std::string uuid;
  for (uint32_t index = 0; index < header.ncmds; ++index) {
    const auto command = structure<load_command>(input.first(end), cursor);
    if (command.cmdsize < sizeof(command) || command.cmdsize > end - cursor || command.cmdsize % 8)
      fail("E_ADAPTER_MACHO", "invalid load command size");
    if (command.cmd == LC_UUID) {
      if (!uuid.empty() || command.cmdsize != sizeof(uuid_command)) fail("E_ADAPTER_MACHO", "invalid or repeated LC_UUID");
      const auto record = structure<uuid_command>(input.first(end), cursor);
      uuid = hex(record.uuid);
    }
    cursor += command.cmdsize;
  }
  if (cursor != end || uuid.empty()) fail("E_ADAPTER_MACHO", "missing UUID or inconsistent command table");
  return uuid;
}
std::string disk_uuid(std::span<const uint8_t> input) {
  const auto magic = big32(input, 0);
  if (magic != FAT_MAGIC && magic != FAT_MAGIC_64) return thin_uuid(input, MH_DYLIB);
  const auto count = big32(input, 4);
  const std::size_t record_size = magic == FAT_MAGIC_64 ? 32 : 20;
  if (!count || count > 64 || 8 + uint64_t(count) * record_size > input.size())
    fail("E_ADAPTER_MACHO", "invalid fat architecture table");
  std::string result;
  for (uint32_t index = 0; index < count; ++index) {
    const auto entry = 8 + index * record_size;
    if (big32(input, entry) != CPU_TYPE_ARM64 ||
        (big32(input, entry + 4) & ~CPU_SUBTYPE_MASK) != CPU_SUBTYPE_ARM64_ALL) continue;
    const uint64_t offset = magic == FAT_MAGIC_64 ? big64(input, entry + 8) : big32(input, entry + 8);
    const uint64_t size = magic == FAT_MAGIC_64 ? big64(input, entry + 16) : big32(input, entry + 12);
    if (!result.empty() || offset > input.size() || size > input.size() - offset || offset < 8 + count * record_size)
      fail("E_ADAPTER_MACHO", "duplicate or invalid arm64 fat slice");
    result = thin_uuid(input.subspan(offset, size), MH_DYLIB);
  }
  if (result.empty()) fail("E_ADAPTER_MACHO", "no arm64 fat slice");
  return result;
}
std::string memory_uuid(const mach_header *base) {
  // Only headers returned by dyld are accepted; no manifest-derived pointer.
  bool recognized = false;
  for (uint32_t index = 0; index < _dyld_image_count(); ++index) recognized |= _dyld_get_image_header(index) == base;
  if (!recognized || base->magic != MH_MAGIC_64) fail("E_ADAPTER_IMAGE", "address does not identify a dyld image");
  const auto *header = reinterpret_cast<const mach_header_64 *>(base);
  if (header->sizeofcmds > 16 * 1024 * 1024) fail("E_ADAPTER_IMAGE", "loaded image command table is invalid");
  return thin_uuid({reinterpret_cast<const uint8_t *>(base), sizeof(*header) + header->sizeofcmds}, MH_DYLIB);
}
__attribute__((noinline)) const char *host_anchor() { return "godot-fabric.adapter-loader.host-image/v1"; }
struct Identity { fs::path file; const void *base{}; std::string uuid; };
Identity image(const void *address, Files &files, const std::string &sha, const std::string &name) {
  Dl_info info{};
  if (!dladdr(address, &info) || !info.dli_fname || !info.dli_fbase) fail("E_ADAPTER_IMAGE", "missing loaded " + name);
  std::error_code error;
  auto file = fs::canonical(info.dli_fname, error);
  if (error || !fs::is_regular_file(file)) fail("E_ADAPTER_IMAGE", "loaded image file is unavailable: " + name);
  const auto disk = files.read(file);
  const auto loaded = memory_uuid(static_cast<const mach_header *>(info.dli_fbase));
  if (disk_uuid(disk) != loaded) fail("E_ADAPTER_HOST_STALE_RESTART_REQUIRED", name + " loaded UUID differs from the on-disk build");
  if (hash(disk) != sha) fail("E_ADAPTER_COMBINATION", name + " image file differs from the identified SDK receipt");
  return {file, info.dli_fbase, loaded};
}
Json host_images(Files &files, const std::map<std::string, std::string> &hashes) {
  auto host = image(reinterpret_cast<const void *>(&host_anchor), files, hashes.at("fabric_godot"), "host");
  Json result = Json::object("host", Json::object("sha256", hashes.at("fabric_godot"))("uuid", host.uuid));
  for (const auto &[name, binary] : std::map<std::string, std::string>{{"hermes", "hermesvm"}, {"rn-dependencies", "ReactNativeDependencies"}}) {
    const mach_header *found = nullptr;
    for (uint32_t index = 0; index < _dyld_image_count(); ++index) {
      const auto *path = _dyld_get_image_name(index);
      if (path && fs::path(path).filename() == binary) {
        if (found) fail("E_ADAPTER_IMAGE", "more than one loaded dependency image: " + name);
        found = _dyld_get_image_header(index);
      }
    }
    if (!found) fail("E_ADAPTER_IMAGE", "original dependency image not loaded: " + name);
    auto dependency = image(found, files, hashes.at(name), name);
    result[name] = Json::object("sha256", hashes.at(name))("uuid", dependency.uuid);
  }
  return result;
}
struct Pinned { void *handle{}; std::string hash, uuid; const void *base{}; };
struct ProcessImages { std::recursive_mutex mutex; std::map<fs::path, Pinned> images; };
ProcessImages &process_images() { static auto *state = new ProcessImages(); return *state; }
thread_local bool activating = false;

struct Selected {
  std::string id;
  fs::path root, manifest, library;
  std::string library_hash, library_uuid;
  std::vector<std::string> components, modules, dependencies;
  AdapterRegistry::Initializer initializer{};
  const AdapterBindingWitness *(*witness)(){};
};
std::string normalized(const std::string &name) {
  // The original transition helper expects at least the length of "RCT".
  return name.size() < 3 ? name : rn::componentNameByReactViewName(name);
}
std::set<std::string> component_reservations() {
  std::set<std::string> result;
  for (auto name : {"RootView", "View", "Paragraph", "Text", "RawText", "TextEffect", "ScrollView",
      "Image", "TextInput", "AndroidTextInput", "SafeAreaView", "InputAccessoryView", "ModalHostView",
      "AndroidProgressBar", "AndroidSwitch", "Switch", "ActivityIndicatorView", "VirtualView",
      "LayoutConformance", "UnimplementedView", "LegacyViewManagerInterop", "LegacyViewManagerAndroidInterop",
      "AndroidHorizontalScrollContentView", "SelectableParagraph", "ShimmeringView", "PullToRefreshView",
      "GodotControl", "Button", "Pressable", "ActivityIndicator", "Modal", "VirtualText", "SelectableText",
      "ImageView", "RefreshControl", "ScrollContentView", "SinglelineTextInputView", "MultilineTextInputView"}) {
    result.insert(name); result.insert(normalized(name));
  }
  return result;
}
std::set<std::string> module_reservations() {
  return {"AccessibilityInfo", "AccessibilityManager", "ActionSheetManager", "AlertManager", "AppState",
      "Appearance", "BlobModule", "CPUTimeCxx", "Clipboard", "DevLoadingView", "DevMenu", "DevSettings",
      "DeviceEventManager", "DeviceInfo", "DialogManagerAndroid", "ExceptionsManager", "FileReaderModule",
      "FrameRateLogger", "HeadlessJsTaskSupport", "I18nManager", "ImageEditingManager", "ImageLoader",
      "ImageStoreManager", "IntentAndroid", "JSCHeapCapture", "KeyboardObserver", "LinkingManager", "LogBox",
      "ModalManager", "NativeAnimatedModule", "NativeAnimatedTurboModule", "NativeDOMCxx", "NativeFantomCxx",
      "NativeFantomTestSpecificMethodsCxx", "NativeIdleCallbacksCxx", "NativeIntersectionObserverCxx",
      "NativeMicrotasksCxx", "NativeMutationObserverCxx", "NativePerformanceCxx", "NativeReactNativeFeatureFlagsCxx",
      "NativeViewTransitionCxx", "Networking", "PermissionsAndroid", "PlatformConstants", "PushNotificationManager",
      "ReactDevToolsRuntimeSettingsModule", "ReactDevToolsSettingsManager", "RedBox", "SampleTurboModule",
      "SegmentFetcher", "SettingsManager", "ShareModule", "SoundManager", "SourceCode", "StatusBarManager",
      "Timing", "ToastAndroid", "Vibration", "WebSocketModule", "GodotFabricServices", "GodotFabricNativeFixture"};
}
std::set<fs::path> generated_tree(const fs::path &directory) {
  std::set<fs::path> files;
  for (const auto &entry : fs::recursive_directory_iterator(directory)) {
    if (entry.is_symlink() || (!entry.is_regular_file() && !entry.is_directory()))
      fail("E_ADAPTER_CODEGEN", "generated output contains a symlink or non-regular entry");
    if (entry.is_regular_file()) files.insert(fs::canonical(entry.path()));
  }
  return files;
}
void schema_names(const Json &schema, const Selected &selected, std::set<std::string> &schema_modules) {
  exact(schema, {"modules"}, "original schema");
  if (!schema["modules"].isObject()) fail("E_ADAPTER_CODEGEN", "schema modules must be an object");
  std::set<std::string> components, modules;
  for (const auto &item : schema["modules"].items()) {
    const auto key = text(item.first, "schema module key");
    if (!identifier(key) || !schema_modules.insert(key).second) fail("E_ADAPTER_COLLISION", "generated schema module collision " + key);
    const auto &module = item.second;
    if (!module.isObject() || !module.count("type")) fail("E_ADAPTER_CODEGEN", "original schema module has no type");
    if (module["type"] == "Component") {
      if (!module.count("components") || !module["components"].isObject())
        fail("E_ADAPTER_CODEGEN", "original component schema has no components");
      for (const auto &component : module["components"].items()) {
        const auto name = text(component.first, "schema component");
        if (!identifier(name) || !components.insert(name).second) fail("E_ADAPTER_COLLISION", "repeated schema component " + name);
      }
    } else if (module["type"] == "NativeModule") {
      if (!module.count("moduleName")) fail("E_ADAPTER_CODEGEN", "original module schema has no moduleName");
      const auto name = text(module["moduleName"], "schema native module");
      if (!identifier(name) || !modules.insert(name).second) fail("E_ADAPTER_COLLISION", "repeated schema module " + name);
    } else fail("E_ADAPTER_CODEGEN", "unsupported original schema module type");
  }
  if (components != std::set(selected.components.begin(), selected.components.end()) ||
      modules != std::set(selected.modules.begin(), selected.modules.end()))
    fail("E_ADAPTER_CODEGEN", selected.id + " declarations differ from original schema names");
}
Selected selected_adapter(const Json &entry, const fs::path &project, const Json &expected,
    Files &files, std::set<std::string> &schema_modules) {
  exact(entry, {"packageRoot", "manifest"}, "selected adapter");
  Selected selected;
  selected.root = relative_file(project, project, entry["packageRoot"], "packageRoot", true);
  selected.manifest = files.reference(selected.root, selected.root, entry["manifest"], "adapter manifest");
  const auto manifest = parse(files.read(selected.manifest), "adapter manifest");
  exact(manifest, {"format", "id", "entryPoint", "library", "nativeCombination", "codegenManifest",
      "components", "modules", "dependsOn"}, "original adapter manifest");
  selected.id = text(manifest["id"], "adapter id");
  if (!identifier(selected.id) || manifest["format"] != "godot-fabric.experimental-adapter/v1" ||
      manifest["entryPoint"] != "godot_fabric_adapter_init_v1")
    fail("E_ADAPTER_MANIFEST", "unsupported original adapter format, id or entryPoint");
  combination(manifest["nativeCombination"]);
  if (manifest["nativeCombination"] != expected) fail("E_ADAPTER_COMBINATION", selected.id + " SDK combination differs");
  selected.components = names(manifest["components"], selected.id + " components");
  selected.modules = names(manifest["modules"], selected.id + " modules");
  selected.dependencies = names(manifest["dependsOn"], selected.id + " dependencies");
  if (selected.components.empty() && selected.modules.empty()) fail("E_ADAPTER_MANIFEST", selected.id + " declares no providers");
  selected.library = files.reference(selected.root, selected.root, manifest["library"], selected.id + " library");
  selected.library_hash = manifest["library"]["sha256"].asString();
  selected.library_uuid = disk_uuid(files.read(selected.library, selected.library_hash));
  const auto codegen_path = files.reference(selected.root, selected.root, manifest["codegenManifest"], selected.id + " Codegen manifest");
  if (codegen_path.filename() != "manifest.json") fail("E_ADAPTER_CODEGEN", "expected the original manifest.json");
  const auto generated = codegen_path.parent_path();
  const auto generated_files = generated_tree(generated);
  files.generated_sets.emplace(generated, generated_files);
  std::set<fs::path> declared_generated{codegen_path};
  const auto codegen = parse(files.read(codegen_path), "original Codegen manifest");
  exact(codegen, {"format", "schemaProfile", "libraryName", "nativeCombination", "tools", "sources",
      "schema", "artifacts", "claims"}, "original Codegen manifest");
  if (codegen["format"] != "godot-fabric.experimental-codegen/v1" ||
      codegen["schemaProfile"] != "godot-fabric.experimental-common-cxx/v1" ||
      !identifier(text(codegen["libraryName"], "original libraryName")))
    fail("E_ADAPTER_CODEGEN", "unsupported original Codegen format/profile/library");
  exact(codegen["nativeCombination"], {"declaration", "sha256"}, "Codegen native combination");
  const auto declaration_json = canonical_json(expected) + "\n";
  if (codegen["nativeCombination"]["declaration"] != expected ||
      expected_hash(codegen["nativeCombination"]["sha256"], "Codegen combination") !=
          hash({reinterpret_cast<const uint8_t *>(declaration_json.data()), declaration_json.size()}))
    fail("E_ADAPTER_COMBINATION", selected.id + " generated combination differs");
  exact(codegen["claims"], {"nativeCompiled", "nativeLoaded", "runtimeExecuted", "abiCertified"}, "Codegen claims");
  for (const auto &claim : codegen["claims"].values())
    if (!claim.isBool() || claim.asBool()) fail("E_ADAPTER_CODEGEN", "original Codegen cannot attest native/runtime/ABI execution");
  if (!codegen["tools"].isObject() || !codegen["tools"].count("package") || !codegen["tools"].count("version") ||
      codegen["tools"]["package"] != "@react-native/codegen" || codegen["tools"]["version"] != "0.87.1")
    fail("E_ADAPTER_CODEGEN", "expected the original pinned Codegen tool identity");
  for (const auto *kind : {"sources", "artifacts"}) {
    if (!codegen[kind].isArray() || codegen[kind].empty() || codegen[kind].size() > 4096)
      fail("E_ADAPTER_CODEGEN", "original Codegen " + std::string(kind) + " requires bounded nonempty files");
    std::set<fs::path> used;
    for (const auto &ref : codegen[kind]) {
      const bool artifact = std::string(kind) == "artifacts";
      const auto file = files.reference(selected.root, artifact ? generated : selected.root, ref, kind, artifact);
      if (!used.insert(file).second) fail("E_ADAPTER_CODEGEN", "repeated original Codegen path");
      if (artifact) declared_generated.insert(file);
    }
  }
  const auto schema_file = files.reference(selected.root, generated, codegen["schema"], "original schema");
  declared_generated.insert(schema_file);
  if (declared_generated != generated_files) fail("E_ADAPTER_CODEGEN", "generated file set differs from original manifest");
  schema_names(parse(files.read(schema_file), "original schema"), selected, schema_modules);
  return selected;
}
std::vector<std::size_t> order_and_reserve(const std::vector<Selected> &selected) {
  std::map<std::string, std::size_t> ids;
  auto reserved_components = component_reservations();
  auto reserved_modules = module_reservations();
  std::set<std::string> public_names, libraries;
  for (std::size_t index = 0; index < selected.size(); ++index) {
    const auto &adapter = selected[index];
    if (!ids.emplace(adapter.id, index).second || !libraries.insert(adapter.library.string()).second)
      fail("E_ADAPTER_COLLISION", "duplicate adapter id or selected library: " + adapter.id);
    for (const auto &name : adapter.components) {
      if (normalized(name) != name || !reserved_components.insert(name).second || !public_names.insert(name).second)
        fail("E_ADAPTER_COLLISION", "noncanonical or reserved component " + name);
    }
    for (const auto &name : adapter.modules)
      if (!reserved_modules.insert(name).second || !public_names.insert(name).second)
        fail("E_ADAPTER_COLLISION", "reserved or repeated module " + name);
  }
  std::set<std::string> visiting, visited;
  std::vector<std::size_t> order;
  std::function<void(const std::string &)> visit = [&](const std::string &id) {
    auto found = ids.find(id);
    if (found == ids.end()) fail("E_ADAPTER_DEPENDENCY", "missing selected dependency " + id);
    if (visiting.count(id)) fail("E_ADAPTER_DEPENDENCY", "cycle at " + id);
    if (visited.count(id)) return;
    visiting.insert(id);
    auto dependencies = selected[found->second].dependencies;
    std::sort(dependencies.begin(), dependencies.end());
    for (const auto &dependency : dependencies) visit(dependency);
    visiting.erase(id); visited.insert(id); order.push_back(found->second);
  };
  for (const auto &[id, index] : ids) visit(id);
  return order;
}
void shared_bindings(const Selected &selected) {
  const auto *actual = selected.witness();
  const auto expected = adapter_binding_witness();
  if (!actual || actual->size != sizeof(AdapterBindingWitness) || actual->version != 1 ||
      actual->godot_get_proc_address != expected.godot_get_proc_address ||
      actual->godot_library != expected.godot_library || actual->godot_token != expected.godot_token ||
      actual->react_native != expected.react_native || actual->jsi != expected.jsi || actual->hermes != expected.hermes)
    fail("E_ADAPTER_BINDING", selected.id + " supplied binding addresses differ from the shared host");
}
Pinned &pin(Selected &selected, Files &files) {
  auto &images = process_images().images;
  auto found = images.find(selected.library);
  if (found != images.end()) {
    if (found->second.hash != selected.library_hash || found->second.uuid != selected.library_uuid)
      fail("E_ADAPTER_LIBRARY_STALE_RESTART_REQUIRED", "selected path already owns another native build");
  } else {
    dlerror();
    auto *handle = dlopen(selected.library.c_str(), RTLD_NOW | RTLD_LOCAL | RTLD_NODELETE);
    if (!handle) { auto *error = dlerror(); fail("E_ADAPTER_LOAD", error ? error : "library load failed"); }
    // Pin immediately, even if symbol/binding/initializer validation fails.
    found = images.emplace(selected.library, Pinned{handle, selected.library_hash, selected.library_uuid, nullptr}).first;
  }
  dlerror();
  const auto initializer = dlsym(found->second.handle, "godot_fabric_adapter_init_v1");
  if (dlerror() || !initializer) fail("E_ADAPTER_ENTRY", "selected library does not export the original adapter entry");
  const auto identity = image(initializer, files, selected.library_hash, selected.id);
  if (identity.file != selected.library || identity.uuid != selected.library_uuid)
    fail("E_ADAPTER_ENTRY", "entry point belongs to a dependency or different native image");
  if (found->second.base && found->second.base != identity.base) fail("E_ADAPTER_IMAGE", "pinned native image changed");
  found->second.base = identity.base;
  selected.initializer = reinterpret_cast<AdapterRegistry::Initializer>(initializer);
  dlerror();
  const auto witness = dlsym(found->second.handle, "godot_fabric_adapter_bindings_v1");
  if (dlerror() || !witness) fail("E_ADAPTER_BINDING", "selected adapter is missing its compiled binding witness");
  const auto witness_image = image(witness, files, selected.library_hash, selected.id);
  if (witness_image.base != identity.base) fail("E_ADAPTER_BINDING", "binding witness belongs to another native image");
  selected.witness = reinterpret_cast<const AdapterBindingWitness *(*)()>(witness);
  return found->second;
}
#endif
} // namespace

struct AdapterLoader::Impl {
  std::shared_ptr<AdapterRegistry> registry = std::make_shared<AdapterRegistry>();
  Json status = Json::object("enabled", false)("librariesProcessPinned", true)
      ("runtimeIdentityVerified", false)("abiCertified", false)("adapters", Json::array());
};

AdapterLoader::AdapterLoader(const std::string &selection_path, const std::string &host_combination_path,
    const std::string &project_root, const std::string &expected_bundle_path) : impl(std::make_unique<Impl>()) {
  if (selection_path.empty()) { impl->registry->seal(); return; }
#if !FABRIC_EXTERNAL_LOADER_MACOS || !defined(NDEBUG)
  fail("E_ADAPTER_PLATFORM", "external loading currently requires a macOS arm64 Release host");
#else
  if (activating) fail("E_ADAPTER_REENTRANT", "nested adapter activation is unsupported");
  std::lock_guard lock(process_images().mutex);
  struct Activation { Activation() { activating = true; } ~Activation() { activating = false; } } activation;
  const auto project = canonical(project_root, true, "project root");
  const auto packet_path = canonical(selection_path, false, "selection");
  const auto expected_path = canonical(host_combination_path, false, "host combination");
  if (!inside(project, packet_path)) fail("E_ADAPTER_PATH", "selection must be inside the trusted project");
  Files files;
  const auto expected = parse(files.read(expected_path), "host combination");
  const auto hashes = combination(expected);
  const auto packet = parse(files.read(packet_path), "selection");
  exact(packet, {"format", "bundle", "nativeCombination", "adapters"}, "selection");
  if (packet["format"] != "godot-fabric.experimental-adapter-selection/v1") fail("E_ADAPTER_MANIFEST", "unsupported selection format");
  combination(packet["nativeCombination"]);
  if (packet["nativeCombination"] != expected) fail("E_ADAPTER_COMBINATION", "selected SDK combination differs from host");
  const auto bundle = files.reference(project, project, packet["bundle"], "bundle");
  if (!expected_bundle_path.empty() && canonical(expected_bundle_path, false, "application bundle") != bundle)
    fail("E_ADAPTER_BUNDLE", "selection bundle differs from the application's configured bundle");
  if (!packet["adapters"].isArray() || packet["adapters"].size() > 256) fail("E_ADAPTER_MANIFEST", "selection requires at most 256 adapters");
  std::vector<Selected> selected;
  std::set<std::string> schema_modules;
  for (const auto &entry : packet["adapters"]) selected.push_back(selected_adapter(entry, project, expected, files, schema_modules));
  const auto order = order_and_reserve(selected);
  const auto images = host_images(files, hashes);
  files.verify();
  // Validation for every selected manifest finishes before the first dlopen.
  // Resolve every entry before the first explicit initializer. Static native
  // constructors execute during dlopen and cannot be rolled back by the host.
  for (auto index : order) pin(selected[index], files);
  files.verify();
  host_images(files, hashes);
  for (auto index : order) shared_bindings(selected[index]);
  files.verify(); // Witness getters also execute adapter code.
  for (auto index : order) {
    const auto &adapter = selected[index];
    impl->registry->register_adapter(adapter.id, adapter.components, adapter.modules, adapter.initializer);
    impl->status["adapters"].push_back(Json::object("id", adapter.id)("librarySha256", adapter.library_hash)
        ("libraryUUID", adapter.library_uuid)("entryResolved", true));
  }
  files.verify();
  impl->registry->seal();
  impl->status["enabled"] = true;
  impl->status["loadedImageUUIDsMatched"] = true;
  impl->status["loadedImageFilesMatchedReceipts"] = true;
  impl->status["selectedFilesVerified"] = files.expected.size();
  impl->status["loadedImages"] = images;
  impl->status["bundle"] = packet["bundle"];
  // Identification covers UUID/file receipts and imported symbols, not all
  // memory contents, behavior or a certified cross-version ABI.
#endif
}
AdapterLoader::~AdapterLoader() = default;
std::shared_ptr<AdapterRegistry> AdapterLoader::registry() const { return impl->registry; }
folly::dynamic AdapterLoader::snapshot() const { return impl->status; }
} // namespace fabric_godot
