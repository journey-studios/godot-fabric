#include "application_runtime.h"
#include "fabric_surface.h"
#include <godot_cpp/classes/input_event_mouse.hpp>
#include "godot_component.h"
#include "input_adapter.h"
#include "pointer_adapter.h"
#include "svg_node.h"
#include "scroll_adapter.h"
#include "appearance_adapter.h"
#include "paragraph_view.h"
#include "timer_registry.h"
#include "turbo_module_registry.h"
#include "godot_dom.h"
#include <react/runtime/TimerManager.h>
#include <react/renderer/components/text/ParagraphComponentDescriptor.h>
#include <react/renderer/components/text/TextComponentDescriptor.h>
#include <react/renderer/components/text/RawTextComponentDescriptor.h>
#include <godot_cpp/classes/input_event_mouse_button.hpp>
#include <react/renderer/components/scrollview/ScrollViewComponentDescriptor.h>
#include <algorithm>
#include <godot_cpp/classes/button.hpp>
#include <godot_cpp/classes/file_access.hpp>
#include <godot_cpp/classes/label.hpp>
#include <godot_cpp/classes/line_edit.hpp>
#include <godot_cpp/classes/panel.hpp>
#include <godot_cpp/classes/text_server.hpp>
#include <godot_cpp/classes/viewport.hpp>
#include <godot_cpp/classes/window.hpp>
#include <godot_cpp/variant/utility_functions.hpp>
#include <hermes/hermes.h>
#include <jsi/JSIDynamic.h>
#include <folly/json.h>
#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>
#include <react/renderer/core/EventQueueProcessor.h>
#include <react/renderer/runtimescheduler/RuntimeScheduler.h>
#include <react/renderer/runtimescheduler/RuntimeSchedulerBinding.h>
#include <react/renderer/uimanager/UIManager.h>
#include <react/renderer/uimanager/UIManagerBinding.h>
#include <react/renderer/uimanager/UIManagerDelegate.h>
#include <chrono>
#include <cmath>
#include <limits>
#include <deque>
#include <map>
#include <set>
#include <unordered_map>

namespace rn = facebook::react;
namespace jsi = facebook::jsi;
using namespace godot;
using fabric_godot::ControlProps;
using fabric_godot::ControlEventEmitter;

static std::string component_kind(const rn::ShadowView &shadow) {
  if (shadow.componentName == std::string("ScrollView")) return "scroll";
  if (shadow.componentName == std::string("Paragraph")) return "paragraph";
  return std::static_pointer_cast<const ControlProps>(shadow.props)->kind;
}

namespace {
double now_ms() {
  return std::chrono::duration<double, std::milli>(
      std::chrono::steady_clock::now().time_since_epoch()).count();
}
std::string utf8(const String &value) { return value.utf8().get_data(); }
String gd(const std::string &value) { return String::utf8(value.c_str()); }
std::optional<rn::Tag> native_tag(const jsi::Value &value) {
  if (!value.isNumber()) return std::nullopt;
  const auto number = value.asNumber();
  if (!std::isfinite(number) || std::trunc(number) != number || number <= 0 ||
      number > std::numeric_limits<rn::Tag>::max()) return std::nullopt;
  return static_cast<rn::Tag>(number);
}
class GodotEventBeat final : public rn::EventBeat {
 public:
  using rn::EventBeat::EventBeat;
  void tick() { induce(); }
};
}

struct fabric_godot::ApplicationRuntime::Impl final : rn::UIManagerDelegate {
  struct Root {
    FabricSurface *host{};
    std::string component;
    Vector2 size;
    std::unique_ptr<fabric_godot::PointerAdapter> pointer;
    int commits{}, mount_reports{}, creates{}, deletes{}, updates{}, events{};
    bool stopping{}, stopped{};
  };
  std::map<int, std::unique_ptr<Root>> roots;
  std::function<fabric_godot::WindowMetrics()> read_window;
  fabric_godot::WindowMetrics host_metrics;
  uint64_t runtime_id;
  int next_surface_id{1};
  int bundle_evaluations{};
  std::string bundle_url{"godot-fabric.js"};
  std::vector<OnSurfaceStartCallback> surface_callbacks;
  std::unique_ptr<facebook::hermes::HermesRuntime> runtime;
  std::shared_ptr<rn::ContextContainer> context;
  std::shared_ptr<rn::RuntimeScheduler> runtime_scheduler;
  std::unique_ptr<fabric_godot::TurboModuleRegistry> native_modules;
  std::shared_ptr<rn::UIManager> ui;
  rn::ComponentDescriptorProviderRegistry providers;
  std::shared_ptr<rn::EventDispatcher> dispatcher;
  GodotEventBeat *beat{};
  std::deque<rn::RawCallback> work;
  std::unique_ptr<rn::TimerManager> timer_manager;
  fabric_godot::TimerRegistry *timer_registry{}; // Owned by TimerManager.
  std::optional<jsi::Function> clear_timer;
  uint32_t dispatching_timer{};
  std::map<int, jsi::Function> frame_callbacks;
  int frame_callbacks_run{};
  struct Mounted {
    Control *control;
    rn::ShadowView shadow;
    int surface_id;
    bool frame_pending{false};
    std::unique_ptr<fabric_godot::InputAdapter> input;
    std::unique_ptr<fabric_godot::ScrollAdapter> scroll;
  };
  std::map<int, Mounted> views;
  std::unordered_map<Control *, int> native_tags;
  std::set<int> retiring;
  int next_frame{1};
  bool stopped{false};
  bool stopping{false};
  Vector2 viewport_size;
  std::shared_ptr<fabric_godot::TextLayout> text_layout;
  std::shared_ptr<fabric_godot::ParagraphLayout> paragraph_layout;
  std::optional<jsi::Function> window_listener;
  int viewport_updates{};
  std::string metrics_error;
  std::vector<std::string> errors;

