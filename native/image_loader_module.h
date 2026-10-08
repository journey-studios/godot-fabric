#pragma once
#include <memory>

namespace fabric_godot {
class ImageLoader;
class TurboModuleRegistry;

// RN's ImageLoader TurboModule (NativeImageLoaderIOS, which Image.ios.js requires when it loads) over the host's loader.
// getSize and getSizeWithHeaders read the size of a source off the main thread (an http(s) one is downloaded, or answered
// from the byte cache) and answer with the iOS result shapes and error codes; prefetch loads a picture so that the byte cache
// has it, and queryCache reports the URLs that cache holds a response for.
void install_image_loader_module(TurboModuleRegistry &registry, std::shared_ptr<ImageLoader> loader);
// The certification fixture of the "images-fixture" scenario: a module with which JS holds the loader's workers, limits
// its jobs in flight, sets its upload budget and the most bytes of one response it accepts, so that a test can have a decode in
// flight for as long as it needs, and which makes the loader fingerprint the pixels it decodes. It exists in no other scenario.
void install_image_loader_fixture(TurboModuleRegistry &registry, std::shared_ptr<ImageLoader> loader);

}  // namespace fabric_godot
