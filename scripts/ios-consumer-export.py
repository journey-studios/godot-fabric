#!/usr/bin/env python3
"""Export and execute an isolated Release consumer using official Godot templates.

Requires the already-built iOS XCFramework and cached SDK dependencies. Never
rebuilds Godot, modifies a user's project, or installs over an existing app.
Raw logs and generated projects stay in build/; successful evidence is opt-in.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import struct
import subprocess
import sys
import time
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[1]
NAME = "FabricIOSSmoke"

UI = '''import React, { useEffect, useState } from "react";
import { AppRegistry, View, Text, Button } from "react-native";
const probe = { react: React.version, effects: 0, cleanups: 0 };
(globalThis as any).IOSProbe = probe;
function IOSSmoke({ title }: { title: string }) {
  const [count, setCount] = useState(0);
  useEffect(() => { probe.effects++; return () => { probe.cleanups++; }; }, []);
  return <View testID="ios-panel" style={{ flex: 1, padding: 40, paddingTop: 160,
    gap: 28, backgroundColor: "#101b2e" }}>
    <Text testID="ios-title" style={{ fontSize: 48, color: "#f8fafc" }}>{title}</Text>
    <Text style={{ fontSize: 32, color: "#94a3b8" }}>React + Hermes + Godot</Text>
    <Text testID="ios-counter" style={{ fontSize: 48, color: "#a7f3d0" }}>{`Count: ${count}`}</Text>
    <Button testID="ios-increment" title="Increment" color="#0284c7" onPress={() => setCount(n => n + 1)} />
  </View>;
}
AppRegistry.registerComponent("IOSSmoke", () => IOSSmoke);
'''

VALIDATOR = '''extends Node
var checks: Array = []
var surface: Control
var runtime: Node

func check(condition: bool, message: String) -> void:
  checks.append({"name": message, "passed": condition})
  if not condition:
    push_error("IOS_CONSUMER_CHECK_FAILED: " + message)

func state() -> Dictionary:
  var result: Variant = JSON.parse_string(surface.call("snapshot"))
  return result if result is Dictionary else {}

func js(expression: String) -> Variant:
  return JSON.parse_string(runtime.call("evaluate", "JSON.stringify(" + expression + ")"))

func text(id: String) -> String:
  for entry: Dictionary in state().get("nodes", []):
    if entry.get("testID") == id:
      return entry.get("nativeText", "")
  return ""

func frames(count: int = 16) -> void:
  for _i in range(count):
    await get_tree().process_frame

func _ready() -> void:
  if not OS.get_cmdline_user_args().has("--validate"):
    return
  surface = $Surface
  runtime = $Application/Runtime
  run_probe()

func run_probe() -> void:
  await frames(60)
  var initial: Dictionary = state()
  check(OS.get_name() == "iOS", "Executed the exported iOS app")
  check(OS.has_feature("__ARCH__"), "Engine runtime reports the requested architecture")
  check(RenderingServer.get_current_rendering_method() == "gl_compatibility", "Mobile Compatibility renderer is active")
  check(FileAccess.file_exists("res://.godot_fabric/app.js"), "Hidden JavaScript bundle is available in the PCK")
  check(not FileAccess.file_exists("res://addons/godot_fabric/toolchain/node/bin/node"), "Private Node toolchain is excluded from runtime resources")
  check(ClassDB.class_exists("FabricApplication") and ClassDB.class_exists("FabricSurface"), "Static GDExtension registered both host classes")
  check(js("typeof HermesInternal !== 'undefined'") == true, "Original Hermes executes JavaScript")
  check(js("IOSProbe.react") == "19.2.3", "Original pinned React runs in Hermes")
  check(initial.get("rootCount") == 1 and initial.get("bundleEvaluations") == 1, "One application mounts one root and evaluates one bundle")
  check(text("ios-title") == "iOS Fabric" and text("ios-counter") == "Count: 0", "React commits initial props and native text")
  var button: Node = surface.find_child("ios-increment", true, false)
  var label: Node = surface.find_child("ios-counter", true, false)
  check(button is BaseButton and label is Control, "The React tree creates real Godot Controls")
  if button is BaseButton:
    button.emit_signal("pressed")
  await frames()
  check(text("ios-counter") == "Count: 1", "Native button signal dispatches React onPress and rerender")
  surface.call("update_props", {"title": "Props from Godot"})
  await frames()
  check(text("ios-title") == "Props from Godot" and text("ios-counter") == "Count: 1", "Prop update preserves local React state")
  check(state().get("surfaceId") == initial.get("surfaceId"), "Prop updates retain root identity")
  await RenderingServer.frame_post_draw
  check(get_viewport().get_texture().get_image().save_png("user://ios-consumer.png") == OK, "Rendered native UI capture saved")
  surface.call("unmount")
  await frames()
  check(state().get("nodes", []).is_empty() and js("IOSProbe.cleanups") == 1, "Unmount removes Controls and executes effect cleanup")
  check(surface.call("mount"), "Root remount succeeds")
  await frames()
  check(text("ios-counter") == "Count: 0" and js("IOSProbe.effects") == 2, "Remount resets state and executes a new effect")
  var before_stop: Dictionary = state()
  check(before_stop.get("errors", []).is_empty(), "Runtime remains free of Fabric errors")
  runtime.call("stop")
  var after_stop: Dictionary = state()
  check(after_stop.get("nativeTags") == 0 and after_stop.get("rootCount") == 0 and after_stop.get("pendingTimers") == 0, "Shutdown releases native tags, roots and timers")
  check(after_stop.get("applicationStopped") == true and after_stop.get("nativeModules", {}).get("stopped") == true, "Shutdown stops Hermes application and native modules")
  check(after_stop.get("errors", []).is_empty(), "Shutdown remains free of runtime errors")
  var success: bool = checks.all(func(entry: Dictionary) -> bool: return entry.passed)
  var report: Dictionary = {"schemaVersion": 1, "host": "exported-ios-consumer", "os": OS.get_name(),
    "displayServer": DisplayServer.get_name(), "renderer": RenderingServer.get_current_rendering_method(), "architecture": "__ARCH__",
    "checks": checks, "beforeStop": before_stop, "afterStop": after_stop, "passed": success}
  var output: FileAccess = FileAccess.open("user://ios-consumer.json", FileAccess.WRITE)
  output.store_string(JSON.stringify(report, "  ") + "\\n")
  output.close()
  print("IOS_CONSUMER_VALIDATION_PASSED" if success else "IOS_CONSUMER_VALIDATION_FAILED")
  get_tree().quit(0 if success else 1)
'''

PROJECT = '''config_version=5
[application]
config/name="Godot Fabric iOS Smoke"
config/icon="res://icon.svg"
run/main_scene="res://main.tscn"
run/disable_stdout=false
run/disable_stderr=false
run/flush_stdout_on_print=true
[debug]
file_logging/enable_file_logging=true
file_logging/enable_file_logging.mobile=true
file_logging/log_path="user://logs/ios-smoke.log"
[display]
window/size/viewport_width=720
window/size/viewport_height=1280
[rendering]
renderer/rendering_method="gl_compatibility"
renderer/rendering_method.mobile="gl_compatibility"
textures/vram_compression/import_etc2_astc=true
environment/defaults/default_clear_color=Color(0.035, 0.047, 0.075, 1)
[editor_plugins]
enabled=PackedStringArray("res://addons/godot_fabric/plugin.cfg")
[godot_fabric]
application="res://ui/application.tres"
'''

SCENE = '''[gd_scene load_steps=4 format=3]
[ext_resource type="Script" path="res://validation.gd" id="1"]
[ext_resource type="Script" path="res://addons/godot_fabric/application_node.gd" id="2"]
[ext_resource type="Resource" path="res://ui/application.tres" id="3"]
[node name="IOSConsumer" type="Node"]
script=ExtResource("1")
[node name="Application" type="Node" parent="."]
script=ExtResource("2")
application=ExtResource("3")
[node name="Surface" type="FabricSurface" parent="."]
anchors_preset=15
anchor_right=1.0
anchor_bottom=1.0
grow_horizontal=2
grow_vertical=2
application_path=NodePath("../Application/Runtime")
component_name="IOSSmoke"
initial_props={"title":"iOS Fabric"}
'''


def sha(file: Path) -> str:
    with file.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def run(args: list[str | Path], log: Path | None = None, timeout: int = 600) -> str:
    print("Running:", Path(str(args[0])).name, " ".join(str(x) for x in args[1:3]), flush=True)
    if log:
        with log.open("w") as stream:
            result = subprocess.run(args, cwd=ROOT, text=True, stdout=stream, stderr=subprocess.STDOUT, timeout=timeout)
        output = log.read_text(errors="replace")
    else:
        result = subprocess.run(args, cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout)
        output = result.stdout
    if result.returncode:
        raise RuntimeError(f"{args[0]} exited {result.returncode}; {log or output[-3000:]}")
    if log and ("SCRIPT ERROR:" in output or "FABRIC_ERROR:" in output):
        raise RuntimeError(f"Godot reported a script/Fabric error; see {log}")
    return output.strip()


def package_name(architecture: str) -> str:
    suffix = "" if architecture == "arm64" else f".{architecture}-simulator"
    return f"godot_fabric.release{suffix}.xcframework"


def inputs(require_current: bool = True, architecture: str = "arm64") -> dict:
    manifests = {}
    for target, slice_id in [("ios-simulator", f"ios-{architecture}-simulator"), ("ios-device", "ios-arm64")]:
        key = target if target == "ios-device" or architecture == "arm64" else f"{target}-{architecture}"
        value = json.loads((ROOT / f"addons/ios/{key}/Release/build-manifest.json").read_text())
        for file, expected in value["sourceSHA256"].items():
            if require_current and sha(ROOT / file) != expected:
                raise RuntimeError(f"Stale native iOS build input: {file}; replay ios-build.py first")
        for file, expected in value["dependencyLibrarySHA256"].items():
            if sha(ROOT / file) != expected:
                raise RuntimeError(f"Stale native iOS build input: {file}; replay ios-build.py first")
        library = ROOT / f"addons/ios/{package_name(architecture)}/{slice_id}/libfabric_godot.a"
        if sha(library) != value["archiveSHA256"]:
            raise RuntimeError(f"Packaged archive differs from build manifest: {target}")
        manifests[target] = value
    return manifests


def inspect_pack(pack: Path, bundle: Path) -> dict:
    """Read the bounded, unencrypted standalone PCK v4 written by Godot 4.7.2.

    Layout follows upstream core/io/file_access_pack.cpp; this does not execute
    a desktop engine against iOS GDExtension resources to inspect their bytes.
    """
    data = pack.read_bytes()
    magic, version, _major, _minor, _patch, flags = struct.unpack_from("<6I", data)
    if magic != 0x43504447 or version != 4 or flags != 2:
        raise RuntimeError("Expected an unencrypted standalone Godot PCK v4")
    file_base, directory = struct.unpack_from("<QQ", data, 24)
    count = struct.unpack_from("<I", data, directory)[0]
    cursor = directory + 4
    entries = {}
    for _ in range(count):
        size = struct.unpack_from("<I", data, cursor)[0]
        cursor += 4
        path = data[cursor:cursor + size].rstrip(b"\0").decode("utf8").removeprefix("res://")
        cursor += size
        offset, length = struct.unpack_from("<QQ", data, cursor)
        entry_flags = struct.unpack_from("<I", data, cursor + 32)[0]
        if entry_flags != 0:
            raise RuntimeError("Unexpected encrypted/delta PCK entry")
        entries[path] = data[file_base + offset:file_base + offset + length]
        cursor += 36
    expected = ".godot_fabric/app.js"
    if entries.get(expected) != bundle.read_bytes():
        raise RuntimeError("Generated JS bundle is absent or modified in exported PCK")
    for path in entries:
        if any(path.startswith("addons/godot_fabric/" + prefix) for prefix in ["toolchain/", "src/", "types/"]):
            raise RuntimeError(f"Build-only SDK contents leaked into PCK: {path}")
        if path in ["addons/godot_fabric/" + file + suffix for file in ["plugin", "ios_export", "build"]
                    for suffix in [".gd", ".gdc", ".gd.remap"]]:
            raise RuntimeError(f"Editor-only SDK script leaked into PCK: {path}")
    return {"format": version, "fileCount": count, "bundleEmbeddedByteForByte": True,
            "buildToolchainExcluded": True, "editorScriptsExcluded": True, "pckSHA256": sha(pack)}


def prepare(output: Path, godot: Path, manifests: dict, bundle_id: str, target: str, architecture: str) -> Path:
    consumer = output / "consumer"
    lock = json.loads((ROOT / "dependencies.json").read_text())
    archive = ROOT / f".deps/node-v{lock['node']['version']}-darwin-arm64.tar.gz"
    if not archive.is_file() or sha(archive) != lock["node"]["sha256"]:
        raise RuntimeError("Provision the pinned private Node archive before the export spike")
    node = ROOT / f".deps/node-v{lock['node']['version']}-darwin-arm64/bin/node"
    run([node, ROOT / "scripts/create-consumer.mjs", consumer], output / "provision.log")
    addon = consumer / "addons/godot_fabric"
    ios = addon / "native/ios"
    ios.mkdir()
    for source in [ROOT / "addons/ios" / package_name(architecture),
                   ROOT / ".deps/hermes/destroot/Library/Frameworks/universal/hermesvm.xcframework",
                   ROOT / ".deps/rndeps/packages/react-native/third-party/ReactNativeDependencies.xcframework"]:
        shutil.copytree(source, ios / source.name, symlinks=True)
    descriptor = addon / "fabric.gdextension"
    descriptor.write_text(descriptor.read_text().replace("res://addons/ios/", "res://addons/godot_fabric/native/ios/")
                          .replace("godot_fabric.release.xcframework", package_name(architecture)))
    portable = {target: {key: value for key, value in manifest.items() if key not in
                ["linkWitnessBuild", "linkWitnessDependencies"]} for target, manifest in manifests.items()}
    (ios / "build-manifests.json").write_text(json.dumps(portable, indent=2) + "\n")
    for file, contents in {"project.godot": PROJECT, "main.tscn": SCENE, "validation.gd": VALIDATOR.replace("__ARCH__", architecture),
                           "ui/index.tsx": UI, "icon.svg": '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#101b2e"/><path d="M280 240h464v120H400v140h280v120H400v164H280z" fill="#a7f3d0"/></svg>\n'}.items():
        (consumer / file).write_text(contents)
    (consumer / "export_presets.cfg").write_text(f'''[preset.0]
name="IOS"
platform="iOS"
runnable=true
export_filter="all_resources"
include_filter=""
exclude_filter="package.json,package-lock.json,tsconfig.json"
export_path=""
[preset.0.options]
architectures/arm64=true
application/app_store_team_id="FABRIC0000"
application/bundle_identifier="{bundle_id}"
application/signature="{NAME}"
application/short_version="1.0"
application/version="1"
application/min_ios_version="15.1"
application/export_project_only=true
''')
    sdk_node = addon / "toolchain/node/bin/node"
    run([sdk_node, addon / "toolchain/build.mjs", consumer, "res://ui/index.tsx", "res://.godot_fabric/app.js"], output / "bundle.log")
    run([godot, "--headless", "--editor", "--path", consumer, "--import"], output / "import.log", 180)
    exported = output / "export"
    exported.mkdir()
    run([godot, "--headless", "--path", consumer, "--export-release", "IOS", exported / f"{NAME}.zip"], output / "export.log", 180)
    project = exported / f"{NAME}.xcodeproj"
    pbx = (project / "project.pbxproj").read_text()
    dummy = (exported / NAME / "dummy.cpp").read_text()
    for token in ["hermesvm.xcframework", "ReactNativeDependencies.xcframework", package_name(architecture), "-Wl,-u,_fabric_library_init", "CodeSignOnCopy"]:
        if token not in pbx:
            raise RuntimeError(f"Generated Xcode project is missing: {token}")
    if "fabric_library_init" not in dummy or "register_dynamic_symbol" not in dummy:
        raise RuntimeError("Official exporter did not generate static extension registration")
    pack = inspect_pack(exported / f"{NAME}.pck", consumer / ".godot_fabric/app.js")
    (output / "pack-inspection.json").write_text(json.dumps(pack, indent=2) + "\n")
    sdk = "iphonesimulator" if target == "ios-simulator" else "iphoneos"
    destination = "generic/platform=iOS Simulator" if target == "ios-simulator" else "generic/platform=iOS"
    run(["xcodebuild", "-project", project, "-scheme", NAME, "-configuration", "Release", "-sdk", sdk,
         "-destination", destination, "-derivedDataPath", output / "DerivedData", f"ARCHS={architecture}",
         "ONLY_ACTIVE_ARCH=YES", "IPHONEOS_DEPLOYMENT_TARGET=15.1", "CODE_SIGNING_ALLOWED=NO"], output / "xcodebuild.log", 600)
    app = output / f"DerivedData/Build/Products/Release-{sdk}/{NAME}.app"
    if not app.is_dir():
        raise RuntimeError("Xcode did not produce the iOS app")
    if run(["xcrun", "lipo", "-archs", app / NAME]).split() != [architecture]:
        raise RuntimeError("Built iOS app has the wrong architecture")
    if "_fabric_library_init" not in run(["nm", "-g", app / NAME]):
        raise RuntimeError("Static extension entry symbol was stripped from app")
    for framework in ["hermesvm", "ReactNativeDependencies"]:
        if not (app / f"Frameworks/{framework}.framework/{framework}").is_file():
            raise RuntimeError(f"App did not embed {framework}")
    return app


def inspect_template(template: Path, output: Path, target: str, architecture: str) -> dict:
    slice_id = "ios-arm64_x86_64-simulator" if target == "ios-simulator" else "ios-arm64"
    prefix = "libgodot.ios.release.xcframework/"
    with zipfile.ZipFile(template) as archive:
        info = plistlib.loads(archive.read(prefix + "Info.plist"))
        library = output / "template-preflight.a"
        with archive.open(prefix + slice_id + "/libgodot.a") as source, library.open("wb") as dest:
            shutil.copyfileobj(source, dest)
    declared = next(x["SupportedArchitectures"] for x in info["AvailableLibraries"] if x["LibraryIdentifier"] == slice_id)
    actual = run(["xcrun", "lipo", "-archs", library]).split()
    result = {"templateSHA256": sha(template), "engineLibrarySHA256": sha(library), "slice": slice_id,
              "declaredArchitectures": declared, "actualArchitectures": actual}
    (output / "template-preflight.json").write_text(json.dumps(result, indent=2) + "\n")
    library.unlink()  # Owned temporary extraction; the installed template is untouched.
    if architecture not in actual:
        (output / "blocked-evidence.json").write_text(json.dumps({"schemaVersion": 1, "target": target,
            "stage": "official-template-preflight", "consumerExported": False, "runtimeExecuted": False,
            "godotRebuilt": False, "blocker": f"Installed official template lacks {architecture} engine code",
            **result}, indent=2) + "\n")
        raise RuntimeError("Official simulator template lacks actual arm64 engine code; installed templates are preserved. See template-preflight.json and Godot issue #122379")
    return result


def runtime_diagnostics(logs: str, template: dict, architecture: str) -> list[dict]:
    """Retain the one engine startup error reproduced without this addon.

    The exemption is bound to the executed native-only baseline, its exact
    template bytes and fixture inputs. Every other ERROR, or a repeated known
    error, rejects runtime acceptance.
    """
    baseline_path = ROOT / "docs/evidence/ios-consumer/engine-baseline.json"
    baseline = json.loads(baseline_path.read_text())
    diagnostic = baseline["observedEngineDiagnostic"]
    valid = (architecture == baseline["architecture"] and template == baseline["template"]
             and baseline["fabricExtensionIncluded"] is False and baseline["runtimeExecuted"]
             and baseline["report"]["passed"] and all(x["passed"] for x in baseline["report"]["checks"]))
    for file, expected in baseline["fixtureSHA256"].items():
        valid = valid and sha(baseline_path.parent / "engine-baseline-fixture" / file) == expected
    count = logs.count(diagnostic["text"]) if valid else 0
    unexpected = logs.replace(diagnostic["text"], "", 1) if count == diagnostic["count"] else logs
    if "ERROR:" in unexpected or "IOS_CONSUMER_VALIDATION_PASSED" not in logs:
        raise RuntimeError("Runtime logs contain unexpected errors or lack the success marker")
    return [{**diagnostic, "baselineEvidenceSHA256": sha(baseline_path)}] if count else []


def execute(output: Path, app: Path, bundle_id: str, requested: str | None, architecture: str, template: dict) -> dict:
    runtimes = json.loads(run(["xcrun", "simctl", "list", "runtimes", "--json"]))["runtimes"]
    supported = {runtime["identifier"] for runtime in runtimes if architecture in runtime.get("supportedArchitectures", [])}
    inventory = json.loads(run(["xcrun", "simctl", "list", "devices", "available", "--json"]))["devices"]
    choices = [(runtime, device) for runtime, devices in inventory.items() for device in devices
               if runtime in supported and "iPhone" in device["name"] and device["state"] == "Shutdown" and (not requested or device["udid"] == requested)]
    if not choices:
        raise RuntimeError("Select an available shutdown iPhone simulator; an existing running session is preserved")
    runtime, device = choices[-1]
    udid = device["udid"]
    booted = installed = False
    cleanup = {}
    try:
        run(["xcrun", "simctl", "boot", udid, f"--arch={architecture}"])
        booted = True
        run(["xcrun", "simctl", "bootstatus", udid, "-b"], output / "simulator-boot.log", 180)
        run(["xcrun", "simctl", "install", udid, app])
        installed = True
        launch = run(["xcrun", "simctl", "launch", f"--stdout={output / 'runtime-stdout.log'}",
                      f"--stderr={output / 'runtime-stderr.log'}", udid, bundle_id, "--", "--validate"])
        pid = int(launch.rsplit(":", 1)[1].strip())
        container = Path(run(["xcrun", "simctl", "get_app_container", udid, bundle_id, "data"]))
        report_file = None
        for _ in range(90):
            reports = list((container / "Documents").rglob("ios-consumer.json")) + list((container / "Library").rglob("ios-consumer.json"))
            if reports:
                report_file = reports[0]
                break
            time.sleep(1)
        if report_file is None:
            raise RuntimeError(f"iOS consumer produced no report in 90 seconds; see {output / 'runtime-stderr.log'}")
        report = json.loads(report_file.read_text())
        shutil.copy2(report_file, output / "runtime-report.json")
        capture = report_file.with_name("ios-consumer.png")
        if capture.is_file():
            shutil.copy2(capture, output / "ios-consumer.png")
        else:
            raise RuntimeError("Runtime report lacks a rendered capture")
        exited = False
        for _ in range(5):
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                exited = True
                break
            time.sleep(1)
        engine_log = report_file.parent / "logs/ios-smoke.log"
        if not engine_log.is_file():
            raise RuntimeError("Exported engine produced no user:// diagnostic log")
        shutil.copy2(engine_log, output / "runtime-engine.log")
        logs = "\n".join((output / file).read_text(errors="replace") for file in ["runtime-stdout.log", "runtime-stderr.log", "runtime-engine.log"])
        if not report.get("passed") or not report.get("checks") or not all(x["passed"] for x in report["checks"]):
            raise RuntimeError("Exported runtime acceptance failed; see runtime-report.json")
        diagnostics = runtime_diagnostics(logs, template, architecture)
        # UIKit may retain the app process after SceneTree.quit. Runtime.stop
        # has already proved zero native tags/roots/timers in the report. Record
        # natural exit separately and terminate only our isolated test app.
        if not exited:
            run(["xcrun", "simctl", "terminate", udid, bundle_id])
            cleanup["isolatedAppTerminatedByRunner"] = True
            for _ in range(10):
                try:
                    os.kill(pid, 0)
                except ProcessLookupError:
                    break
                time.sleep(1)
            else:
                raise RuntimeError("Isolated app process remained after explicit simulator termination")
        return {"runtime": runtime, "device": device["name"], "simulatorArchitecture": architecture,
                "report": report, "processExitedAfterQuit": exited, "knownEngineDiagnostics": diagnostics,
                "cleanup": cleanup}
    finally:
        failures = []
        for enabled, key, arguments in [(installed, "isolatedAppUninstalled", ["uninstall", udid, bundle_id]),
                                         (booted, "ownedSimulatorShutdown", ["shutdown", udid])]:
            if enabled:
                try:
                    run(["xcrun", "simctl", *arguments])
                    cleanup[key] = True
                except (RuntimeError, OSError, subprocess.TimeoutExpired) as error:
                    cleanup[key] = False
                    failures.append(str(error))
        (output / "cleanup.json").write_text(json.dumps(cleanup, indent=2) + "\n")
        if failures:
            raise RuntimeError("Simulator cleanup failed: " + "; ".join(failures))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="New isolated directory (default: build/ios-consumer/<uuid>)")
    parser.add_argument("--simulator", help="UDID of an available shutdown iPhone simulator")
    parser.add_argument("--target", choices=["ios-simulator", "ios-device"], default="ios-simulator")
    parser.add_argument("--architecture", choices=["arm64", "x86_64"], default="arm64", help="x86_64 is a separate Rosetta/iOS18 simulator spike")
    parser.add_argument("--build-only", action="store_true", help="Export and link an unsigned app; do not claim runtime acceptance")
    parser.add_argument("--use-built-checkpoint", action="store_true", help="Prove the fingerprinted existing binary even if native working-tree sources have changed")
    args = parser.parse_args()
    if args.target == "ios-device" and not args.build_only:
        raise RuntimeError("Physical-device execution needs signing and a device; use --target ios-device --build-only for the unsigned link checkpoint")
    if args.target == "ios-device" and args.architecture != "arm64":
        raise RuntimeError("Device exports require arm64")
    output = (args.output or ROOT / f"build/ios-consumer/{uuid.uuid4().hex[:12]}").resolve()
    if output.exists():
        raise RuntimeError("Use a new output directory; existing resources are preserved")
    godot = Path(os.environ.get("GODOT_BIN", "/Applications/Godot.app/Contents/MacOS/Godot"))
    version = run([godot, "--version"])
    if not version.startswith("4.7.2.stable.official."):
        raise RuntimeError("This checkpoint requires the official Godot 4.7.2 executable")
    template = Path.home() / "Library/Application Support/Godot/export_templates/4.7.2.stable/ios.zip"
    if not template.is_file():
        raise RuntimeError("Install the official Godot 4.7.2 iOS export templates")
    manifests = inputs(not args.use_built_checkpoint, args.architecture)
    output.mkdir(parents=True)
    print("ISOLATED_IOS_OUTPUT:", output, flush=True)
    template_info = inspect_template(template, output, args.target, args.architecture)
    bundle_id = "com.journeystudios.fabric.spike" + uuid.uuid4().hex[:12]
    app = prepare(output, godot, manifests, bundle_id, args.target, args.architecture)
    result = {} if args.build_only else execute(output, app, bundle_id, args.simulator, args.architecture, template_info)
    if inputs(not args.use_built_checkpoint, args.architecture) != manifests:
        raise RuntimeError("Native build manifests changed during consumer validation")
    consumer = output / "consumer"
    addon = consumer / "addons/godot_fabric"
    sdk_files = [file for directory in ["src", "types"] for file in (addon / directory).rglob("*") if file.is_file()]
    sdk_files += list(addon.glob("*.gd")) + list((addon / "toolchain").glob("*.mjs")) + [addon / "fabric.gdextension"]
    target_manifest = manifests[args.target]
    evidence = {"schemaVersion": 1, "target": args.target, "architecture": args.architecture, "configuration": "Release",
                "minimumIOS": "15.1", "godotVersion": version, "godotRebuilt": False, "consumerExported": True,
                "runtimeExecuted": not args.build_only, "physicalDeviceExecuted": False, "debugRuntimeExecuted": False,
                "interaction": "Godot BaseButton.pressed signal; physical touch/IME not exercised", **result,
                "versions": target_manifest["versions"], "toolchain": target_manifest["toolchain"],
                "nativeSourceSHA256": target_manifest["sourceSHA256"],
                "nativeSourcesMatchWorkingTree": all(sha(ROOT / file) == expected for file, expected in target_manifest["sourceSHA256"].items()),
                "nativeArchiveSHA256": target_manifest["archiveSHA256"],
                "template": template_info, "appBinarySHA256": sha(app / NAME),
                "bundleSHA256": sha(consumer / ".godot_fabric/app.js"),
                "sdkProvisionSourceCommit": json.loads((addon / "manifest.json").read_text())["sourceCommit"],
                "sdkSourceSHA256": {str(file.relative_to(addon)): sha(file) for file in sorted(sdk_files)},
                "fixtureSourceSHA256": {file: sha(consumer / file) for file in ["project.godot", "main.tscn", "validation.gd", "ui/index.tsx", "ui/application.tres", "export_presets.cfg"]},
                "pack": json.loads((output / "pack-inspection.json").read_text()),
                "exportSourceSHA256": {file: sha(ROOT / file) for file in ["fabric.gdextension", "scripts/ios-consumer-export.py", "sdk/addon/plugin.gd", "sdk/addon/ios_export.gd"]}}
    if not args.build_only:
        evidence["captureSHA256"] = sha(output / "ios-consumer.png")
    else:
        evidence["limitations"] = ["Unsigned device app build only; no runtime/device/touch/IME acceptance", "Simulator requires an actual arm64 official engine slice"]
    (output / "evidence.json").write_text(json.dumps(evidence, indent=2) + "\n")
    print("IOS_CONSUMER_EXPORT_BUILD_PASSED:" if args.build_only else "IOS_CONSUMER_EXPORT_RUNTIME_PASSED:", output, flush=True)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, subprocess.TimeoutExpired) as error:
        print("IOS_CONSUMER_EXPORT_RUNTIME_FAILED:", error, file=sys.stderr)
        sys.exit(1)
