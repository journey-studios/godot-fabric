#include "adapter_registry.h"
#include "godot_component.h"
#include <react/renderer/componentregistry/componentNameByReactViewName.h>
#include <react/renderer/components/root/RootComponentDescriptor.h>
#include <react/renderer/components/modal/ModalHostViewComponentDescriptor.h>
#include <react/renderer/components/scrollview/ScrollViewComponentDescriptor.h>
#include <react/renderer/components/text/ParagraphComponentDescriptor.h>
#include <react/renderer/components/text/RawTextComponentDescriptor.h>
#include <react/renderer/components/text/TextComponentDescriptor.h>
#include <algorithm>
#include <map>
#include <set>
#include <stdexcept>

namespace fabric_godot {
namespace rn = facebook::react;
namespace {
bool identifier(const std::string &name) {
  if (name.empty()) return false;
  auto letter = [](unsigned char c) { return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '_'; };
  if (!letter(name.front())) return false;
  return std::all_of(name.begin(), name.end(), [&](unsigned char c) { return letter(c) || (c >= '0' && c <= '9'); });
}
std::string key(const std::string &name) { return rn::componentNameByReactViewName(name); }
struct Disposal {
  TurboModuleRegistry::Dispose callback;
  bool invoked{};
  void invoke() {
    if (invoked) return;
    invoked = true;
    if (callback) callback();
  }
  ~Disposal() { try { invoke(); } catch (...) {} }
};
}

struct AdapterRegistry::Impl {
  struct Module { TurboModuleRegistry::Factory factory; std::shared_ptr<Disposal> disposal; std::string adapter_id; };
  std::map<rn::ComponentHandle, Component> components;
  std::map<std::string, rn::ComponentHandle> names;
  std::map<std::string, Module> modules;
  std::set<std::string> adapters;
  std::set<rn::ComponentHandle> core_handles;
  std::set<std::string> core_names;
  std::set<std::string> core_modules{"NativeDOMCxx", "DeviceInfo", "SourceCode",
      "NativeReactNativeFeatureFlagsCxx", "GodotFabricServices", "GodotFabricNativeFixture"};
  std::string registering;
  std::set<std::string> expected_components, expected_modules;
  bool sealed{}, modules_installed{}, stopped{}, rolling_back{};

