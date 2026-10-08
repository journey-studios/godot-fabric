#include "application_runtime.h"
#include "game_service_registry.h"
#include "adapter_registry.h"
#include <thread>
#include "fabric_surface.h"
#include <godot_cpp/variant/callable_custom.hpp>
#include <godot_cpp/classes/input_event_mouse.hpp>
#include "godot_component.h"
#include "input_adapter.h"
#include "pointer_adapter.h"
#include "pointer_event.h"
#include "pointer_geometry.h"
#include "svg_node.h"
#include "scroll_adapter.h"
#include "appearance_adapter.h"
#include "modal_host_view_component_descriptor.h"
#include "modal_presentation.h"
#include "modal_window_stack.h"
#include "transform_adapter.h"
#include "coordinate_transform.h"
#include "paragraph_view.h"
#include "switch_view.h"
#include "activity_indicator_view.h"
#include "app_lifecycle.h"
#include "image_view.h"
#include "image_effects.h"
#include "image_loader.h"
#include "image_loader_module.h"
#include "godot_image_manager.h"
#include "accessible_view.h"
#include "timer_registry.h"
#include "frame_clock.h"
#include "performance_metrics.h"
#include "turbo_module_registry.h"
#include "godot_dom.h"
#include "native_animated.h"
#include "device_services.h"
#include "accessibility_info.h"
#include "networking_modules.h"
#include "godot_http_transport.h"
#include "godot_websocket_transport.h"
#include <react/runtime/TimerManager.h>
#include <react/renderer/components/view/ViewComponentDescriptor.h>
#include <react/renderer/components/view/primitives.h>
#include <react/renderer/components/text/ParagraphComponentDescriptor.h>
#include <react/renderer/components/text/TextComponentDescriptor.h>
#include <react/renderer/components/text/RawTextComponentDescriptor.h>
#include <react/renderer/components/switch/AppleSwitchComponentDescriptor.h>
#include <react/renderer/components/FBReactNativeSpec/ComponentDescriptors.h>
#include <react/renderer/components/image/ImageComponentDescriptor.h>
#include <godot_cpp/classes/input_event_mouse_button.hpp>
#include <godot_cpp/classes/input_event_mouse_motion.hpp>
#include <godot_cpp/classes/input_event_key.hpp>
#include <godot_cpp/classes/input_event_screen_touch.hpp>
#include <godot_cpp/classes/input_event_screen_drag.hpp>
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
#include <jsi/instrumentation.h>
#include <folly/json.h>
#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>
#include <react/renderer/core/EventQueueProcessor.h>
#include <react/renderer/core/ShadowNode.h>
#include <react/renderer/runtimescheduler/RuntimeScheduler.h>
#include <react/renderer/runtimescheduler/RuntimeSchedulerBinding.h>
#include <react/renderer/telemetry/TransactionTelemetry.h>
#include <react/renderer/uimanager/UIManager.h>
#include <react/renderer/uimanager/UIManagerBinding.h>
#include <react/renderer/uimanager/UIManagerDelegate.h>
#include <chrono>
#include <cctype>
#include <cmath>
#include <limits>
#include <deque>
#include <map>
#include <set>
#include <unordered_map>
#include <tuple>

namespace rn = facebook::react;
namespace jsi = facebook::jsi;
using namespace godot;
using fabric_godot::ControlProps;
using fabric_godot::ControlEventEmitter;

static std::string component_kind(const rn::ShadowView &shadow) {
  if (shadow.componentName == std::string("View")) return "view";
  if (shadow.componentName == std::string(rn::ModalHostViewComponentName)) return "modal";
  if (shadow.componentName == std::string("ScrollView")) return "scroll";
  if (shadow.componentName == std::string("Paragraph")) return "paragraph";
  if (shadow.componentName == std::string(rn::AppleSwitchComponentName)) return "switch";
  if (shadow.componentName == std::string(rn::ActivityIndicatorViewComponentName)) return "activity";
  if (shadow.componentName == std::string(rn::ImageComponentName)) return "image";
  if (shadow.componentName == std::string(fabric_godot::ControlName))
    return std::static_pointer_cast<const ControlProps>(shadow.props)->kind;
  return shadow.componentName;
}

