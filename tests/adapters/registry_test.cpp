// Standalone registry contract: use the original generated provider, but do
// not construct Godot Controls, a SceneTree, Hermes or a JSI Runtime.
#include "adapter_registry.h"
#include <react/renderer/components/CodegenFixture/ComponentDescriptors.h>
#include <react/renderer/components/root/RootComponentDescriptor.h>
#include <cstddef>
#include <functional>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace {
namespace rn = facebook::react;
using Registry = fabric_godot::AdapterRegistry;
using Body = std::function<void(Registry &)>;
struct Counters {
  int checks{}, cases{}, initializers{}, forbidden_initializers{}, view_factories{}, module_factories{};
} counters;
const Body *active_body{};

void check(bool condition, const std::string &message) {
  if (!condition) throw std::runtime_error("REGISTRY_ASSERTION: " + message);
  ++counters.checks;
}

template <typename F> void rejects(const std::string &code, F action) {
  try { action(); }
  catch (const std::exception &error) {
    check(std::string(error.what()).starts_with(code + ":"), "expected " + code + ", got " + error.what());
    return;
  }
  throw std::runtime_error("REGISTRY_ASSERTION: expected exception " + code);
}

void initializer(Registry &registry) {
  ++counters.initializers;
  if (!active_body) throw std::runtime_error("test initializer has no selected body");
  (*active_body)(registry);
}

void forbidden_initializer(Registry &) {
  ++counters.forbidden_initializers;
  throw std::runtime_error("initializer ran before declaration selection succeeded");
}

void select(Registry &registry, const std::string &id, const std::vector<std::string> &components,
            const std::vector<std::string> &modules, Body body) {
  const Body *previous = active_body;
  active_body = &body;
  try { registry.register_adapter(id, components, modules, initializer); }
  catch (...) { active_body = previous; throw; }
  active_body = previous;
}

rn::ComponentDescriptorProvider badge() {
  return rn::concreteComponentDescriptorProvider<rn::CodegenBadgeComponentDescriptor>();
}

Registry::ViewFactory view_factory() {
  return [](fabric_godot::AdapterViewContext) -> std::unique_ptr<fabric_godot::AdapterView> {
    ++counters.view_factories;
    throw std::runtime_error("registry executed a view factory");
  };
}

fabric_godot::TurboModuleRegistry::Factory module_factory() {
  return [](facebook::jsi::Runtime &, const std::shared_ptr<rn::CallInvoker> &) -> std::shared_ptr<rn::TurboModule> {
    ++counters.module_factories;
    return nullptr; // Never invoked: this test does not create a VM/invoker.
  };
}

void snapshot(Registry &registry, std::size_t adapters, std::size_t components, std::size_t modules) {
  const auto state = registry.snapshot();
  check(state["adapters"].size() == adapters, "adapter count");
  check(state["components"].size() == components, "component count");
  check(state["modules"].size() == modules, "module count");
  check(!state["moduleProvidersInstalled"].asBool(), "lookup/selection must not install modules");
}

void empty_and_unsealed() {
  ++counters.cases;
  Registry registry;
  check(!registry.sealed(), "fresh registry is unsealed");
  snapshot(registry, 0, 0, 0);
  rejects("E_ADAPTER_REGISTRATION", [&] { registry.component(badge().handle); });
  rejects("E_ADAPTER_REGISTRATION", [&] { registry.requested_component("CodegenBadge"); });
  rejects("E_ADAPTER_REGISTRATION", [&] { registry.add_component(badge(), view_factory()); });
  rejects("E_ADAPTER_REGISTRATION", [&] { registry.add_module("Probe", module_factory()); });
}

