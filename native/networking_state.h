#pragma once

// Internal to the networking modules: the state the four modules of one application share (Networking, BlobModule,
// FileReaderModule, WebSocketModule), and the few helpers more than one of their translation units needs. Only
// networking_modules.cpp and websocket_module.cpp include it.

#include "blob_store.h"
#include "http_core.h"
#include "http_transport.h"
#include "websocket_module.h"
#include <ReactCommon/TurboModule.h>
#include <jsi/jsi.h>
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <random>
#include <string>
#include <utility>
#include <vector>

namespace fabric_godot {
// Shared by a request's queued events: once JS aborts the request, none of them
// may reach it, as RN's abortRequest sends nothing for a request it cancels.
struct RequestToken {
  bool cancelled{};
};

// Blobs whose JS objects were garbage collected, waiting for the main thread to release them. Hermes may finalize
// a host object on any thread, so a collector only queues the id here, and the queue outlives the application's state.
struct CollectedBlobs {
  std::mutex mutex;
  bool open{true};
  std::vector<std::string> ids;
  void push(std::string id) {
    const std::lock_guard<std::mutex> lock(mutex);
    if (open) ids.push_back(std::move(id));
  }
  std::vector<std::string> take() {
    const std::lock_guard<std::mutex> lock(mutex);
    return std::exchange(ids, {});
  }
  void close() {
    const std::lock_guard<std::mutex> lock(mutex);
    open = false;
    ids.clear();
  }
};

struct NetworkingState {
  struct Request {
    std::string response_type;
    std::shared_ptr<RequestToken> token;
    std::string content_type;
    std::string body;
  };
  bool active{true};
  std::unique_ptr<HttpTransport> transport;
  WebSocketState sockets;
  BlobStore blobs;
  // The invoker the events and promises of all four modules go through. It
  // refuses everything once the application stops.
  std::shared_ptr<facebook::react::CallInvoker> invoker;
  std::map<uint64_t, Request> requests;
  std::shared_ptr<CollectedBlobs> collected = std::make_shared<CollectedBlobs>();
  std::mt19937_64 random{std::random_device{}()};
  uint64_t sent{}, refused{}, aborted{}, responses{}, completions{}, failures{}, events_queued{}, events_delivered{},
      events_dropped{}, blob_handlers{}, cookie_clears{}, file_reads{}, file_failures{}, blobs_closed{}, blobs_collected{};
  void release_collected() {
    for (const auto &id : collected->take()) {
      if (blobs.release(id)) ++blobs_collected;
    }
  }
  void stop() {
    if (!active) return;
    active = false;
    // The transports go first: nothing they hold may report once the state is gone.
    transport->stop();
    sockets.stop();
    requests.clear();
    collected->close();
    blobs.clear();
  }
};

namespace networking {
namespace jsi = facebook::jsi;

inline std::optional<std::string> string_value(jsi::Runtime &rt, const jsi::Value &value) {
  return value.isString() ? std::optional<std::string>(value.getString(rt).utf8(rt)) : std::nullopt;
}
inline jsi::String js_string(jsi::Runtime &rt, const std::string &utf8) {
  // Wire bytes are not always valid UTF-8; JS strings must be.
  return jsi::String::createFromUtf8(rt, http::sanitize_utf8(utf8));
}

inline void deliver(jsi::Runtime &rt, const std::string &name, jsi::Value payload) {
  // The device emitter is where RN's NativeEventEmitter listens; a runtime that
  // has not created it yet has nobody to tell.
  const auto emitter = rt.global().getProperty(rt, "__rctDeviceEventEmitter");
  if (!emitter.isObject()) return;
  const auto object = emitter.getObject(rt);
  object.getPropertyAsFunction(rt, "emit").callWithThis(rt, object, jsi::String::createFromAscii(rt, name), std::move(payload));
}

using Payload = std::function<jsi::Value(jsi::Runtime &)>;
// Queues one device event. Events leave through the invoker in the order they
// were queued, and a stopped application or an aborted request drops them. The
// events of a request share its token; a socket's have none, and only the stop drops them.
inline void queue_event(const std::shared_ptr<NetworkingState> &state, const std::shared_ptr<RequestToken> &token, std::string name,
    Payload payload) {
  ++state->events_queued;
  state->invoker->invokeAsync([owner = std::weak_ptr<NetworkingState>(state), token, name = std::move(name),
      payload = std::move(payload)](jsi::Runtime &rt) {
    const auto state = owner.lock();
    if (!state) return;
    if (token && token->cancelled) {
      ++state->events_dropped;
      return;
    }
    ++state->events_delivered;
    deliver(rt, name, payload(rt));
  });
}
}
}
