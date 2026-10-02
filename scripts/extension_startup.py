"""Discover Fabric before Godot's first editor filesystem scan.

Godot 4.7.2's import-only editor can dereference uninitialized documentation
when a scan discovers new extension classes. Its startup list avoids that late
registration path. No imported resources or editor cache are copied or trusted.
"""
import os
import tempfile
from pathlib import Path


def prepare_extension_startup(project: Path) -> None:
    if not (project / "fabric.gdextension").is_file():
        raise RuntimeError("Missing fabric.gdextension")
    if not (project / "addons/fabric_godot.dylib").is_file():
        raise RuntimeError("Missing Fabric library; run npm run setup first")
    cache = project / ".godot"
    cache.mkdir(exist_ok=True)
    target = cache / "extension_list.cfg"
    existing = target.read_text() if target.exists() else ""
    entry = "res://fabric.gdextension"
    if entry in existing.splitlines():
        return
    contents = existing + ("\n" if existing and not existing.endswith("\n") else "") + entry + "\n"
    # Preserve other extensions and publish a complete startup list atomically.
    handle, staging = tempfile.mkstemp(prefix=".extension-list-", dir=cache)
    try:
        with os.fdopen(handle, "w") as output:
            output.write(contents)
        os.replace(staging, target)
    finally:
        if os.path.exists(staging):
            os.unlink(staging)


if __name__ == "__main__":
    import sys
    prepare_extension_startup(Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1])
