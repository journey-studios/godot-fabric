// The retained sabotages of scripts/websocket-sabotage.mjs, written once: that script runs them (its header says what each breaks and what must reject it) and
// tests/sabotage-anchors.test.mjs checks that every `find` still occurs exactly once in its file. It has no side effects, so the test can import it.
export const SABOTAGES = [
  {name: "origin", argument: "--sabotage=origin", hostDirectory: "build/websocket-sabotage-origin-host",
    file: "native/websocket_module.cpp",
    find: '    if (!has_origin) request.headers.emplace_back("origin", websocket::default_origin(url));',
    replace: '    if (false) request.headers.emplace_back("origin", websocket::default_origin(url));'},
  {name: "stop", argument: "--sabotage=stop", hostDirectory: "build/websocket-sabotage-stop-host",
    file: "native/godot_websocket_connection.cpp",
    find: "      wslay_event_queue_close(wslay_, 1001, nullptr, 0);",
    replace: "      wslay_event_queue_close(wslay_, 1000, nullptr, 0);"},
];
