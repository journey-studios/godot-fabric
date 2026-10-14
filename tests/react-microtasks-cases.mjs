// What the fixture (in Hermes) and the oracle (in Node) both do, written once: the stimulus, never an expectation. Each case is the body of
// one press handler, a list of steps; the oracle derives the order the steps' marks come out in from RN's sources, from the pinned renderer
// and from V8's own microtask queue, so nothing here says what order is right.
//
//   mark       a mark in the handler's own turn
//   microtask  queueMicrotask(callback): the callback marks, then runs `then`
//   promise    Promise.resolve().then(callback): the callback marks, then runs `then`
//   immediate  setImmediate(callback), which RN shims over queueMicrotask
//   task       the RuntimeScheduler's unstable_scheduleCallback at `priority`
//   timeout    setTimeout(callback, 0)
//   setState   a sync-lane update of the fixture's component: the commit marks itself "commit", with the number of updates it carries as detail
//
// runCase ends a handler with a "handler-end" mark and a setTimeout(0) that marks "end" and finishes the case, after every step's own
// timer: a timer queued later runs later, whatever the pace of the frames.
export const priorities = {immediate: 1, userBlocking: 2, normal: 3};

export const cases = [
  // The microtask queue alone: Promise reactions, queueMicrotask callbacks and setImmediate (RN's shim over queueMicrotask), with callbacks
  // that queue more, before the next RuntimeScheduler task and before a timer.
  {name: "fifo", steps: [
    {op: "promise", mark: "promise-1"},
    {op: "microtask", mark: "microtask-1", then: [{op: "microtask", mark: "microtask-1-nested"}, {op: "promise", mark: "microtask-1-promise"}]},
    {op: "promise", mark: "promise-2", then: [{op: "microtask", mark: "promise-2-microtask"}]},
    {op: "microtask", mark: "microtask-2"},
    {op: "immediate", mark: "immediate"},
    {op: "task", priority: "normal", mark: "task-normal"},
    {op: "timeout", mark: "timeout"},
  ]},
  // A microtask queued before the update, one and a Promise reaction queued after it: where React's own microtask stands in the queue.
  {name: "react-microtask", steps: [
    {op: "microtask", mark: "microtask-before"},
    {op: "setState"},
    {op: "microtask", mark: "microtask-after"},
    {op: "promise", mark: "promise-after"},
  ]},
  // Tasks queued through the RuntimeScheduler before the update, one at each priority, and a timer: what React's sync work runs before.
  {name: "react-tasks", steps: [
    {op: "task", priority: "normal", mark: "task-normal"},
    {op: "task", priority: "userBlocking", mark: "task-user-blocking"},
    {op: "task", priority: "immediate", mark: "task-immediate"},
    {op: "timeout", mark: "timeout"},
    {op: "setState"},
    {op: "microtask", mark: "microtask-after"},
  ]},
  // Two updates in one handler: one scheduled root task, one commit.
  {name: "react-batched", steps: [
    {op: "setState"},
    {op: "microtask", mark: "microtask-1"},
    {op: "setState"},
    {op: "microtask", mark: "microtask-2"},
  ]},
];

// The size of the batch the probe queues through the global to count the calls that reach the C++ module.
export const bulk = 5;

// A case as the handler runs it: its steps, the "handler-end" mark, and the timer that finishes it. env.finish() is called by that timer.
export function runCase(testCase, env) {
  runSteps(testCase.steps, env);
  env.mark("handler-end");
  env.setTimeout(() => {
    env.mark("end");
    env.finish();
  }, 0);
}

// Runs a list of steps. env: mark(label), setState(), scheduler (RN's RuntimeScheduler binding), and the globals the steps use.
function runSteps(steps, env) {
  const body = step => () => {
    env.mark(step.mark);
    runSteps(step.then ?? [], env);
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
      case "setState":
        env.setState();
        break;
      default:
        throw new Error("Unknown step: " + step.op);
    }
  }
}
