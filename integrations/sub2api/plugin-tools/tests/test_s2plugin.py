"""Temporary test credentials only; no production signing keys are generated."""
import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
import warnings
import zipfile

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
import s2plugin as tool

OPENSSL = os.environ.get("S2PLUGIN_TEST_OPENSSL", "openssl")
KEY_ID = "lvdong-user-telemetry-v1"


class PackageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix=".s2plugin-tests-", dir=TOOLS)
        cls.root = Path(cls.temp.name)
        cls.private = cls.root / "external-test-private.pem"
        cls.public = cls.root / "test-public.pem"
        cls.other_private = cls.root / "other-private.pem"
        cls.other_public = cls.root / "other-public.pem"
        # Explicitly test-only ephemeral fixture keys, erased by tearDownClass.
        for private, public in ((cls.private, cls.public), (cls.other_private, cls.other_public)):
            tool.openssl_run(OPENSSL, ["genpkey", "-algorithm", "ED25519", "-out", private])
            private.chmod(0o600)
            tool.openssl_run(OPENSSL, ["pkey", "-in", private, "-pubout", "-out", public])
        cls.pub64 = base64.b64encode(tool.public_der(cls.public, OPENSSL)[-32:]).decode()
        cls.linux = cls.root / "linux-built-binary"
        cls.windows = cls.root / "windows-built-binary.exe"
        cls.linux.write_bytes(b"already-built-linux-fixture\x00\x01")
        cls.windows.write_bytes(b"already-built-windows-fixture\x00\x02")
        cls.ui = cls.root / "ui-build"
        cls.ui.mkdir()
        (cls.ui / "index.html").write_text('<html lang="zh"><body>Telemetry 设置</body></html>', encoding="utf-8")
        (cls.ui / "assets").mkdir()
        (cls.ui / "assets" / "app.js").write_text("console.log('fixture');\n")
        cls.package = cls.root / "valid.s2plugin"
        cls.manifest = tool.build_package({"linux-amd64": cls.linux, "windows-amd64": cls.windows},
                                         cls.ui, cls.private, KEY_ID, cls.package, openssl=OPENSSL)
        with zipfile.ZipFile(cls.package) as archive:
            cls.contents = {name: archive.read(name) for name in archive.namelist()}

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def setUp(self):
        self.work = Path(tempfile.mkdtemp(prefix="case-", dir=self.root))
        self.addCleanup(shutil.rmtree, self.work)

    def verify(self, package=None, **kwargs):
        options = {"public_key": self.public, "platform": "linux-amd64", "openssl": OPENSSL}
        options.update(kwargs)
        return tool.verify_package(package or self.package, KEY_ID, **options)

    def build(self, **kwargs):
        options = {"runtimes": {"linux-amd64": self.linux}, "ui_dir": self.ui,
                   "private_key": self.private, "publisher_key_id": KEY_ID,
                   "output": self.work / "output.s2plugin", "openssl": OPENSSL}
        options.update(kwargs)
        return tool.build_package(**options)

    def mutate(self, changes=None, delete=(), extra=None):
        contents = {key: value for key, value in self.contents.items() if key not in delete}
        contents.update(changes or {})
        contents.update(extra or {})
        path = self.work / "mutated.s2plugin"
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, data in contents.items():
                archive.writestr(name, data)
        return path

    def cloned_ui(self):
        path = self.work / "ui"
        shutil.copytree(self.ui, path)
        return path

    def cli(self, *args):
        return subprocess.run([sys.executable, str(TOOLS / "s2plugin.py"), *map(str, args)],
                              capture_output=True, text=True, timeout=40)

    def test_http_compat_release_explicit_version_and_legacy_verification(self):
        manifest = self.build(version="0.1.1")
        verified = self.verify(self.work / "output.s2plugin")
        self.assertEqual(manifest["version"], "0.1.1")
        self.assertEqual(verified, manifest)
        self.assertEqual(self.verify()["version"], "0.1.0")
        with self.assertRaises(tool.PackageError):
            self.build(version="9.9.9")

    def test_daily_model_release_version(self):
        manifest = self.build(version="0.2.0")
        self.assertEqual(manifest["version"], "0.2.0")

    def test_contents_requirements_hashes_and_modes(self):
        result = self.verify()
        self.assertEqual(result, self.manifest)
        self.assertEqual(result["id"], "com.lvdong.user-telemetry")
        self.assertEqual(result["version"], "0.1.0")
        self.assertEqual(result["requires"], {"sub2api": ">=0.2.13 <0.3.0", "plugin_protocol": 1,
                                             "user_telemetry_api": 1, "ui_bridge": 1})
        self.assertEqual(result["capabilities"], [tool.CAPABILITY])
        expected = {"manifest.json", "signature.json", "runtimes/linux-amd64/user-telemetry",
                    "runtimes/windows-amd64/user-telemetry.exe", "ui/index.html", "ui/assets/app.js"}
        self.assertEqual(set(self.contents), expected)
        self.assertNotIn("transport_api", result["requires"])
        with zipfile.ZipFile(self.package) as archive:
            for info in archive.infolist():
                self.assertEqual(info.extra, b"")
                self.assertEqual(info.comment, b"")
                self.assertTrue(stat.S_ISREG(info.external_attr >> 16))
                if info.filename.startswith("runtimes/"):
                    self.assertEqual((info.external_attr >> 16) & 0o777, 0o700)
        for name, expected_hash in result["files"].items():
            self.assertRegex(expected_hash, r"^[a-f0-9]{64}$")
            self.assertEqual(hashlib.sha256(self.contents[name]).hexdigest(), expected_hash)

    def test_private_key_not_in_archive(self):
        private_bytes = self.private.read_bytes()
        self.assertNotIn(self.private.name, self.contents)
        for data in self.contents.values():
            self.assertNotIn(private_bytes, data)
            self.assertNotIn(b"PRIVATE KEY", data)

    def test_raw_public_base64_and_second_platform(self):
        result = self.verify(public_key=None, public_key_base64=self.pub64, platform="windows-amd64")
        self.assertEqual(result["version"], tool.VERSION)

    def test_missing_target_platform(self):
        with self.assertRaisesRegex(tool.PackageError, "target platform linux-arm64"):
            self.verify(platform="linux-arm64")
        with self.assertRaisesRegex(tool.PackageError, "target platform linux-arm64"):
            self.build(require_platforms=["linux-arm64"])

    def test_empty_platform_map(self):
        with self.assertRaisesRegex(tool.PackageError, "at least one runtime"):
            self.build(runtimes={})

    def test_custom_sub2api_range(self):
        self.assertEqual(self.build(sub2api=">=0.2.14 <0.3.0")["requires"]["sub2api"], ">=0.2.14 <0.3.0")
        with self.assertRaisesRegex(tool.PackageError, "invalid sub2api range"):
            self.build(sub2api="just-newer")

    def test_tampered_binary_and_ui_hashes_fail(self):
        for name in ("ui/index.html", "runtimes/linux-amd64/user-telemetry"):
            with self.subTest(name=name):
                path = self.mutate({name: self.contents[name] + b"tampered"})
                with self.assertRaisesRegex(tool.PackageError, "SHA-256 mismatch"):
                    self.verify(path)

    def test_equivalent_json_bytes_still_fail_signature(self):
        raw = json.dumps(self.manifest, indent=2).encode()
        self.assertNotEqual(raw, self.contents["manifest.json"])
        with self.assertRaisesRegex(tool.PackageError, "OpenSSL operation failed"):
            self.verify(self.mutate({"manifest.json": raw}))

    def test_rehash_without_resigning_fails(self):
        manifest = json.loads(self.contents["manifest.json"])
        changed = b"changed runtime"
        manifest["files"]["runtimes/linux-amd64/user-telemetry"] = hashlib.sha256(changed).hexdigest()
        path = self.mutate({"manifest.json": tool.json_bytes(manifest), "runtimes/linux-amd64/user-telemetry": changed})
        with self.assertRaisesRegex(tool.PackageError, "OpenSSL operation failed"):
            self.verify(path)

    def test_wrong_public_key_and_corrupt_signature(self):
        with self.assertRaisesRegex(tool.PackageError, "OpenSSL operation failed"):
            self.verify(public_key=self.other_public)
        sig = json.loads(self.contents["signature.json"])
        value = bytearray(base64.b64decode(sig["signature"]))
        value[0] ^= 1
        sig["signature"] = base64.b64encode(value).decode()
        with self.assertRaisesRegex(tool.PackageError, "OpenSSL operation failed"):
            self.verify(self.mutate({"signature.json": tool.json_bytes(sig)}))

    def test_wrong_key_id_algorithm_and_unsigned_fail(self):
        for field, value in (("key_id", "unknown-publisher"), ("algorithm", "rsa")):
            sig = json.loads(self.contents["signature.json"])
            sig[field] = value
            with self.assertRaisesRegex(tool.PackageError, "trusted publisher"):
                self.verify(self.mutate({"signature.json": tool.json_bytes(sig)}))
        with self.assertRaisesRegex(tool.PackageError, "missing/oversized signature"):
            self.verify(self.mutate(delete=["signature.json"]))

    def test_extra_and_missing_files_fail(self):
        for path in (self.mutate(extra={"rogue.txt": b"extra"}), self.mutate(delete=["ui/index.html"])):
            with self.assertRaisesRegex(tool.PackageError, "contents differ"):
                self.verify(path)

    def test_archive_traversal_absolute_windows_and_noncanonical_paths(self):
        for name in ("../escape", "/absolute", "ui/../escape", "ui//double", "ui/./dot", "ui/back\\slash", "C:/evil", " ui/evil", "ui/evil "):
            with self.subTest(name=name), self.assertRaisesRegex(tool.PackageError, "unsafe archive path"):
                self.verify(self.mutate(extra={name: b"malicious"}))

    def test_zip_symlink_duplicate_directory_and_metadata_fail(self):
        for variant in ("symlink", "duplicate", "directory", "extra", "comment"):
            path = self.work / (variant + ".s2plugin")
            shutil.copyfile(self.package, path)
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                with zipfile.ZipFile(path, "a") as archive:
                    info = zipfile.ZipInfo("ui/evil" if variant != "duplicate" else "ui/index.html")
                    info.create_system = 3
                    if variant == "symlink":
                        info.external_attr = (stat.S_IFLNK | 0o777) << 16
                    elif variant == "directory":
                        info.filename = "ui/dir/"
                    elif variant == "extra":
                        info.extra = b"\x01\x00\x00\x00"
                    elif variant == "comment":
                        archive.comment = b"extra archive comment"
                    archive.writestr(info, b"evil")
            with self.subTest(variant=variant), self.assertRaises(tool.PackageError):
                self.verify(path)

    def test_ui_missing_entrypoint_and_empty_binary(self):
        ui = self.cloned_ui()
        (ui / "index.html").unlink()
        with self.assertRaisesRegex(tool.PackageError, "UI entrypoint"):
            self.build(ui_dir=ui)
        binary = self.work / "empty"
        binary.touch()
        with self.assertRaisesRegex(tool.PackageError, "must not be empty"):
            self.build(runtimes={"linux-amd64": binary})

    def test_source_symlinks_parent_links_and_hidden_ui_rejected(self):
        ui = self.cloned_ui()
        (ui / "key-link").symlink_to(self.private)
        with self.assertRaisesRegex(tool.PackageError, "symlinks"):
            self.build(ui_dir=ui)
        link = self.work / "runtime-link"
        link.symlink_to(self.linux)
        with self.assertRaisesRegex(tool.PackageError, "symlinks"):
            self.build(runtimes={"linux-amd64": link})
        parent = self.work / "parent-link"
        parent.symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(tool.PackageError, "symlinks"):
            self.build(runtimes={"linux-amd64": parent / self.linux.name})
        (ui / "key-link").unlink()
        (ui / ".env").write_text("unintended build file")
        with self.assertRaisesRegex(tool.PackageError, "hidden"):
            self.build(ui_dir=ui)

    def test_private_key_inside_ui_copy_hardlink_and_runtime_rejected(self):
        ui = self.cloned_ui()
        for method in ("copy", "hardlink", "embedded"):
            candidate = ui / "key.txt"
            if method == "copy":
                shutil.copyfile(self.private, candidate)
            elif method == "hardlink":
                os.link(self.private, candidate)
            else:
                candidate.write_bytes(b"prefix" + self.private.read_bytes() + b"suffix")
            with self.subTest(method=method), self.assertRaisesRegex(tool.PackageError, "private key|private signing"):
                self.build(ui_dir=ui)
            candidate.unlink()
        inside = ui / "private.pem"
        shutil.copyfile(self.private, inside)
        with self.assertRaisesRegex(tool.PackageError, "outside the UI"):
            self.build(ui_dir=ui, private_key=inside)
        with self.assertRaisesRegex(tool.PackageError, "private key"):
            self.build(runtimes={"linux-amd64": self.private})

    def test_non_ed25519_key_rejected(self):
        key = self.work / "x25519.pem"
        tool.openssl_run(OPENSSL, ["genpkey", "-algorithm", "X25519", "-out", key])
        with self.assertRaisesRegex(tool.PackageError, "key must be Ed25519"):
            self.build(private_key=key)

    def test_unknown_manifest_fields_and_transport_not_accepted(self):
        for mutation in (lambda m: m.update({"extra": 1}),
                         lambda m: m["requires"].update({"transport_api": 1}),
                         lambda m: m["capabilities"][0].update({"id": "model.call"})):
            manifest = json.loads(self.contents["manifest.json"])
            mutation(manifest)
            with self.assertRaises(tool.PackageError):
                self.verify(self.mutate({"manifest.json": tool.json_bytes(manifest)}))

    def test_duplicate_json_keys_and_multiple_documents_rejected(self):
        for raw in (b'{"id":"one","id":"two"}', self.contents["manifest.json"] + b"{}"):
            with self.assertRaisesRegex(tool.PackageError, "invalid manifest JSON"):
                self.verify(self.mutate({"manifest.json": raw}))

    def test_invalid_semver_ranges_and_protocols(self):
        for expression in ("", " ", "^0.2.13", "~0.2.13", ">=0.2.13 || <0.3.0", "0.2.13-01", ">=01.2.13", "*", ">= 0.2.13"):
            with self.subTest(expression=expression), self.assertRaises(tool.PackageError):
                self.build(sub2api=expression)
        for field in ("plugin_protocol", "user_telemetry_api", "ui_bridge"):
            manifest = json.loads(self.contents["manifest.json"])
            manifest["requires"][field] = 2
            with self.subTest(field=field), self.assertRaisesRegex(tool.PackageError, "protocol requirement"):
                self.verify(self.mutate({"manifest.json": tool.json_bytes(manifest)}))
        manifest = json.loads(self.contents["manifest.json"])
        manifest["files"]["ui/index.html"] = manifest["files"]["ui/index.html"].upper()
        with self.assertRaisesRegex(tool.PackageError, "lowercase SHA-256"):
            self.verify(self.mutate({"manifest.json": tool.json_bytes(manifest)}))

    def test_base64_validation(self):
        for raw in ("not base64!", base64.b64encode(b"short").decode()):
            with self.assertRaises(tool.PackageError):
                self.verify(public_key=None, public_key_base64=raw)

    def test_json_must_be_utf8_without_bom(self):
        for raw in (json.dumps(self.manifest).encode("utf-16"), b"\xef\xbb\xbf" + self.contents["manifest.json"]):
            with self.subTest(encoding=raw[:4]), self.assertRaisesRegex(tool.PackageError, "invalid manifest JSON"):
                self.verify(self.mutate({"manifest.json": raw}))

    def test_file_count_and_size_limits(self):
        ui = self.cloned_ui()
        for index in range(509):
            (ui / ("file-%03d" % index)).touch()
        with self.assertRaisesRegex(tool.PackageError, "512 ZIP entries"):
            self.build(ui_dir=ui)
        with mock.patch.object(tool, "MAX_UPLOAD", 1):
            with self.assertRaisesRegex(tool.PackageError, "upload size"):
                self.verify()
        with mock.patch.object(tool, "MAX_UNCOMPRESSED", 1):
            with self.assertRaisesRegex(tool.PackageError, "uncompressed size"):
                self.verify()
        with mock.patch.object(tool, "MANIFEST_LIMIT", 1):
            with self.assertRaisesRegex(tool.PackageError, "oversized manifest"):
                self.verify()

    def test_atomic_output_failures_preserve_previous_file_and_clean_temp(self):
        output = self.work / "previous.s2plugin"
        output.write_bytes(b"old output")
        for stage in ("sign_manifest", "verify_package", "os.replace"):
            with self.subTest(stage=stage), mock.patch("s2plugin." + stage, side_effect=tool.PackageError("injected failure")):
                with self.assertRaisesRegex(tool.PackageError, "injected failure"):
                    self.build(output=output)
            self.assertEqual(output.read_bytes(), b"old output")
            self.assertEqual(list(self.work.glob(".s2plugin-*.tmp")), [])
        self.build(output=output)
        self.verify(output)

    def test_output_may_not_overwrite_inputs_or_enter_ui(self):
        with self.assertRaisesRegex(tool.PackageError, "inside the UI"):
            self.build(output=self.ui / "bad.s2plugin")
        runtime = self.work / "runtime.s2plugin"
        runtime.write_bytes(b"runtime fixture")
        with self.assertRaisesRegex(tool.PackageError, "overwrite a runtime"):
            self.build(output=runtime, runtimes={"linux-amd64": runtime})
        self.assertEqual(runtime.read_bytes(), b"runtime fixture")

    def test_reproducible_package_bytes(self):
        one, two = self.work / "one.s2plugin", self.work / "two.s2plugin"
        self.build(output=one)
        self.build(output=two)
        self.assertEqual(one.read_bytes(), two.read_bytes())

    def test_cli_pack_verify_public_export_and_errors(self):
        output = self.work / "cli.s2plugin"
        args = ["pack", "--runtime", "linux-amd64:" + str(self.linux), "--ui-dir", self.ui,
                "--signing-key", self.private, "--key-id", KEY_ID, "--output", output, "--openssl", OPENSSL]
        result = self.cli(*args)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["result"], "package_verified")
        result = self.cli("verify", output, "--public-key", self.public, "--key-id", KEY_ID,
                          "--platform", "linux-amd64", "--openssl", OPENSSL)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("semver alone is insufficient", result.stdout)
        result = self.cli("public-key", "--signing-key", self.private, "--openssl", OPENSSL)
        self.assertEqual(result.stdout.strip(), self.pub64)
        result = self.cli(*args, "--runtime", "linux-amd64:" + str(self.linux))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unique GOOS-GOARCH", result.stderr)
        self.assertNotIn(self.private.read_text().strip(), result.stdout + result.stderr)
        result = self.cli("verify", output, "--public-key", self.public, "--key-id", KEY_ID)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--platform", result.stderr)

    def test_reserved_publisher_id_and_openssl_failure_do_not_replace_output(self):
        with self.assertRaisesRegex(tool.PackageError, "built-in transport"):
            self.build(publisher_key_id=tool.RESERVED_KEY_ID)
        output = self.work / "stable.s2plugin"
        output.write_bytes(b"previous")
        with self.assertRaisesRegex(tool.PackageError, "OpenSSL unavailable"):
            self.build(openssl=self.work / "nonexistent-openssl", output=output)
        self.assertEqual(output.read_bytes(), b"previous")

    @unittest.skipUnless(shutil.which("go"), "optional independent Go signature check requires Go")
    def test_independent_go_host_crypto_semantics(self):
        helper = TOOLS / "tests" / "verify_signature.go"
        args = ["go", "run", str(helper), str(self.package), self.pub64, KEY_ID]
        result = subprocess.run(args, capture_output=True, text=True, timeout=120, cwd=TOOLS)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("all payload hashes verified", result.stdout)
        tampered = self.mutate({"ui/index.html": b"evil"})
        args[-3] = str(tampered)
        result = subprocess.run(args, capture_output=True, text=True, timeout=120, cwd=TOOLS)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("hash failed", result.stderr)
        raw_change = self.mutate({"manifest.json": self.contents["manifest.json"] + b" "})
        args[-3] = str(raw_change)
        result = subprocess.run(args, capture_output=True, text=True, timeout=120, cwd=TOOLS)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("signature failed", result.stderr)


if __name__ == "__main__":
    unittest.main()
