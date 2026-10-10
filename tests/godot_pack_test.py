"""Bounded tests for the exported Godot PCK reader; no Godot process required."""
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import subprocess
import sys
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

    def test_without_bundle_lists_sorted_paths_and_reports_the_addon_absent(self):
        write_pack(self.pack, [
            ("res://world/map.gd", b"map"),
            ("res://main_bare.tscn.remap", b"remap"),
            ("res://game/canon.gd", b"canon"),
        ])
        result = godot_pack.inspect_pack(self.pack)
        self.assertEqual(result["format"], 4)
        self.assertEqual(result["fileCount"], 3)
        self.assertTrue(result["fabricAddonExcluded"])
        self.assertEqual(result["paths"], ["game/canon.gd", "main_bare.tscn.remap", "world/map.gd"])
        self.assertEqual(result["pckSHA256"], hashlib.sha256(self.pack.read_bytes()).hexdigest())
        self.assertNotIn("bundleEmbeddedByteForByte", result)
        self.assertNotIn("buildToolchainExcluded", result)

    def test_without_bundle_reports_any_entry_under_the_addon(self):
        # The bundled inspector refuses leaked SDK contents; this mode reports the addon's presence for the caller to refuse.
        for leaked in ("res://addons/godot_fabric/native/macos/fabric_godot.gdextension",
                       "res://addons/godot_fabric/toolchain/build.mjs",
                       "res://addons/godot_fabric/macos_export.gd"):
            with self.subTest(leaked=leaked):
                write_pack(self.pack, [("res://main_bare.tscn.remap", b"remap"), (leaked, b"leaked")])
                result = godot_pack.inspect_pack(self.pack)
                self.assertFalse(result["fabricAddonExcluded"])
                self.assertIn(leaked.removeprefix("res://"), result["paths"])

    def test_without_bundle_does_not_mistake_a_sibling_folder_for_the_addon(self):
        write_pack(self.pack, [("res://addons/other/plugin.gd", b"other"), ("res://godot_fabric/x.gd", b"x")])
        self.assertTrue(godot_pack.inspect_pack(self.pack)["fabricAddonExcluded"])

    def test_without_bundle_still_rejects_a_broken_pack(self):
        self.pack.write_bytes(b"GDPK\x04")
        with self.assertRaisesRegex(RuntimeError, "Truncated PCK structure"):
            godot_pack.inspect_pack(self.pack)

    def run_cli(self, *args):
        return subprocess.run([sys.executable, str(ROOT / "scripts/godot_pack.py"), *map(str, args)], capture_output=True, text=True)

    def test_command_line_inspects_with_a_bundle_or_with_no_bundle_and_nothing_else(self):
        write_pack(self.pack, [("res://.godot_fabric/app.js", self.bundle.read_bytes()), ("res://main.tscn.remap", b"remap")])
        with_bundle = self.run_cli(self.pack, self.bundle)
        self.assertEqual(with_bundle.returncode, 0, with_bundle.stderr)
        self.assertTrue(json.loads(with_bundle.stdout)["bundleEmbeddedByteForByte"])
        without_bundle = self.run_cli(self.pack, "--no-bundle")
        self.assertEqual(without_bundle.returncode, 0, without_bundle.stderr)
        self.assertEqual(json.loads(without_bundle.stdout)["paths"], [".godot_fabric/app.js", "main.tscn.remap"])
        for refused in ([self.pack], [self.pack, self.bundle, "--no-bundle"]):
            with self.subTest(arguments=refused):
                result = self.run_cli(*refused)
                self.assertEqual(result.returncode, 2)
                self.assertIn("either the bundle or --no-bundle", result.stderr)

    def test_bundle_mode_states_its_facts_and_lists_the_paths_and_the_addon_like_the_other_mode(self):
        result = self.inspect([
            ("res://.godot_fabric/app.js", self.bundle.read_bytes()),
            ("res://addons/godot_fabric/native/macos/fabric_godot.gdextension", b"runtime"),
        ])
        self.assertEqual(sorted(result), ["buildToolchainExcluded", "bundleEmbeddedByteForByte", "editorScriptsExcluded",
                                          "fabricAddonExcluded", "fileCount", "format", "paths", "pckSHA256"])
        self.assertFalse(result["fabricAddonExcluded"])
        self.assertEqual(result["paths"], [".godot_fabric/app.js", "addons/godot_fabric/native/macos/fabric_godot.gdextension"])
        bundleless = godot_pack.inspect_pack(self.pack)
        self.assertEqual({key: bundleless[key] for key in ("format", "fileCount", "fabricAddonExcluded", "paths", "pckSHA256")},
                         {key: result[key] for key in ("format", "fileCount", "fabricAddonExcluded", "paths", "pckSHA256")})

    # Godot registers a PCK entry under String::simplify_path(path) without res:// (PackedData::add_path, 4.7.2),
    # so the inspector must judge the path Godot registers, not the spelling in the file.
    def test_without_bundle_counts_a_dotdot_entry_as_the_addon_it_resolves_to(self):
        write_pack(self.pack, [("res://main_bare.tscn.remap", b"remap"), ("res://addons/other/../godot_fabric/native/x.gdextension", b"x")])
        result = godot_pack.inspect_pack(self.pack)
        self.assertFalse(result["fabricAddonExcluded"])
        self.assertEqual(result["paths"], ["addons/godot_fabric/native/x.gdextension", "main_bare.tscn.remap"])

    def test_without_bundle_counts_dot_slash_and_repeated_slash_and_backslash_entries_as_the_addon(self):
        for spelling in ("./addons//godot_fabric/x", "res://./addons//godot_fabric/x", "res:///addons/godot_fabric/x",
                         "res://addons\\godot_fabric\\x", "res://addons/godot_fabric/./x", "res://addons/godot_fabric/a/../x"):
            with self.subTest(spelling=spelling):
                write_pack(self.pack, [(spelling, b"x")])
                result = godot_pack.inspect_pack(self.pack)
                self.assertFalse(result["fabricAddonExcluded"])
                self.assertEqual(result["paths"], ["addons/godot_fabric/x"])

    def test_paths_are_reported_as_godot_registers_them(self):
        write_pack(self.pack, [("res://./game//canon.gd", b"c"), ("world/../world/world.gd", b"w"), ("res://main_bare.tscn.remap", b"r")])
        self.assertEqual(godot_pack.inspect_pack(self.pack)["paths"], ["game/canon.gd", "main_bare.tscn.remap", "world/world.gd"])

    def test_a_dotdot_entry_that_leaves_the_addon_is_not_the_addon(self):
        write_pack(self.pack, [("res://addons/godot_fabric/../other/x.gd", b"x"), ("res://addons/godot_fabric_other/x.gd", b"y")])
        result = godot_pack.inspect_pack(self.pack)
        self.assertTrue(result["fabricAddonExcluded"])
        self.assertEqual(result["paths"], ["addons/godot_fabric_other/x.gd", "addons/other/x.gd"])

    def test_an_entry_that_climbs_above_the_root_is_rejected(self):
        for spelling in ("res://../x", "res://addons/../../x", "../x", "res://a/../../b", "res://.."):
            with self.subTest(spelling=spelling):
                write_pack(self.pack, [("res://main_bare.tscn.remap", b"remap"), (spelling, b"x")])
                with self.assertRaisesRegex(RuntimeError, "climbs above the project root"):
                    godot_pack.inspect_pack(self.pack)

    def test_an_entry_with_no_path_left_is_rejected(self):
        for spelling in ("res://", "res://./", "res://a/.."):
            with self.subTest(spelling=spelling):
                write_pack(self.pack, [(spelling, b"x")])
                with self.assertRaisesRegex(RuntimeError, "path is empty"):
                    godot_pack.inspect_pack(self.pack)

    def test_entries_that_resolve_to_the_same_path_are_duplicates(self):
        with self.assertRaisesRegex(RuntimeError, "Duplicate PCK entry"):
            self.inspect([("res://a/../b.gd", b"1"), ("res://./b.gd", b"2")])

    def test_bundle_mode_judges_the_resolved_path_of_a_leak_and_finds_the_bundle_through_one(self):
        with self.assertRaisesRegex(RuntimeError, "Build-only SDK contents leaked"):
            self.inspect([("res://.godot_fabric/app.js", self.bundle.read_bytes()), ("res://addons/other/../godot_fabric/toolchain/build.mjs", b"x")])
        result = self.inspect([("res://./.godot_fabric//app.js", self.bundle.read_bytes()), ("res://addons/godot_fabric/native/x.gdextension", b"x")])
        self.assertTrue(result["bundleEmbeddedByteForByte"])
        self.assertEqual(result["paths"], [".godot_fabric/app.js", "addons/godot_fabric/native/x.gdextension"])


if __name__ == "__main__":
    unittest.main()