namespace {
double now_ms() {
  return std::chrono::duration<double, std::milli>(
      std::chrono::steady_clock::now().time_since_epoch()).count();
}
// RN's own timing of the layout that a mounted revision went through, which the host does not
// bracket: zero when the revision recorded none.
double layout_ms(const rn::TransactionTelemetry &telemetry) {
  const auto start = telemetry.getLayoutStartTime();
  const auto end = telemetry.getLayoutEndTime();
  if (start == rn::kTelemetryUndefinedTimePoint || end == rn::kTelemetryUndefinedTimePoint || end < start) {
    return 0;
  }
  return std::chrono::duration<double, std::milli>(end - start).count();
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
// MessageQueue owns this callable independently of any Godot Node. A game
// callback may free its FabricApplication without returning through that
// freed object's _process notification stack.
class GodotHostPhaseCallback final : public CallableCustom {
 public:
  explicit GodotHostPhaseCallback(std::function<void()> callback) : callback(std::move(callback)) {}
  uint32_t hash() const override { return static_cast<uint32_t>(reinterpret_cast<uintptr_t>(this)); }
  String get_as_text() const override { return "GodotFabric deferred host phase"; }
  CompareEqualFunc get_compare_equal_func() const override { return [](const CallableCustom *a, const CallableCustom *b) { return a == b; }; }
  CompareLessFunc get_compare_less_func() const override { return [](const CallableCustom *a, const CallableCustom *b) { return std::less<const CallableCustom *>{}(a, b); }; }
  ObjectID get_object() const override { return ObjectID(); }
  bool is_valid() const override { return true; }
  void call(const Variant **, int count, Variant &result, GDExtensionCallError &failure) const override {
    result = Variant();
    failure.error = count ? GDEXTENSION_CALL_ERROR_TOO_MANY_ARGUMENTS : GDEXTENSION_CALL_OK;
    if (!count) callback();
  }
 private:
  std::function<void()> callback;
};
enum class CoreControlSignal { Activate, Change, FocusEntered, FocusExited, Submit, Key, Toggle, ModalWindowInput, AccessibilityTap };
// A Control's connection belongs to its original runtime and mount. Binding a
// mutable FabricSurface would reroute an old queued signal after an owner switch.
class GodotCoreControlCallback final : public CallableCustom {
 public:
  using Callback = std::function<void(const Variant **)>;
  GodotCoreControlCallback(int count, Variant::Type type, Callback callback)
      : count(count), type(type), callback(std::move(callback)) {}
  uint32_t hash() const override { return static_cast<uint32_t>(reinterpret_cast<uintptr_t>(this)); }
  String get_as_text() const override { return "GodotFabric originating core Control"; }
  CompareEqualFunc get_compare_equal_func() const override { return [](const CallableCustom *a, const CallableCustom *b) { return a == b; }; }
  CompareLessFunc get_compare_less_func() const override { return [](const CallableCustom *a, const CallableCustom *b) { return std::less<const CallableCustom *>{}(a, b); }; }
  ObjectID get_object() const override { return ObjectID(); }
  int get_argument_count(bool &valid) const override { valid = true; return count; }
  bool is_valid() const override { return true; }
  void call(const Variant **args, int actual_count, Variant &result, GDExtensionCallError &failure) const override {
    result = Variant();
    failure.error = GDEXTENSION_CALL_OK;
    if (actual_count != count) {
      failure.error = actual_count < count ? GDEXTENSION_CALL_ERROR_TOO_FEW_ARGUMENTS : GDEXTENSION_CALL_ERROR_TOO_MANY_ARGUMENTS;
      failure.expected = count;
      return;
    }
    if (count && args[0]->get_type() != type) {
      failure.error = GDEXTENSION_CALL_ERROR_INVALID_ARGUMENT;
      failure.argument = 0;
      failure.expected = type;
      return;
    }
    callback(args);
  }
 private:
  int count;
  Variant::Type type;
  Callback callback;
};
}

struct fabric_godot::ApplicationRuntime::Impl final : rn::UIManagerDelegate,
    std::enable_shared_from_this<fabric_godot::ApplicationRuntime::Impl> {
  struct Root {
    uint64_t host_id{};
    FabricSurface *host() const { return Object::cast_to<FabricSurface>(ObjectDB::get_instance(host_id)); }
    std::string component;
    Vector2 size;
    std::unique_ptr<fabric_godot::PointerAdapter> pointer;
    int commits{}, mount_reports{}, creates{}, deletes{}, updates{}, events{};
    int child_removal_depth{};
    bool stopping{}, stopped{};
    bool started{}, start_pending{};
    folly::dynamic initial_props;
  };
  std::map<int, std::unique_ptr<Root>> roots;
  // Physical contacts belong to one surface within a viewport. Pointer IDs
  // belong to the application, including the hover lifetime of a mouse.
  using PointerKey = std::tuple<uint64_t, uint64_t, int, bool, int>;
  struct RoutedPointer {
    int id{}, surface{}, buttons{};
    bool primary{}, active{}, mouse{}, suppressed{};
    int scroll_tag{};
  };
  std::map<PointerKey, RoutedPointer> pointer_routes;
  std::set<int> pending_pointer_removals;
  int next_pointer_id{1};
  uint64_t last_pointer_event{};
  std::set<std::pair<int, uint64_t>> pointer_event_callers;
  bool pointer_event_delivered{};
  std::function<fabric_godot::WindowMetrics()> read_window;
  std::shared_ptr<fabric_godot::WindowMetricsSnapshot> host_metrics{
      std::make_shared<fabric_godot::WindowMetricsSnapshot>()};
  Ref<fabric_godot::ModalWindowStack> modal_stack;
  uint64_t runtime_id;
  int next_surface_id{1};
  int bundle_evaluations{};
  std::string bundle_url{"godot-fabric.js"};
  std::vector<OnSurfaceStartCallback> surface_callbacks;
  std::unique_ptr<facebook::hermes::HermesRuntime> runtime;
  std::shared_ptr<rn::ContextContainer> context;
  std::shared_ptr<rn::RuntimeScheduler> runtime_scheduler;
  std::unique_ptr<fabric_godot::TurboModuleRegistry> native_modules;
  // RN's networking stack over Godot's HTTP client and WebSocket peer, polled from pump() and ended by stop().
  std::unique_ptr<fabric_godot::Networking> networking;
  // The reads and decodes of RN's Image requests, on the worker pool; finished from pump() and ended by stop().
  std::shared_ptr<fabric_godot::ImageLoader> images;
  // Linking, Clipboard and Vibration over the application's platform backend, ended by stop().
  std::shared_ptr<fabric_godot::DeviceServices> device_services;
  // AccessibilityInfo's settings and events, polled from pump() and ended by stop().
  std::shared_ptr<fabric_godot::AccessibilityInfo> accessibility_info;
  std::shared_ptr<fabric_godot::GameServiceRegistry> game_services;
  std::shared_ptr<fabric_godot::AdapterRegistry> adapters;
  const std::thread::id host_thread{std::this_thread::get_id()};
  uint64_t next_mount_id{1};
  Callable host_phase;
  bool host_phase_pending{};
  Callable surface_phase;
  bool surface_phase_pending{};
  bool draining_surfaces{};
  std::map<int, bool> pending_retirements;
  std::shared_ptr<rn::UIManager> ui;
  rn::SharedComponentDescriptorRegistry descriptors;
  // RN's Native Animated backend for this application; null without RN's flags.
  std::unique_ptr<fabric_godot::NativeAnimated> native_animated;
  rn::ComponentDescriptorProviderRegistry providers;
  std::shared_ptr<rn::EventDispatcher> dispatcher;
  GodotEventBeat *beat{};
  std::deque<rn::RawCallback> work;
  std::unique_ptr<rn::TimerManager> timer_manager;
  fabric_godot::TimerRegistry *timer_registry{}; // Owned by TimerManager.
  std::optional<jsi::Function> clear_timer;
  std::optional<jsi::Function> pointer_listener_query;
  uint32_t dispatching_timer{};
  std::map<int, jsi::Function> frame_callbacks;
  int frame_callbacks_run{};
  // Decides which Godot frames are ticks: only a tick runs the frame callbacks and
  // RN's Native Animated, with one timestamp (frame_clock.h). The rate and pacing
  // are what the display last reported for the window.
  fabric_godot::FrameClock frame_clock;
  double refresh_rate{};
  fabric_godot::FrameClock::Pacing pacing{fabric_godot::FrameClock::Pacing::Time};
  const char *pacing_source{"unknown"};
  // What the host counts and times of its own work (performance_metrics.h), reported by status().
  // A validation run asks, through the application, for a full garbage collection before every
  // heap reading, so that two readings compare what is live and not when the collector last ran.
  fabric_godot::PerformanceMetrics performance;
  std::function<bool()> collect_garbage_on_status;
  // The section reports aggregates (counts, totals, maxima and percentiles). The samples the
  // percentiles come from are about 12 KB on every status(), so only a validation run that asks
  // for them (validation_performance_samples) gets them.
  std::function<bool()> performance_samples;
  // Hermes' heap as it was when the runtime stopped, which a stopped runtime reports from then on.
  std::optional<folly::dynamic> final_hermes;
  struct Mounted {
    Control *control;
    rn::ShadowView shadow;
    int surface_id;
    bool frame_pending{false};
    std::unique_ptr<fabric_godot::InputAdapter> input;
    std::unique_ptr<fabric_godot::ScrollAdapter> scroll;
    std::unique_ptr<fabric_godot::AdapterView> external;
    uint64_t mount_id{};
    std::shared_ptr<fabric_godot::ModalPresentation> modal;
    // What the committed transform leaves of this View, resolved with its shadow.
    fabric_godot::PlanarTransform transform{};
  };
  std::map<int, Mounted> views;
  struct PhysicalHost {
    Window *window{};
    Window *owner_window{};
    Viewport *viewport{};
    Control *control_root{};
    Transform2D boundary_to_viewport;
    fabric_godot::PointerInputSource source;
  };
  std::map<int, std::vector<int>> logical_children;
  std::unordered_map<int, int> logical_parent;
  std::unordered_map<Control *, int> native_tags;
  std::set<int> retiring;
  int next_frame{1};
  bool stopped{false};
  bool stopping{false};
  bool stop_requested{false};
  bool inactive() const { return stopped || stopping || stop_requested; }

  static const rn::ShadowNode *find_family(const rn::ShadowNode &node, rn::Tag tag) {
    if (node.getTag() == tag) return &node;
    for (const auto &child : node.getChildren())
      if (const auto *found = find_family(*child, tag)) return found;
    return nullptr;
  }

  std::optional<PhysicalHost> physical_host(const rn::RootShadowNode::Shared &revision,
      int surface_id, int boundary_tag,
      uint64_t mount_id, const rn::ShadowNodeFamily::Shared &family) const {
    auto root = roots.find(surface_id);
    if (inactive() || root == roots.end() || root->second->stopping || root->second->stopped || !family || !revision)
      return std::nullopt;
    PhysicalHost result;
    if (boundary_tag == surface_id && mount_id == 0 && family == revision->getFamilyShared()) {
      auto *host = root->second->host();
      if (!host || !host->is_inside_tree() || !host->get_window() || !host->get_viewport()) return std::nullopt;
      result.window = host->get_window();
      result.owner_window = result.window;
      result.viewport = host->get_viewport();
      result.control_root = host;
      result.boundary_to_viewport = host->get_global_transform_with_canvas();
    } else {
      auto mounted = views.find(boundary_tag);
      if (mounted == views.end() || mounted->second.surface_id != surface_id ||
          mounted->second.mount_id != mount_id || !mounted->second.modal ||
          mounted->second.shadow.componentName != std::string(rn::ModalHostViewComponentName)) return std::nullopt;
      const auto *current = find_family(*revision, boundary_tag);
      if (!current || current->getFamilyShared() != family ||
          !current->getTraits().check(rn::ShadowNodeTraits::Trait::RootNodeKind)) return std::nullopt;
      auto *window = mounted->second.modal->window();
      if (!window || !window->is_inside_tree() || !window->is_embedded()) return std::nullopt;
      result.window = window;
      auto *host = root->second->host();
      result.owner_window = host ? host->get_window() : nullptr;
      if (!result.owner_window) return std::nullopt;
      result.viewport = window;
      result.control_root = mounted->second.control;
      if (!result.control_root || !result.control_root->is_inside_tree()) return std::nullopt;
      result.boundary_to_viewport = result.control_root->get_global_transform_with_canvas();
    }
    result.source.surface = surface_id;
    result.source.boundary_tag = boundary_tag;
    result.source.boundary_mount = mount_id;
    result.source.window_id = result.window->get_instance_id();
    result.source.viewport_id = result.viewport->get_instance_id();
    result.source.owner_window_id = result.owner_window->get_instance_id();
    result.source.boundary_family = family;
    result.source.boundary_to_viewport = result.boundary_to_viewport;
    auto canvas_inverse = Transform2D();
    if (!coordinate_inverse(result.owner_window->get_global_canvas_transform(), canvas_inverse)) return std::nullopt;
    const auto content = result.owner_window->get_final_transform() * canvas_inverse;
    const auto density = content.get_scale().x;
    if (!std::isfinite(density) || density <= 0 || !Math::is_equal_approx(density, content.get_scale().y))
      return std::nullopt;
    auto screen = result.viewport->get_screen_transform();
    screen.set_origin(screen.get_origin() + Vector2(result.owner_window->get_position()));
    const auto inverse_density = 1.0 / density;
    result.source.viewport_to_screen = Transform2D(
        screen[0] * inverse_density, screen[1] * inverse_density,
        screen[2] * inverse_density);
    return result;
  }

  std::optional<PhysicalHost> physical_host(const fabric_godot::PhysicalEmbedding &embedding) const {
    const auto surface_id = embedding.target().getSurfaceId();
    const auto &boundary = *embedding.path()[embedding.projection_boundary_index()];
    auto mounted = views.find(boundary.getTag());
    return physical_host(embedding.revision(), surface_id, boundary.getTag(),
        mounted == views.end() ? 0 : mounted->second.mount_id,
        boundary.getFamilyShared());
  }

  std::optional<PhysicalHost> physical_host(const fabric_godot::PointerInputSource &source,
      rn::RootShadowNode::Shared revision) const {
    auto host = physical_host(revision, source.surface, source.boundary_tag, source.boundary_mount,
        source.boundary_family);
    if (!host || host->window->get_instance_id() != source.window_id ||
        host->viewport->get_instance_id() != source.viewport_id ||
        host->owner_window->get_instance_id() != source.owner_window_id) return std::nullopt;
    return host;
  }

  std::optional<PhysicalHost> physical_input_host(const fabric_godot::PointerInputSource &source,
      rn::RootShadowNode::Shared revision) const {
    auto host = physical_host(source, std::move(revision));
    if (!host || !host->control_root || !host->control_root->is_visible_in_tree()) return std::nullopt;
    return host;
  }

  std::optional<PhysicalHost> physical_input_host(const fabric_godot::PointerInputSource &source) const {
    auto revision = ui ? ui->getShadowTreeRevisionProvider()->getCurrentRevision(source.surface) : nullptr;
    return physical_input_host(source, std::move(revision));
  }

  std::optional<fabric_godot::PointerInputSource> root_pointer_source(int surface_id) const {
    auto root = roots.find(surface_id);
    if (root == roots.end() || !ui) return std::nullopt;
    auto revision = ui->getShadowTreeRevisionProvider()->getCurrentRevision(surface_id);
    if (!revision) return std::nullopt;
    auto host = physical_host(revision, surface_id, surface_id, 0, revision->getFamilyShared());
    if (!host) return std::nullopt;
    return host->source;
  }

  std::optional<fabric_godot::PointerInputSource> modal_pointer_source(int surface_id,
      int tag, uint64_t mount_id) const {
    auto root = roots.find(surface_id);
    if (root == roots.end() || !ui) return std::nullopt;
    auto revision = ui->getShadowTreeRevisionProvider()->getCurrentRevision(surface_id);
    const auto *boundary = revision ? find_family(*revision, tag) : nullptr;
    if (!boundary) return std::nullopt;
    auto host = physical_host(revision, surface_id, tag, mount_id, boundary->getFamilyShared());
    if (!host) return std::nullopt;
    return host->source;
  }

  void remove_logical_child(int parent_tag, int child_tag) {
    auto owner = logical_parent.find(child_tag);
    if (owner == logical_parent.end() || owner->second != parent_tag) return;
    auto parent = logical_children.find(parent_tag);
    if (parent != logical_children.end()) {
      auto &children = parent->second;
      children.erase(std::remove(children.begin(), children.end(), child_tag), children.end());
    }
    logical_parent.erase(owner);
  }
  void forget_logical_tag(int tag) {
    auto owner = logical_parent.find(tag);
    if (owner != logical_parent.end()) remove_logical_child(owner->second, tag);
    auto children = logical_children.find(tag);
    if (children != logical_children.end()) {
      for (int child : children->second) {
        auto parent = logical_parent.find(child);
        if (parent != logical_parent.end() && parent->second == tag) logical_parent.erase(parent);
      }
    }
    logical_children.erase(tag);
  }
  int insert_logical_child(int parent_tag, int child_tag, int index, Node *physical_parent) {
    auto owner = logical_parent.find(child_tag);
    if (owner != logical_parent.end()) remove_logical_child(owner->second, child_tag);
    auto &children = logical_children[parent_tag];
    if (index < 0 || static_cast<size_t>(index) > children.size())
      throw std::runtime_error("E_MODAL_MOUNT_ORDER: React supplied an invalid logical child index");
    children.insert(children.begin() + index, child_tag);
    logical_parent[child_tag] = parent_tag;
    int physical_index = 0;
    for (int current = 0; current < index; ++current) {
      const auto sibling = views.find(children[current]);
      if (sibling != views.end() && sibling->second.control->get_parent() == physical_parent)
        ++physical_index;
    }
    return physical_index;
  }
  int execution_depth{};
  struct ExecutionScope {
    Impl &owner;
    explicit ExecutionScope(Impl &owner) : owner(owner) { ++owner.execution_depth; }
    ~ExecutionScope() noexcept {
      if (--owner.execution_depth || owner.stopping || owner.stopped) return;
      // A native setter can emit a Godot signal which requests shutdown while
      // Fabric or Hermes still owns the calling stack. Retire authority now,
      // but keep Controls/ShadowTrees alive until that outer stack unwinds.
      try {
        if (owner.stop_requested) owner.stop();
        else owner.schedule_surface_phase();
      }
      catch (const std::exception &error) { owner.fail(error.what()); }
    }
  };
  struct ChildRemovalScope {
    int &depth;
    explicit ChildRemovalScope(int &depth) : depth(depth) { ++depth; }
    ~ChildRemovalScope() { --depth; }
  };
  Vector2 viewport_size;
  std::shared_ptr<fabric_godot::TextLayout> text_layout;
  std::shared_ptr<fabric_godot::ParagraphLayout> paragraph_layout;
  std::optional<jsi::Function> window_listener;
  int viewport_updates{};
  std::string metrics_error;
  std::vector<std::string> errors;
  // Down/Up lookups run once per gesture and report every failure. Move and
  // hover lookups run on every sample or hover change: each distinct failure is
  // retained once, and repeats or distinct failures past the bound are counted.
  static constexpr std::size_t max_retained_sample_query_failures = 16;
  std::set<std::string> retained_sample_query_failures;
  uint64_t suppressed_sample_query_failures{};

  explicit Impl(FabricSurface &theme_source, std::function<fabric_godot::WindowMetrics()> metrics,
      const std::string &scenario, uint64_t id, std::shared_ptr<fabric_godot::GameServiceRegistry> services,
      const std::shared_ptr<fabric_godot::AppLifecycle> &lifecycle,
      const std::shared_ptr<fabric_godot::SystemAppearance> &appearance, std::function<std::string()> trusted_authorities,
      std::function<double()> clock_offset_ms, std::shared_ptr<fabric_godot::AdapterRegistry> selected,
      std::shared_ptr<fabric_godot::DeviceServices> device, std::shared_ptr<fabric_godot::AccessibilityInfo> accessibility)
      : read_window(std::move(metrics)), runtime_id(id), device_services(std::move(device)), accessibility_info(std::move(accessibility)),
        game_services(std::move(services)), adapters(std::move(selected)) {
    if (adapters && !adapters->sealed()) throw std::runtime_error("E_ADAPTER_UNSEALED: application requires a sealed selection");
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
    // RN's Image shadow node takes its requests from the ImageManager registered under this name, inside layout.
    images = std::make_shared<fabric_godot::ImageLoader>(host_thread);
    context->insert(rn::ImageManagerKey, std::shared_ptr<rn::ImageManager>(std::make_shared<fabric_godot::GodotImageManager>(context, images)));
    host_metrics->set(read_window());
    context->insert(fabric_godot::modal_window_metrics_context, host_metrics);
    const auto initial_metrics = host_metrics->get();
    viewport_size = initial_metrics.size;
    refresh_rate = initial_metrics.refresh_rate;
    pacing = initial_metrics.pacing;
    pacing_source = initial_metrics.pacing_source;
    runtime->global().setProperty(*runtime, "godotScenario", jsi::String::createFromUtf8(*runtime, scenario));
    // RN's ReactInstance sets this before every JS callback its runtime executor
    // runs and never resets it (ReactInstance.cpp:101): on the JS thread, a shadow
    // node cloned with fragment.runtimeShadowNodeReference becomes the node JS
    // holds. Godot's main thread is this host's JS thread, so it is set once.
    rn::ShadowNode::setUseRuntimeShadowNodeReferenceUpdateOnThread(true);
    rn::RuntimeExecutor executor = [this](rn::RawCallback &&callback) {
      work.push_back(std::move(callback));
    };
    runtime_scheduler = std::make_shared<rn::RuntimeScheduler>(executor,
        rn::HighResTimeStamp::now,
        [this](jsi::Runtime &, jsi::JSError &error) { fail(error.what()); });
    context->insert(rn::RuntimeSchedulerKey, std::weak_ptr<rn::RuntimeScheduler>(runtime_scheduler));
    ui = std::make_shared<rn::UIManager>(executor, context);
    ui->setDelegate(this);
    native_animated = fabric_godot::NativeAnimated::attach(ui, now_ms);
    auto owner = std::make_shared<rn::EventBeat::OwnerBox>();
    auto event_beat = std::make_unique<GodotEventBeat>(owner, *runtime_scheduler);
    beat = event_beat.get();
    auto event_pipe = [this](jsi::Runtime &rt, rn::EventTarget *target,
        const std::string &type, rn::ReactEventPriority priority,
        const rn::EventPayload &payload, rn::HighResTimeStamp timestamp) {
      // A retired leaf can enqueue a null-target terminal pointer before its
      // originating root stops. Revoked source authority must also cover that
      // native envelope, while TouchCancel still performs responder cleanup.
      if (const auto *pointer = dynamic_cast<const fabric_godot::GodotPointerEvent *>(&payload)) {
        auto source = roots.find(pointer->source.surface);
        if (inactive() || source == roots.end() || source->second->stopping || !physical_input_host(pointer->source)) return;
      }
      if (target) {
        auto root = roots.find(target->getSurfaceId());
        if (root == roots.end() || ((root->second->stopping || inactive()) && type != "topTouchCancel")) return;
      } else if (inactive()) return;
      rn::UIManagerBinding::getBinding(rt)->dispatchEvent(rt, target, type, priority, payload, timestamp);
    };
    auto state_pipe = [this](const rn::StateUpdate &state) { ui->updateState(state); };
    dispatcher = std::make_shared<rn::EventDispatcher>(
        rn::EventQueueProcessor(event_pipe,
            [this](jsi::Runtime &rt) { runtime_scheduler->callExpiredTasks(rt); }, state_pipe, {}),
        std::move(event_beat), state_pipe, std::weak_ptr<rn::EventLogger>());
    owner->owner = dispatcher;
    providers.add(rn::concreteComponentDescriptorProvider<fabric_godot::ControlDescriptor>());
    providers.add(rn::concreteComponentDescriptorProvider<rn::ViewComponentDescriptor>());
    providers.add(rn::concreteComponentDescriptorProvider<rn::ScrollViewComponentDescriptor>());
    providers.add(rn::concreteComponentDescriptorProvider<rn::ParagraphComponentDescriptor>());
    providers.add(rn::concreteComponentDescriptorProvider<rn::TextComponentDescriptor>());
    providers.add(rn::concreteComponentDescriptorProvider<rn::RawTextComponentDescriptor>());
    // RN's shared iOS/macOS Switch descriptor ("RCTSwitch" in the generated
    // ViewConfig); its measurement is the Godot one in switch_view.cpp.
    providers.add(rn::concreteComponentDescriptorProvider<rn::SwitchComponentDescriptor>());
    // The generated descriptor iOS registers for "RCTActivityIndicatorView";
    // ActivityIndicator.js sizes the frame, so it needs no measurement.
    providers.add(rn::concreteComponentDescriptorProvider<rn::ActivityIndicatorViewComponentDescriptor>());
    // RN's own Image descriptor, state and events; the mount side is GodotImage.
    providers.add(rn::concreteComponentDescriptorProvider<rn::ImageComponentDescriptor>());
    providers.add(rn::concreteComponentDescriptorProvider<fabric_godot::ModalHostViewComponentDescriptor>());
    // Original Fabric registry requests selected descriptors lazily. Requests
    // only register immutable providers; native objects wait for Create commits.
    providers.setComponentDescriptorProviderRequest([this](rn::ComponentName name) {
      if (adapters)
        if (const auto *component = adapters->requested_component(name)) providers.add(component->provider);
    });
    descriptors = providers.createComponentDescriptorRegistry({dispatcher, context, nullptr});
    ui->setComponentDescriptorRegistry(descriptors);
    runtime_scheduler->setShadowTreeRevisionConsistencyManager(ui->getShadowTreeRevisionConsistencyManager());
    rn::RuntimeSchedulerBinding::createAndInstallIfNeeded(*runtime, runtime_scheduler);
    rn::UIManagerBinding::createAndInstallIfNeeded(*runtime, ui);
    rn::UIManagerBinding::getBinding(*runtime)->setPointerEventProjectionForGodot(
        [this](const rn::ShadowNode &target, const rn::EventPayload &source, rn::PointerEvent &event) {
          return project_pointer(target, source, event);
        });
    rn::UIManagerBinding::getBinding(*runtime)->setPointerTargetForGodot(
        [this](const rn::EventPayload &payload) { return root_pointer_target(payload); });
    native_modules = std::make_unique<fabric_godot::TurboModuleRegistry>(runtime_id, runtime_scheduler);
    native_modules->add_game_services(game_services);
    if (scenario == "refs" || scenario == "modules") native_modules->add_fixture();
    native_modules->add_feature_flags();
    if (native_animated) native_modules->add_native_animated();
    native_modules->add_source_code([this] { return bundle_url; });
    native_modules->add_device_info([this] {
      return folly::dynamic::object("Dimensions", device_dimensions());
    });
    native_modules->add_app_state(lifecycle);
    native_modules->add_appearance(appearance);
    // The deadlines of timed requests run on the monotonic clock plus the validation seam's offset, which is 0 outside validation.
    // The close handshake of a socket has a deadline too, so the sockets run on the same clock, and wss trusts the same authorities.
    const auto clock = [offset = clock_offset_ms] { return now_ms() + (offset ? offset() : 0); };
    networking = std::make_unique<fabric_godot::Networking>(fabric_godot::make_godot_http_transport(trusted_authorities, clock),
        fabric_godot::make_godot_websocket_transport(trusted_authorities, clock));
    networking->install(*native_modules);
    // The image loader downloads over a transport of its own, with the same trust and the same clock; the stale times of cached
    // responses are in wall time, which the validation offset moves as well.
    images->enable_network(fabric_godot::make_godot_http_transport(trusted_authorities, clock), clock, [offset = std::move(clock_offset_ms)] {
      return std::chrono::duration<double, std::milli>(std::chrono::system_clock::now().time_since_epoch()).count() + (offset ? offset() : 0);
    });
    lifecycle->on_memory_warning([loader = std::weak_ptr<fabric_godot::ImageLoader>(images)] {
      if (const auto strong = loader.lock()) strong->clear_caches();
    });
    fabric_godot::install_image_loader_module(*native_modules, images);
    if (scenario == "images-fixture") fabric_godot::install_image_loader_fixture(*native_modules, images);
    if (device_services) device_services->install(*native_modules);
    if (accessibility_info) accessibility_info->install(*native_modules);
    native_modules->add("NativeDOMCxx", [this](jsi::Runtime &, const std::shared_ptr<rn::CallInvoker> &invoker) {
      return std::make_shared<fabric_godot::GodotDOM>(invoker,
          [this](const fabric_godot::PhysicalEmbedding &embedding, rn::dom::DOMRect rect, bool transforms) {
            const auto id = embedding.target().getSurfaceId();
            auto root = roots.find(id);
            if (root == roots.end() || root->second->stopping || root->second->stopped)
              return rn::dom::DOMRect{};
            auto physical = physical_host(embedding);
            if (!physical) return rn::dom::DOMRect{};
            const auto transform = physical->boundary_to_viewport;
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
          }, [this](const rn::ShadowNode &node) {
            auto root = roots.find(node.getSurfaceId());
            return !inactive() && root != roots.end() && !root->second->stopping &&
                !root->second->stopped && !retiring.contains(node.getTag());
          });
    });
    if (adapters) adapters->install_modules(*native_modules);
    native_modules->install(*runtime);
    install_globals();
  }

  void initialize_host_phase() {
    std::weak_ptr<Impl> owner = shared_from_this();
    host_phase = Callable(memnew(GodotHostPhaseCallback([owner] {
      auto guard = owner.lock();
      if (!guard) return;
      guard->host_phase_pending = false;
      if (guard->stopping || guard->stopped) return;
      try { guard->game_services->pump_host(); }
      catch (const std::exception &error) { guard->fail(error.what()); }
      // No window/Node access or JS drain after a callback may have freed its
      // application. RN invoker work waits for the next ordinary JS frame.
    })));
    surface_phase = Callable(memnew(GodotHostPhaseCallback([owner] {
      auto guard = owner.lock();
      if (!guard) return;
      guard->surface_phase_pending = false;
      if (guard->inactive() || guard->execution_depth) return;
      guard->drain_surface_operations();
    })));
  }

  void schedule_surface_phase() {
    if (inactive() || execution_depth || draining_surfaces || surface_phase_pending) return;
    const bool starts = std::any_of(roots.begin(), roots.end(), [](const auto &entry) {
      return entry.second->start_pending && !entry.second->stopping;
    });
    if (pending_retirements.empty() && !starts) return;
    surface_phase_pending = true;
    surface_phase.call_deferred();
  }

  void start_root(int id) {
    auto found = roots.find(id);
    if (found == roots.end() || found->second->stopping || inactive()) return;
    auto &surface = *found->second;
    auto *host = surface.host();
    if (!host || !host->is_inside_tree()) { unmount(id); return; }
    surface.start_pending = false;
    fabric_godot::SeriesTimer timing(performance.surface_start(), now_ms);
    rn::LayoutConstraints constraints;
    constraints.minimumSize = constraints.maximumSize = {static_cast<float>(surface.size.x), static_cast<float>(surface.size.y)};
    rn::LayoutContext layout;
    layout.pointScaleFactor = host_metrics->get().scale;
    auto tree = std::make_unique<rn::ShadowTree>(id, constraints, layout, *ui, *context);
    surface.started = true;
    if (surface.component.empty()) ui->startEmptySurface(std::move(tree));
    else ui->startSurface(std::move(tree), surface.component, surface.initial_props, rn::DisplayMode::Visible);
  }

  void drain_surface_operations() {
    if (execution_depth || draining_surfaces || inactive()) return;
    draining_surfaces = true;
    // Never stop/add a ShadowTree inside its own registry visit, or destroy a
    // Control while a user-owned Godot signal is still being emitted.
    try {
      for (int count = 0; !pending_retirements.empty() && count < 256; ++count) {
        auto request = pending_retirements.extract(pending_retirements.begin());
        finalize_unmount(request.key(), request.mapped());
      }
      std::vector<int> starts;
      for (const auto &[id, root] : roots) if (root->start_pending && !root->stopping) starts.push_back(id);
      for (int id : starts) {
        if (inactive()) break;
        ExecutionScope execution(*this);
        start_root(id);
      }
    } catch (const std::exception &error) { fail(error.what()); }
    draining_surfaces = false;
    schedule_surface_phase();
  }

  int mount(FabricSurface &host, const std::string &component, const std::string &props_json) {
    const bool defer_start = execution_depth != 0;
    ExecutionScope execution(*this);
    if (inactive()) throw std::runtime_error("Application is stopped");
    if (!host.get_window() || host.get_viewport() != host.get_window() ||
        host.get_window()->get_instance_id() != host_metrics->get().window_instance_id)
      throw std::runtime_error("Fabric surfaces require the application's native Window; SubViewport and cross-window hosting need a metrics adapter");
    auto *owner_window = host.get_window();
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
    root->host_id = host.get_instance_id();
    root->component = component;
    root->size = host.get_size();
    root->initial_props = std::move(props);
    roots.emplace(id, std::move(root));
    auto &surface = *roots.at(id);
    surface.pointer = std::make_unique<fabric_godot::PointerAdapter>(
        [this](Vector2 point, const fabric_godot::PointerInputSource &source) {
          return physical_hit_test(source, point);
        },
        [this](int tag, const fabric_godot::PointerInputSource &source) {
          return physical_hit_path(tag, source);
        },
        [this](Vector2 point, const fabric_godot::PointerInputSource &source) {
          return physical_inside(source, point);
        },
        [this](int tag, Vector2 point, const fabric_godot::PointerInputSource &source) {
          auto found = views.find(tag);
          auto physical = physical_input_host(source);
          return found == views.end() || !physical || !found->second.control->is_inside_tree() ?
              fabric_godot::invalid_coordinate() :
              fabric_godot::local_coordinate(found->second.control->get_global_transform_with_canvas(), point);
        },
        [this](Vector2 point, const fabric_godot::PointerInputSource &source) {
          const auto invalid = fabric_godot::invalid_coordinate();
          auto physical = physical_input_host(source);
          if (!physical) return fabric_godot::PointerAdapter::Coordinates{invalid, invalid};
          // RN page points and measure() share the logical React root space.
          // Capture the source frame with the native sample; modal input uses
          // its own viewport and cannot borrow a mutable surface transform.
          auto page = fabric_godot::local_coordinate(physical->boundary_to_viewport, point);
          const auto screen = source.viewport_to_screen.xform(point);
          return fabric_godot::PointerAdapter::Coordinates{page, screen};
        },
        [this](int tag, const std::string &phase, rn::TouchEvent event) { touch_event(tag, phase, std::move(event)); },
        [this, id](int tag, bool root_target, const std::string &phase, rn::PointerEvent event, Vector2 point,
            fabric_godot::PointerInputSource source,
            std::shared_ptr<fabric_godot::PointerGeometryHistory> history) {
          pointer_event(id, tag, root_target, phase, std::move(event), point, std::move(source), std::move(history));
        },
        [this, id]() {
          // Every root of this application shares one Hermes runtime and so
          // one JS responder and touch history.
          std::vector<rn::Touch> active;
          for (const auto &[other, root] : roots) {
            if (other == id || !root->pointer) continue;
            for (const auto &touch : root->pointer->touches()) active.push_back(touch);
          }
          return active;
        });
    if (modal_stack.is_null()) modal_stack = fabric_godot::ModalWindowStack::for_window(*owner_window);
    std::weak_ptr<Impl> weak = shared_from_this();
    modal_stack->register_runtime(*owner_window, runtime_id, [weak] {
      auto runtime = weak.lock();
      if (!runtime || runtime->inactive()) return false;
      for (auto &[surface_id, root] : runtime->roots)
        if (root->pointer) root->pointer->cancel();
      runtime->synchronize_pointer_routes();
      return !runtime->inactive();
    });
    if (defer_start) surface.start_pending = true;
    else start_root(id);
    return id;
  }
  void update_props(int id, const std::string &props_json) {
    ExecutionScope execution(*this);
    auto found = roots.find(id);
    if (found == roots.end() || found->second->stopping || inactive()) return;
    if (found->second->component.empty()) throw std::runtime_error("Root props require an AppRegistry component");
    if (found->second->start_pending) found->second->initial_props = folly::parseJson(props_json);
    else ui->setSurfaceProps(id, found->second->component, folly::parseJson(props_json), rn::DisplayMode::Visible);
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
    result.setProperty(rt, "scale", host_metrics->get().scale);
    result.setProperty(rt, "fontScale", 1);
    return result;
  }
  folly::dynamic device_dimensions() const {
    const auto current = host_metrics->get();
    auto metrics = [&](Vector2 size) {
      // Font scaling remains the actual Fabric layout multiplier (1). OS text
      // preferences/insets are still pending; they are not fabricated here.
      return folly::dynamic::object("width", size.x)("height", size.y)
          ("scale", current.scale)("fontScale", 1);
    };
    return folly::dynamic::object("window", metrics(current.size))
        ("screen", metrics(current.screen));
  }
  void update_viewport() {
    const auto next = read_window();
    const auto previous = host_metrics->get();
    if (next.window_instance_id != previous.window_instance_id)
      throw std::runtime_error("A live Fabric application cannot migrate between native Windows");
    refresh_rate = next.refresh_rate;
    pacing = next.pacing;
    pacing_source = next.pacing_source;
    if (next.size.x <= 0 || next.size.y <= 0) return;
    const bool density_changed = next.scale != previous.scale;
    const bool size_changed = next.size != previous.size;
    if (size_changed || density_changed || next.screen != previous.screen) {
      host_metrics->set(next);
      viewport_size = next.size;
      ++viewport_updates;
      if (size_changed) {
        const rn::Size screen_size{.width = static_cast<rn::Float>(next.size.x),
            .height = static_cast<rn::Float>(next.size.y)};
        std::vector<std::pair<std::shared_ptr<fabric_godot::ModalPresentation>,
            std::shared_ptr<const rn::ModalHostViewShadowNode::ConcreteState>>> modal_states;
        for (const auto &[tag, mounted] : views) {
          if (!mounted.modal) continue;
          std::shared_ptr<const rn::ModalHostViewShadowNode::ConcreteState> state;
          if (mounted.shadow.state)
            state = std::dynamic_pointer_cast<const rn::ModalHostViewShadowNode::ConcreteState>(
                mounted.shadow.state);
          modal_states.emplace_back(mounted.modal, std::move(state));
        }
        for (const auto &[modal, state] : modal_states) {
          if (inactive()) break;
          modal->resize(next.size);
          if (!state) continue;
          if (state->getData().screenSize.width == screen_size.width &&
              state->getData().screenSize.height == screen_size.height) continue;
          state->updateState(rn::ModalHostViewState(screen_size));
        }
      }
    }
    for (auto &[id, root] : roots) {
      if (root->stopping) continue;
      auto *host = root->host();
      if (!host) { unmount(id); continue; }
      const auto size = host->get_size();
      if ((size == root->size && !density_changed) || size.x <= 0 || size.y <= 0) continue;
      root->size = size;
      rn::LayoutConstraints constraints;
      constraints.minimumSize = constraints.maximumSize = {static_cast<float>(size.x), static_cast<float>(size.y)};
      rn::LayoutContext layout;
      layout.pointScaleFactor = next.scale;
      if (!root->started) continue;
      ui->getShadowTreeRegistry().visit(id, [&](const rn::ShadowTree &tree) {
        tree.commit([&](const rn::RootShadowNode &node) { return node.clone({id, *context}, constraints, layout); }, {});
      });
    }
    if (!size_changed && !density_changed && next.screen == previous.screen) return;
    const auto dimensions = device_dimensions();
    work.push_back([this, dimensions](jsi::Runtime &rt) {
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
        if (inactive()) return;
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
      return jsi::Value(!inactive());
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
      if (stopping || stop_requested || stopped || count != 1) return jsi::Value::null();
      auto tag = native_tag(args[0]);
      if (!tag) return jsi::Value::null();
      auto node = ui->findShadowNodeByTag_DEPRECATED(*tag);
      auto root = node ? roots.find(node->getSurfaceId()) : roots.end();
      return root != roots.end() && !root->second->stopping
          ? rn::Bridging<std::shared_ptr<const rn::ShadowNode>>::toJs(rt, node) : jsi::Value::null();
    });
    bind("godotInstanceHandle", 1, [this](jsi::Runtime &rt, auto &, const jsi::Value *args, size_t count) {
      if (inactive() || count != 1) return jsi::Value::null();
      auto tag = native_tag(args[0]);
      if (!tag) return jsi::Value::null();
      auto node = ui->findShadowNodeByTag_DEPRECATED(*tag);
      auto current = node ? ui->getNewestCloneOfShadowNode(*node) : nullptr;
      auto root = current ? roots.find(current->getSurfaceId()) : roots.end();
      if (root == roots.end() || root->second->stopping) return jsi::Value::null();
      auto handle = current->getFamily().getInstanceHandle(rt);
      if (handle.isUndefined()) return jsi::Value::null();
      return handle;
    });
    bind("godotInstallPointerListenerQuery", 1, [this](jsi::Runtime &rt, auto &, const jsi::Value *args, size_t count) {
      // Internal opt-in toolchain seam. The pinned SDK query reads the original
      // EventTarget Maps; it never dispatches an event or maintains another map.
      if (inactive() || count != 1 || !args[0].isObject() || !args[0].asObject(rt).isFunction(rt))
        throw jsi::JSError(rt, "Pointer listener query requires one function in a live application");
      if (pointer_listener_query) throw jsi::JSError(rt, "Pointer listener query is already installed");
      pointer_listener_query.emplace(args[0].asObject(rt).asFunction(rt));
      pointer_processor().setListenerInterestForGodot([this](const rn::ShadowNode &node, std::size_t offset) {
        // Down/Up/Move and the hover categories are opted in. Click and the
        // capture notifications retain their preceding behavior until
        // separately verified.
        if (inactive() || !pointer_listener_query) return false;
        using Offset = rn::ViewEvents::Offset;
        static constexpr Offset admitted[] = {Offset::PointerDown, Offset::PointerDownCapture,
            Offset::PointerUp, Offset::PointerUpCapture, Offset::PointerMove, Offset::PointerMoveCapture,
            Offset::PointerEnter, Offset::PointerEnterCapture, Offset::PointerLeave, Offset::PointerLeaveCapture,
            Offset::PointerOver, Offset::PointerOverCapture, Offset::PointerOut, Offset::PointerOutCapture};
        if (std::none_of(std::begin(admitted), std::end(admitted),
                [offset](Offset candidate) { return offset == static_cast<std::size_t>(candidate); })) return false;
        auto root = roots.find(node.getSurfaceId());
        if (root == roots.end() || root->second->stopping) return false;
        auto current = ui->getNewestCloneOfShadowNode(node);
        if (!current) return false;
        auto handle = current->getFamily().getInstanceHandle(*runtime);
        if (!handle.isObject()) return false;
        bool is_root_handle = false;
        if (current->getTraits().check(rn::ShadowNodeTraits::Trait::RootNodeKind)) {
          ui->getShadowTreeRegistry().visit(node.getSurfaceId(), [&](const rn::ShadowTree &tree) {
            const auto revision = tree.getCurrentRevision();
            is_root_handle = revision.rootShadowNode &&
                rn::ShadowNode::sameFamily(*current, *revision.rootShadowNode);
          });
        }
        // RootNodeKind can also occur on nested nodes. Only the actual current
        // root family receives RN's specialized handle, after releasing the
        // registry lock. Component queries still use existing public refs.
        try {
          // Component slot reads can invoke JS getters before entering the SDK.
          // Their failure must reject only this lookup, just like a query fault.
          jsi::Value candidate = jsi::Value::undefined();
          if (is_root_handle) {
            candidate = jsi::Value(*runtime, handle);
          } else {
            auto state = handle.asObject(*runtime).getProperty(*runtime, "stateNode");
            if (!state.isObject()) return false;
            auto canonical = state.asObject(*runtime).getProperty(*runtime, "canonical");
            if (!canonical.isObject()) return false;
            candidate = canonical.asObject(*runtime).getProperty(*runtime, "publicInstance");
            if (!candidate.isObject()) return false;
          }
          auto result = pointer_listener_query->call(*runtime, candidate, static_cast<double>(offset), is_root_handle);
          if (!result.isBool()) throw jsi::JSError(*runtime, "Pointer listener query must return a boolean");
          return result.getBool();
        } catch (const std::exception &error) {
          // Reject only this interest lookup, with an explicit diagnostic.
          // Escaping here discards the remaining EventQueue batch, including
          // TouchStart. Its physical contact stays live until Up/Cancel/retire.
          auto message = std::string("E_POINTER_LISTENER_QUERY: ") + error.what();
          const bool per_sample = offset != static_cast<std::size_t>(Offset::PointerDown) &&
              offset != static_cast<std::size_t>(Offset::PointerDownCapture) &&
              offset != static_cast<std::size_t>(Offset::PointerUp) &&
              offset != static_cast<std::size_t>(Offset::PointerUpCapture);
          if (per_sample && (retained_sample_query_failures.contains(message) ||
              retained_sample_query_failures.size() >= max_retained_sample_query_failures)) {
            ++suppressed_sample_query_failures;
          } else {
            if (per_sample) retained_sample_query_failures.insert(message);
            fail(message);
          }
          return false;
        }
      });
      return jsi::Value::undefined();
    });
    bind("godotMetrics", 1, [this](jsi::Runtime &rt, auto &, const jsi::Value *args, size_t count) {
      if (inactive() || count != 1) return jsi::Value::null();
      auto tag = native_tag(args[0]);
      if (!tag) return jsi::Value::null();
      auto found = views.find(*tag);
      if (found == views.end() || retiring.contains(*tag) || roots.at(found->second.surface_id)->stopping) return jsi::Value::null();
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
      result.setProperty(rt, "insideTree", control->is_inside_tree());
      if (auto *input = Object::cast_to<LineEdit>(control))
        result.setProperty(rt, "editable", input->is_editable());
      return jsi::Value(std::move(result));
    });
    bind("godotFocus", 2, [this](auto &, auto &, const jsi::Value *args, size_t count) {
      if (inactive() || count != 2 || !args[1].isBool()) return jsi::Value::undefined();
      auto tag = native_tag(args[0]);
      if (!tag) return jsi::Value::undefined();
      auto found = views.find(*tag);
      if (found != views.end() && !roots.at(found->second.surface_id)->stopping) {
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
    ExecutionScope execution(*this);
    return runtime->evaluateJavaScript(std::make_shared<jsi::StringBuffer>(source), bundle_url);
  }
  void pump(bool frame_tick = false) {
    ExecutionScope execution(*this);
    if (stopped || stop_requested) return;
    fabric_godot::PumpScope timing(performance, now_ms);
    // The JS turns of this pump, which the phase accounting separates from the mounting
    // callbacks and layout that a React commit inside them runs.
    fabric_godot::PhaseScope js(performance, fabric_godot::Phase::Js, now_ms, false);
    // A React commit below can enqueue PointerCancel after this pump's beat.
    // Keep that pointer registered until a later beat has delivered its terminal
    // event. Do not consume the live set up front: exceptions must retain cleanup.
    const auto ready_pointer_removals = pending_pointer_removals;
    try {
      // One independent deferred phase per frame. Never invoke game Callables
      // while returning through FabricApplication's Godot notification stack.
      if (frame_tick && !stopping && !host_phase_pending) {
        host_phase_pending = true;
        host_phase.call_deferred();
      }
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
        if (roots.at(mounted.surface_id)->stopping) continue;
        if (mounted.input) mounted.input->sample();
        if (mounted.scroll) mounted.scroll->sample();
      }
      beat->tick();
      // Finish the preceding JS turn's microtasks before due native timers.
      js.open();
      runtime->drainMicrotasks();
      js.close();
      // The frame clock decides whether this Godot frame is a tick: the display
      // link RN's frame consumers run on never fires twice within a refresh period.
      // A consumer is a pending frame callback or a Native Animated backend with an
      // animation to run. Timers, input and the work queue are not paced by it.
      const double frame_time = now_ms();
      const bool scroll_motion = std::any_of(views.begin(), views.end(), [](const auto &entry) {
        return entry.second.scroll && entry.second.scroll->active_motion();
      });
      const bool consumer = !frame_callbacks.empty() || scroll_motion || (native_animated && native_animated->active());
      const bool tick = frame_tick && !stopping && frame_clock.frame(frame_time, refresh_rate, pacing, consumer);
      if (tick) {
        for (auto &[tag, mounted] : views) {
          if (roots.at(mounted.surface_id)->stopping || !mounted.scroll) continue;
          mounted.scroll->tick(frame_time / 1000.0);
        }
      }
      // Snapshot the current tick. Callbacks scheduled by a callback, timer, or
      // React commit are deferred to the next tick, never a tight loop.
      std::vector<int> frame_ids;
      if (tick)
        for (const auto &[id, callback] : frame_callbacks) frame_ids.push_back(id);
      js.open();
      for (int id : frame_ids) {
        if (stop_requested) break;
        auto callback = frame_callbacks.extract(id);
        if (callback.empty()) continue;
        ++frame_callbacks_run;
        try { callback.mapped().call(*runtime, frame_time); }
        catch (const std::exception &error) { fail(error.what()); }
        if (!stop_requested) runtime->drainMicrotasks();
      }
      js.close();
      // One native animation frame per tick, at the frame callbacks' time: RN's
      // backend runs its queued operations, drivers and prop updates.
      if (tick && native_animated && !stopping && !stop_requested) {
        try { native_animated->frame(frame_time); }
        catch (const std::exception &error) { fail(error.what()); }
      }
      // Bound a frame's work. Timers created by a callback run on a later tick.
      js.open();
      if (!stopping && !stop_requested)
        for (auto id : timer_registry->take_due(now_ms())) {
          if (stop_requested) break;
          dispatching_timer = id;
          timer_manager->callTimer(id);
        }
      js.close();
      // Requests advance before the drain, so the events they produce are delivered
      // in this pump; one pump reads at most a megabyte of response bodies.
      if (!stopping && !stop_requested) networking->poll(1024 * 1024);
      // Finished image loads are told to their views here, so their events are delivered in this pump too.
      if (!stopping && !stop_requested) images->poll(fabric_godot::ImageLoader::default_upload_budget);
      // The platform's accessibility settings are read once per pump, here, so that the device event of a change is
      // queued before the drain below and reaches JS in this same pump.
      if (!stopping && !stop_requested && accessibility_info) accessibility_info->poll();
      js.open();
      for (int limit = 0; !stop_requested && !work.empty() && limit < 256; ++limit) {
        auto callback = std::move(work.front());
        work.pop_front();
        try { callback(*runtime); }
        catch (const std::exception &error) { fail(error.what()); }
        if (!stop_requested) runtime->drainMicrotasks();
      }
      if (!stop_requested) runtime->drainMicrotasks();
      js.close();
      // A bounded work drain can leave the induced beat callback in the queue.
      // In that case defer retirement rather than erase a still-queued target.
      if (!stop_requested && work.empty())
        for (int id : ready_pointer_removals) {
          pointer_processor().removePointerForGodot(id);
          pending_pointer_removals.erase(id);
        }
      // Registry lookups must run after Fabric's commit callback has unwound;
      // the ShadowTreeRegistry holds its shared lock during that callback.
      pointer_processor().clearDisconnectedCaptureTargetsForGodot(*ui);
    } catch (const std::exception &error) { fail(error.what()); }
  }
  void unmount(int id, bool legacy_hook = false) {
    ExecutionScope execution(*this);
    auto found = roots.find(id);
    if (found == roots.end() || found->second->stopping) return;
    found->second->stopping = true;
    retire_pointers(id);
    found->second->start_pending = false;
    pending_retirements.emplace(id, legacy_hook);
    // A native child removal can emit game signals during this transaction.
    // Detaching an ancestor from such a signal re-enters Godot's tree mutation.
    // Revoke authority now; the independent phase disposes this live host after
    // the outer child-removal stack has returned. Other callbacks retain the
    // immediate detachment required when a game frees the Surface itself.
    if (found->second->child_removal_depth) return;
    const uint64_t host_id = found->second->host_id;
    std::vector<uint64_t> root_controls;
    std::vector<std::pair<std::shared_ptr<fabric_godot::ModalPresentation>, uint64_t>> presentations;
    std::vector<std::pair<uint64_t, uint64_t>> modal_controls;
    if (auto *host = found->second->host()) {
      for (const auto &[tag, mounted] : views) {
        if (mounted.surface_id != id) continue;
        if (mounted.control->get_parent() == host) root_controls.push_back(mounted.control->get_instance_id());
        if (!mounted.modal) continue;
        auto modal = mounted.modal;
        auto *window = modal->window();
        if (!window) continue;
        presentations.emplace_back(modal, window->get_instance_id());
        if (mounted.control->get_parent() == window)
          modal_controls.emplace_back(mounted.control->get_instance_id(), window->get_instance_id());
      }
    }
    // Remove ordinary root controls before modal visibility callbacks can free
    // the Surface. IDs are re-resolved after each Godot tree mutation.
    for (uint64_t control_id : root_controls) {
      auto *host = Object::cast_to<Node>(ObjectDB::get_instance(host_id));
      auto *control = Object::cast_to<Node>(ObjectDB::get_instance(control_id));
      if (host && control && control->get_parent() == host) host->remove_child(control);
    }
    for (const auto &[modal, window_id] : presentations) {
      auto *window = Object::cast_to<Window>(ObjectDB::get_instance(window_id));
      if (window && modal->window() == window && window->is_visible()) modal->hide();
    }
    // A callback may destroy the Surface, revoke a presentation, or stop the
    // runtime. Resolve both endpoints again before detaching modal content.
    for (const auto &[control_id, window_id] : modal_controls) {
      auto *window = Object::cast_to<Node>(ObjectDB::get_instance(window_id));
      auto *control = Object::cast_to<Node>(ObjectDB::get_instance(control_id));
      if (window && control && control->get_parent() == window) window->remove_child(control);
    }
  }
  void finalize_unmount(int id, bool legacy_hook = false) {
    ExecutionScope execution(*this);
    auto found = roots.find(id);
    if (found == roots.end()) return;
    // The retirement is timed through its teardown. The snapshot and the notification below report it and are not part
    // of what a retirement costs, so the sample is taken before them.
    std::optional<fabric_godot::SeriesTimer> timing;
    timing.emplace(performance.surface_retire(), now_ms);
    auto &root = *found->second;
    root.stopping = true;
    retire_pointers(id);
    // Retire active motion while this surface still owns its mounted event
    // emitters. The later fallback deletion runs after UIManager stops it.
    for (auto &[tag, mounted] : views)
      if (mounted.surface_id == id && mounted.scroll) mounted.scroll->cancel();
    root.pointer->cancel();
    // React cleanup must run while this ShadowTree is still registered.
    try {
      if (root.started) {
        if (legacy_hook) evaluate("if(globalThis.GodotApp) GodotApp.stop();");
        else evaluate("if(globalThis.RN$stopSurface) RN$stopSurface(" + std::to_string(id) + ");");
      }
    } catch (const std::exception &error) { fail(error.what()); }
    for (int i = 0; i < 32; ++i) pump();
    try {
      if (root.started) {
        ui->getShadowTreeRegistry().visit(id, [](const rn::ShadowTree &tree) { tree.commitEmptyTree(); });
        ui->stopSurface(id);
      }
      pump();
    } catch (const std::exception &error) { fail(error.what()); }
    // Failed JS/native teardown cannot retain a tree or event authority.
    for (auto &[tag, mounted] : views)
      if (mounted.surface_id == id && mounted.control->get_parent())
        mounted.control->get_parent()->remove_child(mounted.control);
    for (auto it = views.begin(); it != views.end();) {
      if (it->second.surface_id != id) { ++it; continue; }
      forget_logical_tag(it->first);
      retiring.insert(it->first);
      native_tags.erase(it->second.control);
      if (it->second.external) { it->second.external->dispose(); it->second.external.reset(); }
      auto modal = it->second.modal;
      memdelete(it->second.control);
      destroy_modal(std::move(modal));
      retiring.erase(it->first);
      it = views.erase(it);
      ++root.deletes;
    }
    forget_logical_tag(id);
    timing.reset();
    root.stopped = true;
    auto *host = root.host();
    auto retired = folly::parseJson(snapshot(id));
    performance.retire_root(root.commits, root.creates, root.deletes, root.updates);
    roots.erase(id);
    if (roots.empty() && modal_stack.is_valid()) {
      modal_stack->unregister_runtime(runtime_id);
      modal_stack.unref();
    }
    retired["rootCount"] = roots.size();
    // The snapshot above was read with this root alive. Its per-surface fields stay, and the performance
    // section's root counts follow the retirement, so that they agree with rootCount.
    if (auto *section = retired.get_ptr("performance")) {
      if (auto *counters = section->get_ptr("counters")) {
        (*counters)["liveRoots"] = static_cast<int64_t>(roots.size());
        (*counters)["retiredRoots"] = static_cast<int64_t>(performance.retired().roots);
      }
    }
    retired["modalRuntimeMembers"] = modal_stack.is_valid() ? modal_stack->runtime_count() : 0;
    if (host) host->native_unmounted(runtime_id, id, gd(folly::toJson(retired)));
  }
  void stop() {
    if (stopped || stopping) return;
    if (execution_depth) {
      stop_requested = true;
      // Revoke pointer continuations immediately; destruction and React cleanup
      // still wait for the outer native/JS execution scope to unwind.
      for (const auto &[id, root] : roots) retire_pointers(id);
      return;
    }
    stop_requested = false;
    stopping = true;
    pointer_processor().setListenerInterestForGodot({});
    pointer_listener_query.reset();
    host_phase_pending = false;
    surface_phase_pending = false;
    game_services->stop();
    if (native_animated) native_animated->stop();
    // In-flight requests end first: nothing may report to JS from here on.
    networking->stop();
    images->stop();
    if (device_services) device_services->stop();
    if (accessibility_info) accessibility_info->stop();
    for (auto id : timer_registry->handles()) clear_timer->call(*runtime, static_cast<double>(id));
    frame_callbacks.clear();
    std::vector<int> ids;
    std::vector<std::pair<uint64_t, int>> host_ids;
    for (auto &[id, root] : roots) { ids.push_back(id); host_ids.emplace_back(root->host_id, id); }
    for (int id : ids) {
      auto root = roots.find(id);
      if (root != roots.end()) finalize_unmount(id, root->second->component.empty());
    }
    pending_retirements.clear();
    // Settle service cancellations even when no React root is mounted.
    pump();
    try { native_modules->stop(*runtime); }
    catch (const std::exception &error) { fail(error.what()); }
    if (adapters) {
      try { adapters->dispose_modules(); }
      catch (const std::exception &error) { fail(error.what()); }
    }
    if (modal_stack.is_valid()) {
      modal_stack->unregister_runtime(runtime_id);
      modal_stack.unref();
    }
    ui->setDelegate(nullptr);
    rn::UIManagerBinding::getBinding(*runtime)->setPointerEventProjectionForGodot({});
    rn::UIManagerBinding::getBinding(*runtime)->setPointerTargetForGodot({});
    runtime_scheduler->setShadowTreeRevisionConsistencyManager(nullptr);
    window_listener.reset();
    timer_registry->quit();
    frame_callbacks.clear();
    work.clear();
    pointer_routes.clear();
    pending_pointer_removals.clear();
    pointer_event_callers.clear();
    last_pointer_event = 0;
    pointer_event_delivered = false;
    stopped = true;
    final_hermes = hermes_snapshot();
    // Cache the finalized application state for surfaces whose owner may be
    // destroyed before them. Object IDs avoid retaining the scene objects.
    for (auto [host_id, id] : host_ids)
      if (auto *host = Object::cast_to<FabricSurface>(ObjectDB::get_instance(host_id)))
        host->native_unmounted(runtime_id, id, host->snapshot());
  }

  void apply(const rn::ShadowView &shadow) {
    auto root = roots.find(shadow.surfaceId);
    if (root == roots.end() || root->second->stopping) return;
    auto &mounted = views.at(shadow.tag);
    auto *control = mounted.control;
    auto props = std::static_pointer_cast<const rn::ViewProps>(shadow.props);
    const auto kind = component_kind(shadow);
    if (mounted.shadow.props && component_kind(mounted.shadow) != kind)
      throw std::runtime_error("A mounted GodotControl cannot change kind; use a different React key");
    const bool initial = !mounted.shadow.props;
    const auto previous = mounted.shadow;
    mounted.shadow = shadow;
    mounted.frame_pending = true;
    control->set_name(props->testId.empty() ? String("Fabric_") + String::num_int64(shadow.tag) : gd(props->testId));
    control->set_position({shadow.layoutMetrics.frame.origin.x, shadow.layoutMetrics.frame.origin.y});

    // The one place a View's visibility is decided. A collapsed transform (singular:
    // RN draws and hits nothing of the View or its subtree) hides the Control like
    // display: none does, and a hidden Control cancels the contacts of its subtree.
    // Godot cannot draw a singular Control: Control::set_scale clamps 0 to 1e-5, and
    // its input paths invert a visible Control's transform without a guard.
    mounted.transform = fabric_godot::resolve_transform(*props, shadow.layoutMetrics);
    control->set_visible(shadow.layoutMetrics.displayType != rn::DisplayType::None && !mounted.transform.collapsed);
    control->set_modulate({1, 1, 1, props->opacity});
    // Fabric has already flattened stacking contexts and sorted mount indices.
    // A second CanvasItem z-order would let descendants escape those contexts.
    control->set_z_index(0);
    if (kind == "view" || mounted.external)
      control->set_clip_contents(props->yogaStyle.overflow() != facebook::yoga::Overflow::Visible);
    if (!control->is_visible()) cancel_subtree(control);
    if (auto *accessible = Object::cast_to<GodotAccessibleView>(control))
      for (const auto &error : accessible->apply(*props)) fail(error);
    if (mounted.external) {
      mounted.external->update(previous, shadow);
      fabric_godot::apply_appearance(*control, *props, shadow.layoutMetrics);
      apply_frame(mounted);
      return;
    }
    if (kind == "modal") {
      const auto modal_props = std::static_pointer_cast<const rn::ModalHostViewProps>(shadow.props);
      auto modal = mounted.modal;
      if (!modal) throw std::runtime_error("E_MODAL_WINDOW: mounted Modal has no presentation owner");
      if (!modal->apply(*modal_props, host_metrics->get().size)) return;
      fabric_godot::apply_appearance(*control, *props, shadow.layoutMetrics);
      apply_frame(mounted);
      return;
    }
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
    if (auto *toggle = Object::cast_to<GodotSwitch>(control)) {
      toggle->apply(*std::static_pointer_cast<const rn::SwitchProps>(shadow.props),
          initial ? nullptr : std::static_pointer_cast<const rn::SwitchProps>(previous.props).get());
      fabric_godot::apply_appearance(*control, *props, shadow.layoutMetrics);
      apply_frame(mounted);
      return;
    }
    if (auto *picture = Object::cast_to<GodotImage>(control)) {
      picture->apply(shadow);
      fabric_godot::apply_appearance(*control, *props, shadow.layoutMetrics);
      apply_frame(mounted);
      return;
    }
    if (auto *indicator = Object::cast_to<GodotActivityIndicator>(control)) {
      indicator->apply(*std::static_pointer_cast<const rn::ActivityIndicatorViewProps>(shadow.props),
          initial ? nullptr : std::static_pointer_cast<const rn::ActivityIndicatorViewProps>(previous.props).get());
      fabric_godot::apply_appearance(*control, *props, shadow.layoutMetrics);
      apply_frame(mounted);
      return;
    }
    if (shadow.componentName == std::string("View")) {
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
    fabric_godot::apply_appearance(*control, *native_props, shadow.layoutMetrics, native_props.get());
    apply_frame(mounted);
  }

  void present_modals(int surface_id) {
    auto root = roots.find(surface_id);
    if (root == roots.end() || root->second->stopping || !root->second->host() ||
        !root->second->host()->get_window()) return;
    std::vector<std::pair<int, uint64_t>> candidates;
    for (const auto &[tag, mounted] : views)
      if (mounted.surface_id == surface_id && mounted.modal)
        candidates.emplace_back(tag, mounted.mount_id);

    for (const auto &[tag, mount_id] : candidates) {
      root = roots.find(surface_id);
      auto mounted = views.find(tag);
      if (root == roots.end() || root->second->stopping || mounted == views.end() ||
          mounted->second.surface_id != surface_id || mounted->second.mount_id != mount_id ||
          !mounted->second.shadow.props) continue;
      auto modal = mounted->second.modal;
      if (!modal) continue;
      const auto props = std::static_pointer_cast<const rn::ModalHostViewProps>(mounted->second.shadow.props);
      if (!props->visible) {
        if (modal->visible()) modal->hide();
        continue;
      }
      if (modal->visible()) continue;
      if (!modal->present()) continue;

      root = roots.find(surface_id);
      mounted = views.find(tag);
      if (root == roots.end() || root->second->stopping || mounted == views.end() ||
          mounted->second.surface_id != surface_id || mounted->second.mount_id != mount_id ||
          !mounted->second.shadow.props || !mounted->second.shadow.eventEmitter) continue;
      const auto current_props = std::static_pointer_cast<const rn::ModalHostViewProps>(mounted->second.shadow.props);
      if (!current_props->visible || !modal->visible()) continue;
      ++root->second->events;
      std::static_pointer_cast<const rn::ModalHostViewEventEmitter>(
          mounted->second.shadow.eventEmitter)->onShow({});
    }
  }

  static void apply_frame(Mounted &mounted) {
    const auto size = Vector2(mounted.shadow.layoutMetrics.frame.size.width,
        mounted.shadow.layoutMetrics.frame.size.height);
    // godot-cpp's pinned API predates this public 4.7 method. A real native
    // maximum bounds even themed minimums, without wrappers or scaled widgets.
    mounted.control->call("set_custom_maximum_size", size);
    if (!mounted.external && component_kind(mounted.shadow) != "view")
      mounted.control->set_clip_contents(true);
    mounted.control->set_size(size);
    fabric_godot::apply_transform(*mounted.control, mounted.transform, mounted.shadow.layoutMetrics);
  }
  void emit(int tag, const std::string &name, folly::dynamic payload) {
    if (inactive() || retiring.contains(tag)) return;
    auto found = views.find(tag);
    if (found == views.end() || found->second.external || !found->second.shadow.eventEmitter) return;
    if (roots.at(found->second.surface_id)->stopping) return;
    ++roots.at(found->second.surface_id)->events;
    std::static_pointer_cast<const ControlEventEmitter>(found->second.shadow.eventEmitter)->inputEvent(name, std::move(payload));
  }
  // The mount a callback from its control is addressed to, with the application that holds it: on the host thread, while the
  // application, the surface and this mount are all still live. Both are null otherwise.
  static std::pair<std::shared_ptr<Impl>, Mounted *> live_mount(const std::weak_ptr<Impl> &owner, std::thread::id thread,
      int surface_id, int tag, uint64_t mount_id) {
    if (std::this_thread::get_id() != thread) return {};
    auto guard = owner.lock();
    if (!guard || guard->inactive() || guard->retiring.contains(tag)) return {};
    auto root = guard->roots.find(surface_id);
    auto mounted = guard->views.find(tag);
    if (root == guard->roots.end() || root->second->stopping || root->second->stopped || mounted == guard->views.end() ||
        mounted->second.surface_id != surface_id || mounted->second.mount_id != mount_id || mounted->second.external) return {};
    return {std::move(guard), &mounted->second};
  }
  // How one mounted Image reaches JS: through the emitter committed with its shadow view.
  fabric_godot::ImageEmitter image_emitter(int surface_id, int tag, uint64_t mount_id) {
    std::weak_ptr<Impl> owner = shared_from_this();
    const auto thread = host_thread;
    return [owner, thread, surface_id, tag, mount_id](const std::function<void(const rn::ImageEventEmitter &)> &call) {
      auto [guard, mounted] = live_mount(owner, thread, surface_id, tag, mount_id);
      if (!mounted || !mounted->shadow.eventEmitter) return;
      ExecutionScope execution(*guard);
      ++guard->roots.at(surface_id)->events;
      call(*std::static_pointer_cast<const rn::ImageEventEmitter>(mounted->shadow.eventEmitter));
    };
  }
  Callable core_control_signal(int surface_id, int tag, uint64_t mount_id, CoreControlSignal signal) {
    std::weak_ptr<Impl> owner = shared_from_this();
    const auto thread = host_thread;
    const bool takes_argument = signal == CoreControlSignal::Change || signal == CoreControlSignal::Submit ||
        signal == CoreControlSignal::Key || signal == CoreControlSignal::Toggle ||
        signal == CoreControlSignal::ModalWindowInput;
    return Callable(memnew(GodotCoreControlCallback(takes_argument ? 1 : 0,
        signal == CoreControlSignal::Key || signal == CoreControlSignal::ModalWindowInput ? Variant::OBJECT :
            signal == CoreControlSignal::Toggle ? Variant::BOOL : Variant::STRING,
        [owner, thread, surface_id, tag, mount_id, signal](const Variant **args) {
          auto [guard, mounted] = live_mount(owner, thread, surface_id, tag, mount_id);
          if (!mounted) return;
          ExecutionScope execution(*guard);
          if (signal == CoreControlSignal::ModalWindowInput) {
            auto &root = guard->roots.at(surface_id);
            Ref<InputEvent> event = static_cast<Ref<InputEvent>>(*args[0]);
            const bool pointer_sample = Object::cast_to<InputEventMouse>(event.ptr()) ||
                Object::cast_to<InputEventScreenTouch>(event.ptr()) ||
                Object::cast_to<InputEventScreenDrag>(event.ptr());
            auto modal = mounted->modal;
            auto *window = modal ? modal->window() : nullptr;
            if (pointer_sample && window) {
              auto source = guard->modal_pointer_source(surface_id, tag, mount_id);
              if (source) {
                bool blocked = false;
                if (guard->routed_input(surface_id, *root, event, *source, blocked)) {
                  guard->pump();
                  if (blocked)
                    if (auto *still_open = modal->window()) still_open->set_input_as_handled();
                }
              }
              return;
            }
            auto *key = Object::cast_to<InputEventKey>(event.ptr());
            if (!key || !window || !window->is_exclusive() || !key->is_pressed() || key->is_echo() ||
                key->get_keycode() != Key::KEY_ESCAPE) return;
            if (mounted->shadow.componentName != std::string(rn::ModalHostViewComponentName) ||
                !mounted->shadow.eventEmitter) return;
            window->set_input_as_handled();
            ++root->events;
            std::static_pointer_cast<const rn::ModalHostViewEventEmitter>(
                mounted->shadow.eventEmitter)->onRequestClose({});
            return;
          }
          if (signal == CoreControlSignal::Activate) {
            if (component_kind(mounted->shadow) != "button" || !mounted->shadow.eventEmitter) return;
            ++guard->roots.at(surface_id)->events;
            std::static_pointer_cast<const ControlEventEmitter>(mounted->shadow.eventEmitter)->activate();
          } else if (signal == CoreControlSignal::Toggle) {
            const auto &shadow = mounted->shadow;
            if (shadow.componentName != std::string(rn::AppleSwitchComponentName) || !shadow.eventEmitter) return;
            const bool on = static_cast<bool>(*args[0]);
            // RCTSwitchComponentView onChange: no event when the native value
            // already equals the committed value prop. UIManagerBinding mixes
            // the target tag and timeStamp into the payload, as on iOS.
            if (std::static_pointer_cast<const rn::SwitchProps>(shadow.props)->value == on) return;
            ++guard->roots.at(surface_id)->events;
            std::static_pointer_cast<const rn::SwitchEventEmitter>(shadow.eventEmitter)->onChange({.value = on});
          } else if (signal == CoreControlSignal::AccessibilityTap) {
            // iOS accessibilityActivate: only a View with an onAccessibilityTap handler answers the OS's press.
            const auto &shadow = mounted->shadow;
            if (!shadow.eventEmitter || !std::static_pointer_cast<const rn::ViewProps>(shadow.props)->onAccessibilityTap) return;
            ++guard->roots.at(surface_id)->events;
            std::static_pointer_cast<const rn::ViewEventEmitter>(shadow.eventEmitter)->onAccessibilityTap();
          } else if (auto *input = mounted->input.get()) {
            if (signal == CoreControlSignal::Change) input->changed(static_cast<String>(*args[0]));
            else if (signal == CoreControlSignal::FocusEntered) input->focus(true);
            else if (signal == CoreControlSignal::FocusExited) input->focus(false);
            else if (signal == CoreControlSignal::Submit) input->submitted();
            else if (signal == CoreControlSignal::Key) input->key(static_cast<Ref<InputEvent>>(*args[0]));
          }
        })));
  }
  void cancel_subtree(Control *control) {
    for (const auto &[tag, mounted] : views)
      if (mounted.control == control || control->is_ancestor_of(mounted.control)) {
        roots.at(mounted.surface_id)->pointer->removed(tag);
      }
    // PointerAdapter owns physical IDs while pointer_routes owns scroll
    // candidates; retire the latter as soon as a subtree drops the former.
    synchronize_pointer_routes();
  }
  void apply_pointer_filters() {
    for (const auto &[tag, mounted] : views) {
      auto props = std::static_pointer_cast<const rn::ViewProps>(mounted.shadow.props);
      // ScrollContainer supplies geometry, never a second native pan recognizer.
      // Its children still receive Godot GUI input; wheels use our viewport route.
      bool ignore = mounted.scroll || component_kind(mounted.shadow) == "text" || component_kind(mounted.shadow) == "paragraph" || props->pointerEvents == rn::PointerEventsMode::None || props->pointerEvents == rn::PointerEventsMode::BoxNone;
      auto *parent = Object::cast_to<Control>(mounted.control->get_parent());
      if (roots.at(mounted.surface_id)->stopping) continue;
      while (parent && parent != roots.at(mounted.surface_id)->host()) {
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
    const auto local = fabric_godot::local_coordinate(control->get_global_transform_with_canvas(), point);
    if (!local.is_finite()) return 0;
    const bool inside = Rect2(Vector2(), control->get_size()).has_point(local);
    if (!inside && control->is_clipping_contents()) return 0;
    if (!props || props->pointerEvents != rn::PointerEventsMode::BoxOnly) {
      std::vector<Control *> children;
      for (int i = 0; i < control->get_child_count(); ++i)
        if (auto *child = Object::cast_to<Control>(control->get_child(i))) children.push_back(child);
      // Hit testing follows the same Fabric mount order as painting.
      for (auto child = children.rbegin(); child != children.rend(); ++child)
        if (int hit = hit_test(*child, point)) return hit;
    }
    if (!props || props->pointerEvents == rn::PointerEventsMode::BoxNone) return 0;
    const auto inset = props->hitSlop;
    const Rect2 hit_rect(Vector2(-inset.left, -inset.top), control->get_size() + Vector2(inset.left + inset.right, inset.top + inset.bottom));
    if (!hit_rect.has_point(local)) return 0;
    // Expanded touch targets cannot escape their parent's bounds (RN contract).
    auto *parent = Object::cast_to<Control>(control->get_parent());
    if (!inside && parent) {
      const auto parent_local = fabric_godot::local_coordinate(parent->get_global_transform_with_canvas(), point);
      if (!parent_local.is_finite() || !Rect2(Vector2(), parent->get_size()).has_point(parent_local)) return 0;
    }
    return tag;
  }
  int physical_hit_test(const fabric_godot::PointerInputSource &source, Vector2 point) const {
    auto physical = physical_input_host(source);
    return physical && physical->control_root ? hit_test(physical->control_root, point) : 0;
  }
  std::vector<int> physical_hit_path(int tag,
      const fabric_godot::PointerInputSource &source) const {
    std::vector<int> result;
    auto physical = physical_input_host(source);
    auto revision = ui->getShadowTreeRevisionProvider()->getCurrentRevision(source.surface);
    const auto *target = revision ? find_family(*revision, tag) : nullptr;
    if (!physical || !target) return result;
    auto embedding = fabric_godot::PhysicalEmbedding::capture(std::move(revision), *target);
    if (!embedding || embedding->boundary().getFamilyShared() != source.boundary_family) return result;
    const auto &path = embedding->path();
    for (std::size_t index = path.size(); index-- > embedding->boundary_index();) {
      const int current = path[index]->getTag();
      if (current != source.boundary_tag && views.contains(current)) result.push_back(current);
    }
    return result;
  }
  bool physical_inside(const fabric_godot::PointerInputSource &source, Vector2 point) const {
    auto physical = physical_input_host(source);
    if (!physical || !physical->control_root) return false;
    auto *host = physical->control_root;
    const auto local = fabric_godot::local_coordinate(host->get_global_transform_with_canvas(), point);
    return host->is_visible_in_tree() && local.is_finite() &&
        Rect2(Vector2(), host->get_size()).has_point(local);
  }
  bool wheel(Root &surface, const Ref<InputEvent> &event,
      const fabric_godot::PointerInputSource &source) {
    auto *mouse = Object::cast_to<InputEventMouseButton>(event.ptr());
    if (!mouse || !mouse->is_pressed()) return false;
    const auto button = mouse->get_button_index();
    if (button < MOUSE_BUTTON_WHEEL_UP || button > MOUSE_BUTTON_WHEEL_RIGHT) return false;
    if (surface.pointer->blocks_native()) return true;
    if (surface.stopping) return false;
    const int target = physical_hit_test(source, mouse->get_position());
    const int scroll_tag = scroll_ancestor(target, source);
    auto found = views.find(scroll_tag);
    if (found == views.end() || !found->second.scroll || found->second.surface_id != source.surface) return false;
    found->second.scroll->wheel(
        button == MOUSE_BUTTON_WHEEL_UP || button == MOUSE_BUTTON_WHEEL_LEFT ? -1 : 1,
        mouse->get_factor());
    return true;
  }
  void touch_event(int tag, const std::string &phase, rn::TouchEvent event) {
    if (stopped) return;
    auto found = views.find(tag);
    if (found == views.end()) return;
    const int surface_id = found->second.surface_id;
    if ((inactive() || roots.at(surface_id)->stopping) && phase != "cancel") return;
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
  rn::PointerEventsProcessor &pointer_processor() const {
    return rn::UIManagerBinding::getBinding(*runtime)->getPointerEventsProcessor();
  }
  void cancel_scroll_route(RoutedPointer &route) {
    const int scroll_tag = route.scroll_tag;
    const int route_id = route.id;
    route.scroll_tag = 0;
    auto scroll = views.find(scroll_tag);
    if (scroll_tag && scroll != views.end() && scroll->second.scroll)
      scroll->second.scroll->cancel_pointer(route_id);
  }
  void retire_pointers(int id) {
    auto &processor = pointer_processor();
    processor.clearCaptureTargetsForSurfaceForGodot(id);
    for (auto it = pointer_routes.begin(); it != pointer_routes.end();) {
      if (it->second.surface != id) { ++it; continue; }
      cancel_scroll_route(it->second);
      processor.removePointerForGodot(it->second.id);
      if (it->second.mouse && it->second.active) {
        it->second.suppressed = true;
        it->second.surface = 0;
        ++it;
      } else it = pointer_routes.erase(it);
    }
  }
  void retire_pointer_endpoint(uint64_t window_id) {
    auto &processor = pointer_processor();
    for (auto route = pointer_routes.begin(); route != pointer_routes.end();) {
      if (std::get<0>(route->first) != window_id) { ++route; continue; }
      cancel_scroll_route(route->second);
      processor.removePointerForGodot(route->second.id);
      pending_pointer_removals.erase(route->second.id);
      route = pointer_routes.erase(route);
    }
  }
  void destroy_modal(std::shared_ptr<fabric_godot::ModalPresentation> modal) {
    if (!modal) return;
    if (auto *window = modal->window()) retire_pointer_endpoint(window->get_instance_id());
    modal->destroy();
  }
  void synchronize_pointer_routes() {
    for (auto it = pointer_routes.begin(); it != pointer_routes.end();) {
      auto root = roots.find(it->second.surface);
      if (it->second.suppressed || root == roots.end()) {
        cancel_scroll_route(it->second);
        ++it;
        continue;
      }
      const auto ids = root->second->pointer->pointer_ids();
      if (std::find(ids.begin(), ids.end(), it->second.id) != ids.end()) { ++it; continue; }
      cancel_scroll_route(it->second);
      pending_pointer_removals.insert(it->second.id);
      if (it->second.mouse && it->second.active) {
        it->second.suppressed = true;
        ++it;
      } else it = pointer_routes.erase(it);
    }
  }
  // RN resolves an empty point inside a root view to that root (TouchTargetHelper
  // on Android, the root component view's hitTest on iOS). The root then stays
  // in the processor's hover path; the processor never emits to it.
  std::shared_ptr<const rn::ShadowNode> root_pointer_target(const rn::EventPayload &payload) const {
    const auto *sample = dynamic_cast<const fabric_godot::GodotPointerEvent *>(&payload);
    if (!sample || !sample->root_target || inactive()) return nullptr;
    auto root = roots.find(sample->source.surface);
    if (root == roots.end() || root->second->stopping) return nullptr;
    auto revision = ui->getShadowTreeRevisionProvider()->getCurrentRevision(sample->source.surface);
    if (!revision) return nullptr;
    if (sample->source.boundary_tag == sample->source.surface) return revision;
    const auto *boundary = find_family(*revision, sample->source.boundary_tag);
    return boundary && boundary->getFamilyShared() == sample->source.boundary_family ?
        std::shared_ptr<const rn::ShadowNode>(revision, boundary) : nullptr;
  }
  bool project_pointer(const rn::ShadowNode &target, const rn::EventPayload &source, rn::PointerEvent &event) {
    const auto *sample = dynamic_cast<const fabric_godot::GodotPointerEvent *>(&source);
    // Other native adapters can still supply ordinary upstream PointerEvents.
    if (!sample) return true;
    auto origin = roots.find(sample->source.surface);
    auto root = roots.find(target.getSurfaceId());
    if (inactive() || origin == roots.end() || root == roots.end() ||
        origin->second->stopping || root->second->stopping || retiring.contains(target.getTag())) return false;
    // Upstream unique moves can replace an earlier queue slot, so their native
    // sample serials need not be dispatched in increasing order. Older samples
    // still deliver normally, but cannot erase the newest cancellation history.
    sample->history->begin(sample->serial, sample->terminal);
    const fabric_godot::PointerGeometryHistory::NativePoint native_point{
        sample->viewport_point.x, sample->viewport_point.y};
    std::optional<Vector2> offset;
    bool hidden = false;
    try {
      auto revision = ui->getShadowTreeRevisionProvider()->getCurrentRevision(target.getSurfaceId());
      auto embedding = revision ? fabric_godot::PhysicalEmbedding::capture(revision, target) : std::nullopt;
      if (!embedding) return false;
      auto source_revision = ui->getShadowTreeRevisionProvider()->getCurrentRevision(sample->source.surface);
      auto source_host = physical_input_host(sample->source, std::move(source_revision));
      auto target_host = physical_host(*embedding);
      // RN may target another root or a logical ancestor outside a Modal's
      // RootNodeKind. Keep the contact's original screen frame, then project it
      // into the target viewport through Godot's captured host transforms.
      if (!source_host || !target_host || !target_host->control_root->is_visible_in_tree() ||
          source_host->owner_window->get_instance_id() !=
          target_host->owner_window->get_instance_id()) return false;
      Vector2 target_point = sample->viewport_point;
      if (sample->source.viewport_id != target_host->viewport->get_instance_id()) {
        Transform2D screen_to_target;
        if (!coordinate_inverse(target_host->source.viewport_to_screen, screen_to_target)) return false;
        target_point = screen_to_target.xform(sample->source.viewport_to_screen.xform(target_point));
      }
      offset = fabric_godot::pointer_local_point(*embedding, target_point,
        target_host->boundary_to_viewport, [this](rn::Tag tag) -> std::optional<Transform2D> {
          auto mounted = views.find(tag);
          if (mounted == views.end() || retiring.contains(tag) ||
              !mounted->second.control->is_inside_tree()) return std::nullopt;
          return mounted->second.control->get_global_transform_with_canvas();
        }, &hidden);
    } catch (const std::runtime_error &error) {
      if (!sample->terminal || !std::string(error.what()).starts_with("E_POINTER_GEOMETRY_")) throw;
      // A native inverse guard cancels using its last valid sample. Requiring
      // the now-invalid embedding to be invertible would abort TouchCancel and
      // leave Pressability held. Never borrow geometry from a different target,
      // family, sample or pointer; without valid history omit that callback and
      // let original implicit capture release/unregister finish.
    }
    if (!offset) {
      // Connected display:none refs retain original capture/query/delivery and
      // original unpainted-node offsets. There is no painted affine to invert;
      // do not turn a hidden capture into silently swallowed callbacks.
      if (hidden) return true;
      if (!sample->terminal) return false;
      const auto prior = sample->history->previous(target.getFamilyShared(), native_point);
      if (!prior) return false;
      event.offsetPoint = *prior;
      return true;
    }
    const auto x = static_cast<rn::Float>(offset->x), y = static_cast<rn::Float>(offset->y);
    if (!std::isfinite(x) || !std::isfinite(y))
      throw std::runtime_error("E_POINTER_GEOMETRY_RANGE: target-local point exceeds RN precision");
    event.offsetPoint = {x, y};
    sample->history->remember(sample->serial, target.getFamilyShared(), native_point, event.offsetPoint);
    return true;
  }
  void pointer_event(int id, int tag, bool root_target, const std::string &phase, rn::PointerEvent event, Vector2 point,
      fabric_godot::PointerInputSource source,
      std::shared_ptr<fabric_godot::PointerGeometryHistory> history) {
    auto root = roots.find(id);
    if (inactive() || root == roots.end() || root->second->stopping) return;
    if (!physical_input_host(source)) return;
    auto found = views.find(tag);
    const bool mounted = tag && found != views.end() && !retiring.contains(tag) && found->second.shadow.eventEmitter;
    // A click names the view both hit paths share. RN routes it through no
    // capture or hover state, so it never resolves a missing target elsewhere.
    if (phase == "click" && !mounted) return;
    ++root->second->events;
    const auto timestamp = event.timeStamp;
    // A click ends its contact like Up: it never borrows geometry from another
    // target and never raises a geometry error for an embedding that changed.
    const auto payload = std::make_shared<fabric_godot::GodotPointerEvent>(std::move(event), point,
        std::move(source), std::move(history),
        phase == "cancel" || phase == "up" || phase == "leave" || phase == "click", root_target && !tag);
    const std::string type = phase == "down" ? "pointerDown" : phase == "up" ? "pointerUp" :
        phase == "cancel" ? "pointerCancel" : phase == "leave" ? "pointerLeave" : phase == "click" ? "click" :
        "pointerMove";
    // TouchEventEmitter::onClick dispatches the synthetic click as Discrete.
    const auto category = phase == "down" ? rn::RawEvent::Category::ContinuousStart :
        phase == "up" || phase == "cancel" || phase == "leave" ? rn::RawEvent::Category::ContinuousEnd :
        phase == "click" ? rn::RawEvent::Category::Discrete : rn::RawEvent::Category::Unspecified;
    if (!mounted) {
      // A physical hit can be absent while the contact is captured. A typed
      // null-target event lets RN resolve capture and hover using its registry;
      // the binding resolves a root_target sample to the surface's root node.
      dispatcher->dispatchEvent(rn::RawEvent("top" + std::string(1, static_cast<char>(std::toupper(type[0]))) + type.substr(1), payload,
          nullptr, {}, category, false, timestamp));
      return;
    }
    auto emitter = std::static_pointer_cast<const rn::ViewEventEmitter>(found->second.shadow.eventEmitter);
    // Preserve upstream categories and move coalescing without slicing the
    // native envelope in onPointer*'s by-value PointerEvent parameter.
    if (phase == "move") emitter->dispatchUniqueEvent(type, payload, timestamp);
    else emitter->dispatchEvent(type, payload, category, timestamp);
  }
  std::optional<PointerKey> pointer_key(const fabric_godot::PointerInputSource &source,
      const Ref<InputEvent> &event, Vector2 &position) {
    if (event->get_device() == -1) return std::nullopt;
    if (!physical_input_host(source)) return std::nullopt;
    const auto viewport = source.viewport_id;
    const auto window = source.window_id;
    if (auto *mouse = Object::cast_to<InputEventMouse>(event.ptr())) {
      if (auto *button = Object::cast_to<InputEventMouseButton>(event.ptr())) {
        const auto index = button->get_button_index();
        if (index != MOUSE_BUTTON_LEFT && index != MOUSE_BUTTON_RIGHT && index != MOUSE_BUTTON_MIDDLE &&
            index != MOUSE_BUTTON_XBUTTON1 && index != MOUSE_BUTTON_XBUTTON2) return std::nullopt;
      }
      position = mouse->get_position();
      return PointerKey{window, viewport, event->get_device(), true, 0};
    }
    int index;
    if (auto *touch = Object::cast_to<InputEventScreenTouch>(event.ptr())) {
      position = touch->get_position(); index = touch->get_index();
    } else if (auto *drag = Object::cast_to<InputEventScreenDrag>(event.ptr())) {
      position = drag->get_position(); index = drag->get_index();
    } else return std::nullopt;
    if (index < 0 || index == std::numeric_limits<int>::max()) return std::nullopt;
    return PointerKey{window, viewport, event->get_device(), false, index};
  }
  int pointer_hit_surface(uint64_t viewport, Vector2 position) const {
    Control *front = nullptr;
    int result = 0;
    for (const auto &[id, surface] : roots) {
      auto *host = surface->host();
      if (surface->stopping || !host || !host->is_inside_tree() ||
          host->get_viewport()->get_instance_id() != viewport || !hit_test(host, position)) continue;
      if (!front || host->is_greater_than(front)) { front = host; result = id; }
    }
    return result;
  }
  int scroll_ancestor(int target, const fabric_godot::PointerInputSource &source) const {
    if (!target) return 0;
    const auto path = physical_hit_path(target, source);
    for (int tag : path) {
      auto mounted = views.find(tag);
      if (mounted != views.end() && mounted->second.surface_id == source.surface && mounted->second.scroll)
        return tag;
    }
    return 0;
  }
  Vector2 scroll_local_point(int tag, Vector2 viewport_point) const {
    auto mounted = views.find(tag);
    if (mounted == views.end() || !mounted->second.scroll) return Vector2(NAN, NAN);
    return fabric_godot::local_coordinate(mounted->second.control->get_global_transform_with_canvas(), viewport_point);
  }
  bool captured_in_surface(int pointer_id, const fabric_godot::PointerInputSource &source) const {
    auto revision = ui->getShadowTreeRevisionProvider()->getCurrentRevision(source.surface);
    if (!revision) return false;
    auto &processor = pointer_processor();
    std::vector<const rn::ShadowNode *> pending{revision.get()};
    while (!pending.empty()) {
      const auto *node = pending.back();
      pending.pop_back();
      if (processor.hasPointerCapture(pointer_id, node)) return true;
      for (const auto &child : node->getChildren()) pending.push_back(child.get());
    }
    return false;
  }
  bool routed_input(int caller, Root &source, const Ref<InputEvent> &event,
      const fabric_godot::PointerInputSource &input_source, bool &blocked) {
    if (event.is_null()) return false;
    // Emulated mouse and wheel events can have no RN pointer key, but still
    // must be consumed before Godot GUI hit-testing a singular Control.
    if (auto *host = source.host(); host && host->has_meta("validation_input_device") &&
        (event->is_class("InputEventMouse") || event->is_class("InputEventScreenTouch") ||
            event->is_class("InputEventScreenDrag")) &&
        event->get_device() != static_cast<int>(host->get_meta("validation_input_device"))) {
      blocked = true;
      return true;
    }
    if (wheel(source, event, input_source)) {
      blocked = true;
      return true;
    }
    Vector2 position;
    auto key = pointer_key(input_source, event, position);
    if (!key) return false;
    // Godot forwards one InputEvent to several Surface _input callbacks. Keep
    // its one physical sample owned by the first selected root even after Up.
    // A repeated caller starts a new dispatch when a game reuses an event Ref.
    const uint64_t event_id = event->get_instance_id();
    const auto caller_key = std::pair{caller, input_source.window_id};
    if (last_pointer_event != event_id || pointer_event_callers.contains(caller_key)) {
      last_pointer_event = event_id;
      pointer_event_callers.clear();
      pointer_event_delivered = false;
    }
    pointer_event_callers.insert(caller_key);
    if (pointer_event_delivered) return false;
    auto found = pointer_routes.find(*key);
    const bool mouse = std::get<3>(*key);
    if (found != pointer_routes.end() && found->second.suppressed) {
      auto *button = Object::cast_to<InputEventMouseButton>(event.ptr());
      auto *motion = Object::cast_to<InputEventMouseMotion>(event.ptr());
      const int changed_button = button ? 1 << (static_cast<int>(button->get_button_index()) - 1) : 0;
      const int native_buttons = button ? static_cast<uint64_t>(button->get_button_mask()) : 0;
      const bool fresh_down = button && button->is_pressed() && !button->is_canceled() &&
          (!found->second.buttons || (found->second.buttons & changed_button) ||
              (native_buttons && !(native_buttons & found->second.buttons)));
      if (fresh_down ||
          (motion && !static_cast<uint64_t>(motion->get_button_mask()) && !found->second.buttons)) {
        pointer_routes.erase(found);
        found = pointer_routes.end();
      } else {
        if (button) {
          const int mask = 1 << (static_cast<int>(button->get_button_index()) - 1);
          if (button->is_pressed()) found->second.buttons |= mask;
          else found->second.buttons &= ~mask;
          if (button->is_canceled()) found->second.buttons = 0;
        }
        // An ended native contact cannot be recreated by a later drag/release.
        blocked = true;
        pointer_event_delivered = true;
        return true;
      }
    }
    int selected = found != pointer_routes.end() && found->second.active ? found->second.surface :
        input_source.boundary_tag == caller ? pointer_hit_surface(std::get<1>(*key), position) : caller;
    if (!selected && found != pointer_routes.end() && mouse) selected = found->second.surface;
    if (!selected || selected != caller) return false;
    auto target = roots.find(selected);
    if (target == roots.end() || target->second->stopping) return false;
    if (found == pointer_routes.end()) {
      if (!mouse) {
        auto *touch = Object::cast_to<InputEventScreenTouch>(event.ptr());
        if (!touch || !touch->is_pressed() || touch->is_canceled()) return false;
      }
      if (next_pointer_id == std::numeric_limits<int>::max()) {
        fail("Application pointer identity space exhausted"); return false;
      }
      const bool primary = mouse || std::none_of(pointer_routes.begin(), pointer_routes.end(),
          [](const auto &entry) { return !entry.second.mouse && entry.second.active; });
      found = pointer_routes.emplace(*key, RoutedPointer{next_pointer_id++, selected, 0, primary, false, mouse}).first;
    }
    auto &route = found->second;
    pointer_event_delivered = true;
    if (route.surface != selected) {
      auto previous = roots.find(route.surface);
      if (previous != roots.end()) previous->second->pointer->leave_mouse(route.id, &position);
      route.surface = selected;
    }
    const int pointer_id = route.id;
    if (auto *button = Object::cast_to<InputEventMouseButton>(event.ptr())) {
      const int mask = 1 << (static_cast<int>(button->get_button_index()) - 1);
      const int native_buttons = static_cast<uint64_t>(button->get_button_mask());
      if (native_buttons) route.buttons = native_buttons;
      if (button->is_pressed()) route.buttons |= mask;
      else route.buttons &= ~mask;
      if (button->is_canceled()) route.buttons = 0;
      route.active = route.buttons != 0;
    } else if (auto *motion = Object::cast_to<InputEventMouseMotion>(event.ptr())) {
      const int native_buttons = static_cast<uint64_t>(motion->get_button_mask());
      if (native_buttons || !route.active) route.buttons = native_buttons;
    } else if (auto *touch = Object::cast_to<InputEventScreenTouch>(event.ptr()))
      route.active = touch->is_pressed() && !touch->is_canceled();
    auto *mouse_button = Object::cast_to<InputEventMouseButton>(event.ptr());
    auto *screen_touch = Object::cast_to<InputEventScreenTouch>(event.ptr());
    const bool left_press = mouse_button && mouse_button->get_button_index() == MOUSE_BUTTON_LEFT &&
        mouse_button->is_pressed() && !mouse_button->is_canceled();
    const bool touch_press = screen_touch && screen_touch->is_pressed() && !screen_touch->is_canceled();
    const bool left_release = mouse_button && mouse_button->get_button_index() == MOUSE_BUTTON_LEFT &&
        (!mouse_button->is_pressed() || mouse_button->is_canceled());
    const bool touch_release = screen_touch && (!screen_touch->is_pressed() || screen_touch->is_canceled());
    const bool release = left_release || touch_release;
    if (left_press || touch_press) {
      route.scroll_tag = scroll_ancestor(physical_hit_test(input_source, position), input_source);
      if (route.scroll_tag) {
        const auto local = scroll_local_point(route.scroll_tag, position);
        auto scroll = views.find(route.scroll_tag);
        if (scroll != views.end()) scroll->second.scroll->pointer_down(route.id,
            {static_cast<double>(local.x), static_cast<double>(local.y)}, now_ms() / 1000.0);
      }
    }
    const bool terminal = !mouse && !route.active;
    blocked = target->second->pointer->blocks_native();
    const bool accepted = target->second->pointer->input(event, route.id, route.primary, input_source);
    const bool invalid = target->second->pointer->invalid_coordinates();
    blocked = target->second->pointer->blocks_native() || invalid;
    // EventDispatcher runs native event listeners before queuing JS delivery.
    // Reacquire by key and id after that hook before using this route again.
    auto current_route = pointer_routes.find(*key);
    const bool route_survived_dispatch = current_route != pointer_routes.end() && current_route->second.id == pointer_id;
    if (route_survived_dispatch && current_route->second.scroll_tag) {
      auto &live_route = current_route->second;
      const auto local = scroll_local_point(live_route.scroll_tag, position);
      auto scroll = views.find(live_route.scroll_tag);
      if (scroll == views.end() || !scroll->second.scroll || !local.is_finite()) {
        cancel_scroll_route(live_route);
      } else {
        auto &adapter = *scroll->second.scroll;
        const double now = now_ms() / 1000.0;
        const fabric_godot::ScrollPoint point{static_cast<double>(local.x), static_cast<double>(local.y)};
        if (adapter.dragging(live_route.id)) {
          if (release) {
            const int route_id = live_route.id;
            live_route.scroll_tag = 0;
            adapter.finish_pan(route_id, point, now,
                (screen_touch && screen_touch->is_canceled()) || (mouse_button && mouse_button->is_canceled()));
          } else adapter.update_pan(live_route.id, point, now);
        } else if (release) {
          cancel_scroll_route(live_route);
        } else if (!invalid && adapter.pan_ready(live_route.id, point, blocked) &&
            !captured_in_surface(live_route.id, input_source)) {
          const int scroll_tag = live_route.scroll_tag;
          const int route_id = live_route.id;
          target->second->pointer->takeover(scroll_tag, route_id);
          auto after_takeover = pointer_routes.find(*key);
          auto mounted_scroll = views.find(scroll_tag);
          if (after_takeover != pointer_routes.end() && after_takeover->second.id == route_id &&
              after_takeover->second.scroll_tag == scroll_tag && mounted_scroll != views.end() &&
              mounted_scroll->second.scroll)
            mounted_scroll->second.scroll->begin_pan(route_id, point, now);
        }
      }
    }
    if (terminal) {
      auto terminal_route = pointer_routes.find(*key);
      if (terminal_route != pointer_routes.end() && terminal_route->second.id == pointer_id) {
        pointer_routes.erase(terminal_route);
        pending_pointer_removals.insert(pointer_id);
      }
    }
    synchronize_pointer_routes();
    return accepted;
  }
  void uiManagerDidFinishTransaction(std::shared_ptr<const rn::MountingCoordinator> coordinator, bool) override {
    ExecutionScope execution(*this);
    fabric_godot::PhaseScope mounting(performance, fabric_godot::Phase::Mount, now_ms);
    auto transaction = coordinator->pullTransaction();
    if (!transaction) return;
    // The commit that produced this revision laid it out before it reached this callback: RN timed
    // that layout, and it was part of the work that was running around the callback.
    mounting.charge_enclosing(fabric_godot::Phase::Layout, layout_ms(transaction->getTelemetry()));
    auto root_entry = roots.find(transaction->getSurfaceId());
    if (root_entry == roots.end() || root_entry->second->stopping) return;
    auto &surface = *root_entry->second;
    auto *host_pointer = surface.host();
    if (!host_pointer || !host_pointer->is_inside_tree()) { unmount(transaction->getSurfaceId()); return; }
    auto &host = *host_pointer;
    const int surface_id = transaction->getSurfaceId();
    ++surface.commits;
    auto *focused = host.get_viewport()->gui_get_focus_owner();
    uint64_t focus_id = focused ? focused->get_instance_id() : 0;
    struct MountPoint {
      Node *node;
      int index;
    };
    auto parent = [this, &host, surface_id](int tag, int child_tag) -> MountPoint {
      auto &child = views.at(child_tag);
      if (child.modal) {
        auto *window = child.modal->window();
        if (!window) throw std::runtime_error("E_MODAL_WINDOW: insert target Window was retired");
        return {window, 0};
      }
      if (tag == surface_id) return {&host, -1};
      auto &mounted = views.at(tag);
      if (mounted.modal) return {mounted.control, -1};
      return {mounted.external ? static_cast<Node *>(mounted.external->children_host()) : mounted.control, -1};
    };
    std::map<int, int> inserted_parents;
    for (const auto &mutation : transaction->getMutations()) {
      if (surface.stopping || inactive()) break;
      if (mutation.type == rn::ShadowViewMutation::Insert)
        inserted_parents[mutation.newChildShadowView.tag] = mutation.parentTag;
      if (mutation.type == rn::ShadowViewMutation::Delete) retiring.insert(mutation.oldChildShadowView.tag);
    }
    for (int tag : retiring) surface.pointer->removed(tag);
    synchronize_pointer_routes();
    for (const auto &mutation : transaction->getMutations()) {
      const auto &old = mutation.oldChildShadowView;
      const auto &next = mutation.newChildShadowView;
      if (surface.stopping || inactive()) break;
      switch (mutation.type) {
        case rn::ShadowViewMutation::Create: {
          const auto kind = component_kind(next);
          Control *control = nullptr;
          Window *modal_window = nullptr;
          std::shared_ptr<fabric_godot::ModalPresentation> modal;
          std::unique_ptr<fabric_godot::AdapterView> external;
          const auto mount_id = next_mount_id++;
          const auto *selected = adapters ? adapters->component(next.componentHandle) : nullptr;
          if (selected) {
            std::weak_ptr<Impl> owner = shared_from_this();
            const auto thread = host_thread;
            fabric_godot::AdapterViewContext context{runtime_id, mount_id, surface_id, next.tag,
                [owner, thread, surface_id, tag = next.tag, mount_id](const fabric_godot::AdapterViewContext::Event &event) {
                  // Reject on the calling thread before touching host-owned maps.
                  if (std::this_thread::get_id() != thread || !event) return false;
                  auto guard = owner.lock();
                  if (!guard || guard->stopped || guard->stopping || guard->stop_requested || guard->retiring.contains(tag)) return false;
                  auto root = guard->roots.find(surface_id);
                  auto mounted = guard->views.find(tag);
                  if (root == guard->roots.end() || root->second->stopping || root->second->stopped ||
                      mounted == guard->views.end() || mounted->second.surface_id != surface_id ||
                      mounted->second.mount_id != mount_id || !mounted->second.external ||
                      !mounted->second.shadow.eventEmitter) return false;
                  // Resolve the committed emitter at delivery, never the emitter
                  // or Control captured by the adapter when it was constructed.
                  const auto current = mounted->second.shadow;
                  ++root->second->events;
                  event(current);
                  return true;
                }};
            external = selected->factory(std::move(context));
            if (!external) throw std::runtime_error("E_ADAPTER_VIEW: factory returned no view");
            control = external->control();
            auto *children = external->children_host();
            if (!control || control->get_parent() || control->is_inside_tree() || native_tags.contains(control) || !children ||
                (children != control && !control->is_ancestor_of(children))) {
              external->dispose();
              external.reset();
              // Only an unowned off-tree Control can be reclaimed on rejection.
              if (control && !control->get_parent() && !control->is_inside_tree() && !native_tags.contains(control)) memdelete(control);
              throw std::runtime_error("E_ADAPTER_VIEW: expected an off-tree Control and a contained children host");
            }
          } else if (kind == "modal") {
            auto *host = surface.host();
            auto *owner_window = host ? host->get_window() : nullptr;
            if (!owner_window) throw std::runtime_error("E_MODAL_WINDOW: Fabric root has no host Window");
            modal = fabric_godot::ModalPresentation::create(*owner_window,
                {runtime_id, surface_id, next.tag, mount_id}, host_metrics->get().size);
            modal_window = modal->window();
            if (!modal_window) throw std::runtime_error("E_MODAL_WINDOW: stack failed to retain its Window");
            auto *panel = memnew(Panel);
            panel->set_mouse_filter(Control::MOUSE_FILTER_IGNORE);
            control = panel;
          } else if (next.componentName == std::string(rn::AppleSwitchComponentName)) {
            auto *toggle = memnew(GodotSwitch);
            toggle->connect("toggled", core_control_signal(surface_id, next.tag, mount_id, CoreControlSignal::Toggle));
            control = toggle;
          } else if (next.componentName == std::string(rn::ActivityIndicatorViewComponentName)) {
            control = memnew(GodotActivityIndicator);
          } else if (next.componentName == std::string(rn::ImageComponentName)) {
            auto *picture = memnew(GodotImage);
            picture->bind(image_emitter(surface_id, next.tag, mount_id));
            control = picture;
          } else if (kind == "scroll") control = memnew(Control);
          else if (kind == "paragraph") control = memnew(GodotParagraph);
          else if (kind == "text") control = memnew(Label);
          else if (kind == "button") {
            auto *button = memnew(Button);
            button->connect("pressed", core_control_signal(surface_id, next.tag, mount_id, CoreControlSignal::Activate));
            control = button;
          } else if (kind == "input") {
            auto *input = memnew(LineEdit);
            input->connect("text_changed", core_control_signal(surface_id, next.tag, mount_id, CoreControlSignal::Change));
            control = input;
          } else if (kind == "svg") {
            control = memnew(GodotSvgNode);
          } else if (kind == "view") {
            auto *view = memnew(GodotAccessibleView);
            view->connect("accessibility_tap", core_control_signal(surface_id, next.tag, mount_id, CoreControlSignal::AccessibilityTap));
            control = view;
            control->set_mouse_filter(Control::MOUSE_FILTER_IGNORE);
          } else throw std::runtime_error("Unsupported GodotControl kind: " + kind);
          native_tags.emplace(control, next.tag);
          auto entry = views.emplace(next.tag, Mounted{control, {}, surface_id, false, {}, {}, std::move(external), mount_id}).first;
          entry->second.modal = std::move(modal);
          if (!entry->second.external) {
          if (kind == "scroll")
            entry->second.scroll = std::make_unique<fabric_godot::ScrollAdapter>(*control);
          if (auto *input = Object::cast_to<LineEdit>(control)) {
            entry->second.input = std::make_unique<fabric_godot::InputAdapter>(*input,
                [this, tag = next.tag](const std::string &name, folly::dynamic payload) { emit(tag, name, std::move(payload)); });
            input->connect("focus_entered", core_control_signal(surface_id, next.tag, mount_id, CoreControlSignal::FocusEntered));
            input->connect("focus_exited", core_control_signal(surface_id, next.tag, mount_id, CoreControlSignal::FocusExited));
            input->connect("text_submitted", core_control_signal(surface_id, next.tag, mount_id, CoreControlSignal::Submit));
            input->connect("gui_input", core_control_signal(surface_id, next.tag, mount_id, CoreControlSignal::Key));
          }
          if (modal_window)
            modal_window->connect("window_input", core_control_signal(
                surface_id, next.tag, mount_id, CoreControlSignal::ModalWindowInput));
          }
          ++surface.creates;
          apply(next);
          break;
        }
        case rn::ShadowViewMutation::Insert: {
          auto *control = views.at(next.tag).control;
          auto mount_point = parent(mutation.parentTag, next.tag);
          const auto physical_index = insert_logical_child(
              mutation.parentTag, next.tag, mutation.index, mount_point.node);
          if (control->get_parent() != mount_point.node)
            mount_point.node->add_child(control);
          if (surface.stopping || inactive()) break;
          mount_point.node->move_child(control, mount_point.index < 0 ? physical_index : mount_point.index);
          apply(next);
          break;
        }
        case rn::ShadowViewMutation::Remove:
          remove_logical_child(mutation.parentTag, old.tag);
          // A same-parent keyed move is a reorder, not a native detachment.
          // Detaching a focused LineEdit cancels its editing/IME session.
          if (!inserted_parents.contains(old.tag) || inserted_parents.at(old.tag) != mutation.parentTag) {
            auto *control = views.at(old.tag).control;
            // A native Create can reject props before Insert. Upstream's error
            // recovery still retires that node, but it was never attached.
            if (control->get_parent()) {
              ChildRemovalScope removal(surface.child_removal_depth);
              parent(mutation.parentTag, old.tag).node->remove_child(control);
            }
          }
          break;
        case rn::ShadowViewMutation::Delete: {
          auto entry = views.extract(old.tag);
      if (entry.mapped().scroll) entry.mapped().scroll->cancel();
          forget_logical_tag(old.tag);
          native_tags.erase(entry.mapped().control);
          if (entry.mapped().external) { entry.mapped().external->dispose(); entry.mapped().external.reset(); }
          auto modal = entry.mapped().modal;
          if (entry.mapped().control->get_parent())
            entry.mapped().control->get_parent()->remove_child(entry.mapped().control);
          memdelete(entry.mapped().control);
          destroy_modal(std::move(modal));
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
      if (roots.at(mounted.surface_id)->stopping) continue;
      if (!mounted.frame_pending || !mounted.control->is_inside_tree()) continue;
      if (auto *label = Object::cast_to<Label>(mounted.control)) label->update_minimum_size();
      apply_frame(mounted);
      mounted.frame_pending = false;
    }
    for (auto &[tag, mounted] : views) {
      if (roots.at(mounted.surface_id)->stopping || !mounted.scroll) continue;
      const auto children = logical_children.find(tag);
      if (children != logical_children.end() && !children->second.empty()) {
        const auto content = views.find(children->second.front());
        if (content != views.end() && content->second.surface_id == mounted.surface_id) {
          mounted.scroll->set_content_frame(*content->second.control,
              {content->second.shadow.layoutMetrics.frame.origin.x,
               content->second.shadow.layoutMetrics.frame.origin.y});
        }
      } else mounted.scroll->clear_content();
      mounted.scroll->layout();
    }
    present_modals(surface_id);
    apply_pointer_filters();
    for (auto &[tag, mounted] : views) {
      if (roots.at(mounted.surface_id)->stopping) continue;
      if (auto *svg = Object::cast_to<GodotSvgNode>(mounted.control); svg && svg->is_inside_tree()) {
        // A paint failure must remain visible without skipping other surfaces
        // or the bookkeeping which finalizes this Fabric mount transaction.
        try { svg->refresh(text_layout->font()); }
        catch (const std::exception &error) { fail(error.what()); }
      }
    }
    if (focus_id) {
      for (auto &[tag, mounted] : views)
        if (!roots.at(mounted.surface_id)->stopping && mounted.control->get_instance_id() == focus_id && mounted.control->is_inside_tree())
          mounted.control->grab_focus();
    }
    retiring.clear();
    if (!surface.stopping && !inactive()) {
      ui->reportMount(surface_id);
      ++surface.mount_reports;
    }
  }
  // Fabric creates speculative shadow nodes. Native objects are allocated only
  // from committed Create mutations, never from this callback.
  void uiManagerDidCreateShadowNode(const rn::ShadowNode &) override {}
  void uiManagerDidDispatchCommand(const std::shared_ptr<const rn::ShadowNode> &node,
      const std::string &name, const folly::dynamic &args) override {
    ExecutionScope execution(*this);
    auto found = views.find(node->getTag());
    // Ref commands queued before a removal must not target another instance.
    if (found == views.end() || stopped || stopping || stop_requested || retiring.contains(node->getTag()) ||
        found->second.surface_id != node->getSurfaceId() || roots.at(found->second.surface_id)->stopping ||
        found->second.shadow.componentHandle != node->getComponentHandle() ||
        found->second.shadow.eventEmitter != node->getEventEmitter()) return;
    if (found->second.external) {
      if (!found->second.external->command(name, args)) fail("Unsupported adapter command: " + name);
      return;
    }
    if ((name == "focus" || name == "blur") && found->second.input) {
      if (!args.isArray() || !args.empty()) {
        fail(name + " requires an empty argument array");
        return;
      }
      auto *input = Object::cast_to<LineEdit>(found->second.control);
      if (!input || !input->is_inside_tree()) return;
      if (name == "focus") {
        if (input->is_editable()) input->grab_focus();
      } else {
        input->release_focus();
      }
      // Godot signals can request unmount/stop. ExecutionScope defers retiring
      // objects; do not reuse the views iterator after invoking the Control.
      return;
    }
    if (auto *scroll = found->second.scroll.get()) {
      if (scroll->command(name, args)) return;
    }
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
    if (auto *toggle = Object::cast_to<GodotSwitch>(found->second.control); toggle && name == "setValue") {
      // RCTSwitchHandleCommand: exactly one boolean; never emits onChange.
      if (!args.isArray() || args.size() != 1 || !args[0].isBool()) {
        fail("setValue requires [boolean]");
        return;
      }
      toggle->set_value(args[0].asBool());
      return;
    }
    fail("Unsupported native command: " + name);
  }
  void uiManagerDidSendAccessibilityEvent(const std::shared_ptr<const rn::ShadowNode> &, const std::string &type) override {
    // iOS acts on focus alone (RCTMountingManager.mm:342-348) and ignores the other types; the host counts those.
    // Focus is refused out loud, with the reason.
    if (!accessibility_info) { fail("Accessibility adapter is not implemented"); return; }
    if (accessibility_info->ui_event(type) == fabric_godot::accessibility::UiEvent::Unsupported) fail(fabric_godot::accessibility::focus_refusal);
  }
  void uiManagerDidSetIsJSResponder(const std::shared_ptr<const rn::ShadowNode> &node, bool active, bool block) override {
    auto root = roots.find(node->getSurfaceId());
    if (root != roots.end() && (!active || (!root->second->stopping && views.contains(node->getTag()))))
      root->second->pointer->responder(node->getTag(), active, block);
  }
  // RCTMountingManager's synchronouslyUpdateViewOnUIThread: the mounted props
  // cloned with the animated ones and applied to the Control, without a commit.
  // The backend's commit hook carries the same values into React's commits.
  void uiManagerShouldSynchronouslyUpdateViewOnUIThread(rn::Tag tag, const folly::dynamic &props) override {
    ExecutionScope execution(*this);
    auto found = views.find(tag);
    if (inactive() || found == views.end() || retiring.contains(tag) || roots.at(found->second.surface_id)->stopping) {
      if (native_animated) native_animated->update_dropped();
      return;
    }
    auto &mounted = found->second;
    try {
      const auto &descriptor = descriptors->at(mounted.shadow.componentHandle);
      rn::PropsParserContext parser{mounted.surface_id, *context};
      auto shadow = mounted.shadow;
      shadow.props = descriptor.cloneProps(parser, mounted.shadow.props, rn::RawProps(props));
      apply(shadow);
      if (native_animated) native_animated->update_applied();
    } catch (const std::exception &error) { fail(error.what()); }
  }
  // Only RN's legacy Animated path (no shared backend) reports here, and iOS
  // (RCTScheduler.mm) and Android (FabricUIManagerBinding.cpp) both ignore it.
  void uiManagerDidUpdateShadowTree(const std::unordered_map<rn::Tag, folly::dynamic> &) override {}
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

  // The performance section of status(): exact counters of the native tree, Hermes' heap and the
  // durations the host measured, each with the samples its percentiles come from.
  static folly::dynamic durations_snapshot(const fabric_godot::DurationSeries &durations, bool samples) {
    folly::dynamic result = folly::dynamic::object("count", static_cast<int64_t>(durations.count()))
        ("rejected", static_cast<int64_t>(durations.rejected()))("totalMs", durations.total_ms())
        ("maxMs", durations.max_ms())("p50Ms", durations.percentile(50))("p95Ms", durations.percentile(95))
        ("p99Ms", durations.percentile(99));
    if (samples) {
      auto window = folly::dynamic::array();
      for (double ms : durations.window()) {
        window.push_back(ms);
      }
      result["windowMs"] = std::move(window);
    }
    return result;
  }
  // Hermes' heap as the section reports it. A reading is not idempotent: each getHeapInfo call adds 40 bytes to the
  // live heap (measured), and a stopped runtime has one state, which a game may read as often as it likes. So the
  // runtime reads the heap once more as it stops, and reports that reading ever after, without reading anything afresh.
  folly::dynamic hermes_snapshot() {
    if (final_hermes) {
      return *final_hermes;
    }
    bool collected = false;
    if (collect_garbage_on_status && collect_garbage_on_status()) {
      runtime->instrumentation().collectGarbage("godot-fabric performance status");
      collected = true;
    }
    const auto info = runtime->instrumentation().getHeapInfo(false);
    folly::dynamic heap = folly::dynamic::object();
    for (const auto &entry : std::map<std::string, int64_t>(info.begin(), info.end())) {
      heap[entry.first] = entry.second;
    }
    return folly::dynamic::object("source", "jsi::Instrumentation::getHeapInfo")
        ("collectedBeforeReading", collected)("heap", std::move(heap));
  }
  folly::dynamic performance_snapshot() {
    const auto &retired = performance.retired();
    int64_t commits = static_cast<int64_t>(retired.commits), creates = static_cast<int64_t>(retired.creates),
        deletes = static_cast<int64_t>(retired.deletes), updates = static_cast<int64_t>(retired.updates);
    for (const auto &[id, root] : roots) {
      commits += root->commits;
      creates += root->creates;
      deletes += root->deletes;
      updates += root->updates;
    }
    const bool samples = performance_samples && performance_samples();
    folly::dynamic phases = folly::dynamic::object();
    for (size_t index = 0; index < fabric_godot::phase_count; ++index) {
      const auto phase = static_cast<fabric_godot::Phase>(index);
      phases[fabric_godot::phase_name(phase)] = durations_snapshot(performance.phase(phase), samples);
    }
    return folly::dynamic::object
        ("counters", folly::dynamic::object("commits", commits)("creates", creates)("deletes", deletes)
            ("updates", updates)("nativeViews", static_cast<int64_t>(views.size()))
            ("liveRoots", static_cast<int64_t>(roots.size()))("retiredRoots", static_cast<int64_t>(retired.roots)))
        ("hermes", hermes_snapshot())
        ("pump", durations_snapshot(performance.pump(), samples))("phases", std::move(phases))
        ("surfaces", folly::dynamic::object("start", durations_snapshot(performance.surface_start(), samples))
            ("retire", durations_snapshot(performance.surface_retire(), samples)))
        ("windowSize", static_cast<int64_t>(fabric_godot::DurationSeries::window_size));
  }
  folly::dynamic status() {
    folly::dynamic result = folly::dynamic::object("runtimeId", static_cast<int64_t>(runtime_id))
        ("rootCount", roots.size())("bundleEvaluations", bundle_evaluations)("stopped", stopped)
        ("modalRuntimeMembers", modal_stack.is_valid() ? modal_stack->runtime_count() : 0)
        ("pendingTimers", timer_registry->size())("pendingWork", work.size())
        ("pointerListenerQueryInstalled", pointer_listener_query.has_value())
        ("pointerListenerQuerySuppressed", static_cast<int64_t>(suppressed_sample_query_failures))
        ("timerEngine", "react-native/TimerManager")("windowListener", window_listener.has_value())
        ("pendingAnimationFrames", frame_callbacks.size())("animationFramesRun", frame_callbacks_run)
        ("textMeasurements", text_layout->measurements() + paragraph_layout->measurements())
        ("textLineMeasurements", paragraph_layout->line_measurements())
        ("viewportUpdates", viewport_updates)("errors", folly::dynamic::array());
    const auto counts = pointer_processor().pointerStateCountsForGodot();
    result["pointerProcessor"] = folly::dynamic::object("active", counts[0])
        ("pendingCapture", counts[1])("activeCapture", counts[2])("hover", counts[3]);
    int active_pointers = 0, hover_pointers = 0, suppressed_pointers = 0;
    for (const auto &[key, route] : pointer_routes) {
      if (route.suppressed) { ++suppressed_pointers; continue; }
      if (route.active) ++active_pointers;
      else if (route.mouse) ++hover_pointers;
    }
    result["pointerRouting"] = folly::dynamic::object("contacts", active_pointers + hover_pointers)
        ("active", active_pointers)("hoverPointers", hover_pointers)("nextId", next_pointer_id)
        ("stored", pointer_routes.size())("suppressed", suppressed_pointers);
    result["nativeModules"] = native_modules->snapshot();
    result["networking"] = networking->snapshot();
    result["images"] = images->snapshot();
    result["imageEffects"] = fabric_godot::PictureLayer::counters();
    result["deviceServices"] = device_services ? device_services->snapshot() : folly::dynamic::object("installed", false);
    result["accessibilityInfo"] = accessibility_info ? accessibility_info->snapshot() : folly::dynamic::object("installed", false);
    result["nativeAnimated"] = native_animated ? native_animated->snapshot() : folly::dynamic::object("enabled", false);
    result["gameServices"] = game_services->snapshot();
    result["adapters"] = adapters ? adapters->snapshot() : folly::dynamic::object("selected", false);
    const auto clock = frame_clock.state();
    result["frameClock"] = folly::dynamic::object("periodMs", clock.period_ms)("refreshRate", clock.refresh_rate)
        ("rateSource", clock.display_rate ? "display" : "fallback")
        ("pacing", clock.pacing == fabric_godot::FrameClock::Pacing::Presentation ? "presentation" : "time")
        ("pacingSource", pacing_source)("frames", static_cast<int64_t>(clock.frames))
        ("ticks", static_cast<int64_t>(clock.ticks))("skippedFrames", static_cast<int64_t>(clock.skipped))
        ("lastFrameMs", clock.last_frame_ms)("lastTickMs", clock.last_tick_ms);
    result["performance"] = performance_snapshot();
    result["hostPhasePending"] = host_phase_pending;
    result["stopRequested"] = stop_requested;
    result["pendingRootRetirements"] = pending_retirements.size();
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
    result["surfaceGeneration"] = id;
    result["hostInstanceId"] = static_cast<int64_t>(root.host_id);
    result["unmountRequested"] = root.stopping && !root.stopped;
    result["state"] = root.stopped ? "unmounted" : root.stopping ? "retiring" : root.commits ? "mounted" : "mounting";
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
      const auto native_props = mounted.shadow.componentName == std::string(fabric_godot::ControlName)
          ? std::static_pointer_cast<const ControlProps>(mounted.shadow.props) : nullptr;
      folly::dynamic node = folly::dynamic::object("tag", tag)("id", static_cast<int64_t>(control->get_instance_id()))
          ("testID", props->testId)("kind", kind)("text", native_props ? native_props->text : "")
          ("width", control->get_size().x)("height", control->get_size().y)
          ("fabricWidth", mounted.shadow.layoutMetrics.frame.size.width)
          ("fabricHeight", mounted.shadow.layoutMetrics.frame.size.height)
          ("x", control->get_position().x)("y", control->get_position().y)
          ("fabricX", mounted.shadow.layoutMetrics.frame.origin.x)
          ("fabricY", mounted.shadow.layoutMetrics.frame.origin.y)
          ("focused", control->has_focus())("visible", control->is_visible())("opacity", control->get_modulate().a);
      if (mounted.modal) {
        if (auto *window = mounted.modal->window())
          node["modalWindow"] = folly::dynamic::object
              ("id", static_cast<int64_t>(window->get_instance_id()))
              ("parentId", static_cast<int64_t>(window->get_parent()->get_instance_id()))
              ("width", window->get_size().x)("height", window->get_size().y)
              ("visible", window->is_visible())("embedded", window->is_embedded())
              ("exclusive", window->is_exclusive());
      }
      if (mounted.external) { node["adapter"] = mounted.external->snapshot(); node["mountId"] = static_cast<int64_t>(mounted.mount_id); }
      if (mounted.scroll) node["scroll"] = mounted.scroll->snapshot();
      if (kind == "view" || kind == "text" || kind == "paragraph" || kind == "button" || kind == "input" ||
          kind == "switch" || kind == "activity" || kind == "image")
        node["appearance"] = fabric_godot::appearance_snapshot(*control);
      if (auto *toggle = Object::cast_to<GodotSwitch>(control)) node["switch"] = toggle->snapshot();
      if (auto *indicator = Object::cast_to<GodotActivityIndicator>(control)) node["activity"] = indicator->snapshot();
      if (auto *picture = Object::cast_to<GodotImage>(control)) node["image"] = picture->snapshot();
      if (auto *accessible = Object::cast_to<GodotAccessibleView>(control)) node["accessibility"] = accessible->snapshot();
      if (auto *paragraph = Object::cast_to<GodotParagraph>(control)) {
        auto measured = paragraph->snapshot();
        for (const auto &item : measured.items()) node[item.first] = item.second;
        if (!node["runs"].empty()) {
          const auto &run = node["runs"][0];
          node["fontSize"] = node["nativeFontSize"] = run["fontSize"];
          node["appearance"]["textColor"] = run["color"];
        }
      }
      if (auto *input = Object::cast_to<LineEdit>(control); input && mounted.input) {
        node["caret"] = input->get_caret_column();
        node["nativeText"] = utf8(input->get_text());
        node["input"] = mounted.input->snapshot();
        node["editable"] = input->is_editable();
        node["placeholder"] = utf8(input->get_placeholder());
      }
      if (auto *label = Object::cast_to<Label>(control); label && native_props) {
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
    const std::string &scenario, uint64_t runtime_id, std::shared_ptr<GameServiceRegistry> services,
    std::shared_ptr<AppLifecycle> lifecycle, std::shared_ptr<SystemAppearance> appearance,
    std::function<std::string()> trusted_authorities, std::function<double()> clock_offset_ms,
    std::shared_ptr<AdapterRegistry> adapters, std::shared_ptr<DeviceServices> device_services,
    std::shared_ptr<AccessibilityInfo> accessibility_info, std::function<bool()> collect_garbage_on_status,
    std::function<bool()> performance_samples)
    : impl(std::make_shared<Impl>(theme_source, std::move(window_metrics), scenario, runtime_id, std::move(services),
          lifecycle, appearance, std::move(trusted_authorities), std::move(clock_offset_ms), std::move(adapters),
          std::move(device_services), std::move(accessibility_info))) {
  impl->collect_garbage_on_status = std::move(collect_garbage_on_status);
  impl->performance_samples = std::move(performance_samples);
  impl->initialize_host_phase();
}
ApplicationRuntime::~ApplicationRuntime() { impl->stop(); }
void ApplicationRuntime::load_bundle(const std::string &source, const std::string &source_url) {
  auto guard = impl;
  guard->bundle_url = source_url;
  guard->evaluate(source);
  ++guard->bundle_evaluations;
}
void ApplicationRuntime::invoke_callable(const std::string &name, const std::string &method, const std::string &args_json) {
  auto guard = impl;
  Impl::ExecutionScope execution(*guard);
  guard->native_modules->invoke_callable(name, method, folly::parseJson(args_json));
}
int ApplicationRuntime::mount(FabricSurface &host, const std::string &component, const std::string &props_json) { auto guard = impl; return guard->mount(host, component, props_json); }
void ApplicationRuntime::update_props(int id, const std::string &props_json) { auto guard = impl; guard->update_props(id, props_json); }
void ApplicationRuntime::unmount(int id) { auto guard = impl; guard->unmount(id); }
void ApplicationRuntime::stop() { auto guard = impl; guard->stop(); }
bool ApplicationRuntime::is_stopped() const { return impl->inactive(); }
void ApplicationRuntime::pump(bool frame) { auto guard = impl; guard->pump(frame); }
std::string ApplicationRuntime::evaluate(const std::string &source) {
  auto guard = impl;
  try { return guard->evaluate(source).toString(*guard->runtime).utf8(*guard->runtime); }
  catch (const std::exception &error) { guard->fail(error.what()); return "null"; }
}
std::string ApplicationRuntime::snapshot(int id, const std::string &retired) { return impl->snapshot(id, retired); }
std::string ApplicationRuntime::status() { return folly::toJson(impl->status()); }
void ApplicationRuntime::report_error(const std::string &message) { impl->fail(message); }
bool ApplicationRuntime::input(int id, const Ref<InputEvent> &event) {
  auto guard = impl;
  Impl::ExecutionScope execution(*guard);
  auto found = guard->roots.find(id);
  if (found == guard->roots.end() || found->second->stopping || guard->inactive()) return false;
  auto &root = *found->second;
  auto source = guard->root_pointer_source(id);
  if (!source) return false;
  bool blocked = false;
  if (!guard->routed_input(id, root, event, *source, blocked)) return false;
  guard->pump();
  found = guard->roots.find(id);
  return blocked || (found != guard->roots.end() && found->second->pointer->blocks_native());
}
void ApplicationRuntime::cancel(int id) {
  auto guard = impl;
  Impl::ExecutionScope execution(*guard);
  auto found = guard->roots.find(id);
  if (found != guard->roots.end() && !found->second->stopping && !guard->inactive()) {
    found->second->pointer->cancel();
    guard->synchronize_pointer_routes();
    guard->pump();
  }
}
void ApplicationRuntime::activate(int id, int tag) {
  auto guard = impl;
  Impl::ExecutionScope execution(*guard);
  auto root = guard->roots.find(id);
  auto found = guard->views.find(tag);
  if (root == guard->roots.end() || root->second->stopping || guard->inactive() ||
      found == guard->views.end() || found->second.surface_id != id || found->second.external ||
      component_kind(found->second.shadow) != "button") return;
  ++root->second->events;
  std::static_pointer_cast<const ControlEventEmitter>(found->second.shadow.eventEmitter)->activate();
}
void ApplicationRuntime::change(int id, const String &text, int tag) {
  auto guard = impl;
  Impl::ExecutionScope execution(*guard);
  auto found = guard->views.find(tag);
  if (!guard->inactive() && guard->roots.contains(id) && !guard->roots.at(id)->stopping &&
      found != guard->views.end() && found->second.surface_id == id && found->second.input)
    found->second.input->changed(text);
}
void ApplicationRuntime::focus(int id, bool focused, int tag) {
  auto guard = impl;
  Impl::ExecutionScope execution(*guard);
  auto found = guard->views.find(tag);
  if (!guard->inactive() && guard->roots.contains(id) && !guard->roots.at(id)->stopping &&
      found != guard->views.end() && found->second.surface_id == id && found->second.input)
    found->second.input->focus(focused);
}
void ApplicationRuntime::submit(int id, int tag) {
  auto guard = impl;
  Impl::ExecutionScope execution(*guard);
  auto found = guard->views.find(tag);
  if (!guard->inactive() && guard->roots.contains(id) && !guard->roots.at(id)->stopping &&
      found != guard->views.end() && found->second.surface_id == id && found->second.input)
    found->second.input->submitted();
}
void ApplicationRuntime::key(int id, const Ref<InputEvent> &event, int tag) {
  auto guard = impl;
  Impl::ExecutionScope execution(*guard);
  auto found = guard->views.find(tag);
  if (!guard->inactive() && guard->roots.contains(id) && !guard->roots.at(id)->stopping &&
      found != guard->views.end() && found->second.surface_id == id && found->second.input)
    found->second.input->key(event);
}
}
