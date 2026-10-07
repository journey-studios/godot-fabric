import {spawn} from "node:child_process";
import {createHash} from "node:crypto";
import {readFileSync, writeFileSync} from "node:fs";
import {constants} from "node:os";
import path from "node:path";

// The retained sabotages break a source on purpose and rebuild the host from it. Whatever ends the run, the source
// has to go back byte for byte: after the last variant, after a failed assertion, and when a signal ends the process
// (Ctrl+C, a cancelled CI job), which `finally` does not cover. The builds and the runs are children that the event
// loop awaits, so a signal reaches its handler while they work. The handler stops them first, because a compiler
// that outlived the restore could write an object of the broken source that is newer than the restored one, and
// make would trust it.
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const GRACE_MS = 5000;

export function guardSources(root, files) {
  const originals = new Map(files.map(file => [file, readFileSync(path.join(root, file))]));
  const genuine = Object.fromEntries([...originals].map(([file, content]) => [file, digest(content)]));
  const children = new Set();
  let interrupted = false;

  // Each child leads a process group of its own, so that one signal reaches the compilers a build starts and the
  // processes a run starts.
  const signalGroup = (child, signal) => {
    try {
      process.kill(-child.pid, signal);
    } catch {
      // The group is already gone.
    }
  };

  // Synchronous, so that it can finish inside an exit or a signal handler. A file that is already genuine is left
  // alone, so that its modification time does not move.
  function restore() {
    for (const [file, content] of originals) {
      const target = path.join(root, file);
      if (!readFileSync(target).equals(content)) {
        writeFileSync(target, content);
      }
    }
    const restored = Object.fromEntries([...originals.keys()].map(file => [file, digest(readFileSync(path.join(root, file)))]));
    const wrong = Object.keys(genuine).filter(file => restored[file] !== genuine[file]);
    if (wrong.length > 0) {
      throw new Error(`Every source is restored byte for byte, but ${wrong.join(", ")} is not`);
    }
    return restored;
  }

  function leave(signal) {
    let code = 128 + constants.signals[signal];
    try {
      restore();
      process.stderr.write(`${signal}: the sources are restored byte for byte. The host in addons/ may come from the interrupted build: rebuild it (cmake --build .deps/build --target fabric_godot) before using it.\n`);
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      code = 1;
    }
    process.exit(code);
  }

  // The signal goes on to the running children; a second one does not wait for them.
  async function interrupt(signal) {
    const again = interrupted;
    interrupted = true;
    const running = [...children];
    running.forEach(({child}) => signalGroup(child, again ? "SIGKILL" : signal));
    if (!again) {
      const escalation = setTimeout(() => running.forEach(({child}) => signalGroup(child, "SIGKILL")), GRACE_MS);
      await Promise.all(running.map(({closed}) => closed));
      clearTimeout(escalation);
    }
    leave(signal);
  }

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => interrupt(signal));
  }
  process.on("exit", () => {
    try {
      restore();
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  });

  // An awaited child; the result has the fields of spawnSync's that the scripts read, with the output as text.
  // Once a signal has come nothing returns to the script, which would go on to its next step: the child it was
  // waiting for does not return, and no new one starts. The handler restores the sources and exits.
  function run(command, args, {cwd = root, timeout = 600000} = {}) {
    if (interrupted) {
      return new Promise(() => {});
    }
    const child = spawn(command, args, {cwd, detached: true, stdio: ["ignore", "pipe", "pipe"]});
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", chunk => stdout.push(chunk));
    child.stderr.on("data", chunk => stderr.push(chunk));
    const closed = new Promise(resolve => {
      child.once("error", error => resolve({status: null, signal: null, error}));
      child.once("close", (status, signal) => resolve({status, signal, error: null}));
    });
    const entry = {child, closed};
    children.add(entry);
    // Past its timeout the group gets SIGTERM and, as on a signal, SIGKILL after the grace period. One signal would
    // leave `closed` pending for a child (or a grandchild holding the pipes) that ignores it, and the script would wait
    // on it with the sabotaged source in the tree. Both timers go when the child closes.
    let escalation;
    const timer = setTimeout(() => {
      signalGroup(child, "SIGTERM");
      escalation = setTimeout(() => signalGroup(child, "SIGKILL"), GRACE_MS);
    }, timeout);
    return closed.then(result => {
      clearTimeout(timer);
      clearTimeout(escalation);
      children.delete(entry);
      if (interrupted) {
        return new Promise(() => {});
      }
      return {...result, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8")};
    });
  }

  return {
    genuine,
    // The source of a variant with its one replacement made. A function replaces, so that `$` in the text means nothing.
    sabotaged({name, file, find, replace}) {
      const text = originals.get(file).toString("utf8");
      if (text.split(find).length !== 2) {
        throw new Error(`The ${name} sabotage must replace exactly one place in ${file}`);
      }
      return text.replace(find, () => replace);
    },
    swap(file, content) {
      if (!interrupted) {
        writeFileSync(path.join(root, file), content);
      }
    },
    restore,
    run,
  };
}
