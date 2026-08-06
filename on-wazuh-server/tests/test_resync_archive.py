import gzip
import importlib.util
import json
import os
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPEC = importlib.util.spec_from_file_location("resync_archive", os.path.join(ROOT, "resync-archive.py"))
resync = importlib.util.module_from_spec(SPEC)
import sys
sys.modules["resync_archive"] = resync
SPEC.loader.exec_module(resync)


class TestResyncArchive(unittest.TestCase):
    def setUp(self):
        self.alert = {"id": "archive-1", "timestamp": "2026-08-04T00:00:00Z", "rule": {"id": "1", "level": 5, "description": "test"}}

    def test_reads_plain_and_gzip_jsonl_and_skips_invalid(self):
        with tempfile.TemporaryDirectory() as directory:
            plain = os.path.join(directory, "alerts.json")
            with open(plain, "w", encoding="utf-8") as output:
                output.write(json.dumps(self.alert) + "\nnot-json\n\n")
            self.assertEqual(list(resync.read_alerts(plain)), [(1, self.alert)])

            compressed = os.path.join(directory, "alerts.json.gz")
            with gzip.open(compressed, "wt", encoding="utf-8") as output:
                output.write(json.dumps(self.alert) + "\n")
            self.assertEqual(list(resync.read_alerts(compressed)), [(1, self.alert)])

    @patch.dict(os.environ, {"WAZUH_WEBHOOK_URL": "http://dashboard/alerts", "WAZUH_WEBHOOK_SECRET": "secret"})
    @patch("resync_archive.requests.post")
    def test_post_uses_fresh_timestamp_and_409_is_duplicate(self, post):
        first = Mock(status_code=202, headers={})
        second = Mock(status_code=409, headers={})
        post.side_effect = [first, second]
        body = resync.serialize_alert(self.alert)
        with patch("resync_archive.time.time", side_effect=[100, 101]):
            first_status = resync.post_alert("http://dashboard/alerts", b"secret", body)
            second_status = resync.post_alert("http://dashboard/alerts", b"secret", body)
        self.assertEqual(first_status, 202)
        self.assertEqual(second_status, 409)
        self.assertNotEqual(post.call_args_list[0].kwargs["headers"]["x-wazuh-timestamp"], post.call_args_list[1].kwargs["headers"]["x-wazuh-timestamp"])

    @patch.dict(os.environ, {"WAZUH_WEBHOOK_URL": "http://dashboard/alerts", "WAZUH_WEBHOOK_SECRET": "secret"})
    @patch("resync_archive.post_alert", return_value=409)
    def test_main_dry_run_and_duplicate(self, post):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as archive:
            archive.write(json.dumps(self.alert) + "\n")
            path = archive.name
        try:
            with patch("sys.argv", ["resync-archive.py", path]):
                self.assertEqual(resync.main(), 0)
            with patch("sys.argv", ["resync-archive.py", path, "--dry-run"]):
                self.assertEqual(resync.main(), 0)
            self.assertTrue(post.called)
        finally:
            os.unlink(path)


if __name__ == "__main__":
    unittest.main()
