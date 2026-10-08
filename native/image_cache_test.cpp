#include "image_cache.h"
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>

using namespace fabric_godot;
using namespace fabric_godot::image;

namespace {
void require(bool condition, const std::string &message) {
  if (!condition) throw std::runtime_error(message);
}
constexpr double second = 1000.0;
// Sun, 06 Nov 1994 08:49:37 GMT, the date RFC 9110 uses.
constexpr double rfc_date = 784111777000.0;

http::Headers response(std::initializer_list<std::pair<const char *, const char *>> fields) {
  http::Headers headers;
  for (const auto &[name, value] : fields) headers.emplace_back(name, value);
  return headers;
}

void http_dates_are_read_in_the_one_format_the_formatter_reads() {
  require(parse_http_date("Sun, 06 Nov 1994 08:49:37 GMT") == std::optional<double>(rfc_date), "IMF-fixdate");
  require(parse_http_date("Thu, 01 Jan 1970 00:00:00 GMT") == std::optional<double>(0.0), "The epoch");
  require(parse_http_date("  Thu, 01 Jan 1970 00:00:01 GMT\r\n") == std::optional<double>(1000.0), "Optional white space around it");
  require(parse_http_date("Tue, 29 Feb 2000 12:00:00 GMT") == std::optional<double>(951825600000.0), "A leap day");
  require(parse_http_date("Wed, 31 Dec 1969 23:59:59 GMT") == std::optional<double>(-1000.0), "Before the epoch");
  require(!parse_http_date("Sunday, 06-Nov-94 08:49:37 GMT"), "RFC 850 is another format");
  require(!parse_http_date("Sun Nov  6 08:49:37 1994"), "asctime is another format");
  require(!parse_http_date("Sun, 06 Nov 1994 08:49:37 UTC"), "The zone is GMT");
  require(!parse_http_date("Sun, 06 Nov 1994 25:49:37 GMT"), "An hour past 23");
  require(!parse_http_date("Fun, 06 Nov 1994 08:49:37 GMT"), "An unknown weekday");
  require(!parse_http_date("Sun, 06 Nox 1994 08:49:37 GMT"), "An unknown month");
  require(!parse_http_date("0"), "Expires: 0 is not a date");
  require(!parse_http_date(""), "Nothing");
}

void integer_values_read_as_nsstring_does() {
  require(integer_value("60") == 60 && integer_value(" 60, public") == 60 && integer_value("+7") == 7 && integer_value("-3") == -3, "Leading sign and white space");
  require(integer_value("abc") == 0 && integer_value("") == 0 && integer_value("12abc") == 12, "Digits up to the first other character");
}

void a_response_decides_whether_and_how_long_a_picture_is_kept() {
  const auto date = std::make_pair("Date", "Sun, 06 Nov 1994 08:49:37 GMT");
  auto fresh = response_freshness(response({date, {"Cache-Control", "public, max-age=600"}}));
  require(fresh.storable && fresh.stale_at == std::optional<double>(rfc_date + 600 * second), "max-age=N is stale at Date + N");
  fresh = response_freshness(response({date, {"Cache-Control", "max-age=60, max-age=120"}}));
  require(fresh.stale_at == std::optional<double>(rfc_date + 120 * second), "The last max-age counts");
  require(!response_freshness(response({date, {"Cache-Control", "no-store"}})).storable, "no-store");
  require(!response_freshness(response({date, {"Cache-Control", "private, no-cache"}})).storable, "no-cache");
  require(!response_freshness(response({date, {"Cache-Control", "no-cache=Set-Cookie"}})).storable, "Anything that contains no-cache");
  require(!response_freshness(response({date, {"Cache-Control", "max-age=0"}})).storable, "max-age=0 ends a component");
  require(!response_freshness(response({date, {"Cache-Control", "public, max-age=0"}})).storable, "max-age=0 after a comma and a space");
  require(response_freshness(response({date, {"Cache-Control", "max-age=00"}})).storable, "max-age=00 does not end in max-age=0, and is stale at once instead");
  require(response_freshness(response({date, {"Cache-Control", "max-age=00"}})).stale_at == std::optional<double>(rfc_date), "max-age=00 is stale at Date");
  require(response_freshness(response({date, {"Cache-Control", "s-maxage=0"}})).storable, "s-maxage is another directive");
  require(!response_freshness(response({date, {"cache-control", "max-age=60"}, {"Cache-Control", "no-store"}})).storable, "Repeated headers are joined and every component counts");
  require(response_freshness(response({date, {"CACHE-CONTROL", "max-age=5"}})).stale_at == std::optional<double>(rfc_date + 5 * second), "Names are compared without case");
  require(response_freshness(response({date, {"Cache-Control", "No-Store"}})).storable, "The directives are case-sensitive, as containsString: is");

  const auto expires = response_freshness(response({date, {"Expires", "Sun, 06 Nov 1994 09:49:37 GMT"}}));
  require(expires.storable && expires.stale_at == std::optional<double>(rfc_date + 3600 * second), "Expires without a max-age");
  const auto max_age_wins = response_freshness(response({date, {"Cache-Control", "max-age=10"}, {"Expires", "Sun, 06 Nov 1994 09:49:37 GMT"}}));
  require(max_age_wins.stale_at == std::optional<double>(rfc_date + 10 * second), "A max-age wins over Expires");
  const auto zero = response_freshness(response({date, {"Expires", "0"}, {"Last-Modified", "Sat, 05 Nov 1994 08:49:37 GMT"}}));
  require(zero.storable && !zero.stale_at, "Expires, readable or not, ends the search: an unreadable one never goes stale");
  const auto heuristic = response_freshness(response({date, {"Last-Modified", "Sat, 05 Nov 1994 08:49:37 GMT"}}));
  require(heuristic.stale_at == std::optional<double>(rfc_date + 86400 * second / 10), "A tenth of Date - Last-Modified after Date");
  require(!response_freshness(response({date})).stale_at, "Nothing says how long: never stale");
  const auto undated = response_freshness(response({{"Cache-Control", "max-age=60"}}));
  require(undated.storable && !undated.stale_at, "Without a Date there is no stale time (RCTImageCache)");
  const auto received = response_freshness(response({{"Cache-Control", "max-age=60"}}), 1000.0 * second);
  require(received.stale_at == std::optional<double>(1060 * second) && received.dated && !undated.dated, "The byte cache dates a response by the time it arrived");
  require(fresh.dated && heuristic.dated && response_freshness(response({date, {"Cache-Control", "no-store"}})).dated, "A response with a readable Date is dated");
  const auto bad_date = response_freshness(response({{"Date", "yesterday"}, {"Cache-Control", "max-age=60"}}), 5.0);
  require(bad_date.stale_at == std::optional<double>(5.0 + 60 * second), "An unreadable Date is no Date");
}

void decoded_keys_follow_rctimagecache() {
  require(decoded_key("https://example.com/a.png", 100, 50, 2) == "https://example.com/a.png|100|50|2|0", "%g of whole numbers");
  require(decoded_key("u", 60.5, 0, 1.5) == "u|60.5|0|1.5|0", "%g of fractions");
  require(decoded_key("u", 1234567, 0.0001, 3) == "u|1.23457e+06|0.0001|3|0", "%g keeps six significant digits");
}

void the_cache_gives_up_the_least_recently_used_first() {
  ExpiringLru<int> cache(100, 40);
  require(cache.put("a", 1, 30, std::nullopt) && cache.put("b", 2, 30, std::nullopt) && cache.put("c", 3, 30, std::nullopt), "Three entries fit");
  require(cache.size() == 3 && cache.bytes() == 90, "Their cost adds up");
  require(cache.get("a") != nullptr, "A lookup is a use");
  require(cache.put("d", 4, 30, std::nullopt), "A fourth entry");
  require(cache.peek("b") == nullptr && cache.peek("a") != nullptr && cache.peek("c") != nullptr && cache.peek("d") != nullptr, "The least recently used (b, not the one just used) went");
  require(cache.bytes() == 90 && cache.stats().evictions == 1, "One eviction made room");
  require((cache.keys() == std::vector<std::string>{"d", "a", "c"}), "Most recent first");
  require(!cache.put("big", 9, 41, std::nullopt) && cache.peek("big") == nullptr && cache.stats().rejected == 1, "An entry over the entry limit is refused");
  require(cache.put("a", 10, 20, std::nullopt) && cache.size() == 3 && cache.bytes() == 80 && cache.get("a")->value == 10, "A new entry under a key replaces the old one");
  require(cache.put("e", 5, 40, std::nullopt) && cache.put("f", 6, 40, std::nullopt) && cache.bytes() <= 100, "An entry at the limit is kept, and the total stays bounded");
  cache.clear();
  require(cache.size() == 0 && cache.bytes() == 0 && cache.get("d") == nullptr, "Clearing empties it");
}

void a_request_is_routed_by_its_policy_and_what_the_caches_hold() {
  const Lookup none{}, fresh{true, false}, stale{true, true};
  int decoded_asked = 0, bytes_asked = 0;
  const auto routed = [&](CachePolicy policy, bool view, bool cacheable, Lookup in_decoded, Lookup in_bytes) {
    decoded_asked = bytes_asked = 0;
    return route(policy, view, cacheable, [&] { ++decoded_asked; return in_decoded; }, [&] { ++bytes_asked; return in_bytes; });
  };
  using enum CachePolicy;
  require(routed(Default, true, true, fresh, fresh) == Route::DecodedPicture && decoded_asked == 1 && bytes_asked == 0,
      "A decoded hit answers, and the byte cache is not touched (a lookup moves an entry to the front)");
  require(routed(Default, true, true, stale, fresh) == Route::CachedBytes && decoded_asked == 1 && bytes_asked == 1, "A stale picture is not served: the byte cache is asked");
  require(routed(ForceCache, true, true, stale, none) == Route::Download, "A stale picture is not served under force-cache either");
  require(routed(Default, true, true, none, stale) == Route::Download && bytes_asked == 1, "The default policy refuses a stale response and asks the server");
  require(routed(ForceCache, true, true, none, stale) == Route::CachedBytes, "force-cache takes a stale response");
  require(routed(OnlyIfCached, true, true, none, stale) == Route::CachedBytes, "and so does only-if-cached");
  require(routed(OnlyIfCached, true, true, none, none) == Route::RefuseOnlyIfCached, "only-if-cached with nothing cached is refused");
  require(routed(OnlyIfCached, true, false, none, fresh) == Route::RefuseOnlyIfCached && bytes_asked == 0, "A request that is not cacheable (a POST) never finds its response in the byte cache");
  require(routed(Reload, true, true, fresh, fresh) == Route::Download && decoded_asked == 0 && bytes_asked == 0, "reload asks neither cache");
  require(routed(Default, false, true, fresh, none) == Route::Download && decoded_asked == 0 && bytes_asked == 1,
      "A size or a prefetch (not a view) leaves the decoded cache alone and uses the byte cache");
  require(routed(Default, false, true, none, fresh) == Route::CachedBytes, "and is answered by it");
  require(routed(Default, true, false, none, fresh) == Route::Download && bytes_asked == 0, "A GET with a body, or any other method, is downloaded");
}

void staleness_is_for_the_caller_to_judge() {
  ExpiringLru<int> cache(100, 100);
  cache.put("fresh", 1, 10, 2000.0);
  cache.put("forever", 2, 10, std::nullopt);
  require(!ExpiringLru<int>::stale(*cache.peek("fresh"), 2000.0), "At its stale time an entry is not yet stale: RCTImageCache compares with NSOrderedDescending");
  require(ExpiringLru<int>::stale(*cache.peek("fresh"), 2000.5) && !ExpiringLru<int>::stale(*cache.peek("forever"), 1e18), "After it, it is; with none it never is");
  cache.expire("fresh");
  require(cache.peek("fresh") == nullptr && cache.stats().expired == 1 && cache.size() == 1, "expire drops it and counts it");
}
}  // namespace

int main() {
  http_dates_are_read_in_the_one_format_the_formatter_reads();
  integer_values_read_as_nsstring_does();
  a_response_decides_whether_and_how_long_a_picture_is_kept();
  a_request_is_routed_by_its_policy_and_what_the_caches_hold();
  decoded_keys_follow_rctimagecache();
  the_cache_gives_up_the_least_recently_used_first();
  staleness_is_for_the_caller_to_judge();
  std::cout << "IMAGE_CACHE_PASSED\n";
}