  Impl() {
    const rn::ComponentDescriptorProvider core[] = {
        rn::concreteComponentDescriptorProvider<ControlDescriptor>(),
        rn::concreteComponentDescriptorProvider<rn::RootComponentDescriptor>(),
        rn::concreteComponentDescriptorProvider<rn::ModalHostViewComponentDescriptor>(),
        rn::concreteComponentDescriptorProvider<rn::ScrollViewComponentDescriptor>(),
        rn::concreteComponentDescriptorProvider<rn::ParagraphComponentDescriptor>(),
        rn::concreteComponentDescriptorProvider<rn::TextComponentDescriptor>(),
        rn::concreteComponentDescriptorProvider<rn::RawTextComponentDescriptor>()};
    for (const auto &provider : core) { core_handles.insert(provider.handle); core_names.insert(provider.name); }
    // Reserve the ordinary RN component namespace, including compatibility
    // aliases, even when that core contract is still under implementation.
    for (const auto *name : {"View", "Text", "VirtualText", "SelectableText", "Image", "ImageView",
        "TextInput", "SinglelineTextInputView", "MultilineTextInputView", "Button", "Pressable",
        "SafeAreaView", "ActivityIndicator", "Switch", "Modal", "ScrollView", "ScrollContentView",
        "AndroidHorizontalScrollView", "RefreshControl", "PullToRefreshView", "ShimmeringView"}) {
      core_names.insert(name); core_names.insert(key(name));
    }
  }
  void require_registration() const {
    if (sealed || registering.empty()) throw std::logic_error("E_ADAPTER_REGISTRATION: outside the selected initializer");
  }
  void clear_registration() { registering.clear(); expected_components.clear(); expected_modules.clear(); }
};

AdapterRegistry::AdapterRegistry() : impl(std::make_unique<Impl>()) {}
AdapterRegistry::~AdapterRegistry() = default;

void AdapterRegistry::register_adapter(const std::string &id, const std::vector<std::string> &components,
    const std::vector<std::string> &modules, Initializer initializer) {
  if (impl->sealed || impl->stopped || impl->rolling_back || !impl->registering.empty())
    throw std::logic_error("E_ADAPTER_REGISTRATION: registry is sealed, rolling back or initialization is nested");
  if (!identifier(id) || (components.empty() && modules.empty()) || !initializer || impl->adapters.contains(id))
    throw std::invalid_argument("E_ADAPTER_DECLARATION: invalid, empty or repeated adapter " + id);
  std::set<std::string> selected_components, selected_modules, normalized;
  for (const auto &name : components) {
    const auto unified = key(name);
    if (!identifier(name) || unified != name || !selected_components.insert(name).second ||
        !normalized.insert(unified).second || impl->core_names.contains(name) || impl->core_names.contains(unified) ||
        impl->names.contains(unified) || impl->modules.contains(name))
      throw std::invalid_argument("E_ADAPTER_COMPONENT_COLLISION: " + name);
  }
  for (const auto &name : modules)
    if (!identifier(name) || selected_components.contains(name) || impl->names.contains(name) ||
        !selected_modules.insert(name).second || impl->core_modules.contains(name) || impl->modules.contains(name))
      throw std::invalid_argument("E_ADAPTER_MODULE_COLLISION: " + name);
  impl->registering = id;
  impl->expected_components = std::move(selected_components);
  impl->expected_modules = std::move(selected_modules);
  try {
    initializer(*this);
    if (!impl->expected_components.empty() || !impl->expected_modules.empty())
      throw std::invalid_argument("E_ADAPTER_REGISTRATION_INCOMPLETE: " + id);
    impl->adapters.insert(id);
    impl->clear_registration();
  } catch (...) {
    // Roll back this initializer only; earlier selected adapters stay intact.
    // Retire its authority before destructors invoke accepted cleanup: cleanup
    // cannot re-enter registration after a rollback loop already passed a kind.
    impl->rolling_back = true;
    impl->clear_registration();
    for (auto it = impl->components.begin(); it != impl->components.end();) {
      if (it->second.adapter_id != id) { ++it; continue; }
      impl->names.erase(it->second.provider.name);
      it = impl->components.erase(it);
    }
    for (auto it = impl->modules.begin(); it != impl->modules.end();) {
      if (it->second.adapter_id != id) { ++it; continue; }
      it = impl->modules.erase(it);
    }
    impl->rolling_back = false;
    throw;
  }
}

void AdapterRegistry::add_component(rn::ComponentDescriptorProvider provider, ViewFactory factory) {
  impl->require_registration();
  const std::string name = provider.name ? provider.name : "";
  if (!factory || !provider.handle || !provider.constructor || provider.flavor ||
      !impl->expected_components.contains(name) || impl->components.contains(provider.handle) || impl->core_handles.contains(provider.handle))
    throw std::invalid_argument("E_ADAPTER_COMPONENT_PROVIDER: " + name);
  impl->components.emplace(provider.handle, Component{provider, std::move(factory), impl->registering});
  impl->names.emplace(name, provider.handle);
  impl->expected_components.erase(name);
}

void AdapterRegistry::add_module(const std::string &name, TurboModuleRegistry::Factory factory,
    TurboModuleRegistry::Dispose dispose) {
  impl->require_registration();
  if (!factory || !impl->expected_modules.contains(name)) throw std::invalid_argument("E_ADAPTER_MODULE_PROVIDER: " + name);
  auto disposal = std::make_shared<Disposal>();
  disposal->callback = std::move(dispose);
  impl->modules.emplace(name, Impl::Module{std::move(factory), std::move(disposal), impl->registering});
  impl->expected_modules.erase(name);
}

void AdapterRegistry::seal() {
  if (impl->stopped || impl->rolling_back || !impl->registering.empty())
    throw std::logic_error("E_ADAPTER_REGISTRATION: registry is stopped, rolling back or initializer is active");
  impl->sealed = true;
}
bool AdapterRegistry::sealed() const { return impl->sealed; }
const AdapterRegistry::Component *AdapterRegistry::component(rn::ComponentHandle handle) const {
  if (!impl->sealed) throw std::logic_error("E_ADAPTER_REGISTRATION: registry is not sealed");
  if (impl->stopped) return nullptr;
  auto found = impl->components.find(handle);
  return found == impl->components.end() ? nullptr : &found->second;
}
const AdapterRegistry::Component *AdapterRegistry::requested_component(const std::string &name) const {
  if (!impl->sealed) throw std::logic_error("E_ADAPTER_REGISTRATION: registry is not sealed");
  auto found = impl->names.find(key(name));
  return found == impl->names.end() ? nullptr : component(found->second);
}
void AdapterRegistry::install_modules(TurboModuleRegistry &modules) {
  if (!impl->sealed || impl->stopped || impl->modules_installed) throw std::logic_error("E_ADAPTER_REGISTRATION: module installation requires a fresh sealed registry");
  for (const auto &[name, entry] : impl->modules) {
    auto disposal = entry.disposal;
    modules.add(name, [factory = entry.factory, disposal](auto &runtime, const auto &invoker) {
      if (disposal->invoked) throw std::runtime_error("E_ADAPTER_STOPPED: module provider was disposed");
      return factory(runtime, invoker);
    }, [disposal] { disposal->invoke(); });
  }
  impl->modules_installed = true;
}
void AdapterRegistry::dispose_modules() {
  if (impl->stopped) return;
  if (impl->rolling_back || !impl->registering.empty())
    throw std::logic_error("E_ADAPTER_REGISTRATION: rollback or initializer is active");
  impl->stopped = true;
  std::string errors;
  for (auto &[name, entry] : impl->modules) {
    try { entry.disposal->invoke(); }
    catch (const std::exception &error) { errors += "; " + name + ": " + error.what(); }
    catch (...) { errors += "; " + name + ": unknown exception"; }
  }
  if (!errors.empty()) throw std::runtime_error("E_ADAPTER_DISPOSAL:" + errors);
}
folly::dynamic AdapterRegistry::snapshot() const {
  auto adapters = folly::dynamic::array();
  for (const auto &id : impl->adapters) adapters.push_back(id);
  auto components = folly::dynamic::array();
  for (const auto &[name, handle] : impl->names) components.push_back(name);
  auto modules = folly::dynamic::array();
  for (const auto &[name, entry] : impl->modules) modules.push_back(name);
  return folly::dynamic::object("sealed", impl->sealed)("stopped", impl->stopped)("moduleProvidersInstalled", impl->modules_installed)
      ("adapters", std::move(adapters))("components", std::move(components))("modules", std::move(modules));
}
} // namespace fabric_godot
