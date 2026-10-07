#pragma once

// The pure parts of the host's HTTP support: URLs and redirects, header and
// charset handling, base64 and multipart bodies. Header-only and free of Godot
// and React Native, so http_core_test.cpp can exercise them on their own. The
// behavior follows what RN's Android networking gets from OkHttp, which is the
// contract the Networking module implements.

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace fabric_godot::http {
using Headers = std::vector<std::pair<std::string, std::string>>;

constexpr int max_redirects = 20;

inline char lower_char(char c) { return c >= 'A' && c <= 'Z' ? static_cast<char>(c - 'A' + 'a') : c; }
inline std::string lower(std::string_view text) {
  std::string result(text);
  for (auto &c : result) c = lower_char(c);
  return result;
}
inline bool iequals(std::string_view a, std::string_view b) {
  if (a.size() != b.size()) return false;
  for (std::size_t i = 0; i < a.size(); ++i)
    if (lower_char(a[i]) != lower_char(b[i])) return false;
  return true;
}
// Optional whitespace around a header value (and the CR of a stray line end).
inline std::string_view trim(std::string_view text) {
  while (!text.empty() && (text.front() == ' ' || text.front() == '\t')) text.remove_prefix(1);
  while (!text.empty() && (text.back() == ' ' || text.back() == '\t' || text.back() == '\r' || text.back() == '\n'))
    text.remove_suffix(1);
  return text;
}
inline const std::string *find_header(const Headers &headers, std::string_view name) {
  for (const auto &[key, value] : headers)
    if (iequals(key, name)) return &value;
  return nullptr;
}
inline void remove_headers(Headers &headers, std::string_view name) {
  headers.erase(std::remove_if(headers.begin(), headers.end(),
      [&](const auto &entry) { return iequals(entry.first, name); }), headers.end());
}

// RN's Android HeaderUtil.stripHeaderName: only printable ASCII survives.
inline std::string strip_header_name(std::string_view name) {
  std::string result;
  for (const unsigned char c : name)
    if (c > 0x20 && c < 0x7f) result.push_back(static_cast<char>(c));
  return result;
}
inline bool valid_header_name(std::string_view name) {
  if (name.empty()) return false;
  for (const char c : name) {
    const bool token = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
        std::string_view("!#$%&'*+-.^_`|~").find(c) != std::string_view::npos;
    if (!token) return false;
  }
  return true;
}
// A value with a line break would split the request.
inline bool valid_header_value(std::string_view value) {
  return std::none_of(value.begin(), value.end(), [](char c) { return c == '\r' || c == '\n' || c == '\0'; });
}

// OkHttp's Headers-to-map conversion, which RN sends to JS: duplicates of one
// name (compared as received) are joined with ", " in the order they arrived.
inline Headers join_duplicate_headers(const Headers &raw) {
  Headers joined;
  for (const auto &[name, value] : raw) {
    auto existing = std::find_if(joined.begin(), joined.end(), [&](const auto &entry) { return entry.first == name; });
    if (existing == joined.end()) joined.emplace_back(name, value);
    else existing->second += ", " + value;
  }
  return joined;
}

// A parameter of a Content-Type style value, "" when absent. Quotes are removed.
inline std::string media_type_parameter(std::string_view value, std::string_view parameter) {
  std::size_t position = value.find(';');
  while (position != std::string_view::npos) {
    const auto next = value.find(';', position + 1);
    auto item = trim(value.substr(position + 1, next == std::string_view::npos ? std::string_view::npos : next - position - 1));
    const auto equals = item.find('=');
    if (equals != std::string_view::npos && iequals(trim(item.substr(0, equals)), parameter)) {
      auto result = trim(item.substr(equals + 1));
      if (result.size() >= 2 && result.front() == '"' && result.back() == '"') result = result.substr(1, result.size() - 2);
      return std::string(result);
    }
    position = next;
  }
  return {};
}
// "type/subtype" without parameters, lower-cased; "" when the value has none.
inline std::string media_type_essence(std::string_view value) {
  const auto end = value.find(';');
  const auto essence = trim(value.substr(0, end));
  return essence.find('/') == std::string_view::npos ? std::string() : lower(essence);
}

struct Url {
  std::string scheme;  // "http" or "https"
  std::string host;    // lower case, IPv6 without brackets
  int port{};
  std::string target;  // path and query, never empty, always starting with "/"
  bool tls() const { return scheme == "https"; }
  bool default_port() const { return port == (tls() ? 443 : 80); }
  // host[:port] as a Host header writes it: IPv6 bracketed, the default port left out.
  std::string authority() const {
    std::string result = host.find(':') == std::string::npos ? host : "[" + host + "]";
    if (!default_port()) result += ":" + std::to_string(port);
    return result;
  }
  std::string to_string() const { return scheme + "://" + authority() + target; }
  bool same_origin(const Url &other) const { return scheme == other.scheme && host == other.host && port == other.port; }
};

// Percent-encodes what a request target cannot carry (controls, space, non-ASCII
// and the characters RFC 3986 excludes), leaving existing escapes alone.
inline std::string encode_target(std::string_view target) {
  static constexpr char digits[] = "0123456789ABCDEF";
  std::string result;
  for (const unsigned char c : target) {
    const bool keep = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
        std::string_view("-._~!$&'()*+,;=:@/?%[]").find(static_cast<char>(c)) != std::string_view::npos;
    if (keep) {
      result.push_back(static_cast<char>(c));
    } else {
      result.push_back('%');
      result.push_back(digits[c >> 4]);
      result.push_back(digits[c & 15]);
    }
  }
  return result;
}

inline std::string remove_dot_segments(std::string_view path) {
  std::vector<std::string> output;
  std::size_t start = 0;
  bool trailing_slash = false;
  while (start <= path.size()) {
    auto end = path.find('/', start);
    const bool last = end == std::string_view::npos;
    const auto segment = path.substr(start, last ? std::string_view::npos : end - start);
    if (segment == "..") {
      // The first element is the empty segment before the leading "/": never removed.
      if (output.size() > 1) output.pop_back();
      trailing_slash = last;
    } else if (segment == ".") {
      trailing_slash = last;
    } else {
      output.emplace_back(segment);
      trailing_slash = false;
    }
    if (last) break;
    start = end + 1;
  }
  std::string result;
  for (std::size_t i = 0; i < output.size(); ++i) {
    if (i > 0) result += "/";
    result += output[i];
  }
  if (trailing_slash) result += "/";
  return result.empty() ? "/" : result;
}

inline std::optional<Url> parse_url(std::string_view text, std::string *error = nullptr) {
  const auto fail = [&](std::string message) -> std::optional<Url> {
    if (error) *error = std::move(message);
    return std::nullopt;
  };
  const auto colon = text.find(':');
  if (colon == std::string_view::npos) return fail("Expected URL scheme 'http' or 'https' but no scheme was found");
  Url url;
  url.scheme = lower(text.substr(0, colon));
  if (url.scheme != "http" && url.scheme != "https")
    return fail("Expected URL scheme 'http' or 'https' but was '" + url.scheme + "'");
  auto rest = text.substr(colon + 1);
  if (rest.substr(0, 2) != "//") return fail("Expected '//' after the URL scheme");
  rest.remove_prefix(2);
  const auto authority_end = rest.find_first_of("/?#");
  auto authority = rest.substr(0, authority_end);
  auto remainder = authority_end == std::string_view::npos ? std::string_view() : rest.substr(authority_end);
  if (const auto at = authority.rfind('@'); at != std::string_view::npos) authority.remove_prefix(at + 1);  // user info is never sent
  std::string_view host, port_text;
  if (!authority.empty() && authority.front() == '[') {
    const auto close = authority.find(']');
    if (close == std::string_view::npos) return fail("Invalid URL host: " + std::string(authority));
    host = authority.substr(1, close - 1);
    const auto after = authority.substr(close + 1);
    if (!after.empty()) {
      if (after.front() != ':') return fail("Invalid URL host: " + std::string(authority));
      port_text = after.substr(1);
    }
  } else {
    const auto port_colon = authority.rfind(':');
    host = authority.substr(0, port_colon);
    if (port_colon != std::string_view::npos) port_text = authority.substr(port_colon + 1);
  }
  if (host.empty()) return fail("Invalid URL host: \"" + std::string(authority) + "\"");
  const bool ipv6 = host.find(':') != std::string_view::npos;
  for (const unsigned char c : host) {
    const bool ok = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '-' || c == '.' ||
        c == '_' || (ipv6 && c == ':');
    if (!ok) return fail("Invalid URL host: \"" + std::string(host) + "\"");
  }
  url.host = lower(host);
  url.port = url.tls() ? 443 : 80;
  if (!port_text.empty()) {
    int value = 0;
    for (const char c : port_text) {
      if (c < '0' || c > '9' || (value = value * 10 + (c - '0')) > 65535)
        return fail("Invalid URL port: \"" + std::string(port_text) + "\"");
    }
    if (value < 1) return fail("Invalid URL port: \"" + std::string(port_text) + "\"");
    url.port = value;
  }
  remainder = remainder.substr(0, remainder.find('#'));
  std::string target(remainder);
  if (target.empty() || target.front() == '?') target = "/" + target;
  const auto query = target.find('?');
  const auto path = remove_dot_segments(std::string_view(target).substr(0, query));
  url.target = encode_target(path + (query == std::string::npos ? "" : target.substr(query)));
  return url;
}

inline bool has_scheme(std::string_view reference) {
  if (reference.empty() || !((reference[0] >= 'a' && reference[0] <= 'z') || (reference[0] >= 'A' && reference[0] <= 'Z')))
    return false;
  for (std::size_t i = 1; i < reference.size(); ++i) {
    const char c = reference[i];
    if (c == ':') return true;
    const bool ok = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '+' || c == '-' || c == '.';
    if (!ok) return false;
  }
  return false;
}

// RFC 3986 reference resolution for a Location header. A reference whose scheme
// is not http or https resolves to nothing, as OkHttp's HttpUrl.resolve.
inline std::optional<Url> resolve_reference(const Url &base, std::string_view reference) {
  while (!reference.empty() && static_cast<unsigned char>(reference.front()) <= 0x20) reference.remove_prefix(1);
  while (!reference.empty() && static_cast<unsigned char>(reference.back()) <= 0x20) reference.remove_suffix(1);
  if (has_scheme(reference)) return parse_url(reference);
  if (reference.substr(0, 2) == "//") return parse_url(base.scheme + ":" + std::string(reference));
  reference = reference.substr(0, reference.find('#'));
  Url result = base;
  if (reference.empty()) return result;
  const auto base_query = base.target.find('?');
  const auto base_path = base.target.substr(0, base_query);
  std::string target;
  if (reference.front() == '?') {
    target = base_path + std::string(reference);
  } else if (reference.front() == '/') {
    target = std::string(reference);
  } else {
    target = base_path.substr(0, base_path.rfind('/') + 1) + std::string(reference);
  }
  const auto query = target.find('?');
  result.target = encode_target(remove_dot_segments(std::string_view(target).substr(0, query)) +
      (query == std::string::npos ? "" : target.substr(query)));
  return result;
}

inline bool is_redirect_status(int status) {
  return status == 301 || status == 302 || status == 303 || status == 307 || status == 308;
}

struct Redirect {
  Url url;
  std::string method;
  bool keep_body{};
  Headers headers;
};

// OkHttp's follow-up request for a redirect response. 301/302/303 turn a method
// that carries a body into a GET without one (GET and HEAD stay as they are),
// 307/308 keep the method and the body. A cross-origin hop drops Authorization,
// and the Host header is always recomputed for the new URL.
inline std::optional<Redirect> plan_redirect(const std::string &method, int status, const Url &from,
    const Headers &request_headers, const Headers &response_headers) {
  if (!is_redirect_status(status)) return std::nullopt;
  const auto *location = find_header(response_headers, "location");
  if (!location || trim(*location).empty()) return std::nullopt;
  auto target = resolve_reference(from, trim(*location));
  if (!target) return std::nullopt;
  Redirect redirect{*target, method, true, request_headers};
  if (method != "GET" && method != "HEAD" && status != 307 && status != 308) {
    redirect.method = "GET";
    redirect.keep_body = false;
  }
  if (method == "GET" || method == "HEAD") redirect.keep_body = false;
  if (!redirect.keep_body) {
    remove_headers(redirect.headers, "content-type");
    remove_headers(redirect.headers, "content-length");
    remove_headers(redirect.headers, "transfer-encoding");
  }
  if (!from.same_origin(*target)) remove_headers(redirect.headers, "authorization");
  remove_headers(redirect.headers, "host");
  return redirect;
}

enum class Charset { Utf8, Latin1, Ascii, Utf16, Utf16Le, Utf16Be, Unknown };

inline Charset charset_from_name(std::string_view name) {
  const auto key = lower(trim(name));
  if (key.empty() || key == "utf-8" || key == "utf8") return Charset::Utf8;
  if (key == "iso-8859-1" || key == "latin1" || key == "iso_8859-1" || key == "l1") return Charset::Latin1;
  if (key == "us-ascii" || key == "ascii") return Charset::Ascii;
  if (key == "utf-16") return Charset::Utf16;
  if (key == "utf-16le") return Charset::Utf16Le;
  if (key == "utf-16be") return Charset::Utf16Be;
  return Charset::Unknown;
}

inline void append_utf8(std::string &out, uint32_t code_point) {
  if (code_point < 0x80) {
    out.push_back(static_cast<char>(code_point));
  } else if (code_point < 0x800) {
    out.push_back(static_cast<char>(0xC0 | (code_point >> 6)));
    out.push_back(static_cast<char>(0x80 | (code_point & 0x3F)));
  } else if (code_point < 0x10000) {
    out.push_back(static_cast<char>(0xE0 | (code_point >> 12)));
    out.push_back(static_cast<char>(0x80 | ((code_point >> 6) & 0x3F)));
    out.push_back(static_cast<char>(0x80 | (code_point & 0x3F)));
  } else {
    out.push_back(static_cast<char>(0xF0 | (code_point >> 18)));
    out.push_back(static_cast<char>(0x80 | ((code_point >> 12) & 0x3F)));
    out.push_back(static_cast<char>(0x80 | ((code_point >> 6) & 0x3F)));
    out.push_back(static_cast<char>(0x80 | (code_point & 0x3F)));
  }
}

// Well-formed UTF-8 from arbitrary bytes: every maximal invalid subpart becomes U+FFFD.
inline std::string sanitize_utf8(std::string_view input) {
  std::string out;
  out.reserve(input.size());
  std::size_t i = 0;
  const auto n = input.size();
  while (i < n) {
    const auto lead = static_cast<unsigned char>(input[i]);
    if (lead < 0x80) {
      out.push_back(static_cast<char>(lead));
      ++i;
      continue;
    }
    std::size_t needed = 0;
    unsigned char lower_bound = 0x80, upper_bound = 0xBF;
    if (lead >= 0xC2 && lead <= 0xDF) {
      needed = 1;
    } else if (lead >= 0xE0 && lead <= 0xEF) {
      needed = 2;
      if (lead == 0xE0) lower_bound = 0xA0;
      if (lead == 0xED) upper_bound = 0x9F;
    } else if (lead >= 0xF0 && lead <= 0xF4) {
      needed = 3;
      if (lead == 0xF0) lower_bound = 0x90;
      if (lead == 0xF4) upper_bound = 0x8F;
    } else {
      out += "\xEF\xBF\xBD";
      ++i;
      continue;
    }
    std::size_t j = i + 1;
    bool complete = true;
    for (std::size_t seen = 0; seen < needed; ++seen, ++j) {
      if (j >= n) { complete = false; break; }
      const auto next = static_cast<unsigned char>(input[j]);
      if (next < lower_bound || next > upper_bound) { complete = false; break; }
      lower_bound = 0x80;
      upper_bound = 0xBF;
    }
    if (complete) {
      out.append(input.substr(i, needed + 1));
      i += needed + 1;
    } else {
      out += "\xEF\xBF\xBD";
      i = j;
    }
  }
  return out;
}

inline std::string decode_utf16(std::string_view bytes, bool big_endian) {
  std::string out;
  std::size_t i = 0;
  const auto unit = [&](std::size_t at) {
    const auto a = static_cast<unsigned char>(bytes[at]), b = static_cast<unsigned char>(bytes[at + 1]);
    return static_cast<uint32_t>(big_endian ? (a << 8) | b : (b << 8) | a);
  };
  while (i + 1 < bytes.size()) {
    const auto first = unit(i);
    i += 2;
    if (first >= 0xD800 && first <= 0xDBFF) {
      if (i + 1 < bytes.size() && unit(i) >= 0xDC00 && unit(i) <= 0xDFFF) {
        append_utf8(out, 0x10000 + ((first - 0xD800) << 10) + (unit(i) - 0xDC00));
        i += 2;
      } else {
        append_utf8(out, 0xFFFD);
      }
    } else if (first >= 0xDC00 && first <= 0xDFFF) {
      append_utf8(out, 0xFFFD);
    } else {
      append_utf8(out, first);
    }
  }
  if (i < bytes.size()) append_utf8(out, 0xFFFD);
  return out;
}

// Bytes to UTF-8 text for a charset. With `honor_bom` a byte order mark picks
// (and is removed from) the encoding, as OkHttp's ResponseBody.string() does.
inline std::string decode_text(std::string_view bytes, Charset charset, bool honor_bom) {
  if (honor_bom) {
    if (bytes.substr(0, 3) == "\xEF\xBB\xBF") {
      bytes.remove_prefix(3);
      charset = Charset::Utf8;
    } else if (bytes.substr(0, 2) == "\xFE\xFF") {
      bytes.remove_prefix(2);
      charset = Charset::Utf16Be;
    } else if (bytes.substr(0, 2) == "\xFF\xFE") {
      bytes.remove_prefix(2);
      charset = Charset::Utf16Le;
    }
  }
  switch (charset) {
    case Charset::Latin1: {
      std::string out;
      for (const unsigned char c : bytes) append_utf8(out, c);
      return out;
    }
    case Charset::Ascii: {
      std::string out;
      for (const unsigned char c : bytes) append_utf8(out, c < 0x80 ? c : 0xFFFD);
      return out;
    }
    case Charset::Utf16:
    case Charset::Utf16Be:
      return decode_utf16(bytes, true);
    case Charset::Utf16Le:
      return decode_utf16(bytes, false);
    case Charset::Utf8:
    case Charset::Unknown:
      return sanitize_utf8(bytes);
  }
  return sanitize_utf8(bytes);
}

// UTF-8 text to the bytes of a charset; characters the charset lacks become '?'.
// Only the charsets with a byte-per-character form are written.
inline std::optional<std::string> encode_text(std::string_view text, Charset charset) {
  if (charset == Charset::Utf8) return std::string(text);
  if (charset != Charset::Latin1 && charset != Charset::Ascii) return std::nullopt;
  const uint32_t limit = charset == Charset::Latin1 ? 0xFF : 0x7F;
  std::string out;
  const auto clean = sanitize_utf8(text);
  for (std::size_t i = 0; i < clean.size();) {
    const auto lead = static_cast<unsigned char>(clean[i]);
    const std::size_t length = lead < 0x80 ? 1 : lead < 0xE0 ? 2 : lead < 0xF0 ? 3 : 4;
    uint32_t code_point = length == 1 ? lead : lead & (0xFF >> (length + 1));
    for (std::size_t k = 1; k < length; ++k) code_point = (code_point << 6) | (static_cast<unsigned char>(clean[i + k]) & 0x3F);
    out.push_back(code_point <= limit ? static_cast<char>(code_point) : '?');
    i += length;
  }
  return out;
}

inline std::string base64_encode(std::string_view bytes) {
  static constexpr char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  out.reserve((bytes.size() + 2) / 3 * 4);
  for (std::size_t i = 0; i < bytes.size(); i += 3) {
    const uint32_t a = static_cast<unsigned char>(bytes[i]);
    const uint32_t b = i + 1 < bytes.size() ? static_cast<unsigned char>(bytes[i + 1]) : 0;
    const uint32_t c = i + 2 < bytes.size() ? static_cast<unsigned char>(bytes[i + 2]) : 0;
    const uint32_t triple = (a << 16) | (b << 8) | c;
    out.push_back(alphabet[(triple >> 18) & 63]);
    out.push_back(alphabet[(triple >> 12) & 63]);
    out.push_back(i + 1 < bytes.size() ? alphabet[(triple >> 6) & 63] : '=');
    out.push_back(i + 2 < bytes.size() ? alphabet[triple & 63] : '=');
  }
  return out;
}

// As Okio's ByteString.decodeBase64: whitespace is skipped, both alphabets are
// accepted and the padding is optional. Anything else is invalid.
inline std::optional<std::string> base64_decode(std::string_view text) {
  std::string out;
  uint32_t buffer = 0;
  int bits = 0;
  std::size_t data_chars = 0;
  std::size_t padding = 0;
  for (const char c : text) {
    if (c == ' ' || c == '\t' || c == '\r' || c == '\n') continue;
    if (c == '=') {
      ++padding;
      continue;
    }
    if (padding) return std::nullopt;  // data after padding
    int value;
    if (c >= 'A' && c <= 'Z') value = c - 'A';
    else if (c >= 'a' && c <= 'z') value = c - 'a' + 26;
    else if (c >= '0' && c <= '9') value = c - '0' + 52;
    else if (c == '+' || c == '-') value = 62;
    else if (c == '/' || c == '_') value = 63;
    else return std::nullopt;
    ++data_chars;
    buffer = (buffer << 6) | static_cast<uint32_t>(value);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push_back(static_cast<char>((buffer >> bits) & 0xFF));
    }
  }
  if (data_chars % 4 == 1 || padding > 2) return std::nullopt;
  return out;
}

struct MultipartPart {
  Headers headers;                         // without Content-Type
  std::optional<std::string> content_type;
  std::string body;
};

inline std::string build_multipart(std::string_view boundary, const std::vector<MultipartPart> &parts) {
  std::string out;
  for (const auto &part : parts) {
    out += "--" + std::string(boundary) + "\r\n";
    for (const auto &[name, value] : part.headers) out += name + ": " + value + "\r\n";
    if (part.content_type) out += "Content-Type: " + *part.content_type + "\r\n";
    out += "\r\n" + part.body + "\r\n";
  }
  out += "--" + std::string(boundary) + "--\r\n";
  return out;
}
}
