#pragma once

// The pure parts of the host's image loading: where a source URI points, which
// format its bytes are and how large the header says the picture is (read before
// any decoder runs), how far a decode may shrink it, and what a data: URI
// holds. Header-only and free of Godot and React Native, so image_core_test.cpp
// exercises them on their own. The behavior follows what RN's iOS image loader
// (RCTImageLoader.mm, RCTImageUtils.mm) does for the sources this host serves.

#include "http_core.h"
#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace fabric_godot::image {

// What a decode may allocate. Godot's JPEG loader multiplies the header's
// dimensions in 32-bit arithmetic and its PNG loader allocates before it checks
// Image::MAX_PIXELS, so a header that claims an absurd size is refused here,
// before any decoder sees the bytes.
constexpr uint32_t max_dimension = 16384;
constexpr uint64_t max_pixels = 64ull * 1024 * 1024;
// The largest file or data: payload the loader reads.
constexpr uint64_t max_source_bytes = 128ull * 1024 * 1024;

enum class SourceKind { Bundle, File, Data, Network, Unsupported };

struct Source {
  SourceKind kind{SourceKind::Unsupported};
  // The Godot path of a Bundle (res://) or File (user://, an absolute path) source.
  std::string path;
  // A data: URI's media type and payload, still encoded.
  std::string media_type;
  std::string payload;
  bool base64{};
  // Why an Unsupported source cannot be loaded.
  std::string reason;
};

inline std::string percent_decode(std::string_view text) {
  const auto hex = [](char c) -> int {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
  };
  std::string out;
  out.reserve(text.size());
  for (std::size_t i = 0; i < text.size(); ++i) {
    if (text[i] == '%' && i + 2 < text.size() && hex(text[i + 1]) >= 0 && hex(text[i + 2]) >= 0) {
      out.push_back(static_cast<char>(hex(text[i + 1]) * 16 + hex(text[i + 2])));
      i += 2;
    } else {
      out.push_back(text[i]);
    }
  }
  return out;
}

inline bool starts_with_ci(std::string_view text, std::string_view prefix) {
  return text.size() >= prefix.size() && http::iequals(text.substr(0, prefix.size()), prefix);
}

// RCTImageManager hands the loader an NSURL; this host's schemes are the ones the Godot file system serves:
// res:// (the exported project, which is where RN's bundled assets live, as the iOS app bundle is), user://
// and absolute file:// paths (the iOS file request handler's), data: URIs (its data request handler's) and http(s):// ones,
// which the network downloads (the iOS HTTP request handler's).
inline Source classify(std::string_view uri) {
  Source source;
  if (uri.empty()) {
    source.reason = "The image source has an empty URI";
    return source;
  }
  if (starts_with_ci(uri, "res://")) {
    source.kind = SourceKind::Bundle;
    source.path = std::string(uri);
    return source;
  }
  if (starts_with_ci(uri, "user://")) {
    source.kind = SourceKind::File;
    source.path = std::string(uri);
    return source;
  }
  if (starts_with_ci(uri, "file://")) {
    auto rest = uri.substr(7);
    if (starts_with_ci(rest, "localhost/")) rest.remove_prefix(9);
    if (rest.empty() || rest[0] != '/') {
      source.reason = "A file:// image URI needs an absolute path: " + std::string(uri);
      return source;
    }
    auto path = percent_decode(rest);
    // file:///C:/dir/x.png names a drive path, not a root-relative one.
    if (path.size() >= 3 && path[0] == '/' && std::isalpha(static_cast<unsigned char>(path[1])) && path[2] == ':') path.erase(0, 1);
    source.kind = SourceKind::File;
    source.path = std::move(path);
    return source;
  }
  if (starts_with_ci(uri, "data:")) {
    const auto rest = uri.substr(5);
    const auto comma = rest.find(',');
    if (comma == std::string_view::npos) {
      source.reason = "A data: image URI needs a comma before its payload";
      return source;
    }
    auto header = rest.substr(0, comma);
    source.payload = std::string(rest.substr(comma + 1));
    constexpr std::string_view base64_marker = ";base64";
    if (header.size() >= base64_marker.size() && http::iequals(header.substr(header.size() - base64_marker.size()), base64_marker)) {
      source.base64 = true;
      header.remove_suffix(base64_marker.size());
    }
    const auto semicolon = header.find(';');
    source.media_type = http::lower(header.substr(0, semicolon));
    source.kind = SourceKind::Data;
    return source;
  }
  if (starts_with_ci(uri, "http://") || starts_with_ci(uri, "https://")) {
    // Downloaded by the loader's network (image_network.h) before the bytes come here.
    source.kind = SourceKind::Network;
    return source;
  }
  source.reason = "Unsupported image URI \"" + std::string(uri) + "\": this host loads res://, user://, file://, data:, http:// and https:// sources";
  return source;
}

