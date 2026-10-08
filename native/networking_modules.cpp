#include "networking_modules.h"
#include "networking_state.h"
#include "blob_store.h"
#include "http_core.h"
#include "stoppable_invoker.h"
#include "turbo_module_registry.h"
#include "FBReactNativeSpecJSI.h"
#include <ReactCommon/TurboModule.h>
#include <jsi/jsi.h>
#include <react/bridging/Bridging.h>
#include <react/bridging/Promise.h>
#include <cmath>
#include <optional>
#include <random>
#include <stdexcept>
#include <utility>
#include <vector>

namespace rn = facebook::react;
namespace jsi = facebook::jsi;

namespace fabric_godot {
namespace {
using networking::Payload;
using networking::js_string;
using networking::queue_event;
using networking::string_value;

std::string upper(std::string text) {
  for (auto &c : text) c = c >= 'a' && c <= 'z' ? static_cast<char>(c - 'a' + 'A') : c;
  return text;
}

std::optional<std::string> string_property(jsi::Runtime &rt, const jsi::Object &object, const char *name) {
  return string_value(rt, object.getProperty(rt, name));
}

// BlobManager's BlobData: {blobId, offset, size, type?, name?, ...}.
struct BlobRef {
  std::string id;
  double offset{0};
  double size{-1};
  std::optional<std::string> type;
};
std::optional<BlobRef> blob_ref(jsi::Runtime &rt, const jsi::Object &object) {
  auto id = string_property(rt, object, "blobId");
  if (!id) return std::nullopt;
  BlobRef ref;
  ref.id = std::move(*id);
  if (const auto offset = object.getProperty(rt, "offset"); offset.isNumber()) ref.offset = offset.getNumber();
  if (const auto size = object.getProperty(rt, "size"); size.isNumber()) ref.size = size.getNumber();
  ref.type = string_property(rt, object, "type");
  return ref;
}
// The explanation of a blob that cannot be read, or nullopt with the bytes in `view`.
std::optional<std::string> resolve_blob(const NetworkingState &state, const BlobRef &ref, BlobStore::View &view) {
  switch (state.blobs.resolve(ref.id, ref.offset, ref.size, view)) {
    case BlobStore::Resolution::Found: return std::nullopt;
    case BlobStore::Resolution::Missing: return "The specified blob is invalid";
    case BlobStore::Resolution::OutOfRange: return "The requested range lies outside the specified blob";
  }
  return "The specified blob is invalid";
}

// Headers: [[name, value], ...] as RCTNetworking.android.js converts them.
std::optional<std::string> read_headers(jsi::Runtime &rt, const jsi::Array &array, http::Headers &headers, const char *invalid) {
  for (size_t index = 0, count = array.size(rt); index < count; ++index) {
    const auto entry = array.getValueAtIndex(rt, index);
    if (!entry.isObject() || !entry.getObject(rt).isArray(rt)) return invalid;
    const auto pair = entry.getObject(rt).getArray(rt);
    if (pair.size(rt) != 2) return invalid;
    const auto name = string_value(rt, pair.getValueAtIndex(rt, 0));
    const auto value = string_value(rt, pair.getValueAtIndex(rt, 1));
    if (!name || !value) return invalid;
    // Android strips a name down to printable ASCII before OkHttp sees it.
    auto stripped = http::strip_header_name(*name);
    if (!http::valid_header_name(stripped)) return "Unexpected char in header name: \"" + stripped + "\"";
    if (!http::valid_header_value(*value)) return "Unexpected char in the value of header \"" + stripped + "\"";
    headers.emplace_back(std::move(stripped), *value);
  }
  return std::nullopt;
}

std::optional<std::string> encode_for(const std::string &text, const std::string &content_type, std::string &out) {
  const auto charset_name = http::media_type_parameter(content_type, "charset");
  const auto charset = http::charset_from_name(charset_name);
  const auto bytes = charset == http::Charset::Unknown ? std::nullopt : http::encode_text(text, charset);
  if (!bytes) return "Unsupported charset \"" + charset_name + "\": this host writes UTF-8, ISO-8859-1 and US-ASCII request bodies";
  out = *bytes;
  return std::nullopt;
}

std::string random_boundary(std::mt19937_64 &random) {
  static constexpr char digits[] = "0123456789abcdef";
  std::string boundary = "----GodotFabricFormBoundary";
  for (int index = 0; index < 24; ++index) boundary.push_back(digits[random() & 15u]);
  return boundary;
}

constexpr const char *uri_unsupported =
    "Request bodies and FormData parts that refer to a uri are not supported by this host yet";

// A multipart body from RN's FormData parts. String parts only: a part with a uri
// is a file, and files are not read by this host yet.
std::optional<std::string> build_form_data(jsi::Runtime &rt, const jsi::Array &parts, const std::string &content_type,
    std::mt19937_64 &random, http::Headers &headers, std::string &body) {
  std::string essence = "multipart/form-data";
  if (!content_type.empty()) {
    essence = http::media_type_essence(content_type);
    if (essence.rfind("multipart/", 0) != 0) return "Invalid media type.";
  }
  std::vector<http::MultipartPart> list;
  for (size_t index = 0, count = parts.size(rt); index < count; ++index) {
    const auto entry = parts.getValueAtIndex(rt, index);
    if (!entry.isObject()) return "Unrecognized FormData part.";
    const auto part = entry.getObject(rt);
    const auto part_headers = part.getProperty(rt, "headers");
    http::MultipartPart item;
    if (!part_headers.isObject() || !part_headers.getObject(rt).isArray(rt)) return "Missing or invalid header format for FormData part.";
    http::Headers raw;
    if (auto error = read_headers(rt, part_headers.getObject(rt).getArray(rt), raw, "Missing or invalid header format for FormData part."))
      return error;
    // The part's content type is written explicitly, after its other headers.
    if (const auto *type = http::find_header(raw, "content-type")) item.content_type = *type;
    http::remove_headers(raw, "content-type");
    item.headers = std::move(raw);
    if (const auto text = string_property(rt, part, "string")) {
      if (auto error = encode_for(*text, item.content_type.value_or(""), item.body)) return error;
    } else if (part.hasProperty(rt, "uri")) {
      return uri_unsupported;
    } else {
      return "Unrecognized FormData part.";
    }
    list.push_back(std::move(item));
  }
  const auto boundary = random_boundary(random);
  body = http::build_multipart(boundary, list);
  http::remove_headers(headers, "content-type");
  headers.emplace_back("content-type", essence + "; boundary=" + boundary);
  return std::nullopt;
}

// The request body from RN's `data` object, in the order Android's
// NetworkingModule tries them: a blob, a string, base64, a uri and form data.
std::optional<std::string> build_body(jsi::Runtime &rt, NetworkingState &state, const jsi::Object &data,
    http::Headers &headers, std::string &body) {
  const auto *type_header = http::find_header(headers, "content-type");
  const std::string content_type = type_header ? *type_header : std::string();
  const auto blob = data.getProperty(rt, "blob");
  const auto text = data.getProperty(rt, "string");
  const auto base64 = data.getProperty(rt, "base64");
  const auto form = data.getProperty(rt, "formData");
  const bool is_string = data.hasProperty(rt, "string");
  // Android sanitizes Content-Encoding for every body but a string.
  if (!is_string || !blob.isUndefined()) http::remove_headers(headers, "content-encoding");
  if (blob.isObject()) {
    const auto ref = blob_ref(rt, blob.getObject(rt));
    if (!ref) return "The specified blob does not contain a blobId";
    BlobStore::View view;
    if (auto error = resolve_blob(state, *ref, view)) return error;
    body = std::string(view.bytes());
    if (!type_header) {
      // The web sends a Blob with its own type; without one it is a stream of bytes.
      const auto &type = ref->type;
      headers.emplace_back("content-type", type && !type->empty() ? *type : "application/octet-stream");
    }
    return std::nullopt;
  }
  if (is_string) {
    if (content_type.empty()) return "Payload is set but no content-type header specified";
    const auto value = string_value(rt, text);
    if (!value) return "Received request but body was empty";
    if (const auto *encoding = http::find_header(headers, "content-encoding"); encoding && http::iequals(http::trim(*encoding), "gzip"))
      return "Unsupported Content-Encoding \"gzip\" on a request: this host does not compress request bodies";
    return encode_for(*value, content_type, body);
  }
  if (data.hasProperty(rt, "base64")) {
    if (content_type.empty()) return "Payload is set but no content-type header specified";
    const auto value = string_value(rt, base64);
    const auto decoded = value ? http::base64_decode(*value) : std::nullopt;
    if (!decoded) return "Request body base64 string was invalid";
    body = *decoded;
    return std::nullopt;
  }
  if (data.hasProperty(rt, "uri")) return uri_unsupported;
  if (form.isObject() && form.getObject(rt).isArray(rt))
    return build_form_data(rt, form.getObject(rt).getArray(rt), content_type, state.random, headers, body);
  if (data.hasProperty(rt, "formData")) return "Received request but form data was empty";
  return std::nullopt;  // nothing in the payload that could be understood: an empty body
}

// [requestId, error] with the time-out flag Android appends only for a time-out.
void queue_failure(const std::shared_ptr<NetworkingState> &state, const std::shared_ptr<RequestToken> &token, uint64_t id,
    std::string message, bool timed_out) {
  ++state->failures;
  queue_event(state, token, "didCompleteNetworkResponse", [id, message = std::move(message), timed_out](jsi::Runtime &rt) {
    auto result = jsi::Array(rt, timed_out ? 3 : 2);
    result.setValueAtIndex(rt, 0, jsi::Value(static_cast<double>(id)));
    result.setValueAtIndex(rt, 1, js_string(rt, message));
    if (timed_out) result.setValueAtIndex(rt, 2, jsi::Value(true));
    return jsi::Value(rt, result);
  });
}

// RN's native half of BlobManager's collector: a host object that lives as long as the JS Blob objects sharing it,
// and tells the module to release the bytes when the garbage collector frees it. Without it every response blob of
// every fetch would stay in native memory until the application stopped.
class BlobCollector final : public jsi::HostObject {
 public:
  BlobCollector(std::shared_ptr<CollectedBlobs> collected, std::string id) : collected_(std::move(collected)), id_(std::move(id)) {}
  ~BlobCollector() override { collected_->push(std::move(id_)); }

