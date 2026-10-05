"""Verify explicit CI Node selection without changing the addon default."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "codegen_native_compile", Path(__file__).resolve().parents[1] / "scripts/codegen-native-compile.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class NodeSelectionTests(unittest.TestCase):
    def test_explicit_ci_node_does_not_require_private_runtime(self):
        with tempfile.TemporaryDirectory() as directory:
            node = Path(directory) / "CI tools" / "node"
            node.parent.mkdir()
            node.write_bytes(b"CI-installed executable")
            with patch.object(runner, "PROJECT", Path(directory) / "checkout"):
                self.assertEqual(runner.resolve_node(node, {"node": {"version": "22.23.3"}}), node.resolve())

    def test_default_uses_the_pinned_private_node(self):
        with tempfile.TemporaryDirectory() as directory:
            checkout = Path(directory)
            node = checkout / ".deps/node-v22.23.3-darwin-arm64/bin/node"
            node.parent.mkdir(parents=True)
            node.write_bytes(b"provisioned executable")
            with patch.object(runner, "PROJECT", checkout):
                self.assertEqual(runner.resolve_node(None, {"node": {"version": "22.23.3"}}), node)

    def test_missing_explicit_node_is_visible_without_fallback(self):
        with tempfile.TemporaryDirectory() as directory:
            checkout = Path(directory)
            private = checkout / ".deps/node-v22.23.3-darwin-arm64/bin/node"
            private.parent.mkdir(parents=True)
            private.write_bytes(b"private runtime must not hide bad CI configuration")
            with patch.object(runner, "PROJECT", checkout):
                with self.assertRaisesRegex(RuntimeError, "Explicit Node executable is missing"):
                    runner.resolve_node(checkout / "missing", {"node": {"version": "22.23.3"}})


if __name__ == "__main__":
    unittest.main()
