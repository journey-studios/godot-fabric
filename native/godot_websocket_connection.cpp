#include "godot_websocket_connection.h"
#include "websocket_core.h"
#include "websocket_handshake.h"
#include <godot_cpp/classes/crypto.hpp>
#include <godot_cpp/classes/hashing_context.hpp>
#include <godot_cpp/classes/tls_options.hpp>
#include <godot_cpp/variant/array.hpp>
#include <godot_cpp/variant/packed_byte_array.hpp>
#include <algorithm>
#include <cstring>

namespace fabric_godot {
namespace {
using godot::Array;
using godot::Crypto;
using godot::HashingContext;
using godot::HTTPClient;
using godot::PackedByteArray;
using godot::Ref;
using godot::StreamPeer;
using godot::String;
using godot::TLSOptions;

String gd(std::string_view value) { return String::utf8(value.data(), static_cast<int64_t>(value.size())); }
int32_t array_error(const Array &result) { return static_cast<int32_t>(static_cast<int64_t>(result[0])); }

std::string websocket_accept(const std::string &key) {
  static constexpr std::string_view guid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
  Ref<HashingContext> hash;
  hash.instantiate();
  const std::string material = key + std::string(guid);
  PackedByteArray bytes;
  bytes.resize(static_cast<int64_t>(material.size()));
  std::memcpy(bytes.ptrw(), material.data(), material.size());
  if (hash->start(HashingContext::HASH_SHA1) != godot::OK || hash->update(bytes) != godot::OK) return {};
  const auto digest = hash->finish();
  return http::base64_encode(std::string_view(reinterpret_cast<const char *>(digest.ptr()), digest.size()));
}
}

GodotWebSocketConnection::GodotWebSocketConnection(WebSocketRequest request, WebSocketListener listener,
    TrustedAuthorities trusted_authorities, MonotonicClock now)
    : request_(std::move(request)), listener_(std::move(listener)), trusted_authorities_(std::move(trusted_authorities)),
      now_(std::move(now)), endpoint_(request_.url) {}

GodotWebSocketConnection::~GodotWebSocketConnection() {
  if (wslay_) wslay_event_context_free(wslay_);
  clear_stream();
}

std::optional<std::string> GodotWebSocketConnection::start() {
  std::string normalized = request_.url;
  if (normalized.rfind("ws://", 0) == 0) normalized.replace(0, 5, "http://");
  else if (normalized.rfind("wss://", 0) == 0) normalized.replace(0, 6, "https://");
  auto parsed = http::parse_url(normalized);
  if (!parsed) return "Invalid WebSocket endpoint: " + endpoint_;
  url_ = std::move(*parsed);
  endpoint_ = url_.authority();
  handshake_deadline_ = now_() + websocket::handshake_timeout_ms;

  Ref<TLSOptions> tls;
  if (url_.tls()) {
    if (auto error = client_tls_options(trusted_authorities_ ? trusted_authorities_() : std::string(), tls)) return error;
  }
  connector_.instantiate();
  const auto error = connector_->connect_to_host(gd(url_.host), url_.port, tls);
  if (error != godot::OK) return "Failed to connect to " + endpoint_;

  Ref<Crypto> crypto;
  crypto.instantiate();
  const auto nonce = crypto->generate_random_bytes(16);
  if (nonce.size() != 16) return "WebSocket handshake could not generate a client key";
  const std::string websocket_key = http::base64_encode(std::string_view(reinterpret_cast<const char *>(nonce.ptr()), nonce.size()));
  expected_accept_ = websocket_accept(websocket_key);
  if (expected_accept_.empty()) return "WebSocket handshake could not calculate the accept key";
  upgrade_request_ = "GET " + url_.target + " HTTP/1.1\r\nHost: " + url_.authority() +
      "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: " + websocket_key +
      "\r\nSec-WebSocket-Version: 13\r\n";
  if (!request_.protocols.empty()) upgrade_request_ += "Sec-WebSocket-Protocol: " + websocket::join_protocols(request_.protocols) + "\r\n";
  for (const auto &[name, value] : request_.headers) upgrade_request_ += name + ": " + value + "\r\n";
  upgrade_request_ += "\r\n";
  return std::nullopt;
}

WebSocketSend GodotWebSocketConnection::send(const WebSocketMessage &message) {
  if (!open_ || closing_ || !wslay_) return WebSocketSend::NotOpen;
  const auto queued = wslay_event_get_queued_msg_length(wslay_);
  if (message.bytes.size() > websocket::max_queued_bytes || queued > websocket::max_queued_bytes - message.bytes.size())
    return WebSocketSend::Overflow;
  wslay_event_msg outgoing{};
  outgoing.opcode = message.text ? WSLAY_TEXT_FRAME : WSLAY_BINARY_FRAME;
  outgoing.msg = reinterpret_cast<const uint8_t *>(message.bytes.data());
  outgoing.msg_length = message.bytes.size();
  if (wslay_event_queue_msg(wslay_, &outgoing) != 0) return WebSocketSend::NotOpen;
  return WebSocketSend::Sent;
}

void GodotWebSocketConnection::close(int code, const std::string &reason) {
  if (closing_ || finished_) return;
  closing_ = true;
  if (!open_ || !wslay_) {
    fail("WebSocket is closed before the connection is established.");
    return;
  }
  close_deadline_ = now_() + websocket::close_timeout_ms;
  if (wslay_event_queue_close(wslay_, static_cast<uint16_t>(code),
      reinterpret_cast<const uint8_t *>(reason.data()), reason.size()) != 0)
    fail("WebSocket close frame could not be queued");
}

void GodotWebSocketConnection::cancel() {
  if (finished_ || cancel_requested_) return;
  if (polling_) {
    cancel_requested_ = true;
    return;
  }
  finish_cancel();
}

void GodotWebSocketConnection::finish_cancel() {
  if (wslay_ && open_ && !finished_ && terminal_ == Terminal::None && !stream_.is_null() &&
      !wslay_event_get_close_received(wslay_)) {
    if (!closing_) {
      closing_ = true;
      wslay_event_queue_close(wslay_, 1001, nullptr, 0);
    }
    wslay_event_send(wslay_);
  }
  if (wslay_) { wslay_event_context_free(wslay_); wslay_ = nullptr; }
  clear_stream();
  finished_ = true;
  cancel_requested_ = false;
}

void GodotWebSocketConnection::poll(std::size_t &byte_budget, std::size_t &event_budget) {
  if (finished_) return;
  polling_ = true;
  byte_budget_ = &byte_budget;
  event_budget_ = &event_budget;
  const auto advance = [&] {
    if (terminal_ != Terminal::None) { dispatch_terminal(); return; }
    if (state_ != State::Ready && state_ != State::Open && now_() >= handshake_deadline_) {
      fail("WebSocket connection and upgrade timed out after 30 seconds");
      dispatch_terminal();
      return;
    }
    if (close_deadline_ > 0 && now_() >= close_deadline_) {
      close_timed_out_ = true;
      fail("WebSocket close timed out: the server did not answer the close frame within 60 seconds");
      dispatch_terminal();
      return;
    }
    if (state_ == State::Connecting && !advance_connector()) { dispatch_terminal(); return; }
    if (state_ == State::WritingUpgrade && !write_upgrade()) { dispatch_terminal(); return; }
    if (state_ == State::ReadingUpgrade && !read_upgrade()) { dispatch_terminal(); return; }
    if (state_ == State::Ready) {
      if (!event_budget) return;
      if (!initialize_wslay()) { dispatch_terminal(); return; }
      open_ = true;
      state_ = State::Open;
      --*event_budget_;
      listener_.on_open(protocol_);
    }
    if (state_ == State::Open && !cancel_requested_ && !advance_websocket()) dispatch_terminal();
  };
  advance();
  polling_ = false;
  if (cancel_requested_) finish_cancel();
}

bool GodotWebSocketConnection::advance_connector() {
  connector_->poll();
  const auto status = connector_->get_status();
  if (status == HTTPClient::STATUS_CONNECTED) {
    stream_ = connector_->get_connection();
    if (stream_.is_null()) { fail("Godot HTTPClient connected without exposing its stream"); return false; }
    state_ = State::WritingUpgrade;
    return true;
  }
  if (status == HTTPClient::STATUS_CANT_RESOLVE || status == HTTPClient::STATUS_CANT_CONNECT ||
      status == HTTPClient::STATUS_CONNECTION_ERROR || status == HTTPClient::STATUS_TLS_HANDSHAKE_ERROR) {
    fail("WebSocket connection to " + endpoint_ + " failed before the upgrade (Godot HTTPClient status " +
        std::to_string(static_cast<int>(status)) + ")");
    return false;
  }
  return true;
}

bool GodotWebSocketConnection::write_upgrade() {
  size_t sent = 0;
  if (!write_stream(reinterpret_cast<const uint8_t *>(upgrade_request_.data() + request_offset_),
      upgrade_request_.size() - request_offset_, sent)) return false;
  request_offset_ += sent;
  if (request_offset_ == upgrade_request_.size()) state_ = State::ReadingUpgrade;
  return true;
}

bool GodotWebSocketConnection::read_upgrade() {
  while (byte_budget_ && *byte_budget_ > 0) {
    uint8_t byte{};
    size_t received = 0;
    if (!read_stream(&byte, 1, received)) return false;
    if (!received) return true;
    upgrade_response_.push_back(static_cast<char>(byte));
    if (upgrade_response_.size() > websocket::max_upgrade_header_bytes) {
      fail("WebSocket upgrade headers exceeded 16 KiB");
      return false;
    }
    if (upgrade_response_.size() >= 4 && upgrade_response_.compare(upgrade_response_.size() - 4, 4, "\r\n\r\n") == 0) {
      websocket::UpgradeResponse response;
      if (auto error = websocket::parse_upgrade_response(upgrade_response_, expected_accept_, request_.protocols, response)) {
        fail(std::move(*error));
        return false;
      }
      protocol_ = std::move(response.protocol);
      state_ = State::Ready;
      handshake_deadline_ = 0;
      return true;
    }
  }
  return true;
}

bool GodotWebSocketConnection::initialize_wslay() {
  static const wslay_event_callbacks callbacks = {receive, transmit, generate_mask, frame_start, frame_chunk, frame_end, message};
  if (wslay_event_context_client_init(&wslay_, &callbacks, this) != 0) {
    fail("WebSocket framing session could not be initialized");
    return false;
  }
  wslay_event_config_set_max_recv_msg_length(wslay_, websocket::max_queued_bytes);
  return true;
}

bool GodotWebSocketConnection::advance_websocket() {
  if ((event_budget_ && *event_budget_ > 0 && byte_budget_ && *byte_budget_ > 0) || message_reserved_) {
    const int error = wslay_event_recv(wslay_);
    if (error != 0 && error != WSLAY_ERR_WANT_READ && error != WSLAY_ERR_WANT_WRITE) {
      fail("WebSocket frame receive failed: " + std::to_string(error));
      return false;
    }
  }
  if (cancel_requested_) return false;
  const int error = wslay_event_send(wslay_);
  if (error != 0 && error != WSLAY_ERR_WANT_READ && error != WSLAY_ERR_WANT_WRITE) {
    fail("WebSocket frame send failed: " + std::to_string(error));
    return false;
  }
  if (wslay_event_get_close_received(wslay_) && !wslay_event_want_write(wslay_)) {
    closed(received_close_code_);
    return false;
  }
  if (wslay_event_get_close_sent(wslay_) && !wslay_event_get_close_received(wslay_) &&
      !wslay_event_get_read_enabled(wslay_) && !wslay_event_want_write(wslay_)) {
    fail("WebSocket peer sent an invalid frame (close code " +
        std::to_string(wslay_event_get_status_code_sent(wslay_)) + ")");
    return false;
  }
  return terminal_ == Terminal::None;
}

bool GodotWebSocketConnection::read_stream(uint8_t *buffer, size_t length, size_t &received) {
  received = 0;
  if (length == 0 || stream_.is_null() || !byte_budget_ || *byte_budget_ == 0) return true;
  // Never ask TLS for bytes beyond the current plaintext record. A one-byte read when no plaintext is queued lets the
  // next record deliver its close frame before a following close_notify can turn the same read into EOF.
  const auto available = static_cast<size_t>(std::max(0, stream_->get_available_bytes()));
  const auto limited = std::min(length, *byte_budget_);
  const auto requested = available ? std::min(limited, available) : size_t{1};
  auto result = stream_->get_partial_data(static_cast<int32_t>(requested));
  const auto status = array_error(result);
  if (status == godot::OK) {
    const PackedByteArray bytes = result[1];
    received = std::min(length, static_cast<size_t>(bytes.size()));
    if (received) std::memcpy(buffer, bytes.ptr(), received);
    *byte_budget_ -= received;
    return true;
  }
  if (status == godot::ERR_BUSY) return true;
  if (status == godot::ERR_FILE_EOF && wslay_ && wslay_event_get_close_received(wslay_)) return true;
  fail("WebSocket peer at " + endpoint_ + " ended without exposing a close frame (stream error " + std::to_string(status) + ")");
  return false;
}

bool GodotWebSocketConnection::write_stream(const uint8_t *buffer, size_t length, size_t &sent) {
  sent = 0;
  if (length == 0 || stream_.is_null()) return true;
  PackedByteArray data;
  data.resize(static_cast<int64_t>(length));
  std::memcpy(data.ptrw(), buffer, length);
  const Array result = stream_->put_partial_data(data);
  const auto status = array_error(result);
  sent = static_cast<size_t>(std::max<int64_t>(0, static_cast<int64_t>(result[1])));
  if (status == godot::OK || status == godot::ERR_BUSY) return true;
  fail("WebSocket stream write failed: " + std::to_string(status));
  return false;
}

void GodotWebSocketConnection::fail(std::string message) {
  if (terminal_ != Terminal::None || finished_) return;
  terminal_ = Terminal::Failed;
  terminal_reason_ = std::move(message);
  message_reserved_ = false;
  clear_stream();
}

void GodotWebSocketConnection::closed(int code) {
  if (terminal_ != Terminal::None || finished_) return;
  terminal_ = Terminal::Closed;
  message_reserved_ = false;
  received_close_code_ = code;
}

void GodotWebSocketConnection::dispatch_terminal() {
  if (terminal_ == Terminal::None || !event_budget_ || *event_budget_ == 0) return;
  --*event_budget_;
  const auto terminal = terminal_;
  terminal_ = Terminal::None;
  finished_ = true;
  clear_stream();
  if (terminal == Terminal::Closed) listener_.on_closed(websocket::reported_close_code(received_close_code_), std::move(terminal_reason_));
  else listener_.on_failure(std::move(terminal_reason_));
}

void GodotWebSocketConnection::clear_stream() {
  if (connector_.is_valid()) connector_->close();
  stream_.unref();
}

ssize_t GodotWebSocketConnection::receive(wslay_event_context_ptr ctx, uint8_t *buffer, size_t length, int, void *user_data) {
  auto &self = *static_cast<GodotWebSocketConnection *>(user_data);
  if (self.cancel_requested_ || length == 0 || self.stream_.is_null() || !self.byte_budget_ || *self.byte_budget_ == 0 ||
      (!self.message_reserved_ && (!self.event_budget_ || *self.event_budget_ == 0))) {
    wslay_event_set_error(ctx, WSLAY_ERR_WOULDBLOCK);
    return -1;
  }
  size_t requested = std::min(length, *self.byte_budget_);
  if (self.frame_started_) requested = std::min(requested, static_cast<size_t>(self.frame_payload_remaining_));
  else requested = std::min(requested, size_t{1});
  if (requested == 0) {
    wslay_event_set_error(ctx, WSLAY_ERR_WOULDBLOCK);
    return -1;
  }
  size_t received = 0;
  if (!self.read_stream(buffer, requested, received)) {
    wslay_event_set_error(ctx, WSLAY_ERR_CALLBACK_FAILURE);
    return -1;
  }
  if (received == 0) {
    wslay_event_set_error(ctx, WSLAY_ERR_WOULDBLOCK);
    return -1;
  }
  return static_cast<ssize_t>(received);
}

ssize_t GodotWebSocketConnection::transmit(wslay_event_context_ptr ctx, const uint8_t *buffer, size_t length, int, void *user_data) {
  auto &self = *static_cast<GodotWebSocketConnection *>(user_data);
  size_t sent = 0;
  if (!self.write_stream(buffer, length, sent)) {
    wslay_event_set_error(ctx, WSLAY_ERR_CALLBACK_FAILURE);
    return -1;
  }
  if (sent == 0) {
    wslay_event_set_error(ctx, WSLAY_ERR_WOULDBLOCK);
    return -1;
  }
  return static_cast<ssize_t>(sent);
}

int GodotWebSocketConnection::generate_mask(wslay_event_context_ptr, uint8_t *buffer, size_t length, void *) {
  Ref<Crypto> crypto;
  crypto.instantiate();
  const auto mask = crypto->generate_random_bytes(static_cast<int32_t>(length));
  if (static_cast<size_t>(mask.size()) != length) return -1;
  std::memcpy(buffer, mask.ptr(), length);
  return 0;
}

void GodotWebSocketConnection::frame_start(wslay_event_context_ptr, const wslay_event_on_frame_recv_start_arg *arg, void *user_data) {
  auto &self = *static_cast<GodotWebSocketConnection *>(user_data);
  if (self.cancel_requested_) return;
  self.frame_started_ = true;
  self.frame_payload_remaining_ = arg->payload_length;
  if (arg->opcode == WSLAY_TEXT_FRAME || arg->opcode == WSLAY_BINARY_FRAME) {
    if (self.event_budget_ && *self.event_budget_ > 0) {
      --*self.event_budget_;
      self.message_reserved_ = true;
    } else self.fail("WebSocket message header was read without an admission slot");
  }
}

void GodotWebSocketConnection::frame_chunk(wslay_event_context_ptr, const wslay_event_on_frame_recv_chunk_arg *arg, void *user_data) {
  auto &self = *static_cast<GodotWebSocketConnection *>(user_data);
  self.frame_payload_remaining_ -= std::min<uint64_t>(self.frame_payload_remaining_, arg->data_length);
}

void GodotWebSocketConnection::frame_end(wslay_event_context_ptr, void *user_data) {
  auto &self = *static_cast<GodotWebSocketConnection *>(user_data);
  self.frame_started_ = false;
  self.frame_payload_remaining_ = 0;
}

void GodotWebSocketConnection::message(wslay_event_context_ptr, const wslay_event_on_msg_recv_arg *arg, void *user_data) {
  auto &self = *static_cast<GodotWebSocketConnection *>(user_data);
  if (self.cancel_requested_) return;
  if (arg->opcode == WSLAY_CONNECTION_CLOSE) {
    self.received_close_code_ = arg->status_code ? arg->status_code : websocket::close_no_status;
    self.terminal_reason_.clear();
    if (arg->msg_length > 2)
      self.terminal_reason_.assign(reinterpret_cast<const char *>(arg->msg + 2), arg->msg_length - 2);
  } else if (arg->opcode == WSLAY_TEXT_FRAME || arg->opcode == WSLAY_BINARY_FRAME) {
    if (!self.message_reserved_) {
      self.fail("WebSocket message completed without an admission slot");
      return;
    }
    WebSocketMessage received;
    received.text = arg->opcode == WSLAY_TEXT_FRAME;
    if (arg->msg_length) received.bytes.assign(reinterpret_cast<const char *>(arg->msg), arg->msg_length);
    self.listener_.on_message(std::move(received));
    self.message_reserved_ = false;
  }
}
}
