import hashlib
import importlib.util
import json
from pathlib import Path
import shlex
import subprocess
import stat
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


VERIFIER = load_module("quickstart_bundle_verifier", ROOT / "deploy/quickstart/verify_bundle.py")
PACKAGER = load_module("quickstart_bundle_packager", ROOT / "scripts/package_deploy_bundle.py")


class QuickstartUpdateTests(unittest.TestCase):
    def fixture_bundle(self, root: Path):
        runtime = root / "runtime.txt"
        runtime.write_text("offline update\n", encoding="utf-8")
        digest = hashlib.sha256(runtime.read_bytes()).hexdigest()
        manifest = {
            "schema_version": 1,
            "bundle_id": "star-office-ui-test-2",
            "project_version": "6.0.1",
            "python": "3.11",
            "offline_wheelhouse": False,
            "offline_docker_image": None,
            "runtime": "test",
            "files": [{"path": "runtime.txt", "sha256": digest, "bytes": runtime.stat().st_size}],
        }
        manifest_path = root / "bundle-manifest.json"
        manifest_path.write_text(json.dumps(manifest) + "\n", encoding="utf-8")
        manifest_digest = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
        (root / "SHA256SUMS").write_text(
            f"{digest}  runtime.txt\n{manifest_digest}  bundle-manifest.json\n",
            encoding="utf-8",
        )

    def test_verifier_accepts_complete_bundle(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.fixture_bundle(root)
            manifest = VERIFIER.verify(root)
            self.assertEqual(manifest["project_version"], "6.0.1")

    def test_verifier_rejects_unlisted_member(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.fixture_bundle(root)
            (root / "unexpected.txt").write_text("tamper\n", encoding="utf-8")
            with self.assertRaises(VERIFIER.BundleError):
                VERIFIER.verify(root)

    def test_verifier_rejects_symlink_member(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.fixture_bundle(root)
            target = root / "runtime.txt"
            link = root / "linked-runtime.txt"
            try:
                link.symlink_to(target)
            except OSError as error:
                self.skipTest(f"symlink unavailable: {error}")
            with self.assertRaises(VERIFIER.BundleError):
                VERIFIER.verify(root)

    def test_verifier_rejects_unsafe_project_version(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.fixture_bundle(root)
            manifest_path = root / "bundle-manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["project_version"] = "6.0.1\nmalicious"
            manifest_path.write_text(json.dumps(manifest) + "\n", encoding="utf-8")
            with self.assertRaises(VERIFIER.BundleError):
                VERIFIER.verify(root)

    def test_package_contains_update_tools(self):
        self.assertIn("update.sh", PACKAGER.QUICKSTART_FILES)
        self.assertIn("verify_bundle.py", PACKAGER.QUICKSTART_FILES)

    def test_update_script_is_explicitly_offline_and_backs_up_state(self):
        script = (ROOT / "deploy/quickstart/update.sh").read_text(encoding="utf-8")
        self.assertIn("--offline", script)
        self.assertIn("update-backups", script)
        self.assertIn("SHA256SUMS", script)
        self.assertIn("mktemp -d", script)
        self.assertIn("STAR_OFFICE_VERSION", script)
        self.assertIn("--health-only", (ROOT / "deploy/quickstart/verify.sh").read_text(encoding="utf-8"))
        self.assertNotIn("SUB2API_FLAG[@]", script)
        self.assertNotIn("docker pull", script)
        self.assertNotIn("git pull", script)

    def test_updater_fixture_reads_legacy_env_and_writes_atomic_backup(self):
        with tempfile.TemporaryDirectory(prefix="quickstart-update-") as temp:
            base = Path(temp)
            bundle = base / "bundle"
            install = base / "install"
            quickstart = bundle / "deploy/quickstart"
            quickstart.mkdir(parents=True)
            for name in ("update.sh", "verify_bundle.py"):
                target = quickstart / name
                target.write_bytes((ROOT / "deploy/quickstart" / name).read_bytes())
                target.chmod(0o755)
            python = shlex.quote(sys.executable)
            (quickstart / "install.sh").write_text(
                f"""#!/usr/bin/env bash
set -euo pipefail
install_dir=""
while (($#)); do
  case "$1" in
    --install-dir) install_dir="$2"; shift 2 ;;
    *) shift ;;
  esac
done
{python} - "$install_dir/install-state.json" <<'PY'
import json, sys
from pathlib import Path
path = Path(sys.argv[1])
path.write_text(json.dumps({{"schema_version": 1, "bundle_id": "star-office-ui-test-2", "project_version": "6.0.1", "engine": "native", "source_root": "{bundle}"}}) + "\\n")
path.chmod(0o600)
PY
""",
                encoding="utf-8",
            )
            (quickstart / "install.sh").chmod(0o755)
            (quickstart / "verify.sh").write_text("#!/usr/bin/env bash\nexit 0\n", encoding="utf-8")
            (quickstart / "verify.sh").chmod(0o755)
            (bundle / "VERSION").write_text("6.0.1\n", encoding="utf-8")
            wheelhouse = bundle / "wheelhouse"
            wheelhouse.mkdir()
            (wheelhouse / "fixture.whl").write_bytes(b"fixture wheel")
            manifest = {
                "schema_version": 1,
                "bundle_id": "star-office-ui-test-2",
                "project_version": "6.0.1",
                "offline_wheelhouse": True,
                "offline_docker_image": None,
                "files": [],
            }
            for path in sorted(bundle.rglob("*")):
                if path.is_file() and path.name not in {"bundle-manifest.json", "SHA256SUMS"}:
                    manifest["files"].append({
                        "path": path.relative_to(bundle).as_posix(),
                        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                        "bytes": path.stat().st_size,
                    })
            manifest_path = bundle / "bundle-manifest.json"
            manifest_path.write_text(json.dumps(manifest) + "\n", encoding="utf-8")
            (bundle / "SHA256SUMS").write_text(
                "".join(
                    f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.relative_to(bundle).as_posix()}\n"
                    for path in sorted(bundle.rglob("*"))
                    if path.is_file() and path.name != "SHA256SUMS"
                ),
                encoding="utf-8",
            )
            install.mkdir()
            env = install / ".env"
            env.write_text(
                "STAR_OFFICE_ENGINE=native\n"
                "STAR_OFFICE_BUNDLE_ID=old-bundle\n"
                "STAR_OFFICE_VERSION=6.0.0\n"
                "STAR_OFFICE_SOURCE_ROOT=/tmp/old\n"
                "STAR_OFFICE_PORT=19000\n"
                "STAR_OFFICE_BIND=127.0.0.1\n",
                encoding="utf-8",
            )
            env.chmod(0o600)
            result = subprocess.run(
                [str(quickstart / "update.sh"), "--offline", "--native", "--install-dir", str(install)],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            backups = list((install / "update-backups").iterdir())
            self.assertEqual(len(backups), 1)
            metadata = json.loads((backups[0] / "update.json").read_text(encoding="utf-8"))
            self.assertEqual(metadata["previous_project_version"], "6.0.0")
            self.assertEqual(metadata["target_project_version"], "6.0.1")
            self.assertEqual(json.loads((install / "install-state.json").read_text())["project_version"], "6.0.1")

    def test_install_state_permissions_are_private_in_fixture(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "install-state.json"
            path.write_text("{}\n", encoding="utf-8")
            path.chmod(0o600)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)


if __name__ == "__main__":
    unittest.main()
