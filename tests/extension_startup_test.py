import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("extension_startup", Path(__file__).resolve().parents[1] / "scripts/extension_startup.py")
startup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(startup)


class ExtensionStartupTests(unittest.TestCase):
    def test_only_startup_list_is_created_and_other_extensions_survive(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            (project / "fabric.gdextension").touch()
            (project / "addons").mkdir()
            (project / "addons/fabric_godot.dylib").touch()
            startup.prepare_extension_startup(project)
            cache = project / ".godot"
            self.assertEqual([p.name for p in cache.iterdir()], ["extension_list.cfg"])
            target = cache / "extension_list.cfg"
            self.assertEqual(target.read_text(), "res://fabric.gdextension\n")
            target.write_text("res://other.gdextension")
            startup.prepare_extension_startup(project)
            expected = "res://other.gdextension\nres://fabric.gdextension\n"
            self.assertEqual(target.read_text(), expected)
            startup.prepare_extension_startup(project)
            self.assertEqual(target.read_text(), expected)

    def test_missing_library_is_visible_and_creates_no_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            (project / "fabric.gdextension").touch()
            with self.assertRaisesRegex(RuntimeError, "Missing Fabric library"):
                startup.prepare_extension_startup(project)
            self.assertFalse((project / ".godot").exists())

    def test_failed_publish_preserves_existing_extensions_and_removes_staging(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            (project / "fabric.gdextension").touch()
            (project / "addons").mkdir()
            (project / "addons/fabric_godot.dylib").touch()
            cache = project / ".godot"
            cache.mkdir()
            target = cache / "extension_list.cfg"
            target.write_text("res://other.gdextension\n")
            with patch.object(startup.os, "replace", side_effect=OSError("Injected publish failure")):
                with self.assertRaisesRegex(OSError, "Injected publish failure"):
                    startup.prepare_extension_startup(project)
            self.assertEqual(target.read_text(), "res://other.gdextension\n")
            self.assertEqual([p.name for p in cache.iterdir()], ["extension_list.cfg"])
            startup.prepare_extension_startup(project)
            self.assertEqual(target.read_text(), "res://other.gdextension\nres://fabric.gdextension\n")
