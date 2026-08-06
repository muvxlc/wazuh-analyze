# Wazuh Manager -> Alert Dashboard

คู่มือนี้ตั้งค่าส่ง Wazuh alerts จาก Wazuh Manager ไปยัง Next.js dashboard ที่อยู่คนละเครื่อง

## Architecture

```text
Wazuh Manager
  -> /var/ossec/integrations/custom-analyze
  -> HTTP POST /api/integrations/wazuh/alerts
  -> Dashboard API verifies HMAC
  -> PostgreSQL
  -> Dashboard /alerts polls /api/alerts
```

`<hook_url>local</hook_url>` หมายถึงให้ Wazuh เรียก integration script ในเครื่อง Wazuh Manager เอง ไม่ใช่ URL ของ dashboard. URL network อยู่ใน `WAZUH_WEBHOOK_URL`.

> **ชื่อ integration ในเครื่องจริง:** ไฟล์ใน repository ชื่อ `custom-webhook` และ `custom-webhook.py` แต่ deploy ลง Wazuh Manager ใช้ชื่อ `custom-analyze`, `custom-analyze.py` และ `custom-analyze.env` ทุกจุด. Wazuh ใช้ชื่อไฟล์ wrapper ต่อ `.py` เพื่อหา Python script.

## Prerequisites

ต้องมี:

- Wazuh Manager เข้าถึง dashboard IP และ port ได้
- Dashboard รันและรับ traffic จาก network ได้
- Dashboard กับ Wazuh ใช้ HMAC secret เดียวกัน
- PostgreSQL ของ dashboard พร้อมใช้งาน

ตัวอย่างค่าที่ใช้ในคู่มือนี้:

```text
Dashboard IP: 192.168.100.107
Dashboard port: 3456
Wazuh Manager IP: 172.16.32.5
```

เปลี่ยนค่าให้ตรง environment จริง

## 0. Choose correct database

`compose.test.yml` is disposable and uses `tmpfs`; integration tests truncate it. Never use it for local development or production.

For persistent local development:

```bash
docker compose -f compose.dev.yml up -d
DATABASE_URL=postgresql://postgres:postgres@localhost:55433/wazuh_dashboard_dev npm run db:migrate
DATABASE_URL=postgresql://postgres:postgres@localhost:55433/wazuh_dashboard_dev node scripts/seed-admin.cjs admin@example.com 'change-this-password'
```

Run seed only when user is absent. Do not run `docker compose ... --force-recreate` on this service unless intentionally deleting its named volume.

## 1. Historical alert resync

Full operator guide: [`docs/resync-alerts.md`](resync-alerts.md).

Live alerts use `custom-analyze`. Historical recovery uses `resync-archive.py` on Wazuh Manager and sends through the same signed endpoint. Source must be a JSONL archive file with one Wazuh alert object per line. Enable Wazuh alert JSON logging first and confirm the real path. This deployment uses `/var/ossec/logs/alerts/alerts.json`. Generic `/var/ossec/logs/archives/archives.json` contains events without guaranteed `rule` fields and is not accepted by the current resync script.

Install:

```bash
sudo cp on-wazuh-server/resync-archive.py /var/ossec/integrations/
sudo chown root:wazuh /var/ossec/integrations/resync-archive.py
sudo chmod 750 /var/ossec/integrations/resync-archive.py
```

Configure the same destination and HMAC secret as `custom-analyze.env`, then validate without sending:

```bash
sudo -u wazuh env $(sudo cat /var/ossec/integrations/custom-analyze.env | grep -v '^#' | xargs) \\
  /var/ossec/framework/python/bin/python3 /var/ossec/integrations/resync-archive.py \\
  --dry-run /var/ossec/logs/alerts/alerts.json
```

Run a resync:

```bash
sudo -u wazuh env $(sudo cat /var/ossec/integrations/custom-analyze.env | grep -v '^#' | xargs) \\
  /var/ossec/framework/python/bin/python3 /var/ossec/integrations/resync-archive.py \\
  /var/ossec/logs/alerts/alerts.json
```

The script supports `.gz`, skips malformed lines, retries network/429/5xx errors, and reports `sent`, `duplicate`, `invalid`, and `failed`. HTTP `409` is counted as `duplicate` and success. Re-running the same file is safe because dashboard unique constraints deduplicate it. A duplicate of an alert already resolved never changes its status or workflow timeline. Use `--from-line N` to resume after a known interruption; do not delete source archives.

The shell `env $(cat ... | xargs)` form is convenient for manual use only. For production, load the env through a protected systemd/cron service environment without printing secrets.

## 2. Configure Dashboard

สร้างหรือแก้ `.env.local` บนเครื่อง dashboard:

```env
NODE_ENV=development
DATABASE_URL=postgresql://postgres:postgres@localhost:55433/wazuh_dashboard_dev
APP_URL=http://192.168.100.107:3456
SESSION_SECRET=เปลี่ยนเป็น-random-secret-อย่างน้อย-32-ตัวอักษร
WEBHOOK_HMAC_SECRET=เปลี่ยนเป็น-secret-เดียวกับ-Wazuh-อย่างน้อย-32-ตัวอักษร
WEBHOOK_MAX_BODY_BYTES=1048576
WEBHOOK_REPLAY_WINDOW_SECONDS=300

WAZUH_API_URL=https://172.16.32.5:55000
WAZUH_USERNAME=manager-api
WAZUH_PASSWORD=รหัสผ่าน-Wazuh-API
WAZUH_ALLOW_INSECURE_TLS=true
```

`WAZUH_ALLOW_INSECURE_TLS=true` ใช้เฉพาะ development/test ที่ Wazuh ใช้ self-signed certificate. Production ควรติดตั้ง CA แล้วใช้:

```env
WAZUH_CA_PATH=/path/to/wazuh-ca.pem
WAZUH_ALLOW_INSECURE_TLS=false
```

รัน dashboard ให้รับ connection จากเครื่องอื่น:

```bash
npm run build
npm run start -- --hostname 0.0.0.0 --port 3456
```

สำหรับ development:

```bash
npm run dev -- --hostname 0.0.0.0 --port 3456
```

ตรวจ dashboard จากเครื่อง Wazuh:

```bash
curl -i http://192.168.100.107:3456/api/health/live
```

ผลที่คาดหวัง:

```text
HTTP/1.1 200 OK
{"status":"ok"}
```

เปิด firewall เฉพาะ Wazuh Manager:

```bash
sudo ufw allow from 172.16.32.5 to any port 3456 proto tcp
```

## 2. Install Integration on Wazuh Manager

รันบนเครื่อง Wazuh Manager:

```bash
sudo cp on-wazuh-server/custom-webhook /var/ossec/integrations/custom-analyze
sudo cp on-wazuh-server/custom-webhook.py /var/ossec/integrations/custom-analyze.py
```

ถ้า source files อยู่เครื่องอื่น ให้ copy ด้วย `scp` ก่อน:

```bash
scp on-wazuh-server/custom-webhook root@172.16.32.5:/var/ossec/integrations/custom-analyze
scp on-wazuh-server/custom-webhook.py root@172.16.32.5:/var/ossec/integrations/custom-analyze.py
```

ตั้ง permission:

```bash
sudo chown root:wazuh /var/ossec/integrations/custom-analyze
sudo chown root:wazuh /var/ossec/integrations/custom-analyze.py
sudo chmod 750 /var/ossec/integrations/custom-analyze
sudo chmod 750 /var/ossec/integrations/custom-analyze.py
```

## 3. Configure Webhook Environment on Wazuh

สร้างไฟล์ secret บน Wazuh Manager:

```bash
sudo touch /var/ossec/integrations/custom-analyze.env
sudo chown root:wazuh /var/ossec/integrations/custom-analyze.env
sudo chmod 640 /var/ossec/integrations/custom-analyze.env
sudo vi /var/ossec/integrations/custom-analyze.env
```

ใส่ค่า:

```env
WAZUH_WEBHOOK_URL=http://192.168.100.107:3456/api/integrations/wazuh/alerts
WAZUH_WEBHOOK_SECRET=เปลี่ยนเป็นค่าเดียวกับ-WEBHOOK_HMAC_SECRET
WAZUH_WEBHOOK_CONNECT_TIMEOUT=3
WAZUH_WEBHOOK_READ_TIMEOUT=10
WAZUH_WEBHOOK_MAX_ATTEMPTS=4
WAZUH_WEBHOOK_MAX_BACKOFF=60
```

ห้ามใช้ `localhost` ใน `WAZUH_WEBHOOK_URL` เพราะ `localhost` จาก Wazuh หมายถึงเครื่อง Wazuh เอง ไม่ใช่ dashboard.

`custom-webhook.py` (บน host ต้นทาง) ใช้ `os.environ` และไม่อ่านไฟล์ `.env` เอง. ดังนั้นต้องแก้ **บนเครื่อง Wazuh Manager** ไม่ใช่เครื่อง dashboard:

- `/var/ossec/integrations/custom-analyze` คือ wrapper ที่ Wazuh เรียก
- `/var/ossec/integrations/custom-analyze.py` คือ Python script เดิม ไม่ต้องแก้ส่วนโหลด env
- `/var/ossec/integrations/custom-analyze.env` คือไฟล์ค่าลับฝั่ง Wazuh

แก้ wrapper:

```bash
sudo nano /var/ossec/integrations/custom-analyze
```

