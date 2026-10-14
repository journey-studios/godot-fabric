import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

// GF-07 slice 5. docs/research/overlays-portals.md designs the overlay and portal needs of a game UI against what React Native 0.87.1
// offers publicly. The design leans on the facts below, so each one is asserted here against the pinned sources and the test fails when
// an RN upgrade changes one: the note then has to be read again. Nothing here runs Godot.

const root = fileURLToPath(new URL("..", import.meta.url));
const rn = path.join(root, "node_modules/react-native");
const require = createRequire(import.meta.url);
const read = (...parts) => readFileSync(path.join(...parts), "utf8");
const readRn = (file) => read(rn, file);
const parse = (file) => ts.createSourceFile(file, readRn(file), ts.ScriptTarget.Latest, true);

const RENDERERS = ["prod", "dev", "profiling"].map((name) => `Libraries/Renderer/implementations/ReactFabric-${name}.js`);
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|flow)$/;

// Every source file under a directory, as paths relative to `base`.
function sourcesUnder(base, directory) {
  const entries = readdirSync(path.join(base, directory), { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && SOURCE_FILE.test(entry.name))
    .map((entry) => path.relative(base, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"));
}
const mentioning = (base, directories, text) =>
  directories.flatMap((directory) => sourcesUnder(base, directory)).filter((file) => read(base, file).includes(text)).sort();

// The names a declaration file exports, whether as values or as types.
function exportedNames(sourceFile) {
  const names = new Set();
  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          names.add(element.name.text);
        }
      } else if (statement.exportClause && ts.isNamespaceExport(statement.exportClause)) {
        names.add(statement.exportClause.name.text);
      }
    } else if (ts.isFunctionDeclaration(statement) && statement.name) {
      names.add(statement.name.text);
    }
  }
  return names;
}

// The property names of `export interface Name` or of `export type Name = { ... }` in a declaration file.
function declaredProps(sourceFile, name) {
  for (const statement of sourceFile.statements) {
    const declares = (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) && statement.name.text === name;
    if (declares) {
      const literal = ts.isInterfaceDeclaration(statement) ? statement : statement.type;
      assert.ok(ts.isInterfaceDeclaration(literal) || ts.isTypeLiteralNode(literal), `${name} is an object type`);
      return literal.members.map((member) => member.name.text).sort();
    }
  }
  throw new Error(`${name} is not declared`);
}

// The keys of `export type Name = { ... };` in a Flow file, read from the lines at the first indentation (comments excluded).
function flowProps(source, name) {
  const start = source.indexOf(`export type ${name} = {`);
  assert.notEqual(start, -1, `${name} is declared in Modal.js`);
  const end = source.indexOf("\n};", start);
  return [...source.slice(start, end).matchAll(/^ {2}(\w+)\??:/gm)].map((match) => match[1]).sort();
}

test("react-native's public entry does not export createPortal; Modal is its overlay export", () => {
  // The runtime entry (package.json "main"), its Flow twin and the generated types that the repo's inventory calls the public API.
  const entry = readRn("index.js");
  const getters = [...entry.matchAll(/^ {2}get (\w+)\(\)/gm)].map((match) => match[1]);
  assert.ok(getters.includes("Modal"));
  assert.ok(getters.length > 50, "the getter scan found the module.exports table");
  assert.equal(getters.includes("createPortal"), false);
  assert.equal(entry.includes("createPortal"), false);
  assert.equal(readRn("index.js.flow").includes("createPortal"), false);

  const names = exportedNames(parse("types_generated/index.d.ts"));
  assert.ok(names.has("Modal") && names.has("ModalProps"));
  assert.equal(names.has("createPortal"), false);

  const audited = JSON.parse(read(root, "docs/compatibility/react-native-0.87.1.json")).exports.map((entryRow) => entryRow.name);
  assert.ok(audited.includes("Modal"));
  assert.equal(audited.includes("createPortal"), false);
});

