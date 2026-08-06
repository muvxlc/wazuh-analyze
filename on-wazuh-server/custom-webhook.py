#!/usr/bin/env python3

import os
import json
import time
import hmac
import hashlib
import requests
import sys

# Protocol Configuration
MAX_ATTEMPTS = int(os.environ.get("WAZUH_WEBHOOK_MAX_ATTEMPTS", "4"))
CONNECT_TIMEOUT_SECONDS = int(os.environ.get("WAZUH_WEBHOOK_CONNECT_TIMEOUT", "3"))
READ_TIMEOUT_SECONDS = int(os.environ.get("WAZUH_WEBHOOK_READ_TIMEOUT", "10"))
MAX_BACKOFF_SECONDS = int(os.environ.get("WAZUH_WEBHOOK_MAX_BACKOFF", "60"))

def serialize_alert(alert: dict) -> bytes:
    """Serialize alert cleanly without whitespaces to match TS backend expectations"""
    return json.dumps(alert, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

def create_signature(secret: bytes, timestamp: str, body: bytes) -> str:
    """Compute HMAC-SHA256 over timestamp and exact body bytes."""
    canonical = timestamp.encode("ascii") + b"." + body
    return "sha256=" + hmac.new(secret, canonical, hashlib.sha256).hexdigest()

def retry_delay(response: requests.Response, attempt: int) -> float:
    """Compute retry delay based on Retry-After header or exponential backoff"""
    if "Retry-After" in response.headers:
        try:
            delay = int(response.headers["Retry-After"])
            return min(delay, MAX_BACKOFF_SECONDS)
        except ValueError:
            pass
    return min(2 ** attempt, MAX_BACKOFF_SECONDS)

def send_alert(endpoint: str, secret: bytes, body: bytes) -> int:
    timestamp = str(int(time.time()))
    headers = {
        "content-type": "application/json",
        "x-wazuh-timestamp": timestamp,
        "x-wazuh-signature": create_signature(secret, timestamp, body),
    }

    for attempt in range(MAX_ATTEMPTS):
        try:
            response = requests.post(
                endpoint,
                data=body,
                headers=headers,
                timeout=(CONNECT_TIMEOUT_SECONDS, READ_TIMEOUT_SECONDS),
            )
        except (requests.ConnectionError, requests.Timeout):
            if attempt + 1 == MAX_ATTEMPTS:
                raise
            time.sleep(min(2 ** attempt, MAX_BACKOFF_SECONDS))
            continue

        if response.status_code == 429 or response.status_code >= 500:
            if attempt + 1 < MAX_ATTEMPTS:
                delay = retry_delay(response, attempt)
                time.sleep(delay)
                continue
        return response.status_code

    raise RuntimeError("unreachable retry state")

def main():
    try:
        if len(sys.argv) < 2:
            print("Usage: custom-webhook.py <alert_file>", file=sys.stderr)
            sys.exit(1)

        alert_file_path = sys.argv[1]

        endpoint = os.environ.get("WAZUH_WEBHOOK_URL")
        secret_str = os.environ.get("WAZUH_WEBHOOK_SECRET")

        if not endpoint or not secret_str:
            print("Missing WAZUH_WEBHOOK_URL or WAZUH_WEBHOOK_SECRET in environment", file=sys.stderr)
            sys.exit(1)

        secret = secret_str.encode("utf-8")

        if not os.path.exists(alert_file_path):
            print(f"File not found: {alert_file_path}", file=sys.stderr)
            sys.exit(1)

        with open(alert_file_path, 'r', encoding='utf-8') as f:
            alert_data = json.load(f)

        body = serialize_alert(alert_data)

        status = send_alert(endpoint, secret, body)

        if status in (200, 202):
            print("Alert successfully sent to dashboard webhook")
            sys.exit(0)
        else:
            print(f"Failed to send alert, terminal status code: {status}", file=sys.stderr)
            sys.exit(1)

    except Exception as e:
        print(f"Webhook error: {str(e)}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
