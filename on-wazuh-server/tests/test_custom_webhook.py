import unittest
import requests
import json
import time
from unittest.mock import patch, Mock
import sys
import os

# Add parent directory to path so we can import custom-webhook
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import importlib
custom_webhook = importlib.import_module("custom-webhook")


class TestCustomWebhook(unittest.TestCase):
    def setUp(self):
        self.fixture = {
            "id": "fixture-1",
            "rule": {"level": 7, "id": "100001", "description": "Fixture"},
            "agent": {"id": "001", "name": "agent-1"},
            "timestamp": "2026-08-02T00:00:00Z"
        }
        self.expected_signature = "sha256=4337c174eafb19079a75b03a299b45153aa325f5afd1f1edf9def04f0e6d5e97"

        # Track requests made
        self.request_count = 0

    def test_signature_matches_shared_vector(self):
        body = custom_webhook.serialize_alert(self.fixture)
        self.assertEqual(custom_webhook.create_signature(b"test-secret", body), self.expected_signature)

    def send_with_statuses(self, statuses, exceptions=None):
        self.request_count = 0

        def mock_post(*args, **kwargs):
            self.request_count += 1
            if exceptions and self.request_count <= len(exceptions) and exceptions[self.request_count-1]:
                raise exceptions[self.request_count-1]

            status = statuses[self.request_count-1] if self.request_count <= len(statuses) else statuses[-1]
            mock_resp = Mock()
            mock_resp.status_code = status
            mock_resp.headers = {}
            return mock_resp

        with patch('requests.post', side_effect=mock_post), \
             patch('time.sleep', return_value=None):  # Don't actually sleep in tests
            body = custom_webhook.serialize_alert(self.fixture)
            return custom_webhook.send_alert("http://dummy", b"secret", body)

    def test_does_not_retry_422(self):
        response = self.send_with_statuses([422, 202])
        self.assertEqual(response, 422)
        self.assertEqual(self.request_count, 1)

    def test_retries_5xx_and_succeeds(self):
        response = self.send_with_statuses([502, 503, 202])
        self.assertEqual(response, 202)
        self.assertEqual(self.request_count, 3)

    def test_retries_429_and_succeeds(self):
        response = self.send_with_statuses([429, 202])
        self.assertEqual(response, 202)
        self.assertEqual(self.request_count, 2)

    def test_exhausts_retries_on_5xx(self):
        response = self.send_with_statuses([500, 500, 500, 500])
        self.assertEqual(response, 500)
        self.assertEqual(self.request_count, 4)

    def test_retries_connection_error(self):
        response = self.send_with_statuses(
            [None, 202],
            exceptions=[requests.ConnectionError("conn reset"), None]
        )
        self.assertEqual(response, 202)
        self.assertEqual(self.request_count, 2)

    def test_retries_timeout(self):
        response = self.send_with_statuses(
            [None, 202],
            exceptions=[requests.Timeout("read timeout"), None]
        )
        self.assertEqual(response, 202)
        self.assertEqual(self.request_count, 2)

    def test_exhausts_retries_on_connection_error(self):
        with self.assertRaises(requests.ConnectionError):
            self.send_with_statuses(
                [None, None, None, None],
                exceptions=[requests.ConnectionError("conn reset")] * 4
            )
        self.assertEqual(self.request_count, 4)

    def test_retry_delay_respects_header(self):
        mock_resp = Mock()
        mock_resp.headers = {"Retry-After": "5"}
        self.assertEqual(custom_webhook.retry_delay(mock_resp, 0), 5)

    def test_retry_delay_bounds_header(self):
        mock_resp = Mock()
        mock_resp.headers = {"Retry-After": "3600"}
        # Should be bounded by MAX_BACKOFF_SECONDS (60)
        self.assertEqual(custom_webhook.retry_delay(mock_resp, 0), 60)

    def test_retry_delay_exponential_fallback(self):
        mock_resp = Mock()
        mock_resp.headers = {}
        self.assertEqual(custom_webhook.retry_delay(mock_resp, 0), 1)  # 2^0
        self.assertEqual(custom_webhook.retry_delay(mock_resp, 1), 2)  # 2^1
        self.assertEqual(custom_webhook.retry_delay(mock_resp, 2), 4)  # 2^2

if __name__ == '__main__':
    unittest.main()
