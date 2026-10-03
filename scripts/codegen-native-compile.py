#!/usr/bin/env python3
"""Compile original Codegen artifacts with an existing native build's flags.

Compilation only; no CMake/core build, link, library loading or Godot execution.
Requires the prepared macOS arm64 Release build and provisioned Node:
  python3 scripts/codegen-native-compile.py --out build/codegen-native-proof
The output directory must be new. Failed attempts retain logs and report.json.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shlex
import subprocess
import sys

PROJECT = Path(__file__).resolve().parents[1]
LIBRARY = "CodegenFixture"
SPECS = ["NativeCodegenProbe.ts", "BadgeNativeComponent.ts"]
HARNESSES = [PROJECT / "tests/codegen/native_compile.cpp"]
FLAGS_FILE = PROJECT / ".deps/build/CMakeFiles/fabric_godot.dir/flags.make"
CACHE_FILE = PROJECT / ".deps/build/CMakeCache.txt"


def sha256(filename):
    digest = hashlib.sha256()
    with Path(filename).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def save_json(filename, value):
    filename.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def portable(filename):
    resolved = Path(filename).resolve()
    try:
        return resolved.relative_to(PROJECT).as_posix()
    except ValueError:
        return str(resolved)


def make_values(filename):
    values = {}
    for line in filename.read_text(encoding="utf-8").splitlines():
        match = re.fullmatch(r"([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)", line)
        if match:
            values[match[1]] = match[2]
    return values


def cache_values(filename):
    values = {}
    for line in filename.read_text(encoding="utf-8").splitlines():
        match = re.fullmatch(r"([^:#]+):[^=]+=(.*)", line)
        if match:
            values[match[1]] = match[2]
    return values


def hash_inputs():
    files = [FLAGS_FILE, CACHE_FILE, PROJECT / "dependencies.json",
             PROJECT / "package-lock.json", PROJECT / "scripts/codegen.mjs",
             PROJECT / "scripts/codegen-contract.mjs", Path(__file__), *HARNESSES,
             PROJECT / "tests/codegen/native-combination.json"]
    files += [PROJECT / "tests/codegen" / spec for spec in SPECS]
    return {portable(filename): sha256(filename) for filename in files}


def native_settings():
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        raise RuntimeError("This bounded witness requires a macOS arm64 host")
    cache = cache_values(CACHE_FILE)
    definitions = make_values(FLAGS_FILE)
    for name in ["CXX_DEFINES", "CXX_INCLUDES", "CXX_FLAGS"]:
        if name not in definitions or "$" in definitions[name]:
            raise RuntimeError(f"Missing or unexpanded CMake flags: {name}")
    if cache.get("CMAKE_BUILD_TYPE") != "Release" or cache.get("CMAKE_OSX_ARCHITECTURES") != "arm64":
        raise RuntimeError("Existing CMake build must be Release / arm64")
    if Path(cache.get("CMAKE_HOME_DIRECTORY", "")).resolve() != PROJECT / "native":
        raise RuntimeError("CMakeCache belongs to a different source checkout")
    compiler = Path(cache.get("CMAKE_CXX_COMPILER", ""))
    if not compiler.is_file():
        raise RuntimeError("Existing native compiler is missing")
    groups = {name: shlex.split(definitions[name]) for name in ["CXX_DEFINES", "CXX_INCLUDES", "CXX_FLAGS"]}
    flags = groups["CXX_FLAGS"]
    architectures = [flags[index + 1] for index, word in enumerate(flags[:-1]) if word == "-arch"]
    if architectures != ["arm64"] or "-mmacosx-version-min=13.0" not in flags:
        raise RuntimeError("Actual CXX_FLAGS must target macOS arm64 with minimum 13.0")
    if "-DNDEBUG" not in flags or "-O3" not in flags or "-std=gnu++20" not in flags:
        raise RuntimeError("Actual CXX_FLAGS must retain the native Release C++20 configuration")
    for flag in groups["CXX_INCLUDES"]:
        if not flag.startswith("-I") or len(flag) == 2:
            raise RuntimeError(f"Unsupported CMake include: {flag}")
    sysroot_index = flags.index("-isysroot") if "-isysroot" in flags else -1
    if sysroot_index < 0 or sysroot_index + 1 >= len(flags):
        raise RuntimeError("Actual native sysroot is missing")
    sysroot = Path(flags[sysroot_index + 1])
    if not sysroot.is_dir() or "MacOSX" not in sysroot.name:
        raise RuntimeError("Existing CMake flags must use a macOS SDK")
    return compiler, groups, sysroot


def run(arguments, output, report, stage, timeout=180):
    logfile = output / "logs" / f"{stage}.log"
    print(f"Codegen native witness: {stage}", flush=True)
    entry = {"stage": stage, "log": logfile.relative_to(output).as_posix(), "exitCode": None}
    report["stages"].append(entry)
    try:
        with logfile.open("w", encoding="utf-8") as log:
            log.write(shlex.join([str(arg) for arg in arguments]) + "\n\n")
            log.flush()
            try:
                completed = subprocess.run([str(arg) for arg in arguments], cwd=PROJECT,
                                           stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
                entry["exitCode"] = completed.returncode
            except subprocess.TimeoutExpired:
                entry["timedOut"] = True
                raise RuntimeError(f"{stage} timed out; retained log: {logfile}") from None
    finally:
        if logfile.is_file():
            entry["logSha256"] = sha256(logfile)
    if completed.returncode:
        raise RuntimeError(f"{stage} failed ({completed.returncode}); retained log: {logfile}")
    return logfile.read_text(encoding="utf-8")


def compile_witness(output, report):
    report["inputSha256"] = hash_inputs()
    compiler, groups, sysroot = native_settings()
    dependencies = json.loads((PROJECT / "dependencies.json").read_text(encoding="utf-8"))
    node = PROJECT / ".deps" / ("node-v" + dependencies["node"]["version"] + "-darwin-arm64") / "bin/node"
    if not node.is_file():
        raise RuntimeError("Provisioned private Node is missing; this runner does not install dependencies")
    generated = output / "generated"
    flags = [arg for name in ["CXX_DEFINES", "CXX_INCLUDES", "CXX_FLAGS"] for arg in groups[name]]
    report["target"] = {"platform": "macos", "architecture": "arm64", "configuration": "Release", "minimumOS": "13.0"}
    report["declaredVersions"] = {"reactNative": dependencies["react-native"]["version"],
                                  "react": dependencies["react"], "hermes": dependencies["hermes"]["version"],
                                  "godot": dependencies["godot"]["version"], "node": dependencies["node"]["version"]}
    report["flags"] = {name: [flag.replace(str(PROJECT), "${PROJECT}").replace(str(sysroot), "${MACOS_SDK}")
                             for flag in values] for name, values in groups.items()}
    report["includeDirectories"] = [{"path": portable(flag[2:]), "exists": Path(flag[2:]).is_dir()}
                                    for flag in groups["CXX_INCLUDES"]]
    report["compiler"] = {"path": str(compiler), "executableSha256": sha256(compiler), "sdk": sysroot.name}
    version = run([compiler, "--version"], output, report, "compiler-version")
    version_lines = [line for line in version.splitlines()
                     if line.startswith(("Apple clang version ", "clang version "))]
    if len(version_lines) != 1:
        raise RuntimeError("Existing native compiler did not report a unique Clang version")
    report["compiler"]["version"] = version_lines[0]
    base = [node, PROJECT / "scripts/codegen.mjs"]
    parameters = ["--root", PROJECT / "tests/codegen", "--library", LIBRARY,
                  "--native-combination", PROJECT / "tests/codegen/native-combination.json", "--out", generated]
    for spec in SPECS:
        parameters += ["--spec", spec]
    run([*base, "generate", *parameters], output, report, "generate")
    run([*base, "verify", *parameters], output, report, "verify-before-compile")
    manifest = json.loads((generated / "manifest.json").read_text(encoding="utf-8"))
    report["sourceManifestSha256"] = sha256(generated / "manifest.json")
    report["schemaSha256"] = manifest["schema"]["sha256"]
    report["declaredCombination"] = manifest["nativeCombination"]
    report["declarationAttested"] = False
    report["codegenTools"] = manifest["tools"]
    report["generatedSourceSha256"] = {entry["path"]: entry["sha256"] for entry in manifest["artifacts"]}
    sources = sorted((generated / "cpp/react/renderer/components" / LIBRARY).glob("*.cpp"))
    if {source.name for source in sources} != {"ComponentDescriptors.cpp", "EventEmitters.cpp", "Props.cpp", "ShadowNodes.cpp", "States.cpp"}:
        raise RuntimeError("Expected the original five common C++ component translation units")
    harness = output / "harness/native_compile.cpp"
    harness.write_bytes(HARNESSES[0].read_bytes())
    sources.append(harness)
    for index, source in enumerate(sources):
        obj = output / "objects" / (source.stem + ".o")
        entry = {"source": source.relative_to(output).as_posix(), "sourceSha256": sha256(source),
                 "object": obj.relative_to(output).as_posix()}
        report["translationUnits"].append(entry)
        try:
            run([compiler, *flags, "-I" + str(generated / "cpp"), "-c", source, "-o", obj],
                output, report, f"compile-{index + 1}-{source.stem}")
            entry["exitCode"] = 0
            entry["objectSha256"] = sha256(obj)
        except RuntimeError:
            entry["exitCode"] = report["stages"][-1].get("exitCode")
            raise
    run([*base, "verify", *parameters], output, report, "verify-after-compile")
    report["listedInputsMatchWorkingTree"] = hash_inputs() == report["inputSha256"]
    if not report["listedInputsMatchWorkingTree"]:
        raise RuntimeError("Witness inputs changed during compilation; preserve this attempt and rerun into a new output")
    report["nativeCompiled"] = True
    report["passed"] = True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    candidate = args.out if args.out.is_absolute() else PROJECT / args.out
    if os.path.lexists(candidate):
        parser.error("Output already exists; choose a new directory and preserve the prior attempt")
    output = candidate.resolve()
    build = (PROJECT / "build").resolve()
    if output == build or not output.is_relative_to(build):
        parser.error("Output must be a new child directory under this checkout's build/")
    try:
        output.mkdir(parents=True, exist_ok=False)
    except FileExistsError:
        parser.error("Output was created concurrently; it has been preserved")
    for directory in ["objects", "harness", "logs"]:
        (output / directory).mkdir()
    report = {"format": "godot-fabric.experimental-codegen-native-compile/v1",
              "checkedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "nativeCompiled": False, "nativeLinked": False, "nativeLoaded": False,
              "runtimeExecuted": False, "abiCertified": False, "declarationAttested": False,
              "nativeHeaderInputsVerified": False,
              "passed": False, "stages": [], "translationUnits": []}
    exit_code = 0
    try:
        compile_witness(output, report)
    except Exception as error:
        report["error"] = str(error)
        (output / "logs/failure.log").write_text(str(error) + "\n", encoding="utf-8")
        print(str(error), file=sys.stderr)
        exit_code = 1
    finally:
        save_json(output / "report.json", report)
    print(json.dumps({"passed": report["passed"], "translationUnits": len(report["translationUnits"]),
                      "report": portable(output / "report.json"), "nativeLinked": False,
                      "nativeLoaded": False, "runtimeExecuted": False, "abiCertified": False}), flush=True)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
