import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The lock against two campaigns on one machine (V05-10, `execucao`; `runs.process`: "no two executions overlap"). The orchestrator keeps one process at a time within a campaign; this keeps a
// second campaign (or a resume of the same one) from starting while the first is alive, whatever `--out` each has, because their executions would share the machine and the load rule would
// reject the one that the other disturbed. The lock is a file in the system's temporary directory with the pid, a token that only this campaign has and the `--out` of the campaign that holds it.
// A lock whose pid is alive refuses the new campaign; the lock is released when the campaign ends, however it ends, and only if it is still this campaign's (the token is compared).
//
// A lock whose pid is dead is old (the campaign was killed, which is how a `--resume` after a `SIGKILL` finds it) and is taken over, as a compare-and-claim under a mutex. Without the mutex two
// campaigns that read the same dead holder could both remove the lock and both write it: the first removes the stale lock and takes it, the second's removal then removes the first's LIVE lock,
// and both run. So the takeover is: create `<lock>.takeover` exclusively (a second taker, or a takeover that was interrupted, finds it and refuses); read the lock again under it and remove it
// only if its bytes are exactly the ones that were read as stale (anything else, a live campaign's lock or no lock, is left alone); remove the mutex; write the lock exclusively. If that write
// finds a lock, it is somebody else's: the loop reads it, finds its holder alive and refuses.

export const defaultLockFile = () => path.join(os.tmpdir(), "godot-fabric-frontier-comparison-campaign.lock");

// Whether a process with this pid exists: signal 0 only asks. EPERM means that it exists and belongs to someone else.
export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

// The text of a file, or `undefined` when it is not there (released since it was found).
async function textOf(file) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

// Who holds the lock, from its text: {pid, token, out}; `null` when the text holds no pid that can be read.
function holderOf(text) {
  try {
    const holder = JSON.parse(text);
    return Number.isInteger(holder?.pid) ? holder : null;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

// Removes a file only if it is still the one this campaign wrote (its token), for the lock and for the mutex.
async function removeIfOurs(file, token) {
  const text = await textOf(file);
  if (text !== undefined && holderOf(text)?.token === token) {
    await rm(file, { force: true });
  }
}

// Takes over a lock that was read as `stale` (the text of a lock whose pid is dead). The mutex is created exclusively; under it the lock is read again and removed only if it is the same text.
async function takeOver({ file, stale, pid, token }) {
  const mutex = `${file}.takeover`;
  try {
    await writeFile(mutex, `${JSON.stringify({ pid, token })}\n`, { flag: "wx" });
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(`another campaign is taking over the lock, or a takeover was interrupted: ${mutex} exists. If no campaign is running, remove ${mutex} by hand`);
    }
    throw error;
  }
  try {
    if ((await textOf(file)) === stale) {
      await rm(file, { force: true });
    }
  } finally {
    await removeIfOurs(mutex, token);
  }
}

// Takes the lock for the campaign whose directory is `out` and returns the function that releases it. It throws, naming the holder, if a campaign that is alive holds it; if the lock cannot be
// read, because refusing is safer than guessing; and if a takeover of a stale lock is going on or was left half done. `alive`, `pid`, `token` and `beforeTakeover` (a function awaited after the
// lock was read as stale and before the mutex is taken, where a test lets another campaign in) are injectable for the tests. The loop is bounded: a write, a takeover, a write, a takeover, a write.
export async function acquireLock({ file = defaultLockFile(), out, alive = isAlive, pid = process.pid, token = randomUUID(), beforeTakeover = async () => undefined }) {
  const body = `${JSON.stringify({ pid, token, out })}\n`;
  for (let tries = 0; tries < 3; tries += 1) {
    try {
      await writeFile(file, body, { flag: "wx" });
      return () => removeIfOurs(file, token);
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
    }
    const text = await textOf(file);
    if (text === undefined) {
      continue;
    }
    const holder = holderOf(text);
    if (holder === null) {
      throw new Error(`${file} holds no pid that can be read: remove it by hand if no campaign is running`);
    }
    if (alive(holder.pid)) {
      throw new Error(`another campaign is running on this machine (pid ${holder.pid}, --out ${holder.out}): two campaigns would overlap their executions. Wait for it, or stop it; the lock is ${file}`);
    }
    await beforeTakeover(holder);
    await takeOver({ file, stale: text, pid, token });
  }
  throw new Error(`could not take the lock ${file}`);
}
