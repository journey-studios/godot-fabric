"""Exercise archive recovery with real local tar fixtures, without downloads."""
import hashlib
import importlib.util
import io
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


class ArchiveRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.environment = tempfile.TemporaryDirectory()
        self.addCleanup(self.environment.cleanup)
        spec = importlib.util.spec_from_file_location(
            "fabric_setup", Path(__file__).resolve().parents[1] / "scripts/setup.py")
        self.setup = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.setup)
        self.setup.DEPS = Path(self.environment.name)
        self.setup.LOCK = {}
        self.addCleanup(patch.stopall)
        patch.object(self.setup, "run", side_effect=AssertionError("No network in recovery fixtures")).start()

    def archive(self, name, nested=False):
        directory = f"{name}-fixture"
        archive = self.setup.DEPS / f"{name}.tgz"
        with tarfile.open(archive, "w:gz") as contents:
            for filename in ("first.txt", "last.txt"):
                payload = filename.encode()
                member = tarfile.TarInfo(f"{directory}/{filename}" if nested else filename)
                member.size = len(payload)
                contents.addfile(member, io.BytesIO(payload))
        self.setup.LOCK[name] = {
            "archive": archive.name, "directory": directory,
            "sha256": hashlib.sha256(archive.read_bytes()).hexdigest()}
        return self.setup.DEPS / directory

    def interrupted_retry(self, name, nested, exception):
        destination = self.archive(name, nested)

        def interrupt(contents, path, **_kwargs):
            contents.extract(contents.getmembers()[0], path, filter="data")
            raise exception("Interrupted fixture extraction")

        with patch.object(tarfile.TarFile, "extractall", interrupt):
            with self.assertRaises(exception):
                self.setup.source(name)
        self.assertFalse(destination.exists(), "Partial extraction must never publish a destination")
        self.assertFalse(any(path.is_dir() for path in self.setup.DEPS.iterdir()), "Failed extraction removes its staging directory")
        self.assertEqual(self.setup.source(name), destination)
        self.assertEqual((destination / "last.txt").read_text(), "last.txt")

    def test_flat_archives_recover_after_failed_extraction(self):
        for name in ("hermes", "rn-dependencies"):
            with self.subTest(name=name):
                self.interrupted_retry(name, False, OSError)
                # Keep the next subtest's directory check independent.
                shutil.rmtree(self.setup.DEPS / f"{name}-fixture")

    def test_nested_archives_recover_after_failed_extraction(self):
        for name in ("react-native", "godot-cpp"):
            with self.subTest(name=name):
                self.interrupted_retry(name, True, OSError)
                shutil.rmtree(self.setup.DEPS / f"{name}-fixture")

    def test_keyboard_interrupt_cleans_staging(self):
        self.interrupted_retry("hermes", False, KeyboardInterrupt)

    def test_completed_destination_is_preserved(self):
        destination = self.archive("react-native", True)
        self.setup.source("react-native")
        with patch.object(tarfile.TarFile, "extractall", side_effect=AssertionError("Existing source was replaced")):
            self.assertEqual(self.setup.source("react-native"), destination)
        self.assertEqual((destination / "last.txt").read_text(), "last.txt")

    def test_checksum_is_verified_before_using_existing_source(self):
        destination = self.archive("hermes")
        self.setup.source("hermes")
        self.setup.LOCK["hermes"]["sha256"] = "0" * 64
        with self.assertRaisesRegex(RuntimeError, "Checksum mismatch"):
            self.setup.source("hermes")
        self.assertEqual((destination / "last.txt").read_text(), "last.txt")

    def test_missing_nested_root_is_not_published(self):
        destination = self.archive("react-native", False)
        with self.assertRaises(OSError):
            self.setup.source("react-native")
        self.assertFalse(destination.exists())
        self.assertFalse((self.setup.DEPS / "first.txt").exists())


class SetupPreflightTests(unittest.TestCase):
    def test_rejected_engine_stops_before_creating_outputs_or_downloading(self):
        scripts = Path(__file__).resolve().parents[1] / "scripts"
        spec = importlib.util.spec_from_file_location("fabric_setup", scripts / "setup.py")
        setup = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(setup)
        with tempfile.TemporaryDirectory() as directory:
            setup.PROJECT = Path(directory) / "project"
            setup.DEPS = setup.PROJECT / ".deps"
            setup.PROJECT.mkdir()
            rejected = subprocess.CalledProcessError(1, ["node", "scripts/godot-binary.mjs"])
            with patch.object(sys, "path", [str(scripts), *sys.path]), \
                    patch.object(setup.platform, "system", return_value="Darwin"), \
                    patch.object(setup.platform, "machine", return_value="arm64"), \
                    patch.object(setup, "run", side_effect=rejected) as command, \
                    patch.object(setup, "source") as download:
                with self.assertRaises(subprocess.CalledProcessError):
                    setup.main()
                command.assert_called_once_with("node", setup.PROJECT / "scripts/godot-binary.mjs")
                download.assert_not_called()
            self.assertFalse(setup.DEPS.exists())
            self.assertFalse((setup.PROJECT / "build").exists())
