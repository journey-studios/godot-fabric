#include "godot_http_transport.h"
#include "godot_tls.h"
#include <godot_cpp/classes/http_client.hpp>
#include <godot_cpp/variant/packed_byte_array.hpp>
#include <godot_cpp/variant/packed_string_array.hpp>
#include <algorithm>
#include <chrono>
#include <cstring>
#include <map>
#include <vector>

namespace fabric_godot {
namespace {
using godot::HTTPClient;
using godot::PackedByteArray;
using godot::PackedStringArray;
using godot::Ref;
using godot::String;

std::string utf8(const String &value) { return value.utf8().get_data(); }
String gd(const std::string &value) { return String::utf8(value.c_str(), static_cast<int64_t>(value.size())); }

std::optional<HTTPClient::Method> method_of(const std::string &name) {
  static const std::map<std::string, HTTPClient::Method> methods{
      {"GET", HTTPClient::METHOD_GET}, {"HEAD", HTTPClient::METHOD_HEAD}, {"POST", HTTPClient::METHOD_POST},
      {"PUT", HTTPClient::METHOD_PUT}, {"DELETE", HTTPClient::METHOD_DELETE}, {"OPTIONS", HTTPClient::METHOD_OPTIONS},
      {"TRACE", HTTPClient::METHOD_TRACE}, {"PATCH", HTTPClient::METHOD_PATCH}};
  const auto found = methods.find(name);
  return found == methods.end() ? std::nullopt : std::optional<HTTPClient::Method>(found->second);
}

// "Name: value" lines as HTTPClient keeps them, in wire order and with duplicates.
http::Headers parse_headers(const PackedStringArray &lines) {
  http::Headers headers;
  for (int64_t index = 0; index < lines.size(); ++index) {
    const std::string line = utf8(lines[index]);
    const auto colon = line.find(':');
    if (colon == std::string::npos || colon == 0) continue;
    headers.emplace_back(line.substr(0, colon), std::string(http::trim(std::string_view(line).substr(colon + 1))));
  }
  return headers;
}

class GodotHttpTransport final : public HttpTransport {
 public:
  GodotHttpTransport(TrustedAuthorities trusted_authorities, MonotonicClock now)
      : trusted_authorities_(std::move(trusted_authorities)),
        now_(now ? std::move(now) : MonotonicClock([] {
          return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count();
        })) {}
  ~GodotHttpTransport() override { stop(); }

  std::optional<std::string> start(uint64_t id, HttpRequest request, HttpListener listener) override {
    if (stopped_) return "E_RUNTIME_STOPPED: the application has stopped";
    if (exchanges_.contains(id)) return "E_REQUEST_DUPLICATE: request " + std::to_string(id) + " is already in flight";
    const auto method = method_of(request.method);
    if (!method) return "Unsupported HTTP method: " + request.method;
    std::string error;
    auto url = http::parse_url(request.url, &error);
    if (!url) return error;
    auto exchange = std::make_unique<Exchange>();
    exchange->id = id;
    exchange->method = *method;
    exchange->url = std::move(*url);
    exchange->deadline = request.timeout_ms > 0 ? now_() + request.timeout_ms : 0;
    exchange->request = std::move(request);
    exchange->listener = std::move(listener);
    if (auto failure = connect(*exchange)) return failure;
    ++started_;
    exchanges_.emplace(id, std::move(exchange));
    return std::nullopt;
  }

  void cancel(uint64_t id) override {
    const auto found = exchanges_.find(id);
    if (found == exchanges_.end()) return;
    found->second->client->close();
    exchanges_.erase(found);
    ++cancelled_;
  }

  void poll(std::size_t byte_budget) override {
    if (stopped_ || exchanges_.empty()) return;
    ++polls_;
    // Ids first: a listener may start or cancel requests, which reshapes the map.
    std::vector<uint64_t> ids;
    ids.reserve(exchanges_.size());
    for (const auto &entry : exchanges_) ids.push_back(entry.first);
    std::size_t budget = byte_budget;
    for (const auto id : ids) {
      const auto found = exchanges_.find(id);
      if (found != exchanges_.end()) advance(*found->second, budget);
    }
  }

  void stop() override {
    stopped_ = true;
    for (auto &entry : exchanges_)
      if (entry.second->client.is_valid()) entry.second->client->close();
    cancelled_ += exchanges_.size();
    exchanges_.clear();
  }

  folly::dynamic snapshot() const override {
    return folly::dynamic::object("transport", "godot-http-client")("stopped", stopped_)("active", exchanges_.size())
        ("started", started_)("completed", completed_)("failed", failed_)("timedOut", timed_out_)("cancelled", cancelled_)
        ("redirectsFollowed", redirected_)("responses", heads_)("bytesReceived", bytes_received_)("polls", polls_);
  }

