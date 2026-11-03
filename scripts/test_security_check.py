"""Exact synthetic-token exceptions must never hide other secret findings."""
import contextlib
import hashlib
import io
import os
from pathlib import Path
import re
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts import security_check as checker


class SecurityCheckTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.relative = next(iter(checker.REVIEWED_TEST_TOKEN_SHA256))
        cls.source = (checker.ROOT / cls.relative).read_text(encoding="utf-8")
        cls.tokens = [token for token in re.findall(r"sk-[A-Za-z0-9_-]+", cls.source)
                      if re.match(r"sk-[A-Za-z0-9]{16,}", token)]

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.root_patch = patch.object(checker, "ROOT", self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)

    def write(self, relative, text):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def test_reviewed_upstream_test_constants_are_exact_hash_matches(self):
        self.assertEqual(len(self.tokens), 2)
        hashes = {hashlib.sha256(t.encode()).hexdigest() for t in self.tokens}
        self.assertEqual(hashes, checker.REVIEWED_TEST_TOKEN_SHA256[self.relative])
        self.assertEqual(checker.file_has_secret_pattern(self.write(self.relative, self.source)), [])

    def test_same_constants_in_another_file_are_not_exempt(self):
        for token in self.tokens:
            with self.subTest(fingerprint=hashlib.sha256(token.encode()).hexdigest()):
                path = self.write("other.patch", token)
                self.assertEqual(checker.file_has_secret_pattern(path), ["Generic sk-* token"])

    def test_new_token_in_reviewed_file_is_still_detected(self):
        # Build synthetic strings at runtime, never place key-like literals in Git.
        unknown = "sk-" + "9" * 24
        for text in (self.source + "\n" + unknown, unknown + "\n" + self.source):
            path = self.write(self.relative, text)
            self.assertEqual(checker.file_has_secret_pattern(path), ["Generic sk-* token"])

    def test_approved_prefix_with_a_changed_suffix_is_not_exempt(self):
        for token in self.tokens:
            for suffix in ("A", "-extra", "_extra"):
                with self.subTest(suffix=suffix):
                    path = self.write(self.relative, token + suffix)
                    self.assertEqual(checker.file_has_secret_pattern(path), ["Generic sk-* token"])

    def test_other_secret_types_in_reviewed_file_are_still_detected(self):
        path = self.write(self.relative, self.source + "\nAIza" + "a" * 24 + "\nAKIA" + "0" * 16)
        self.assertEqual(checker.file_has_secret_pattern(path),
                         ["Google/Gemini API key-like token", "AWS access key-like token"])

    def test_failure_output_never_prints_the_detected_value(self):
        token = "sk-" + "7" * 24
        self.write(self.relative, self.source + "\n" + token)
        output = io.StringIO()
        with patch.object(checker, "tracked_files", return_value=[self.relative]), \
                patch.dict(os.environ, {}, clear=True), contextlib.redirect_stdout(output):
            self.assertEqual(checker.main(), 1)
        self.assertIn("Result: FAILED", output.getvalue())
        for value in [token, *self.tokens]:
            self.assertNotIn(value, output.getvalue())


if __name__ == "__main__":
    unittest.main()
