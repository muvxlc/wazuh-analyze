# การใช้ Wazuh Alerts สำหรับระบบ AI Analyze

## ไฟล์ Alert หลักของ Wazuh

ไฟล์ที่ถูกต้องคือ:

```bash
/var/ossec/logs/alerts/alerts.json
```

ไฟล์นี้เก็บเฉพาะเหตุการณ์ที่ผ่าน Decoder และ Rule ของ Wazuh แล้วถูกสร้างเป็น Security Alert

ดังนั้น `alerts.json` เป็นแหล่งข้อมูลที่เหมาะสำหรับใช้เป็นตัวกระตุ้นให้ AI วิเคราะห์แบบ Real-time แต่ไม่ได้ครอบคลุมข้อมูลสถานะทั้งหมดภายใน Wazuh

---

## `alerts.json` ครอบคลุมอะไรบ้าง

ข้อมูลต่อไปนี้สามารถพบได้ใน `alerts.json` เมื่อมี Rule สร้าง Alert

- Authentication Failure
- Brute-force Attack
- Malware Detection
- File Integrity Monitoring
- Suspicious Process
- Privilege Escalation
- Rootkit Detection
- Configuration Assessment ที่มีการเปลี่ยนสถานะ
- Vulnerability ที่ตรวจพบใหม่หรือได้รับการแก้ไข
- MITRE ATT&CK Mapping
- PCI DSS Mapping
- GDPR Mapping
- HIPAA Mapping
- NIST 800-53 Mapping
- TSC Mapping
- Cloud Security Events
- Network และ Endpoint Security Alerts

---

## ความครอบคลุมของแต่ละฟังก์ชัน

| ฟังก์ชัน Wazuh | อยู่ใน `alerts.json` | หมายเหตุ |
|---|---:|---|
| Configuration Assessment | บางส่วน | มี Alert เมื่อผลตรวจเปลี่ยน |
| Malware Detection | มี | เฉพาะ Malware ที่ถูกตรวจพบและเข้า Rule |
| File Integrity Monitoring | มี | การสร้าง แก้ไข ลบ และเปลี่ยนสิทธิ์ไฟล์ |
| Threat Hunting | มีเป็นหลัก | ใช้ข้อมูลจาก `wazuh-alerts-*` |
| Vulnerability Detection | บางส่วน | มีเหตุการณ์พบใหม่หรือแก้ไข แต่ไม่ใช่ Inventory ทั้งหมด |
| MITRE ATT&CK | มี | เป็น Mapping ที่มากับ Rule |
| IT Hygiene | ไม่ครบ | ต้องใช้ข้อมูล Inventory เพิ่ม |
| PCI DSS | มีเป็น Mapping | ไม่ใช่ผลประเมิน Compliance ทั้งระบบ |
| GDPR | มีเป็น Mapping | ไม่ใช่ผลประเมิน Compliance ทั้งระบบ |
| HIPAA | มีเป็น Mapping | ไม่ใช่ผลประเมิน Compliance ทั้งระบบ |
| NIST 800-53 | มีเป็น Mapping | ไม่ใช่ผลประเมิน Compliance ทั้งระบบ |
| TSC | มีเป็น Mapping | ไม่ใช่ผลประเมิน Compliance ทั้งระบบ |
| Agent และ Manager Health | ไม่ครบ | ต้องใช้ Wazuh API และ Log เพิ่ม |

---

## สิ่งที่ `alerts.json` ไม่ได้ครอบคลุมทั้งหมด

การอ่านเฉพาะ `alerts.json` จะไม่เห็นข้อมูลสถานะปัจจุบันทั้งหมด เช่น:

- ช่องโหว่ทั้งหมดที่ยังมีอยู่
- ผลตรวจ SCA ทุกข้อ
- รายการโปรแกรมที่ติดตั้ง
- รายการ Package ทั้งหมด
- รายการ Service
- รายการ Process ที่กำลังทำงาน
- Port ที่เปิดอยู่
- Network Interface
- User และ Group
- Hardware Inventory
- Operating System Inventory
- FIM Database ทั้งหมด
- สถานะ Agent
- สถานะ Manager
- สถานะ Indexer
- สถานะ Filebeat

---

# แหล่งข้อมูลที่ควรใช้ร่วมกับ AI

## 1. Real-time Alerts

ใช้ไฟล์:

```bash
/var/ossec/logs/alerts/alerts.json
```

เหมาะสำหรับ:

- แจ้งเตือนแบบ Real-time
- ส่ง Alert เข้า AI
- วิเคราะห์ภัยคุกคาม
- จัดระดับความรุนแรง
- สรุปเหตุการณ์
- ส่งผลไปยัง Discord
- สร้าง Alert ใหม่กลับเข้า Wazuh

---

## 2. Historical Alerts

ใช้ Index:

