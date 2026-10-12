import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("export_public", Path(__file__).parents[1] / "tools" / "export_public.py")
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


class ExportTests(unittest.TestCase):
    def test_scanner_rejects_credentials_without_echoing_them(self):
        for value in ("gh" + "p_" + "a" * 30, "Bearer " + "a" * 30, "api_key=" + "x" * 32, "12345678" + ":" + "x" * 35):
            with self.subTest(pattern=value[:5]):
                self.assertIn("credential-pattern", exporter.inspect_text(value))

    def test_scanner_blocks_unapproved_addresses_paths_and_private_terms(self):
        address = ".".join(["192", "0", "2", "45"])
        self.assertIn("network-address", exporter.inspect_text(address))
        private_path = "/" + "Users" + "/" + "local-user" + "/project"
        self.assertIn("machine-path", exporter.inspect_text(private_path))
        self.assertIn("private-term", exporter.inspect_text("SYNTHETIC private marker", ["private marker"]))
        self.assertIn("unapproved-url", exporter.inspect_text("https://" + "unreviewed.invalid/resource"))
        self.assertFalse(exporter.inspect_text("http://127.0.0.1:8088 https://example.org/material"))

    def test_standalone_provider_keys_do_not_depend_on_variable_name(self):
        for prefix in ("clip" + "roxy-", "s" + "k-", "s" + "k-proj-", "s" + "k-ant-api03-"):
            with self.subTest(prefix=prefix):
                sample = 'arbitrary_field = "' + prefix + "a" * 36 + '"'
                self.assertIn("credential-pattern", exporter.inspect_text(sample))
        address = "contributor" + "@" + "example.org"
        self.assertIn("email-address", exporter.inspect_text(address))

    def test_modern_cloudflare_and_installation_credentials_are_rejected(self):
        for prefix in ("cf" + "at_", "gh" + "s_", "gh" + "u_"):
            with self.subTest(prefix=prefix):
                self.assertIn("credential-pattern", exporter.inspect_text(prefix + "a" * 36))

    def test_export_ignores_unlisted_private_files_and_creates_hashes(self):
        with tempfile.TemporaryDirectory() as folder:
            base, output = Path(folder) / "source", Path(folder) / "export"
            base.mkdir()
            (base / "public-files.json").write_text(json.dumps({"files": ["README.md"]}))
            (base / "README.md").write_text("Synthetic public project.")
            (base / "hidden.dat").write_text("Not selected.")
            result = exporter.export(base, output)
            self.assertEqual(result["files"], 1)
            self.assertFalse((output / "hidden.dat").exists())
            manifest = json.loads((output / "release-manifest.json").read_text())
            self.assertEqual(len(manifest["files"][0]["sha256"]), 64)
            self.assertNotIn(str(base), (output / "release-manifest.json").read_text())

    def test_unsafe_path_symlink_and_binary_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            for name in ("../escape", "/absolute", "SPEC.md", "test.sqlite3"):
                (base / "public-files.json").write_text(json.dumps({"files": [name]}))
                with self.assertRaises(ValueError):
                    exporter.load_allowlist(base)
            (base / "link.txt").symlink_to(base / "public-files.json")
            (base / "public-files.json").write_text(json.dumps({"files": ["link.txt"]}))
            with self.assertRaises(ValueError):
                exporter.load_allowlist(base)

    def test_privacy_failure_leaves_no_partial_export(self):
        with tempfile.TemporaryDirectory() as folder:
            base, output = Path(folder) / "source", Path(folder) / "export"
            base.mkdir()
            (base / "public-files.json").write_text(json.dumps({"files": ["README.md"]}))
            marker = "private marker"
            (base / "README.md").write_text(marker)
            with self.assertRaises(ValueError) as caught:
                exporter.export(base, output, [marker])
            self.assertNotIn(marker, str(caught.exception))
            self.assertFalse(output.exists())

    def test_exported_content_is_the_reviewed_snapshot(self):
        with tempfile.TemporaryDirectory() as folder:
            base, output = Path(folder) / "source", Path(folder) / "export"
            base.mkdir()
            (base / "public-files.json").write_text(json.dumps({"files": ["README.md"]}))
            source = base / "README.md"
            source.write_text("Reviewed content.")
            scan = exporter.inspect_text
            def mutate_after_scanning(content, denied_terms=()):
                result = scan(content, denied_terms)
                source.write_text("Modified after review.")
                return result
            with patch.object(exporter, "inspect_text", side_effect=mutate_after_scanning):
                exporter.export(base, output)
            self.assertEqual((output / "README.md").read_text(), "Reviewed content.")


if __name__ == "__main__":
    unittest.main()