  explicit Impl(FabricSurface &theme_source, std::function<fabric_godot::WindowMetrics()> metrics,
      const std::string &scenario, uint64_t id) : read_window(std::move(metrics)), runtime_id(id) {
    // One application owns Hermes, Fabric, scheduling and timers. All native
    // mounting and JS work still execute on Godot's main thread.
    auto config = hermes::vm::RuntimeConfig::Builder().withMicrotaskQueue(true).build();
    if (!theme_source.has_method("set_custom_maximum_size"))
      throw std::runtime_error("Fabric frames require Godot Control maximum size");
    runtime = facebook::hermes::makeHermesRuntime(config);
    context = std::make_shared<rn::ContextContainer>();
    text_layout = std::make_shared<fabric_godot::TextLayout>(theme_source.get_theme_font("font", "Label"));
    context->insert("GodotTextLayout", text_layout);
    paragraph_layout = std::make_shared<fabric_godot::ParagraphLayout>(context, text_layout->font(),
        [this](const std::string &error) { fail(error); });
    context->insert("TextLayoutManager", std::shared_ptr<rn::TextLayoutManager>(paragraph_layout));
    host_metrics = read_window();
    viewport_size = host_metrics.size;
    runtime->global().setProperty(*runtime, "godotScenario", jsi::String::createFromUtf8(*runtime, scenario));
    rn::RuntimeExecutor executor = [this](rn::RawCallback &&callback) {
      work.push_back(std::move(callback));
    };
    runtime_scheduler = std::make_shared<rn::RuntimeScheduler>(executor,
        rn::HighResTimeStamp::now,
        [this](jsi::Runtime &, jsi::JSError &error) { fail(error.what()); });
    context->insert(rn::RuntimeSchedulerKey, std::weak_ptr<rn::RuntimeScheduler>(runtime_scheduler));
    ui = std::make_shared<rn::UIManager>(executor, context);
    ui->setDelegate(this);
    auto owner = std::make_shared<rn::EventBeat::OwnerBox>();
    auto event_beat = std::make_unique<GodotEventBeat>(owner, *runtime_scheduler);
    beat = event_beat.get();
    auto event_pipe = [this](jsi::Runtime &rt, rn::EventTarget *target,
        const std::string &type, rn::ReactEventPriority priority,
        const rn::EventPayload &payload, rn::HighResTimeStamp timestamp) {
      rn::UIManagerBinding::getBinding(rt)->dispatchEvent(rt, target, type, priority, payload, timestamp);
    };
    auto state_pipe = [this](const rn::StateUpdate &state) { ui->updateState(state); };
    dispatcher = std::make_shared<rn::EventDispatcher>(
        rn::EventQueueProcessor(event_pipe,
            [this](jsi::Runtime &rt) { runtime_scheduler->callExpiredTasks(rt); }, state_pipe, {}),
        std::move(event_beat), state_pipe, std::weak_ptr<rn::EventLogger>());
    owner->owner = dispatcher;
    providers.add(rn::concreteComponentDescriptorProvider<fabric_godot::ControlDescriptor>());
    providers.add(rn::concreteComponentDescriptorProvider<rn::ScrollViewComponentDescriptor>());
    providers.add(rn::concreteComponentDescriptorProvider<rn::ParagraphComponentDescriptor>());
    providers.add(rn::concreteComponentDescriptorProvider<rn::TextComponentDescriptor>());
    providers.add(rn::concreteComponentDescriptorProvider<rn::RawTextComponentDescriptor>());
    ui->setComponentDescriptorRegistry(providers.createComponentDescriptorRegistry({dispatcher, context, nullptr}));
    runtime_scheduler->setShadowTreeRevisionConsistencyManager(ui->getShadowTreeRevisionConsistencyManager());
    rn::RuntimeSchedulerBinding::createAndInstallIfNeeded(*runtime, runtime_scheduler);
    rn::UIManagerBinding::createAndInstallIfNeeded(*runtime, ui);
    native_modules = std::make_unique<fabric_godot::TurboModuleRegistry>(runtime_id, runtime_scheduler);
    if (scenario == "refs" || scenario == "modules") native_modules->add_fixture();
    native_modules->add_feature_flags();
    native_modules->add_source_code([this] { return bundle_url; });
    native_modules->add_device_info([this] {
      return folly::dynamic::object("Dimensions", device_dimensions());
    });
    native_modules->add("NativeDOMCxx", [this](jsi::Runtime &, const std::shared_ptr<rn::CallInvoker> &invoker) {
      return std::make_shared<fabric_godot::GodotDOM>(invoker,
          [this](rn::SurfaceId id, rn::dom::DOMRect rect, bool transforms) {
            auto root = roots.find(id);
            if (root == roots.end() || root->second->stopping || root->second->stopped)
              return rn::dom::DOMRect{};
            auto transform = root->second->host->get_global_transform_with_canvas();
            // Layout/offset sizes exclude transforms. Window rectangles include
            // the affine embedding (all four corners, including rotation).
            if (!transforms) {
              rect.x += transform.get_origin().x;
              rect.y += transform.get_origin().y;
              return rect;
            }
            const Vector2 corners[] = {Vector2(rect.x, rect.y), Vector2(rect.x + rect.width, rect.y),
                Vector2(rect.x, rect.y + rect.height), Vector2(rect.x + rect.width, rect.y + rect.height)};
            Rect2 bounds(transform.xform(corners[0]), Vector2());
            for (int index = 1; index < 4; ++index) bounds.expand_to(transform.xform(corners[index]));
            return rn::dom::DOMRect{bounds.position.x, bounds.position.y, bounds.size.x, bounds.size.y};
          });
    });
    native_modules->install(*runtime);
    install_globals();
  }

  int mount(FabricSurface &host, const std::string &component, const std::string &props_json) {
    if (stopped || stopping) throw std::runtime_error("Application is stopped");
    if (!host.get_window() || host.get_viewport() != host.get_window() ||
        host.get_window()->get_instance_id() != host_metrics.window_instance_id)
      throw std::runtime_error("Fabric surfaces require the application's native Window; SubViewport and cross-window hosting need a metrics adapter");
    auto props = folly::parseJson(props_json);
    if (!component.empty()) {
      auto registry = runtime->global().getProperty(*runtime, "RN$AppRegistry");
      bool registered = false;
      if (registry.isObject()) {
        auto keys = registry.asObject(*runtime).getPropertyAsFunction(*runtime, "getAppKeys")
            .call(*runtime).asObject(*runtime).asArray(*runtime);
        for (size_t index = 0; index < keys.size(*runtime); ++index)
          if (keys.getValueAtIndex(*runtime, index).asString(*runtime).utf8(*runtime) == component) registered = true;
      }
      if (!registered)
        throw std::runtime_error("Unregistered AppRegistry component: " + component);
    }
    if (component.empty() && next_surface_id != 1)
      throw std::runtime_error("Legacy anonymous bundles support one root; register an AppRegistry entry");
    const int id = next_surface_id;
    next_surface_id += 10; // RN root tags end in 1; host component tags are even.
    auto root = std::make_unique<Root>();
    root->host = &host;
    root->component = component;
    root->size = host.get_size();
    roots.emplace(id, std::move(root));
    auto &surface = *roots.at(id);
    surface.pointer = std::make_unique<fabric_godot::PointerAdapter>(
        [this, id](Vector2 point) { return hit_test(roots.at(id)->host, point); },
        [this](int tag, Vector2 point) {
          auto found = views.find(tag);
          return found == views.end() ? point : found->second.control->get_global_transform_with_canvas().affine_inverse().xform(point);
        },
        [this](int tag, const std::string &phase, rn::TouchEvent event) { touch_event(tag, phase, std::move(event)); });
    rn::LayoutConstraints constraints;
    constraints.minimumSize = constraints.maximumSize = {static_cast<float>(surface.size.x), static_cast<float>(surface.size.y)};
    rn::LayoutContext layout;
    layout.pointScaleFactor = host_metrics.scale;
    auto tree = std::make_unique<rn::ShadowTree>(id, constraints, layout, *ui, *context);
    if (component.empty()) ui->startEmptySurface(std::move(tree));
    else ui->startSurface(std::move(tree), component, props, rn::DisplayMode::Visible);
    return id;
  }
  void update_props(int id, const std::string &props_json) {
    auto found = roots.find(id);
    if (found == roots.end() || found->second->stopping || stopped) return;
    if (found->second->component.empty()) throw std::runtime_error("Root props require an AppRegistry component");
    ui->setSurfaceProps(id, found->second->component, folly::parseJson(props_json), rn::DisplayMode::Visible);
  }