 private:
  struct Exchange {
    uint64_t id{};
    HTTPClient::Method method{};
    HttpRequest request;
    http::Url url;
    HttpListener listener;
    double deadline{};
    Ref<HTTPClient> client;
    bool request_sent{}, head_handled{}, has_body{}, chunked{}, read_until_eof{};
    int64_t expected{-1}, received{};
    int redirects{};
  };
  enum class Head { Delivered, Redirected, Failed };

  TrustedAuthorities trusted_authorities_;
  MonotonicClock now_;
  std::map<uint64_t, std::unique_ptr<Exchange>> exchanges_;
  bool stopped_{};
  uint64_t started_{}, completed_{}, failed_{}, timed_out_{}, cancelled_{}, redirected_{}, heads_{}, bytes_received_{}, polls_{};

  static std::string endpoint(const Exchange &x) { return x.url.host + ":" + std::to_string(x.url.port); }

  // A new client and connection for the request's current URL: the first one,
  // and again for every redirect (connections are never reused or pooled).
  std::optional<std::string> connect(Exchange &x) {
    Ref<godot::TLSOptions> tls;
    if (x.url.tls()) {
      if (auto error = client_tls_options(trusted_authorities_ ? trusted_authorities_() : std::string(), tls)) return error;
    }
    x.client.instantiate();
    if (x.client->connect_to_host(gd(x.url.host), x.url.port, tls) != godot::OK) return "Failed to connect to " + endpoint(x);
    x.request_sent = x.head_handled = false;
    return std::nullopt;
  }

  std::optional<std::string> send(Exchange &x) {
    PackedStringArray lines;
    bool has_host = false;
    for (const auto &[name, value] : x.request.headers) {
      // The framing headers are the transport's: a stale one would corrupt the request.
      if (http::iequals(name, "content-length") || http::iequals(name, "transfer-encoding")) continue;
      has_host = has_host || http::iequals(name, "host");
      lines.push_back(gd(name + ": " + value));
    }
    // HTTPClient writes Host with an unbracketed IPv6 literal, so it is always given here.
    if (!has_host) lines.push_back(gd("Host: " + x.url.authority()));
    const auto &method = x.request.method;
    if (!x.request.body.empty() || method == "POST" || method == "PUT" || method == "PATCH")
      lines.push_back(gd("Content-Length: " + std::to_string(x.request.body.size())));
    PackedByteArray body;
    body.resize(static_cast<int64_t>(x.request.body.size()));
    if (!x.request.body.empty()) std::memcpy(body.ptrw(), x.request.body.data(), x.request.body.size());
    if (x.client->request_raw(x.method, gd(x.url.target), lines, body) != godot::OK)
      return "Failed to send the request to " + endpoint(x);
    x.request_sent = true;
    return std::nullopt;
  }

  Head settle_head(Exchange &x) {
    if (x.head_handled) return Head::Delivered;
    if (!x.client->has_response()) {
      fail(x, {"Connection closed by " + endpoint(x) + " before a response arrived"});
      return Head::Failed;
    }
    const int status = static_cast<int>(x.client->get_response_code());
    auto headers = parse_headers(x.client->get_response_headers());
    if (auto redirect = http::plan_redirect(x.request.method, status, x.url, x.request.headers, headers, x.request.drop_headers_on_redirect)) {
      // OkHttp allows 20 follow-ups and fails on the 21st.
      if (x.redirects >= http::max_redirects) {
        fail(x, {"Too many follow-up requests: " + std::to_string(x.redirects + 1)});
        return Head::Failed;
      }
      x.client->close();
      x.request.method = redirect->method;
      x.method = *method_of(redirect->method);
      x.request.headers = std::move(redirect->headers);
      if (!redirect->keep_body) x.request.body.clear();
      x.url = std::move(redirect->url);
      ++x.redirects;
      ++redirected_;
      if (auto error = connect(x)) {
        fail(x, {*error});
        return Head::Failed;
      }
      return Head::Redirected;
    }
    x.has_body = x.request.method != "HEAD" && status >= 200 && status != 204 && status != 304;
    if (x.has_body) {
      if (const auto *encoding = http::find_header(headers, "content-encoding")) {
        const auto value = http::lower(http::trim(*encoding));
        if (!value.empty() && value != "identity") {
          fail(x, {"Unsupported Content-Encoding \"" + value + "\": this host does not decode compressed responses"});
          return Head::Failed;
        }
      }
    }
    x.chunked = x.client->is_response_chunked();
    x.expected = x.has_body && !x.chunked ? x.client->get_response_body_length() : -1;
    x.received = 0;
    x.read_until_eof = x.has_body && !x.chunked && x.expected < 0;
    x.head_handled = true;
    ++heads_;
    x.listener.on_head({status, std::move(headers), x.url.to_string()});
    return Head::Delivered;
  }

