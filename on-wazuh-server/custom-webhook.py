#!/usr/bin/env python3

import requests
import json
import sys
import os

def main():
    try:
        # Baca file alert yang diberikan oleh Wazuh
        alert_file_path = sys.argv[1]

        # Membaca isi file alert
        if not os.path.exists(alert_file_path):
            raise FileNotFoundError(f"File not found: {alert_file_path}")

        with open(alert_file_path, 'r') as f:
            alert_data = f.read()

        # Debug log (opsional)
        with open("/var/ossec/logs/webhook-python-debug.log", "a") as f:
            f.write("== New Alert ==\n")
            f.write(alert_data + "\n\n")

        # Parsing JSON alert
        data = json.loads(alert_data)

        # Ekstrak field penting
        alert_level = data.get('rule', {}).get('level', "N/A")
        description = data.get('rule', {}).get('description', "N/A")
        agent_name = data.get('agent', {}).get('name', "N/A")

        payload = {
            "agent": agent_name,
            "alert_level": alert_level,
            "description": description,
            "raw_alert": data  # Jika masih ingin mengirim seluruh alert juga
        }

        # Kirim ke webhook
        response = requests.post(
            "http://<ip-server-webhook>:3000/api/alerts",  # Ganti sesuai webhook kamu
            data=json.dumps(payload),
            headers={'Content-type': 'application/json'}
        )

        if response.status_code == 200:
            print("Alert sent to webhook")
        else:
            print(f"Failed to send alert: {response.status_code}, Response: {response.text}")

    except Exception as e:
        with open("/var/ossec/logs/webhook-python-error.log", "a") as f:
            f.write(f"Error: {str(e)}\n")

if __name__ == "__main__":
    main()