  void fail(const std::string &error) {
    errors.push_back(error);
    UtilityFunctions::push_error(String("FABRIC_ERROR: ") + gd(error));
  }
  using HostFn = jsi::HostFunctionType;
  void bind(const char *name, unsigned int argc, HostFn callback) {
    runtime->global().setProperty(*runtime, name,
        jsi::Function::createFromHostFunction(*runtime, jsi::PropNameID::forAscii(*runtime, name), argc, std::move(callback)));
  }
  jsi::Object window_metrics(jsi::Runtime &rt) {
    jsi::Object result(rt);
    result.setProperty(rt, "width", viewport_size.x);
    result.setProperty(rt, "height", viewport_size.y);
    result.setProperty(rt, "scale", host_metrics.scale);
    result.setProperty(rt, "fontScale", 1);
    return result;
  }
  folly::dynamic device_dimensions() const {
    auto metrics = [&](Vector2 size) {
      // Font scaling remains the actual Fabric layout multiplier (1). OS text
      // preferences/insets are still pending; they are not fabricated here.
      return folly::dynamic::object("width", size.x)("height", size.y)
          ("scale", host_metrics.scale)("fontScale", 1);
    };
    return folly::dynamic::object("window", metrics(host_metrics.size))
        ("screen", metrics(host_metrics.screen));
  }
  void update_viewport() {
    const auto next = read_window();
    if (next.window_instance_id != host_metrics.window_instance_id)
      throw std::runtime_error("A live Fabric application cannot migrate between native Windows");
    if (next.size.x <= 0 || next.size.y <= 0) return;
    const bool density_changed = next.scale != host_metrics.scale;
    for (auto &[id, root] : roots) {
      const auto size = root->host->get_size();
      if ((size == root->size && !density_changed) || size.x <= 0 || size.y <= 0 || root->stopping) continue;
      root->size = size;
      rn::LayoutConstraints constraints;
      constraints.minimumSize = constraints.maximumSize = {static_cast<float>(size.x), static_cast<float>(size.y)};
      rn::LayoutContext layout;
      layout.pointScaleFactor = next.scale;
      ui->getShadowTreeRegistry().visit(id, [&](const rn::ShadowTree &tree) {
        tree.commit([&](const rn::RootShadowNode &node) { return node.clone({id, *context}, constraints, layout); }, {});
      });
    }
    if (next.size == host_metrics.size && next.screen == host_metrics.screen &&
        !density_changed) return;
    host_metrics = next;
    viewport_size = next.size;
    ++viewport_updates;
    work.push_back([this, dimensions = device_dimensions()](jsi::Runtime &rt) {
      auto emitter = rt.global().getProperty(rt, "__rctDeviceEventEmitter");
      if (emitter.isObject()) {
        auto object = emitter.asObject(rt);
        object.getPropertyAsFunction(rt, "emit").callWithThis(rt, object,
            jsi::String::createFromAscii(rt, "didUpdateDimensions"),
            jsi::valueFromDynamic(rt, dimensions));
      }
      if (window_listener) window_listener->call(rt, window_metrics(rt));
    });
  }
  void install_globals() {
    bind("godotWindowMetrics", 0, [this](jsi::Runtime &rt, auto &, const auto *, size_t) {
      return jsi::Value(window_metrics(rt));
    });
    bind("godotSetWindowListener", 1, [this](jsi::Runtime &rt, auto &, const jsi::Value *args, size_t count) {
      window_listener.reset();
      if (count && args[0].isObject() && args[0].asObject(rt).isFunction(rt))
        window_listener.emplace(args[0].asObject(rt).asFunction(rt));
      return jsi::Value::undefined();
    });
    bind("nativePerformanceNow", 0, [](auto &, auto &, const auto *, size_t) { return jsi::Value(now_ms()); });
    bind("nativeLoggingHook", 2, [](jsi::Runtime &rt, auto &, const jsi::Value *args, size_t count) {
      if (count) UtilityFunctions::print(String("HERMES: ") + gd(args[0].toString(rt).utf8(rt)));
      return jsi::Value::undefined();
    });
    auto registry = std::make_unique<fabric_godot::TimerRegistry>(now_ms);
    timer_registry = registry.get();
    timer_manager = std::make_unique<rn::TimerManager>(std::move(registry));
    timer_manager->setRuntimeExecutor([this](rn::RawCallback &&callback) {
      const auto id = dispatching_timer;
      work.push_back([this, id, callback = std::move(callback)](jsi::Runtime &rt) {
        try { callback(rt); }
        catch (const std::exception &error) { fail(error.what()); }
        // Upstream erases one-shot callbacks after invocation. A throwing
        // callback bypasses that erase; release it through the original API.
        if (!timer_registry->recurring(id)) clear_timer->call(rt, static_cast<double>(id));
        timer_registry->finish(id, now_ms());
      });
    });
    timer_manager->attachGlobals(*runtime);
    clear_timer.emplace(runtime->global().getPropertyAsFunction(*runtime, "clearTimeout"));
    bind("godotRuntimeActive", 0, [this](auto &, auto &, const auto *, size_t) {
      return jsi::Value(!stopping && !stopped);
    });
    bind("requestAnimationFrame", 1, [this](jsi::Runtime &rt, auto &, const jsi::Value *args, size_t count) {
      if (!count || !args[0].isObject() || !args[0].asObject(rt).isFunction(rt))
        throw jsi::JSError(rt, "requestAnimationFrame requires a function");
      const int id = next_frame++;
      frame_callbacks.emplace(id, args[0].asObject(rt).asFunction(rt));
      return jsi::Value(id);
    });
    bind("cancelAnimationFrame", 1, [this](auto &, auto &, const jsi::Value *args, size_t count) {
      if (count && args[0].isNumber()) frame_callbacks.erase(static_cast<int>(args[0].asNumber()));
      return jsi::Value::undefined();
    });
    bind("godotNode", 1, [this](jsi::Runtime &rt, auto &, const jsi::Value *args, size_t count) {
      if (stopping || stopped || count != 1) return jsi::Value::null();
      auto tag = native_tag(args[0]);
      if (!tag) return jsi::Value::null();
      auto node = ui->findShadowNodeByTag_DEPRECATED(*tag);
      return node ? rn::Bridging<std::shared_ptr<const rn::ShadowNode>>::toJs(rt, node) : jsi::Value::null();
    });
    bind("godotMetrics", 1, [this](jsi::Runtime &rt, auto &, const jsi::Value *args, size_t count) {
      if (count != 1) return jsi::Value::null();
      auto tag = native_tag(args[0]);
      if (!tag) return jsi::Value::null();
      auto found = views.find(*tag);
      if (found == views.end()) return jsi::Value::null();
      auto *control = found->second.control;
      jsi::Object result(rt);
      result.setProperty(rt, "width", control->get_size().x);
      result.setProperty(rt, "height", control->get_size().y);
      result.setProperty(rt, "x", control->get_position().x);
      result.setProperty(rt, "y", control->get_position().y);
      result.setProperty(rt, "pageX", control->get_global_position().x);
      result.setProperty(rt, "pageY", control->get_global_position().y);
      result.setProperty(rt, "id", static_cast<double>(control->get_instance_id()));
      result.setProperty(rt, "focused", control->has_focus());
      return jsi::Value(std::move(result));
    });
    bind("godotFocus", 2, [this](auto &, auto &, const jsi::Value *args, size_t count) {
      if (count != 2 || !args[1].isBool()) return jsi::Value::undefined();
      auto tag = native_tag(args[0]);
      if (!tag) return jsi::Value::undefined();
      auto found = views.find(*tag);
      if (found != views.end()) {
        if (args[1].getBool()) found->second.control->grab_focus();
        else found->second.control->release_focus();
      }
      return jsi::Value::undefined();
    });
    evaluate("globalThis.global=globalThis; globalThis.__DEV__=false;"
        "globalThis.performance={now:nativePerformanceNow};"
        "globalThis.console={log:(...a)=>nativeLoggingHook(a.join(' '),0),"
        "warn:(...a)=>nativeLoggingHook(a.join(' '),1),error:(...a)=>nativeLoggingHook(a.join(' '),2)};");
  }
  jsi::Value evaluate(const std::string &source) {
    return runtime->evaluateJavaScript(std::make_shared<jsi::StringBuffer>(source), bundle_url);
  }
  void pump(bool frame_tick = false) {
    if (stopped) return;
    try {
      // Host configuration failures must remain visible without starving
      // queued React cleanup. Shutdown never depends on window resampling.
      if (!stopping) {
        try { update_viewport(); metrics_error.clear(); }
        catch (const std::exception &error) {
          if (metrics_error != error.what()) {
            metrics_error = error.what();
            fail(metrics_error);
          }
        }
      }
      for (auto &[tag, mounted] : views) {
        if (mounted.input) mounted.input->sample();
        if (mounted.scroll) mounted.scroll->sample();
      }
      beat->tick();
      // Finish the preceding JS turn's microtasks before due native timers.
      runtime->drainMicrotasks();
      // Snapshot the current frame. Callbacks scheduled by a callback, timer,
      // or React commit are deferred to the next Godot frame, never a tight loop.
      std::vector<int> frame_ids;
      if (frame_tick)
        for (const auto &[id, callback] : frame_callbacks) frame_ids.push_back(id);
      const double frame_time = now_ms();
      for (int id : frame_ids) {
        auto callback = frame_callbacks.extract(id);
        if (callback.empty()) continue;
        ++frame_callbacks_run;
        try { callback.mapped().call(*runtime, frame_time); }
        catch (const std::exception &error) { fail(error.what()); }
        runtime->drainMicrotasks();
      }
      // Bound a frame's work. Timers created by a callback run on a later tick.
      if (!stopping)
        for (auto id : timer_registry->take_due(now_ms())) {
          dispatching_timer = id;
          timer_manager->callTimer(id);
        }
      for (int limit = 0; !work.empty() && limit < 256; ++limit) {
        auto callback = std::move(work.front());
        work.pop_front();
        try { callback(*runtime); }
        catch (const std::exception &error) { fail(error.what()); }
        runtime->drainMicrotasks();
      }
      runtime->drainMicrotasks();
    } catch (const std::exception &error) { fail(error.what()); }
  }
  void unmount(int id, bool legacy_hook = false) {
    auto found = roots.find(id);
    if (found == roots.end() || found->second->stopping) return;
    auto &root = *found->second;
    root.stopping = true;
    root.pointer->cancel();
    // React cleanup must run while this ShadowTree is still registered.
    try {
      if (legacy_hook) evaluate("if(globalThis.GodotApp) GodotApp.stop();");
      else evaluate("if(globalThis.RN$stopSurface) RN$stopSurface(" + std::to_string(id) + ");");
    } catch (const std::exception &error) { fail(error.what()); }
    for (int i = 0; i < 32; ++i) pump();
    try {
      ui->getShadowTreeRegistry().visit(id, [](const rn::ShadowTree &tree) { tree.commitEmptyTree(); });
      ui->stopSurface(id);
      pump();
    } catch (const std::exception &error) { fail(error.what()); }
    // Failed JS/native teardown cannot retain a tree or event authority.
    for (auto &[tag, mounted] : views)
      if (mounted.surface_id == id && mounted.control->get_parent())
        mounted.control->get_parent()->remove_child(mounted.control);
    for (auto it = views.begin(); it != views.end();) {
      if (it->second.surface_id != id) { ++it; continue; }
      native_tags.erase(it->second.control);
      memdelete(it->second.control);
      it = views.erase(it);
      ++root.deletes;
    }
    root.stopped = true;
    root.host->native_unmounted(gd(snapshot(id)));
    roots.erase(id);
  }
  void stop() {
    if (stopped || stopping) return;
    stopping = true;
    for (auto id : timer_registry->handles()) clear_timer->call(*runtime, static_cast<double>(id));
    frame_callbacks.clear();
    std::vector<int> ids;
    std::vector<uint64_t> host_ids;
    for (auto &[id, root] : roots) { ids.push_back(id); host_ids.push_back(root->host->get_instance_id()); }
    for (int id : ids) unmount(id, roots.at(id)->component.empty());
    try { native_modules->stop(*runtime); }
    catch (const std::exception &error) { fail(error.what()); }
    ui->setDelegate(nullptr);
    runtime_scheduler->setShadowTreeRevisionConsistencyManager(nullptr);
    window_listener.reset();
    timer_registry->quit();
    frame_callbacks.clear();
    work.clear();
    stopped = true;
    // Cache the finalized application state for surfaces whose owner may be
    // destroyed before them. Object IDs avoid retaining the scene objects.
    for (auto id : host_ids)
      if (auto *host = Object::cast_to<FabricSurface>(ObjectDB::get_instance(id)))
        host->native_unmounted(host->snapshot());
  }