  void read_body(Exchange &x, std::size_t &budget) {
    while (budget > 0 && x.client->get_status() == HTTPClient::STATUS_BODY) {
      const PackedByteArray chunk = x.client->read_response_body_chunk();
      // An empty read only means that nothing has arrived yet.
      if (chunk.is_empty()) break;
      const auto size = static_cast<std::size_t>(chunk.size());
      budget -= std::min(budget, size);
      bytes_received_ += size;
      x.received += static_cast<int64_t>(size);
      x.listener.on_body(std::string(reinterpret_cast<const char *>(chunk.ptr()), size));
    }
  }

  // Returns true once the exchange has ended and left the map.
  bool advance(Exchange &x, std::size_t &budget) {
    if (x.deadline > 0 && now_() >= x.deadline) return fail(x, {"The request timed out.", true});
    // One poll per pump. HTTPClient reads a connection the server has closed as a lost one as soon as it is polled
    // with nothing left to read, so a finished response must be taken before the next poll, never after.
    x.client->poll();
    for (int iteration = 0; iteration < 16; ++iteration) {
      switch (x.client->get_status()) {
        case HTTPClient::STATUS_RESOLVING:
        case HTTPClient::STATUS_CONNECTING:
        case HTTPClient::STATUS_REQUESTING:
          return false;
        case HTTPClient::STATUS_CANT_RESOLVE:
          return fail(x, {"Unable to resolve host \"" + x.url.host + "\""});
        case HTTPClient::STATUS_CANT_CONNECT:
          return fail(x, {"Failed to connect to " + endpoint(x)});
        case HTTPClient::STATUS_TLS_HANDSHAKE_ERROR:
          return fail(x, {"TLS handshake with " + endpoint(x) + " failed"});
        case HTTPClient::STATUS_CONNECTION_ERROR:
          // A body whose declared length arrived is complete however the connection ended.
          if (x.head_handled && x.expected >= 0 && x.received >= x.expected) return complete(x);
          return fail(x, {"Connection to " + endpoint(x) + " was lost " + (x.head_handled ? "while receiving the response" : "before a response arrived")});
        case HTTPClient::STATUS_DISCONNECTED:
          // Only a response without length or chunking ends by the server closing the connection.
          if (x.head_handled && (x.read_until_eof || (x.expected >= 0 && x.received >= x.expected))) return complete(x);
          return fail(x, {x.head_handled ? "unexpected end of stream from " + endpoint(x)
                                         : "Connection closed by " + endpoint(x) + " before a response arrived"});
        case HTTPClient::STATUS_CONNECTED:
          if (!x.request_sent) {
            if (auto error = send(x)) return fail(x, {*error});
            x.client->poll();  // the request leaves in this very pump
            continue;
          }
          [[fallthrough]];
        case HTTPClient::STATUS_BODY:
          // CONNECTED after the request was sent means the response is complete,
          // and a response without a body ends here without ever being in BODY.
          switch (settle_head(x)) {
            case Head::Failed: return true;
            case Head::Redirected: return false;
            case Head::Delivered: break;
          }
          if (x.client->get_status() == HTTPClient::STATUS_CONNECTED) return complete(x);
          read_body(x, budget);
          if (x.client->get_status() == HTTPClient::STATUS_BODY) return false;
          continue;  // the status changed while reading
        default:
          return fail(x, {"Unexpected connection state"});
      }
    }
    return false;
  }

  bool complete(Exchange &x) {
    auto listener = std::move(x.listener);
    x.client->close();
    exchanges_.erase(x.id);  // `x` is gone from here on
    ++completed_;
    listener.on_complete();
    return true;
  }

  bool fail(Exchange &x, HttpFailure failure) {
    auto listener = std::move(x.listener);
    if (x.client.is_valid()) x.client->close();
    exchanges_.erase(x.id);
    ++failed_;
    if (failure.timed_out) ++timed_out_;
    listener.on_failure(std::move(failure));
    return true;
  }
};
}

std::unique_ptr<HttpTransport> make_godot_http_transport(TrustedAuthorities trusted_authorities, MonotonicClock now) {
  return std::make_unique<GodotHttpTransport>(std::move(trusted_authorities), std::move(now));
}
}
