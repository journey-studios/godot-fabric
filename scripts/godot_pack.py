#!/usr/bin/env python3
"""Inspect the unencrypted standalone PCK v4 emitted by Godot 4.7.2."""
import argparse
import hashlib
import json
from pathlib import Path
import struct


def inspect_pack(pack: Path, bundle: Path) -> dict:
    # Layout: upstream core/io/file_access_pack.cpp. Never execute the package
    # against another platform's GDExtension to inspect its contents.
    if pack.stat().st_size > 512 * 1024 * 1024:
        raise RuntimeError("PCK exceeds the bounded inspection size")
    data = pack.read_bytes()

    def unpack(fmt, offset):
        if offset < 0 or offset + struct.calcsize(fmt) > len(data):
            raise RuntimeError("Truncated PCK structure")
        return struct.unpack_from(fmt, data, offset)

    magic, version, _major, _minor, _patch, flags = unpack("<6I", 0)
    if magic != 0x43504447 or version != 4 or flags != 2:
        raise RuntimeError("Expected an unencrypted standalone Godot PCK v4")
    file_base, directory = unpack("<QQ", 24)
    count, = unpack("<I", directory)
    if count > len(data) // 40 or file_base > len(data):
        raise RuntimeError("PCK table exceeds its file bounds")
    cursor = directory + 4
    entries = {}
    for _ in range(count):
        size, = unpack("<I", cursor)
        cursor += 4
        if size == 0 or cursor + size > len(data):
            raise RuntimeError("Truncated PCK entry path")
        name = data[cursor:cursor + size].rstrip(b"\0").decode("utf8").removeprefix("res://")
        cursor += size
        offset, length = unpack("<QQ", cursor)
        entry_flags, = unpack("<I", cursor + 32)
        if entry_flags != 0:
            raise RuntimeError("Unexpected encrypted/delta PCK entry")
        if name in entries:
            raise RuntimeError("Duplicate PCK entry")
        if file_base + offset + length > len(data):
            raise RuntimeError("Truncated PCK entry payload")
        entries[name] = data[file_base + offset:file_base + offset + length]
        cursor += 36
    if entries.get(".godot_fabric/app.js") != bundle.read_bytes():
        raise RuntimeError("Generated JS bundle is absent or modified in exported PCK")
    editor_scripts = {"plugin", "ios_export", "macos_export", "export_payload", "export_preflight", "build"}
    for name in entries:
        if not name.startswith("addons/godot_fabric/"):
            continue
        relative = name.removeprefix("addons/godot_fabric/")
        if relative.startswith(("toolchain/", "src/", "types/")):
            raise RuntimeError(f"Build-only SDK contents leaked into PCK: {name}")
        if relative in {script + suffix for script in editor_scripts for suffix in (".gd", ".gdc", ".gd.remap")} or relative in {"plugin.cfg", "manifest.json", "native/ios/build-manifests.json"}:
            raise RuntimeError(f"Editor-only SDK contents leaked into PCK: {name}")
    return {"format": version, "fileCount": count, "bundleEmbeddedByteForByte": True,
            "buildToolchainExcluded": True, "editorScriptsExcluded": True,
            "pckSHA256": hashlib.sha256(data).hexdigest()}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pack", type=Path)
    parser.add_argument("bundle", type=Path)
    args = parser.parse_args()
    print(json.dumps(inspect_pack(args.pack, args.bundle), indent=2))
