// The retained sabotages of scripts/app-registry-sabotage.mjs, written once: that script runs them (its header says what each breaks and what must reject it) and
// tests/sabotage-anchors.test.mjs checks that every `find` still occurs exactly once in its file. It has no side effects, so the test can import it.
const facade = "src/app-registry.js";
export const SABOTAGES = [
  {name: "section-dropped", argument: "--sabotage=section-dropped", file: facade,
    find: "    return Registry.registerComponent(key, provider, section);\n", replace: "    return Registry.registerComponent(key, provider);\n"},
  {name: "duplicate-accepted", argument: "--sabotage=duplicate-accepted", file: facade,
    find: "  if (Registry.getAppKeys().includes(key) || RESERVED_KEYS.includes(key)) {\n", replace: "  if (RESERVED_KEYS.includes(key)) {\n"},
  {name: "headless-silent", argument: "--sabotage=headless-silent", file: facade,
    find: "    throw failure(\"E_APP_REGISTRY_HEADLESS_TASK\",\n      `AppRegistry.${member} is not implemented: headless JS tasks are an Android service feature and Godot has no background service to run them`);\n",
    replace: "    return member;\n"},
  {name: "wrapper-ignored", argument: "--sabotage=wrapper-ignored", file: facade,
    find: "  setWrapperComponentProvider: Registry.setWrapperComponentProvider,\n", replace: "  setWrapperComponentProvider() {},\n"},
  {name: "props-dropped", argument: "--sabotage=props-dropped", file: facade,
    find: "    return Registry.setSurfaceProps(appKey, appParameters, displayMode);\n", replace: "    return undefined;\n"},
  {name: "inherited-runnable", argument: "--sabotage=inherited-runnable", file: facade,
    find: "    return Registry.getAppKeys().includes(key) ? Registry.getRunnable(key) : undefined;\n", replace: "    return Registry.getRunnable(key);\n"},
  {name: "root-not-tracked", argument: "--sabotage=root-not-tracked", file: "src/render-application.jsx",
    find: "  running.add(rootTag);\n", replace: "  void rootTag;\n"},
  {name: "stop-not-forgotten", argument: "--sabotage=stop-not-forgotten", file: facade,
    find: "    forgetSurface(rootTag);\n", replace: "    void rootTag;\n"},
  {name: "unknown-root-unchecked", argument: "--sabotage=unknown-root-unchecked", file: facade,
    find: "  if (!isRunningSurface(rootTag)) {\n", replace: "  if (!isRunningSurface(rootTag) && rootTag === undefined) {\n"},
];
