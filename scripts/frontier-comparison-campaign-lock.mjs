import { readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The lock against two campaigns on one machine (V05-10, `execucao`; `runs.process`: "no two executions overlap"). The orchestrator keeps one process at a time within a campaign; this keeps a
// second campaign (or a resume of the same one) from starting while the first is alive, whatever `--out` each has, because their executions would share the machine and the load rule would
// reject the one that the other disturbed. The lock is a file in the system's temporary directory with the pid and the `--out` of the campaign that holds it. A lock whose pid is dead is old (the
// campaign was killed) and is taken over; a lock whose pid is alive refuses the new campaign; the lock is released when the campaign ends, however it ends.

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

// Who holds the lock: {pid, out}; `null` when the file holds nothing that can be read, `undefined` when the file is not there (released since it was found).
async function holderOf(file) {
  try {
    const holder = JSON.parse(await readFile(file, "utf8"));
    return Number.isInteger(holder.pid) ? holder : null;
  } catch (error) {
    if (error.code === "ENOENT") {
      return undefined;
    }
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

// Takes the lock for the campaign whose directory is `out` and returns the function that releases it (which removes the lock only if it is still this campaign's). It throws, naming the holder,
// if a campaign that is alive holds it; and if the lock cannot be read, because refusing is safer than guessing.
export async function acquireLock({ file = defaultLockFile(), out, alive = isAlive, pid = process.pid }) {
  const body = `${JSON.stringify({ pid, out })}\n`;
  for (let tries = 0; tries < 2; tries += 1) {
    try {
      await writeFile(file, body, { flag: "wx" });
      return async () => {
        if ((await holderOf(file))?.pid === pid) {
          await rm(file, { force: true });
        }
      };
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
    }
    const holder = await holderOf(file);
    if (holder === undefined) {
      continue;
    }
    if (holder === null) {
      throw new Error(`${file} holds no pid that can be read: remove it by hand if no campaign is running`);
    }
    if (alive(holder.pid)) {
      throw new Error(`another campaign is running on this machine (pid ${holder.pid}, --out ${holder.out}): two campaigns would overlap their executions. Wait for it, or stop it; the lock is ${file}`);
    }
    await rm(file, { force: true });
  }
  throw new Error(`could not take the lock ${file}`);
}
