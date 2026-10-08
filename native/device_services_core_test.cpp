#include "device_services_core.h"
#include <cmath>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

using namespace fabric_godot::device;

namespace {
void require(bool condition, const char *message) {
  if (!condition) {
    throw std::runtime_error(message);
  }
}

struct Recorder {
  std::vector<std::string> calls;
  std::string clipboard;
  bool available{true};
  bool opens{true};
  Backend backend() {
    Backend result;
    result.open_url = [this](const std::string &url) {
      calls.push_back("open:" + url);
      return opens;
    };
    result.clipboard_available = [this] { return available; };
    result.clipboard_get = [this] {
      calls.push_back("get");
      return clipboard;
    };
    result.clipboard_set = [this](const std::string &text) {
      calls.push_back("set:" + text);
      clipboard = text;
    };
    result.vibrate = [this](double milliseconds) { calls.push_back("vibrate:" + std::to_string(static_cast<long>(milliseconds))); };
    result.cancel_vibration = [this] { calls.push_back("cancel"); };
    return result;
  }
};

void schemes_follow_rfc_3986() {
  for (const char *valid : {"https://example.com", "http://127.0.0.1:8080/a?b=1#c", "godotfabric://open/42", "mailto:a@b.c",
           "tel:+15555550100", "geo:37.48,-122.14", "a:b", "x-custom+scheme.v2:rest", "HTTPS://UPPER.CASE", "file:///tmp/x"}) {
    require(has_scheme(valid), valid);
  }
  for (const char *invalid : {"", "example.com", "example.com/path", "//example.com", "/tmp/file", "a:", "https:", ":nothing",
           "1http://x", "-x:y", "ht tp://x", "ht_tp://x", "caf\xC3\xA9://x", "no scheme:here", " https://x", "?q=a:b", "#frag:x"}) {
    require(!has_scheme(invalid), invalid);
  }
}

void launch_arguments_name_the_url() {
  require(uri_argument("--uri=godotfabric://open/1").value() == "godotfabric://open/1", "The value of --uri= is the URL");
  require(uri_argument("--uri=\"https://example.com/a b\"").value() == "https://example.com/a b", "One pair of double quotes is removed");
  require(uri_argument("--uri='mailto:a@b.c'").value() == "mailto:a@b.c", "One pair of single quotes is removed");
  require(uri_argument("--uri=\"\"https://x\"\"").value_or("") == "", "Only one pair of quotes is removed, what is left has no scheme");
  require(!uri_argument("--uri=\"https://x").has_value(), "An unbalanced quote leaves no scheme");
  require(!uri_argument("--uri=").has_value(), "An empty value is no URL");
  require(!uri_argument("--uri=plain").has_value(), "A value without a scheme is no URL");
  require(!uri_argument("--uri=a:").has_value(), "A scheme with nothing after the colon is no URL");
  require(!uri_argument("--uri https://x").has_value() && !uri_argument("--url=https://x").has_value() && !uri_argument("uri=https://x").has_value(),
      "Only the exact --uri= prefix names a launch URL");

  const std::vector<std::string> none;
  require(!launch_url(none, none).has_value(), "No arguments, no launch URL");
  require(!launch_url({"--verbose", "--uri=nonsense"}, {"--headless"}).has_value(), "Invalid values are skipped");
  require(launch_url({"--uri=nonsense", "--uri=app://second", "--uri=app://third"}, none).value() == "app://second",
      "The first valid --uri= wins and invalid ones are skipped");
  require(launch_url({"--uri=app://user"}, {"--uri=app://engine"}).value() == "app://user", "The user arguments come first");
  require(launch_url({"--flag"}, {"--path", "x", "--uri=app://engine"}).value() == "app://engine", "The engine arguments are the fallback");
}

void opening_checks_the_scheme_before_the_backend() {
  Recorder recorder;
  Services services(recorder.backend(), std::nullopt);
  require(services.open_url("https://example.com/a") == OpenResult::Opened, "A valid URL opens");
  require(recorder.calls == std::vector<std::string>{"open:https://example.com/a"}, "The backend saw the exact URL");
  require(services.open_url("example.com") == OpenResult::InvalidURL && services.open_url("") == OpenResult::InvalidURL, "A URL without a scheme is invalid");
  require(recorder.calls.size() == 1, "An invalid URL never reaches the backend");
  recorder.opens = false;
  require(services.open_url("https://refused.example") == OpenResult::Refused, "A backend that refuses refuses the URL");
  require(recorder.calls.size() == 2, "The refusing backend was asked once");
  require(services.can_open_url("tel:+1555") && !services.can_open_url("555-0100") && !services.can_open_url(""), "canOpenURL is the scheme rule");
  require(recorder.calls.size() == 2, "canOpenURL never calls the backend");
  const auto &counters = services.counters();
  require(counters.opened == 1 && counters.open_invalid == 2 && counters.open_refused == 1 && counters.can_open == 3, "The counters add up");

  Services launched(Backend{}, std::string("app://launch"));
  require(launched.initial_url() == std::optional<std::string>("app://launch") && launched.initial_url() == launched.initial_url(),
      "The initial URL is stable");
  require(!Services(Backend{}, std::nullopt).initial_url().has_value(), "No launch URL is null");
  require(launched.open_url("https://x.example") == OpenResult::Refused, "A backend without open_url refuses");
}

void delivered_urls_are_validated() {
  Recorder recorder;
  Services services(recorder.backend(), std::nullopt);
  require(services.accept_url("godotfabric://deep/link?x=1"), "A valid URL is accepted");
  require(!services.accept_url("no-scheme") && !services.accept_url(""), "A URL without a scheme is rejected");
  services.note_url_emitted(true);
  services.note_url_emitted(false);
  services.stop();
  require(!services.active() && !services.accept_url("godotfabric://after/stop"), "A stopped application accepts no URL");
  const auto &counters = services.counters();
  require(counters.urls_accepted == 1 && counters.urls_rejected == 3 && counters.urls_observed == 1 && counters.urls_unobserved == 1,
      "The counters add up");
}

void clipboard_is_unavailable_or_it_round_trips() {
  Recorder recorder;
  Services services(recorder.backend(), std::nullopt);
  require(services.clipboard_set("h\xC3\xA9llo \xE6\x97\xA5\xE6\x9C\xAC \xF0\x9F\x9A\x80\nline\r\n") && recorder.calls.size() == 1,
      "A write reaches the backend");
  require(services.clipboard_get().value() == "h\xC3\xA9llo \xE6\x97\xA5\xE6\x9C\xAC \xF0\x9F\x9A\x80\nline\r\n", "Multibyte text and line breaks round-trip");
  require(services.clipboard_set("") && services.clipboard_get().value().empty(), "The empty string is a value, not an absence");
  recorder.clipboard = "changed outside";
  require(services.clipboard_get().value() == "changed outside", "Every read asks the backend");
  recorder.available = false;
  const auto calls = recorder.calls.size();
  require(!services.clipboard_get().has_value() && !services.clipboard_set("x"), "An unavailable clipboard reports itself");
  require(recorder.calls.size() == calls, "An unavailable clipboard reaches no backend method");
  const auto &counters = services.counters();
  require(counters.clipboard_writes == 2 && counters.clipboard_reads == 3 && counters.clipboard_unavailable == 2, "The counters add up");
  Services bare(Backend{}, std::nullopt);
  require(!bare.clipboard_available() && !bare.clipboard_get().has_value(), "A backend without a clipboard has none");
}

void vibration_takes_finite_non_negative_durations() {
  Recorder recorder;
  Services services(recorder.backend(), std::nullopt);
  require(services.vibrate(400) && services.vibrate(0) && services.vibrate(250.6), "Finite durations vibrate");
  require(!services.vibrate(-1) && !services.vibrate(std::nan("")) && !services.vibrate(std::numeric_limits<double>::infinity()),
      "Negative, NaN and infinite durations are refused");
  require((recorder.calls == std::vector<std::string>{"vibrate:400", "vibrate:0", "vibrate:250"}), "Only the accepted durations reached the backend");
  services.cancel_vibration();
  services.note_pattern_refused();
  require(recorder.calls.back() == "cancel", "Cancel reaches the backend");
  const auto &counters = services.counters();
  require(counters.vibrations == 3 && counters.vibrations_refused == 3 && counters.cancels == 1 && counters.patterns_refused == 1, "The counters add up");
}

void a_stopped_service_calls_no_backend() {
  Recorder recorder;
  Services services(recorder.backend(), std::nullopt);
  services.stop();
  require(services.open_url("https://example.com") == OpenResult::Refused, "A stopped service opens nothing");
  require(!services.clipboard_get().has_value() && !services.clipboard_set("x"), "A stopped service has no clipboard");
  services.vibrate(10);
  services.cancel_vibration();
  require(recorder.calls.empty(), "A stopped service reached no backend method");
}
}  // namespace

int main() {
  schemes_follow_rfc_3986();
  launch_arguments_name_the_url();
  opening_checks_the_scheme_before_the_backend();
  delivered_urls_are_validated();
  clipboard_is_unavailable_or_it_round_trips();
  vibration_takes_finite_non_negative_durations();
  a_stopped_service_calls_no_backend();
  std::cout << "DEVICE_SERVICES_CORE_PASSED\n";
}