 private:
  std::shared_ptr<CollectedBlobs> collected_;
  std::string id_;
};

void install_blob_collector(jsi::Runtime &rt, const std::shared_ptr<NetworkingState> &state) {
  rt.global().setProperty(rt, "__blobCollectorProvider", jsi::Function::createFromHostFunction(rt,
      jsi::PropNameID::forAscii(rt, "__blobCollectorProvider"), 1,
      [weak = std::weak_ptr<NetworkingState>(state)](jsi::Runtime &runtime, const jsi::Value &, const jsi::Value *args, size_t count) -> jsi::Value {
        const auto owner = weak.lock();
        // After the application stopped there is no store left to release into, and a blob needs no collector.
        if (!owner || !owner->active || count < 1 || !args[0].isString()) return jsi::Value::null();
        const auto id = args[0].getString(runtime).utf8(runtime);
        auto collector = jsi::Object::createFromHostObject(runtime, std::make_shared<BlobCollector>(owner->collected, id));
        // The garbage collector learns how much native memory the blob holds, so a big one is collected sooner.
        collector.setExternalMemoryPressure(runtime, owner->blobs.size_of(id));
        return jsi::Value(runtime, collector);
      }));
}

class NativeNetworking final : public rn::NativeNetworkingAndroidCxxSpec<NativeNetworking> {
 public:
  NativeNetworking(std::shared_ptr<NetworkingState> state)
      : rn::NativeNetworkingAndroidCxxSpec<NativeNetworking>(state->invoker), state_(std::move(state)) {}

