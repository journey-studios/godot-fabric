#pragma once
#include <folly/dynamic.h>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <functional>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

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

  // read returns the system theme now. join adds the application to the
  // shared system theme callback when observation starts and reports whether
  // DisplayServer holds that callback; leave removes it on release.
  SystemAppearance(std::function<System()> read, std::function<bool()> join, std::function<void()> leave)
      : read_(std::move(read)), join_(std::move(join)), leave_(std::move(leave)) {}
  ~SystemAppearance() { leave(); }
  SystemAppearance(const SystemAppearance &) = delete;
  SystemAppearance &operator=(const SystemAppearance &) = delete;

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
    if (join_) {
      callback_registered_ = join_();
      joined_ = true;
    }
    observer_ = std::move(observer);
    reported_ = scheme();
    ++observers_;
  }
  // Released with the module: the application leaves the shared callback, so
  // no later system change reaches it.
  void release() {
    observer_ = {};
    leave();
  }
  // A change delivered by the shared callback, which takes no arguments, so the
  // system is read again.
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
  std::function<bool()> join_;
  std::function<void()> leave_;
  System system_;
  std::string override_{"unspecified"};
  std::string reported_;
  Observer observer_;
  bool callback_registered_{}, joined_{};
  uint64_t observers_{}, listeners_{}, notifications_{}, overrides_{}, events_{}, unobserved_{};

  void leave() {
    if (!joined_) return;
    joined_ = false;
    if (leave_) leave_();
  }

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

// DisplayServer keeps one system theme callback for the whole process, and
// set_system_theme_change_callback replaces whatever it held. Every
// application therefore shares this owner: the first Appearance module that
// starts registers the owner's callback, once, and each change reaches every
// application whose module still observes. An application leaves when its
// module is released, so a stopped or freed application receives nothing and
// the others keep receiving. Members are instance IDs that deliver resolves
// again on every change, so a member freed without leaving is dropped instead
// of dereferenced. A game that registers its own system theme callback
// replaces this one for every application, and Fabric's replaces a game's
// registered before it: the last registration wins. Main thread only, like
// DisplayServer's callback and the modules' lifecycle.
class SystemThemeOwner {
 public:
  // register_callback hands DisplayServer the owner's callback and reports
  // whether it did. deliver forwards one change to an application and reports
  // whether that application still exists.
  SystemThemeOwner(std::function<bool()> register_callback, std::function<bool(uint64_t)> deliver)
      : register_(std::move(register_callback)), deliver_(std::move(deliver)) {}
  // Reports whether DisplayServer holds the owner's callback.
  bool join(uint64_t application) {
    if (!member(application)) members_.push_back(application);
    if (!registered_ && register_ && register_()) {
      registered_ = true;
      ++registrations_;
    }
    return registered_;
  }
  void leave(uint64_t application) {
    members_.erase(std::remove(members_.begin(), members_.end(), application), members_.end());
  }
  // The registered callback; DisplayServer calls it without arguments.
  void changed() {
    ++dispatches_;
    // A delivery may make members leave: walk a copy and skip any that left.
    const auto members = members_;
    for (const auto application : members) {
      if (!member(application)) continue;
      if (deliver_(application)) ++deliveries_;
      else leave(application);
    }
  }
  folly::dynamic snapshot() const {
    // Instance IDs are strings: JSON numbers lose 64-bit precision.
    folly::dynamic members = folly::dynamic::array;
    for (const auto application : members_) members.push_back(std::to_string(application));
    return folly::dynamic::object("registered", registered_)("registrations", registrations_)
        ("members", members)("dispatches", dispatches_)("deliveries", deliveries_);
  }

 private:
  std::function<bool()> register_;
  std::function<bool(uint64_t)> deliver_;
  std::vector<uint64_t> members_;
  bool registered_{};
  uint64_t registrations_{}, dispatches_{}, deliveries_{};

  bool member(uint64_t application) const {
    return std::find(members_.begin(), members_.end(), application) != members_.end();
  }
};
}
