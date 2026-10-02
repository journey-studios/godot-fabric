#include "fabric_surface.h"
#include "godot_component.h"
#include "input_adapter.h"
#include "pointer_adapter.h"
#include "svg_node.h"
#include "scroll_adapter.h"
#include "appearance_adapter.h"
#include "paragraph_view.h"
#include "timer_registry.h"
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
#include <godot_cpp/variant/utility_functions.hpp>
#include <hermes/hermes.h>
#include <folly/json.h>
#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>
#include <react/renderer/core/EventQueueProcessor.h>
#include <react/renderer/runtimescheduler/RuntimeScheduler.h>
#include <react/renderer/runtimescheduler/RuntimeSchedulerBinding.h>
#include <react/renderer/uimanager/UIManager.h>
#include <react/renderer/uimanager/UIManagerBinding.h>
#include <react/renderer/uimanager/UIManagerDelegate.h>
#include <chrono>
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
class GodotEventBeat final : public rn::EventBeat {
 public:
  using rn::EventBeat::EventBeat;
  void tick() { induce(); }
};
}

struct FabricSurface::Impl final : rn::UIManagerDelegate {
  FabricSurface &host;
  std::unique_ptr<facebook::hermes::HermesRuntime> runtime;
  std::shared_ptr<rn::ContextContainer> context;
  std::shared_ptr<rn::RuntimeScheduler> runtime_scheduler;
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
    bool frame_pending{false};
    std::unique_ptr<fabric_godot::InputAdapter> input;
    std::unique_ptr<fabric_godot::ScrollAdapter> scroll;
  };
  std::map<int, Mounted> views;
  std::unordered_map<Control *, int> native_tags;
  std::set<int> retiring;
  std::unique_ptr<fabric_godot::PointerAdapter> pointer;
  int next_frame{1};
  int commits{}, mount_reports{}, creates{}, deletes{}, updates{}, events{};
  bool stopped{false};
  bool stopping{false};
  Vector2 viewport_size;
  std::shared_ptr<fabric_godot::TextLayout> text_layout;
  std::shared_ptr<fabric_godot::ParagraphLayout> paragraph_layout;
  std::optional<jsi::Function> window_listener;
  int viewport_updates{};
  std::vector<std::string> errors;

  explicit Impl(FabricSurface &surface) : host(surface) {
    // Both Hermes and Godot Controls run on the Godot main thread in this
    // validation. RuntimeExecutor queues work; it never re-enters a render.
    auto config = hermes::vm::RuntimeConfig::Builder().withMicrotaskQueue(true).build();
    if (!host.has_method("set_custom_maximum_size"))
      throw std::runtime_error("Fabric frames require official Godot 4.7 or newer (Control maximum size)");
    runtime = facebook::hermes::makeHermesRuntime(config);
    context = std::make_shared<rn::ContextContainer>();
    text_layout = std::make_shared<fabric_godot::TextLayout>(host.get_theme_font("font", "Label"));
    context->insert("GodotTextLayout", text_layout);
    paragraph_layout = std::make_shared<fabric_godot::ParagraphLayout>(context, text_layout->font(),
        [this](const std::string &error) { fail(error); });
    context->insert("TextLayoutManager", std::shared_ptr<rn::TextLayoutManager>(paragraph_layout));
    viewport_size = host.get_size();
    pointer = std::make_unique<fabric_godot::PointerAdapter>(
        [this](Vector2 point) { return hit_test(&host, point); },
        [this](int tag, Vector2 point) {
          auto found = views.find(tag);
          return found == views.end() ? point : found->second.control->get_global_transform_with_canvas().affine_inverse().xform(point);
        },
        [this](int tag, const std::string &phase, rn::TouchEvent event) { touch_event(tag, phase, std::move(event)); });
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
    install_globals();
    rn::LayoutConstraints constraints;
    constraints.minimumSize = constraints.maximumSize = {static_cast<float>(viewport_size.x), static_cast<float>(viewport_size.y)};
    rn::LayoutContext layout;
    layout.pointScaleFactor = 1;
    ui->startEmptySurface(std::make_unique<rn::ShadowTree>(1, constraints, layout, *ui, *context));
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
    // Logical Godot viewport coordinates; OS DPI/accessibility scaling is a
    // separate platform feature, not yet exposed by this surface.
    result.setProperty(rt, "scale", 1);
    result.setProperty(rt, "fontScale", 1);
    return result;
  }
  void update_viewport() {
    const auto size = host.get_viewport_rect().size;
    if (size == viewport_size || size.x <= 0 || size.y <= 0) return;
    viewport_size = size;
    host.set_size(size);
    rn::LayoutConstraints constraints;
    constraints.minimumSize = constraints.maximumSize = {static_cast<float>(size.x), static_cast<float>(size.y)};
    rn::LayoutContext layout;
    layout.pointScaleFactor = 1;
    ui->getShadowTreeRegistry().visit(1, [&](const rn::ShadowTree &tree) {
      tree.commit([&](const rn::RootShadowNode &root) {
        return root.clone({1, *context}, constraints, layout);
      }, {});
    });
    ++viewport_updates;
    // Native resize never enters React synchronously during mounting.
    work.push_back([this](jsi::Runtime &rt) {
      if (window_listener) window_listener->call(rt, window_metrics(rt));
    });
  }
  void install_globals() {
    runtime->global().setProperty(*runtime, "godotScenario", jsi::String::createFromUtf8(*runtime,
        utf8(host.get_meta("scenario", "react"))));
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
    bind("godotMetrics", 1, [this](jsi::Runtime &rt, auto &, const jsi::Value *args, size_t count) {
      if (!count) return jsi::Value::null();
      auto found = views.find(static_cast<int>(args[0].asNumber()));
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
      if (count < 2) return jsi::Value::undefined();
      auto found = views.find(static_cast<int>(args[0].asNumber()));
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
    return runtime->evaluateJavaScript(std::make_shared<jsi::StringBuffer>(source), "godot-fabric.js");
  }
  void pump(bool frame_tick = false) {
    if (stopped) return;
    try {
      update_viewport();
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
  void stop() {
    if (stopped || stopping) return;
    // O pump ainda conclui unmount e effects, mas não executa timers do app
    // depois que o encerramento começa, mesmo que o prazo já tenha vencido.
    stopping = true;
    // Cancel already queued timers as well as deadlines before flushing React.
    for (auto id : timer_registry->handles()) clear_timer->call(*runtime, static_cast<double>(id));
    frame_callbacks.clear();
    try {
      pointer->cancel();
      pump();
    } catch (const std::exception &error) { fail(error.what()); }
    try {
      evaluate("if(globalThis.GodotApp) GodotApp.stop();");
    } catch (const std::exception &error) { fail(error.what()); }
    // React cleanup precedes native teardown when unmount succeeds. A thrown
    // unmount must not retain Controls, scheduled work or event authority.
    for (int i = 0; i < 32; ++i) pump();
    try {
      ui->getShadowTreeRegistry().visit(1, [](const rn::ShadowTree &tree) { tree.commitEmptyTree(); });
    } catch (const std::exception &error) { fail(error.what()); }
    try {
      ui->stopSurface(1);
    } catch (const std::exception &error) { fail(error.what()); }
    ui->setDelegate(nullptr);
    runtime_scheduler->setShadowTreeRevisionConsistencyManager(nullptr);
    window_listener.reset();
    timer_registry->quit();
    frame_callbacks.clear();
    work.clear();
    stopped = true;
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
    ++events;
    std::static_pointer_cast<const ControlEventEmitter>(found->second.shadow.eventEmitter)->inputEvent(name, std::move(payload));
  }
  void cancel_subtree(Control *control) {
    for (const auto &[tag, mounted] : views)
      if (mounted.control == control || control->is_ancestor_of(mounted.control)) pointer->removed(tag);
  }
  void apply_pointer_filters() {
    for (const auto &[tag, mounted] : views) {
      auto props = std::static_pointer_cast<const rn::ViewProps>(mounted.shadow.props);
      // ScrollContainer supplies geometry, never a second native pan recognizer.
      // Its children still receive Godot GUI input; wheels use our viewport route.
      bool ignore = mounted.scroll || component_kind(mounted.shadow) == "text" || component_kind(mounted.shadow) == "paragraph" || props->pointerEvents == rn::PointerEventsMode::None || props->pointerEvents == rn::PointerEventsMode::BoxNone;
      auto *parent = Object::cast_to<Control>(mounted.control->get_parent());
      while (parent && parent != &host) {
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
  bool wheel(const Ref<InputEvent> &event) {
    auto *mouse = Object::cast_to<InputEventMouseButton>(event.ptr());
    if (!mouse || !mouse->is_pressed()) return false;
    const auto button = mouse->get_button_index();
    if (button < MOUSE_BUTTON_WHEEL_UP || button > MOUSE_BUTTON_WHEEL_RIGHT) return false;
    if (pointer->blocks_native()) return true;
    const int target = hit_test(&host, mouse->get_position());
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
    // A retired emitter loses its React handle. Route cancellation through a
    // surviving ancestor so upstream can release its responder/touch history.
    if (phase == "cancel") {
      while (found != views.end() && retiring.contains(found->first))
        found = views.find(tag_for(Object::cast_to<Control>(found->second.control->get_parent())));
      if (found == views.end())
        for (auto candidate = views.begin(); candidate != views.end(); ++candidate)
          if (!retiring.contains(candidate->first)) { found = candidate; break; }
    }
    if (found == views.end() || !found->second.shadow.eventEmitter) return;
    ++events;
    auto emitter = std::static_pointer_cast<const rn::ViewEventEmitter>(found->second.shadow.eventEmitter);
    if (phase == "start") emitter->onTouchStart(std::move(event));
    else if (phase == "move") emitter->onTouchMove(std::move(event));
    else if (phase == "end") emitter->onTouchEnd(std::move(event));
    else emitter->onTouchCancel(std::move(event));
  }
  void uiManagerDidFinishTransaction(std::shared_ptr<const rn::MountingCoordinator> coordinator, bool) override {
    auto transaction = coordinator->pullTransaction();
    if (!transaction) return;
    ++commits;
    auto *focused = host.get_viewport()->gui_get_focus_owner();
    uint64_t focus_id = focused ? focused->get_instance_id() : 0;
    auto parent = [this](int tag) -> Control * { return tag == 1 ? &host : views.at(tag).control; };
    std::map<int, int> inserted_parents;
    for (const auto &mutation : transaction->getMutations()) {
      if (mutation.type == rn::ShadowViewMutation::Insert)
        inserted_parents[mutation.newChildShadowView.tag] = mutation.parentTag;
      if (mutation.type == rn::ShadowViewMutation::Delete) retiring.insert(mutation.oldChildShadowView.tag);
    }
    for (int tag : retiring) pointer->removed(tag);
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
          auto entry = views.emplace(next.tag, Mounted{control, {}}).first;
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
          ++creates;
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
          ++deletes;
          break;
        }
        case rn::ShadowViewMutation::Update:
          if (next.tag != 1) { apply(next); ++updates; }
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
    ui->reportMount(1);
    ++mount_reports;
  }
  // Fabric creates speculative shadow nodes. Native objects are allocated only
  // from committed Create mutations, never from this callback.
  void uiManagerDidCreateShadowNode(const rn::ShadowNode &) override {}
  void uiManagerDidDispatchCommand(const std::shared_ptr<const rn::ShadowNode> &node,
      const std::string &name, const folly::dynamic &args) override {
    auto found = views.find(node->getTag());
    // Ref commands queued before a removal must not target another instance.
    if (found == views.end() || stopped) return;
    if ((name == "scrollDragStart" || name == "scrollDragTo") && !pointer->owns(node->getTag())) return;
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
    if (!active || views.contains(node->getTag())) pointer->responder(node->getTag(), active, block);
  }
  void uiManagerShouldSynchronouslyUpdateViewOnUIThread(rn::Tag, const folly::dynamic &) override { fail("setNativeProps is not implemented"); }
  void uiManagerDidUpdateShadowTree(const std::unordered_map<rn::Tag, folly::dynamic> &) override { fail("Animated adapter is not implemented"); }
  void uiManagerShouldAddEventListener(std::shared_ptr<const rn::EventListener> listener) override { dispatcher->addListener(std::move(listener)); }
  void uiManagerShouldRemoveEventListener(const std::shared_ptr<const rn::EventListener> &listener) override { dispatcher->removeListener(listener); }
  void uiManagerDidStartSurface(const rn::ShadowTree &) override {}
  void uiManagerDidFinishReactCommit(const rn::ShadowTree &) override {}
  void uiManagerDidPromoteReactRevision(const rn::ShadowTree &) override {}
  void uiManagerShouldAddOnSurfaceStartCallback(OnSurfaceStartCallback &&callback) override {
    ui->getShadowTreeRegistry().visit(1, callback);
  }
  void uiManagerDidCaptureViewSnapshot(rn::Tag, rn::SurfaceId) override { fail("View transitions are not implemented"); }
  void uiManagerDidSetViewSnapshot(rn::Tag, rn::Tag, rn::SurfaceId) override { fail("View transitions are not implemented"); }
  void uiManagerDidClearPendingSnapshots() override {}

  std::string snapshot() {
    folly::dynamic result = folly::dynamic::object("commits", commits)("mountReports", mount_reports)
        ("retiringTags", retiring.size())("creates", creates)("deletes", deletes)
        ("updates", updates)("events", events)("stopped", stopped)("pendingTimers", timer_registry->size())
        ("pendingWork", work.size())("timerEngine", "react-native/TimerManager")
        ("textMeasurements", text_layout->measurements() + paragraph_layout->measurements())("viewportUpdates", viewport_updates)
        ("windowListener", window_listener.has_value())("nativeTags", native_tags.size())
        ("pendingAnimationFrames", frame_callbacks.size())("animationFramesRun", frame_callbacks_run)
        ("viewport", folly::dynamic::object("width", viewport_size.x)("height", viewport_size.y));
    auto nodes = folly::dynamic::array();
    for (auto &[tag, mounted] : views) {
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
    result["pointer"] = pointer->snapshot();
    result["nodes"] = std::move(nodes);
    result["errors"] = folly::dynamic::array();
    for (const auto &error : errors) result["errors"].push_back(error);
    return folly::toJson(result);
  }
};

FabricSurface::FabricSurface() = default;
FabricSurface::~FabricSurface() { if (impl) impl->stop(); }
void FabricSurface::_bind_methods() {
  ClassDB::bind_method(D_METHOD("evaluate", "source"), &FabricSurface::evaluate);
  ClassDB::bind_method(D_METHOD("snapshot"), &FabricSurface::snapshot);
  ClassDB::bind_method(D_METHOD("stop"), &FabricSurface::stop);
  ClassDB::bind_method(D_METHOD("activate", "tag"), &FabricSurface::activate);
  ClassDB::bind_method(D_METHOD("change", "text", "tag"), &FabricSurface::change);
  ClassDB::bind_method(D_METHOD("input_focus", "focused", "tag"), &FabricSurface::input_focus);
  ClassDB::bind_method(D_METHOD("input_submit", "text", "tag"), &FabricSurface::input_submit);
  ClassDB::bind_method(D_METHOD("input_key", "event", "tag"), &FabricSurface::input_key);
}
void FabricSurface::_ready() {
  set_size(get_viewport_rect().size);
  try {
    impl = std::make_unique<Impl>(*this);
    auto bundle = FileAccess::get_file_as_string("res://build/app.js");
    if (bundle.is_empty()) throw std::runtime_error("Missing bundle; run npm run bundle");
    impl->evaluate(utf8(bundle));
  } catch (const std::exception &error) {
    if (impl) impl->fail(error.what());
    else UtilityFunctions::push_error(error.what());
  }
}
void FabricSurface::_process(double) { if (impl) impl->pump(true); }
void FabricSurface::_input(const Ref<InputEvent> &event) {
  if (!impl || impl->stopped) return;
  // Automated viewport tests use an explicit device ID so unrelated OS mouse
  // movement cannot alter an injected held gesture. Interactive runs accept all.
  if (has_meta("validation_input_device") &&
      (event->is_class("InputEventMouse") || event->is_class("InputEventScreenTouch") || event->is_class("InputEventScreenDrag")) &&
      event->get_device() != static_cast<int>(get_meta("validation_input_device"))) {
    get_viewport()->set_input_as_handled();
    return;
  }
  if (impl->wheel(event)) {
    impl->pump();
    get_viewport()->set_input_as_handled();
    return;
  }
  const bool was_blocked = impl->pointer->blocks_native();
  if (!impl->pointer->input(event)) return;
  // Input is outside a JS render. Flush genuine Fabric event negotiation before
  // Godot GUI processing, allowing blockNativeResponder to prevent native input.
  impl->pump();
  if (was_blocked || impl->pointer->blocks_native()) get_viewport()->set_input_as_handled();
}
void FabricSurface::_notification(int what) {
  if (what == NOTIFICATION_WM_WINDOW_FOCUS_OUT && !has_meta("validation_input_device") && impl && !impl->stopped) impl->pointer->cancel();
}
void FabricSurface::_exit_tree() { stop(); }
String FabricSurface::evaluate(const String &source) {
  if (!impl) return "null";
  try { return gd(impl->evaluate(utf8(source)).toString(*impl->runtime).utf8(*impl->runtime)); }
  catch (const std::exception &error) { impl->fail(error.what()); return "null"; }
}
String FabricSurface::snapshot() { return impl ? gd(impl->snapshot()) : String("{}"); }
void FabricSurface::stop() { if (impl) impl->stop(); }
void FabricSurface::activate(int tag) {
  if (!impl || impl->stopped) return;
  auto found = impl->views.find(tag);
  if (found == impl->views.end()) return;
  ++impl->events;
  std::static_pointer_cast<const ControlEventEmitter>(found->second.shadow.eventEmitter)->activate();
}
void FabricSurface::change(const String &text, int tag) {
  if (!impl || impl->stopped) return;
  auto found = impl->views.find(tag);
  if (found == impl->views.end()) return;
  if (found->second.input) found->second.input->changed(text);
}

void FabricSurface::input_focus(bool focused, int tag) {
  if (!impl || impl->stopped) return;
  auto found = impl->views.find(tag);
  if (found != impl->views.end() && found->second.input) found->second.input->focus(focused);
}
void FabricSurface::input_submit(const String &, int tag) {
  if (!impl || impl->stopped) return;
  auto found = impl->views.find(tag);
  if (found != impl->views.end() && found->second.input) found->second.input->submitted();
}
void FabricSurface::input_key(const Ref<InputEvent> &event, int tag) {
  if (!impl || impl->stopped) return;
  auto found = impl->views.find(tag);
  if (found != impl->views.end() && found->second.input) found->second.input->key(event);
}
