#include "image_core.h"
#include "image_geometry.h"
#include <iostream>
#include <stdexcept>
#include <string>

using namespace fabric_godot::image;

namespace {
void require(bool condition, const std::string &message) {
  if (!condition) throw std::runtime_error(message);
}
std::string bytes(std::initializer_list<int> values) {
  std::string out;
  for (const int value : values) out.push_back(static_cast<char>(value));
  return out;
}
std::string pad(std::string head, std::size_t size) {
  head.resize(size, '\0');
  return head;
}

void sources_are_classified_by_scheme() {
  require(classify("res://.godot_fabric/assets/a@2x.png").kind == SourceKind::Bundle, "res:// is the exported project");
  require(classify("RES://x.png").kind == SourceKind::Bundle, "Schemes are case-insensitive");
  require(classify("user://cache/x.png").kind == SourceKind::File, "user:// is a file");
  require(classify("file:///tmp/a%20b.png").path == "/tmp/a b.png", "A file URL is percent-decoded");
  require(classify("file://localhost/tmp/x.png").path == "/tmp/x.png", "localhost is the local host");
  require(classify("file:///C:/dir/x.png").path == "C:/dir/x.png", "A drive path loses the root slash");
  require(classify("file://host/tmp/x.png").kind == SourceKind::Unsupported, "Another host is not a local path");
  const auto network = classify("https://example.com/a.png");
  require(network.kind == SourceKind::Network && network.reason.find("later slice") != std::string::npos, "http(s) names the later slice");
  require(classify("").kind == SourceKind::Unsupported, "An empty URI is refused");
  require(classify("logo.png").kind == SourceKind::Unsupported, "A bare path is refused");
  const auto base64 = classify("data:image/png;base64,QUJD");
  require(base64.kind == SourceKind::Data && base64.base64 && base64.media_type == "image/png" && data_uri_bytes(base64) == std::optional<std::string>("ABC"),
      "A base64 data URI decodes");
  const auto encoded = classify("data:image/svg+xml;charset=utf-8,%3Csvg%3E");
  require(encoded.kind == SourceKind::Data && !encoded.base64 && encoded.media_type == "image/svg+xml" && data_uri_bytes(encoded) == std::optional<std::string>("<svg>"),
      "A percent-encoded data URI decodes");
  require(classify("data:image/png;base64").kind == SourceKind::Unsupported, "A data URI needs its comma");
  require(!data_uri_bytes(classify("data:image/png;base64,@@@")), "Invalid base64 has no bytes");
}

void bundled_files_carry_their_scale_in_the_name() {
  require(bundle_scale("res://assets/logo.png") == 1, "No suffix is scale 1");
  require(bundle_scale("res://assets/logo@2x.png") == 2, "@2x");
  require(bundle_scale("res://assets/logo@3x.webp") == 3, "@3x");
  require(bundle_scale("res://assets/logo@1.5x.png") == 1.5, "@1.5x");
  require(bundle_scale("res://assets/a@b/logo.png") == 1, "An @ elsewhere in the path is not a scale");
  require(bundle_scale("res://assets/logo@x.png") == 1, "An empty scale is 1");
}

void formats_are_sniffed_from_magic_bytes() {
  const auto png = std::string("\x89PNG\r\n\x1a\n", 8) + pad("", 20);
  require(sniff(png, false) == Format::Png, "PNG");
  require(sniff(bytes({0xFF, 0xD8, 0xFF, 0xE0}), false) == Format::Jpeg, "JPEG");
  require(sniff(std::string("RIFF\x10\x00\x00\x00WEBPVP8 ", 16), false) == Format::WebP, "WebP");
  require(sniff("GIF89a....", false) == Format::Gif, "GIF is recognized so that it can be refused by name");
  require(sniff("BM" + pad("", 30), false) == Format::Bmp, "BMP");
  require(sniff("  \n<?xml version='1.0'?><svg width='1'/>", false) == Format::Svg, "SVG after whitespace and a prolog");
  require(sniff("<html><body/></html>", false) == Format::Unknown, "HTML is not an image");
  require(sniff("", false) == Format::Unknown, "Empty bytes are not an image");
  const auto tga = bytes({0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 4, 0, 32, 0});
  require(sniff(tga, false) == Format::Unknown && sniff(tga, true) == Format::Tga, "A TGA header is plausible only when the source says TGA");
  require(sniff(tga + pad("", 8) + "TRUEVISION-XFILE.", false) == Format::Unknown, "The footer must close the file");
  require(sniff(tga + pad("", 8) + std::string("TRUEVISION-XFILE.\0", 18), false) == Format::Tga, "A version 2 footer declares TGA");
}

void headers_give_dimensions() {
  auto png = std::string("\x89PNG\r\n\x1a\n", 8) + bytes({0, 0, 0, 13}) + "IHDR" + bytes({0, 0, 1, 0, 0, 0, 0, 0x80, 8, 6, 0, 0, 0});
  auto size = read_dimensions(Format::Png, png);
  require(size && size->width == 256 && size->height == 128, "PNG IHDR");
  require(!read_dimensions(Format::Png, png.substr(0, 20)), "A truncated PNG header has no size");
  png.replace(12, 4, "IDAT");
  require(!read_dimensions(Format::Png, png), "IHDR must come first");

  const auto jpeg = bytes({0xFF, 0xD8, 0xFF, 0xE0, 0, 4, 0, 0, 0xFF, 0xC0, 0, 11, 8, 0x02, 0x00, 0x03, 0x00, 1, 1, 0x11, 0});
  size = read_dimensions(Format::Jpeg, jpeg);
  require(size && size->width == 768 && size->height == 512, "JPEG SOF0 past an APP0 segment");
  require(!read_dimensions(Format::Jpeg, bytes({0xFF, 0xD8, 0xFF, 0xDA, 0, 2, 0, 0})), "A scan before any frame has no size");

  const auto lossy = "RIFF" + bytes({0x10, 0, 0, 0}) + "WEBPVP8 " + bytes({0x0A, 0, 0, 0, 0, 0, 0, 0x9D, 0x01, 0x2A, 0x40, 0x01, 0xF0, 0x00});
  size = read_dimensions(Format::WebP, lossy);
  require(size && size->width == 320 && size->height == 240, "WebP lossy");
  const auto lossless = "RIFF" + bytes({0x10, 0, 0, 0}) + "WEBPVP8L" + bytes({0x0A, 0, 0, 0, 0x2F, 0x3F, 0xC0, 0x0F, 0x00});
  size = read_dimensions(Format::WebP, pad(lossless, 30));
  require(size && size->width == 64 && size->height == 64, "WebP lossless");
  const auto extended = "RIFF" + bytes({0x16, 0, 0, 0}) + "WEBPVP8X" + bytes({0x0A, 0, 0, 0, 0, 0, 0, 0, 0x1F, 0, 0, 0x2F, 0, 0});
  size = read_dimensions(Format::WebP, extended);
  require(size && size->width == 32 && size->height == 48, "WebP extended canvas");

  auto bmp = pad("BM", 14) + bytes({40, 0, 0, 0, 0x10, 0, 0, 0, 0xF0, 0xFF, 0xFF, 0xFF}) + pad("", 12);
  size = read_dimensions(Format::Bmp, bmp);
  require(size && size->width == 16 && size->height == 16, "BMP with a top-down height");

  const auto tga = bytes({0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x08, 0, 0x04, 0, 32, 0});
  size = read_dimensions(Format::Tga, tga);
  require(size && size->width == 8 && size->height == 4, "TGA");

  size = read_dimensions(Format::Svg, "<svg xmlns='http://www.w3.org/2000/svg' width=\"24px\" height='12'><rect/></svg>", 2);
  require(size && size->width == 48 && size->height == 24, "SVG size times the raster scale");
  size = read_dimensions(Format::Svg, "<svg viewBox='0 0 10.5 20'/>", 1);
  require(size && size->width == 11 && size->height == 20, "SVG viewBox is the default size, rounded up");
  require(!read_dimensions(Format::Svg, "<svg width='50%' height='50%'/>"), "A percentage has no pixel size");
}

void absurd_headers_are_refused_before_decoding() {
  require(dimension_problem({16, 16}).empty(), "A small image passes");
  require(dimension_problem({16384, 4096}).empty(), "The pixel limit is in all");
  require(!dimension_problem({0, 10}).empty(), "No pixels");
  require(dimension_problem({65535, 65535}).find("over the host limit") != std::string::npos, "65535 x 65535");
  require(!dimension_problem({16385, 1}).empty(), "One side over the limit");
  require(!dimension_problem({16384, 16384}).empty(), "More pixels than the limit");
}

void decoding_shrinks_to_cover_the_request_and_never_upscales() {
  // RCTDecodeImageWithData: the request is in points, the decode in pixels at the request's scale.
  require((decode_target(400, 400, 50, 50, 2) == PixelSize{100, 100}), "A square image shrinks to the destination in pixels");
  require((decode_target(400, 200, 50, 50, 2) == PixelSize{200, 100}), "A wide image covers the square destination: its short side matches");
  require((decode_target(200, 100, 50, 50, 2) == PixelSize{200, 100}), "An image already at the cover size is decoded whole");
  require((decode_target(100, 100, 200, 200, 2) == PixelSize{100, 100}), "A request larger than the image never upscales it");
  require((decode_target(400, 200, 50, 200, 1) == PixelSize{400, 200}), "A destination that needs exactly the source decodes whole");
  require((decode_target(300, 300, 0, 0, 2) == PixelSize{300, 300}), "A destination with no area decodes whole");
  require((decode_target(400, 400, 50, 0, 1) == PixelSize{50, 50}), "A destination with one side takes the other from the aspect");
  require((decode_target(1000, 500, 101, 33, 3) == PixelSize{303, 152}), "A destination wider than the image is bound by its width: 303 pixels, the height rounds from the aspect");
}

void resize_modes_draw_like_uiimageview() {
  const Size frame{100, 50}, small{40, 40}, big{200, 200};
  const auto stretch = plan(ResizeMode::Stretch, frame, small);
  require(stretch && stretch->dst == Rect{0, 0, 100, 50} && stretch->src == Rect{0, 0, 40, 40}, "stretch fills the frame");
  const auto contain = plan(ResizeMode::Contain, frame, small);
  require(contain && contain->dst == Rect{25, 0, 50, 50} && contain->src == Rect{0, 0, 40, 40}, "contain fits and centers");
  const auto cover = plan(ResizeMode::Cover, frame, small);
  require(cover && cover->dst == Rect{0, 0, 100, 50} && cover->src == Rect{0, 10, 40, 20}, "cover fills the frame and crops the image");
  const auto center = plan(ResizeMode::Center, frame, small);
  require(center && center->dst == Rect{30, 5, 40, 40} && center->src == Rect{0, 0, 40, 40}, "center keeps the size");
  const auto center_big = plan(ResizeMode::Center, frame, big);
  require(center_big && center_big->dst == Rect{0, 0, 100, 50} && center_big->src == Rect{50, 75, 100, 50}, "center clips an image larger than the frame, as UIKit does: it is not scaled down");
  const auto none = plan(ResizeMode::None, frame, small);
  require(none && none->dst == Rect{0, 0, 40, 40}, "none sits at the top-left corner");
  const auto none_big = plan(ResizeMode::None, frame, big);
  require(none_big && none_big->dst == Rect{0, 0, 100, 50} && none_big->src == Rect{0, 0, 100, 50}, "none clips at the right and bottom");
  const auto repeat = plan(ResizeMode::Repeat, frame, small);
  require(repeat && repeat->tiled && repeat->tile.width == 40 && repeat->tile.height == 40 && repeat->dst == Rect{0, 0, 100, 50}, "repeat tiles the image over the frame");
  require(!plan(ResizeMode::Contain, {0, 50}, small) && !plan(ResizeMode::Contain, frame, {0, 10}), "No area, no draw");
  require(!plan(ResizeMode::Center, {10, 10}, {0, 0}), "An image without size is not drawn");
}
}  // namespace

int main() {
  sources_are_classified_by_scheme();
  bundled_files_carry_their_scale_in_the_name();
  formats_are_sniffed_from_magic_bytes();
  headers_give_dimensions();
  absurd_headers_are_refused_before_decoding();
  decoding_shrinks_to_cover_the_request_and_never_upscales();
  resize_modes_draw_like_uiimageview();
  std::cout << "IMAGE_CORE_PASSED\n";
}