เพิ่ม block โหลด environment หลัง `#!/bin/sh` แล้วคง Wazuh bundled Python wrapper เดิมไว้:

```sh
#!/bin/sh

set -a
. /var/ossec/integrations/custom-analyze.env
set +a

WPYTHON_BIN="framework/python/bin/python3"

SCRIPT_PATH_NAME="$0"

DIR_NAME="$(cd "$(dirname "${SCRIPT_PATH_NAME}")" && pwd -P)"
SCRIPT_NAME="$(basename "${SCRIPT_PATH_NAME}")"

case "${DIR_NAME}" in
    */active-response/bin | */wodles*)
        if [ -z "${WAZUH_PATH}" ]; then
            WAZUH_PATH="$(cd "${DIR_NAME}/../.." && pwd)"
        fi

        PYTHON_SCRIPT="${DIR_NAME}/${SCRIPT_NAME}.py"
    ;;
    */bin)
        if [ -z "${WAZUH_PATH}" ]; then
            WAZUH_PATH="$(cd "${DIR_NAME}/.." && pwd)"
        fi

        PYTHON_SCRIPT="${WAZUH_PATH}/framework/scripts/${SCRIPT_NAME}.py"
    ;;
    */integrations)
        if [ -z "${WAZUH_PATH}" ]; then
            WAZUH_PATH="$(cd "${DIR_NAME}/.." && pwd)"
        fi

        PYTHON_SCRIPT="${DIR_NAME}/${SCRIPT_NAME}.py"
    ;;
esac

exec "${WAZUH_PATH}/${WPYTHON_BIN}" "${PYTHON_SCRIPT}" "$@"
```

ห้ามเปลี่ยนบรรทัดสุดท้ายเป็น `/usr/bin/env python3` เพราะ Wazuh wrapper ต้องใช้ Python bundled ที่ `/var/ossec/framework/python/bin/python3`.

ความหมายของ wrapper:

1. `set -a` export ตัวแปรทุกตัวที่โหลดจาก env file
2. `. /var/ossec/integrations/custom-analyze.env` โหลด URL และ secret
3. `set +a` หยุด export ตัวแปรใหม่อัตโนมัติ
4. `exec ... custom-analyze.py "$@"` เรียก Python พร้อมส่ง path alert เดิมต่อไป

โครงสร้างไฟล์สุดท้ายบน Wazuh Manager:

```text
/var/ossec/integrations/
├── custom-analyze       # wrapper ที่แก้ให้โหลด env
├── custom-analyze.py    # Python script เดิม
└── custom-analyze.env   # URL และ secret ฝั่ง Wazuh
```

ตรวจ wrapper และ env ก่อน restart:

```bash
sudo sed -n '1,20p' /var/ossec/integrations/custom-analyze
sudo sh -c '
set -a
. /var/ossec/integrations/custom-analyze.env
set +a
printf "URL=%s\\n" "$WAZUH_WEBHOOK_URL"
printf "SECRET configured: "
test -n "$WAZUH_WEBHOOK_SECRET" && echo yes || echo no
'
```

ควรเห็น `URL=...` และ `SECRET configured: yes`. ห้ามพิมพ์ค่า secret จริงลง log หรือส่งมาใน issue/chat.

ตั้ง permission อีกครั้ง:

```bash
sudo chown root:wazuh /var/ossec/integrations/custom-analyze
sudo chmod 750 /var/ossec/integrations/custom-analyze
sudo chmod 640 /var/ossec/integrations/custom-analyze.env
```

ทดสอบ wrapper ด้วย test alert:

```bash
sudo -u wazuh /var/ossec/integrations/custom-analyze /path/to/test-alert.json
```

ถ้าได้ `Alert successfully sent to dashboard webhook` แปลว่า wrapper โหลด env และส่งต่อไป dashboard สำเร็จ.

## 4. Configure Wazuh Integration

แก้ `/var/ossec/etc/ossec.conf` บน Wazuh Manager เพิ่ม block นี้:

```xml
<integration>
  <name>custom-analyze</name>
  <hook_url>local</hook_url>
  <level>3</level>
  <alert_format>json</alert_format>
</integration>
```

ความหมาย:

- `hook_url=local`: เรียก script ในเครื่อง Wazuh
- `level=3`: ส่ง alert level 3 ขึ้นไป
- `alert_format=json`: ส่ง JSON alert file ให้ script

ตรวจ config แล้ว restart:

```bash
sudo /var/ossec/bin/wazuh-control check-config
sudo systemctl restart wazuh-manager
sudo systemctl status wazuh-manager --no-pager
```

## 5. Test Network

จาก Wazuh Manager:

```bash
curl -i http://192.168.100.107:3456/api/health/live
```

ถ้าใช้ HTTPS:

```bash
curl -k -i https://dashboard.example.com/api/health/live
```

ถ้าเชื่อมไม่ได้ ตรวจ:

```bash
nc -vz 192.168.100.107 3456
```

ตรวจ firewall, route, bind address (`0.0.0.0`) และ reverse proxy

## 6. Test Webhook Manually

สร้าง test alert บน Wazuh Manager:

```bash
cat >/tmp/wazuh-test-alert.json <<'JSON'
{"timestamp":"2026-08-04T12:00:00Z","rule":{"id":"100001","level":10,"description":"Manual webhook test"},"agent":{"id":"001","name":"mac-office2","ip":"192.168.100.107"}}
JSON
```

เรียก script ผ่าน wrapper:

```bash
sudo -u wazuh /var/ossec/integrations/custom-analyze /tmp/wazuh-test-alert.json
```

ผลสำเร็จ:

```text
Alert successfully sent to dashboard webhook
```

ถ้า script คืน status อื่น ตรวจ log:

```bash
sudo tail -f /var/ossec/logs/integrations.log
sudo journalctl -u wazuh-manager -f
```

## 7. Verify Dashboard

Login dashboard แล้วเปิด:

```text
http://192.168.100.107:3456/alerts
```

หรือใช้ API หลัง login:

```bash
curl -b cookies.txt http://192.168.100.107:3456/api/alerts
```

หน้า agents ตรวจสถานะ Wazuh:

```text
http://192.168.100.107:3456/agents
```

## Deployment Confirmation

เมื่อ alert แสดงใน dashboard แล้ว แปลว่า flow นี้ทำงานครบ:

```text
Wazuh Manager -> custom-analyze -> HMAC webhook -> Dashboard API -> PostgreSQL -> /alerts
```

ชื่อ integration ที่ติดตั้งใน `ossec.conf` ควรเปน `custom-analyze` ตรงกัย wrapper ที่ deploy:

```xml
<integration>
  <name>custom-analyze</name>
  <hook_url>local</hook_url>
  <level>3</level>
  <alert_format>json</alert_format>
</integration>
```

## Troubleshooting

### `curl` จาก Wazuh ไป dashboard ไม่ได้

ตรวจ dashboard bind และ firewall:

```bash
sudo lsof -nP -iTCP:3456 -sTCP:LISTEN
sudo ufw status
nc -vz <dashboard-ip> 3456
```

### ได้ `401 invalid_signature`

`WAZUH_WEBHOOK_SECRET` กับ `WEBHOOK_HMAC_SECRET` ไม่ตรงกัน หรือ wrapper ไม่ได้โหลด env:

```bash
sudo sh -c '. /var/ossec/integrations/custom-analyze.env; test -n "$WAZUH_WEBHOOK_SECRET" && echo configured'
```

### ได้ `401 timestamp_expired`

เวลาเครื่อง Wazuh และ dashboard ต่างกัน:

```bash
date -u
sudo timedatectl status
```

เปิด NTP แล้วให้เวลาตรงกัน

### ได้ `409 replay_rejected` หรือ duplicate

ส่ง payload เดิมซ้ำ. ใช้ alert ใหม่หรือรอไม่เกี่ยว; replay protection ทำงานตามปกติ

### Dashboard แสดง `Wazuh: not connected`

ตรวจ dashboard เชื่อม Wazuh API:

```bash
curl -k -u 'manager-api:<password>' \
  -X POST 'https://<wazuh-ip>:55000/security/user/authenticate?raw=true'
```

ตรวจ `WAZUH_API_URL`, `WAZUH_USERNAME`, `WAZUH_PASSWORD`, TLS/CA และ firewall port `55000`

### Dashboard แสดง `No agents`

Wazuh API เชื่อมได้แต่ไม่มี agent registered. ตรวจ:

```bash
curl -k -u 'manager-api:<password>' \
  -X POST 'https://<wazuh-ip>:55000/security/user/authenticate?raw=true'
```

จากนั้นใช้ token เรียก `/agents?limit=500&offset=0`

## AI Chat Setup

Configure `/chat` providers (Agnes default, OpenAI-compatible, LM Studio) and
the required `SETTINGS_ENCRYPTION_KEY` in [`docs/ai-connections.md`](ai-connections.md).

## Security Rules

- ใช้ HTTPS สำหรับ production dashboard webhook
- ใช้ secret สุ่มยาวอย่างน้อย 32 ตัวอักษร
- ห้าม commit `.env`, `.env.local` หรือ `custom-analyze.env`
- จำกัด firewall ให้รับ webhook จาก Wazuh Manager เท่านั้น
- ห้ามใช้ `WAZUH_ALLOW_INSECURE_TLS=true` ใน production
- ห้ามใส่ credentials ใน `ossec.conf`, source code หรือ command history