void declaration_selection_precedes_initializer() {
  ++counters.cases;
  Registry registry;
  const auto fail_component = [&](const std::vector<std::string> &components) {
    rejects("E_ADAPTER_COMPONENT_COLLISION", [&] {
      registry.register_adapter("Rejected", components, {}, forbidden_initializer);
    });
  };
  for (const auto &id : {"", "bad-id", "4Adapter"}) {
    rejects("E_ADAPTER_DECLARATION", [&] {
      registry.register_adapter(id, {"CodegenBadge"}, {}, forbidden_initializer);
    });
  }
  rejects("E_ADAPTER_DECLARATION", [&] { registry.register_adapter("Empty", {}, {}, forbidden_initializer); });
  rejects("E_ADAPTER_DECLARATION", [&] { registry.register_adapter("Null", {"CodegenBadge"}, {}, nullptr); });
  fail_component({"CodegenBadge", "CodegenBadge"});
  fail_component({"bad-name"});
  for (const auto &name : {"GodotControl", "RootView", "View", "ScrollView", "Paragraph", "RawText", "Image", "TextInput"})
    fail_component({name});
  // The first SPI explicitly refuses aliases as declarations: its generated
  // descriptor must expose the canonical name. Requested lookups may alias it.
  for (const auto &name : {"RCTCodegenBadge", "RCTText", "VirtualText", "ImageView", "ScrollContentView"})
    fail_component({name});
  for (const auto &name : {"NativeDOMCxx", "DeviceInfo", "SourceCode", "NativeReactNativeFeatureFlagsCxx",
                          "GodotFabricServices", "GodotFabricNativeFixture"}) {
    rejects("E_ADAPTER_MODULE_COLLISION", [&] { registry.register_adapter("Rejected", {}, {name}, forbidden_initializer); });
  }
  rejects("E_ADAPTER_MODULE_COLLISION", [&] {
    registry.register_adapter("Rejected", {}, {"Probe", "Probe"}, forbidden_initializer);
  });
  rejects("E_ADAPTER_MODULE_COLLISION", [&] { registry.register_adapter("Rejected", {}, {"bad-module"}, forbidden_initializer); });
  rejects("E_ADAPTER_MODULE_COLLISION", [&] {
    registry.register_adapter("Shared", {"CodegenBadge"}, {"CodegenBadge"}, forbidden_initializer);
  });
  check(counters.forbidden_initializers == 0, "invalid selection never invokes initializer");
  snapshot(registry, 0, 0, 0);
  select(registry, "Accepted", {}, {"Probe"}, [](Registry &current) { current.add_module("Probe", module_factory()); });
  rejects("E_ADAPTER_DECLARATION", [&] { registry.register_adapter("Accepted", {"OtherBadge"}, {}, forbidden_initializer); });
  rejects("E_ADAPTER_MODULE_COLLISION", [&] { registry.register_adapter("Other", {}, {"Probe"}, forbidden_initializer); });
  rejects("E_ADAPTER_COMPONENT_COLLISION", [&] { registry.register_adapter("Other", {"Probe"}, {}, forbidden_initializer); });
  snapshot(registry, 1, 0, 1);
}

void initializer_context_and_sealing() {
  ++counters.cases;
  Registry registry;
  select(registry, "Context", {"CodegenBadge"}, {}, [](Registry &current) {
    rejects("E_ADAPTER_REGISTRATION", [&] { current.seal(); });
    rejects("E_ADAPTER_REGISTRATION", [&] { current.dispose_modules(); });
    rejects("E_ADAPTER_REGISTRATION", [&] { current.component(badge().handle); });
    rejects("E_ADAPTER_REGISTRATION", [&] { current.requested_component("CodegenBadge"); });
    rejects("E_ADAPTER_REGISTRATION", [&] {
      current.register_adapter("Nested", {}, {"NestedProbe"}, forbidden_initializer);
    });
    current.add_component(badge(), view_factory());
  });
  rejects("E_ADAPTER_REGISTRATION", [&] { registry.add_component(badge(), view_factory()); });
  rejects("E_ADAPTER_REGISTRATION", [&] { registry.add_module("LateProbe", module_factory()); });
  registry.seal(); registry.seal();
  check(registry.sealed(), "seal is terminal and idempotent");
  check(registry.snapshot()["sealed"].asBool(), "sealed state is observable");
  rejects("E_ADAPTER_REGISTRATION", [&] { registry.register_adapter("Late", {}, {"LateProbe"}, forbidden_initializer); });
  rejects("E_ADAPTER_REGISTRATION", [&] { registry.add_component(badge(), view_factory()); });
  rejects("E_ADAPTER_REGISTRATION", [&] { registry.add_module("LateProbe", module_factory()); });
  check(counters.forbidden_initializers == 0, "nested/sealed selection never invokes initializer");
}

