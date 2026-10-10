"""Bounded tests for the exported Godot PCK reader; no Godot process required."""
import hashlib
import importlib.util
from pathlib import Path
import struct
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("godot_pack", ROOT / "scripts/godot_pack.py")
godot_pack = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(godot_pack)


def write_pack(path: Path, entries: list[tuple[str, bytes]]) -> None:
    """Write the small unencrypted standalone PCK v4 subset consumed by the inspector."""
    encoded = [(name.encode("utf-8") + b"\0", payload) for name, payload in entries]
    directory = 40
    table_size = 4 + sum(4 + len(name) + 36 for name, _ in encoded)
    file_base = directory + table_size
    table = bytearray(struct.pack("<I", len(encoded)))
    offset = 0
    for name, payload in encoded:
        table.extend(struct.pack("<I", len(name)))
        table.extend(name)
        table.extend(struct.pack("<QQ16sI", offset, len(payload), hashlib.md5(payload).digest(), 0))
        offset += len(payload)
    header = struct.pack("<6IQQ", 0x43504447, 4, 4, 7, 2, 2, file_base, directory)
    path.write_bytes(header + table + b"".join(payload for _, payload in encoded))


class GodotPackTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.pack = self.root / "consumer.pck"
        self.bundle = self.root / "app.js"
        self.bundle.write_bytes(b"globalThis.fabric = true;\n")

    def inspect(self, entries):
        write_pack(self.pack, entries)
        return godot_pack.inspect_pack(self.pack, self.bundle)

    def test_accepts_exact_bundle_and_runtime_payload(self):
        result = self.inspect([
            ("res://.godot_fabric/app.js", self.bundle.read_bytes()),
            ("res://addons/godot_fabric/native/macos/fabric_godot.gdextension", b"runtime"),
        ])
        self.assertTrue(result["bundleEmbeddedByteForByte"])
        self.assertTrue(result["editorScriptsExcluded"])
        self.assertEqual(result["fileCount"], 2)

    def test_rejects_truncated_header_or_table(self):
        self.pack.write_bytes(b"GDPK\x04")
        with self.assertRaisesRegex(RuntimeError, "Truncated PCK structure"):
            godot_pack.inspect_pack(self.pack, self.bundle)

    def test_rejects_duplicate_paths_after_res_prefix_normalization(self):
        with self.assertRaisesRegex(RuntimeError, "Duplicate PCK entry"):
            self.inspect([
                (".godot_fabric/app.js", self.bundle.read_bytes()),
                ("res://.godot_fabric/app.js", self.bundle.read_bytes()),
            ])

    def test_rejects_missing_bundle(self):
        with self.assertRaisesRegex(RuntimeError, "Generated JS bundle is absent or modified"):
            self.inspect([("res://unrelated.txt", b"not the bundle")])

    def test_rejects_modified_bundle(self):
        with self.assertRaisesRegex(RuntimeError, "Generated JS bundle is absent or modified"):
            self.inspect([("res://.godot_fabric/app.js", b"stale JS")])

    def test_rejects_editor_sdk_payload(self):
        with self.assertRaisesRegex(RuntimeError, "Editor-only SDK contents leaked"):
            self.inspect([
                ("res://.godot_fabric/app.js", self.bundle.read_bytes()),
                ("res://addons/godot_fabric/macos_export.gd", b"@tool"),
            ])

    def test_rejects_build_toolchain_payload(self):
        with self.assertRaisesRegex(RuntimeError, "Build-only SDK contents leaked"):
            self.inspect([
                ("res://.godot_fabric/app.js", self.bundle.read_bytes()),
                ("res://addons/godot_fabric/toolchain/build.mjs", b"build-only"),
            ])


if __name__ == "__main__":
    unittest.main()