```text
wazuh-alerts-*
```

เหมาะสำหรับ:

- ค้นหา Alert ย้อนหลัง
- Correlation หลายเหตุการณ์
- ตรวจสอบ IP เดิม
- ตรวจสอบ User เดิม
- ตรวจสอบหลาย Agent
- นับจำนวนการโจมตีในช่วงเวลา
- วิเคราะห์พฤติกรรมต่อเนื่อง

ตัวอย่าง:

```text
ตรวจพบ SSH Login Failure 1 ครั้ง
        ↓
ค้นย้อนหลัง 10 นาที
        ↓
พบจาก IP เดียวกัน 50 ครั้ง
        ↓
AI สรุปว่าอาจเป็น Brute-force Attack
```

---

## 3. Vulnerability Inventory

ใช้ Index:

```text
wazuh-states-vulnerabilities-*
```

ข้อมูลที่สามารถดึงได้ เช่น:

- CVE
- Severity
- CVSS Score
- Package ที่ได้รับผลกระทบ
- Package Version
- Detection Time
- Agent
- Operating System
- สถานะช่องโหว่ปัจจุบัน

ตัวอย่าง Query:

```json
GET /wazuh-states-vulnerabilities-*/_search
{
  "size": 100,
  "query": {
    "bool": {
      "filter": [
        {
          "term": {
            "agent.id": "001"
          }
        },
        {
          "terms": {
            "vulnerability.severity": [
              "Critical",
              "High"
            ]
          }
        }
      ]
    }
  }
}
```

---

## 4. System Inventory และ IT Hygiene

ใช้ Index กลุ่ม:

```text
wazuh-states-inventory-*
```

ตัวอย่าง Index:

```text
wazuh-states-inventory-hardware-*
wazuh-states-inventory-hotfixes-*
wazuh-states-inventory-interfaces-*
wazuh-states-inventory-networks-*
wazuh-states-inventory-packages-*
wazuh-states-inventory-ports-*
wazuh-states-inventory-processes-*
wazuh-states-inventory-protocols-*
wazuh-states-inventory-system-*
wazuh-states-inventory-services-*
wazuh-states-inventory-users-*
wazuh-states-inventory-groups-*
```

เหมาะสำหรับตรวจสอบ:

- โปรแกรมที่ติดตั้ง
- Package ที่ล้าสมัย
- Process ที่กำลังทำงาน
- Port ที่เปิดอยู่
- Service ที่กำลังทำงาน
- User และ Group
- Network Interface
- Hardware
- Operating System
- Hotfix
- Protocol

---

## 5. Configuration Assessment

SCA Alert ใน `alerts.json` มักเกิดเมื่อผลตรวจเปลี่ยน เช่น:

```text
passed → failed
failed → passed
```

ถ้าต้องการผล SCA ปัจจุบันทั้งหมด ควรใช้ Wazuh Server API

ตัวอย่าง Endpoint:

```http
GET /sca/001
GET /sca/001/checks/<policy_id>
```

ข้อมูลที่ควรนำมาใช้กับ AI:

```text
policy_id
check_id
title
result
description
rationale
remediation
compliance
```

---

## 6. File Integrity Monitoring

`alerts.json` สามารถเก็บเหตุการณ์ FIM เช่น:

- ไฟล์ถูกสร้าง
- ไฟล์ถูกแก้ไข
- ไฟล์ถูกลบ
- Permission เปลี่ยน
- Owner เปลี่ยน
- Hash เปลี่ยน

ตัวอย่างข้อมูล:

```json
{
  "rule": {
    "groups": [
      "ossec",
      "syscheck",
      "syscheck_entry_modified"
    ]
  },
  "syscheck": {
    "path": "/etc/passwd",
    "event": "modified",
    "md5_before": "OLD_HASH",
    "md5_after": "NEW_HASH",
    "sha256_before": "OLD_SHA256",
    "sha256_after": "NEW_SHA256"
  }
}
```

ถ้าต้องการสถานะ FIM ปัจจุบันทั้งหมด ควรใช้ Wazuh API เพิ่ม

---

## 7. MITRE ATT&CK

MITRE ATT&CK เป็นข้อมูล Mapping ที่มากับ Wazuh Rule

ตัวอย่าง:

```json
{
  "rule": {
    "mitre": {
      "id": [
        "T1110"
      ],
      "technique": [
        "Brute Force"
      ],
      "tactic": [
        "Credential Access"
      ]
    }
  }
}
```

MITRE ไม่ใช่ Scanner แยก แต่ใช้สำหรับจัดหมวดหมู่ Alert ว่าเกี่ยวข้องกับเทคนิคหรือยุทธวิธีใด

---

## 8. Compliance Mapping

Alert อาจมีข้อมูล Mapping เช่น:

```json
{
  "rule": {
    "pci_dss": [
      "10.2.4",
      "10.2.5"
    ],
    "gdpr": [
      "IV_35.7.d"
    ],
    "hipaa": [
      "164.312.b"
    ],
    "nist_800_53": [
      "AU.14",
      "AC.7"
    ],
    "tsc": [
      "CC6.1",
      "CC6.8"
    ]
  }
}
```

ข้อมูลนี้หมายถึง Alert มีความสัมพันธ์กับข้อกำหนดนั้น

AI ควรสรุปว่า:

```text
เหตุการณ์นี้สัมพันธ์กับ NIST 800-53 Control AC-7
```

ไม่ควรสรุปว่า:

```text
องค์กรไม่ผ่านมาตรฐาน NIST 800-53
```

เพราะ Alert เพียงรายการเดียวไม่สามารถใช้ตัดสิน Compliance ทั้งองค์กรได้

---

# Archives กับ Alerts ต่างกันอย่างไร

## Alerts

```bash
/var/ossec/logs/alerts/alerts.json
```

เก็บเฉพาะเหตุการณ์ที่ผ่าน Rule และถูกสร้างเป็น Alert

## Archives

```bash
/var/ossec/logs/archives/archives.json
```

เก็บ Event ที่ Wazuh รับเข้ามา แม้ Event นั้นจะไม่สร้าง Alert

สามารถเปิดได้ด้วย:

```xml
<global>
  <logall_json>yes</logall_json>
</global>
```

ข้อควรระวัง:

- ข้อมูลมีปริมาณมาก
- ใช้พื้นที่สูง
- มี Noise จำนวนมาก
- อาจมีข้อมูลส่วนบุคคล
- อาจมี Secret หรือข้อมูลสำคัญ
- ไม่ควรส่งทั้งหมดเข้า LLM
- ควรค้นเฉพาะช่วงเวลาที่เกี่ยวข้องกับ Alert

---

# สถาปัตยกรรม AI ที่แนะนำ

```text
Wazuh Agent
     ↓
Wazuh Manager
     ↓
Decoder และ Rule
     ↓
alerts.json
     ↓
custom-gemini.py
     ↓
ตรวจสอบประเภท Alert
     ↓
ดึง Context เพิ่ม
     ├── wazuh-alerts-* ย้อนหลัง
     ├── Vulnerability Inventory
     ├── System Inventory
     ├── SCA Results
     ├── FIM State
     └── Threat Intelligence
     ↓
AI วิเคราะห์
     ↓
ส่งผลกลับเข้า Wazuh
     ↓
Rule 100211
     ↓
Dashboard / Discord
```

---

# Pipeline ที่เหมาะกับระบบปัจจุบัน

```text
Rule 23505
    ↓
custom-gemini.py
    ↓
AI Analyze
    ↓
ส่ง AI Enrichment กลับเข้า Wazuh
    ↓
Rule 100211
    ↓
Discord
```

---

# Context Enrichment ตามประเภท Alert

## Authentication Alert

ดึงข้อมูลเพิ่ม:

- Alert จาก IP เดียวกัน
- User ที่ถูกโจมตี
- Agent ที่ได้รับผลกระทบ
- การ Login สำเร็จหลังจาก Login Failure
- จำนวนเหตุการณ์ในช่วง 5–15 นาที

```text
Authentication Alert
        ↓
ค้น wazuh-alerts-* ย้อนหลัง
        ↓
นับจำนวน Failed Login
        ↓
ตรวจสอบ Successful Login
        ↓
AI ประเมิน Brute-force และ Account Compromise
```

## Vulnerability Alert

ดึงข้อมูลเพิ่ม:

- CVE ปัจจุบันของ Agent
- Severity
- CVSS
- Package
- Version
- Patch Availability
- ช่องโหว่อื่นบนเครื่องเดียวกัน

```text
Vulnerability Alert
        ↓
Query wazuh-states-vulnerabilities-*
        ↓
AI ประเมินความเสี่ยงของ Asset
```

## FIM Alert

ดึงข้อมูลเพิ่ม:

- ประวัติไฟล์เดียวกัน
- User ที่แก้ไข
- Process ที่เกี่ยวข้อง
- Hash ก่อนและหลัง
- ความสำคัญของไฟล์

```text
FIM Alert
    ↓
ค้น Alert ของไฟล์เดียวกัน
    ↓
ตรวจสอบ Process และ User
    ↓
AI ประเมินว่าเป็นการเปลี่ยนแปลงปกติหรือผิดปกติ
```

## Suspicious Process Alert

ดึงข้อมูลเพิ่ม:

- Running Process
- Parent Process
- Open Port
- User
- Installed Package
- Service

```text
Suspicious Process
        ↓
Query inventory-processes
        ↓
Query inventory-ports
        ↓
Query inventory-services
        ↓
AI วิเคราะห์ Process Chain
```

