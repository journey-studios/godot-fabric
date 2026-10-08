#include "image_network.h"
#include <iostream>
#include <map>
#include <stdexcept>
#include <string>
#include <vector>

using namespace fabric_godot;

namespace {
void require(bool condition, const std::string &message) {
  if (!condition) throw std::runtime_error(message);
}

// A transport that does what a script tells it to inside poll(), as the Godot one does: listeners run from poll() only, and an
// exchange that ends is let go of before its listener runs. It notes every call that the contract forbids.
class FakeTransport final : public HttpTransport {
 public:
  std::vector<uint64_t> started, cancelled;
  std::map<uint64_t, HttpListener> listeners;
  std::map<uint64_t, HttpRequest> requests;
  bool in_poll{}, in_listener{}, stopped{}, refuse{};
  std::vector<std::string> misuse;
  std::function<void(FakeTransport &)> script;

  std::optional<std::string> start(uint64_t id, HttpRequest request, HttpListener listener) override {
    if (in_listener) misuse.push_back("start inside a listener");
    if (refuse) return "Unsupported HTTP method: " + request.method;
    started.push_back(id);
    requests[id] = std::move(request);
    listeners[id] = std::move(listener);
    return std::nullopt;
  }
  void cancel(uint64_t id) override {
    if (in_poll || in_listener) misuse.push_back("cancel inside poll");
    cancelled.push_back(id);
    listeners.erase(id);
  }
  void poll(std::size_t) override {
    in_poll = true;
    if (script) script(*this);
    in_poll = false;
  }
  void stop() override {
    stopped = true;
    listeners.clear();
  }
  folly::dynamic snapshot() const override { return folly::dynamic::object("fake", true); }

  void head(uint64_t id, int status, http::Headers headers, std::string url = "http://x/a.png") {
    in_listener = true;
    listeners.at(id).on_head({status, std::move(headers), std::move(url)});
    in_listener = false;
  }
  void body(uint64_t id, std::string bytes) {
    in_listener = true;
    listeners.at(id).on_body(std::move(bytes));
    in_listener = false;
  }
  void complete(uint64_t id) {
    auto listener = std::move(listeners.at(id));
    listeners.erase(id);
    in_listener = true;
    listener.on_complete();
    in_listener = false;
  }
  void fail(uint64_t id, std::string message) {
    auto listener = std::move(listeners.at(id));
    listeners.erase(id);
    in_listener = true;
    listener.on_failure({std::move(message), false});
    in_listener = false;
  }
};

struct Harness {
  FakeTransport *transport;
  std::unique_ptr<ImageNetwork> network;
  double clock{1000};
  std::map<uint64_t, std::vector<std::pair<int64_t, int64_t>>> progress;
  std::map<uint64_t, Download> results;
  std::map<uint64_t, bool> abandon;
  std::vector<uint64_t> finished;
  std::function<void(uint64_t)> on_done;