// The bytes a data: URI carries: base64 or percent-encoded, as Foundation's data URL loader reads them.
inline std::optional<std::string> data_uri_bytes(const Source &source) {
  if (source.kind != SourceKind::Data) return std::nullopt;
  if (source.base64) return http::base64_decode(source.payload);
  return percent_decode(source.payload);
}

// The @Nx suffix RN's asset resolver puts on the file of a scale other than 1 (AssetSourceResolver.js getScaledAssetPath), which is
// the scale of a UIImage that RCTImageFromLocalAssetURL loads from the app bundle.
inline double bundle_scale(std::string_view path) {
  const auto dot = path.rfind('.');
  const auto stem = dot == std::string_view::npos ? path : path.substr(0, dot);
  const auto at = stem.rfind('@');
  if (at == std::string_view::npos || stem.empty() || stem.back() != 'x') return 1;
  const auto digits = stem.substr(at + 1, stem.size() - at - 2);
  if (digits.empty()) return 1;
  double value = 0, fraction = 0, place = 1;
  bool seen_dot = false;
  for (const char c : digits) {
    if (c == '.' && !seen_dot) {
      seen_dot = true;
      continue;
    }
    if (c < '0' || c > '9') return 1;
    if (seen_dot) {
      place /= 10;
      fraction += (c - '0') * place;
    } else {
      value = value * 10 + (c - '0');
    }
  }
  const double scale = value + fraction;
  return scale > 0 ? scale : 1;
}

enum class Format { Unknown, Png, Jpeg, WebP, Bmp, Tga, Svg, Gif };

inline const char *format_name(Format format) {
  switch (format) {
    case Format::Png: return "png";
    case Format::Jpeg: return "jpeg";
    case Format::WebP: return "webp";
    case Format::Bmp: return "bmp";
    case Format::Tga: return "tga";
    case Format::Svg: return "svg";
    case Format::Gif: return "gif";
    case Format::Unknown: break;
  }
  return "unknown";
}

inline uint32_t be16(std::string_view b, std::size_t at) {
  return (static_cast<uint32_t>(static_cast<unsigned char>(b[at])) << 8) | static_cast<unsigned char>(b[at + 1]);
}
inline uint32_t be32(std::string_view b, std::size_t at) { return (be16(b, at) << 16) | be16(b, at + 2); }
inline uint32_t le16(std::string_view b, std::size_t at) {
  return (static_cast<uint32_t>(static_cast<unsigned char>(b[at + 1])) << 8) | static_cast<unsigned char>(b[at]);
}
inline uint32_t le24(std::string_view b, std::size_t at) { return le16(b, at) | (static_cast<uint32_t>(static_cast<unsigned char>(b[at + 2])) << 16); }
inline uint32_t le32(std::string_view b, std::size_t at) { return le16(b, at) | (le16(b, at + 2) << 16); }

inline bool looks_like_svg(std::string_view bytes) {
  std::size_t at = 0;
  if (bytes.size() >= 3 && bytes.substr(0, 3) == "\xEF\xBB\xBF") at = 3;
  while (at < bytes.size() && (bytes[at] == ' ' || bytes[at] == '\t' || bytes[at] == '\r' || bytes[at] == '\n')) ++at;
  if (at >= bytes.size() || bytes[at] != '<') return false;
  return bytes.substr(0, 4096).find("<svg") != std::string_view::npos;
}

