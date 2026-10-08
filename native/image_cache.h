#pragma once

// The pure parts of the host's image caches: what an HTTP response says about how long it may be kept, the key and the
// limits of RN iOS's decoded-image cache (RCTImageCache.mm), and the least-recently-used store both of the host's memory
// caches are made of. Header-only and free of Godot and React Native, so image_cache_test.cpp checks them on their own.
// The two caches are the decoded cache, which keeps what RCTImageCache keeps (a decoded picture per URL, size, scale and
// mode), and the byte cache, which stands where NSURLCache stands under NSURLSession (the body of a response and its headers).

#include "http_core.h"
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <list>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>
#include <utility>
#include <vector>

namespace fabric_godot::image {

// RCTImageCache.mm: RCTMaxCacheableDecodedImageSizeInBytes and RCTImageCacheTotalCostLimit.
constexpr std::size_t decoded_entry_limit = 2 * 1024 * 1024;
constexpr std::size_t decoded_total_limit = 20 * 1024 * 1024;
// The byte cache is this host's own: NSURLCache's capacity is the app's to choose, and it caches no entry over a twentieth of it.
constexpr std::size_t byte_total_limit = 20 * 1024 * 1024;
constexpr std::size_t byte_entry_limit = byte_total_limit / 20;

// RCTCacheKeyForImage: the request's URL, size in points, scale and resize mode (the loader always asks RCTResizeModeStretch,
// which is UIViewContentModeScaleToFill, 0), written with %g.
inline std::string decoded_key(std::string_view uri, double width, double height, double scale) {
  char numbers[96];
  std::snprintf(numbers, sizeof numbers, "|%g|%g|%g|0", width, height, scale);
  return std::string(uri) + numbers;
}

inline int month_of(std::string_view name) {
  static constexpr std::string_view months[] = {"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};
  for (int index = 0; index < 12; ++index)
    if (months[index] == name) return index + 1;
  return 0;
}

// Days from 1970-01-01 to the civil date (proleptic Gregorian), after Howard Hinnant's algorithm.
inline int64_t days_from_civil(int64_t year, unsigned month, unsigned day) {
  year -= month <= 2;
  const int64_t era = (year >= 0 ? year : year - 399) / 400;
  const auto year_of_era = static_cast<unsigned>(year - era * 400);
  const unsigned day_of_year = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1;
  const unsigned day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
  return era * 146097 + static_cast<int64_t>(day_of_era) - 719468;
}

// The one date format RCTImageCache's formatter reads, "Sun, 06 Nov 1994 08:49:37 GMT" (en_US_POSIX, GMT): milliseconds since the
// Unix epoch, or nothing when the text is any other date.
inline std::optional<double> parse_http_date(std::string_view text) {
  text = http::trim(text);
  if (text.size() != 29 || text.substr(3, 2) != ", " || text[7] != ' ' || text[11] != ' ' || text[16] != ' ' || text[19] != ':' || text[22] != ':' ||
      text.substr(25) != " GMT")
    return std::nullopt;
  static constexpr std::string_view weekdays[] = {"Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"};
  bool known = false;
  for (const auto day : weekdays) known = known || text.substr(0, 3) == day;
  const int month = month_of(text.substr(8, 3));
  if (!known || month == 0) return std::nullopt;
  const auto number = [&](std::size_t at, std::size_t length) -> int {
    int value = 0;
    for (std::size_t index = at; index < at + length; ++index) {
      if (text[index] < '0' || text[index] > '9') return -1;
      value = value * 10 + (text[index] - '0');
    }
    return value;
  };
  const int day = number(5, 2), year = number(12, 4), hour = number(17, 2), minute = number(20, 2), second = number(23, 2);
  if (day < 1 || day > 31 || year < 0 || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 60) return std::nullopt;
  const double days = static_cast<double>(days_from_civil(year, static_cast<unsigned>(month), static_cast<unsigned>(day)));
  return ((days * 24 + hour) * 60 + minute) * 60000.0 + second * 1000.0;
}

// The values of every header of that name, joined with ", " as NSHTTPURLResponse.allHeaderFields joins repeats.
inline std::optional<std::string> joined_header(const http::Headers &headers, std::string_view name) {
  std::optional<std::string> joined;
  for (const auto &[key, value] : headers) {
    if (!http::iequals(key, name)) continue;
    if (joined) *joined += ", " + value;
    else joined = value;
  }
  return joined;
}

// NSString integerValue: optional white space and sign, then digits up to the first other character; 0 when there are none.
inline int64_t integer_value(std::string_view text) {
  std::size_t at = 0;
  while (at < text.size() && (text[at] == ' ' || text[at] == '\t' || text[at] == '\n' || text[at] == '\r')) ++at;
  bool negative = false;
  if (at < text.size() && (text[at] == '+' || text[at] == '-')) negative = text[at++] == '-';
  int64_t value = 0;
  for (; at < text.size() && text[at] >= '0' && text[at] <= '9'; ++at) {
    if (value > (INT64_MAX - 9) / 10) return negative ? INT64_MIN : INT64_MAX;
    value = value * 10 + (text[at] - '0');
  }
  return negative ? -value : value;
}

inline bool contains(std::string_view text, std::string_view part) { return text.find(part) != std::string_view::npos; }
inline bool ends_with(std::string_view text, std::string_view suffix) { return text.size() >= suffix.size() && text.substr(text.size() - suffix.size()) == suffix; }

// Whether a response may be kept, and from when it is stale.
struct Freshness {
  bool storable{true};
  // Milliseconds since the epoch. Nothing here means the entry never goes stale.
  std::optional<double> stale_at;
  // Whether the response carried a Date that could be read (or was given one): without a date there is no stale time.
  bool dated{};
};

// RCTImageCache.mm addImageToCache:...response: a Cache-Control component that contains no-cache or no-store, or ends in
// max-age=0, forbids keeping the picture; max-age=N makes it stale at Date + N; without one, Expires gives the stale time, else
// a tenth of the time between Last-Modified and Date after Date. (Only a response with a parseable Date has a stale time at
// all: `missing_date` stands in for one that has none, which the byte cache supplies with the time it received the response and
// the decoded cache leaves out, as RCTImageCache does.)
inline Freshness response_freshness(const http::Headers &headers, std::optional<double> missing_date = std::nullopt) {
  Freshness result;
  const auto date_header = joined_header(headers, "date");
  std::optional<double> date = date_header ? parse_http_date(*date_header) : std::nullopt;
  if (!date) date = missing_date;
  result.dated = date.has_value();
  if (const auto control = joined_header(headers, "cache-control")) {
    std::size_t start = 0;
    while (start <= control->size()) {
      const auto comma = control->find(',', start);
      const std::string_view component = std::string_view(*control).substr(start, comma == std::string::npos ? std::string::npos : comma - start);
      if (contains(component, "no-cache") || contains(component, "no-store") || ends_with(component, "max-age=0")) {
        result.storable = false;
        break;
      }
      if (const auto at = component.find("max-age="); at != std::string_view::npos) {
        const auto seconds = integer_value(component.substr(at + 8));
        result.stale_at = date ? std::optional<double>(*date + static_cast<double>(seconds) * 1000.0) : std::nullopt;
      }
      if (comma == std::string::npos) break;
      start = comma + 1;
    }
  }
  if (result.storable && !result.stale_at && date) {
    if (const auto expires = joined_header(headers, "expires")) {
      result.stale_at = parse_http_date(*expires);
    } else if (const auto modified = joined_header(headers, "last-modified")) {
      if (const auto last = parse_http_date(*modified)) result.stale_at = *date + (*date - *last) / 10;
    }
  }
  return result;
}

// NSURLRequestCachePolicy as RN's ImageSource.cache names it.
enum class CachePolicy { Default, Reload, ForceCache, OnlyIfCached };

inline const char *policy_name(CachePolicy policy) {
  switch (policy) {
    case CachePolicy::Reload: return "reload";
    case CachePolicy::ForceCache: return "force-cache";
    case CachePolicy::OnlyIfCached: return "only-if-cached";
    case CachePolicy::Default: break;
  }
  return "default";
}

// A request whose headers carry a credential. Both caches are keyed by the URL (and the picture's size and scale), so a response fetched
// with a credential could answer a request that carries none, or another's. RN iOS keys RCTImageCache and NSURLCache by URL too; this host
// takes the safer rule instead: such a request neither reads nor writes either cache.
inline bool carries_credentials(const http::Headers &headers) {
  for (const auto &[name, value] : headers) {
    if (http::iequals(name, "authorization") || http::iequals(name, "proxy-authorization") || http::iequals(name, "cookie")) return true;
  }
  return false;
}

// What a cache holds for a request: an entry, and whether it has gone stale.
struct Lookup {
  bool present{};
  bool stale{};
};

// Where the picture of an http(s) request comes from.
enum class Route {
  // The decoded cache holds the picture itself.
  DecodedPicture,
  // The byte cache holds the response: it is decoded again.
  CachedBytes,
  // The network is asked.
  Download,
  // The policy wants the caches alone, and neither has it.
  RefuseOnlyIfCached,
};

// RCTImageLoader's order. A picture for an Image (`view`) is looked for in the decoded cache first, unless the request reloads
// (cacheResult is NO for NSURLRequestReloadIgnoringLocalCacheData); a GET without a body is then looked for in the byte cache,
// where the default policy takes a fresh entry only and force-cache and only-if-cached take any; what neither has is downloaded,
// unless the policy asks for the caches alone. The lookups are made as they are needed and no sooner (a decoded hit never touches
// the byte cache), because a lookup moves an entry to the front of its cache. A request that carries credentials asks neither cache (and
// the caller stores nothing of it), so only-if-cached finds nothing for it.
template <typename Decoded, typename Bytes>
Route route(CachePolicy policy, bool view, bool byte_cacheable, bool credentialed, Decoded &&decoded, Bytes &&bytes) {
  if (credentialed) {
    return policy == CachePolicy::OnlyIfCached ? Route::RefuseOnlyIfCached : Route::Download;
  }
  if (view && policy != CachePolicy::Reload) {
    const Lookup found = decoded();
    if (found.present && !found.stale) {
      return Route::DecodedPicture;
    }
  }
  if (policy != CachePolicy::Reload && byte_cacheable) {
    const Lookup found = bytes();
    if (found.present && (policy != CachePolicy::Default || !found.stale)) {
      return Route::CachedBytes;
    }
  }
  return policy == CachePolicy::OnlyIfCached ? Route::RefuseOnlyIfCached : Route::Download;
}

// A byte-limited store of values by key that gives up the least recently used first, and refuses an entry over its limit. It
// knows nothing of the clock: an entry carries the time it goes stale, and whoever asks decides what that means for the policy
// they serve. Host thread only.
template <typename Value>
class ExpiringLru {
 public:
  struct Entry {
    std::string key;
    Value value;
    std::size_t cost{};
    std::optional<double> stale_at;
  };
  struct Stats {
    uint64_t stores{}, rejected{}, evictions{}, expired{}, replaced{};
  };

  ExpiringLru(std::size_t total_limit, std::size_t entry_limit) : total_limit_(total_limit), entry_limit_(entry_limit) {}

  // False, and the cache unchanged, when the entry is over the limit of one entry.
  bool put(std::string key, Value value, std::size_t cost, std::optional<double> stale_at) {
    if (cost > entry_limit_ || cost > total_limit_) {
      ++stats_.rejected;
      return false;
    }
    if (const auto found = index_.find(key); found != index_.end()) {
      bytes_ -= found->second->cost;
      entries_.erase(found->second);
      index_.erase(found);
      ++stats_.replaced;
    }
    entries_.push_front(Entry{key, std::move(value), cost, stale_at});
    index_[std::move(key)] = entries_.begin();
    bytes_ += cost;
    ++stats_.stores;
    while (bytes_ > total_limit_ && entries_.size() > 1) {
      auto &oldest = entries_.back();
      bytes_ -= oldest.cost;
      index_.erase(oldest.key);
      entries_.pop_back();
      ++stats_.evictions;
    }
    return true;
  }
  // The entry, made the most recently used; null when there is none.
  Entry *get(const std::string &key) {
    const auto found = index_.find(key);
    if (found == index_.end()) return nullptr;
    entries_.splice(entries_.begin(), entries_, found->second);
    return &entries_.front();
  }
  // The entry without touching its place in the order.
  const Entry *peek(const std::string &key) const {
    const auto found = index_.find(key);
    return found == index_.end() ? nullptr : &*found->second;
  }
  static bool stale(const Entry &entry, double now) { return entry.stale_at && now > *entry.stale_at; }
  // Drops an entry that has gone stale.
  void expire(const std::string &key) {
    if (erase(key)) ++stats_.expired;
  }
  bool erase(const std::string &key) {
    const auto found = index_.find(key);
    if (found == index_.end()) return false;
    bytes_ -= found->second->cost;
    entries_.erase(found->second);
    index_.erase(found);
    return true;
  }
  void clear() {
    entries_.clear();
    index_.clear();
    bytes_ = 0;
  }
  std::size_t size() const { return entries_.size(); }
  std::size_t bytes() const { return bytes_; }
  std::size_t total_limit() const { return total_limit_; }
  std::size_t entry_limit() const { return entry_limit_; }
  const Stats &stats() const { return stats_; }
  // From the most to the least recently used.
  std::vector<std::string> keys() const {
    std::vector<std::string> result;
    for (const auto &entry : entries_) result.push_back(entry.key);
    return result;
  }

 private:
  std::size_t total_limit_, entry_limit_;
  std::list<Entry> entries_;
  std::unordered_map<std::string, typename std::list<Entry>::iterator> index_;
  std::size_t bytes_{};
  Stats stats_;
};

}  // namespace fabric_godot::image
