#!/bin/bash
# สร้างข้อมูลจำลอง High Severity (level 12 ขึ้นไปเพื่อ trigger แจ้งเตือน + AI)
# รันไฟล์นี้หลังจากตั้งค่า HMAC Secret และแก้พอร์ตถ้าจำเป็น

HMAC_SECRET="<your-webhook-hmac-secret>"
PAYLOAD='{
  "timestamp": "2026-08-07T12:00:00.000+0000",
  "rule": { "level": 12, "description": "High severity SQL injection", "id": "31103", "groups": ["web", "attack", "sql_injection"] },
  "agent": { "id": "001", "name": "webserver" },
  "manager": { "name": "wazuh-manager" },
  "id": "12345.67890",
  "data": { "srcip": "1.2.3.4" }
}'

SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$HMAC_SECRET" -binary | hex)
echo "Send curl here..."