  void apply(const rn::ShadowView &shadow) {
    auto &mounted = views.at(shadow.tag);
    auto *control = mounted.control;
    auto props = std::static_pointer_cast<const rn::ViewProps>(shadow.props);
    const auto kind = component_kind(shadow);
    if (mounted.shadow.props && component_kind(mounted.shadow) != kind)
      throw std::runtime_error("A mounted GodotControl cannot change kind; use a different React key");
    const bool initial = !mounted.shadow.props;
    mounted.shadow = shadow;
    mounted.frame_pending = true;
    control->set_name(props->testId.empty() ? String("Fabric_") + String::num_int64(shadow.tag) : gd(props->testId));
    control->set_position({shadow.layoutMetrics.frame.origin.x, shadow.layoutMetrics.frame.origin.y});

    control->set_visible(shadow.layoutMetrics.displayType != rn::DisplayType::None);
    control->set_modulate({1, 1, 1, props->opacity});
    control->set_z_index(std::clamp(props->zIndex.value_or(0), -4096, 4096));
    if (kind == "view")
      control->set_clip_contents(props->yogaStyle.overflow() == facebook::yoga::Overflow::Hidden);
    if (!control->is_visible()) cancel_subtree(control);
    if (mounted.scroll) {
      mounted.scroll->apply(shadow);
      apply_frame(mounted);
      return;
    }
    if (auto *paragraph = Object::cast_to<GodotParagraph>(control)) {
      try { paragraph->apply(shadow, paragraph_layout); }
      catch (const std::exception &error) { fail(error.what()); }
      fabric_godot::apply_appearance(*control, *props, shadow.layoutMetrics);
      apply_frame(mounted);
      return;
    }
    auto native_props = std::static_pointer_cast<const ControlProps>(shadow.props);
    if (native_props->disabled) cancel_subtree(control);
    control->add_theme_font_size_override("font_size", static_cast<int>(native_props->fontSize));
    if (auto *svg = Object::cast_to<GodotSvgNode>(control)) svg->set_payload(native_props->svg);
    if (auto *label = Object::cast_to<Label>(control)) {
      label->add_theme_font_override("font", text_layout->font());
      label->add_theme_constant_override("line_spacing", 0);
      label->add_theme_constant_override("paragraph_spacing", 0);
      label->set_autowrap_mode(TextServer::AUTOWRAP_WORD_SMART);
      label->set_clip_text(true); // Yoga owns the frame, including explicit height.
      label->set_vertical_alignment(VERTICAL_ALIGNMENT_TOP);
      label->set_text(gd(native_props->text));
      // A Control created off-tree may still cache its default font minimum.
      // Invalidate after all text/theme/clip props, before enforcing Yoga's frame.
      label->update_minimum_size();
    }
    if (auto *button = Object::cast_to<Button>(control)) {
      button->set_clip_text(true);
      button->set_text(gd(native_props->text)); button->set_disabled(native_props->disabled);
    }
    if (auto *input = Object::cast_to<LineEdit>(control)) {
      // Subsequent text/selection updates use the acknowledged Fabric command.
      if (initial) input->set_text(gd(native_props->text));
      input->set_placeholder(gd(native_props->placeholder));
      input->set_editable(!native_props->disabled);
      input->set_keep_editing_on_text_submit(true);
      mounted.input->blur_on_submit = native_props->submitBehavior == "blurAndSubmit";
    }
    fabric_godot::apply_appearance(*control, *native_props, shadow.layoutMetrics);
    apply_frame(mounted);
  }

