// Compilation witness only: no VM, adapter registration or native UI is run.
#include <CodegenFixtureJSI.h>
#include <react/bridging/Promise.h>
#include <react/renderer/components/CodegenFixture/ComponentDescriptors.h>
#include <memory>
#include <string>
#include <utility>

using ProbeResult = facebook::react::NativeCodegenProbeProbeResult<std::string, double>;

namespace facebook::react {
template <>
struct Bridging<ProbeResult> : NativeCodegenProbeProbeResultBridging<ProbeResult> {};
}

namespace fabric_godot::codegen_compile {
namespace rn = facebook::react;
namespace jsi = facebook::jsi;

class Probe final : public rn::NativeCodegenProbeCxxSpec<Probe> {
 public:
  explicit Probe(std::shared_ptr<rn::CallInvoker> invoker)
      : NativeCodegenProbeCxxSpec<Probe>(std::move(invoker)) {}

  double add(jsi::Runtime &, double left, double right) { return left + right; }

  rn::AsyncPromise<ProbeResult> describe(jsi::Runtime &runtime, std::string label) {
    rn::AsyncPromise<ProbeResult> promise(runtime, jsInvoker_);
    ProbeResult value{std::move(label), 42};
    emitOnResult(value);
    promise.resolve(value);
    return promise;
  }

  void reset(jsi::Runtime &) {}
};

// These concrete uses instantiate the generated provider, CxxSpec method
// wrappers and both ProbeResult conversion bodies. No function is executed.
rn::ComponentDescriptorProvider badge_provider() {
  return rn::concreteComponentDescriptorProvider<rn::CodegenBadgeComponentDescriptor>();
}

std::shared_ptr<rn::TurboModule> make_probe(std::shared_ptr<rn::CallInvoker> invoker) {
  return std::make_shared<Probe>(std::move(invoker));
}

ProbeResult read_probe_result(jsi::Runtime &runtime, const jsi::Object &value,
                              const std::shared_ptr<rn::CallInvoker> &invoker) {
  return rn::bridging::fromJs<ProbeResult>(runtime, value, invoker);
}
}
