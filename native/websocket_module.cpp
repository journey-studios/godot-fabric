#include "websocket_module.h"
#include "networking_state.h"
#include "websocket_core.h"
#include "FBReactNativeSpecJSI.h"
#include <ReactCommon/TurboModule.h>
#include <jsi/jsi.h>
#include <cmath>
#include <functional>
#include <optional>
#include <utility>
#include <vector>

namespace rn = facebook::react;
namespace jsi = facebook::jsi;

namespace fabric_godot {
namespace {
using networking::js_string;
using networking::queue_event;
using networking::string_value;
using Phase = WebSocketState::Phase;

// A device event of a socket: one object that carries the socket's id, as RN's Android module sends it. Nothing aborts a
// socket's events the way an abort ends a request's: only the application's stop drops them.
void queue_socket_event(const std::shared_ptr<NetworkingState> &state, std::string name, double id,
    std::function<void(jsi::Runtime &, jsi::Object &)> fill) {
  queue_event(state, nullptr, std::move(name), [id, fill = std::move(fill)](jsi::Runtime &rt) {
    jsi::Object object(rt);
    object.setProperty(rt, "id", id);
    fill(rt, object);
    return jsi::Value(rt, object);
  });
}

void queue_socket_failed(const std::shared_ptr<NetworkingState> &state, double id, std::string message) {
  queue_socket_event(state, "websocketFailed", id, [message = std::move(message)](jsi::Runtime &rt, jsi::Object &object) {
    object.setProperty(rt, "message", js_string(rt, message));
  });
}

void queue_socket_closed(const std::shared_ptr<NetworkingState> &state, double id, int code, std::string reason) {
  queue_socket_event(state, "websocketClosed", id, [code, reason = std::move(reason)](jsi::Runtime &rt, jsi::Object &object) {
    object.setProperty(rt, "code", code);
    object.setProperty(rt, "reason", js_string(rt, reason));
  });
}

std::optional<uint64_t> socket_id(double value) {
  if (!std::isfinite(value) || value < 0 || std::floor(value) != value || value > 9007199254740991.0) return std::nullopt;
  return static_cast<uint64_t>(value);
}

// What the module does for a diagnostic RN's Android would log: a warning in JS, where the application can see it.
void warn(const std::shared_ptr<NetworkingState> &state, std::string message) {
  state->invoker->invokeAsync([message = std::move(message)](jsi::Runtime &rt) {
    const auto console = rt.global().getProperty(rt, "console");
    if (!console.isObject()) return;
    const auto object = console.getObject(rt);
    const auto function = object.getProperty(rt, "warn");
    if (function.isObject() && function.getObject(rt).isFunction(rt))
      function.getObject(rt).getFunction(rt).callWithThis(rt, object, js_string(rt, message));
  });
}

// WebSocketModule's send, sendBinary and ping, and BlobModule's sendOverSocket, end here, and so does what Android does for
// a socket that is not there: "This is a programmer error", a failure and a close that carry "client is null". The socket
// is unknown, still connecting, or already closed by JS; a socket the server closed is one JS has already stopped listening
// to, so those events reach nobody.
void transmit(const std::shared_ptr<NetworkingState> &state, double raw_id, WebSocketMessage message) {
  const auto id = socket_id(raw_id);
  const auto found = id ? state->sockets.phases.find(*id) : state->sockets.phases.end();
  if (found == state->sockets.phases.end() || found->second != Phase::Open) {
    ++state->sockets.programmer_errors;
    queue_socket_failed(state, raw_id, "client is null");
    queue_socket_closed(state, raw_id, 0, "client is null");
    if (id) state->sockets.blob_ids.erase(*id);
    return;
  }
  const auto size = message.bytes.size();
  switch (state->sockets.transport->send(*id, message)) {
    case WebSocketSend::Sent:
      ++state->sockets.sent;
      state->sockets.sent_bytes += size;
      break;
    case WebSocketSend::NotOpen:
      // OkHttp's send returns false for a socket that is closing, and raises nothing.
      ++state->sockets.dropped_sends;
      break;
    case WebSocketSend::Overflow:
      // OkHttp closes with 1001 instead of queueing past its limit.
      ++state->sockets.overflows;
      found->second = Phase::Closing;
      state->sockets.transport->close(*id, websocket::close_going_away, "");
      break;
  }
}

class NativeWebSocket final : public rn::NativeWebSocketModuleCxxSpec<NativeWebSocket> {
 public:
  NativeWebSocket(std::shared_ptr<NetworkingState> state)
      : rn::NativeWebSocketModuleCxxSpec<NativeWebSocket>(state->invoker), state_(std::move(state)) {}