test("only the three Fabric renderer builds mention createPortal in the whole RN package", () => {
  const mentions = mentioning(rn, ["Libraries", "src", "types", "types_generated", "flow"], "createPortal");
  assert.deepEqual(mentions, [...RENDERERS].sort());
  for (const file of RENDERERS) {
    assert.match(readRn(file), /exports\.createPortal = function \(children, containerTag\) \{/);
  }
  // 0.87.1 ships no other renderer, so the old Paper createPortal is gone with it.
  assert.deepEqual(readdirSync(path.join(rn, "Libraries/Renderer/implementations")).sort(),
    RENDERERS.map((file) => path.basename(file)).sort());
});

test("react-native's own renderer contracts leave createPortal out", () => {
  // ReactFabricType is what RN's shim types the renderer as; RendererImplementation is the module the library imports it through.
  const types = readRn("Libraries/Renderer/shims/ReactNativeTypes.js");
  const start = types.indexOf("export type ReactFabricType = {");
  const end = types.indexOf("export type ReactFabricEventTouch");
  assert.ok(start !== -1 && end > start, "ReactFabricType is declared before ReactFabricEventTouch");
  const block = types.slice(start, end);
  assert.ok(block.includes("render(") && block.includes("unmountComponentAtNode("));
  assert.equal(block.includes("createPortal"), false);

  const implementation = readRn("Libraries/ReactNative/RendererImplementation.js");
  const exported = [...implementation.matchAll(/^export (?:const|function) (\w+)/gm)].map((match) => match[1]);
  assert.ok(exported.includes("findNodeHandle") && exported.includes("renderElement"));
  assert.equal(exported.includes("createPortal"), false);

  // A deep import is possible but untyped: the package exports "./Libraries/*" with "types": null.
  const exportsMap = JSON.parse(readRn("package.json")).exports;
  assert.equal(exportsMap["./Libraries/*"].types, null);
});

test("React's own entry has no createPortal: only a renderer provides one", () => {
  const React = require("react");
  assert.equal("createPortal" in React, false);
});

// A renderer to run without a host. The stubs answer what module initialisation and one commit ask for; `completeRoot` records
// every call, which is what the portal facts below are about.
function loadFabricRenderer(file) {
  const React = require("react");
  const calls = [];
  const describe = (node) => `${node.name}${node.children.length ? `[${node.children.map(describe)}]` : ""}`;
  const manager = {
    createNode: (tag, type, rootTag, props) => ({ tag, type, name: props?.name, children: [] }),
    cloneNodeWithNewChildren: (node) => ({ ...node, children: [] }),
    cloneNodeWithNewChildrenAndProps: (node, props) => ({ ...node, name: props?.name ?? node.name, children: [] }),
    cloneNodeWithNewProps: (node, props) => ({ ...node, name: props?.name ?? node.name }),
    createChildSet: () => [],
    appendChild: (parent, child) => parent.children.push(child),
    appendChildToSet: (set, child) => set.push(child),
    completeRoot: (tag, set) => calls.push({ tag, children: set.map(describe) }),
    registerEventHandler() {},
    setIsJSResponder() {},
    unstable_DiscreteEventPriority: 1,
    unstable_ContinuousEventPriority: 2,
    unstable_IdleEventPriority: 3,
  };
  const viewConfig = { uiViewClassName: "RCTView", validAttributes: { name: true }, directEventTypes: {}, bubblingEventTypes: {} };
  const privateInterface = {
    ReactNativeViewConfigRegistry: { get: () => viewConfig },
    createAttributePayload: (props) => props,
    diffAttributePayloads: (_previous, next) => next,
    createPublicInstance: () => ({}),
    createPublicRootInstance: () => ({}),
    createPublicTextInstance: () => ({}),
    getNativeTagFromPublicInstance: () => null,
    getNodeFromPublicInstance: () => null,
    legacySendAccessibilityEvent() {},
    RawEventEmitter: { emit() {} },
    ReactFiberErrorDialog: { showErrorDialog: () => false },
    UIManager: {},
  };
  const modules = {
    react: React,
    scheduler: require("scheduler"),
    "react-native/Libraries/ReactPrivate/ReactNativePrivateInterface": privateInterface,
    "react-native/Libraries/ReactPrivate/ReactNativePrivateInitializeCore": {},
  };
  const moduleObject = { exports: {} };
  const wrapper = vm.runInThisContext(`(function (require, module, exports, nativeFabricUIManager) {${readRn(file)}\n})`, {
    filename: path.join(rn, file),
  });
  wrapper(
    (id) => {
      assert.ok(id in modules, `the renderer requires ${id}`);
      return modules[id];
    },
    moduleObject,
    moduleObject.exports,
    manager,
  );
  const view = (name, ...children) => React.createElement("RCTView", { name }, ...children);
  return { renderer: moduleObject.exports, calls, view };
}

async function until(condition, what) {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, `timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("ReactFabric-prod exports createPortal beside render, and a portal keeps its container as given", () => {
  const { renderer, view } = loadFabricRenderer(RENDERERS[0]);
  assert.deepEqual(Object.keys(renderer).sort(), [
    "createPortal", "dispatchCommand", "findHostInstance_DEPRECATED", "findNodeHandle", "getNodeFromInternalInstanceHandle",
    "getPublicInstanceFromInternalInstanceHandle", "getPublicInstanceFromRootTag", "isChildPublicInstance", "render",
    "sendAccessibilityEvent", "stopSurface", "unmountComponentAtNode",
  ]);
  const child = view("child");
  const portal = renderer.createPortal(child, 11, "key");
  assert.equal(portal.$$typeof, Symbol.for("react.portal"));
  assert.equal(portal.children, child);
  assert.equal(portal.containerInfo, 11, "the second argument is stored as it is, whatever its name says");
  assert.equal(portal.key, "key");
});

test("a Fabric portal commits through completeRoot with only its own children, and the surface's root commits over it", async () => {
  const { renderer, calls, view } = loadFabricRenderer(RENDERERS[0]);
  const app = (name, portal) => view("root", view(name), portal);

  // The parameter is called containerTag, but the container is read as an object: a tag has no containerTag property.
  renderer.render(app("a", renderer.createPortal(view("by-number"), 11)), 1, null, true);
  await until(() => calls.some((call) => call.children.join() === "by-number"), "the portal commit");
  assert.equal(calls.find((call) => call.children.join() === "by-number").tag, undefined);
  await until(() => calls.some((call) => call.tag === 1 && call.children.join() === "root[a]"), "the root commit");

  // The container that render() creates is { publicInstance, containerTag }. Given a stand-in for it, the portal does reach a
  // surface, and what it commits is the surface's whole child list: the root's own commit of the same transaction follows it.
  calls.length = 0;
  renderer.render(app("b", renderer.createPortal(view("same-surface"), { containerTag: 1 })), 1, null, true);
  await until(() => calls.some((call) => call.tag === 1 && call.children.join() === "root[b]"), "the root commit");
  const portalCommit = calls.findIndex((call) => call.tag === 1 && call.children.join() === "same-surface");
  const rootCommit = calls.findIndex((call) => call.tag === 1 && call.children.join() === "root[b]");
  assert.ok(portalCommit !== -1 && portalCommit < rootCommit, "the portal's child list is committed first and replaced by the root's");

  // Removing a portal commits an empty child list for its container.
  calls.length = 0;
  renderer.render(app("c", renderer.createPortal(view("other-surface"), { containerTag: 2 })), 1, null, true);
  await until(() => calls.some((call) => call.tag === 1 && call.children.join() === "root[c]"), "the root commit");
  assert.ok(calls.some((call) => call.tag === 2 && call.children.join() === "other-surface"));
  assert.ok(calls.some((call) => call.tag === 1 && call.children.length === 0), "the portal into surface 1 was removed with an empty child list");
});

test("the Fabric sources behind those commits: the container read, the container made and the surface child list replaced", () => {
  const prod = readRn(RENDERERS[0]);
  const dev = readRn(RENDERERS[1]);
  assert.match(prod, /function commitHostPortalContainerChildren\(\s*portal,\s*finishedWork,\s*pendingChildren\s*\) \{\s*portal = portal\.containerInfo;\s*try \{\s*completeRoot\(portal\.containerTag, pendingChildren\);/);
  assert.match(dev, /function replaceContainerChildren\(container, newChildren\) \{\s*completeRoot\(container\.containerTag, newChildren\);\s*\}/);
  for (const source of [prod, dev]) {
    assert.match(source, /publicInstance:\s*ReactNativePrivateInterface\.createPublicRootInstance\(containerTag\),\s*containerTag: containerTag\s*\}/);
  }

  const uiManager = readRn("ReactCommon/react/renderer/uimanager/UIManager.cpp");
  const completeSurface = uiManager.slice(uiManager.indexOf("void UIManager::completeSurface("));
  assert.match(completeSurface.slice(0, completeSurface.indexOf("\n}\n")), /std::make_shared<RootShadowNode>\(\s*oldRootShadowNode,\s*ShadowNodeFragment\{\s*\.props = ShadowNodeFragment::propsPlaceholder\(\),\s*\.children = rootChildren,/);
  const binding = readRn("ReactCommon/react/renderer/uimanager/UIManagerBinding.cpp");
  const start = binding.indexOf('methodName == "completeRoot"');
  assert.notEqual(start, -1);
  // The host function that JS calls as completeRoot hands the child list to completeSurface.
  assert.match(binding.slice(start, binding.indexOf('methodName == "', start + 1)), /uiManager->completeSurface\(\s*surfaceId,\s*shadowNodeList,/);
});

test("zIndex is a style that orders positioned siblings: the escape from a stacking context needs another mechanism", () => {
  assert.match(readRn("Libraries/StyleSheet/StyleSheetTypes.js"), /\n {2}zIndex\?: number,/);
  const concrete = readRn("ReactCommon/react/renderer/components/view/ConcreteViewShadowNode.h");
  assert.match(concrete, /if \(props\.yogaStyle\.positionType\(\) != yoga::PositionType::Static\) \{\s*BaseShadowNode::orderIndex_ = props\.zIndex\.value_or\(0\);\s*\} else \{\s*BaseShadowNode::orderIndex_ = 0;/);
  assert.match(readRn("ReactCommon/react/renderer/mounting/internal/sliceChildShadowNodeViewPairs.cpp"), /Reorders pairs in-place based on `orderIndex` using a stable sort algorithm/);
  assert.match(readRn("ReactCommon/react/renderer/components/view/ViewShadowNode.cpp"), /viewProps\.zIndex\.has_value\(\) &&\s*viewProps\.yogaStyle\.positionType\(\) != yoga::PositionType::Static/);
});

test("the SDK facade does not expose createPortal and exposes Modal", () => {
  assert.deepEqual(mentioning(root, ["src", "types"], "createPortal"), []);
  assert.match(read(root, "src/react-native-platform.jsx"), /^export function Modal\(props\) \{/m);
  assert.match(read(root, "types/react-native.ts"), /^export declare const Modal: /m);

  // The renderer module is imported by the facade's own code (to render and stop roots), and what it re-exports is RN's set.
  assert.match(read(root, "src/render-application.jsx"), /from "react-native\/Libraries\/Renderer\/implementations\/ReactFabric-prod"/);
  const proxy = read(root, "src/renderer-proxy.js");
  const reexported = [...proxy.matchAll(/^export function (\w+)/gm)].map((match) => match[1]).sort();
  const upstream = [...readRn("Libraries/ReactNative/RendererImplementation.js").matchAll(/^export const (\w+)/gm)].map((match) => match[1]).sort();
  assert.deepEqual(reexported, upstream);
});

test("Modal's public props as RN 0.87.1 declares them, and Modal is a host component rather than a portal", () => {
  const base = ["animationType", "backdropColor", "modalRef", "onRequestClose", "onShow", "transparent", "visible"];
  const ios = ["allowSwipeDismissal", "onDismiss", "onOrientationChange", "presentationStyle", "supportedOrientations"];
  const android = ["hardwareAccelerated", "navigationBarTranslucent", "statusBarTranslucent"];

  const declarations = parse("types_generated/Libraries/Modal/Modal.d.ts");
  assert.deepEqual(declaredProps(declarations, "ModalBaseProps"), base);
  assert.deepEqual(declaredProps(declarations, "ModalPropsIOS"), ios);
  assert.deepEqual(declaredProps(declarations, "ModalPropsAndroid"), android);
  // ModalProps is those three and ViewProps.
  const modalProps = declarations.statements.find((statement) => ts.isTypeAliasDeclaration(statement) && statement.name.text === "ModalProps");
  const parts = modalProps.type.getText(declarations);
  for (const name of ["ModalBaseProps", "ModalPropsIOS", "ModalPropsAndroid", "ViewProps"]) {
    assert.ok(parts.includes(name), `ModalProps includes ${name}`);
  }

  // The Flow source that the declarations were translated from says the same.
  const flow = readRn("Libraries/Modal/Modal.js");
  assert.deepEqual(flowProps(flow, "ModalBaseProps"), base);
  assert.deepEqual(flowProps(flow, "ModalPropsIOS"), ios);
  assert.deepEqual(flowProps(flow, "ModalPropsAndroid"), android);

  // Its children are children of a host view in the same React tree; the platform presents that view above the app.
  assert.match(flow, /<RCTModalHostView[\s\S]*?\{innerChildren\}[\s\S]*?<\/RCTModalHostView>/);
  assert.match(readRn("src/private/components/modal/specs/RCTModalHostViewNativeComponent.js"), /codegenNativeComponent<RCTModalHostViewNativeProps>\(\s*'ModalHostView'/);
});