  static void apply_frame(Mounted &mounted) {
    const auto size = Vector2(mounted.shadow.layoutMetrics.frame.size.width,
        mounted.shadow.layoutMetrics.frame.size.height);
    // godot-cpp's pinned API predates this public 4.7 method. A real native
    // maximum bounds even themed minimums, without wrappers or scaled widgets.
    mounted.control->call("set_custom_maximum_size", size);
    if (component_kind(mounted.shadow) != "view")
      mounted.control->set_clip_contents(true);
    mounted.control->set_size(size);
  }
  void emit(int tag, const std::string &name, folly::dynamic payload) {
    if (stopped || retiring.contains(tag)) return;
    auto found = views.find(tag);
    if (found == views.end() || !found->second.shadow.eventEmitter) return;
    if (roots.at(found->second.surface_id)->stopping) return;
    ++roots.at(found->second.surface_id)->events;
    std::static_pointer_cast<const ControlEventEmitter>(found->second.shadow.eventEmitter)->inputEvent(name, std::move(payload));
  }
  void cancel_subtree(Control *control) {
    for (const auto &[tag, mounted] : views)
      if (mounted.control == control || control->is_ancestor_of(mounted.control)) roots.at(mounted.surface_id)->pointer->removed(tag);
  }
  void apply_pointer_filters() {
    for (const auto &[tag, mounted] : views) {
      auto props = std::static_pointer_cast<const rn::ViewProps>(mounted.shadow.props);
      // ScrollContainer supplies geometry, never a second native pan recognizer.
      // Its children still receive Godot GUI input; wheels use our viewport route.
      bool ignore = mounted.scroll || component_kind(mounted.shadow) == "text" || component_kind(mounted.shadow) == "paragraph" || props->pointerEvents == rn::PointerEventsMode::None || props->pointerEvents == rn::PointerEventsMode::BoxNone;
      auto *parent = Object::cast_to<Control>(mounted.control->get_parent());
      while (parent && parent != roots.at(mounted.surface_id)->host) {
        const int parent_tag = tag_for(parent);
        if (parent_tag) {
          auto mode = std::static_pointer_cast<const rn::ViewProps>(views.at(parent_tag).shadow.props)->pointerEvents;
          if (mode == rn::PointerEventsMode::None || mode == rn::PointerEventsMode::BoxOnly) ignore = true;
        }
        parent = Object::cast_to<Control>(parent->get_parent());
      }
      mounted.control->set_mouse_filter(ignore ? Control::MOUSE_FILTER_IGNORE : Control::MOUSE_FILTER_STOP);
    }
  }
  int tag_for(Control *control) const {
    auto found = native_tags.find(control);
    return found == native_tags.end() ? 0 : found->second;
  }
  int hit_test(Control *control, Vector2 point) const {
    if (!control->is_visible_in_tree()) return 0;
    const int tag = tag_for(control);
    std::shared_ptr<const rn::ViewProps> props;
    if (tag) props = std::static_pointer_cast<const rn::ViewProps>(views.at(tag).shadow.props);
    if (props && props->pointerEvents == rn::PointerEventsMode::None) return 0;
    const auto local = control->get_global_transform_with_canvas().affine_inverse().xform(point);
    const bool inside = Rect2(Vector2(), control->get_size()).has_point(local);
    if (!inside && control->is_clipping_contents()) return 0;
    if (!props || props->pointerEvents != rn::PointerEventsMode::BoxOnly) {
      std::vector<Control *> children;
      for (int i = 0; i < control->get_child_count(); ++i)
        if (auto *child = Object::cast_to<Control>(control->get_child(i))) children.push_back(child);
      std::stable_sort(children.begin(), children.end(), [](Control *a, Control *b) { return a->get_z_index() < b->get_z_index(); });
      for (auto child = children.rbegin(); child != children.rend(); ++child)
        if (int hit = hit_test(*child, point)) return hit;
    }
    if (!props || props->pointerEvents == rn::PointerEventsMode::BoxNone) return 0;
    const auto inset = props->hitSlop;
    const Rect2 hit_rect(Vector2(-inset.left, -inset.top), control->get_size() + Vector2(inset.left + inset.right, inset.top + inset.bottom));
    if (!hit_rect.has_point(local)) return 0;
    // Expanded touch targets cannot escape their parent's bounds (RN contract).
    auto *parent = Object::cast_to<Control>(control->get_parent());
    if (!inside && parent && !parent->get_global_rect().has_point(point)) return 0;
    return tag;
  }
  bool wheel(Root &surface, const Ref<InputEvent> &event) {
    auto *mouse = Object::cast_to<InputEventMouseButton>(event.ptr());
    if (!mouse || !mouse->is_pressed()) return false;
    const auto button = mouse->get_button_index();
    if (button < MOUSE_BUTTON_WHEEL_UP || button > MOUSE_BUTTON_WHEEL_RIGHT) return false;
    if (surface.pointer->blocks_native()) return true;
    const int target = hit_test(surface.host, mouse->get_position());
    auto found = views.find(target);
    while (found != views.end()) {
      if (found->second.scroll) {
        found->second.scroll->wheel(button == MOUSE_BUTTON_WHEEL_UP || button == MOUSE_BUTTON_WHEEL_LEFT ? -1 : 1, mouse->get_factor());
        return true;
      }
      found = views.find(tag_for(Object::cast_to<Control>(found->second.control->get_parent())));
    }
    return false;
  }
  void touch_event(int tag, const std::string &phase, rn::TouchEvent event) {
    if (stopped) return;
    auto found = views.find(tag);
    if (found == views.end()) return;
    const int surface_id = found->second.surface_id;
    // A retired emitter loses its React handle. Route cancellation through a
    // surviving ancestor so upstream can release its responder/touch history.
    if (phase == "cancel") {
      while (found != views.end() && retiring.contains(found->first))
        found = views.find(tag_for(Object::cast_to<Control>(found->second.control->get_parent())));
      if (found == views.end())
        for (auto candidate = views.begin(); candidate != views.end(); ++candidate)
          if (candidate->second.surface_id == surface_id && !retiring.contains(candidate->first)) { found = candidate; break; }
    }
    if (found == views.end() || !found->second.shadow.eventEmitter) return;
    ++roots.at(found->second.surface_id)->events;
    auto emitter = std::static_pointer_cast<const rn::ViewEventEmitter>(found->second.shadow.eventEmitter);
    if (phase == "start") emitter->onTouchStart(std::move(event));
    else if (phase == "move") emitter->onTouchMove(std::move(event));
    else if (phase == "end") emitter->onTouchEnd(std::move(event));
    else emitter->onTouchCancel(std::move(event));
  }
  void uiManagerDidFinishTransaction(std::shared_ptr<const rn::MountingCoordinator> coordinator, bool) override {
    auto transaction = coordinator->pullTransaction();
    if (!transaction) return;
    auto root_entry = roots.find(transaction->getSurfaceId());
    if (root_entry == roots.end()) return;
    auto &surface = *root_entry->second;
    auto &host = *surface.host;
    const int surface_id = transaction->getSurfaceId();
    ++surface.commits;
    auto *focused = host.get_viewport()->gui_get_focus_owner();
    uint64_t focus_id = focused ? focused->get_instance_id() : 0;
    auto parent = [this, &host, surface_id](int tag) -> Control * { return tag == surface_id ? &host : views.at(tag).control; };
    std::map<int, int> inserted_parents;
    for (const auto &mutation : transaction->getMutations()) {
      if (mutation.type == rn::ShadowViewMutation::Insert)
        inserted_parents[mutation.newChildShadowView.tag] = mutation.parentTag;
      if (mutation.type == rn::ShadowViewMutation::Delete) retiring.insert(mutation.oldChildShadowView.tag);
    }
    for (int tag : retiring) surface.pointer->removed(tag);
    for (const auto &mutation : transaction->getMutations()) {
      const auto &old = mutation.oldChildShadowView;
      const auto &next = mutation.newChildShadowView;
      switch (mutation.type) {
        case rn::ShadowViewMutation::Create: {
          const auto kind = component_kind(next);
          Control *control;
          if (kind == "scroll") control = memnew(ScrollContainer);
          else if (kind == "paragraph") control = memnew(GodotParagraph);
          else if (kind == "text") control = memnew(Label);
          else if (kind == "button") {
            auto *button = memnew(Button);
            button->connect("pressed", Callable(&host, "activate").bind(next.tag));
            control = button;
          } else if (kind == "input") {
            auto *input = memnew(LineEdit);
            input->connect("text_changed", Callable(&host, "change").bind(next.tag));
            control = input;
          } else if (kind == "svg") {
            control = memnew(GodotSvgNode);
          } else if (kind == "view") {
            control = memnew(Panel);
            control->set_mouse_filter(Control::MOUSE_FILTER_IGNORE);
          } else throw std::runtime_error("Unsupported GodotControl kind: " + kind);
          native_tags.emplace(control, next.tag);
          auto entry = views.emplace(next.tag, Mounted{control, {}, surface_id}).first;
          if (auto *scroll = Object::cast_to<ScrollContainer>(control))
            entry->second.scroll = std::make_unique<fabric_godot::ScrollAdapter>(*scroll);
          if (auto *input = Object::cast_to<LineEdit>(control)) {
            entry->second.input = std::make_unique<fabric_godot::InputAdapter>(*input,
                [this, tag = next.tag](const std::string &name, folly::dynamic payload) { emit(tag, name, std::move(payload)); });
            input->connect("focus_entered", Callable(&host, "input_focus").bind(true, next.tag));
            input->connect("focus_exited", Callable(&host, "input_focus").bind(false, next.tag));
            input->connect("text_submitted", Callable(&host, "input_submit").bind(next.tag));
            input->connect("gui_input", Callable(&host, "input_key").bind(next.tag));
          }
          ++surface.creates;
          apply(next);
          break;
        }
        case rn::ShadowViewMutation::Insert: {
          auto *control = views.at(next.tag).control;
          if (control->get_parent() != parent(mutation.parentTag))
            parent(mutation.parentTag)->add_child(control);
          parent(mutation.parentTag)->move_child(control, mutation.index);
          apply(next);
          break;
        }
        case rn::ShadowViewMutation::Remove:
          // A same-parent keyed move is a reorder, not a native detachment.
          // Detaching a focused LineEdit cancels its editing/IME session.
          if (!inserted_parents.contains(old.tag) || inserted_parents.at(old.tag) != mutation.parentTag)
            parent(mutation.parentTag)->remove_child(views.at(old.tag).control);
          break;
        case rn::ShadowViewMutation::Delete: {
          auto entry = views.extract(old.tag);
          native_tags.erase(entry.mapped().control);
          memdelete(entry.mapped().control);
          ++surface.deletes;
          break;
        }
        case rn::ShadowViewMutation::Update:
          if (next.tag != surface_id) { apply(next); ++surface.updates; }
          break;
      }
    }
    // Initial Insert mutations can attach children to parents which are not
    // in the SceneTree yet. Finalize their frames after the entire transaction
    // is attached, so native theme/minimum caches cannot retain off-tree sizes.
    for (auto &[tag, mounted] : views) {
      if (!mounted.frame_pending || !mounted.control->is_inside_tree()) continue;
      if (auto *label = Object::cast_to<Label>(mounted.control)) label->update_minimum_size();
      apply_frame(mounted);
      mounted.frame_pending = false;
    }
    for (auto &[tag, mounted] : views) if (mounted.scroll) mounted.scroll->layout();
    apply_pointer_filters();
    for (auto &[tag, mounted] : views) {
      if (auto *svg = Object::cast_to<GodotSvgNode>(mounted.control); svg && svg->is_inside_tree()) {
        // A paint failure must remain visible without skipping other surfaces
        // or the bookkeeping which finalizes this Fabric mount transaction.
        try { svg->refresh(text_layout->font()); }
        catch (const std::exception &error) { fail(error.what()); }
      }
    }
    if (focus_id) {
      for (auto &[tag, mounted] : views)
        if (mounted.control->get_instance_id() == focus_id && mounted.control->is_inside_tree())
          mounted.control->grab_focus();
    }
    retiring.clear();
    ui->reportMount(surface_id);
    ++surface.mount_reports;
  }
  // Fabric creates speculative shadow nodes. Native objects are allocated only
  // from committed Create mutations, never from this callback.
  void uiManagerDidCreateShadowNode(const rn::ShadowNode &) override {}
  void uiManagerDidDispatchCommand(const std::shared_ptr<const rn::ShadowNode> &node,
      const std::string &name, const folly::dynamic &args) override {
    auto found = views.find(node->getTag());
    // Ref commands queued before a removal must not target another instance.
    if (found == views.end() || stopped || found->second.surface_id != node->getSurfaceId() || roots.at(found->second.surface_id)->stopping) return;
    if ((name == "scrollDragStart" || name == "scrollDragTo") && !roots.at(found->second.surface_id)->pointer->owns(node->getTag())) return;
    if (found->second.scroll && found->second.scroll->command(name, args)) return;
    if (name == "setTextAndSelection" && found->second.input) {
      if (!args.isArray() || args.size() != 4 || !args[0].isNumber() ||
          !(args[1].isNull() || args[1].isString()) || !args[2].isNumber() || !args[3].isNumber()) {
        fail("setTextAndSelection requires [eventCount, text|null, start, end]");
        return;
      }
      found->second.input->setTextAndSelection(args[0].asInt(),
          args[1].isNull() ? std::nullopt : std::optional(args[1].asString()), args[2].asInt(), args[3].asInt());
      return;
    }
    fail("Unsupported native command: " + name);
  }
  void uiManagerDidSendAccessibilityEvent(const std::shared_ptr<const rn::ShadowNode> &, const std::string &) override { fail("Accessibility adapter is not implemented"); }
  void uiManagerDidSetIsJSResponder(const std::shared_ptr<const rn::ShadowNode> &node, bool active, bool block) override {
    auto root = roots.find(node->getSurfaceId());
    if (root != roots.end() && (!active || views.contains(node->getTag())))
      root->second->pointer->responder(node->getTag(), active, block);
  }
  void uiManagerShouldSynchronouslyUpdateViewOnUIThread(rn::Tag, const folly::dynamic &) override { fail("setNativeProps is not implemented"); }
  void uiManagerDidUpdateShadowTree(const std::unordered_map<rn::Tag, folly::dynamic> &) override { fail("Animated adapter is not implemented"); }
  void uiManagerShouldAddEventListener(std::shared_ptr<const rn::EventListener> listener) override { dispatcher->addListener(std::move(listener)); }
  void uiManagerShouldRemoveEventListener(const std::shared_ptr<const rn::EventListener> &listener) override { dispatcher->removeListener(listener); }
  void uiManagerDidStartSurface(const rn::ShadowTree &tree) override {
    for (auto &callback : surface_callbacks) callback(tree);
  }
  void uiManagerDidFinishReactCommit(const rn::ShadowTree &) override {}
  void uiManagerDidPromoteReactRevision(const rn::ShadowTree &) override {}
  void uiManagerShouldAddOnSurfaceStartCallback(OnSurfaceStartCallback &&callback) override {
    ui->getShadowTreeRegistry().enumerate([&](const rn::ShadowTree &tree, bool &) { callback(tree); });
    surface_callbacks.push_back(std::move(callback));
  }
  void uiManagerDidCaptureViewSnapshot(rn::Tag, rn::SurfaceId) override { fail("View transitions are not implemented"); }
  void uiManagerDidSetViewSnapshot(rn::Tag, rn::Tag, rn::SurfaceId) override { fail("View transitions are not implemented"); }
  void uiManagerDidClearPendingSnapshots() override {}

