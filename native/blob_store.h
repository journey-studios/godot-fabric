#pragma once

#include <cstddef>
#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <random>
#include <string>
#include <string_view>
#include <utility>

namespace fabric_godot {
// The bytes behind RN's Blob objects, shared by the Networking, BlobModule and
// FileReaderModule of one application. JS names a blob with a UUID it creates,
// native names the ones it creates (a response with responseType "blob") the
// same way, and a blob lives until JS releases it or the application stops.
// Everything runs on Godot's main thread.
class BlobStore {
 public:
  struct View {
    std::shared_ptr<const std::string> data;
    std::size_t offset{};
    std::size_t size{};
    std::string_view bytes() const { return std::string_view(*data).substr(offset, size); }
  };
  enum class Resolution { Found, Missing, OutOfRange };

  // A fresh identifier in the format JS's BlobManager generates (UUID version 4).
  std::string new_id() {
    static constexpr char digits[] = "0123456789abcdef";
    std::string id = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
    for (auto &c : id) {
      if (c != 'x' && c != 'y') continue;
      const unsigned value = static_cast<unsigned>(random_()) & 15u;
      c = digits[c == 'x' ? value : (value & 3u) | 8u];
    }
    return id;
  }
  void store(const std::string &id, std::string bytes) {
    auto found = blobs_.find(id);
    if (found != blobs_.end()) total_bytes_ -= found->second->size();
    total_bytes_ += bytes.size();
    ++stored_;
    blobs_[id] = std::make_shared<const std::string>(std::move(bytes));
  }
  // A slice of a blob; size -1 means "to the end", as in BlobManager's BlobData.
  Resolution resolve(const std::string &id, double offset, double size, View &view) const {
    const auto found = blobs_.find(id);
    if (found == blobs_.end()) return Resolution::Missing;
    const auto length = static_cast<double>(found->second->size());
    if (!(offset >= 0) || offset > length || size < -1 || offset + (size < 0 ? 0 : size) > length) return Resolution::OutOfRange;
    view = {found->second, static_cast<std::size_t>(offset),
        static_cast<std::size_t>(size < 0 ? length - offset : size)};
    return Resolution::Found;
  }
  // The bytes a blob holds, 0 for an unknown one.
  std::size_t size_of(const std::string &id) const {
    const auto found = blobs_.find(id);
    return found == blobs_.end() ? 0 : found->second->size();
  }
  bool release(const std::string &id) {
    const auto found = blobs_.find(id);
    if (found == blobs_.end()) return false;
    total_bytes_ -= found->second->size();
    blobs_.erase(found);
    ++released_;
    return true;
  }
  void clear() {
    blobs_.clear();
    total_bytes_ = 0;
  }
  std::size_t count() const { return blobs_.size(); }
  std::size_t bytes() const { return total_bytes_; }
  std::size_t stored() const { return stored_; }
  std::size_t released() const { return released_; }

 private:
  std::map<std::string, std::shared_ptr<const std::string>> blobs_;
  std::size_t total_bytes_{}, stored_{}, released_{};
  std::mt19937_64 random_{std::random_device{}()};
};
}
