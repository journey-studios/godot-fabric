#pragma once

#include "godot_tls.h"
#include "godot_http_transport.h"
#include "websocket_core.h"
#include "websocket_transport.h"
#include <godot_cpp/classes/http_client.hpp>
#include <godot_cpp/classes/stream_peer.hpp>
#include <wslay/wslay.h>
#include <functional>
#include <memory>
#include <optional>
#include <string>

namespace fabric_godot {
class GodotWebSocketConnection final {
 public:
  using MonotonicClock = std::function<double()>;
  GodotWebSocketConnection(WebSocketRequest request, WebSocketListener listener,
      TrustedAuthorities trusted_authorities, MonotonicClock now);
  ~GodotWebSocketConnection();

  std::optional<std::string> start();
  WebSocketSend send(const WebSocketMessage &message);
  void close(int code, const std::string &reason);
  void cancel();
  void poll(std::size_t &byte_budget, std::size_t &event_budget);
  bool finished() const { return finished_; }
  std::size_t reserved_events() const { return message_reserved_ && !finished_ ? 1 : 0; }
  bool open() const { return open_; }
  bool closing() const { return closing_; }
  bool take_close_timeout() { return std::exchange(close_timed_out_, false); }

 private:
  enum class State { Connecting, WritingUpgrade, ReadingUpgrade, Ready, Open };
  enum class Terminal { None, Closed, Failed };
  static ssize_t receive(wslay_event_context_ptr, uint8_t *, size_t, int, void *);
  static ssize_t transmit(wslay_event_context_ptr, const uint8_t *, size_t, int, void *);
  static int generate_mask(wslay_event_context_ptr, uint8_t *, size_t, void *);
  static void frame_start(wslay_event_context_ptr, const wslay_event_on_frame_recv_start_arg *, void *);
  static void frame_chunk(wslay_event_context_ptr, const wslay_event_on_frame_recv_chunk_arg *, void *);
  static void frame_end(wslay_event_context_ptr, void *);
  static void message(wslay_event_context_ptr, const wslay_event_on_msg_recv_arg *, void *);

  bool advance_connector();
  bool write_upgrade();
  bool read_upgrade();
  bool initialize_wslay();
  bool advance_websocket();
  void finish_cancel();
  bool read_stream(uint8_t *buffer, size_t length, size_t &received);
  bool write_stream(const uint8_t *buffer, size_t length, size_t &sent);
  void fail(std::string message);
  void closed(int code);
  void dispatch_terminal();
  void clear_stream();

  WebSocketRequest request_;
  WebSocketListener listener_;
  TrustedAuthorities trusted_authorities_;
  MonotonicClock now_;
  http::Url url_;
  godot::Ref<godot::HTTPClient> connector_;
  godot::Ref<godot::StreamPeer> stream_;
  wslay_event_context_ptr wslay_{};
  State state_{State::Connecting};
  Terminal terminal_{Terminal::None};
  std::string endpoint_;
  std::string expected_accept_;
  std::string protocol_;
  std::string upgrade_request_;
  std::string upgrade_response_;
  std::string terminal_reason_;
  double close_deadline_{};
  size_t request_offset_{};
  size_t *byte_budget_{};
  size_t *event_budget_{};
  uint64_t frame_payload_remaining_{};
  bool frame_started_{};
  bool message_reserved_{};
  int received_close_code_{websocket::close_no_status};
  double handshake_deadline_{};
  bool closing_{};
  bool open_{};
  bool finished_{};
  bool close_timed_out_{};
  bool polling_{};
  bool cancel_requested_{};
};
}