  // WebSocketModule.connect. Whatever is wrong with the request is a websocketFailed event, the one thing a socket always
  // ends in: Android's module throws on the native modules thread for these, and iOS's raises the same event for a URL it
  // cannot read. Cookies are neither stored nor sent.
  void connect(jsi::Runtime &rt, std::string url, std::optional<jsi::Array> protocols, jsi::Object options, double socket) {
    live(rt);
    const auto id = socket_id(socket);
    if (!id) throw jsi::JSError(rt, "E_ARGUMENT: connect requires a nonnegative integer socket id");
    if (state_->sockets.phases.contains(*id)) throw jsi::JSError(rt, "E_SOCKET_DUPLICATE: socket " + std::to_string(*id) + " is already in use");
    ++state_->sockets.connects;
    const auto refuse = [&](const std::string &message) {
      ++state_->sockets.refused;
      queue_socket_failed(state_, socket, message);
    };
    std::string error;
    const auto endpoint = websocket::parse_endpoint(url, &error);
    if (!endpoint) return refuse(error);
    WebSocketRequest request;
    request.url = endpoint->url;
    bool has_origin = false;
    const auto headers = options.getProperty(rt, "headers");
    if (headers.isObject() && !headers.getObject(rt).isArray(rt) && !headers.getObject(rt).isFunction(rt)) {
      const auto object = headers.getObject(rt);
      const auto names = object.getPropertyNames(rt);
      for (size_t index = 0, count = names.size(rt); index < count; ++index) {
        const auto key = names.getValueAtIndex(rt, index).getString(rt);
        const auto value = string_value(rt, object.getProperty(rt, key));
        const auto name = key.utf8(rt);
        // "Ignoring: requested $key, value not a string".
        if (!value) {
          ++state_->sockets.ignored_headers;
          continue;
        }
        if (auto problem = websocket::check_header(name, *value)) return refuse(*problem);
        has_origin = has_origin || http::iequals(name, "origin");
        // The handshake's own headers are the engine's: OkHttp replaces what a caller gives for them, and no engine
        // lets a second Host through.
        if (websocket::owned_by_handshake(name)) {
          ++state_->sockets.dropped_headers;
          continue;
        }
        request.headers.emplace_back(name, *value);
      }
    }
    if (!has_origin) request.headers.emplace_back("origin", websocket::default_origin(url));
    if (protocols) {
      std::vector<std::string> offered;
      for (size_t index = 0, count = protocols->size(rt); index < count; ++index) {
        if (auto protocol = string_value(rt, protocols->getValueAtIndex(rt, index))) offered.push_back(std::move(*protocol));
      }
      request.protocols = websocket::usable_protocols(offered);
      if (!request.protocols.empty()) {
        if (auto problem = websocket::check_header("Sec-WebSocket-Protocol", websocket::join_protocols(request.protocols))) return refuse(*problem);
      }
    }
    const auto weak = std::weak_ptr<NetworkingState>(state_);
    WebSocketListener listener;
    listener.on_open = [weak, id = *id, socket](std::string protocol) {
      const auto state = weak.lock();
      if (!state) return;
      const auto found = state->sockets.phases.find(id);
      if (found == state->sockets.phases.end()) return;
      if (found->second == Phase::Connecting) found->second = Phase::Open;
      ++state->sockets.opened;
      queue_socket_event(state, "websocketOpen", socket, [protocol = std::move(protocol)](jsi::Runtime &rt, jsi::Object &object) {
        object.setProperty(rt, "protocol", js_string(rt, protocol));
      });
    };
    listener.on_message = [weak, id = *id, socket](WebSocketMessage message) {
      const auto state = weak.lock();
      if (!state || !state->sockets.phases.contains(id)) return;
      ++state->sockets.received;
      if (message.text) {
        queue_socket_event(state, "websocketMessage", socket, [text = std::move(message.bytes)](jsi::Runtime &rt, jsi::Object &object) {
          object.setProperty(rt, "type", jsi::String::createFromAscii(rt, "text"));
          object.setProperty(rt, "data", js_string(rt, text));
        });
      } else if (state->sockets.blob_ids.contains(id)) {
        // The blob stays in native memory; JS gets the BlobData to wrap and release.
        const auto blob_id = state->blobs.new_id();
        const auto size = message.bytes.size();
        state->blobs.store(blob_id, std::move(message.bytes));
        ++state->sockets.blob_received;
        queue_socket_event(state, "websocketMessage", socket, [blob_id, size](jsi::Runtime &rt, jsi::Object &object) {
          jsi::Object blob(rt);
          blob.setProperty(rt, "blobId", jsi::String::createFromAscii(rt, blob_id));
          blob.setProperty(rt, "offset", 0);
          blob.setProperty(rt, "size", static_cast<double>(size));
          object.setProperty(rt, "type", jsi::String::createFromAscii(rt, "blob"));
          object.setProperty(rt, "data", std::move(blob));
        });
      } else {
        queue_socket_event(state, "websocketMessage", socket, [encoded = http::base64_encode(message.bytes)](jsi::Runtime &rt, jsi::Object &object) {
          object.setProperty(rt, "type", jsi::String::createFromAscii(rt, "binary"));
          object.setProperty(rt, "data", jsi::String::createFromAscii(rt, encoded));
        });
      }
    };
    listener.on_closed = [weak, id = *id, socket](int code, std::string reason) {
      const auto state = weak.lock();
      if (!state) return;
      state->sockets.phases.erase(id);
      state->sockets.blob_ids.erase(id);
      ++state->sockets.closed;
      queue_socket_closed(state, socket, code, std::move(reason));
    };
    listener.on_failure = [weak, id = *id, socket](std::string message) {
      const auto state = weak.lock();
      if (!state) return;
      state->sockets.phases.erase(id);
      state->sockets.blob_ids.erase(id);
      ++state->sockets.failed;
      queue_socket_failed(state, socket, std::move(message));
    };
    state_->sockets.phases.emplace(*id, Phase::Connecting);
    if (auto problem = state_->sockets.transport->start(*id, std::move(request), std::move(listener))) {
      state_->sockets.phases.erase(*id);
      return refuse(*problem);
    }
  }