  folly::dynamic status() {
    folly::dynamic result = folly::dynamic::object("runtimeId", static_cast<int64_t>(runtime_id))
        ("rootCount", roots.size())("bundleEvaluations", bundle_evaluations)("stopped", stopped)
        ("pendingTimers", timer_registry->size())("pendingWork", work.size())
        ("timerEngine", "react-native/TimerManager")("windowListener", window_listener.has_value())
        ("pendingAnimationFrames", frame_callbacks.size())("animationFramesRun", frame_callbacks_run)
        ("textMeasurements", text_layout->measurements() + paragraph_layout->measurements())
        ("viewportUpdates", viewport_updates)("errors", folly::dynamic::array());
    result["nativeModules"] = native_modules->snapshot();
    result["dimensions"] = device_dimensions();
    for (const auto &error : errors) result["errors"].push_back(error);
    return result;
  }
  std::string snapshot(int id, const std::string &retired = "{}") {
    auto global = status();
    auto found = roots.find(id);
    if (found == roots.end()) {
      auto result = folly::parseJson(retired);
      for (const auto &item : global.items()) if (item.first != "stopped") result[item.first] = item.second;
      result["applicationStopped"] = stopped;
      return folly::toJson(result);
    }
    auto &root = *found->second;
    auto result = std::move(global);
    result["surfaceId"] = id;
    result["state"] = root.stopped ? "unmounted" : root.commits ? "mounted" : "mounting";
    result["stopped"] = root.stopped;
    result["applicationStopped"] = stopped;
    result["commits"] = root.commits;
    result["mountReports"] = root.mount_reports;
    result["creates"] = root.creates;
    result["deletes"] = root.deletes;
    result["updates"] = root.updates;
    result["events"] = root.events;
    result["retiringTags"] = retiring.size();
    result["nativeTags"] = std::count_if(views.begin(), views.end(), [id](auto &entry) { return entry.second.surface_id == id; });
    result["viewport"] = folly::dynamic::object("width", root.size.x)("height", root.size.y);
    auto nodes = folly::dynamic::array();
    for (auto &[tag, mounted] : views) {
      if (mounted.surface_id != id) continue;
      auto *control = mounted.control;
      auto props = std::static_pointer_cast<const rn::ViewProps>(mounted.shadow.props);
      const auto kind = component_kind(mounted.shadow);
      const auto native_props = kind == "scroll" || kind == "paragraph" ? nullptr : std::static_pointer_cast<const ControlProps>(mounted.shadow.props);
      folly::dynamic node = folly::dynamic::object("tag", tag)("id", static_cast<int64_t>(control->get_instance_id()))
          ("testID", props->testId)("kind", kind)("text", native_props ? native_props->text : "")
          ("width", control->get_size().x)("height", control->get_size().y)
          ("fabricWidth", mounted.shadow.layoutMetrics.frame.size.width)
          ("fabricHeight", mounted.shadow.layoutMetrics.frame.size.height)
          ("x", control->get_position().x)("y", control->get_position().y)
          ("focused", control->has_focus())("visible", control->is_visible())("opacity", control->get_modulate().a);
      if (mounted.scroll) node["scroll"] = mounted.scroll->snapshot();
      if (kind == "view" || kind == "text" || kind == "paragraph" || kind == "button" || kind == "input")
        node["appearance"] = fabric_godot::appearance_snapshot(*control);
      if (auto *paragraph = Object::cast_to<GodotParagraph>(control)) {
        auto measured = paragraph->snapshot();
        for (const auto &item : measured.items()) node[item.first] = item.second;
        if (!node["runs"].empty()) {
          const auto &run = node["runs"][0];
          node["fontSize"] = node["nativeFontSize"] = run["fontSize"];
          node["appearance"]["textColor"] = run["color"];
        }
      }
      if (auto *input = Object::cast_to<LineEdit>(control)) {
        node["caret"] = input->get_caret_column();
        node["nativeText"] = utf8(input->get_text());
        node["input"] = mounted.input->snapshot();
        node["editable"] = input->is_editable();
        node["placeholder"] = utf8(input->get_placeholder());
      }
      if (auto *label = Object::cast_to<Label>(control)) {
        node["nativeText"] = utf8(label->get_text());
        node["lines"] = label->get_line_count();
        node["visibleLines"] = label->get_visible_line_count();
        node["fontSize"] = native_props->fontSize;
        node["nativeFontSize"] = label->get_theme_font_size("font_size");
        node["minimumHeight"] = label->get_combined_minimum_size().y;
        node["clip"] = label->is_clipping_text();
        node["wrap"] = static_cast<int>(label->get_autowrap_mode());
      }
      if (auto *button = Object::cast_to<Button>(control)) node["nativeText"] = utf8(button->get_text());
      if (auto *svg = Object::cast_to<GodotSvgNode>(control)) node["svg"] = svg->snapshot();
      nodes.push_back(std::move(node));
    }
    result["pointer"] = root.pointer->snapshot();
    result["nodes"] = std::move(nodes);
    return folly::toJson(result);
  }
};

