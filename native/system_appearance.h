#pragma once
#include <folly/dynamic.h>
#include <cmath>
#include <cstdint>
#include <functional>
#include <stdexcept>
#include <string>
#include <utility>

namespace fabric_godot {
// The color scheme React Native's Appearance reports for one FabricApplication,
// shared by every root of its runtime. The system part comes from Godot's
// DisplayServer; the override is the application's setColorScheme(). All calls
// run on Godot's main thread.
class SystemAppearance {
 public:
  struct System {
    bool supported{};
    bool dark{};
  };
  using Observer = std::function<void(const std::string &scheme)>;

  // read returns the system theme now. watch registers the system theme
  // callback and reports whether it did; it runs when observation starts.
  SystemAppearance(std::function<System()> read, std::function<bool()> watch)
      : read_(std::move(read)), watch_(std::move(watch)) {}

  // An explicit override wins. Without one, RCTAppearance and Android's
  // AppearanceModule report light whenever the system style is not dark,
  // including when the system has no dark style at all.
  std::string scheme() const {
    if (override_ == "light" || override_ == "dark") return override_;
    return system_.supported && system_.dark ? "dark" : "light";
  }
  // Called when the Appearance module is created, like RCTAppearance's init:
  // the scheme it reports then is the baseline for later changes.
  void observe(Observer observer) {
    system_ = read_();
    callback_registered_ = callback_registered_ || (watch_ && watch_());
    observer_ = std::move(observer);
    reported_ = scheme();
    ++observers_;
  }
  void release() { observer_ = {}; }
  // The DisplayServer callback takes no arguments, so the system is read again.
  void system_changed() {
    ++notifications_;
    system_ = read_();
    publish();
  }
  // iOS sets overrideUserInterfaceStyle and Android setDefaultNightMode; auto
  // and unspecified follow the system again on both.
  void set_override(const std::string &value) {
    if (value != "light" && value != "dark" && value != "auto" && value != "unspecified")
      throw std::invalid_argument("Appearance.setColorScheme expects light, dark, auto or unspecified");
    ++overrides_;
    override_ = value == "auto" ? "unspecified" : value;
    publish();
  }
  // RCTEventEmitter's listener count, kept for diagnostics only: RN's JS adds
  // its single native listener before anything can emit.
  void add_listener() { ++listeners_; }
  void remove_listeners(double count) {
    if (!std::isfinite(count) || count < 0 || std::floor(count) != count)
      throw std::invalid_argument("Appearance.removeListeners expects a nonnegative integer");
    // Compare before converting: a double beyond uint64_t has no defined cast.
    listeners_ = count >= static_cast<double>(listeners_) ? 0 : listeners_ - static_cast<uint64_t>(count);
  }
  folly::dynamic snapshot() const {
    return folly::dynamic::object("scheme", scheme())("override", override_)
        ("system", folly::dynamic::object("supported", system_.supported)("dark", system_.dark))
        ("observed", static_cast<bool>(observer_))("observers", observers_)("listeners", listeners_)
        ("callbackRegistered", callback_registered_)("notifications", notifications_)
        ("overrides", overrides_)("events", events_)("unobserved", unobserved_);
  }

 private:
  std::function<System()> read_;
  std::function<bool()> watch_;
  System system_;
  std::string override_{"unspecified"};
  std::string reported_;
  Observer observer_;
  bool callback_registered_{};
  uint64_t observers_{}, listeners_{}, notifications_{}, overrides_{}, events_{}, unobserved_{};

  // Both platforms send appearanceChanged only when the effective scheme
  // differs from the one they last reported.
  void publish() {
    const auto current = scheme();
    if (current == reported_) return;
    reported_ = current;
    if (!observer_) {
      ++unobserved_;
      return;
    }
    ++events_;
    observer_(current);
  }
};
}