  void sendRequest(jsi::Runtime &rt, std::string method, std::string url, double request_id, jsi::Array headers_array,
      jsi::Object data, std::string response_type, bool /*incremental_updates*/, double timeout, bool /*with_credentials*/) {
    live(rt);
    if (!std::isfinite(request_id) || request_id < 0 || std::floor(request_id) != request_id || request_id > 9007199254740991.0)
      throw jsi::JSError(rt, "E_ARGUMENT: sendRequest requires a nonnegative integer request id");
    const auto id = static_cast<uint64_t>(request_id);
    if (state_->requests.contains(id))
      throw jsi::JSError(rt, "E_REQUEST_DUPLICATE: request " + std::to_string(id) + " is already in flight");
    // Problems with the request are events, as they are on Android: the JS wrapper
    // has not yet told the caller the request id when sendRequest returns.
    const auto token = std::make_shared<RequestToken>();
    const auto refuse = [&](const std::string &message) {
      ++state_->refused;
      queue_failure(state_, token, id, message, false);
    };
    if (response_type != "text" && response_type != "base64" && response_type != "blob") return refuse("Invalid response type: " + response_type);
    if (!std::isfinite(timeout) || timeout < 0) return refuse("Invalid timeout: " + std::to_string(timeout));
    HttpRequest request;
    request.method = upper(std::move(method));
    request.url = std::move(url);
    request.timeout_ms = timeout;
    if (auto error = read_headers(rt, headers_array, request.headers, "Unrecognized headers format")) return refuse(*error);
    if (request.method != "GET" && request.method != "HEAD") {
      if (auto error = build_body(rt, *state_, data, request.headers, request.body)) return refuse(*error);
    }
    const auto weak = std::weak_ptr<NetworkingState>(state_);
    HttpListener listener;
    listener.on_head = [weak, id](HttpResponseHead head) {
      const auto state = weak.lock();
      if (!state) return;
      const auto found = state->requests.find(id);
      if (found == state->requests.end()) return;
      if (const auto *type = http::find_header(head.headers, "content-type")) found->second.content_type = *type;
      ++state->responses;
      queue_event(state, found->second.token, "didReceiveNetworkResponse",
          [id, status = head.status, headers = http::join_duplicate_headers(head.headers), url = std::move(head.url)](jsi::Runtime &rt) {
            jsi::Object object(rt);
            for (const auto &[name, value] : headers)
              object.setProperty(rt, jsi::PropNameID::forUtf8(rt, http::sanitize_utf8(name)), js_string(rt, value));
            auto result = jsi::Array(rt, 4);
            result.setValueAtIndex(rt, 0, jsi::Value(static_cast<double>(id)));
            result.setValueAtIndex(rt, 1, jsi::Value(status));
            result.setValueAtIndex(rt, 2, std::move(object));
            result.setValueAtIndex(rt, 3, js_string(rt, url));
            return jsi::Value(rt, result);
          });
    };
    listener.on_body = [weak, id](std::string chunk) {
      const auto state = weak.lock();
      if (!state) return;
      const auto found = state->requests.find(id);
      if (found != state->requests.end()) found->second.body += chunk;
    };
    listener.on_failure = [weak, id](HttpFailure failure) {
      const auto state = weak.lock();
      if (!state) return;
      const auto found = state->requests.find(id);
      if (found == state->requests.end()) return;
      const auto token = found->second.token;
      state->requests.erase(found);
      queue_failure(state, token, id, std::move(failure.message), failure.timed_out);
    };
    listener.on_complete = [weak, id]() {
      const auto state = weak.lock();
      if (!state) return;
      const auto found = state->requests.find(id);
      if (found == state->requests.end()) return;
      auto request = std::move(found->second);
      state->requests.erase(found);
      ++state->completions;
      Payload data_payload;
      if (request.response_type == "text") {
        // OkHttp's string(): the Content-Type's charset, UTF-8 when it has none,
        // and a byte order mark wins over both.
        const auto charset = http::charset_from_name(http::media_type_parameter(request.content_type, "charset"));
        data_payload = [id, text = http::decode_text(request.body, charset, true)](jsi::Runtime &rt) {
          auto result = jsi::Array(rt, 2);
          result.setValueAtIndex(rt, 0, jsi::Value(static_cast<double>(id)));
          result.setValueAtIndex(rt, 1, js_string(rt, text));
          return jsi::Value(rt, result);
        };
      } else if (request.response_type == "base64") {
        data_payload = [id, encoded = http::base64_encode(request.body)](jsi::Runtime &rt) {
          auto result = jsi::Array(rt, 2);
          result.setValueAtIndex(rt, 0, jsi::Value(static_cast<double>(id)));
          result.setValueAtIndex(rt, 1, jsi::String::createFromAscii(rt, encoded));
          return jsi::Value(rt, result);
        };
      } else {
        // The blob stays in native memory; JS gets the BlobData to wrap and release.
        const auto blob_id = state->blobs.new_id();
        const auto size = request.body.size();
        state->blobs.store(blob_id, std::move(request.body));
        data_payload = [id, blob_id, size, type = request.content_type](jsi::Runtime &rt) {
          jsi::Object blob(rt);
          blob.setProperty(rt, "blobId", jsi::String::createFromAscii(rt, blob_id));
          blob.setProperty(rt, "offset", 0);
          blob.setProperty(rt, "size", static_cast<double>(size));
          // As on the web, the blob's type is the response's Content-Type, parameters included.
          if (!type.empty()) blob.setProperty(rt, "type", js_string(rt, type));
          auto result = jsi::Array(rt, 2);
          result.setValueAtIndex(rt, 0, jsi::Value(static_cast<double>(id)));
          result.setValueAtIndex(rt, 1, std::move(blob));
          return jsi::Value(rt, result);
        };
      }
      queue_event(state, request.token, "didReceiveNetworkData", std::move(data_payload));
      queue_event(state, request.token, "didCompleteNetworkResponse", [id](jsi::Runtime &rt) {
        auto result = jsi::Array(rt, 2);
        result.setValueAtIndex(rt, 0, jsi::Value(static_cast<double>(id)));
        result.setValueAtIndex(rt, 1, jsi::Value::null());
        return jsi::Value(rt, result);
      });
    };
    state_->requests.emplace(id, NetworkingState::Request{response_type, token, {}, {}});
    if (auto error = state_->transport->start(id, std::move(request), std::move(listener))) {
      state_->requests.erase(id);
      return refuse(*error);
    }
    ++state_->sent;
  }