void complete_registration_and_lookup_are_lazy() {
  ++counters.cases;
  int disposals{};
  {
    Registry registry;
    const auto original = badge();
    check(original.handle != 0 && original.constructor != nullptr, "real generated provider has handle/constructor");
    check(std::string(original.name) == "CodegenBadge" && !original.flavor, "original generated provider identity");
    select(registry, "Complete", {"CodegenBadge"}, {"Probe"}, [&](Registry &current) {
      current.add_component(original, view_factory());
      current.add_module("Probe", module_factory(), [&] { ++disposals; });
    });
    snapshot(registry, 1, 1, 1);
    registry.seal();
    const auto *found = registry.component(original.handle);
    check(found != nullptr, "registered generated handle lookup");
    check(found->provider.handle == original.handle && found->provider.constructor == original.constructor,
          "registry retains original generated provider");
    check(found->adapter_id == "Complete" && static_cast<bool>(found->factory), "factory registration ownership");
    check(registry.requested_component("CodegenBadge") == found, "canonical name lookup");
    check(registry.requested_component("RCTCodegenBadge") == found, "upstream RCT request normalization");
    check(registry.requested_component("MissingBadge") == nullptr, "unknown component lookup does not create a view");
    check(registry.requested_component("GodotControl") == nullptr, "core component is not an external registration");
    check(registry.component(0) == nullptr, "unknown handle lookup");
    check(counters.view_factories == 0 && counters.module_factories == 0, "lookups remain lazy");
    check(disposals == 0, "unclaimed module remains owned until registry destruction");
  }
  check(disposals == 1, "complete but unclaimed module disposed exactly once");
}

void component_provider_validation_and_rollback() {
  ++counters.cases;
  Registry registry;
  for (int mutation = 0; mutation != 5; ++mutation) {
    rejects("E_ADAPTER_COMPONENT_PROVIDER", [&] {
      select(registry, "Invalid", {"CodegenBadge"}, {}, [mutation](Registry &current) {
        auto provider = badge();
        if (mutation == 0) provider.name = nullptr;
        if (mutation == 1) provider.name = "UndeclaredBadge";
        if (mutation == 2) provider.handle = 0;
        if (mutation == 3) provider.constructor = nullptr;
        if (mutation == 4) provider.flavor = std::make_shared<const int>(7);
        current.add_component(provider, view_factory());
      });
    });
    snapshot(registry, 0, 0, 0);
  }
  rejects("E_ADAPTER_COMPONENT_PROVIDER", [&] {
    select(registry, "Invalid", {"CodegenBadge"}, {}, [](Registry &current) { current.add_component(badge(), {}); });
  });
  rejects("E_ADAPTER_COMPONENT_PROVIDER", [&] {
    select(registry, "Duplicate", {"CodegenBadge"}, {}, [](Registry &current) {
      current.add_component(badge(), view_factory());
      current.add_component(badge(), view_factory());
    });
  });
  snapshot(registry, 0, 0, 0);
  select(registry, "Invalid", {"CodegenBadge"}, {}, [](Registry &current) { current.add_component(badge(), view_factory()); });
  registry.seal();
  check(registry.requested_component("CodegenBadge") != nullptr, "failed IDs and components may be selected again");
}

void provider_handle_collisions_preserve_prior_selection() {
  ++counters.cases;
  Registry registry;
  select(registry, "Prior", {"CodegenBadge"}, {}, [](Registry &current) { current.add_component(badge(), view_factory()); });
  const auto attempt = [&](rn::ComponentHandle handle) {
    rejects("E_ADAPTER_COMPONENT_PROVIDER", [&] {
      select(registry, "Collision", {"OtherBadge"}, {}, [handle](Registry &current) {
        // Metadata mutation is an adversarial provider, never constructed.
        auto provider = badge(); provider.name = "OtherBadge"; provider.handle = handle;
        current.add_component(provider, view_factory());
      });
    });
    snapshot(registry, 1, 1, 0);
  };
  attempt(badge().handle);
  attempt(rn::concreteComponentDescriptorProvider<rn::RootComponentDescriptor>().handle);
  rejects("E_ADAPTER_COMPONENT_COLLISION", [&] { registry.register_adapter("Duplicate", {"CodegenBadge"}, {}, forbidden_initializer); });
  rejects("E_ADAPTER_MODULE_COLLISION", [&] { registry.register_adapter("Other", {}, {"CodegenBadge"}, forbidden_initializer); });
  registry.seal();
  check(registry.requested_component("CodegenBadge")->adapter_id == "Prior", "prior owner survives both handle collisions");
  check(registry.requested_component("OtherBadge") == nullptr, "failed provider name never leaks");
}

