#pragma once

#include "adapter_registry.h"
#include <godot_cpp/godot.hpp>
#include <jsi/JSIDynamic.h>
#include <hermes/hermes.h>
#include <react/renderer/componentregistry/componentNameByReactViewName.h>
#include <memory>
#include <string>

namespace fabric_godot {
// Additional experimental export required by this loader. The adapter's own TU
// supplies the addresses it resolves; a hidden duplicate binding produces
// different addresses. This is an observed binding witness, not a proof that no
// other code was duplicated or that C++ ABI/behavior is certified.
struct AdapterBindingWitness {
  uint32_t size{sizeof(AdapterBindingWitness)};
  uint32_t version{1};
  const void *godot_get_proc_address{};
  const void *godot_library{};
  const void *godot_token{};
  const void *react_native{};
  const void *jsi{};
  const void *hermes{};
};
// Internal linkage is deliberate: produce the witness in the adapter TU,
// rather than importing a helper already compiled into the host.
static inline AdapterBindingWitness adapter_binding_witness() {
  return {sizeof(AdapterBindingWitness), 1,
      &godot::internal::gdextension_interface_get_proc_address,
      &godot::internal::library, &godot::internal::token,
      reinterpret_cast<const void *>(&facebook::react::componentNameByReactViewName),
      reinterpret_cast<const void *>(&facebook::jsi::valueFromDynamic),
      reinterpret_cast<const void *>(&facebook::hermes::makeHermesRuntime)};
}
// extern "C" const AdapterBindingWitness *godot_fabric_adapter_bindings_v1();
// Experimental macOS arm64 Release loader. The selected packet is produced by
// the build's original Codegen preflight. This layer rechecks its deployment
// bytes/combination before loading; it does not execute Codegen or certify ABI.
// All arguments are canonical filesystem paths, resolved by the Godot owner.
// Empty selection disables external loading and supplies a sealed empty registry.
class AdapterLoader {
 public:
  AdapterLoader(const std::string &selection_path,
                const std::string &host_combination_path,
                const std::string &project_root,
                const std::string &expected_bundle_path = {});
  ~AdapterLoader();
  AdapterLoader(const AdapterLoader &) = delete;
  AdapterLoader &operator=(const AdapterLoader &) = delete;
  std::shared_ptr<AdapterRegistry> registry() const;
  folly::dynamic snapshot() const;
 private:
  struct Impl;
  std::unique_ptr<Impl> impl;
};
// Construction is one activation attempt. The owner must not retry a failed
// attempt on the same application: native static initializers may already have
// executed. Loaded libraries remain pinned for the process, including failures;
// stop/unmount dispose authorities/objects, never unload a library or hot-swap it.
} // namespace fabric_godot
