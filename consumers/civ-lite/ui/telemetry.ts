import type { FrontierResult, FrontierSnapshot, Int, TileCard } from "./frontier-types";

// What the validation reads (`FrontierHud.stats()`) and nothing the HUD depends on: the store tells `observe` what it received and
// what it sent, and this module counts it. It is bounded, because a HUD runs for as long as the game does and this one is the template
// that gets copied: the counters count for the life of the HUD, and each list keeps only the last KEPT entries. A reader that wants
// what is new takes the counter it saw before from the one it sees now, and that many entries from the end of the list.
const KEPT = 64;
type Result = { id: string; ok: Int; code: string; job: Int };
type Seen = {
  snapshots: number; turn: number; context: string; screen: string; calls: number;
  phase: string; phaseCount: number; phases: string[]; lastJob: Int;
  epoch: Int; epochCount: number; epochs: Int[];
  resultCount: number; results: Result[];
  problemCount: number; problems: string[];
  hoverCount: number; hoverX: Int; hoverY: Int;
};
const seen: Seen = {
  snapshots: 0, turn: 0, context: "", screen: "game", calls: 0, phase: "", phaseCount: 0, phases: [], lastJob: -1,
  epoch: -1, epochCount: 0, epochs: [], resultCount: 0, results: [], problemCount: 0, problems: [],
  hoverCount: 0, hoverX: -1, hoverY: -1,
};

function remember<T>(kept: T[], entry: T) {
  kept.push(entry);
  if (kept.length > KEPT) {
    kept.shift();
  }
}

/** What the store reports, one narrow call for each thing the validation counts. */
export const observe = {
  snapshot(value: FrontierSnapshot) {
    seen.snapshots += 1;
    seen.turn = value.turn;
    seen.context = value.context;
    seen.lastJob = value.last_job;
    if (seen.phase !== value.phase) {
      seen.phase = value.phase;
      seen.phaseCount += 1;
      remember(seen.phases, value.phase);
    }
    if (seen.epoch !== value.epoch) {
      seen.epoch = value.epoch;
      seen.epochCount += 1;
      remember(seen.epochs, value.epoch);
    }
  },
  hover(value: TileCard) {
    seen.hoverCount += 1;
    seen.hoverX = value.present === 1 ? value.x : -1;
    seen.hoverY = value.present === 1 ? value.y : -1;
  },
  /** A call left for the game. */
  call() {
    seen.calls += 1;
  },
  /** The game answered a call. */
  result(method: string, reply: FrontierResult) {
    seen.resultCount += 1;
    remember(seen.results, { id: method, ok: reply.ok, code: reply.code, job: reply.job });
  },
  /** A rejected call, a connection that failed, an action the HUD does not know. */
  problem(error: unknown) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "ERROR";
    const message = error instanceof Error ? error.message : String(error);
    seen.problemCount += 1;
    remember(seen.problems, `${code}: ${message.split("\n")[0]}`);
  },
  screen(next: string) {
    seen.screen = next;
  },
};

declare global {
  var FrontierHud: {
    /** What the validation reads; the HUD never reads it back. */
    stats(): Seen & { subscriptions: number };
    /** The validation's way to send an intent by its name, the call a button makes. */
    send(id: string, args: Int[]): void;
  };
}

/** Installs `FrontierHud`, the global the validation reads. The store gives it what only the store knows: its connections, and how to send. */
export function installFrontierHud(store: { subscriptions(): number; send(id: string, args: Int[]): void }) {
  globalThis.FrontierHud = {
    stats: () => ({ subscriptions: store.subscriptions(), ...seen, epochs: [...seen.epochs], phases: [...seen.phases], results: [...seen.results],
      problems: [...seen.problems] }),
    send: store.send,
  };
}
