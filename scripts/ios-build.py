"""Build pinned native iOS archives and a link witness, without rebuilding Godot.

Run after setup has downloaded the pinned sources/dependencies:
  python3 scripts/ios-build.py --target ios-simulator
  python3 scripts/ios-build.py --target ios-device
  python3 scripts/ios-build.py --xcframework
  python3 scripts/ios-build.py --target ios-simulator --architecture x86_64

The witness is a linked Mach-O executable, not an exported app or runtime proof.
Hermes and RN dependency frameworks remain dynamic: the consumer must link,
embed and sign them. Node and the native toolchain are not shipped in the app.
"""
import argparse
import hashlib
import json
import platform
import shutil
import subprocess
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
DEPS = PROJECT / ".deps"
LOCK = json.loads((PROJECT / "dependencies.json").read_text())


def run(*arguments, log=None):
    result = subprocess.run([str(arg) for arg in arguments], cwd=PROJECT,
                            text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if log:
        log.write(result.stdout)
        log.flush()
    if result.returncode:
        raise RuntimeError(f"Command failed ({result.returncode}): {arguments}\n{result.stdout[-12000:]}")
    return result.stdout.strip()


def sha256(file):
    with Path(file).open("rb") as contents:
        return hashlib.file_digest(contents, "sha256").hexdigest()


def inputs():
    files = [PROJECT / "native/CMakeLists.txt", PROJECT / "scripts/setup.py",
             PROJECT / "scripts/ios-build.py", PROJECT / "dependencies.json"]
    files += sorted((PROJECT / "native").glob("*.cpp"))
    files += sorted((PROJECT / "native").glob("*.h"))
    files += [PROJECT / "native/godot-profile.json"]
    return {str(file.relative_to(PROJECT)): sha256(file) for file in files}


def dependencies(target):
    for name in ("react-native", "hermes", "rn-dependencies", "godot-cpp"):
        dependency = LOCK[name]
        archive = DEPS / dependency["archive"]
        if not archive.exists() or sha256(archive) != dependency["sha256"]:
            raise RuntimeError(f"Missing or altered pinned {name} archive; run npm run setup")
        if not (DEPS / dependency["directory"]).is_dir():
            raise RuntimeError(f"Missing extracted {name}; run npm run setup")
    slice_name = "ios-arm64" if target == "ios-device" else "ios-arm64_x86_64-simulator"
    hermes = DEPS / LOCK["hermes"]["directory"] / "destroot/Library/Frameworks/universal/hermesvm.xcframework"
    rn = DEPS / LOCK["rn-dependencies"]["directory"] / "packages/react-native/third-party/ReactNativeDependencies.xcframework"
    libraries = [hermes / slice_name / "hermesvm.framework/hermesvm",
                 rn / slice_name / "ReactNativeDependencies.framework/ReactNativeDependencies"]
    for library in libraries:
        if not library.is_file():
            raise RuntimeError(f"Pinned iOS slice missing: {library}")
    return {str(library.relative_to(PROJECT)): sha256(library) for library in libraries}


def build_key(target, architecture):
    return target if architecture == "arm64" else f"{target}-{architecture}"


def build(target, configuration, jobs, architecture="arm64"):
    cmake = DEPS / "python/bin/cmake"
    if not cmake.exists():
        raise RuntimeError("Pinned CMake is missing; run npm run setup")
    sdk = "iphoneos" if target == "ios-device" else "iphonesimulator"
    sdk_path = run("xcrun", "--sdk", sdk, "--show-sdk-path")
    dependency_hashes = dependencies(target)
    source_hashes = inputs()
    key = build_key(target, architecture)
    output = DEPS / f"build-{key}" / configuration
    output.mkdir(parents=True, exist_ok=True)
    log_path = output / "build.log"
    with log_path.open("w") as log:
        run(cmake, "-S", PROJECT / "native", "-B", output,
            "-DCMAKE_SYSTEM_NAME=iOS", f"-DCMAKE_SYSTEM_PROCESSOR={architecture}",
            f"-DCMAKE_OSX_SYSROOT={sdk_path}",
            f"-DCMAKE_OSX_ARCHITECTURES={architecture}", "-DCMAKE_OSX_DEPLOYMENT_TARGET=15.1",
            f"-DCMAKE_BUILD_TYPE={configuration}",
            "-DGODOTCPP_TARGET=" + ("template_release" if configuration == "Release" else "template_debug"),
            log=log)
        print(f"Building {target} {architecture} {configuration}; log: {log_path}", flush=True)
        run(cmake, "--build", output, "--parallel", jobs,
            "--target", "fabric_godot", "fabric_ios_link_smoke", log=log)
    if inputs() != source_hashes:
        raise RuntimeError("Native sources changed during the build; rerun before publishing evidence")
    binding_configuration = "template_release" if configuration == "Release" else "template_debug"
    bindings = output / "bin" / f"libgodot-cpp.ios.{binding_configuration}.{architecture}.a"
    if not bindings.is_file():
        raise RuntimeError(f"Matching {architecture} godot-cpp archive is missing: {bindings}")
    destination = PROJECT / "addons/ios" / key / configuration
    destination.mkdir(parents=True, exist_ok=True)
    archive = destination / "libfabric_godot.a"
    # Merge our extension, upstream Fabric/Yoga and godot-cpp archives. Dynamic
    # framework dependencies are deliberately excluded from this static archive.
    run("xcrun", "libtool", "-static", "-o", archive, output / "libfabric_godot.a",
        output / "libfabric_core.a", bindings)
    witness = output / "fabric_ios_link_smoke"
    if run("xcrun", "lipo", "-archs", archive).split() != [architecture]:
        raise RuntimeError(f"Combined archive has the wrong architecture: {archive}")
    symbols = run("xcrun", "nm", "-g", witness)
    if not any(line.endswith(" T _fabric_library_init") for line in symbols.splitlines()):
        raise RuntimeError("The link witness did not retain the GDExtension entry symbol")
    witness_build = run("xcrun", "vtool", "-show-build", witness)
    expected_platform = "IOS" if target == "ios-device" else "IOSSIMULATOR"
    if not any(line.strip() == f"platform {expected_platform}" for line in witness_build.splitlines()):
        raise RuntimeError(f"Link witness has the wrong platform for {target}: {witness_build}")
    manifest = {
        "schemaVersion": 1, "target": target, "architecture": architecture,
        "configuration": configuration, "minimumIOS": "15.1",
        "sourceCommit": run("git", "rev-parse", "HEAD"),
        "sourceDirty": bool(run("git", "status", "--porcelain")),
        "sourceSHA256": source_hashes, "dependencyLibrarySHA256": dependency_hashes,
        "pinnedArchiveSHA256": {name: LOCK[name]["sha256"] for name in ("react-native", "hermes", "rn-dependencies", "godot-cpp")},
        "versions": {"reactNative": LOCK["react-native"]["version"], "react": LOCK["react"],
                     "hermes": LOCK["hermes"]["version"], "godot": LOCK["godot"]["version"],
                     "godotCpp": LOCK["godot-cpp"]["commit"], "cmake": LOCK["cmake"]},
        "toolchain": {"xcode": run("xcodebuild", "-version"), "sdk": sdk,
                      "sdkVersion": run("xcrun", "--sdk", sdk, "--show-sdk-version")},
        "archive": str(archive.relative_to(PROJECT)), "archiveSHA256": sha256(archive),
        "linkWitness": str(witness.relative_to(PROJECT)), "linkWitnessSHA256": sha256(witness),
        "linkWitnessBuild": witness_build,
        "linkWitnessDependencies": run("xcrun", "otool", "-L", witness),
        "entrySymbolRetained": True, "godotRebuilt": False,
        "runtimeExecuted": False, "consumerExported": False,
        "limitations": ["Build/link proof only; no Godot runtime, exported consumer or device acceptance",
                        "Hermes and ReactNativeDependencies frameworks require embedding and signing in the app",
                        "Static GDExtension entry symbol must survive the consumer link"],
    }
    manifest_path = destination / "build-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"GODOT_FABRIC_IOS_BUILD_PASSED: {manifest_path}")


def xcframework(configuration, architecture="arm64"):
    root = PROJECT / "addons/ios"
    archives = [root / target / configuration / "libfabric_godot.a"
                for target in ("ios-device", build_key("ios-simulator", architecture))]
    manifests = [archive.with_name("build-manifest.json") for archive in archives]
    data = [json.loads(manifest.read_text()) for manifest in manifests]
    if data[0]["sourceSHA256"] != data[1]["sourceSHA256"] or data[0]["versions"] != data[1]["versions"]:
        raise RuntimeError("Device and simulator build inputs differ; rebuild before packaging")
    if data[0]["sourceSHA256"] != inputs():
        raise RuntimeError("Native sources changed since the builds; rebuild before packaging")
    for archive, manifest in zip(archives, data):
        if sha256(archive) != manifest["archiveSHA256"]:
            raise RuntimeError(f"Archive changed after its build proof: {archive}")
    suffix = "" if architecture == "arm64" else f".{architecture}-simulator"
    output = root / f"godot_fabric.{configuration.lower()}{suffix}.xcframework"
    if output.exists():
        raise RuntimeError(f"XCFramework already exists; preserve it or select a fresh output: {output}")
    run("xcodebuild", "-create-xcframework", "-library", archives[0],
        "-library", archives[1], "-output", output)
    print(f"GODOT_FABRIC_IOS_XCFRAMEWORK: {output}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--target", choices=("ios-simulator", "ios-device"))
    selection.add_argument("--xcframework", action="store_true")
    parser.add_argument("--configuration", choices=("Debug", "Release"), default="Release")
    parser.add_argument("--architecture", choices=("arm64", "x86_64"), default="arm64",
                        help="Simulator architecture; device archives always use arm64")
    parser.add_argument("--jobs", type=int, default=4)
    options = parser.parse_args()
    if platform.system() != "Darwin" or not shutil.which("xcrun"):
        raise RuntimeError("iOS native builds require macOS with Xcode")
    if options.jobs < 1:
        parser.error("--jobs must be positive")
    if options.target == "ios-device" and options.architecture != "arm64":
        parser.error("iOS devices require --architecture arm64")
    if options.xcframework:
        xcframework(options.configuration, options.architecture)
    else:
        build(options.target, options.configuration, options.jobs, options.architecture)


if __name__ == "__main__":
    main()
