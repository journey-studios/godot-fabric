#include "websocket_core.h"
#include <cmath>
#include <iostream>
#include <stdexcept>
#include <string>

using namespace fabric_godot::websocket;

namespace {
void require(bool condition, const char *message) {
  if (!condition) throw std::runtime_error(message);
}
void require_equal(const std::string &actual, const std::string &expected, const char *message) {
  if (actual != expected) throw std::runtime_error(std::string(message) + ": got <" + actual + ">, expected <" + expected + ">");
}
Endpoint endpoint(const std::string &text) {
  std::string error;
  auto parsed = parse_endpoint(text, &error);
  require(parsed.has_value(), error.c_str());
  return *parsed;
}

void urls_are_read_like_okhttp_reads_them() {
  require_equal(endpoint("ws://127.0.0.1:8080/chat?room=1#frag").url, "ws://127.0.0.1:8080/chat?room=1", "The fragment is dropped, the port stays");
  require_equal(endpoint("ws://host").url, "ws://host:80/", "An empty path is /, and the default port is written out");
  require_equal(endpoint("WSS://Example.COM/a b").url, "wss://example.com:443/a%20b", "The scheme and host fold, spaces are escaped");
  require(endpoint("wss://h/").tls && !endpoint("ws://h/").tls, "wss is TLS and ws is not");
  require_equal(endpoint("http://host:81/x").url, "ws://host:81/x", "http reads as ws, as OkHttp treats it");
  require_equal(endpoint("https://host/x").url, "wss://host:443/x", "https reads as wss");
  require_equal(endpoint("ws://[::1]:3000/p").url, "ws://[::1]:3000/p", "IPv6 literals keep their brackets");
  require_equal(endpoint("ws://[::1]:3000/p").authority, "[::1]:3000", "The authority is bracketed too");
  require_equal(endpoint("ws://user:secret@host:9/p").url, "ws://host:9/p", "User info is never sent");
  require_equal(endpoint("ws://host/a/../b/./c").url, "ws://host:80/b/c", "Dot segments are removed");
  std::string error;
  require(!parse_endpoint("ftp://host/x", &error) && error.find("but was 'ftp'") != std::string::npos, "Another scheme is refused with OkHttp's words");
  require(!parse_endpoint("not a url", &error) && error.find("no scheme") != std::string::npos, "A scheme is required");
  require(!parse_endpoint("ws://", &error) && !parse_endpoint("ws://host:0/", &error) && !parse_endpoint("ws://host:70000/", &error) &&
      !parse_endpoint("ws://ho st/", &error), "A host and a valid port are required");
}

void the_default_origin_is_the_urls_own_authority() {
  require_equal(default_origin("ws://127.0.0.1:8080/chat"), "http://127.0.0.1:8080", "ws becomes http, with the port");
  require_equal(default_origin("wss://example.com/x"), "https://example.com", "wss becomes https, without a port the URL did not write");
  require_equal(default_origin("wss://Example.com:443/x"), "https://Example.com:443", "A port the URL wrote stays, and the host keeps its case");
  require_equal(default_origin("http://h:080/"), "http://h:80", "The port is a number");
  require_equal(default_origin("https://h/x"), "https://h", "https stays");
  require_equal(default_origin("ws://[::1]:1/x"), "http://[::1]:1", "IPv6 keeps its brackets");
  require_equal(default_origin("ws://user:pw@host:9/"), "http://host:9", "User info is not part of an origin");
  require_equal(default_origin("ws://host?x=1#y"), "http://host", "A query or fragment ends the authority");
  require_equal(default_origin("ws://host:99999999999999999999/"), "http://host", "A port that does not fit in a number is no port, and no exception");
  require_equal(default_origin("ws://host:+5/"), "http://host", "Nor is one that is not made of digits");
}

void subprotocols_are_trimmed_and_filtered() {
  const auto usable = usable_protocols({" chat.v2 ", "", "   ", "a,b", "chat.v1"});
  require(usable.size() == 2 && usable[0] == "chat.v2" && usable[1] == "chat.v1", "Empty entries and entries with a comma are dropped");
  require_equal(join_protocols(usable), "chat.v2,chat.v1", "The header joins them with a comma and no space");
  require(usable_protocols({}).empty() && join_protocols({}).empty(), "Nothing offered, nothing joined");
}

void headers_are_checked_as_okhttp_checks_them() {
  require(!check_header("X-Test", "a b\tc"), "A value may hold a space and a tab");
  require(!check_header("Sec-WebSocket-Protocol", "chat.v1,chat.v2"), "A subprotocol list is a valid value");
  require_equal(*check_header("X-Test", "a\nb"), "Unexpected char 0x0a at 1 in X-Test value: a\nb", "A line break is refused");
  require_equal(*check_header("X-Unicode", "ação"), "Unexpected char 0xe7 at 1 in X-Unicode value: ação", "Non-ASCII is refused, with its UTF-16 index");
  require_equal(*check_header("X-Emoji", "x\xF0\x9F\x98\x80"), "Unexpected char 0xd83d at 1 in X-Emoji value: x\xF0\x9F\x98\x80", "A surrogate pair counts as two units");
  require_equal(*check_header("Authorization", "Bearer é"), "Unexpected char 0xe9 at 7 in Authorization value", "A credential's value is left out of the message");
  require_equal(*check_header("Cookie", "a=\x01"), "Unexpected char 0x01 at 2 in Cookie value", "So is a cookie's");
  require_equal(*check_header("a b", "v"), "Unexpected char 0x20 at 1 in header name: a b", "A name holds no space");
  require_equal(*check_header("", "v"), "name is empty", "A name is required");
  require_equal(*check_header("X-é", "v"), "Unexpected char 0xe9 at 2 in header name: X-é", "A name is ASCII");
  require(owned_by_handshake("Host") && owned_by_handshake("upgrade") && owned_by_handshake("Sec-WebSocket-Key") &&
      owned_by_handshake("sec-websocket-protocol") && !owned_by_handshake("Origin") && !owned_by_handshake("Authorization"),
      "The handshake's own headers are the engine's, the rest are the caller's");
}

void close_parameters_follow_okhttp() {
  for (const double code : {1000.0, 1001.0, 1002.0, 1003.0, 1007.0, 1011.0, 1012.0, 1013.0, 1014.0, 3000.0, 4000.0, 4999.0, 1000.9})
    require(!check_close(code, ""), "A usable code is accepted");
  require_equal(*check_close(999, ""), "Code must be in range [1000,5000): 999", "Below 1000");
  require_equal(*check_close(5000, ""), "Code must be in range [1000,5000): 5000", "From 5000");
  require_equal(*check_close(std::nan(""), ""), "Code must be in range [1000,5000): 0", "No number is 0");
  for (const double code : {1004.0, 1005.0, 1006.0, 1015.0, 2000.0, 2999.0})
    require_equal(*check_close(code, ""), "Code " + std::to_string(static_cast<int>(code)) + " is reserved and may not be used.", "A reserved code");
  require(!check_close(1000, std::string(123, 'x')), "A reason of 123 bytes fits in a close frame");
  require_equal(*check_close(1000, std::string(124, 'x')), "reason.size() > 123: " + std::string(124, 'x'), "124 bytes do not");
  std::string accents;
  for (int index = 0; index < 62; ++index) accents += "\xC3\xA9";
  require(check_close(1000, accents).has_value(), "The reason counts bytes, not characters");
  require(close_code_of(1000.9) == 1000 && close_code_of(4001) == 4001, "A close code is cut to an integer");
}

void a_close_frame_without_status_is_1005() {
  require(reported_close_code(0) == 1005 && reported_close_code(1000) == 1000 && reported_close_code(4001) == 4001 &&
      reported_close_code(1006) == 1006, "0 is no status; every other code is what the frame carried");
}
}

int main() {
  urls_are_read_like_okhttp_reads_them();
  the_default_origin_is_the_urls_own_authority();
  subprotocols_are_trimmed_and_filtered();
  headers_are_checked_as_okhttp_checks_them();
  close_parameters_follow_okhttp();
  a_close_frame_without_status_is_1005();
  std::cout << "WEBSOCKET_CORE_PASSED\n";
}
