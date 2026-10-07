#include "websocket_handshake.h"
#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>

namespace {
int assertions = 0;
void check(bool value, const char *message) {
  ++assertions;
  if (!value) { std::cerr << "FAIL: " << message << '\n'; std::exit(1); }
}
std::string response(std::string headers = {}) {
  return "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: keep-alive, Upgrade\r\n"
      "Sec-WebSocket-Accept: accept-value\r\n" + headers + "\r\n";
}
std::optional<std::string> parse(std::string_view bytes, fabric_godot::websocket::UpgradeResponse &result) {
  return fabric_godot::websocket::parse_upgrade_response(bytes, "accept-value", {"fabric"}, result);
}
}

int main() {
  using fabric_godot::websocket::UpgradeResponse;
  UpgradeResponse result;
  check(!parse(response("Sec-WebSocket-Protocol: fabric\r\n"), result) && result.protocol == "fabric", "valid upgrade and protocol");
  const auto combined = parse(response("Upgrade: h2c\r\nConnection: Upgrade\r\n"), result);
  check(!combined, "upgrade and connection tokens combine across duplicate headers");
  const auto no_protocol = parse(response(), result);
  if (no_protocol) std::cerr << "no protocol: " << *no_protocol << '\n';
  check(!no_protocol, "missing selected protocol is allowed");
  check(parse(response("Sec-WebSocket-Accept: accept-value\r\n"), result).has_value(), "duplicate accept is refused");
  check(parse(response("Sec-WebSocket-Protocol: fabric\r\nSec-WebSocket-Protocol: fabric\r\n"), result).has_value(), "duplicate protocol is refused");
  check(parse(response("Sec-WebSocket-Protocol: other\r\n"), result).has_value(), "unoffered protocol is refused");
  check(parse(response("Sec-WebSocket-Extensions: permessage-deflate\r\n"), result).has_value(), "unoffered extension is refused");
  check(parse("HTTP/1.1 200 OK\r\n\r\n", result).has_value(), "non-101 response is refused");
  check(parse("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n", result).has_value(),
      "missing accept is refused");
  auto oversized = std::string("HTTP/1.1 101 Switching Protocols\r\nX-Fill: ") +
      std::string(fabric_godot::websocket::max_upgrade_header_bytes, 'x') + "\r\n\r\n";
  check(parse(oversized, result).has_value(), "terminator beyond bounded header is refused");
  std::cout << "websocket_handshake_test: " << assertions << " assertions\n";
}
