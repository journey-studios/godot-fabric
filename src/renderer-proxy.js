// RN's DOM public instances must query the same renderer that owns our roots.
// Importing RendererImplementation also initializes unrelated mobile core APIs.
// Resolve the original CJS exports lazily: either the renderer or a consumer's
// public components can enter the public-instance initialization cycle first.
function renderer() { return require("react-native/Libraries/Renderer/implementations/ReactFabric-prod"); }
export function dispatchCommand(...args) { return renderer().dispatchCommand(...args); }
export function findHostInstance_DEPRECATED(...args) { return renderer().findHostInstance_DEPRECATED(...args); }
export function findNodeHandle(...args) { return renderer().findNodeHandle(...args); }
export function sendAccessibilityEvent(...args) { return renderer().sendAccessibilityEvent(...args); }
export function isChildPublicInstance(...args) { return renderer().isChildPublicInstance(...args); }
export function getNodeFromInternalInstanceHandle(...args) { return renderer().getNodeFromInternalInstanceHandle(...args); }
export function getPublicInstanceFromInternalInstanceHandle(...args) { return renderer().getPublicInstanceFromInternalInstanceHandle(...args); }
export function getPublicInstanceFromRootTag(...args) { return renderer().getPublicInstanceFromRootTag(...args); }
