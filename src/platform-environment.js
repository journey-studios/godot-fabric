import { subscribeWindow, windowSnapshot } from "./window-dimensions";

// Políticas explícitas desta surface: tema manual, texto LTR e escala lógica.
// Não são sondas de acessibilidade, tema ou estado de um sistema móvel.
let scheme = "light";
const appearanceListeners = new Set();
const stateListeners = new Set();
const motionListeners = new Set();
const dimensionSubscriptions = new Set();
function subscription(listeners, listener) {
  listeners.add(listener);
  return { remove: () => listeners.delete(listener) };
}
function requireEvent(actual, supported) {
  if (actual !== supported)
    throw new Error(`Godot platform does not implement event ${actual}`);
}
export const Dimensions = {
  get(name) {
    if (name !== "window")
      throw new Error("Godot Dimensions supports the surface window only");
    return windowSnapshot();
  },
  addEventListener(event, listener) {
    requireEvent(event, "change");
    const unsubscribe = subscribeWindow(() =>
      listener({ window: windowSnapshot() }),
    );
    const remove = () => {
      unsubscribe();
      dimensionSubscriptions.delete(remove);
    };
    dimensionSubscriptions.add(remove);
    return { remove };
  },
};
export const Appearance = {
  getColorScheme: () => scheme,
  setColorScheme(value) {
    if (value !== "light" && value !== "dark")
      throw new Error(
        "Godot Appearance requires an explicit light or dark theme",
      );
    scheme = value;
    appearanceListeners.forEach((listener) =>
      listener({ colorScheme: scheme }),
    );
  },
  addChangeListener: (listener) => subscription(appearanceListeners, listener),
};
export const AppState = {
  currentState: "active",
  addEventListener(event, listener) {
    requireEvent(event, "change");
    return subscription(stateListeners, listener);
  },
};
export const AccessibilityInfo = {
  isReduceMotionEnabled: () => Promise.resolve(false),
  addEventListener(event, listener) {
    requireEvent(event, "reduceMotionChanged");
    return subscription(motionListeners, listener);
  },
};
export const I18nManager = { isRTL: false };
export const PixelRatio = {
  get: () => windowSnapshot().scale,
  getFontScale: () => windowSnapshot().fontScale,
  getPixelSizeForLayoutSize: (size) =>
    Math.round(size * windowSnapshot().scale),
  roundToNearestPixel: (size) =>
    Math.round(size * windowSnapshot().scale) / windowSnapshot().scale,
};
export function environmentStats() {
  return {
    theme: scheme,
    state: AppState.currentState,
    dimensions: dimensionSubscriptions.size,
    appearance: appearanceListeners.size,
    appState: stateListeners.size,
    reduceMotion: motionListeners.size,
    window: windowSnapshot(),
  };
}
export function disposeEnvironment() {
  AppState.currentState = "inactive";
  stateListeners.forEach((listener) => listener("inactive"));
  for (const remove of dimensionSubscriptions) remove();
  for (const listeners of [
    appearanceListeners,
    stateListeners,
    motionListeners,
  ])
    listeners.clear();
}
