#pragma once
#include <memory>

namespace fabric_godot {
class ImageLoader;
class TurboModuleRegistry;

// RN's ImageLoader TurboModule (NativeImageLoaderIOS, which Image.ios.js requires when it loads) over the host's loader.
// getSize and getSizeWithHeaders read the size of a local source off the main thread and answer with the iOS result
// shapes and error codes; the host has no decoded-image cache or network loader yet, so prefetch rejects, queryCache finds
// nothing cached, and an http(s) source fails naming the later slice that brings them.
void install_image_loader_module(TurboModuleRegistry &registry, std::shared_ptr<ImageLoader> loader);
// The certification fixture of the "images-fixture" scenario: a module with which JS holds the loader's workers, limits
// its jobs in flight and sets its upload budget, so that a test can have a decode in flight for as long as it needs, and
// which makes the loader fingerprint the pixels it decodes. It exists in no other scenario.
void install_image_loader_fixture(TurboModuleRegistry &registry, std::shared_ptr<ImageLoader> loader);

}  // namespace fabric_godot
