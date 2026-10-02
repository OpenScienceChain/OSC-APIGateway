#!/usr/bin/env python3

import importlib.util
import json
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from unittest import mock


MODULE_PATH = Path(__file__).with_name("check_npm_supply_chain.py")
SPEC = importlib.util.spec_from_file_location("check_npm_supply_chain", MODULE_PATH)
assert SPEC and SPEC.loader
SCANNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SCANNER)


class SupplyChainScannerTests(unittest.TestCase):
    def setUp(self):
        self.blocklist = {
            "keyv": {"6.0.0"},
            "flat-cache": {"6.1.24"},
            "file-entry-cache": {"11.1.6"},
        }
        self.policy = {}

    def write_lock(self, root: Path, packages: dict) -> Path:
        path = root / "package-lock.json"
        path.write_text(
            json.dumps(
                {
                    "name": "fixture",
                    "version": "1.0.0",
                    "lockfileVersion": 3,
                    "packages": {"": {"name": "fixture"}, **packages},
                }
            ),
            encoding="utf-8",
        )
        return path

    def test_safe_family_versions_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            lock = self.write_lock(
                root,
                {
                    "node_modules/keyv": {"version": "4.5.4"},
                    "node_modules/flat-cache": {"version": "3.2.0"},
                    "node_modules/file-entry-cache": {"version": "6.0.1"},
                },
            )
            findings, _ = SCANNER.scan_lock(lock, self.blocklist, self.policy)
            self.assertEqual([], findings)

    def test_known_malicious_versions_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            lock = self.write_lock(
                root,
                {
                    "node_modules/keyv": {"version": "6.0.0"},
                    "node_modules/flat-cache": {"version": "6.1.24"},
                    "node_modules/file-entry-cache": {"version": "11.1.6"},
                },
            )
            findings, _ = SCANNER.scan_lock(lock, self.blocklist, self.policy)
            self.assertEqual(3, len([item for item in findings if "BLOCKED" in item]))

    def test_scoped_nested_package_is_detected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            lock = self.write_lock(
                root,
                {
                    "node_modules/parent/node_modules/keyv": {
                        "version": "6.0.0"
                    }
                },
            )
            findings, _ = SCANNER.scan_lock(lock, self.blocklist, self.policy)
            self.assertTrue(any("keyv@6.0.0" in item for item in findings))

    def test_unreviewed_lifecycle_package_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            lock = self.write_lock(
                root,
                {
                    "node_modules/new-installer": {
                        "version": "1.0.0",
                        "hasInstallScript": True,
                    }
                },
            )
            findings, _ = SCANNER.scan_lock(lock, self.blocklist, self.policy)
            self.assertTrue(any("unreviewed lifecycle" in item for item in findings))

    def test_malformed_lock_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            lock = Path(directory) / "package-lock.json"
            lock.write_text("{", encoding="utf-8")
            with self.assertRaises(SCANNER.ScanError):
                SCANNER.load_lock(lock)

    def test_invalid_feed_schema_fails_closed(self):
        with self.assertRaises(SCANNER.ScanError):
            SCANNER.parse_blocklist_text("name,version\nkeyv,6.0.0\n", "fixture")

    def test_mixed_feed_ignores_valid_go_module_rows(self):
        loaded = SCANNER.parse_blocklist_text(
            "Package,Malicious Versions\n"
            "keyv,6.0.0\n"
            "github.com/example/module,v0.0.0-20260805040439-27421527967b\n",
            "fixture",
        )
        self.assertEqual({"keyv": {"6.0.0"}}, loaded)

    def test_unknown_package_syntax_fails_closed(self):
        with self.assertRaises(SCANNER.ScanError):
            SCANNER.parse_blocklist_text(
                "Package,Malicious Versions\nnot/a/valid/npm/name,1.0.0\n",
                "fixture",
            )

    def test_unavailable_feed_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "blocklist.csv").write_text(
                "Package,Malicious Versions\nkeyv,6.0.0\n", encoding="utf-8"
            )
            args = Namespace(blocklist="blocklist.csv", offline_reviewed=False,
                feed_url="https://invalid.example/iocs.csv", feed_timeout=1,
                minimum_feed_rows=1)
            with mock.patch.object(SCANNER, "fetch_feed",
                side_effect=SCANNER.ScanError("offline")):
                with self.assertRaises(SCANNER.ScanError):
                    SCANNER.load_blocklists(args, root)

    def test_explicit_offline_override_uses_vendored_data(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "blocklist.csv").write_text(
                "Package,Malicious Versions\nkeyv,6.0.0\n", encoding="utf-8"
            )
            args = Namespace(blocklist="blocklist.csv", offline_reviewed=True,
                feed_url="https://invalid.example/iocs.csv", feed_timeout=1,
                minimum_feed_rows=1)
            self.assertEqual({"6.0.0"}, SCANNER.load_blocklists(args, root)["keyv"])

    def test_repository_hook_is_detected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            hook = root / ".vscode" / "tasks.json"
            hook.parent.mkdir(parents=True)
            hook.write_text('{"runOptions":{"runOn":"folderOpen"}}', encoding="utf-8")
            findings = SCANNER.scan_repository_hooks(root)
            self.assertTrue(any("folderOpen" in item for item in findings))

    def test_mutable_action_reference_is_detected(self):
        findings = SCANNER.scan_workflow_policy(
            ".github/workflows/ci.yml",
            "jobs:\n  test:\n    steps:\n      - uses: actions/checkout@v6\n",
        )
        self.assertTrue(any("not pinned" in item for item in findings))

    def test_oidc_job_cannot_build_source(self):
        findings = SCANNER.scan_workflow_policy(
            ".github/workflows/deploy.yml",
            "jobs:\n  deploy:\n    permissions:\n      id-token: write\n"
            "    steps:\n      - run: docker build .\n",
        )
        self.assertTrue(any("OIDC job" in item for item in findings))

    def test_executable_payload_is_detected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "payload.node").write_bytes(b"fixture")
            findings = SCANNER.scan_repository_hooks(root)
            self.assertTrue(any("executable payload" in item for item in findings))


if __name__ == "__main__":
    unittest.main()
