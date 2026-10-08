#include "image_network.h"
#include <algorithm>
#include <vector>

namespace fabric_godot {
namespace {
std::string upper(std::string_view text) {
  std::string result(text);
  for (auto &c : result) c = c >= 'a' && c <= 'z' ? static_cast<char>(c - 'a' + 'A') : c;
  return result;
}

// NSURLResponse expectedContentLength: the Content-Length of a response that has one and is not chunked, else -1.
int64_t announced_length(const http::Headers &headers) {
  if (const auto *encoding = http::find_header(headers, "transfer-encoding")) {
    if (http::lower(*encoding).find("chunked") != std::string::npos) return -1;
  }
  const auto *length = http::find_header(headers, "content-length");
  if (!length) return -1;
  const auto text = http::trim(*length);
  if (text.empty() || text.size() > 18) return -1;
  int64_t value = 0;
  for (const char c : text) {
    if (c < '0' || c > '9') return -1;
    value = value * 10 + (c - '0');
  }
  return value;
}
}  // namespace

std::optional<std::string> build_download_request(const RequestSpec &spec, HttpRequest &out) {
  std::string error;
  if (!http::parse_url(spec.uri, &error)) return error;
  HttpRequest request;
  request.method = spec.method.empty() ? "GET" : upper(spec.method);
  request.url = spec.uri;
  for (const auto &[name, value] : spec.headers) {
    if (!http::valid_header_name(name)) return "The image source has an invalid header name: \"" + name + "\"";
    if (!http::valid_header_value(value)) return "The image source has an invalid value for the header \"" + name + "\"";
    const auto existing = std::find_if(request.headers.begin(), request.headers.end(), [&](const auto &entry) { return http::iequals(entry.first, name); });
    if (existing == request.headers.end()) request.headers.emplace_back(name, value);
    else *existing = {name, value};
  }
  request.body = spec.body;
  out = std::move(request);
  return std::nullopt;
}

std::optional<DownloadFailure> judge_download(const Download &download) {
  if (download.outcome == Download::Outcome::Abandoned) return std::nullopt;
  DownloadFailure failure;
  failure.has_response = download.has_response;
  if (download.has_response) {
    failure.code = download.status;
    failure.headers = http::join_duplicate_headers(download.headers);
  }
  if (download.outcome == Download::Outcome::Failed) {
    failure.message = download.failure;
    return failure;
  }
  if (download.body.empty()) failure.message = "Unknown image download error";
  else if (download.status != 200) failure.message = "Failed to load " + download.final_url;
  else return std::nullopt;
  return failure;
}

struct ImageNetwork::Exchange {
  uint64_t id{};
  HttpRequest request;
  Hooks hooks;
  // The clock's time at the start and at each bytes: the idle timeout counts from it.
  double activity{};
  bool head{}, complete{}, failed{}, over_size{}, timed_out{};
  int status{};
  http::Headers headers;
  std::string final_url, body, failure;
  int64_t total{-1};
  uint64_t received{}, reported{};
};

ImageNetwork::ImageNetwork(std::unique_ptr<HttpTransport> transport, Clock now) : transport_(std::move(transport)), now_(std::move(now)) {}
ImageNetwork::~ImageNetwork() { stop(); }

void ImageNetwork::enqueue(uint64_t id, HttpRequest request, Hooks hooks) {
  if (stopped_) return;
  auto exchange = std::make_shared<Exchange>();
  exchange->id = id;
  exchange->request = std::move(request);
  exchange->hooks = std::move(hooks);
  queue_.push_back(std::move(exchange));
}

Download ImageNetwork::outcome_of(Exchange &exchange, Download::Outcome outcome) const {
  Download download;
  download.outcome = outcome;
  download.has_response = exchange.head;
  download.status = exchange.status;
  download.headers = std::move(exchange.headers);
  download.final_url = std::move(exchange.final_url);
  download.body = std::move(exchange.body);
  download.total = exchange.total;
  download.received = exchange.received;
  download.failure = std::move(exchange.failure);
  download.timed_out = exchange.timed_out;
  return download;
}

void ImageNetwork::finish(const std::shared_ptr<Exchange> &exchange, Download download) {
  auto done = std::move(exchange->hooks.done);
  exchange->hooks = {};
  if (done && !stopped_) done(std::move(download));
}

void ImageNetwork::report_progress(Exchange &exchange) {
  if (!exchange.head || exchange.received == 0 || exchange.received == exchange.reported || !exchange.hooks.progress) return;
  exchange.reported = exchange.received;
  ++progress_events_;
  exchange.hooks.progress(static_cast<int64_t>(exchange.received), exchange.total);
}

void ImageNetwork::start_queued() {
  // A download nobody wants any more leaves the queue at once, whether or not a slot is free for it: it never starts. They are
  // collected first, because telling a requester may queue another download.
  std::vector<std::shared_ptr<Exchange>> unwanted;
  queue_.erase(std::remove_if(queue_.begin(), queue_.end(), [&](const std::shared_ptr<Exchange> &exchange) {
    const bool gone = exchange->hooks.abandoned && exchange->hooks.abandoned();
    if (gone) unwanted.push_back(exchange);
    return gone;
  }), queue_.end());
  for (const auto &exchange : unwanted) {
    ++abandoned_;
    finish(exchange, outcome_of(*exchange, Download::Outcome::Abandoned));
  }
  while (!stopped_ && active_.size() < limits_.max_downloads && !queue_.empty()) {
    const auto exchange = queue_.front();
    queue_.pop_front();
    // Listeners only record: acting on what they record is for settle_active(), once the transport's poll has returned.
    HttpListener listener;
    listener.on_head = [this, exchange](HttpResponseHead head) {
      exchange->head = true;
      exchange->status = head.status;
      exchange->final_url = std::move(head.url);
      exchange->total = announced_length(head.headers);
      exchange->headers = std::move(head.headers);
      exchange->activity = now_();
      if (exchange->total > 0 && static_cast<uint64_t>(exchange->total) > limits_.max_response_bytes) exchange->over_size = true;
    };
    listener.on_body = [this, exchange](std::string chunk) {
      exchange->activity = now_();
      exchange->received += chunk.size();
      if (exchange->received > limits_.max_response_bytes) exchange->over_size = true;
      if (exchange->over_size) {
        // Nothing past the limit is kept, whatever the transport still delivers before the download is abandoned.
        exchange->body.clear();
        exchange->body.shrink_to_fit();
        return;
      }
      exchange->body += chunk;
    };
    listener.on_failure = [exchange](HttpFailure failure) {
      exchange->failed = true;
      exchange->failure = std::move(failure.message);
      exchange->timed_out = failure.timed_out;
    };
    listener.on_complete = [exchange] { exchange->complete = true; };
    exchange->activity = now_();
    if (const auto error = transport_->start(exchange->id, exchange->request, std::move(listener))) {
      ++failed_;
      exchange->failure = *error;
      finish(exchange, outcome_of(*exchange, Download::Outcome::Failed));
      continue;
    }
    ++started_;
    active_[exchange->id] = exchange;
    peak_active_ = std::max<uint64_t>(peak_active_, active_.size());
  }
}

void ImageNetwork::settle_active() {
  std::vector<uint64_t> ids;
  ids.reserve(active_.size());
  for (const auto &entry : active_) ids.push_back(entry.first);
  for (const auto id : ids) {
    if (stopped_) return;
    const auto found = active_.find(id);
    if (found == active_.end()) continue;
    const auto exchange = found->second;
    if (exchange->hooks.abandoned && exchange->hooks.abandoned()) {
      transport_->cancel(id);
      active_.erase(id);
      ++abandoned_;
      finish(exchange, outcome_of(*exchange, Download::Outcome::Abandoned));
      continue;
    }
    if (exchange->over_size) {
      transport_->cancel(id);
      active_.erase(id);
      ++aborted_size_;
      ++failed_;
      exchange->failure = exchange->total > 0 && static_cast<uint64_t>(exchange->total) > limits_.max_response_bytes
          ? "The image is " + std::to_string(exchange->total) + " bytes, over the host limit of " + std::to_string(limits_.max_response_bytes)
          : "The image download passed the host limit of " + std::to_string(limits_.max_response_bytes) + " bytes";
      finish(exchange, outcome_of(*exchange, Download::Outcome::Failed));
      continue;
    }
    if (exchange->failed || exchange->complete) {
      // The transport has already let go of an exchange that ended.
      report_progress(*exchange);
      if (stopped_) return;
      active_.erase(id);
      bytes_ += exchange->received;
      if (exchange->failed) {
        ++failed_;
        finish(exchange, outcome_of(*exchange, Download::Outcome::Failed));
      } else {
        ++completed_;
        finish(exchange, outcome_of(*exchange, Download::Outcome::Complete));
      }
      continue;
    }
    if (now_() - exchange->activity >= limits_.idle_timeout_ms) {
      transport_->cancel(id);
      active_.erase(id);
      ++aborted_idle_;
      ++failed_;
      exchange->failure = "The request timed out.";
      exchange->timed_out = true;
      finish(exchange, outcome_of(*exchange, Download::Outcome::Failed));
      continue;
    }
    report_progress(*exchange);
  }
}

void ImageNetwork::poll(std::size_t byte_budget) {
  if (stopped_) return;
  ++polls_;
  start_queued();
  if (stopped_) return;
  if (!active_.empty()) transport_->poll(byte_budget);
  settle_active();
}

void ImageNetwork::stop() {
  if (stopped_) return;
  stopped_ = true;
  // First, so that no listener runs from here on; the downloads are forgotten without a word to their requesters.
  transport_->stop();
  queue_.clear();
  active_.clear();
}

folly::dynamic ImageNetwork::snapshot() const {
  return folly::dynamic::object("stopped", stopped_)("queued", queue_.size())("active", active_.size())("started", started_)
      ("completed", completed_)("failed", failed_)("abandoned", abandoned_)("abortedBySize", aborted_size_)("abortedByIdle", aborted_idle_)
      ("progressEvents", progress_events_)("bytes", bytes_)("polls", polls_)("peakActive", peak_active_)
      ("limits", folly::dynamic::object("maxDownloads", limits_.max_downloads)("maxResponseBytes", limits_.max_response_bytes)
          ("idleTimeoutMs", limits_.idle_timeout_ms))
      ("transport", transport_->snapshot());
}

}  // namespace fabric_godot