// A TGA file has no signature before version 2's footer, so its header has to be plausible and the source has to
// say it is one (the footer, a .tga name or an image/x-tga media type).
inline bool looks_like_tga(std::string_view bytes, bool declared) {
  if (bytes.size() < 18) return false;
  const auto type = static_cast<unsigned char>(bytes[2]);
  const auto depth = static_cast<unsigned char>(bytes[16]);
  const auto color_map = static_cast<unsigned char>(bytes[1]);
  const bool plausible = color_map <= 1 && (type == 1 || type == 2 || type == 3 || type == 9 || type == 10 || type == 11) &&
      (depth == 8 || depth == 15 || depth == 16 || depth == 24 || depth == 32);
  if (!plausible) return false;
  constexpr std::string_view footer = "TRUEVISION-XFILE";
  const bool signed_footer = bytes.size() >= 26 && bytes.substr(bytes.size() - 18, footer.size()) == footer;
  return declared || signed_footer;
}

inline Format sniff(std::string_view bytes, bool tga_declared) {
  if (bytes.size() >= 8 && bytes.substr(0, 8) == std::string_view("\x89PNG\r\n\x1a\n", 8)) return Format::Png;
  if (bytes.size() >= 3 && bytes.substr(0, 3) == "\xFF\xD8\xFF") return Format::Jpeg;
  if (bytes.size() >= 12 && bytes.substr(0, 4) == "RIFF" && bytes.substr(8, 4) == "WEBP") return Format::WebP;
  if (bytes.size() >= 6 && (bytes.substr(0, 6) == "GIF87a" || bytes.substr(0, 6) == "GIF89a")) return Format::Gif;
  if (bytes.size() >= 2 && bytes.substr(0, 2) == "BM") return Format::Bmp;
  if (looks_like_svg(bytes)) return Format::Svg;
  if (looks_like_tga(bytes, tga_declared)) return Format::Tga;
  return Format::Unknown;
}

struct Dimensions {
  uint64_t width{}, height{};
};

// The SOFn marker of a JPEG carries the frame size; the scan after it is what a decoder allocates for.
inline std::optional<Dimensions> jpeg_dimensions(std::string_view b) {
  std::size_t at = 2;
  while (at + 4 <= b.size()) {
    if (static_cast<unsigned char>(b[at]) != 0xFF) return std::nullopt;
    const auto marker = static_cast<unsigned char>(b[at + 1]);
    if (marker == 0xFF) {
      ++at;
      continue;
    }
    if (marker == 0x01 || (marker >= 0xD0 && marker <= 0xD8)) {
      at += 2;
      continue;
    }
    if (marker == 0xD9 || marker == 0xDA) return std::nullopt;
    const bool frame = marker >= 0xC0 && marker <= 0xCF && marker != 0xC4 && marker != 0xC8 && marker != 0xCC;
    if (frame) {
      if (at + 9 > b.size()) return std::nullopt;
      return Dimensions{be16(b, at + 7), be16(b, at + 5)};
    }
    at += 2 + be16(b, at + 2);
  }
  return std::nullopt;
}

inline std::optional<Dimensions> webp_dimensions(std::string_view b) {
  if (b.size() < 16) return std::nullopt;
  const auto chunk = b.substr(12, 4);
  if (chunk == "VP8 ") {
    if (b.size() < 30 || b.substr(23, 3) != std::string_view("\x9D\x01\x2A", 3)) return std::nullopt;
    return Dimensions{le16(b, 26) & 0x3FFF, le16(b, 28) & 0x3FFF};
  }
  if (chunk == "VP8L") {
    if (b.size() < 25 || static_cast<unsigned char>(b[20]) != 0x2F) return std::nullopt;
    const auto bits = le32(b, 21);
    return Dimensions{(bits & 0x3FFF) + 1ull, ((bits >> 14) & 0x3FFF) + 1ull};
  }
  if (chunk == "VP8X") {
    if (b.size() < 30) return std::nullopt;
    return Dimensions{le24(b, 24) + 1ull, le24(b, 27) + 1ull};
  }
  return std::nullopt;
}

