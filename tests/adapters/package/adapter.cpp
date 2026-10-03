#include "adapter_loader.h"
#include <AdapterFixtureJSI.h>
#include <react/bridging/Promise.h>
#include <react/renderer/components/AdapterFixture/ComponentDescriptors.h>
#include <godot_cpp/classes/button.hpp>
#include <godot_cpp/variant/callable_custom.hpp>
#include <folly/json.h>
#include <atomic>
#include <thread>

namespace rn = facebook::react;
namespace jsi = facebook::jsi;
using ProbeResult = rn::NativeExternalProbeProbeResult<std::string, double>;
namespace facebook::react {
template <> struct Bridging<ProbeResult> : NativeExternalProbeProbeResultBridging<ProbeResult> {};
}
namespace {
struct State {
  bool stopped{};
  int creates{}, disposals{}, updates{}, commands{}, modules{}, accepted{}, rejected{};
  std::vector<std::function<bool(const fabric_godot::AdapterViewContext::Event &)>> captured;
  bool fire(size_t index, bool off_thread = false) {
    if (index >= captured.size()) return false;
    auto deliver = [this, index] {
      return captured[index]([](const rn::ShadowView &current) {
        auto props = std::static_pointer_cast<const rn::ExternalBadgeProps>(current.props);
        auto emitter = std::static_pointer_cast<const rn::ExternalBadgeEventEmitter>(current.eventEmitter);
        emitter->onBadgeActivate({props->count, props->caption});
      });
    };
    bool result = false;
    if (off_thread) { std::thread worker([&] { result = deliver(); }); worker.join(); }
    else result = deliver();
    if (result) ++accepted; else ++rejected;
    return result;
  }
};
class Press final : public godot::CallableCustom {
 public:
  Press(std::weak_ptr<State> state, size_t index) : state(std::move(state)), index(index) {}
  uint32_t hash() const override { return static_cast<uint32_t>(reinterpret_cast<uintptr_t>(this)); }
  godot::String get_as_text() const override { return "AdapterFixture pressed"; }
  CompareEqualFunc get_compare_equal_func() const override { return [](const CallableCustom *a, const CallableCustom *b) { return a == b; }; }
  CompareLessFunc get_compare_less_func() const override { return [](const CallableCustom *a, const CallableCustom *b) { return std::less<const CallableCustom *>{}(a,b); }; }
  godot::ObjectID get_object() const override { return {}; }
  bool is_valid() const override { return !state.expired(); }
  void call(const godot::Variant **, int count, godot::Variant &result, GDExtensionCallError &error) const override {
    result = godot::Variant(); error.error = count ? GDEXTENSION_CALL_ERROR_TOO_MANY_ARGUMENTS : GDEXTENSION_CALL_OK;
    if (!count) if (auto owner = state.lock()) owner->fire(index);
  }
 private:
  std::weak_ptr<State> state; size_t index;
};
class Badge final : public fabric_godot::AdapterView {
 public:
  Badge(std::shared_ptr<State> state, fabric_godot::AdapterViewContext context) : state(std::move(state)) {
    button = memnew(godot::Button);
    button->set_clip_text(true);
    index = this->state->captured.size();
    this->state->captured.push_back(std::move(context.dispatch_event));
    pressed = godot::Callable(memnew(Press(this->state, index)));
    button->connect("pressed", pressed);
    ++this->state->creates;
  }
  ~Badge() override { dispose(); }
  godot::Control *control() const override { return button; }
  void update(const rn::ShadowView &, const rn::ShadowView &current) override {
    auto props = std::static_pointer_cast<const rn::ExternalBadgeProps>(current.props);
    caption = props->caption; enabled = props->enabled; count = props->count;
    button->set_text(godot::String::utf8(caption.c_str()));
    button->set_disabled(!enabled);
    ++state->updates;
  }
  bool command(const std::string &name, const folly::dynamic &args) override {
    if (disposed || name != "focus" || !args.isArray() || !args.empty()) return false;
    button->grab_focus(); ++state->commands; return true;
  }
  folly::dynamic snapshot() const override {
    return folly::dynamic::object("caption",caption)("enabled",enabled)("count",count)("capturedIndex",index)("disposed",disposed);
  }
  void dispose() noexcept override {
    if (disposed) return;
    disposed = true;
    if (button && button->is_connected("pressed", pressed)) button->disconnect("pressed", pressed);
    ++state->disposals;
  }
 private:
  std::shared_ptr<State> state; godot::Button *button{}; godot::Callable pressed;
  size_t index{}; bool disposed{}, enabled{}; int count{}; std::string caption;
};
class Probe final : public rn::NativeExternalProbeCxxSpec<Probe> {
 public:
  Probe(std::shared_ptr<rn::CallInvoker> invoker, std::shared_ptr<State> state)
      : NativeExternalProbeCxxSpec<Probe>(std::move(invoker)), state(std::move(state)) { ++this->state->modules; }
  void live() const { if (state->stopped) throw std::runtime_error("E_ADAPTER_STOPPED: ExternalProbe"); }
  double add(jsi::Runtime &, double left, double right) { live(); return left + right; }
  rn::AsyncPromise<ProbeResult> describe(jsi::Runtime &runtime, std::string label) {
    live(); rn::AsyncPromise<ProbeResult> result(runtime, jsInvoker_);
    ProbeResult value{std::move(label),42}; emitOnResult(value); result.resolve(value); return result;
  }
  std::string getStats(jsi::Runtime &) {
    return folly::toJson(folly::dynamic::object("creates",state->creates)("disposals",state->disposals)
        ("updates",state->updates)("commands",state->commands)("modules",state->modules)
        ("accepted",state->accepted)("rejected",state->rejected)("stopped",state->stopped));
  }
  bool fireCaptured(jsi::Runtime &, int32_t index, bool off_thread) { live(); return index >= 0 && state->fire(index,off_thread); }
  void reset(jsi::Runtime &) { live(); }
 private: std::shared_ptr<State> state;
};
}
extern "C" void godot_fabric_adapter_init_v1(fabric_godot::AdapterRegistry &registry) {
  auto state = std::make_shared<State>();
  registry.add_component(rn::concreteComponentDescriptorProvider<rn::ExternalBadgeComponentDescriptor>(),
      [state](fabric_godot::AdapterViewContext context) { return std::make_unique<Badge>(state,std::move(context)); });
  registry.add_module("ExternalProbe", [state](jsi::Runtime &, const std::shared_ptr<rn::CallInvoker> &invoker) {
    return std::make_shared<Probe>(invoker,state);
  }, [state] { state->stopped = true; });
}
extern "C" const fabric_godot::AdapterBindingWitness *godot_fabric_adapter_bindings_v1() {
  static const auto witness = fabric_godot::adapter_binding_witness();
  return &witness;
}
