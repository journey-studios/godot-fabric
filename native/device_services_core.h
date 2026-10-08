#pragma once

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

// The pure core of the device services: URL rules, launch arguments, the
// backend seam and the counters. It needs neither Godot nor React Native, so
// device_services_core_test exercises every rule without an engine.
namespace fabric_godot::device {

// RFC 3986 section 3.1: scheme = ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ),
// followed by ":". Godot's OS.shell_open assumes file:// for a string without a
// scheme, so only a string that spells a scheme and at least one character after
// its colon is an absolute URL here.
inline bool has_scheme(std::string_view url) {
  if (url.empty()) {
    return false;
  }
  const auto alpha = [](char c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'); };
  if (!alpha(url[0])) {
    return false;
  }
  for (std::size_t index = 1; index < url.size(); ++index) {
    const char c = url[index];
    if (c == ':') {
      return index + 1 < url.size();
    }
    if (!alpha(c) && !(c >= '0' && c <= '9') && c != '+' && c != '-' && c != '.') {
      return false;
    }
  }
  return false;
}

// The URL of one command-line argument of the form --uri=<url>. macOS
// LaunchServices passes the URL that opened the application this way, and a
// shell may leave one pair of quotes around it. Only a value with a valid scheme
// counts; anything else is not a launch URL.
inline std::optional<std::string> uri_argument(std::string_view argument) {
  constexpr std::string_view prefix = "--uri=";
  if (argument.substr(0, prefix.size()) != prefix) {
    return std::nullopt;
  }
  std::string_view value = argument.substr(prefix.size());
  if (value.size() >= 2 && (value.front() == '"' || value.front() == '\'') && value.back() == value.front()) {
    value = value.substr(1, value.size() - 2);
  }
  if (!has_scheme(value)) {
    return std::nullopt;
  }
  return std::string(value);
}

// The first valid --uri=<url> of the user arguments (after "--"), and failing
// that of the engine's own arguments.
inline std::optional<std::string> launch_url(const std::vector<std::string> &user_arguments,
    const std::vector<std::string> &arguments) {
  for (const auto *list : {&user_arguments, &arguments}) {
    for (const auto &argument : *list) {
      if (auto url = uri_argument(argument)) {
        return url;
      }
    }
  }
  return std::nullopt;
}

// What the platform provides. The default is Godot's; validation replaces
// any subset. open_url returns false when the platform refused to open it.
struct Backend {
  std::function<bool(const std::string &)> open_url;
  std::function<bool()> clipboard_available;
  std::function<std::string()> clipboard_get;
  std::function<void(const std::string &)> clipboard_set;
  std::function<void(double)> vibrate;
  std::function<void()> cancel_vibration;
};

enum class OpenResult { Opened, InvalidURL, Refused };

struct Counters {
  std::size_t can_open{}, opened{}, open_invalid{}, open_refused{}, settings_refused{}, initial_url_reads{};
  std::size_t urls_accepted{}, urls_rejected{}, urls_observed{}, urls_unobserved{};
  std::size_t clipboard_reads{}, clipboard_writes{}, clipboard_unavailable{};
  std::size_t vibrations{}, vibrations_refused{}, patterns_refused{}, cancels{};
};

// One application's device state. Every method runs on the application's main
// thread. After stop() the backend is never called again.
class Services {
 public:
  Services(Backend backend, std::optional<std::string> initial_url)
      : backend_(std::move(backend)), initial_url_(std::move(initial_url)) {}

  bool active() const { return active_; }
  void stop() { active_ = false; }
  const Counters &counters() const { return counters_; }

  // Linking. The launch URL is fixed for the life of the application.
  const std::optional<std::string> &launch_url() const { return initial_url_; }
  const std::optional<std::string> &initial_url() {
    ++counters_.initial_url_reads;
    return initial_url_;
  }
  // Godot has no query for installed handlers, so every absolute URL is
  // openable and anything else is not.
  bool can_open_url(std::string_view url) {
    ++counters_.can_open;
    return has_scheme(url);
  }
  OpenResult open_url(const std::string &url) {
    if (!has_scheme(url)) {
      ++counters_.open_invalid;
      return OpenResult::InvalidURL;
    }
    if (!active_ || !backend_.open_url || !backend_.open_url(url)) {
      ++counters_.open_refused;
      return OpenResult::Refused;
    }
    ++counters_.opened;
    return OpenResult::Opened;
  }
  void note_settings_refused() { ++counters_.settings_refused; }
  // A URL the platform delivers to a running application (Linking's "url"
  // event). Only a valid URL reaches an application that has not stopped.
  bool accept_url(std::string_view url) {
    if (!active_ || !has_scheme(url)) {
      ++counters_.urls_rejected;
      return false;
    }
    ++counters_.urls_accepted;
    return true;
  }
  // Whether the event found a LinkingManager module to carry it to JS.
  void note_url_emitted(bool observed) { ++(observed ? counters_.urls_observed : counters_.urls_unobserved); }

  // Clipboard. An unavailable clipboard is reported, never faked.
  bool clipboard_available() const {
    return active_ && backend_.clipboard_available && backend_.clipboard_available();
  }
  std::optional<std::string> clipboard_get() {
    if (!clipboard_available() || !backend_.clipboard_get) {
      ++counters_.clipboard_unavailable;
      return std::nullopt;
    }
    ++counters_.clipboard_reads;
    return backend_.clipboard_get();
  }
  bool clipboard_set(const std::string &text) {
    if (!clipboard_available() || !backend_.clipboard_set) {
      ++counters_.clipboard_unavailable;
      return false;
    }
    ++counters_.clipboard_writes;
    backend_.clipboard_set(text);
    return true;
  }

  // Vibration. A duration is a finite, non-negative number of milliseconds.
  bool vibrate(double milliseconds) {
    if (!std::isfinite(milliseconds) || milliseconds < 0) {
      ++counters_.vibrations_refused;
      return false;
    }
    ++counters_.vibrations;
    if (active_ && backend_.vibrate) {
      backend_.vibrate(milliseconds);
    }
    return true;
  }
  void note_pattern_refused() { ++counters_.patterns_refused; }
  void cancel_vibration() {
    ++counters_.cancels;
    if (active_ && backend_.cancel_vibration) {
      backend_.cancel_vibration();
    }
  }

 private:
  Backend backend_;
  std::optional<std::string> initial_url_;
  bool active_{true};
  Counters counters_;
};

}  // namespace fabric_godot::device
