// The retained sabotages of scripts/networking-sabotage.mjs, written once: that script runs them (its header says what each breaks and what must reject it) and
// tests/sabotage-anchors.test.mjs checks that every `find` still occurs exactly once in its file. It has no side effects, so the test can import it.
export const SABOTAGES = [
  {name: "redirects", argument: "--sabotage=redirects", hostDirectory: "build/networking-sabotage-redirects-host",
    file: "native/godot_http_transport.cpp",
    find: "if (auto redirect = http::plan_redirect(x.request.method, status, x.url, x.request.headers, headers, x.request.drop_headers_on_redirect)) {",
    replace: "if (auto redirect = std::optional<http::Redirect>()) {"},
  {name: "headers", argument: "--sabotage=headers", hostDirectory: "build/networking-sabotage-headers-host",
    file: "native/http_core.h", find: '    else existing->second += ", " + value;', replace: "    else joined.emplace_back(name, value);"},
];
