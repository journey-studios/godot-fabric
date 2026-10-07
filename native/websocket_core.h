#pragma once

// The pure parts of the host's WebSocket support: the URL, default Origin, subprotocol list, header and close
// parameters that RN's Android WebSocketModule and the OkHttp underneath it accept or build. Header-only and free
// of Godot and React Native, so websocket_core_test.cpp can exercise them on their own. RN's module has no
// transport of its own: what it does with an argument is what OkHttp's Request.Builder, Headers and RealWebSocket
// do with it, and that is the contract the WebSocketModule of this host implements.

#include "http_core.h"
#include <charconv>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace fabric_godot::websocket {
// RealWebSocket.MAX_QUEUE_SIZE: a message that does not fit in what is already queued closes the socket with 1001.
constexpr std::size_t max_queued_bytes = 16u * 1024u * 1024u;
// RealWebSocket.CANCEL_AFTER_CLOSE_MILLIS: how long a closing handshake waits for the peer's close frame.
constexpr double close_timeout_ms = 60000;
// WebSocketProtocol.CLOSE_MESSAGE_MAX: a close frame's payload is at most 125 bytes, two of them the code.
constexpr std::size_t max_close_reason_bytes = 123;
constexpr int close_going_away = 1001;
constexpr int close_no_status = 1005;
constexpr int close_abnormal = 1006;

inline bool starts_with_ignore_case(std::string_view text, std::string_view prefix) {
  return text.size() >= prefix.size() && http::iequals(text.substr(0, prefix.size()), prefix);
}

struct Endpoint {
  std::string url;        // what the transport connects to: ws:// or wss://, the port always written, no fragment
  std::string authority;  // host:port, IPv6 bracketed, for diagnostics
  bool tls{};
};

// OkHttp's Request.Builder.url(String): "ws:" and "wss:" are read as "http:" and "https:", and HttpUrl parses the
// rest, so the URL is canonicalized and refused exactly as the HTTP side of this host does it. That is also why
// http: and https: URLs connect: OkHttp treats them as the same thing.
inline std::optional<Endpoint> parse_endpoint(std::string_view text, std::string *error = nullptr) {
  std::string normalized(text);
  if (starts_with_ignore_case(text, "wss:")) normalized = "https:" + std::string(text.substr(4));
  else if (starts_with_ignore_case(text, "ws:")) normalized = "http:" + std::string(text.substr(3));
  auto url = http::parse_url(normalized, error);
  if (!url) return std::nullopt;
  Endpoint endpoint;
  endpoint.tls = url->tls();
  endpoint.authority = (url->host.find(':') == std::string::npos ? url->host : "[" + url->host + "]") + ":" + std::to_string(url->port);
  endpoint.url = std::string(endpoint.tls ? "wss://" : "ws://") + endpoint.authority + url->target;
  return endpoint;
}

// WebSocketModule.getDefaultOrigin: the URL's own authority under http or https, with the port only when the URL wrote
// one, and the host as written. It reads the text the caller gave, not the canonical URL.
inline std::string default_origin(std::string_view text) {
  const auto colon = text.find(':');
  const auto scheme = http::lower(text.substr(0, colon));
  auto rest = colon == std::string_view::npos ? std::string_view() : text.substr(colon + 1);
  if (rest.substr(0, 2) == "//") rest.remove_prefix(2);
  auto authority = rest.substr(0, rest.find_first_of("/?#"));
  if (const auto at = authority.rfind('@'); at != std::string_view::npos) authority.remove_prefix(at + 1);
  std::string_view host = authority, port;
  if (!authority.empty() && authority.front() == '[') {
    const auto close = authority.find(']');
    if (close != std::string_view::npos) {
      host = authority.substr(0, close + 1);
      const auto after = authority.substr(close + 1);
      if (!after.empty() && after.front() == ':') port = after.substr(1);
    }
  } else if (const auto port_colon = authority.rfind(':'); port_colon != std::string_view::npos) {
    host = authority.substr(0, port_colon);
    port = authority.substr(port_colon + 1);
  }
  const char *mapped = scheme == "wss" || scheme == "https" ? "https" : scheme == "ws" || scheme == "http" ? "http" : "";
  std::string origin = std::string(mapped) + "://" + std::string(host);
  // java.net.URI keeps the port as a number: leading zeros go, and one that is empty or does not fit is no port.
  int number = 0;
  const auto parsed = std::from_chars(port.data(), port.data() + port.size(), number);
  if (!port.empty() && parsed.ec == std::errc() && parsed.ptr == port.data() + port.size()) origin += ":" + std::to_string(number);
  return origin;
}

inline std::string_view trim_whitespace(std::string_view text) {
  constexpr std::string_view space = " \t\r\n\f\v";
  const auto first = text.find_first_not_of(space);
  if (first == std::string_view::npos) return {};
  return text.substr(first, text.find_last_not_of(space) - first + 1);
}