void module_provider_validation_and_rollback() {
  ++counters.cases;
  Registry registry;
  rejects("E_ADAPTER_MODULE_PROVIDER", [&] {
    select(registry, "Undeclared", {}, {"Probe"}, [](Registry &current) { current.add_module("OtherProbe", module_factory()); });
  });
  rejects("E_ADAPTER_MODULE_PROVIDER", [&] {
    select(registry, "Null", {}, {"Probe"}, [](Registry &current) { current.add_module("Probe", {}); });
  });
  int disposals{};
  rejects("E_ADAPTER_MODULE_PROVIDER", [&] {
    select(registry, "Duplicate", {}, {"Probe"}, [&](Registry &current) {
      current.add_module("Probe", module_factory(), [&] { ++disposals; });
      current.add_module("Probe", module_factory());
    });
  });
  check(disposals == 1, "accepted duplicate-attempt state rolled back once");
  snapshot(registry, 0, 0, 0);
  select(registry, "Undeclared", {}, {"Probe"}, [](Registry &current) { current.add_module("Probe", module_factory()); });
  snapshot(registry, 1, 0, 1);
}

void incomplete_initializer_rolls_back_only_current_adapter() {
  ++counters.cases;
  int prior_disposals{}, failed_disposals{}, retry_disposals{}, rejected_cleanup_registrations{};
  {
    Registry registry;
    select(registry, "Prior", {}, {"PriorProbe"}, [&](Registry &current) {
      current.add_module("PriorProbe", module_factory(), [&] { ++prior_disposals; });
    });
    rejects("E_ADAPTER_REGISTRATION_INCOMPLETE", [&] {
      select(registry, "Incomplete", {"CodegenBadge"}, {"FailedProbe", "MissingProbe"}, [&](Registry &current) {
        current.add_component(badge(), view_factory());
        current.add_module("FailedProbe", module_factory(), [&] { ++failed_disposals; });
      });
    });
    check(failed_disposals == 1 && prior_disposals == 0, "incomplete rollback releases only accepted current state");
    snapshot(registry, 1, 0, 1);
    rejects("E_ADAPTER_REGISTRATION_INCOMPLETE", [&] {
      select(registry, "Incomplete", {"CodegenBadge"}, {"FailedProbe", "MissingProbe"}, [&](Registry &current) {
        // Keep both names pending: cleanup must not inherit the initializer's
        // authority or insert providers after their rollback loops have run.
        current.add_module("FailedProbe", module_factory(), [&] {
          ++failed_disposals;
          rejects("E_ADAPTER_REGISTRATION", [&] { registry.add_component(badge(), view_factory()); });
          ++rejected_cleanup_registrations;
          rejects("E_ADAPTER_REGISTRATION", [&] { registry.add_module("MissingProbe", module_factory()); });
          ++rejected_cleanup_registrations;
          rejects("E_ADAPTER_REGISTRATION", [&] {
            registry.register_adapter("Incomplete", {"CodegenBadge"}, {"MissingProbe"}, forbidden_initializer);
          });
          ++rejected_cleanup_registrations;
          rejects("E_ADAPTER_REGISTRATION", [&] {
            registry.register_adapter("CleanupNested", {}, {"CleanupProbe"}, forbidden_initializer);
          });
          ++rejected_cleanup_registrations;
          rejects("E_ADAPTER_REGISTRATION", [&] { registry.seal(); });
          ++rejected_cleanup_registrations;
          rejects("E_ADAPTER_REGISTRATION", [&] { registry.dispose_modules(); });
          ++rejected_cleanup_registrations;
        });
      });
    });
    check(rejected_cleanup_registrations == 6, "rollback cleanup rejects provider, selection and lifecycle reentry");
    check(counters.forbidden_initializers == 0, "cleanup never invokes a nested initializer with the same or a new ID");
    check(!registry.sealed() && !registry.snapshot()["stopped"].asBool(), "cleanup cannot seal or stop the live registry");
    check(failed_disposals == 2 && prior_disposals == 0, "reentrant cleanup releases current state and preserves prior state");
    snapshot(registry, 1, 0, 1);
    select(registry, "Incomplete", {"CodegenBadge"}, {"FailedProbe"}, [&](Registry &current) {
      current.add_component(badge(), view_factory());
      current.add_module("FailedProbe", module_factory(), [&] { ++retry_disposals; });
    });
    snapshot(registry, 2, 1, 2);
    registry.seal();
    check(registry.requested_component("CodegenBadge")->adapter_id == "Incomplete", "component name/handle reusable after rollback");
    check(prior_disposals == 0 && retry_disposals == 0, "successful states remain owned");
  }
  check(prior_disposals == 1 && failed_disposals == 2 && retry_disposals == 1, "all accepted unclaimed state disposed once");
}

