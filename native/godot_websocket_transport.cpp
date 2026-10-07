#include "godot_websocket_transport.h"
#include "godot_websocket_connection.h"
#include "websocket_core.h"
#include <algorithm>
#include <chrono>
#include <map>
#include <vector>

namespace fabric_godot {
namespace {
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
    auto callbacks = std::make_shared<WebSocketListener>(std::move(listener));
    WebSocketListener observed;
    observed.on_open = [this, callbacks](std::string protocol) {
      ++opened_;
      callbacks->on_open(std::move(protocol));
    };
    observed.on_message = [this, callbacks](WebSocketMessage message) {
      (message.text ? text_in_ : binary_in_) += 1;
      bytes_in_ += message.bytes.size();
      callbacks->on_message(std::move(message));
    };
    observed.on_closed = [this, callbacks](int code, std::string reason) {
      ++closed_;
      callbacks->on_closed(code, std::move(reason));
    };
    observed.on_failure = [this, callbacks](std::string message) {
      ++failed_;
      callbacks->on_failure(std::move(message));
    };
    auto socket = std::make_shared<GodotWebSocketConnection>(std::move(request), std::move(observed), trusted_authorities_, now_);
    if (auto error = socket->start()) return error;
    sockets_.emplace(id, std::move(socket));
    ++started_;
    return std::nullopt;
  }

  WebSocketSend send(uint64_t id, const WebSocketMessage &message) override {
    const auto found = sockets_.find(id);
    if (found == sockets_.end()) return WebSocketSend::NotOpen;
    const auto result = found->second->send(message);
    if (result == WebSocketSend::Overflow) ++overflows_;
    else if (result == WebSocketSend::Sent) {
      (message.text ? text_out_ : binary_out_) += 1;
      bytes_out_ += message.bytes.size();
    } else ++send_errors_;
    return result;
  }

  void close(uint64_t id, int code, const std::string &reason) override {
    const auto found = sockets_.find(id);
    if (found != sockets_.end()) found->second->close(code, reason);
  }

  void cancel(uint64_t id) override {
    const auto found = sockets_.find(id);
    if (found == sockets_.end()) return;
    found->second->cancel();
    sockets_.erase(found);
    ++cancelled_;
  }

  void poll(std::size_t byte_budget, std::size_t event_budget) override {
    if (stopped_ || sockets_.empty()) return;
    ++polls_;
    const auto initial_byte_budget = byte_budget;
    const auto initial_messages = text_in_ + binary_in_;
    std::vector<uint64_t> ids;
    ids.reserve(sockets_.size());
    for (const auto &[id, socket] : sockets_) ids.push_back(id);
    poll_cursor_ %= ids.size();
    std::size_t messages_remaining = std::min(max_network_events_per_poll, event_budget);
    const auto initial_event_budget = messages_remaining;
    std::size_t budget = byte_budget;
    do {
      const auto round_budget = budget;
      const auto round_events = messages_remaining;
      for (std::size_t offset = 0; offset < ids.size(); ++offset) {
        const auto id = ids[(poll_cursor_ + offset) % ids.size()];
        const auto found = sockets_.find(id);
        if (found == sockets_.end()) continue;
        const auto socket = found->second;
        socket->poll(budget, messages_remaining);
        if (socket->take_close_timeout()) ++close_timeouts_;
        const auto current = sockets_.find(id);
        if (socket->finished() && current != sockets_.end() && current->second == socket) sockets_.erase(current);
      }
      if (round_budget == budget && round_events == messages_remaining) break;
    } while (budget > 0 && (messages_remaining > 0 || reserved_events() > 0));
    poll_cursor_ = (poll_cursor_ + 1) % ids.size();
    const auto consumed = initial_byte_budget - budget;
    max_events_admitted_per_poll_ = std::max(max_events_admitted_per_poll_, initial_event_budget - messages_remaining);
    max_messages_per_poll_ = std::max(max_messages_per_poll_,
        static_cast<std::size_t>(text_in_ + binary_in_ - initial_messages));
    max_bytes_per_poll_ = std::max(max_bytes_per_poll_, consumed);
    bytes_polled_ += consumed;
  }

  std::size_t reserved_events() const override {
    std::size_t count = 0;
    for (const auto &[id, socket] : sockets_) count += socket->reserved_events();
    return count;
  }

  void stop() override {
    stopped_ = true;
    for (auto &[id, socket] : sockets_) socket->cancel();
    cancelled_ += sockets_.size();
    sockets_.clear();
  }

  folly::dynamic snapshot() const override {
    uint64_t connecting = 0, open = 0, closing = 0;
    for (const auto &[id, socket] : sockets_) {
      if (socket->closing()) ++closing;
      else if (socket->open()) ++open;
      else ++connecting;
    }
    return folly::dynamic::object("transport", "godot-httpclient-wslay")("stopped", stopped_)("active", sockets_.size())
        ("connecting", connecting)("open", open)("closing", closing)("started", started_)("opened", opened_)
        ("closedByPeer", closed_)("failed", failed_)("cancelled", cancelled_)("closeTimeouts", close_timeouts_)
        ("overflows", overflows_)("sendErrors", send_errors_)
        ("messagesIn", folly::dynamic::object("text", text_in_)("binary", binary_in_)("bytes", bytes_in_))
        ("messagesOut", folly::dynamic::object("text", text_out_)("binary", binary_out_)("bytes", bytes_out_))
        ("polls", polls_)("bytesPolled", bytes_polled_)("maxBytesPerPoll", max_bytes_per_poll_)
        ("maxMessagesPerPoll", max_messages_per_poll_)("maxEventsAdmittedPerPoll", max_events_admitted_per_poll_);
  }

 private:
  TrustedAuthorities trusted_authorities_;
  MonotonicClock now_;
  std::map<uint64_t, std::shared_ptr<GodotWebSocketConnection>> sockets_;
  bool stopped_{};
  std::size_t poll_cursor_{};
  uint64_t started_{}, opened_{}, closed_{}, failed_{}, cancelled_{}, close_timeouts_{}, overflows_{}, send_errors_{}, polls_{};
  uint64_t text_in_{}, binary_in_{}, bytes_in_{}, text_out_{}, binary_out_{}, bytes_out_{};
  std::size_t max_bytes_per_poll_{};
  std::size_t max_messages_per_poll_{};
  std::size_t max_events_admitted_per_poll_{};
  uint64_t bytes_polled_{};
};
}

std::unique_ptr<WebSocketTransport> make_godot_websocket_transport(TrustedAuthorities trusted_authorities, MonotonicClock now) {
  return std::make_unique<GodotWebSocketTransport>(std::move(trusted_authorities), std::move(now));
}
}
