#pragma once

#include "http_core.h"
#include <algorithm>
#include <optional>
#include <string>
#include <string_view>

namespace fabric_godot::websocket {
constexpr std::size_t max_upgrade_header_bytes = 16 * 1024;

struct UpgradeResponse {
  std::string protocol;
};

inline bool has_token(std::string_view value, std::string_view token) {
  while (!value.empty()) {
    const auto comma = value.find(',');
    if (http::iequals(http::trim(value.substr(0, comma)), token)) return true;
    if (comma == std::string_view::npos) break;
    value.remove_prefix(comma + 1);
  }
  return false;
}

inline std::optional<std::string> parse_upgrade_response(std::string_view bytes, std::string_view expected_accept,
    const std::vector<std::string> &offered_protocols, UpgradeResponse &response) {
  response = {};
  const auto end = bytes.find("\r\n\r\n");
  if (end == std::string_view::npos) return "WebSocket upgrade response is incomplete";
  if (end + 4 > max_upgrade_header_bytes) return "WebSocket upgrade headers exceeded 16 KiB";
  auto line_end = bytes.find("\r\n");
  if (line_end == std::string_view::npos || line_end > end) return "WebSocket upgrade response has no status line";
  const auto status = bytes.substr(0, line_end);
  if (status.size() < 12 || status.substr(0, 9) != "HTTP/1.1 " || status.substr(9, 3) != "101")
    return "WebSocket upgrade was rejected: " + std::string(status);
  if (status.size() > 12 && status[12] != ' ') return "WebSocket upgrade response has an invalid status line";
  http::Headers headers;
  std::size_t cursor = line_end + 2;
  while (cursor < end) {
    line_end = bytes.find("\r\n", cursor);
    if (line_end == std::string_view::npos || line_end > end) return "WebSocket upgrade response has an unterminated header";
    const auto line = bytes.substr(cursor, line_end - cursor);
    const auto colon = line.find(':');
    if (colon == std::string_view::npos || !http::valid_header_name(line.substr(0, colon)) ||
        !http::valid_header_value(http::trim(line.substr(colon + 1))))
      return "WebSocket upgrade response has an invalid header";
    headers.emplace_back(std::string(line.substr(0, colon)), std::string(http::trim(line.substr(colon + 1))));
    cursor = line_end + 2;
  }
  std::string upgrade, connection, accept;
  std::size_t accept_count = 0, protocol_count = 0, extension_count = 0;
  const std::string *protocol = nullptr;
  for (const auto &[name, value] : headers) {
    if (http::iequals(name, "Upgrade")) upgrade += (upgrade.empty() ? "" : ",") + value;
    else if (http::iequals(name, "Connection")) connection += (connection.empty() ? "" : ",") + value;
    else if (http::iequals(name, "Sec-WebSocket-Accept")) { accept = value; ++accept_count; }
    else if (http::iequals(name, "Sec-WebSocket-Protocol")) { protocol = &value; ++protocol_count; }
    else if (http::iequals(name, "Sec-WebSocket-Extensions")) ++extension_count;
  }
  if (!has_token(upgrade, "websocket") || !has_token(connection, "Upgrade"))
    return "WebSocket upgrade response omitted Upgrade or Connection tokens";
  if (accept_count != 1 || accept != expected_accept) return "WebSocket upgrade response has an invalid Sec-WebSocket-Accept";
  if (extension_count)
    return "WebSocket upgrade response selected an unrequested extension";
  if (protocol_count > 1) return "WebSocket upgrade response selected multiple subprotocols";
  if (protocol) {
    const auto selected = http::trim(*protocol);
    if (selected.empty() || selected.find(',') != std::string_view::npos ||
        std::find(offered_protocols.begin(), offered_protocols.end(), selected) == offered_protocols.end())
      return "WebSocket server selected an unoffered subprotocol";
    response.protocol = std::string(selected);
  }
  return std::nullopt;
}
}
