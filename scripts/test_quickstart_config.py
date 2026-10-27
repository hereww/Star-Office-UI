#!/usr/bin/env python3
from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "deploy/quickstart/configure_sub2api.py"


class QuickstartConfigTests(unittest.TestCase):
    def write_private(self, path: Path, value: str) -> None:
        path.write_text(value, encoding="utf-8")
        path.chmod(0o600)

    def test_noninteractive_configuration_keeps_token_out_of_env(self):
        with tempfile.TemporaryDirectory(prefix="quickstart-config-") as temp:
            root = Path(temp)
            token = root / "token"
            password = root / "password"
            ca = root / "ca.pem"
            self.write_private(token, "s2ut_" + "A" * 43 + "\n")
            self.write_private(password, "one-time-admin-password\n")
            ca.write_text("-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----\n", encoding="ascii")
            ca.chmod(0o644)
            subprocess.run([
                sys.executable, str(CONFIG), "--install-dir", str(root / "install"),
                "--sub2api-base-url", "https://sub2api.example",
                "--installation-id", "12", "--user-ids", "42,43",
                "--credential-expires-at", "2026-12-31T12:00:00Z",
                "--token-file", str(token), "--ca-file", str(ca),
                "--admin-password-file", str(password), "--non-interactive",
            ], check=True, capture_output=True, text=True)
            install = root / "install"
            env = (install / ".env").read_text(encoding="utf-8")
            self.assertNotIn("s2ut_", env)
            self.assertNotIn("one-time-admin-password", env)
            self.assertEqual((install / "private/office-consumer.token").stat().st_mode & 0o777, 0o600)
            self.assertEqual((install / "private/office-admin-password.hash").stat().st_mode & 0o777, 0o600)
            self.assertEqual((install / "private/upstream-ca.pem").stat().st_mode & 0o777, 0o644)

    def test_invalid_token_fails_closed(self):
        with tempfile.TemporaryDirectory(prefix="quickstart-config-invalid-") as temp:
            root = Path(temp)
            token = root / "token"
            password = root / "password"
            ca = root / "ca.pem"
            self.write_private(token, "not-a-token\n")
            self.write_private(password, "password\n")
            ca.write_text("-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----\n", encoding="ascii")
            ca.chmod(0o644)
            result = subprocess.run([
                sys.executable, str(CONFIG), "--install-dir", str(root / "install"),
                "--sub2api-base-url", "https://sub2api.example", "--installation-id", "1",
                "--user-ids", "1", "--credential-expires-at", "2026-12-31T12:00:00Z",
                "--token-file", str(token), "--ca-file", str(ca),
                "--admin-password-file", str(password), "--non-interactive",
            ], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("s2ut_", result.stderr)


if __name__ == "__main__":
    unittest.main()
