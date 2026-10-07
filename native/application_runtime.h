#pragma once
#include "frame_clock.h"
#include <godot_cpp/classes/input_event.hpp>
#include <godot_cpp/variant/vector2.hpp>
#include <functional>
#include <memory>
#include <string>
#include <cstdint>

class FabricSurface;
namespace fabric_godot {
class AppLifecycle;
class GameServiceRegistry;
class AdapterRegistry;
class SystemAppearance;
struct WindowMetrics {
  godot::Vector2 size;
  godot::Vector2 screen;
  double scale{1};
  uint64_t window_instance_id{};
  // The refresh rate in Hz that the display reports for the screen showing the
  // window; not positive when it reports none (the headless DisplayServer has no
  // screens). It sets the period of the application's frame clock.
  double refresh_rate{};
  // How the window's frames reach the screen, which decides what a tick of the
  // frame clock is, and why the host believes so (a literal: "vsync", "unpaced",
  // "headless", "validation" or "unknown").
  FrameClock::Pacing pacing{FrameClock::Pacing::Time};
  const char *pacing_source{"unknown"};
};
class ApplicationRuntime {
 public:
  ApplicationRuntime(FabricSurface &theme_source, std::function<WindowMetrics()> window_metrics,
      const std::string &scenario, uint64_t runtime_id, std::shared_ptr<GameServiceRegistry> game_services,
      std::shared_ptr<AppLifecycle> lifecycle, std::shared_ptr<SystemAppearance> appearance,
      std::function<std::string()> trusted_authorities, std::function<double()> clock_offset_ms,
      std::shared_ptr<AdapterRegistry> adapters = {});
  ~ApplicationRuntime();
  void load_bundle(const std::string &source, const std::string &source_url);
  void invoke_callable(const std::string &name, const std::string &method, const std::string &args_json);
  int mount(FabricSurface &host, const std::string &component, const std::string &props_json);
  void update_props(int surface_id, const std::string &props_json);
  void unmount(int surface_id);
  void stop();
  bool is_stopped() const;
  void pump(bool frame = false);
  std::string evaluate(const std::string &source);
  std::string snapshot(int surface_id, const std::string &retired = "{}");
  std::string status();
  void report_error(const std::string &message);
  bool input(int surface_id, const godot::Ref<godot::InputEvent> &event);
  void cancel(int surface_id);
  void activate(int surface_id, int tag);
  void change(int surface_id, const godot::String &text, int tag);
  void focus(int surface_id, bool focused, int tag);
  void submit(int surface_id, int tag);
  void key(int surface_id, const godot::Ref<godot::InputEvent> &event, int tag);
 private:
  struct Impl;
  std::shared_ptr<Impl> impl;
};
}
