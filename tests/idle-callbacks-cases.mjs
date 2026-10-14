// What the fixture (in Hermes) and the oracle (in Node) both do, written once: the stimulus, never an expectation. Each case is the body of one
// press handler, a list of steps. The oracle derives the order the steps' marks come out in, and what each idle callback is told, from RN's sources
// (NativeIdleCallbacks.cpp and the RuntimeScheduler) and from V8's own microtask queue, so nothing here says what is right.
//
//   mark       a mark in the handler's own turn
//   microtask  queueMicrotask(callback): the callback marks, then runs `then`
//   promise    Promise.resolve().then(callback): the callback marks, then runs `then`
//   immediate  setImmediate(callback), which RN shims over queueMicrotask
//   task       the RuntimeScheduler's unstable_scheduleCallback at `priority`: marks, spins `spin` milliseconds when it has one, then runs `then`
//   timeout    setTimeout(callback, 0)
//   idle       requestIdleCallback(callback, {timeout}) (the options only when the step has a `timeout`): marks, then runs `then`. The step's `mark` names the request
//   cancel     cancelIdleCallback of the handle that the idle step named `target` was given
//   measure    inside an idle callback: deadline.timeRemaining(), recorded under `label`
//   spin       inside an idle callback: busy-wait `ms` milliseconds
//
// runCase ends a handler with a "handler-end" mark and a setTimeout(0) that marks "end" and finishes the case, after every step's own timer: a timer
// queued later runs later, whatever the pace of the frames.
export const priorities = {immediate: 1, userBlocking: 2, normal: 3};

// The deadline an idle callback is given is 50 ms long (NativeIdleCallbacks.cpp). The spins below are measured against it: a spin of `quick` milliseconds leaves
// most of it, and `past` spins beyond it from the start of the callback.
export const spins = {quick: 10, past: 55};

export const cases = [
  // The order idle callbacks run in against everything else the handler queues: they run after the work queued with them whatever its priority, and in
  // the order they were requested; the microtasks of an idle callback run before the next one.
  {name: "order", steps: [
    {op: "idle", mark: "idle-a", then: [{op: "microtask", mark: "idle-a-microtask"}, {op: "promise", mark: "idle-a-promise"}, {op: "immediate", mark: "idle-a-immediate"}]},
    {op: "timeout", mark: "timeout"},
    {op: "task", priority: "normal", mark: "task-normal"},
    {op: "idle", mark: "idle-b"},
    {op: "microtask", mark: "microtask"},
    {op: "promise", mark: "promise"},
    {op: "immediate", mark: "immediate"},
    {op: "task", priority: "userBlocking", mark: "task-user-blocking"},
    {op: "task", priority: "immediate", mark: "task-immediate"},
  ]},
  // What the deadline of one idle callback says while nothing else is queued: a fresh deadline, a later reading that cannot be larger, a reading after
  // 10 ms, and one after the 50 ms are past, which is exactly zero.
  {name: "deadline", steps: [
    {op: "idle", mark: "idle", then: [
      {op: "measure", label: "entry"},
      {op: "measure", label: "again"},
      {op: "spin", ms: spins.quick},
      {op: "measure", label: "after-quick"},
      {op: "spin", ms: spins.past},
      {op: "measure", label: "after-deadline"},
    ]},
  ]},
  // Work of another priority queued inside an idle callback: a task that is not idle takes the scheduler's yield (the reading is zero from then on), an idle
  // callback requested inside does not; the task runs before the idle callback that was requested earlier but behind the one running.
  {name: "yield", steps: [
    {op: "idle", mark: "idle-a", then: [
      {op: "measure", label: "entry"},
      {op: "idle", mark: "idle-nested"},
      {op: "measure", label: "after-idle"},
      {op: "task", priority: "normal", mark: "task-normal"},
      {op: "measure", label: "after-task"},
      {op: "measure", label: "again"},
    ]},
    {op: "idle", mark: "idle-b"},
  ]},
  // An Immediate task queued inside an idle callback takes the yield as well.
  {name: "yield-immediate", steps: [
    {op: "idle", mark: "idle", then: [
      {op: "measure", label: "entry"},
      {op: "task", priority: "immediate", mark: "task-immediate"},
      {op: "measure", label: "after-task"},
    ]},
  ]},
  // The timeout option: it changes only what didTimeout says. The scheduler stays busy with Normal tasks, which spin, and the idle callbacks wait behind
  // all of them whatever their timeout; none of them runs early. A timeout of 0 or less never expires.
  {name: "timeout", steps: [
    {op: "idle", mark: "idle-timeout-1", timeout: 1},
    {op: "idle", mark: "idle-timeout-60000", timeout: 60000},
    {op: "idle", mark: "idle-timeout-0", timeout: 0},
    {op: "idle", mark: "idle-timeout-negative", timeout: -5},
    {op: "idle", mark: "idle-no-timeout"},
    {op: "task", priority: "normal", mark: "busy-1", spin: 20, then: [
      {op: "task", priority: "normal", mark: "busy-2", spin: 5, then: [{op: "task", priority: "normal", mark: "busy-3", spin: 5}]},
    ]},
  ]},
  // Cancelling: the canceled callback never runs, and the ones around it do. A cancel inside the handler is the common case; a cancel inside an
  // idle callback reaches the one behind it.
  {name: "cancel", steps: [
    {op: "idle", mark: "idle-a"},
    {op: "idle", mark: "idle-b"},
    {op: "idle", mark: "idle-c", then: [{op: "cancel", target: "idle-e"}]},
    {op: "idle", mark: "idle-d"},
    {op: "idle", mark: "idle-e"},
    {op: "cancel", target: "idle-b"},
  ]},
];

