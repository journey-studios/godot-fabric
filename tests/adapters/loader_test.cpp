// Two uses, both against the shared SDK; no VM, Godot or view factory:
// - compile as a dylib with FABRIC_LOADER_FIXTURE=1 (valid), 2 (missing entry),
//   3 (throwing initializer), 4 (hidden duplicate Godot globals), 5 (no witness);
// - compile normally as the standalone client. Inputs must be original,
//   preflighted Codegen package/selection fixtures from the builder.
#include "adapter_loader.h"
#include <react/renderer/components/CodegenFixture/ComponentDescriptors.h>
#include <folly/json.h>
#include <CommonCrypto/CommonDigest.h>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
namespace fs = std::filesystem;
using Json = folly::dynamic;
std::string read(const fs::path &file) {
  std::ifstream stream(file, std::ios::binary);
  if (!stream) throw std::runtime_error("LOADER_FIXTURE: cannot read " + file.string());
  return std::string(std::istreambuf_iterator<char>(stream), {});
}
void write(const fs::path &file, const std::string &value) {
  std::ofstream stream(file, std::ios::binary | std::ios::trunc);
  if (!stream || !stream.write(value.data(), value.size())) throw std::runtime_error("LOADER_FIXTURE: cannot write " + file.string());
}
void marker(const char *event) {
  if (const auto *file = std::getenv("GODOT_FABRIC_LOADER_MARKER")) {
    std::ofstream stream(file, std::ios::app);
    stream << event << '\n';
  }
}
}

