#include "blob_store.h"
#include "http_core.h"
#include <iostream>
#include <stdexcept>
#include <string>

using namespace fabric_godot::http;

namespace {
void require(bool condition, const char *message) {
  if (!condition) throw std::runtime_error(message);
}
template <typename T> void require_equal(const T &actual, const T &expected, const char *message) {
  if (!(actual == expected)) throw std::runtime_error(std::string(message) + ": got <" + std::string(actual) + ">, expected <" + std::string(expected) + ">");
}
Url url(const std::string &text) {
  std::string error;
  auto parsed = parse_url(text, &error);
  require(parsed.has_value(), error.c_str());
  return *parsed;
}

void urls_are_canonicalized_like_okhttp() {
  require_equal(url("http://127.0.0.1:8080").to_string(), std::string("http://127.0.0.1:8080/"), "An empty path becomes /");
  require_equal(url("HTTPS://Example.COM/a b?x=1 2#frag").to_string(), std::string("https://example.com/a%20b?x=1%202"),
      "The scheme and host fold, spaces are escaped and the fragment is dropped");
  require_equal(url("https://example.com:443/x").to_string(), std::string("https://example.com/x"), "The default port is left out");
  require_equal(url("http://example.com:81/x").authority(), std::string("example.com:81"), "Another port stays");
  require_equal(url("http://[::1]:3000/p").to_string(), std::string("http://[::1]:3000/p"), "IPv6 literals keep their brackets");
  require_equal(url("http://user:secret@host/path").to_string(), std::string("http://host/path"), "User info is never sent");
  require_equal(url("http://host/a/../b/./c").target, std::string("/b/c"), "Dot segments are removed");
  require_equal(url("http://host/a/b/..").target, std::string("/a/"), "A trailing .. leaves the slash");
  require_equal(url("http://host?q=1").target, std::string("/?q=1"), "A query without a path gets /");
  require_equal(url("http://host/%41%zz/é").target, std::string("/%41%zz/%C3%A9"), "Escapes are kept and non-ASCII is percent-encoded");
  require_equal(url("http://host/../../x").target, std::string("/x"), "The root cannot be climbed out of");
  std::string error;
  require(!parse_url("ftp://host/", &error) && error.find("'ftp'") != std::string::npos, "Only http and https are accepted");
  require(!parse_url("host/path", &error), "A scheme is required");
  require(!parse_url("http://", &error) && !parse_url("http:///x", &error), "A host is required");
  require(!parse_url("http://host:0/", &error) && !parse_url("http://host:65536/", &error) && !parse_url("http://host:abc/", &error),
      "The port must be 1 to 65535");
  require(!parse_url("http://ho st/", &error) && !parse_url("http://hóst/", &error), "A host holds no spaces or non-ASCII");
}

void references_resolve_against_the_current_url() {
  const auto base = url("http://a.test:8080/dir/page?old=1");
  require_equal(resolve_reference(base, "/root")->to_string(), std::string("http://a.test:8080/root"), "Absolute path");
  require_equal(resolve_reference(base, "next")->to_string(), std::string("http://a.test:8080/dir/next"), "Relative path");
  require_equal(resolve_reference(base, "../up?x=2#f")->to_string(), std::string("http://a.test:8080/up?x=2"), "Parent segment and query");
  require_equal(resolve_reference(base, "?only=1")->to_string(), std::string("http://a.test:8080/dir/page?only=1"), "Query only");
  require_equal(resolve_reference(base, "//b.test/x")->to_string(), std::string("http://b.test/x"), "Network-path keeps the scheme");
  require_equal(resolve_reference(base, "https://c.test/y")->to_string(), std::string("https://c.test/y"), "Absolute URL");
  require_equal(resolve_reference(base, "  /padded  ")->to_string(), std::string("http://a.test:8080/padded"), "Padding is ignored");
  require(!resolve_reference(base, "ftp://c.test/y") && !resolve_reference(base, "mailto:x@y.test"), "Other schemes do not resolve");
}

Headers headers(std::initializer_list<std::pair<const char *, const char *>> list) {
  Headers result;
  for (const auto &[name, value] : list) result.emplace_back(name, value);
  return result;
}

void redirects_follow_okhttp_rules() {
  const auto from = url("http://a.test/start");
  const auto request = headers({{"content-type", "text/plain"}, {"content-length", "3"}, {"authorization", "Bearer x"},
      {"host", "a.test"}, {"x-keep", "1"}});
  auto moved = [&](const std::string &method, int status, const char *location) {
    return plan_redirect(method, status, from, request, headers({{"Location", location}}));
  };
  for (const int status : {301, 302, 303}) {
    const auto post = moved("POST", status, "/next");
    require(post && post->method == "GET" && !post->keep_body, "301, 302 and 303 turn a POST into a GET without a body");
    require(!find_header(post->headers, "content-type") && !find_header(post->headers, "content-length") &&
        find_header(post->headers, "authorization") && find_header(post->headers, "x-keep") && !find_header(post->headers, "host"),
        "The body headers and Host go, other headers stay on the same origin");
  }
  for (const int status : {307, 308}) {
    const auto post = moved("POST", status, "/next");
    require(post && post->method == "POST" && post->keep_body && find_header(post->headers, "content-type"), "307 and 308 keep method and body");
  }
  require(moved("HEAD", 302, "/next")->method == "HEAD" && moved("GET", 301, "/next")->method == "GET", "GET and HEAD keep their method");
  const auto cross = moved("GET", 302, "http://b.test/x");
  require(cross && !find_header(cross->headers, "authorization") && find_header(cross->headers, "x-keep"),
      "Authorization does not cross origins");
  require(!moved("GET", 200, "/next") && !moved("GET", 304, "/next") && !moved("GET", 300, "/next"), "Only 301, 302, 303, 307 and 308 redirect");
  require(!plan_redirect("GET", 302, from, request, headers({})) && !plan_redirect("GET", 302, from, request, headers({{"location", "  "}})),
      "No Location, no redirect");
  require(!moved("GET", 302, "ftp://b.test/x"), "A redirect to an unsupported scheme is delivered, not followed");
  const auto https = moved("GET", 302, "https://a.test/secure");
  require(https && https->url.tls() && !find_header(https->headers, "authorization"), "Changing the scheme changes the origin");
}

void redirects_can_drop_every_header_as_the_ios_image_loader_does() {
  const auto from = url("http://a.test/start");
  const auto request = headers({{"content-type", "text/plain"}, {"content-length", "3"}, {"authorization", "Bearer x"}, {"host", "a.test"}, {"x-keep", "1"}});
  const auto moved = [&](const std::string &method, int status, const char *location, bool drop) {
    return plan_redirect(method, status, from, request, headers({{"Location", location}}), drop);
  };
  for (const char *location : {"/next", "http://b.test/x", "https://a.test/secure"}) {
    const auto next = moved("GET", 302, location, true);
    require(next && next->headers.empty(), "A redirect that drops headers carries none, on the same origin or across");
    const auto kept = moved("GET", 302, location, false);
    require(kept && find_header(kept->headers, "x-keep") && !find_header(kept->headers, "host"), "Off by default: the OkHttp rules apply");
  }
  const auto post = moved("POST", 307, "/next", true);
  require(post && post->method == "POST" && post->keep_body && post->headers.empty(), "The method and the body follow their own rules");
  const auto get = moved("POST", 302, "/next", true);
  require(get && get->method == "GET" && !get->keep_body && get->headers.empty(), "A POST that becomes a GET carries none either");
  require(plan_redirect("GET", 302, from, request, headers({{"Location", "/next"}})) && plan_redirect("GET", 302, from, request, headers({{"Location", "/next"}}))->headers.size() == 2,
      "The argument is optional: the call every other caller makes is unchanged (the body headers and host go, authorization and x-keep stay)");
}

void headers_follow_android() {
  const auto joined = join_duplicate_headers(headers({{"Set-Cookie", "a=1"}, {"X-Multi", "one"}, {"set-cookie", "b=2"}, {"Set-Cookie", "c=3"}, {"X-Multi", "two"}}));
  require(joined.size() == 3 && joined[0] == std::make_pair(std::string("Set-Cookie"), std::string("a=1, c=3")) &&
      joined[1] == std::make_pair(std::string("X-Multi"), std::string("one, two")) &&
      joined[2] == std::make_pair(std::string("set-cookie"), std::string("b=2")),
      "Duplicates of a name as received are joined with a comma in arrival order");
  require_equal(strip_header_name(" X-Cu\tstom\xC3\xA9 "), std::string("X-Custom"), "Only printable ASCII survives in a name");
}

void header_validation_rejects_splitting() {
  require(valid_header_name("X-Custom_1.a") && !valid_header_name("") && !valid_header_name("a:b") && !valid_header_name("a b") &&
      !valid_header_name("a(b)"), "Names are tokens");
  require(valid_header_value("a, b; c=\"d\"") && valid_header_value("") && !valid_header_value("a\r\nX: y") && !valid_header_value("a\nb") &&
      !valid_header_value(std::string("a\0b", 3)), "Values hold no line breaks");
}

void media_types() {
  require_equal(media_type_parameter("text/plain; charset=\"ISO-8859-1\"; x=y", "charset"), std::string("ISO-8859-1"), "Quoted parameter");
  require_equal(media_type_parameter("text/plain;Charset=utf-8", "charset"), std::string("utf-8"), "Parameter names fold");
  require_equal(media_type_parameter("text/plain", "charset"), std::string(""), "No parameter");
  require_equal(media_type_essence("Text/HTML; charset=utf-8"), std::string("text/html"), "Essence");
  require_equal(media_type_essence("garbage"), std::string(""), "No essence without a slash");
}

void text_is_decoded_like_okhttp() {
  const std::string text = "Ol\xC3\xA1 \xE6\x97\xA5\xE6\x9C\xAC \xF0\x9F\x98\x80";
  require_equal(decode_text(text, Charset::Utf8, false), text, "Valid UTF-8 is untouched");
  require_equal(decode_text(std::string("a\xFF" "b\xC3", 4), Charset::Utf8, false), std::string("a\xEF\xBF\xBD" "b\xEF\xBF\xBD"), "Invalid bytes become U+FFFD");
  require_equal(decode_text("\xE0\x80\x80", Charset::Utf8, false), std::string("\xEF\xBF\xBD\xEF\xBF\xBD\xEF\xBF\xBD"), "Overlong forms are rejected byte by byte");
  require_equal(decode_text("\xED\xA0\x80", Charset::Utf8, false), std::string("\xEF\xBF\xBD\xEF\xBF\xBD\xEF\xBF\xBD"), "Surrogates are rejected");
  require_equal(decode_text("a\xE7" "\xE3o", Charset::Latin1, false), std::string("a\xC3\xA7\xC3\xA3o"), "ISO-8859-1");
  require_equal(decode_text("a\xE7", Charset::Ascii, false), std::string("a\xEF\xBF\xBD"), "US-ASCII");
  require_equal(decode_text("\xEF\xBB\xBFx", Charset::Utf8, true), std::string("x"), "A UTF-8 BOM is removed when honored");
  require_equal(decode_text("\xEF\xBB\xBFx", Charset::Utf8, false), std::string("\xEF\xBB\xBFx"), "And kept otherwise");
  require_equal(decode_text(std::string("\xFF\xFE" "a\0\x3D\xD8\x00\xDE", 8), Charset::Utf8, true), std::string("a\xF0\x9F\x98\x80"), "A UTF-16LE BOM picks UTF-16LE and pairs surrogates");
  require_equal(decode_text(std::string("\0a\xD8\x3D", 4), Charset::Utf16Be, false), std::string("a\xEF\xBF\xBD"), "A lone surrogate is replaced");
  require(charset_from_name("UTF-8") == Charset::Utf8 && charset_from_name("") == Charset::Utf8 && charset_from_name(" Latin1 ") == Charset::Latin1 &&
      charset_from_name("ISO-8859-1") == Charset::Latin1 && charset_from_name("shift_jis") == Charset::Unknown, "Charset names");
  require_equal(*encode_text("a\xC3\xA7\xE2\x82\xAC", Charset::Latin1), std::string("a\xE7?"), "Latin-1 encodes what it has and '?' for the rest");
  require_equal(*encode_text("\xC3\xA7", Charset::Ascii), std::string("?"), "ASCII encodes only ASCII");
  require(!encode_text("x", Charset::Utf16Le), "Wide charsets are not written");
}

void base64_round_trips() {
  require_equal(base64_encode(""), std::string(""), "empty");
  require_equal(base64_encode("f"), std::string("Zg=="), "one byte");
  require_equal(base64_encode("fo"), std::string("Zm8="), "two bytes");
  require_equal(base64_encode("foo"), std::string("Zm9v"), "three bytes");
  std::string all;
  for (int i = 0; i < 256; ++i) all.push_back(static_cast<char>(i));
  require(base64_decode(base64_encode(all)) == all, "Every byte value survives");
  require(base64_decode("Zm9v\nYmFy") == std::string("foobar") && base64_decode("Zg") == std::string("f") && base64_decode("-_-_") == base64_decode("+/+/"),
      "Whitespace, missing padding and the URL alphabet are accepted");
  require(!base64_decode("Zm9v!") && !base64_decode("Z") && !base64_decode("Zg==Zg"), "Anything else is invalid");
}

void multipart_bodies_have_the_wire_shape() {
  std::vector<MultipartPart> parts;
  parts.push_back({headers({{"content-disposition", "form-data; name=\"a\""}}), std::nullopt, "one"});
  parts.push_back({headers({{"content-disposition", "form-data; name=\"b\"; filename=\"f.txt\""}}), std::string("text/plain"), "two"});
  require_equal(build_multipart("XYZ", parts),
      std::string("--XYZ\r\ncontent-disposition: form-data; name=\"a\"\r\n\r\none\r\n"
                  "--XYZ\r\ncontent-disposition: form-data; name=\"b\"; filename=\"f.txt\"\r\nContent-Type: text/plain\r\n\r\ntwo\r\n--XYZ--\r\n"),
      "Parts, their headers and the closing delimiter");
}

void blob_store_keeps_bytes_by_id() {
  fabric_godot::BlobStore store;
  const auto id = store.new_id();
  const auto hex = [](char c) { return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'); };
  bool shape = id.size() == 36 && id[8] == '-' && id[13] == '-' && id[14] == '4' && id[18] == '-' && id[23] == '-' &&
      (id[19] == '8' || id[19] == '9' || id[19] == 'a' || id[19] == 'b');
  for (std::size_t i = 0; i < id.size(); ++i) shape = shape && (i == 8 || i == 13 || i == 18 || i == 23 ? id[i] == '-' : hex(id[i]));
  require(shape, "A new id is a lower-case version 4 UUID, the format BlobManager creates");
  require(store.new_id() != id, "Ids differ");
  store.store("a", "hello world");
  fabric_godot::BlobStore::View view;
  using Resolution = fabric_godot::BlobStore::Resolution;
  require(store.resolve("a", 0, -1, view) == Resolution::Found && view.bytes() == "hello world", "A whole blob");
  require(store.resolve("a", 6, 5, view) == Resolution::Found && view.bytes() == "world", "A slice by offset and size");
  require(store.resolve("a", 6, -1, view) == Resolution::Found && view.bytes() == "world", "Size -1 reaches the end");
  require(store.resolve("a", 11, -1, view) == Resolution::Found && view.bytes().empty(), "An empty slice at the end");
  require(store.resolve("a", 12, -1, view) == Resolution::OutOfRange && store.resolve("a", 0, 12, view) == Resolution::OutOfRange &&
      store.resolve("a", -1, 1, view) == Resolution::OutOfRange && store.resolve("a", 0, -2, view) == Resolution::OutOfRange,
      "Ranges outside the blob are refused");
  require(store.resolve("b", 0, -1, view) == Resolution::Missing, "An unknown blob is missing");
  require(store.size_of("a") == 11 && store.size_of("b") == 0 && store.count() == 1 && store.bytes() == 11, "Sizes");
  store.store("a", "xy");
  require(store.count() == 1 && store.bytes() == 2 && store.stored() == 2, "Storing under an id replaces the bytes");
  require(store.resolve("a", 0, -1, view) == Resolution::Found, "The replacement resolves");
  require(store.release("a") && !store.release("a") && store.count() == 0 && store.bytes() == 0 && store.released() == 1, "Release is once");
  require(view.bytes() == "xy", "A view outlives the release of its blob");
  store.store("c", "z");
  store.clear();
  require(store.count() == 0 && store.bytes() == 0, "Clearing empties the store");
}
}

int main() {
  urls_are_canonicalized_like_okhttp();
  references_resolve_against_the_current_url();
  redirects_follow_okhttp_rules();
  redirects_can_drop_every_header_as_the_ios_image_loader_does();
  headers_follow_android();
  header_validation_rejects_splitting();
  media_types();
  text_is_decoded_like_okhttp();
  base64_round_trips();
  multipart_bodies_have_the_wire_shape();
  blob_store_keeps_bytes_by_id();
  std::cout << "HTTP_CORE_PASSED\n";
}
