/*
 * Godot platform TextLayoutManager.
 *
 * React Native selects one TextLayoutManager per platform directory. This one
 * keeps the public surface of RN's portable `cxx` manager and adds the virtual
 * `measureLines` that ParagraphShadowNode looks for through
 * TextLayoutManagerExtended::supportsLineMeasurement(): its `onTextLayout`
 * event and the Yoga baseline callback both come from it. The Godot host
 * (native/paragraph_layout.h) overrides both `measure` and `measureLines` over
 * one shaped paragraph.
 *
 * The portable manager's license applies to the parts kept from it:
 * Copyright (c) Meta Platforms, Inc. and affiliates, MIT license.
 */

#pragma once

#include <react/renderer/attributedstring/AttributedStringBox.h>
#include <react/renderer/attributedstring/ParagraphAttributes.h>
#include <react/renderer/core/LayoutConstraints.h>
#include <react/renderer/graphics/Size.h>
#include <react/renderer/textlayoutmanager/TextLayoutContext.h>
#include <react/renderer/textlayoutmanager/TextMeasureCache.h>
#include <react/utils/ContextContainer.h>
#include <memory>

namespace facebook::react {

class TextLayoutManager;

/*
 * Cross platform facade for text measurement (e.g. Android-specific
 * TextLayoutManager)
 */
class TextLayoutManager {
 public:
  explicit TextLayoutManager(const std::shared_ptr<const ContextContainer> &contextContainer);
  virtual ~TextLayoutManager() = default;

  /*
   * Not copyable.
   */
  TextLayoutManager(const TextLayoutManager &) = delete;
  TextLayoutManager &operator=(const TextLayoutManager &) = delete;

  /*
   * Not movable.
   */
  TextLayoutManager(TextLayoutManager &&) = delete;
  TextLayoutManager &operator=(TextLayoutManager &&) = delete;

  /*
   * Measures `attributedString` using native text rendering infrastructure.
   */
  virtual TextMeasurement measure(
      const AttributedStringBox &attributedStringBox,
      const ParagraphAttributes &paragraphAttributes,
      const TextLayoutContext &layoutContext,
      const LayoutConstraints &layoutConstraints) const;

  /*
   * Reports the lines of `attributedString` laid out in `size`, in the
   * LineMeasurement format of RN's iOS/Android managers. The portable default
   * has no text engine and reports no lines.
   */
  virtual LinesMeasurements measureLines(
      const AttributedStringBox &attributedStringBox,
      const ParagraphAttributes &paragraphAttributes,
      const Size &size) const;

 protected:
  std::shared_ptr<const ContextContainer> contextContainer_;
  TextMeasureCache textMeasureCache_;
};

} // namespace facebook::react
