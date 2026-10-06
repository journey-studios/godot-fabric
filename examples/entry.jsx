import React from "react";
import * as Fabric from "react-native/Libraries/Renderer/implementations/ReactFabric-prod";
import { FormApp, formStats, runForm } from "./form/App";
import { CounterApp, counterStats } from "./counter/App";
import { ReactApp, runReact, reactStats } from "./react/App";
import { LayoutApp, runLayout, layoutStats } from "./layout/App";
import { InputApp, runInput, inputStats } from "./input/App";
import { PressableApp, runPressable, pressableStats } from "./pressable/App";
import { ChartApp, runChart, chartStats } from "./chart/App";
import { ScrollApp, runScroll, scrollStats } from "./scroll/App";
import { LineHeightProbe } from "../tests/line-height-probe";
import { ParityFixture } from "../tests/parity/fixture";

const formScenario = globalThis.godotScenario === "form";
const counterScenario = globalThis.godotScenario === "counter";
const runtimeExample = globalThis.godotScenario === "runtime" ? require("./runtime/App") : null;
const scrollScenario = globalThis.godotScenario === "scroll";
const pressableScenario = globalThis.godotScenario === "pressable";
const layoutScenario = globalThis.godotScenario === "layout";
const inputScenario = globalThis.godotScenario === "input";
const chartScenario = globalThis.godotScenario === "chart";
// Executa o runtime NativeWind somente no cenário dedicado desta surface.
const nativewind =
  globalThis.godotScenario === "nativewind"
    ? require("./nativewind/App")
    : null;
const typography =
  globalThis.godotScenario === "typography"
    ? require("./typography/App")
    : null;
if (["shared", "refs", "tree", "focus", "pointers", "pointer-geometry", "metrics", "services", "service-boundaries", "modules", "view", "coordinates", "transforms", "animated"].includes(globalThis.godotScenario)) {
  if (globalThis.godotScenario === "shared") require("./shared/App");
  else if (globalThis.godotScenario === "refs") require("./refs/App");
  else if (globalThis.godotScenario === "tree") require("./tree/App");
  else if (globalThis.godotScenario === "focus") require("./focus/App");
  else if (globalThis.godotScenario === "pointers") require("./pointers/App");
  else if (globalThis.godotScenario === "pointer-geometry") require("./pointer-geometry/App");
  else if (globalThis.godotScenario === "view") require("./view/App");
  else if (globalThis.godotScenario === "coordinates") require("./coordinates/App");
  else if (globalThis.godotScenario === "transforms") require("./transforms/App");
  else if (globalThis.godotScenario === "animated") require("./animated/App");
  else if (globalThis.godotScenario === "services") require("./services/App");
  else if (globalThis.godotScenario === "service-boundaries") require("../tests/services-boundary-fixture");
  else if (globalThis.godotScenario === "metrics") {
    globalThis.GodotMetricsSubscriptionCount = require("../src/window-dimensions").windowSubscriptionCount;
    require("./metrics/App");
  }
  else require("../tests/turbo-modules-fixture");
} else {
globalThis.GodotApp = {
  run(name, ...args) {
    if (formScenario) return runForm(name, ...args);
    if (counterScenario) throw new Error("The counter is driven by public Pressable input");
    if (runtimeExample) throw new Error("The runtime example is driven by public Pressable input");
    if (typography) return typography.runTypography(name, ...args);
    if (nativewind) nativewind.runNativeWind(name, ...args);
    else if (chartScenario) runChart(name, ...args);
    else if (scrollScenario) runScroll(name, ...args);
    else if (pressableScenario) runPressable(name, ...args);
    else if (inputScenario) runInput(name, ...args);
    else if (layoutScenario) runLayout(name);
    else runReact(name);
  },
  stats() {
    if (formScenario) return formStats();
    if (counterScenario) return counterStats();
    if (runtimeExample) return runtimeExample.runtimeStats();
    if (typography) return typography.typographyStats();
    if (nativewind) return nativewind.nativewindStats();
    return chartScenario
      ? chartStats()
      : scrollScenario
        ? scrollStats()
        : pressableScenario
          ? pressableStats()
          : inputScenario
            ? inputStats()
            : layoutScenario
              ? layoutStats()
              : reactStats();
  },
  stop() {
    Fabric.stopSurface(1);
    nativewind?.stopNativeWind();
    typography?.stopTypography();
  },
};
Fabric.render(
  ["parity", "parity-completion-failure"].includes(globalThis.godotScenario) ? (
    <ParityFixture onComplete={(report) => {
      if (globalThis.godotScenario === "parity-completion-failure") {
        globalThis.fabricParityCompletions = (globalThis.fabricParityCompletions || 0) + 1;
        throw new Error("Expected parity completion failure");
      }
      globalThis.fabricParityReport = report;
    }} />
  ) : formScenario ? (
    <FormApp />
  ) : counterScenario ? (
    <CounterApp />
  ) : runtimeExample ? (
    React.createElement(runtimeExample.RuntimeApp)
  ) : globalThis.godotScenario === "lineheight" ? (
    <LineHeightProbe />
  ) : typography ? (
    React.createElement(typography.TypographyApp)
  ) : nativewind ? (
    React.createElement(nativewind.NativeWindApp)
  ) : chartScenario ? (
    <ChartApp />
  ) : scrollScenario ? (
    <ScrollApp />
  ) : pressableScenario ? (
    <PressableApp />
  ) : inputScenario ? (
    <InputApp />
  ) : layoutScenario ? (
    <LayoutApp />
  ) : (
    <ReactApp />
  ),
  1,
  null,
  true,
  {
    onCaughtError(error) {
      console.log("Caught expected:", error.message);
    },
    onUncaughtError(error) {
      throw error;
    },
    onRecoverableError(error) {
      console.warn(error.message);
    },
  },
);
}