  void abortRequest(jsi::Runtime &, double request_id) {
    // Late cleanup stays safe after the application stopped.
    if (!state_->active || !(request_id >= 0)) return;
    const auto found = state_->requests.find(static_cast<uint64_t>(request_id));
    if (found == state_->requests.end()) return;
    found->second.token->cancelled = true;
    state_->transport->cancel(found->first);
    state_->requests.erase(found);
    ++state_->aborted;
  }

  // Nothing is stored, so there is never a cookie to remove.
  void clearCookies(jsi::Runtime &rt, rn::AsyncCallback<bool> callback) {
    live(rt);
    ++state_->cookie_clears;
    callback(false);
  }
  // RCTEventEmitter's pair; RCTNetworking.android.js hands this module to no emitter on this platform.
  void addListener(jsi::Runtime &, jsi::String) {}
  void removeListeners(jsi::Runtime &, double) {}

 private:
  std::shared_ptr<NetworkingState> state_;
  void live(jsi::Runtime &rt) const {
    if (!state_->active) throw jsi::JSError(rt, "E_MODULE_DISPOSED: Networking");
  }
};

class NativeBlobModule final : public rn::NativeBlobModuleCxxSpec<NativeBlobModule> {
 public:
  NativeBlobModule(std::shared_ptr<NetworkingState> state)
      : rn::NativeBlobModuleCxxSpec<NativeBlobModule>(state->invoker), state_(std::move(state)) {}

