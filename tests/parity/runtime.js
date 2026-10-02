// Portable runtime contract, shared verbatim with the original RN mobile app.
// Assert semantic order and cancellation; never compare OS frame durations.
export async function exerciseRuntime(check) {
  const timers = new Set();
  const frames = new Set();
  const timeout = (fn, delay, ...args) => {
    const id = setTimeout(fn, delay, ...args);
    timers.add(id);
    return id;
  };
  const sleep = (delay) => new Promise(resolve => timeout(resolve, delay));
  try {
    const object = { label: "argument" };
    let cancelled = false;
    clearInterval(timeout(() => { cancelled = true; }, 0));
    const args = await new Promise(resolve => timeout((...values) => resolve(values), "5", "token", 42, object));
    let coercions = 0;
    await new Promise(resolve => timeout(resolve, { valueOf() { coercions++; return 0; } }));
    await new Promise(resolve => timeout(resolve, NaN));
    await new Promise(resolve => timeout(resolve, -10));
    let missingThrows = false;
    try { setTimeout(); } catch { missingThrows = true; }
    const invalidHandle = setTimeout("not executable", 0);
    check("timer-arguments-cancellation", args[0] === "token" && args[1] === 42 && args[2] === object && coercions === 1 && missingThrows && invalidHandle === 0 && !cancelled);

    let ticks = 0;
    const intervalArgs = [];
    await new Promise(resolve => {
      const id = setInterval((label, amount) => {
        intervalArgs.push([label, amount]);
        if (++ticks === 3) { clearTimeout(id); resolve(); }
      }, 5, "tick", 2);
      timers.add(id);
    });
    await sleep(40);
    check("interval-arguments-cancellation", ticks === 3 && intervalArgs.every(args => args[0] === "tick" && args[1] === 2));

    const trace = ["sync"];
    await new Promise(resolve => {
      timeout(() => { trace.push("timer"); resolve(); }, 0);
      Promise.resolve().then(() => trace.push("promise"));
      queueMicrotask(() => {
        trace.push("microtask");
        queueMicrotask(() => trace.push("nested"));
      });
      setImmediate((label) => trace.push(label), "immediate");
      clearImmediate(setImmediate(() => trace.push("cancelled")));
    });
    check("microtask-immediate-order", trace.join(",") === "sync,promise,microtask,immediate,nested,timer");

    let cancelledFrame = false;
    cancelAnimationFrame(requestAnimationFrame(() => { cancelledFrame = true; }));
    const timestamps = [];
    for (let index = 0; index < 2; ++index) {
      timestamps.push(await new Promise(resolve => { frames.add(requestAnimationFrame(resolve)); }));
    }
    const monotonic = timestamps.every(Number.isFinite) && timestamps[0] >= 0 && timestamps[1] >= timestamps[0] && performance.now() >= timestamps[1];
    check("animation-frame-clock", monotonic && !cancelledFrame);
    return { timeoutArgs: [args[0], args[1]], objectIdentity: args[2] === object, coercions, cancelled,
      intervalTicks: ticks, intervalArgs, trace, frameCount: timestamps.length, monotonic, cancelledFrame };
  } finally {
    for (const id of timers) clearTimeout(id);
    for (const id of frames) cancelAnimationFrame(id);
  }
}