  // A late send after the application stopped finds nothing to say to: stopping is silent.
  void send(jsi::Runtime &, std::string message, double socket) {
    if (!state_->active) return;
    transmit(state_, socket, WebSocketMessage{true, std::move(message)});
  }

  void sendBinary(jsi::Runtime &, std::string base64, double socket) {
    if (!state_->active) return;
    const auto id = socket_id(socket);
    const auto found = id ? state_->sockets.phases.find(*id) : state_->sockets.phases.end();
    if (found == state_->sockets.phases.end() || found->second != Phase::Open) return transmit(state_, socket, {});
    const auto bytes = http::base64_decode(base64);
    if (!bytes) {
      // Android's "bytes == null": the failure is the socket's last event, so the socket itself ends with it.
      queue_socket_failed(state_, socket, "bytes == null");
      ++state_->sockets.failed;
      state_->sockets.transport->cancel(*id);
      state_->sockets.phases.erase(*id);
      state_->sockets.blob_ids.erase(*id);
      return;
    }
    transmit(state_, socket, WebSocketMessage{false, *bytes});
  }

  // Android's ping is an empty binary message, not a ping frame; the engine answers the server's own pings by itself.
  void ping(jsi::Runtime &, double socket) {
    if (!state_->active) return;
    transmit(state_, socket, WebSocketMessage{false, {}});
  }

