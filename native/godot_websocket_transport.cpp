#include "godot_websocket_transport.h"
#include "godot_tls.h"
#include "websocket_core.h"
#include <godot_cpp/classes/web_socket_peer.hpp>
#include <godot_cpp/variant/packed_byte_array.hpp>
#include <godot_cpp/variant/packed_string_array.hpp>
#include <algorithm>
#include <chrono>
#include <cstring>
#include <map>
#include <vector>

namespace fabric_godot {
namespace {
using godot::PackedByteArray;
using godot::PackedStringArray;
using godot::Ref;
using godot::String;
using godot::WebSocketPeer;

std::string utf8(const String &value) { return value.utf8().get_data(); }
String gd(const std::string &value) { return String::utf8(value.c_str(), static_cast<int64_t>(value.size())); }

// The engine keeps a whole message in a ring of this size and refuses a larger one by closing with 1009, and refuses to send
// what would not fit in the other ring: the defaults, 64 KiB, are far under what an application sends. OkHttp's own limit on
// what is queued to send is the same 16 MiB, which is what the outbound ring is set to; an incoming message has no limit of
// that kind there, and this one is as large as that. The pages of a ring are committed only as they are used.
constexpr int ring_bytes = static_cast<int>(websocket::max_queued_bytes);
// The engine's ring of queued packets; the default, 4096, is what a flood of small messages would fill within one pump.
constexpr int max_queued_packets = 16384;
// One pump hands JS at most this many messages from one connection, as it runs at most 256 callbacks in all.
constexpr int max_messages_per_pump = 256;

class GodotWebSocketTransport final : public WebSocketTransport {
 public:
  GodotWebSocketTransport(TrustedAuthorities trusted_authorities, MonotonicClock now)
      : trusted_authorities_(std::move(trusted_authorities)),
        now_(now ? std::move(now) : MonotonicClock([] {
          return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count();
        })) {}
  ~GodotWebSocketTransport() override { stop(); }

  std::optional<std::string> start(uint64_t id, WebSocketRequest request, WebSocketListener listener) override {
    if (stopped_) return "E_RUNTIME_STOPPED: the application has stopped";
    if (sockets_.contains(id)) return "E_SOCKET_DUPLICATE: socket " + std::to_string(id) + " is already in use";
    auto socket = std::make_unique<Socket>();
    socket->id = id;
    socket->listener = std::move(listener);
    socket->endpoint = endpoint_of(request.url);
    Ref<godot::TLSOptions> tls;
    if (request.url.rfind("wss://", 0) == 0) {
      if (auto error = client_tls_options(trusted_authorities_ ? trusted_authorities_() : std::string(), tls)) return error;
      socket->tls = true;
    }
    socket->peer.instantiate();
    socket->peer->set_inbound_buffer_size(ring_bytes);
    socket->peer->set_outbound_buffer_size(ring_bytes);
    socket->peer->set_max_queued_packets(max_queued_packets);
    PackedStringArray protocols;
    for (const auto &protocol : request.protocols) protocols.push_back(gd(protocol));
    socket->peer->set_supported_protocols(protocols);
    PackedStringArray lines;
    for (const auto &[name, value] : request.headers) lines.push_back(gd(name + ": " + value));
    socket->peer->set_handshake_headers(lines);
    if (socket->peer->connect_to_url(gd(request.url), tls) != godot::OK) return "Failed to connect to " + socket->endpoint;
    ++started_;
    sockets_.emplace(id, std::move(socket));
    return std::nullopt;
  }

  WebSocketSend send(uint64_t id, const WebSocketMessage &message) override {
    const auto found = sockets_.find(id);
    if (found == sockets_.end() || found->second->closing || found->second->peer->get_ready_state() != WebSocketPeer::STATE_OPEN)
      return WebSocketSend::NotOpen;
    auto &socket = *found->second;
    // Checked here so that the engine never has to refuse (and print about) a message that cannot be queued.
    if (static_cast<std::size_t>(socket.peer->get_current_outbound_buffered_amount()) + message.bytes.size() > websocket::max_queued_bytes) {
      ++overflows_;
      return WebSocketSend::Overflow;
    }
    PackedByteArray bytes;
    bytes.resize(static_cast<int64_t>(message.bytes.size()));
    if (!message.bytes.empty()) std::memcpy(bytes.ptrw(), message.bytes.data(), message.bytes.size());
    if (socket.peer->send(bytes, message.text ? WebSocketPeer::WRITE_MODE_TEXT : WebSocketPeer::WRITE_MODE_BINARY) != godot::OK) {
      ++send_errors_;
      return WebSocketSend::NotOpen;
    }
    (message.text ? text_out_ : binary_out_) += 1;
    bytes_out_ += message.bytes.size();
    return WebSocketSend::Sent;
  }

