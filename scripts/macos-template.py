#!/usr/bin/env python3
"""Derive a private arm64 Release template from the locked official Godot TPZ."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
RELEASE = "macos_template.app/Contents/MacOS/godot_macos_release.universal"
ARM64 = RELEASE.removesuffix("universal") + "arm64"


def sha(filename):
    digest = hashlib.sha256()
    with filename.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def derive(archive: Path, output: Path) -> dict:
    lock = json.loads((ROOT / "dependencies.json").read_text())["godot"]
    pinned = lock["export_templates"]
    if output.exists() or output.is_symlink():
        raise RuntimeError("Refusing to overwrite an existing template destination")
    if archive.stat().st_size != pinned["bytes"] or sha(archive) != pinned["sha256"]:
        raise RuntimeError("Official export template archive differs from dependencies.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="fabric-arm64-template-", dir=output.parent) as directory:
        work = Path(directory)
        macos = work / "macos.zip"
        with zipfile.ZipFile(archive) as tpz:
            if tpz.read("templates/version.txt").decode().strip() != lock["version"] + ".stable":
                raise RuntimeError("Official template version differs from dependencies.json")
            with tpz.open("templates/macos.zip") as source, macos.open("xb") as dest:
                shutil.copyfileobj(source, dest)
        with zipfile.ZipFile(macos) as template:
            if ARM64 in template.namelist():
                raise RuntimeError("Official template unexpectedly contains the derived member")
            if sum(info.file_size for info in template.infolist()) > 512 * 1024 * 1024:
                raise RuntimeError("macOS template exceeds the bounded unpacked size")
            info = template.getinfo(RELEASE)
            release = work / "release.universal"
            with template.open(info) as source, release.open("xb") as dest:
                shutil.copyfileobj(source, dest)
        thin = work / "release.arm64"
        subprocess.run(["/usr/bin/lipo", str(release), "-thin", "arm64", "-output", str(thin)], check=True, timeout=30)
        archs = subprocess.run(["/usr/bin/lipo", "-archs", str(thin)], check=True, timeout=30, capture_output=True, text=True).stdout.strip()
        if archs != "arm64":
            raise RuntimeError("Derived engine is not arm64-only")
        derived = work / "macos-arm64.zip"
        shutil.copyfile(macos, derived)
        member = copy.copy(info)
        member.filename = ARM64
        with zipfile.ZipFile(derived, "a") as template:
            template.writestr(member, thin.read_bytes())
        observation = {"format": "godot-fabric.macos-template/v1", "version": lock["version"],
                       "officialArchiveSHA256": pinned["sha256"], "officialMacOSZipSHA256": sha(macos),
                       "universalReleaseSHA256": sha(release), "derivedMember": ARM64,
                       "derivedMemberSHA256": sha(thin), "derivedMemberBytes": thin.stat().st_size,
                       "derivedArchiveSHA256": sha(derived), "architectures": ["arm64"],
                       "installedTemplatesModified": False}
        # Hard-link publication fails atomically if another process creates output.
        output.hardlink_to(derived)
    return observation


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(derive(args.archive.resolve(), args.out.absolute()), indent=2))
