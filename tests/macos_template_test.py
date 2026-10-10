"""Guard tests for template derivation; these never invoke lipo or derive an archive."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("macos_template", ROOT / "scripts/macos-template.py")
macos_template = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(macos_template)


class MacOSTemplateGuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.lock_root = self.root / "repo"
        self.lock_root.mkdir()
        self.addCleanup(setattr, macos_template, "ROOT", ROOT)
        macos_template.ROOT = self.lock_root

    def locked_archive(self, expected: bytes):
        (self.lock_root / "dependencies.json").write_text(json.dumps({
            "godot": {
                "version": "4.7.2",
                "export_templates": {
                    "bytes": len(expected),
                    "sha256": hashlib.sha256(expected).hexdigest(),
                },
            },
        }))

    def test_rejects_wrong_archive_before_template_or_lipo_work(self):
        expected = b"locked official archive bytes"
        self.locked_archive(expected)
        archive = self.root / "wrong.tpz"
        # Matching size isolates the digest check from the separate byte-count guard.
        archive.write_bytes(b"x" * len(expected))
        output = self.root / "private" / "macos-arm64.zip"

        with self.assertRaisesRegex(RuntimeError, "differs from dependencies.json"):
            macos_template.derive(archive, output)

        self.assertFalse(output.exists())
        self.assertFalse(output.parent.exists(), "Rejected input must not create a publication directory")

    def test_rejects_existing_output_before_reading_archive(self):
        self.locked_archive(b"unused lock fixture")
        output = self.root / "already-there.zip"
        output.write_bytes(b"keep this file")
        archive = self.root / "missing.tpz"

        with self.assertRaisesRegex(RuntimeError, "Refusing to overwrite"):
            macos_template.derive(archive, output)

        self.assertEqual(output.read_bytes(), b"keep this file")

    def test_rejects_dangling_output_symlink(self):
        self.locked_archive(b"unused lock fixture")
        output = self.root / "dangling.zip"
        output.symlink_to(self.root / "not-created.zip")

        with self.assertRaisesRegex(RuntimeError, "Refusing to overwrite"):
            macos_template.derive(self.root / "missing.tpz", output)

        self.assertTrue(output.is_symlink())
        self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