  Harness() {
    auto fake = std::make_unique<FakeTransport>();
    transport = fake.get();
    network = std::make_unique<ImageNetwork>(std::move(fake), [this] { return clock; });
  }
  void add(uint64_t id) {
    HttpRequest request;
    request.method = "GET";
    request.url = "http://x/" + std::to_string(id) + ".png";
    network->enqueue(id, std::move(request),
        {[this, id] { return abandon[id]; }, [this, id](int64_t loaded, int64_t total) { progress[id].emplace_back(loaded, total); },
            [this, id](Download download) {
              finished.push_back(id);
              results[id] = std::move(download);
              if (on_done) on_done(id);
            }});
  }
};

void requests_are_built_as_the_ios_loader_builds_them() {
  HttpRequest request;
  require(!build_download_request({"", "https://example.com/a.png?x=1", {}, ""}, request), "A plain source builds");
  require(request.method == "GET" && request.url == "https://example.com/a.png?x=1" && request.headers.empty() && request.body.empty() && request.timeout_ms == 0,
      "No method means GET, and the transport is given the URL as it was, with no deadline of its own");
  require(!build_download_request({"post", "http://h/a.png", {{"X-A", "1"}, {"x-a", "2"}, {"Accept", "image/png"}}, "payload"}, request), "A POST builds");
  require(request.method == "POST" && request.body == "payload", "The method is upper-cased and any method takes the body");
  require((request.headers == http::Headers{{"x-a", "2"}, {"Accept", "image/png"}}), "A later value of a name replaces the earlier one, compared without case");
  require(!build_download_request({"GET", "http://h/a.png", {}, "body"}, request) && request.body == "body", "A GET takes a body too");
  require(!build_download_request({"BREW", "http://h/a.png", {}, ""}, request) && request.method == "BREW", "The transport decides which methods it can send");
  require(build_download_request({"", "http://h/a.png", {{"Bad Name", "v"}}, ""}, request).value_or("").find("invalid header name") != std::string::npos, "A header name with a space");
  require(build_download_request({"", "http://h/a.png", {{"", "v"}}, ""}, request).has_value(), "An empty header name");
  require(build_download_request({"", "http://h/a.png", {{"X-A", "line\r\nInjected: 1"}}, ""}, request).value_or("").find("invalid value") != std::string::npos,
      "A value with a line break would split the request");
  require(build_download_request({"", "http://:80/a.png", {}, ""}, request).has_value(), "An URL without a host");
  require(build_download_request({"", "ftp://h/a.png", {}, ""}, request).has_value(), "A scheme the transport does not speak");
}

void downloads_are_judged_as_the_ios_loader_judges_them() {
  Download ok;
  ok.outcome = Download::Outcome::Complete;
  ok.has_response = true;
  ok.status = 200;
  ok.body = "x";
  ok.final_url = "http://x/final.png";
  require(!judge_download(ok), "A 200 with a body is a picture to decode");
  auto empty = ok;
  empty.body.clear();
  auto failure = judge_download(empty);
  require(failure && failure->message == "Unknown image download error" && failure->has_response && failure->code == 200, "A 200 with no body: no data at all");
  auto not_found = ok;
  not_found.status = 404;
  not_found.headers = {{"X-A", "1"}, {"x-a", "2"}, {"Content-Type", "text/plain"}};
  failure = judge_download(not_found);
  require(failure && failure->message == "Failed to load http://x/final.png" && failure->code == 404, "Any other status names the final URL");
  require((failure->headers == http::Headers{{"X-A", "1"}, {"x-a", "2"}, {"Content-Type", "text/plain"}}), "The response headers come with it, names as received");
  auto cookies = not_found;
  cookies.headers = {{"Set-Cookie", "a=1"}, {"Set-Cookie", "b=2"}};
  require((judge_download(cookies)->headers == http::Headers{{"Set-Cookie", "a=1, b=2"}}), "Repeated headers are joined with a comma, as NSHTTPURLResponse.allHeaderFields joins them");
  auto empty_not_found = not_found;
  empty_not_found.body.clear();
  require(judge_download(empty_not_found)->message == "Unknown image download error", "No data wins over the status: RCTNetworkTask hands the loader nothing");
  Download refused;
  refused.outcome = Download::Outcome::Failed;
  refused.failure = "Failed to connect to 127.0.0.1:9";
  failure = judge_download(refused);
  require(failure && failure->message == "Failed to connect to 127.0.0.1:9" && !failure->has_response && failure->code == 0 && failure->headers.empty(), "Before a head: the message alone");
  auto cut = not_found;
  cut.outcome = Download::Outcome::Failed;
  cut.status = 200;
  cut.failure = "unexpected end of stream from h:1";
  failure = judge_download(cut);
  require(failure && failure->has_response && failure->code == 200 && failure->message == "unexpected end of stream from h:1", "After a head: the response comes with the failure");
  Download gone;
  gone.outcome = Download::Outcome::Abandoned;
  require(!judge_download(gone), "An abandoned download is no failure");
}

void at_most_four_downloads_run_and_the_rest_wait_in_order() {
  Harness h;
  for (uint64_t id = 1; id <= 6; ++id) h.add(id);
  h.network->poll(1024);
  require((h.transport->started == std::vector<uint64_t>{1, 2, 3, 4}) && h.network->queued() == 2 && h.network->active() == 4, "Four start, first in first out");
  h.transport->script = [](FakeTransport &t) { t.head(2, 200, {{"Content-Length", "1"}}); t.body(2, "a"); t.complete(2); };
  h.network->poll(1024);
  h.transport->script = nullptr;
  require((h.transport->started == std::vector<uint64_t>{1, 2, 3, 4}) && h.finished == std::vector<uint64_t>{2}, "One ended; the next waits for the next poll to start");
  h.network->poll(1024);
  require((h.transport->started == std::vector<uint64_t>{1, 2, 3, 4, 5}) && h.network->queued() == 1, "The fifth takes its place");
  require(h.network->snapshot()["peakActive"] == 4, "No more than four were ever active");
}

void progress_is_cumulative_and_coalesced_per_poll() {
  Harness h;
  h.add(1);
  h.add(2);
  h.add(3);
  h.network->poll(1024);
  h.transport->script = [](FakeTransport &t) {
    t.head(1, 200, {{"Content-Length", "100"}});
    t.body(1, std::string(10, 'a'));
    t.body(1, std::string(20, 'b'));
    t.body(1, std::string(5, 'c'));
    t.head(2, 200, {{"Transfer-Encoding", "chunked"}});
    t.body(2, "abcd");
    t.head(3, 200, {{"Content-Length", "0"}});
  };
  h.network->poll(1024);
  require((h.progress[1] == std::vector<std::pair<int64_t, int64_t>>{{35, 100}}), "Three chunks in one pump are one event: the bytes so far over the Content-Length");
  require((h.progress[2] == std::vector<std::pair<int64_t, int64_t>>{{4, -1}}), "A chunked response has no total");
  require(h.progress[3].empty(), "A response with no bytes reports nothing");
  h.transport->script = nullptr;
  h.network->poll(1024);
  require(h.progress[1].size() == 1 && h.progress[2].size() == 1, "A pump that brings no bytes repeats nothing");
  h.transport->script = [](FakeTransport &t) { t.body(1, std::string(65, 'd')); t.complete(2); t.complete(1); t.complete(3); };
  h.network->poll(1024);
  require((h.progress[1] == std::vector<std::pair<int64_t, int64_t>>{{35, 100}, {100, 100}}), "The bytes that arrive with the end are reported before it");
  require(h.results[1].outcome == Download::Outcome::Complete && h.results[1].body.size() == 100 && h.results[1].total == 100, "The body is whole");
  require(h.results[3].outcome == Download::Outcome::Complete && h.results[3].body.empty() && h.progress[3].empty(), "An empty body completes without progress");
  h.transport->script = nullptr;
  h.network->poll(1024);
  require(h.progress[1].size() == 2, "Nothing more after the end");
}

void a_download_nobody_wants_is_cancelled_outside_the_transports_poll() {
  Harness h;
  h.add(1);
  h.add(2);
  h.network->poll(1024);
  h.transport->script = [](FakeTransport &t) { t.head(1, 200, {{"Content-Length", "100"}}); t.body(1, "abc"); };
  h.network->poll(1024);
  h.abandon[1] = true;
  h.transport->script = [](FakeTransport &t) { t.body(1, "def"); };
  h.network->poll(1024);
  require(h.transport->cancelled == std::vector<uint64_t>{1} && h.transport->misuse.empty(), "The transport was asked to cancel it, and not from inside its poll or a listener");
  require(h.results[1].outcome == Download::Outcome::Abandoned && h.network->active() == 1, "It ends as abandoned");
  require(h.progress[1].size() == 1, "Nothing was reported for the bytes that arrived after it was abandoned");
  // One that never started is dropped from the queue and never reaches the transport.
  Harness queued;
  for (uint64_t id = 1; id <= 5; ++id) queued.add(id);
  queued.abandon[5] = true;
  queued.network->poll(1024);
  queued.transport->script = [](FakeTransport &t) { t.head(1, 200, {}); t.complete(1); };
  queued.network->poll(1024);
  queued.transport->script = nullptr;
  queued.network->poll(1024);
  require((queued.transport->started == std::vector<uint64_t>{1, 2, 3, 4}) && queued.results[5].outcome == Download::Outcome::Abandoned && queued.network->queued() == 0,
      "A queued download that was abandoned never starts");
  // And it does not wait for a slot to be told so: with every slot busy, the next poll takes it out of the queue.
  Harness busy;
  for (uint64_t id = 1; id <= 6; ++id) busy.add(id);
  busy.network->poll(1024);
  require(busy.network->queued() == 2 && busy.network->active() == 4, "Four run and two wait");
  busy.abandon[5] = true;
  busy.network->poll(1024);
  require(busy.network->queued() == 1 && busy.results[5].outcome == Download::Outcome::Abandoned && busy.results.count(6) == 0 && busy.transport->started.size() == 4,
      "An abandoned download leaves the queue at the next poll, though no slot is free, and the one behind it keeps its place");
}

void the_size_limit_stops_a_download_that_announces_or_sends_too_much() {
  Harness h;
  auto limits = h.network->limits();
  limits.max_response_bytes = 50;
  h.network->set_limits(limits);
  h.add(1);
  h.add(2);
  h.add(3);
  h.network->poll(1024);
  h.transport->script = [](FakeTransport &t) {
    t.head(1, 200, {{"Content-Length", "51"}});
    t.head(2, 200, {{"Transfer-Encoding", "chunked"}});
    t.body(2, std::string(30, 'a'));
    t.body(2, std::string(30, 'b'));
    t.head(3, 200, {{"Content-Length", "50"}});
    t.body(3, std::string(50, 'c'));
  };
  h.network->poll(1024);
  h.transport->script = nullptr;
  require((h.transport->cancelled == std::vector<uint64_t>{1, 2}) && h.transport->misuse.empty(), "Both were cancelled, outside the transport's poll");
  require(h.results[1].outcome == Download::Outcome::Failed && h.results[1].failure.find("is 51 bytes, over the host limit of 50") != std::string::npos && h.results[1].has_response,
      "The announced size is refused with the response it came with");
  require(h.results[2].outcome == Download::Outcome::Failed && h.results[2].failure.find("passed the host limit of 50") != std::string::npos && h.results[2].body.empty(),
      "A chunked body that passes it is refused and its bytes are not kept");
  require(h.network->snapshot()["abortedBySize"] == 2 && h.network->active() == 1, "Counted, and the download at the limit is still running");
  h.transport->script = [](FakeTransport &t) { t.complete(3); };
  h.network->poll(1024);
  require(h.results[3].outcome == Download::Outcome::Complete && h.results[3].body.size() == 50, "A body of exactly the limit is accepted");
}

void a_download_that_receives_nothing_for_the_idle_timeout_is_stopped() {
  Harness h;
  h.add(1);
  h.add(2);
  h.network->poll(1024);
  h.transport->script = [](FakeTransport &t) { t.head(1, 200, {{"Content-Length", "10"}}); t.body(1, "ab"); };
  h.network->poll(1024);
  h.transport->script = nullptr;
  h.clock += 59999;
  h.network->poll(1024);
  require(h.finished.empty(), "Just under the timeout nothing happens");
  h.transport->script = [](FakeTransport &t) { t.body(1, "cd"); };
  h.network->poll(1024);
  h.clock += 59999;
  h.transport->script = nullptr;
  h.network->poll(1024);
  require(h.results.count(1) == 0 && h.results.count(2) == 1, "Bytes restart the clock of the download that received them, not of the other");
  require(h.results[2].outcome == Download::Outcome::Failed && h.results[2].timed_out && h.results[2].failure == "The request timed out." && !h.results[2].has_response,
      "A request that never heard back timed out before a head");
  h.clock += 2;
  h.network->poll(1024);
  require(h.results[1].outcome == Download::Outcome::Failed && h.results[1].timed_out && h.results[1].has_response && h.results[1].status == 200 && h.results[1].received == 4,
      "One that stalled mid-body timed out with its head");
  require((h.transport->cancelled == std::vector<uint64_t>{2, 1}) && h.transport->misuse.empty() && h.network->snapshot()["abortedByIdle"] == 2, "Both were cancelled and counted");
}

void failures_keep_the_response_they_came_with() {
  Harness h;
  h.add(1);
  h.add(2);
  h.add(3);
  h.network->poll(1024);
  h.transport->script = [](FakeTransport &t) {
    t.fail(1, "Failed to connect to 127.0.0.1:9");
    t.head(2, 200, {{"Content-Length", "100"}});
    t.body(2, std::string(40, 'a'));
    t.fail(2, "unexpected end of stream from 127.0.0.1:1");
    t.head(3, 404, {{"X-Why", "gone"}});
    t.body(3, "nope");
    t.complete(3);
  };
  h.network->poll(1024);
  require(h.results[1].outcome == Download::Outcome::Failed && !h.results[1].has_response && h.results[1].failure == "Failed to connect to 127.0.0.1:9", "Before the head");
  require(h.results[2].outcome == Download::Outcome::Failed && h.results[2].has_response && h.results[2].status == 200 && h.results[2].received == 40, "Mid-body");
  require((h.progress[2] == std::vector<std::pair<int64_t, int64_t>>{{40, 100}}), "The bytes that came before the failure are reported first");
  require(h.results[3].outcome == Download::Outcome::Complete && h.results[3].status == 404 && judge_download(h.results[3])->message == "Failed to load http://x/a.png", "A 404 completes and is judged by the loader");
  Harness refused;
  refused.transport->refuse = true;
  refused.add(7);
  refused.network->poll(1024);
  require(refused.results[7].outcome == Download::Outcome::Failed && refused.results[7].failure == "Unsupported HTTP method: GET" && refused.network->active() == 0,
      "A request the transport cannot start fails with its explanation");
}

void stopping_silences_everything_and_stops_the_transport_first() {
  Harness h;
  for (uint64_t id = 1; id <= 6; ++id) h.add(id);
  h.network->poll(1024);
  h.transport->script = [](FakeTransport &t) { t.head(1, 200, {{"Content-Length", "10"}}); t.body(1, "ab"); };
  h.network->poll(1024);
  h.transport->script = nullptr;
  h.network->stop();
  require(h.transport->stopped && h.network->active() == 0 && h.network->queued() == 0, "The transport is stopped and nothing is held");
  h.abandon[2] = true;
  h.network->poll(1024);
  h.add(9);
  h.network->poll(1024);
  require(h.finished.empty() && h.progress[1].size() == 1 && h.transport->started.size() == 4, "No hook runs and nothing starts after stop()");
  require(h.network->snapshot()["stopped"] == true, "The snapshot says so");
}

void a_hook_may_queue_more_downloads() {
  Harness h;
  // The done hook of the first download queues a second one, from inside poll().
  h.on_done = [&h](uint64_t id) {
    if (id == 1) h.add(2);
  };
  h.add(1);
  h.network->poll(1024);
  h.transport->script = [](FakeTransport &t) { t.head(1, 200, {{"Content-Length", "1"}}); t.body(1, "a"); t.complete(1); };
  h.network->poll(1024);
  require(h.results[1].outcome == Download::Outcome::Complete && h.network->queued() == 1, "The first ended and the second waits in the queue");
  h.transport->script = nullptr;
  h.network->poll(1024);
  require((h.transport->started == std::vector<uint64_t>{1, 2}) && h.network->active() == 1, "The second starts in the next poll");
  // A hook that abandons its own sibling, and one that stops the network, change nothing the loop depends on.
  Harness stopper;
  stopper.on_done = [&stopper](uint64_t) { stopper.network->stop(); };
  stopper.add(1);
  stopper.add(2);
  stopper.network->poll(1024);
  stopper.transport->script = [](FakeTransport &t) { t.head(1, 200, {{"Content-Length", "1"}}); t.body(1, "a"); t.complete(1); t.head(2, 200, {{"Content-Length", "1"}}); };
  stopper.network->poll(1024);
  require(stopper.finished == std::vector<uint64_t>{1} && stopper.transport->stopped, "A hook may stop the network: nothing more is told to anyone");
}
}  // namespace

int main() {
  requests_are_built_as_the_ios_loader_builds_them();
  downloads_are_judged_as_the_ios_loader_judges_them();
  at_most_four_downloads_run_and_the_rest_wait_in_order();
  progress_is_cumulative_and_coalesced_per_poll();
  a_download_nobody_wants_is_cancelled_outside_the_transports_poll();
  the_size_limit_stops_a_download_that_announces_or_sends_too_much();
  a_download_that_receives_nothing_for_the_idle_timeout_is_stopped();
  failures_keep_the_response_they_came_with();
  stopping_silences_everything_and_stops_the_transport_first();
  a_hook_may_queue_more_downloads();
  std::cout << "IMAGE_NETWORK_PASSED\n";
}