  void close(uint64_t id, int code, const std::string &reason) override {
    const auto found = sockets_.find(id);
    if (found == sockets_.end() || found->second->closing) return;
    auto &socket = *found->second;
    socket.closing = true;
    switch (socket.peer->get_ready_state()) {
      case WebSocketPeer::STATE_CONNECTING:
        // Nothing is open to close: the attempt ends here, as a web client's does, and the next poll says so.
        socket.pending_failure = "WebSocket is closed before the connection is established.";
        socket.peer->close(websocket::close_going_away, "");
        break;
      case WebSocketPeer::STATE_OPEN:
        socket.close_code = code;
        socket.close_reason = reason;
        socket.peer->close(code, gd(reason));
        // The engine never gives up on a peer that does not answer the close frame; OkHttp does, after a minute.
        socket.close_deadline = now_() + websocket::close_timeout_ms;
        break;
      default:
        break;
    }
  }

  void cancel(uint64_t id) override {
    const auto found = sockets_.find(id);
    if (found == sockets_.end()) return;
    goodbye(*found->second);
    sockets_.erase(found);
    ++cancelled_;
  }

  void poll(std::size_t byte_budget) override {
    if (stopped_ || sockets_.empty()) return;
    ++polls_;
    // Ids first: a listener may start or close connections, which reshapes the map.
    std::vector<uint64_t> ids;
    ids.reserve(sockets_.size());
    for (const auto &entry : sockets_) ids.push_back(entry.first);
    std::size_t budget = byte_budget;
    for (const auto id : ids) {
      const auto found = sockets_.find(id);
      if (found != sockets_.end()) advance(*found->second, budget);
    }
  }

  void stop() override {
    stopped_ = true;
    for (auto &entry : sockets_) goodbye(*entry.second);
    cancelled_ += sockets_.size();
    sockets_.clear();
  }

  folly::dynamic snapshot() const override {
    uint64_t connecting = 0, open = 0, closing = 0;
    for (const auto &entry : sockets_) {
      const auto &socket = *entry.second;
      if (socket.closing) ++closing;
      else if (socket.open_reported) ++open;
      else ++connecting;
    }
    return folly::dynamic::object("transport", "godot-websocket-peer")("stopped", stopped_)("active", sockets_.size())
        ("connecting", connecting)("open", open)("closing", closing)("started", started_)("opened", opened_)
        ("closedByPeer", closed_)("impliedCloses", implied_closes_)("failed", failed_)("cancelled", cancelled_)("closeTimeouts", close_timeouts_)
        ("overflows", overflows_)("sendErrors", send_errors_)
        ("messagesIn", folly::dynamic::object("text", text_in_)("binary", binary_in_)("bytes", bytes_in_))
        ("messagesOut", folly::dynamic::object("text", text_out_)("binary", binary_out_)("bytes", bytes_out_))("polls", polls_);
  }

 private:
  struct Socket {
    uint64_t id{};
    Ref<WebSocketPeer> peer;
    WebSocketListener listener;
    std::string endpoint;  // host:port, for what a failure says
    bool tls{};
    bool open_reported{};
    bool closing{};  // the module asked to close
    bool timed_out{};
    int close_code{};  // what it asked for
    std::string close_reason;
    double close_deadline{};
    std::optional<std::string> pending_failure;
  };

  TrustedAuthorities trusted_authorities_;
  MonotonicClock now_;
  std::map<uint64_t, std::unique_ptr<Socket>> sockets_;
  bool stopped_{};
  uint64_t started_{}, opened_{}, closed_{}, failed_{}, cancelled_{}, close_timeouts_{}, implied_closes_{}, overflows_{}, send_errors_{}, polls_{};
  uint64_t text_in_{}, binary_in_{}, bytes_in_{}, text_out_{}, binary_out_{}, bytes_out_{};

  // The endpoint is going away: an open peer is told so with 1001, and the close frame leaves before the connection does.
  static void goodbye(Socket &socket) {
    const auto &peer = socket.peer;
    if (!peer.is_valid()) return;
    const bool open = peer->get_ready_state() == WebSocketPeer::STATE_OPEN;
    peer->close(websocket::close_going_away, "");
    if (open) peer->poll();
  }

  // host:port of a ws or wss URL the module has canonicalized.
  static std::string endpoint_of(const std::string &url) {
    const auto start = url.find("://");
    if (start == std::string::npos) return url;
    const auto end = url.find('/', start + 3);
    return url.substr(start + 3, end == std::string::npos ? std::string::npos : end - start - 3);
  }