  // WebSocketModule.close: a socket that is not open is "already closed" and nothing happens, and OkHttp refuses a code
  // that is reserved or out of range and a reason longer than 123 bytes, which Android catches and logs, leaving the socket
  // as it was. A socket that is still connecting is the one place this differs: Android has not registered it yet, so its
  // close does nothing and the socket opens anyway and stays open; here the attempt ends, as a web client's does, with a
  // failure, so that every connect ends in a close or a failure.
  void close(jsi::Runtime &, double code, std::string reason, double socket) {
    if (!state_->active) return;
    const auto id = socket_id(socket);
    const auto found = id ? state_->sockets.phases.find(*id) : state_->sockets.phases.end();
    if (found == state_->sockets.phases.end() || found->second == Phase::Closing) return;
    if (found->second == Phase::Connecting) {
      ++state_->sockets.connecting_closes;
      found->second = Phase::Closing;
      state_->sockets.blob_ids.erase(*id);
      state_->sockets.transport->close(*id, websocket::close_going_away, "");
      return;
    }
    if (const auto problem = websocket::check_close(code, reason)) {
      ++state_->sockets.close_rejections;
      warn(state_, "Could not close WebSocket connection for id " + std::to_string(*id) + ": " + *problem);
      return;
    }
    found->second = Phase::Closing;
    state_->sockets.blob_ids.erase(*id);
    state_->sockets.transport->close(*id, websocket::close_code_of(code), reason);
  }

  // RCTEventEmitter's pair; RN's WebSocket hands this module to no emitter on this platform.
  void addListener(jsi::Runtime &, jsi::String) {}
  void removeListeners(jsi::Runtime &, double) {}

 private:
  std::shared_ptr<NetworkingState> state_;
  void live(jsi::Runtime &rt) const {
    if (!state_->active) throw jsi::JSError(rt, "E_MODULE_DISPOSED: WebSocketModule");
  }
};
}

std::string websocket_module_name() { return std::string(NativeWebSocket::kModuleName); }

std::shared_ptr<rn::TurboModule> make_websocket_module(std::shared_ptr<NetworkingState> state) {
  return std::make_shared<NativeWebSocket>(std::move(state));
}

void send_blob_over_socket(const std::shared_ptr<NetworkingState> &state, double socket, std::optional<std::string> bytes) {
  if (!bytes) {
    ++state->sockets.blob_missing;
    return;
  }
  ++state->sockets.blob_sent;
  transmit(state, socket, WebSocketMessage{false, std::move(*bytes)});
}

void WebSocketState::set_blob_handler(double socket, bool enabled) {
  ++blob_handler_changes;
  const auto id = socket_id(socket);
  if (!id) return;
  if (enabled) blob_ids.insert(*id);
  else blob_ids.erase(*id);
}

void WebSocketState::stop() {
  transport->stop();
  phases.clear();
  blob_ids.clear();
}

folly::dynamic WebSocketState::snapshot() const {
  uint64_t connecting = 0, open = 0, closing = 0;
  for (const auto &entry : phases) {
    switch (entry.second) {
      case Phase::Connecting: ++connecting; break;
      case Phase::Open: ++open; break;
      case Phase::Closing: ++closing; break;
    }
  }
  return folly::dynamic::object("transport", transport->snapshot())
      ("sockets", folly::dynamic::object("connecting", connecting)("open", open)("closing", closing)("blobHandlers", blob_ids.size()))
      ("connects", connects)("refused", refused)("opened", opened)("closed", closed)
      ("failed", failed)("sent", sent)("sentBytes", sent_bytes)("droppedSends", dropped_sends)
      ("overflows", overflows)("received", received)("blobMessages", blob_received)
      ("programmerErrors", programmer_errors)("closeRejections", close_rejections)
      ("connectingCloses", connecting_closes)("ignoredHeaders", ignored_headers)
      ("droppedHeaders", dropped_headers)("blobSends", blob_sent)("blobSendsMissing", blob_missing)
      ("blobHandlerChanges", blob_handler_changes);
}
}
