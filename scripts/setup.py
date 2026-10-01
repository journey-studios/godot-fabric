"""Build Fabric's portable C++ core and a GDExtension; never rebuild Godot."""
import hashlib
import json
import platform
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
DEPS = PROJECT / ".deps"
LOCK = json.loads((PROJECT / "dependencies.json").read_text())


def run(*args, cwd=PROJECT):
    subprocess.run([str(arg) for arg in args], cwd=cwd, check=True)


def source(name):
    dependency = LOCK[name]
    archive = DEPS / dependency["archive"]
    if not archive.exists():
        print(f"Downloading pinned {name}", flush=True)
        run("curl", "--fail", "--location", "--silent", "--show-error", "--retry", "2",
            "--max-time", "180", dependency["url"], "--output", archive)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != dependency["sha256"]:
        raise RuntimeError(f"Checksum mismatch: {name}; remove {archive} and retry")
    destination = DEPS / dependency["directory"]
    if not destination.exists():
        # Publish only a complete extraction. A sibling staging directory makes
        # rename atomic and is cleaned even on KeyboardInterrupt or disk errors.
        with tempfile.TemporaryDirectory(prefix=f".{dependency['directory']}-", dir=DEPS) as staging:
            target = Path(staging)
            with tarfile.open(archive) as contents:
                contents.extractall(target, filter="data")
            extracted = target / dependency["directory"] if name in ("react-native", "godot-cpp") else target
            extracted.rename(destination)
    return destination


def main():
    if (platform.system(), platform.machine()) != ("Darwin", "arm64"):
        raise RuntimeError("This validation currently builds on macOS arm64 only")
    DEPS.mkdir(exist_ok=True)
    (DEPS / ".gdignore").touch()
    (PROJECT / "build").mkdir(exist_ok=True)
    (PROJECT / "build/.gdignore").touch()
    for name in ("react-native", "hermes", "rn-dependencies", "godot-cpp"):
        source(name)
    environment = DEPS / "python"
    cmake = environment / "bin/cmake"
    if not cmake.exists():
        run("python3", "-m", "venv", environment)
        run(environment / "bin/python", "-m", "pip", "install", f"cmake=={LOCK['cmake']}")
    run("npm", "ci", "--workspaces=false", "--ignore-scripts")
    (PROJECT / "node_modules/.gdignore").touch()
    run("npm", "run", "bundle")
    run(cmake, "-S", PROJECT / "native", "-B", DEPS / "build",
        "-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_OSX_ARCHITECTURES=arm64")
    print("Compiling upstream Fabric and Godot bindings; output in .deps/compile.log", flush=True)
    with (DEPS / "compile.log").open("w") as log:
        result = subprocess.run([str(cmake), "--build", str(DEPS / "build"), "--parallel", "4"], stdout=log, stderr=subprocess.STDOUT)
    if result.returncode:
        print((DEPS / "compile.log").read_text()[-12000:])
        raise RuntimeError("Native build failed; see .deps/compile.log")
    run(DEPS / "build/fabric_smoke")
    frameworks = PROJECT / "addons/frameworks"
    frameworks.mkdir(parents=True, exist_ok=True)
    # These are generated outputs. Replacing them also replaces framework
    # symlinks correctly on an idempotent second setup.
    for name in ("hermesvm.framework", "ReactNativeDependencies.framework"):
        destination = frameworks / name
        if destination.exists():
            shutil.rmtree(destination)
    shutil.copytree(DEPS / "hermes/destroot/Library/Frameworks/macosx/hermesvm.framework",
                    frameworks / "hermesvm.framework", symlinks=True, dirs_exist_ok=True)
    shutil.copytree(DEPS / "rndeps/packages/react-native/third-party/ReactNativeDependencies.xcframework/macos-arm64_x86_64/ReactNativeDependencies.framework",
                    frameworks / "ReactNativeDependencies.framework", symlinks=True, dirs_exist_ok=True)
    (PROJECT / "addons/.gdignore").touch()
    print("Hermes, Fabric, Yoga and the Godot extension are ready. Godot was not rebuilt.")


if __name__ == "__main__":
    main()
