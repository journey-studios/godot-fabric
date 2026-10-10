// The retained sabotages of scripts/device-services-sabotage.mjs, written once: that script runs them (its header says what each breaks and what must reject it) and
// tests/sabotage-anchors.test.mjs checks that every `find` still occurs exactly once in its file. It has no side effects, so the test can import it.
export const SABOTAGES = [
  {name: "duplicate-url", argument: "--sabotage=duplicate-url", hostDirectory: "build/device-services-sabotage-duplicate-url-host",
    file: "native/device_services.cpp", find: "    state_->emit_url(url);\n", replace: "    state_->emit_url(url);\n    state_->emit_url(url);\n"},
  {name: "stale-clipboard", argument: "--sabotage=stale-clipboard", hostDirectory: "build/device-services-sabotage-stale-clipboard-host",
    file: "native/device_services.cpp", find: "    if (auto text = state_->core.clipboard_get()) {\n      promise.resolve(std::move(*text));\n",
    replace: "    static std::optional<std::string> stale;\n    if (auto text = state_->core.clipboard_get()) {\n      if (!stale) {\n        stale = std::move(*text);\n      }\n      promise.resolve(*stale);\n"},
];
