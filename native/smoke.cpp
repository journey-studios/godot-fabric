#include <hermes/hermes.h>
#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>
#include <react/renderer/components/view/ViewComponentDescriptor.h>
#include <react/renderer/core/RawProps.h>
#include <react/renderer/core/ShadowNodeFragment.h>
#include <react/utils/ContextContainer.h>
#include <iostream>

int main() {
  using namespace facebook::react;
  auto runtime = facebook::hermes::makeHermesRuntime();
  auto result = runtime->evaluateJavaScript(
      std::make_shared<facebook::jsi::StringBuffer>("1 + 2"), "fabric-smoke.js");
  auto context = std::make_shared<ContextContainer>();
  ComponentDescriptorProviderRegistry providers;
  providers.add(concreteComponentDescriptorProvider<ViewComponentDescriptor>());
  auto registry = providers.createComponentDescriptorRegistry({{}, context, nullptr});
  auto &descriptor = registry->at("View");
  auto family = descriptor.createFamily({42, 1, nullptr});
  auto props = descriptor.cloneProps({1, *context}, nullptr,
      RawProps(folly::dynamic::object("width", 120)("height", 44)));
  auto node = descriptor.createShadowNode({props, {}, {}, false}, family);
  std::cout << "Hermes=" << result.asNumber() << " Fabric="
            << node->getComponentName() << " tag=" << node->getTag() << "\n";
}
