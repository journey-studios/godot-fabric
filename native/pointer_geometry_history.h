#pragma once
#include <react/renderer/core/ShadowNodeFamily.h>
#include <react/renderer/graphics/Point.h>
#include <array>
#include <cstdint>
#include <map>
#include <memory>
#include <optional>

namespace fabric_godot {
// Contact-owned, queue-retained history, bounded to one delivered native sample.
// Unique event replacement can dispatch a newer sample before an older one.
struct PointerGeometryHistory {
  using NativePoint = std::array<double, 2>;
  struct Entry {
    std::weak_ptr<const facebook::react::ShadowNodeFamily> family;
    facebook::react::Point offset;
    NativePoint viewport_point;
  };
  uint64_t submitted{}, projected{};
  std::map<facebook::react::Tag, Entry> targets;

  void begin(uint64_t serial, bool terminal) {
    if (serial > projected) {
      // Terminal callbacks may need the preceding valid native sample, but
      // their serial still supersedes every older queued projection.
      if (!terminal) targets.clear();
      projected = serial;
    }
  }
  void remember(uint64_t serial,
      const facebook::react::ShadowNodeFamily::Shared &family,
      NativePoint viewport_point, facebook::react::Point offset) {
    if (serial == projected)
      targets[family->getTag()] = {family, offset, viewport_point};
  }
  std::optional<facebook::react::Point> previous(
      const facebook::react::ShadowNodeFamily::Shared &family, NativePoint viewport_point) const {
    auto prior = targets.find(family->getTag());
    if (prior == targets.end() || prior->second.family.lock() != family ||
        prior->second.viewport_point != viewport_point) return std::nullopt;
    return prior->second.offset;
  }
};
}