inline std::optional<Dimensions> bmp_dimensions(std::string_view b) {
  if (b.size() < 26) return std::nullopt;
  const auto header = le32(b, 14);
  if (header == 12) return Dimensions{le16(b, 18), le16(b, 20)};
  if (header < 40) return std::nullopt;
  const auto width = static_cast<int32_t>(le32(b, 18));
  const auto height = static_cast<int32_t>(le32(b, 22));
  // A negative height is a top-down bitmap; a negative width is not a bitmap.
  if (width < 0) return std::nullopt;
  return Dimensions{static_cast<uint64_t>(width), static_cast<uint64_t>(height < 0 ? -static_cast<int64_t>(height) : height)};
}

// A number with an optional px unit, the only length an <svg> root is rasterized from here (SVG's other units depend
// on a font or a screen this host does not hand the rasterizer).
inline std::optional<double> svg_length(std::string_view text) {
  while (!text.empty() && (text.front() == ' ' || text.front() == '\t')) text.remove_prefix(1);
  while (!text.empty() && (text.back() == ' ' || text.back() == '\t')) text.remove_suffix(1);
  if (text.size() > 2 && text.substr(text.size() - 2) == "px") text.remove_suffix(2);
  if (text.empty()) return std::nullopt;
  double value = 0, place = 1;
  bool seen_dot = false, seen_digit = false;
  for (const char c : text) {
    if (c == '.' && !seen_dot) {
      seen_dot = true;
      continue;
    }
    if (c < '0' || c > '9') return std::nullopt;
    seen_digit = true;
    if (seen_dot) {
      place /= 10;
      value += (c - '0') * place;
    } else {
      value = value * 10 + (c - '0');
    }
  }
  return seen_digit ? std::optional<double>(value) : std::nullopt;
}

inline std::optional<std::string> svg_attribute(std::string_view tag, std::string_view name) {
  for (std::size_t at = 0; (at = tag.find(name, at)) != std::string_view::npos; at += name.size()) {
    const bool boundary = at > 0 && (tag[at - 1] == ' ' || tag[at - 1] == '\t' || tag[at - 1] == '\r' || tag[at - 1] == '\n');
    auto after = at + name.size();
    while (after < tag.size() && tag[after] == ' ') ++after;
    if (!boundary || after >= tag.size() || tag[after] != '=') continue;
    ++after;
    while (after < tag.size() && tag[after] == ' ') ++after;
    if (after >= tag.size() || (tag[after] != '"' && tag[after] != '\'')) continue;
    const auto quote = tag[after];
    const auto end = tag.find(quote, after + 1);
    if (end == std::string_view::npos) return std::nullopt;
    return std::string(tag.substr(after + 1, end - after - 1));
  }
  return std::nullopt;
}

// The pixel size an <svg> root asks for: its width and height, or the viewBox they default to, times the raster scale.
inline std::optional<Dimensions> svg_dimensions(std::string_view bytes, double scale) {
  const auto open = bytes.substr(0, 16384).find("<svg");
  if (open == std::string_view::npos) return std::nullopt;
  const auto close = bytes.find('>', open);
  if (close == std::string_view::npos) return std::nullopt;
  const auto tag = bytes.substr(open, close - open);
  std::optional<double> width, height;
  if (const auto value = svg_attribute(tag, "width")) width = svg_length(*value);
  if (const auto value = svg_attribute(tag, "height")) height = svg_length(*value);
  if (!width || !height) {
    if (const auto box = svg_attribute(tag, "viewBox")) {
      std::string normalized = *box;
      for (auto &c : normalized) if (c == ',') c = ' ';
      std::vector<double> numbers;
      std::size_t at = 0;
      while (at < normalized.size() && numbers.size() < 4) {
        while (at < normalized.size() && normalized[at] == ' ') ++at;
        const auto end = normalized.find(' ', at);
        const auto token = std::string_view(normalized).substr(at, end == std::string::npos ? std::string::npos : end - at);
        if (token.empty()) break;
        const bool negative = token.front() == '-';
        const auto number = svg_length(negative ? token.substr(1) : token);
        if (!number) return std::nullopt;
        numbers.push_back(negative ? -*number : *number);
        at = end == std::string::npos ? normalized.size() : end;
      }
      if (numbers.size() == 4) {
        if (!width) width = numbers[2];
        if (!height) height = numbers[3];
      }
    }
  }
  if (!width || !height || *width <= 0 || *height <= 0 || !(scale > 0)) return std::nullopt;
  return Dimensions{static_cast<uint64_t>(std::ceil(*width * scale)), static_cast<uint64_t>(std::ceil(*height * scale))};
}