namespace fabric_godot {
ApplicationRuntime::ApplicationRuntime(FabricSurface &theme_source, std::function<WindowMetrics()> window_metrics,
    const std::string &scenario, uint64_t runtime_id)
    : impl(std::make_unique<Impl>(theme_source, std::move(window_metrics), scenario, runtime_id)) {}
ApplicationRuntime::~ApplicationRuntime() { impl->stop(); }
void ApplicationRuntime::load_bundle(const std::string &source, const std::string &source_url) {
  impl->bundle_url = source_url;
  impl->evaluate(source);
  ++impl->bundle_evaluations;
}
void ApplicationRuntime::invoke_callable(const std::string &name, const std::string &method, const std::string &args_json) {
  impl->native_modules->invoke_callable(name, method, folly::parseJson(args_json));
}
int ApplicationRuntime::mount(FabricSurface &host, const std::string &component, const std::string &props_json) { return impl->mount(host, component, props_json); }
void ApplicationRuntime::update_props(int id, const std::string &props_json) { impl->update_props(id, props_json); }
void ApplicationRuntime::unmount(int id) { impl->unmount(id); }
void ApplicationRuntime::stop() { impl->stop(); }
bool ApplicationRuntime::is_stopped() const { return impl->stopped || impl->stopping; }
void ApplicationRuntime::pump(bool frame) { impl->pump(frame); }
std::string ApplicationRuntime::evaluate(const std::string &source) {
  try { return impl->evaluate(source).toString(*impl->runtime).utf8(*impl->runtime); }
  catch (const std::exception &error) { impl->fail(error.what()); return "null"; }
}
std::string ApplicationRuntime::snapshot(int id, const std::string &retired) { return impl->snapshot(id, retired); }
std::string ApplicationRuntime::status() { return folly::toJson(impl->status()); }
void ApplicationRuntime::report_error(const std::string &message) { impl->fail(message); }
bool ApplicationRuntime::input(int id, const Ref<InputEvent> &event) {
  auto found = impl->roots.find(id);
  if (found == impl->roots.end() || found->second->stopping || impl->stopped) return false;
  auto &root = *found->second;
  if (impl->wheel(root, event)) { impl->pump(); return true; }
  bool blocked = root.pointer->blocks_native();
  if (!root.pointer->input(event)) return false;
  impl->pump();
  return blocked || root.pointer->blocks_native();
}
void ApplicationRuntime::cancel(int id) {
  auto found = impl->roots.find(id);
  if (found != impl->roots.end()) found->second->pointer->cancel();
}
void ApplicationRuntime::activate(int id, int tag) {
  auto root = impl->roots.find(id);
  auto found = impl->views.find(tag);
  if (root == impl->roots.end() || root->second->stopping || impl->stopped ||
      found == impl->views.end() || found->second.surface_id != id || component_kind(found->second.shadow) != "button") return;
  ++root->second->events;
  std::static_pointer_cast<const ControlEventEmitter>(found->second.shadow.eventEmitter)->activate();
}
void ApplicationRuntime::change(int id, const String &text, int tag) {
  auto found = impl->views.find(tag);
  if (!impl->stopped && impl->roots.contains(id) && !impl->roots.at(id)->stopping &&
      found != impl->views.end() && found->second.surface_id == id && found->second.input)
    found->second.input->changed(text);
}
void ApplicationRuntime::focus(int id, bool focused, int tag) {
  auto found = impl->views.find(tag);
  if (!impl->stopped && impl->roots.contains(id) && !impl->roots.at(id)->stopping &&
      found != impl->views.end() && found->second.surface_id == id && found->second.input)
    found->second.input->focus(focused);
}
void ApplicationRuntime::submit(int id, int tag) {
  auto found = impl->views.find(tag);
  if (!impl->stopped && impl->roots.contains(id) && !impl->roots.at(id)->stopping &&
      found != impl->views.end() && found->second.surface_id == id && found->second.input)
    found->second.input->submitted();
}
void ApplicationRuntime::key(int id, const Ref<InputEvent> &event, int tag) {
  auto found = impl->views.find(tag);
  if (!impl->stopped && impl->roots.contains(id) && !impl->roots.at(id)->stopping &&
      found != impl->views.end() && found->second.surface_id == id && found->second.input)
    found->second.input->key(event);
}
}
