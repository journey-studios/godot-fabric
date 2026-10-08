// The experiment, as plain data: the fixture renders one root per workload, the probe mounts and
// unmounts it, and the oracle derives what each cycle must show from the same numbers with its own
// formulas. Neither side reads the other's results here.

// The workloads, one root each: a minimal root, the three controls of a form through the public
// facade, react-native-chart-kit through the SVG seam, and a FlatList of LIST_ROWS rows.
export const WORKLOADS = ["idle", "forms", "chart", "list"];
export const COMPONENTS = {idle: "PerformanceIdle", forms: "PerformanceForms", chart: "PerformanceChart", list: "PerformanceList"};

// Mount/unmount cycles of the soak, per workload. The first WARMUP_CYCLES warm the runtime up (the
// first mount builds Hermes' caches and the engine's font and theme state) and are left out of the
// steady-state heap judgement; the rest are the steady state.
export const CYCLES = 20;
export const WARMUP_CYCLES = 3;
export const LIST_ROWS = 120;

// How far the live Hermes heap, read after a full collection with nothing mounted, may rise above its value after
// the first steady cycle of a workload, over the rest of the steady cycles. Seven soaks (199 steady cycles per
// workload) measured 0 bytes for idle, forms and chart and at worst one 312-byte step for the list; 2048 is 6.6 times
// that, 0.1% of the live heap, and fails any leak of 129 bytes or more per cycle within 17 steady cycles
// (docs/research/performance.md).
export const HEAP_STEADY_GROWTH_LIMIT_BYTES = 2048;

// The JS allocation the heap source is asked to show and to forget: retained, then released, with a
// full collection before each reading. The reading must follow it by at least this share of the
// bytes the fixture allocated by its own count: an object with two properties holds more than the
// 32 bytes of a Hermes cell header and one slot, never less (the reading measured 138 per object).
export const RETAIN_OBJECTS = 100000;
export const RETAIN_MIN_BYTES_PER_OBJECT = 32;

// The JS busy turns the probe asks for, to show that the JS phase accounts for work that really ran.
export const BURN_MS = 30;
export const BURNS = 3;