// What the header of the bytes says the picture measures, or nullopt when the header is not that of its format.
inline std::optional<Dimensions> read_dimensions(Format format, std::string_view bytes, double svg_scale = 1) {
  switch (format) {
    case Format::Png:
      if (bytes.size() < 24 || bytes.substr(12, 4) != "IHDR") return std::nullopt;
      return Dimensions{be32(bytes, 16), be32(bytes, 20)};
    case Format::Jpeg: return jpeg_dimensions(bytes);
    case Format::WebP: return webp_dimensions(bytes);
    case Format::Bmp: return bmp_dimensions(bytes);
    case Format::Tga:
      if (bytes.size() < 18) return std::nullopt;
      return Dimensions{le16(bytes, 12), le16(bytes, 14)};
    case Format::Svg: return svg_dimensions(bytes, svg_scale);
    case Format::Gif:
      if (bytes.size() < 10) return std::nullopt;
      return Dimensions{le16(bytes, 6), le16(bytes, 8)};
    case Format::Unknown: break;
  }
  return std::nullopt;
}

// The refusal of a header whose size no decoder may be trusted with, or empty when it is acceptable.
inline std::string dimension_problem(const Dimensions &size) {
  if (size.width == 0 || size.height == 0) return "The image has no pixels";
  if (size.width > max_dimension || size.height > max_dimension || size.width * size.height > max_pixels)
    return "The image is " + std::to_string(size.width) + "x" + std::to_string(size.height) + " pixels, over the host limit of " +
        std::to_string(max_dimension) + " pixels a side and " + std::to_string(max_pixels) + " in all";
  return {};
}

struct PixelSize {
  uint64_t width{}, height{};
  bool operator==(const PixelSize &) const = default;
};

// RCTImageUtils.mm RCTCeilSize.
inline double ceil_to_scale(double value, double scale) { return std::ceil(value * scale) / scale; }

// What RCTDecodeImageWithData decodes a picture of (source_width x source_height) pixels at for a request of
// (destination_width x destination_height) points at `scale`: the size that covers the destination (the loader asks
// RCTResizeModeStretch, which the decoder treats as cover), never larger than the source. A destination with no area decodes
// the picture whole.
inline PixelSize decode_target(uint64_t source_width, uint64_t source_height, double destination_width, double destination_height, double scale) {
  const PixelSize whole{source_width, source_height};
  if (!(scale > 0) || source_width == 0 || source_height == 0) return whole;
  if (!(destination_width > 0) && !(destination_height > 0)) return whole;
  const double sw = static_cast<double>(source_width), sh = static_cast<double>(source_height);
  const double aspect = sw / sh;
  double dw = destination_width, dh = destination_height;
  if (!(dw > 0)) dw = dh * aspect;
  if (!(dh > 0)) dh = dw / aspect;
  const double target_aspect = dw / dh;
  double target_w, target_h;
  if (aspect == target_aspect) {
    target_w = ceil_to_scale(dw, scale);
    target_h = ceil_to_scale(dh, scale);
  } else if (target_aspect <= aspect) {
    target_w = ceil_to_scale(dh * aspect, scale);
    target_h = ceil_to_scale(dh, scale);
  } else {
    target_w = ceil_to_scale(dw, scale);
    target_h = ceil_to_scale(dw / aspect, scale);
  }
  // RCTTargetSize returns the source as is when the target would be larger (its comparison is on the width alone).
  if (sw < target_w * scale) return whole;
  const double pixel_w = std::ceil(target_w * scale), pixel_h = std::ceil(target_h * scale);
  if (!(pixel_w > 0 && pixel_h > 0) || !(sw > pixel_w || sh > pixel_h)) return whole;
  // The thumbnail's longer side is the target's longer side; the shorter keeps the source's aspect.
  const double factor = std::max(pixel_w, pixel_h) / std::max(sw, sh);
  return {static_cast<uint64_t>(std::max(1.0, std::round(sw * factor))), static_cast<uint64_t>(std::max(1.0, std::round(sh * factor)))};
}

}  // namespace fabric_godot::image