  void report_open(Socket &socket) {
    if (socket.open_reported) return;
    socket.open_reported = true;
    ++opened_;
    socket.listener.on_open(utf8(socket.peer->get_selected_protocol()));
  }

  // Hands over what the connection has queued, within the budget. The engine lets a message be read only while the
  // connection is open: whatever arrived in the same poll as the peer's close frame is gone by the time poll() returns.
  void read_messages(Socket &socket, std::size_t &budget) {
    const auto id = socket.id;
    const auto peer = socket.peer;
    // The first message of a pump is read whatever is left of the budget, so that no connection waits behind the others.
    for (int count = 0; count < max_messages_per_pump && (count == 0 || budget > 0) && peer->get_available_packet_count() > 0; ++count) {
      const PackedByteArray packet = peer->get_packet();
      const bool text = peer->was_string_packet();
      const auto size = static_cast<std::size_t>(packet.size());
      budget -= std::min(budget, size);
      (text ? text_in_ : binary_in_) += 1;
      bytes_in_ += size;
      WebSocketMessage message{text, std::string(reinterpret_cast<const char *>(packet.ptr()), size)};
      socket.listener.on_message(std::move(message));
      if (!sockets_.contains(id)) return;
    }
  }

  // Returns true once the connection has ended and left the map.
  bool advance(Socket &socket, std::size_t &budget) {
    if (socket.pending_failure) return fail(socket, *socket.pending_failure);
    socket.peer->poll();
    switch (socket.peer->get_ready_state()) {
      case WebSocketPeer::STATE_CONNECTING:
        return false;
      case WebSocketPeer::STATE_OPEN:
        report_open(socket);
        read_messages(socket, budget);
        return false;
      case WebSocketPeer::STATE_CLOSING:
        report_open(socket);
        if (socket.close_deadline > 0 && now_() >= socket.close_deadline) {
          // Forced: no frame is sent and the connection is dropped.
          socket.timed_out = true;
          ++close_timeouts_;
          socket.peer->close(-1, "");
          return finish(socket);
        }
        return false;
      case WebSocketPeer::STATE_CLOSED:
        return finish(socket);
    }
    return false;
  }

  // The peer's state is CLOSED. A close code of -1 means that no close frame arrived: a handshake that failed, or a
  // connection that was cut. Anything else, 0 included, is a close frame, which means the handshake had succeeded even if
  // the engine went from CONNECTING to CLOSED within one poll.
  bool finish(Socket &socket) {
    const int code = static_cast<int>(socket.peer->get_close_code());
    const auto reason = utf8(socket.peer->get_close_reason());
    if (socket.timed_out)
      return fail(socket, "WebSocket close timed out: the server did not answer the close frame within " +
          std::to_string(static_cast<int>(websocket::close_timeout_ms / 1000)) + " seconds");
    // Over TLS the engine ends a closing handshake that the application began without reading the server's close frame,
    // though the server sent it (the frame and the TLS close_notify arrive together): the closing is taken as complete, with
    // the code and reason that were sent, as a server echoes them. Over plain TCP the same end is a connection that was cut.
    if (code == -1 && socket.tls && socket.closing && socket.open_reported) {
      auto listener = std::move(socket.listener);
      const auto asked = socket.close_code;
      auto asked_reason = socket.close_reason;
      sockets_.erase(socket.id);
      ++closed_;
      ++implied_closes_;
      listener.on_closed(asked, std::move(asked_reason));
      return true;
    }
    if (code == -1) {
      return fail(socket, socket.open_reported
          ? "WebSocket connection to " + socket.endpoint + " was lost without a close frame"
          : "WebSocket connection to " + socket.endpoint + " failed before it opened: refused, or the server did not accept the upgrade (the engine reports no status)");
    }
    report_open(socket);
    auto listener = std::move(socket.listener);
    sockets_.erase(socket.id);  // `socket` is gone from here on
    ++closed_;
    listener.on_closed(websocket::reported_close_code(code), reason);
    return true;
  }

  bool fail(Socket &socket, std::string message) {
    auto listener = std::move(socket.listener);
    if (socket.peer.is_valid()) socket.peer->close(-1, "");
    sockets_.erase(socket.id);
    ++failed_;
    listener.on_failure(std::move(message));
    return true;
  }
};
}

std::unique_ptr<WebSocketTransport> make_godot_websocket_transport(TrustedAuthorities trusted_authorities, MonotonicClock now) {
  return std::make_unique<GodotWebSocketTransport>(std::move(trusted_authorities), std::move(now));
}
}