  // iOS's choice: Android's depends on a ContentProvider authority this host has
  // none of. URL.createObjectURL(blob) therefore reads blob:<id>?offset=..&size=..
  jsi::Object getConstants(jsi::Runtime &rt) {
    live(rt);
    jsi::Object constants(rt);
    constants.setProperty(rt, "BLOB_URI_SCHEME", jsi::String::createFromAscii(rt, "blob"));
    constants.setProperty(rt, "BLOB_URI_HOST", jsi::Value::null());
    return constants;
  }
  // The Networking module of this host understands blob bodies and responses
  // from the start; RN's JS only announces that it may be asked for them.
  void addNetworkingHandler(jsi::Runtime &rt) {
    live(rt);
    ++state_->blob_handlers;
  }
  // BlobModule's content handler for a socket: its binary messages arrive as blobs in the shared store instead of base64.
  void addWebSocketHandler(jsi::Runtime &rt, double socket) {
    live(rt);
    state_->sockets.set_blob_handler(socket, true);
  }
  // Late cleanup (WebSocket.close() calls it after the application stopped, too) stays harmless.
  void removeWebSocketHandler(jsi::Runtime &, double socket) {
    if (!state_->active) return;
    state_->sockets.set_blob_handler(socket, false);
  }
  // The bytes of a blob, sent as one binary message. Android sends nothing for a blob it does not hold, and so does this.
  void sendOverSocket(jsi::Runtime &rt, jsi::Object blob, double socket) {
    live(rt);
    const auto ref = blob_ref(rt, blob);
    BlobStore::View view;
    const bool held = ref && !resolve_blob(*state_, *ref, view);
    send_blob_over_socket(state_, socket, held ? std::optional<std::string>(std::string(view.bytes())) : std::nullopt);
  }