// How many idle callbacks the probe requests through the global outside any task to count the calls that reach the C++ module.
export const bulk = 3;

// A case as the handler runs it: its steps, the "handler-end" mark, and the timer that finishes it. env.finish() is called by that timer.
export function runCase(testCase, env) {
  runSteps(testCase.steps, env, {handles: new Map(), owner: null, deadline: null});
  env.mark("handler-end");
  env.setTimeout(() => {
    env.mark("end");
    env.finish();
  }, 0);
}

// Runs a list of steps. env: mark(label), spin(ms), measure(owner, label, deadline), idleStart(owner, deadline), requestIdleCallback(owner, callback, options),
// cancelIdleCallback(handle), scheduler (RN's RuntimeScheduler binding), and the globals the steps use. A context carries the handles by mark, the idle
// callback the steps run in and its deadline.
function runSteps(steps, env, context) {
  const body = step => () => {
    env.mark(step.mark);
    if (step.spin !== undefined) {
      env.spin(step.spin);
    }
    runSteps(step.then ?? [], env, context);
  };
  for (const step of steps) {
    switch (step.op) {
      case "mark":
        env.mark(step.mark);
        break;
      case "microtask":
        env.queueMicrotask(body(step));
        break;
      case "promise":
        env.Promise.resolve().then(body(step));
        break;
      case "immediate":
        env.setImmediate(body(step));
        break;
      case "task":
        env.scheduler.unstable_scheduleCallback(priorities[step.priority], body(step));
        break;
      case "timeout":
        env.setTimeout(body(step), 0);
        break;
      case "idle":
        context.handles.set(step.mark, env.requestIdleCallback(step.mark, deadline => {
          env.idleStart(step.mark, deadline);
          env.mark(step.mark);
          runSteps(step.then ?? [], env, {...context, owner: step.mark, deadline});
        }, step.timeout === undefined ? [] : [{timeout: step.timeout}]));
        break;
      case "cancel":
        env.cancelIdleCallback(context.handles.get(step.target));
        break;
      case "measure":
        env.measure(context.owner, step.label, context.deadline);
        break;
      case "spin":
        env.spin(step.ms);
        break;
      default:
        throw new Error("Unknown step: " + step.op);
    }
  }
}