## SCA Alert

ดึงข้อมูลเพิ่ม:

- Policy
- Check
- Result
- Rationale
- Remediation
- Compliance Mapping

```text
SCA Alert
    ↓
Query Wazuh API
    ↓
AI สรุปผลกระทบและวิธีแก้ไข
```

---

# รูปแบบ JSON ที่ AI ควรส่งกลับ

```json
{
  "summary": "ตรวจพบความพยายามเข้าสู่ระบบ SSH หลายครั้ง",
  "event_type": "Brute Force",
  "severity": "high",
  "confidence": 0.94,
  "likely_false_positive": false,
  "affected_asset": {
    "agent_id": "001",
    "hostname": "web-server-01",
    "ip": "10.0.0.20"
  },
  "observed_evidence": [
    {
      "type": "authentication_failure",
      "value": "12 attempts from 203.0.113.45"
    }
  ],
  "correlation": {
    "related_alerts": 12,
    "time_window_minutes": 10,
    "affected_accounts": [
      "root",
      "admin"
    ]
  },
  "mitre_attack": [
    {
      "technique_id": "T1110",
      "technique_name": "Brute Force",
      "tactic": "Credential Access"
    }
  ],
  "compliance": {
    "pci_dss": [
      "10.2.4"
    ],
    "nist_800_53": [
      "AC.7"
    ]
  },
  "recommended_actions": [
    "ตรวจสอบว่ามีการเข้าสู่ระบบสำเร็จหรือไม่",
    "บล็อก IP ชั่วคราวหากยืนยันว่าเป็นการโจมตี",
    "ตรวจสอบบัญชีที่ถูกใช้โจมตี"
  ],
  "auto_response_allowed": false
}
```

---

# การป้องกัน AI Loop

ต้องป้องกันไม่ให้ Alert ที่สร้างจาก AI ถูกส่งกลับไปวิเคราะห์ซ้ำ

ตัวอย่างเงื่อนไขที่ควรข้าม:

```text
rule.id = 100211
rule.groups มี ai_enrichment
data.ai_analyzed = true
```

ตัวอย่าง Python:

```python
import sys

rule = alert.get("rule", {})
rule_id = str(rule.get("id", ""))
groups = rule.get("groups", [])

if rule_id == "100211":
    sys.exit(0)

if "ai_enrichment" in groups:
    sys.exit(0)

if alert.get("data", {}).get("ai_analyzed") is True:
    sys.exit(0)
```

---

# แนวทางลด Token

ไม่ควรส่ง Alert ทุกระดับเข้า AI

แนะนำให้กรองตาม:

- Alert Level
- Rule ID
- Rule Group
- Agent
- Event Type
- Event Location

ตัวอย่าง:

```xml
<integration>
  <name>custom-gemini</name>
  <level>7</level>
  <alert_format>json</alert_format>
</integration>
```

หรือกรองตาม Group:

```xml
<integration>
  <name>custom-gemini</name>
  <group>authentication_failed,syscheck,rootcheck,vulnerability-detector,yara,</group>
  <alert_format>json</alert_format>
</integration>
```

ควรกำหนดให้ AI วิเคราะห์เฉพาะ:

- Level 7 ขึ้นไป
- Critical และ High Vulnerability
- FIM บนไฟล์สำคัญ
- Authentication Failure จำนวนมาก
- Malware
- Privilege Escalation
- Suspicious Process
- Rootkit
- Security Configuration Failure ที่สำคัญ

---

# สรุป

การใช้เฉพาะ:

```bash
/var/ossec/logs/alerts/alerts.json
```

เหมาะสำหรับ:

- Real-time Security Alert
- Malware Alert
- Authentication Attack
- FIM Event
- MITRE Mapping
- Compliance Mapping
- SCA State Change
- Vulnerability State Change

แต่ไม่ครอบคลุม:

- Vulnerability Inventory ปัจจุบันทั้งหมด
- SCA Results ทั้งหมด
- Installed Packages
- Open Ports
- Running Processes
- Services
- Users และ Groups
- Hardware และ Operating System Inventory
- Current FIM Database
- Agent และ Manager Health

ระบบ AI ที่แนะนำควรใช้:

```text
alerts.json
+ wazuh-alerts-*
+ wazuh-states-vulnerabilities-*
+ wazuh-states-inventory-*
+ Wazuh Server API
```

แนวทางนี้จะทำให้ AI วิเคราะห์ได้ทั้ง:

- เหตุการณ์แบบ Real-time
- ประวัติย้อนหลัง
- สถานะช่องโหว่ปัจจุบัน
- สถานะของ Asset
- ผล Configuration Assessment
- ข้อมูล Process, Port, Service และ Package
- MITRE ATT&CK
- Compliance Mapping
- คำแนะนำในการตอบสนองต่อเหตุการณ์