#if defined(FABRIC_LOADER_FIXTURE)
#if FABRIC_LOADER_FIXTURE == 4
// Actual second binding variables, not an invented witness mismatch. The
// adapter TU resolves these private variables while the shared SDK owns others.
namespace godot::internal {
extern "C" {
__attribute__((visibility("hidden"))) GDExtensionInterfaceGetProcAddress gdextension_interface_get_proc_address = nullptr;
__attribute__((visibility("hidden"))) GDExtensionClassLibraryPtr library = nullptr;
__attribute__((visibility("hidden"))) void *token = nullptr;
}
}
#endif
__attribute__((constructor)) static void loaded_marker() {
  marker("STATIC");
  if (const auto *file = std::getenv("GODOT_FABRIC_LOADER_MUTATE_FILE")) write(file, "changed by fixture static initializer\n");
}
#if FABRIC_LOADER_FIXTURE != 5
extern "C" __attribute__((visibility("default"))) const fabric_godot::AdapterBindingWitness *godot_fabric_adapter_bindings_v1() {
  marker("WITNESS");
  if (const auto *file = std::getenv("GODOT_FABRIC_LOADER_WITNESS_MUTATE_FILE")) write(file, "changed by witness getter\n");
  static const auto witness = fabric_godot::adapter_binding_witness();
  return &witness;
}
#endif
#if FABRIC_LOADER_FIXTURE != 2
extern "C" __attribute__((visibility("default"))) void godot_fabric_adapter_init_v1(fabric_godot::AdapterRegistry &registry) {
  marker("INITIALIZER");
  registry.add_component(facebook::react::concreteComponentDescriptorProvider<facebook::react::CodegenBadgeComponentDescriptor>(),
      [](fabric_godot::AdapterViewContext) -> std::unique_ptr<fabric_godot::AdapterView> {
        marker("VIEW_FACTORY");
        throw std::runtime_error("LOADER_FIXTURE: view factory must remain lazy");
      });
  registry.add_module("CodegenProbe", [](facebook::jsi::Runtime &, const std::shared_ptr<facebook::react::CallInvoker> &)
      -> std::shared_ptr<facebook::react::TurboModule> {
        marker("MODULE_FACTORY");
        throw std::runtime_error("LOADER_FIXTURE: module factory must remain lazy");
      }, [] { marker("DISPOSE"); });
#if FABRIC_LOADER_FIXTURE == 3
  throw std::runtime_error("LOADER_FIXTURE_INITIALIZER: requested rollback after original providers");
#endif
}
#endif
#else
namespace {
int checks = 0, cases = 0;
void check(bool condition, const std::string &message) {
  if (!condition) throw std::runtime_error("LOADER_ASSERTION: " + message);
  ++checks;
}
std::string hash(const fs::path &file) {
  const auto content = read(file);
  unsigned char digest[CC_SHA256_DIGEST_LENGTH]{};
  CC_SHA256(content.data(), static_cast<CC_LONG>(content.size()), digest);
  static const char digits[] = "0123456789abcdef";
  std::string result;
  for (auto byte : digest) { result += digits[byte >> 4]; result += digits[byte & 15]; }
  return result;
}
Json json(const fs::path &file) { return folly::parseJson(read(file)); }
void json(const fs::path &file, const Json &value) { write(file, folly::toJson(value) + "\n"); }
struct Case {
  fs::path root, selection;
  Json packet;
  fs::path package() const { return root / packet["adapters"][0]["packageRoot"].asString(); }
  fs::path manifest_file() const { return package() / packet["adapters"][0]["manifest"]["path"].asString(); }
  Json manifest() const { return json(manifest_file()); }
  fs::path bundle() const { return root / packet["bundle"]["path"].asString(); }
  fs::path generated() const { return (package() / manifest()["codegenManifest"]["path"].asString()).parent_path(); }
  void save_manifest(const Json &manifest) {
    json(manifest_file(), manifest);
    packet["adapters"][0]["manifest"]["sha256"] = hash(manifest_file());
    save();
  }
  void save() { json(selection, packet); }
};
Case clone(const fs::path &project, const fs::path &selection, const fs::path &out, const std::string &name) {
  ++cases;
  auto packet = json(selection);
  check(packet["adapters"].size() == 1, "fixture requires one original Badge+Probe package");
  const auto root = out / name;
  fs::create_directory(root);
  for (const auto &adapter : packet["adapters"]) {
    const auto relative = adapter["packageRoot"].asString();
    fs::create_directories((root / relative).parent_path());
    fs::copy(project / relative, root / relative, fs::copy_options::recursive | fs::copy_options::copy_symlinks);
  }
  const auto bundle = packet["bundle"]["path"].asString();
  fs::create_directories((root / bundle).parent_path());
  fs::copy_file(project / bundle, root / bundle);
  Case result{fs::canonical(root), root / "selection.json", std::move(packet)};
  result.save();
  return result;
}
std::size_t count(const fs::path &file, const std::string &event) {
  std::ifstream stream(file);
  std::size_t result = 0;
  std::string line;
  while (std::getline(stream, line)) result += line == event;
  return result;
}
template <typename F> void rejects(const std::string &code, F operation) {
  try { operation(); }
  catch (const std::exception &error) {
    check(std::string(error.what()).starts_with(code + ":"), "expected " + code + ", got " + error.what());
    return;
  }
  throw std::runtime_error("LOADER_ASSERTION: expected " + code);
}
void replacement(Case &fixture, const fs::path &library) {
  auto manifest = fixture.manifest();
  const auto path = fixture.package() / manifest["library"]["path"].asString();
  auto staging = path;
  staging += ".replacement";
  fs::copy_file(library, staging);
  fs::rename(staging, path); // Do not truncate a mapped Mach-O inode.
  manifest["library"]["sha256"] = hash(path);
  fixture.save_manifest(manifest);
}
}
int main(int argc, char **argv) {
  try {
    if (argc != 9) throw std::runtime_error(
        "Use loader_test <project> <selection> <combination> <new-output> <missing-entry.dylib> <throwing.dylib> <hidden-binding.dylib> <missing-witness.dylib>");
    const auto project = fs::canonical(argv[1]), selection = fs::canonical(argv[2]), combination = fs::canonical(argv[3]);
    const fs::path output = fs::absolute(argv[4]).lexically_normal();
    const auto relative = output.lexically_relative(project);
    check(!relative.empty() && !relative.is_absolute() && *relative.begin() != "..", "output is a new project child");
    check(!fs::exists(output) && !fs::is_symlink(fs::symlink_status(output)), "preserve existing output");
    check(fs::canonical(output.parent_path()) == output.parent_path(), "output parent is canonical");
    check(fs::create_directory(output), "exclusive fixture output");
    const auto marker_file = output / "markers.log";
    check(setenv("GODOT_FABRIC_LOADER_MARKER", marker_file.c_str(), 1) == 0, "set isolated marker path");
    auto activate = [&](const Case &fixture, const std::string &expected_bundle = {}) {
      return std::make_unique<fabric_godot::AdapterLoader>(fixture.selection.string(), combination.string(),
          fixture.root.string(), expected_bundle);
    };
    auto cold_rejection = [&](const Case &fixture, const std::string &code, const std::string &expected_bundle = {}) {
      const auto statics = count(marker_file, "STATIC"), initializers = count(marker_file, "INITIALIZER");
      rejects(code, [&] { activate(fixture, expected_bundle); });
      check(count(marker_file, "STATIC") == statics, "rejected selection precedes all static initializers");
      check(count(marker_file, "INITIALIZER") == initializers, "rejected selection precedes every entry initializer");
    };
    {
      ++cases;
      fabric_godot::AdapterLoader empty("", "", "");
      check(empty.registry()->sealed() && !empty.snapshot()["enabled"].asBool(), "no-adapter application stays disabled/sealed");
    }
    {
      auto fixture = clone(project, selection, output, "bundle-hash");
      write(fixture.bundle(), "changed\n");
      cold_rejection(fixture, "E_ADAPTER_HASH");
    }
    {
      auto fixture = clone(project, selection, output, "configured-bundle");
      const auto other = fixture.root / "other.js";
      write(other, "another bundle\n");
      cold_rejection(fixture, "E_ADAPTER_BUNDLE", other.string());
    }
    {
      auto fixture = clone(project, selection, output, "combination");
      fixture.packet["nativeCombination"]["sdkRevision"] = "different-native-build";
      fixture.save();
      cold_rejection(fixture, "E_ADAPTER_COMBINATION");
    }
    {
      auto fixture = clone(project, selection, output, "manifest-hash");
      write(fixture.manifest_file(), "{}\n");
      cold_rejection(fixture, "E_ADAPTER_HASH");
    }
    {
      auto fixture = clone(project, selection, output, "library-hash");
      auto manifest = fixture.manifest();
      manifest["library"]["sha256"] = std::string(64, '0');
      fixture.save_manifest(manifest);
      cold_rejection(fixture, "E_ADAPTER_HASH");
    }
    {
      auto fixture = clone(project, selection, output, "missing-dependency");
      auto manifest = fixture.manifest();
      manifest["dependsOn"] = Json::array("MissingAdapter");
      fixture.save_manifest(manifest);
      cold_rejection(fixture, "E_ADAPTER_DEPENDENCY");
    }
    {
      auto fixture = clone(project, selection, output, "cycle");
      auto manifest = fixture.manifest();
      manifest["dependsOn"] = Json::array(manifest["id"]);
      fixture.save_manifest(manifest);
      cold_rejection(fixture, "E_ADAPTER_DEPENDENCY");
    }
    {
      auto fixture = clone(project, selection, output, "extra-generated");
      write(fixture.generated() / "unexpected.h", "extra output\n");
      cold_rejection(fixture, "E_ADAPTER_CODEGEN");
    }
    {
      auto fixture = clone(project, selection, output, "changed-source");
      auto codegen = json(fixture.generated() / "manifest.json");
      write(fixture.package() / codegen["sources"][0]["path"].asString(), "changed original spec\n");
      cold_rejection(fixture, "E_ADAPTER_HASH");
    }
    {
      auto fixture = clone(project, selection, output, "duplicate-selection");
      fixture.packet["adapters"].push_back(fixture.packet["adapters"][0]);
      fixture.save();
      cold_rejection(fixture, "E_ADAPTER_COLLISION");
    }
    {
      auto fixture = clone(project, selection, output, "path-escape");
      fixture.packet["bundle"]["path"] = "../outside.js";
      fixture.save();
      cold_rejection(fixture, "E_ADAPTER_PATH");
    }
    {
      auto fixture = clone(project, selection, output, "positive");
      const auto initializers = count(marker_file, "INITIALIZER");
      auto loader = activate(fixture, fixture.bundle().string());
      check(loader->registry()->sealed(), "selected runtime registry sealed");
      check(loader->registry()->requested_component("CodegenBadge") != nullptr, "original generated descriptor available");
      check(loader->registry()->requested_component("RCTCodegenBadge") != nullptr, "RN requested alias uses the same provider");
      check(count(marker_file, "INITIALIZER") == initializers + 1, "initializer executes once per application");
      check(count(marker_file, "VIEW_FACTORY") == 0 && count(marker_file, "MODULE_FACTORY") == 0, "original view/module factories remain lazy");
      check(!loader->snapshot()["runtimeIdentityVerified"].asBool() && !loader->snapshot()["abiCertified"].asBool(), "identification does not claim runtime/ABI certification");
      check(loader->snapshot()["loadedImageUUIDsMatched"].asBool() &&
          loader->snapshot()["loadedImageFilesMatchedReceipts"].asBool(), "loaded UUID and file receipts checked separately");
      auto registry = loader->registry();
      loader.reset();
      check(registry->requested_component("CodegenBadge") != nullptr, "registry survives loader owner while process image is pinned");
      const auto disposals = count(marker_file, "DISPOSE");
      registry->dispose_modules();
      registry->dispose_modules();
      check(count(marker_file, "DISPOSE") == disposals + 1, "uncreated accepted module cleanup exactly once");
      check(registry->requested_component("CodegenBadge") == nullptr, "stopped registry rejects provider access");
    }
    for (int kind = 0; kind < 4; ++kind) {
      auto fixture = clone(project, selection, output, "native-rejection-" + std::to_string(kind));
      replacement(fixture, fs::canonical(argv[5 + kind]));
      const auto initializers = count(marker_file, "INITIALIZER");
      const auto disposals = count(marker_file, "DISPOSE");
      rejects(kind == 0 ? "E_ADAPTER_ENTRY" : kind == 1 ? "LOADER_FIXTURE_INITIALIZER" : "E_ADAPTER_BINDING",
          [&] { activate(fixture); });
      check(count(marker_file, "INITIALIZER") == initializers + (kind == 1), "invalid entry/witness stops before explicit initializer");
      if (kind == 1) check(count(marker_file, "DISPOSE") == disposals + 1, "throwing initializer rolls back accepted cleanup");
    }
    {
      auto fixture = clone(project, selection, output, "same-path-replaced");
      auto loader = activate(fixture);
      replacement(fixture, fs::canonical(argv[5]));
      const auto initializers = count(marker_file, "INITIALIZER"), statics = count(marker_file, "STATIC");
      rejects("E_ADAPTER_LIBRARY_STALE_RESTART_REQUIRED", [&] { activate(fixture); });
      check(count(marker_file, "INITIALIZER") == initializers && count(marker_file, "STATIC") == statics,
          "pinned path cannot silently switch builds");
      loader->registry()->dispose_modules();
    }
    {
      auto fixture = clone(project, selection, output, "static-source-change");
      check(setenv("GODOT_FABRIC_LOADER_MUTATE_FILE", fixture.bundle().c_str(), 1) == 0, "set isolated mutation fixture");
      const auto initializers = count(marker_file, "INITIALIZER");
      rejects("E_ADAPTER_STALE", [&] { activate(fixture); });
      unsetenv("GODOT_FABRIC_LOADER_MUTATE_FILE");
      check(count(marker_file, "INITIALIZER") == initializers, "post-load source change denies explicit initializer");
    }
    {
      auto fixture = clone(project, selection, output, "static-extra-output");
      const auto extra = fixture.generated() / "unexpected.h";
      check(setenv("GODOT_FABRIC_LOADER_MUTATE_FILE", extra.c_str(), 1) == 0, "set isolated extra output fixture");
      const auto initializers = count(marker_file, "INITIALIZER");
      rejects("E_ADAPTER_STALE", [&] { activate(fixture); });
      unsetenv("GODOT_FABRIC_LOADER_MUTATE_FILE");
      check(count(marker_file, "INITIALIZER") == initializers, "new generated output after load denies explicit initializer");
    }
    {
      auto fixture = clone(project, selection, output, "witness-source-change");
      check(setenv("GODOT_FABRIC_LOADER_WITNESS_MUTATE_FILE", fixture.bundle().c_str(), 1) == 0, "set isolated witness mutation");
      const auto initializers = count(marker_file, "INITIALIZER");
      rejects("E_ADAPTER_STALE", [&] { activate(fixture); });
      unsetenv("GODOT_FABRIC_LOADER_WITNESS_MUTATE_FILE");
      check(count(marker_file, "INITIALIZER") == initializers, "witness byte change denies explicit initializer");
    }
    unsetenv("GODOT_FABRIC_LOADER_MARKER");
    std::cout << folly::toJson(Json::object("format", "godot-fabric.experimental-adapter-loader-test/v1")
        ("marker", "ADAPTER_LOADER_OK")("cases", cases)("checks", checks)
        ("vmCreated", false)("godotEngineStarted", false)("viewFactoryCalls", count(marker_file, "VIEW_FACTORY"))
        ("moduleFactoryCalls", count(marker_file, "MODULE_FACTORY"))("abiCertified", false)) << std::endl;
    return 0;
  } catch (const std::exception &error) {
    unsetenv("GODOT_FABRIC_LOADER_MUTATE_FILE");
    unsetenv("GODOT_FABRIC_LOADER_WITNESS_MUTATE_FILE");
    unsetenv("GODOT_FABRIC_LOADER_MARKER");
    std::cerr << error.what() << std::endl;
    return 1;
  }
}
#endif
