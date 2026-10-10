import { setTimeout as pause } from "node:timers/promises";
import { loadNumber } from "./frontier-comparison-run.mjs";
import { loadAverage } from "./frontier-turn-lane.mjs";

// The wait for a quiet machine before each execution of the campaign (V05-10, `execucao`; docs/research/frontier-comparison-protocol.json `runs.load`). The protocol rejects an execution whose
// 1-minute load average is above `limit1MinuteAverage` before or after it and redoes it, at most 3 attempts per slot, and when they are used up the campaign stops. Waiting for the load to come
// down before the execution starts spends the machine's quiet minutes instead of the slot's attempts. It is not a guarantee: the readings that the execution records (the launcher's, right
// before the process and right after it) are the ones the rule judges, and if the wait runs out the attempt runs anyway and is judged by them.

// The 1-minute load average of the machine, as a number (`sysctl -n vm.loadavg`). It throws when the command does not give one: a campaign that cannot read the load cannot be judged by it.
export function readLoad() {
  const load = loadNumber(loadAverage());
  if (Number.isNaN(load)) {
    throw new Error("the 1-minute load average could not be read (sysctl -n vm.loadavg)");
  }
  return load;
}

export const defaultClock = { now: () => Date.now(), sleep: (milliseconds) => pause(milliseconds) };

// Reads the load every `intervalSeconds` until it is at or under `limit` (the protocol's rule rejects what is *above* the limit, so the limit itself is quiet enough) or `maxWaitSeconds` have
// passed since the first reading. The clock and the reading are injectable. Returns what happened, for the campaign's state: the readings (first and last), how many, how long, and whether the
// time ran out with the machine still busy.
export async function waitForLoad({ read = readLoad, clock = defaultClock, limit, maxWaitSeconds, intervalSeconds }) {
  const started = clock.now();
  const first = read();
  let last = first;
  let polls = 1;
  for (;;) {
    const elapsed = (clock.now() - started) / 1000;
    if (last <= limit) {
      return { limit, maxWaitSeconds, intervalSeconds, first, last, polls, seconds: Math.round(elapsed * 10) / 10, timedOut: false };
    }
    if (elapsed >= maxWaitSeconds) {
      return { limit, maxWaitSeconds, intervalSeconds, first, last, polls, seconds: Math.round(elapsed * 10) / 10, timedOut: true };
    }
    await clock.sleep(Math.min(intervalSeconds, maxWaitSeconds - elapsed) * 1000);
    last = read();
    polls += 1;
  }
}