void throwing_initializer_rolls_back_and_clears_registration_context() {
  ++counters.cases;
  int failed_disposals{}, prior_disposals{}, recovered_disposals{};
  {
    Registry registry;
    select(registry, "Prior", {"CodegenBadge"}, {"PriorProbe"}, [&](Registry &current) {
      current.add_component(badge(), view_factory());
      current.add_module("PriorProbe", module_factory(), [&] { ++prior_disposals; });
    });
    rejects("INITIALIZER_FAILURE", [&] {
      select(registry, "Throwing", {}, {"ThrowProbe"}, [&](Registry &current) {
        current.add_module("ThrowProbe", module_factory(), [&] { ++failed_disposals; });
        throw std::runtime_error("INITIALIZER_FAILURE: after accepted state");
      });
    });
    snapshot(registry, 1, 1, 1);
    check(failed_disposals == 1 && prior_disposals == 0, "throw preserves prior module state");
    rejects("E_ADAPTER_REGISTRATION", [&] { registry.add_module("ThrowProbe", module_factory()); });
    select(registry, "Throwing", {}, {"ThrowProbe"}, [&](Registry &current) {
      current.add_module("ThrowProbe", module_factory(), [&] { ++recovered_disposals; });
    });
    snapshot(registry, 2, 1, 2);
    registry.seal();
    check(registry.requested_component("CodegenBadge")->adapter_id == "Prior", "throw preserves earlier generated descriptor");
  }
  check(failed_disposals == 1 && prior_disposals == 1 && recovered_disposals == 1, "throw/recovery/unclaimed disposal exactly once");
}

void disposal_exception_does_not_repeat_or_skip_other_unclaimed_state() {
  ++counters.cases;
  int throwing_disposals{}, ordinary_disposals{};
  {
    Registry registry;
    select(registry, "Cleanup", {}, {"AThrowing", "ZOrdinary"}, [&](Registry &current) {
      current.add_module("AThrowing", module_factory(), [&] {
        ++throwing_disposals;
        throw std::runtime_error("disposal callback failure");
      });
      current.add_module("ZOrdinary", module_factory(), [&] { ++ordinary_disposals; });
    });
    registry.seal();
    check(throwing_disposals == 0 && ordinary_disposals == 0, "no eager disposal before destruction");
    rejects("E_ADAPTER_DISPOSAL", [&] { registry.dispose_modules(); });
    check(throwing_disposals == 1 && ordinary_disposals == 1, "explicit stop continues disposing after callback failure");
    check(registry.snapshot()["stopped"].asBool(), "disposal error leaves registry terminal");
    registry.dispose_modules();
    check(throwing_disposals == 1 && ordinary_disposals == 1, "repeated disposal is idempotent after failure");
  }
  check(throwing_disposals == 1 && ordinary_disposals == 1, "destructor catches disposal error and releases remaining state once");
}

