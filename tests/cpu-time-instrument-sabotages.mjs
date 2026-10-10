// The retained sabotages of scripts/cpu-time-instrument-sabotage.mjs, written once: that script runs them (its header says what each breaks and what must reject it) and
// tests/sabotage-anchors.test.mjs checks that every `find` still occurs exactly once in its file. It has no side effects, so the test can import it.
const instrument = "tests/cpu-time-instrument.gd";
const probe = "tests/cpu-time-instrument-probe.gd";
const PROCESS_TERM = "    process_ms[index] = float((_pre_draw_usec[index] if did_draw else _last_process_usec[index]) - _start_usec[index]) / 1000.0";
// A variant is a list of edits of one file, each made in exactly one place.
export const SABOTAGES = [
  {name: "reads-interval", file: instrument, edits: [{find: PROCESS_TERM, replace: "    process_ms[index] = interval_ms[index]"}]},
  {name: "load-outside-frame", file: probe, edits: [{find: 'const LOAD_PLACEMENT := "in-frame"', replace: 'const LOAD_PLACEMENT := "before-frame"'}]},
  {name: "reads-monitor", file: instrument, edits: [{find: PROCESS_TERM, replace: "    process_ms[index] = _monitor_ms[index]"}]},
];