  void createFromParts(jsi::Runtime &rt, jsi::Array parts, jsi::String blob_id) {
    live(rt);
    const auto id = blob_id.utf8(rt);
    if (id.empty()) throw jsi::JSError(rt, "E_ARGUMENT: createFromParts requires a blob id");
    std::string bytes;
    for (size_t index = 0, count = parts.size(rt); index < count; ++index) {
      const auto entry = parts.getValueAtIndex(rt, index);
      if (!entry.isObject()) throw jsi::JSError(rt, "E_ARGUMENT: a blob part must be an object");
      const auto part = entry.getObject(rt);
      const auto type = string_property(rt, part, "type").value_or("");
      if (type == "blob") {
        const auto data = part.getProperty(rt, "data");
        const auto ref = data.isObject() ? blob_ref(rt, data.getObject(rt)) : std::nullopt;
        if (!ref) throw jsi::JSError(rt, "E_INVALID_BLOB: The specified blob does not contain a blobId");
        BlobStore::View view;
        if (const auto error = resolve_blob(*state_, *ref, view)) throw jsi::JSError(rt, "E_INVALID_BLOB: " + *error);
        bytes.append(view.bytes());
      } else if (type == "string") {
        const auto text = string_property(rt, part, "data");
        if (!text) throw jsi::JSError(rt, "E_ARGUMENT: a string blob part requires its data");
        bytes.append(*text);
      } else {
        throw jsi::JSError(rt, "E_ARGUMENT: Invalid type for blob: " + type);
      }
    }
    state_->blobs.store(id, std::move(bytes));
  }

  void release(jsi::Runtime &rt, jsi::String blob_id) {
    // Releasing a Blob after the application stopped is harmless: the store is already empty.
    if (!state_->active) return;
    if (state_->blobs.release(blob_id.utf8(rt))) ++state_->blobs_closed;
  }

 private:
  std::shared_ptr<NetworkingState> state_;
  void live(jsi::Runtime &rt) const {
    if (!state_->active) throw jsi::JSError(rt, "E_MODULE_DISPOSED: BlobModule");
  }
};

class NativeFileReader final : public rn::NativeFileReaderModuleCxxSpec<NativeFileReader> {
 public:
  NativeFileReader(std::shared_ptr<NetworkingState> state)
      : rn::NativeFileReaderModuleCxxSpec<NativeFileReader>(state->invoker), state_(std::move(state)) {}

  jsi::Value readAsText(jsi::Runtime &rt, jsi::Object blob, jsi::String encoding) {
    return read(rt, blob, [&](std::string_view bytes, const BlobRef &, rn::AsyncPromise<std::string> &promise) {
      const auto name = encoding.utf8(rt);
      const auto charset = http::charset_from_name(name);
      if (charset == http::Charset::Unknown) return promise.reject("E_UNSUPPORTED_ENCODING: this host decodes UTF-8, ISO-8859-1, US-ASCII and UTF-16, not \"" + name + "\"");
      promise.resolve(http::decode_text(bytes, charset, false));
    });
  }
  jsi::Value readAsDataURL(jsi::Runtime &rt, jsi::Object blob) {
    return read(rt, blob, [&](std::string_view bytes, const BlobRef &ref, rn::AsyncPromise<std::string> &promise) {
      const auto type = ref.type && !ref.type->empty() ? *ref.type : "application/octet-stream";
      promise.resolve("data:" + type + ";base64," + http::base64_encode(bytes));
    });
  }

 private:
  std::shared_ptr<NetworkingState> state_;

