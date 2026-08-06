#!/usr/bin/env python3
"""Replay Wazuh JSONL archive alerts through signed dashboard webhook."""

import argparse
import gzip
import hashlib
import hmac
import json
import os
import sys
import time
from typing import Iterator

import requests

MAX_ATTEMPTS = int(os.environ.get("WAZUH_WEBHOOK_MAX_ATTEMPTS", "4"))
CONNECT_TIMEOUT = int(os.environ.get("WAZUH_WEBHOOK_CONNECT_TIMEOUT", "3"))
READ_TIMEOUT = int(os.environ.get("WAZUH_WEBHOOK_READ_TIMEOUT", "10"))
MAX_BACKOFF = int(os.environ.get("WAZUH_WEBHOOK_MAX_BACKOFF", "60"))


def serialize_alert(alert: dict) -> bytes:
    return json.dumps(alert, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def signature(secret: bytes, timestamp: str, body: bytes) -> str:
    canonical = timestamp.encode("ascii") + b"." + body
    return "sha256=" + hmac.new(secret, canonical, hashlib.sha256).hexdigest()


def retry_delay(response: requests.Response, attempt: int) -> float:
    try:
        return min(int(response.headers.get("Retry-After", "")), MAX_BACKOFF)
    except (TypeError, ValueError):
        return min(2 ** attempt, MAX_BACKOFF)


def post_alert(endpoint: str, secret: bytes, body: bytes) -> int:
    for attempt in range(MAX_ATTEMPTS):
        timestamp = str(int(time.time()))
        headers = {
            "content-type": "application/json",
            "x-wazuh-timestamp": timestamp,
            "x-wazuh-signature": signature(secret, timestamp, body),
        }
        try:
            response = requests.post(endpoint, data=body, headers=headers, timeout=(CONNECT_TIMEOUT, READ_TIMEOUT))
        except (requests.ConnectionError, requests.Timeout):
            if attempt + 1 == MAX_ATTEMPTS:
                raise
            time.sleep(min(2 ** attempt, MAX_BACKOFF))
            continue
        if response.status_code == 429 or response.status_code >= 500:
            if attempt + 1 < MAX_ATTEMPTS:
                time.sleep(retry_delay(response, attempt))
                continue
        return response.status_code
    raise RuntimeError("unreachable retry state")


def read_alerts(path: str, on_invalid=None) -> Iterator[tuple[int, dict]]:
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8") as source:
        for line_number, line in enumerate(source, 1):
            if not line.strip():
                continue
            try:
                value = json.loads(line)
            except json.JSONDecodeError as error:
                print(f"line {line_number}: invalid JSON: {error.msg}", file=sys.stderr)
                if on_invalid:
                    on_invalid()
                continue
            if not isinstance(value, dict):
                print(f"line {line_number}: expected JSON object", file=sys.stderr)
                if on_invalid:
                    on_invalid()
                continue
            yield line_number, value


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", help="Wazuh JSONL archive file, optionally .gz")
    parser.add_argument("--from-line", type=int, default=1, help="first 1-based line to send")
    parser.add_argument("--dry-run", action="store_true", help="validate and count without sending")
    args = parser.parse_args()

    endpoint = os.environ.get("WAZUH_WEBHOOK_URL")
    secret_value = os.environ.get("WAZUH_WEBHOOK_SECRET")
    if not endpoint or not secret_value:
        print("Missing WAZUH_WEBHOOK_URL or WAZUH_WEBHOOK_SECRET", file=sys.stderr)
        return 2
    if args.from_line < 1:
        print("--from-line must be positive", file=sys.stderr)
        return 2

    counts = {"sent": 0, "duplicate": 0, "invalid": 0, "failed": 0}
    try:
        for line_number, alert in read_alerts(args.archive, lambda: counts.__setitem__("invalid", counts["invalid"] + 1)):
            if line_number < args.from_line:
                continue
            body = serialize_alert(alert)
            if args.dry_run:
                counts["sent"] += 1
                continue
            try:
                status = post_alert(endpoint, secret_value.encode("utf-8"), body)
            except Exception as error:
                counts["failed"] += 1
                print(f"line {line_number}: delivery failed: {error}", file=sys.stderr)
                continue
            if status in (200, 202):
                counts["sent"] += 1
            elif status == 409:
                counts["duplicate"] += 1
            else:
                counts["failed"] += 1
                print(f"line {line_number}: dashboard returned HTTP {status}", file=sys.stderr)
    except (OSError, ValueError) as error:
        print(f"archive read failed: {error}", file=sys.stderr)
        return 1

    print("resync: " + ", ".join(f"{key}={value}" for key, value in counts.items()))
    return 1 if counts["failed"] or counts["invalid"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
