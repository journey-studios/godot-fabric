#pragma once

#include "turbo_module_registry.h"
#include <godot_cpp/classes/control.hpp>
#include <react/renderer/componentregistry/ComponentDescriptorProvider.h>
#include <react/renderer/mounting/ShadowView.h>
#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace fabric_godot {
// Experimental C++ SPI: compile against the identified SDK combination.
// This is not a stable C ABI. An adapter imports the host's RN/JSI/Godot
// bindings and must not initialize a second GDExtension binding instance.
struct AdapterViewContext {
  uint64_t runtime_id{};
  uint64_t mount_id{};
  facebook::react::SurfaceId surface_id{};
  facebook::react::Tag tag{};
  using Event = std::function<void(const facebook::react::ShadowView &)>;
  // Deliver through the current committed emitter on the host thread. The
  // host rejects retired mounts, stopped roots/runtimes and off-thread calls.
  // Retaining this function does not retain event authority after removal.
  std::function<bool(const Event &)> dispatch_event;
};

class AdapterView {
 public:
  virtual ~AdapterView() = default;
  // Return an off-tree Control owned by the host once the factory succeeds.
  // The adapter owns its callbacks/state; it never deletes this Control.
  virtual godot::Control *control() const = 0;
  virtual godot::Control *children_host() const { return control(); }
  virtual void update(const facebook::react::ShadowView &previous,
                      const facebook::react::ShadowView &current) = 0;
  virtual bool command(const std::string &, const folly::dynamic &) { return false; }
  virtual folly::dynamic snapshot() const { return folly::dynamic::object(); }
  // Disconnect callbacks and release native work before the host deletes the
  // Control. Called once; destructors must also tolerate failed construction.
  virtual void dispose() noexcept = 0;
};

class AdapterRegistry {
 public:
  using ViewFactory = std::function<std::unique_ptr<AdapterView>(AdapterViewContext)>;
  struct Component {
    facebook::react::ComponentDescriptorProvider provider;
    ViewFactory factory;
    std::string adapter_id;
  };
  using Initializer = void (*)(AdapterRegistry &);

  AdapterRegistry();
  ~AdapterRegistry();
  AdapterRegistry(const AdapterRegistry &) = delete;
  AdapterRegistry &operator=(const AdapterRegistry &) = delete;
  // The loader preflights every selected manifest/combination before invoking
  // any initializer. Providers/factories are registered per application.
  void register_adapter(const std::string &id, const std::vector<std::string> &components,
                        const std::vector<std::string> &modules, Initializer initializer);
  // Only valid during the selected adapter's synchronous initializer. Never
  // retain the registry reference or register arbitrary providers afterward.
  void add_component(facebook::react::ComponentDescriptorProvider provider, ViewFactory factory);
  // Factory lookup remains lazy and belongs to one VM. Dispose must invalidate
  // extracted methods and pending work before VM destruction. Accepted cleanup
  // is called once even after rollback or without a module ever being created;
  // a rejected registration leaves its resources with the caller.
  void add_module(const std::string &name, TurboModuleRegistry::Factory factory,
                  TurboModuleRegistry::Dispose dispose = {});
  void seal();
  bool sealed() const;
  const Component *component(facebook::react::ComponentHandle handle) const;
  const Component *requested_component(const std::string &name) const;
  void install_modules(TurboModuleRegistry &modules);
  void dispose_modules();
  folly::dynamic snapshot() const;
 private:
  struct Impl;
  std::unique_ptr<Impl> impl;
};
} // namespace fabric_godot

// Entry point signature only. Native libraries define this function; the host
// calls it after manifest compatibility checks, not through Godot autoload.
// extern "C" void godot_fabric_adapter_init_v1(fabric_godot::AdapterRegistry &);