// The subprotocols worth offering: each trimmed, and none that is empty or holds a comma, which the header's own
// separator would split in two.
inline std::vector<std::string> usable_protocols(const std::vector<std::string> &offered) {
  std::vector<std::string> usable;
  for (const auto &protocol : offered) {
    const auto trimmed = trim_whitespace(protocol);
    if (!trimmed.empty() && trimmed.find(',') == std::string_view::npos) usable.emplace_back(trimmed);
  }
  return usable;
}
inline std::string join_protocols(const std::vector<std::string> &protocols) {
  std::string joined;
  for (const auto &protocol : protocols) joined += (joined.empty() ? "" : ",") + protocol;
  return joined;
}

// UTF-16 code units of UTF-8 text, as the Java strings OkHttp validates hold them; an invalid sequence is U+FFFD.
inline std::vector<uint32_t> utf16_units(std::string_view text) {
  std::vector<uint32_t> units;
  const auto clean = http::sanitize_utf8(text);
  for (std::size_t index = 0; index < clean.size();) {
    const auto lead = static_cast<unsigned char>(clean[index]);
    const std::size_t length = lead < 0x80 ? 1 : lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : 4;
    uint32_t point = length == 1 ? lead : lead & (0xffu >> (length + 1));
    for (std::size_t offset = 1; offset < length && index + offset < clean.size(); ++offset)
      point = (point << 6) | (static_cast<unsigned char>(clean[index + offset]) & 0x3fu);
    if (point >= 0x10000) {
      point -= 0x10000;
      units.push_back(0xd800 + (point >> 10));
      units.push_back(0xdc00 + (point & 0x3ff));
    } else {
      units.push_back(point);
    }
    index += length;
  }
  return units;
}

inline std::string hex_unit(uint32_t unit) {
  char buffer[16];
  std::snprintf(buffer, sizeof buffer, "0x%02x", static_cast<unsigned>(unit));
  return buffer;
}

inline bool sensitive_header(std::string_view name) {
  return http::iequals(name, "authorization") || http::iequals(name, "cookie") || http::iequals(name, "proxy-authorization") ||
      http::iequals(name, "set-cookie");
}

// OkHttp's Headers.Builder.add: a name is printable ASCII without the space, a value is printable ASCII, space or tab. The
// message is OkHttp's, with the value left out of it for the headers that carry credentials. Nothing else reaches the wire.
inline std::optional<std::string> check_header(std::string_view name, std::string_view value) {
  if (name.empty()) return "name is empty";
  const auto name_units = utf16_units(name);
  for (std::size_t index = 0; index < name_units.size(); ++index) {
    if (name_units[index] < 0x21 || name_units[index] > 0x7e)
      return "Unexpected char " + hex_unit(name_units[index]) + " at " + std::to_string(index) + " in header name: " + std::string(name);
  }
  const auto value_units = utf16_units(value);
  for (std::size_t index = 0; index < value_units.size(); ++index) {
    if (value_units[index] != '\t' && (value_units[index] < 0x20 || value_units[index] > 0x7e)) {
      return "Unexpected char " + hex_unit(value_units[index]) + " at " + std::to_string(index) + " in " + std::string(name) + " value" +
          (sensitive_header(name) ? "" : ": " + std::string(value));
    }
  }
  return std::nullopt;
}

// The headers the handshake itself is made of: the transport writes them, and OkHttp replaces what a caller gives.
inline bool owned_by_handshake(std::string_view name) {
  for (const char *owned : {"host", "upgrade", "connection", "sec-websocket-key", "sec-websocket-version", "sec-websocket-extensions",
           "sec-websocket-protocol"}) {
    if (http::iequals(name, owned)) return true;
  }
  return false;
}

// WebSocketProtocol.closeCodeExceptionMessage and RealWebSocket.close: the explanation of a close that OkHttp refuses, or
// nullopt. The code is a Kotlin Int, so a fraction is cut off, and one that is no number at all is 0.
inline std::optional<std::string> check_close(double code, std::string_view reason) {
  const auto integer = std::isfinite(code) && std::fabs(code) < 2147483648.0 ? static_cast<long>(code) : 0L;
  if (integer < 1000 || integer >= 5000) return "Code must be in range [1000,5000): " + std::to_string(integer);
  if ((integer >= 1004 && integer <= 1006) || (integer >= 1015 && integer <= 2999))
    return "Code " + std::to_string(integer) + " is reserved and may not be used.";
  if (reason.size() > max_close_reason_bytes) return "reason.size() > " + std::to_string(max_close_reason_bytes) + ": " + std::string(reason);
  return std::nullopt;
}
inline int close_code_of(double code) { return static_cast<int>(static_cast<long>(code)); }

// What an engine reports as the close code of a connection that ended: -1 when no close frame arrived at all, 0 when one
// arrived without a status. OkHttp reports the second as 1005 and fails the first.
inline int reported_close_code(int engine_code) { return engine_code == 0 ? close_no_status : engine_code; }
}