  template <typename Settle>
  jsi::Value read(jsi::Runtime &rt, const jsi::Object &blob, Settle settle) {
    if (!state_->active) throw jsi::JSError(rt, "E_MODULE_DISPOSED: FileReaderModule");
    rn::AsyncPromise<std::string> promise(rt, jsInvoker_);
    ++state_->file_reads;
    const auto ref = blob_ref(rt, blob);
    BlobStore::View view;
    std::optional<std::string> problem;
    if (!ref) problem = "The specified blob does not contain a blobId";
    else problem = resolve_blob(*state_, *ref, view);
    if (problem) {
      ++state_->file_failures;
      promise.reject("E_INVALID_BLOB: " + *problem);
    } else {
      settle(view.bytes(), *ref, promise);
    }
    return jsi::Value(rt, promise.get(rt));
  }
};
}

Networking::Networking(std::unique_ptr<HttpTransport> http, std::unique_ptr<WebSocketTransport> sockets)
    : state_(std::make_shared<NetworkingState>()) {
  if (!http) throw std::invalid_argument("Networking requires an HTTP transport");
  if (!sockets) throw std::invalid_argument("Networking requires a WebSocket transport");
  state_->transport = std::move(http);
  state_->sockets.transport = std::move(sockets);
}
Networking::~Networking() { state_->stop(); }

void Networking::install(TurboModuleRegistry &registry) {
  const auto state = state_;
  // Every module of the four binds the same invoker, created when the first is.
  const auto bind = [state](const std::shared_ptr<rn::CallInvoker> &invoker) {
    if (!state->invoker) state->invoker = std::make_shared<StoppableInvoker<NetworkingState>>(invoker, state);
  };
  const auto dispose = [state] { state->stop(); };
  registry.add(std::string(NativeNetworking::kModuleName),
      [state, bind](jsi::Runtime &, const std::shared_ptr<rn::CallInvoker> &invoker) {
        bind(invoker);
        return std::make_shared<NativeNetworking>(state);
      }, dispose);
  registry.add(std::string(NativeBlobModule::kModuleName),
      [state, bind](jsi::Runtime &runtime, const std::shared_ptr<rn::CallInvoker> &invoker) {
        bind(invoker);
        install_blob_collector(runtime, state);
        return std::make_shared<NativeBlobModule>(state);
      }, dispose);
  registry.add(std::string(NativeFileReader::kModuleName),
      [state, bind](jsi::Runtime &, const std::shared_ptr<rn::CallInvoker> &invoker) {
        bind(invoker);
        return std::make_shared<NativeFileReader>(state);
      }, dispose);
  registry.add(websocket_module_name(),
      [state, bind](jsi::Runtime &, const std::shared_ptr<rn::CallInvoker> &invoker) {
        bind(invoker);
        return make_websocket_module(state);
      }, dispose);
}

void Networking::poll(std::size_t byte_budget) {
  if (!state_->active) return;
  state_->release_collected();
  state_->transport->poll(byte_budget);
  const auto pending = state_->pending_events();
  const auto reserved = state_->sockets.transport->reserved_events();
  const auto available = pending < max_network_events_per_poll ? max_network_events_per_poll - pending : 0;
  state_->sockets.transport->poll(byte_budget, available > reserved ? available - reserved : 0);
}

void Networking::stop() { state_->stop(); }

folly::dynamic Networking::snapshot() const {
  const auto &s = *state_;
  return folly::dynamic::object("stopped", !s.active)("transport", s.transport->snapshot())
      ("requests", folly::dynamic::object("inFlight", s.requests.size())("sent", s.sent)("refused", s.refused)
          ("aborted", s.aborted)("responses", s.responses)("completions", s.completions)("failures", s.failures)
          ("clearedCookies", s.cookie_clears))
      // The stopped invoker suppresses queued closures; pending therefore describes only an active network queue.
      ("events", folly::dynamic::object("queued", s.events_queued)("delivered", s.events_delivered)("dropped", s.events_dropped)
          ("pending", s.active ? s.pending_events() : 0)("peakPending", s.events_peak_pending))
      ("blobs", folly::dynamic::object("count", s.blobs.count())("bytes", s.blobs.bytes())("stored", s.blobs.stored())
          ("released", s.blobs.released())("closed", s.blobs_closed)("collected", s.blobs_collected)
          ("networkingHandlers", s.blob_handlers))
      ("fileReader", folly::dynamic::object("reads", s.file_reads)("failures", s.file_failures))
      ("webSocket", s.sockets.snapshot());
}
}