void module_installation_is_lazy_and_stop_is_terminal() {
  ++counters.cases;
  int runtime_executions{}, disposals{};
  {
    // A real RN scheduler/invoker can hold lazy providers without a VM. Fail
    // immediately if any operation tries to obtain JS runtime access.
    auto scheduler = std::make_shared<rn::RuntimeScheduler>([&](std::function<void(facebook::jsi::Runtime &)> &&) {
      ++runtime_executions;
      throw std::runtime_error("registry attempted to execute JS");
    });
    fabric_godot::TurboModuleRegistry target(9001, scheduler);
    {
      Registry registry;
      select(registry, "Installed", {"CodegenBadge"}, {"InstalledProbe"}, [&](Registry &current) {
        current.add_component(badge(), view_factory());
        current.add_module("InstalledProbe", module_factory(), [&] { ++disposals; });
      });
      rejects("E_ADAPTER_REGISTRATION", [&] { registry.install_modules(target); });
      check(target.snapshot()["registered"].asInt() == 0, "unsealed install does not mutate target registry");
      registry.seal();
      registry.install_modules(target);
      check(registry.snapshot()["moduleProvidersInstalled"].asBool(), "sealed providers installed once");
      check(target.snapshot()["registered"].asInt() == 1, "real TurboModule registry receives provider");
      check(target.snapshot()["loaded"].asInt() == 0 && target.snapshot()["creations"].asInt() == 0,
            "installation does not construct a native module");
      rejects("E_ADAPTER_REGISTRATION", [&] { registry.install_modules(target); });
      check(registry.requested_component("RCTCodegenBadge") != nullptr, "lookup live before stop");
      registry.dispose_modules();
      check(disposals == 1 && registry.snapshot()["stopped"].asBool(), "stop disposes installed provider once");
      check(registry.requested_component("CodegenBadge") == nullptr, "stopped lookup denies canonical provider");
      check(registry.requested_component("RCTCodegenBadge") == nullptr, "stopped lookup denies requested alias");
      check(registry.component(badge().handle) == nullptr, "stopped handle lookup cannot create a view");
      registry.dispose_modules();
      check(disposals == 1, "repeat stop does not repeat installed cleanup");
      rejects("E_ADAPTER_REGISTRATION", [&] { registry.seal(); });
      rejects("E_ADAPTER_REGISTRATION", [&] { registry.add_component(badge(), view_factory()); });
      rejects("E_ADAPTER_REGISTRATION", [&] { registry.add_module("LateProbe", module_factory()); });
      rejects("E_ADAPTER_REGISTRATION", [&] { registry.install_modules(target); });
      rejects("E_ADAPTER_REGISTRATION", [&] { registry.register_adapter("Late", {}, {"LateProbe"}, forbidden_initializer); });
      check(runtime_executions == 0 && counters.view_factories == 0 && counters.module_factories == 0,
            "installation/stop/lookup never obtains JS or factory access");
    }
    check(disposals == 1, "adapter registry destruction does not repeat installed cleanup");
  }
  check(disposals == 1 && runtime_executions == 0, "TurboModule registry/invoker destruction keeps exactly-once cleanup");
}
} // namespace

int main() {
  try {
    empty_and_unsealed();
    declaration_selection_precedes_initializer();
    initializer_context_and_sealing();
    complete_registration_and_lookup_are_lazy();
    component_provider_validation_and_rollback();
    provider_handle_collisions_preserve_prior_selection();
    module_provider_validation_and_rollback();
    incomplete_initializer_rolls_back_only_current_adapter();
    throwing_initializer_rolls_back_and_clears_registration_context();
    disposal_exception_does_not_repeat_or_skip_other_unclaimed_state();
    module_installation_is_lazy_and_stop_is_terminal();
    check(counters.forbidden_initializers == 0, "no initializer reached before selection");
    check(counters.view_factories == 0 && counters.module_factories == 0, "no view/module factory was executed");
    std::cout << "{\"format\":\"godot-fabric.experimental-adapter-registry-test/v1\",\"marker\":\"ADAPTER_REGISTRY_OK\","
              << "\"cases\":" << counters.cases << ",\"checks\":" << counters.checks
              << ",\"initializers\":" << counters.initializers << ",\"viewFactoryCalls\":" << counters.view_factories
              << ",\"moduleFactoryCalls\":" << counters.module_factories
              << ",\"vmCreated\":false,\"godotEngineStarted\":false}" << std::endl;
    return 0;
  } catch (const std::exception &error) {
    std::cerr << error.what() << std::endl;
    return 1;
  }
}
